import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { woodTexture } from './textures.js';

/** Coarse pointer or small screen: trade some rendering quality for frame rate. */
export const IS_MOBILE = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(window.innerWidth, window.innerHeight) < 700;

const DAY = {
  sun: 2.4, sunColor: new THREE.Color(0xfff1dc),
  hemi: 1.05, window: 7.0, windowColor: new THREE.Color(0xe4eeff),
  lampSpot: 0, lampPoint: 0, exposure: 1.0,
  bg: new THREE.Color(0x3a322b),
};
const NIGHT = {
  sun: 0.22, sunColor: new THREE.Color(0x8fa6d8),
  hemi: 0.12, window: 0.5, windowColor: new THREE.Color(0x7f97c9),
  lampSpot: 26, lampPoint: 1.6, exposure: 0.95,
  bg: new THREE.Color(0x07080c),
};

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Full device resolution while the page rests (the Arabic is a texture, so this is what keeps it crisp);
  // phones drop to 2× only while something moves.
  const DPR = Math.min(window.devicePixelRatio || 1, 3);
  const MOVING_DPR = IS_MOBILE ? Math.min(DPR, 2) : DPR;
  renderer.setPixelRatio(DPR);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  RectAreaLightUniformsLib.init();

  const scene = new THREE.Scene();
  scene.background = DAY.bg.clone();

  // The camera is never user-controlled: it rests either on the desk view (closed book) or straight above
  // the pages (reading), and glides between the two. No orbit, pan or zoom to fiddle with.
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40);
  const target = new THREE.Vector3(0, 0.08, -0.2);
  const UP_DESK = new THREE.Vector3(0, 1, 0), UP_TOP = new THREE.Vector3(0, 0, -1);
  const TOP_FOV = 26;
  const deskFov = (aspect) => (aspect < 0.9 ? 60 : aspect < 1.3 ? 48 : 38);
  const deskPos = (aspect) => (aspect < 0.8 ? new THREE.Vector3(0.03, 2.5, 2.7) : aspect < 1.2 ? new THREE.Vector3(0.04, 2.0, 2.45) : new THREE.Vector3(0.05, 1.75, 2.15));
  const DESK_TARGET = new THREE.Vector3(0, 0.02, -0.08);
  camera.position.copy(deskPos(window.innerWidth / Math.max(1, window.innerHeight)));
  target.copy(DESK_TARGET);
  camera.up.copy(UP_DESK);
  camera.lookAt(target);

  // ---------- desk ----------
  // Only the table top the mushaf rests on; the room around it is left to the background colour.
  const tableTex = woodTexture({ base: '#7b5433', dark: '#4a2f17', light: '#a2743f' });
  tableTex.repeat.set(3.5, 2.4);
  // deep enough to fill a portrait screen below the page now that there is no floor behind it
  const top = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.07, 4.2), new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.42, metalness: 0.03 }));
  top.position.set(0, -0.035, 0.3);
  top.receiveShadow = true;

  // where the window and the table lamp stood: their light stays, their bodies are not drawn
  const WALL_Z = -1.95;
  const winX = 0.55, winY = 1.55, winW = 1.9, winH = 2.1;

  // ---------- lights ----------
  const sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sun);
  sun.position.set(2.1, 3.6, -1.7);
  sun.target.position.set(-0.2, 0, 0.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
  sun.shadow.camera.left = -2.6; sun.shadow.camera.right = 2.6;
  sun.shadow.camera.top = 2.6; sun.shadow.camera.bottom = -2.6;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 12;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;

  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x6a523a, DAY.hemi);

  const windowLight = new THREE.RectAreaLight(DAY.windowColor, DAY.window, winW, winH);
  windowLight.position.set(winX, winY, WALL_Z + 0.05);
  windowLight.lookAt(0, 0, 0.6);

  // table lamp (light only)
  const lamp = new THREE.Group();
  const lampPoint = new THREE.PointLight(0xffb060, 0, 5, 2);
  lampPoint.position.y = 0.92;
  const lampSpot = new THREE.SpotLight(0xffc37e, 0, 7, 0.78, 0.75, 1.4);
  const fill = new THREE.PointLight(0xffc9a0, 0, 6, 2);
  fill.position.set(-1.3, 1.3, 1.1);
  lampSpot.position.y = 0.92;
  lampSpot.castShadow = true;
  lampSpot.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
  lampSpot.shadow.bias = -0.0005;
  lampSpot.shadow.normalBias = 0.02;
  lamp.add(lampPoint, lampSpot);
  lamp.position.set(1.72, 0, -1.2);
  lampSpot.target.position.set(-0.1, 0, 0.05);
  scene.add(lampSpot.target);

  scene.add(top, sun, sun.target, hemi, windowLight, lamp, fill);

  // ---------- day / night ----------
  let night = 0, nightTarget = 0, nightExposure = DAY.exposure;
  // straight above the pages the paper faces every light at once; ease the exposure so it stays cream, not white
  let reading = 0, readingTarget = 0;
  const READ_EXPOSURE = 0.86;
  const tmpColor = new THREE.Color();
  const HEMI_SKY = new THREE.Color(0xdfe9ff), HEMI_READ = new THREE.Color(0xfff0d6);
  // r: reading mix. Soft, even, warm light over the pages; the window's hard shadows fade out.
  function applyNight(t, r = 0) {
    const L = THREE.MathUtils.lerp;
    sun.intensity = L(DAY.sun, NIGHT.sun, t) * L(1, 0.4, r);
    hemi.color.copy(tmpColor.copy(HEMI_SKY).lerp(HEMI_READ, r * (1 - t)));
    windowLight.intensity = L(DAY.window, NIGHT.window, t) * L(1, 0.55, r);
    sun.color.copy(tmpColor.copy(DAY.sunColor).lerp(NIGHT.sunColor, t));
    hemi.intensity = L(DAY.hemi, NIGHT.hemi, t) * L(1, 1.45, r);
    windowLight.color.copy(tmpColor.copy(DAY.windowColor).lerp(NIGHT.windowColor, t));
    lampSpot.intensity = THREE.MathUtils.lerp(DAY.lampSpot, NIGHT.lampSpot, t);
    lampPoint.intensity = THREE.MathUtils.lerp(DAY.lampPoint, NIGHT.lampPoint, t);
    fill.intensity = t * L(0.55, 2.2, r);
    nightExposure = THREE.MathUtils.lerp(DAY.exposure, NIGHT.exposure, t);
    scene.background.copy(tmpColor.copy(DAY.bg).lerp(NIGHT.bg, t));
  }
  applyNight(0);

  // Frames are drawn only while something moves (camera, light fade, a turning leaf) or after
  // invalidate(); a resting page costs nothing.
  let pending = 2;
  function invalidate(frames = 2) { pending = Math.max(pending, frames); }

  let size = { w: window.innerWidth, h: window.innerHeight };
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    size = { w, h };
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }

  // ---------- camera views ----------
  let tween = null;
  let current = { pos: camera.position.clone(), target: target.clone(), up: UP_DESK.clone(), fov: camera.fov };
  function go(view, dur) {
    current = view;
    invalidate();
    if (!dur) {
      tween = null;
      camera.position.copy(view.pos); target.copy(view.target); camera.up.copy(view.up);
      camera.fov = view.fov; camera.updateProjectionMatrix();
      camera.lookAt(target);
      return;
    }
    tween = { t: 0, dur, p0: camera.position.clone(), t0: target.clone(), u0: camera.up.clone(), f0: camera.fov, to: view };
  }
  /** The tilted desk view of the closed book. */
  function showDesk(dur = 1.1) {
    const aspect = size.w / Math.max(1, size.h);
    readingTarget = 0;
    go({ pos: deskPos(aspect), target: DESK_TARGET.clone(), up: UP_DESK.clone(), fov: deskFov(aspect) }, dur);
  }
  /**
   * Straight-down view that fits the world rectangle {x0, x1, z0, z1, y} into the viewport
   * minus `insets` (CSS px: top, right, bottom, left).
   */
  function showRect(rect, insets, dur = 1.1) {
    const { w: vw, h: vh } = size;
    const aw = Math.max(50, vw - insets.left - insets.right), ah = Math.max(50, vh - insets.top - insets.bottom);
    const k = Math.max((rect.x1 - rect.x0) / aw, (rect.z1 - rect.z0) / ah); // world units per px on the page plane
    const d = (k * vh) / 2 / Math.tan(THREE.MathUtils.degToRad(TOP_FOV / 2));
    const cx = (rect.x0 + rect.x1) / 2 - (k * (insets.left - insets.right)) / 2;
    const cz = (rect.z0 + rect.z1) / 2 - (k * (insets.top - insets.bottom)) / 2;
    readingTarget = 1;
    go({ pos: new THREE.Vector3(cx, rect.y + d, cz), target: new THREE.Vector3(cx, rect.y, cz), up: UP_TOP.clone(), fov: TOP_FOV }, dur);
  }
  const v3 = new THREE.Vector3();
  /** World point → CSS px in the viewport. */
  function project(x, y, z) {
    v3.set(x, y, z).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * size.w, y: (-v3.y * 0.5 + 0.5) * size.h };
  }

  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  function tick(dt) {
    const busy = !!tween || nightTarget !== night || readingTarget !== reading;
    if (nightTarget !== night || readingTarget !== reading) {
      const step = dt / 1.4;
      night = nightTarget > night ? Math.min(nightTarget, night + step) : Math.max(nightTarget, night - step);
      reading = readingTarget > reading ? Math.min(readingTarget, reading + step) : Math.max(readingTarget, reading - step);
      applyNight(THREE.MathUtils.smoothstep(night, 0, 1), THREE.MathUtils.smoothstep(reading, 0, 1));
    }
    renderer.toneMappingExposure = nightExposure * THREE.MathUtils.lerp(1, READ_EXPOSURE, THREE.MathUtils.smoothstep(reading, 0, 1));
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      const e = ease(tween.t), to = tween.to;
      camera.position.lerpVectors(tween.p0, to.pos, e);
      target.lerpVectors(tween.t0, to.target, e);
      camera.up.lerpVectors(tween.u0, to.up, e).normalize();
      camera.fov = THREE.MathUtils.lerp(tween.f0, to.fov, e);
      camera.updateProjectionMatrix();
      if (tween.t >= 1) tween = null;
    }
    camera.lookAt(target);
    if (busy) invalidate(1);
    return busy;
  }

  function render(moving = false) {
    const pr = moving ? MOVING_DPR : DPR;
    if (renderer.getPixelRatio() !== pr) { renderer.setPixelRatio(pr); pending = Math.max(pending, 1); }
    if (pending <= 0) return false;
    pending = Math.max(0, pending - 1);
    renderer.render(scene, camera);
    return true;
  }

  return {
    renderer, scene, camera, resize, tick, render, invalidate, showDesk, showRect, project,
    get moving() { return !!tween; },
    setNight(on) { nightTarget = on ? 1 : 0; },
    isNight() { return nightTarget === 1; },
  };
}

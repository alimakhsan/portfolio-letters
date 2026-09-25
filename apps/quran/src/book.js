import * as THREE from 'three';
import { paperEdgeTexture } from './textures.js';
import { PW, PH } from './pageRenderer.js';

export const H = 1.45;           // page height
export const W = (H * PW) / PH;  // page width (spine → outer edge), same proportions as the page canvas
const BLOCK_LEAVES = 303;  // leaf 1 = title/page 1, leaves 2..303 hold pages 2..604
export const MAX_SPREAD = 303;
const LEAF_T = 0.13 / BLOCK_LEAVES;
export const COVER_T = 0.022;
export const PAD_X = 0.03;
export const PAD_Z = 0.04;
const EPS = 0.0007;
const G = 0.17;            // (legacy) gutter width
const N = 56;              // columns along the page width
const M = 6;               // rows along the page height (sheet only)

const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/**
 * Height of a page surface at distance s from the spine (block base = 0):
 * rises quickly out of the gutter, arches slightly (bulge B), and settles to T at the outer edge.
 */
const profile = (s, T, ySp, B = 0) => {
  const t = Math.min(1, Math.max(0, s / W));
  return ySp + (T + B - ySp) * (1 - Math.pow(1 - t, 2.6)) - B * t * t * t;
};

/**
 * One side of the open book: the block of leaves plus the visible top page,
 * both following the gutter profile.
 */
class Side {
  constructor(sign, edgeMat, topMat) {
    this.sign = sign;
    // --- top page surface (textured)
    this.pageGeo = this._grid();
    this.page = new THREE.Mesh(this.pageGeo, new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 }));
    this.page.receiveShadow = true;
    this.page.userData.side = sign > 0 ? 'right' : 'left';
    // --- block: top grid + 4 sides + bottom
    this.blockGeo = this._block();
    this.block = new THREE.Mesh(this.blockGeo, [topMat, edgeMat]);
    this.block.castShadow = true;
    this.block.receiveShadow = true;
  }

  _grid() {
    const pos = new Float32Array((N + 1) * 2 * 3);
    const uv = new Float32Array((N + 1) * 2 * 2);
    const idx = [];
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        const s = (i / N) * W;
        pos[k * 3] = this.sign * s; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = -H / 2 + j * H;
        uv[k * 2] = this.sign > 0 ? s / W : 1 - s / W;
        uv[k * 2 + 1] = 1 - j;
      }
    }
    for (let i = 0; i < N; i++) {
      const a = i, b = i + 1, c = N + 1 + i, d = N + 1 + i + 1;
      if (this.sign > 0) idx.push(a, d, b, a, c, d);
      else idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  _block() {
    // vertices: top grid (2 rows), front strip (bottom,top), back strip (bottom,top), then 12 for outer/inner/bottom faces
    const cols = N + 1;
    const count = cols * 2 + cols * 2 + cols * 2 + 12;
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const idx = [];
    const topStart = 0, frontStart = cols * 2, backStart = cols * 4, restStart = cols * 6;
    // uvs
    for (let i = 0; i < cols; i++) {
      uv[(topStart + i) * 2] = i / N; uv[(topStart + i) * 2 + 1] = 1;
      uv[(topStart + cols + i) * 2] = i / N; uv[(topStart + cols + i) * 2 + 1] = 0;
      for (const st of [frontStart, backStart]) {
        uv[(st + i) * 2] = i / N; uv[(st + i) * 2 + 1] = 0;          // bottom
        uv[(st + cols + i) * 2] = i / N; uv[(st + cols + i) * 2 + 1] = 1; // top
      }
    }
    for (let q = 0; q < 12; q++) { uv[(restStart + q) * 2] = (q % 4) < 2 ? 0 : 1; uv[(restStart + q) * 2 + 1] = q % 2; }
    // top grid triangles (group 0)
    for (let i = 0; i < N; i++) {
      const a = topStart + i, b = a + 1, c = topStart + cols + i, d = c + 1;
      if (this.sign > 0) idx.push(a, d, b, a, c, d);
      else idx.push(a, b, d, a, d, c);
    }
    const topCount = idx.length;
    // strips (group 1)
    for (const st of [frontStart, backStart]) {
      for (let i = 0; i < N; i++) {
        const a = st + i, b = a + 1, c = st + cols + i, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    // outer face, inner face, bottom (quads)
    for (let q = 0; q < 3; q++) {
      const o = restStart + q * 4;
      idx.push(o, o + 1, o + 3, o, o + 3, o + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.addGroup(0, topCount, 0);
    g.addGroup(topCount, idx.length - topCount, 1);
    this._starts = { topStart, frontStart, backStart, restStart, cols };
    return g;
  }

  /** T = thickness at the outer edge, ySp = height at the spine (block base = 0). */
  update(T, ySp, B, baseY) {
    const { topStart, frontStart, backStart, restStart, cols } = this._starts;
    const bp = this.blockGeo.attributes.position, pp = this.pageGeo.attributes.position;
    const zF = H / 2, zB = -H / 2;
    for (let i = 0; i < cols; i++) {
      const s = (i / N) * W, x = this.sign * s;
      const y = profile(s, T, ySp, B);
      bp.setXYZ(topStart + i, x, y, zB); bp.setXYZ(topStart + cols + i, x, y, zF);
      bp.setXYZ(frontStart + i, x, 0, zF); bp.setXYZ(frontStart + cols + i, x, y, zF);
      bp.setXYZ(backStart + i, x, 0, zB); bp.setXYZ(backStart + cols + i, x, y, zB);
      pp.setXYZ(i, x, y + EPS, zB); pp.setXYZ(cols + i, x, y + EPS, zF);
    }
    const yOut = T, yIn = ySp, xOut = this.sign * W;
    let o = restStart;
    bp.setXYZ(o, xOut, 0, zB); bp.setXYZ(o + 1, xOut, yOut, zB); bp.setXYZ(o + 2, xOut, 0, zF); bp.setXYZ(o + 3, xOut, yOut, zF); // outer
    o += 4;
    bp.setXYZ(o, 0, 0, zB); bp.setXYZ(o + 1, 0, yIn, zB); bp.setXYZ(o + 2, 0, 0, zF); bp.setXYZ(o + 3, 0, yIn, zF); // inner
    o += 4;
    bp.setXYZ(o, 0, 0, zB); bp.setXYZ(o + 1, xOut, 0, zB); bp.setXYZ(o + 2, 0, 0, zF); bp.setXYZ(o + 3, xOut, 0, zF); // bottom
    bp.needsUpdate = pp.needsUpdate = true;
    this.blockGeo.computeVertexNormals();
    this.pageGeo.computeVertexNormals();
    this.blockGeo.computeBoundingSphere();
    this.pageGeo.computeBoundingSphere();
    this.block.position.y = this.page.position.y = baseY;
  }
}

/**
 * A right-to-left book. Spread index f:
 *   0 → closed, f>=2 → pages 2f-3 | 2f-2 (spread 1, inside cover | leaf 1, is never shown: the cover opens
 *   straight onto the page to read).
 * `source` provides async leafFront(n)/leafBack(n) → map sets, coverMaps(), leatherMaps(), mirroredMaps().
 */
export class Book {
  constructor(source) {
    this.source = source;
    this.group = new THREE.Group();
    this.f = 0;
    this.anim = null;
    this.onFlipStart = null;
    this.onFlipEnd = null;
    this.onDragStart = null;
    this.onDragCancel = null;
    this.onChange = null;    // anything visible changed while at rest (the scene redraws on demand)
    this._build();
  }

  get animating() { return !!this.anim; }

  _build() {
    const S = this.source;
    const edge = paperEdgeTexture();
    const paperTop = new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.95, side: THREE.DoubleSide });
    const edgeMat = new THREE.MeshStandardMaterial({ map: edge, roughness: 0.95, side: THREE.DoubleSide });
    const leather = S.leatherMaps();
    const leatherMat = new THREE.MeshStandardMaterial({ map: leather.map, bumpMap: leather.bumpMap, bumpScale: 0.0025, roughness: 0.62, metalness: 0.04 });
    const endpaper = new THREE.MeshStandardMaterial({ map: S.special('inside').map, roughness: 0.9 });
    const cover = S.coverMaps();
    const coverTopMat = new THREE.MeshStandardMaterial({
      map: cover.map, bumpMap: cover.bumpMap, bumpScale: 0.004,
      roughnessMap: cover.roughnessMap, metalnessMap: cover.metalnessMap, roughness: 1, metalness: 1,
    });

    this.left = new Side(-1, edgeMat, paperTop);
    this.right = new Side(1, edgeMat, paperTop);

    const coverGeo = new THREE.BoxGeometry(W + PAD_X, COVER_T, H + PAD_Z);
    this.backCover = new THREE.Mesh(coverGeo, [leatherMat, leatherMat, endpaper, leatherMat, leatherMat, leatherMat]);
    this.backCover.position.set(-(W + PAD_X) / 2, COVER_T / 2, 0);
    // front cover hinged at the spine: rotation 0 = closed (lying on the block), π = open (lying on the right, face down)
    this.coverPivot = new THREE.Group();
    this.coverBox = new THREE.Mesh(coverGeo, [leatherMat, leatherMat, coverTopMat, endpaper, leatherMat, leatherMat]);
    this.coverBox.position.set(-(W + PAD_X) / 2, COVER_T / 2, 0);
    this.coverBox.userData.side = 'cover';
    this.coverPivot.add(this.coverBox);
    // while the cover swings, the leaves that end up on the right ride along with it (see _carry)
    this.carry = new THREE.Group();
    this.carry.rotation.z = Math.PI;
    this.coverPivot.add(this.carry);
    this.spine = new THREE.Mesh(new THREE.BoxGeometry(0.03, COVER_T, H + PAD_Z), leatherMat);
    for (const m of [this.backCover, this.coverBox, this.spine]) { m.castShadow = true; m.receiveShadow = true; }

    // flipping sheet
    this.sheetGeo = new THREE.PlaneGeometry(W, H, N, M).rotateX(-Math.PI / 2).translate(W / 2, 0, 0);
    this.sheetFront = new THREE.Mesh(this.sheetGeo, new THREE.MeshStandardMaterial({ roughness: 0.92, side: THREE.FrontSide }));
    this.sheetBack = new THREE.Mesh(this.sheetGeo, new THREE.MeshStandardMaterial({ roughness: 0.92, side: THREE.BackSide }));
    for (const s of [this.sheetFront, this.sheetBack]) { s.castShadow = true; s.receiveShadow = true; s.visible = false; }

    this.group.add(this.backCover, this.coverPivot, this.spine,
      this.left.block, this.left.page, this.right.block, this.right.page, this.sheetFront, this.sheetBack);
  }

  counts(f) {
    const r = Math.max(0, f - 1);
    return { u: BLOCK_LEAVES - r, r };
  }

  /** Thicknesses and spine heights for spread f (or an explicit left/right leaf count). */
  state(f, uOverride, rOverride) {
    const c = this.counts(f);
    const u = uOverride ?? c.u, r = rOverride ?? c.r;
    const TL = u * LEAF_T, TR = r * LEAF_T;
    const bulge = (T) => 0.018 + 0.3 * T;
    if (f === 0) return { TL, TR, ySpL: TL, ySpR: 0, BL: 0, BR: 0, rightVisible: false };
    if (f === 1 || r === 0) return { TL, TR, ySpL: TL * 0.4, ySpR: 0, BL: bulge(TL), BR: 0, rightVisible: r > 0 };
    const ySp = 0.4 * (TL + TR);
    return { TL, TR, ySpL: ySp, ySpR: ySp, BL: bulge(TL), BR: bulge(TR), rightVisible: true };
  }

  /** Height above the table of the resting top page of `side` at distance s from the spine. */
  surfaceY(side, s) {
    const st = this.state(this.f);
    const r = side === 'right';
    return COVER_T + EPS + profile(s, r ? st.TR : st.TL, r ? st.ySpR : st.ySpL, r ? st.BR : st.BL);
  }

  pageAt(side) {
    if (this.f < 2) return null;
    return side === 'left' ? 2 * this.f - 2 : 2 * this.f - 3;
  }

  pickables() {
    const list = [];
    if (this.f === 0) list.push(this.coverBox);
    else {
      list.push(this.left.page);
      if (this.f === 1) list.push(this.coverBox);
      else list.push(this.right.page);
    }
    return list;
  }

  _applyState(st) {
    this.left.update(st.TL, st.ySpL, st.BL, COVER_T);
    this.right.update(st.TR, st.ySpR, st.BR, COVER_T);
    this.right.block.visible = this.right.page.visible = st.rightVisible;
  }

  _placeCover(open, y) {
    // open: 0 = closed on top of the block, 1 = lying open on the right
    this.coverPivot.rotation.z = -Math.PI * open;
    this.coverPivot.position.y = y;
    // spine: vertical when closed, flat under the gutter when open
    const len = lerp(this.state(0).TL + 2 * COVER_T, 0.03, open);
    this.spine.scale.x = len / 0.03;
    this.spine.rotation.z = lerp(Math.PI / 2, 0, open);
    this.spine.position.set(lerp(COVER_T / 2, 0, open), lerp(len / 2, COVER_T / 2, open), 0);
    this.group.position.x = lerp((W + PAD_X) / 2, 0, open);
  }

  layoutStatic(f = this.f) {
    const st = this.state(f);
    this._applyState(st);
    if (f === 0) this._placeCover(0, COVER_T + st.TL);
    else this._placeCover(1, COVER_T);
    this.left.page.visible = f >= 1 && f <= MAX_SPREAD;
    this.onChange?.();
  }

  /** Hang the right-hand stack from the cover (on) or put it back on the table (off). */
  _carry(on) {
    const parent = on ? this.carry : this.group;
    if (this.right.block.parent !== parent) parent.add(this.right.block, this.right.page);
  }

  /** Cover swing: open = 0 closed … 1 lying open; the book opens straight onto spread a.shown. */
  _coverPose(a, open) {
    const so = a.stOpen;
    this._placeCover(open, lerp(COVER_T + a.total, COVER_T, open));
    this.left.update(so.TL, lerp(so.TL, so.ySpL, open), lerp(0, so.BL, open), COVER_T);
    // in the carried frame y = 0 is the cover's inner face; flat when closed, bound when open
    this.right.update(so.TR, lerp(so.TR, so.ySpR, open), lerp(0, so.BR, open), 0);
  }

  _setMaps(mesh, maps) {
    const m = mesh.material;
    m.map = maps?.map || null;
    m.bumpMap = maps?.bumpMap || null;
    m.roughnessMap = maps?.roughnessMap || null;
    m.metalnessMap = maps?.metalnessMap || null;
    m.roughness = maps?.roughnessMap ? 1 : 0.92;
    m.metalness = maps?.metalnessMap ? 1 : 0;
    m.bumpScale = 0.004;
    m.needsUpdate = true;
    this.onChange?.();
  }

  async applyTextures(f = this.f) {
    const S = this.source;
    const [lt, rt] = await Promise.all([
      f >= 1 && f <= MAX_SPREAD ? S.leafFront(f) : null,
      f >= 2 ? S.leafBack(f - 1) : null,
    ]);
    this._setMaps(this.left.page, lt);
    this._setMaps(this.right.page, rt);
  }

  /** Swap the map of a resting page (the app shows a text-less page under its vector Arabic). */
  setPageMaps(side, maps) {
    const mesh = side === 'left' ? this.left.page : this.right.page;
    if (maps && mesh.material.map !== maps.map) this._setMaps(mesh, maps);
  }

  flip(dir) { return this.goTo(this.f + dir); }

  /** Animate a single leaf (or the cover) so the book lands on spread `target`. */
  async goTo(target) {
    const a = await this._prepare(target, false);
    if (!a) return;
    a.manual = false;
    this.anim = a;
    this.onFlipStart?.(a.isCover ? 'cover' : 'page', a.dur);
  }

  /** Start a pointer-driven flip (dir +1 = next, -1 = previous). Resolves false if there is nothing to flip. */
  async beginDrag(dir) {
    const a = await this._prepare(this.f + dir, true);
    if (!a) return false;
    a.manual = true;
    a.p = 0;
    a.pVel = 0;
    a.tween = null;
    this.anim = a;
    this.onDragStart?.(a.isCover ? 'cover' : 'page');
    return true;
  }

  get dragging() { return !!(this.anim && this.anim.manual && !this.anim.tween); }

  /** Move the lifted leaf: p = 0 resting where it started, 1 landed on the other side. */
  setDragProgress(p, dt = 1 / 60) {
    const a = this.anim;
    if (!a || !a.manual || a.tween) return;
    p = Math.max(0, Math.min(1, p));
    a.pVel = a.pVel * 0.55 + ((p - a.p) / Math.max(dt, 1e-3)) * 0.45;
    a.p = p;
  }

  /** Release the leaf: complete the flip when past the middle or flicked, otherwise let it fall back. */
  endDrag(forceComplete = false) {
    const a = this.anim;
    if (!a || !a.manual || a.tween) return;
    const complete = forceComplete || a.pVel > 1.1 || (a.p > 0.42 && a.pVel > -1.1);
    const p1 = complete ? 1 : 0;
    const dist = Math.abs(p1 - a.p);
    a.tween = { p0: a.p, p1, t: 0, dur: 0.16 + 0.6 * dist };
    if (complete) this.onFlipStart?.(a.isCover ? 'cover' : 'page', a.tween.dur * 1.4);
    else this.onDragCancel?.();
  }

  /** Load textures and arrange the static pages for a flip, returning the animation record (or null). */
  async _prepare(target, forDrag) {
    target = Math.max(0, Math.min(MAX_SPREAD, target));
    if (this.anim || target === this.f) return null;
    const f = this.f;
    const dir = target > f ? 1 : -1;
    const S = this.source;

    // the cover opens straight onto the spread to read (no title page) and closes from wherever the book lies
    if (f === 0 || target === 0) {
      if (target === 1) target = 2;
      const shown = f === 0 ? target : f;
      const [lt, rt] = await Promise.all([S.leafFront(shown), S.leafBack(shown - 1)]);
      if (this.anim) return null;
      this._setMaps(this.left.page, lt);
      this._setMaps(this.right.page, rt);
      const a = {
        t: 0, dur: 1.35, dir, target, isCover: true,
        from: dir > 0 ? 0 : 1, to: dir > 0 ? 1 : 0,
        stOpen: this.state(shown), total: this.state(0).TL,
      };
      this._carry(true);
      this.left.page.visible = this.right.page.visible = this.right.block.visible = true;
      this._coverPose(a, a.from);
      return a;
    }

    const [sheetFrontMaps, sheetBackMaps, revealedMaps, landedMaps, stayingMaps] = await Promise.all([
      dir > 0 ? S.leafBack(target - 1) : S.leafBack(f - 1),
      dir > 0 ? S.leafFront(f) : S.leafFront(target),
      dir > 0 ? S.leafFront(target) : S.leafBack(target - 1),
      dir > 0 ? S.leafBack(target - 1) : S.leafFront(target),
      dir > 0 ? S.leafBack(f - 1) : S.leafFront(f),   // the page that stays put, with its text back on
    ]);
    if (this.anim) return null;

    const cu = this.counts(f), ct = this.counts(target);
    const st = dir > 0
      ? this.state(Math.max(f, 2), ct.u, cu.r)
      : this.state(Math.max(target, 1), cu.u, ct.r);
    this._applyState(st);
    this._placeCover(1, COVER_T);
    if (dir > 0) {
      this._setMaps(this.left.page, revealedMaps);
      this._setMaps(this.right.page, stayingMaps);
      this.left.page.visible = target <= MAX_SPREAD;
    } else {
      this._setMaps(this.left.page, stayingMaps);
      this._setMaps(this.right.page, revealedMaps);
      this.right.page.visible = target >= 2;
      this.right.block.visible = target >= 2;
    }
    this._setMaps(this.sheetFront, sheetFrontMaps);
    this._setMaps(this.sheetBack, S.mirroredMaps(sheetBackMaps));
    const a = {
      t: 0, dur: 0.95, dir, target, isCover: false, landedMaps, sheetFrontMaps, sheetBackMaps, st,
      from: dir > 0 ? Math.PI : 0, to: dir > 0 ? 0 : Math.PI,
      bendAmp: 0.62,
    };
    this.anim = a;              // _deformSheet reads this.anim for the gutter profile
    this._deformSheet(a.from, 0, 0, 1);
    this.anim = null;
    this.sheetFront.visible = this.sheetBack.visible = true;
    return a;
  }

  /**
   * theta: hinge angle (0 = lying right, π = lying left); bend: curl amount;
   * e: eased progress (for the gutter profile blend); w: how much of the resting profile to keep.
   */
  _deformSheet(theta, bend, e, w) {
    const a = this.anim;
    const st = a?.st;
    const pos = this.sheetGeo.attributes.position;
    const nor = this.sheetGeo.attributes.normal;
    const xs = new Float32Array(N + 1), ys = new Float32Array(N + 1);
    const nx = new Float32Array(N + 1), ny = new Float32Array(N + 1);
    const ds = W / N;
    let x = 0, yy = 0;
    // profile: forward flips go left→right, backward right→left
    let pivotY = COVER_T;
    let riseFn = () => 0;
    if (st) {
      const fromL = a.dir > 0;
      const ySpFrom = fromL ? st.ySpL : st.ySpR, ySpTo = fromL ? st.ySpR : st.ySpL;
      const TFrom = fromL ? st.TL : st.TR, TTo = fromL ? st.TR : st.TL;
      const BFrom = fromL ? st.BL : st.BR, BTo = fromL ? st.BR : st.BL;
      pivotY = COVER_T + lerp(ySpFrom, ySpTo, e) + EPS * 2;
      riseFn = (s) => w * lerp(profile(s, TFrom, ySpFrom, BFrom) - ySpFrom, profile(s, TTo, ySpTo, BTo) - ySpTo, e);
    }
    for (let i = 1; i <= N; i++) {
      const sm = (i - 0.5) / N;
      const phi = theta + bend * sm * sm * (3 - 2 * sm) * 1.2;
      x += ds * Math.cos(phi);
      yy += ds * Math.sin(phi);
      xs[i] = x; ys[i] = yy;
    }
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const phi = theta + bend * s * s * (3 - 2 * s) * 1.2;
      nx[i] = -Math.sin(phi); ny[i] = Math.cos(phi);
      ys[i] += riseFn(s * W);
    }
    for (let j = 0; j <= M; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        pos.setXY(k, xs[i], ys[i]);
        nor.setXYZ(k, nx[i], ny[i], 0);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    this.sheetGeo.computeBoundingSphere();
    this.sheetFront.position.y = this.sheetBack.position.y = pivotY;
  }

  update(dt) {
    const a = this.anim;
    if (!a) return;
    let p, e, done = false;
    if (a.manual) {
      if (a.tween) {
        const tw = a.tween;
        tw.t += dt;
        const k = tw.t >= tw.dur ? 1 : 1 - Math.pow(1 - tw.t / tw.dur, 3);
        p = tw.p0 + (tw.p1 - tw.p0) * k;
        a.pVel = (p - a.p) / Math.max(dt, 1e-3);
        a.p = p;
        if (tw.t >= tw.dur) done = true;
      } else {
        p = a.p;
      }
      e = p;
    } else {
      a.t += dt;
      p = Math.min(1, a.t / a.dur);
      e = easeInOut(p);
      if (p >= 1) done = true;
    }
    if (a.isCover) {
      this._coverPose(a, lerp(a.from, a.to, e));
    } else {
      const theta = lerp(a.from, a.to, e);
      // the tip trails behind the direction of travel; when a dragged leaf falls back it trails the other way
      const travel = a.manual && a.pVel < -0.05 ? -1 : 1;
      const bend = travel * a.dir * a.bendAmp * Math.sin(p * Math.PI);
      const w = 1 - Math.pow(Math.sin(p * Math.PI), 0.7);
      this._deformSheet(theta, bend, e, w);
    }
    if (done) this._finish(a.manual && a.tween && a.tween.p1 === 0);
  }

  _finish(cancelled = false) {
    const a = this.anim;
    this.anim = null;
    this.sheetFront.visible = this.sheetBack.visible = false;
    if (cancelled) {
      // the leaf fell back where it started: restore the spread as it was
      this.layoutStatic();
      if (!a.isCover) {
        if (a.dir > 0) this._setMaps(this.left.page, a.sheetBackMaps);
        else this._setMaps(this.right.page, a.sheetFrontMaps);
      }
      this.onFlipEnd?.(this.f);
      return;
    }
    this.f = a.target;
    if (a.isCover) this._carry(false);
    this.layoutStatic();
    if (!a.isCover) {
      if (a.dir > 0) this._setMaps(this.right.page, a.landedMaps);
      else this._setMaps(this.left.page, a.landedMaps);
    }
    this.onFlipEnd?.(this.f);
  }
}

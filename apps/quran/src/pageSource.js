import * as THREE from 'three';
import { renderPage, renderCoverMaps, renderLeatherMaps, renderInsideCover, renderBlank, loadQcf } from './pageRenderer.js';
import { getPage, getChapters, TOTAL_PAGES } from './quranApi.js';
import { IS_MOBILE } from './scene.js';

// a page texture is ~20 MB on the GPU; keep the open spread, the one being turned to, and a little history
const CACHE_MAX = IS_MOBILE ? 6 : 8;

/** Produces (and caches) textures for every leaf of the book. */
export class PageSource {
  constructor(renderer) {
    this.aniso = Math.min(IS_MOBILE ? 4 : 16, renderer.capabilities.getMaxAnisotropy());
    this.cache = new Map();   // page → { tex, hits, data }
    this.pending = new Map();
    this.specials = {};
    this.script = 'uthmani';
  }

  setScript(script) { this.script = script; }
  _key(p) { return `${this.script}:${p}`; }

  _tex(canvas, srgb = true) {
    const t = new THREE.CanvasTexture(canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.aniso;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    return t;
  }

  mirrored(tex) {
    if (!tex) return null;
    if (!tex.userData.mirror) {
      const m = tex.clone();
      m.wrapS = THREE.RepeatWrapping;
      m.repeat.x = -1;
      m.offset.x = 1;
      m.needsUpdate = true;
      tex.userData.mirror = m;
    }
    return tex.userData.mirror;
  }

  /** Map set for a leaf face: { map, bumpMap?, roughnessMap?, metalnessMap? } */
  mirroredMaps(maps) {
    const out = {};
    for (const k of Object.keys(maps)) out[k] = this.mirrored(maps[k]);
    return out;
  }

  /** Front cover maps (embossed leather with gold tooling). */
  coverMaps() {
    if (!this.specials.cover) {
      const { color, bump, orm } = renderCoverMaps();
      const ormTex = this._tex(orm, false);
      this.specials.cover = {
        map: this._tex(color),
        bumpMap: this._tex(bump, false),
        roughnessMap: ormTex,
        metalnessMap: ormTex,
      };
    }
    return this.specials.cover;
  }

  /** Tiling leather for spine and back cover. */
  leatherMaps() {
    if (!this.specials.leather) {
      const { color, bump } = renderLeatherMaps();
      const map = this._tex(color), bumpMap = this._tex(bump, false);
      for (const t of [map, bumpMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3); }
      this.specials.leather = { map, bumpMap };
    }
    return this.specials.leather;
  }

  special(kind) {
    if (!this.specials[kind]) {
      const draw = { inside: renderInsideCover, blank: renderBlank }[kind];
      this.specials[kind] = { map: this._tex(draw()) };
    }
    return this.specials[kind];
  }

  async page(p) {
    if (p < 1 || p > TOTAL_PAGES) return { maps: this.special('blank'), hits: [], data: null };
    const key = this._key(p);
    if (this.cache.has(key)) {
      const e = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, e); // LRU touch
      return e;
    }
    if (this.pending.has(key)) return this.pending.get(key);
    const script = this.script;
    const job = (async () => {
      const tajweed = script === 'tajweed';
      const [data, chapters, glyph, basmala] = await Promise.all([getPage(p), getChapters(), loadQcf(p, tajweed), this._basmala(tajweed)]);
      const opts = { script, glyph, basmala };
      const { canvas, bare, hits, layout } = renderPage(p, data, chapters, opts);
      const entry = { maps: { map: this._tex(canvas) }, bare, bareMaps: null, hits, layout, data, page: p, script };
      this.cache.set(key, entry);
      this.pending.delete(key);
      while (this.cache.size > CACHE_MAX) {
        const [k, v] = this.cache.entries().next().value;
        this.cache.delete(k);
        this._dispose(v);
      }
      return entry;
    })();
    this.pending.set(key, job);
    job.catch(() => this.pending.delete(key));
    return job;
  }

  /** The basmala as page 1's glyphs (ayah 1:1 without its marker), in that page's font. */
  _basmala(tajweed) {
    const k = tajweed ? 'T' : 'P';
    this._bas ??= {};
    this._bas[k] ??= Promise.all([getPage(1), loadQcf(1, tajweed)]).then(([d, family]) => {
      const words = d.verses[0]?.words.filter((w) => !w.end && w.g) || [];
      return family && words.length ? { family, text: words.map((w) => w.g).join('') } : null;
    }).catch(() => null);
    return this._bas[k];
  }

  async leafFront(n) {
    if (n === 0) return this.coverMaps();
    if (n === 1) return this.special('blank');   // no title page: spread 1 is never shown
    return (await this.page(2 * n - 2)).maps;
  }

  async leafBack(n) {
    if (n === 0) return this.special('inside');
    return (await this.page(2 * n - 1)).maps;
  }

  info(p) { return this.cache.get(this._key(p)) || null; }

  /** Drop every typeset page (after the page resolution changed). */
  clear() {
    for (const v of this.cache.values()) this._dispose(v);
    this.cache.clear();
    this.pending.clear();
  }

  prefetch(pages) {
    for (const p of pages) if (p >= 1 && p <= TOTAL_PAGES && !this.cache.has(this._key(p))) this.page(p).catch(() => {});
  }

  /** The page without its text, for a resting page whose Arabic is vector text on top. */
  bareMaps(p) {
    const e = this.info(p);
    if (!e) return null;
    e.bareMaps ??= { map: this._tex(e.bare) };
    return e.bareMaps;
  }

  /** Free the text-less textures of pages no longer lying open (they are rebuilt on demand). */
  trimBare(keep) {
    for (const e of this.cache.values()) {
      if (e.bareMaps && !keep.includes(e.page)) { e.bareMaps.map.dispose(); e.bareMaps = null; }
    }
  }

  _dispose(e) {
    e.maps.map.userData.mirror?.dispose();
    e.maps.map.dispose();
    e.bareMaps?.map.dispose();
  }
}

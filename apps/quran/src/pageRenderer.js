// Draws mushaf pages (Madani 15-line layout), covers and title pages onto canvases.
import { QCF_FONT, SURAH_NAME_FONT } from './quranApi.js';
export const PW = 1560;
export const PH = 1856;
// Page zones in logical px. A right-hand page has the spine at x = 0 and its translation column on the
// outer (right) edge; a left-hand page is the mirror image. The header and footer bands carry the page's
// controls, which the app lays over the page as DOM (see PAGE_ZONES).
const MI = 100;   // spine-side margin
const MO = 90;    // outer margin
const AW = 990;   // Arabic text block width
const GAP = 50;   // between the Arabic block and the translation column
const TW = PW - MI - MO - AW - GAP;
const MT = 236;   // top of the 15-line grid
const MB = 196;   // below the grid
const LINES = 15;
const MX = 118;   // title page margin

/** Zones of a page ('right' | 'left') in logical px, for drawing and for the DOM overlay. */
export function pageZones(side) {
  const r = side === 'right';
  return {
    arabic: r ? [MI, MI + AW] : [PW - MI - AW, PW - MI],
    trans: r ? [MI + AW + GAP, PW - MO] : [MO, MO + TW],
    content: r ? [MI, PW - MO] : [MO, PW - MI],
    head: [64, 182],
    body: [MT - 10, PH - MB + 6],
    foot: [PH - 158, PH - 62],
  };
}

const INK = '#1a1710';
const GOLD = '#b8891f';
const GOLD_DK = '#8a6717';
const GOLD_LT = '#e6cb78';
const GREEN = '#164a34';
const CREAM = '#f7efdb';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

// ---------- scripts ----------
// Fallback text faces (used only if a page's QCF glyph font cannot be loaded): KFGQPC Uthmanic Hafs.
// cap = font size as a fraction of the line height; base = baseline position within the line; stroke = extra weight.
export const SCRIPTS = {
  uthmani: { family: '"UthmanicHafs", "Amiri Quran"', weight: '', label: 'Uthmani', cap: 0.62, base: 0.64, stroke: 0.008 },
  tajweed: { family: '"UthmanicHafs", "Amiri Quran"', weight: '', label: 'Tajweed', cap: 0.62, base: 0.64, stroke: 0.008 },
};
/** Supersampling of the page texture: sharper strokes when the book is viewed up close. */
// Texture px per logical page px. main.js sets it from the page's size on screen (device px) so a resting page
// maps one texel to one screen pixel: sharper text than a fixed size, and no larger than needed.
export let PAGE_SCALE = 1;
export function setPageScale(s) { PAGE_SCALE = s; }
export const TAJWEED_COLORS = {
  ham_wasl: '#8c8c8c', silent: '#8c8c8c', slnt: '#8c8c8c', laam_shamsiyah: '#8c8c8c',
  madda_normal: '#537FFF', madda_permissible: '#4050FF', madda_necessary: '#000EBC', madda_obligatory: '#2144C1',
  qalaqah: '#DD0008', ikhafa_shafawi: '#D500B7', ikhafa: '#9400A8', idgham_shafawi: '#58B800', iqlab: '#26BFFD',
  idgham_ghunnah: '#169777', idgham_wo_ghunnah: '#169200', idgham_mutajanisayn: '#A1A1A1', idgham_mutaqaribayn: '#A1A1A1',
  ghunnah: '#FF7E1E',
};
// Hafs draws the ayah medallion itself from the bare Arabic-Indic digits.
export const markerText = (n) => arDigits(n);
const fontOf = (script, size) => `${SCRIPTS[script].weight} ${size}px ${SCRIPTS[script].family}`.trim();

// ---------- King Fahd Complex page fonts ----------
// Each Madani page has its own QPC font in which every word is one glyph drawn by the Complex's
// calligraphers, so the page reads exactly like the printed mushaf. The tajweed build carries the
// rule colours in the font itself (COLR/CPAL).
/** Metrics for glyph pages: font size and baseline as fractions of the line height. */
const GLYPH = { cap: 0.62, base: 0.7 };
const qcfFonts = new Map();
/** Loads the page font; resolves to its family name, or null if it could not be fetched. */
export function loadQcf(page, tajweed = false) {
  const family = `QCF4${tajweed ? 'T' : 'P'}${page}`;
  if (qcfFonts.has(family)) return qcfFonts.get(family);
  const job = (async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const face = new FontFace(family, `url(${QCF_FONT(page, tajweed)})`, { display: 'block' });
        await face.load();
        document.fonts.add(face);
        return family;
      } catch { await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
    }
    qcfFonts.delete(family);
    return null;
  })();
  qcfFonts.set(family, job);
  return job;
}

// Arabic joining helpers: split a word into coloured runs without breaking letter shaping.
const RIGHT_ONLY = new Set([...'اأإآٱدذرزوؤةىءٲٳۈۉۇۆۊۋےڈڑژ']);
const isLetter = (ch) => /[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF]/.test(ch);
const firstBase = (t) => { for (const ch of t) if (isLetter(ch)) return ch; return null; };
const lastBase = (t) => { let r = null; for (const ch of t) if (isLetter(ch)) r = ch; return r; };
const joinsLeft = (ch) => ch && ch !== 'ء' && !RIGHT_ONLY.has(ch);

/** Tokens for a tajweed word: [{text (with ZWJ where needed), color}] */
export function tajweedTokens(runs) {
  // merge runs that carry no base letter (pure diacritics) into the previous run
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && !firstBase(r.t)) last.t += r.t;
    else merged.push({ t: r.t, c: r.c });
  }
  return merged.map((r, i) => {
    const prev = merged[i - 1], next = merged[i + 1];
    const fb = firstBase(r.t), lb = lastBase(r.t);
    const before = prev && fb && fb !== 'ء' && joinsLeft(lastBase(prev.t));
    const after = next && joinsLeft(lb) && firstBase(next.t) && firstBase(next.t) !== 'ء';
    return { text: (before ? '\u200D' : '') + r.t + (after ? '\u200D' : ''), color: TAJWEED_COLORS[r.c] || null };
  });
}

// KFGQPC Hafs draws U+06DF (small rounded zero) as a placeholder circle; it expects U+06E1 for the silent-letter mark.
const forHafs = (t) => t.replace(/\u06DF/g, '\u06E1');

function wordTokens(w, script) {
  if (script === 'tajweed' && w.tj) return tajweedTokens(w.tj).map((t) => ({ ...t, text: forHafs(t.text) }));
  return [{ text: forHafs(w.ar), color: null }];
}

function measureTokens(ctx, tokens) {
  let sum = 0;
  for (const t of tokens) { t.w = ctx.measureText(t.text).width; sum += t.w; }
  return sum;
}

/** Draw a word's tokens right-to-left ending at xRight. Slight stroke adds weight for legibility. */
function drawTokens(ctx, tokens, xRight, y, stroke = true) {
  let x = xRight;
  for (const t of tokens) {
    ctx.fillStyle = t.color || INK;
    ctx.strokeStyle = t.color || INK;
    if (stroke) ctx.strokeText(t.text, x, y);
    ctx.fillText(t.text, x, y);
    x -= t.w;
  }
}
export const arDigits = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);
export const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';

export async function ensureFonts() {
  await Promise.all([
    document.fonts.load('48px "Amiri Quran"'),
    document.fonts.load('48px "Amiri"'),
    document.fonts.load('bold 48px "Amiri"'),
    document.fonts.load('500 16px "Inter"'),
    document.fonts.load('48px "UthmanicHafs"'),
    loadSurahNames(),
    loadBand(),
  ]);
}

function makeCanvas(w = PW, h = PH) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const smooth = (t) => t * t * (3 - 2 * t);

// ---------- paper ----------
let paperBase = null;
function paperBg() {
  if (paperBase) return paperBase;
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, PW, PH);
  const img = ctx.getImageData(0, 0, PW, PH);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.7;
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#8a6a3a';
  for (let i = 0; i < 160; i++) {
    ctx.beginPath();
    const x = Math.random() * PW, y = Math.random() * PH;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  paperBase = c;
  return c;
}

function spineShade(ctx, side) {
  const g = side === 'right'
    ? ctx.createLinearGradient(0, 0, 170, 0)
    : ctx.createLinearGradient(PW, 0, PW - 170, 0);
  g.addColorStop(0, 'rgba(70,45,15,0.26)');
  g.addColorStop(0.45, 'rgba(70,45,15,0.07)');
  g.addColorStop(1, 'rgba(70,45,15,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PW, PH);
}

// ---------- monochrome line-art borders (after the reference corner set) ----------
const LINE = 'rgba(26,23,16,0.9)';
const LINE_SOFT = 'rgba(26,23,16,0.55)';

/** Walk the four sides of a rectangle, calling draw(ctx) at each step with the axis along the side. */
function alongRect(ctx, x0, y0, w, h, step, draw) {
  const sides = [
    [x0, y0, w, 0],         // top, left→right
    [x0 + w, y0, 0, h],     // right, top→bottom
    [x0 + w, y0 + h, -w, 0],// bottom
    [x0, y0 + h, 0, -h],    // left
  ];
  for (const [sx, sy, dx, dy] of sides) {
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(len / step));
    const ang = Math.atan2(dy, dx);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      ctx.save();
      ctx.translate(sx + dx * t, sy + dy * t);
      ctx.rotate(ang);
      draw(ctx, i, n, len / n);
      ctx.restore();
    }
  }
}

function diamond(ctx, r, fill) {
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
  if (fill) ctx.fill(); else ctx.stroke();
}

/** Ornate frame for the opening pages: leaf-and-cross band outside, lozenge band inside, knot corners. */
function drawOrnateFrame(ctx, x0, y0, w, h) {
  ctx.save();
  ctx.strokeStyle = LINE; ctx.fillStyle = LINE; ctx.lineJoin = 'round';
  ctx.lineWidth = 2.6; ctx.strokeRect(x0, y0, w, h);
  ctx.lineWidth = 1; ctx.strokeRect(x0 + 7, y0 + 7, w - 14, h - 14);
  ctx.lineWidth = 1; ctx.strokeRect(x0 + 62, y0 + 62, w - 124, h - 124);
  ctx.lineWidth = 2; ctx.strokeRect(x0 + 68, y0 + 68, w - 136, h - 136);
  // outer band: pointed leaves alternating with crosses (reference row 4)
  alongRect(ctx, x0 + 34, y0 + 34, w - 68, h - 68, 52, (c, i, n, step) => {
    if (i === n) return;
    c.lineWidth = 1.5;
    if (i % 2 === 0) {
      // leaf pair pointing both ways
      for (const d of [-1, 1]) {
        c.beginPath();
        c.moveTo(0, 0);
        c.quadraticCurveTo(d * 9, -10, d * 20, 0);
        c.quadraticCurveTo(d * 9, 10, 0, 0);
        c.closePath(); c.stroke();
        c.beginPath(); c.moveTo(d * 4, 0); c.lineTo(d * 15, 0); c.stroke();
      }
    } else {
      // cross of four small petals
      for (let k = 0; k < 4; k++) {
        c.save(); c.rotate((k * Math.PI) / 2);
        c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(4, -7, 0, -12); c.quadraticCurveTo(-4, -7, 0, 0); c.closePath(); c.fill();
        c.restore();
      }
    }
    // dotted rails
    const gap = step;
    for (let d = 26; d < gap - 20; d += 8) { c.beginPath(); c.arc(d, -12, 1, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(d, 12, 1, 0, Math.PI * 2); c.fill(); }
  });
  // inner band: small lozenges
  alongRect(ctx, x0 + 48, y0 + 48, w - 96, h - 96, 26, (c, i, n) => {
    if (i === n) return;
    c.lineWidth = 1;
    if (i % 2 === 0) diamond(c, 4, true); else { c.beginPath(); c.arc(0, 0, 1.4, 0, Math.PI * 2); c.fill(); }
  });
  // knot corners
  for (const [cx, cy, sx, sy] of [[x0 + 34, y0 + 34, 1, 1], [x0 + w - 34, y0 + 34, -1, 1], [x0 + 34, y0 + h - 34, 1, -1], [x0 + w - 34, y0 + h - 34, -1, -1]]) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(sx, sy);
    ctx.fillStyle = CREAM; ctx.fillRect(-24, -24, 48, 48);
    ctx.fillStyle = LINE; ctx.strokeStyle = LINE; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.stroke();
    diamond(ctx, 6, true);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * 14.5, Math.sin(a) * 14.5, 1.6, 0, Math.PI * 2); ctx.fill(); }
    // scroll into the corner
    ctx.beginPath(); ctx.moveTo(-18, -18); ctx.quadraticCurveTo(-30, -18, -30, -30); ctx.quadraticCurveTo(-18, -30, -18, -18); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ---------- surah heading band (monochrome cartouche from quran-madina-html) ----------
let bandImage = null;
const bandCache = new Map();
function loadBand() {
  if (bandImage) return Promise.resolve(bandImage);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { bandImage = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = import.meta.env.BASE_URL + 'sura-border.svg';
  });
}
function tintedBand(w, h) {
  const key = `${w}x${h}`;
  if (bandCache.has(key)) return bandCache.get(key);
  if (!bandImage) return null;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(bandImage, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);
  bandCache.set(key, c);
  return c;
}

// Surah names in QUL's V4 surah-name font: ligatures 'surah001'…'surah114' and 'surah-icon' (the word سورة).
let surahNames = null;
function loadSurahNames() {
  if (surahNames !== null) return Promise.resolve(surahNames);
  const face = new FontFace('SurahNameV4', `url(${SURAH_NAME_FONT})`, { display: 'block' });
  return face.load().then(() => { document.fonts.add(face); surahNames = 'SurahNameV4'; return surahNames; })
    .catch(() => { surahNames = ''; return ''; });
}

const BAND_ASPECT = 8.16;          // sura-border.svg viewBox 16320 × 2000
const BAND_STRETCH = [0.38, 0.62]; // the straight rules of the central cartouche: the only part that stretches

/** Surah heading: the cartouche band spans the whole text block, knots at both ends kept to shape. */
function drawHeader(ctx, chapter, y, lh, size, x0, w) {
  const bh = lh * 0.96;
  const nat = bh * BAND_ASPECT;
  const by = y + (lh - bh) / 2;
  const cx = x0 + w / 2;
  const band = tintedBand(Math.round(Math.min(nat, w) * PAGE_SCALE), Math.round(bh * PAGE_SCALE));
  ctx.save();
  if (band && nat > w) ctx.drawImage(band, x0, by, w, bh);
  else if (band) {
    const sw = band.width, sh = band.height;
    const a = Math.round(BAND_STRETCH[0] * sw), b = Math.round(BAND_STRETCH[1] * sw);
    const left = (a / sw) * nat, right = ((sw - b) / sw) * nat;
    ctx.drawImage(band, 0, 0, a, sh, x0, by, left + 0.5, bh);
    ctx.drawImage(band, a, 0, b - a, sh, x0 + left, by, w - left - right, bh);
    ctx.drawImage(band, b, 0, sw - b, sh, x0 + w - right - 0.5, by, right + 0.5, bh);
  } else { ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.strokeRect(x0, by + bh * 0.15, w, bh * 0.7); }
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  if (surahNames) {
    // drawn left to right: the name, then سورة on its right, so it reads «سورة …»
    ctx.font = `${Math.round(bh * 1.0)}px "${surahNames}"`;
    ctx.direction = 'ltr'; ctx.textBaseline = 'middle';
    ctx.fillText(`surah${String(chapter.id).padStart(3, '0')} surah-icon`, cx, by + bh * 0.5);
  } else {
    ctx.font = `bold ${Math.round(size * 0.9)}px "Amiri"`;
    ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
    ctx.fillText(`سُورَةُ ${chapter.name_arabic}`, cx, by + bh / 2 - size * 0.05);
  }
  ctx.restore();
}

/**
 * Build the 15 rows of a page from the API's per-word line numbers.
 */
function buildRows(pageNo, data, chapters, script = 'uthmani') {
  const rows = Array.from({ length: LINES + 1 }, () => null); // 1-based
  const verses = data.verses;
  verses.forEach((v, vi) => {
    for (const w of v.words) {
      const L = w.line;
      if (L < 1 || L > LINES) continue;
      if (!rows[L] || rows[L].kind !== 'words') rows[L] = { kind: 'words', items: [], line: L };
      if (w.end) rows[L].items.push({ kind: 'marker', text: markerText(v.ayah), g: w.g, vi, last: v.ayah === v.chapter.verses_count });
      else rows[L].items.push({ kind: 'word', word: w, vi });
    }
    if (v.ayah === 1) {
      const L = v.words[0]?.line;
      if (L) {
        const hasBasmala = v.surah !== 1 && v.surah !== 9;
        if (hasBasmala) {
          if (L - 2 >= 1) rows[L - 2] = { kind: 'header', chapter: v.chapter };
          if (L - 1 >= 1) rows[L - 1] = { kind: 'basmala' };
        } else if (L - 1 >= 1) rows[L - 1] = { kind: 'header', chapter: v.chapter };
      }
    }
  });
  // A surah whose header sits at the bottom of this page but whose text starts on the next.
  const last = verses[verses.length - 1];
  const nextCh = chapters?.[last.surah];
  if (nextCh && nextCh.pages[0] === pageNo && !verses.some((v) => v.surah === nextCh.id)) {
    let lastUsed = 0;
    for (let i = 1; i <= LINES; i++) if (rows[i]) lastUsed = i;
    if (lastUsed + 1 <= LINES) rows[lastUsed + 1] = { kind: 'header', chapter: nextCh };
    if (lastUsed + 2 <= LINES && nextCh.id !== 9) rows[lastUsed + 2] = { kind: 'basmala' };
  }
  return rows;
}

// ---------- kashida (tatweel) justification ----------
const KASHIDA_AFTER = new Set([...'بتثجحخسشصضطظعغفقكلمنهيئى']);
const LAM_ALEF_SECOND = new Set([...'اأإآٱ']);
const isMark = (ch) => /[ً-ٰٟۖ-ۭٕٖٓٔٗ٘ٙٚٛ]/.test(ch);
const isTransparent = (ch) => isMark(ch) || ch === '‍' || ch === '‌';

/** Index in `text` after which tatweels can be inserted, or -1. */
function kashidaPoint(text) {
  const chars = [...text];
  let best = -1;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (!KASHIDA_AFTER.has(ch)) continue;
    // next base letter
    let j = i + 1;
    while (j < chars.length && isTransparent(chars[j])) j++;
    if (j >= chars.length) continue;
    const nx = chars[j];
    if (!isLetter(nx) || nx === 'ء') continue;
    if (ch === 'ل' && LAM_ALEF_SECOND.has(nx)) continue;
    if (nx === 'ـ') continue; // already elongated here
    best = j; // insert right before the next base letter (after the marks)
  }
  if (best < 0) return -1;
  // convert char index to string offset
  return chars.slice(0, best).join('').length;
}

/** Insert `count` tatweels into a word's tokens at its kashida point. Returns true if inserted. */
function insertKashida(tokens, count) {
  if (count <= 0) return false;
  const full = tokens.map((t) => t.text).join('');
  const at = kashidaPoint(full);
  if (at <= 0) return false;
  let off = 0;
  for (const t of tokens) {
    const len = t.text.length;
    if (at <= off + len) {
      const k = at - off;
      if (k === 0) continue; // boundary: put the tatweel at the end of the previous token instead
      t.text = t.text.slice(0, k) + 'ـ'.repeat(count) + t.text.slice(k);
      return true;
    }
    off += len;
  }
  return false;
}

/**
 * Render one mushaf page.
 * `canvas` is the whole page (used while a leaf turns); `bare` is the same paper and ornaments without the
 * text, for a resting page whose Arabic is drawn as vector text over it (see ArabicLayer in pageUi.js)
 * from `layout`: every run of text with its font, size, anchor and baseline in logical page px.
 * @returns {{canvas:HTMLCanvasElement, bare:HTMLCanvasElement, hits:Array<{x,y,w,h,vi}>, layout:object}}
 */
export function renderPage(pageNo, data, chapters, opts = {}) {
  const { script = 'uthmani', glyph = null, basmala = null } = opts;
  // glyph pages: every word (and ayah marker) is a single glyph of this page's QCF font
  const G = glyph && data.verses.every((v) => v.words.every((w) => w.g)) ? glyph : null;
  const fontAt = (sz) => (G ? `${sz}px "${G}"` : fontOf(script, sz));
  const M = G ? GLYPH : SCRIPTS[script];
  const strokeW = G ? 0 : SCRIPTS[script].stroke;
  const side = pageNo % 2 === 1 ? 'right' : 'left';
  const framed = pageNo <= 2;
  const c = makeCanvas(Math.round(PW * PAGE_SCALE), Math.round(PH * PAGE_SCALE));
  const ctx = c.getContext('2d');
  ctx.scale(PAGE_SCALE, PAGE_SCALE);
  ctx.drawImage(paperBg(), 0, 0);
  spineShade(ctx, side);

  const verses = data.verses;
  const Z = pageZones(side);
  // the opening pages sit narrower inside their ornate frame
  const inset = framed ? 90 : 0;
  const ax0 = Z.arabic[0] + inset, ax1 = Z.arabic[1] - inset;
  const width = ax1 - ax0;
  const avail = PH - MT - MB;
  const lh = avail / LINES;
  const useKashida = !G;

  const rows = buildRows(pageNo, data, chapters, script);

  let gridTop = MT;
  if (framed) {
    // the opening pages fill only some of the 15 lines (lines 8–15 in the V2 layout): centre those in the frame
    let first = LINES, last = 1;
    for (let L = 1; L <= LINES; L++) if (rows[L]) { first = Math.min(first, L); last = Math.max(last, L); }
    const used = Math.max(1, last - first + 1);
    const blockTop = MT + (avail - used * lh) / 2;
    gridTop = blockTop - (first - 1) * lh;
    drawOrnateFrame(ctx, Z.arabic[0] - 6, blockTop - lh * 1.05, AW + 12, used * lh + lh * 2.1);
  }

  // ---- choose the page font size from the natural widths of the word rows
  const REF = 40;
  ctx.font = fontAt(REF);
  const GAP_K = G ? 0.1 : 0.3;   // QCF glyphs carry their own side bearings
  const gapRef = REF * GAP_K;
  const fitSizes = [];
  for (const r of rows) {
    if (!r || r.kind !== 'words') continue;
    let nat = 0;
    for (const it of r.items) {
      it.tokens = G
        ? [{ text: it.kind === 'word' ? it.word.g : it.g, color: null }]
        : it.kind === 'word' ? wordTokens(it.word, script) : [{ text: it.text, color: null }];
      nat += measureTokens(ctx, it.tokens);
    }
    nat += (r.items.length - 1) * gapRef;
    r.natRef = nat;
    fitSizes.push((REF * width) / nat);
  }
  fitSizes.sort((a, b) => a - b);
  const cap = lh * M.cap;
  const q = fitSizes.length ? fitSizes[Math.floor(fitSizes.length * 0.25)] : cap;
  // glyph lines are set to the full measure in print: size to the longest line rather than squeeze it
  const size = Math.min(cap, G && fitSizes.length ? Math.max(fitSizes[0], q * 0.88) : q);
  const gap = size * GAP_K;
  ctx.font = fontAt(size);
  const kashidaUnit = Math.max(1, ctx.measureText('بـب').width - ctx.measureText('بب').width);

  // ---- position items
  const items = [];
  for (let L = 1; L <= LINES; L++) {
    const r = rows[L];
    if (!r) continue;
    const y = gridTop + (L - 1) * lh;
    r.y = y;
    if (r.kind !== 'words') continue;
    ctx.font = fontAt(size);
    const measureRow = () => {
      let sum = 0;
      for (const it of r.items) { it.w = measureTokens(ctx, it.tokens); sum += it.w; }
      return sum;
    };
    let sum = measureRow();
    const n = r.items.length;
    let natural = sum + (n - 1) * gap;
    const endsSurah = r.items[n - 1].kind === 'marker' && r.items[n - 1].last;
    const words = r.items.filter((it) => it.kind === 'word').length;
    const centre = endsSurah || natural < width * 0.5 || framed || words <= 2;
    // kashida: elongate letters before widening gaps, as the printed mushaf does
    if (!centre && useKashida && natural < width) {
      const needed = Math.min(Math.ceil((width - natural) / kashidaUnit), r.items.length * 4);
      const eligible = r.items.filter((it) => it.kind === 'word' && kashidaPoint(it.tokens.map((t) => t.text).join('')) > 0);
      if (needed > 0 && eligible.length) {
        const per = Math.floor(needed / eligible.length);
        let extra = needed - per * eligible.length;
        for (const it of eligible) {
          const cnt = Math.min(6, per + (extra > 0 ? 1 : 0));
          if (extra > 0) extra--;
          if (cnt > 0) insertKashida(it.tokens, cnt);
        }
        sum = measureRow();
        natural = sum + (n - 1) * gap;
      }
    }
    let k = 1, g = gap, startX = ax1;
    if (natural > width) k = width / natural;
    else if (centre) startX = ax1 - (width - natural) / 2;
    else if (n > 1) g = gap + (width - natural) / (n - 1);
    r.k = k;
    r.baseline = y + lh * M.base;
    let x = 0;
    for (const it of r.items) {
      it.x = startX - (x + it.w) * k;
      it.wk = it.w * k;
      it.y = y; it.h = lh; it.g = g * k;
      items.push(it);
      x += it.w + g;
    }
  }

  // ---- ornaments (surah bands) go on both versions; the text only on the full one
  for (let L = 1; L <= LINES; L++) {
    const r = rows[L];
    if (r?.kind === 'header') drawHeader(ctx, r.chapter, r.y, lh, size, ax0, width);
  }
  const bare = makeCanvas(c.width, c.height);
  bare.getContext('2d').drawImage(c, 0, 0);

  // ---- draw the text, noting every run for the vector layer
  const texts = [];
  const family = G ? `"${G}"` : SCRIPTS[script].family;
  for (let L = 1; L <= LINES; L++) {
    const r = rows[L];
    if (!r || r.kind === 'header') continue;
    if (r.kind === 'basmala') {
      ctx.save();
      ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = INK; ctx.strokeStyle = INK;
      if (G && basmala) {
        // the basmala in the calligraphy of page 1
        const fs = Math.round(size * 1.12);
        ctx.font = `${fs}px "${basmala.family}"`;
        const bw = ctx.measureText(basmala.text).width;
        const sx = bw > width ? width / bw : 1;
        ctx.translate((ax0 + ax1) / 2, r.y + lh * M.base);
        ctx.scale(sx, 1);
        ctx.fillText(basmala.text, 0, 0);
        texts.push({ t: basmala.text, x: (ax0 + ax1) / 2, y: r.y + lh * M.base, sx, font: `"${basmala.family}"`, size: fs, anchor: 'middle', stroke: 0, color: INK, vi: -1 });
      } else {
        const fs = Math.round(size * 1.04);
        ctx.font = fontOf(script, fs);
        ctx.lineWidth = size * SCRIPTS[script].stroke;
        const bas = BASMALA;
        const bw = ctx.measureText(bas).width;
        const sx = bw > width ? width / bw : 1;
        ctx.translate((ax0 + ax1) / 2, r.y + lh * SCRIPTS[script].base);
        ctx.scale(sx, 1);
        ctx.strokeText(bas, 0, 0);
        ctx.fillText(bas, 0, 0);
        texts.push({ t: bas, x: (ax0 + ax1) / 2, y: r.y + lh * SCRIPTS[script].base, sx, font: SCRIPTS[script].family, size: fs, anchor: 'middle', stroke: size * SCRIPTS[script].stroke, color: INK, vi: -1 });
      }
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.font = fontAt(size);
    ctx.fillStyle = INK;
    if (strokeW) ctx.lineWidth = size * strokeW;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'right'; ctx.direction = 'rtl'; ctx.textBaseline = 'alphabetic';
    ctx.translate(0, r.baseline);
    ctx.scale(r.k, 1);
    for (const it of r.items) {
      const xr = (it.x + it.wk) / r.k;
      drawTokens(ctx, it.tokens, xr, 0, !!strokeW);
      let x = it.x + it.wk;
      for (const t of it.tokens) {
        texts.push({ t: t.text, x, y: r.baseline, sx: r.k, font: family, size, anchor: 'end', stroke: strokeW ? size * strokeW : 0, color: t.color || INK, vi: it.vi });
        x -= t.w * r.k;
      }
    }
    ctx.restore();
  }

  const hits = items.map((it) => ({ x: it.x - it.g / 2, y: it.y, w: it.wk + it.g, h: it.h, vi: it.vi }));
  // the ayah highlight: one rounded box per word, as the page used to paint it
  const marks = items.map((it) => ({ x: it.x - it.g / 2, y: it.y + it.h * 0.06, w: it.wk + it.g, h: it.h * 0.88, vi: it.vi }));
  return { canvas: c, bare, hits, size, layout: { texts, marks } };
}

export function hitTest(hits, cx, cy) {
  for (const h of hits) {
    if (cx >= h.x && cx <= h.x + h.w && cy >= h.y && cy <= h.y + h.h) return h.vi;
  }
  return -1;
}

// ---------- leather & cover ----------
function leatherGrain(ctx, w, h, base, strength = 1) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // pores
  for (let i = 0; i < w * h * 0.012; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 1 + Math.random() * 2.2;
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${0.10 * strength})` : `rgba(255,255,255,${0.06 * strength})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + Math.random()), Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  // creases
  ctx.lineWidth = 1;
  for (let i = 0; i < w * 0.25; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.08 * strength})`;
    ctx.beginPath();
    let x = Math.random() * w, y = Math.random() * h;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 30; y += (Math.random() - 0.5) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18 * strength;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function petal(ctx, cx, cy, r0, r1, a, halfW) {
  // pointed leaf from radius r0 to r1 at angle a
  const px = Math.cos(a), py = Math.sin(a), nx = -py, ny = px;
  ctx.beginPath();
  ctx.moveTo(cx + px * r0, cy + py * r0);
  ctx.quadraticCurveTo(cx + px * (r0 + r1) / 2 + nx * halfW, cy + py * (r0 + r1) / 2 + ny * halfW, cx + px * r1, cy + py * r1);
  ctx.quadraticCurveTo(cx + px * (r0 + r1) / 2 - nx * halfW, cy + py * (r0 + r1) / 2 - ny * halfW, cx + px * r0, cy + py * r0);
  ctx.closePath();
}

function starPoly(ctx, cx, cy, n, rOut, rIn, rot = 0) {
  ctx.beginPath();
  for (let k = 0; k < n * 2; k++) {
    const a = rot + (k / (n * 2)) * Math.PI * 2;
    const r = k % 2 ? rIn : rOut;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Draws the gold tooling of the cover onto ctx (white on transparent). */
function drawCoverOrnament(ctx) {
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineJoin = 'round';
  // outer rules
  ctx.lineWidth = 7; ctx.strokeRect(58, 58, PW - 116, PH - 116);
  ctx.lineWidth = 2; ctx.strokeRect(76, 76, PW - 152, PH - 152);
  ctx.lineWidth = 2; ctx.strokeRect(150, 150, PW - 300, PH - 300);
  ctx.lineWidth = 1.2; ctx.strokeRect(162, 162, PW - 324, PH - 324);
  // running border motif between 90 and 140
  const mid = 113, step = 46;
  const motif = (x, y, ang) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(0, -12, 14, 0); ctx.quadraticCurveTo(0, 12, -14, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(-21, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(21, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-23, -9); ctx.quadraticCurveTo(-8, -18, 0, -9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 9); ctx.quadraticCurveTo(8, 18, 23, 9); ctx.stroke();
    ctx.restore();
  };
  for (let x = mid + step; x < PW - mid - step / 2; x += step) { motif(x, mid, 0); motif(x, PH - mid, Math.PI); }
  for (let y = mid + step; y < PH - mid - step / 2; y += step) { motif(mid, y, -Math.PI / 2); motif(PW - mid, y, Math.PI / 2); }
  for (const [x, y] of [[mid, mid], [PW - mid, mid], [mid, PH - mid], [PW - mid, PH - mid]]) {
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
  }
  // corner quarter-shamsas
  const cr = 230;
  for (const [cx, cy, a0] of [[162, 162, 0], [PW - 162, 162, Math.PI / 2], [PW - 162, PH - 162, Math.PI], [162, PH - 162, -Math.PI / 2]]) {
    ctx.save();
    ctx.beginPath(); ctx.rect(162, 162, PW - 324, PH - 324); ctx.clip();
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      petal(ctx, cx, cy, 40, cr, a, 22); ctx.fill();
      petal(ctx, cx, cy, 60, cr - 30, a, 10); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(); ctx.globalCompositeOperation = 'source-over';
    }
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, cr + 14, a0, a0 + Math.PI / 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 36, a0, a0 + Math.PI / 2); ctx.stroke();
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (cr + 30), cy + Math.sin(a) * (cr + 30), 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // central shamsa
  const cx = PW / 2, cy = PH / 2 + 60;
  const R = 300;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    petal(ctx, cx, cy, R - 10, R + 95, a, 24); ctx.fill();
    petal(ctx, cx, cy, R + 6, R + 70, a, 9); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(); ctx.globalCompositeOperation = 'source-over';
    const fx = cx + Math.cos(a + Math.PI / 16) * (R + 60), fy = cy + Math.sin(a + Math.PI / 16) * (R + 60);
    ctx.beginPath(); ctx.arc(fx, fy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (R + 118), cy + Math.sin(a) * (R + 118), 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R - 16, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3; starPoly(ctx, cx, cy, 12, R - 30, R - 60); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, R - 78, 0, Math.PI * 2); ctx.stroke();
  // small rosettes between the star points
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (R - 45), cy + Math.sin(a) * (R - 45), 5, 0, Math.PI * 2); ctx.fill();
  }
  // title inside the shamsa, on a clear field
  ctx.font = 'bold 150px "Amiri"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
  ctx.fillText('ٱلْقُرْءَانُ', cx, cy - 78);
  ctx.fillText('ٱلْكَرِيمُ', cx, cy + 84);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 120, cy + 2); ctx.lineTo(cx + 120, cy + 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy + 2, 7, 0, Math.PI * 2); ctx.fill();
  // top cartouche with the title
  const ty = 400;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 330, ty);
  ctx.quadraticCurveTo(cx - 330, ty - 70, cx - 240, ty - 70);
  ctx.lineTo(cx + 240, ty - 70);
  ctx.quadraticCurveTo(cx + 330, ty - 70, cx + 330, ty);
  ctx.quadraticCurveTo(cx + 330, ty + 70, cx + 240, ty + 70);
  ctx.lineTo(cx - 240, ty + 70);
  ctx.quadraticCurveTo(cx - 330, ty + 70, cx - 330, ty);
  ctx.closePath(); ctx.stroke();
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * 350, ty, 9, 0, Math.PI * 2); ctx.fill(); }
  ctx.font = '76px "Amiri Quran"';
  ctx.fillText(BASMALA, cx, ty + 2);
  // bottom cartouche
  const by = PH - 400;
  ctx.beginPath();
  ctx.moveTo(cx - 260, by);
  ctx.quadraticCurveTo(cx - 260, by - 50, cx - 190, by - 50);
  ctx.lineTo(cx + 190, by - 50);
  ctx.quadraticCurveTo(cx + 260, by - 50, cx + 260, by);
  ctx.quadraticCurveTo(cx + 260, by + 50, cx + 190, by + 50);
  ctx.lineTo(cx - 190, by + 50);
  ctx.quadraticCurveTo(cx - 260, by + 50, cx - 260, by);
  ctx.closePath(); ctx.stroke();
  ctx.font = 'bold 54px "Amiri"';
  ctx.fillText('بِٱلرَّسْمِ ٱلْعُثْمَانِيِّ', cx, by + 2);
  ctx.restore();
}

/**
 * Cover material maps: colour, bump (emboss) and a packed roughness (G) / metalness (B) map.
 */
export function renderCoverMaps() {
  const orn = makeCanvas();
  drawCoverOrnament(orn.getContext('2d'));

  // colour
  const color = makeCanvas();
  const cc = color.getContext('2d');
  leatherGrain(cc, PW, PH, '#0f3a29', 1);
  const vign = cc.createRadialGradient(PW / 2, PH / 2, PH * 0.25, PW / 2, PH / 2, PH * 0.8);
  vign.addColorStop(0, 'rgba(255,255,255,0.05)');
  vign.addColorStop(1, 'rgba(0,0,0,0.38)');
  cc.fillStyle = vign; cc.fillRect(0, 0, PW, PH);
  const gold = makeCanvas();
  const gc = gold.getContext('2d');
  const gg = gc.createLinearGradient(0, 0, PW, PH);
  gg.addColorStop(0, '#f0d78a'); gg.addColorStop(0.5, '#c9a040'); gg.addColorStop(1, '#e8c86e');
  gc.fillStyle = gg; gc.fillRect(0, 0, PW, PH);
  gc.globalCompositeOperation = 'destination-in';
  gc.drawImage(orn, 0, 0);
  cc.drawImage(gold, 0, 0);

  // bump: leather grain + raised tooling
  const bump = makeCanvas();
  const bc = bump.getContext('2d');
  leatherGrain(bc, PW, PH, '#808080', 1.6);
  bc.filter = 'blur(1.2px)';
  bc.drawImage(orn, 0, 0);
  bc.filter = 'none';

  // roughness (G) / metalness (B)
  const orm = makeCanvas();
  const oc = orm.getContext('2d');
  oc.fillStyle = 'rgb(0,190,0)'; oc.fillRect(0, 0, PW, PH); // leather: rough, non-metal
  const goldOrm = makeCanvas();
  const goc = goldOrm.getContext('2d');
  goc.fillStyle = 'rgb(0,80,220)'; goc.fillRect(0, 0, PW, PH); // gold: smoother, metallic
  goc.globalCompositeOperation = 'destination-in';
  goc.drawImage(orn, 0, 0);
  oc.drawImage(goldOrm, 0, 0);

  return { color, bump, orm };
}

/** Plain leather (spine, back cover). Returns {color, bump}. */
export function renderLeatherMaps() {
  const color = makeCanvas(512, 512);
  leatherGrain(color.getContext('2d'), 512, 512, '#0f3a29', 1);
  const bump = makeCanvas(512, 512);
  leatherGrain(bump.getContext('2d'), 512, 512, '#808080', 1.6);
  return { color, bump };
}

export function renderInsideCover() {
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9dcc0';
  ctx.fillRect(0, 0, PW, PH);
  const img = ctx.getImageData(0, 0, PW, PH);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 12; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  // marbled endpaper: soft veins
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '22,74,52' : '150,110,50'},${0.08 + Math.random() * 0.12})`;
    ctx.beginPath();
    let x = Math.random() * PW, y = Math.random() * PH;
    ctx.moveTo(x, y);
    for (let k = 0; k < 14; k++) { x += (Math.random() - 0.5) * 120; y += (Math.random() - 0.5) * 60; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return c;
}

export function renderBlank() {
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.drawImage(paperBg(), 0, 0);
  return c;
}

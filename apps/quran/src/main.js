import * as THREE from 'three';
import { createScene, IS_MOBILE } from './scene.js';
import { Book, MAX_SPREAD, W as PAGE_W, H as PAGE_H, COVER_T, PAD_X, PAD_Z } from './book.js';
import { PageSource } from './pageSource.js';
import { ensureFonts, PW, PH, hitTest, pageZones, PAGE_SCALE, setPageScale } from './pageRenderer.js';
import { getChapters, getVersePage, pageToSpread, TR_EN, TR_ID, TOTAL_PAGES, JUZ_START, juzEnd, getReciters } from './quranApi.js';
import { initAudio, playFlip, playLift, playSettle, setMuted, startAmbience, setAmbienceNight, refreshAmbienceMute } from './sound.js';
import { PageUi } from './pageUi.js';
import { createReciter } from './recite.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const view = createScene(canvas);
const { renderer, scene, camera } = view;
const source = new PageSource(renderer);

const ui = {
  readingBtn: $('btnReading'), readingPop: $('readingPop'),
  tajwid: $('tajwidSwitch'), sound: $('soundSwitch'), trGroup: $('trGroup'), themeGroup: $('themeGroup'),
  close: $('btnClose'),
  credits: $('creditsDialog'), creditsBtn: $('btnCredits'), creditsClose: $('creditsClose'),
  navPop: $('navPop'), juzChips: $('juzChips'), navMarks: $('navMarks'), navSearch: $('navSearch'),
  surahList: $('surahList'), ayahList: $('ayahList'), ayahMeta: $('ayahMeta'),
  navCancel: $('navCancel'), navGo: $('navGo'), navGoLabel: $('navGoLabel'),
  player: $('player'), plPlay: $('plPlay'), plStop: $('plStop'), plReciter: $('plReciter'), plNow: $('plNow'), plSub: $('plSub'),
  recitePop: $('recitePop'), reciterOptions: $('reciterOptions'),
  pagePop: $('pagePop'), pageForm: $('pageForm'), pageInput: $('pageInput'),
  ayahBar: $('ayahBar'), abKey: $('abKey'), abPlayLabel: $('abPlayLabel'), abCopyLabel: $('abCopyLabel'),
  loading: $('loading'), loadingText: $('loadingText'),
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const TRANSLATIONS = [
  { id: TR_ID, label: 'Indonesia', sub: 'Kementerian Agama RI' },
  { id: TR_EN, label: 'English', sub: 'Saheeh International' },
];

let chapters = [];
let book = null;
let state = 'closed';      // 'closed' | 'opening' | 'reading' | 'closing'
let single = false;        // phones and portrait screens read one page at a time
let focus = 'right';       // the page in view when `single`
let selected = null;       // { key, page, vi, side }
let tr = Number(store.get('mushaf-trans')) || TR_ID;
if (!TRANSLATIONS.some((t) => t.id === tr)) tr = TR_ID;

// bookmarks: any number of pages (an older single ayah pin is carried over)
const marks = new Set();
try { for (const p of JSON.parse(store.get('mushaf-marks')) || []) if (p >= 1 && p <= TOTAL_PAGES) marks.add(p); } catch {}
try { const old = JSON.parse(store.get('mushaf-pin')); if (old?.page) { marks.add(old.page); store.del('mushaf-pin'); } } catch {}
const saveMarks = () => store.set('mushaf-marks', JSON.stringify([...marks].sort((a, b) => a - b)));
/** Where opening the mushaf lands: the last page read, else the first bookmark, else page 1. */
const startPage = () => Math.min(TOTAL_PAGES, Math.max(1, Number(store.get('mushaf-last')) || (marks.size ? Math.min(...marks) : 1)));

const pageUi = new PageUi($('pageUi'), onPageAction);

// ---------- helpers ----------
const spreadPages = (f) => (f >= 2 ? [2 * f - 3, 2 * f - 2] : []);
const sideOfPage = (p) => (p % 2 === 1 ? 'right' : 'left');
const juzOfPage = (p) => { let j = 1; for (let i = 0; i < 30; i++) if (JUZ_START[i] <= p) j = i + 1; return j; };
const surahAt = (p) => { let c = chapters[0]; for (const x of chapters) if (x.pages[0] <= p) c = x; return c; };
const onSpread = (p) => book && spreadPages(book.f).includes(p);
const currentPage = () => (single ? book.pageAt(focus) : book.pageAt('right'));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function busy(on) { document.body.classList.toggle('busy', on); }

// ---------- layout: which part of the desk the camera frames ----------
const isSingle = () => { const w = window.innerWidth, h = window.innerHeight; return w < 700 || w / h < 1.05; };
function insets() {
  const small = window.innerWidth < 700;
  return single
    ? { top: small ? 60 : 72, bottom: small ? 78 : 88, left: small ? 6 : 24, right: small ? 6 : 24 }
    : { top: 72, bottom: 86, left: 28, right: 28 };
}
function readingRect() {
  const y = COVER_T + 0.07;
  if (!single) return { x0: -(PAGE_W + PAD_X), x1: PAGE_W + PAD_X, z0: -(PAGE_H + PAD_Z) / 2, z1: (PAGE_H + PAD_Z) / 2, y };
  // one page, trimmed to its content so the text is as large as the screen allows
  const c = pageZones(focus).content;
  const trim = 34;
  const s0 = focus === 'right' ? (c[0] - trim) / PW : 1 - (c[1] + trim) / PW;
  const s1 = focus === 'right' ? (c[1] + trim) / PW : 1 - (c[0] - trim) / PW;
  const [a, b] = focus === 'right' ? [s0 * PAGE_W, s1 * PAGE_W] : [-s1 * PAGE_W, -s0 * PAGE_W];
  return { x0: a, x1: b, z0: -PAGE_H / 2 - 0.01, z1: PAGE_H / 2 + 0.01, y };
}
/** Texture scale that puts one texel on one device pixel of a page at reading size. */
function idealPageScale() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const r = readingRect(), ins = insets();
  const aw = Math.max(50, window.innerWidth - ins.left - ins.right), ah = Math.max(50, window.innerHeight - ins.top - ins.bottom);
  const k = Math.max((r.x1 - r.x0) / aw, (r.z1 - r.z0) / ah);   // world units per CSS px
  const s = ((PAGE_W / PW) / k) * dpr;
  return Math.min(IS_MOBILE ? 1.5 : 2, Math.max(0.5, Math.ceil(s * 20) / 20));
}
function applyView(dur) {
  if (state === 'reading' || state === 'opening') view.showRect(readingRect(), insets(), dur);
  else view.showDesk(dur);
}
function setFocus(side, dur = 0.7) {
  focus = side;
  if (single && (state === 'reading' || state === 'opening')) view.showRect(readingRect(), insets(), dur);
  refreshPages();
}

// ---------- boot ----------
async function init() {
  view.resize();
  single = isSingle();
  setPageScale(idealPageScale());
  view.showDesk(0);
  try {
    ui.loadingText.textContent = 'Loading fonts…';
    await ensureFonts();
    ui.loadingText.textContent = 'Loading surah index…';
    chapters = await getChapters();
    buildNavigator();
    ui.loadingText.textContent = 'Binding the mushaf…';
    book = new Book(source);
    scene.add(book.group);
    book.onFlipStart = onFlipStart;
    book.onFlipEnd = onFlipEnd;
    book.onDragStart = () => { playLift(); closePops(); };
    book.onDragCancel = () => playSettle();
    book.onChange = () => view.invalidate();
    book.layoutStatic();
    await book.applyTextures();
    ui.loading.classList.add('done');
    setTimeout(() => (ui.loading.hidden = true), 650);
    // only the spread the book will open on is typeset ahead; nothing else until it is read
    const f = pageToSpread(startPage());
    source.prefetch([2 * f - 3, 2 * f - 2]);
  } catch (e) {
    console.error(e);
    ui.loadingText.textContent = 'Could not reach the Qur’an API. Check your connection and reload.';
  }
}

// ---------- open & close ----------
async function openBook() {
  if (!book || state !== 'closed' || book.animating) return;
  wakeAudio();
  const page = startPage();
  const target = pageToSpread(page);
  focus = sideOfPage(page);
  state = 'opening';
  document.body.dataset.state = 'reading';
  ui.close.hidden = false;
  view.showRect(readingRect(), insets(), 1.6);
  busy(true);
  try { await book.goTo(target); await settled(target); } catch (e) { console.error(e); }
  busy(false);
  state = 'reading';
  refreshPages();
}

async function closeBook() {
  if (!book || state !== 'reading' || book.animating) return;
  reciter.stop();
  closePops();
  clearSelection();
  state = 'closing';
  document.body.dataset.state = 'closed';
  ui.close.hidden = true;
  view.showDesk(1.5);
  try { await book.goTo(0); await settled(0); } catch (e) { console.error(e); }
  state = 'closed';
}
ui.close.addEventListener('click', closeBook);

// ---------- flipping ----------
const flipWaiters = [];
function onFlipStart(kind, dur) {
  playFlip(kind, dur);
  closePops();
  if (selected && !reciter.playing) clearSelection();
}
let lastF = 0;
function onFlipEnd() {
  if (book.f >= 2 && state !== 'closing') saveLast();
  refreshPages();
  prefetchAround(book.f < lastF ? -1 : 1);
  lastF = book.f;
  source.trimBare(spreadPages(book.f));
  // keep the reciting (or selected) ayah highlighted when it lands on this spread
  if (selected && onSpread(selected.page)) select(selected.key, selected.page, { scroll: true });
  for (const w of flipWaiters.splice(0)) w();
}
/** Typeset the spread the reader is heading to (dir +1 forward, -1 back), and nothing further. */
function prefetchAround(dir = 1) {
  if (book.f < 2) return;
  const f = book.f + dir;
  if (f >= 2 && f <= MAX_SPREAD) source.prefetch([2 * f - 3, 2 * f - 2]);
}
/** Resolves once the book rests on spread `target` (or gives up after a while). */
function settled(target) {
  return new Promise((resolve) => {
    const deadline = performance.now() + 12000;
    const check = () => {
      if ((!book.animating && book.f === target) || performance.now() > deadline) resolve();
      else flipWaiters.push(check);
    };
    check();
  });
}

async function flipTo(target) {
  target = Math.max(2, Math.min(MAX_SPREAD, target));
  if (target === book.f) return true;
  if (book.animating) return false;
  busy(true);
  try { await book.goTo(target); await settled(target); } catch (e) { console.error(e); busy(false); return false; }
  busy(false);
  return book.f === target;
}

const reading = () => book && state === 'reading';
const saveLast = () => { if (book.f >= 2) store.set('mushaf-last', String(currentPage())); };

async function next(user = true) {
  if (!reading() || book.animating) return;
  if (user) reciter.stop();
  if (single) {
    if (focus === 'right') { setFocus('left'); saveLast(); return; }
    if (book.f >= MAX_SPREAD) return;
    focus = 'right';
    view.showRect(readingRect(), insets(), 0.95);
    await flipTo(book.f + 1);
  } else if (book.f < MAX_SPREAD) await flipTo(book.f + 1);
}
async function prev(user = true) {
  if (!reading() || book.animating) return;
  if (user) reciter.stop();
  if (single) {
    if (focus === 'left') { setFocus('right'); saveLast(); return; }
    if (book.f <= 2) return;
    focus = 'left';
    view.showRect(readingRect(), insets(), 0.95);
    await flipTo(book.f - 1);
  } else if (book.f > 2) await flipTo(book.f - 1);
}

/** Bring page p into view. */
async function goPage(p) {
  if (!reading()) return false;
  p = Math.max(1, Math.min(TOTAL_PAGES, Math.round(p)));
  const target = pageToSpread(p);
  if (single && sideOfPage(p) !== focus) {
    focus = sideOfPage(p);
    view.showRect(readingRect(), insets(), target === book.f ? 0.7 : 0.95);
  }
  if (target === book.f) { refreshPages(); saveLast(); return true; }
  return flipTo(target);
}

async function goToAyah(key) {
  try {
    const page = await getVersePage(key);
    if (!page) return;
    reciter.stop();
    const ok = await goPage(page);
    if (ok !== false) select(key, page);
  } catch (e) { console.error(e); }
}

// ---------- the page overlays ----------
function refreshPages() {
  if (!book || book.f < 2) return;
  for (const side of ['right', 'left']) {
    const p = book.pageAt(side);
    const info = source.info(p);
    if (!info) { source.page(p).then(() => refreshPages()).catch(() => {}); continue; }
    const j = juzOfPage(p), left = juzEnd(j) - p;
    const current = single ? side === focus : side === 'right';
    const meta = current ? `Juz ${j} · ${left ? `${left} page${left === 1 ? '' : 's'} left` : 'last page'}` : `Juz ${j}`;
    const canNext = single ? !(side === 'left' && book.f >= MAX_SPREAD) : book.f < MAX_SPREAD;
    const canPrev = single ? !(side === 'right' && book.f <= 2) : book.f > 2;
    pageUi.sides[side].set({ pageNo: p, verses: info.data.verses, chapters, tr, single, meta, canNext, canPrev, bookmarked: marks.has(p) });
  }
  if (selected) pageUi.setActive(selected.key, false);
}

/** Screen point (CSS px) of a page-canvas point on the resting page's actual surface. */
function pagePoint(side, cx, cy) {
  const s = side === 'right' ? (cx / PW) * PAGE_W : (1 - cx / PW) * PAGE_W;
  return view.project(side === 'right' ? s : -s, book.surfaceY(side, s), (cy / PH - 0.5) * PAGE_H);
}

/**
 * Resting pages show their Arabic as vector text over a text-less texture; while a leaf turns, or the book
 * opens or closes, the textured text takes over (Book puts the full maps back when a flip starts).
 */
let vectorText = true;   // false: textured text only (inspection hook, for comparing the two)
function placeArabic() {
  const show = vectorText && state === 'reading' && !book.animating && book.f >= 2;
  for (const side of ['right', 'left']) {
    const layer = pageUi.arabic[side];
    const p = book.f >= 2 ? book.pageAt(side) : null;
    const e = p && source.info(p);
    if (show && e) {
      layer.set(e.layout);
      layer.setActive(selected && selected.page === p ? selected.vi : -1);
      layer.place((cx, cy) => pagePoint(side, cx, cy));
      layer.show(true);
      book.setPageMaps(side, source.bareMaps(p));
    } else {
      layer.show(false);
      if (e && !book.animating) book.setPageMaps(side, e.maps);
    }
  }
}

/** Screen rectangle of a page zone given in page-canvas px. */
function zoneRect(side, [cx0, cx1], [cy0, cy1]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const cx of [cx0, cx1]) {
    for (const cy of [cy0, cy1]) {
      const q = pagePoint(side, cx, cy);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
  }
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}
function placePages() {
  const rest = state === 'reading' && !book.animating && !view.moving;
  for (const side of ['right', 'left']) {
    const visible = rest && (!single || side === focus);
    if (state === 'reading') {
      const Z = pageZones(side);
      const page = zoneRect(side, [0, PW], [PH / 2, PH / 2]);
      pageUi.sides[side].place({
        head: zoneRect(side, Z.content, Z.head),
        trans: zoneRect(side, Z.trans, Z.body),
        foot: zoneRect(side, Z.content, Z.foot),
      }, page.w);
    }
    pageUi.show(side, visible);
  }
  placeArabic();
  placeAyahBar(rest);
}

function onPageAction(act, d) {
  switch (act) {
    case 'next': next(); break;
    case 'prev': prev(); break;
    case 'verse': {
      if (selected?.key === d.key && !reciter.playing) { clearSelection(); break; }
      select(d.key, d.page, { scroll: false });
      if (reciter.playing) reciter.play(d.page, d.key);
      break;
    }
    case 'nav': openPop(ui.navPop, d.anchor, onNavOpen); break;
    case 'bookmark': toggleBookmark(d.page); break;
    case 'page': openPop(ui.pagePop, d.anchor, () => {
      ui.pageInput.value = String(d.page ?? currentPage());
      if (!IS_MOBILE) { ui.pageInput.focus(); ui.pageInput.select(); }
    }); break;
  }
}

// ---------- selection ----------
function select(key, page, { scroll = true } = {}) {
  const info = source.info(page);
  if (!info) return;
  const vi = info.data.verses.findIndex((v) => v.key === key);
  if (vi < 0) return;
  const side = sideOfPage(page);
  selected = { key, page, vi, side };   // the Arabic layer highlights it (placeArabic)
  if (onSpread(page) && !book.animating && single && side !== focus) setFocus(side);
  pageUi.setActive(key, scroll);
}
function clearSelection() {
  selected = null;
  pageUi.setActive(null, false);
}

// ---------- bookmarks (one per page) ----------
function toggleBookmark(page = book && currentPage()) {
  if (!reading() || !page) return;
  if (marks.has(page)) marks.delete(page); else marks.add(page);
  saveMarks();
  for (const s of Object.values(pageUi.sides)) if (s.pageNo === page) s.setBookmarked(marks.has(page));
}

// ---------- popovers ----------
let openEl = null, openAnchor = null;
function openPop(pop, anchor, onOpen) {
  if (openEl === pop) { closePops(); return; }
  closePops();
  pop.hidden = false;
  openEl = pop; openAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  onOpen?.();
  placePop();
}
function placePop() {
  if (!openEl) return;
  const pop = openEl, r = openAnchor.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, m = 12;
  pop.style.maxWidth = `${vw - 2 * m}px`;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const alignRight = r.left + r.width / 2 > vw / 2;
  let x = pop === ui.recitePop ? r.left + r.width / 2 - pw / 2 : alignRight ? r.right - pw : r.left;
  x = Math.max(m, Math.min(vw - pw - m, x));
  let y = r.bottom + 8;
  if (y + ph > vh - m && r.top - 8 - ph >= m) y = r.top - 8 - ph;
  y = Math.max(m, Math.min(vh - ph - m, y));
  pop.style.left = `${Math.round(x)}px`;
  pop.style.top = `${Math.round(y)}px`;
}
function closePops() {
  if (!openEl) return;
  openEl.hidden = true;
  openAnchor?.setAttribute('aria-expanded', 'false');
  openEl = openAnchor = null;
}
document.addEventListener('pointerdown', (e) => {
  if (!openEl) return;
  if (openEl.contains(e.target) || openAnchor?.contains(e.target)) return;
  closePops();
}, { capture: true });

ui.readingBtn.addEventListener('click', () => openPop(ui.readingPop, ui.readingBtn));
ui.creditsBtn.addEventListener('click', () => { closePops(); ui.credits.showModal(); });
ui.creditsClose.addEventListener('click', () => ui.credits.close());
ui.credits.addEventListener('click', (e) => { if (e.target === ui.credits) ui.credits.close(); });

// ---------- surah & ayah picker ----------
// Two lists scroll on their own (surah, then its ayat); nothing moves until "Go to …" confirms.
const pick = { surah: 1, ayah: 1, token: 0 };
function buildNavigator() {
  const chips = document.createDocumentFragment();
  for (let j = 1; j <= 30; j++) {
    const b = document.createElement('button');
    b.className = 'juz-chip';
    b.textContent = String(j);
    b.dataset.juz = String(j);
    b.setAttribute('aria-label', `Juz ${j}, page ${JUZ_START[j - 1]}`);
    chips.append(b);
  }
  ui.juzChips.replaceChildren(chips);
  const rows = document.createDocumentFragment();
  for (const c of chapters) {
    const b = document.createElement('button');
    b.className = 's-row';
    b.setAttribute('role', 'option');
    b.dataset.surah = String(c.id);
    b.innerHTML = `<span class="s-num">${c.id}</span><span class="s-name">${esc(c.name_simple)}<span class="s-ar">${esc(c.name_arabic)}</span></span><span class="s-page">${c.pages[0]}</span>`;
    rows.append(b);
  }
  ui.surahList.replaceChildren(rows);
}
function selectSurah(id, ayah = 1, scroll = false) {
  const c = chapters[id - 1];
  if (!c) return;
  pick.surah = id;
  for (const r of ui.surahList.children) r.setAttribute('aria-selected', String(Number(r.dataset.surah) === id));
  const f = document.createDocumentFragment();
  for (let a = 1; a <= c.verses_count; a++) {
    const b = document.createElement('button');
    b.className = 'a-row';
    b.setAttribute('role', 'option');
    b.dataset.ayah = String(a);
    b.textContent = String(a);
    f.append(b);
  }
  ui.ayahList.replaceChildren(f);
  ui.ayahMeta.textContent = `${c.revelation_place === 'madinah' ? 'Madinah' : 'Makkah'} · ${c.verses_count} ayat`;
  if (scroll) scrollIntoList(ui.surahList, ui.surahList.children[id - 1]);
  selectAyah(Math.min(ayah, c.verses_count), true);
}
function selectAyah(a, scroll = false) {
  pick.ayah = a;
  const row = ui.ayahList.children[a - 1];
  for (const r of ui.ayahList.children) r.setAttribute('aria-selected', String(r === row));
  if (scroll) scrollIntoList(ui.ayahList, row);
  const c = chapters[pick.surah - 1];
  const key = `${c.id}:${a}`;
  ui.navGoLabel.textContent = `Go to ${c.name_simple} ${key}`;
  const t = ++pick.token;
  getVersePage(key).then((p) => { if (t === pick.token && p) ui.navGoLabel.textContent = `Go to ${c.name_simple} ${key} · page ${p}`; }).catch(() => {});
}
function scrollIntoList(list, row) {
  if (!row) return;
  requestAnimationFrame(() => { list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2; });
}
function filterSurahs(q) {
  const query = q.trim().toLowerCase();
  const m = query.match(/^(\d{1,3})\s*[:.\s]\s*(\d{1,3})$/);
  if (m) {
    for (const r of ui.surahList.children) r.hidden = false;
    const c = chapters[Number(m[1]) - 1];
    if (c) selectSurah(c.id, Math.max(1, Number(m[2])), true);
    return;
  }
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nq = norm(query);
  let first = null;
  for (const r of ui.surahList.children) {
    const c = chapters[Number(r.dataset.surah) - 1];
    const hit = !query || String(c.id) === query || norm(c.name_simple).includes(nq) || norm(c.translated_name?.name || '').includes(nq) || c.name_arabic.includes(q.trim());
    r.hidden = !hit;
    if (hit && !first) first = c;
  }
  if (query && first) selectSurah(first.id, 1);
}
function renderMarks() {
  const list = [...marks].sort((a, b) => a - b);
  ui.navMarks.hidden = !list.length;
  ui.navMarks.replaceChildren(...list.map((p) => {
    const b = document.createElement('button');
    b.className = 'mark-chip';
    b.dataset.page = String(p);
    b.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7.5 4.5h9a1 1 0 0 1 1 1v14.2l-5.5-3.9-5.5 3.9V5.5a1 1 0 0 1 1-1z" fill="currentColor"/></svg>${esc(surahAt(p)?.name_simple || '')}<span>${p}</span>`;
    b.setAttribute('aria-label', `Bookmark: page ${p}, ${surahAt(p)?.name_simple || ''}`);
    return b;
  }));
}
function onNavOpen() {
  ui.navSearch.value = '';
  for (const r of ui.surahList.children) r.hidden = false;
  renderMarks();
  const p = currentPage();
  const j = juzOfPage(p);
  for (const b of ui.juzChips.children) b.setAttribute('aria-current', String(Number(b.dataset.juz) === j));
  const first = source.info(p)?.data?.verses?.[0];
  const at = selected && onSpread(selected.page) ? selected.key : first?.key;
  const [s, a] = (at || '1:1').split(':').map(Number);
  selectSurah(s, a, true);
  requestAnimationFrame(() => {
    const chip = ui.juzChips.children[j - 1];
    if (chip) ui.juzChips.scrollLeft = chip.offsetLeft - ui.juzChips.clientWidth / 2 + chip.offsetWidth / 2;
    if (!IS_MOBILE) ui.navSearch.focus({ preventScroll: true });
  });
}
const navGo = () => { closePops(); goToAyah(`${pick.surah}:${pick.ayah}`); };
ui.navSearch.addEventListener('input', () => filterSurahs(ui.navSearch.value));
ui.navSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); navGo(); } });
ui.surahList.addEventListener('click', (e) => {
  const r = e.target.closest('.s-row');
  if (r) selectSurah(Number(r.dataset.surah), 1, false);
});
ui.ayahList.addEventListener('click', (e) => {
  const r = e.target.closest('.a-row');
  if (r) selectAyah(Number(r.dataset.ayah));
});
ui.ayahList.addEventListener('dblclick', (e) => { if (e.target.closest('.a-row')) navGo(); });
ui.navGo.addEventListener('click', navGo);
ui.navCancel.addEventListener('click', closePops);
ui.juzChips.addEventListener('click', (e) => {
  const b = e.target.closest('.juz-chip');
  if (!b) return;
  closePops();
  reciter.stop();
  goPage(JUZ_START[Number(b.dataset.juz) - 1]);
});
ui.navMarks.addEventListener('click', (e) => {
  const b = e.target.closest('.mark-chip');
  if (!b) return;
  closePops();
  reciter.stop();
  goPage(Number(b.dataset.page));
});

// ---------- page jump ----------
ui.pageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const n = Number(ui.pageInput.value);
  if (!n || n < 1 || n > TOTAL_PAGES) { ui.pageInput.select(); return; }
  closePops();
  reciter.stop();
  goPage(n);
});

// ---------- recitation: the player under the book ----------
const DEFAULT_RECITER = 7;   // Mishari Rashid al-`Afasy
const FALLBACK_RECITERS = [{ id: 7, name: 'Mishari Rashid al-`Afasy' }, { id: 2, name: 'AbdulBaset AbdulSamad', style: 'Murattal' }, { id: 6, name: 'Mahmoud Khalil Al-Husary' }];
const reciter = createReciter({
  onVerse(key, page) {
    if (onSpread(page) && !book.animating) select(key, page);
    else selected = { key, page, vi: -1, side: sideOfPage(page) };
    updatePlayer();
  },
  async onPageEnd(page) {
    if (!reading()) return false;
    if (onSpread(page)) { if (single && sideOfPage(page) !== focus) setFocus(sideOfPage(page)); return true; }
    if (single) { focus = sideOfPage(page); view.showRect(readingRect(), insets(), 0.95); }
    return flipTo(pageToSpread(page));
  },
  onState() { updatePlayer(); },
});
// Mishari is the default; choices saved before this default existed are dropped once
store.del('mushaf-reciter');
reciter.reciter = Number(store.get('mushaf-qari')) || DEFAULT_RECITER;
let reciters = null;
const reciterName = () => (reciters || FALLBACK_RECITERS).find((r) => r.id === reciter.reciter)?.name || 'Reciter';
getReciters().then((r) => { reciters = r; updatePlayer(); }).catch(() => {});

function updatePlayer() {
  const st = reciter.playing ? 'playing' : reciter.paused ? 'paused' : 'idle';
  ui.player.dataset.state = st;
  ui.plPlay.setAttribute('aria-label', st === 'playing' ? 'Pause recitation' : 'Play recitation');
  ui.plPlay.title = st === 'playing' ? 'Pause' : 'Play';
  ui.plStop.disabled = st === 'idle';
  const key = reciter.key;
  const c = key && chapters[Number(key.split(':')[0]) - 1];
  ui.plNow.textContent = st === 'idle' ? (selected ? `Listen from ${selected.key}` : 'Listen to this page') : `${c?.name_simple || ''} ${key}`;
  ui.plSub.textContent = reciterName();
  ui.abPlayLabel.textContent = 'Play from here';
}
function togglePlay(fromKey) {
  if (!reading()) return;
  if (fromKey) { reciter.play(selected.page, fromKey); return; }
  if (reciter.playing) { reciter.pause(); return; }
  if (reciter.paused && reciter.resume()) return;
  if (selected && onSpread(selected.page)) reciter.play(selected.page, selected.key);
  else reciter.play(currentPage());
}
ui.plPlay.addEventListener('click', () => { wakeAudio(); togglePlay(); });
ui.plStop.addEventListener('click', () => { reciter.stop(); updatePlayer(); });
ui.plReciter.addEventListener('click', () => openPop(ui.recitePop, ui.plReciter, onReciteOpen));
async function onReciteOpen() {
  if (!reciters) {
    ui.reciterOptions.innerHTML = '<p class="muted">Loading reciters…</p>';
    try { reciters = await getReciters(); } catch { reciters = FALLBACK_RECITERS; }
  }
  ui.reciterOptions.replaceChildren(...reciters.map((r) => {
    const b = document.createElement('button');
    b.className = 'option';
    b.dataset.reciter = String(r.id);
    b.setAttribute('aria-pressed', String(r.id === reciter.reciter));
    b.innerHTML = `<span class="opt-main">${esc(r.name)}</span>${r.style ? `<span class="opt-sub">${esc(r.style)}</span>` : ''}`;
    return b;
  }));
  placePop();
  const on = ui.reciterOptions.querySelector('[aria-pressed="true"]');
  if (on) ui.reciterOptions.scrollTop = on.offsetTop - ui.reciterOptions.clientHeight / 2;
}
ui.reciterOptions.addEventListener('click', (e) => {
  const b = e.target.closest('.option');
  if (!b) return;
  reciter.reciter = Number(b.dataset.reciter);
  store.set('mushaf-qari', b.dataset.reciter);
  for (const o of ui.reciterOptions.children) o.setAttribute('aria-pressed', String(o === b));
  if (reciter.playing && reciter.key) reciter.play(reciter.page, reciter.key);
  updatePlayer();
  closePops();
});

// ---------- the tapped ayah's actions ----------
let abKey = null;
function placeAyahBar(rest) {
  const show = rest && selected && selected.vi >= 0 && !reciter.playing && onSpread(selected.page) && (!single || selected.side === focus) && !openEl;
  if (!show) { if (!ui.ayahBar.hidden) ui.ayahBar.hidden = true; abKey = null; return; }
  const info = source.info(selected.page);
  const boxes = info?.hits.filter((hb) => hb.vi === selected.vi);
  if (!boxes?.length) return;
  const top = Math.min(...boxes.map((b) => b.y));
  const row = boxes.filter((b) => b.y === top);
  const x0 = Math.min(...row.map((b) => b.x)), x1 = Math.max(...row.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const a = zoneRect(selected.side, [x0, x1], [top, top]);
  const bt = zoneRect(selected.side, [x0, x1], [bottom, bottom]);
  if (ui.ayahBar.hidden || abKey !== selected.key) {
    ui.ayahBar.hidden = false;
    abKey = selected.key;
    const v = info.data.verses[selected.vi];
    ui.abKey.textContent = `${v.chapter?.name_simple || ''} ${v.key}`;
    ui.abCopyLabel.textContent = 'Copy';
  }
  const w = ui.ayahBar.offsetWidth, hgt = ui.ayahBar.offsetHeight;
  let y = a.y - hgt - 10;
  if (y < 64) y = bt.y + 10;
  const x = Math.max(10, Math.min(window.innerWidth - w - 10, a.x + a.w / 2 - w / 2));
  ui.ayahBar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
ui.ayahBar.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ab]');
  if (!b || !selected) return;
  if (b.dataset.ab === 'play') { wakeAudio(); togglePlay(selected.key); }
  else if (b.dataset.ab === 'copy') {
    const v = source.info(selected.page)?.data.verses[selected.vi];
    if (!v) return;
    const trName = TRANSLATIONS.find((t) => t.id === tr)?.sub || '';
    const text = `${v.text}\n\n${v.translations[tr] || ''}\n— ${v.chapter?.name_simple || ''} ${v.key}${trName ? ` (${trName})` : ''}`;
    try { await navigator.clipboard.writeText(text); ui.abCopyLabel.textContent = 'Copied'; }
    catch { ui.abCopyLabel.textContent = 'Copy failed'; }
  }
});

// ---------- audio ----------
function wakeAudio() {
  initAudio();
  startAmbience();
  setAmbienceNight(view.isNight() ? 1 : 0);
}

// ---------- settings ----------
function markGroup(group, attr, value) {
  for (const b of group.querySelectorAll('.seg')) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
}
function setNight(on) {
  view.setNight(on);
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none !important}';
  document.head.appendChild(style);
  document.documentElement.dataset.theme = on ? 'dark' : 'light';
  void document.body.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
  markGroup(ui.themeGroup, 'theme', on ? 'dark' : 'light');
  setAmbienceNight(on ? 1 : 0);
  store.set('mushaf-night', on ? '1' : '0');
}
ui.themeGroup.addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (b) { wakeAudio(); setNight(b.dataset.theme === 'dark'); }
});
if (store.get('mushaf-night') === '1') setNight(true);

function setSound(on) {
  setMuted(!on);
  refreshAmbienceMute();
  ui.sound.setAttribute('aria-checked', String(on));
  store.set('mushaf-sound', on ? '1' : '0');
}
ui.sound.addEventListener('click', () => { wakeAudio(); setSound(ui.sound.getAttribute('aria-checked') !== 'true'); });
if (store.get('mushaf-sound') === '0') setSound(false);

markGroup(ui.trGroup, 'tr', String(tr));
ui.trGroup.addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (!b) return;
  tr = Number(b.dataset.tr);
  store.set('mushaf-trans', String(tr));
  markGroup(ui.trGroup, 'tr', String(tr));
  refreshPages();
});

// Tajwid: the same page fonts, in their colour-coded build
let pendingScript = null;
async function setScript(script) {
  ui.tajwid.setAttribute('aria-checked', String(script === 'tajweed'));
  store.set('mushaf-script', script);
  if (source.script === script) return;
  source.setScript(script);
  if (!book) return;
  if (book.animating) { pendingScript = script; flipWaiters.push(onFlipEndScript); return; }
  busy(true);
  try { await book.applyTextures(); } catch (e) { console.error(e); }
  busy(false);
  if (selected && onSpread(selected.page)) select(selected.key, selected.page, { scroll: false });
  refreshPages();
  prefetchAround();
}
function onFlipEndScript() { if (pendingScript) { const sc = pendingScript; pendingScript = null; setScript(sc); } }
ui.tajwid.addEventListener('click', () => setScript(source.script === 'tajweed' ? 'uthmani' : 'tajweed'));
if (store.get('mushaf-script') === 'tajweed') { source.setScript('tajweed'); ui.tajwid.setAttribute('aria-checked', 'true'); }

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function castFrom(e) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
function pickAt(e) {
  if (!book) return null;
  castFrom(e);
  const hits = raycaster.intersectObjects(book.pickables(), false);
  if (!hits.length) return null;
  const hit = hits[0];
  const side = hit.object.userData.side;
  if (side === 'cover') return { side: book.f === 0 ? 'left' : 'right', cover: true };
  if (!hit.uv) return null;
  return { side, u: hit.uv.x, v: hit.uv.y, cx: hit.uv.x * PW, cy: (1 - hit.uv.y) * PH };
}

function classify(p) {
  if (!p) return { kind: 'none' };
  if (state === 'closed') return book.f === 0 ? { kind: 'open' } : { kind: 'none' };
  if (!reading()) return { kind: 'none' };
  if (p.cover) return { kind: 'none' };
  if (!single) {
    const edge = p.side === 'left' ? p.u < 0.05 : p.u > 0.95;
    if (edge) return { kind: p.side === 'left' ? 'next' : 'prev' };
  }
  const pageNo = book.pageAt(p.side);
  const info = pageNo && source.info(pageNo);
  if (info) {
    const vi = hitTest(info.hits, p.cx, p.cy);
    if (vi >= 0) return { kind: 'ayah', pageNo, key: info.data.verses[vi].key };
  }
  return { kind: 'none' };
}

// ---------- desktop: grab a page edge and drag it across ----------
const EDGE = 0.07;   // outer strip of the page you can grab
const bookPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(COVER_T + 0.06));
const planeHit = new THREE.Vector3();
function pointOnBook(e) {
  castFrom(e);
  return raycaster.ray.intersectPlane(bookPlane, planeHit) ? planeHit.clone() : null;
}
function grabDirection(p) {
  if (!p || p.cover) return 0;
  if (p.side === 'left') return p.u < EDGE && book.f < MAX_SPREAD ? 1 : 0;
  return p.u > 1 - EDGE && book.f > 2 ? -1 : 0;
}

let down = null;
let drag = null;
function startDrag(e, dir, pt) {
  drag = { dir, x0: pt.x, spineX: book.group.position.x, lastT: performance.now(), moved: false, id: e.pointerId, ready: false };
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  reciter.stop();
  book.beginDrag(dir).then((ok) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!ok) { drag = null; return; }
    drag.ready = true;
    if (drag.pendingP !== undefined) book.setDragProgress(drag.pendingP);
    if (drag.released) finishDrag(drag.releasedTap);
  }).catch(() => { drag = null; });
}
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button, type: e.pointerType };
  wakeAudio();
  if (e.button !== 0 || !reading() || single || e.pointerType === 'touch' || book.animating || drag) return;
  const p = pickAt(e);
  const dir = grabDirection(p);
  const pt = dir && pointOnBook(e);
  if (dir && pt) startDrag(e, dir, pt);
});
function dragProgress(pt) {
  const span = 2 * (drag.spineX - drag.x0);
  if (Math.abs(span) < 1e-4) return 0;
  return (pt.x - drag.x0) / span;
}
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const pt = pointOnBook(e);
  if (!pt) return;
  const now = performance.now();
  const dt = (now - drag.lastT) / 1000;
  drag.lastT = now;
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) drag.moved = true;
  const p = dragProgress(pt);
  if (drag.ready) book.setDragProgress(p, dt);
  else drag.pendingP = p;
});
function finishDrag(tap) {
  book.endDrag(tap);
  drag = null;
}
function releaseDrag(e) {
  if (!drag || e.pointerId !== drag.id) return false;
  const tap = !drag.moved && down && performance.now() - down.t < 350;
  down = null;
  if (drag.ready) finishDrag(tap);
  else { drag.released = true; drag.releasedTap = tap; }
  return true;
}
canvas.addEventListener('pointercancel', (e) => { releaseDrag(e); down = null; });

// taps select, swipes turn the page (a swipe to the right is the next page, as in a right-to-left book)
canvas.addEventListener('pointerup', (e) => {
  if (releaseDrag(e)) return;
  if (!down) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  const dt = performance.now() - down.t;
  const d0 = down;
  down = null;
  if (d0.b !== 0 || !book) return;
  if (reading() && Math.abs(dx) > 40 && Math.abs(dx) > 1.4 * Math.abs(dy) && dt < 900) {
    if (dx > 0) next(); else prev();
    return;
  }
  if (Math.hypot(dx, dy) > 8 || dt > 700 || book.animating) return;
  const c = classify(pickAt(e));
  switch (c.kind) {
    case 'open': openBook(); break;
    case 'next': next(); break;
    case 'prev': prev(); break;
    case 'ayah':
      if (selected?.key === c.key && !reciter.playing) clearSelection();
      else { select(c.key, c.pageNo); if (reciter.playing) reciter.play(c.pageNo, c.key); }
      updatePlayer();
      break;
    default: if (!reciter.playing) { clearSelection(); updatePlayer(); }
  }
});
let hoverPending = false;
canvas.addEventListener('pointermove', (e) => {
  if (hoverPending || e.pointerType === 'touch') return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    if (down || !book || book.animating) { canvas.style.cursor = ''; return; }
    const p = pickAt(e);
    const c = classify(p);
    canvas.style.cursor = c.kind === 'none' ? '' : (c.kind === 'next' || c.kind === 'prev') && grabDirection(p) ? 'grab' : 'pointer';
  });
});

// ---------- keys ----------
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || ui.credits.open) return;
  switch (e.key) {
    case 'ArrowLeft': case 'PageDown': e.preventDefault(); next(); break;
    case 'ArrowRight': case 'PageUp': e.preventDefault(); prev(); break;
    case ' ':
      if (e.target.closest?.('button')) return;
      e.preventDefault();
      if (state === 'closed') openBook(); else next();
      break;
    case 'Enter': if (state === 'closed' && !e.target.closest?.('button')) openBook(); break;
    case 'Escape': if (openEl) closePops(); else if (selected && !reciter.playing) { clearSelection(); updatePlayer(); } break;
    case 'd': case 'D': wakeAudio(); setNight(!view.isNight()); break;
    case 'b': case 'B': toggleBookmark(); break;
    case 'p': case 'P': wakeAudio(); togglePlay(); break;
  }
});

// ---------- resize ----------
function onResize() {
  view.resize();
  const was = single;
  single = isSingle();
  applyView(0);
  if (was !== single) refreshPages();
  placePop();
  clearTimeout(rescaleTimer);
  rescaleTimer = setTimeout(rescalePages, 300);
}
// a much larger (or smaller) page on screen, e.g. after rotating a phone: typeset the pages again at the new size
let rescaleTimer = 0;
async function rescalePages() {
  const s = idealPageScale();
  if (Math.abs(s / PAGE_SCALE - 1) < 0.15) return;
  if (!book || book.animating) { rescaleTimer = setTimeout(rescalePages, 300); return; }
  setPageScale(s);
  source.clear();
  try { await book.applyTextures(); } catch (e) { console.error(e); }
  if (selected && onSpread(selected.page)) select(selected.key, selected.page, { scroll: false });
  refreshPages();
}
window.addEventListener('resize', onResize);

// ---------- loop ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (book?.animating) { book.update(dt); view.invalidate(1); }
  view.tick(dt);
  if (book) placePages();
  view.render(!!book?.animating || view.moving);
  requestAnimationFrame(frame);
}
updatePlayer();
frame();
init();

// inspection hook
window.__mushaf = { get book() { return book; }, view, goPage, get state() { return state; }, get focus() { return focus; }, get single() { return single; }, get pageScale() { return PAGE_SCALE; }, set vectorText(on) { vectorText = on; view.invalidate(); } };

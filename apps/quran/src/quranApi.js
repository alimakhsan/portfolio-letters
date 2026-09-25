// Thin client for the quran.com v4 API (open CORS, no key needed).
const API = 'https://api.quran.com/api/v4';
// quran.com's own CDN API: with mushaf=1 it returns the King Fahd Complex V2 page layout (the current printed
// Madani mushaf) and per-word glyph codes for the QCF page fonts.
const QDC = 'https://api.qurancdn.com/api/qdc';
const MUSHAF_V2 = 1;
/** Per-page King Fahd Complex fonts (QPC V4) from Tarteel's Quranic Universal Library; plain and colour-tajweed. */
export const QCF_FONT = (page, tajweed) =>
  `https://static-cdn.tarteel.ai/qul/fonts/quran_fonts/${tajweed ? 'v4-tajweed' : 'v4'}/woff2/p${page}.woff2`;
/** QUL surah-name font (V4), ligature based. */
export const SURAH_NAME_FONT = 'https://static-cdn.tarteel.ai/qul/fonts/surah-names/v4/surah-name-v4.woff2';
export const TR_EN = 20; // Saheeh International
export const TR_ID = 33; // Kementerian Agama RI
export const TOTAL_PAGES = 604;

const pageCache = new Map();
const inflight = new Map();
let chaptersPromise = null;

export function getChapters() {
  if (!chaptersPromise) {
    chaptersPromise = fetch(`${API}/chapters?language=en`)
      .then((r) => r.json())
      .then((d) => d.chapters)
      .catch((e) => { chaptersPromise = null; throw e; });
  }
  return chaptersPromise;
}

/** Parse quran.com tajweed markup (tags may nest) into runs [{t, c}] (c = innermost rule class or null). */
export function parseTajweed(html) {
  const runs = [];
  const stack = [];
  const push = (t) => {
    if (!t) return;
    const c = stack.length ? stack[stack.length - 1] : null;
    const last = runs[runs.length - 1];
    if (last && last.c === c) last.t += t;
    else runs.push({ t, c });
  };
  const re = /<(\/?)[a-z]+(?:\s+class=([\w-]+))?\s*\/?>/g;
  let i = 0, m;
  while ((m = re.exec(html))) {
    push(html.slice(i, m.index));
    if (m[1]) stack.pop();
    else stack.push(m[2] || null);
    i = re.lastIndex;
  }
  push(html.slice(i));
  return runs;
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<sup[^>]*>.*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function getPage(n) {
  if (pageCache.has(n)) return pageCache.get(n);
  if (inflight.has(n)) return inflight.get(n);
  const p = (async () => {
    const url = `${QDC}/verses/by_page/${n}?mushaf=${MUSHAF_V2}&per_page=all&words=true` +
      `&word_fields=code_v2,text_uthmani,text_uthmani_tajweed,line_number` +
      `&translations=${TR_EN},${TR_ID}&fields=text_uthmani,text_uthmani_tajweed,juz_number`;
    const [r, chapters] = await Promise.all([fetch(url), getChapters()]);
    if (!r.ok) throw new Error(`HTTP ${r.status} while loading page ${n}`);
    const d = await r.json();
    const verses = d.verses.map((v) => {
      const [surah, ayah] = v.verse_key.split(':').map(Number);
      return {
        key: v.verse_key,
        surah,
        ayah,
        juz: v.juz_number,
        text: v.text_uthmani,
        chapter: chapters[surah - 1],
        // every word keeps its Madani line number; 'end' words are the ayah markers
        tajweed: parseTajweed(String(v.text_uthmani_tajweed || '').replace(/<span class=end>[\s\S]*?<\/span>/g, '')),
        words: v.words.map((w) => ({
          // a pause mark separated by a space would render on a dotted placeholder circle; bind it with a ZWNJ instead
          ar: String(w.text_uthmani || w.text).replace(/\s+/g, '\u200C'),
          tj: w.text_uthmani_tajweed ? parseTajweed(w.text_uthmani_tajweed) : null,
          g: w.code_v2 || null,   // glyph in the page's QCF font
          line: w.line_number,
          end: w.char_type_name === 'end',
        })),
        translations: Object.fromEntries(
          (v.translations || []).map((t) => [t.resource_id, stripHtml(t.text)])
        ),
      };
    });
    const res = { page: n, verses };
    pageCache.set(n, res);
    return res;
  })();
  inflight.set(n, p);
  p.finally(() => inflight.delete(n));
  return p;
}

const versePageCache = new Map();
/** Madani page number that holds an ayah, e.g. "2:255" → 42. */
export async function getVersePage(key) {
  if (versePageCache.has(key)) return versePageCache.get(key);
  const r = await fetch(`${QDC}/verses/by_key/${key}?mushaf=${MUSHAF_V2}&words=true&word_fields=page_number`);
  if (!r.ok) throw new Error(`HTTP ${r.status} looking up ${key}`);
  const d = await r.json();
  const p = d.verse?.words?.[0]?.page_number || d.verse?.page_number;
  if (p) versePageCache.set(key, p);
  return p;
}

/** Spread index f that shows page p (f=2 shows pages 1|2, f=3 shows 3|4 …). */
export function pageToSpread(p) {
  return Math.floor((p + 3) / 2);
}

/** First Madani page of each juz (1–30). */
export const JUZ_START = [1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502, 522, 542, 562, 582];
/** Last page of juz j (1-based). */
export const juzEnd = (j) => (j >= 30 ? TOTAL_PAGES : JUZ_START[j] - 1);

const infoCache = new Map();
/** Short introduction to a surah: { short, text, source } in 'en' or 'id'. */
export async function getChapterInfo(id, lang = 'en') {
  const key = `${id}:${lang}`;
  if (infoCache.has(key)) return infoCache.get(key);
  const job = fetch(`${API}/chapters/${id}/info?language=${lang}`)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => {
      const ci = d.chapter_info || {};
      // paragraphs of the long text; the English one opens with a "Name" section and then "Period of Revelation"
      const html = String(ci.text || '');
      const sections = [];
      let head = '';
      for (const m of html.matchAll(/<(h\d|p)[^>]*>([\s\S]*?)<\/\1>/g)) {
        const t = stripHtml(m[2]).replace(/\*\*/g, '');
        if (!t) continue;
        // a paragraph ending in ':' is a sub-heading (e.g. "Pokok-Pokok Isi:")
        if (m[1].startsWith('h') || t.endsWith(':')) head = t;
        else sections.push({ head, text: t });
      }
      const period = sections.filter((x) => /period/i.test(x.head)).map((x) => x.text);
      const body = period.length ? period.slice(0, 2) : sections.slice(ci.short_text ? 1 : 0, 2).map((x) => x.text);
      return { short: stripHtml(ci.short_text), body, source: ci.source || '' };
    })
    .catch((e) => { infoCache.delete(key); throw e; });
  infoCache.set(key, job);
  return job;
}

let recitersPromise = null;
/** Available reciters: [{ id, name, style }]. */
export function getReciters() {
  if (!recitersPromise) {
    recitersPromise = fetch(`${API}/resources/recitations?language=en`)
      .then((r) => r.json())
      .then((d) => d.recitations.map((x) => ({ id: x.id, name: x.translated_name?.name || x.reciter_name, style: x.style })))
      .catch((e) => { recitersPromise = null; throw e; });
  }
  return recitersPromise;
}

const audioCache = new Map();
/** Per-ayah audio around a page: Map verse_key → absolute URL. */
export async function getPageAudio(reciter, page) {
  // the audio API groups ayat by the older page layout; a V2 page always falls within its neighbours
  const pages = [page - 1, page, page + 1].filter((p) => p >= 1 && p <= TOTAL_PAGES);
  const maps = await Promise.all(pages.map((p) => getV1PageAudio(reciter, p)));
  return new Map(maps.flatMap((m) => [...m]));
}
async function getV1PageAudio(reciter, page) {
  const key = `${reciter}:${page}`;
  if (audioCache.has(key)) return audioCache.get(key);
  const job = fetch(`${API}/recitations/${reciter}/by_page/${page}?per_page=60`)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => new Map(d.audio_files.map((a) => [a.verse_key, /^https?:/.test(a.url) ? a.url : `https://verses.quran.com/${a.url.replace(/^\/+/, '')}`])))
    .catch((e) => { audioCache.delete(key); throw e; });
  audioCache.set(key, job);
  return job;
}

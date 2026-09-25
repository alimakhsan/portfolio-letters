// Ayah-by-ayah recitation from the quran.com audio CDN. Plays through a page, then asks the app
// to move to the next page and carries on.
import { getPageAudio, getPage, TOTAL_PAGES } from './quranApi.js';

export function createReciter({ onVerse, onPageEnd, onState }) {
  const audio = new Audio();
  audio.preload = 'auto';
  const warm = new Audio();   // preloads the next ayah
  warm.preload = 'auto';
  let reciter = 7;
  let page = 0, verses = [], idx = 0, urls = null;
  let playing = false;
  let paused = false;          // paused mid-ayah: play resumes where it stopped
  let token = 0;               // invalidates in-flight loads when playback is restarted or stopped

  const setPlaying = (on) => { if (on) paused = false; if (playing !== on) { playing = on; onState?.(on); } };

  async function load(p) {
    const [data, map] = await Promise.all([getPage(p), getPageAudio(reciter, p)]);
    return { verses: data.verses, urls: map };
  }

  async function playIndex(i, t) {
    if (t !== token) return;
    if (i >= verses.length) {
      if (page >= TOTAL_PAGES) { stop(); return; }
      const ok = await onPageEnd?.(page + 1);
      if (t !== token) return;
      if (!ok) { stop(); return; }
      try {
        const next = await load(page + 1);
        if (t !== token) return;
        page += 1; verses = next.verses; urls = next.urls;
      } catch (e) { console.error(e); stop(); return; }
      i = 0;
    }
    idx = i;
    const v = verses[i];
    const url = urls.get(v.key);
    if (!url) { playIndex(i + 1, t); return; }
    onVerse?.(v.key, page);
    audio.src = url;
    try { await audio.play(); setPlaying(true); } catch (e) { if (t === token) { console.error(e); stop(); } return; }
    const nv = verses[i + 1];
    const nu = nv && urls.get(nv.key);
    if (nu) warm.src = nu;
  }

  audio.addEventListener('ended', () => { if (playing) playIndex(idx + 1, token); });
  audio.addEventListener('error', () => { if (playing) playIndex(idx + 1, token); });

  /** Start at ayah `key` on page `p` (or at the top of the page). */
  async function play(p, key) {
    const t = ++token;
    audio.pause();
    setPlaying(true);
    try {
      const d = await load(p);
      if (t !== token) return;
      page = p; verses = d.verses; urls = d.urls;
      const i = key ? Math.max(0, verses.findIndex((v) => v.key === key)) : 0;
      playIndex(i, t);
    } catch (e) { console.error(e); if (t === token) stop(); }
  }

  function pause() { token++; audio.pause(); paused = !!audio.src; setPlaying(false); onState?.(false); }
  function resume() {
    if (!paused || !audio.src) return false;
    const t = ++token;
    audio.play().then(() => { if (t === token) setPlaying(true); }).catch(() => stop());
    return true;
  }
  function stop() {
    token++;
    audio.pause();
    const was = playing || paused;
    paused = false;
    setPlaying(false);
    if (was) onState?.(false);
  }

  return {
    play, pause, resume, stop,
    get playing() { return playing; },
    get paused() { return paused; },
    get page() { return page; },
    get key() { return verses[idx]?.key || null; },
    get reciter() { return reciter; },
    set reciter(id) { reciter = id; },
  };
}

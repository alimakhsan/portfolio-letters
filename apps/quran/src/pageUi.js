// DOM laid over the resting 3D pages. Kept quiet on purpose: a title and a bookmark button at the top,
// the translation in the outer margin, page arrows around the page number at the foot.
// While a page rests, its Arabic is vector text (ArabicLayer) over a text-less page texture: sharp at any
// pixel density and readable by assistive tech. While a leaf turns, the page texture carries the text again.
// Everything here is positioned from projected page coordinates, so it sits on the paper wherever the camera
// frames it.

export const ICONS = {
  chev: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7.5 4.5h9a1 1 0 0 1 1 1v14.2l-5.5-3.9-5.5 3.9V5.5a1 1 0 0 1 1-1z" fill="var(--bm-fill, none)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

export const BASMALA_TR = {
  33: 'Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.',
  20: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
};

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const act = (el, name, label) => {
  el.dataset.act = name;
  if (label) { el.title = label; el.setAttribute('aria-label', label); }
  return el;
};

class SideUi {
  constructor(root, side, onAction) {
    this.side = side;
    this.el = h('section', 'pg');
    this.el.dataset.side = side;
    this.el.setAttribute('aria-label', side === 'right' ? 'Right page' : 'Left page');

    // head: where you are (opens the surah & ayah picker) on the left, this page's bookmark on the right — on every page
    this.head = h('div', 'pg-zone pg-head');
    this.title = act(h('button', 'pg-title'), 'nav');
    this.titleText = h('span', 'pg-title-text');
    this.titleMeta = h('span', 'pg-title-meta');
    const t1 = h('span', 'pg-title-line');
    t1.append(this.titleText, h('span', 'chev', ICONS.chev));
    this.title.append(t1, this.titleMeta);
    this.mark = act(h('button', 'pg-mark', ICONS.bookmark), 'bookmark', 'Bookmark this page');
    this.mark.setAttribute('aria-pressed', 'false');
    this.head.append(this.title, this.mark);

    this.trans = h('div', 'pg-zone pg-trans');
    this.trans.setAttribute('tabindex', '0');
    this.trans.setAttribute('aria-label', 'Translation');
    this.list = h('div', 'tr-list');
    this.trans.append(this.list);

    // foot: arrows either side of the page number; in a spread only the outer arrow shows
    this.foot = h('div', 'pg-zone pg-foot');
    this.btnNext = act(h('button', 'pg-arrow', ICONS.left), 'next', 'Next page (←)');
    this.btnPrev = act(h('button', 'pg-arrow', ICONS.right), 'prev', 'Previous page (→)');
    this.num = act(h('button', 'pg-num'), 'page');
    this.foot.append(this.btnNext, h('span', 'grow'), this.num, h('span', 'grow'), this.btnPrev);
    // a folded corner at the outer bottom corner (spread on a large screen)
    this.corner = act(h('button', 'corner'), side === 'left' ? 'next' : 'prev', side === 'left' ? 'Next page' : 'Previous page');
    this.foot.append(this.corner);

    // the ayat as real text for screen readers and find-in-page (the visible Arabic uses page-font glyphs)
    this.sr = h('div', 'sr-only');
    this.sr.lang = 'ar';
    this.sr.dir = 'rtl';

    this.el.append(this.head, this.sr, this.trans, this.foot);
    root.append(this.el);

    this.el.addEventListener('click', (e) => {
      const item = e.target.closest('.tv');
      if (item) { onAction('verse', { key: item.dataset.key, page: this.pageNo, side }); return; }
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) onAction(b.dataset.act, { anchor: b, page: this.pageNo, side });
    });
    this.pageNo = null;
    this._rects = '';
  }

  /** Fill the zones for one page. */
  set({ pageNo, verses, chapters, tr, single, meta, canNext, canPrev, bookmarked }) {
    this.el.dataset.mode = single ? 'single' : 'spread';
    this.btnNext.hidden = !(single || this.side === 'left');
    this.btnPrev.hidden = !(single || this.side === 'right');
    this.btnNext.disabled = !canNext;
    this.btnPrev.disabled = !canPrev;
    this.corner.disabled = this.side === 'left' ? !canNext : !canPrev;
    this.titleMeta.textContent = meta || '';
    if (this.pageNo !== pageNo || this._tr !== tr || !this.list.childElementCount) {
      this.pageNo = pageNo;
      this._tr = tr;
      const ids = [...new Set(verses.map((v) => v.surah))];
      this.titleText.textContent = ids.map((id) => chapters[id - 1]?.name_simple).join(' · ');
      this.title.setAttribute('aria-label', `${this.titleText.textContent}: go to a surah or ayah`);
      this.num.textContent = String(pageNo);
      this.num.setAttribute('aria-label', `Page ${pageNo}, go to page`);

      const frag = document.createDocumentFragment();
      verses.forEach((v, i) => {
        if (v.ayah === 1) {
          const sep = h('div', 'tr-surah');
          sep.append(h('span', 'tr-surah-name', `${v.surah} · ${chapters[v.surah - 1]?.name_simple || ''}`));
          if (i > 0) sep.classList.add('rule');
          frag.append(sep);
          if (v.surah !== 1 && v.surah !== 9) frag.append(h('p', 'tr-basmala', BASMALA_TR[tr] || BASMALA_TR[33]));
        }
        const p = h('p', 'tv');
        p.dataset.key = v.key;
        p.append(h('span', 'tn', String(v.ayah)), document.createTextNode(' ' + (v.translations[tr] || '—')));
        frag.append(p);
      });
      this.list.replaceChildren(frag);
      this.trans.scrollTop = 0;
      this.sr.replaceChildren(...verses.map((v) => h('p', null, `${v.text} ﴿${v.ayah}﴾`)));
    }
    this.setBookmarked(bookmarked);
  }

  setBookmarked(on) {
    this.mark.setAttribute('aria-pressed', String(!!on));
    const label = on ? `Remove bookmark (page ${this.pageNo ?? ''})` : 'Bookmark this page';
    this.mark.title = label;
    this.mark.setAttribute('aria-label', label);
  }

  /** zones: { head, trans, foot } rects in CSS px; pw = on-screen page width. */
  place(zones, pw) {
    const key = JSON.stringify(zones) + pw;
    if (key === this._rects) return;
    this._rects = key;
    this.el.style.setProperty('--pw', `${pw}px`);
    for (const k of ['head', 'trans', 'foot']) {
      const r = zones[k], el = this[k];
      el.style.transform = `translate(${r.x}px, ${r.y}px)`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
    }
  }

  setActive(key, scroll) {
    let hit = null;
    for (const p of this.list.querySelectorAll('.tv')) {
      const on = p.dataset.key === key;
      p.classList.toggle('active', on);
      if (on) hit = p;
    }
    if (hit && scroll) {
      const top = hit.offsetTop - this.trans.clientHeight * 0.18;
      this.trans.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }
}

const SVG = 'http://www.w3.org/2000/svg';
const escXml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n2 = (v) => Math.round(v * 100) / 100;
const n5 = (v) => Math.round(v * 1e5) / 1e5;

/**
 * One page's Arabic as SVG text. `layout` comes from renderPage (logical page px); place() puts every run at
 * its projected spot on the curved 3D page, so the vector text lands exactly where the texture drew it.
 */
class ArabicLayer {
  constructor(root) {
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('class', 'ar-layer');
    this.svg.setAttribute('aria-hidden', 'true');
    this.marks = document.createElementNS(SVG, 'g');
    this.marks.setAttribute('class', 'ar-marks');
    this.words = document.createElementNS(SVG, 'g');
    this.svg.append(this.marks, this.words);
    root.prepend(this.svg);
    this.layout = null;
    this.active = -1;
    this._key = '';
    this.on = false;
  }

  set(layout) {
    if (layout === this.layout) return;
    this.layout = layout;
    this._key = '';
    this.active = -1;
    this.marks.innerHTML = '';
    this.words.innerHTML = layout.texts.map((r) =>
      `<text font-family='${escXml(r.font)}' font-size="${n2(r.size)}" text-anchor="${r.anchor}" fill="${r.color}"` +
      (r.stroke ? ` stroke="${r.color}" stroke-width="${n2(r.stroke)}" stroke-linejoin="round"` : '') +
      `>${escXml(r.t)}</text>`).join('');
  }

  /** Highlight ayah `vi` (index in the page's verses), or none with -1. */
  setActive(vi) {
    if (vi === this.active || !this.layout) return;
    this.active = vi;
    const boxes = vi < 0 ? [] : this.layout.marks.filter((m) => m.vi === vi);
    this.marks.innerHTML = boxes.map(() => '<rect rx="8" ry="8"/>').join('');
    this._key = '';   // the new boxes need placing
  }

  /** at(cx, cy) → screen {x, y} of a logical page point on the actual (curved) page surface. */
  place(at) {
    if (!this.layout) return;
    const o = at(0, 0), ex = at(1560, 0), ey = at(0, 1856);
    const key = `${n2(o.x)},${n2(o.y)},${n2(ex.x)},${n2(ey.y)}`;
    if (key === this._key) return;
    this._key = key;
    // local scale of the page on screen; each run's position comes from the true projection
    const a = (ex.x - o.x) / 1560, b = (ex.y - o.y) / 1560, c = (ey.x - o.x) / 1856, d = (ey.y - o.y) / 1856;
    const els = this.words.children;
    this.layout.texts.forEach((r, i) => {
      const p = at(r.x, r.y);
      els[i].setAttribute('transform', `matrix(${n5(a * r.sx)} ${n5(b * r.sx)} ${n5(c)} ${n5(d)} ${n2(p.x)} ${n2(p.y)})`);
    });
    if (this.active >= 0) {
      const boxes = this.layout.marks.filter((m) => m.vi === this.active);
      [...this.marks.children].forEach((el, i) => {
        const m = boxes[i], p = at(m.x, m.y);
        el.setAttribute('width', n2(m.w)); el.setAttribute('height', n2(m.h));
        el.setAttribute('transform', `matrix(${n5(a)} ${n5(b)} ${n5(c)} ${n5(d)} ${n2(p.x)} ${n2(p.y)})`);
      });
    }
  }

  show(on) {
    if (on === this.on) return;
    this.on = on;
    this.svg.style.visibility = on ? 'visible' : 'hidden';
  }
}

export class PageUi {
  constructor(root, onAction) {
    this.root = root;
    this.sides = { right: new SideUi(root, 'right', onAction), left: new SideUi(root, 'left', onAction) };
    this.arabic = { right: new ArabicLayer(root), left: new ArabicLayer(root) };
  }
  show(side, on) { this.sides[side].el.classList.toggle('on', on); }
  setActive(key, scroll = true) { for (const s of Object.values(this.sides)) s.setActive(key, scroll); }
}

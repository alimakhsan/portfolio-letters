# Mushaf · 3D Qur'an

A Qur'an reader rendered as a real book on a table, built with Three.js.

- Pages follow the Madani mushaf: 15 lines per page with the standard line breaks,
  surah headers and basmala where the printed mushaf has them, pages 1–2 in ornate frames.
- A hinged hardcover with embossed leather and gold tooling (colour, bump and
  roughness/metalness maps are all drawn procedurally on canvases).
- Leaves are bound: both page blocks curve into a shared gutter, so the book reads as one volume.
- Pages bend and flip like paper, with synthesized page-turn sounds; the room has its own
  ambience (birds and room tone by day, wind with slow gusts at night). Web Audio only, no samples.
- Daylight comes through a window; night mode dims the room and switches on a warm table lamp.
  The mushaf text itself never changes colour. Depth of field keeps the book sharp and blurs the room.
- A fixed camera, built for reading rather than exploring: the closed book rests in a desk view; tap it and
  the camera settles straight above the open spread (one page at a time on phones). No orbit, pan or zoom.
- Uthmani and colour-coded Tajweed are drawn with the King Fahd Complex per-page fonts (QPC V4, via Tarteel's
  Quranic Universal Library) on the current V2 page layout, so every word is the printed calligraphy.
  A Tajwid switch shows the colour-coded build of the same fonts. Surah headings use QUL's V4 surah-name font.
- Turn pages by hand: grab a page's outer edge (mouse) or swipe a page toward the spine (touch) and the
  leaf follows your finger; release past the middle or flick to finish, otherwise it settles back.
- Clean pages: a title (tap to pick a surah and ayah, then confirm) with juz progress, a bookmark ribbon on
  every page, and ‹ page › arrows at the foot. The translation sits in the outer margin and scrolls on its own.
  Phones show one page at a time with both arrows.
- Phones get a lighter rendering budget (lower pixel ratio, smaller shadow maps, no depth-of-field pass)
  and a portrait framing that fits the whole spread.
- Surah headings: a full-width monochrome cartouche (ornament from quran-madina-html) with the name in
  calligraphy.
- One settings button (book icon) holds the Tajwid switch, translation, light/dark and room sound. The book reopens on
  the page you last read.
- Click an ayah to highlight it and its translation (Kementerian Agama RI or Saheeh International).
- A player under the book (play, pause, stop, reciter) recites ayah by ayah from the quran.com audio CDN and
  turns the pages as it goes; tap an ayah for "Play from here" or "Copy".
- Text, layout and translations come from the quran.com APIs at runtime; pages are drawn on canvases. UI uses Inter.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Keys: `Enter` open, `←` / `space` next page, `→` previous, `P` play/pause, `D` light/dark, `B` bookmark page, `Esc` close a panel.

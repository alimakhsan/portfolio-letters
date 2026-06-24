/* ============================================================
   Case-studies shell behaviour: theme + font toggles (sharing
   the home page's pf- localStorage keys so the visitor's choice
   carries across), per-page accent + scene, back-to-top reveal.

   Per-page config is read from <html> data attributes:
     data-scene         background photo URL for .scene
     data-accent-light  accent hex in light theme
     data-accent-dark   accent hex in dark theme
   ============================================================ */
(function () {
  "use strict";

  var mqDark = window.matchMedia("(prefers-color-scheme: dark)");
  var state = { theme: "light", font: "sans" };

  var FONTS = ["sans", "mono", "serif"];
  var FONT_LABEL = { sans: "Sans", mono: "Mono", serif: "Serif" };
  var FONT_ICON = { sans: "typography", mono: "code", serif: "book" };

  // Tabler Icons (MIT), inline so they inherit currentColor
  var ICONS = {
    sun: '<path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"/>',
    moon: '<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008"/>',
    typography: '<path d="M4 20l3 0"/><path d="M14 20l7 0"/><path d="M6.9 15l6.9 0"/><path d="M10.2 6.3l5.8 13.7"/><path d="M5 20l6 -16l2 0l7 16"/>',
    code: '<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>',
    book: '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6l0 13"/><path d="M12 6l0 13"/><path d="M21 6l0 13"/>'
  };
  function svgIcon(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
           paths + '</svg>';
  }

  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  var root = document.documentElement;

  function applyTheme(t) { root.setAttribute("data-theme", t); }
  function applyAccent() {
    // per-page accent is deprecated; accent now follows the theme (CSS token).
    // Kept for any page that still sets data-accent-*; otherwise a no-op.
    var a = state.theme === "dark"
      ? root.getAttribute("data-accent-dark")
      : root.getAttribute("data-accent-light");
    if (a) root.style.setProperty("--accent", a);
  }
  // bottom-anchored background photo, swapped per theme (clouds / street)
  function applyScene() {
    var sceneEl = document.getElementById("scene");
    if (!sceneEl) return;
    var url = state.theme === "dark"
      ? root.getAttribute("data-scene-dark")
      : root.getAttribute("data-scene-light");
    if (url) sceneEl.style.backgroundImage = "url('" + url + "')";
  }
  function applyFont(f) { root.setAttribute("data-font", f); }

  function renderTheme() {
    var dark = state.theme === "dark";
    var icon = document.getElementById("theme-icon");
    if (icon) icon.innerHTML = svgIcon(ICONS[dark ? "sun" : "moon"]);
    var label = dark ? "Switch to light theme" : "Switch to dark theme";
    var btn = document.getElementById("theme-toggle");
    if (btn) { btn.setAttribute("aria-label", label); btn.setAttribute("title", label); }
  }
  function renderFont() {
    var icon = document.getElementById("font-icon");
    if (icon) icon.innerHTML = svgIcon(ICONS[FONT_ICON[state.font]]);
    var btn = document.getElementById("font-toggle");
    if (btn) {
      var lbl = "Change typeface (now: " + FONT_LABEL[state.font] + ")";
      btn.setAttribute("aria-label", lbl); btn.setAttribute("title", lbl);
    }
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme(state.theme);
    write("pf-theme-v2", state.theme);
    applyAccent();
    applyScene();
    renderTheme();
  }
  function cycleFont() {
    var i = FONTS.indexOf(state.font);
    state.font = FONTS[(i + 1) % FONTS.length];
    applyFont(state.font);
    write("pf-font", state.font);
    renderFont();
  }

  function init() {
    // theme: stored override, else follow OS (same keys as the home page)
    var stored = read("pf-theme-v2");
    state.theme = stored || (mqDark.matches ? "dark" : "light");
    applyTheme(state.theme);

    var font = read("pf-font") || "sans";
    if (FONTS.indexOf(font) < 0) font = "sans";
    state.font = font;
    applyFont(font);

    applyScene();
    applyAccent();
    renderTheme();
    renderFont();

    var tBtn = document.getElementById("theme-toggle");
    if (tBtn) tBtn.addEventListener("click", toggleTheme);
    var fBtn = document.getElementById("font-toggle");
    if (fBtn) fBtn.addEventListener("click", cycleFont);

    // back-to-top: smooth scroll, revealed once it scrolls into view
    var backTop = document.getElementById("back-to-top");
    if (backTop) backTop.addEventListener("click", function () {
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });
    var bttWrap = document.querySelector(".backtotop-wrap");
    if (bttWrap) {
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { bttWrap.classList.add("is-visible"); io.disconnect(); }
          });
        }, { threshold: 0.4 });
        io.observe(bttWrap);
      } else {
        bttWrap.classList.add("is-visible");
      }
    }

    // follow device theme unless the user has set a manual override
    var onScheme = function (e) {
      if (!read("pf-theme-v2")) {
        state.theme = e.matches ? "dark" : "light";
        applyTheme(state.theme);
        applyAccent();
        applyScene();
        renderTheme();
      }
    };
    try { mqDark.addEventListener("change", onScheme); }
    catch (e) { mqDark.addListener(onScheme); }
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();

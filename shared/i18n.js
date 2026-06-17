/* ============================================================
   Tripkit — i18n engine (vanilla, dependency-free)
   English is the BASE (inline defaults / existing HTML text).
   Only non-English dictionaries are stored in I18N.dict.
   Loaded BEFORE every surface's own script via:
     <script src="/shared/i18n.js?v=1"></script>
   ============================================================ */
(function () {
  "use strict";

  var KEY = "tripkit-lang";

  var I18N = {
    LANGS: [
      ["en", "English"],
      ["ru", "Русский"],
      ["uz", "O'zbekcha"],
      ["id", "Bahasa Indonesia"],
      ["es", "Español"]
    ],
    lang: "en"
  };

  I18N.dict = window.__TRIPKIT_I18N_DICT || {};

  function known(code) {
    for (var i = 0; i < I18N.LANGS.length; i++) {
      if (I18N.LANGS[i][0] === code) return true;
    }
    return false;
  }

  function interp(str, vars) {
    if (!vars || typeof str !== "string") return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return k in vars ? vars[k] : m;
    });
  }

  I18N.t = function (key, defaultEn, vars) {
    var out;
    if (I18N.lang === "en") {
      out = defaultEn;
    } else {
      var d = I18N.dict[I18N.lang];
      out = (d && d[key]) || defaultEn || key;
    }
    return interp(out, vars);
  };

  I18N.detect = function () {
    var saved;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    if (saved && known(saved)) return saved;
    var nav = (navigator.language || "en").slice(0, 2);
    return known(nav) ? nav : "en";
  };

  I18N.setLang = function (code) {
    if (!known(code)) code = "en";
    I18N.lang = code;
    try { localStorage.setItem(KEY, code); } catch (e) {}
    document.documentElement.lang = code;
    I18N.apply(document);
    window.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: code } }));
  };

  I18N.apply = function (root) {
    root = root || document;
    var en = I18N.lang === "en";

    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (en) return; /* leave existing English DOM text untouched */
      el.textContent = I18N.t(key, el.textContent);
    });
    root.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-ph");
      el.setAttribute("placeholder", I18N.t(key, el.getAttribute("placeholder")));
    });
    root.querySelectorAll("[data-i18n-al]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-al");
      el.setAttribute("aria-label", I18N.t(key, el.getAttribute("aria-label")));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-html");
      if (en) return;
      el.innerHTML = I18N.t(key, el.innerHTML);
    });
  };

  I18N.mount = function (el) {
    if (!el) return;
    if (!document.getElementById("i18n-switcher-style")) {
      var st = document.createElement("style");
      st.id = "i18n-switcher-style";
      st.textContent =
        ".i18n-switcher{display:inline-flex;align-items:center;gap:6px;" +
        "padding:6px 10px;border:1px solid var(--line-strong,rgba(160,200,190,.22));" +
        "border-radius:var(--radius-pill,999px);background:var(--surface-2,#15261f);" +
        "color:var(--ink,#f2f7f4);font-family:var(--font-body,system-ui);font-size:13px;" +
        "line-height:1;cursor:pointer;transition:border-color var(--dur,160ms) ease,background var(--dur,160ms) ease}" +
        ".i18n-switcher:hover{background:var(--surface-3,#1b2f27);border-color:var(--accent,#34dfc0)}" +
        ".i18n-switcher .i18n-globe{font-size:14px;line-height:1}" +
        ".i18n-switcher select{appearance:none;-webkit-appearance:none;background:transparent;" +
        "border:0;color:inherit;font:inherit;cursor:pointer;outline:none;padding-right:2px}" +
        ".i18n-switcher select option{background:var(--surface-1,#0f1c18);color:var(--ink,#f2f7f4)}";
      document.head.appendChild(st);
    }
    el.classList.add("i18n-switcher");
    el.innerHTML = "";
    var globe = document.createElement("span");
    globe.className = "i18n-globe";
    globe.textContent = "🌐";
    globe.setAttribute("aria-hidden", "true");
    var sel = document.createElement("select");
    sel.setAttribute("aria-label", "Language");
    I18N.LANGS.forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0];
      o.textContent = pair[1];
      sel.appendChild(o);
    });
    sel.value = I18N.lang;
    sel.addEventListener("change", function () { I18N.setLang(sel.value); });
    window.addEventListener("i18n:change", function () { sel.value = I18N.lang; });
    el.appendChild(globe);
    el.appendChild(sel);
  };

  window.I18N = I18N;

  function init() {
    I18N.lang = I18N.detect();
    document.documentElement.lang = I18N.lang;
    I18N.apply(document);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

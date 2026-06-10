(function () {
  'use strict';

  // ----- helpers -----

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function setStatus(msg, kind = '') {
    const el = $('#status-line');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status-line ' + kind;
    if (msg) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(() => {
        if (el.textContent === msg) {
          el.textContent = '';
          el.className = 'status-line';
        }
      }, 4000);
    }
  }

  function download(filename, content, mime = 'text/plain') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ----- URL state -----
  // (delete this whole section if persistence model is not 'url')

  const HASH_PREFIX = '{{HASH_PREFIX}}'; // e.g. '#s='

  function defaultState() {
    // Must be EMPTY — no sample/demo values. A fresh visit always opens blank;
    // only a shared link (hash present) populates anything. (TODO: app-specific
    // empty shape, e.g. empty arrays/strings, all toggles off.)
    return { v: 1 };
  }

  function encodeState(s) {
    return LZString.compressToEncodedURIComponent(JSON.stringify(s));
  }
  function decodeState(payload) {
    if (!payload) return null;
    try {
      const raw = LZString.decompressFromEncodedURIComponent(payload);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1) return null;
      return parsed;
    } catch (e) {
      console.warn('decodeState failed', e);
      return null;
    }
  }
  function readHash() {
    const h = location.hash || '';
    return h.startsWith(HASH_PREFIX) ? h.slice(HASH_PREFIX.length) : '';
  }

  let suppressHashChange = false;
  let urlTimer = null;
  function syncURL() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(syncURLNow, 250);
  }
  function syncURLNow() {
    clearTimeout(urlTimer);
    const encoded = encodeState(state);
    const newHash = HASH_PREFIX + encoded;
    if (location.hash !== newHash) {
      suppressHashChange = true;
      history.replaceState(null, '', newHash);
      Promise.resolve().then(() => { suppressHashChange = false; });
    }
  }

  // ----- copy link -----
  async function copyLink() {
    syncURLNow();
    try {
      await navigator.clipboard.writeText(location.href);
      setStatus('Link copied.', 'success');
    } catch (e) {
      setStatus(`Copy failed: ${e.message}`, 'error');
    }
  }

  // ----- theme -----
  function applyTheme() {
    const saved = localStorage.getItem('web_tools.theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved === 'dark' || (saved === null && prefersDark);
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    const btn = $('#theme-toggle');
    if (btn) btn.textContent = dark ? '☀' : '🌙';
  }
  function toggleTheme() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    localStorage.setItem('web_tools.theme', isDark ? 'light' : 'dark');
    applyTheme();
  }

  // ----- state -----
  let state = decodeState(readHash()) || defaultState();

  // ----- render -----
  function render() {
    // TODO: paint your UI from `state` here.
  }

  // ----- wiring -----
  $('#theme-toggle')?.addEventListener('click', toggleTheme);
  $('#copy-link')?.addEventListener('click', copyLink);

  window.addEventListener('hashchange', () => {
    if (suppressHashChange) return;
    state = decodeState(readHash()) || defaultState();
    render();
  });

  window.addEventListener('beforeunload', syncURLNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncURLNow();
  });

  // ----- init -----
  // Start clean: a shared link (hash present) loads via `state` above; any
  // other visit stays empty and leaves the URL untouched. Do NOT call
  // syncURLNow() here — the hash is only written once the user edits something
  // (see the syncURL/syncURLNow calls in the wiring/handlers).
  applyTheme();
  render();
})();

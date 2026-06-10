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

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  // Escape a string so it matches literally inside a regex.
  function escLit(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  // Escape a string for safe use inside a [character class].
  function escClass(s) {
    return String(s).replace(/[\]\\^-]/g, '\\$&');
  }
  // Sanitize a capture-group name to a valid identifier, or '' if unusable.
  function sanitizeName(name) {
    const cleaned = String(name || '').trim().replace(/[^A-Za-z0-9_]/g, '');
    return /^[A-Za-z_]/.test(cleaned) ? cleaned : '';
  }

  // Is a fragment a single atom (so a quantifier can attach without a group)?
  function isAtomic(f) {
    if (f.length === 1) return true;
    if (/^\\[\s\S]$/.test(f)) return true;          // \d, \., \w …
    if (/^\[[^\]]*\]$/.test(f)) return true;         // [abc]
    if (f[0] === '(' && f[f.length - 1] === ')') {   // one whole group?
      let depth = 0;
      for (let i = 0; i < f.length; i++) {
        if (f[i] === '\\') { i++; continue; }
        if (f[i] === '(') depth++;
        else if (f[i] === ')') { depth--; if (depth === 0 && i !== f.length - 1) return false; }
      }
      return true;
    }
    return false;
  }

  function applyQuant(frag, q) {
    if (!q || q.mode === 'once') return frag;
    const base = isAtomic(frag) ? frag : `(?:${frag})`;
    switch (q.mode) {
      case 'oneplus': return base + '+';
      case 'zeroplus': return base + '*';
      case 'optional': return base + '?';
      case 'exact': return base + `{${num(q.n, 1)}}`;
      case 'range': {
        const n = num(q.n, 0);
        const m = q.m === '' || q.m == null ? '' : num(q.m, n);
        return base + `{${n},${m}}`;
      }
      default: return frag;
    }
  }
  function num(v, d) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  }

  function quantPhrase(q) {
    if (!q || q.mode === 'once') return '';
    switch (q.mode) {
      case 'oneplus': return ' (one or more times)';
      case 'zeroplus': return ' (zero or more times)';
      case 'optional': return ' (optional)';
      case 'exact': return ` (exactly ${num(q.n, 1)} times)`;
      case 'range': {
        const n = num(q.n, 0);
        if (q.m === '' || q.m == null) return ` (${n} or more times)`;
        return ` (between ${n} and ${num(q.m, n)} times)`;
      }
      default: return '';
    }
  }

  // ----- condition registry -----
  // group: 'piece' is matched in sequence; 'assert' becomes a lookahead.
  // fields: dynamic inputs. quant: whether a repeat control is shown.

  const CHAR_OPTS = [
    ['digit', 'a digit', '\\d'],
    ['notdigit', 'a non-digit', '\\D'],
    ['letter', 'a letter', '[A-Za-z]'],
    ['upper', 'an uppercase letter', '[A-Z]'],
    ['lower', 'a lowercase letter', '[a-z]'],
    ['wordchar', 'a word character', '\\w'],
    ['notword', 'a non-word character', '\\W'],
    ['whitespace', 'whitespace', '\\s'],
    ['notspace', 'non-whitespace', '\\S'],
    ['any', 'any character', '.'],
  ];
  const CHAR_MAP = Object.fromEntries(CHAR_OPTS.map(([v, , re]) => [v, re]));
  const CHAR_LABEL = Object.fromEntries(CHAR_OPTS.map(([v, l]) => [v, l]));

  const FORMAT_OPTS = [
    ['email', 'an email address', '[\\w.+-]+@[\\w-]+\\.[\\w.-]+'],
    ['url', 'a URL', 'https?:\\/\\/[^\\s]+'],
    ['integer', 'a whole number', '-?\\d+'],
    ['decimal', 'a decimal number', '-?\\d+(?:\\.\\d+)?'],
    ['currency', 'a currency amount', '\\$\\d+(?:,\\d{3})*(?:\\.\\d{2})?'],
    ['date-iso', 'a date (YYYY-MM-DD)', '\\d{4}-\\d{2}-\\d{2}'],
    ['date-us', 'a date (M/D/YYYY)', '\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}'],
    ['time', 'a time (HH:MM)', '\\d{1,2}:\\d{2}(?::\\d{2})?'],
    ['phone-us', 'a US phone number', '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}'],
    ['ipv4', 'an IPv4 address', '(?:\\d{1,3}\\.){3}\\d{1,3}'],
    ['hex-color', 'a hex color', '#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})'],
    ['uuid', 'a UUID', '[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}'],
    ['zip-us', 'a US ZIP code', '\\d{5}(?:-\\d{4})?'],
  ];
  const FORMAT_MAP = Object.fromEntries(FORMAT_OPTS.map(([v, , re]) => [v, re]));
  const FORMAT_LABEL = Object.fromEntries(FORMAT_OPTS.map(([v, l]) => [v, l]));

  const COND = {
    literal: {
      label: 'The exact text…',
      group: 'piece',
      quant: true,
      fields: [{ key: 'text', kind: 'text', placeholder: 'exact text, e.g. cat' }],
      defaults: { text: '' },
      build: (c) => (c.text ? escLit(c.text) : ''),
      explain: (c) => `the text “${c.text}”`,
    },
    charType: {
      label: 'A character that is…',
      group: 'piece',
      quant: true,
      fields: [{ key: 'what', kind: 'select', options: CHAR_OPTS.map(([v, l]) => [v, l]) }],
      defaults: { what: 'digit' },
      defaultQ: { mode: 'oneplus', n: 1, m: 2 },
      build: (c) => CHAR_MAP[c.what] || '.',
      explain: (c) => CHAR_LABEL[c.what] || 'a character',
    },
    oneOf: {
      label: 'One of these words…',
      group: 'piece',
      quant: true,
      fields: [{ key: 'list', kind: 'text', placeholder: 'comma-separated, e.g. cat, dog, fish' }],
      defaults: { list: '' },
      build: (c) => {
        const parts = String(c.list || '')
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
          .map(escLit);
        return parts.length ? `(?:${parts.join('|')})` : '';
      },
      explain: (c) => {
        const parts = String(c.list || '').split(',').map((p) => p.trim()).filter(Boolean);
        return `one of: ${parts.map((p) => `“${p}”`).join(', ')}`;
      },
    },
    charSet: {
      label: 'One of these characters…',
      group: 'piece',
      quant: true,
      fields: [
        { key: 'chars', kind: 'text', placeholder: 'characters, e.g. aeiou' },
        { key: 'negate', kind: 'checkbox', label: 'none of these' },
      ],
      defaults: { chars: '', negate: false },
      build: (c) => (c.chars ? `[${c.negate ? '^' : ''}${escClass(c.chars)}]` : ''),
      explain: (c) => `${c.negate ? 'any character except' : 'one of the characters'} “${c.chars}”`,
    },
    format: {
      label: 'A common format…',
      group: 'piece',
      quant: false,
      fields: [{ key: 'preset', kind: 'select', options: FORMAT_OPTS.map(([v, l]) => [v, l]) }],
      defaults: { preset: 'email' },
      build: (c) => FORMAT_MAP[c.preset] || '',
      explain: (c) => FORMAT_LABEL[c.preset] || 'a known format',
    },
    contains: {
      label: 'Must contain…',
      group: 'assert',
      quant: false,
      fields: [{ key: 'text', kind: 'text', placeholder: 'text that must appear somewhere' }],
      defaults: { text: '' },
      build: (c) => (c.text ? `(?=.*${escLit(c.text)})` : ''),
      explain: (c) => `the text must contain “${c.text}”`,
    },
    notContains: {
      label: 'Must NOT contain…',
      group: 'assert',
      quant: false,
      fields: [{ key: 'text', kind: 'text', placeholder: 'text that must NOT appear' }],
      defaults: { text: '' },
      build: (c) => (c.text ? `(?!.*${escLit(c.text)})` : ''),
      explain: (c) => `the text must not contain “${c.text}”`,
    },
  };

  const COND_ORDER = ['literal', 'charType', 'oneOf', 'charSet', 'format', 'contains', 'notContains'];

  let idSeq = 1;
  function makeCond(type) {
    const def = COND[type];
    const c = { id: idSeq++, type, q: def.defaultQ ? { ...def.defaultQ } : { mode: 'once', n: 1, m: 2 } };
    Object.assign(c, def.defaults);
    return c;
  }

  // ----- assemble the regex -----

  function assemble(s) {
    const asserts = [];
    const pieces = [];
    for (const c of s.conds) {
      const def = COND[c.type];
      if (!def) continue;
      const frag = def.build(c);
      if (!frag) continue;
      if (def.group === 'assert') { asserts.push(frag); continue; }
      let piece = applyQuant(frag, def.quant ? c.q : null);
      if (c.capture) {
        const nm = sanitizeName(c.name);
        piece = nm ? `(?<${nm}>${piece})` : `(${piece})`;
      }
      pieces.push(piece);
    }
    let body = pieces.join('');
    if (asserts.length && body === '') body = '.*';
    if (s.wholeWord && body) body = `\\b${body}\\b`;
    const pattern = (s.anchorStart ? '^' : '') + asserts.join('') + body + (s.anchorEnd ? '$' : '');
    return pattern;
  }

  // Ordered descriptors for the capture groups assemble() emits, so group N in
  // a match maps back to its name. Mirrors the piece-building rules above.
  function captureGroups(s) {
    const groups = [];
    for (const c of s.conds) {
      const def = COND[c.type];
      if (!def || def.group === 'assert') continue;
      if (!def.build(c)) continue;
      if (c.capture) groups.push({ name: sanitizeName(c.name) });
    }
    return groups;
  }

  function flagsStr(s) {
    return ['g', 'i', 'm', 's'].filter((f) => s.flags[f]).join('');
  }

  function explainAll(s) {
    const out = [];
    if (s.anchorStart) out.push('Anchored to the start of the line/string (<code>^</code>).');
    s.conds.filter((c) => COND[c.type] && COND[c.type].group === 'assert')
      .forEach((c) => out.push(cap(COND[c.type].explain(c)) + '.'));
    const pieces = s.conds.filter((c) => COND[c.type] && COND[c.type].group !== 'assert' && COND[c.type].build(c));
    if (s.wholeWord && pieces.length) out.push('Matched as a whole word (word boundaries <code>\\b</code> on each side).');
    let groupNum = 0;
    pieces.forEach((c, i) => {
      const def = COND[c.type];
      const lead = i === 0 ? 'Match ' : 'then ';
      let s = lead + def.explain(c) + (def.quant ? quantPhrase(c.q) : '');
      if (c.capture) {
        groupNum++;
        const nm = sanitizeName(c.name);
        s += nm
          ? ` — captured as group ${groupNum}, named <code>${escapeHtml(nm)}</code>`
          : ` — captured as group ${groupNum}`;
      }
      out.push(s + '.');
    });
    if (s.anchorEnd) out.push('Anchored to the end of the line/string (<code>$</code>).');
    const fl = [];
    if (s.flags.g) fl.push('global — find every match');
    if (s.flags.i) fl.push('case-insensitive');
    if (s.flags.m) fl.push('multiline — <code>^</code>/<code>$</code> match each line');
    if (s.flags.s) fl.push('dotall — <code>.</code> matches newlines');
    if (fl.length) out.push('Flags: ' + fl.join(', ') + '.');
    return out;
  }
  function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  // ----- live test -----

  function runTest(pattern, flags, text) {
    if (!pattern) return { ok: true, count: 0, html: escapeHtml(text) };
    let re;
    try {
      re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
    } catch (e) {
      return { ok: false, error: e.message };
    }
    let html = '';
    let last = 0;
    let count = 0;
    let guard = 0;
    let first = null;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (guard++ > 10000) break;
      const start = m.index;
      const matched = m[0];
      html += escapeHtml(text.slice(last, start));
      if (matched) {
        html += '<mark>' + escapeHtml(matched) + '</mark>';
        count++;
        if (!first) first = m;
        last = start + matched.length;
      }
      if (matched === '') re.lastIndex++; // avoid zero-width infinite loop
    }
    html += escapeHtml(text.slice(last));
    return { ok: true, count, html, first };
  }

  // Render the captured groups of a match as HTML. `groups` is the ordered
  // descriptor list from captureGroups() — a named group is labelled by its
  // name only (no redundant $n, since JS numbers named groups too).
  function groupsHtml(m, groups) {
    if (!m || m.length <= 1) return '';
    const fmt = (v) => (v == null ? '<i>—</i>' : '“' + escapeHtml(v) + '”');
    let parts = '';
    for (let i = 1; i < m.length; i++) {
      const name = groups && groups[i - 1] ? groups[i - 1].name : '';
      const label = name ? escapeHtml(name) : `$${i}`;
      parts += `<span class="grp"><b>${label}</b> ${fmt(m[i])}</span>`;
    }
    return `<span class="grp-label">Groups in first match:</span>${parts}`;
  }

  // ----- URL state -----

  const HASH_PREFIX = '#r=';

  function defaultState() {
    return {
      v: 1,
      conds: [],
      anchorStart: false,
      anchorEnd: false,
      wholeWord: false,
      flags: { g: false, i: false, m: false, s: false },
      test: '',
    };
  }

  function encodeState(s) {
    // Drop runtime-only ids before serializing.
    const slim = {
      v: 1,
      conds: s.conds.map(({ id, ...rest }) => rest),
      anchorStart: s.anchorStart,
      anchorEnd: s.anchorEnd,
      wholeWord: s.wholeWord,
      flags: s.flags,
      test: s.test,
    };
    return LZString.compressToEncodedURIComponent(JSON.stringify(slim));
  }
  function decodeState(payload) {
    if (!payload) return null;
    try {
      const raw = LZString.decompressFromEncodedURIComponent(payload);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || p.v !== 1 || !Array.isArray(p.conds)) return null;
      p.conds = p.conds
        .filter((c) => COND[c.type])
        .map((c) => ({ id: idSeq++, q: { mode: 'once', n: 1, m: 2 }, ...c }));
      p.flags = Object.assign({ g: true, i: false, m: false, s: false }, p.flags || {});
      return p;
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
    const newHash = HASH_PREFIX + encodeState(state);
    if (location.hash !== newHash) {
      suppressHashChange = true;
      history.replaceState(null, '', newHash);
      Promise.resolve().then(() => { suppressHashChange = false; });
    }
  }

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

  // ----- starters -----
  const STARTERS = [
    {
      name: 'Whole numbers',
      apply: () => ({ conds: [withQ(makeCond('charType'), { mode: 'oneplus' }, { what: 'digit' })], anchorStart: false, anchorEnd: false, wholeWord: true }),
    },
    {
      name: 'Email addresses',
      apply: () => ({ conds: [setFields(makeCond('format'), { preset: 'email' })], wholeWord: false }),
    },
    {
      name: 'Contains a word',
      apply: () => ({ conds: [setFields(makeCond('contains'), { text: 'urgent' })], anchorStart: true }),
    },
    {
      name: 'Has X but not Y',
      apply: () => ({ conds: [setFields(makeCond('contains'), { text: 'invoice' }), setFields(makeCond('notContains'), { text: 'draft' })], anchorStart: true, anchorEnd: true }),
    },
    {
      name: 'Dates (YYYY-MM-DD)',
      apply: () => ({ conds: [setFields(makeCond('format'), { preset: 'date-iso' })] }),
    },
    {
      name: 'Hashtags',
      apply: () => ({ conds: [setFields(makeCond('literal'), { text: '#' }), withQ(makeCond('charType'), { mode: 'oneplus' }, { what: 'wordchar' })] }),
    },
  ];
  function setFields(c, fields) { return Object.assign(c, fields); }
  function withQ(c, q, fields) { Object.assign(c, fields); c.q = { mode: 'once', n: 1, m: 2, ...q }; return c; }

  function applyStarter(st) {
    const patch = st.apply();
    state = Object.assign(defaultState(), { test: state.test }, patch);
    render();
    syncURLNow();
    setStatus(`Loaded “${st.name}”.`, 'success');
  }

  // ----- state -----
  let state = decodeState(readHash()) || defaultState();

  // ----- rendering -----

  function findCond(id) { return state.conds.find((c) => String(c.id) === String(id)); }

  function fieldControl(c, f) {
    if (f.kind === 'text') {
      const v = escapeHtml(c[f.key] != null ? c[f.key] : '');
      return `<input type="text" data-key="${f.key}" value="${v}" placeholder="${escapeHtml(f.placeholder || '')}" />`;
    }
    if (f.kind === 'select') {
      const opts = f.options.map(([val, lab]) =>
        `<option value="${val}"${c[f.key] === val ? ' selected' : ''}>${escapeHtml(lab)}</option>`).join('');
      return `<select data-key="${f.key}">${opts}</select>`;
    }
    if (f.kind === 'checkbox') {
      return `<label class="inline"><input type="checkbox" data-key="${f.key}"${c[f.key] ? ' checked' : ''} /> ${escapeHtml(f.label || '')}</label>`;
    }
    return '';
  }

  function quantControl(c) {
    const q = c.q || { mode: 'once' };
    const opt = (v, l) => `<option value="${v}"${q.mode === v ? ' selected' : ''}>${l}</option>`;
    const showN = q.mode === 'exact' || q.mode === 'range';
    const showM = q.mode === 'range';
    return `<div class="cond-quant">
      <span>repeat</span>
      <select data-q="mode">
        ${opt('once', 'once')}
        ${opt('oneplus', '1 or more')}
        ${opt('zeroplus', '0 or more')}
        ${opt('optional', 'optional')}
        ${opt('exact', 'exactly…')}
        ${opt('range', 'between…')}
      </select>
      <input type="number" min="0" class="q-n" data-q="n" value="${num(q.n, 1)}"${showN ? '' : ' hidden'} />
      <input type="number" min="0" class="q-m" data-q="m" value="${q.m == null ? '' : q.m}" placeholder="max"${showM ? '' : ' hidden'} />
    </div>`;
  }

  function captureControl(c) {
    const on = !!c.capture;
    return `<div class="cond-capture">
      <label class="inline"><input type="checkbox" data-key="capture"${on ? ' checked' : ''} /> capture ( )</label>
      <input type="text" class="cap-name" data-key="name" value="${escapeHtml(c.name || '')}" placeholder="name (optional)"${on ? '' : ' hidden'} />
    </div>`;
  }

  function renderList() {
    const list = $('#cond-list');
    if (!state.conds.length) {
      list.innerHTML = `<p class="hint">No conditions yet — add one or pick a quick-start above.</p>`;
      return;
    }
    list.innerHTML = state.conds.map((c) => {
      const def = COND[c.type];
      const typeOpts = COND_ORDER.map((t) =>
        `<option value="${t}"${t === c.type ? ' selected' : ''}>${escapeHtml(COND[t].label)}</option>`).join('');
      const fields = def.fields.map((f) => fieldControl(c, f)).join('');
      return `<div class="cond-row${def.group === 'assert' ? ' is-assert' : ''}" data-id="${c.id}">
        <select class="cond-type" data-type-select>${typeOpts}</select>
        <div class="cond-fields">${fields}</div>
        ${def.quant ? quantControl(c) : ''}
        ${def.group === 'assert' ? '' : captureControl(c)}
        <div class="cond-actions">
          <button class="btn-icon" data-act="up" title="Move up">↑</button>
          <button class="btn-icon" data-act="down" title="Move down">↓</button>
          <button class="btn-icon" data-act="del" title="Remove">✕</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderOptions() {
    $('#opt-start').checked = state.anchorStart;
    $('#opt-end').checked = state.anchorEnd;
    $('#opt-word').checked = state.wholeWord;
    $('#flag-g').checked = state.flags.g;
    $('#flag-i').checked = state.flags.i;
    $('#flag-m').checked = state.flags.m;
    $('#flag-s').checked = state.flags.s;
  }

  let currentPattern = '';
  let currentFlags = '';
  function recompute() {
    const pattern = assemble(state);
    const flags = flagsStr(state);
    currentPattern = pattern;
    currentFlags = flags;

    const out = $('#regex-out');
    if (pattern) {
      out.textContent = `/${pattern}/${flags}`;
      out.classList.remove('is-empty');
    } else {
      out.textContent = '(add a condition to start building)';
      out.classList.add('is-empty');
    }

    $('#explain').innerHTML = explainAll(state).map((li) => `<li>${li}</li>`).join('');

    const res = runTest(pattern, flags, state.test);
    const testOut = $('#test-output');
    const count = $('#match-count');
    const groups = $('#test-groups');
    if (!res.ok) {
      testOut.classList.add('is-error');
      testOut.textContent = `Invalid regex: ${res.error}`;
      count.textContent = '';
      groups.innerHTML = '';
    } else {
      testOut.classList.remove('is-error');
      testOut.innerHTML = res.html;
      count.textContent = pattern ? `${res.count} match${res.count === 1 ? '' : 'es'}` : '';
      groups.innerHTML = groupsHtml(res.first, captureGroups(state));
    }
  }

  function render() {
    renderList();
    renderOptions();
    recompute();
  }

  // ----- wiring -----

  // Quick-start buttons
  const startersEl = $('#starters');
  STARTERS.forEach((st) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = st.name;
    b.addEventListener('click', () => applyStarter(st));
    startersEl.appendChild(b);
  });

  $('#add-cond').addEventListener('click', () => {
    state.conds.push(makeCond('literal'));
    render();
    syncURL();
  });

  // Delegated handling inside the condition list.
  const listEl = $('#cond-list');

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.cond-row');
    const id = row.dataset.id;
    const idx = state.conds.findIndex((c) => String(c.id) === String(id));
    if (idx < 0) return;
    const act = btn.dataset.act;
    if (act === 'del') state.conds.splice(idx, 1);
    else if (act === 'up' && idx > 0) [state.conds[idx - 1], state.conds[idx]] = [state.conds[idx], state.conds[idx - 1]];
    else if (act === 'down' && idx < state.conds.length - 1) [state.conds[idx + 1], state.conds[idx]] = [state.conds[idx], state.conds[idx + 1]];
    render();
    syncURL();
  });

  // Structural changes (type / quant mode) need a re-render; field edits don't.
  listEl.addEventListener('change', (e) => {
    const row = e.target.closest('.cond-row');
    if (!row) return;
    const c = findCond(row.dataset.id);
    if (!c) return;

    if (e.target.matches('[data-type-select]')) {
      const keepQ = c.q;
      const fresh = makeCond(e.target.value);
      fresh.id = c.id;
      if (!COND[e.target.value].defaultQ) fresh.q = keepQ;
      Object.assign(c, fresh);
      render();
      syncURL();
      return;
    }
    if (e.target.dataset.q === 'mode') {
      c.q.mode = e.target.value;
      render(); // toggles the n/m inputs
      syncURL();
      return;
    }
    // Toggling capture shows/hides the name field, so re-render the row.
    if (e.target.dataset.key === 'capture') {
      readControl(c, e.target);
      render();
      syncURL();
      return;
    }
    // checkbox / select field
    readControl(c, e.target);
    recompute();
    syncURL();
  });

  // Live typing in text/number inputs — update + recompute, no re-render.
  listEl.addEventListener('input', (e) => {
    const row = e.target.closest('.cond-row');
    if (!row) return;
    const c = findCond(row.dataset.id);
    if (!c) return;
    if (e.target.matches('[data-type-select]') || e.target.dataset.q === 'mode') return;
    readControl(c, e.target);
    recompute();
    syncURL();
  });

  function readControl(c, el) {
    const qKey = el.dataset.q;
    if (qKey) {
      c.q = c.q || { mode: 'once' };
      c.q[qKey] = qKey === 'mode' ? el.value : (el.value === '' ? '' : el.value);
      return;
    }
    const key = el.dataset.key;
    if (!key) return;
    c[key] = el.type === 'checkbox' ? el.checked : el.value;
  }

  // Options + flags
  const optBind = [
    ['#opt-start', 'anchorStart'],
    ['#opt-end', 'anchorEnd'],
    ['#opt-word', 'wholeWord'],
  ];
  optBind.forEach(([sel, key]) => {
    $(sel).addEventListener('change', (e) => { state[key] = e.target.checked; recompute(); syncURL(); });
  });
  ['g', 'i', 'm', 's'].forEach((f) => {
    $(`#flag-${f}`).addEventListener('change', (e) => { state.flags[f] = e.target.checked; recompute(); syncURL(); });
  });

  // Test text
  $('#test-input').addEventListener('input', (e) => { state.test = e.target.value; recompute(); syncURL(); });

  // Copy result buttons
  $$('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!currentPattern) { setStatus('Nothing to copy yet — add a condition.', 'error'); return; }
      const text = b.dataset.copy === 'slashes' ? `/${currentPattern}/${currentFlags}` : currentPattern;
      try {
        await navigator.clipboard.writeText(text);
        setStatus('Copied to clipboard.', 'success');
      } catch (e) {
        setStatus(`Copy failed: ${e.message}`, 'error');
      }
    });
  });

  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#copy-link').addEventListener('click', copyLink);

  window.addEventListener('hashchange', () => {
    if (suppressHashChange) return;
    state = decodeState(readHash()) || defaultState();
    $('#test-input').value = state.test;
    render();
  });

  window.addEventListener('beforeunload', syncURLNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncURLNow();
  });

  // ----- init -----
  // Start clean: load a shared link if the hash carries one, otherwise stay
  // empty and leave the URL untouched. The hash is only written once the user
  // actually changes something (see syncURL calls in the handlers above).
  applyTheme();
  $('#test-input').value = state.test;
  render();
})();

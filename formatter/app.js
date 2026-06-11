(function () {
  'use strict';

  // ----- helpers -----
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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

  // ----- elements -----
  const inputArea   = $('#inputArea');
  const outputBox   = $('#outputBox');
  const charCount   = $('#charCount');
  const lineCount   = $('#lineCount');
  const formatBtn   = $('#formatBtn');
  const copyBtn     = $('#copyBtn');
  const clearBtn    = $('#clearBtn');
  const dialectSel  = $('#dialectSelect');
  const dialectWrap = $('#dialectWrap');
  const lineLen     = $('#lineLen');
  const linelenWrap = $('#linelenWrap');
  const langToggle  = $('#langToggle');
  const sqlNote     = $('#sqlNote');
  const pyNote      = $('#pyNote');

  let currentLang = 'sql';

  // ----- lang toggle -----
  langToggle.addEventListener('click', e => {
    const btn = e.target.closest('button[data-lang]');
    if (!btn) return;
    $$('button', langToggle).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentLang = btn.dataset.lang;
    const isSql = currentLang === 'sql';
    dialectWrap.style.display = isSql ? '' : 'none';
    linelenWrap.style.display = isSql ? '' : 'none';
    sqlNote.style.display     = isSql ? '' : 'none';
    pyNote.style.display      = currentLang === 'python' ? '' : 'none';
    inputArea.placeholder = {
      sql:    'Paste your SQL here…',
      json:   'Paste your JSON here…',
      python: 'Paste your Python here…'
    }[currentLang];
    formatCode();
  });

  // ----- char count (live) -----
  inputArea.addEventListener('input', () => {
    const n = inputArea.value.length;
    charCount.textContent = n.toLocaleString() + ' char' + (n !== 1 ? 's' : '');
  });

  // ----- format triggers -----
  formatBtn.addEventListener('click', formatCode);
  dialectSel.addEventListener('change', () => { if (currentLang === 'sql') formatCode(); });
  lineLen.addEventListener('change',    () => { if (currentLang === 'sql') formatCode(); });

  inputArea.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      formatCode();
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // sqlfmt-style SQL formatter
  // Rules: lowercase everything (except quoted identifiers + string literals),
  // trailing commas, 4-space indent, short queries on one line,
  // hierarchy-aware wrapping at the configured line length.
  // ════════════════════════════════════════════════════════════════════════

  // Lowercase all tokens outside string literals and quoted identifiers
  function lowercaseAll(sql) {
    let result = '', i = 0;
    const s = sql;
    while (i < s.length) {
      const ch = s[i];
      if (ch === "'") {
        // single-quoted string literal — preserve exactly
        let j = i + 1;
        while (j < s.length) {
          if (s[j] === "'" && s[j - 1] !== '\\') { j++; break; }
          j++;
        }
        result += s.slice(i, j); i = j; continue;
      }
      if (ch === '"' || ch === '`') {
        // quoted identifier — preserve exactly
        const close = ch;
        let j = i + 1;
        while (j < s.length && s[j] !== close) j++;
        result += s.slice(i, j + 1); i = j + 1; continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i;
        while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
        result += s.slice(i, j).toLowerCase(); i = j; continue;
      }
      result += ch; i++;
    }
    return result;
  }

  // Top-level clause keywords — order matters (longer first to avoid partial match)
  const TOP_KW = [
    'union all','union','intersect','except',
    'insert into','delete from',
    'group by','order by',
    'with','select','from','where','having',
    'limit','offset','update','delete',
    'create','alter','drop','set',
  ];

  // Split a flat SQL string into clause objects {keyword, body}
  function splitClauses(sql) {
    const clauses = [];
    let depth = 0, inStr = false, strChar = '', cur = '', curKw = null;

    function flush(nextKw) {
      const body = cur.trim();
      if (curKw !== null || body) clauses.push({ keyword: curKw, body });
      cur = ''; curKw = nextKw;
    }

    let i = 0;
    while (i < sql.length) {
      const ch = sql[i];
      if (!inStr && (ch === "'" || ch === '"' || ch === '`')) {
        inStr = true; strChar = ch; cur += ch; i++; continue;
      }
      if (inStr) {
        cur += ch;
        if (ch === strChar && (ch !== "'" || sql[i - 1] !== '\\')) inStr = false;
        i++; continue;
      }
      if (ch === '(') { depth++; cur += ch; i++; continue; }
      if (ch === ')') { depth--; cur += ch; i++; continue; }

      if (depth === 0) {
        let hit = null;
        for (const kw of TOP_KW) {
          const re = new RegExp('^(' + kw.replace(/ /g, '\\s+') + ')(?=[\\s(,;]|$)', 'i');
          const m = re.exec(sql.slice(i));
          if (m) {
            const prev = i > 0 ? sql[i - 1] : ' ';
            if (/[\s;]/.test(prev) || i === 0) {
              hit = { kw, len: m[0].length }; break;
            }
          }
        }
        if (hit) { flush(hit.kw); i += hit.len; continue; }
      }
      cur += ch; i++;
    }
    flush(null);
    // remove trailing empty clause from flush(null)
    while (clauses.length && !clauses[clauses.length - 1].keyword && !clauses[clauses.length - 1].body)
      clauses.pop();
    return clauses;
  }

  // Split s by top-level commas (respects parens and strings)
  function splitCommas(s) {
    const parts = [];
    let depth = 0, inStr = false, strChar = '', cur = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (!inStr && (ch === "'" || ch === '"' || ch === '`')) { inStr = true; strChar = ch; cur += ch; continue; }
      if (inStr) { cur += ch; if (ch === strChar) inStr = false; continue; }
      if (ch === '(') { depth++; cur += ch; continue; }
      if (ch === ')') { depth--; cur += ch; continue; }
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }

  // Wrap a long expression that contains a top-level function call
  function wrapCall(line, maxLen, baseIndent) {
    const pi = line.indexOf('(');
    if (pi === -1 || (line.length + baseIndent) <= maxLen) return [line];
    const prefix = line.slice(0, pi + 1);
    const rest   = line.slice(pi + 1);
    let depth = 1, ci = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '(') depth++;
      else if (rest[i] === ')') { depth--; if (depth === 0) { ci = i; break; } }
    }
    if (ci === -1) return [line];
    const args   = rest.slice(0, ci);
    const suffix = rest.slice(ci);
    const parts  = splitCommas(args);
    if (parts.length <= 1) return [line];
    const ii = ' '.repeat(baseIndent + 4);
    const out = [prefix];
    parts.forEach((p, idx) => out.push(ii + p.trim() + (idx < parts.length - 1 ? ',' : '')));
    out.push(' '.repeat(baseIndent) + suffix.trim());
    return out;
  }

  // Main hierarchy formatter
  function reformatClauses(clauses, maxLen) {
    const lines = [];

    // sqlfmt rule: if entire statement fits on one line, keep it on one line
    const fullLine = clauses
      .map(c => [c.keyword, c.body].filter(Boolean).join(' '))
      .join(' ')
      .trim();
    if (fullLine.length <= maxLen) {
      return fullLine;
    }

    for (const { keyword: kw, body } of clauses) {
      const bodyTrimmed = (body || '').trim();
      if (!bodyTrimmed) { if (kw) lines.push(kw); continue; }

      const single = kw ? kw + ' ' + bodyTrimmed : bodyTrimmed;

      if (single.length <= maxLen) {
        lines.push(single);
        continue;
      }

      // Multi-line
      if (kw) lines.push(kw);
      const items = splitCommas(bodyTrimmed);
      if (items.length <= 1) {
        lines.push('    ' + bodyTrimmed);
      } else {
        items.forEach((item, idx) => {
          const isLast = idx === items.length - 1;
          const ln = item.trim() + (isLast ? '' : ',');
          if ((ln.length + 4) > maxLen) {
            wrapCall(ln, maxLen, 4).forEach(l => lines.push('    ' + l));
          } else {
            lines.push('    ' + ln);
          }
        });
      }
    }
    return lines.join('\n');
  }

  function formatSQL(raw, dialect, maxLen) {
    // 1. Use sql-formatter for baseline spacing/quoting normalisation
    const normed = sqlFormatter.format(raw, {
      language: dialect,
      tabWidth: 4,
      keywordCase: 'lower',
      indentStyle: 'standard',
    });
    // 2. Lowercase ALL tokens including function names, ASC/DESC etc.
    const lowered = lowercaseAll(normed);
    // 3. Flatten to single line, then re-apply sqlfmt hierarchy
    const flat = lowered.split('\n').map(l => l.trim()).filter(Boolean).join(' ');
    const clauses = splitClauses(flat);
    return reformatClauses(clauses, maxLen);
  }

  // ----- JSON formatter -----
  function formatJSON(raw) {
    return JSON.stringify(JSON.parse(raw), null, 2);
  }

  // ----- Python: real formatter (Ruff, black-compatible, via WASM) -----
  // Loaded lazily on first use so the wasm download only happens if someone
  // actually formats Python. Falls back to normalizePython() if it can't load.
  const RUFF_URL = 'https://cdn.jsdelivr.net/npm/@astral-sh/ruff-wasm-web@0.15.16/ruff_wasm.js';
  let ruffPromise = null;
  function loadRuff() {
    if (!ruffPromise) {
      ruffPromise = (async () => {
        const mod = await import(RUFF_URL);
        await mod.default(); // instantiate the wasm (auto-resolves the .wasm URL)
        return new mod.Workspace(mod.Workspace.defaultSettings(), mod.PositionEncoding.Utf16);
      })().catch((e) => { ruffPromise = null; throw e; });
    }
    return ruffPromise;
  }

  // ----- Python: lightweight fallback normalizer -----
  // String-aware layout tidy used only if Ruff fails to load (offline/CDN
  // blocked): re-indents to 4 spaces, cleans comma/internal spacing, collapses
  // extra blank lines — never touching strings, docstrings, or comments. It is
  // NOT a real reformatter; that's what Ruff above provides.
  function normalizePython(code) {
    const lines = code.split('\n');

    // Split one physical line into normal vs. protected (string|comment)
    // pieces, carrying triple-quoted-string state across lines.
    function scanLine(line, state) {
      const pieces = [];
      let i = 0, buf = '';
      const pushNormal = () => { if (buf) { pieces.push({ t: 'n', s: buf }); buf = ''; } };

      if (state) { // already inside a triple-quoted string
        const close = state;
        let prot = '';
        while (i < line.length) {
          if (line.startsWith(close, i)) { prot += close; i += 3; state = null; break; }
          prot += line[i++];
        }
        pieces.push({ t: 'p', s: prot });
        if (state) return { pieces, state };
      }

      while (i < line.length) {
        const ch = line[i];
        if (ch === '#') { pushNormal(); pieces.push({ t: 'p', s: line.slice(i) }); i = line.length; break; }
        if (ch === '"' || ch === "'") {
          const triple = line.substr(i, 3);
          if (triple === '"""' || triple === "'''") {
            pushNormal();
            const close = triple;
            let prot = close, j = i + 3, closed = false;
            while (j < line.length) {
              if (line.startsWith(close, j)) { prot += close; j += 3; closed = true; break; }
              prot += line[j++];
            }
            pieces.push({ t: 'p', s: prot });
            i = j;
            if (!closed) return { pieces, state: close };
            continue;
          }
          pushNormal();
          const q = ch; let prot = q, j = i + 1;
          while (j < line.length) {
            if (line[j] === '\\') { prot += line[j] + (line[j + 1] || ''); j += 2; continue; }
            if (line[j] === q) { prot += q; j++; break; }
            prot += line[j++];
          }
          pieces.push({ t: 'p', s: prot });
          i = j;
          continue;
        }
        buf += ch; i++;
      }
      pushNormal();
      return { pieces, state };
    }

    // Pass 1 — detect the source indent unit from lines that *start* in code
    // (not inside a triple-quoted string), so we re-indent at the right depth.
    let st = null;
    const startsNormal = lines.map(line => { const sn = st === null; st = scanLine(line, st).state; return sn; });
    const indents = [];
    lines.forEach((line, i) => {
      if (!startsNormal[i]) return;
      const m = line.match(/^([ \t]*)\S/);
      if (m) { const lead = m[1].replace(/\t/g, '    ').length; if (lead > 0) indents.push(lead); }
    });
    let unit = 4;
    if (indents.length) {
      const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
      unit = indents.reduce(gcd) || 4;
    }

    // Safe whitespace cleanups — applied only to non-string / non-comment text.
    function cleanNormal(s) {
      return s
        .replace(/[ \t]{2,}/g, ' ')        // collapse runs of spaces/tabs
        .replace(/[ \t]+,/g, ',')          // no space before a comma
        .replace(/,(?=\S)/g, ', ')         // exactly one space after a comma
        .replace(/([([{])[ \t]+/g, '$1')   // no padding just inside an opening bracket
        .replace(/[ \t]+([)\]}])/g, '$1'); // no padding just before a closing bracket
    }

    // Pass 2 — rebuild line by line.
    st = null;
    const rebuilt = lines.map(line => {
      const startNormal = st === null;
      if (!startNormal) { // interior of a triple-quoted string — emit verbatim
        st = scanLine(line, st).state;
        return { text: line, protectedLine: true };
      }
      const lead = (line.match(/^[ \t]*/) || [''])[0];
      const rest = line.slice(lead.length);
      const level = unit ? Math.round(lead.replace(/\t/g, '    ').length / unit) : 0;
      const r = scanLine(rest, null);
      st = r.state;
      const body = r.pieces.map(p => p.t === 'n' ? cleanNormal(p.s) : p.s).join('').replace(/[ \t]+$/, '');
      return { text: body ? ' '.repeat(level * 4) + body : '', protectedLine: false };
    });

    // Collapse 3+ blank lines to 2 — but never touch lines inside a string.
    const out = [];
    let blanks = 0;
    for (const ln of rebuilt) {
      if (!ln.protectedLine && ln.text === '') { if (++blanks <= 2) out.push(''); }
      else { blanks = 0; out.push(ln.text); }
    }
    return out.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  }

  // ----- main format -----
  let formatToken = 0;
  async function formatCode() {
    const raw = inputArea.value;
    const lang = currentLang;
    const token = ++formatToken; // guard against stale async results
    if (!raw.trim()) {
      setOutput('', false);
      lineCount.textContent = '';
      return;
    }
    try {
      let result;
      if (lang === 'sql') {
        const maxLen = parseInt(lineLen.value, 10) || 88;
        result = formatSQL(raw, dialectSel.value, maxLen);
      } else if (lang === 'json') {
        result = formatJSON(raw);
      } else {
        // Python — Ruff (real formatter); fall back to the normalizer if the
        // wasm can't be loaded. Syntax errors from Ruff surface as errors.
        let ws = null;
        try {
          setStatus('Loading Python formatter…');
          ws = await loadRuff();
          setStatus('');
        } catch (e) {
          ws = null;
          setStatus('Ruff unavailable — used the lightweight normalizer instead.', 'error');
        }
        if (token !== formatToken) return; // a newer format superseded this one
        result = ws ? ws.format(raw) : normalizePython(raw);
      }
      if (token !== formatToken) return;
      setOutput(result, false);
      const n = result.split('\n').length;
      lineCount.textContent = n.toLocaleString() + ' line' + (n !== 1 ? 's' : '');
    } catch (err) {
      if (token !== formatToken) return;
      setOutput('Error: ' + err.message, true);
      lineCount.textContent = '';
    }
  }

  function setOutput(text, isError) {
    outputBox.textContent = text;
    outputBox.classList.toggle('has-error', isError);
  }

  // ----- copy -----
  copyBtn.addEventListener('click', async () => {
    const text = outputBox.textContent;
    if (!text || outputBox.classList.contains('has-error')) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Output copied.', 'success');
    } catch (e) {
      setStatus(`Copy failed: ${e.message}`, 'error');
    }
  });

  clearBtn.addEventListener('click', () => {
    inputArea.value = '';
    setOutput('', false);
    charCount.textContent = '0 chars';
    lineCount.textContent = '';
  });

  // ----- theme wiring -----
  $('#theme-toggle').addEventListener('click', toggleTheme);

  // ----- init -----
  applyTheme();
})();

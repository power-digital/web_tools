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

  // ----- constants & state -----
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let currentMode = 'visual';
  let expr = { min: '*', hour: '*', dom: '*', month: '*', dow: '*' };

  // ----- tab switching -----
  $$('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.mode-tab').forEach(t => t.classList.remove('active'));
      $$('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      currentMode = tab.dataset.panel;
      $('#panel-' + currentMode).classList.add('active');
    });
  });

  // ----- build month chips -----
  const monthChips = $('#month_chips');
  MONTHS.forEach((m, i) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = m;
    chip.dataset.val = String(i + 1);
    chip.addEventListener('click', () => { chip.classList.toggle('selected'); buildFromVisual(); });
    monthChips.appendChild(chip);
  });

  // ----- build dow chips -----
  const dowChips = $('#dow_chips');
  DAYS.forEach((d, i) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = d;
    chip.dataset.val = String(i);
    chip.addEventListener('click', () => { chip.classList.toggle('selected'); buildFromVisual(); });
    dowChips.appendChild(chip);
  });

  // ----- sub-control builders -----
  function buildSubControls(field, type, min, max) {
    const sub = $('#' + field + '_sub');
    sub.innerHTML = '';
    if (type === 'every') { sub.style.display = 'none'; return; }
    sub.style.display = 'flex';

    if (type === 'specific') {
      if (field === 'month') { $('#month_chips').parentElement.style.display = 'flex'; return; }
      if (field === 'dow')   { $('#dow_chips').parentElement.style.display = 'flex'; return; }
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = min; inp.max = max; inp.value = min;
      inp.style.width = '5rem';
      sub.appendChild(inp);
      const lbl = document.createElement('span'); lbl.className = 'muted'; lbl.textContent = `(${min}–${max})`;
      sub.appendChild(lbl);
      inp.addEventListener('input', buildFromVisual);
    } else if (type === 'every_n') {
      const lbl1 = document.createElement('span'); lbl1.textContent = 'every';
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = 2; inp.max = max; inp.value = 2;
      const lbl2 = document.createElement('span'); lbl2.className = 'muted';
      lbl2.textContent = field === 'minute' ? 'minutes' : field === 'hour' ? 'hours' : field === 'dom' ? 'days' : 'months';
      [lbl1, inp, lbl2].forEach(el => sub.appendChild(el));
      inp.addEventListener('input', buildFromVisual);
    } else if (type === 'range') {
      const lbl1 = document.createElement('span'); lbl1.textContent = 'from';
      const from = document.createElement('input'); from.type = 'number'; from.min = min; from.max = max; from.value = min;
      const lbl2 = document.createElement('span'); lbl2.textContent = 'to';
      const to   = document.createElement('input'); to.type = 'number'; to.min = min; to.max = max; to.value = Math.min(min + 4, max);
      const lbl3 = document.createElement('span'); lbl3.className = 'muted'; lbl3.textContent = `(${min}–${max})`;
      [lbl1, from, lbl2, to, lbl3].forEach(el => sub.appendChild(el));
      from.addEventListener('input', buildFromVisual);
      to.addEventListener('input', buildFromVisual);
    }
  }

  // ----- wire up radio groups -----
  function wireField(field, min, max) {
    const radios = $$(`input[name="${field}_type"]`);
    radios.forEach(r => {
      r.addEventListener('change', () => {
        // update checked styling
        radios.forEach(rb => rb.closest('.radio-option').classList.toggle('checked', rb.checked));
        // hide chip containers by default
        if (field === 'month') $('#month_chips').parentElement.style.display = 'none';
        if (field === 'dow')   $('#dow_chips').parentElement.style.display = 'none';
        buildSubControls(field, r.value, min, max);
        buildFromVisual();
      });
    });
  }
  wireField('minute', 0, 59);
  wireField('hour',   0, 23);
  wireField('dom',    1, 31);
  wireField('month',  1, 12);
  wireField('dow',    0, 6);

  // ----- read visual → expr -----
  function getFieldValue(field, min, max) {
    const type = $(`input[name="${field}_type"]:checked`).value;
    if (type === 'every') return '*';
    if (type === 'weekdays') return '1-5';
    if (type === 'weekend')  return '0,6';

    if (type === 'specific') {
      if (field === 'month') {
        const sel = $$('#month_chips .chip.selected').map(c => c.dataset.val);
        return sel.length ? sel.join(',') : '*';
      }
      if (field === 'dow') {
        const sel = $$('#dow_chips .chip.selected').map(c => c.dataset.val);
        return sel.length ? sel.join(',') : '*';
      }
      const inp = $(`#${field}_sub input`);
      if (!inp) return '*';
      const v = parseInt(inp.value, 10);
      return isNaN(v) ? '*' : String(Math.max(min, Math.min(max, v)));
    }

    if (type === 'every_n') {
      const inp = $(`#${field}_sub input`);
      if (!inp) return '*';
      const n = parseInt(inp.value, 10);
      return isNaN(n) || n < 2 ? '*' : `*/${n}`;
    }

    if (type === 'range') {
      const inputs = $$(`#${field}_sub input`);
      if (inputs.length < 2) return '*';
      const from = parseInt(inputs[0].value, 10);
      const to   = parseInt(inputs[1].value, 10);
      if (isNaN(from) || isNaN(to)) return '*';
      return `${from}-${to}`;
    }
    return '*';
  }

  function buildFromVisual() {
    expr.min   = getFieldValue('minute', 0, 59);
    expr.hour  = getFieldValue('hour',   0, 23);
    expr.dom   = getFieldValue('dom',    1, 31);
    expr.month = getFieldValue('month',  1, 12);
    expr.dow   = getFieldValue('dow',    0, 6);
    syncManualFields();
    updateUI();
  }

  // ----- manual → expr -----
  ['m_min','m_hour','m_dom','m_month','m_dow'].forEach(id => {
    $('#' + id).addEventListener('input', () => {
      if (currentMode !== 'manual') return;
      expr.min   = $('#m_min').value.trim()   || '*';
      expr.hour  = $('#m_hour').value.trim()  || '*';
      expr.dom   = $('#m_dom').value.trim()   || '*';
      expr.month = $('#m_month').value.trim() || '*';
      expr.dow   = $('#m_dow').value.trim()   || '*';
      updateUI();
    });
  });

  function syncManualFields() {
    $('#m_min').value   = expr.min;
    $('#m_hour').value  = expr.hour;
    $('#m_dom').value   = expr.dom;
    $('#m_month').value = expr.month;
    $('#m_dow').value   = expr.dow;
  }

  // ----- presets -----
  const PRESETS = [
    { label: 'Every minute',        expr: '* * * * *',   desc: 'Runs every minute' },
    { label: 'Every 5 minutes',     expr: '*/5 * * * *', desc: 'Common for polling jobs' },
    { label: 'Every 15 minutes',    expr: '*/15 * * * *',desc: '' },
    { label: 'Every 30 minutes',    expr: '*/30 * * * *',desc: '' },
    { label: 'Every hour',          expr: '0 * * * *',   desc: 'On the hour, every hour' },
    { label: 'Every 6 hours',       expr: '0 */6 * * *', desc: 'At 00:00, 06:00, 12:00, 18:00' },
    { label: 'Daily at midnight',   expr: '0 0 * * *',   desc: 'dbt Cloud daily run default' },
    { label: 'Daily at 6 AM',       expr: '0 6 * * *',   desc: 'Morning refresh' },
    { label: 'Daily at 8 AM',       expr: '0 8 * * *',   desc: '' },
    { label: 'Weekdays at 9 AM',    expr: '0 9 * * 1-5', desc: 'Mon–Fri only' },
    { label: 'Weekdays at 7 AM',    expr: '0 7 * * 1-5', desc: 'Early weekday refresh' },
    { label: 'Weekly (Mon 9 AM)',   expr: '0 9 * * 1',   desc: 'Weekly report trigger' },
    { label: 'Monthly (1st, midnight)', expr: '0 0 1 * *',desc: 'Month-start runs' },
    { label: 'Quarterly (1st of Jan/Apr/Jul/Oct)', expr: '0 0 1 1,4,7,10 *', desc: '' },
    { label: 'First Mon of month',  expr: '0 9 1-7 * 1', desc: 'First Monday' },
    { label: 'Every Sunday at 2 AM',expr: '0 2 * * 0',   desc: 'Weekly maintenance window' },
  ];

  const grid = $('#presetsGrid');
  PRESETS.forEach(p => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.innerHTML = `<div class="preset-label">${p.label}</div><div class="preset-expr">${p.expr}</div>${p.desc ? `<div class="preset-desc">${p.desc}</div>` : ''}`;
    card.addEventListener('click', () => {
      const parts = p.expr.split(' ');
      expr.min   = parts[0];
      expr.hour  = parts[1];
      expr.dom   = parts[2];
      expr.month = parts[3];
      expr.dow   = parts[4];
      syncManualFields();
      updateUI();
    });
    grid.appendChild(card);
  });

  // ----- cron description -----
  function describe(e) {
    const { min, hour, dom, month, dow } = e;

    const minuteStr = (() => {
      if (min === '*') return null;
      if (min.startsWith('*/')) return `every ${min.slice(2)} minutes`;
      if (min.includes('-')) { const [a, b] = min.split('-'); return `minutes ${a}–${b}`; }
      if (min.includes(',')) return `at minutes ${min}`;
      return `at minute ${min}`;
    })();

    const hourStr = (() => {
      if (hour === '*') return null;
      if (hour.startsWith('*/')) return `every ${hour.slice(2)} hours`;
      if (hour.includes('-')) { const [a, b] = hour.split('-'); return `hours ${a}–${b}`; }
      if (hour.includes(',')) {
        return hour.split(',').map(h => fmtHour(parseInt(h, 10))).join(', ');
      }
      return fmtHour(parseInt(hour, 10));
    })();

    const dowStr = (() => {
      if (dow === '*') return null;
      if (dow === '1-5') return 'Monday–Friday';
      if (dow === '0,6' || dow === '6,0') return 'weekends';
      if (dow.includes('-')) { const [a, b] = dow.split('-'); return `${DAYS[+a]}–${DAYS[+b]}`; }
      const nums = dow.split(',').map(Number);
      if (nums.length) return nums.map(n => DAYS[n] || n).join(', ');
      return dow;
    })();

    const domStr = (() => {
      if (dom === '*') return null;
      if (dom.startsWith('*/')) return `every ${dom.slice(2)} days`;
      if (dom.includes('-')) { const [a, b] = dom.split('-'); return `days ${a}–${b} of the month`; }
      if (dom.includes(',')) return `on the ${dom} of the month`;
      const n = parseInt(dom, 10);
      return `on the ${ordinal(n)}`;
    })();

    const monthStr = (() => {
      if (month === '*') return null;
      const nums = month.split(',').map(Number);
      return 'in ' + nums.map(n => MONTHS[n - 1] || n).join(', ');
    })();

    if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'Runs every minute.';

    let when = '';
    if (min === '*' && hour === '*') when = 'every minute';
    else if (min.startsWith('*/') && hour === '*') when = minuteStr;
    else if (min === '*') when = `every minute past ${hourStr || 'every hour'}`;
    else if (hourStr) when = `${minuteStr ? minuteStr + ' past' : 'at'} ${hourStr}`;
    else when = minuteStr || 'every minute';

    const whens = [when, domStr, dowStr, monthStr].filter(Boolean);
    return 'Runs ' + whens.join(', ') + '.';
  }

  function fmtHour(h) {
    if (isNaN(h)) return h;
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:00 ${ampm}`;
  }
  function ordinal(n) {
    const s = ['th','st','nd','rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ----- next-run calculator (pure JS, no library) -----
  function matchField(value, n, min) {
    if (value === '*') return true;
    if (value.startsWith('*/')) {
      const step = parseInt(value.slice(2), 10);
      return (n - min) % step === 0;
    }
    const parts = value.split(',');
    for (const part of parts) {
      if (part.includes('-')) {
        const [lo, hi] = part.split('-').map(Number);
        if (n >= lo && n <= hi) return true;
      } else if (parseInt(part, 10) === n) return true;
    }
    return false;
  }

  function nextRuns(e, count = 8) {
    const { min, hour, dom, month, dow } = e;
    const runs = [];
    const start = new Date();
    start.setSeconds(0, 0);
    start.setMinutes(start.getMinutes() + 1); // start from next minute

    let d = new Date(start);
    let safety = 0;
    while (runs.length < count && safety < 200000) {
      safety++;
      const ok =
        matchField(min,   d.getMinutes(), 0) &&
        matchField(hour,  d.getHours(),   0) &&
        matchField(dom,   d.getDate(),    1) &&
        matchField(month, d.getMonth() + 1, 1) &&
        matchField(dow,   d.getDay(),     0);
      if (ok) runs.push(new Date(d));
      d.setMinutes(d.getMinutes() + 1);
    }
    return runs;
  }

  function relTime(d) {
    const diffMs = d - Date.now();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m`;
    const hrs = Math.floor(diffMin / 60);
    const rem = diffMin % 60;
    if (hrs < 24) return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
    const days = Math.floor(hrs / 24);
    const rh = hrs % 24;
    return rh ? `${days}d ${rh}h` : `${days}d`;
  }

  // ----- update UI -----
  function updateUI() {
    const { min, hour, dom, month, dow } = expr;
    const raw = `${min} ${hour} ${dom} ${month} ${dow}`;

    // expression tokens
    const fields = [
      { val: min,   label: 'min' },
      { val: hour,  label: 'hour' },
      { val: dom,   label: 'dom' },
      { val: month, label: 'month' },
      { val: dow,   label: 'dow' },
    ];
    $('#exprTokens').innerHTML = fields.map(f =>
      `<div class="token-wrap"><span class="expr-token${f.val !== '*' ? ' active' : ''}">${f.val}</span><span class="expr-label">${f.label}</span></div>`
    ).join('');

    $('#exprRaw').value = raw;
    $('#descriptionBox').textContent = describe(expr);

    // next runs
    const runs = nextRuns(expr);
    const tbody = $('#runsBody');
    if (runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="color:var(--muted)">Could not calculate — check the expression.</td></tr>';
    } else {
      tbody.innerHTML = runs.map((d, i) => {
        const fmt = d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<tr><td>${i + 1}</td><td>${fmt}</td><td class="relative">${relTime(d)}</td></tr>`;
      }).join('');
    }
  }

  // ----- copy -----
  async function copyExpr() {
    try {
      await navigator.clipboard.writeText($('#exprRaw').value);
      setStatus('Expression copied.', 'success');
    } catch (e) {
      setStatus(`Copy failed: ${e.message}`, 'error');
    }
  }

  // ----- wiring -----
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#copyExpr').addEventListener('click', copyExpr);
  $('#exprRaw').addEventListener('click', function () { this.select(); });

  // ----- init -----
  applyTheme();
  updateUI();
  // Refresh relative times every 30s
  setInterval(updateUI, 30000);
})();

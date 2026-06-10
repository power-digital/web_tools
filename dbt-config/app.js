(function () {
'use strict';

/* ------------------------------------------------------------------ *
 * dbt Config Generator
 * Builds plain JS objects from the form (omitting empty/optional keys)
 * and renders them to YAML with a small dependency-free emitter.
 * ------------------------------------------------------------------ */

// ---------- tiny YAML emitter ----------

function isScalar(v) {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function needsQuote(s) {
  if (s === '') return true;
  if (/^\s|\s$/.test(s)) return true;                  // leading/trailing space
  if (/^[-?:,#&*!|>'"%@`\[\]{}]/.test(s)) return true; // YAML indicator at start
  if (/:\s/.test(s) || /\s#/.test(s)) return true;     // "key: val" / inline comment
  if (/[,\[\]{}<>=]/.test(s)) return true;             // flow / version operators
  if (/[{}]/.test(s)) return true;                     // Jinja braces
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true; // reserved words
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return true; // number-like
  if (/^\d{4}-\d{1,2}-\d{1,2}([ Tt].*)?$/.test(s)) return true;      // YAML date / timestamp
  return false;
}

function scalar(v) {
  if (v === null) return 'null';
  if (typeof v !== 'string') return String(v);
  if (needsQuote(v)) return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return v;
}

// Render a value to YAML lines. Arrays nested under a key are indented one level.
function yamlify(value, indent) {
  const pad = '  '.repeat(indent);

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isScalar(item)) return pad + '- ' + scalar(item);
        const child = yamlify(item, indent + 1);
        const lines = child.split('\n');
        lines[0] = pad + '- ' + lines[0].slice((indent + 1) * 2);
        return lines.join('\n');
      })
      .join('\n');
  }

  // object
  const out = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (isScalar(v)) {
      out.push(pad + k + ': ' + scalar(v));
    } else if (Array.isArray(v)) {
      if (v.length === 0) out.push(pad + k + ': []');
      else out.push(pad + k + ':\n' + yamlify(v, indent + 1));
    } else {
      if (Object.keys(v).length === 0) out.push(pad + k + ': {}');
      else out.push(pad + k + ':\n' + yamlify(v, indent + 1));
    }
  }
  return out.join('\n');
}

// Recursively sort object keys a-z for deterministic output. Array element
// order is preserved (it can be semantically meaningful, e.g. hooks).
function deepSortKeys(value) {
  if (Array.isArray(value)) return value.map(deepSortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = deepSortKeys(value[k]);
    return out;
  }
  return value;
}

// ---------- small DOM helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const val = (el) => (el ? el.value.trim() : '');
const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

// ---------- build dbt_project.yml object ----------

function buildProject() {
  const obj = {};
  obj.name = val($('#p-name')) || 'my_dbt_project';

  const configVersion = val($('#p-config-version'));
  obj['config-version'] = configVersion ? Number(configVersion) : 2;

  obj.version = val($('#p-version')) || '1.0.0';
  obj.profile = val($('#p-profile')) || obj.name;

  const requireVersion = val($('#p-require-version'));
  if (requireVersion) obj['require-dbt-version'] = requireVersion;

  // paths — only emit when explicitly set
  const pathMap = {
    'model-paths': '#p-model-paths',
    'seed-paths': '#p-seed-paths',
    'test-paths': '#p-test-paths',
    'analysis-paths': '#p-analysis-paths',
    'macro-paths': '#p-macro-paths',
    'snapshot-paths': '#p-snapshot-paths',
    'clean-targets': '#p-clean-targets',
  };
  for (const [key, sel] of Object.entries(pathMap)) {
    const items = csv(val($(sel)));
    if (items.length) obj[key] = items;
  }

  // quoting — only emit set tri-state values
  const quoting = {};
  for (const part of ['database', 'schema', 'identifier']) {
    const v = val($('#p-quote-' + part));
    if (v === 'true') quoting[part] = true;
    else if (v === 'false') quoting[part] = false;
  }
  if (Object.keys(quoting).length) obj.quoting = quoting;

  // vars
  const vars = {};
  for (const row of $$('#var-rows .var-row')) {
    const key = val($('.v-key', row));
    if (!key) continue;
    const raw = val($('.v-val', row));
    vars[key] = coerce(raw);
  }
  if (Object.keys(vars).length) obj.vars = vars;

  // models — project-level default + per-folder overrides
  const modelInner = {};
  const defaultMat = val($('#p-materialized'));
  if (defaultMat) modelInner['+materialized'] = defaultMat;

  for (const row of $$('#model-rows .model-row')) {
    const path = val($('.m-path', row));
    if (!path) continue;
    const folder = {};
    const mat = val($('.m-materialized', row));
    const schema = val($('.m-schema', row));
    const tags = csv(val($('.m-tags', row)));
    if (mat) folder['+materialized'] = mat;
    if (schema) folder['+schema'] = schema;
    if (tags.length) folder['+tags'] = tags.length === 1 ? tags[0] : tags;
    if (Object.keys(folder).length) modelInner[path] = folder;
  }
  if (Object.keys(modelInner).length) obj.models = { [obj.name]: modelInner };

  // seeds — project-level defaults + per-folder overrides
  const seedInner = {};
  const seedSchema = val($('#seed-schema'));
  if (seedSchema) seedInner['+schema'] = seedSchema;
  const seedQuote = val($('#seed-quote-columns'));
  if (seedQuote === 'true') seedInner['+quote_columns'] = true;
  else if (seedQuote === 'false') seedInner['+quote_columns'] = false;

  for (const row of $$('#seed-rows .seed-row')) {
    const path = val($('.sd-path', row));
    if (!path) continue;
    const folder = {};
    const schema = val($('.sd-schema', row));
    const q = val($('.sd-quote', row));
    const tags = csv(val($('.sd-tags', row)));
    if (schema) folder['+schema'] = schema;
    if (q === 'true') folder['+quote_columns'] = true;
    else if (q === 'false') folder['+quote_columns'] = false;
    if (tags.length) folder['+tags'] = tags.length === 1 ? tags[0] : tags;
    if (Object.keys(folder).length) seedInner[path] = folder;
  }
  if (Object.keys(seedInner).length) obj.seeds = { [obj.name]: seedInner };

  // hooks
  const onStart = val($('#p-on-run-start')).split('\n').map((s) => s.trim()).filter(Boolean);
  const onEnd = val($('#p-on-run-end')).split('\n').map((s) => s.trim()).filter(Boolean);
  if (onStart.length) obj['on-run-start'] = onStart.length === 1 ? onStart[0] : onStart;
  if (onEnd.length) obj['on-run-end'] = onEnd.length === 1 ? onEnd[0] : onEnd;

  // Sort the keys of the nested config blocks a-z for deterministic output.
  // Top-level keys keep their conventional order (name, version, profile, …).
  if (obj.vars) obj.vars = deepSortKeys(obj.vars);
  if (obj.models) obj.models = deepSortKeys(obj.models);
  if (obj.seeds) obj.seeds = deepSortKeys(obj.seeds);

  return obj;
}

// Coerce a var string into whatever type it represents. JSON syntax unlocks
// the full range — lists, dicts (incl. nested), numbers, booleans, null, and
// quoted strings — while bare input falls back to bool/number/string.
function coerce(raw) {
  if (raw === '') return '';
  try {
    return JSON.parse(raw);
  } catch {
    if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(raw)) return Number(raw);
    return raw;
  }
}

// ---------- build sources.yml object ----------

// Read a freshness block from a source ('s') or table ('t') card.
// Returns null when the table explicitly disables freshness (freshness: null),
// undefined when nothing is set, or the freshness object otherwise.
function readFreshness(card, p) {
  const disable = $('.' + p + '-fresh-disable', card);
  if (disable && disable.checked) return null;

  const wc = val($('.' + p + '-warn-count', card));
  const wp = val($('.' + p + '-warn-period', card));
  const ec = val($('.' + p + '-error-count', card));
  const ep = val($('.' + p + '-error-period', card));
  const filter = val($('.' + p + '-fresh-filter', card));

  const fresh = {};
  if (wc && wp) fresh.warn_after = { count: Number(wc), period: wp };
  if (ec && ep) fresh.error_after = { count: Number(ec), period: ep };
  if (filter) fresh.filter = filter;
  return Object.keys(fresh).length ? fresh : undefined;
}

// Tri-state quoting block (database / schema / identifier) from a card.
function readQuoting(card, p) {
  const q = {};
  for (const part of ['database', 'schema', 'identifier']) {
    const v = val($('.' + p + '-quote-' + part, card));
    if (v === 'true') q[part] = true;
    else if (v === 'false') q[part] = false;
  }
  return Object.keys(q).length ? q : undefined;
}

// config.enabled tri-state → { enabled: bool } or undefined.
function readEnabled(el) {
  const v = val(el);
  if (v === 'true') return { enabled: true };
  if (v === 'false') return { enabled: false };
  return undefined;
}

// Parse a meta field as a JSON object (keys sorted); ignore anything else.
function readMeta(el) {
  const raw = val(el);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return deepSortKeys(v);
  } catch { /* ignore invalid JSON */ }
  return undefined;
}

function buildSources() {
  const sources = [];

  for (const card of $$('#source-cards .source-card')) {
    const name = val($('.s-name', card));
    if (!name) continue;

    const src = { name };
    const description = val($('.s-description', card));
    const database = val($('.s-database', card));
    const schema = val($('.s-schema', card));
    const loader = val($('.s-loader', card));
    const loadedAt = val($('.s-loaded-at', card));

    if (description) src.description = description;
    if (database) src.database = database;
    if (schema) src.schema = schema;
    if (loader) src.loader = loader;
    if (loadedAt) src.loaded_at_field = loadedAt;

    const tags = csv(val($('.s-tags', card)));
    if (tags.length) src.tags = tags;
    const meta = readMeta($('.s-meta', card));
    if (meta) src.meta = meta;
    const config = readEnabled($('.s-enabled', card));
    if (config) src.config = config;
    const quoting = readQuoting(card, 's');
    if (quoting) src.quoting = quoting;

    const fresh = readFreshness(card, 's');
    if (fresh) src.freshness = fresh;

    const tables = [];
    for (const tcard of $$('.tables .table-card', card)) {
      const tname = val($('.t-name', tcard));
      if (!tname) continue;

      const tbl = { name: tname };
      const tdesc = val($('.t-description', tcard));
      const ident = val($('.t-identifier', tcard));
      const tLoadedAt = val($('.t-loaded-at', tcard));
      if (tdesc) tbl.description = tdesc;
      if (ident) tbl.identifier = ident;
      if (tLoadedAt) tbl.loaded_at_field = tLoadedAt;

      const ttags = csv(val($('.t-tags', tcard)));
      if (ttags.length) tbl.tags = ttags;
      const tmeta = readMeta($('.t-meta', tcard));
      if (tmeta) tbl.meta = tmeta;
      const tconfig = readEnabled($('.t-enabled', tcard));
      if (tconfig) tbl.config = tconfig;

      const tfresh = readFreshness(tcard, 't');
      if (tfresh === null) tbl.freshness = null;
      else if (tfresh) tbl.freshness = tfresh;

      const columns = [];
      for (const crow of $$('.columns .column-card', tcard)) {
        const cname = val($('.c-name', crow));
        if (!cname) continue;
        const col = { name: cname };
        const cdesc = val($('.c-description', crow));
        if (cdesc) col.description = cdesc;

        const tests = [];
        if ($('.c-unique', crow).checked) tests.push('unique');
        if ($('.c-notnull', crow).checked) tests.push('not_null');
        const accepted = csv(val($('.c-accepted', crow)));
        if (accepted.length) tests.push({ accepted_values: { values: accepted } });
        const relTo = val($('.c-rel-to', crow));
        const relField = val($('.c-rel-field', crow));
        if (relTo && relField) tests.push({ relationships: { to: relTo, field: relField } });
        for (const extra of csv(val($('.c-tests', crow)))) tests.push(extra);
        if (tests.length) col.tests = tests;

        columns.push(col);
      }
      if (columns.length) {
        columns.sort((a, b) => a.name.localeCompare(b.name));
        tbl.columns = columns;
      }

      tables.push(tbl);
    }
    tables.sort((a, b) => a.name.localeCompare(b.name));
    src.tables = tables; // tables key is always present (empty list ok)

    sources.push(src);
  }

  sources.sort((a, b) => a.name.localeCompare(b.name));
  return { version: 2, sources };
}

// ---------- build packages.yml object ----------

// Parse the version field: a bare string passes through; a JSON list of
// version specifiers becomes a YAML list. Mirrors how dbt accepts either.
function coerceVersion(raw) {
  const s = raw.trim();
  if (!s) return '';
  if (s.startsWith('[')) {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
    } catch { /* fall through */ }
  }
  return s;
}

function buildPackages() {
  const packages = [];
  for (const card of $$('#package-cards .package-card')) {
    const type = card.dataset.pkgType || 'hub';
    if (type === 'hub') {
      const name = val($('.pk-hub-name', card));
      const version = val($('.pk-hub-version', card));
      if (!name || !version) continue;
      const entry = { package: name, version: coerceVersion(version) };
      const pre = val($('.pk-hub-prerelease', card));
      if (pre === 'true') entry['install-prerelease'] = true;
      else if (pre === 'false') entry['install-prerelease'] = false;
      packages.push(entry);
    } else if (type === 'git') {
      const url = val($('.pk-git-url', card));
      if (!url) continue;
      const entry = { git: url };
      const rev = val($('.pk-git-revision', card));
      const sub = val($('.pk-git-subdirectory', card));
      const warn = val($('.pk-git-warn-unpinned', card));
      if (rev) entry.revision = rev;
      if (sub) entry.subdirectory = sub;
      if (warn === 'true') entry['warn-unpinned'] = true;
      else if (warn === 'false') entry['warn-unpinned'] = false;
      packages.push(entry);
    } else if (type === 'local') {
      const path = val($('.pk-local-path', card));
      if (!path) continue;
      packages.push({ local: path });
    }
  }
  return { packages };
}

// ---------- render ----------

function render() {
  const project = buildProject();
  $('#out-project').textContent = yamlify(project, 0) + '\n';

  const sources = buildSources();
  if (sources.sources.length === 0) {
    $('#out-sources').textContent = 'version: 2\nsources: []\n';
  } else {
    $('#out-sources').textContent = yamlify(sources, 0) + '\n';
  }

  const packages = buildPackages();
  if (packages.packages.length === 0) {
    $('#out-packages').textContent = 'packages: []\n';
  } else {
    $('#out-packages').textContent = yamlify(packages, 0) + '\n';
  }
}

// ---------- dynamic rows ----------

function addFromTemplate(tplId, container) {
  const node = $('#' + tplId).content.firstElementChild.cloneNode(true);
  container.appendChild(node);
  return node;
}

function handleAdd(type, btn) {
  switch (type) {
    case 'var':
      addFromTemplate('tpl-var', $('#var-rows'));
      break;
    case 'model':
      addFromTemplate('tpl-model', $('#model-rows'));
      break;
    case 'seed':
      addFromTemplate('tpl-seed', $('#seed-rows'));
      break;
    case 'source':
      addFromTemplate('tpl-source', $('#source-cards'));
      break;
    case 'package':
      addFromTemplate('tpl-package', $('#package-cards'));
      break;
    case 'table': {
      const card = btn.closest('.source-card');
      addFromTemplate('tpl-table', $('.tables', card));
      break;
    }
    case 'column': {
      const tcard = btn.closest('.table-card');
      addFromTemplate('tpl-column', $('.columns', tcard));
      break;
    }
  }
  update();
}

// ---------- URL persistence (state lives in the #c= hash, like meeting-agenda) ----------

const HASH_PREFIX = '#c=';
const STATE_VERSION = 1;

const RAW = (sel, root = document) => { const el = $(sel, root); return el ? el.value : ''; };
const CHK = (sel, root = document) => { const el = $(sel, root); return el ? el.checked : false; };

function setControl(el, v) {
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!v;
  else el.value = v == null ? '' : v;
}

// Read the whole form into a plain serializable object.
function collectState() {
  const project = {
    name: RAW('#p-name'),
    profile: RAW('#p-profile'),
    version: RAW('#p-version'),
    configVersion: RAW('#p-config-version'),
    requireVersion: RAW('#p-require-version'),
    materialized: RAW('#p-materialized'),
    models: $$('#model-rows .model-row').map((r) => ({
      path: RAW('.m-path', r), materialized: RAW('.m-materialized', r),
      schema: RAW('.m-schema', r), tags: RAW('.m-tags', r),
    })),
    seedSchema: RAW('#seed-schema'),
    seedQuote: RAW('#seed-quote-columns'),
    seeds: $$('#seed-rows .seed-row').map((r) => ({
      path: RAW('.sd-path', r), schema: RAW('.sd-schema', r),
      quote: RAW('.sd-quote', r), tags: RAW('.sd-tags', r),
    })),
    vars: $$('#var-rows .var-row').map((r) => ({ key: RAW('.v-key', r), val: RAW('.v-val', r) })),
    advancedOpen: $('#advanced .group-toggle').getAttribute('aria-expanded') === 'true',
    modelPaths: RAW('#p-model-paths'),
    seedPaths: RAW('#p-seed-paths'),
    testPaths: RAW('#p-test-paths'),
    analysisPaths: RAW('#p-analysis-paths'),
    macroPaths: RAW('#p-macro-paths'),
    snapshotPaths: RAW('#p-snapshot-paths'),
    cleanTargets: RAW('#p-clean-targets'),
    quoteDatabase: RAW('#p-quote-database'),
    quoteSchema: RAW('#p-quote-schema'),
    quoteIdentifier: RAW('#p-quote-identifier'),
    onRunStart: RAW('#p-on-run-start'),
    onRunEnd: RAW('#p-on-run-end'),
  };

  const sources = $$('#source-cards .source-card').map((card) => ({
    name: RAW('.s-name', card),
    description: RAW('.s-description', card),
    database: RAW('.s-database', card),
    schema: RAW('.s-schema', card),
    loader: RAW('.s-loader', card),
    loadedAt: RAW('.s-loaded-at', card),
    warnCount: RAW('.s-warn-count', card),
    warnPeriod: RAW('.s-warn-period', card),
    errorCount: RAW('.s-error-count', card),
    errorPeriod: RAW('.s-error-period', card),
    freshFilter: RAW('.s-fresh-filter', card),
    enabled: RAW('.s-enabled', card),
    tags: RAW('.s-tags', card),
    meta: RAW('.s-meta', card),
    quoteDatabase: RAW('.s-quote-database', card),
    quoteSchema: RAW('.s-quote-schema', card),
    quoteIdentifier: RAW('.s-quote-identifier', card),
    tables: $$('.tables .table-card', card).map((tc) => ({
      name: RAW('.t-name', tc),
      description: RAW('.t-description', tc),
      identifier: RAW('.t-identifier', tc),
      loadedAt: RAW('.t-loaded-at', tc),
      freshDisable: CHK('.t-fresh-disable', tc),
      warnCount: RAW('.t-warn-count', tc),
      warnPeriod: RAW('.t-warn-period', tc),
      errorCount: RAW('.t-error-count', tc),
      errorPeriod: RAW('.t-error-period', tc),
      freshFilter: RAW('.t-fresh-filter', tc),
      enabled: RAW('.t-enabled', tc),
      tags: RAW('.t-tags', tc),
      meta: RAW('.t-meta', tc),
      columns: $$('.columns .column-card', tc).map((cr) => ({
        name: RAW('.c-name', cr),
        description: RAW('.c-description', cr),
        unique: CHK('.c-unique', cr),
        notNull: CHK('.c-notnull', cr),
        accepted: RAW('.c-accepted', cr),
        relTo: RAW('.c-rel-to', cr),
        relField: RAW('.c-rel-field', cr),
        tests: RAW('.c-tests', cr),
      })),
    })),
  }));

  const packages = $$('#package-cards .package-card').map((card) => ({
    type: card.dataset.pkgType || 'hub',
    hubName: RAW('.pk-hub-name', card),
    hubVersion: RAW('.pk-hub-version', card),
    hubPrerelease: RAW('.pk-hub-prerelease', card),
    gitUrl: RAW('.pk-git-url', card),
    gitRevision: RAW('.pk-git-revision', card),
    gitSubdirectory: RAW('.pk-git-subdirectory', card),
    gitWarnUnpinned: RAW('.pk-git-warn-unpinned', card),
    localPath: RAW('.pk-local-path', card),
  }));

  const activeTab = $('.tab.active') ? $('.tab.active').dataset.tab : 'project';
  return { v: STATE_VERSION, tab: activeTab, project, sources, packages };
}

// Rebuild the form from a previously collected state object.
function applyState(s) {
  const p = (s && s.project) || {};

  setControl($('#p-name'), p.name);
  setControl($('#p-profile'), p.profile);
  setControl($('#p-version'), p.version);
  setControl($('#p-config-version'), p.configVersion);
  setControl($('#p-require-version'), p.requireVersion);
  setControl($('#p-materialized'), p.materialized);
  setControl($('#seed-schema'), p.seedSchema);
  setControl($('#seed-quote-columns'), p.seedQuote);
  setControl($('#p-model-paths'), p.modelPaths);
  setControl($('#p-seed-paths'), p.seedPaths);
  setControl($('#p-test-paths'), p.testPaths);
  setControl($('#p-analysis-paths'), p.analysisPaths);
  setControl($('#p-macro-paths'), p.macroPaths);
  setControl($('#p-snapshot-paths'), p.snapshotPaths);
  setControl($('#p-clean-targets'), p.cleanTargets);
  setControl($('#p-quote-database'), p.quoteDatabase);
  setControl($('#p-quote-schema'), p.quoteSchema);
  setControl($('#p-quote-identifier'), p.quoteIdentifier);
  setControl($('#p-on-run-start'), p.onRunStart);
  setControl($('#p-on-run-end'), p.onRunEnd);

  const modelRows = $('#model-rows'); modelRows.innerHTML = '';
  (p.models || []).forEach((m) => {
    const r = addFromTemplate('tpl-model', modelRows);
    setControl($('.m-path', r), m.path);
    setControl($('.m-materialized', r), m.materialized);
    setControl($('.m-schema', r), m.schema);
    setControl($('.m-tags', r), m.tags);
  });

  const seedRows = $('#seed-rows'); seedRows.innerHTML = '';
  (p.seeds || []).forEach((sd) => {
    const r = addFromTemplate('tpl-seed', seedRows);
    setControl($('.sd-path', r), sd.path);
    setControl($('.sd-schema', r), sd.schema);
    setControl($('.sd-quote', r), sd.quote);
    setControl($('.sd-tags', r), sd.tags);
  });

  const varRows = $('#var-rows'); varRows.innerHTML = '';
  (p.vars || []).forEach((v) => {
    const r = addFromTemplate('tpl-var', varRows);
    setControl($('.v-key', r), v.key);
    setControl($('.v-val', r), v.val);
  });

  // Advanced section open/closed.
  const advToggle = $('#advanced .group-toggle');
  advToggle.setAttribute('aria-expanded', String(!!p.advancedOpen));
  $('#advanced .group-body').hidden = !p.advancedOpen;

  const sourceCards = $('#source-cards'); sourceCards.innerHTML = '';
  ((s && s.sources) || []).forEach((src) => {
    const card = addFromTemplate('tpl-source', sourceCards);
    setControl($('.s-name', card), src.name);
    setControl($('.s-description', card), src.description);
    setControl($('.s-database', card), src.database);
    setControl($('.s-schema', card), src.schema);
    setControl($('.s-loader', card), src.loader);
    setControl($('.s-loaded-at', card), src.loadedAt);
    setControl($('.s-warn-count', card), src.warnCount);
    setControl($('.s-warn-period', card), src.warnPeriod);
    setControl($('.s-error-count', card), src.errorCount);
    setControl($('.s-error-period', card), src.errorPeriod);
    setControl($('.s-fresh-filter', card), src.freshFilter);
    setControl($('.s-enabled', card), src.enabled);
    setControl($('.s-tags', card), src.tags);
    setControl($('.s-meta', card), src.meta);
    setControl($('.s-quote-database', card), src.quoteDatabase);
    setControl($('.s-quote-schema', card), src.quoteSchema);
    setControl($('.s-quote-identifier', card), src.quoteIdentifier);

    const tablesBox = $('.tables', card);
    (src.tables || []).forEach((t) => {
      const tc = addFromTemplate('tpl-table', tablesBox);
      setControl($('.t-name', tc), t.name);
      setControl($('.t-description', tc), t.description);
      setControl($('.t-identifier', tc), t.identifier);
      setControl($('.t-loaded-at', tc), t.loadedAt);
      setControl($('.t-fresh-disable', tc), t.freshDisable);
      setControl($('.t-warn-count', tc), t.warnCount);
      setControl($('.t-warn-period', tc), t.warnPeriod);
      setControl($('.t-error-count', tc), t.errorCount);
      setControl($('.t-error-period', tc), t.errorPeriod);
      setControl($('.t-fresh-filter', tc), t.freshFilter);
      setControl($('.t-enabled', tc), t.enabled);
      setControl($('.t-tags', tc), t.tags);
      setControl($('.t-meta', tc), t.meta);

      const colsBox = $('.columns', tc);
      (t.columns || []).forEach((c) => {
        const cr = addFromTemplate('tpl-column', colsBox);
        setControl($('.c-name', cr), c.name);
        setControl($('.c-description', cr), c.description);
        setControl($('.c-unique', cr), c.unique);
        setControl($('.c-notnull', cr), c.notNull);
        setControl($('.c-accepted', cr), c.accepted);
        setControl($('.c-rel-to', cr), c.relTo);
        setControl($('.c-rel-field', cr), c.relField);
        setControl($('.c-tests', cr), c.tests);
      });
    });
  });

  const packageCards = $('#package-cards'); packageCards.innerHTML = '';
  ((s && s.packages) || []).forEach((pkg) => {
    const card = addFromTemplate('tpl-package', packageCards);
    const type = pkg.type === 'git' || pkg.type === 'local' ? pkg.type : 'hub';
    card.dataset.pkgType = type;
    setControl($('.pk-type', card), type);
    setControl($('.pk-hub-name', card), pkg.hubName);
    setControl($('.pk-hub-version', card), pkg.hubVersion);
    setControl($('.pk-hub-prerelease', card), pkg.hubPrerelease);
    setControl($('.pk-git-url', card), pkg.gitUrl);
    setControl($('.pk-git-revision', card), pkg.gitRevision);
    setControl($('.pk-git-subdirectory', card), pkg.gitSubdirectory);
    setControl($('.pk-git-warn-unpinned', card), pkg.gitWarnUnpinned);
    setControl($('.pk-local-path', card), pkg.localPath);
  });

  selectTab((s && s.tab) || 'project');
}

function encodeState(s) {
  if (!window.LZString) return '';
  return LZString.compressToEncodedURIComponent(JSON.stringify(s));
}

function decodeState(payload) {
  if (!payload || !window.LZString) return null;
  try {
    const raw = LZString.decompressFromEncodedURIComponent(payload);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== STATE_VERSION) return null;
    return obj;
  } catch {
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
  const encoded = encodeState(collectState());
  if (!encoded) return;
  const newHash = HASH_PREFIX + encoded;
  if (location.hash !== newHash) {
    suppressHashChange = true;
    history.replaceState(null, '', newHash);
    Promise.resolve().then(() => { suppressHashChange = false; });
  }
}

// Render the output and persist to the URL — used for every user edit.
function update() {
  render();
  syncURL();
}

// ---------- wire up ----------

function selectTab(name) {
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
}

function setStatus(msg, kind) {
  const el = $('#status-line');
  el.textContent = msg;
  el.className = 'status-line' + (kind ? ' ' + kind : '');
  if (msg) setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.className = 'status-line'; } }, 2500);
}

function currentText(which) {
  const id = which === 'project' ? '#out-project' : which === 'sources' ? '#out-sources' : '#out-packages';
  return $(id).textContent;
}

async function copyOut(which) {
  try {
    await navigator.clipboard.writeText(currentText(which));
    setStatus('Copied ' + importFilename(which) + ' to clipboard.', 'success');
  } catch {
    setStatus('Copy failed — select the text and copy manually.', 'error');
  }
}

function downloadOut(which) {
  const filename = importFilename(which);
  const blob = new Blob([currentText(which)], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Downloaded ' + filename + '.', 'success');
}

async function copyLink() {
  syncURLNow();
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus('Link copied — anyone with the URL gets this exact config.', 'success');
  } catch {
    setStatus('Copy failed — copy the URL from the address bar.', 'error');
  }
}

// ---------- new / reset ----------

function blankState() {
  return {
    v: STATE_VERSION,
    tab: 'project',
    project: {
      name: 'my_dbt_project', profile: 'my_dbt_project', version: '1.0.0', configVersion: '2',
      requireVersion: '', materialized: '', models: [], seedSchema: '', seedQuote: '', seeds: [], vars: [],
      advancedOpen: false, modelPaths: '', seedPaths: '', testPaths: '', analysisPaths: '', macroPaths: '',
      snapshotPaths: '', cleanTargets: '', quoteDatabase: '', quoteSchema: '', quoteIdentifier: '',
      onRunStart: '', onRunEnd: '',
    },
    sources: [],
    packages: [],
  };
}

function formHasContent() {
  const s = collectState();
  const p = s.project;
  const rowHasValue = (row) => Object.values(row).some((v) => typeof v === 'string' ? v.trim() !== '' : !!v);
  const anySourceHasValue = s.sources.some((src) => {
    const { tables, ...flat } = src;
    if (rowHasValue(flat)) return true;
    return (tables || []).some((t) => {
      const { columns, ...tflat } = t;
      return rowHasValue(tflat) || (columns || []).some(rowHasValue);
    });
  });
  return !!(
    anySourceHasValue || s.packages.some(rowHasValue) ||
    p.models.some(rowHasValue) || p.seeds.some(rowHasValue) || p.vars.some(rowHasValue) ||
    (p.name && p.name !== 'my_dbt_project') || p.requireVersion || p.onRunStart || p.onRunEnd
  );
}

function newConfig() {
  if (formHasContent() && !confirm('Start a new config? The current one will be replaced — copy its link first if you want to keep it.')) return;
  applyState(blankState());
  render();
  syncURLNow();
}

// ---------- import existing YAML ----------

const str = (v) => (v == null ? '' : String(v));
const numStr = (v) => (v == null ? '' : String(v));
const listToCsv = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));
const hookToText = (v) => (Array.isArray(v) ? v.join('\n') : v == null ? '' : String(v));
const triState = (v) => (v === true ? 'true' : v === false ? 'false' : '');
const metaToInput = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : '');
const firstObjectValue = (o) => { const vals = Object.values(o); return vals.length ? vals[0] : null; };

// Convert a parsed var/scalar value back into the string a user would type.
function valToInput(v) {
  if (v == null) return 'null';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

// Map a parsed dbt_project.yml object into form state and apply it.
function importProject(doc) {
  const cur = collectState();
  const p = {
    name: str(doc.name),
    profile: str(doc.profile),
    version: str(doc.version),
    configVersion: doc['config-version'] != null ? String(doc['config-version']) : '',
    requireVersion: str(doc['require-dbt-version']),
    materialized: '',
    models: [],
    seedSchema: '',
    seedQuote: '',
    seeds: [],
    vars: [],
    advancedOpen: false,
    modelPaths: listToCsv(doc['model-paths']),
    seedPaths: listToCsv(doc['seed-paths']),
    testPaths: listToCsv(doc['test-paths']),
    analysisPaths: listToCsv(doc['analysis-paths']),
    macroPaths: listToCsv(doc['macro-paths']),
    snapshotPaths: listToCsv(doc['snapshot-paths']),
    cleanTargets: listToCsv(doc['clean-targets']),
    quoteDatabase: doc.quoting ? triState(doc.quoting.database) : '',
    quoteSchema: doc.quoting ? triState(doc.quoting.schema) : '',
    quoteIdentifier: doc.quoting ? triState(doc.quoting.identifier) : '',
    onRunStart: hookToText(doc['on-run-start']),
    onRunEnd: hookToText(doc['on-run-end']),
  };

  if (doc.vars && typeof doc.vars === 'object' && !Array.isArray(doc.vars)) {
    for (const [k, v] of Object.entries(doc.vars)) p.vars.push({ key: k, val: valToInput(v) });
  }

  if (doc.models && typeof doc.models === 'object') {
    const inner = doc.models[p.name] || firstObjectValue(doc.models) || {};
    if (inner && typeof inner === 'object') {
      for (const [k, v] of Object.entries(inner)) {
        if (k === '+materialized') { p.materialized = str(v); continue; }
        if (k.startsWith('+')) continue;
        if (v && typeof v === 'object') {
          p.models.push({ path: k, materialized: str(v['+materialized']), schema: str(v['+schema']), tags: listToCsv(v['+tags']) });
        }
      }
    }
  }

  if (doc.seeds && typeof doc.seeds === 'object') {
    const inner = doc.seeds[p.name] || firstObjectValue(doc.seeds) || {};
    if (inner && typeof inner === 'object') {
      p.seedSchema = str(inner['+schema']);
      p.seedQuote = triState(inner['+quote_columns']);
      for (const [k, v] of Object.entries(inner)) {
        if (k.startsWith('+')) continue;
        if (v && typeof v === 'object') {
          p.seeds.push({ path: k, schema: str(v['+schema']), quote: triState(v['+quote_columns']), tags: listToCsv(v['+tags']) });
        }
      }
    }
  }

  p.advancedOpen = !!(p.modelPaths || p.seedPaths || p.testPaths || p.analysisPaths || p.macroPaths ||
    p.snapshotPaths || p.cleanTargets || p.quoteDatabase || p.quoteSchema || p.quoteIdentifier || p.onRunStart || p.onRunEnd);

  applyState({ v: STATE_VERSION, tab: 'project', project: p, sources: cur.sources });
}

function freshnessToState(f, target) {
  if (f && typeof f === 'object') {
    if (f.warn_after) { target.warnCount = numStr(f.warn_after.count); target.warnPeriod = str(f.warn_after.period); }
    if (f.error_after) { target.errorCount = numStr(f.error_after.count); target.errorPeriod = str(f.error_after.period); }
    target.freshFilter = str(f.filter);
  }
}

// Map a parsed sources.yml object into form state and apply it.
function importSources(doc) {
  const cur = collectState();
  const list = Array.isArray(doc && doc.sources) ? doc.sources : [];

  const sources = list.map((src) => {
    const s = {
      name: str(src.name), description: str(src.description), database: str(src.database),
      schema: str(src.schema), loader: str(src.loader), loadedAt: str(src.loaded_at_field),
      warnCount: '', warnPeriod: '', errorCount: '', errorPeriod: '', freshFilter: '',
      enabled: src.config ? triState(src.config.enabled) : '',
      tags: listToCsv(src.tags), meta: metaToInput(src.meta),
      quoteDatabase: src.quoting ? triState(src.quoting.database) : '',
      quoteSchema: src.quoting ? triState(src.quoting.schema) : '',
      quoteIdentifier: src.quoting ? triState(src.quoting.identifier) : '',
      tables: [],
    };
    freshnessToState(src.freshness, s);

    const tables = Array.isArray(src.tables) ? src.tables : [];
    s.tables = tables.map((t) => {
      const tbl = {
        name: str(t.name), description: str(t.description), identifier: str(t.identifier), loadedAt: str(t.loaded_at_field),
        freshDisable: t.freshness === null,
        warnCount: '', warnPeriod: '', errorCount: '', errorPeriod: '', freshFilter: '',
        enabled: t.config ? triState(t.config.enabled) : '',
        tags: listToCsv(t.tags), meta: metaToInput(t.meta),
        columns: [],
      };
      freshnessToState(t.freshness, tbl);

      const cols = Array.isArray(t.columns) ? t.columns : [];
      tbl.columns = cols.map((c) => {
        const col = { name: str(c.name), description: str(c.description), unique: false, notNull: false, accepted: '', relTo: '', relField: '', tests: '' };
        const other = [];
        const tests = Array.isArray(c.tests) ? c.tests : (Array.isArray(c.data_tests) ? c.data_tests : []);
        for (const test of tests) {
          if (test === 'unique') col.unique = true;
          else if (test === 'not_null') col.notNull = true;
          else if (typeof test === 'string') other.push(test);
          else if (test && typeof test === 'object') {
            if (test.accepted_values && test.accepted_values.values) col.accepted = listToCsv(test.accepted_values.values);
            else if (test.relationships) { col.relTo = str(test.relationships.to); col.relField = str(test.relationships.field); }
          }
        }
        col.tests = other.join(', ');
        return col;
      });
      return tbl;
    });
    return s;
  });

  applyState({ v: STATE_VERSION, tab: 'sources', project: cur.project, sources });
}

// Map a parsed packages.yml object back into form state and apply it.
function importPackages(doc) {
  const cur = collectState();
  const list = Array.isArray(doc && doc.packages) ? doc.packages : [];
  const packages = list.map((pkg) => {
    if (pkg && typeof pkg === 'object') {
      if (pkg.local != null) {
        return {
          type: 'local',
          hubName: '', hubVersion: '', hubPrerelease: '',
          gitUrl: '', gitRevision: '', gitSubdirectory: '', gitWarnUnpinned: '',
          localPath: str(pkg.local),
        };
      }
      if (pkg.git != null) {
        return {
          type: 'git',
          hubName: '', hubVersion: '', hubPrerelease: '',
          gitUrl: str(pkg.git),
          gitRevision: str(pkg.revision),
          gitSubdirectory: str(pkg.subdirectory),
          gitWarnUnpinned: triState(pkg['warn-unpinned']),
          localPath: '',
        };
      }
      if (pkg.package != null) {
        const version = Array.isArray(pkg.version)
          ? JSON.stringify(pkg.version)
          : (pkg.version == null ? '' : String(pkg.version));
        return {
          type: 'hub',
          hubName: str(pkg.package),
          hubVersion: version,
          hubPrerelease: triState(pkg['install-prerelease']),
          gitUrl: '', gitRevision: '', gitSubdirectory: '', gitWarnUnpinned: '',
          localPath: '',
        };
      }
    }
    return null;
  }).filter(Boolean);

  applyState({ v: STATE_VERSION, tab: 'packages', project: cur.project, sources: cur.sources, packages });
}

let importTarget = 'project';

function importFilename(which) {
  if (which === 'project') return 'dbt_project.yml';
  if (which === 'sources') return 'sources.yml';
  return 'packages.yml';
}

function openImport(which) {
  importTarget = which;
  $('#import-filename').textContent = importFilename(which);
  $('#import-text').value = '';
  $('#import-file').value = '';
  $('#import-error').textContent = '';
  $('#import-dialog').showModal();
}

function doImport() {
  const text = $('#import-text').value;
  const err = $('#import-error');
  if (!text.trim()) { err.textContent = 'Nothing to import — paste YAML or choose a file.'; return; }
  if (!window.jsyaml) { err.textContent = 'YAML parser failed to load (offline?).'; return; }
  let doc;
  try {
    doc = jsyaml.load(text);
  } catch (e) {
    err.textContent = 'Could not parse YAML: ' + e.message;
    return;
  }
  if (!doc || typeof doc !== 'object') { err.textContent = "That doesn't look like a YAML document."; return; }
  try {
    if (importTarget === 'project') importProject(doc);
    else if (importTarget === 'sources') importSources(doc);
    else importPackages(doc);
  } catch (e) {
    err.textContent = 'Import failed: ' + e.message;
    return;
  }
  $('#import-dialog').close();
  render();
  syncURLNow();
  setStatus('Imported ' + importFilename(importTarget) + '.', 'success');
}

function init() {
  // Theme toggle (shared convention with the rest of the site: web_tools.theme).
  const root = document.documentElement;
  const toggle = $('#theme-toggle');
  const themeColor = $('#theme-color');
  const syncToggle = () => {
    const dark = root.dataset.theme === 'dark';
    toggle.textContent = dark ? '☀' : '🌙';
    toggle.setAttribute('aria-pressed', String(dark));
    if (themeColor) themeColor.setAttribute('content', dark ? '#15151a' : '#fafaf7');
  };
  syncToggle();
  toggle.addEventListener('click', () => {
    const dark = root.dataset.theme !== 'dark';
    root.dataset.theme = dark ? 'dark' : '';
    localStorage.setItem('web_tools.theme', dark ? 'dark' : 'light');
    syncToggle();
  });

  // Tabs
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => { selectTab(tab.dataset.tab); syncURL(); });
  });

  // Advanced collapsible
  const advToggle = $('#advanced .group-toggle');
  advToggle.addEventListener('click', () => {
    const open = advToggle.getAttribute('aria-expanded') === 'true';
    advToggle.setAttribute('aria-expanded', String(!open));
    $('#advanced .group-body').hidden = open;
    syncURL();
  });

  // Package-type select swaps the card's visible field group via [data-pkg-type].
  document.addEventListener('change', (e) => {
    const sel = e.target.closest('.pk-type');
    if (!sel) return;
    const card = sel.closest('.package-card');
    if (card) card.dataset.pkgType = sel.value;
  });

  // Live regenerate + persist on any input change.
  document.addEventListener('input', update);
  document.addEventListener('change', update);

  // Delegated clicks for add / remove / copy / download / share.
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-add]');
    if (addBtn) { handleAdd(addBtn.dataset.add, addBtn); return; }

    const removeBtn = e.target.closest('.row-remove');
    if (removeBtn) { removeBtn.closest('.row, .card').remove(); update(); return; }

    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) { copyOut(copyBtn.dataset.copy); return; }

    const dlBtn = e.target.closest('[data-download]');
    if (dlBtn) { downloadOut(dlBtn.dataset.download); return; }

    const importBtn = e.target.closest('[data-import]');
    if (importBtn) { openImport(importBtn.dataset.import); return; }
  });

  $('#new-config').addEventListener('click', newConfig);
  $('#copy-link').addEventListener('click', copyLink);
  $('#import-load').addEventListener('click', doImport);
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { $('#import-text').value = reader.result; };
    reader.readAsText(file);
  });

  // Reload state when the hash changes from outside (back/forward, pasted link).
  window.addEventListener('hashchange', () => {
    if (suppressHashChange) return;
    const loaded = decodeState(readHash());
    if (loaded) { applyState(loaded); render(); }
  });

  // Best-effort flush of the latest state to the URL when leaving/hiding.
  window.addEventListener('beforeunload', syncURLNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncURLNow();
  });

  // Restore from the URL if present, otherwise seed empty rows so the
  // structure is visible (placeholders show suggested values).
  const loaded = decodeState(readHash());
  if (loaded) {
    applyState(loaded);
  } else {
    addFromTemplate('tpl-model', $('#model-rows'));
    const firstSource = addFromTemplate('tpl-source', $('#source-cards'));
    addFromTemplate('tpl-table', $('.tables', firstSource));
    addFromTemplate('tpl-package', $('#package-cards'));
  }

  // Start clean: a shared link loads above; a fresh visit stays empty and
  // leaves the URL untouched. The hash is only written once the user actually
  // changes something (see syncURL calls in the handlers above).
  render();
}

document.addEventListener('DOMContentLoaded', init);
})();

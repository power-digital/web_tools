(function () {
  'use strict';

  const HASH_PREFIX = '#m=';

  const uid = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const todayISO = () => new Date().toISOString().slice(0, 10);

  const newItem = () => ({
    id: uid(),
    title: '',
    allottedMin: null,
    notes: '',
    done: false,
    elapsedSec: 0
  });

  const blankMeeting = () => ({
    title: '',
    date: todayISO(),
    attendees: '',
    items: [newItem()]
  });

  // ----- URL <-> state encoding -----

  function encodeMeeting(m) {
    const compact = {
      v: 1,
      t: m.title || '',
      d: m.date || '',
      a: m.attendees || '',
      i: (m.items || []).map((it) => ({
        t: it.title || '',
        m: it.allottedMin == null ? null : Number(it.allottedMin),
        n: it.notes || '',
        x: !!it.done,
        e: Number(it.elapsedSec) || 0
      }))
    };
    return LZString.compressToEncodedURIComponent(JSON.stringify(compact));
  }

  function decodeMeeting(hash) {
    if (!hash) return null;
    try {
      const raw = LZString.decompressFromEncodedURIComponent(hash);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || c.v !== 1) return null;
      const items = (Array.isArray(c.i) ? c.i : []).map((it) => ({
        id: uid(),
        title: it.t || '',
        allottedMin: it.m == null ? null : Number(it.m),
        notes: it.n || '',
        done: !!it.x,
        elapsedSec: Number(it.e) || 0
      }));
      if (items.length === 0) items.push(newItem());
      return {
        title: c.t || '',
        date: c.d || todayISO(),
        attendees: c.a || '',
        items
      };
    } catch (e) {
      console.warn('decodeMeeting failed', e);
      return null;
    }
  }

  function readHash() {
    const h = location.hash || '';
    if (!h.startsWith(HASH_PREFIX)) return '';
    return h.slice(HASH_PREFIX.length);
  }

  function loadMeeting() {
    const payload = readHash();
    if (!payload) return blankMeeting();
    const m = decodeMeeting(payload);
    if (!m) {
      setStatus('Could not read meeting from URL — starting blank.', 'error');
      return blankMeeting();
    }
    return m;
  }

  // ----- state -----

  let meeting = loadMeeting();
  let suppressHashChange = false;

  let urlTimer = null;
  function syncURL() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(syncURLNow, 250);
  }
  function syncURLNow() {
    clearTimeout(urlTimer);
    const encoded = encodeMeeting(meeting);
    const newHash = HASH_PREFIX + encoded;
    if (location.hash !== newHash) {
      suppressHashChange = true;
      history.replaceState(null, '', newHash);
      Promise.resolve().then(() => { suppressHashChange = false; });
    }
  }

  // ----- helpers -----

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function fmtTime(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
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

  // ----- timer (single active timer) -----

  let activeTimer = { itemId: null, intervalId: null };

  function startTimer(itemId) {
    if (activeTimer.itemId === itemId) return;
    if (activeTimer.itemId) stopTimer();
    activeTimer.itemId = itemId;
    activeTimer.intervalId = setInterval(() => {
      const item = meeting.items.find((i) => i.id === itemId);
      if (!item) return stopTimer();
      item.elapsedSec = (item.elapsedSec || 0) + 1;
      updateTimerDisplay(item);
      if (item.elapsedSec % 5 === 0) syncURLNow();
    }, 1000);
    updateItemControls(itemId);
  }

  function stopTimer() {
    if (activeTimer.intervalId) clearInterval(activeTimer.intervalId);
    const prevId = activeTimer.itemId;
    activeTimer = { itemId: null, intervalId: null };
    syncURLNow();
    if (prevId) updateItemControls(prevId);
  }

  function updateTimerDisplay(item) {
    const li = $(`.item[data-id="${item.id}"]`);
    if (!li) return;
    $('.timer-display', li).textContent = fmtTime(item.elapsedSec);
    const over = item.allottedMin && item.elapsedSec > item.allottedMin * 60;
    $('.timer', li).classList.toggle('over', !!over);
  }

  function updateItemControls(itemId) {
    const li = $(`.item[data-id="${itemId}"]`);
    if (!li) return;
    const running = activeTimer.itemId === itemId;
    $('.timer-start', li).hidden = running;
    $('.timer-pause', li).hidden = !running;
    li.classList.toggle('active', running);
  }

  // ----- markdown -----

  const previewItems = new Set();

  if (window.marked) {
    marked.setOptions({ gfm: true, breaks: true });
  }

  function renderMarkdown(src) {
    if (!window.marked || !window.DOMPurify) return src;
    const html = marked.parse(src || '');
    return DOMPurify.sanitize(html);
  }

  function setItemPreview(li, item, on) {
    const ta = $('.item-notes', li);
    const rendered = $('.item-notes-rendered', li);
    const toggle = $('.notes-toggle', li);
    if (!ta || !rendered || !toggle) return;
    if (on) {
      const src = item.notes || '';
      if (src.trim()) {
        rendered.innerHTML = renderMarkdown(src);
        rendered.classList.remove('empty');
      } else {
        rendered.textContent = 'No notes yet — click to add.';
        rendered.classList.add('empty');
      }
      ta.hidden = true;
      rendered.hidden = false;
      toggle.textContent = '✎';
      toggle.title = 'Edit notes';
    } else {
      ta.hidden = false;
      rendered.hidden = true;
      toggle.textContent = '👁';
      toggle.title = 'Preview markdown';
    }
  }

  function toggleItemPreview(li, itemId) {
    const item = meeting.items.find((i) => i.id === itemId);
    if (!item) return;
    if (previewItems.has(itemId)) {
      previewItems.delete(itemId);
      setItemPreview(li, item, false);
      $('.item-notes', li).focus();
    } else {
      previewItems.add(itemId);
      setItemPreview(li, item, true);
    }
    updatePreviewAllButton();
  }

  function allItemsInPreview() {
    return meeting.items.length > 0 && meeting.items.every((i) => previewItems.has(i.id));
  }

  function updatePreviewAllButton() {
    const btn = $('#preview-all');
    if (!btn) return;
    if (allItemsInPreview()) {
      btn.textContent = '✎ Edit all';
      btn.title = 'Switch all items back to edit mode';
    } else {
      btn.textContent = '👁 Preview all';
      btn.title = 'Render markdown preview for all items';
    }
  }

  function toggleAllPreview() {
    if (meeting.items.length === 0) return;
    const goingToPreview = !allItemsInPreview();
    meeting.items.forEach((item) => {
      const li = $(`.item[data-id="${item.id}"]`);
      if (!li) return;
      if (goingToPreview) {
        previewItems.add(item.id);
        setItemPreview(li, item, true);
      } else {
        previewItems.delete(item.id);
        setItemPreview(li, item, false);
      }
    });
    updatePreviewAllButton();
  }

  function autocompleteListOnEnter(e) {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
    const ta = e.target;
    const v = ta.value;
    const cursor = ta.selectionStart;
    if (cursor !== ta.selectionEnd) return;
    const lineStart = v.lastIndexOf('\n', cursor - 1) + 1;
    const line = v.slice(lineStart, cursor);

    const bullet = line.match(/^(\s*)([-*+])\s(\[[ xX]\]\s)?(.*)$/);
    const numbered = line.match(/^(\s*)(\d+)\.\s(.*)$/);

    if (bullet) {
      const [, indent, marker, task, content] = bullet;
      e.preventDefault();
      if (content === '') {
        const newValue = v.slice(0, lineStart) + '\n' + v.slice(cursor);
        ta.value = newValue;
        const pos = lineStart + 1;
        ta.selectionStart = ta.selectionEnd = pos;
      } else {
        const insert = `\n${indent}${marker} ${task ? '[ ] ' : ''}`;
        ta.value = v.slice(0, cursor) + insert + v.slice(cursor);
        ta.selectionStart = ta.selectionEnd = cursor + insert.length;
      }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (numbered) {
      const [, indent, num, content] = numbered;
      e.preventDefault();
      if (content === '') {
        const newValue = v.slice(0, lineStart) + '\n' + v.slice(cursor);
        ta.value = newValue;
        ta.selectionStart = ta.selectionEnd = lineStart + 1;
      } else {
        const next = parseInt(num, 10) + 1;
        const insert = `\n${indent}${next}. `;
        ta.value = v.slice(0, cursor) + insert + v.slice(cursor);
        ta.selectionStart = ta.selectionEnd = cursor + insert.length;
      }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // ----- rendering -----

  function renderMeta() {
    $('#meeting-title').value = meeting.title || '';
    $('#meeting-date').value = meeting.date || '';
    $('#meeting-attendees').value = meeting.attendees || '';
  }

  function renderItems() {
    const list = $('#agenda-list');
    list.innerHTML = '';
    const tpl = $('#item-template');
    meeting.items.forEach((item) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = item.id;
      node.classList.toggle('done', !!item.done);
      $('.item-done', node).checked = !!item.done;
      $('.item-title', node).value = item.title || '';
      $('.item-allotted', node).value = item.allottedMin ?? '';
      $('.item-notes', node).value = item.notes || '';
      $('.timer-display', node).textContent = fmtTime(item.elapsedSec || 0);
      const over = item.allottedMin && (item.elapsedSec || 0) > item.allottedMin * 60;
      $('.timer', node).classList.toggle('over', !!over);
      list.appendChild(node);
      if (previewItems.has(item.id)) setItemPreview(node, item, true);
    });
    if (activeTimer.itemId) updateItemControls(activeTimer.itemId);
    renderProgress();
    updatePreviewAllButton();
  }

  function renderProgress() {
    const done = meeting.items.filter((i) => i.done).length;
    const total = meeting.items.length;
    const totalAllotted = meeting.items.reduce((s, i) => s + (Number(i.allottedMin) || 0), 0);
    const parts = [`${done}/${total} done`];
    if (totalAllotted) parts.push(`${totalAllotted} min budget`);
    $('#progress').textContent = parts.join(' · ');
  }

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

  function renderAll() {
    renderMeta();
    renderItems();
    applyTheme();
  }

  // ----- mutations -----

  function updateMeeting(patch) {
    Object.assign(meeting, patch);
    syncURL();
    renderProgress();
  }

  function updateItem(itemId, patch) {
    const item = meeting.items.find((i) => i.id === itemId);
    if (!item) return;
    Object.assign(item, patch);
    syncURL();
  }

  function addItem() {
    meeting.items.push(newItem());
    syncURL();
    renderItems();
    const last = $('#agenda-list').lastElementChild;
    if (last) $('.item-title', last).focus();
  }

  function deleteItem(itemId) {
    if (activeTimer.itemId === itemId) stopTimer();
    previewItems.delete(itemId);
    meeting.items = meeting.items.filter((i) => i.id !== itemId);
    if (meeting.items.length === 0) meeting.items.push(newItem());
    syncURL();
    renderItems();
  }

  function markDoneAndNext(itemId) {
    if (activeTimer.itemId === itemId) stopTimer();
    const idx = meeting.items.findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    meeting.items[idx].done = true;
    syncURL();
    renderItems();
    const nextItem = meeting.items.slice(idx + 1).find((i) => !i.done);
    if (nextItem) {
      startTimer(nextItem.id);
      const nextLi = $(`.item[data-id="${nextItem.id}"]`);
      if (nextLi) nextLi.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      setStatus('All items done. Nice meeting.', 'success');
    }
  }

  function reorderFromDom() {
    const idsInDom = $$('#agenda-list .item').map((n) => n.dataset.id);
    meeting.items.sort((a, b) => idsInDom.indexOf(a.id) - idsInDom.indexOf(b.id));
    syncURL();
    renderProgress();
  }

  function newBlankMeeting() {
    const hasContent =
      (meeting.title && meeting.title.trim()) ||
      (meeting.attendees && meeting.attendees.trim()) ||
      meeting.items.some((i) => i.title || i.notes || i.elapsedSec);
    if (hasContent && !confirm('Start a new meeting? The current one will be replaced — copy its link first if you want to keep it.')) {
      return;
    }
    if (activeTimer.itemId) stopTimer();
    meeting = blankMeeting();
    syncURLNow();
    renderAll();
    $('#meeting-title').focus();
  }

  // ----- export / share -----

  function meetingToMarkdown(m) {
    const lines = [];
    lines.push(`# ${m.title || 'Untitled meeting'}`);
    const meta = [];
    if (m.date) meta.push(`**Date:** ${m.date}`);
    if (m.attendees) meta.push(`**Attendees:** ${m.attendees}`);
    if (meta.length) lines.push(meta.join('  \n'));
    lines.push('');
    m.items.forEach((item, idx) => {
      const checkbox = item.done ? '[x]' : '[ ]';
      const allotted = item.allottedMin ? ` (${item.allottedMin} min` : '';
      const actual = (item.elapsedSec || 0) > 0
        ? `${allotted ? ', ' : ' ('}actual ${fmtTime(item.elapsedSec)}`
        : '';
      const close = (allotted || actual) ? ')' : '';
      lines.push(`## ${idx + 1}. ${checkbox} ${item.title || 'Untitled'}${allotted}${actual}${close}`);
      if (item.notes && item.notes.trim()) {
        lines.push('');
        lines.push(item.notes.trim());
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  function safeFilename(s) {
    return (s || 'meeting').replace(/[^a-z0-9_\-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'meeting';
  }

  function exportMarkdown() {
    const md = meetingToMarkdown(meeting);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFilename(meeting.title)}-${meeting.date || todayISO()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Markdown exported.', 'success');
  }

  async function copyLink() {
    syncURLNow();
    try {
      await navigator.clipboard.writeText(location.href);
      setStatus('Link copied. Anyone with the URL sees this meeting.', 'success');
    } catch (e) {
      setStatus(`Copy failed: ${e.message}. Use the address bar.`, 'error');
    }
  }

  // ----- event wiring -----

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function wireMeta() {
    $('#meeting-title').addEventListener('input', debounce((e) => {
      updateMeeting({ title: e.target.value });
    }, 200));
    $('#meeting-date').addEventListener('change', (e) => {
      updateMeeting({ date: e.target.value });
    });
    $('#meeting-attendees').addEventListener('input', debounce((e) => {
      updateMeeting({ attendees: e.target.value });
    }, 200));
  }

  function wireToolbar() {
    $('#new-meeting').addEventListener('click', newBlankMeeting);
    $('#preview-all').addEventListener('click', toggleAllPreview);
    $('#add-item').addEventListener('click', addItem);
    $('#export-md').addEventListener('click', exportMarkdown);
    $('#copy-link').addEventListener('click', copyLink);
    $('#theme-toggle').addEventListener('click', toggleTheme);
  }

  function wireItemList() {
    const list = $('#agenda-list');

    list.addEventListener('input', (e) => {
      const li = e.target.closest('.item');
      if (!li) return;
      const id = li.dataset.id;
      if (e.target.matches('.item-title')) {
        updateItem(id, { title: e.target.value });
      } else if (e.target.matches('.item-allotted')) {
        const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
        updateItem(id, { allottedMin: v });
        const item = meeting.items.find((i) => i.id === id);
        if (item) updateTimerDisplay(item);
        renderProgress();
      } else if (e.target.matches('.item-notes')) {
        updateItem(id, { notes: e.target.value });
      }
    });

    list.addEventListener('change', (e) => {
      const li = e.target.closest('.item');
      if (!li) return;
      const id = li.dataset.id;
      if (e.target.matches('.item-done')) {
        const checked = e.target.checked;
        updateItem(id, { done: checked });
        li.classList.toggle('done', checked);
        if (checked && activeTimer.itemId === id) stopTimer();
        renderProgress();
      }
    });

    list.addEventListener('click', (e) => {
      const li = e.target.closest('.item');
      if (!li) return;
      const id = li.dataset.id;
      if (e.target.matches('.timer-start')) {
        startTimer(id);
      } else if (e.target.matches('.timer-pause')) {
        stopTimer();
      } else if (e.target.matches('.timer-reset')) {
        if (activeTimer.itemId === id) stopTimer();
        updateItem(id, { elapsedSec: 0 });
        const item = meeting.items.find((i) => i.id === id);
        if (item) updateTimerDisplay(item);
      } else if (e.target.matches('.item-next')) {
        markDoneAndNext(id);
      } else if (e.target.matches('.item-delete')) {
        if (confirm('Delete this agenda item?')) deleteItem(id);
      } else if (e.target.matches('.notes-toggle')) {
        toggleItemPreview(li, id);
      } else if (e.target.closest('.item-notes-rendered') && !e.target.closest('a')) {
        if (previewItems.has(id)) toggleItemPreview(li, id);
      }
    });

    list.addEventListener('keydown', (e) => {
      if (e.target.matches('.item-notes')) autocompleteListOnEnter(e);
    });

    if (window.Sortable) {
      Sortable.create(list, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: reorderFromDom
      });
    }
  }

  function wireHashChanges() {
    window.addEventListener('hashchange', () => {
      if (suppressHashChange) return;
      if (activeTimer.itemId) stopTimer();
      meeting = loadMeeting();
      renderAll();
    });
  }

  window.addEventListener('beforeunload', syncURLNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncURLNow();
  });

  // ----- init -----
  // Start clean: load a shared link if the hash carries one, otherwise stay
  // empty and leave the URL untouched. The hash is only written once the user
  // actually changes something (see syncURL calls in the handlers above).
  renderAll();
  wireMeta();
  wireToolbar();
  wireItemList();
  wireHashChanges();
})();

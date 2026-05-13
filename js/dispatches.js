// pre_ui — dispatches tab (SPA hash #dispatches): pre 直派接入
// /api/v1/dispatches list (5s 轮询) + /api/v1/dispatches/{id} timeline (按需拉)

(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="dispatches-layout">
      <div class="list-panel">
        <div class="filter-bar">
          <input class="input" id="f-search" placeholder="search dispatch_id..." autocomplete="off">
          <select class="input" id="f-status">
            <option value="">all status</option>
            <option>in_progress_evaluation</option>
            <option>approved_pending_executor</option>
            <option>executing</option>
            <option>done</option>
            <option>rejected</option>
            <option>abandoned</option>
          </select>
        </div>
        <div class="dispatch-list" id="dispatch-list">
          <div class="dim p-12">loading...</div>
        </div>
      </div>

      <div class="detail-panel" id="detail-panel">
        <div class="card detail-card dim">选中左侧 dispatch 查看 events 时间线</div>
      </div>
    </div>`;

  function init(host) {
    if (host) host.innerHTML = TEMPLATE;

    let allDispatches = [];
    let filtered = [];
    let selectedId = U.getParam('dispatch') || U.ssGet('selected_dispatch', '');
    let selectedDetail = null;     // {summary, events}
    let lastRowIds = [];

  // kind 简短标签 (timeline 显示)
  const KIND_SHORT = {
    'task_request': 'TASK',
    'evaluate_request': 'EVAL',
    'verdict_reply': 'REPLY',
    'task_verdict': 'VERDICT',
    'command': 'CMD',
    'report': 'REPORT',
    'decide': 'DECIDE',
    'chat': 'CHAT',
  };

  function applyFilter() {
    const q = (document.getElementById('f-search').value || '').toLowerCase();
    const st = document.getElementById('f-status').value;
    filtered = allDispatches.filter(d => {
      if (q && d.dispatch_id.toLowerCase().indexOf(q) < 0) return false;
      if (st && d.status !== st) return false;
      return true;
    });
    renderList();
  }

  function rowHTML(d) {
    const actors = (d.managers || []).length + (d.dispatcher ? 1 : 0) + (d.ceo ? 1 : 0) + (d.executor ? 1 : 0);
    const title = d.task_title_sample
      ? `<div class="title" title="${U.esc(d.task_title_sample)}">${U.esc(d.task_title_sample.substring(0, 60))}${d.task_title_sample.length > 60 ? '…' : ''}</div>`
      : '<div class="title dim">(no task_title sample)</div>';
    return `<div class="dispatch-row ${d.dispatch_id === selectedId ? 'selected' : ''}" data-id="${U.esc(d.dispatch_id)}">
        <div class="head">
          <span class="id">${U.esc(d.dispatch_id)}</span>
          ${C.statusPill(d.status)}
          <span class="grow"></span>
          <span class="dim">${U.ago(d.last_ts)}</span>
        </div>
        <div class="stats">
          <span>actors: ${actors}</span>
          <span>msgs: ${d.msg_count || 0}</span>
          <span>started: ${U.ago(d.started_ts)}</span>
        </div>
        ${title}
        <div class="row-actions">
          <button class="btn dispatch-timeline" data-stop="1" data-id="${U.esc(d.dispatch_id)}">Timeline</button>
          <button class="btn dispatch-export" data-stop="1" data-id="${U.esc(d.dispatch_id)}">Export Markdown</button>
        </div>
      </div>`;
  }

  function renderList() {
    const host = document.getElementById('dispatch-list');
    if (!filtered.length) {
      host.innerHTML = '<div class="dim p-12">no dispatches</div>';
      lastRowIds = [];
      return;
    }
    const ids = filtered.map(d => d.dispatch_id);
    const idsSame = ids.length === lastRowIds.length && ids.every((id, i) => id === lastRowIds[i]);
    if (!idsSame) {
      host.innerHTML = filtered.map(rowHTML).join('');
      host.querySelectorAll('.dispatch-row').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-stop]')) return;
          selectDispatch(el.dataset.id);
        });
      });
      bindRowActionButtons(host);
      lastRowIds = ids;
    } else {
      // in-place 更新 status / ago / stats / title
      const rows = host.querySelectorAll('.dispatch-row');
      filtered.forEach((d, i) => {
        const row = rows[i];
        if (!row) return;
        row.classList.toggle('selected', d.dispatch_id === selectedId);
        row.outerHTML = rowHTML(d);  // 简单替换 (timeline 不在这, 不影响输入)
      });
      // outerHTML 替换后 click handler 失效, 重 bind
      host.querySelectorAll('.dispatch-row').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-stop]')) return;
          selectDispatch(el.dataset.id);
        });
      });
      bindRowActionButtons(host);
    }
  }

  function bindRowActionButtons(host) {
    host.querySelectorAll('.dispatch-timeline').forEach(btn => {
      btn.addEventListener('click', () => openTimelineModal(btn.dataset.id));
    });
    host.querySelectorAll('.dispatch-export').forEach(btn => {
      btn.addEventListener('click', () => openExportModal(btn.dataset.id));
    });
  }

  // timeline modal: 调 /timeline endpoint, 渲染 events 时间线 (结构化, 不走 markdown)
  async function openTimelineModal(dispatchId) {
    C.showModal({
      title: `Timeline · ${dispatchId}`,
      html: '<div class="dim">loading...</div>',
    });
    try {
      const r = await A.dispatchTimeline(dispatchId);
      const events = r.events || [];
      const meta = r.meta || {};
      const metaHtml = `<div class="kvs" style="display:grid;grid-template-columns:90px 1fr;gap:4px 12px;font-size:11px;margin-bottom:10px;">
        <div class="dim">status</div><div>${C.statusPill(meta.status || '')}</div>
        <div class="dim">msg_count</div><div>${meta.msg_count || 0}</div>
        ${meta.ceo ? `<div class="dim">ceo</div><div>${U.esc(meta.ceo.split('.').pop())}</div>` : ''}
        ${meta.dispatcher ? `<div class="dim">dispatcher</div><div>${U.esc(meta.dispatcher.split('.').pop())}</div>` : ''}
        ${meta.executor ? `<div class="dim">executor</div><div>${U.esc(meta.executor.split('.').pop())}</div>` : ''}
      </div>`;
      const eventsHtml = events.length
        ? `<div class="timeline">${events.map(e => {
            const fa = (e.from_agent || '?').split('.').pop();
            const ta = e.to_agent ? (e.to_agent || '').split('.').pop() : '(broadcast)';
            const txt = e.text_preview || '';
            return `<div class="timeline-event kind-${U.esc(e.kind || 'unknown')}">
              <div class="meta">
                <span class="ts">${U.fmtTs(e.ts, {full:true})} (${U.ago(e.ts)})</span>
                <span class="kind">${U.esc((e.kind || '?').toUpperCase())}</span>
                <span class="actors">${U.esc(fa)} <span class="arrow">→</span> ${U.esc(ta)}</span>
                ${e.msg_id ? `<span class="msg-id" title="${U.esc(e.msg_id)}">msg ${U.esc(e.msg_id.substring(0, 8))}</span>` : ''}
              </div>
              ${txt ? `<div class="payload">${U.esc(txt)}</div>` : ''}
            </div>`;
          }).join('')}</div>`
        : '<div class="dim">no events</div>';
      const body = document.getElementById('pre-modal-body');
      if (body) body.innerHTML = metaHtml + eventsHtml;
    } catch (e) {
      const body = document.getElementById('pre-modal-body');
      const msg = e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'error');
      if (body) body.innerHTML = `<div class="dim">timeline 失败: ${U.esc(msg)}</div>`;
    }
  }

  // export markdown: POST /export 写文件 → GET /markdown 拿原文 → marked + DOMPurify 渲染
  async function openExportModal(dispatchId) {
    C.showModal({
      title: `Export · ${dispatchId}`,
      html: '<div class="dim">writing markdown to pre_log/tasks/...</div>',
    });
    let mdText = '';
    try {
      const ex = await A.dispatchExport(dispatchId);
      mdText = await A.dispatchMarkdown(dispatchId);
      if (typeof mdText !== 'string') mdText = JSON.stringify(mdText);
      const safeHtml = C.mdRender(mdText);
      const body = document.getElementById('pre-modal-body');
      if (!body) return;
      body.innerHTML = `
        <div class="export-actions">
          <span class="dim">${U.esc(ex.path || '')} · ${ex.bytes ? ex.bytes + ' bytes' : ''}</span>
          <span class="grow"></span>
          <button class="btn" id="md-copy">Copy</button>
          <button class="btn primary" id="md-download">Download .md</button>
        </div>
        <div class="md-body">${safeHtml}</div>
      `;
      document.getElementById('md-copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(mdText);
          U.toast('markdown 已复制');
        } catch (_) { U.toast('复制失败 (clipboard)', 'err'); }
      });
      document.getElementById('md-download').addEventListener('click', () => {
        const blob = new Blob([mdText], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = dispatchId + '.md';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    } catch (e) {
      const body = document.getElementById('pre-modal-body');
      const msg = e.kind === 'http' ? 'HTTP ' + e.status + ' ' + (typeof e.body === 'string' ? e.body.substring(0, 200) : JSON.stringify(e.body || {})) : (e.message || 'error');
      if (body) body.innerHTML = `<div class="dim">export 失败: ${U.esc(msg)}</div>`;
    }
  }

  function selectDispatch(dispatchId) {
    selectedId = dispatchId;
    U.ssSet('selected_dispatch', dispatchId);
    document.querySelectorAll('.dispatch-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.id === dispatchId);
    });
    selectedDetail = null;
    renderDetail();
    fetchDetail(dispatchId);
  }

  async function fetchDetail(dispatchId) {
    try {
      const r = await A.dispatch(dispatchId);
      if (selectedId !== dispatchId) return;  // 用户已切到别的
      selectedDetail = r;
      renderDetail();
    } catch (e) {
      const host = document.getElementById('detail-panel');
      const msg = e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'network');
      host.innerHTML = `<div class="card detail-card dim">detail: ${U.esc(msg)}</div>`;
    }
  }

  function renderDetail() {
    const host = document.getElementById('detail-panel');
    if (!selectedId) {
      host.innerHTML = '<div class="card detail-card dim">选中左侧 dispatch 查看 events 时间线</div>';
      return;
    }
    const d = allDispatches.find(x => x.dispatch_id === selectedId);
    const sum = (selectedDetail && selectedDetail.summary) || (d ? d : null);
    if (!sum) {
      host.innerHTML = '<div class="card detail-card dim">loading detail...</div>';
      return;
    }
    // cross-ref: summary.actor_states + summary.active_actors
    const sumX = (selectedDetail && selectedDetail.summary) || {};
    const actorStates = sumX.actor_states || {};
    const activeActors = sumX.active_actors || [];
    const actors = sumX.actors
      || (d && [d.ceo, d.dispatcher, ...(d.managers || []), d.executor].filter(Boolean))
      || [];

    const actorsTableHtml = actors.length
      ? `<table class="actor-states"><thead><tr><th>agent</th><th>state</th><th>task_summary</th></tr></thead><tbody>${
          actors.map(aid => {
            const short = aid.split('.').pop();
            const st = actorStates[aid] || {};
            const isActive = activeActors.some(aa => aa.agent_id === aid);
            const stateLabel = st.state || '?';
            const summary = st.task_summary || '-';
            return `<tr class="${isActive ? 'active' : ''}">
              <td><a href="agents.html?agent=${encodeURIComponent(aid)}">${U.esc(short)}</a></td>
              <td>${C.statePill(stateLabel)}</td>
              <td class="summary">${U.esc(summary)}</td>
            </tr>`;
          }).join('')
        }</tbody></table>`
      : '<div class="dim" style="font-size:11px;">no actors</div>';

    const events = (selectedDetail && selectedDetail.events) || [];
    const timelineHtml = events.length
      ? `<div class="timeline">${events.map(eventHTML).join('')}</div>`
      : '<div class="dim" style="padding:12px;">loading events...</div>';

    host.innerHTML = `
      <div class="card detail-card">
        <h2>dispatch · ${U.esc(selectedId)}</h2>
        <div class="kvs" style="display:grid;grid-template-columns:110px 1fr;gap:4px 12px;font-size:11px;">
          <div class="dim">status</div><div>${C.statusPill(sum.status || '')}</div>
          <div class="dim">started</div><div>${U.fmtTs(sum.started_ts, {full:true})} (${U.ago(sum.started_ts)})</div>
          <div class="dim">last_event</div><div>${U.fmtTs(sum.last_ts, {full:true})} (${U.ago(sum.last_ts)})</div>
          <div class="dim">msg_count</div><div>${sum.msg_count || 0}</div>
          ${d && d.ceo ? `<div class="dim">ceo</div><div>${U.esc(d.ceo.split('.').pop())}</div>` : ''}
          ${d && d.dispatcher ? `<div class="dim">dispatcher</div><div>${U.esc(d.dispatcher.split('.').pop())}</div>` : ''}
          ${d && d.executor ? `<div class="dim">executor</div><div>${U.esc(d.executor.split('.').pop())}</div>` : ''}
        </div>
      </div>

      <div class="card detail-card">
        <h2>actors (${actors.length})${activeActors.length ? ' · <span class="dim" style="font-weight:normal;font-size:11px;">active: ' + activeActors.length + '</span>' : ''}</h2>
        ${actorsTableHtml}
      </div>

      <div class="card detail-card">
        <h2>events timeline (${events.length})</h2>
        ${timelineHtml}
      </div>
    `;
  }

  function eventHTML(e) {
    const kind = e.kind || '?';
    const kindShort = KIND_SHORT[kind] || kind.toUpperCase();
    const fa = (e.from_agent || '?').split('.').pop();
    const ta = e.to_agent ? (e.to_agent || '').split('.').pop() : '(broadcast)';
    const role = e.from_role ? `<span class="dim">[${U.esc(e.from_role)}]</span>` : '';
    const payload = e.payload_summary
      ? `<div class="payload">${U.esc(e.payload_summary)}</div>`
      : '';
    const msgId = e.msg_id ? `<span class="msg-id" title="${U.esc(e.msg_id)}">msg ${U.esc(e.msg_id.substring(0, 8))}</span>` : '';
    return `<div class="timeline-event kind-${U.esc(kind)}">
      <div class="meta">
        <span class="ts">${U.fmtTs(e.ts, {full:true})} (${U.ago(e.ts)})</span>
        <span class="kind c-${getKindColor(kind)}">${U.esc(kindShort)}</span>
        ${role}
        <span class="actors">${U.esc(fa)} <span class="arrow">→</span> ${U.esc(ta)}</span>
        ${msgId}
      </div>
      ${payload}
    </div>`;
  }

  function getKindColor(kind) {
    if (kind === 'task_request' || kind === 'decide') return 'magenta';
    if (kind === 'task_verdict') return 'yellow';
    if (kind === 'evaluate_request' || kind === 'verdict_reply') return 'blue';
    if (kind === 'command' || kind === 'report' || kind === 'chat') return 'cyan';
    return 'dim';
  }

  async function refreshDispatches() {
    try {
      const r = await A.dispatches();
      allDispatches = (r && r.dispatches) || [];
      // 显式 sort: 最新的在最上面 (按 last_ts 倒序; fallback started_ts; 最后 dispatch_id 字符序倒序)
      allDispatches.sort((a, b) => {
        const la = a.last_ts || a.started_ts || 0;
        const lb = b.last_ts || b.started_ts || 0;
        if (la !== lb) return lb - la;
        return (b.dispatch_id || '').localeCompare(a.dispatch_id || '');
      });
      applyFilter();
      // 如果当前选中, 选中 row 仍在, 但不重拉 detail (events 不太可能变快)
      // 用户 click 才重拉
    } catch (e) {
      const host = document.getElementById('dispatch-list');
      const msg = e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'network');
      host.innerHTML = `<div class="dim p-12">dispatches: ${U.esc(msg)}</div>`;
      lastRowIds = [];
    }
  }

    document.getElementById('f-search').addEventListener('input', applyFilter);
    document.getElementById('f-status').addEventListener('change', applyFilter);

    refreshDispatches();
    const stopPoll = U.poll(refreshDispatches, 5000);

    if (selectedId) {
      setTimeout(() => {
        if (allDispatches.find(d => d.dispatch_id === selectedId)) selectDispatch(selectedId);
      }, 200);
    }

    return function unmount() { stopPoll(); };
  }

  // --- SPA registration ---
  window.preApp = window.preApp || {};
  window.preApp.dispatches = { init };

  // --- Standalone fallback ---
  if (!document.getElementById('app-content')) {
    const host = document.getElementById('appbar-host');
    if (host) {
      host.innerHTML = C.appBar('dispatches');
      C.startHealthBeacon();
    }
    init();
  }
})();

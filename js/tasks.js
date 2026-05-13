// pre_ui — tasks tab (SPA hash #tasks): 统一混合时间线
// 同时显示 mini_task + dispatch, 按 ts 倒序, accordion 展开 lazy fetch 详情.
// 顶部 kind 过滤: 全部 / 仅 Mini / 仅 Dispatch (默认 全部).

(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="tasks-wrap">
      <div class="mode-bar">
        <span class="mode-tab" data-kind="all">全部</span>
        <span class="mode-tab" data-kind="mini">仅 Mini</span>
        <span class="mode-tab" data-kind="dispatch">仅 Dispatch</span>
        <span class="grow"></span>
        <button class="btn" id="btn-refresh">Refresh</button>
      </div>
      <div id="task-list" class="task-list">
        <div class="dim p-12">loading...</div>
      </div>
    </div>`;

  function init(host) {
    if (host) host.innerHTML = TEMPLATE;

    const list = document.getElementById('task-list');
    const refreshBtn = document.getElementById('btn-refresh');

    // kind 过滤: all / mini / dispatch (per user: 不按 agent 过滤, 只切 kind)
  let kindFilter = U.getParam('kind') || U.ssGet('tasks_kind', 'all');
  if (!['all', 'mini', 'dispatch'].includes(kindFilter)) kindFilter = 'all';

  let allItems = [];   // 合并的混合列表 (含 _kind + _ts 字段)
  const detailCache = new Map();   // key = kind+':'+id

  function renderKindTabs() {
    document.querySelectorAll('.mode-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.kind === kindFilter);
    });
  }
  document.querySelectorAll('.mode-tab').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.kind;
      if (k === kindFilter) return;
      kindFilter = k;
      U.ssSet('tasks_kind', k);
      renderKindTabs();
      renderList();
    });
  });
  renderKindTabs();

  refreshBtn.addEventListener('click', refresh);

  async function refresh() {
    list.innerHTML = '<div class="dim p-12">loading...</div>';
    try {
      // 并行拉两者, 合并按 ts 倒序. limit=200 全量给前端, 跨所有 agent 不过滤
      const [miniR, dispR] = await Promise.all([
        A.miniTasks({ limit: 200 }).catch(() => ({ mini_tasks: [] })),
        A.dispatches().catch(() => ({ dispatches: [] })),
      ]);
      const minis = (miniR && miniR.mini_tasks) || [];
      const disps = (dispR && dispR.dispatches) || [];
      allItems = [
        ...minis.map(mt => ({
          _kind: 'mini',
          _ts: mt.started_ts || 0,
          _id: mt.mini_task_id,
          data: mt,
        })),
        ...disps.map(d => ({
          _kind: 'dispatch',
          _ts: d.last_ts || d.started_ts || 0,
          _id: d.dispatch_id,
          data: d,
        })),
      ];
      // 全局倒序: 最新在最上
      allItems.sort((a, b) => b._ts - a._ts);
      renderList();
    } catch (e) {
      const msg = e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'network');
      list.innerHTML = `<div class="dim p-12">load failed: ${U.esc(msg)}</div>`;
    }
  }

  function renderList() {
    // 仅 kind 过滤 (per user: 不按 agent 过滤, 全部 agent 同时显示)
    const filtered = kindFilter === 'all'
      ? allItems
      : allItems.filter(it => it._kind === kindFilter);

    if (!filtered.length) {
      list.innerHTML = `<div class="dim p-12">无数据 (kind=${U.esc(kindFilter)})</div>`;
      return;
    }

    // 计数信息条 — 显示总条数 + 涉及的 agent 数
    const agentSet = new Set();
    filtered.forEach(it => {
      if (it._kind === 'mini' && it.data.agent_id) agentSet.add(it.data.agent_id);
      if (it._kind === 'dispatch') {
        [it.data.ceo, it.data.dispatcher, it.data.executor, ...(it.data.managers || [])]
          .filter(Boolean).forEach(a => agentSet.add(a));
      }
    });
    const countMini = filtered.filter(it => it._kind === 'mini').length;
    const countDisp = filtered.filter(it => it._kind === 'dispatch').length;
    const summary = `<div class="dim" style="font-size:10px;padding:4px 0;">${filtered.length} 条 · ${countMini} mini · ${countDisp} dispatch · 涉及 ${agentSet.size} agent · 时间倒序</div>`;

    list.innerHTML = summary + filtered.map(it =>
      it._kind === 'mini' ? miniRowHTML(it.data) : dispatchRowHTML(it.data)
    ).join('');

    list.querySelectorAll('.task-item').forEach(el => {
      const head = el.querySelector('.ti-head');
      if (!head) return;
      head.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop]')) return;
        toggleItem(el);
      });
    });
  }

  function miniRowHTML(mt) {
    const short = (mt.agent_id || '?').split('.').pop();
    const reqPreview = (mt.request || '').replace(/\s+/g, ' ').substring(0, 100);
    const dispatchTag = mt.parent_dispatch_id
      ? `<a class="dispatch-link" href="dispatches.html?dispatch=${encodeURIComponent(mt.parent_dispatch_id)}" data-stop="1" target="_blank" rel="noopener noreferrer">↗ ${U.esc(mt.parent_dispatch_id)}</a>`
      : '';
    return `<div class="task-item" data-id="${U.esc(mt.mini_task_id)}" data-kind="mini">
      <div class="ti-head">
        <span class="ts">${U.esc(U.ago(mt.started_ts))}</span>
        <span class="kind-tag kind-mini">MINI</span>
        <span class="agent">${U.esc(short)}</span>
        <span class="meta">${mt.duration_sec || 0}s · ${mt.tool_count || 0}t</span>
        ${dispatchTag}
        <span class="title">${U.esc(reqPreview)}</span>
        <span class="toggle">▶</span>
      </div>
      <div class="ti-detail"></div>
    </div>`;
  }

  function dispatchRowHTML(d) {
    const sample = (d.task_title_sample || '').replace(/\s+/g, ' ').substring(0, 100);
    const actors = (d.managers || []).length + (d.dispatcher ? 1 : 0) + (d.ceo ? 1 : 0) + (d.executor ? 1 : 0);
    return `<div class="task-item" data-id="${U.esc(d.dispatch_id)}" data-kind="dispatch">
      <div class="ti-head">
        <span class="ts">${U.esc(U.ago(d.last_ts || d.started_ts))}</span>
        <span class="kind-tag kind-dispatch">DISP</span>
        <span class="agent">${U.esc(d.dispatch_id)}</span>
        ${C.statusPill(d.status)}
        <span class="meta">${actors}a · ${d.msg_count || 0}m</span>
        <span class="title">${U.esc(sample)}</span>
        <span class="toggle">▶</span>
      </div>
      <div class="ti-detail"></div>
    </div>`;
  }

  async function toggleItem(el) {
    const detail = el.querySelector('.ti-detail');
    const toggle = el.querySelector('.toggle');
    if (!detail) return;
    const expanded = el.classList.contains('expanded');
    if (expanded) {
      el.classList.remove('expanded');
      if (toggle) toggle.textContent = '▶';
      return;
    }
    el.classList.add('expanded');
    if (toggle) toggle.textContent = '▼';
    const id = el.dataset.id;
    const kind = el.dataset.kind;
    const cacheKey = kind + ':' + id;
    if (detailCache.has(cacheKey)) {
      detail.innerHTML = detailCache.get(cacheKey).html;
      return;
    }
    detail.innerHTML = '<div class="dim">loading...</div>';
    try {
      if (kind === 'mini') {
        const mt = await A.miniTask(id);
        detail.innerHTML = renderMiniTaskDetail(mt);
        fillActions(detail, mt.actions || []);
        detailCache.set(cacheKey, { html: detail.innerHTML });
      } else {
        const dt = await A.dispatchTimeline(id);
        const itemMeta = (allItems.find(x => x._kind === 'dispatch' && x._id === id) || {}).data || {};
        detail.innerHTML = renderDispatchDetail(dt, itemMeta);
        detailCache.set(cacheKey, { html: detail.innerHTML });
      }
    } catch (e) {
      const msg = e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'error');
      detail.innerHTML = `<div class="dim">详情拉取失败: ${U.esc(msg)}</div>`;
    }
  }

  function renderMiniTaskDetail(mt) {
    const meta = `<div class="mt-meta">
      <span>started: ${U.fmtTs(mt.started_ts, {full:true})}</span>
      <span>duration: ${mt.duration_sec || 0}s</span>
      <span>tools: ${mt.tool_count || 0}</span>
      ${mt.parent_dispatch_id ? `<span>dispatch: <a href="dispatches.html?dispatch=${encodeURIComponent(mt.parent_dispatch_id)}" target="_blank" rel="noopener noreferrer">${U.esc(mt.parent_dispatch_id)}</a></span>` : ''}
    </div>`;
    const requestHtml = `<div class="mt-section"><div class="mt-section-label">要求 (request)</div><div class="md-body">${C.mdRender(mt.request || '')}</div></div>`;
    const actions = mt.actions || [];
    const actionsHtml = `<div class="mt-section"><div class="mt-section-label">方案 (actions, ${actions.length})</div><div class="mt-actions"></div></div>`;
    const replyHtml = `<div class="mt-section"><div class="mt-section-label">结果 (reply)</div><div class="md-body">${C.mdRender(mt.reply || '(无 reply)')}</div></div>`;
    return meta + requestHtml + actionsHtml + replyHtml;
  }

  function fillActions(detailEl, actions) {
    const host = detailEl.querySelector('.mt-actions');
    if (!host) return;
    host.innerHTML = '';
    const KIND = { assistant_text: 'TXT', tool_use: 'TOOL', tool_result: 'OK' };
    (actions || []).forEach(a => {
      const row = document.createElement('div');
      row.className = 'mt-action mt-action-' + (a.kind || 'unknown');
      const tag = document.createElement('span');
      tag.className = 'mt-action-tag';
      tag.textContent = '[' + (KIND[a.kind] || (a.kind || '?').toUpperCase()) + ']';
      row.appendChild(tag);
      if (a.kind === 'tool_use' && a.name) {
        const name = document.createElement('span');
        name.className = 'mt-action-name';
        name.textContent = ' ' + a.name + ' ';
        row.appendChild(name);
      }
      const txt = document.createElement('span');
      txt.className = 'mt-action-text';
      txt.textContent = a.text || a.summary || a.input_summary || '';
      row.appendChild(txt);
      host.appendChild(row);
    });
  }

  function renderDispatchDetail(dt, listItem) {
    const sumX = dt.meta || dt.summary || {};
    const events = dt.events || [];
    const actors = sumX.actors
      || [listItem.ceo, listItem.dispatcher, listItem.executor, ...(listItem.managers || [])].filter(Boolean);
    const KIND_SHORT = {
      'task_request': 'TASK', 'evaluate_request': 'EVAL',
      'verdict_reply': 'REPLY', 'task_verdict': 'VERDICT',
      'command': 'CMD', 'report': 'REPORT', 'decide': 'DECIDE', 'chat': 'CHAT',
    };
    const eventsHtml = events.length
      ? `<div class="timeline">${events.map(e => {
          const fa = (e.from_agent || '?').split('.').pop();
          const ta = e.to_agent ? (e.to_agent || '').split('.').pop() : '(broadcast)';
          const txt = e.text_preview || e.payload_summary || '';
          const kindShort = KIND_SHORT[e.kind] || (e.kind || '?').toUpperCase();
          return `<div class="timeline-event kind-${U.esc(e.kind || 'unknown')}">
            <div class="meta">
              <span class="ts">${U.fmtTs(e.ts, {full:true})} (${U.ago(e.ts)})</span>
              <span class="kind">${U.esc(kindShort)}</span>
              <span class="actors">${U.esc(fa)} <span class="arrow">→</span> ${U.esc(ta)}</span>
            </div>
            ${txt ? `<div class="payload">${U.esc(txt)}</div>` : ''}
          </div>`;
        }).join('')}</div>`
      : '<div class="dim">no events</div>';
    return `<div class="dispatch-detail">
      <div class="mt-meta">
        <span>status: ${C.statusPill(sumX.status || listItem.status || '')}</span>
        <span>msg_count: ${sumX.msg_count || listItem.msg_count || 0}</span>
        ${actors.length ? `<span>actors: ${actors.length}</span>` : ''}
      </div>
      <div class="mt-section"><div class="mt-section-label">events timeline (${events.length})</div>${eventsHtml}</div>
      <div class="mt-meta" style="margin-top:8px;">
        <a href="dispatches.html?dispatch=${encodeURIComponent(listItem.dispatch_id || sumX.dispatch_id || '')}" target="_blank" rel="noopener noreferrer">在 Dispatches 页打开 ↗</a>
      </div>
    </div>`;
  }

    refresh();

    return function unmount() {
      // tasks 当前无轮询; detailCache 随 host innerHTML 替换被 GC
    };
  }

  // --- SPA registration ---
  window.preApp = window.preApp || {};
  window.preApp.tasks = { init };

  // --- Standalone fallback ---
  if (!document.getElementById('app-content')) {
    const host = document.getElementById('appbar-host');
    if (host) {
      host.innerHTML = C.appBar('tasks');
      C.startHealthBeacon();
    }
    init();
  }
})();

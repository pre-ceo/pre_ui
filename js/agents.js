// pre_ui — agents tab (SPA hash #agents)
// kind dropdown 限 chat / command.

(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="agents-layout">
      <div class="node-col" id="node-tabs"></div>

      <div class="list-panel">
        <div class="agent-list" id="agent-list">
          <div class="dim p-12">loading...</div>
        </div>
      </div>

      <div class="detail-panel" id="detail-panel">
        <div class="chat-empty dim">选中左侧 agent 开始 chat</div>
      </div>
    </div>`;

  function init(host) {
    if (host) host.innerHTML = TEMPLATE;

    let allAgents = [];        // sorted, deduped, includes seen-but-currently-offline
    let filtered = [];
    let selectedId = U.getParam('agent') || U.ssGet('selected_agent', '');
    let currentNodeFilter = U.ssGet('node_filter', 'all');   // 260430 node tab
    // seen agent map: agent_id → agent record. 永不删, master 没返回的标 state='offline'.
    // 容错 master 端 registry 启动期 list_agents() 数量波动 (driver 异步发现).
    const seenAgents = new Map();
    let lastRowIds = [];        // DOM diff: 上次 renderList 渲染的 id 顺序

  // 起 master 加 activity 字段 (state/task_title/last_action/pending/...)
  // 260429.X 派生 'idle_with_proposals': idle 但 activity.proposals 非空, 等用户选下一步.
  function hasIdleProposals(a) {
    const act = a.activity || {};
    if ((act.state || a.state) !== 'idle') return false;
    const p = act.proposals;
    return !!(p && Array.isArray(p.proposals) && p.proposals.length > 0);
  }
  // master 现在返 'stale' (历史出现过但 driver 不再 yield, 用户语义 "未接管") 和
  // 'failed' (配置坏: tmux 缺/hook 没装/cwd 没了). 两者都不走 activity.state — agent
  // 都没活, 直接看 a.state 即可. 也兼容 metadata.status === 'stale' 这种第二信号.
  function isStale(a) {
    if (!a) return false;
    if (a.state === 'stale') return true;
    return !!(a.metadata && a.metadata.status === 'stale');
  }
  function isFailed(a) {
    return !!a && a.state === 'failed';
  }
  function effState(a) {
    if (isStale(a))  return 'stale';
    if (isFailed(a)) return 'failed';
    if (hasIdleProposals(a)) return 'idle_with_proposals';
    return (a.activity && a.activity.state) || a.state || 'unknown';
  }

  // 排序/ago 取 "最后活动时间": 优先 activity.last_activity_ts (registry 由 fingerprint
  // state/last_action/tool/recent_actions/pane_summary 变就刷, 比 last_update 灵敏),
  // fallback last_update. 用户偏好: 最近有动静的排最上, stale 不固定沉底.
  function lastActivityTs(a) {
    return (a && a.activity && a.activity.last_activity_ts) || (a && a.last_update) || null;
  }
  function parseLastUpdate(a) {
    const v = lastActivityTs(a);
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  function mergeFromMaster(liveList) {
    const liveIds = new Set(liveList.map(a => a.agent_id));
    for (const a of liveList) seenAgents.set(a.agent_id, a);
    // seen 中不在 live 的, 标 offline (不删, 容错 master registry 启动期波动)
    for (const [id, prev] of seenAgents) {
      if (!liveIds.has(id)) {
        const wantState = 'offline';
        if (prev.state !== wantState || (prev.activity && prev.activity.state !== wantState)) {
          const next = Object.assign({}, prev, { state: wantState });
          if (prev.activity) {
            next.activity = Object.assign({}, prev.activity, { state: wantState });
          }
          seenAgents.set(id, next);
        }
      }
    }
    const merged = Array.from(seenAgents.values());
    merged.sort((a, b) => parseLastUpdate(b) - parseLastUpdate(a));
    allAgents = merged;
  }

  // agent_id `<node>.<name>` → 短 name (`pre`, `pre_ui`); 无 `.` 时返回原值
  function shortName(agentId) {
    const parts = String(agentId || '').split('.');
    return parts[parts.length - 1] || agentId || '';
  }

  function applyFilter() {
    // 仅按 node 分组过滤; search/state/role 输入条已下线 (节点 col 是唯一筛选)
    filtered = allAgents.filter(a => {
      if (currentNodeFilter !== 'all' && (a.node_id || 'unknown') !== currentNodeFilter) return false;
      return true;
    });
    renderList();
    renderNodeTabs();
  }

  function renderNodeTabs() {
    const tabsEl = document.getElementById('node-tabs');
    if (!tabsEl) return;
    // 统计每个 node 的 agent 数 (用 allAgents, 即应用 filter 前的总集)
    const counts = {};
    allAgents.forEach(a => {
      const n = a.node_id || 'unknown';
      counts[n] = (counts[n] || 0) + 1;
    });
    const nodes = Object.keys(counts).sort();
    // 永远显示 tab (即使单节点) — user 反馈: tab 是 affordance, hide 让用户以为功能不存在
    const tabs = [['all', allAgents.length]].concat(nodes.map(n => [n, counts[n]]));
    tabsEl.innerHTML = tabs.map(([n, ct]) =>
      `<div class="node-tab ${n === currentNodeFilter ? 'active' : ''}" data-node="${U.esc(n)}">
        <div class="name">${U.esc(n)}</div>
        <div class="count">${ct} agent${ct === 1 ? '' : 's'}</div>
      </div>`
    ).join('');
    tabsEl.querySelectorAll('.node-tab').forEach(el => {
      el.addEventListener('click', () => {
        const n = el.dataset.node;
        if (n === currentNodeFilter) return;
        currentNodeFilter = n;
        U.ssSet('node_filter', n);
        applyFilter();
      });
    });
  }

  // 主标题取舍 (): 优先 task_summary (LLM 60s 一轮, 反映现实 20 字内)
  // fallback task_title (派单文字, 静态背景), 都没有则不显示.
  // task_summary === '空闲' 时显灰斜体, fallback 时也显灰.
  function summaryFor(a) {
    const act = a.activity || {};
    if (act.task_summary) {
      return { text: act.task_summary, kind: act.task_summary === '空闲' ? 'empty' : 'normal' };
    }
    if (act.task_title) {
      return { text: act.task_title, kind: 'fallback' };
    }
    return null;
  }

  // state → fn_fe 终端状态点 class (.td-ok/.td-w/.td-err/.td-unk).
  // 严禁红绿: ok=cyan / err=magenta / w=yellow / unk=灰
  function stateDotClass(st) {
    if (st === 'idle' || st === 'busy' || st === 'thinking') return 'td-ok';
    if (st === 'idle_with_proposals') return 'td-w';
    if (st === 'blocked_user' || st === 'blocked' || st === 'error' || st === 'failed') return 'td-err';
    if (st === 'stale' || st === 'offline' || st === 'unknown') return 'td-unk';
    return 'td-unk';
  }
  // failure_reason 极短化, 长 hint 走 title 浮提示.
  function failureSummary(a) {
    const md = a.metadata || {};
    const reason = md.failure_reason || '';
    const hint   = md.failure_hint   || '';
    if (!reason && !hint) return null;
    return { reason: String(reason), hint: String(hint) };
  }

  // 列表行: 主任务行 (优先 task_summary) + 副标题 recent_actions[0] (当前在做)
  //         + dispatch 链接 (current_dispatch_id) — cross-ref
  //  stale/failed 走专用 row class + 中文 chip:
  //   stale  → .stale   + chip "未接管" (dim)        — 老 agent driver 不再 yield
  //   failed → .failed  + chip "失败"   (magenta)    — 配置坏, 用户须修
  function rowHTML(a) {
    const act = a.activity || {};
    const st  = effState(a);
    const rowMod = st === 'stale' ? ' stale' : (st === 'failed' ? ' failed' : '');
    const sm = summaryFor(a);
    const summaryPrefix = sm && sm.kind === 'fallback' ? '↳ ' : '';
    const summaryLine = sm
      ? `<div class="task-line ${sm.kind}" title="${U.esc(sm.text)}">${summaryPrefix}${U.esc(sm.text.substring(0, 60))}${sm.text.length > 60 ? '…' : ''}</div>`
      : '';
    const fs = failureSummary(a);
    // stale/failed 用 failure-line 替代 nowLine — 老 agent 没 recent_actions, 显 failure_reason 更有信息.
    let failureLine = '';
    if ((st === 'stale' || st === 'failed') && fs) {
      const tooltip = (fs.reason ? fs.reason : '') + (fs.hint ? '\n' + fs.hint : '');
      failureLine = `<div class="failure-line ${st}" title="${U.esc(tooltip)}">${U.esc(fs.reason || fs.hint)}</div>`;
    }
    const ra0 = (act.recent_actions || [])[0];
    const showNow = !!ra0 && st !== 'stale' && st !== 'failed';
    const nowLine = showNow
      ? `<div class="now-line" title="${U.esc((ra0.tool || '') + ' | ' + (ra0.summary || ''))}"><span class="tool">${U.esc(ra0.tool || '?')}</span> ${U.esc((ra0.summary || '').substring(0, 50))}${(ra0.summary || '').length > 50 ? '…' : ''}</div>`
      : '';
    const dispatchLine = act.current_dispatch_id
      ? `<div class="dispatch-link"><a href="dispatches.html?dispatch=${encodeURIComponent(act.current_dispatch_id)}" data-stop="1">→ ${U.esc(act.current_dispatch_id)}</a> <span class="dim">${U.esc(act.current_dispatch_role || '?')} · ${U.esc(act.current_dispatch_status || '?')}</span></div>`
      : '';
    // mini-tasks 特性当前整体隐藏 (per user); 恢复时改回:
    //   const miniTasksBtn = (st === 'stale' || st === 'failed')
    //     ? '' : `<div class="row-actions"><a class="btn" data-stop="1" href="tasks.html?mode=mini&agent=${encodeURIComponent(a.agent_id)}" target="_blank" rel="noopener noreferrer">Mini Tasks ↗</a></div>`;
    const miniTasksBtn = '';
    // 中文 status chip — 跟左侧 fn_fe 状态 pill 并列, 让用户一眼读懂
    let zhChip = '';
    if (st === 'stale')  zhChip = `<span class="chip-zh chip-stale">未接管</span>`;
    if (st === 'failed') zhChip = `<span class="chip-zh chip-failed">失败</span>`;
    const rowTitle = (st === 'stale' || st === 'failed') && fs
      ? `title="${U.esc((fs.reason || '') + (fs.hint ? ' — ' + fs.hint : ''))}"` : '';
    return `<div class="agent-row${rowMod}${a.agent_id === selectedId ? ' selected' : ''}" data-id="${U.esc(a.agent_id)}" data-state="${U.esc(st)}" ${rowTitle}>
        <div class="name-row">
          <span class="td ${stateDotClass(st)}"></span>
          <span class="agent-name">${U.esc(shortName(a.agent_id))}</span>
        </div>
        <div class="meta">
          ${C.statePill(st)}
          ${zhChip}
          ${C.rolePill(a.role)}
          <span>node: ${U.esc(a.node_id || '-')}</span>
          <span class="grow"></span>
          <span>${U.ago(lastActivityTs(a))}</span>
        </div>
        ${summaryLine}
        ${failureLine}
        ${nowLine}
        ${dispatchLine}
        ${miniTasksBtn}
        <div class="agent-id-full">${U.esc(a.agent_id)}</div>
      </div>`;
  }

  // 单行 in-place 更新 dispatch link (current_dispatch_id 变化或新出/消失)
  function updateDispatchLink(row, a) {
    const act = a.activity || {};
    const cdi = act.current_dispatch_id;
    let dl = row.querySelector('.dispatch-link');
    if (cdi) {
      const html = `<a href="dispatches.html?dispatch=${encodeURIComponent(cdi)}" data-stop="1">→ ${U.esc(cdi)}</a> <span class="dim">${U.esc(act.current_dispatch_role || '?')} · ${U.esc(act.current_dispatch_status || '?')}</span>`;
      if (dl) {
        if (dl.innerHTML !== html) dl.innerHTML = html;
      } else {
        const div = document.createElement('div');
        div.className = 'dispatch-link';
        div.innerHTML = html;
        row.appendChild(div);
      }
    } else if (dl) {
      dl.remove();
    }
  }

  // 单行 in-place 更新副标题 (now-line) — 配合 DOM diff 路径.
  // stale/failed 不显 now-line (已被 failure-line 替代, 老 agent 也没 recent_actions).
  function updateNowLine(row, a) {
    const st = effState(a);
    const ra0 = ((a.activity || {}).recent_actions || [])[0];
    let nl = row.querySelector('.now-line');
    const showNow = !!ra0 && st !== 'stale' && st !== 'failed';
    if (!showNow) {
      if (nl) nl.remove();
      return;
    }
    if (ra0) {
      const tool = ra0.tool || '?';
      const summary = (ra0.summary || '').substring(0, 50);
      const ell = (ra0.summary || '').length > 50 ? '…' : '';
      const html = `<span class="tool">${U.esc(tool)}</span> ${U.esc(summary)}${ell}`;
      if (nl) {
        if (nl.innerHTML !== html) nl.innerHTML = html;
        nl.title = (tool || '') + ' | ' + (ra0.summary || '');
      } else {
        const div = document.createElement('div');
        div.className = 'now-line';
        div.innerHTML = html;
        div.title = (tool || '') + ' | ' + (ra0.summary || '');
        row.appendChild(div);
      }
    } else if (nl) {
      nl.remove();
    }
  }

  function renderList() {
    const host = document.getElementById('agent-list');
    if (!filtered.length) {
      host.innerHTML = '<div class="dim p-12">no agents</div>';
      lastRowIds = [];
      return;
    }
    const ids = filtered.map(a => a.agent_id);
    const idsSame = (ids.length === lastRowIds.length) && ids.every((id, i) => id === lastRowIds[i]);
    if (!idsSame) {
      // 列表结构变化: 完全重建 DOM (新增/删除/重排)
      host.innerHTML = filtered.map(rowHTML).join('');
      host.querySelectorAll('.agent-row').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-stop]')) return;
          selectAgent(el.dataset.id);
        });
      });
      // [Mini Tasks] 改为跳 tasks.html, 不再 modal 弹出 (per user)
      lastRowIds = ids;
    } else {
      // 列表结构未变, 仅 in-place 更新 row 的 .meta + .task-line (避免闪烁/丢失点击)
      const rows = host.querySelectorAll('.agent-row');
      filtered.forEach((a, i) => {
        const row = rows[i];
        if (!row) return;
        const st = effState(a);
        row.classList.toggle('selected', a.agent_id === selectedId);
        row.classList.toggle('stale',  st === 'stale');
        row.classList.toggle('failed', st === 'failed');
        if (row.dataset.state !== st) row.dataset.state = st;
        // .name-row 内的状态点 — 切换 td-* class
        const dot = row.querySelector('.name-row .td');
        if (dot) dot.className = 'td ' + stateDotClass(st);
        // .meta — 状态 pill + 中文 chip (stale/failed) + role + node + ago
        let zhChip = '';
        if (st === 'stale')  zhChip = '<span class="chip-zh chip-stale">未接管</span>';
        if (st === 'failed') zhChip = '<span class="chip-zh chip-failed">失败</span>';
        const meta = row.querySelector('.meta');
        if (meta) {
          meta.innerHTML = `${C.statePill(st)}${zhChip}${C.rolePill(a.role)}<span>node: ${U.esc(a.node_id || '-')}</span><span class="grow"></span><span>${U.ago(lastActivityTs(a))}</span>`;
        }
        // failure-line: stale/failed 时显示 failure_reason, 否则移除
        const fs = failureSummary(a);
        let fl = row.querySelector('.failure-line');
        if ((st === 'stale' || st === 'failed') && fs) {
          const tooltip = (fs.reason ? fs.reason : '') + (fs.hint ? '\n' + fs.hint : '');
          if (!fl) {
            fl = document.createElement('div');
            fl.className = 'failure-line ' + st;
            row.appendChild(fl);
          } else if (!fl.classList.contains(st)) {
            fl.className = 'failure-line ' + st;
          }
          const txt = fs.reason || fs.hint;
          if (fl.textContent !== txt) fl.textContent = txt;
          fl.title = tooltip;
        } else if (fl) {
          fl.remove();
        }
        // 整行 tooltip (鼠标悬停 row 显完整 failure_reason + hint)
        if ((st === 'stale' || st === 'failed') && fs) {
          row.title = (fs.reason || '') + (fs.hint ? ' — ' + fs.hint : '');
        } else {
          row.removeAttribute('title');
        }
        // 主任务行增删/更新 (优先 task_summary, fallback task_title)
        const sm = summaryFor(a);
        let tl = row.querySelector('.task-line');
        if (sm) {
          const prefix = sm.kind === 'fallback' ? '↳ ' : '';
          const txt = `${prefix}${sm.text.substring(0, 60)}${sm.text.length > 60 ? '…' : ''}`;
          if (tl) {
            if (tl.textContent !== txt) tl.textContent = txt;
            tl.title = sm.text;
            tl.className = 'task-line ' + sm.kind;
          } else {
            const div = document.createElement('div');
            div.className = 'task-line ' + sm.kind;
            div.textContent = txt;
            div.title = sm.text;
            row.appendChild(div);
          }
        } else if (tl) {
          tl.remove();
        }
        // now-line 增删/更新 (recent_actions[0] 反映当前在做)
        updateNowLine(row, a);
        // dispatch-link 增删/更新 (current_dispatch_id 跨链到 dispatches tab)
        updateDispatchLink(row, a);
      });
    }
  }

  // SPA detail-panel 拆为 3 段:
  //   1. agent-header (state/role/agent_id 一行 + driver/model)        — buildDetailShell+renderHeader
  //   2. agent-actions (pending / decide / proposals / send-box)        — renderActions
  //   3. chat-split (chat-pane | preview-pane)                          — preChat 模块独占
  // 关键: chat-pane DOM 持久化, 5s 轮询不能推倒它 (renderDetail 不再 host.innerHTML 整盘改).
  let detailShellAgent = null;     // 当前 shell 绑定的 agentId; 切换才重建
  let preChatAttached = false;

  function selectAgent(agentId) {
    selectedId = agentId;
    U.ssSet('selected_agent', agentId);
    document.querySelectorAll('.agent-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.id === agentId);
    });
    const shellRebuilt = (detailShellAgent !== agentId);
    if (shellRebuilt) {
      // detach 旧 preChat 实例 — 它持有的 chatHost / msgsHost 引用即将变成孤儿
      if (window.preChat && preChatAttached) {
        window.preChat.detach();
        preChatAttached = false;
      }
      buildDetailShell();
      detailShellAgent = agentId;
    }
    renderHeader();
    // chat 模块独占 chat-pane (含 title-bar 右侧 session dropdown 区).
    if (window.preChat) {
      const chatHost = document.getElementById('chat-pane');
      const previewHost = document.getElementById('preview-pane');
      const titleControls = document.getElementById('chat-title-controls');
      if (chatHost) {
        if (!preChatAttached) {
          window.preChat.attach({ chatHost, previewHost, titleControls });
          preChatAttached = true;
        }
        const a = allAgents.find(x => x.agent_id === agentId);
        const meta = a ? {
          state: effState(a),
          isVirtual: !!(a.metadata && a.metadata.is_virtual),
        } : {};
        window.preChat.setAgent(agentId, meta);
      }
    }
    // setAgent 异步 tail-load 完成后才有 msgsHost 内容; 50ms 再 push decide bubble
    setTimeout(refreshChatDecide, 80);
  }

  // 在 5s 轮询里同步 chat 输入框 enable 状态 (agent 上线/下线 / 虚拟 agent 切换)
  function refreshChatSendEnable() {
    if (!window.preChat || !preChatAttached || !selectedId) return;
    const a = allAgents.find(x => x.agent_id === selectedId);
    if (!a) return;
    const isVirt = !!(a.metadata && a.metadata.is_virtual);
    const stateNow = effState(a);
    let enabled, reason = '';
    if (isVirt) { enabled = false; reason = 'virtual agent 只接收'; }
    else if (stateNow === 'offline') { enabled = false; reason = 'agent offline'; }
    else { enabled = true; }
    window.preChat.setSendEnabled(enabled, reason);
  }

  // blocked_user → 把 4 按钮 decide 作为 system bubble 钉在 chat 末尾; 离开 blocked_user 自动清掉.
  function refreshChatDecide() {
    if (!window.preChat || !preChatAttached || !selectedId) return;
    if (typeof window.preChat.setDecidePrompt !== 'function') return;
    const a = allAgents.find(x => x.agent_id === selectedId);
    if (!a) { window.preChat.setDecidePrompt(null); return; }
    if (effState(a) !== 'blocked_user') {
      window.preChat.setDecidePrompt(null);
      return;
    }
    const act = a.activity || {};
    const pending = act.pending || {};
    window.preChat.setDecidePrompt({
      toolKind: pending.tool_kind || 'tool',
      description: pending.description || '',
      prehookDecision: pending.prehook_decision || null,
      onDecide: async (key) => {
        const r = await A.decide(a.agent_id, { key, by_agent: 'user.default' });
        const id = (r && r.decide_id) ? r.decide_id.substring(0, 8) : 'queued';
        U.toast('decide injected · key=' + key + ' · id=' + id);
        // Poll 几个间隔抓 state 变化
        setTimeout(refreshAgents, 1500);
        setTimeout(refreshAgents, 4000);
      },
    });
  }

  function buildDetailShell() {
    const host = document.getElementById('detail-panel');
    if (!host) return;
    // Discord-like: detail-panel 自身就是 chat container.
    // title-bar 拆 left (agents.js renderHeader 写) + right (chat.js 写 session dropdown).
    host.innerHTML = `
      <div class="chat-title-bar">
        <div class="chat-title-left" id="agent-header"></div>
        <div class="chat-title-right" id="chat-title-controls"></div>
      </div>
      <div class="chat-split">
        <div class="chat-pane" id="chat-pane"></div>
        <div class="preview-pane hidden" id="preview-pane"></div>
      </div>`;
  }

  function renderHeader() {
    const a = allAgents.find(x => x.agent_id === selectedId);
    const el = document.getElementById('agent-header');
    if (!el) return;
    if (!a) { el.innerHTML = ''; return; }

    const driverType = a.driver_type || '?';
    const isRemote = a.node_id && a.node_id !== 'local';
    const driverLabel = driverType + (isRemote ? ` (remote: ${a.node_id})` : '');
    const lr = (a.metadata || {}).llm_route;
    let modelLabel = 'claude (OAuth)';
    let gatewayLabel = '';
    if (lr) {
      modelLabel = lr.model || '?';
      if (lr.base_url) {
        let dom = lr.base_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (dom.length > 40) dom = dom.substring(0, 40) + '…';
        gatewayLabel = ` · ${U.esc(dom)}`;
      }
    }

    el.innerHTML = `
      <span class="agent-id">${U.esc(a.agent_id)}</span>
      ${C.statePill(effState(a))}
      ${C.rolePill(a.role)}
      <span class="agent-meta">${U.esc(driverLabel)} · ${U.esc(modelLabel)}${gatewayLabel}</span>`;
  }

  // renderActions({fullRender: bool}):
  //   fullRender=true: 切 agent 时, 不需要保留 send-box state (反正是新 agent 的对话)
  //   fullRender=false: 5s 轮询, 保留 textarea/select/焦点/光标/滚动
  function renderActions(opts) {
    opts = opts || {};
    const a = allAgents.find(x => x.agent_id === selectedId);
    const el = document.getElementById('agent-actions');
    if (!el) return;
    if (!a) { el.innerHTML = ''; return; }

    const state = effState(a);
    const act = a.activity || {};

    // pending block (blocked_user 时显示) — pane_summary / task_summary 现在由 chat 取代
    let pendingBlock = '';
    if (state === 'blocked_user') {
      const pending = act.pending || {};
      const pendingDesc = (pending.description || '').replace(/\n{3,}/g, '\n\n').trim();
      const pd = pending.prehook_decision;
      if (pending.tool_kind || pendingDesc) {
        pendingBlock = `
          <div class="card detail-card pending-card">
            <div class="pending-info pending-key"><span class="label">pending · ${U.esc(pending.tool_kind || 'tool')}</span>${U.esc(pendingDesc)}</div>
            ${pd ? `
              <div class="prehook-inline">
                ${C.decisionPill(pd.decision)}
                <span class="prehook-reason">${U.esc(pd.reason || '(no reason)')}</span>
                ${pd.source ? `<span class="prehook-source">${U.esc(pd.source)}</span>` : ''}
              </div>` : ''}
          </div>`;
      }
    }

    // decide bar (blocked_user)
    const decideBar = state === 'blocked_user' ? `
      <div class="card detail-card decide-bar">
        <span class="dim" style="font-size:10px;">decide:</span>
        <button class="btn primary" data-key="1" title="单次允许此工具调用">Yes [1]</button>
        <button class="btn warn"    data-key="2" title="永久白名单 — 慎用">Always [2]</button>
        <button class="btn info"    data-key="3" title="拒绝此调用">No [3]</button>
        <button class="btn"         data-key="Escape" title="取消整个工具调用">Cancel [Esc]</button>
        <span class="grow"></span>
        <span class="dim" style="font-size:10px;">≤10s 后 state 变化</span>
      </div>` : '';

    // proposals (idle_with_proposals)
    let proposalsBlock = '';
    if (state === 'idle_with_proposals') {
      const items = ((act.proposals && act.proposals.proposals) || []);
      const propTs = act.proposals && act.proposals.ts;
      const propsHtml = items.map(p => `
        <div class="proposal-card" data-proposal-id="${U.esc(p.id || '')}">
          <div class="proposal-head">
            <span class="proposal-title">${U.esc(p.title || '(no title)')}</span>
            <button class="btn primary proposal-choose" data-proposal-id="${U.esc(p.id || '')}">选这个</button>
          </div>
          ${p.rationale ? `<div class="proposal-rationale">${U.esc(p.rationale)}</div>` : ''}
          ${p.text ? `<div class="proposal-text">${U.esc(p.text)}</div>` : ''}
        </div>`).join('');
      proposalsBlock = `
        <div class="card detail-card proposals-section">
          <div class="proposals-head">
            <span class="proposals-title">下一步方案 (${items.length})</span>
            <span class="dim" style="font-size:10px;">gemini · ${propTs ? U.ago(propTs) : '?'}</span>
            <span class="grow"></span>
            <button class="btn proposal-dismiss">跳过全部</button>
          </div>
          ${propsHtml || '<div class="dim">no proposals</div>'}
        </div>`;
    }
    const isMuted = act.proposals_muted === true;
    const mutedNotice = isMuted ? `
      <div class="card detail-card proposals-muted-notice">
        <span class="dim">Proposals 已关闭 (muted) — agent 下次 stop 时不生成</span>
        <span class="grow"></span>
        <button class="btn primary proposal-enable">启用</button>
      </div>` : '';

    // send command card 已下线 — 改走 chat-pane 内嵌 input row (preChat).
    el.innerHTML = pendingBlock + decideBar + proposalsBlock + mutedNotice;
    bindDecide(a.agent_id);
    bindProposals(a.agent_id);
  }

  function bindDecide(agentId) {
    const bar = document.querySelector('.decide-bar');
    if (!bar) return;
    bar.querySelectorAll('button[data-key]').forEach(btn => {
      btn.addEventListener('click', () => doDecide(agentId, btn.dataset.key, btn));
    });
  }

  function bindProposals(agentId) {
    const sec = document.querySelector('.proposals-section');
    if (sec) {
      sec.querySelectorAll('.proposal-choose').forEach(btn => {
        btn.addEventListener('click', () => doChooseProposal(agentId, btn.dataset.proposalId, btn));
      });
      const dismissBtn = sec.querySelector('.proposal-dismiss');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => doDismissProposals(agentId, dismissBtn));
      }
    }
    // muted notice 的 [启用] 按钮 (与 proposals-section 互斥/共存均可)
    const enableBtn = document.querySelector('.proposals-muted-notice .proposal-enable');
    if (enableBtn) {
      enableBtn.addEventListener('click', () => doEnableProposals(agentId, enableBtn));
    }
  }

  async function doChooseProposal(agentId, proposalId, btn) {
    if (!proposalId) { U.toast('proposal_id 缺失', 'warn'); return; }
    if (btn) btn.disabled = true;
    try {
      const r = await A.chooseProposal(agentId, proposalId);
      U.toast('chose · ' + proposalId.substring(0, 8) + ' · 注入 agent pane');
      setTimeout(refreshAgents, 1500);
      setTimeout(refreshAgents, 4000);
    } catch (e) {
      const msg = e.kind === 'http' ? e.status + ' ' + (typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {})) : (e.message || 'error');
      U.toast('choose failed: ' + msg, 'err');
      if (btn) btn.disabled = false;
    }
  }

  async function doDismissProposals(agentId, btn) {
    if (btn) btn.disabled = true;
    try {
      // 默认 mute=true, master 清当前 + 停未来生成 (防循环)
      const r = await A.dismissProposals(agentId);
      const muted = r && r.muted ? ' + muted (停未来生成)' : '';
      U.toast('proposals 已跳过' + muted);
      setTimeout(refreshAgents, 1000);
    } catch (e) {
      const msg = e.kind === 'http' ? e.status + ' ' + (typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {})) : (e.message || 'error');
      U.toast('dismiss failed: ' + msg, 'err');
      if (btn) btn.disabled = false;
    }
  }

  async function doEnableProposals(agentId, btn) {
    if (btn) btn.disabled = true;
    try {
      await A.enableProposals(agentId);
      U.toast('proposals 已启用 — agent 下次 stop 时重新生成');
      setTimeout(refreshAgents, 1000);
    } catch (e) {
      const msg = e.kind === 'http' ? e.status + ' ' + (typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {})) : (e.message || 'error');
      U.toast('enable failed: ' + msg, 'err');
      if (btn) btn.disabled = false;
    }
  }

  // mini_task list modal — agent row 点 [Mini Tasks] 触发
  async function openMiniTasksList(agentId) {
    C.showModal({
      title: 'Mini Tasks · ' + agentId.split('.').pop(),
      html: '<div class="dim">loading...</div>',
    });
    await renderMiniTasksList(agentId);
  }

  async function renderMiniTasksList(agentId) {
    const body = document.getElementById('pre-modal-body');
    if (!body) return;
    body.innerHTML = '<div class="dim">loading...</div>';
    try {
      const r = await A.agentMiniTasks(agentId, { limit: 20 });
      const list = (r && r.mini_tasks) || [];
      const refreshBtn = `<div class="mt-list-head"><span class="dim">${list.length} mini_task(s) · ${U.esc(agentId)}</span><span class="grow"></span><button class="btn" id="mt-refresh">Refresh</button></div>`;
      if (!list.length) {
        body.innerHTML = refreshBtn + '<div class="dim p-12">no mini_tasks (agent 还没 stop hook 写入)</div>';
      } else {
        const rows = list.map((mt, i) => {
          const reqPreview = (mt.request || '').replace(/\s+/g, ' ').substring(0, 80);
          const dispatchTag = mt.parent_dispatch_id
            ? `<a class="mt-dispatch" href="dispatches.html?dispatch=${encodeURIComponent(mt.parent_dispatch_id)}" data-stop="1" target="_blank" rel="noopener noreferrer" title="open dispatch">↗ ${U.esc(mt.parent_dispatch_id)}</a>`
            : '';
          return `<div class="mt-row" data-mt-id="${U.esc(mt.mini_task_id)}" data-idx="${i}">
            <div class="mt-row-head">
              <span class="ts">${U.esc(U.ago(mt.started_ts))}</span>
              <span class="dim">${mt.duration_sec || 0}s · ${mt.tool_count || 0} tools</span>
              ${dispatchTag}
              <span class="grow"></span>
              <span class="dim mt-toggle">▶ 详情</span>
            </div>
            <div class="mt-req-preview">${U.esc(reqPreview)}${(mt.request || '').length > 80 ? '…' : ''}</div>
            <div class="mt-detail" data-loaded="0"></div>
          </div>`;
        }).join('');
        body.innerHTML = refreshBtn + '<div class="mt-list">' + rows + '</div>';
      }
      const refresh = document.getElementById('mt-refresh');
      if (refresh) refresh.addEventListener('click', () => renderMiniTasksList(agentId));
      body.querySelectorAll('.mt-row').forEach(row => {
        const head = row.querySelector('.mt-row-head');
        if (!head) return;
        head.addEventListener('click', (e) => {
          if (e.target.closest('[data-stop]')) return;
          toggleMiniTaskDetail(row);
        });
      });
    } catch (e) {
      const msg = e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'error');
      body.innerHTML = `<div class="dim p-12">mini-tasks 失败: ${U.esc(msg)}</div>`;
    }
  }

  async function toggleMiniTaskDetail(row) {
    const detail = row.querySelector('.mt-detail');
    const toggle = row.querySelector('.mt-toggle');
    if (!detail) return;
    const expanded = row.classList.contains('expanded');
    if (expanded) {
      row.classList.remove('expanded');
      if (toggle) toggle.textContent = '▶ 详情';
      return;
    }
    // 展开 + (如未加载) lazy fetch
    row.classList.add('expanded');
    if (toggle) toggle.textContent = '▼ 收起';
    if (detail.dataset.loaded === '1') return;
    detail.innerHTML = '<div class="dim">loading...</div>';
    try {
      const mtId = row.dataset.mtId;
      const mt = await A.miniTask(mtId);
      detail.innerHTML = renderMiniTaskDetail(mt);
      // actions 用 textContent 单独填, 防 HTML 注入
      fillActions(detail, mt.actions || []);
      detail.dataset.loaded = '1';
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

  // actions 单独渲染用 textContent (per pre 安全要求, 防 tool_result 内 HTML 误执行)
  // 调用方在 detail.innerHTML 设置后再调用此函数填 .mt-actions
  function fillActions(detail, actions) {
    const host = detail.querySelector('.mt-actions');
    if (!host) return;
    host.innerHTML = '';
    (actions || []).forEach(a => {
      const row = document.createElement('div');
      row.className = 'mt-action mt-action-' + (a.kind || 'unknown');
      const tag = document.createElement('span');
      tag.className = 'mt-action-tag';
      const KIND = { assistant_text: 'TXT', tool_use: 'TOOL', tool_result: 'OK' };
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

  async function doDecide(agentId, key, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await A.decide(agentId, { key, by_agent: 'user.default' });
      const id = (r && r.decide_id) ? r.decide_id.substring(0, 8) : 'queued';
      U.toast('decide injected · key=' + key + ' · id=' + id + ' · ≤10s 看 state');
      // pre 推荐: 1s/4s 加密轮询主列表确认 state 变化
      setTimeout(() => refreshAgents(), 1500);
      setTimeout(() => refreshAgents(), 4000);
      // 4s+1s 后仍 blocked_user 提示用户
      setTimeout(() => {
        const a = allAgents.find(x => x.agent_id === agentId);
        if (a && effState(a) === 'blocked_user') {
          U.toast('agent 仍 blocked_user, 注入可能未生效, 检查 tmux pane', 'warn');
        }
      }, 5000);
    } catch (e) {
      const msg = e.kind === 'http' ? e.status + ' ' + (typeof e.body === 'string' ? e.body : JSON.stringify(e.body)) : (e.message || 'error');
      U.toast('decide failed: ' + msg, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // bindSend / doSend 已移除 — chat 用 preChat 内置 input row, command 当前阶段不需要.

  async function refreshAgents() {
    try {
      const r = await A.agents();
      const live = (r && r.agents) || [];
      mergeFromMaster(live);   // 容错: 只增不减 + sort + offline 标
      applyFilter();
      if (selectedId && allAgents.find(a => a.agent_id === selectedId)) {
        // 只更新 title-bar, chat-pane DOM 不动 (由 preChat 5s 自轮询)
        renderHeader();
        refreshChatSendEnable();
        refreshChatDecide();
      }
    } catch (e) {
      const host = document.getElementById('agent-list');
      const msg = e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'network');
      host.innerHTML = `<div class="dim p-12">agents: ${U.esc(msg)}</div>`;
      lastRowIds = [];
    }
  }

    refreshAgents();
    const stopPoll = U.poll(refreshAgents, 5000);

    if (selectedId) {
      setTimeout(() => {
        if (allAgents.find(a => a.agent_id === selectedId)) selectAgent(selectedId);
      }, 200);
    }

    return function unmount() {
      stopPoll();
      if (window.preChat && preChatAttached) {
        window.preChat.detach();
        preChatAttached = false;
      }
      detailShellAgent = null;
    };
  }

  // --- SPA registration ---
  window.preApp = window.preApp || {};
  window.preApp.agents = { init };

  // --- Standalone fallback ---
  if (!document.getElementById('app-content')) {
    const host = document.getElementById('appbar-host');
    if (host) {
      host.innerHTML = C.appBar('agents');
      C.startHealthBeacon();
    }
    init();
  }
})();

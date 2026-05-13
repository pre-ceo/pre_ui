// pre_ui mobile — iOS 单页快速 decide
// 仅显示 activity.state === 'blocked_user' 的 agent, 4 大按钮直接 POST /decide.
// 5s 轮询, 已批准的自动从列表消失.
(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const list = document.getElementById('m-list');
  const stats = document.getElementById('m-stats');
  const health = document.getElementById('m-health');
  const toastEl = document.getElementById('m-toast');

  let pendingAgents = [];

  function showToast(msg, kind) {
    toastEl.className = 'm-toast show' + (kind ? ' ' + kind : '');
    toastEl.textContent = msg;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toastEl.className = 'm-toast'; }, kind === 'err' ? 4500 : 2500);
  }

  function summaryHtml(act) {
    const summary = act.task_summary;
    if (summary && summary !== '空闲') {
      return `<div class="summary">${U.esc(summary)}</div>`;
    }
    if (summary === '空闲') {
      return `<div class="summary empty">空闲 (LLM 判断, 但仍 blocked_user — 检查 pane)</div>`;
    }
    if (act.task_title) {
      return `<div class="summary fallback">${U.esc(act.task_title.substring(0, 100))}${act.task_title.length > 100 ? '…' : ''}</div>`;
    }
    return '';
  }

  // 派生状态判断
  function hasIdleProposals(a) {
    const act = a.activity || {};
    if ((act.state || a.state) !== 'idle') return false;
    const p = act.proposals;
    return !!(p && Array.isArray(p.proposals) && p.proposals.length > 0);
  }
  function effState(a) {
    const act = a.activity || {};
    if (hasIdleProposals(a)) return 'idle_with_proposals';
    return act.state || a.state || 'unknown';
  }

  function cardHTML(a) {
    const act = a.activity || {};
    const role = a.role || '?';
    const short = a.agent_id.split('.').pop();
    const es = effState(a);

    // 共用的上下文 (任何一种 mode 都显示)
    const headTime = es === 'blocked_user'
      ? (act.since_ts ? U.ago(act.since_ts) + ' 前等批准' : '')
      : (act.proposals && act.proposals.ts ? U.ago(act.proposals.ts) + ' 前生成方案' : '');

    let bodyHtml = '';
    let actionsHtml = '';

    if (es === 'blocked_user') {
      // ---- decide 模式 ----
      // 顺序: summary → pane → pending (含 prehook 历史) → decision
      // last_action 与 pending 内容高度重复, 不显示 (user 反馈)
      const pending = act.pending || {};
      const pendingDesc = (pending.description || '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .substring(0, 600);
      const pendingHtml = pending.tool_kind || pendingDesc ? `
        <div class="pending-info pending-key"><span class="label">pending · ${U.esc(pending.tool_kind || 'tool')}</span>${U.esc(pendingDesc)}</div>` : '';
      // prehook_decision 内联到 pending, 不再单独查询 history
      const pd = pending.prehook_decision;
      const prehookHtml = pd ? `
        <div class="prehook-inline">
          ${C.decisionPill(pd.decision)}
          <span class="prehook-reason">${U.esc(pd.reason || '(no reason)')}</span>
          ${pd.source ? `<span class="prehook-source">${U.esc(pd.source)}</span>` : ''}
        </div>` : '';
      const paneSummary = act.pane_summary ? `
        <div class="m-section-label">pane_summary</div>
        <pre class="pane-summary">${U.esc(act.pane_summary)}</pre>` : '';
      bodyHtml = `${summaryHtml(act)}${paneSummary}${pendingHtml}${prehookHtml}`;
      actionsHtml = `
        <div class="m-actions">
          <button class="m-btn primary" data-mode="decide" data-key="1">Yes<span class="key">单次</span></button>
          <button class="m-btn warn"    data-mode="decide" data-key="2">Always<span class="key">永久</span></button>
          <button class="m-btn info"    data-mode="decide" data-key="3">No<span class="key">让改</span></button>
          <button class="m-btn cancel"  data-mode="decide" data-key="Escape">Cancel<span class="key">取消</span></button>
        </div>`;
    } else if (es === 'idle_with_proposals') {
      // ---- proposals 模式 ----
      // user 偏好: 先看 pane 再决定. 上下文在前, proposals + 选/跳按钮在后.
      const items = (act.proposals && act.proposals.proposals) || [];
      const lastRespHtml = act.last_response_excerpt ? `
        <div class="m-section-label">last_response_excerpt</div>
        <pre class="last-response">${U.esc(act.last_response_excerpt)}</pre>` : '';
      const paneSummary = act.pane_summary ? `
        <div class="m-section-label">pane_summary</div>
        <pre class="pane-summary">${U.esc(act.pane_summary)}</pre>` : '';
      const propsHtml = items.map(p => `
        <div class="m-proposal" data-proposal-id="${U.esc(p.id || '')}">
          <div class="m-proposal-title">${U.esc(p.title || '(no title)')}</div>
          ${p.rationale ? `<div class="m-proposal-rationale">${U.esc(p.rationale)}</div>` : ''}
          ${p.text ? `<div class="m-proposal-text">${U.esc(p.text)}</div>` : ''}
          <button class="m-btn primary m-btn-wide" data-mode="choose" data-proposal-id="${U.esc(p.id || '')}">
            选这个
          </button>
        </div>
      `).join('');
      bodyHtml = `
        ${summaryHtml(act)}
        ${lastRespHtml}
        ${paneSummary}
        <div class="m-proposals-title">下一步方案 (${items.length}) · gemini</div>
        ${propsHtml}
      `;
      actionsHtml = `
        <div class="m-actions m-actions-single">
          <button class="m-btn cancel m-btn-wide" data-mode="dismiss">跳过全部</button>
        </div>`;
    }

    const cardClass = 'm-card' + (es === 'idle_with_proposals' ? ' m-card-proposals' : '');
    return `
      <div class="${cardClass}" data-agent-id="${U.esc(a.agent_id)}">
        <div class="head">
          <span class="agent-id">${U.esc(short)}</span>
          <span class="role">${U.esc(role)}</span>
          <span class="ago">${headTime}</span>
        </div>
        ${bodyHtml}
        ${actionsHtml}
      </div>`;
  }

  function render() {
    if (!pendingAgents.length) {
      list.innerHTML = `<div class="m-empty">
        <span class="big">无 pending</span>
        所有 agent idle 或 busy<br>
        <span style="color:var(--dim);font-size:11px;">5s 轮询自动刷新</span>
      </div>`;
      return;
    }
    list.innerHTML = pendingAgents.map(cardHTML).join('');
    list.querySelectorAll('.m-card').forEach(card => {
      const aid = card.dataset.agentId;
      card.querySelectorAll('button[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => onAction(aid, btn, card));
      });
    });
    // prehook 决策已内联到 pending.prehook_decision, 不再单独 fetch
  }

  async function onAction(agentId, btn, card) {
    const mode = btn.dataset.mode;
    if (mode === 'decide') {
      return doDecide(agentId, btn.dataset.key, btn, card);
    }
    if (mode === 'choose') {
      return doChoose(agentId, btn.dataset.proposalId, btn, card);
    }
    if (mode === 'dismiss') {
      return doDismiss(agentId, btn, card);
    }
  }

  function fadeCard(card) {
    card.style.opacity = '0.4';
    card.style.pointerEvents = 'none';
  }
  function unfadeButtons(card) {
    card.querySelectorAll('button').forEach(b => b.disabled = false);
  }

  async function doDecide(agentId, key, btn, card) {
    card.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const r = await A.decide(agentId, { key, by_agent: 'user.default' });
      const id = (r && r.decide_id) ? r.decide_id.substring(0, 8) : 'queued';
      showToast(agentId.split('.').pop() + ' · key=' + key + ' · id=' + id);
      fadeCard(card);
      setTimeout(refresh, 1500);
      setTimeout(refresh, 4000);
    } catch (e) {
      const msg = e.kind === 'http' ? e.status + ' ' + (typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {})) : (e.message || 'error');
      showToast('decide failed: ' + msg, 'err');
      unfadeButtons(card);
    }
  }

  async function doChoose(agentId, proposalId, btn, card) {
    if (!proposalId) { showToast('proposal_id 缺失', 'warn'); return; }
    card.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await A.chooseProposal(agentId, proposalId);
      showToast(agentId.split('.').pop() + ' · 选 ' + proposalId.substring(0, 6) + ' · 注入');
      fadeCard(card);
      setTimeout(refresh, 1500);
      setTimeout(refresh, 4000);
    } catch (e) {
      const msg = e.kind === 'http' ? e.status + ' ' + (typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {})) : (e.message || 'error');
      showToast('choose failed: ' + msg, 'err');
      unfadeButtons(card);
    }
  }

  async function doDismiss(agentId, btn, card) {
    card.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await A.dismissProposals(agentId);
      showToast(agentId.split('.').pop() + ' · 跳过 proposals');
      fadeCard(card);
      setTimeout(refresh, 1500);
    } catch (e) {
      const msg = e.kind === 'http' ? e.status + ' ' + (typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {})) : (e.message || 'error');
      showToast('dismiss failed: ' + msg, 'err');
      unfadeButtons(card);
    }
  }

  async function refresh() {
    try {
      const r = await A.agents();
      const agents = (r && r.agents) || [];
      // mobile 显示策略 (per user):
      //   有任何 blocked_user 时 — **只**显示 blocked_user (急救模式, 不让 proposals 分散注意力)
      //   无 blocked_user 时 — 显示 idle_with_proposals (等用户选下一步)
      const blocked = agents.filter(a => effState(a) === 'blocked_user');
      const idleProps = agents.filter(a => effState(a) === 'idle_with_proposals');
      pendingAgents = blocked.length > 0 ? blocked : idleProps;
      // 同类内倒序: blocked 按 since_ts, idle_with_proposals 按 proposals.ts
      pendingAgents.sort((a, b) => {
        const ta = (a.activity && a.activity.since_ts) || ((a.activity || {}).proposals || {}).ts || 0;
        const tb = (b.activity && b.activity.since_ts) || ((b.activity || {}).proposals || {}).ts || 0;
        return tb - ta;
      });
      // 数量统计 — 即便不显示 proposals 也告诉用户存在多少 (隐藏中)
      const blockedCount = blocked.length;
      const propsCount = idleProps.length;
      const busy = agents.filter(a => (a.activity || {}).state === 'busy').length;
      const propsLabel = blockedCount > 0 && propsCount > 0
        ? `${propsCount} proposals (待 blocked 处理后显示)`
        : `${propsCount} proposals`;
      stats.textContent = `${blockedCount} blocked · ${propsLabel} · ${busy} busy`;
      health.textContent = 'master ok';
      health.className = 'm-health ok';
      render();
    } catch (e) {
      health.textContent = e.kind === 'http' ? 'HTTP ' + e.status : 'offline';
      health.className = 'm-health err';
      list.innerHTML = `<div class="m-empty">
        <span class="big" style="color:var(--magenta);">网络错误</span>
        ${U.esc(e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'fetch failed'))}<br>
        <span style="color:var(--dim);font-size:11px;">5s 自动重试</span>
      </div>`;
    }
  }

  refresh();
  U.poll(refresh, 5000);
})();

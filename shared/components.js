// pre_ui shared components — small DOM render helpers.
// 全部纯函数 → 返回 HTML 字符串, 调用者 innerHTML 注入.
// 内容均经 esc() 处理或受控字段; 用户来源 markdown 必走 DOMPurify (见 mdRender 注释).

(function (global) {
  'use strict';
  const U = global.preUtils;

  // --- Pills ---
  // state 支持:
  //   - 旧 agent.state: idle/busy/blocked/error/offline
  //   - activity.state: idle/busy/blocked_user/thinking/offline
  //   - 260429.X 派生 'idle_with_proposals': idle 但 activity.proposals 非空, 等用户选下一步
  function statePill(state) {
    const s = (state || 'unknown').toLowerCase();
    const known = ['idle','busy','thinking','blocked','blocked_user','idle_with_proposals',
                   'error','offline','stale','failed'];
    const cls = known.indexOf(s) >= 0 ? ('st-' + s) : 'dim';
    const SHORT = { 'idle_with_proposals': 'proposals', 'blocked_user': 'blocked_user' };
    const label = SHORT[s] || s;
    return `<span class="pill ${cls}" title="${U.esc(s)}">${U.esc(label)}</span>`;
  }
  function rolePill(role) {
    const r = (role || '').toLowerCase();
    const known = ['ceo','worker','freerun-worker','observer'];
    const cls = known.indexOf(r) >= 0 ? ('role-' + r) : 'dim';
    return `<span class="pill ${cls}">${U.esc(r || '?')}</span>`;
  }
  function levelPill(level) {
    const l = (level || 'INFO').toUpperCase();
    return `<span class="pill sev-${U.esc(l)}">${U.esc(l)}</span>`;
  }

  // prehook decision pill: allow=cyan / deny=magenta / ask=yellow
  function decisionPill(decision) {
    const d = (decision || 'unknown').toLowerCase();
    const COLOR = { 'allow': 'cyan', 'deny': 'magenta', 'ask': 'yellow' };
    const cls = COLOR[d] || 'dim';
    return `<span class="pill ${cls}" title="${U.esc(d)}">${U.esc(d)}</span>`;
  }

  //  priority pill: critical=magenta / high=yellow / normal=cyan (HC-FE-5 暗色 + 红绿色弱)
  function priorityPill(priority) {
    const p = (priority || 'unknown').toLowerCase();
    const COLOR = { 'critical': 'magenta', 'high': 'yellow', 'normal': 'cyan' };
    const cls = COLOR[p] || 'dim';
    return `<span class="pill ${cls}" title="${U.esc(p)}">${U.esc(p)}</span>`;
  }

  //  channel pill: webhook-notify=blue / cli_sendkeys=yellow / master_log=dim
  function channelPill(channel) {
    const c = (channel || 'unknown').toLowerCase();
    const COLOR = { 'webhook-notify': 'blue', 'cli_sendkeys': 'yellow', 'master_log': 'dim' };
    const cls = COLOR[c] || 'dim';
    return `<span class="pill ${cls}" title="${U.esc(c)}">${U.esc(c)}</span>`;
  }

  // 渲染最近 N 条 prehook decisions, 共用于 mobile + desktop
  function prehookList(decisions) {
    if (!decisions || !decisions.length) {
      return '<div class="dim" style="font-size:11px;padding:4px 0;">no recent prehook decisions</div>';
    }
    return `<div class="prehook-list">${decisions.map(d => `
      <div class="prehook-row">
        <span class="prehook-ts">${U.esc(U.ago(d.ts))}</span>
        ${decisionPill(d.decision)}
        <span class="prehook-tool">${U.esc(d.tool || '?')}</span>
        <span class="prehook-reason">${U.esc((d.reason || d.source || '').substring(0, 80))}</span>
        ${d.source ? `<span class="prehook-source">${U.esc(d.source)}</span>` : ''}
      </div>
      ${d.input_preview ? `<div class="prehook-input dim">${U.esc(d.input_preview)}</div>` : ''}
    `).join('')}</div>`;
  }

  // dispatch status pill (dispatches tab)
  // 配色: in_progress_evaluation=yellow / approved_pending_executor=blue /
  //       executing=cyan / done=dim / rejected=magenta / abandoned=dim
  function statusPill(status) {
    const s = (status || 'unknown').toLowerCase();
    const COLOR = {
      'in_progress_evaluation': 'yellow',
      'approved_pending_executor': 'blue',
      'executing': 'cyan',
      'done': 'dim',
      'rejected': 'magenta',
      'abandoned': 'dim',
    };
    const SHORT = {
      'in_progress_evaluation': 'evaluating',
      'approved_pending_executor': 'pending exec',
      'executing': 'executing',
      'done': 'done',
      'rejected': 'rejected',
      'abandoned': 'abandoned',
    };
    const cls = COLOR[s] || 'dim';
    return `<span class="pill ${cls}" title="${U.esc(s)}">${U.esc(SHORT[s] || s)}</span>`;
  }

  // --- App bar (扁平 IDE 风: <header.appbar> + <nav.tab-bar>) ---
  // active: one of 'index','agents','tasks','dispatches','usage','notifications','settings'
  // pending/findings 推后, appbar 不暴露 (pending.html 文件保留作历史).
  function appBar(active) {
    const tabs = [
      ['home', 'index.html', 'home'],
      ['agents', 'agents.html', 'agents'],
      ['tasks', 'tasks.html', 'tasks'],
      ['dispatches', 'dispatches.html', 'dispatches'],
      ['usage', 'usage.html', 'usage'],
      ['notifications', 'notifications.html', 'notifications'],
      ['settings', 'settings.html', 'settings'],
    ];
    const tabHtml = tabs.map(([k, href, lbl]) => {
      const cls = k === active ? 'tab active' : 'tab';
      return `<a href="${href}" class="${cls}">${U.esc(lbl)}</a>`;
    }).join('');
    const titleLabel = (tabs.find(t => t[0] === active) || ['', '', ''])[2];
    return `
      <header class="appbar">
        <span class="brand">pre · CEO</span>
        <span class="ctx" id="appbar-title">${U.esc(titleLabel || 'home')}</span>
        <span class="grow"></span>
        <span id="appbar-token" class="ts">token: -</span>
        <span id="appbar-health" class="health">master ?</span>
        <span id="appbar-clock" class="ts"></span>
      </header>
      <nav class="tab-bar">${tabHtml}</nav>`;
  }

  // Show token mask in appbar (must_have #5: 让用户知道用的哪个 token)
  function refreshTokenLabel() {
    const el = document.getElementById('appbar-token');
    if (!el || !global.preApi || !global.preUtils) return;
    el.textContent = 'token: ' + global.preUtils.maskToken(global.preApi.getToken());
  }

  // 在 appBar() 渲染之后调用以激活 health 探测 (5s) + clock (1s).
  function startHealthBeacon() {
    refreshTokenLabel();
    startClock();
    const el = document.getElementById('appbar-health');
    if (!el) return null;
    async function tick() {
      try {
        const r = await global.preApi.healthz();
        // healthz 返回纯文本 "pre master ok"
        const ok = typeof r === 'string' ? r.indexOf('ok') >= 0 : !!r;
        el.textContent = ok ? 'master ok' : 'master ?';
        el.className = 'health ' + (ok ? 'ok' : 'warn');
      } catch (e) {
        el.textContent = e && e.kind === 'http' && e.status === 401 ? 'master 401' : 'master offline';
        el.className = 'health err';
      }
    }
    return U.poll(tick, 5000);
  }

  // title-bar 时钟 (fn_fe 风格): 每秒刷新 #appbar-clock.
  function startClock() {
    const el = document.getElementById('appbar-clock');
    if (!el) return null;
    function paint() {
      el.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }
    paint();
    return setInterval(paint, 1000);
  }

  // --- Modal ---
  // showModal({title, html, onClose})
  function showModal(opts) {
    closeModal();
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.id = 'pre-modal-bg';
    bg.innerHTML = `
      <div class="modal" role="dialog">
        <div class="row" style="margin-bottom:8px;">
          <h3 style="margin:0;">${U.esc(opts.title || '')}</h3>
          <span class="grow"></span>
          <button class="btn" id="pre-modal-close">close (Esc)</button>
        </div>
        <div id="pre-modal-body">${opts.html || ''}</div>
      </div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', (e) => {
      if (e.target === bg) closeModal();
    });
    document.getElementById('pre-modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', escClose, { once: true });
    if (opts.onClose) bg._onClose = opts.onClose;
  }
  function escClose(e) {
    if (e.key === 'Escape') closeModal();
    else document.addEventListener('keydown', escClose, { once: true });
  }
  function closeModal() {
    const bg = document.getElementById('pre-modal-bg');
    if (!bg) return;
    if (bg._onClose) bg._onClose();
    bg.remove();
  }

  // --- Markdown -> sanitized HTML (marked.js + DOMPurify 双层) ---
  // marked.js (vendored 14.1.4 SRI 锁) 解析 markdown → DOMPurify 严格白名单净化.
  // 调用方需 <script src="shared/vendor/marked.min.js"> + dompurify.min.js 已加载.
  function mdRender(src) {
    if (!src) return '';
    if (!global.marked || !global.DOMPurify) {
      console.error('marked.js or DOMPurify missing — refusing to render');
      return '<pre>' + U.esc(src) + '</pre>';
    }
    let html;
    try {
      html = global.marked.parse(String(src), { gfm: true, breaks: false });
    } catch (e) {
      console.error('marked.parse failed:', e);
      return '<pre>' + U.esc(src) + '</pre>';
    }
    const clean = global.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['a','p','h1','h2','h3','h4','h5','h6','strong','em','b','i','code','pre','ul','ol','li','blockquote','hr','br','span','div','table','thead','tbody','tr','th','td'],
      ALLOWED_ATTR: ['href','title','class'],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
      FORBID_TAGS: ['script','iframe','style','object','embed','form','input','button','svg','math','base','meta','link'],
      FORBID_ATTR: ['style','onerror','onload','onclick','onmouseover','onfocus','onblur','onchange','formaction'],
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
    });
    // 给所有 <a> 自动加 rel=noopener noreferrer + target=_blank (防 tabnabbing)
    const wrapper = document.createElement('div');
    wrapper.innerHTML = clean;
    wrapper.querySelectorAll('a[href]').forEach(a => {
      a.setAttribute('rel', 'noopener noreferrer');
      a.setAttribute('target', '_blank');
    });
    return wrapper.innerHTML;
  }

  global.preCmp = {
    statePill, rolePill, levelPill, statusPill, decisionPill,
    priorityPill, channelPill,
    prehookList,
    appBar, startHealthBeacon, startClock, refreshTokenLabel,
    showModal, closeModal,
    mdRender,
  };
})(window);

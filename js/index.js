// pre_ui — home tab (SPA hash #home)
// 注册 window.preApp.home; 同时保留旧 index.html standalone 入口的兼容 (现已被 SPA shell 取代,
// 但若有人通过别的路径直接打开同名页, IIFE fallback 不会出错).

(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="card">
      <h2>master 健康</h2>
      <div id="health-panel" class="dim">probing...</div>
    </div>

    <div class="card">
      <h2>总览</h2>
      <div class="row" style="gap:24px; flex-wrap:wrap;">
        <div><div class="dim">nodes</div><div id="stat-nodes" style="font-size:18px;">-</div></div>
        <div><div class="dim">agents</div><div id="stat-agents" style="font-size:18px;">-</div></div>
      </div>
    </div>

    <div class="card">
      <h2>页面导航</h2>
      <div class="row" style="gap:8px; flex-wrap:wrap;">
        <a class="ab p" href="#agents">agents</a>
        <a class="ab p" href="#tasks">tasks</a>
        <a class="ab p" href="#dispatches">dispatches</a>
        <a class="ab" href="#usage">usage</a>
        <a class="ab" href="#notifications">notifications</a>
        <a class="ab" href="#settings">settings</a>
      </div>
    </div>

    <div class="card">
      <h2>说明</h2>
      <div class="dim" style="line-height:1.8;">
        <div>· user 单用户单机 admin GUI, 角色固定 CEO</div>
        <div>· 后端 fetch @ <code id="master-url">-</code></div>
        <div>· 红绿色弱配色: cyan = 正常 / yellow = 警告 / blue = 信息 / magenta = CRITICAL</div>
        <div>· SPA hash 路由: #home / #agents / #tasks / #dispatches / #usage / #notifications / #settings</div>
        <div>· self-proxy: 浏览器同 origin 5174, 内部反代 master 19500, 无 CORS</div>
      </div>
    </div>`;

  function init(host) {
    if (host) host.innerHTML = TEMPLATE;

    const masterUrlEl = document.getElementById('master-url');
    if (masterUrlEl) masterUrlEl.textContent = './api/v1/* (5174 self-proxy → master 19500)';

    async function refresh() {
      const panel = document.getElementById('health-panel');
      if (!panel) return;
      try {
        const txt = await A.healthz();
        panel.textContent = typeof txt === 'string' ? txt : JSON.stringify(txt);
        panel.className = 'mono c-cyan';
      } catch (e) {
        panel.textContent = e.kind === 'http'
          ? `HTTP ${e.status}: ${typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {})}`
          : `network: ${e.message || 'unknown'}`;
        panel.className = 'mono c-magenta';
      }
      try {
        const [nodes, agents] = await Promise.all([
          A.nodes().catch(() => null),
          A.agents().catch(() => null),
        ]);
        const n = document.getElementById('stat-nodes');
        const a = document.getElementById('stat-agents');
        if (n) n.textContent = nodes && nodes.nodes ? nodes.nodes.length : '-';
        if (a) a.textContent = agents && agents.agents ? agents.agents.length : '-';
      } catch (_) { /* ignore */ }
      C.refreshTokenLabel();
    }
    refresh();
    const stopPoll = U.poll(refresh, 5000);

    return function unmount() { stopPoll(); };
  }

  // --- SPA registration ---
  window.preApp = window.preApp || {};
  window.preApp.home = { init };

  // --- Standalone fallback (old index.html direct hits during migration) ---
  if (!document.getElementById('app-content')) {
    const host = document.getElementById('appbar-host');
    if (host) {
      host.innerHTML = C.appBar('home');
      C.startHealthBeacon();
    }
    init();
  }
})();

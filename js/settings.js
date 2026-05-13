// pre_ui — settings tab (SPA hash #settings)
// CLAUDE.md #5: type=password + autocomplete=off + 掩码 + localStorage
// (single-user single-machine admin GUI: localStorage 跨重启免重输; 截屏防护仍走 password+mask)

(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="term-page">
      <div id="reason-banner" class="ebox hidden" style="margin:0 0 8px 0;"></div>

      <pre class="term-block"><span class="sh"># bearer token</span>  <span class="m">current:</span> <span class="token-mask" id="token-mask">-</span>     <span class="m">(localStorage · 跨重启保留)</span>
  <span class="m">storage:</span> <span class="m">localStorage["pre_master_token"]</span></pre>

      <div class="cli-row">
        <span class="pa">❯</span><span class="pt">pre token</span><span class="m">set</span>
        <div class="if">
          <input id="token-input"
                 type="password"
                 name="master_token"
                 autocomplete="off"
                 spellcheck="false"
                 placeholder="Bearer token (magic link 自动注入, 或从 ~/.pre/env 复制)">
          <button class="ab" id="show-btn" type="button" title="按住显示明文">show</button>
          <button class="ab p" id="save-btn" type="button">save</button>
          <button class="ab" id="clear-btn" type="button">clear</button>
        </div>
      </div>

      <div class="cli-row">
        <span class="pa">❯</span><span class="pt">pre healthz</span>
        <button class="ab" id="ping-btn" type="button" style="margin-left:8px;">ping</button>
      </div>
      <pre class="term-result m" id="status">尚未 ping</pre>

      <pre class="term-hints"><span class="sh"># hints</span>
  <span class="m">·</span> self-proxy: browser <span class="c">5174</span> → master <span class="c">19500</span>
  <span class="m">·</span> localStorage 跨重启保留, clear 手动清; type=password + autocomplete=off (截屏安全)
  <span class="m">·</span> magic-link: pre 端 start_master.py 颁发激活 URL, fragment 走 localStorage
  <span class="m">·</span> 401 时, 顶部 ebox 显示跳转原因</pre>
    </div>`;

  function init(host) {
    if (host) host.innerHTML = TEMPLATE;

    const $ = (id) => document.getElementById(id);
    const tokenInput = $('token-input');
    const maskLabel = $('token-mask');
    const saveBtn = $('save-btn');
    const clearBtn = $('clear-btn');
    const showBtn = $('show-btn');
    const pingBtn = $('ping-btn');
    const status = $('status');
    const reasonBanner = $('reason-banner');

    if (U.getParam('reason') === '401') {
      reasonBanner.textContent = '! 401 Unauthorized — 检查 Bearer token 是否正确';
      reasonBanner.classList.remove('hidden');
    }

    function refreshMask() {
      maskLabel.textContent = U.maskToken(A.getToken());
      C.refreshTokenLabel();
    }
    refreshMask();

    const onSave = () => {
      const v = (tokenInput.value || '').trim();
      if (!v) { U.toast('token 不能为空', 'warn'); return; }
      A.setToken(v);
      tokenInput.value = '';
      refreshMask();
      U.toast('token 已存入 localStorage (跨重启保留)');
    };
    const onClear = () => {
      A.clearToken();
      tokenInput.value = '';
      refreshMask();
      U.toast('token 已清除', 'warn');
    };
    const onShowDown  = () => { tokenInput.type = 'text'; };
    const onShowUp    = () => { tokenInput.type = 'password'; };
    const onShowLeave = () => { tokenInput.type = 'password'; };
    const onPing = async () => {
      pingBtn.disabled = true;
      status.textContent = 'pinging...';
      status.className = 'term-result m';
      try {
        const txt = await A.healthz();
        status.textContent = typeof txt === 'string' ? txt.trim() : JSON.stringify(txt);
        status.className = 'term-result s';
      } catch (e) {
        status.textContent = e.kind === 'http'
          ? `HTTP ${e.status}: ${typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {})}`
          : `network: ${e.message || 'unknown'}`;
        status.className = 'term-result e';
      } finally {
        pingBtn.disabled = false;
      }
    };
    const onEnter = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    };

    saveBtn.addEventListener('click', onSave);
    clearBtn.addEventListener('click', onClear);
    showBtn.addEventListener('mousedown', onShowDown);
    showBtn.addEventListener('mouseup', onShowUp);
    showBtn.addEventListener('mouseleave', onShowLeave);
    pingBtn.addEventListener('click', onPing);
    tokenInput.addEventListener('keydown', onEnter);

    return function unmount() {
      // Listeners attached to elements inside #app-content are GC'd when innerHTML is replaced.
      // No global timers / window listeners → nothing else to cancel.
    };
  }

  // --- SPA registration ---
  window.preApp = window.preApp || {};
  window.preApp.settings = { init };

  // --- Standalone fallback ---
  if (!document.getElementById('app-content')) {
    const host = document.getElementById('appbar-host');
    if (host) {
      host.innerHTML = C.appBar('settings');
      C.startHealthBeacon();
    }
    init();
  }
})();

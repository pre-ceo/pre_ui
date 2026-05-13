// pre_ui — settings tab (SPA hash #settings)
// CLAUDE.md #5: type=password + autocomplete=off + 掩码 + localStorage
// (single-user single-machine admin GUI: localStorage 跨重启免重输; 截屏防护仍走 password+mask)

(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="settings-wrap">
      <div id="reason-banner" class="banner err hidden"></div>

      <div class="card">
        <h2>Bearer token</h2>

        <div class="token-form">
          <label>当前 token</label>
          <div class="row">
            <span class="mask" id="token-mask">-</span>
            <span class="grow"></span>
            <span class="dim" style="font-size:10px;">存于 localStorage · 跨重启保留 (clear 手动清)</span>
          </div>

          <label for="token-input">新 token</label>
          <div class="row">
            <input id="token-input"
                   type="password"
                   name="master_token"
                   autocomplete="off"
                   spellcheck="false"
                   placeholder="输入 master Bearer token (默认 pre)">
            <button class="btn" id="show-btn" type="button" title="按住显示明文">show</button>
          </div>

          <div class="btn-row">
            <button class="btn primary" id="save-btn" type="button">save token</button>
            <button class="btn warn" id="clear-btn" type="button">clear token</button>
            <span class="grow"></span>
            <button class="btn" id="ping-btn" type="button">ping /healthz</button>
          </div>
        </div>

        <div class="status-line" id="status">尚未 ping</div>

        <div class="tip">
          · self-proxy 模式: 浏览器同 origin 5174 → 内部反代到 master 19500<br>
          · master URL 在 server 端 (<code>scripts/fe_server.py --master ...</code>), 浏览器侧不可改<br>
          · type=password + autocomplete=off, 截屏不泄露<br>
          · localStorage (CLAUDE.md #5, single-user 本机): token 持久化, 跨重启免重输; clear 手动清<br>
          · ping 走 <code>./healthz</code> 相对路径, 由 5174 反代到 master<br>
          · 401 跳设置页时, 顶部 banner 提示原因
        </div>
      </div>
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
      reasonBanner.textContent = '由于 401 Unauthorized 跳转, 请检查 Bearer token 是否正确';
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
      status.className = 'dim';
      try {
        const txt = await A.healthz();
        status.textContent = typeof txt === 'string' ? txt.trim() : JSON.stringify(txt);
        status.className = 'c-cyan';
      } catch (e) {
        status.textContent = e.kind === 'http'
          ? `HTTP ${e.status}: ${typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {})}`
          : `network: ${e.message || 'unknown'}`;
        status.className = 'c-magenta';
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

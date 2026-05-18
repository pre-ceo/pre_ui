// pre_ui SPA hash router.
//
// 单壳: index.html 内含 <header.appbar> + <nav.tab-bar> + <main#app-content> 扁平 IDE 风静态壳.
// 每个 js/<page>.js 在加载时注册 window.preApp[key] = { init }, init() 返回 unmount 函数.
// 路由器负责监听 hashchange, 切换 .tab.active, 调用 unmount/mount.
//
// hash 命名 = 模块 key. 默认 hash 为 'home'. 老 .html 入口仍可独立访问 (page JS
// 在缺少 #app-content 时走 standalone bootstrap).

(function (global) {
  'use strict';

  // 暂时收窄到 agents + usage + audit + settings (settings 是首次启动设 token 的入口,
  // 必须可见; 其他 tab 在 index.html 已 HTML-comment 隐藏). 老 #home/#tasks/... deep-link
  // 仍在 ALLOW 内, 可继续直链 (页面 JS 自带 init); 不在 tab-bar 出现只是不可见,
  // 不影响 module 注册. 恢复全套 → 改回 TABS+DEFAULT 即可.
  const TABS = ['agents', 'usage', 'audit', 'settings'];
  const ALLOW = new Set([
    'agents', 'home', 'tasks', 'dispatches', 'usage', 'audit', 'notifications', 'settings', 'pending',
  ]);
  const DEFAULT = 'agents';

  let activeKey = null;
  let activeUnmount = null;

  function readHash() {
    const h = (location.hash || '').replace(/^#/, '').split('?')[0].split('/')[0];
    return ALLOW.has(h) ? h : DEFAULT;
  }

  function setActiveTab(key) {
    document.querySelectorAll('#tab-bar .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.route === key);
    });
    const ttl = document.getElementById('appbar-title');
    if (ttl) ttl.textContent = key;
  }

  function navigate() {
    const key = readHash();
    if (key === activeKey) return;

    // Unmount previous
    if (activeUnmount) {
      try { activeUnmount(); } catch (e) { console.warn('[router] unmount err:', e); }
      activeUnmount = null;
    }

    activeKey = key;
    setActiveTab(key);

    const host = document.getElementById('app-content');
    host.innerHTML = '';

    const mod = (global.preApp || {})[key];
    if (mod && typeof mod.init === 'function') {
      try {
        const ret = mod.init(host);
        activeUnmount = (typeof ret === 'function') ? ret : null;
      } catch (e) {
        console.error('[router] mount err:', e);
        host.innerHTML = '<div class="ebox" style="margin:8px;">'
          + 'Failed to mount <code>' + key + '</code>: ' + (e && e.message ? String(e.message) : 'unknown')
          + '</div>';
      }
    } else {
      host.innerHTML = '<div class="card"><div class="dim">page "<code>'
        + key + '</code>" not registered (window.preApp missing init)</div></div>';
    }
  }

  function boot() {
    // Activate health beacon + clock once for the whole shell
    if (global.preCmp && typeof global.preCmp.startHealthBeacon === 'function') {
      global.preCmp.startHealthBeacon();
    }
    navigate();
    window.addEventListener('hashchange', navigate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.preRouter = { navigate, readHash };
})(window);

// pre_ui shared utils — small helpers, no deps.

(function (global) {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  // 时间戳归一: 接受 unix seconds / unix ms / ISO 字符串
  function _toMs(ts) {
    if (ts == null) return NaN;
    if (typeof ts === 'string') {
      const m = Date.parse(ts);
      return isNaN(m) ? NaN : m;
    }
    return ts > 1e12 ? ts : ts * 1000;
  }

  // Format timestamp to "HH:MM:SS" or "MM-DD HH:MM:SS"
  function fmtTs(ts, opts) {
    const ms = _toMs(ts);
    if (isNaN(ms)) return '-';
    const d = new Date(ms);
    const hh = pad2(d.getHours()), mm = pad2(d.getMinutes()), ss = pad2(d.getSeconds());
    if (opts && opts.full) {
      return `${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${hh}:${mm}:${ss}`;
    }
    return `${hh}:${mm}:${ss}`;
  }

  // "5s ago", "3m ago", "2h ago"
  function ago(ts) {
    const ms = _toMs(ts);
    if (isNaN(ms)) return '-';
    const dt = (Date.now() - ms) / 1000;
    if (dt < 0) return 'just now';
    if (dt < 60) return Math.floor(dt) + 's ago';
    if (dt < 3600) return Math.floor(dt / 60) + 'm ago';
    if (dt < 86400) return Math.floor(dt / 3600) + 'h ago';
    return Math.floor(dt / 86400) + 'd ago';
  }

  // Escape HTML for safe insertion via innerHTML when content is plain text.
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Query string helper.
  function qs(obj) {
    const parts = [];
    for (const k in obj) {
      if (obj[k] === undefined || obj[k] === null || obj[k] === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  // Get URL search param.
  function getParam(name) {
    const m = location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Toast popup (auto-clears).
  let toastTimer = null;
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.remove(); }, kind === 'err' ? 5000 : 2500);
  }

  // Pause polling when tab is hidden.
  function isVisible() { return document.visibilityState === 'visible'; }

  // Simple polling helper. Returns stop function.
  function poll(fn, intervalMs) {
    let stopped = false;
    let t = null;
    async function tick() {
      if (stopped) return;
      if (isVisible()) {
        try { await fn(); } catch (e) { console.warn('poll err', e); }
      }
      if (!stopped) t = setTimeout(tick, intervalMs);
    }
    tick();
    return () => { stopped = true; clearTimeout(t); };
  }

  // Persist key/value with namespace.
  // ls* = localStorage (持久, 跨标签 / 跨重启) — token 走这个 (single-user single-machine admin GUI)
  // ss* = sessionStorage (临时, 当前标签内) — UI 偏好如 selected_agent / filter
  const NS = 'pre_';
  function lsGet(k, dflt) {
    try { const v = localStorage.getItem(NS + k); return v == null ? dflt : v; }
    catch (_) { return dflt; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(NS + k, v); } catch (_) {}
  }
  function lsDel(k) {
    try { localStorage.removeItem(NS + k); } catch (_) {}
  }
  function ssGet(k, dflt) {
    try { const v = sessionStorage.getItem(NS + k); return v == null ? dflt : v; }
    catch (_) { return dflt; }
  }
  function ssSet(k, v) {
    try { sessionStorage.setItem(NS + k, v); } catch (_) {}
  }
  function ssDel(k) {
    try { sessionStorage.removeItem(NS + k); } catch (_) {}
  }

  // Mask helper: "abcdef1234" → "sk-••••1234"
  function maskToken(t) {
    if (!t) return '(unset)';
    const tail = t.length >= 4 ? t.slice(-4) : t;
    return 'sk-••••' + tail;
  }

  global.preUtils = {
    fmtTs, ago, esc, qs, getParam, toast, isVisible, poll,
    lsGet, lsSet, lsDel,
    ssGet, ssSet, ssDel, maskToken,
  };
})(window);

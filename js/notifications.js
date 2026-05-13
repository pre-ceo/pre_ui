// pre_ui — notifications.html ()
// mobile_audit 历史 UI: filter + 表格 + accordion 展开
// polling 30s, mock data 期 → 真 endpoint 期切换 (CEO command D2)
//
// 安全 (agent-security M1-M5):
//   M1 server 强制 to_agent ∈ VIRTUAL_AGENTS, 我不传 ?to_agent= 任意值
//   M2 server 端 6 类 SENSITIVE_PATTERNS 前置脱敏, GUI 收到 [REDACTED] 等占位符
//   M3 filter 字段严白 (priority/channel/from_agent/since/limit), 响应 9 字段严白
//   M4 30/min per Bearer, GUI 30s polling = 2/min 余量 15x
//   M5 0-cost polling 验证 (mock 期端到端连发不触发 master CPU 增 / LLM call)
//
// agent-security advisory:
//   A1 tab 名 Notifications 不要 Mobile (channel 含 sendkeys cli)
//   A2 [REDACTED]/[AWS_KEY] 等占位符 yellow 高亮
//   A3 429 触发显 banner + 暂停 polling 60s, 不 silent console.error
(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="notif-wrap">
      <div class="card">
        <h2>Notifications · user.default audit
          <span id="probed-ts" class="dim" style="font-weight:normal;font-size:11px;">- 条 · -</span>
        </h2>

        <div id="banner-host"></div>

        <div class="filter-bar">
          <select class="input" id="f-priority">
            <option value="">all priority</option>
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="normal">normal</option>
          </select>
          <select class="input" id="f-channel">
            <option value="">all channel</option>
            <option value="webhook-notify">webhook-notify</option>
            <option value="cli_sendkeys">cli_sendkeys</option>
            <option value="master_log">master_log</option>
          </select>
          <input class="input" id="f-from" placeholder="from_agent..." autocomplete="off">
          <select class="input" id="f-since">
            <option value="3600">last 1h</option>
            <option value="21600">last 6h</option>
            <option value="86400" selected>last 24h</option>
            <option value="604800">last 7d</option>
            <option value="2592000">last 30d</option>
          </select>
          <select class="input" id="f-limit">
            <option value="50">limit 50</option>
            <option value="100" selected>limit 100</option>
            <option value="200">limit 200</option>
            <option value="500">limit 500 (max)</option>
          </select>
          <span class="grow"></span>
          <button class="btn" id="btn-refresh">Refresh</button>
          <span class="dim" style="font-size:10px;" id="src-label">mock</span>
        </div>

        <div id="notif-list" class="notif-list">
          <div class="dim p-12">loading...</div>
        </div>

        <div class="dim" style="font-size:10px;margin-top:10px;">
          mobile_audit 历史 (user.default) · 30s 自动刷新 · text_preview 已 server 端脱敏 · ≤30 天
          · M1: VIRTUAL_AGENTS hardcoded server 端 · M4: polling 30/min 限频
        </div>
      </div>
    </div>`;

  function init(host) {
    if (host) host.innerHTML = TEMPLATE;

    const list = document.getElementById('notif-list');
    const probedTs = document.getElementById('probed-ts');
    const bannerHost = document.getElementById('banner-host');
    const srcLabel = document.getElementById('src-label');
    const fPri = document.getElementById('f-priority');
    const fChan = document.getElementById('f-channel');
    const fFrom = document.getElementById('f-from');
    const fSince = document.getElementById('f-since');
    const fLimit = document.getElementById('f-limit');
    const refreshBtn = document.getElementById('btn-refresh');

    // 状态
    let lastSuccess = null;       // cache 跨 refresh 保留, 永不清屏
    let pausedUntil = 0;          // A3 rate limit 暂停到此 ts (ms)
    let pollStop = null;
    let usingMock = false;        // mock 期标记

  // 状态从 URL 或 sessionStorage 恢复
  fPri.value = U.getParam('priority') || U.ssGet('notif_priority', '');
  fChan.value = U.getParam('channel') || U.ssGet('notif_channel', '');
  fFrom.value = U.getParam('from') || U.ssGet('notif_from', '');
  fSince.value = U.ssGet('notif_since', '86400');
  fLimit.value = U.ssGet('notif_limit', '100');

  // ----- A2 redact 占位符高亮 (text → safe HTML 仅 .redact-hl span) -----
  // 占位符列表 (与 agent-security M2 6 类对齐):
  //   [REDACTED] / [AWS_KEY] / [UUID] / [BEARER] / [SK_KEY] / [SSH_KEY_PATH] / [PRIVATE_KEY]
  function highlightRedacts(text) {
    if (!text) return '';
    // 先 esc, 再用占位符正则替换为 span (esc 后占位符仍可识别)
    const safe = U.esc(String(text));
    return safe.replace(/\[(REDACTED|AWS_KEY|UUID|BEARER|SK_KEY|SSH_KEY_PATH|PRIVATE_KEY|API_KEY|TOKEN)\]/g,
      m => `<span class="redact-hl">${m}</span>`);
  }

  function rowHTML(item, idx) {
    const fromShort = (item.from_agent || '?').split('.').pop();
    const toShort = (item.to_agent || '?').split('.').pop();
    const ts = U.ago(item.ts);
    const status = (item.status || 'unknown').toLowerCase();
    const sizeStr = item.payload_size != null ? item.payload_size + 'B' : '-';
    return `<div class="notif-row" data-idx="${idx}">
      <span class="col-ts" title="${U.esc(item.ts || '')}">${U.esc(ts)}</span>
      <span class="col-from" title="${U.esc(item.from_agent || '')}">${U.esc(fromShort)}</span>
      <span class="col-to">${U.esc(toShort)}</span>
      <span class="col-pri">${C.priorityPill(item.priority)}</span>
      <span class="col-chan">${C.channelPill(item.channel)}</span>
      <span class="col-status ${U.esc(status)}">${U.esc(status)}</span>
      <span class="col-size">${U.esc(sizeStr)}</span>
      <span class="col-toggle">▶</span>
    </div>`;
  }

  function listHeaderHTML() {
    return `<div class="notif-list-header">
      <span>ts</span>
      <span>from_agent</span>
      <span>to_user</span>
      <span>priority</span>
      <span>channel</span>
      <span>status</span>
      <span style="text-align:right;">size</span>
      <span></span>
    </div>`;
  }

  // ---- frontend narrow filter (在 backend filter 之上的 client-side 过滤) ----
  function applyFrontendNarrow(items) {
    const fromQ = (fFrom.value || '').toLowerCase().trim();
    if (!fromQ) return items;
    return items.filter(it => (it.from_agent || '').toLowerCase().indexOf(fromQ) >= 0);
  }

  function renderList(items) {
    if (!items || !items.length) {
      list.innerHTML = listHeaderHTML() + '<div class="dim p-12">无数据 (filter 无匹配 或 audit 历史空)</div>';
      probedTs.textContent = '0 条';
      return;
    }
    list.innerHTML = listHeaderHTML() + items.map((it, i) => rowHTML(it, i)).join('');
    list.querySelectorAll('.notif-row').forEach(row => {
      row.addEventListener('click', () => toggleRow(row, items[+row.dataset.idx]));
    });
    probedTs.textContent = `${items.length} 条 · 30s 自动刷新${usingMock ? ' (mock)' : ''}`;
  }

  function toggleRow(row, item) {
    const expanded = row.classList.contains('expanded');
    if (expanded) {
      // 折叠回去
      row.classList.remove('expanded');
      row.outerHTML = rowHTML(item, +row.dataset.idx);
      // 重 bind (outerHTML 后 row 已替换)
      const rows = list.querySelectorAll('.notif-row');
      const lastSuccessItems = applyFrontendNarrow((lastSuccess && lastSuccess.items) || []);
      rows.forEach(r => {
        r.addEventListener('click', () => toggleRow(r, lastSuccessItems[+r.dataset.idx]));
      });
      return;
    }
    // 展开
    row.classList.add('expanded');
    const fromShort = (item.from_agent || '?').split('.').pop();
    const toShort = (item.to_agent || '?').split('.').pop();
    const status = (item.status || 'unknown').toLowerCase();
    const sizeStr = item.payload_size != null ? item.payload_size + 'B' : '-';
    row.innerHTML = `
      <div class="row-head">
        <span class="col-ts" title="${U.esc(item.ts || '')}">${U.esc(U.ago(item.ts))}</span>
        <span class="col-from" title="${U.esc(item.from_agent || '')}">${U.esc(fromShort)}</span>
        <span class="col-to">${U.esc(toShort)}</span>
        <span class="col-pri">${C.priorityPill(item.priority)}</span>
        <span class="col-chan">${C.channelPill(item.channel)}</span>
        <span class="col-status ${U.esc(status)}">${U.esc(status)}</span>
        <span class="col-size">${U.esc(sizeStr)}</span>
        <span class="col-toggle">▼</span>
      </div>
      <div class="row-detail">
        <div><span class="label">text_preview</span> <span class="dim">(server 端脱敏, ≤100 char)</span></div>
        <div class="preview-block">${highlightRedacts(item.text_preview || '(empty)')}</div>
        ${item.error ? `
          <div><span class="label">error</span></div>
          <div class="error-block">${highlightRedacts(item.error)}</div>
        ` : ''}
        <div style="display:flex;gap:14px;flex-wrap:wrap;color:var(--dim);font-size:10px;">
          <span>full ts: ${U.esc(item.ts || '')}</span>
          <span>from: ${U.esc(item.from_agent || '')}</span>
          <span>to: ${U.esc(item.to_agent || '')}</span>
          <span>payload_size: ${U.esc(String(item.payload_size != null ? item.payload_size : '-'))}</span>
        </div>
      </div>
    `;
  }

  // ---- banner (stale / fail / rate-limit) ----
  function setBanner(kind, msg) {
    if (!kind) {
      bannerHost.innerHTML = '';
      return;
    }
    const cls = kind === 'fail' || kind === 'rate-limit' ? kind : '';
    bannerHost.innerHTML = `<div class="notif-banner ${cls}">${U.esc(msg)}</div>`;
  }

  // ---- refresh ----
  async function refresh() {
    // A3: 暂停期内不发请求, 显示倒计时
    const now = Date.now();
    if (now < pausedUntil) {
      const remain = Math.ceil((pausedUntil - now) / 1000);
      setBanner('rate-limit', `轮询已暂停 (rate limit 触发) · ${remain}s 后自动恢复`);
      return;
    }
    // 持久化 filter 选择
    U.ssSet('notif_priority', fPri.value);
    U.ssSet('notif_channel', fChan.value);
    U.ssSet('notif_from', fFrom.value);
    U.ssSet('notif_since', fSince.value);
    U.ssSet('notif_limit', fLimit.value);

    const sinceSeconds = parseInt(fSince.value, 10) || 86400;
    const sinceISO = new Date(Date.now() - sinceSeconds * 1000).toISOString();
    const params = {};
    if (fPri.value) params.priority = fPri.value;
    if (fChan.value) params.channel = fChan.value;
    // from_agent: server 严白校验 (M3), 只在精确匹配 master.registry 时传; 这里我们传给 server, server 不匹配返空
    if (fFrom.value) params.from_agent = fFrom.value;
    params.since = sinceISO;
    params.limit = parseInt(fLimit.value, 10) || 100;

    let data;
    try {
      data = await A.notifyAudit(params);
      usingMock = false;
      srcLabel.textContent = 'real';
    } catch (e) {
      // mock data fallback (CEO command D2: 不依赖 pre endpoint, mock 期先测 UI)
      if (e.kind === 'http' && e.status === 404) {
        try {
          const r = await fetch('mocks/notify_audit_mock.json', { credentials: 'omit' });
          if (r.ok) {
            data = await r.json();
            usingMock = true;
            srcLabel.textContent = 'mock (endpoint 未 ready)';
          } else {
            throw new Error('mock load failed');
          }
        } catch (me) {
          handleFail(e, me);
          return;
        }
      } else if (e.kind === 'http' && e.status === 429) {
        // A3: 暂停 polling 60s
        pausedUntil = Date.now() + 60000;
        setBanner('rate-limit', '轮询过快已暂停 60s 后重试 (HTTP 429)');
        return;
      } else {
        handleFail(e);
        return;
      }
    }

    if (data) {
      lastSuccess = data;
      const itemsAll = data.items || [];
      const itemsFiltered = applyFrontendNarrow(itemsAll);
      renderList(itemsFiltered);
      // 真 endpoint 时检查 stale (master 可能在响应里给 stale 字段)
      if (data.stale === true) {
        setBanner('stale', `⚠ probe stale · 显示 cached, 30s 自动重试`);
      } else if (usingMock) {
        setBanner('stale', `⚠ 真 endpoint 暂未 ready (HTTP 404), 显示 mock data 测试期`);
      } else {
        setBanner(null);
      }
    }
  }

  function handleFail(e, e2) {
    const msg = e.kind === 'http' ? `HTTP ${e.status}` : (e.message || 'network');
    if (lastSuccess) {
      // 用 cache 渲染, 加 fail banner (per agent-security A3)
      setBanner('fail', `拉取失败 (${msg})${e2 ? ` + mock fallback 失败` : ''} · 显示 cached, 30s 自动重试`);
      const items = applyFrontendNarrow(lastSuccess.items || []);
      renderList(items);
    } else {
      setBanner('fail', `拉取失败: ${msg}${e2 ? ` (mock fallback 也失败: ${e2.message})` : ''}`);
      list.innerHTML = listHeaderHTML() + `<div class="dim p-12">无 cached data, 30s 自动重试</div>`;
    }
  }

  // ---- 事件绑定 ----
  refreshBtn.addEventListener('click', refresh);

  // filter change 触发立即 refresh
  let filterTimer = null;
  function debouncedRefresh() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(refresh, 200);
  }
  [fPri, fChan, fFrom, fSince, fLimit].forEach(el => {
    el.addEventListener('change', debouncedRefresh);
    if (el.tagName === 'INPUT') el.addEventListener('input', debouncedRefresh);
  });

    refresh();
    // 30s polling (user 反馈: 0 LLM cost 频率可以更高)
    pollStop = U.poll(refresh, 30000);

    return function unmount() {
      if (pollStop) pollStop();
      clearTimeout(filterTimer);
    };
  }

  // --- SPA registration ---
  window.preApp = window.preApp || {};
  window.preApp.notifications = { init };

  // --- Standalone fallback ---
  if (!document.getElementById('app-content')) {
    const host = document.getElementById('appbar-host');
    if (host) {
      host.innerHTML = C.appBar('notifications');
      C.startHealthBeacon();
    }
    init();
  }
})();

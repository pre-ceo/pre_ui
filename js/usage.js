// pre_ui — usage.html script
// GET /api/v1/usage 30s 轮询 (master 10min 才换, 但 30s 0 LLM cost / user 260501 反馈)
// 健壮性: lastSuccess cache 跨 refresh 保留, 空数据 / fail 时不清屏, 顶部 stale banner 提示
(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="usage-wrap">
      <div class="card">
        <h2>LLM cli usage <span id="probed-ts" class="dim" style="font-weight:normal;font-size:11px;">probed: -</span></h2>
        <div id="node-tabs" class="node-tabs"></div>
        <div id="usage-list" class="usage-list">
          <div class="dim p-12">loading...</div>
        </div>
        <div class="dim" style="font-size:10px;margin-top:10px;">
          master 每 10min 周期抓一次 (cli 内置 /usage|/quota|/status 命令, 0 LLM token 消耗).
          点击 raw 行展开看完整原始输出 (含 ANSI / box drawing).
        </div>
      </div>
    </div>`;

  function init(host) {
    if (host) host.innerHTML = TEMPLATE;

    const list = document.getElementById('usage-list');
    const probedTs = document.getElementById('probed-ts');
    const nodeTabsEl = document.getElementById('node-tabs');
    let currentNode = U.ssGet('usage_node', 'local');
    let knownNodes = ['local'];

    // healthier rendering: cache last non-empty render per (node) + last full top-level
    // 切 node 时清当前 node cache (用户主动行为, 不应混旧 node 数据)
    let lastSuccessByNode = {};   // { nodeId: nodeData }
    let lastTopLevel = null;       // 全 page 级 stale 信息 (age_sec / stale)

  function statusPill(status) {
    const s = (status || 'unknown').toLowerCase();
    // gemini parser 加新值: unknown / probe_inconclusive / status_bar_only / ok / limit_reached
    const COLOR = {
      'ok': 'cyan',
      'near_limit': 'yellow',
      'limit_reached': 'magenta',
      'error': 'magenta',
      'timeout': 'yellow',
      'unknown': 'dim',
      'probe_inconclusive': 'blue',
      'status_bar_only': 'yellow',
    };
    const TIPS = {
      'ok': '配额正常',
      'near_limit': '接近上限',
      'limit_reached': '配额耗尽, 已切 fallback model',
      'unknown': '探测未完成或无数据',
      'probe_inconclusive': '探测命令未输出可解析的配额数据',
      'status_bar_only': '仅看到 cli status bar (active model + 简短 %), 未获完整 quota 详情',
      'error': '探测出错',
      'timeout': '探测超时',
    };
    const cls = COLOR[s] || 'dim';
    const tip = TIPS[s] || s;
    return `<span class="pill ${cls}" title="${U.esc(tip)}">${U.esc(s)}</span>`;
  }

  // 进度条 (left=可用百分比, used=已用百分比). codex 给的是 'percent_left'.
  function progressBar(label, used, reset) {
    if (used == null) return '';
    const pct = Math.max(0, Math.min(100, Number(used)));
    const cls = pct >= 90 ? 'crit' : (pct >= 70 ? 'warn' : '');
    const resetHtml = reset ? `<span class="reset">resets ${U.esc(String(reset))}</span>` : '';
    return `<div class="usage-bar">
      <span class="label">${U.esc(label)}</span>
      <div class="track"><div class="fill ${cls}" style="width:${pct}%"></div></div>
      <span class="pct ${cls === 'crit' ? 'crit' : (cls === 'warn' ? 'warn' : '')}">${pct}% used</span>
      ${resetHtml}
    </div>`;
  }

  // 解析 claude raw_excerpt 抽 session/week %
  function extractClaudePercents(raw) {
    if (!raw) return {};
    const r = {};
    let m;
    // 'Current session ... 26% used' (raw 含 ANSI block, 用宽松正则跨行)
    m = raw.match(/Current session[\s\S]{0,200}?(\d{1,3})\s*%\s*used/);
    if (m) r.session_pct = parseInt(m[1], 10);
    m = raw.match(/Resets\s+([^\n(]+)/);
    if (m) r.session_reset = m[1].trim();
    // Current week (all models)
    m = raw.match(/Current week\s*\(all models\)[\s\S]{0,200}?(\d{1,3})\s*%\s*used/);
    if (m) r.week_pct = parseInt(m[1], 10);
    m = raw.match(/Current week[\s\S]{0,400}?Resets\s+([^\n(]+)/);
    if (m) r.week_reset = m[1].trim();
    return r;
  }

  function renderClaude(d) {
    const ext = extractClaudePercents(d.raw_excerpt || '');
    const bd = d.breakdown || {};
    const breakdownItems = [];
    if (bd.high_context_pct != null) breakdownItems.push(`<span class="k">high ctx:</span><span class="v">${bd.high_context_pct}%</span>`);
    if (bd.long_session_pct != null) breakdownItems.push(`<span class="k">long sess:</span><span class="v">${bd.long_session_pct}%</span>`);
    if (bd.parallel_session_pct != null) breakdownItems.push(`<span class="k">parallel:</span><span class="v">${bd.parallel_session_pct}%</span>`);
    const extraEnabled = d.extra_usage_enabled === true ? '<span class="k">extra:</span><span class="v">on</span>'
                       : d.extra_usage_enabled === false ? '<span class="k">extra:</span><span class="v" style="color:var(--dim);">off</span>'
                       : '';
    return `
      ${progressBar('session', ext.session_pct, ext.session_reset)}
      ${progressBar('week (all)', ext.week_pct, ext.week_reset)}
      <div class="meta">${breakdownItems.join('')}${extraEnabled}</div>
    `;
  }

  function renderGemini(d) {
    // 大改: gemini block 现含 models {flash, flash_lite, pro} 各自 percent_used / reset_at / reset_in
    //                models_limited[] 列出已耗尽的模型 (例 ["pro"])
    //                active_model + active_model_percent_used 仍保留 (兼容)
    const limited = d.models_limited || [];
    const models = d.models || {};
    const order = ['flash', 'flash_lite', 'pro'];
    const labels = { flash: 'Flash', flash_lite: 'Flash Lite', pro: 'Pro' };
    const bars = order.filter(k => models[k]).map(k => {
      const m = models[k];
      const used = m.percent_used != null ? Number(m.percent_used) : null;
      const isLimited = limited.indexOf(k) >= 0;
      const label = labels[k] + (isLimited ? ' ⚠' : '');
      const reset = m.reset_in ? `${m.reset_in}` : (m.reset_at || '');
      return progressBar(label, used, reset);
    }).join('');

    const meta = [];
    if (d.active_model) meta.push(`<span class="k">active:</span><span class="v">${U.esc(d.active_model)}</span>`);
    if (limited.length) meta.push(`<span class="k">limited:</span><span class="v crit">${U.esc(limited.join(', '))}</span>`);
    if (d.fallback_model) meta.push(`<span class="k">fallback:</span><span class="v">${U.esc(d.fallback_model)}</span>`);

    return `
      ${bars || progressBar('active', d.active_model_percent_used != null ? Number(d.active_model_percent_used) : null, d.reset_at)}
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
    `;
  }

  function renderCodex(d) {
    const meta = [];
    if (d.account) meta.push(`<span class="k">account:</span><span class="v">${U.esc(d.account)}</span>`);
    if (d.plan) meta.push(`<span class="k">plan:</span><span class="v">${U.esc(d.plan)}</span>`);
    if (d.model) meta.push(`<span class="k">model:</span><span class="v">${U.esc(d.model)}</span>`);
    // codex 给的是 percent_left, 转成 used = 100 - left
    const used5h = d.percent_left_5h != null ? 100 - Number(d.percent_left_5h) : null;
    const usedWeek = d.percent_left_week != null ? 100 - Number(d.percent_left_week) : null;
    return `
      ${progressBar('5h limit', used5h, d.reset_5h)}
      ${progressBar('weekly', usedWeek, d.reset_week)}
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
    `;
  }

  // 用 master 返的 stale + age_sec 字段; 兜底用 probed_ts 计算
  function isStale(d) {
    if (!d) return true;
    if (d.stale === true) return true;
    if (typeof d.age_sec === 'number' && d.age_sec > 1800) return true;  // 30 min
    return false;
  }
  function ageLabel(d) {
    if (!d) return '?';
    if (typeof d.age_sec === 'number') {
      const s = d.age_sec;
      if (s < 60) return Math.floor(s) + 's';
      if (s < 3600) return Math.floor(s / 60) + 'min';
      return Math.floor(s / 3600) + 'h';
    }
    if (d.probed_ts) return U.ago(d.probed_ts);
    return '?';
  }

  function rowHTML(provider, d) {
    let body = '';
    if (provider === 'claude') body = renderClaude(d);
    else if (provider === 'gemini') body = renderGemini(d);
    else if (provider === 'codex') body = renderCodex(d);
    else body = `<div class="dim">${U.esc(JSON.stringify(d))}</div>`;

    const raw = d.raw_excerpt || '';
    const stale = isStale(d);
    const staleTag = stale
      ? `<span class="pill yellow" title="该 provider age=${U.esc(ageLabel(d))}, 超过 30min 视为 stale">stale ${U.esc(ageLabel(d))}</span>`
      : '';
    return `
      <div class="usage-row ${stale ? 'usage-row-stale' : ''}" data-provider="${U.esc(provider)}">
        <div class="head">
          <span class="provider">${U.esc(provider)}</span>
          ${statusPill(d.status)}
          ${staleTag}
          <span class="grow"></span>
        </div>
        ${body}
        ${raw ? `<div class="usage-raw-toggle">raw_excerpt (${raw.length} 字)</div><pre class="usage-raw">${U.esc(raw)}</pre>` : ''}
      </div>`;
  }

  function render(data, opts) {
    opts = opts || {};
    const providers = ['claude', 'gemini', 'codex'];
    const present = providers.filter(p => data && data[p]);

    // 顶层 stale banner (master 重启或 probe 全失败)
    let bannerHtml = '';
    if (opts.bannerKind === 'stale') {
      bannerHtml = `<div class="usage-banner usage-banner-stale">
        ⚠ probe stale · 上次更新 ${U.esc(opts.bannerAge || '?')} 前 · 显示 cached, 30s 自动重试
      </div>`;
    } else if (opts.bannerKind === 'no-data') {
      bannerHtml = `<div class="usage-banner usage-banner-stale">
        ⚠ 此 node "${U.esc(currentNode)}" 暂无探测数据 · 探测中, 30s 自动重试
      </div>`;
    } else if (opts.bannerKind === 'fail') {
      bannerHtml = `<div class="usage-banner usage-banner-fail">
        ⚠ 拉取失败 (${U.esc(opts.bannerMsg || 'network')}) · 显示 cached, 30s 自动重试
      </div>`;
    }

    if (!present.length) {
      // 无可显示数据 — 仍渲染初始空提示, 但配 banner 让用户知道在重试
      list.innerHTML = bannerHtml + '<div class="dim p-12">探测中... (此 node 暂无数据)</div>';
      probedTs.textContent = data && data.probed_ts
        ? `probed: ${U.fmtTs(data.probed_ts, {full:true})} (${U.ago(data.probed_ts)})`
        : 'probed: -';
      return;
    }

    list.innerHTML = bannerHtml + present.map(p => rowHTML(p, data[p])).join('');
    list.querySelectorAll('.usage-raw-toggle').forEach(t => {
      t.addEventListener('click', () => {
        t.closest('.usage-row').classList.toggle('expanded');
      });
    });
    if (data.probed_ts) {
      const ageStr = typeof data.age_sec === 'number' ? ` · age ${ageLabel(data)}` : '';
      probedTs.textContent = `probed: ${U.fmtTs(data.probed_ts, {full:true})} (${U.ago(data.probed_ts)})${ageStr}`;
    }
  }

  function renderNodeTabs() {
    // 永远显示 tab (即使单节点)
    nodeTabsEl.innerHTML = knownNodes.map(n =>
      `<span class="node-tab ${n === currentNode ? 'active' : ''}" data-node="${U.esc(n)}">${U.esc(n)}</span>`
    ).join('');
    nodeTabsEl.querySelectorAll('.node-tab').forEach(el => {
      el.addEventListener('click', () => {
        const n = el.dataset.node;
        if (n === currentNode) return;
        currentNode = n;
        U.ssSet('usage_node', n);
        renderNodeTabs();
        refresh();
      });
    });
  }

  function hasData(d) {
    if (!d) return false;
    return ['claude', 'gemini', 'codex'].some(p => d[p]);
  }

  async function refresh() {
    let all;
    try {
      all = await A.usage();
    } catch (e) {
      // 拉取失败: 用 lastSuccess (如有) + fail banner; 否则空状态 + fail banner
      const cached = lastSuccessByNode[currentNode];
      const msg = e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'network');
      render(cached || {}, { bannerKind: 'fail', bannerMsg: msg });
      return;
    }
    lastTopLevel = all;

    // 更新 nodes_known
    const newKnown = all.nodes_known || ['local'];
    if (JSON.stringify(newKnown) !== JSON.stringify(knownNodes)) {
      knownNodes = newKnown;
      if (!knownNodes.includes(currentNode)) currentNode = knownNodes[0] || 'local';
      renderNodeTabs();
    }

    // 取当前 node 数据: by_node[currentNode] 优先, fallback 顶层 (向后兼容)
    let nodeData = (all.by_node && all.by_node[currentNode]) || all;
    if (currentNode !== 'local' && !(all.by_node && all.by_node[currentNode])) {
      try { nodeData = await A.usage(currentNode); } catch (_) { nodeData = null; }
    }

    if (hasData(nodeData)) {
      // 有数据 — 缓存 + 渲染. stale 字段决定是否加 banner
      lastSuccessByNode[currentNode] = nodeData;
      const opts = isStale(nodeData)
        ? { bannerKind: 'stale', bannerAge: ageLabel(nodeData) }
        : {};
      render(nodeData, opts);
    } else {
      // 此 node 当前空 — 用 cached, 否则显空状态
      const cached = lastSuccessByNode[currentNode];
      if (cached) {
        const ageOfCache = ageLabel(cached);
        render(cached, { bannerKind: 'stale', bannerAge: ageOfCache });
      } else {
        render({}, { bannerKind: 'no-data' });
      }
    }
  }

    refresh();
    // 30s 轮询 (user 260501 反馈: 0 LLM cost, 频率可以更高)
    const stopPoll = U.poll(refresh, 30000);

    return function unmount() { stopPoll(); };
  }

  // --- SPA registration ---
  window.preApp = window.preApp || {};
  window.preApp.usage = { init };

  // --- Standalone fallback ---
  if (!document.getElementById('app-content')) {
    const host = document.getElementById('appbar-host');
    if (host) {
      host.innerHTML = C.appBar('usage');
      C.startHealthBeacon();
    }
    init();
  }
})();

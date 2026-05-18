// pre_ui — audit.html script.
//
// 消费 master 统一 audit endpoint (见 pre/dev-workflow features/260518-audit-api-unified):
//   GET /api/v1/audit/kinds  — 拉 7 类 KIND 元 (kind / desc / fields / filters)
//   GET /api/v1/audit/list?kind=&since=<unix>&limit=&<filter>=...
//
// 设计要点:
//   - 7 个 kind tab (gover_review 后端未启用, 不展示)
//   - filter 控件按 KIND.filters 动态渲染: exact → select / substr → text input
//   - exact 下拉的可选值随数据累积 (后端不下发 enum), 首次启动时仅 "(all)"
//   - since dropdown (1h/6h/24h/7d/30d, 默 24h), limit input (默 200, clamp [1,500])
//   - truncated banner: 命中 limit 时顶部黄条
//   - URL 同步: #audit?kind=&since=&limit=&<filter>=... (history.replaceState, 不触 hashchange)
//   - 30s 轮询保活 (后端限频 1M/min, 0 cost)
//   - 安全约束: cwd 后端不下发, 此处也不留 column; 只渲染 KIND.fields 列, ts 第一列 + 倒序
(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="term-page">
      <div class="cli-row">
        <span class="pa">❯</span><span class="pt">pre audit</span><span class="m">--kind=</span><span class="b" id="audit-kind-label">-</span>
        <span class="grow"></span>
        <span class="m" id="audit-meta" style="font-size:11px;">-</span>
      </div>
      <div id="audit-kind-tabs" class="audit-kind-chips"></div>
      <div id="audit-kind-desc" class="audit-kind-desc">选 kind 看说明</div>
      <div id="audit-controls" class="if"></div>
      <div id="audit-banner"></div>
      <div id="audit-table-wrap"><div class="dim p-12">loading...</div></div>
      <pre class="term-hints"><span class="sh"># hints</span>
  <span class="m">·</span> since 强制 ≤30d / limit ≤500; <span class="m">cwd</span> 字段后端从不下发 (含 home path)
  <span class="m">·</span> exact filter 选项随数据累积; substr 350ms debounce 后重拉
  <span class="m">·</span> 切 kind 重置 filter (不再属于该 kind 的字段不携带); URL #hash 与 filter 同步</pre>
    </div>`;

  // 7 类 kind 的中文短名 + 长描述. backend desc 是英文且偏开发视角,
  // 前端这层翻译成 CEO 视角的中文 (短名进 chip, 长描述进下方 desc 行).
  const KIND_LABELS = {
    mobile:          { zh: '通知派发',     long: '对外通知派发: agent → 用户的 mobile 推送 / webhook / cli sendkeys 投递记录' },
    telemetry:       { zh: '节点遥测',     long: 'G11 各 node 周期上报状态, master 决定 accept / reject 的记录' },
    read_pane:       { zh: '读 pane',     long: '跨 agent 读对方 tmux 当前画面 (G9) 审计 · raw_disclosed=true 表示返回了未脱敏原文' },
    agent_data:     { zh: '读 transcript', long: 'transcript / file / sessions endpoint 的 read 审计 · 含返回字节数' },
    caller_class:    { zh: 'HTTP 鉴权',    long: '每个进 master HTTP 的请求按 (role, path, source IP) 三元分类的 audit · 安全 incident 首站' },
    mcp:             { zh: 'MCP 调用',     long: '各 agent 调 MCP 工具 (send_message / read_pane / fetch_inbox / ...) 记录 · args 只出 keys 不出 value' },
    driver_decision: { zh: 'driver 决策',   long: 'claude / codex / gemini PreToolUse hook 的 governor 判定 (allow / deny / ask) 记录' },
  };

  // since 选项 (秒). 后端 cap 30d, 这里上限即 30d.
  const SINCE_OPTS = [
    ['1h',  3600],
    ['6h',  6 * 3600],
    ['24h', 24 * 3600],
    ['7d',  7 * 24 * 3600],
    ['30d', 30 * 24 * 3600],
  ];

  // 数值字段: 不当字符串截断
  const NUM_FIELDS = new Set([
    'payload_size', 'bytes_returned', 'lines_returned', 'latency_ms',
    'redact_hits', 'row_id',
  ]);

  // 状态/决策类着色映射 (严禁红绿: ok→cyan, fail→magenta, pending/ask→yellow)
  function colorClassForVal(field, val) {
    const v = String(val == null ? '' : val).toLowerCase();
    if (field === 'decision') {
      if (v === 'allow' || v === 'ok' || v === 'sent') return 's';
      if (v === 'deny' || v === 'block' || v === 'reject') return 'e';
      if (v === 'ask' || v === 'warn') return 'w';
      return '';
    }
    if (field === 'status' || field === 'result_status' || field === 'action') {
      if (v === 'ok' || v === 'sent' || v === 'success' || v === 'allow') return 's';
      if (v === 'fail' || v === 'failed' || v === 'error' || v === 'deny' || v === 'block') return 'e';
      if (v === 'pending' || v === 'ask' || v === 'queued' || v === 'retry') return 'w';
      return '';
    }
    if (field === 'ok' || field === 'raw_disclosed') {
      // bool-ish
      if (v === 'true') return field === 'raw_disclosed' ? 'w' : 's';
      if (v === 'false') return field === 'raw_disclosed' ? 's' : 'e';
      return '';
    }
    if (field === 'priority') {
      if (v === 'critical') return 'e';
      if (v === 'high') return 'w';
      if (v === 'normal') return 's';
      return '';
    }
    return '';
  }

  function init(host) {
    if (host) host.innerHTML = TEMPLATE;

    let kinds = [];                  // /audit/kinds → kinds[]
    let activeKind = null;           // 当前 tab
    let activeFilters = {};          // {field: value}
    let sinceSec = 24 * 3600;        // 默 24h
    let limit = 200;
    const knownExact = {};           // {field: Set<string>} 累积 exact filter 见过的值
    let pollStop = null;
    let lastResp = null;

    // -- hash 读写 (router 只看 '?' 之前, 这里把 #audit?... 后段当 query) ----
    function parseHash() {
      const h = location.hash || '';
      const q = h.indexOf('?');
      if (q < 0) return {};
      const p = new URLSearchParams(h.substring(q + 1));
      const out = {};
      for (const [k, v] of p.entries()) out[k] = v;
      return out;
    }
    function writeHash() {
      if (!activeKind) return;
      const params = new URLSearchParams();
      params.set('kind', activeKind);
      params.set('since', String(sinceSec));
      params.set('limit', String(limit));
      for (const k in activeFilters) {
        if (activeFilters[k]) params.set(k, activeFilters[k]);
      }
      const newHash = '#audit?' + params.toString();
      if (location.hash !== newHash) {
        // replaceState 不触 hashchange, 不会让 router 重新 mount
        history.replaceState(null, '', location.pathname + location.search + newHash);
      }
    }

    const initState = parseHash();
    if (initState.kind) activeKind = initState.kind;
    if (initState.since) {
      const s = parseInt(initState.since, 10);
      if (!isNaN(s) && s > 0) sinceSec = s;
    }
    if (initState.limit) {
      const l = parseInt(initState.limit, 10);
      if (!isNaN(l) && l > 0) limit = Math.min(500, Math.max(1, l));
    }

    const kindTabsEl  = document.getElementById('audit-kind-tabs');
    const kindDescEl  = document.getElementById('audit-kind-desc');
    const controlsEl  = document.getElementById('audit-controls');
    const bannerEl    = document.getElementById('audit-banner');
    const tableWrapEl = document.getElementById('audit-table-wrap');
    const metaEl      = document.getElementById('audit-meta');
    const kindLabelEl = document.getElementById('audit-kind-label');

    function currentKindObj() {
      return kinds.find(k => k.kind === activeKind) || null;
    }

    // ---- 渲染: kind chips (双行: 英文 key + 中文短名; active = cyan border + 染色) ----
    // chips 下方常显当前 kind 的中文长描述, 避免用户得 hover 才知道选项含义.
    function renderKindTabs() {
      kindTabsEl.innerHTML = kinds.map(k => {
        const lbl = KIND_LABELS[k.kind] || { zh: '-', long: k.desc };
        const cls = k.kind === activeKind ? 'audit-kind-chip active' : 'audit-kind-chip';
        return `<button class="${cls}" data-kind="${U.esc(k.kind)}" title="${U.esc(k.desc)}">`
             + `<span class="kind-en">${U.esc(k.kind)}</span>`
             + `<span class="kind-zh">${U.esc(lbl.zh)}</span>`
             + `</button>`;
      }).join('');
      kindTabsEl.querySelectorAll('.audit-kind-chip').forEach(el => {
        el.addEventListener('click', () => {
          const k = el.dataset.kind;
          if (k === activeKind) return;
          activeKind = k;
          activeFilters = {};                 // 切 kind 重置 filter (不在新 kind 的字段不携带)
          if (kindLabelEl) kindLabelEl.textContent = k;
          renderKindTabs();
          renderKindDesc();
          renderControls();
          writeHash();
          refresh();
        });
      });
      if (kindLabelEl) kindLabelEl.textContent = activeKind || '-';
    }

    // ---- 渲染: 当前 kind 的中文长描述行 (常显, 不用 hover) ----
    function renderKindDesc() {
      if (!kindDescEl) return;
      const ko = currentKindObj();
      if (!ko) {
        kindDescEl.textContent = '选 kind 看说明';
        return;
      }
      const lbl = KIND_LABELS[ko.kind];
      const long = (lbl && lbl.long) || ko.desc;
      // 双语呈现: 中文长描述 + 末尾灰色英文 backend desc (开发者参照)
      kindDescEl.innerHTML = `<span class="desc-zh">${U.esc(long)}</span>`
        + ` <span class="desc-en m">· ${U.esc(ko.desc)}</span>`;
    }

    // ---- 渲染: filter / since / limit 控件 (整行重建; 仅在 kind 切换时调用) ----
    function renderControls() {
      const ko = currentKindObj();
      if (!ko) { controlsEl.innerHTML = ''; return; }
      const parts = [];
      const filters = ko.filters || {};
      for (const f of Object.keys(filters)) {
        const t = filters[f];
        if (t === 'exact') {
          const vals = Array.from(knownExact[f] || []).sort();
          const opts = ['<option value="">(all)</option>']
            .concat(vals.map(v =>
              `<option value="${U.esc(v)}" ${activeFilters[f] === v ? 'selected' : ''}>${U.esc(v)}</option>`
            )).join('');
          parts.push(
            `<span class="ctrl-lbl">${U.esc(f)}:</span>` +
            `<select data-filter-exact="${U.esc(f)}">${opts}</select>`
          );
        } else if (t === 'substr') {
          parts.push(
            `<span class="ctrl-lbl">${U.esc(f)}~</span>` +
            `<input type="text" data-filter-substr="${U.esc(f)}" value="${U.esc(activeFilters[f] || '')}" placeholder="substr" size="14">`
          );
        }
      }
      // since
      const sinceOpts = SINCE_OPTS.map(([lbl, sec]) =>
        `<option value="${sec}" ${sinceSec === sec ? 'selected' : ''}>${lbl}</option>`
      ).join('');
      parts.push(
        `<span class="ctrl-lbl">since:</span><select id="audit-since">${sinceOpts}</select>`
      );
      // limit
      parts.push(
        `<span class="ctrl-lbl">limit:</span>` +
        `<input id="audit-limit" type="number" min="1" max="500" value="${limit}" style="width:60px;">`
      );
      // reload
      parts.push(`<button class="ab" id="audit-reload" title="手动刷新 (轮询每 30s)">↻</button>`);

      controlsEl.innerHTML = parts.join(' ');

      controlsEl.querySelectorAll('[data-filter-exact]').forEach(el => {
        el.addEventListener('change', () => {
          const f = el.dataset.filterExact;
          if (el.value) activeFilters[f] = el.value;
          else delete activeFilters[f];
          writeHash();
          refresh();
        });
      });
      controlsEl.querySelectorAll('[data-filter-substr]').forEach(el => {
        let t = null;
        el.addEventListener('input', () => {
          const f = el.dataset.filterSubstr;
          if (el.value) activeFilters[f] = el.value;
          else delete activeFilters[f];
          clearTimeout(t);
          t = setTimeout(() => { writeHash(); refresh(); }, 350);
        });
      });
      const sinceSel = document.getElementById('audit-since');
      if (sinceSel) sinceSel.addEventListener('change', (e) => {
        sinceSec = parseInt(e.target.value, 10);
        writeHash(); refresh();
      });
      const limitInp = document.getElementById('audit-limit');
      if (limitInp) limitInp.addEventListener('change', (e) => {
        let v = parseInt(e.target.value, 10);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 500) v = 500;
        limit = v;
        e.target.value = String(v);
        writeHash(); refresh();
      });
      const rel = document.getElementById('audit-reload');
      if (rel) rel.addEventListener('click', refresh);
    }

    // exact filter 选项是后置累积的, 数据来了之后只更新 <select> options, 不重建整行,
    // 否则 substr <input> 会失焦. (renderControls 用户切 kind 时才整体重建.)
    function syncExactSelects() {
      const ko = currentKindObj();
      if (!ko) return;
      for (const f of Object.keys(ko.filters || {})) {
        if (ko.filters[f] !== 'exact') continue;
        const sel = controlsEl.querySelector(`select[data-filter-exact="${CSS.escape(f)}"]`);
        if (!sel) continue;
        const cur = activeFilters[f] || '';
        const vals = Array.from(knownExact[f] || []).sort();
        // 已经一致就跳过 (避免 dropdown 抖动)
        const have = Array.from(sel.options).slice(1).map(o => o.value);
        const same = have.length === vals.length && vals.every((v, i) => have[i] === v);
        if (same) continue;
        sel.innerHTML = ['<option value="">(all)</option>']
          .concat(vals.map(v =>
            `<option value="${U.esc(v)}" ${cur === v ? 'selected' : ''}>${U.esc(v)}</option>`
          )).join('');
        sel.value = cur;
      }
    }

    // ---- 渲染: 表格 ----
    function fmtCell(field, val) {
      if (val == null || val === '') return '<span class="m">·</span>';
      if (field === 'ts') {
        const local = U.fmtTs(val, { full: true });
        return `<span class="ts-cell m" title="${U.esc(val)}">${U.esc(local)}</span>`;
      }
      if (Array.isArray(val)) {
        if (!val.length) return '<span class="m">[]</span>';
        return `<span class="arr">[${val.map(v => U.esc(String(v))).join(', ')}]</span>`;
      }
      if (NUM_FIELDS.has(field)) {
        return `<span class="num">${U.esc(String(val))}</span>`;
      }
      const cls = colorClassForVal(field, val);
      const s = String(val);
      if (s.length > 80) {
        return `<span class="${cls}" title="${U.esc(s)}">${U.esc(s.substring(0, 77))}…</span>`;
      }
      return cls ? `<span class="${cls}">${U.esc(s)}</span>` : U.esc(s);
    }

    function accumulateExact(rows) {
      const ko = currentKindObj();
      if (!ko) return;
      for (const f of Object.keys(ko.filters || {})) {
        if (ko.filters[f] !== 'exact') continue;
        if (!knownExact[f]) knownExact[f] = new Set();
        for (const r of rows) {
          const v = r[f];
          if (v == null || v === '') continue;
          knownExact[f].add(String(v));
        }
      }
    }

    function renderTable(resp) {
      const ko = currentKindObj();
      if (!ko) return;
      const fields = ko.fields;
      const rows = (resp.audit || []).slice().sort((a, b) => {
        // ts 是 ISO 8601 string → 字典序就是时间序; 倒序: 新在上
        const ta = a.ts || '', tb = b.ts || '';
        if (ta < tb) return 1;
        if (ta > tb) return -1;
        return 0;
      });
      accumulateExact(rows);
      syncExactSelects();

      bannerEl.innerHTML = resp.truncated
        ? `<div class="usage-banner">⚠ 命中 limit (${U.esc(resp.limit)}) — 加 filter 或缩 since 看更多老数据</div>`
        : '';

      const sinceMs = (resp.since || 0) * 1000;
      metaEl.textContent = `total=${resp.total ?? rows.length}  limit=${resp.limit}  since=${new Date(sinceMs).toLocaleString('zh-CN', { hour12: false })}${resp.truncated ? '  [truncated]' : ''}`;

      if (!rows.length) {
        tableWrapEl.innerHTML = '<div class="dim p-12">(no entries — 调大 since 或换个 filter)</div>';
        return;
      }
      const head = `<tr>${fields.map(f => `<th>${U.esc(f)}</th>`).join('')}</tr>`;
      const body = rows.map(r =>
        `<tr>${fields.map(f => `<td data-f="${U.esc(f)}">${fmtCell(f, r[f])}</td>`).join('')}</tr>`
      ).join('');
      tableWrapEl.innerHTML = `<table class="tbl audit-tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    }

    async function refresh() {
      if (!activeKind) return;
      const sinceUnix = Math.floor(Date.now() / 1000) - sinceSec;
      const params = { kind: activeKind, since: sinceUnix, limit: limit };
      const ko = currentKindObj();
      if (ko) {
        // 只携带当前 kind 接受的 filter (防止上一个 kind 留下的 key 被后端静默忽略也避免 URL 混乱)
        for (const k of Object.keys(ko.filters || {})) {
          if (activeFilters[k]) params[k] = activeFilters[k];
        }
      }
      try {
        const r = await A.auditList(params);
        lastResp = r;
        renderTable(r);
      } catch (e) {
        const msg = e && e.kind === 'http'
          ? `HTTP ${e.status} ${(e.body && (e.body.error || e.body.message)) || ''}`
          : (e && e.message) || 'network';
        // 拉失败保留上次表格, 仅顶 banner 提示
        bannerEl.innerHTML = `<div class="usage-banner usage-banner-fail">⚠ 拉取失败: ${U.esc(msg)} · 30s 自动重试</div>`;
      }
    }

    async function bootstrap() {
      let r;
      try {
        r = await A.auditKinds();
      } catch (e) {
        const msg = e && e.kind === 'http' ? `HTTP ${e.status}` : (e && e.message) || 'network';
        tableWrapEl.innerHTML = `<div class="ebox" style="margin:8px;">无法拉 /audit/kinds: ${U.esc(msg)} — 检查 master 是否在 19500</div>`;
        return;
      }
      kinds = r.kinds || [];
      if (!kinds.length) {
        tableWrapEl.innerHTML = '<div class="ebox" style="margin:8px;">/audit/kinds 返回空, 后端未启用 audit endpoint?</div>';
        return;
      }
      if (!activeKind || !kinds.find(k => k.kind === activeKind)) {
        activeKind = kinds[0].kind;
      }
      // 把 hash 里仅匹配当前 kind 的 filter 加进 activeFilters
      const ko = currentKindObj();
      if (ko) {
        for (const f of Object.keys(ko.filters || {})) {
          if (initState[f]) activeFilters[f] = initState[f];
        }
      }
      renderKindTabs();
      renderKindDesc();
      renderControls();
      writeHash();
      await refresh();
      // 30s 轮询 (后端限频 1M/min, 0 LLM cost; 跟 usage 同节奏)
      pollStop = U.poll(refresh, 30000);
    }

    bootstrap();
    return function unmount() {
      if (pollStop) pollStop();
    };
  }

  // --- SPA registration ---
  window.preApp = window.preApp || {};
  window.preApp.audit = { init };

  // --- Standalone fallback (访问 audit.html 直接入口时) ---
  if (!document.getElementById('app-content')) {
    const host = document.getElementById('appbar-host');
    if (host) {
      host.innerHTML = C.appBar('audit');
      C.startHealthBeacon();
    }
    init();
  }
})();

// pre_ui shared fetch — same-origin via 5174 self-proxy ().
//
// 设计:
//   - 浏览器源 = http://127.0.0.1:5174 (scripts/fe_server.py 起的静态+反代 server)
//   - fetch 走相对路径 './api/v1/...' 与 './healthz' (同 origin, 浏览器无 CORS)
//   - fe_server.py 内部 urllib 反代到 http://127.0.0.1:19500
//   - 浏览器无 preflight; fetch 用正常 Authorization Bearer + application/json POST
//
// must_have #8 回归合规 (deviation 已 resolved):
//   所有调用走相对路径, 不再硬编码 19500.
//
// Bearer token: localStorage 'pre_master_token' (CLAUDE.md #5: single-user
// single-machine admin GUI 走 localStorage, 跨重启免重输. 截屏防护仍走
// type=password + autocomplete=off + 掩码).
// 旧 sessionStorage 历史值: 启动时一次性迁移 → localStorage, 然后清掉.

(function (global) {
  'use strict';

  const TOKEN_KEY = 'master_token';
  const DEFAULT_TOKEN = 'pre';

  // One-shot migration: 老用户 sessionStorage 里有 token, 搬到 localStorage 后清掉
  if (global.preUtils) {
    const ls = global.preUtils.lsGet(TOKEN_KEY, null);
    const ss = global.preUtils.ssGet(TOKEN_KEY, null);
    if (ls == null && ss != null) {
      global.preUtils.lsSet(TOKEN_KEY, ss);
      global.preUtils.ssDel(TOKEN_KEY);
    } else if (ss != null) {
      // localStorage 已有值, 清掉冗余的 sessionStorage
      global.preUtils.ssDel(TOKEN_KEY);
    }
  }

  // Magic-link 一次性激活: pre 端 start_master.py / pre_token.py rotate 输出
  //   http://127.0.0.1:5174/index.html#token=<raw>&next=/path
  // token 走 URL fragment 不进 server log; 这里解析 → setToken → 清 hash 防 bookmark/
  // history/转发泄露 → 跳 next. next 仅接受 '/' 开头的相对 path 或 '#' 开头的 hash,
  // 防 javascript:/data: scheme 注入.
  try {
    const hash = global.location.hash || '';
    if (hash.indexOf('token=') >= 0) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const tok = params.get('token');
      const next = params.get('next') || '/';
      if (tok && global.preUtils) {
        global.preUtils.lsSet(TOKEN_KEY, tok);
        try {
          global.history.replaceState(null, '', global.location.pathname + global.location.search);
        } catch (_) {}
        // 跳 next: '#' 开头 → hash 路由; '/' 开头 → 相对 path; 其余忽略 (防 scheme 注入)
        if (next && next !== '/') {
          if (next.charAt(0) === '#') {
            global.location.hash = next;
          } else if (next.charAt(0) === '/') {
            global.location.replace(next);
          }
        }
        // toast 推到 DOMContentLoaded 后 — fetch.js IIFE 时 body 可能还没 ready
        const showToast = () => global.preUtils.toast('token 已自动保存 (magic link)', 'ok');
        if (global.document && global.document.body) {
          setTimeout(showToast, 0);
        } else {
          global.document.addEventListener('DOMContentLoaded', showToast, { once: true });
        }
      }
    }
  } catch (e) {
    console.warn('[fetch] magic-link parse failed:', e);
  }

  function getToken() {
    return (global.preUtils ? global.preUtils.lsGet(TOKEN_KEY, DEFAULT_TOKEN) : DEFAULT_TOKEN);
  }
  function setToken(v) {
    if (global.preUtils) global.preUtils.lsSet(TOKEN_KEY, v || DEFAULT_TOKEN);
  }
  function clearToken() {
    if (global.preUtils) global.preUtils.lsDel(TOKEN_KEY);
  }

  function authHeaders(extra) {
    const h = Object.assign({}, extra || {});
    h['Authorization'] = 'Bearer ' + getToken();
    return h;
  }

  function apiUrl(path) {
    const p = path.startsWith('/') ? path.substring(1) : path;
    return './api/v1/' + p;
  }
  function healthUrl() {
    return './healthz';
  }

  // qs object → query string (with leading ?)
  function _qs(obj) {
    if (!obj) return '';
    const parts = [];
    for (const k in obj) {
      if (obj[k] === undefined || obj[k] === null || obj[k] === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  async function _do(method, url, body) {
    let resp;
    try {
      resp = await fetch(url, {
        method,
        headers: authHeaders(body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit',
      });
    } catch (e) {
      throw { kind: 'network', message: String(e && e.message || e) };
    }
    let text = '';
    try { text = await resp.text(); } catch (_) {}
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
    }
    if (resp.status === 401) {
      const utils = global.preUtils;
      if (utils) utils.toast('401: Bearer token 不正确, 跳设置页', 'err');
      throw { kind: 'http', status: 401, body: parsed };
    }
    if (!resp.ok) {
      throw { kind: 'http', status: resp.status, body: parsed };
    }
    return parsed;
  }

  const api = {
    // Phase A 端点 (4 个):
    healthz: () => _do('GET', healthUrl()),
    nodes:   () => _do('GET', apiUrl('nodes')),
    agents:  () => _do('GET', apiUrl('agents')),
    send: (agentId, body) =>
      _do('POST', apiUrl('agents/' + encodeURIComponent(agentId) + '/send'), body),

    // Phase B/C 接入时复活:
    messages: (params) => _do('GET', apiUrl('messages') + _qs(params)),
    pending:  () => _do('GET', apiUrl('pending')),
    findings: (params) => _do('GET', apiUrl('findings') + _qs(params)),
    agentMessages: (agentId, params) =>
      _do('GET', apiUrl('agents/' + encodeURIComponent(agentId) + '/messages') + _qs(params)),
    agentPending: (agentId) =>
      _do('GET', apiUrl('agents/' + encodeURIComponent(agentId) + '/pending')),
    decide: (agentId, body) =>
      _do('POST', apiUrl('agents/' + encodeURIComponent(agentId) + '/decide'), body),
    rediscover: (nodeId) =>
      _do('POST', apiUrl('nodes/' + encodeURIComponent(nodeId) + '/rediscover')),

    // dispatches:
    dispatches: (params) => _do('GET', apiUrl('dispatches') + _qs(params)),
    dispatch: (dispatchId) => _do('GET', apiUrl('dispatches/' + encodeURIComponent(dispatchId))),
    // task 文档系统
    dispatchTimeline: (dispatchId) =>
      _do('GET', apiUrl('dispatches/' + encodeURIComponent(dispatchId) + '/timeline')),
    dispatchExport: (dispatchId) =>
      _do('POST', apiUrl('dispatches/' + encodeURIComponent(dispatchId) + '/export'), {}),
    dispatchMarkdown: (dispatchId) =>
      _do('GET', apiUrl('dispatches/' + encodeURIComponent(dispatchId) + '/markdown')),

    // mini_task: 单 user-prompt → agent stop 一个 cycle
    agentMiniTasks: (agentId, params) =>
      _do('GET', apiUrl('agents/' + encodeURIComponent(agentId) + '/mini-tasks') + _qs(params || {})),
    miniTask: (miniTaskId) =>
      _do('GET', apiUrl('mini-tasks/' + encodeURIComponent(miniTaskId))),
    miniTasks: (params) =>
      _do('GET', apiUrl('mini-tasks') + _qs(params || {})),

    // : notify audit (mobile_audit.jsonl 暴露层)
    // params: {priority, channel, from_agent, since (ISO), limit (≤500)}
    // M1 不传 to_agent (server 端 hardcoded VIRTUAL_AGENTS)
    notifyAudit: (params) =>
      _do('GET', apiUrl('notify/audit') + _qs(params || {})),

    // 统一 audit 视图 (7 类 jsonl): mobile / telemetry / read_pane / agent_data /
    //   caller_class / mcp / driver_decision. 见 pre dev-workflow features/260518-audit-api-unified
    // /audit/kinds 返 KIND 元表 (无 IO), 给前端 tab + filter 动态渲染用
    auditKinds: () => _do('GET', apiUrl('audit/kinds')),
    // /audit/list?kind=&since=<unix>&limit=<1..500>&<filter>=...
    // 后端 since 强制 ≥ now-30d, limit clamp [1,500]; 字段白名单 + redact 二次脱敏
    auditList: (params) => _do('GET', apiUrl('audit/list') + _qs(params || {})),

    // 260429.X proposals (supervised stop → gemini 出 N 方案 → user 选/跳)
    chooseProposal: (agentId, proposalId) =>
      _do('POST', apiUrl('agents/' + encodeURIComponent(agentId) + '/choose-proposal'),
          { proposal_id: proposalId, by_agent: 'user.default' }),
    // dismiss 默认 mute=true (清当前 + 停未来生成); 可显式传 mute=false 仅跳一次
    dismissProposals: (agentId, mute) =>
      _do('POST', apiUrl('agents/' + encodeURIComponent(agentId) + '/dismiss-proposals'),
          mute === false ? { mute: false } : {}),
    // enable: 解除 mute, agent 下次 stop 时重新生成 proposals
    enableProposals: (agentId) =>
      _do('POST', apiUrl('agents/' + encodeURIComponent(agentId) + '/enable-proposals'), {}),

    // LLM cli usage 查询 (claude/gemini/codex), master 10min 周期抓
    // 加 by_node 多节点支持: usage(node) 传 node_id 过滤
    usage: (node) => _do('GET', apiUrl('usage') + (node ? '?node=' + encodeURIComponent(node) : '')),

    // prehook decisions: 该 agent 最近 N 条 pre_tool_use 评价 (decision/reason/source)
    agentPrehookDecisions: (agentId, limit) =>
      _do('GET', apiUrl('agents/' + encodeURIComponent(agentId) + '/prehook-decisions') + (limit ? '?limit=' + limit : '')),

    // chat timeline: agent transcript JSONL — 三模式 (since=forward / before=backward / tail=N)
    //   ?since=<byte>&limit=  增量正向 (live)
    //   ?before=<byte>&limit= 反向分页 (滚到顶加载更早)
    //   ?tail=<n>            最末 N 条 (initial load 默认走这个)
    //   ?session=<uuid>      切到非当前 session 文件 (跨 /clear)
    // resp: messages / next_since / prev_before / eof / total_size / transcript_id / reset_signal
    agentTranscript: (agentId, params) =>
      _do('GET', apiUrl('agents/' + encodeURIComponent(agentId) + '/transcript') + _qs(params || {})),

    // SSE ticket: EventSource 不支持 Authorization header, 用一次性 ticket (TTL 8min, 可复用)
    //   POST /api/v1/auth/sse-ticket {agent_id}
    //   resp: {ticket, ttl, agent_id}; 429 too_many_active_tickets / 401 invalid token
    sseTicket: (agentId) =>
      _do('POST', apiUrl('auth/sse-ticket'), { agent_id: agentId }),
    // 构造 transcript SSE URL (相对路径 — 仍走 fe_server.py 反代 → master 19500)
    transcriptStreamUrl: (agentId, ticket, tail) =>
      apiUrl('agents/' + encodeURIComponent(agentId) + '/transcript/stream') +
      _qs({ ticket, tail: tail || 100 }),

    // session 列表: 一个 agent 历史所有 session jsonl (含已 /clear 的)
    // resp: {agent_id, sessions: [{session_id, size, mtime, first_ts, is_current}]} mtime 倒序
    agentSessions: (agentId) =>
      _do('GET', apiUrl('agents/' + encodeURIComponent(agentId) + '/sessions')),

    // markdown preview: 读 agent.cwd 下白名单后缀文件 (.md / .markdown / .txt)
    // path 必须是 cwd 下相对路径; size cap 1MB
    agentFile: (agentId, relPath) =>
      _do('GET', apiUrl('agents/' + encodeURIComponent(agentId) + '/file') + _qs({ path: relPath })),

    // Auth helpers
    getToken, setToken, clearToken,
    apiUrl, healthUrl,
  };

  global.preApi = api;
})(window);

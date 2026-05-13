// pre_ui — chat module (consumes /api/v1/agents/{id}/transcript + /file + /sessions).
//
// 数据源 (master 端):
//   - latest session: SSE push (/transcript/stream + /auth/sse-ticket) — 主路径
//     backfill 一次性 tail N 条 + 后续 message 事件单条 push, 不再轮询
//   - SSE 不可用 (master 未升级 / 429 ticket / 401): 退化到 HTTP /transcript 三模式 polling
//   - 历史 session (dropdown 选了 non-latest): 一次性 HTTP tail, 不 poll 不 SSE (frozen)
//   - 向上翻页 (滚到顶 → before=byte): 永远走 HTTP /transcript (SSE 不管 backward)
// resp 字段 (HTTP):
//   - prev_before / next_since: 双向 cursor
//   - transcript_id "<inode>:<ctime>" — session 文件指纹, 变化 → 全 reset
//   - reset_signal: bool — since > total_size 时 true (文件被截或换了 session)
//
// session dropdown: 顶端右侧, 列出 agent 历史所有 jsonl, 切到非 latest 看历史会话.
//
// 设计原则:
//   - chat-pane DOM 持久 (agents.js 5s 轮询不推倒); 自身 5s 增量 poll
//   - 同一 assistant turn 多 tool_use 归一 bubble
//   - tool_result 通过 tool_use_id 反向查 collapsed card
//   - .md/.markdown/.txt 路径渲染为 .md-link → preview pane
//   - 严禁红绿: error tool_result / decide pending → magenta
//   - markdown 走 preCmp.mdRender (DOMPurify) — XSS 硬约束

(function (global) {
  'use strict';
  const U = global.preUtils, A = global.preApi, C = global.preCmp;

  let inst = null;
  // inst shape:
  //   chatHost / msgsHost / inputEl / sendBtn / sendHint / sessionSelect / titleControls
  //   previewHost
  //   agentId / agentState / isVirtual
  //   sessionId            current session uuid (null = 'latest', server default)
  //   oldest               byte cursor for backward; null = unknown / history begin
  //   latest               byte cursor for forward (was 'since')
  //   transcriptId         file fingerprint; mismatch → reset
  //   loadingOlder         lock for backward fetch
  //   inflight             lock for forward poll
  //   stopPoll             handle from U.poll (polling mode only)
  //   toolMap / bubbleByUuid / pending: same as before
  //   scrollHandler        for cleanup
  //   streamMode           'sse' | 'poll' | null
  //   transcriptStream     EventSource (SSE mode)
  //   streamBackoff        ms, exp backoff on reconnect (reset on ready event)
  //   streamRetryTimer     setTimeout handle for pending reconnect
  //   anchorFetched        bool — already lazy-fetched prev_before for SSE backfill

  function attach(opts) {
    detach();
    inst = {
      chatHost: opts.chatHost,
      msgsHost: null,
      inputEl: null, sendBtn: null, sendHint: null,
      sessionSelect: null, titleControls: opts.titleControls || null,
      previewHost: opts.previewHost || null,
      agentId: null, agentState: null, isVirtual: false,
      sessionId: null,
      oldest: null,
      latest: 0,
      transcriptId: null,
      loadingOlder: false,
      inflight: false,
      stopPoll: null,
      toolMap: new Map(),
      bubbleByUuid: new Map(),
      pending: [],
      scrollHandler: null,
      scrollDebounce: null,
      streamMode: null,
      transcriptStream: null,
      streamBackoff: 1000,
      streamRetryTimer: null,
      anchorFetched: false,
    };
    inst.chatHost.addEventListener('click', onChatClick);
    if (inst.previewHost) inst.previewHost.addEventListener('click', onPreviewClick);
    return { setAgent, setSendEnabled, setDecidePrompt, setSession, detach };
  }

  function detach() {
    if (!inst) return;
    if (inst.stopPoll) inst.stopPoll();
    closeTranscriptStream();
    if (inst.scrollDebounce) clearTimeout(inst.scrollDebounce);
    if (inst.msgsHost && inst.scrollHandler) {
      inst.msgsHost.removeEventListener('scroll', inst.scrollHandler);
    }
    for (const pb of inst.pending || []) if (pb.timeoutHandle) clearTimeout(pb.timeoutHandle);
    inst.chatHost.removeEventListener('click', onChatClick);
    if (inst.previewHost) inst.previewHost.removeEventListener('click', onPreviewClick);
    inst = null;
  }

  // setAgent(agentId, meta?: {state, isVirtual}): 切 agent → 重建结构 + start feed.
  // feed = SSE 优先 (latest session push), 失败回退到 tailLoad + 5s polling.
  function setAgent(agentId, meta) {
    if (!inst) return;
    if (inst.stopPoll) { inst.stopPoll(); inst.stopPoll = null; }
    closeTranscriptStream();
    if (inst.scrollDebounce) { clearTimeout(inst.scrollDebounce); inst.scrollDebounce = null; }
    for (const pb of inst.pending) if (pb.timeoutHandle) clearTimeout(pb.timeoutHandle);
    inst.pending = [];
    inst.agentId = agentId;
    inst.agentState = (meta && meta.state) || null;
    inst.isVirtual = !!(meta && meta.isVirtual);
    inst.sessionId = null;
    resetTranscriptCursors();

    inst.chatHost.innerHTML = `
      <div class="chat-messages">
        <div class="chat-empty"><span class="sp">⡇</span> Loading transcript…</div>
      </div>
      <div class="chat-input-row">
        <textarea class="chat-input" rows="1" placeholder="${U.esc('发送给 ' + (agentId || ''))}…"></textarea>
        <span class="chat-input-hint dim"></span>
        <button class="ab p chat-send-btn" type="button" disabled>Send</button>
      </div>`;
    inst.msgsHost = inst.chatHost.querySelector('.chat-messages');
    inst.inputEl = inst.chatHost.querySelector('.chat-input');
    inst.sendBtn = inst.chatHost.querySelector('.chat-send-btn');
    inst.sendHint = inst.chatHost.querySelector('.chat-input-hint');

    bindInputRow();
    bindScroll();
    applySendEnable();

    if (inst.previewHost) {
      inst.previewHost.innerHTML = '';
      inst.previewHost.classList.add('hidden');
    }
    if (inst.titleControls) inst.titleControls.innerHTML = '';

    fetchAndPopulateSessions();
    startFeed(agentId, null /* latest */);
  }

  // setSession(uuid|null): null = 'latest' (server default).
  // 加锁 + latest-pending 队列: 来回快点击不会发出多份 in-flight 请求 (避免 429).
  async function setSession(uuid) {
    if (!inst) return;
    const target = uuid || null;
    if (inst.sessionSwitching) {
      // 当前还在切, 仅保留最新目标; 现在 in-flight 完会自动追赶
      inst.pendingSessionTarget = target;
      return;
    }
    if (inst.sessionId === target) return;
    inst.sessionSwitching = true;
    try {
      let goTarget = target;
      while (true) {
        await doSwitchSession(goTarget);
        if (!inst) return;
        // 追赶 pending: 如果切换过程中 user 又选了别的, 现在补一次
        if (inst.pendingSessionTarget !== undefined &&
            inst.pendingSessionTarget !== inst.sessionId) {
          goTarget = inst.pendingSessionTarget;
          inst.pendingSessionTarget = undefined;
          continue;
        }
        inst.pendingSessionTarget = undefined;
        break;
      }
    } finally {
      if (inst) inst.sessionSwitching = false;
    }
  }

  async function doSwitchSession(target) {
    if (!inst) return;
    if (inst.sessionId === target) return;
    if (inst.stopPoll) { inst.stopPoll(); inst.stopPoll = null; }
    closeTranscriptStream();
    inst.sessionId = target;
    inst.chatHost.classList.add('fading');
    await new Promise(r => setTimeout(r, 250));
    if (!inst) return;
    resetTranscriptCursors();
    if (inst.msgsHost) inst.msgsHost.innerHTML =
      '<div class="chat-empty"><span class="sp">⡇</span> Loading session…</div>';
    if (inst.previewHost) {
      inst.previewHost.innerHTML = '';
      inst.previewHost.classList.add('hidden');
    }
    inst.chatHost.classList.remove('fading');
    await startFeed(inst.agentId, target);
  }

  function resetTranscriptCursors() {
    if (!inst) return;
    inst.oldest = null;
    inst.latest = 0;
    inst.transcriptId = null;
    inst.toolMap.clear();
    inst.bubbleByUuid.clear();
    inst.loadingOlder = false;
    inst.inflight = false;
    inst.streamMode = null;
    inst.streamBackoff = 1000;
    inst.anchorFetched = false;
  }

  // ---- feed orchestration ----
  // startFeed: latest session 走 SSE (失败回退 poll); 历史 session 一次性 tail, frozen.
  async function startFeed(agentId, sessionId) {
    if (!inst || inst.agentId !== agentId) return;
    if (sessionId === null) {
      // latest → SSE 优先
      try {
        await attachTranscriptStream(agentId);
        return;   // backfill 事件接管后续渲染
      } catch (e) {
        if (!inst || inst.agentId !== agentId || inst.sessionId !== sessionId) return;
        // SSE 不可用 (master 未升级 / 429 / 401) — 退化 polling
        console.warn('[chat] SSE attach failed, falling back to polling:', e);
        inst.streamMode = 'poll';
      }
    }
    // 历史 session OR SSE fallback → HTTP tail
    await tailLoad();
    if (!inst || inst.agentId !== agentId || inst.sessionId !== sessionId) return;
    if (sessionId === null) {
      // SSE 失败的 latest → 5s poll 兜底
      if (inst.rateLimitedUntil && Date.now() < inst.rateLimitedUntil) return;
      if (!inst.stopPoll) inst.stopPoll = U.poll(forwardPump, 5000);
    }
    // 历史 session: 不 poll 不 SSE (frozen file, master 不再写)
  }

  // attachTranscriptStream: 拿 ticket → EventSource → 处理 backfill/ready/message/session_change/lagged/error.
  // 不绑 sessionId; SSE 只服务 latest session, session_change 由 server 通过事件通知.
  async function attachTranscriptStream(agentId) {
    if (!inst || inst.agentId !== agentId) {
      throw { kind: 'cancel' };
    }
    const tk = await A.sseTicket(agentId);   // 抛 {kind:'http',status:...} 上层 fallback
    if (!inst || inst.agentId !== agentId) {
      throw { kind: 'cancel' };
    }
    if (!tk || !tk.ticket) throw { kind: 'http', status: 0, body: 'no ticket in response' };

    const url = A.transcriptStreamUrl(agentId, tk.ticket, 100);
    const es = new EventSource(url);
    inst.transcriptStream = es;
    inst.streamMode = 'sse';

    es.addEventListener('backfill', (evt) => {
      if (!inst || inst.transcriptStream !== es) return;
      let data;
      try { data = JSON.parse(evt.data); } catch (_) { return; }
      const newTid = data.transcript_id || null;
      // SSE 重连 (网络抖动 / idle close): 同 transcript_id 且已有渲染过的 bubble →
      // 走 renderAppend 增量 (UUID dedup 跳过已有), 不清屏不丢滚动位置.
      // 否则 (首次连接 / session 切换 / 缺 transcript_id) → 全量替换.
      const isReconnect = inst.transcriptId && newTid && newTid === inst.transcriptId
        && inst.msgsHost && inst.msgsHost.querySelector('.chat-msg');
      if (isReconnect) {
        renderAppend(data.messages || []);
        if (typeof data.next_since === 'number') inst.latest = data.next_since;
        autoScroll();
        return;
      }
      // backfill 不带 prev_before — oldest 留 null, loadOlder 滚到顶时 lazy 拉锚点
      inst.anchorFetched = false;
      renderReplaceAll(
        data.messages || [],
        newTid,
        null,   // prevBefore unknown
        typeof data.next_since === 'number' ? data.next_since : 0,
        { skipHistoryBegin: true }
      );
    });

    es.addEventListener('ready', () => {
      if (!inst || inst.transcriptStream !== es) return;
      inst.streamBackoff = 1000;   // 重置 backoff
    });

    es.addEventListener('message', (evt) => {
      if (!inst || inst.transcriptStream !== es) return;
      let data;
      try { data = JSON.parse(evt.data); } catch (_) { return; }
      if (!data || !data.msg) return;
      // 移除可能存在的 "transcript 为空" 占位
      if (inst.msgsHost) {
        const empty = inst.msgsHost.querySelector('.chat-empty');
        if (empty && empty.classList.contains('dim')) empty.remove();
      }
      renderAppend([data.msg]);   // 反向匹配 pending bubble — sending → sent
      if (typeof data.offset === 'number') inst.latest = data.offset;
      autoScroll();
    });

    es.addEventListener('session_change', (evt) => {
      if (!inst || inst.transcriptStream !== es) return;
      let data;
      try { data = JSON.parse(evt.data); } catch (_) { data = {}; }
      // 清当前 chat, 重连拿新 backfill (server 也可能 same-stream 续 backfill, 重连最稳)
      if (inst.msgsHost) inst.msgsHost.innerHTML =
        '<div class="chat-empty"><span class="sp">⡇</span> session 切换, 重连…</div>';
      inst.toolMap.clear();
      inst.bubbleByUuid.clear();
      inst.oldest = null;
      inst.latest = 0;
      inst.transcriptId = data.transcript_id || null;
      inst.anchorFetched = false;
      fetchAndPopulateSessions();   // dropdown 可能新增 session
      reattachStreamLater(agentId, 200);
    });

    es.addEventListener('lagged', () => {
      if (!inst || inst.transcriptStream !== es) return;
      // 慢消费被踢; offset 已不可信 — 关 + 重连拿新 backfill
      reattachStreamLater(agentId, 1000);
    });

    es.onerror = () => {
      if (!inst || inst.transcriptStream !== es) return;
      // 浏览器 EventSource 自动重连会用同 url (同 ticket) — TTL 内 OK, 但 master 重启后 ticket 失效.
      // 我们主动 close + backoff + 拿新 ticket 重连.
      const backoff = Math.min(inst.streamBackoff || 1000, 30000);
      inst.streamBackoff = Math.min(backoff * 2, 30000);
      reattachStreamLater(agentId, backoff);
    };
  }

  function reattachStreamLater(agentId, delayMs) {
    if (!inst) return;
    closeTranscriptStream();
    inst.streamRetryTimer = setTimeout(() => {
      if (!inst || inst.agentId !== agentId || inst.sessionId !== null) return;
      attachTranscriptStream(agentId).catch((e) => {
        if (!inst || inst.agentId !== agentId || inst.sessionId !== null) return;
        // 多次失败 — 退化到 polling 兜底
        console.warn('[chat] SSE reattach failed, falling back to polling:', e);
        inst.streamMode = 'poll';
        if (!inst.stopPoll && (!inst.rateLimitedUntil || Date.now() >= inst.rateLimitedUntil)) {
          inst.stopPoll = U.poll(forwardPump, 5000);
        }
      });
    }, delayMs);
  }

  function closeTranscriptStream() {
    if (!inst) return;
    if (inst.streamRetryTimer) {
      clearTimeout(inst.streamRetryTimer);
      inst.streamRetryTimer = null;
    }
    if (inst.transcriptStream) {
      try { inst.transcriptStream.close(); } catch (_) {}
      inst.transcriptStream = null;
    }
  }

  // renderReplaceAll: tailLoad 和 SSE backfill 共用 — 清 host + 渲染全部 messages + 设 cursor.
  function renderReplaceAll(messages, transcriptId, prevBefore, nextSince, opts) {
    if (!inst || !inst.msgsHost) return;
    inst.transcriptId = transcriptId || null;
    inst.oldest = (typeof prevBefore === 'number') ? prevBefore : null;
    inst.latest = (typeof nextSince === 'number') ? nextSince : 0;
    inst.toolMap.clear();
    inst.bubbleByUuid.clear();
    inst.msgsHost.innerHTML = '';
    if (inst.oldest === null && !(opts && opts.skipHistoryBegin)) {
      showHistoryBeginAtTop();
    }
    if (messages && messages.length) {
      renderAppend(messages);
    } else {
      inst.msgsHost.innerHTML =
        '<div class="chat-empty dim">transcript 为空 (agent 还没产生消息)</div>';
    }
    autoScrollForce();
  }

  function setSendEnabled(enabled, reason) {
    if (!inst) return;
    inst.sendForcedEnable = enabled;
    inst.sendForcedReason = reason || '';
    applySendEnable();
  }

  // ---- session dropdown ----
  async function fetchAndPopulateSessions() {
    if (!inst || !inst.agentId) return;
    if (!inst.titleControls) return;
    const myAgent = inst.agentId;
    inst.titleControls.innerHTML =
      '<select class="input chat-session-select" id="chat-session-select" disabled>' +
      '<option>loading…</option></select>';
    let r;
    try { r = await A.agentSessions(myAgent); }
    catch (e) {
      if (!inst || inst.agentId !== myAgent) return;
      inst.titleControls.innerHTML =
        '<span class="dim" style="font-size:10px;">sessions: ' +
        U.esc(e && e.kind === 'http' ? 'HTTP ' + e.status : 'err') + '</span>';
      return;
    }
    if (!inst || inst.agentId !== myAgent) return;
    const sessions = (r && r.sessions) || [];
    const opts = ['<option value="">latest</option>'];
    for (const s of sessions) {
      if (s.is_current === true) continue;        // covered by 'latest'
      const sid = s.session_id || '';
      const ago = s.mtime ? U.ago(s.mtime * 1000) : '?';
      const label = sid.slice(0, 8) + ' · ' + ago;
      opts.push('<option value="' + U.esc(sid) + '">' + U.esc(label) + '</option>');
    }
    inst.titleControls.innerHTML =
      '<select class="input chat-session-select" id="chat-session-select" title="切换到历史 session">' +
      opts.join('') + '</select>';
    inst.sessionSelect = inst.titleControls.querySelector('select');
    if (inst.sessionId) {
      const found = Array.from(inst.sessionSelect.options).find(o => o.value === inst.sessionId);
      if (found) inst.sessionSelect.value = inst.sessionId;
    }
    inst.sessionSelect.addEventListener('change', () => {
      setSession(inst.sessionSelect.value || null);
    });
  }

  // ---- 三模式 fetch ----
  async function tailLoad() {
    if (!inst || !inst.agentId) return;
    const myAgent = inst.agentId, mySession = inst.sessionId;
    const params = { tail: 50 };
    if (mySession) params.session = mySession;
    let resp;
    try { resp = await A.agentTranscript(myAgent, params); }
    catch (e) {
      if (!inst || inst.agentId !== myAgent || inst.sessionId !== mySession) return;
      handleFetchError(e);
      return;
    }
    if (!inst || inst.agentId !== myAgent || inst.sessionId !== mySession) return;
    renderReplaceAll(
      resp.messages || [],
      resp.transcript_id || null,
      typeof resp.prev_before === 'number' ? resp.prev_before : null,
      typeof resp.next_since === 'number' ? resp.next_since : 0
    );
  }

  async function forwardPump() {
    if (!inst || !inst.agentId) return;
    if (inst.inflight || inst.loadingOlder) return;
    inst.inflight = true;
    const myAgent = inst.agentId, mySession = inst.sessionId;
    const params = { since: inst.latest, limit: 200 };
    if (mySession) params.session = mySession;
    let resp;
    try { resp = await A.agentTranscript(myAgent, params); }
    catch (e) {
      inst.inflight = false;
      if (!inst || inst.agentId !== myAgent || inst.sessionId !== mySession) return;
      handleFetchError(e);
      return;
    }
    inst.inflight = false;
    if (!inst || inst.agentId !== myAgent || inst.sessionId !== mySession) return;
    // reset_signal (since > total_size 文件被截) 或 transcript_id 变 (新 session) → 全 reset
    if (resp.reset_signal === true ||
        (inst.transcriptId && resp.transcript_id && resp.transcript_id !== inst.transcriptId)) {
      if (inst.stopPoll) { inst.stopPoll(); inst.stopPoll = null; }
      resetTranscriptCursors();
      if (inst.msgsHost) inst.msgsHost.innerHTML =
        '<div class="chat-empty dim"><span class="sp">⡇</span> session 发生变化, 重新加载…</div>';
      await tailLoad();
      if (!inst || inst.agentId !== myAgent) return;
      inst.stopPoll = U.poll(forwardPump, 5000);
      // dropdown 可能 stale (新 session 已加入), 重拉一次
      fetchAndPopulateSessions();
      return;
    }
    inst.transcriptId = resp.transcript_id || inst.transcriptId;
    const msgs = resp.messages || [];
    if (msgs.length) renderAppend(msgs);
    inst.latest = (typeof resp.next_since === 'number') ? resp.next_since : inst.latest;
    autoScroll();
  }

  async function loadOlder() {
    if (!inst || !inst.agentId) return;
    if (inst.loadingOlder) return;
    // SSE backfill 不带 prev_before; 用户首次滚到顶, lazy 拉一次 HTTP /transcript?tail=N 拿锚点
    if (inst.oldest == null && inst.streamMode === 'sse' && !inst.anchorFetched) {
      inst.anchorFetched = true;
      try {
        const r = await A.agentTranscript(inst.agentId, { tail: 100 });
        if (!inst) return;
        if (typeof r.prev_before === 'number') inst.oldest = r.prev_before;
      } catch (_) { /* ignore — keep oldest null, show history-begin */ }
      if (inst.oldest == null) {
        showHistoryBeginAtTop();   // 真的到底了
        return;
      }
    }
    if (inst.oldest == null) return;
    inst.loadingOlder = true;
    const myAgent = inst.agentId, mySession = inst.sessionId;

    const spinner = document.createElement('div');
    spinner.className = 'chat-loading-older';
    spinner.innerHTML = '<span class="sp">⡇</span> 加载更早消息…';
    if (inst.msgsHost) inst.msgsHost.insertBefore(spinner, inst.msgsHost.firstChild);

    const params = { before: inst.oldest, limit: 50 };
    if (mySession) params.session = mySession;
    let resp;
    try { resp = await A.agentTranscript(myAgent, params); }
    catch (e) {
      spinner.remove();
      inst.loadingOlder = false;
      if (typeof U.toast === 'function') U.toast('load older failed', 'err');
      return;
    }
    spinner.remove();
    if (!inst || inst.agentId !== myAgent || inst.sessionId !== mySession) {
      inst.loadingOlder = false;
      return;
    }
    if (inst.transcriptId && resp.transcript_id &&
        resp.transcript_id !== inst.transcriptId) {
      // file changed under us, abandon — forwardPump 会触发 reset
      inst.loadingOlder = false;
      return;
    }
    // preserve scroll position: 测 prepend 前后 scrollHeight, 修正 scrollTop
    const beforeHeight = inst.msgsHost.scrollHeight;
    const beforeScrollTop = inst.msgsHost.scrollTop;
    renderPrepend(resp.messages || []);
    const afterHeight = inst.msgsHost.scrollHeight;
    inst.msgsHost.scrollTop = beforeScrollTop + (afterHeight - beforeHeight);

    inst.oldest = (typeof resp.prev_before === 'number') ? resp.prev_before : null;
    if (inst.oldest === null) showHistoryBeginAtTop();
    inst.loadingOlder = false;
  }

  function bindScroll() {
    if (!inst || !inst.msgsHost) return;
    inst.scrollHandler = () => {
      if (!inst || !inst.msgsHost) return;
      if (inst.loadingOlder) return;
      if (inst.oldest == null) return;
      if (inst.msgsHost.scrollTop > 100) return;
      if (inst.scrollDebounce) return;
      inst.scrollDebounce = setTimeout(() => {
        inst.scrollDebounce = null;
        if (inst) loadOlder();
      }, 500);
    };
    inst.msgsHost.addEventListener('scroll', inst.scrollHandler, { passive: true });
  }

  function showHistoryBeginAtTop() {
    if (!inst || !inst.msgsHost) return;
    if (inst.msgsHost.querySelector('.chat-history-begin')) return;
    const el = document.createElement('div');
    el.className = 'chat-history-begin';
    el.textContent = '── history begin ──';
    inst.msgsHost.insertBefore(el, inst.msgsHost.firstChild);
  }

  function handleFetchError(e) {
    const wasFresh = inst.latest === 0;
    const target = inst.msgsHost || inst.chatHost;
    if (e && e.kind === 'http' && e.status === 404) {
      if (wasFresh && target) target.innerHTML =
        '<div class="chat-empty dim">no transcript (agent 还没触发过 PreToolUse hook)</div>';
    } else if (e && e.kind === 'http' && e.status === 502) {
      if (wasFresh && target) target.innerHTML =
        '<div class="chat-empty err">远端 node transcript 暂不支持 (Phase 1 仅 local agent)</div>';
      if (inst.stopPoll) { inst.stopPoll(); inst.stopPoll = null; }
    } else if (e && e.kind === 'http' && e.status === 429) {
      // master 30/min 限频共享 read_pane 安全栈; 来回切 session 容易撞.
      // 暂停 poll 直到 retry_after, 倒计时到再重新 poll. 不改 cursor, 不清 chat.
      const retry = (e.body && typeof e.body.retry_after === 'number') ? e.body.retry_after : 60;
      const until = Date.now() + retry * 1000;
      inst.rateLimitedUntil = until;
      if (inst.stopPoll) { inst.stopPoll(); inst.stopPoll = null; }
      if (typeof U.toast === 'function') U.toast('transcript 429 限频, ' + retry + 's 后自动恢复', 'warn');
      // 倒计时到了重启 poll
      setTimeout(() => {
        if (!inst) return;
        if (inst.rateLimitedUntil && Date.now() >= inst.rateLimitedUntil) {
          inst.rateLimitedUntil = 0;
          if (!inst.stopPoll) inst.stopPoll = U.poll(forwardPump, 5000);
        }
      }, retry * 1000 + 200);
      // 在 chat 顶 (or empty placeholder 处) 标记一行
      if (wasFresh && target) target.innerHTML =
        '<div class="chat-empty dim">transcript 429 (' + retry + 's 后自动恢复)</div>';
    } else if (e && e.kind === 'http') {
      if (wasFresh && target) target.innerHTML =
        '<div class="chat-empty err">transcript HTTP ' + e.status + '</div>';
    } else {
      if (wasFresh && target) target.innerHTML =
        '<div class="chat-empty err">transcript 拉取失败: ' + U.esc((e && e.message) || 'network') + '</div>';
    }
  }

  // ---- 渲染: 追加 / 前置 ----
  function renderAppend(messages) {
    for (const msg of messages) {
      // dedup: SSE 重连后 backfill 会重发已渲染 msg; 也兜底 polling overlap.
      // tool_result-only msg 没 bubble 但 UUID 仍记成 null 占位, 防 applyToolResult 重复 orphan.
      if (msg.uuid && inst.bubbleByUuid.has(msg.uuid)) continue;
      const role = (msg.role === 'user' || msg.role === 'assistant') ? msg.role : 'system';
      const parts = msg.parts || [];

      const renderableParts = [];
      for (const p of parts) {
        if (p && p.kind === 'tool_result') {
          applyToolResult(p);
        } else if (p && (p.kind === 'text' || p.kind === 'tool_use')) {
          renderableParts.push(p);
        }
      }
      if (!renderableParts.length) {
        if (msg.uuid) inst.bubbleByUuid.set(msg.uuid, null);
        continue;
      }

      // optimistic pending bubble 反向匹配
      if (role === 'user' && inst.pending && inst.pending.length) {
        const allText = renderableParts.every(p => p.kind === 'text');
        if (allText) {
          const incomingText = renderableParts.map(p => p.text || '').join('').trim();
          const idx = inst.pending.findIndex(pb => {
            const pt = (pb.text || '').trim();
            return pt && (incomingText === pt || incomingText.includes(pt));
          });
          if (idx >= 0) {
            const pb = inst.pending[idx];
            if (pb.timeoutHandle) clearTimeout(pb.timeoutHandle);
            const real = buildBubble(msg, role, renderableParts);
            if (pb.el && pb.el.isConnected) pb.el.replaceWith(real);
            else inst.msgsHost.appendChild(real);
            inst.pending.splice(idx, 1);
            if (msg.uuid) inst.bubbleByUuid.set(msg.uuid, real);
            continue;
          }
        }
      }

      const bubble = buildBubble(msg, role, renderableParts);
      // decide-prompt 总是钉在末尾, 新消息要插在它之前
      const decideEl = inst.msgsHost.querySelector('.chat-msg.decide-prompt');
      if (decideEl) inst.msgsHost.insertBefore(bubble, decideEl);
      else inst.msgsHost.appendChild(bubble);
      if (msg.uuid) inst.bubbleByUuid.set(msg.uuid, bubble);
    }
  }

  function renderPrepend(messages) {
    if (!inst || !inst.msgsHost) return;
    const frag = document.createDocumentFragment();
    for (const msg of messages) {
      if (msg.uuid && inst.bubbleByUuid.has(msg.uuid)) continue;
      const role = (msg.role === 'user' || msg.role === 'assistant') ? msg.role : 'system';
      const parts = msg.parts || [];
      const renderableParts = [];
      for (const p of parts) {
        if (p && p.kind === 'tool_result') {
          applyToolResult(p);   // backward 加载的 tool_result 仍 attempt 反查
        } else if (p && (p.kind === 'text' || p.kind === 'tool_use')) {
          renderableParts.push(p);
        }
      }
      if (!renderableParts.length) {
        if (msg.uuid) inst.bubbleByUuid.set(msg.uuid, null);
        continue;
      }
      const bubble = buildBubble(msg, role, renderableParts);
      frag.appendChild(bubble);
      if (msg.uuid) inst.bubbleByUuid.set(msg.uuid, bubble);
    }
    // 插在 history-begin (如果有) 之后, 其余消息之前
    const begin = inst.msgsHost.querySelector('.chat-history-begin');
    if (begin && begin.nextSibling) {
      inst.msgsHost.insertBefore(frag, begin.nextSibling);
    } else if (begin) {
      inst.msgsHost.appendChild(frag);
    } else {
      inst.msgsHost.insertBefore(frag, inst.msgsHost.firstChild);
    }
  }

  function buildBubble(msg, role, parts) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg ' + role;
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    meta.textContent = role + ' · ' + (msg.ts ? U.fmtTs(msg.ts) : '');
    bubble.appendChild(meta);
    const body = document.createElement('div');
    body.className = 'chat-body';
    for (const p of parts) {
      if (p.kind === 'text') renderTextInto(body, p.text || '');
      else if (p.kind === 'tool_use') renderToolUseInto(body, p);
    }
    bubble.appendChild(body);
    return bubble;
  }

  function renderTextInto(host, text) {
    const wrap = document.createElement('div');
    wrap.className = 'md-body';
    wrap.innerHTML = C.mdRender(text);
    walkAndLinkifyMd(wrap);
    host.appendChild(wrap);
  }

  function renderToolUseInto(host, p) {
    const id = p.tool_use_id || ('tu-' + Math.random().toString(36).slice(2));
    const name = p.name || '?';
    const input = p.input || {};
    const argPreview = previewArgs(name, input);

    const card = document.createElement('div');
    card.className = 'tool-call';
    card.dataset.toolId = id;

    const head = document.createElement('div');
    head.className = 'tool-head';
    head.innerHTML = `
      <span class="tool-dot c-cyan">⏺</span>
      <span class="tool-name">${U.esc(name)}</span>
      <span class="tool-arg"></span>
      <span class="tool-status">pending</span>
      <span class="tool-toggle">▶</span>`;
    fillArgPreview(head.querySelector('.tool-arg'), name, input, argPreview);
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'tool-body';
    body.innerHTML = `
      <div class="tool-section-label">input</div>
      <pre class="tool-input">${U.esc(JSON.stringify(input, null, 2))}</pre>
      <div class="tool-section-label">output</div>
      <pre class="tool-output pending">(awaiting tool_result…)</pre>`;
    card.appendChild(body);

    host.appendChild(card);
    inst.toolMap.set(id, card);
  }

  function applyToolResult(p) {
    const id = p.tool_use_id;
    const card = id ? inst.toolMap.get(id) : null;
    const text = p.text || '';
    if (card) {
      const out = card.querySelector('.tool-output');
      const status = card.querySelector('.tool-status');
      if (out) {
        out.classList.remove('pending');
        out.textContent = text || '(empty)';
        if (p.is_error) {
          out.classList.add('error');
          card.classList.add('error');
          if (status) status.textContent = 'error';
        } else if (status) {
          status.textContent = 'ok';
        }
      }
      return;
    }
    // orphan: tool_use 不在当前已加载窗口 (例如 backward 还没 prepend 到那一段)
    const orphan = document.createElement('div');
    orphan.className = 'tool-call' + (p.is_error ? ' error expanded' : ' expanded');
    orphan.innerHTML = `
      <div class="tool-head">
        <span class="tool-dot c-magenta">⏺</span>
        <span class="tool-name">tool_result</span>
        <span class="tool-arg dim">orphan (id=${U.esc(String(id || '?'))})</span>
        <span class="tool-status">${p.is_error ? 'error' : 'ok'}</span>
        <span class="tool-toggle">▼</span>
      </div>
      <div class="tool-body">
        <pre class="tool-output ${p.is_error ? 'error' : ''}">${U.esc(text || '(empty)')}</pre>
      </div>`;
    if (inst.msgsHost) inst.msgsHost.appendChild(orphan);
  }

  function previewArgs(name, input) {
    if (!input) return '';
    if (name === 'Bash') return (input.command || '').slice(0, 80);
    if (name === 'Read' || name === 'Write' || name === 'Edit') return input.file_path || '';
    if (name === 'Grep' || name === 'Glob') return input.pattern || input.path || '';
    if (name === 'Agent') return input.description || '';
    const keys = Object.keys(input).slice(0, 2);
    return keys.map(k => k + '=' + JSON.stringify(input[k]).slice(0, 30)).join(' ');
  }

  function fillArgPreview(el, name, input, preview) {
    if ((name === 'Read' || name === 'Write' || name === 'Edit') && input && input.file_path) {
      const fp = input.file_path;
      if (isMdLikePath(fp)) {
        const a = document.createElement('a');
        a.className = 'md-link'; a.dataset.path = fp; a.href = '#'; a.textContent = fp;
        el.appendChild(a);
        return;
      }
    }
    el.textContent = preview;
  }

  // ---- markdown link extraction ----
  const MD_PATH_RE = /(?:^|[\s(\[<])([\w./\-_~]*\/?[\w.\-_~]+\.(?:md|markdown|txt))\b/gi;
  function isMdLikePath(p) { return /\.(md|markdown|txt)$/i.test(p || ''); }

  function walkAndLinkifyMd(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest('a, code, pre')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) {
      if (MD_PATH_RE.test(n.textContent)) targets.push(n);
      MD_PATH_RE.lastIndex = 0;
    }
    for (const node of targets) {
      MD_PATH_RE.lastIndex = 0;
      const text = node.textContent;
      const frag = document.createDocumentFragment();
      let lastEnd = 0, m;
      while ((m = MD_PATH_RE.exec(text)) !== null) {
        const path = m[1];
        const pathStart = m.index + m[0].indexOf(path);
        const pathEnd = pathStart + path.length;
        if (pathStart > lastEnd) frag.appendChild(document.createTextNode(text.slice(lastEnd, pathStart)));
        const a = document.createElement('a');
        a.className = 'md-link'; a.dataset.path = path; a.href = '#'; a.textContent = path;
        frag.appendChild(a);
        lastEnd = pathEnd;
      }
      if (lastEnd < text.length) frag.appendChild(document.createTextNode(text.slice(lastEnd)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  // ---- click delegation ----
  function onChatClick(e) {
    const link = e.target.closest('.md-link');
    if (link) { e.preventDefault(); e.stopPropagation(); openPreview(link.dataset.path); return; }
    const head = e.target.closest('.tool-head');
    if (head) {
      const card = head.closest('.tool-call');
      if (card) card.classList.toggle('expanded');
      const tog = head.querySelector('.tool-toggle');
      if (tog) tog.textContent = card.classList.contains('expanded') ? '▼' : '▶';
    }
  }
  function onPreviewClick(e) {
    const close = e.target.closest('.preview-close');
    if (close) { e.preventDefault(); hidePreview(); return; }
    const link = e.target.closest('.md-link');
    if (link) { e.preventDefault(); openPreview(link.dataset.path); }
  }

  // ---- preview pane ----
  async function openPreview(relPath) {
    if (!inst || !inst.previewHost || !inst.agentId) return;
    const host = inst.previewHost;
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="preview-header">
        <span class="preview-path">${U.esc(relPath)}</span>
        <span class="dim">loading…</span>
        <button class="ab preview-close" type="button">close</button>
      </div>
      <div class="preview-body md-body"><div class="dim"><span class="sp">⡇</span> reading…</div></div>`;
    try {
      const r = await A.agentFile(inst.agentId, relPath);
      const sizeStr = (r && typeof r.size === 'number') ? (r.size + ' B') : '';
      const content = (r && typeof r.content === 'string') ? r.content : '';
      const isMd = isMdLikePath(relPath) && !/\.txt$/i.test(relPath);
      const bodyHtml = isMd ? C.mdRender(content) : '<pre>' + U.esc(content) + '</pre>';
      host.innerHTML = `
        <div class="preview-header">
          <span class="preview-path" title="${U.esc(r.path || relPath)}">${U.esc(r.path || relPath)}</span>
          <span class="dim">${U.esc(sizeStr)}</span>
          <button class="ab preview-close" type="button">close</button>
        </div>
        <div class="preview-body md-body"></div>`;
      const body = host.querySelector('.preview-body');
      body.innerHTML = bodyHtml;
      walkAndLinkifyMd(body);
    } catch (e) {
      const msg = e && e.kind === 'http'
        ? 'HTTP ' + e.status + ': ' + (typeof e.body === 'string' ? e.body : JSON.stringify(e.body || {}))
        : ((e && e.message) || 'network');
      host.innerHTML = `
        <div class="preview-header">
          <span class="preview-path">${U.esc(relPath)}</span>
          <button class="ab preview-close" type="button">close</button>
        </div>
        <div class="preview-body"><div class="ebox">${U.esc(msg)}</div></div>`;
    }
  }
  function hidePreview() {
    if (!inst || !inst.previewHost) return;
    inst.previewHost.classList.add('hidden');
    inst.previewHost.innerHTML = '';
  }

  // ---- auto-scroll ----
  // 用户滚到中间时不要把它拉下去 (autoScroll); 首次进入 / 用户主动发送 → 强制 (autoScrollForce).
  function autoScroll() {
    if (!inst || !inst.msgsHost) return;
    const el = inst.msgsHost;
    const nearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }
  function autoScrollForce() {
    if (!inst || !inst.msgsHost) return;
    // 等下一帧布局完, 否则 scrollHeight 可能还没含新插入的高度
    requestAnimationFrame(() => {
      if (!inst || !inst.msgsHost) return;
      inst.msgsHost.scrollTop = inst.msgsHost.scrollHeight;
    });
  }

  // ---- input row: bind / enable / send ----
  function bindInputRow() {
    if (!inst || !inst.inputEl || !inst.sendBtn) return;
    inst.inputEl.addEventListener('input', () => applySendEnable());
    inst.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
    inst.sendBtn.addEventListener('click', onSend);
  }

  function applySendEnable() {
    if (!inst || !inst.inputEl || !inst.sendBtn) return;
    let enabled, reason = '';
    if (typeof inst.sendForcedEnable === 'boolean') {
      enabled = inst.sendForcedEnable;
      reason = inst.sendForcedReason || '';
    } else if (!inst.agentId) { enabled = false; reason = '未选中 agent'; }
    else if (inst.isVirtual)  { enabled = false; reason = 'virtual agent 只接收'; }
    else if (inst.agentState === 'offline') { enabled = false; reason = 'agent offline'; }
    else { enabled = true; }
    inst.inputEl.disabled = !enabled;
    inst.sendBtn.disabled = !enabled || !(inst.inputEl.value || '').trim();
    if (inst.sendHint) inst.sendHint.textContent = enabled ? '' : reason;
  }

  async function onSend() {
    if (!inst || !inst.agentId || !inst.inputEl) return;
    if (inst.inputEl.disabled) return;
    const text = (inst.inputEl.value || '').trim();
    if (!text) return;
    const agentForSend = inst.agentId;

    const pendBubble = document.createElement('div');
    pendBubble.className = 'chat-msg user pending';
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const sentTs = Date.now();
    meta.textContent = 'user · ' + U.fmtTs(sentTs) + ' · sending…';
    pendBubble.appendChild(meta);
    const body = document.createElement('div');
    body.className = 'chat-body';
    body.textContent = text;
    pendBubble.appendChild(body);
    if (inst.msgsHost) {
      const placeholder = inst.msgsHost.querySelector('.chat-empty');
      if (placeholder) placeholder.remove();
      const decideEl = inst.msgsHost.querySelector('.chat-msg.decide-prompt');
      if (decideEl) inst.msgsHost.insertBefore(pendBubble, decideEl);
      else inst.msgsHost.appendChild(pendBubble);
    }
    const pb = { el: pendBubble, text, sentTs, timeoutHandle: null };
    pb.timeoutHandle = setTimeout(() => markTimeout(pb), 30000);
    inst.pending.push(pb);
    autoScrollForce();

    const inputEl = inst.inputEl;
    const sendBtn = inst.sendBtn;
    const origValue = inputEl.value;
    const origBtnHtml = sendBtn.innerHTML;
    inputEl.disabled = true;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="sp">⡇</span>';

    try {
      await A.send(agentForSend, {
        kind: 'chat',
        from_agent: 'user.default',
        payload: { text, from_agent: 'user.default', priority: 'normal' },
      });
      if (inst && inst.agentId === agentForSend) inputEl.value = '';
    } catch (e) {
      if (pb.timeoutHandle) clearTimeout(pb.timeoutHandle);
      const idx = inst ? inst.pending.indexOf(pb) : -1;
      if (idx >= 0) inst.pending.splice(idx, 1);
      if (pb.el && pb.el.isConnected) pb.el.remove();
      const msg = e && e.kind === 'http'
        ? 'HTTP ' + e.status + (e.body ? ': ' + (typeof e.body === 'string' ? e.body : JSON.stringify(e.body)).slice(0, 80) : '')
        : ((e && e.message) || 'network');
      if (typeof U.toast === 'function') U.toast('send failed: ' + msg, 'err');
      if (inst && inst.agentId === agentForSend) inputEl.value = origValue;
    } finally {
      if (inst && inst.sendBtn === sendBtn) {
        sendBtn.innerHTML = origBtnHtml;
        applySendEnable();
        if (inst.inputEl === inputEl) inputEl.focus();
      }
    }
  }

  function markTimeout(pb) {
    if (!inst || !pb || !pb.el || !pb.el.isConnected) return;
    pb.el.classList.add('timeout');
    const meta = pb.el.querySelector('.chat-meta');
    if (meta) meta.textContent = 'user · ' + U.fmtTs(pb.sentTs) + ' · agent 未响应 (>30s, 仍在等)';
  }

  // ---- decide prompt (blocked_user, inline 在 chat-messages 末尾) ----
  function setDecidePrompt(prompt) {
    if (!inst || !inst.msgsHost) return;
    const existing = inst.msgsHost.querySelector('.chat-msg.decide-prompt');
    if (!prompt) { if (existing) existing.remove(); return; }
    const el = existing || document.createElement('div');
    el.className = 'chat-msg system decide-prompt';
    const desc = (prompt.description || '').replace(/\n{3,}/g, '\n\n').trim();
    const pd = prompt.prehookDecision;
    el.innerHTML = `
      <div class="chat-meta">⚠ pending decision · ${U.esc(prompt.toolKind || 'tool')}</div>
      <div class="chat-body">
        ${desc ? `<pre class="decide-pending-desc">${U.esc(desc)}</pre>` : ''}
        ${pd ? `<div class="prehook-inline">
            <span class="pill ${pd.decision === 'allow' ? 'cyan' : pd.decision === 'deny' ? 'magenta' : 'yellow'}">${U.esc(pd.decision || '?')}</span>
            <span class="prehook-reason">${U.esc(pd.reason || '(no reason)')}</span>
            ${pd.source ? `<span class="prehook-source">${U.esc(pd.source)}</span>` : ''}
          </div>` : ''}
        <div class="decide-bar-inline">
          <button class="ab p" data-key="1" title="单次允许此工具调用">Yes [1]</button>
          <button class="ab"   data-key="2" title="永久白名单 — 慎用" style="border-color:var(--yellow);color:var(--yellow);">Always [2]</button>
          <button class="ab"   data-key="3" title="拒绝此调用">No [3]</button>
          <button class="ab"   data-key="Escape" title="取消整个工具调用">Cancel [Esc]</button>
        </div>
      </div>`;
    el.querySelectorAll('button[data-key]').forEach(btn => {
      btn.onclick = async () => {
        if (typeof prompt.onDecide !== 'function') return;
        const all = el.querySelectorAll('button[data-key]');
        all.forEach(b => b.disabled = true);
        try { await prompt.onDecide(btn.dataset.key); }
        catch (_) { all.forEach(b => b.disabled = false); }
      };
    });
    if (!existing) {
      inst.msgsHost.appendChild(el);
      autoScroll();
    }
  }

  global.preChat = {
    attach, detach,
    setAgent, setSession, setSendEnabled, setDecidePrompt,
  };
})(window);

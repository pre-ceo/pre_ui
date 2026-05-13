// pre_ui — pending tab (SPA hash #pending; 不在 tab-bar, 仅 hash 直链)
// Phase B 范畴, Phase A 不主动暴露; 历史保留, 由 /v3 期间所写.

(function () {
  'use strict';
  const U = window.preUtils, A = window.preApi, C = window.preCmp;

  const TEMPLATE = `
    <div class="pending-layout">
      <div class="p-list" id="p-list"><div class="dim p-12">loading...</div></div>
      <div class="p-detail" id="p-detail">
        <div class="card dim">选中左侧 pending 查看详情, 用 1/2/3 直接 decide</div>
      </div>
    </div>`;

  function init(host) {
    if (host) host.innerHTML = TEMPLATE;

    let items = [];
    let selectedIdx = -1;
    let focusedOpt = 0;

    function norm(p) {
      const agent_id = p.agent_id || p.agent || '';
      const key = p.key || p.decision_key || p.id || '';
      const title = p.title || p.kind || p.question || 'pending decision';
      const prompt = p.prompt || (p.payload && p.payload.text) || p.text || '';
      let options = p.options || (p.payload && p.payload.options) || [];
      options = options.map((o, i) => {
        if (typeof o === 'string') return { key: o, label: o, body: '' };
        return {
          key: o.key || o.value || o.id || String(i + 1),
          label: o.label || o.title || o.key || '',
          body: o.body || o.text || o.detail || '',
        };
      });
      return { raw: p, agent_id, key, title, prompt, options, ts: p.ts };
    }

    async function refresh() {
      try {
        const r = await A.pending();
        const arr = (r && (r.pending || r.items)) || (Array.isArray(r) ? r : []);
        items = arr.map(norm);
        renderList();
        if (selectedIdx >= items.length) selectedIdx = items.length ? 0 : -1;
        renderDetail();
      } catch (e) {
        const listEl = document.getElementById('p-list');
        if (listEl) {
          listEl.innerHTML =
            `<div class="dim p-12">pending: ${e.kind === 'http' ? 'HTTP ' + e.status : (e.message || 'network')}</div>`;
        }
      }
    }

    function renderList() {
      const host = document.getElementById('p-list');
      if (!host) return;
      if (!items.length) {
        host.innerHTML = '<div class="dim p-12">no pending</div>';
        return;
      }
      host.innerHTML = items.map((it, i) => `
        <div class="p-row ${i === selectedIdx ? 'selected' : ''}" data-idx="${i}">
          <div class="head">
            <span class="pill yellow">PEND</span>
            <span class="dim">${U.ago(it.ts)}</span>
            <span class="grow"></span>
            <span class="dim">${it.options.length} opts</span>
          </div>
          <div class="agent">${U.esc(it.agent_id)}</div>
          <div class="ttl">${U.esc(it.title)}</div>
        </div>`).join('');
      host.querySelectorAll('.p-row').forEach(el => {
        el.addEventListener('click', () => {
          selectedIdx = parseInt(el.dataset.idx, 10);
          focusedOpt = 0;
          renderList();
          renderDetail();
        });
      });
    }

    function renderDetail() {
      const host = document.getElementById('p-detail');
      if (!host) return;
      if (selectedIdx < 0 || !items[selectedIdx]) {
        host.innerHTML = '<div class="card dim">选中左侧 pending 查看详情</div>';
        return;
      }
      const it = items[selectedIdx];
      const optsHtml = it.options.map((o, i) => `
        <div class="opt ${i === focusedOpt ? 'focused' : ''}" data-idx="${i}">
          <span class="num">${i + 1}</span>
          <div class="body">
            <div><b>${U.esc(o.label || o.key)}</b> <span class="key">key=${U.esc(o.key)}</span></div>
            ${o.body ? `<div class="opt-body">${U.esc(o.body)}</div>` : ''}
          </div>
        </div>`).join('');

      host.innerHTML = `
        <div class="card">
          <h2>${U.esc(it.title)}</h2>
          <div class="kvs kvs-narrow">
            <div class="dim">agent</div><div>${U.esc(it.agent_id)}</div>
            <div class="dim">key</div><div>${U.esc(it.key)}</div>
            <div class="dim">ts</div><div>${U.fmtTs(it.ts, {full:true})}</div>
          </div>
          ${it.prompt ? `<pre class="prompt">${U.esc(it.prompt)}</pre>` : ''}
        </div>
        <div class="card">
          <h2>options</h2>
          ${optsHtml || '<div class="dim">no options (raw payload below)</div>'}
          ${!it.options.length ? `<pre>${U.esc(JSON.stringify(it.raw, null, 2))}</pre>` : ''}
          <div class="kbar">
            快捷键: <code>1</code>/<code>2</code>/<code>3</code> 直接选项 ·
            <code>↑</code>/<code>↓</code> 切换 pending ·
            <code>Enter</code> 确认聚焦项 ·
            <code>Esc</code> 取消聚焦
          </div>
        </div>
      `;
      host.querySelectorAll('.opt').forEach(el => {
        el.addEventListener('click', () => decideByIdx(parseInt(el.dataset.idx, 10)));
      });
    }

    async function decideByIdx(i) {
      const it = items[selectedIdx];
      if (!it) return;
      const opt = it.options[i];
      if (!opt) { U.toast('option ' + (i + 1) + ' 不存在', 'warn'); return; }
      const body = { key: opt.key, by_agent: 'gui.browser' };
      try {
        await A.decide(it.agent_id, body);
        U.toast(`decided · agent=${it.agent_id.split('.').pop()} option=${opt.key}`);
        items.splice(selectedIdx, 1);
        if (selectedIdx >= items.length) selectedIdx = items.length - 1;
        focusedOpt = 0;
        renderList(); renderDetail();
      } catch (e) {
        const msg = e.kind === 'http' ? `${e.status} ${typeof e.body === 'string' ? e.body : JSON.stringify(e.body)}` : (e.message || 'error');
        U.toast('decide failed: ' + msg, 'err');
      }
    }

    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const it = items[selectedIdx];
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const idx = parseInt(e.key, 10) - 1;
        if (it && it.options[idx]) { e.preventDefault(); decideByIdx(idx); }
      } else if (e.key === 'ArrowDown') {
        if (items.length) {
          e.preventDefault();
          selectedIdx = Math.min(items.length - 1, Math.max(0, selectedIdx + 1));
          focusedOpt = 0;
          renderList(); renderDetail();
        }
      } else if (e.key === 'ArrowUp') {
        if (items.length) {
          e.preventDefault();
          selectedIdx = Math.max(0, selectedIdx - 1);
          focusedOpt = 0;
          renderList(); renderDetail();
        }
      } else if (e.key === 'Enter') {
        if (it && it.options[focusedOpt]) { e.preventDefault(); decideByIdx(focusedOpt); }
      } else if (e.key === 'Escape') {
        focusedOpt = 0;
        renderDetail();
      }
    };
    document.addEventListener('keydown', onKey);

    refresh();
    const stopPoll = U.poll(refresh, 3000);

    return function unmount() {
      stopPoll();
      document.removeEventListener('keydown', onKey);
    };
  }

  // --- SPA registration ---
  window.preApp = window.preApp || {};
  window.preApp.pending = { init };

  // --- Standalone fallback ---
  if (!document.getElementById('app-content')) {
    const host = document.getElementById('appbar-host');
    if (host) {
      host.innerHTML = C.appBar('pending');
      C.startHealthBeacon();
    }
    init();
  }
})();

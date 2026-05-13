# pre_ui — Browser GUI for the [pre](https://github.com/pre-ceo/pre) Master

[中文](#中文) · [English](#english) · [License: MIT](LICENSE)

```
┌─────────────────────────────────────┐
│ Browser  (origin = 127.0.0.1:5174)  │
│   fetch ./api/v1/agents             │
└──────────────┬──────────────────────┘
               │ same-origin, no CORS / preflight
               ▼
┌─────────────────────────────────────┐
│ scripts/fe_server.py @ :5174        │
│   /api/v1/* /healthz → reverse-proxy│
│   anything else      → static files │
└──────────────┬──────────────────────┘
               │ urllib.request (server-side, no CORS)
               ▼
┌─────────────────────────────────────┐
│ pre master @ http://127.0.0.1:19500 │
└─────────────────────────────────────┘
```

## English

Zero-framework browser GUI for the [`pre`](https://github.com/pre-ceo/pre)
multi-agent message bus. Plain HTML + CSS + vanilla JS, served by a small
Python stdlib reverse-proxy that puts the master and the static assets on the
same origin so there's no CORS / preflight to fight.

### What it gives you

- **`agents.html`** — list every agent across every node, send chat / dispatch
  messages, watch tail of recent activity.
- **`pending.html`** — pending PreToolUse / SSH-sudo / freerun ASK prompts
  awaiting human verdict (1/2/3 keyboard shortcuts).
- **`dispatches.html`** — dispatch board (CEO-style task assignment).
- **`tasks.html`** — task overview rendered from agent-emitted markdown.
- **`notifications.html`** — recent notify-channel deliveries (audit log).
- **`usage.html`** — per-agent / per-day token + cost rollup.
- **`mobile.html`** — phone-friendly read-only console.
- **`settings.html`** — Bearer token storage (sessionStorage, masked, never
  persisted across tabs).

### Hard constraints

| # | Rule |
|---|------|
| 1 | Zero framework — pure HTML + CSS + vanilla JS |
| 2 | Color palette: cyan / yellow / blue / magenta + dim gray. **No red/green** (red-green-deficient-friendly) |
| 3 | DOMPurify 3.2.4 vendored + SRI hash for any markdown rendering |
| 4 | Strict CSP: `default-src 'self'; connect-src 'self' http://127.0.0.1:19500` |
| 5 | Bearer token → `sessionStorage` only (cleared on tab close) + `type="password"` + masked display |
| 6 | All `fetch()` go through relative paths (`./api/v1/...`) — no absolute URLs |
| 7 | No WebSocket dependency — polling-based UI (5s heartbeat / agents list) |

### Prerequisites

`pre_ui` reuses the sibling [`pre`](https://github.com/pre-ceo/pre) project's
hooks. The `.claude/settings.json` here references two console-script entries —
`pre-tool-use` and `pre-stop-hook` — that are installed by pre's
`scripts/install.sh`. Install pre first, otherwise the PreToolUse / Stop hooks
will silently fail with "command not found":

```bash
git clone https://github.com/pre-ceo/pre.git
bash ./pre/scripts/install.sh          # installs the two shims into ~/.local/bin

# verify both are on PATH
which pre-tool-use && which pre-stop-hook
```

### Quick start

Run from a workspace directory where you cloned `pre` (above); `pre_ui` is
cloned as a sibling next to it.

```bash
git clone https://github.com/pre-ceo/pre_ui.git

# 1. start the master
bash ./pre/scripts/bus_ctl.sh start

# 2. start the self-proxy + static server (tmux session: pre-ui-static)
cd ./pre_ui
bash scripts/fe_ctl.sh start
bash scripts/fe_ctl.sh status      # 5/5 ok = healthy

# 3. open the GUI
open http://127.0.0.1:5174/agents.html
# default Bearer token: "pre" — change in settings.html for prod
```

Override defaults with env vars before `fe_ctl.sh start`:

| Variable | Default |
|----------|---------|
| `PREUI_PORT` | 5174 |
| `PREUI_BIND` | 127.0.0.1 |
| `PREUI_SESSION` | pre-ui-static |
| `PREUI_MASTER` | http://127.0.0.1:19500 |

### File layout

```
pre_ui/
├── *.html                         ← page entry points (CSP enforced)
├── shared/
│   ├── theme.css                  ← color tokens + reusable components
│   ├── utils.js                   ← fmtTs/ago/esc/poll/ssGet/ssSet/maskToken
│   ├── fetch.js                   ← API wrapper (relative path + Bearer)
│   ├── components.js              ← appBar/healthBeacon/pills/mdRender(DOMPurify)
│   └── vendor/dompurify.min.js    ← 3.2.4 + SRI
├── js/                            ← per-page behavior (CSP forbids inline)
├── css/                           ← per-page styles (CSP forbids inline <style>)
├── scripts/
│   ├── fe_server.py               ← static server + /api reverse proxy (~150 LOC stdlib)
│   └── fe_ctl.sh                  ← tmux lifecycle (start/stop/restart/status/logs)
└── docs/
    ├── REQUIREMENTS.md            ← v1 functional spec
    ├── DESIGN_NOTES.md            ← page layouts + component decomposition
    └── MIRROR_API.md              ← master API mirror for development
```

### Security model summary

| Risk | Mitigation |
|------|-----------|
| XSS via markdown | DOMPurify with explicit ALLOWED_TAGS/ATTR + FORBID style/script/iframe/form |
| Inline JS injection | CSP `script-src 'self'` (no `unsafe-inline`) — every script externalized |
| Token exfiltration | sessionStorage + `type="password"` + autocomplete=off + masked display |
| Third-party tampering | DOMPurify SRI integrity hash |
| Master URL hijack | All requests go through same-origin self-proxy on 5174 |
| Clickjacking | `frame-ancestors 'none'` |

### License

MIT — see [LICENSE](LICENSE).

---

<a id="中文"></a>
## 中文

[`pre`](https://github.com/pre-ceo/pre) 多 agent 总线的浏览器 GUI.
零框架, 纯 HTML+CSS+vanilla JS, 加一个 Python stdlib 写的 self-proxy 把
master 与静态资源放在同 origin, 完全免 CORS / preflight.

### 主要页面

- `agents.html` — 跨 node 列出所有 agent, 发 chat/dispatch, 看尾部日志
- `pending.html` — PreToolUse / SSH-sudo / freerun 待审 ASK 列表 (1/2/3 快捷键)
- `dispatches.html` — 派单看板 (CEO 视角)
- `tasks.html` — agent 提交的 markdown 任务列表
- `notifications.html` — 通知 channel 投递审计
- `usage.html` — 各 agent/各天 token + 成本汇总
- `mobile.html` — 手机端只读看板
- `settings.html` — Bearer token 管理 (sessionStorage + 掩码, 关 tab 即失效)

### 硬约束

| 编号 | 约束 |
|------|------|
| 1 | 零框架, 纯 HTML+CSS+vanilla JS |
| 2 | 配色: cyan / yellow / blue / magenta + dim gray, **不用红绿** (红绿色弱友好) |
| 3 | DOMPurify 3.2.4 vendored + SRI |
| 4 | 严格 CSP: `default-src 'self'; connect-src 'self' http://127.0.0.1:19500` |
| 5 | Bearer token → 仅 sessionStorage + `type="password"` + 掩码显示 |
| 6 | 所有 fetch 走相对路径 `./api/v1/...`, 不写硬编码 URL |
| 7 | 不依赖 WebSocket — 轮询模式 (5s 心跳/agent 列表) |

### 前置依赖

pre_ui 复用 sibling [`pre`](https://github.com/pre-ceo/pre) 项目的 hook —
`.claude/settings.json` 里 PreToolUse / Stop 指向两个 console-script 入口
`pre-tool-use` / `pre-stop-hook`, 这俩 shim 由 pre 的 `scripts/install.sh` 装到
`~/.local/bin`. 先装 pre, 否则 hook 触发时会 "command not found" 静默 fail:

```bash
git clone https://github.com/pre-ceo/pre.git
bash ./pre/scripts/install.sh          # 装两个 shim 到 ~/.local/bin

# 验证两个命令都在 PATH 上
which pre-tool-use && which pre-stop-hook
```

### 快速启动

在 (上面 `pre` clone 出来的) workspace 目录下执行; `pre_ui` 作为 sibling 跟它并列.

```bash
git clone https://github.com/pre-ceo/pre_ui.git

# 1. 起 master
bash ./pre/scripts/bus_ctl.sh start

# 2. 起 self-proxy + 静态 server (tmux session: pre-ui-static)
cd ./pre_ui
bash scripts/fe_ctl.sh start
bash scripts/fe_ctl.sh status     # 5/5 ok = 健康

# 3. 打开 GUI
open http://127.0.0.1:5174/agents.html
# 默认 token: "pre", 生产改在 settings.html
```

环境变量:

| 变量 | 默认 |
|------|------|
| `PREUI_PORT` | 5174 |
| `PREUI_BIND` | 127.0.0.1 |
| `PREUI_SESSION` | pre-ui-static |
| `PREUI_MASTER` | http://127.0.0.1:19500 |

### 目录结构

```
pre_ui/
├── *.html                         ← 各页面入口 (CSP 严格)
├── shared/
│   ├── theme.css                  ← 配色 token + 通用组件
│   ├── utils.js / fetch.js / components.js
│   └── vendor/dompurify.min.js    ← 3.2.4 + SRI
├── js/                            ← 各页面 JS (CSP 强制外置)
├── css/                           ← 各页面样式
├── scripts/
│   ├── fe_server.py               ← 静态 + /api 反代一体 (~150 行 stdlib)
│   └── fe_ctl.sh                  ← tmux 生命周期
└── docs/
```

### License

[MIT](LICENSE)

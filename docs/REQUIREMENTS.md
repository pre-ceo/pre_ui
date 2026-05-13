# pre_ui 需求文档

版本: v1.0 (2026-04-28); v1.1 (2026-04-29): 新增 §0 技术约束 (postmortem 修正); v1.2 (2026-04-29): 修正 §0.4 部署模型 (独立项目, 不寄居 agent-fe)
来源: pre 项目设计 [framework](https://github.com/pre-ceo/pre/blob/main/dev-workflow/features/-message-bus-framework-create.md) + 实施 phase 1-3

---

## 0. 技术约束 (硬性, 不可绕过)

本项目作为 agent-fe 体系内的一个前端页面 (admin GUI for pre 消息总线), **必须严守 sibling `agent-fe` 项目的 `CLAUDE.md` 核心原则**:

### 0.1 零框架
- 严禁 React / Vue / Angular / Svelte 等 SPA 框架
- 严禁 Vite / webpack 等 bundler 作为开发依赖
- 纯 HTML + CSS + Vanilla JavaScript

### 0.2 单文件页面
- 一个页面 = 一个 HTML 文件 (内联 CSS / JS, 或 `<script src="...">` 引共享模块)
- 不做多文件 ESM 模块拆分 (浏览器原生 `<script type="module">` 例外)

### 0.3 共享层抽取
- 复用 agent-fe/src/shared/{theme.css, utils.js, components.js, fetch.js}
- 重复代码 ≥ 3 次提到 shared/

### 0.4 部署模型 (v1.2 修订: 独立项目, 不寄居 agent-fe)
pre_ui 是**独立前端项目**, 不是 agent-fe 的子页面 (区别 R1a 大型独立 vs R1b 嵌入式)。
- 源码住在 `pre_ui/` 自己的仓库目录: `index.html`, `agents.html`, `pending.html`, `findings.html`, `settings.html`
- 共享模块: 复制 agent-fe/src/shared/ 中需要的文件到 `pre_ui/shared/` (单一中心 = "标准来源", 不等于 "代码寄居处"); 或通过相对路径引用同根目录下的 agent-fe (开发期可行, 生产部署考虑路径)
- serve: 自己起 server (例如 `python3 -m http.server 5174 --bind 127.0.0.1`) 或 feserver 加路由 (后者更统一); 浏览器访问 `http://127.0.0.1:5174/agents.html`
- 提案: 优先 feserver 路由, 因为 agent-fe/feserver 已经统一管 token + API 代理; 但 feserver 把 pre_ui 当外部源 (不是自己 src/), 配置: `/{token}/pre/* → http://127.0.0.1:5174/* + API 代理 19500`

**agent-fe 的"单一中心"原则在本项目作如下解释**: agent-fe 持有"前端开发标准 + 共享模块 + feserver"; 大型独立前端项目 (pre_ui/fn_product_fe) 在**自己目录**开发, **遵循** agent-fe 标准, 但**不寄居** agent-fe/src/。这是 R1a 的本意, v1.1 误读为"寄居"。

### 0.5 配色 / 字体
- cyan / yellow / blue / magenta + dim 灰; 禁用红绿 (user 红绿色弱)
- macOS Terminal 暗色风格 (沿用 agent-fe constitution)
- 等宽字体 (Menlo / Monaco), 信息密度优先

### 0.6 安全
- master Bearer token 通过 feserver token 路由 + 设置页输入二次保存; 不允许浏览器直连 19500 (CORS / Origin / 净化已在 master 端做了, 但 GUI 走 feserver 代理这一道)
- markdown 渲染 (findings 等高风险) 用 DOMPurify (作为 vendor 引入即可, 单文件 ~14KB)

### 0.7 旧 DESIGN_NOTES.md 中提到的 React/Vite/Zustand 全部废弃
见该文件标注 `[v2 已废弃, 见 REQUIREMENTS.md §0]`。

---

## 1. 用户与场景

**主用户**: user (单用户单机, MVP 阶段)
**角色**: CEO — 系统内的最高指挥者, 操控所有 Agent

### 典型工作日

09:00 — 早上打开 GUI, 看到夜间所有 freerun-worker (remote-node 上的 agent-research / agent-trade) 的 finding。CRITICAL 已通过 webhook-notify TTS 提醒过, GUI 列表里高亮可以一键查看 report。

10:00 — CEO 给本机 chrome-gemini agent 发查询: "整理今天 BTC 新闻"; 给 remote-node 上 cli-claude-code 发任务: "继续 v3 模型回测"。两个任务并行, GUI 实时显示进度。

14:00 — 收到 agent-trade 的 stop event 通知, 双击查看 stop_analyzer 给的下一步建议, 决定接受/修改/丢弃。

20:00 — 切到夜间模式, 把所有可自主运行的 worker 切成 `freerun`, 关闭 GUI 离开。

### 不在用户范围
- 不需要团队协作 (多用户访问同一 master)
- 不需要消息持久化跨年级 (master sqlite 容量足够)
- 不需要复杂权限 (单 CEO + worker / freerun-worker 三层即够)

---

## 2. 功能需求

### F1. Agent 总览 (Dashboard)
- 列出所有已注册 agent
- 按 node / role / state 过滤
- 显示: agent_id, role, state (idle/busy/blocked/error/offline), node_id, last_update
- 一目了然: 哪个在跑, 哪个空闲, 哪个有问题

### F2. 单 Agent 详情
- 完整 metadata (cwd, tmux_session, mode, ...)
- 当前 stop_status (analyzer 的最新分析)
- 历史消息 (双向: CEO 发给 agent + agent 上报)
- finding 列表 (按 INFO/WARNING/CRITICAL 分级)

### F3. 给 Agent 发消息
- 输入文本, kind 选择 (默认 `command`)
- 优先级 (low/normal/high/critical)
- 发出后立刻显示 "queued", 收到响应/状态后更新

### F4. 多 Agent 协调
- 选中多个 agent, 群发同一指令
- 创建 thread (一组相关消息), 跨 agent 协作

### F5. Finding 中心
- 列出所有 agent 的 finding (CRITICAL 置顶)
- 一键打开 report 文件 (本机文件 system 路径 → 弹窗内嵌 markdown)
- 标记已读 / 归档

### F6. Node 健康
- 列出所有 node + 心跳状态
- offline node 显著警示 (cyan→yellow 色)
- 一键拉取 node 详情 (driver 列表, 最后 heartbeat 时间)

### F7. Role 切换
- 选 agent → 改 role (例如把 worker 临时升 freerun-worker)
- 修改后 master 同步给 node, driver 应用 (具体效果按 driver 实现)

### F8. 实时事件流
- 一个滚动窗口显示所有 master 推送的事件
- 事件类型: state_changed / message.in / node.heartbeat_lost / finding.new
- 可按类型 / agent 过滤

### F9. 系统配置
- 显示当前 master 地址 / shared secret 状态 (是否已认证)
- 可切换 master endpoint (开发期用)
- 可清空本地缓存 (重新拉)

---

## 3. API 接口 (与 pre Master 对接)

完整定义见 [docs/MIRROR_API.md](MIRROR_API.md). 核心:

### 3.1 HTTP REST

```
GET  /api/v1/healthz                 → "pre master ok"
GET  /api/v1/nodes                   → {nodes: [...]}
GET  /api/v1/agents                  → {agents: [...]}
GET  /api/v1/agents/{id}             → {agent_id, ...} (404 不存在)
GET  /api/v1/agents/{id}/state       → {state, last_update}
GET  /api/v1/agents/{id}/messages?since=ts&limit=N&kind=...
                                     → {agent, messages: [...]}
POST /api/v1/agents/{id}/send
  body: {kind, payload, priority?, parent_id?}
                                     → {ok: true, msg_id}

POST /api/v1/agents/{id}/role
  body: {new_role}
                                     → {ok: true}

GET  /api/v1/messages?since=ts&limit=N
GET  /api/v1/findings?level=CRITICAL&limit=N
                                     → {findings: [...]}

POST /api/v1/broadcast
  body: {target: {role|node|state|...}, message: {kind, payload}}
                                     → {sent_to: [agent_id, ...]}
```

### 3.2 WebSocket Push

`ws://master/api/v1/stream` (注意: MVP master 已打桩端点, 实际 push 在 GUI 集成时联合实现)

订阅后 master 推送:
```json
{"type": "agent.state_changed", "agent_id": "...", "state": "busy", "ts": 1730000000.0}
{"type": "message.in", "message": {...}}
{"type": "node.heartbeat_lost", "node_id": "remote-node", "since": 1730000000.0}
{"type": "node.online", "node_id": "remote-node", "ts": 1730000000.0}
{"type": "finding.new", "agent_id": "...", "level": "CRITICAL", "title": "...", "report_path": "..."}
{"type": "agent.registered", "agent": {...}}
{"type": "agent.unregistered", "agent_id": "..."}
```

订阅后客户端可发 (双向):
```json
{"type": "subscribe", "filter": {"agent_id": "..."}}
{"type": "unsubscribe", "filter": {...}}
{"type": "ping", "ts": ...}
```

---

## 4. 视觉与交互需求

### 4.1 配色 (用户红绿色弱)
**禁用**红色和绿色作为唯一区分手段。用以下:
- **cyan** — 正常 / 健康 / OK
- **yellow** — 警告 / 待处理
- **blue** — 信息 / 中性
- **magenta** — 强调 / CRITICAL / 高亮

错误状态可用 `yellow on dark` 或 `magenta` 表达, 不要用 red。

### 4.2 信息密度
- Dashboard 必须能在 1 屏 (1080p) 看到 ≥ 50 个 agent 的关键信息
- 单 agent 详情 不要超过 2 屏 (滚动)
- 实时事件流单条不超过 1 行, 详情靠点击展开

### 4.3 字体与对齐
- 终端等宽风格 (用户偏好)
- 表格列对齐用英文 header (中文不等宽)
- 中文注释/提示 在表格下方

### 4.4 关键交互
- 主操作 1 click: 给 agent 发消息 / 看 finding / 切 role
- 危险操作 (例如改 CRITICAL agent 的 role) 二次确认
- ESC / Ctrl+W 关闭弹窗

---

## 5. 性能需求

- WS push 延迟 < 100ms (master → GUI)
- Agent 列表 1000 个时仍流畅滚动
- 单 agent 历史消息分页加载, 避免一次拉万条

---

## 6. 错误处理

- WS 断线: 自动重连 (1s → 2s → ... → 30s 上限), 显示连接状态指示器
- HTTP 调用失败: 提示 + 重试按钮, 不让用户卡住
- Master 未启动: GUI 应能启动并显示 "master offline", 不崩溃

---

## 7. 安全

- 共享 secret 仅本机/内网使用, MVP 不实现登录
- 公网部署时由 master 加 TLS, GUI 用 wss://
- 不在前端硬编码 secret, 通过设置页输入并存 localStorage

---

## 8. 实施阶段建议

### MVP (Phase A)
- F1. Agent 总览
- F2. 单 Agent 详情 (基础: metadata + 历史消息)
- F3. 发消息
- F8. 实时事件流 (基础)
- 单 master 单 node 跑通

### Phase B
- F5. Finding 中心
- F6. Node 健康
- F7. Role 切换

### Phase C
- F4. 多 agent 协调 + thread
- F9. 系统配置
- 桌面打包 (Tauri)

---

## 9. 不在范围 (明确排除)

- 在 GUI 内修改 pre 源码 / 规则文件 (用 IDE)
- agent 自身的对话编辑器 (CEO 是发命令, 不直接编辑 agent 内部 prompt)
- 多用户协作 / RBAC
- 移动端

---

## 10. 后续维护

需求变更走 pre 项目的 dev-workflow 流程, 同步更新本文档。前端开发者发现 API 不一致, 在 pre 项目提 issue, 不要直接改 master 代码。

# pre_ui 设计建议 (头脑风暴, 非强制)

> **[v2 已废弃 — 2026-04-29 postmortem ]**
> 本文 React / Vite / Zustand / TypeScript / react-window 等"现代 SPA 栈"建议**全部废弃**, 违反 agent-fe/CLAUDE.md 零框架原则。
> 当前权威栈定义见 `REQUIREMENTS.md §0 技术约束 (硬性)`: 纯 HTML + CSS + Vanilla JS, 单文件页面, 共享 agent-fe/src/shared/, 部署到 agent-fe/src/pre/ 走 feserver 代理。
> 本文按宪法原则保留, 不删除, 仅作为历史决策痕迹。

---

供前端开发者参考, 不是强制规范。

---

## 页面布局思路 1: 三栏

```
┌──────────────────────────────────────────────────────────────┐
│  TopBar: [master status]  [active tab badge]   [user menu]   │
├─────────────┬────────────────────────────┬─────────────────┤
│             │                            │                  │
│  Sidebar    │     Main Workspace         │   Right Panel    │
│             │                            │                  │
│  ─ Nodes    │   (depends on selection)   │   ─ Event Stream │
│  ─ Agents   │                            │     (real-time)  │
│  ─ Findings │   - Agent detail           │                  │
│  ─ Threads  │   - Send composer          │   ─ Quick filter │
│             │   - Message history        │                  │
│             │                            │                  │
└─────────────┴────────────────────────────┴─────────────────┘
```

- 左侧 Sidebar: 选 agent / node / finding 组列表
- 中间 Main: 当前选择的详情, 主操作区
- 右侧 Event Stream: 实时事件滚动, 跨选择持续显示

## 页面布局思路 2: Tab + Dashboard

```
┌──────────────────────────────────────────────────────────────┐
│  Dashboard | Agents | Findings | Logs | Settings              │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│   [Selected Tab Content]                                       │
│                                                                │
│   Dashboard 默认: 多个卡片 grid                                  │
│     - Online Agents (count + 趋势)                            │
│     - CRITICAL findings (列表)                                 │
│     - Recent activity (最近 10 条 message)                     │
│     - Node health (pixel grid: 每 node 一个色块)              │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

适合 macOS app 风格, 信息密度低但易上手。

---

## 组件分解 (示例)

### Atomic
- `Badge` (cyan/yellow/blue/magenta variants)
- `StatePill` (idle/busy/blocked/error/offline)
- `RolePill` (CEO/worker/freerun-worker/observer)
- `Timestamp` (相对时间 / 绝对时间 hover toggle)

### Molecule
- `AgentRow` (一行 agent 摘要 in list)
- `MessageBubble` (CEO 与 agent 双向, 不同 align)
- `FindingCard` (level + title + agent + actions)

### Organism
- `AgentList` (虚拟滚动)
- `MessageThread` (按 parent_id 串成树)
- `EventStream` (无限 append)

### Page
- `DashboardPage` / `AgentDetailPage` / `FindingsPage` / `SettingsPage`

---

## 状态管理建议

**单一 source: master**. 前端不维护本地 truth, 仅做 cache + view state.

```
master state
   ├─ nodes: dict[node_id, NodeInfo]
   ├─ agents: dict[agent_id, AgentInfo]
   ├─ findings: list[Finding] (有限 cache)
   └─ messages: dict[agent_id, list[Message]] (按 agent 分组)

view state (前端独立)
   ├─ selected_agent
   ├─ filter: {role, state, node}
   ├─ ws_connection_state
   └─ event_stream (近 N 条)
```

操作流:
1. `useEffect` 启动: HTTP 拉初始 nodes + agents + findings, WS 连 stream
2. WS 推消息时 mutate master state
3. UI 操作 (发送 / 切 role) → POST → 等服务端响应 → state via WS push (避免乐观更新出错)

不推荐 RxJS / MobX 满级方案, MVP 用 React useState + Context 或 Zustand 即可。

---

## 实时事件流处理

```
WS push 速率: peak 10/s (大量 agent 状态变化)
                steady 0.1-1/s

Event stream UI: 滚动列表, 上限 500 条 (旧的丢弃)
WS 断线: 黄条警示 "reconnecting...", 并显示丢失多少时间
```

Event 分类着色:
- `state_changed` → blue
- `message.in` → cyan (内容预览)
- `node.heartbeat_lost` → yellow (警告)
- `finding.new CRITICAL` → magenta + 闪烁 (3s)
- `finding.new WARNING/INFO` → blue

---

## 用户输入流

### 给 agent 发消息
```
[选 agent] → [输入框] → [type 选 dropdown: command/chat/...] → [send]
              ↓
              prompt textarea (multi-line, Cmd+Enter 提交)
              附加: 优先级 toggle (low/normal/high/critical)
```

### 多 agent broadcast
```
[过滤 agents (role=worker, state=idle)] → [check all matching] → [composer]
   一键给 idle worker 发消息
```

### Role 切换
```
[agent detail] → [Role badge] → [click → menu] → 二次确认 (CRITICAL 才弹)
```

---

## 错误状态

错误一律不用红色! 用:
- yellow: 警告 / 待处理
- magenta: 严重 / CRITICAL

例:
- master offline: yellow `Master offline (retry in 5s)`
- agent error: magenta `error - last action: ssh timeout`
- finding CRITICAL: magenta + bold

---

## 桌面打包建议 (可选)

### Tauri (推荐)
- 体积小 (~ 5MB)
- macOS 原生
- 用 system webview, JS 端跟普通 web 一样写
- 自带打包到 .dmg

### Electron
- 生态成熟
- 体积大 (~ 100MB)
- 适合大型项目

MVP 阶段直接用 vite dev server 即可, 浏览器访问 localhost:5173, 打包延后。

---

## 不要做的事

1. **不要在前端 cache master 太多状态** — master sqlite 才是 truth, 前端只 view
2. **不要做权限审计** — master 已做, 前端无需重复 check
3. **不要重写 governor 逻辑** — driver 内部的事, 前端只看结果
4. **不要做 agent 内部 prompt 编辑** — CEO 是发命令的, 不是改 agent 内部 system prompt 的
5. **不要做大屏 dashboard 风格 (TV display)** — 单用户 mac 桌面优先

---

## 性能注意点

- `agents` 列表渲染用虚拟滚动 (react-window / TanStack Virtual)
- `messages` 历史分页加载, 不一次拉所有
- WS 消息 batch render (16ms 内合并)
- `metadata` 等长 JSON 大对象不要每次重渲, useMemo 切片

---

## 测试建议

- mock master: 写一个 fake server 推假数据 (dev 期间)
- E2E: 起真 pre master + pre node + 自动 register 几个 agent → 用 Playwright 跑

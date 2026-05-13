# pre Master API 镜像 (供 pre_ui 开发)

**注**: 本文档是 pre 项目当前实现的 API 快照, 仅供前端开发参考。源代码权威, 不一致以 pre 为准。

最后同步: 2026-04-28 (基于 pre 提交 ?, Phase 1+2+3 实现状态)

---

## Base URL

`http://127.0.0.1:19500` (默认, 可由 master `--host --port` 覆盖)

---

## 1. Health & Info

### `GET /` 或 `GET /healthz`

```
HTTP/1.1 200 OK
Content-Type: text/plain  (实际是 application/json, 但内容是 "pre master ok\n")

pre master ok
```

---

## 2. Nodes

### `GET /api/v1/nodes`

```json
{
  "nodes": [
    {
      "node_id": "local",
      "host": "local-machine.local",
      "capabilities": ["cli-claude-code-local"],
      "last_seen": 1777354222.91,
      "online": true
    }
  ]
}
```

字段:
- `node_id` (string): node 唯一标识
- `host` (string): 主机名 (反向 DNS 或 IP)
- `capabilities` (string[]): 此 node 加载的 driver type 列表
- `last_seen` (float): epoch 秒, 最后心跳时间
- `online` (bool): 是否在线 (90s 内有心跳)

---

## 3. Agents

### `GET /api/v1/agents`

```json
{
  "agents": [
    {
      "agent_id": "local.cli-claude-code-local.pre",
      "node_id": "local",
      "driver_type": "cli-claude-code-local",
      "role": "CEO",
      "state": "idle",
      "capabilities": ["text-chat", "tool-use"],
      "metadata": {
        "cwd": "./pre",
        "tmux_session": "pre",
        "mode": "supervised",
        "project_name": "pre"
      },
      "last_update": 1777354222.91
    }
  ]
}
```

字段:
- `agent_id` (string): `<node_id>.<driver_type>.<local_name>`
- `node_id` (string): 所属 node
- `driver_type` (string): 此 agent 由哪个 driver 管理
- `role` (string): 业务角色 (CEO / worker / freerun-worker / observer)
- `state` (string): idle / busy / thinking / blocked / error / offline / unknown
- `capabilities` (string[]): 此 agent 提供的能力
- `metadata` (object): driver 自由扩展, 见各 driver 文档
- `last_update` (float): epoch 秒

### `GET /api/v1/agents/{agent_id}`

返回单个 agent 详情 (同上结构, 不在 `agents` 数组里)。
**当前 Master 未实现此端点 ⚠️**, 需要补 (Phase 5)。

### `GET /api/v1/agents/{agent_id}/state`

```json
{"state": "busy", "last_update": 1777354222.91}
```

**当前 Master 未实现 ⚠️**, 临时解法: 从 `/api/v1/agents` 过滤。

### `GET /api/v1/agents/{agent_id}/messages?since=<epoch>&limit=<n>`

```json
{
  "agent": "local.cli-claude-code-local.pre",
  "messages": [
    {
      "id": "uuid-hex",
      "ts": 1777354222.91,
      "from_agent": "...",
      "to_agent": "...",
      "from_role": "CEO",
      "to_role": "worker",
      "kind": "command",
      "payload": {"text": "..."},
      "parent_id": null,
      "priority": 0
    }
  ]
}
```

参数:
- `since` (float, 默认 0): 仅返回 ts >= since 的
- `limit` (int, 默认 100, 最大 1000)
- `kind` (string, 可选过滤): command / report / chat / event / heartbeat / ack / result

### `POST /api/v1/agents/{agent_id}/send`

**当前 Master 未实现 ⚠️** (Phase 5 实现)。

```
Content-Type: application/json
Body:
{
  "kind": "command",
  "payload": {"text": "..."},
  "priority": 0,
  "parent_id": null
}

Response:
{"ok": true, "msg_id": "uuid-hex"}
```

### `POST /api/v1/agents/{agent_id}/role`

**当前 Master 未实现 ⚠️** (Phase 5 实现)。

```
Body: {"new_role": "freerun-worker"}
Response: {"ok": true, "old_role": "worker", "new_role": "freerun-worker"}
```

---

## 4. Messages (全局)

### `GET /api/v1/messages?since=<epoch>&limit=<n>`

```json
{"messages": [...]}
```

同 `/agents/{id}/messages` 但不限 agent。

---

## 5. Findings (沿用 pre pre/findings 体系)

### `GET /api/v1/findings?level=<level>&limit=<n>`

**当前 Master 未实现 ⚠️**

```json
{
  "findings": [
    {
      "agent_id": "remote-node.cli-claude-code-remote.agent-research",
      "level": "CRITICAL",
      "title": "策略收益断崖",
      "ts": 1777354222.91,
      "report_path": "./agent-research/pre/reports/CRITICAL-...md",
      "git_tag": "finding/critical/2026-04-27"
    }
  ]
}
```

来源: master 订阅 driver 上报的 finding event, 持久化到 sqlite。

---

## 6. Broadcast

### `POST /api/v1/broadcast`

**当前 Master 未实现 ⚠️**

```
Body:
{
  "target": {
    "role": "worker",          # 可选
    "node_id": "remote-node",     # 可选
    "state": "idle"            # 可选
  },
  "message": {
    "kind": "command",
    "payload": {"text": "..."}
  }
}

Response:
{"sent_to": ["agent_id_1", ...]}
```

---

## 7. WebSocket Push

### `ws://127.0.0.1:19500/api/v1/stream`

**当前 Master 已打桩, 无实际 push ⚠️** (Phase 5 实现)。

**握手**: 标准 WS, 无认证 (本机/内网信任)

**消息格式 (master → 客户端)**:
```json
{"type": "agent.state_changed", "agent_id": "...", "state": "busy", "ts": 1777354222.91}

{"type": "message.in", "message": {/* Message */}}

{"type": "node.heartbeat_lost", "node_id": "remote-node", "since": 1777354222.91}
{"type": "node.online", "node_id": "remote-node", "ts": 1777354222.91}

{"type": "agent.registered", "agent": {/* AgentInfo */}}
{"type": "agent.unregistered", "agent_id": "..."}

{"type": "finding.new", "agent_id": "...", "level": "CRITICAL", "title": "...", "report_path": "..."}
```

**客户端可发 (双向控制)**:
```json
{"type": "subscribe", "filter": {"agent_id": "..."}}
{"type": "unsubscribe", "filter": {...}}
{"type": "ping", "ts": ...}
```

服务端会回 `{"type": "pong", "ts": ...}`.

---

## 8. 错误响应统一格式

```
HTTP 4xx/5xx
Content-Type: application/json

{"error": "...", "detail": "..."}
```

常见 status:
- 400: bad request body
- 404: agent / node not found
- 405: method not allowed (用 OPTIONS 看)
- 501: not implemented (打桩端点)
- 500: internal error

---

## 9. 当前 Master 实现状态对照

| 端点 | 状态 |
|------|------|
| GET /healthz | ✅ |
| GET /api/v1/nodes | ✅ |
| GET /api/v1/agents | ✅ |
| GET /api/v1/agents/{id} | ❌ 待实现 |
| GET /api/v1/agents/{id}/state | ❌ 待实现 |
| GET /api/v1/agents/{id}/messages | ✅ |
| POST /api/v1/agents/{id}/send | ❌ 待实现 |
| POST /api/v1/agents/{id}/role | ❌ 待实现 |
| GET /api/v1/messages | ✅ |
| GET /api/v1/findings | ❌ 待实现 |
| POST /api/v1/broadcast | ❌ 待实现 |
| WS /api/v1/stream | ❌ 已打桩, 无 push |

❌ 部分 pre 项目在后续 phase 实现; 前端可先做 mock。

# pre_ui — PreToolUse Rules

Governor 在评估工具调用时会读取这些项目规则, 叠加在全局规则之上。

## 项目描述

(简述项目类型: 如 trading bot / web app / infra ops)

## 额外 ALLOW

- (描述项目特定的可放行操作)

## 额外 ASK

- (描述需要审查的操作)

## 额外 DENY

- (绝对禁止的操作)

## 内联执行 / SSH 远程

按 pre 通用规则: 分析实际代码内容判断风险。
- 明确安全 (只读、状态查询) → ALLOW
- 涉及资金 / 写操作 / 敏感路径 → ASK
- 不清楚 → ASK

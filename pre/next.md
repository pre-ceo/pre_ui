# pre_ui — Next Task

当 agent 在 autonomous/freerun 模式停止时, 会被提示读这个文件决定下一步。
按优先级列出可探索的方向。

## 优先级

### 1. 未完成任务
- 检查 dev-workflow/features/ 中没有匹配 done 的 create 文件
- 处理 TODO/FIXME 注释

### 2. 质量改进
- 运行测试验证当前代码
- 检查类型 / lint
- 错误处理缺失

### 3. 文档
- 检查 README.md / CLAUDE.md 是否反映最新代码

### 4. 关键发现
重要结果写入 pre/findings/{LEVEL}-{title}.md:
- INFO: 一般观察
- WARNING: 潜在风险
- CRITICAL: 严重问题 (会触发紧急 TTS 通知)

## 完成判定

任务完全完成时执行:
```
echo done > pre/.done
```
这会让 stop hook 放行 agent 自然停止。

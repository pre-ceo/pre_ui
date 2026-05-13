# pre_ui 视觉风格规范 (Visual Style Guide)

零框架浏览器 GUI 的统一视觉语言. 兼任三个职能: (1) 给 pre_ui 团队自己的硬约束;
(2) 给同生态项目 (e.g. `pre_web`) 的对齐指南; (3) 公开开源合规的设计自陈.

本文 + [`OPENSOURCE_DESIGN_COMPLIANCE.md`](./OPENSOURCE_DESIGN_COMPLIANCE.md) 共同构成
完整设计宪法.

---

## 0. 总则 (一句话)

**扁平 IDE / 终端 cli 范式 — 容器贴边填满, 项目最小可读 padding, 配色 cyan/yellow/blue/magenta
+ 中性灰严禁红绿, 字体走开源链, 拒绝任何特定桌面 OS (尤其 macOS) 的窗口 chrome 复刻.**

---

## 1. 配色 token

定义在 `shared/theme.css` `:root`. **使用方一律走 CSS 变量, 不写字面色值**.

### 1.1 中性面 (surface)

| 变量 | 值 | 用途 |
|------|------|------|
| `--bg`   | `#ffffff` | body / 主内容 canvas |
| `--bg2`  | `#f5f5f5` | 导航/列容器/表格条纹底 |
| `--bgh`  | `#ebebeb` | hover |
| `--bg3`  | `#dcdcdc` | selected (强烈) |
| `--txt`  | `#333333` | 主文字 |
| `--txt2` | `#666666` | 次要文字 |
| `--dim`  | `#999999` | 元数据/灰显 |
| `--brd`  | `#d0d0d0` | 主分隔线 |
| `--brdl` | `#e6e6e6` | 浅分隔线 |

### 1.2 强调色 (accent, 无红无绿)

| 变量 | 值 | 语义 |
|------|------|------|
| `--cyan`    | `#00a3a5` | ok / success / active (替代红绿色弱用户的 green) |
| `--yellow`  | `#a68f00` | warn / near limit (olive-yellow, 白底足够对比) |
| `--blue`    | `#0225c7` | info / primary / brand |
| `--magenta` | `#c930c7` | err / blocked / critical (替代 red) |

`--ok / --err / --warn / --info` 是语义别名, 全部映射到上面 4 色 + 灰. **代码中严禁 `red` /
`green` 字面色, 一律走变量.**

---

## 2. 字体 — 开源链, 拒专有名

```css
font-family: ui-monospace, 'Cascadia Mono', 'Source Code Pro',
             'JetBrains Mono', 'DejaVu Sans Mono', 'Liberation Mono',
             Consolas, monospace;
```

### 2.1 字体禁令 (CLAUDE.md #1 / OPENSOURCE_DESIGN_COMPLIANCE.md)

**任何 `font-family` 声明里禁止出现:**

- `Menlo`, `Monaco` (Apple 私有, macOS 自带)
- `SF Mono`, `SF Pro`, `San Francisco` (Apple, 仅限 Apple 生态)
- `New York` (Apple 私有)
- `Courier New`, `Courier` (Microsoft + Adobe 闭源)

`-apple-system` / `BlinkMacSystemFont` 是 **CSS 关键字**而非字体名, 浏览器解析时映射到 OS
默认字体, 引用合规 — 但鼓励优先用 `ui-monospace` / `system-ui` 这种 CSS Fonts L4 标准
关键字.

### 2.2 sans-serif 场景 (如有, pre_ui 当前全 monospace)

```css
font-family: system-ui, -apple-system, BlinkMacSystemFont,
             'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```

---

## 3. 填满优先, 容器零 padding/margin

CLAUDE.md 第 8 条硬约束.

### 3.1 三层分类

```
┌──────────────────────────────────────────────────────────────────┐
│ 容器 (padding 0, margin 0): .appbar / .tab-bar / .agents-layout │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 列容器 (padding 0): .node-col / .list-panel / .detail-panel │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ leaf 项目 (4-10px padding 最小可点可读):               │ │ │
│ │ │   .tab (6px 10px) / .agent-row (4px 10px)              │ │ │
│ │ │   .node-tab (4px 6px)                                   │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │ 文本/cli 输出区 (8-12px 可读 padding 例外):                │ │
│ │   .term-page (settings / usage)                             │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 硬规则

- **严禁** `max-width: NNNpx; margin: 0 auto;` 居中范式. 内容全宽撑满 viewport.
- 导航/列/壳类的 `padding` 和 `margin` 直接显式 `0`.
- leaf 项目 padding 取**可点 hit target (≥ touch baseline 在移动端 44px / 桌面随意)**
  和**可读 (text 不贴 border)**两个约束的最小值.
- 文本 / cli prompt 输出区 (`.term-page`) 是 leaf-content 而非容器, 8-12px padding 是
  例外, 给文字 breathing room.
- 顶级结构元素 (`header`/`nav`/`main`/`section`/`aside`) 全局 reset:
  `margin: 0; padding: 0;` 防 user-agent default 漏出.

### 3.3 反例

```css
/* 反例 1: 居中范式 */
.notif-wrap {
  padding: 8px;
  max-width: 1400px;
  margin: 0 auto;       /* ✗ 居中, 两侧留白 */
}

/* 反例 2: 容器无故 padding */
.term-page {
  padding: 8px 12px;    /* ✗ 容器, 不应有 padding */
}

/* 正例: 容器贴边 */
.notif-wrap {
  padding: 0;
  margin: 0;
}
```

---

## 4. 顶栏 (appbar) — 平直 IDE 风, 拒 macOS 窗口范式

```html
<header class="appbar">
  <span class="brand">pre · CEO</span>            <!-- 左, 蓝色加粗 -->
  <span class="ctx" id="appbar-title">agents</span> <!-- 当前 tab 名, dim -->
  <span class="grow"></span>
  <span id="appbar-token" class="ts">token: -</span>
  <span id="appbar-health" class="health">master ok</span>
  <span id="appbar-clock" class="ts">12:34:56</span>
</header>
<nav class="tab-bar" id="tab-bar">
  <a href="#agents" class="tab active">agents</a>
  ...
</nav>
<main id="app-content" class="terminal-body"></main>
```

### 4.1 必须

- 平直 1px 下边界 (`border-bottom: 1px solid var(--brd)`), **无圆角无阴影**
- 左 brand + ctx (当前页), 中 grow, 右辅助信息
- `padding: 4px 0` 上下保留 row-height, 左右贴边
- brand/ctx/last-child 用 leaf-level 小 padding 防贴边

### 4.2 严禁

- 圆角 (`border-radius`) — 这是桌面 OS 窗口范式
- 投影 (`box-shadow`) — 同上
- "流量灯" 3 个小圆点 (`.wc > .wb` 范式) — 即使灰化也是 macOS Terminal trade dress
- title-bar 渐变 (`linear-gradient(...)`) 模仿 OS chrome
- 居中标题 (`flex: 1; text-align: center`) — 模仿 macOS Finder

---

## 5. tab-bar — 顶部 nav

```css
.tab-bar {
  display: flex;
  background: var(--bg2);
  border-bottom: 1px solid var(--brd);
  padding: 0;                 /* 容器贴边 */
  flex-wrap: wrap;
  flex-shrink: 0;
}
.tab {
  padding: 6px 10px;          /* leaf 可点 padding */
  cursor: pointer;
  color: var(--dim);          /* inactive: dim */
  font-size: 11px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  user-select: none;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.tab:hover { color: var(--txt); background: var(--bgh); }
.tab.active {
  color: var(--blue);
  border-bottom-color: var(--blue);
  background: var(--bg);      /* active 反白 */
}
```

active 信号: text → blue + bottom border → blue + bg → 白 (从 bg2 反白).

---

## 6. 列表项 (`.agent-row` / `.node-tab` / 同款) — 终端 row 范式

### 6.1 通用规范

- **2 行结构**: 第一行主名 (size 11px, color txt), 第二行副数据 (size 10px, color dim)
- 项目高度 ~28-30px (`padding: 4px 6-10px`)
- `border-bottom: 1px solid var(--brdl)` 项间分隔
- `border-left: 2px solid transparent` 占位, active 时切 cyan
- `gap: 2px` 行内紧凑
- `cursor: pointer`, `user-select: none`

### 6.2 active/selected 视觉 — bg + border 双信号, **不用纯边框**

```css
.agent-row.selected,
.node-tab.active {
  background: var(--bg);              /* 反白: 从默认 bg2 灰反到 bg 白 */
  border-left-color: var(--cyan);     /* 左 2px cyan accent */
}
.agent-row.selected .id,
.node-tab.active .name {
  color: var(--cyan);                 /* 主名染 cyan, 配合反白更显眼 */
}
```

**反例**: 仅靠 border 标 active (e.g. `border: 1px solid cyan`) 不够 — 边框对比弱, 视觉
依赖颜色变化.

### 6.3 hover

```css
.agent-row:hover,
.node-tab:hover { background: var(--bgh); }
```

---

## 7. cli prompt 范式 (settings / usage)

`.term-page` 内部用 fn_fe curve 风:

```html
<div class="term-page">
  <pre class="term-block"><span class="sh"># bearer token</span>
  <span class="m">current:</span> <span class="c">sk-••••xxxx</span>
  </pre>

  <div class="cli-row">
    <span class="pa">❯</span>
    <span class="pt">pre token</span>
    <span class="m">set</span>
    <div class="if">
      <input type="password" placeholder="...">
      <button class="ab p">save</button>
    </div>
  </div>

  <pre class="term-result m" id="status">尚未 ping</pre>

  <pre class="term-hints"><span class="sh"># hints</span>
  <span class="m">·</span> ...
  </pre>
</div>
```

### 7.1 必备 class (theme.css 提供)

| class | 用途 |
|-------|------|
| `.pa` | prompt arrow `❯`, cyan |
| `.pt` | 命令名, blue bold |
| `.if` | 紧凑 input/select/.ab 横排表单条 |
| `.ab` | 紧凑按钮 (比 `.btn` 小), 配 `.p` blue primary / `.active` |
| `.term-block` / `.term-hints` | `<pre>` 输出块, dashed border, monospace |
| `.term-result.s/.e/.m` | ping 输出, cyan ok / magenta err / dim default |
| `<pre>` 内行内 span: `.s/.e/.w/.m/.c/.mg/.b/.sd/.sh/.ch` | 终端式染色 |

### 7.2 ASCII 进度条 (usage 用)

```js
const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
```

颜色 class: `.s` (cyan, < 70%) / `.w` (yellow, 70-89%) / `.e` (magenta, ≥ 90%).

### 7.3 status tag 替代 pill

```html
<span class="status-tag s">[ok]</span>          <!-- cyan -->
<span class="status-tag w">[near_limit]</span>  <!-- yellow -->
<span class="status-tag e">[limit_reached]</span> <!-- magenta -->
```

文本风 (方括号) 替代圆角 pill 背景, 更 cli.

---

## 8. 状态点 (`.td`) — 6px 行内圆点

```html
<span class="td td-ok"></span>    <!-- cyan -->
<span class="td td-w"></span>     <!-- yellow -->
<span class="td td-err"></span>   <!-- magenta -->
<span class="td td-unk"></span>   <!-- dim -->
```

`.s` / `.e` / `.w` / `.m` / `.c` / `.mg` / `.b` / `.sd` / `.sh` / `.ch` 是 `<pre>` 内**行内
文本染色** span, 跟 `.td` 不同 (后者是块状指示点).

---

## 9. 状态映射 (status pill / chip)

```
正常活:
  idle / busy / thinking                   → cyan (平静) / yellow (在干活)
  idle_with_proposals                      → yellow (等用户选)

阻塞:
  blocked_user / blocked / error / failed  → magenta (需人介入)

历史:
  stale / offline / unknown                → dim 灰 (沉底, opacity 0.55 可选)
```

**严禁** 红绿. 红色绝对不出现 (用户红绿色弱), `失败 / 错误` 用 magenta.

---

## 10. 黑名单 (看见就 reject)

| 项 | 替代 |
|----|------|
| `font-family: 'Menlo', 'Monaco', ...` | 开源链 (§2) |
| `border-radius: ≥4px` on 顶级 chrome | 平直, 0 圆角 |
| `box-shadow` on chrome | 无 |
| `linear-gradient` 模仿 OS title-bar | 无, 平直 `background: var(--bg2)` |
| `.wc > .wb` 3 圆点 (流量灯范式) | 删除整块 |
| `text-align: center` 在 title 中央 | 左 brand, 右辅助, 不居中 |
| `max-width: NNN; margin: auto` 居中 | 全宽撑满 |
| 注释/文档 "macOS Terminal" / "Apple HIG" / "iOS Safari" | 通用 "cli/terminal" / "mobile UX baseline" |
| `color: red` / `green` / `#ff5f57` / `#28c940` 字面 | cyan/magenta/yellow 变量 |

---

## 11. 实例参考

| 范式 | 文件 |
|------|------|
| 顶栏 + tab-bar | `index.html`, `shared/components.js#appBar` |
| 列表项 (2 行 + active 反白 + 左 cyan border) | `js/agents.js#rowHTML` + `css/agents.css .agent-row .node-tab` |
| cli prompt 范式 | `js/settings.js#TEMPLATE` + `js/usage.js#TEMPLATE` |
| ASCII 进度条 + 状态 tag | `js/usage.js#progressBar/#statusTag` |
| 严禁红绿 + dim 流量灯 (已删) | `shared/theme.css` 历史 commit |

---

## 12. 给 pre_web (及其他 sibling 仓) 的迁移指南

如果你的仓库也是公开开源 + 用户期望与 pre_ui 一致, 按这套指南改造:

1. **配色**: 移除所有 `red` / `green` / `#ff*` / `#28c940` 等字面色, 走 `var(--cyan/magenta/yellow/blue/dim)`
2. **字体**: `font-family` 全改开源链, 移除 Menlo/Monaco/SF/Courier 等
3. **chrome**: 删 `.terminal` / `.title-bar` / `.wc` / `.wb` / `.bc.bm.bx` / `.tt` 等 macOS window 视觉. 改 `.appbar` 平直顶栏
4. **居中**: 删所有 `max-width + margin: auto`. 改全宽
5. **容器 padding**: 导航/列容器 padding/margin → 0
6. **列表项**: 跟 §6 规范一致 (2 行 + 反白 + 左 cyan border)
7. **写一份 `docs/VISUAL_STYLE_GUIDE.md` / `docs/OPENSOURCE_DESIGN_COMPLIANCE.md`** 记录决策, 跟 pre_ui 这两份对齐

迁移后扫一遍:

```bash
# 字体禁词
grep -rniE "font-family[^;]*(menlo|monaco|sf[- ]?mono|sf[- ]?pro|san[- ]?francisco|new[- ]?york|courier)" --include='*.css' .

# 居中范式
grep -rnE "max-width:[^;]+;[^}]*margin:[^;]*auto" --include='*.css' .

# 红绿字面色
grep -rniE "color:[^;]*(red|green|#ff[0-9a-f]{4}|#[0-9a-f]{0,2}[3-8][0-9a-f]00[0-9a-f]{0,2})" --include='*.css' .

# macOS 自陈意图
grep -rniE "macos|apple hig|ios safari|.terminal[ {]|.title-bar" --include='*.css' --include='*.md' --include='*.html' .
```

四条都应当**接近零命中** (仅剩反向声明性引用, 即合规文档里"严禁 X"这类).

---

## 13. 总结公式

```
pre_ui 视觉 = 扁平 IDE chrome
            + cli prompt 内容范式
            + cyan/yellow/blue/magenta 配色
            + 开源 monospace 字体
            + 容器贴边 + leaf 项目最小 padding
            - macOS trade dress
            - Apple 专有字体
            - 红绿
            - 居中范式
```

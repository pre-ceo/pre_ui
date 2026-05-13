# 开源设计合规说明 (Apple trade dress / 专有字体规避)

本文档记录 `pre_ui` 在视觉资产与字体选型上对 **Apple 专有版权 / 商业外观 (trade
dress)** 的主动规避. 目标: 仓库作为公开开源项目分发时, 不引入任何明确侵权风险,
也不留下 "刻意模仿 macOS / iOS UI" 的自陈证据.

---

## 1. 风险背景

| 类别 | 风险 | 案例 |
|------|------|------|
| **字体许可** | **极高** | San Francisco / SF Pro / SF Mono / New York 仅限苹果生态使用; Menlo / Monaco 是 macOS 私有字体; Courier New 是 Microsoft + Adobe 专有 |
| **系统图标** | 高 | SF Symbols, macOS Big Sur 系统图标 — 不可在非 Apple 项目使用 |
| **trade dress** | 中-高 | 流量灯红黄绿配色 (#ff5f57 / #ffbd2e / #28c940), 像素级抄袭 Finder/Terminal 整体布局 |
| **自陈意图** | 中 | 项目文档/注释中 "对齐 macOS Terminal" 类措辞, 在法律纠纷中可被援引为故意复刻证据 |
| **平台元数据** | 低 (公开标准) | `apple-mobile-web-app-*` meta tag, viewport-fit, theme-color — Apple Safari 文档公开发布鼓励使用 |

参考: 苹果对 "界面抄袭" 的法务历来强硬; GitHub DMCA 响应迅速, 一旦被投诉项目可
能直接下架; 严谨企业用户在引入开源组件前会跑许可证扫描, 闭源/侵权资产会被自动
排除.

---

## 2. 全仓 audit (检查时刻)

`grep -rniE "menlo|monaco|courier|san[- ]?francisco|sf[- ]?pro|sf[- ]?mono|new[- ]?york|apple|macos|mac os|iOS|cupertino"` 命中清单
(执行于本次 hardening 前):

| 文件 | 行 | 措辞 | 风险 |
|------|----|------|------|
| `shared/theme.css` | 62 | `font-family: 'Menlo', 'Monaco', 'Courier New', monospace` | 高 |
| `shared/theme.css` | 1 | `fn_fe-aligned macOS Terminal LIGHT` (注释) | 中 |
| `shared/theme.css` | 91 | `macOS terminal window chrome` (注释) | 中 |
| `CLAUDE.md` | 10 | "对齐 macOS Terminal light 主题" | 中 |
| `CLAUDE.md` | 11 | "monospace (Menlo/Monaco)" | 高 |
| `CLAUDE.md` | 68 | "iOS 单页快速 decide UI" | 低 (描述设备类) |
| `CLAUDE.md` | 81 | ".terminal \| macOS 窗口外壳" | 中 |
| `docs/REQUIREMENTS.md` | 36 | "macOS Terminal 暗色风格" | 中 |
| `docs/REQUIREMENTS.md` | 37 | "等宽字体 (Menlo / Monaco)" | 高 |
| `docs/DESIGN_NOTES.md` | 54 | "适合 macOS app 风格" | 中 |
| `docs/DESIGN_NOTES.md` | 167 | "macOS 原生" (Tauri 描述) | 低 |
| `css/mobile.css` | 1-2 | "iOS 单页", "per Apple HIG" | 低 |
| `css/mobile.css` | 7 | "iOS Safari 底部 toolbar" | 低 |
| `css/mobile.css` | 144 | "Apple HIG min" | 低 |
| `css/mobile.css` | 169 | "Apple HIG min" | 低 |
| `js/mobile.js` | 1 | "iOS 单页快速 decide" | 低 |
| `mobile.html` | 7-8 | `apple-mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style` meta | 合规 (W3C/Apple 公开标准) |

---

## 3. 已采取调整

### 3.1 字体链整体替换 (`shared/theme.css`)

**改前**:

```css
font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
```

**改后**:

```css
font-family: ui-monospace, 'Cascadia Mono', 'Source Code Pro',
             'JetBrains Mono', 'DejaVu Sans Mono', 'Liberation Mono',
             Consolas, monospace;
```

| 字体 | 来源 | 许可 |
|------|------|------|
| `ui-monospace` | CSS Fonts L4 关键字 | 浏览器解析, 由 OS 提供默认 monospace; 不引用具体字体名 |
| `Cascadia Mono` | Microsoft (Windows Terminal) | SIL OFL 1.1 |
| `Source Code Pro` | Adobe | SIL OFL 1.1 |
| `JetBrains Mono` | JetBrains | SIL OFL 1.1 |
| `DejaVu Sans Mono` | DejaVu 项目 (Linux 常驻) | 公有/MIT-like (DejaVu license) |
| `Liberation Mono` | Red Hat | SIL OFL 1.1 |
| `Consolas` | Microsoft (Windows 内置) | 专有但用户机器自带, 不打包分发 |
| `monospace` | CSS 通用关键字 | — |

**严格不引用**: Menlo / Monaco / SF Mono / SF Pro / San Francisco / New York /
Courier New / Courier.

### 3.2 注释与文档措辞通用化

全部 `macOS Terminal` / `macOS app 风格` / `macOS 窗口外壳` / `iOS Safari` 等具体平台
表述改为通用术语:

| 改前 | 改后 |
|------|------|
| `macOS Terminal LIGHT` | `terminal LIGHT` |
| `macOS terminal window chrome` | `Terminal window chrome (通用 cli/window pattern, 不复刻任何特定平台)` |
| `macOS 窗口外壳` | `终端窗口外壳 (圆角 + 投影 + title-bar, 通用 cli chrome)` |
| `macOS Terminal 暗色风格` | `通用终端 light 风格 (cli prompt 范式; 不复刻任何特定平台 trade dress)` |
| `等宽字体 (Menlo / Monaco)` | (展开为开源字体链 + 明确禁用规则) |
| `iOS Safari 底部 toolbar` | `移动浏览器底部 toolbar` |
| `iOS 单页快速 decide` | `移动端单页快速 decide` |
| `per Apple HIG` | `mobile UX baseline` |
| `Apple HIG min` | `44px touch target (mobile UX baseline)` |
| `macOS 原生` (Tauri 描述) | `跨平台原生 (macOS/Linux/Windows)` |
| `适合 macOS app 风格` | `适合通用桌面 app 风格` |

### 3.3 窗口 chrome 圆点 (title-bar 流量灯)

形态保留 (横排 3 个小圆点是通用 window/cli chrome 元素, 多个开源 terminal 模拟器
也采用), 但 **配色 + 尺寸** 与任何特定平台脱钩:

- 配色: 统一 `var(--dim)` 中性灰. **严禁** 复刻 Apple 流量灯的 `#ff5f57 / #ffbd2e
  / #28c940` (同时满足项目本身的 "严禁红绿" 规则 — 用户红绿色弱).
- 尺寸: 12px → **10px** (避开 macOS Terminal 标志性的 12-13px 尺寸).
- CSS 注释明确写出 "通用 window/cli 范式, 非任何特定平台独占".

---

## 4. 仍保留的元素 + 合规依据

### 4.1 `mobile.html` 的 Apple meta tag — **保留**

```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
```

合规依据: 这些是 Apple Safari 在 [公开技术文档](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html)
中明确发布并鼓励第三方 web app 使用的 meta tag, 用于在 iOS "添加到主屏幕" 时提
供更原生的体验. 引用这些 meta 名称 ≠ 使用 Apple 资产, 是 web 标准互操作的一部
分.

**未来改进 (nice-to-have, 不阻塞合规)**: 改用 W3C PWA `<link rel="manifest">` +
`manifest.webmanifest` 文件, `apple-mobile-web-app-*` 作为兼容旧 iOS Safari 的
fallback.

### 4.2 `theme-color` / `viewport-fit=cover` meta — **保留**

W3C / CSS Round Display 标准 meta, 不属 Apple 专有.

### 4.3 `.terminal` 圆角 + 投影 + title-bar 整体形态 — **保留**

"带圆角和阴影的窗口" 是通用 GUI 范式, 不专属任何平台 (例如 Linux GNOME / KDE,
Windows 11, Web 上的 Material Design 等均采用类似元素). 整体形态 + 灰色流量灯 +
开源字体后, 与 macOS Terminal 的视觉相似度已大幅下降, trade dress 风险可控.

---

## 5. 后续监控建议

### 5.1 pre-commit / CI lint

在仓库 pre-commit hook (或 CI) 内加一道 grep, 防止专有字体名 / 平台关键词回潮:

```bash
# 禁字体名 (注释中提及为讨论可豁免, 但实际 font-family 内禁止)
if grep -rniE "font-family[^;]*(menlo|monaco|sf[- ]?mono|sf[- ]?pro|san[- ]?francisco|new[- ]?york|courier)" \
   --include='*.css' --include='*.html' . ; then
  echo "FAIL: 禁用专有字体名出现在 font-family 中"
  exit 1
fi

# 禁刻意复刻措辞 (注释和文档)
if grep -rniE "(对齐|复刻|模仿)[^.]*(macos|apple|iOS)" \
   --include='*.css' --include='*.md' --include='*.html' . ; then
  echo "FAIL: 文档/注释中出现刻意复刻 Apple 平台的措辞"
  exit 1
fi
```

### 5.2 上游字体 vendor (可选, 增强 cross-OS 一致性)

如果未来希望脱离用户机器自带字体, 提供更一致的视觉, 可 vendor 一份开源等宽字体
(SIL OFL):

- 推荐: **JetBrains Mono** (https://www.jetbrains.com/lp/mono/) — 专为代码屏幕优
  化, 含 ligatures, SIL OFL 1.1.
- 或: **Cascadia Mono** (https://github.com/microsoft/cascadia-code) — Microsoft,
  SIL OFL.
- 或: **Fira Code** (https://github.com/tonsky/FiraCode) — SIL OFL.

vendor 时:
1. 把 woff2 文件放 `shared/vendor/fonts/`,
2. CSS 用 `@font-face` 引入 + SRI hash,
3. 在仓库根 `LICENSE-fonts` 或 `THIRD_PARTY_LICENSES.md` 内附完整 OFL 文本与字
   体作者署名 (这是 OFL 合规要求),
4. 同时**保留**当前的 `ui-monospace` + 系统字体 fallback 链.

### 5.3 可视化截图自审

任何新页面在 PR review 阶段, 截图与 macOS Terminal / Safari / Finder **左右并排
对比**, 主观上 "一眼可识别为非 Apple 应用" 即过关. 如果视觉过于接近, 调整布局 /
配色 / 间距 重新拉开距离.

---

## 6. 一句话总结

**字体走开源链, 措辞通用化, 配色脱钩 Apple trade dress, meta tag 仅保留 W3C/Apple
公开发布的互操作标准, 文档显式声明"不复刻"立场.** 仓库公开分发不引入明确的版权
/ trade dress 侵权风险.

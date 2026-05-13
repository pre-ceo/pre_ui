# pre_ui — agent 项目说明

零框架浏览器 GUI, 给 [`pre`](https://github.com/pre-ceo/pre)
master 当 CEO 操控台. 在这个仓库工作时遵循以下硬约束.

## 技术栈硬约束 (违反就 reject)

1. **零框架**: 纯 HTML + CSS + vanilla JS, 不引入 React/Vue/Svelte/任何打包器.
2. **配色**: cyan / yellow / blue / magenta + 中性灰. **严禁红绿** (用户红绿色弱).
   设计语言对齐 [`fn_fe`](../fn_fe) curve 终端范式: 白底 light 主题 (#fff + 深灰 #333),
   通用 monospace (ui-monospace + 开源字体链, 见 `theme.css` body), 12px base.
   **不复刻任何特定平台 (e.g. macOS Terminal) 的字体 / 配色 / trade dress** — 字体严禁
   引用 Menlo / Monaco / SF Mono / Courier New 等专有名称; 窗口 chrome 圆点尺寸缩到 10px
   + 配色已脱钩任一平台 trade dress. fn_fe 用红绿表 ok/err, pre_ui 重映射为 cyan/magenta
   — 见 `shared/theme.css` `--ok=cyan / --err=magenta / .s/.e/.td-ok/.td-err`. 合规说明见
   `docs/OPENSOURCE_DESIGN_COMPLIANCE.md`.
3. **DOMPurify 3.2.4 vendored + SRI**: 任何 markdown 渲染必须经 DOMPurify, 整体 hash 校验.
4. **严格 CSP**: `default-src 'self'; connect-src 'self' http://127.0.0.1:19500;`. 禁 inline `<script>`/`<style>`.
5. **Bearer token**: localStorage (key `pre_master_token`) + `type="password"` + autocomplete=off + 掩码显示.
   单用户单机 admin GUI, localStorage 跨重启免重输; 截屏防护仍走 password+mask. 历史 sessionStorage
   值由 `shared/fetch.js` 启动时一次性迁移到 localStorage. 其他 UI 偏好 (selected_agent /
   filter 等) 仍走 sessionStorage (`ssGet/ssSet`), 不混用.
6. **fetch 永远相对路径** `./api/v1/...`, 严禁硬编码 master URL.
7. **不依赖 WebSocket**: 全程轮询 (5s 心跳/agent 列表).
8. **填满优先, 容器零 padding/margin (导航/列/壳类)**:
   - **导航/容器/列** (`.appbar`/`.tab-bar`/`.agents-layout`/`.node-col`/`.list-panel` 等)
     一律贴边 (`padding: 0; margin: 0;`), 严禁 `max-width` + `margin: auto` 居中范式.
     顶 bar / tab-bar / 分组列 / 主区域均贴 viewport 边.
   - **leaf 项目** (`.tab`/`.agent-row`/`.node-tab`) 仅为可点/可读最小必要 padding
     (e.g. `.tab` 6px 10px, `.node-tab` 1px 4px 1px 2px).
   - **文本/cli 输出区** (`.term-page` settings/usage 等) 是 leaf-content 而非容器, 保留
     可读 padding (~8-12px), 不强制贴边.
   - 总则: 不为视觉留白而加 padding/margin; 凡能填满就填满.

## 部署模型

- 浏览器 origin = `http://127.0.0.1:5174`,
- `scripts/fe_server.py` (5174) 内部反代 master 19500,
- 同 origin 完全免 CORS / preflight.

启动顺序 (假设 sibling `pre` 仓库在工作目录上一级, 跟 `pre_ui` 并列):
```bash
bash ../pre/scripts/bus_ctl.sh start           # master + node
bash scripts/fe_ctl.sh start                   # self-proxy + 静态 server
open http://127.0.0.1:5174/agents.html
```

## 文件结构

```
*.html              ← 页面入口 (CSP 强制外置 JS/CSS)
shared/
  theme.css         ← 配色 token + 通用组件 (跨页面共用)
  utils.js          ← fmtTs/ago/esc/poll/ssGet/ssSet/maskToken
  fetch.js          ← preApi (相对路径 + Bearer + JSON)
  components.js     ← preCmp: appBar/healthBeacon/pills/mdRender
  vendor/
    dompurify.min.js
js/                 ← 各页面 JS (CSP 强制外置)
css/                ← 各页面样式 (CSP 强制外置 inline <style>)
scripts/
  fe_server.py      ← static + /api 反代 (~150 行 stdlib)
  fe_ctl.sh         ← tmux 生命周期
docs/               ← 需求/设计/API 镜像
```

## 命名约定

- 全局命名空间: `window.preUtils`, `window.preApi`, `window.preCmp` (一致小写 `pre`)
- token 默认值: `pre` (placeholder, 改在 settings.html)

## SPA hash router

`index.html` = SPA 单壳 (terminal+title-bar+tab-bar 静态 HTML), `shared/router.js` 监听
`hashchange` 在 `#app-content` 内 mount/unmount 当前 tab 模块.

- 默认 hash: `#home`. 路由表见 `shared/router.js` `TABS`.
- `#pending` 不在 tab-bar (Phase B 推后), 仅 hash 直链可达.
- 每个 `js/<page>.js` 注册 `window.preApp[key] = { init }`. `init(host)` 把 TEMPLATE
  注入 host, 绑定 handler, 起 polling, 返回 `unmount` 函数 (stop poll + 解绑 document/window listener).
- `mobile.html` / `js/mobile.js` 不入 SPA — 移动端单页快速 decide UI, 独立路由.
- 老 `<page>.html` 入口仍可独立访问 (deep-link 迁移期); 各 page JS 通过
  `if (!document.getElementById('app-content')) { ... C.appBar(key); init(); }` fallback 保留行为.
- 写新 tab: (1) 加 `js/<page>.js` 走 init/unmount + preApp 注册套路, (2) 在 `index.html`
  的 `.tab-bar` 加 `<a href="#<key>" data-route="<key>">…</a>` + `<script src="js/<page>.js">`,
  (3) `shared/router.js` 的 `TABS` 加 key. CSS 走 `<link rel="stylesheet" href="css/<page>.css">`.

## 设计语言 (fn_fe curve 对齐)

theme.css 暴露一组终端范式组件, 写新页面优先复用:

| 类 | 用途 |
|----|------|
| `.terminal` | 终端窗口外壳 (圆角 + 投影 + title-bar, 通用 cli chrome) — appbar 已用 |
| `.title-bar` + `.wc/.wb`/`.tt`/`.ts` | 标题栏 (流量灯灰化 / 居中标题 / 时钟) |
| `.tab-bar` + `.tab` (`.active`) | 顶部 tab, 替代旧 `.appbar .nav` |
| `.td` (`-ok` cyan / `-err` magenta / `-w` yellow / `-unk` 灰) | 6px 状态点 |
| `.if` | 紧凑 input/select/.ab 横排表单条 |
| `.ab` (`.p` blue primary / `.active`) | 比 `.btn` 小一档的工具按钮 |
| `.ebox` | 错误盒 (magenta, 严禁红) |
| `.pl` + `.pa`/`.pt`/`.cur` | 命令行 prompt 行 + 闪烁光标 |
| `.sp` | 8 帧 braille spinner (JS 在 80ms 间隔轮换) |
| `<pre>` 内行内 span: `.s/.e/.w/.m/.c/.mg/.b/.sd/.sh/.ch` | 终端式输出染色 (`.s`=cyan/`.e`=magenta) |

## 安全模型

| 风险 | 缓解 |
|------|------|
| markdown XSS | DOMPurify + 显式 ALLOWED_TAGS/ATTR + FORBID style/script/iframe/form |
| inline JS 注入 | CSP `script-src 'self'`, 全部脚本外置 |
| token 泄露 | localStorage (本机绑定) + `type="password"` + autocomplete=off + 掩码 |
| 三方资源篡改 | DOMPurify SRI hash |
| master URL 劫持 | 一律相对路径, 同 origin self-proxy |
| clickjacking | CSP `frame-ancestors 'none'` |

## 修改建议

1. 改 fetch 接口必经 `shared/fetch.js` (统一加 Bearer + 错误处理).
2. 任何 markdown 渲染必经 `preCmp.mdRender` (走 DOMPurify).
3. 加新页面时 4 件套:
   - `<page>.html` (CSP meta 完整, 引用 `shared/*` + `js/<page>.js` + `css/<page>.css`)
   - `js/<page>.js` (顶层 IIFE 拿 `preUtils/preApi/preCmp`)
   - `css/<page>.css` (页面专属)
   - 在 `index.html` nav 加链接
4. polling 间隔 ≥5s, 不要更密 (master 后端非高频 API).
5. fe_server.py 反代不透传 hop-by-hop headers (RFC 7230); 4xx/5xx 透传给浏览器.

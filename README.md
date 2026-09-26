# dsh-effort-slider

把 DSH（DeepSeek Harness）官方模型菜单里的「推理等级 / Effort」下拉单选列表，
替换为 **Codex / Claude Code 风格连续滑块 + 流光粒子动效**（WebGL2）。
面板配色**恒定跟随官方 Harness 主题**——官方「外观」切浅色/深色时，滑块面板实时跟随，
无需单独设置外观（避免两套设置）。

> 零外部依赖：`dsh plugin add dsh-effort-slider` → 重启，即可使用。

## 特性

- **连续滑块**：点输入框的模型选择器 → 菜单 → 点「推理等级」行，弹出 Codex 风格浮动卡片
  - 渐变发光卡片 + OFF → MAX 刻度标签 + 档位圆点
  - 连续拖拽：同档位去重 + 在途合并 + 120ms 降频写回（不会每帧打后端），松手必定落地并吸附最近档位
  - 轨道内 WebGL2 **流光粒子**动效：流动光线流 + 行进亮点粒子 + 拖尾 + 前沿光波，
    亮度随档位增强，紫 / 青 / 白极光色系；粒子与像素场右缘始终贴着滑块末端
  - **像素场（Low / High / MAX）**：首个像素档（官方 4 档下为 Low）及以上轨道变为动画像素场
    （扫过式显现 + 流动闪烁），色板随档位两段式平滑过渡：Low **绿** → High **蓝** → MAX **紫**；
    另有流动多彩渐变文字与紫色渐变轨道底
- **跟随官方主题**：面板配色直接绑定官方 Harness 主题（`theme/change` 实时切换）
  - 官方「外观」切浅色/深色时滑块面板同步切换；深色下背景转深紫黑、轨道转深紫灰
    （紫系圆点/描边、screen 发光流光），浅薰衣草渐变滑块头
  - 无需单独设置外观——不再提供浅色 / 深色 / 跟随系统三选，避免两套设置
- 模型切换后档位列表自动跟随；面板字体继承 Harness 全局字体
- 官方后台刷新模型目录（`llm/adapters-updated` / `settings/document-updated` 等）时不打断拖动：
  保留上一次成功的数据继续渲染，只有从未加载成功过才显示「模型目录加载中…」

## 安装

> **先选对 profile**：`dsh web`（浏览器 CLI）用 `web`；**DSH Desktop 桌面应用用 `desktop`**。
> 装错 profile 时插件不会加载（`__DSH_BOOT__` 里搜不到条目）。
> 不确定时先 `dsh plugin list --profile <名字>` 或查看 `~/.dsh/profiles/` 下有哪些目录。

### 从 npm 安装（推荐）

```sh
# dsh web（浏览器 CLI）
dsh plugin --profile web add dsh-effort-slider
# DSH Desktop 桌面应用
dsh plugin --profile desktop add dsh-effort-slider
```

> **供应链策略提示**：pnpm 11 默认开启「最小发布时长」检查（`minimumReleaseAge` 默认 1440 分钟 ≈ 1 天），
> 当天发布的包（含本插件新版本及 dshmarket 等依赖）在 24 小时内可能被拒绝安装。
> 两种处理方式：
> 1. 将包名加入 profile 的 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 列表永久豁免
>    （注意：同一包名只保留**一条**条目，多条精确版本条目时 pnpm 只认第一条，见下方示例）；
> 2. 安装时临时放宽：`dsh plugin --profile desktop add dsh-effort-slider --config.minimumReleaseAge=0`
>
> 示例（`minimumReleaseAgeExclude` 中同包名合并为一条，避免版本歧义）：
> ```yaml
> minimumReleaseAgeExclude:
>   - dshmarket          # 豁免所有版本（不要同时写 dshmarket@1.9.0 和 dshmarket@1.11.0 两条）
>   - dsh-effort-slider
> ```
> 策略名称与门控可能随 pnpm/DSH 版本变化，`pnpm config get minimumReleaseAge` 可查看当前值。

### 从仓库安装（开发）

```sh
git clone https://github.com/Samlingthinker/dsh-effort-slider
cd dsh-effort-slider
# 桌面应用
dsh plugin --profile desktop add link:$(pwd)
# dsh web
dsh plugin --profile web add link:$(pwd)
```

Windows 上 link 目标用绝对路径：`dsh plugin --profile desktop add link:D:\path\to\dsh-effort-slider`

重启 DSH Desktop / `dsh web` 后生效（宿主半边与客户端 bundle 均需重启注入）。

### 卸载与禁用

卸载：`dsh plugin --profile desktop remove dsh-effort-slider`（`web` profile 同理）
禁用（保留包）：在对应 profile 的 `cordis.patch.yml` 写入

```yaml
- id: ui-effort-slider
  disabled: true
```

## 结构

| 文件 | 说明 |
|---|---|
| `lib/index.js` | 宿主半边（零依赖）：空 `apply`，仅用于 `cordis.patch.yml` 注册 |
| `lib/client.js` | 浏览器端：点击拦截 + EffortPanel + WebGL2 三pass 流光渲染；面板配色跟随官方主题 |
| `cordis.patch.yml` | 注册 `ui-effort-slider` 宿主行 |
| `scripts/test-client.mjs` | 客户端冒烟测试（`npm test`）：驱动发布产物，覆盖当前会话解析、点击拦截、EffortPanel 主体（渲染 / 写档位 / 异常路径）、发布面契约；不随 npm 包发布 |
| `scripts/check-compat.mjs` | 上游兼容性自检（零依赖，仅 npm + tar）；不随 npm 包发布 |

## 开发

无构建步骤：`lib/` 即发布产物（客户端为 `window.__ModuleLoader__` bundle，
由 DSH 宿主打包注入；宿主为普通 ESM，仅依赖 Node 内置模块）。

### 上游兼容性自检

插件依赖官方包的少量接口面：`theme/change` 事件 + `getTheme().active.colorScheme`
（主题跟随）、`sessions` 快照（当前会话 id）、官方 `modelDirectories` 服务的
`directoryFor` / `store` / `select`（模型目录与档位读写）、官方模型菜单的
`menuitem` + `cellLabel` + 「推理等级」文案（点击拦截）。
官方 DSH 发新版后，两条命令复查：

```sh
npm test                           # 客户端冒烟测试：驱动 lib/client.js（解析/拦截/面板主体/写档位/契约）
npm run check:compat               # 各包自动取最新 rc 版本
node scripts/check-compat.mjs 0.1.7-rc.2   # 四个包统一钉到指定版本（也可传 alpha 看开发线）
node scripts/check-compat.mjs --local "<DSH Desktop>\resources\app\node_modules\@deepseek-ai"
                                   # 直接扫本机已安装的上游包（DSH Desktop 随包发布的那份），不走网络
```

自检分两段：**插件侧接口面扫描**（`lib/client.js` 里是否还写着官方已删除的接口、
是否缺当前版本必需的判定标记、`dsh.client.inject` 是否齐全）+ **上游包标记扫描**。
上游标记一律取「形状锚点」而不是裸词（同一形状迁移时用 `expectOneOf` 给出两代备选）——
例如 sessions 一项断言 `retainedBy` / `current: void 0` / `currentAddress`，
因为裸词 `current` 在包里出现上百次，拿它当标记的检查永远不可能失败。
退出码非 0 即有漂移。注意标记扫描只认字符串存在，语义变化要靠 `npm test` 的行为回归兜住——
两者缺一不可。脚本零依赖（仅需 npm 与 tar，Windows 10 1803+ 自带），不随 npm 包发布。

## 兼容性

- **插件 1.3.0 支持官方 DSH 0.1.2 → 0.1.7**（同一份 bundle 两代并存）：
  - **0.1.6-alpha.2 起**（0.1.7-rc 线同样）「当前会话」改为官方主视图 retain 判定
    （`sessions.list.byId[*].retainedBy.mainView > 0`），1.3.0 已适配
  - 0.1.2–0.1.5 走旧的 `sessions.list` 快照 `current` 字段，仍可用
  - 版本边界是实测的：`0.1.2-rc.1` / `0.1.5-rc.3` 的 lib 里还有 `current: void 0` 且没有
    `retainedBy`；`0.1.6-alpha.2` / `0.1.7-rc.2` 正好相反
- 官方 0.1.1 及更早版本请使用插件 1.1.0（`connection.api.sessions` 旧接口面）
- 官方 DSH Desktop 桌面应用（`desktop` profile）与 DSH web profile（`npx @deepseek-ai/dsh web`），Windows / macOS / Linux
- 需要 WebGL2 支持（流光粒子）；不支持时滑块功能降级可用

## 变更记录

### 1.3.1

- **修复（性能）**：快速拖动卡顿。旧实现按 16ms 节流写档位，而 60fps 拖动的事件间隔就是
  16.7ms —— 等于**每一帧都写一次 host**（实测 1 秒拖动 = 61 次 `selectModel` + 122 次
  store 通知，每次通知都会整棵重渲面板）。改为**同档位去重 + 在途合并**（同一时刻只允许
  一个写入在途，其间变化只保留最新值，落地后补发）+ **120ms 降频**，松手强制落地；
  同一场景实测降到 **2 次写入 / 4 次通知**
- **修复**：拖动中偶现「模型目录加载中…」并把滑块 `disabled`（拖动当场被打断）。官方会在
  `llm/adapters-updated`、`settings/document-updated`、`credentials/*-updated`、
  `connection/reset` 时刷新模型目录（catalog.invalidate → 目录快照短暂变 `loading/idle`），
  旧实现只要目录不是 `ready/selecting` 就整块面板不可用；现在保留最近一次成功的数据继续
  渲染，只有「从未加载成功过」才显示加载中
- **修复**：松手瞬间（旧实现的 50ms 时间窗内）换档位时，最后一次写入会被吞掉；改为按
  档位 id 去重——换档位即时落地、同档位不重复写（pointerup + blur 也不会连写）
- **测试**：客户端冒烟测试 45 → **54 条断言**，新增「1 秒快速拖动写入 ≤ 3 次（旧实现 61 次）」
  「目录重载中不显示加载中 / 不禁用 / 仍能写档位」「同档位去重 + 换档位必写」等回归；
  测试桩件升级为**保状态 React**（`useRef`/`useState` 跨渲染保留）——否则依赖跨渲染状态的
  用例（如目录 last-good 缓存）会在桩里假通过

### 1.3.0

- **修复**：适配官方 DSH 视图选择重构——「当前会话」不再来自 `sessions.list` 快照的
  `current` 字段（**0.1.6-alpha.2 起**视图选择移出 sessions 控制器，0.1.7-rc 线同样），
  改为「被主视图 retain 的会话」`list.byId[*].retainedBy.mainView > 0`，与官方 ui-layout /
  ui-workspace / ui-session / ui-settings-general 同款判定。此前取不到会话 id 时点「推理等级」
  行会静默不弹面板（0.1.6 开发线起即已失效，0.1.7 正式线暴露）
- **兼容**：`currentSessionId()` 两代并存——`≤0.1.5` 读 `list.current`，
  `0.1.6-alpha.2+` 走 retain 判定，一份 bundle 同时支持 0.1.2 → 0.1.7
- **加固**：官方 `directoryFor()` 对未知会话（解析不到 scope/binding）直接抛出；
  现在兜底显示「模型目录加载失败：会话未就绪」，不再让 React 卸载整棵面板
- **修复**：`dsh.client.inject` 补回 `@deepseek-ai/dsh-api-session-controller`
  （插件使用的 `sessions` 服务由它提供）
- **自检**：`scripts/check-compat.mjs` 新增插件侧接口面扫描（残留已删除接口 / 缺必需标记 /
  注入面缺失都会报错）与 `--local <包目录>` 模式（直接扫 DSH Desktop 随包发布的上游，不走网络）；
  sessions 一项改为形状锚点三选一命中（`retainedBy` / `current: void 0` / `currentAddress`），
  替换掉"裸词 `current` 永远命中"的假检查（已用合成漂移树验证它会 exit 1 报错）
- **测试**：`scripts/test-client.mjs`（`npm test`，45 条断言）——直接加载发布产物
  `lib/client.js`，用桩 hook 真实执行 `EffortPanel` 主体，覆盖两代快照形状的当前会话解析、
  capture 阶段点击拦截、拖动写档位与松手吸附去重、目录未就绪/失败/`directoryFor` 抛出的兜底、
  `theme/change` 重渲，以及 manifest 注入面与 `./client` 入口。四种「修复前写法」的变异
  （回到 `getSnapshot().current`、去掉兜底、去掉松手吸附、改成冒泡阶段）分别被 20/3/1/1 条
  断言抓住；核心用例在修复前即失败

### 1.2.0

- **修复**：适配官方 DSH 0.1.2 重构（apiproxy 拆分为 api-gateway / api-remotes /
  api-session-controller 等），插件在 0.1.2 线上完全失效的问题
  - `dsh.client.inject` 引用的 `@deepseek-ai/dsh-client-runtime` 已被官方移除
    （由 `@deepseek-ai/dsh-client-modules` 接替），导致插件模块图组装失败、整体不加载
  - `connection.api.sessions.models / selectModel` 接口面已被官方拆除，
    改用官方模型菜单同款 `modelDirectories` 服务（`directoryFor(sessionId)` +
    `store` 读目录/当前档位 + `select()` 写档位），与官方模型席位共享同一份状态
- **自检**：`scripts/check-compat.mjs` 检查面同步迁移到新接口
  （`dsh-client-connection` / `dsh-host-apiproxy` 两项移除，新增
  `dsh-api-session-controller` 与 `dsh-client-modules`）

### 1.1.0

- **行为**：面板配色改为**恒定跟随官方 Harness 主题**——官方「外观」切浅色/深色时，
  滑块面板经 `theme/change` 事件实时同步；不再提供插件自带的浅色 / 深色 / 跟随系统外观设置
  （避免两套外观设置的重复）
- **修复**：跟随官方深色模式时面板正确切深色（此前 `system` 档恒走浅色的 bug 一并消除）
- **清理**：移除设置分区、宿主 `/_dsh/effort-slider/settings` 路由、`DSH_HOME/effort-slider.json`
  持久化与旧版迁移逻辑，以及相关 locale / CSS
- **注意（行为变更）**：升级后插件不再提供自带的外观设置，面板配色只跟随官方 Harness 主题；
  若你此前手动设置过插件配色，该设置将被忽略（以官方主题为准）

### 1.0.5

- **功能**：适配官方新增 `low` 档（rc.7 起推理档位为 Off / Low / High / Max 四档），
  Low 成为首个像素档，轨道在 Low 及以上档位呈现动画像素场
- **功能**：色板两段式连续过渡——Low 绿 → High 蓝 → MAX 紫，
  Low→High 与 High→MAX 各按 smoothstep 平滑插值，拖动全程无硬切

### 1.0.4

- **文档**：供应链策略提示改为实测结论，说明 `minimumReleaseAgeExclude` 同包名多版本条目
  的歧义问题（pnpm 只认第一条匹配规则），并给出推荐写法

### 1.0.3

- **修复**：外观设置保存失败时按钮不再假选中，回滚原值并展示错误原因
- **修复**：`expectedRevision` 未加载时的保存竞态（避免被宿主以 400 拒绝）
- **修复**：`dsh.client.inject` 补齐 `dsh-client-connection` / `dsh-client-ui-settings` 依赖声明
- **修复**：菜单拦截不再依赖硬编码整行文本，优先匹配官方 `cellLabel` 结构标签
- **修复**：滑块松手后始终吸附到档位刻度（去重逻辑不再跳过 UI 吸附）
- **修复**：流光回退到 Off 时等待弹簧收敛，尾光衰减不再被截断
- **修复**：模型目录加载失败时展示具体错误，而非永远停在「加载中…」
- **修复**：完整支持 `prefers-reduced-motion`（静态帧，不启动动画循环；含 MAX 渐变文字动画）
- **修复**：滑块增加 `aria-label` / `aria-valuetext` 无障碍标注
- **清理**：移除发布版中的调试日志

### 1.0.2

- 安装说明对齐社区格式（npm 安装 + 仓库安装两节）

### 1.0.1

- 安装说明改为 npm registry 优先，补充 repository 元数据

## 许可证

本项目代码以 [BSD-3-Clause](LICENSE) 发布。第三方派生部分按来源许可证声明：

- **面板结构与 WebGL 流光渲染管线**派生自
  [`@captain1275/dsh-client-ui-skin-aurora`](https://github.com/CAPTAIN1275/dsh-ui-web)
  —— npm 包声明 BSD-3-Clause；源码仓库 LICENSE 为 Apache-2.0
  （Copyright 2026 zhu1090093659 (linxin), CAPTAIN1275）。
- **High/MAX 像素场**派生自
  [`DSH-Claude-Style-Reasoning-Slider`](https://github.com/MEMZ-JZY/DSH-Claude-Style-Reasoning-Slider)
  —— MIT（Copyright (c) 2026 MEMZ-鱼子酱）。

完整第三方声明与许可证全文见 [LICENSE](LICENSE)。

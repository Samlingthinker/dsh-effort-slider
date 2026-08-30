# dsh-effort-slider

把 DSH（DeepSeek Harness）官方模型菜单里的「推理等级 / Effort」下拉单选列表，
替换为 **Codex / Claude Code 风格连续滑块 + 流光粒子动效**（WebGL2）。
面板配色**恒定跟随官方 Harness 主题**——官方「外观」切浅色/深色时，滑块面板实时跟随，
无需单独设置外观（避免两套设置）。

> 零外部依赖：`dsh plugin add dsh-effort-slider` → 重启，即可使用。

## 特性

- **连续滑块**：点输入框的模型选择器 → 菜单 → 点「推理等级」行，弹出 Codex 风格浮动卡片
  - 渐变发光卡片 + OFF → MAX 刻度标签 + 档位圆点
  - 连续拖拽，拖动中实时写回档位（16ms 节流），松手吸附最近档位
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

## 开发

无构建步骤：`lib/` 即发布产物（客户端为 `window.__ModuleLoader__` bundle，
由 DSH 宿主打包注入；宿主为普通 ESM，仅依赖 Node 内置模块）。

## 兼容性

- 官方 DSH Desktop 桌面应用（`desktop` profile）与 DSH web profile（`npx @deepseek-ai/dsh web`），Windows / macOS / Linux
- 需要 WebGL2 支持（流光粒子）；不支持时滑块功能降级可用

## 变更记录

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

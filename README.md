# dsh-effort-slider

把 DSH（DeepSeek Harness）官方模型菜单里的「推理等级 / Effort」下拉单选列表，
替换为 **Codex / Claude Code 风格连续滑块 + 流光粒子动效**（WebGL2），
并在设置页提供独立分区「推理滑块」，可调 **浅色 / 深色 / 跟随系统** 外观。

> 零外部依赖：克隆本仓库 → `dsh plugin add` → 重启，即可使用。

## 特性

- **连续滑块**：点输入框的模型选择器 → 菜单 → 点「推理等级」行，弹出 Codex 风格浮动卡片
  - 渐变发光卡片 + OFF → MAX 刻度标签 + 档位圆点
  - 连续拖拽，拖动中实时写回档位（16ms 节流），松手吸附最近档位
  - 轨道内 WebGL2 **流光粒子**动效：流动光线流 + 行进亮点粒子 + 拖尾 + 前沿光波，
    亮度随档位增强，紫 / 青 / 白极光色系；粒子与像素场右缘始终贴着滑块末端
  - **High / MAX 像素场**：High 及以上档位轨道变为动画像素场（扫过式显现 + 流动闪烁），
    色板随档位从蓝平滑过渡到紫；另有流动多彩渐变文字与紫色渐变轨道底
- **外观设置**：设置 → 「推理滑块」，浅色 / 深色 / 跟随系统 三选
  - 深色下背景转深紫黑、轨道转深紫灰（紫系圆点/描边、screen 发光流光），浅薰衣草渐变滑块头
  - 「跟随系统」随 Harness 主题实时切换
- 模型切换后档位列表自动跟随；面板字体继承 Harness 全局字体

## 安装（desktop profile）

```bash
# 1. 克隆仓库（或直接下载 zip 解压）
git clone <your-repo-url> dsh-effort-slider

# 2. 安装到 desktop profile（参数给仓库根目录）
dsh plugin --profile desktop add D:\path\to\dsh-effort-slider
```

安装后**重启 DSH Desktop**（宿主半边与客户端 bundle 均需重启注入）。

卸载：`dsh plugin --profile desktop remove dsh-effort-slider`
禁用（保留包）：在 `~/.dsh/profiles/desktop/cordis.patch.yml` 写入

```yaml
- id: ui-effort-slider
  disabled: true
```

## 配置存储

- 外观偏好存于 `DSH_HOME/effort-slider.json`（默认 `~/.dsh/effort-slider.json`），
  与 `pet.json` 同模式，跟随用户主目录持久化。
- 官方 `settings.mutate` RPC 只对白名单命名空间开放（`settings-not-exposed`），
  第三方插件无法用 settingsScope 写自定义命名空间；因此本插件在宿主半边
  零依赖挂载同源路由 `/_dsh/effort-slider/settings`，浏览器经该路由读写。
- 升级自旧版（偏好曾存于 settings.yaml 的 `effort-slider` 命名空间）时，
  首次运行会自动迁移到新 JSON 文件，无需手动处理。

## 结构

| 文件 | 说明 |
|---|---|
| `lib/index.js` | 宿主半边（零依赖）：`/_dsh/effort-slider/settings` GET/POST 同源路由 + JSON 持久化 + 旧版迁移 |
| `lib/client.js` | 浏览器端：点击拦截 + EffortPanel + WebGL2 三pass 流光渲染 + 设置分区（外观三选） |
| `cordis.patch.yml` | 注册 `ui-effort-slider` 宿主行 |

## 开发

无构建步骤：`lib/` 即发布产物（客户端为 `window.__ModuleLoader__` bundle，
由 DSH 宿主打包注入；宿主为普通 ESM，仅依赖 Node 内置模块）。

## 兼容性

- DSH Desktop（desktop profile），Windows / macOS / Linux
- 需要 WebGL2 支持（流光粒子）；不支持时滑块功能降级可用
- 设置路由依赖宿主 webServer 服务（desktop/web profile 均内置）

## 许可证

[BSD-3-Clause](LICENSE)。面板结构与 WebGL 管线派生自
[`@captain1275/dsh-client-ui-skin-aurora`](https://github.com/CAPTAIN1275/dsh-ui-web)（BSD-3-Clause）；
High/MAX 像素场派生自
[`DSH-Claude-Style-Reasoning-Slider`](https://github.com/MEMZ-JZY/DSH-Claude-Style-Reasoning-Slider)（MIT），
详见 LICENSE 中的 Attribution。

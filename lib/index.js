/**
 * dsh-effort-slider host half — 零外部依赖。
 *
 * 本插件不再需要宿主半边提供任何设置项：面板配色恒定跟随官方主题
 * （theme.getTheme().active.colorScheme），由浏览器端在 `theme/change`
 * 事件时实时重渲。宿主半边仅保留一个空的 apply，以便 cordis.patch.yml
 * 正常注册（insert id: ui-effort-slider），其余逻辑全部在客户端 bundle 中。
 */

/** 稳定插件名（对应 cordis.patch.yml 的 insert id）。 */
const name = "ui-effort-slider";

function apply(_ctx) {
	// 无宿主逻辑：客户端 bundle 已独立完成面板渲染与官方主题跟随。
}

export { apply, name };

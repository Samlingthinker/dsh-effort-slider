#!/usr/bin/env node
/**
 * dsh-effort-slider 客户端冒烟测试（零依赖，node scripts/test-client.mjs）。
 *
 * 直接加载发布产物 lib/client.js —— 用 __ModuleLoader__ 捕获它的工厂函数，
 * 再用桩件替换 react / react-dom/client / react/jsx-runtime 与最小 DOM，
 * 于是可以在没有浏览器的情况下真实执行 apply(ctx)、派发一次点击事件，
 * 并（用桩 hook）真实执行 EffortPanel 主体。
 *
 * 覆盖的历史事故：官方 0.1.6-alpha.2 起（0.1.7-rc 线同样）把 `sessions.list` 快照的
 * current 字段删掉后，插件取不到当前会话 → 面板静默不弹（本测试在修复前会失败）。
 *
 * 已覆盖：
 *   - 当前会话解析（两代官方快照形状）
 *   - 点击拦截（capture 阶段 + preventDefault/stopPropagation + 正确会话 id）
 *   - EffortPanel 主体：render、目录就绪/加载中/失败/单档、directoryFor 抛出兜底、
 *     拖动写档位（select）与松手吸附去重
 *   - 发布面契约：inject、manifest 注入面与 ./client 入口
 *
 * 未覆盖（需要真实浏览器 / React / 上游包）：真实 DOM 与 portal 结构、React 渲染与
 * 状态更新时序、WebGL/2D 画布绘制、真实官方 bundle 的联调。
 *
 * 退出码：0 = 全部通过；1 = 有用例失败。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.js");
const manifestPath = join(here, "..", "package.json");

let failed = 0;
const check = (name, ok, detail) => {
	if (ok) {
		console.log(`  ✓ ${name}`);
		return;
	}
	failed++;
	console.log(`  ✗ ${name}${detail === void 0 ? "" : ` —— ${detail}`}`);
};

//#region 桩件：确定性时钟 + 最小 DOM + react
/** 固定时钟：档位写入有 16ms/50ms 节流与去重，用假时钟才能稳定断言。 */
let fakeNow = 1_000_000;
Object.defineProperty(globalThis, "performance", { value: { now: () => fakeNow }, configurable: true });

class FakeElement {
	constructor(tag) {
		this.tagName = tag;
		this.dataset = {};
		this.style = {};
		this.children = [];
		this.textContent = "";
	}
	appendChild(child) {
		this.children.push(child);
		return child;
	}
	remove() {}
	contains() {
		return false;
	}
	querySelector() {
		return null;
	}
	getBoundingClientRect() {
		return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
	}
}

const listeners = [];
const styleTags = [];
globalThis.HTMLElement = FakeElement;
globalThis.document = {
	body: new FakeElement("body"),
	head: new FakeElement("head"),
	createElement: (tag) => {
		const el = new FakeElement(tag);
		if (tag === "style") styleTags.push(el);
		return el;
	},
	querySelector: () => null,
	addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }),
	removeEventListener: () => {}
};

const rendered = [];
/** useState 的 setter 调用记录（断言松手吸附用）。 */
const hookWrites = { values: [] };
const reactStub = {
	createElement: (type, props) => ({ type, props }),
	useState: (init) => [
		init,
		(value) => {
			hookWrites.values.push(value);
		}
	],
	useRef: (init) => ({ current: init }),
	useEffect: () => {},
	useLayoutEffect: () => {},
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
};
const reactDomStub = {
	createRoot: () => ({
		render: (element) => rendered.push(element),
		unmount: () => rendered.push({ type: "unmount" })
	})
};
const jsxStub = {
	jsx: (type, props) => ({ type, props }),
	jsxs: (type, props) => ({ type, props }),
	Fragment: Symbol("Fragment")
};
const stubRequire = (specifier) => {
	if (specifier === "react") return reactStub;
	if (specifier === "react-dom/client") return reactDomStub;
	if (specifier === "react/jsx-runtime") return jsxStub;
	throw new Error(`unexpected require("${specifier}")`);
};
//#endregion

//#region 捕获并物化 bundle
let registration;
globalThis.window = {
	__ModuleLoader__: {
		load: (value) => {
			registration = value;
		}
	},
	innerWidth: 1200,
	innerHeight: 800
};

await import(pathToFileURL(bundlePath).href);

if (registration === void 0) {
	console.error("lib/client.js 没有通过 __ModuleLoader__.load 注册模块");
	process.exit(1);
}
if (registration.id !== "dsh-effort-slider") {
	console.error(`模块 id 不是 dsh-effort-slider，而是 ${registration.id}`);
	process.exit(1);
}
const bundle = registration.factory(stubRequire);
//#endregion

//#region 测试工具
const EFFORTS = [
	{ id: "off", name: "Off" },
	{ id: "low", name: "Low" },
	{ id: "high", name: "High" },
	{ id: "max", name: "Max" }
];

/** 官方 0.1.6+ 形状的当前会话：主视图 retain 的那一行。 */
function sessionsWithMain(sessionId = "session-1") {
	return {
		list: {
			getSnapshot: () => ({
				ids: [sessionId],
				byId: { [sessionId]: { id: sessionId, retainedBy: { mainView: 1 } } },
				phase: "ready"
			})
		}
	};
}

const theme = { getTheme: () => ({ active: { colorScheme: "light" } }) };

/**
 * 官方 modelDirectories 目录桩件（形状取自 0.1.7 的 ModelDirectory.store）。
 * @param overrides - 覆盖快照字段（status/error/current/groups）。
 */
function fakeDirectory(overrides = {}) {
	const selectCalls = [];
	const snapshot = {
		status: "ready",
		error: null,
		current: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "low" },
		groups: [
			{
				id: "deepseek-official",
				models: [
					{
						id: "deepseek-v4-flash",
						name: "Flash",
						reasoning: { defaultEffort: "low", efforts: EFFORTS }
					}
				]
			}
		],
		...overrides
	};
	return {
		selectCalls,
		directory: {
			store: { getSnapshot: () => snapshot, subscribe: () => () => {} },
			load: () => Promise.resolve(snapshot),
			select: (selection) => {
				selectCalls.push(selection);
				return Promise.resolve({ ok: true });
			}
		}
	};
}

/** 用给定的服务桩件挂载插件，返回派发点击 / 执行面板 / 读取监听器信息的句柄。 */
function mount(services) {
	rendered.length = 0;
	listeners.length = 0;
	hookWrites.values = [];
	const offs = [];
	const handlers = new Map();
	const ctx = {
		effect: (callback) => {
			const dispose = callback();
			if (typeof dispose === "function") offs.push(dispose);
		},
		get: (name) => services[name],
		on: (event, handler) => {
			handlers.set(event, handler);
			offs.push(() => {});
			return () => {};
		}
	};
	bundle.apply(ctx);
	const click = listeners.find((entry) => entry.type === "click");
	if (click === void 0) throw new Error("插件没有注册 document click 监听器");
	return {
		/** 官方菜单行点击时注册的监听器是否在 capture 阶段（preventDefault 生效的前提）。 */
		clickCapture: click.capture,
		fire: (target) => {
			let prevented = false;
			let stopped = false;
			click.handler({
				target,
				preventDefault: () => {
					prevented = true;
				},
				stopPropagation: () => {
					stopped = true;
				}
			});
			return { prevented, stopped };
		},
		/** 触发插件注册的 ctx 事件（例如官方 theme/change）。 */
		emit: (event, ...args) => {
			const handler = handlers.get(event);
			if (handler === void 0) throw new Error(`插件没有注册 ${event} 监听`);
			return handler(...args);
		},
		/** 真实执行最近一次渲染的 EffortPanel 主体（桩 hook）；未渲染时返回 null，由断言暴露而不是让整轮崩掉。 */
		execPanel: () => {
			const element = rendered[rendered.length - 1];
			if (element === void 0 || typeof element.type !== "function") return null;
			return element.type(element.props);
		}
	};
}

/** 构造一行官方菜单行（button[role=menuitem]）+ 其 cellLabel 文本。 */
function menuRow(labelText) {
	const row = new FakeElement("button");
	row.querySelector = (selector) => (selector.includes("cellLabel") ? { textContent: labelText } : null);
	row.textContent = `${labelText}高`;
	row.getBoundingClientRect = () => ({ top: 520, bottom: 560, left: 120, right: 400, width: 280, height: 40 });
	const target = new FakeElement("span");
	target.closest = (selector) => (selector === 'button[role="menuitem"]' ? row : null);
	return target;
}

/** 遍历桩 react 元素树。 */
function walkElements(node, visit) {
	if (node === null || node === void 0 || typeof node === "boolean") return;
	if (Array.isArray(node)) {
		for (const child of node) walkElements(child, visit);
		return;
	}
	if (typeof node === "string" || typeof node === "number") {
		visit({ kind: "text", node });
		return;
	}
	if (typeof node !== "object") return;
	visit({ kind: "element", node });
	walkElements(node.props?.children, visit);
}
const panelText = (tree) => {
	const parts = [];
	walkElements(tree, (entry) => {
		if (entry.kind === "text") parts.push(String(entry.node));
	});
	return parts.join(" ");
};
const findElement = (tree, predicate) => {
	let found;
	walkElements(tree, (entry) => {
		if (found === void 0 && entry.kind === "element" && predicate(entry.node)) found = entry.node;
	});
	return found;
};
const rangeOf = (tree) => findElement(tree, (el) => el.props?.type === "range");

const warn = console.warn;
let warnings = [];
console.warn = (...args) => warnings.push(args.join(" "));
//#endregion

//#region 1. 当前会话解析：两代官方快照形状
console.log("当前会话解析（currentSessionId）");
const resolve = (list) => bundle.currentSessionId({ list: { getSnapshot: () => list } });
check(
	"≤0.1.5 形状：list.current 直接给出会话 id",
	resolve({ ids: ["a"], byId: {}, current: "legacy-session" }) === "legacy-session"
);
check(
	"0.1.6+ 形状：byId[*].retainedBy.mainView > 0 的会话即当前会话",
	resolve({
		ids: ["a", "b", "c"],
		byId: {
			a: { id: "a", retainedBy: {} },
			b: { id: "b", retainedBy: { mainView: 1 } },
			c: { id: "c", retainedBy: { sidebar: 2 } }
		},
		phase: "ready"
	}) === "b"
);
check(
	"0.1.6+ 形状：没有主视图会话时返回 undefined（不误取别的会话）",
	resolve({ ids: ["a"], byId: { a: { id: "a", retainedBy: {} } }, phase: "ready" }) === void 0
);
check("列表快照尚未就绪时返回 undefined", resolve({ ids: [], byId: {}, phase: "pending" }) === void 0);
check("sessions 服务缺失时返回 undefined", bundle.currentSessionId(void 0) === void 0);
//#endregion

//#region 2. 点击拦截：0.1.6+ 形状必须真的弹出面板
console.log("\n点击拦截（官方 0.1.6+ 快照形状）");
{
	const { directory } = fakeDirectory();
	const modelDirectories = { directoryFor: () => directory };
	const { fire, clickCapture } = mount({ sessions: sessionsWithMain(), theme, modelDirectories });
	const result = fire(menuRow("推理等级"));
	check("监听器注册在 capture 阶段（否则官方 React 处理器先跑）", clickCapture === true);
	check("拦截时阻止官方菜单下钻（preventDefault + stopPropagation）", result.prevented && result.stopped);
	check("面板被渲染一次", rendered.length === 1, `render 调用 ${rendered.length} 次`);
	check(
		"面板拿到的是主视图会话 id",
		rendered[0]?.props?.sessionId === "session-1",
		`实际 ${String(rendered[0]?.props?.sessionId)}`
	);
	check("面板拿到 modelDirectories 服务", rendered[0]?.props?.modelDirectories === modelDirectories);
	check("面板拿到官方主题解析结果", rendered[0]?.props?.themeMode === "light");
}
//#endregion

//#region 3. EffortPanel 主体（桩 hook 真实执行）
console.log("\nEffortPanel 主体（目录就绪）");
{
	const { directory, selectCalls } = fakeDirectory();
	const { fire, execPanel } = mount({
		sessions: sessionsWithMain(),
		theme,
		modelDirectories: { directoryFor: () => directory }
	});
	fire(menuRow("推理等级"));
	const tree = execPanel() ?? {};
	const text = panelText(tree);
	check("渲染出 OFF / MAX 刻度标签", text.includes("OFF") && text.includes("MAX"), text.slice(0, 80));
	check("渲染出官方档位名 Low / High", text.includes("Low") && text.includes("High"));
	const range = rangeOf(tree);
	check("滑块输入存在", range !== void 0);
	check("档位可用时滑块未被禁用", range?.props?.disabled === false);

	if (range === void 0) {
		check("写档位断言（面板未渲染或输入结构变化，后续交互无法验证）", false);
	} else {
		fakeNow += 1000;
		range.props.onInput({ target: { value: "100" } });
		check("拖到 100 → 写入 max 档", selectCalls.length === 1 && selectCalls[0].reasoningEffort === "max");
		check(
			"写入带 provider / model（与官方目录同一份选择）",
			selectCalls[0]?.provider === "deepseek-official" && selectCalls[0]?.model === "deepseek-v4-flash"
		);

		fakeNow += 1000;
		range.props.onBlur({ target: { value: String(100 / 3) } });
		check("松手写回吸附后的档位（low）", selectCalls.length === 2 && selectCalls[1].reasoningEffort === "low");
		check(
			"松手把滑块吸附到档位刻度",
			hookWrites.values.some((value) => typeof value === "number" && Math.abs(value - 100 / 3) < 1e-6),
			JSON.stringify(hookWrites.values)
		);
		fakeNow += 10;
		range.props.onBlur({ target: { value: "0" } });
		check("50ms 内的重复 commit 被去重（不连写两次）", selectCalls.length === 2);
	}
}

console.log("\nEffortPanel 主体（异常与未就绪路径）");
{
	warnings = [];
	const { fire, execPanel } = mount({
		sessions: sessionsWithMain(),
		theme,
		modelDirectories: {
			directoryFor: () => {
				throw new Error("ui-model-selection: session resolved no scope");
			}
		}
	});
	fire(menuRow("推理等级"));
	let tree;
	let threw = null;
	try {
		tree = execPanel();
	} catch (error) {
		threw = error;
	}
	check("directoryFor 抛出时面板不崩（不再让 React 卸载整棵）", threw === null, String(threw));
	check("展示「会话未就绪」提示", panelText(tree ?? "").includes("会话未就绪"));
	check("directoryFor 抛出留下告警", warnings.some((line) => line.includes("model directory unavailable")));
}
{
	const { directory } = fakeDirectory({ status: "error", error: "catalog exploded", current: null, groups: [] });
	const { fire, execPanel } = mount({
		sessions: sessionsWithMain(),
		theme,
		modelDirectories: { directoryFor: () => directory }
	});
	fire(menuRow("推理等级"));
	check("目录失败时显示官方错误原因", panelText(execPanel()).includes("模型目录加载失败：catalog exploded"));
}
{
	const { directory, selectCalls } = fakeDirectory({ status: "loading", error: null, current: null, groups: [] });
	const { fire, execPanel } = mount({
		sessions: sessionsWithMain(),
		theme,
		modelDirectories: { directoryFor: () => directory }
	});
	fire(menuRow("推理等级"));
	const tree = execPanel() ?? {};
	check("目录未就绪时显示「加载中」", panelText(tree).includes("模型目录加载中"));
	fakeNow += 1000;
	const range = rangeOf(tree);
	check("未就绪时滑块禁用", range?.props?.disabled === true);
	if (range === void 0) {
		check("未就绪时不写档位（滑块缺失，无法验证）", false);
	} else {
		range.props.onInput({ target: { value: "100" } });
		check("未就绪时不写档位", selectCalls.length === 0);
	}
}
{
	const { directory } = fakeDirectory({
		groups: [
			{
				id: "deepseek-official",
				models: [
					{
						id: "deepseek-v4-flash",
						name: "Flash",
						reasoning: { defaultEffort: "high", efforts: [{ id: "high", name: "High" }] }
					}
				]
			}
		]
	});
	const { fire, execPanel } = mount({
		sessions: sessionsWithMain(),
		theme,
		modelDirectories: { directoryFor: () => directory }
	});
	fire(menuRow("推理等级"));
	check("单档模型提示「不提供多档推理等级」", panelText(execPanel()).includes("不提供多档推理等级"));
}
//#endregion

//#region 4. 官方主题切换：theme/change 必须按新明暗重渲面板
console.log("\n官方主题切换（theme/change）");
{
	const { directory } = fakeDirectory();
	const themeState = { mode: "light" };
	const { fire, emit } = mount({
		sessions: sessionsWithMain(),
		theme: { getTheme: () => ({ active: { colorScheme: themeState.mode } }) },
		modelDirectories: { directoryFor: () => directory }
	});
	fire(menuRow("推理等级"));
	check("初始按官方浅色渲染", rendered[0]?.props?.themeMode === "light");
	themeState.mode = "dark";
	emit("theme/change", { active: { colorScheme: "dark" } });
	check("官方切深色后面板按 dark 重渲", rendered[rendered.length - 1]?.props?.themeMode === "dark");
	check("重渲仍挂在当前会话上", rendered[rendered.length - 1]?.props?.sessionId === "session-1");
}
//#endregion

//#region 5. 回归对照
console.log("\n回归对照");
{
	const { directory } = fakeDirectory();
	const { fire } = mount({
		sessions: { list: { getSnapshot: () => ({ ids: [], byId: {}, phase: "ready" }) } },
		theme,
		modelDirectories: { directoryFor: () => directory }
	});
	warnings = [];
	const effort = fire(menuRow("Effort"));
	check("取不到会话时不渲染面板", rendered.length === 0);
	check("取不到会话时留下告警（不静默吞掉）", warnings.some((line) => line.includes("no session id")));
	check("推理等级行仍然阻止官方下钻", effort.prevented && effort.stopped);
	const other = fire(menuRow("模型"));
	check("非推理等级行不拦截官方行为", other.prevented === false);
}
//#endregion

//#region 6. 其它兼容路径
console.log("\n其它兼容路径");
{
	const { directory } = fakeDirectory();
	const sessions = { list: { getSnapshot: () => ({ ids: ["l"], byId: {}, current: "legacy-2" }) } };
	const { fire } = mount({ sessions, theme, modelDirectories: { directoryFor: () => directory } });
	fire(menuRow("Effort"));
	check("英文界面（Effort）同样拦截", rendered.length === 1);
	check("≤0.1.5 快照下用 list.current 作为会话 id", rendered[0]?.props?.sessionId === "legacy-2");
}
{
	const { directory } = fakeDirectory();
	const { fire } = mount({
		sessions: sessionsWithMain(),
		theme,
		modelDirectories: { directoryFor: () => directory }
	});
	fire(menuRow("模型"));
	check("点『模型』行不弹推理面板", rendered.length === 0);
}
//#endregion

console.warn = warn;

//#region 7. 发布面契约
console.log("\n发布面契约");
check("inject 声明三项服务", JSON.stringify(bundle.inject) === JSON.stringify(["sessions", "theme", "modelDirectories"]));
const source = readFileSync(bundlePath, "utf8");
check("bundle 中不再直接读 sessions.list 快照的 current 字段", !/getSnapshot\(\)\.current/.test(source));
check("bundle 不再引用 0.1.2 已移除的 dsh-client-runtime 注入面", !source.includes("dsh-client-runtime"));

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const inject = manifest.dsh?.client?.inject ?? [];
const requiredInject = [
	"@deepseek-ai/dsh-api-session-controller",
	"@deepseek-ai/dsh-client-modules",
	"@deepseek-ai/dsh-client-ui-model-selection",
	"@deepseek-ai/dsh-client-ui-theme"
];
check(
	"manifest dsh.client.inject 声明全部四个上游包",
	requiredInject.every((name) => inject.includes(name)),
	inject.join(", ")
);
check("manifest dsh.client.platform 为 web", manifest.dsh?.client?.platform === "web");
check("manifest ./client 入口指向 lib/client.js（宿主据此取 bundle）", manifest.exports?.["./client"] === "./lib/client.js");
check("manifest 主入口为 lib/index.js", manifest.main === "./lib/index.js" || manifest.main === "lib/index.js");
//#endregion

if (failed) {
	console.log(`\n结论：${failed} 项失败`);
	process.exit(1);
}
console.log("\n结论：全部通过");

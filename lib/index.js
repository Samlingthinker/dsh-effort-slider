/**
 * dsh-effort-slider host half — 零外部依赖。
 *
 * 面板配色恒定跟随官方主题（theme.getTheme().active.colorScheme），由浏览器端
 * 在 `theme/change` 事件时实时重渲；客户端 bundle 负责滑块面板本体。
 *
 * 宿主半区职责（0.1.7+）：
 *  1. 自动档位声明：llm-pi-ai 下任何缺 reasoningEfforts 的模型（无论来源——
 *     网关同步、UI 手动添加、官方自定义路由）自动补 low/medium/high，
 *     保证"新加模型就有推理滑块"。显式声明 reasoningEfforts: false 的尊重不动。
 *  2. 本地网关免费模型自动新增：拉网关 /admin/overview，免费且渠道映射到
 *     注册表既有分组的新模型自动入册（UI 删除自动记黑名单，不回填）。
 *
 * 写入全部走 settings 服务用户层（热生效，无需重启 dsh）。
 */

/** 稳定插件名（对应 cordis.patch.yml 的 insert id）。 */
const name = "ui-effort-slider";

export const inject = ["settings"];

export const Config = {
	"~standard": {
		version: 1,
		vendor: "dsh-effort-slider",
		validate(config) {
			if (config === undefined || config === null) return { value: {} };
			if (typeof config === "object") return { value: config };
			return { issues: [{ message: "config must be an object" }] };
		}
	}
};

const GATEWAY = process.env.MODEL_SYNC_GATEWAY || "http://127.0.0.1:3000";
const GATEWAY_KEY = "gateway-local"; // 网关 admin 接口只认 GATEWAY_KEYS
const INTERVAL_MS = 5 * 60 * 1000;
const FIRST_DELAY_MS = 30 * 1000;

/** 渠道映射：网关 owned_by → 注册表分组（其余渠道不自动收） */
const CHANNEL_MAP = {
	"B.AI LLM Service": "b-ai",
	"Loomy (iFlytek Desktop)": "loomy",
	"WorkBuddy 国内版": "workbuddy-cn",
	"WorkBuddy 国际版": "workbuddy-intl",
	"Antigravity CLI": "antigravity",
	"Grok CLI": "grok",
	"Agnes": "agnes",
	"FHRouter": "fhrouter",
	"TokenHarbor": "tokenharbor"
};

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const STATE_FILE = path.join(os.homedir(), ".dsh", "effort-slider", "gateway-sync.json");

function log(...args) {
	console.log("[effort-slider:host]", ...args);
}

function loadState() {
	try {
		return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
	} catch {
		return { tombstones: {}, lastSeen: {} };
	}
}

function saveState(state) {
	try {
		fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
		fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
	} catch (e) {
		log("state 写入失败:", e.message);
	}
}

async function fetchGatewayFreeModels() {
	const res = await fetch(`${GATEWAY}/admin/overview`, {
		headers: { Authorization: `Bearer ${GATEWAY_KEY}` },
		signal: AbortSignal.timeout(20000)
	});
	if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
	const data = await res.json();
	return data.models || [];
}

/**
 * 主任务：补思考强度声明 + 网关免费模型自动新增。
 */
export async function syncOnce(settings) {
	const descriptor = (settings.describe() || []).find((row) => row.ns === "llm-pi-ai");
	if (descriptor === void 0) throw new Error("llm-pi-ai 未注册为可配置命名空间");
	const providers = descriptor.value?.providers || {};
	const state = loadState();

	// ① 补思考强度：任何缺 reasoningEfforts 的模型自动声明（显式 false 尊重不动）
	const patch = {};
	let declared = 0;
	const declaredList = [];
	for (const [group, info] of Object.entries(providers)) {
		const models = info.models || [];
		const missing = models.filter((m) => m.reasoningEfforts === void 0);
		if (missing.length === 0) continue;
		patch[group] = {
			models: models.map((m) => m.reasoningEfforts === void 0
				? { ...m, reasoningEfforts: { low: "low", medium: "medium", high: "high" } }
				: m)
		};
		declared += missing.length;
		declaredList.push(`${group}(${missing.map((m) => m.id).join(",")})`);
	}

	// ② 网关免费模型自动新增：可路由 + 免费 + 渠道映射 + 不在册 + 未拉黑
	const known = new Set();
	for (const info of Object.values(providers)) {
		for (const m of info.models || []) known.add(m.id);
	}
	// 黑名单条目：{id, until}。14 天自动过期（手误删除两周内自愈回填）；
	// 手动重新添加的模型（出现在注册表里）立即解除黑名单。
	const TOMBSTONE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
	const tombstones = state.tombstones || {};
	const now = Date.now();
	const dead = new Set();
	for (const [group, list] of Object.entries(tombstones)) {
		const alive = [];
		for (const item of list || []) {
			const id = typeof item === "string" ? item : item.id;
			const until = typeof item === "string" ? now + TOMBSTONE_TTL_MS : item.until;
			if (until > now) alive.push({ id, until });
			else log(`黑名单过期解除 (${group}):`, id);
		}
		if (alive.length) tombstones[group] = alive;
		else delete tombstones[group];
		for (const item of alive) {
			// 已被手动重新添加的模型：立即解除黑名单
			if (known.has(item.id)) log(`黑名单解除 (${group}):`, item.id, "（已重新在册）");
			else dead.add(item.id);
		}
	}
	if (JSON.stringify(tombstones) !== JSON.stringify(state.tombstones)) state.tombstones = tombstones;
	const wanted = {};
	let added = 0;
	const addedList = [];
	try {
		const gatewayModels = await fetchGatewayFreeModels();
		for (const entry of gatewayModels) {
			if (entry.billing !== "free") continue;
			if (known.has(entry.model) || dead.has(entry.model)) continue;
			const channels = (entry.providers || []).map((p) => CHANNEL_MAP[p]).filter(Boolean);
			if (channels.length === 0) continue;
			const group = channels[0];
			if (providers[group] === void 0) continue; // 分组不存在则不收
			wanted[group] ||= [];
			const meta = entry.meta || {};
			wanted[group].push({
				id: entry.model,
				name: `${entry.model} (自动同步)`,
				contextWindow: Number.isFinite(meta.ctx) && meta.ctx > 0 ? meta.ctx : 262144,
				maxTokens: Number.isFinite(meta.maxOut) && meta.maxOut > 0 ? meta.maxOut : 32768,
				input: ["text"],
				reasoningEfforts: { low: "low", medium: "medium", high: "high" }
			});
			added += 1;
			addedList.push(`${group}/${entry.model}`);
		}
	} catch (e) {
		log("网关对账失败（不影响档位声明）:", e.message);
	}

	// 合并 ①② 为一次写入（每分组一条完整 models 数组）
	for (const [group, models] of Object.entries(wanted)) {
		const existing = patch[group]?.models || providers[group]?.models || [];
		patch[group] = {
			models: [...existing, ...models.filter((m) => !existing.some((x) => x.id === m.id))]
		};
	}

	if (Object.keys(patch).length === 0) {
		log("对账完成：无新模型、无缺失档位声明");
		return { declared: 0, added: 0 };
	}

	await settings.update("llm-pi-ai", { providers: patch }, descriptor.revision);
	log(
		`写入完成: 自动声明思考强度 ${declared} 个 [${declaredList.join(", ")}]` +
		(added > 0 ? ` | 网关自动新增 ${added} 个 [${addedList.join(", ")}]` : "")
	);

	// 黑名单：上一轮在册、本轮消失的免费模型（老板在 UI 删了）→ 14 天内不回填
	// （手误删除两周后自动回填自愈；手动重新添加的立即解除黑名单）
	const state2 = loadState();
	state2.lastSeen = {};
	for (const [group, info] of Object.entries(providers)) {
		state2.lastSeen[group] = (info.models || []).map((m) => m.id);
	}
	const nowTs = Date.now();
	for (const [group, info] of Object.entries(descriptor.value.providers)) {
		const nowIds = (info.models || []).map((m) => m.id);
		const prev = (state.lastSeen || {})[group] || [];
		const removed = prev.filter((id) => !nowIds.includes(id));
		if (removed.length) {
			const existing = (state2.tombstones[group] || []).map((item) => (typeof item === "string" ? { id: item, until: nowTs } : item));
			for (const id of removed) if (!existing.some((item) => item.id === id)) existing.push({ id, until: nowTs + TOMBSTONE_TTL_MS });
			state2.tombstones[group] = existing;
			log(`黑名单更新 (${group}), 14 天后自动过期:`, removed.join(", "));
		}
	}
	saveState(state2);

	return { declared, added };
}

export function apply(ctx) {
	const settings = ctx.get("settings");
	if (settings === void 0) {
		log("settings 服务不可用，自动档位声明跳过");
		return;
	}

	let running = false;
	async function task() {
		if (running) return;
		running = true;
		try {
			await syncOnce(settings);
		} catch (e) {
			log("同步失败:", e.message);
		} finally {
			running = false;
		}
	}

	ctx.effect(() => {
		const first = setTimeout(task, FIRST_DELAY_MS);
		const timer = setInterval(task, INTERVAL_MS);
		return () => {
			clearTimeout(first);
			clearInterval(timer);
		};
	}, "dsh-effort-slider: auto effort declarations");

	log("宿主已挂载：新模型自动声明思考强度（滑块自动可用）+ 网关免费模型自动新增");
}

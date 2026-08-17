/**
 * dsh-effort-slider host half — 零外部依赖。
 *
 * 浏览器经 `/_dsh/effort-slider/settings` 同源路由读写外观偏好（浅色/深色/
 * 跟随系统）；偏好持久化到 `DSH_HOME/effort-slider.json`（与 skin-aurora
 * 的 pet.json 同模式），不依赖 @deepseek-ai/dsh-settings。
 *
 * 为什么不用宿主 settings 命名空间：官方 `settings.mutate` RPC 只对白名单
 * 命名空间开放（`settings-not-exposed`），第三方插件无法用 settingsScope
 * 写自定义命名空间；且本插件以本地目录方式安装（`dsh plugin add <路径>`），
 * Node 会按真实路径解析导入，引入 @deepseek-ai/* 会要求额外安装依赖。
 * 零依赖宿主半边让「克隆仓库 → dsh plugin add → 重启」即可用。
 *
 * 首次运行时会把旧版存于 settings.yaml 的 `effort-slider.appearance`
 * 一次性迁移到新 JSON 文件。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** 稳定插件名（对应 cordis.patch.yml 的 insert id）。 */
const name = "ui-effort-slider";

const APPEARANCE_VALUES = ["light", "dark", "system"];
/** 浏览器设置页读写的同源路由。 */
const SETTINGS_ROUTE = "/_dsh/effort-slider/settings";
const DEFAULTS = { appearance: "system", revision: 0 };

function dshHome() {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** 配置文件名（DSH_HOME/effort-slider.json，与 pet.json 同模式）。 */
function configPath() {
	return join(dshHome(), "effort-slider.json");
}

function writeConfig(next) {
	mkdirSync(dshHome(), { recursive: true });
	writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
}

/**
 * 一次性迁移：旧版把偏好存在宿主 settings 命名空间（settings.yaml 中的
 * `effort-slider` 小节）；新版改为自有 JSON 文件。仅在 JSON 不存在时读取。
 * @returns 合法的外观值，或 undefined（无旧数据）。
 */
function migrateFromSettingsYaml() {
	try {
		const settingsPath = join(dshHome(), "settings.yaml");
		const lines = readFileSync(settingsPath, "utf8").split(/\r?\n/);
		for (let i = 0; i < lines.length; i += 1) {
			if (!/^effort-slider:\s*$/.test(lines[i])) continue;
			for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j += 1) {
				const m = lines[j].match(/^\s+appearance:\s*"?([^"\s#]+)"?\s*(?:#.*)?$/);
				if (m !== null && APPEARANCE_VALUES.includes(m[1])) return m[1];
			}
			break;
		}
	} catch {
		// 无 settings.yaml 或不可读：跳过迁移
	}
	return void 0;
}

/** 读取配置（文件缺失/损坏时回退默认值；缺失时先尝试旧版迁移）。 */
function loadConfig() {
	try {
		const raw = JSON.parse(readFileSync(configPath(), "utf8"));
		return {
			appearance: APPEARANCE_VALUES.includes(raw.appearance) ? raw.appearance : DEFAULTS.appearance,
			revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : DEFAULTS.revision
		};
	} catch {
		if (!existsSync(configPath())) {
			const legacy = migrateFromSettingsYaml();
			if (legacy !== void 0) {
				const next = { appearance: legacy, revision: 0 };
				writeConfig(next);
				return next;
			}
		}
		return { ...DEFAULTS };
	}
}

/** 当前 wire 快照（appearance + revision + writable）。 */
function snapshotOf() {
	const cfg = loadConfig();
	return { appearance: cfg.appearance, revision: cfg.revision, writable: true };
}

function sendJson(res, status, body) {
	const bytes = Buffer.from(JSON.stringify(body));
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Content-Length", String(bytes.length));
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.writeHead(status);
	res.end(bytes);
}

function requestError(res, status, code, message) {
	sendJson(res, status, { ok: false, error: { code, message } });
}

/** Accept state-changing requests only from the DSH Web application's origin. */
function sameOriginPost(req) {
	const fetchSite = req.headers["sec-fetch-site"];
	if (fetchSite === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === undefined) {
		return fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none";
	}
	const host = req.headers.host;
	if (host === undefined) return false;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}

async function readJson(req, maxBytes = 64 * 1024) {
	const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
	if (contentType !== "application/json") {
		throw new TypeError("Content-Type must be application/json");
	}
	const chunks = [];
	let bytes = 0;
	for await (const chunk of req) {
		const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += part.length;
		if (bytes > maxBytes) throw new RangeError(`request body exceeds ${maxBytes} bytes`);
		chunks.push(part);
	}
	if (chunks.length === 0) throw new TypeError("request body is empty");
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * 宿主插件体：在存在 webServer 服务时挂载 GET/POST 设置路由
 * （无 webServer 时为空操作，客户端外观退化为默认 system）。
 */
function apply(ctx) {
	ctx.inject(["webServer"], (webCtx) => {
		const handle = async (req, res) => {
			if (req.method === "GET") {
				sendJson(res, 200, { ok: true, value: snapshotOf() });
				return;
			}
			if (req.method !== "POST") {
				res.setHeader("Allow", "GET, POST");
				requestError(res, 405, "method-not-allowed", "Use GET or POST");
				return;
			}
			if (!sameOriginPost(req)) {
				requestError(res, 403, "origin-rejected", "The request must originate from this DSH Web application");
				return;
			}
			let parsed;
			try {
				parsed = await readJson(req);
			} catch (error) {
				requestError(res, error instanceof RangeError ? 413 : 400, "invalid-request", error instanceof Error ? error.message : String(error));
				return;
			}
			if (parsed?.action !== "save") {
				requestError(res, 400, "invalid-request", "request action must be 'save'");
				return;
			}
			if (!APPEARANCE_VALUES.includes(parsed.appearance)) {
				requestError(res, 400, "invalid-request", `appearance must be one of ${APPEARANCE_VALUES.join(", ")}`);
				return;
			}
			if (!Number.isSafeInteger(parsed.expectedRevision) || parsed.expectedRevision < 0) {
				requestError(res, 400, "invalid-request", "save.expectedRevision must be a non-negative integer");
				return;
			}
			const current = loadConfig();
			if (parsed.expectedRevision !== current.revision) {
				requestError(res, 409, "settings-conflict", `expected revision ${parsed.expectedRevision}, now ${current.revision}`);
				return;
			}
			writeConfig({ appearance: parsed.appearance, revision: current.revision + 1 });
			sendJson(res, 200, { ok: true, value: snapshotOf() });
		};
		const dispose = webCtx.webServer.register({
			kind: "exact",
			path: SETTINGS_ROUTE,
			handler: (req, res) => void handle(req, res)
		});
		webCtx.effect(() => dispose, "ui-effort-slider: settings route");
	});
}

export { APPEARANCE_VALUES, SETTINGS_ROUTE, apply, name };

#!/usr/bin/env node
/**
 * dsh-effort-slider 上游兼容性自检（零依赖，仅需 npm 与 tar）。
 *
 * 插件只依赖官方包的少量接口面，官方发新版后跑一次本脚本即可复查是否漂移：
 *   - @deepseek-ai/dsh-client-ui-theme           theme/change 事件 + getTheme().active.colorScheme
 *   - @deepseek-ai/dsh-client-ui-model-selection modelDirectories 服务（directoryFor/store/select）
 *                                                + 官方菜单 menuitem 行 + cellLabel + 「推理等级」文案
 *   - @deepseek-ai/dsh-api-session-controller    sessions 服务：快照读取当前会话
 *                                                （≤0.1.5 的 list.current；0.1.6-alpha.2 起
 *                                                视图选择移出 sessions，改看
 *                                                list.byId[*].retainedBy.mainView）
 *   - @deepseek-ai/dsh-client-modules            __DSH_BOOT__ 入口图 + dsh.client.inject 声明面
 *
 * 自检分两段：
 *   1. 插件侧接口面静态扫描（无需网络）：lib/client.js / package.json 里是否还写着
 *      已被官方删除的接口，或漏了当前版本必需的判定标记；
 *   2. 上游包标记扫描（npm 拉包）：插件用到的接口标记是否还在。
 * 退一步说：标记还在也可能语义变了（0.1.7 删掉 sessions.list.current 时标记扫描仍全绿），
 * 所以第 1 段与 scripts/test-client.mjs 的行为回归测试缺一不可。
 *
 * 用法：
 *   node scripts/check-compat.mjs                          # 各包自动取最新 rc 版本
 *   node scripts/check-compat.mjs 0.1.7-rc.2               # 四个包统一钉到指定版本（也可传 alpha 看开发线）
 *   node scripts/check-compat.mjs --local <包目录>          # 直接扫本机已安装的上游包，不走网络
 *     # 例：--local "<DSH Desktop 安装目录>\resources\app\node_modules\@deepseek-ai"
 *     #     （即 DSH Desktop 随包发布的 0.1.7-rc.2，比 npm 最新版更贴近真实运行环境）
 *
 * 退出码：0 = 全部通过；1 = 有接口漂移；2 = 自检本身没跑完（网络 / npm 不可达等）。
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const localIndex = args.indexOf("--local");
/** --local 指定的上游包根目录（其下是 dsh-client-ui-theme 之类的包目录）。 */
const localRoot = localIndex === -1 ? void 0 : args[localIndex + 1];
/** --local 的值索引；没有 --local 时置 -1，避免误吞第一个位置参数（钉版本号）。 */
const localValueIndex = localIndex === -1 ? -1 : localIndex + 1;
const pinned = args.filter((arg, index) => !arg.startsWith("--") && index !== localValueIndex)[0];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (localIndex !== -1 && (localRoot === void 0 || !existsSync(localRoot))) {
	console.error(`--local 需要一个存在的目录：${String(localRoot)}`);
	process.exit(2);
}

/** 每项 = 一个上游包 + 插件依赖它的接口标记（标记缺失即视为漂移，需人工核对）。 */
const CHECKS = [
	{
		pkg: "@deepseek-ai/dsh-client-ui-theme",
		what: "面板主题跟随：theme/change 事件 + getTheme().active.colorScheme",
		expect: ["theme/change", "getTheme", "colorScheme"],
	},
	{
		pkg: "@deepseek-ai/dsh-client-ui-model-selection",
		what: "模型目录与档位读写：modelDirectories 服务（directoryFor/store/select）+ 官方菜单拦截面",
		expect: ["modelDirectories", "directoryFor", "menuitem", "cellLabel", "推理等级"],
	},
	{
		pkg: "@deepseek-ai/dsh-api-session-controller",
		what: "会话服务：sessions 快照（≤0.1.5 带 current；0.1.6-alpha.2 起改为 list.byId[*].retainedBy）",
		expect: ['provide("sessions"', "getSnapshot"],
		// 至少命中一组（插件两代并存）。标记必须是「形状锚点」，不能用裸词：
		// `current` 在包里出现 130~240 次（queue-mirror 的 `current = []`、types 里的
		// getter 等），裸词永远命中 —— 那样的检查永远不可能失败。
		// 实测矩阵（各版本 lib/ 内标记）：
		//   0.1.2-rc.1 / 0.1.5-rc.3 : current: void 0 ✔  currentAddress ✔  retainedBy ✘
		//   0.1.6-alpha.2 / 0.1.7-rc.2: current: void 0 ✘  currentAddress ✘  retainedBy ✔
		expectOneOf: [["retainedBy"], ["current: void 0"], ["currentAddress"]],
	},
	{
		pkg: "@deepseek-ai/dsh-client-modules",
		what: "客户端模块系统：__DSH_BOOT__ 入口图 + dsh.client.inject 声明面",
		expect: ["__DSH_BOOT__", "dsh.client.inject"],
	},
];

/**
 * 插件侧禁用面：官方已删除的接口一旦留在 lib/client.js，只会在用户点开菜单时静默失效，
 * 所以这里静态扫一遍，命中即视为漂移（附上游删除它的版本 / 替代方案）。
 */
const PLUGIN_FORBIDDEN = [
	{
		pattern: "getSnapshot().current",
		why: "0.1.6-alpha.2 起 sessions.list 快照不再有 current —— 当前会话改为 list.byId[*].retainedBy.mainView > 0",
	},
	{
		pattern: "connection.api.sessions",
		why: "0.1.2 起 apiproxy 拆分，旧 sessions 接口面已拆除",
	},
	{
		pattern: "dsh-client-runtime",
		why: "官方已移除 @deepseek-ai/dsh-client-runtime（由 dsh-client-modules 接替）",
	},
];

/** 插件侧必需面：这些标记缺失说明适配落后于当前上游。 */
const PLUGIN_REQUIRED = [
	{ pattern: "retainedBy", why: "当前会话判定（0.1.6-alpha.2+ 主视图 retain）" },
	{ pattern: "mainView", why: "当前会话判定（0.1.6-alpha.2+ 主视图 retain）" },
	{ pattern: "directoryFor", why: "官方模型目录服务入口" },
	{ pattern: "theme/change", why: "官方主题切换事件" },
	{ pattern: "cellLabel", why: "官方菜单行的结构标签" },
];

/** package.json 必须声明的客户端注入面（决定 bundle 加载次序与依赖可见性）。 */
const REQUIRED_INJECT = [
	"@deepseek-ai/dsh-api-session-controller",
	"@deepseek-ai/dsh-client-modules",
	"@deepseek-ai/dsh-client-ui-model-selection",
	"@deepseek-ai/dsh-client-ui-theme",
];

let failed = 0;
/** 自检项数 = 上游包各项 + 1 个插件侧接口面扫描（每个自检项最多计一次失败）。 */
const TOTAL_CHECKS = CHECKS.length + 1;
console.log(
	`dsh-effort-slider 上游兼容性自检${
		localRoot !== void 0 ? `（本机已装包：${localRoot}）` : pinned ? `（统一钉到 ${pinned}）` : "（各包自动取最新 rc 版本）"
	}\n`
);

//#region 1. 插件侧接口面静态扫描
console.log("插件侧接口面");
{
	const source = readFileSync(join(root, "lib/client.js"), "utf8");
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const stale = PLUGIN_FORBIDDEN.filter((entry) => source.includes(entry.pattern));
	const absent = PLUGIN_REQUIRED.filter((entry) => !source.includes(entry.pattern));
	const inject = manifest.dsh?.client?.inject ?? [];
	const missingInject = REQUIRED_INJECT.filter((name) => !inject.includes(name));
	const ok = stale.length === 0 && absent.length === 0 && missingInject.length === 0;
	if (!ok) failed++;
	console.log(`  ${ok ? "✓" : "✗"} lib/client.js 未使用已删除接口，且含当前版本必需标记；package.json 注入面齐全`);
	for (const entry of stale) console.log(`    残留已删除接口：${entry.pattern} —— ${entry.why}`);
	for (const entry of absent) console.log(`    缺少标记：${entry.pattern} —— ${entry.why}`);
	for (const name of missingInject) console.log(`    dsh.client.inject 缺少：${name}`);
	console.log();
}
//#endregion

function run(cmd, cwd) {
	return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** npm view versions --json 只有一个版本时返回字符串而非数组，统一成数组。 */
function listVersions(pkg) {
	const parsed = JSON.parse(run(`npm view ${pkg} versions --json`));
	return Array.isArray(parsed) ? parsed : [parsed];
}

/** 官方目前全线预发布（rc 为准稳定线，alpha 为开发线），优先取最高 rc，没有才退回最高版本。 */
function pickLatestRc(versions) {
	const rcs = versions.filter((v) => /-rc\.\d+$/.test(v));
	const pool = rcs.length ? rcs : versions;
	const rank = (v) => {
		const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(v);
		return m ? [+m[1], +m[2], +m[3], +(m[4] ?? 0)] : [-1];
	};
	const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
	return pool.reduce((best, v) => (cmp(rank(v), rank(best)) > 0 ? v : best));
}

/** 拼接一个目录下全部文本文件的内容，作为标记检索语料（二进制读成乱码不影响标记命中）。 */
function walkCorpus(dir) {
	let text = "";
	const walk = (d) => {
		for (const ent of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, ent.name);
			if (ent.isDirectory()) walk(p);
			else {
				try {
					text += `${readFileSync(p, "utf8")}\n`;
				} catch {
					// 二进制文件（图片等）跳过
				}
			}
		}
	};
	walk(dir);
	return text;
}

/** 拉取 npm 包并拼接全部文本文件内容，作为标记检索语料。 */
function downloadCorpus(pkg, version, dir) {
	run(`npm pack ${pkg}@${version} --pack-destination "${dir}"`);
	const tarball = readdirSync(dir).find((f) => f.endsWith(".tgz"));
	if (!tarball) throw new Error(`npm pack 未产出 tarball：${pkg}@${version}`);
	// 用相对路径解压并把工作目录切到目标处：绝对路径带盘符冒号时，GNU tar 会误判为「远程主机:路径」。
	run(`tar -xzf "${tarball}"`, dir);
	return walkCorpus(join(dir, "package"));
}

//#region 2. 上游包标记扫描
const tmp = mkdtempSync(join(tmpdir(), "dsh-effort-compat-"));
try {
	for (const check of CHECKS) {
		// --local：直接扫本机已装的上游包（例如 DSH Desktop 里随包发布的 0.1.7-rc.2），
		// 比 npm 最新版更贴近真实运行环境；此时版本号从包自身 package.json 读。
		const localDir = localRoot === void 0 ? void 0 : join(localRoot, check.pkg.replace(/^@[^/]+\//, ""));
		const version = localDir === void 0 ? pinned ?? pickLatestRc(listVersions(check.pkg)) : JSON.parse(readFileSync(join(localDir, "package.json"), "utf8")).version;
		const dir = join(tmp, check.pkg.replace(/[@/]/g, "_"));
		mkdirSync(dir, { recursive: true });
		const corpus = localDir === void 0 ? downloadCorpus(check.pkg, version, dir) : walkCorpus(localDir);
		const missing = check.expect.filter((needle) => !corpus.includes(needle));
		// expectOneOf：多组备选标记，至少命中一组才算通过（接口面在两代之间迁移时用）。
		const alternatives = check.expectOneOf ?? [];
		const hit = alternatives.filter((group) => group.every((needle) => corpus.includes(needle)));
		const noAlternative = alternatives.length > 0 && hit.length === 0;
		const ok = missing.length === 0 && !noAlternative;
		if (!ok) failed++;
		console.log(`${check.pkg} @ ${version}`);
		console.log(`  ${ok ? "✓" : "✗"} ${check.what}`);
		if (!ok) {
			if (missing.length > 0) console.log(`    缺失标记：${missing.join("、")} —— 接口可能已漂移，需人工核对 lib/client.js 对应逻辑`);
			if (noAlternative) console.log(`    备选标记组一组都没命中（${alternatives.map((group) => group.join("+")).join(" 或 ")}）—— 会话快照形状可能已再次迁移`);
		}
		console.log();
	}
} catch (err) {
	console.error(`自检未能完成：${err.message}`);
	console.error("多半是网络或 npm registry 不可达；也确认本机有 tar（Windows 10 1803+ 自带）。");
	process.exit(failed ? 1 : 2);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
	console.log(`结论：${TOTAL_CHECKS - failed}/${TOTAL_CHECKS} 项通过 —— 有接口漂移，需要适配后再升级`);
	process.exit(1);
}
console.log(`结论：${TOTAL_CHECKS}/${TOTAL_CHECKS} 项通过 —— 插件与当前上游兼容，无需改动`);

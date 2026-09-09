#!/usr/bin/env node
/**
 * dsh-effort-slider 上游兼容性自检（零依赖，仅需 npm 与 tar）。
 *
 * 插件只依赖官方包的少量接口面，官方发新版后跑一次本脚本即可复查是否漂移：
 *   - @deepseek-ai/dsh-client-ui-theme           theme/change 事件 + getTheme().active.colorScheme
 *   - @deepseek-ai/dsh-client-ui-model-selection modelDirectories 服务（directoryFor/store/select）
 *                                                + 官方菜单 menuitem 行 + cellLabel + 「推理等级」文案
 *   - @deepseek-ai/dsh-api-session-controller    sessions 服务（list 快照取当前会话 id）
 *   - @deepseek-ai/dsh-client-modules            __DSH_BOOT__ 入口图 + dsh.client.inject 声明面
 *
 * 用法：
 *   node scripts/check-compat.mjs              # 各包自动取最新 rc 版本
 *   node scripts/check-compat.mjs 0.1.2-rc.1   # 四个包统一钉到指定版本（也可传 alpha 看开发线）
 *
 * 退出码：0 = 全部通过；1 = 有接口漂移；2 = 自检本身没跑完（网络 / npm 不可达等）。
 */

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pinned = process.argv[2];

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
		what: "会话服务：sessions.list 快照（当前会话 id）",
		expect: ['provide("sessions"', "getSnapshot"],
	},
	{
		pkg: "@deepseek-ai/dsh-client-modules",
		what: "客户端模块系统：__DSH_BOOT__ 入口图 + dsh.client.inject 声明面",
		expect: ["__DSH_BOOT__", "dsh.client.inject"],
	},
];

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

/** 拉取包并拼接全部文本文件内容，作为标记检索语料。 */
function downloadCorpus(pkg, version, dir) {
	run(`npm pack ${pkg}@${version} --pack-destination "${dir}"`);
	const tarball = readdirSync(dir).find((f) => f.endsWith(".tgz"));
	if (!tarball) throw new Error(`npm pack 未产出 tarball：${pkg}@${version}`);
	// 用相对路径解压并把工作目录切到目标处：绝对路径带盘符冒号时，GNU tar 会误判为「远程主机:路径」。
	run(`tar -xzf "${tarball}"`, dir);
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
	walk(join(dir, "package"));
	return text;
}

let failed = 0;
console.log(`dsh-effort-slider 上游兼容性自检${pinned ? `（统一钉到 ${pinned}）` : "（各包自动取最新 rc 版本）"}\n`);
const tmp = mkdtempSync(join(tmpdir(), "dsh-effort-compat-"));
try {
	for (const check of CHECKS) {
		const version = pinned ?? pickLatestRc(listVersions(check.pkg));
		const dir = join(tmp, check.pkg.replace(/[@/]/g, "_"));
		mkdirSync(dir, { recursive: true });
		const corpus = downloadCorpus(check.pkg, version, dir);
		const missing = check.expect.filter((needle) => !corpus.includes(needle));
		const ok = missing.length === 0;
		if (!ok) failed++;
		console.log(`${check.pkg} @ ${version}`);
		console.log(`  ${ok ? "✓" : "✗"} ${check.what}`);
		if (!ok) {
			console.log(`    缺失标记：${missing.join("、")} —— 接口可能已漂移，需人工核对 lib/client.js 对应逻辑`);
		}
		console.log();
	}
} catch (err) {
	console.error(`自检未能完成：${err.message}`);
	console.error("多半是网络或 npm registry 不可达；也确认本机有 tar（Windows 10 1803+ 自带）。");
	process.exit(2);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
	console.log(`结论：${CHECKS.length - failed}/${CHECKS.length} 通过 —— 有接口漂移，需要适配后再升级`);
	process.exit(1);
}
console.log(`结论：${CHECKS.length}/${CHECKS.length} 通过 —— 插件与当前上游兼容，无需改动`);

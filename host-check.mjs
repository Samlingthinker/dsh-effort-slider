// Host-half functional check (no DSH runtime, no dependencies):
// drives the GET/POST route handler end to end against a temporary DSH_HOME,
// including the legacy settings.yaml -> effort-slider.json migration.
// Run:  node host-check.mjs
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "dsh-effort-slider-host-check-"));

const mod = await import("./lib/index.js");
const { SETTINGS_ROUTE } = mod;

let route = null;
const webCtx = {
	webServer: {
		register(r) {
			route = r;
			return () => {};
		},
	},
	effect() {},
};
const ctx = {
	inject(deps, cb) {
		if (deps.includes("webServer")) cb(webCtx);
	},
};

mod.apply(ctx);
if (!route || route.kind !== "exact" || route.path !== "/_dsh/effort-slider/settings") {
	console.error("FAIL: route not registered");
	process.exit(1);
}
console.log("route:", route.kind, route.path);

function fakeReq(method, headers, body) {
	return {
		method,
		headers: headers ?? {},
		async *[Symbol.asyncIterator]() {
			if (body) yield Buffer.from(body);
		},
	};
}
function fakeRes() {
	return {
		statusCode: 0,
		headers: {},
		setHeader(k, v) { this.headers[k] = v; },
		writeHead(code) { this.statusCode = code; },
		end(buf) { this.body = buf; },
	};
}
async function call(method, headers, body) {
	const res = fakeRes();
	route.handler(fakeReq(method, headers, body), res);
	await new Promise((r) => setTimeout(r, 10));
	return { status: res.statusCode, body: JSON.parse(res.body.toString()) };
}

// 1) Legacy migration: seed settings.yaml with the old namespace, GET should
//    migrate it into effort-slider.json and report the saved appearance.
const yaml = "ui-theme:\n  preference: light\n\neffort-slider:\n  appearance: dark\n\n";
writeFileSync(join(process.env.DSH_HOME, "settings.yaml"), yaml, "utf8");
let got = await call("GET");
console.log("GET (migrated):", JSON.stringify(got.body));
if (!got.body.ok || got.body.value.appearance !== "dark" || got.body.value.revision !== 0) {
	console.error("FAIL: legacy migration did not apply");
	process.exit(1);
}
const jsonPath = join(process.env.DSH_HOME, "effort-slider.json");
if (!existsSync(jsonPath)) {
	console.error("FAIL: effort-slider.json not created by migration");
	process.exit(1);
}
console.log("migrated json:", readFileSync(jsonPath, "utf8").trim());

// 2) POST save with a fresh revision.
got = await call("POST", { "content-type": "application/json", "sec-fetch-site": "same-origin" }, JSON.stringify({ action: "save", appearance: "system", expectedRevision: 0 }));
console.log("POST save:", JSON.stringify(got.body));
if (!got.body.ok || got.body.value.appearance !== "system" || got.body.value.revision !== 1) {
	console.error("FAIL: POST save wrong");
	process.exit(1);
}

// 3) Stale revision -> conflict.
got = await call("POST", { "content-type": "application/json", "sec-fetch-site": "same-origin" }, JSON.stringify({ action: "save", appearance: "light", expectedRevision: 0 }));
console.log("POST conflict:", JSON.stringify(got.body));
if (got.body.ok || got.body.error?.code !== "settings-conflict" || got.status !== 409) {
	console.error("FAIL: conflict not detected");
	process.exit(1);
}

// 4) Invalid appearance value.
got = await call("POST", { "content-type": "application/json", "sec-fetch-site": "same-origin" }, JSON.stringify({ action: "save", appearance: "blue", expectedRevision: 1 }));
console.log("POST invalid:", JSON.stringify(got.body));
if (got.body.ok) {
	console.error("FAIL: invalid value accepted");
	process.exit(1);
}

// 5) Cross-site POST rejected.
got = await call("POST", { "content-type": "application/json", "sec-fetch-site": "cross-site" }, JSON.stringify({ action: "save", appearance: "dark", expectedRevision: 1 }));
console.log("POST cross-site:", JSON.stringify(got.body));
if (got.body.ok || got.body.error?.code !== "origin-rejected") {
	console.error("FAIL: cross-site POST accepted");
	process.exit(1);
}

// 6) Persisted value survives a fresh read (GET without POST).
got = await call("GET");
console.log("GET after saves:", JSON.stringify(got.body));
if (got.body.value.appearance !== "system" || got.body.value.revision !== 1) {
	console.error("FAIL: persistence wrong");
	process.exit(1);
}

console.log("HOST CHECK PASSED");

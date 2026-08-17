// Smoke-test dsh-effort-slider client bundle structure in Node:
// verify the module factory runs, exports apply+inject, apply() registers the
// settings.section slot and wires the document listener, the interception of
// the「推理等级」row works, and the appearance save/read flow round-trips
// through the mocked host settings route (mocked minimal DOM + client services).
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");

const listeners = new Map();
const fakeWindow = {
  __ModuleLoader__: { load: ({ id, factory }) => { loaded = { id, factory }; } },
  addEventListener: () => {},
};
let loaded = null;
const fakeDocument = {
  createElement: () => ({ style: {}, dataset: {}, appendChild() {}, addEventListener() {}, removeEventListener() {}, contains: () => false }),
  createRoot: undefined,
  body: { appendChild() {}, dataset: {} },
  head: { appendChild() {} },
  querySelector: () => null,
  addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
  removeEventListener: (type, fn) => { const a = listeners.get(type); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
};

// Host settings route mock: GET returns the snapshot, POST saves (with
// revision conflict semantics like the real host).
let hostState = { appearance: "system", revision: 0, writable: true };
const fetchCalls = [];
const fakeFetch = async (url, init = {}) => {
  fetchCalls.push({ url, method: init.method ?? "GET" });
  if (url !== "/_dsh/effort-slider/settings") {
    return { ok: false, status: 404, json: async () => ({ ok: false, error: { message: "not found" } }) };
  }
  if (!init.method || init.method === "GET") {
    return { ok: true, status: 200, json: async () => ({ ok: true, value: { ...hostState } }) };
  }
  const body = JSON.parse(init.body);
  if (body.action !== "save") {
    return { ok: false, status: 400, json: async () => ({ ok: false, error: { code: "invalid-request", message: "bad action" } }) };
  }
  if (body.expectedRevision !== hostState.revision) {
    return { ok: false, status: 409, json: async () => ({ ok: false, error: { code: "settings-conflict", message: "conflict" } }) };
  }
  hostState = { ...hostState, appearance: body.appearance, revision: hostState.revision + 1 };
  return { ok: true, status: 200, json: async () => ({ ok: true, value: { ...hostState } }) };
};

const fakeRequire = (name) => {
  if (name === "react") return { createElement: () => ({}), useRef: () => ({}), useState: () => [null, () => {}], useEffect: () => {}, useMemo: (f) => f() };
  if (name === "react-dom/client") return { createRoot: () => ({ render() {}, unmount() {} }) };
  if (name === "react/jsx-runtime") return { jsx: () => ({}), jsxs: () => ({}), Fragment: Symbol("Fragment") };
  throw new Error("unexpected require: " + name);
};

// Execute in a sandbox-ish way: replace window/document globals via vm context.
const vm = await import("node:vm");
class FakeHTMLElement {}
const context = vm.createContext({
  window: fakeWindow,
  document: fakeDocument,
  HTMLElement: FakeHTMLElement,
  console,
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  ResizeObserver: class { observe() {} disconnect() {} },
  setTimeout, clearTimeout,
  fetch: fakeFetch,
});
vm.runInContext(src, context);

if (!loaded) { console.error("FAIL: __ModuleLoader__.load not called"); process.exit(1); }
console.log("module id:", loaded.id);

const mod = loaded.factory(fakeRequire);
console.log("exports:", Object.keys(mod));
if (typeof mod.apply !== "function" || !Array.isArray(mod.inject)) {
  console.error("FAIL: missing apply/inject exports"); process.exit(1);
}
console.log("inject:", JSON.stringify(mod.inject));
if (mod.inject.includes("settingsScope")) {
  console.error("FAIL: settingsScope must not be injected anymore"); process.exit(1);
}

// Mock client services.
let themeSnapshot = { preference: "system", resolvedId: "dark" };
const themeSubs = new Set();
const slotsRegistrations = [];
const ctx = {
  get: (name) => {
    if (name === "connection") return { api: { sessions: { models: async () => ({ result: { ok: true, value: { groups: [], current: null } } }), selectModel: async () => ({}) } } };
    if (name === "sessions") return { list: { getSnapshot: () => ({ current: "session-test-1" }) } };
    if (name === "theme") return { getTheme: () => themeSnapshot };
    if (name === "slots") return { inject: (slot, reg) => { slotsRegistrations.push({ slot, reg }); }, register: () => ({}) };
    if (name === "locale") return { register: () => {}, bind: (ns) => (key) => key };
    throw new Error("unknown service " + name);
  },
  on: (event, fn) => { themeSubs.add(fn); return () => themeSubs.delete(fn); },
  effect: (fn) => { disposers.push(fn); },
  slots: { inject: (slot, reg) => { slotsRegistrations.push({ slot, reg }); }, register: (options, component) => ({ options, component }) },
  locale: { register: () => {}, bind: (ns) => (key) => key },
};
const disposers = [];
mod.apply(ctx);
console.log("settings.section registrations:", slotsRegistrations.filter((r) => r.slot === "settings.section").length);
console.log("document click listeners:", listeners.size);

// Simulate a click on the 推理等级 menuitem row.
const row = Object.assign(new FakeHTMLElement(), { textContent: "推理等级 High", closest: () => row, getBoundingClientRect: () => ({ right: 300, bottom: 200, top: 180 }) });
let prevented = false, stopped = false;
const fakeEvent = {
  target: { closest: () => row },
  preventDefault: () => { prevented = true; },
  stopPropagation: () => { stopped = true; },
};
for (const fn of listeners.get("click") ?? []) fn(fakeEvent);
console.log("intercept prevented:", prevented, "stopped:", stopped);
if (!prevented || !stopped) { console.error("FAIL: interception did not prevent default"); process.exit(1); }

// Simulate appearance write through the injected settings section face.
const section = slotsRegistrations.find((r) => r.slot === "settings.section");
if (!section) { console.error("FAIL: settings.section not registered"); process.exit(1); }
const face = section.reg().options?.inject?.();
if (!face || typeof face.read !== "function" || typeof face.setAppearance !== "function") {
  console.error("FAIL: settings.section inject face missing read/setAppearance"); process.exit(1);
}

// Initial load resolves from the mocked GET (apply triggers load()).
await new Promise((r) => setTimeout(r, 10));
console.log("appearance after load:", face.read().appearance);
if (face.read().appearance !== "system") { console.error("FAIL: initial appearance not system"); process.exit(1); }

const saved = await face.setAppearance("light");
console.log("save result:", saved, "appearance after save:", face.read().appearance);
if (saved !== true || face.read().appearance !== "light") {
  console.error("FAIL: setAppearance did not round-trip through the route"); process.exit(1);
}
console.log("resolved after save (light preference):", face.read().resolved);
if (face.read().resolved !== "light") { console.error("FAIL: light preference should resolve light"); process.exit(1); }

// System preference follows the theme snapshot (dark in this mock).
await face.setAppearance("system");
if (face.read().resolved !== "dark") { console.error("FAIL: system preference should follow theme (dark)"); process.exit(1); }
console.log("resolved after system preference:", face.read().resolved);

const saveCalls = fetchCalls.filter((c) => c.method === "POST");
console.log("route POST count:", saveCalls.length);
if (saveCalls.length !== 2) { console.error("FAIL: expected 2 route POSTs"); process.exit(1); }

// Cleanup
for (const d of disposers) d();
console.log("SMOKE TEST PASSED");

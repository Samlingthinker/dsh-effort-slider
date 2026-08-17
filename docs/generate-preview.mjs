// docs/generate-preview.mjs — regenerate docs/preview.html from the REAL panel
// CSS extracted from lib/client.js (single source of truth), with a static
// MAX-state DOM mock for the two themes.
// Usage:  node docs/generate-preview.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = readFileSync(join(root, "lib/client.js"), "utf8");
const m = client.match(/const css = `([\s\S]*?)`;/);
if (!m) throw new Error("panel css literal not found in lib/client.js");
const css = m[1];

const CLOSE_SVG =
	'<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';

function panel(theme) {
	return `
  <div class="es-preview-panel fgSaaq_panel" data-es-theme="${theme}" data-effort-panel="true">
    <div class="fgSaaq_glow"></div>
    <div class="fgSaaq_inner">
      <div class="fgSaaq_head">
        <div class="fgSaaq_headLeft">
          <span class="fgSaaq_labelText">Effort</span>
          <span class="fgSaaq_status fgSaaq_statusMax">MAX</span>
        </div>
        <button type="button" class="fgSaaq_close" aria-label="关闭">${CLOSE_SVG}</button>
      </div>
      <div class="fgSaaq_levelLabels">
        <span class="fgSaaq_levelLabel" style="left:10%">OFF</span>
        <span class="fgSaaq_levelLabel" style="left:26%">Low</span>
        <span class="fgSaaq_levelLabel" style="left:42%">Med</span>
        <span class="fgSaaq_levelLabel" style="left:58%">High</span>
        <span class="fgSaaq_levelLabel" style="left:74%">Extra</span>
        <span class="fgSaaq_levelLabel fgSaaq_levelLabelActive" style="left:90%">MAX</span>
      </div>
      <div class="fgSaaq_trackWrapper">
        <div class="fgSaaq_trackBg"></div>
        <div class="fgSaaq_trackMax fgSaaq_trackMaxOn"></div>
        <div class="fgSaaq_dotsLayer">
          <span class="fgSaaq_dot" style="left:10%"></span>
          <span class="fgSaaq_dot" style="left:26%"></span>
          <span class="fgSaaq_dot" style="left:42%"></span>
          <span class="fgSaaq_dot" style="left:58%"></span>
          <span class="fgSaaq_dot" style="left:74%"></span>
          <span class="fgSaaq_dot fgSaaq_dotActive" style="left:90%"></span>
        </div>
        <div class="fgSaaq_pixel es-preview-pixel"></div>
        <input class="fgSaaq_range" type="range" min="0" max="100" step="1" value="100" />
      </div>
    </div>
  </div>`;
}

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>dsh-effort-slider preview</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 32px;
    background: #d9dde4;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
  }
  .es-preview-col { display: flex; flex-direction: column; gap: 10px; align-items: center; }
  .es-preview-cap { font-size: 12px; color: #5a6180; letter-spacing: .04em; }
  .es-preview-panel { position: static !important; top: auto !important; left: auto !important; }
  /* 静态 mock 的 MAX 像素场：真实 canvas 由 WebGL 绘制，这里用紫色渐变 + 网格近似 */
  .es-preview-pixel {
    opacity: 1 !important;
    background:
      repeating-linear-gradient(90deg, rgba(10, 5, 20, 0.16) 0 1px, transparent 1px 6px),
      repeating-linear-gradient(0deg, rgba(10, 5, 20, 0.16) 0 1px, transparent 1px 6px),
      linear-gradient(90deg, #241a3c, #3c2a78, #6c49b6, #8f63cd);
  }
  ${css}
</style>
</head>
<body>
  <div class="es-preview-col">
    ${panel("light")}
    <div class="es-preview-cap">Light</div>
  </div>
  <div class="es-preview-col">
    ${panel("dark")}
    <div class="es-preview-cap">Dark</div>
  </div>
</body>
</html>
`;

mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs/preview.html"), html, "utf8");
console.log("wrote docs/preview.html");

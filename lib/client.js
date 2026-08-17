/**
 * dsh-effort-slider — 浏览器端实现。
 *
 * 把官方模型菜单中的「推理等级 / Effort」下拉单选列表替换为
 * Codex / Claude Code 风格连续滑块 + 流光粒子动效（WebGL2），
 * 并在设置页提供独立分区（「推理滑块」）：
 *   - 外观：浅色 / 深色 / 跟随系统 三选，控制滑块面板配色
 *   - 面板配色取自 Harness 色板（浅/深两套），字体继承 Harness
 *     （不设 font-family），与整体界面风格一致
 *
 * 结构源自 @captain1275/dsh-client-ui-skin-aurora（BSD-3-Clause）的
 * EffortPanel + useWebglFire（三pass 渲染管线），改造点：
 *   1. 渲染着色器改为「流光粒子」（流动光线流 + 行进粒子 + 拖尾 + 前沿光波）；
 *   2. 面板 CSS 重构为两套主题变量（浅色/深色），由设置项驱动；
 *   3. 去掉皮肤背景/视频/主题等无关部分，新增设置页分区。
 *
 * 数据流全部走官方 API 与服务：
 *   - connection.api.sessions.models / selectModel   读写推理等级
 *   - GET/POST /_dsh/effort-slider/settings          持久化外观设置
 *     （宿主半边零依赖，偏好存 DSH_HOME/effort-slider.json；官方
 *       settings.mutate RPC 只对白名单命名空间开放，第三方插件自带路由）
 *   - theme 服务 + theme/change 事件                   跟随系统判定
 */
window.__ModuleLoader__.load({
	id: "dsh-effort-slider",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_dom_client = require("react-dom/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region shaders
		/** Fullscreen triangle vertex shader. */
		const VERT = `#version 300 es
  layout(location=0) in vec2 a_pos;
  out vec2 v_uv;
  void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }
`;
		/**
		 * 流光粒子模拟着色器：沿轨道从左侧向滑块前沿流动的光线流（stream），
		 * 每格携带一个亮点粒子头 + 向左衰减的拖尾；前沿光波与核心辉光；
		 * 随机火花点缀；亮度随 u_slider 增强；上一帧 u_back 反馈形成拖影。
		 */
		const FRAG_SIM = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform float u_time, u_slider, u_elapsed;
  uniform sampler2D u_back;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main(){
    vec2 uv=v_uv;
    // 粒子网格：46x6（正方形格子，轨道宽高比 ~7.75:1）
    vec2 g=uv*vec2(46.0,6.0);
    vec2 id=floor(g);
    vec2 cf=fract(g);
    float h =hash(id);
    float h2=hash(id+vec2(57.0,19.0));
    vec2 ap=abs(cf-0.5);
    float cell=smoothstep(0.40,0.24,max(ap.x*0.88,ap.y));
    vec3 prev=texture(u_back,uv).rgb;
    float fade_mask=smoothstep(0.0,0.16,uv.x);
    vec3 decay=prev*0.87*fade_mask;
    float t=u_time;
    float intensity=smoothstep(0.0,0.15,u_slider)*mix(0.08,1.0,pow(u_slider,0.55));
    float es=mix(0.15,0.55,min(u_elapsed/1.2,1.0));
    float vy=abs(uv.y-0.5)*2.0;
    float vf=pow(max(1.0-vy*vy*0.55,0.0),0.8);
    // -- 档位色：HIGH=蓝 / MAX=紫；bright=浅一档（保色相，取代纯白）
    float k=smoothstep(0.50,0.92,u_slider);
    vec3 blue =vec3(0.20,0.55,1.00);
    vec3 purp =vec3(0.65,0.35,1.00);
    vec3 accent=mix(blue,purp,k);
    vec3 bright=mix(accent,vec3(1.0),0.10);
    // -- 流光 stream：右密左疏（pow 分布），粒子=浅一档色闪烁
    float spd=0.32+h*0.60;
    float loop=fract(t*spd*0.30+h*6.2831);
    float headX=u_slider*pow(loop,0.45);
    float dx=uv.x-headX;
    float beam =exp(-dx*dx*8.0);
    float trail=exp(-max(headX-uv.x,0.0)*2.2);
    float gate =step(headX,u_slider+0.02);
    float twk=0.6+0.4*sin(t*(4.0+h*5.0)+h*30.0);
    float stream=(beam*0.75+trail*0.30)*vf*gate*twk*intensity*es;
    // -- 火花粒子：从前沿向左漂移的两层亮点（浅一档色）
    float sp1=fract(t*(0.42+h2*0.22)+h2*7.0);
    float sX1=u_slider-sp1*(u_slider*0.9+0.1);
    float sY1=0.5+sin(sp1*11.0+h2*6.2831)*0.30;
    float spark1=smoothstep(0.032,0.0,abs(uv.x-sX1))
                *smoothstep(0.30,0.0,abs(uv.y-sY1))
                *(1.0-sp1)*(1.0-sp1)*es;
    float sp2=fract(t*(0.55+h*0.30)+h*3.0);
    float sX2=u_slider-sp2*(u_slider*0.95+0.05);
    float sY2=0.5+sin(sp2*9.0+h*4.0)*0.24;
    float spark2=smoothstep(0.025,0.0,abs(uv.x-sX2))
                *smoothstep(0.26,0.0,abs(uv.y-sY2))
                *(1.0-sp2)*(1.0-sp2)*es;
    float sparks=(spark1+spark2)*intensity;
    // -- 前沿：实色光带（accent，几乎不露底）+ 紧随其后的光池
    float frontD=u_slider-uv.x;
    float pulse=sin(t*5.0+h2*6.2831)*0.5+0.5;
    float frontBand=(1.0-smoothstep(0.0,0.075,frontD))*vf*(0.42+0.20*pulse)*intensity*es;
    float pool=exp(-max(frontD,0.0)*3.6)*vf*intensity*es*0.12;
    // -- 位置混色：右 1/5 纯实色；向右数 1/5~2/5 区间向左逐步增加浅色概率
    //    rel=0（前沿）→1（最左）；lightProb 在 rel≈0.18~0.42 从 0 升到 1
    float rel=clamp(frontD/max(u_slider,0.02),0.0,1.0);
    float lightProb=smoothstep(0.18,0.42,rel);
    float lp=clamp(lightProb*(0.55+0.75*twk),0.0,1.0);   // 闪烁时脉动（浅色替代实色）
    vec3 pcol=mix(accent,bright,lp);
    // -- 合成：前沿实色光带 + 按位置混色粒子 + 纯 accent 核心（中右半区无白）
    vec3 col=vec3(0.0);
    col+=frontBand*accent;
    col+=(stream+sparks)*pcol;
    col+=pool*accent;
    float core=exp(-pow((uv.x-u_slider)*18.0,2.0));
    col+=accent*core*0.50*(pulse*0.6+0.4)*intensity*es;
    // 软遮罩：格间保留 30% 亮度，配合模糊后连成连续光带（消除离散粒子的割裂感）
    col*=(0.30+0.70*cell);
    col*=fade_mask;
    // -- 保色相亮度压缩：叠加过亮时等比缩放（保持色调，杜绝 RGB 一起饱和发白）
    vec3 outC=decay+col;
    float mL=max(outC.r,max(outC.g,outC.b));
    if(mL>1.05) outC=outC*(1.05/mL);
    fc=vec4(outC,1.0);
  }
`;
		/** 9-tap Gaussian blur (glow pass). */
		const FRAG_BLUR = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_tex;
  uniform vec2 u_dir, u_res;
  uniform float u_ext;
  vec3 s(vec2 uv){
    vec3 c=texture(u_tex,uv).rgb;
    return u_ext>0.5 && dot(c,vec3(0.2126,0.7152,0.0722))<0.22 ? vec3(0.0) : c;
  }
  void main(){
    vec2 o=u_dir*2.6/u_res;
    vec3 r=s(v_uv)*0.227027;
    r+=s(v_uv+o)*0.194595;    r+=s(v_uv-o)*0.194595;
    r+=s(v_uv+o*2.0)*0.121622;r+=s(v_uv-o*2.0)*0.121622;
    r+=s(v_uv+o*3.0)*0.054054;r+=s(v_uv-o*3.0)*0.054054;
    fc=vec4(r,1.0);
  }
`;
		/** Screen-space additive composite (scene + glow); alpha = glow luminance so the
		 *  canvas is transparent away from particles (the light theme blends normally).
		 *  Linear additive + hue-preserving soft clip: never saturates to white. */
		const FRAG_COMP = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_scene, u_glow;
  void main(){
    vec3 s=texture(u_scene,v_uv).rgb;
    vec3 g=texture(u_glow,v_uv).rgb;
    vec3 c=(s+g*0.9)*0.82;
    float mL=max(c.r,max(c.g,c.b));
    c=c/(1.0+mL*0.30);
    mL=max(c.r,max(c.g,c.b));
    if(mL>1.0) c=c/mL;
    float lum=max(c.r,max(c.g,c.b));
    fc=vec4(c,clamp(lum*2.0,0.0,1.0));
  }
`;
		//#endregion
		//#region useWebglFire
		/**
		 * WebGL2 流光渲染循环（三pass：模拟 -> 双向模糊 -> 合成）。
		 * 滑块值与激活状态经 refs 读取，mount 时只启动一次循环；
		 * 滑块跟随用阻尼弹簧，前沿平滑推进。
		 * @param canvasRef - 轨道 canvas。
		 * @param getSlider - 返回当前滑块位置 0..1。
		 * @param getActive - 是否应持续渲染（面板打开）。
		 */
		function useWebglFire(canvasRef, getSlider, getActive) {
			const sliderRef = (0, react.useRef)(0);
			const activeRef = (0, react.useRef)(false);
			sliderRef.current = getSlider();
			activeRef.current = getActive();
			const ensureLoopRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const canvas = canvasRef.current;
				if (canvas === null) {
					console.warn("[effort-slider] liuguang: canvas not found");
					return;
				}
				const gl = canvas.getContext("webgl2", {
					preserveDrawingBuffer: false,
					antialias: false
				});
				if (gl === null) {
					console.warn("[effort-slider] liuguang: webgl2 context unavailable (browser GPU/hardware acceleration off?)");
					return;
				}
				let rafId = null;
				let resizeObserver = null;
				let resizeDebounce;
				let loopRunning = false;
				let idleFrames = 0;
				let startTime = null;
				let springValue = .7;
				let springVelocity = 0;
				let lastSpringTime = 0;
				const MAX_IDLE = 180;
				const SPRING_STIFFNESS = 8;
				const SPRING_DAMP = .62;
				let simProg = null;
				let blurProg = null;
				let compProg = null;
				let vao = null;
				let vbo = null;
				let programsReady = false;
				let simA = null;
				let simB = null;
				let blurH = null;
				let blurV = null;
				const U = {};
				const onContextLost = (e) => e.preventDefault();
				const onContextRestored = () => {
					programsReady = false;
					compilePrograms();
					if (programsReady) {
						resize();
						if (sliderRef.current > 0) ensureLoop();
					}
				};
				function compileShader(type, src) {
					const sh = gl.createShader(type);
					if (sh === null) return null;
					gl.shaderSource(sh, src);
					gl.compileShader(sh);
					if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
						gl.deleteShader(sh);
						return null;
					}
					return sh;
				}
				function linkProgram(vsSrc, fsSrc) {
					const v = compileShader(gl.VERTEX_SHADER, vsSrc);
					const f = compileShader(gl.FRAGMENT_SHADER, fsSrc);
					if (v === null || f === null) return null;
					const p = gl.createProgram();
					if (p === null) return null;
					gl.attachShader(p, v);
					gl.attachShader(p, f);
					gl.bindAttribLocation(p, 0, "a_pos");
					gl.linkProgram(p);
					gl.deleteShader(v);
					gl.deleteShader(f);
					if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
					return p;
				}
				function compilePrograms() {
					simProg = linkProgram(VERT, FRAG_SIM);
					blurProg = linkProgram(VERT, FRAG_BLUR);
					compProg = linkProgram(VERT, FRAG_COMP);
					if (simProg === null || blurProg === null || compProg === null) return;
					vao = gl.createVertexArray();
					gl.bindVertexArray(vao);
					vbo = gl.createBuffer();
					gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
					gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
						-1,
						-1,
						1,
						-1,
						-1,
						1,
						-1,
						1,
						1,
						-1,
						1,
						1
					]), gl.STATIC_DRAW);
					gl.enableVertexAttribArray(0);
					gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
					U.simTime = gl.getUniformLocation(simProg, "u_time");
					U.simSlider = gl.getUniformLocation(simProg, "u_slider");
					U.simElapsed = gl.getUniformLocation(simProg, "u_elapsed");
					U.simBack = gl.getUniformLocation(simProg, "u_back");
					U.blurDir = gl.getUniformLocation(blurProg, "u_dir");
					U.blurExt = gl.getUniformLocation(blurProg, "u_ext");
					U.blurTex = gl.getUniformLocation(blurProg, "u_tex");
					U.blurRes = gl.getUniformLocation(blurProg, "u_res");
					U.compScene = gl.getUniformLocation(compProg, "u_scene");
					U.compGlow = gl.getUniformLocation(compProg, "u_glow");
					programsReady = true;
				}
				function makeFBO() {
					const fbo = gl.createFramebuffer();
					const tex = gl.createTexture();
					if (fbo === null || tex === null) return null;
					gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
					gl.bindTexture(gl.TEXTURE_2D, tex);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
					gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
					gl.clearColor(0, 0, 0, 1);
					gl.clear(gl.COLOR_BUFFER_BIT);
					return {
						fbo,
						tex
					};
				}
				function createFBOs() {
					simA = makeFBO();
					simB = makeFBO();
					blurH = makeFBO();
					blurV = makeFBO();
				}
				function destroyFBO(entry) {
					if (entry === null) return;
					gl.deleteFramebuffer(entry.fbo);
					gl.deleteTexture(entry.tex);
				}
				function destroyFBOs() {
					destroyFBO(simA);
					simA = null;
					destroyFBO(simB);
					simB = null;
					destroyFBO(blurH);
					blurH = null;
					destroyFBO(blurV);
					blurV = null;
				}
				function destroyPrograms() {
					if (simProg !== null) gl.deleteProgram(simProg);
					if (blurProg !== null) gl.deleteProgram(blurProg);
					if (compProg !== null) gl.deleteProgram(compProg);
					if (vao !== null) gl.deleteVertexArray(vao);
					if (vbo !== null) gl.deleteBuffer(vbo);
					simProg = blurProg = compProg = null;
					vao = null;
					vbo = null;
					programsReady = false;
				}
				function resize() {
					const rect = canvas.getBoundingClientRect();
					const w = rect.width || canvas.clientWidth || 132;
					const h = rect.height || canvas.clientHeight || 30;
					if (!w || !h) return;
					const dpr = window.devicePixelRatio || 1;
					canvas.width = Math.round(w * dpr);
					canvas.height = Math.round(h * dpr);
					destroyFBOs();
					createFBOs();
				}
				function ensureLoop() {
					if (simA === null || simB === null) {
						resize();
						if (simA === null || simB === null) return;
					}
					if (loopRunning) {
						idleFrames = 0;
						return;
					}
					loopRunning = true;
					idleFrames = 0;
					startTime = performance.now();
					lastSpringTime = performance.now();
					springValue = sliderRef.current;
					springVelocity = 0;
					gl.bindFramebuffer(gl.FRAMEBUFFER, simA.fbo);
					gl.clear(gl.COLOR_BUFFER_BIT);
					gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
					gl.clear(gl.COLOR_BUFFER_BIT);
					rafId = requestAnimationFrame(render);
				}
				ensureLoopRef.current = ensureLoop;
				function renderFrame(t) {
					const now = performance.now();
					const dt = Math.min((now - lastSpringTime) / 1e3, .05);
					lastSpringTime = now;
					const target = sliderRef.current;
					// 双向阻尼弹簧：拖动回退时前沿也平滑跟随，不再瞬跳（消除割裂感）。
					const diff = target - springValue;
					if (Math.abs(diff) > 0.0005) {
						const force = diff * SPRING_STIFFNESS;
						springVelocity += force * dt;
						springVelocity *= 1 - SPRING_DAMP * dt * 6;
						springValue += springVelocity * dt;
						if ((diff > 0 && springValue >= target) || (diff < 0 && springValue <= target)) {
							springValue = target;
							springVelocity = 0;
						}
					}
					if (sliderRef.current <= 0 && !activeRef.current) {
						if (++idleFrames > MAX_IDLE) {
							loopRunning = false;
							rafId = null;
							return;
						}
						return;
					}
					idleFrames = 0;
					const elapsed = startTime !== null ? (now - startTime) / 1e3 : 0;
					gl.viewport(0, 0, canvas.width, canvas.height);
					if (simB !== null && simProg !== null && blurProg !== null && compProg !== null && blurH !== null && blurV !== null && simA !== null) {
						gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
						gl.useProgram(simProg);
						gl.uniform1f(U.simTime, t * .001);
						gl.uniform1f(U.simSlider, springValue);
						gl.uniform1f(U.simElapsed, elapsed);
						gl.activeTexture(gl.TEXTURE0);
						gl.bindTexture(gl.TEXTURE_2D, simA.tex);
						gl.uniform1i(U.simBack, 0);
						gl.drawArrays(gl.TRIANGLES, 0, 6);
						gl.useProgram(blurProg);
						gl.uniform2f(U.blurRes, canvas.width, canvas.height);
						gl.bindFramebuffer(gl.FRAMEBUFFER, blurH.fbo);
						gl.uniform2f(U.blurDir, 1, 0);
						gl.uniform1f(U.blurExt, 1);
						gl.bindTexture(gl.TEXTURE_2D, simB.tex);
						gl.uniform1i(U.blurTex, 0);
						gl.drawArrays(gl.TRIANGLES, 0, 6);
						gl.bindFramebuffer(gl.FRAMEBUFFER, blurV.fbo);
						gl.uniform2f(U.blurDir, 0, 1);
						gl.uniform1f(U.blurExt, 0);
						gl.bindTexture(gl.TEXTURE_2D, blurH.tex);
						gl.drawArrays(gl.TRIANGLES, 0, 6);
						gl.bindFramebuffer(gl.FRAMEBUFFER, null);
						gl.useProgram(compProg);
						gl.activeTexture(gl.TEXTURE0);
						gl.bindTexture(gl.TEXTURE_2D, simB.tex);
						gl.uniform1i(U.compScene, 0);
						gl.activeTexture(gl.TEXTURE1);
						gl.bindTexture(gl.TEXTURE_2D, blurV.tex);
						gl.uniform1i(U.compGlow, 1);
						gl.drawArrays(gl.TRIANGLES, 0, 6);
						const tmp = simA;
						simA = simB;
						simB = tmp;
					}
				}
				function render(t) {
					renderFrame(t);
					if (loopRunning) rafId = requestAnimationFrame(render);
				}
				canvas.addEventListener("webglcontextlost", onContextLost);
				canvas.addEventListener("webglcontextrestored", onContextRestored);
				compilePrograms();
				if (programsReady) {
					console.log(`[effort-slider] liuguang: gl ready (canvas ${canvas.clientWidth}x${canvas.clientHeight})`);
					resizeObserver = new ResizeObserver(() => {
						window.clearTimeout(resizeDebounce);
						resizeDebounce = window.setTimeout(resize, 80);
					});
					resizeObserver.observe(canvas);
					resize();
					console.log(`[effort-slider] liuguang: buffer ${canvas.width}x${canvas.height}`);
					if (sliderRef.current > 0) ensureLoop();
					else console.warn("[effort-slider] liuguang: skipped start, slider=0");
				} else console.warn("[effort-slider] liuguang: shader/program compile failed");
				return () => {
					if (rafId !== null) cancelAnimationFrame(rafId);
					resizeObserver?.disconnect();
					window.clearTimeout(resizeDebounce);
					loopRunning = false;
					destroyFBOs();
					destroyPrograms();
					canvas.removeEventListener("webglcontextlost", onContextLost);
					canvas.removeEventListener("webglcontextrestored", onContextRestored);
					ensureLoopRef.current = null;
				};
			}, [canvasRef]);
			(0, react.useEffect)(() => {
				if (sliderRef.current > 0) ensureLoopRef.current?.();
			});
		}
		//#endregion
		//#region useMaxPixelField
		/**
		 * 像素场（移植自 dsh-client-ui-effort-slider v0.4.5，MIT）：
		 * High 及以上档位时轨道变成动画像素场——扫过式显现 + 流动闪烁；
		 * High / Extra = 蓝色（色板），MAX = 紫色（色板按 blend 平滑过渡）；
		 * 覆盖区右缘始终跟随滑块 thumb（右侧保持干净）。
		 * 渲染逻辑一致，仅色板与覆盖范围不同。
		 * 离开时清空画布。Canvas 2D 渲染：网格预计算一次，每帧只做
		 * 时间相关运算；尊重 prefers-reduced-motion（静态帧，不启动循环）。
		 * @param canvasRef - 轨道内像素画布（.fgSaaq_pixel）。
		 * @param getMax - 返回当前是否处于 High / MAX 档位。
		 * @param getBlend - 返回 High→MAX 连续过渡系数 0..1（0 = 蓝色，1 = 紫色）。
		 * @param getThemeMode - 返回当前外观模式（深色时 off 侧改暗锚点）。
		 * @param getThumb - 返回滑块位置 0..100（像素覆盖区右缘）。
		 */
		// 像素场色板：MAX = 紫色（整条轨道）；High / Extra = 蓝色（左半轨道）。
		// 蓝色版深端锚点 #487EEE（用户选定），11 级 tone 按紫色同款衰减曲线
		// 平滑过渡到浅端：色相恒定 ~220°，饱和度 70% → 24% 递减。
		const PURPLE_PALETTE = {
			left: [210, 206, 214],
			tones: [
				[150, 96, 205], [150, 96, 205], [156, 118, 200], [156, 118, 200],
				[166, 140, 206], [166, 140, 206], [166, 140, 206],
				[170, 154, 206], [170, 154, 206], [182, 168, 206], [194, 182, 206]
			],
			highlight: [196, 182, 222],
			peak: [212, 198, 234],
			rClamp: [140, 196],
			gClamp: [104, 168],
			bClamp: [182, 216],
			boost: 1
		};
		const BLUE_PALETTE = {
			left: [212, 218, 226],
			tones: [
				[72, 126, 238], [72, 126, 238], [86, 138, 240], [86, 138, 240],
				[104, 152, 242], [104, 152, 242], [104, 152, 242],
				[124, 166, 243], [124, 166, 243], [146, 182, 244], [172, 200, 246]
			],
			highlight: [198, 216, 250],
			peak: [222, 232, 252],
			rClamp: [62, 190],
			gClamp: [134, 196],
			bClamp: [215, 255],
			boost: 1
		};
		/** 深色主题的 off 侧锚点：暗蓝灰 / 暗紫灰（浅色主题的灰白左端在深色下改暗）。 */
		const DARK_BLUE_LEFT = [26, 24, 44];
		const DARK_PURPLE_LEFT = [24, 19, 40];
		function useMaxPixelField(canvasRef, getMax, getBlend, getThemeMode, getThumb) {
			const maxRef = (0, react.useRef)(false);
			maxRef.current = getMax();
			/** High→MAX 连续过渡系数：0=蓝色，1=紫色（色板插值，与覆盖范围无关）。 */
			const blendRef = (0, react.useRef)(1);
			blendRef.current = getBlend ? getBlend() : 1;
			/** 当前外观模式（dark 时像素场 off 侧改暗锚点）。 */
			const themeModeRef = (0, react.useRef)("light");
			themeModeRef.current = getThemeMode ? getThemeMode() : "light";
			/** 滑块位置 0..100：像素覆盖区右缘跟随 thumb，右侧始终干净。 */
			const thumbRef = (0, react.useRef)(0);
			thumbRef.current = getThumb ? getThumb() : 0;
			const prevMaxRef = (0, react.useRef)(false);
			const startedAtRef = (0, react.useRef)(0);
			const gridRef = (0, react.useRef)([]);
			const cellRef = (0, react.useRef)(6);
			const gapRef = (0, react.useRef)(1.1);
			const stateRef = (0, react.useRef)({
				ctx: null,
				width: 0,
				height: 0,
				ratio: 1,
				rafId: null,
				loopRunning: false,
				lastFrame: 0,
				reduced: false
			});
			const startLoopRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const canvas = canvasRef.current;
				if (canvas === null) {
					console.warn("[effort-slider] max-pixel: canvas not found");
					return;
				}
				const ctx = canvas.getContext("2d");
				if (ctx === null) {
					console.warn("[effort-slider] max-pixel: 2d context unavailable");
					return;
				}
				const state = stateRef.current;
				state.ctx = ctx;
				state.reduced = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
				const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
				const smoothstep = (e0, e1, v) => {
					const x = clamp((v - e0) / (e1 - e0), 0, 1);
					return x * x * (3 - 2 * x);
				};
				const mix = (a, b, t) => a + (b - a) * t;
				const mixColor = (from, to, amount) => `rgb(${Math.round(mix(from[0], to[0], amount))} ${Math.round(mix(from[1], to[1], amount))} ${Math.round(mix(from[2], to[2], amount))})`;
				/** 网格预计算：位置、哈希、场梯度——每帧只做时间相关运算。
				 *  方形格子铺满全轨（与 MAX 同款），1/2 带只取左半列，粒子形状不变。 */
				function buildGrid() {
					const width = state.width;
					const height = state.height;
					const cell = width < 280 ? 5 : 6;
					const gap = 1.1;
					const columns = Math.ceil(width / cell);
					const rows = Math.ceil(height / cell);
					const cells = [];
					for (let row = 0; row < rows; row += 1) {
						for (let column = 0; column < columns; column += 1) {
							const x = column * cell;
							const y = row * cell;
							const nX = (x + cell * 0.5) / width;
							cells.push({
								x, y, row, column, nX,
								base: Math.abs(Math.sin(column * 12.9898 + row * 78.233) * 43758.5453) % 1,
								tempo: Math.abs(Math.sin(column * 7.13 + row * 19.41) * 19341.731) % 1,
								phase: Math.abs(Math.sin(column * 31.17 + row * 11.93) * 28437.123) % 1,
								chroma: Math.abs(Math.sin(column * 9.47 + row * 67.13) * 15823.917) % 1,
								purple: smoothstep(0.1, 0.88, nX),
								intensity: smoothstep(0.04, 0.38, nX),
								depth: smoothstep(0.35, 0.95, nX)
							});
						}
					}
					gridRef.current = cells;
					cellRef.current = cell;
					gapRef.current = gap;
				}
				function resize() {
					const rect = canvas.getBoundingClientRect();
					const w = rect.width || canvas.clientWidth || 280;
					const h = rect.height || canvas.clientHeight || 32;
					if (!w || !h) return;
					const ratio = Math.min(window.devicePixelRatio || 1, 2);
					canvas.width = Math.round(w * ratio);
					canvas.height = Math.round(h * ratio);
					canvas.style.width = `${w}px`;
					canvas.style.height = `${h}px`;
					state.width = w;
					state.height = h;
					state.ratio = ratio;
					buildGrid();
					draw(Date.now());
				}
				/** 一帧像素场绘制（时间相关运算）。非 MAX 时清空画布。 */
				function draw(time) {
					if (state.ctx === null || !canvas.width || !canvas.height) return;
					const { ctx } = state;
					const ratio = state.ratio;
					const width = state.width;
					const height = state.height;
					ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
					ctx.clearRect(0, 0, width, height);
					if (!maxRef.current) return;
					const blend = blendRef.current;
					// 覆盖区右缘跟随 thumb：Off→High、High→MAX 全程右侧干净，
					// 像素前沿始终贴着滑块末端（不再固定左半轨）。
					const maskFrac = clamp(thumbRef.current / 100, 0, 1);
					const reveal = state.reduced ? 1 : smoothstep(0, 1, (time - startedAtRef.current) / 1000);
					// 显现带锚定在覆盖区右缘（滑块拇指处）向左扫：
					// High 打开即见；MAX（maskFrac=1）时与原来一致（从轨道右缘向左扫）。
					const frontier = maskFrac * (1 - reveal);
					const bandIn = 0.1 * maskFrac;
					const bandOut = 0.07 * maskFrac;
					const cells = gridRef.current;
					const cell = cellRef.current;
					// 格子间隙连续：High 0.2px（近无缝、极淡像素感）→ MAX 1.1px。
					const gap = 0.2 + (gapRef.current - 0.2) * blend;
					const elapsed = Math.max(0, time - startedAtRef.current);
					// 色板连续：蓝 → 紫按 blend 插值（含 tone 数组与 clamp 范围）。
					// off 侧锚点随主题切换：深色主题用暗蓝灰/暗紫灰，避免左端灰白。
					const darkTheme = themeModeRef.current === "dark";
					const blueLeft = darkTheme ? DARK_BLUE_LEFT : BLUE_PALETTE.left;
					const purpleLeft = darkTheme ? DARK_PURPLE_LEFT : PURPLE_PALETTE.left;
					const mixArr = (x, y) => [mix(x[0], y[0], blend), mix(x[1], y[1], blend), mix(x[2], y[2], blend)];
					const pal = {
						left: mixArr(blueLeft, purpleLeft),
						tones: BLUE_PALETTE.tones.map((tone, i) => mixArr(tone, PURPLE_PALETTE.tones[i])),
						highlight: mixArr(BLUE_PALETTE.highlight, PURPLE_PALETTE.highlight),
						peak: mixArr(BLUE_PALETTE.peak, PURPLE_PALETTE.peak),
						rClamp: [mix(BLUE_PALETTE.rClamp[0], PURPLE_PALETTE.rClamp[0], blend), mix(BLUE_PALETTE.rClamp[1], PURPLE_PALETTE.rClamp[1], blend)],
						gClamp: [mix(BLUE_PALETTE.gClamp[0], PURPLE_PALETTE.gClamp[0], blend), mix(BLUE_PALETTE.gClamp[1], PURPLE_PALETTE.gClamp[1], blend)],
						bClamp: [mix(BLUE_PALETTE.bClamp[0], PURPLE_PALETTE.bClamp[0], blend), mix(BLUE_PALETTE.bClamp[1], PURPLE_PALETTE.bClamp[1], blend)],
						boost: mix(BLUE_PALETTE.boost, PURPLE_PALETTE.boost, blend)
					};
					const leftColor = pal.left;
					const tones = pal.tones;
					const highlightColor = pal.highlight;
					const peakColor = pal.peak;
					const rClamp = pal.rClamp;
					const gClamp = pal.gClamp;
					const bClamp = pal.bClamp;
					const flowDuration = 4000;
					const rawFlow = elapsed / flowDuration;
					const flowCycle = Math.floor(rawFlow);
					const easedFlow = flowCycle + smoothstep(0, 1, rawFlow - flowCycle);
					ctx.save();
					ctx.beginPath();
					if (typeof ctx.roundRect === "function") ctx.roundRect(0, 0, width, height, 10);
					else ctx.rect(0, 0, width, height);
					ctx.clip();
					for (const c of cells) {
						const { x, y, row, nX, base, tempo, phase, chroma, purple, intensity, depth } = c;
						// 覆盖区只取 nX ≤ maskFrac 的方形格子（粒子形状不变，覆盖范围随 blend 平滑扩展）。
						if (maskFrac < 1 && nX > maskFrac) continue;
						const nLocal = nX / Math.max(maskFrac, 0.001);
						// 亮度随 MAX 过渡连续增强：High 平基线(1) → MAX 空间渐变(intensity)。
						const effIntensity = mix(1, intensity, blend);
						const revealAlpha = smoothstep(frontier - bandIn, frontier + bandOut, nX);
						if (revealAlpha <= 0.002) continue;
						const period = 500 + tempo * 1500;
						const localTime = elapsed + phase * period;
						const cycle = Math.floor(localTime / period);
						const cycleProgress = (localTime % period) / period;
						const cycleHash = Math.abs(Math.sin(c.column * 17.17 + row * 41.73 + cycle * 13.11) * 24634.6345) % 1;
						const widthHash = Math.abs(Math.sin(c.column * 5.37 + row * 29.11 + cycle * 7.43) * 17391.443) % 1;
						const pulseCenter = 0.2 + cycleHash * 0.55;
						const pulseWidth = 0.09 + widthHash * 0.08;
						const pulseDistance = (cycleProgress - pulseCenter) / pulseWidth;
						const pulseEnvelope = Math.exp(-pulseDistance * pulseDistance * 1.45);
						const activeCycle = cycleHash > 0.12 ? 1 : 0.26;
						const irregularFlicker = pulseEnvelope * activeCycle;
						// 流动/波带沿用全轨坐标（与 MAX 同密度）。
						const flowCoordinate = (nX + easedFlow) * 9;
						const flowIndex = Math.floor(flowCoordinate);
						const flowProgress = smoothstep(0, 1, flowCoordinate - flowIndex);
						const flowHashA = Math.abs(Math.sin(flowIndex * 18.31 + row * 37.17) * 19283.173) % 1;
						const flowHashB = Math.abs(Math.sin((flowIndex + 1) * 18.31 + row * 37.17) * 19283.173) % 1;
						const clusterGate = smoothstep(0.46, 0.84, mix(flowHashA, flowHashB, flowProgress));
						const wavePhase = (nX + easedFlow + row * 0.06 + base * 0.02) * Math.PI * 2;
						const directionalWave = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 5);
						const directionalFlow = Math.max(clusterGate, directionalWave * 0.62);
						const flowingFlicker = Math.max(
							irregularFlicker * (0.48 + directionalFlow * 0.58),
							directionalFlow * (0.38 + base * 0.28)
						);
						let lightAmount = flowingFlicker;
						const revealGlow = reveal < 0.995
							? Math.exp(-((nX - frontier) ** 2) / 0.012) * (1 - smoothstep(0.7, 1, reveal))
							: 0;
						lightAmount = Math.max(lightAmount, revealGlow * (0.4 + base * 0.4));
						const peakHighlight = lightAmount > 0.4 && irregularFlicker > 0.16 && cycleHash > 0.26 && clusterGate > 0.04;
						const hottestHighlight = lightAmount > 0.68 && irregularFlicker > 0.3 && cycleHash > 0.48 && clusterGate > 0.12;
						const highlightAmount = peakHighlight
							? 0.97
							: clamp(lightAmount * (0.44 + cycleHash * 0.3), 0, 0.64);
						let color;
						// --- High 光带模型：off 侧灰白 → 深 tone 渐变（70/30），闪烁只做亮度/高光调制。 ---
						const deepTone = tones[0];
						const bandPurple = clamp(nLocal / 0.70, 0, 1);
						const bandColor = [
							mix(leftColor[0], deepTone[0], bandPurple),
							mix(leftColor[1], deepTone[1], bandPurple),
							mix(leftColor[2], deepTone[2], bandPurple)
						];
						// --- MAX tone 漂移模型：全 tone 数组随时间/空间漂移。 ---
						const toneDrift =
							base * 0.28
							+ depth * 0.28
							+ cycleProgress * 0.38
							+ easedFlow * 0.18
							+ cycleHash * 0.2
							+ Math.sin(elapsed * 0.00135 + phase * Math.PI * 2) * 0.14;
						const tonePosition = (((toneDrift % 1) + 1) % 1) * tones.length;
						const toneIndex = Math.floor(tonePosition);
						const toneMix = tonePosition - toneIndex;
						const toneA = tones[toneIndex];
						const toneB = tones[(toneIndex + 1) % tones.length];
						const cellTone = [
							mix(toneA[0], toneB[0], toneMix),
							mix(toneA[1], toneB[1], toneMix),
							mix(toneA[2], toneB[2], toneMix)
						];
						const chromaNudge = (chroma - 0.5) * 10 + depth * 12;
						const variedPurple = [
							clamp(cellTone[0] + chromaNudge * 0.35 - depth * 8, rClamp[0], rClamp[1]),
							clamp(cellTone[1] - depth * 16 + (base - 0.5) * 8, gClamp[0], gClamp[1]),
							clamp(cellTone[2] + depth * 6 + (cycleHash - 0.5) * 6, bClamp[0], bClamp[1])
						];
						const maxColor = [
							mix(leftColor[0], variedPurple[0], purple),
							mix(leftColor[1], variedPurple[1], purple),
							mix(leftColor[2], variedPurple[2], purple)
						];
						// --- 连续过渡：High 光带 → MAX tone 场按 blend 交叉淡化。 ---
						const blendedColor = [
							mix(bandColor[0], maxColor[0], blend),
							mix(bandColor[1], maxColor[1], blend),
							mix(bandColor[2], maxColor[2], blend)
						];
						color = hottestHighlight
							? mixColor(blendedColor, peakColor, 0.95)
							: mixColor(blendedColor, highlightColor, highlightAmount);
						// 亮度基线连续：High 更平(0.82~0.90) → MAX 更宽(0.7~0.9)。
						const baseOpacity = mix(0.82 + base * 0.08, 0.7 + base * 0.2, blend);
						ctx.globalAlpha = (peakHighlight || hottestHighlight
							? revealAlpha * effIntensity
							: revealAlpha * effIntensity * clamp(baseOpacity + flowingFlicker * 0.12, 0, 1)) * pal.boost;
						ctx.fillStyle = color;
						ctx.fillRect(x + gap * 0.5, y + gap * 0.5, cell - gap, cell - gap);
					}
					ctx.restore();
					ctx.globalAlpha = 1;
				}
				function ensureLoop() {
					if (state.loopRunning) return;
					if (!maxRef.current) return;
					state.loopRunning = true;
					state.lastFrame = 0;
					const step = (t) => {
						if (!state.loopRunning) return;
						if (!maxRef.current) {
							state.loopRunning = false;
							state.rafId = null;
							try { draw(Date.now()); } catch (err) { console.warn("[effort-slider] max-pixel draw error:", err); }
							return;
						}
						if (t - state.lastFrame >= 33) {
							state.lastFrame = t;
							try { draw(Date.now()); } catch (err) { console.warn("[effort-slider] max-pixel draw error:", err); }
						}
						state.rafId = requestAnimationFrame(step);
					};
					state.rafId = requestAnimationFrame(step);
				}
				startLoopRef.current = ensureLoop;
				let resizeObserver = null;
				let resizeDebounce;
				resizeObserver = new ResizeObserver(() => {
					window.clearTimeout(resizeDebounce);
					resizeDebounce = window.setTimeout(resize, 80);
				});
				resizeObserver.observe(canvas);
				resize();
				return () => {
					if (state.rafId !== null) cancelAnimationFrame(state.rafId);
					state.rafId = null;
					state.loopRunning = false;
					resizeObserver?.disconnect();
					window.clearTimeout(resizeDebounce);
					state.ctx = null;
				};
			}, [canvasRef]);
			// 每次渲染后：进入 MAX 时重置显现起点并启动循环。
			(0, react.useEffect)(() => {
				if (maxRef.current && !prevMaxRef.current) startedAtRef.current = Date.now();
				prevMaxRef.current = maxRef.current;
				if (maxRef.current) startLoopRef.current?.();
			});
		}
		//#endregion
		//#region css
		/**
		 * 面板样式：两套主题由 `.fgSaaq_panel[data-es-theme="dark"|"light"]` 上的
		 * `--es-*` 变量驱动。取值来自 Harness 深/浅色板（与皮肤中心同源），
		 * 字体不设 font-family，继承 Harness 全局字体。
		 * 深色主题：面板背景转深紫黑；轨道转深紫灰（比面板略亮一档，紫系
		 * 圆点/描边），流光切 screen 混合在深轨道上发光；滑块头为浅薰衣草渐变，
		 * 作为深轨道上的实体旋钮。
		 */
		const css = `.fgSaaq_panel{user-select:none;z-index:10;pointer-events:auto;width:280px;position:absolute;top:0;left:0}
.fgSaaq_panel[data-es-theme="dark"]{--es-glow:linear-gradient(135deg,#a855f74d,#3b82f626,#a855f733);--es-inner-bg:linear-gradient(160deg,#0e0a16 0%,#140e20 50%,#0c0818 100%);--es-inner-border:#a855f71f;--es-inner-shadow:0 8px 32px #00000080,inset 0 1px #ffffff0a;--es-label-text:#8880a0;--es-status:#aaa0c0;--es-status-glow:#c084fc;--es-level-label:#6a6080;--es-level-label-active:#c084fc;--es-track-bg:linear-gradient(135deg,#1c1428,#110b1c);--es-track-border:#a855f72e;--es-dot:#a855f74d;--es-dot-active:#c084fc;--es-fire-blend:screen;--es-track-max:linear-gradient(90deg,#181228 0%,#201838 14%,#2e2056 30%,#402a7c 48%,#54389c 68%,#6c49b6 85%,#8f63cd 100%);--es-close-color:#8880a0;--es-close-hover-color:#e8e0f0;--es-close-hover-bg:#a855f729;--es-close-shadow-hover:0 1px 2px rgba(0,0,0,.45),0 2px 12px rgba(168,85,247,.30);--es-thumb-bg:linear-gradient(145deg,#f4eefb 0%,#dccfee 50%,#cbb8e6 100%);--es-thumb-ring:#a855f726;--es-thumb-active-ring:#a855f740;--es-point-light:radial-gradient(circle,#a855f733 0%,#a855f70f 30%,#a855f704 55%,#0000 70%);--es-empty:#6a6080}
.fgSaaq_panel[data-es-theme="light"]{--es-glow:linear-gradient(135deg,#7aa2ff40,#3b82f61f,#a855f72e);--es-inner-bg:linear-gradient(160deg,#fbfcff 0%,#f2f5ff 50%,#f7f4ff 100%);--es-inner-border:#8ca0ff40;--es-inner-shadow:0 8px 32px #1a234414,inset 0 1px #ffffff;--es-label-text:#5a6180;--es-status:#3a4157;--es-status-glow:#3b5bd8;--es-level-label:#8b92ad;--es-level-label-active:#3b5bd8;--es-track-bg:linear-gradient(135deg,#e6e8ec,#d5d8de);--es-track-border:#8b93a345;--es-dot:#3b5bd833;--es-dot-active:#3b5bd8;--es-fire-blend:normal;--es-track-max:linear-gradient(90deg,#eeebe9 0%,#e6e0ea 14%,#d8c9ec 30%,#c5a8e4 48%,#b08ddc 68%,#9d74d2 85%,#8f63cd 100%);--es-close-color:#5a6180;--es-close-hover-color:#232842;--es-close-hover-bg:#3b5bd829;--es-close-shadow-hover:0 1px 2px rgba(26,35,68,.08),0 4px 14px rgba(26,35,68,.18);--es-thumb-bg:linear-gradient(145deg,#ffffff 0%,#e8ecfa 50%,#d8def4 100%);--es-thumb-ring:#3b5bd826;--es-thumb-active-ring:#3b5bd840;--es-point-light:radial-gradient(circle,#7aa2ff30 0%,#7aa2ff0e 30%,#7aa2ff04 55%,#0000 70%);--es-empty:#8b92ad}
.fgSaaq_glow{opacity:.6;filter:blur(8px);z-index:0;pointer-events:none;background:var(--es-glow);border-radius:18px;position:absolute;inset:-3px}
.fgSaaq_inner{z-index:1;background:var(--es-inner-bg);border:1px solid var(--es-inner-border);border-radius:13px;padding:4px 4px 12px 10px;position:relative;box-shadow:var(--es-inner-shadow)}
.fgSaaq_head{justify-content:space-between;align-items:center;margin-bottom:2px;display:flex}
.fgSaaq_headLeft{align-items:baseline;gap:7px;font-size:14px;font-weight:500;display:inline-flex;overflow:hidden}
.fgSaaq_labelText{color:var(--es-label-text);letter-spacing:.03em;font-weight:600}
.fgSaaq_status{color:var(--es-status);text-transform:uppercase;will-change:transform,opacity,filter;vertical-align:middle;font-family:Georgia,Palatino Linotype,serif;font-style:italic;font-weight:700;transition:color .4s cubic-bezier(.25,.46,.45,.94),text-shadow .4s cubic-bezier(.25,.46,.45,.94);display:inline-block}
.fgSaaq_statusGlow{color:var(--es-status-glow);text-shadow:0 0 14px var(--es-status-glow)}
.fgSaaq_level0{color:#c882a0bf}.fgSaaq_level1{color:#c8aa82bf}.fgSaaq_level2{color:#82aac8bf}.fgSaaq_level3{color:#c084fcf2;text-shadow:0 0 10px #a855f7b3}.fgSaaq_level4{color:#d8b4fe;text-shadow:0 0 12px #a855f7}
.fgSaaq_close{color:var(--es-close-color);cursor:pointer;background:transparent;border:0;border-radius:8px;justify-content:center;align-items:center;width:24px;height:24px;display:inline-flex;transition:color .15s ease-out,background-color .15s ease-out,box-shadow .18s ease-out,transform .15s ease-out}
.fgSaaq_close svg{width:12px;height:12px;display:block}
.fgSaaq_close:hover{color:var(--es-close-hover-color);background:var(--es-close-hover-bg);box-shadow:var(--es-close-shadow-hover)}
.fgSaaq_close:active{transform:scale(.94);box-shadow:none}
.fgSaaq_close:focus-visible{outline:2px solid color-mix(in srgb,currentColor 45%,transparent);outline-offset:1px}
.fgSaaq_levelLabels{height:15px;margin-bottom:4px;position:relative}
.fgSaaq_levelLabel{color:var(--es-level-label);letter-spacing:.04em;text-transform:uppercase;font-size:10px;font-weight:700;transition:color .15s;position:absolute;top:0;transform:translate(-50%)}
.fgSaaq_levelLabelActive{color:var(--es-level-label-active)}
.fgSaaq_trackWrapper{isolation:isolate;background:var(--es-track-bg,#08050e);border:1px solid var(--es-track-border);border-radius:8px;height:32px;position:relative;overflow:hidden}
.fgSaaq_trackBg{z-index:0;background:var(--es-track-bg);position:absolute;inset:0}
.fgSaaq_dotsLayer{pointer-events:none;z-index:1;position:absolute;inset:0}
.fgSaaq_dot{background:var(--es-dot);border-radius:50%;width:4px;height:4px;transition:background .15s,box-shadow .15s;position:absolute;top:50%;transform:translateY(-50%)}
.fgSaaq_dotActive{background:var(--es-dot-active);box-shadow:0 0 8px var(--es-dot-active)}
.fgSaaq_fire{pointer-events:none;mix-blend-mode:var(--es-fire-blend,screen);z-index:2;width:100%;height:100%;position:absolute;inset:0}
.fgSaaq_range{-webkit-appearance:none;appearance:none;cursor:pointer;z-index:5;background:0 0;outline:none;width:100%;height:100%;margin:0;padding:0;position:absolute;inset:0}
.fgSaaq_range::-webkit-slider-thumb{-webkit-appearance:none;cursor:grab;background:var(--es-thumb-bg);border:1px solid var(--es-thumb-ring);border-radius:8px;width:28px;height:28px;transition:box-shadow .5s cubic-bezier(.25,.46,.45,.94),transform .35s cubic-bezier(.34,1.56,.64,1);box-shadow:inset 0 1px #ffffff80}
.fgSaaq_range::-webkit-slider-thumb:active{cursor:grabbing;transform:scale(.92);border-color:var(--es-thumb-active-ring);box-shadow:inset 0 1px #ffffff80}
.fgSaaq_range::-moz-range-thumb{cursor:grab;background:var(--es-thumb-bg);border:1px solid var(--es-thumb-ring);border-radius:7px;width:26px;height:26px;box-shadow:inset 0 1px #ffffff80}
.fgSaaq_range::-moz-range-thumb:active{cursor:grabbing;transform:scale(.95)}
.fgSaaq_range::-moz-range-track{background:0 0;border:none;height:32px}
.fgSaaq_pointLight{pointer-events:none;z-index:3;opacity:0;background:var(--es-point-light);border-radius:50%;width:150px;height:150px;transition:opacity .25s cubic-bezier(.25,.46,.45,.94);position:absolute;transform:translate(-50%,-50%)}
.fgSaaq_pointLightOn{opacity:1}
.fgSaaq_emptyOverlay{color:var(--es-empty);letter-spacing:.02em;text-align:center;padding:10px 0 2px;font-size:13px;font-weight:600}
.fgSaaq_statusEnterActive{transition:all .4s cubic-bezier(.25,.46,.45,.94)}
.fgSaaq_statusEnterFrom{opacity:0;filter:blur(10px);transform:translateY(8px)}
/* MAX 像素场（移植自 dsh-client-ui-effort-slider v0.4.5，MIT） */
.fgSaaq_trackMax{pointer-events:none;z-index:1;opacity:0;transition:opacity .34s ease-in;position:absolute;inset:0;background:var(--es-track-max,linear-gradient(90deg,#eeebe9 0%,#e6e0ea 14%,#d8c9ec 30%,#c5a8e4 48%,#b08ddc 68%,#9d74d2 85%,#8f63cd 100%))}
.fgSaaq_trackMaxOn{opacity:1}
.fgSaaq_dotsHidden{opacity:0}
.fgSaaq_pixel{pointer-events:none;z-index:4;opacity:0;transition:opacity .2s ease;position:absolute;inset:0;width:100%;height:100%}
.fgSaaq_pixelOn{opacity:1}
.fgSaaq_statusMax{background:linear-gradient(90deg,#b39ad6,#9d86e0,#8bb0ff,#a88fe8,#b39ad6);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent!important;text-shadow:none!important;animation:fgSaaqLevelFlow 3.2s linear infinite}
@keyframes fgSaaqLevelFlow{to{background-position:200% center}}`;
		const tagId = "dsh-effort-slider/effort.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-effort-slider";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		// 设置分区样式：主题三选按钮，取自皮肤中心同款 Harness 变量写法。
		const settingsCss = "body[data-dsh-effort-slider] .esSettings_list{margin:0;padding:0;list-style:none}body[data-dsh-effort-slider] .esSettings_card{border:1px solid var(--dsw-alias-border-l1,#e2e8f0);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:12px;flex-direction:column;gap:14px;padding:16px;display:flex}body[data-dsh-effort-slider] .esSettings_head{flex-direction:column;gap:4px;display:flex}body[data-dsh-effort-slider] .esSettings_title{color:var(--dsw-alias-label-primary,#172a45);font-size:15px;font-weight:600;line-height:1.4}body[data-dsh-effort-slider] .esSettings_desc{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;line-height:1.55}body[data-dsh-effort-slider] .esSettings_field{flex-direction:column;gap:8px;display:flex}body[data-dsh-effort-slider] .esSettings_fieldLabel{color:var(--dsw-alias-label-primary,#172a45);font-size:12.5px;font-weight:600}body[data-dsh-effort-slider] .esSettings_fieldHint{color:var(--dsw-alias-label-tertiary,#9aa4b5);font-size:12px;line-height:1.5}body[data-dsh-effort-slider] .esSettings_row{align-items:center;gap:8px;display:flex}body[data-dsh-effort-slider] .esSettings_themeButton{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#172a45);cursor:pointer;border-radius:6px;padding:5px 10px;font-size:12px;line-height:1;transition:background .12s,border-color .12s,color .12s}body[data-dsh-effort-slider] .esSettings_themeButton:hover{border-color:var(--dsw-alias-border-l4,#94a3b8)}body[data-dsh-effort-slider] .esSettings_themeButton:active{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-effort-slider] .esSettings_themeButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-effort-slider] .esSettings_themeButtonActive{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-effort-slider] .esSettings_note{color:var(--dsw-alias-label-tertiary,#9aa4b5);font-size:12px;line-height:1.5}body[data-dsh-effort-slider] .esSettings_noteMuted{color:var(--dsw-alias-state-error-primary,#c62828);font-size:12px;line-height:1.5}body[data-dsh-effort-slider] .esSettings_themeButton:disabled{opacity:.55;cursor:default}";
		const settingsTagId = "dsh-effort-slider/settings.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(settingsTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-effort-slider";
			tag.dataset.pluginCss = settingsTagId;
			tag.textContent = settingsCss;
			document.head.appendChild(tag);
		}
		var effort_module_css_default = {
			"close": "fgSaaq_close",
			"dot": "fgSaaq_dot",
			"dotActive": "fgSaaq_dotActive",
			"dotsLayer": "fgSaaq_dotsLayer",
			"emptyOverlay": "fgSaaq_emptyOverlay",
			"fire": "fgSaaq_fire",
			"glow": "fgSaaq_glow",
			"head": "fgSaaq_head",
			"headLeft": "fgSaaq_headLeft",
			"inner": "fgSaaq_inner",
			"labelText": "fgSaaq_labelText",
			"level0": "fgSaaq_level0",
			"level1": "fgSaaq_level1",
			"level2": "fgSaaq_level2",
			"level3": "fgSaaq_level3",
			"level4": "fgSaaq_level4",
			"levelLabel": "fgSaaq_levelLabel",
			"levelLabelActive": "fgSaaq_levelLabelActive",
			"levelLabels": "fgSaaq_levelLabels",
			"panel": "fgSaaq_panel",
			"pointLight": "fgSaaq_pointLight",
			"pointLightOn": "fgSaaq_pointLightOn",
			"range": "fgSaaq_range",
			"status": "fgSaaq_status",
			"statusEnterActive": "fgSaaq_statusEnterActive",
			"statusEnterFrom": "fgSaaq_statusEnterFrom",
			"dotsHidden": "fgSaaq_dotsHidden",
			"pixel": "fgSaaq_pixel",
			"pixelOn": "fgSaaq_pixelOn",
			"statusMax": "fgSaaq_statusMax",
			"trackMax": "fgSaaq_trackMax",
			"trackMaxOn": "fgSaaq_trackMaxOn",
			"statusGlow": "fgSaaq_statusGlow",
			"trackBg": "fgSaaq_trackBg",
			"trackWrapper": "fgSaaq_trackWrapper"
		};
		var settings_module_css_default = {
			"card": "esSettings_card",
			"desc": "esSettings_desc",
			"field": "esSettings_field",
			"fieldHint": "esSettings_fieldHint",
			"fieldLabel": "esSettings_fieldLabel",
			"head": "esSettings_head",
			"list": "esSettings_list",
			"note": "esSettings_note",
			"noteMuted": "esSettings_noteMuted",
			"row": "esSettings_row",
			"themeButton": "esSettings_themeButton",
			"themeButtonActive": "esSettings_themeButtonActive",
			"title": "esSettings_title"
		};
		//#endregion
		//#region locales
		/** 本插件持有的 locale 命名空间。 */
		const NS = "effortSlider";
		const en = {
			title: "Reasoning Slider",
			appearance: "Appearance",
			appearanceHint: "Selecting \"Follow system\" switches with the Harness theme automatically.",
			light: "Light",
			dark: "Dark",
			system: "Follow system",
			resolvedNote: "Panel currently renders in {mode}.",
			modeLight: "light",
			modeDark: "dark",
			saveFailed: "Failed to save appearance: {message}"
		};
		const zh = {
			title: "推理滑块",
			appearance: "外观",
			appearanceHint: "选择「跟随系统」时随 Harness 主题自动切换。",
			light: "浅色",
			dark: "深色",
			system: "跟随系统",
			resolvedNote: "面板当前按「{mode}」渲染。",
			modeLight: "浅色",
			modeDark: "深色",
			saveFailed: "外观保存失败：{message}"
		};
		//#endregion
		//#region theme resolution
		/** 宿主设置路由（与 lib/index.js 的 SETTINGS_ROUTE 一致）。 */
		const SETTINGS_ROUTE = "/_dsh/effort-slider/settings";
		/** 合法的外观偏好值。 */
		const APPEARANCE_VALUES = ["light", "dark", "system"];
		const isAppearance = (value) => APPEARANCE_VALUES.includes(value);
		/** GET/POST 宿主设置路由，返回 { appearance, revision, writable }。 */
		async function fetchAppearanceSnapshot(init) {
			const response = await fetch(SETTINGS_ROUTE, {
				credentials: "same-origin",
				...init
			});
			let body = null;
			try {
				body = await response.json();
			} catch {
				body = null;
			}
			if (!response.ok || body === null || body.ok !== true || body.value === void 0) {
				throw new Error(body?.error?.message ?? `settings request failed (HTTP ${response.status})`);
			}
			return body.value;
		}
		/**
		 * 外观偏好状态（唯一事实来源）：宿主快照 + 本地订阅。
		 * 读取失败时保持默认 system，但保留 error 供设置页提示。
		 */
		function createAppearanceStore() {
			let state = {
				appearance: "system",
				revision: void 0,
				writable: true,
				loaded: false,
				error: void 0
			};
			const subs = new Set();
			const publish = () => {
				const snapshot = { ...state };
				for (const fn of subs) fn(snapshot);
			};
			const adopt = (value) => {
				state = {
					appearance: isAppearance(value?.appearance) ? value.appearance : "system",
					revision: typeof value?.revision === "number" ? value.revision : state.revision,
					writable: value?.writable !== false,
					loaded: true,
					error: void 0
				};
				publish();
			};
			const load = () => {
				fetchAppearanceSnapshot().then(adopt).catch((error) => {
					state = {
						...state,
						loaded: true,
						error: error instanceof Error ? error.message : String(error)
					};
					publish();
				});
			};
			const save = async (appearance) => {
				if (!isAppearance(appearance)) return false;
				const value = await fetchAppearanceSnapshot({
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						action: "save",
						appearance,
						expectedRevision: state.revision
					})
				});
				adopt(value);
				return true;
			};
			return {
				load,
				save,
				getSnapshot: () => ({ ...state }),
				subscribe: (fn) => {
					subs.add(fn);
					return () => subs.delete(fn);
				}
			};
		}
		/** 解析实际明暗模式：偏好 + 系统主题。 */
		function resolveMode(preference, themeSnapshot) {
			if (preference === "light" || preference === "dark") return preference;
			return themeSnapshot?.resolvedId === "dark" ? "dark" : "light";
		}
		//#endregion
		//#region EffortPanel
		/** 面板宽度（必须与 CSS `.panel` 宽度一致）。 */
		const PANEL_W = 280;
		/** 每次面板打开时拉取当前会话的模型目录。 */
		function useDirectory(connection, sessionId) {
			const [directory, setDirectory] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let alive = true;
				setDirectory(null);
				connection.api.sessions.models({ sessionId }).then((response) => {
					const value = response.result.ok ? response.result.value : null;
					console.log("[effort-slider] models:", response.result.ok ? `ok groups=${value?.groups?.length} current=${JSON.stringify(value?.current)}` : `fail ${response.result.error?.code}: ${response.result.error?.message}`);
					if (alive && response.result.ok) setDirectory(response.result.value);
				}).catch((error) => {
					console.warn("[effort-slider] models threw:", error);
				});
				return () => {
					alive = false;
				};
			}, [connection, sessionId]);
			return directory;
		}
		/**
		 * Codex 风格推理等级滑块卡片。
		 * @param props - 会话 id + 连接面 + 外观模式 + 关闭回调。
		 */
		function EffortPanel(props) {
			const { sessionId, connection, themeMode, onClose } = props;
			const directory = useDirectory(connection, sessionId);
			const [dragging, setDragging] = (0, react.useState)(false);
			/** null = 目录未就绪/未初始化；就绪后立刻为当前档位（避免打开瞬间先渲染 0 档的蓝色帧）。 */
			const [rawValue, setRawValue] = (0, react.useState)(null);
			const disabled = directory === null;
			const rawCurrent = directory?.current ?? null;
			const fallback = directory !== null && directory.groups.length > 0 && directory.groups[0].models.length > 0 ? {
				provider: directory.groups[0].id,
				model: directory.groups[0].models[0].id
			} : null;
			const current = rawCurrent ?? fallback;
			const model = (current === null ? void 0 : directory?.groups.find((entry) => entry.id === current.provider))?.models.find((entry) => entry.id === current?.model);
			const efforts = model?.reasoning?.efforts ?? [];
			const usable = !disabled && current !== null && efforts.length >= 2;
			const currentEffortId = current?.reasoningEffort ?? model?.reasoning?.defaultEffort;
			const rawIndex = currentEffortId === void 0 ? -1 : efforts.findIndex((level) => level.id === currentEffortId);
			const step100 = efforts.length > 1 ? 100 / (efforts.length - 1) : 100;
			const initialRaw = usable && rawIndex >= 0 ? rawIndex * step100 : 0;
			// useLayoutEffect：在浏览器绘制前把滑块同步到当前档位，
			// 弹簧初始值 = 当前档位 → 打开面板不会出现 0 档（蓝）→ MAX（紫）的突变。
			(0, react.useLayoutEffect)(() => {
				if (directory !== null) {
					setRawValue(initialRaw);
					setDragging(false);
				}
			}, [directory]);
			const displayIndex = usable ? Math.round((rawValue ?? 0) / step100) : 0;
			const level = efforts[displayIndex];
			const slider100 = usable && rawValue !== null ? rawValue : 0;
			// Off（rawValue=0）时流光输入为 0：着色器 intensity=0，不再产生新光。
			const slider01 = usable && rawValue !== null && rawValue > 0 ? .15 + rawValue / 100 * .85 : 0;
			const fireRef = (0, react.useRef)(null);
			useWebglFire(fireRef, () => slider01, () => slider01 > 0);
			// High 及以上档位：像素场接管轨道。流光(WebGL)与像素场在进入 High 的
			// 边界处按连续滑块值交叉淡化（pixelBlend），避免硬切换。
			const pixelRef = (0, react.useRef)(null);
			const isMax = usable && efforts.length > 0 && displayIndex === efforts.length - 1;
			// 首个像素档位（High）：displayIndex > 0 兜底——Off 档(index 0)永不走像素场。
			const pixelStart = Math.max(efforts.length - 3, 1);
			// Off/低档 → High 连续过渡：在 High 前一档与 High 之间，流光→像素场交叉淡化。
			const fireEndPos = (pixelStart - 1) * step100;
			const pixelStartPos = pixelStart * step100;
			const rawPixel = pixelStartPos > fireEndPos ? (slider100 - fireEndPos) / (pixelStartPos - fireEndPos) : 0;
			const clampedPixel = Math.min(1, Math.max(0, rawPixel));
			const pixelBlend = clampedPixel * clampedPixel * (3 - 2 * clampedPixel);
			// 像素场激活（连续）：blend > 0 即开始渲染与显现扫过。
			const pixelActive = pixelBlend > 0;
			// High → MAX 连续过渡：色板蓝→紫、粒子风格（光带→tone 漂移）按
			// smoothstep 平滑插值；覆盖区右缘由像素场内部跟随 thumb。
			const highPos = (efforts.length - 2) * step100;
			const maxPos = (efforts.length - 1) * step100;
			const rawBlend = maxPos > highPos ? (slider100 - highPos) / (maxPos - highPos) : 0;
			const clampedBlend = Math.min(1, Math.max(0, rawBlend));
			const maxBlend = clampedBlend * clampedBlend * (3 - 2 * clampedBlend);
			useMaxPixelField(pixelRef, () => pixelActive, () => maxBlend, () => themeMode, () => slider100);
			const maskP = Math.max(slider100 - 1.5, 0);
			const maskFade = Math.min(slider100 + 1.5, 100);
			// 流光与像素场交叉淡化：pixelBlend 0→1 时流光淡出、像素场淡入。
			const fireStyle = slider100 > 0 ? {
				maskImage: `linear-gradient(to right, black 0%, black ${maskP}%, transparent ${maskFade}%)`,
				WebkitMaskImage: `linear-gradient(to right, black 0%, black ${maskP}%, transparent ${maskFade}%)`,
				opacity: 1 - pixelBlend
			} : { opacity: 0 };
			const pointLightStyle = {
				left: `${22 + slider100 / 100 * (PANEL_W - 44)}px`,
				top: "76px",
				// 只向左延伸：光池右缘贴在 thumb 左缘，右侧始终干净（左侧效果不变）。
				transform: "translate(-100%, -50%)",
				opacity: dragging && !pixelActive ? 1 : 0
			};
			/** 写当前档位到会话（拖动中节流调用）。 */
			const writeEffort = (v) => {
				if (!usable || current === null) return;
				const idx = Math.round(v / step100);
				const effort = efforts[idx];
				if (effort === void 0) return;
				connection.api.sessions.selectModel({
					sessionId,
					provider: current.provider,
					model: current.model,
					reasoningEffort: effort.id
				}).catch(() => {});
			};
			const lastWriteRef = (0, react.useRef)(0);
			const onInput = (event) => {
				if (!usable) return;
				const v = Number(event.target.value);
				setRawValue(v);
				const now = performance.now();
				if (now - lastWriteRef.current >= 16) {
					lastWriteRef.current = now;
					writeEffort(v);
				}
			};
			/** 松手/失焦/键盘结束时吸附到最近档位并补发一次确认。 */
			const commit = (event) => {
				if (!usable) return;
				const v = Number(event.target.value);
				const idx = Math.round(v / step100);
				setRawValue(idx * step100);
				setDragging(false);
				writeEffort(v);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: effort_module_css_default.panel,
				"data-effort-panel": "true",
				"data-es-theme": themeMode,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: effort_module_css_default.glow }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: effort_module_css_default.inner,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: effort_module_css_default.head,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: effort_module_css_default.headLeft,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: effort_module_css_default.labelText,
									children: "Effort"
								}), usable && level !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `${effort_module_css_default.status} ${effort_module_css_default[`level${displayIndex}`] ?? ""}${isMax ? ` ${effort_module_css_default.statusMax}` : displayIndex === efforts.length - 1 ? ` ${effort_module_css_default.statusGlow}` : ""}`,
									children: level.name
								}, level.name) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: effort_module_css_default.status,
									children: "—"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: effort_module_css_default.close,
								onClick: onClose,
								"aria-label": "关闭",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
									viewBox: "0 0 12 12",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "1.5",
									strokeLinecap: "round",
									"aria-hidden": "true",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.5 2.5l7 7M9.5 2.5l-7 7" })
								})
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: effort_module_css_default.levelLabels,
							children: efforts.map((entry, labelIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `${effort_module_css_default.levelLabel}${labelIndex === displayIndex ? ` ${effort_module_css_default.levelLabelActive}` : ""}`,
								style: { left: `${10 + labelIndex / Math.max(efforts.length - 1, 1) * 80}%` },
								children: labelIndex === 0 ? "OFF" : labelIndex === efforts.length - 1 ? "MAX" : entry.name
							}, entry.id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: effort_module_css_default.trackWrapper,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: effort_module_css_default.trackBg }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: `${effort_module_css_default.trackMax}${isMax ? ` ${effort_module_css_default.trackMaxOn}` : ""}`,
									// MAX 渐变底始终按 thumb 位置裁剪（不依赖 isMax）：
									// 拖动中提前判定为 MAX、以及 isMax 翻 false 的淡出过程中，
									// thumb 右侧都不会出现整轨渐变带。
									style: { clipPath: `inset(0 ${100 - slider100}% 0 0)` }
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: effort_module_css_default.dotsLayer,
									style: { opacity: 1 - pixelBlend },
									children: efforts.map((_, dotIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${effort_module_css_default.dot}${dotIndex === displayIndex ? ` ${effort_module_css_default.dotActive}` : ""}`,
										style: { left: `${10 + dotIndex / Math.max(efforts.length - 1, 1) * 80}%` }
									}, dotIndex))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
									ref: fireRef,
									className: effort_module_css_default.fire,
									style: fireStyle
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
									ref: pixelRef,
									className: effort_module_css_default.pixel,
									style: { opacity: pixelBlend }
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: effort_module_css_default.pointLight,
									style: pointLightStyle
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "range",
									min: 0,
									max: 100,
									step: 1,
									value: usable ? rawValue : 0,
									disabled: !usable,
									className: effort_module_css_default.range,
									onInput,
									onPointerDown: () => setDragging(true),
									onPointerUp: commit,
									onPointerLeave: () => setDragging(false),
									onBlur: commit
								})
							]
						}),
						!usable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: effort_module_css_default.emptyOverlay,
							children: disabled ? "模型目录加载中…" : "当前模型不提供多档推理等级"
						})
					]
				})]
			});
		}
		//#endregion
		//#region SettingsSection
		/**
		 * 设置页分区组件：外观（浅色/深色/跟随系统）三选。
		 * @param props - { t, read, setAppearance, subscribe }（由 apply 注入）。
		 * `read()` 每次返回最新快照 { appearance, resolved, writable, error }；
		 * `subscribe` 在宿主状态或系统主题变化时触发，组件据此重读。
		 */
		function SettingsSection(props) {
			const { t, read, setAppearance, subscribe } = props;
			const [snapshot, setSnapshot] = (0, react.useState)(() => read());
			const [saving, setSaving] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				return subscribe(() => setSnapshot(read()));
			}, [subscribe, read]);
			const choose = (id) => {
				if (snapshot.appearance === id) return;
				// 乐观更新按钮；失败时由订阅回滚并展示错误。
				setSnapshot((prev) => ({ ...prev, appearance: id, error: void 0 }));
				setSaving(true);
				Promise.resolve(setAppearance(id)).catch(() => {}).finally(() => setSaving(false));
			};
			const keys = APPEARANCE_VALUES;
			const { appearance, resolved, error } = snapshot;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: settings_module_css_default.list,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: settings_module_css_default.card,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: settings_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: settings_module_css_default.fieldLabel,
								children: t("appearance")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: settings_module_css_default.row,
								children: keys.map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${settings_module_css_default.themeButton}${appearance === key ? ` ${settings_module_css_default.themeButtonActive}` : ""}`,
									onClick: () => choose(key),
									disabled: saving,
									children: t(key)
								}, key))
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: settings_module_css_default.fieldHint,
								children: t("appearanceHint")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: settings_module_css_default.note,
								children: t("resolvedNote", { mode: resolved === "dark" ? t("modeDark") : t("modeLight") })
							}), error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: settings_module_css_default.noteMuted,
								children: t("saveFailed", { message: error })
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region apply
		/**
		 * 需要的客户端服务：slots（设置分区）、locale（文案）、theme（跟随系统）、
		 * connection + sessions（模型/会话）。外观设置经宿主路由读写
		 * （/_dsh/effort-slider/settings），不依赖 settingsScope。
		 */
		const inject = ["slots", "locale", "theme", "connection", "sessions"];
		/**
		 * 挂载设置分区 + 浮动滑块面板。
		 * @param ctx - 宿主上下文（effect 生命周期负责回收）。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-effort-slider: dictionaries");
			ctx.effect(() => {
				document.body.dataset.dshEffortSlider = "";
				return () => {
					delete document.body.dataset.dshEffortSlider;
				};
			}, "dsh-effort-slider: body scope");
			const theme = ctx.get("theme");
			const appearanceStore = createAppearanceStore();
			const resolveModeNow = () => resolveMode(appearanceStore.getSnapshot().appearance, theme.getTheme());
			// -- 设置分区
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "effort-slider",
				order: 130,
				label: () => ctx.locale.bind(NS)("title"),
				locale: NS,
				inject: () => ({
					read: () => {
						const snapshot = appearanceStore.getSnapshot();
						return {
							appearance: snapshot.appearance,
							resolved: resolveModeNow(),
							writable: snapshot.writable,
							error: snapshot.error
						};
					},
					setAppearance: (id) => appearanceStore.save(id),
					subscribe: (fn) => {
						const offTheme = ctx.on("theme/change", fn);
						const offStore = appearanceStore.subscribe(fn);
						return () => {
							offTheme();
							offStore();
						};
					}
				})
			}, SettingsSection));
			// -- 浮动滑块面板（拦截「推理等级」行）
			const host = document.createElement("div");
			host.dataset.effortSliderHost = "";
			host.style.cssText = "position: fixed; z-index: 10000; top: 0; left: 0; width: 0; height: 0; pointer-events: none;";
			document.body.appendChild(host);
			let root = null;
			const hidePanel = () => {
				root?.unmount();
				root = null;
			};
			const showPanel = (sessionId, anchor) => {
				const rect = anchor.getBoundingClientRect();
				const PANEL_H = 150;
				const left = Math.max(8, Math.min(rect.right - PANEL_W, window.innerWidth - PANEL_W - 8));
				const top = window.innerHeight - rect.bottom >= 166 ? rect.bottom + 8 : Math.max(8, rect.top - PANEL_H - 8);
				host.style.left = `${left}px`;
				host.style.top = `${top}px`;
				if (root === null) root = (0, react_dom_client.createRoot)(host);
				root.render((0, react.createElement)(EffortPanel, {
					sessionId,
					connection: ctx.get("connection"),
					themeMode: resolveModeNow(),
					onClose: hidePanel
				}));
			};
			// 外观/系统主题变化时，若面板打开则按新配色重渲染。
			const refreshTheme = () => {
				if (root !== null) {
					const currentSession = ctx.get("sessions").list.getSnapshot().current;
					if (currentSession !== void 0) {
						root.render((0, react.createElement)(EffortPanel, {
							sessionId: currentSession,
							connection: ctx.get("connection"),
							themeMode: resolveModeNow(),
							onClose: hidePanel
						}));
					}
				}
			};
			const offThemeEvent = ctx.on("theme/change", refreshTheme);
			const offStoreEvent = appearanceStore.subscribe(refreshTheme);
			const onDocClick = (event) => {
				const target = event.target;
				if (host.contains(target)) return;
				const row = target.closest?.("button[role=\"menuitem\"]");
				if (row instanceof HTMLElement) {
					const text = (row.textContent ?? "").trim();
					if (text.startsWith("推理等级") || text.startsWith("Effort")) {
						console.log("[effort-slider] intercept row:", JSON.stringify(text));
						event.preventDefault();
						event.stopPropagation();
						const current = ctx.get("sessions").list.getSnapshot().current;
						console.log("[effort-slider] session:", current);
						if (current !== void 0) showPanel(current, row);
						else console.warn("[effort-slider] no session id");
						return;
					}
				}
				if (!host.contains(target)) hidePanel();
			};
			document.addEventListener("click", onDocClick, true);
			appearanceStore.load();
			ctx.effect(() => () => {
				offThemeEvent();
				offStoreEvent();
				document.removeEventListener("click", onDocClick, true);
				hidePanel();
				host.remove();
			}, "dsh-effort-slider: settings section + effort panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
// The page field: a slow, domain-warped fractal colour field — sky blue
// (night navy under the dark theme) with deep-pink blooms and rare pale
// peaks — refracted through narrow vertical ribs, the fluted/reeded-glass
// look. WebGL1, no dependencies; the
// canvas sits fixed behind the page at z-index -1 so the body's --bg remains
// the no-WebGL fallback. Rendered at half CSS resolution (the ribs are soft,
// so the upscale is invisible), ~20 fps, paused while the tab is hidden, and
// a single still frame under reduced motion. A slight scroll parallax drifts
// the field at a quarter of the page speed: each paint bakes the scroll in,
// and between paints a compositor transform carries the canvas the rest of
// the way every frame, so the parallax moves as smoothly as the page while
// the shader still runs at drift rate.

import { onThemeChange } from "./theme";

const VERT = `
attribute vec2 p;
void main() {
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_dpr;
uniform float u_time;
uniform float u_scroll;
uniform vec3 u_sky;
uniform vec3 u_pink;
uniform vec3 u_white;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float f = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    f += a * noise(p);
    p = p * 2.0 + vec2(11.3, 7.7);
    a *= 0.5;
  }
  return f;
}

void main() {
  // all field math in CSS pixels so ribs stay ~18px at any density
  vec2 px = gl_FragCoord.xy / u_dpr;
  float barW = 18.0;
  float bx = fract(px.x / barW);

  /* refraction: each rib shows a squeezed slice of the field shifted toward
     the rib centre, which is what reads as reeded glass */
  float sx = px.x + (bx - 0.5) * barW * 1.8;
  float sy = px.y + u_scroll * 0.25;
  vec2 q = vec2(sx, sy) * 0.0016;
  float t = u_time * 0.025;
  vec2 w1 = vec2(fbm(q + t), fbm(q + vec2(5.2, 1.3) + t));
  vec2 w2 = vec2(
    fbm(q + 1.3 * w1 + vec2(1.7, 9.2)),
    fbm(q + 1.3 * w1 + vec2(8.3, 2.8))
  );
  /* the warped fbm skews low on GPU — a gentle gamma lifts the tail so the
     sky plateau covers the drifting median: the median pixel is exactly the
     sky colour, low swirls only lighten a little, the top band blooms pink
     and rare peaks pale out */
  float f = fbm(q + 1.6 * w2);
  f = pow(f, 0.45);
  vec3 lightSky = mix(u_sky, u_white, 0.18);
  vec3 c = mix(lightSky, u_sky, smoothstep(0.2, 0.3, f));
  c = mix(c, u_pink, smoothstep(0.69, 0.81, f));
  c = mix(c, u_white, smoothstep(0.85, 0.95, f) * 0.3);

  /* Keep the lit rib edges and soften the right-hand shadows so the
     fluted texture stays visible without muddying the sky colour. */
  c += u_white * pow(1.0 - bx, 10.0) * 0.10;
  c *= 1.0 - smoothstep(0.82, 1.0, bx) * 0.02;
  c *= 1.0 - smoothstep(0.955, 1.0, bx) * 0.025;

  gl_FragColor = vec4(c, 1.0);
}
`;

export function attachFlutedField(): void {
  const canvas = document.createElement("canvas");
  canvas.className = "page-field";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);

  let gl: WebGLRenderingContext | null;
  try {
    gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
    }) as WebGLRenderingContext | null;
  } catch {
    canvas.remove();
    return;
  }
  if (!gl) {
    canvas.remove();
    return;
  }
  const ctx = gl;

  const compile = (type: number, src: string) => {
    const shader = ctx.createShader(type)!;
    ctx.shaderSource(shader, src);
    ctx.compileShader(shader);
    return shader;
  };
  const program = ctx.createProgram()!;
  ctx.attachShader(program, compile(ctx.VERTEX_SHADER, VERT));
  ctx.attachShader(program, compile(ctx.FRAGMENT_SHADER, FRAG));
  ctx.linkProgram(program);
  if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
    canvas.remove();
    return;
  }
  ctx.useProgram(program);

  const quad = ctx.createBuffer();
  ctx.bindBuffer(ctx.ARRAY_BUFFER, quad);
  ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
  const loc = ctx.getAttribLocation(program, "p");
  ctx.enableVertexAttribArray(loc);
  ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);

  const uRes = ctx.getUniformLocation(program, "u_res");
  const uDpr = ctx.getUniformLocation(program, "u_dpr");
  const uTime = ctx.getUniformLocation(program, "u_time");
  const uScroll = ctx.getUniformLocation(program, "u_scroll");
  const uSky = ctx.getUniformLocation(program, "u_sky");
  const uPink = ctx.getUniformLocation(program, "u_pink");
  const uWhite = ctx.getUniformLocation(program, "u_white");

  const cssTone = (name: string): [number, number, number] => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(value);
    if (!m) return [1, 1, 1];
    const n = parseInt(m[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  const readTones = () => {
    ctx.uniform3fv(uSky, cssTone("--field-sky"));
    ctx.uniform3fv(uPink, cssTone("--field-pink"));
    ctx.uniform3fv(uWhite, cssTone("--white"));
  };
  readTones();

  /* half CSS resolution: the ribs are soft, so the upscale is invisible */
  const dpr = () => Math.min(devicePixelRatio || 1, 1) * 0.5;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* CSS px the canvas overhangs the viewport at each end (.page-field) */
  const OVERHANG = 160;
  const PARALLAX = 0.25;

  const fit = () => {
    const ratio = dpr();
    const w = Math.max(1, Math.round(innerWidth * ratio));
    const h = Math.max(1, Math.round((innerHeight + 2 * OVERHANG) * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctx.viewport(0, 0, w, h);
      return true;
    }
    return false;
  };

  // instrumented so the frame cost can be read from the console / tests
  let lastCost = 0;
  /* the scroll position the last paint baked in */
  let paintedScroll = 0;
  const paint = () => {
    paintedScroll = reduced ? 0 : scrollY;
    ctx.uniform2f(uRes, canvas.width, canvas.height);
    ctx.uniform1f(uDpr, dpr());
    ctx.uniform1f(uTime, reduced ? 0 : performance.now() / 1000);
    ctx.uniform1f(uScroll, paintedScroll);
    const t0 = performance.now();
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
    lastCost = performance.now() - t0;
    canvas.style.transform = "";
  };

  /* The shader's field point at screen y moves down by PARALLAX per scrolled
     pixel, so shifting the canvas by the scroll since the last paint lands
     it where a fresh paint would draw it. */
  const follow = () => {
    const shift = (scrollY - paintedScroll) * PARALLAX;
    if (Math.abs(shift) >= OVERHANG) {
      paint();
      return;
    }
    canvas.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
  };
  (canvas as unknown as { __frameCost?: () => number }).__frameCost = () => lastCost;

  fit();
  paint();
  canvas.style.opacity = "1";
  /* attached and drawn: let the page background step aside */
  document.documentElement.classList.add("has-field");

  addEventListener("resize", () => {
    if (fit()) paint();
  });
  /* the theme tokens drive the palette: repaint at once on a switch */
  onThemeChange(() => {
    readTones();
    paint();
  });

  if (reduced) return; // the still frame above is the whole show

  /* ambient drift at ~20fps, paused while the tab is hidden; each paint
     reads scrollY fresh, so the parallax follows at drift rate and scroll
     itself never schedules a repaint */
  let last = 0;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    if (now - last < 50) {
      follow();
      return;
    }
    last = now;
    paint();
  };
  requestAnimationFrame(loop);
}

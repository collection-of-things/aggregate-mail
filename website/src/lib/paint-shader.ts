// A small WebGL1 pass that makes the panel paintings breathe: two octaves of
// value noise warp the texture's UVs by less than a percent, a slow
// low-frequency wave drifts the light, fine film grain and a soft vignette
// sit on top. The hero adds a slow domain-warped fractal tinted in the page
// palette. No libraries; the canvas fades in over the painting's CSS
// fallback once the first frame has drawn.

/* v runs top-down to match the DOM image and the upload: the texture is
   written in image row order (ImageBitmap uploads ignore UNPACK_FLIP_Y
   in some builds), so the quad maps v = 0 to its top and no flip is
   needed anywhere */
const VERT = `
attribute vec2 p;
varying vec2 v_uv;
void main() {
  v_uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_img;
uniform vec2 u_res;
uniform vec2 u_imgRes;
uniform float u_time;
uniform float u_flow;
uniform float u_fractal;
uniform float u_focus;
uniform float u_focusX;
uniform float u_crop;
uniform vec3 u_sky;
uniform vec3 u_white;
uniform vec3 u_pink;
uniform float u_sat;
uniform float u_vib;
uniform float u_con;
uniform float u_bri;
uniform float u_duo;
uniform vec3 u_tshadow;
uniform vec3 u_thigh;

// hash + value noise
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
  return noise(p) * 0.65 + noise(p * 2.13 + 17.31) * 0.35;
}

// five-octave fbm for the fractal overlay (lacunarity 2, gain 0.5)
float fbm5(vec2 p) {
  float f = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    f += a * noise(p);
    p = p * 2.0 + vec2(11.3, 7.7);
    a *= 0.5;
  }
  return f;
}

// the painted colour at a uv: cover-fit, domain-warped flow, light drift,
// vignette (grain stays per-pixel in main). u_focus slides the cover crop:
// 0.5 centred, toward 0 lifts the crop so the image's upper band shows.
vec3 shade(vec2 uv01) {
  float ra = u_res.x / u_res.y;
  float ia = u_imgRes.x / u_imgRes.y;
  vec2 st = uv01;
  if (ra > ia) {
    float h = ia / ra;
    st.y = uv01.y * h + (1.0 - h) * u_focus;
  } else {
    float w = ra / ia;
    st.x = uv01.x * w + (1.0 - w) * u_focusX;
  }
  /* the scan carries a paper margin: u_crop drops it so real image reaches
     the panel edges */
  st = vec2(u_crop) + st * (1.0 - 2.0 * u_crop);

  // domain-warped flow: <= 0.6% of the texture, ~20s period
  float t = u_time * 0.31;
  vec2 warp = vec2(
    fbm(st * 3.1 + vec2(t, t * 0.7)),
    fbm(st * 3.4 + vec2(-t * 0.8, t))
  ) - 0.5;
  vec2 uv = st + warp * 0.006 * u_flow;

  vec3 c = texture2D(u_img, uv).rgb;

  /* colour grade: an optional luminance duotone (mid-range ramp so
     shadows/midtones take the shadow colour while highlights reach near
     white), then vibrance on the muted end, saturation and contrast */
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float duof = smoothstep(0.45, 0.78, lum);
  vec3 duo = mix(u_tshadow, u_thigh, duof);
  /* a partial tint (u_duo < 1) only reaches pixels that are already
     blue-leaning, so pale warm areas like a beach keep their hue while
     the sky shifts; a full duotone applies unconditionally */
  float blueness = smoothstep(-0.02, 0.08, c.b - c.r);
  c = mix(c, duo, u_duo < 1.0 ? u_duo * duof * blueness : u_duo);
  float span = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float glum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(glum), c, 1.0 + u_vib * (1.0 - span));
  c = mix(vec3(glum), c, u_sat);
  c = (c - 0.5) * u_con + 0.5;
  c *= u_bri;

  // soft light drift: a large low-frequency luminance wave, +-3%
  float wave = fbm(uv01 * 1.6 + vec2(u_time * 0.05, -u_time * 0.037)) - 0.5;
  c *= 1.0 + wave * 0.06;

  // gentle vignette, <= 6%
  float d = distance(uv01, vec2(0.5));
  c *= 1.0 - smoothstep(0.55, 0.95, d) * 0.06;

  return c;
}

void main() {
  vec3 c = shade(v_uv);

  // film grain, <= 2.5%
  float g = hash(v_uv * u_res * 0.5 + fract(u_time * 13.7) * 91.7) - 0.5;
  c += g * 0.05;

  /* fractal overlay: domain-warped fbm tinted through a sky -> white -> pink
     ramp, blended over the painting so the structure reads through */
  if (u_fractal > 0.5) {
    float ra = u_res.x / u_res.y;
    vec2 fp = (v_uv - 0.5) * vec2(ra, 1.0) * 3.0;
    float t = u_time * 0.02;
    vec2 q = vec2(
      fbm5(fp + vec2(t, 0.0)),
      fbm5(fp + vec2(5.2, 1.3) - t)
    );
    vec2 r = vec2(
      fbm5(fp + 4.0 * q + vec2(1.7, 9.2)),
      fbm5(fp + 4.0 * q + vec2(8.3, 2.8) + t)
    );
    float f = fbm5(fp + 4.0 * r);
    vec3 ramp = mix(u_sky, u_white, smoothstep(0.32, 0.5, f));
    ramp = mix(ramp, u_pink, smoothstep(0.5, 0.64, f));
    c = mix(c, ramp, 0.5);
  }

  gl_FragColor = vec4(c, 1.0);
}
`;

/* all heavy pixel work — decode and strip resizes — runs in one shared
   worker: the main thread sends the image's bytes (a cache-hit fetch) and
   only ever does the small texSubImage2D uploads */
let stripWorker: Worker | null | undefined;
let stripJob = 0;
const worker = () => {
  if (stripWorker !== undefined) return stripWorker;
  try {
    const src = `const imgs = {};
onmessage = (e) => {
  const d = e.data;
  if (d.op === "src") {
    createImageBitmap(d.blob)
      .then((b) => { imgs[d.id] = b; postMessage({ id: d.id, bitmap: null, src: true, w: b.width, h: b.height }); })
      .catch(() => postMessage({ id: d.id, bitmap: null, src: true, failed: true }));
  } else if (d.op === "bitmap") {
    const img = imgs[d.srcId];
    if (!img) return postMessage({ id: d.id, bitmap: null });
    createImageBitmap(img, {
      resizeWidth: d.rw,
      resizeHeight: d.rh,
      resizeQuality: "high",
    })
      .then((bitmap) => postMessage({ id: d.id, bitmap }, [bitmap]))
      .catch(() => postMessage({ id: d.id, bitmap: null }));
  }
};`;
    stripWorker = new Worker(
      URL.createObjectURL(new Blob([src], { type: "text/javascript" }))
    );
  } catch {
    stripWorker = null;
  }
  return stripWorker;
};

type WorkerReply = {
  id: number;
  reqId: number;
  bitmap: ImageBitmap | null;
  src?: boolean;
  failed?: boolean;
  w?: number;
  h?: number;
};
const workerJob = (payload: object) =>
  new Promise<WorkerReply | null>((res) => {
    const w = worker();
    if (!w) return res(null);
    const id = ++stripJob;
    const onMsg = (e: MessageEvent<Omit<WorkerReply, "reqId">>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMsg);
      res({ ...e.data, reqId: id });
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ id, ...(payload as Record<string, unknown>) });
  });

export type PaintShaderOptions = {
  flowBoost?: () => number;
  /* domain-warped fractal tint over the whole panel (hero only) */
  fractal?: boolean;
  /* cover focus: 0.5 centred; focus lifts the crop up, focusX slides it
     toward the image's left band on narrow panels */
  focus?: number;
  focusX?: number;
  /* texture inset — drops a scan's paper margin so the print is edge to
     edge image */
  crop?: number;
  /* colour grade after the texture sample: saturation/vibrance/contrast,
     and an optional luminance duotone — tintShadow (0-1 rgb) carries
     shadows and midtones, tintHighlight carries the lights. tintStrength
     (default 1) makes it a partial luminance-gated tint instead of a
     full duotone: the bright band shifts toward the highlight colour
     while dark tones keep their own */
  grade?: {
    saturation?: number;
    vibrance?: number;
    contrast?: number;
    /* overall exposure multiplier, 1 leaves the painting's light alone */
    brightness?: number;
    tintShadow?: [number, number, number];
    tintHighlight?: [number, number, number];
    tintStrength?: number;
  };
};

export function attachPaintShader(
  container: HTMLElement,
  img: HTMLImageElement,
  options?: PaintShaderOptions
): { canvas: HTMLCanvasElement | null; frames: () => number } {
  const canvas = document.createElement("canvas");
  canvas.className = "art-gl";
  canvas.setAttribute("aria-hidden", "true");
  /* The canvas layers over the painting but under the panel's content; the
     art may sit inside an astro-slot, so anchor on the top-level element
     that holds it. */
  let art = img.closest<HTMLElement>(".art") ?? container.querySelector<HTMLElement>(".art");
  while (art && art.parentElement !== container) art = art.parentElement;
  /* a themed painting's canvas carries its layer's theme so CSS shows only
     the active one */
  const theme = img.closest<HTMLElement>("[data-art]")?.dataset.art;
  if (theme) canvas.dataset.art = theme;
  container.insertBefore(canvas, art ? art.nextSibling : container.firstChild);
  const result = startPaintShader(container, canvas, img, options);
  if (!result.canvas) canvas.remove();
  return result;
}

/* Same effect on a canvas the caller owns and renders - used from inside a
   hydrated island, where a foreign node would not survive a re-render. */
export function startPaintShader(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  options?: PaintShaderOptions
): { canvas: HTMLCanvasElement | null; frames: () => number } {
  const state = { canvas: null as HTMLCanvasElement | null, frames: () => frames };

  let gl: WebGLRenderingContext | null;
  try {
    gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      // keep the last frame in the buffer so compositor snapshots never see a
      // cleared (black) canvas between a resize and the next rAF paint
      preserveDrawingBuffer: true,
    }) as WebGLRenderingContext | null;
  } catch {
    return state;
  }
  if (!gl) return state;
  const ctx = gl;

  /* every init step is its own task so no single synchronous chunk can
     exceed the frame budget under CPU throttling; canvases serialize
     through one queue so three paintings never init in the same frame */
  const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));
  let initQueue = (startPaintShader as { q?: Promise<unknown> }).q ?? Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = initQueue.then(fn);
    initQueue = p;
    (startPaintShader as { q?: Promise<unknown> }).q = initQueue;
    return p;
  };
  const step = <T>(name: string, fn: () => T | Promise<T>) =>
    enqueue(async () => {
      await yieldTask(); // fresh task per step — the chain must not collapse into microtasks
      const t0 = performance.now();
      const out = await fn();
      performance.measure(`paint:${name}`, { start: t0, end: performance.now() });
      return out;
    });

  /* print + fractal tones come from the page tokens, read once at attach */
  const cssTone = (name: string): [number, number, number] => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(value);
    if (!m) return [1, 1, 1];
    const n = parseInt(m[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  /* render at <= 1.5 device pixels */
  const dpr = () => Math.min(devicePixelRatio || 1, 1.5);

  const quad = ctx.createBuffer();
  ctx.bindBuffer(ctx.ARRAY_BUFFER, quad);
  ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);

  const texture = ctx.createTexture()!;
  let ready = false;
  let frames = 0;
  let uRes: WebGLUniformLocation | null = null;
  let uTime: WebGLUniformLocation | null = null;
  let uFlow: WebGLUniformLocation | null = null;

  const paint = () => {
    ctx.uniform2f(uRes, canvas.width, canvas.height);
    ctx.uniform1f(uTime, performance.now() / 1000);
    ctx.uniform1f(uFlow, options?.flowBoost ? options.flowBoost() : 1);
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
    frames++;
  };

  const fit = () => {
    const ratio = dpr();
    const w = Math.max(1, Math.round(container.clientWidth * ratio));
    const h = Math.max(1, Math.round(container.clientHeight * ratio));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    ctx.viewport(0, 0, w, h);
    // the resize cleared the buffer — repaint it in the same task
    if (ready) paint();
  };
  new ResizeObserver(fit).observe(container);
  fit();

  const draw = () => {
    if (!ready) return;
    fit();
    paint();
  };

  canvas.style.opacity = "0";
  state.canvas = canvas;

  const compileShader = (type: number, src: string) => {
    const shader = ctx.createShader(type)!;
    ctx.shaderSource(shader, src);
    ctx.compileShader(shader);
    return shader;
  };

  /* the init chain: one queued task per step, so the heaviest chunk a frame
     ever sees is a single strip upload or a single compile; the plain <img>
     stays visible underneath until the first shader frame is drawn */
  void (async () => {
    try {
      const vert = await step("compile-vert", () => compileShader(ctx.VERTEX_SHADER, VERT));
      const frag = await step("compile-frag", () => compileShader(ctx.FRAGMENT_SHADER, FRAG));
      const prog = await step("link", () => {
        const p = ctx.createProgram()!;
        ctx.attachShader(p, vert);
        ctx.attachShader(p, frag);
        ctx.linkProgram(p);
        return p;
      });
      /* the driver links lazily — poll completion across frames where the
         extension exists instead of a synchronous status read */
      await step("link-wait", async () => {
        const ext = ctx.getExtension("KHR_parallel_shader_compile");
        if (ext) {
          await new Promise<void>((res) => {
            const poll = () => {
              if (ctx.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR)) res();
              else requestAnimationFrame(poll);
            };
            poll();
          });
        }
        if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) throw new Error("shader link failed");
      });
      await step("bind", () => {
        ctx.useProgram(prog);
        const loc = ctx.getAttribLocation(prog, "p");
        ctx.enableVertexAttribArray(loc);
        ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
        uRes = ctx.getUniformLocation(prog, "u_res");
        uTime = ctx.getUniformLocation(prog, "u_time");
        uFlow = ctx.getUniformLocation(prog, "u_flow");
        ctx.uniform1i(ctx.getUniformLocation(prog, "u_img"), 0);
        const grade = options?.grade;
        ctx.uniform1f(ctx.getUniformLocation(prog, "u_sat"), grade?.saturation ?? 1);
        ctx.uniform1f(ctx.getUniformLocation(prog, "u_vib"), grade?.vibrance ?? 0);
        ctx.uniform1f(ctx.getUniformLocation(prog, "u_con"), grade?.contrast ?? 1);
        ctx.uniform1f(ctx.getUniformLocation(prog, "u_bri"), grade?.brightness ?? 1);
        const duo = grade?.tintShadow && grade?.tintHighlight;
        ctx.uniform1f(ctx.getUniformLocation(prog, "u_duo"), duo ? grade?.tintStrength ?? 1 : 0);
        ctx.uniform3fv(ctx.getUniformLocation(prog, "u_tshadow"), duo ? grade!.tintShadow! : [0, 0, 0]);
        ctx.uniform3fv(ctx.getUniformLocation(prog, "u_thigh"), duo ? grade!.tintHighlight! : [1, 1, 1]);
        if (options?.fractal) {
          ctx.uniform1f(ctx.getUniformLocation(prog, "u_fractal"), 1);
          ctx.uniform3fv(ctx.getUniformLocation(prog, "u_sky"), cssTone("--sky"));
          ctx.uniform3fv(ctx.getUniformLocation(prog, "u_white"), cssTone("--white"));
          ctx.uniform3fv(ctx.getUniformLocation(prog, "u_pink"), cssTone("--pink"));
        }
        ctx.uniform1f(ctx.getUniformLocation(prog, "u_focus"), options?.focus ?? 0.5);
        ctx.uniform1f(ctx.getUniformLocation(prog, "u_focusX"), options?.focusX ?? 0.5);
        ctx.uniform1f(ctx.getUniformLocation(prog, "u_crop"), options?.crop ?? 0);
      });
      /* the image bytes go to the worker at attach — decode+resize then
         finish in the load-idle window instead of mid-scroll. The srcset
         is parsed so the smallest adequate variant is fetched; the img's
         own lazy loading is unaffected and shares the HTTP cache */
      const srcReply = await step("src-decode", async () => {
        const pickUrl = () => {
          const entries = img.srcset
            .split(",")
            .map((e) => {
              const [url, d] = e.trim().split(/\s+/);
              return { url, w: parseInt(d) || 0 };
            })
            .filter((e) => e.url && e.w);
          /* createImageBitmap has no AVIF path in headless/older builds —
             prefer a JPEG/PNG/WebP variant so the worker decode always
             lands; the smallest adequate width wins within a format */
          const safe = entries.filter((e) => /\.(jpe?g|png|webp)(\?|$)/i.test(e.url));
          const pool = safe.length ? safe : entries;
          const adequate = pool.filter((e) => e.w >= canvas.width);
          return adequate.sort((a, b) => a.w - b.w)[0]?.url ??
            pool.sort((a, b) => b.w - a.w)[0]?.url ??
            img.currentSrc ??
            img.src;
        };
        try {
          const buf = await fetch(pickUrl()).then((r) => r.arrayBuffer());
          return workerJob({ op: "src", blob: new Blob([buf]) });
        } catch {
          return null;
        }
      });
      const srcId = srcReply && !srcReply.failed ? srcReply.reqId : -1;
      let srcW = img.naturalWidth;
      let srcH = img.naturalHeight;
      if (srcReply?.w && srcReply?.h) {
        srcW = srcReply.w;
        srcH = srcReply.h;
      }
      if (srcId < 0) {
        /* the worker path failed — the main thread still needs the img's
           own pixels, and a lazy offscreen image may take minutes: wait
           outside the queue so other canvases never stall behind it */
        if (!img.complete || img.naturalWidth === 0) {
          await new Promise<void>((res) => {
            img.addEventListener("load", () => res(), { once: true });
            img.addEventListener("error", () => res(), { once: true });
          });
        }
      }
      /* one backing-sized bitmap decoded+resized in the worker, one
         upload on the main thread — a single texImage2D at DPR 1 backing
         is a few ms even under throttle */
      await step("tex-upload", async () => {
        const bitmap = srcId >= 0
          ? (await workerJob({
              op: "bitmap",
              srcId,
              rw: canvas.width,
              rh: canvas.height,
            }))?.bitmap
          : await createImageBitmap(img, {
              resizeWidth: canvas.width,
              resizeHeight: canvas.height,
              resizeQuality: "high",
            });
        if (!bitmap) throw new Error("texture bitmap failed");
        ctx.activeTexture(ctx.TEXTURE0);
        ctx.bindTexture(ctx.TEXTURE_2D, texture);
        ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, false);
        ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGB, ctx.RGB, ctx.UNSIGNED_BYTE, bitmap);
        bitmap.close();
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
        ctx.uniform2f(ctx.getUniformLocation(prog, "u_imgRes"), srcW, srcH);
      });
      await step("first-frame", () => {
        ready = true;
        draw(); // one still frame, then fade in; the loop takes over
        canvas.style.opacity = "1";
      });
    } catch (err) {
      console.warn("paint-shader init failed:", err);
      canvas.remove();
      state.canvas = null;
    }
  })();

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return state; // the still frame from onload is enough

  /* ~20fps while in view — the breathe is slow, and each draw also costs
     a masked re-composite of the painting layer; the rAF loop stops
     entirely offscreen or while the tab is hidden, and resumes on
     return */
  let raf = 0;
  let inView = false;
  let lastFrame = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (now - lastFrame < 50) return;
    lastFrame = now;
    draw();
  };
  const sync = () => {
    const run = inView && !document.hidden;
    if (run && !raf) {
      lastFrame = 0;
      raf = requestAnimationFrame(loop);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  }).observe(container);
  document.addEventListener("visibilitychange", sync);
  sync();

  return state;
}

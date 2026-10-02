/**
 * renderer-webgl.js — WebGL2 backend for the ambient field.
 *
 * Dependency-free (no three.js): the whole scene is two draw calls per frame —
 * one `gl.LINES` pass for the constellation links AND the contact ripples
 * (rings are just short line segments appended to the same vertex stream), and
 * one `gl.POINTS` pass for the glowing nodes. The node glow is computed
 * analytically in the fragment shader from `gl_PointCoord`, so there is no
 * texture to download and no gradient to rasterise.
 *
 * Why this instead of re-enabling the archived three.js scene:
 *   three + @react-three/fiber + @react-three/drei + react + react-dom add
 *   ~1.1 MB to node_modules and ~450 kB of shipped JS, in an application that
 *   has no other React code. This file is ~14 kB uncompressed (half of it
 *   comments) and ships zero dependencies.
 *
 * ── The 2026-10 upgrade ───────────────────────────────────────────────────
 * The renderer used to paint every particle the same gold at the same warmth,
 * which flattened the field into wallpaper. It now reads three more channels
 * the simulation produces and turns them into depth and story:
 *
 *   scale → `aWarm`      near particles burn bright warm gold, far ones sink
 *                        into a dim amber haze — the field acquires readable
 *                        depth with zero extra draw calls;
 *   flare → `aFlare`     a rendezvous contact pushes size, alpha AND colour
 *                        toward the brand ember, so "a meeting happened here"
 *                        is legible from across the room;
 *   ripples → line pass  contact rings ride the same LINES batch as the links.
 *
 * Two subtle correctness details worth knowing about:
 *   - Blending is additive (`ONE, ONE`). Every fragment is emitted
 *     premultiplied, so overlapping glows accumulate light instead of
 *     covering each other — exactly what a constellation should do, and it
 *     makes the contact flare read as *light*, not paint.
 *   - The glow falloff is dithered with a per-pixel hash. Wide, soft,
 *     low-alpha gradients on near-black backgrounds band visibly on 8-bit
 *     panels; ±0.6 % of ordered noise removes the banding for free.
 *
 * Robustness (unchanged from the previous version):
 *   - every GL object is tracked and released in `destroy()`;
 *   - `webglcontextlost` is handled (preventDefault + report) so a GPU reset
 *     downgrades to the 2D renderer instead of leaving a frozen black canvas;
 *   - buffers are allocated once at `STREAM_DRAW` and refilled with
 *     `bufferSubData`, so there is no per-frame allocation.
 */

const VERT_POINTS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;     // screen-space px
layout(location = 1) in float aSize;   // px
layout(location = 2) in float aAlpha;  // 0..1
layout(location = 3) in float aWarm;   // 0 = far haze, 1 = near gold
layout(location = 4) in float aFlare;  // 0 = quiet, 1 = at contact
uniform vec2 uResolution;
out float vAlpha;
out float vWarm;
out float vFlare;
void main() {
  vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = aSize;
  vAlpha = aAlpha;
  vWarm = aWarm;
  vFlare = aFlare;
}`;

const FRAG_POINTS = `#version 300 es
precision mediump float;
in float vAlpha;
in float vWarm;
in float vFlare;
uniform vec3 uTintNear;   // bright gold
uniform vec3 uTintFar;    // dim amber haze
uniform vec3 uTintFlare;  // brand ember
out vec4 fragColor;

// Ordered-enough hash dither: kills gradient banding on 8-bit panels for
// the cost of a sin() on pixels that survive the discard below.
float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // Analytic radial falloff — no texture fetch, no gradient object.
  // Two terms: a tight cubic core for the star, plus a wider quadratic halo
  // that flares open during a rendezvous contact.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  float core = smoothstep(1.0, 0.0, r);
  float glow = core * core * core;
  float halo = core * core * 0.22;
  float a = (glow + halo * (0.55 + 0.85 * vFlare)) * vAlpha * (1.0 + vFlare * 1.3);
  a = clamp(a + (hash12(gl_FragCoord.xy) - 0.5) * 0.012, 0.0, 1.0);
  if (a < 0.004) discard;
  vec3 col = mix(uTintFar, uTintNear, vWarm);
  col = mix(col, uTintFlare, clamp(vFlare * 0.85, 0.0, 1.0));
  fragColor = vec4(col * a, a); // premultiplied → additive accumulation
}`;

const VERT_LINES = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in float aAlpha;
uniform vec2 uResolution;
out float vAlpha;
void main() {
  vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vAlpha = aAlpha;
}`;

const FRAG_LINES = `#version 300 es
precision mediump float;
in float vAlpha;
uniform vec3 uTint;
out vec4 fragColor;
float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  float a = clamp(vAlpha + (hash12(gl_FragCoord.xy) - 0.5) * 0.01, 0.0, 1.0);
  fragColor = vec4(uTint * a, a);
}`;

/** Ring geometry: RIPPLE_SLOTS × this many LINES segments appended to the
 *  link stream. 22 segments is visually circular at ≤ 130 px radius. */
const RING_SEGMENTS = 22;
const RING_SLOTS = 6;
const LINE_FLOATS = 3; // x, y, alpha per vertex

function compile(gl, type, source, onError) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    onError?.(gl.getShaderInfoLog(shader) || 'shader compile failed');
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl, vsSrc, fsSrc, onError) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, onError);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, onError);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    onError?.(gl.getProgramInfoLog(program) || 'program link failed');
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * @returns {null | {kind:string, resize:Function, draw:Function, destroy:Function}}
 *          `null` means "not supported here" — the caller falls back to 2D.
 */
export function createWebGLRenderer(canvas, field, opts = {}) {
  const onError = opts.onError ?? (() => {});
  /** @type {WebGL2RenderingContext|null} */
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false, // we do our own falloff; MSAA would only cost fill rate
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
      desynchronized: true,
      failIfMajorPerformanceCaveat: true, // refuse software rasterisers
    });
  } catch {
    gl = null;
  }
  if (!gl) return null;

  const pointProgram = link(gl, VERT_POINTS, FRAG_POINTS, onError);
  const lineProgram = link(gl, VERT_LINES, FRAG_LINES, onError);
  if (!pointProgram || !lineProgram) return null;

  // ── Brand palette (matches --gold-bright / --gold / --ember) ──────────
  const tintNear = opts.tintNear ?? [0.957, 0.843, 0.478]; // #F4D77A
  const tintFar = opts.tintFar ?? [0.529, 0.42, 0.169]; //  #876B2B dim amber
  const tintFlare = opts.tintFlare ?? [1.0, 0.478, 0.271]; // #FF7A45 ember
  const linkTint = opts.linkTint ?? [0.831, 0.686, 0.216]; // #D4AF37

  const n = field.count;
  const maxLinks = field.maxLinks;

  // Interleaved point buffer: [x, y, size, alpha, warm, flare] × n
  const POINT_STRIDE = 6;
  const pointData = new Float32Array(n * POINT_STRIDE);
  // Interleaved line buffer: [x, y, alpha] × 2 vertices × (links + rings)
  const ringCapacity = RING_SLOTS * RING_SEGMENTS * 2;
  const lineData = new Float32Array((maxLinks + ringCapacity) * 2 * LINE_FLOATS);

  const pointVAO = gl.createVertexArray();
  const pointVBO = gl.createBuffer();
  gl.bindVertexArray(pointVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointVBO);
  gl.bufferData(gl.ARRAY_BUFFER, pointData.byteLength, gl.STREAM_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, POINT_STRIDE * 4, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, POINT_STRIDE * 4, 8);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, POINT_STRIDE * 4, 12);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, POINT_STRIDE * 4, 16);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, POINT_STRIDE * 4, 20);

  const lineVAO = gl.createVertexArray();
  const lineVBO = gl.createBuffer();
  gl.bindVertexArray(lineVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineVBO);
  gl.bufferData(gl.ARRAY_BUFFER, lineData.byteLength, gl.STREAM_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, LINE_FLOATS * 4, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, LINE_FLOATS * 4, 8);
  gl.bindVertexArray(null);

  const uPointRes = gl.getUniformLocation(pointProgram, 'uResolution');
  const uNear = gl.getUniformLocation(pointProgram, 'uTintNear');
  const uFar = gl.getUniformLocation(pointProgram, 'uTintFar');
  const uFlareTint = gl.getUniformLocation(pointProgram, 'uTintFlare');
  const uLineRes = gl.getUniformLocation(lineProgram, 'uResolution');
  const uLineTint = gl.getUniformLocation(lineProgram, 'uTint');

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Additive: overlapping glows accumulate light. Every shader above emits
  // premultiplied colour, so the canvas still composites correctly.
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let lost = false;

  function onContextLost(e) {
    e.preventDefault();
    lost = true;
    opts.onContextLost?.();
  }
  canvas.addEventListener('webglcontextlost', onContextLost, false);

  function resize(width, height, pixelRatio) {
    cssW = width;
    cssH = height;
    dpr = pixelRatio;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw() {
    if (lost) return;
    gl.clear(gl.COLOR_BUFFER_BIT);

    // ── links + contact ripples: ONE batch, ONE draw call ────────────────
    const lc = field.linkCount;
    let o = 0;
    for (let k = 0; k < lc; k++) {
      const i = field.linkA[k];
      const j = field.linkB[k];
      const a = field.linkAlpha[k];
      // Per-endpoint grading: the far end of a link is dimmer than the near
      // end, which adds a direction-of-depth cue to every segment.
      const ai = Math.min(1, a * (0.55 + 0.45 * field.scale[i]));
      const aj = Math.min(1, a * (0.55 + 0.45 * field.scale[j]));
      lineData[o] = field.px[i];
      lineData[o + 1] = field.py[i];
      lineData[o + 2] = ai;
      lineData[o + 3] = field.px[j];
      lineData[o + 4] = field.py[j];
      lineData[o + 5] = aj;
      o += 6;
    }
    // Rings are polylines: RING_SEGMENTS joined segments per ripple.
    const rc = Math.min(field.rippleCount ?? 0, RING_SLOTS);
    for (let r = 0; r < rc; r++) {
      const rx = field.rippleX[r];
      const ry = field.rippleY[r];
      const rr = field.rippleR[r];
      const ra = field.rippleA[r];
      for (let s = 0; s < RING_SEGMENTS; s++) {
        const a0 = (s / RING_SEGMENTS) * Math.PI * 2;
        const a1 = ((s + 1) / RING_SEGMENTS) * Math.PI * 2;
        lineData[o] = rx + Math.cos(a0) * rr;
        lineData[o + 1] = ry + Math.sin(a0) * rr;
        lineData[o + 2] = ra;
        lineData[o + 3] = rx + Math.cos(a1) * rr;
        lineData[o + 4] = ry + Math.sin(a1) * rr;
        lineData[o + 5] = ra;
        o += 6;
      }
    }
    const lineVerts = o / LINE_FLOATS;
    if (lineVerts > 0) {
      gl.useProgram(lineProgram);
      gl.uniform2f(uLineRes, cssW, cssH);
      gl.uniform3f(uLineTint, linkTint[0], linkTint[1], linkTint[2]);
      gl.bindVertexArray(lineVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineVBO);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData, 0, o);
      gl.drawArrays(gl.LINES, 0, lineVerts);
    }

    // ── points: depth-graded, flare-aware ────────────────────────────────
    for (let p = 0; p < field.count; p++) {
      const i = field.order[p];
      const s = field.scale[i];
      const fl = field.flare[i];
      const b = p * POINT_STRIDE;
      pointData[b] = field.px[i];
      pointData[b + 1] = field.py[i];
      pointData[b + 2] = Math.max(2, field.r[i] * s * 9 * dpr) * (1 + fl * 0.9);
      pointData[b + 3] = Math.min(1, (0.22 + s * 0.85) * (1 + fl * 1.2));
      // warm ∈ [0,1] over the perspective scale range (z 60..520 → s ~0.9..0.5)
      const warm = (s - 0.5) / 0.4;
      pointData[b + 4] = warm < 0 ? 0 : warm > 1 ? 1 : warm;
      pointData[b + 5] = fl;
    }
    gl.useProgram(pointProgram);
    gl.uniform2f(uPointRes, cssW, cssH);
    gl.uniform3f(uNear, tintNear[0], tintNear[1], tintNear[2]);
    gl.uniform3f(uFar, tintFar[0], tintFar[1], tintFar[2]);
    gl.uniform3f(uFlareTint, tintFlare[0], tintFlare[1], tintFlare[2]);
    gl.bindVertexArray(pointVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pointData);
    gl.drawArrays(gl.POINTS, 0, field.count);

    gl.bindVertexArray(null);
  }

  return {
    kind: 'webgl2',
    resize,
    draw,
    destroy() {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      gl.deleteBuffer(pointVBO);
      gl.deleteBuffer(lineVBO);
      gl.deleteVertexArray(pointVAO);
      gl.deleteVertexArray(lineVAO);
      gl.deleteProgram(pointProgram);
      gl.deleteProgram(lineProgram);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

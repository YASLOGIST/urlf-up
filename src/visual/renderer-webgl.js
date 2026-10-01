/**
 * renderer-webgl.js — WebGL2 backend for the ambient field.
 *
 * Dependency-free (no three.js): the whole scene is two draw calls per frame —
 * one `gl.LINES` pass for the constellation links and one `gl.POINTS` pass for
 * the glowing nodes. The node glow is computed analytically in the fragment
 * shader from `gl_PointCoord`, so there is no texture to download and no
 * gradient to rasterise.
 *
 * Why this instead of re-enabling the archived three.js scene:
 *   three + @react-three/fiber + @react-three/drei + react + react-dom add
 *   ~1.1 MB to node_modules and ~450 kB of shipped JS, in an application that
 *   has no other React code. This file is ~6 kB uncompressed and ships zero
 *   dependencies.
 *
 * Robustness:
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
layout(location = 2) in float aAlpha;
uniform vec2 uResolution;
out float vAlpha;
void main() {
  vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = aSize;
  vAlpha = aAlpha;
}`;

const FRAG_POINTS = `#version 300 es
precision mediump float;
in float vAlpha;
uniform vec3 uTint;
out vec4 fragColor;
void main() {
  // Analytic radial falloff — no texture fetch, no gradient object.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  float core = smoothstep(1.0, 0.0, r);
  float glow = pow(core, 3.0);
  float a = clamp(glow * vAlpha, 0.0, 1.0);
  if (a < 0.004) discard;
  fragColor = vec4(uTint * a, a);
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
void main() {
  fragColor = vec4(uTint * vAlpha, vAlpha);
}`;

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

  const tint = opts.tint ?? [0.957, 0.843, 0.478]; // #F4D77A
  const linkTint = opts.linkTint ?? [0.831, 0.686, 0.216]; // #D4AF37

  const n = field.count;
  const maxLinks = field.maxLinks;

  // Interleaved point buffer: [x, y, size, alpha] × n
  const pointData = new Float32Array(n * 4);
  // Interleaved line buffer: [x, y, alpha] × 2 vertices × maxLinks
  const lineData = new Float32Array(maxLinks * 2 * 3);

  const pointVAO = gl.createVertexArray();
  const pointVBO = gl.createBuffer();
  gl.bindVertexArray(pointVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointVBO);
  gl.bufferData(gl.ARRAY_BUFFER, pointData.byteLength, gl.STREAM_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 8);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 16, 12);

  const lineVAO = gl.createVertexArray();
  const lineVBO = gl.createBuffer();
  gl.bindVertexArray(lineVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineVBO);
  gl.bufferData(gl.ARRAY_BUFFER, lineData.byteLength, gl.STREAM_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
  gl.bindVertexArray(null);

  const uPointRes = gl.getUniformLocation(pointProgram, 'uResolution');
  const uPointTint = gl.getUniformLocation(pointProgram, 'uTint');
  const uLineRes = gl.getUniformLocation(lineProgram, 'uResolution');
  const uLineTint = gl.getUniformLocation(lineProgram, 'uTint');

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied additive-ish
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

    // ── links ─────────────────────────────────────────────────────────────
    const lc = field.linkCount;
    if (lc > 0) {
      for (let k = 0; k < lc; k++) {
        const i = field.linkA[k];
        const j = field.linkB[k];
        const a = field.linkAlpha[k];
        const o = k * 6;
        lineData[o] = field.px[i];
        lineData[o + 1] = field.py[i];
        lineData[o + 2] = a;
        lineData[o + 3] = field.px[j];
        lineData[o + 4] = field.py[j];
        lineData[o + 5] = a;
      }
      gl.useProgram(lineProgram);
      gl.uniform2f(uLineRes, cssW, cssH);
      gl.uniform3f(uLineTint, linkTint[0], linkTint[1], linkTint[2]);
      gl.bindVertexArray(lineVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineVBO);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData, 0, lc * 6);
      gl.drawArrays(gl.LINES, 0, lc * 2);
    }

    // ── points ────────────────────────────────────────────────────────────
    for (let o = 0; o < field.count; o++) {
      const i = field.order[o];
      const s = field.scale[i];
      const b = o * 4;
      pointData[b] = field.px[i];
      pointData[b + 1] = field.py[i];
      pointData[b + 2] = Math.max(2, field.r[i] * s * 9 * dpr);
      pointData[b + 3] = Math.min(1, 0.22 + s * 0.85);
    }
    gl.useProgram(pointProgram);
    gl.uniform2f(uPointRes, cssW, cssH);
    gl.uniform3f(uPointTint, tint[0], tint[1], tint[2]);
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

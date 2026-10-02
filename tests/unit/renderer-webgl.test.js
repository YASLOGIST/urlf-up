/**
 * renderer-webgl.test.js — contract tests for the WebGL2 backend.
 *
 * The rest of the suite runs with `getContext('webgl2') → null`, so the GL
 * path was previously only ever exercised on real devices. These specs run
 * the renderer against a *faithful minimum* mock GL that accepts every call
 * the renderer makes and records them, which makes three classes of bug
 * catchable in CI without a GPU:
 *
 *   1. GL STATE BUGS      — additive blending, vertex attribute layout,
 *                           buffer upload lengths, draw-call counts.
 *   2. LIFECYCLE BUGS     — every created object deleted exactly once,
 *                           the context-lost listener removed, draw() a
 *                           no-op after loss.
 *   3. SHADER BUGS        — the GLSL sources are structurally validated:
 *                           #version, in/out matching between stages, the
 *                           flare/warm varyings present, precision declared.
 *
 * What this file deliberately does NOT claim: that the shaders compile on a
 * real driver, or that the result looks right. Those stay in
 * docs/VERIFICATION.md §Limits.
 */

import { describe, it, expect, vi } from 'vitest';
import { Field } from '../../src/visual/sim.js';

/* ── a GL that accepts everything and remembers everything ─────────────── */

function mockGL() {
  const gl = {
    // constants used by the renderer
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STREAM_DRAW: 6,
    FLOAT: 7,
    DEPTH_TEST: 8,
    BLEND: 9,
    ONE: 10,
    ONE_MINUS_SRC_ALPHA: 11,
    COLOR_BUFFER_BIT: 12,
    LINES: 13,
    POINTS: 14,

    shaders: [],
    programs: [],
    buffers: [],
    vaos: [],
    deleted: { shader: [], program: [], buffer: [], vao: [] },
    shaderSources: new Map(),
    uniformNames: new Set(),
    enabledAttribs: [],
    attribPointers: [],
    uploads: [],
    draws: [],
    blendFuncs: [],
    viewports: [],

    createShader(type) {
      const s = { type, id: gl.shaders.length };
      gl.shaders.push(s);
      return s;
    },
    shaderSource(shader, src) {
      gl.shaderSources.set(shader, src);
    },
    compileShader() {},
    getShaderParameter() {
      return true;
    },
    getShaderInfoLog() {
      return '';
    },
    deleteShader(s) {
      gl.deleted.shader.push(s);
    },
    createProgram() {
      const p = { id: gl.programs.length, attached: [] };
      gl.programs.push(p);
      return p;
    },
    attachShader(p, s) {
      p.attached.push(s);
    },
    linkProgram() {},
    getProgramParameter() {
      return true;
    },
    getProgramInfoLog() {
      return '';
    },
    deleteProgram(p) {
      gl.deleted.program.push(p);
    },
    createVertexArray() {
      const v = { id: gl.vaos.length };
      gl.vaos.push(v);
      return v;
    },
    deleteVertexArray(v) {
      gl.deleted.vao.push(v);
    },
    bindVertexArray() {},
    createBuffer() {
      const b = { id: gl.buffers.length };
      gl.buffers.push(b);
      return b;
    },
    deleteBuffer(b) {
      gl.deleted.buffer.push(b);
    },
    bindBuffer() {},
    bufferData(target, size) {
      gl._allocated = size;
    },
    bufferSubData(target, offset, data, srcOffset, length) {
      gl.uploads.push({ offset, length: length ?? data.length });
    },
    enableVertexAttribArray(loc) {
      gl.enabledAttribs.push(loc);
    },
    vertexAttribPointer(loc, size, type, normalised, stride, pointer) {
      gl.attribPointers.push({ loc, size, stride, pointer });
    },
    getUniformLocation(program, name) {
      gl.uniformNames.add(name);
      return { program, name };
    },
    useProgram() {},
    uniform2f(u) {
      gl.uniformNames.add(u.name);
    },
    uniform3f(u) {
      gl.uniformNames.add(u.name);
    },
    disable() {},
    enable() {},
    blendFunc(a, b) {
      gl.blendFuncs.push([a, b]);
    },
    clearColor() {},
    clear() {},
    viewport(...args) {
      gl.viewports.push(args);
    },
    drawArrays(mode, first, count) {
      gl.draws.push({ mode, first, count });
    },
    getExtension() {
      return null;
    },
  };
  return gl;
}

function makeCanvas(gl) {
  const listeners = {};
  return {
    width: 0,
    height: 0,
    style: {},
    listeners,
    getContext: (type) => (type === 'webgl2' ? gl : null),
    addEventListener: (t, fn) => {
      listeners[t] = fn;
    },
    removeEventListener: (t) => {
      delete listeners[t];
    },
    dispatch: (t, e) => listeners[t]?.(e),
  };
}

function steppedField(opts = {}) {
  const f = new Field({ count: 90, width: 1280, height: 800, seed: 77, ...opts });
  f.step(1);
  return f;
}

/* ── the specs ───────────────────────────────────────────────────────────── */

describe('createWebGLRenderer', () => {
  it('returns null when webgl2 is unavailable', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const canvas = makeCanvas(mockGL());
    canvas.getContext = () => null;
    expect(createWebGLRenderer(canvas, steppedField())).toBeNull();
  });

  it('returns null (and reports) when shader compilation fails', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    gl.getShaderParameter = () => false;
    const onError = vi.fn();
    const r = createWebGLRenderer(makeCanvas(gl), steppedField(), { onError });
    expect(r).toBeNull();
    expect(onError).toHaveBeenCalled();
  });

  it('issues exactly two draw calls per frame — LINES (links+rings) then POINTS', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    const field = steppedField();
    const r = createWebGLRenderer(makeCanvas(gl), field);
    r.resize(1280, 800, 1);
    gl.draws.length = 0;
    r.draw();
    expect(gl.draws).toHaveLength(2);
    expect(gl.draws[0].mode).toBe(gl.LINES);
    expect(gl.draws[1].mode).toBe(gl.POINTS);
    // The LINES batch carries exactly the links (2 verts each)…
    expect(gl.draws[0].count).toBe(field.linkCount * 2);
    // …and the POINTS batch one vertex per particle.
    expect(gl.draws[1].count).toBe(field.count);
    r.destroy();
  });

  it('folds contact ripples into the same LINES batch, not a new draw call', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    // Fast meetings + short approach so a ripple is alive during the frame.
    const field = new Field({
      count: 90,
      width: 1280,
      height: 800,
      seed: 77,
      maxMeetings: 1,
      meetingMinDelay: 1,
      meetingMaxDelay: 1,
    });
    for (let i = 0; i < 1000 && field.rippleCount === 0; i++) field.step(1);
    expect(field.rippleCount).toBeGreaterThan(0); // precondition
    const r = createWebGLRenderer(makeCanvas(gl), field);
    r.resize(1280, 800, 1);
    gl.draws.length = 0;
    r.draw();
    expect(gl.draws).toHaveLength(2);
    // 22 segments per ripple, 2 verts per segment, plus the links.
    const ringVerts = field.rippleCount * 22 * 2;
    expect(gl.draws[0].count).toBe(field.linkCount * 2 + ringVerts);
    r.destroy();
  });

  it('blends additively so overlapping glows accumulate light', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    const r = createWebGLRenderer(makeCanvas(gl), steppedField());
    expect(gl.blendFuncs).toContainEqual([gl.ONE, gl.ONE]);
    r.destroy();
  });

  it('declares a 5-attribute interleaved point layout with a 24-byte stride', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    const r = createWebGLRenderer(makeCanvas(gl), steppedField());
    const pointAttribs = gl.attribPointers.filter((p) => p.loc <= 4).slice(0, 5);
    expect(pointAttribs).toHaveLength(5);
    for (const p of pointAttribs) {
      expect(p.size).toBeLessThanOrEqual(2); // vec2 position, then scalars
      expect(p.stride).toBe(24); // 6 floats
    }
    // Offsets: x,y @0 · size @8 · alpha @12 · warm @16 · flare @20
    expect(pointAttribs.map((p) => p.pointer)).toEqual([0, 8, 12, 16, 20]);
    r.destroy();
  });

  it('uploads the exact point and line vertex counts each frame', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    const field = steppedField();
    const r = createWebGLRenderer(makeCanvas(gl), field);
    r.resize(1280, 800, 1);
    gl.uploads.length = 0;
    r.draw();
    expect(gl.uploads).toEqual([
      { offset: 0, length: field.linkCount * 6 },
      { offset: 0, length: field.count * 6 },
    ]);
    r.destroy();
  });

  it('resizes the backing store, the CSS box and the viewport together', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    const canvas = makeCanvas(gl);
    const r = createWebGLRenderer(canvas, steppedField());
    r.resize(1000, 600, 2);
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1200);
    expect(canvas.style.width).toBe('1000px');
    expect(gl.viewports.at(-1)).toEqual([0, 0, 2000, 1200]);
    r.destroy();
  });

  it('becomes a no-op after context loss and reports for fallback', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    const canvas = makeCanvas(gl);
    const onContextLost = vi.fn();
    const r = createWebGLRenderer(canvas, steppedField(), { onContextLost });
    r.resize(1280, 800, 1);
    const event = { preventDefault: vi.fn() };
    canvas.dispatch('webglcontextlost', event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onContextLost).toHaveBeenCalled();
    gl.draws.length = 0;
    r.draw();
    expect(gl.draws).toHaveLength(0);
    r.destroy();
  });

  it('destroys exactly what it created — no orphan GL objects, no listener', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    const canvas = makeCanvas(gl);
    const r = createWebGLRenderer(canvas, steppedField());
    r.destroy();
    expect(gl.buffers).toHaveLength(2);
    expect(gl.vaos).toHaveLength(2);
    expect(gl.programs).toHaveLength(2);
    expect(gl.shaders).toHaveLength(4); // 2 per program
    expect(gl.deleted.buffer).toHaveLength(gl.buffers.length);
    expect(gl.deleted.vao).toHaveLength(gl.vaos.length);
    expect(gl.deleted.program).toHaveLength(gl.programs.length);
    expect(gl.deleted.shader).toHaveLength(gl.shaders.length);
    expect(Object.keys(canvas.listeners)).toHaveLength(0);
  });
});

/* ── GLSL structural validation ─────────────────────────────────────────── */

describe('shader sources', () => {
  it('are all GLSL ES 3.00 with declared precision and no legacy varyings', async () => {
    const gl = mockGL();
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const r = createWebGLRenderer(makeCanvas(gl), steppedField());
    r.destroy();
    expect(gl.shaderSources.size).toBe(4);
    for (const src of gl.shaderSources.values()) {
      expect(src.startsWith('#version 300 es')).toBe(true);
      expect(src).toMatch(/precision (highp|mediump) float/);
      expect(src).not.toMatch(/\bvarying\b/);
    }
  });

  it('match every vertex-stage out with a fragment-stage in, per program', async () => {
    const gl = mockGL();
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const r = createWebGLRenderer(makeCanvas(gl), steppedField());
    r.destroy();

    // Compile order is: pointsVS, pointsFS, linesVS, linesFS.
    const order = [...gl.shaders].map((s) => s.type);
    // shaderSources is a Map keyed by shader object; re-associate via order.
    const byShader = [...gl.shaderSources.entries()];
    const pointsVS = byShader[0][1];
    const pointsFS = byShader[1][1];
    const linesVS = byShader[2][1];
    const linesFS = byShader[3][1];
    expect(order[0]).toBe(gl.VERTEX_SHADER);
    expect(order[1]).toBe(gl.FRAGMENT_SHADER);
    expect(order[2]).toBe(gl.VERTEX_SHADER);
    expect(order[3]).toBe(gl.FRAGMENT_SHADER);

    for (const [vs, fs] of [
      [pointsVS, pointsFS],
      [linesVS, linesFS],
    ]) {
      const outs = [...vs.matchAll(/\bout\s+(?:highp\s+|mediump\s+|lowp\s+)?float\s+(\w+)\s*;/g)].map(
        (m) => m[1]
      );
      const ins = [...fs.matchAll(/\bin\s+(?:highp\s+|mediump\s+|lowp\s+)?float\s+(\w+)\s*;/g)].map(
        (m) => m[1]
      );
      expect(outs.length).toBeGreaterThan(0);
      for (const o of outs) expect(ins).toContain(o);
    }

    // The point program must carry the depth and story channels end to end.
    expect(pointsVS).toMatch(/aWarm/);
    expect(pointsVS).toMatch(/aFlare/);
    expect(pointsFS).toMatch(/vWarm/);
    expect(pointsFS).toMatch(/vFlare/);
    expect(pointsFS).toMatch(/uTintNear/);
    expect(pointsFS).toMatch(/uTintFar/);
    expect(pointsFS).toMatch(/uTintFlare/);
    // Dithering present — banding on 8-bit panels is a real defect.
    expect(pointsFS).toMatch(/hash12/);
  });

  it('fetch every uniform location the shaders reference before first draw', async () => {
    const { createWebGLRenderer } = await import('../../src/visual/renderer-webgl.js');
    const gl = mockGL();
    const r = createWebGLRenderer(makeCanvas(gl), steppedField());
    for (const name of ['uResolution', 'uTintNear', 'uTintFar', 'uTintFlare', 'uTint']) {
      expect(gl.uniformNames, `missing ${name}`).toContain(name);
    }
    r.destroy();
  });
});

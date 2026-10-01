/**
 * gif.mjs — a dependency-free GIF89a encoder built for one job: shipping a
 * broadcast-quality animated Open Graph card at a size a crawler will accept.
 *
 * Three pieces, each the cheapest thing that is actually correct:
 *
 *  1. ADAPTIVE PALETTE — median cut over a 15-bit colour histogram, seeded
 *     with the exact brand colours so #D4AF37 survives quantisation as itself
 *     rather than as "whatever was nearest". Boxes are split on the channel
 *     with the widest spread, chosen by population × spread, which is what
 *     keeps 200 near-black backdrop tones from starving the gold ramp.
 *
 *  2. TEMPORAL DIFF — every frame after the first is encoded as the smallest
 *     rectangle that changed, with unchanged pixels written as the transparent
 *     index and disposal method 1 (leave the previous frame in place). An
 *     ambient loop over a static composition therefore pays for motion only.
 *     This is worth roughly 6× on this card: a static background is encoded
 *     exactly once.
 *
 *  3. LZW — the standard variable-width coder, including the subtle part:
 *     the code width grows *before* the entry that would overflow it is
 *     inserted, and the table is cleared rather than overflowed at 4096.
 *
 * Index 255 is reserved as the transparency slot and is never emitted as a
 * colour, so the palette carries 255 opaque entries.
 */

const TRANSPARENT_INDEX = 255;
const PALETTE_SLOTS = 255;

/**
 * Histogram resolution, in bits per channel.
 *
 * The usual choice is 5 (32³ bins) and it is wrong for this image. An
 * obsidian card spends 90% of its pixels between sRGB 5 and 30, which is four
 * bins wide at 5 bits — so no palette built from that histogram can hold more
 * than a handful of distinct near-blacks and the backdrop contours into
 * visible rings. At 6 bits the same range is eight bins wide and the gradient
 * resolves. The cost is a 7 MB histogram and a 0.5 MB memo, once.
 */
const HBITS = 6;
const HSHIFT = 8 - HBITS;
const HSIZE = 1 << (HBITS * 3);
const HMASK = (1 << HBITS) - 1;
const key3 = (r, g, b) => ((r >> HSHIFT) << (HBITS * 2)) | ((g >> HSHIFT) << HBITS) | (b >> HSHIFT);

/* ── 1. Palette ───────────────────────────────────────────────────────────── */

/** Bayer 8×8 threshold matrix, normalised to −0.5..+0.5. */
const BAYER = (() => {
  const m = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  return Float32Array.from(m.flat(), (v) => v / 64 - 0.5);
})();

/**
 * Build a 256-entry palette from the colours that actually occur in the
 * frames, pinning a set of exact colours first.
 *
 * @param {Uint8Array[]} frames packed RGB buffers
 * @param {object} [opts]
 * @param {Array<[number,number,number]>} [opts.pinned] colours that must survive exactly
 * @param {number} [opts.sampleStride] sample every Nth pixel when building the histogram
 * @returns {{ table: Uint8Array, size: number }} 768-byte GIF colour table
 */
export function buildPalette(frames, { pinned = [], sampleStride = 2 } = {}) {
  const counts = new Int32Array(HSIZE);
  const sumR = new Float64Array(HSIZE);
  const sumG = new Float64Array(HSIZE);
  const sumB = new Float64Array(HSIZE);

  for (const rgb of frames) {
    for (let i = 0; i < rgb.length; i += 3 * sampleStride) {
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      const key = key3(r, g, b);
      counts[key]++;
      sumR[key] += r;
      sumG[key] += g;
      sumB[key] += b;
    }
  }

  /** Non-empty histogram bins, as keys. */
  const keys = [];
  for (let k = 0; k < HSIZE; k++) if (counts[k]) keys.push(k);

  const pinnedList = pinned.slice(0, PALETTE_SLOTS);
  const budget = PALETTE_SLOTS - pinnedList.length;

  const box = (start, end) => {
    let n = 0;
    let rLo = 255;
    let rHi = 0;
    let gLo = 255;
    let gHi = 0;
    let bLo = 255;
    let bHi = 0;
    for (let i = start; i < end; i++) {
      const k = keys[i];
      const c = counts[k];
      n += c;
      const r = (k >> (HBITS * 2)) & HMASK;
      const g = (k >> HBITS) & HMASK;
      const b = k & HMASK;
      if (r < rLo) rLo = r;
      if (r > rHi) rHi = r;
      if (g < gLo) gLo = g;
      if (g > gHi) gHi = g;
      if (b < bLo) bLo = b;
      if (b > bHi) bHi = b;
    }
    // Weighted so that a wide-but-rare gold ramp still outranks a huge,
    // nearly-flat block of backdrop black.
    const spread = Math.max(rHi - rLo, gHi - gLo, bHi - bLo);
    return { start, end, n, spread, priority: spread * Math.sqrt(n) };
  };

  const boxes = [box(0, keys.length)];
  while (boxes.length < budget) {
    let pick = -1;
    let best = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].end - boxes[i].start > 1 && boxes[i].priority > best) {
        best = boxes[i].priority;
        pick = i;
      }
    }
    if (pick < 0) break;

    const b = boxes[pick];
    const slice = keys.slice(b.start, b.end);
    // Split on the widest axis, at the population median.
    let rLo = 255;
    let rHi = 0;
    let gLo = 255;
    let gHi = 0;
    let bLo = 255;
    let bHi = 0;
    for (const k of slice) {
      const r = (k >> (HBITS * 2)) & HMASK;
      const g = (k >> HBITS) & HMASK;
      const bb = k & HMASK;
      if (r < rLo) rLo = r;
      if (r > rHi) rHi = r;
      if (g < gLo) gLo = g;
      if (g > gHi) gHi = g;
      if (bb < bLo) bLo = bb;
      if (bb > bHi) bHi = bb;
    }
    const axis = (() => {
      const dr = rHi - rLo;
      const dg = gHi - gLo;
      const db = bHi - bLo;
      if (dg >= dr && dg >= db) return HBITS; // green
      if (dr >= db) return HBITS * 2; // red
      return 0; // blue
    })();
    slice.sort((x, y) => ((x >> axis) & HMASK) - ((y >> axis) & HMASK));
    for (let i = 0; i < slice.length; i++) keys[b.start + i] = slice[i];

    let acc = 0;
    let cut = b.start + 1;
    for (let i = b.start; i < b.end - 1; i++) {
      acc += counts[keys[i]];
      if (acc * 2 >= b.n) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(pick, 1, box(b.start, cut), box(cut, b.end));
  }

  const table = new Uint8Array(768);
  let slot = 0;
  for (const [r, g, b] of pinnedList) {
    table[slot * 3] = r;
    table[slot * 3 + 1] = g;
    table[slot * 3 + 2] = b;
    slot++;
  }
  for (const b of boxes) {
    if (slot >= PALETTE_SLOTS) break;
    let n = 0;
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let i = b.start; i < b.end; i++) {
      const k = keys[i];
      n += counts[k];
      r += sumR[k];
      g += sumG[k];
      bl += sumB[k];
    }
    if (!n) continue;
    table[slot * 3] = Math.round(r / n);
    table[slot * 3 + 1] = Math.round(g / n);
    table[slot * 3 + 2] = Math.round(bl / n);
    slot++;
  }
  // Pad any unused opaque slot with the last colour so nearest-match never
  // resolves to an accidental black.
  for (let i = slot; i < PALETTE_SLOTS; i++) {
    table[i * 3] = table[(slot - 1) * 3];
    table[i * 3 + 1] = table[(slot - 1) * 3 + 1];
    table[i * 3 + 2] = table[(slot - 1) * 3 + 2];
  }
  return { table, size: slot };
}

/**
 * Nearest-colour mapper with a 15-bit memo. One exhaustive search per distinct
 * quantised colour, then O(1) for the remaining ~45 million lookups.
 */
export function createMapper(table, size) {
  const memo = new Int16Array(HSIZE).fill(-1);
  return function nearest(r, g, b) {
    const key = key3(r, g, b);
    const hit = memo[key];
    if (hit >= 0) return hit;
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < size; i++) {
      // Weights approximate luma sensitivity; cheaper and steadier than a
      // full Lab conversion at this palette size.
      const dr = r - table[i * 3];
      const dg = g - table[i * 3 + 1];
      const db = b - table[i * 3 + 2];
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    memo[key] = bestI;
    return bestI;
  };
}

/**
 * Quantise one RGB frame to palette indices, with optional ordered dithering.
 * Ordered (rather than error-diffused) dithering is deliberate: its pattern is
 * stable from frame to frame, so it does not manufacture motion that the
 * temporal diff would then have to pay for.
 */
export function quantizeFrame(rgb, width, height, nearest, dither = 0) {
  const out = new Uint8Array(width * height);
  for (let y = 0, p = 0, i = 0; y < height; y++) {
    const row = (y & 7) << 3;
    for (let x = 0; x < width; x++, p++, i += 3) {
      if (dither > 0) {
        const t = BAYER[row | (x & 7)] * dither;
        const r = Math.min(255, Math.max(0, Math.round(rgb[i] + t)));
        const g = Math.min(255, Math.max(0, Math.round(rgb[i + 1] + t)));
        const b = Math.min(255, Math.max(0, Math.round(rgb[i + 2] + t)));
        out[p] = nearest(r, g, b);
      } else {
        out[p] = nearest(rgb[i], rgb[i + 1], rgb[i + 2]);
      }
    }
  }
  return out;
}

/* ── 2. LZW ───────────────────────────────────────────────────────────────── */

/** @param {Uint8Array} indices @param {number} minCodeSize */
export function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const bytes = [];
  let cur = 0;
  let curShift = 0;
  let codeSize = minCodeSize + 1;

  const emit = (code) => {
    cur |= code << curShift;
    curShift += codeSize;
    while (curShift >= 8) {
      bytes.push(cur & 0xff);
      cur >>= 8;
      curShift -= 8;
    }
  };

  let table = new Map();
  let nextCode = eoiCode + 1;
  emit(clearCode);

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      table = new Map();
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    } else {
      // Grow the code width before inserting the entry that overflows it —
      // this is the handshake the decoder mirrors.
      if (nextCode >= 1 << codeSize) codeSize++;
      table.set(key, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (curShift > 0) bytes.push(cur & 0xff);

  // Pack into ≤255-byte sub-blocks, terminated by a zero-length block.
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const run = bytes.slice(i, i + 255);
    out.push(run.length, ...run);
  }
  out.push(0);
  return Buffer.from(out);
}

/* ── 3. Container ─────────────────────────────────────────────────────────── */

function u16(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

/**
 * Assemble an animated GIF from already-quantised frames.
 *
 * @param {object} spec
 * @param {number} spec.width
 * @param {number} spec.height
 * @param {Uint8Array} spec.palette 768-byte global colour table
 * @param {Uint8Array[]} spec.frames palette indices, width*height each
 * @param {number} spec.delayCs frame delay in centiseconds (≥ 4; browsers clamp below that)
 * @param {number} [spec.loop] 0 = forever
 * @returns {{ buffer: Buffer, stats: { frames: number, changedPx: number, totalPx: number } }}
 */
export function encodeAnimatedGIF({ width, height, palette, frames, delayCs, loop = 0 }) {
  const parts = [];
  parts.push(Buffer.from('GIF89a', 'ascii'));
  parts.push(
    Buffer.from([
      ...u16(width),
      ...u16(height),
      0xf7, // global colour table, 8 bits/channel, 256 entries
      0, // background index
      0, // default pixel aspect ratio
    ])
  );
  parts.push(Buffer.from(palette));
  parts.push(
    Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, ...u16(loop), 0x00])
  );

  const canvas = new Uint8Array(width * height).fill(TRANSPARENT_INDEX);
  let changedPx = 0;

  frames.forEach((frame, index) => {
    let left = 0;
    let top = 0;
    let w = width;
    let h = height;
    let sub = frame;
    let transparent = false;

    if (index > 0) {
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0, p = 0; y < height; y++) {
        for (let x = 0; x < width; x++, p++) {
          if (frame[p] !== canvas[p]) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) {
        // Nothing moved: emit a 1×1 transparent placeholder to hold the beat.
        left = 0;
        top = 0;
        w = 1;
        h = 1;
        sub = Uint8Array.of(TRANSPARENT_INDEX);
        transparent = true;
      } else {
        left = minX;
        top = minY;
        w = maxX - minX + 1;
        h = maxY - minY + 1;
        sub = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          const srcRow = (top + y) * width + left;
          const dstRow = y * w;
          for (let x = 0; x < w; x++) {
            const v = frame[srcRow + x];
            if (v === canvas[srcRow + x]) {
              sub[dstRow + x] = TRANSPARENT_INDEX;
            } else {
              sub[dstRow + x] = v;
              changedPx++;
            }
          }
        }
        transparent = true;
      }
    } else {
      changedPx += width * height;
    }

    parts.push(
      Buffer.from([
        0x21,
        0xf9,
        0x04,
        // disposal 1 (leave in place) | transparency flag
        (1 << 2) | (transparent ? 1 : 0),
        ...u16(delayCs),
        TRANSPARENT_INDEX,
        0x00,
      ])
    );
    parts.push(Buffer.from([0x2c, ...u16(left), ...u16(top), ...u16(w), ...u16(h), 0x00]));
    parts.push(Buffer.from([8]));
    parts.push(lzwEncode(sub, 8));

    // The decoder's canvas after this frame is what the next diff is against.
    if (index === 0) {
      canvas.set(frame);
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = sub[y * w + x];
          if (v !== TRANSPARENT_INDEX) canvas[(top + y) * width + left + x] = v;
        }
      }
    }
  });

  parts.push(Buffer.from([0x3b]));
  return {
    buffer: Buffer.concat(parts),
    stats: { frames: frames.length, changedPx, totalPx: width * height * frames.length },
  };
}

export { TRANSPARENT_INDEX, PALETTE_SLOTS };

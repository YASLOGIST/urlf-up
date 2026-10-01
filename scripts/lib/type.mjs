/**
 * type.mjs — a geometric monoline display face, authored as geometry.
 *
 * WHY A FONT LIVES IN A .mjs FILE
 * The Open Graph card has to be reproducible from `npm run og` on any machine,
 * in CI, offline, with no network and no binary assets in the tree. That rules
 * out shelling out to a renderer and it rules out vendoring a TTF (which also
 * carries a licence the repository would then have to honour and ship). The
 * card needs forty-odd glyphs in one weight; describing them as stroke
 * geometry is ~200 lines, is diffable, scales to any size, and stays ours.
 *
 * THE MODEL
 * Every glyph is a list of polylines on a unit em: x starts at 0, y = 0 is the
 * baseline, y = 1 is the cap height. Curves are flattened here, once, at a
 * fixed tolerance — the rasteriser only ever sees line segments with round
 * joins and caps, which is exactly what a monoline face is. `advance` is the
 * pen movement; tracking is added by the caller because at display sizes this
 * face wants air and at caption sizes it wants a lot of air.
 */

const TAU = Math.PI * 2;

/** Elliptical arc, flattened. Angles in degrees, counter-clockwise, y up. */
function arc(cx, cy, rx, ry, a0, a1, steps = 0) {
  const sweep = Math.abs(a1 - a0);
  const n = steps || Math.max(6, Math.ceil(sweep / 7));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * TAU) / 360;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/** Cubic Bézier, flattened. */
function bez(p0, p1, p2, p3, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return pts;
}

/** Join flattened runs into one continuous polyline. */
const join = (...runs) => runs.flat();

/** A round dot, expressed as a zero-length segment so the cap draws it. */
const dot = (x, y) => [
  [x, y],
  [x, y],
];

/**
 * @typedef {{ advance: number, strokes: number[][][], weight?: number }} Glyph
 * `weight` multiplies the stroke width — used only by the ✘, which is a mark
 * rather than a letter and reads as broken at text weight.
 */

/** @type {Record<string, Glyph>} */
export const GLYPHS = {
  A: {
    advance: 0.7,
    strokes: [
      [
        [0, 0],
        [0.35, 1],
        [0.7, 0],
      ],
      [
        [0.11, 0.3],
        [0.59, 0.3],
      ],
    ],
  },
  B: {
    advance: 0.64,
    strokes: [
      [
        [0, 0],
        [0, 1],
      ],
      join(
        [
          [0, 1],
          [0.3, 1],
        ],
        arc(0.3, 0.755, 0.27, 0.245, 90, -90),
        [[0, 0.51]]
      ),
      join(
        [
          [0, 0.51],
          [0.31, 0.51],
        ],
        arc(0.31, 0.255, 0.29, 0.255, 90, -90),
        [[0, 0]]
      ),
    ],
  },
  C: { advance: 0.7, strokes: [arc(0.35, 0.5, 0.35, 0.5, 52, 308)] },
  D: {
    advance: 0.7,
    strokes: [
      [
        [0, 0],
        [0, 1],
      ],
      join(
        [
          [0, 1],
          [0.26, 1],
        ],
        arc(0.26, 0.5, 0.44, 0.5, 90, -90),
        [[0, 0]]
      ),
    ],
  },
  E: {
    advance: 0.6,
    strokes: [
      [
        [0.58, 1],
        [0, 1],
        [0, 0],
        [0.58, 0],
      ],
      [
        [0, 0.5],
        [0.46, 0.5],
      ],
    ],
  },
  F: {
    advance: 0.58,
    strokes: [
      [
        [0.56, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [0, 0.52],
        [0.44, 0.52],
      ],
    ],
  },
  G: {
    // Circle, opened in the lower-right quadrant, closed by the bar + spur
    // that distinguishes it from a C at caption sizes.
    advance: 0.72,
    strokes: [
      arc(0.36, 0.5, 0.36, 0.5, 14, 322),
      [
        [0.4, 0.5],
        [0.64, 0.5],
        [0.64, 0.188],
      ],
    ],
  },
  H: {
    advance: 0.66,
    strokes: [
      [
        [0, 0],
        [0, 1],
      ],
      [
        [0.66, 0],
        [0.66, 1],
      ],
      [
        [0, 0.5],
        [0.66, 0.5],
      ],
    ],
  },
  I: {
    advance: 0.08,
    strokes: [
      [
        [0.04, 0],
        [0.04, 1],
      ],
    ],
  },
  J: {
    advance: 0.54,
    strokes: [
      join(
        [
          [0.54, 1],
          [0.54, 0.27],
        ],
        arc(0.27, 0.27, 0.27, 0.27, 0, -180)
      ),
    ],
  },
  K: {
    advance: 0.64,
    strokes: [
      [
        [0, 0],
        [0, 1],
      ],
      [
        [0.62, 1],
        [0.04, 0.4],
      ],
      [
        [0.24, 0.56],
        [0.64, 0],
      ],
    ],
  },
  L: {
    advance: 0.56,
    strokes: [
      [
        [0, 1],
        [0, 0],
        [0.54, 0],
      ],
    ],
  },
  M: {
    advance: 0.84,
    strokes: [
      [
        [0, 0],
        [0, 1],
        [0.42, 0.26],
        [0.84, 1],
        [0.84, 0],
      ],
    ],
  },
  N: {
    advance: 0.68,
    strokes: [
      [
        [0, 0],
        [0, 1],
        [0.68, 0],
        [0.68, 1],
      ],
    ],
  },
  O: { advance: 0.72, strokes: [arc(0.36, 0.5, 0.36, 0.5, 0, 360)] },
  P: {
    advance: 0.62,
    strokes: [
      [
        [0, 0],
        [0, 1],
      ],
      join(
        [
          [0, 1],
          [0.3, 1],
        ],
        arc(0.3, 0.745, 0.3, 0.255, 90, -90),
        [[0, 0.49]]
      ),
    ],
  },
  Q: {
    advance: 0.72,
    strokes: [
      arc(0.36, 0.5, 0.36, 0.5, 0, 360),
      [
        [0.47, 0.17],
        [0.73, -0.07],
      ],
    ],
  },
  R: {
    advance: 0.66,
    strokes: [
      [
        [0, 0],
        [0, 1],
      ],
      join(
        [
          [0, 1],
          [0.3, 1],
        ],
        arc(0.3, 0.745, 0.3, 0.255, 90, -90),
        [[0, 0.49]]
      ),
      [
        [0.31, 0.49],
        [0.66, 0],
      ],
    ],
  },
  S: {
    advance: 0.62,
    strokes: [join(arc(0.31, 0.745, 0.29, 0.245, -20, 270), arc(0.31, 0.255, 0.29, 0.245, 90, -160))],
  },
  T: {
    advance: 0.62,
    strokes: [
      [
        [0, 1],
        [0.62, 1],
      ],
      [
        [0.31, 1],
        [0.31, 0],
      ],
    ],
  },
  U: {
    advance: 0.66,
    strokes: [
      join(
        [
          [0, 1],
          [0, 0.28],
        ],
        arc(0.33, 0.28, 0.33, 0.28, 180, 360),
        [[0.66, 1]]
      ),
    ],
  },
  V: {
    advance: 0.68,
    strokes: [
      [
        [0, 1],
        [0.34, 0],
        [0.68, 1],
      ],
    ],
  },
  W: {
    advance: 0.98,
    strokes: [
      [
        [0, 1],
        [0.2, 0],
        [0.49, 0.72],
        [0.78, 0],
        [0.98, 1],
      ],
    ],
  },
  X: {
    advance: 0.66,
    strokes: [
      [
        [0, 1],
        [0.66, 0],
      ],
      [
        [0, 0],
        [0.66, 1],
      ],
    ],
  },
  Y: {
    advance: 0.66,
    strokes: [
      [
        [0, 1],
        [0.33, 0.5],
        [0.66, 1],
      ],
      [
        [0.33, 0.5],
        [0.33, 0],
      ],
    ],
  },
  Z: {
    advance: 0.62,
    strokes: [
      [
        [0, 1],
        [0.62, 1],
        [0, 0],
        [0.62, 0],
      ],
    ],
  },

  0: { advance: 0.66, strokes: [arc(0.33, 0.5, 0.33, 0.5, 0, 360)] },
  1: {
    advance: 0.34,
    strokes: [
      [
        [0.04, 0.8],
        [0.3, 1],
        [0.3, 0],
      ],
    ],
  },
  2: {
    advance: 0.64,
    strokes: [
      join(arc(0.32, 0.72, 0.32, 0.28, 180, -12), [
        [0, 0],
        [0.64, 0],
      ]),
    ],
  },
  3: {
    advance: 0.62,
    strokes: [join(arc(0.31, 0.755, 0.29, 0.245, 170, -90), arc(0.31, 0.255, 0.31, 0.255, 90, -170))],
  },
  4: {
    advance: 0.68,
    strokes: [
      [
        [0.49, 1],
        [0, 0.29],
        [0.68, 0.29],
      ],
      [
        [0.49, 1],
        [0.49, 0],
      ],
    ],
  },
  5: {
    advance: 0.62,
    strokes: [
      join(
        [
          [0.6, 1],
          [0.1, 1],
          [0.05, 0.57],
        ],
        arc(0.31, 0.3, 0.31, 0.3, 100, -152)
      ),
    ],
  },
  6: {
    advance: 0.64,
    strokes: [arc(0.32, 0.3, 0.32, 0.3, 0, 360), bez([0, 0.34], [0, 0.82], [0.24, 1.0], [0.58, 0.95])],
  },
  7: {
    advance: 0.6,
    strokes: [
      [
        [0, 1],
        [0.6, 1],
        [0.22, 0],
      ],
    ],
  },
  8: {
    advance: 0.64,
    strokes: [arc(0.32, 0.745, 0.28, 0.245, 0, 360), arc(0.32, 0.255, 0.32, 0.255, 0, 360)],
  },
  9: {
    advance: 0.64,
    strokes: [arc(0.32, 0.7, 0.32, 0.3, 0, 360), bez([0.64, 0.66], [0.64, 0.18], [0.4, 0.0], [0.06, 0.05])],
  },

  ' ': { advance: 0.3, strokes: [] },
  '.': { advance: 0.26, strokes: [dot(0.13, 0.035)] },
  ',': {
    advance: 0.26,
    strokes: [
      [
        [0.15, 0.06],
        [0.05, -0.14],
      ],
    ],
  },
  '\u00B7': { advance: 0.36, strokes: [dot(0.18, 0.45)] },
  ':': { advance: 0.26, strokes: [dot(0.13, 0.66), dot(0.13, 0.035)] },
  '-': {
    advance: 0.46,
    strokes: [
      [
        [0.06, 0.45],
        [0.4, 0.45],
      ],
    ],
  },
  '\u2013': {
    advance: 0.64,
    strokes: [
      [
        [0.04, 0.45],
        [0.6, 0.45],
      ],
    ],
  },
  '\u2014': {
    advance: 0.92,
    strokes: [
      [
        [0.04, 0.45],
        [0.88, 0.45],
      ],
    ],
  },
  '/': {
    advance: 0.54,
    strokes: [
      [
        [0, -0.04],
        [0.54, 1.04],
      ],
    ],
  },
  '%': {
    advance: 0.94,
    strokes: [
      arc(0.19, 0.79, 0.19, 0.21, 0, 360),
      arc(0.75, 0.21, 0.19, 0.21, 0, 360),
      [
        [0.08, 0],
        [0.86, 1],
      ],
    ],
  },
  '+': {
    advance: 0.62,
    strokes: [
      [
        [0.31, 0.78],
        [0.31, 0.18],
      ],
      [
        [0.01, 0.48],
        [0.61, 0.48],
      ],
    ],
  },
  "'": {
    advance: 0.2,
    strokes: [
      [
        [0.1, 1],
        [0.1, 0.74],
      ],
    ],
  },
  '(': { advance: 0.34, strokes: [arc(0.42, 0.48, 0.36, 0.58, 148, 212)] },
  ')': { advance: 0.34, strokes: [arc(-0.08, 0.48, 0.36, 0.58, 32, -32)] },
  '\u00D7': {
    advance: 0.56,
    strokes: [
      [
        [0.04, 0.22],
        [0.52, 0.7],
      ],
      [
        [0.04, 0.7],
        [0.52, 0.22],
      ],
    ],
  },
  /** The brand mark. Heavier than the letters by design — it is a logo, not a glyph. */
  '\u2718': {
    advance: 0.84,
    weight: 1.6,
    strokes: [
      [
        [0.04, 0.02],
        [0.8, 0.98],
      ],
      [
        [0.04, 0.98],
        [0.8, 0.02],
      ],
    ],
  },
};

const MISSING = GLYPHS['\u00D7'];

/**
 * Width of a string in pixels.
 * @param {string} text
 * @param {{ size: number, tracking?: number }} style `size` = cap height in px
 */
export function measureText(text, { size, tracking = 0 }) {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const g = GLYPHS[text[i]] ?? MISSING;
    w += g.advance * size + (i < text.length - 1 ? tracking : 0);
  }
  return w;
}

/**
 * Lay a string out as absolute polylines in canvas space (y grows downward).
 *
 * @param {string} text
 * @param {object} style
 * @param {number} style.x pen origin; with `align: 'right'` this is the right edge
 * @param {number} style.y baseline
 * @param {number} style.size cap height in px
 * @param {number} [style.tracking] extra px between glyphs
 * @param {number} [style.weight] stroke width in px, returned per run
 * @param {'left'|'right'|'center'} [style.align]
 * @returns {{ runs: Array<{ points: number[][], width: number }>, width: number }}
 */
export function layoutText(text, { x, y, size, tracking = 0, weight = size * 0.1, align = 'left' }) {
  const width = measureText(text, { size, tracking });
  let pen = x;
  if (align === 'right') pen = x - width;
  else if (align === 'center') pen = x - width / 2;

  const runs = [];
  for (let i = 0; i < text.length; i++) {
    const g = GLYPHS[text[i]] ?? MISSING;
    for (const stroke of g.strokes) {
      runs.push({
        points: stroke.map(([gx, gy]) => [pen + gx * size, y - gy * size]),
        width: weight * (g.weight ?? 1),
      });
    }
    pen += g.advance * size + tracking;
  }
  return { runs, width };
}

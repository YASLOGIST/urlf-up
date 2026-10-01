#!/usr/bin/env node
/**
 * measure-bundle.mjs — objective, reproducible bundle accounting.
 *
 * Reports raw, gzip and brotli sizes for a build directory, and separates the
 * **critical path** (what a first-time visitor must download before the page
 * is interactive) from code that is only fetched on demand. The old
 * OPTIMIZATION_REPORT.md stated performance numbers that it openly labelled
 * "analytical based on code-path inspection"; this script measures instead.
 *
 * Usage:
 *   node scripts/measure-bundle.mjs [dir=dist] [--json]
 *   node scripts/measure-bundle.mjs <baselineDir> <currentDir> [--json]
 *
 * With two directories it prints a before/after table and exits non-zero if
 * the critical path grew, which makes it usable as a CI guard.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import path from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const asJson = process.argv.includes('--json');

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
  );

/**
 * Measure one build directory.
 *
 * "Critical path" = index.html plus every asset it references directly with a
 * src/href. Anything reachable only through a dynamic `import()` is excluded,
 * because the browser does not block first paint on it.
 */
function measure(dir) {
  if (!existsSync(dir)) {
    console.error(`No such directory: ${dir}. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const files = walk(dir)
    .filter((f) => /\.(js|css|html|json|webmanifest)$/.test(f) && !f.endsWith('.map'))
    .map((f) => {
      const buf = readFileSync(f);
      return {
        file: path.relative(dir, f),
        raw: statSync(f).size,
        gz: gzipSync(buf, { level: 9 }).length,
        br: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
      };
    })
    .sort((a, b) => b.gz - a.gz);

  let critical = files;
  const indexPath = path.join(dir, 'index.html');
  if (existsSync(indexPath)) {
    const src = readFileSync(indexPath, 'utf8');
    const refs = new Set([...src.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((m) => m[1]));
    critical = files.filter((f) => f.file === 'index.html' || refs.has(f.file));
  }

  const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);

  return {
    dir,
    files: files.length,
    total: { raw: sum(files, 'raw'), gz: sum(files, 'gz'), br: sum(files, 'br') },
    critical: {
      count: critical.length,
      files: critical.map((c) => c.file),
      raw: sum(critical, 'raw'),
      gz: sum(critical, 'gz'),
      br: sum(critical, 'br'),
    },
    breakdown: files,
  };
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const pct = (before, after) => {
  const d = ((after - before) / before) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
};

function printOne(report) {
  console.log(`\n  ${report.dir}  —  ${report.files} text assets\n`);
  console.log(`  ${'raw'.padStart(10)} ${'gzip'.padStart(10)} ${'brotli'.padStart(10)}   file`);
  console.log(`  ${'─'.repeat(70)}`);
  for (const f of report.breakdown) {
    console.log(`  ${kb(f.raw).padStart(10)} ${kb(f.gz).padStart(10)} ${kb(f.br).padStart(10)}   ${f.file}`);
  }
  console.log(`  ${'─'.repeat(70)}`);
  console.log(
    `  ${kb(report.total.raw).padStart(10)} ${kb(report.total.gz).padStart(10)} ${kb(report.total.br).padStart(10)}   TOTAL (all assets)`
  );
  console.log(
    `  ${kb(report.critical.raw).padStart(10)} ${kb(report.critical.gz).padStart(10)} ${kb(report.critical.br).padStart(10)}   CRITICAL PATH (${report.critical.count} files)`
  );
  console.log('');
}

function printComparison(before, after) {
  const rows = [
    ['critical path, gzip', before.critical.gz, after.critical.gz, kb],
    ['critical path, brotli', before.critical.br, after.critical.br, kb],
    ['critical path, raw', before.critical.raw, after.critical.raw, kb],
    ['critical path, files', before.critical.count, after.critical.count, String],
    ['all assets, gzip', before.total.gz, after.total.gz, kb],
    ['all assets, raw', before.total.raw, after.total.raw, kb],
  ];

  console.log(`\n  BASELINE  ${before.dir}`);
  console.log(`  CURRENT   ${after.dir}\n`);
  console.log(
    `  ${'metric'.padEnd(24)} ${'baseline'.padStart(12)} ${'current'.padStart(12)} ${'change'.padStart(10)}`
  );
  console.log(`  ${'─'.repeat(62)}`);
  for (const [label, b, a, fmt] of rows) {
    console.log(
      `  ${label.padEnd(24)} ${fmt(b).padStart(12)} ${fmt(a).padStart(12)} ${pct(b, a).padStart(10)}`
    );
  }
  console.log(`  ${'─'.repeat(62)}\n`);

  if (after.critical.gz > before.critical.gz) {
    console.error(
      `  REGRESSION: the critical path grew by ${kb(after.critical.gz - before.critical.gz)} gzip.`
    );
    process.exit(1);
  }
  console.log(
    `  OK — critical path is ${kb(before.critical.gz - after.critical.gz)} gzip smaller than baseline.\n`
  );
}

if (args.length >= 2) {
  const before = measure(args[0]);
  const after = measure(args[1]);
  if (asJson) {
    console.log(JSON.stringify({ baseline: before, current: after }, null, 2));
    process.exit(0);
  }
  printComparison(before, after);
} else {
  const report = measure(args[0] || 'dist');
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  printOne(report);
}

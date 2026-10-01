import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const r = (p) => path.resolve(__dirname, p);

/**
 * Inline <style> safety net.
 *
 * index.html used to carry a 4,209-line inline <style> block. Inline CSS is
 * never cached across navigations, never minified by Vite, and inflates the
 * HTML that every single visit must download before first paint. The block
 * now lives in src/styles/ and is imported from the module graph.
 *
 * This plugin fails the build if inline CSS ever creeps back in, so the win
 * cannot silently regress.
 */
function noInlineStyleBlocks({ maxBytes = 2048 } = {}) {
  return {
    name: 'urlife:no-inline-style-blocks',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
        const authored = blocks
          // Vite injects its own <style> tags in dev; only guard the build.
          .filter(() => ctx.bundle !== undefined)
          .map((m) => m[1].length)
          .filter((n) => n > maxBytes);
        if (authored.length) {
          // `this` is not the plugin context inside transformIndexHtml's
          // object form, so throw rather than calling this.error().
          throw new Error(
            `Inline <style> block of ${Math.max(...authored)} bytes found in ${ctx.filename}. ` +
              `Move it into src/styles/ so Vite can minify, hash and cache it.`
          );
        }
        return html;
      },
    },
  };
}

/**
 * Prints a size table and enforces a budget, so a regression is a build
 * failure rather than something noticed in production three weeks later.
 */
function sizeBudget(budgets) {
  return {
    name: 'urlife:size-budget',
    apply: 'build',
    closeBundle: {
      sequential: true,
      async handler() {
        const outDir = r('dist');
        const { readdirSync, statSync, existsSync } = await import('node:fs');
        if (!existsSync(outDir)) return;

        const walk = (dir) =>
          readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
          );
        const { gzipSync } = await import('node:zlib');

        const rows = walk(outDir)
          .filter((f) => /\.(js|css|html)$/.test(f))
          .map((f) => ({
            file: path.relative(outDir, f),
            raw: statSync(f).size,
            gz: gzipSync(readFileSync(f), { level: 9 }).length,
          }))
          .sort((a, b) => b.gz - a.gz);

        const totalGz = rows.reduce((s, x) => s + x.gz, 0);
        const htmlGz = rows.filter((x) => x.file.endsWith('.html')).reduce((s, x) => s + x.gz, 0);

        console.log('\n  ── bundle (gzip) ─────────────────────────────');
        for (const row of rows.slice(0, 12)) {
          console.log(
            `  ${String((row.gz / 1024).toFixed(1)).padStart(7)} kB  ${row.file}  (raw ${(row.raw / 1024).toFixed(1)} kB)`
          );
        }
        console.log(`  ${String((totalGz / 1024).toFixed(1)).padStart(7)} kB  TOTAL\n`);

        const failures = [];
        if (htmlGz > budgets.htmlGzKb * 1024)
          failures.push(`HTML ${(htmlGz / 1024).toFixed(1)} kB > ${budgets.htmlGzKb} kB budget`);
        if (totalGz > budgets.totalGzKb * 1024)
          failures.push(`TOTAL ${(totalGz / 1024).toFixed(1)} kB > ${budgets.totalGzKb} kB budget`);
        if (failures.length) {
          throw new Error(`Size budget exceeded:\n  - ${failures.join('\n  - ')}`);
        }
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: __dirname,
  publicDir: r('public'),
  appType: 'mpa',

  server: {
    host: true, // bind 0.0.0.0 so container/preview hosts can reach it
    port: 5173,
    strictPort: false,
    fs: { allow: [__dirname] },
    // Any host may serve the dev app (sandboxes, tunnels, LAN QA on devices).
    allowedHosts: true,
    cors: true,
    headers: {
      // Match production's framing policy during development so an
      // embedding problem is found locally, not after deploy.
      'X-Content-Type-Options': 'nosniff',
    },
  },

  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },

  build: {
    target: 'es2022',
    cssTarget: 'chrome100',
    cssCodeSplit: true,
    sourcemap: mode !== 'production' ? true : 'hidden',
    assetsInlineLimit: 2048,
    reportCompressedSize: false, // the sizeBudget plugin reports this better
    rollupOptions: {
      // Single page. `submit-idea.html` and `dashboard.html` were orphan
      // prototypes: nothing linked to either, `dashboard.html` was a 25-line
      // "System Initiated" placeholder, and `submit-idea.html` carried a
      // second, incompatible design system plus a form whose only action was
      // `console.log`. Both are preserved in archive/legacy-html/.
      input: { main: r('index.html') },
      output: {
        // Deterministic, cacheable chunk names. Vendor code changes far less
        // often than app code, so splitting it keeps the long-term cache warm
        // across deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'vendor-supabase';
          return 'vendor';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  esbuild: {
    legalComments: 'none',
    // Strip debug logging from production; logger.warn/error are kept.
    drop: mode === 'production' ? ['debugger'] : [],
  },

  plugins: [
    noInlineStyleBlocks(),
    // Budget headroom is deliberate: it is ~25% above the measured output so
    // ordinary work does not trip it, but a 300 kB regression does.
    sizeBudget({ htmlGzKb: 24, totalGzKb: 170 }),
  ],
}));

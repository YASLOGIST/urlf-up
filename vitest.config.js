import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, 'tests/setup.js')],
    include: ['tests/**/*.test.{js,mjs}'],
    // The archive/ tree is intentionally excluded: it holds superseded code
    // kept only for provenance.
    exclude: ['node_modules/**', 'dist/**', 'archive/**'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.bak*', 'src/v2-roadmap.md'],
      /**
       * Thresholds are per-file and deliberately asymmetric.
       *
       * The modules written or rewritten in this upgrade carry a hard floor,
       * so a regression in them fails CI. The pre-existing modules
       * (dashboard.js, settings.js, avatar.js, core.js …) are kept close to
       * their original form and are NOT yet under test; putting a high global
       * threshold on them would either block CI or force a meaningless
       * blanket lowering of the bar. The honest encoding of the real state is
       * a strict floor where tests exist and a low global floor that can only
       * ratchet upwards.
       */
      thresholds: {
        lines: 55,
        statements: 55,
        branches: 70,
        functions: 50,
        'src/app/boot.js': { lines: 85, functions: 80 },
        'src/app/i18n.js': { lines: 90, functions: 90 },
        'src/app/modal.js': { lines: 90, functions: 90 },
        'src/app/network.js': { lines: 90, functions: 90 },
        'src/lib/logger.js': { lines: 90, functions: 85 },
        'src/lib/supabase.js': { lines: 70, functions: 50 },
        'src/motion/reveal.js': { lines: 90, functions: 55 },
        'src/motion/scroll-fx.js': { lines: 90, functions: 70 },
        'src/motion/countup.js': { lines: 85, functions: 60 },
        'src/motion/pointer-fx.js': { lines: 80, functions: 70 },
        'src/validators.js': { lines: 100, functions: 100 },
        'src/sanitize.js': { lines: 100, functions: 100 },
        'src/ui.js': { lines: 90, functions: 85 },
        'src/visual/sim.js': { lines: 90, functions: 100 },
        'src/visual/field.js': { lines: 70, functions: 45 },
      },
    },
  },
  // Mirror the app's env so modules under test see the same shape.
  define: {
    'import.meta.env.DEV': false,
    'import.meta.env.PROD': true,
  },
});

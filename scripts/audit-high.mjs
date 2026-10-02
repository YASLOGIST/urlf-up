#!/usr/bin/env node
/**
 * Fail the build for high/critical advisories across the complete lockfile.
 *
 * `npm audit --audit-level=high` has the right exit semantics, but it still
 * prints every lower-severity advisory on successful runs. That makes the
 * normal verification output look failed even when the policy has passed.
 * This wrapper keeps the gate explicit: high/critical advisories fail; lower
 * severities are counted and left visible in npm-audit JSON if someone needs
 * the detail.
 */

import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['audit', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error(`Dependency audit failed to start: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch (err) {
  console.error('Dependency audit did not return parseable JSON.');
  if (result.stderr) console.error(result.stderr.trim());
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(result.status || 1);
}

if (report.error) {
  console.error(`Dependency audit failed: ${report.error.summary || report.error.code || 'unknown error'}`);
  if (report.error.detail) console.error(report.error.detail);
  process.exit(result.status || 1);
}

const vulnerabilities = Object.entries(report.vulnerabilities ?? {});
const severe = vulnerabilities.filter(([, vuln]) => ['high', 'critical'].includes(vuln.severity));

if (severe.length) {
  console.error(`Dependency audit failed: ${severe.length} high/critical package advisories found.`);
  for (const [name, vuln] of severe) {
    const via = Array.isArray(vuln.via)
      ? vuln.via
          .map((entry) => (typeof entry === 'string' ? entry : entry.title || entry.source || 'advisory'))
          .slice(0, 3)
          .join('; ')
      : '';
    console.error(`- ${name}: ${vuln.severity}${via ? ` — ${via}` : ''}`);
  }
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
const lowerSeverityCount = (counts.info ?? 0) + (counts.low ?? 0) + (counts.moderate ?? 0);
const suffix = lowerSeverityCount ? ` (${lowerSeverityCount} lower-severity advisories present)` : '';
console.log(`Dependency audit passed: 0 high/critical vulnerabilities${suffix}.`);

// Zero-install lint: syntax-check every .mjs, parse every .json, and hold the
// two house rules a test would be too late for (no dependencies; the README's
// last line is the licence line). Exits 1 on the first class of failure found.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['.git', 'node_modules']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const failures = [];

for (const f of files.filter((p) => extname(p) === '.mjs')) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) failures.push(`${f}: ${r.stderr.trim()}`);
}

for (const f of files.filter((p) => extname(p) === '.json')) {
  try {
    JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    failures.push(`${f}: ${e.message}`);
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  if (pkg[key] && Object.keys(pkg[key]).length) failures.push(`package.json declares ${key}; this repository is dependency-free`);
}

const LICENCE_LINE =
  'Licensed under Apache-2.0 (holder Flashy Labs); the estate register in flashyos `tools/estate-licences.mjs` is the authority.';
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').trimEnd().split('\n');
if (readme[readme.length - 1] !== LICENCE_LINE) failures.push('README.md: the final line must be the licence line');
const licensePath = join(ROOT, 'LICENSE');
if (!existsSync(licensePath)) {
  failures.push('LICENSE is missing; this repository is Apache-2.0 (holder Flashy Labs) per the flashyos register');
} else {
  const licence = readFileSync(licensePath, 'utf8');
  if (!licence.includes('Apache License')) failures.push('LICENSE is not the Apache License');
  if (!licence.includes('Copyright 2026 Flashy Labs')) failures.push('LICENSE does not name the copyright holder Flashy Labs');
}

if (failures.length) {
  for (const f of failures) process.stderr.write(`lint: ${f}\n`);
  process.exit(1);
}
process.stdout.write(`lint: ${files.filter((p) => extname(p) === '.mjs').length} .mjs checked, ${files.filter((p) => extname(p) === '.json').length} .json parsed, house rules hold\n`);

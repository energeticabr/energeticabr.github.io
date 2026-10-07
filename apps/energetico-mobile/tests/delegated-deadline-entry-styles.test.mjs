import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const [name, entry, stylesheet] of [
  ['native', '../src/main.js', './ui/delegated-deadline-report.css'],
  ['web/PWA', '../src/web/main.js', '../ui/delegated-deadline-report.css'],
]) {
  test(`${name} entry includes the delegated deadline report stylesheet in the application bundle`, () => {
    const source = readFileSync(new URL(entry, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/import\s+["']([^"']+\.css)["']\s*;/g)].map(match => match[1]);
    assert.ok(imports.includes(stylesheet), `${name} must load ${stylesheet}, not only the isolated report test fixture`);
  });
}

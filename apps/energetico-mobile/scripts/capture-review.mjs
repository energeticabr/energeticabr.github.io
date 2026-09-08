import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function selectReviewDevices({ devicetypes = [], runtimes = [] }) {
  const runtime = runtimes.find(item => item.isAvailable && /^iOS 26/.test(item.name));
  const phone = devicetypes.find(item => item.name === 'iPhone 13 Pro Max');
  const tablet = devicetypes.find(item => item.name.startsWith('iPad Pro 13-inch (M4)'));
  if (!runtime || !phone || !tablet) throw new Error('Required App Store Simulator sizes are unavailable');
  return { runtime: runtime.identifier, phone: phone.identifier, tablet: tablet.identifier };
}

function main() {
  if (!process.env.MAESTRO_REVIEW_USER || !process.env.MAESTRO_REVIEW_PASSWORD) throw new Error('Dedicated review credentials required');
  const xcrun = (...args) => execFileSync('xcrun', args, { encoding: 'utf8', timeout: 240_000 });
  const selected = selectReviewDevices(JSON.parse(xcrun('simctl', 'list', '--json')));
  const app = resolve(process.argv[2]);
  const output = resolve(process.argv[3] || 'build/review-screenshots');
  mkdirSync(output, { recursive: true });
  for (const [kind, device] of [['iphone', selected.phone], ['ipad', selected.tablet]]) {
    const id = xcrun('simctl', 'create', 'ENERGETICO-Review-' + kind, device, selected.runtime).trim();
    const runOutput = join(output, kind);
    mkdirSync(runOutput, { recursive: true });
    try {
      xcrun('simctl', 'boot', id);
      xcrun('simctl', 'bootstatus', id, '-b');
      xcrun('simctl', 'status_bar', id, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100');
      xcrun('simctl', 'install', id, app);
      execFileSync(process.env.MAESTRO_BIN || 'maestro', ['--device', id, 'test', '--test-output-dir', runOutput, 'tests/review-capture.yaml'], {
        stdio: 'inherit', timeout: 360_000, env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
      });
      const files = readdirSync(runOutput, { recursive: true }).map(name => join(runOutput, name));
      for (const name of ['01-menu', '02-demandas']) {
        const screenshot = files.find(file => file.endsWith('/' + name + '.png'));
        if (!screenshot) throw new Error('Native capture missing: ' + name);
        execFileSync('sips', ['-s', 'format', 'jpeg', screenshot, '--out', join(output, kind + '-' + name + '.jpg')], { stdio: 'inherit' });
      }
    } finally {
      try { xcrun('simctl', 'shutdown', id); } catch {}
      xcrun('simctl', 'delete', id); // Only the simulator created by this run.
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

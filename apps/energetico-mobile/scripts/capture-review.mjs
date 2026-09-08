import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function selectReviewDevices({ devicetypes = [], runtimes = [] }) {
  const runtime = runtimes.find(item => item.isAvailable && /^iOS 26/.test(item.name));
  const phone = devicetypes.find(item => item.name === 'iPhone 13 Pro Max');
  const tablet = devicetypes.find(item => item.name.startsWith('iPad Pro 13-inch (M4)'));
  if (!runtime || !phone || !tablet) throw new Error('Required App Store Simulator sizes are unavailable');
  return { runtime: runtime.identifier, phone: phone.identifier, tablet: tablet.identifier };
}

export function reviewDeviceTargets(selected, target) {
  const devices = [['iphone', selected.phone], ['ipad', selected.tablet]];
  if (!target) return devices;
  if (!['iphone', 'ipad'].includes(target)) throw new Error('Unknown review device target');
  return devices.filter(([kind]) => kind === target);
}

export function sanitizeReviewHierarchy(raw) {
  const labels = new Set(['Acesso de demonstração', 'Usuário de demonstração', 'Senha de demonstração',
    'Entrar na demonstração', 'Voltar ao acesso Microsoft', 'Demonstração — dados fictícios',
    'DEMANDAS', 'ADICIONAR UMA NOVA TAREFA', 'Sair', 'Não foi possível entrar na demonstração.']);
  const result = [];
  let tree;
  try { tree = JSON.parse(raw); } catch { return result; }
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const attributes = node.attributes || {};
    // Never copy text, value, input contents, tokens, arbitrary attributes or errors.
    const label = attributes.accessibilityText;
    if (labels.has(label)) result.push({ label,
      bounds: /^\[-?\d{1,5},-?\d{1,5}\]\[-?\d{1,5},-?\d{1,5}\]$/.test(attributes.bounds) ? attributes.bounds : null });
    if (Array.isArray(node.children)) node.children.forEach(visit);
  }
  visit(tree);
  return result;
}

// Called only on a newly created simulator, before any credential input.
// Preserve only these explicit files; authenticated Maestro debug output is private.
export function capturePreloginDiagnostics({ id, output, execute = execFileSync, environment = process.env }) {
  const env = { ...environment, MAESTRO_CLI_NO_ANALYTICS: 'true' };
  delete env.MAESTRO_REVIEW_USER;
  delete env.MAESTRO_REVIEW_PASSWORD;
  const maestro = environment.MAESTRO_BIN || 'maestro';
  mkdirSync(output, { recursive: true });
  try {
    execute(maestro, ['--device', id, 'test', '--test-output-dir', join(output, 'private-debug'), 'tests/review-prelogin.yaml'], {
      stdio: 'inherit', timeout: 540_000, env,
    });
  } finally {
    try {
      execute('xcrun', ['simctl', 'io', id, 'screenshot', join(output, 'screen.png')], { timeout: 60_000, env });
    } finally {
      const hierarchy = execute(maestro, ['--device', id, 'hierarchy'], { encoding: 'utf8', timeout: 120_000, env });
      writeFileSync(join(output, 'hierarchy.txt'), hierarchy);
    }
  }
}

function main() {
  if (!process.env.MAESTRO_REVIEW_USER || !process.env.MAESTRO_REVIEW_PASSWORD) throw new Error('Dedicated review credentials required');
  const xcrun = (...args) => execFileSync('xcrun', args, { encoding: 'utf8', timeout: 240_000 });
  const selected = selectReviewDevices(JSON.parse(xcrun('simctl', 'list', '--json')));
  const app = resolve(process.argv[2]);
  const output = resolve(process.argv[3] || 'build/review-screenshots');
  mkdirSync(output, { recursive: true });
  for (const [kind, device] of reviewDeviceTargets(selected, process.argv[4])) {
    const id = xcrun('simctl', 'create', 'ENERGETICO-Review-' + kind, device, selected.runtime).trim();
    const runOutput = join(output, kind);
    mkdirSync(runOutput, { recursive: true });
    try {
      xcrun('simctl', 'boot', id);
      xcrun('simctl', 'bootstatus', id, '-b');
      xcrun('simctl', 'status_bar', id, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100');
      xcrun('simctl', 'install', id, app);
      capturePreloginDiagnostics({ id, output: join(output, 'prelogin', kind) });
      let captureFailed = false;
      try {
        execFileSync(process.env.MAESTRO_BIN || 'maestro', ['--device', id, 'test', '--test-output-dir', runOutput, 'tests/review-capture.yaml'], {
          stdio: 'inherit', timeout: 540_000, env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
        });
      } catch {
        captureFailed = true;
        const diagnosticRoot = join(output, 'failure', kind);
        mkdirSync(diagnosticRoot, { recursive: true });
        let diagnostic = [];
        try {
          const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' };
          delete env.MAESTRO_REVIEW_USER;
          delete env.MAESTRO_REVIEW_PASSWORD;
          const raw = execFileSync(process.env.MAESTRO_BIN || 'maestro', ['--device', id, 'hierarchy'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000, env,
          });
          diagnostic = sanitizeReviewHierarchy(raw);
        } catch { /* Do not expose raw output through a diagnostic subprocess error. */ }
        writeFileSync(join(diagnosticRoot, 'ui-labels.json'), JSON.stringify(diagnostic, null, 2));
      }
      const files = readdirSync(runOutput, { recursive: true }).map(name => join(runOutput, name));
      for (const name of ['01-menu', '02-demandas']) {
        const screenshot = files.find(file => file.endsWith('/' + name + '.png'));
        if (!screenshot && captureFailed) continue;
        if (!screenshot) throw new Error('Native capture missing: ' + name);
        execFileSync('sips', ['-s', 'format', 'jpeg', screenshot, '--out', join(output, kind + '-' + name + '.jpg')], { stdio: 'inherit' });
      }
      if (captureFailed) throw new Error('Authenticated review flow failed; only allowlisted UI labels and completed public captures were retained');
    } finally {
      try { xcrun('simctl', 'shutdown', id); } catch {}
      xcrun('simctl', 'delete', id); // Only the simulator created by this run.
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

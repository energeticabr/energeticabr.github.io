import { readFileSync, writeFileSync } from 'node:fs';
import { buildReadOnlyProbe } from './build-probe.mjs';
const definition = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
writeFileSync(process.argv[3], JSON.stringify(buildReadOnlyProbe(definition), null, 2));
process.stdout.write('READ_ONLY_PROBE_BUILT\n');

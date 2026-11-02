import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProbeReadOnly } from '../build-probe.mjs';

test('a verificação de runtime rejeita conectores e qualquer outra escrita externa inclusive dentro de loops', () => {
  assert.throws(() => assertProbeReadOnly({ actions: { loop: { type: 'Foreach', actions: { write: { type: 'OpenApiConnection' } } } } }), /external/);
  assert.throws(() => assertProbeReadOnly({ actions: { call: { type: 'Http' } } }), /external/);
  assert.equal(assertProbeReadOnly({ actions: { calc: { type: 'Compose' } } }), true);
});

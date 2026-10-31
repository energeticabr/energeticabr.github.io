import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file=new URL('../scripts/Deploy-RetentionProvisions.ps1',import.meta.url);
const text=fs.readFileSync(file,'utf8');

test('deploy targets only the live fiscal receiver and preserves a rollback backup',()=>{
  assert.match(text,/\$receiver='aad7d18a-a45d-4f55-b7d8-daac9596c18b'/);
  assert.match(text,/03-Receber-NFe\.definition\.json/);
  assert.doesNotMatch(text,/02-Sincronizar-NFe\.definition\.json/);
  assert.match(text,/retention-provisions-before-/);
  assert.match(text,/WriteAllText\(\$backup/);
  assert.match(text,/Restore-Receiver/);
});

test('deploy refuses drift, preserves Started state and rereads the exact retention action',()=>{
  assert.match(text,/RETENTION_PROVISION_EXISTING_FLOW_NOT_STARTED/);
  assert.match(text,/RETENTION_PROVISION_LIVE_DRIFT/);
  assert.match(text,/Garantir_provisao_retencao/);
  assert.match(text,/ConvertTo-StableJson/);
  assert.match(text,/RETENTION_PROVISION_ACTION_MISMATCH/);
});

test('deploy permits only the pinned previous retention action during an intentional upgrade',()=>{
  assert.match(text,/1911bb3eeb1c2f80e659213ae5d97d9d52ded435ccbeffcee7d26aa2732eba42/);
  assert.match(text,/Get-StableSha256/);
  assert.match(text,/RETENTION_PROVISION_LIVE_DRIFT/);
  assert.doesNotMatch(text,/Assert-Live \$flow\s*\r?\n\s*return/);
});

test('deployment smoke is an empty fiscal batch and waits for terminal success',()=>{
  assert.match(text,/source='SEFAZ';companyCnpj='38626750000146';documents=@\(\)/);
  assert.match(text,/StartFlow \$receiver/);
  assert.match(text,/Wait-Run/);
  assert.match(text,/RETENTION_PROVISION_SMOKE_FAILED/);
  assert.match(text,/RETENTION_PROVISIONS_LIVE_VERIFIED/);
});

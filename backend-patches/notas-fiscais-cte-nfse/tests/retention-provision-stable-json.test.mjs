import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('stable PowerShell JSON ignores property order but detects semantic drift',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const module=path.join(root,'scripts/RetentionProvisionDeploy.psm1').replaceAll("'","''");
  const command=`$ErrorActionPreference='Stop'; Import-Module '${module}' -Force; $a='{\"b\":2,\"a\":{\"d\":4,\"c\":[2,1]}}'|ConvertFrom-Json; $b='{\"a\":{\"c\":[2,1],\"d\":4},\"b\":2}'|ConvertFrom-Json; $c='{\"a\":{\"c\":[1,2],\"d\":4},\"b\":2}'|ConvertFrom-Json; if((ConvertTo-StableJson $a) -cne (ConvertTo-StableJson $b)){throw 'ORDER_NOT_NORMALIZED'}; if((ConvertTo-StableJson $a) -ceq (ConvertTo-StableJson $c)){throw 'DRIFT_NOT_DETECTED'}; 'PASS'`;
  const output=execFileSync('pwsh',['-NoProfile','-Command',command],{encoding:'utf8'}).trim();
  assert.equal(output,'PASS');
});

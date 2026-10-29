import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function createFlowFixture(label='unified'){
  if(!/^[a-z-]+$/.test(label))throw new Error('Invalid fixture label');
  const base=path.resolve(tmpdir());
  const prefix='fiscal-flow-'+label+'-';
  const root=fs.mkdtempSync(path.join(base,prefix));
  for(const folder of ['config','scripts','powerautomate','tests'])fs.mkdirSync(path.join(root,folder));
  for(const name of ['build-flows.mjs','build-live-flows.mjs','danfe-flow.mjs'])fs.copyFileSync(path.join(source,'scripts',name),path.join(root,'scripts',name));
  fs.copyFileSync(path.join(source,'tests/wdl.mjs'),path.join(root,'tests/wdl.mjs'));
  const config={companyCnpj:'00000000000000',siteUrl:'https://example.sharepoint.com/sites/energetica',
    queueSiteUrl:'https://example-my.sharepoint.com/personal/fixture',listTitle:'NOTAS_FISCAIS_SEFAZ',
    libraryTitle:'DOCUMENTOS_FISCAIS_SEFAZ',libraryPath:'/sites/energetica/DOCUMENTOS_FISCAIS_SEFAZ',
    queueListTitle:'SEFAZ_COLETA_FILA',minimumIssueDate:'2026-10-01',desktopFlowId:'FICTICIO',desktopRunMode:'attended',
    scheduleTimeZone:'E. South America Standard Time',scheduleHours:[9,15,20],scheduleMinutes:[0]};
  fs.writeFileSync(path.join(root,'config/energetica.json'),JSON.stringify(config));
  return {root,config,
    build(){for(const script of ['build-flows.mjs','build-live-flows.mjs'])execFileSync(process.execPath,[path.join(root,'scripts',script)],{cwd:base});},
    read(name){return JSON.parse(fs.readFileSync(path.join(root,'powerautomate',name)));},
    cleanup(){const target=path.resolve(root);if(path.dirname(target)!==base||!path.basename(target).startsWith(prefix))throw new Error('Unsafe cleanup target');fs.rmSync(target,{recursive:true,force:true});},
  };
}

import {setTimeout as delay} from 'node:timers/promises';

export function parseDevToolsEndpoint(contents) {
  const lines=String(contents||'').trim().split(/\r?\n/);
  if(lines.length!==2)return null;
  const [port,path]=lines;
  if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535
    ||!/^\/devtools\/browser\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(path))return null;
  return `ws://127.0.0.1:${port}${path}`;
}

export async function waitForDevToolsEndpoint({read,isExited=()=>false,attempts=200,intervalMs=100}) {
  const count=Math.max(1,Math.min(200,Number(attempts)||200));
  for(let attempt=0;attempt<count;attempt++) {
    if(isExited())throw new Error('O navegador de testes encerrou antes de iniciar.');
    try {
      const endpoint=parseDevToolsEndpoint(await read());
      if(endpoint)return endpoint;
    }catch(error){if(!['ENOENT','EACCES','EPERM','EBUSY'].includes(error.code))throw error;}
    await delay(Math.max(1,Math.min(100,Number(intervalMs)||100)));
  }
  throw new Error('Chrome não iniciou com o endpoint completo.');
}

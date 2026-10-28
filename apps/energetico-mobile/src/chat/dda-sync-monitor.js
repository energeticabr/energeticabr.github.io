import { formatDdaElapsed } from './dda-bank-refresh.js';
const validId=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const active=new Set(['starting','queued','running']);
const terminal=new Set(['succeeded','failed']);
function clean(value,now){
 if(!validId(value?.requestId)||!['starting','queued','running','succeeded','failed'].includes(value.status))throw Error('INVALID_DDA_RECEIPT');
 const result={requestId:value.requestId,status:value.status,startedAt:Number.isFinite(value.startedAt)?value.startedAt:now};
 if(value.acknowledged===true&&terminal.has(value.status))result.acknowledged=true;
 if(['SYNC_FAILED','WORKER_UNAVAILABLE','BUSY'].includes(value.code))result.code=value.code;
 for(const key of ['created','updated','verified'])if(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=1000000)result[key]=value[key];
 const ids=value.createdItemIds;
 if(Array.isArray(ids)&&ids.length===result.created&&ids.length<=10000&&ids.every(id=>Number.isSafeInteger(id)&&id>0&&id<=2147483647)&&new Set(ids).size===ids.length)result.createdItemIds=[...ids];
 return result;
}

/** Owns manual operations beyond gallery lifetime. Only explicit UI acknowledgement consumes a result. */
export function createDdaSyncMonitor({client,accountKey,storage,present=async()=>false,hide=()=>{},isVisible=()=>true,
 isCurrent=()=>true,now=Date.now,randomId=()=>globalThis.crypto.randomUUID().replaceAll('-',''),
 schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout,requestTimeoutMs=35000}={}){
 if(typeof accountKey!=='string'||!accountKey)throw Error('DDA_ACCOUNT_REQUIRED');
 const key=`energetico.dda-sync.v1:${encodeURIComponent(accountKey)}`,records=new Map(),listeners=new Set();
 let destroyed=false,inFlight=null,timer=null,discover=false,showing=null,notice='',controller=null;
 try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved?.version===1&&Array.isArray(saved.records))for(const row of saved.records){const r=clean(row,now());records.set(r.requestId,r);}}catch{/* Authenticated server recovery remains authoritative. */}
 const current=()=>!destroyed&&isCurrent();
 const running=()=>[...records.values()].some(r=>active.has(r.status));
 function persist(){
  if(!storage?.setItem)throw Error('Não foi possível registrar a atualização neste aparelho. Tente novamente.');
  try{storage.setItem(key,JSON.stringify({version:1,records:[...records.values()]}));}
  catch{throw Error('Não foi possível salvar o acompanhamento neste aparelho. Tente novamente.');}
 }
 function notify(){for(const listener of listeners)listener({running:running(),notice});}
 function remember(value,previous){
  const r=clean({...value,startedAt:previous?.startedAt??value.startedAt,acknowledged:previous?.acknowledged},now());
  if(previous&&previous.requestId!==r.requestId)records.delete(previous.requestId);
  records.set(r.requestId,r);persist();return r;
 }
 async function request(fn){
  if(!current())throw new DOMException('Sessão encerrada.','AbortError');
  const aborter=controller=new AbortController();let rejectWait;
  const cancelled=new Promise((_,reject)=>{rejectWait=reject;});
  const abort=()=>rejectWait(new DOMException('Sessão encerrada.','AbortError'));
  aborter.signal.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(()=>{rejectWait(Error('DDA_REQUEST_TIMEOUT'));aborter.abort();},requestTimeoutMs);
  try{const result=await Promise.race([fn(aborter.signal),cancelled]);if(!current())throw new DOMException('Sessão encerrada.','AbortError');return result;}
  finally{clearTimeout(timeout);aborter.signal.removeEventListener('abort',abort);if(controller===aborter)controller=null;}
 }
 async function presentNext(){
  if(!current()||showing||!isVisible())return;
  const r=[...records.values()].find(r=>terminal.has(r.status)&&!r.acknowledged);if(!r)return;
  showing=r.requestId;
  const message=r.status==='failed'?(r.code==='BUSY'?'Já havia outra consulta em andamento. Esta solicitação não foi iniciada.':r.code==='WORKER_UNAVAILABLE'?'Não foi possível concluir a consulta: o computador responsável pelo Sicoob ficou indisponível.':'A consulta ao Sicoob ou a atualização no SharePoint não foi concluída. Os dados podem estar desatualizados.'):undefined;
  try{
   const visible=await present({...r,message,elapsedMs:Math.max(0,now()-r.startedAt)},async()=>{
    if(!current()||showing!==r.requestId||!isVisible())return;
    const old=records.get(r.requestId);if(!old)return;
    records.set(r.requestId,{...old,acknowledged:true});
    try{persist();}catch{records.set(r.requestId,old);return false;}
    showing=null;hide();void cycle();return true;
   });
   if(!visible&&showing===r.requestId)showing=null;
  }catch{if(showing===r.requestId)showing=null;}
 }
 function arm(){
  if(timer!==null)cancel(timer);timer=null;
  if(current()&&(discover||[...records.values()].some(r=>active.has(r.status)||r.acknowledged)))timer=schedule(()=>{timer=null;void cycle();},3000);
 }
 function cycle(){
  if(!current())return Promise.resolve();if(inFlight)return inFlight;
  inFlight=(async()=>{
   if(discover){
    discover=false;
    try{
     const pending=await request(signal=>client.getDdaRefreshPending({signal}));
     if(pending?.status!=='pending'||!Array.isArray(pending.requests))throw Error('INVALID_DDA_PENDING');
     // Validate the complete response before accepting any member.
     const safe=pending.requests.map(row=>clean(row,now()));
     for(const row of safe)remember(row,records.get(row.requestId));
    }catch(error){if(!current())return;notice='Sem conexão para recuperar as atualizações DDA. O acompanhamento será retomado automaticamente.';discover=true;}
   }
   for(const saved of [...records.values()]){
    if(!current())return;const r=records.get(saved.requestId);if(!r)continue;
    try{
     if(r.acknowledged){
      const ack=await request(signal=>client.acknowledgeDdaRefresh(r.requestId,{signal}));
      if(ack?.status!=='acknowledged'||ack.requestId!==r.requestId)throw Error('INVALID_DDA_ACK');
      records.delete(r.requestId);persist();continue;
     }
     if(active.has(r.status)){
      const result=await request(signal=>r.status==='starting'?client.refreshDda({requestId:r.requestId,signal}):client.getDdaRefreshStatus(r.requestId,{signal}));
      if(r.status!=='starting'&&result?.requestId!==r.requestId)throw Error('DDA_ID_MISMATCH');
      const next=remember(result,r);
      notice=active.has(next.status)?`Consultando o Sicoob e atualizando o SharePoint. Tempo decorrido: ${formatDdaElapsed(now()-next.startedAt)}. Você pode sair desta tela; o resultado será exibido ao voltar.`:'';
     }
    }catch{if(!current())return;notice='Conexão interrompida. A solicitação foi preservada e o resultado será verificado novamente.';}
   }
   notify();await presentNext();
  })().finally(()=>{inFlight=null;arm();});
  return inFlight;
 }
 return {
  async start(){
   if(!current())throw Error('Sessão encerrada.');
   if(running()){await cycle();return;}
   const requestId=randomId();if(!validId(requestId))throw Error('INVALID_DDA_REQUEST_ID');
   records.set(requestId,{requestId,status:'starting',startedAt:now()});
   try{persist();}catch(error){records.delete(requestId);throw error;}
   notice='Solicitando atualização ao Sicoob…';notify();await cycle();
  },
  resume(){discover=true;return cycle();},
  suspend(){showing=null;hide();},
  subscribe(listener){listeners.add(listener);listener({running:running(),notice});return()=>listeners.delete(listener);},
  get running(){return running();},get pendingCount(){return records.size;},
  destroy(){destroyed=true;controller?.abort();if(timer!==null)cancel(timer);timer=null;showing=null;hide();listeners.clear();},
 };
}

import {validateSefazReceipt,isSefazRequestId,isSefazTerminal,sefazProgress} from './sefaz-sync-receipt.js';

function clean(value) {
  if (value?.status === 'starting') {
    if (!isSefazRequestId(value.requestId) || !Number.isFinite(value.startedAt)) throw Error('Pedido fiscal inválido.');
    return {requestId:value.requestId,status:'starting',startedAt:value.startedAt};
  }
  const result=validateSefazReceipt(value);
  result.startedAt=Date.parse(result.startedUtc);
  if (isSefazTerminal(result.status)) {
    result.completedAt=Date.parse(result.completedUtc);
    if (value.acknowledged === true) result.acknowledged=true;
  }
  return result;
}

function confirmedTime(value) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw Error('Data fiscal inválida.');
  const result=Date.parse(value);
  if (!Number.isFinite(result)) throw Error('Data fiscal inválida.');
  return result;
}

/** A session-owned durable intent; navigation never consumes a server result. */
export function createSefazSyncMonitor({client,accountKey,storage,present=async()=>false,hide=()=>{},isVisible=()=>true,
  isCurrent=()=>true,now=Date.now,randomId=()=>globalThis.crypto.randomUUID().replaceAll('-',''),
  schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout,requestTimeoutMs=35000}={}) {
  if (typeof accountKey !== 'string' || !accountKey) throw Error('Conta fiscal não identificada.');
  const key=`energetico.sefaz-sync.v1:${encodeURIComponent(accountKey)}`,records=new Map(),listeners=new Set();
  let destroyed=false,inFlight=null,timer=null,discover=false,showing=null,notice='',controller=null,lastSuccessfulAt=null;
  try {
    const saved=JSON.parse(storage?.getItem(key)||'null');
    if (saved?.version===1 && Array.isArray(saved.records)) {
      const safe=saved.records.map(clean);
      for (const row of safe) records.set(row.requestId,row);
      if (Number.isFinite(saved.lastSuccessfulAt) && saved.lastSuccessfulAt >= 0) lastSuccessfulAt=saved.lastSuccessfulAt;
    }
  } catch { /* The authenticated server recovers corrupt/missing local state. */ }
  const current=()=>!destroyed && isCurrent();
  const running=()=>[...records.values()].some(r=>!isSefazTerminal(r.status));
  function persist() {
    try {
      if (!storage?.setItem) throw Error('unavailable');
      storage.setItem(key,JSON.stringify({version:1,records:[...records.values()],lastSuccessfulAt}));
    } catch { throw Error('Não foi possível salvar o acompanhamento fiscal neste aparelho. Tente novamente.'); }
  }
  function snapshot() { return {running:running(),notice,latest:[...records.values()].sort((a,b)=>b.startedAt-a.startedAt)[0]||null,lastSuccessfulAt}; }
  function notify() { for (const listener of listeners) listener(snapshot()); }
  function remember(value,previous) {
    const next=clean({...value,acknowledged:previous?.acknowledged});
    if (previous && previous.requestId!==next.requestId) records.delete(previous.requestId);
    records.set(next.requestId,next);
    if (next.status === 'succeeded') lastSuccessfulAt=Math.max(lastSuccessfulAt ?? 0,next.completedAt);
    // Server receipts are already durable; storage failure must not hide them.
    try { persist(); } catch { notice='O armazenamento local está indisponível. O resultado continua salvo no servidor.'; }
    return next;
  }
  async function request(fn) {
    if (!current()) throw new DOMException('Sessão encerrada.','AbortError');
    const aborter=controller=new AbortController();let rejectWait;
    const cancelled=new Promise((_,reject)=>{rejectWait=reject;});
    const abort=()=>rejectWait(new DOMException('Sessão encerrada.','AbortError'));
    aborter.signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>{rejectWait(Error('FISCAL_REQUEST_TIMEOUT'));aborter.abort();},requestTimeoutMs);
    try {
      const result=await Promise.race([fn(aborter.signal),cancelled]);
      if (!current()) throw new DOMException('Sessão encerrada.','AbortError');
      return result;
    } finally { clearTimeout(timeout);aborter.signal.removeEventListener('abort',abort);if(controller===aborter)controller=null; }
  }
  async function presentNext() {
    if (!current() || showing || !isVisible()) return;
    const row=[...records.values()].find(r=>isSefazTerminal(r.status)&&!r.acknowledged);
    if (!row) return;
    showing=row.requestId;
    try {
      const shown=await present(row,async()=>{
        if (!current() || showing!==row.requestId || !isVisible()) return false;
        const previous=records.get(row.requestId);
        if (!previous) return false;
        records.set(row.requestId,{...previous,acknowledged:true});
        try { persist(); } catch { records.set(row.requestId,previous);return false; }
        showing=null;hide();void cycle();return true;
      });
      if (!shown && showing===row.requestId) showing=null;
    } catch { if(showing===row.requestId)showing=null; }
  }
  function arm() {
    if(timer!==null)cancel(timer);timer=null;
    if(current()&&(discover||[...records.values()].some(r=>!isSefazTerminal(r.status)||r.acknowledged||(!showing&&isVisible()))))
      timer=schedule(()=>{timer=null;void cycle();},3000);
  }
  function cycle() {
    if(!current())return Promise.resolve();if(inFlight)return inFlight;
    inFlight=(async()=>{
      if(discover){
        discover=false;
        try {
          const pending=await request(signal=>client.getSefazRefreshPending({signal}));
          if(pending?.status!=='pending'||!Array.isArray(pending.requests))throw Error('Resposta fiscal inválida.');
          const safe=pending.requests.map(validateSefazReceipt);
          const serverSuccess=pending.lastSuccessfulUtc===undefined?null:confirmedTime(pending.lastSuccessfulUtc);
          if(serverSuccess!==null && serverSuccess>(lastSuccessfulAt ?? 0)){
            lastSuccessfulAt=serverSuccess;
            try{persist();}catch{notice='O armazenamento local está indisponível. O resultado continua salvo no servidor.';}
          }
          for(const row of safe)remember(row,records.get(row.requestId));
        }catch{if(!current())return;notice='Sem conexão para recuperar as consultas fiscais. O acompanhamento será retomado automaticamente.';discover=true;}
      }
      for(const saved of [...records.values()]){
        if(!current())return;const row=records.get(saved.requestId);if(!row)continue;
        try {
          if(row.acknowledged){
            const ack=await request(signal=>client.acknowledgeSefazRefresh(row.requestId,{signal}));
            if(ack?.status!=='acknowledged'||ack.requestId!==row.requestId)throw Error('Reconhecimento fiscal inválido.');
            records.delete(row.requestId);try{persist();}catch{/* A stale persisted ACK is safe to retry. */}continue;
          }
          if(!isSefazTerminal(row.status)){
            const value=await request(signal=>row.status==='starting'?client.refreshSefaz({requestId:row.requestId,signal}):client.getSefazRefreshStatus(row.requestId,{signal}));
            if(row.status!=='starting'&&value?.requestId!==row.requestId)throw Error('Pedido fiscal divergente.');
            const next=remember(validateSefazReceipt(value),row);
            notice=isSefazTerminal(next.status)?'':`${sefazProgress(next)}\nVocê pode sair desta tela. O resultado será exibido ao concluir.`;
          }
        }catch{if(!current())return;notice='Conexão interrompida ou resposta fiscal não confirmada. A solicitação foi preservada e será verificada novamente.';}
      }
      notify();await presentNext();
    })().finally(()=>{inFlight=null;arm();});
    return inFlight;
  }
  return {
    async start(){
      if(!current())throw Error('Sessão encerrada.');
      if(running()){await cycle();return;}
      const requestId=randomId();if(!isSefazRequestId(requestId))throw Error('Pedido fiscal inválido.');
      records.set(requestId,{requestId,status:'starting',startedAt:now()});
      try{persist();}catch(error){records.delete(requestId);throw error;}
      notice='Solicitando consulta de NF-e, CT-e e NFS-e nacional…';notify();await cycle();
    },
    resume(){discover=true;return cycle();},
    suspend(){showing=null;hide();},
    subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
    get running(){return running();},get pendingCount(){return records.size;},
    destroy(){destroyed=true;controller?.abort();if(timer!==null)cancel(timer);timer=null;showing=null;hide();listeners.clear();},
  };
}

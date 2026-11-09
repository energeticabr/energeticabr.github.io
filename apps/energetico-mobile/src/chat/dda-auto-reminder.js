import {normalizeDdaReportRows,buildDdaReport,ddaSettlementPending,readDdaSettledProvisionIds} from './dda-report-model.js';

const brasiliaHour=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'});

// A deferred check is repeated before display to catch payments or settlements
// recorded while another report was open.
export function createDdaAutoReminder({loadData,canOpen,open,interaction=()=>null,now=Date.now,interval=30*60*1000,onChange=()=>{},enabled=()=>true}){
 let revision=0,request=null,queued=false,lastShown=null,controller=null,opening=false,visible=false;
 let requestInteraction;
 let lastPending=false;
 const notify=(force=false)=>{const pending=queued||opening||visible;if(force||pending!==lastPending){lastPending=pending;onChange();}};
 async function check(signal){
  const {snapshot,provisionLink}=await loadData({signal});
  signal.throwIfAborted();
  const rows=normalizeDdaReportRows(snapshot);
  const result=buildDdaReport(rows,{status:'Não pagos'},new Date(now()));
  if(result.overdue+result.today>0)return {snapshot};
  const settledProvisionIds=await readDdaSettledProvisionIds(rows,provisionLink,signal);
  const settled=settledProvisionIds??new Set();
  return rows.some(row=>ddaSettlementPending(row,settled))?{snapshot,settledProvisionIds}:null;
 }
 function refresh(){
  if(!enabled())return Promise.resolve(false);
  if(visible)return Promise.resolve(false);
  const time=now();
  if(lastShown!==null&&time-lastShown<interval&&Number(brasiliaHour.format(time))<15)return Promise.resolve(false);
  const interactionId=interaction();
  if(request&&requestInteraction===interactionId)return request;
  if(request){controller.abort();opening=false;}
  requestInteraction=interactionId;
  const generation=++revision,active=new AbortController();controller=active;
  const current=()=>generation===revision&&!active.signal.aborted&&interactionId===interaction();
  const work=Promise.resolve().then(async()=>{
   let timer;
   try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{active.abort();reject(new Error('DDA_TIMEOUT'));},8000);timer.unref?.();});
    const eligible=await Promise.race([check(active.signal),timeout]);
    clearTimeout(timer);
    if(!current())return false;
    queued=Boolean(eligible);
    notify();
    if(!queued||!canOpen())return false;
    queued=false;opening=true;
    notify();
    const shown=await open({automatic:true,initialSnapshot:eligible.snapshot,initialSettledProvisionIds:eligible.settledProvisionIds,isCurrent:()=>current()&&canOpen()});
    if(shown&&current()){lastShown=now();visible=true;}
    return Boolean(shown&&current());
   }catch{if(generation===revision)queued=false;return false;}
   finally{clearTimeout(timer);if(generation===revision){request=null;controller=null;opening=false;notify(queued);}}
  });
  request=work;return work;
 }
 return Object.freeze({get pending(){return queued||opening||visible;},dismiss(){visible=false;notify();},refresh,drain(){return queued&&canOpen()?refresh():Promise.resolve(false);},reset(){revision++;controller?.abort();controller=null;request=null;queued=false;opening=false;visible=false;lastShown=null;notify();}});
}

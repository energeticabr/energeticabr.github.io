import {normalizeDdaReportRows,buildDdaReport,ddaSettlementPending,readSettledDdaIds} from './dda-report-model.js';
import {ddaTodayKey} from '../ui/dda-card.js';

const brasiliaHour=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'});

function weekendDate(time){
 const date=ddaTodayKey(new Date(time));
 const day=new Date(date).getUTCDay();
 return day===0||day===6?date:null;
}

// A deferred check is repeated before display to catch payments or settlements
// recorded while another report was open.
export function createDdaAutoReminder({loadData,canOpen,open,accountId=()=>'',interaction=()=>null,now=Date.now,interval=30*60*1000,onChange=()=>{},enabled=()=>true}){
 let revision=0,request=null,queued=false,lastShown=null,controller=null,opening=false,visible=false;
 let requestInteraction;
 let lastPending=false;
 const weekendShownDates=new Map();
 const notify=(force=false)=>{const pending=queued||opening||visible;if(force||pending!==lastPending){lastPending=pending;onChange();}};
 function alreadyShownOnWeekend(date,key){
  if(!date)return false;
  if(weekendShownDates.get(key)===date)return true;
  try{
   return Boolean(key)&&globalThis.localStorage?.getItem(key)===date;
  }catch{return false;}
 }
 function rememberWeekendDisplay(date,key){
  if(!date)return;
  weekendShownDates.set(key,date);
  try{
   if(key)globalThis.localStorage?.setItem(key,date);
  }catch{/* Keep the in-memory limit if storage is unavailable. */}
 }
 async function check(signal){
  const {snapshot,provisionLink}=await loadData({signal});
  signal.throwIfAborted();
  // Explicitly regularized unlinked titles remain in the report, but do not
  // request payment or provision-settlement reminders.
  const rows=normalizeDdaReportRows(snapshot).filter(row=>row.provisionId||!row.linkReviewed);
  const result=buildDdaReport(rows,{status:'Não pagos'},new Date(now()));
  if(result.overdue+result.today>0)return {snapshot};
  const settledDdaIds=await readSettledDdaIds(rows,provisionLink,signal);
  const settled=settledDdaIds??new Set();
  return rows.some(row=>ddaSettlementPending(row,settled))?{snapshot,settledDdaIds}:null;
 }
 function refresh(){
  if(!enabled())return Promise.resolve(false);
  if(visible)return Promise.resolve(false);
  const time=now();
  const date=weekendDate(time),account=accountId();
  const key=account?`energetico.dda-weekend-reminder:${account}`:'';
  if(alreadyShownOnWeekend(date,key)){
   queued=false;
   notify();
   return Promise.resolve(false);
  }
  if(!date&&lastShown!==null&&time-lastShown<interval&&Number(brasiliaHour.format(time))<15)return Promise.resolve(false);
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
    queued=Boolean(eligible)&&!alreadyShownOnWeekend(weekendDate(now()),key);
    notify();
    if(!queued||!canOpen())return false;
    queued=false;opening=true;
    notify();
    let recordedDisplay=false;
    const onShown=()=>{
     if(recordedDisplay||!current())return;
     recordedDisplay=true;
     rememberWeekendDisplay(weekendDate(now()),key);
    };
    const shown=await open({
     automatic:true,initialSnapshot:eligible.snapshot,initialSettledDdaIds:eligible.settledDdaIds,onShown,
     isCurrent:()=>current()&&canOpen()&&!alreadyShownOnWeekend(weekendDate(now()),key),
    });
    if(shown&&current()){
     lastShown=now();
     onShown();
     visible=true;
    }
    return Boolean(shown&&current());
   }catch{if(generation===revision)queued=false;return false;}
   finally{clearTimeout(timer);if(generation===revision){request=null;controller=null;opening=false;notify(queued);}}
  });
  request=work;return work;
 }
 return Object.freeze({get pending(){return queued||opening||visible;},dismiss(){visible=false;notify();},refresh,drain(){return queued&&canOpen()?refresh():Promise.resolve(false);},reset(){revision++;controller?.abort();controller=null;request=null;queued=false;opening=false;visible=false;lastShown=null;notify();}});
}

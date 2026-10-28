import {normalizeDdaReportRows,buildDdaReport} from './dda-report-model.js';

// Read-only reminder. A deferred check is repeated before display so a payment
// recorded while the provision report was open cannot trigger a stale warning.
export function createDdaAutoReminder({loadSnapshot,canOpen,open,now=Date.now,interval=30*60*1000,onChange=()=>{},enabled=()=>true}){
 let revision=0,request=null,queued=false,lastShown=null,controller=null,opening=false,visible=false;
 let lastPending=false;
 const notify=(force=false)=>{const pending=queued||opening||visible;if(force||pending!==lastPending){lastPending=pending;onChange();}};
 const eligible=snapshot=>{
  const result=buildDdaReport(normalizeDdaReportRows(snapshot),{status:'Não pagos'},new Date(now()));
  return result.overdue+result.today>0;
 };
 function refresh(){
  if(!enabled())return Promise.resolve(false);
  if(request)return request;
  if(visible)return Promise.resolve(false);
  if(lastShown!==null&&now()-lastShown<interval)return Promise.resolve(false);
  const generation=revision,active=new AbortController();controller=active;
  const current=()=>generation===revision&&!active.signal.aborted;
  const work=Promise.resolve().then(async()=>{
   let timer;
   try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{active.abort();reject(new Error('DDA_TIMEOUT'));},8000);timer.unref?.();});
    const snapshot=await Promise.race([loadSnapshot({signal:active.signal}),timeout]);
    if(!current())return false;
    queued=eligible(snapshot);
    notify();
    if(!queued||!canOpen())return false;
    queued=false;opening=true;
    notify();
    const shown=await open({automatic:true,initialSnapshot:snapshot,isCurrent:()=>current()&&canOpen()});
    if(shown&&current()){lastShown=now();visible=true;}
    return Boolean(shown&&current());
   }catch{if(generation===revision)queued=false;return false;}
   finally{clearTimeout(timer);if(generation===revision){request=null;controller=null;opening=false;notify(queued);}}
  });
  request=work;return work;
 }
 return Object.freeze({get pending(){return queued||opening||visible;},dismiss(){visible=false;notify();},refresh,drain(){return queued&&canOpen()?refresh():Promise.resolve(false);},reset(){revision++;controller?.abort();controller=null;request=null;queued=false;opening=false;visible=false;lastShown=null;notify();}});
}

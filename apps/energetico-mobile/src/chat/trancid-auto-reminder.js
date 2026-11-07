/** A low card balance is shown once per foreground, after active work is safe. */
export function createTrancidAutoReminder({loadReport,canOpen,open,enabled=()=>true,onChange=()=>{},timeoutMs=20_000}) {
 let revision=0,request=null,abort=null,queued=false,opening=false,visible=false,shown=false;
 let notified=false;
 const pending=()=>Boolean(request)||queued||opening||visible;
 const notify=(force=false)=>{const value=pending();if(force||value!==notified){notified=value;onChange();}};
 const eligible=report=>Array.isArray(report?.cards)&&report.cards.length>0
  &&report.cards.every(card=>Number.isSafeInteger(card.balanceCents))
  &&report.cards.some(card=>card.balanceCents<4000);
 function refresh() {
  if(!enabled()||shown||visible)return Promise.resolve(false);
  if(request)return request;
  const generation=revision,controller=new AbortController();abort=controller;
  const current=()=>generation===revision&&!controller.signal.aborted&&enabled();
  const work=Promise.resolve().then(async()=>{
   let timer;
   try {
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('TRANCID_TIMEOUT'));},timeoutMs);timer.unref?.();});
    const report=await Promise.race([loadReport({signal:controller.signal,refresh:true}),timeout]);
    if(!current())return false;
    queued=eligible(report);notify();
    if(!queued||!canOpen())return false;
    queued=false;opening=true;notify();
    const opened=await open({automatic:true,initialSnapshot:report,isCurrent:()=>current()&&canOpen()});
    if(opened&&current()){shown=true;visible=true;}
    else if(current()&&!shown)queued=!canOpen();
    return Boolean(opened&&current());
   } catch {if(generation===revision)queued=false;return false;}
   finally {clearTimeout(timer);if(generation===revision){request=null;abort=null;opening=false;notify(queued);}}
  });
  request=work;notify();return work;
 }
 function cancel({handled=false}={}) {
  revision++;abort?.abort();abort=null;request=null;queued=false;opening=false;visible=handled;shown=handled;notify();
 }
 return Object.freeze({
  get pending(){return pending();},refresh,
  drain(){return queued&&!request&&!shown&&canOpen()?refresh():Promise.resolve(false);},
  dismiss(){visible=false;queued=false;notify();},
  handled(){cancel({handled:true});},
  reset(){cancel();},
  foreground(){if(visible)return Promise.resolve(false);cancel();return refresh();},
 });
}

import { provisionDateKey } from './pending-provision-dates.js';

const STORAGE_PREFIX = 'energetico.trancid-alert-day:';

/** A low card balance is shown once per Brasília calendar day, when safe. */
export function createTrancidAutoReminder({
 loadReport, canOpen, open, enabled = () => true, onChange = () => {}, timeoutMs = 20_000,
 accountKey = () => '', today = provisionDateKey,
}) {
 let revision=0,request=null,abort=null,queued=false,opening=false,visible=false,handledInForeground=false;
 const shownDays = new Map();
 let notified=false;
 const pending=()=>Boolean(request)||queued||opening||visible;
 const notify=(force=false)=>{const value=pending();if(force||value!==notified){notified=value;onChange();}};
 const eligible=report=>Array.isArray(report?.cards)&&report.cards.length>0
  &&report.cards.every(card=>Number.isSafeInteger(card.balanceCents))
  &&report.cards.some(card=>card.balanceCents<4000);

 function shownToday(owner) {
  const day = today();
  if (shownDays.get(owner) === day) return true;
  if (!owner) return false;
  try { return globalThis.localStorage?.getItem(STORAGE_PREFIX + owner) === day; }
  catch { return false; }
 }

 function rememberOpening(owner) {
  const day = today();
  shownDays.set(owner, day);
  if (!owner) return;
  try { globalThis.localStorage?.setItem(STORAGE_PREFIX + owner, day); }
  catch { /* The session still enforces the limit when storage is unavailable. */ }
 }

 function refresh() {
  if(!enabled()||handledInForeground||visible)return Promise.resolve(false);
  if(request)return request;
  const owner = accountKey();
  if (shownToday(owner)) {
   queued = false;
   notify();
   return Promise.resolve(false);
  }
  const generation=revision,controller=new AbortController();abort=controller;
  const current=()=>generation===revision&&!controller.signal.aborted&&enabled()&&accountKey()===owner;
  const work=Promise.resolve().then(async()=>{
   let timer;
   try {
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('TRANCID_TIMEOUT'));},timeoutMs);timer.unref?.();});
    const report=await Promise.race([loadReport({signal:controller.signal,refresh:true}),timeout]);
    if(!current())return false;
    queued=eligible(report)&&!shownToday(owner);notify();
    if(!queued||!canOpen())return false;
    queued=false;opening=true;notify();
    const opened=await open({automatic:true,initialSnapshot:report,isCurrent:()=>current()&&!shownToday(owner)&&canOpen()});
    if (opened && current()) {
     rememberOpening(owner);
     visible = true;
    } else if (current() && !shownToday(owner)) queued = !canOpen();
    return Boolean(opened&&current());
   } catch {if(generation===revision)queued=false;return false;}
   finally {clearTimeout(timer);if(generation===revision){request=null;abort=null;opening=false;notify(queued);}}
  });
  request=work;notify();return work;
 }
 function cancel({handled=false}={}) {
  revision++;abort?.abort();abort=null;request=null;queued=false;opening=false;visible=handled;handledInForeground=handled;notify();
 }
 return Object.freeze({
  get pending(){return pending();},refresh,
  drain(){return queued&&!request&&canOpen()?refresh():Promise.resolve(false);},
  dismiss(){visible=false;queued=false;notify();},
  handled(){cancel({handled:true});},
  reset(){cancel();},
  foreground(){
   if (visible) return Promise.resolve(false);
   handledInForeground = false;
   return refresh();
  },
 });
}

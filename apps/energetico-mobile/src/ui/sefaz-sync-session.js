import {createSefazSyncMonitor} from '../chat/sefaz-sync-monitor.js';
import {createSefazSyncReceipt} from './sefaz-sync-receipt.js';

export function createSefazSyncSession({document:doc=globalThis.document,storage,...options}) {
  if(storage===undefined){try{storage=doc?.defaultView?.localStorage??globalThis.localStorage;}catch{/* Recovery remains server-owned. */}}
  let receipt=null,acknowledge=null,disposed=false,suspended=false;
  const visible=()=>!disposed&&!suspended&&Boolean(doc?.body?.isConnected)&&doc.visibilityState!=='hidden';
  const hide=()=>{acknowledge=null;receipt?.close();};
  const monitor=createSefazSyncMonitor({...options,storage,isVisible:visible,hide,present:async(result,ack)=>{
    if(!visible()||options.isCurrent?.()===false)return false;
    // DDA has its own focus trap: let its existing receipt finish first.
    if(doc.querySelector('[data-dda-sync-result]'))return false;
    if(!receipt)receipt=createSefazSyncReceipt({document:doc,onAcknowledge:()=>acknowledge?.()??false});
    acknowledge=ack;return receipt.show(result);
  }});
  const resume=monitor.resume.bind(monitor),suspend=monitor.suspend.bind(monitor);
  monitor.resume=()=>{suspended=false;return resume();};
  monitor.suspend=()=>{suspended=true;suspend();};
  let ddaVisible=Boolean(doc?.querySelector('[data-dda-sync-result]'));
  const observer=doc?.defaultView?.MutationObserver?new doc.defaultView.MutationObserver(()=>{
    const next=Boolean(doc.querySelector('[data-dda-sync-result]'));
    if(next===ddaVisible)return;ddaVisible=next;
    if(next)suspend();else if(visible())void resume();
  }):null;
  if(doc?.body)observer?.observe(doc.body,{childList:true,subtree:true});
  const foreground=()=>{if(doc.visibilityState!=='hidden')void monitor.resume();else monitor.suspend();};
  doc?.addEventListener('visibilitychange',foreground);doc?.defaultView?.addEventListener('focus',foreground);
  const destroy=monitor.destroy.bind(monitor);
  monitor.destroy=()=>{disposed=true;observer?.disconnect();doc?.removeEventListener('visibilitychange',foreground);doc?.defaultView?.removeEventListener('focus',foreground);destroy();receipt?.destroy();};
  return monitor;
}

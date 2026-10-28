import {createDdaSyncMonitor} from '../chat/dda-sync-monitor.js';
import {createDdaSyncReceipt} from './dda-sync-receipt.js';
import {REGISTRATION_GALLERY_MODELS,registrationRawField,registrationDateKey,registrationNumber} from '../chat/registration-gallery-data.js';

/** The global app session owns this presenter; galleries only subscribe to its progress. */
export function createDdaSyncSession({document:doc=globalThis.document,storage,loadRows=async()=>[],detailTimeoutMs=15000,...options}){
 if(storage===undefined){try{storage=doc?.defaultView?.localStorage??globalThis.localStorage;}catch{/* Monitor refuses unpersisted starts; server recovery still works. */}}
 let receipt=null,acknowledge=null,details=null,disposed=false,presentation=0;
 const visible=()=>!disposed&&Boolean(doc?.body?.isConnected)&&doc.visibilityState!=='hidden';
 function hide(){presentation++;details?.abort();details=null;acknowledge=null;receipt?.close();}
 function format(row,name){
  const raw=registrationRawField(row.fields,name,REGISTRATION_GALLERY_MODELS.dda);
  if(name==='VENCIMENTO'){const key=registrationDateKey(raw);return key?key.split('-').reverse().join('/'):'—';}
  if(name==='VALOR'){const value=registrationNumber(raw);return value==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);}
  return typeof raw==='string'||typeof raw==='number'?String(raw):'—';
 }
 const monitor=createDdaSyncMonitor({...options,storage,isVisible:visible,hide,present:async(result,ack)=>{
  if(!visible())return false;
  const version=++presentation;let rows=[];
  if(result.status==='succeeded'&&result.created>0){
   const controller=details=new AbortController();let timer;
   try{rows=await Promise.race([loadRows({signal:controller.signal}),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve([]);},detailTimeoutMs);})]);}
   catch{/* Confirmed IDs remain visible even when the optional gallery read fails. */}
   finally{clearTimeout(timer);if(details===controller)details=null;}
  }
  if(version!==presentation||!visible()||options.isCurrent?.()===false)return false;
  if(!receipt)receipt=createDdaSyncReceipt({document:doc,host:doc.body,format,global:true,requireAcknowledgement:true,
   onAcknowledge:()=>acknowledge?.()??false});
  acknowledge=ack;
  return receipt.show(result,Array.isArray(rows)?rows:[],doc.activeElement);
 }});
 const foreground=()=>{if(visible())void monitor.resume();else monitor.suspend();};
 doc?.addEventListener('visibilitychange',foreground);doc?.defaultView?.addEventListener('focus',foreground);
 const destroy=monitor.destroy.bind(monitor);
 monitor.destroy=()=>{disposed=true;doc?.removeEventListener('visibilitychange',foreground);doc?.defaultView?.removeEventListener('focus',foreground);destroy();receipt?.destroy();};
 return monitor;
}

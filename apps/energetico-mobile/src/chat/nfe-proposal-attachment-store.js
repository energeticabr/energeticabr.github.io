// Files remain scoped to the signed-in account and invoice until confirmed delivery.
export function createNfeProposalAttachmentStore({ indexedDB = globalThis.indexedDB } = {}) {
  const memory = new Map();
  let database;
  const keyOf = (account, invoice) => JSON.stringify([account, invoice]);
  const open = () => database ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('energetico-nfe-proposal-attachments',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'key'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  async function operation(mode, callback) {
    if (!indexedDB) return callback(null);
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts',mode),request=callback(tx.objectStore('drafts'));
      tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async function list() { return await operation('readonly',store=>store?store.getAll():[...memory.values()]); }
  async function load(account,invoice) {
    const key=keyOf(account,invoice);
    const entry=await operation('readonly',store=>store?store.get(key):memory.get(key));
    return (entry?.files || []).map(item=>{
      const file=new File([item.blob],item.name,{type:item.type,lastModified:item.lastModified});
      if(item.sourceId)Object.defineProperty(file,'sourceId',{value:item.sourceId});
      if(item.id)Object.defineProperty(file,'proposalAttachmentId',{value:item.id});
      return file;
    });
  }
  async function save(account,invoice,files) {
    const key=keyOf(account,invoice);
    const entry={key,account,invoice,files:files.map(file=>{
      if(!file.proposalAttachmentId)Object.defineProperty(file,'proposalAttachmentId',{value:globalThis.crypto.randomUUID()});
      return {id:file.proposalAttachmentId,blob:file,name:file.name,type:file.type,lastModified:file.lastModified,sourceId:file.sourceId || null};
    })};
    await operation('readwrite',store=>{
      if(store)return files.length?store.put(entry):store.delete(key);
      if(files.length)memory.set(key,entry);else memory.delete(key);
    });
  }
  return {list,load,save};
}

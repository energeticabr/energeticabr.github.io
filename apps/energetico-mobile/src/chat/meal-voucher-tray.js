const sameSource = (a,b) => a?.id === b?.id && a.fileName === b.fileName && a.size === b.size
  && a.mimeType === b.mimeType && a.source === b.source && a.status === b.status;
export const sameMealVoucherTray = (a,b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item,index)=>sameSource(item,b[index]));

/** Access to the authoritative chat tray; no separate wizard file collection. */
export function createMealVoucherTray({ store, assertSession, pickFiles, capture, open, remove, load, deleteAttachment }) {
  function snapshot() {
    assertSession(); const state = store.getState();
    return [
      ...state.attachments.filter(item=>item.existing !== true && item.readOnly !== true && item.origin !== 'existing')
        .map(item=>({id:`attachment:${item.id}`,fileId:item.id,kind:'attachment',fileName:item.fileName,size:item.size || item.file?.size || 0,
          mimeType:item.mimeType || item.file?.type || '',source:item.file || item.mediaUrl,status:'ready',item})),
      ...state.pendingFiles.filter(item=>!item.hideFromAttachmentTray).map(item=>({id:`pending:${item.id}`,fileId:item.id,kind:'pending',
        fileName:item.file.name,size:item.file.size,mimeType:item.file.type || '',source:item.file,status:item.status,error:item.error,item})),
    ];
  }
  const changed = () => new Error('A bandeja de anexos mudou. Confira os arquivos e avance novamente para a revisão.');
  function verify(selected) {
    if (!sameMealVoucherTray(selected,snapshot())) throw changed();
    if (selected.some(item=>item.status === 'failed')) throw new Error('Há anexo com falha na bandeja. Tente enviá-lo novamente ou remova-o antes de confirmar.');
    if (selected.some(item=>item.status !== 'ready')) throw new Error('Aguarde o envio dos anexos da bandeja antes de confirmar.');
  }
  async function read(selected, expected = []) {
    assertSession(); verify(selected); const files = [];
    for (const reference of selected) {
      const blob = await load(reference.item); assertSession(); verify(selected);
      const normalize = value=>String(value || '').split(';',1)[0].trim().toLowerCase();
      const specific = value=>!['','application/octet-stream','binary/octet-stream'].includes(value);
      const downloaded = normalize(blob.type), declared = normalize(reference.mimeType);
      const old = expected.find(file=>file.name === reference.fileName && file.size === blob.size);
      files.push(new File([blob],reference.fileName,{type:specific(downloaded) ? downloaded : specific(declared) ? declared : '',
        lastModified:old?.lastModified ?? reference.item.file?.lastModified ?? 0}));
    }
    verify(selected); return files;
  }
  async function consume(selected) {
    assertSession(); const failures = [];
    for (const reference of selected) {
      const current = snapshot().find(item=>item.id === reference.id);
      // New or replaced files belong to the next batch, even with the same name.
      if (!current || !sameSource(current,reference)) continue;
      if (reference.kind === 'pending') { store.discardFile(reference.fileId); continue; }
      store.removeAttachment(reference.fileId,{dismissFromSnapshots:true});
      try { await deleteAttachment(reference.fileId); assertSession(); }
      catch (cause) { assertSession(); failures.push(reference.fileName); }
    }
    if (failures.length) throw new Error(`Os lançamentos e arquivos foram gravados. Não foi possível limpar a cópia temporária de: ${failures.join(', ')}. Não repita o lançamento.`);
  }
  async function action(callback) {
    assertSession(); const result = await callback(); assertSession();
    if (result === false) throw new Error(store.getState().error || 'Não foi possível concluir a ação na bandeja. Confira os anexos antes de continuar.');
    return result;
  }
  return Object.freeze({ snapshot, read, consume,
    subscribe:listener=>store.subscribe(()=>{try{assertSession();}catch{return;}listener();}),
    pickFiles:()=>action(pickFiles), capture:()=>action(capture),
    open:id=>{const item=snapshot().find(row=>row.id===id);return item ? action(()=>open(item.fileId)) : false;},
    remove:id=>{const item=snapshot().find(row=>row.id===id);return item ? action(()=>remove(item.fileId,item.kind)) : false;},
  });
}

export function createProposalAttachmentTray({ document:doc, files, attachments, changed, signal, isBusy }) {
  const root = doc.createElement('section');
  root.className = 'nfe-proposal-attachments';
  root.setAttribute('aria-label', 'Anexos do pedido');
  const heading = doc.createElement('h3'); heading.textContent = 'Anexos do pedido';
  const hint = doc.createElement('p'); hint.textContent = 'Os anexos adicionados aqui serão enviados junto com o pedido.';
  const add = doc.createElement('button'); add.type = 'button'; add.textContent = '＋ Adicionar anexos'; add.dataset.addProposalAttachment = '';
  const sources = doc.createElement('div'); sources.className = 'nfe-proposal-attachment-sources'; sources.hidden = true;
  const list = doc.createElement('ul');
  const status = doc.createElement('p'); status.setAttribute('role','status');
  root.append(heading,hint,add,sources,list,status);
  let picking = false;
  add.addEventListener('click',()=>{ sources.hidden = !sources.hidden; });
  function append(incoming) {
    for (const file of incoming || []) {
      if (files.some(item=>item === file || file.sourceId && item.sourceId === file.sourceId)) continue;
      files.push(file);
    }
    render();
    return changed();
  }
  for (const [source,label] of [['camera','Tirar foto'],['photos','Foto da galeria'],['scan','Escanear'],['files','Anexar arquivo']]) {
    const button=doc.createElement('button'); button.type='button'; button.textContent=label; button.dataset.proposalSource=source;
    sources.append(button);
    button.addEventListener('click',async()=>{
      if (picking || isBusy()) return;
      picking=true; sources.hidden=true; changed(); render(); status.textContent='Selecionando anexos…';
      try {
        if (typeof attachments?.pick !== 'function') throw new Error('Esta opção não está disponível neste dispositivo.');
        const selected=await attachments.pick(source,{signal});
        if (!signal.aborted) { append(selected); status.textContent=''; }
      } catch(error) { if (!signal.aborted) status.textContent=error?.message || 'Não foi possível adicionar o anexo.'; }
      finally { picking=false; if (!signal.aborted) { changed(); render(); } }
    });
  }
  function render() {
    add.disabled=picking || isBusy();
    for (const button of sources.children) button.disabled=add.disabled;
    list.replaceChildren(...files.map(file=>{
      const li=doc.createElement('li'); li.dataset.proposalFile='';
      const open=doc.createElement('button'); open.type='button'; open.textContent=file.name;
      open.disabled=typeof attachments?.open !== 'function';
      open.addEventListener('click',async()=>{try {await attachments.open(file);}catch(error){status.textContent=error.message;}});
      const remove=doc.createElement('button'); remove.type='button'; remove.textContent='Remover'; remove.disabled=isBusy();
      remove.setAttribute('aria-label',`Remover ${file.name}`);
      remove.addEventListener('click',()=>{
        if(isBusy())return;
        files.splice(files.indexOf(file),1); render(); changed();
        if(file.sourceId) Promise.resolve(attachments?.discard?.(file.sourceId)).catch(()=>{});
      });
      li.append(open,remove);return li;
    }));
  }
  render();
  return { element:root, append, render, get picking(){return picking;} };
}

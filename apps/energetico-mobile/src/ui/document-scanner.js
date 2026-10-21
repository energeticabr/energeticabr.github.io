import { rectifyDocument, suggestDocumentCorners, validDocumentCorners } from '../web/document-scanner.js';

export function createCameraChooser(documentRef = globalThis.document) {
  let dialog = null, pending = null, finish = null;
  function choose() {
    if (pending) return pending;
    const previous = documentRef.activeElement;
    dialog = documentRef.createElement('dialog');
    dialog.className = 'document-scanner document-scanner--chooser';
    dialog.setAttribute('aria-label','Câmera');
    dialog.innerHTML = `<h2>📷 Câmera</h2><p>Como deseja adicionar a imagem?</p>
      <button type="button" data-camera-mode="photo">📷 Tirar foto</button>
      <button type="button" data-camera-mode="scan">📄 Escanear</button>
      <p class="document-scanner-hint">Escaneie o papel e ajuste as bordas antes de anexar.</p>
      <button type="button" data-camera-mode="cancel" class="document-scanner-secondary">Cancelar</button>`;
    pending = new Promise(resolve => {
      finish = result => {
        const current=dialog;dialog=null;pending=null;finish=null;
        current?.remove(); previous?.isConnected && previous.focus?.(); resolve(result);
      };
      dialog.addEventListener('click',event=>{
        const mode=event.target.closest('[data-camera-mode]')?.dataset.cameraMode;
        if(mode) finish?.(mode==='cancel'?null:mode);
      });
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish?.(null);});
      dialog.addEventListener('close',()=>finish?.(null));
      documentRef.body.append(dialog);dialog.showModal();
      dialog.querySelector('[data-camera-mode="photo"]').focus();
    });
    return pending;
  }
  return {choose,destroy(){finish?.(null);}};
}

export function editDocumentScan(file, {
  documentRef = globalThis.document, urlApi = globalThis.URL, FileCtor = globalThis.File,
} = {}) {
  return new Promise((resolve,reject) => {
    const previous=documentRef.activeElement, dialog=documentRef.createElement('dialog');
    dialog.className='document-scanner document-scanner--editor';
    dialog.setAttribute('aria-label','Escanear documento');
    dialog.innerHTML=`<h2>📄 Escanear documento</h2><p class="document-scanner-hint" data-scan-status role="status">Preparando a imagem…</p>
      <div class="document-scanner-workspace"></div><div class="document-scanner-actions">
      <button type="button" class="document-scanner-secondary" data-scan-action="cancel">Cancelar</button></div>`;
    const status=dialog.querySelector('[data-scan-status]'),workspace=dialog.querySelector('.document-scanner-workspace');
    const actions=dialog.querySelector('.document-scanner-actions');
    let disposed=false,processing=false,source=null,corners=null,initial=null,blob=null,stage=null,handles=[],polygon=null;
    const image=new documentRef.defaultView.Image();
    const href=urlApi.createObjectURL(file);
    function finish(result,error) {
      if(disposed)return;disposed=true;dialog.remove();image.removeAttribute('src');urlApi.revokeObjectURL(href);
      previous?.isConnected&&previous.focus?.();error?reject(error):resolve(result);
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
    dialog.addEventListener('close',()=>finish(null));
    function updateCorners() {
      corners.forEach((p,i)=>{handles[i].style.left=`${p.x*100}%`;handles[i].style.top=`${p.y*100}%`;});
      polygon.setAttribute('points',corners.map(p=>`${p.x*1000},${p.y*1000}`).join(' '));
    }
    function moveCorner(index,x,y) {
      if(processing)return;
      const candidate=corners.map(p=>({...p}));
      candidate[index]={x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
      if(!validDocumentCorners(candidate)){status.textContent='As bordas não podem se cruzar. Ajuste os quatro cantos.';return;}
      corners=candidate;blob=null;updateCorners();
    }
    function edit() {
      blob=null;workspace.replaceChildren();handles=[];
      stage=documentRef.createElement('div');stage.className='document-scanner-stage';
      stage.style.setProperty('--scan-ratio',String(source.width/source.height));
      const canvas=documentRef.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
      canvas.getContext('2d').putImageData(source,0,0);stage.append(canvas);
      const svg=documentRef.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
      polygon=documentRef.createElementNS(svg.namespaceURI,'polygon');svg.append(polygon);stage.append(svg);
      ['superior esquerdo','superior direito','inferior direito','inferior esquerdo'].forEach((label,index)=>{
        const handle=documentRef.createElement('button');handle.type='button';handle.className='document-scanner-corner';
        handle.dataset.scanCorner=String(index);handle.setAttribute('aria-label',`Ajustar canto ${label}`);
        handle.title='Arraste ou use as setas do teclado';
        let pointer=null;
        handle.addEventListener('pointerdown',event=>{
          if(processing||event.button>0)return;event.preventDefault();handle.focus();pointer=event.pointerId;handle.setPointerCapture?.(pointer);
        });
        handle.addEventListener('pointermove',event=>{
          if(pointer!==event.pointerId)return;event.preventDefault();
          const rect=stage.getBoundingClientRect();
          if(rect.width&&rect.height)moveCorner(index,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);
        });
        const end=()=>{pointer=null;};handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
        handle.addEventListener('keydown',event=>{
          const step=event.shiftKey?0.03:0.005,p=corners[index];
          const changes={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
          if(!changes[event.key])return;event.preventDefault();const [dx,dy]=changes[event.key];moveCorner(index,p.x+dx,p.y+dy);
        });
        handles.push(handle);stage.append(handle);
      });
      workspace.append(stage);updateCorners();
      status.textContent=initial.detected?'Bordas sugeridas. Arraste os quatro cantos para ajustar.':'Arraste os quatro cantos até as bordas do papel. Use as setas se estiver no teclado.';
      actions.innerHTML=`<button type="button" class="document-scanner-secondary" data-scan-action="cancel">Cancelar</button>
        <button type="button" class="document-scanner-secondary" data-scan-action="reset">Redefinir bordas</button>
        <button type="button" data-scan-action="preview">Ver recorte</button>`;
      handles[0].focus();
    }
    async function preview() {
      if(processing||!source)return;processing=true;
      status.textContent='Corrigindo a perspectiva…';actions.querySelectorAll('button:not([data-scan-action="cancel"])').forEach(b=>b.disabled=true);
      try {
        await new Promise(r=>documentRef.defaultView.setTimeout(r,0));if(disposed)return;
        const result=rectifyDocument(source,corners),canvas=documentRef.createElement('canvas');
        canvas.width=result.width;canvas.height=result.height;
        const context=canvas.getContext('2d'),pixels=context.createImageData(result.width,result.height);
        pixels.data.set(result.data);context.putImageData(pixels,0,0);
        const encoded=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.9));
        if(disposed)return;if(!encoded)throw new Error('Não foi possível preparar o documento.');
        blob=encoded;workspace.replaceChildren(canvas);canvas.className='document-scanner-preview';
        status.textContent='Confira o recorte. O documento só será anexado ao confirmar.';
        actions.innerHTML=`<button type="button" class="document-scanner-secondary" data-scan-action="cancel">Cancelar</button>
          <button type="button" class="document-scanner-secondary" data-scan-action="back">Ajustar bordas</button>
          <button type="button" data-scan-action="confirm">Usar documento</button>`;
        actions.querySelector('[data-scan-action="confirm"]').focus();
      }catch(error){if(!disposed){edit();status.textContent=error.message||'Não foi possível recortar. Ajuste as bordas e tente novamente.';}}
      finally{processing=false;}
    }
    dialog.addEventListener('click',event=>{
      const action=event.target.closest('[data-scan-action]')?.dataset.scanAction;
      if(action==='cancel'){finish(null);return;}if(processing)return;
      if(action==='reset'){corners=initial.corners.map(p=>({...p}));updateCorners();}
      if(action==='preview')void preview();
      if(action==='back')edit();
      if(action==='confirm'&&blob)finish(new FileCtor([blob],`documento-escaneado-${Date.now()}.jpg`,{type:'image/jpeg'}));
    });
    documentRef.body.append(dialog);dialog.showModal();actions.querySelector('button').focus();
    void (async()=>{
      try{
        image.src=href;await image.decode();if(disposed)return;
        if(image.naturalWidth<2||image.naturalHeight<2)throw new Error('A foto não contém uma imagem válida.');
        const scale=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=documentRef.createElement('canvas');canvas.width=Math.max(2,Math.round(image.naturalWidth*scale));canvas.height=Math.max(2,Math.round(image.naturalHeight*scale));
        const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
        source=context.getImageData(0,0,canvas.width,canvas.height);
        const sample=documentRef.createElement('canvas');sample.width=Math.max(2,Math.round(canvas.width*256/Math.max(canvas.width,canvas.height)));sample.height=Math.max(2,Math.round(canvas.height*256/Math.max(canvas.width,canvas.height)));
        const sampleContext=sample.getContext('2d',{willReadFrequently:true});sampleContext.drawImage(canvas,0,0,sample.width,sample.height);
        initial=suggestDocumentCorners(sampleContext.getImageData(0,0,sample.width,sample.height));corners=initial.corners.map(p=>({...p}));edit();
      }catch(error){if(!disposed)finish(null,new Error('Não foi possível abrir essa foto para escanear. Tente uma imagem JPG ou PNG.',{cause:error}));}
    })();
  });
}

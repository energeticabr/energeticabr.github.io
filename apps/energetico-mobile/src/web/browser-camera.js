export function captureBrowserCamera({ documentRef, mediaDevices, FileCtor, selectImage, signal }) {
  if (signal?.aborted) return Promise.resolve([]);
  const dialog = documentRef.createElement('dialog');
  dialog.className = 'document-scanner dcr-webcam';
  dialog.setAttribute('aria-label', 'Câmera');
  dialog.innerHTML = `
    <h2>Câmera</h2>
    <video autoplay muted playsinline hidden></video>
    <p role="status">Abrindo a câmera…</p>
    <div class="document-scanner-actions">
      <button type="button" data-capture disabled>Tirar foto</button>
      <button type="button" data-select class="document-scanner-secondary">Escolher imagem</button>
      <button type="button" data-close class="document-scanner-secondary">Cancelar</button>
    </div>`;
  const video = dialog.querySelector('video');
  const status = dialog.querySelector('[role="status"]');
  const capture = dialog.querySelector('[data-capture]');
  const select = dialog.querySelector('[data-select]');
  const previous = documentRef.activeElement;
  let stream, finished = false;

  return new Promise((resolve, reject) => {
    const stop = () => stream?.getTracks().forEach(track => track.stop());
    function finish(files, error) {
      if (finished) return;
      finished = true;
      stop();
      video.srcObject = null;
      signal?.removeEventListener('abort', cancel);
      dialog.close();
      dialog.remove();
      if (previous?.isConnected) previous.focus();
      if (error) reject(error);
      else resolve(files);
    }
    function cancel() { finish([]); }
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    dialog.querySelector('[data-close]').addEventListener('click', cancel);
    select.addEventListener('click', async () => {
      select.disabled = true;
      capture.disabled = true;
      try { finish(await selectImage()); }
      catch (error) { finish([], error); }
    });
    capture.addEventListener('click', () => {
      capture.disabled = true;
      select.disabled = true;
      try {
        const frame = documentRef.createElement('canvas');
        frame.width = video.videoWidth;
        frame.height = video.videoHeight;
        frame.getContext('2d').drawImage(video, 0, 0);
        frame.toBlob(blob => {
          if (!blob) return finish([], new Error('Não foi possível capturar a foto.'));
          finish([new FileCtor([blob], `foto-${crypto.randomUUID()}.jpg`, { type: 'image/jpeg' })]);
        }, 'image/jpeg', 0.88);
      } catch (error) { finish([], error); }
    });
    signal?.addEventListener('abort', cancel, { once: true });
    documentRef.body.append(dialog);
    dialog.showModal();
    Promise.resolve().then(() => mediaDevices.getUserMedia({ video: true, audio: false })).then(async result => {
      stream = result;
      if (finished) return stop();
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      if (finished) return;
      status.textContent = '';
      capture.disabled = select.disabled;
    }).catch(() => {
      stop();
      if (finished) return;
      video.hidden = true;
      status.textContent = 'Câmera indisponível. Você pode escolher uma imagem.';
    });
  });
}

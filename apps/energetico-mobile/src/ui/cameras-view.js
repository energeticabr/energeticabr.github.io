import { applyScreenNavigation } from "./screen-navigation.js";

export function createCamerasView(documentRef) {
  let dialog;
  let closeCurrent;

  function open({ list, start }) {
    if (dialog) return true;
    const previousFocus = documentRef.activeElement;
    const page = new AbortController();
    let playback;
    let hls;
    let activeUrl = false;

    dialog = documentRef.createElement("dialog");
    dialog.className = "cameras-view";
    dialog.setAttribute("aria-label", "Câmeras");
    dialog.innerHTML = `
      <header><button type="button" data-camera-back>Voltar</button><h1>CÂMERAS</h1></header>
      <div class="cameras-view__content">
        <label for="camera-channel">Câmera e canal</label>
        <select id="camera-channel" disabled></select>
        <button type="button" data-camera-play disabled>Ver ao vivo</button>
        <p role="status" aria-live="polite"></p>
        <video playsinline controls muted crossorigin="anonymous" hidden></video>
      </div>`;
    const header = dialog.querySelector("header");
    const back = dialog.querySelector("[data-camera-back]");
    const select = dialog.querySelector("select");
    const play = dialog.querySelector("[data-camera-play]");
    const status = dialog.querySelector("[role=status]");
    const video = dialog.querySelector("video");
    applyScreenNavigation({ header, back, title: dialog.querySelector("h1") });

    function stopPlayback() {
      playback?.abort();
      hls?.destroy();
      hls = null;
      if (activeUrl) {
        activeUrl = false;
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      video.hidden = true;
    }

    function close() {
      page.abort();
      stopPlayback();
      documentRef.removeEventListener("visibilitychange", visibilityChanged);
      dialog.remove();
      dialog = null;
      closeCurrent = null;
      previousFocus?.focus?.();
    }

    function visibilityChanged() {
      if (!documentRef.hidden || !playback || playback.signal.aborted) return;
      stopPlayback();
      status.textContent = "Transmissão pausada. Toque em Ver ao vivo para retomar.";
    }
    closeCurrent = close;
    documentRef.addEventListener("visibilitychange", visibilityChanged);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    back.addEventListener("click", close);
    select.addEventListener("change", () => {
      stopPlayback();
      status.textContent = "";
    });

    video.addEventListener("playing", () => { status.textContent = ""; });
    video.addEventListener("error", () => {
      if (activeUrl) status.textContent = "A transmissão foi interrompida. Toque em Ver ao vivo para reconectar.";
    });

    play.addEventListener("click", async () => {
      stopPlayback();
      playback = new AbortController();
      const { signal } = playback;
      const channelId = select.value;
      status.textContent = "Conectando à câmera…";
      try {
        const url = await start(channelId, { signal });
        if (signal.aborted) return;
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          activeUrl = true;
          video.src = url;
        } else {
          const { default: Hls } = await import("hls.js");
          if (signal.aborted) return;
          if (!Hls.isSupported()) throw new Error("Este dispositivo não suporta a reprodução ao vivo.");
          hls = new Hls({ maxBufferLength: 12 });
          hls.on(Hls.Events.ERROR, (_event, details) => {
            if (!details.fatal || signal.aborted) return;
            stopPlayback();
            status.textContent = "A transmissão foi interrompida. Toque em Ver ao vivo para reconectar.";
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          activeUrl = true;
        }
        video.hidden = false;
        void video.play().catch(() => {});
      } catch (error) {
        if (!signal.aborted) status.textContent = error.message || "Não foi possível abrir a câmera.";
      }
    });

    documentRef.body.append(dialog);
    dialog.showModal();
    status.textContent = "Carregando câmeras…";
    Promise.resolve().then(() => list({ signal: page.signal })).then(channels => {
      if (page.signal.aborted) return;
      for (const { id, label } of channels) {
        const option = documentRef.createElement("option");
        option.value = id;
        option.textContent = label;
        select.append(option);
      }
      select.disabled = play.disabled = !channels.length;
      status.textContent = channels.length ? "" : "Nenhuma câmera está disponível para sua conta.";
    }).catch(error => {
      if (!page.signal.aborted) status.textContent = error.message || "Não foi possível carregar as câmeras.";
    });
    return true;
  }
  return { open, close: () => closeCurrent?.() };
}

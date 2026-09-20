const BERNARDO_STAMP_URL = new URL(
  "../assets/assinatura-bernardo-transparente.png",
  import.meta.url,
).href;

export async function loadBernardoStamp({
  fetchImpl = globalThis.fetch,
  url = BERNARDO_STAMP_URL,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Não foi possível carregar a assinatura de Bernardo.");
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error("Não foi possível carregar a assinatura de Bernardo.");
  const blob = await response.blob();
  if (!blob || typeof blob.arrayBuffer !== "function") {
    throw new Error("A assinatura de Bernardo não foi carregada corretamente.");
  }
  return blob;
}

export { BERNARDO_STAMP_URL };

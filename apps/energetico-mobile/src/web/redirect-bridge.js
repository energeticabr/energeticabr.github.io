function containsMicrosoftState(value) {
  const parameters = new URLSearchParams(String(value || "").replace(/^[?#]/, ""));
  return parameters.has("state");
}

export async function bridgeMicrosoftAuthResponse({
  locationRef = globalThis.location,
  broadcastResponse,
} = {}) {
  const hasResponse = containsMicrosoftState(locationRef?.search)
    || containsMicrosoftState(locationRef?.hash);
  if (!hasResponse) return false;
  if (typeof broadcastResponse !== "function") {
    throw new TypeError("A ponte Microsoft não está disponível.");
  }
  await broadcastResponse();
  return true;
}

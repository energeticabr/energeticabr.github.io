export async function loadMicrosoftProfilePhoto(authClient, environment = {}) {
  const fetchRequest = environment.fetch || globalThis.fetch;
  const createObjectURL = environment.createObjectURL || globalThis.URL?.createObjectURL?.bind(globalThis.URL);
  const revokeObjectURL = environment.revokeObjectURL || globalThis.URL?.revokeObjectURL?.bind(globalThis.URL);
  if (!authClient?.getToken || typeof fetchRequest !== "function" || typeof createObjectURL !== "function") return undefined;
  try {
    const token = await authClient.getToken(["User.Read"]);
    if (!token) return undefined;
    const response = await fetchRequest("https://graph.microsoft.com/v1.0/me/photo/$value", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return undefined;
    const url = createObjectURL(await response.blob());
    return Object.freeze({ url, revoke: () => revokeObjectURL?.(url) });
  } catch {
    return undefined;
  }
}


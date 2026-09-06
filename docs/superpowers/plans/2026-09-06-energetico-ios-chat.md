# Energético iOS Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir um aplicativo iOS independente que contenha somente o chatbot Energético, use a VM existente e aceite texto, câmera, documentos e itens recebidos pela Share Extension.

**Architecture:** Um pacote Vite/JavaScript local será executado pelo Capacitor 8, com estado transacional separado da renderização. Pequenas pontes Swift fornecerão MSAL, seletor de documentos e caixa de entrada compartilhada; a Share Extension usará App Group e Keychain compartilhados. A VM continuará sendo a autoridade das gravações e só respostas estritamente confirmadas alterarão o histórico ou removerão anexos pendentes.

**Tech Stack:** JavaScript ES modules, Node 24 test runner, Vite 8.2.2, Capacitor 8.5.1, Capacitor Camera 8.2.4, Capacitor Filesystem 8.1.3, Swift, MSAL 2.15.0, XCTest, Python unittest e GitHub Actions `macos-26`/Xcode 26.

**Spec:** `docs/superpowers/specs/2026-09-05-energetico-ios-chat-design.md`

## Global Constraints

- O aplicativo chama-se `Energético`, usa o bundle ID `br.com.energetica.energetico` e o App Group `group.br.com.energetica.energetico`.
- O alvo mínimo é iOS 16, combinando os requisitos suportados do Capacitor 8 e do MSAL 2.15.0.
- A interface é local e contém somente login e chatbot; não carrega o portal administrativo como interface principal.
- Mensagens e anexos só são confirmados depois de resposta válida da VM; falhas preservam o rascunho ou arquivo.
- O limite de upload é `60_000_000` bytes e executáveis permanecem bloqueados no cliente e no servidor.
- Tokens ficam no cache MSAL/Keychain e nunca em `localStorage`, logs ou repositório.
- Nenhuma compra, assinatura, matrícula paga ou outro gasto pode ser iniciado.
- Cadastros gratuitos podem usar o e-mail autorizado; segredos de distribuição ficam somente nos cofres próprios da Apple/GitHub.
- O pipeline compila e testa, mas a distribuição TestFlight exige acionamento manual e uma associação Apple Developer já ativa.

## File Map

`apps/energetico-mobile/package.json` fixa scripts e dependências do aplicativo.  
`apps/energetico-mobile/capacitor.config.json` define identidade, diretório web e origem local.  
`apps/energetico-mobile/src/config.js` contém somente tenant, client ID, escopos e URL HTTPS públicos.  
`apps/energetico-mobile/src/chat/file-policy.js` valida arquivos sem efeitos colaterais.  
`apps/energetico-mobile/src/chat/chat-client.js` implementa os três contratos HTTP da VM.  
`apps/energetico-mobile/src/chat/conversation-store.js` mantém rascunhos, fila e confirmações.  
`apps/energetico-mobile/src/auth/auth-service.js` expõe uma interface JavaScript para MSAL nativo.  
`apps/energetico-mobile/src/native/native-ports.js` adapta câmera, documentos, caixa compartilhada e exportação.  
`apps/energetico-mobile/src/ui/chat-view.js` renderiza a tela e traduz eventos DOM em comandos.  
`apps/energetico-mobile/src/app-controller.js` coordena autenticação, store, UI e cliente da VM.  
`apps/energetico-mobile/ios/App/App/*.swift` contém plugins Capacitor pequenos e focados.  
`apps/energetico-mobile/ios/ShareExtension/*` contém a extensão e o armazenamento App Group.  
`whatsapp-sharepoint-oci/channel_bridge.py` mantém a allowlist exata de origens da API.  
`.github/workflows/energetico-ios.yml` executa testes web e compilação do simulador, sem publicar automaticamente.

---

### Task 1: Project foundation and deterministic web build

**Files:**
- Create: `apps/energetico-mobile/package.json`
- Create: `apps/energetico-mobile/pnpm-workspace.yaml`
- Create: `apps/energetico-mobile/vite.config.js`
- Create: `apps/energetico-mobile/capacitor.config.json`
- Create: `apps/energetico-mobile/index.html`
- Create: `apps/energetico-mobile/src/config.js`
- Create: `apps/energetico-mobile/src/main.js`
- Create: `apps/energetico-mobile/tests/project-structure.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nenhuma interface de tarefa anterior.
- Produces: `APP_CONFIG`, uma configuração congelada com `apiBaseUrl`, `tenantId`, `clientId`, `scopes`, `bundleId` e `appGroup`; scripts `test`, `build`, `cap:sync` e `ios:verify`.

- [ ] **Step 1: Write the failing structure test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("declara um aplicativo local e não uma URL remota", async () => {
  const config = JSON.parse(await readFile(new URL("../capacitor.config.json", import.meta.url)));
  assert.equal(config.appId, "br.com.energetica.energetico");
  assert.equal(config.appName, "Energético");
  assert.equal(config.webDir, "dist");
  assert.equal(config.server?.url, undefined);
  assert.equal(config.server?.iosScheme, "capacitor");
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run: `node --test apps/energetico-mobile/tests/project-structure.test.mjs`  
Expected: FAIL with `ENOENT` for `capacitor.config.json`.

- [ ] **Step 3: Create the minimal project files**

Use exact runtime versions:

```json
{
  "name": "energetico-mobile",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "build": "vite build",
    "cap:sync": "cap sync ios",
    "ios:verify": "node scripts/verify-ios-project.mjs"
  },
  "dependencies": {
    "@capacitor/app": "8.1.1",
    "@capacitor/camera": "8.2.4",
    "@capacitor/core": "8.5.1",
    "@capacitor/filesystem": "8.1.3",
    "@capacitor/splash-screen": "8.0.2",
    "@capacitor/status-bar": "8.0.3"
  },
  "devDependencies": {
    "@capacitor/cli": "8.5.1",
    "@capacitor/ios": "8.5.1",
    "vite": "8.2.2"
  }
}
```

Set `server.iosScheme` to `capacitor`, `server.hostname` to `localhost`, and do not set `server.url`. Export `APP_CONFIG` with the existing tenant `0c10f511-7ede-4702-a2d9-bedb26937e0e`, client ID `94018e25-f756-4aa6-974e-27b8b43d7fe9`, scopes `openid`, `profile`, `email`, `User.Read`, and API base `https://163-176-171-217.sslip.io`.

- [ ] **Step 4: Install, test and build**

Run: `pnpm --dir apps/energetico-mobile install --frozen-lockfile=false`  
Run: `pnpm --dir apps/energetico-mobile test`  
Run: `pnpm --dir apps/energetico-mobile build`  
Expected: structure test PASS and Vite creates `dist/index.html` without external portal navigation.

- [ ] **Step 5: Commit the foundation**

```powershell
git add .gitignore apps/energetico-mobile
git commit -m "Cria base do aplicativo Energético"
```

### Task 2: Transaction-safe VM client and attachment policy

**Files:**
- Create: `apps/energetico-mobile/src/chat/file-policy.js`
- Create: `apps/energetico-mobile/src/chat/chat-client.js`
- Create: `apps/energetico-mobile/tests/file-policy.test.mjs`
- Create: `apps/energetico-mobile/tests/chat-client.test.mjs`

**Interfaces:**
- Consumes: `APP_CONFIG.apiBaseUrl` from Task 1 and `tokenProvider(scopes): Promise<string | undefined>` supplied by Task 6.
- Produces: `validateAttachment(file, options): string`; `createChatClient(options): { sendText, sendFile, fetchMedia }`.

- [ ] **Step 1: Write failing file-policy tests**

```js
test("bloqueia executáveis e arquivos acima de 60 MB", () => {
  assert.throws(() => validateAttachment({ name: "ata.exe", size: 10, type: "application/octet-stream" }), /não permitido/);
  assert.throws(() => validateAttachment({ name: "foto.jpg", size: 60_000_001, type: "image/jpeg" }), /60 MB/);
  assert.equal(validateAttachment({ name: "foto.jpg", size: 128, type: "image/jpeg" }), "foto.jpg");
});
```

- [ ] **Step 2: Run the policy test and verify failure**

Run: `node --test apps/energetico-mobile/tests/file-policy.test.mjs`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement file validation**

Export `MAX_UPLOAD_BYTES = 60_000_000`, frozen blocked extension and MIME lists matching the existing portal, and `validateAttachment`. Reject missing/zero size, oversize, blocked extension, blocked MIME, CR/LF in names, and names longer than 180 characters.

- [ ] **Step 4: Write failing VM-client contract tests**

Cover these exact cases with injected `fetchImpl` and `tokenProvider`:

```js
await assert.rejects(client.sendFile(file), /confirmação válida/);
assert.equal(request.headers.Authorization, "Bearer graph-token");
assert.equal(request.headers["X-Portal-File-Name"], encodeURIComponent("Foto 1.jpg"));
assert.equal(request.body, file);
```

Also assert that non-2xx JSON errors surface the server `error`, media URLs outside the configured origin are rejected, and a successful upload requires `status === "processed"` plus `Array.isArray(messages)`.

- [ ] **Step 5: Run client tests and verify failure**

Run: `node --test apps/energetico-mobile/tests/chat-client.test.mjs`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 6: Implement the VM client**

Define:

```js
createChatClient({ apiBaseUrl, tokenProvider, fetchImpl = globalThis.fetch, randomUUID })
sendText({ text = "", replyId }): Promise<PortalResult>
sendFile(file): Promise<PortalResult>
fetchMedia(message): Promise<Blob>
```

Use `/api/portal-chat`, `/api/portal-upload`, and `/api/portal-media/<opaque-id>`. Each request acquires `User.Read`, uses `cache: "no-store"`, and omits cookies. Treat truncated or malformed success responses as failure for both text and file requests.

- [ ] **Step 7: Run focused tests**

Run: `node --test apps/energetico-mobile/tests/file-policy.test.mjs apps/energetico-mobile/tests/chat-client.test.mjs`  
Expected: all tests PASS.

- [ ] **Step 8: Commit the client**

```powershell
git add apps/energetico-mobile/src/chat apps/energetico-mobile/tests
git commit -m "Adiciona cliente seguro da VM ao aplicativo"
```

### Task 3: Conversation store with confirmed-only mutations

**Files:**
- Create: `apps/energetico-mobile/src/chat/conversation-store.js`
- Create: `apps/energetico-mobile/tests/conversation-store.test.mjs`

**Interfaces:**
- Consumes: structured `PortalResult.messages` from Task 2.
- Produces: `createConversationStore(): ConversationStore`, where the store exposes `getState`, `subscribe`, `setDraft`, `beginText`, `confirmText`, `failText`, `queueFiles`, `beginFile`, `confirmFile`, `failFile`, `ingestRemoteMessages`, `replaceImportedFiles` and `discardFile`.

- [ ] **Step 1: Write the failed-submit regression tests**

```js
test("falha de mensagem preserva o rascunho e não cria mensagem confirmada", () => {
  const store = createConversationStore();
  store.setDraft("Criar diário");
  const operation = store.beginText();
  store.failText(operation, new Error("offline"));
  assert.equal(store.getState().draft, "Criar diário");
  assert.equal(store.getState().messages.length, 0);
  assert.equal(store.getState().error, "offline");
});

test("falha de upload mantém somente o arquivo não confirmado", () => {
  const first = { name: "a.jpg", size: 2, type: "image/jpeg" };
  const second = { name: "b.pdf", size: 3, type: "application/pdf" };
  const store = createConversationStore();
  store.queueFiles([first, second]);
  store.confirmFile(store.beginFile(first), { messages: [] });
  store.failFile(store.beginFile(second), new Error("timeout"));
  assert.deepEqual(store.getState().pendingFiles.map(item => item.file.name), ["b.pdf"]);
});
```

- [ ] **Step 2: Run and verify the red state**

Run: `node --test apps/energetico-mobile/tests/conversation-store.test.mjs`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement an immutable store**

Each operation receives a unique local ID. `confirmText` appends the user message and clears the draft only if the operation ID is still active. `confirmFile` removes only its matching queue item. Failure methods keep the draft/file and attach a retryable error. Subscribers receive a frozen snapshot after every transition.

- [ ] **Step 4: Add ordering and stale-response tests**

Assert that an older response cannot clear a newer draft, imported files are deduplicated by stable inbox ID, `resetConversation` clears confirmed transcript but not pending files, and remote `poll`, `text`, `image`, and `document` messages retain their structured fields.

- [ ] **Step 5: Run the store tests**

Run: `node --test apps/energetico-mobile/tests/conversation-store.test.mjs`  
Expected: all tests PASS.

- [ ] **Step 6: Commit the state layer**

```powershell
git add apps/energetico-mobile/src/chat/conversation-store.js apps/energetico-mobile/tests/conversation-store.test.mjs
git commit -m "Preserva rascunhos e anexos após falhas"
```

### Task 4: Dedicated chat view and accessible interaction model

**Files:**
- Create: `apps/energetico-mobile/src/ui/escape-html.js`
- Create: `apps/energetico-mobile/src/ui/chat-view.js`
- Create: `apps/energetico-mobile/src/styles.css`
- Create: `apps/energetico-mobile/tests/chat-view.test.mjs`
- Modify: `apps/energetico-mobile/index.html`

**Interfaces:**
- Consumes: frozen `ConversationState` snapshots from Task 3.
- Produces: `createChatView(root): { render, on, focusComposer, destroy }`; semantic commands `signIn`, `signOut`, `sendText`, `selectReply`, `capturePhoto`, `pickFiles`, `retryFile`, `removeFile`, `openMedia`, `retrySession`.

- [ ] **Step 1: Write failing rendering tests**

Use a pure `renderChatMarkup(state)` export and assert:

```js
assert.match(markup, /data-action="capture-photo"/);
assert.match(markup, /data-action="pick-files"/);
assert.match(markup, /role="log"/);
assert.doesNotMatch(renderChatMarkup({ ...state, draft: "<img onerror=alert(1)>" }), /<img onerror/);
```

Also verify large labels, individual pending-file retry/remove actions, `aria-live`, login state, busy state, and the mascot alt text.

- [ ] **Step 2: Run and verify the red state**

Run: `node --test apps/energetico-mobile/tests/chat-view.test.mjs`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement the pure renderer and delegated events**

Build one screen with header, transcript, choice cards, pending-file list, error banner and fixed composer. Never inject unescaped remote or user strings. Event delegation emits the exact semantic commands above without importing the API client.

- [ ] **Step 4: Implement the mobile visual system**

Use safe-area variables, minimum 44px touch targets, responsive keyboard-safe layout, `prefers-color-scheme`, `prefers-reduced-motion`, and the existing Energética blue/teal palette. The app must not contain portal navigation or an install button.

- [ ] **Step 5: Run view tests and web build**

Run: `node --test apps/energetico-mobile/tests/chat-view.test.mjs`  
Run: `pnpm --dir apps/energetico-mobile build`  
Expected: tests PASS and the generated bundle contains `Falar com o Energético` but not `Painel inicial` or `Instalar aplicativo`.

- [ ] **Step 6: Commit the view**

```powershell
git add apps/energetico-mobile/index.html apps/energetico-mobile/src/ui apps/energetico-mobile/src/styles.css apps/energetico-mobile/tests/chat-view.test.mjs
git commit -m "Cria interface dedicada do chatbot"
```

### Task 5: Native device ports for camera, documents and media export

**Files:**
- Create: `apps/energetico-mobile/src/native/native-ports.js`
- Create: `apps/energetico-mobile/src/native/plugins.js`
- Create: `apps/energetico-mobile/tests/native-ports.test.mjs`
- Create: `apps/energetico-mobile/ios/App/App/DocumentPickerPlugin.swift`
- Create: `apps/energetico-mobile/ios/App/App/DocumentPickerDelegate.swift`

**Interfaces:**
- Consumes: Capacitor `Camera`, `Filesystem`, `ShareInbox`, `DocumentPicker` and injected web fallbacks.
- Produces: `createNativePorts(dependencies): { capturePhoto, pickDocuments, importSharedItems, discardSharedItem, exportMedia }`, with every selected native item normalized to `{ id, name, size, type, getBlob }`.

- [ ] **Step 1: Write failing adapter tests**

```js
const ports = createNativePorts({
  camera: { getPhoto: async () => ({ webPath: "blob:photo", format: "jpeg" }) },
  fetchImpl: async () => new Response(new Blob(["x"], { type: "image/jpeg" })),
  randomUUID: () => "photo-id"
});
const [photo] = await ports.capturePhoto();
assert.deepEqual({ id: photo.id, name: photo.name, size: photo.size, type: photo.type }, {
  id: "photo-id", name: "foto-photo-id.jpeg", size: 1, type: "image/jpeg"
});
```

Cover user cancellation as an empty selection, permission denial as a typed `NativePermissionError`, and shared-item deletion only when `discardSharedItem(id)` is explicitly called.

- [ ] **Step 2: Run and verify failure**

Run: `node --test apps/energetico-mobile/tests/native-ports.test.mjs`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement dependency-injected JavaScript ports**

Register custom plugins with:

```js
export const MicrosoftAuth = registerPlugin("MicrosoftAuth");
export const DocumentPicker = registerPlugin("DocumentPicker");
export const ShareInbox = registerPlugin("ShareInbox");
```

Keep Blob conversion and metadata normalization in JavaScript. Call `validateAttachment` before returning items to the controller.

- [ ] **Step 4: Implement the iOS document picker plugin**

Use `UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)`, allow multiple selection, copy security-scoped URLs into the app cache, and return only `id`, `name`, `size`, `type`, and local URI. Cancellation resolves with `{ items: [] }`; errors reject with stable codes.

- [ ] **Step 5: Run adapter tests**

Run: `node --test apps/energetico-mobile/tests/native-ports.test.mjs`  
Expected: all tests PASS.

- [ ] **Step 6: Commit native adapters**

```powershell
git add apps/energetico-mobile/src/native apps/energetico-mobile/ios/App/App/DocumentPicker*.swift apps/energetico-mobile/tests/native-ports.test.mjs
git commit -m "Integra câmera e documentos do iPhone"
```

### Task 6: Microsoft native authentication bridge

**Files:**
- Create: `apps/energetico-mobile/src/auth/auth-service.js`
- Create: `apps/energetico-mobile/tests/auth-service.test.mjs`
- Create: `apps/energetico-mobile/ios/App/App/MicrosoftAuthPlugin.swift`
- Modify: `apps/energetico-mobile/ios/App/App/AppDelegate.swift`
- Modify: `apps/energetico-mobile/ios/App/App/Info.plist`
- Create: `apps/energetico-mobile/ios/App/App/App.entitlements`
- Modify: `apps/energetico-mobile/ios/App/Podfile`

**Interfaces:**
- Consumes: Capacitor plugin `MicrosoftAuth` and `APP_CONFIG`.
- Produces: `createAuthService(plugin, config): { initialize, signIn, getToken, signOut }`; plugin methods resolve account as `{ homeAccountId, username, name }` and token as `{ accessToken, expiresOn }`.

- [ ] **Step 1: Write failing JavaScript auth tests**

Assert initialization without an account returns `null`, `getToken(["User.Read"])` delegates silently, interactive-required errors are exposed as `AuthInteractionRequiredError`, and raw tokens never enter thrown messages or serialized state.

- [ ] **Step 2: Run and verify failure**

Run: `node --test apps/energetico-mobile/tests/auth-service.test.mjs`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement the JavaScript auth service**

Normalize native errors to `AUTH_REQUIRED`, `AUTH_CANCELLED`, `AUTH_NETWORK`, or `AUTH_FAILED`. Keep the access token only in the return value consumed immediately by the API client.

- [ ] **Step 4: Implement `MicrosoftAuthPlugin.swift` with official MSAL**

Configure `MSALPublicClientApplication` with client ID `94018e25-f756-4aa6-974e-27b8b43d7fe9`, authority tenant `0c10f511-7ede-4702-a2d9-bedb26937e0e`, redirect `msauth.br.com.energetica.energetico://auth`, and keychain group `com.microsoft.adalcache`. `initialize` enumerates cached accounts; `signIn` uses `MSALInteractiveTokenParameters`; `getToken` uses `MSALSilentTokenParameters`; `signOut` removes the selected account.

- [ ] **Step 5: Configure iOS URL and Keychain capabilities**

Add `msauth.br.com.energetica.energetico` under `CFBundleURLSchemes`, `com.microsoft.adalcache` under `keychain-access-groups`, and `group.br.com.energetica.energetico` under `com.apple.security.application-groups`. Route opened auth URLs from `AppDelegate` to MSAL before Capacitor fallback. Pin the official `MSAL` pod to `2.15.0` and commit `Podfile.lock` from the macOS build.

- [ ] **Step 6: Run JavaScript tests and native static checks**

Run: `node --test apps/energetico-mobile/tests/auth-service.test.mjs`  
Run: `node apps/energetico-mobile/scripts/verify-ios-project.mjs`  
Expected: tests PASS; the verifier confirms bundle ID, redirect scheme, App Group, keychain group and MSAL dependency.

- [ ] **Step 7: Commit authentication**

```powershell
git add apps/energetico-mobile/src/auth apps/energetico-mobile/ios/App apps/energetico-mobile/tests/auth-service.test.mjs apps/energetico-mobile/scripts
git commit -m "Adiciona login Microsoft nativo"
```

### Task 7: App controller and end-to-end local behavior

**Files:**
- Create: `apps/energetico-mobile/src/app-controller.js`
- Create: `apps/energetico-mobile/tests/app-controller.test.mjs`
- Modify: `apps/energetico-mobile/src/main.js`

**Interfaces:**
- Consumes: `ConversationStore`, `ChatClient`, `AuthService`, `NativePorts` and `ChatView` from Tasks 2–6.
- Produces: `createAppController(dependencies): { start, stop }` and the complete in-app flow.

- [ ] **Step 1: Write failing orchestration tests**

Cover startup with and without cached account, initial `CONTINUAR` request, text success, text failure, camera cancellation, multi-file sequential upload, partial failure, remote poll selection, media download, logout, and imported shared items.

The regression assertion for failure is exact:

```js
await controller.sendText("Criar registro");
assert.equal(store.getState().draft, "Criar registro");
assert.equal(store.getState().messages.some(message => message.text === "Criar registro"), false);
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test apps/energetico-mobile/tests/app-controller.test.mjs`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement the controller**

Subscribe view rendering to the store. Bind each semantic view command once. On start, initialize auth, import shared inbox items, then send `CONTINUAR` only with an authenticated account. Process file uploads sequentially so each confirmed item is removed independently. Persist no access token.

- [ ] **Step 4: Wire `main.js`**

Create real service instances from `APP_CONFIG`, mount to `#app`, register cleanup on Capacitor app state termination, and display a recoverable initialization error instead of an empty screen.

- [ ] **Step 5: Run all web tests and build**

Run: `pnpm --dir apps/energetico-mobile test`  
Run: `pnpm --dir apps/energetico-mobile build`  
Expected: all tests PASS and Vite build exits 0.

- [ ] **Step 6: Commit integrated behavior**

```powershell
git add apps/energetico-mobile/src apps/energetico-mobile/tests apps/energetico-mobile/index.html
git commit -m "Conecta o chatbot ao aplicativo iOS"
```

### Task 8: iOS Share Extension and durable shared inbox

**Files:**
- Create: `apps/energetico-mobile/ios/ShareExtension/ShareViewController.swift`
- Create: `apps/energetico-mobile/ios/ShareExtension/SharedInboxStore.swift`
- Create: `apps/energetico-mobile/ios/ShareExtension/Info.plist`
- Create: `apps/energetico-mobile/ios/ShareExtension/ShareExtension.entitlements`
- Create: `apps/energetico-mobile/ios/App/App/ShareInboxPlugin.swift`
- Create: `apps/energetico-mobile/ios/App/AppTests/SharedInboxStoreTests.swift`
- Create: `apps/energetico-mobile/scripts/configure-share-extension.mjs`
- Modify: `apps/energetico-mobile/ios/App/App.xcodeproj/project.pbxproj`

**Interfaces:**
- Consumes: App Group `group.br.com.energetica.energetico`, shared MSAL keychain group, VM upload contract and `NativePorts.importSharedItems`.
- Produces: a Share Extension named `Energético`; `ShareInbox.list(): { items }`, `ShareInbox.read({ id }): { base64, metadata }`, and `ShareInbox.remove({ id })`.

- [ ] **Step 1: Write failing Swift storage tests**

Create a temporary container URL and assert that `stage(url:)` writes an atomic manifest entry, `list()` survives a new store instance, `remove(id:)` deletes only its file, duplicate content does not overwrite another item, and failed removal leaves the manifest recoverable.

- [ ] **Step 2: Add the Share Extension target deterministically**

The configuration script must be idempotent: running it twice leaves one target with bundle ID `br.com.energetica.energetico.share`, deployment target `16.0`, App Group and Keychain entitlements, and the extension embedded in the App target. Add a Node structural test that counts one target and one embed build phase.

- [ ] **Step 3: Implement the shared inbox store**

Copy accepted inputs into `<AppGroup>/SharedInbox/<uuid>/payload`, then atomically write `metadata.json` with `id`, `name`, `size`, `type`, `createdAt`, and `state`. Use `NSFileCoordinator` for cross-process access.

- [ ] **Step 4: Implement the extension UI and send flow**

Accept public image, PDF and generic file UTTypes. Show mascot, file name, size, `Adicionar ao Energético` and `Cancelar`. On confirmation, acquire the token silently through the shared MSAL cache. If available, upload and store the VM response as `confirmed-response.json`; otherwise mark the item `needsAuthentication`. Never request interactive login inside the extension and never use a responder-chain hack to open the containing app.

- [ ] **Step 5: Implement `ShareInboxPlugin.swift`**

Return metadata without exposing arbitrary paths. `read` returns only the selected inbox item. `remove` requires an exact opaque ID and is called by JavaScript only after VM confirmation or explicit discard.

- [ ] **Step 6: Run structural and Swift tests on macOS**

Run: `node apps/energetico-mobile/scripts/configure-share-extension.mjs` twice  
Run: `node apps/energetico-mobile/scripts/verify-ios-project.mjs`  
Run: `xcodebuild test -workspace apps/energetico-mobile/ios/App/App.xcworkspace -scheme App -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO`  
Expected: idempotence check PASS and all XCTest cases PASS.

- [ ] **Step 7: Commit the extension**

```powershell
git add apps/energetico-mobile/ios apps/energetico-mobile/scripts apps/energetico-mobile/tests
git commit -m "Recebe arquivos pelo compartilhamento do iPhone"
```

### Task 9: Authorize the native app channel in the VM

**Files:**
- Modify: `whatsapp-sharepoint-oci/channel_bridge.py`
- Modify: `whatsapp-sharepoint-oci/tests/test_channel_bridge.py`
- Modify: `whatsapp-sharepoint-oci/deploy/vm/deploy-approved-portal-chat.sh`
- Modify: `whatsapp-sharepoint-oci/README.md`

**Interfaces:**
- Consumes: exact native origin `capacitor://localhost`; existing bearer token validation through Microsoft Graph.
- Produces: CORS responses for the web origins and the one native origin, with no wildcard and no unauthenticated access.

- [ ] **Step 1: Write failing backend tests**

Add tests asserting:

```python
self.assertTrue(portal_origin_allowed("capacitor://localhost", allowed))
self.assertFalse(portal_origin_allowed("capacitor://evil", allowed))
self.assertFalse(portal_origin_allowed("null", allowed))
```

Start the local handler with the three exact origins and verify native OPTIONS returns 204 with `Access-Control-Allow-Origin: capacitor://localhost`; missing bearer token still returns 401; any other custom scheme returns 403.

- [ ] **Step 2: Run and verify the red state**

Run: `python -m unittest tests.test_channel_bridge -v` in `whatsapp-sharepoint-oci`  
Expected: the native-origin test FAILS because the default/deploy allowlist omits it.

- [ ] **Step 3: Add the exact native origin**

Change the default `PORTAL_CHAT_ALLOWED_ORIGINS` to `https://www.energeticabr.com,https://energeticabr.com,capacitor://localhost`. Update the deployment script to install that exact value and verify all three allowed origins plus one rejected origin. Do not accept `*`, `null`, origin suffixes, regexes or arbitrary Capacitor hosts.

- [ ] **Step 4: Run directed and full backend tests**

Run: `python -m unittest tests.test_channel_bridge -v`  
Run: `python -m unittest discover -s tests -v`  
Expected: all tests PASS.

- [ ] **Step 5: Deploy transactionally to the VM**

Use the existing backup-first deployment mechanism. Run the directed test suite on Linux before service restart, validate the Caddy configuration, restart only after tests pass, then verify:

```text
OPTIONS native allowed = 204 with exact origin
OPTIONS unknown origin = 403
POST without bearer = 401
GET /health = 200 {"status":"ok","channel":"generic"}
```

- [ ] **Step 6: Record the backend deployment evidence**

Save the backup path, test count, service status and four HTTP results in the deployment log. Since this directory is not currently a Git repository, do not report a backend commit that does not exist.

### Task 10: Mascot assets, privacy declarations and iOS package verification

**Files:**
- Create: `apps/energetico-mobile/src/assets/mascote.png`
- Create: `apps/energetico-mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/*`
- Create: `apps/energetico-mobile/ios/App/App/Assets.xcassets/Splash.imageset/*`
- Modify: `apps/energetico-mobile/ios/App/App/Info.plist`
- Create: `apps/energetico-mobile/ios/App/App/PrivacyInfo.xcprivacy`
- Create: `apps/energetico-mobile/scripts/generate-ios-assets.mjs`
- Create: `apps/energetico-mobile/scripts/verify-ios-project.mjs`
- Create: `apps/energetico-mobile/tests/ios-package.test.mjs`

**Interfaces:**
- Consumes: approved mascot source `assets/mascote-energetica-transparente.png`.
- Produces: complete AppIcon/Splash catalogs and a structural verifier usable on Windows and CI.

- [ ] **Step 1: Write failing package tests**

Assert icon catalog contains all required 1x/2x/3x and 1024px marketing entries, every PNG has the expected signature and nonzero dimensions, `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` are user-facing Portuguese strings, and `PrivacyInfo.xcprivacy` declares accessed file timestamp APIs used by Filesystem.

- [ ] **Step 2: Run and verify failure**

Run: `node --test apps/energetico-mobile/tests/ios-package.test.mjs`  
Expected: FAIL because generated assets and privacy manifest do not exist.

- [ ] **Step 3: Generate deterministic mascot assets**

Use the existing mascot as the only source, place it on an Energética-blue opaque square for the icon, preserve a transparent in-chat version, and generate exact pixel sizes required by the asset catalog. The script must overwrite only files inside the two named asset sets.

- [ ] **Step 4: Add permission and privacy declarations**

Use these descriptions:

```text
NSCameraUsageDescription = O Energético usa a câmera para anexar fotos à conversa.
NSPhotoLibraryUsageDescription = O Energético acessa as fotos que você escolher para anexar à conversa.
```

Declare only APIs actually used. Do not request contacts, microphone, location or tracking permissions.

- [ ] **Step 5: Run asset, package and web checks**

Run: `node apps/energetico-mobile/scripts/generate-ios-assets.mjs`  
Run: `node --test apps/energetico-mobile/tests/ios-package.test.mjs`  
Run: `node apps/energetico-mobile/scripts/verify-ios-project.mjs`  
Run: `pnpm --dir apps/energetico-mobile build`  
Expected: all checks PASS.

- [ ] **Step 6: Commit packaging**

```powershell
git add apps/energetico-mobile
git commit -m "Finaliza identidade e privacidade do app iOS"
```

### Task 11: CI, unsigned simulator build and manually gated TestFlight path

**Files:**
- Create: `.github/workflows/energetico-ios.yml`
- Create: `apps/energetico-mobile/scripts/verify-no-secrets.mjs`
- Create: `apps/energetico-mobile/DISTRIBUTION.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all app code, iOS project, tests and lockfiles from Tasks 1–10.
- Produces: required CI checks and a `workflow_dispatch` distribution job that refuses to run without pre-existing Apple credentials.

- [ ] **Step 1: Write the no-secrets and workflow structure tests**

Scan tracked app files for private keys, provisioning profiles, `.p12`, App Store Connect issuer/key IDs and bearer tokens. Assert the workflow has `permissions: contents: read`, a test job, an unsigned simulator build on `macos-26`, and a separate TestFlight job guarded by both `workflow_dispatch` and an explicit `distribute` input equal to `true`.

- [ ] **Step 2: Run and verify failure**

Run: `node apps/energetico-mobile/scripts/verify-no-secrets.mjs`  
Expected: FAIL until the verifier and workflow exist.

- [ ] **Step 3: Implement CI**

The test job runs `pnpm install --frozen-lockfile`, Node tests and Vite build. The iOS job selects Xcode 26, runs Capacitor sync, installs MSAL dependencies, configures the extension idempotently, and executes `xcodebuild` for an iPhone simulator with `CODE_SIGNING_ALLOWED=NO`.

The TestFlight job must not run on push. It first validates that a paid Apple Developer membership and the required repository secrets already exist; missing values fail before any upload. It performs no purchase or enrollment action.

- [ ] **Step 4: Document the free and paid boundaries**

`DISTRIBUTION.md` must distinguish local/web tests, free unsigned simulator build, existing Apple membership, App ID/App Group registration, signing secrets, TestFlight upload and App Review. State that the agent cannot initiate Apple membership payment.

- [ ] **Step 5: Run the complete local gate**

Run: `pnpm --dir apps/energetico-mobile test`  
Run: `pnpm --dir apps/energetico-mobile build`  
Run: `node apps/energetico-mobile/scripts/verify-ios-project.mjs`  
Run: `node apps/energetico-mobile/scripts/verify-no-secrets.mjs`  
Run: the existing full portal test command from `README.md`.  
Expected: all commands exit 0.

- [ ] **Step 6: Push the branch and verify GitHub Actions**

Push the implementation branch. Wait for both web tests and unsigned iOS simulator build to finish. Download the CI artifact/log and confirm it contains the app and Share Extension targets. A green workflow is required before reporting the implementation buildable.

- [ ] **Step 7: Commit CI and documentation**

```powershell
git add .github/workflows/energetico-ios.yml apps/energetico-mobile/DISTRIBUTION.md apps/energetico-mobile/scripts/verify-no-secrets.mjs README.md
git commit -m "Automatiza validação do aplicativo iOS"
```

### Task 12: On-device acceptance and TestFlight handoff

**Files:**
- Create: `apps/energetico-mobile/ACCEPTANCE.md`
- Modify: `apps/energetico-mobile/DISTRIBUTION.md`

**Interfaces:**
- Consumes: successful CI build, an active pre-existing Apple Developer membership, App Store Connect access and a physical iPhone on iOS 16+.
- Produces: recorded acceptance evidence and, only when credentials already exist, a TestFlight beta build.

- [ ] **Step 1: Create the acceptance checklist**

Include login, `CONTINUAR`, text, poll, create/edit flows, camera, Photos, Files, Share Extension from Photos/Files/WhatsApp/Mail, partial upload failure, session expiration, PDF/image result, logout and relaunch.

- [ ] **Step 2: Verify Apple prerequisites without mutation**

Read the Apple Developer membership status, App Store Connect roles and existing certificates. If membership is inactive or any screen requests payment, stop without clicking confirmation and record the exact blocker. If active, create only the free identifiers and records necessary for `br.com.energetica.energetico`, its Share Extension and App Group.

- [ ] **Step 3: Build and install a development/TestFlight candidate**

Use automatic signing tied to the existing organization team. Upload only through the manually gated workflow. Verify App Store Connect processed the build before inviting the authorized user as an internal tester.

- [ ] **Step 4: Execute the physical-device checklist**

For each item record device model, iOS version, build number, result and evidence. Force one network failure during a text send and one during a file upload; verify the rascunho/file remains and retry succeeds exactly once.

- [ ] **Step 5: Record final status accurately**

Report one of:

```text
TESTFLIGHT_READY: build processed and acceptance passed
BUILD_READY_SIGNING_BLOCKED: code/CI passed; Apple membership or signing unavailable
ACCEPTANCE_FAILED: exact failed scenario and preserved evidence
```

Do not call the app downloadable until TestFlight shows a processed build and the invitation/install link has been verified on the iPhone.

- [ ] **Step 6: Commit acceptance documentation**

```powershell
git add apps/energetico-mobile/ACCEPTANCE.md apps/energetico-mobile/DISTRIBUTION.md
git commit -m "Registra validação do aplicativo no iPhone"
```

## Plan Self-Review

- Every spec requirement maps to at least one task: dedicated UI (4), VM contracts (2), transactional state (3/7), native files (5), Microsoft authentication (6), Share Extension (8), backend security (9), mascot/privacy (10), build/distribution (11), and physical-device acceptance (12).
- The only external blocker is an active Apple Developer membership and signing identity; the plan does not buy or enroll in anything.
- All JavaScript and Python behavior changes use failing tests first. Native code receives structural checks on Windows and compilation/XCTest evidence on macOS.
- Interface names are consistent across producer and consumer tasks: `createChatClient`, `createConversationStore`, `createChatView`, `createNativePorts`, `createAuthService`, and `createAppController`.
- There are no wildcard origins, remote interface URLs, stored tokens, automatic production publication, or unconfirmed success mutations.

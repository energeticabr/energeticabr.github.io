# Portal Administrativo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o admin atual por um portal Microsoft modular que consulta e altera diretamente as listas SharePoint usadas pelo Power Apps.

**Architecture:** O portal continua hospedado como arquivos estaticos e usa MSAL para obter tokens delegados do Microsoft Graph. Um catalogo declarativo agrupa as listas do Power Apps por modulo; um renderizador generico cria consultas, filtros, detalhes e formularios a partir das colunas reais do SharePoint. O controle `PORTAL_ACESSOS` define a experiencia autorizada, enquanto o SharePoint aplica as permissoes efetivas da conta autenticada.

**Tech Stack:** HTML5, CSS3, JavaScript ES modules, MSAL Browser 4, Microsoft Graph v1.0, SharePoint Online, Node.js built-in test runner, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-26-portal-administrativo-microsoft-sharepoint-design.md`

## Global Constraints

- O login administrativo deve ser exclusivamente Microsoft.
- `bernardonotini@energeticabr.com` e o superadministrador inicial.
- O Power Apps existente deve permanecer inalterado.
- O SharePoint e a fonte unica dos registros operacionais.
- Nenhuma chave secreta pode ser enviada ao navegador ou versionada.
- Formularios aparecem somente depois de uma acao explicita de criar ou editar.
- Ausencia de permissao implica bloqueio por padrao.
- Textos de mensagens preservam a capitalizacao digitada; cadastros comuns sao normalizados para maiusculas quando configurados.

---

### Task 1: Estrutura testavel do novo portal

**Files:**
- Create: `portal/package.json`
- Create: `portal/config.js`
- Create: `portal/core/utils.js`
- Create: `tests/portal-utils.test.mjs`
- Modify: `admin.html`

**Interfaces:**
- Produces: `normalizeEmail(value): string`, `normalizeCadastroValue(value): string`, `escapeHtml(value): string`, `formatDateTime(value, locale): string`.

- [ ] **Step 1: Write the failing utility test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, normalizeCadastroValue, escapeHtml } from "../portal/core/utils.js";

test("normaliza e-mail e cadastros sem alterar mensagens", () => {
  assert.equal(normalizeEmail("  Bernardo@Notini.COM "), "bernardo@notini.com");
  assert.equal(normalizeCadastroValue("  Ouro Preto "), "OURO PRETO");
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/portal-utils.test.mjs`

Expected: FAIL because `portal/core/utils.js` does not exist.

- [ ] **Step 3: Implement the utilities and portal configuration**

```js
export function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

export function normalizeCadastroValue(value = "") {
  return String(value).trim().toLocaleUpperCase("pt-BR");
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
```

Configure tenant `0c10f511-7ede-4702-a2d9-bedb26937e0e`, client ID `94018e25-f756-4aa6-974e-27b8b43d7fe9`, superadmin e os dois caminhos SharePoint em `portal/config.js`.

- [ ] **Step 4: Replace `admin.html` with a minimal module bootstrap**

The file must load the official logo, transparent mascot, MSAL Browser and `portal/app.js` as an ES module. It must not include Supabase scripts or password fields.

- [ ] **Step 5: Run the test and verify it passes**

Run: `node --test tests/portal-utils.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin.html portal tests/portal-utils.test.mjs
git commit -m "Cria estrutura modular do novo admin"
```

### Task 2: Login Microsoft exclusivo e pagina institucional

**Files:**
- Create: `portal/auth/microsoft-auth.js`
- Create: `portal/ui/login-view.js`
- Create: `portal/styles/admin.css`
- Create: `tests/portal-login.test.mjs`
- Modify: `portal/app.js`

**Interfaces:**
- Produces: `createMicrosoftAuth(config)`, com `initialize()`, `signIn()`, `signOut()`, `getAccount()`, `getToken(scopes)`.
- Produces: `renderLoginView(root, handlers)`.

- [ ] **Step 1: Write the failing login markup test**

The test reads `admin.html` and asserts one Microsoft login action, zero password inputs, official logo reference and transparent mascot reference.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/portal-login.test.mjs`

Expected: FAIL until the branded Microsoft-only markup exists.

- [ ] **Step 3: Implement the MSAL adapter**

Use `PublicClientApplication`, `loginRedirect` for first access, `handleRedirectPromise` during initialization and `acquireTokenSilent` with redirect fallback. Initial scopes: `openid`, `profile`, `email`, `User.Read`.

- [ ] **Step 4: Implement the branded login view**

Use a quiet construction-focused layout: logo and company name at the upper left, mascot integrated at the edge of the title, one `Entrar com Microsoft` button, loading state and a concise unauthorized state. No email/password form.

- [ ] **Step 5: Run the test and verify it passes**

Run: `node --test tests/portal-login.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin.html portal/auth portal/ui/login-view.js portal/styles/admin.css portal/app.js tests/portal-login.test.mjs
git commit -m "Torna o login administrativo exclusivo da Microsoft"
```

### Task 3: Cliente Microsoft Graph e descoberta das listas

**Files:**
- Create: `portal/data/graph-client.js`
- Create: `portal/data/sharepoint-repository.js`
- Create: `tests/sharepoint-repository.test.mjs`

**Interfaces:**
- Consumes: `createMicrosoftAuth(config).getToken(scopes)`.
- Produces: `createGraphClient(tokenProvider).request(path, options)`.
- Produces: `createSharePointRepository(graph, siteConfig)` com `resolveSites()`, `listLists()`, `resolveList(displayName)`, `getColumns(listId)`, `getItems(listId, query)`, `createItem(listId, fields)`, `updateItem(listId, itemId, fields)`, `deleteItem(listId, itemId)`.

- [ ] **Step 1: Write repository tests with a fake Graph client**

Test site resolution by hostname/path, normalized list matching with accents ignored, pagination through `@odata.nextLink`, field updates and useful error messages for 401, 403, 404 and 429.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/sharepoint-repository.test.mjs`

Expected: FAIL because repository files do not exist.

- [ ] **Step 3: Implement Graph request handling**

Use Graph v1.0, JSON bodies, abort timeouts, one retry for 429 using `Retry-After`, and typed errors containing `status`, `code` and `message`.

- [ ] **Step 4: Implement SharePoint list discovery and CRUD**

Resolve both configured SharePoint sites and cache list/column metadata in memory for the active session only. Do not use local storage for list contents.

- [ ] **Step 5: Run tests and verify they pass**

Run: `node --test tests/sharepoint-repository.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/data tests/sharepoint-repository.test.mjs
git commit -m "Adiciona acesso direto ao SharePoint via Microsoft Graph"
```

### Task 4: Catalogo completo de modulos do Power Apps

**Files:**
- Create: `portal/catalog/modules.js`
- Create: `portal/catalog/entities.js`
- Create: `tests/portal-catalog.test.mjs`

**Interfaces:**
- Produces: `MODULES: ModuleDefinition[]`.
- Produces: `ENTITIES: EntityDefinition[]`.
- Produces: `entitiesForModule(moduleId): EntityDefinition[]`.

- [ ] **Step 1: Write the failing catalog coverage test**

Assert unique module/entity IDs, seven operational modules plus access management, and coverage for every SharePoint source identified in the Power Apps inventory. Assert every entity has `id`, `moduleId`, `title`, `siteKey`, `listNames`, `capabilities` and `searchFields`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/portal-catalog.test.mjs`

Expected: FAIL because the catalog does not exist.

- [ ] **Step 3: Implement module definitions**

Create: `dashboard`, `suprimentos`, `demandas`, `comercial`, `financeiro`, `rh-obras`, `patrimonio-locacoes`, `auditoria-compliance`, `usuarios-acessos`.

- [ ] **Step 4: Implement entity definitions**

Map the exact list names from the inventory, including aliases for names that changed. Set destructive capabilities to false by default and enable them only where the Power Apps exposes an explicit edit/delete flow.

- [ ] **Step 5: Run the catalog test and verify it passes**

Run: `node --test tests/portal-catalog.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/catalog tests/portal-catalog.test.mjs
git commit -m "Mapeia modulos e listas do Power Apps"
```

### Task 5: Permissoes e administracao de usuarios

**Files:**
- Create: `portal/access/access-model.js`
- Create: `portal/access/access-repository.js`
- Create: `portal/ui/access-page.js`
- Create: `tests/portal-access.test.mjs`

**Interfaces:**
- Produces: `ACTIONS = ["view", "create", "edit", "delete", "approve"]`.
- Produces: `isSuperAdmin(email)`, `can(accessRecord, moduleId, action)`, `buildDefaultAccess(email, name)`.
- Produces: `accessRepository.ensureList()`, `getCurrentAccess(email)`, `listUsers()`, `saveUserAccess(record)`, `setUserActive(id, active)`.

- [ ] **Step 1: Write failing permission tests**

Test superadmin full access, inactive user denial, missing permission denial, module/action grants and normalization of the administrator email.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/portal-access.test.mjs`

Expected: FAIL because access modules do not exist.

- [ ] **Step 3: Implement the access model**

Use deny-by-default semantics. Store permissions as SharePoint fields named `MODULO_<MODULE_ID>_<ACTION>` with sanitized uppercase IDs, plus `EMAIL`, `NOME`, `STATUS`, `PERFIL`, `DATAALTERACAO` and `ALTERADOPOR`.

- [ ] **Step 4: Implement access list setup and repository**

For the superadmin only, `ensureList()` checks for `PORTAL_ACESSOS`; when absent, it creates the list and its columns through Graph using incremental `Sites.Manage.All` consent. Regular users never receive this scope.

- [ ] **Step 5: Implement the access management page**

Render existing users in a table. Opening a user shows module rows and five action toggles. Provide active/inactive controls, save confirmation and an audit summary. Only the superadmin sees this page.

- [ ] **Step 6: Run tests and verify they pass**

Run: `node --test tests/portal-access.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add portal/access portal/ui/access-page.js tests/portal-access.test.mjs
git commit -m "Adiciona controle de usuarios e permissoes"
```

### Task 6: Shell administrativo e painel inicial

**Files:**
- Create: `portal/ui/app-shell.js`
- Create: `portal/ui/dashboard-page.js`
- Create: `portal/core/router.js`
- Create: `tests/portal-router.test.mjs`
- Modify: `portal/app.js`
- Modify: `portal/styles/admin.css`

**Interfaces:**
- Consumes: `MODULES`, `can()`, active account and repository status.
- Produces: `createRouter(routes)`, `renderAppShell(root, session)`, `renderDashboard(container, context)`.

- [ ] **Step 1: Write failing router tests**

Test route parsing, fallback to dashboard, denied module fallback and entity/detail URL generation.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/portal-router.test.mjs`

Expected: FAIL because the router does not exist.

- [ ] **Step 3: Implement the shell**

Create a compact left navigation, company identity at the top, current user menu, logout command and responsive mobile drawer. Use distinct module icons and keep cards at 8px radius or less.

- [ ] **Step 4: Implement the dashboard**

Show permitted modules, records requiring attention, recent updates and connection state. Fetch indicators lazily so one inaccessible list does not block the whole page.

- [ ] **Step 5: Run tests and verify they pass**

Run: `node --test tests/portal-router.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/ui portal/core/router.js portal/app.js portal/styles/admin.css tests/portal-router.test.mjs
git commit -m "Cria shell e painel do portal administrativo"
```

### Task 7: Paginas genericas de galeria, detalhe e formulario

**Files:**
- Create: `portal/ui/entity-page.js`
- Create: `portal/ui/item-detail.js`
- Create: `portal/ui/dynamic-form.js`
- Create: `portal/data/column-mapper.js`
- Create: `tests/column-mapper.test.mjs`
- Modify: `portal/styles/admin.css`
- Modify: `portal/app.js`

**Interfaces:**
- Consumes: `EntityDefinition`, SharePoint column metadata and access model.
- Produces: `mapColumn(column): FieldDefinition`, `renderEntityPage()`, `renderItemDetail()`, `renderDynamicForm()`.

- [ ] **Step 1: Write failing column mapper tests**

Cover text, multiline text, number, currency, boolean, date, date-time, choice, lookup display, person display, required fields, hidden/read-only columns and uppercase normalization.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/column-mapper.test.mjs`

Expected: FAIL because the mapper does not exist.

- [ ] **Step 3: Implement the column mapper and dynamic form**

Ignore SharePoint system columns, use native controls by type, preserve message text and normalize configured registration fields to uppercase before submission.

- [ ] **Step 4: Implement gallery and details**

Provide search, status filter, pagination, sortable columns, loading/empty/error states, item details and explicit `Novo registro` and `Editar` actions. Keep forms closed until invoked.

- [ ] **Step 5: Implement create, edit and delete flows**

Check `can()` before showing and immediately before executing each action. After success, remain on the same logical page, refresh the row and show a success toast. Require confirmation for delete.

- [ ] **Step 6: Run tests and verify they pass**

Run: `node --test tests/column-mapper.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add portal/ui portal/data/column-mapper.js portal/app.js portal/styles/admin.css tests/column-mapper.test.mjs
git commit -m "Gera galerias e formularios pelas listas SharePoint"
```

### Task 8: Anexos, historico e tolerancia a listas ausentes

**Files:**
- Create: `portal/data/attachments.js`
- Create: `portal/ui/attachments-panel.js`
- Create: `portal/ui/activity-panel.js`
- Create: `tests/portal-resilience.test.mjs`
- Modify: `portal/data/sharepoint-repository.js`
- Modify: `portal/ui/entity-page.js`

**Interfaces:**
- Produces: `listAttachments(listId, itemId)`, `uploadAttachment(listId, itemId, file)`, `deleteAttachment(listId, itemId, fileName)`.
- Produces: entity state `available | forbidden | missing | error`.

- [ ] **Step 1: Write failing resilience tests**

Verify an absent alias marks only its entity unavailable, a forbidden list remains hidden, attachment size/type validation occurs before request and failures retain the user's form values.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/portal-resilience.test.mjs`

Expected: FAIL because attachment and resilience modules do not exist.

- [ ] **Step 3: Implement attachment handling**

Associate attachments with the exact SharePoint item. Show file name, type, size, author and upload date when returned by Graph. Respect entity and user permissions.

- [ ] **Step 4: Implement graceful degradation**

One missing, renamed or forbidden list must not break its module or the portal. Display a concise source status visible to the superadmin.

- [ ] **Step 5: Run tests and verify they pass**

Run: `node --test tests/portal-resilience.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/data portal/ui tests/portal-resilience.test.mjs
git commit -m "Adiciona anexos e tolerancia a fontes SharePoint"
```

### Task 9: Verificacao visual, seguranca e publicacao

**Files:**
- Modify: `tests/admin-microsoft-login.test.js`
- Create: `tests/portal-security.test.mjs`
- Modify: `README.md`
- Modify: `sitemap.xml` only if an obsolete customer route remains.

**Interfaces:**
- Consumes: the completed portal.
- Produces: a published admin that exposes no password login, Supabase key or unrestricted administrative route.

- [ ] **Step 1: Write the final security regression test**

Assert no password field, no Supabase script, no service-role/secret pattern, Microsoft-only login, superadmin bootstrap and route permission checks.

- [ ] **Step 2: Run the complete suite**

Run: `node --test tests/*.test.mjs && node tests/admin-microsoft-login.test.js && node tests/remove-client-area.test.js`

Expected: all tests PASS.

- [ ] **Step 3: Run local browser verification**

Verify desktop 1440x900 and mobile 390x844: branded login, non-overlapping shell, readable tables, closed forms by default, access toggles and unauthorized state.

- [ ] **Step 4: Inspect all network and console errors**

Expected: no secret exposure, no uncaught exceptions and clear handling for Graph consent or permission errors.

- [ ] **Step 5: Update operational documentation**

Document the Entra delegated scopes, SharePoint sites, `PORTAL_ACESSOS` bootstrap, recovery procedure and how to add a new entity to the catalog.

- [ ] **Step 6: Commit and publish**

```bash
git add admin.html portal tests README.md sitemap.xml
git commit -m "Publica novo portal administrativo da Energetica"
git push origin main
```

- [ ] **Step 7: Verify the published site**

Open `https://www.energeticabr.com/admin.html` with a cache-busting query, confirm the Microsoft login page, authenticate as the superadmin, create `PORTAL_ACESSOS` when requested and verify that the dashboard and module catalog load from SharePoint.

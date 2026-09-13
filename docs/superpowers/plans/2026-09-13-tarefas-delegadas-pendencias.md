# Tarefas delegadas em Pendências Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir tarefas delegadas não concluídas em Pendências, com busca, ordenação por arraste persistida por conta e conclusão sincronizada no SharePoint.

**Architecture:** O canal autenticado `/api/portal-chat` continuará sendo a interface de dados. O backend fornecerá snapshots e uma ação de conclusão; o app renderizará uma galeria especializada no transcript e manterá apenas a preferência de ordenação localmente, reconciliando-a com cada snapshot.

**Tech Stack:** Python 3, SharePoint REST existente, Node.js 24, JavaScript ESM, DOM/HTML/CSS, Node test runner, Vite/PWA.

**Spec:** `docs/superpowers/specs/2026-09-13-tarefas-delegadas-pendencias-design.md`

## Global Constraints

- A opção aparece somente quando houver item com status diferente de `CONCLUÍDO`, inclusive status vazio.
- O SharePoint é a fonte da verdade para o status; a ordem é uma preferência local por conta.
- Conclusões usam autenticação existente, ID numérico validado e atualização somente do campo `CONCLUÍDO`.
- O mesmo núcleo web atende Chrome/PWA, iOS e Android.

---

### Task 1: Consulta e conclusão de tarefas no backend

**Files:**
- Modify: `C:/Users/Bernardonotini/Documents/Codex/2026-09-10/abr/backend-base-20260910/worker/clients.py`
- Test: `C:/Users/Bernardonotini/Documents/Codex/2026-09-10/abr/backend-base-20260910/tests/test_clients.py`

**Interfaces:**
- Produces `SharePointClient.get_delegated_tasks()` returning records with `Id`, `TAREFA`, `RESPONSÁVEL`, `PRIORITÁRIA`, `DATA FATAL`, `FILIAL`, `ASSOCIAÇÃO`, and `CONCLUÍDO`.
- Produces `SharePointClient.complete_delegated_task(item_id)` that calls `update_item(item_id, {"CONCLUÍDO": "CONCLUÍDO"}, target_list="TAREFASDELEGADAS")` after validating a positive integer ID.

- [ ] **Step 1: Write the failing tests**

```python
def test_get_delegated_tasks_keeps_only_unfinished_rows(self):
    rows = client.get_delegated_tasks()
    assert [row["Id"] for row in rows] == [12, 14]
    assert rows[0]["TAREFA"] == "Enviar contrato"

def test_complete_delegated_task_updates_only_status(self):
    client.complete_delegated_task(12)
    assert fake.updated == [(12, {"CONCLUÍDO": "CONCLUÍDO"}, "TAREFASDELEGADAS")]
```

- [ ] **Step 2: Run the tests and confirm the expected missing-method failure**

Run from `C:/Users/Bernardonotini/Documents/Codex/2026-09-10/abr/backend-base-20260910`:

```powershell
python -m pytest tests/test_clients.py -k "delegated_tasks or complete_delegated_task" -q
```

Expected: FAIL because the client methods do not exist.

- [ ] **Step 3: Implement the minimal REST query and update**

Use the existing `_internal_field`, `_list_endpoint`, `_request`, `_values`, and `update_item` helpers. Request the display fields and filter rows in Python so blank status remains eligible; normalize `CONCLUÍDO`, `CONCLUIDO`, and encoded SharePoint names when reading.

- [ ] **Step 4: Run the focused tests**

```powershell
python -m pytest tests/test_clients.py -k "delegated_tasks or complete_delegated_task" -q
```

Expected: PASS.

- [ ] **Step 5: Commit the backend client change**

```powershell
git add worker/clients.py tests/test_clients.py
git commit -m "Add delegated task SharePoint operations"
```

### Task 2: Pendências backend snapshot and completion stages

**Files:**
- Modify: `C:/Users/Bernardonotini/Documents/Codex/2026-09-10/abr/backend-base-20260910/worker/workflow.py`
- Test: `C:/Users/Bernardonotini/Documents/Codex/2026-09-10/abr/backend-base-20260910/tests/test_workflow.py`

**Interfaces:**
- Adds `PENDING_DELEGATED_TASKS_ID`, `PENDING_DELEGATED_TASKS_STAGE`, and reply IDs `delegated_tasks_complete:<id>`.
- Adds result payload `delegatedTasks: { rows: [...], count: N }` for the snapshot and completion responses.
- Adds `_pending_delegated_task_options(state)` and `_send_pending_delegated_tasks(state)`.

- [ ] **Step 1: Write failing workflow tests**

```python
def test_pending_menu_offers_delegated_tasks_only_when_unfinished(self):
    self.sharepoint.delegated_task_rows = [{"Id": 7, "CONCLUÍDO": "ATIVIDADE CRIADA", "TAREFA": "Cobrar retorno"}]
    pending = self.reply("PENDÊNCIAS")
    assert any(option["reply"] == "pending_delegated_tasks" for option in pending["options"])

def test_delegated_task_check_updates_sharepoint_and_refreshes_gallery(self):
    self.reply("PENDÊNCIAS")
    opened = self.reply(reply_id="pending_delegated_tasks")
    result = self.reply(reply_id="delegated_tasks_complete:7")
    assert result["status"] == "delegated_tasks_updated"
    assert self.sharepoint.updated[-1] == (7, {"CONCLUÍDO": "CONCLUÍDO"}, "TAREFASDELEGADAS")
```

- [ ] **Step 2: Run the focused workflow tests and verify they fail**

```powershell
python -m pytest tests/test_workflow.py -k "delegated_tasks" -q
```

Expected: FAIL because Pendências has no delegated task option or stage.

- [ ] **Step 3: Implement the stage and safe action handling**

Add the option to `_send_pending_menu` only when `_pending_delegated_task_options` is non-empty. Render a structured task snapshot with stable numeric IDs. Handle navigation back, snapshot errors, stale IDs, duplicate replies, and completion by calling the client method, then requerying before sending the refreshed gallery.

- [ ] **Step 4: Run focused and existing pending tests**

```powershell
python -m pytest tests/test_workflow.py -k "delegated_tasks or pending_menu" -q
```

Expected: PASS.

- [ ] **Step 5: Commit the workflow change**

```powershell
git add worker/workflow.py tests/test_workflow.py
git commit -m "Expose delegated tasks in pending menu"
```

### Task 3: Mobile client and controller state

**Files:**
- Modify: `apps/energetico-mobile/src/chat/chat-client.js`
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Modify: `apps/energetico-mobile/src/chat/conversation-store.js`
- Test: `apps/energetico-mobile/tests/app-controller.test.mjs`

**Interfaces:**
- `createChatClient` exposes `getDelegatedTasks()` and `completeDelegatedTask(taskId)`.
- Controller state includes `delegatedTasks`, `delegatedTasksBusy`, and `delegatedTasksError`.
- Controller handlers emit `open-delegated-tasks`, `complete-delegated-task`, `filter-delegated-tasks`, and `reorder-delegated-tasks`.

- [ ] **Step 1: Write failing client/controller tests**

```js
test("carrega tarefas delegadas e conclui pelo ID", async () => {
  const h = makeHarness({ delegatedTasks: [{ id: 7, task: "Cobrar retorno", status: "ATIVIDADE CRIADA" }] });
  await h.view.emit("open-delegated-tasks");
  await h.view.emit("complete-delegated-task", { taskId: "7" });
  assert.equal(h.client.completedIds.at(-1), "7");
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

```powershell
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" --test tests/app-controller.test.mjs
```

Expected: FAIL because the client/controller do not expose delegated task actions.

- [ ] **Step 3: Implement API methods, state updates, and account-scoped order storage**

Send `{ action: "delegated_tasks_snapshot" }` and `{ action: "delegated_task_complete", taskId }` through the existing authenticated endpoint. Validate `status`, `messages`, and `delegatedTasks.rows`. Store ordering under `energetico.delegated-task-order.<normalized-account-id>`, retaining only IDs present in the latest snapshot and appending new IDs.

- [ ] **Step 4: Run focused controller tests**

```powershell
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" --test tests/app-controller.test.mjs
```

Expected: PASS.

### Task 4: Gallery UI, search, drag ordering, and completion controls

**Files:**
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`
- Modify: `apps/energetico-mobile/src/styles.css`
- Test: `apps/energetico-mobile/tests/chat-view.test.mjs`

**Interfaces:**
- `renderChatMarkup` renders `.delegated-tasks-gallery` from `state.delegatedTasks`.
- Cards carry `data-task-id`, `draggable="true"`, `data-action="complete-delegated-task"`, and a search input with `data-role="delegated-task-search"`.
- Empty, error, busy, and no-results states remain accessible and do not submit the chat composer.

- [ ] **Step 1: Write failing markup and interaction tests**

```js
test("renderiza tarefas delegadas com busca, arraste e check", () => {
  const markup = renderChatMarkup(signedInState({ delegatedTasks: {
    rows: [{ id: 7, task: "Cobrar retorno", responsible: "Bernardo", status: "ATIVIDADE CRIADA" }],
    count: 1,
  }}));
  assert.match(markup, /delegated-tasks-gallery/);
  assert.match(markup, /data-role="delegated-task-search"/);
  assert.match(markup, /draggable="true"/);
  assert.match(markup, /data-action="complete-delegated-task"/);
});
```

- [ ] **Step 2: Run the focused UI test and verify failure**

```powershell
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" --test tests/chat-view.test.mjs
```

Expected: FAIL because no delegated task gallery is rendered.

- [ ] **Step 3: Implement the gallery and interactions**

Render escaped task fields, use an input event for filtering, use pointer/drag events with a visible drop target, emit reorder changes only after a card moves, and render the check button disabled while busy. Keep the search value in controller state so rerenders do not erase it.

- [ ] **Step 4: Add responsive styles and run UI tests**

```powershell
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" --test tests/chat-view.test.mjs
```

Expected: PASS, including keyboard-accessible check controls and narrow-phone layout.

### Task 5: Integration verification and publication

**Files:**
- Modify: none beyond the files above.
- Test: `apps/energetico-mobile/tests/*.test.mjs`, backend test suite.

- [ ] **Step 1: Run all backend tests**

```powershell
python -m pytest -q
```

Expected: PASS.

- [ ] **Step 2: Run all mobile tests and builds**

```powershell
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" --test @(Get-ChildItem apps/energetico-mobile/tests -Filter '*.test.mjs' -File | ForEach-Object { $_.FullName })
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" apps/energetico-mobile/node_modules/vite/bin/vite.js build --config apps/energetico-mobile/vite.config.js
& "$env:USERPROFILE\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe" apps/energetico-mobile/node_modules/vite/bin/vite.js build --config apps/energetico-mobile/vite.pwa.config.js
```

Expected: all tests and both builds pass.

- [ ] **Step 3: Deploy the backend using the repository's existing deployment procedure**

Run its predeploy checks, deploy the worker, and verify `/health` plus authenticated snapshot behavior without logging credentials.

- [ ] **Step 4: Publish the shared web app**

```powershell
git add apps/energetico-mobile
git commit -m "Add delegated tasks pending gallery"
git push origin HEAD:main
```

- [ ] **Step 5: Verify GitHub Pages and mobile workflows**

Confirm the Pages workflow for the published SHA is successful and the served bundle contains the gallery label and delegated task action. Confirm Android/iOS workflows are triggered by the same SHA.


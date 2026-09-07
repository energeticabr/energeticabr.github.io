import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { auditLogRow } from "../src/ui/audit-log-table.js";
import { renderChatMarkup, commandFromTarget } from "../src/ui/chat-view.js";

function page(busy = false) {
  return new JSDOM(renderChatMarkup({ sessionStatus: "authenticated", account: { name: "Teste" },
    messages: [{ type: "poll", question: "LOG DE AÇÕES", options: [
      { id: "audit_log_row:0", label: "863 • TAREFAS • CRIADO • 16:13" },
      { id: "audit_log_row:1", label: "862 • FORNECEDORES • EDITADO • 13:04" },
      { id: "audit_log_row:2", label: "12345 • DOCUMENTOS • ELIMINADO • 09:30" },
      { id: "main_menu", label: "MENU PRINCIPAL" },
    ] }], activeText: busy ? {} : null, pendingFiles: [],
  }));
}

test("LOG tem quatro colunas na ordem solicitada e status coloridos", () => {
  const dom = page();
  const document = dom.window.document;
  assert.deepEqual([...document.querySelectorAll("th")].map(el => el.textContent), ["ID", "Base de dados", "Horário", "Status"]);
  assert.equal(document.querySelectorAll("tbody tr").length, 3);
  for (const [status, text] of [["created", "Criado"], ["edited", "Editado"], ["deleted", "Eliminado"]]) {
    assert.equal(document.querySelector(`.chat-audit-status--${status}`).textContent, text);
  }
  assert.ok(document.querySelector('.chat-choice-list [data-reply-id="main_menu"]'));
  assert.equal(document.querySelectorAll('.chat-choice-list [data-reply-id^="audit_log_row:"]').length, 0);
  dom.window.close();
});

test("clique em qualquer célula mantém o comando da VM e botão é acessível pelo teclado", () => {
  const dom = page();
  const row = dom.window.document.querySelector("tbody tr");
  for (const cell of row.querySelectorAll("td")) assert.equal(commandFromTarget(cell).replyId, "audit_log_row:0");
  assert.equal(commandFromTarget(row.querySelector("button")).replyId, "audit_log_row:0");
  assert.match(row.querySelector("button").getAttribute("aria-label"), /863.*TAREFAS/);
  dom.window.close();
});

test("LOG bloqueia seleção de linhas enquanto aguarda resposta", () => {
  const dom = page(true);
  const row = dom.window.document.querySelector("tbody tr");
  assert.equal(commandFromTarget(row.querySelector("td")), null);
  assert.equal(commandFromTarget(row.querySelector("button")), null);
  dom.window.close();
});

test("não interpreta outras opções ou status desconhecidos como eventos de LOG", () => {
  assert.equal(auditLogRow({ id: "x", label: "1 • BASE • CRIADO • 12:00" }), null);
  assert.equal(auditLogRow({ id: "audit_log_row:0", label: "1 • BASE • OUTRO • 12:00" }), null);
});

test("nomes das bases são escapados, sem inserir HTML", () => {
  const row = auditLogRow({ id: "audit_log_row:0", label: '1 • <img src=x> • CRIADO • 12:00' });
  assert.equal(row.database, '<img src=x>');
  const markup = renderChatMarkup({ sessionStatus: "authenticated", messages: [{ type: "poll", options: [{ id: row.replyId, label: row.label }] }] });
  assert.match(markup, /&lt;img src=x&gt;/);
  assert.doesNotMatch(markup, /<img src=x>/);
});

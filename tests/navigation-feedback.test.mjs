import assert from "node:assert/strict";
import test from "node:test";
import { createNavigationFeedback } from "../portal/core/navigation-feedback.js";
import { notifyItemDeleted } from "../portal/ui/item-detail.js";

test("a exclusao entrega uma confirmacao unica para a galeria de destino", () => {
  const feedback = createNavigationFeedback();
  notifyItemDeleted({ id: "clientes" }, feedback.set);
  assert.deepEqual(feedback.consume("clientes"), { message: "Registro excluído com sucesso." });
  assert.equal(feedback.consume("clientes"), undefined);
});

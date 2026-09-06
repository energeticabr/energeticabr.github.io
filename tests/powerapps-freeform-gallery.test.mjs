import assert from "node:assert/strict";
import test from "node:test";

import {
  powerAppsFreeformGalleryMarkup,
  powerAppsFreeformGalleryRowMarkup,
} from "../portal/ui/powerapps-freeform-gallery.js";

test("renderiza cada registro como artigo com lista de definicoes e preserva todos os pares", () => {
  const markup = powerAppsFreeformGalleryRowMarkup({
    id: 243,
    title: "Pedido 243",
    fields: [
      { label: "Fornecedor", value: "Material Forte" },
      { label: "Quantidade", value: 0 },
      { label: "Concluido", value: false },
      { label: "Observacao", value: "" },
      { label: "Fornecedor", value: "Segunda referencia" },
    ],
  });

  assert.match(markup, /^<article\b/);
  assert.match(markup, /<dl\b/);
  assert.equal((markup.match(/<dt\b/g) || []).length, 5);
  assert.equal((markup.match(/<dd\b/g) || []).length, 5);
  assert.match(markup, /<dt>Fornecedor<\/dt><dd data-label="Fornecedor">Material Forte<\/dd>/);
  assert.match(markup, /<dt>Quantidade<\/dt><dd data-label="Quantidade">0<\/dd>/);
  assert.match(markup, /<dt>Concluido<\/dt><dd data-label="Concluido">false<\/dd>/);
  assert.match(markup, /<dt>Observacao<\/dt><dd data-label="Observacao"><\/dd>/);
  assert.match(markup, /<dt>Fornecedor<\/dt><dd data-label="Fornecedor">Segunda referencia<\/dd>/);
  assert.doesNotMatch(markup, /<table\b|<tr\b|<td\b/i);
});

test("escapa conteudo, atributos e classes fornecidos pelo registro", () => {
  const markup = powerAppsFreeformGalleryRowMarkup({
    id: '7" onmouseover="alert(1)',
    title: "<img src=x onerror=alert(1)>",
    fields: [{
      label: "<b>Campo</b>",
      value: 'A&B <script>alert("x")</script>',
      area: 'principal" onclick="alert(1)',
    }],
    status: { label: "<APROVADO>", className: 'is-approved" onclick="x' },
    className: 'custom-row" onclick="x',
    actions: {
      edit: { label: "<Editar>" },
      detail: { label: "Detalhes", href: "javascript:alert(1)" },
    },
  });

  assert.doesNotMatch(markup, /<script|<img src=x|javascript:|\s(?:onclick|onmouseover)=["']/i);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /<dt>&lt;b&gt;Campo&lt;\/b&gt;<\/dt>/);
  assert.match(markup, /A&amp;B &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(markup, /data-entity-edit="7&quot; onmouseover=&quot;alert\(1\)"/);
  assert.match(markup, /data-gallery-area="principal&quot; onclick=&quot;alert\(1\)"/);
  assert.match(markup, /href="#"/);
});

test("oferece previa de imagem e acao de anexo quando configuradas", () => {
  const markup = powerAppsFreeformGalleryRowMarkup({
    id: "3319",
    fields: [{ label: "Produto", value: "Mestre de obras" }],
    attachment: {
      name: "foto & obra.jpg",
      kind: "image",
      previewUrl: "https://contoso.example/foto?a=1&b=2",
      actionId: "arquivo-1",
      actionLabel: "Ampliar imagem",
    },
  });

  assert.match(markup, /class="powerapps-freeform-attachment is-image"/);
  assert.match(markup, /data-gallery-attachment="arquivo-1"/);
  assert.match(markup, /<img[^>]+src="https:\/\/contoso\.example\/foto\?a=1&amp;b=2"/);
  assert.match(markup, /alt="Previa de foto &amp; obra\.jpg"/);
  assert.match(markup, />Ampliar imagem<\/span>/);

  const withoutAttachment = powerAppsFreeformGalleryRowMarkup({
    id: "3320",
    fields: [{ label: "Produto", value: "Trincha" }],
  });
  assert.doesNotMatch(withoutAttachment, /powerapps-freeform-attachment|data-gallery-attachment/);
});

test("renderiza indicador de PDF e controles opcionais de editar excluir e detalhar", () => {
  const markup = powerAppsFreeformGalleryRowMarkup({
    id: "7/8",
    fields: [{ label: "ID", value: "7/8" }],
    attachment: {
      name: "nota fiscal.pdf",
      kind: "pdf",
      actionId: "7/8",
    },
    actions: {
      edit: true,
      delete: { label: "Remover" },
      detail: { href: "#/entity/lancamentos/item/7%2F8", label: "Abrir detalhes" },
    },
  });

  assert.match(markup, /class="powerapps-freeform-attachment is-pdf"/);
  assert.match(markup, /<span class="powerapps-freeform-attachment-badge" aria-hidden="true">PDF<\/span>/);
  assert.match(markup, /data-entity-edit="7\/8"[^>]*>Editar<\/button>/);
  assert.match(markup, /data-entity-delete="7\/8"[^>]*>Remover<\/button>/);
  assert.match(markup, /href="#\/entity\/lancamentos\/item\/7%2F8"[^>]*>Abrir detalhes<\/a>/);
});

test("expoe status, areas e hooks de layout compacto responsivo", () => {
  const markup = powerAppsFreeformGalleryMarkup({
    ariaLabel: "Pedidos filtrados",
    compact: true,
    rows: [{
      id: 10,
      title: "Pedido finalizado",
      status: { label: "Aprovado", className: "is-approved" },
      fields: [
        { label: "Produto", value: "Bloco", area: "produto", emphasis: "strong" },
        { label: "Descricao", value: "Entrega imediata", area: "descricao", wide: true },
      ],
    }],
  });

  assert.match(markup, /^<section class="powerapps-freeform-gallery is-compact"/);
  assert.match(markup, /aria-label="Pedidos filtrados"/);
  assert.match(markup, /class="powerapps-freeform-row is-compact is-approved"/);
  assert.match(markup, /class="powerapps-freeform-status is-approved">Aprovado<\/span>/);
  assert.match(markup, /class="powerapps-freeform-field is-area-produto is-strong" data-gallery-area="produto"/);
  assert.match(markup, /class="powerapps-freeform-field is-area-descricao is-wide" data-gallery-area="descricao"/);
  assert.match(markup, /data-powerapps-freeform-row="10"/);
  assert.doesNotMatch(markup, /<table\b/i);
});

test("renderiza estado vazio sem criar artigos", () => {
  const markup = powerAppsFreeformGalleryMarkup({
    rows: [],
    emptyMessage: "Nenhum <registro> & pendente.",
  });

  assert.match(markup, /class="powerapps-freeform-empty" role="status"/);
  assert.match(markup, /Nenhum &lt;registro&gt; &amp; pendente\./);
  assert.doesNotMatch(markup, /<article\b/i);
});

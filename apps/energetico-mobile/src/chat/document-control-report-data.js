import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { createSharePointAttachmentTransport } from "../../../../portal/data/attachments.js";
import { normalizeDocumentControlSnapshot } from "./document-control-report-model.js";
import { validateAttachment } from "./file-policy.js";

const SITE = "personal";
const LISTS = ["DOCUMENTOS_1", "DOCUMENTOS1", "DOCUMENTOS 1", "DOCUMENTOS"];
const WINDOW_PAGES = 100;
const MAX_TOTAL_PAGES = 10_000;
const SCHEMA = {
  submittedDate: ["DATASUBMETIDO", "DATA SUBMETIDO"], issuedDate: ["DATA"], expirationDate: ["DATAVALIDADE"],
  branch: ["FILIAL"], homologation: ["TIPOHOMOLOGACAO"], documentType: ["TIPODOCUMENTO"],
  person: ["PESSOARELACIONADA", "PESSOA RELACIONADA"], stage: ["ETAPA"], property: ["IMOVEL", "IMÓVEL"], status: ["STATUS"],
};
// Only schema matching folds accents. Report values retain accents for PowerFx equality.
const columnKey = value => String(value ?? "").replace(/^OData_/i, "")
  .replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function validateSchema(columns) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema SharePoint inválido em DOCUMENTOS.");
  const eligible = columns.filter(column => !column?.computed && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name ?? "")));
  const resolved = {};
  for (const [field, aliases] of Object.entries(SCHEMA)) {
    const keys = new Set(aliases.map(columnKey));
    const matches = eligible.filter(column => keys.has(columnKey(column?.name)) || keys.has(columnKey(column?.displayName)));
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
      throw new TypeError(`Coluna ${aliases[0]} ausente, ambígua ou insegura em DOCUMENTOS.`);
    }
    resolved[field] = matches[0].name;
  }
  if (new Set(Object.values(resolved)).size !== Object.keys(resolved).length) throw new TypeError("Colunas ambíguas em DOCUMENTOS.");
  return resolved;
}

function scalar(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 1) return scalar(value[0]);
  if (typeof value === "object" && !Array.isArray(value)) {
    let hasLabel = false;
    for (const alias of ["LookupValue", "Value", "value", "Title"]) {
      if (Object.hasOwn(value, alias)) {
        hasLabel = true;
        const label = scalar(value[alias]);
        if (String(label).trim()) return label;
      }
    }
    if (Object.hasOwn(value, "LookupId")) {
      if (String(scalar(value.LookupId)).trim()) throw new TypeError("Lookup não resolvido em DOCUMENTOS.");
      return "";
    }
    if (hasLabel) return "";
  }
  throw new TypeError("Campo SharePoint inválido no controle de documentos.");
}

function normalizeItem(item, columns) {
  if (!item || typeof item !== "object" || Array.isArray(item) || !item.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
    throw new TypeError("Registro ou campos SharePoint inválidos no controle de documentos.");
  }
  const row = { id: item.id };
  for (const [field, column] of Object.entries(columns)) {
    const value = scalar(item.fields[column]);
    if (!String(value).trim() && String(scalar(item.fields[`${column}LookupId`])).trim()) {
      throw new TypeError(`Lookup não resolvido na coluna ${column} de DOCUMENTOS.`);
    }
    row[field] = value;
  }
  return normalizeDocumentControlSnapshot({ documents: [row] }).documents[0];
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Bound every await even when an injected token provider or transport ignores cancellation.
function abortable(operation, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); callback(value);
    };
    const abort = () => finish(reject, signal.reason || new DOMException("Consulta cancelada.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { abortIfNeeded(signal); return operation(); })
      .then(value => { abortIfNeeded(signal); finish(resolve, value); }, error => finish(reject, error))
      .catch(error => finish(reject, error));
  });
}

async function resolveDocumentList(repository, signal) {
  // resolveList uses enumeration order; request the PowerFx source first.
  // Its repository-level physical DOCUMENTOS fallback remains available.
  let list;
  for (const alias of LISTS) {
    list = await abortable(() => repository.resolveList(SITE, [alias], { signal }), signal);
    if (list?.status !== "missing") break;
  }
  if (list?.status !== "resolved" || !list.id) throw new Error("A lista DOCUMENTOS não está disponível nesta conta.");
  return list.id;
}

async function loadRows(repository, listId, signal) {
  const columns = validateSchema(await abortable(() => repository.getColumns(SITE, listId, { signal }), signal));
  const query = new URLSearchParams({ $expand: `fields($select=${Object.values(columns).join(",")})`, $top: "100" }).toString();
  const rows = []; const ids = new Set(); const cursors = new Set(); let cursor = "";
  for (let index = 0; index < MAX_TOTAL_PAGES; index++) {
    const page = await abortable(() => repository.getItemsPage(SITE, listId, query, {
      signal, pageNumber: index % WINDOW_PAGES + 1, maxPages: WINDOW_PAGES,
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, ...(cursor ? { cursor } : {}),
    }), signal);
    if (!Array.isArray(page?.items) || page.items.length > 100 || typeof page.hasMore !== "boolean"
      || page.error || page.incomplete || page.complete === false || page.partial || page.aborted || page.truncated
      || page.batchCount !== undefined && page.batchCount !== page.items.length
      || page.nextLink != null && typeof page.nextLink !== "string") {
      throw new TypeError("Página SharePoint inválida ou incompleta em DOCUMENTOS.");
    }
    const next = page.nextLink?.trim() || "";
    if (page.hasMore !== Boolean(next) || page.hasMore && !page.items.length) throw new TypeError("Página com conclusão de paginação inconsistente.");
    for (const item of page.items) {
      const row = normalizeItem(item, columns);
      if (ids.has(row.id)) throw new TypeError("ID duplicado na paginação de DOCUMENTOS.");
      ids.add(row.id); rows.push(row);
    }
    if (!page.hasMore) return rows;
    if (cursors.has(next)) throw new TypeError("Cursor repetido: ciclo de paginação de DOCUMENTOS.");
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum resultado parcial foi disponibilizado.");
}

/** Loading publishes a frozen snapshot after the full schema and base validate. */
export function createDocumentControlReportData({ tokenProvider, repository: suppliedRepository, includeAttachmentTarget = false } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o controle de documentos.");
  }
  async function loadSnapshot({ signal: externalSignal } = {}) {
    abortIfNeeded(externalSignal);
    const controller = new AbortController(); const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const repository = suppliedRepository || createSharePointRepository(createGraphClient(
        scopes => abortable(() => tokenProvider(scopes, { signal }), signal),
      ), SHAREPOINT_SITES);
      const listId = await resolveDocumentList(repository, signal);
      const documents = await loadRows(repository, listId, signal);
      abortIfNeeded(signal);
      const snapshot = normalizeDocumentControlSnapshot({ documents });
      return includeAttachmentTarget ? Object.freeze({ ...snapshot, attachmentListId: listId }) : snapshot;
    } catch (error) {
      controller.abort(error); throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abort);
    }
  }
  async function uploadAttachments(listId, id, files, { signal = new AbortController().signal } = {}) {
    abortIfNeeded(signal);
    if (typeof listId !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(listId)
      || !Number.isSafeInteger(id) || id < 1) throw new Error("O destino do anexo é inválido. Atualize o relatório.");
    const selected = Array.from(files, file => {
      const name = validateAttachment(file).normalize("NFC");
      if (/[\\/\u0000-\u001f]/.test(name) || typeof file.arrayBuffer !== "function") {
        throw new Error("O nome ou o conteúdo do arquivo é inválido.");
      }
      return { name, file };
    });
    if (!selected.length) return 0;

    const guardedToken = scopes => abortable(() => tokenProvider(scopes, { signal }), signal);
    const transport = suppliedRepository ? null : createSharePointAttachmentTransport({
      tokenProvider: guardedToken, allowedSites: [SHAREPOINT_SITES[SITE]],
    });
    // Use the same delegated SharePoint write grant for reads during this upload.
    const repository = suppliedRepository || createSharePointRepository(createGraphClient(guardedToken), SHAREPOINT_SITES, {
      attachmentTransport: {
        request: (site, path, options) => transport.request(site, path, { ...options, permission: "write" }),
      },
    });
    const columns = validateSchema(await abortable(() => repository.getColumns(SITE, listId, { signal }), signal));
    const current = await abortable(() => repository.getItem(SITE, listId, id, `$expand=fields($select=${columns.status})`, { signal }), signal);
    if (String(current?.id) !== String(id) || String(scalar(current?.fields?.[columns.status])).trim().toUpperCase() !== "PENDENTE") {
      throw new Error("O documento precisa estar pendente para receber anexos. Atualize o relatório.");
    }

    const existing = await abortable(() => repository.listAttachments(SITE, listId, id, {
      signal, requireCollection: true, namesOnly: true,
    }), signal);
    const names = new Map(existing.map(file => [file.name.normalize("NFC").toLowerCase(), file.name]));
    let saved = 0;
    for (const { file, name } of selected) {
      try {
        const key = name.toLowerCase();
        if (names.has(key)) {
          const [uploaded, local] = await abortable(() => Promise.all([
            repository.downloadAttachment(SITE, listId, id, names.get(key), { signal }), file.arrayBuffer(),
          ]), signal);
          const bytes = new Uint8Array(local);
          const remote = new Uint8Array(uploaded);
          if (bytes.length !== remote.length || !bytes.every((byte, index) => byte === remote[index])) {
            throw new Error(`Já existe um anexo chamado "${name}". Renomeie o arquivo para enviar outra versão.`);
          }
        } else {
          await abortable(() => repository.uploadAttachment(SITE, listId, id, file, name, { signal }), signal);
          names.set(key, name);
        }
        saved++;
      } catch (error) {
        if (!saved || signal.aborted) throw error;
        throw new Error(`${saved} de ${selected.length} arquivos confirmados. ${error.message}`, { cause: error });
      }
    }
    return saved;
  }

  return Object.freeze({ loadSnapshot, uploadAttachments });
}

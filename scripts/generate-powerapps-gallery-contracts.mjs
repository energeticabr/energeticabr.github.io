import { readdir, readFile, writeFile } from "node:fs/promises";
import { generatedTextMatches } from "./generated-text-normalization.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE_DIR = join(
  ROOT,
  "..",
  "_tmp",
  "powerapps-ui-inventory-20260826-1501",
  "ENERGETICA-current",
  "Src",
);
const DEFAULT_OUTPUT_PATH = join(ROOT, "portal", "catalog", "powerapps-gallery-contracts.generated.js");
const DEFAULT_DOCUMENTATION_PATH = join(ROOT, "docs", "analysis", "powerapps-gallery-field-parity.md");
const SOURCE_LABEL = "_tmp/powerapps-ui-inventory-20260826-1501/ENERGETICA-current/Src";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decodeYamlScalar(value) {
  const source = String(value || "").trim();
  if (source.startsWith("\"") && source.endsWith("\"")) {
    try {
      return JSON.parse(source);
    } catch {
      return source;
    }
  }
  if (source.startsWith("'") && source.endsWith("'")) {
    return source.slice(1, -1).replace(/''/g, "'");
  }
  return source;
}

function readBlockValue(lines, startLine, propertyIndent, marker) {
  const raw = [];
  let nextLine = startLine;
  while (nextLine < lines.length) {
    const line = lines[nextLine];
    const indent = line.match(/^\s*/)?.[0].length || 0;
    if (line.trim() && indent <= propertyIndent) break;
    raw.push(line);
    nextLine += 1;
  }

  const meaningful = raw.filter(line => line.trim());
  const commonIndent = meaningful.length
    ? Math.min(...meaningful.map(line => line.match(/^\s*/)?.[0].length || 0))
    : propertyIndent + 2;
  let literal = raw.map(line => line.slice(Math.min(commonIndent, line.length))).join("\n");
  if (raw.length) literal += "\n";
  if (marker.endsWith("-")) literal = literal.replace(/\n+$/, "");
  else if (!marker.endsWith("+")) literal = `${literal.replace(/\n+$/, "")}\n`;

  return { literal, nextLine };
}

function parsePowerAppsYaml(content, fileName) {
  const lines = String(content || "").split(/\r?\n/);
  const components = [];
  const stack = [];
  let screenName = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const screenMatch = line.match(/^ {2}(\S.*):\s*$/);
    if (screenMatch) screenName = decodeYamlScalar(screenMatch[1]);

    const componentMatch = line.match(/^(\s*)-\s+(.+):\s*$/);
    if (componentMatch) {
      const indent = componentMatch[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const component = {
        fileName,
        screenName,
        name: decodeYamlScalar(componentMatch[2]),
        indent,
        lineNumber: index + 1,
        parent: stack.at(-1) || null,
        properties: {},
      };
      components.push(component);
      stack.push(component);
      continue;
    }

    const propertyMatch = line.match(/^(\s*)([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!propertyMatch || !stack.length || propertyMatch[1].length <= stack.at(-1).indent) continue;
    const propertyName = propertyMatch[2];
    const marker = propertyMatch[3].trim();
    let literal;
    if (/^\|[+-]?$/.test(marker)) {
      const block = readBlockValue(lines, index + 1, propertyMatch[1].length, marker);
      literal = block.literal;
      index = block.nextLine - 1;
    } else {
      literal = decodeYamlScalar(propertyMatch[3]);
    }
    stack.at(-1).properties[propertyName] = {
      lineNumber: index + 1,
      literal,
    };
  }

  return components;
}

function controlType(component) {
  return String(component?.properties?.Control?.literal || "").split("@")[0];
}

function nearestGallery(component) {
  let parent = component?.parent;
  while (parent) {
    if (controlType(parent) === "Gallery") return parent;
    parent = parent.parent;
  }
  return null;
}

function formulaState(component, propertyName) {
  const property = component?.properties?.[propertyName];
  if (!property) return { status: "not-declared", literal: null };
  const body = String(property.literal || "").trim().replace(/^=/, "").trim();
  if (!body) {
    return {
      status: "unresolved",
      literal: property.literal,
      reason: "blank-formula",
    };
  }
  return { status: "resolved", literal: property.literal };
}

function formulaBoolean(literal) {
  const value = String(literal || "").trim().replace(/^=/, "").trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function effectiveVisibility(component, gallery) {
  const lineage = [];
  let current = component;
  while (current && current !== gallery) {
    lineage.unshift(current);
    current = current.parent;
  }

  const conditions = [];
  for (const owner of lineage) {
    const visible = owner.properties.Visible;
    if (!visible || formulaBoolean(visible.literal) === true) continue;
    if (formulaBoolean(visible.literal) === false) return { status: "never", conditions: [] };
    conditions.push({ controlName: owner.name, literal: visible.literal });
  }
  return conditions.length
    ? { status: "conditional", conditions }
    : { status: "always", conditions: [] };
}

function powerFxCodeMask(literal) {
  const source = String(literal || "");
  const masked = source.split("");
  let state = "code";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "string") {
      if (char !== "\n" && char !== "\r") masked[index] = " ";
      if (char === "\"" && next === "\"") {
        masked[index + 1] = " ";
        index += 1;
      } else if (char === "\"") {
        state = "code";
      }
      continue;
    }
    if (state === "identifier") {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") state = "code";
      continue;
    }
    if (state === "line-comment") {
      if (char === "\n") state = "code";
      else if (char !== "\r") masked[index] = " ";
      continue;
    }
    if (state === "block-comment") {
      if (char !== "\n" && char !== "\r") masked[index] = " ";
      if (char === "*" && next === "/") {
        masked[index + 1] = " ";
        state = "code";
        index += 1;
      }
      continue;
    }
    if (char === "\"") {
      masked[index] = " ";
      state = "string";
    } else if (char === "'") {
      state = "identifier";
    } else if (char === "/" && next === "/") {
      masked[index] = " ";
      masked[index + 1] = " ";
      state = "line-comment";
      index += 1;
    } else if (char === "/" && next === "*") {
      masked[index] = " ";
      masked[index + 1] = " ";
      state = "block-comment";
      index += 1;
    }
  }
  return masked.join("");
}

function thisItemReferences(literal) {
  const source = String(literal || "");
  const code = powerFxCodeMask(source);
  const references = [];
  const seen = new Set();
  const pattern = /ThisItem\s*\.\s*(?:'((?:''|[^'])+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*))/giu;
  let match;
  while ((match = pattern.exec(code))) {
    const fieldName = (match[1] || match[2] || "").replace(/''/g, "'");
    if (/^IsSelected$/i.test(fieldName)) continue;
    const reference = {
      fieldName,
      literal: source.slice(match.index, pattern.lastIndex),
    };
    const key = JSON.stringify(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(reference);
  }
  return references;
}

function powerFxStringLiterals(literal) {
  const source = String(literal || "");
  const values = [];
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "identifier") {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") state = "code";
      continue;
    }
    if (state === "line-comment") {
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (char === "'") {
      state = "identifier";
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (char !== "\"") continue;
    let value = "";
    let closed = false;
    index += 1;
    while (index < source.length) {
      if (source[index] !== "\"") {
        value += source[index];
        index += 1;
        continue;
      }
      if (source[index + 1] === "\"") {
        value += "\"";
        index += 2;
        continue;
      }
      closed = true;
      break;
    }
    if (closed && !values.includes(value)) values.push(value);
  }
  return values;
}

function findClosingParenthesis(source, openIndex) {
  let depth = 0;
  let state = "code";
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "string") {
      if (char === "\"" && next === "\"") index += 1;
      else if (char === "\"") state = "code";
      continue;
    }
    if (state === "identifier") {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") state = "code";
      continue;
    }
    if (state === "line-comment") {
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (char === "\"") state = "string";
    else if (char === "'") state = "identifier";
    else if (char === "/" && next === "/") {
      state = "line-comment";
      index += 1;
    } else if (char === "/" && next === "*") {
      state = "block-comment";
      index += 1;
    } else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function powerFxCalls(literal, acceptedNames) {
  const source = String(literal || "");
  const accepted = new Set(acceptedNames.map(name => name.toLowerCase()));
  const calls = [];
  const seen = new Set();
  let state = "code";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "string") {
      if (char === "\"" && next === "\"") index += 1;
      else if (char === "\"") state = "code";
      continue;
    }
    if (state === "identifier") {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") state = "code";
      continue;
    }
    if (state === "line-comment") {
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (char === "\"") {
      state = "string";
      continue;
    }
    if (char === "'") {
      state = "identifier";
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (!/[A-Za-z_]/.test(char)) continue;

    const nameMatch = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    const name = nameMatch?.[0] || "";
    if (!accepted.has(name.toLowerCase())) {
      index += Math.max(0, name.length - 1);
      continue;
    }
    let openIndex = index + name.length;
    while (/\s/.test(source[openIndex] || "")) openIndex += 1;
    if (source[openIndex] !== "(") {
      index += name.length - 1;
      continue;
    }
    const closeIndex = findClosingParenthesis(source, openIndex);
    if (closeIndex < 0) continue;
    const call = source.slice(index, closeIndex + 1);
    if (!seen.has(call)) {
      seen.add(call);
      calls.push(call);
    }
    index += name.length - 1;
  }
  return calls;
}

function callState(itemsState, names) {
  if (itemsState.status !== "resolved") {
    return { status: "unresolved", literals: [], reason: "items-not-resolved" };
  }
  const literals = powerFxCalls(itemsState.literal, names);
  return literals.length
    ? { status: "resolved", literals }
    : { status: "not-declared", literals: [] };
}

function actionKind(onSelect) {
  const normalized = String(onSelect || "")
    .trim()
    .replace(/^=/, "")
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
  return /^Select\s*\(\s*Parent\s*\)$/i.test(normalized) ? "select-parent" : "action";
}

function orderedUnique(values) {
  return [...new Set(values)];
}

function buildGalleryContract(gallery, components) {
  const descendants = components.filter(component => (
    component !== gallery
    && controlType(component) !== "Gallery"
    && nearestGallery(component) === gallery
  ));
  const items = formulaState(gallery, "Items");
  const defaultFormula = formulaState(gallery, "Default");
  const galleryOnSelect = formulaState(gallery, "OnSelect");
  const visibleControls = [];

  for (const component of descendants) {
    const visibility = effectiveVisibility(component, gallery);
    if (visibility.status === "never") continue;
    for (const displayProperty of ["Text", "HtmlText", "Image"]) {
      const display = component.properties[displayProperty];
      if (!display) continue;
      visibleControls.push({
        controlName: component.name,
        controlType: controlType(component),
        lineNumber: component.lineNumber,
        displayProperty,
        displayLiteral: display.literal,
        visibility,
        fieldReferences: thisItemReferences(display.literal),
        textLiterals: powerFxStringLiterals(display.literal),
      });
    }
  }

  const actions = descendants
    .filter(component => component.properties.OnSelect)
    .filter(component => effectiveVisibility(component, gallery).status !== "never")
    .map(component => ({
      controlName: component.name,
      controlType: controlType(component),
      lineNumber: component.lineNumber,
      kind: actionKind(component.properties.OnSelect.literal),
      onSelect: component.properties.OnSelect.literal,
      visibility: effectiveVisibility(component, gallery),
    }));
  const parentSelectors = actions
    .filter(action => action.kind === "select-parent")
    .map(action => ({ controlName: action.controlName, onSelect: action.onSelect }));
  const indicators = descendants.flatMap(component => Object.entries(component.properties)
    .filter(([, property]) => /ThisItem\s*\.\s*IsSelected/i.test(property.literal))
    .map(([propertyName, property]) => ({
      controlName: component.name,
      propertyName,
      literal: property.literal,
    })));

  return {
    fileName: gallery.fileName,
    screenName: gallery.screenName,
    galleryName: gallery.name,
    lineNumber: gallery.lineNumber,
    control: gallery.properties.Control.literal,
    variant: gallery.properties.Variant?.literal || null,
    formulas: {
      items,
      default: defaultFormula,
      sort: callState(items, ["Sort", "SortByColumns"]),
      filter: callState(items, ["Filter"]),
    },
    visibleControls,
    visibleFields: orderedUnique(visibleControls.flatMap(control => (
      control.fieldReferences.map(reference => reference.fieldName)
    ))),
    visibleLabels: orderedUnique(visibleControls.flatMap(control => control.textLiterals)),
    actions,
    primaryAction: galleryOnSelect.status === "resolved"
      ? {
        status: "resolved",
        controlName: gallery.name,
        onSelect: galleryOnSelect.literal,
      }
      : {
        status: "unresolved",
        reason: "gallery-onselect-not-resolved",
      },
    selection: {
      default: defaultFormula,
      onSelect: galleryOnSelect,
      parentSelectors,
      indicators,
    },
    binding: {
      portalEntity: {
        status: "unresolved",
        reason: "Gallery YAML does not prove a portal entity mapping.",
      },
      sharePointList: {
        status: "unresolved",
        reason: "Gallery YAML does not prove an authoritative SharePoint list mapping.",
      },
    },
  };
}

export function extractPowerAppsGalleryContracts(files) {
  const orderedFiles = [...(files || [])].sort((left, right) => compareText(
    String(left.fileName || ""),
    String(right.fileName || ""),
  ));
  const galleries = [];
  for (const file of orderedFiles) {
    const components = parsePowerAppsYaml(file.content, file.fileName);
    for (const gallery of components.filter(component => controlType(component) === "Gallery")) {
      galleries.push(buildGalleryContract(gallery, components));
    }
  }
  galleries.sort((left, right) => (
    compareText(left.fileName, right.fileName)
    || compareText(left.screenName, right.screenName)
    || compareText(left.galleryName, right.galleryName)
    || left.lineNumber - right.lineNumber
  ));

  return {
    schemaVersion: 1,
    source: {
      inventory: SOURCE_LABEL,
      fileCount: orderedFiles.length,
      galleryFileCount: new Set(galleries.map(gallery => gallery.fileName)).size,
      screenCount: new Set(galleries.map(gallery => gallery.screenName)).size,
      galleryCount: galleries.length,
    },
    galleries,
  };
}

export async function extractPowerAppsGalleryContractsFromDirectory(sourceDir) {
  const fileNames = (await readdir(sourceDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith(".pa.yaml"))
    .map(entry => entry.name)
    .sort(compareText);
  const files = await Promise.all(fileNames.map(async fileName => ({
    fileName,
    content: await readFile(join(sourceDir, fileName), "utf8"),
  })));
  return extractPowerAppsGalleryContracts(files);
}

export function renderPowerAppsGalleryContracts(result) {
  return [
    "// Generated by scripts/generate-powerapps-gallery-contracts.mjs.",
    `// Source: ${SOURCE_LABEL}`,
    "",
    "function deepFreeze(value) {",
    "  if (!value || typeof value !== \"object\" || Object.isFrozen(value)) return value;",
    "  for (const child of Object.values(value)) deepFreeze(child);",
    "  return Object.freeze(value);",
    "}",
    "",
    `const POWERAPPS_GALLERY_CONTRACTS = deepFreeze(${JSON.stringify(result, null, 2)});`,
    "",
    "export { POWERAPPS_GALLERY_CONTRACTS };",
    "export default POWERAPPS_GALLERY_CONTRACTS;",
    "",
  ].join("\n");
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function formulaSummary(formula) {
  if (Array.isArray(formula?.literals)) {
    return formula.status === "resolved" ? `resolved (${formula.literals.length})` : formula.status;
  }
  return formula?.status || "unresolved";
}

export function renderPowerAppsGalleryFieldParity(result) {
  const galleries = result?.galleries || [];
  const source = result?.source || {};
  const count = predicate => galleries.filter(predicate).length;
  const uniqueFields = new Set(galleries.flatMap(gallery => gallery.visibleFields));
  const visibleControlCount = galleries.reduce((total, gallery) => total + gallery.visibleControls.length, 0);
  const actionCount = galleries.reduce((total, gallery) => total + gallery.actions.length, 0);
  const selectionIndicatorCount = galleries.reduce((total, gallery) => (
    total + gallery.selection.indicators.length
  ), 0);
  const lines = [
    "# Paridade de campos de Gallery: Power Apps",
    "",
    "> Gerado por `scripts/generate-powerapps-gallery-contracts.mjs`. Não editar manualmente.",
    "",
    "## Fonte e cobertura",
    "",
    `- Fonte examinada: \`D:\\CodexData\\${SOURCE_LABEL.replace(/\//g, "\\")}\`.`,
    `- Foram lidos ${source.fileCount} arquivos \`.pa.yaml\`; ${source.galleryCount} Galleries aparecem em ${source.screenCount} telas/arquivos com Gallery.`,
    `- Identidades de tela/Gallery: ${source.galleryCount} de ${source.galleryCount} extraídas sem duplicação.`,
    `- \`Items\`: ${count(gallery => gallery.formulas.items.status === "resolved")} resolved.`,
    `- \`Default\`: ${count(gallery => gallery.formulas.default.status === "resolved")} resolved; ${count(gallery => gallery.formulas.default.status === "not-declared")} not-declared; ${count(gallery => gallery.formulas.default.status === "unresolved")} unresolved.`,
    `- Chamadas de ordenação em \`Items\`: ${count(gallery => gallery.formulas.sort.status === "resolved")} Galleries; chamadas de \`Filter\`: ${count(gallery => gallery.formulas.filter.status === "resolved")} Galleries.`,
    `- Exibição comprovável: ${visibleControlCount} ocorrências de controle e ${uniqueFields.size} referências de campo \`ThisItem\` distintas.`,
    `- Interação: ${actionCount} \`OnSelect\` filhos, ${count(gallery => gallery.primaryAction.status === "resolved")} ações principais resolvidas e ${selectionIndicatorCount} indicadores de seleção.`,
    "",
    "## Semântica do contrato",
    "",
    "- `literal` preserva o valor Power Fx decodificado do YAML, incluindo quebras de linha e o indicador inicial `=`.",
    "- `Sort` cobre chamadas literais `Sort(...)` e `SortByColumns(...)` encontradas em `Items`; `Filter` cobre chamadas literais `Filter(...)`.",
    "- `visibleControls` inclui propriedades `Text`, `HtmlText` e `Image` de descendentes cuja visibilidade não é comprovadamente falsa. Condições de visibilidade permanecem literais.",
    "- `visibleFields` vem exclusivamente de referências literais `ThisItem.Campo` ou `ThisItem.'Campo'`; `visibleLabels` preserva strings Power Fx sem classificá-las semanticamente.",
    "- `actions` registra todo `OnSelect` filho visível ou condicional. `primaryAction` só é `resolved` quando a própria Gallery declara `OnSelect`.",
    "- `selection` registra `Default`, `OnSelect` da Gallery, filhos que executam `Select(Parent)` e propriedades que referenciam `ThisItem.IsSelected`.",
    "- `binding.portalEntity` e `binding.sharePointList` permanecem `unresolved` em todas as Galleries: o YAML isolado não prova o mapeamento autoritativo para entidade do portal ou lista SharePoint.",
    "",
    "## Matriz das Galleries",
    "",
    "| # | Arquivo | Tela | Gallery | Linha | Items | Default | Sort | Filter | Campos visíveis comprovados | Labels | OnSelect filhos | Ação principal | Seleção | Entidade/lista |",
    "|---:|---|---|---|---:|---|---|---|---|---|---:|---:|---|---|---|",
  ];

  galleries.forEach((gallery, index) => {
    const fields = gallery.visibleFields.length ? gallery.visibleFields.join(", ") : "—";
    const selection = [
      `Default ${gallery.selection.default.status}`,
      `OnSelect ${gallery.selection.onSelect.status}`,
      `Select(Parent) ${gallery.selection.parentSelectors.length}`,
      `indicadores ${gallery.selection.indicators.length}`,
    ].join("; ");
    lines.push([
      `| ${index + 1}`,
      markdownCell(gallery.fileName),
      markdownCell(gallery.screenName),
      markdownCell(gallery.galleryName),
      gallery.lineNumber,
      formulaSummary(gallery.formulas.items),
      formulaSummary(gallery.formulas.default),
      formulaSummary(gallery.formulas.sort),
      formulaSummary(gallery.formulas.filter),
      markdownCell(fields),
      gallery.visibleLabels.length,
      gallery.actions.length,
      gallery.primaryAction.status,
      selection,
      "unresolved / unresolved |",
    ].join(" | "));
  });

  lines.push(
    "",
    "## Reprodução",
    "",
    "```powershell",
    "node scripts/generate-powerapps-gallery-contracts.mjs",
    "node scripts/generate-powerapps-gallery-contracts.mjs --check",
    "```",
    "",
    "A fonte pode ser substituida por `--source <diretorio>` ou `POWERAPPS_SOURCE_DIR`. `--output` e `--documentation` permitem validar destinos temporarios sem alterar os arquivos versionados.",
    "",
    "## Limitações",
    "",
    "- A análise é estática. Coleções, aliases, componentes, variáveis e resultados de funções podem exibir dados sem uma referência literal `ThisItem`; nesses casos a fórmula continua preservada no controle, mas nenhum campo é inventado.",
    "- Visibilidade condicional é registrada como `conditional`, sem tentar avaliar estado de usuário, variáveis, permissões ou dados em tempo de execução. Controles comprovadamente `Visible = false` não entram em `visibleControls` nem em `actions`.",
    "- Strings de `Text`/`HtmlText` podem representar labels, valores, formatos ou mensagens. O contrato as chama de `visibleLabels` apenas como evidência literal, sem inferir função semântica.",
    "- A extração de `Sort`/`SortByColumns` e `Filter` é sintática e preserva todas as chamadas encontradas em `Items`; ela não executa nem simplifica Power Fx.",
    "- Ações de controles filhos não são promovidas a ação principal por heurística. Sem `Gallery.OnSelect`, `primaryAction` fica `unresolved` mesmo quando há ícones de editar, excluir ou navegar.",
    "- Nenhum nome de fonte presente em `Items` é convertido automaticamente em entidade do portal ou lista SharePoint. Essa paridade exige evidência externa ao YAML e permanece explicitamente `unresolved` neste artefato.",
    "",
  );
  return lines.join("\n");
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : fallback;
}

async function main() {
  const sourceDir = optionValue("--source", process.env.POWERAPPS_SOURCE_DIR || DEFAULT_SOURCE_DIR);
  const outputPath = optionValue("--output", DEFAULT_OUTPUT_PATH);
  const documentationPath = optionValue("--documentation", DEFAULT_DOCUMENTATION_PATH);
  const result = await extractPowerAppsGalleryContractsFromDirectory(sourceDir);
  const output = renderPowerAppsGalleryContracts(result);
  const documentation = renderPowerAppsGalleryFieldParity(result);
  if (process.argv.includes("--check")) {
    const [currentOutput, currentDocumentation] = await Promise.all([
      readFile(outputPath, "utf8").catch(() => ""),
      readFile(documentationPath, "utf8").catch(() => ""),
    ]);
    if (!generatedTextMatches(currentOutput, output) || !generatedTextMatches(currentDocumentation, documentation)) {
      process.stderr.write("Power Apps gallery contracts are out of date.\n");
      process.exitCode = 1;
    }
    return;
  }
  await Promise.all([
    writeFile(outputPath, output, "utf8"),
    writeFile(documentationPath, documentation, "utf8"),
  ]);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) await main();

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { ENTITIES } from "../portal/catalog/entities.js";
import { POWERAPPS_FORM_VARIANTS } from "../portal/catalog/powerapps-form-controls.generated.js";
import {
  buildPowerAppsGalleryUiContracts,
} from "../portal/catalog/powerapps-gallery-ui-contract.js";
import { POWERAPPS_ARTIFACTS } from "../portal/catalog/powerapps-matrix.js";
import { PORTAL_ROUTES } from "../portal/core/router.js";
import {
  extractPowerAppsGalleryContractsFromDirectory,
} from "./generate-powerapps-gallery-contracts.mjs";

export const DEFAULT_POWERAPPS_GALLERY_SOURCE_DIR =
  "D:/CodexData/_tmp/powerapps-parity-20260905/ENERGETICA-current/Src";

export const DEFAULT_GALLERY_COVERAGE_EXCLUSIONS = Object.freeze([
  Object.freeze({
    label: "Tickets",
    entityId: "tickets-clientes",
    sources: Object.freeze(["TICKETS CLIENTES"]),
  }),
  Object.freeze({
    label: "Movimentacoes",
    entityId: "movimentacoes-de-ticket",
    sources: Object.freeze(["TICKET MOVIMENTACOES"]),
  }),
]);

function galleryIdentity(value = {}) {
  const identity = value.identity || value;
  return [identity.fileName, identity.galleryName].map(part => String(part || "")).join("#");
}

function canonical(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

function exclusionFor(contract, exclusions) {
  const entityId = String(contract?.binding?.entityId || "");
  const source = canonical(contract?.binding?.source);
  return exclusions.find(exclusion => (
    exclusion.entityId === entityId
    || exclusion.sources.some(candidate => canonical(candidate) === source)
  ));
}

function splitTopLevelStatements(literal) {
  const formula = String(literal || "")
    .replace(/^\s*=/, "")
    .replace(/\/\/[^\r\n]*/g, "");
  const statements = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < formula.length; index += 1) {
    const character = formula[index];
    if (quote) {
      if (character === quote && formula[index + 1] === quote) index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === ";" && depth === 0) {
      const statement = formula.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const statement = formula.slice(start).trim();
  if (statement) statements.push(statement);
  return statements;
}

function actionFamily(literal) {
  const names = splitTopLevelStatements(literal)
    .map(statement => statement.match(/^([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*)\s*\(/u)?.[1])
    .filter(Boolean);
  return [...new Set(names)].join("+") || "other";
}

function editFormNames(literal) {
  const names = [];
  const pattern = /\bEditForm\s*\(\s*(?:'((?:''|[^'])+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_.]*))\s*\)/giu;
  let match;
  while ((match = pattern.exec(String(literal || "")))) {
    names.push(String(match[1] || match[2]).replace(/''/g, "'"));
  }
  return names;
}

function entityRouteAvailable(routes) {
  return (routes || []).some(route => (
    route?.name === "entity"
    && Array.isArray(route.pattern)
    && route.pattern.includes(":entityId")
  ));
}

function auditRow(gallery, contract, options) {
  const binding = contract?.binding || { status: "unresolved", reason: "ui-contract-not-found" };
  const entity = binding.status === "resolved"
    ? options.entityById.get(binding.entityId)
    : null;
  const translatedByControl = new Map(
    (contract?.actions?.values || [])
      .filter(action => action.kind !== "select")
      .map(action => [action.controlName, action]),
  );
  const unresolvedByControl = new Map(
    (contract?.actions?.unresolved || []).map(action => [action.controlName, action]),
  );
  const commands = (gallery.actions || [])
    .filter(action => action.kind === "action")
    .map(action => ({
      fileName: gallery.fileName,
      screenName: gallery.screenName,
      galleryName: gallery.galleryName,
      entityId: binding.entityId || null,
      source: binding.source || null,
      controlName: action.controlName,
      family: actionFamily(action.onSelect),
      evidence: action.onSelect,
      translated: translatedByControl.has(action.controlName),
      translatedAction: translatedByControl.get(action.controlName) || null,
      reason: unresolvedByControl.get(action.controlName)?.reason
        || (translatedByControl.has(action.controlName) ? null : "action-not-covered"),
    }));
  const formReferences = commands.flatMap(command => (
    editFormNames(command.evidence).map(formName => {
      const entityVariants = options.formVariants[binding.entityId] || [];
      const matches = entityVariants.filter(variant => (
        variant.formName === formName
      ));
      const crossEntityMatches = options.allFormVariants
        .filter(entry => entry.entityId !== binding.entityId && entry.variant.formName === formName)
        .map(entry => ({
          entityId: entry.entityId,
          id: entry.variant.id,
          fileName: entry.variant.fileName,
          dataSource: entry.variant.dataSource,
        }));
      const recoveryCandidates = matches.length === 0 && crossEntityMatches.length > 0
        ? entityVariants.filter(variant => (
          variant.mode === "edit" || variant.modes?.includes?.("edit")
        ))
        : [];
      const recovered = recoveryCandidates.length === 1;
      return {
        fileName: gallery.fileName,
        screenName: gallery.screenName,
        galleryName: gallery.galleryName,
        entityId: binding.entityId || null,
        source: binding.source || null,
        controlName: command.controlName,
        formName,
        covered: matches.length === 1 || recovered,
        recovered,
        reason: recovered
          ? "cross-entity-reference-recovered-by-entity-form"
          : matches.length === 0
            ? crossEntityMatches.length
            ? "form-contract-owned-by-other-entity"
            : "exact-form-contract-not-found"
          : matches.length > 1
            ? "exact-form-contract-ambiguous"
            : null,
        matchingVariantIds: matches.map(variant => variant.id),
        recoveredVariantIds: recovered ? recoveryCandidates.map(variant => variant.id) : [],
        crossEntityMatches,
      };
    })
  ));
  return {
    fileName: gallery.fileName,
    screenName: gallery.screenName,
    galleryName: gallery.galleryName,
    binding,
    entity,
    hasEntityRoute: Boolean(entity && options.hasEntityRoute && entity.available !== false),
    commands,
    formReferences,
  };
}

export function buildPowerAppsGalleryCoverageAudit({
  galleryCatalog,
  uiCatalog,
  entities = ENTITIES,
  routes = PORTAL_ROUTES,
  formVariants = POWERAPPS_FORM_VARIANTS,
  exclusions = DEFAULT_GALLERY_COVERAGE_EXCLUSIONS,
} = {}) {
  const galleries = Array.isArray(galleryCatalog?.galleries) ? galleryCatalog.galleries : [];
  const contracts = Array.isArray(uiCatalog?.galleries) ? uiCatalog.galleries : [];
  const contractByIdentity = new Map(contracts.map(contract => [galleryIdentity(contract), contract]));
  const entityById = new Map((entities || []).map(entity => [entity.id, entity]));
  const options = {
    entityById,
    formVariants: formVariants || {},
    allFormVariants: Object.entries(formVariants || {}).flatMap(([entityId, variants]) => (
      (variants || []).map(variant => ({ entityId, variant }))
    )),
    hasEntityRoute: entityRouteAvailable(routes),
  };
  const rows = galleries.map(gallery => auditRow(
    gallery,
    contractByIdentity.get(galleryIdentity(gallery)),
    options,
  ));
  const excluded = [];
  const inScope = [];
  for (const row of rows) {
    const exclusion = exclusionFor({ binding: row.binding }, exclusions);
    if (exclusion) {
      excluded.push({
        fileName: row.fileName,
        screenName: row.screenName,
        galleryName: row.galleryName,
        entityId: row.binding.entityId,
        source: row.binding.source,
        exclusion: exclusion.label,
      });
    } else {
      inScope.push(row);
    }
  }

  const sharePoint = inScope.filter(row => row.binding.status === "resolved" && row.binding.source);
  const entityLinked = sharePoint.filter(row => row.entity);
  const routeLinked = entityLinked.filter(row => row.hasEntityRoute);
  const unbound = inScope.filter(row => row.binding.status !== "resolved");
  const missingEntities = sharePoint.filter(row => !row.entity);
  const missingRoutes = entityLinked.filter(row => !row.hasEntityRoute);
  const commands = sharePoint.flatMap(row => row.commands);
  const commandGaps = commands.filter(command => !command.translated);
  const forms = sharePoint.flatMap(row => row.formReferences);
  const formGaps = forms.filter(form => !form.covered);
  const recoveredForms = forms.filter(form => form.recovered);

  return {
    source: {
      inventory: galleryCatalog?.source?.inventory || null,
      declaredGalleryCount: galleryCatalog?.source?.galleryCount ?? null,
    },
    exclusions: exclusions.map(exclusion => ({
      label: exclusion.label,
      entityId: exclusion.entityId,
      sources: [...exclusion.sources],
    })),
    counts: {
      rawGalleries: rows.length,
      excludedGalleries: excluded.length,
      inScopeGalleries: inScope.length,
      sharePointGalleries: sharePoint.length,
      sharePointEntities: new Set(sharePoint.map(row => row.binding.entityId)).size,
      entityLinkedGalleries: entityLinked.length,
      routeLinkedGalleries: routeLinked.length,
      entityRoutes: new Set(routeLinked.map(row => row.binding.entityId)).size,
      unboundGalleries: unbound.length,
      missingEntities: missingEntities.length,
      missingRoutes: missingRoutes.length,
      commandControls: commands.length,
      translatedCommandControls: commands.length - commandGaps.length,
      commandGaps: commandGaps.length,
      formReferences: forms.length,
      coveredFormReferences: forms.length - formGaps.length,
      recoveredFormReferences: recoveredForms.length,
      formGaps: formGaps.length,
    },
    excluded,
    gaps: {
      bindings: unbound.map(row => ({
        fileName: row.fileName,
        screenName: row.screenName,
        galleryName: row.galleryName,
        reason: row.binding.reason || "binding-unresolved",
      })),
      entities: missingEntities.map(row => ({
        fileName: row.fileName,
        galleryName: row.galleryName,
        entityId: row.binding.entityId,
        source: row.binding.source,
      })),
      routes: missingRoutes.map(row => ({
        fileName: row.fileName,
        galleryName: row.galleryName,
        entityId: row.binding.entityId,
      })),
      commands: commandGaps,
      forms: formGaps,
    },
    recoveries: {
      forms: recoveredForms,
    },
  };
}

export async function auditPowerAppsGalleryCoverage(sourceDir = (
  process.env.POWERAPPS_SOURCE_DIR || DEFAULT_POWERAPPS_GALLERY_SOURCE_DIR
)) {
  const galleryCatalog = await extractPowerAppsGalleryContractsFromDirectory(sourceDir);
  const uiCatalog = buildPowerAppsGalleryUiContracts({
    galleryCatalog,
    artifacts: POWERAPPS_ARTIFACTS,
  });
  return buildPowerAppsGalleryCoverageAudit({ galleryCatalog, uiCatalog });
}

function renderSummary(audit) {
  const { counts } = audit;
  const lines = [
    `Snapshot: ${audit.source.inventory}`,
    `Galerias: ${counts.rawGalleries} brutas; ${counts.excludedGalleries} excluidas; ${counts.inScopeGalleries} no escopo.`,
    `SharePoint: ${counts.sharePointGalleries} galerias em ${counts.sharePointEntities} entidades.`,
    `Portal: ${counts.entityLinkedGalleries} galerias com entidade; ${counts.routeLinkedGalleries} com rota em ${counts.entityRoutes} rotas unicas.`,
    `Vinculo: ${counts.unboundGalleries} sem binding; ${counts.missingEntities} sem entidade; ${counts.missingRoutes} sem rota.`,
    `Comandos: ${counts.translatedCommandControls}/${counts.commandControls} traduzidos; ${counts.commandGaps} lacunas.`,
    `Formularios: ${counts.coveredFormReferences}/${counts.formReferences} cobertos; ${counts.recoveredFormReferences} referencias quebradas recuperadas; ${counts.formGaps} lacunas.`,
    `Exclusoes: ${audit.excluded.map(item => `${item.exclusion} (${item.fileName}#${item.galleryName})`).join("; ") || "nenhuma"}.`,
  ];
  if (audit.gaps.commands.length) {
    lines.push("", "Lacunas de comandos:");
    for (const gap of audit.gaps.commands) {
      lines.push(`- ${gap.fileName}#${gap.galleryName} :: ${gap.controlName} [${gap.family}] (${gap.reason})`);
    }
  }
  if (audit.gaps.forms.length) {
    lines.push("", "Lacunas de formularios:");
    for (const gap of audit.gaps.forms) {
      lines.push(`- ${gap.fileName}#${gap.galleryName} :: ${gap.formName} (${gap.reason})`);
    }
  }
  return lines.join("\n");
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const json = process.argv.includes("--json");
  const sourceDir = process.argv.find(argument => !argument.startsWith("--") && (
    argument !== process.argv[0] && argument !== process.argv[1]
  ));
  const audit = await auditPowerAppsGalleryCoverage(sourceDir);
  process.stdout.write(`${json ? JSON.stringify(audit, null, 2) : renderSummary(audit)}\n`);
}

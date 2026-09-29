const GREETING_PATTERN = /^(?:bom\s+dia|boa\s+tarde|boa\s+noite)\s*[,;:.!-]?\s*/i;
const INFORMAL_ENDING_PATTERN = /(?:^|,\s*|\s+)(?:né|ne|certo|tá bom|ta bom|ok)\s*[.!?]*$/i;

function cleanClause(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—•]+\s*/, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

function removePossessiveMarkers(value) {
  return value
    .replace(/\b(?:meu|minha|meus|minhas|nosso|nossa|nossos|nossas)\s+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeClause(value) {
  let clause = cleanClause(value).replace(GREETING_PATTERN, "").replace(INFORMAL_ENDING_PATTERN, "").trim();
  if (!clause) return "";

  clause = clause
    .replace(/^(?:eu|nós|a gente)\s+(?:estou|estamos)\s+(?:fazendo|realizando|executando)\s+/i, "Em execução: ")
    .replace(/^(?:eu|nós|a gente)\s+(?:vou|vamos)\s+(?:fazer|realizar|executar)\s+/i, "Programado: ")
    .replace(/^(?:eu|nós|a gente)\s+(?:fiz|fizemos|realizei|realizamos|executei|executamos)\s+(?:(?:a|o|as|os)\s+)?/i, "Execução de ")
    .replace(/^(?:eu|nós|a gente)\s+(?:usei|usamos|utilizei|utilizamos)\s+(?:(?:a|o|as|os)\s+)?/i, "Utilização de ")
    .replace(/^(?:eu|nós|a gente)\s+(?:medi|medimos|verifiquei|verificamos|conferi|conferimos)\s+(?:(?:a|o|as|os)\s+)?/i, "Verificação de ")
    .replace(/^(?:eu|nós|a gente)\s+/i, "");

  clause = removePossessiveMarkers(clause);
  return clause ? `${clause.charAt(0).toUpperCase()}${clause.slice(1)}` : "";
}

export function normalizeConstructionDiaryText(value) {
  const source = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";

  const clauses = source
    .split(/\n+|(?<=[.!?])\s+/u)
    .map(normalizeClause)
    .filter(Boolean);

  return clauses.map(clause => `${clause}.`).join(" ").trim();
}

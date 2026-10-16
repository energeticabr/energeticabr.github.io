const nameKey = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLocaleUpperCase("pt-BR").replace(/\s+/g, " ").trim();

// This person does not clock in regularly. Keep the source RHID records intact;
// only omit him from attendance analyses and report selections.
export const isExcludedFromRegularRhidReports = name => nameKey(name) === "BERNARDO NOTINI MOREIRA BAHIA";

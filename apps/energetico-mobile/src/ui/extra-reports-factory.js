export async function createExtraReports({ tokenProvider, document } = {}) {
  if (typeof tokenProvider !== "function" || !document?.createElement) throw new TypeError("Relatórios requerem sessão Microsoft e documento.");
  const [rhData, rhView, operationsData, operationsView, spendingData, spendingView, auditData, auditView, commercialProgressData, commercialProgressView, commercialDocsData, commercialDocsView] = await Promise.all([
    import("../chat/rh-reports-data.js"), import("./rh-reports-view.js"),
    import("../chat/operations-reports-data.js"), import("./operations-reports-view.js"),
    import("../chat/spending-reports-data.js"), import("./spending-reports-view.js"),
    import("../chat/audit-reports-live-data.js"), import("./audit-reports-live-view.js"),
    import("../chat/commercial-progress-reports-data.js"), import("./commercial-progress-reports-view.js"),
    import("../chat/commercial-docs-rent-reports-data.js"), import("./commercial-docs-rent-reports-view.js"),
  ]);
  return [
    { ids: [3, 4, 5], view: rhView.createRhReportsView({ document, data: rhData.createRhReportsData({ tokenProvider }) }) },
    { ids: [6, 7, 8], view: operationsView.createOperationsReportsView({ document, data: operationsData.createOperationsReportsData({ tokenProvider }) }) },
    { ids: [9, 10], view: spendingView.createSpendingReportsView({ document, data: spendingData.createSpendingReportsData({ tokenProvider }) }) },
    { ids: [11, 12, 13], view: auditView.createAuditReportsView({ document, data: auditData.createAuditReportsData({ tokenProvider }) }) },
    { ids: [14, 15], view: commercialProgressView.createCommercialProgressReportsView({ document, data: commercialProgressData.createCommercialProgressReportsData({ tokenProvider }) }) },
    { ids: [16, 17], view: commercialDocsView.createCommercialDocsRentReportsView({ document, data: commercialDocsData.createCommercialDocsRentReportsData({ tokenProvider }) }) },
  ];
}

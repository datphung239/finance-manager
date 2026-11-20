// Characterization extraction from app.js. Keep unchanged until Rust/WASM passes gates.
export function isInitialDataShape(data) {
  return !!data && typeof data === 'object' &&
    Array.isArray(data.cards) && Array.isArray(data.categories) &&
    Array.isArray(data.merchants) && Array.isArray(data.cashCategories) &&
    Array.isArray(data.cashCPCategories) && Array.isArray(data.cashMerchants);
}

export function isCardViewShape(view) {
  const dashboard = view && view.dashboard;
  return !!view && typeof view === 'object' && !!dashboard &&
    typeof dashboard === 'object' && !!dashboard.kpi &&
    typeof dashboard.kpi === 'object' && Array.isArray(dashboard.statements) &&
    !!dashboard.filters && typeof dashboard.filters === 'object' &&
    Array.isArray(view.categoryReport);
}

export function isCashDashboardShape(data) {
  return !!data && typeof data === 'object' && !!data.period &&
    !!data.paymentData && Array.isArray(data.monthTrends) &&
    !!data.ratioTableData && !!data.frequencyData && !!data.dailyData &&
    !!data.targetData && !!data.businessData &&
    Array.isArray(data.businessData.result) &&
    Array.isArray(data.businessData.revenueExpense);
}

export function isBootstrapShape(data) {
  return !!data && isInitialDataShape(data.initialData) && isCardViewShape(data.cardView) &&
    (data.cashDashboard === undefined || isCashDashboardShape(data.cashDashboard));
}

export function isTransactionListShape(list) {
  return Array.isArray(list) && list.every(item => item && typeof item === 'object');
}

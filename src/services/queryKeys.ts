export const queryKeys = {
  bls: {
    all: () => ['bls'] as const,
    list: (filters: unknown) => ['bls', filters] as const,
    containers: (filters: unknown) => ['containers', filters] as const,
    detail: (blId?: string) => (blId === undefined ? (['bl-detail'] as const) : (['bl-detail', blId] as const)),
    cockpit: (blId?: string) => (blId === undefined ? (['bl-cockpit'] as const) : (['bl-cockpit', blId] as const)),
    summary: (filters?: unknown) => (filters === undefined ? (['bl-summary'] as const) : (['bl-summary', filters] as const)),
    portOptions: () => ['port-options'] as const,
    localChargeLines: (blId?: string) =>
      (blId === undefined ? (['bl-local-charge-lines'] as const) : (['bl-local-charge-lines', blId] as const)),
    manualChargeItems: (blId?: string) =>
      (blId === undefined ? (['manual-charge-items'] as const) : (['manual-charge-items', blId] as const)),
    timeline: (blId?: string) => (blId === undefined ? (['bl-timeline'] as const) : (['bl-timeline', blId] as const)),
  },
  invoices: {
    all: () => ['invoices'] as const,
    list: (filters: unknown) => ['invoices', filters] as const,
    detail: (id: number | null | undefined) => ['invoice-detail', id] as const,
    links: (blIds: string[]) => ['invoice-links', blIds.slice().sort().join(',')] as const,
  },
  billingReady: {
    all: () => ['billing-ready-bls'] as const,
    bls: (filters?: unknown) => ['billing-ready-bls', filters] as const,
    diagnostics: (filters?: unknown) => ['billing-ready-bl-diagnostics', filters] as const,
    graniteBls: (filters?: unknown) => ['billing-ready-granite-bls', filters] as const,
    customers: (search: string) => ['billing-customers', search] as const,
  },
  billingLedger: {
    all: () => ['billing-ledger'] as const,
    consolidatableReceivables: (filters?: unknown) => ['billing-ledger', 'consolidatable-receivables', filters] as const,
  },
  charges: {
    tables: (filters?: unknown) =>
      (filters === undefined ? (['local-charge-tables'] as const) : (['local-charge-tables', filters] as const)),
    // Sem filtros => prefixo base, para que invalidateQueries({ operations() })
    // case com qualquer query ativa keyed por filtros (React Query v5 nao faz
    // prefix-match quando a chave passada tem `undefined` na posicao do filtro).
    operations: (filters?: unknown) =>
      (filters === undefined ? (['local-charge-operations'] as const) : (['local-charge-operations', filters] as const)),
    overrides: (filters?: unknown) =>
      (filters === undefined ? (['local-charge-overrides'] as const) : (['local-charge-overrides', filters] as const)),
    overrideItems: () => ['local-charge-override-items'] as const,
    overrideCustomers: (search: string) => ['local-charge-override-customers', search] as const,
    pendencies: () => ['local-charge-pendencies'] as const,
  },
  billingRuns: {
    list: (limit: number) => ['billing-runs', limit] as const,
    detail: (id: number | null | undefined) => ['billing-run-detail', id] as const,
  },
  reconciliation: {
    queue: (status?: string | null, limit?: number) =>
      (status === undefined && limit === undefined
        ? (['customer-reconciliation-queue'] as const)
        : (['customer-reconciliation-queue', status, limit] as const)),
  },
  voyages: {
    all: () => ['voyages'] as const,
    options: () => ['voyage-options'] as const,
    billingStatus: (voyageIds: number[]) => ['voyage-billing-status', voyageIds] as const,
    polSchedules: (entityIds: string[]) => ['voyage-pol-schedules', entityIds] as const,
    podSchedules: (voyageIds: number[]) => ['voyage-pod-schedules', voyageIds] as const,
    escalaSchedules: (voyageIds?: number[]) => voyageIds === undefined
      ? (['voyage-escala-schedules'] as const)
      : (['voyage-escala-schedules', voyageIds] as const),
    routeCeMasters: (voyageIds: number[]) => ['voyage-route-ce-masters', voyageIds] as const,
    exportSchedules: (voyageIds: number[]) => ['voyage-export-schedules', voyageIds] as const,
    vaziosExportPorts: (voyageId: number) => ['voyage-vazios-export-ports', voyageId] as const,
    escalaTerminal: (voyageId: number, port: string) => ['voyage-escala-terminal', voyageId, port] as const,
    escalaTerminalAll: () => ['voyage-escala-terminal'] as const,
    timeline: (voyageId: number) => ['voyage-timeline', String(voyageId)] as const,
  },
  agencyReports: {
    all: () => ['agency-report'] as const,
    byScale: (voyageId: number, port: string) => ['agency-report', voyageId, port] as const,
    ownByScale: (voyageId: number, port: string) => ['agency-report-own', voyageId, port] as const,
    ownByReportId: (reportId: string) => ['agency-report-own', 'report', reportId] as const,
    terminalState: (voyageId: number, port: string) => ['agency-report-terminal-state', voyageId, port] as const,
    byReportId: (reportId: string) => ['agency-report', 'report', reportId] as const,
    signoffEvents: (voyageId: number, port: string) => ['agency-report-signoff-events', voyageId, port] as const,
    departmentSignoffEvents: (voyageId: number, port: string) => ['agency-report-department-signoff-events', voyageId, port] as const,
  },
  transshipments: {
    byVoyage: (voyageId: number) => ['transshipments', 'voyage', voyageId] as const,
  },
  customers: {
    all: () => ['customers'] as const,
    detail: (cnpj?: string) =>
      (cnpj === undefined ? (['customer-detail'] as const) : (['customer-detail', cnpj] as const)),
    summary: () => ['customers-summary'] as const,
  },
  customerFicha: {
    demurrageInvoices: (customerId: number) => ['customer-ficha', 'demurrage-invoices', customerId] as const,
    receivables: (customerId: number) => ['customer-ficha', 'receivables', customerId] as const,
    payments: (customerId: number) => ['customer-ficha', 'payments', customerId] as const,
    rateOverrides: (customerId: number) => ['customer-ficha', 'rate-overrides', customerId] as const,
    manualChargeBls: (customerId: number) => ['customer-ficha', 'manual-charge-bls', customerId] as const,
    pendingReconciliation: (customerId: number) => ['customer-ficha', 'pending-reconciliation', customerId] as const,
    runningDemurrage: (customerId: number) => ['customer-ficha', 'running-demurrage', customerId] as const,
    timeline: (customerId: number) => ['customer-ficha', 'timeline', customerId] as const,
  },
  vehicles: {
    all: () => ['vehicles'] as const,
    stats: (voyageIds: number[]) => ['voyage-vehicle-stats', voyageIds] as const,
  },
  auditLogs: {
    detail: (entityType: string, entityId?: string) => ['audit-logs', entityType, entityId] as const,
  },
  portal: {
    currentRoe: () => ['portal-current-roe'] as const,
    blStatus: (blId?: string) => (blId === undefined ? (['bl-portal-status'] as const) : (['bl-portal-status', blId] as const)),
  },
  demurrage: {
    rates: () => ['demurrage-rates'] as const,
    invoices: (filters?: unknown) => (filters === undefined ? (['demurrage-invoices'] as const) : (['demurrage-invoices', filters] as const)),
  },
  dashboard: () => ['dashboard'] as const,
}

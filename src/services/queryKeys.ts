export const queryKeys = {
  bls: {
    all: () => ['bls'] as const,
    detail: (blId?: string) => (blId === undefined ? (['bl-detail'] as const) : (['bl-detail', blId] as const)),
    summary: () => ['bl-summary'] as const,
    localChargeLines: (blId?: string) =>
      (blId === undefined ? (['bl-local-charge-lines'] as const) : (['bl-local-charge-lines', blId] as const)),
    manualChargeItems: (blId?: string) =>
      (blId === undefined ? (['manual-charge-items'] as const) : (['manual-charge-items', blId] as const)),
    timeline: (blId: string) => ['bl-timeline', blId] as const,
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
    routeCeMasters: (voyageIds: number[]) => ['voyage-route-ce-masters', voyageIds] as const,
    exportSchedules: (voyageIds: number[]) => ['voyage-export-schedules', voyageIds] as const,
  },
  customers: {
    all: () => ['customers'] as const,
    detail: (cnpj?: string) =>
      (cnpj === undefined ? (['customer-detail'] as const) : (['customer-detail', cnpj] as const)),
    summary: () => ['customers-summary'] as const,
  },
  vehicles: {
    all: () => ['vehicles'] as const,
    stats: (voyageIds: number[]) => ['voyage-vehicle-stats', voyageIds] as const,
  },
  dashboard: () => ['dashboard'] as const,
}

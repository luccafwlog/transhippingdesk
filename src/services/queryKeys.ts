export const queryKeys = {
  bls: {
    all: () => ['bls'] as const,
    detail: (blId: string) => ['bl-detail', blId] as const,
    summary: () => ['bl-summary'] as const,
    localChargeLines: (blId: string) => ['bl-local-charge-lines', blId] as const,
    manualChargeItems: (blId: string) => ['manual-charge-items', blId] as const,
  },
  invoices: {
    all: () => ['invoices'] as const,
    list: (filters: unknown) => ['invoices', filters] as const,
    detail: (id: number | null | undefined) => ['invoice-detail', id] as const,
    links: (blIds: string[]) => ['invoice-links', blIds.slice().sort().join(',')] as const,
  },
  billingReady: {
    bls: (filters?: unknown) => ['billing-ready-bls', filters] as const,
    graniteBls: (filters?: unknown) => ['billing-ready-granite-bls', filters] as const,
    customers: (search: string) => ['billing-customers', search] as const,
  },
  charges: {
    tables: (filters?: unknown) => ['local-charge-tables', filters] as const,
    operations: (filters?: unknown) => ['local-charge-operations', filters] as const,
    overrides: (filters?: unknown) => ['local-charge-overrides', filters] as const,
    overrideItems: () => ['local-charge-override-items'] as const,
    overrideCustomers: (search: string) => ['local-charge-override-customers', search] as const,
    pendencies: () => ['local-charge-pendencies'] as const,
  },
  billingRuns: {
    list: (limit: number) => ['billing-runs', limit] as const,
    detail: (id: number | null | undefined) => ['billing-run-detail', id] as const,
  },
  reconciliation: {
    queue: (status?: string | null, limit?: number) => ['customer-reconciliation-queue', status, limit] as const,
  },
  voyages: {
    all: () => ['voyages'] as const,
    options: () => ['voyage-options'] as const,
    billingStatus: (voyageIds: number[]) => ['voyage-billing-status', voyageIds] as const,
    polSchedules: (entityIds: string[]) => ['voyage-pol-schedules', entityIds] as const,
    podSchedules: (voyageIds: number[]) => ['voyage-pod-schedules', voyageIds] as const,
    exportSchedules: (voyageIds: number[]) => ['voyage-export-schedules', voyageIds] as const,
  },
  customers: {
    all: () => ['customers'] as const,
    detail: (cnpj?: string) => ['customer-detail', cnpj] as const,
    summary: () => ['customers-summary'] as const,
  },
  vehicles: {
    all: () => ['vehicles'] as const,
    stats: (voyageIds: number[]) => ['voyage-vehicle-stats', voyageIds] as const,
  },
  dashboard: () => ['dashboard'] as const,
}

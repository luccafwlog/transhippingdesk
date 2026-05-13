import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'
import { MANAGED_PROFILES, PROFILE_LABELS, listAllUserProfiles, updateUserProfile } from '../services/adminUsers'
import { supabase } from '../services/supabase'
import type { UserProfileRole } from '../types/database'

type AdminTab = 'usuarios' | 'logs' | 'metricas'

const VERSION = '2.0.0'
const COMMIT_SHA = String(import.meta.env.VITE_APP_COMMIT_SHA ?? 'unknown')

type AuditLogRow = {
  id: number
  entity_type: string
  entity_id: string
  field_name: string | null
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
  justification: string | null
  changer_name: string | null
}

const LOG_PAGE_SIZE = 50

type LogFilters = {
  entityType: string
  changedBy: string
  dateFrom: string
  dateTo: string
  page: number
}

async function fetchAuditLogs(filters: LogFilters): Promise<{ rows: AuditLogRow[]; count: number }> {
  const from = filters.page * LOG_PAGE_SIZE
  const to = from + LOG_PAGE_SIZE - 1

  let query = supabase
    .from('audit_logs')
    .select('id, entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification', { count: 'exact' })
    .order('changed_at', { ascending: false })
    .range(from, to)

  if (filters.entityType) query = query.eq('entity_type', filters.entityType)
  if (filters.changedBy) query = query.eq('changed_by', filters.changedBy)
  if (filters.dateFrom) query = query.gte('changed_at', filters.dateFrom + 'T00:00:00')
  if (filters.dateTo) query = query.lte('changed_at', filters.dateTo + 'T23:59:59')

  const { data, error, count } = await query
  if (error) throw error

  const rows = (data ?? []) as unknown as Omit<AuditLogRow, 'changer_name'>[]
  if (!rows.length) return { rows: [], count: count ?? 0 }

  const changerIds = Array.from(new Set(rows.map((r) => r.changed_by).filter(Boolean))) as string[]
  const nameById = new Map<string, string>()
  if (changerIds.length) {
    const { data: profiles } = await supabase.from('user_profiles').select('id, full_name').in('id', changerIds)
    for (const p of profiles ?? []) nameById.set((p as { id: string; full_name: string }).id, (p as { id: string; full_name: string }).full_name)
  }

  return {
    rows: rows.map((r) => ({ ...r, changer_name: r.changed_by ? (nameById.get(r.changed_by) ?? r.changed_by) : null })),
    count: count ?? 0,
  }
}

async function fetchSystemMetrics() {
  const [voyageRes, reconRes, invoiceRes] = await Promise.all([
    supabase.from('voyages').select('created_at').order('created_at', { ascending: false }).limit(1),
    supabase.from('audit_logs').select('changed_at').eq('entity_type', 'pix_reconciliation').order('changed_at', { ascending: false }).limit(1),
    supabase.from('invoices').select('created_at').order('created_at', { ascending: false }).limit(1),
  ])

  return {
    lastVoyageAt: voyageRes.data?.[0]?.created_at ?? null,
    lastPixReconAt: (reconRes.data?.[0] as { changed_at?: string } | undefined)?.changed_at ?? null,
    lastInvoiceAt: invoiceRes.data?.[0]?.created_at ?? null,
  }
}

function roleBadgeTone(role: UserProfileRole): 'blue' | 'green' | 'yellow' | 'slate' | 'red' {
  if (role === 'admin' || role === 'administrativo') return 'blue'
  if (role === 'financeiro') return 'green'
  if (role === 'operacoes') return 'yellow'
  return 'slate'
}

export function AdminUsuarios() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [tab, setTab] = useState<AdminTab>('usuarios')
  const [logFilters, setLogFilters] = useState<LogFilters>({
    entityType: '', changedBy: '', dateFrom: '', dateTo: '', page: 0,
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: listAllUserProfiles,
  })

  const { data: auditLogsResult, isLoading: logsLoading } = useQuery({
    queryKey: ['admin-audit-logs', logFilters],
    queryFn: () => fetchAuditLogs(logFilters),
    enabled: tab === 'logs',
    staleTime: 30_000,
  })
  const auditLogs = auditLogsResult?.rows ?? []
  const auditLogsTotal = auditLogsResult?.count ?? 0
  const auditLogsTotalPages = Math.max(1, Math.ceil(auditLogsTotal / LOG_PAGE_SIZE))

  const { data: metrics } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: fetchSystemMetrics,
    enabled: tab === 'metricas',
    staleTime: 60_000,
  })

  const mutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof updateUserProfile>[1] }) =>
      updateUserProfile(id, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showToast('Usuario atualizado.', 'success')
      setPendingId(null)
    },
    onError: () => {
      showToast('Erro ao atualizar usuario.', 'error')
      setPendingId(null)
    },
  })

  function handleToggleActive(id: string, current: boolean) {
    setPendingId(id)
    mutation.mutate({ id, updates: { active: !current } })
  }

  function handleSetProfile(id: string, role: UserProfileRole) {
    setPendingId(id)
    mutation.mutate({ id, updates: { role } })
  }

  const users = data ?? []

  return (
    <>
      <PageHeader
        title="Administracao"
        description="Painel administrativo: usuarios, logs de acoes e metricas operacionais."
      />

      <div className="mb-6 rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500">Informacoes do sistema</div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <div className="flex justify-between rounded-lg border border-[#21262d] bg-[#161b22] px-3 py-2">
            <span className="text-slate-400">Versao</span>
            <span className="font-semibold text-white">{`${VERSION} (${COMMIT_SHA})`}</span>
          </div>
          <div className="flex justify-between rounded-lg border border-[#21262d] bg-[#161b22] px-3 py-2">
            <span className="text-slate-400">Ambiente</span>
            <span className="font-semibold text-white">Producao</span>
          </div>
          <div className="flex justify-between rounded-lg border border-[#21262d] bg-[#161b22] px-3 py-2">
            <span className="text-slate-400">Status</span>
            <Badge tone="green">Operacional</Badge>
          </div>
        </div>
      </div>

      <div className="mb-6 flex gap-2 border-b border-[#30363d] pb-0">
        {(['usuarios', 'logs', 'metricas'] as AdminTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium capitalize transition ${tab === t ? 'bg-[#21262d] text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {t === 'usuarios' ? 'Usuarios' : t === 'logs' ? 'Log de Acoes' : 'Metricas'}
          </button>
        ))}
      </div>

      {tab === 'usuarios' ? (
        <>
          {error ? <InlineError message="Erro ao carregar usuarios." /> : null}

          {isLoading ? (
            <div className="py-16 text-center text-slate-400">Carregando usuarios...</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#30363d]">
              <table className="app-table w-full text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">Perfil de acesso</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Criado em</th>
                    <th className="px-4 py-3 text-right">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <EmptyState title="Nenhum usuario encontrado." />
                      </td>
                    </tr>
                  ) : null}
                  {users.map((u) => {
                    const isBusy = pendingId === u.id && mutation.isPending
                    return (
                      <tr key={u.id} className={`hover:bg-[#21262d]/60 ${!u.active ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3 font-medium text-white">{u.full_name}</td>
                        <td className="px-4 py-3">
                          <Badge tone={roleBadgeTone(u.role)}>
                            {PROFILE_LABELS[u.role] ?? u.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Ativo' : 'Inativo'}</Badge>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-400">
                          {u.created_at
                            ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(u.created_at))
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <select
                              disabled={isBusy}
                              value={u.role}
                              onChange={(e) => handleSetProfile(u.id, e.target.value as UserProfileRole)}
                              className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-300 disabled:opacity-40"
                            >
                              {MANAGED_PROFILES.map((p) => (
                                <option key={p} value={p}>{PROFILE_LABELS[p]}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleToggleActive(u.id, u.active)}
                              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-[#21262d] hover:text-slate-200 disabled:opacity-40 transition-colors"
                            >
                              {u.active ? 'Desativar' : 'Ativar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm">
            <div className="mb-3 font-semibold text-white">Descricao dos perfis de acesso</div>
            <div className="grid gap-2 text-slate-400">
              <div><span className="font-semibold text-white">Administrativo:</span> Acesso global a todos os modulos e configuracoes.</div>
              <div><span className="font-semibold text-white">Financeiro:</span> Visualizacao completa + edicao em Taxas Locais (Tabelas/Overrides), Demurrage, Faturamento e Conciliacao.</div>
              <div><span className="font-semibold text-white">Operacoes:</span> Cadastro de Viagens, upload de manifestos e planilha IMO.</div>
              <div><span className="font-semibold text-white">Documentacao:</span> Acesso amplo ao sistema, exceto tela Admin e configuracoes administrativas.</div>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'logs' ? (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Modulo</label>
              <input
                className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm text-white w-44"
                placeholder="ex: bl, invoice..."
                value={logFilters.entityType}
                onChange={(e) => setLogFilters((f) => ({ ...f, entityType: e.target.value, page: 0 }))}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">De</label>
              <input type="date" className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm text-white" value={logFilters.dateFrom} onChange={(e) => setLogFilters((f) => ({ ...f, dateFrom: e.target.value, page: 0 }))} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Ate</label>
              <input type="date" className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm text-white" value={logFilters.dateTo} onChange={(e) => setLogFilters((f) => ({ ...f, dateTo: e.target.value, page: 0 }))} />
            </div>
            {(logFilters.entityType || logFilters.dateFrom || logFilters.dateTo) && (
              <button
                type="button"
                className="rounded px-3 py-1.5 text-xs text-slate-400 border border-[#30363d] hover:text-slate-200"
                onClick={() => setLogFilters({ entityType: '', changedBy: '', dateFrom: '', dateTo: '', page: 0 })}
              >
                Limpar filtros
              </button>
            )}
            {auditLogsTotal > 0 && (
              <span className="ml-auto text-xs text-slate-500">{auditLogsTotal} registros</span>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-[#30363d]">
            {logsLoading ? (
              <div className="py-12 text-center text-slate-400">Carregando logs...</div>
            ) : (
              <table className="app-table w-full text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Data/Hora</th>
                    <th className="px-4 py-3">Usuario</th>
                    <th className="px-4 py-3">Modulo</th>
                    <th className="px-4 py-3">Acao</th>
                    <th className="px-4 py-3">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {!auditLogs.length ? (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <EmptyState title="Nenhum log encontrado." />
                      </td>
                    </tr>
                  ) : null}
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#21262d]/60">
                      <td className="px-4 py-2 tabular-nums text-slate-400 whitespace-nowrap">
                        {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(log.changed_at))}
                      </td>
                      <td className="px-4 py-2 font-medium text-white">{log.changer_name ?? log.changed_by ?? '-'}</td>
                      <td className="px-4 py-2 text-slate-400">{log.entity_type}</td>
                      <td className="px-4 py-2">{log.field_name ?? '-'}</td>
                      <td className="px-4 py-2">
                        <span className="app-table__truncate app-table__truncate--xl text-slate-400" title={log.new_value ?? undefined}>
                          {log.new_value ?? log.justification ?? '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {auditLogsTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <button
                type="button"
                disabled={logFilters.page === 0}
                onClick={() => setLogFilters((f) => ({ ...f, page: f.page - 1 }))}
                className="rounded border border-[#30363d] px-3 py-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30"
              >
                ← Anterior
              </button>
              <span className="text-slate-500">
                Pag. {logFilters.page + 1} de {auditLogsTotalPages}
              </span>
              <button
                type="button"
                disabled={logFilters.page >= auditLogsTotalPages - 1}
                onClick={() => setLogFilters((f) => ({ ...f, page: f.page + 1 }))}
                className="rounded border border-[#30363d] px-3 py-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30"
              >
                Proximo →
              </button>
            </div>
          )}
        </>
      ) : null}

      {tab === 'metricas' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="Ultima alteracao em Viagens" value={metrics?.lastVoyageAt ? formatDateTime(metrics.lastVoyageAt) : '-'} />
          <MetricCard label="Ultima conciliacao Pix" value={metrics?.lastPixReconAt ? formatDateTime(metrics.lastPixReconAt) : '-'} />
          <MetricCard label="Ultimo faturamento" value={metrics?.lastInvoiceAt ? formatDateTime(metrics.lastInvoiceAt) : '-'} />
        </div>
      ) : null}
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

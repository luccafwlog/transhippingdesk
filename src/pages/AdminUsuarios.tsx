import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { MANAGED_PROFILES, PROFILE_LABELS, listAllUserProfiles, updateUserProfile } from '../services/adminUsers'
import { LOG_PAGE_SIZE, fetchAuditLogs, fetchSystemMetrics, type LogFilters } from '../services/adminObservability'
import type { UserProfileRole } from '../types/database'

type AdminTab = 'usuários' | 'logs' | 'métricas'

const VERSION = '2.0.0'
const COMMIT_SHA = String(import.meta.env.VITE_APP_COMMIT_SHA ?? 'unknown')

function roleBadgeTone(role: UserProfileRole): 'blue' | 'green' | 'yellow' | 'slate' | 'red' {
  if (role === 'admin' || role === 'administrativo') return 'blue'
  if (role === 'financeiro') return 'green'
  if (role === 'operacoes') return 'yellow'
  return 'slate'
}

export function AdminUsuarios() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [tab, setTab] = useState<AdminTab>('usuários')
  const [logFilters, setLogFilters] = useState<LogFilters>({
    entityType: '', changedBy: '', dateFrom: '', dateTo: '', page: 0,
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: listAllUserProfiles,
  })

  const { data: auditLogsResult, isLoading: logsLoading, error: logsError } = useQuery({
    queryKey: ['admin-audit-logs', logFilters],
    queryFn: () => fetchAuditLogs(logFilters),
    enabled: tab === 'logs',
    staleTime: 30_000,
  })
  const auditLogs = auditLogsResult?.rows ?? []
  const auditLogsTotal = auditLogsResult?.count ?? 0
  const auditLogsTotalPages = Math.max(1, Math.ceil(auditLogsTotal / LOG_PAGE_SIZE))

  const { data: metrics, error: metricsError } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: fetchSystemMetrics,
    enabled: tab === 'métricas',
    staleTime: 60_000,
  })

  const mutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof updateUserProfile>[1] }) =>
      updateUserProfile(id, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showToast('Usuário atualizado.', 'success')
      setPendingId(null)
    },
    onError: () => {
      showToast('Erro ao atualizar usuário.', 'error')
      setPendingId(null)
    },
  })

  async function handleToggleActive(id: string, current: boolean) {
    const confirmed = await confirm({
      title: current ? 'Desativar usuário' : 'Ativar usuário',
      message: current
        ? 'Desativar este usuário revoga imediatamente o acesso dele ao sistema. Confirmar?'
        : 'Reativar este usuário restaura o acesso dele ao sistema. Confirmar?',
      confirmLabel: current ? 'Desativar' : 'Ativar',
      tone: current ? 'danger' : 'primary',
    })
    if (!confirmed) return
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
        title="Administração"
        description="Painel administrativo: usuários, logs de ações e métricas operacionais."
      />

      <div className="mb-6 app-panel app-panel--padded">
        <div className="app-metric-tile__label">Informações do sistema</div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <div className="app-metric-tile grid-cols-[auto_1fr]">
            <span className="text-[var(--app-muted)]">Versão</span>
            <span className="text-right font-semibold text-[var(--app-text-strong)]">{`${VERSION} (${COMMIT_SHA})`}</span>
          </div>
          <div className="app-metric-tile grid-cols-[auto_1fr]">
            <span className="text-[var(--app-muted)]">Ambiente</span>
            <span className="text-right font-semibold text-[var(--app-text-strong)]">Produção</span>
          </div>
          <div className="app-metric-tile grid-cols-[auto_1fr]">
            <span className="text-[var(--app-muted)]">Status</span>
            <Badge tone="green">Operacional</Badge>
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {(['usuários', 'logs', 'métricas'] as AdminTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`app-tab capitalize ${tab === t ? 'app-tab--active' : ''}`}
          >
            {t === 'usuários' ? 'Usuários' : t === 'logs' ? 'Log de Ações' : 'Métricas'}
          </button>
        ))}
      </div>

      {tab === 'usuários' ? (
        <>
          {error ? <InlineError message="Erro ao carregar usuários." /> : null}

          {isLoading ? (
            <div className="py-16 text-center text-[var(--app-muted)]">Carregando usuários...</div>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-4 py-3">Nome</th>
                    <th scope="col" className="px-4 py-3">Perfil de acesso</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Criado em</th>
                    <th scope="col" className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <EmptyState title="Nenhum usuário encontrado." />
                      </td>
                    </tr>
                  ) : null}
                  {users.map((u) => {
                    const isBusy = pendingId === u.id && mutation.isPending
                    return (
                      <tr key={u.id} className={!u.active ? 'opacity-60' : undefined}>
                        <td className="px-4 py-3 font-medium text-[var(--app-text-strong)]">{u.full_name}</td>
                        <td className="px-4 py-3">
                          <Badge tone={roleBadgeTone(u.role)}>
                            {PROFILE_LABELS[u.role] ?? u.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Ativo' : 'Inativo'}</Badge>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-[var(--app-muted)]">
                          {u.created_at
                            ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(u.created_at))
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <select
                              disabled={isBusy}
                              value={u.role === 'admin' ? 'administrativo' : u.role === 'operator' ? 'documentacao' : u.role}
                              onChange={(e) => handleSetProfile(u.id, e.target.value as UserProfileRole)}
                              className="app-input app-select w-44 text-xs disabled:opacity-40"
                            >
                              {MANAGED_PROFILES.map((p) => (
                                <option key={p} value={p}>{PROFILE_LABELS[p]}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleActive(u.id, u.active)}
                              className="app-table__action text-xs disabled:opacity-40"
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
            </Card>
          )}

          <div className="mt-6 app-panel app-panel--padded text-sm">
            <div className="mb-3 app-panel__title">Descrição dos perfis de acesso</div>
            <div className="grid gap-2 text-[var(--app-muted)]">
              <div><span className="font-semibold text-[var(--app-text-strong)]">Administrativo:</span> Acesso global a todos os módulos e configurações.</div>
              <div><span className="font-semibold text-[var(--app-text-strong)]">Financeiro:</span> Visualização completa + edição em Taxas Locais (Tabelas/Overrides), Demurrage, Faturamento e Conciliação.</div>
              <div><span className="font-semibold text-[var(--app-text-strong)]">Operações:</span> Cadastro de Viagens, upload de manifestos e planilha IMO.</div>
              <div><span className="font-semibold text-[var(--app-text-strong)]">Documentação:</span> Acesso amplo ao sistema, exceto tela Admin e configurações administrativas.</div>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'logs' ? (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block app-field__label">Modulo</label>
              <input
                className="app-input w-44"
                placeholder="ex: bl, invoice..."
                value={logFilters.entityType}
                onChange={(e) => setLogFilters((f) => ({ ...f, entityType: e.target.value, page: 0 }))}
              />
            </div>
            <div>
              <label className="mb-1 block app-field__label">Autor (ID)</label>
              <input
                className="app-input w-44"
                value={logFilters.changedBy}
                onChange={(e) => setLogFilters((f) => ({ ...f, changedBy: e.target.value, page: 0 }))}
              />
            </div>
            <div>
              <label className="mb-1 block app-field__label">De</label>
              <input type="date" className="app-input" value={logFilters.dateFrom} onChange={(e) => setLogFilters((f) => ({ ...f, dateFrom: e.target.value, page: 0 }))} />
            </div>
            <div>
              <label className="mb-1 block app-field__label">Ate</label>
              <input type="date" className="app-input" value={logFilters.dateTo} onChange={(e) => setLogFilters((f) => ({ ...f, dateTo: e.target.value, page: 0 }))} />
            </div>
            {(logFilters.entityType || logFilters.changedBy || logFilters.dateFrom || logFilters.dateTo) && (
              <button
                type="button"
                className="app-btn app-btn--secondary"
                onClick={() => setLogFilters({ entityType: '', changedBy: '', dateFrom: '', dateTo: '', page: 0 })}
              >
                Limpar filtros
              </button>
            )}
            {auditLogsTotal > 0 && (
              <span className="ml-auto text-xs text-[var(--app-muted)]">{auditLogsTotal} registros</span>
            )}
          </div>

          {logsError ? <InlineError message="Erro ao carregar logs de ações." /> : null}

          <Card className="overflow-hidden p-0">
            {logsLoading ? (
              <div className="py-12 text-center text-[var(--app-muted)]">Carregando logs...</div>
            ) : (
              <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[920px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-4 py-3">Data/Hora</th>
                    <th scope="col" className="px-4 py-3">Usuário</th>
                    <th scope="col" className="px-4 py-3">Módulo</th>
                    <th scope="col" className="px-4 py-3">Ação</th>
                    <th scope="col" className="px-4 py-3">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {!auditLogs.length ? (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <EmptyState title="Nenhum log encontrado." />
                      </td>
                    </tr>
                  ) : null}
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-2 tabular-nums text-[var(--app-muted)] whitespace-nowrap">
                        {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(log.changed_at))}
                      </td>
                      <td className="px-4 py-2 font-medium text-[var(--app-text-strong)]">{log.changer_name ?? log.changed_by ?? '-'}</td>
                      <td className="px-4 py-2 text-[var(--app-muted)]">{log.entity_type}</td>
                      <td className="px-4 py-2">{log.field_name ?? '-'}</td>
                      <td className="px-4 py-2">
                        <span className="app-table__truncate app-table__truncate--xl text-[var(--app-muted)]" title={log.new_value ?? undefined}>
                          {log.new_value ?? log.justification ?? '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </Card>

          {auditLogsTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <button
                type="button"
                disabled={logFilters.page === 0}
                onClick={() => setLogFilters((f) => ({ ...f, page: f.page - 1 }))}
                className="app-btn app-btn--secondary disabled:opacity-30"
              >
                ← Anterior
              </button>
              <span className="text-[var(--app-muted)]">
                Pag. {logFilters.page + 1} de {auditLogsTotalPages}
              </span>
              <button
                type="button"
                disabled={logFilters.page >= auditLogsTotalPages - 1}
                onClick={() => setLogFilters((f) => ({ ...f, page: f.page + 1 }))}
                className="app-btn app-btn--secondary disabled:opacity-30"
              >
                Próximo →
              </button>
            </div>
          )}
        </>
      ) : null}

      {tab === 'métricas' ? (
        metricsError ? (
          <InlineError message="Erro ao carregar métricas do sistema." />
        ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="Última alteração em Viagens" value={metrics?.lastVoyageAt ? formatDateTime(metrics.lastVoyageAt) : '-'} />
          <MetricCard label="Última conciliação Pix" value={metrics?.lastPixReconAt ? formatDateTime(metrics.lastPixReconAt) : '-'} />
          <MetricCard label="Ultimo faturamento" value={metrics?.lastInvoiceAt ? formatDateTime(metrics.lastInvoiceAt) : '-'} />
        </div>
        )
      ) : null}
    </>
  )
}


function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

import { ChevronRight, CircleAlert, ExternalLink, FilterX, Search } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import {
  ALERT_RULES,
  ALERT_RULE_DEPARTMENT_LABELS,
  ALERT_RULE_DOMAINS,
  ALERT_RULE_SEVERITY_LABELS,
  type AlertRule,
  type AlertRuleDepartment,
  type AlertRuleDomain,
  type AlertRuleSeverity,
} from '../services/alertRulesCatalog'
import { ENTITY_TYPE_LABELS } from '../services/alerts'

const DEPARTMENTS: Array<{ value: 'all' | AlertRuleDepartment; label: string }> = [
  { value: 'all', label: 'Todos os setores' },
  { value: 'documentacao', label: 'Documentação' },
  { value: 'equipamentos', label: 'Equipamentos' },
  { value: 'operacoes', label: 'Operações' },
]

const SEVERITIES: Array<{ value: 'all' | AlertRuleSeverity; label: string }> = [
  { value: 'all', label: 'Todas as gravidades' },
  { value: 'critical', label: 'Crítico' },
  { value: 'normal', label: 'Normal' },
]

const ALL_FILTER_VALUE = 'all'

export function AlertasRegras() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const department = isDepartment(searchParams.get('setor')) ? searchParams.get('setor') as AlertRuleDepartment : ALL_FILTER_VALUE
  const domain = isDomain(searchParams.get('dominio')) ? searchParams.get('dominio') as AlertRuleDomain : ALL_FILTER_VALUE
  const severity = isSeverity(searchParams.get('gravidade')) ? searchParams.get('gravidade') as AlertRuleSeverity : ALL_FILTER_VALUE
  const selectedParam = searchParams.get('regra')

  const filteredRules = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
    return ALERT_RULES.filter((rule) => {
      if (department !== ALL_FILTER_VALUE && rule.department !== department) return false
      if (domain !== ALL_FILTER_VALUE && rule.domain !== domain) return false
      if (severity !== ALL_FILTER_VALUE && rule.severity !== severity) return false
      if (!normalizedQuery) return true

      const searchable = [
        rule.type,
        rule.summary,
        rule.trigger,
        rule.timing,
        rule.resolution,
        rule.destination,
        rule.destinationLabel,
        ENTITY_TYPE_LABELS[rule.entityType],
        ALERT_RULE_DEPARTMENT_LABELS[rule.department],
        rule.domain,
      ].join(' ').toLocaleLowerCase('pt-BR')
      return searchable.includes(normalizedQuery)
    })
  }, [department, domain, query, severity])

  const selectedRule = filteredRules.find((rule) => rule.type === selectedParam) ?? filteredRules[0] ?? null

  useEffect(() => {
    const current = searchParams.get('regra')
    const nextRule = selectedRule?.type ?? null
    if (current === nextRule || (!current && !nextRule)) return

    const next = new URLSearchParams(searchParams)
    if (nextRule) next.set('regra', nextRule)
    else next.delete('regra')
    setSearchParams(next, { replace: true })
  }, [searchParams, selectedRule?.type, setSearchParams])

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (!value || value === ALL_FILTER_VALUE) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  function clearFilters() {
    const next = new URLSearchParams()
    if (selectedRule) next.set('regra', selectedRule.type)
    setSearchParams(next, { replace: true })
  }

  const hasFilters = Boolean(query || department !== ALL_FILTER_VALUE || domain !== ALL_FILTER_VALUE || severity !== ALL_FILTER_VALUE)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regras de Alertas"
        description="Use esta página como legenda: entenda o que dispara cada alerta e onde tratar a causa."
        action={(
          <Link to="/alertas" className="app-btn app-btn--secondary inline-flex items-center gap-2">
            <CircleAlert size={15} aria-hidden="true" />
            Voltar para Alertas
          </Link>
        )}
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1">
            <span className="mb-1.5 block text-xs font-medium text-[var(--app-muted)]">Buscar uma regra</span>
            <span className="relative block">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)]" aria-hidden="true" />
              <input
                className="app-input w-full pl-9"
                value={query}
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Nome, gatilho, entidade ou tela"
                aria-label="Buscar regras de alertas"
              />
            </span>
          </label>

          <FilterSelect
            label="Setor responsável"
            value={department}
            options={DEPARTMENTS}
            onChange={(value) => updateFilter('setor', value)}
          />
          <FilterSelect
            label="Domínio"
            value={domain}
            options={[{ value: ALL_FILTER_VALUE, label: 'Todos os domínios' }, ...ALERT_RULE_DOMAINS.map((item) => ({ value: item, label: item }))]}
            onChange={(value) => updateFilter('dominio', value)}
          />
          <FilterSelect
            label="Gravidade"
            value={severity}
            options={SEVERITIES}
            onChange={(value) => updateFilter('gravidade', value)}
          />
          <button
            type="button"
            className="app-btn app-btn--ghost inline-flex items-center gap-2"
            onClick={clearFilters}
            disabled={!hasFilters}
          >
            <FilterX size={15} aria-hidden="true" />
            Limpar filtros
          </button>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-muted)]">
        <span>
          {filteredRules.length} {filteredRules.length === 1 ? 'regra encontrada' : 'regras encontradas'}
        </span>
        <span className="hidden sm:inline">Selecione uma regra para ver o manual completo.</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(250px,0.78fr)_minmax(0,1.5fr)] lg:items-start">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-[var(--app-border)] bg-[var(--app-card-bg)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--app-text-strong)]">Catálogo de regras</h2>
            <p className="mt-1 text-[11px] text-[var(--app-muted)]">As regras ativas no sistema, agrupadas para consulta.</p>
          </div>

          {filteredRules.length ? (
            <div className="max-h-[min(66vh,720px)] overflow-y-auto p-2" role="listbox" aria-label="Regras de alertas">
              {filteredRules.map((rule) => (
                <RuleListItem
                  key={rule.type}
                  rule={rule}
                  selected={selectedRule?.type === rule.type}
                  onSelect={() => updateFilter('regra', rule.type)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FilterX}
              title="Nenhuma regra encontrada"
              description="Tente remover um filtro ou buscar por outro termo."
            />
          )}
        </Card>

        {selectedRule ? <RuleDetail rule={selectedRule} /> : null}
      </div>
    </div>
  )
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="min-w-[170px]">
      <span className="mb-1.5 block text-xs font-medium text-[var(--app-muted)]">{label}</span>
      <select className="app-input app-select w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function RuleListItem({
  rule,
  selected,
  onSelect,
}: {
  rule: AlertRule
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-controls={`regra-${rule.type}`}
      className={`group flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${selected
        ? 'border-[var(--app-primary)] bg-[var(--app-primary)]/10'
        : 'border-transparent hover:border-[var(--app-border)] hover:bg-[var(--app-card-bg)]'}`}
      onClick={onSelect}
    >
      <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${rule.severity === 'critical' ? 'bg-rose-400' : 'bg-amber-400'}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold leading-5 text-[var(--app-text-strong)]">{rule.label}</span>
        <span className="mt-1 block text-[11px] text-[var(--app-muted)]">
          {ALERT_RULE_DEPARTMENT_LABELS[rule.department]} · {rule.domain}
        </span>
      </span>
      <ChevronRight size={15} className={`mt-1 shrink-0 ${selected ? 'text-[var(--app-primary)]' : 'text-[var(--app-muted)] group-hover:text-[var(--app-text)]'}`} aria-hidden="true" />
    </button>
  )
}

function RuleDetail({ rule }: { rule: AlertRule }) {
  return (
    <div id={`regra-${rule.type}`}>
      <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--app-border)] pb-5">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SeverityBadge severity={rule.severity} />
            <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-[11px] text-[var(--app-muted)]">{rule.domain}</span>
          </div>
          <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">{rule.label}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-muted)]">{rule.summary}</p>
        </div>
        <span className="rounded bg-[var(--app-bg)] px-2 py-1 font-mono text-[10px] text-[var(--app-muted)]">{rule.type}</span>
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <DetailField label="Entidade afetada">{ENTITY_TYPE_LABELS[rule.entityType]}</DetailField>
        <DetailField label="Setor responsável">{ALERT_RULE_DEPARTMENT_LABELS[rule.department]}</DetailField>
        <DetailField label="Quando aparece">{rule.timing}</DetailField>
        <DetailField label="Gatilho">{rule.trigger}</DetailField>
        <DetailField label="Como resolver">{rule.resolution}</DetailField>
        <DetailField label="O que acontece depois">{rule.afterResolution}</DetailField>
      </dl>

      <div className="mt-6 grid gap-4 border-t border-[var(--app-border)] pt-5 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-card-bg)] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-muted)]">Onde resolver</p>
          <p className="mt-2 text-sm text-[var(--app-text)]">{rule.destinationLabel}</p>
          <p className="mt-1 font-mono text-[11px] text-[var(--app-muted)]">{rule.destination}</p>
          <Link
            to={rule.destination}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--app-primary)] hover:underline"
          >
            Abrir tela de resolução
            <ExternalLink size={13} aria-hidden="true" />
          </Link>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-400">Dispensa</p>
          <p className="mt-2 text-sm leading-6 text-[var(--app-muted)]">{rule.dismissal}</p>
        </div>
      </div>

      {rule.domain === 'Portal' ? (
        <p className="mt-5 text-[11px] leading-5 text-[var(--app-muted)]">
          O Portal pode ser a origem do evento, mas este alerta é tratado pela equipe interna na fila de Alertas.
        </p>
      ) : null}
      </Card>
    </div>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--app-muted)]">{label}</dt>
      <dd className="mt-1.5 text-sm leading-6 text-[var(--app-text)]">{children}</dd>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: AlertRuleSeverity }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${severity === 'critical'
      ? 'border-rose-500/20 bg-rose-500/10 text-rose-400'
      : 'border-amber-500/20 bg-amber-500/10 text-amber-400'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${severity === 'critical' ? 'bg-rose-400' : 'bg-amber-400'}`} aria-hidden="true" />
      {ALERT_RULE_SEVERITY_LABELS[severity]}
    </span>
  )
}

function isDepartment(value: string | null): value is AlertRuleDepartment {
  return value === 'documentacao' || value === 'equipamentos' || value === 'operacoes'
}

function isDomain(value: string | null): value is AlertRuleDomain {
  return value !== null && ALERT_RULE_DOMAINS.includes(value as AlertRuleDomain)
}

function isSeverity(value: string | null): value is AlertRuleSeverity {
  return value === 'critical' || value === 'normal'
}

import { useMemo, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { useInvoiceLinks } from '../../hooks/useBilling'
import { useBlLocalChargeLines } from '../../hooks/useLocalCharges'
import type { BlForm } from '../../hooks/useBlEditForm'
import { cargoModeLabel, type CargoMode } from '../../pages/blDetalheHelpers'
import { listBlNcms } from '../../lib/ncm'
import { REVIEW_STATUS_LABELS } from '../../lib/statusLabels'
import type { BL, BLDetail } from '../../types/database'

// Aba Operacional: formulário de edição manual do B/L. O pai (BlDetalhe) mantém o estado do form.
export function BlOperacionalTab({
  active,
  bl,
  form,
  changes,
  saving,
  justification,
  cargoMode,
  isContainerMode,
  onFieldChange,
  onJustificationChange,
  onSubmit,
}: {
  active: boolean
  bl: BLDetail
  form: BlForm
  changes: (keyof BlForm)[]
  saving: boolean
  justification: string
  cargoMode: CargoMode
  isContainerMode: boolean
  onFieldChange: <K extends keyof BlForm>(field: K, value: BlForm[K] | string) => void
  onJustificationChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}) {
  const { data: invoiceLinksByBl } = useInvoiceLinks([bl.id])
  const { data: localChargeLines } = useBlLocalChargeLines(bl.id)

  const latestInvoice = invoiceLinksByBl?.[bl.id]?.[0] ?? null

  const currentCalcTotal = useMemo(() => {
    if (!localChargeLines) return null
    return localChargeLines
      .filter((l) => l.status !== 'exempt')
      .reduce((sum, l) => sum + Number(l.total_value_brl ?? 0), 0)
  }, [localChargeLines])

  const invoiceDiverges = useMemo(() => {
    if (!latestInvoice?.total_brl || currentCalcTotal == null) return false
    if (!['issued', 'overdue'].includes(latestInvoice.status ?? '')) return false
    return Math.abs(currentCalcTotal - latestInvoice.total_brl) > 0.01
  }, [latestInvoice, currentCalcTotal])

  const ncms = useMemo(() => listBlNcms(form.cargo_description), [form.cargo_description])

  if (!active) return null

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusBadge label="Modo" value={cargoModeLabel(cargoMode)} tone={isContainerMode ? 'blue' : 'green'} />
          <StatusBadge label="Revisao" value={REVIEW_STATUS_LABELS[bl.review_status ?? 'ok'] ?? bl.review_status ?? 'ok'} />
          {invoiceDiverges ? (
            <Badge tone="yellow">Taxas recalculadas — a fatura pode estar desatualizada</Badge>
          ) : null}
          {changes.length ? <Badge tone="yellow">{changes.length} alteracao(oes) pendentes</Badge> : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Armador / Navio / Viagem">
            <Input
              disabled
              value={`${bl.voyage?.vessel?.carrier?.name ?? '-'} / ${bl.voyage?.vessel?.name ?? '-'} / ${
                bl.voyage?.voyage_number ?? '-'
              }`}
            />
          </Field>
          <Field label="POL">
            <Input value={form.pol ?? ''} onChange={(event) => onFieldChange('pol', event.target.value)} />
          </Field>
          <Field label="POD">
            <Input value={form.pod ?? ''} onChange={(event) => onFieldChange('pod', event.target.value)} />
          </Field>
          <Field label="CE Mercante">
            <Input
              value={form.ce_mercante ?? ''}
              onChange={(event) => onFieldChange('ce_mercante', event.target.value)}
            />
          </Field>
          {!isContainerMode ? (
            <>
              <Field label="Maquinas">
                <Input
                  type="number"
                  value={form.bb_machine_qty ?? ''}
                  onChange={(event) => onFieldChange('bb_machine_qty', event.target.value)}
                />
              </Field>
              <Field label="Packages">
                <Input
                  type="number"
                  value={form.bb_packages_qty ?? ''}
                  onChange={(event) => onFieldChange('bb_packages_qty', event.target.value)}
                />
              </Field>
              <Field label="Packages Total">
                <Input
                  type="number"
                  value={form.bb_packages_total ?? ''}
                  onChange={(event) => onFieldChange('bb_packages_total', event.target.value)}
                />
              </Field>
              <Field label="Weight (Ton)">
                <Input
                  type="number"
                  value={form.bb_weight_ton ?? ''}
                  onChange={(event) => onFieldChange('bb_weight_ton', event.target.value)}
                />
              </Field>
            </>
          ) : null}

          <Field label="Shipper">
            <Input value={form.shipper ?? ''} onChange={(event) => onFieldChange('shipper', event.target.value)} />
          </Field>
          <Field label="Consignatario">
            <Input value={form.consignee ?? ''} onChange={(event) => onFieldChange('consignee', event.target.value)} />
          </Field>
          <Field label="Notify Party">
            <Input
              value={form.notify_party ?? ''}
              onChange={(event) => onFieldChange('notify_party', event.target.value)}
            />
          </Field>
          {isContainerMode ? (
            <Field label="Peso total (kg)">
              <Input
                type="number"
                value={form.total_weight_kg ?? ''}
                onChange={(event) => onFieldChange('total_weight_kg', event.target.value)}
              />
            </Field>
          ) : null}
          <Field label="CBM total">
            <Input
              type="number"
              value={form.total_cbm ?? ''}
              onChange={(event) => onFieldChange('total_cbm', event.target.value)}
            />
          </Field>

          <Field label="Pagamento">
            <Select
              value={form.payment_type ?? ''}
              onChange={(event) => onFieldChange('payment_type', event.target.value as BL['payment_type'])}
            >
              <option value="">Não informado</option>
              <option value="PREPAID">PREPAID</option>
              <option value="COLLECT">COLLECT</option>
            </Select>
          </Field>
          <Field label="Status de revisao">
            {/* Somente leitura: o status é derivado no servidor (save_bl_review →
                compute_bl_review_pendencies). Não é editável manualmente. */}
            <Input disabled value={REVIEW_STATUS_LABELS[bl.review_status ?? 'ok'] ?? bl.review_status ?? 'ok'} />
          </Field>
        </div>

        <div className="mt-4 grid gap-4">
          <Field label="NCM">
            {ncms.length ? (
              <div className="flex flex-wrap gap-2">
                {ncms.map((ncm) => (
                  <span
                    key={ncm}
                    className="rounded-full border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs font-semibold text-slate-200"
                  >
                    {ncm}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-400">Nenhum NCM identificado na descrição.</div>
            )}
          </Field>
          <Field label="Descricao da carga">
            <Textarea
              value={form.cargo_description ?? ''}
              onChange={(event) => onFieldChange('cargo_description', event.target.value)}
            />
          </Field>
          <Field label="Notas">
            <Textarea value={form.notes ?? ''} onChange={(event) => onFieldChange('notes', event.target.value)} />
          </Field>
          <Field label="Justificativa da alteracao manual">
            <Textarea value={justification} onChange={(event) => onJustificationChange(event.target.value)} required />
          </Field>
        </div>

        <div className="mt-5 flex justify-end">
          <Button loading={saving} type="submit">
            <Save size={16} />
            Salvar alterações
          </Button>
        </div>
      </Card>
    </form>
  )
}

function StatusBadge({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'blue' | 'green' | 'red' | 'yellow' | 'slate'
}) {
  const resolvedTone =
    tone ??
    (value.includes('pending')
      ? 'yellow'
      : value.includes('paid') || value.includes('reviewed')
        ? 'green'
        : 'blue')

  return (
    <Badge tone={resolvedTone}>
      {label}: {value}
    </Badge>
  )
}

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/ui/Toast'
import { logOperationalEvent } from '../services/operationalEvents'
import { supabase } from '../services/supabase'
import type { BL, BLDetail } from '../types/database'
import { useAuth } from './useAuth'

const editableFields: (keyof Pick<
  BL,
  | 'shipper'
  | 'consignee'
  | 'notify_party'
  | 'ce_mercante'
  | 'bb_machine_qty'
  | 'bb_packages_qty'
  | 'bb_packages_total'
  | 'bb_weight_ton'
  | 'pol'
  | 'pod'
  | 'cargo_description'
  | 'total_weight_kg'
  | 'total_cbm'
  | 'payment_type'
  | 'free_time_override'
  | 'notes'
>)[] = [
  'shipper',
  'consignee',
  'notify_party',
  'ce_mercante',
  'bb_machine_qty',
  'bb_packages_qty',
  'bb_packages_total',
  'bb_weight_ton',
  'pol',
  'pod',
  'cargo_description',
  'total_weight_kg',
  'total_cbm',
  'payment_type',
  'free_time_override',
  'notes',
]
// `review_status` é deliberadamente omitido: o RPC save_bl_review recalcula o
// status a partir de compute_bl_review_pendencies e ignora qualquer valor enviado
// pelo cliente (além de descartar a linha de auditoria correspondente). Mantê-lo
// como campo editável criava "alterações" e sucesso fantasmas que nunca persistiam.

export type BlForm = Pick<BL, (typeof editableFields)[number]>

const INVALID_NUMERIC_VALUE = Symbol('INVALID_NUMERIC_VALUE')

// Estado do formulário de edição manual do B/L e submissão com auditoria campo a campo.
export function useBlEditForm(bl: BLDetail | undefined, isContainerMode: boolean) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [form, setForm] = useState<BlForm | null>(null)
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)

  // Re-baseia o formulário quando o B/L (re)carrega — ajuste durante o render
  // (padrão "adjusting state when props change" do React) em vez de useEffect.
  const [prevBl, setPrevBl] = useState<BLDetail | undefined>(undefined)
  if (bl && bl !== prevBl) {
    setPrevBl(bl)
    setForm(makeForm(bl))
  }

  const baselineForm = useMemo(() => (bl ? makeForm(bl) : null), [bl])

  const changes = useMemo(() => {
    if (!baselineForm || !form) return []

    return editableFields.filter((field) => stringifyValue(baselineForm[field]) !== stringifyValue(form[field]))
  }, [baselineForm, form])

  function setField<K extends keyof BlForm>(field: K, value: BlForm[K] | string) {
    setForm((current) => (current ? { ...current, [field]: value } : current))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!bl || !form || !user) return

    if (changes.length === 0) {
      showToast('Nenhuma alteração detectada.', 'info')
      return
    }

    if (!justification.trim()) {
      showToast('Informe a justificativa para registrar a auditoria.', 'error')
      return
    }

    setSaving(true)
    try {
      const updatePayload: Record<string, unknown> = {}

      for (const field of changes) {
        const normalized = normalizeFormValue(field, form[field])
        if (normalized === INVALID_NUMERIC_VALUE) {
          showToast(`Valor invalido para ${field}. Informe um numero valido antes de salvar.`, 'error')
          return
        }
        updatePayload[field] = normalized
      }

      if (!isContainerMode) {
        const weightTon = normalizeFormValue('bb_weight_ton', form.bb_weight_ton)
        if (weightTon === INVALID_NUMERIC_VALUE) {
          showToast('Valor invalido para bb_weight_ton. Informe um numero valido antes de salvar.', 'error')
          return
        }
        updatePayload.total_weight_kg = weightTon === null ? null : Number(weightTon) * 1000
      }

      const auditRows = changes.map((field) => ({
        entity_type: 'bl',
        entity_id: bl.id,
        field_name: field,
        old_value: stringifyValue(baselineForm?.[field]),
        new_value: stringifyValue(form[field]),
        justification,
      }))

      if (!isContainerMode && changes.includes('bb_weight_ton')) {
        auditRows.push({
          entity_type: 'bl',
          entity_id: bl.id,
          field_name: 'total_weight_kg',
          old_value: stringifyValue(baselineForm?.total_weight_kg),
          new_value: stringifyValue(updatePayload.total_weight_kg),
          justification,
        })
      }

      const { error: rpcError } = await supabase.rpc('save_bl_review', {
        p_bl_id: bl.id,
        p_expected_updated_at: bl.updated_at ?? null,
        p_update_payload: updatePayload,
        p_audit_rows: auditRows,
        p_changed_by: user.id,
      })

      if (rpcError) {
        if (rpcError.code === 'PT409' || rpcError.code === '40001') {
          void logOperationalEvent({
            code: 'bl_review_concurrent_conflict',
            message: rpcError.message ?? 'Conflito concorrente ao salvar B/L',
            changedBy: user?.id ?? null,
            entityId: bl.id,
            context: { source: 'bl_detail' },
          })
          await queryClient.invalidateQueries({ queryKey: ['bl-detail', bl.id] })
          showToast(
            'Este B/L foi alterado por outro usuário. Os dados foram recarregados; revise e salve novamente.',
            'error',
          )
          return
        }
        throw rpcError
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-detail', bl.id] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs', 'bl', bl.id] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])

      setJustification('')
      showToast('B/L salvo com auditoria campo a campo.', 'success')
    } catch {
      showToast('Falha ao salvar alterações do B/L.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return { form, setField, justification, setJustification, saving, changes, handleSubmit }
}

function makeForm(bl: BLDetail): BlForm {
  return {
    shipper: bl.shipper,
    consignee: bl.consignee,
    notify_party: bl.notify_party,
    ce_mercante: bl.ce_mercante,
    bb_machine_qty: bl.bb_machine_qty,
    bb_packages_qty: bl.bb_packages_qty,
    bb_packages_total: bl.bb_packages_total,
    bb_weight_ton: bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : null),
    pol: bl.pol,
    pod: bl.pod,
    cargo_description: bl.cargo_description,
    total_weight_kg: bl.total_weight_kg,
    total_cbm: bl.total_cbm,
    payment_type: bl.payment_type,
    free_time_override: bl.free_time_override,
    notes: bl.notes,
  }
}

function stringifyValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function normalizeFormValue(field: keyof BlForm, value: unknown) {
  if (
    ['bb_machine_qty', 'bb_packages_qty', 'bb_packages_total', 'bb_weight_ton', 'total_weight_kg', 'total_cbm', 'free_time_override'].includes(
      field,
    )
  ) {
    if (value === '' || value === null || value === undefined) return null
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : INVALID_NUMERIC_VALUE
  }

  return value === '' ? null : value
}

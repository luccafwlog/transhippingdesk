// Helpers puros para estado, rótulos e formatação do detalhe de B/L.
import type { BL, BLDetail } from '../types/database'

export type CargoMode = 'container' | 'carga_solta'

export function resolveCargoMode(bl?: BLDetail | null): CargoMode {
  if (bl?.cargo_mode === 'carga_solta') return 'carga_solta'
  if (bl?.cargo_mode === 'container') return 'container'
  if ((bl?.bl_breakbulk_items?.length ?? 0) > 0) return 'carga_solta'
  return 'container'
}

export function cargoModeLabel(mode: CargoMode) {
  return mode === 'carga_solta' ? 'Carga Solta' : 'Container'
}

export function formatNumber(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR') : '0'
}

export function resolveChargeStatusTone(status: BL['charge_status']) {
  if (status === 'review_required') return 'yellow'
  if (status === 'ready_for_billing' || status === 'reviewed' || status === 'calculated') return 'green'
  if (status === 'exempt') return 'slate'
  return 'blue'
}

export function resolveChargeStatusLabel(status: BL['charge_status']) {
  switch (status) {
    case 'calculated':
      return 'Calculado'
    case 'review_required':
      return 'Revisao obrigatoria'
    case 'reviewed':
      return 'Revisado'
    case 'ready_for_billing':
      return 'Pronto para faturar'
    case 'exempt':
      return 'Isento'
    default:
      return 'Não calculado'
  }
}

export function resolveChargeLineStatusTone(status: string | null) {
  if (status === 'review_required') return 'yellow'
  if (status === 'exempt') return 'slate'
  if (status === 'reviewed' || status === 'ready_for_billing' || status === 'calculated') return 'green'
  return 'blue'
}

export function resolveChargeLineStatusLabel(status: string | null) {
  switch (status) {
    case 'calculated':
      return 'Calculado'
    case 'review_required':
      return 'Revisao'
    case 'reviewed':
      return 'Revisado'
    case 'ready_for_billing':
      return 'Pronto'
    case 'exempt':
      return 'Isento'
    default:
      return 'Pendente'
  }
}

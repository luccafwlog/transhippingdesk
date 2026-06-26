import type { DemurrageRate } from '../types/database'

export type DemurrageRateUpsertInput = Partial<DemurrageRate> & { container_type: string }

// `valid_from` é NOT NULL com default (data de hoje) no banco. O formulário de
// tarifas mantém `valid_from` como `null` quando o usuário não informa a
// vigência; enviar `null` explícito viola a constraint (23502) em vez de deixar
// o default vigente aplicar. Omitir a chave preserva o comportamento de default.
export function buildDemurrageRateUpsertPayload(rate: DemurrageRateUpsertInput): DemurrageRateUpsertInput {
  const payload = { ...rate }
  if (payload.valid_from == null) delete payload.valid_from
  return payload
}

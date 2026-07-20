import type { TablesInsert } from '../../types/database'

export type DemurrageRateUpsertInput = Omit<Partial<TablesInsert<'demurrage_rates'>>, 'valid_from'> & {
  container_type: string
  valid_from?: string | null
}

// `valid_from` é NOT NULL com default (data de hoje) no banco. O formulário de
// tarifas mantém `valid_from` como `null` quando o usuário não informa a
// vigência; enviar `null` explícito viola a constraint (23502) em vez de deixar
// o default vigente aplicar. Omitir a chave preserva o comportamento de default.
export function buildDemurrageRateUpsertPayload(rate: DemurrageRateUpsertInput): TablesInsert<'demurrage_rates'> {
  if (
    rate.p1_day_from == null ||
    rate.p1_day_to == null ||
    rate.p1_usd == null ||
    rate.p2_day_from == null ||
    rate.p2_usd == null
  ) {
    throw new Error('Faixas e valores de demurrage são obrigatórios.')
  }
  const { valid_from: validFrom, ...payload } = rate
  return {
    ...payload,
    ...(validFrom == null ? {} : { valid_from: validFrom }),
    p1_day_from: rate.p1_day_from,
    p1_day_to: rate.p1_day_to,
    p1_usd: rate.p1_usd,
    p2_day_from: rate.p2_day_from,
    p2_usd: rate.p2_usd,
  }
}

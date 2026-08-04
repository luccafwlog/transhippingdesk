// PROTÓTIPO — chaves das variantes da faixa horizontal de Viagens.
export const STRIP_VARIANTS = ['A', 'B', 'C'] as const
export const STRIP_VARIANT_LABELS: Record<string, string> = {
  A: 'Faixa de cards',
  B: 'Trilho compacto',
  C: 'Linha do tempo',
}

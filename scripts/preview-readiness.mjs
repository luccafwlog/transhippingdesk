// ponytail: decisão pura do lifecycle do Preview; o YAML interroga, este módulo decide.
// `skipped` nunca lê como sucesso e PR fechada/superada conclui sem provisionar.

export function decidePreviewReadiness({ open, currentSha, requestedSha, conclusion, branchReady }) {
  if (!open || currentSha !== requestedSha) return 'obsolete'
  if (conclusion === 'success' && branchReady) return 'ready'
  if (['failure','cancelled','timed_out','action_required'].includes(conclusion)) return 'failed'
  if (conclusion === 'skipped') return 'investigate'
  return 'wait'
}

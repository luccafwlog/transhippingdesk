import { describe, expect, it } from 'vitest'
// @ts-expect-error — script operacional JS sem declaração gerada.
import { decidePreviewReadiness } from '../../../scripts/preview-readiness.mjs'

const base = {
  open: true,
  currentSha: 'a',
  requestedSha: 'a',
  conclusion: 'success',
  branchReady: true,
}

describe('decidePreviewReadiness', () => {
  it('autoriza provisionar quando a PR está aberta, o SHA confere e a branch está pronta', () => {
    expect(decidePreviewReadiness(base)).toBe('ready')
  })

  it('considera obsoleta a PR fechada, sem provisionar', () => {
    expect(decidePreviewReadiness({ ...base, open: false })).toBe('obsolete')
  })

  it('considera obsoleto o SHA superado, mesmo com check verde', () => {
    expect(decidePreviewReadiness({ ...base, currentSha: 'b' })).toBe('obsolete')
  })

  it.each(['failure', 'cancelled', 'timed_out', 'action_required'])(
    'reprova a conclusão terminal %s sem segredo',
    (conclusion) => {
      expect(decidePreviewReadiness({ ...base, conclusion })).toBe('failed')
    },
  )

  it('não transforma skipped de PR aberta em autorização para provisionar', () => {
    expect(decidePreviewReadiness({ ...base, conclusion: 'skipped' })).toBe('investigate')
  })

  it.each([null, undefined, '', 'neutral', 'stale', 'in_progress', 'queued'])(
    'aguarda a conclusão %s em vez de decidir',
    (conclusion) => {
      expect(decidePreviewReadiness({ ...base, conclusion })).toBe('wait')
    },
  )

  it('aguarda a branch mesmo com check verde quando ela ainda não está pronta', () => {
    expect(decidePreviewReadiness({ ...base, branchReady: false })).toBe('wait')
  })
})

import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { runBackfill, runPreflight } from '../services/portalProvisioning'

export function AdminPortalBackfill() {
  const confirm = useConfirm()
  const [preflight, setPreflight] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handlePreflight() {
    setBusy(true); setError('')
    try { setPreflight((await runPreflight()) as Record<string, unknown>) } catch (err) { setError(err instanceof Error ? err.message : 'Falha no pré-voo.') } finally { setBusy(false) }
  }

  async function handleBackfill() {
    if (!preflight || !(await confirm({ title: 'Confirmar backfill', message: 'Os totais do pré-voo conferem com os valores esperados?', confirmLabel: 'Executar backfill' }))) return
    setBusy(true); setError('')
    try { setResult((await runBackfill(crypto.randomUUID())) as Record<string, unknown>) } catch (err) { setError(err instanceof Error ? err.message : 'Falha no backfill.') } finally { setBusy(false) }
  }

  return <><PageHeader title="Backfill do Portal" description="Pré-voo e backfill controlados para a migração da fila de provisionamento." /><Card className="grid max-w-2xl gap-4"><Button onClick={handlePreflight} loading={busy}>Executar pré-voo</Button>{preflight ? <pre className="overflow-auto rounded-lg bg-black/20 p-3 text-xs">{JSON.stringify(preflight, null, 2)}</pre> : null}<Button variant="secondary" onClick={handleBackfill} disabled={!preflight || busy}>Executar backfill</Button>{result ? <p className="text-emerald-300">Backfill concluído: {String(result.created_records ?? result.created ?? 'resultado recebido')}.</p> : null}{error ? <InlineError message={error} /> : null}</Card></>
}

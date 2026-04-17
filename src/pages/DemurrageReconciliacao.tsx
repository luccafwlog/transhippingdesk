import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { confirmPixReconciliation, matchPixTransactions, parsePixExtract } from '../services/demurrage'
import type { PixMatch } from '../types/database'

function fmtBRL(v: number) {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function DemurrageReconciliacao() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [matches, setMatches] = useState<PixMatch[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  async function processFile(file: File) {
    setLoading(true)
    setMatches(null)
    try {
      const buf = await file.arrayBuffer()
      const transactions = parsePixExtract(buf)
      if (!transactions.length) {
        showToast('Nenhuma transacao PIX encontrada no arquivo.', 'error')
        return
      }
      const found = await matchPixTransactions(transactions)
      setMatches(found)
      if (!found.length) showToast('Nenhuma correspondencia encontrada.', 'error')
    } catch (e: unknown) {
      showToast((e instanceof Error ? e.message : 'Erro ao processar arquivo.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  const confirmMutation = useMutation({
    mutationFn: () => confirmPixReconciliation((matches ?? []).filter((m) => !m.ambiguous)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['demurrage-kpis'] })
      setMatches(null)
      showToast('Conciliacao concluida. Faturas marcadas como pagas.', 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const clearMatches = () => { setMatches(null); if (fileRef.current) fileRef.current.value = '' }
  const nonAmbiguous = (matches ?? []).filter((m) => !m.ambiguous)

  return (
    <>
      <PageHeader title="Conciliacao PIX" description="Importar extrato Itau e conciliar pagamentos de demurrage" />

      {/* Upload zone */}
      <Card
        className={`mb-6 cursor-pointer border-2 border-dashed p-8 text-center transition-colors ${dragOver ? 'border-blue-500 bg-blue-900/10' : 'border-[#30363d]'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f) }}
        />
        <Upload size={32} className="mx-auto mb-3 text-slate-400" />
        <p className="font-medium text-slate-300">Arraste ou clique para selecionar a planilha</p>
        <p className="text-sm text-slate-500">Planilha "QR Codes recebidos" do Itau Empresas (.xlsx)</p>
        {loading && <p className="mt-3 text-sm text-blue-400">Processando...</p>}
      </Card>

      {/* Preview table */}
      {matches && matches.length > 0 && (
        <Card className="mb-6">
          <div className="flex items-center justify-between border-b border-[#30363d] p-4">
            <div>
              <span className="font-semibold text-slate-200">{matches.length} correspondencia(s) encontrada(s)</span>
              <span className="ml-3 text-sm text-slate-400">({nonAmbiguous.length} sem ambiguidade)</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={clearMatches}>Cancelar</Button>
              <Button size="sm" disabled={!nonAmbiguous.length || confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>
                <RefreshCw size={14} />
                {confirmMutation.isPending ? 'Conciliando...' : `Confirmar ${nonAmbiguous.length} pagamento(s)`}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="app-table min-w-[800px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Txid</th>
                  <th className="py-2">CNPJ</th>
                  <th className="py-2">Data PIX</th>
                  <th className="py-2">Valor PIX</th>
                  <th className="py-2">Invoice</th>
                  <th className="py-2">Cliente</th>
                  <th className="py-2">Total BRL</th>
                  <th className="py-2">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {matches.map((m, idx) => {
                  const inv = m.invoice as { doc_number?: string; frozen_total_brl?: number | null; customer?: { name?: string } | null }
                  return (
                    <tr key={idx} className={m.ambiguous ? 'bg-amber-900/20' : ''}>
                      <td className="py-2 font-mono text-xs">{m.transaction.txid.slice(0, 20)}...</td>
                      <td className="py-2">{m.transaction.cnpj}</td>
                      <td className="py-2">{m.transaction.date || '—'}</td>
                      <td className="py-2 font-semibold text-green-400">{fmtBRL(m.transaction.amount)}</td>
                      <td className="py-2 font-mono text-xs text-white">{inv.doc_number}</td>
                      <td className="py-2">{(inv.customer as { name?: string } | null)?.name ?? '—'}</td>
                      <td className="py-2">{inv.frozen_total_brl != null ? fmtBRL(inv.frozen_total_brl) : '—'}</td>
                      <td className="py-2">
                        {m.ambiguous
                          ? <Badge tone="yellow">Ambiguo</Badge>
                          : m.matchType === 'txid'
                          ? <Badge tone="green">Txid</Badge>
                          : <Badge tone="blue">CNPJ</Badge>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Upload } from 'lucide-react'
import type { DragEvent } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { parsePixExtract } from '../services/demurrage'
import { confirmUnifiedPixReconciliation, matchUnifiedPixTransactions } from '../services/reconciliacao'
import type { UnifiedPixMatch } from '../services/reconciliacao'

function fmtBRL(v: number) {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function Reconciliacao() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [matches, setMatches] = useState<UnifiedPixMatch[] | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const matchMutation = useMutation({
    mutationFn: async (file: File) => {
      const buf = await file.arrayBuffer()
      const transactions = parsePixExtract(buf)
      if (!transactions.length) throw new Error('Nenhuma transacao PIX encontrada.')
      return matchUnifiedPixTransactions(transactions)
    },
    onSuccess: (found) => {
      setMatches(found)
      if (!found.length) showToast('Nenhuma correspondencia encontrada.', 'info')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  function processFile(file: File) {
    setMatches(null)
    matchMutation.mutate(file)
  }

  const confirmMutation = useMutation({
    mutationFn: () => confirmUnifiedPixReconciliation((matches ?? []).filter((m) => !m.ambiguous)),
    onSuccess: ({ local, demurrage }) => {
      void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['demurrage-kpis'] })
      setMatches(null)
      showToast(`Conciliação concluída: ${local} taxas locais, ${demurrage} demurrage.`, 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const unambiguous = (matches ?? []).filter((m) => !m.ambiguous)
  const ambiguous = (matches ?? []).filter((m) => m.ambiguous)

  return (
    <>
      <PageHeader
        title="Conciliação PIX"
        description="Conciliação automática de pagamentos PIX para taxas locais e demurrage"
      />

      {/* Upload zone */}
      <div
        role="button"
        tabIndex={0}
        className={`mb-6 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${dragOver ? 'border-blue-400 bg-blue-400/10' : 'border-[#30363d] hover:border-[#58a6ff]'}`}
        onDragOver={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void processFile(f) }}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
      >
        <Upload className="mx-auto mb-3 text-slate-500" size={32} />
        <div className="text-sm text-slate-400">Arraste ou clique para selecionar o extrato PIX do Itau</div>
        <div className="mt-1 text-xs text-slate-500">Arquivo "QR Codes recebidos" .xlsx</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void processFile(f) }} />
      </div>

      {matchMutation.isPending && <Card className="text-center text-sm text-slate-400">Processando...</Card>}

      {matches !== null && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-4">
            <Card className="p-4 text-center">
              <div className="text-xs text-slate-500">Correspondencias</div>
              <div className="text-2xl font-bold text-white">{unambiguous.length}</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-xs text-slate-500">Ambiguas (ignoradas)</div>
              <div className="text-2xl font-bold text-amber-400">{ambiguous.length}</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-xs text-slate-500">Total</div>
              <div className="text-2xl font-bold text-slate-300">{matches.length}</div>
            </Card>
          </div>

          {unambiguous.length > 0 && (
            <Card className="mb-4">
              <div className="border-b border-[#30363d] p-4 text-sm font-semibold text-white">
                Correspondencias confirmadas ({unambiguous.length})
              </div>
              <div className="app-table-scroll">
                <table className="app-table app-table--compact min-w-[640px] text-sm">
                  <thead className="text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Documento</th>
                      <th className="px-3 py-2">Cliente</th>
                      <th className="px-3 py-2">Valor</th>
                      <th className="px-3 py-2">Match</th>
                      <th className="px-3 py-2">Txid PIX</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {unambiguous.map((m, i) => (
                      <tr key={`${m.invoiceId}-${m.source}-${i}`}>
                        <td className="px-3 py-2">
                          {m.source === 'demurrage' ? (
                            <Badge tone="blue">Demurrage</Badge>
                          ) : (
                            <Badge tone="green">Taxas Locais</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 font-semibold text-white">{m.docNumber}</td>
                        <td className="px-3 py-2 text-slate-300">{m.customerName}</td>
                        <td className="px-3 py-2 text-emerald-400">{fmtBRL(m.transaction.amount)}</td>
                        <td className="px-3 py-2">
                          <Badge tone={m.matchType === 'txid' ? 'green' : 'yellow'}>
                            {m.matchType === 'txid' ? 'TXID' : 'CNPJ'}
                          </Badge>
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-slate-400">{m.transaction.txid}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {ambiguous.length > 0 && (
            <Card className="mb-4 border-amber-400/30 bg-amber-400/5">
              <div className="border-b border-amber-400/20 p-4 text-sm font-semibold text-amber-200">
                Ambíguas — ignoradas na confirmação ({ambiguous.length})
              </div>
              <div className="divide-y divide-[#30363d]">
                {ambiguous.map((m, i) => (
                  <div key={`${m.invoiceId}-ambig-${i}`} className="px-4 py-2 text-sm text-amber-100">
                    {m.transaction.txid} — CNPJ {m.customerCnpj} — {fmtBRL(m.transaction.amount)} — multiplas faturas possiveis
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMatches(null)}>Limpar</Button>
            <Button
              disabled={!unambiguous.length}
              loading={confirmMutation.isPending}
              onClick={() => void confirmMutation.mutate()}
            >
              <RefreshCw size={15} />
              Confirmar {unambiguous.length} pagamento(s)
            </Button>
          </div>
        </>
      )}
    </>
  )
}

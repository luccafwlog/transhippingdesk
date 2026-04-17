import { useMemo, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import {
  importContainerDates,
  parseContainerDatesFile,
  type ContainerDatesImportRow,
  type ParsedContainerDatesImport,
} from '../../services/containerDatesImport'

export function ContainerDatesImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ParsedContainerDatesImport | null>(null)
  const [report, setReport] = useState<{ updated: number; unchanged: number; missing: number } | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const sampleRows = useMemo(() => preview?.rows.slice(0, 25) ?? [], [preview?.rows])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    setPreview(null)
    setReport(null)
    if (!nextFile) return

    setParsing(true)
    try {
      const parsed = await parseContainerDatesFile(nextFile)
      setPreview(parsed)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel ler o arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!preview?.rows.length) return
    setSubmitting(true)
    try {
      const result = await importContainerDates(preview.rows)
      setReport(result)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['demurrage-containers'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
      ])
      const errors = preview.rowErrors.length
      if (errors === 0) {
        showToast(`${result.updated} container(s) atualizado(s).`, 'success')
        resetAndClose()
        return
      }
      showToast(`${result.updated} atualizacao(oes) e ${errors} erro(s).`, 'info')
    } catch {
      showToast('Falha ao importar datas.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function resetAndClose() {
    setFile(null)
    setPreview(null)
    setReport(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar Datas de Container">
      <div className="grid gap-5">
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300">
          <div className="font-semibold text-white">Estrutura obrigatoria da planilha</div>
          <div className="mt-2">BL, Container, Discharge (data descarga), Return (data devolucao — opcional).</div>
          <div className="mt-2 text-slate-400">
            Formatos de data aceitos: DD/MM/AAAA ou AAAA-MM-DD. A coluna Return pode ser omitida ou deixada em branco.
          </div>
        </div>

        <Field label="Arquivo .xlsx, .xls ou .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
        </Field>

        {file ? <div className="text-sm text-slate-400">Arquivo: {file.name}</div> : null}
        {parsing ? <div className="text-sm text-slate-400">Processando...</div> : null}

        {preview ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <PreviewBox label="Linhas validas" value={preview.rows.length} />
              <PreviewBox label="Erros de estrutura" value={preview.rowErrors.length} />
              {report ? <PreviewBox label="Nao encontrados" value={report.missing} /> : null}
            </div>

            <div className="app-table-scroll max-h-64 rounded-xl border border-[#30363d]">
              <table className="app-table app-table--compact min-w-[540px] text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2">BL</th>
                    <th className="px-3 py-2">Container</th>
                    <th className="px-3 py-2">Descarga</th>
                    <th className="px-3 py-2">Devolucao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {sampleRows.map((row: ContainerDatesImportRow) => (
                    <tr key={`${row.bl_id}-${row.container_number}`}>
                      <td className="px-3 py-2 font-semibold text-white">{row.bl_id}</td>
                      <td className="px-3 py-2">{row.container_number}</td>
                      <td className="px-3 py-2">{row.discharge_date}</td>
                      <td className="px-3 py-2 text-slate-400">{row.return_date ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.rowErrors.length ? (
              <div className="max-h-40 overflow-auto rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                {preview.rowErrors.map((item, i) => (
                  <div key={`${item.row}-${i}`}>Linha {item.row}: {item.message}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={resetAndClose}>Cancelar</Button>
          <Button disabled={!preview?.rows.length} loading={submitting} onClick={() => void handleImport()}>
            Importar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function PreviewBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-3 text-center">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
    </div>
  )
}

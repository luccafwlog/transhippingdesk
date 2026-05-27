import { useMemo, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import {
  importCeMercanteRows,
  parseCeMercanteFile,
  type CeMercanteImportResult,
  type ParsedCeMercanteFile,
} from '../../services/ceMercanteImport'

export function CeMercanteImportModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ParsedCeMercanteFile | null>(null)
  const [report, setReport] = useState<CeMercanteImportResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const combinedErrorCount = (preview?.rowErrors.length ?? 0) + (report?.errorCount ?? 0)
  const validCount = preview?.rows.length ?? 0
  const sampleRows = useMemo(() => preview?.rows.slice(0, 25) ?? [], [preview?.rows])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    setPreview(null)
    setReport(null)

    if (!nextFile) return

    setParsing(true)
    try {
      const parsed = await parseCeMercanteFile(nextFile)
      setPreview(parsed)
      showToast('Preview de CE Mercante carregado.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível ler o arquivo.'
      showToast(message, 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!preview?.rows.length) return

    setSubmitting(true)
    try {
      const result = await importCeMercanteRows(preview.rows, { changedBy: user?.id ?? null })
      const totalErrors = preview.rowErrors.length + result.errorCount
      setReport(result)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
      ])

      if ((preview.rowErrors.length ?? 0) === 0 && result.errorCount === 0) {
        showToast(`CE Mercante atualizado em ${result.updated} B/L(s).`, 'success')
        resetAndClose()
        return
      }

      showToast(
        `Importacao concluida com ${result.updated} atualizacao(oes) e ${totalErrors} erro(s).`,
        'info',
      )
    } catch {
      showToast('Falha ao importar CE Mercante.', 'error')
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
    <Modal open={open} onClose={resetAndClose} title="Importar CE Mercante">
      <div className="grid gap-5">
        <div className="app-panel app-panel--padded text-sm">
          <div className="app-panel__title">Estrutura obrigatoria da planilha</div>
          <div className="mt-2">BL, CE MERCANTE.</div>
          <div className="app-panel__meta mt-2">
            O importador localiza o B/L existente, independentemente de ser container ou carga solta, e grava o numero do CE Mercante.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              className="app-btn app-btn--secondary"
              href="/templates/ce-mercante-modelo.xlsx"
              download="ce-mercante-modelo.xlsx"
            >
              <Download size={16} />
              Baixar modelo .xlsx
            </a>
            <a
              className="app-btn app-btn--secondary"
              href="/templates/ce-mercante-modelo.csv"
              download="ce-mercante-modelo.csv"
            >
              <Download size={16} />
              Baixar modelo .csv
            </a>
          </div>
        </div>

        <Field label="Arquivo .xlsx, .xls ou .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
        </Field>

        {file ? <div className="app-panel__meta">Arquivo selecionado: {file.name}</div> : null}
        {parsing ? <div className="app-panel__meta">Processando arquivo...</div> : null}

        {preview ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <PreviewBox label="Linhas validas" value={validCount} />
              <PreviewBox label="Erros de estrutura" value={preview.rowErrors.length} />
              <PreviewBox label="Erros totais" value={combinedErrorCount} />
            </div>

            <div className="app-table-scroll max-h-72 rounded-xl border border-[var(--app-border)]">
              <table className="app-table app-table--compact min-w-[520px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">Linha</th>
                    <th scope="col" className="px-3 py-2">BL</th>
                    <th scope="col" className="px-3 py-2">CE Mercante</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row) => (
                    <tr key={`${row.rowNumber}-${row.bl_id}`}>
                      <td className="px-3 py-2">{row.rowNumber}</td>
                      <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{row.bl_id}</td>
                      <td className="px-3 py-2">{row.ce_mercante}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.rowErrors.length || report?.errors.length ? (
              <div className="max-h-48 overflow-auto rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                {preview.rowErrors.map((item, index) => (
                  <div key={`preview-${item.row}-${index}`}>Linha {item.row}: {item.message}</div>
                ))}
                {report?.errors.map((item, index) => (
                  <div key={`report-${item.row}-${item.bl_id ?? 'sem-bl'}-${index}`}>
                    Linha {item.row}: {item.message}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="app-modal__actions">
          <Button variant="secondary" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button disabled={!preview?.rows.length} loading={submitting} onClick={handleImport}>
            <Upload size={16} />
            Confirmar importação
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function PreviewBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="app-metric-tile">
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{value}</div>
    </div>
  )
}

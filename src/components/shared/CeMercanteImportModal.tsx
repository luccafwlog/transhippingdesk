import { useMemo, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { PreviewBox } from '../ui/PreviewBox'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import {
  importCeMercanteEdi,
  importCeMercanteRows,
  parseCeMercanteFile,
  partitionRowsByVoyage,
  type CeMercanteEdiImportResult,
  type CeMercanteImportResult,
  type ParsedCeMercanteFile,
  type CeMercanteImportTarget,
} from '../../services/ceMercanteImport'
import {
  parseCeMercanteEdiFile,
  type ParsedCeMercanteEdi,
} from '../../services/ceMercanteEdiParser'
import { queryKeys } from '../../services/queryKeys'

const SHEET_EXTENSIONS = /\.(xlsx|xls|csv)$/i

export function CeMercanteImportModal({
  open,
  onClose,
  lockedVoyageId,
  target = 'bls',
}: {
  open: boolean
  onClose: () => void
  lockedVoyageId?: number
  target?: CeMercanteImportTarget
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ParsedCeMercanteFile | null>(null)
  const [report, setReport] = useState<CeMercanteImportResult | null>(null)
  const [ediPreview, setEdiPreview] = useState<ParsedCeMercanteEdi | null>(null)
  const [ediErrors, setEdiErrors] = useState<CeMercanteEdiImportResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const combinedErrorCount = (preview?.rowErrors.length ?? 0) + (report?.errorCount ?? 0)
  const validCount = preview?.rows.length ?? 0
  const sampleRows = useMemo(() => preview?.rows.slice(0, 25) ?? [], [preview?.rows])
  const ediSampleRows = useMemo(() => ediPreview?.rows.slice(0, 25) ?? [], [ediPreview?.rows])
  const ediReportErrors = ediErrors && !ediErrors.ok ? ediErrors.errors : []

  function resetState() {
    setPreview(null)
    setReport(null)
    setEdiPreview(null)
    setEdiErrors(null)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    resetState()

    if (!nextFile) return

    setParsing(true)
    try {
      if (SHEET_EXTENSIONS.test(nextFile.name)) {
        const parsed = await parseCeMercanteFile(nextFile)
        if (lockedVoyageId == null) {
          setPreview(parsed)
        } else {
          const partition = target === 'bls'
            ? await partitionRowsByVoyage(parsed.rows, lockedVoyageId)
            : await partitionRowsByVoyage(parsed.rows, lockedVoyageId, target)
          setPreview({
            rows: partition.rows,
            rowErrors: [
              ...parsed.rowErrors,
              ...partition.blocked.map((item) => ({ row: item.row, message: item.message, raw: item.bl_id })),
            ],
          })
        }
      } else {
        const parsed = await parseCeMercanteEdiFile(nextFile)
        if (lockedVoyageId == null) {
          setEdiPreview(parsed)
        } else {
          const partition = target === 'bls'
            ? await partitionRowsByVoyage(parsed.rows, lockedVoyageId)
            : await partitionRowsByVoyage(parsed.rows, lockedVoyageId, target)
          setEdiPreview({
            ...parsed,
            rows: partition.rows,
            rowErrors: [
              ...parsed.rowErrors,
              ...partition.blocked.map((item) => ({ line: item.row, message: item.message, raw: item.bl_id })),
            ],
          })
        }
      }
      showToast('Preview de CE Mercante carregado.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível ler o arquivo.'
      showToast(message, 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (preview) {
      await handleSheetImport()
      return
    }
    if (ediPreview) {
      await handleEdiImport()
    }
  }

  async function handleSheetImport() {
    if (!preview?.rows.length) return

    setSubmitting(true)
    try {
      const result = await importCeMercanteRows(preview.rows, { changedBy: user?.id ?? null, target, voyageId: lockedVoyageId })
      const totalErrors = preview.rowErrors.length + result.errorCount
      setReport(result)

      await invalidateBls()

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

  async function handleEdiImport() {
    if (!ediPreview?.rows.length) return

    setSubmitting(true)
    setEdiErrors(null)
    try {
      if (target === 'granite') {
        const result = await importCeMercanteRows(
          ediPreview.rows.map((row) => ({
            rowNumber: row.lineNumber,
            bl_id: row.bl_id,
            ce_mercante: row.ce_mercante,
          })),
          { changedBy: user?.id ?? null, target, voyageId: lockedVoyageId },
        )
        if (result.errorCount > 0) {
          setEdiErrors({
            ok: false,
            errors: result.errors.map((error) => ({ bl_id: error.bl_id, ce: undefined, message: error.message })),
          })
          await invalidateBls()
          showToast(`Importacao parcial: ${result.updated} gravado(s), ${result.errorCount} pendencia(s).`, 'error')
          return
        }
        await invalidateBls()
        showToast(`CE Mercante cadastrado em ${result.updated} B/L(s) de Granito.`, 'success')
        resetAndClose()
        return
      }

      const result = await importCeMercanteEdi(ediPreview.rows, { changedBy: user?.id ?? null })

      if (result.ok) {
        await invalidateBls()
        showToast(
          `CE Mercante cadastrado em ${result.inserted + result.overwritten} B/L(s) do manifesto.`,
          'success',
        )
        resetAndClose()
        return
      }

      setEdiErrors(result)
      showToast(
        `Importacao bloqueada: ${result.errors.length} pendencia(s). Nada foi gravado.`,
        'error',
      )
    } catch {
      showToast('Falha ao importar CE Mercante (EDI).', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function invalidateBls() {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: ['bls'] }),
      queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.customerCommunications.statusRoot() }),
    ]
    if (target === 'granite') {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['charges'] }),
      )
    }
    return Promise.all(invalidations)
  }

  function resetAndClose() {
    setFile(null)
    resetState()
    onClose()
  }

  const ediBlocked = Boolean(ediPreview && ediPreview.rowErrors.length > 0)
  const canSubmit = (preview?.rows.length ?? 0) > 0 || ((ediPreview?.rows.length ?? 0) > 0 && !ediBlocked)

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar CE Mercante">
      <div className="grid gap-5">
        <div className="app-panel app-panel--padded text-sm">
          <div className="app-panel__title">Formatos aceitos</div>
          <div className="mt-2">
            Planilha (.xlsx, .xls, .csv) com colunas <strong>BL, CE MERCANTE</strong>, ou o
            arquivo <strong>EDI do Mercante</strong> (.edi/.txt) do manifesto.
          </div>
          <div className="app-panel__meta mt-2">
            No EDI, o sistema lê os registros C (CE ↔ BL), confere que todos os B/Ls do manifesto
            têm CE e que não há CE/BL duplicado. Se algo falhar, nada é gravado.
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

        <Field label="Arquivo .xlsx, .xls, .csv ou EDI (.edi/.txt)">
          <Input accept=".xlsx,.xls,.csv,.edi,.txt" type="file" onChange={handleFile} />
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

            <PreviewTable rows={sampleRows.map((row) => ({ ref: row.rowNumber, bl: row.bl_id, ce: row.ce_mercante }))} refLabel="Linha" />

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

        {ediPreview ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <PreviewBox label="Registros (CE ↔ BL)" value={ediPreview.rows.length} />
              <PreviewBox label="Erros de estrutura" value={ediPreview.rowErrors.length} />
              <PreviewBox label="Erros de validacao" value={ediReportErrors.length} />
            </div>

            {ediPreview.manifestRef ? (
              <div className="app-panel__meta text-sm">
                Manifesto detectado:{' '}
                <span className="font-semibold text-[var(--app-text-strong)]">{ediPreview.manifestRef}</span>
              </div>
            ) : null}

            <PreviewTable rows={ediSampleRows.map((row) => ({ ref: row.lineNumber, bl: row.bl_id, ce: row.ce_mercante }))} refLabel="Linha EDI" />

            {ediPreview.rowErrors.length || ediReportErrors.length ? (
              <div className="max-h-48 overflow-auto rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                {ediPreview.rowErrors.map((item, index) => (
                  <div key={`edi-parse-${item.line}-${index}`}>Linha {item.line}: {item.message}</div>
                ))}
                {ediReportErrors.map((item, index) => (
                  <div key={`edi-report-${item.bl_id ?? item.ce ?? 'geral'}-${index}`}>{item.message}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="app-modal__actions">
          <Button variant="secondary" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button disabled={!canSubmit} loading={submitting} onClick={handleImport}>
            <Upload size={16} />
            Confirmar importação
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function PreviewTable({
  rows,
  refLabel,
}: {
  rows: Array<{ ref: number; bl: string; ce: string }>
  refLabel: string
}) {
  return (
    <div className="app-table-scroll max-h-72 rounded-xl border border-[var(--app-border)]">
      <table className="app-table app-table--compact min-w-[520px] text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2">{refLabel}</th>
            <th scope="col" className="px-3 py-2">BL</th>
            <th scope="col" className="px-3 py-2">CE Mercante</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.ref}-${row.bl}`}>
              <td className="px-3 py-2">{row.ref}</td>
              <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{row.bl}</td>
              <td className="px-3 py-2">{row.ce}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

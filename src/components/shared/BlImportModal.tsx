import { useMemo, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { parseBLFile } from '../../services/blParser'
import {
  confirmBlFreightImport,
  previewBlFreightImport,
  type BlFreightImportPreview,
  type BlFreightImportRow,
} from '../../services/blFreightImport'
import { applyLadenOnBoardAtd } from '../../services/ladenOnBoardAtd'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { VoyageCombobox } from './VoyageCombobox'

export function BlImportModal({
  open,
  onClose,
  voyageId = null,
  voyageLabel,
  onlyBlId = null,
}: {
  open: boolean
  onClose: () => void
  voyageId?: number | null
  voyageLabel?: string
  onlyBlId?: string | null
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<BlFreightImportPreview | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [overrideBilling, setOverrideBilling] = useState(false)
  const [selectedVoyageId, setSelectedVoyageId] = useState<number | null>(voyageId)

  const importableCount = useMemo(
    () => preview?.rows.filter((row) => Boolean(row.payload)).length ?? 0,
    [preview],
  )
  const billingOverrideCount = preview?.summary.billingOverrideCount ?? 0

  function resetAndClose() {
    setFiles([])
    setPreview(null)
    setParsing(false)
    setSubmitting(false)
    setOverrideBilling(false)
    setSelectedVoyageId(voyageId ?? null)
    onClose()
  }

  function handleVoyageSelect(nextVoyageId: number | null) {
    setSelectedVoyageId(nextVoyageId)
    setPreview(null)
    setOverrideBilling(false)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? [])
    setFiles(selectedFiles)
    setPreview(null)
    setOverrideBilling(false)
    if (!selectedFiles.length) return
    if (!selectedVoyageId) {
      showToast('Selecione a viagem antes de carregar o preview do B/L.', 'error')
      return
    }

    setParsing(true)
    try {
      const documents = []
      for (const file of selectedFiles) {
        try {
          documents.push(await parseBLFile(file))
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Falha ao ler arquivo.'
          showToast(`${file.name}: ${message}`, 'error')
        }
      }

      if (!documents.length) return

      const nextPreview = await previewBlFreightImport({
        documents,
        voyageId: selectedVoyageId,
        onlyBlId,
      })
      setPreview(nextPreview)

      if (nextPreview.summary.blockedCount > 0 && nextPreview.rows.every((row) => !row.payload)) {
        showToast(`Importacao bloqueada: ${nextPreview.summary.blockedCount} B/L(s). Nada sera gravado.`, 'error')
        return
      }

      showToast(
        `Preview de B/L carregado: ${nextPreview.summary.total} B/L(s), ${nextPreview.summary.blockedCount} bloqueado(s).`,
        nextPreview.summary.blockedCount ? 'info' : 'success',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao preparar preview de B/L.'
      showToast(message, 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleConfirm() {
    if (!preview || importableCount === 0) return

    setSubmitting(true)
    try {
      await confirmBlFreightImport(preview, user?.id ?? '', overrideBilling)
      try {
        await applyLadenOnBoardAtd({ rows: preview.rows, changedBy: user?.id ?? null })
      } catch {
        showToast('B/Ls importados; ATD do POL não pôde ser atualizado — edite manualmente.', 'info')
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-pol-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] }),
      ])
      showToast(
        `Importacao de B/L concluida: ${importableCount} B/L(s), ${preview.summary.blockedCount} bloqueado(s).`,
        'success',
      )
      resetAndClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao confirmar importacao de B/L.'
      showToast(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar B/L">
      <div className="grid gap-5">
        {onlyBlId ? (
          <div className="app-panel app-panel--padded text-sm">
            B/L: <span className="font-semibold text-[var(--app-text-strong)]">{onlyBlId}</span>
          </div>
        ) : null}

        <VoyageCombobox
          key={`${open ? 'open' : 'closed'}-${voyageId ?? 'none'}-${voyageLabel ?? ''}`}
          required
          initialValue={voyageLabel}
          selectedVoyageId={selectedVoyageId}
          onSelect={handleVoyageSelect}
        />

        <Field label="Arquivo .xlsx / .xls">
          <Input accept=".xlsx,.xls" multiple type="file" onChange={handleFile} />
        </Field>

        {files.length ? (
          <div className="app-panel__meta">
            {files.length} arquivo(s) selecionado(s): {files.map((file) => file.name).join(', ')}
          </div>
        ) : null}
        {parsing ? <div className="app-panel__meta">Processando arquivo...</div> : null}

        {preview ? <BlImportPreview preview={preview} /> : null}

        {billingOverrideCount > 0 ? (
          <label className="app-panel app-panel--padded flex items-start gap-2 text-sm text-amber-200">
            <input
              type="checkbox"
              className="mt-1"
              checked={overrideBilling}
              onChange={(event) => setOverrideBilling(event.target.checked)}
            />
            <span>
              Sobrescrever faturamento em {billingOverrideCount} B/L(s) com impacto (quantidade de containers,
              container compartilhado, IMO/OOG, peso de carga solta ou CNPJ faturado). Sem marcar, os demais campos
              sao aplicados e as mudancas com impacto em faturamento sao ignoradas.
            </span>
          </label>
        ) : null}

        <div className="app-modal__actions">
          <Button variant="secondary" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button disabled={!selectedVoyageId || importableCount === 0} loading={submitting || parsing} onClick={() => void handleConfirm()}>
            <Upload size={16} />
            Confirmar importacao
          </Button>
        </div>
        {!selectedVoyageId ? (
          <div className="text-sm text-amber-700">Selecione uma viagem para habilitar a importacao.</div>
        ) : null}
      </div>
    </Modal>
  )
}

function BlImportPreview({ preview }: { preview: BlFreightImportPreview }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <PreviewBox label="Novos" value={preview.summary.newCount} />
        <PreviewBox label="Atualizados" value={preview.summary.updatedCount} />
        <PreviewBox label="Sem mudanca" value={preview.summary.unchangedCount} />
        <PreviewBox label="Bloqueados" value={preview.summary.blockedCount} />
      </div>

      <div className="app-table-scroll max-h-80 rounded-xl border border-[var(--app-border)]">
        <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2">B/L</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Viagem</th>
              <th scope="col" className="px-3 py-2">Laden on Board</th>
              <th scope="col" className="px-3 py-2">Diferencas</th>
              <th scope="col" className="px-3 py-2">Bloqueios / Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.blNumber}>
                <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{row.blNumber}</td>
                <td className="px-3 py-2">
                  <StatusPill status={row.status} />
                </td>
                <td className="px-3 py-2">{row.voyageId ?? '-'}</td>
                <td className="px-3 py-2">{row.ladenOnBoard ?? '-'}</td>
                <td className="px-3 py-2">
                  <DiffList row={row} />
                </td>
                <td className="px-3 py-2">
                  {row.blockedReasons.length || row.billingImpacts.length ? (
                    <ul className="grid gap-1 text-xs">
                      {row.blockedReasons.map((reason) => (
                        <li key={reason} className="text-red-300">{reason}</li>
                      ))}
                      {row.billingImpacts.map((reason) => (
                        <li key={reason} className="text-amber-300">Faturamento: {reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-[var(--app-muted-soft)]">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DiffList({ row }: { row: BlFreightImportRow }) {
  if (!row.diffs.length) {
    return <span className="text-xs text-[var(--app-muted-soft)]">-</span>
  }

  return (
    <div className="grid gap-1">
      {row.diffs.map((diff) => (
        <div key={`${row.blNumber}-${diff.field}`} className={diff.billingImpact ? 'text-amber-300' : undefined}>
          <span className="font-semibold">{diff.field}</span>:{' '}
          <span>{formatDiffValue(diff.from)}</span> {'->'} <span>{formatDiffValue(diff.to)}</span>
          {diff.billingImpact ? <span className="ml-1 text-xs">(faturamento)</span> : null}
        </div>
      ))}
    </div>
  )
}

function StatusPill({ status }: { status: BlFreightImportRow['status'] }) {
  const labels: Record<BlFreightImportRow['status'], string> = {
    new: 'Novo',
    updated: 'Atualizado',
    unchanged: 'Sem mudanca',
    blocked: 'Bloqueado',
  }
  const tone = status === 'blocked'
    ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
    : status === 'new'
      ? 'border-green-400/40 bg-green-400/10 text-green-200'
      : status === 'updated'
        ? 'border-sky-400/40 bg-sky-400/10 text-sky-200'
        : 'border-slate-400/30 bg-slate-400/10 text-slate-300'

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {labels[status]}
    </span>
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

function formatDiffValue(value: string | number | null) {
  if (value === null || value === '') return '-'
  return String(value)
}

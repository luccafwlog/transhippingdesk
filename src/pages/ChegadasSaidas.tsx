import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Archive, Download, FileSpreadsheet, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import * as XLSX from '@e965/xlsx'
import { Card, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { supabase } from '../services/supabase'
import type { VesselSchedule } from '../types/database'

const emptyVessel = {
  vessel_name: '',
  voyage: '',
  qingdao_etd: 'X',
  shanghai_etd: 'X',
  taicang_etd: 'X',
  ningbo_etd: 'X',
  nansha_etd: 'X',
  salvador_eta: 'X',
  vitoria_eta: 'X',
  pecem_eta: 'X',
  imo_number: '',
}

type FormData = typeof emptyVessel

type DateCellValue = {
  value: string
  isPast: boolean
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr || dateStr === 'X') return null
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10) - 1
  const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear()
  return new Date(year, month, day)
}

function isPast(value: string) {
  const d = parseDate(value)
  if (!d) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function dateCellValue(value: string): DateCellValue {
  return { value, isPast: isPast(value) }
}

function DateTd({ value }: { value: string }) {
  const info = dateCellValue(value)
  const isX = value === 'X'
  return (
    <td className={`px-3 py-2.5 text-center text-sm border-r border-[var(--app-border)] ${isX ? 'text-[var(--app-muted-soft)]' : info.isPast ? 'text-[var(--app-blue)] font-semibold' : ''}`}>
      {value}
    </td>
  )
}

function VesselForm({ formData, onChange, onSubmit, onCancel, isEditing }: {
  formData: FormData
  onChange: (data: FormData) => void
  onSubmit: () => void
  onCancel: () => void
  isEditing: boolean
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="app-field">
          <label className="app-field__label" htmlFor="vessel_name">Nome do Navio</label>
          <input id="vessel_name" className="app-input app-input--full" value={formData.vessel_name}
            onChange={(e) => onChange({ ...formData, vessel_name: e.target.value })} placeholder="GREEN PECEM" required />
        </div>
        <div className="app-field">
          <label className="app-field__label" htmlFor="voyage">Viagem (VOY)</label>
          <input id="voyage" className="app-input app-input--full" value={formData.voyage}
            onChange={(e) => onChange({ ...formData, voyage: e.target.value })} placeholder="6" required />
        </div>
      </div>
      <div className="app-field">
        <label className="app-field__label" htmlFor="imo_number">Número IMO</label>
        <input id="imo_number" className="app-input app-input--full" value={formData.imo_number}
          onChange={(e) => onChange({ ...formData, imo_number: e.target.value })} placeholder="9976501" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="app-field">
          <label className="app-field__label" htmlFor="qingdao_etd">Qingdao ETD</label>
          <input id="qingdao_etd" className="app-input app-input--full" value={formData.qingdao_etd}
            onChange={(e) => onChange({ ...formData, qingdao_etd: e.target.value })} placeholder="04/12/2025 ou X" />
        </div>
        <div className="app-field">
          <label className="app-field__label" htmlFor="shanghai_etd">Shanghai ETD</label>
          <input id="shanghai_etd" className="app-input app-input--full" value={formData.shanghai_etd}
            onChange={(e) => onChange({ ...formData, shanghai_etd: e.target.value })} placeholder="05/12/2025 ou X" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="app-field">
          <label className="app-field__label" htmlFor="taicang_etd">Taicang ETD</label>
          <input id="taicang_etd" className="app-input app-input--full" value={formData.taicang_etd}
            onChange={(e) => onChange({ ...formData, taicang_etd: e.target.value })} placeholder="07/12/2025 ou X" />
        </div>
        <div className="app-field">
          <label className="app-field__label" htmlFor="ningbo_etd">Ningbo ETD</label>
          <input id="ningbo_etd" className="app-input app-input--full" value={formData.ningbo_etd}
            onChange={(e) => onChange({ ...formData, ningbo_etd: e.target.value })} placeholder="12/12/2025 ou X" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="app-field">
          <label className="app-field__label" htmlFor="nansha_etd">Nansha ETD</label>
          <input id="nansha_etd" className="app-input app-input--full" value={formData.nansha_etd}
            onChange={(e) => onChange({ ...formData, nansha_etd: e.target.value })} placeholder="17/12/2025 ou X" />
        </div>
        <div className="app-field">
          <label className="app-field__label" htmlFor="salvador_eta">Salvador ETA</label>
          <input id="salvador_eta" className="app-input app-input--full" value={formData.salvador_eta}
            onChange={(e) => onChange({ ...formData, salvador_eta: e.target.value })} placeholder="22/01/2026 ou X" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="app-field">
          <label className="app-field__label" htmlFor="vitoria_eta">Vitória ETA</label>
          <input id="vitoria_eta" className="app-input app-input--full" value={formData.vitoria_eta}
            onChange={(e) => onChange({ ...formData, vitoria_eta: e.target.value })} placeholder="25/01/2026 ou X" />
        </div>
        <div className="app-field">
          <label className="app-field__label" htmlFor="pecem_eta">Pecém ETA</label>
          <input id="pecem_eta" className="app-input app-input--full" value={formData.pecem_eta}
            onChange={(e) => onChange({ ...formData, pecem_eta: e.target.value })} placeholder="28/01/2026 ou X" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button type="button" className="app-btn app-btn--secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="app-btn app-btn--primary">{isEditing ? 'Salvar Alterações' : 'Adicionar'}</button>
      </div>
    </form>
  )
}

function SpreadsheetUpload({ onUpdate }: { onUpdate: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ updated: string[]; notFound: string[]; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  const downloadTemplate = async () => {
    const { data } = await supabase.from('vessel_schedules').select('*').order('display_order', { ascending: true })
    const rows = [
      { 'VESSEL NAME': 'EXEMPLO NAVIO', 'VOY': '1', 'QINGDAO ETD': '01/01/2026', 'SHANGHAI ETD': '02/01/2026',
        'TAICANG ETD': '03/01/2026', 'NINGBO ETD': '04/01/2026', 'NANSHA ETD': '05/01/2026',
        'SALVADOR ETA': '20/01/2026', 'VITÓRIA ETA': '22/01/2026', 'PECÉM ETA': 'X' },
      ...(data ?? []).map((v) => ({
        'VESSEL NAME': v.vessel_name, 'VOY': v.voyage,
        'QINGDAO ETD': v.qingdao_etd || 'X', 'SHANGHAI ETD': v.shanghai_etd || 'X',
        'TAICANG ETD': v.taicang_etd || 'X', 'NINGBO ETD': v.ningbo_etd || 'X',
        'NANSHA ETD': v.nansha_etd || 'X', 'SALVADOR ETA': v.salvador_eta || 'X',
        'VITÓRIA ETA': v.vitoria_eta || 'X', 'PECÉM ETA': v.pecem_eta || 'X',
      })),
    ]
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 25 }, { wch: 8 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Navios')
    XLSX.writeFile(wb, 'modelo_navios.xlsx')
    showToast('Planilha modelo baixada!', 'info')
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setResult(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { cellDates: false })
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { raw: true })

      const { data: vessels } = await supabase.from('vessel_schedules').select('*')
      if (!vessels) { showToast('Erro ao carregar navios existentes', 'error'); return }

      const r = { updated: [] as string[], notFound: [] as string[], errors: [] as string[] }

      for (const row of rows) {
        const name = String(row['VESSEL NAME'] || row['Vessel Name'] || row['vessel_name'] || '').trim()
        if (!name || name === 'EXEMPLO NAVIO') continue
        const match = vessels.find((v) => v.vessel_name.toLowerCase().trim() === name.toLowerCase())
        if (!match) { r.notFound.push(name); continue }
        const updates: Record<string, string> = {}
        const map: Record<string, string> = {
          'VOY': 'voyage', 'QINGDAO ETD': 'qingdao_etd', 'SHANGHAI ETD': 'shanghai_etd',
          'TAICANG ETD': 'taicang_etd', 'NINGBO ETD': 'ningbo_etd', 'NANSHA ETD': 'nansha_etd',
          'SALVADOR ETA': 'salvador_eta', 'VITÓRIA ETA': 'vitoria_eta', 'VITORIA ETA': 'vitoria_eta',
          'PECÉM ETA': 'pecem_eta', 'PECEM ETA': 'pecem_eta',
        }
        for (const [col, field] of Object.entries(map)) {
          const raw = row[col]
          if (raw == null || raw === '') continue
          if (field === 'voyage') { updates[field] = String(raw).trim(); continue }
          const val = String(raw).trim()
          updates[field] = val
        }
        if (Object.keys(updates).length > 0) {
          const { error } = await supabase.from('vessel_schedules').update(updates).eq('id', match.id)
          if (error) r.errors.push(`${name}: ${error.message}`)
          else r.updated.push(name)
        }
      }
      setResult(r)
      if (r.updated.length > 0) { showToast(`${r.updated.length} navio(s) atualizado(s)!`, 'success'); onUpdate() }
      else showToast('Nenhum navio foi atualizado', 'error')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao processar planilha', 'error')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-4">
        <FileSpreadsheet className="w-5 h-5 text-[var(--app-blue)]" />
        <h2 className="text-base font-semibold">Atualização em Lote via Planilha</h2>
      </div>
      <p className="text-sm text-[var(--app-muted)] mb-4">
        Baixe a planilha modelo, preencha as datas e faça o upload para atualizar múltiplos navios de uma só vez.
      </p>
      <div className="flex flex-wrap gap-3 mb-4">
        <button type="button" className="app-btn app-btn--secondary app-btn--sm" onClick={downloadTemplate}>
          <Download size={14} /> Baixar Planilha Modelo
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" id="sheet-upload" />
        <button type="button" className="app-btn app-btn--primary app-btn--sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload size={14} /> {uploading ? 'Processando...' : 'Fazer Upload'}
        </button>
      </div>
      {result && (
        <div className="space-y-2 mt-4 pt-4 border-t border-[var(--app-border)] text-sm">
          {result.updated.length > 0 && <div className="text-[var(--app-green)] font-medium">{result.updated.length} atualizado(s)</div>}
          {result.notFound.length > 0 && <div className="text-[var(--app-gold)]">{result.notFound.length} não encontrado(s)</div>}
          {result.errors.length > 0 && <div className="text-[var(--app-red)]">{result.errors.length} erro(s)</div>}
        </div>
      )}
      <div className="mt-4 text-xs text-[var(--app-muted)] bg-[var(--app-surface-muted)] p-3 rounded-lg">
        <strong>Dica:</strong> O nome do navio na planilha deve ser exatamente igual ao cadastrado. Use "X" para datas não programadas. Formato: DD/MM/AAAA.
      </div>
    </Card>
  )
}

export function ChegadasSaidas() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<FormData>(emptyVessel)
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const { data: vessels = [], isLoading } = useQuery({
    queryKey: ['admin-vessel-schedules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vessel_schedules').select('*').order('display_order', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as VesselSchedule[]
    },
  })

  const openAdd = () => { setEditingId(null); setFormData(emptyVessel); setDialogOpen(true) }

  const openEdit = (v: VesselSchedule) => {
    setEditingId(v.id)
    setFormData({
      vessel_name: v.vessel_name, voyage: v.voyage, imo_number: v.imo_number || '',
      qingdao_etd: v.qingdao_etd, shanghai_etd: v.shanghai_etd, taicang_etd: v.taicang_etd,
      ningbo_etd: v.ningbo_etd, nansha_etd: v.nansha_etd, salvador_eta: v.salvador_eta,
      vitoria_eta: v.vitoria_eta, pecem_eta: v.pecem_eta || 'X',
    })
    setDialogOpen(true)
  }

  const closeDialog = () => { setDialogOpen(false); setEditingId(null); setFormData(emptyVessel) }

  const handleSubmit = async () => {
    if (editingId) {
      const { error } = await supabase.from('vessel_schedules').update(formData).eq('id', editingId)
      if (error) { showToast(`Erro ao atualizar: ${error.message}`, 'error'); return }
      showToast('Navio atualizado!', 'success')
    } else {
      const maxOrder = vessels.length > 0 ? Math.max(...vessels.map((v) => v.display_order ?? 0)) : -1
      const { error } = await supabase.from('vessel_schedules').insert([{ ...formData, display_order: maxOrder + 1 }])
      if (error) { showToast(`Erro ao adicionar: ${error.message}`, 'error'); return }
      showToast('Navio adicionado!', 'success')
    }
    queryClient.invalidateQueries({ queryKey: ['admin-vessel-schedules'] })
    closeDialog()
  }

  const moveVessel = async (index: number, dir: 'up' | 'down') => {
    if ((dir === 'up' && index === 0) || (dir === 'down' && index === vessels.length - 1)) return
    const list = [...vessels]
    const newIdx = dir === 'up' ? index - 1 : index + 1
    const [moved] = list.splice(index, 1)
    list.splice(newIdx, 0, moved)
    const results = await Promise.all(list.map((v, i) => supabase.from('vessel_schedules').update({ display_order: i }).eq('id', v.id)))
    if (results.some((r) => r.error)) showToast('Erro ao reordenar', 'error')
    queryClient.invalidateQueries({ queryKey: ['admin-vessel-schedules'] })
  }

  const handleEnd = async (v: VesselSchedule) => {
    if (!confirm(`Encerrar "${v.vessel_name}"? Será arquivado e removido da tabela ativa.`)) return
    const { error: insErr } = await supabase.from('ended_vessels').insert([{
      original_id: v.id, vessel_name: v.vessel_name, voyage: v.voyage, imo_number: v.imo_number,
      qingdao_etd: v.qingdao_etd, shanghai_etd: v.shanghai_etd, taicang_etd: v.taicang_etd,
      ningbo_etd: v.ningbo_etd, nansha_etd: v.nansha_etd, salvador_eta: v.salvador_eta,
      vitoria_eta: v.vitoria_eta, pecem_eta: v.pecem_eta,
    }])
    if (insErr) { showToast(`Erro ao arquivar: ${insErr.message}`, 'error'); return }
    const { error: delErr } = await supabase.from('vessel_schedules').delete().eq('id', v.id)
    if (delErr) { showToast(`Erro ao remover: ${delErr.message}`, 'error'); return }
    showToast(`${v.vessel_name} encerrado!`, 'success')
    queryClient.invalidateQueries({ queryKey: ['admin-vessel-schedules'] })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir permanentemente?')) return
    const { error } = await supabase.from('vessel_schedules').delete().eq('id', id)
    if (error) { showToast(`Erro ao excluir: ${error.message}`, 'error'); return }
    showToast('Navio excluído!', 'success')
    queryClient.invalidateQueries({ queryKey: ['admin-vessel-schedules'] })
  }

  const downloadEnded = async () => {
    const { data } = await supabase.from('ended_vessels').select('*').order('ended_at', { ascending: false })
    if (!data || data.length === 0) { showToast('Nenhum navio encerrado', 'info'); return }
    const rows = data.map((v) => ({
      'VESSEL NAME': v.vessel_name, 'VOY': v.voyage, 'IMO': v.imo_number || '',
      'QINGDAO ETD': v.qingdao_etd || 'X', 'SHANGHAI ETD': v.shanghai_etd || 'X',
      'TAICANG ETD': v.taicang_etd || 'X', 'NINGBO ETD': v.ningbo_etd || 'X',
      'NANSHA ETD': v.nansha_etd || 'X', 'SALVADOR ETA': v.salvador_eta || 'X',
      'VITÓRIA ETA': v.vitoria_eta || 'X', 'PECÉM ETA': v.pecem_eta || 'X',
      'ENCERRADO EM': new Date(v.ended_at).toLocaleDateString('pt-BR'),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Encerrados')
    XLSX.writeFile(wb, 'navios_encerrados.xlsx')
    showToast('Planilha de encerrados baixada!', 'success')
  }

  return (
    <>
      <PageHeader
        title="Chegadas e Saídas"
        description="Gerencie a programação de navios exibida no Portal do Cliente."
        action={
          <div className="flex gap-2">
            <button type="button" className="app-btn app-btn--secondary app-btn--sm" onClick={downloadEnded}>
              <Download size={14} /> Exportar Encerrados
            </button>
            <button type="button" className="app-btn app-btn--primary app-btn--sm" onClick={openAdd}>
              <Plus size={14} /> Adicionar Navio
            </button>
          </div>
        }
      />

      {dialogOpen && (
        <div className="app-modal-backdrop" onClick={closeDialog}>
          <div className="app-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="app-modal__header">
              <h2 className="app-modal__title">{editingId ? 'Editar Navio' : 'Adicionar Navio'}</h2>
              <button type="button" className="app-btn app-btn--ghost app-modal__close" onClick={closeDialog}>&times;</button>
            </div>
            <div className="app-modal__body">
              <VesselForm formData={formData} onChange={setFormData} onSubmit={handleSubmit} onCancel={closeDialog} isEditing={!!editingId} />
            </div>
          </div>
        </div>
      )}

      <div className="app-soft-panel" style={{ padding: 0 }}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--app-navy)] text-white">
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10 w-24">Ordem</th>
                <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider border-r border-white/10">Navio</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10 w-14">VOY</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">Qingdao</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">Shanghai</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">Taicang</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">Ningbo</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">Nansha</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">Salvador</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">Vitória</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">Pecém</th>
                <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={12} className="text-center py-8 text-sm text-[var(--app-muted)]">Carregando...</td></tr>
              ) : vessels.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-8 text-sm text-[var(--app-muted)]">Nenhum navio cadastrado.</td></tr>
              ) : vessels.map((vessel, index) => (
                <tr key={vessel.id} className={`${index % 2 === 0 ? '' : 'bg-[var(--app-surface-muted)]'} hover:bg-[var(--app-blue-soft)] transition-colors border-b border-[var(--app-border)] last:border-b-0`}>
                  <td className="px-2 py-2 text-center border-r border-[var(--app-border)]">
                    <div className="flex justify-center gap-1">
                      <button type="button" className="app-btn app-btn--ghost app-btn--sm" style={{ minHeight: 32, minWidth: 32, padding: 0 }}
                        onClick={() => moveVessel(index, 'up')} disabled={index === 0} title="Subir">
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" className="app-btn app-btn--ghost app-btn--sm" style={{ minHeight: 32, minWidth: 32, padding: 0 }}
                        onClick={() => moveVessel(index, 'down')} disabled={index === vessels.length - 1} title="Descer">
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 border-r border-[var(--app-border)] text-sm font-semibold text-[var(--app-blue)]">
                    {vessel.imo_number ? (
                      <a href={`https://www.marinetraffic.com/en/ais/details/ships/imo:${vessel.imo_number}`}
                        target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">{vessel.vessel_name}</a>
                    ) : vessel.vessel_name}
                  </td>
                  <td className="px-3 py-2.5 text-center border-r border-[var(--app-border)] text-sm">{vessel.voyage}</td>
                  <DateTd value={vessel.qingdao_etd} />
                  <DateTd value={vessel.shanghai_etd} />
                  <DateTd value={vessel.taicang_etd} />
                  <DateTd value={vessel.ningbo_etd} />
                  <DateTd value={vessel.nansha_etd} />
                  <DateTd value={vessel.salvador_eta} />
                  <DateTd value={vessel.vitoria_eta} />
                  <DateTd value={vessel.pecem_eta || 'X'} />
                  <td className="px-2 py-2 text-center">
                    <div className="flex justify-center gap-1">
                      <button type="button" className="app-btn app-btn--ghost app-btn--sm" style={{ minHeight: 32, minWidth: 32, padding: 0 }}
                        onClick={() => openEdit(vessel)} title="Editar"><Pencil size={14} /></button>
                      <button type="button" className="app-btn app-btn--ghost app-btn--sm" style={{ minHeight: 32, minWidth: 32, padding: 0, color: 'var(--app-blue)' }}
                        onClick={() => handleEnd(vessel)} title="Encerrar"><Archive size={14} /></button>
                      <button type="button" className="app-btn app-btn--ghost app-btn--sm" style={{ minHeight: 32, minWidth: 32, padding: 0, color: 'var(--app-red)' }}
                        onClick={() => handleDelete(vessel.id)} title="Excluir"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6">
        <SpreadsheetUpload onUpdate={() => queryClient.invalidateQueries({ queryKey: ['admin-vessel-schedules'] })} />
      </div>
    </>
  )
}

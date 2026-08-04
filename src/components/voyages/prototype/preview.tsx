// PROTÓTIPO — preview das três faixas com dados falsos, sem Supabase.
// Serve só para olhar o layout lado a lado: `npm run dev` + /prototype-viagens-strip.html
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../index.css'
import { VariantA, VariantB, VariantC } from './VoyageStripVariants'
import type { VoyageRailItem } from '../../../services/voyageSummaries'

const ITEMS: VoyageRailItem[] = [
  ['COSCO SHIPPING SPECIALIZED CARRIERS', 'ZYHY JIN QU', '39', ['CNNGB', 'CNNSA', 'CNTAC'], ['BRSSA', 'BRVIX'], 129, 759, 'incompleto', 'BRSSA', '2026-07-25'],
  ['MSC MEDITERRANEAN SHIPPING', 'MSC ALTAIR', '128W', ['SGSIN', 'MYPKG'], ['BRSSA', 'BRRIO'], 84, 402, 'conciliado', 'BRSSA', '2026-08-06'],
  ['MAERSK LINE', 'MAERSK CAMPTON', '441S', ['NLRTM'], ['BRVIX'], 32, 190, 'divergente', 'BRVIX', '2026-08-11'],
  ['HAPAG-LLOYD', 'BREMEN EXPRESS', '77E', ['DEHAM', 'BEANR'], ['BRSSA'], 12, 61, 'conciliado', 'BRSSA', '2026-08-19'],
  ['CMA CGM', 'CMA CGM LYRA', '0PL5W', ['FRLEH'], ['BRIGI', 'BRSSA'], 57, 288, 'incompleto', 'BRIGI', '2026-09-02'],
  ['ONE OCEAN NETWORK EXPRESS', 'ONE MADRID', '015N', ['JPYOK'], ['BRVIX'], 9, 44, 'conciliado', null, null],
].map(([carrierName, vesselName, voyageNumber, originPorts, destinationPorts, blCount, containerCount, estado, pod, eta], i) => ({
  id: i + 1,
  carrierName, vesselName, voyageNumber,
  status: 'active',
  originPorts, destinationPorts, blCount, containerCount, estado,
  proximaEscala: pod ? { pod, eta, etb: null } : null,
} as VoyageRailItem))

export function Preview() {
  const [selected, setSelected] = useState<number | null>(1)
  const shared = { items: ITEMS, selectedId: selected, onSelect: setSelected, onEdit: () => {} }
  return (
    <div className="app-main" style={{ display: 'grid', gap: 40 }}>
      {([['A — Faixa de cards', VariantA], ['B — Trilho compacto', VariantB], ['C — Linha do tempo', VariantC]] as const).map(([label, Variant]) => (
        <section key={label}>
          <h2 style={{ marginBottom: 10, fontWeight: 700 }}>{label}</h2>
          <Variant {...shared} />
          <div style={{ marginTop: 12, borderRadius: 16, border: '1px dashed var(--app-border)', padding: 28, textAlign: 'center', color: 'var(--app-muted)' }}>
            painel de detalhe da viagem {selected}
          </div>
        </section>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)

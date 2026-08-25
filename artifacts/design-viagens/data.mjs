// Dados de amostra realistas (não são registros reais). Nomes de navio,
// armador e portos seguem o vocabulário de CONTEXT.md — inclusive o alias
// ZYHY = ZHONG YUAN HAI YUN e a marca OMIT para escala omitida.
export const VOYAGES = [
  {
    id: 1, carrier: 'COSCO SHIPPING', vessel: 'COSCO SHIPPING ARIES', voy: '088E',
    pol: 'CNNGB · CNSHA', pod: 'BRSSZ · BRVIX', estado: 'conciliado',
    bls: 10, cntr: 13, ce: '10/10',
    escalas: [{ port: 'BRSSZ', eta: '28/08' }, { port: 'BRVIX', eta: '01/09' }],
    mods: ['box', 'file'],
    ports: { BRSSZ: '28/08', BRVIX: '01/09', BRPNG: 'X', BRRIG: 'X' },
  },
  {
    id: 2, carrier: 'COSCO SHIPPING', vessel: 'XIN PU DONG', voy: '012S',
    pol: 'CNSHA', pod: 'BRSSZ', estado: 'conciliado',
    bls: 2, cntr: 3, ce: '2/2',
    escalas: [{ port: 'BRSSZ', eta: '30/08' }],
    mods: ['box'],
    ports: { BRSSZ: '30/08', BRVIX: 'X', BRPNG: 'X', BRRIG: 'X' },
  },
  {
    id: 3, carrier: 'ZYHY', vessel: 'ZHONG YUAN HAI YUN 26', voy: '145W',
    pol: 'CNTAO · CNSHA', pod: 'BRPNG · BRSSZ', estado: 'incompleto',
    bls: 24, cntr: 61, ce: '18/24',
    escalas: [{ port: 'BRPNG', eta: '02/09' }, { port: 'BRSSZ', eta: '05/09' }],
    mods: ['box', 'file', 'car'],
    ports: { BRSSZ: '05/09', BRVIX: 'X', BRPNG: '02/09', BRRIG: 'X' },
  },
  {
    id: 4, carrier: 'COSCO SHIPPING', vessel: 'COSCO SHIPPING TAURUS', voy: '031E',
    pol: 'CNXMN', pod: 'BRVIX · BRSSZ', estado: 'conciliado',
    bls: 7, cntr: 15, ce: '7/7',
    escalas: [{ port: 'BRVIX', eta: '04/09', ata: true }, { port: 'BRSSZ', eta: '08/09' }],
    mods: ['box', 'mountain'],
    ports: { BRSSZ: '08/09', BRVIX: '04/09', BRPNG: 'X', BRRIG: 'X' },
  },
  {
    id: 5, carrier: 'COSCO SHIPPING', vessel: 'XIN YAN TIAN', voy: '077S',
    pol: 'CNNGB', pod: 'BRRIG', estado: 'divergente',
    bls: 5, cntr: 9, ce: '3/5',
    escalas: [{ port: 'BRRIG', eta: '06/09' }],
    mods: ['box'],
    ports: { BRSSZ: 'X', BRVIX: 'X', BRPNG: 'X', BRRIG: '06/09' },
  },
  {
    id: 6, carrier: 'COSCO SHIPPING', vessel: 'CSCL SPRING', voy: '209W',
    pol: 'CNSHA', pod: 'BRSSZ · BRITJ', estado: 'conciliado',
    bls: 18, cntr: 40, ce: '18/18',
    escalas: [{ port: 'BRSSZ', eta: '09/09' }, { port: 'BRITJ', eta: '12/09' }],
    mods: ['box', 'boxOpen'],
    ports: { BRSSZ: '09/09', BRVIX: 'X', BRPNG: 'X', BRRIG: 'X' },
  },
  {
    id: 7, carrier: 'ZYHY', vessel: 'ZHONG YUAN HAI YUN 12', voy: '088W',
    pol: 'CNTAO', pod: 'BRSSZ', estado: 'incompleto',
    bls: 11, cntr: 22, ce: '9/11',
    escalas: [{ port: 'BRSSZ', eta: '11/09' }],
    mods: ['box', 'file'],
    ports: { BRSSZ: '11/09', BRVIX: 'OMIT', BRPNG: 'X', BRRIG: 'X' },
  },
  {
    id: 8, carrier: 'COSCO SHIPPING', vessel: 'COSCO SHIPPING VIRGO', voy: '044E',
    pol: 'CNNGB · CNSHA', pod: 'BRPNG', estado: 'incompleto',
    bls: 3, cntr: 6, ce: '0/3',
    escalas: [{ port: 'BRPNG', eta: '15/09' }],
    mods: ['box'],
    ports: { BRSSZ: 'X', BRVIX: 'X', BRPNG: '15/09', BRRIG: 'X' },
  },
  {
    id: 9, carrier: 'COSCO SHIPPING', vessel: 'XIN CHANG SHU', voy: '018S',
    pol: 'CNXMN', pod: 'BRSSZ', estado: 'incompleto',
    bls: 0, cntr: 0, ce: '0/0',
    escalas: [],
    mods: [],
    ports: { BRSSZ: 'X', BRVIX: 'X', BRPNG: 'X', BRRIG: 'X' },
  },
]

export const ESTADO = {
  conciliado: { label: 'Conciliado', color: '#1a8c50', tone: 'green' },
  incompleto: { label: 'Pendente', color: '#d4882e', tone: 'yellow' },
  divergente: { label: 'Divergente', color: '#c0393f', tone: 'red' },
}

/** Linhas do Planejamento por POD/POL da viagem selecionada (ARIES / 088E). */
export const PLAN_ROWS = [
  {
    port: 'BRSSZ', kind: 'pod', eta: '28/08', etb: '28/08', ata: '—', atb: '—',
    etd: '30/08', atd: '—', rtw: '—', ce: '8 B/L · CE 8/8', escala: '25.0143', linked: 'SIM',
  },
  {
    port: 'BRVIX', kind: 'pod', eta: '01/09', etb: '01/09', ata: '—', atb: '—',
    etd: '02/09', atd: '—', rtw: '—', ce: '2 B/L · CE 2/2', escala: '25.0177', linked: 'SIM',
  },
  {
    port: 'CNSHA', kind: 'pol', eta: '15/07', etb: '16/07', ata: '15/07', atb: '16/07',
    etd: '18/07', atd: '18/07', rtw: '26 MOVES', ce: 'Lançando', escala: '—', linked: '—',
  },
]

export const MODULES = [
  { icon: 'box', title: 'Manifestos CNTR', rows: ['2 manifestos', '8 B/Ls', '13 containers distintos'], empty: false },
  { icon: 'file', title: 'Manifestos BB', rows: ['2 manifestos', '2 B/Ls', '213 ton'], empty: false },
  { icon: 'mountain', title: 'Granito', rows: ['0 manifestos', '0 ton', '0 B/Ls'], empty: true },
  { icon: 'boxOpen', title: 'Vazios', rows: ['0 bookings', '0 containers', 'Sem destinos'], empty: true },
]

export const TIMELINE = [
  { at: '22/08/2026, 09:14', title: 'Cobertura de CE Mercante completa', note: '10/10 B/Ls com CE' },
  { at: '21/08/2026, 17:02', title: '7 B/Ls importados · CNSHA → BRSSZ', note: 'CNTR' },
  { at: '21/08/2026, 17:02', title: '2 B/Ls importados · CNNGB → BRSSZ', note: 'CNTR' },
  { at: '21/08/2026, 16:48', title: '1 B/L importado · CNSHA → BRVIX', note: 'CNTR' },
]

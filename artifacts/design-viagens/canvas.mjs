import { readFileSync, writeFileSync } from 'node:fs'
const H = JSON.parse(readFileSync(new URL('./heights.json', import.meta.url), 'utf8'))
const W = 1440, COL2 = 1560

const artboards = [
  { file: 'Main.dc.html', title: 'Direção A · a página inteira', x: 0, y: 0, page: 'page-1' },

  { file: 'AbaExportacao.dc.html', title: 'Aba · Exportação', x: COL2, y: 2600, page: 'page-2' },
  { file: 'AbaEscalas.dc.html', title: 'Aba · Escalas & Manifestos', x: 0, y: 3820, page: 'page-2' },
  { file: 'AbaAdr.dc.html', title: 'Aba · ADR', x: COL2, y: 3820, page: 'page-2' },

  { file: 'Cards.dc.html', title: 'Cards · anatomia e estados', x: 0, y: 5600, page: 'page-3' },

  { file: 'PlanejamentoAntes.dc.html', title: 'Planejamento por escala · hoje', x: 0, y: 9300, page: 'page-5' },
  { file: 'PlanejamentoEscala.dc.html', title: 'Planejamento por escala · proposta', x: 0, y: 10100, page: 'page-5' },

  { file: 'ImportacaoAntes.dc.html', title: 'Aba Importação · hoje', x: 0, y: 11400, page: 'page-6' },
  { file: 'ImportacaoDepois.dc.html', title: 'Aba Importação · proposta', x: 0, y: 12540, page: 'page-6' },

  { file: 'DirecaoC.dc.html', title: 'Direção C · programação em tabela', x: 0, y: 7400, page: 'page-4' },
  { file: 'DirecaoCDetalhe.dc.html', title: 'Direção C · /viagens/:id', x: COL2, y: 7400, page: 'page-4' },
].map((a) => ({ ...a, w: W, h: H[a.file] }))

const annotations = [
  {
    id: 'brief', page: 'page-1', x: -620, y: 0, w: 520,
    text: [
      'DIREÇÃO A — a escolhida',
      '',
      'Mantém o que já existe: rail horizontal + card de detalhe com abas. Nenhuma rota nova, VoyageRail e VoyageCard seguem no lugar.',
      '',
      'O que muda nesta página:',
      '',
      '1. O painel de filtros de 165px vira uma barra de comando de uma linha, com a busca sempre visível e os filtros aplicados como chips removíveis.',
      '2. O card do rail ganha rodapé ancorado na base com B/L · CNTR · CE, e o estado de conciliação por ponto E rótulo.',
      '3. Cada tile de KPI passa a ter um número dominante em Syne e no máximo três linhas de apoio, no lugar dos oito pares label/valor a 12px do DirectionKpiTile.',
      '4. As abas passam a usar o .app-tab do design system (navy com risco dourado), como o resto do app.',
      '',
      'As outras páginas abrem cada aba e cada card. Dados de amostra — plausíveis, não reais.',
    ].join('\n'),
  },
  {
    id: 'nota-abas', page: 'page-2', x: 0, y: 2400, w: 900,
    text: 'ABAS — o corpo de cada uma, na largura que ocupa dentro do card de detalhe.\n\nDesenhadas a partir do componente real (VoyageImportacaoTab, VoyageExportacaoTab, VoyageManifestosTab, VoyageAgencyReportTab), não da Visão geral. Duas correções vieram daí: o Planejamento tem 9 colunas (Escala · Opera · ETA · ATA · ATD derivado · BLs e CEs · Nº Escala · Vinculada · Ações), e os cards de módulo "Manifestos CNTR / BB / Granito / Vazios" não existem mais na Visão geral atual.',
  },
  {
    id: 'nota-cards', page: 'page-3', x: 0, y: 5400, w: 900,
    text: 'CARDS — cada peça que se repete, com os estados que precisa cobrir.\n\nServe de referência para a implementação e para conferir que nenhum estado ficou sem desenho: no rail, selecionado / hover / pendente / divergente / sem escala prevista. No hover o lápis ocupa o lugar do rótulo de conciliação em vez de flutuar por cima — os dois disputam o mesmo canto.',
  },
  {
    id: 'nota-planejamento', page: 'page-5', x: 0, y: 9100, w: 1000,
    text: [
      'VISÃO GERAL · PLANEJAMENTO POR ESCALA — hoje e a proposta, com os mesmos dados.',
      'BRSSZ já atracou (ATA, ATB, ATD preenchidos); BRVIX ainda não chegou.',
      '',
      'Seis mudanças:',
      '',
      '1. Cabeçalho em dois níveis: Chegada com ETA (previsto) e ATA (real). O previsto fica em cinza e o realizado em escuro — a linha passa a ser lida por onde o navio está.',
      '2. A coluna "BLs e CEs" só mostrava o rótulo do status do CE. Passa a mostrar o B/L que o nome promete, a cobertura como medidor, e o status como legenda.',
      '3. VINCULADA era texto puro SIM/NÃO. Vira badge.',
      '4. A divergência sai do text-amber-400 (#fbbf24, fora dos tokens e ilegível a 11px) para os tokens dourados, nomeando o campo; o texto completo fica no title.',
      '5. As atracações saem da grade da escala e viram painel recolhível, recuado, com tabela e cabeçalho próprios (Terminal · ETB · ATB · ETD · ATD · Restow) em tom claro — nada de herdar as colunas de cima. A escala ganha chevron e contador.',
      '6. O ATD da escala ganha a marca "deriv." — o cabeçalho diz "ATD derivado" mas nada explicava de onde deriva.',
    ].join('\n'),
  },
  {
    id: 'nota-importacao', page: 'page-6', x: 0, y: 11000, w: 1000,
    text: [
      'ABA IMPORTAÇÃO — hoje e a proposta, mesmos dados da viagem usada na Visão geral.',
      '',
      '1. Total da viagem numa faixa no topo. Hoje a aba lista POD a POD e o total só existe na faixa de KPIs, fora da aba.',
      '2. Os três painéis passam a existir sempre por escala, com estado vazio explícito. Hoje Veículos e Carga solta somem quando não há dado, e as escalas ficam com alturas diferentes, impossíveis de comparar.',
      '3. Painéis chapados, sem o gradiente e a sombra do .app-voyage-metric-panel — o vocabulário do resto da página. O paredão de pares label/valor vira um número dominante mais mini-stats.',
      '4. Vazios IMP deixa de ser um painel solto no fim e ganha seção própria. Continua agregado da viagem porque a origem não traz o POD — está dito na própria seção.',
      '5. Importação rápida agrupada por natureza (Manifestos, Complementos do B/L, Unidades), com ícone por tipo. Hoje são seis botões idênticos com o mesmo ícone de upload.',
      '',
      'Fora do escopo escolhido: os acentos faltando em "Vazios Importacao" e "Containers com veiculos" (VoyageImportacaoTab.tsx:45,68).',
    ].join('\n'),
  },
  {
    id: 'nota-descartadas', page: 'page-4', x: 0, y: 7200, w: 900,
    text: 'NÃO ESCOLHIDAS — registro da Direção C, mantida só como histórico da decisão.\n\n/viagens como programação em tabela (uma linha por viagem, uma coluna por porto, marcas OMIT e X do domínio) com o detalhe roteado em /viagens/:id. Perdeu para a A por trocar a página inteira e mandar o detalhe para outra navegação.',
  },
]

const canvas = {
  artboards,
  annotations,
  pages: [
    { id: 'page-1', name: 'Página' },
    { id: 'page-2', name: 'Abas' },
    { id: 'page-3', name: 'Cards' },
    { id: 'page-5', name: 'Visão geral · Planejamento' },
    { id: 'page-6', name: 'Aba Importação' },
    { id: 'page-4', name: 'Não escolhidas' },
  ],
  launch: { view: 'canvas', page: 'page-6' },
}

writeFileSync(new URL('./canvas.json', import.meta.url), JSON.stringify(canvas, null, 2) + '\n')
// confere que nenhuma moldura invade a de baixo (o helper avisa, mas melhor pegar aqui)
const rows = artboards.map((a) => [a.y, a.y + a.h, a.file])
for (const [ay, ab, af] of rows) for (const [by, , bf] of rows) {
  if (af !== bf && by > ay && by < ab + 120) console.warn(`AVISO: ${af} e ${bf} com folga < 120px`)
}
console.log(`canvas.json: ${artboards.length} artboards, ${annotations.length} notas, ${canvas.pages.length} páginas`)

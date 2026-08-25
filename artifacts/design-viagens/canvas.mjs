import { readFileSync, writeFileSync } from 'node:fs'
const H = JSON.parse(readFileSync(new URL('./heights.json', import.meta.url), 'utf8'))
const W = 1440, COL2 = 1560

const artboards = [
  { file: 'Main.dc.html', title: 'Direção A · a página inteira', x: 0, y: 0, page: 'page-1' },

  { file: 'AbaImportacao.dc.html', title: 'Aba · Importação', x: 0, y: 2200, page: 'page-2' },
  { file: 'AbaExportacao.dc.html', title: 'Aba · Exportação', x: COL2, y: 2200, page: 'page-2' },
  { file: 'AbaEscalas.dc.html', title: 'Aba · Escalas & Manifestos', x: 0, y: 3420, page: 'page-2' },
  { file: 'AbaAdr.dc.html', title: 'Aba · ADR', x: COL2, y: 3420, page: 'page-2' },

  { file: 'Cards.dc.html', title: 'Cards · anatomia e estados', x: 0, y: 5160, page: 'page-3' },

  { file: 'PlanejamentoAntes.dc.html', title: 'Planejamento por escala · hoje', x: 0, y: 9000, page: 'page-5' },
  { file: 'PlanejamentoOpcao1.dc.html', title: 'Opção 1 · atracações em painel próprio', x: 0, y: 9800, page: 'page-5' },
  { file: 'PlanejamentoOpcao2.dc.html', title: 'Opção 2 · berço como coluna', x: 0, y: 10700, page: 'page-5' },

  { file: 'DirecaoC.dc.html', title: 'Direção C · programação em tabela', x: 0, y: 7100, page: 'page-4' },
  { file: 'DirecaoCDetalhe.dc.html', title: 'Direção C · /viagens/:id', x: COL2, y: 7100, page: 'page-4' },
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
    id: 'nota-abas', page: 'page-2', x: 0, y: 2000, w: 900,
    text: 'ABAS — o corpo de cada uma, na largura que ocupa dentro do card de detalhe.\n\nDesenhadas a partir do componente real (VoyageImportacaoTab, VoyageExportacaoTab, VoyageManifestosTab, VoyageAgencyReportTab), não da Visão geral. Duas correções vieram daí: o Planejamento tem 9 colunas (Escala · Opera · ETA · ATA · ATD derivado · BLs e CEs · Nº Escala · Vinculada · Ações), e os cards de módulo "Manifestos CNTR / BB / Granito / Vazios" não existem mais na Visão geral atual.',
  },
  {
    id: 'nota-cards', page: 'page-3', x: 0, y: 4960, w: 900,
    text: 'CARDS — cada peça que se repete, com os estados que precisa cobrir.\n\nServe de referência para a implementação e para conferir que nenhum estado ficou sem desenho: no rail, selecionado / hover / pendente / divergente / sem escala prevista. No hover o lápis ocupa o lugar do rótulo de conciliação em vez de flutuar por cima — os dois disputam o mesmo canto.',
  },
  {
    id: 'nota-planejamento', page: 'page-5', x: 0, y: 8760, w: 1000,
    text: [
      'VISÃO GERAL · PLANEJAMENTO POR ESCALA — mesmos dados nos três artboards.',
      'BRSSZ já atracou (ATA, ATB, ATD preenchidos); BRVIX ainda não chegou.',
      '',
      'Cinco mudanças ficaram de pé nas duas opções: cabeçalho em dois níveis separando previsto de realizado; a coluna "BLs e CEs" passa a mostrar o B/L que o nome promete; VINCULADA vira badge; a divergência sai do text-amber-400 para os tokens dourados; e o ATD ganha a marca "deriv.".',
      '',
      'Em aberto: onde a atracação vive. A sub-linha herdando os cabeçalhos da escala foi descartada — confundia as colunas da escala com as da atracação.',
      '',
      'OPÇÃO 1 — painel próprio, recolhível. A escala mantém suas 3 colunas de data; a atracação tem as suas, com cabeçalho claro que não compete com o navy da escala. Cabe tudo (ETB, ATB, ETD, ATD, Restow) e dá para editar por atracação. Custo: a linha cresce quando aberta.',
      '',
      'OPÇÃO 2 — sem sub-linha. Uma linha por escala; os grupos passam a ser Porto e Berço, e a coluna Berço resume cada atracação como terminal + janela atracação → saída. Tabela sempre da mesma altura. Custo: ETB e ETD previstos saem da tabela e ficam só no modal da escala.',
    ].join('\n'),
  },
  {
    id: 'nota-descartadas', page: 'page-4', x: 0, y: 6900, w: 900,
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
    { id: 'page-4', name: 'Não escolhidas' },
  ],
  launch: { view: 'canvas', page: 'page-5' },
}

writeFileSync(new URL('./canvas.json', import.meta.url), JSON.stringify(canvas, null, 2) + '\n')
// confere que nenhuma moldura invade a de baixo (o helper avisa, mas melhor pegar aqui)
const rows = artboards.map((a) => [a.y, a.y + a.h, a.file])
for (const [ay, ab, af] of rows) for (const [by, , bf] of rows) {
  if (af !== bf && by > ay && by < ab + 120) console.warn(`AVISO: ${af} e ${bf} com folga < 120px`)
}
console.log(`canvas.json: ${artboards.length} artboards, ${annotations.length} notas, ${canvas.pages.length} páginas`)

import { readFileSync, writeFileSync } from 'node:fs'
const H = JSON.parse(readFileSync(new URL('./heights.json', import.meta.url), 'utf8'))
const W = 1440, COL2 = 1560

const artboards = [
  { file: 'Main.dc.html', title: 'Direção A · a página inteira', x: 0, y: 0, page: 'page-1' },

  { file: 'AbaEscalas.dc.html', title: 'Aba · Escalas & Manifestos', x: 0, y: 3820, page: 'page-2' },
  { file: 'AbaAdr.dc.html', title: 'Aba · ADR', x: COL2, y: 3820, page: 'page-2' },

  { file: 'Cards.dc.html', title: 'Cards · anatomia e estados', x: 0, y: 5600, page: 'page-3' },

  { file: 'PlanejamentoAntes.dc.html', title: 'Planejamento por escala · hoje', x: 0, y: 9300, page: 'page-5' },
  { file: 'PlanejamentoEscala.dc.html', title: 'Planejamento por escala · proposta', x: 0, y: 10100, page: 'page-5' },

  { file: 'ImportacaoAntes.dc.html', title: 'Aba Importação · hoje', x: 0, y: 11400, page: 'page-6' },
  { file: 'ImportacaoDepois.dc.html', title: 'Aba Importação · proposta', x: 0, y: 12540, page: 'page-6' },

  { file: 'ExportacaoAntes.dc.html', title: 'Aba Exportação · hoje', x: 0, y: 14000, page: 'page-7' },
  { file: 'ExportacaoDepois.dc.html', title: 'Aba Exportação · proposta', x: 0, y: 14680, page: 'page-7' },

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
      '2. Tudo por escala: Containers e Carga solta como painéis, Veículos e Vazios IMP como faixas — com estado vazio explícito, para as escalas ficarem comparáveis. Hoje os painéis somem quando não há dado e as alturas divergem.',
      '3. Os dois têm POD na origem: vazios_importacao_containers tem coluna pod (o hook já lê e só agrega num Set por viagem), e o veículo chega ao POD por vehicles → container → bl_containers → bl → bls.pod, caminho que summarizeImportByPod já percorre.',
      '4. Painéis chapados, sem o gradiente e a sombra do .app-voyage-metric-panel. O paredão de pares label/valor vira um número dominante mais mini-stats.',
      '5. Containers ganha carga geral, C/ veículos, IMO, OOG e contagem por tipo; Veículos traz marca e tipo de container (brandSummary e vehicleByContainerTypeSummary).',
      '6. Importação rápida numa fila só, sem agrupar por manifesto: Baplie EDI | B/L container · B/L carga solta · CE Mercante | Veículos · Vazios IMP. Os dois B/L são botões distintos porque abrem modais diferentes.',
      '',
      'CE Mercante é um botão só: o import casa por número de B/L contra a tabela bls, que guarda container e carga solta no mesmo lugar (cargo_mode). O único alvo separado é granite, que vive na aba Exportação.',
      '',
      'Fora do escopo escolhido: os acentos faltando em "Vazios Importacao" e "Containers com veiculos" (VoyageImportacaoTab.tsx:45,68).',
    ].join('\n'),
  },
  {
    id: 'nota-exportacao', page: 'page-7', x: 0, y: 13600, w: 1000,
    text: [
      'ABA EXPORTAÇÃO — herda a gramática fechada na Importação.',
      '',
      'O achado que move a aba: VoyageExportacaoTab.tsx chama summarizeExportByPol, que devolve granito e vazios POR terminal de embarque — e usa só o .length do resultado, para decidir se mostra os painéis. Todo o detalhe por POL é calculado e descartado; a aba exibe apenas os totais da viagem.',
      '',
      'O que a proposta traz da Importação: faixa de total no topo, um bloco por escala (aqui, por terminal de embarque), painéis chapados com número dominante, mini-stats e tokens com contagem, estado vazio explícito para as escalas ficarem comparáveis, e o cadastro rápido numa fila só.',
      '',
      'Uma decisão em aberto: o botão CE Mercante (Granito) é sugestão nova, não existe hoje. O import já tem o alvo `granite`, que casa contra granite_bls — só não está exposto em lugar nenhum da aba. Vazios EXP não entra porque não emite CE: é módulo de custo pago pela agência ao depot, sem invoice de cliente (CONTEXT.md, seção Mercante).',
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
    { id: 'page-7', name: 'Aba Exportação' },
    { id: 'page-4', name: 'Não escolhidas' },
  ],
  launch: { view: 'canvas', page: 'page-7' },
}

writeFileSync(new URL('./canvas.json', import.meta.url), JSON.stringify(canvas, null, 2) + '\n')
// confere que nenhuma moldura invade a de baixo (o helper avisa, mas melhor pegar aqui)
const rows = artboards.map((a) => [a.y, a.y + a.h, a.file])
for (const [ay, ab, af] of rows) for (const [by, , bf] of rows) {
  if (af !== bf && by > ay && by < ab + 120) console.warn(`AVISO: ${af} e ${bf} com folga < 120px`)
}
console.log(`canvas.json: ${artboards.length} artboards, ${annotations.length} notas, ${canvas.pages.length} páginas`)

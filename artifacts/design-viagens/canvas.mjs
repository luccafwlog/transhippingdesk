import { readFileSync, writeFileSync } from 'node:fs'
const H = JSON.parse(readFileSync(new URL('./heights.json', import.meta.url), 'utf8'))
const W = 1440, COL2 = 1560

const artboards = [
  { file: 'Main.dc.html', title: 'Direção A · a página inteira', x: 0, y: 0, page: 'page-1' },


  { file: 'Cards.dc.html', title: 'Cards · anatomia e estados', x: 0, y: 5600, page: 'page-3' },

  { file: 'PlanejamentoAntes.dc.html', title: 'Planejamento por escala · hoje', x: 0, y: 9300, page: 'page-5' },
  { file: 'PlanejamentoEscala.dc.html', title: 'Planejamento por escala · proposta', x: 0, y: 10100, page: 'page-5' },

  { file: 'ImportacaoAntes.dc.html', title: 'Aba Importação · hoje', x: 0, y: 11400, page: 'page-6' },
  { file: 'ImportacaoDepois.dc.html', title: 'Aba Importação · proposta', x: 0, y: 12540, page: 'page-6' },

  { file: 'ExportacaoAntes.dc.html', title: 'Aba Exportação · hoje', x: 0, y: 14000, page: 'page-7' },
  { file: 'ExportacaoDepois.dc.html', title: 'Aba Exportação · proposta', x: 0, y: 14680, page: 'page-7' },
  { file: 'ExportacaoMultiDepot.dc.html', title: 'Aba Exportação · vários depots', x: 0, y: 15860, page: 'page-7' },
  { file: 'ModalGranito.dc.html', title: 'Modal · Importar Manifesto Granito', x: 0, y: 17100, page: 'page-7' },

  { file: 'RotasAntes.dc.html', title: 'Aba Rotas e Manifestos · hoje', x: 0, y: 18400, page: 'page-8' },
  { file: 'RotasDepois.dc.html', title: 'Aba Rotas e Manifestos · proposta', x: 0, y: 19160, page: 'page-8' },

  { file: 'AdrAntes.dc.html', title: 'Aba ADR · hoje', x: 0, y: 20500, page: 'page-9' },
  { file: 'AdrDepois.dc.html', title: 'Aba ADR · proposta', x: 0, y: 21800, page: 'page-9' },

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
      'O que vem da Importação: faixa de total no topo, um bloco por terminal de embarque, painéis chapados com número dominante, mini-stats e tokens com contagem, estado vazio explícito, e a barra de ações numa fila só.',
      '',
      'AÇÕES — corrigidas depois de conferir o código:',
      '',
      '1. Vazios EXP deixa de ser upload avulso. A RPC import_vazios_bookings_transactional até cria a vazios_export_operations a partir do embark_port da planilha, mas popula só as unidades — nunca as vazios_export_service_lines — e pula a escolha do porto entre as escalas. O botão passa a levar ao Embarque com a viagem travada; a planilha de unidades continua dentro dele, junto das taxas de serviço.',
      '2. CE Mercante (Granito) JÁ EXISTE, em /granito (Granite.tsx:475). Aqui é atalho com a viagem travada, não recurso novo. A nota anterior dizia o contrário e estava errada.',
      '',
      'MÚLTIPLOS DEPOTS (segundo artboard da proposta): um terminal de embarque pode receber vazios de vários depots — a origem já é plural no dado. Cada booking tem local_id apontando para depots, e vazios.origins é um summarizeUniqueValues, então N depots viram hoje uma string concatenada num campo só. O painel passa a abrir a repartição por depot; com um depot só, colapsa na linha única. As taxas de serviço também são por depot: vazios_export_service_lines tem local_id e destino_id.',
      '',
      'MODAL DE MANIFESTO GRANITO (último artboard): o parser devolve vesselVoyage, o navio/viagem declarado dentro da planilha, e importGraniteManifest devolve pendingCount, os B/Ls que não casaram com cliente. O modal descarta os dois e mostra só B/Ls e Erros — dá para importar a planilha errada na viagem certa sem perceber. A barra de prévia do FileImportModal ainda usa cores de tema escuro cravadas no código, dentro de um modal claro.',
    ].join('\n'),
  },
  {
    id: 'nota-rotas', page: 'page-8', x: 0, y: 18000, w: 1000,
    text: [
      'ESCALAS & MANIFESTOS → ROTAS E MANIFESTOS.',
      '',
      'A aba se chama Escalas e não mostra escala nenhuma: cada linha de collectVoyageManifestBatchRows é uma rota POL → POD. Escala vive na Visão geral. O nome passa a ser o que a aba faz — e o "manifesto" da aba é o Nº de manifesto Mercante, não um arquivo: não há mais vinculação de arquivo de manifesto.',
      '',
      'Quatro melhorias junto:',
      '',
      '1. O grupo Mercante reúne as duas colunas que hoje se chamam quase igual e são coisas diferentes: CE Mercante · cobertura é a cobertura por B/L; Nº de manifesto Mercante agrupa a rota. Cada uma passa a ser nomeada pelo que é.',
      '2. O número faltante vira ação. Hoje é o texto "manifesto não informado" em #b45309 — cor fora dos tokens — e o que fazer só aparece no title do elemento. Vira um chip "Informar" nos tokens dourados.',
      '3. Larguras redistribuídas. O table-fixed dá 40% para a rota e 12% para uma coluna de Ações com um botão de 38px; a rota com omissão (POL → POD riscado → POD de descarga, mais o selo) não cabe. Rota vai a 46%, ações encolhem para o botão.',
      '4. Faixa de totais no topo, como nas outras abas: rotas, B/Ls vinculados, cobertura de CE agregada e quantos números de manifesto faltam. A faixa de conciliação sai — repetia o KPI de Conciliação que já está no herói da viagem.',
    ].join('\n'),
  },
  {
    id: 'nota-adr', page: 'page-9', x: 0, y: 20100, w: 1000,
    text: [
      'ABA ADR — o documento é por terminal, e a aba não mostrava isso.',
      '',
      'resolvedReportId é o terminal: own, signoffEvents, departmentSignoffEvents, close, reopen e observação são todos amarrados a ele. E sectionIsVisible esconde a seção que não tem frente naquele terminal — ou seja, o terminal decide até quais seções existem. Hoje ele é um seletor num painel discreto abaixo das escalas.',
      '',
      'Cinco mudanças:',
      '',
      '1. O terminal sobe para o cabeçalho, junto da escala e do estado do documento (Aberto/Fechado). Escala e terminal viram uma linha só de seletores, e cada terminal mostra o que carrega: quantas seções, ou que já está fechado.',
      '2. As seções passam a ser agrupadas por departamento, não por fase. AGENCY_REPORT_SECTIONS mapeia cada seção a um setor — Equipamentos responde por três, hoje espalhadas entre Importação e Exportação. Quem vai assinar precisava caçá-las.',
      '3. Os dois níveis de assinatura passam a conversar. Cada grupo traz o contador de seções resolvidas e o próprio botão de assinar o setor; o botão fica esmaecido enquanto sobra seção pendente. O cabeçalho diz o que falta para o Fechar ADR, que hoje só olha signedDepartmentsCount !== 3 sem explicar nada.',
      '4. Avisos ganham forma. Divergência, dado órfão e nada operado eram <p> de 14px, com o mesmo peso de qualquer parágrafo; agora são callout vermelho e estado vazio tracejado. A observação da seção vira um chip visível — hoje só se descobre abrindo o editor.',
      '5. Hierarquia e vocabulário. ReportPhase era um <h2> de 12px acima de blocos com <h3> de 16px; o selo do departamento usava borda e texto verde sem fundo, fora do .app-badge. As frentes de operação que compõem cada seção aparecem como pastilha, já que são elas que decidem a visibilidade.',
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
    { id: 'page-3', name: 'Cards' },
    { id: 'page-5', name: 'Visão geral · Planejamento' },
    { id: 'page-6', name: 'Aba Importação' },
    { id: 'page-7', name: 'Aba Exportação' },
    { id: 'page-8', name: 'Aba Rotas e Manifestos' },
    { id: 'page-9', name: 'Aba ADR' },
    { id: 'page-4', name: 'Não escolhidas' },
  ],
  launch: { view: 'canvas', page: 'page-9' },
}

writeFileSync(new URL('./canvas.json', import.meta.url), JSON.stringify(canvas, null, 2) + '\n')
// confere que nenhuma moldura invade a de baixo (o helper avisa, mas melhor pegar aqui)
const rows = artboards.map((a) => [a.y, a.y + a.h, a.file])
for (const [ay, ab, af] of rows) for (const [by, , bf] of rows) {
  if (af !== bf && by > ay && by < ab + 120) console.warn(`AVISO: ${af} e ${bf} com folga < 120px`)
}
console.log(`canvas.json: ${artboards.length} artboards, ${annotations.length} notas, ${canvas.pages.length} páginas`)

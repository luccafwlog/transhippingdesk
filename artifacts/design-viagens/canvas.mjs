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
  { file: 'AdrDepois.dc.html', title: 'Aba ADR · proposta', x: 0, y: 25120, page: 'page-9' },
  { file: 'AdrEstados.dc.html', title: 'Aba ADR · hipóteses de estado', x: 0, y: 29200, page: 'page-9' },

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
      'Oito mudanças:',
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
      'ABA ADR — o cabeçalho fica; o que muda é onde a assinatura mora e como a carga descarregada é contada.',
      '',
      'resolvedReportId é o terminal: own, signoffEvents, departmentSignoffEvents, close, reopen e observação são todos amarrados a ele. E o recorte por frente (sectionIsVisible + terminalViewFor) esvazia o conteúdo da seção que não tem frente naquele terminal — a seção continua exigindo resolução, mas mostra "Não há frente atribuída a este terminal".',
      '',
      'Oito mudanças:',
      '',
      '1. O cabeçalho fica como está: a fileira de escalas e o painel "ADR por terminal", sem alteração. Do painel de departamentos sobra só a faixa de fechamento — contador, prazo, Imprimir e Fechar ADR — porque os três cartões de assinatura descem para dentro dos grupos de seção.',
      '2. As seções passam a ser agrupadas por departamento, não por fase. AGENCY_REPORT_SECTIONS mapeia cada seção a um setor — Equipamentos responde por três, hoje espalhadas entre Importação e Exportação. Quem vai assinar precisava caçá-las.',
      '3. Os dois níveis de assinatura passam a conversar. Cada grupo traz o contador de seções resolvidas, o estado de prazo do setor e o próprio botão de assinar; o botão fica esmaecido enquanto sobra seção pendente. A faixa de fechamento diz o que falta, que hoje só vive no title do botão Fechar ADR.',
      '4. Carga descarregada deixa de misturar contagens. Hoje o hero "148 containers descarregados" flutua acima dos DOIS painéis, mas só fala de container — carga solta se conta em B/L. E o painel se chama "Descarga de importação", nome que sugere exportação sendo descarregada; são containers descarregados. Na proposta cada modo de carga carrega o próprio total no topo do próprio painel.',
      '5. A listagem de container passa a ter DUAS leituras, porque são duas perguntas diferentes: "Por tipo" (20GP, 40HC, 40OT, 40RH) responde quanto se movimentou de cada tipo; "Por tipo e natureza" cruza com carga geral / IMO / OOG. Hoje existe uma lista só, e o eixo dela mistura coisas de ordens diferentes: transbordo (que é destino, não natureza), veículos (que tem seção própria) e vazio (que tem seção própria) aparecem como se fossem irmãos de "carga geral". Transbordo vira a linha Destino; veículos volta a ser carga geral aqui, com o detalhe na seção Veículos.',
      '6. O vazio passa a morar num lugar só. O Baplie empurra para a listagem de Carga descarregada todo container empty sem B/L (categoria vazio, agencyDepartureReport.ts ~1129) e o MESMO container já está dentro de baplieEmptyCount, que alimenta a divergência de Vazios descarregados. É presença dupla: o total de 148 inclui 3 unidades que a outra seção também conta. Na proposta Carga descarregada conta só cheio (145) e Vazios descarregados mostra as duas fontes lado a lado — Baplie 28 contra 26 classificados no módulo.',
      '7. Avisos ganham forma. Divergência, dado órfão e nada operado eram <p> de 14px, com o mesmo peso de qualquer parágrafo; agora são callout vermelho, callout dourado e estado vazio tracejado. A observação da seção vira bloco visível — hoje só se descobre abrindo o editor.',
      '8. A linha do tempo vira trilho. Eram sete marcos empilhados, cada um repetindo o mesmo par título/parágrafo; viram paradas lado a lado, com o estado do prazo dentro da parada e a reabertura justificada pendurada embaixo de quem foi reaberto.',
      '',
      'Duas coisas que a proposta exige do código, e que hoje não existem:',
      '',
      'a) OOG não é lido. `is_oog` existe em baplie_containers E em bl_containers, mas nem BL_CONTAINERS_SELECT nem o select de baplie_containers do ADR o trazem, e MatrixCategory não tem a chave. Sem isso a coluna OOG não tem de onde sair.',
      'b) IMO e OOG não são exclusivos entre si — são dois booleanos independentes no mesmo container. A listagem precisa de uma regra declarada; a proposta adota OOG vence IMO, no mesmo espírito do CATEGORY_PRIORITY que já existe, e mostra na tela quantos caem nos dois.',
      '',
      'Os dois artboards leem os MESMOS dados, preenchidos até o limite do que cada seção exibe — as seis seções de AGENCY_REPORT_SECTIONS, matriz de descarga, carga solta com transbordo, veículos por marca/modelo/tipo, granito, embarque de vazios por local, operação de pátio com linhas de serviço, os três estados de sign-off, divergência, dado órfão, observação, atribuição e histórico.',
      '',
      'O terceiro artboard reúne as hipóteses que não cabem no fluxo cheio: os dois vazios do recorte por terminal, os três vazios de conteúdo, o documento fechado, a escala omitida, a escala sem ATD, o ADR legado sem terminal_id, o leitor sem permissão de sign-off, o departamento atrasado e reaberto e as guardas de erro. Cada cartão cita a condição que o produz no código.',
    ].join('\n'),
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

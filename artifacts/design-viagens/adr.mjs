import { T, icon } from './kit.mjs'
import { secao } from './abakit.mjs'

/**
 * Aba ADR. O "hoje" transcreve VoyageAgencyReportTab.tsx; a proposta reorganiza
 * a aba em torno do fato de o ADR ser por terminal, e liga os dois níveis de
 * assinatura (seção e departamento) que hoje não conversam na tela.
 *
 * Os dois artboards leem os MESMOS dados (DADOS abaixo), preenchidos até o
 * limite do que cada seção sabe exibir: matriz de descarga, carga solta com
 * transbordo, veículos por marca/modelo/tipo, granito, embarque de vazios por
 * local, operação de pátio com linhas de serviço, os três estados de sign-off,
 * as quatro famílias de aviso, atribuição, observação e histórico.
 *
 * Mapa real de AGENCY_REPORT_SECTIONS (agencyDepartureReport.ts:35) e rótulos
 * de AGENCY_REPORT_SECTION_LABELS:
 *   datas "Escala" → operações
 *   carga_descarregada "Carga descarregada", vazios_descarregados "Vazios
 *     descarregados" → documentação
 *   veiculos "Veículos", carga_carregada "Granito", vazios_embarcados
 *     "Embarque de vazios" → equipamentos
 * Ordem de tela: AGENCY_REPORT_SECTION_ORDER.
 */

/* ================================ DADOS ================================ */

const CABECALHO = {
  armador: 'MSC Mediterranean Shipping',
  navio: 'CAP SAN ANTONIO / 534N',
  porto: 'BRSSZ',
  terminal: 'BTP',
  terminalNome: 'Brasil Terminal Portu&aacute;rio',
  ata: '19/08/2026',
  atb: '19/08/2026',
  atd: '21/08/2026',
  restow: '3',
  prazo: '26/08/2026',
}

/**
 * "Carga descarregada" é um 2x2: modo de carga (container / carga solta) x
 * destino (final nesta escala / em transbordo). O serviço já traz assim —
 * `bl_containers` do porto e `bl_containers` de `transshipmentBlIds` são
 * consultas separadas e disjuntas, idem os `bls` de carga solta — mas a tela
 * de hoje achata metade disso: os containers viram uma lista só onde
 * transbordo é uma CATEGORIA, e a carga solta mantém transbordo como BLOCO.
 *
 * IMO é marcador (`is_imo` no container), não balde: CATEGORY_PRIORITY faz
 * transbordo > veículos > imo > carga_geral, então um container em transbordo
 * que é IMO conta como transbordo na matriz e ainda assim entra no imoCount.
 */
const DESCARGA = {
  containers: {
    // A proposta conta só container CHEIO: os 3 vazios do Baplie sem B/L que
    // a listagem de hoje traz como categoria 'vazio' passam para Vazios
    // descarregados, então o total cai de 148 para 145.
    total: 145,
    vaziosMovidos: 3,
    totalHoje: 148,
    imo: 9,
    oog: 6,
    imoEOog: 1,
    // Visão 1 — só o tipo. Soma o total.
    porTipo: [['20GP', 46], ['40HC', 76], ['40OT', 5], ['40RH', 18]],
    // Visão 2 — tipo x natureza. Mesmas linhas, mesmas somas.
    porNatureza: [
      ['20GP', 42, 4, 0],
      ['40HC', 71, 2, 3],
      ['40OT', 2, 0, 3],
      ['40RH', 15, 3, 0],
    ],
    destinoFinal: 136,
    transbordo: 9,
  },
  cargaSolta: {
    bls: 5, ton: '254',
    destinoFinal: { bls: 4, maquinas: 7, packages: 61, ton: '213', cbm: '388,4' },
    transbordo: { bls: 1, maquinas: 2, packages: 12, ton: '41', cbm: '74,6' },
  },
}

const NATUREZAS = ['carga geral', 'IMO', 'OOG']

/**
 * A listagem como a aba monta HOJE: uma linha por (tipo, categoria), com
 * categoria vinda de CATEGORY_PRIORITY — transbordo > veículos > imo >
 * carga_geral > vazio. Não há OOG (`is_oog` existe em baplie_containers e
 * bl_containers, mas nenhum dos dois selects do ADR o traz), transbordo entra
 * como se fosse natureza, e o vazio do Baplie sem B/L aparece aqui além de já
 * estar contado em baplieEmptyCount, na divergência de Vazios descarregados.
 */
const MATRIZ_HOJE = [
  ['20GP', 'carga geral', 42],
  ['20GP', 'IMO', 4],
  ['20GP', 'vazio (sem B/L)', 3],
  ['40HC', 'carga geral', 62],
  ['40HC', 'IMO', 2],
  ['40HC', 'transbordo', 9],
  ['40HC', 've&iacute;culos', 6],
  ['40OT', 'carga geral', 5],
  ['40RH', 'carga geral', 15],
]

const VAZIOS_IMP = {
  modulo: 26,
  baplie: 28,
  semNatureza: 2,
  total: 26,
  matriz: [
    ['20GP', 'vazio &mdash; cama', 8],
    ['40HC', 'vazio &mdash; cama', 12],
    ['40HC', 'vazio &mdash; cover plate', 6],
  ],
}

const VEICULOS = {
  vins: 34,
  marcas: [
    ['TOYOTA', '3 BLs &middot; 18 VINs &middot; 4 em transbordo &middot; P&aacute;tio BTP, Armaz&eacute;m 3'],
    ['HONDA', '1 BL &middot; 11 VINs &middot; P&aacute;tio BTP'],
    ['Marca n&atilde;o informada', '1 BL &middot; 5 VINs &middot; local de desova n&atilde;o informado'],
  ],
  porTipo: [['40HC', 6], ['45HC', 2]],
  porModelo: [['COROLLA', 9], ['HILUX', 6], ['YARIS', 3], ['CIVIC', 7], ['HR-V', 4], ['Modelo n&atilde;o informado', 5]],
}

const GRANITO = { bls: 5, blocos: 96, ton: '1.842,6' }

const VAZIOS_EXP = {
  total: 62,
  porTipo: [['20GP', 24], ['40HC', 30], ['40RH', 8]],
  porLocal: [
    ['Santos Brasil Depot', [['20GP', 14], ['40HC', 12]]],
    ['Rocha Terminais', [['20GP', 10], ['40HC', 8]]],
    ['BTP &mdash; Brasil Terminal Portu&aacute;rio', [['40HC', 10], ['40RH', 8]]],
  ],
}

const PATIO = {
  storageDias: 214,
  storageContainers: 38,
  embarqueDireto: 18,
  locais: 'Santos Brasil Depot, Rocha Terminais',
  total: 'R$ 128.430,00',
  linhas: [
    ['Movimenta&ccedil;&atilde;o', 'Santos Brasil Depot', 'BTP', '20GP', '24', 'R$ 410,00', 'R$ 9.840,00', '&mdash;'],
    ['Movimenta&ccedil;&atilde;o', 'Rocha Terminais', 'BTP', '40HC', '18', 'R$ 520,00', 'R$ 9.360,00', 'Janela noturna'],
    ['Lavagem', 'Santos Brasil Depot', '&mdash;', '40HC', '12', 'R$ 285,00', 'R$ 3.420,00', 'Res&iacute;duo de granito'],
    ['Armazenagem', 'Rocha Terminais', '&mdash;', '20GP', '214', 'R$ 38,00', 'R$ 8.132,00', '38 containers &times; per&iacute;odos'],
    ['Reparo', 'Santos Brasil Depot', '&mdash;', '40RH', '2', 'R$ 1.940,00', 'R$ 3.880,00', 'Troca de gaxeta'],
  ],
}

const OBS_CARGA = 'Dois containers com avaria de porta (MSCU7741203 e MSCU8812007) &mdash; fotos anexadas ao processo e comunicado ao armador em 21/08. O terminal registrou a avaria no EIR de descarga; a Concilia&ccedil;&atilde;o j&aacute; foi notificada para n&atilde;o reprocessar as unidades.'

const SECOES = [
  {
    id: 'datas', titulo: 'Escala', depto: 'Opera&ccedil;&otilde;es', fase: null,
    estado: 'confirmado', atribuicao: 'Confirmado por Ana Ribeiro em 22/08/2026',
    frentes: ['Atraca&ccedil;&atilde;o'], obs: null, historico: 2, avisos: [], conteudo: 'escala',
  },
  {
    id: 'carga_descarregada', titulo: 'Carga descarregada', depto: 'Documenta&ccedil;&atilde;o', fase: 'Importação',
    estado: 'confirmado', atribuicao: 'Confirmado por Marcos Lima em 22/08/2026',
    frentes: ['CNTR importa&ccedil;&atilde;o', 'Carga solta'], obs: OBS_CARGA, historico: 3, conteudo: 'descarga',
    avisos: [['divergencia', '3 container(s) cheio(s) no Baplie sem B/L correspondente nesta escala &mdash; revisar na Concilia&ccedil;&atilde;o Baplie &times; B/L.']],
  },
  {
    id: 'vazios_descarregados', titulo: 'Vazios descarregados', depto: 'Documenta&ccedil;&atilde;o', fase: 'Importação',
    estado: 'confirmado', atribuicao: 'Confirmado por Marcos Lima em 22/08/2026',
    frentes: ['Vazios IMP'], obs: null, historico: 0, conteudo: 'vaziosImp',
    avisos: [['divergencia', 'Baplie aponta 28 vazio(s) descarregado(s) contra 26 no m&oacute;dulo de Vazios de Importa&ccedil;&atilde;o (2 ainda sem natureza classificada) &mdash; revisar na Concilia&ccedil;&atilde;o Baplie &times; B/L.']],
  },
  {
    id: 'veiculos', titulo: 'Ve&iacute;culos', depto: 'Equipamentos', fase: 'Importação',
    estado: 'pendente', atribuicao: null,
    frentes: ['Ve&iacute;culos'], obs: null, historico: 0, avisos: [], conteudo: 'veiculos',
  },
  {
    id: 'carga_carregada', titulo: 'Granito', depto: 'Equipamentos', fase: 'Exportação',
    estado: 'nada', atribuicao: 'Nada a declarar por Paulo Nunes em 22/08/2026',
    frentes: ['Granito'], obs: 'Embarque de granito remanejado para a viagem 535N a pedido do shipper.', historico: 1, conteudo: 'granito',
    avisos: [['orfao', '2 B/L(s) de granito em BRRIO &mdash; porto n&atilde;o &eacute; escala desta viagem, verificar o cadastro.']],
  },
  {
    id: 'vazios_embarcados', titulo: 'Embarque de vazios', depto: 'Equipamentos', fase: 'Exportação',
    estado: 'pendente', atribuicao: null,
    frentes: ['Vazios EXP', 'P&aacute;tio'], obs: null, historico: 1, conteudo: 'vaziosExp',
    avisos: [['orfao', '6 unidade(s) de vazios embarcados em BRPNG &mdash; porto n&atilde;o &eacute; escala desta viagem, verificar o cadastro.']],
  },
]

const DEPTOS = [
  { chave: 'operacoes', nome: 'Opera&ccedil;&otilde;es', assinado: true, quem: 'Ana Ribeiro', quando: '22/08/2026 09:14', atribuicao: 'Assinado por Ana Ribeiro em 22/08/2026', prazo: 'on-time', reaberturas: [] },
  {
    chave: 'documentacao', nome: 'Documenta&ccedil;&atilde;o', assinado: true, quem: 'Marcos Lima', quando: '27/08/2026 11:37', atribuicao: 'Assinado por Marcos Lima em 27/08/2026', prazo: 'overdue',
    reaberturas: [['Reaberto em 25/08/2026 14:20 por Ana Ribeiro', 'Baplie reprocessado depois da corre&ccedil;&atilde;o de 3 containers &oacute;rf&atilde;os.']],
  },
  { chave: 'equipamentos', nome: 'Equipamentos', assinado: false, quem: null, quando: null, atribuicao: null, prazo: 'on-time', reaberturas: [] },
]

const ESTADO = {
  confirmado: ['green', 'Confirmado'],
  nada: ['yellow', 'Nada a declarar'],
  pendente: ['slate', 'Pendente'],
}

const PRAZO = {
  'on-time': ['green', 'No prazo'],
  overdue: ['red', 'Atrasado'],
  'no-deadline': ['slate', 'Sem prazo'],
}

/* ============================ PRIMITIVAS HOJE =========================== */

/** Info — app-voyage-info: label à esquerda, valor à direita. */
const infoH = (label, valor) => `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 1px dashed ${T.border}; padding-bottom: 5px">
  <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">${label}</span>
  <span style="font-family: ${T.mono}; font-size: 13px; font-weight: 600; color: ${T.text}">${valor}</span>
</div>`

/** MetricPanel — app-voyage-metric-panel: gradiente claro + sombra. */
const painelH = (titulo, inner) => `<div style="display: grid; gap: 10px; align-content: start; border: 1px solid ${T.border}; border-radius: 8px; background: linear-gradient(180deg, #ffffff, ${T.surfaceMuted}); box-shadow: ${T.shadow}; padding: 14px 16px">
  <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">${titulo}</div>
  <div style="display: grid; gap: 8px; align-content: start">${inner}</div>
</div>`

const heroH = (valor, unidade) => `<div style="display: flex; align-items: baseline; gap: 7px">
  <span style="font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; color: ${T.text}">${valor}</span>
  ${unidade ? `<span style="font-size: 14px; color: ${T.muted}">${unidade}</span>` : ''}
</div>`

const nadaH = (texto = 'Nada operado nesta escala.') => `<p style="margin: 0; font-size: 14px; color: ${T.muted}">${texto}</p>`
const avisoH = (texto) => `<p style="margin: 0; font-size: 14px; line-height: 1.5; color: ${T.red}">${texto}</p>`
const subH = (titulo, inner, primeira = false) => `<div style="display: grid; gap: 12px; ${primeira ? '' : `border-top: 1px solid ${T.border}; padding-top: 16px`}">
  <h4 style="margin: 0; font-size: 14px; font-weight: 600; color: ${T.text}">${titulo}</h4>
  ${inner}
</div>`

const gradeBase = (cols, inner, gap = 16, align = 'stretch') => `<div style="display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); gap: ${gap}px; align-items: ${align}">${inner}</div>`

/* ============================ CONTEÚDO COMUM ============================ */
/* Os números vêm de DADOS; só as primitivas mudam entre os dois artboards. */

function conteudo(chave, k) {
  const { painel, hero, sub, listagem } = k
  const info = k.info
  const grade = (cols, inner, gap = 16) => gradeBase(cols, inner, gap, k.align ?? 'stretch')
  if (chave === 'escala') {
    const info = k.infoStack ?? k.info
    return grade(4, [
      info('Armador', CABECALHO.armador),
      info('Navio / viagem', CABECALHO.navio),
      info('Porto', CABECALHO.porto),
      info('Terminal', `${CABECALHO.terminal} &mdash; ${CABECALHO.terminalNome}`),
      info('ATA', CABECALHO.ata),
      info('ATB', CABECALHO.atb),
      info('ATD', CABECALHO.atd),
      info('Restow', CABECALHO.restow),
    ].join(''), 12)
  }
  if (chave === 'descarga') return k.descarga(grade)
  if (chave === 'vaziosImp') return k.vazios ? k.vazios() : `${hero(String(VAZIOS_IMP.modulo), 'vazios descarregados')}${listagem(VAZIOS_IMP.matriz)}`
  if (chave === 'veiculos') {
    return `${hero(String(VEICULOS.vins), 'VINs')}
      <div style="display: grid; gap: 8px">${VEICULOS.marcas.map(([m, d]) => info(m, d)).join('')}</div>
      ${grade(2, painel('Containers distintos por tipo', VEICULOS.porTipo.map(([t, n]) => info(t, String(n))).join(''))
        + painel('Ve&iacute;culos por modelo', VEICULOS.porModelo.map(([t, n]) => info(t, String(n))).join('')))}`
  }
  if (chave === 'granito') {
    return `${hero(GRANITO.ton, 'ton')}
      ${painel('Granito', `${info('B/Ls', String(GRANITO.bls))}${info('Blocos', String(GRANITO.blocos))}${info('Peso', `${GRANITO.ton} ton`)}`)}`
  }
  if (chave === 'vaziosExp') {
    const embarcados = `${hero(String(VAZIOS_EXP.total), 'vazios embarcados')}
      ${painel('Total por tipo', VAZIOS_EXP.porTipo.map(([t, n]) => info(t, String(n))).join(''))}
      ${grade(3, VAZIOS_EXP.porLocal.map(([local, tipos]) => painel(local, tipos.map(([t, n]) => info(t, String(n))).join(''))).join(''))}`
    const patio = `${hero(String(PATIO.storageDias), 'dias de storage')}
      ${grade(3, painel('Storage', `${info('Containers', String(PATIO.storageContainers))}${info('Dias', String(PATIO.storageDias))}`)
        + painel('Embarque direto', info('Unidades sem armazenagem', String(PATIO.embarqueDireto)))
        + painel('Locais', info('Depots / terminais', PATIO.locais)))}
      ${painel('Linhas de servi&ccedil;o', k.tabela())}
      ${painel('Totais', info('Total da opera&ccedil;&atilde;o', PATIO.total))}`
    return `${sub('Containers embarcados', embarcados, true)}${sub('Opera&ccedil;&atilde;o de p&aacute;tio', patio)}`
  }
  return ''
}

const LINHAS_HEAD = ['Servi&ccedil;o', 'Local', 'Rota', 'Tipo', 'Quantidade', 'Unit&aacute;rio', 'Total', 'Observa&ccedil;&atilde;o']

const tabelaLinhas = () => `<div style="overflow: hidden; border: 1px solid ${T.border}; border-radius: 8px">
  <table class="table table--dense">
    <thead><tr>${LINHAS_HEAD.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${PATIO.linhas.map((l) => `<tr>${l.map((c, i) => `<td${i >= 4 && i <= 6 ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>
</div>`

/* ================================ HOJE ================================= */

const infoStackH = (label, valor) => `<div style="display: grid; gap: 3px; border-bottom: 1px dashed ${T.border}; padding-bottom: 6px">
  <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">${label}</span>
  <span style="font-family: ${T.mono}; font-size: 13px; font-weight: 600; color: ${T.text}">${valor}</span>
</div>`

const KIT_HOJE = {
  info: infoH,
  infoStack: infoStackH,
  painel: painelH,
  hero: (v, u, chip = null) => chip
    ? `<div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 16px">${heroH(v, u)}<span style="border: 1px solid ${T.border}; border-radius: 999px; padding: 2px 9px; font-size: 12px; font-weight: 600; color: ${T.text}">${chip}</span></div>`
    : heroH(v, u),
  nada: nadaH,
  sub: subH,
  listagem: (rows) => `<div style="display: grid; gap: 8px">${rows.map(([t, c, n]) => infoH(`${t} &middot; ${c}`, String(n))).join('')}</div>`,
  tabela: tabelaLinhas,
  // Hero da seção acima dos dois painéis; "Descarga de importação" como título
  // do painel de containers; transbordo como categoria de um lado e bloco do
  // outro. É assim que VoyageAgencyReportTab.tsx monta hoje.
  descarga: (grade) => {
    const cs = DESCARGA.cargaSolta
    const linhas = (b) => `${infoH('B/Ls', String(b.bls))}${infoH('M&aacute;quinas', String(b.maquinas))}${infoH('Packages', String(b.packages))}${infoH('Peso', `${b.ton} ton`)}${infoH('CBM', b.cbm)}`
    return `<div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 16px">
        ${heroH(String(DESCARGA.containers.total), 'containers descarregados')}
        <span style="border: 1px solid ${T.border}; border-radius: 999px; padding: 2px 9px; font-size: 12px; font-weight: 600; color: ${T.text}">IMO: ${DESCARGA.containers.imo}</span>
      </div>
      ${grade(2, painelH('Carga solta', `${heroH(cs.destinoFinal.ton, 'ton')}${linhas(cs.destinoFinal)}
        ${subH('Em transbordo', linhas(cs.transbordo))}`)
        + painelH('Descarga de importa&ccedil;&atilde;o', `<div style="display: grid; gap: 8px">${MATRIZ_HOJE.map(([t, c, n]) => infoH(`${t} &middot; ${c}`, String(n))).join('')}</div>`))}`
  },
}

function pillHoje(label, ativo, extra = '') {
  return `<span class="btn btn--${ativo ? 'primary' : 'secondary'}" style="border-radius: 999px; font-size: 13px">${label}${extra}</span>`
}

/** .app-signoff — segmented de 3 estados, um por seção. */
function signoffHoje(estado) {
  const seg = (chave, label) => {
    const on = chave === estado
    const fundo = on ? (chave === 'confirmado' ? T.greenSoft : chave === 'nada' ? T.goldSoft : T.panelStrong) : 'transparent'
    const cor = on ? (chave === 'confirmado' ? '#157a45' : chave === 'nada' ? '#a85309' : T.text) : T.muted
    return `<span style="display: inline-flex; align-items: center; justify-content: center; min-height: 40px; min-width: 44px; padding: 6px 12px; border-radius: 9px; background: ${fundo}; color: ${cor}; font-size: 12px; font-weight: 600">${label}</span>`
  }
  return `<span style="display: inline-flex; gap: 3px; padding: 3px; border: 1px solid ${T.border}; border-radius: 12px; background: ${T.surfaceMuted}">
    ${seg('pendente', 'Pendente')}${seg('confirmado', 'Confirmado')}${seg('nada', 'Nada a declarar')}
  </span>`
}

function blocoHoje(s) {
  return `<section style="display: grid; gap: 16px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
    <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px">
      <h3 style="margin: 0; font-size: 16px; font-weight: 700; line-height: 1.35; color: ${T.textStrong}">${s.titulo}</h3>
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px">
        <span style="font-size: 12px; color: ${T.muted}">Setor: ${s.depto}</span>
        ${s.atribuicao ? `<span style="font-size: 12px; color: ${T.muted}">${s.atribuicao}</span>` : ''}
        ${s.historico ? `<span style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 999px; color: ${T.muted}">${icon('clock', 16, T.muted)}</span>` : ''}
        <span class="btn btn--secondary btn--sm">${s.obs ? 'Editar' : 'Adicionar'} observa&ccedil;&atilde;o</span>
        ${signoffHoje(s.estado)}
      </div>
    </div>
    ${conteudo(s.conteudo, KIT_HOJE)}
    ${s.avisos.map(([, texto]) => avisoH(texto)).join('')}
    ${s.obs ? `<div style="display: grid; gap: 5px; border-radius: 8px; background: ${T.panel}; padding: 10px 12px">
      <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">Observa&ccedil;&atilde;o</span>
      <p style="margin: 0; font-size: 14px; line-height: 1.5; color: ${T.text}">${s.obs}</p>
    </div>` : ''}
  </section>`
}

function marcoHoje(titulo, badge, linhas) {
  return `<div style="display: grid; gap: 4px; border-top: 1px solid ${T.border}; padding-top: 12px">
    <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px">
      <span style="font-size: 14px; font-weight: 600; color: ${T.text}">${titulo}</span>
      ${badge ?? ''}
    </div>
    ${linhas}
  </div>`
}

function timelineHoje() {
  const badge = (estado) => {
    const [tone, label] = PRAZO[estado]
    const cor = tone === 'green' ? T.green : tone === 'red' ? T.red : T.muted
    return `<span style="border: 1px solid ${cor}; border-radius: 999px; padding: 2px 9px; font-size: 12px; font-weight: 600; color: ${cor}">${label}</span>`
  }
  const p = (texto, mudo = false) => `<p style="margin: 0; font-size: 14px; color: ${mudo ? T.muted : T.text}">${texto}</p>`
  return `<section style="display: grid; gap: 16px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
    <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: ${T.textStrong}">Linha do tempo do ADR</h3>
    <div style="display: grid; gap: 4px">
      <span style="font-size: 14px; font-weight: 600; color: ${T.text}">Sa&iacute;da do navio (ATD)</span>
      ${p(`${CABECALHO.atd} <span style="color: ${T.muted}">&middot; registrado em 21/08/2026 18:40 (Atraca&ccedil;&atilde;o)</span>`)}
    </div>
    ${marcoHoje('Prazo de Conclus&atilde;o do ADR', null, p(`Vence em ${CABECALHO.prazo} (3 dias &uacute;teis ap&oacute;s o ATD).`))}
    ${DEPTOS.map((d) => marcoHoje(`Assinatura &mdash; ${d.nome}`, badge(d.prazo),
      (d.assinado ? p(`Assinado em ${d.quando} por ${d.quem}`) : p('Ainda n&atilde;o assinado.', true))
      + d.reaberturas.map(([quando, just]) => `<p style="margin: 0; font-size: 12px; color: ${T.muted}">${quando}: ${just}</p>`).join(''))).join('')}
    ${marcoHoje('Fechamento do ADR', null, p('ADR ainda aberto.', true))}
  </section>`
}

export function adrAntes() {
  const fase = (nome, secoes) => `<div style="display: grid; gap: 12px">
    <h2 style="margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: ${T.muted}">${nome}</h2>
    <div style="display: grid; gap: 16px">${secoes.map(blocoHoje).join('')}</div>
  </div>`

  return `<div style="display: grid; gap: 16px">
    <div style="display: flex; flex-wrap: wrap; gap: 8px">
      ${pillHoje('BRSSZ', true)}
      ${pillHoje('BRVIX', false, ` <span style="border-radius: 999px; background: ${T.surfaceMuted}; padding: 2px 7px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">Omitida</span>`)}
    </div>
    <div style="display: grid; gap: 10px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">ADR por terminal</span>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        ${pillHoje('BTP &mdash; Brasil Terminal Portu&aacute;rio', true)}
        ${pillHoje('DPW &mdash; DP World Santos', false)}
      </div>
    </div>
    <div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px">
        <span style="font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; color: ${T.muted}">2/3 departamentos assinados</span>
        <span class="btn btn--primary" style="opacity: 0.55">Fechar ADR</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
        ${DEPTOS.map((d) => `<div style="display: grid; gap: 8px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
            <span style="font-size: 14px; font-weight: 600; color: ${T.text}">${d.nome}</span>
            <span style="border: 1px solid ${d.assinado ? T.green : T.border}; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 600; color: ${d.assinado ? T.green : T.muted}">${d.assinado ? 'Assinado' : 'Pendente'}</span>
          </div>
          ${d.atribuicao ? `<span style="font-size: 12px; color: ${T.muted}">${d.atribuicao}</span>` : ''}
          <span class="btn btn--${d.assinado ? 'secondary' : 'primary'} btn--sm"${!d.assinado ? ' style="opacity: 0.55"' : ''}>${d.assinado ? 'Reabrir' : 'Assinar'}</span>
        </div>`).join('')}
      </div>
    </div>
    ${blocoHoje(SECOES[0])}
    ${fase('Importa&ccedil;&atilde;o', SECOES.filter((s) => s.fase === 'Importação'))}
    ${fase('Exporta&ccedil;&atilde;o', SECOES.filter((s) => s.fase === 'Exportação'))}
    ${timelineHoje()}
  </div>`
}

/* =========================== PRIMITIVAS DEPOIS ========================== */

const chipD = (tone, label, ic = null) => `<span class="badge badge--${tone}" style="padding: 4px 10px">${ic ? icon(ic, 12) + ' ' : ''}${label}</span>`

const infoD = (label, valor) => `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px">
  <span style="font-size: 12px; color: ${T.muted}">${label}</span>
  <span style="font-family: ${T.mono}; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: ${T.text}">${valor}</span>
</div>`

const painelD = (titulo, inner) => `<div style="display: grid; gap: 9px; align-content: start; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; padding: 12px 14px">
  <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.mutedSoft}">${titulo}</div>
  <div style="display: grid; gap: 7px">${inner}</div>
</div>`

const heroD = (valor, unidade, chip = null) => `<div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px">
  <span style="font-family: ${T.display}; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: ${T.textStrong}">${valor}</span>
  ${unidade ? `<span style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.mutedSoft}">${unidade}</span>` : ''}
  ${chip ? chipD('red', chip) : ''}
</div>`

const subD = (titulo, inner, primeira = false) => `<div style="display: grid; gap: 12px; ${primeira ? '' : `border-top: 1px dashed ${T.border}; padding-top: 14px`}">
  <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">${titulo}</span>
  ${inner}
</div>`

const tokenD = (label, n) => `<span class="pill" style="background: ${T.surfaceMuted}; gap: 6px; padding: 3px 9px">${label}<b style="font-family: ${T.mono}; font-size: 11px; color: ${T.text}">${n}</b></span>`

const infoStackD = (label, valor) => `<div style="display: grid; gap: 2px; align-content: start">
  <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.mutedSoft}">${label}</span>
  <span style="font-size: 13px; font-weight: 600; color: ${T.text}">${valor}</span>
</div>`

const KIT_DEPOIS = {
  info: infoD,
  infoStack: infoStackD,
  painel: painelD,
  hero: heroD,
  nada: (t = 'Nada operado nesta escala') => `<div style="border: 1px dashed ${T.border}; border-radius: 6px; padding: 12px; text-align: center; font-size: 12px; color: ${T.mutedSoft}">${t}</div>`,
  sub: subD,
  align: 'start',
  listagem: (rows) => `<div style="display: flex; flex-wrap: wrap; gap: 6px">${rows.map(([t, c, n]) => tokenD(`${t} &middot; ${c}`, n)).join('')}</div>`,
  tabela: tabelaLinhas,
  descarga: (grade) => descargaDepois(grade),
  vazios: () => {
    const v = VAZIOS_IMP
    return `<div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px">
        ${heroD(String(v.modulo), 'vazios classificados')}
        ${chipD('slate', `Baplie ${v.baplie}`)}
        ${chipD('yellow', `${v.semNatureza} sem natureza`)}
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px">${v.matriz.map(([t, c, n]) => tokenD(`${t} &middot; ${c}`, n)).join('')}</div>
      <p style="margin: 0; font-size: 10px; line-height: 1.5; color: ${T.mutedSoft}">As duas fontes ficam lado a lado: o <b>Baplie</b> conta quantos vazios chegaram, o <b>m&oacute;dulo de Vazios de Importa&ccedil;&atilde;o</b> os classifica em cama e cover plate. Os ${DESCARGA.containers.vaziosMovidos} que o Baplie traz sem B/L moram aqui, e s&oacute; aqui.</p>`
  },
}

/**
 * Os dois modos de carga passam a ter a MESMA gramática: total do modo no topo
 * do próprio painel, depois os dois destinos como baldes irmãos. Some o hero
 * solto acima dos painéis (que parecia cobrir os dois e só falava de
 * container), e "Descarga de importação" — nome que sugere exportação sendo
 * descarregada — vira "Containers descarregados".
 */
function descargaDepois(grade) {
  const c = DESCARGA.containers
  const cs = DESCARGA.cargaSolta

  /** Cabeçalho do painel: o total daquele modo de carga, e só dele. */
  const topo = (valor, unidade, direita) => `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid ${T.border}; padding-bottom: 10px">
    <span style="display: inline-flex; align-items: baseline; gap: 8px">
      <span style="font-family: ${T.display}; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: ${T.textStrong}">${valor}</span>
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.mutedSoft}">${unidade}</span>
    </span>
    ${direita ?? ''}
  </div>`

  /** Destino: o mesmo bloco dos dois lados, só muda o que ele conta. */
  const destino = (rotulo, lead, corpo) => `<div style="display: grid; gap: 8px">
    <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px">
      <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">${rotulo}</span>
      <span style="font-family: ${T.mono}; font-size: 12px; font-weight: 600; color: ${T.text}">${lead}</span>
    </div>
    ${corpo}
  </div>`

  /** Duas leituras do mesmo conjunto: só o tipo, e o tipo cruzado com a natureza. */
  const bloco = (rotulo, corpo, nota = '') => `<div style="display: grid; gap: 7px">
    <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px">
      <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">${rotulo}</span>
      ${nota ? `<span style="font-size: 10px; color: ${T.mutedSoft}">${nota}</span>` : ''}
    </div>
    ${corpo}
  </div>`

  const cel = (v, forte = false) => `<td style="padding: 5px 8px; text-align: right; font-family: ${T.mono}; font-size: 12px; font-variant-numeric: tabular-nums; color: ${v === 0 ? T.mutedSoft : forte ? T.textStrong : T.text}; font-weight: ${forte ? 700 : 500}">${v === 0 ? '&mdash;' : v}</td>`
  const totalCol = NATUREZAS.map((_, k) => c.porNatureza.reduce((acc, l) => acc + l[k + 1], 0))

  const tabelaNatureza = `<div style="overflow: hidden; border: 1px solid ${T.border}; border-radius: 6px">
    <table style="width: 100%; border-collapse: collapse">
      <thead><tr style="background: ${T.surfaceMuted}">
        <th style="padding: 6px 8px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${T.mutedSoft}">Tipo</th>
        ${NATUREZAS.map((n) => `<th style="padding: 6px 8px; text-align: right; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${T.mutedSoft}">${n}</th>`).join('')}
        <th style="padding: 6px 8px; text-align: right; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${T.muted}">Total</th>
      </tr></thead>
      <tbody>
        ${c.porNatureza.map(([tipo, ...vals]) => `<tr style="border-top: 1px solid ${T.border}">
          <td style="padding: 5px 8px; font-size: 12px; font-weight: 600; color: ${T.text}">${tipo}</td>
          ${vals.map((v) => cel(v)).join('')}
          ${cel(vals.reduce((a, b) => a + b, 0), true)}
        </tr>`).join('')}
        <tr style="border-top: 1px solid ${T.borderStrong}; background: ${T.surfaceMuted}">
          <td style="padding: 5px 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${T.muted}">Total</td>
          ${totalCol.map((v) => cel(v, true)).join('')}
          ${cel(c.total, true)}
        </tr>
      </tbody>
    </table>
  </div>`

  const painelContainers = `<div style="display: grid; gap: 12px; align-content: start; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; padding: 12px 14px">
    <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.mutedSoft}">Containers descarregados</div>
    ${topo(String(c.total), 'unidades', `<span style="display: inline-flex; align-items: center; gap: 6px">${chipD('red', `IMO ${c.imo}`)}${chipD('yellow', `OOG ${c.oog}`)}</span>`)}
    ${bloco('Por tipo', `<div style="display: flex; flex-wrap: wrap; gap: 6px">${c.porTipo.map(([t, n]) => tokenD(t, n)).join('')}</div>`)}
    ${bloco('Por tipo e natureza', tabelaNatureza, `IMO e OOG ao mesmo tempo conta em OOG &mdash; hoje ${c.imoEOog}`)}
    ${bloco('Destino', `<div style="display: flex; flex-wrap: wrap; gap: 6px">${tokenD('Destino final', c.destinoFinal)}${tokenD('Em transbordo', c.transbordo)}</div>`)}
    <p style="margin: 0; font-size: 10px; line-height: 1.5; color: ${T.mutedSoft}">S&oacute; container cheio. Os ${c.vaziosMovidos} vazios que o Baplie traz sem B/L saem daqui e passam a viver s&oacute; em <b>Vazios descarregados</b> &mdash; hoje aparecem nos dois lugares.</p>
  </div>`

  const stats = (b) => `<div style="display: flex; flex-wrap: wrap; gap: 6px">${[['M&aacute;quinas', b.maquinas], ['Packages', b.packages], ['CBM', b.cbm]].map(([l, v]) => tokenD(l, v)).join('')}</div>`

  const painelSolta = `<div style="display: grid; gap: 12px; align-content: start; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; padding: 12px 14px">
    <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.mutedSoft}">Carga solta</div>
    ${topo(String(cs.bls), 'B/Ls', `<span style="font-family: ${T.mono}; font-size: 13px; font-weight: 600; color: ${T.text}">${cs.ton} ton</span>`)}
    ${destino('Destino final', `${cs.destinoFinal.bls} B/Ls &middot; ${cs.destinoFinal.ton} ton`, stats(cs.destinoFinal))}
    ${destino('Em transbordo', `${cs.transbordo.bls} B/L &middot; ${cs.transbordo.ton} ton`, stats(cs.transbordo))}
  </div>`

  const legenda = `<div style="display: flex; align-items: flex-start; gap: 8px; font-size: 11px; line-height: 1.55; color: ${T.mutedSoft}">
    ${icon('arrowRight', 13, T.mutedSoft)}
    <span>Tudo nesta se&ccedil;&atilde;o desceu nesta escala. <b style="color: ${T.muted}">Destino final</b> &eacute; a carga que acaba aqui; <b style="color: ${T.muted}">Em transbordo</b> desceu aqui mas tem destino no porto que o navio omitiu, e segue por outro meio.</span>
  </div>`

  return `${grade(2, painelContainers + painelSolta)}${legenda}`
}

/* =============================== PROPOSTA ============================== */

export function adrDepois() {
  /**
   * Cabeçalho preservado como está hoje: a fileira de escalas e o painel "ADR
   * por terminal". O que sobra do painel de departamentos — o contador e o
   * Fechar ADR — vira uma faixa própria, já que os três cartões de assinatura
   * desceram para dentro dos grupos de seção.
   */
  const pill = (label, ativo, extra = '') => `<span class="btn btn--${ativo ? 'primary' : 'secondary'}" style="border-radius: 999px; font-size: 13px">${label}${extra}</span>`

  const cabecalho = `<div style="display: flex; flex-wrap: wrap; gap: 8px">
      ${pill('BRSSZ', true)}
      ${pill('BRVIX', false, ` <span style="border-radius: 999px; background: ${T.surfaceMuted}; padding: 2px 7px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">Omitida</span>`)}
    </div>
    <div style="display: grid; gap: 10px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">ADR por terminal</span>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        ${pill('BTP &mdash; Brasil Terminal Portu&aacute;rio', true)}
        ${pill('DPW &mdash; DP World Santos', false)}
      </div>
    </div>
    <div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px">
        <span style="display: inline-flex; align-items: center; gap: 10px">
          <span style="font-family: ${T.mono}; font-size: 13px; font-weight: 600; color: ${T.gold}">2/3 departamentos assinados</span>
          ${chipD('yellow', `Prazo ${CABECALHO.prazo}`, 'clock')}
        </span>
        <span style="display: inline-flex; align-items: center; gap: 8px">
          <span class="btn btn--secondary btn--sm">Imprimir</span>
          <span class="btn btn--primary btn--sm" style="opacity: 0.55">Fechar ADR</span>
        </span>
      </div>
      <div style="display: flex; align-items: flex-start; gap: 8px; border-top: 1px solid ${T.border}; padding-top: 12px; font-size: 12px; line-height: 1.5; color: ${T.mutedSoft}">
        ${icon('warning', 14, T.gold)}
        <span><b style="color: ${T.goldStrong}">Falta Equipamentos assinar</b> &mdash; 2 de 3 se&ccedil;&otilde;es do setor ainda pendentes (Ve&iacute;culos e Embarque de vazios). Os 3 departamentos precisam assinar para fechar este ADR.</span>
      </div>
    </div>`

  const blocoSecao = (s) => {
    const [tone, label] = ESTADO[s.estado]
    const borda = s.estado === 'pendente' ? T.gold : T.border
    return `<div style="display: grid; gap: 12px; border: 1px solid ${borda}; border-radius: 8px; background: ${T.surface}; padding: 14px 16px">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap">
        <span style="display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap">
          <span style="font-size: 15px; font-weight: 700; color: ${T.textStrong}">${s.titulo}</span>
          ${s.frentes.map((f) => `<span class="pill" style="background: ${T.surfaceMuted}">${f}</span>`).join('')}
          ${s.historico ? `<span style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: ${T.mutedSoft}">${icon('clock', 11, T.mutedSoft)} ${s.historico} no hist&oacute;rico</span>` : ''}
        </span>
        <span style="display: inline-flex; align-items: center; gap: 8px">
          ${s.atribuicao ? `<span style="font-size: 11px; color: ${T.mutedSoft}">${s.atribuicao}</span>` : ''}
          ${chipD(tone, label, s.estado === 'confirmado' ? 'shield' : null)}
          <span class="btn btn--secondary btn--sm" style="min-height: 32px; font-size: 11px">Alterar</span>
        </span>
      </div>
      ${conteudo(s.conteudo, KIT_DEPOIS)}
      ${s.avisos.map(([tipo, texto]) => tipo === 'divergencia'
        ? `<div style="display: flex; align-items: flex-start; gap: 9px; border: 1px solid #fecaca; border-radius: 8px; background: ${T.redSoft}; padding: 10px 12px">
            ${icon('warning', 14, T.red)}
            <span style="font-size: 12px; line-height: 1.5; color: ${T.red}"><b>Diverg&ecirc;ncia</b> &mdash; ${texto}</span>
          </div>`
        : `<div style="display: flex; align-items: flex-start; gap: 9px; border: 1px solid #fde68a; border-radius: 8px; background: ${T.goldSoft}; padding: 10px 12px">
            ${icon('warning', 14, T.gold)}
            <span style="font-size: 12px; line-height: 1.5; color: ${T.goldStrong}"><b>Dado &oacute;rf&atilde;o</b> &mdash; ${texto}</span>
          </div>`).join('')}
      ${s.obs ? `<div style="display: grid; gap: 5px; border-left: 3px solid ${T.borderStrong}; border-radius: 0 6px 6px 0; background: ${T.surfaceMuted}; padding: 9px 12px">
        <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.mutedSoft}">Observa&ccedil;&atilde;o</span>
        <p style="margin: 0; font-size: 12px; line-height: 1.55; color: ${T.text}">${s.obs}</p>
      </div>` : ''}
    </div>`
  }

  const grupoDepto = (d) => {
    const minhas = SECOES.filter((s) => s.depto === d.nome)
    const resolvidas = minhas.filter((s) => s.estado !== 'pendente').length
    const completo = resolvidas === minhas.length
    const [pTone, pLabel] = PRAZO[d.prazo]
    return `<section style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap">
        <span style="display: inline-flex; align-items: center; gap: 12px">
          <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">${d.nome}</span>
          <span style="font-family: ${T.mono}; font-size: 12px; font-weight: 600; color: ${completo ? T.green : T.gold}">${resolvidas}/${minhas.length} se&ccedil;&otilde;es</span>
          <span style="display: inline-flex; gap: 3px">${minhas.map((s) => `<span style="width: 26px; height: 4px; border-radius: 999px; background: ${s.estado === 'pendente' ? T.panelStrong : T.green}"></span>`).join('')}</span>
          ${d.assinado ? chipD(pTone, pLabel) : ''}
        </span>
        <span style="display: inline-flex; align-items: center; gap: 10px">
          ${d.atribuicao ? `<span style="font-size: 11px; color: ${T.mutedSoft}">${d.atribuicao}</span>` : ''}
          ${d.assinado ? chipD('green', 'Assinado', 'shield') : chipD('yellow', 'Aguardando assinatura')}
          <span class="btn btn--${d.assinado ? 'secondary' : 'primary'} btn--sm" style="min-height: 34px${!d.assinado && !completo ? '; opacity: 0.5' : ''}">${d.assinado ? 'Reabrir' : 'Assinar setor'}</span>
        </span>
      </div>
      ${d.reaberturas.map(([quando, just]) => `<div style="display: flex; align-items: flex-start; gap: 8px; border-radius: 6px; background: ${T.panel}; padding: 8px 11px; font-size: 11px; line-height: 1.5; color: ${T.muted}">
        ${icon('refresh', 12, T.muted)}<span><b>${quando}</b> &mdash; ${just}</span>
      </div>`).join('')}
      <div style="display: grid; gap: 10px">${minhas.map(blocoSecao).join('')}</div>
    </section>`
  }

  /* A linha do tempo deixa de ser uma pilha de marcos empilhados e vira um
     trilho: cada marco é uma parada, o estado do prazo mora na parada, e a
     reabertura pendura embaixo de quem foi reaberto. */
  const parada = (rotulo, valor, badge, nota) => `<div style="display: grid; gap: 4px; align-content: start; flex: 1; min-width: 0; border-left: 1px solid ${T.border}; padding-left: 14px">
    <span style="display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap">
      <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.mutedSoft}">${rotulo}</span>
      ${badge ?? ''}
    </span>
    <span style="font-size: 12px; font-weight: 600; color: ${valor === '&mdash;' ? T.mutedSoft : T.text}">${valor}</span>
    ${nota ? `<span style="font-size: 10px; line-height: 1.45; color: ${T.mutedSoft}">${nota}</span>` : ''}
  </div>`

  const timeline = `<section style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">
    <div style="display: flex; align-items: center; gap: 12px">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">Linha do tempo</span>
      <span style="flex: 1; height: 1px; background: ${T.border}"></span>
      <span style="font-size: 11px; color: ${T.mutedSoft}">prazo = ATD + 3 dias &uacute;teis</span>
    </div>
    <div style="display: flex; gap: 14px">
      ${parada('Sa&iacute;da (ATD)', CABECALHO.atd, null, 'registrado 21/08 18:40 &middot; Atraca&ccedil;&atilde;o')}
      ${parada('Prazo', CABECALHO.prazo, chipD('yellow', 'Em aberto'), '3 dias &uacute;teis ap&oacute;s o ATD')}
      ${DEPTOS.map((d) => parada(d.nome, d.assinado ? d.quando : 'Ainda n&atilde;o assinado', chipD(...PRAZO[d.prazo]),
        d.assinado ? `por ${d.quem}` : '2 se&ccedil;&otilde;es pendentes')).join('')}
      ${parada('Fechamento', '&mdash;', chipD('slate', 'Aberto'), 'depende dos 3 setores')}
    </div>
    ${DEPTOS.filter((d) => d.reaberturas.length).map((d) => d.reaberturas.map(([quando, just]) => `<div style="display: flex; align-items: flex-start; gap: 8px; border-top: 1px dashed ${T.border}; padding-top: 10px; font-size: 11px; line-height: 1.5; color: ${T.muted}">
      ${icon('refresh', 12, T.muted)}<span><b>${d.nome}</b> &middot; ${quando} &mdash; ${just}</span>
    </div>`).join('')).join('')}
  </section>`

  return `<div style="display: flex; flex-direction: column; gap: 16px">
    ${cabecalho}
    ${secao('Se&ccedil;&otilde;es por departamento', 'quem assina responde pelo grupo inteiro')}
    <div style="display: grid; gap: 12px">${DEPTOS.map(grupoDepto).join('')}</div>
    ${timeline}
    <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-inline: 2px; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">
      <span>A pastilha ao lado da se&ccedil;&atilde;o &eacute; a frente de opera&ccedil;&atilde;o que a comp&otilde;e &mdash; &eacute; ela que decide se h&aacute; conte&uacute;do neste terminal.</span>
      <span style="width: 1px; height: 12px; background: ${T.border}"></span>
      <span>O prazo por departamento (<code>ADR 0039</code>) sobe para o grupo; a linha do tempo continua abaixo, como hist&oacute;rico.</span>
    </div>
  </div>`
}

/* ============================ MATRIZ DE ESTADOS ========================= */
/**
 * As hipóteses que não cabem no fluxo cheio: os dois vazios do recorte por
 * terminal, os vazios de conteúdo, o documento fechado, a escala omitida, o
 * ADR legado sem terminal_id e o leitor sem permissão de sign-off. Cada cartão
 * cita a condição que o produz no código.
 */
export function adrEstados() {
  const caso = (titulo, fonte, corpo) => `<div style="display: grid; gap: 10px; align-content: start; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; padding: 14px 16px">
    <div style="display: grid; gap: 3px">
      <span style="font-size: 13px; font-weight: 700; color: ${T.textStrong}">${titulo}</span>
      <span style="font-family: ${T.mono}; font-size: 10px; color: ${T.mutedSoft}">${fonte}</span>
    </div>
    ${corpo}
  </div>`

  const vazio = (t) => `<div style="border: 1px dashed ${T.border}; border-radius: 6px; padding: 14px; text-align: center; font-size: 12px; color: ${T.mutedSoft}">${t}</div>`
  const secaoMini = (titulo, frentes, estado, corpo) => {
    const [tone, label] = ESTADO[estado]
    return `<div style="display: grid; gap: 10px; border: 1px solid ${estado === 'pendente' ? T.gold : T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 12px 14px">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap">
        <span style="display: inline-flex; align-items: center; gap: 8px">
          <span style="font-size: 14px; font-weight: 700; color: ${T.textStrong}">${titulo}</span>
          ${frentes.map((f) => `<span class="pill" style="background: ${T.surface}">${f}</span>`).join('')}
        </span>
        ${chipD(tone, label, estado === 'confirmado' ? 'shield' : null)}
      </div>
      ${corpo}
    </div>`
  }

  const casos = [
    caso('Se&ccedil;&atilde;o sem frente neste terminal', 'terminalView.assigned === false',
      secaoMini('Ve&iacute;culos', [], 'nada', vazio('N&atilde;o h&aacute; frente atribu&iacute;da a este terminal')
        + `<p style="margin: 0; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">A se&ccedil;&atilde;o continua exigindo resolu&ccedil;&atilde;o: o sign-off &eacute; irm&atilde;o do conte&uacute;do, n&atilde;o filho dele.</p>`)),

    caso('Frente atribu&iacute;da, nada operado', "selected.state === 'nothing_operated'",
      secaoMini('Vazios descarregados', ['Vazios IMP'], 'nada', vazio('Nada operado nesta frente'))),

    caso('Sem recorte por terminal, sem dado', 'containers.length === 0 && !cargaSolta?.bls',
      secaoMini('Carga descarregada', ['CNTR importa&ccedil;&atilde;o'], 'nada', vazio('Nada operado nesta escala'))),

    caso('Embarque de vazios sem opera&ccedil;&atilde;o', '!bookings.length && !hasPatioOperation',
      secaoMini('Embarque de vazios', ['Vazios EXP'], 'pendente',
        subD('Containers embarcados', vazio('Nenhum vazio embarcado nesta escala'), true)
        + subD('Opera&ccedil;&atilde;o de p&aacute;tio', vazio('Nenhum servi&ccedil;o de p&aacute;tio nesta escala')))),

    caso('Documento fechado', "ownData.status === 'closed' && closedSnapshot",
      `<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border: 1px solid #86efac; border-radius: 8px; background: ${T.greenSoft}; padding: 12px 14px">
        <span style="display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: #157a45">${icon('shield', 14, '#157a45')} Fechado em 28/08/2026 por Ana Ribeiro</span>
        <span style="display: inline-flex; gap: 8px">
          <span class="btn btn--secondary btn--sm">Imprimir</span>
          <span class="btn btn--primary btn--sm">Reabrir</span>
        </span>
      </div>
      <p style="margin: 0; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">As se&ccedil;&otilde;es somem: o que fica &eacute; o snapshot congelado e a linha do tempo. <b>Reabrir</b> exige justificativa e s&oacute; aparece para administrador.</p>`),

    caso('Escala omitida', 'pods.find(...).omitted === true',
      `<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
        <span class="btn btn--primary btn--sm" style="border-radius: 999px; min-height: 34px">BRVIX ${chipD('slate', 'Omitida')}</span>
        ${chipD('slate', 'Sem prazo')}
      </div>
      <div style="display: grid; gap: 4px; border-radius: 6px; background: ${T.surfaceMuted}; padding: 10px 12px">
        <span style="font-size: 12px; font-weight: 600; color: ${T.text}">Prazo de Conclus&atilde;o do ADR</span>
        <span style="font-size: 12px; color: ${T.muted}">Escala omitida &mdash; fora da medi&ccedil;&atilde;o.</span>
      </div>`),

    caso('Sem ATD registrado', 'terminalAtd === null',
      `<div style="display: grid; gap: 10px">
        ${['Sa&iacute;da do navio (ATD)', 'Prazo de Conclus&atilde;o do ADR'].map((t) => `<div style="display: grid; gap: 4px; border-radius: 6px; background: ${T.surfaceMuted}; padding: 10px 12px">
          <span style="font-size: 12px; font-weight: 600; color: ${T.text}">${t}</span>
          <span style="font-size: 12px; color: ${T.muted}">Aguardando a sa&iacute;da do navio.</span>
        </div>`).join('')}
      </div>
      <p style="margin: 0; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">O rel&oacute;gio do ADR &eacute; a Atraca&ccedil;&atilde;o do terminal selecionado &mdash; sem fallback para o ATD documental do POL.</p>`),

    caso('Leitor sem permiss&atilde;o de sign-off', 'canSignoff === false',
      secaoMini('Granito', ['Granito'], 'confirmado', `<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
        <span style="border: 1px solid ${T.border}; border-radius: 999px; background: ${T.surface}; padding: 4px 10px; font-size: 11px; font-weight: 600; color: ${T.text}">Confirmado</span>
        <span style="font-size: 11px; color: ${T.mutedSoft}">sem segmented, sem bot&atilde;o de observa&ccedil;&atilde;o &mdash; s&oacute; o r&oacute;tulo</span>
      </div>`)),

    caso('ADR legado, sem terminal', 'resolvedReportId === null',
      `<div style="display: grid; gap: 7px">
        <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">Terminal</span>
        <div style="display: flex; gap: 8px">
          <span style="flex: 1; min-height: 40px; display: flex; align-items: center; border: 1px solid ${T.borderStrong}; border-radius: 8px; background: ${T.surface}; padding: 0 12px; font-size: 13px; color: ${T.mutedSoft}">Informe o terminal</span>
          <span class="btn btn--secondary btn--sm">Salvar</span>
        </div>
      </div>
      <p style="margin: 0; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">Texto livre, sem recorte por frente: todas as se&ccedil;&otilde;es mostram o dado da escala inteira. S&oacute; um relat&oacute;rio com <code>terminal_id</code> alimenta as RPCs <code>*_by_report_id</code>.</p>`),

    caso('Departamento atrasado e reaberto', 'deriveAgencyReportDeadlineState → overdue',
      `<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; border-radius: 6px; background: ${T.surfaceMuted}; padding: 10px 12px">
        <span style="font-size: 12px; font-weight: 600; color: ${T.text}">Assinatura &mdash; Documenta&ccedil;&atilde;o</span>
        ${chipD('red', 'Atrasado')}
      </div>
      <div style="display: flex; align-items: flex-start; gap: 8px; border-radius: 6px; background: ${T.panel}; padding: 8px 11px; font-size: 11px; line-height: 1.5; color: ${T.muted}">
        ${icon('refresh', 12, T.muted)}<span><b>Reaberto em 25/08/2026 14:20 por Ana Ribeiro</b> &mdash; Baplie reprocessado depois da corre&ccedil;&atilde;o de 3 containers &oacute;rf&atilde;os.</span>
      </div>
      <p style="margin: 0; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">Prazo = ATD + 3 dias &uacute;teis. Reabrir exige justificativa auditada; assinar pela primeira vez, s&oacute; confirma&ccedil;&atilde;o.</p>`),

    caso('Sem escala, erro e carregamento', 'guardas antes do corpo da aba',
      `<div style="display: grid; gap: 8px">
        ${[['Nenhuma escala ativa para compor o ADR.', T.muted],
           ['N&atilde;o foi poss&iacute;vel carregar frentes, terminais e ADRs da escala. Nenhuma a&ccedil;&atilde;o foi habilitada.', T.red],
           ['Carregando frentes, terminais e ADRs da escala&hellip;', T.muted]].map(([t, c]) => `<div style="border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 11px 13px; font-size: 12px; line-height: 1.5; color: ${c}">${t}</div>`).join('')}
      </div>`),

    caso('Fechar ADR bloqueado', 'signedDepartmentsCount !== 3',
      `<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-radius: 6px; background: ${T.surfaceMuted}; padding: 11px 13px">
        <span style="font-family: ${T.mono}; font-size: 12px; font-weight: 600; color: ${T.gold}">2/3 departamentos assinados</span>
        <span class="btn btn--primary btn--sm" style="opacity: 0.55">Fechar ADR</span>
      </div>
      <p style="margin: 0; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">Hoje o motivo vive s&oacute; no <code>title</code> do bot&atilde;o. Na proposta ele sobe para o cabe&ccedil;alho, nomeando o setor que falta.</p>`),
  ]

  return `<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px">${casos.join('')}</div>`
}

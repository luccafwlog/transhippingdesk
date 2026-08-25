import { T, icon } from './kit.mjs'

/**
 * Aba Importação: o "hoje" transcreve VoyageImportacaoTab.tsx com os estilos
 * resolvidos de index.css (.app-panel, .app-voyage-metric-panel, .app-voyage-info).
 * Dados coerentes com a viagem usada na Visão geral (ARIES / 088E).
 */

const PODS = [
  {
    pod: 'BRSSZ', nome: 'Santos',
    resumo: '11 CNTRs · 2 B/Ls carga solta',
    containers: { distinct: 11, imo: 0, oog: 1, geral: 11, comVeiculos: 0, types: [['20GP', 4], ['40HC', 6], ['40OT', 1]] },
    cargaSolta: { bls: 2, maquinas: 4, packages: 61, ton: '213', cbm: '388,4' },
    veiculos: null,
    vaziosImp: { containers: 4, manifestos: 1, tipos: [['20GP', 2], ['40HC', 2]] },
  },
  {
    pod: 'BRVIX', nome: 'Vitória',
    resumo: '2 CNTRs · 1 CNTR c/ veículos',
    containers: { distinct: 2, imo: 0, oog: 0, geral: 1, comVeiculos: 1, types: [['40HC', 2]] },
    cargaSolta: null,
    veiculos: { unidades: 4, containers: 1, marcas: [['TOYOTA', 3], ['HONDA', 1]], tipos: [['40HC', 1]] },
    vaziosImp: { containers: 2, manifestos: 1, tipos: [['40HC', 2]] },
  },
]

/** Só o "hoje" ainda agrega Vazios IMP por viagem — é o que o componente faz. */
const VAZIOS_IMP_HOJE = { manifestos: 2, containers: 6, tipos: ['20GP', '40HC'], destinos: 'Santos, Vitória' }

const TOTAIS = [
  ['B/Ls', '10'], ['CNTRs distintos', '13'], ['IMO', '0'], ['OOG', '1'],
  ['Veículos', '4'], ['Carga solta', '213 ton'],
]

/* ================================ ANTES ================================ */
/** .app-voyage-info: label à esquerda, valor à direita, borda entre linhas. */
function infoAntes(label, value, { tokens = null } = {}) {
  if (tokens) {
    return `<div style="display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; border-bottom: 1px solid ${T.border}; padding-bottom: 10px">
      <span style="color: ${T.muted}; line-height: 1.45">${label}</span>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">${tokens.map((t) => `<span style="display: inline-flex; align-items: center; justify-content: center; border: 1px solid ${T.border}; border-radius: 999px; background: ${T.surface}; color: ${T.text}; padding: 5px 9px; font-size: 11px; font-weight: 700; line-height: 1.2; box-shadow: ${T.shadow}">${t}</span>`).join('')}</div>
    </div>`
  }
  return `<div style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; border-bottom: 1px solid ${T.border}; padding-bottom: 10px">
    <span style="color: ${T.muted}; line-height: 1.45">${label}</span>
    <span style="color: ${T.text}; font-weight: 700; text-align: right">${value}</span>
  </div>`
}

/** .app-voyage-metric-panel: gradiente + sombra + raio 12. */
function metricPanelAntes(title, children) {
  return `<div style="display: flex; flex-direction: column; gap: 14px; border: 1px solid ${T.border}; border-radius: 12px; background: linear-gradient(180deg, ${T.surface} 0%, ${T.surfaceMuted} 100%); padding: 18px; box-shadow: ${T.shadow}">
    <div style="color: ${T.text}; font-size: 17px; font-weight: 700">${title}</div>
    <dl style="display: grid; gap: 12px; margin: 0; font-size: 14px; color: ${T.text}">${children}</dl>
  </div>`
}

export function importacaoAntes() {
  const podBlocks = PODS.map((p) => {
    const paineis = [
      metricPanelAntes('Containers', [
        infoAntes('CNTRS distintos', String(p.containers.distinct)),
        infoAntes('Containers IMO', String(p.containers.imo)),
        infoAntes('Containers OOG', String(p.containers.oog)),
        infoAntes('Tipos de container', '', { tokens: p.containers.types.map(([t, n]) => `${t}: ${n}`) }),
      ].join('')),
      p.veiculos ? metricPanelAntes('Ve&iacute;culos', [
        infoAntes('Containers com veiculos', String(p.veiculos.containers)),
        infoAntes('Carga geral (CNTRs)', String(p.containers.geral)),
      ].join('')) : null,
      p.cargaSolta ? metricPanelAntes('Carga solta', [
        infoAntes('B/Ls carga solta', String(p.cargaSolta.bls)),
        infoAntes('M&aacute;quinas', String(p.cargaSolta.maquinas)),
        infoAntes('Packages', String(p.cargaSolta.packages)),
        infoAntes('Weight total', `${p.cargaSolta.ton} ton`),
        infoAntes('CBM total', p.cargaSolta.cbm),
      ].join('')) : null,
    ].filter(Boolean)
    return `<div style="display: grid; gap: 16px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <div style="display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px">
        <div style="color: ${T.textStrong}; font-size: 16px; font-weight: 700; line-height: 1.35">${p.pod}</div>
        <div style="font-size: 12px; color: ${T.muted}">${p.resumo}</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start">${paineis.join('')}</div>
    </div>`
  }).join('')

  return `<div style="display: flex; flex-direction: column; gap: 16px">
    <div style="display: grid; gap: 16px">${podBlocks}</div>
    ${metricPanelAntes('Vazios Importacao', [
      infoAntes('Manifestos', String(VAZIOS_IMP_HOJE.manifestos)),
      infoAntes('Containers distintos', String(VAZIOS_IMP_HOJE.containers)),
      infoAntes('Tipos', VAZIOS_IMP_HOJE.tipos.join(', ')),
      infoAntes('Destinos', VAZIOS_IMP_HOJE.destinos),
    ].join(''))}
    <section style="display: grid; gap: 16px; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surfaceMuted}; padding: 16px">
      <div>
        <div style="font-size: 14px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}">Importa&ccedil;&atilde;o r&aacute;pida</div>
        <div style="margin-top: 4px; font-size: 14px; color: ${T.muted}">Importe manifestos e planilhas diretamente nesta viagem sem sair da tela.</div>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        ${['Baplie EDI', 'B/L', 'CE Mercante', 'Manifesto BB', 'Ve&iacute;culos', 'Vazios IMP']
          .map((l) => `<span class="btn btn--secondary" style="font-size: 12px">${icon('boxOpen', 13)} ${l}</span>`).join('')}
      </div>
    </section>
  </div>`
}

/* ================================ DEPOIS =============================== */
/** Chapado, sem gradiente nem sombra — o vocabulário do resto da página. */
function painel({ title, icone, lead, leadUnit, stats = [], tokens = null, tokensHtml = null, vazio = null }) {
  return `<div style="display: flex; flex-direction: column; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; padding: 14px 16px">
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px">
      <span style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: ${vazio ? T.mutedSoft : T.textStrong}">${icon(icone, 15, vazio ? T.mutedSoft : T.muted)} ${title}</span>
      ${vazio ? '' : `<span style="display: inline-flex; align-items: baseline; gap: 5px">
        <span style="font-family: ${T.display}; font-size: 22px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: ${T.textStrong}">${lead}</span>
        <span style="font-size: 11px; font-weight: 600; color: ${T.mutedSoft}">${leadUnit}</span>
      </span>`}
    </div>
    ${vazio
      ? `<div style="flex: 1; display: flex; align-items: center; justify-content: center; border: 1px dashed ${T.border}; border-radius: 6px; padding: 14px; font-size: 12px; color: ${T.mutedSoft}">${vazio}</div>`
      : `<div style="display: flex; flex-direction: column; gap: 10px">
          <div style="display: grid; grid-template-columns: repeat(${stats.length}, minmax(0, 1fr)); gap: 8px">
            ${stats.map((st) => `<div style="display: flex; flex-direction: column; gap: 2px; border-left: 2px solid ${T.border}; padding-left: 9px">
              <span style="font-family: ${T.mono}; font-size: 14px; font-weight: 600; color: ${st[2] ?? T.textStrong}">${st[1]}</span>
              <span style="font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: ${T.mutedSoft}">${st[0]}</span>
            </div>`).join('')}
          </div>
          ${tokensHtml || tokens ? `<div style="display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid ${T.border}; padding-top: 10px">${tokensHtml ?? tokens.map((t) => `<span class="pill" style="background: ${T.surfaceMuted}">${t}</span>`).join('')}</div>` : ''}
        </div>`}
  </div>`
}

export function importacaoDepois() {
  const totalStrip = `<div style="display: flex; align-items: center; gap: 0; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 12px 16px">
    <span style="flex: none; margin-right: 18px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">Total da viagem</span>
    ${TOTAIS.map(([label, value], i) => `<span style="display: flex; align-items: baseline; gap: 6px; padding: 0 16px${i > 0 ? `; border-left: 1px solid ${T.border}` : ''}">
      <span style="font-family: ${T.mono}; font-size: 15px; font-weight: 600; color: ${T.textStrong}">${value}</span>
      <span style="font-size: 11px; color: ${T.mutedSoft}">${label}</span>
    </span>`).join('')}
  </div>`

  /** Token com contagem: o dado já vem contado por summarizeContainerTypes. */
  const contagem = (pares) => pares.map(([label, n]) => `<span class="pill" style="background: ${T.surfaceMuted}; gap: 5px; padding: 3px 9px">
    <span style="color: ${T.text}; font-weight: 700">${label}</span>
    <span style="font-family: ${T.mono}; color: ${T.mutedSoft}">${n}</span>
  </span>`).join('')

  const secao = (nome, nota = '') => `<div style="display: flex; align-items: center; gap: 12px">
    <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">${nome}</span>
    <span style="flex: 1; height: 1px; background: ${T.border}"></span>
    ${nota ? `<span style="font-size: 11px; color: ${T.mutedSoft}">${nota}</span>` : ''}
  </div>`

  const faixa = (titulo, icone, lead, leadUnit, blocos) => `<div style="display: flex; align-items: center; gap: 20px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; padding: 14px 16px">
    <span style="display: inline-flex; align-items: center; gap: 8px; flex: none; font-size: 13px; font-weight: 700; color: ${T.textStrong}">${icon(icone, 15, T.muted)} ${titulo}</span>
    <span style="display: flex; align-items: baseline; gap: 6px; flex: none">
      <span style="font-family: ${T.display}; font-size: 22px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: ${T.textStrong}">${lead}</span>
      <span style="font-size: 11px; font-weight: 600; color: ${T.mutedSoft}">${leadUnit}</span>
    </span>
    ${blocos.map((b) => `<span style="display: flex; flex-direction: column; gap: 3px; ${b.grow ? 'min-width: 0' : 'flex: none'}; border-left: 2px solid ${T.border}; padding-left: 12px">
      <span style="${b.mono ? `font-family: ${T.mono}; font-size: 14px; font-weight: 600; color: ${T.textStrong}` : 'display: flex; flex-wrap: wrap; gap: 6px'}">${b.value}</span>
      <span style="font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: ${T.mutedSoft}">${b.label}</span>
    </span>`).join('')}
  </div>`

  /** Estado vazio da faixa: mantém a altura do bloco comparável entre escalas. */
  const faixaVazia = (titulo, icone, texto) => `<div style="display: flex; align-items: center; gap: 12px; border: 1px dashed ${T.border}; border-radius: 8px; background: ${T.surface}; padding: 13px 16px">
    <span style="display: inline-flex; align-items: center; gap: 8px; flex: none; font-size: 13px; font-weight: 700; color: ${T.mutedSoft}">${icon(icone, 15, T.mutedSoft)} ${titulo}</span>
    <span style="font-size: 12px; color: ${T.mutedSoft}">${texto}</span>
  </div>`

  const podBlocks = PODS.map((p) => `<div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">
    <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px">
      <span style="display: inline-flex; align-items: baseline; gap: 10px">
        <span style="font-size: 15px; font-weight: 700; color: ${T.textStrong}">${p.pod}</span>
        <span style="font-size: 12px; color: ${T.mutedSoft}">${p.nome}</span>
      </span>
      <span style="font-size: 12px; color: ${T.muted}">${p.resumo}</span>
    </div>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: stretch">
      ${painel({
        title: 'Containers', icone: 'box', lead: String(p.containers.distinct), leadUnit: 'distintos',
        stats: [
          ['Carga geral', String(p.containers.geral)],
          ['C/ ve&iacute;culos', String(p.containers.comVeiculos)],
          ['IMO', String(p.containers.imo)],
          ['OOG', String(p.containers.oog), p.containers.oog ? T.gold : T.textStrong],
        ],
        tokensHtml: contagem(p.containers.types),
      })}
      ${p.cargaSolta
        ? painel({ title: 'Carga solta', icone: 'file', lead: p.cargaSolta.ton, leadUnit: 'ton', stats: [['B/Ls', String(p.cargaSolta.bls)], ['M&aacute;quinas', String(p.cargaSolta.maquinas)], ['Packages', String(p.cargaSolta.packages)], ['CBM', p.cargaSolta.cbm]] })
        : painel({ title: 'Carga solta', icone: 'file', vazio: 'Sem carga solta nesta escala' })}
    </div>
    ${p.veiculos
      ? faixa('Ve&iacute;culos', 'car', String(p.veiculos.unidades), 'unidades', [
          { label: 'CNTRs', value: String(p.veiculos.containers), mono: true },
          { label: 'Marcas', value: contagem(p.veiculos.marcas) },
          { label: 'Tipo de container', value: contagem(p.veiculos.tipos), grow: true },
        ])
      : faixaVazia('Ve&iacute;culos', 'car', 'Sem ve&iacute;culos descarregados nesta escala')}
    ${p.vaziosImp
      ? faixa('Vazios IMP', 'boxOpen', String(p.vaziosImp.containers), 'containers', [
          { label: 'Manifestos', value: String(p.vaziosImp.manifestos), mono: true },
          { label: 'Tipos', value: contagem(p.vaziosImp.tipos), grow: true },
        ])
      : faixaVazia('Vazios IMP', 'boxOpen', 'Sem vazios de importa&ccedil;&atilde;o nesta escala')}
  </div>`).join('')

  const botao = (label, ic, { destaque = false } = {}) =>
    `<span class="btn btn--secondary btn--sm" style="min-height: 40px${destaque ? `; border-color: ${T.blueBtn}; color: ${T.blueBtn}` : ''}">${icon(ic, 15)} ${label}</span>`

  return `<div style="display: flex; flex-direction: column; gap: 16px">
    ${totalStrip}
    ${secao('Carga por escala')}
    <div style="display: grid; gap: 12px">${podBlocks}</div>

    <section style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px; margin-top: 4px">
      <div>
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">Importa&ccedil;&atilde;o r&aacute;pida</div>
        <div style="margin-top: 4px; font-size: 13px; color: ${T.muted}">Importe arquivos diretamente nesta viagem sem sair da tela.</div>
      </div>
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">
        ${botao('Baplie EDI', 'package')}
        <span style="width: 1px; height: 24px; background: ${T.border}; margin: 0 4px"></span>
        ${botao('B/L container', 'box', { destaque: true })}
        ${botao('B/L carga solta', 'file', { destaque: true })}
        ${botao('CE Mercante', 'shield')}
        <span style="width: 1px; height: 24px; background: ${T.border}; margin: 0 4px"></span>
        ${botao('Ve&iacute;culos', 'car')}
        ${botao('Vazios IMP', 'boxOpen')}
      </div>
      <div style="display: flex; align-items: flex-start; gap: 7px; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">
        ${icon('shield', 13, T.mutedSoft)}
        <span><b style="color: ${T.muted}">CE Mercante serve os dois modos.</b> O import casa por n&uacute;mero de B/L contra a tabela <code>bls</code>, que guarda container e carga solta no mesmo lugar (<code>cargo_mode</code>) &mdash; um bot&atilde;o s&oacute;. Granito &eacute; o &uacute;nico alvo separado, e vive na aba Exporta&ccedil;&atilde;o.</span>
      </div>
    </section>
  </div>`
}

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
    containers: { distinct: 11, imo: 0, oog: 1, types: ['20GP', '40HC', '40OT'] },
    veiculos: null,
    cargaSolta: { bls: 2, maquinas: 4, packages: 61, ton: '213', cbm: '388,4' },
  },
  {
    pod: 'BRVIX', nome: 'Vitória',
    resumo: '2 CNTRs · 1 CNTR c/ veículos',
    containers: { distinct: 2, imo: 0, oog: 0, types: ['40HC'] },
    veiculos: { containers: 1, cargaGeral: 1, unidades: 4 },
    cargaSolta: null,
  },
]

const VAZIOS_IMP = { manifestos: 1, containers: 6, tipos: ['20GP', '40HC'], destinos: 'Santos, Vitória' }

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
        infoAntes('Tipos de container', '', { tokens: p.containers.types }),
      ].join('')),
      p.veiculos ? metricPanelAntes('Ve&iacute;culos', [
        infoAntes('Containers com veiculos', String(p.veiculos.containers)),
        infoAntes('Carga geral (CNTRs)', String(p.veiculos.cargaGeral)),
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
      infoAntes('Manifestos', String(VAZIOS_IMP.manifestos)),
      infoAntes('Containers distintos', String(VAZIOS_IMP.containers)),
      infoAntes('Tipos', VAZIOS_IMP.tipos.join(', ')),
      infoAntes('Destinos', VAZIOS_IMP.destinos),
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
function painel({ title, icone, lead, leadUnit, stats = [], tokens = null, vazio = null }) {
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
          ${tokens ? `<div style="display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid ${T.border}; padding-top: 10px">${tokens.map((t) => `<span class="pill" style="background: ${T.surfaceMuted}">${t}</span>`).join('')}</div>` : ''}
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

  const podBlocks = PODS.map((p) => `<div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">
    <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px">
      <span style="display: inline-flex; align-items: baseline; gap: 10px">
        <span style="font-size: 15px; font-weight: 700; color: ${T.textStrong}">${p.pod}</span>
        <span style="font-size: 12px; color: ${T.mutedSoft}">${p.nome}</span>
      </span>
      <span style="font-size: 12px; color: ${T.muted}">${p.resumo}</span>
    </div>
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: stretch">
      ${painel({
        title: 'Containers', icone: 'box', lead: String(p.containers.distinct), leadUnit: 'distintos',
        stats: [['IMO', String(p.containers.imo)], ['OOG', String(p.containers.oog), p.containers.oog ? T.gold : T.textStrong]],
        tokens: p.containers.types,
      })}
      ${p.veiculos
        ? painel({ title: 'Ve&iacute;culos', icone: 'car', lead: String(p.veiculos.unidades), leadUnit: 'unidades', stats: [['CNTRs c/ ve&iacute;culos', String(p.veiculos.containers)], ['Carga geral', String(p.veiculos.cargaGeral)]] })
        : painel({ title: 'Ve&iacute;culos', icone: 'car', vazio: 'Sem ve&iacute;culos nesta escala' })}
      ${p.cargaSolta
        ? painel({ title: 'Carga solta', icone: 'file', lead: p.cargaSolta.ton, leadUnit: 'ton', stats: [['B/Ls', String(p.cargaSolta.bls)], ['M&aacute;quinas', String(p.cargaSolta.maquinas)], ['Packages', String(p.cargaSolta.packages)], ['CBM', p.cargaSolta.cbm]] })
        : painel({ title: 'Carga solta', icone: 'file', vazio: 'Sem carga solta nesta escala' })}
    </div>
  </div>`).join('')

  const grupo = (nome, itens) => `<div style="display: flex; flex-direction: column; gap: 8px">
    <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.mutedSoft}">${nome}</span>
    <div style="display: flex; flex-wrap: wrap; gap: 8px">
      ${itens.map(([label, ic]) => `<span class="btn btn--secondary btn--sm" style="min-height: 38px">${icon(ic, 15)} ${label}</span>`).join('')}
    </div>
  </div>`

  return `<div style="display: flex; flex-direction: column; gap: 16px">
    ${totalStrip}
    <div style="display: flex; align-items: center; gap: 12px">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">Carga por escala</span>
      <span style="flex: 1; height: 1px; background: ${T.border}"></span>
    </div>
    <div style="display: grid; gap: 12px">${podBlocks}</div>

    <div style="display: flex; align-items: center; gap: 12px; margin-top: 4px">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">Vazios de importa&ccedil;&atilde;o</span>
      <span style="flex: 1; height: 1px; background: ${T.border}"></span>
      <span style="font-size: 11px; color: ${T.mutedSoft}">agregado da viagem &mdash; a origem n&atilde;o traz o POD</span>
    </div>
    <div style="display: flex; align-items: center; gap: 20px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; padding: 14px 16px">
      <span style="display: inline-flex; align-items: center; gap: 8px; flex: none; font-size: 13px; font-weight: 700; color: ${T.textStrong}">${icon('boxOpen', 15, T.muted)} Vazios IMP</span>
      <span style="display: flex; align-items: baseline; gap: 6px; flex: none">
        <span style="font-family: ${T.display}; font-size: 22px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: ${T.textStrong}">${VAZIOS_IMP.containers}</span>
        <span style="font-size: 11px; font-weight: 600; color: ${T.mutedSoft}">containers</span>
      </span>
      <span style="display: flex; flex-direction: column; gap: 2px; flex: none; border-left: 2px solid ${T.border}; padding-left: 12px">
        <span style="font-family: ${T.mono}; font-size: 14px; font-weight: 600; color: ${T.textStrong}">${VAZIOS_IMP.manifestos}</span>
        <span style="font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: ${T.mutedSoft}">Manifestos</span>
      </span>
      <span style="display: flex; flex-direction: column; gap: 3px; flex: none; border-left: 2px solid ${T.border}; padding-left: 12px">
        <span style="display: flex; gap: 6px">${VAZIOS_IMP.tipos.map((t) => `<span class="pill" style="background: ${T.surfaceMuted}">${t}</span>`).join('')}</span>
        <span style="font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: ${T.mutedSoft}">Tipos</span>
      </span>
      <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0; border-left: 2px solid ${T.border}; padding-left: 12px">
        <span style="font-size: 14px; color: ${T.text}">${VAZIOS_IMP.destinos}</span>
        <span style="font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: ${T.mutedSoft}">Destinos</span>
      </span>
    </div>

    <section style="display: grid; gap: 14px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px; margin-top: 4px">
      <div>
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">Importa&ccedil;&atilde;o r&aacute;pida</div>
        <div style="margin-top: 4px; font-size: 13px; color: ${T.muted}">Importe manifestos e planilhas diretamente nesta viagem sem sair da tela.</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px">
        ${grupo('Manifestos', [['Baplie EDI', 'package'], ['Manifesto BB', 'file']])}
        ${grupo('Complementos do B/L', [['B/L', 'file'], ['CE Mercante', 'shield']])}
        ${grupo('Unidades', [['Ve&iacute;culos', 'car'], ['Vazios IMP', 'boxOpen']])}
      </div>
    </section>
  </div>`
}

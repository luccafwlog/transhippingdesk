import { T, icon } from './kit.mjs'
import { ESTADO, PLAN_ROWS, TIMELINE } from './data.mjs'

export function pageHeader(action) {
  return `<div class="page-header">
    <div style="min-width: 0">
      <h1 class="page-header__title">Viagens</h1>
      <p class="page-header__description">Cadastro de navio/viagem com planejamento de escalas e vis&atilde;o separada entre opera&ccedil;&atilde;o de importa&ccedil;&atilde;o e exporta&ccedil;&atilde;o.</p>
      <div class="page-header__rule"></div>
    </div>
    <div style="display: flex; align-items: center; gap: 10px">${action}</div>
  </div>`
}

export const novaViagemBtn = `<span class="btn btn--primary">${icon('plus', 16)} Nova Viagem</span>`

/**
 * Barra de comando enxuta: a busca fica sempre visível e os filtros aplicados
 * viram chips removíveis. Substitui o painel de 4 selects que hoje ocupa
 * ~145px de altura antes de qualquer conteúdo de viagem.
 */
export function toolbar({ width = null, count = '9 de 12 viagens' } = {}) {
  const chip = (label, value) =>
    `<span class="pill" style="gap: 6px; padding: 5px 8px 5px 10px; background: ${T.blueSoft}; border-color: #bfdbfe; color: ${T.blueBtn}">
      <span style="opacity: 0.72">${label}</span> <b style="font-weight: 700">${value}</b>
      <span style="opacity: 0.55; margin-left: 2px">&times;</span>
    </span>`
  return `<div class="surface" style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: ${T.surfaceMuted}; margin-bottom: 20px;${width ? ` width: ${width}px` : ''}">
    <span class="input" style="flex: 1 1 auto; min-width: 0">
      ${icon('search', 16, T.mutedSoft)}
      <span class="input__placeholder">Navio, viagem, armador ou porto</span>
    </span>
    <span style="display: flex; align-items: center; gap: 8px">
      ${chip('Per&iacute;odo', 'Pr&oacute;x. 30 dias')}
      ${chip('Status', 'Ativas')}
    </span>
    <span class="btn btn--secondary btn--sm" style="min-height: 44px">${icon('sliders', 15)} Filtros <span style="display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: ${T.blueBtn}; color: #fff; font-size: 11px; font-weight: 700">2</span></span>
    <span style="width: 1px; height: 24px; background: ${T.border}"></span>
    <span style="font-size: 12px; font-weight: 600; color: ${T.muted}; white-space: nowrap">${count}</span>
  </div>`
}

export function voyageHero({ compact = false } = {}) {
  const leg = (kind, from, to, tone) => `<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
    <span class="badge badge--${tone}" style="min-width: 84px">${kind}</span>
    <span style="font-family: ${T.mono}; font-size: 12px; font-weight: 600; color: ${T.text}">${from}</span>
    ${icon('arrowRight', 14, T.mutedSoft)}
    <span style="font-family: ${T.mono}; font-size: 12px; font-weight: 600; color: ${T.text}">${to}</span>
  </div>`
  return `<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 24px">
    <div style="display: flex; flex-direction: column; gap: 14px; min-width: 0">
      <div>
        <div class="eyebrow">COSCO SHIPPING</div>
        <div style="margin-top: 4px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
          <h2 style="margin: 0; font-family: ${T.display}; font-size: ${compact ? 22 : 26}px; font-weight: 700; letter-spacing: -0.03em; color: ${T.textStrong}">COSCO SHIPPING ARIES / 088E</h2>
          <span class="badge badge--blue">ATIVA</span>
          <span class="badge badge--green">Faturamento encerrado</span>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px">
        ${leg('Importa&ccedil;&atilde;o', 'CNNGB · CNSHA', 'BRSSZ · BRVIX', 'blue')}
        ${leg('Exporta&ccedil;&atilde;o', 'BRSSZ', 'CNSHA', 'green')}
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; flex: none">
      <span class="btn btn--secondary btn--sm">${icon('pencil', 15)} Editar</span>
      <span class="btn btn--secondary btn--sm" style="color: ${T.red}; border-color: #f2b3bb">${icon('ban', 15)} Cancelar viagem</span>
      <span class="btn btn--secondary btn--sm" style="width: 40px; padding: 0; color: ${T.red}; border-color: #f2b3bb">${icon('trash', 15)}</span>
    </div>
  </div>`
}

/**
 * Faixa de KPIs redesenhada: cada bloco tem UM número dominante em Syne e
 * as demais métricas como apoio. Hoje os quatro DirectionKpiTile empilham
 * até oito pares label/valor a 12px, sem hierarquia entre eles.
 */
export function kpiBand({ columns = 4 } = {}) {
  const tile = (label, tone, value, unit, rows, valueColor) => `
    <div style="display: flex; flex-direction: column; gap: 10px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">
      <span class="badge badge--${tone}" style="align-self: flex-start">${label}</span>
      <div style="display: flex; align-items: baseline; gap: 6px">
        <span style="font-family: ${T.display}; font-size: 30px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: ${valueColor || T.textStrong}">${value}</span>
        <span style="font-size: 12px; font-weight: 600; color: ${T.mutedSoft}">${unit}</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid ${T.border}; padding-top: 9px">
        ${rows.map((r) => `<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px">
          <span style="color: ${T.mutedSoft}">${r[0]}</span>
          <span style="font-family: ${T.mono}; font-weight: 600; color: ${T.muted}">${r[1]}</span>
        </div>`).join('')}
      </div>
    </div>`
  return `<div style="display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: 12px">
    ${tile('Importa&ccedil;&atilde;o', 'blue', '10', 'B/Ls', [['CNTRs distintos', '13'], ['IMO / OOG', '0 / 0'], ['Ve&iacute;culos', '0']])}
    ${tile('Exporta&ccedil;&atilde;o', 'green', '26', 'movimentos', [['CNTRs embarcados', '13'], ['Granito', '2 B/L'], ['Granito (ton)', '213']])}
    ${tile('Pr&oacute;xima escala', 'slate', 'BRSSZ', 'ETA 28/08', [['Escalas planejadas', '2'], ['Atraca&ccedil;&atilde;o', 'TBC'], ['ETA vencido', 'n&atilde;o']])}
    ${tile('Concilia&ccedil;&atilde;o', 'green', 'Conciliado', '', [['CE Mercante', '10/10'], ['CE Master', '2/2'], ['Diverg&ecirc;ncias', '0']], T.green)}
  </div>`
}

/** Abas usando o .app-tab do design system (navy + sublinhado dourado). */
export function tabsRow(active = 'Vis&atilde;o geral') {
  const tabs = ['Vis&atilde;o geral', 'Importa&ccedil;&atilde;o', 'Exporta&ccedil;&atilde;o', 'Escalas &amp; Manifestos', 'ADR']
  return `<div style="display: flex; gap: 8px; flex-wrap: wrap">
    ${tabs.map((t) => `<span class="tab${t === active ? ' tab--active' : ''}">${t}</span>`).join('')}
  </div>`
}

export function planTable() {
  const cols = ['Escala', 'Opera', 'ETA', 'ATA', 'ATD derivado', 'BLs e CEs', 'N&ordm; Escala', 'VINCULADA', 'A&ccedil;&otilde;es']
  const cell = (v) => (v === '—' ? `<span class="dash">&mdash;</span>` : `<span class="num">${v}</span>`)
  const iconBtn = (name, color) => `<span style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid ${T.border}; border-radius: 6px; background: ${T.surface}; color: ${color}">${icon(name, 14)}</span>`
  return `<section style="display: grid; gap: 4px; border: 1px solid ${T.border}; border-radius: 12px; background: ${T.surfaceMuted}; padding: 12px">
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px">
      <span style="font-size: 14px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}">Planejamento por escala</span>
      <span class="btn btn--secondary btn--sm">${icon('plus', 15)} Adicionar escala</span>
    </div>
    <div class="surface" style="margin-top: 8px">
      <table class="table table--dense">
        <thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>
          ${PLAN_ROWS.map((r) => `<tr>
            <td style="font-weight: 700; color: ${T.textStrong}">${r.port}</td>
            <td><span style="display: inline-flex; gap: 5px">${r.opera.map((o) => `<span class="badge badge--${o === 'Importa&ccedil;&atilde;o' ? 'blue' : 'yellow'}" style="padding: 3px 8px; font-size: 10px">${o}</span>`).join('')}</span></td>
            <td>${cell(r.eta)}</td>
            <td>${cell(r.ata)}</td>
            <td>${cell(r.atdDerivado)}</td>
            <td style="font-size: 12px; color: ${T.muted}">${r.ce}</td>
            <td>${cell(r.escala)}</td>
            <td style="font-size: 12px; font-weight: 600; color: ${r.linked === 'SIM' ? T.green : T.mutedSoft}">${r.linked}</td>
            <td><span style="display: inline-flex; gap: 6px">${iconBtn('pencil', T.muted)}${iconBtn('warning', T.gold)}${iconBtn('trash', T.red)}</span></td>
          </tr>
          ${r.atracacao ? `<tr><td colspan="9" style="padding: 0 10px 12px">
            <div style="display: flex; align-items: center; gap: 14px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 9px 12px">
              <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${T.muted}">Atraca&ccedil;&otilde;es</span>
              ${r.atracacao.map((a) => `<span style="display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: ${T.muted}">
                <span class="pill">${a.terminal}</span>
                <span class="num">ETB ${a.etb}</span><span style="color: ${T.border}">|</span>
                <span class="num">ATB ${a.atb}</span><span style="color: ${T.border}">|</span>
                <span class="num">ETD ${a.etd}</span>
                ${a.rtw ? `<span class="badge badge--slate" style="padding: 2px 8px; font-size: 10px">RTW ${a.rtw}</span>` : ''}
              </span>`).join('')}
            </div>
          </td></tr>` : ''}`).join('')}
        </tbody>
      </table>
    </div>
  </section>`
}

export function timeline() {
  return `<section style="display: grid; gap: 4px; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surfaceMuted}; padding: 16px">
    <div style="display: flex; align-items: center; justify-content: space-between">
      <span style="display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}">${icon('clock', 16, T.muted)} Linha do tempo</span>
      <span style="color: ${T.muted}">${icon('chevronDown', 18)}</span>
    </div>
    <ol style="display: flex; flex-direction: column; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none">
      ${TIMELINE.map((e) => `<li style="position: relative; display: flex; align-items: baseline; gap: 12px; overflow: hidden; border: 1px solid ${T.border}; border-radius: 12px; background: ${T.surface}; padding: 12px 12px 12px 16px">
        <span style="position: absolute; left: 0; top: 0; height: 100%; width: 4px; background: ${e.color}"></span>
        <span style="flex: none; width: 144px; font-family: ${T.mono}; font-size: 12px; color: ${T.mutedSoft}">${e.at}</span>
        <span style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px">
          <span style="font-size: 14px; font-weight: 600; color: ${T.text}">${e.title}</span>
          <span style="font-size: 14px; line-height: 1.4; color: ${T.muted}">${e.note}</span>
        </span>
      </li>`).join('')}
    </ol>
    <span style="margin-top: 12px; font-size: 14px; font-weight: 500; color: ${T.blue}">Mostrar todos os 11 eventos</span>
  </section>`
}

/** Só aparece quando a viagem tem omissão de escala (TransshipmentInfoCard). */
export function transbordoCard() {
  const info = (label, value) => `<div><dt style="font-size: 12px; color: ${T.muted}; margin: 0">${label}</dt><dd style="margin: 4px 0 0; font-weight: 500; color: ${T.textStrong}">${value}</dd></div>`
  return `<section style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surfaceMuted}; padding: 16px">
    <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: ${T.textStrong}">Informa&ccedil;&otilde;es de Transbordo</h3>
    <div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 12px; background: ${T.surface}; padding: 12px">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap">
        <span style="font-size: 14px; font-weight: 600; color: ${T.textStrong}">BRVIX &middot; Porto de Transbordo &mdash; BRSSZ</span>
        <span style="display: flex; gap: 8px">
          <span class="btn btn--secondary btn--sm">Complementar</span>
          <span class="btn btn--danger btn--sm">Reverter omiss&atilde;o</span>
        </span>
      </div>
      <dl style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; font-size: 14px">
        ${info('Navio de transbordo', 'CSCL SPRING / 209W')}
        ${info('ETA no destino final', '12/09/2026')}
        ${info('B/Ls afetados', '3')}
      </dl>
    </div>
  </section>`
}

export function estadoDot(estado, size = 8) {
  return `<span class="dot" style="width: ${size}px; height: ${size}px; background: ${ESTADO[estado].color}"></span>`
}

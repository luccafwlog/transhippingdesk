import { T, icon } from './kit.mjs'
import { ESTADO, MODULES, PLAN_ROWS, TIMELINE } from './data.mjs'

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

export function planTable({ compactColumns = false } = {}) {
  const cols = ['POD/POL', 'ETA', 'ETB', 'ATA', 'ATB', 'ETD', 'ATD', 'RESTOW', 'B/LS E CE', 'N&ordm; ESCALA', 'VINC.', 'A&Ccedil;&Otilde;ES']
  const cell = (v) => (v === '—' ? `<span class="dash">&mdash;</span>` : `<span class="num">${v}</span>`)
  return `<div class="surface">
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; border-bottom: 1px solid ${T.border}; background: ${T.surfaceMuted}">
      <span class="section-label">Planejamento por POD / POL</span>
      <span style="display: flex; gap: 8px">
        <span class="btn btn--secondary btn--sm">${icon('plus', 14)} Adicionar POD</span>
        <span class="btn btn--secondary btn--sm">${icon('plus', 14)} Adicionar POL</span>
      </span>
    </div>
    <table class="table${compactColumns ? ' table--dense' : ''}">
      <thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>
        ${PLAN_ROWS.map((r) => `<tr>
          <td>
            <span style="display: inline-flex; align-items: center; gap: 7px">
              <span style="font-weight: 700; color: ${r.kind === 'pol' ? T.gold : T.textStrong}">${r.port}</span>
              ${r.kind === 'pol' ? `<span class="badge badge--yellow" style="padding: 2px 7px; font-size: 10px">EXP</span>` : ''}
            </span>
          </td>
          <td>${cell(r.eta)}</td><td>${cell(r.etb)}</td><td>${cell(r.ata)}</td><td>${cell(r.atb)}</td>
          <td>${cell(r.etd)}</td><td>${cell(r.atd)}</td><td>${cell(r.rtw)}</td>
          <td style="font-size: 12px; color: ${T.muted}">${r.ce}</td>
          <td>${cell(r.escala)}</td>
          <td style="font-size: 12px; font-weight: 600; color: ${r.linked === 'SIM' ? T.green : T.mutedSoft}">${r.linked}</td>
          <td>
            <span style="display: inline-flex; gap: 6px">
              <span style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid ${T.border}; border-radius: 6px; color: ${T.muted}">${icon('pencil', 14)}</span>
              ${r.kind === 'pod' ? `<span style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid ${T.border}; border-radius: 6px; color: ${T.gold}">${icon('warning', 14)}</span>` : ''}
              <span style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid ${T.border}; border-radius: 6px; color: ${T.red}">${icon('trash', 14)}</span>
            </span>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`
}

export function moduleCards({ columns = 4 } = {}) {
  return `<div style="display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: 12px">
    ${MODULES.map((m) => `<div class="surface" style="padding: 16px; display: flex; flex-direction: column; gap: 10px">
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px">
        <span style="display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; color: ${m.empty ? T.mutedSoft : T.blueBtn}">${icon(m.icon, 17)}</span>
        ${m.empty ? `<span class="badge badge--yellow">Sem dados</span>` : ''}
      </div>
      <div style="font-size: 14px; font-weight: 700; color: ${T.textStrong}">${m.title}</div>
      <div style="display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: ${m.empty ? T.mutedSoft : T.muted}">
        ${m.rows.map((r) => `<span>${r}</span>`).join('')}
      </div>
      <span style="display: inline-flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 12px; font-weight: 600; color: ${T.blueBtn}">Ver ${icon('arrowRight', 13)}</span>
    </div>`).join('')}
  </div>`
}

export function timeline({ columns = 3 } = {}) {
  return `<div class="surface" style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
    <div style="display: flex; align-items: center; justify-content: space-between">
      <span class="section-label" style="display: inline-flex; align-items: center; gap: 8px">${icon('clock', 14, T.muted)} Linha do tempo</span>
      <span style="color: ${T.mutedSoft}">${icon('chevronDown', 16)}</span>
    </div>
    <div style="display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: 10px">
      ${TIMELINE.map((e) => `<div style="border: 1px solid ${T.border}; border-left: 3px solid ${T.gold}; border-radius: 6px; background: ${T.surfaceMuted}; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px">
        <span style="font-family: ${T.mono}; font-size: 11px; color: ${T.mutedSoft}">${e.at}</span>
        <span style="font-size: 13px; font-weight: 700; color: ${T.textStrong}">${e.title}</span>
        <span style="font-size: 12px; color: ${T.muted}">${e.note}</span>
      </div>`).join('')}
    </div>
  </div>`
}

export function estadoDot(estado, size = 8) {
  return `<span class="dot" style="width: ${size}px; height: ${size}px; background: ${ESTADO[estado].color}"></span>`
}

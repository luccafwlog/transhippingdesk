import { T, icon } from './kit.mjs'

/**
 * Antes/depois da tabela "Planejamento por escala" e do bloco de Atracações
 * da aba Visão geral. O "antes" é transcrição fiel de VoyageVisaoTab.tsx
 * (linhas 202-345) com os estilos resolvidos de src/index.css.
 */

const ESCALAS = [
  {
    port: 'BRSSZ',
    opera: ['imp', 'exp'],
    eta: '28/08/2026', ata: '28/08/2026', atd: '31/08/2026',
    ceStatus: 'Em aprovação', ceFilled: 8, ceTotal: 8, bls: 8,
    escalaNumber: '25.0143', linked: true,
    divergencia: 'Divergência CEs: POD Aprovado / EXP Lançando',
    divergenciaCampo: 'CEs',
    atracacoes: [
      { terminal: 'BTP', etb: '28/08/2026', atb: '28/08/2026', etd: '30/08/2026', atd: '30/08/2026', rtw: 26 },
      { terminal: 'DPW', etb: '30/08/2026', atb: '30/08/2026', etd: '31/08/2026', atd: '31/08/2026', rtw: null },
    ],
  },
  {
    port: 'BRVIX',
    opera: ['imp'],
    eta: '01/09/2026', ata: '-', atd: '-',
    ceStatus: 'Aguardando', ceFilled: 0, ceTotal: 2, bls: 2,
    escalaNumber: null, linked: false,
    divergencia: null, divergenciaCampo: null,
    atracacoes: [],
  },
]

const OPERA = { imp: ['blue', 'Importa&ccedil;&atilde;o'], exp: ['yellow', 'Exporta&ccedil;&atilde;o'] }

/** .app-voyage-icon-btn — 38px, raio 12, sombra do token. */
function iconBtn(name, { danger = false } = {}) {
  return `<span style="display: inline-flex; align-items: center; justify-content: center; width: 38px; min-height: 38px; border-radius: 12px; border: 1px solid ${danger ? '#f2b3bb' : T.border}; background: ${danger ? 'linear-gradient(180deg, #fff7f8, #fff0f2)' : T.surface}; color: ${danger ? T.red : T.blueBtn}; box-shadow: ${T.shadow}">${icon(name, 15)}</span>`
}

function sectionShell({ children }) {
  return `<section style="display: grid; gap: 4px; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surfaceMuted}; padding: 12px">
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px">
      <span style="font-size: 14px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}">Planejamento por escala</span>
      <span class="btn btn--secondary btn--sm">${icon('plus', 15)} Adicionar escala</span>
    </div>
    ${children}
  </section>`
}

/* ============================== ANTES ============================== */
export function planejamentoAntes() {
  const cols = ['Escala', 'Opera', 'ETA', 'ATA', 'ATD derivado', 'BLs e CEs', 'N&ordm; Escala', 'VINCULADA', 'A&ccedil;&otilde;es']
  const td = (inner, extra = '') => `<td style="padding: 10px 10px; vertical-align: middle;${extra}">${inner}</td>`
  const dash = `<span style="color: ${T.mutedSoft}">-</span>`

  const rows = ESCALAS.map((e, i) => `
    <tr style="background: ${i % 2 === 1 ? 'rgba(19, 32, 51, 0.018)' : T.surface}${i > 0 ? `; border-top: 1px solid ${T.border}` : ''}">
      ${td(`<div style="font-weight: 600; color: ${T.textStrong}">${e.port}</div>
        ${e.divergencia ? `<div style="margin-top: 4px; display: flex; align-items: flex-start; gap: 4px; font-size: 11px; font-weight: 500; color: #fbbf24">${icon('warning', 12, '#fbbf24')}<span>${e.divergencia}</span></div>` : ''}`, ' vertical-align: top')}
      ${td(`<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; max-width: 220px">${e.opera.map((o) => `<span class="badge badge--${OPERA[o][0]}">${OPERA[o][1]}</span>`).join('')}</div>`, ' vertical-align: top')}
      ${td(e.eta === '-' ? dash : e.eta)}
      ${td(e.ata === '-' ? dash : e.ata)}
      ${td(e.atd === '-' ? dash : e.atd)}
      ${td(e.ceStatus)}
      ${td(e.escalaNumber ? `<span style="font-family: ${T.mono}; font-size: 12px; color: ${T.textStrong}">${e.escalaNumber}</span>` : dash)}
      ${td(e.linked ? 'SIM' : 'N&Atilde;O')}
      ${td(`<div style="display: flex; align-items: center; gap: 8px">${iconBtn('pencil')}${iconBtn('warning')}${iconBtn('trash', { danger: true })}</div>`)}
    </tr>
    ${e.atracacoes.length ? `<tr style="background: ${i % 2 === 1 ? 'rgba(19, 32, 51, 0.018)' : T.surface}">
      <td colspan="9" style="padding: 0 10px 12px">
        <div style="margin-left: 16px; display: grid; gap: 4px; border: 1px solid ${T.border}; border-radius: 6px; background: ${T.surfaceMuted}; padding: 8px; font-size: 12px">
          <div style="font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">Atraca&ccedil;&otilde;es</div>
          ${e.atracacoes.map((a) => `<div style="display: grid; grid-template-columns: 1.2fr repeat(5, 1fr); gap: 4px">
            <span style="font-weight: 500; color: ${T.textStrong}">${a.terminal}</span>
            <span>ETB ${a.etb}</span><span>ATB ${a.atb}</span>
            <span>ETD ${a.etd}</span><span>ATD ${a.atd}</span>
            <span>Restow ${a.rtw ?? '—'}</span>
          </div>`).join('')}
        </div>
      </td>
    </tr>` : ''}`).join('')

  return sectionShell({
    children: `<div style="margin-top: 8px; overflow: hidden; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surface}; box-shadow: ${T.shadow}">
      <table style="width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; text-align: left">
        <thead><tr>${cols.map((c, i) => `<th style="background: ${T.navy}; color: #fff; padding: 10px 10px; font-weight: 700; text-align: left; white-space: nowrap${i === 0 ? '; border-top-left-radius: 16px' : ''}${i === cols.length - 1 ? '; border-top-right-radius: 16px' : ''}">${c}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`,
  })
}

/* ---- peças comuns às duas opções (as 5 mudanças que ficaram de pé) ---- */
const dash = `<span style="color: ${T.mutedSoft}">&mdash;</span>`

const th = (label, { span = 1, rows = 1, sub = false, first = false, last = false } = {}) =>
  `<th ${span > 1 ? `colspan="${span}"` : ''} ${rows > 1 ? `rowspan="${rows}"` : ''} style="background: ${T.navy}; color: ${sub ? 'rgba(255,255,255,0.66)' : '#fff'}; padding: ${sub ? '5px 10px 9px' : '10px 10px'}; font-size: ${sub ? '10px' : '13px'}; font-weight: ${sub ? 600 : 700}; letter-spacing: ${sub ? '0.08em' : '0'}; text-transform: ${sub ? 'uppercase' : 'none'}; text-align: center; white-space: nowrap${span > 1 ? '; border-bottom: 1px solid rgba(255,255,255,0.14)' : ''}${first ? '; border-top-left-radius: 16px' : ''}${last ? '; border-top-right-radius: 16px' : ''}">${label}</th>`

const date = (value, { real = false, suffix = '' } = {}) => value === '-' || !value
  ? dash
  : `<span style="display: inline-flex; align-items: baseline; gap: 6px"><span style="font-family: ${T.mono}; font-size: 12px; font-variant-numeric: tabular-nums; font-weight: ${real ? 600 : 400}; color: ${real ? T.textStrong : T.muted}">${value}</span>${suffix}</span>`

const divergChip = (campo, full) => `<span title="${full}" style="margin-top: 6px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid #fde68a; border-radius: 999px; background: ${T.goldSoft}; padding: 3px 9px 3px 7px; font-size: 11px; font-weight: 600; color: ${T.goldStrong}">${icon('warning', 12, T.goldStrong)} ${campo} divergente</span>`

/** Campo manual do usuário: mantém os mesmos rótulos de status de hoje. */
const blsCell = (e) => e.ceStatus

const acoes = `<div style="display: flex; align-items: center; justify-content: center; gap: 8px">${iconBtn('pencil')}${iconBtn('warning')}${iconBtn('trash', { danger: true })}</div>`

const legenda = (extra) => `<div style="margin-top: 10px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-inline: 2px; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">
  <span>Data em cinza &eacute; previsto; em escuro, realizado.</span>
  ${extra ? `<span style="width: 1px; height: 12px; background: ${T.border}"></span><span>${extra}</span>` : ''}
</div>`

const frame = (inner) => `<div style="margin-top: 8px; overflow: hidden; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surface}; box-shadow: ${T.shadow}">${inner}</div>`

/* ===== Planejamento por escala: atracações num painel próprio ===== */
export function planejamentoEscala() {
  const rows = ESCALAS.map((e, i) => {
    const zebra = i % 2 === 1 ? 'rgba(19, 32, 51, 0.018)' : T.surface
    const chevron = e.atracacoes.length
      ? `<span style="display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 4px; color: ${T.muted}">${icon('chevronDown', 15)}</span>`
      : `<span style="display: inline-block; width: 20px"></span>`
    return `
    <tr style="background: ${zebra}${i > 0 ? `; border-top: 1px solid ${T.border}` : ''}">
      <td style="padding: 10px 10px; vertical-align: top; text-align: center">
        <div style="display: flex; align-items: center; justify-content: center; gap: 6px">
          ${chevron}
          <span style="font-weight: 700; color: ${T.textStrong}">${e.port}</span>
          ${e.atracacoes.length ? `<span class="badge badge--slate" style="padding: 2px 8px; font-size: 10px">${e.atracacoes.length} atraca&ccedil;&otilde;es</span>` : ''}
        </div>
        ${e.divergencia ? divergChip(e.divergenciaCampo, e.divergencia) : ''}
      </td>
      <td style="padding: 10px 10px; vertical-align: top; text-align: center"><div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 6px">${e.opera.map((o) => `<span class="badge badge--${OPERA[o][0]}">${OPERA[o][1]}</span>`).join('')}</div></td>
      <td style="padding: 10px 10px; text-align: center">${date(e.eta)}</td>
      <td style="padding: 10px 10px; text-align: center">${date(e.ata, { real: true })}</td>
      <td style="padding: 10px 10px; text-align: center">${date(e.atd, { real: true })}</td>
      <td style="padding: 10px 10px; text-align: center">${blsCell(e)}</td>
      <td style="padding: 10px 10px; text-align: center">${e.escalaNumber ? `<span style="font-family: ${T.mono}; font-size: 12px; color: ${T.textStrong}">${e.escalaNumber}</span>` : dash}</td>
      <td style="padding: 10px 10px; text-align: center"><span class="badge badge--${e.linked ? 'green' : 'slate'}">${e.linked ? 'Sim' : 'N&atilde;o'}</span></td>
      <td style="padding: 10px 10px; text-align: center">${acoes}</td>
    </tr>
    ${e.atracacoes.length ? `<tr style="background: ${T.panel}"><td colspan="9" style="padding: 0 14px 14px 46px">
      <div style="overflow: hidden; border: 1px solid ${T.borderStrong}; border-radius: 10px; background: ${T.surface}">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid ${T.border}; background: ${T.surfaceMuted}">
          <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">Atraca&ccedil;&otilde;es de ${e.port}</span>
          <span class="btn btn--secondary btn--sm" style="min-height: 30px; font-size: 11px">${icon('plus', 13)} Adicionar atraca&ccedil;&atilde;o</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left">
          <thead><tr>${['Terminal', 'ETB', 'ATB', 'ETD', 'ATD', 'Restow', ''].map((c) => `<th style="background: ${T.panelStrong}; color: ${T.muted}; padding: 6px 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; text-align: center">${c}</th>`).join('')}</tr></thead>
          <tbody>
            ${e.atracacoes.map((a, j) => `<tr${j > 0 ? ` style="border-top: 1px solid ${T.border}"` : ''}>
              <td style="padding: 8px 10px; text-align: center"><span class="pill" style="background: ${T.surfaceMuted}">${a.terminal}</span></td>
              <td style="padding: 8px 10px; text-align: center">${date(a.etb)}</td>
              <td style="padding: 8px 10px; text-align: center">${date(a.atb, { real: true })}</td>
              <td style="padding: 8px 10px; text-align: center">${date(a.etd)}</td>
              <td style="padding: 8px 10px; text-align: center">${date(a.atd, { real: true })}</td>
              <td style="padding: 8px 10px; text-align: center">${a.rtw ? `<span style="font-family: ${T.mono}; font-size: 12px; color: ${T.text}">${a.rtw}</span>` : dash}</td>
              <td style="padding: 8px 10px; text-align: center"><span style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid ${T.border}; border-radius: 6px; color: ${T.muted}">${icon('pencil', 13)}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </td></tr>` : ''}`
  }).join('')

  return sectionShell({
    children: frame(`<table style="width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; text-align: left">
      <thead><tr>
        ${th('Escala', { rows: 2, first: true })}${th('Opera', { rows: 2 })}
        ${th('Chegada', { span: 2 })}${th('ATD', { rows: 2 })}
        ${th('BLs e CEs', { rows: 2 })}${th('N&ordm; Escala', { rows: 2 })}
        ${th('Vinculada', { rows: 2 })}${th('A&ccedil;&otilde;es', { rows: 2, last: true })}
      </tr>
      <tr>${th('ETA &middot; previsto', { sub: true })}${th('ATA &middot; real', { sub: true })}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`) + legenda('A escala tem 3 colunas de data; a atraca&ccedil;&atilde;o tem as suas, num painel recolh&iacute;vel com cabe&ccedil;alho pr&oacute;prio.'),
  })
}

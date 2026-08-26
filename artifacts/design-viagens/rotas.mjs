import { T, icon } from './kit.mjs'
import { secao, totalStrip } from './abakit.mjs'

/**
 * Aba "Escalas & Manifestos" → "Rotas e Manifestos".
 * O "hoje" transcreve VoyageManifestosTab.tsx; a proposta renomeia a aba e
 * arruma o que a leitura do código expôs.
 */

const ROTAS = [
  { modo: 'CNTR', pol: 'CNSHA', pod: 'BRSSZ', atd: '18/07/2026', real: true, bls: 6, ce: [6, 6], master: '250712345678901' },
  { modo: 'CNTR', pol: 'CNNGB', pod: 'BRSSZ', atd: '16/07/2026', real: true, bls: 2, ce: [2, 2], master: '250712345678902' },
  { modo: 'BB', pol: 'CNSHA', pod: 'BRSSZ', atd: '18/07/2026', real: true, bls: 1, ce: [1, 1], master: null },
  { modo: 'CNTR', pol: 'CNSHA', pod: 'BRSSZ', omitido: 'BRVIX', atd: '18/07/2026', real: true, bls: 1, ce: [1, 1], master: '250712345678903' },
]

const MODO_TOM = { CNTR: 'blue', BB: 'yellow', 'CNTR/BB': 'slate' }

/* ================================ HOJE ================================= */
export function rotasAntes() {
  const th = (label, w) => `<th style="width: ${w}; background: ${T.navy}; color: #fff; padding: 8px 12px; font-weight: 700; text-align: left; white-space: nowrap">${label}</th>`
  const ceCoverage = ([f, t]) => {
    const cor = f >= t ? '#1f7a4d' : f > 0 ? '#b8860b' : '#cf4b3f'
    return `<span style="font-weight: 600; color: ${cor}">${f}/${t}</span>`
  }
  const rota = (r) => r.omitido
    ? `<span style="font-weight: 600; color: ${T.blue}">CNSHA &rarr; <span style="text-decoration: line-through">${r.omitido}</span> &rarr; ${r.pod}</span>
       <span style="margin-left: 8px; border: 1px solid #b45309; border-radius: 4px; background: #fff7ed; padding: 2px 6px; font-size: 10px; font-weight: 700; color: #b45309">OMISS&Atilde;O</span>`
    : `<span style="font-weight: 600; color: ${T.blue}">${r.pol} &rarr; ${r.pod}</span>`

  return `<div style="display: flex; flex-direction: column; gap: 16px">
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid ${T.green}; border-radius: 16px; background: ${T.greenSoft}; padding: 12px">
      <span style="display: flex; align-items: center; gap: 12px">
        <span class="dot" style="width: 10px; height: 10px; background: ${T.green}"></span>
        <span>
          <span style="display: block; font-size: 14px; font-weight: 600; color: ${T.green}">Concilia&ccedil;&atilde;o: Conciliado</span>
          <span style="display: block; font-size: 12px; color: ${T.muted}">CE Mercante 10/10</span>
        </span>
      </span>
    </div>
    <div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <div>
        <div style="font-size: 14px; font-weight: 700; line-height: 1.35; color: ${T.textStrong}">Manifestos vinculados</div>
        <div style="margin-top: 2px; font-size: 12px; line-height: 1.45; color: ${T.muted}">Uma rota por linha: B/Ls vinculados por POL/POD, ATD POL, CE Mercante e CE Master quando houver batch.</div>
      </div>
      <div style="overflow: hidden; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surface}; box-shadow: ${T.shadow}">
        <table style="width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; font-size: 13px; text-align: left">
          <thead><tr>${th('Rota / Manifesto', '40%')}${th('ATD POL', '12%')}${th('B/Ls', '8%')}${th('CE Merc.', '12%')}${th('CE Master', '16%')}${th('A&ccedil;&otilde;es', '12%')}</tr></thead>
          <tbody>
            ${ROTAS.map((r, i) => `<tr style="background: ${i % 2 === 1 ? 'rgba(19, 32, 51, 0.018)' : T.surface}${i > 0 ? `; border-top: 1px solid ${T.border}` : ''}">
              <td style="padding: 8px 12px"><span style="display: inline-flex; align-items: center; gap: 8px">
                <span style="border: 1px solid ${T.border}; border-radius: 4px; background: ${T.surfaceMuted}; padding: 2px 6px; font-size: 10px; font-weight: 700; color: ${T.muted}">${r.modo}</span>
                ${rota(r)}
              </span></td>
              <td style="padding: 8px 12px"><span style="color: ${r.real ? T.blue : T.text}; font-weight: ${r.real ? 500 : 400}">${r.atd}</span></td>
              <td style="padding: 8px 12px">${r.bls}</td>
              <td style="padding: 8px 12px">${ceCoverage(r.ce)}</td>
              <td style="padding: 8px 12px">${r.master
                ? `<span style="font-family: ${T.mono}; font-size: 12px; color: ${T.textStrong}">${r.master}</span>`
                : `<span title="Informe o CE Master pelo l&aacute;pis desta linha" style="font-size: 12px; font-weight: 600; color: #b45309">manifesto n&atilde;o informado</span>`}</td>
              <td style="padding: 8px 12px"><span style="display: inline-flex; align-items: center; justify-content: center; width: 38px; min-height: 38px; border: 1px solid ${T.border}; border-radius: 12px; background: ${T.surface}; color: ${T.blueBtn}; box-shadow: ${T.shadow}">${icon('pencil', 15)}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`
}

/* =============================== PROPOSTA ============================== */
export function rotasDepois() {
  const th = (label, { w = null, span = 1, rows = 1, sub = false, first = false, last = false } = {}) =>
    `<th ${span > 1 ? `colspan="${span}"` : ''} ${rows > 1 ? `rowspan="${rows}"` : ''} style="${w ? `width: ${w}; ` : ''}background: ${T.navy}; color: ${sub ? 'rgba(255,255,255,0.66)' : '#fff'}; padding: ${sub ? '5px 12px 9px' : '10px 12px'}; font-size: ${sub ? '10px' : '13px'}; font-weight: ${sub ? 600 : 700}; letter-spacing: ${sub ? '0.08em' : '0'}; text-transform: ${sub ? 'uppercase' : 'none'}; text-align: center; white-space: nowrap${span > 1 ? '; border-bottom: 1px solid rgba(255,255,255,0.14)' : ''}${first ? '; border-top-left-radius: 16px' : ''}${last ? '; border-top-right-radius: 16px' : ''}">${label}</th>`

  const medidor = ([f, t]) => {
    const pct = t ? Math.round((f / t) * 100) : 0
    const cor = f >= t && t > 0 ? T.green : f > 0 ? T.gold : T.red
    return `<span style="display: inline-flex; align-items: center; gap: 7px">
      <span style="width: 36px; height: 5px; border-radius: 999px; background: ${T.panelStrong}; overflow: hidden"><span style="display: block; width: ${pct}%; height: 100%; background: ${cor}"></span></span>
      <span style="font-family: ${T.mono}; font-size: 12px; font-weight: 600; color: ${cor}">${f}/${t}</span>
    </span>`
  }

  const rotaCell = (r) => `<div style="text-align: left">
    <span style="display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap">
      <span class="badge badge--${MODO_TOM[r.modo]}" style="padding: 2px 8px; font-size: 10px">${r.modo}</span>
      ${r.omitido
        ? `<span style="font-weight: 600; color: ${T.blueBtn}">${r.pol} &rarr; <span style="text-decoration: line-through; color: ${T.mutedSoft}">${r.omitido}</span> &rarr; ${r.pod}</span>
           <span class="badge badge--yellow" style="padding: 2px 8px; font-size: 10px">Omiss&atilde;o</span>`
        : `<span style="font-weight: 600; color: ${T.blueBtn}">${r.pol} &rarr; ${r.pod}</span>`}
    </span>
  </div>`

  const linhas = ROTAS.map((r, i) => `<tr style="background: ${i % 2 === 1 ? 'rgba(19, 32, 51, 0.018)' : T.surface}${i > 0 ? `; border-top: 1px solid ${T.border}` : ''}">
    <td style="padding: 10px 12px">${rotaCell(r)}</td>
    <td style="padding: 10px 12px; text-align: center"><span style="font-family: ${T.mono}; font-size: 12px; font-variant-numeric: tabular-nums; font-weight: ${r.real ? 600 : 400}; color: ${r.real ? T.textStrong : T.muted}">${r.atd}</span></td>
    <td style="padding: 10px 12px; text-align: center"><span style="font-family: ${T.mono}; font-size: 12px; font-weight: 600; color: ${T.textStrong}">${r.bls}</span></td>
    <td style="padding: 10px 12px; text-align: center">${medidor(r.ce)}</td>
    <td style="padding: 10px 12px; text-align: center">${r.master
      ? `<span style="font-family: ${T.mono}; font-size: 12px; color: ${T.textStrong}">${r.master}</span>`
      : `<span style="display: inline-flex; align-items: center; gap: 5px; border: 1px solid #fde68a; border-radius: 999px; background: ${T.goldSoft}; padding: 3px 10px 3px 8px; font-size: 11px; font-weight: 600; color: ${T.goldStrong}">${icon('pencil', 11, T.goldStrong)} Informar</span>`}</td>
    <td style="padding: 10px 12px; text-align: center"><span style="display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; color: ${T.blueBtn}">${icon('pencil', 15)}</span></td>
  </tr>`).join('')

  return `<div style="display: flex; flex-direction: column; gap: 16px">
    ${totalStrip('Total da viagem', [
      ['Rotas', '4'], ['B/Ls vinculados', '10'], ['CE Mercante', '10/10'], ['N&ordm; de manifesto a informar', '1'],
    ])}
    ${secao('Rotas da viagem', 'uma linha por par POL / POD')}
    <div style="overflow: hidden; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surface}; box-shadow: ${T.shadow}">
      <table style="width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px">
        <thead>
          <tr>
            ${th('Rota', { w: '46%', rows: 2, first: true })}
            ${th('ATD no POL', { w: '13%', rows: 2 })}
            ${th('B/Ls', { w: '8%', rows: 2 })}
            ${th('Mercante', { span: 2 })}
            ${th('', { w: '7%', rows: 2, last: true })}
          </tr>
          <tr>
            ${th('CE Mercante &middot; cobertura', { w: '13%', sub: true })}
            ${th('N&ordm; de manifesto Mercante', { w: '13%', sub: true })}
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-inline: 2px; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">
      <span><b style="color: ${T.muted}">CE Mercante</b> &eacute; a cobertura por B/L; o <b style="color: ${T.muted}">N&ordm; de manifesto Mercante</b> agrupa a rota. S&atilde;o coisas diferentes.</span>
      <span style="width: 1px; height: 12px; background: ${T.border}"></span>
      <span>ATD em escuro &eacute; realizado; em cinza, o ETD previsto.</span>
    </div>
  </div>`
}

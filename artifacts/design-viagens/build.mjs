import { writeFileSync } from 'node:fs'
import { T, artboard, icon } from './kit.mjs'
import { ESTADO, VOYAGES } from './data.mjs'
import {
  estadoDot, kpiBand, moduleCards, novaViagemBtn, pageHeader, planTable,
  tabsRow, timeline, toolbar, voyageHero,
} from './blocks.mjs'

const out = (name, html) => {
  writeFileSync(new URL(`./${name}`, import.meta.url), html)
  console.log(`${name}  ${(html.length / 1024).toFixed(1)} KB`)
}

const modIcons = (mods) => mods.length
  ? `<span style="display: inline-flex; align-items: center; gap: 5px; color: ${T.mutedSoft}">${mods.map((m) => icon(m, 13)).join('')}</span>`
  : ''

/* ------------------------------------------------------------------ *
 * Direção A — Rail refinado                                           *
 * ------------------------------------------------------------------ */
function railCard(v, selected) {
  const e = ESTADO[v.estado]
  return `<div style="position: relative; display: flex; flex-direction: column; gap: 9px; flex: none; width: 268px; padding: 12px 14px; border: 1px solid ${selected ? T.blueBtn : T.border}; border-radius: 12px; background: ${selected ? T.bgElevated : T.surface}${selected ? `; box-shadow: inset 0 -3px 0 ${T.blueBtn}` : ''}">
    <div style="display: flex; align-items: center; gap: 7px; min-width: 0">
      ${estadoDot(v.estado)}
      <span class="eyebrow" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${v.carrier}</span>
      <span style="margin-left: auto; font-size: 10px; font-weight: 700; color: ${e.color}">${e.label}</span>
    </div>
    <div style="font-size: 13px; font-weight: 700; line-height: 1.25; color: ${T.textStrong}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${v.vessel} / ${v.voy}</div>
    <div style="display: flex; align-items: center; gap: 7px; flex-wrap: wrap">
      ${v.escalas.length
        ? v.escalas.slice(0, 2).map((s) => `<span class="pill">${s.port} · ${s.eta}</span>`).join('')
        : `<span style="font-size: 11px; color: ${T.mutedSoft}">Sem escala brasileira prevista</span>`}
      ${modIcons(v.mods)}
    </div>
    <div style="display: flex; align-items: center; gap: 10px; margin-top: auto; padding-top: 8px; border-top: 1px solid ${T.border}; font-family: ${T.mono}; font-size: 11px; color: ${T.muted}">
      <span><b style="color: ${T.textStrong}">${v.bls}</b> B/L</span>
      <span style="color: ${T.border}">|</span>
      <span><b style="color: ${T.textStrong}">${v.cntr}</b> CNTR</span>
      <span style="color: ${T.border}">|</span>
      <span>CE ${v.ce}</span>
    </div>
  </div>`
}

const direcaoA = artboard({
  height: 1360,
  body: `<div class="main">
    ${pageHeader(novaViagemBtn)}
    ${toolbar()}

    <div style="display: flex; flex-direction: column; gap: 7px; margin-bottom: 18px">
      <div style="display: flex; align-items: center; justify-content: space-between; padding-inline: 2px">
        <span style="font-size: 11px; color: ${T.mutedSoft}">Ordenado por pr&oacute;xima escala</span>
        <span style="display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: ${T.mutedSoft}">
          12 viagens
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid ${T.border}; border-radius: 999px; background: ${T.surface}; color: ${T.muted}">${icon('chevronLeft', 14)}</span>
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid ${T.border}; border-radius: 999px; background: ${T.surface}; color: ${T.muted}">${icon('chevronRight', 14)}</span>
        </span>
      </div>
      <div style="display: flex; gap: 12px; overflow: hidden">
        ${VOYAGES.slice(0, 5).map((v, i) => railCard(v, i === 0)).join('')}
      </div>
    </div>

    <div class="surface surface--padded" style="display: flex; flex-direction: column; gap: 18px">
      ${voyageHero()}
      ${kpiBand()}
      ${tabsRow()}
      ${planTable()}
    </div>
  </div>`,
})

/* ------------------------------------------------------------------ *
 * Direção B — Mestre + detalhe  (Main.dc.html, candidata líder)        *
 * ------------------------------------------------------------------ */
function listRow(v, selected) {
  const e = ESTADO[v.estado]
  return `<div style="display: flex; flex-direction: column; gap: 6px; padding: 11px 14px 11px 12px; border-left: 3px solid ${selected ? T.blueBtn : 'transparent'}; background: ${selected ? T.bgElevated : 'transparent'}; border-bottom: 1px solid ${T.border}">
    <div style="display: flex; align-items: center; gap: 7px; min-width: 0">
      ${estadoDot(v.estado, 7)}
      <span class="eyebrow" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${v.carrier}</span>
      <span style="margin-left: auto; font-family: ${T.mono}; font-size: 10px; font-weight: 600; color: ${e.color}">CE ${v.ce}</span>
    </div>
    <div style="font-size: 13px; font-weight: 700; line-height: 1.25; color: ${T.textStrong}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${v.vessel} / ${v.voy}</div>
    <div style="display: flex; align-items: center; gap: 7px; min-width: 0">
      ${v.escalas.length
        ? `<span class="pill">${v.escalas[0].port} · ${v.escalas[0].eta}</span>${v.escalas.length > 1 ? `<span style="font-size: 11px; color: ${T.mutedSoft}">+${v.escalas.length - 1}</span>` : ''}`
        : `<span style="font-size: 11px; color: ${T.mutedSoft}">Sem escala prevista</span>`}
      ${modIcons(v.mods)}
      <span style="margin-left: auto; font-family: ${T.mono}; font-size: 11px; color: ${T.muted}">${v.bls} B/L</span>
    </div>
  </div>`
}

const main = artboard({
  height: 1480,
  body: `<div class="main">
    ${pageHeader(novaViagemBtn)}
    <div style="display: flex; align-items: flex-start; gap: 20px">

      <div style="flex: none; width: 316px; display: flex; flex-direction: column; gap: 12px">
        <div style="display: flex; gap: 8px">
          <span class="input" style="flex: 1 1 auto; min-width: 0">${icon('search', 16, T.mutedSoft)}<span class="input__placeholder">Buscar viagem</span></span>
          <span class="btn btn--secondary btn--icon" style="position: relative">${icon('sliders', 16)}<span style="position: absolute; top: 5px; right: 5px; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 999px; background: ${T.blueBtn}; color: #fff; font-size: 10px; font-weight: 700">2</span></span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-inline: 2px">
          <span style="font-size: 11px; color: ${T.mutedSoft}">9 de 12 &middot; por pr&oacute;xima escala</span>
          <span style="font-size: 11px; font-weight: 600; color: ${T.blueBtn}">Limpar</span>
        </div>
        <div class="surface" style="display: flex; flex-direction: column; overflow: hidden">
          ${VOYAGES.map((v, i) => listRow(v, i === 0)).join('')}
          <div style="padding: 10px 14px; background: ${T.surfaceMuted}; font-size: 11px; color: ${T.mutedSoft}; text-align: center">3 viagens abaixo &middot; role a lista</div>
        </div>
      </div>

      <div style="flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 18px">
        <div class="surface surface--padded" style="display: flex; flex-direction: column; gap: 18px">
          ${voyageHero()}
          ${kpiBand()}
        </div>
        ${tabsRow()}
        ${planTable()}
        ${moduleCards({ columns: 4 })}
        ${timeline({ columns: 4 })}
      </div>
    </div>
  </div>`,
})

/* ------------------------------------------------------------------ *
 * Direção C — Programação em tabela                                   *
 * ------------------------------------------------------------------ */
const PORT_COLS = ['BRSSZ', 'BRVIX', 'BRPNG', 'BRRIG']

function portCell(value) {
  if (value === 'OMIT') return `<span class="badge badge--red" style="padding: 2px 8px; font-size: 10px; font-weight: 700">OMIT</span>`
  if (value === 'X') return `<span class="dash num">X</span>`
  return `<span class="num" style="font-weight: 600; color: ${T.textStrong}">${value}</span>`
}

const direcaoC = artboard({
  height: 960,
  body: `<div class="main">
    ${pageHeader(novaViagemBtn)}
    ${toolbar()}

    <div class="surface" style="overflow: hidden">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-bottom: 1px solid ${T.border}; background: ${T.surfaceMuted}">
        <span class="section-label">Programa&ccedil;&atilde;o &middot; pr&oacute;ximos 30 dias</span>
        <span style="display: flex; align-items: center; gap: 14px; font-size: 11px; color: ${T.mutedSoft}">
          <span style="display: inline-flex; align-items: center; gap: 5px">${estadoDot('conciliado', 7)} Conciliada</span>
          <span style="display: inline-flex; align-items: center; gap: 5px">${estadoDot('incompleto', 7)} Pendente</span>
          <span style="display: inline-flex; align-items: center; gap: 5px">${estadoDot('divergente', 7)} Divergente</span>
          <span style="width: 1px; height: 14px; background: ${T.border}"></span>
          <span><b style="color: ${T.red}">OMIT</b> escala omitida</span>
          <span><b style="color: ${T.muted}">X</b> data n&atilde;o informada</span>
        </span>
      </div>
      <table class="table table--dense">
        <thead>
          <tr>
            <th style="width: 26px"></th>
            <th>Navio / Viagem</th>
            <th>Armador</th>
            <th>Rota</th>
            ${PORT_COLS.map((p) => `<th style="text-align: center">${p}</th>`).join('')}
            <th style="text-align: center">+</th>
            <th style="text-align: right">B/L</th>
            <th style="text-align: right">CNTR</th>
            <th style="text-align: center">CE</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${VOYAGES.map((v, i) => `<tr${i === 0 ? ` style="background: ${T.blueSoft}"` : ''}>
            <td>${estadoDot(v.estado, 8)}</td>
            <td style="font-weight: 700; color: ${T.textStrong}">${v.vessel} <span style="color: ${T.muted}">/ ${v.voy}</span></td>
            <td style="font-size: 12px; color: ${T.muted}">${v.carrier}</td>
            <td>
              <span style="display: inline-flex; align-items: center; gap: 6px; font-family: ${T.mono}; font-size: 11px; color: ${T.muted}">
                ${v.pol} ${icon('arrowRight', 12, T.mutedSoft)} <b style="color: ${T.text}">${v.pod}</b>
              </span>
            </td>
            ${PORT_COLS.map((p) => `<td style="text-align: center">${portCell(v.ports[p])}</td>`).join('')}
            <td style="text-align: center; font-size: 11px; color: ${T.mutedSoft}">${v.pod.includes('BRITJ') ? '+1' : '—'}</td>
            <td style="text-align: right" class="num">${v.bls}</td>
            <td style="text-align: right" class="num">${v.cntr}</td>
            <td style="text-align: center"><span class="num" style="color: ${v.ce.split('/')[0] === v.ce.split('/')[1] && v.bls > 0 ? T.green : T.gold}">${v.ce}</span></td>
            <td style="text-align: right; color: ${T.mutedSoft}">${icon('chevronRight', 15)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-top: 1px solid ${T.border}; background: ${T.surfaceMuted}; font-size: 12px; color: ${T.muted}">
        <span>Mostrando <b>9</b> de <b>12</b> viagens</span>
        <span style="display: inline-flex; align-items: center; gap: 6px">
          <span class="btn btn--secondary btn--sm">Anterior</span>
          <span class="btn btn--secondary btn--sm" style="background: ${T.navy}; border-color: ${T.navy}; color: #fff; width: 34px; padding: 0">1</span>
          <span class="btn btn--secondary btn--sm" style="width: 34px; padding: 0">2</span>
          <span class="btn btn--secondary btn--sm">Pr&oacute;xima</span>
        </span>
      </div>
    </div>
  </div>`,
})

/* ------------------------------------------------------------------ *
 * Direção C — página de detalhe (/viagens/:id)                        *
 * ------------------------------------------------------------------ */
const direcaoCDetalhe = artboard({
  height: 1400,
  body: `<div class="main">
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 12px; color: ${T.muted}">
      <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: ${T.blueBtn}">${icon('chevronLeft', 14)} Viagens</span>
      <span style="color: ${T.mutedSoft}">/</span>
      <span style="font-weight: 600; color: ${T.text}">COSCO SHIPPING ARIES &middot; 088E</span>
      <span style="margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: ${T.mutedSoft}">
        <span class="btn btn--secondary btn--sm" style="width: 34px; padding: 0">${icon('chevronLeft', 15)}</span>
        <span>2 de 12</span>
        <span class="btn btn--secondary btn--sm" style="width: 34px; padding: 0">${icon('chevronRight', 15)}</span>
      </span>
    </div>

    <div class="surface surface--padded" style="display: flex; flex-direction: column; gap: 18px; margin-bottom: 18px">
      ${voyageHero({ compact: true })}
      ${kpiBand()}
    </div>

    <div style="display: flex; flex-direction: column; gap: 18px">
      ${tabsRow()}
      ${planTable()}
      ${moduleCards({ columns: 4 })}
      ${timeline({ columns: 4 })}
    </div>
  </div>`,
})

out('DirecaoA.dc.html', direcaoA)
out('Main.dc.html', main)
out('DirecaoC.dc.html', direcaoC)
out('DirecaoCDetalhe.dc.html', direcaoCDetalhe)

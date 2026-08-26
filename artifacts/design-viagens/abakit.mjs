import { T, icon } from './kit.mjs'

/**
 * Gramática comum das abas do VoyageCard, fechada na aba Importação:
 * faixa de total no topo, blocos por escala, painéis chapados com um número
 * dominante mais mini-stats, tokens com contagem, e faixa para o que é raso.
 */

/** Token com contagem — o dado já vem contado pelos summarize* do serviço. */
export const contagem = (pares) => pares.map(([label, n]) => `<span class="pill" style="background: ${T.surfaceMuted}; gap: 5px; padding: 3px 9px">
  <span style="color: ${T.text}; font-weight: 700">${label}</span>
  ${n === '' ? '' : `<span style="font-family: ${T.mono}; color: ${T.mutedSoft}">${n}</span>`}
</span>`).join('')

export const secao = (nome, nota = '') => `<div style="display: flex; align-items: center; gap: 12px">
  <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">${nome}</span>
  <span style="flex: 1; height: 1px; background: ${T.border}"></span>
  ${nota ? `<span style="font-size: 11px; color: ${T.mutedSoft}">${nota}</span>` : ''}
</div>`

export const totalStrip = (titulo, pares) => `<div style="display: flex; align-items: center; gap: 0; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 12px 16px">
  <span style="flex: none; margin-right: 18px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">${titulo}</span>
  ${pares.map(([label, value], i) => `<span style="display: flex; align-items: baseline; gap: 6px; padding: 0 16px${i > 0 ? `; border-left: 1px solid ${T.border}` : ''}">
    <span style="font-family: ${T.mono}; font-size: 15px; font-weight: 600; color: ${T.textStrong}">${value}</span>
    <span style="font-size: 11px; color: ${T.mutedSoft}">${label}</span>
  </span>`).join('')}
</div>`

export function painel({ title, icone, lead, leadUnit, stats = [], tokensHtml = null, vazio = null }) {
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
          ${tokensHtml ? `<div style="display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid ${T.border}; padding-top: 10px">${tokensHtml}</div>` : ''}
        </div>`}
  </div>`
}

export const faixa = (titulo, icone, lead, leadUnit, blocos) => `<div style="display: flex; align-items: center; gap: 20px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; padding: 14px 16px">
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

/** Cabeçalho do bloco de uma escala: código, nome do porto e resumo à direita. */
export const escalaHeader = (codigo, nome, resumo) => `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px">
  <span style="display: inline-flex; align-items: baseline; gap: 10px">
    <span style="font-size: 15px; font-weight: 700; color: ${T.textStrong}">${codigo}</span>
    <span style="font-size: 12px; color: ${T.mutedSoft}">${nome}</span>
  </span>
  <span style="font-size: 12px; color: ${T.muted}">${resumo}</span>
</div>`

export const blocoEscala = (inner) => `<div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">${inner}</div>`

export const botao = (label, ic, { destaque = false } = {}) =>
  `<span class="btn btn--secondary btn--sm" style="min-height: 40px${destaque ? `; border-color: ${T.blueBtn}; color: ${T.blueBtn}` : ''}">${icon(ic, 15)} ${label}</span>`

export const separador = `<span style="width: 1px; height: 24px; background: ${T.border}; margin: 0 4px"></span>`

export const barraAcoes = ({ titulo, descricao, botoes, nota = '' }) => `<section style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px; margin-top: 4px">
  <div>
    <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">${titulo}</div>
    <div style="margin-top: 4px; font-size: 13px; color: ${T.muted}">${descricao}</div>
  </div>
  <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">${botoes}</div>
  ${nota ? `<div style="display: flex; align-items: flex-start; gap: 7px; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">${icon('shield', 13, T.mutedSoft)}<span>${nota}</span></div>` : ''}
</section>`

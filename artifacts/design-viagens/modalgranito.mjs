import { T, icon } from './kit.mjs'

/**
 * Modal "Importar Manifesto Granito" (FileImportModal + renderPreview de
 * VoyageImportActions.tsx:103-130). O "hoje" é transcrição fiel, inclusive a
 * barra de prévia com cores de tema escuro cravadas no código.
 */

const VIAGEM = 'COSCO SHIPPING ARIES / 088E'
const ARQUIVO = 'granito-ago-2026.xlsx'

function modalShell({ largura = 620, corpo }) {
  return `<div style="width: ${largura}px; border: 1px solid ${T.border}; border-radius: 12px; background: ${T.surface}; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.16); overflow: hidden">
    <div style="padding: 24px 24px 0">
      <h3 style="margin: 0; font-family: ${T.display}; font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: ${T.textStrong}">Importar Manifesto Granito</h3>
    </div>
    <div style="display: grid; gap: 16px; padding: 16px 24px 0">${corpo}</div>
    <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; border-top: 1px solid ${T.border}; background: ${T.surface}; padding: 16px 24px">
      <span class="btn btn--secondary">Cancelar</span>
      <span class="btn btn--primary">Importar</span>
    </div>
  </div>`
}

const campoArquivo = `<label style="display: grid; gap: 8px">
  <span class="field__label">Arquivo .xlsx,.xls</span>
  <span class="input" style="justify-content: flex-start; gap: 12px">
    <span class="btn btn--secondary btn--sm" style="min-height: 28px; font-size: 11px">Escolher arquivo</span>
    <span style="font-size: 13px; color: ${T.text}">${ARQUIVO}</span>
  </span>
</label>`

const tile = (label, value, { tone = null } = {}) => `<div style="display: grid; gap: 6px; border: 1px solid ${tone ?? T.border}; border-radius: 8px; background: ${T.surface}; padding: 14px">
  <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">${label}</div>
  <div style="font-size: 19px; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; color: ${tone ?? T.textStrong}">${value}</div>
</div>`

/* ================================ HOJE ================================= */
export function modalGranitoAntes() {
  return modalShell({
    corpo: `
      <div style="border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px; font-size: 14px; color: ${T.text}">
        Viagem: <span style="font-weight: 600; color: ${T.textStrong}">${VIAGEM}</span>
      </div>
      ${campoArquivo}
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid #30363d; border-radius: 8px; background: #0d1117; padding: 8px 12px; font-size: 14px">
        <span style="color: #cbd5e1">Pr&eacute;via 1 de 1: <span style="font-weight: 600; color: #ffffff">${ARQUIVO}</span></span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; text-align: center">
        ${tile('B/Ls', '2')}
        ${tile('Erros', '0')}
      </div>`,
  })
}

/* =============================== PROPOSTA ============================== */
export function modalGranitoDepois() {
  return modalShell({
    largura: 660,
    corpo: `
      <div style="display: grid; gap: 10px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
          <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">Viagem de destino</span>
          <span style="font-size: 14px; font-weight: 600; color: ${T.textStrong}">${VIAGEM}</span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid ${T.border}; padding-top: 10px">
          <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">Declarado na planilha</span>
          <span style="display: inline-flex; align-items: center; gap: 8px">
            <span style="font-family: ${T.mono}; font-size: 13px; color: ${T.text}">ARIES / 088E</span>
            <span class="badge badge--green">${icon('shield', 12)} confere</span>
          </span>
        </div>
      </div>
      ${campoArquivo}
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 8px 12px; font-size: 13px; color: ${T.muted}">
        <span>Pr&eacute;via 1 de 1: <span style="font-weight: 600; color: ${T.textStrong}">${ARQUIVO}</span></span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; text-align: center">
        ${tile('B/Ls', '2')}
        ${tile('Blocos', '38')}
        ${tile('Peso', '213 t')}
        ${tile('Erros', '0')}
      </div>
      <div style="display: flex; align-items: flex-start; gap: 9px; border: 1px solid #fde68a; border-radius: 8px; background: ${T.goldSoft}; padding: 12px 14px">
        ${icon('warning', 15, T.goldStrong)}
        <span style="font-size: 13px; line-height: 1.5; color: ${T.goldStrong}">
          <b>1 B/L entra pendente de reconcilia&ccedil;&atilde;o.</b>
          <span style="color: ${T.muted}">O consignat&aacute;rio n&atilde;o casou com nenhum cliente por CNPJ. <code>importGraniteManifest</code> j&aacute; devolve esse <code>pendingCount</code> &mdash; hoje ele &eacute; descartado.</span>
        </span>
      </div>`,
  })
}

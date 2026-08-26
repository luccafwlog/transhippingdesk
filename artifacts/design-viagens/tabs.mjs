import { T, icon } from './kit.mjs'

/**
 * Corpo de cada aba do VoyageCard, desenhado a partir do componente real:
 * VoyageImportacaoTab, VoyageExportacaoTab, VoyageManifestosTab e
 * VoyageAgencyReportTab. Os blocos base (MetricPanel/Info) vêm de
 * src/components/shared/VoyageSectionCards.tsx.
 */

/** MetricPanel + Info, mas com um valor dominante no topo em vez de só pares. */
export function metricPanel({ title, lead, leadUnit, rows, tone = 'blue', flat = false }) {
  const tint = { blue: T.blueBtn, green: T.green, gold: T.gold, slate: T.muted }[tone]
  return `<div style="display: flex; flex-direction: column; gap: 12px; border: 1px solid ${T.border}; border-radius: 12px; background: ${flat ? T.surface : `linear-gradient(180deg, ${T.surface} 0%, ${T.surfaceMuted} 100%)`}; padding: 16px 18px">
    <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px">
      <span style="font-size: 15px; font-weight: 700; color: ${T.text}">${title}</span>
      ${lead ? `<span style="display: flex; align-items: baseline; gap: 5px">
        <span style="font-family: ${T.display}; font-size: 24px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: ${tint}">${lead}</span>
        <span style="font-size: 11px; font-weight: 600; color: ${T.mutedSoft}">${leadUnit ?? ''}</span>
      </span>` : ''}
    </div>
    <dl style="display: flex; flex-direction: column; gap: 0; margin: 0; font-size: 14px">
      ${rows.map((r, i) => `<div style="display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 9px 0${i < rows.length - 1 ? `; border-bottom: 1px solid ${T.border}` : ''}">
        <dt style="margin: 0; color: ${T.muted}; line-height: 1.45">${r[0]}</dt>
        ${Array.isArray(r[1])
          ? `<dd style="margin: 0; display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end">${r[1].map((t) => `<span class="pill" style="background: ${T.surface}; padding: 5px 9px; font-weight: 700; color: ${T.text}">${t}</span>`).join('')}</dd>`
          : `<dd style="margin: 0; font-weight: 700; text-align: right; color: ${T.text}">${r[1]}</dd>`}
      </div>`).join('')}
    </dl>
  </div>`
}

/** MetricSection: cabeçalho em versalete + corpo, sobre superfície fosca. */
export function metricSection({ title, description, actions = '', body }) {
  return `<section style="display: grid; gap: 16px; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surfaceMuted}; padding: 16px">
    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px">
      <div>
        <div style="font-size: 14px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}">${title}</div>
        ${description ? `<div style="margin-top: 4px; font-size: 14px; color: ${T.muted}">${description}</div>` : ''}
      </div>
      ${actions ? `<div style="display: flex; flex: none; gap: 8px">${actions}</div>` : ''}
    </div>
    ${body}
  </section>`
}

const uploadBtn = (label) => `<span class="btn btn--secondary btn--sm">${icon('file', 15)} ${label}</span>`

/* ------------------------------ Importação ------------------------------ */
function podPanel({ port, portName, summary, panels }) {
  return `<div style="display: grid; gap: 16px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
    <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap">
      <span style="display: inline-flex; align-items: baseline; gap: 10px">
        <span style="font-size: 16px; font-weight: 700; line-height: 1.35; color: ${T.textStrong}">${port}</span>
        <span style="font-size: 13px; color: ${T.mutedSoft}">${portName}</span>
      </span>
      <span style="font-size: 12px; color: ${T.muted}">${summary}</span>
    </div>
    <div style="display: grid; grid-template-columns: repeat(${panels.length}, minmax(0, 1fr)); gap: 16px">
      ${panels.map((p) => metricPanel(p)).join('')}
    </div>
  </div>`
}

export function abaImportacao() {
  return `<div style="display: flex; flex-direction: column; gap: 16px">
    ${podPanel({
      port: 'BRSSZ', portName: 'Santos',
      summary: '11 CNTRs · 2 B/Ls carga solta',
      panels: [
        { title: 'Containers', lead: '11', leadUnit: 'distintos', tone: 'blue', rows: [['Containers IMO', '0'], ['Containers OOG', '1'], ['Tipos de container', ['20GP', '40HC', '40OT']]] },
        { title: 'Carga solta', lead: '213', leadUnit: 'ton', tone: 'gold', rows: [['B/Ls carga solta', '2'], ['M&aacute;quinas', '4'], ['Packages', '61'], ['CBM total', '388,4']] },
      ],
    })}
    ${podPanel({
      port: 'BRVIX', portName: 'Vit&oacute;ria',
      summary: '2 CNTRs · 1 CNTR c/ ve&iacute;culos',
      panels: [
        { title: 'Containers', lead: '2', leadUnit: 'distintos', tone: 'blue', rows: [['Containers IMO', '0'], ['Containers OOG', '0'], ['Tipos de container', ['40HC']]] },
        { title: 'Ve&iacute;culos', lead: '1', leadUnit: 'CNTR', tone: 'slate', rows: [['Carga geral (CNTRs)', '1'], ['Ve&iacute;culos', '4']] },
      ],
    })}
    ${metricSection({
      title: 'Importa&ccedil;&atilde;o r&aacute;pida',
      description: 'Importe manifestos e planilhas diretamente nesta viagem sem sair da tela.',
      body: `<div style="display: flex; flex-wrap: wrap; gap: 8px">
        ${['Carga solta (BB)', 'Vazios IMP', 'Ve&iacute;culos', 'Baplie', 'Frete do B/L', 'CE Mercante'].map(uploadBtn).join('')}
      </div>`,
    })}
  </div>`
}

/* ------------------------------ Exportação ------------------------------ */
export function abaExportacao() {
  return `<div style="display: flex; flex-direction: column; gap: 16px">
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px">
      ${metricPanel({ title: 'Vazios', lead: '26', leadUnit: 'unidades embarcadas', tone: 'green', rows: [['Containers distintos', '13'], ['Tipos', ['20GP', '40HC']]] })}
      ${metricPanel({ title: 'Granito', lead: '213', leadUnit: 'ton', tone: 'gold', rows: [['Manifestos', '1'], ['B/Ls', '2'], ['Prontos faturamento', '2'], ['Faturados', '0']] })}
    </div>
    ${metricSection({
      title: 'Cadastro r&aacute;pido',
      description: 'Cadastre manifestos e unidades de exporta&ccedil;&atilde;o diretamente nesta viagem.',
      body: `<div style="display: flex; flex-wrap: wrap; gap: 8px">${['Granito', 'Vazios EXP'].map(uploadBtn).join('')}</div>`,
    })}
  </div>`
}

/* -------------------------- Escalas & Manifestos ------------------------- */
const MANIFEST_ROWS = [
  { mode: 'CNTR', route: 'CNSHA &rarr; BRSSZ', atd: '18/07', atdReal: true, bls: 7, ce: '7/7', ceMaster: '250712345678901' },
  { mode: 'CNTR', route: 'CNNGB &rarr; BRSSZ', atd: '16/07', atdReal: true, bls: 2, ce: '2/2', ceMaster: '250712345678902' },
  { mode: 'BB', route: 'CNSHA &rarr; BRSSZ', atd: '18/07', atdReal: true, bls: 2, ce: '2/2', ceMaster: null },
  { mode: 'CNTR', route: 'omissao', atd: '18/07', atdReal: true, bls: 1, ce: '1/1', ceMaster: '250712345678903' },
]

export function abaEscalas() {
  const ceMeter = (filled, total) => {
    const pct = Math.round((filled / total) * 100)
    return `<span style="display: inline-flex; align-items: center; gap: 8px">
      <span style="width: 44px; height: 5px; border-radius: 999px; background: ${T.panelStrong}; overflow: hidden">
        <span style="display: block; width: ${pct}%; height: 100%; background: ${pct === 100 ? T.green : T.gold}"></span>
      </span>
      <span class="num" style="color: ${pct === 100 ? T.green : T.gold}">${filled}/${total}</span>
    </span>`
  }
  return `<div style="display: flex; flex-direction: column; gap: 16px">
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid ${T.green}; border-radius: 16px; background: ${T.greenSoft}; padding: 12px 16px">
      <span style="display: flex; align-items: center; gap: 12px">
        <span class="dot" style="width: 10px; height: 10px; background: ${T.green}"></span>
        <span>
          <span style="display: block; font-size: 14px; font-weight: 600; color: ${T.green}">Concilia&ccedil;&atilde;o: Conciliado</span>
          <span style="display: block; margin-top: 2px; font-size: 12px; color: ${T.muted}">CE Mercante 10/10 &middot; nenhuma diverg&ecirc;ncia aberta</span>
        </span>
      </span>
      <span class="btn btn--secondary btn--sm" style="opacity: 0.5">${icon('warning', 15)} Resolver diverg&ecirc;ncias</span>
    </div>

    <div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <div>
        <div style="font-size: 14px; font-weight: 700; line-height: 1.35; color: ${T.textStrong}">Manifestos vinculados</div>
        <div style="margin-top: 2px; font-size: 12px; line-height: 1.45; color: ${T.muted}">Uma rota por linha: B/Ls vinculados por POL/POD, ATD POL, CE Mercante e CE Master quando houver batch.</div>
      </div>
      <div class="surface">
        <table class="table table--dense">
          <thead><tr>
            <th style="width: 40%">Rota / Manifesto</th><th style="width: 12%">ATD POL</th><th style="width: 8%">B/Ls</th>
            <th style="width: 12%">CE Merc.</th><th style="width: 16%">CE Master</th><th style="width: 12%">A&ccedil;&otilde;es</th>
          </tr></thead>
          <tbody>
            ${MANIFEST_ROWS.map((r) => `<tr>
              <td>
                <span style="display: inline-flex; align-items: center; gap: 8px">
                  <span style="border: 1px solid ${T.border}; border-radius: 4px; background: ${T.surfaceMuted}; padding: 2px 6px; font-size: 10px; font-weight: 700; color: ${T.muted}">${r.mode}</span>
                  ${r.route === 'omissao'
                    ? `<span style="font-weight: 600; color: ${T.blue}">CNSHA &rarr; <span style="text-decoration: line-through">BRVIX</span> &rarr; BRSSZ</span>
                       <span style="border: 1px solid #b45309; border-radius: 4px; background: #fff7ed; padding: 2px 6px; font-size: 10px; font-weight: 700; color: #b45309">OMISS&Atilde;O</span>`
                    : `<span style="font-weight: 600; color: ${T.blue}">${r.route}</span>`}
                </span>
              </td>
              <td><span class="num" style="color: ${r.atdReal ? T.blue : T.text}; font-weight: ${r.atdReal ? 500 : 400}">${r.atd}</span></td>
              <td class="num">${r.bls}</td>
              <td>${ceMeter(Number(r.ce.split('/')[0]), Number(r.ce.split('/')[1]))}</td>
              <td>${r.ceMaster
                ? `<span class="num" style="color: ${T.textStrong}">${r.ceMaster}</span>`
                : `<span style="font-size: 12px; font-weight: 600; color: #b45309">manifesto n&atilde;o informado</span>`}</td>
              <td><span style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid ${T.borderStrong}; border-radius: 6px; background: ${T.surface}; color: ${T.muted}">${icon('pencil', 15)}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`
}

/* ----------------------------------- ADR --------------------------------- */
const SIGNOFF = { confirmado: ['green', 'Confirmado'], nada: ['slate', 'Nada a declarar'], pendente: ['yellow', 'Pendente'] }

function adrBlock({ title, state, dept, body }) {
  const [tone, label] = SIGNOFF[state]
  return `<section style="display: grid; gap: 16px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap">
      <h3 style="margin: 0; font-size: 16px; font-weight: 700; line-height: 1.35; color: ${T.textStrong}">${title}</h3>
      <span style="display: inline-flex; align-items: center; gap: 8px">
        <span style="font-size: 11px; color: ${T.mutedSoft}">${dept}</span>
        <span class="btn btn--secondary btn--sm" style="min-height: 32px">${icon('file', 14)} Observa&ccedil;&atilde;o</span>
        <span class="badge badge--${tone}" style="padding: 6px 12px">${state === 'confirmado' ? icon('shield', 13) : ''} ${label}</span>
      </span>
    </div>
    ${body}
  </section>`
}

export function abaAdr() {
  const dept = (name, state, who) => {
    const [tone, label] = SIGNOFF[state]
    return `<div style="display: flex; flex-direction: column; gap: 8px; border: 1px solid ${state === 'pendente' ? T.gold : T.border}; border-radius: 12px; background: ${T.surface}; padding: 12px 14px">
      <span style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
        <span style="font-size: 13px; font-weight: 700; color: ${T.textStrong}">${name}</span>
        <span class="badge badge--${tone}">${label}</span>
      </span>
      <span style="font-size: 11px; color: ${T.mutedSoft}">${who}</span>
    </div>`
  }
  return `<div style="display: flex; flex-direction: column; gap: 16px">
    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
      <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${T.muted}; margin-right: 4px">Escala</span>
      <span class="btn btn--primary btn--sm" style="border-radius: 999px; min-height: 36px">BRSSZ</span>
      <span class="btn btn--secondary btn--sm" style="border-radius: 999px; min-height: 36px">BRVIX <span style="border-radius: 999px; background: ${T.surfaceMuted}; padding: 2px 7px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">Omitida</span></span>
    </div>

    <div style="display: grid; gap: 10px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${T.muted}">ADR por terminal</span>
      <span style="display: flex; gap: 8px; flex-wrap: wrap">
        <span class="btn btn--primary btn--sm" style="border-radius: 999px; min-height: 36px">BTP &mdash; Brasil Terminal Portu&aacute;rio</span>
        <span class="btn btn--secondary btn--sm" style="border-radius: 999px; min-height: 36px">DPW &mdash; DP World Santos</span>
      </span>
    </div>

    <div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap">
        <span style="display: inline-flex; align-items: center; gap: 12px">
          <span style="font-family: ${T.mono}; font-size: 14px; font-weight: 600; color: ${T.muted}">2/3 departamentos assinados</span>
          <span style="display: inline-flex; gap: 4px">
            ${['#1a8c50', '#1a8c50', '#cdc8bc'].map((c) => `<span style="width: 42px; height: 5px; border-radius: 999px; background: ${c}"></span>`).join('')}
          </span>
        </span>
        <span class="btn btn--primary btn--sm" style="opacity: 0.55">Fechar ADR</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
        ${dept('Opera&ccedil;&otilde;es', 'confirmado', 'Ana Ribeiro &middot; 22/08 09:14')}
        ${dept('Documenta&ccedil;&atilde;o', 'confirmado', 'Marcos Lima &middot; 22/08 10:02')}
        ${dept('Equipamentos', 'pendente', 'aguardando assinatura')}
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 12px; margin-top: 4px">
      <span style="font-size: 14px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}">Importa&ccedil;&atilde;o</span>
      <span style="flex: 1; height: 1px; background: ${T.border}"></span>
    </div>
    ${adrBlock({
      title: 'Carga descarregada', state: 'confirmado', dept: 'Opera&ccedil;&otilde;es',
      body: `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px">
        ${metricPanel({ title: 'Descarga de importa&ccedil;&atilde;o', lead: '11', leadUnit: 'containers', tone: 'blue', flat: true, rows: [['20GP', '4'], ['40HC', '6'], ['40OT', '1']] })}
        ${metricPanel({ title: 'Carga solta', lead: '213', leadUnit: 'ton', tone: 'gold', flat: true, rows: [['B/Ls', '2'], ['M&aacute;quinas', '4'], ['Em transbordo', '1 B/L']] })}
      </div>`,
    })}
    ${adrBlock({ title: 'Vazios descarregados', state: 'nada', dept: 'Equipamentos', body: `<div style="border: 1px dashed ${T.border}; border-radius: 12px; background: ${T.surface}; padding: 20px; text-align: center; font-size: 14px; color: ${T.mutedSoft}">Nenhum vazio descarregado nesta escala.</div>` })}

    <div style="display: flex; align-items: center; gap: 12px; margin-top: 4px">
      <span style="font-size: 14px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}">Exporta&ccedil;&atilde;o</span>
      <span style="flex: 1; height: 1px; background: ${T.border}"></span>
    </div>
    ${adrBlock({
      title: 'Granito', state: 'pendente', dept: 'Documenta&ccedil;&atilde;o',
      body: `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px">
        ${metricPanel({ title: 'Granito', lead: '213', leadUnit: 'ton', tone: 'gold', flat: true, rows: [['B/Ls', '2'], ['Blocos', '38']] })}
        ${metricPanel({ title: 'Opera&ccedil;&atilde;o de p&aacute;tio', lead: 'R$ 18.420', leadUnit: '', tone: 'slate', flat: true, rows: [['Depots / terminais', ['BTP', 'DPW']], ['Storage (dias)', '3']] })}
      </div>`,
    })}
  </div>`
}

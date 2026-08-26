import { T, icon } from './kit.mjs'
import { secao } from './abakit.mjs'

/**
 * Aba ADR. O "hoje" transcreve VoyageAgencyReportTab.tsx; a proposta reorganiza
 * a aba em torno do fato de o ADR ser por terminal, e liga os dois níveis de
 * assinatura (seção e departamento) que hoje não conversam na tela.
 *
 * Mapa real de AGENCY_REPORT_SECTIONS (agencyDepartureReport.ts:35):
 *   datas → operações · carga_descarregada, vazios_descarregados → documentação
 *   carga_carregada, veiculos, vazios_embarcados → equipamentos
 */

const SECOES = [
  { id: 'datas', titulo: 'Escala', depto: 'Operações', fase: 'Importação', estado: 'confirmado', frentes: ['Atracação'], obs: null },
  { id: 'carga_descarregada', titulo: 'Carga descarregada', depto: 'Documentação', fase: 'Importação', estado: 'confirmado', frentes: ['CNTR importação'], obs: 'Dois containers com avaria de porta, fotos no processo.' },
  { id: 'vazios_descarregados', titulo: 'Vazios descarregados', depto: 'Documentação', fase: 'Importação', estado: 'nada', frentes: ['Vazios IMP'], obs: null },
  { id: 'carga_carregada', titulo: 'Carga carregada', depto: 'Equipamentos', fase: 'Exportação', estado: 'confirmado', frentes: ['Granito'], obs: null },
  { id: 'vazios_embarcados', titulo: 'Embarque de vazios', depto: 'Equipamentos', fase: 'Exportação', estado: 'pendente', frentes: ['Vazios EXP'], obs: null, divergencia: '18 unidades no Embarque contra 16 no Baplie — a Conciliação precisa revisar.' },
]

const DEPTOS = [
  { nome: 'Operações', assinado: true, quem: 'Ana Ribeiro · 22/08 09:14' },
  { nome: 'Documentação', assinado: true, quem: 'Marcos Lima · 22/08 10:02' },
  { nome: 'Equipamentos', assinado: false, quem: null },
]

const ESTADO = {
  confirmado: ['green', 'Confirmado'],
  nada: ['yellow', 'Nada a declarar'],
  pendente: ['slate', 'Pendente'],
}

/* ================================ HOJE ================================= */
function pillHoje(label, ativo, extra = '') {
  return `<span class="btn btn--${ativo ? 'primary' : 'secondary'}" style="border-radius: 999px; font-size: 13px">${label}${extra}</span>`
}

/** .app-signoff — segmented de 3 estados, um por seção. */
function signoffHoje(estado) {
  const seg = (chave, label) => {
    const on = chave === estado
    const fundo = on ? (chave === 'confirmado' ? T.greenSoft : chave === 'nada' ? T.goldSoft : T.panelStrong) : 'transparent'
    const cor = on ? (chave === 'confirmado' ? '#157a45' : chave === 'nada' ? '#a85309' : T.text) : T.muted
    return `<span style="display: inline-flex; align-items: center; justify-content: center; min-height: 40px; min-width: 44px; padding: 6px 12px; border-radius: 9px; background: ${fundo}; color: ${cor}; font-size: 12px; font-weight: 600">${label}</span>`
  }
  return `<span style="display: inline-flex; gap: 3px; padding: 3px; border: 1px solid ${T.border}; border-radius: 12px; background: ${T.surfaceMuted}">
    ${seg('pendente', 'Pendente')}${seg('confirmado', 'Confirmado')}${seg('nada', 'Nada a declarar')}
  </span>`
}

function blocoHoje(s) {
  return `<section style="display: grid; gap: 16px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
    <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px">
      <h3 style="margin: 0; font-size: 16px; font-weight: 700; line-height: 1.35; color: ${T.textStrong}">${s.titulo}</h3>
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px">
        <span style="font-size: 12px; color: ${T.muted}">Setor: ${s.depto}</span>
        <span class="btn btn--secondary btn--sm">Observa&ccedil;&atilde;o</span>
        ${signoffHoje(s.estado)}
      </div>
    </div>
    ${s.divergencia ? `<p style="margin: 0; font-size: 14px; color: ${T.red}">${s.divergencia}</p>` : ''}
    ${s.estado === 'nada' ? `<p style="margin: 0; font-size: 14px; color: ${T.muted}">Nada operado nesta escala.</p>` : ''}
  </section>`
}

export function adrAntes() {
  const fase = (nome, secoes) => `<div style="display: grid; gap: 12px">
    <h2 style="margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: ${T.muted}">${nome}</h2>
    <div style="display: grid; gap: 16px">${secoes.map(blocoHoje).join('')}</div>
  </div>`

  return `<div style="display: grid; gap: 16px">
    <div style="display: flex; flex-wrap: wrap; gap: 8px">
      ${pillHoje('BRSSZ', true)}
      ${pillHoje('BRVIX', false, ` <span style="border-radius: 999px; background: ${T.surfaceMuted}; padding: 2px 7px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">Omitida</span>`)}
    </div>
    <div style="display: grid; gap: 10px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${T.muted}">ADR por terminal</span>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        ${pillHoje('BTP &mdash; Brasil Terminal Portu&aacute;rio', true)}
        ${pillHoje('DPW &mdash; DP World Santos', false)}
      </div>
    </div>
    <div style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px">
        <span style="font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; color: ${T.muted}">2/3 departamentos assinados</span>
        <span class="btn btn--primary" style="opacity: 0.55">Fechar ADR</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
        ${DEPTOS.map((d) => `<div style="display: grid; gap: 8px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 16px">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
            <span style="font-size: 14px; font-weight: 600; color: ${T.text}">${d.nome}</span>
            <span style="border: 1px solid ${d.assinado ? T.green : T.border}; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 600; color: ${d.assinado ? T.green : T.muted}">${d.assinado ? 'Assinado' : 'Pendente'}</span>
          </div>
          ${d.quem ? `<span style="font-size: 12px; color: ${T.muted}">${d.quem}</span>` : ''}
          <span class="btn btn--${d.assinado ? 'secondary' : 'primary'} btn--sm">${d.assinado ? 'Reabrir' : 'Assinar'}</span>
        </div>`).join('')}
      </div>
    </div>
    ${fase('Importa&ccedil;&atilde;o', SECOES.filter((s) => s.fase === 'Importação'))}
    ${fase('Exporta&ccedil;&atilde;o', SECOES.filter((s) => s.fase === 'Exportação'))}
  </div>`
}

/* =============================== PROPOSTA ============================== */
export function adrDepois() {
  const chip = (tone, label, ic = null) => `<span class="badge badge--${tone}" style="padding: 4px 10px">${ic ? icon(ic, 12) + ' ' : ''}${label}</span>`

  /** O terminal decide o documento inteiro: sobe para o cabeçalho. */
  const cabecalho = `<div style="display: grid; gap: 14px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap">
      <span style="display: inline-flex; align-items: center; gap: 10px; font-size: 12px; color: ${T.mutedSoft}">
        <span style="font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">ADR</span>
        <span>escala</span>
        <span style="font-size: 14px; font-weight: 700; color: ${T.textStrong}">BRSSZ</span>
        ${icon('chevronRight', 13, T.mutedSoft)}
        <span>terminal</span>
        <span style="font-size: 14px; font-weight: 700; color: ${T.textStrong}">BTP</span>
        <span style="color: ${T.mutedSoft}">Brasil Terminal Portu&aacute;rio</span>
      </span>
      <span style="display: inline-flex; align-items: center; gap: 8px">
        ${chip('blue', 'Aberto')}
        <span class="btn btn--primary btn--sm" style="opacity: 0.55">Fechar ADR</span>
      </span>
    </div>
    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border-top: 1px solid ${T.border}; padding-top: 12px">
      <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.mutedSoft}; margin-right: 2px">Escala</span>
      <span class="btn btn--primary btn--sm" style="border-radius: 999px; min-height: 34px">BRSSZ</span>
      <span class="btn btn--secondary btn--sm" style="border-radius: 999px; min-height: 34px">BRVIX ${chip('slate', 'Omitida')}</span>
      <span style="width: 1px; height: 22px; background: ${T.border}; margin: 0 6px"></span>
      <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.mutedSoft}; margin-right: 2px">Terminal</span>
      <span class="btn btn--primary btn--sm" style="border-radius: 999px; min-height: 34px">BTP ${chip('blue', '5 se&ccedil;&otilde;es')}</span>
      <span class="btn btn--secondary btn--sm" style="border-radius: 999px; min-height: 34px">DPW <span class="badge badge--green" style="padding: 2px 8px; font-size: 10px">Fechado</span></span>
    </div>
    <div style="display: flex; align-items: flex-start; gap: 8px; border-top: 1px solid ${T.border}; padding-top: 12px; font-size: 12px; line-height: 1.5; color: ${T.mutedSoft}">
      ${icon('warning', 14, T.gold)}
      <span><b style="color: ${T.goldStrong}">Falta Equipamentos assinar</b> &mdash; 1 de 2 se&ccedil;&otilde;es do setor ainda pendente. Os 3 departamentos precisam assinar para fechar este ADR.</span>
    </div>
  </div>`

  const blocoSecao = (s) => {
    const [tone, label] = ESTADO[s.estado]
    return `<div style="display: grid; gap: 12px; border: 1px solid ${s.estado === 'pendente' ? T.gold : T.border}; border-radius: 8px; background: ${T.surface}; padding: 14px 16px">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap">
        <span style="display: inline-flex; align-items: center; gap: 10px">
          <span style="font-size: 15px; font-weight: 700; color: ${T.textStrong}">${s.titulo}</span>
          ${s.frentes.map((f) => `<span class="pill" style="background: ${T.surfaceMuted}">${f}</span>`).join('')}
          ${s.obs ? `<span title="${s.obs}" style="display: inline-flex; align-items: center; gap: 5px; border: 1px solid ${T.border}; border-radius: 999px; background: ${T.surfaceMuted}; padding: 3px 9px 3px 7px; font-size: 11px; font-weight: 600; color: ${T.muted}">${icon('file', 11, T.muted)} Observa&ccedil;&atilde;o</span>` : ''}
        </span>
        <span style="display: inline-flex; align-items: center; gap: 8px">
          ${chip(tone, label, s.estado === 'confirmado' ? 'shield' : null)}
          <span class="btn btn--secondary btn--sm" style="min-height: 32px; font-size: 11px">Alterar</span>
        </span>
      </div>
      ${s.divergencia ? `<div style="display: flex; align-items: flex-start; gap: 9px; border: 1px solid #fecaca; border-radius: 8px; background: ${T.redSoft}; padding: 10px 12px">
        ${icon('warning', 14, T.red)}
        <span style="font-size: 12px; line-height: 1.5; color: ${T.red}">${s.divergencia}</span>
      </div>` : ''}
      ${s.estado === 'nada' ? `<div style="border: 1px dashed ${T.border}; border-radius: 6px; padding: 12px; text-align: center; font-size: 12px; color: ${T.mutedSoft}">Nada operado nesta escala</div>` : ''}
    </div>`
  }

  const grupoDepto = (d) => {
    const minhas = SECOES.filter((s) => s.depto === d.nome)
    const resolvidas = minhas.filter((s) => s.estado !== 'pendente').length
    const completo = resolvidas === minhas.length
    return `<section style="display: grid; gap: 12px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surfaceMuted}; padding: 14px 16px">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap">
        <span style="display: inline-flex; align-items: center; gap: 12px">
          <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">${d.nome}</span>
          <span style="font-family: ${T.mono}; font-size: 12px; font-weight: 600; color: ${completo ? T.green : T.gold}">${resolvidas}/${minhas.length} se&ccedil;&otilde;es</span>
          <span style="display: inline-flex; gap: 3px">${minhas.map((s) => `<span style="width: 26px; height: 4px; border-radius: 999px; background: ${s.estado === 'pendente' ? T.panelStrong : T.green}"></span>`).join('')}</span>
        </span>
        <span style="display: inline-flex; align-items: center; gap: 10px">
          ${d.quem ? `<span style="font-size: 11px; color: ${T.mutedSoft}">${d.quem}</span>` : ''}
          ${d.assinado ? chip('green', 'Assinado', 'shield') : chip('yellow', 'Aguardando assinatura')}
          <span class="btn btn--${d.assinado ? 'secondary' : 'primary'} btn--sm" style="min-height: 34px${!d.assinado && !completo ? '; opacity: 0.5' : ''}">${d.assinado ? 'Reabrir' : 'Assinar setor'}</span>
        </span>
      </div>
      <div style="display: grid; gap: 10px">${minhas.map(blocoSecao).join('')}</div>
    </section>`
  }

  return `<div style="display: flex; flex-direction: column; gap: 16px">
    ${cabecalho}
    ${secao('Se&ccedil;&otilde;es por departamento', 'quem assina responde pelo grupo inteiro')}
    <div style="display: grid; gap: 12px">${DEPTOS.map(grupoDepto).join('')}</div>
    <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-inline: 2px; font-size: 11px; line-height: 1.5; color: ${T.mutedSoft}">
      <span>As se&ccedil;&otilde;es vis&iacute;veis mudam por terminal: <code>sectionIsVisible</code> esconde a que n&atilde;o tem frente naquele terminal.</span>
      <span style="width: 1px; height: 12px; background: ${T.border}"></span>
      <span>A pastilha ao lado da se&ccedil;&atilde;o &eacute; a frente de opera&ccedil;&atilde;o que a comp&otilde;e.</span>
    </div>
  </div>`
}

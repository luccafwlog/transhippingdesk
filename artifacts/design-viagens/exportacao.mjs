import { T, icon } from './kit.mjs'
import {
  barraAcoes, blocoEscala, botao, contagem, escalaHeader,
  painel, secao, separador, totalStrip,
} from './abakit.mjs'

/**
 * Aba Exportação. O "hoje" transcreve VoyageExportacaoTab.tsx; a proposta herda
 * a gramática fechada na aba Importação. Dados coerentes com ARIES / 088E.
 */

const POLS = [
  {
    pol: 'BRSSZ', nome: 'Santos',
    resumo: '18 vazios · 2 B/Ls de granito',
    vazios: { unidades: 18, containers: 18, tipos: [['20GP', 10], ['40HC', 8]], origens: 'Depot Santos' },
    granito: { manifestos: 1, bls: 2, ton: '213', prontos: 2, faturados: 0 },
  },
  {
    pol: 'BRVIX', nome: 'Vitória',
    resumo: '8 vazios',
    vazios: { unidades: 8, containers: 8, tipos: [['40HC', 8]], origens: 'Depot Vitória' },
    granito: null,
  },
]

/** Totais que a aba mostra hoje — agregados da viagem. */
const HOJE = {
  vazios: { unidades: 26, containers: 26, tipos: '20GP (10) | 40HC (16)' },
  granito: { manifestos: 1, bls: 2, ton: '213', prontos: 2, faturados: 0 },
}

const TOTAIS = [
  ['Vazios embarcados', '26'], ['CNTRs distintos', '26'],
  ['Granito (B/Ls)', '2'], ['Granito (ton)', '213'], ['Prontos p/ faturar', '2'],
]

/* ================================ ANTES ================================ */
function infoAntes(label, value) {
  return `<div style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; border-bottom: 1px solid ${T.border}; padding-bottom: 10px">
    <span style="color: ${T.muted}; line-height: 1.45">${label}</span>
    <span style="color: ${T.text}; font-weight: 700; text-align: right">${value}</span>
  </div>`
}

function metricPanelAntes(title, children) {
  return `<div style="display: flex; flex-direction: column; gap: 14px; border: 1px solid ${T.border}; border-radius: 12px; background: linear-gradient(180deg, ${T.surface} 0%, ${T.surfaceMuted} 100%); padding: 18px; box-shadow: ${T.shadow}">
    <div style="color: ${T.text}; font-size: 17px; font-weight: 700">${title}</div>
    <dl style="display: grid; gap: 12px; margin: 0; font-size: 14px; color: ${T.text}">${children}</dl>
  </div>`
}

export function exportacaoAntes() {
  return `<div style="display: flex; flex-direction: column; gap: 16px">
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start">
      ${metricPanelAntes('Vazios', [
        infoAntes('Unidades embarcadas', String(HOJE.vazios.unidades)),
        infoAntes('Containers distintos', String(HOJE.vazios.containers)),
        infoAntes('Tipos', HOJE.vazios.tipos),
      ].join(''))}
      ${metricPanelAntes('Granito', [
        infoAntes('Manifestos', String(HOJE.granito.manifestos)),
        infoAntes('B/Ls', String(HOJE.granito.bls)),
        infoAntes('Peso total', `${HOJE.granito.ton} ton`),
        infoAntes('Prontos faturamento', String(HOJE.granito.prontos)),
        infoAntes('Faturados', String(HOJE.granito.faturados)),
      ].join(''))}
    </div>
    <section style="display: grid; gap: 16px; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surfaceMuted}; padding: 16px">
      <div>
        <div style="font-size: 14px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}">Cadastro r&aacute;pido</div>
        <div style="margin-top: 4px; font-size: 14px; color: ${T.muted}">Cadastre manifestos e unidades de exporta&ccedil;&atilde;o diretamente nesta viagem.</div>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        ${['Manifesto Granito', 'Vazios Exp'].map((l) => `<span class="btn btn--secondary" style="font-size: 12px">${icon('boxOpen', 13)} ${l}</span>`).join('')}
      </div>
    </section>
  </div>`
}

/* ================================ DEPOIS =============================== */
export function exportacaoDepois() {
  const blocos = POLS.map((p) => blocoEscala(`
    ${escalaHeader(p.pol, p.nome, p.resumo)}
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: stretch">
      ${painel({
        title: 'Vazios EXP', icone: 'boxOpen', lead: String(p.vazios.unidades), leadUnit: 'embarcados',
        stats: [['CNTRs distintos', String(p.vazios.containers)], ['Origem', p.vazios.origens]],
        tokensHtml: contagem(p.vazios.tipos),
      })}
      ${p.granito
        ? painel({
            title: 'Granito', icone: 'mountain', lead: p.granito.ton, leadUnit: 'ton',
            stats: [
              ['Manifestos', String(p.granito.manifestos)],
              ['B/Ls', String(p.granito.bls)],
              ['Prontos', String(p.granito.prontos), T.green],
              ['Faturados', String(p.granito.faturados), p.granito.faturados ? T.green : T.mutedSoft],
            ],
          })
        : painel({ title: 'Granito', icone: 'mountain', vazio: 'Sem granito embarcado neste terminal' })}
    </div>
  `)).join('')

  return `<div style="display: flex; flex-direction: column; gap: 16px">
    ${totalStrip('Total da viagem', TOTAIS)}
    ${secao('Carga por terminal de embarque')}
    <div style="display: grid; gap: 12px">${blocos}</div>
    ${barraAcoes({
      titulo: 'A&ccedil;&otilde;es da exporta&ccedil;&atilde;o',
      descricao: 'Granito importa por planilha; vazios passam pelo Embarque, onde as unidades e as taxas de servi&ccedil;o vivem juntas.',
      botoes: [
        botao('Manifesto Granito', 'mountain', { destaque: true }),
        botao('CE Mercante (Granito)', 'shield'),
        separador,
        botao('Novo embarque de vazios', 'arrowRight', { destaque: true }),
      ].join(''),
      nota: '<b style="color: ' + T.muted + '">Vazios EXP n&atilde;o &eacute; upload avulso.</b> A RPC <code>import_vazios_bookings_transactional</code> at&eacute; cria a <code>vazios_export_operations</code> a partir do <code>embark_port</code> da planilha, mas popula s&oacute; as unidades &mdash; nunca as <code>vazios_export_service_lines</code> &mdash; e pula a escolha do porto entre as escalas da viagem. Aqui o bot&atilde;o leva ao Embarque com a viagem travada; a planilha de unidades continua dentro dele. O CE Mercante de Granito j&aacute; existe em <code>/granito</code>: este &eacute; um atalho com a viagem travada, n&atilde;o um recurso novo.',
    })}
  </div>`
}

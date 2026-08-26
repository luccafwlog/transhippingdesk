import { writeFileSync, rmSync } from 'node:fs'
import { T, artboard, icon } from './kit.mjs'
import { ESTADO, VOYAGES } from './data.mjs'
import {
  estadoDot, kpiBand, novaViagemBtn, pageHeader,
  tabsRow, timeline, toolbar, transbordoCard, voyageHero,
} from './blocks.mjs'
import { metricPanel } from './tabs.mjs'
import { planejamentoAntes, planejamentoEscala } from './visaogeral.mjs'
import { importacaoAntes, importacaoDepois } from './importacao.mjs'
import { exportacaoAntes, exportacaoDepois, exportacaoMultiDepot } from './exportacao.mjs'
import { modalGranitoAntes, modalGranitoDepois } from './modalgranito.mjs'
import { rotasAntes, rotasDepois } from './rotas.mjs'
import { adrAntes, adrDepois } from './adr.mjs'

export const HEIGHTS = {}
const out = (name, html, height) => {
  writeFileSync(new URL(`./${name}`, import.meta.url), html)
  HEIGHTS[name] = height
  console.log(`${name.padEnd(24)} ${String(height).padStart(5)}px  ${(html.length / 1024).toFixed(1)} KB`)
}

const modIcons = (mods) => mods.length
  ? `<span style="display: inline-flex; align-items: center; gap: 5px; color: ${T.mutedSoft}">${mods.map((m) => icon(m, 13)).join('')}</span>`
  : ''

/** Card do rail refinado: rodapé fixo na base com B/L · CNTR · CE. */
function railCard(v, { selected = false, hover = false } = {}) {
  const e = ESTADO[v.estado]
  return `<div style="position: relative; display: flex; flex-direction: column; gap: 9px; flex: none; width: 268px; min-height: 134px; padding: 12px 14px; border: 1px solid ${selected ? T.blueBtn : T.border}; border-radius: 12px; background: ${selected ? T.bgElevated : hover ? T.surfaceMuted : T.surface}${selected ? `; box-shadow: inset 0 -3px 0 ${T.blueBtn}` : ''}">
    <div style="display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 26px">
      ${estadoDot(v.estado)}
      <span class="eyebrow" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${v.carrier}</span>
      ${hover
        ? `<span style="margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid ${T.border}; border-radius: 6px; background: ${T.surface}; color: ${T.muted}">${icon('pencil', 13)}</span>`
        : `<span style="margin-left: auto; font-size: 10px; font-weight: 700; color: ${e.color}">${e.label}</span>`}
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

function railStrip() {
  return `<div style="display: flex; flex-direction: column; gap: 7px; margin-bottom: 18px">
    <div style="display: flex; align-items: center; justify-content: space-between; padding-inline: 2px">
      <span style="font-size: 11px; color: ${T.mutedSoft}">Ordenado por pr&oacute;xima escala</span>
      <span style="display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: ${T.mutedSoft}">
        12 viagens
        ${['chevronLeft', 'chevronRight'].map((c) => `<span style="display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid ${T.border}; border-radius: 999px; background: ${T.surface}; color: ${T.muted}">${icon(c, 14)}</span>`).join('')}
      </span>
    </div>
    <div style="display: flex; gap: 12px; overflow: hidden">
      ${VOYAGES.slice(0, 5).map((v, i) => railCard(v, { selected: i === 0 })).join('')}
    </div>
  </div>`
}

/* ================================================================== *
 * Main — Direção A, a escolhida: rail refinado + card de detalhe      *
 * ================================================================== */
const MAIN_H = 2160
out('Main.dc.html', artboard({
  height: MAIN_H,
  body: `<div class="main">
    ${pageHeader(novaViagemBtn)}
    ${toolbar()}
    ${railStrip()}
    <div class="surface surface--padded" style="display: flex; flex-direction: column; gap: 18px">
      ${voyageHero()}
      ${kpiBand()}
      ${tabsRow()}
      ${transbordoCard()}
      ${planejamentoEscala()}
      ${timeline()}
    </div>
  </div>`,
}), MAIN_H)

/* ================================================================== *
 * Abas — o corpo de cada aba, sem o cromo, na largura que ocupa       *
 * ================================================================== */
function tabBoard({ height, active, note, body }) {
  return artboard({
    height,
    chrome: false,
    body: `<div style="padding: 28px; display: flex; flex-direction: column; gap: 18px">
      <div>
        <div style="font-family: ${T.display}; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: ${T.textStrong}">Aba &middot; ${active}</div>
        <div style="margin-top: 6px; max-width: 900px; font-size: 13px; line-height: 1.6; color: ${T.muted}">${note}</div>
      </div>
      <div class="surface surface--padded" style="display: flex; flex-direction: column; gap: 18px">
        ${tabsRow(active)}
        ${body}
      </div>
    </div>`,
  })
}

/* ================================================================== *
 * Cards — anatomia e estados                                          *
 * ================================================================== */
function cardsGroup(title, note, body) {
  return `<section style="display: flex; flex-direction: column; gap: 12px">
    <div>
      <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}">${title}</div>
      <div style="margin-top: 4px; font-size: 13px; line-height: 1.55; color: ${T.mutedSoft}">${note}</div>
    </div>
    ${body}
  </section>`
}

const label = (t) => `<div style="margin-bottom: 8px; font-size: 11px; font-weight: 600; color: ${T.mutedSoft}">${t}</div>`

const CARDS_H = 1540
out('Cards.dc.html', artboard({
  height: CARDS_H,
  chrome: false,
  body: `<div style="padding: 28px; display: flex; flex-direction: column; gap: 28px">
    <div>
      <div style="font-family: ${T.display}; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: ${T.textStrong}">Cards &middot; anatomia e estados</div>
      <div style="margin-top: 6px; max-width: 900px; font-size: 13px; line-height: 1.6; color: ${T.muted}">Cada peça que se repete na página, com os estados que ela precisa cobrir. Serve de referência para a implementação e para conferir que nenhum estado ficou sem desenho.</div>
    </div>

    ${cardsGroup('Card do rail', 'Rodapé ancorado na base para os números alinharem entre cards com uma ou duas escalas. O estado de conciliação aparece duas vezes — ponto e rótulo — porque cor sozinha não basta.', `
      <div style="display: flex; gap: 12px; flex-wrap: wrap">
        <div>${label('Selecionado')}${railCard(VOYAGES[0], { selected: true })}</div>
        <div>${label('Hover &mdash; a&ccedil;&atilde;o de editar')}${railCard(VOYAGES[1], { hover: true })}</div>
        <div>${label('Pendente')}${railCard(VOYAGES[2])}</div>
        <div>${label('Divergente')}${railCard(VOYAGES[4])}</div>
        <div>${label('Sem escala prevista')}${railCard(VOYAGES[8])}</div>
      </div>`)}

    ${cardsGroup('Tile de KPI', 'Um número dominante em Syne e no máximo três linhas de apoio. É a mudança que resolve os oito pares label/valor a 12px do DirectionKpiTile atual.', kpiBand())}

    ${cardsGroup('MetricPanel', 'A peça que carrega as abas de Importação e Exportação. Valores simples alinham à direita; listas de tipo viram tokens em pílula.', `
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px">
        ${metricPanel({ title: 'Containers', lead: '11', leadUnit: 'distintos', tone: 'blue', rows: [['Containers IMO', '0'], ['Containers OOG', '1'], ['Tipos de container', ['20GP', '40HC', '40OT']]] })}
        ${metricPanel({ title: 'Granito', lead: '213', leadUnit: 'ton', tone: 'gold', rows: [['Manifestos', '1'], ['B/Ls', '2'], ['Faturados', '0']] })}
        ${metricPanel({ title: 'Vazios', lead: '0', leadUnit: 'bookings', tone: 'slate', rows: [['Containers distintos', '0'], ['Tipos', '&mdash;']] })}
      </div>`)}

    ${cardsGroup('Linha da timeline', 'A barra de 4px à esquerda é o único portador do tipo do evento — verde para conciliação, azul para carga, dourado para escala.', timeline())}
  </div>`,
}), CARDS_H)

/* ================================================================== *
 * Visão geral — Planejamento por escala: antes e depois               *
 * ================================================================== */
function compareBoard({ height, chip, chipTone, title, note, body }) {
  const tint = chipTone === 'hoje' ? { bg: T.panel, border: T.borderStrong, fg: T.muted } : { bg: T.blueSoft, border: '#bfdbfe', fg: T.blueBtn }
  return artboard({
    height,
    chrome: false,
    body: `<div style="padding: 28px; display: flex; flex-direction: column; gap: 18px">
      <div>
        <span style="display: inline-flex; align-items: center; border: 1px solid ${tint.border}; border-radius: 999px; background: ${tint.bg}; padding: 4px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${tint.fg}">${chip}</span>
        <div style="margin-top: 10px; font-family: ${T.display}; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: ${T.textStrong}">${title}</div>
        <div style="margin-top: 6px; max-width: 1100px; font-size: 13px; line-height: 1.6; color: ${T.muted}">${note}</div>
      </div>
      ${body}
    </div>`,
  })
}

const ANTES_H = 560
out('PlanejamentoAntes.dc.html', compareBoard({
  height: ANTES_H, chip: 'Hoje', chipTone: 'hoje',
  title: 'Planejamento por escala &mdash; como est&aacute; hoje',
  note: 'Transcrição fiel de <code>VoyageVisaoTab.tsx</code> com os estilos resolvidos de <code>index.css</code>: 9 colunas, cabeçalhos sem versalete, datas por extenso com ano, e as atracações num bloco solto com <code>ml-4</code> que não conversa com as colunas de cima.',
  body: planejamentoAntes(),
}), ANTES_H)

const PLAN_H = 700
out('PlanejamentoEscala.dc.html', compareBoard({
  height: PLAN_H, chip: 'Proposta', chipTone: 'proposta',
  title: 'Planejamento por escala &mdash; proposta',
  note: 'Seis mudanças. A escala mantém as suas colunas de data; a atracação sai da grade e vira painel recolhível, recuado, com cabeçalho próprio em tom claro para não competir com o navy de cima.',
  body: planejamentoEscala(),
}), PLAN_H)

const IMPA_H = 1020
out('ImportacaoAntes.dc.html', compareBoard({
  height: IMPA_H, chip: 'Hoje', chipTone: 'hoje',
  title: 'Aba Importa&ccedil;&atilde;o &mdash; como est&aacute; hoje',
  note: 'Transcrição fiel de <code>VoyageImportacaoTab.tsx</code>: um painel por POD com MetricPanels em gradiente, número de painéis variando conforme a escala tenha veículos ou carga solta, "Vazios Importacao" solto no fim, e seis botões idênticos de importação.',
  body: importacaoAntes(),
}), IMPA_H)

const IMPD_H = 1160
out('ImportacaoDepois.dc.html', compareBoard({
  height: IMPD_H, chip: 'Proposta', chipTone: 'proposta',
  title: 'Aba Importa&ccedil;&atilde;o &mdash; proposta',
  note: 'Tudo por escala: Containers e Carga solta como painéis, Veículos e Vazios IMP como faixas — os dois têm POD na origem (<code>vazios_importacao_containers.pod</code> e <code>vehicles → container → bl → bls.pod</code>). Containers ganha carga geral, veículos, IMO, OOG e contagem por tipo; Veículos traz marca e tipo de container. A importação rápida vira uma fila só, com B/L de container e de carga solta separados e o CE Mercante servindo os dois.',
  body: importacaoDepois(),
}), IMPD_H)

const EXPA_H = 560
out('ExportacaoAntes.dc.html', compareBoard({
  height: EXPA_H, chip: 'Hoje', chipTone: 'hoje',
  title: 'Aba Exporta&ccedil;&atilde;o &mdash; como est&aacute; hoje',
  note: 'Transcrição fiel de <code>VoyageExportacaoTab.tsx</code>: dois MetricPanels em gradiente com os totais da viagem. O componente chama <code>summarizeExportByPol</code>, que devolve granito e vazios por terminal de embarque — e usa só o <code>.length</code> do resultado, para decidir se mostra os painéis. O detalhe por POL é calculado e descartado.',
  body: exportacaoAntes(),
}), EXPA_H)

const EXPD_H = 940
out('ExportacaoDepois.dc.html', compareBoard({
  height: EXPD_H, chip: 'Proposta', chipTone: 'proposta',
  title: 'Aba Exporta&ccedil;&atilde;o &mdash; proposta',
  note: 'Mesma gramática da Importação: faixa de total no topo, um bloco por terminal de embarque, painéis chapados com número dominante, mini-stats e tokens com contagem, e o cadastro rápido numa fila só. O detalhe por POL que o serviço já calcula passa a aparecer.',
  body: exportacaoDepois(),
}), EXPD_H)

const EXPM_H = 1000
out('ExportacaoMultiDepot.dc.html', compareBoard({
  height: EXPM_H, chip: 'Proposta · múltiplos depots', chipTone: 'proposta',
  title: 'Aba Exporta&ccedil;&atilde;o &mdash; vazios de v&aacute;rios depots',
  note: 'Mesma viagem, com BRSSZ recebendo vazios de três depots. O painel abre a repartição por depot — nome, código, tipos e unidades — e o total por tipo fica no cabeçalho da lista. Com um depot só, como BRVIX, colapsa na linha única.',
  body: exportacaoMultiDepot(),
}), EXPM_H)

const MODAL_H = 900
out('ModalGranito.dc.html', artboard({
  height: MODAL_H,
  chrome: false,
  body: `<div style="padding: 28px; display: flex; flex-direction: column; gap: 20px">
    <div>
      <div style="font-family: ${T.display}; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: ${T.textStrong}">Modal &middot; Importar Manifesto Granito</div>
      <div style="margin-top: 6px; max-width: 1100px; font-size: 13px; line-height: 1.6; color: ${T.muted}">O parser devolve <code>vesselVoyage</code> — o navio/viagem declarado dentro da planilha — e <code>importGraniteManifest</code> devolve <code>pendingCount</code>, os B/Ls que não casaram com cliente. O modal de hoje descarta os dois: mostra só B/Ls e Erros.</div>
    </div>
    <div style="display: flex; gap: 28px; align-items: flex-start">
      <div style="display: flex; flex-direction: column; gap: 12px">
        <span style="display: inline-flex; align-self: flex-start; align-items: center; border: 1px solid ${T.borderStrong}; border-radius: 999px; background: ${T.panel}; padding: 4px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.muted}">Hoje</span>
        ${modalGranitoAntes()}
      </div>
      <div style="display: flex; flex-direction: column; gap: 12px">
        <span style="display: inline-flex; align-self: flex-start; align-items: center; border: 1px solid #bfdbfe; border-radius: 999px; background: ${T.blueSoft}; padding: 4px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.blueBtn}">Proposta</span>
        ${modalGranitoDepois()}
      </div>
    </div>
    <div style="display: flex; align-items: flex-start; gap: 9px; max-width: 1100px; font-size: 12px; line-height: 1.6; color: ${T.mutedSoft}">
      ${icon('warning', 14, T.gold)}
      <span>A barra de prévia do <code>FileImportModal</code> usa <code>border-[#30363d] bg-[#0d1117] text-slate-300</code> — cores de tema escuro cravadas no código, dentro de um modal claro. Está reproduzida fiel no "hoje".</span>
    </div>
  </div>`,
}), MODAL_H)

function abasCom(rotulos, ativo) {
  return `<div style="display: flex; gap: 8px; flex-wrap: wrap">${rotulos.map((t) => `<span class="tab${t === ativo ? ' tab--active' : ''}">${t}</span>`).join('')}</div>`
}
const ABAS_HOJE = ['Vis&atilde;o geral', 'Importa&ccedil;&atilde;o', 'Exporta&ccedil;&atilde;o', 'Escalas &amp; Manifestos', 'ADR']
const ABAS_NOVAS = ['Vis&atilde;o geral', 'Importa&ccedil;&atilde;o', 'Exporta&ccedil;&atilde;o', 'Rotas e Manifestos', 'ADR']

const ROTA_A_H = 640
out('RotasAntes.dc.html', compareBoard({
  height: ROTA_A_H, chip: 'Hoje', chipTone: 'hoje',
  title: 'Aba Escalas &amp; Manifestos &mdash; como est&aacute; hoje',
  note: 'Transcrição fiel de <code>VoyageManifestosTab.tsx</code>. A aba se chama Escalas e não mostra escala nenhuma: cada linha é uma rota POL → POD.',
  body: `<div style="display: flex; flex-direction: column; gap: 18px">${abasCom(ABAS_HOJE, 'Escalas &amp; Manifestos')}${rotasAntes()}</div>`,
}), ROTA_A_H)

const ROTA_D_H = 720
out('RotasDepois.dc.html', compareBoard({
  height: ROTA_D_H, chip: 'Proposta', chipTone: 'proposta',
  title: 'Aba Rotas e Manifestos &mdash; proposta',
  note: 'A aba passa a se chamar pelo que mostra. Mais quatro mudanças: o grupo Mercante reúne a cobertura de CE por B/L e o Nº de manifesto Mercante, cada um nomeado pelo que é; o número faltante vira ação em vez de recado; as larguras do table-fixed são redistribuídas; e entra a faixa de totais das outras abas.',
  body: `<div style="display: flex; flex-direction: column; gap: 18px">${abasCom(ABAS_NOVAS, 'Rotas e Manifestos')}${rotasDepois()}</div>`,
}), ROTA_D_H)

const ADR_A_H = 1180
out('AdrAntes.dc.html', compareBoard({
  height: ADR_A_H, chip: 'Hoje', chipTone: 'hoje',
  title: 'Aba ADR &mdash; como est&aacute; hoje',
  note: 'Transcrição fiel de <code>VoyageAgencyReportTab.tsx</code>. O terminal — que decide o documento inteiro — é um seletor num painel discreto abaixo das escalas. As seções são agrupadas por fase, mas assinadas por departamento, e os dois níveis de assinatura não conversam.',
  body: adrAntes(),
}), ADR_A_H)

const ADR_D_H = 1240
out('AdrDepois.dc.html', compareBoard({
  height: ADR_D_H, chip: 'Proposta', chipTone: 'proposta',
  title: 'Aba ADR &mdash; proposta',
  note: 'O ADR é por terminal, então o terminal sobe para o cabeçalho junto da escala e do estado do documento. As seções passam a ser agrupadas por quem assina, cada grupo com o contador do que falta e o próprio botão de assinar — ligando os dois níveis. Avisos ganham forma, e a hierarquia volta ao vocabulário do resto da página.',
  body: adrDepois(),
}), ADR_D_H)

/* ================================================================== *
 * Não escolhidas — registro das direções descartadas                  *
 * ================================================================== */
const PORT_COLS = ['BRSSZ', 'BRVIX', 'BRPNG', 'BRRIG']
function portCell(value) {
  if (value === 'OMIT') return `<span class="badge badge--red" style="padding: 2px 8px; font-size: 10px; font-weight: 700">OMIT</span>`
  if (value === 'X') return `<span class="dash num">X</span>`
  return `<span class="num" style="font-weight: 600; color: ${T.textStrong}">${value}</span>`
}

const C_H = 960
out('DirecaoC.dc.html', artboard({
  height: C_H,
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
        <thead><tr>
          <th style="width: 26px"></th><th>Navio / Viagem</th><th>Armador</th><th>Rota</th>
          ${PORT_COLS.map((p) => `<th style="text-align: center">${p}</th>`).join('')}
          <th style="text-align: center">+</th><th style="text-align: right">B/L</th>
          <th style="text-align: right">CNTR</th><th style="text-align: center">CE</th><th></th>
        </tr></thead>
        <tbody>
          ${VOYAGES.map((v, i) => `<tr${i === 0 ? ` style="background: ${T.blueSoft}"` : ''}>
            <td>${estadoDot(v.estado, 8)}</td>
            <td style="font-weight: 700; color: ${T.textStrong}">${v.vessel} <span style="color: ${T.muted}">/ ${v.voy}</span></td>
            <td style="font-size: 12px; color: ${T.muted}">${v.carrier}</td>
            <td><span style="display: inline-flex; align-items: center; gap: 6px; font-family: ${T.mono}; font-size: 11px; color: ${T.muted}">${v.pol} ${icon('arrowRight', 12, T.mutedSoft)} <b style="color: ${T.text}">${v.pod}</b></span></td>
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
}), C_H)

const CD_H = 1500
out('DirecaoCDetalhe.dc.html', artboard({
  height: CD_H,
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
      ${transbordoCard()}
      ${planejamentoEscala()}
      ${timeline()}
    </div>
  </div>`,
}), CD_H)

try { rmSync(new URL('./DirecaoA.dc.html', import.meta.url)) } catch { /* já removido */ }
writeFileSync(new URL('./heights.json', import.meta.url), JSON.stringify(HEIGHTS, null, 2) + '\n')

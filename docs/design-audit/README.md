# Auditoria de design — Transhipping Desk (novas implementações)

- **Data:** 2026-07-20
- **Commit base:** `fca90b7`
- **Método:** app real bootada contra stack local (Postgres 16 + `scripts/design-audit/bootstrap.sql` + 216 migrations + seeds sintéticos + dados sintéticos adicionais para os módulos novos + `sb-shim.cjs`), navegada via Playwright em 1440×900 (desktop) e 390×844 (mobile). Screenshots em [`assets/`](assets/). Login `auditor@local.test` (admin).
- **Escopo:** revisão focada nas implementações entradas depois da auditoria de 2026-07-17 ([arquivada](../archive/audits/design-audit-2026-07-17.md)): **aba ADR** no detalhe da viagem (agregação, sign-offs, ocorrências, fechamento com snapshot e impressão), **Ficha BL** (rails + hub de abas), **Ficha do Cliente** (hub de abas), **VAZIOS EXP** (edição inline de dados ADR e operação da escala), **Vazios Importação** (natureza cama/cover plate), **Veículos** (local de desova), **alertas pós-ATD** e **papel Equipamentos**.

Artefatos de ambiente que **não** são bugs do produto: Google Fonts e API PTAX
do BCB bloqueados pelo proxy de egress, websockets realtime falham contra o
shim. Consoles limpos em todas as rotas visitadas (apenas PTAX bloqueado);
nenhuma falha silenciosa de query no log do shim. **Runtime**.

## P0 — encontrado no boot (fora da UI)

| Problema | Evidência | Status |
|---|---|---|
| **Migration 211 (`equipamentos_rbac_hardening`) não aplicava em nenhum Postgres**: na query do `FOR p IN SELECT * FROM pg_policies ...`, as linhas `AND p.permissive = 'PERMISSIVE'` e `p.cmd IN (...)` referenciavam o alias `p` que não existia no SQL — o PL/pgSQL substituía pela record variable ainda não atribuída e abortava (`record "p" is not assigned yet`). | Reproduzido ao aplicar as migrations no stack local (`ON_ERROR_STOP=1`) na data da auditoria. | ✅ **Corrigido** — a query passou a usar `FROM pg_policies AS policy` com `policy.permissive`/`policy.cmd`, chegou ao `main` (PR #409/#410) e foi herdada nesta branch via merge. Migrations 211–220 aplicam limpo no stack local. |

## Corrigido nesta auditoria

| # | Problema | Eixo | Fix | Evidência |
|---|---|---|---|---|
| 1 | **`/veiculos`: "Local de desova" nunca salvava.** O `onBlur` comparava o valor do campo com `unpackingLocations[id] ?? persisted`, mas o `onChange` já tinha gravado o draft com o mesmo texto digitado — a guarda de no-op sempre disparava e o update jamais ia ao banco. Sem toast, sem erro: o usuário via o texto no campo e perdia o dado no reload (e o ADR seguia mostrando "local de desova não informado"). | Confiança | Call site passa o valor persistido (`row.container.unpacking_location`) como base de comparação (`src/pages/Veiculos.tsx`). Verificado em runtime: valor persiste em `bl_containers.unpacking_location` após blur. | [`veiculos-desova-fixed.png`](assets/veiculos-desova-fixed.png) |
| 2 | Ficha BL, card Financeiro exibia os enums crus `ready_for_billing` / `invoiced`. | Entendimento | Reuso de `resolveChargeStatusLabel` + `FINANCIAL_STATUS_LABELS` (`src/components/bl/BlVisaoGeralTab.tsx`). | antes [`ficha-bl-desktop.png`](assets/ficha-bl-desktop.png) · depois [`ficha-bl-desktop-fixed.png`](assets/ficha-bl-desktop-fixed.png) |
| 3 | Rails da Ficha BL sem acento ("PROXIMA ACAO", "SAIDA DO POL", "DEVOLUCAO", "REVISAO & CLIENTE", "Sem previsao", "Nao emitida") e status de fatura em inglês ("#201 issued"). | Confiança | Copy + `INVOICE_STATUS_LABELS` em `src/services/blRails.ts` e `src/components/bl/BlRailsPipeline.tsx` ("#201 Emitida"). Também "Baplie não importado", "divergência(s)", "Saída do POL" e "Máquinas" em `BlVisaoGeralTab`. | [`ficha-bl-desktop-fixed.png`](assets/ficha-bl-desktop-fixed.png) |
| 4 | Alertas pós-ATD do ADR renderizavam o tipo cru `agency_report_section_pending`, entidade `agency_departure_report` sem label e **sem ação de navegação** (todos os outros tipos têm "Ver Fatura"/"Abrir B/L"). | Entendimento / Conversão | `TYPE_LABELS` + `ENTITY_TYPE_LABELS` + deep-link "Abrir Viagem" parseando o `entity_id` (`voyageId::porto::secao`) em `src/pages/Alertas.tsx`. | antes [`alertas-adr-pendentes.png`](assets/alertas-adr-pendentes.png) · depois [`alertas-adr-fixed.png`](assets/alertas-adr-fixed.png) |
| 5 | `/admin/usuarios`: a legenda "Descrição dos perfis de acesso" não incluía o novo papel **Equipamentos** (presente no dropdown desde a migration 210) — quem atribui o papel não sabia o que ele concede. | Entendimento | Linha descrevendo o escopo (leitura geral + escrita em Vazios EXP/Veículos + sign-off ADR) em `src/pages/AdminUsuarios.tsx`. | antes [`admin-usuarios.png`](assets/admin-usuarios.png) · depois [`admin-usuarios-fixed.png`](assets/admin-usuarios-fixed.png) |
| 6 | VAZIOS EXP: hint de autosave dizia "Salvamento no blur" (jargão de dev) e os 5 checkboxes do editor inline exibiam o texto fixo "Marcado" mesmo desmarcados. | Entendimento | "Salva automaticamente ao sair do campo" + texto dinâmico Sim/Não (`src/pages/EmbarqueVazios.tsx`). | antes [`vazios-exp-expandido.png`](assets/vazios-exp-expandido.png) · depois [`vazios-exp-expandido-fixed.png`](assets/vazios-exp-expandido-fixed.png) |
| 7 | Aba ADR: "1 BLs · 3 VINs" (plural errado) e botão "Fechar ADR" desabilitado sem nenhuma explicação do que falta. | Entendimento | Pluralização correta + `title` no botão ("Confirme as 7 seções…") em `src/components/voyages/VoyageAgencyReportTab.tsx`. | [`viagem-adr-tab.png`](assets/viagem-adr-tab.png) |
| 8 | Ficha do Cliente: recebíveis com status crus `open`/`partially_settled` na mesma tela em que invoices aparecem traduzidas; atividade recente com enum cru "Portal: aguardando_analise"; pendências com plural "(s)" ("1 invoice(s) vencida(s)"); "Email de Recuperação" com "Não informado" duplicado. | Confiança | Label map de recebíveis (`FinanceiroTab`), reuso de `provisioningDecisionLabel`/`accountSituationLabel` na timeline (`customerFicha.ts`), pluralização real das pendências (`VisaoGeralTab`) e supressão da linha de origem vazia (`CadastroContatosTab`). | antes [`ficha-cliente-visao-geral.png`](assets/ficha-cliente-visao-geral.png), [`ficha-cliente-financeiro.png`](assets/ficha-cliente-financeiro.png) · depois [`ficha-cliente-visao-geral-fixed.png`](assets/ficha-cliente-visao-geral-fixed.png), [`ficha-cliente-financeiro-fixed.png`](assets/ficha-cliente-financeiro-fixed.png) |

Verificação após os fixes: `npx tsc -b`, `npm run lint`, `npm test`
(1243 passed), `npm run docs:check`, `npm run build` — todos verdes; telas
re-verificadas em runtime (evidência "depois" acima), incluindo o persist do
local de desova no banco. **Runtime**.

## Pendências priorizadas

### P1 — mina a confiança no fluxo core

| Problema | Eixo | Status |
|---|---|---|
| ~~Ficha do Cliente: "Saldo pendente (local + demurrage) R$ 0,00" para cliente devendo R$ 3.315.~~ | Confiança | ✅ **Corrigido** (2026-07-21). `buildConsolidatedBalance` agora soma `issued` + `overdue` + `partially_paid`, alinhado à definição de "Saldo Pendente do Cliente" em `CONTEXT.md`. |
| ~~ADR fechado/impresso é ilegível para o destinatário.~~ | Conversão | ✅ **Corrigido** no `main` (PR #409, antes deste plano) — `AgencyReportDocument` foi reescrito com layout próprio por seção. |
| ~~Mensagem dos alertas pós-ATD vem do banco com chave crua e sem acento.~~ | Entendimento | ✅ **Corrigido** (2026-07-21). Migration 219 reescreve `detect_agency_report_pending()` com labels pt-BR e nomeia o departamento dono, com backfill dos alertas abertos; a coluna Entidade é formatada no cliente ("Viagem 10 · BRVIX · Ocorrências"). |

### P2 — atrito moderado

| Problema | Eixo | Status |
|---|---|---|
| ~~Aba ADR: sign-offs não mostram quem confirmou nem quando; ocorrências assinam com o papel em vez do nome.~~ | Confiança | ✅ **Corrigido** (2026-07-21). RPC `get_agency_report_actor_names` (migration 220) + atribuição inline "Confirmado por {nome} em {data}" nas 7 seções e "{nome} ({departamento})" nas ocorrências. |
| Aba ADR: chip de estado ("Pendente"/"Confirmado") e botões de ação têm o mesmo peso visual — parece um grupo de 3 botões; "Fechar ADR" fecha com um clique, sem confirmação (reversível via "Reabrir", mas congela e é o gatilho de impressão). | Entendimento | Em aberto. Segmented control com estado ativo destacado; diálogo de confirmação leve no fechamento. |
| ~~VAZIOS EXP: "Serviços de reorganização" mostra "Sem tarifa" em todas as linhas e não existe UI para cadastrar `vazios_reorg_rates`.~~ | Conversão | ✅ **Corrigido** (2026-07-21). Página `/embarquevazios/taxas` (padrão `/granito/taxas`, admin-only); "Sem tarifa" agora é link para lá. |
| ~~VAZIOS EXP: o card "Operação da escala" só aparece depois de filtrar por viagem — invisível no primeiro uso.~~ | Conversão | ✅ **Corrigido** (2026-07-21). Card sempre visível, com `VoyageCombobox` embutido quando não há viagem selecionada. |
| ~~`/veiculos`: sem atribuição de local de desova em massa.~~ | Conversão | ✅ **Corrigido** (2026-07-21). Ação "Definir local de desova" na barra de seleção, aplicando aos containers das linhas selecionadas. |
| Aba ADR: "Container com veículo — local de desova não informado" não linka para `/veiculos`, onde o dado é preenchido. | Conversão | Em aberto. Link direto para `/veiculos` com a viagem pré-selecionada. |
| ~~Ficha BL, aba Faturamento: chips "PRONTO PARA FATURAR" convivem com "Este B/L já foi faturado…" e fatura ativa — sinais de estado conflitantes.~~ | Entendimento | ✅ **Corrigido** (2026-07-21). Com fatura ativa, o chip de fase mostra "Faturado" e os CTAs "Marcar revisado"/"Pronto para faturar" somem. |
| ~~Copy sem acento remanescente na Ficha BL/Faturamento.~~ | Confiança | ✅ **Corrigido parcialmente** (2026-07-21): "Motor Etapa A: cálculo automático…", "Este B/L já foi faturado. As taxas estão bloqueadas para edição…". "Razão social", "OBSERVAÇÃO", "DATA/LOCAL DE EMISSÃO", "TELEFONE DO CONSIGNATÁRIO" e "Conciliação: MATCH CNPJ" seguem em aberto (fora do escopo deste plano). |

### P3 — polimento

| Problema | Eixo | Status |
|---|---|---|
| Peso total `48500` / CBM `112.5` sem formatação pt-BR na Ficha BL (herdado da auditoria anterior). | Confiança | Em aberto. |
| ~~TARA `3800` sem formatação pt-BR em `/vazios-importacao`.~~ | Confiança | ✅ **Corrigido** (2026-07-21): `Number(tare_kg).toLocaleString('pt-BR')`. |
| ~~Cabeçalho da aba ADR: grid aperta "Navio / viagem" em 3 linhas.~~ | Entendimento | ✅ **Corrigido** (2026-07-21): grid ganhou o degrau `lg:grid-cols-3` antes do `2xl:grid-cols-4`. |
| ~~Seção "Embarque de vazios" do ADR mostra cards zerados de Serviço extra/Storage/Overtime mesmo com "Nenhum dado informado".~~ | Entendimento | ✅ **Corrigido** (2026-07-21): cards só renderizam quando há bookings ou operação cadastrada. |
| ~~Mobile: setas "→" dos rails da Ficha BL quebram sozinhas no início da linha.~~ | Entendimento | ✅ **Corrigido** (2026-07-21): setas ocultas abaixo do breakpoint `sm`. |
| Ficha Cliente, aba Operacional: coluna "Financeiro: Pago" convive com recebível em aberto do mesmo B/L na aba Financeiro (dado sintético inconsistente no seed; em produção triggers mantêm). **Suspeita**. | Confiança | Em aberto. Se ocorrer em produção, derivar o status exibido dos recebíveis em vez de `bls.financial_status`. |
| Datas `mm/dd/yyyy` nos inputs nativos com navegador em locale EN (herdado, aceito para uso interno). | Confiança | Sem ação; reavaliar se incomodar. |

## Resumo por dimensão (módulos novos)

| Dimensão | Avaliação |
|---|---|
| Primeira impressão | Boa. Os hubs (Ficha BL, Ficha Cliente) organizam muita informação com hierarquia clara; a aba ADR é densa mas navegável. |
| Navegação | Boa. Rails clicáveis na Ficha BL levam à viagem/faturamento; pendências da Ficha Cliente são acionáveis. Lacunas de deep-link (ADR→veículos) anotadas em P2. |
| Hierarquia visual | Boa nos hubs; cabeçalho do ADR e o trio chip+botões dos sign-offs precisam de polimento (P2/P3). |
| Consistência de componentes | Boa base (Badges, Cards, tabelas compartilhadas), mas os módulos novos estrearam com enums crus onde o resto do app traduz — o `statusLabels.ts` existe e não estava sendo usado (corrigido nesta auditoria). |
| Loading/empty/error | Muito boa. Empty states orientados a ação em VAZIOS EXP/IMP e Veículos; "Somente leitura" para papéis sem escrita. |
| Sinais de confiança | O ponto fraco desta leva: bug real de persistência (desova), saldo "R$ 0,00" enganoso, snapshot de ADR ilegível, sign-off sem atribuição. Dois dos quatro corrigidos/encaminhados aqui. |
| Caminho de conversão | O fluxo ADR (confirmar 7 seções → fechar → imprimir) completa de ponta a ponta, mas o produto final (documento impresso) não está à altura do fluxo que o gera (P1). |

## Top 5 — impacto em conversão

1. ~~Deploy travado pela migration 211~~ — **corrigido** no `main` antes deste plano.
2. ~~Documento ADR fechado/impresso ilegível~~ — **corrigido** no `main` (PR #409).
3. ~~Saldo pendente R$ 0,00 com dívida em aberto na Ficha Cliente~~ — **corrigido**.
4. ~~Local de desova nunca salvava~~ — **corrigido** (alimenta diretamente o bloco de veículos do ADR).
5. ~~Tarifas de reorganização sem UI de cadastro~~ — **corrigido** (`/embarquevazios/taxas`).

Todos os itens do top 5 de 2026-07-20 estão resolvidos. Restam do P2/P3: segmented control dos sign-offs, deep-link ADR→Veículos, e a passada de copy remanescente na Ficha BL (Detalhes do B/L).

## Top 5 — quick wins

1. ~~Enums crus (`ready_for_billing`, `open`, `aguardando_analise`, tipo de alerta ADR)~~ — **corrigidos** com os label maps que já existiam.
2. ~~Acentos e inglês nos rails da Ficha BL~~ — **corrigidos**.
3. ~~Legenda do papel Equipamentos~~ — **corrigida**.
4. ~~Mensagem legível nos alertas pós-ATD~~ — **corrigida** (migration 219).
5. ~~"Confirmado por {nome} em {data}" nos sign-offs do ADR~~ — **corrigido** (migration 220).

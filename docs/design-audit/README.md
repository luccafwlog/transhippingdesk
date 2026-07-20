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
| **Migration 211 (`equipamentos_rbac_hardening`) não aplica em nenhum Postgres**: na query do `FOR p IN SELECT * FROM pg_policies ...`, as linhas `AND p.permissive = 'PERMISSIVE'` e `p.cmd IN (...)` referenciam o alias `p` que não existe no SQL — o PL/pgSQL substitui pela record variable ainda não atribuída e aborta (`record "p" is not assigned yet`). Produção está com migrations aplicadas **só até a 210** (verificado via Supabase), então o próximo deploy falha na 211 e **bloqueia 212–216** — exatamente as migrations que criam as tabelas do ADR (213/214) e a RPC de recebíveis da Ficha do Cliente (216). Sem elas, nada do escopo desta auditoria funciona em produção. | Reproduzido ao aplicar as migrations no stack local (`ON_ERROR_STOP=1`); auditoria continuou com cópia corrigida aplicada apenas localmente. | **Correção em andamento por outro agente** (informado pelo usuário durante a auditoria). Registrado aqui apenas como evidência. |

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

| Problema | Eixo | Recomendação |
|---|---|---|
| **Ficha do Cliente: "Saldo pendente (local + demurrage) R$ 0,00" para cliente devendo R$ 3.315.** `buildConsolidatedBalance` soma só invoices `issued`; `overdue` e `partially_paid` ficam de fora (comentário no código admite o legado). Com esse título, o card afirma que o cliente não deve nada — contradizendo as próprias Pendências ("1 invoice vencida") três dedos abaixo ([`ficha-cliente-visao-geral.png`](assets/ficha-cliente-visao-geral.png)). | Confiança | Somar o `balance_brl` dos recebíveis `open`/`partially_settled` (a RPC `get_customer_receivables` já devolve exatamente isso) ou, no mínimo, renomear o card e expor "Vencidas" em separado. Decisão de produto sobre o que conta como "pendente" — por isso não corrigido on-the-spot. |
| **ADR fechado/impresso é ilegível para o destinatário.** `AgencyReportDocument` serializa o snapshot genericamente: seções viram "rows: — · totals: —", "operation: — · storage: days: 0 · containers: 0", e "Container com veículo" vira "2 registro(s)" — perdendo marcas, VINs e locais de desova que a aba viva mostra ([`viagem-adr-fechado.png`](assets/viagem-adr-fechado.png)). Este é o documento que vai para o armador — o deliverable do módulo. | Conversão | Renderizar cada seção do snapshot com layout próprio (tabelas reais de matriz de descarga, veículos por marca/VIN, vazios embarcados), não um dumper de chaves JSON. |
| Mensagem dos alertas pós-ATD vem do banco com chave crua e sem acento: `ADR BRVIX: secao "vazios_embarcados" pendente (equipamentos).`; a coluna Entidade ainda mostra `10::BRVIX::ocorrencias` ([`alertas-adr-fixed.png`](assets/alertas-adr-fixed.png)). | Entendimento | Migration follow-up em `detect_agency_report_pending()` gerando mensagem legível ("ADR BRVIX: seção Vazios embarcados pendente — Equipamentos"), ou formatar no cliente mapeando as 7 chaves de seção. |

### P2 — atrito moderado

| Problema | Eixo | Recomendação |
|---|---|---|
| Aba ADR: sign-offs não mostram **quem confirmou nem quando**, apesar de `signed_by`/`signed_at` estarem no banco; o diário de ocorrências assina com o papel em código ("administrativo · 20/07/2026") em vez do nome do usuário. Para um relatório departamental com sign-off, a atribuição é o ponto ([`viagem-adr-tab.png`](assets/viagem-adr-tab.png)). | Confiança | Exibir "Confirmado por {nome} em {data}" no chip/tooltip de cada seção e nome (não papel) nas ocorrências. |
| Aba ADR: chip de estado ("Pendente"/"Confirmado") e botões de ação têm o mesmo peso visual (diferem só em `rounded-full` vs `rounded`) — parece um grupo de 3 botões; "Fechar ADR" fecha com um clique, sem confirmação (reversível via "Reabrir", mas congela e é o gatilho de impressão). | Entendimento | Segmented control com estado ativo destacado; diálogo de confirmação leve no fechamento. |
| VAZIOS EXP: "Serviços de reorganização" mostra "Sem tarifa" em todas as linhas e **não existe UI para cadastrar `vazios_reorg_rates`** (só leitura no código) — beco sem saída permanente ([`vazios-exp-operacao-escala.png`](assets/vazios-exp-operacao-escala.png)). | Conversão | Tela/tabela de tarifas de reorganização (padrão `/granito/taxas`) ou pelo menos hint de onde cadastrar. |
| VAZIOS EXP: o card "Operação da escala" (OS, overtime, serviços) só aparece depois de filtrar por viagem dentro de "Filtros" — a feature principal do módulo fica invisível no primeiro uso. | Conversão | Seletor de viagem/escala promovido para fora do colapso de filtros, ou empty-state apontando o caminho. |
| `/veiculos`: sem atribuição de local de desova em massa — a barra de seleção só oferece "Excluir selecionados"; num navio real são centenas de veículos digitados um a um (o campo já aplica por container, mas nada além disso). | Conversão | Ação em massa "Definir local de desova" para a seleção. |
| Aba ADR: "Container com veículo — local de desova não informado" não linka para `/veiculos`, onde o dado é preenchido; o usuário precisa adivinhar o caminho. | Conversão | Link direto para `/veiculos` com a viagem pré-selecionada. |
| Ficha BL, aba Faturamento: chips "PRONTO PARA FATURAR" + "SUBTOTAL R$ 0,00" + tabela "Nenhuma taxa calculada" convivem com "Este B/L já foi faturado…" e fatura ativa — três sinais de estado conflitantes na mesma tela ([`ficha-bl-faturamento.png`](assets/ficha-bl-faturamento.png)). Parcialmente artefato do seed, mas o chip de fase deveria refletir "Faturado". | Entendimento | Quando existe fatura ativa, o chip de fase das taxas deve dizer "Faturado" e esconder o CTA "Pronto para faturar". |
| Copy sem acento remanescente na Ficha BL/Faturamento: "Motor Etapa A: calculo automatico…", "Este B/L ja foi faturado. As taxas estao bloqueadas para edicao", "Razao social", "OBSERVACAO", "DATA/LOCAL DE EMISSAO", "TELEFONE DO CONSIGNATARIO"; e "Conciliação: MATCH CNPJ" em código. | Confiança | Passada de copy nos componentes de Taxas/Faturamento da Ficha BL (mesmo tratamento aplicado aos rails). |

### P3 — polimento

| Problema | Eixo | Recomendação |
|---|---|---|
| Números sem formatação pt-BR em campos de exibição: Peso total `48500` / CBM `112.5` na Ficha BL (herdado da auditoria anterior), TARA `3800` em `/vazios-importacao` ([`vazios-importacao-dados.png`](assets/vazios-importacao-dados.png)). | Confiança | `Intl.NumberFormat('pt-BR')` na exibição, mantendo edição raw. |
| Cabeçalho da aba ADR: grid aperta "Navio / viagem" em 3 linhas; campos read-only e o único editável (Terminal) têm o mesmo tratamento visual ([`viagem-adr-tab.png`](assets/viagem-adr-tab.png)). | Entendimento | Grid com min-width por célula; input com affordance distinta dos fatos read-only. |
| Seção "Embarque de vazios" do ADR diz "Nenhum dado informado" e logo abaixo mostra cards Serviço extra/Storage/Overtime com zeros — contraditório quando tudo é zero. | Entendimento | Suprimir os cards zerados junto com o empty state. |
| Mobile: setas "→" dos rails da Ficha BL quebram sozinhas no início da linha ([`ficha-bl-mobile.png`](assets/ficha-bl-mobile.png)). | Entendimento | Esconder as setas quando o rail quebra (media query). |
| Ficha Cliente, aba Operacional: coluna "Financeiro: Pago" convive com recebível em aberto do mesmo B/L na aba Financeiro (dado sintético inconsistente no seed; em produção triggers mantêm). **Suspeita** ([`ficha-cliente-operacional.png`](assets/ficha-cliente-operacional.png)). | Confiança | Se ocorrer em produção, derivar o status exibido dos recebíveis em vez de `bls.financial_status`. |
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

1. **Deploy travado pela migration 211** (P0, correção em andamento por outro agente) — sem ela nenhum módulo novo existe em produção.
2. **Documento ADR fechado/impresso ilegível** (P1) — o deliverable do módulo ADR não serve para envio ao armador.
3. **Saldo pendente R$ 0,00 com dívida em aberto na Ficha Cliente** (P1) — decisão errada de cobrança à primeira vista.
4. ~~Local de desova nunca salvava~~ — **corrigido** (alimenta diretamente o bloco de veículos do ADR).
5. Tarifas de reorganização sem UI de cadastro (P2) — a operação da escala nunca produz valores.

## Top 5 — quick wins

1. ~~Enums crus (`ready_for_billing`, `open`, `aguardando_analise`, tipo de alerta ADR)~~ — **corrigidos** com os label maps que já existiam.
2. ~~Acentos e inglês nos rails da Ficha BL~~ — **corrigidos**.
3. ~~Legenda do papel Equipamentos~~ — **corrigida**.
4. Mensagem legível nos alertas pós-ATD (migration de uma função).
5. "Confirmado por {nome} em {data}" nos sign-offs do ADR (dado já existe no banco).

# B/L — Cockpit 360° da ficha (design)

**Data:** 2026-07-18
**Status:** Aprovado em sessão grill-me-with-docs (usuário confirmou o entendimento)
**Tela:** `src/pages/BlDetalhe.tsx` + `src/components/bl/*` (detalhe de B/L)
**Plano derivado:** `docs/archive/plans/2026-07-18-bl-cockpit-360.md`

## Problema

A ficha do B/L (3 abas pós-redesenho de 2026-06-19) é primariamente uma tela de
edição. Informações que o sistema já possui não aparecem nela:

1. **Viagem:** "Armador / Navio / Viagem" é um input desabilitado — sem link
   para `/viagens/:voyageId`, sem ETA/ATA da escala do POD, sem ATD do POL.
2. **Transbordo/Omissão/COD:** o Portal do Cliente mostra o card de transbordo
   por B/L; a ficha interna não mostra nada. A ação de disposição vive na
   ficha da Viagem (`TransshipmentPanel`).
3. **Frete & Despesas do BL** (`bl_freight_lines`): importado e fonte do C5 do
   EDI, mas invisível na ficha.
4. **Conciliação Baplie:** divergências de existência dos containers do B/L não
   aparecem na ficha.
5. **Portal:** nada indica se o cliente vê o B/L, nem notificações/disputas.
6. **Pipeline:** os 4 cards apontam para páginas genéricas sem escopo no B/L.
7. **Parser descarta campos** do documento (Place of Receipt, Movement From/To,
   Issue Place) e campos persistidos ficaram fora da UI (data de emissão,
   Place of Delivery, Notify 2, telefone do consignatário).

## Decisões (todas confirmadas pelo usuário)

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Papel da ficha | **Cockpit 360°** — ponto central de consulta do B/L, mantendo a edição auditada |
| 2 | Lacunas em escopo | Todas: Viagem, Transbordo/COD, Frete & Despesas, Baplie, Portal |
| 3 | Estrutura de abas | **Visão Geral (nova, padrão) + Detalhes + Faturamento + Histórico** |
| 4 | Pipeline | **Dois trilhos + próxima ação** (substitui `BLPipeline`) |
| 5 | Trilho operacional | Saída do POL (ETD→ATD/Laden on Board) → Chegada ao POD (ETA→ATA; desvio p/ Transbordo/COD em omissão) → Descarga x/n → Devolução x/n |
| 6 | Trilho financeiro | CE Mercante → Revisão & Cliente → Taxas Locais → Fatura → Pagamento (+ estágio de Invoice de Demurrage quando existir) |
| 7 | Próxima ação | Primeiro estágio pendente do trilho financeiro, com link escopado |
| 8 | Ação de COD | **Movida da Viagem para a ficha do B/L (único lugar de escrita)**; a Viagem mantém só a edição do registro global da omissão e lista os B/Ls afetados como leitura com link |
| 9 | Aba Detalhes | **Réplica do documento B/L em campos mapeados** (Partes → Rota → Datas → Carga → Containers → Frete & Despesas), edição inline auditada via `save_bl_review` |
| 10 | Persistência | Place of Receipt, Movement From/To e Issue Place passam a ser persistidos **forward-only** (sem backfill); Place of Delivery, emissão, Notify 2 e telefone voltam à UI |
| 11 | Parser | Inventário atual basta; nenhum campo novo de extração |
| 12 | Bloco Portal | Visibilidade do B/L + notificações + disputas de demurrage |
| 13 | Escopo BB | Mesma estrutura; blocos exclusivos de container degradam (não aparecem) |
| 14 | Entrega | Série de 5 PRs incrementais a partir de um plano único |

## Visão Geral (aba padrão) — blocos

- **Viagem & Escala:** armador/navio/viagem com link para `/viagens/:voyageId`;
  ETD/ATD do POL; ETA/ATA/estado da escala do POD deste B/L (fonte:
  `voyageRouteSchedules`).
- **Transbordo / COD** (condicional): dados globais herdados da omissão
  (leitura, com link para a Viagem) + ação de disposição transshipment/cod.
- **Carga + Baplie:** resumo físico (containers distintos, IMO/OOG, peso/CBM ou
  resumo BB) + divergências de existência Baplie pendentes deste B/L com link
  para `/baplie?voyage=<id>`.
- **Cliente & Portal:** cliente vinculado/reconciliação; visibilidade no Portal
  (CE Mercante presente + `customer_portal_accounts.account_situation = 'ativo'`,
  com motivo do bloqueio); notificações do B/L; disputas de demurrage.
- **Financeiro:** taxas locais, fatura ativa, demurrage — resumo com links.

## Fora de escopo

- Backfill de campos documentais em B/Ls históricos (mostram "—" até reimporte).
- Novos campos de extração no parser COSCO.
- Mudanças nas abas Faturamento e Histórico (permanecem como estão).
- Navegação/breadcrumb de volta (mantém `/manifestos` ↔ `/carga-solta`).

## Glossário afetado

- `CONTEXT.md` ganha o termo **Visão Geral do B/L** e nota em **Transbordo**
  de que a disposição individual é operada na ficha do B/L (o registro global
  permanece na Viagem) — alinha o código ao que o glossário já descrevia.

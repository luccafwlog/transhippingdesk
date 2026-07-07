# Design Audit Remediation — Implementation Plan

> Plano/snapshot de decisão, não verdade corrente. A autoridade executável é o
> código. Base de decisão: auditoria de design full-site
> [design-audit/2026-07-06-auditoria.md](../design-audit/2026-07-06-auditoria.md)
> (2026-07-06). Este plano consolida os achados **não corrigidos** daquela
> auditoria em fatias revisáveis. As correções seguras de copy/CSS/formatação
> já foram aplicadas na PR #326 e não reaparecem aqui.

> **Nota editorial (2026-07-07):** todas as fatias abaixo foram executadas.
> Slices 1, 3, 4 e 5 chegaram num commit anterior à segunda auditoria de
> design ("Apply remaining codex remediation changes"); a Slice 2 foi
> reavaliada e aceita como não-bug após validação visual na resolução real da
> TV. Verificação linha a linha contra `main` e evidências por item na seção
> [Status final](#status-final-2026-07-07) ao fim deste documento. Este plano
> permanece como registro histórico da decisão — não reabrir itens aqui sem
> nova auditoria.

**Goal:** Fechar os achados de confiança e entendimento que a auditoria de
design deixou como recomendação por tocarem áreas protegidas (RPC/migração,
layout calibrado para hardware) ou por exigirem decisão de produto — sem alterar
semântica de dinheiro ou dados fora do que cada fatia declara.

**Architecture:** As fatias 1–2 tocam migrações/RPC de alertas (área protegida —
seguem `docs/WORKFLOW.md` para migração e `supabase-migration`/`no-mistakes`); as
demais são UI (`pages → hooks → services`). Nenhuma mexe em `src/lib/pix.ts`,
fluxo de exclusão ou RLS. As fatias são independentes e mergeáveis
separadamente; a ordem prioriza impacto em conversão/confiança por esforço.

**Tech Stack:** TypeScript, Vitest, React (TanStack Query), Supabase (Postgres +
RPC + migrações versionadas).

**Fontes de verdade:** `CONTEXT.md` · `docs/ARCHITECTURE.md` ·
`docs/CONVENCOES.md` · `docs/WORKFLOW.md` ·
[auditoria de design 2026-07-06](../design-audit/2026-07-06-auditoria.md).

---

## Prioridades da auditoria

| # | Achado | Severidade | Eixo | Fatia |
|---|--------|-----------|------|-------|
| D1 | Alerta de fatura vencida gerado pelo banco em inglês + formato US (`"Invoice … R$ 1,510.00"`) — migrações 024/151 | P1 | Confiança | Slice 1 |
| D2 | `alerts.entity_id` inconsistente: ora id interno (`invoice / 205`), ora número de documento (`invoice / FAT-2026-0016`) | P1 | Entendimento/Confiança | Slice 1 |
| D3 | Painel TV (`/line-up-tv/display`): colunas VOY/POD colidem e nome do navio corta nas duas pontas | P1 | Entendimento | Slice 2 |
| D4 | Formato USD inconsistente: Demurrage `$ 1.200,00` (pt-BR) vs Tarifas `$ 50.00` (US) | P2 | Confiança | Slice 3 |
| D5 | Carga Solta com headers de KPI/tabela em inglês (`WEIGHT (TON)`, `PACKAGES TOTAL`) | P2 | Entendimento | Slice 3 |
| D6 | Lixeira de excluir cliente exposta na linha com o mesmo peso das ações neutras | P2 | Confiança | Slice 4 |
| D7 | Admin/Usuários: papel exibido como chip "ADMIN (LEGADO)" ao lado de select com valor diferente | P2 | Entendimento | Slice 4 |
| D8 | Mobile `/manifestos`: coluna sticky de Ações cobre CE Mercante sem affordance de scroll | P2 | Entendimento | Slice 4 |
| D9 | Revisão BB: campo "Peso BB (ton)" + Salvar inline sem label do que se salva | P2 | Entendimento | Slice 4 |
| D10 | Granito/Taxas: descrição vaza jargão `real_weight_kg` | P2 | Entendimento | Slice 3 |
| D11 | Chips sem legenda/pluralização ("PRONTO 2", "6 ATIVA(S)"); ano 2 dígitos em Admin; saldo em fatura CANCELADA; logo do portal não renderiza; guard de `supabase_realtime` na migração 124 | P3 | Vários | Slice 5 |

---

## Slice 1 — Alertas financeiros: idioma, formato e entidade (D1, D2)

Maior impacto em confiança: o alerta de vencida é o gatilho de cobrança e hoje
sai em inglês com número em formato US. **Área protegida (RPC/migração):** seguir
`docs/WORKFLOW.md`, skill `supabase-migration`, e validar com `no-mistakes`.

- [x] **Idioma + formato pt-BR do alerta (D1).** ✅ `supabase/migrations/168_overdue_invoice_alerts_ptbr_entity.sql`
  reescreve `detect_overdue_invoices()` com literal `Fatura` e formatação
  pt-BR (agrupamento manual de milhar + vírgula decimal). Verificado em tela:
  "Fatura FAT-2026-0014 venceu em 26/06/2026 — saldo pendente: R$ 1.510,00".
- [x] **Padronizar `entity_id` (D2).** ✅ Mesma migração 168 faz `UPDATE` dos
  alertas existentes para `invoice_number` e a função passa a gravar
  `v_invoice_entity_id := COALESCE(v_row.invoice_number, v_row.id::text)`.
  Verificado em tela: coluna Entidade mostra `invoice FAT-2026-0014`.
- [x] Documentação viva — `npm run docs:check` verde em `main`.

## Slice 2 — Painel TV: colisão de colunas e corte do navio (D3)

Layout calibrado para o monitor real da operação (1920×1080) — **validar in
loco antes de mergear.** Só UI/CSS.

- [x] ✅ Reavaliado em 1920×1080 real (`docs/design-audit/assets/v2-line-up-tv-1920.png`,
  auditoria 2026-07-07): VOY, POD e nome do navio legíveis sem colisão na
  resolução alvo. O corte só aparece em 1440px, fora do uso real do painel —
  aceito como P3, sem alteração de código.

## Slice 3 — Consistência de formato e idioma (D4, D5, D10)

Quick wins de confiança/entendimento. Só display.

- [x] **`formatUSD` canônico (D4).** ✅ `formatUSD` em `src/lib/utils.ts`,
  usado em `DemurrageRates.tsx` (e já era o padrão em `Demurrage.tsx`).
- [x] **Headers de Carga Solta (D5).** ✅ `CargaSolta.tsx` usa "Total de
  volumes" e "Peso (ton)" nos KPIs e no header da tabela.
- [x] **Jargão no Granito/Taxas (D10).** ✅ `real_weight_kg` não aparece mais
  em `GraniteRates.tsx`.

## Slice 4 — Ações destrutivas, papéis e mobile (D6, D7, D8, D9)

- [x] **Exclusão de cliente (D6).** ✅ `Clientes.tsx` move "Excluir cliente"
  para dentro do menu flutuante "…" (`role="menuitem"`,
  `app-floating-menu__danger`); a lixeira solta na linha some da lista.
- [x] **Papel em Admin (D7).** ✅ Sem ocorrência de "LEGADO" em
  `AdminUsuarios.tsx`; só o select aparece na linha.
- [x] **Sticky no mobile (D8).** ✅ `.app-table--sticky-actions` em
  `src/index.css` ganhou `content: "Deslize para ver mais"` como affordance.
- [x] **Label do peso BB (D9).** ✅ Implementado em
  `src/components/review/ReviewGroupBlock.tsx` (não em `Revisao.tsx` como
  o plano supunha — o campo vive no componente de grupo de revisão):
  "Informar peso BB para liberar cálculo".

## Slice 5 — Polimento P3 (D11)

Oportunístico, item a item:

- [x] Pluralização mecânica em `TaxasLocais.tsx` (`6 ATIVA(S)` etc.) — ✅
  removida, chips mostram plural natural ("6 ATIVAS"). Em `Clientes.tsx` os
  chips "Pend 2"/"Pronto 2" continuam sem `title`/tooltip explicando a
  contagem — remanescente menor, não mecânico; ver nota em
  [Status final](#status-final-2026-07-07).
- [x] Ano de 4 dígitos em "Criado em" no Admin — ✅
  `AdminUsuarios.tsx` usa `Intl.DateTimeFormat('pt-BR', { year: 'numeric', ... })`.
- [x] Não exibir saldo cobrável em fatura CANCELADA — ✅
  `InvoicesTable.tsx` só renderiza o saldo quando `invoice.status !== 'cancelled'`.
- [x] Logo do portal que não renderiza — ✅ corrigido na PR #335 (auditoria
  2026-07-07): `.app-auth__logo` herdava `filter: invert(1)` calibrado para o
  painel navy do login interno; nas telas do portal (card claro) isso
  produzia branco-sobre-branco. Modificador `.app-auth__logo--on-light` sem
  filtro em `PortalLogin.tsx`, `PortalForgotPassword.tsx`,
  `PortalResetPassword.tsx`.
- [x] `create publication if not exists supabase_realtime` como guard na
  `124_vessel_schedules.sql` — ✅ presente (`IF NOT EXISTS (SELECT 1 FROM
  pg_publication WHERE pubname = 'supabase_realtime')`).

---

## Ordem de ataque recomendada

1. **Slice 1** (D1, D2) — maior ganho de confiança; agrupar numa migração só.
2. **Slice 3** (D4, D5, D10) — quick wins de display, sem risco.
3. **Slice 4** (D6–D9) — UX de ações e mobile.
4. **Slice 2** (D3) — depende de validação no monitor da operação.
5. **Slice 5** (D11) — polimento conforme cada página for tocada.

---

## Status final (2026-07-07)

Todas as 5 fatias foram fechadas. Verificação linha a linha contra `main`
(commit `a894c5d`) feita a partir de uma pergunta do usuário sobre se este
plano era o mesmo trabalho da auditoria de 2026-07-07 — não era: as Slices
1, 3, 4 e 5 já estavam resolvidas num commit anterior ("Apply remaining
codex remediation changes", fora desta sessão); a Slice 2 foi reavaliada e
aceita como não-bug na resolução real; o item do logo do portal (dentro da
Slice 5) foi corrigido na [PR #335](https://github.com/luccafwlog/transhipping-desk2/pull/335)
(auditoria [2026-07-07](../design-audit/README.md)).

**Remanescente conhecido, não bloqueante:** os chips "Pend N"/"Pronto N" na
coluna Operação de `Clientes.tsx` não têm `title`/tooltip explicando a
contagem. Não é a pluralização mecânica original (`6 ATIVA(S)`) — é uma
abreviação sem legenda, severidade P3. Não vale uma fatia própria; se
alguém tocar `Clientes.tsx` por outro motivo, adicionar `title="N B/L(s)
pendente(s) de taxas"` / `title="N B/L(s) pronto(s) para faturar"` nos
`Badge`.

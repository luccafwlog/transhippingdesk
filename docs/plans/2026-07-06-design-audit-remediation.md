# Design Audit Remediation — Implementation Plan

> Plano/snapshot de decisão, não verdade corrente. A autoridade executável é o
> código. Base de decisão: auditoria de design full-site
> [design-audit/README.md](../design-audit/README.md) (2026-07-06). Este plano
> consolida os achados **não corrigidos** daquela auditoria em fatias
> revisáveis. As correções seguras de copy/CSS/formatação já foram aplicadas na
> PR #326 e não reaparecem aqui.

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
[auditoria de design 2026-07-06](../design-audit/README.md).

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

- [ ] **Idioma + formato pt-BR do alerta (D1).** Nova migração que altera
  `detect_overdue_invoices()` (última definição em `supabase/migrations/151_…`,
  origem em `024_detect_overdue_invoices.sql`): trocar o literal `Invoice` por
  `Fatura` e o `to_char(..., 'FM999,999,990.00')` por formatação pt-BR
  (`FM999G999G990D00` com `lc_numeric = 'pt_BR'`, ou montar a string em número
  brasileiro). **verify:** inserir invoice vencida no seed e conferir a mensagem
  gerada; teste de RPC se houver harness.
- [ ] **Padronizar `entity_id` (D2).** Gravar sempre `invoice_number` (com
  fallback explícito só quando nulo) no INSERT do alerta, alinhando 024/151 com
  o restante. Alternativa não-destrutiva: resolver o número no render de
  `Alertas.tsx` a partir do id. Decidir por consistência no dado.
  **verify:** os alertas de `invoice` na tela mostram sempre `FAT-…`.
- [ ] Atualizar documentação viva de migração/alertas (`docs/modules/*`,
  `RASTREABILIDADE.md`) e rodar `npm run docs:check`.

## Slice 2 — Painel TV: colisão de colunas e corte do navio (D3)

Layout calibrado para o monitor real da operação (1920×1080) — **validar in
loco antes de mergear.** Só UI/CSS.

- [ ] Rebalancear as larguras das `<col>` no modo display de `LineUpTable.tsx`
  (hoje 4–6% com `px-1`) para separar VOY/POD; permitir o nome do navio quebrar
  em duas linhas em vez de cortar. **verify:** screenshot em 1920×1080 real
  mostrando VOY, POD e nome do navio legíveis; sem regressão no modo lista.

## Slice 3 — Consistência de formato e idioma (D4, D5, D10)

Quick wins de confiança/entendimento. Só display.

- [ ] **`formatUSD` canônico (D4).** Extrair um helper pt-BR único em
  `src/lib/utils.ts` e aplicar em `Demurrage.tsx` e `DemurrageRates.tsx`.
  **verify:** ambas as telas exibem `$ 1.200,00`.
- [ ] **Headers de Carga Solta (D5).** Traduzir os não-domínio
  (`Weight (ton)` → `Peso (ton)`, `Packages total` → `Total de volumes`);
  manter Shipper/Consignee (termos de manifesto).
- [ ] **Jargão no Granito/Taxas (D10).** Remover `real_weight_kg` da descrição
  de `GraniteRates.tsx`.

## Slice 4 — Ações destrutivas, papéis e mobile (D6, D7, D8, D9)

- [ ] **Exclusão de cliente (D6).** Mover a lixeira para dentro do menu "…" ou
  aplicar danger styling explícito (o `ConfirmDialog` já existe). **Não alterar
  o fluxo de exclusão em si.**
- [ ] **Papel em Admin (D7).** Exibir só o select (fonte de verdade) e mover
  "legado" para tooltip, eliminando a dupla representação na linha.
- [ ] **Sticky no mobile (D8).** Reduzir colunas visíveis em viewport estreito
  ou adicionar indicador de scroll horizontal em `.app-table--sticky-actions`.
- [ ] **Label do peso BB (D9).** Rótulo explícito em `Revisao.tsx`
  ("Informar peso BB para liberar cálculo").

## Slice 5 — Polimento P3 (D11)

Oportunístico, item a item:

- [ ] Legendas/pluralização dos chips (`TaxasLocais.tsx`, `Clientes.tsx`).
- [ ] Ano de 4 dígitos em "Criado em" no Admin.
- [ ] Não exibir saldo cobrável em fatura CANCELADA (`InvoicesTable.tsx`).
- [ ] Logo do portal que não renderiza (`PortalLogin.tsx`).
- [ ] `create publication if not exists supabase_realtime` como guard na
  `124_vessel_schedules.sql` (só afeta bootstrap local/CI em banco vazio).

---

## Ordem de ataque recomendada

1. **Slice 1** (D1, D2) — maior ganho de confiança; agrupar numa migração só.
2. **Slice 3** (D4, D5, D10) — quick wins de display, sem risco.
3. **Slice 4** (D6–D9) — UX de ações e mobile.
4. **Slice 2** (D3) — depende de validação no monitor da operação.
5. **Slice 5** (D11) — polimento conforme cada página for tocada.

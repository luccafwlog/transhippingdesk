# BL Import Workflow Adjustments — Implementation Plan

> Plano/snapshot de decisão, não verdade corrente. A autoridade executável é o
> código. Base de decisão: sessão de grilling 2026-07-01 (ver tabela abaixo),
> [ADR 0017](../../adr/0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md)
> (nota editorial 2026-07-01) e [ADR 0018](../../adr/0018-selecao-viagem-busca-preditiva-combobox.md).

**Goal:** Transformar o import de "frete do B/L" (PR #297) num **caminho primário
de ingestão de B/Ls** — operável **sem manifesto** — com viagem declarada por
busca preditiva, bloqueio duro por divergência de navio/viagem, o rename para
"Importar B/L", e a padronização da seleção de viagem no `Combobox` em todo o
sistema.

**Architecture:** Reaproveita o serviço `blFreightImport.ts` e o `BlImportModal`
da PR #297 (o import já cria o B/L inteiro). Remove o auto-match de viagem; a
viagem passa a ser **declarada** pelo operador via `Combobox` alimentado por
`useVoyageOptions()`. A validação de divergência compara `doc.route.vessel` +
`doc.route.voyage` (parser) contra a viagem selecionada. A seleção de viagem vira
um componente compartilhado (`VoyageCombobox`) usado nas ~14 telas.

**Tech Stack:** TypeScript, Vitest, React (TanStack Query), Supabase (Postgres +
RPC). Sem migration nova prevista (nenhuma mudança de schema).

**Fontes de verdade:** `CONTEXT.md` · ADR 0017 (nota 2026-07-01) · ADR 0018 ·
`docs/RASTREABILIDADE.md` · `docs/modules/manifesto-edi.md` · `docs/modules/viagens.md`.

---

## Decisions from Grill Session (2026-07-01)

| # | Decisão | Racional |
|---|---------|----------|
| D1 | Manifesto e B/L são fontes de ingestão **co-primárias**; operação roda só com B/Ls, sem manifesto | Precedência temporal (quem cria) + gate de faturamento; sobrescrita sempre com diff + auditoria |
| D2 | Rename `Importar Frete B/L` → **`Importar B/L`** | O import já cria o B/L inteiro; "frete" era resíduo do escopo original |
| D3 | Todo import de B/L exige o operador **declarar navio + viagem**; a viagem **precisa existir** | A Viagem é a unidade principal; criada antes via "Nova Viagem" |
| D4 | O parser lê navio+viagem do arquivo; **divergência da viagem declarada = bloqueio duro** (não grava) | O arquivo valida a viagem declarada; pega viagem errada / arquivo errado |
| D5 | Sai o auto-match `resolveVoyageId`; um upload mira **uma** viagem | Coerente com D3/D4 |
| D6 | Seleção de viagem padronizada no `Combobox` (busca por navio) em **todo** o sistema (~14 telas) | Substitui `<select>` cru; consistência e velocidade |
| D7 | Contexto (ficha/viagem) **pré-semeia** a busca (editável), não trava | Default de conveniência, ainda é busca |
| D8 | Filtros de listagem = busca **limpável** (vazio = todas); imports = busca **obrigatória** | Preserva o "todas as viagens" dos filtros |

---

## Slice 1 — Ajustes do import de B/L

Entrega revisável independente: rename + viagem declarada + divergência.

- [ ] **Rename (D2).** Trocar rótulo e título:
  - `src/pages/Manifestos.tsx:280` e `src/pages/BlDetalhe.tsx:102`: `Importar Frete B/L` → `Importar B/L`.
  - `src/components/shared/VoyageImportActions.tsx:32`: label `blFreight: 'Frete B/L'` → `'B/L'`.
  - `BlImportModal.tsx` título `Importar frete do B/L` → `Importar B/L`; textos internos que dizem "frete" onde agora é o B/L inteiro.
  - **verify:** `grep -ri "frete b/l"` sem resíduo em UI; testes de `BlImportModal`.
- [ ] **Seletor de viagem obrigatório no modal (D3, D7).** Adicionar `VoyageCombobox` (Slice 2) ao `BlImportModal`:
  - Pré-semeia com `voyageLabel`/`voyageId` quando vier do contexto (editável); vazio nas demais entradas.
  - `Confirmar importação` desabilitado enquanto não houver viagem selecionada.
  - A viagem selecionada alimenta `previewBlFreightImport({ documents, voyageId })`.
  - **verify:** teste do modal — botão travado sem viagem; preview usa o `voyageId` escolhido.
- [ ] **Validação de divergência (D4).** Em `blFreightImport.ts` (preview): comparar `doc.route.vessel`/`doc.route.voyage` contra navio+número da viagem selecionada (já disponíveis no `ComboOption`/`useVoyageOptions`); se divergir, `blockedReasons.push('Arquivo é da viagem <X>, mas você apontou <Y>.')` e `payload = null`.
  - **verify:** teste em `blFreightImport.test.ts` — arquivo de outra viagem → `status: 'blocked'`, nada gravado.
- [ ] **Remover auto-match (D5).** Excluir `resolveVoyageId` e o ramo que resolvia viagem sem `voyageId`; `previewBlFreightImport` passa a exigir `voyageId`. Ajustar `buildBlFreightPreview` (o bloqueio "Viagem nao encontrada" some).
  - **verify:** `npm run lint` (sem código órfão); testes existentes verdes.
- [ ] **Docs (Slice 1).** Atualizar `docs/RASTREABILIDADE.md` (linhas `/manifestos` e `/manifestos/:blId`: nome da ação + comportamento de viagem/divergência) e o catálogo de ações em `docs/modules/manifesto-edi.md`.
  - **verify:** `npm run docs:check`.

## Slice 2 — Padronização da busca de viagem (Combobox)

Entrega revisável independente: o componente + rollout nas ~14 telas.

- [ ] **`VoyageCombobox` compartilhado.** Novo wrapper sobre `src/components/ui/Combobox.tsx`:
  - `fetchOptions(query)` filtra `useVoyageOptions()` (cache client-side; sem ida ao servidor por tecla) e devolve `{ value: id, label: 'NAVIO / número', meta }`.
  - Props: `required` (import, sem vazio) vs `clearable` (filtro, vazio = todas — D8); `initialValue` para pré-semear (D7); `onSelect(voyageId | null)`.
  - **verify:** teste unitário do wrapper (filtra por navio; limpar = null em modo `clearable`).
- [ ] **Rollout — imports (obrigatório):** `Baplie.tsx`, `Veiculos.tsx`, `VaziosImportacao.tsx`, `Granite.tsx`, `EmbarqueVazios.tsx`, `CargaSolta.tsx`, `MercanteEdiModal.tsx`, `billing/ConsolidatedInvoiceModal.tsx`, `billing/ValidacaoTab.tsx`. Trocar `<select>` por `VoyageCombobox required`.
- [ ] **Rollout — filtros (limpável, vazio = todas):** `Manifestos.tsx`, `Containers.tsx`, `Demurrage.tsx`, `VoyageCard.tsx` e o filtro de `Viagens.tsx`. Trocar `<select>`/"Todas as viagens" por `VoyageCombobox clearable`.
  - **verify (ambos):** behavior tests existentes por tela verdes; conferir que o estado de URL/filtro persiste.
- [ ] **Docs (Slice 2).** Nota em `docs/modules/viagens.md` sobre o seletor de viagem padrão (busca preditiva) e link para a ADR 0018.
  - **verify:** `npm run docs:check`.

---

## Gates de verificação (antes de fechar cada slice)

- [ ] `npm run docs:check`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`

## Fora de escopo / notas

- **Sem migration:** nenhuma mudança de schema; `bl_freight_lines`/`bl_emission_date` da PR #297 permanecem.
- **`ponytail:`** parser continua COSCO-only; a validação de divergência assume que `doc.route.vessel`/`voyage` do template são confiáveis — se surgir multi-armador, revisar junto do detector de layout.
- **Batch multi-viagem** deixa de ser suportado por design (um upload = uma viagem); B/Ls de outra viagem caem como `blocked`.

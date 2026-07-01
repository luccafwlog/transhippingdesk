# BL Freight Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o upload do Excel do B/L (template COSCO) alimentar a lacuna de frete do EDI Mercante — frete marítimo + despesas (THD/BAF/…) — reaproveitando os dados que o manifesto já traz, permitindo criar/corrigir o B/L e nunca tocando faturamento.

**Architecture:** Parser posicional puro (`blParser.ts`) espelhando `manifestParser.ts`; serviço de import (`blFreightImport.ts`) espelhando `manifestImport.ts`; nova tabela-filha `bl_freight_lines` + coluna `bls.bl_emission_date`; RPC transacional para create/correct com gate de proteção de faturamento; o gerador de EDI passa a preencher o campo de frete marítimo (C5 `[1739:1760)`) e o bloco de despesas (3796). Um modal compartilhado com três entradas.

**Tech Stack:** TypeScript, Vitest, React (TanStack Query), Supabase (Postgres + RPC).

**Fontes de verdade:** [spec](../specs/2026-07-01-bl-freight-import-design.md) · [ADR 0017](../../adr/0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md) · `CONTEXT.md` · `docs/modules/manifesto-edi.md`.

---

## Decisions from Grill Session (2026-07-01)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Frete & Despesas do BL é conceito novo; alimenta só o EDI, não Taxas Locais | Evita colisão com a cobrança do desk ao cliente |
| D2 | Guardar moeda original por linha; EDI grava valor literal (sem conversão) | Confirmado no EDI real: BAF `USD 172` → `172,00` cru |
| D3 | B/L cria e corrige B/L (ingestão + correção) | B/L é corrigido após emissão; pode chegar antes do manifesto |
| D4 | Preview do diff + sobrescreve com auditoria | Nada muda em silêncio; reaproveita o preview dos modais |
| D5 | Peso/containers travados se já houver cálculo/invoice | Taxas Locais dependem de peso/containers; protege faturamento |
| D6 | Data de emissão por B/L (Date of Issue) → C5 | Só o B/L traz; hoje é digitada à mão |
| D7 | Parser posicional, template único COSCO (ponytail) | Layout de células fixas; upgrade = detector multi-armador |
| D8 | Um modal, três entradas: `/manifestos`, ficha, `/viagens` | Espelha `VoyageImportActions`/`UploadManifestModal` |
| D9 | Frete marítimo → campo `[1779... 1739:1760)`; despesas → bloco 3796 | Decodificado byte a byte contra EDI real aceito |

## Formato de frete do C5 (validado — evidência Runtime)

- **Frete marítimo:** campo `[1739:1760)`, 2 decimais, âncora `220PHHI` em 1760. Hoje zerado pelo gerador.
- **Despesas:** bloco em 3796, fatias `[código(5)][valor(14,2dp)][tipo(1)]`. Semente: `THD→01779`, `BAF→00322`. Tipo `P`/`C` = prepaid/collect.
- **Moeda:** ignorada na gravação (valor literal).
- Cross-check de referência: B/L `CSC45250E02Y00` → OF `2600,00` (1739) + `01779/1717,00/C` + `00322/172,00/P` (3796).

## File Structure

- **Create:** `src/services/blParser.ts` — parser posicional COSCO (puro)
- **Create:** `src/services/__tests__/blParser.test.ts` — testes com fixtures reais
- **Create:** `src/services/blFreightImport.ts` — casamento, diff, create/correct
- **Create:** `src/services/__tests__/blFreightImport.test.ts`
- **Create:** `supabase/migrations/NNN_bl_freight_lines.sql` — tabela + coluna + RPC
- **Create:** `src/components/shared/BlImportModal.tsx` — modal com preview do diff
- **Modify:** `src/services/mercanteEdiGenerator.ts` — mapa de despesas; frete 1739; freightLines
- **Modify:** `src/services/__tests__/mercanteEdiGenerator.test.ts` — cross-check E02Y00
- **Modify:** `src/pages/Manifestos.tsx` — ação de import em lote
- **Modify:** `src/components/shared/VoyageImportActions.tsx` — ação rápida na viagem
- **Modify:** ficha do B/L (`src/pages/BlDetalhe.tsx` / componente de aba) — atalho
- **Modify:** `src/types/database.ts` — tipos gerados (após migration)
- **Modify:** `docs/modules/manifesto-edi.md`, `docs/RASTREABILIDADE.md` — catálogo/rastreio

---

## Task 1: Parser posicional do B/L (COSCO)

**Files:** Create `src/services/blParser.ts`, `src/services/__tests__/blParser.test.ts`

- [ ] Definir `ParsedBLDocument` (partes, rota, datas, itens físicos, `freightCharges: { description, currency, amount, payment }[]`)
- [ ] Ler células fixas (nº BL `AC6`, partes, rota, navio/viagem `A18`, datas `A38`/`AB35`)
- [ ] Parsear seção 11 "Freight & Charges" (linhas a partir de `A26`: descrição/rate/per/amount/prepaid/collect), separando moeda do valor
- [ ] Parsear container `A47` (nº/lacre/tara/tipo/peso/cbm) e aba `VIN` (chassi/container/BL) para RoRo
- [ ] `assertUploadSize` no ponto de entrada; `ponytail:` marcando 1 layout COSCO
- [ ] Testes com os fixtures reais (container, RoRo/VIN, multi-container) → assert de todas as linhas de frete
- [ ] Commit

## Task 2: Migration — `bl_freight_lines` + `bls.bl_emission_date`

**Files:** Create `supabase/migrations/NNN_bl_freight_lines.sql`; Modify `src/types/database.ts`

- [ ] Tabela `bl_freight_lines` (`bl_id`, `seq`, `description`, `category`, `mercante_code`, `currency`, `amount`, `payment`) com FK/índice e RLS coerente com `bls`
- [ ] Coluna `bls.bl_emission_date`
- [ ] Seguir `docs/adr/0016` (nome numerado sequencial); revisar com skill `supabase-migration`
- [ ] Regenerar tipos e atualizar `src/types/database.ts`
- [ ] Teste de contrato SQL (replay limpo)
- [ ] Commit

## Task 3: Gerador de EDI — frete marítimo + despesas

**Files:** Modify `src/services/mercanteEdiGenerator.ts`, `src/services/__tests__/mercanteEdiGenerator.test.ts`

- [ ] Mapa `MERCANTE_DESPESA_CODE` (`THD→01779`, `BAF→00322`), estilo `ponytail` (extensível)
- [ ] `blToMercanteBlData`: popular `freightLines` a partir de `bl_freight_lines` (despesas → código+valor+tipo P/C)
- [ ] `generateC5Record`: escrever frete marítimo (`OCEAN_FREIGHT`) no campo `[1739:1760)`, corrigindo o offset da constante `220PHHI`
- [ ] Usar `bl_emission_date` por B/L quando disponível
- [ ] Teste: reproduzir o C5 de `CSC45250E02Y00` byte a byte (OF `2600,00`; `01779/1717,00/C`; `00322/172,00/P`)
- [ ] Commit

## Task 4: Serviço de import — casamento, diff, create/correct

**Files:** Create `src/services/blFreightImport.ts`, `src/services/__tests__/blFreightImport.test.ts`; RPC na migration da Task 2 (ou nova)

- [ ] Casar por nº de B/L (conferir CNPJ do consignatário); resolver viagem por navio+viagem+POL/POD (create)
- [ ] Computar diff campo-a-campo (de→para) para B/L existente
- [ ] Gate de faturamento: bloquear alteração de peso/containers quando há cálculo/invoice; comerciais sempre liberados
- [ ] RPC transacional create/correct com auditoria + justificativa automática (espelhar `import_manifest_with_postprocess_transactional`)
- [ ] Persistir `bl_freight_lines` e `bl_emission_date`; nunca tocar faturamento
- [ ] Testes de payload/diff/gate (mocks) — atomicidade validada por teste de contrato SQL
- [ ] Commit

## Task 5: UI — modal compartilhado com preview do diff (3 entradas)

**Files:** Create `src/components/shared/BlImportModal.tsx`; Modify `src/pages/Manifestos.tsx`, `src/components/shared/VoyageImportActions.tsx`, ficha do B/L

- [ ] Modal: upload → parse/preview → tabela de diff (novos/atualizados/bloqueados) → confirmar
- [ ] Entrada lote em `/manifestos`; ação rápida em `/viagens/:voyageId`; atalho na ficha `/manifestos/:blId` (filtrado)
- [ ] Invalidação de cache coerente (`['bls']`, `bl-detail`, `voyages`); toasts de sucesso/erro/bloqueio
- [ ] Testes de componente (preview/diff/estados)
- [ ] Commit

## Task 6: Documentação viva + validação final

**Files:** Modify `docs/modules/manifesto-edi.md`, `docs/RASTREABILIDADE.md`, `docs/ARCHITECTURE.md` (se surgir rota)

- [ ] Catálogo de ações e Estado/dados do módulo com o fluxo de import do B/L
- [ ] Rastreabilidade das novas telas/serviços/RPC/tabela
- [ ] `npm run docs:check`, `npm run lint`, `npm test`, `npm run build`
- [ ] Commit

---

## Pendências (bloqueiam completude, não o início)

- Lista completa de códigos de despesa do Mercante além de `THD`/`BAF` (Task 3, mapa extensível).
- Confirmar indicador prepaid/collect do frete marítimo (o campo 1739 observado carrega só o valor).

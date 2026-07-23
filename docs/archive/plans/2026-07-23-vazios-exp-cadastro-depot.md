# VAZIOS EXP — grão-container + Cadastro de Depot — Plano de Implementação

> **For agentic workers:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans` para executar task-a-task. Steps usam checkbox (`- [x]`).

**Goal:** Redesenhar o fluxo de VAZIOS EXP conforme a **ADR 0031**: o container (não o booking) como identidade, import por upsert com todos os campos da planilha real, e um **Cadastro de Depot** com tarifas que alimenta o cálculo de custos na tela e a exibição de valores no ADR.

**Base de decisão:** ADR 0031; `CONTEXT.md` (Booking de Vazio, Cadastro de Depot, Free Time de Storage, Condição do Vazio, Overtime, Serviço Extra de Reorganização).

**Architecture:** React SPA + TanStack Query; Supabase (migrations SQL numeradas, RLS, RPCs `SECURITY DEFINER`); Vitest; `@e965/xlsx`. Cálculo nasce na tela de Vazios EXP; ADR reflete.

**Regras transversais:**

- Migrations numeradas sequenciais (ADR 0016). Este plano usa **229–233**; se outro trabalho ocupar um número, use o próximo livre e ajuste as referências.
- `src/types/database.ts` é arquivo **protegido** (CLAUDE.md): tasks que o alteram exigem autorização explícita do usuário antes do edit — peça antes de executar. Regenerar via `mcp__Supabase__generate_typescript_types` após cada migration.
- Migrations protegidas existentes não são reescritas; mudanças são aditivas ou via nova migration.
- Cada task termina com commit. Antes do push final: `npm run docs:check && npm run lint && npm test && npm run build`.
- Fonte real de referência: planilha de inventário (26 colunas). Mapa coluna→campo na ADR 0031.

---

## Parte 1 — Cadastro de Depot (fundação de tarifas)

### Task 1: Migration 229 — entidade Depot + tarifas + serviços

**Files:**
- Create: `supabase/migrations/229_depot_cadastro_tarifas.sql`
- Test: `src/services/__tests__/depotCadastroMigration.test.ts`

- [x] **Step 1: Escrever a migration** (tabelas, RLS, grants)

```sql
-- Cadastro de Depot: entidade registrada + tarifas por depot (ADR 0031).
-- Intent: substituir depot como texto livre por entidade com tarifas de
--   handling in/out, storage, free time, transporte e serviços extras.
-- Escopo: aditivo. Rollback: DROP das tabelas criadas.

CREATE TABLE public.depots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL,
  name       TEXT,
  pol_port   TEXT,                      -- porto (POL) ao qual o depot pertence
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (code)
);

-- Vigência temporal, no padrão de vazios_reorg_rates / demurrage rates.
CREATE TABLE public.depot_tariffs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id         UUID NOT NULL REFERENCES public.depots(id) ON DELETE CASCADE,
  handling_in_brl  NUMERIC(12,2) NOT NULL DEFAULT 0,
  handling_out_brl NUMERIC(12,2) NOT NULL DEFAULT 0,
  transporte_brl   NUMERIC(12,2) NOT NULL DEFAULT 0,
  storage_day_brl  NUMERIC(12,2) NOT NULL DEFAULT 0,
  free_time_days   INTEGER NOT NULL DEFAULT 0 CHECK (free_time_days >= 0),
  valid_from       DATE NOT NULL,
  valid_to         DATE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_depot_tariffs_depot ON public.depot_tariffs(depot_id);

-- Serviços extras personalizáveis por depot (substitui o enum fixo de reorg).
-- charge_basis: 'per_container_flag' (ex.: visual check) | 'per_operation_qty'
--   (ex.: bundle, desova).
CREATE TABLE public.depot_services (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id     UUID NOT NULL REFERENCES public.depots(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  charge_basis TEXT NOT NULL CHECK (charge_basis IN ('per_container_flag','per_operation_qty')),
  rate_brl     NUMERIC(12,2) NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from   DATE NOT NULL,
  valid_to     DATE,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (depot_id, name),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_depot_services_depot ON public.depot_services(depot_id);
```

- [x] **Step 2: RLS + grants.** SELECT para `authenticated`; INSERT/UPDATE/DELETE gated por permissão de edição (ver Task 2 — Administrativo + Equipamentos). Espelhar o padrão de `vazios_reorg_rates`.
- [x] **Step 3: Teste** — a migration cria as 3 tabelas, constraints e índices; `valid_to < valid_from` é rejeitado; `charge_basis` inválido é rejeitado.
- [x] **Step 4:** Regenerar `src/types/database.ts` (pedir autorização) e commit.

### Task 2: RBAC — permissão de edição de tarifas de depot

**Files:**
- Create: `supabase/migrations/230_depot_rbac.sql`
- Edit: `src/hooks/useAuth.ts` (ou onde vive o mapa `can(...)`)
- Test: `src/services/__tests__/depotRbac.test.ts`

- [x] **Step 1:** Definir a permissão (ex.: `depots_edit`) concedida a **Administrativo** e **Equipamentos**; leitura para todos os perfis internos. Aplicar em RLS/RPC (Dupla proteção RBAC, CONTEXT.md).
- [x] **Step 2:** Expor `can('depots_edit')` na UI; ocultar ações de edição para quem não tem.
- [x] **Step 3:** Teste de isolamento — chamada direta de escrita sem permissão é negada por RLS/RPC, não só pela UI.

### Task 3: Serviço + hooks React Query do Cadastro de Depot

**Files:**
- Create: `src/services/depots.ts`
- Create: `src/hooks/useDepots.ts` (seguir `react-query-pattern`)
- Test: `src/services/__tests__/depots.test.ts`

- [x] **Step 1:** CRUD de `depots`, `depot_tariffs`, `depot_services` (list/upsert/delete), resolução da tarifa **vigente** por depot na data (precedência por `valid_from` desc, `active`), no padrão de `listActiveReorgRates`.
- [x] **Step 2:** Helper `resolveDepot(codeOrPort)` — resolve o valor da coluna `DEPOT` contra `depots`; se casar com um porto/terminal (não um depot), retorna **Embarque Direto** (depot nulo).
- [x] **Step 3:** Testes de resolução vigente e do caso Embarque Direto.

### Task 4: Página de Cadastro de Depot + entrada de menu

**Files:**
- Edit: `src/pages/VaziosReorgRates.tsx` → evoluir para `DepotCadastro` (depots + tarifas + serviços), mantendo a rota `/embarquevazios/taxas` ou renomeando conforme roteador
- Edit: rota + **item de navegação** (hoje a página não tem botão de acesso)
- Edit: `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md` (rota nova/entrada de menu)
- Test: `src/pages/__tests__/DepotCadastro.behavior.test.tsx`

- [x] **Step 1:** UI: lista de depots; por depot, editar tarifas (handling in/out, transporte, storage/dia, free time) e serviços extras (nome, base de cobrança, tarifa, vigência). Absorve as tarifas de reorganização atuais.
- [x] **Step 2:** Adicionar entrada de menu/botão de acesso (corrige a invisibilidade atual). Visível a quem tem `depots_edit` (Administrativo/Equipamentos) e leitura aos demais.
- [x] **Step 3:** Migração de dados: seed dos serviços `visual_check` (per_container_flag), `bundle` e `desova` (per_operation_qty) por depot a partir das tarifas de reorg existentes, quando aplicável.
- [x] **Step 4:** `npm run docs:check` + commit.

---

## Parte 2 — Import por grão-container (schema + RPC + parser)

### Task 5: Migration 231 — identidade container e campos novos

**Files:**
- Create: `supabase/migrations/231_vazios_grao_container.sql`
- Test: `src/services/__tests__/vaziosGraoContainerMigration.test.ts`

- [x] **Step 1: Escrever a migration**

```sql
-- VAZIOS EXP: container como identidade; campos da planilha real (ADR 0031).
-- Intent: booking deixa de ser identidade; unicidade passa a (viagem, container).
-- Escopo: aditivo + troca de constraint. Requer voyage_id na linha para a
--   chave de upsert; manifest_id permanece para proveniência/auditoria.

ALTER TABLE public.vazios_bookings
  ADD COLUMN IF NOT EXISTS voyage_id BIGINT REFERENCES public.voyages(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS os_number TEXT,
  ADD COLUMN IF NOT EXISTS depot_id UUID REFERENCES public.depots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS condition TEXT
    CHECK (condition IS NULL OR condition IN ('empty','damage','material')),
  ADD COLUMN IF NOT EXISTS overtime_handling_pct NUMERIC(6,2) NOT NULL DEFAULT 0
    CHECK (overtime_handling_pct >= 0),
  ADD COLUMN IF NOT EXISTS overtime_transport_pct NUMERIC(6,2) NOT NULL DEFAULT 0
    CHECK (overtime_transport_pct >= 0);

-- Backfill voyage_id a partir do manifesto antes de exigir a nova chave.
UPDATE public.vazios_bookings b
  SET voyage_id = m.voyage_id
  FROM public.vazios_manifests m
  WHERE b.manifest_id = m.id AND b.voyage_id IS NULL;

-- Troca de identidade: container obrigatório, booking opcional.
ALTER TABLE public.vazios_bookings DROP CONSTRAINT IF EXISTS vazios_bookings_manifest_id_booking_number_key;
ALTER TABLE public.vazios_bookings ALTER COLUMN booking_number DROP NOT NULL;
-- container_number NOT NULL: exige backfill/limpeza de linhas sem container
-- antes de aplicar; documentar tratamento de dados legados na migration.
ALTER TABLE public.vazios_bookings ALTER COLUMN container_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vazios_bookings_voyage_container
  ON public.vazios_bookings(voyage_id, container_number);
```

- [x] **Step 2:** Notas na migration sobre dados legados (linhas sem container; material boolean → `condition`). `material` boolean passa a derivar de `condition = 'material'` (view/campo computado) — deprecar a coluna booleana em migration futura, não nesta.
- [x] **Step 3:** Teste — unicidade `(voyage, container)`; container nulo rejeitado; `condition`/pct inválidos rejeitados.

### Task 6: Migration 232 — RPC de import por upsert com todos os campos

**Files:**
- Create: `supabase/migrations/232_import_vazios_upsert.sql`
- Test: `src/services/__tests__/vaziosImportUpsert.test.ts`

- [x] **Step 1:** Reescrever `import_vazios_bookings_transactional` para: receber `p_voyage_id`, `p_port`, `p_uploaded_by`, `p_bookings` com **todos os 16 campos**; declarar todas as colunas no `jsonb_to_recordset`; **upsert** por `(voyage_id, container_number)` (`ON CONFLICT ... DO UPDATE`), resolvendo `depot_id` a partir do código de depot. Manter criação do `vazios_manifests` para proveniência. Preservar gate de permissão ativa.
- [x] **Step 2:** Teste — reimport do mesmo container atualiza (não duplica); container novo insere; container ausente no novo arquivo permanece; todos os campos persistem.

### Task 7: Parser, template e modal de import

**Files:**
- Edit: `src/services/vaziosImport.ts` (parser + tipos + `importVaziosManifest`)
- Edit: `src/pages/EmbarqueVazios.tsx` (modal: exigir viagem + **porto**; texto de ajuda correto)
- Replace: `public/templates/vazios-modelo.xlsx` (colunas alinhadas ao mapa da ADR 0031; **desmembrar OVERTIME em OT Handling / OT Transporte**)
- Test: `src/services/__tests__/vaziosImport.test.ts`

- [x] **Step 1:** Ajustar `HEADER_MAP` ao arquivo real: mapear `POD→embark_port`, `Current Status→condition`, `HIGHLIGHTS→notes`, `VISUAL CHECK...→visual_check`, `IMPORT EMPTY RETURN DATE→hand_in_date`, `EMPTY GATE OUT→hand_out_date`, `LOAD DATE→movement_date`, `ORDER No.→os_number`, `OT Handling/OT Transporte→pct`. Ignorar as colunas marcadas na ADR. Parsear `condition` de `EMPTY / EMPTY w/ DAMAGE / EMPTY w/ MATERIAL`. Datas em serial do Excel **e** `dd/mm/aaaa`.
- [x] **Step 2:** Validar viagem **+ porto** obrigatórios; validar `VESSEL`/`POD` export contra a viagem escolhida (aviso de divergência, não bloqueio).
- [x] **Step 3:** Corrigir o texto do modal (hoje anuncia 7 colunas) e regenerar o template.
- [x] **Step 4:** Testes de parsing do arquivo real (fixture reduzido) + validação viagem/porto.

---

## Parte 3 — Cálculo de custos + duas abas na tela

### Task 8: Motor de cálculo de custos por container/operação

**Files:**
- Create: `src/services/vaziosCusto.ts`
- Test: `src/services/__tests__/vaziosCusto.test.ts`

- [x] **Step 1:** Função pura `computeContainerCost(container, depotTariff)`:
  - handling in + handling out + transporte se `depot_id` presente (Embarque Direto = 0);
  - storage = `máx(0, hand_out − hand_in − free_time_days) × storage_day_brl`;
  - overtime = `handling_brl × (pct_handling/100) + transporte_brl × (pct_transport/100)` (acréscimo sobre a base);
  - visual check = tarifa do serviço se flag;
  - retorna breakdown por linha.
- [x] **Step 2:** `computeOperationTotals(containers, services)` — soma dos containers + bundle/desova (`quantidade × tarifa` do serviço por operação).
- [x] **Step 3:** Testes: Embarque Direto zera handling/transporte/storage; free time zera storage dentro do prazo; overtime como acréscimo; totais de operação com bundle/desova.

### Task 9: Tela de Vazios EXP em duas abas

**Files:**
- Edit: `src/pages/EmbarqueVazios.tsx`
- Edit: `docs/RASTREABILIDADE.md`
- Test: `src/pages/__tests__/EmbarqueVazios.behavior.test.tsx`

- [x] **Step 1: Aba 1 — Containers/dados** (semelhante à atual): tabela por container com os campos importados; edição manual permanece como correção; badges de depot/condição/overtime.
- [x] **Step 2: Aba 2 — Custos/operação:** breakdown de custo por container (colunas de handling, storage, transporte, overtime, serviços) + resumo da operação com totais e inputs de **bundle/desova por operação** e OS. Remover o card de overtime %-por-depot (substituído por pct por container) e o de reorg fixo.
- [x] **Step 3:** Testes de comportamento das duas abas (render de custos, edição de quantidades por operação).

---

## Parte 4 — Ligação com o ADR (contagens + valores)

### Task 10: Operação de Pátio do ADR exibe valores

**Files:**
- Edit: componente da seção Operação de Pátio do ADR (`VoyageAgencyReportTab` / seção de vazios)
- Edit: `AgencyReportDocument` (impresso), se aplicável
- Edit: `CONTEXT.md` (termo Operação de Pátio, se a redação precisar refletir valores)
- Test: `src/pages/__tests__/agencyReportPatioValores.test.tsx`

- [x] **Step 1:** A seção passa a exibir **contagens + valores calculados** (reusando `vaziosCusto`), sem alterar dono da seção nem sign-off (ADR 0027/0029/0030). Valores derivam da tela de Vazios EXP.
- [x] **Step 2:** Garantir que o **fechamento do ADR** (snapshot, ADR 0027) capture os valores exibidos.
- [x] **Step 3:** Testes de exibição de valores e de snapshot no fechamento.

---

## Encerramento

- [x] `npm run docs:check && npm run lint && npm test && npm run build` verdes.
- [x] Atualizar `docs/CHANGELOG.md` e `docs/ROADMAP.md`.
- [x] Mover este plano para `docs/archive/plans/` e remover a linha de `docs/plans/README.md` no mesmo change que conclui a execução (CONVENCOES.md).
- [x] Confirmar que a ADR 0031 saiu de "implementação pendente" no índice `docs/adr/README.md`.

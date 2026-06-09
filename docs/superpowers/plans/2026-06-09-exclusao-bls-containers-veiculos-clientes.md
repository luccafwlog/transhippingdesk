# Exclusao de BLs / Containers / Veiculos / Clientes (singular + em massa) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: usar `superpowers:executing-plans` para implementar task-by-task. Steps usam checkbox (`- [ ]`).

**Goal:** permitir que um usuario **admin** exclua BLs, Containers (`bl_containers`), Veiculos e Clientes (`customers`), tanto individualmente (acao por linha) quanto em massa (selecao de varias linhas), de forma segura para um sistema em producao com historico fiscal.

**Decisoes do dono do produto (2026-06-09):**
- **Hard delete** (sem soft delete / sem coluna `deleted_at`).
- **Somente admin** (`useAuth().isAdmin`) ve e executa qualquer exclusao.
- Admin pode **forcar** por cima de dependencias **operacionais** (veiculos, containers filhos, contatos): elas sao apagadas em cascata controlada.
- Dependencias **fiscais** (fatura emitida em `invoices`/`invoice_bls`, recebivel em `bl_receivables`, lancamento em `local_billing_ledger`) sao **bloqueio duro**: a exclusao e impedida com mensagem clara listando o que bloqueia. Nem admin forca por cima disso pela UI.
- Escopo desta entrega: **as 4 entidades**.

**Architecture:** ondas pequenas e verificaveis. Primeiro a fundacao reutilizavel (hook de selecao + barra de acoes + verificacao de dependencias por entidade no service), depois cada entidade (da mais simples para a mais arriscada: Veiculos -> Containers -> BLs -> Clientes), por fim RLS e validacao final. Cada service de delete e puro e testavel; cada pagina apenas pluga selecao + confirmacao + toast + invalidacao, seguindo o padrao ja usado em `DemurrageRates`/`TaxasLocais`.

**Tech Stack:** React 19, TypeScript, Vite, Supabase/Postgres/RLS, TanStack Query v5, Vitest.

---

## Mapa de dependencias (estado real das FKs confirmado nas migrations)

| Entidade | Filhos OPERACIONAIS (admin cascateia) | Bloqueadores FISCAIS (bloqueio duro) | Auto-cascata do banco |
|---|---|---|---|
| **Veiculo** (`vehicles`) | — (folha) | — | — |
| **Container** (`bl_containers`) | `vehicles` (`container_id` RESTRICT) | `charge_calculations.container_id` (RESTRICT), itens de demurrage por container | `baplie_reconciliation_resolutions` (CASCADE) |
| **BL** (`bls`) | `vehicles` (`bl_id` CASCADE) | `invoices.bl_id`, `invoice_bls.bl_id`, `bl_receivables.bl_id`, `local_billing_ledger.bl_id` (todos RESTRICT) | `bl_containers`, `bl_breakbulk_items`, `charge_calculations.bl_id` (CASCADE) |
| **Cliente** (`customers`) | `customer_contacts` (RESTRICT), `customer_rate_overrides` (RESTRICT) | `bls.customer_id`, `invoices.customer_id`, `bl_receivables.customer_id`, `local_billing_ledger.customer_id` (todos RESTRICT) | `granite_bls.client_id` (SET NULL) |

**Observacao critica de ordem de delete:** mesmo quando o banco *teoricamente* cascatearia, a combinacao `vehicles.container_id RESTRICT` + `bl_containers.bl_id CASCADE` pode disparar RESTRICT no meio da cascata. Por isso **todo service deleta os filhos operacionais explicitamente, bottom-up, antes** de apagar a entidade alvo — nunca confiamos na ordem interna da cascata.

---

## Diretriz obrigatoria de acompanhamento

- [ ] Manter este arquivo atualizado durante a execucao; marcar `- [x]` apenas apos rodar a verificacao da propria etapa.
- [ ] Nao editar `src/types/database.ts` (gerado).
- [ ] Nao alterar `src/lib/pix.ts`.
- [ ] Mudancas cirurgicas: nao refatorar codigo adjacente.
- [ ] Commits pequenos por task concluida.

## Baseline a registrar antes de comecar

- [ ] `git fetch origin --prune` e branch baseada na `origin/main` atual.
- [ ] Rodar `npm run lint`, `npm test`, `npm run build` e anotar o verde inicial.

---

## Task 0: Confirmar constraints reais no banco vivo

**Por que:** o desenho acima vem de arqueologia das migrations. Antes de codar a logica de bloqueio, confirmar o estado efetivo em producao.

**Files:** nenhum (so leitura via Supabase MCP / SQL).

- [ ] **Step 1:** Listar FKs que referenciam `bls`, `bl_containers`, `customers`, `vehicles` com sua `delete_rule`:

```sql
select tc.table_name as child_table, kcu.column_name as child_col,
       ccu.table_name as parent_table, rc.delete_rule
from information_schema.referential_constraints rc
join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.constraint_name
where ccu.table_name in ('bls','bl_containers','customers','vehicles')
order by parent_table, child_table;
```

- [ ] **Step 2:** Ajustar a tabela de dependencias deste plano se o banco divergir (registrar nota abaixo da task). Confirmar especialmente quais tabelas de demurrage referenciam `bl_containers`/`bls` e se devem entrar como bloqueador fiscal.

**Acceptance:** a classificacao operacional vs fiscal de cada entidade esta confirmada contra o banco real.

---

## Task 1: Fundacao reutilizavel de selecao

**Files:**
- Create: `src/hooks/useRowSelection.ts`
- Create: `src/hooks/__tests__/useRowSelection.test.ts`
- Create: `src/components/shared/BulkActionsBar.tsx`

- [ ] **Step 1:** Implementar `useRowSelection<K extends string | number>()` retornando `{ selected: Set<K>, isSelected, toggle, toggleMany, selectAll, clear, count }`. Generico, sem logica de dominio (segue `src/components/ui/` = so apresentacao/estado).
- [ ] **Step 2:** Testar com Vitest: toggle adiciona/remove, `selectAll`/`clear`, `count` consistente.
- [ ] **Step 3:** `BulkActionsBar` minimo: recebe `count`, `onClear`, `onDelete`, `deleting`. Renderiza nada quando `count === 0`. Botao "Excluir selecionados" usa `variant="danger"`. Sem chamar nada de dominio.
- [ ] **Step 4:** `npm test -- src/hooks/__tests__/useRowSelection.test.ts` passa.

**Acceptance:** hook e barra prontos e testados, sem acoplamento a nenhuma entidade.

---

## Task 2: Service de exclusao de Veiculos (folha — mais simples)

**Files:**
- Create: `src/services/vehicles.ts` (se nao existir um arquivo de dominio dedicado)
- Create: `src/services/__tests__/vehicles.delete.test.ts`

- [ ] **Step 1:** Escrever teste: `deleteVehicles([1,2])` chama `supabase.from('vehicles').delete().in('id', [1,2])` e propaga `error` quando o banco retorna erro.
- [ ] **Step 2:** Implementar `deleteVehicles(ids: number[])`. Sem dependencias filhas. Validar `ids.length > 0`.
- [ ] **Step 3:** `npm test` no arquivo novo passa.

**Acceptance:** exclusao singular e em lote de veiculos funciona no service, com erro propagado.

---

## Task 3: UI de exclusao em Veiculos

**Files:**
- Modify: `src/pages/Veiculos.tsx`

- [ ] **Step 1:** Importar `useAuth`, `useConfirm`, `useRowSelection`, `BulkActionsBar`, `deleteVehicles`.
- [ ] **Step 2:** Quando `isAdmin`: adicionar coluna de checkbox (header com select-all da pagina) + coluna de acao com botao `Trash2` por linha (`aria-label`).
- [ ] **Step 3:** Delete singular: `confirm({ message: 'Excluir o veiculo <chassi>? Esta acao e irreversivel.', tone: 'danger', confirmLabel: 'Excluir' })` -> `deleteVehicles([id])` -> invalidar `['vehicles']`, `['vehicle-stats']`, `['bl-detail']` -> toast.
- [ ] **Step 4:** Delete em massa via `BulkActionsBar`: confirm com a contagem (`Excluir N veiculo(s)?`) -> `deleteVehicles([...selected])` -> limpar selecao + invalidar + toast.
- [ ] **Step 5:** `npm run lint` e `npm run build` passam. Smoke manual (anotar): selecionar/excluir 1 e varios.

**Acceptance:** admin exclui veiculo(s) na pagina; nao-admin nao ve checkbox nem botao.

---

## Task 4: Verificacao de dependencias + service de Containers

**Files:**
- Create: `src/services/containers.ts`
- Create: `src/services/__tests__/containers.delete.test.ts`

- [ ] **Step 1:** Definir tipo compartilhado de relatorio:

```ts
export type DeleteDependencyReport = {
  blockedIds: Array<{ id: string | number; reasons: string[] }>
  deletableIds: Array<string | number>
}
```

- [ ] **Step 2:** `checkContainerDependencies(ids)`: contar `charge_calculations` (e tabelas de demurrage confirmadas na Task 0) por `container_id`. Containers com bloqueador fiscal entram em `blockedIds` com motivo (ex: `"3 calculo(s) de taxa vinculado(s)"`).
- [ ] **Step 3:** `deleteContainers(ids)`: para os `deletableIds`, **primeiro** `vehicles.delete().in('container_id', ids)` (cascata operacional), **depois** `bl_containers.delete().in('id', ids)`. Cada passo checa `error`.
- [ ] **Step 4:** Testes: (a) container com `charge_calculations` vai para `blockedIds`; (b) container so com veiculos apaga veiculos e depois o container; (c) erro do banco propaga.
- [ ] **Step 5:** `npm test` no arquivo novo passa.

**Acceptance:** service apaga containers + veiculos vinculados, mas bloqueia container com vinculo fiscal.

---

## Task 5: UI de exclusao em Containers

**Files:**
- Modify: `src/pages/Containers.tsx`
- Possibly modify: `src/hooks/useBls.ts` (se a listagem de containers vier dela) para invalidacao

- [ ] **Step 1:** Mesma estrutura da Task 3 (checkbox + `Trash2` so para admin).
- [ ] **Step 2:** Fluxo: chamar `checkContainerDependencies(selecionados)`. Se houver `blockedIds`, a confirmacao mostra quantos serao excluidos e quantos/quais foram bloqueados e por que. Prosseguir somente com `deletableIds`.
- [ ] **Step 3:** Mensagem do confirm deve avisar que veiculos vinculados serao excluidos junto.
- [ ] **Step 4:** Invalidar `['containers']`/`['bls']`/`['vehicles']`/`['bl-detail']` conforme as queries reais da pagina.
- [ ] **Step 5:** `npm run lint`/`npm run build` passam; smoke manual.

**Acceptance:** admin exclui container(s); container com taxa/demurrage e bloqueado com motivo; veiculos vinculados somem junto.

---

## Task 6: Verificacao de dependencias + service de BLs

**Files:**
- Create: `src/services/bls.ts` (delete; sem mover o resto da logica de BL)
- Create: `src/services/__tests__/bls.delete.test.ts`

- [ ] **Step 1:** `checkBlDependencies(ids: string[])`: contar `invoices`, `invoice_bls`, `bl_receivables`, `local_billing_ledger` por `bl_id`. Qualquer ocorrencia -> `blockedIds` com motivo especifico (ex: `"BL faturado (2 fatura(s))"`, `"possui lancamento no ledger"`).
- [ ] **Step 2:** `deleteBls(ids)`: para `deletableIds`, **primeiro** `vehicles.delete().in('bl_id', ids)`, **depois** `bls.delete().in('id', ids)` (o banco cascateia `bl_containers`, `bl_breakbulk_items`, `charge_calculations`). Checar `error` em cada passo.
- [ ] **Step 3:** Testes: (a) BL com fatura -> bloqueado; (b) BL com ledger -> bloqueado; (c) BL limpo -> apaga veiculos e depois o BL; (d) erro propaga.
- [ ] **Step 4:** `npm test` no arquivo novo passa.

**Acceptance:** service apaga BL + filhos operacionais, mas qualquer vinculo fiscal bloqueia.

---

## Task 7: UI de exclusao em Manifestos (BLs)

**Files:**
- Modify: `src/pages/Manifestos.tsx`

- [ ] **Step 1:** checkbox + `Trash2` so para admin (id do BL e `TEXT`).
- [ ] **Step 2:** Fluxo com `checkBlDependencies`; confirmacao lista bloqueados e prossegue so com deletaveis. Mensagem avisa que containers, break-bulk e veiculos do BL serao excluidos junto.
- [ ] **Step 3:** Invalidar queries de BL/manifesto/container/veiculo usadas pela pagina.
- [ ] **Step 4:** `npm run lint`/`npm run build`; smoke manual com 1 BL limpo e 1 BL faturado.

**Acceptance:** admin exclui BL(s) limpos; BL faturado bloqueado com motivo claro.

---

## Task 8: Service de Clientes + UI

**Files:**
- Modify: `src/services/customers.ts` (adicionar `checkCustomerDependencies` + `deleteCustomers`)
- Modify: `src/pages/Clientes.tsx`
- Create/Modify: `src/services/__tests__/customers.delete.test.ts`

- [ ] **Step 1:** `checkCustomerDependencies(ids: number[])`: contar `bls`, `invoices`, `bl_receivables`, `local_billing_ledger` por `customer_id` -> bloqueador fiscal/operacional pesado. `customer_contacts` e `customer_rate_overrides` sao operacionais (cascata).
- [ ] **Step 2:** `deleteCustomers(ids)`: para deletaveis, apagar `customer_contacts` e `customer_rate_overrides` por `customer_id`, depois `customers`. Lembrar que `granite_bls.client_id` e SET NULL (nao bloqueia).
- [ ] **Step 3:** Testes: cliente com BL/fatura/ledger -> bloqueado; cliente so com contatos -> apaga contatos e depois o cliente.
- [ ] **Step 4:** UI em `Clientes.tsx`: checkbox + `Trash2` so admin; fluxo com `checkCustomerDependencies`; confirmacao avisa que contatos serao excluidos; bloqueados listados. Invalidar `['customers']` e summary.
- [ ] **Step 5:** `npm test`, `npm run lint`, `npm run build`; smoke manual.

**Acceptance:** admin exclui cliente sem historico; cliente com BL/fatura/ledger bloqueado com motivo.

---

## Task 9: Backstop de RLS — DELETE somente admin

**Files:**
- Create: `supabase/migrations/<timestamp>_delete_policies_admin_only.sql`
- Create: `src/services/__tests__/deletePoliciesMigration.test.ts`

**Por que:** a gating de UI nao e seguranca. O delete real precisa exigir `is_admin()` no banco (defense in depth), seguindo o padrao das migrations de hardening (Task 5 do plano de auditoria).

- [ ] **Step 1 (Task 0 dependente):** Verificar as policies de DELETE atuais de `bls`, `bl_containers`, `vehicles`, `customers`, `customer_contacts`, `customer_rate_overrides`.
- [ ] **Step 2:** Migration que faz `DROP POLICY IF EXISTS` das policies de DELETE permissivas e cria DELETE `USING (public.is_admin())` nessas tabelas (e nas filhas que o service apaga: `vehicles`, `customer_contacts`, `customer_rate_overrides`). Seguir naming/estrutura das migrations de RLS existentes; incluir nota de rollback.
- [ ] **Step 3:** Teste de migration (le o SQL e verifica `is_admin()` + `DROP POLICY IF EXISTS` nas tabelas alvo), no mesmo estilo de `rlsHardeningMigration.test.ts`.
- [ ] **Step 4:** `npm test` passa. Aplicar a migration em ambiente controlado (nao em prod sem janela).

**Acceptance:** somente admin consegue DELETE nessas tabelas no nivel do banco, independente da UI.

---

## Validacao final da branch

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Smoke manual autenticado como admin e como nao-admin nas 4 paginas (anotar resultados; ambiente sem `.env` real exige validacao externa).
- [ ] `git status --short` so com arquivos do plano.

## Riscos e notas

- **Irreversibilidade:** hard delete sem backup logico. Recomenda-se confirmar que existe backup/point-in-time no Supabase antes de uso em massa em producao (fora do escopo de codigo, mas registrar no PR).
- **Auditoria:** hoje nao ha log de delete. Opcional/follow-up: gravar em `audit_logs` quem excluiu o que (ha padrao de audit em `customers`). Nao incluido nesta entrega para manter escopo minimo — abrir follow-up se desejado.
- **Bloqueio fiscal vs forcar:** decisao do dono e bloquear fatura/ledger mesmo para admin. Se no futuro for preciso "estornar e excluir", isso e um fluxo proprio (cancelar fatura -> reverter ledger -> excluir) e nao deve ser embutido no botao de delete.
</content>
</invoke>

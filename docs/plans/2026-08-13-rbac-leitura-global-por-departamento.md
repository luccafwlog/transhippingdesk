# Plano — leitura global interna por departamento

Status: TODO

Origem: [`docs/archive/audits/2026-08-13-rbac-departamentos-visualizacao.md`](../archive/audits/2026-08-13-rbac-departamentos-visualizacao.md)

## Objetivo

Fazer o código honrar o que `CONTEXT.md:1233-1252` já define: **a restrição por
departamento é de escrita, não de leitura**. Todo perfil interno ativo enxerga
todas as telas e todos os registros; o que muda entre papéis é o que cada um
pode alterar.

Não-objetivos: mexer no RBAC do Portal do Cliente; afrouxar qualquer escrita;
mudar a matriz de `roleHasPermission`, que já está alinhada ao `CONTEXT.md`.

## Etapa 1 — abrir a leitura financeira no banco (P0)

Migration nova `290_financial_reads_by_department.sql`, revertendo o eixo de
leitura de `014`, `020`, `066` e `111` e preservando integralmente o eixo de
escrita.

Para cada uma das 13 tabelas — `charge_tables`, `charge_table_items`,
`customer_rate_overrides`, `charge_calculations`, `invoices`, `invoice_items`,
`payments`, `invoice_bls`, `bl_receivables`, `invoice_receivable_links`,
`ledger_settlements`, `invoice_lifecycle_events`, `invoice_refunds`:

1. `DROP POLICY IF EXISTS <t>_select_admin ON public.<t>`;
2. `CREATE POLICY <t>_select_read ON public.<t> FOR SELECT TO authenticated
   USING (public.is_active_read_user())`.

Usar `is_active_read_user()`, **não** `is_active_user()`: a segunda exclui
`equipamentos` desde `211:11-21`, e `CONTEXT.md:1243-1246` dá a Equipamentos
leitura no restante do sistema.

Não tocar em nenhuma policy de `INSERT`/`UPDATE`/`DELETE`: elas continuam em
`is_admin()` e são o que impede escrita indevida.

O cabeçalho da migration deve declarar que substitui o eixo de leitura de 014 e
apontar para esta auditoria, conforme a `supabase-migration` skill.

## Etapa 2 — separar ver de gerenciar em Taxas Locais (P1)

`src/pages/TaxasLocais.tsx`: as duas abas passam a renderizar sempre; `can(...)`
deixa de decidir visibilidade e passa a decidir só ação.

- Abas "Tabelas" e "Overrides" sempre montadas (remover as guardas de
  `TaxasLocais.tsx:30-31` e as condições de conteúdo em `:34-51`).
- `ChargeTablesTab` e `ChargeOverridesTab` recebem `canEdit` e escondem botões
  de criar/editar/excluir e a coluna de ações, no padrão já usado por
  `DemurrageRates.tsx:98-161`.

## Etapa 3 — corrigir o texto que o administrador lê (P2)

`src/services/adminUsers.ts:69-75`, alinhando `PROFILE_SCOPES` ao
`roleHasPermission` e ao `CONTEXT.md`:

- `financeiro`: visualização completa de todos os módulos; única escrita é a
  conciliação de pagamentos.
- `operacoes`: visualização completa; escrita apenas em Viagens.
- `documentacao`: visualização completa; todas as ações de negócio exceto
  conciliação de pagamentos e administração de usuários.
- `equipamentos`: visualização completa; escrita em VAZIOS EXP, Veículos e
  Depots, mais o sign-off das suas seções do ADR.
- `administrativo`: sem mudança.

Explicitar "visualização completa" em todos os quatro é o ponto — é a frase que
o administrador precisa ver ao trocar o setor de alguém.

## Etapa 4 — gates de escrita presos a `isAdmin` (P3)

Trocar `isAdmin` pela permissão correspondente, que o banco já concede:

- `Viagens.tsx:187`, `VoyageCard.tsx:309`, `VoyageVisaoTab.tsx:189,263` →
  `can('voyages_edit')`. Propagar como prop nos dois componentes, que hoje
  recebem/leem `isAdmin`.
- `Baplie.tsx:228,263` → usar `canImportVazios`, já calculado em `:39`.
- `Demurrage.tsx:330` → mostrar o link "Tarifas" para todos; a página de
  tarifas já protege a escrita sozinha.
- `Clientes.tsx:151` → incluir `equipamentos` em `canSeePortalQueue`.

Manter `isAdmin` onde o gate é exclusão em massa (`Containers.tsx`,
`Manifestos.tsx`) e reabertura de ADR — são destrutivos e o banco também os
restringe.

## Etapa 5 — testes

1. **Contrato SQL** — `src/services/__tests__/financialReadsByDepartmentMigration.test.ts`,
   no padrão dos testes de migration existentes: a `290` dropa os 13
   `_select_admin` financeiros, cria os `_select_read` com
   `is_active_read_user()` e **não** contém nenhum `FOR INSERT`, `FOR UPDATE`
   ou `FOR DELETE`.
2. **Comportamento** — teste de `TaxasLocais` provando que as duas abas
   renderizam com `can` sempre `false`, e que os controles de escrita somem.
3. **Corrigir o teste vacuamente verde** —
   `src/integration/supabase.integration.test.ts:164` passa a exigir
   `expect(invoices.data).not.toHaveLength(0)` além de `error === null`; sem
   isso a regressão volta silenciosa.
4. Estender `roleHasPermission.test.ts` só se a Etapa 4 alterar a matriz — a
   princípio não altera.

## Etapa 6 — documentação

- `CONTEXT.md`: registrar que "Visualização global interna" vale para **todos**
  os perfis internos, não só Financeiro, e documentar por que `depots_edit`
  fica fora de Documentação (achado das Notas da auditoria).
- ADR novo em `docs/adr/`: *Leitura interna é global; departamento restringe
  escrita* — decisão que supera o eixo de leitura de `014`. Indexar em
  `docs/adr/README.md`.
- `docs/ARCHITECTURE.md`: atualizar a seção de migrations (`:283-309`) com a
  `290`.
- `docs/RASTREABILIDADE.md`: atualizar as linhas de Taxas Locais, Faturamento,
  Relatórios e Ficha do Cliente.
- Ao concluir: mover este plano para `docs/archive/plans/`, remover a linha de
  `docs/plans/README.md` e registrar em `docs/CHANGELOG.md`.

## Ordem e risco

Etapas 1 e 2 são o que resolve o sintoma relatado e devem ir juntas — a 1
sozinha ainda deixa Financeiro e Operações sem abas, e a 2 sozinha mostra abas
vazias. As etapas 3 a 6 podem seguir na mesma mudança.

Risco a vigiar: as policies permissivas se combinam por `OR`, então uma
`_select_read` nova **não** afrouxa escrita, mas convive com qualquer
`_select_admin` remanescente. O `DROP` explícito de cada uma na Etapa 1 é
obrigatório, e o teste de contrato SQL existe para garantir que a lista das 13
esteja completa.

## Verificação

`npm run docs:check`, `npm run lint`, `npm test`, `npm run build`.

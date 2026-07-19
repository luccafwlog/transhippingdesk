# Relatório de execução — Task 3: papel `equipamentos`

## Escopo executado

- `supabase/migrations/210_role_equipamentos.sql`
  - Inclui `equipamentos` no constraint `user_profiles_role_check`, preservando
    todos os papéis anteriores e o rollback operacional descrito no brief.
- `src/types/database.ts`
  - Inclui `equipamentos` em `UserProfileRole` (alteração explicitamente
    autorizada para esta task).
- `src/hooks/useAuth.tsx`
  - Introduz as permissões `vazios_edit` e `veiculos_edit`.
  - Restringe `equipamentos` a essas duas permissões e as concede também a
    `documentacao`; `administrativo` continua com acesso integral.
- `src/hooks/__tests__/roleHasPermission.test.ts`
  - Cobre o escopo positivo de Equipamentos e as negativas para faturamento e
    clientes, além das permissões equivalentes de Documentação e Administrativo.
- `src/services/adminUsers.ts` e `src/components/layout/HeaderInfoBar.tsx`
  - Tornam o novo papel atribuível no console de usuários e legível no cabeçalho.

As RPCs do console de provisionamento do Portal (migrations 196–198) não foram
alteradas: `equipamentos` continua fora de seus allowlists, conforme a decisão
do brief e o escopo de domínio.

## Evidência TDD

### RED

Antes de adicionar as permissões e o papel, foi incluído o bloco de testes
`papel equipamentos` e executado:

```sh
npx vitest run src/hooks/__tests__/roleHasPermission.test.ts
```

Resultado: `2 failed | 5 passed`. As falhas esperadas foram
`roleHasPermission('equipamentos', 'vazios_edit')` e
`roleHasPermission('documentacao', 'vazios_edit')`, ambas retornando `false`
antes da implementação.

### GREEN

Após a implementação, o mesmo comando resultou em:

```text
Test Files  1 passed (1)
Tests       7 passed (7)
```

## Validação adicional e revisão

- `npx tsc -p tsconfig.app.json --noEmit` — passou.
- `npm run lint` — passou.
- `git diff --check` e a checagem do arquivo novo da migration — sem erros de
  whitespace.
- Revisão manual do diff: limitado aos seis arquivos planejados; a migration
  somente amplia o constraint de papel e não altera RPCs de Portal.

## Commit e push

- Commit: `69c83ca`
- Mensagem: `feat(rbac): papel equipamentos com escopo de vazios e veiculos (migration 210)`
- Push: concluído para `origin/codex/agency-departure-report`.

## Pontos de atenção

- A migration foi validada por inspeção e contrato de aplicação TypeScript; não
  foi reproduzida em banco PostgreSQL descartável nesta task.
- O remoto aceitou o push, mas informou que o repositório foi movido para
  `git@github.com:luccafwlog/transhippingdesk.git`.

## Correção do finding importante — gates na UI

### Escopo corrigido

- `src/pages/Veiculos.tsx` passou a usar `can('veiculos_edit')` em todos os
  controles de mutação: importação, seleção individual/em lote e exclusão
  individual/em lote. O modal de importação também fecha seu acesso quando a
  permissão não está disponível.
- `src/pages/EmbarqueVazios.tsx` passou a usar `can('vazios_edit')` para o botão
  e o modal de importação de VAZIOS EXP; o download do template continua sendo
  uma ação de leitura.
- `src/components/shared/VoyageImportActions.tsx` aplica os mesmos gates às
  importações rápidas de Veículos e VAZIOS EXP dentro da viagem, sem alterar os
  demais tipos de importação.
- Os papéis `administrativo`, `documentacao` e `equipamentos` preservam o acesso
  definido em `roleHasPermission`; perfis sem a permissão veem somente leitura.
- Denylists de provisionamento do Portal e migrations não foram alteradas.

### Evidência TDD da correção

#### RED

Depois de incluir os testes focados e antes de alterar a UI, foi executado:

```sh
npx vitest run src/pages/__tests__/EquipmentPermissionGates.test.tsx src/components/shared/__tests__/VoyageImportActions.behavior.test.tsx
```

Resultado esperado: `2 failed` em arquivos, com `4 failed | 5 passed` em testes.
As falhas mostraram que Equipamentos não via exclusão de Veículos, usuários sem
permissão ainda viam as duas importações de página e a importação rápida ainda
exibia VAZIOS EXP sem `vazios_edit`.

#### GREEN

Após aplicar os gates, foi executado:

```sh
npx vitest run src/pages/__tests__/EquipmentPermissionGates.test.tsx src/components/shared/__tests__/VoyageImportActions.behavior.test.tsx src/hooks/__tests__/roleHasPermission.test.ts
```

Resultado: `3 passed` em arquivos e `16 passed` em testes.

### Validação da correção

- `npm test` — `286 passed | 1 skipped` em arquivos;
  `1147 passed | 9 skipped` em testes.
- `npm run lint` — passou sem erros.
- `npm run build` — passou (`2533 modules transformed`, build Vite concluído).
- `git diff --check` — passou sem erros de whitespace.

### Commit e push da correção

- Commit: `ed30275`
- Mensagem: `fix(rbac): aplicar permissoes de equipamentos na UI`
- Push: concluído para `origin/codex/agency-departure-report`
  (`69c83ca..ed30275`).
- O remoto repetiu o aviso de mudança para
  `git@github.com:luccafwlog/transhippingdesk.git`, sem impedir o push.

### Pontos de atenção da correção

- Os gates desta correção orientam a UI conforme o contrato existente; o
  hardening de RLS por papel permanece fora do escopo, como registrado no brief.

## Segunda correção dos findings importantes

### Escopo de escrita do papel Equipamentos

- `VoyageImportActions` agora filtra o papel `equipamentos` para exibir somente
  `Veículos` e `Vazios Exp`, sujeitos respectivamente a `veiculos_edit` e
  `vazios_edit`. Manifesto BB, Granito, Vazios IMP, Baplie, B/L e CE Mercante
  também deixam de montar seus modais se o papel mudar com um modal aberto.
- Os caminhos equivalentes fora da ficha da viagem foram auditados e fechados:
  Granito, Vazios IMP, Manifestos CNTR (B/L/CE), Carga Solta (BB/CE), importação
  de B/L na ficha, cadastro de Vazios IMP a partir do Baplie e upload/cadastro/
  edição na Programação de Navios. Exports e downloads de modelo permanecem
  disponíveis como leitura.
- Granito também oculta `Calcular taxas`, que é uma mutação fora do escopo.
- O gate testa exclusivamente `effectiveRole === 'equipamentos'`; os demais
  papéis conservam o comportamento anterior. O denylist das RPCs de
  provisionamento do Portal não foi alterado.

### Decisão sobre exclusão de veículos

A exclusão voltou a ser oferecida somente quando `isAdmin` é verdadeiro.
Importação/criação continua usando `can('veiculos_edit')`, portanto
`equipamentos` e `documentacao` mantêm o write scope exigido sem receber um
controle destrutivo que o banco rejeita.

Evidência de servidor para a decisão:

- a migration `010_rls_by_role.sql` inclui `vehicles` em `operator_tables`, cria
  INSERT/UPDATE com `is_active_user()` e DELETE com `is_admin()`;
- a migration `040_portal_login_rate_limit.sql` redefine `is_admin()` para os
  papéis `admin` e `administrativo` ativos;
- a documentação viva já registrava `/veiculos — excluir` com pré-condição
  Admin.

Não foi criada migration: ampliar DELETE para Equipamentos/Documentação
contrariaria o hardening destrutivo geral de `010` e o plano histórico de
hard-delete admin-only. A separação UI `canEditVehicles`/`canDeleteVehicles`
alinha a tela ao contrato RLS vigente.

### Evidência TDD

#### RED

Antes da implementação:

```sh
npx vitest run src/pages/__tests__/EquipmentPermissionGates.test.tsx src/components/shared/__tests__/VoyageImportActions.behavior.test.tsx
```

Resultado: `2 failed` em arquivos, `5 failed | 9 passed` em testes. As falhas
provaram que Equipamentos ainda via seis imports alheios, que Granito e Vazios
IMP ainda ofereciam import e que Equipamentos/Documentação ainda viam exclusão
de veículo.

O teste adicional de Programação de Navios também falhou antes do gate:
`1 failed | 6 passed`, pois `Adicionar Navio`, upload, editar e remover ainda
eram exibidos para Equipamentos.

#### GREEN

O conjunto focado final, incluindo permissões, resultou em:

```text
Test Files  6 passed (6)
Tests       34 passed (34)
```

Durante o primeiro `npm test` completo, o comportamento passou, mas um teste de
contrato textual exigia a string exata antiga de destructuring em `Baplie.tsx`.
O contrato foi tornado estrutural (regex para `user`/`isAdmin`) e ampliado para
provar o novo gate `canImportVazios`; o conjunto focado correspondente passou
com `26 passed`.

### Validação final

- `npm test` — `286 passed | 1 skipped` em arquivos;
  `1153 passed | 9 skipped` em testes.
- `npm run lint` — passou sem erros.
- `npm run docs:check` — passou: 166 Markdown, 39 rotas e cobertura do índice
  de ADR verificadas.
- `npm run build` — passou (`2533 modules transformed`).
- `npx tsc -p tsconfig.app.json --noEmit` e `git diff --check` — passaram.

### Commit e push da segunda correção

- Commit de implementação: `be9045b`
- Mensagem: `fix(rbac): limitar escritas do papel equipamentos`
- Push: concluído imediatamente para
  `origin/codex/agency-departure-report` (`ed30275..be9045b`).
- O remoto repetiu o aviso de mudança para
  `git@github.com:luccafwlog/transhippingdesk.git`, sem impedir o push.

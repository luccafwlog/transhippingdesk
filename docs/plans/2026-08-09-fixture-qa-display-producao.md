# Fixture QA de Exibição em Produção Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar em produção uma fixture sintética completa para testar a exibição operacional, financeira e do Portal, sem modificar cadastros protegidos nem executar efeitos externos reais.

**Architecture:** A execução será dirigida por scripts idempotentes e auditáveis, usando os serviços/RPCs oficiais do sistema quando disponíveis. Cada entidade terá prefixo `QA-DISPLAY-2026`/`QAD26`; um catálogo persistido localmente acompanhará IDs criados e permitirá limpeza seletiva por dependência.

**Tech Stack:** TypeScript/Node.js, Supabase client/RPCs existentes, importadores do projeto, Vitest para checks puros e consultas SQL somente leitura para inventário.

## Global Constraints

- Nunca alterar tabelas de taxas locais, depots, terminais ou serviços.
- Nunca enviar e-mails, convites, notificações externas, PIX real ou movimentação bancária.
- Usar somente dados fictícios e identificadores com prefixo `QA-DISPLAY-2026`/`QAD26`.
- Não executar `supabase/scripts/reset_operational_data.sql`.
- Interromper a execução ao primeiro efeito externo ou escrita fora do catálogo previsto.
- Registrar ambiente, usuário, commit/build, IDs, contagens, evidências e limpeza.

---

### Task 1: Inventário e guardas de produção

**Files:**
- Create: `scripts/qa-display-production/inventory.mjs`
- Create: `scripts/qa-display-production/fixture-config.mjs`
- Create: `scripts/qa-display-production/README.md`
- Test: `scripts/qa-display-production/inventory.test.mjs`

**Interfaces:**
- `fixture-config.mjs` exporta `FIXTURE_PREFIX`, `FIXTURE_CODE`, `PROTECTED_TABLES` e `EXTERNAL_SIDE_EFFECTS_DISABLED`.
- `inventory.mjs` executa apenas `SELECT` e grava um snapshot JSON fora do bundle.

- [ ] **Step 1: Write the failing test** para rejeitar configuração sem prefixo único e para garantir que as tabelas protegidas estão na lista de bloqueio.
- [ ] **Step 2: Run test to verify it fails** com `node --test scripts/qa-display-production/inventory.test.mjs`.
- [ ] **Step 3: Write minimal implementation** da configuração e do inventário com contagens dos módulos operacionais, financeiros e Portal.
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando.
- [ ] **Step 5: Execute inventory against production** usando credenciais já configuradas no ambiente, sem imprimir segredos.
- [ ] **Step 6: Commit** com `git add scripts/qa-display-production && git commit -m "chore: add production fixture inventory guards"`.

### Task 2: Criadores operacionais

**Files:**
- Create: `scripts/qa-display-production/create-operational.mjs`
- Create: `scripts/qa-display-production/operational-fixture.json`
- Modify: `test-fixtures/README.md`
- Test: `scripts/qa-display-production/create-operational.test.mjs`

**Interfaces:**
- `create-operational.mjs` exporta `createOperationalFixture(client, config)` e retorna IDs de viagens, escalas, clientes, B/Ls, containers, veículos, carga solta, granito e vazios.
- O manifesto de retorno contém somente IDs e chaves sintéticas, nunca tokens ou senhas.

- [ ] **Step 1: Write the failing test** para validar cardinalidades mínimas: duas viagens, quatro clientes, múltiplos POL/POD e pelo menos seis tipos de equipamento.
- [ ] **Step 2: Run test to verify it fails** com `node --test scripts/qa-display-production/create-operational.test.mjs`.
- [ ] **Step 3: Write minimal implementation** reutilizando serviços/RPCs oficiais e arquivos de importação, com validação do prefixo antes de cada escrita.
- [ ] **Step 4: Run test to verify it passes** com fixtures locais e cliente Supabase stubado.
- [ ] **Step 5: Execute against production** somente após o inventário, gravando o catálogo de IDs a cada etapa.
- [ ] **Step 6: Commit** com `git add scripts/qa-display-production test-fixtures/README.md && git commit -m "feat: add synthetic operational display fixture"`.

### Task 3: Cenários de ADR e exceções operacionais

**Files:**
- Create: `scripts/qa-display-production/create-adr-scenarios.mjs`
- Test: `scripts/qa-display-production/create-adr-scenarios.test.mjs`

**Interfaces:**
- `create-adr-scenarios.mjs` exporta `createAdrScenarios(client, fixture)` e retorna IDs dos ADRs, omissões, transbordos e CODs criados.

- [ ] **Step 1: Write the failing test** para exigir uma escala concluída, uma escala pendente e um cenário de omissão com transbordo/COD.
- [ ] **Step 2: Run test to verify it fails** com `node --test scripts/qa-display-production/create-adr-scenarios.test.mjs`.
- [ ] **Step 3: Write minimal implementation** usando as RPCs oficiais de ADR e omissão, sem criar registros duplicados para a mesma `(viagem, porto)`.
- [ ] **Step 4: Run test to verify it passes** localmente.
- [ ] **Step 5: Execute against production** e validar que apenas viagens da fixture foram afetadas.
- [ ] **Step 6: Commit** com `git add scripts/qa-display-production && git commit -m "feat: add ADR and exception scenarios to QA fixture"`.

### Task 4: Faturamento sintético de taxas locais e demurrage

**Files:**
- Create: `scripts/qa-display-production/create-financial-scenarios.mjs`
- Test: `scripts/qa-display-production/create-financial-scenarios.test.mjs`
- Modify: `docs/operations/validacao.md`

**Interfaces:**
- `create-financial-scenarios.mjs` exporta `createFinancialScenarios(client, fixture)` e retorna IDs de invoices, receivables, itens, demurrage invoices, settlements e reversões.

- [ ] **Step 1: Write the failing test** para exigir invoices de taxas locais e demurrage em estados emitida, parcial, paga, vencida e cancelada, além de uma consolidada.
- [ ] **Step 2: Run test to verify it fails** com `node --test scripts/qa-display-production/create-financial-scenarios.test.mjs`.
- [ ] **Step 3: Write minimal implementation** consultando taxas/serviços existentes e usando somente RPCs de faturamento, ledger e demurrage; todos os identificadores de pagamento conterão `QAD26-TEST`.
- [ ] **Step 4: Run test to verify it passes** localmente contra dados de teste.
- [ ] **Step 5: Execute against production** com bloqueio explícito de integrações externas e validação de que nenhuma tabela protegida sofreu `INSERT/UPDATE/DELETE`.
- [ ] **Step 6: Commit** com `git add scripts/qa-display-production docs/operations/validacao.md && git commit -m "feat: add synthetic billing and demurrage scenarios"`.

### Task 5: Portal, pagamentos sintéticos e conciliação PIX

**Files:**
- Create: `scripts/qa-display-production/create-portal-scenarios.mjs`
- Test: `scripts/qa-display-production/create-portal-scenarios.test.mjs`
- Modify: `docs/operations/validacao.md`

**Interfaces:**
- `create-portal-scenarios.mjs` exporta `createPortalScenarios(client, fixture)` e retorna IDs de contas, eventos, pagamentos e conciliações.

- [ ] **Step 1: Write the failing test** para exigir contas sintéticas em estados distintos e conciliações PIX exata, parcial, excedente e revertida.
- [ ] **Step 2: Run test to verify it fails** com `node --test scripts/qa-display-production/create-portal-scenarios.test.mjs`.
- [ ] **Step 3: Write minimal implementation** sem chamar Edge Functions de e-mail e sem inserir senha em claro; usar contas técnicas e identificadores de teste.
- [ ] **Step 4: Run test to verify it passes** localmente.
- [ ] **Step 5: Execute against production** e consultar notificações/eventos para confirmar ausência de disparo externo.
- [ ] **Step 6: Commit** com `git add scripts/qa-display-production docs/operations/validacao.md && git commit -m "feat: add synthetic portal and PIX scenarios"`.

### Task 6: Validação, relatório e limpeza seletiva

**Files:**
- Create: `scripts/qa-display-production/validate-fixture.mjs`
- Create: `scripts/qa-display-production/cleanup-fixture.mjs`
- Create: `docs/archive/reports/2026-08-09-fixture-qa-display-producao.md`
- Test: `scripts/qa-display-production/cleanup-fixture.test.mjs`

**Interfaces:**
- `validate-fixture.mjs` exporta `validateFixture(client, catalog)` e retorna contagens por módulo e violações de isolamento.
- `cleanup-fixture.mjs` exporta `cleanupFixture(client, catalog, { dryRun })`; sem `dryRun: false`, apenas lista a ordem de remoção.

- [ ] **Step 1: Write the failing test** para garantir que a limpeza rejeita catálogo vazio, prefixo divergente e qualquer ID fora da fixture.
- [ ] **Step 2: Run test to verify it fails** com `node --test scripts/qa-display-production/cleanup-fixture.test.mjs`.
- [ ] **Step 3: Write minimal implementation** com remoção por dependência e bloqueio das tabelas protegidas.
- [ ] **Step 4: Run test to verify it passes** localmente.
- [ ] **Step 5: Execute validação contra produção** e gerar relatório com evidências, sem executar limpeza até solicitação separada.
- [ ] **Step 6: Run required verification** com `npm run docs:check`, `npm run lint`, `npm test` e `npm run build`.
- [ ] **Step 7: Commit** com `git add scripts/qa-display-production docs/archive/reports && git commit -m "chore: validate production QA fixture and add selective cleanup"`.


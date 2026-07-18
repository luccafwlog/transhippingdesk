# Integração Clientes e Provisionamento do Portal — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o gate pré-piloto da issue #370 com navegação coerente, gestão inline, linguagem humana, ações contextuais, ficha integrada, exportação XLSX e leitura segura por perfil.

**Architecture:** `/clientes/portal` continua como console dedicado, acessado pelo cabeçalho de `/clientes`; a revisão individual vira uma linha expansível e reutiliza o mesmo componente de gestão embutido na ficha. Uma RPC `SECURITY DEFINER` substitui leituras diretas e projeta dados completos para Administrativo/Documentação/Financeiro e somente resumo para Operações. Um view model puro concentra rótulos, próxima ação e dados da planilha.

**Tech Stack:** React 19, TypeScript, React Router, TanStack React Query, Supabase/PostgreSQL, Vitest, Testing Library, Tailwind CSS e `@e965/xlsx` já instalado.

## Global Constraints

- A issue #370 e o `CONTEXT.md` são as fontes de verdade; o piloto fica bloqueado até merge, deploy e validação em produção.
- Remover “Portal do Cliente” da navegação superior; inserir “Provisionamento do Portal” no cabeçalho de `/clientes`, visível para todos, com badge de `Aguardando análise`.
- Manter `/clientes/portal`, com breadcrumb e retorno para Clientes.
- Somente Administrativo e Documentação executam ações. Financeiro consulta tudo. Operações vê somente situação resumida, sem Email de Recuperação, candidatos ou histórico.
- Expandir apenas um Cliente, imediatamente abaixo da linha, com mouse, teclado e layout responsivo.
- `aprovado_para_provisionar` aparece como “Provisionamento autorizado”; `convite_pendente`, como “Ativação pendente”. Enums não mudam.
- “Provisionamento não necessário no momento” exige confirmação e justificativa não vazia, sem tamanho mínimo. Reenvio não exige justificativa.
- Não adicionar mensagem fixa, ação em lote, rastreamento de abertura, dependência ou escopo de RBAC global.
- Exportar `.xlsx`, nunca CSV ou `.xls`. Contatos são apenas candidatos e nunca atualizam automaticamente o Email de Recuperação.
- Aplicar migration numérica por `supabase db push`; nunca usar `apply_migration` do MCP.

---

### Task 1: Read model seguro do Console

**Files:**
- Create: `supabase/migrations/196_portal_provisioning_console_read_model.sql`
- Modify: `src/types/database.ts`
- Modify: `src/services/portalProvisioning.ts`
- Modify: `src/hooks/usePortalProvisioning.ts`
- Create: `src/services/__tests__/portalProvisioningConsoleReadModelMigration.test.ts`
- Modify: `src/services/__tests__/portalProvisioning.test.ts`

**Interfaces:**
- Produces: `portal_list_provisioning_console(p_customer_id BIGINT DEFAULT NULL) RETURNS SETOF JSONB`.
- Produces: `portal_list_provisioning_events(p_customer_id BIGINT, p_limit INTEGER DEFAULT 10)`.
- Produces: `listPortalProvisioningQueue(customerId?: number): Promise<QueueRow[]>`.

- [ ] **Step 1: Escrever testes falhos de contrato SQL**

Asserir criação `SECURITY DEFINER`, `search_path`, revogação de `PUBLIC/anon`, autorização apenas dos quatro papéis, projeção completa para `administrativo/documentacao/financeiro`, projeção resumida para `operacoes` e bloqueio de eventos para Operações.

```ts
expect(sql).toMatch(/portal_list_provisioning_console/i)
expect(sql).toMatch(/SECURITY DEFINER SET search_path TO 'public', 'pg_temp'/i)
expect(sql).toContain("v_role IN ('administrativo','documentacao','financeiro')")
expect(sql).toMatch(/CASE WHEN v_full_access THEN a\.recovery_email ELSE NULL END/i)
expect(sql).toMatch(/portal_list_provisioning_events[\s\S]*permission denied/i)
expect(sql).toMatch(/REVOKE EXECUTE[\s\S]*FROM PUBLIC/i)
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/services/__tests__/portalProvisioningConsoleReadModelMigration.test.ts`

Expected: FAIL porque a migration não existe.

- [ ] **Step 3: Implementar migration `196`**

A RPC do Console retorna JSON com: `account_id`, `customer_id`, `customer_name`, `cnpj_cpf`, `provisioning_decision`, `account_situation`, `recovery_email`, `recovery_email_source`, `pending_invite_expires_at`, `latest_delivery_status`, `exception_reason`, `last_event_at`, `has_critical_alert`, `has_open_invoice`, `has_active_process`, `candidates` e `shared_email_count`. Para Operações, email/origem/entrega/justificativa são `NULL`, candidatos `[]` e compartilhamento `0`. Eventos aceitam apenas Administrativo, Documentação e Financeiro, ordenam por `created_at DESC` e limitam `p_limit` entre 1 e 50.

- [ ] **Step 4: Migrar serviço e hooks para RPC**

Adicionar tipos `RecoveryEmailSource`, `PortalDeliveryStatus` e `PortalProvisioningConsolePayload`. Remover consultas diretas a `customer_portal_accounts`, `customer_contacts`, `alerts` e `portal_provisioning_events`. Mapear o payload para `QueueRow`, mantendo `hasCriticalAlert`, `lastActivityAt` e `sharedEmailCount` como nomes do frontend.

- [ ] **Step 5: Testar serviço e hooks**

```ts
expect(rpc).toHaveBeenCalledWith('portal_list_provisioning_console', { p_customer_id: null })
expect(result[0]).toMatchObject({ recovery_email: null, candidates: [], sharedEmailCount: 0 })
```

Run: `npx vitest run src/services/__tests__/portalProvisioningConsoleReadModelMigration.test.ts src/services/__tests__/portalProvisioning.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/196_portal_provisioning_console_read_model.sql src/types/database.ts src/services/portalProvisioning.ts src/hooks/usePortalProvisioning.ts src/services/__tests__/portalProvisioningConsoleReadModelMigration.test.ts src/services/__tests__/portalProvisioning.test.ts
git commit -m "feat(portal): protege leitura do console por perfil"
```

---

### Task 2: Linguagem humana e XLSX

**Files:**
- Create: `src/lib/portalProvisioningViewModel.ts`
- Create: `src/lib/__tests__/portalProvisioningViewModel.test.ts`
- Modify: `src/services/exports.ts`
- Modify: `src/services/__tests__/exports.test.ts`

**Interfaces:**
- Produces: formatadores exaustivos de decisão, situação, origem, finalidade e entrega.
- Produces: `getPortalNextAction(row): string`.
- Produces: `exportPortalProvisioningWorkbook(rows: QueueRow[]): Promise<void>`.

- [ ] **Step 1: Escrever testes falhos**

```ts
expect(provisioningDecisionLabel('aprovado_para_provisionar')).toBe('Provisionamento autorizado')
expect(accountSituationLabel('convite_pendente')).toBe('Ativação pendente')
expect(accountSituationLabel('ativo')).toBe('Ativa')
expect(recoveryEmailSourceLabel('informado_manualmente')).toBe('Informado manualmente')
expect(contactPurposeLabel('faturamento')).toBe('Faturamento')
expect(deliveryStatusLabel('entregue')).toBe('Entregue')
```

Valor inesperado em runtime retorna `Não informado`, nunca enum bruto.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/lib/__tests__/portalProvisioningViewModel.test.ts`

Expected: FAIL porque o módulo não existe.

- [ ] **Step 3: Implementar view model**

Usar `Record<Enum, string>` e derivar próxima ação nesta ordem: reabrir análise; aguardar ativação; reenviar; revisar email e reenviar; conta ativa; reativar; revisar/enviar; revisar email.

- [ ] **Step 4: Implementar e testar XLSX**

Reutilizar helpers de `exports.ts`. Nome `portal-clientes.xlsx`, aba `Provisionamento`, colunas: Cliente, CNPJ, Decisão, Situação da conta, Email de Recuperação, Origem do email, Situação da entrega, Vencimento do convite, Alerta crítico, Última atividade, Próxima ação e Email compartilhado. CNPJ formatado, datas pt-BR e booleanos `Sim/Não`.

Run: `npx vitest run src/lib/__tests__/portalProvisioningViewModel.test.ts src/services/__tests__/exports.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/portalProvisioningViewModel.ts src/lib/__tests__/portalProvisioningViewModel.test.ts src/services/exports.ts src/services/__tests__/exports.test.ts
git commit -m "feat(portal): padroniza rótulos e exportação xlsx"
```

---

### Task 3: Entrada no cabeçalho de Clientes

**Files:**
- Modify: `src/components/layout/appLayoutNav.ts`
- Modify: `src/components/layout/__tests__/AppLayout.test.ts`
- Modify: `src/pages/Clientes.tsx`
- Create: `src/pages/__tests__/Clientes.portal-entry.test.tsx`

- [ ] **Step 1: Escrever testes falhos**

```ts
expect(primaryNavItems.some((item) => item.to === '/clientes/portal')).toBe(false)
expect(screen.getByRole('link', { name: /Provisionamento do Portal/ })).toHaveAttribute('href', '/clientes/portal')
expect(screen.getByLabelText('Clientes aguardando análise')).toHaveTextContent('7')
```

Executar para os quatro perfis e confirmar que todos veem o link.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/components/layout/__tests__/AppLayout.test.ts src/pages/__tests__/Clientes.portal-entry.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implementar**

Remover o item da navegação primária. Inserir link secundário antes de Importar/Exportar/Novo Cliente. Badge = quantidade com `provisioning_decision === 'aguardando_analise'`; durante loading ou erro, manter o link sem número.

- [ ] **Step 4: Verificar e commitar**

Run: `npx vitest run src/components/layout/__tests__/AppLayout.test.ts src/pages/__tests__/Clientes.portal-entry.test.tsx`

Expected: PASS.

```powershell
git add src/components/layout/appLayoutNav.ts src/components/layout/__tests__/AppLayout.test.ts src/pages/Clientes.tsx src/pages/__tests__/Clientes.portal-entry.test.tsx
git commit -m "feat(clientes): move acesso ao provisionamento para o cabeçalho"
```

---

### Task 4: Console expansível, deep links e acessibilidade

**Files:**
- Modify: `src/pages/ClientesPortal.tsx`
- Modify: `src/pages/__tests__/ClientesPortal.behavior.test.tsx`
- Modify: `src/components/portal/PortalReviewPanel.tsx`

- [ ] **Step 1: Escrever behavior tests falhos**

Cobrir: título/breadcrumb/retorno; filtro Todos; card Total ativa Todos; botão “Gerenciar Portal”; detalhe em `<tr>` imediatamente seguinte; apenas uma expansão; clique repetido fecha; destaque e `aria-expanded`; Enter/Espaço; retorno de foco; deep link fora do filtro em modo “Cliente selecionado”; limpeza ao sair do conjunto; ausência de `_`; exportação chama XLSX com todas as linhas filtradas.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/pages/__tests__/ClientesPortal.behavior.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implementar tabela e URL**

Adicionar preset `todos`. Renderizar linha principal e detalhe em `Fragment`; detalhe usa `<td colSpan={6}>` e `PortalReviewPanel variant="inline"`. Remover `fixed`. Em mobile, seções empilham. Copiar `URLSearchParams` antes de atualizar `filtro/cliente`. Deep link incompatível com filtro exibe o Cliente selecionado e ação para voltar à fila.

- [ ] **Step 4: Aplicar view model e XLSX**

Formatar decisão, situação, origem, finalidade, entrega e CNPJ. Trocar “Exportar CSV” por “Exportar XLSX” e remover o `Blob` CSV.

- [ ] **Step 5: Verificar e commitar**

Run: `npx vitest run src/pages/__tests__/ClientesPortal.behavior.test.tsx`

Expected: PASS.

```powershell
git add src/pages/ClientesPortal.tsx src/pages/__tests__/ClientesPortal.behavior.test.tsx src/components/portal/PortalReviewPanel.tsx
git commit -m "feat(portal): exibe gestão logo abaixo do cliente"
```

---

### Task 5: Painel reutilizável e ações contextuais

**Files:**
- Modify: `src/components/portal/PortalReviewPanel.tsx`
- Create: `src/components/portal/__tests__/PortalReviewPanel.test.tsx`
- Modify: `src/hooks/usePortalProvisioning.ts`

**Interface:** `PortalReviewPanel({ row, variant: 'inline' | 'embedded', onSaved, onClose })`.

- [ ] **Step 1: Escrever matriz de testes falha**

| Estado | Ações visíveis |
|---|---|
| Aguardando + sem conta | Enviar convite; Provisionamento não necessário no momento |
| Ativação pendente | Reenviar convite; Cancelar convite |
| Convite expirado | Reenviar convite |
| Falha no envio | Revisar email e reenviar |
| Ativa | Trocar Email de Recuperação; Suspender conta |
| Suspensa | Reativar conta |
| Não necessário | Reabrir análise |

Também testar: reenvio confirma autorização e não pede justificativa; cancelamento explica invalidação e exige justificativa; suspensão explica encerramento de sessões; reativação exige email, novo link e nova senha; exceção explica efeitos e exige justificativa não vazia; justificativas não são compartilhadas; botões inválidos ficam ausentes; Financeiro não tem ações; Operações recebe apenas resumo.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/components/portal/__tests__/PortalReviewPanel.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implementar painel e mutations**

Seções: Resumo; Email e convite; Ações administrativas recolhidas; Histórico. Criar hooks `useSendPortalInvite`, `useCancelPortalInvite`, `useSetProvisioningException`, `useReturnToAnalysis`, `useSuspendPortalAccount` e `useAssistedEmailChange`; cada sucesso invalida a chave do Portal e a ficha do Cliente. Cada modal mantém seu próprio motivo.

- [ ] **Step 4: Verificar e commitar**

Run: `npx vitest run src/components/portal/__tests__/PortalReviewPanel.test.tsx src/services/__tests__/portalProvisioning.test.ts`

Expected: PASS.

```powershell
git add src/components/portal/PortalReviewPanel.tsx src/components/portal/__tests__/PortalReviewPanel.test.tsx src/hooks/usePortalProvisioning.ts
git commit -m "feat(portal): contextualiza ações de provisionamento"
```

---

### Task 6: Gestão completa na ficha do Cliente

**Files:**
- Modify: `src/pages/ClienteFicha.tsx`
- Modify: `src/pages/__tests__/ClienteFicha.behavior.test.tsx`

- [ ] **Step 1: Escrever testes falhos**

Provar: resumo com decisão/situação/email/origem/convite/entrega/alerta/último evento/justificativa; painel `embedded`; deep link `/clientes/portal?cliente={customer_id}`; candidatos com nome/finalidade/origem; contato não altera Email de Recuperação; aviso de divergência; invalidação de queries; cinco eventos e expansão até cinquenta; Financeiro sem ações; Operações resumido.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/pages/__tests__/ClienteFicha.behavior.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implementar**

Adicionar resumo compacto e botão “Gerenciar Portal”; renderizar o painel embutido sem navegar e preservar formulário cadastral. Trocar link genérico pelo deep link com ID. Não sincronizar contatos e Email de Recuperação.

- [ ] **Step 4: Verificar e commitar**

Run: `npx vitest run src/pages/__tests__/ClienteFicha.behavior.test.tsx`

Expected: PASS.

```powershell
git add src/pages/ClienteFicha.tsx src/pages/__tests__/ClienteFicha.behavior.test.tsx
git commit -m "feat(clientes): integra gestão do portal à ficha"
```

---

### Task 7: Documentação, gates e produção

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/RASTREABILIDADE.md`
- Modify: `docs/modules/clientes.md`
- Modify: `docs/modules/portal-cliente.md`
- Modify: `docs/operations/validacao.md`
- Modify: `docs/operations/seguranca.md`
- Update: GitHub issue `#370` após deploy/validação

- [ ] **Step 1: Atualizar documentação viva**

Registrar ponto de entrada, rota, expansão inline, filtro Todos, deep links, XLSX, read model por perfil, ações contextuais, ausência de justificativa no reenvio, ficha integrada e termos canônicos. Não alterar `docs/archive/`.

- [ ] **Step 2: Executar testes focados**

Run: `npx vitest run src/services/__tests__/portalProvisioningConsoleReadModelMigration.test.ts src/services/__tests__/portalProvisioning.test.ts src/lib/__tests__/portalProvisioningViewModel.test.ts src/services/__tests__/exports.test.ts src/components/layout/__tests__/AppLayout.test.ts src/pages/__tests__/Clientes.portal-entry.test.tsx src/pages/__tests__/ClientesPortal.behavior.test.tsx src/components/portal/__tests__/PortalReviewPanel.test.tsx src/pages/__tests__/ClienteFicha.behavior.test.tsx`

Expected: zero falhas.

- [ ] **Step 3: Executar gates completos**

```powershell
npm run docs:check
npm run lint
npm test
npm run build
git diff --check
```

Expected: todos com exit code `0`.

- [ ] **Step 4: Commit de documentação**

```powershell
git add CONTEXT.md docs/ARCHITECTURE.md docs/RASTREABILIDADE.md docs/modules/clientes.md docs/modules/portal-cliente.md docs/operations/validacao.md docs/operations/seguranca.md
git commit -m "docs(portal): registra gate ux antes do piloto"
```

- [ ] **Step 5: Aplicar e validar em produção**

Rodar `supabase db push` em terminal autorizado; confirmar migration `196`; validar com a conta FWLOG em desktop, notebook, mobile e teclado; não automatizar credenciais reais; registrar na #370 commit/PR, ambiente, migration, comandos e resultados sem PII; marcar o gate somente após runtime aprovado.

---

## Self-review

- **Cobertura:** navegação, badge, perfis, proteção backend, expansão, deep link, Todos, acessibilidade, rótulos, XLSX, exceção, ações, ficha, documentação, deploy e #370 possuem tarefa e teste.
- **Limites:** sem ação em lote, abertura de email, dependência, mudança de enum ou auditoria RBAC global.
- **Consistência:** Tasks 2–6 consomem `QueueRow`, `PortalDeliveryStatus`, `sharedEmailCount` e formatadores definidos nas Tasks 1–2.
- **Migração:** `196` sucede `195_portal_email_change_revokes_sessions.sql`.

## Execution Handoff

Executar Tasks 1–7 em ordem com `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans`, em worktree isolado e com revisão entre commits.

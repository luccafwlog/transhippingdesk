# Revisão manual orientada a cliente e onboarding via B/L Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar `/revisao` numa fila orientada por cliente, permitindo criar/selecionar o cliente, cadastrar e-mail, vincular todos os B/Ls do grupo e deixar visíveis somente as exceções específicas de cada B/L.

**Architecture:** A fila continua lendo B/Ls pendentes, mas passa a derivar grupos com identidade documental segura e evidências brutas. O onboarding do grupo será uma RPC transacional que resolve/cria cliente, insere contato de forma idempotente, vincula os B/Ls, audita e recalcula cada gate; o convite do Portal é uma chamada posterior e opcional para o mesmo e-mail. A importação usará um helper SQL idempotente para adicionar e-mails extraídos a clientes já reconhecidos por CNPJ.

**Tech Stack:** React 19, TypeScript, TanStack Query, Supabase PostgreSQL/RPC/RLS, Edge Function `portal-invite-send`, Vitest, Testing Library e `npm run docs:check`.

---

## Mapa de arquivos

### Domínio e agrupamento

- Modify: `src/pages/revisaoHelpers.ts` — candidatos de CNPJ, agrupamento seguro,
  conflitos e estado de onboarding.
- Modify: `src/lib/cnpj.ts` — reutilizar a extração de CNPJ em texto bruto sem
  criar uma segunda regra de validação.
- Modify: `src/hooks/useReview.ts` — transportar evidências brutas e o modelo
  tipado de grupo/cliente usado pela tela.
- Modify: `src/pages/__tests__/revisaoHelpers.test.ts` — testes puros de grupos,
  evidências e conflitos.

### Contrato Supabase

- Create: `supabase/migrations/322_review_customer_group_onboarding.sql` —
  helper de contato idempotente, extração/validação server-side de candidatos,
  RPC transacional do onboarding e extensão do wrapper de importação atual.
- Create: `src/services/__tests__/reviewCustomerGroupMigration.test.ts` — teste
  de contrato SQL da migration 322.
- Modify: `src/types/database.ts` — regenerar os tipos gerados depois que a RPC
  estiver definida; não editar manualmente para esconder drift.

### Services e hooks

- Create: `src/services/reviewCustomerGroup.ts` — contrato TypeScript da RPC,
  normalização de retorno por B/L e disparo opcional do convite usando o mesmo
  e-mail.
- Create: `src/hooks/useReviewCustomerGroup.ts` — mutation de onboarding e
  invalidação centralizada de fila, clientes, B/Ls e Portal.
- Create: `src/services/__tests__/reviewCustomerGroup.test.ts` — testes de
  payload, retorno por B/L, validação local e erro de concorrência.
- Modify: `src/services/portalProvisioning.ts` — extrair a chamada de
  `portal-invite-send` para uma função reutilizável pelo hook existente e pela
  Revisão, preservando o contrato atual.

### UI

- Create: `src/components/review/ReviewCustomerOnboarding.tsx` — formulário do
  grupo com busca de cliente existente, CNPJ, razão social, e-mail obrigatório e
  checkbox de convite desmarcado.
- Create: `src/components/review/ReviewDocumentEvidence.tsx` — exibição de
  `consignee_block`, `cargo_description`, candidatos de CNPJ e B/L de origem.
- Modify: `src/components/review/ReviewGroupBlock.tsx` — hierarquia por cliente,
  estados do onboarding, evidências, ação em lote e exceções.
- Modify: `src/components/review/ReviewDrawer.tsx` — remover o cadastro/vínculo
  duplicado de cliente do drawer e manter o drawer para correções específicas do
  B/L, exibindo a identidade do cliente como contexto.
- Modify: `src/pages/Revisao.tsx` — orquestrar onboarding de grupo, convite
  opcional, feedback imediato e navegação para o próximo grupo.
- Modify: `src/pages/__tests__/Revisao.test.tsx` — comportamento da fila por
  cliente, onboarding e exceções.
- Create: `src/components/review/__tests__/ReviewCustomerOnboarding.test.tsx`
  — validação de campos, microcopy e checkbox do Portal.
- Create: `src/components/review/__tests__/ReviewDocumentEvidence.test.tsx` —
  renderização de evidências e conflito de CNPJ.

### Documentação

- Modify: `docs/modules/operacao-suporte.md` — atualizar anatomia, catálogo e
  invariantes de `/revisao`.
- Modify: `docs/RASTREABILIDADE.md` — registrar a nova mutation, RPC, helper de
  importação e efeitos de cache.
- Modify: `docs/ARCHITECTURE.md` — atualizar o parágrafo de Revisão e
  auto-faturamento se o novo onboarding alterar o dono do gate.
- Modify: `docs/spec/README.md` — remover a spec da tabela somente quando o plano
  estiver concluído e a spec for arquivada; não fazer isso durante a execução.

## Task 1: Fixar o modelo puro de identidade e agrupamento

**Files:**

- Modify: `src/pages/revisaoHelpers.ts`
- Modify: `src/lib/cnpj.ts`
- Modify: `src/hooks/useReview.ts`
- Test: `src/pages/__tests__/revisaoHelpers.test.ts`

- [ ] **Step 1: Escrever os testes de agrupamento que falham**

Adicionar casos com o helper de fixture existente:

```ts
it('usa CNPJ válido como identidade principal do grupo', () => {
  const groups = groupReviewItems([
    item({ id: 'BL1', customer: null, consignee: 'ALFA', manifest_customer_cnpj_cpf: '11222333000122' }),
    item({ id: 'BL2', customer: null, consignee: 'ALFA', manifest_customer_cnpj_cpf: '11.222.333/0001-22' }),
  ])

  expect(groups).toHaveLength(1)
  expect(groups[0].identityKind).toBe('document')
  expect(groups[0].items.map((row) => row.id)).toEqual(['BL1', 'BL2'])
})

it('agrupa por nome apenas para visualização quando não há CNPJ válido', () => {
  const group = groupReviewItems([
    item({ id: 'BL1', customer: null, consignee: 'Alfa Import', manifest_customer_cnpj_cpf: null }),
    item({ id: 'BL2', customer: null, consignee: ' alfa import ', manifest_customer_cnpj_cpf: 'invalido' }),
  ])[0]

  expect(group.identityKind).toBe('name')
  expect(group.canBulkOnboard).toBe(false)
})

it('segrega B/Ls do mesmo nome quando existem CNPJs diferentes', () => {
  const groups = groupReviewItems([
    item({ id: 'BL1', customer: null, consignee: 'Alfa', manifest_customer_cnpj_cpf: '11222333000122' }),
    item({ id: 'BL2', customer: null, consignee: 'Alfa', manifest_customer_cnpj_cpf: '55666777000144' }),
    item({ id: 'BL3', customer: null, consignee: 'Alfa', manifest_customer_cnpj_cpf: null }),
  ])

  expect(groups.map((group) => group.items.map((row) => row.id))).toEqual([
    ['BL1'],
    ['BL2'],
    ['BL3'],
  ])
})

it('encontra CNPJ válido no bloco do consignatário e na descrição da carga', () => {
  const row = item({
    consignee: 'Alfa',
    manifest_customer_cnpj_cpf: null,
    consignee_block: 'ALFA LTDA\nCNPJ: 11.222.333/0001-22',
    cargo_description: 'Carga geral. CNPJ 55.666.777/0001-44',
  })

  expect(getReviewItemDocumentCandidates(row)).toEqual([
    '11222333000122',
    '55666777000144',
  ])
})
```

- [ ] **Step 2: Rodar apenas a suíte de helpers e confirmar a falha**

Run: `npx vitest run src/pages/__tests__/revisaoHelpers.test.ts`

Expected: FAIL porque `ReviewGroup.identityKind`, `canBulkOnboard` e
`getReviewItemDocumentCandidates` ainda não existem e o agrupamento atual aceita
qualquer texto canônico como CNPJ.

- [ ] **Step 3: Implementar o modelo de grupo**

Adicionar ao `ReviewGroup`:

```ts
type ReviewIdentityKind = 'document' | 'name' | 'conflict'

export type ReviewGroup = {
  key: string
  cnpj: string | null
  displayName: string
  items: ReviewQueueItem[]
  identityKind: ReviewIdentityKind
  candidateCnpjs: string[]
  canBulkOnboard: boolean
}
```

Implementar `getReviewItemDocumentCandidates(item)` reunindo, sem duplicatas e
na ordem de aparição:

1. `manifest_customer_cnpj_cpf` quando `canonicalizeValidCnpj` retornar valor;
2. candidatos de `consignee_block` via `extractCnpjFromText`;
3. candidatos de `cargo_description` via a mesma regra de texto.

Como `extractCnpjFromText` atualmente retorna apenas um candidato, extrair uma
função pura em `src/lib/cnpj.ts` que retorne todos os matches válidos e manter
`extractCnpjFromText` como adapter que devolve o primeiro. A validação continua
centralizada em `isValidCnpj`/`canonicalizeValidCnpj`.

Alterar `groupReviewItems` para:

- agrupar por CNPJ válido quando todos os itens do subgrupo compartilham um
  único candidato;
- agrupar por `name:<nome>:missing` somente quando nenhum candidato existir;
- separar por `document:<cnpj>` quando o mesmo nome tiver candidatos distintos;
- marcar `identityKind: 'conflict'` e `canBulkOnboard: false` quando um único
  B/L contiver candidatos incompatíveis em suas evidências;
- permitir `canBulkOnboard` somente para `identityKind === 'document'` e
  ausência de conflito.

Preservar o agrupamento e o comportamento existentes de Granite, mas impedir
que o novo onboarding de cliente trate um grupo sem B/L comum como operação de
cadastro de B/L.

- [ ] **Step 4: Atualizar os tipos da fila com evidências explícitas**

Declarar em `ReviewQueueItem` os campos usados pela UI para evitar casts
espalhados:

```ts
consignee_block?: string | null
cargo_description?: string | null
manifest_customer_email?: string | null
```

Manter o `select('*')` do B/L, mas fazer o mapper retornar esses campos de modo
explícito nos dois testes de origem da fila. Para Granite, preencher evidências
como `null` e manter a ação existente.

- [ ] **Step 5: Rodar os testes e commitar o contrato puro**

Run: `npx vitest run src/pages/__tests__/revisaoHelpers.test.ts`

Expected: PASS.

Commit:

```bash
git add src/pages/revisaoHelpers.ts src/lib/cnpj.ts src/hooks/useReview.ts src/pages/__tests__/revisaoHelpers.test.ts
git commit -m "feat: modelar grupos seguros da revisao por cliente"
```

## Task 2: Criar o contrato SQL transacional do onboarding

**Files:**

- Create: `supabase/migrations/322_review_customer_group_onboarding.sql`
- Test: `src/services/__tests__/reviewCustomerGroupMigration.test.ts`

- [ ] **Step 1: Escrever o teste de contrato SQL**

O teste deve carregar a migration 322 e exigir os seguintes contratos:

```ts
expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.ensure_customer_contact_email/i)
expect(sql).toMatch(/ON CONFLICT|NOT EXISTS/i)
expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.complete_review_customer_group/i)
expect(sql).toMatch(/SECURITY DEFINER/i)
expect(sql).toMatch(/compute_bl_review_pendencies/i)
expect(sql).toMatch(/REVOKE ALL[\s\S]*complete_review_customer_group/i)
expect(sql).toMatch(/GRANT EXECUTE[\s\S]*TO authenticated/i)
expect(sql).toMatch(/import_bl_freight_transactional_legacy_205/i)
expect(sql).toMatch(/manifest_customer_email/i)
```

- [ ] **Step 2: Rodar o teste para confirmar que a migration ainda não existe**

Run: `npx vitest run src/services/__tests__/reviewCustomerGroupMigration.test.ts`

Expected: FAIL com ausência da migration 322 e das funções novas.

- [ ] **Step 3: Implementar o helper de contato idempotente**

Criar a função interna:

```sql
CREATE OR REPLACE FUNCTION public.ensure_customer_contact_email(
  p_customer_id BIGINT,
  p_email TEXT,
  p_contact_name TEXT DEFAULT 'Contato manifesto',
  p_purpose TEXT DEFAULT 'financeiro'
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
```

Normalizar `lower(trim(p_email))`, ignorar vazio, aceitar somente o formato de
e-mail já usado pelo Portal, inserir apenas quando não existir para o mesmo
cliente e retornar `true` somente quando uma linha nova for criada. Revogar
`PUBLIC`, `anon` e `authenticated`; a função será chamada apenas por RPCs
controladas e pela importação server-side.

- [ ] **Step 4: Implementar extração server-side de candidatos de CNPJ**

Criar helper privado na mesma migration que:

- recebe texto livre;
- encontra somente valores rotulados por `CNPJ` ou `CNPJ/CPF`, usando a forma
  pontuada ou os 14 caracteres canônicos;
- normaliza por `public.normalize_cnpj`;
- descarta valores que falham em `public.is_valid_cnpj`;
- retorna `TEXT[]` ordenado e sem duplicatas.

Criar uma função de composição para um B/L que una candidatos de
`manifest_customer_cnpj_cpf`, `consignee_block` e `cargo_description`. Ela será
usada pela RPC para revalidar os grupos enviados pelo frontend.

- [ ] **Step 5: Implementar `complete_review_customer_group`**

Usar esta assinatura estável:

```sql
CREATE OR REPLACE FUNCTION public.complete_review_customer_group(
  p_bl_ids TEXT[],
  p_customer_id BIGINT DEFAULT NULL,
  p_cnpj_cpf TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_group_name TEXT DEFAULT NULL,
  p_changed_by UUID DEFAULT NULL
) RETURNS JSONB
```

Dentro da função:

1. exigir `auth.uid()`, `is_active_user()` e `p_changed_by = auth.uid()`;
2. rejeitar lista vazia, CNPJ inválido, nome vazio ou e-mail inválido;
3. selecionar os B/Ls `FOR UPDATE`, exigir `review_status = 'pending_review'`
   e rejeitar qualquer ID ausente;
4. calcular para cada B/L o nome normalizado e os candidatos documentais;
5. rejeitar `PT409`/`22023` quando houver CNPJs incompatíveis, quando o nome do
   grupo não coincidir ou quando um B/L não pertencer à identidade enviada;
6. resolver `p_customer_id` quando informado e validar que seu CNPJ coincide;
7. quando não informado, inserir o cliente por CNPJ ou selecionar o cliente
   único já criado numa corrida, sem sobrescrever nome de cliente existente;
8. chamar `ensure_customer_contact_email` para o e-mail informado;
9. atualizar todos os B/Ls com `customer_id`, `customer_reconciliation_status =
   'reconciled'`, limpar `suggested_customer_id` e registrar auditoria;
10. calcular `compute_bl_review_pendencies` para cada B/L e atualizar o status
    canônico, preservando as pendências específicas;
11. retornar JSON com o cliente e uma lista `{ bl_id, review_status,
    pendencias, resolved }`.

Não chamar Edge Function de Portal dentro da RPC. O convite será disparado pelo
frontend somente após o retorno bem-sucedido.

- [ ] **Step 6: Atualizar o wrapper de importação atual**

Na migration 322, substituir o wrapper vigente de
`import_bl_freight_transactional(jsonb, uuid)` sem alterar a função histórica
`import_bl_freight_transactional_legacy_205`:

1. delegar para o legacy;
2. para cada B/L importado que tenha `customer_id` resolvido por documento e
   `manifest_customer_email` não vazio, chamar
   `ensure_customer_contact_email`;
3. chamar `apply_bl_review_gate_after_import` depois da inclusão dos contatos,
   para que o e-mail recém-inserido remova o bloqueio canônico imediatamente;
4. manter o retorno JSON e a sincronização da fila de reconciliação existentes;
5. preservar grants `authenticated` e revogar `PUBLIC`/`anon`.

O insert será idempotente: o mesmo B/L ou e-mail repetido não gera contato
duplicado nem nova pendência.

- [ ] **Step 7: Rodar o contrato e commitar a migration**

Run: `npx vitest run src/services/__tests__/reviewCustomerGroupMigration.test.ts`

Expected: PASS.

Commit:

```bash
git add supabase/migrations/322_review_customer_group_onboarding.sql src/services/__tests__/reviewCustomerGroupMigration.test.ts
git commit -m "feat: adicionar onboarding transacional de cliente na revisao"
```

## Task 3: Expor o contrato em services e hooks

**Files:**

- Create: `src/services/reviewCustomerGroup.ts`
- Create: `src/hooks/useReviewCustomerGroup.ts`
- Modify: `src/services/portalProvisioning.ts`
- Test: `src/services/__tests__/reviewCustomerGroup.test.ts`
- Modify: `src/types/database.ts` via geração oficial

- [ ] **Step 1: Escrever testes do service**

Cobrir estas chamadas:

```ts
it('envia o grupo e o e-mail exatamente como contrato da RPC', async () => {
  await completeReviewCustomerGroup({
    blIds: ['BL1', 'BL2'],
    customerId: null,
    cnpjCpf: '12.345.678/0001-95',
    name: 'Cliente Teste',
    email: ' Financeiro@EXAMPLE.COM ',
    groupName: 'Cliente Teste',
    changedBy: 'actor-1',
  })

  expect(mockRpc).toHaveBeenCalledWith('complete_review_customer_group', {
    p_bl_ids: ['BL1', 'BL2'],
    p_customer_id: null,
    p_cnpj_cpf: '12345678000195',
    p_name: 'Cliente Teste',
    p_email: 'financeiro@example.com',
    p_group_name: 'Cliente Teste',
    p_changed_by: 'actor-1',
  })
})

it('converte conflito do banco em ConcurrentEditError', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'grupo alterado' } })
  await expect(completeReviewCustomerGroup(input)).rejects.toBeInstanceOf(ConcurrentEditError)
})
```

Adicionar também teste para `sendReviewPortalInvite(customerId, email)`
confirmando que `recovery_email` é exatamente o e-mail usado no onboarding e
que `recovery_email_source` é `informado_manualmente`.

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `npx vitest run src/services/__tests__/reviewCustomerGroup.test.ts`

Expected: FAIL porque o service e a função de convite reutilizável ainda não
existem.

- [ ] **Step 3: Implementar o service**

Definir:

```ts
export type CompleteReviewCustomerGroupInput = {
  blIds: string[]
  customerId: number | null
  cnpjCpf: string
  name: string
  email: string
  groupName: string
  changedBy: string
}

export type ReviewCustomerGroupResult = {
  customer: { id: number; cnpj_cpf: string; name: string }
  bls: Array<{ blId: string; reviewStatus: string | null; pendencias: string[]; resolved: boolean }>
}

export async function completeReviewCustomerGroup(input: CompleteReviewCustomerGroupInput): Promise<ReviewCustomerGroupResult>
export async function sendReviewPortalInvite(customerId: number, email: string): Promise<void>
```

Normalizar CNPJ por `canonicalizeValidCnpj`, normalizar e-mail por `trim().toLowerCase()`,
rejeitar campos vazios antes da RPC e mapear o JSON da RPC para o tipo acima.
Converter SQLSTATE `PT409` e `40001` em `ConcurrentEditError`; propagar
validações com `classifyDbError` preservado para a UI.

- [ ] **Step 4: Reutilizar o envio de convite existente**

Extrair de `src/hooks/usePortalProvisioning.ts` a chamada atual da Edge
Function para `src/services/portalProvisioning.ts`:

```ts
export async function sendPortalInvite(customerId: number, recoveryEmail: string, source: RecoveryEmailSource = 'informado_manualmente') {
  const { error } = await supabase.functions.invoke('portal-invite-send', {
    body: { customer_id: customerId, recovery_email: recoveryEmail, recovery_email_source: source },
  })
  if (error) throw error
}
```

Fazer `useSendPortalInvite` chamar essa função, mantendo a mesma invalidação da
fila do Portal. `sendReviewPortalInvite` será apenas um adapter para a tela de
Revisão e não lerá nem administrará o status retornado.

- [ ] **Step 5: Implementar a mutation do grupo**

`useReviewCustomerGroup` deve expor `mutateAsync` que:

1. chama `completeReviewCustomerGroup`;
2. se `sendPortalInvite` for `true`, chama `sendReviewPortalInvite` com o ID do
   cliente retornado e o mesmo e-mail normalizado;
3. invalida `['review-queue']`, `['customers']`, `['customer-lookup']`,
   `['bls']` e `PORTAL_PROVISIONING_QUERY_KEY` após o onboarding;
4. não faz rollback nem segunda tentativa automática do convite.

Se o onboarding concluir e o convite falhar, a mutation deve retornar um
resultado discriminado `{ onboarding: 'completed', portalInvite: 'failed' }`
para a UI mostrar apenas o feedback imediato e não bloquear o cadastro já
concluído.

- [ ] **Step 6: Regenerar tipos e rodar testes**

Regenerar `src/types/database.ts` pelo procedimento oficial do projeto, conferir
as assinaturas de `complete_review_customer_group` e do helper usado pelo app e
rodar:

Run: `npx vitest run src/services/__tests__/reviewCustomerGroup.test.ts src/services/__tests__/customerCreateAtomic.test.ts`

Expected: PASS.

Commit:

```bash
git add src/services/reviewCustomerGroup.ts src/hooks/useReviewCustomerGroup.ts src/services/portalProvisioning.ts src/services/__tests__/reviewCustomerGroup.test.ts src/types/database.ts
git commit -m "feat: expor onboarding de grupo e convite opcional"
```

## Task 4: Construir o onboarding e as evidências no grupo

**Files:**

- Create: `src/components/review/ReviewCustomerOnboarding.tsx`
- Create: `src/components/review/ReviewDocumentEvidence.tsx`
- Modify: `src/components/review/ReviewGroupBlock.tsx`
- Test: `src/components/review/__tests__/ReviewCustomerOnboarding.test.tsx`
- Test: `src/components/review/__tests__/ReviewDocumentEvidence.test.tsx`

- [ ] **Step 1: Escrever os testes de comportamento dos componentes**

O formulário deve:

- renderizar “E-mail principal do cliente” como obrigatório;
- renderizar “Enviar convite do Portal para este mesmo e-mail” desmarcado;
- mostrar o e-mail confirmado no texto de apoio quando preenchido;
- desabilitar o submit sem CNPJ, nome ou e-mail;
- emitir `onSubmit` com `sendPortalInvite: false` por padrão;
- emitir `sendPortalInvite: true` somente após o clique explícito.

O componente de evidências deve renderizar `consignee_block`,
`cargo_description`, B/L de origem e os candidatos de CNPJ; em conflito, deve
mostrar a mensagem de segregação e não exibir ação de vínculo.

- [ ] **Step 2: Rodar os testes e confirmar a falha**

Run: `npx vitest run src/components/review/__tests__/ReviewCustomerOnboarding.test.tsx src/components/review/__tests__/ReviewDocumentEvidence.test.tsx`

Expected: FAIL porque os componentes ainda não existem.

- [ ] **Step 3: Implementar o formulário de onboarding**

Usar as primitivas existentes `Field`, `Input`, `Button` e `Card`. O componente
recebe:

```ts
type ReviewCustomerOnboardingProps = {
  group: ReviewGroup
  existingCustomerId: number | null
  existingCustomer: ReviewCustomer | null
  initialName: string
  initialCnpj: string
  initialEmail: string
  saving: boolean
  onSelectExistingCustomer: (customer: ReviewCustomer) => void
  onSubmit: (input: { customerId: number | null; cnpjCpf: string; name: string; email: string; sendPortalInvite: boolean }) => void
}
```

Usar `useCustomerLookup` com busca habilitada somente depois de dois caracteres
e, para o grupo sem CNPJ, somente depois que o CNPJ informado passar em
`canonicalizeValidCnpj`. A busca deve mostrar nome e CNPJ e nunca selecionar
automaticamente uma sugestão por nome. Ao selecionar um cliente existente,
mostrar seus contatos de e-mail, exigir novo e-mail quando a lista estiver
vazia e manter o CNPJ do cliente como valor confirmado. Usar a microcopy
aprovada, preservar o checkbox desmarcado em cada novo grupo, mostrar `Criar
cliente e vincular N B/Ls` para cliente novo e `Adicionar e-mail e vincular N
B/Ls` para cliente existente sem e-mail.

- [ ] **Step 4: Implementar evidências e estado de conflito**

`ReviewDocumentEvidence` deve usar uma lista compacta por B/L, com blocos
colapsáveis para texto bruto longo, e nunca truncar silenciosamente o conteúdo:
mostrar no mínimo o início com ação “ver completo”. Candidatos de CNPJ devem
ser formatados por `formatCnpj`; valores inválidos devem aparecer como texto
extraído, mas nunca como opção de vínculo.

- [ ] **Step 5: Integrar no cabeçalho do grupo**

Em `ReviewGroupBlock`:

- manter o grupo como unidade visual primária;
- mostrar `CNPJ pendente`, `CNPJ conflitante`, `E-mail pendente`, `Cliente
  vinculado` ou `Exceções de B/L`;
- renderizar onboarding somente para grupos de B/L com `canBulkOnboard` ou para
  o estado de CNPJ pendente que tenha uma ação de informar CNPJ;
- renderizar evidências antes do formulário quando a identidade estiver
  pendente/conflitante;
- deixar a tabela interna para exceções específicas com ação `Revisar B/L`;
- conservar o caminho atual de Granite sem aplicar automaticamente a RPC de
  onboarding de B/L a registros `source: 'granite'`.

- [ ] **Step 6: Rodar os testes dos componentes e commitar a camada visual**

Run: `npx vitest run src/components/review/__tests__/ReviewCustomerOnboarding.test.tsx src/components/review/__tests__/ReviewDocumentEvidence.test.tsx`

Expected: PASS.

Commit:

```bash
git add src/components/review/ReviewCustomerOnboarding.tsx src/components/review/ReviewDocumentEvidence.tsx src/components/review/ReviewGroupBlock.tsx src/components/review/__tests__
git commit -m "feat: adicionar onboarding e evidencias por grupo"
```

## Task 5: Reorientar a página e o drawer para o cliente

**Files:**

- Modify: `src/pages/Revisao.tsx`
- Modify: `src/components/review/ReviewDrawer.tsx`
- Modify: `src/components/review/reviewCaches.ts`
- Modify: `src/pages/__tests__/Revisao.test.tsx`

- [ ] **Step 1: Escrever os testes da página**

Cobrir estes fluxos com mocks de `useReviewQueue`, `useReviewCustomerGroup` e
`useAuth`:

```ts
it('cria e vincula todos os B/Ls do grupo', async () => {
  render(<Revisao />)
  await user.click(screen.getByRole('button', { name: /criar cliente e vincular 2 bls/i }))
  expect(completeGroup).toHaveBeenCalledWith(expect.objectContaining({ blIds: ['BL1', 'BL2'] }))
})

it('não permite vínculo em grupo sem CNPJ ou com conflito', () => {
  render(<Revisao />)
  expect(screen.getByText(/nenhum vínculo permitido/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /vincular/i })).not.toBeInTheDocument()
})

it('mantém somente exceções de B/L após o onboarding', async () => {
  completeGroup.mockResolvedValue({
    customer: { id: 8, cnpj_cpf: '12345678000195', name: 'Alfa' },
    bls: [
      { blId: 'BL1', reviewStatus: 'reviewed', pendencias: [], resolved: true },
      { blId: 'BL2', reviewStatus: 'pending_review', pendencias: ['Peso BB'], resolved: false },
    ],
    portalInvite: 'not_requested',
  })
  render(<Revisao />)
  await user.click(screen.getByRole('button', { name: /criar cliente e vincular/i }))
  expect(await screen.findByText('Peso BB')).toBeInTheDocument()
  expect(screen.queryByText('BL1')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Rodar a suíte da página e confirmar a falha**

Run: `npx vitest run src/pages/__tests__/Revisao.test.tsx`

Expected: FAIL porque a página ainda cria cliente no drawer e não conhece a
mutation de grupo.

- [ ] **Step 3: Integrar a mutation na página**

Em `Revisao.tsx`:

1. obter `mutateAsync` do hook `useReviewCustomerGroup`;
2. passar callback de onboarding para `ReviewGroupBlock`;
3. enviar todos os IDs `source: 'bl'` do grupo, o cliente selecionado quando
   houver, CNPJ, nome, e-mail e ator autenticado;
4. após sucesso, invalidar a fila e selecionar o próximo grupo sem pular itens;
5. mostrar resumo “N B/Ls vinculados; M ainda com pendências”;
6. se o convite falhar, mostrar “Cliente cadastrado e B/Ls vinculados; não foi
   possível iniciar o convite do Portal” e não reabrir o cadastro;
7. tratar `ConcurrentEditError` recarregando a fila e informando o operador.

Manter a automação de cálculo/faturamento existente somente depois que o gate de
cada B/L retornar resolvido; não mover essa responsabilidade para o novo RPC
sem uma decisão posterior de faturamento.

- [ ] **Step 4: Remover o cadastro duplicado do drawer**

Em `ReviewDrawer.tsx`:

- remover estados `newCustomerName`, `newCustomerCnpj`, `newCustomerEmail` e
  `handleCreateCustomer`;
- remover busca/criação de cliente do formulário de revisão individual;
- exibir cliente/CNPJ/e-mail como contexto somente leitura;
- manter campos operacionais, justificativa, navegação anterior/próximo e o
  salvamento individual por `save_bl_review`;
- manter Granite no caminho `saveGraniteBlReview`.

Isso garante um único dono da decisão de identidade: o grupo na fila.

- [ ] **Step 5: Atualizar invalidações e rodar testes da página**

`reviewCaches.ts` deve invalidar, após onboarding:

```ts
['review-queue']
['customers']
['customer-lookup']
['bls']
['local-charge-pendencies']
['portal-provisioning']
```

Run: `npx vitest run src/pages/__tests__/Revisao.test.tsx`

Expected: PASS.

Commit:

```bash
git add src/pages/Revisao.tsx src/components/review/ReviewDrawer.tsx src/components/review/reviewCaches.ts src/pages/__tests__/Revisao.test.tsx
git commit -m "feat: orientar revisao manual por cliente"
```

## Task 6: Validar a importação automática de e-mails

**Files:**

- Modify: `src/services/__tests__/blFreightImport.test.ts`
- Modify: `src/services/__tests__/reviewGateHardeningMigration.test.ts` somente
  se o contrato de gate precisar de uma asserção adicional
- Modify: `src/services/__tests__/reviewCustomerGroupMigration.test.ts`

- [ ] **Step 1: Adicionar teste de comportamento do importador**

Cobrir um payload com `customer_id` resolvido por CNPJ e
`manifest_customer_email` diferente de um contato já existente. A asserção
deve garantir que a função de importação chama a operação de contato de forma
idempotente e que uma segunda importação do mesmo e-mail não cria duplicata.

- [ ] **Step 2: Adicionar o contrato de recálculo do gate**

Exigir que o wrapper de importação inclua a sequência:

```sql
ensure_customer_contact_email(...);
apply_bl_review_gate_after_import(...);
sync_customer_reconciliation_queue_for_bl(...);
```

O teste deve falhar se a migration adicionar o contato depois do cálculo final
sem reavaliar o B/L.

- [ ] **Step 3: Rodar os testes de importação e contrato**

Run: `npx vitest run src/services/__tests__/blFreightImport.test.ts src/services/__tests__/reviewCustomerGroupMigration.test.ts`

Expected: PASS.

Commit:

```bash
git add src/services/__tests__ supabase/migrations/322_review_customer_group_onboarding.sql
git commit -m "test: garantir enriquecimento idempotente de emails na importacao"
```

## Task 7: Atualizar documentação viva e rastreabilidade

**Files:**

- Modify: `docs/modules/operacao-suporte.md`
- Modify: `docs/RASTREABILIDADE.md`
- Modify: `docs/ARCHITECTURE.md`
- Test: `npm run docs:check`

- [ ] **Step 1: Atualizar `/revisao` na documentação do módulo**

Em `docs/modules/operacao-suporte.md`, registrar:

- grupos por CNPJ/nome provisório;
- segregação de CNPJs conflitantes;
- onboarding com CNPJ, razão social e e-mail;
- convite opcional para o mesmo e-mail;
- exceções de B/L aninhadas;
- operação transacional e retorno por B/L.

Adicionar cada ação no catálogo com pré-condições, origem, RPC/service,
persistência, caches e falhas conforme `docs/CONVENCOES.md`.

- [ ] **Step 2: Atualizar rastreabilidade**

Em `docs/RASTREABILIDADE.md`, apontar:

- `ReviewCustomerOnboarding` e `ReviewDocumentEvidence`;
- `useReviewCustomerGroup` e `reviewCustomerGroup.ts`;
- `complete_review_customer_group`;
- `ensure_customer_contact_email` e o wrapper da importação;
- `portal-invite-send` como chamada opcional posterior;
- queries invalidadas e limites de escopo.

- [ ] **Step 3: Atualizar arquitetura**

Em `docs/ARCHITECTURE.md`, deixar explícito que o gate continua canônico por
B/L, mas a superfície de trabalho da Revisão é o grupo de cliente e que o
onboarding de grupo não administra o ciclo de vida do Portal.

- [ ] **Step 4: Rodar validação documental**

Run: `npm run docs:check`

Expected: `Documentation checks passed`.

Commit:

```bash
git add docs/modules/operacao-suporte.md docs/RASTREABILIDADE.md docs/ARCHITECTURE.md
git commit -m "docs: rastrear onboarding de cliente na revisao"
```

## Task 8: Verificação integrada e handoff

**Files:**

- No novo arquivo; somente correções nos arquivos já listados quando os checks
  encontrarem drift.

- [ ] **Step 1: Rodar os testes focados em sequência**

Run:

```bash
npx vitest run \
  src/pages/__tests__/revisaoHelpers.test.ts \
  src/pages/__tests__/Revisao.test.tsx \
  src/components/review/__tests__/ReviewCustomerOnboarding.test.tsx \
  src/components/review/__tests__/ReviewDocumentEvidence.test.tsx \
  src/services/__tests__/reviewCustomerGroup.test.ts \
  src/services/__tests__/reviewCustomerGroupMigration.test.ts
```

Expected: PASS.

- [ ] **Step 2: Rodar a validação completa exigida pelo projeto**

Run:

```bash
npm run docs:check
npm run lint
npm test
npm run build
```

Expected: todos os comandos terminam com código 0. Se `npm run build` acusar
drift de `src/types/database.ts`, regenerar os tipos pelo procedimento oficial
antes de repetir o build.

- [ ] **Step 3: Validar migration em PostgreSQL descartável**

Run: `bash scripts/setup-local-pg.sh --reset`

Depois aplicar o replay completo e conferir as assinaturas/grants da migration
317 no banco descartável. Nunca apontar esse passo para produção.

- [ ] **Step 4: Fazer smoke manual da tela**

Com dados controlados, validar:

1. grupo com CNPJ válido e cliente inexistente;
2. grupo sem CNPJ com evidência no `consignee_block`;
3. grupo sem CNPJ com evidência em `cargo_description`;
4. mesmo nome com dois CNPJs diferentes;
5. cliente existente sem e-mail;
6. e-mail diferente encontrado em importação;
7. convite desmarcado;
8. convite marcado com confirmação do mesmo endereço;
9. grupo que permanece somente com exceção de peso/CE;
10. conflito concorrente em dois operadores.

- [ ] **Step 5: Encerrar o plano**

Quando todos os checks estiverem verdes, mover esta spec para
`docs/archive/specs/` e este plano para `docs/archive/plans/` no mesmo change,
remover as linhas correspondentes dos READMEs, atualizar `docs/CHANGELOG.md` e
rodar `npm run docs:check` novamente.

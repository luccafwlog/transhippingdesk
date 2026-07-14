# Plano 2 — RBAC mínimo do Portal (matriz `can()` + telas do fluxo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a matriz de permissões para o modelo de quatro perfis confirmado no issue #370 e destravar o provisionamento para Documentação nas telas do fluxo do Portal — sem executar a auditoria RBAC global.

**Architecture:** A matriz central vive em `src/hooks/useAuth.tsx` (`roleHasPermission`). Este plano a corrige, adiciona as permissões `customers_edit` e `portal_provisioning`, e substitui `isAdmin` por `can()` SOMENTE em `ClienteFicha.tsx`, `Clientes.tsx` e `Revisao.tsx` (telas que participam do provisionamento). A autoridade real continua no backend: os RPCs do Portal (planos 1 e 5) validam papel; divergências de RLS fora do Portal ficam para a auditoria global.

**Tech Stack:** React/TypeScript, vitest.

**Escopo travado (decisão do mapa):** correções alheias ao Portal são frente separada. NÃO tocar em outras telas com `isAdmin` (Viagens, Baplie, Manifestos, Demurrage etc.) neste plano.

**Modelo confirmado (issue #370, seção Perfis internos):**
- Administrativo: tudo.
- Financeiro: visualização global; única ação é `reconciliacao_edit`.
- Operações: ações completas apenas em Viagens (`voyages_edit`); NÃO possui `manifests_upload`.
- Documentação: todas as ações de negócio (Clientes, Portal, B/Ls, Viagens, Faturamento, taxas, invoices, alertas), EXCETO `reconciliacao_edit`. Não administra usuários.

---

### Task 1: Corrigir a matriz `roleHasPermission`

**Files:**
- Modify: `src/hooks/useAuth.tsx:8-37`
- Test: `src/hooks/__tests__/roleHasPermission.test.ts` (novo)

- [x] **Step 1: Exportar a função e escrever o teste de contrato da matriz**

Em `useAuth.tsx`, troque `function roleHasPermission` por
`export function roleHasPermission` (necessário para o teste).

```typescript
import { describe, expect, it } from 'vitest'
import { roleHasPermission, type Permission } from '../useAuth'

const ALL: Permission[] = [
  'admin_panel', 'manage_users', 'charge_tables', 'charge_overrides',
  'demurrage_edit', 'faturamento_edit', 'reconciliacao_edit',
  'voyages_edit', 'manifests_upload', 'customers_edit', 'portal_provisioning',
]

describe('matriz RBAC do modelo de quatro perfis (issue #370)', () => {
  it('administrativo tem tudo', () => {
    for (const p of ALL) expect(roleHasPermission('administrativo', p)).toBe(true)
  })

  it('financeiro só concilia pagamentos', () => {
    for (const p of ALL) {
      expect(roleHasPermission('financeiro', p)).toBe(p === 'reconciliacao_edit')
    }
  })

  it('operacoes atua somente em viagens; não sobe manifesto/B/L', () => {
    for (const p of ALL) {
      expect(roleHasPermission('operacoes', p)).toBe(p === 'voyages_edit')
    }
  })

  it('documentacao faz todas as ações de negócio exceto conciliação e admin', () => {
    const allowed: Permission[] = [
      'charge_tables', 'charge_overrides', 'demurrage_edit', 'faturamento_edit',
      'voyages_edit', 'manifests_upload', 'customers_edit', 'portal_provisioning',
    ]
    for (const p of ALL) {
      expect(roleHasPermission('documentacao', p)).toBe(allowed.includes(p))
    }
  })

  it('papéis legados mapeiam: admin→administrativo, operator→documentacao', () => {
    expect(roleHasPermission('admin', 'manage_users')).toBe(true)
    expect(roleHasPermission('operator', 'portal_provisioning')).toBe(true)
    expect(roleHasPermission('operator', 'reconciliacao_edit')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- roleHasPermission`
Expected: FAIL (permissões novas inexistentes; matriz atual diverge)

- [x] **Step 3: Corrigir a matriz**

```typescript
export type Permission =
  | 'admin_panel'
  | 'manage_users'
  | 'charge_tables'
  | 'charge_overrides'
  | 'demurrage_edit'
  | 'faturamento_edit'
  | 'reconciliacao_edit'
  | 'voyages_edit'
  | 'manifests_upload'
  | 'customers_edit'
  | 'portal_provisioning'

export function roleHasPermission(role: UserProfileRole | undefined, permission: Permission): boolean {
  if (!role) return false
  // Legacy roles: admin = administrativo, operator = documentacao
  const effectiveRole: UserProfileRole =
    role === 'admin' ? 'administrativo' : role === 'operator' ? 'documentacao' : role

  switch (effectiveRole) {
    case 'administrativo':
      return true
    case 'financeiro':
      // Decisão #370: única ação do Financeiro é a conciliação de pagamentos.
      return permission === 'reconciliacao_edit'
    case 'operacoes':
      // Decisão #370: Operações atua em Viagens e não sobe/edita B/Ls.
      return permission === 'voyages_edit'
    case 'documentacao':
      // Decisão #370: todas as ações de negócio exceto conciliação e administração.
      return [
        'charge_tables', 'charge_overrides', 'demurrage_edit', 'faturamento_edit',
        'voyages_edit', 'manifests_upload', 'customers_edit', 'portal_provisioning',
      ].includes(permission)
    default:
      return false
  }
}
```

- [x] **Step 4: Rodar o teste novo e a suíte inteira**

Run: `npm test -- roleHasPermission && npm test`
Expected: teste novo PASS. Se testes existentes fixavam a matriz antiga
(ex.: financeiro com `faturamento_edit`), atualize-os para o modelo confirmado
— a mudança é intencional e decidida no issue #370, não um regressão.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAuth.tsx src/hooks/__tests__/roleHasPermission.test.ts
git commit -m "feat(rbac): matriz de quatro perfis conforme issue #370"
```

---

### Task 2: Destravar o fluxo do Portal nas telas (isAdmin → can)

**Files:**
- Modify: `src/pages/ClienteFicha.tsx` (7 usos de `isAdmin`)
- Modify: `src/pages/Clientes.tsx` (7 usos de `isAdmin`)
- Modify: `src/pages/Revisao.tsx` (3 usos de `isAdmin`)
- Test: `src/pages/__tests__/ClienteFicha.behavior.test.tsx` (existente — estender)

- [x] **Step 1: Mapear cada uso de `isAdmin` nas três telas**

Run: `grep -n "isAdmin" src/pages/ClienteFicha.tsx src/pages/Clientes.tsx src/pages/Revisao.tsx`

Classifique cada ocorrência:
- Ação de cadastro/edição de Cliente → `can('customers_edit')`
- Ação de provisionamento/Portal (provisionar, seção Portal da ficha) → `can('portal_provisioning')`
- Resolução de pendências na Revisão (vincular cliente, editar dados) → `can('customers_edit')`
- Se alguma ocorrência for genuinamente administrativa (ex.: exclusão destrutiva
  com regra própria), mantenha `isAdmin` e anote no commit o porquê.

- [ ] **Step 2: Estender o teste de comportamento da ficha**

Adicione ao `ClienteFicha.behavior.test.tsx` um caso com perfil `documentacao`
(siga o padrão de mock de auth já usado no arquivo — há casos com perfis
diferentes; replique-o):

```typescript
it('documentacao vê e opera as ações de cliente e portal', async () => {
  // arrange: mock de useAuth com effectiveRole 'documentacao',
  // can() real via roleHasPermission
  // assert: botões de edição de cliente e ação de portal visíveis/habilitados
})

it('financeiro vê a ficha sem ações de alteração', async () => {
  // assert: ações ocultas/desabilitadas; leitura permanece
})
```

Preencha o corpo seguindo o helper de render/mocks existente no próprio
arquivo de teste — não invente infraestrutura nova.

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -- ClienteFicha`
Expected: FAIL (ações ainda atrás de `isAdmin`)

- [x] **Step 4: Substituir `isAdmin` por `can()` conforme o mapeamento do Step 1**

Padrão de troca (exemplo):

```typescript
// antes
const { isAdmin } = useAuth()
{isAdmin && <Button onClick={openProvisionamento}>Provisionar Portal</Button>}

// depois
const { can } = useAuth()
{can('portal_provisioning') && <Button onClick={openProvisionamento}>Provisionar Portal</Button>}
```

- [x] **Step 5: Rodar testes e lint**

Run: `npm test -- ClienteFicha && npm test -- Clientes && npm test -- Revisao && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/pages/ClienteFicha.tsx src/pages/Clientes.tsx src/pages/Revisao.tsx src/pages/__tests__/
git commit -m "feat(rbac): telas do fluxo do portal usam can() em vez de isAdmin"
```

---

### Task 3: Registro do débito de auditoria global

**Files:**
- Modify: `docs/RASTREABILIDADE.md`
- Modify: `docs/modules/portal-cliente.md`

- [ ] **Step 1: Documentar** a matriz corrigida, as duas permissões novas e o
recorte: telas fora do fluxo do Portal continuam com `isAdmin` até a auditoria
RBAC global (frente separada, decisão do issue #370). Listar os arquivos ainda
pendentes (saída do grep de `isAdmin`) como referência para essa frente.

- [ ] **Step 2: Verificar e commitar**

Run: `npm run docs:check`
Expected: PASS

```bash
git add docs/RASTREABILIDADE.md docs/modules/portal-cliente.md
git commit -m "docs(rbac): matriz de quatro perfis e débito da auditoria global"
```

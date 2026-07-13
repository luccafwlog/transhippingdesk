# Plano 7 — Console operacional do Portal do Cliente

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a superfície dedicada Clientes → Portal do Cliente (`/clientes/portal`): fila dos 309 Clientes com filtros, presets, indicadores e painel lateral de revisão individual, mais a seção Portal do Cliente na ficha.

**Architecture:** Página nova `ClientesPortal.tsx` sobre o serviço/hook do plano 1 (`portalProvisioning`), estendidos aqui com candidatos de email, detecção de email compartilhado, alertas e ordenação de prioridade. Ações individuais chamam as Edge Functions/RPCs dos planos 5 (convite, cancelamento, suspensão, exceção). Painel lateral mantém a fila visível. A ficha (`ClienteFicha.tsx`) ganha a seção específica. Sem ações em lote (decisão do mapa).

**Tech Stack:** React, TanStack React Query (skill `react-query-pattern`), FilterBar do projeto (padrão consolidado no PR #371 — ver `src/pages/Painel.tsx` como referência de uso).

**Leitura obrigatória:** issue #370 seção "Console operacional — decisão desta frente"; `CONTEXT.md` ("Seção Portal do Cliente da Ficha", "Email candidato para o Portal", "Abertura geral gradual"); planos 1, 5 e 6.

**Regras que este plano implementa (não desviar):**
- Filtro inicial na abertura: `Aguardando análise`.
- Ordenação padrão: exceções críticas → saldo/fatura aberto → processo/B/L ativo → atividade recente → históricos → `Provisionamento não necessário` por último. Visual apenas; sem dados de processo/faturamento, usa os critérios seguintes.
- Candidatos de email com finalidade (papel: geral/financeiro/operacional) e origem; NUNCA seleção automática; candidato ≠ autorização.
- Email compartilhado com outro CNPJ: alerta visível, permitido após análise.
- `Enviar convite` desabilitado sem Email de Recuperação selecionado/informado; ao prosseguir, alerta de autorização (o clique auditado basta — sem checkbox).
- Ações sempre individuais; seleção múltipla só para filtro/exportação.
- Financeiro visualiza tudo, não altera; ações seguem `can('portal_provisioning')` (plano 2).

---

### Task 1: Estender o serviço com candidatos, prioridade e indicadores

**Files:**
- Modify: `src/services/portalProvisioning.ts`
- Test: `src/services/__tests__/portalProvisioning.test.ts` (estender)

- [ ] **Step 1: Teste da ordenação de prioridade**

```typescript
import { comparePriority, type QueueRow } from '../portalProvisioning'

function row(partial: Partial<QueueRow>): QueueRow {
  return {
    hasCriticalAlert: false, hasOpenInvoice: false, hasActiveProcess: false,
    lastActivityAt: null, decision: 'aguardando_analise',
    ...partial,
  } as QueueRow
}

describe('comparePriority (ordem do issue #370)', () => {
  it('exceção crítica vem antes de tudo', () => {
    expect(comparePriority(row({ hasCriticalAlert: true }), row({ hasOpenInvoice: true }))).toBeLessThan(0)
  })
  it('fatura aberta antes de processo ativo', () => {
    expect(comparePriority(row({ hasOpenInvoice: true }), row({ hasActiveProcess: true }))).toBeLessThan(0)
  })
  it('processo ativo antes de atividade recente', () => {
    expect(comparePriority(row({ hasActiveProcess: true }), row({ lastActivityAt: '2026-07-01' }))).toBeLessThan(0)
  })
  it('provisionamento não necessário sempre por último', () => {
    expect(comparePriority(row({ decision: 'provisionamento_nao_necessario', hasOpenInvoice: true }), row({}))).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- portalProvisioning`
Expected: FAIL (`comparePriority` inexistente)

- [ ] **Step 3: Implementar**

```typescript
export type QueueRow = PortalProvisioningRow & {
  hasCriticalAlert: boolean
  hasOpenInvoice: boolean
  hasActiveProcess: boolean
  lastActivityAt: string | null
  candidates: EmailCandidate[]
  sharedEmailCnpjs: string[]   // outros CNPJs que usam o mesmo recovery_email
}

export type EmailCandidate = {
  email: string
  purpose: 'geral' | 'financeiro' | 'operacional' | 'faturamento'
  origin: string               // ex.: 'Contato do Cliente'
}

// Ordenação padrão do Console (issue #370). Puramente visual.
export function comparePriority(a: QueueRow, b: QueueRow): number {
  const rank = (r: QueueRow): number => {
    if (r.decision === 'provisionamento_nao_necessario') return 6
    if (r.hasCriticalAlert) return 0
    if (r.hasOpenInvoice) return 1
    if (r.hasActiveProcess) return 2
    if (r.lastActivityAt) return 3
    return 4 // cliente histórico
  }
  const d = rank(a) - rank(b)
  if (d !== 0) return d
  // desempate: atividade mais recente primeiro, depois nome
  return (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')
}
```

Enriquecimento dos dados (dentro de `listPortalProvisioningQueue()`):
- `candidates`: `customer_contacts` do cliente com `email IS NOT NULL`
  (campos `email`, `purpose`); origem fixa "Contato do Cliente".
- `sharedEmailCnpjs`: agrupar as linhas por `lower(recovery_email)` e listar
  os demais CNPJs do grupo.
- `hasCriticalAlert`: alertas abertos dos tipos críticos do plano 6 para o
  cliente ou suas faturas.
- `hasOpenInvoice`/`hasActiveProcess`/`lastActivityAt`: reutilizar consultas
  existentes de faturamento/B/L (grep `useOperationalCounts` e
  `src/services/billing.ts`); se o banco não tiver dados (situação atual de
  produção), os campos ficam falsos/null e a fila ordena pelos critérios
  seguintes — comportamento decidido no mapa.

- [ ] **Step 4: Rodar e ver passar; commit**

Run: `npm test -- portalProvisioning && npm run lint`
Expected: PASS

```bash
git add src/services/portalProvisioning.ts src/services/__tests__/portalProvisioning.test.ts
git commit -m "feat(portal): fila do console com prioridade e candidatos"
```

---

### Task 2: Página `/clientes/portal` — fila, filtros, presets, indicadores

**Files:**
- Create: `src/pages/ClientesPortal.tsx`
- Modify: `src/App.tsx` (rota `/clientes/portal`, lazy + `withSuspense`, dentro do ProtectedRoute interno)
- Modify: `src/components/layout/AppLayout.tsx` (item de menu Clientes → Portal do Cliente)
- Test: `src/pages/__tests__/ClientesPortal.behavior.test.tsx`

- [ ] **Step 1: Teste de comportamento (padrão dos behavior tests existentes)**

Casos mínimos:

```typescript
// 1. abre com filtro 'Aguardando análise' aplicado (decisão do mapa)
// 2. indicadores do topo: total, pendências críticas, aguardando análise,
//    sem email, convites pendentes, convites expirados, falhas de envio,
//    contas ativas, provisionamento não necessário — clicar aplica o filtro
// 3. linha mostra situação, decisão, email, alertas e próxima ação
// 4. perfil financeiro: fila visível, ações ocultas/desabilitadas
// 5. deep-link /clientes/portal?cliente=123 abre o painel do cliente 123
//    (é o link usado pelos alertas — plano 6)
```

- [ ] **Step 2: Implementar a página**

Estrutura (siga o padrão visual/técnico de `Painel.tsx` + FilterBar):
- Indicadores clicáveis no topo (cards com contagem; derivar da fila carregada).
  "Pendências críticas" = fatura/processo sem Portal + convite expirado +
  falha de entrega (tipos do plano 6).
- FilterBar com filtros combináveis: situação da conta; decisão;
  disponibilidade de email (com/sem candidato, com/sem selecionado);
  email compartilhado; alertas; prioridade; busca por razão social/fantasia/CNPJ.
- Presets rápidos (chips): Pendências críticas, Aguardando análise, Sem email,
  Convites expirados, Falhas de envio, Contas ativas, Provisionamento não necessário.
- Tabela ordenada por `comparePriority`; cada linha com próxima ação sugerida
  (ex.: "Revisar email", "Reenviar convite") derivada de situação+decisão+alertas.
- Seleção múltipla APENAS para exportação CSV (reutilizar `useRowSelection` +
  `src/services/exports.ts`); nenhuma ação de Portal em lote.
- Clicar na linha abre o painel lateral (Task 3) mantendo a fila visível.
- Estado do filtro na URL (`usePageFilters` se aplicável) para suportar o
  deep-link dos alertas.

- [ ] **Step 3: Rodar, lint, commit**

Run: `npm test -- ClientesPortal && npm run lint`
Expected: PASS

```bash
git add src/pages/ClientesPortal.tsx src/App.tsx src/components/layout/AppLayout.tsx src/pages/__tests__/ClientesPortal.behavior.test.tsx
git commit -m "feat(portal): console operacional com fila, filtros e indicadores"
```

---

### Task 3: Painel lateral de revisão individual

**Files:**
- Create: `src/components/portal/PortalReviewPanel.tsx`
- Test: `src/components/portal/__tests__/PortalReviewPanel.test.tsx`

- [ ] **Step 1: Teste de comportamento**

```typescript
// 1. mostra CNPJ, candidatos (com finalidade e origem), email selecionado,
//    estado/decisão, última tentativa, alertas e próxima ação
// 2. 'Enviar convite' desabilitado sem email selecionado/informado
// 3. escolher candidato OU digitar novo email habilita o botão; digitado novo
//    exibe aviso de que será o Email de Recuperação, separado dos contatos
// 4. email igual ao de outro CNPJ mostra alerta visível, mas permite prosseguir
// 5. clicar Enviar abre confirmação com o alerta de autorização
//    ("você confirma que este email pertence a pessoa autorizada") —
//    confirmar dispara a chamada; sem checkbox adicional
// 6. ações Reenviar/Cancelar/Suspender/Exceção aparecem conforme a situação
//    (reenviar: pendente/expirado/falha; cancelar: pendente; exceção: sem_conta)
//    e exigem justificativa quando a regra pede
// 7. link "Abrir ficha completa" para /clientes/:cnpj
```

- [ ] **Step 2: Implementar o painel**

Drawer/painel lateral (siga o componente de painel/modal lateral já usado no
projeto — grep `Drawer\|SidePanel` em `src/components/`; se não houver,
use o padrão do modal de detalhe mais próximo, mantendo a fila visível).
Mutations via hooks do plano 1 + chamadas às Edge Functions do plano 5
(`portal-invite-send`, `portal-account-suspend`) e RPC `portal_cancel_invite`.
Após cada ação: invalidar a query da fila e avançar o foco para o próximo
Cliente da fila (decisão do mapa: revisão contínua).

- [ ] **Step 3: Rodar, lint, commit**

Run: `npm test -- PortalReviewPanel && npm run lint`
Expected: PASS

```bash
git add src/components/portal/
git commit -m "feat(portal): painel lateral de revisão individual"
```

---

### Task 4: Seção Portal do Cliente na ficha

**Files:**
- Modify: `src/pages/ClienteFicha.tsx`
- Test: `src/pages/__tests__/ClienteFicha.behavior.test.tsx` (estender)

- [ ] **Step 1: Teste**

```typescript
// A ficha exibe seção 'Portal do Cliente' com: Email de Recuperação
// identificado + como foi escolhido (candidato vs informado manualmente),
// situação da conta, decisão, convite vigente (com vencimento), alertas
// abertos e histórico operacional (portal_provisioning_events do cliente,
// mais recente primeiro). Ações reutilizam o PortalReviewPanel.
```

- [ ] **Step 2: Implementar** reutilizando `PortalReviewPanel` (mesmo
componente embutido na ficha — evita referências divergentes, decisão do mapa)
e um hook `usePortalEvents(customerId)` novo em
`src/hooks/usePortalProvisioning.ts` que lê `portal_provisioning_events`.

- [ ] **Step 3: Rodar, lint, commit**

Run: `npm test -- ClienteFicha && npm run lint && npm test && npm run build`
Expected: PASS

```bash
git add src/pages/ClienteFicha.tsx src/hooks/usePortalProvisioning.ts src/pages/__tests__/
git commit -m "feat(portal): seção portal do cliente na ficha"
```

---

### Task 5: Pré-voo e backfill na UI (`/admin`)

**Files:**
- Modify: `src/pages/AdminUsuarios.tsx` OU criar `src/pages/AdminPortalBackfill.tsx` (rota nova sob `/admin` — escolha conforme a estrutura de subabas existente em `/admin`)

- [ ] **Step 1: Implementar** a tela exclusiva do Administrativo: botão
"Executar pré-voo" mostra os totais de `portal_provisioning_preflight()`
lado a lado com os valores esperados; o botão "Executar backfill" só habilita
após o pré-voo ser exibido e o Administrador confirmar num diálogo que os
totais conferem (divergência = não prosseguir — decisão do mapa). Resultado
exibe `created_records`.

- [ ] **Step 2: Rodar, lint, commit**

Run: `npm test && npm run lint`
Expected: PASS

```bash
git add src/pages/
git commit -m "feat(portal): pré-voo e backfill no admin"
```

---

### Task 6: Documentação viva

- Modify: `docs/ARCHITECTURE.md` (rota nova), `docs/RASTREABILIDADE.md`
  (rota→componentes→hooks→serviços→RPCs→testes), `docs/modules/portal-cliente.md`.

- [ ] **Step 1: Atualizar e verificar**

Run: `npm run docs:check`
Expected: PASS

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "docs(portal): console operacional e seção da ficha"
```

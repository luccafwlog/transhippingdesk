# Portal do Cliente — Review Remediation Plan

> Plano/snapshot de decisão, não verdade corrente. A autoridade executável é o
> código. Base de decisão: revisão de código
> [portal-cliente-review-2026-07-07](../archive/portal-cliente-review-2026-07-07.md)
> (registro histórico, imutável). Este plano consolida os achados daquela
> revisão em fatias revisáveis e independentes.

**Goal:** Fechar as quatro falhas de alta gravidade do portal — ciclo de vida
de sessão (E1), cache entre clientes (A1), Dashboard silenciando falha (E2) e
observabilidade zero (O1) — e em seguida pagar as dívidas médias de contrato de
tipos, UX de erro e consistência, **sem mudança de schema nem de RPC** (exceto
onde indicado como pergunta aberta).

**Architecture:** Todas as fatias respeitam a direção `pages → hooks →
services` e o isolamento do cliente `supabasePortal`
(`src/services/supabase.ts`). Nenhuma migration prevista. As fatias 1–3 são o
núcleo (prioridade); 4–6 são qualidade incremental e podem ser mergeadas em
qualquer ordem após a 1.

**Tech Stack:** TypeScript, React 19, TanStack Query v5, Supabase JS v2,
Sentry (`@sentry/react`), Vitest.

**Fontes de verdade:** `CONTEXT.md` · `docs/ARCHITECTURE.md` ·
`docs/RASTREABILIDADE.md` · `docs/CONVENCOES.md` ·
[revisão 2026-07-07](../archive/portal-cliente-review-2026-07-07.md) ·
skills `react-query-pattern` e `supabase-migration`.

---

## Mapa achado → fatia

| Achado | Gravidade | Fatia |
|--------|-----------|-------|
| E1 sessão expirada / multi-aba sem detecção | 🟠 ALTA | Slice 1 |
| A1 cache react-query sobrevive ao logout | 🟠 ALTA | Slice 1 |
| A3 sessão de recuperação persistida pós-reset | 🟡 MÉDIA | Slice 1 |
| E2 Dashboard mostra R$ 0,00 em falha | 🟠 ALTA | Slice 2 |
| E3 aba Demurrage ignora erro | 🟡 MÉDIA | Slice 2 |
| E4 falha de rede vira "credenciais inválidas" | 🟡 MÉDIA | Slice 2 |
| U3/E5 `error.message` cru exposto ao cliente | 🔵 BAIXA | Slice 2 |
| O1 Sentry sem contexto do portal | 🟠 ALTA | Slice 3 |
| O2 ações críticas sem trilha (confirmar server-side) | 🟡 MÉDIA | Slice 3 |
| M1 RPCs fora de `Database['Functions']` + casts | 🟡 MÉDIA | Slice 4 |
| M3/M4 duplicação de status e wrappers rpc | 🔵 BAIXA | Slice 4 |
| A2/E6 PortalProfile sem react-query e efeito destrutivo | 🟡 MÉDIA | Slice 5 |
| U1 focus trap estático / sem restauração de foco | 🟡 MÉDIA | Slice 5 |
| U2, U4, U5, U6 ajustes pontuais de UX | 🔵 BAIXA | Slice 5 |
| M2 quebrar `PortalBilling.tsx` (774 linhas) | 🟡 MÉDIA | Slice 6 |
| P1 paginação nas listas de faturas | 🟡 MÉDIA | Slice 6 |
| C1 cores hardcoded no `ShipScheduleWidget` | 🔵 BAIXA | Slice 6 |
| C2 `PortalOperacao` sem cards mobile | 🔵 BAIXA | Slice 6 |
| A4, A5, P2, P3, P4, U7, M5, D2 | 🔵/⚪ | Backlog (fora deste plano) |

---

## Slice 1 — Ciclo de vida da sessão do portal (E1, A1, A3)

A fatia mais importante: uma causa raiz (ausência de listener de auth) e dois
vazamentos de estado (cache e sessão de recuperação).

- [ ] **Listener de auth (E1).** Em `src/hooks/usePortalAuth.tsx`, registrar
  `supabasePortal.auth.onAuthStateChange` no `PortalAuthProvider`:
  - `SIGNED_OUT` (inclui logout em outra aba e falha de refresh) → `clearSession()`.
  - `SIGNED_IN`/`TOKEN_REFRESHED` sem `overview` carregado → re-hidratar via `fetchOverview()` (guardando contra corrida com o `hydrate` inicial).
  - Unsubscribe no cleanup do efeito.
  - → verify: teste em `usePortalAuth.test.tsx` simulando o callback `SIGNED_OUT` → `isAuthenticated` vira `false`; `PortalProtectedRoute` redireciona (teste de integração leve com `MemoryRouter`).
- [ ] **Limpeza de cache no logout (A1).** `signOut` passa a remover as queries
  do portal: `queryClient.removeQueries({ predicate: q => String(q.queryKey[0]).startsWith('portal-') })`
  (obter `queryClient` via `useQueryClient` no provider — o provider já está sob
  `QueryClientProvider` em `src/main.tsx`). Aplicar a mesma limpeza no ramo
  `SIGNED_OUT` do listener acima.
  - → verify: teste — popular cache com chave `portal-invoices`, chamar `signOut`, cache não contém mais a chave.
- [ ] **Sessão de recuperação (A3).** Em `src/pages/PortalResetPassword.tsx`,
  após `updateUser` bem-sucedido, chamar `signOutSupabaseClient(supabasePortal)`
  antes de navegar para `/portal/login`. (Se o time decidir pela Pergunta 2 da
  revisão manter o usuário logado, trocar por `navigate('/portal')` — decisão
  registrada no plano, default é deslogar.)
  - → verify: `PortalRecovery.behavior.test.tsx` — após submit com sucesso, signOut chamado.
- [ ] **Documentação.** Atualizar `docs/ARCHITECTURE.md` (seção Portal do
  Cliente) descrevendo o ciclo de vida da sessão (listener + limpeza de cache);
  refletir em `docs/RASTREABILIDADE.md` se a tabela do portal citar
  `usePortalAuth`.
- [ ] **Fecho da fatia:** `npm run lint && npm test && npm run build && npm run docs:check`.

## Slice 2 — Tratamento de erros visível e honesto (E2, E3, E4, U3, E5)

- [ ] **Dashboard (E2).** Em `src/pages/PortalDashboard.tsx`, capturar `error`
  dos três hooks (`usePortalInvoices`, `usePortalDemurrageInvoices`,
  `usePortalOperationBls`); com qualquer falha, renderizar `InlineError`
  ("Falha ao carregar indicadores...") no lugar dos cards afetados — nunca
  exibir R$ 0,00 derivado de dado ausente.
  - → verify: `PortalDashboard.test.tsx` — mock de RPC rejeitando → texto de falha na tela e ausência de "R$ 0,00".
- [ ] **Aba Demurrage (E3).** Em `src/pages/PortalBilling.tsx`, destruturar
  `error` de `usePortalDemurrageInvoices` e passar para `DemurrageTab`
  (mesma prop `error` que `LocalFeesTab` já recebe).
  - → verify: `PortalBilling.test.tsx` — erro na query de demurrage → mensagem de falha em vez de "Nenhuma fatura".
- [ ] **Login (E4).** Em `src/pages/PortalLogin.tsx`, distinguir falha de rede
  (`TypeError`/`AuthRetryableFetchError`) de credencial inválida; mensagem
  própria "Não foi possível conectar. Verifique sua internet e tente novamente.".
  - → verify: teste com `signIn` rejeitando com erro de fetch → mensagem de conexão, não de credencial.
- [ ] **Mensagens amigáveis (U3, E5).** Criar `src/lib/portalErrorMessage.ts`:
  `portalErrorMessage(error, fallback)` mapeia códigos conhecidos (P0429 →
  rate-limit; 28000 → sessão expirada; erros GoTrue comuns → pt-BR) e devolve o
  `fallback` genérico para o resto (sem vazar `err.message` cru). Usar em
  `PortalProfile.tsx:35,58`, `DisputeModal.tsx:32`, `PortalBilling.tsx:182` e
  `PortalResetPassword.tsx:79-80`.
  - → verify: teste unitário do mapeador cobrindo P0429, 28000, GoTrue "same password" e erro desconhecido.
- [ ] **Fecho da fatia:** `npm run lint && npm test && npm run build`.

## Slice 3 — Observabilidade do portal (O1, O2)

- [ ] **Erro global de queries (O1).** Em `src/main.tsx`, construir o
  `QueryClient` com `queryCache: new QueryCache({ onError })` e
  `mutationCache: new MutationCache({ onError })` reportando via
  `reportCaughtException(error, ...)` com tags `{ queryKey }`. Não introduzir
  toast global — a UI de erro é responsabilidade das telas (Slice 2).
  - → verify: teste — query que rejeita dispara o handler com a queryKey.
- [ ] **Identidade no Sentry (O1).** No `PortalAuthProvider`, ao carregar o
  `overview`: `Sentry.setUser({ id: String(overview.customer_id) })` e
  `Sentry.setTag('area', 'portal')`; limpar (`setUser(null)`) no
  `clearSession`. Nenhum dado pessoal além do id numérico (manter
  `sendDefaultPii: false`).
  - → verify: teste do provider — login seta usuário, signOut limpa.
- [ ] **Trilha de ações críticas (O2).** Confirmar no SQL das RPCs
  (`supabase/`) se `portal_create_consolidation`, `portal_open_demurrage_dispute`
  e `portal_update_profile` gravam auditoria server-side. Se sim: registrar a
  evidência (Teste de contrato SQL) no doc de módulo e encerrar O2. Se não:
  abrir pergunta ao time antes de criar migration (fora do escopo deste plano).
- [ ] **Documentação.** Nota em `docs/ARCHITECTURE.md` sobre telemetria do
  portal (o quê é capturado, com quais tags).
- [ ] **Fecho da fatia:** `npm run lint && npm test && npm run build && npm run docs:check`.

## Slice 4 — Contrato de tipos das RPCs (M1, M3, M4)

- [ ] **Registrar RPCs em `Database['Functions']` (M1).** Adicionar em
  `src/types/database.ts` (arquivo protegido — obter autorização explícita
  antes de editar, conforme `CLAUDE.md`): `portal_resolve_login`,
  `portal_list_notifications`, `portal_notification_unread_count`,
  `portal_mark_notification_read`, `portal_mark_all_notifications_read`,
  `portal_open_demurrage_dispute`, `portal_get_profile`,
  `portal_update_profile`, `portal_list_operation_bls`. Tipar `Args` conforme o
  SQL; `Returns: Json` onde o payload é jsonb.
- [ ] **Remover casts (M1, M4).** Eliminar `as unknown as RpcFn` de
  `src/services/portalBilling.ts:5-10` e o cast local de
  `src/services/portalOperation.ts:112-114`; chamar `supabasePortal.rpc(...)`
  tipado diretamente. Tipar `pix_payload: string | null` no invoice do detalhe
  (remover o cast `(detailInvoice as Record<string, unknown>)` em
  `PortalBilling.tsx:365-372`).
  - → verify: `tsc -b` limpo sem os casts; testes de `portalBillingMutations` e `portalOperation` passam sem alteração de comportamento.
- [ ] **Status centralizados (M3).** Criar `src/lib/portalInvoiceStatus.ts` com
  os grupos (`OPEN_INVOICE_STATUSES`, `STATUS_GROUPS`, `CLOSED_DEMURRAGE_STATUSES`)
  e os labels/badges hoje duplicados entre `PortalDashboard.tsx:11-12` e
  `PortalBilling.tsx:46-50,750-774`. Importar nos dois lugares.
  - → verify: grep sem duplicata dos arrays; testes existentes passam.
- [ ] **Fecho da fatia:** `npm run lint && npm test && npm run build`.

## Slice 5 — Perfil, modal e ajustes de UX (A2, E6, U1, U2, U4, U5, U6)

- [ ] **`usePortalProfile` (A2, E6).** Criar hook em
  `src/hooks/usePortalProfile.ts` (query `portal-profile` + mutation de update
  invalidando a query e chamando `refreshOverview`), seguindo a skill
  `react-query-pattern`. `PortalProfile.tsx` popula o formulário **uma vez** a
  partir do dado da query (sem efeito dependente de `overview` que descarta
  edição).
  - → verify: `PortalProfile.test.tsx` — editar campo, disparar refresh do overview, edição preservada; salvar → mutation chamada e toast.
- [ ] **Focus trap dinâmico (U1).** Em `src/components/ui/Modal.tsx`, consultar
  os focusáveis dentro do handler de `Tab` (no momento do keydown) em vez de
  uma vez na abertura; guardar `document.activeElement` na abertura e restaurar
  o foco no cleanup. (Componente compartilhado com o app interno — mudança
  aditiva, sem alterar API.)
  - → verify: teste do Modal — botão renderizado async entra no ciclo de Tab; foco volta ao disparador ao fechar.
- [ ] **NotificationBell (U2).** `aria-expanded`/`aria-haspopup` no botão;
  fechar com Escape.
  - → verify: `NotificationBell.behavior.test.tsx` — Escape fecha o dropdown.
- [ ] **Filtro × coluna demurrage (U4).** Alinhar: filtrar por `billed_at`
  (campo exibido como "Emissão") em `PortalBilling.tsx:155`.
- [ ] **Status no detalhe de demurrage (U5).** Reusar
  `renderDemurrageBadge`/label centralizado (Slice 4) em `PortalBilling.tsx:417`.
- [ ] **Reset do DisputeModal (U6).** Limpar `reason`/`error` ao fechar
  (`DisputeModal.tsx`).
  - → verify: teste — abrir para fatura A, digitar, cancelar, abrir para fatura B → textarea vazio.
- [ ] **Fecho da fatia:** `npm run lint && npm test && npm run build`.

## Slice 6 — Estrutura e consistência visual (M2, P1, C1, C2)

- [ ] **Quebrar `PortalBilling.tsx` (M2).** Extrair para
  `src/components/portal/`: `PortalInvoiceDetailModal`,
  `PortalDemurrageDetailModal` (e o bloco de PIX compartilhado entre os dois).
  A página fica com abas + filtros + orquestração. Sem mudança de
  comportamento.
  - → verify: `PortalBilling.test.tsx` passa sem alteração de asserts; arquivo da página < 400 linhas.
- [ ] **Paginação no billing (P1).** Reusar `TableFooterPagination`
  (client-side, como em `PortalOperacao.tsx:144-146`) nas listas de taxas
  locais e demurrage. `ponytail:` paginação client-side — a RPC ainda carrega
  tudo; o upgrade é `p_limit/p_offset` nas RPCs se o volume por cliente
  crescer (Pergunta 3 da revisão).
  - → verify: teste — 30 faturas com pageSize 25 → 25 na primeira página.
- [ ] **Tokens no `ShipScheduleWidget` (C1).** Substituir `#162440`/`#ffffff`
  por tokens `var(--app-*)` (introduzir token para o azul institucional se não
  existir), validando contraste no tema escuro.
  - → verify: grep sem cor hex hardcoded no componente; smoke visual nos dois temas.
- [ ] **Cards mobile em `PortalOperacao` (C2).** Variante `md:hidden` com cards
  (padrão do billing) para as abas BLs e Containers.
  - → verify: `PortalOperacao.test.tsx` — render mobile expõe os cards.
- [ ] **Fecho da fatia:** `npm run lint && npm test && npm run build && npm run docs:check`
  (docs: atualizar módulo do portal em `docs/modules/` se os componentes
  extraídos mudarem a anatomia das telas).

---

## Fora do plano (backlog consciente)

- **A4** `vessel_schedules` sem RPC — aguarda decisão (Pergunta 4 da revisão).
- **A5** mover `PortalAuthProvider` para layout dedicado — YAGNI enquanto o custo é um `getSession` local.
- **P2/P3** realtime filtrado por cliente e sino via realtime — otimizações sem dor reportada.
- **P4** `staleTime` por hook — ajustar sob demanda.
- **U7** pente fino de acentuação — texto, sem risco; fazer oportunisticamente.
- **M5** validação zod dos payloads RPC — ganho incremental após Slice 4.
- **D2** validação EMV do payload PIX no cliente — opcional; payload é gerado server-side por `src/lib/pix.ts` (protegido).

## Critério de conclusão do plano

Slices 1–3 mergeadas = revisão atendida no essencial (todos os 🟠 fechados).
Slices 4–6 fecham os 🟡 e os 🔵 de maior valor. Ao concluir, mover este plano
para `docs/archive/superpowers/plans/` conforme `docs/CONVENCOES.md`.

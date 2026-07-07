# Revisão Completa — Portal do Cliente (2026-07-07)

> Registro histórico, imutável. Snapshot da revisão de código das rotas
> `/portal/*` feita em 2026-07-07. A autoridade executável é o código.
> O plano de remediação derivado está em
> [`docs/archive/superpowers/plans/2026-07-07-portal-cliente-review-remediation.md`](superpowers/plans/2026-07-07-portal-cliente-review-remediation.md).

## Resumo Executivo

O portal é bem estruturado: sessão Supabase isolada por `storageKey`, todas as
rotas autenticadas sob `PortalProtectedRoute`, code-splitting completo, camada
RPC → service → hook respeitada e boa cobertura de testes (incluindo fluxos de
erro e testes de contrato de migração). Os problemas mais sérios estão no
**ciclo de vida da sessão**: não há listener `onAuthStateChange` no cliente do
portal (sessão expirada ou logout em outra aba não são detectados) e o **cache
do react-query não é limpo no logout**, o que pode exibir dados de um cliente
para outro no mesmo navegador. O Dashboard **silencia falhas de RPC e mostra
"R$ 0,00"** como se fosse dado real, e nenhum erro do portal chega ao Sentry
com contexto. Nada é bloqueante, mas quatro itens merecem correção imediata.

Gravidades: 🔴 BLOQUEANTE / 🟠 ALTA / 🟡 MÉDIA / 🔵 BAIXA / ⚪ SUGESTÃO.
Salvo indicação contrária, a evidência de cada achado é **Código** (leitura
estática, arquivo e linha na data do snapshot).

## Achados por Categoria

### Arquitetura

| ID | Gravidade | Localização | Problema | Recomendação |
|---|---|---|---|---|
| A1 | 🟠 ALTA | `src/hooks/usePortalAuth.tsx:111-114` | `signOut` limpa o overview e a sessão Supabase, mas **não limpa o cache do react-query**. As queryKeys do portal são fixas (`portal-invoices`, `portal-operation-bls`…); se outro cliente logar no mesmo tab, o cache do cliente anterior é servido instantaneamente (staleTime 30s) antes do refetch — vazamento de dados entre contextos de clientes. | No `signOut`, remover as queries `portal-*` do cache (ou prefixar as chaves com `customer_id`). |
| A2 | 🟡 MÉDIA | `src/pages/PortalProfile.tsx:26,47` | Única tela que chama o service diretamente em `useEffect`/submit, sem react-query — sem cache, sem retry, padrão divergente dos demais hooks (`usePortalBilling`, `usePortalOperation`). | Criar `usePortalProfile()` (query + mutation) seguindo o padrão `react-query-pattern`. |
| A3 | 🟡 MÉDIA | `src/pages/PortalResetPassword.tsx:74-77` | Após redefinir a senha, o usuário é enviado a `/portal/login` mas a **sessão de recuperação criada por `setSession` permanece persistida** em `td-portal-auth`. No próximo reload, `hydrate` encontra sessão válida e o login redireciona autenticado — comportamento surpreendente. | Após `updateUser` bem-sucedido, fazer `signOut` do `supabasePortal` (ou navegar direto para `/portal` assumindo o login). |
| A4 | 🔵 BAIXA | `src/services/vesselSchedules.ts:5` | Único acesso do portal via `.from('vessel_schedules')` direto (sem RPC), dependendo de RLS de leitura pública — exceção ao padrão "RPCs exigem sessão do portal" do `docs/ARCHITECTURE.md`. | Documentar a exceção (é dado público de programação) ou mover para RPC como o resto. |
| A5 | ⚪ SUGESTÃO | `src/main.tsx:54-58` | `PortalAuthProvider` envolve o app inteiro: todo usuário interno executa o `hydrate` do portal no boot (um `getSession` local; RPC só se houver sessão de portal). Isolamento correto, custo pequeno, mas acoplamento desnecessário. | Se o portal ganhar mais peso, mover o provider para um layout `/portal/*` dedicado. |

O isolamento de sessão em si está correto: `storageKey: 'td-portal-auth'` +
`detectSessionInUrl: false` (`src/services/supabase.ts:30-37`), e todos os
hooks de dados usam exclusivamente `supabasePortal` com
`enabled: isAuthenticated`. Não foi encontrada RPC chamada em componente fora
do service layer (exceto chamadas `auth.*` em páginas de login/recuperação,
aceitável).

### Tratamento de Erros

| ID | Gravidade | Localização | Problema | Recomendação |
|---|---|---|---|---|
| E1 | 🟠 ALTA | `src/hooks/usePortalAuth.tsx` (ausência) | **Não há `supabasePortal.auth.onAuthStateChange`**. Se o refresh token expirar durante o uso, `isAuthenticated` continua `true`, o `PortalProtectedRoute` (`PortalProtectedRoute.tsx:11`) nunca redireciona e todas as RPCs passam a falhar sem recuperação. O mesmo vale para logout em outra aba: a aba remanescente segue "autenticada" exibindo cache. | Registrar `onAuthStateChange` no provider: em `SIGNED_OUT`/falha de refresh, limpar overview + cache e deixar o `PortalProtectedRoute` redirecionar. |
| E2 | 🟠 ALTA | `src/pages/PortalDashboard.tsx:27-63,71-89` | Nenhum dos três hooks tem `error` tratado. Se as RPCs falharem, `loading` vira `false` e os cards renderizam **"R$ 0,00 em aberto"** — informação financeira falsa apresentada como real. | Tratar `error` dos três hooks e exibir estado de falha (como faz `PortalOperacao.tsx:108`). |
| E3 | 🟡 MÉDIA | `src/pages/PortalBilling.tsx:82` + `DemurrageTab` | O `error` de `usePortalDemurrageInvoices` é ignorado — a aba Demurrage mostra "Nenhuma fatura" em caso de falha, enquanto a aba de taxas locais tem tratamento (`:502`). | Passar `error` para `DemurrageTab` igual ao `LocalFeesTab`. |
| E4 | 🟡 MÉDIA | `src/pages/PortalLogin.tsx:39-45` | Qualquer erro que não seja `P0429` vira "Credenciais inválidas" — inclusive falha de rede/timeout, induzindo o usuário a achar que errou a senha. | Distinguir erro de rede com mensagem "não foi possível conectar, tente novamente". |
| E5 | 🔵 BAIXA | `src/pages/PortalResetPassword.tsx:79-80` | Token expirado/inválido é bem tratado (parse do hash + fallback `INVALID_LINK_MESSAGE` ✓), mas o erro de `updateUser` exibe `err.message` cru do GoTrue, em inglês. | Mapear os erros comuns do GoTrue para mensagens em pt-BR. |
| E6 | 🔵 BAIXA | `src/pages/PortalProfile.tsx:23-39` | O efeito depende de `[overview]`: `refreshOverview()` após salvar muda o objeto e **recarrega o formulário do servidor**, descartando edição não salva feita nesse intervalo. | Carregar o perfil uma vez e só repovoar explicitamente. |

Perda de dados não salvos em expiração de sessão: os formulários do portal são
curtos (perfil, disputa), risco baixo — mas hoje a expiração nem é detectada
(E1).

### Performance

| ID | Gravidade | Localização | Problema | Recomendação |
|---|---|---|---|---|
| P1 | 🟡 MÉDIA | `src/pages/PortalBilling.tsx:527-575,624-677` | Listas de faturas locais e demurrage renderizam **todas as linhas sem paginação** (a RPC também não pagina). `PortalOperacao` já tem paginação client-side (`:144-146`) — inconsistente. | Reusar `TableFooterPagination` no billing; avaliar `p_limit/p_offset` nas RPCs quando o volume justificar. |
| P2 | 🔵 BAIXA | `src/hooks/usePortalBilling.ts:51-56` | Realtime em `demurrage_invoices` sem filtro: qualquer mudança de qualquer cliente invalida a query de todos os portais conectados. | Adicionar `filter` por cliente no channel (ou documentar como `ponytail:`). |
| P3 | 🔵 BAIXA | `src/hooks/usePortalNotifications.ts:16,27` | Dois pollings de 30s permanentes (contador + lista quando aberta), enquanto demurrage usa realtime. | Migrar o sino para realtime na tabela de notificações. |
| P4 | ⚪ SUGESTÃO | `src/main.tsx:34-41` | `staleTime: 30s` global + `refetchOnWindowFocus: false` é razoável; dados do portal mudam pouco — poderiam ter `staleTime` maior (2–5 min) por hook. | Ajustar por query se o refetch a cada navegação incomodar. |

Positivo: todas as páginas do portal são lazy (`src/App.tsx:11-17`),
`qrcode.react` só entra no chunk do billing, e o `value` do contexto de auth é
memoizado (`usePortalAuth.tsx:126-136`) — sem re-renders forçados.

### UX / Acessibilidade

| ID | Gravidade | Localização | Problema | Recomendação |
|---|---|---|---|---|
| U1 | 🟡 MÉDIA | `src/components/ui/Modal.tsx:42-48` | O focus trap consulta os focusáveis **uma única vez na abertura**: conteúdo carregado async (detalhe da fatura) fica fora do ciclo de Tab; o foco não retorna ao elemento disparador ao fechar. | Recalcular focusáveis no keydown e restaurar o foco no cleanup. |
| U2 | 🔵 BAIXA | `src/components/portal/NotificationBell.tsx:36-51` | Dropdown sem `aria-expanded`/`aria-haspopup` e não fecha com Escape (só clique fora). | Adicionar atributos ARIA e handler de Escape. |
| U3 | 🔵 BAIXA | `PortalProfile.tsx:35,58`, `DisputeModal.tsx:32`, `PortalBilling.tsx:182` | `error.message` cru exibido ao cliente — mensagens PostgREST/Postgres (em inglês, com detalhes internos) podem vazar. | Mapear códigos conhecidos para mensagens amigáveis e cair num genérico + Sentry para o resto. |
| U4 | 🔵 BAIXA | `src/pages/PortalBilling.tsx:155` vs `:628` | Filtro de data da aba Demurrage filtra por `doc_date`, mas a coluna "Emissão" exibe `billed_at`. | Alinhar filtro e coluna no mesmo campo. |
| U5 | 🔵 BAIXA | `src/pages/PortalBilling.tsx:417` | Status no detalhe de demurrage só distingue "Pago"/"Emitida" — ignora vencida/cancelada (a listagem distingue, `:750-754`). | Reusar `renderDemurrageBadge`/`statusLabel`. |
| U6 | ⚪ SUGESTÃO | `src/components/portal/DisputeModal.tsx:15` | `reason` não é limpo ao cancelar: reabrir a disputa para **outra fatura** mostra o texto da anterior. | Resetar `reason`/`error` no `onClose` ou keyar o modal por `demurrageInvoiceId`. |
| U7 | ⚪ SUGESTÃO | `PortalLayout.tsx:28`, `PortalOperacao.tsx:31-33`, `PortalForgotPassword.tsx` | Textos sem acentuação ("operacao", "notificacoes", "Situacao de devolucao") convivendo com textos acentuados. | Pente fino de acentuação. |

Positivo: modais fecham no clique fora com botão X visível e `aria-label`
(`Modal.tsx:68,79`), `role="dialog"`/`aria-modal`/`aria-labelledby` corretos,
inputs com label via `Field`, tabelas com `scope="col"`, tabs com
`role="tab"`/`aria-selected` (`TabButton.tsx`), validação inline nos
formulários e `document.title` por rota (WCAG 2.4.2). Loading states existem em
todas as telas (texto simples, sem skeleton — aceitável). O billing tem cards
mobile; `PortalOperacao` em mobile fica só com scroll horizontal de tabela
larga (min-w 1200px) — o mais fraco em responsividade.

### Manutenibilidade

| ID | Gravidade | Localização | Problema | Recomendação |
|---|---|---|---|---|
| M1 | 🟡 MÉDIA | `src/services/portalBilling.ts:5-10`, `portalOperation.ts:112-114`, `src/types/database.ts` | As RPCs `portal_list_notifications`, `portal_resolve_login`, `portal_get_profile`, `portal_update_profile`, `portal_open_demurrage_dispute`, `portal_list_operation_bls` e `portal_mark_*` **não existem em `Database['Functions']`** — daí os casts `as unknown as RpcFn` que desligam a checagem de tipo. Tipos de retorno manuais podem dessincronizar do SQL silenciosamente. Sintoma: `pix_payload` não existe em `InvoiceDetail['invoice']` e é acessado via cast (`PortalBilling.tsx:365-372`). | Registrar as RPCs faltantes em `database.ts` (arquivo protegido — via processo autorizado) e remover os casts; tipar `pix_payload`. |
| M2 | 🟡 MÉDIA | `src/pages/PortalBilling.tsx` (774 linhas) | Página concentra 2 abas + 3 modais de detalhe + filtros + helpers de status. | Extrair `PortalInvoiceDetailModal` e `PortalDemurrageDetailModal` para `components/portal/`. |
| M3 | 🔵 BAIXA | `PortalDashboard.tsx:11-12` vs `PortalBilling.tsx:46-50` | Grupos de status duplicados (`OPEN_INVOICE_STATUSES` ≡ `STATUS_GROUPS.issued`); labels/badges de status repetidos entre listagem e detalhe. | Centralizar num `lib/portalInvoiceStatus.ts`. |
| M4 | 🔵 BAIXA | `portalBilling.ts:8-10` vs `portalOperation.ts:112-114` | Dois wrappers de `rpc` com casts diferentes e normalizadores numéricos repetidos. | Helper comum `portalRpc<T>()` + normalizadores compartilhados (resolve M1 e M4 juntos). |
| M5 | ⚪ SUGESTÃO | services do portal | `zod` instalado e usado no billing interno (`billing.ts:610`), mas os payloads das RPCs do portal são normalizados à mão. | Validar payloads com schemas zod, ganhando erro observável em drift de contrato. |

Positivo (Teste): cobertura do portal é boa e cobre erro —
`usePortalAuth.test.tsx`, `usePortalAuthHydrate.behavior`,
`PortalBilling/Dashboard/Operacao/Profile/Recovery`, `portalBillingMutations`,
`portalOperation`, `NotificationBell`, `PortalLayout`, além de testes de
contrato de migrações (`portalResolveLoginHardeningMigration`,
`portalCeMercanteGateMigration` etc.).

### Dependências

| ID | Gravidade | Localização | Problema | Recomendação |
|---|---|---|---|---|
| D1 | ⚪ SUGESTÃO | `package.json:33-45` | Versões saudáveis e nas majors atuais: react-router-dom 7.17, @tanstack/react-query 5.96, zod 4.3, @supabase/supabase-js 2.102, React 19.2. Sem breaking change pendente conhecida. | Nenhuma ação. |
| D2 | 🔵 BAIXA | `PortalBilling.tsx:369,460` | `qrcode.react` não é exclusivo do portal (também em `InvoiceDocumentLocal` e `demurrage/InvoiceDocument`). O `pix_payload` vem pronto do servidor (`src/lib/pix.ts`, protegido) e é renderizado como valor — React escapa o texto e o QR não interpreta HTML; sem vetor de injeção. Porém **não há validação de formato EMV no cliente**: payload corrompido vira QR inválido silencioso. | Opcional: validar CRC/prefixo EMV antes de renderizar e exibir aviso se inválido. |
| D3 | ⚪ SUGESTÃO | — | Não foram encontradas dependências não usadas no escopo do portal. | — |

### Observabilidade

| ID | Gravidade | Localização | Problema | Recomendação |
|---|---|---|---|---|
| O1 | 🟠 ALTA | `src/lib/telemetry.ts` + hooks do portal | **Nenhum erro do portal chega ao Sentry com contexto**: só o `ErrorBoundary` captura (erros de render). Falhas de RPC ficam no estado do react-query (sem `onError` global no `QueryClient`), não há `Sentry.setUser`/tag `customer_id` nem tag de rota. | `QueryCache.onError` reportando via `reportCaughtException` com tags `{ area: 'portal', customer_id, queryKey }`; `Sentry.setUser({ id: customer_id })` no `PortalAuthProvider`. |
| O2 | 🟡 MÉDIA | consolidação/disputa/perfil | Sem logging client-side de ações críticas. Se a trilha existir nas RPCs (audit no servidor), o gap é menor — precisa confirmação (Suspeita). | Confirmar auditoria server-side; se não houver, adicionar breadcrumbs/eventos nas mutations. |

### Consistência com o App Interno

| ID | Gravidade | Localização | Problema | Recomendação |
|---|---|---|---|---|
| C1 | 🔵 BAIXA | `src/components/portal/ShipScheduleWidget.tsx:36,67-178` | Cores hardcoded (`#162440`, `#ffffff`) fora dos tokens `var(--app-*)` — provável quebra no tema escuro (Suspeita) e divergência visual. | Trocar por tokens do design system. |
| C2 | 🔵 BAIXA | `src/pages/PortalOperacao.tsx:333` | Sem variante mobile (cards) — só tabela de 1200px com scroll horizontal, enquanto billing tem cards mobile. | Adicionar cards mobile como no billing. |
| C3 | ⚪ SUGESTÃO | — | Reuso está bom: UI primitives compartilhadas (`Button`, `Card`, `Modal`, `Badge`, `FilterBar`, `TableFooterPagination`), `InvoiceDocumentLocal` e `consolidatedInvoiceSelection` reusados do app interno, exports centralizados em `src/services/exports.ts`. | — |

## Itens Prioritários para Ação

1. **[E1]** — `onAuthStateChange` no `supabasePortal`: causa raiz de três sintomas (sessão expirada não redireciona, logout multi-aba não sincroniza, RPCs falhando sem recuperação).
2. **[A1]** — Limpar o cache react-query no `signOut`: risco real de exibir dados financeiros de um cliente a outro no mesmo navegador.
3. **[E2]** — Dashboard tratando erro: "R$ 0,00" em falha de RPC é dado financeiro falso apresentado ao cliente.
4. **[O1]** — `onError` global + `Sentry.setUser(customer_id)`: sem isso, os itens acima e regressões futuras são invisíveis em produção.
5. **[M1]** — Registrar as RPCs do portal em `database.ts` e eliminar os casts `as unknown as RpcFn`.

## Perguntas para o Time

1. **Auditoria server-side**: as RPCs `portal_create_consolidation`, `portal_open_demurrage_dispute` e `portal_update_profile` gravam trilha de auditoria no banco? Define se O2 é gap real ou só falta de breadcrumb.
2. **Sessão pós-reset de senha (A3)**: a intenção é o usuário sair logado após redefinir a senha, ou voltar ao login? Hoje o comportamento é híbrido.
3. **Volume esperado por cliente**: qual o máximo realista de faturas/BLs por cliente? Define se P1 é prioridade ou YAGNI.
4. **`vessel_schedules` sem RPC (A4)**: leitura direta com RLS pública é decisão consciente (dado público) ou resquício? Se consciente, vale nota no `ARCHITECTURE.md`.
5. **Tema escuro no portal**: o portal deve respeitar o `VisualThemeProvider` como o app interno? O `ShipScheduleWidget` (C1) hoje só funciona bem em tema claro.

# Plano — Inspeção do Portal

Status: TODO

Origem: sessão de decisão de 2026-08-13 (grilling com `grill-with-docs`), oito
decisões confirmadas pelo product owner e registradas na seção
"[Decisões tomadas](#decisões-tomadas)".

Pré-requisito satisfeito: PRs #527 (endurecimento de grants do Portal) e #528
(ADR 0044 — leitura interna global) foram mergeadas em `main` em 2026-08-13. A
próxima migration livre é a **`292`**.

## Objetivo

Dar ao usuário interno uma forma de **ver exatamente o que um Cliente vê no
Portal do Cliente**, para supervisionar e corrigir erros no início da operação
em produção.

A capacidade é permanente, somente leitura, e o usuário interno permanece na
própria identidade: não existe login como cliente, não existe conta de Portal
para uso interno, e nenhuma ação de cliente pode ser disparada durante a
inspeção.

Não-objetivos:

- Espelhar a sessão do cliente ao vivo (a proposta original 1). Resolve outro
  problema — o que o cliente está fazendo agora — e é o pior perfil de LGPD.
- Login interno em contas de Portal (a proposta original 2). Quebraria a
  invariante central de `current_portal_customer_id()` e gravaria auditoria sob
  a identidade do cliente.
- Alterar qualquer permissão de escrita interna ou do Portal.
- Informar o cliente de que a inspeção existe (ver decisão 3 — dívida assumida
  e registrada).

## Decisões tomadas

| # | Questão | Decisão |
|---|---|---|
| 1 | Escopo | Capacidade permanente de atendimento, não ferramenta de piloto |
| 2 | Autorização | Todo perfil interno ativo — gate `is_active_read_user()` |
| 3 | Divulgação ao cliente | Não informar por ora; dívida registrada na ADR |
| 4 | Auditoria | Tabela própria append-only: quem, qual cliente, quando, origem |
| 5 | Termo canônico | **Inspeção do Portal**; na tela, *Modo Inspeção* |
| 6 | Cobertura | Portal inteiro — Painel, Faturas, BLs, Perfil e sino |
| 7 | Controles | Leitura e navegação clicáveis; as seis gravações bloqueadas |
| 8 | Sequenciamento | Depois de #527 e #528 — satisfeito |

A decisão 2 decorre da ADR 0044: leitura de dado interno é global para perfil
ativo, e a restrição por departamento vive só no eixo de escrita. Como a
migration `291` já abriu `invoices`, `payments` e `bl_receivables` para todo
perfil interno, a Inspeção **não expõe nenhuma classe de dado nova** — ela
apenas apresenta, na projeção do Portal, o que o usuário interno já pode ler
pelas telas internas.

## A garantia de fidelidade

O requisito mais forte do pedido é a certeza de que o que a ferramenta mostra é
o que o cliente vê. A garantia não vem de disciplina: vem de não haver duas
implementações.

Hoje cada RPC do Portal resolve a identidade por
`current_portal_customer_id()` (`084_portal_auth_uid_rework.sql:22-47`) e
consulta por `WHERE customer_id = v_customer_id`. O desenho extrai essa
consulta para uma função núcleo parametrizada e faz **as duas portas chamarem o
mesmo núcleo**:

```
        _portal_<x>_core(p_customer_id)     ← a lógica, uma vez só. Sem grant.
           ↑                          ↑
   portal_<x>()                portal_inspect_<x>(p_customer_id)
   identidade via               gate is_active_read_user()
   current_portal_customer_id() + REVOKE explícito
```

O que o cliente vê e o que o interno vê divergirem exigiria alterar o núcleo —
e o núcleo é único. A paridade deixa de ser uma promessa e passa a ser a
estrutura do código.

### Por que não um parâmetro opcional nas RPCs existentes

O desenho anterior — acrescentar `p_customer_id DEFAULT NULL` às 12 RPCs — foi
descartado por duas razões descobertas na revisão pós-merge:

1. `docs/modules/portal-cliente.md:225` documenta que o projeto concede
   `EXECUTE` a `anon` e `authenticated` por `ALTER DEFAULT PRIVILEGES`. Acrescentar
   um parâmetro cria uma **assinatura nova**, portanto uma função nova, portanto
   um grant novo a `anon` — exatamente o buraco que a `290` acabou de fechar.
2. `src/services/__tests__/portalInvoiceDetailsAnonGrantInvariant.test.ts:20-21`
   trava a assinatura literal `portal_invoice_details(bigint)` por regex. Mudar
   a assinatura deixaria o teste **verde vigiando uma função que não existe
   mais** — falso negativo silencioso.

`CREATE OR REPLACE` sobre assinatura inalterada preserva os grants existentes e
não dispara default privileges. Por isso as RPCs do cliente mantêm a assinatura
atual e a superfície auditada pela #527 fica intacta.

## Etapa 1 — Migration `292_portal_inspection.sql` (P0)

### 1.1 Tabela de auditoria

```sql
CREATE TABLE public.portal_inspection_events (
  id BIGSERIAL PRIMARY KEY,
  inspector_id UUID NOT NULL REFERENCES auth.users(id),
  customer_id BIGINT NOT NULL REFERENCES public.customers(id),
  origin TEXT NOT NULL CHECK (origin IN ('provisionamento', 'ficha')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Append-only: RLS habilitada, policy de `SELECT` para `is_active_read_user()`,
**nenhuma** policy de `INSERT`/`UPDATE`/`DELETE` para `authenticated` — a
escrita acontece só dentro do funil `SECURITY DEFINER` da 1.3. Índice em
`(customer_id, created_at DESC)`.

Registra a **abertura** da inspeção, não cada RPC — decisão 4. Uma sessão de
inspeção grava uma linha.

### 1.2 O funil de autorização

```sql
CREATE OR REPLACE FUNCTION public._portal_inspect_guard(p_customer_id BIGINT)
RETURNS BIGINT LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Inspecao do Portal requer usuario interno ativo.'
      USING ERRCODE = '42501';
  END IF;
  RETURN p_customer_id;
END;
$$;
```

Espelha estruturalmente `current_portal_customer_id()`: um único ponto de
decisão, erro explícito, nunca retorno vazio. `is_active_read_user()` foi
verificada em runtime pela #527 como `false` para contas de Portal — um cliente
não consegue inspecionar ninguém, nem a si mesmo.

`REVOKE ALL ... FROM PUBLIC, anon;` e `GRANT EXECUTE ... TO authenticated;`.

### 1.3 Abertura de inspeção

`portal_open_inspection(p_customer_id BIGINT, p_origin TEXT)` — chama o guard,
insere em `portal_inspection_events`, e retorna o payload de overview que
`portal_get_session_overview_v2` retornaria, **sem** o `UPDATE last_login_at`.

Esta é a única função da etapa que grava, e grava sobre auditoria interna, nunca
sobre dado do cliente. `VOLATILE`.

### 1.4 Os pares núcleo + invólucros

Para cada RPC de leitura escopada por cliente, três passos:

1. `CREATE FUNCTION public._portal_<x>_core(p_customer_id BIGINT)` com o corpo
   atual, trocando `v_customer_id` pelo parâmetro. `REVOKE ALL ... FROM PUBLIC,
   anon, authenticated` — o núcleo não é chamável de fora.
2. `CREATE OR REPLACE FUNCTION public.portal_<x>(...)` — **assinatura
   inalterada** — cujo corpo passa a ser
   `RETURN QUERY SELECT * FROM public._portal_<x>_core(public.current_portal_customer_id());`
3. `CREATE FUNCTION public.portal_inspect_<x>(p_customer_id BIGINT, ...)` cujo
   corpo é
   `RETURN QUERY SELECT * FROM public._portal_<x>_core(public._portal_inspect_guard(p_customer_id));`
   com `REVOKE ALL ... FROM PUBLIC, anon` e `GRANT EXECUTE ... TO authenticated`.

As nove RPCs escopadas por cliente:

| RPC do cliente | Origem | Superfície |
|---|---|---|
| `portal_list_invoices()` | `084` | Faturas |
| `portal_invoice_details(bigint)` | `084`/`290` | Modal de fatura |
| `portal_list_demurrage_invoices()` | `105` | Faturas — demurrage |
| `portal_get_demurrage_invoice_detail(bigint)` | `120` | Modal de demurrage |
| `portal_list_consolidatable_receivables()` | `123` | Consolidação |
| `portal_list_operation_bls()` | `085` | Operação |
| `portal_get_profile()` | `116` | Perfil |
| `portal_list_notifications(int)` | `119` | Sino |
| `portal_notification_unread_count()` | `116` | Badge do sino |

Duas RPCs **não** ganham par, porque não são escopadas por cliente e já
retornam o mesmo para todos: `portal_get_current_roe()` e
`portal_ship_schedule()`. A inspeção as chama diretamente.

### 1.5 A exceção documentada

`portal_get_session_overview_v2` (`115_portal_fase1_login_cnpj.sql`) fica
**fora** do tratamento acima, e o cabeçalho da migration precisa dizer por quê:
ela resolve identidade por `auth_user_id` direto (não pelo funil), levanta erro
distinto para conta inativa, e **grava** `last_login_at`. Parametrizá-la faria a
inspeção interna registrar logins falsos do cliente e corromper a métrica de
adoção do piloto. A 1.3 substitui seu papel na inspeção, com a leitura e sem a
escrita.

Este é o único ponto onde a Inspeção e o Portal do cliente não compartilham
código — e é deliberado, então precisa estar escrito na migration, na ADR e em
`docs/modules/portal-cliente.md`.

### 1.6 Conta não ativa

`current_portal_customer_id()` exige `active = true`; o guard da inspeção não.
Isso é intencional: inspecionar um cliente cuja conta está pendente ou desativada
é justamente o caso de atendimento. A 1.3 retorna a situação da conta junto do
overview, e a UI **precisa** exibir isso com destaque (etapa 3.4) — sem isso, o
operador veria a projeção de dados de um cliente que hoje não consegue entrar no
Portal e concluiria o contrário.

### 1.7 Cabeçalho e rollback

Conforme a skill `supabase-migration`: declarar o que a migration faz, apontar
para este plano e para a ADR nova, e registrar o rollback — dropar as funções
`portal_inspect_*`, `_portal_inspect_guard`, `portal_open_inspection` e a tabela
`portal_inspection_events`; restaurar cada `portal_<x>` ao corpo inline anterior
e dropar os `_portal_<x>_core`.

## Etapa 2 — Escopo injetado no frontend (P0)

Hoje `src/services/portalBilling.ts:1`, `src/services/portalOperation.ts:1` e
`src/services/portalScheduleVoyages.ts:2` importam `supabasePortal` no topo do
módulo. Esse import é o que amarra as funções à sessão do cliente e precisa
virar um parâmetro.

### 2.1 O tipo de escopo

O escopo carrega três coisas — não só a identidade do cliente:

```ts
export type PortalScope = {
  mode: 'client' | 'inspect'
  customerId: number | null      // preenchido só em 'inspect'
  overview: PortalOverview | null
  basePath: string               // '/portal' | '/clientes/portal/inspecao/:id'
}
```

`overview` e `basePath` estão aqui porque o Portal os consome hoje por vias que
o modo inspeção não tem. Detalhe em 2.2 e 2.3.

Cada função de serviço passa a receber `scope` e escolher cliente Supabase e
nome de RPC a partir dele: `supabasePortal` + `portal_<x>` no modo cliente,
`supabase` (sessão interna) + `portal_inspect_<x>` com `p_customer_id` no modo
inspeção. Uma única função `callPortalRpc(scope, name, args)` concentra essa
escolha — corrigir no ponto compartilhado, não em cada call site.

O modo `client` é o default em toda assinatura, para que nenhum call site do
Portal real precise mudar.

### 2.2 O overview vem do escopo, não de `usePortalAuth`

Em modo inspeção o usuário interno **não tem sessão de Portal**, então
`usePortalAuth().overview` é `null` — e três consumidores dependem dele hoje:

| Consumidor | Uso atual | Sintoma sem correção |
|---|---|---|
| `PortalLayout.tsx:43-47` | `overview?.customer_name`, `customer_cnpj_cpf` | Cabeçalho mostra o fallback "Cliente" |
| `usePortalProfile.ts` | `enabled: Boolean(overview)` | Aba Perfil nunca carrega |
| `NotificationBell.tsx:42` | `if (!overview) return null` | Sino some da tela |

Pior que os três: se o usuário interno tiver uma sessão de Portal antiga na
mesma aba, `overview` não é `null` — é o **overview de outro cliente**, e a
inspeção exibiria a identidade errada no cabeçalho. Fidelidade invertida, que é
exatamente o que esta ferramenta não pode fazer.

Correção: `portal_open_inspection` (1.3) devolve o overview, a página da
inspeção o coloca no `PortalScopeContext`, e os três consumidores passam a ler
`usePortalScope().overview` em vez de `usePortalAuth().overview`. No modo
cliente o provider preenche esse campo a partir de `usePortalAuth`, então o
Portal real não muda de comportamento.

### 2.3 Hooks e chaves de cache

Os hooks de `usePortalBilling.ts`, `usePortalOperation.ts`,
`usePortalNotifications.ts`, `usePortalProfile.ts` e
`usePortalScheduleVoyages.ts` passam a ler o escopo de um `PortalScopeContext`
novo, com default de modo cliente.

`usePortalScheduleVoyages` entra na lista mesmo sem par de inspeção no banco:
`portal_ship_schedule()` não é escopada por cliente, mas o hook está travado em
`enabled: isAuthenticated` e o serviço chama `supabasePortal`. Sem tratá-lo, o
`ShipScheduleWidget` do Painel apareceria vazio na inspeção enquanto o cliente
vê navios — divergência visível na primeira tela. Aqui a injeção muda só o
cliente Supabase e o `enabled`, não o nome da RPC.

Duas mudanças obrigatórias nas query keys:

- Incluir o `customerId` na chave em modo inspeção, ou inspecionar dois clientes
  em sequência serviria o cache do primeiro.
- Usar um prefixo **fora** de `portal-` para as chaves de inspeção (proposta:
  `portal-inspect-`). `clearPortalQueries` em `src/hooks/usePortalAuth.tsx`
  remove por `String(query.queryKey[0]).startsWith('portal-')`; o prefixo
  proposto continua casando com esse predicado, o que é o comportamento
  desejado — um logout do Portal na mesma aba não deve deixar cache de
  inspeção para trás.

`enabled` deixa de ser `isAuthenticated` puro e passa a ser
`isAuthenticated || scope.mode === 'inspect'`.

### 2.4 Bloqueio das escritas

Em modo inspeção, as seis gravações do cliente ficam indisponíveis:

| Ação | Onde |
|---|---|
| `portal_open_demurrage_dispute` | `DisputeModal.tsx` |
| `portal_update_profile` | `PortalProfile.tsx` |
| `portal_create_consolidation` | `PortalConsolidatedModal.tsx` |
| `portal_obsolete_consolidation` | `PortalConsolidatedModal.tsx` |
| `portal_mark_notification_read` | `NotificationBell.tsx` |
| `portal_mark_all_notifications_read` | `NotificationBell.tsx` |
| Edge Function `portal-recovery-email-change` | `PortalProfile.tsx` |

Duas camadas, e as duas importam:

- **UI**: os controles ficam visíveis mas desabilitados, com tooltip "Ação do
  cliente — indisponível em Modo Inspeção". Ocultá-los quebraria a fidelidade,
  que é o ponto da ferramenta.
- **Banco**: nenhuma dessas RPCs ganha par `portal_inspect_*`. Mesmo que a UI
  falhasse, não existe caminho no banco para o interno executá-las por outro
  cliente — elas continuam resolvendo por `current_portal_customer_id()`, que
  para um usuário interno levanta `28000`.

Marcar notificação como lida merece atenção explícita: é escrita disfarçada de
navegação, e abrir o sino em modo inspeção **não pode** marcar nada como lido.

## Etapa 3 — Superfície de entrada (P1)

### 3.1 Rota

`/clientes/portal/inspecao/:customerId`, dentro das rotas internas
(`src/App.tsx:146`). Não pode ficar sob `/portal/*`: `App.tsx:75` trata host
`portal.*` como domínio exclusivo de cliente e redireciona rotas internas para
`/portal`.

A página monta `PortalScopeContext` com `{ mode: 'inspect', customerId }`,
chama `portal_open_inspection` uma vez na entrada, e renderiza o mesmo
`PortalLayout` do Portal real.

### 3.2 Base path em **todos** os destinos, não só na navegação

`src/components/layout/PortalLayout.tsx:10-13` tem `portalNavItems` com
`/portal`, `/portal/billing`, `/portal/operacao`, `/portal/perfil` hardcoded —
mas corrigir só essa lista não mantém o usuário dentro da inspeção. Há mais três
famílias de destino absoluto:

| Origem | Linhas | O que acontece sem correção |
|---|---|---|
| `PortalLayout` — nav, brand, pill de perfil | `:10-13`, `:24`, `:36` | Navegação principal escapa |
| `PortalDashboard` — os quatro cards de indicador | `:39`, `:45`, `:51`, `:57` | Clicar num KPI escapa |
| `NotificationBell` — `navigate(n.link)` com guarda `startsWith('/portal')` | `:92` | Clicar numa notificação escapa |

"Escapar" aqui significa cair em `/portal/*`, que é rota exclusiva de cliente:
o usuário interno, sem sessão de Portal, é jogado no login do Portal e perde a
inspeção.

Correção: o `basePath` do escopo (2.1) é resolvido por um helper único —
`portalPath(scope, '/billing?tab=local')` — usado nos três lugares. O
`NotificationBell` precisa de atenção extra: o link vem do payload da
notificação, gravado no banco como `/portal/...`, então a guarda `startsWith`
continua sendo o teste de segurança e o prefixo é **reescrito** para o
`basePath` antes do `navigate`.

Com isso as abas viram sub-rotas do mesmo prefixo — mesma navegação, mesmo
chrome, mesmos componentes de página.

`PortalDashboard.tsx:19-22` se compõe só de `usePortalInvoices`,
`usePortalDemurrageInvoices`, `usePortalOperationBls` e `ShipScheduleWidget`:
não tem RPC própria, então vem de graça assim que a etapa 2 estiver de pé. Foi
o que derrubou a ideia inicial de faseamento por tela.

### 3.3 O botão

Um só, no cabeçalho de `src/components/portal/PortalReviewPanel.tsx:95-102`.
Esse componente já é compartilhado pelas duas entradas que o product owner
pediu:

- `src/pages/ClientesPortal.tsx:85` — o console de Provisionamento do Portal,
  `variant="inline"`, com `origin: 'provisionamento'`;
- `src/components/clientes/CadastroContatosTab.tsx:62` — a Ficha do Cliente,
  `variant="embedded"`, com `origin: 'ficha'`.

Um botão no componente compartilhado cobre as duas telas sem duplicar nada. Do
console, abre em aba nova (`target="_blank"`) — a linha expandida no console é
contexto de trabalho e não deve ser perdida; da ficha, navega na mesma aba.

O rótulo acompanha `row.account_situation`: "Ver como o cliente vê" para conta
ativa, "Ver o que o cliente veria" para pendente ou desativada.

Sem gate de permissão no botão além de estar autenticado como interno ativo — é
a decisão 2, e é o mesmo gate que o banco aplica.

### 3.4 Faixa de Modo Inspeção

Faixa persistente no topo, fora do chrome do Portal para não se confundir com
ele: nome e CNPJ do cliente, situação da conta quando não for ativa, e um botão
de saída que volta para a origem. Sem ela, um print de tela em modo inspeção
seria indistinguível de um print do cliente — e alguém, uma hora, vai colar esse
print num ticket.

## Etapa 4 — Testes (P0, junto da etapa 1)

### 4.1 Paridade, uma por RPC

Reaproveitar o harness de integração da #527 (`SET LOCAL request.jwt.claim.sub`
+ `ROLLBACK`): para um cliente de teste, autenticar como a conta de Portal dele,
chamar `portal_<x>()`, e comparar o retorno com `portal_inspect_<x>(customer_id)`
chamada como usuário interno. Igualdade estrutural.

Duas armadilhas a evitar, ambas já pagas por este projeto:

- **Verde vazio.** Asserir conteúdo não-vazio, nunca só `error === null` — é
  exatamente o bug corrigido em `src/integration/supabase.integration.test.ts`
  pela #528 ("distingue *RLS filtrou* de *tabela sem dado*"), e a ADR 0044
  registra que RLS devolve `200 []` em vez de erro.
- **Igualdade trivial.** Se as duas chamadas devolvem lista vazia, o teste passa
  sem provar nada. O fixture precisa garantir pelo menos uma fatura, um BL e uma
  notificação.

### 4.2 Contrato de grants

Teste no padrão de `portalInvoiceDetailsAnonGrantInvariant.test.ts`, varrendo as
migrations em ordem: toda função `portal_inspect_*` e `_portal_*_core` criada
deve ter `REVOKE` de `anon`, e nenhum `GRANT ... TO anon` posterior.

Este teste é necessário porque `152_revoke_anon_definer_drift.sql` é uma
varredura **única**, não uma trava permanente — funções criadas depois dela não
são cobertas, e é assim que o buraco da `290` nasceu.

### 4.3 Contrato de bloqueio de escrita

Teste de contrato SQL: para cada uma das seis RPCs de escrita do cliente,
asserir que **não existe** função `portal_inspect_<x>` correspondente em
`supabase/migrations/`. Trava a decisão 7 contra uma extensão futura distraída.

### 4.4 Guarda da exceção

Teste de contrato SQL asserindo que `portal_get_session_overview_v2` não recebeu
par de inspeção e que `portal_open_inspection` não contém `UPDATE`
de `customer_portal_accounts`.

### 4.5 Contenção da navegação

Teste de componente: renderizar `PortalLayout`, `PortalDashboard` e
`NotificationBell` sob um escopo de inspeção e asserir que nenhum destino
renderizado começa com `/portal/`. É o teste que impede a regressão da 3.2 — um
link absoluto novo é fácil de introduzir e o sintoma (cair no login do Portal)
só aparece em uso real.

## Etapa 5 — Documentação (mesmo change)

| Documento | Mudança |
|---|---|
| ADR nova (`0045`) | Decisão da Inspeção; estende ADR 0044 a esta superfície; registra explicitamente a dívida da decisão 3 (cliente não informado) e a exceção da `portal_get_session_overview_v2` |
| `CONTEXT.md` | Entrada **Inspeção do Portal** na seção do Portal (antes de *Conta de Portal*), distinguindo-a de Provisionamento e de recuperação assistida |
| `docs/modules/portal-cliente.md` | Catálogo de ações da inspeção; o par núcleo/invólucro; a exceção; reforço da nota de `ALTER DEFAULT PRIVILEGES` (:225) |
| `docs/RASTREABILIDADE.md` | Rota, componentes, hooks, serviços, RPCs e testes novos |
| `docs/ARCHITECTURE.md` | Rota nova; nota de que `PortalLayout` serve dois hosts e dois modos |
| `docs/plans/README.md` | Linha deste plano; remover ao concluir |
| `docs/CHANGELOG.md` | Entrega, ao concluir |

## Ordem de execução

1. Etapa 1 + Etapa 4.1/4.2/4.4 (banco e suas provas) — sozinhas já são
   verificáveis e não mudam nada visível.
2. Etapa 2 + Etapa 4.3 (escopo e bloqueio de escrita).
3. Etapa 3 (rota, layout, botão, faixa).
4. Etapa 5 (documentação), no mesmo change da etapa que a torna verdadeira.

Verificação antes de concluir: `npm run docs:check`, `npm run lint`, `npm test`,
`npm run build`.

## Riscos e pontos de atenção

- **Grant a `anon` em função nova.** O risco estrutural desta mudança. Mitigado
  pelo `REVOKE` explícito em cada objeto novo e pelo teste 4.2.
- **Divergência silenciosa por `CREATE OR REPLACE` futuro.** Alguém pode, mais
  tarde, editar o corpo de `portal_<x>` inline em vez de mexer no núcleo,
  quebrando a paridade sem quebrar nenhum teste que só olha assinatura. O teste
  4.1 pega isso, desde que os fixtures não estejam vazios.
- **Interpretação equivocada de conta não ativa.** Mitigado pela faixa da etapa
  3.4; sem ela, o risco é real.
- **Divergência não coberta.** A auditoria registra a abertura, não cada
  chamada. Se um dia for preciso reconstruir "o que exatamente o operador viu
  às 14h", este desenho não responde. Custo aceito na decisão 4.

## Achado independente, fora do escopo deste plano

Levantado durante o grilling e não investigado: o cliente pode **criar e tornar
obsoleta** fatura consolidada por conta própria (`portal_create_consolidation`
e `portal_obsolete_consolidation`, via `PortalConsolidatedModal.tsx`). Isso é
mais poder de escrita do que o Portal aparenta ter e merece revisão própria
antes da produção. Não bloqueia este plano — a Inspeção só torna o
comportamento mais visível.

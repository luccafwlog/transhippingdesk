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
| 9 | `contact_email` na aba Perfil | Expor, como o cliente vê; ampliação registrada na ADR |
| 10 | Teste de paridade | Estrutura (obrigatório, todo PR) + igualdade de resultado (sob demanda) |
| 11 | Descoberta por Equipamentos | Todos os setores veem; abrir o console de provisionamento a `equipamentos` |

As decisões 1 a 8 vieram do grilling; 9 a 11 foram tomadas depois da review que
apontou as lacunas correspondentes. A decisão 12 — auditoria contornável — está
na seção de riscos: aceitar o limite e escrevê-lo na ADR com as palavras certas
(cobre o uso pela ferramenta, não o acesso pela API).

A decisão 2 decorre da ADR 0044: leitura de dado interno é global para perfil
ativo, e a restrição por departamento vive só no eixo de escrita. A migration
`291` já abriu `invoices`, `payments` e `bl_receivables` para todo perfil
interno, então a maior parte do que a Inspeção mostra é dado que o usuário já lê
pelas telas internas — só reprojetado na linguagem do Portal.

**Com uma exceção que precisa de decisão explícita na ADR.** `portal_get_profile`
devolve `customer_portal_accounts.contact_email`, e essa tabela tem RLS restrita
a `is_admin()` desde `041` — a migration `291` não a tocou. Abrir a inspeção sob
`is_active_read_user()` entrega esse campo a todo perfil ativo, o que é uma
ampliação real de superfície, não uma reprojeção.

Dois esclarecimentos que a primeira redação embaralhava:

- O que o console anula para quem não tem acesso completo é o `recovery_email`
  (`198:68`) — **coluna distinta** do `contact_email`, e anulada, não mascarada.
- A exposição não fica contida na aba Perfil: `portal_get_session_overview_v2`
  já projeta `contact_email` (`115:178`), e é esse payload que
  `portal_open_inspection` devolve. O campo chega junto com a abertura da
  inspeção, antes de qualquer aba ser aberta.

**Decisão 9: expor, como o cliente vê.** Mascarar contradiria o propósito da
ferramenta — um operador que vê `j***@empresa.com` numa tela que promete mostrar
o que o cliente vê não pode confiar em mais nada daquela tela — e exigiria um
ramo por papel dentro do núcleo compartilhado, justamente onde o desenho evita
ramificações. É o contato do próprio cliente, num sistema onde todo perfil
interno já lê faturas e recebíveis dele desde a `291`; a restrição da `041` era
sobre a tabela inteira, que guarda hash de senha, não sobre este campo.

A ADR nova precisa dizer isso explicitamente: a Inspeção **estende** a leitura
global a `contact_email` do Portal. É ampliação real de superfície e não pode
ficar implícita numa frase de "nenhum dado novo".

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

Registra a **abertura** da inspeção, não cada RPC — decisão 4.

`origin` é preenchido pelo chamador e não é confiável como prova; serve para
saber de onde a equipe costuma entrar, não para autorizar nada. Como é
`NOT NULL` com `CHECK`, um valor ausente derrubaria a abertura inteira — então o
default no servidor é `'ficha'` quando o parâmetro vier `NULL`, e o valor viaja
na rota como query string (`?origem=provisionamento`), sobrevivendo a aba nova e
a refresh. Um valor fora do `CHECK` vindo de URL editada à mão cai no default em
vez de estourar.

**Idempotência.** `main.tsx:41` monta o app em `<StrictMode>`, que invoca efeitos
duas vezes em desenvolvimento; uma abertura ingênua no `useEffect` gravaria duas
linhas e contradiria "uma sessão grava uma linha". A abertura é deduplicada por
janela: `portal_open_inspection` não insere se já existe linha do mesmo
`inspector_id` + `customer_id` nos últimos 30 minutos, e retorna o overview de
qualquer forma. Isso também evita inflar a auditoria quando o operador dá F5.

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

`portal_open_inspection(p_customer_id BIGINT, p_origin TEXT DEFAULT NULL)` —
chama o guard, insere em `portal_inspection_events` respeitando a deduplicação
da 1.1, e retorna o payload de overview que `portal_get_session_overview_v2`
retornaria, **sem** o `UPDATE last_login_at`.

Esta é a única função da etapa que grava, e grava sobre auditoria interna, nunca
sobre dado do cliente. `VOLATILE`, `SECURITY DEFINER`, com
`REVOKE ALL ... FROM PUBLIC, anon` e `GRANT EXECUTE ... TO authenticated` — sem
isso o `ALTER DEFAULT PRIVILEGES` do projeto entregaria a `anon` uma função que
grava auditoria e devolve o overview de qualquer cliente.

### 1.4 Os pares núcleo + invólucros

Para cada RPC de leitura escopada por cliente, três passos:

1. `CREATE FUNCTION public._portal_<x>_core(p_customer_id BIGINT, <demais
   parâmetros da RPC>)` com o corpo atual, trocando `v_customer_id` pelo
   parâmetro. `SECURITY DEFINER` — o núcleo lê tabelas que o chamador não
   alcança por RLS. `REVOKE ALL ... FROM PUBLIC, anon, authenticated`: o núcleo
   não é chamável de fora.
2. `CREATE OR REPLACE FUNCTION public.portal_<x>(...)` — **assinatura
   inalterada**, `SECURITY DEFINER` preservado — cujo corpo delega ao núcleo
   passando `public.current_portal_customer_id()`.
3. `CREATE FUNCTION public.portal_inspect_<x>(p_customer_id BIGINT, <demais
   parâmetros>)`, também `SECURITY DEFINER`, delegando ao núcleo com
   `public._portal_inspect_guard(p_customer_id)`. `REVOKE ALL ... FROM PUBLIC,
   anon` e `GRANT EXECUTE ... TO authenticated`.

**A forma da delegação depende do tipo de retorno** — não existe uma linha
única que sirva para as nove. `RETURN QUERY SELECT * FROM ...` só vale para as
que retornam `TABLE`; para `jsonb` e `int` a delegação é
`RETURN public._portal_<x>_core(...)`. **Seis das nove retornam `jsonb`, uma
retorna `int` e só duas retornam `TABLE`** — a forma do `RETURN QUERY` é a
exceção, não a regra.

Os invólucros **não** podem ficar em `SECURITY INVOKER` (o default): o núcleo
tem `EXECUTE` revogado de `authenticated`, e um invólucro invoker falharia com
`42501` para todo mundo, cliente incluído.

As nove RPCs escopadas por cliente, com a migration que carrega a **definição
vigente** — é dela que o corpo deve ser copiado, não da migration de origem:

| RPC do cliente | Definição vigente | Retorno | Superfície |
|---|---|---|---|
| `portal_list_invoices()` | `123` | `TABLE` | Faturas |
| `portal_invoice_details(bigint)` | `261` | `jsonb` | Modal de fatura |
| `portal_list_demurrage_invoices()` | `159` | `jsonb` | Faturas — demurrage |
| `portal_get_demurrage_invoice_detail(bigint)` | `123` | `jsonb` | Modal de demurrage |
| `portal_list_consolidatable_receivables()` | `123` | `TABLE` | Consolidação |
| `portal_list_operation_bls()` | `202` | `jsonb` | Operação |
| `portal_get_profile()` | `116` | `jsonb` | Perfil |
| `portal_list_notifications(int)` | `119` | `jsonb` | Sino |
| `portal_notification_unread_count()` | `116` | `int` | Badge do sino |

Copiar da migration de origem em vez da vigente é o erro mais caro possível
aqui: `portal_list_invoices` nasceu em `084`, mas foi `123` que lhe acrescentou
o gate de CE Mercante. Um núcleo construído a partir de `084` mostraria ao
cliente faturas que a regra de CE Mercante esconde — e o teste de paridade
passaria, porque as duas portas chamariam o mesmo núcleo errado. **A paridade
garante que as duas portas concordem, não que a porta esteja certa.**

**`portal_list_operation_bls` exige tratamento próprio.** Desde `202:18` ela não
resolve identidade no próprio corpo: delega a
`portal_list_operation_bls_without_transshipment()`, e é a função aninhada que
chama `current_portal_customer_id()`. Trocar `v_customer_id` no corpo externo
não resolve nada — a aba "BLs e Containers" levantaria `28000` na inspeção. O
par núcleo/invólucro precisa ser aplicado à **função aninhada**, com a externa
repassando o `p_customer_id` recebido.

E as duas metades vêm de migrations diferentes: a `202` apenas **renomeia** a
função definida em `123:28` para `_without_transshipment` (`202:4-5`) e cria uma
externa nova (`202:10`). O corpo da externa se copia da `202`; o da aninhada, da
`123`. A tabela acima registra `202` porque é onde está a assinatura pública —
seguir só ela perderia o corpo que de fato consulta os BLs.

**`portal_get_current_roe()` também precisa de par.** A versão anterior deste
plano a dispensava por "não ser escopada por cliente" — o valor de ROE de fato
é global, mas `200:50` faz `PERFORM public.current_portal_customer_id()` como
guarda de sessão, o que levanta `28000` para o usuário interno. Sem par, o ROE
some da tela de Faturas. Como não há dado por cliente a filtrar, o par aqui é
degenerado: `portal_inspect_get_current_roe()` chama o guard da inspeção e lê a
mesma linha, sem parâmetro de cliente.

A única RPC do Portal que a inspeção chama **direto**, sem par, é
`portal_ship_schedule()`: ela é allowlisted a `anon`
(`portalShipScheduleMigration.test.ts`) e não resolve identidade nenhuma.

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
`usePortalAuth().overview` é `null` — e quatro consumidores dependem dele hoje:

| Consumidor | Uso atual | Sintoma sem correção |
|---|---|---|
| `PortalLayout.tsx:43-47` | `overview?.customer_name`, `customer_cnpj_cpf` | Cabeçalho mostra o fallback "Cliente" |
| `usePortalProfile.ts` | `enabled: Boolean(overview)` | Aba Perfil nunca carrega |
| `NotificationBell.tsx:42` | `if (!overview) return null` | Sino some da tela |
| `PortalBilling.tsx:60`, `:198` | `overview?.pending_balance` | Card "Saldo pendente" vazio |

Pior que os quatro: se o usuário interno tiver uma sessão de Portal antiga na
mesma aba, `overview` não é `null` — é o **overview de outro cliente**, e a
inspeção exibiria a identidade errada no cabeçalho e o **saldo financeiro de
outro cliente** na tela de Faturas. Fidelidade invertida, que é exatamente o que
esta ferramenta não pode fazer.

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
- Prefixar as chaves de inspeção com `portal-inspect-`, **dentro** do namespace
  `portal-`. `clearPortalQueries` em `src/hooks/usePortalAuth.tsx` remove por
  `String(query.queryKey[0]).startsWith('portal-')`, e ficar dentro do
  namespace é o comportamento desejado: um logout do Portal na mesma aba deve
  levar junto o cache de inspeção, não deixá-lo para trás.

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

Três camadas, e a terceira é a que a versão anterior deste plano não tinha:

- **UI**: os controles ficam visíveis mas desabilitados, com tooltip "Ação do
  cliente — indisponível em Modo Inspeção". Ocultá-los quebraria a fidelidade,
  que é o ponto da ferramenta.
- **Banco**: nenhuma dessas RPCs ganha par `portal_inspect_*`. Não existe
  caminho no banco para o interno executá-las **em nome de outro cliente** —
  elas resolvem por `current_portal_customer_id()`, que para um usuário interno
  levanta `28000`.
- **Cliente Supabase**: em modo inspeção, as funções de escrita **não podem
  usar `supabasePortal`**.

A terceira camada existe porque a segunda tem um furo, e é o mesmo cenário que
a 2.2 já levanta: se houver sessão de Portal residual na mesma aba, `28000` não
acontece — `current_portal_customer_id()` resolve com sucesso para o **cliente
B** da sessão antiga. A tela mostra o cliente A, e a gravação cai no cliente B.
Escrita cruzada silenciosa, a pior falha que esta ferramenta poderia ter.

Mitigação: `callPortalRpc` (2.1) recusa qualquer RPC de escrita quando
`scope.mode === 'inspect'` — lança antes de tocar em qualquer cliente Supabase,
em vez de confiar que a UI desabilitou o botão. É a mesma disciplina do resto do
projeto: corrigir na função compartilhada, não em cada call site.

**Marcar notificação como lida é o caso difícil**, porque colide com a 3.2.
`NotificationBell.tsx:90-94` tem um handler só, que faz as duas coisas:

```ts
if (!n.read) await markRead.mutateAsync(n.id)
if (n.link?.startsWith('/portal')) navigate(n.link)
```

Desabilitar o item inteiro mataria a navegação que a 3.2 exige; deixá-lo ativo
marcaria como lida uma notificação do cliente. Resolução: separar as duas metades
no handler — em modo inspeção a chamada a `markRead` é pulada e o `navigate`
acontece normalmente. O item continua clicável e o estado "não lida" permanece
intacto, que é exatamente o que o cliente veria ao voltar.

## Etapa 3 — Superfície de entrada (P1)

### 3.1 Rota

`/clientes/portal/inspecao/:customerId/*`, nas rotas internas — mas **fora do
`<Route element={<AppLayout />}>`** de `src/App.tsx:134`, e dentro do
`<ProtectedRoute />`.

As duas restrições têm motivos opostos e igualmente firmes:

- Não pode ficar sob `/portal/*`: `App.tsx:75` trata host `portal.*` como
  domínio exclusivo de cliente e redireciona rotas internas para `/portal`.
- Não pode ficar dentro do `AppLayout`: todas as rotas internas de `App.tsx:134`
  em diante renderizam o chrome interno, e a inspeção montaria `PortalLayout`
  aninhado nele — sidebar interna por fora, cabeçalho do Portal por dentro. Duas
  molduras concorrentes destroem a fidelidade que é o objetivo da ferramenta e
  brigam com a faixa da 3.4. O lugar certo é o mesmo de
  `/line-up-tv/display` (`App.tsx:133`): protegido, sem `AppLayout`.

O sufixo `/*` é necessário para as sub-rotas das abas exigidas pela 3.2 — sem
ele, `/inspecao/:customerId/billing` não casa com nada.

A página monta `PortalScopeContext`, chama `portal_open_inspection` na entrada
(deduplicado no servidor pela 1.1, então o duplo efeito do `StrictMode` não
gera duas linhas), e renderiza o mesmo `PortalLayout` do Portal real.

### 3.2 Base path em **todos** os destinos, não só na navegação

`src/components/layout/PortalLayout.tsx:10-13` tem `portalNavItems` com
`/portal`, `/portal/billing`, `/portal/operacao`, `/portal/perfil` hardcoded —
mas corrigir só essa lista não mantém o usuário dentro da inspeção. Há mais
famílias de destino absoluto, e uma armadilha que não é link nenhum:

| Origem | Linhas | O que acontece sem correção |
|---|---|---|
| `PortalLayout` — nav, brand, pill de perfil | `:10-13`, `:24`, `:36` | Navegação principal escapa |
| `PortalDashboard` — os quatro cards de indicador | `:39`, `:45`, `:51`, `:57` | Clicar num KPI escapa |
| `NotificationBell` — `navigate(n.link)` com guarda `startsWith('/portal')` | `:92` | Clicar numa notificação escapa |
| `PortalLayout` — botão **Sair** | `:50` | Não escapa: derruba a sessão de Portal real da aba |

"Escapar" aqui significa cair em `/portal/*`, que é rota exclusiva de cliente:
o usuário interno, sem sessão de Portal, é jogado no login do Portal e perde a
inspeção.

O botão **Sair** é o caso mais perverso da lista porque não é um link — chama
`signOut()` do `usePortalAuth`. Em modo inspeção ele encerraria a sessão de
Portal de quem quer que estivesse logado naquela aba e rodaria
`clearPortalQueries`, que limpa o cache `portal-inspect-*` da própria inspeção
(2.3) e deixa a tela em branco. Em modo inspeção ele vira o botão de **sair da
inspeção**, voltando para a origem — que é também o controle de saída pedido
pela 3.4, então os dois viram o mesmo botão em vez de dois concorrentes.

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

Sem gate de permissão próprio no botão — é a decisão 2. Mas o botão só existe
onde `portal_list_provisioning_console` devolve linhas, e essa RPC nega quem não
estiver em `('administrativo','documentacao','financeiro','operacoes')`
(`196:8`, `197:9`). `equipamentos` nunca enxerga o painel — logo, nunca enxerga
o botão —, embora alcance a rota digitando a URL, porque o gate do banco é
`is_active_read_user()`, que o inclui.

**Decisão 11: todos os setores devem ver, Equipamentos incluído.** Então a
correção não é na Inspeção: é abrir o console de provisionamento a
`equipamentos`, para que a capacidade seja descobrível por quem a tem. Ver 3.5.

### 3.4 Faixa de Modo Inspeção

Faixa persistente no topo, fora do chrome do Portal para não se confundir com
ele: nome e CNPJ do cliente, situação da conta quando não for ativa, e o botão
de saída da 3.2 — que é o mesmo controle, não um segundo. Sem ela, um print de
tela em modo inspeção seria indistinguível de um print do cliente — e alguém,
uma hora, vai colar esse print num ticket.

### 3.5 Abrir o console de provisionamento a Equipamentos

Consequência da decisão 11, e a única parte deste plano que mexe fora da
Inspeção. São **três** objetos a tratar, não um.

**Definição vigente: `198:48`, não `196`/`197`.** A `198` reescreveu a função
para acrescentar o self-heal e removeu o `STABLE`. Partir de `197` reverteria a
`198` silenciosamente — o mesmo erro que a coluna "Definição vigente" da 1.4
existe para evitar.

**a) `portal_list_provisioning_console` — o gate de papel.** Hoje (`198:52-54`):

```sql
v_full_access BOOLEAN := v_role IN ('administrativo','documentacao','financeiro');
IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao','financeiro','operacoes') THEN
```

`equipamentos` entra nas **duas** listas: passa o gate e recebe acesso completo.
Acesso reduzido faria Equipamentos ver o painel sem os dados que o botão de
inspeção acompanha, o que é pior do que não ver.

**b) O self-heal, que é escrita.** `198:58` faz
`PERFORM public.portal_repair_missing_accounts()`, e essa função insere em
`customer_portal_accounts` (`198:14`) e em `portal_provisioning_events`
(`198:29`). Ou seja: **ler o console grava**. Dizer "isto abre leitura, não
escrita" seria falso, e daria a Equipamentos — cujo isolamento de escrita a
`211` endureceu de propósito — o poder de disparar criação de contas de Portal.

Correção: o `PERFORM` passa a ser condicionado aos papéis que já o disparavam
hoje. Equipamentos lê o console sem acionar o reparo. As linhas que o self-heal
cria são as mesmas independentemente de quem o dispara, então nada se perde: o
primeiro dos outros quatro papéis a abrir a fila repara igual.

**c) `portal_list_provisioning_events` — o histórico.** `196:44-48` nega quem
não estiver em `('administrativo','documentacao','financeiro')` — nem
`operacoes` entra. E `PortalReviewPanel.tsx:31` chama
`usePortalEvents(row.customer_id, !isOperations)`: para `equipamentos`,
`isOperations` é `false`, então a query é habilitada e a RPC levanta `42501` a
cada linha expandida. Abrir (a) sem tratar (c) troca "painel invisível" por
"painel que dá erro".

Correção: `equipamentos` entra também no gate de `portal_list_provisioning_events`
e a flag do hook deixa de ser `!isOperations` e passa a nomear os papéis que
enxergam histórico.

A alteração vai na mesma migration `292`, com a justificativa no cabeçalho.

**Ampliação de superfície a registrar**, no mesmo padrão que a decisão 9 exige:
acesso completo no console entrega a Equipamentos `recovery_email`,
`recovery_email_source`, `latest_delivery_status`, `exception_reason`,
`shared_email_count` e `candidates` — este último uma lista de emails de
contatos do cliente (`198:68-91`). Não é dado do Portal reprojetado; é dado de
provisionamento que hoje três papéis veem. Precisa estar na ADR, não implícito.

**Inconsistência que fica de pé, e precisa de decisão sua em algum momento:**
com Equipamentos em acesso completo, `operacoes` vira o **único** perfil com
`v_full_access = false`, recebendo situação resumida e os booleanos
`has_open_invoice`/`has_active_process` (`docs/ARCHITECTURE.md:450`), e sem
histórico. Isso contradiz o mesmo princípio que a decisão 11 aplica — "todos os
departamentos têm visualização sobre o sistema inteiro; o que muda é o que podem
editar". Recomendo alinhar Operações no mesmo change; não fiz aqui porque é a
projeção de outra tela e você não decidiu sobre ela.

## Etapa 4 — Testes (P0, junto da etapa 1)

### 4.1 Paridade, uma por RPC

Reaproveitar o harness de integração da #527 (`SET LOCAL request.jwt.claim.sub`
+ `ROLLBACK`): para um cliente de teste, autenticar como a conta de Portal dele,
chamar `portal_<x>()`, e comparar o retorno com `portal_inspect_<x>(customer_id)`
chamada como usuário interno. Igualdade estrutural.

Três armadilhas a evitar, e a terceira é a que compromete o plano inteiro:

- **Verde vazio.** Asserir conteúdo não-vazio, nunca só `error === null` — é
  exatamente o bug corrigido em `src/integration/supabase.integration.test.ts`
  pela #528 ("distingue *RLS filtrou* de *tabela sem dado*"), e a ADR 0044
  registra que RLS devolve `200 []` em vez de erro.
- **Igualdade trivial.** Se as duas chamadas devolvem lista vazia, o teste passa
  sem provar nada. O fixture precisa garantir pelo menos uma fatura, um BL e uma
  notificação.
- **Teste que não roda.** Todo harness de integração deste projeto é
  `describe.skip` por padrão: `supabase.integration.test.ts:5-6` exige
  `SUPABASE_RUN_INTEGRATION=1` e os `*.local-pg.test.ts` exigem
  `LOCAL_PG_INTEGRATION=1`. O CI roda `npm test -- --shard` (`ci.yml:78`) sem
  nenhuma das duas. Escrito assim, **o único teste que sustenta a garantia de
  fidelidade nunca executa** — e o plano estaria confiando num verde que não
  significa nada, que é o mesmo erro de forma que a #528 corrigiu.

**Decisão 10: os dois testes, e o de estrutura é obrigatório.**

1. **Teste de estrutura** (contrato SQL, sem banco, roda em todo PR): extrair o
   corpo de cada `portal_<x>` e de cada `portal_inspect_<x>` das migrations e
   asserir que ambos delegam ao mesmo `_portal_<x>_core`, sem SQL próprio. Não
   prova igualdade de resultado, mas prova a **estrutura** que a produz — e pega
   o cenário de regressão real, que é alguém editar `portal_<x>` inline e romper
   a delegação.
2. **Teste de igualdade de resultado**, no harness de integração, rodado sob
   demanda com `SUPABASE_RUN_INTEGRATION=1`. É a prova forte.

O (1) é condição de merge; o (2) é a prova que se roda antes de liberar a
funcionalidade. Ligar o Postgres no CI foi descartado por ora: mexeria no
pipeline de todo mundo e a manutenção do fixture viraria custo de todo PR —
mudança que vai além desta feature e merece decisão própria.

### 4.2 Contrato de grants

Teste no padrão de `portalInvoiceDetailsAnonGrantInvariant.test.ts`, varrendo as
migrations em ordem: toda função nova desta migration — `portal_inspect_*`,
`_portal_*_core`, **`_portal_inspect_guard` e `portal_open_inspection`** — deve
ter `REVOKE` de `anon`, e nenhum `GRANT ... TO anon` posterior.

Os dois últimos entram por nome porque não casam com o padrão `portal_inspect_*`
nem com `_portal_*_core`, e são justamente os mais sensíveis: um grava
auditoria e devolve overview de qualquer cliente, o outro é o gate. Um teste que
varresse só os dois prefixos deixaria ambos descobertos.

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
| ADR nova (`0045`) | Decisão da Inspeção; estende ADR 0044 a esta superfície **e a `contact_email`**; registra a dívida da decisão 3 (cliente não informado), a exceção da `portal_get_session_overview_v2`, o limite da auditoria (cobre a ferramenta, não a API) e a descoberta desigual do botão para Equipamentos |
| `CONTEXT.md` | Entrada **Inspeção do Portal** na seção do Portal (antes de *Conta de Portal*), distinguindo-a de Provisionamento e de recuperação assistida |
| `docs/modules/portal-cliente.md` | Catálogo de ações da inspeção; o par núcleo/invólucro; a exceção; reforço da nota de `ALTER DEFAULT PRIVILEGES` (:225) |
| `docs/RASTREABILIDADE.md` | Rota, componentes, hooks, serviços, RPCs e testes novos |
| `docs/ARCHITECTURE.md` | Rota nova; nota de que `PortalLayout` serve dois hosts e dois modos; console de provisionamento agora inclui `equipamentos` (:450) |
| `docs/plans/README.md` | Linha deste plano; remover ao concluir |
| `docs/CHANGELOG.md` | Entrega, ao concluir |

## Ordem de execução

1. Etapa 1 + Etapa 4.1(1)/4.2/4.4 (banco e suas provas de estrutura) — sozinhas
   já são verificáveis e não mudam nada visível.
2. Etapa 2 + Etapa 4.3 (escopo e bloqueio de escrita).
3. Etapa 3, incluindo 3.5 (rota, layout, botão, faixa, console para
   Equipamentos).
4. Etapa 5 (documentação), no mesmo change da etapa que a torna verdadeira.
5. Antes de liberar a funcionalidade: rodar o teste de igualdade de resultado
   (4.1(2)) com `SUPABASE_RUN_INTEGRATION=1`, que o CI não roda.

Verificação antes de concluir: `npm run docs:check`, `npm run lint`, `npm test`,
`npm run build`.

## Riscos e pontos de atenção

- **Grant a `anon` em função nova.** O risco estrutural desta mudança. Mitigado
  pelo `REVOKE` explícito em cada objeto novo e pelo teste 4.2 — que precisa
  cobrir os quatro padrões de nome, não só dois.
- **Auditoria contornável.** As `portal_inspect_*` são chamáveis diretamente com
  qualquer `p_customer_id`, sem passar por `portal_open_inspection`. Quem tiver
  um token interno e souber o nome da RPC lê o Portal de qualquer cliente sem
  gerar linha de auditoria. Como a auditoria é justamente o controle que sustenta
  a decisão 3 (não informar o cliente), a lacuna é relevante — mas fechá-la
  exigiria gravar a cada chamada, que a decisão 4 recusou. **Decisão 12: aceitar
  e registrar na ADR** com a redação honesta — a auditoria cobre o uso pela
  ferramenta, não o acesso pela API. O argumento que sustenta o aceite: quem
  consegue chamar a RPC direto já é usuário interno ativo que, desde a `291`, lê
  os mesmos dados pelas telas internas sem auditoria nenhuma; a Inspeção não cria
  a exposição, reprojeta. Quem quiser fechar depois: exigir um token de sessão de
  inspeção como parâmetro das `portal_inspect_*`.
- **Divergência silenciosa por `CREATE OR REPLACE` futuro.** Alguém pode, mais
  tarde, editar o corpo de `portal_<x>` inline em vez de mexer no núcleo,
  quebrando a paridade. Mitigado pelo teste de estrutura da 4.1(1), que roda em
  todo PR; o de igualdade de resultado — 4.1(2) — só roda com o harness de
  integração ligado.
- **Núcleo construído a partir da migration errada.** A paridade garante que as
  duas portas concordem, não que estejam certas: um núcleo copiado da migration
  de origem em vez da vigente passa em todos os testes de paridade e mostra ao
  cliente dado que uma regra posterior escondia. Mitigado pela coluna "Definição
  vigente" da 1.4, que precisa ser reconferida no momento da execução — não é
  informação estável.
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

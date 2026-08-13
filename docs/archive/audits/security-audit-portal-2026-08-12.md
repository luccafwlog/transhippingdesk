# Security Audit & Penetration Testing — Portal do Cliente (2ª rodada)

> **Snapshot histórico:** este relatório descreve o repositório na data indicada.
> Achados podem ter sido corrigidos depois. Para o estado atual, consulte
> [`docs/README.md`](../../README.md), o código e as migrations.

**Data:** 2026-08-12 · **Escopo:** Portal do Cliente — fronteira entre a sessão
do cliente e o sistema interno (289 migrations Supabase, RLS/ACL, RPCs,
12 Edge Functions, rotas, telemetria e dependências do Portal) ·
**Método:** varredura do catálogo real do Postgres em banco descartável com
replay completo das 288 migrations (`scripts/setup-local-pg.sh`), testes de
penetração com duas identidades reais, análise estática do repositório e
`npm audit`. Padrões referenciados: OWASP Top 10 2023 (A01 Broken Access
Control, A07 Identification and Authentication Failures, A09 Security Logging
Failures), CWE-732, CWE-284, CWE-204, CWE-598, CWE-1004.

Rótulos de evidência conforme [`docs/CONVENCOES.md`](../../CONVENCOES.md):
**Código**, **Teste**, **Teste de contrato SQL**, **Runtime**, **Suspeita**.

**Premissas auditadas** (as mesmas da rodada anterior, mais uma):

1. Nenhum cliente pode visualizar dados do sistema interno que não foram
   desenhados para ele.
2. Nenhum cliente pode visualizar dados de outro cliente.
3. Nenhum cliente pode **escrever** no sistema interno fora dos poucos atos que
   o Portal lhe concede (perfil, disputa, consolidação, leitura de notificação).

**Continuidade:** esta é a segunda auditoria do Portal. A primeira
([`security-audit-portal-2026-08-05.md`](security-audit-portal-2026-08-05.md))
fechou seis vazamentos de **leitura** na migration `257`. Esta rodada varreu o
que nasceu depois (migrations `258`–`289`), inverteu o eixo para **escrita** e
estendeu o escopo para telemetria, tokens de recuperação e dependências —
superfícies que a primeira rodada não cobriu.

---

## 1. Sumário executivo

**Postura geral: o núcleo permanece correto; o eixo de escrita tinha uma
exceção.** As duas premissas da rodada anterior continuam válidas em runtime:
uma sessão de cliente do Portal lê **0 linhas** de `invoices`, `customers` e
`bls`, e `portal_invoice_details` do cliente A recusa a fatura do cliente B com
`P0002` enquanto entrega a própria. **Runtime**

A premissa 3 falhou em um ponto. Das ~36 RPCs `SECURITY DEFINER` de escrita
alcançáveis pelo role `authenticated`, **35 recusaram** a sessão do cliente com
`42501` e **uma executou**: `import_manifest_transactional` criou um lote de
importação e um B/L numa viagem arbitrária. É a mesma raiz sistêmica que a
rodada anterior documentou — o cliente do Portal recebe o mesmo role
`authenticated` do usuário interno —, agora manifestada em escrita, não em
leitura.

Fora do banco, três achados de menor severidade na borda de autenticação: a
tela de recuperação de senha **enumera contas** contrariando o que duas docs
vivas afirmam, os tokens de recuperação e ativação **viajam na URL** e chegam ao
Sentry sem higienização, e uma Edge Function do fluxo de ativação responde com
`Access-Control-Allow-Origin: *` em vez da allowlist compartilhada.

**Resultado:** 6 achados — 1 ALTO, 2 MÉDIO, 3 BAIXO. **Nenhum corrigido nesta
mudança**: a remediação foi planejada e aprovada para execução posterior, em
[`docs/plans/2026-08-12-remediacao-seguranca-portal.md`](../../plans/2026-08-12-remediacao-seguranca-portal.md).

| # | Achado | Severidade | Premissa ferida | Status |
|---|---|---|---|---|
| 1 | `import_manifest_transactional` grava sem guarda de identidade | 🔴 Alto | 3 | Planejado |
| 2 | `/portal/esqueci-senha` enumera contas do Portal | 🟠 Médio | — (borda de auth) | Planejado |
| 3 | Token de recuperação/ativação vaza para o Sentry pela URL | 🟠 Médio | — (borda de auth) | Planejado |
| 4 | `portal-invite-activate` responde CORS `*` | 🔵 Baixo | — | Planejado |
| 5 | `portal_invoice_details` com EXECUTE para `anon` | 🔵 Baixo | 2 (latente) | Planejado |
| 6 | `react-router` 7.17.0 com advisory HIGH | 🔵 Baixo | — | Recomendado |

---

## 2. Modelo de ameaça

O atacante é um **cliente legítimo do Portal**: possui CNPJ e senha válidos e,
após o login, um JWT com `role = authenticated` e um `auth.uid()` que existe em
`customer_portal_accounts` mas **não** em `user_profiles`. Ele alcança, pela API
REST do Supabase e sem passar pelo frontend, qualquer tabela com policy
permissiva para `authenticated` e qualquer função com `EXECUTE` para
`authenticated`.

A identidade foi reproduzida fielmente no banco descartável e confirmada antes
de qualquer teste: **Runtime**

| Verificação | Cliente do Portal |
|---|---|
| `is_active_read_user()` | `false` |
| `is_active_user()` | `false` |
| `is_admin()` | `false` |
| `current_portal_customer_id()` | `1` (resolve — a conta é real) |

Para os achados 2, 3 e 4 o atacante é **anônimo na internet**: não precisa de
conta, só do endpoint público de recuperação, de um link de convite interceptado
ou do acesso ao projeto Sentry.

---

## 3. Achados

### 3.1 🔴 ALTO — `import_manifest_transactional` grava sem guarda de identidade

**Onde:** `public.import_manifest_transactional(text, bigint, uuid, text, text,
integer, integer, jsonb, jsonb, jsonb, boolean)` — `SECURITY DEFINER`, `EXECUTE`
para `authenticated`, **sem nenhuma verificação de identidade**. A função atual
(migration `285`) delega ao núcleo `import_manifest_transactional_legacy_165`,
que também não guarda: seus únicos controles são um rate limit por
`p_uploaded_by` — parâmetro fornecido pelo próprio chamador — e a existência da
viagem. **Código**

Todos os irmãos guardam. `import_bl_freight_transactional_legacy_205` e
`save_granite_bl_review_legacy_148` exigem
`auth.uid() IS NOT NULL AND is_active_user() AND p_changed_by = auth.uid()`;
`import_manifest_transactional_legacy_165` é o único da família que não recebeu
essa guarda. **Código**

**Impacto:** fere a premissa 3. Um cliente do Portal escreve no núcleo
operacional de **qualquer** viagem: cria `import_batches` e `bls` com
identificadores, POL/POD e dados comerciais de sua escolha, e atribui a autoria
a um `p_uploaded_by` arbitrário — inclusive o UUID de um usuário interno, que
passa a constar como quem importou. Com `p_apply_overwrites = true` o caminho
deixa de ser só criação: a importação sobrescreve dados de B/Ls existentes, de
outros clientes. São registros que alimentam cálculo de taxas locais,
conciliação e faturamento. CWE-732, CWE-284, OWASP A01.

**PoC (banco descartável, escrita confirmada):** com a identidade do cliente do
Portal descrita na seção 2, a chamada retornou `batch_id` e as linhas foram
lidas de volta com a sessão restaurada dentro da mesma transação, antes do
`ROLLBACK`: **Runtime**

| Evidência | Resultado |
|---|---|
| `import_manifest_transactional(...)` | executou, retornou `batch_id = 3` |
| `bls` após o ataque | `BL-PENTEST-001`, `voyage_id = 9001`, `CNSHA → BRVIX` |
| `import_batches` após o ataque | `id = 3`, `filename = pentest.xlsx`, `voyage_id = 9001` |

**Contexto que limita, mas não anula:** a função **não tem chamador em
produção** — a operação de container passou a ingerir pelos arquivos de B/L
(ADR 0025) e o único consumidor restante é
`src/integration/supabase.integration.test.ts`. A superfície continua exposta na
API REST do Supabase, que é o que importa para o atacante. **Código**

**Correção planejada:** guarda de identidade no mesmo formato dos irmãos, na
função pública (o núcleo `legacy_165` já está revogado de `PUBLIC`, `anon` e
`authenticated`), mais `REVOKE` explícito de `anon`. O teste de integração
autentica como usuário interno e passa `p_uploaded_by = userId`, então
permanece compatível. **Código**

### 3.2 🟠 MÉDIO — `/portal/esqueci-senha` enumera contas do Portal

**Onde:** `src/pages/PortalForgotPassword.tsx` e
`supabase/functions/portal-password-recovery/index.ts`. A Edge Function devolve
`{ account_found, email_sent }` e a tela traduz literalmente: *"Não existe uma
conta do Portal vinculada a este CNPJ"*, *"Conta encontrada"* ou *"Existe uma
conta vinculada, mas não foi possível enviar o email"*. **Código**

**Impacto:** um anônimo descobre, por CNPJ, quais empresas são clientes com
Portal ativo — a carteira de clientes da agência é informação comercialmente
sensível, e a resposta ainda separa *conta ativa* de *conta com email
indisponível*. O rate limit existente
(`portal_recovery_check_rate_limit(p_login)`) é **por CNPJ**: ele impede
martelar o mesmo CNPJ, mas não impõe nenhum custo a varrer CNPJs distintos, que
é exatamente a forma da enumeração. CWE-204 (discrepância observável em
resposta), OWASP A07.

**Divergência de contrato:** duas docs vivas afirmam o oposto do que o código
faz — `docs/RASTREABILIDADE.md` linha 34 ("Envia recuperação quando elegível;
**resposta permanece genérica**") e `docs/modules/portal-cliente.md` linha 122
("**Mantém resposta não enumerável**"). `docs/operations/validacao.md` linha 366
ainda instrui o operador a "confirmar resposta que não enumera conta". O achado
não é uma opinião de severidade: é o código divergindo do contrato documentado.
**Código**

**Correção planejada:** alinhar o código à doc — resposta única e neutra na
tela, qualquer que seja o desfecho, preservando o envio real do email quando
elegível.

### 3.3 🟠 MÉDIO — Token de recuperação e de ativação vaza para o Sentry pela URL

**Onde:** `src/lib/telemetry.ts` (`beforeSend`), `src/pages/PortalResetPassword.tsx`
e `src/pages/PortalAtivacao.tsx`. Os links enviados por email carregam o token
na query string — `/portal/recuperar-senha?token=…` (uso único, validade 1h,
redefine a senha) e `/portal/ativar?token=…` (validade 48h, cria a conta). **Código**

**Mecanismo:** a `httpContextIntegration` do `@sentry/browser` está entre as
integrações **default** e, no seu `preprocessEvent`, grava
`event.request = { url: getLocationHref(), headers: { Referer, User-Agent } }`.
`preprocessEvent` roda **antes** do `beforeSend`. O `beforeSend` do projeto
higieniza `exception.values[].value`, `message`, `extra` e
`breadcrumbs[].message` — **não** toca em `event.request.url`. `sendDefaultPii:
false` não cobre esse campo. Logo, qualquer erro JavaScript ocorrido enquanto o
token está na barra de endereço envia o token vivo para um terceiro.
**Código**

**Impacto:** o token de recuperação é credencial de redefinição de senha; quem o
lê antes do uso assume a conta do cliente. A exposição exige um erro na página e
acesso ao projeto Sentry, o que a mantém em MÉDIO e não em ALTO. Some-se a
retenção do token no histórico do navegador e no `Referer` de qualquer
navegação subsequente. CWE-598, CWE-1004, OWASP A09.

**Precedente interno:** `src/pages/PortalProfile.tsx` já faz o certo — após
consumir `?confirm_email=`, remove o parâmetro com
`setSearchParams(..., { replace: true })`. As duas telas de token não seguem o
padrão. **Código**

**Correção planejada:** redigir a query string de `event.request.url` no
`beforeSend` e remover o token da URL após a leitura nas duas telas, espelhando
`PortalProfile`.

### 3.4 🔵 BAIXO — `portal-invite-activate` responde `Access-Control-Allow-Origin: *`

**Onde:** `supabase/functions/portal-invite-activate/index.ts` monta os headers
à mão com `'Access-Control-Allow-Origin': '*'`, enquanto todas as outras Edge
Functions do Portal usam a allowlist única de `_shared/cors.ts` — criada
justamente para acabar com essa divergência. **Código**

**Impacto:** qualquer origem pode invocar `inspect` e `activate` a partir do
navegador da vítima e ler a resposta. Não há credencial de sessão em jogo (a
função autentica pelo token do convite, não por cookie), então o ganho para o
atacante é marginal: com o token em mãos ele chamaria a função direto do
servidor. É higiene de fronteira, não vazamento — e uma inconsistência que
convida a próxima função a repeti-la.

**Correção planejada:** usar `withCors`/`corsHeaders` do `_shared/cors.ts`.

### 3.5 🔵 BAIXO — `portal_invoice_details` com EXECUTE para `anon`

**Onde:** migration `261` fecha com
`GRANT EXECUTE ON FUNCTION public.portal_invoice_details(bigint) TO
authenticated, anon`. A ADR 0013 documenta o `anon` do Portal como allowlist
fechada; `portal_ship_schedule` é a exceção deliberada e testada, e
`portal_invoice_details` não está nessa lista. **Código**

**Exposição atual: nenhuma.** A função resolve o cliente por
`current_portal_customer_id()`, que lança `28000` quando `auth.uid()` é nulo.
Verificado: uma sessão com role `anon` recebeu
`28000 Sessao do portal invalida ou expirada`. É defesa em profundidade
funcionando — o grant errado foi absorvido pela guarda do corpo. **Runtime**

**Por que ainda é achado:** o grant é a fronteira que a ADR 0011 escolheu, e ele
está aberto. Basta uma futura reescrita trocar a guarda por um filtro no `WHERE`
para o vazamento passar a ser real, sem que nada na migration acuse.

**Correção planejada:** `REVOKE EXECUTE ... FROM anon`, sem tocar no corpo.

### 3.6 🔵 BAIXO — `react-router` 7.17.0 com advisory HIGH

**Onde:** `package.json` fixa `react-router-dom ^7.17.0`; `npm audit` reporta 2
vulnerabilidades (1 HIGH, 1 moderada) em `react-router 6.0.0 – 7.18.1`.
**Runtime**

Das cinco advisories da cadeia, três (`RSCErrorHandler`, `deserializeErrors` na
hidratação SSR, bypass de CSRF em modo RSC) **não se aplicam**: o app é SPA com
`@vitejs/plugin-react`, sem SSR e sem RSC. Restam o open redirect por
contrabarra em `<Link>`/`useNavigate` (GHSA-wrjc-x8rr-h8h6) e o DoS por
casamento ineficiente de rotas. O open redirect exige que um destino
controlado pelo usuário chegue a `Link`/`navigate`; as rotas do Portal navegam
para caminhos literais. **Suspeita** quanto à explorabilidade concreta.

**Recomendação:** subir para `7.18.2+` numa frente própria, com regressão de
rotas — o bump atinge todas as rotas do app, não só o Portal, e não cabe numa
mudança de segurança do Portal.

---

## 4. Teste de penetração — estado atual (pré-remediação)

Executado contra banco descartável com replay das 288 migrations
(`scripts/setup-local-pg.sh`), com as duas identidades da seção 2 e dados
semeados. Como esta rodada **não aplica** correções, a coluna "depois" será
preenchida pela execução do plano. **Runtime**

**Escritas — ~36 RPCs `SECURITY DEFINER` alcançáveis por `authenticated`:**

| Objeto | Cliente do Portal |
|---|---|
| `import_manifest_transactional` | **executou a escrita** (`batch_id` + `bls`) |
| `import_bl_freight_transactional` | negado `42501` |
| `import_granite_manifest_transactional` / `save_granite_bl_review` | negado `42501` |
| `import_baplie_staging_transactional` | negado `42501` |
| `import_vazios_bookings_transactional` / `import_vazios_importacao_transactional` / `replace_vazios_from_baplie_transactional` | negado `42501` |
| `import_vehicle_rows_transactional` | negado `42501` |
| `save_bl_review` / `save_bl_demurrage_config` | negado `42501` |
| `calculate_bl_local_charges` / `mark_bl_ready_for_billing` / `sync_local_charge_receivable` | negado `42501` |
| `run_billing_for_import_batch` / `add_manual_bl_charge` | negado `42501` |
| `approve_customer_reconciliation` / `reject_customer_reconciliation` / `refresh_customer_reconciliation_queue_for_bl` | negado `42501` |
| `set_voyage_route_ce_master` / `set_import_batch_ce_master` | negado `42501` |
| `omit_voyage_escala` | negado `42501` |
| `add_agency_report_occurrence` / `close_agency_departure_report` / `set_agency_report_terminal` | negado `42501` |
| `detect_overdue_invoices` / `detect_agency_report_pending` / `detect_agency_report_deadline_missed` | negado `42501` |
| `save_exchange_rate_reference` / `recalculate_demurrage_invoices_manual` | negado `42501` |
| `create_manual_vazios_booking` | negado `42501` |
| `apply_bl_review_gate_after_import` | negado `42501` |
| `apply_granite_ce_mercante_update` | negado — `SECURITY INVOKER` + RLS: a linha alvo não existe para o cliente |
| `get_customer_receivables(1)` | negado `42501` |

**Leituras — controle das premissas 1 e 2:**

| Objeto | Cliente do Portal |
|---|---|
| `invoices` (leitura direta) | 0 linhas |
| `customers` (leitura direta) | 0 linhas |
| `bls` (leitura direta) | 0 linhas |
| `portal_invoice_details` da **própria** fatura | leu `INV-CLIENTE-A` (controle positivo) |
| `portal_invoice_details` da fatura do **cliente B** | `P0002 Invoice 9002 nao encontrada` |
| `portal_invoice_details` como `anon` | `28000 Sessao do portal invalida` |

---

## 5. Verificado e considerado correto

- **Isolamento entre clientes (premissa 2) intacto.** Controle positivo e
  negativo na mesma sessão: a própria fatura é lida, a alheia é recusada.
  **Runtime**
- **Fronteira de leitura da rodada anterior mantida.** As policies fechadas pela
  migration `257` continuam fechadas; nenhuma policy `USING (true)` de `SELECT`
  reapareceu nas migrations `258`–`289`. **Runtime**
- **`admin_list_users` (migrations `259`/`260`) guarda por `is_admin()`** e
  revoga `anon` — o padrão certo, aplicado em duas etapas porque a primeira
  revogou apenas `PUBLIC`. **Código**
- **Superfície `anon` é mínima:** além de `portal_ship_schedule` (allowlist
  deliberada), só `portal_invoice_details` (achado 3.5) e seis funções de
  gatilho, que fora do contexto de trigger não executam. **Runtime**
- **Sessões do Portal e do app interno são isoladas no navegador** por
  `storageKey: 'td-portal-auth'` em `supabasePortal`; `detectSessionInUrl` está
  desligado no cliente do Portal. **Código**
- **Tokens de convite e recuperação são fortes e guardados por hash:** 32 bytes
  de `crypto.getRandomValues`, persistidos como SHA-256, consumidos por `UPDATE`
  condicional (`status = 'pendente' AND expires_at > now()`) que impede
  reutilização por corrida. **Código**
- **`portal-login` falha fechado:** erro no rate limit é tratado como bloqueio,
  a mensagem é genérica em todos os desfechos, e o email técnico nunca chega ao
  navegador. **Código**
- **Troca de email de recuperação exige a senha atual**, resolve a conta pelo
  `auth_user_id` do JWT (nunca por identificador do corpo), avisa o endereço
  antigo e revoga todas as sessões na confirmação. **Código**
- **`portal-email-webhook` verifica a assinatura Svix** com tolerância de 300s e
  deduplica por `provider_event_id`. **Código**
- **Política de senha** está no servidor (`supabase/config.toml`:
  `minimum_password_length = 8`, `password_requirements =
  lower_upper_letters_digits`, `enable_signup = false`), conforme a ADR 0019 —
  as Edge Functions checam o piso de 8 como UX, não como fronteira. **Código**

---

## 6. Recomendações permanentes

As cinco recomendações da rodada anterior seguem valendo. Esta rodada acrescenta
três:

6. **A guarda de identidade é obrigatória também nas RPCs de escrita, e a
   família inteira precisa ser conferida junto.** O achado 3.1 sobreviveu porque
   a varredura anterior olhou leitura; o núcleo desguarnecido estava cercado de
   irmãos guardados, o que torna a exceção invisível em revisão pontual.
   Ao auditar uma função transacional, listar todas as `*_transactional` e
   comparar as guardas lado a lado.
7. **Parâmetro de autoria (`p_uploaded_by`, `p_changed_by`, `p_actor`) não é
   identidade.** Ele vem do chamador. Onde ele existe, a guarda tem de amarrá-lo
   a `auth.uid()`, como fazem `legacy_205` e `legacy_148` — caso contrário o
   rate limit e a trilha de auditoria que dependem dele são contornáveis por
   escolha do atacante.
8. **Segredo em URL é segredo publicado.** Token em query string entra no
   histórico, no `Referer` e — comprovadamente — no evento de telemetria. Se o
   formato do link exige o token na URL, a tela precisa removê-lo assim que o
   ler, e o `beforeSend` precisa higienizar `event.request.url`, não apenas os
   campos de mensagem.

---

## 7. Correções aplicadas

**Nenhuma nesta mudança.** A auditoria foi entregue com o plano de remediação
aprovado e não executado, em
[`docs/plans/2026-08-12-remediacao-seguranca-portal.md`](../../plans/2026-08-12-remediacao-seguranca-portal.md).
O achado 3.6 (dependência) foi deliberadamente deixado fora do plano, para uma
frente própria com regressão de rotas.

---

**Auditoria concluída em 2026-08-12.** 6 achados — 1 ALTO, 2 MÉDIO, 3 BAIXO —,
1 confirmado por teste de penetração com escrita real em banco descartável,
5 confirmados por análise estática e por varredura de ACL em runtime.
0 corrigidos: remediação planejada para execução posterior.

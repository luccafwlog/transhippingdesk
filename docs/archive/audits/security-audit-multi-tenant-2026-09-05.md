# Auditoria de segurança, multi-tenancy e isolamento do Portal — 2026-09-05

Documento histórico. Descreve o estado do repositório em 2026-09-05, no commit
de partida da branch `claude/security-audit-multi-tenant-hlchz1`. Correções
aplicadas na mesma mudança estão marcadas **[corrigido]**; as que exigem
migration ficaram **pendentes**, com o SQL no apêndice; o que foi deliberadamente
deixado como está aparece em "Aceito / não corrigido" com a justificativa.

Escopo: isolamento entre Clientes no Portal, RBAC interno, Edge Functions e
webhooks, funções `SECURITY DEFINER`, e vazamento de segredos.

Método: leitura estática do schema (`supabase/migrations/001`–`008`, 43.297
linhas), das 15 Edge Functions e do frontend, com extração programática de
funções, grants e policies. **Não houve execução contra banco real**: não há
projeto Supabase alcançável nesta sessão. Toda afirmação abaixo é **Código** ou
**Teste de contrato SQL**, nunca **Runtime**. As provas de conceito são
conceituais, como pedido — nenhuma foi executada.

## Sumário

O isolamento multi-tenant do Portal está **sólido**. A auditoria não encontrou
nenhum IDOR, nenhuma policy RLS permissiva e nenhum caminho pelo qual uma sessão
de Cliente alcance dado de outro Cliente. As três auditorias anteriores
(`security-audit-2026-06-25`, `security-audit-portal-2026-08-05`,
`security-audit-portal-2026-08-12`) deixaram marca visível: oráculos de
enumeração fechados, segredos fora de `cron.job.command`, grants de função
negados por padrão.

Foram encontrados **dois defeitos reais** (severidade média) e **três apontamentos
de robustez** (baixa). Nenhum é crítico e nenhum é explorável para leitura
cruzada entre Clientes.

| # | Severidade | OWASP | Achado | Estado |
|---|---|---|---|---|
| 1 | Média | A07 Identificação e autenticação | Credencial revogada do Portal ainda hidrata sessão até o token expirar | **Pendente** — SQL pronto no apêndice |
| 2 | Média | A05 Configuração incorreta | Provisionamento do admin de Preview sem guarda de ambiente | **[corrigido]** |
| 3 | Baixa | A01 Quebra de controle de acesso | Autorização no fundo da cadeia de delegação, não na fronteira do `GRANT` | **Pendente** — receita no apêndice |
| 4 | Baixa | A05 Configuração incorreta | Ausência de `Strict-Transport-Security` | **[corrigido]** |
| 5 | Baixa | A04 Design inseguro | Bloqueio de login por CNPJ permite negação de serviço contra o dono | Aceito (ADR 0049) — ver crítica |

> **Por que 1 e 3 estão pendentes.** Ambos exigem uma migration nova, e
> `supabase/migrations/` é diretório protegido por
> `.claude/hooks/protect-files.sh`. A correção foi escrita e revisada, mas o
> dono do repositório optou por não incluí-la nesta mudança; ela está no
> [apêndice](#apêndice--correções-sql-propostas-não-aplicadas) para ser aplicada
> como migration `009` numa mudança própria.

---

## Achado 1 — Credencial revogada continua hidratando a sessão do Portal

**Severidade:** Média · **OWASP:** A07:2021 · **Evidência:** Código

`customer_portal_accounts.credentials_revoked_at` existe desde a migration 001,
e o `COMMENT` da própria coluna declara o contrato:

> `Instante da última revogação de credencial do Portal. Token com iat anterior é
> recusado por current_portal_customer_id().`

`current_portal_customer_id()` cumpre o contrato
(`002_business_logic_and_security.sql:5289`). **`portal_get_session_overview_v2()`
não** — checava apenas `active`. E é essa a RPC que o navegador chama para
decidir se existe sessão (`src/hooks/usePortalAuth.tsx:42`).

`portal_revoke_sessions(p_user_id)` (`002:13643`) apaga sessões e refresh tokens
e carimba `credentials_revoked_at = now()`. Ele apaga o *refresh* token; o
*access* token já emitido continua válido até `jwt_expiry` (3600 s, ver
`supabase/config.toml`). É chamado por `portal-password-reset`,
`portal-account-suspend` e `portal-recovery-email-change`.

### Prova de conceito (conceitual)

1. Atacante detém um access token do Portal do Cliente A (roubado de um
   dispositivo compartilhado, de um log, ou simplesmente um funcionário
   desligado cuja senha acabou de ser trocada).
2. O Cliente A troca a senha. `portal-password-reset` revoga as sessões.
3. Por até 1 hora, `POST /rest/v1/rpc/portal_get_session_overview_v2` com o token
   antigo ainda responde **200**, devolvendo razão social, CNPJ,
   `pending_balance`, `contact_email` e `login_cnpj`.
4. O Portal renderiza como autenticado. Cada chamada de dado subsequente
   (faturas, operação, Demurrage) falha, porque todas passam por
   `current_portal_customer_id()`.
5. Efeito colateral: o `UPDATE ... SET last_login_at = now()` roda mesmo assim,
   registrando como login um acesso posterior à revogação — corrompendo o sinal
   que o console de provisionamento usa.

**Impacto real:** não há leitura cruzada entre Clientes; o token só alcança o
próprio Cliente. O que se perde é a *revogação*: um dado cadastral e financeiro
resumido continua legível por até uma hora depois de a empresa acreditar ter
cortado o acesso, e a trilha de auditoria registra um login que não deveria
existir.

### Correção proposta (não aplicada)

A mesma checagem de `current_portal_customer_id()`, com a mesma folga de 5 s
para desalinhamento de relógio, aplicada **antes** do `UPDATE last_login_at`.
SQL completo no [apêndice](#1--portal_get_session_overview_v2).

---

## Achado 2 — Provisionamento do admin de Preview sem guarda de ambiente

**Severidade:** Média · **OWASP:** A05:2021 · **Evidência:** Código

`scripts/provision-preview-admin.mjs` cria (ou repara) o usuário
`qa-admin@example.test` com `email_confirm: true` e faz upsert de
`user_profiles` com `role = 'admin'`, `active = true`. A senha vem do secret
`PREVIEW_ADMIN_PASSWORD` e é **fixa entre execuções** — é um fixture de QA.

Nada no script exigia que o alvo fosse uma Preview Branch. Ele usava
`SUPABASE_URL` como viesse do ambiente. Essa URL é produzida pelo step anterior
do workflow:

```
supabase --experimental branches get "$PR_HEAD_REF" \
  --project-ref "$SUPABASE_PROJECT_REF" -o env | node scripts/load-branch-env.mjs
```

`load-branch-env.mjs` despeja o resultado em `$GITHUB_ENV` sem inspecionar para
onde a URL aponta. O branching do Supabase expõe o projeto de produção como
branch persistente; um `PR_HEAD_REF` que resolva para ela — ou um
`SUPABASE_PROJECT_REF` mal configurado — provisiona uma conta administrativa de
credencial conhecida **em produção**, silenciosamente e a cada PR.

O `role = 'admin'` é o de maior alcance do sistema: `is_admin()` (`002:9701`) o
aceita, e a policy `user_profiles_update` permite a um admin alterar `role` de
qualquer perfil.

### Prova de conceito (conceitual)

Não requer atacante externo — é uma falha de configuração que se materializa
sozinha. Um `SUPABASE_PROJECT_REF` apontado para o projeto errado, ou uma branch
Supabase ausente que faça o CLI devolver as credenciais do projeto pai, basta.
A partir daí, qualquer pessoa com acesso ao secret (ou que o descubra) entra em
produção como administrador.

**Nota:** o fixture `PreviewAdmin2026!` que aparece em
`src/services/__tests__/previewAdminProvisioning.test.ts:7` é um valor de teste
com mocks, **não** a senha real — ela vive só como secret do GitHub Actions.
Ainda assim, se o secret real coincidir com esse literal, ele está publicado no
repositório. Vale conferir e rotacionar por precaução.

### Correção

`assertPreviewTarget(url, productionProjectRef)` recusa quando o host da URL
resolvida cita o ref de produção, e falha fechado se o ref não for informado. O
workflow passa o ref sob nome próprio (`PRODUCTION_SUPABASE_PROJECT_REF`) porque
uma chave `SUPABASE_PROJECT_REF` vinda do CLI sobrescreveria em `$GITHUB_ENV`
justamente a referência contra a qual se compara. A comparação é por rótulo de
host, não por `includes`, para não recusar um ref de branch que apenas contenha
o de produção como substring. Cinco testes cobrem os dois lados.

---

## Achado 3 — Autorização no fundo da cadeia, não na fronteira do `GRANT`

**Severidade:** Baixa (não explorável hoje) · **OWASP:** A01:2021 · **Evidência:** Código

Duas RPCs `SECURITY DEFINER` concedidas a `authenticated` — papel que a sessão
do Portal **também** carrega, já que Portal e app interno vivem no mesmo projeto
Supabase (`src/services/supabase.ts:27`) — faziam trabalho antes de delegar ao
núcleo guardado:

- `save_voyage_escala_terminal_state_v2` (`002:20014`) chega a
  `INSERT INTO public.ports` **antes** de qualquer checagem, e só então chama
  `save_voyage_escala_terminal_state`, que exige Operações/Admin;
- `import_bl_freight_transactional` (`002:7811`) faz um `SELECT` e um
  `set_config` antes de delegar a `..._legacy_357` → `..._legacy_322` →
  `..._legacy_205`, e é este último que valida
  `is_active_user()` e `p_changed_by = auth.uid()`.

**Isto não é explorável hoje.** Uma chamada RPC via PostgREST roda numa
transação; o `RAISE` do núcleo aborta tudo e a linha em `public.ports` é
desfeita pelo rollback. A auditoria verificou esse caminho antes de classificar.

O problema é estrutural: a segurança depende do rollback, não da autorização.
Um único `EXCEPTION WHEN OTHERS` adicionado em manutenção futura, uma
subtransação, ou uma reordenação da delegação converte isso em escrita
persistente alcançável por qualquer sessão autenticada — inclusive a de um
Cliente do Portal. Todo o resto do schema segue o princípio oposto: a checagem
mora na função concedida.

### Correção proposta (não aplicada)

A guarda passa a valer no ponto de entrada concedido. As guardas propostas são
idênticas às que os núcleos já aplicam, apenas antecipadas — nenhum chamador
legítimo muda de comportamento. Receita no
[apêndice](#2--guardas-no-ponto-de-entrada).

---

## Achado 4 — Ausência de `Strict-Transport-Security`

**Severidade:** Baixa · **OWASP:** A05:2021 · **Evidência:** Código

`vercel.json` já traz CSP restritiva, `X-Frame-Options: DENY`,
`X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy`, mas nenhum
HSTS. Sem ele, o primeiro acesso em rede hostil pode ser rebaixado para HTTP.

**Corrigido** com `max-age=31536000; includeSubDomains`. `preload`
deliberadamente **não** foi incluído: é um compromisso praticamente irreversível
sobre o apex e todos os subdomínios, e essa é uma decisão do dono do domínio,
não de uma auditoria.

---

## Aceito / não corrigido

### Achado 5 — Bloqueio de login por CNPJ é uma negação de serviço contra o dono

**Severidade:** Baixa · **OWASP:** A04:2021 · **Evidência:** Código

A ADR [0049](../../adr/0049-rate-limit-do-portal-chaveado-somente-por-cnpj.md)
documenta e **aceita** explicitamente: o CNPJ é público, cinco senhas erradas
trancam o dono por 15 minutos, e repetir a cada janela o mantém fora
indefinidamente. A ADR rejeita a chave por IP porque um escritório contábil
opera vários CNPJs do mesmo endereço, e contar por IP faria um cliente bloquear
outro.

**Crítica honesta ao raciocínio da ADR:** o argumento está correto contra IP
como chave *substituta*, mas a ADR trata a alternativa como binária e não
considera IP como dimensão *aditiva*. Bloquear apenas quando o balde do CNPJ
**e** o balde do IP estiverem quentes preserva integralmente o caso do escritório
compartilhado (aquele IP é legítimo e não estoura sozinho contra dezenas de
CNPJs distintos) e remove o bloqueio gratuito de um terceiro isolado. Um
desafio (captcha/turnstile) após N falhas tem o mesmo efeito sem trancar
ninguém, e `[auth.captcha]` já está previsto na configuração do Supabase.

Não foi corrigido nesta mudança: reverter uma decisão registrada em ADR exige
uma ADR nova e é chamada do dono do produto, não da auditoria. Recomendo
reabrir a 0049 com a dimensão aditiva sobre a mesa.

### TOCTOU teórico em `_apply_customer_contact_configuration`

**Severidade:** Informativa · **Evidência:** Código

O laço de validação (`008:596`) confirma que todo contato do payload pertence a
`p_customer_id`; a fase de aplicação (`008:764`) faz
`UPDATE public.customer_contacts ... WHERE id = v_item_id` sem reescopar por
`customer_id`. O `FOR UPDATE` pessimista trava a linha do **cliente**, não a dos
contatos.

**Não corrigido, deliberadamente.** Uma varredura do repositório confirma que
`customer_contacts.customer_id` **nunca é reatribuído** por nenhum caminho —
não há `UPDATE ... SET customer_id`. A janela é, portanto, inalcançável, e
reemitir uma função de ~300 linhas para fechá-la traz mais risco de transcrição
do que benefício. Se algum dia surgir um caminho de reatribuição de contato
entre Clientes, acrescentar `AND customer_id = p_customer_id` ao `UPDATE` e
escopar o `DELETE` de `customer_contact_box_links` passa a ser obrigatório.

### `portal_ship_schedule` concedida a `anon`

**Severidade:** Informativa · **Evidência:** Código

É a única função com `GRANT ... TO anon` (`002:29273`), e a ADR 0045 a nomeia
como exceção deliberada ("permanece leitura direta porque não é escopada por
Cliente"). Devolve navio, viagem, IMO, portos e datas de viagens com
`show_on_portal AND status = 'active'` — nenhum dado de Cliente. Quem tiver a
chave anon (que é pública por natureza) lê a programação. É uma escolha de
negócio consciente; registro apenas para que continue consciente.

---

## Superfície verificada e considerada correta

Vale registrar o que **não** é vulnerabilidade, para que a próxima auditoria não
refaça o caminho.

### Isolamento de tenants e RLS (vetor 1)

- **Nenhum IDOR.** O `customer_id` **nunca** chega do cliente. Toda RPC do Portal
  resolve a identidade por `current_portal_customer_id()`, que lê
  `customer_portal_accounts` por `auth.uid()`. O frontend só chama RPCs — a
  única escrita direta é upload ao Storage, e o bucket tem policy de prefixo por
  `customer_id`.
- As três RPCs que aceitam id de entidade (`portal_invoice_details`,
  `portal_get_demurrage_invoice_detail`, `portal_obsolete_consolidation`)
  filtram por `customer_id = <derivado da sessão>` na consulta que prova a posse,
  e erram com `P0002` quando não encontram.
- Os 11 núcleos `_portal_*_core` são parametrizados por `p_customer_id` e todos
  filtram por ele; os que aceitam id secundário só o usam depois de a posse
  estar provada.
- Os invólucros `portal_inspect_*` (Modo Inspeção interno) passam **todos** por
  `_portal_inspect_guard`, que exige usuário interno ativo.
- **110 de 110 tabelas** com RLS habilitado; **273 policies**, nenhuma com
  `USING (true)` ou `WITH CHECK (true)`, nenhuma concedida a `anon`.
- **Zero views** no schema — não existe a superfície clássica de view sem
  `security_invoker` furando RLS.
- Só três policies são alcançáveis por sessão de Portal
  (`demurrage_disputes`, `demurrage_dispute_messages`,
  `demurrage_dispute_attachments`), todas com predicado
  `customer_id = current_portal_customer_id()`.

### Edge Functions e webhooks (vetor 2)

- **`portal-email-webhook`:** assinatura Svix verificada com tolerância de 300 s,
  antes de qualquer efeito. Falha **fechado** — a construção do `Webhook` está
  dentro do `try`, então secret ausente devolve 401 em vez de aceitar. Deduplica
  por `svix-id` com índice único. Injeção forjada de bounce/complaint não passa.
- **`send-customer-communication`:** exige Bearer, checa papel
  (`administrativo`/`documentacao`/`equipamentos`) ou o secret de automação em
  comparação de tempo constante; valida que o destinatário **pertence ao Cliente**
  (`customer_contacts` por `customer_id`) antes de enviar, e consulta as duas
  listas de supressão.
- **`demurrage-dunning`, `alerts-detector`, `portal-daily-digest`,
  `customer-communication-auto-runner`, `recalc-demurrage-ptax`:** todas exigem
  segredo de cron em `timingSafeEqual`, e todas falham fechado se o segredo não
  estiver configurado.
- **`admin-users`:** `verify_jwt` padrão (true) mais `is_admin()`.
  `portal-invite-send` e `portal-account-suspend` checam
  `portal_current_role()`, que devolve `NULL` para sessão de Portal — e as
  comparações são NULL-safe.
- CORS por allowlist explícita, com ausência de header (não a string `null`) para
  origem não permitida.

### Funções `SECURITY DEFINER` (vetor 3)

- 417 funções mapeadas, **355 `SECURITY DEFINER`**, das quais 173 concedidas a
  `authenticated`/`anon`.
- **Todas as 355 fixam `SET search_path`.** Zero exceções — nenhuma superfície de
  sequestro de `search_path`.
- `EXECUTE` negado por padrão (`ALTER DEFAULT PRIVILEGES ... REVOKE` em 001 e
  006), com 407 `REVOKE ... FROM PUBLIC` explícitos.
- Análise transitiva da cadeia de chamadas: apenas `portal_ship_schedule` chega
  ao fim sem guarda, e é a exceção documentada. Os achados 3 acima são de
  *posição* da guarda, não de ausência.
- **Todas as 23 funções `*_legacy*` estão sem grant** para `authenticated`/`anon`
  — não há função-sombra antiga reexposta com regra mais frouxa. Verificado
  individualmente, incluindo `portal_list_provisioning_events_legacy`, cuja
  versão viva exclui corretamente o papel `operacoes`.
- Escalada de privilégio interna barrada em dois níveis: a policy
  `user_profiles_update` permite auto-edição, e o trigger
  `prevent_user_profile_privilege_escalation` recusa mudança de `role`/`active`
  por quem não é admin.

### Segredos (vetor 4)

- Nenhuma chave `service_role`, JWT, chave Resend ou credencial no frontend, no
  bundle ou no repositório. Varredura por padrões (`eyJ*.*`, `sb_secret_`,
  `sbp_`, `re_`, `SG.`) sem achado.
- `.env` fora do versionamento; só `.env.example` com placeholders.
- Segredos dos jobs `pg_cron` migrados para o Supabase Vault (ADR 0063,
  migration 007), com o comando do job citando apenas **nomes**, schema `ops`
  sem `USAGE` para `anon`/`authenticated`, e verificação executável que aborta
  se algum job voltar a exibir literal.
- `qa-admin@example.test` fica confinado à Preview: a senha só existe como secret
  do Actions, o workflow usa `workflow_run` com checkout da branch padrão (não
  executa código da PR com secrets), e PRs de fork são ignoradas. A lacuna era a
  ausência de guarda de destino — achado 2.

## Apêndice — correções SQL propostas (não aplicadas)

Devem entrar como `supabase/migrations/009_portal_revocation_and_entrypoint_guards.sql`,
seguindo o red-green do playbook de migrations: teste de contrato primeiro,
depois aplicação real.

**Aplicar não é salto no escuro.** O job `Migration replay (Postgres real)` do
`ci.yml` reexecuta *todas* as migrations do zero contra um PostgreSQL 16 real
(`scripts/setup-local-pg.sh --reset`), roda `scripts/check-squash-replay.sql` e
depois aplica `supabase/seed.sql`. Uma 009 sintaticamente inválida, com corpo de
função quebrado ou com o `DO $verify_009$` reprovando, derruba o gate da PR
imediatamente — sem depender de Preview Branch. A Preview continua sendo onde se
prova o *comportamento* (recusa por `iat`, guarda por papel) com sessão real;
o CI prova que o schema aplica.

### 1 — `portal_get_session_overview_v2`

Corpo idêntico ao da 002, com o bloco de revogação inserido **antes** do
`UPDATE ... last_login_at` (um token recusado não pode deixar rastro de login),
e `credentials_revoked_at` acrescentado ao `SELECT ... INTO v_account`:

```sql
-- declarar junto de v_account/v_customer:
--   v_issued_at TIMESTAMPTZ;
-- e acrescentar a coluna ao SELECT que carrega v_account:
--   SELECT a.id, a.customer_id, a.active, a.contact_email, a.login_cnpj,
--          a.credentials_revoked_at INTO v_account ...

IF v_account.credentials_revoked_at IS NOT NULL THEN
  v_issued_at := to_timestamp(NULLIF(auth.jwt() ->> 'iat', '')::double precision);
  IF v_issued_at IS NOT NULL
     AND v_issued_at < v_account.credentials_revoked_at - interval '5 seconds' THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;
END IF;
```

A folga de 5 s e a forma do teste são copiadas de `current_portal_customer_id()`
(`002:5289`) de propósito: duas implementações divergentes da mesma regra são o
que produziu este achado.

### 2 — Guardas no ponto de entrada

Reemitir as duas funções com `CREATE OR REPLACE`, corpo **byte a byte** igual ao
da 002 (extrair do arquivo, não transcrever à mão), inserindo a guarda logo após
o `BEGIN` de topo:

```sql
-- save_voyage_escala_terminal_state_v2: antes do INSERT INTO public.ports.
-- O núcleo save_voyage_escala_terminal_state segue dono da regra de papel
-- (Operações/Admin); aqui recusa-se quem não é usuário interno ativo --
-- inclusive a sessão do Portal, que também carrega o papel `authenticated`.
IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
  RAISE EXCEPTION 'Usuario sem permissao ativa para editar Atracacoes da escala.'
    USING ERRCODE = '42501';
END IF;

-- import_bl_freight_transactional: idêntica à guarda que
-- import_bl_freight_transactional_legacy_205 já aplica, apenas antecipada.
IF auth.uid() IS NULL OR NOT public.is_active_user()
   OR p_changed_by IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Usuario sem permissao ativa para importar B/L.'
    USING ERRCODE = '42501';
END IF;
```

Reafirmar o ACL na mesma migration (a 006 exige grant explícito), sem ampliar
nada além do que a 002 já concedia:

```sql
REVOKE ALL ON FUNCTION public.portal_get_session_overview_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_get_session_overview_v2() TO authenticated;
-- idem para as duas funções acima, com as assinaturas completas.
```

### 3 — Verificação executável sugerida

Não há como assumir a identidade de outro papel de dentro da migration; o que dá
para afirmar no catálogo é que as três funções seguem `SECURITY DEFINER`, com
`search_path` fixado, e sem `EXECUTE` para `anon`:

```sql
DO $verify_009$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('portal_get_session_overview_v2',
                      'save_voyage_escala_terminal_state_v2',
                      'import_bl_freight_transactional')
    AND (NOT p.prosecdef
         OR p.proconfig IS NULL
         OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
         OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '009: funcao fora do contrato: %', v_bad;
  END IF;
END;
$verify_009$;
```

## Testes e validação

- `src/services/__tests__/previewAdminProvisioning.test.ts` — 7 testes,
  **passando** (5 novos, cobrindo o guard de ambiente nos dois sentidos:
  recusa produção, aceita branch, não confunde substring, falha fechado sem ref,
  rejeita URL malformada).
- `npm run docs:check`, `npm run lint`, `npm test` e `npm run build` —
  ver a seção de verificação da PR.
- **Não executado:** qualquer validação contra banco real. Não há projeto
  Supabase alcançável nesta sessão, então **não há evidência Runtime** para
  nenhuma afirmação deste relatório. Todo o achado é leitura estática.
- O apêndice SQL **não foi aplicado nem testado**. Antes de virar migration
  precisa de teste de contrato próprio; a aplicação em si é coberta pelo job
  `Migration replay (Postgres real)` do CI, e o comportamento (recusa por `iat`,
  guarda por papel) por uma Preview Branch.

## Notas e divergências

- A auditoria foi estática por necessidade, não por escolha. Um teste de
  penetração de verdade contra uma Preview — duas contas de Portal reais
  tentando alcançar dado uma da outra — provaria o isolamento de um jeito que
  leitura de código não prova. Recomendo isso como próximo passo.
- O achado 3 é o tipo de coisa que uma auditoria futura pode reclassificar como
  falso positivo se olhar só para o efeito atual. Ele está registrado como
  **não explorável hoje** de propósito: o valor da correção é impedir que uma
  manutenção futura o torne explorável sem que ninguém perceba.

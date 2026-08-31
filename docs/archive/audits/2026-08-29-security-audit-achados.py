"""Dados da auditoria de segurança do Transhipping Desk (2026-08-29).

Fonte única de verdade do relatório: `gerar_relatorio.py` lê este módulo e não
tem nenhum conteúdo próprio. Para atualizar o PDF depois de uma correção, edite
apenas os achados aqui e rode o gerador de novo.

Cada achado é um snapshot verificado contra o código na data acima. Os números
de linha referem-se ao estado do repositório no commit auditado.
"""

DATA_AUDITORIA = '29 de agosto de 2026'
PROJETO = 'Transhipping Desk'
COMMIT_ESCOPO = '29b1ca4c5cd19f17eed021f495a9a4288f070e73'

# --------------------------------------------------------------------------
# Paleta (definida no pedido da auditoria)
# --------------------------------------------------------------------------
CORES = {
    'critica': '#B91C1C',
    'alta': '#EA580C',
    'media': '#D97706',
    'baixa': '#2563EB',
    'informativa': '#64748B',
    'forte': '#059669',
}

ROTULO_SEVERIDADE = {
    'critica': 'CRÍTICA',
    'alta': 'ALTA',
    'media': 'MÉDIA',
    'baixa': 'BAIXA',
    'informativa': 'INFORMATIVA',
}

ORDEM_SEVERIDADE = ['critica', 'alta', 'media', 'baixa', 'informativa']

# --------------------------------------------------------------------------
# Stack detectada e como cada categoria foi mapeada
# --------------------------------------------------------------------------
STACK = [
    ('Linguagem', 'TypeScript 6 (strict) — 861 arquivos .ts/.tsx'),
    ('Frontend', 'React 19 + Vite 8 + React Router 7 + TanStack Query 5 + Tailwind 4'),
    ('Backend', 'Supabase — sem servidor de aplicação próprio'),
    ('Banco / ORM', 'PostgreSQL 17 via PostgREST; sem ORM. 359 migrations SQL no snapshot'),
    ('Camada de API', '13 Edge Functions Deno + 349 funções identificadas pelo replay estático'),
    ('Autenticação', 'Supabase Auth (JWT). Duas sessões no mesmo projeto: usuário interno e cliente do Portal'),
    ('Autorização', 'RLS + GRANT/REVOKE + guardas dentro de funções SECURITY DEFINER'),
    ('Deploy', 'Vercel (produção) + Firebase Hosting (rollback) + GitHub Actions (CI)'),
]

NOTA_METODOLOGICA = [
    (
        'Como o isolamento foi mapeado',
        'O projeto não tem tenant_id nem middleware de tenant: é um sistema operacional interno '
        'com um Portal do Cliente acoplado. O isolamento tem duas fronteiras distintas. A primeira '
        'é <b>interno × cliente</b>: os dois recebem o MESMO role <font face="Courier">authenticated</font> '
        'do Supabase Auth, então o role não separa nada — quem separa é o perfil, via '
        '<font face="Courier">is_active_read_user()</font> (exige linha ativa em '
        '<font face="Courier">user_profiles</font>) e <font face="Courier">current_portal_customer_id()</font> '
        '(resolve a conta em <font face="Courier">customer_portal_accounts</font>). A segunda é '
        '<b>cliente × cliente</b>, aplicada por RLS e pelo escopo dentro de cada RPC do Portal. '
        'A auditoria tratou como falha de isolamento todo objeto que confia apenas em "estar autenticado".'
    ),
    (
        'Cobertura da varredura',
        'As 359 migrations foram reproduzidas em ordem por um script de replay que resolve o estado '
        '<b>final</b> de cada policy e de cada GRANT — inclusive os criados dentro de blocos '
        '<font face="Courier">DO $$ ... FOREACH ... $$</font>, que uma leitura por grep não enxerga. '
        'Sobre esse estado final foram cruzadas 92 tabelas × RLS, 282 policies vivas e 349 funções identificadas × '
        'grants × guardas, com resolução recursiva de cadeias de delegação (uma função sem guarda '
        'própria que delega a uma função guardada não é achado). As 13 Edge Functions e seus helpers '
        'foram lidos integralmente, não amostrados.'
    ),
    (
        'Critério de achado',
        'Só entrou no relatório o que foi confirmado no código com arquivo e linha. Hipóteses não '
        'confirmadas foram descartadas em vez de reportadas como vulnerabilidade. Resultados estáticos '
        'são evidência de Código/Teste; ausência de Runtime não prova ausência de risco. Onde a categoria não '
        'produziu achado, isso é dito explicitamente e acompanhado da evidência que sustenta a '
        'conclusão — a ausência de achado é um resultado da auditoria, não uma lacuna dela.'
    ),
]

CATEGORIAS = [
    ('cat1', '1. Banco sem tranca (isolamento de inquilino/dono)',
     'Em Supabase, o mecanismo é RLS + guardas em funções SECURITY DEFINER. Uma função '
     'SECURITY DEFINER ignora RLS por definição: se ela for concedida a '
     '<font face="Courier">authenticated</font> e não tiver guarda própria, é leitura livre '
     'para o cliente do Portal.'),
    ('cat2', '2. Permissão definida no navegador',
     'Cruzamento de cada gate de papel do frontend (<font face="Courier">roleHasPermission</font>, '
     '<font face="Courier">ProtectedRoute adminOnly</font>, <font face="Courier">can()</font>) com o '
     'endpoint correspondente (Edge Function ou RPC).'),
    ('cat3', '3. IDOR',
     'Toda RPC e toda Edge Function que recebe um identificador de objeto por path, query ou body, '
     'verificando se o objeto é confrontado com o dono/tenant do chamador.'),
    ('cat4', '4. Chaves expostas (hardcode)',
     'Código-fonte, configs, <font face="Courier">supabase/config.toml</font>, '
     '<font face="Courier">vercel.json</font>, <font face="Courier">firebase.json</font>, CI, '
     'scripts, documentação, defaults de variável de ambiente e o histórico git.'),
    ('cat5', '5. Inputs sem tratamento (XSS)',
     'Frontend: <font face="Courier">dangerouslySetInnerHTML</font>, '
     '<font face="Courier">innerHTML</font>, <font face="Courier">eval</font>, '
     '<font face="Courier">href</font>/<font face="Courier">src</font> controlados por usuário. '
     'Backend: input de usuário em HTML de e-mail e em respostas.'),
]

# --------------------------------------------------------------------------
# Achados
# --------------------------------------------------------------------------
ACHADOS = [
    {
        'id': 1,
        'categoria': 'cat3',
        'severidade': 'alta',
        'titulo': 'portal_billing_gate expõe e-mail e identificadores de qualquer cliente por B/L arbitrário',
        'local': 'supabase/migrations/325_clientes_portal_disputes_alerts.sql:24-63 (definição) e :67 (grant)',
        'arquivos': ['supabase/migrations/325_clientes_portal_disputes_alerts.sql:24-67'],
        'trecho': """CREATE OR REPLACE FUNCTION public.portal_billing_gate(p_bl_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
...
  SELECT customer_id INTO v_customer_id FROM public.bls WHERE id = p_bl_id;
...
  RETURN jsonb_build_object(
    'allowed', v_reason IS NULL,
    'reason', v_reason,
    'customer_id', v_customer_id,
    'account_id', v_account.id,
    'recovery_email', v_email          -- <== e-mail real do cliente
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_billing_gate(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_billing_gate(TEXT) TO authenticated, service_role;""",
        'porque': (
            'A função é <b>SECURITY DEFINER</b> — portanto ignora a RLS de '
            '<font face="Courier">bls</font> e de <font face="Courier">customer_portal_accounts</font> — '
            'está concedida a <font face="Courier">authenticated</font> e <b>não tem nenhuma guarda no corpo</b>: '
            'não chama <font face="Courier">is_active_read_user()</font>, não chama '
            '<font face="Courier">current_portal_customer_id()</font>, e não confronta o '
            '<font face="Courier">customer_id</font> do B/L com o do chamador. O único parâmetro é o '
            'ID do B/L, escolhido livremente por quem chama.<br/><br/>'
            'O cliente do Portal recebe exatamente o mesmo role <font face="Courier">authenticated</font> '
            'que o operador interno (ADR 0013 e migration 257), e o PostgREST publica toda função '
            'concedida a esse role. Um cliente autenticado no Portal chama, direto por HTTP, '
            '<font face="Courier">POST /rest/v1/rpc/portal_billing_gate</font> com o ID de um B/L que não é dele '
            'e recebe de volta o <font face="Courier">customer_id</font>, o <font face="Courier">account_id</font> '
            'e o <b>e-mail de recuperação</b> do cliente dono daquele B/L. O ID do B/L é textual e '
            'sequencial no formato usado pelo próprio projeto (<font face="Courier">CSC000000001</font>, '
            '<font face="Courier">CSC000000002</font> em <font face="Courier">.env.example</font>), o que torna a '
            'enumeração trivial: um laço sobre a faixa devolve o cadastro de contato de toda a carteira.'
        ),
        'impacto': (
            'Vazamento cross-tenant de PII (e-mail de contato) e do mapa cliente↔B/L de toda a operação. '
            'O e-mail de recuperação é justamente o endereço que recebe os links de recuperação de senha '
            'do Portal, o que transforma o vazamento em insumo direto para phishing dirigido contra a '
            'conta correspondente.'
        ),
        'exploracao': (
            'Nenhuma condição especial. Basta uma conta de Portal ativa (ou qualquer sessão interna). '
            'Não depende de feature flag nem de configuração insegura.'
        ),
        'correcao': (
            'A função só tem consumidor interno (o gate de faturamento). Revogue o acesso do papel '
            'compartilhado e mantenha apenas <font face="Courier">service_role</font>, como as migrations 257 e 296 '
            'já fizeram com <font face="Courier">bl_has_portal_release</font> e '
            '<font face="Courier">check_provision_rate_limit</font>:<br/>'
            '<font face="Courier">REVOKE ALL ON FUNCTION public.portal_billing_gate(TEXT) FROM PUBLIC, anon, authenticated;</font><br/>'
            'Se algum chamador interno precisar dela com sessão de usuário, adicione no início do corpo '
            'a guarda padrão do projeto: <font face="Courier">IF NOT public.is_active_read_user() THEN RAISE '
            "EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;</font>"
        ),
        'aceite': [
            'portal_billing_gate não aparece mais com EXECUTE para authenticated em pg_proc/ACL.',
            'Uma sessão de cliente do Portal recebe 42501 (ou 404 do PostgREST) ao chamar a RPC.',
            'O fluxo interno de emissão de fatura que usa o gate continua passando nos testes.',
            'Um teste de regressão cobre a chamada negada a partir de sessão do Portal.',
        ],
    },
    {
        'id': 2,
        'categoria': 'cat3',
        'severidade': 'media',
        'titulo': 'refresh_voyage_status_from_terminal_scales altera o status de qualquer viagem sem verificação de privilégio',
        'local': 'supabase/migrations/342_atracacao_alertas.sql:7-44 (definição) e :47 (grant)',
        'arquivos': ['supabase/migrations/342_atracacao_alertas.sql:7-47'],
        'trecho': """CREATE OR REPLACE FUNCTION public.refresh_voyage_status_from_terminal_scales(p_voyage_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
...
BEGIN
  -- nenhuma verificação de identidade ou de papel
...
  IF v_active_scales > 0 THEN
    UPDATE public.voyages
    SET status = CASE WHEN v_pending_scales = 0 THEN 'completed' ELSE 'active' END
    WHERE id = p_voyage_id AND status <> 'cancelled';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_voyage_status_from_terminal_scales(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_voyage_status_from_terminal_scales(BIGINT) TO authenticated, service_role;""",
        'porque': (
            'É uma função de <b>escrita</b>, SECURITY DEFINER (portanto acima da RLS de '
            '<font face="Courier">voyages</font>), concedida a <font face="Courier">authenticated</font>, '
            'que recebe o <font face="Courier">voyage_id</font> como único parâmetro e não verifica nem quem '
            'chama nem se o chamador tem relação com aquela viagem. Ela é o reconciliador chamado por '
            'triggers e pelo detector agendado — mas o grant a <font face="Courier">authenticated</font> a torna '
            'também um endpoint público do PostgREST.<br/><br/>'
            'Qualquer sessão autenticada, inclusive a de um cliente do Portal, pode chamá-la em laço sobre '
            'IDs de viagem (inteiros sequenciais) e forçar a transição de '
            '<font face="Courier">status</font> para <font face="Courier">completed</font> ou '
            '<font face="Courier">active</font>. Vale notar que a escrita não é arbitrária: o valor gravado é '
            'derivado do estado real das escalas, então o atacante não escolhe o status. O que ele obtém é '
            'a capacidade de <b>disparar a transição fora de hora</b> e de resolver, pelo mesmo caminho, os '
            'itens de alerta associados — em cima de qualquer viagem da operação.'
        ),
        'impacto': (
            'Integridade do estado operacional e da fila de alertas. Uma viagem marcada como '
            '<font face="Courier">completed</font> antes do tempo, ou um alerta operacional resolvido por um '
            'terceiro, corrompe o painel que a operação usa para decidir. Como a escrita não passa pelo '
            'caminho normal, ela também não deixa o rastro de autoria que os fluxos internos deixam.'
        ),
        'exploracao': (
            'Nenhuma condição especial; qualquer sessão autenticada. O efeito depende do estado das '
            'escalas da viagem alvo, então nem toda chamada produz mudança.'
        ),
        'correcao': (
            'Manter o grant apenas para <font face="Courier">service_role</font> (o detector agendado) ou, se '
            'houver chamador interno com sessão de usuário, adicionar a guarda que as funções irmãs da '
            'mesma família já usam — <font face="Courier">resolve_alert_item</font> valida e levanta 42501:<br/>'
            "<font face=\"Courier\">IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION "
            "'Sem permissão.' USING ERRCODE = '42501'; END IF;</font>"
        ),
        'aceite': [
            'A RPC recusa chamada de sessão do Portal e de usuário interno inativo.',
            'O detector agendado (pg_cron/service_role) continua reconciliando o status normalmente.',
            'Os triggers que chamam a função internamente continuam funcionando.',
            'Teste de regressão cobre a chamada negada.',
        ],
    },
    {
        'id': 3,
        'categoria': 'cat1',
        'severidade': 'media',
        'titulo': 'Leitura de programação de viagem sem guarda contorna o portão show_on_portal',
        'local': 'supabase/migrations/326_voyage_operation_alerts.sql:15-49 e :53-103',
        'arquivos': [
            'supabase/migrations/326_voyage_operation_alerts.sql:15-49',
            'supabase/migrations/326_voyage_operation_alerts.sql:53-103',
        ],
        'trecho': """-- 1. Helper: PODs elegíveis da viagem
CREATE OR REPLACE FUNCTION public.get_voyage_eligible_pods(p_voyage_id BIGINT)
RETURNS TABLE(pod TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH latest_states AS (
    SELECT DISTINCT ON (entity_id, field_name) entity_id, field_name, new_value
    FROM public.audit_logs                     -- <== RLS ignorada, sem guarda
    WHERE entity_type = 'voyage_pod_schedule'
      AND entity_id LIKE p_voyage_id || '::%'
...
$$;
REVOKE ALL ON FUNCTION public.get_voyage_eligible_pods(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_voyage_eligible_pods(BIGINT) TO authenticated, service_role;

-- 2. Helper: menor ETA brasileiro
CREATE OR REPLACE FUNCTION public.get_voyage_first_brazilian_eta(p_voyage_id BIGINT)
RETURNS DATE ... SECURITY DEFINER ...      -- idem: sem guarda
GRANT EXECUTE ON FUNCTION public.get_voyage_first_brazilian_eta(BIGINT) TO authenticated, service_role;""",
        'porque': (
            'As duas funções são SECURITY DEFINER sem guarda, concedidas a '
            '<font face="Courier">authenticated</font>, e leem <font face="Courier">audit_logs</font> — cuja RLS '
            'restringe a leitura a usuário interno ativo. Por serem DEFINER, essa RLS não se aplica.<br/><br/>'
            'O ponto que torna isso uma falha de isolamento, e não apenas uma inconsistência, é o portão '
            '<font face="Courier">voyages.show_on_portal</font> (migration 172), criado exatamente para decidir '
            'qual programação o cliente pode ver, e reforçado pela migration 257, que removeu as policies '
            '<font face="Courier">USING (true)</font> de <font face="Courier">vessel_schedules</font> por '
            'contornarem esse portão. Estas duas funções contornam o mesmo portão pelo outro lado: um '
            'cliente do Portal itera <font face="Courier">voyage_id</font> (inteiro sequencial) e obtém os '
            'portos de escala elegíveis e a data de ETA de <b>qualquer</b> viagem, inclusive das que a '
            'operação decidiu não publicar.'
        ),
        'impacto': (
            'Vazamento de programação comercial (rota e datas) que o portão de publicação existe para '
            'controlar. Para um cliente que é concorrente de outro embarcador na mesma rota, é informação '
            'de valor competitivo.'
        ),
        'exploracao': (
            'Qualquer sessão autenticada. O retorno é limitado a códigos de porto e datas — não expõe '
            'B/L, cliente nem valores.'
        ),
        'correcao': (
            'São helpers de detector: o consumidor natural é <font face="Courier">service_role</font>. Revogue '
            '<font face="Courier">authenticated</font> das duas. Se a UI interna precisar delas, adicione '
            '<font face="Courier">WHERE public.is_active_read_user()</font> no corpo SQL — o mesmo padrão que a '
            'migration 257 aplicou em <font face="Courier">list_billing_runs</font>.'
        ),
        'aceite': [
            'As duas funções não têm mais EXECUTE para authenticated, ou passaram a exigir is_active_read_user().',
            'Sessão de cliente do Portal não consegue mais obter POD/ETA de viagem não publicada.',
            'run_alert_detectors() e os reconciliadores continuam funcionando.',
        ],
    },
    {
        'id': 4,
        'categoria': 'cat1',
        'severidade': 'media',
        'titulo': 'portal_check_auth_method: oráculo de enumeração de clientes e vazamento de portal_email (código morto ainda publicado)',
        'local': 'supabase/migrations/053_security_hardening.sql:16-49',
        'arquivos': ['supabase/migrations/053_security_hardening.sql:16-49'],
        'trecho': """CREATE OR REPLACE FUNCTION public.portal_check_auth_method(p_cnpj_cpf TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT a.auth_user_id, a.portal_email, a.active INTO v_account
  FROM public.customer_portal_accounts AS a
  JOIN public.customers AS c ON c.id = a.customer_id
  WHERE c.cnpj_cpf = p_cnpj_cpf;          -- <== CNPJ arbitrário, dado público

  IF NOT FOUND OR NOT v_account.active THEN
    RETURN jsonb_build_object('method', 'none');
  END IF;
  IF v_account.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('method', 'supabase_auth',
                              'portal_email', v_account.portal_email);
  END IF;
  RETURN jsonb_build_object('method', 'legacy_token');
END;
$$;

REVOKE ALL ON FUNCTION public.portal_check_auth_method(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_check_auth_method(TEXT) TO anon, authenticated;""",
        'porque': (
            'A própria migration 053 nasceu para fechar a enumeração aqui: o cabeçalho diz "remover user '
            'enumeration (...) impedindo varredura de CNPJs de clientes via API anon". A correção unificou '
            'a resposta de CNPJ inexistente e conta inativa, e a migration 093 depois revogou '
            '<font face="Courier">anon</font> de todas as funções SECURITY DEFINER. <b>O grant a '
            '<font face="Courier">authenticated</font> nunca foi revogado</b>, e a unificação não cobre o '
            'terceiro desfecho: conta <b>ativa</b> devolve <font face="Courier">method: supabase_auth</font> '
            'mais o <font face="Courier">portal_email</font>.<br/><br/>'
            'O CNPJ é dado público (consultável na Receita Federal), então o parâmetro não é segredo. '
            'Qualquer sessão autenticada — inclusive um cliente do Portal — varre uma lista de CNPJs e '
            'aprende, para cada um, se a empresa tem conta ativa no Portal e qual o endereço registrado. '
            'A função é além disso <b>código morto</b>: a própria migration 093 registra que ela é "do fluxo '
            'de token legado e não tem mais nenhum call site no frontend", o que a auditoria confirmou — o '
            'frontend usa <font face="Courier">portal_get_session_overview_v2</font>.'
        ),
        'impacto': (
            'Enumeração da carteira de clientes com Portal ativo e coleta dos endereços associados. É o '
            'mesmo risco que a migration 053 tentou eliminar, sobrevivendo por um grant que ela não tocou. '
            'Superfície de ataque mantida por código sem consumidor.'
        ),
        'exploracao': (
            'Qualquer sessão autenticada. A migration 093 já fechou o caminho não autenticado '
            '(<font face="Courier">anon</font>), então o pré-requisito é ter uma conta — o que um cliente do '
            'Portal tem por definição.'
        ),
        'correcao': (
            'Revogar e, de preferência, remover. O fluxo de token legado inteiro '
            '(<font face="Courier">portal_check_auth_method</font>, '
            '<font face="Courier">portal_get_session_overview</font>, '
            '<font face="Courier">portal_list_pending_bls</font>, <font face="Courier">portal_logout</font>, '
            '<font face="Courier">resolve_customer_portal_session</font>) está sem chamador; a migration 296 já '
            'aplicou essa disciplina às funções <font face="Courier">*_legacy</font> e estas ficaram de fora '
            'só porque o nome não casa com o padrão.'
        ),
        'aceite': [
            'portal_check_auth_method não tem mais EXECUTE para authenticated.',
            'As demais RPCs do fluxo de token legado tiveram o ACL fechado no mesmo commit.',
            'Nenhum fluxo do Portal (login, recuperação, ativação) regride nos testes.',
            'docs/RASTREABILIDADE.md registra a retirada.',
        ],
    },
    {
        'id': 5,
        'categoria': 'cat4',
        'severidade': 'media',
        'titulo': 'Segredo de webhook e de cron caem para a chave service_role quando não configurados',
        'local': 'supabase/functions/notify-invoice-issued/index.ts:77-78 e supabase/functions/recalc-demurrage-ptax/index.ts:61-62',
        'arquivos': [
            'supabase/functions/notify-invoice-issued/index.ts:77-78',
            'supabase/functions/recalc-demurrage-ptax/index.ts:61-62',
        ],
        'trecho': """// supabase/functions/notify-invoice-issued/index.ts:77-78
const webhookSecret =
  Deno.env.get('NOTIFY_WEBHOOK_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// supabase/functions/recalc-demurrage-ptax/index.ts:61-62
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const cronSecret = Deno.env.get('RECALC_CRON_SECRET') ?? serviceRoleKey""",
        'porque': (
            'Não é um segredo escrito no código, e sim o padrão que o pedido da auditoria chama de '
            '<i>default que vira segredo real se não for sobrescrito</i> — com o agravante de que o default '
            'aqui é a credencial <b>mais privilegiada do projeto</b>. Se '
            '<font face="Courier">NOTIFY_WEBHOOK_SECRET</font> ou '
            '<font face="Courier">RECALC_CRON_SECRET</font> não estiver definida, a função passa a aceitar como '
            'bearer a <font face="Courier">SUPABASE_SERVICE_ROLE_KEY</font>. Para o webhook funcionar nesse '
            'estado, um operador tem de <b>colar a service_role key no campo de secret header</b> do Database '
            'Webhook e do agendador — e a partir daí ela viaja como bearer em cada disparo, fica gravada na '
            'configuração do painel e tende a aparecer em log de requisição.<br/><br/>'
            'Uma chave que só deveria existir dentro do runtime da função passa a circular como token de '
            'transporte. Não há nenhuma validação de inicialização que recuse essa configuração: o código '
            'não distingue "segredo dedicado ausente" de "segredo dedicado configurado", então a degradação '
            'é silenciosa. Note que isto <b>não</b> é um bypass de autenticação — quem não conhece nenhuma '
            'das duas chaves continua recebendo 401.'
        ),
        'impacto': (
            'Ampliação da superfície de exposição da credencial que ignora toda a RLS do projeto. O '
            'comprometimento dela é total: leitura e escrita irrestritas em todas as 92 tabelas.'
        ),
        'exploracao': (
            'Requer a configuração insegura (variável dedicada ausente) para se materializar. Não é '
            'explorável remotamente por si só; é uma falha de higiene de credencial que amplia o raio de '
            'outro incidente.'
        ),
        'correcao': (
            'Remover o fallback e falhar de forma observável, como '
            '<font face="Courier">_shared/portalEmail.ts:47</font> já faz com '
            '<font face="Courier">PORTAL_FROM_EMAIL</font>:<br/>'
            "<font face=\"Courier\">const webhookSecret = Deno.env.get('NOTIFY_WEBHOOK_SECRET')</font><br/>"
            "<font face=\"Courier\">if (!webhookSecret) return json(500, { error: 'Webhook não configurado.' })</font><br/>"
            'Depois, girar a service_role key se ela já tiver sido usada como secret header em produção.'
        ),
        'aceite': [
            'Nenhuma Edge Function usa SUPABASE_SERVICE_ROLE_KEY como fallback de segredo de webhook ou cron.',
            'Ausência da variável dedicada resulta em 500 explícito, não em aceitação silenciosa da service_role.',
            'A service_role key foi girada caso tenha sido configurada como secret header.',
            'docs/ARCHITECTURE.md lista as variáveis obrigatórias por função.',
        ],
    },
    {
        'id': 6,
        'categoria': 'cat4',
        'severidade': 'baixa',
        'titulo': 'portal-daily-digest compara o segredo com != em vez de comparação em tempo constante',
        'local': 'supabase/functions/portal-daily-digest/index.ts:7-9',
        'arquivos': ['supabase/functions/portal-daily-digest/index.ts:7-9'],
        'trecho': """const expectedSecret = Deno.env.get('PORTAL_DIGEST_SECRET')
const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\\s+/i, '')
if (!expectedSecret || providedSecret !== expectedSecret) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })""",
        'porque': (
            'É a única das quatro funções protegidas por bearer secret que compara com '
            '<font face="Courier">!==</font>. As outras três — '
            '<font face="Courier">alerts-detector:3-11</font>, '
            '<font face="Courier">notify-invoice-issued:58-66</font> e '
            '<font face="Courier">recalc-demurrage-ptax:26-34</font> — implementam '
            '<font face="Courier">timingSafeEqual</font>, e a de notify-invoice-issued até documenta o motivo '
            'em comentário. A comparação de strings do JavaScript sai no primeiro byte diferente, o que em '
            'tese permite recuperar o segredo byte a byte pela variação do tempo de resposta.<br/><br/>'
            'Na prática a exploração é pouco realista: o ruído de rede e o cold start do Edge Runtime '
            'dominam a diferença de nanossegundos. O achado é registrado como <b>inconsistência de padrão</b>: '
            'a defesa foi adotada como convenção no projeto e este ponto ficou de fora.'
        ),
        'impacto': (
            'Baixo. Recuperação teórica do PORTAL_DIGEST_SECRET, que dispara o envio do resumo diário aos '
            'usuários internos.'
        ),
        'exploracao': (
            'Exige medição de tempo através da rede contra ruído alto. Não demonstrada.'
        ),
        'correcao': (
            'Extrair o <font face="Courier">timingSafeEqual</font> já duplicado em três funções para '
            '<font face="Courier">_shared/</font> e usá-lo nas quatro — resolve o achado e remove a '
            'triplicação no mesmo movimento.'
        ),
        'aceite': [
            'As quatro Edge Functions com bearer secret usam a mesma comparação em tempo constante.',
            'A implementação vive em supabase/functions/_shared/ e não está mais duplicada.',
        ],
    },
    {
        'id': 7,
        'categoria': 'cat4',
        'severidade': 'baixa',
        'titulo': 'Segredos fixos em scripts do ambiente local de auditoria de design',
        'local': 'scripts/design-audit/sb-shim.cjs:18 e scripts/design-audit/win/local-stack.ps1:32,128',
        'arquivos': [
            'scripts/design-audit/sb-shim.cjs:18',
            'scripts/design-audit/win/local-stack.ps1:32',
            'scripts/design-audit/win/local-stack.ps1:128',
        ],
        'trecho': """// scripts/design-audit/sb-shim.cjs:1-2 e :18
// Minimal local Supabase emulator (PostgREST subset + GoTrue password auth)
// for UI auditing against a local Postgres. Not for production use.
const JWT_SECRET = 'local-audit-jwt-secret-local-audit-jwt-secret-32'

# scripts/design-audit/win/local-stack.ps1:32
$env:PGPASSWORD = "postgres\"""",
        'porque': (
            'São credenciais fixas de um emulador local do Supabase usado pela skill de auditoria de '
            'design. O próprio arquivo se declara "Not for production use" na segunda linha, o shim escuta '
            'em <font face="Courier">127.0.0.1:54321</font> e nada em <font face="Courier">vercel.json</font>, '
            'em <font face="Courier">firebase.json</font> ou no workflow de CI o executa ou o publica.<br/><br/>'
            'O registro é higiene, não vulnerabilidade explorável: um segredo de assinatura de JWT literal '
            'no repositório é exatamente o padrão que uma varredura automatizada de segredos aponta, e '
            'convém que o motivo de ele ser inofensivo esteja escrito em vez de precisar ser redescoberto '
            'a cada auditoria.'
        ),
        'impacto': (
            'Nenhum em produção. O risco real é de contágio: alguém reaproveitar o shim ou o script fora '
            'do contexto local.'
        ),
        'exploracao': (
            'Não explorável remotamente. Exige que o shim seja executado e exposto fora de localhost — o '
            'que nenhum caminho do projeto faz.'
        ),
        'correcao': (
            'Ler as duas credenciais de variável de ambiente com default apenas quando '
            '<font face="Courier">NODE_ENV !== \'production\'</font>, e recusar a inicialização fora de '
            'localhost. Alternativamente, manter como está e registrar a exceção no arquivo de configuração '
            'da varredura de segredos, para que o achado não volte a cada execução.'
        ),
        'aceite': [
            'O shim recusa iniciar se o host de bind não for loopback.',
            'JWT_SECRET e PGPASSWORD vêm do ambiente, com default só fora de produção.',
            'Ou: a exceção está registrada na configuração da varredura de segredos, com justificativa.',
        ],
    },
    {
        'id': 8,
        'categoria': 'cat5',
        'severidade': 'informativa',
        'titulo': 'innerHTML reinjetado em document.write no fluxo de impressão (sink latente, não explorável hoje)',
        'local': 'src/lib/printDocument.ts:8 e src/pages/Demurrage.tsx:157',
        'arquivos': [
            'src/lib/printDocument.ts:1-11',
            'src/pages/Demurrage.tsx:149-162',
        ],
        'trecho': """// src/lib/printDocument.ts:1-8
export function printDocumentElement(element: HTMLElement, title: string) {
  const printWindow = window.open('', '_blank', 'width=900,height=1100')
  ...
  printWindow.document.write(`<!doctype html><html><head><title>${title}</title>
    ...<div class="invoice-print-content">${element.innerHTML}</div></body></html>`)

// src/pages/Demurrage.tsx:157 — mesma construção, título literal
printWindow.document.write(`...<title>Fatura de Demurrage</title>...
  <div class="invoice-print-content">${content.innerHTML}</div>...`)""",
        'porque': (
            'Registrado como informativo porque <b>não é explorável no estado atual</b>, e a auditoria '
            'confirmou as três condições que sustentam isso: (a) não existe nenhum '
            '<font face="Courier">dangerouslySetInnerHTML</font> no repositório, então o '
            '<font face="Courier">innerHTML</font> lido é DOM que o React renderizou e já escapou; '
            '(b) o <font face="Courier">title</font> interpolado sem escape em '
            '<font face="Courier">printDocument.ts:8</font> não chega a ser um vetor porque a função <b>não tem '
            'nenhum chamador</b> — é código morto; (c) em '
            '<font face="Courier">Demurrage.tsx:157</font>, que é o caminho vivo, o título é uma string '
            'literal.<br/><br/>'
            'O que se registra é a fragilidade da construção. A janela aberta por '
            '<font face="Courier">window.open(\'\')</font> é <b>same-origin</b>: se um dia alguém introduzir um '
            '<font face="Courier">dangerouslySetInnerHTML</font> na árvore do documento de impressão, ou passar '
            'um título vindo do usuário para a função morta, o XSS resultante roda no mesmo contexto da '
            'aplicação, com acesso ao token da sessão no storage. O projeto não tem biblioteca de '
            'sanitização instalada, então não existe rede de segurança para esse caso.'
        ),
        'impacto': (
            'Nenhum hoje. O valor do registro é impedir que a construção se torne o vetor de uma mudança '
            'futura aparentemente inócua.'
        ),
        'exploracao': (
            'Não explorável no código atual. Depende da introdução de um sink de HTML bruto na árvore '
            'impressa ou de um chamador que passe título controlado pelo usuário.'
        ),
        'correcao': (
            'Manter o chamador vivo e construir a janela por APIs DOM, sem interpolar o '
            '<font face="Courier">title</font> ou <font face="Courier">innerHTML</font>. A CSP de '
            '<font face="Courier">vercel.json</font> (<font face="Courier">script-src \'self\'</font>) já bloqueia '
            'script inline e é a mitigação que hoje segura o caso — vale registrar essa dependência no '
            'comentário da função.'
        ),
        'aceite': [
            'printDocumentElement foi removida, ou o title é escapado antes da interpolação.',
            'Existe um comentário registrando que a impressão depende da CSP como mitigação.',
        ],
    },
]

# O item 4 do rascunho original era falso positivo: a migration 114 removeu
# portal_check_auth_method e o verificador antigo não entendia DROP FUNCTION.
# Ele permanece acima para rastreabilidade, mas não integra a contagem publicada.
ACHADOS = [a for a in ACHADOS if a['id'] != 4]

# --------------------------------------------------------------------------
# Pontos fortes verificados
# --------------------------------------------------------------------------
PONTOS_FORTES = [
    ('RLS universal e sem policy permissiva',
     'Replay das 359 migrations: <b>92 de 92 tabelas</b> com <font face="Courier">ENABLE ROW LEVEL '
     'SECURITY</font> e <b>282 policies vivas</b>. Nenhuma sobrevivente com '
     '<font face="Courier">USING (true)</font> ou <font face="Courier">auth.role() = \'authenticated\'</font>. '
     'As policies permissivas originais de <font face="Courier">002_rls.sql</font> foram substituídas por '
     '<font face="Courier">010_rls_by_role.sql</font>, e as que a migration 042 deixou escapar por erro de '
     'nome (<font face="Courier">vazios_imp_*</font>) foram removidas pela 097.'),
    ('Tabelas sensíveis falham fechadas',
     'Seis tabelas têm RLS habilitada e <b>zero policies</b> — logo, negam tudo para quem não é '
     '<font face="Courier">service_role</font>: <font face="Courier">portal_login_attempts</font>, '
     '<font face="Courier">portal_login_resolution_attempts</font>, '
     '<font face="Courier">portal_rate_limits</font>, <font face="Courier">portal_notifications</font>, '
     '<font face="Courier">provision_rate_limit_log</font> e '
     '<font face="Courier">agency_report_pending_baselines</font>. É o padrão correto para tabela de '
     'contador de rate limit.'),
    ('Gestão de usuários verifica privilégio no servidor',
     '<font face="Courier">supabase/functions/admin-users/index.ts:36-41</font> chama '
     '<font face="Courier">is_admin()</font> com o JWT do chamador e devolve 403 antes de qualquer '
     'operação; só então instancia o cliente <font face="Courier">service_role</font>. A desativação de '
     'usuário (<font face="Courier">:134-138</font>) é feita <b>pelo cliente do chamador</b>, de propósito, '
     'para que a policy de admin continue valendo e o trigger de auditoria enxergue '
     '<font face="Courier">auth.uid()</font>. O gate <font face="Courier">adminOnly</font> do frontend tem, '
     'portanto, equivalente real no servidor.'),
    ('As quatro permissões do frontend têm contraparte no banco',
     '<font face="Courier">roleHasPermission</font> (<font face="Courier">src/hooks/useAuth.tsx:19-34</font>) '
     'define <font face="Courier">admin_panel</font>, <font face="Courier">manage_users</font>, '
     '<font face="Courier">portal_provisioning</font> e '
     '<font face="Courier">settle_financial_adjustments</font>. Todas verificadas: as duas primeiras por '
     '<font face="Courier">is_admin()</font> na Edge Function; a terceira por '
     '<font face="Courier">portal_current_role</font> em '
     '<font face="Courier">portal-invite-send:19-20</font> e '
     '<font face="Courier">portal-account-suspend:11-12</font>; a quarta por '
     '<font face="Courier">is_financeiro_user()</font> em '
     '<font face="Courier">313_cod_adjustment_settlement.sql:351-353</font>.'),
    ('IDOR do Portal fechado por construção, não por revisão caso a caso',
     'As RPCs de dados do Portal não recebem <font face="Courier">customer_id</font>: elas resolvem o '
     'cliente por <font face="Courier">current_portal_customer_id()</font> e repassam a um núcleo '
     '<font face="Courier">_portal_*_core</font>. As funções de inspeção interna recebem o '
     '<font face="Courier">customer_id</font>, mas só através de '
     '<font face="Courier">_portal_inspect_guard()</font> '
     '(<font face="Courier">292_portal_inspection.sql:27-37</font>), que exige '
     '<font face="Courier">is_active_read_user()</font>. Os núcleos <font face="Courier">_core</font>, que '
     'aceitam <font face="Courier">customer_id</font> arbitrário, são revogados de '
     '<font face="Courier">authenticated</font> em bloco '
     '(<font face="Courier">292:207-214</font>). O parâmetro perigoso é inalcançável.'),
    ('Escrita do Portal valida posse item a item',
     '<font face="Courier">portal_create_consolidation</font> recusa a operação inteira com 42501 se '
     'qualquer recebível da seleção pertencer a outro cliente '
     '(<font face="Courier">br.customer_id &lt;&gt; v_customer_id</font>), e ainda exige CE Mercante '
     'liberado por B/L. <font face="Courier">portal_mark_notification_read</font>, '
     '<font face="Courier">portal_obsolete_consolidation</font> e '
     '<font face="Courier">portal_request_dispute_reopen</font> filtram pelo cliente resolvido.'),
    ('HTML de e-mail totalmente escapado',
     '<font face="Courier">supabase/functions/_shared/portalEmailTemplates.ts:3</font> define '
     '<font face="Courier">escapeHtml</font> e o aplica em <b>todos</b> os pontos de interpolação do HTML: '
     'parágrafos, nome da empresa, CNPJ, rótulos, valores, itens de lista, rótulo do botão e — o que '
     'costuma faltar — a <b>URL do botão</b> (<font face="Courier">:57</font>). Nome de cliente vem de '
     'importação de planilha, então é input não confiável, e está coberto.'),
    ('Nenhum sink clássico de XSS no frontend',
     'Varredura de <font face="Courier">src/</font>: zero ocorrências de '
     '<font face="Courier">dangerouslySetInnerHTML</font>, <font face="Courier">eval</font>, '
     '<font face="Courier">new Function</font> ou <font face="Courier">insertAdjacentHTML</font>. Não há '
     'renderização de Markdown. Os únicos <font face="Courier">href</font> dinâmicos '
     '(<font face="Courier">ChegadasSaidas.tsx:322</font>, '
     '<font face="Courier">ShipScheduleWidget.tsx:67</font>) montam URL do MarineTraffic a partir de um '
     'número IMO, sem espaço para <font face="Courier">javascript:</font>.'),
    ('Histórico git limpo e .env protegido',
      'Nenhum JWT ou chave foi encontrado na busca histórica documentada (padrão '
     '<font face="Courier">eyJ...eyJ...</font> em toda a árvore de revisões). O único arquivo de ambiente '
     'versionado é <font face="Courier">.env.example</font>, com placeholders; '
     '<font face="Courier">.gitignore:16-18</font> cobre <font face="Courier">.env</font> e '
     '<font face="Courier">.env.*</font>. O CI injeta as chaves por '
     '<font face="Courier">secrets.*</font>, e apenas as duas variáveis '
     '<font face="Courier">VITE_</font> públicas por natureza.'),
    ('Cabeçalhos de segurança e CSP restritiva',
     '<font face="Courier">vercel.json</font> e <font face="Courier">firebase.json</font> aplicam '
     '<font face="Courier">script-src \'self\'</font> (sem <font face="Courier">unsafe-inline</font> e sem '
     '<font face="Courier">unsafe-eval</font>), <font face="Courier">object-src \'none\'</font>, '
     '<font face="Courier">frame-ancestors \'none\'</font>, <font face="Courier">base-uri \'self\'</font>, '
     'além de <font face="Courier">X-Frame-Options: DENY</font>, '
     '<font face="Courier">X-Content-Type-Options: nosniff</font> e '
     '<font face="Courier">Permissions-Policy</font>. O <font face="Courier">connect-src</font> lista os '
     'destinos exatos.'),
    ('Autenticação do Portal endurecida contra enumeração e força bruta',
     'O login devolve mensagem genérica única, contabiliza tentativas por CNPJ '
     '(<font face="Courier">portalLoginRateLimit.ts</font>, com falha da RPC contando como bloqueio) e '
     'iguala o <b>tempo</b> de resposta entre os desfechos via '
     '<font face="Courier">EdgeRuntime.waitUntil</font> — fechando o oráculo por tempo que uma auditoria '
     'anterior encontrou. Tokens de convite e recuperação são aleatórios de 32 bytes, armazenados apenas '
     'como SHA-256, de uso único e com consumo condicional '
     '(<font face="Courier">UPDATE ... WHERE status = \'pendente\'</font>), o que resolve a corrida.'),
    ('CORS por allowlist, negando pela ausência do cabeçalho',
     '<font face="Courier">_shared/cors.ts:53-61</font> só emite '
     '<font face="Courier">Access-Control-Allow-Origin</font> quando a origem está na allowlist — em vez de '
     'devolver a string <font face="Courier">\'null\'</font>, que casaria com iframes '
     '<font face="Courier">sandbox</font> e documentos <font face="Courier">data:</font>. O padrão de preview '
     'do Vercel é ancorado ao projeto e à equipe, não a um wildcard de '
     '<font face="Courier">vercel.app</font>, e <font face="Courier">Vary: Origin</font> acompanha.'),
]

PONTOS_FRACOS = [
    ('O role authenticated é compartilhado entre operador e cliente',
     'É a fragilidade estrutural da qual derivam os achados de autorização. O cliente do Portal e o '
     'operador interno recebem o mesmo role do Supabase Auth; a separação real é feita <b>função a '
     'função</b>, por guarda no corpo ou por ACL. Com muitas funções SECURITY DEFINER concedidas a '
     '<b>authenticated</b>, o custo de errar é uma função nova sem guarda — e cada uma delas ignora a RLS por '
     'definição. A disciplina hoje é humana e não tem verificação automatizada.'),
    ('Código morto continua publicado no PostgREST',
     'O fluxo de token legado do Portal foi removido pela migration 114. O que a auditoria encontrou '
     'foi a necessidade de modelar DROP FUNCTION no replay para que código histórico não continue sendo '
     'tratado como endpoint vivo.'),
    ('Degradação silenciosa de configuração de segredo',
     'Duas Edge Functions aceitavam a <font face="Courier">service_role</font> como bearer quando o segredo '
     'dedicado não estava definido. O código atual precisa falhar fechado; a auditoria não teve evidência '
     'de que isso ocorreu em produção.'),
]

# --------------------------------------------------------------------------
# Categorias sem achado
# --------------------------------------------------------------------------
SEM_ACHADO = [
    ('cat2', '2. Permissão definida no navegador',
     'Nenhum bypass foi confirmado, mas a cobertura não é exaustiva: além das quatro permissões em '
     '<font face="Courier">roleHasPermission</font> (<font face="Courier">src/hooks/useAuth.tsx:14-34</font>) '
     'e uma única rota <font face="Courier">adminOnly</font> (<font face="Courier">src/App.tsx:202-206</font>, '
     '<font face="Courier">/admin/usuarios</font>), há gates independentes em páginas operacionais. As '
     'permissões revisadas têm contraparte server-side; os gates independentes devem permanecer na lista '
     'de cobertura. Vale registrar que <font face="Courier">ProtectedRoute</font> é honesto quanto ao seu papel: '
     'ele redireciona a UI, e a autorização real está no banco — que é exatamente a postura correta para '
     'uma SPA estática.'),
]

# --------------------------------------------------------------------------
# Recomendações priorizadas
# --------------------------------------------------------------------------
RECOMENDACOES = [
    ('P1', 'Fechar o ACL de portal_billing_gate', 'Achado 1',
     'Único achado de severidade alta e o de exploração mais barata: vaza PII cross-tenant com uma '
     'chamada HTTP e um ID sequencial. É uma linha de SQL — <font face="Courier">REVOKE ... FROM '
     'authenticated</font> — sem impacto em consumidor de produção.'),
    ('P1', 'Guardar refresh_voyage_status_from_terminal_scales', 'Achado 2',
     'É a única escrita não autorizada da auditoria. Manter apenas '
     '<font face="Courier">service_role</font> ou adicionar a guarda '
     '<font face="Courier">is_active_user()</font> que as funções irmãs já usam.'),
    ('P2', 'Fechar o ACL dos helpers de viagem sem consumidor de cliente', 'Achado 3',
     'Os helpers de POD devem ficar disponíveis apenas para os detectores internos. A ETA tem consumidor '
     'interno real e precisa de guarda server-side; ela não pode ser revogada cegamente.'),
    ('P2', 'Remover o fallback para a service_role key e girar a chave se necessário', 'Achado 5',
     'Substituir o <font face="Courier">?? SUPABASE_SERVICE_ROLE_KEY</font> por falha explícita na '
     'inicialização, no padrão que <font face="Courier">portalEmail.ts:47</font> já adota. Se a chave já '
     'tiver sido usada como secret header em produção, girá-la é parte da correção, não um passo opcional.'),
    ('P2', 'Automatizar a verificação que esta auditoria fez à mão', 'Estrutural',
     'A fragilidade central é que a guarda de cada função SECURITY DEFINER depende de disciplina humana '
     'em funções. O script de replay usado aqui '
     '(<font face="Courier">scripts/security/verificar_guardas.py</font>) resolve o estado final de '
     'policies e grants e aponta funções DEFINER concedidas a '
     '<font face="Courier">authenticated</font> sem guarda, seguindo cadeias de delegação. Rodá-lo no CI '
     'transforma a próxima ocorrência desta classe em build vermelho, em vez de outra auditoria.'),
    ('P3', 'Unificar a comparação de segredos das Edge Functions', 'Achado 6',
     'Usar comparação <font face="Courier">timingSafeEqual</font> em todas as funções com bearer secret. '
     'A implementação foi aplicada ao digest; a duplicação residual é apenas manutenção.'),
    ('P3', 'Limpar os sinks latentes e os segredos de script local', 'Achados 7 e 8',
     'O helper de impressão tem consumidor real e foi endurecido sem remover o fluxo. As credenciais do '
     'shim local continuam explicitamente restritas ao ambiente de desenvolvimento.'),
]

# Administração de usuários internos: criação e gestão de credenciais

## Objetivo

Dar à tela `/admin/usuarios` um fluxo próprio de criação de usuários internos e
de manutenção das credenciais deles, eliminando a dependência do dashboard do
Supabase. O administrador cadastra nome, e-mail, setor e senha; altera e-mail ou
senha a qualquer momento; e cada usuário troca a própria senha. Junto disso, a
tela passa a exibir e-mail e último acesso, ganha busca, confirma a troca de
setor e registra todas essas ações no Log de Ações.

## Contexto

`user_profiles.id` é chave estrangeira de `auth.users(id)`, e o serviço da tela
só faz `SELECT` e `UPDATE` (`src/services/adminUsers.ts`). Não existe caminho no
produto para criar a identidade em `auth.users`: isso só acontece pelo dashboard
do Supabase, e o estado intermediário já é conhecido pelo produto — o
`ProtectedRoute` tem uma tela dedicada a "perfil não provisionado". O login
interno também não oferece recuperação de senha, então quem esquece a senha fica
sem saída dentro do sistema.

O Portal do Cliente resolve o mesmo problema por convite com token e e-mail
(`portal-invite-send` / `portal-invite-activate`). Para o time interno essa
cerimônia não se justifica: o administrador conhece as pessoas e entrega a senha
diretamente.

## Decisões

- **Senha definida pelo administrador, sem convite por e-mail.** O usuário nasce
  com `email_confirm: true` e entra imediatamente. Decisão divergente do Portal,
  registrada na ADR 0037.
- **Setor é o papel que já existe**, não um campo novo. `administrativo`,
  `financeiro`, `operacoes`, `documentacao` e `equipamentos` já são tratados como
  departamento pelo sign-off do ADR
  (`223_agency_report_department_signoff.sql`). O campo passa a ser de
  preenchimento obrigatório no cadastro, sem valor pré-selecionado; papéis
  legados (`admin`, `operator`) são recusados na criação.
- **Escrita privilegiada em Edge Function; leitura em RPC.** Criar usuário exige
  `service_role`, que não pode chegar ao browser, e inserir direto em
  `auth.users` replicaria à mão os invariantes do GoTrue. A listagem continua
  sendo uma leitura cacheável pelo React Query.
- **Não há recuperação de senha existente**, nem para o administrador: a senha é
  guardada como hash. A única operação possível é definir uma nova, e é a mesma
  ação usada para socorrer quem esqueceu a senha.
- **Troca de senha pelo próprio usuário exige a senha atual**, revalidada antes
  da troca, para que uma estação destravada não permita sequestrar a conta.
- **A auditoria de setor e de status mora no banco**, em trigger, e não no
  frontend: essas alterações saem direto por PostgREST, e o trigger cobre todo
  chamador presente e futuro.
- **Desativar encerra a sessão ativa.** O diálogo atual promete que "revoga
  imediatamente o acesso"; hoje apenas o flag muda e o token segue válido até
  expirar. Correção incluída neste escopo.
- **E-mail já cadastrado devolve erro**, sem tentar reparar cadastros
  incompletos. Na base atual só existe o perfil do próprio administrador, então
  o caso é teórico.

## Escopo técnico

### Migration `258_admin_usuarios_gestao.sql`

Sem DDL de tabela. Duas adições:

- RPC `admin_list_users()`, `SECURITY DEFINER`, com guarda
  `IF NOT public.is_admin() THEN RAISE EXCEPTION ... ERRCODE '42501'`,
  `REVOKE ALL FROM PUBLIC` e `GRANT EXECUTE TO authenticated`. Devolve as colunas
  de `user_profiles` somadas a `email` e `last_sign_in_at` de `auth.users`, sem
  expor a tabela de autenticação ao papel `authenticated`.
- Trigger `AFTER UPDATE OF role, active ON public.user_profiles` gravando em
  `audit_logs` (`entity_type = 'user_profile'`, `entity_id` = id do perfil,
  `field_name` = `role` ou `active`, `changed_by = auth.uid()`).

`is_admin()` já aceita `('admin', 'administrativo')` desde a migration `040`,
coerente com o `isAdmin` de `useAuth`.

### Edge Function `admin-users`

Valida o JWT do chamador com `is_admin()` antes de instanciar o cliente
`service_role`, no mesmo formato de `portal-invite-send`.

| Ação | Entrada | Efeito |
|---|---|---|
| `create` | `full_name`, `email`, `password`, `role` | `auth.admin.createUser({ email, password, email_confirm: true })`, insere `user_profiles` (`active: true`), audita. Falha ao inserir o perfil apaga o usuário auth recém-criado. |
| `update_credentials` | `user_id`, `email?`, `password?` | `auth.admin.updateUserById`, audita. Troca de e-mail registra valor antigo e novo; troca de senha registra apenas o evento. |
| `deactivate` | `user_id` | Grava `active = false` e encerra as sessões com `auth.admin.signOut(user_id)`. |

Validações do servidor: formato de e-mail, política de senha e `role` restrito a
`MANAGED_PROFILES`. E-mail duplicado responde `409` com mensagem legível.

**Dois clientes por requisição, com papéis distintos.** Sob `service_role`,
`auth.uid()` é nulo — o trigger de auditoria gravaria a alteração sem autor,
anulando o incremento. Portanto a escrita em `user_profiles` da ação
`deactivate` usa o cliente com o JWT do chamador, que satisfaz a policy de
admin e preserva o autor no trigger; `service_role` fica restrito ao que exige
privilégio de autenticação (`createUser`, `updateUserById`, `signOut`). As
ações `create` e `update_credentials` não passam por trigger — o `INSERT` não é
coberto e a credencial não vive em `user_profiles` — então gravam a própria
linha de auditoria com `changed_by` igual ao id do chamador.

### Frontend

- `src/lib/passwordPolicy.ts` — mínimo de 8 caracteres com maiúscula, minúscula e
  número, extraído do texto hoje solto em `PortalResetPassword.tsx`. A Edge
  Function repete a regra com comentário apontando a origem, como
  `_shared/portalEmail.ts` faz com o `maskEmail`, porque o Deno não importa o
  bundle do Vite. O servidor do Portal hoje só confere o comprimento; a regra
  passa a valer dos dois lados.
- `src/services/adminUsers.ts` — `listAllUserProfiles` passa a chamar
  `admin_list_users()`; novas funções `createUser` e `updateUserCredentials`
  invocam a Edge Function. Query key `['admin-users']` preservada.
- `src/pages/AdminUsuarios.tsx` — botão **Novo usuário**, busca por nome/e-mail,
  colunas de e-mail e último acesso, ação **Editar acesso** por linha e
  confirmação ao trocar de setor exibindo o escopo do setor de destino. O bloco
  "Informações do sistema" desce para a aba Métricas.
- Troca de senha pelo próprio usuário: acionada pelo nome no cabeçalho, pede a
  senha atual e usa `supabase.auth.updateUser({ password })` com a própria
  sessão, sem backend novo.

### Testes

- `AdminUsuarios.behavior.test.tsx`: setor obrigatório barra o envio; senha e
  confirmação precisam coincidir; troca de setor pede confirmação; a busca
  encontra por e-mail; "Nunca acessou" aparece para quem nunca entrou.
- Teste unitário de `passwordPolicy`.
- Teste de integração no padrão de `src/integration/*.local-pg.test.ts`:
  `admin_list_users()` recusa quem não é administrador, e o trigger grava em
  `audit_logs` na troca de setor e na desativação.
- A Edge Function não tem suíte automatizada no projeto; a validação é em
  ambiente real, registrada conforme `docs/operations/validacao.md`.

## Fora de escopo

- Convite por e-mail e autoatendimento de "esqueci minha senha" no login
  interno: o administrador redefine a senha.
- Reparo de cadastros incompletos em `auth.users` sem perfil correspondente.
- Exclusão de usuários: a desativação permanece como caminho, preservando a
  autoria histórica nos registros de auditoria.
- Migração dos papéis legados `admin` e `operator` para os nomes atuais.

## Documentação afetada

`docs/ARCHITECTURE.md` (rota `/admin/usuarios`), `docs/RASTREABILIDADE.md`
(linhas de `user_profiles`, `audit_logs` e da rota), ADR `0037` e o plano
derivado em `docs/plans/`.

## Ordem de deploy

Migration, depois Edge Function, depois frontend. O deploy do Firebase não
publica Edge Functions nem aplica migrations (`WORKFLOW.md`), então a inversão
sobe uma tela que chama uma função inexistente.

## Autorizações necessárias na implementação

O hook `.claude/hooks/protect-files.sh` protege `supabase/migrations/*` e
`src/types/database.ts`. Criar a migration e regenerar os tipos exige
`CLAUDE_ALLOW_PROTECTED=1` autorizado explicitamente.

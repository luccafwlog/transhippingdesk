# Criação automática da conta de Portal ao cadastrar Cliente

**Status:** aprovado pelo usuário em 2026-07-14

## Objetivo

Todo novo registro em `public.customers` deve aparecer imediatamente na fila
`/clientes/portal` como `aguardando_analise` e `sem_conta`, sem depender de B/L,
processo ativo ou convite.

O comportamento deve valer para cadastro manual, importações e qualquer outro
fluxo que insira diretamente em `customers`.

## Contexto confirmado

- `create_customer_with_contacts` atualmente insere somente `customers` e
  `customer_contacts`.
- `portal_provisioning_backfill` criou os registros dos clientes existentes,
  mas não acompanha clientes criados depois.
- `portal_refresh_general_pendencies` cria alertas para clientes com B/L ativo
  sem Portal, mas não cria registros na fila.
- `portal_reopen_on_new_process` apenas reabre uma conta já existente quando um
  novo processo tira o cliente de `provisionamento_nao_necessario`.
- `customer_portal_accounts.customer_id` é único, permitindo uma conta por
  CNPJ/Cliente e uma operação idempotente.

## Decisão de arquitetura

Adicionar uma função e um trigger no banco:

```text
AFTER INSERT ON public.customers
  -> cria customer_portal_accounts, se ainda não existir
  -> registra evento de auditoria do sistema
```

A função será `SECURITY DEFINER`, terá `search_path` fixo e não dependerá de
`auth.uid()`, pois também precisa funcionar para importações e operações de
serviço. O evento usará `actor_type = 'sistema'` e `actor_id = NULL`.

### Valores iniciais

```text
customer_id             = NEW.id
active                  = false
provisioning_decision   = 'aguardando_analise'
account_situation       = 'sem_conta'
login_cnpj              = regexp_replace(NEW.cnpj_cpf, '\\D', '', 'g')
contact_email           = NULL
auth_user_id            = NULL
```

O trigger não cria usuário Auth, senha, convite, email de recuperação ou envio
de email. A decisão e o convite continuam sendo ações manuais da equipe.

## Migração e reparo inicial

Será criada uma migration posterior à `192_portal_rpc_guard_hardening.sql` que:

1. Cria a função `portal_create_account_on_customer_insert()`.
2. Cria o trigger idempotentemente, removendo uma definição anterior com o
   mesmo nome antes de recriá-la.
3. Executa um reparo idempotente para qualquer Cliente existente sem registro
   em `customer_portal_accounts`, usando os mesmos estados iniciais.
4. Registra um evento `portal_provisioning_events` para cada registro criado
   pelo reparo, com motivo explícito de criação automática/reparo.

O `INSERT` usará a restrição única de `customer_id` e `ON CONFLICT DO NOTHING`.
Assim, a migration pode ser reaplicada com segurança lógica e não altera contas
já existentes, convites, sessões ou decisões manuais.

## Fluxo resultante

```text
INSERT em customers
  -> trigger cria conta Portal sem conta
  -> cliente aparece em /clientes/portal
  -> Documentação/Administração revisa o email
  -> equipe decide e envia convite individualmente
  -> cliente define a própria senha
  -> conta torna-se ativa
```

Um B/L ou processo ativo poderá continuar influenciando prioridade e alertas,
mas deixará de ser pré-requisito para a presença na fila.

## Testes e evidências

- Adicionar teste de contrato da migration verificando função, trigger,
  estados iniciais, normalização de CNPJ, idempotência e evento de auditoria.
- Executar o teste novo primeiro, antes da implementação, confirmando a falha
  pela ausência da migration/trigger.
- Após implementar, executar o teste novamente e confirmar a passagem.
- Aplicar a migration no Production e consultar o pré-voo para confirmar
  `customers_missing_record = 0`.
- Criar um Cliente de teste por cada caminho disponível, quando houver janela
  segura de teste, e confirmar a presença da conta sem convite ou Auth.
- Rodar os gates do repositório: `npm run docs:check`, `npm run lint`,
  `npm test`, `npm run build` e `git diff --check`.

## Critérios de aceitação

- Todo Cliente novo aparece na fila sem precisar de processo/B/L.
- Clientes existentes sem registro são reparados pela migration.
- A fila mostra `aguardando_analise` e `sem_conta` inicialmente.
- Nenhum email ou convite é enviado automaticamente.
- Nenhuma senha, identidade Auth ou sessão é criada automaticamente.
- Reexecução não duplica conta nem evento de criação já persistido.
- Importações e outros inserts em `customers` seguem o mesmo comportamento.

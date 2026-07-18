# Fila de provisionamento autorrecuperável

## Contexto

Em produção, o pré-voo do Portal encontrou 310 Clientes e nenhum registro em
`customer_portal_accounts`. A rota `/clientes/portal?filtro=todos` retornou zero
linhas sem erro porque o read model usa `customer_portal_accounts` como origem e
faz `JOIN` com `customers`.

A migration `193_portal_account_on_customer_insert.sql` cria o registro de Portal
quando um Cliente novo é inserido. Esse trigger não cobre a remoção posterior ou
a ausência de registros de Portal para Clientes já existentes. O mecanismo atual
de backfill é idempotente, mas depende de execução manual.

## Objetivo

Garantir que todo Cliente existente possua um registro de fila do Portal antes de
a fila ser lida, sem criar identidade Auth, convite, Email de Recuperação ou email
transacional. Reparos devem ser idempotentes e auditáveis.

## Desenho aprovado

Uma migration numerada cria uma função interna de reparo que:

1. insere em `customer_portal_accounts` apenas os Clientes sem registro;
2. usa `ON CONFLICT (customer_id) DO NOTHING` para tolerar concorrência;
3. inicializa `active=false`, decisão `aguardando_analise`, situação `sem_conta`
   e `login_cnpj` normalizado;
4. registra um evento de sistema para cada linha efetivamente criada;
5. retorna a quantidade reparada.

`portal_list_provisioning_console` deixa de ser `STABLE`, chama o reparo antes do
`RETURN QUERY` e mantém a projeção e as regras de autorização das migrations 196
e 197. Assim, a leitura administrativa repara lacunas antes de compor a fila. O
trigger da migration 193 continua sendo a primeira defesa para novos Clientes.

A função de reparo não recebe `EXECUTE` de `PUBLIC`, `anon` ou `authenticated`.
Ela é alcançada somente por funções `SECURITY DEFINER` controladas. O read model
continua permitindo Administrativo, Documentação, Financeiro e Operações, com a
mesma projeção por perfil; o reparo sempre registra ator `sistema`.

## Recuperação de produção

Após aplicar a migration, o backfill existente será executado uma vez pela tela
administrativa, com um `request_id` novo. A ordem é intencional:

1. aplicar a proteção permanente;
2. executar o pré-voo e confirmar 310 ausentes;
3. executar o backfill idempotente autorizado;
4. repetir o pré-voo e confirmar zero ausentes;
5. abrir o filtro `Todos` e confirmar a fila populada.

Se uma leitura da fila ocorrer entre os passos 1 e 3, o reparo do read model pode
criar os registros antes do backfill. Nesse caso, o backfill retornará zero ou
apenas o saldo restante, o que é comportamento correto.

## Falhas e observabilidade

- Se o reparo falhar, a RPC falha; a aplicação deve mostrar o erro de carregamento
  em vez de apresentar uma fila vazia como estado válido.
- O evento append-only diferencia criação normal, backfill e reparo automático.
- O pré-voo permanece como diagnóstico operacional de totais e lacunas.
- Nenhum dado pessoal será registrado na issue ou nas evidências de validação.

## Testes e critérios de aceite

- **Teste de contrato SQL:** a migration contém a função de reparo protegida,
  inserção idempotente, auditoria de sistema e chamada antes da consulta da fila.
- **Teste de contrato SQL:** a RPC não é `STABLE` e preserva as guardas de perfil,
  grants restritos e correções das migrations 196 e 197.
- **Runtime:** pré-voo final informa 310 Clientes, 310 registros e zero ausentes.
- **Runtime:** `/clientes/portal?filtro=todos` exibe os Clientes e o badge de
  aguardando análise deixa de mostrar zero.
- `npm run docs:check`, `npm run lint`, `npm test` e `npm run build` passam.

## Fora de escopo

- Criar usuários Auth, convites ou emails automaticamente.
- Alterar estados de Contas de Portal já existentes.
- Descobrir retroativamente qual operação removeu os registros sem evidência de
  auditoria disponível; a correção elimina o impacto operacional da lacuna.

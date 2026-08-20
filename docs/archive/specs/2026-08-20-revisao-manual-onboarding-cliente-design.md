# Revisão manual orientada a cliente e onboarding via B/L

**Issue:** #562 — Revisar a tela de revisão manual e o cadastro de cliente feito a partir dela
**Status:** aprovada para planejamento
**Data:** 2026-08-20

## Contexto

No início da operação, a importação de B/L será a principal porta de entrada de
clientes. Quando o CNPJ extraído do B/L ainda não existir em `customers`, o
operador precisará criar o cliente, registrar um e-mail e vincular os B/Ls que
pertencem àquela mesma identidade.

A fila atual já agrupa visualmente B/Ls por CNPJ ou nome, mas o cadastro de um
cliente novo acontece dentro do drawer de um B/L e só deixa o cliente
selecionado para aquele item. Esse desenho não representa a unidade real de
trabalho: na maioria dos casos, uma decisão sobre o cliente resolve vários
B/Ls.

## Objetivo

Transformar `/revisao` numa fila orientada por cliente, com onboarding em lote
para todos os B/Ls que compartilham uma identidade documental segura e com os
B/Ls específicos exibidos apenas como exceções dentro do grupo.

O fluxo deve permitir, numa única operação do grupo:

1. informar ou confirmar CNPJ;
2. confirmar a razão social;
3. cadastrar ao menos um e-mail;
4. criar ou selecionar o cliente;
5. vincular todos os B/Ls do grupo;
6. reavaliar as pendências individuais;
7. opcionalmente iniciar o convite do Portal usando o mesmo e-mail informado.

## Escopo

### Incluído

- fila e hierarquia visual orientadas por cliente;
- cadastro e vínculo em nível de grupo;
- exigência de CNPJ válido e e-mail para concluir o onboarding;
- exposição do `consignee_block` e do `cargo_description` como evidência bruta;
- segregação de grupos quando houver CNPJs conflitantes;
- inclusão idempotente de e-mails extraídos para clientes já existentes;
- tratamento de B/Ls com pendências específicas sem abandonar a visão por cliente;
- opção explícita, desmarcada por padrão, para iniciar o convite do Portal;
- auditoria, concorrência e retorno por B/L da operação em lote.

### Fora do escopo

- acompanhamento de convite, token, ativação, uso ou reenvio do Portal;
- substituição da tela de Provisionamento do Portal;
- cadastro completo de todos os campos comerciais/operacionais do cliente;
- alteração do conteúdo original do documento importado;
- correções genéricas de todas as inconsistências de B/L em uma nova tela;
- criação de uma segunda fila paralela por B/L.

## Experiência do operador

### Fila

A tela sempre renderiza grupos de cliente. Um grupo é identificado por:

- CNPJ válido normalizado, quando a identidade documental estiver disponível;
- nome normalizado do consignatário, apenas como agrupador provisório quando
  nenhum CNPJ válido estiver disponível.

O nome sem CNPJ é uma chave de visualização, nunca uma autorização para criar
ou vincular cliente.

Cada grupo exibe nome, CNPJ quando houver, quantidade de B/Ls, estado do
onboarding, resumo das pendências e ações compatíveis com esse estado. O grupo
permanece aberto na fila enquanto qualquer B/L ainda tiver pendência.

### Grupo com CNPJ válido e cliente inexistente

O grupo mostra um painel de onboarding com:

- CNPJ válido, preenchido quando extraído e editável;
- razão social/nome extraído do consignatário, editável;
- **E-mail principal do cliente**, obrigatório;
- checkbox **Enviar convite do Portal para este mesmo e-mail**, desmarcado por
  padrão;
- confirmação textual do endereço que receberá o convite;
- ação **Criar cliente e vincular N B/Ls**.

Ao concluir, o cliente, o contato e os vínculos são persistidos numa operação
transacional. Cada B/L é reavaliado e o grupo passa a exibir somente as
exceções que restarem.

### Grupo sem CNPJ válido

O grupo mostra o nome do consignatário como identidade provisória e bloqueia
criação e vínculo. A ação disponível é **Informar CNPJ**.

O painel deve exibir, por B/L:

- o bloco bruto extraído do consignatário (`consignee_block`);
- a descrição da carga (`cargo_description`);
- qualquer candidato de CNPJ encontrado nesses textos;
- o B/L de origem da evidência.

Depois que o operador informar um CNPJ válido, a operação aplica a identidade a
todos os B/Ls do grupo de mesmo nome, desde que não haja conflito documental.

### CNPJs conflitantes

Se B/Ls que compartilham o mesmo nome de consignatário apresentarem indícios
de CNPJs diferentes, eles devem ser segregados por identidade documental. B/Ls
sem candidato de CNPJ permanecem num subconjunto separado de identidade
pendente.

Nenhum vínculo em massa é permitido enquanto houver conflito não resolvido.
O grupo deve informar a divergência e mostrar as evidências que motivaram a
segregação.

### Cliente existente sem e-mail

Ao selecionar um cliente já cadastrado que não possui contato com e-mail, o
operador deve informar um e-mail antes de concluir o vínculo do grupo. A tela
usa o mesmo painel de onboarding, mas troca a ação para **Adicionar e-mail e
vincular N B/Ls**.

### Cliente existente com e-mail

O grupo pode ser vinculado diretamente ao cliente. Se a importação do B/L
trouxer outro e-mail para o mesmo CNPJ, o sistema adiciona esse contato de
forma idempotente. A diferença entre e-mails não abre nova pendência de
revisão.

### Exceções específicas de B/L

Depois da resolução do cliente, o grupo continua visível somente com B/Ls que
possuam pendências próprias, como peso BB, CE Mercante ou outra inconsistência
operacional. Cada exceção tem ação **Revisar B/L**, mas a navegação e o contexto
principal continuam no grupo do cliente.

### Portal

O checkbox do Portal é desmarcado por padrão. Quando marcado, a Revisão inicia
o provisionamento/envio do convite para o mesmo e-mail principal cadastrado.

A Revisão exibe apenas o resultado imediato da solicitação. Status posterior,
token, ativação, uso e reenvio pertencem exclusivamente à tela de
Provisionamento do Portal.

## Regras de dados e transação

### Onboarding do grupo

O frontend deve chamar uma operação de domínio única para concluir o grupo,
em vez de executar uma sequência de vínculos individuais. O contrato deve
receber os B/Ls do grupo, CNPJ, razão social, e-mail e ator autenticado.

O banco deve validar novamente:

- usuário interno ativo e autorizado;
- B/Ls ainda pendentes e pertencentes ao grupo informado;
- CNPJ válido;
- e-mail válido;
- ausência de CNPJs conflitantes;
- coerência entre a identidade informada e os dados documentais.

Dentro da mesma transação, a operação deve:

1. criar ou resolver `customers` por CNPJ único;
2. inserir o contato em `customer_contacts` sem duplicar e-mails;
3. vincular todos os B/Ls do grupo;
4. atualizar o estado de reconciliação e limpar sugestões antigas quando
   aplicável;
5. registrar auditoria;
6. recalcular o gate de cada B/L;
7. retornar o resultado por B/L, incluindo pendências remanescentes.

Falha em qualquer etapa de cliente, contato, vínculo ou gate reverte a
operação inteira.

### E-mail extraído durante importação

Quando um B/L identificar um CNPJ que já corresponde a um cliente, o e-mail
extraído deve ser incluído automaticamente nos contatos desse cliente, com
comparação case-insensitive e operação idempotente. E-mail diferente não cria
fila de revisão.

Essa regra deve viver numa função compartilhada pelo fluxo de importação e de
reconciliação, não apenas em um handler da tela `/revisao`.

### Convite do Portal

O disparo do convite ocorre somente depois do sucesso da operação transacional
de cliente, contato e vínculos. O envio é uma operação externa e não participa
do rollback dos dados cadastrais; a Revisão não administra seu ciclo de vida.

## Falhas e concorrência

| Situação | Comportamento |
|---|---|
| CNPJ inválido | Bloqueia a conclusão e mantém o grupo aberto. |
| E-mail ausente ou inválido | Bloqueia a conclusão e destaca o campo. |
| CNPJs diferentes no mesmo nome | Segrega as evidências e bloqueia vínculo em massa. |
| CNPJ já cadastrado em corrida | Resolve o cliente único e recarrega o grupo se necessário. |
| Outro operador alterou um B/L | Retorna conflito, invalida a fila e não sobrescreve dados. |
| Falha em cliente/contato/vínculo/gate | Rollback completo da operação do grupo. |
| E-mail já existente | No-op idempotente, sem duplicação ou nova pendência. |
| Convite desmarcado | Nenhuma chamada de Portal. |
| Convite marcado | Inicia o convite e mostra apenas o resultado imediato. |

## Evidências do código atual

- **Código:** `src/pages/Revisao.tsx` já agrupa a fila e possui ação de vínculo
  em lote para cliente existente, mas o cadastro novo permanece no drawer de
  um único B/L.
- **Código:** `src/pages/revisaoHelpers.ts` usa CNPJ como chave preferencial e
  nome normalizado como fallback visual.
- **Código:** `src/hooks/useReview.ts` já carrega `consignee_block`,
  `cargo_description`, `manifest_customer_cnpj_cpf` e
  `manifest_customer_email` por meio do registro do B/L.
- **Código:** `src/services/customers.ts` já cria cliente com contatos e
  possui inserção de e-mail para cliente existente.
- **Código:** `supabase/migrations/284_customer_link_requires_document.sql`
  já adiciona e-mail do manifesto de forma idempotente ao aprovar uma
  reconciliação, servindo como precedente para a regra compartilhada.
- **Código:** `supabase/migrations/128_review_gate_canonical_pendencies.sql`
  e `188_review_gate_remove_portal.sql` já usam a existência de contato com
  e-mail como pendência canônica.

## Critérios de aceite

1. A fila é sempre visualizada por cliente/grupo; B/Ls não aparecem como uma
   lista plana de trabalho.
2. Criar ou selecionar um cliente com CNPJ válido permite vincular todos os
   B/Ls do grupo numa única ação.
3. Um grupo sem CNPJ válido não permite criar nem vincular cliente e exibe as
   evidências brutas do consignatário e da carga.
4. CNPJs conflitantes são segregados e impedem vínculo em massa até resolução.
5. O cadastro só é concluído com CNPJ válido, razão social e e-mail.
6. Cliente existente sem e-mail exige e-mail antes do vínculo.
7. E-mail novo encontrado para CNPJ já cadastrado é adicionado automaticamente
   sem criar revisão adicional.
8. Após o onboarding, permanecem visíveis somente as exceções específicas de
   cada B/L, ainda dentro do grupo do cliente.
9. O convite do Portal usa o mesmo e-mail cadastrado, é opcional e vem
   desmarcado por padrão.
10. A Revisão não exibe nem administra o ciclo posterior do convite.
11. Uma falha na transação de onboarding não deixa cliente, contato ou vínculos
   parcialmente persistidos.

## Validação planejada

- testes puros para agrupamento por CNPJ, fallback por nome e segregação de
  candidatos conflitantes;
- teste de contrato SQL para validações, grants, idempotência de contato,
  auditoria e rollback da operação em lote;
- testes de service para retorno por B/L e classificação de conflitos;
- testes de comportamento da tela para estados de onboarding, exigência de
  e-mail, checkbox do Portal desmarcado e exceções aninhadas;
- teste de importação garantindo inclusão idempotente de e-mail distinto para
  cliente existente sem criar pendência.

## Referências

- [Issue #562](https://github.com/luccafwlog/transhippingdesk/issues/562)
- [`src/pages/Revisao.tsx`](../../src/pages/Revisao.tsx)
- [`src/components/review/ReviewGroupBlock.tsx`](../../src/components/review/ReviewGroupBlock.tsx)
- [`src/components/review/ReviewDrawer.tsx`](../../src/components/review/ReviewDrawer.tsx)
- [`src/hooks/useReview.ts`](../../src/hooks/useReview.ts)
- [`src/pages/revisaoHelpers.ts`](../../src/pages/revisaoHelpers.ts)
- [`src/services/customers.ts`](../../src/services/customers.ts)
- [`docs/modules/operacao-suporte.md`](../modules/operacao-suporte.md)
- [`docs/modules/clientes.md`](../modules/clientes.md)

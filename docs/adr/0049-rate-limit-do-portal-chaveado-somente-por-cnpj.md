# 0049 — Rate limit do Portal chaveado somente pelo CNPJ

Status: aceito — 2026-08-14

> **Alcance.** O que esta ADR descreve como vigente é a chave do rate limit e o
> preço aceito no login — ambos verificáveis no repositório hoje. A decorrência
> sobre o teto de envio de email está marcada como não implementada no corpo, e
> vive na Task 7 do plano
> [`2026-08-14-rate-limit-portal-normalizador-compartilhado`](../plans/2026-08-14-rate-limit-portal-normalizador-compartilhado.md).

## Contexto

O login e a recuperação de senha do Portal contam tentativas num balde chaveado
pelo hash do CNPJ (`portal_login_attempts.cnpj_hash`, migration `040`). Cinco
tentativas em 15 minutos bloqueiam o CNPJ.

O CNPJ é o único identificador de login do Portal (ADR
[0013](./0013-portal-auth-identificador-resolvido-e-excecao-anon.md),
`CONTEXT.md` — "Identificador de Login do Portal") e é **informação pública**:
consta do site da empresa, da nota fiscal e das consultas abertas da Receita.
Isso tem uma consequência que não estava registrada em lugar nenhum: qualquer
pessoa pode encher o balde de um CNPJ alheio. Cinco senhas erradas contra um
CNPJ público deixam **o dono** de fora por 15 minutos, e repetir a cada janela
mantém o dono de fora indefinidamente. Quem é punido não é quem age.

Na recuperação de senha o efeito é outro: cada pedido dispara um email para o
Email de Recuperação do cliente. Com o balde permitindo cinco por janela, um
terceiro faz o sistema enviar até 480 emails por dia à caixa de um cliente real,
saindo do domínio de envio do Portal.

Ambas as Edge Functions são necessariamente públicas (`verify_jwt = false`):
quem esqueceu a senha não tem sessão para apresentar.

## Decisão

**O balde continua chaveado somente pelo CNPJ.** Não será acrescentada dimensão
por endereço de rede.

A alternativa óbvia — contar também por IP e bloquear quem insiste, em vez da
empresa — foi considerada e **rejeitada por incompatibilidade com o domínio**. O
`CONTEXT.md` registra que o Email de Recuperação "pode ser compartilhado por
mais de um CNPJ": um mesmo escritório opera em nome de várias empresas, e um
escritório é um endereço de rede. Contar por IP faria as tentativas de um cliente
bloquearem o login de outro — a mesma contaminação cruzada que a migration `183`
introduziu ao apagar as letras do CNPJ alfanumérico do hash, apenas por uma chave
diferente. A unidade de acesso do Portal é o CNPJ; a chave do rate limit
acompanha a unidade de acesso.

Aceita-se, portanto, que **o dono de um CNPJ possa ser trancado por tentativas
que não são dele**. Três coisas tornam o preço suportável, e são parte da
decisão:

1. A janela é curta — 15 minutos, não escalonada.
2. O bloqueio abre alerta `portal_abuso_login` para o operador, com deduplicação
   por cliente (`portal-login/index.ts`), então o abuso é visível a quem pode
   agir.
3. O bloqueio não distingue conta existente de inexistente, então não vira
   oráculo de enumeração (ADR
   [0013](./0013-portal-auth-identificador-resolvido-e-excecao-anon.md) e achado
   3.2 da auditoria `security-audit-portal-2026-08-12`).

O atraso progressivo por tentativa, em vez do bloqueio, também foi considerado e
rejeitado: ele nunca tranca o dono, mas só encarece o chute de quem espera a
resposta. Um atacante que dispare pedidos em paralelo não espera, e continua
chutando na mesma taxa. Troca uma proteção real por uma aparente.

O balde de tentativas continua existindo e contando **todo** pedido, inclusive os
que resultam em envio. Contar só os pedidos sem conta transformaria o próprio
bloqueio em oráculo — "este CNPJ nunca trava, logo tem conta".

**Decorrência ainda não implementada.** Como a chave não pode distinguir quem
pede, o teto de *envio de email* precisa deixar de ser o mesmo teto de *pedidos*
— caso contrário a recuperação segue sendo um canal de envio por conta alheia.
O mecanismo acordado é reusar o convite vivo em vez de criar outro, e está
especificado na Task 7 do plano
`docs/plans/2026-08-14-rate-limit-portal-normalizador-compartilhado.md`. Esta
ADR **não** descreve comportamento atual nesse ponto; receberá nota editorial
quando a mudança entrar.

## Consequências

- O comportamento sob abuso passa a estar escrito: o dono espera 15 minutos e o
  operador recebe alerta. Deixa de ser lacuna e passa a ser preço conhecido.
- Enquanto a Task 7 não entrar, a recuperação continua enviando um email por
  pedido: até 480 por dia à caixa de um cliente, com o remetente do Portal. A
  decisão de aceitar a chave por CNPJ **cria** essa pendência, e por isso ela
  fica nomeada aqui em vez de ficar só no plano.
- Se um dia o Portal ganhar outro identificador de acesso, esta decisão precisa
  ser revista: ela vale enquanto o CNPJ for a unidade de acesso.
- A decisão não cobre a assimetria de tempo do caminho bloqueado do login, em
  que a existência da conta muda o número de consultas antes da resposta; está
  registrada no plano
  `docs/plans/2026-08-14-rate-limit-portal-normalizador-compartilhado.md`.

## Relação com outras decisões

Apoia-se na [0013](./0013-portal-auth-identificador-resolvido-e-excecao-anon.md)
quanto ao CNPJ ser o único identificador de login, e na
[0019](./0019-politica-de-senha-e-signup-fechado.md) quanto ao acesso por
convite. Não altera a
[0004](./0004-supabase-rls-rpc-fronteira-seguranca.md): a contagem continua no
banco, atrás de funções `SECURITY DEFINER` inacessíveis a `anon`.

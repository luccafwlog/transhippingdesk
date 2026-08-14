# 0048 — Confirmação do Email de Recuperação em rota pública

Status: aceito — 2026-08-14

## Contexto

A troca do Email de Recuperação do Portal tem dois passos. No **pedido**
(`portal-recovery-email-change`, `action: 'request'`) o cliente autenticado
informa a senha atual e o endereço novo; a função verifica a senha contra o Auth,
grava `pending_recovery_email`, emite um convite de uso único
(`purpose: 'confirmacao_email'`, 48 horas), manda o link para o endereço novo e
avisa o endereço antigo. Na **confirmação** (`action: 'confirm'`) o token é
consumido, `recovery_email` passa a valer e as sessões do Portal são encerradas.

O link da confirmação apontava para `/portal/perfil?confirm_email=<token>`, rota
protegida por `PortalProtectedRoute`. Quem abrisse o link sem sessão ativa era
redirecionado para `/portal/login` — e o guard navega com
`<Navigate to="/portal/login" replace />`, sem preservar a query string. O token
era descartado em silêncio: nenhum erro visível, nenhum consumo do convite, e
nenhuma forma de retomar depois do login, que sempre cai em `/portal`.

Isso atingia justamente o destinatário previsto. O Email de Recuperação, pelo
`CONTEXT.md`, "pode ser compartilhado por mais de um CNPJ" e costuma ser o
contato financeiro — que não é, necessariamente, quem tem a senha do Portal. Na
prática a confirmação exigia que o leitor da caixa nova também fosse o detentor
das credenciais.

Os outros dois fluxos por token do Portal — `/portal/ativar` e
`/portal/recuperar-senha` — já eram rotas públicas. A confirmação de email era a
única exceção, e a exceção não vinha de uma decisão registrada.

## Decisão

A confirmação passa a viver em **`/portal/confirmar-email`, rota pública**, no
mesmo padrão de `/portal/ativar` e `/portal/recuperar-senha`.

A autorização da troca permanece inteiramente no **pedido**, que continua
exigindo sessão ativa **e** senha atual. O que a confirmação prova é outra
coisa: **posse da caixa de email nova** — e o token de uso único é exatamente
essa prova. Exigir sessão outra vez não acrescentava barreira contra um
atacante, porque quem chega ao link já precisa ler a caixa nova, e a troca já
foi autorizada por quem tinha senha e sessão. A exigência só barrava o
destinatário legítimo.

A página remove o token da barra de endereços assim que o lê, no mesmo racional
do achado 3.3 da auditoria `security-audit-portal-2026-08-12`, e aceita tanto
`token` quanto `confirm_email`. `PortalProfile` mantém o tratamento do parâmetro
antigo enquanto os convites já enviados para o caminho anterior não expiram
(48 horas); os dois ramos podem sair depois dessa janela.

O restante do contrato não muda: o convite continua de uso único com validade de
48 horas, o endereço anterior continua valendo até a confirmação, o endereço
antigo continua sendo avisado no pedido, e a confirmação continua encerrando as
sessões do Portal.

## Consequências

- O leitor do Email de Recuperação confirma a troca sem precisar da senha do
  Portal, que é o comportamento que o fluxo sempre pretendeu ter.
- Os três fluxos por token do Portal passam a ter a mesma forma: rota pública,
  token na query string, token removido da URL após a leitura. Não há mais
  exceção a explicar.
- A superfície pública cresce em uma rota que **escreve** (`recovery_email`) e
  **revoga sessões**. O que a protege é o token: 32 bytes aleatórios, hash
  armazenado, uso único, 48 horas, invalidado por reenvio. É o mesmo material
  que já protege `/portal/recuperar-senha`, que troca senha.
- A URL de confirmação está gravada em emails já entregues. Mudá-la de novo
  quebra links em trânsito; qualquer alteração futura precisa manter o caminho
  anterior vivo por pelo menos 48 horas.
- A decisão não cobre a trava de tentativas do `action: 'request'`, hoje
  inexistente; ela está registrada no plano
  `docs/plans/2026-08-14-rate-limit-portal-normalizador-compartilhado.md`.

## Alternativas consideradas

- **Manter a rota protegida e preservar o destino no redirecionamento.**
  Guardaria a URL pretendida e devolveria a pessoa a ela depois do login.
  Resolve a perda do token, mas mantém a exigência que não protege nada e que
  bloqueia o contato financeiro sem senha. Rejeitada por conservar o custo sem
  o benefício.
- **Deixar como estava.** Rejeitada: a falha era silenciosa, e "peça a troca de
  novo" não conserta um fluxo que falha do mesmo jeito na segunda tentativa.

## Relação com outras decisões

Estende a [0013](./0013-portal-auth-identificador-resolvido-e-excecao-anon.md)
quanto ao que autentica cada passo do Portal e a
[0019](./0019-politica-de-senha-e-signup-fechado.md) quanto ao provisionamento
por convite. Não altera a [0004](./0004-supabase-rls-rpc-fronteira-seguranca.md):
a fronteira de dados continua na Edge Function e no banco, não na rota.

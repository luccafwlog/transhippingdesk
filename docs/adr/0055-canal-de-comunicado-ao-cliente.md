# ADR 0055 — Canal de Comunicado ao Cliente, separado do email transacional do Portal

Status: aceito — 2026-08-27

## Contexto

Em 2026-06-24 verificou-se em produção que a Edge Function
`notify-invoice-issued` não tinha Database Webhook configurado nem
`RESEND_API_KEY` provisionado, e ficou registrado em `docs/RASTREABILIDADE.md`
e `docs/ARCHITECTURE.md` que **o projeto não envia email a clientes** — a
notificação ao cliente seria in-app, pelo gatilho `trg_notify_invoice_issued`.

A issue #556 reverte essa premissa: a agência precisa comunicar chegada,
atracação, avisos operacionais, comunicados institucionais e cobranças por
e-mail, hoje enviados individualmente fora do sistema.

Existe mecânica de envio madura no projeto, mas acoplada ao Portal:
`supabase/functions/_shared/portalEmail.ts` fixa um conjunto fechado de tipos,
grava em `portal_email_attempts`, consulta `portal_suppressed_emails` e sai por
`PORTAL_FROM_EMAIL`. Existe ainda um terceiro caminho, a Resend crua dentro da
própria `notify-invoice-issued`, sem idempotência, supressão ou registro de
tentativa.

## Decisão

- O projeto **volta a enviar e-mail a clientes**, por um canal novo: o
  Comunicado ao Cliente.
- O canal é **separado** do email transacional do Portal em três eixos: lista
  de supressão própria, trilha de tentativas própria e chave de envio própria.
- O canal **compartilha** com o Portal a mecânica de envio, o remetente
  `portal@` e a identidade visual. O cliente não deve perceber duas entidades.
- A mecânica de envio — Resend, idempotência, retry com backoff, registro de
  tentativa — é extraída de `portalEmail.ts` para um módulo compartilhado;
  `portalEmail.ts` passa a ser consumidor dele, não dono.
- O destinatário é o **Email de Contato** (`customer_contacts`), nunca o Email
  de Recuperação do Portal.
- A `notify-invoice-issued` é **apagada** quando o comunicado financeiro
  entrar. Até lá permanece desligada e documentada como tal.

## Consequências

Um endereço suprimido por bounce num Convite do Portal continua recebendo Aviso
de Chegada, e um endereço suprimido por bounce num Comunicado continua podendo
receber convite. Isso é deliberado: supressão de acesso e supressão de
entregabilidade operacional são decisões distintas, e fundi-las faria um cliente
perder aviso de navio por causa de um convite marcado como spam meses antes.

O projeto passa de três caminhos de e-mail para um só mecanismo com dois
consumidores. O histórico por cliente fica legível, porque convite de Portal não
polui a leitura de "o que comunicamos a este cliente".

Esta decisão reverte a nota de 2026-06-24 registrada em
`docs/RASTREABILIDADE.md` e `docs/ARCHITECTURE.md`, ambas corrigidas no mesmo
change. Não altera a ADR 0018 nem a 0019 (convite do Portal), que continuam
regendo o canal transacional. Especificação funcional em
[`../spec/2026-08-27-comunicacao-email-clientes-design.md`](../spec/2026-08-27-comunicacao-email-clientes-design.md).

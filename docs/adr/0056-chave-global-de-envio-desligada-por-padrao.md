# ADR 0056 — Chave global de envio de Comunicados, desligada por padrão

Status: aceito — 2026-08-27

## Contexto

O canal de Comunicado ao Cliente (ADR 0055) envia e-mail em massa a clientes
reais, a partir de uma tela operada por três perfis internos. O sistema está em
desenvolvimento e teste, e um disparo indevido é irreversível.

O projeto não tem tabela de configuração global: não existe hoje um lugar onde
uma chave desse tipo possa morar.

## Decisão

- Existe **uma** chave que habilita ou silencia todo o canal de Comunicado.
- A chave nasce **desligada**. Ligar é ato deliberado do perfil
  `administrativo`, registrado em `audit_logs`.
- O escopo é **todo** o canal — manual e automático. Não há meio-termo que
  deixe o disparo manual passar.
- A chave **não afeta** o email transacional do Portal: convite, reenvio,
  recuperação de senha e alteração de email continuam saindo normalmente.
- Com a chave desligada, a tela de Comunicação **funciona inteira** — filtros,
  recorte, conferência, prévia — e o disparo é registrado como **simulado**, com
  essa marca visível no histórico, em vez de enviado.
- Enquanto desligada, a tela exibe faixa permanente informando o estado.

## Consequências

O estado seguro é o estado inicial: um deploy novo, um ambiente novo ou uma
restauração nascem sem capacidade de enviar e-mail a cliente. A capacidade só
aparece por decisão registrada de alguém.

O registro simulado permite validar o fluxo completo — recorte, preferências,
conferência, idempotência, histórico — sem tocar em cliente real, o que é
exatamente o que o desenvolvimento precisa. Em troca, o histórico passa a
conter comunicados que nunca saíram; eles são marcados, e qualquer leitura
precisa distinguir enviado de simulado.

A faixa permanente é requisito, não enfeite: um operador que confere quarenta
destinatários, clica em enviar e acredita ter enviado é pior desfecho do que a
tela não existir.

Restringir o escopo ao envio automático foi considerado e descartado: durante o
desenvolvimento, é justamente o disparo manual que alguém aciona por engano.
Especificação funcional em
[`../spec/2026-08-27-comunicacao-email-clientes-design.md`](../spec/2026-08-27-comunicacao-email-clientes-design.md).

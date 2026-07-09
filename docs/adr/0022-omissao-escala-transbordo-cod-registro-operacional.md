# ADR 0022: Omissao de Escala, Transbordo e COD como Registro Operacional

Status: aceito

Data: 2026-07-09

## Contexto

O armador pode omitir uma escala prevista, descarregar a carga em outro POD e
seguir com transbordo por navio de terceiro. Em alguns B/Ls, a excecao vira COD
(Change of Destination), alterando o destino final para o porto de descarga.

Esse evento precisa aparecer na operacao e no Portal, mas nao deve automatizar
CE Mercante, taxas, demurrage ou outros efeitos financeiros.

## Decisao

- Registrar a omissao no grao escala em `voyage_omissions`.
- Registrar a disposicao por B/L em `bl_transshipments`, com `transshipment`
  como padrao e `cod` como excecao.
- Tratar o navio de transbordo como referencia leve, nao como uma nova Viagem.
- Diferenciar omissao de exclusao: `deleted` remove um POD do planejamento;
  `omitted` preserva a escala como evento operacional rastreavel.
- Excluir PODs omitidos de `getProximaEscala`, da conclusao automatica da viagem
  e da RPC `portal_ship_schedule`.
- Expor o evento ao Portal por `portal_notifications.type='transshipment'`, sem
  dar acesso direto do Portal as tabelas internas.
- Notificar a omissao da escala no primeiro momento para todos os B/Ls afetados;
  se um B/L virar COD depois, ele recebe nova notificacao especifica de destino.

## Consequencias

Financeiro, CE Mercante, taxas e demurrage seguem manuais. COD atualiza
`bls.pod` por RPC auditada; reverter para transbordo restaura o POD original da
omissao. O fluxo depende de RPCs `SECURITY DEFINER` com `auth.uid()`,
`is_active_user()` e `changed_by=auth.uid()`.

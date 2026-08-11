# 0042 — CE Mercante confirma o cálculo em todos os modos

Status: aceito — 2026-08-10

## Contexto

O CE Mercante já confirmava o cálculo e a emissão automática para B/Ls de
container. Granito mantinha um caminho separado: calculava taxas e dependia do
clique manual de “Marcar pronto p/ faturar”. A operação confirmou que carga de
exportação emite CE Mercante, exceto Embarque de Vazios.

## Decisão

1. `granite_bls.ce_mercante` é obrigatório para faturar Granito e é persistido
   pelo mesmo import de CE usado pelos demais B/Ls.
2. A relação CE × B/L é 1:1. Um índice único parcial impede reutilização de CE
   preenchido e permite registros ainda sem CE.
3. O cadastro do CE recalcula e emite a invoice de Granito quando o cliente está
   vinculado. A emissão interna marca o B/L como `ready_for_billing`.
4. A fila de Validação classifica Granito sem CE como “Aguardando CE Mercante”.
   O lote não oferece mais a marcação manual como etapa normal; a exceção
   operacional é a emissão individual pelo botão “Emitir”, que continua
   exigindo CE, cliente, cálculo e o guard do workflow.
5. Embarque de Vazios não participa: é módulo de custo da agência e não gera
   invoice ou recebível de cliente.

## Consequências

Granito sem CE pode aguardar faturamento por mais tempo, mas segue a mesma
fronteira documental dos demais modos. O import de CE passa a ter destino
explícito (`bls` ou `granite`), resolve o número do B/L pela viagem selecionada,
audita a alteração via RPC e o campo é exposto no contrato gerado do banco.

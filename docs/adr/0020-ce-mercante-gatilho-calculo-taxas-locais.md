# 0020 — CE Mercante como gatilho do cálculo automático de Taxas Locais

Status: aceito — 2026-07-08

## Contexto

O cálculo automático de Taxas Locais de B/Ls de container é disparado hoje por
dois caminhos de import: o manifesto executa billing dentro da própria RPC
transacional do lote ([ADR 0005](./0005-pipeline-importacao-viagem-staging-reconciliacao.md),
[ADR 0006](./0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md))
e o Importar B/L tenta cálculo/emissão pós-commit para cliente reconciliado por
documento ([ADR 0017](./0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md)).

O motor de taxas divide cobranças por container entre os B/Ls que o
compartilham (`1/share_count` na base `container_distinct_voyage`). Essa divisão
só sai correta se **todos os B/Ls que compartilham o container já existirem no
sistema** no momento do cálculo. A realidade operacional derruba essa premissa
nos gatilhos atuais: os B/Ls de uma viagem chegam no mesmo dia, mas em
**uploads separados** — o primeiro B/L importado calcularia o container inteiro
(`share_count=1`) e, faturado, ficaria travado com cobrança 1,5× a taxa devida
quando o irmão chegasse.

A operação confirmou duas invariantes de negócio: (1) nenhuma taxa é calculada
ou faturada antes de o CE Mercante do B/L estar cadastrado; (2) o CE Mercante
só existe depois que o EDI do manifesto foi transmitido ao Mercante — momento
em que, por construção, todos os B/Ls da viagem já foram importados.

## Decisão

1. **O cadastro do CE Mercante é o gatilho único do cálculo automático de
   Taxas Locais para B/Ls de container.** Qualquer canal de cadastro de CE
   (planilha por linha, EDI de retorno do manifesto, edição na ficha do B/L)
   dispara o cálculo daquele B/L.

2. **Os imports deixam de calcular.** O import de manifesto não executa mais
   billing no lote, e o Importar B/L não tenta mais cálculo/emissão pós-commit.
   Importar passa a ser apenas ingestão de dados.

3. **Os gates existentes permanecem.** O gatilho por CE respeita reconciliação
   de cliente, review gate e holds ([ADR 0006](./0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md));
   CE cadastrado com gate pendente calcula quando o gate liberar, não antes.

4. **Fronteira: somente B/Ls de container.** Carga solta (breakbulk) mantém o
   cálculo pós-commit do seu import e o Granito mantém seu fluxo próprio — o
   problema motivador (divisão de container compartilhado) não existe nesses
   modos. Assimetria assumida deliberadamente para minimizar o diff.

5. **A proteção de faturamento do ADR 0017 continua como rede de segurança**
   para o caso residual de um B/L tardio compartilhar container com B/L já
   calculado/faturado (variável de faturamento → informar e exigir override
   auditado).

## Consequências

- Viagens com manifesto calculam taxas **mais tarde** do que hoje (no CE, não
  no import). Sem impacto real de faturamento: a operação já não fatura antes
  do CE.
- A divisão `1/share_count` de container compartilhado torna-se correta por
  construção na cadeia normal (importa tudo → gera EDI → Mercante devolve CE →
  calcula), eliminando a dependência da ordem de chegada dos uploads.
- Supersede parcialmente a 0005/0006 no aspecto "billing dentro da transação
  de import" e a 0017 no aspecto "cálculo/emissão automática pós-commit do
  Importar B/L".
- O ciclo do sistema alinha-se ao ciclo federal: o CE — que já condiciona a
  visibilidade no Portal do Cliente — passa a condicionar também o financeiro.

## Alternativas consideradas

- **Recalcular B/Ls irmãos não faturados quando um novo B/L compartilha
  container.** Corrige o `share_count` a posteriori, mas mantém cálculo precoce
  inútil (a operação não fatura antes do CE) e não resolve o irmão já faturado.
  Rejeitada em favor de não calcular cedo demais.
- **Apenas sinalizar o compartilhamento tardio ao operador.** Menor diff, mas
  depende de memória humana para evitar cobrança 1,5× da mesma taxa. Rejeitada.
- **Manter o billing no import do manifesto e mudar só o caminho do B/L.**
  Criaria dois gatilhos para a mesma regra e reabriria o problema quando um
  B/L de arquivo compartilha container com B/L nascido de manifesto. Rejeitada.

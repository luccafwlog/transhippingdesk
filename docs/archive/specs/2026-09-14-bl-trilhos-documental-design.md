# B/L — trilhos Operacional e Documental

**Status:** implementada e verificada
**Data:** 2026-09-14
**Escopo:** tela de detalhe do B/L, com foco no pipeline superior de estados

## Objetivo

Manter dois trilhos independentes na tela de detalhe do B/L:

1. **Operacional**, preservando a leitura e os marcos existentes.
2. **Documental**, mostrando somente os gates que explicam o que falta para o
   B/L avançar no cálculo, na emissão da fatura e na disponibilização no
   Portal.

O usuário deve conseguir responder rapidamente:

- o que já foi resolvido;
- qual pendência impede o próximo avanço;
- se a fatura existe, foi paga ou é consolidada;
- se o B/L está disponível para o cliente no Portal.

## Decisões aprovadas

### Dois trilhos

O trilho **Operacional** permanece com os marcos atuais:

`Saída do POL → Chegada ao POD → Descarga → Devolução`

O trilho hoje chamado **Financeiro** passa a se chamar **Documental**.

### Sem card independente de Revisão

“Revisão” não será usado como conceito visual. A palavra sugere uma tarefa
manual, enquanto o sistema precisa comunicar completude e bloqueios.

O estado agregado será apresentado no cabeçalho da linha Documental como:

- `Documental · Sem pendências`
- `Documental · 1 pendência`
- `Documental · N pendências`

As causas aparecerão nos cards responsáveis. Não haverá duplicação de uma
mesma pendência em um card genérico.

O campo interno legado `review_status` pode permanecer durante a transição,
mas não deve ser exposto com o rótulo “Revisão”. O estado canônico deverá ser
derivado da ausência ou presença de pendências documentais.

## Cards da linha Documental

### 1. Cliente

**Função:** informar se o B/L está vinculado a um cliente e se o cliente está
apto para o fluxo documental.

**Estados visíveis:**

- `Sem cliente vinculado`;
- `Pendente de reconciliação`;
- `Cliente vinculado`;
- `Cliente apto` — vínculo, e-mail e conta do Portal válidos.

Pendências de e-mail ou de provisionamento do Portal ficam neste card, pois
são problemas do cadastro/acesso do cliente, não de faturamento.

### 2. Taxas Locais

**Função:** informar se as taxas foram calculadas e se existe uma pendência
que impede o cálculo ou o faturamento.

**Estados visíveis:**

- `Não calculado`;
- `Calculado`;
- `Isento`;
- `Bloqueado` — sempre acompanhado da causa, por exemplo `Peso BB ausente`,
  `Tabela não encontrada` ou `Linha inválida`.

A interface não distinguirá cálculo automático de cálculo manual. Essa
origem continua disponível apenas para auditoria técnica, quando necessário.

### 3. CE Mercante

**Função:** informar se o documento obrigatório foi cadastrado.

**Regra aprovada:** o CE Mercante é obrigatório para **carga conteinerizada e
carga solta**.

**Estados visíveis:**

- `Cadastrado`;
- `Pendente · bloqueia emissão e Portal`.

O CE não deve ser tratado como “não aplicável” para carga solta.

### 4. Fatura

**Função:** concentrar emissão, pagamento e vínculo do B/L com uma fatura.

Não haverá um card separado de Pagamento.

**Estados aceitos:**

- `Não emitida`;
- `Rascunho`;
- `Emitida`;
- `Parcialmente paga`;
- `Paga`;
- `Coberta`;
- `Cancelada`;
- `Obsoleta`.

O estado `Vencida` e qualquer data/texto de vencimento ficam fora da tela,
pois não representam uma regra real do negócio.

Quando o B/L estiver em fatura consolidada, o card exibirá essa informação
explicitamente, por exemplo:

`#2048 · Paga · Consolidada`

ou

`#2048 · Emitida · Individual`.

## Indicadores complementares

### Carregamento

Pode aparecer como indicador complementar do Operacional, sem virar um novo
gate da linha. Os estados sugeridos são `Sem informação`, `Não iniciado`,
`Parcial` e `Concluído`.

O código atual do pipeline do B/L não possui uma fonte explícita de
carregamento. A implementação deve definir a fonte antes de derivar esse
estado; não se deve inferi-lo automaticamente a partir de descarga ou
devolução.

### Demurrage

Permanece como indicador/card opcional da Documental, exibido somente quando
existirem registros de demurrage para o B/L. É um fluxo financeiro auxiliar e
não deve bloquear a emissão da fatura comum.

Estados mínimos:

- `Pendente`;
- `Paga`.

Não usar vencimento da fatura comum para representar demurrage.

## Regra de avanço documental

O cálculo agregado de pendências deve mapear cada causa para um card visível:

| Causa | Card responsável |
|---|---|
| Cliente não vinculado | Cliente |
| Cliente sem e-mail | Cliente |
| Portal não provisionado | Cliente |
| Peso BB ausente | Taxas Locais |
| CE Mercante ausente | CE Mercante |
| Tabela ou linha de cálculo inválida | Taxas Locais |

Se uma nova regra documental for criada, ela precisa ser associada a um card
antes de entrar no cálculo de pendências. Isso evita que o cabeçalho mostre
uma pendência sem uma ação visível para resolvê-la.

## Faturamento automático

A emissão automática somente pode ocorrer quando todos os gates estiverem
resolvidos:

`Cliente apto → Taxas calculadas com valor faturável → CE cadastrado → emissão`

O CE Mercante deve bloquear a emissão para todos os modos de carga. A mesma
regra deve ser garantida no backend, e não apenas na tela, para impedir que
uma chamada manual ou alternativa emita o B/L sem CE.

O Portal deve continuar usando o mesmo gate universal: sem CE, o B/L não pode
ser listado, detalhado ou incluído em uma consolidação no Portal.

## Caso concreto

Um cenário já coberto pelo fluxo automatizado usa o B/L `BL1` com:

- cliente reconciliado;
- taxas calculadas no valor de R$ 100;
- CE Mercante ausente;
- nenhuma pendência de cliente.

A tela deve mostrar:

```text
Documental · 1 pendência documental

Cliente       Cliente apto
Taxas Locais  Calculado · R$ 100
CE Mercante   Pendente · bloqueia emissão e Portal
Fatura        Não emitida
```

O cabeçalho não deve chamar esse BL de “revisado”, porque isso não ajuda na
decisão. O que importa é que o cliente e as taxas estão resolvidos, mas o CE
é o próximo bloqueio.

Depois do cadastro do CE:

```text
CE Mercante   Cadastrado
Fatura        Emitida · #55
Portal        Disponível
```

O identificador `#55` é o resultado usado no teste automatizado do fluxo, não
um número de produção. O exemplo demonstra a transição real implementada:
calcular, validar os gates e emitir automaticamente.

## Ajustes técnicos esperados

1. Atualizar `buildFinancialRail` para produzir a linha Documental com os
   estados acima e sem o card Pagamento.
2. Retirar a dependência visual do rótulo `Revisão & Cliente` e exibir o
   contador/resumo `Pendências documentais` no cabeçalho.
3. Tornar o CE uma pré-condição de emissão para todos os `cargo_mode`, com
   validação no serviço e nas RPCs de faturamento.
4. Garantir que o gate do Portal e o gate de emissão usem a mesma regra de CE.
5. Fazer a leitura de faturas do detalhe considerar tanto `invoice_bls` quanto
   `invoice_receivable_links`, para identificar faturas consolidadas.
6. Excluir `overdue` e vencimento da apresentação da fatura.
7. Criar testes para pendências mapeadas, CE em carga solta, estados de fatura,
   fatura consolidada e regressão de uma pendência documental.

## Fora de escopo

- alterar a sequência ou a semântica dos marcos Operacionais existentes;
- distinguir cálculo automático de cálculo manual na interface;
- criar vencimento real para faturas;
- transformar Demurrage em pré-condição da fatura comum;
- criar uma nova fonte de dados de carregamento sem definição do contrato
  operacional.

## Critério de aceite de produto

Uma pessoa que abrir um B/L deve entender, sem conhecer os nomes internos dos
campos:

1. quais pendências documentais existem;
2. em qual card pode resolvê-las;
3. se o CE bloqueia emissão e Portal;
4. se a fatura está emitida/paga/consolidada;
5. que o trilho Operacional é independente dessa leitura.

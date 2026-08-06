# Revisão do motor de cálculo das Taxas Locais — inconsistências e políticas a decidir (6 ago 2026)

> Registro histórico. Segunda etapa da revisão iniciada na
> [auditoria de 5 ago 2026](2026-08-05-revisao-fluxo-taxas-locais-fatura.md),
> conduzida na branch `claude/bl-tax-calculation-flow-jwcczw`. Nenhuma linha de
> código foi alterada.
>
> A primeira auditoria respondeu **quando** as coisas acontecem. Esta responde
> **se o que acontece está certo** — olhando para dentro do motor de cálculo e
> perguntando, para cada regra, se ela é uma política adequada para um sistema
> que emite cobrança.
>
> Escrito para leitura de gestão. Cada afirmação foi verificada no código; o
> anexo final aponta arquivo e linha.

---

## Resumo executivo

Onze pontos. Nenhum deles é "o sistema está quebrado" — o motor funciona e
calcula. São pontos em que o sistema **decide sozinho algo que deveria ser uma
política declarada**, ou em que ele **erra em silêncio** em vez de parar e
avisar.

Ordenados por risco financeiro:

| # | Ponto | Risco | Natureza |
|---|---|---|---|
| 1 | Cobranças somem em silêncio quando a quantidade dá zero | **Alto** — subfaturamento invisível | Defeito |
| 2 | Container compartilhado pode ser cobrado duas vezes | **Alto** — sobrefaturamento | Lacuna entre ADR e código |
| 3 | Não existe histórico imutável do que foi cobrado | **Alto** — auditoria e contestação | Estrutural |
| 4 | A data que define o preço é a data de importação do B/L | Médio | Política implícita |
| 5 | Descontos de cliente com vigências sobrepostas | Médio | Falta de trava |
| 6 | Recálculo não é bloqueado depois de faturado | Médio | Inconsistência interna |
| 7 | Linhas em USD travam o faturamento para sempre | Médio | Funcionalidade ausente |
| 8 | Isenção automática de carga com veículos | Médio | Política escondida |
| 9 | Rateio de container compartilhado não fecha o centavo | Baixo | Arredondamento |
| 10 | A função de cálculo altera dado operacional | Baixo | Violação de fronteira |
| 11 | Não há como conferir o cálculo antes de ele virar fatura | **Alto** — validação impossível | Lacuna de fluxo |

---

## 1. Cobranças somem em silêncio quando a quantidade dá zero

### O que acontece

O motor percorre os itens da tabela de preços e, para cada um, calcula uma
quantidade. Se a quantidade der zero, ele **pula o item** — não gera linha, não
gera alerta, não marca o B/L para revisão. A cobrança simplesmente não existe, e
ninguém fica sabendo.

O motor **sabe** sinalizar problema: ele faz exatamente isso em três situações
(não existe tabela de preço para o POD; falta o peso da carga solta; container é
IMO e OOG ao mesmo tempo). Nesses três casos ele cria uma linha de
`revisão obrigatória` e segura o faturamento. O padrão existe — ele só não é
aplicado nos demais casos.

Três caminhos levam a esse desaparecimento silencioso:

**a) Item cadastrado com base de aplicação "TEU".**
O banco aceita `teu` como base de aplicação. A tela de cadastro de tabela de
preços **oferece "TEU" no seletor**. E o motor de cálculo **não tem tratamento
para TEU**. Resultado: um operador pode cadastrar hoje uma taxa por TEU, salvar
sem nenhum erro, e essa taxa nunca será cobrada de ninguém — sem qualquer aviso,
em nenhuma tela.

**b) Item THD cadastrado sem perfil de carga.**
Taxas do tipo THD são separadas por perfil (standard / IMO / OOG). Se o item for
salvo com o perfil no valor padrão do banco ("qualquer"), ele cai no caminho
"nenhum dos três" e a quantidade vira zero. A taxa desaparece.

**c) B/L de container ainda sem containers cadastrados.**
Todas as taxas por container somem, mas as taxas por B/L continuam gerando
linha. Como sobrou pelo menos uma linha, o sistema conclui `calculado` — e a
partir daí a cadeia automática descrita na primeira auditoria faz o resto:
promove, emite fatura e publica. **Uma fatura incompleta é emitida
automaticamente, sem ninguém olhar.**

### Por que importa

Em cobrança, o padrão seguro é: *"se eu não consigo calcular, eu paro e aviso"*.
Nunca *"se eu não consigo calcular, eu cobro zero"*. Um erro que gera valor a
mais aparece — o cliente reclama. Um erro que gera valor a menos não aparece
nunca: o cliente paga a fatura menor sem questionar, e a receita perdida não
deixa rastro em lugar nenhum do sistema.

### O que precisa ser decidido

Nada — este é o único ponto da lista que não depende de decisão de negócio. A
correção é técnica e tem modelo pronto dentro do próprio motor: trocar o "pula o
item" por uma linha de revisão obrigatória, igual à que já existe para peso
ausente. O caso do TEU tem uma decisão menor associada: implementar o cálculo
por TEU ou remover a opção do seletor.

---

## 2. Container compartilhado pode ser cobrado duas vezes

### O que acontece

Quando dois B/Ls dividem o mesmo container, cada um paga metade da taxa daquele
container. É por isso que a ADR 0020 mudou o gatilho do cálculo para o CE
Mercante: esperar o CE garante que todos os B/Ls da viagem já entraram, e o
rateio sai certo.

Mas e o B/L que chega **depois** que o irmão já foi calculado e faturado? A ADR
0020 declara, no item 5, que "a proteção de faturamento da ADR 0017 continua
como rede de segurança para o caso residual de um B/L tardio compartilhar
container com B/L já calculado/faturado".

**Essa rede de segurança não cobre esse caso.** Verificado no código: a análise
de impacto de faturamento no import — inclusive o aviso
*"Container(s) compartilhados com outro B/L afetados"* — só é executada quando o
B/L que está sendo importado **já existe no banco e já tem cobrança própria**.
Para um B/L **novo**, a análise nem roda. E não existe nenhum gatilho que
recalcule o B/L irmão quando um novo B/L entra no mesmo container.

Na prática:

1. B/L A é cadastrado, ganha CE, é calculado sozinho e **paga o container
   inteiro** (era o único que existia).
2. A fatura de A é emitida e publicada.
3. B/L B chega depois, no mesmo container. Importa sem aviso nenhum.
4. B ganha CE, é calculado e paga **metade** do container.
5. O armador cobrou **150% daquele container**. Nenhuma tela mostra isso.

### Por que importa

É o inverso do ponto 1: aqui o erro é a mais, então o cliente A eventualmente
contesta — mas contesta uma fatura já emitida, numerada e publicada no Portal, o
que significa cancelamento e reemissão (o único caminho de correção disponível,
conforme a primeira auditoria). O custo não é só o valor: é retrabalho e
credibilidade.

Também é um caso em que a documentação afirma uma proteção que não existe. Quem
lê a ADR 0020 conclui que o risco está coberto.

### O que precisa ser decidido

Qual das três saídas:

- **Recalcular o irmão automaticamente** quando um B/L novo entra em container
  já calculado. Resolve na origem, mas exige tratar o caso "irmão já faturado" —
  que cai no cancelamento/reemissão.
- **Estender o aviso do import** para olhar os irmãos de B/Ls novos, avisando o
  operador antes de gravar. Mais barato, mas depende do operador agir.
- **Relatório periódico de conciliação de rateio** — uma tela que lista
  containers cuja soma dos rateios cobrados ≠ 100%. Não previne, mas garante que
  nada fique invisível.

A ADR 0020 precisa ser corrigida em qualquer cenário, porque hoje ela descreve
uma proteção inexistente.

---

## 3. Não existe histórico imutável do que foi cobrado

### O que acontece

A tabela de preços guarda o valor de cada item, mas **não guarda vigência por
item**. Só a tabela como um todo tem período de validade — os itens dentro dela
são editados por cima. Alterar um preço reescreve o valor anterior; ele deixa de
existir.

Ao mesmo tempo, o detalhamento que o cliente vê na fatura **não é uma foto
guardada**: ele é montado ao vivo a partir das linhas de cálculo do B/L. E
recalcular um B/L **apaga e recria** essas linhas.

Combinando as duas coisas: se um B/L faturado em junho for recalculado hoje, as
linhas de junho somem e são recriadas com os preços de hoje. O valor total já
gravado na fatura não muda — mas o detalhamento que sustenta esse valor passa a
não bater com ele.

Existe uma tabela `pricing_rule_versions` no banco, mas o motor de cálculo nunca
a lê. Ela não é o mecanismo de versionamento — está sem uso.

### Por que importa

É o ponto mais sério estruturalmente, ainda que não seja o de maior perda
imediata. Um sistema que emite documento de cobrança precisa ser capaz de
responder, meses depois: *"em 12 de junho, esta taxa custava X, por esta regra"*.
Hoje o sistema não consegue — a informação foi sobrescrita.

Isso pesa em três momentos concretos: contestação de cliente, fechamento
contábil e auditoria externa.

### O que precisa ser decidido

Qual dos dois modelos:

- **Congelar a fatura na emissão**: gravar o detalhamento como dado próprio da
  fatura no momento em que ela é emitida, e nunca mais derivá-lo do cálculo. É o
  modelo mais comum e o mais simples de implementar.
- **Versionar a tarifa**: dar vigência a cada item de preço, de forma que
  qualquer recálculo com data retroativa reproduza o valor da época.

Não são excludentes, mas o primeiro resolve o problema de auditoria com muito
menos esforço.

---

## 4. A data que define o preço é a data de importação do B/L

### O que acontece

Para escolher qual tabela de preços aplicar e quais descontos do cliente valem,
o motor usa uma data de referência: a **data em que o B/L foi carregado no
sistema** (com a data de criação do registro como alternativa).

Consequências práticas:

- Se a tarifa muda no meio de uma viagem, **B/Ls da mesma viagem ficam com
  preços diferentes**, conforme o dia em que cada um foi importado.
- Reimportar um B/L pode **mudar o preço dele**.
- Um B/L importado com antecedência é precificado pela tarifa antiga, mesmo que
  o cálculo só ocorra semanas depois.

Desde a ADR 0020, o cálculo acontece no cadastro do CE Mercante. Ou seja: a data
que define o preço **não é a data da operação nem a data do cálculo** — é uma
terceira data, que é um detalhe administrativo de quando alguém subiu o arquivo.

### Por que importa

É difícil de explicar para um cliente que pergunta por que pagou um valor e o
vizinho, no mesmo navio, pagou outro. E é difícil de defender numa auditoria,
porque não corresponde a nenhum fato comercial.

### O que precisa ser decidido

Qual fato comercial deve fixar o preço. As opções razoáveis:

- data de importação do B/L (o que vale hoje);
- data de atracação / ETA da viagem — amarra a viagem inteira à mesma tarifa;
- data de cadastro do CE Mercante — coincide com o momento do cálculo;
- data de emissão da fatura.

Escolhida a regra, ela deve ficar registrada em ADR — hoje é uma escolha
implícita, sem documento que a sustente.

---

## 5. Descontos de cliente com vigências sobrepostas

### O que acontece

Descontos negociados por cliente (`customer_rate_overrides`) têm início e fim de
vigência, mas **não existe trava no banco impedindo dois descontos sobrepostos**
para o mesmo cliente e o mesmo item. Só existe um índice de busca, não uma
restrição.

Quando há sobreposição, o motor aplica `o mais recentemente cadastrado` — não o
mais específico, nem o de vigência mais recente. Quem foi digitado por último
ganha.

### Por que importa

O valor cobrado passa a depender da ordem de digitação, que é invisível na tela.
Dois usuários cadastrando condições comerciais em paralelo podem produzir um
preço que nenhum dos dois pretendeu, e não há nada que sinalize a sobreposição.

### O que precisa ser decidido

Se a política é "não pode haver sobreposição" (recomendado — o banco passa a
recusar o cadastro conflitante) ou "pode haver, e o critério de desempate é X"
(aí o critério precisa ser explícito e visível na tela).

---

## 6. Recálculo não é bloqueado depois de faturado

### O que acontece

O sistema já tem uma trava para isso — no lugar errado. Lançamentos manuais de
cobrança são bloqueados quando o B/L está `faturado`, `parcialmente pago` ou
`pago`. Mas o **recálculo automático não tem trava nenhuma**: ele apaga e recria
as linhas automáticas independentemente do estado financeiro do B/L.

### Por que importa

Duas funções vizinhas, mesmo tipo de operação, políticas opostas. Quem lê o
código conclui que a operação é protegida, e não é. É também o mecanismo que
concretiza o problema do ponto 3: o recálculo é o que faz o detalhamento
divergir do total da fatura.

### O que precisa ser decidido

Nada de negócio — a política já está declarada na trava que existe. É estender a
mesma regra à função de recálculo. (A primeira auditoria já registrou o
princípio: correção depois de emitida se faz por cancelamento e reemissão, não
por edição.)

---

## 7. Linhas em USD travam o faturamento para sempre

### O que acontece

Se um item da tabela de taxas locais estiver em dólar, o motor gera a linha em
USD e grava um impedimento no B/L: *"Linhas em USD exigem ajuste manual antes do
faturamento"*. Só que **não existe nenhum caminho de conversão de câmbio para
taxas locais** — diferentemente do demurrage, que tem o seu próprio.

Resultado: o impedimento não tem como ser resolvido pela tela. O B/L fica preso.

### Por que importa

É uma configuração que a tela permite fazer e o sistema não permite concluir. O
operador cadastra uma taxa em dólar de boa-fé e produz B/Ls que nunca faturam,
sem entender por quê.

### O que precisa ser decidido

Se taxas locais em USD são um caso real da operação. Se sim, implementar o
câmbio (ROE) para taxas locais. Se não, **bloquear o cadastro de item em USD na
tabela de taxas locais** — mais barato e elimina a armadilha.

---

## 8. Isenção automática de carga com veículos

### O que acontece

Se um B/L de container tiver pelo menos um veículo registrado, o motor de
cálculo o marca como **isento de taxas locais**, com a justificativa "carga de
veículos / LCL com taxas pagas na origem". Nenhuma taxa é cobrada.

Essa é uma decisão comercial de peso — isenção total de um processo — e ela vive
dentro da função de cálculo, acionada por um dado operacional (existir linha de
veículo), sem passar por aprovação de ninguém.

### Por que importa

A regra pode estar perfeitamente correta como política. O problema é onde ela
mora: um dado operacional cadastrado por qualquer usuário passa a zerar a
cobrança de um processo inteiro, automaticamente. Não há tela que liste os B/Ls
isentos por esse motivo para conferência.

### O que precisa ser decidido

Confirmar com o comercial que a regra está certa (todo B/L com veículo é isento,
sem exceção?) e, independentemente da resposta, criar visibilidade: uma listagem
de isenções aplicadas, para que a isenção seja uma decisão observável e não um
efeito colateral.

---

## 9. Rateio de container compartilhado não fecha o centavo

### O que acontece

O rateio é `1 dividido pelo número de B/Ls`, com seis casas decimais, e cada
linha é arredondada para dois. Três B/Ls num container: 0,333333 cada. Numa taxa
de R$ 100,00 → R$ 33,33 × 3 = **R$ 99,99**.

Falta um centavo por container compartilhado, por item de taxa.

### Por que importa

O valor é irrelevante. O que não é irrelevante é que **a soma das partes não
fecha o todo** — o que aparece quando um cliente ou um auditor confere a conta
do container.

### O que precisa ser decidido

Se vale corrigir. A solução usual é atribuir a diferença de arredondamento ao
último rateio. É melhoria de acabamento, não urgência.

---

## 10. A função de cálculo altera dado operacional

### O que acontece

Ao detectar veículos num B/L de container, a função de cálculo **grava**
`LCL` no tipo de carregamento do B/L — que é um campo operacional, não
financeiro. E não desfaz: se os veículos forem removidos depois, o B/L volta a
ser cobrado normalmente, mas continua marcado como LCL para sempre.

### Por que importa

Uma função de precificação escrevendo em campo operacional quebra a fronteira
entre os módulos: o dado operacional deixa de ser confiável como registro do que
foi operado. É pequeno hoje, mas é o tipo de acoplamento que produz bug difícil
de rastrear depois.

### O que precisa ser decidido

Nada de negócio. Ou o cálculo apenas **lê** o campo (e quem o define é o fluxo
operacional), ou a escrita é revertida quando a condição deixa de valer.

---

## 11. Não há como conferir o cálculo antes de ele virar fatura

> Achado levantado na sessão de desenho do mesmo dia, não na leitura de código
> que produziu os dez anteriores. Registrado aqui para a lista ficar completa.

### O que acontece

Cadastrar o CE Mercante dispara, em cadeia e sem parada, quatro coisas: calcular
as taxas, promover o B/L a pronto para faturar, emitir a fatura numerada e
publicá-la no Portal. Antes do CE, para B/L de container, **não existe cálculo
nenhum** — `tryAutoIssueInvoice` recusa explicitamente:

```ts
if ((cargoMode === 'container' || cargoMode === '') && !ceMercante) {
  return { status: 'blocked', message: 'Aguardando cadastro do CE Mercante para calcular taxas (ADR 0020).' }
}
```

Consequência: **não há momento algum em que o operador possa olhar o cálculo e
dizer se está certo.** Antes do CE não há número. Depois do CE já há fatura
emitida e publicada. A "validação prévia" que o fluxo pressupõe não tem onde
acontecer.

### Por que importa

É a lacuna que motivou toda esta revisão. Os dez achados anteriores descrevem
maneiras de o cálculo sair errado; este descreve por que ninguém percebe. Sem
ponto de conferência, cada um dos outros dez chega ao cliente como fatura.

Também explica por que a aba Validação de `/faturamento` parece deslocada
(diagnóstico no plano de consolidação das abas): ela promete uma conferência
que, no caminho normal, não tem como ocorrer.

### O que precisa ser decidido

Se o cálculo passa a existir antes do CE — provisório, conferível, não
faturável — com o CE assumindo o papel de confirmar e emitir. **Decidido em
2026-08-06: sim.** Registro na ADR 0038, decisão 8.

---

## Leitura de conjunto

Os dez pontos não são independentes — três padrões os atravessam:

**O sistema erra para baixo em silêncio e para cima com alarde.** Os pontos 1, 2
e 8 têm o mesmo formato: quando o motor não consegue ou não deve cobrar, ele
resolve sozinho e segue. Como a cadeia posterior é automática (ADR 0020), esse
"resolver sozinho" vira fatura emitida e publicada sem revisão humana. A primeira
auditoria já havia registrado a ausência de checkpoint obrigatório; estes
achados mostram **o que exatamente passa por essa ausência**.

**O que foi cobrado não é um fato guardado.** Pontos 3, 4 e 6 convergem: preço,
data de referência e detalhamento são todos recalculáveis a qualquer momento.
Para um sistema de cobrança, o momento da emissão deveria congelar tudo.

**Há políticas comerciais escondidas em código.** Pontos 4, 5 e 8 são decisões
de negócio reais (que data fixa o preço, qual desconto vence, quem é isento) que
hoje só existem como implementação. Não estão em ADR, não estão em tela, e
ninguém fora do código pode conferi-las.

Nenhum dos dez exige parar a operação. Mas os pontos 1, 2 e 3 deveriam entrar em
fila de correção antes de qualquer nova funcionalidade de faturamento — os dois
primeiros porque produzem valor errado hoje, o terceiro porque quanto mais tempo
passa, mais histórico fica sem lastro.

---

## Anexo — evidências

Motor de cálculo — `supabase/migrations/151_guard_definer_rpcs_active_user.sql`,
função `calculate_bl_local_charges`:

| Achado | Onde |
|---|---|
| Data de referência (ponto 4) | linha ~80, `v_ref_date := COALESCE(uploaded_at, created_at, CURRENT_DATE)` |
| Escrita de `container_load_type` (ponto 10) | linhas 93–98 |
| Isenção por veículos (ponto 8) | linhas 100–110 |
| Rateio `1/share_count` (pontos 2 e 9) | linhas 168–199 |
| Desempate de desconto por `created_at` (ponto 5) | bloco `LEFT JOIN LATERAL ... ORDER BY cro.created_at DESC LIMIT 1` |
| Revisões que o motor **sabe** gerar | `review:no_table` (l. 149), `review:weight_missing` (l. 259), `review:imo_oog_thd` (l. 202) |
| Falta de tratamento para `teu` (ponto 1a) | linhas 255–300 — só `bl`, `weight_ton`, `container_distinct_voyage` |
| Perfil THD sem correspondência (ponto 1b) | linha 292, `ELSE v_qty := 0` |
| Descarte silencioso (ponto 1) | linhas 302–304, `IF COALESCE(v_qty,0) <= 0 THEN CONTINUE` |
| Status final `calculated` com linhas faltando (ponto 1c) | linhas 361–376 |
| Impedimento de USD sem saída (ponto 7) | bloco `billing_hold_reason`, linha ~385 |
| Ausência de trava por `financial_status` (ponto 6) | a função não referencia `financial_status` |

Demais evidências:

| Achado | Onde |
|---|---|
| `teu` aceito pelo banco (ponto 1a) | `supabase/migrations/016_local_charges_stage_a.sql`, CHECK de `application_basis` |
| `teu` oferecido na tela (ponto 1a) | `src/components/taxasLocais/ChargeTableItemFormCard.tsx:96` |
| `cargo_profile` padrão `'any'` (ponto 1b) | `supabase/migrations/016_local_charges_stage_a.sql` |
| Itens de tarifa sem vigência (ponto 3) | `016_local_charges_stage_a.sql` — nenhuma coluna de vigência em `charge_table_items` |
| `pricing_rule_versions` sem uso (ponto 3) | não referenciada por nenhuma função de cálculo |
| Recálculo apaga linhas automáticas (ponto 3) | `151_...sql`, linhas 85–88 |
| Rede de segurança só para B/L já faturado (ponto 2) | `src/services/blFreightImport.ts:245` — `const billed = billingLockedBlIds.has(doc.blNumber)`; impacto só é computado com `existing && billed` |
| Aviso de container compartilhado (ponto 2) | `src/services/blFreightImport.ts:456–480`, `computeBillingImpact` |
| Ausência de gatilho de recálculo de irmãos (ponto 2) | nenhum trigger de recálculo em `bl_containers` |
| Sem restrição de sobreposição de descontos (ponto 5) | `016_local_charges_stage_a.sql:215` — apenas índice |
| Trava de lançamento manual que o recálculo não tem (ponto 6) | `supabase/migrations/108_guard_manual_charges_and_clear_pix_on_reversal.sql` |
| Afirmação a corrigir (ponto 2) | `docs/adr/0020-ce-mercante-gatilho-calculo-taxas-locais.md`, item 5 |

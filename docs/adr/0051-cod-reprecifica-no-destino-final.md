# 0051 — COD reprecifica a Taxa Local no destino final, com ajuste financeiro registrado

Status: aceito — 2026-08-18

Supersede parcialmente a [ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md),
decisão 1.

## Contexto

A [ADR 0022](./0022-omissao-escala-transbordo-cod-registro-operacional.md)
registrou Omissão de Escala, Transbordo e COD como evento operacional, deixando
o financeiro manual. A [ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md)
foi além e declarou, na decisão 1, que o fato gerador da Taxa Local é a emissão
do CE Mercante e que **COD não altera a taxa**: "no COD o cliente retira em
outro porto por conveniência própria e o desvio é ônus operacional do armador".

A [revisão de 2026-08-18](../archive/audits/2026-08-18-revisao-transbordo-cod.md)
confrontou essa regra com a operação e com o código, e encontrou duas coisas.

**A regra estava errada.** A Taxa Local é cobrança de chegada no destino final.
O COD muda o destino final. Logo a taxa devida passa a ser a do novo destino —
não por conveniência de cálculo, mas porque é o mesmo princípio que já governa o
transbordo, onde o destino final é preservado e a taxa não muda.

**E ela não estava sendo aplicada de qualquer forma.** `set_bl_cod` reescreve
`bls.pod`, e `calculate_bl_local_charges` resolve a tabela de taxas por
`bls.pod`. Como nada no fluxo de COD dispara recálculo, o resultado dependia de
o B/L ser tocado depois ou não: sem toque, a taxa ficava no porto antigo; com
uma reimportação qualquer, migrava sozinha. O mesmo COD produzia dois
resultados financeiros diferentes.

Não há CODs nem transbordos em produção, então nenhuma cobrança já emitida
depende da regra anterior.

## Decisão

**1. A Taxa Local é devida no destino final do B/L.** COD reprecifica; Omissão
de Escala e Transbordo não, porque neles o destino final é preservado — a carga
segue por navio de terceiro até o POD original. A frase da ADR 0038 decisão 1
sobre "porto declarado no CE" fica sem efeito: o CE Mercante é o **fato
gerador** da cobrança, não o seletor do preço, e o schema nunca vinculou um CE a
um porto (`bls.ce_mercante` é `TEXT` livre).

**2. A reprecificação acontece no ato do COD, com forma definida pelo estado
financeiro do B/L:**

| Estado | Comportamento |
|---|---|
| Não faturado | Recalcula na própria transação do COD. |
| Faturado, não pago | O COD registra a pendência de cancelar e reemitir pela tabela do novo destino; o Financeiro executa. Nenhum dinheiro trocou de mãos; corrige-se o documento. |
| Faturado e pago (total ou parcial) | A fatura original permanece. A diferença vira **Ajuste de COD**: Fatura Complementar de COD quando falta valor, restituição (`invoice_refunds`) quando sobra. |

A fronteira é o pagamento: **antes dele corrige-se o documento; depois dele
ajusta-se a diferença.** Cancelar documento fiscal já quitado seria o caminho
mais sujo, e é o que a migration `108` já tenta impedir ao bloquear edição de
linha de fatura com pagamento.

**3. O COD calcula e registra a diferença; a emissão do ajuste é ato do
Financeiro.** Quem marca COD é Documentação. Emitir fatura complementar e
liberar restituição são atos deliberados, coerentes com a ADR 0007 (ciclo de
vida da invoice) e a ADR 0009 (bloqueios fiscais). O número existe e é auditável
no instante do COD; o documento sai depois, por outra pessoa.

**4. Reverter COD para transbordo é simétrico** — restaura o destino final
original e reprecifica pelas mesmas regras da decisão 2. Assimetria produziria o
pior defeito possível: taxa de um porto num B/L cujo destino é outro, sem sinal
na tela.

**5. COD é ato deliberado com justificativa.** Exige confirmação explícita e
justificativa do operador, gravada em `audit_logs` — não a literal fixa que a
RPC gravava. O COD deixou de ser só registro operacional: ele é o gatilho
financeiro do desvio.

**6. O CE Mercante do B/L nunca muda; a participação em manifesto muda.** O
número do CE individual é do conhecimento e permanece em qualquer hipótese. O
CE Master (manifesto) também não muda de identidade nem de número — mas um B/L
em COD **deixa o manifesto do porto omitido e passa a constar no manifesto do
novo destino**. Se essa rota ainda não existir na viagem, ela nasce sem
manifesto e o pendente fica visível até alguém informar o número.

## Consequências

- A decisão 1 da ADR 0038 deixa de valer. As decisões 2 (congelamento na
  emissão), 4 e 5 permanecem, assim como a decisão 3 na redação que a
  [ADR 0040](./0040-vigencia-da-tabela-de-taxas-e-informativa.md) lhe deu.
- O verbete **COD** do `CONTEXT.md` foi reescrito, e **Ajuste de COD** entrou
  como termo novo.
- A ADR 0022 continua válida no que decidiu: omissão distinta de exclusão,
  navio de transbordo como referência leve, disposição individual por B/L. O que
  muda é a frase "mantém efeitos financeiros manuais" — o efeito da Taxa Local
  passa a ser calculado; CE Mercante e Demurrage seguem manuais.
- Demurrage não é afetado: `demurrageRates.ts` não consulta `bls.pod` para
  resolver tarifa ou free time.
- Sem CODs em produção, não há backfill nem reprecificação retroativa.
- Promover o **manifesto a entidade própria** — para suportar cancelar um
  manifesto e consolidar seus CEs em outro — fica fora desta decisão e exige
  desenho próprio.

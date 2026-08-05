# Revisão do fluxo de Taxas Locais e Faturamento — do B/L à fatura no Portal (5 ago 2026)

> Registro histórico. Revisão de leitura conduzida na branch
> `claude/bl-tax-calculation-flow-jwcczw` contra o repositório em `0532efd`.
> Nenhuma linha de código foi alterada. O objetivo foi responder, com base no
> que o sistema faz hoje: **quando** as taxas locais de um B/L são calculadas,
> **quando** a fatura é emitida e numerada, **quando** ela chega ao cliente e
> **o que ainda é possível corrigir** depois disso.
>
> Escrito para leitura de gestão. A lista de arquivos que sustenta cada
> afirmação está no anexo final.

---

## 1. Resumo executivo

Quatro respostas diretas às perguntas do pedido:

**1. O cálculo é feito logo após o B/L ser importado?**
**Não.** Para carga de container — que é o volume principal — importar o B/L
apenas cadastra os dados. **Nada é calculado no import.** O cálculo só começa
quando o **CE Mercante** daquele B/L é cadastrado no sistema. Essa é uma regra
deliberada, documentada na ADR 0020: como uma taxa de container compartilhado é
rateada entre os B/Ls que dividem o container, calcular antes de todos os B/Ls
da viagem existirem produziria cobrança errada (o primeiro B/L pagaria o
container inteiro). Como o CE só existe depois que o manifesto foi transmitido
ao Mercante, esperar pelo CE garante que todos os B/Ls já entraram.

Exceção: **carga solta (breakbulk)** calcula no próprio import, e **granito**
tem motor e fluxo próprios.

**2. Quando a fatura fica disponível ao cliente e quando ela ganha número?**
**No mesmo instante do cálculo.** Cadastrar o CE Mercante dispara uma sequência
automática e contínua: calcula → promove para "pronto para faturar" → **emite a
fatura** → **numera a fatura** → **publica no Portal** → **notifica o cliente**.
Tudo isso é uma única cadeia, sem parada intermediária. O número
(`INV-2026-0001`, sequencial por ano) é atribuído pelo banco no exato momento em
que a fatura é criada — não existe fatura sem número, nem número reservado antes.

**3. Existe validação manual do cálculo antes de o cliente ver?**
**Não no caminho normal.** Existe um botão "Marcar revisado" na ficha do B/L,
mas ele **não é obrigatório**: o sistema promove o B/L automaticamente assim que
o cálculo termina sem pendências. A conferência humana só é acionada **por
exceção** — quando o próprio cálculo levanta uma pendência (ver seção 5). Num
B/L "limpo", nenhuma pessoa olha os números antes do cliente.

**4. Dá para corrigir uma fatura depois de emitida?**
**Sim, dentro de limites — e só enquanto não houver pagamento registrado.**
Como não existe estado intermediário entre "emitida" e "visível ao cliente",
não há a janela "corrigir antes de disponibilizar": toda correção é, por
definição, posterior à visibilidade do cliente. Detalhe na seção 6.

---

## 2. A linha do tempo, do começo ao fim

| # | Momento | O que o sistema faz | Quem dispara | Tela |
|---|---|---|---|---|
| 1 | Importação do arquivo de B/L | Grava B/L, containers, carga, cliente sugerido. **Não calcula taxa.** | Documentação | `/manifestos` |
| 2 | Conciliação de cliente | Vincula o consignatário do documento ao cadastro de Cliente | Documentação | `/faturamento` → Validação, ou `/revisao` |
| 3 | **Cadastro do CE Mercante** | **Gatilho.** Dispara a cadeia automática abaixo | Documentação | 3 caminhos (ver seção 3) |
| 4 | Cálculo das taxas | Resolve a tabela vigente (POD + modo de carga + data), aplica itens, rateia container compartilhado, aplica override do cliente | Automático | — |
| 5 | Promoção | Se não há pendência, o banco marca o B/L "pronto para faturar" sozinho | Automático (gatilho de banco) | — |
| 6 | Emissão | Cria a fatura com status **Emitida** e congela os itens | Automático | — |
| 7 | Numeração | Banco atribui `INV-<ano>-<sequencial>` | Automático | — |
| 8 | Publicação no Portal | Fatura passa a aparecer para o cliente | Automático | `/portal/billing` |
| 9 | Notificação | "Nova fatura emitida — Fatura INV-… no valor de R$ …" | Automático | Sino do Portal |

Os passos 4 a 9 são **um único bloco automático**. Entre o operador clicar em
"salvar o CE Mercante" e o cliente ver a fatura no Portal não há nenhuma tela,
nenhuma aprovação e nenhuma pessoa.

> **Nota:** o cliente **não recebe e-mail**. A notificação é apenas dentro do
> Portal. O código de envio de e-mail existe, mas está desativado por decisão
> atual (sem chave de envio e sem gatilho configurado).

---

## 3. Os três caminhos que disparam o cálculo

O CE Mercante pode entrar por três portas, e **todas as três disparam a mesma
cadeia automática**:

| Caminho | Tela | Observação |
|---|---|---|
| Planilha de CE (uma linha por B/L) | Importador de CE Mercante | Dispara B/L a B/L, em segundo plano |
| Retorno EDI do manifesto | Importador de CE por manifesto | Dispara para todos os B/Ls do lote |
| Digitação na ficha do B/L | `/manifestos/:blId` → aba Operacional, campo "CE Mercante" | Só dispara quando o campo estava **vazio** e passou a ter valor. Reeditar um CE já existente não refatura. |

Além disso, a tela `/revisao` dispara a mesma cadeia: quando o operador resolve
a última pendência de um B/L (vincula o cliente, cadastra o e-mail, provisiona
o Portal), o sistema tenta calcular e faturar na hora. Se o CE ainda não
existir, ele **para e avisa**: *"Aguardando cadastro do CE Mercante para
calcular taxas"* — e o B/L continua na fila.

Proteção existente: reimportar o CE de um B/L **já faturado** não gera segunda
fatura. O sistema registra a tentativa no Histórico do B/L e ignora.

---

## 4. O que acontece em cada tela

### `/manifestos` — Importação de B/L
Sobe o arquivo, cria/atualiza o B/L e a carga. Fim. Nenhum efeito financeiro.
**Quem opera:** Documentação.

### `/manifestos/:blId` — Ficha do B/L, aba **Cobranças**
É a tela onde as taxas de um B/L aparecem linha a linha (taxa, origem
automática/manual, status, quantidade, unitário, total, observação) e onde o
operador pode agir sobre elas.

- Se o B/L **ainda não foi calculado**, aparece um aviso âmbar com o botão
  "Calcular taxas" — cálculo manual sob demanda.
- Botões **"Marcar revisado"** e **"Pronto para faturar"**. O segundo, quando o
  B/L tem cliente vinculado, **já emite a fatura na hora**.
- Formulário de **Other Charges** (cobrança manual avulsa) para acrescentar uma
  taxa que a tabela não cobre.
- **Depois que o B/L é faturado, esta tela trava.** Some o formulário, somem os
  botões, e aparece a mensagem: *"Este B/L já foi faturado. As taxas estão
  bloqueadas para edição — para alterar, cancele a fatura correspondente em
  Faturamento."* O bloqueio não é só visual: o banco também recusa.

**Quem opera:** Documentação.

### `/revisao` — Revisão operacional
Fila de B/Ls que não podem avançar. Mostra o que falta em cada um (cliente não
vinculado, cliente sem e-mail cadastrado, acesso ao Portal não provisionado,
peso de carga solta ausente). O operador corrige ali mesmo, com edição em linha
e ação em grupo por cliente. **Ao zerar a última pendência, o sistema calcula e
emite a fatura automaticamente** e avisa por mensagem: *"…e fatura emitida
automaticamente."*

**Quem opera:** Documentação.

### `/taxas-locais` — Tabelas e Overrides
É o **cadastro de preços**, não a operação. Duas abas:

- **Tabelas:** as tabelas de taxas por POD, modo de carga e vigência, com seus
  itens (nome, categoria, base de aplicação, moeda, valor unitário).
- **Overrides:** valor diferenciado por cliente para um item específico, com
  vigência própria.

Esta tela **não mostra fila de B/L nem calcula nada**. É a fonte que o motor
consulta. Consequência prática importante: **alterar um valor aqui não
recalcula B/Ls já calculados** — vale para o que for calculado dali em diante.

**Quem opera:** Documentação / Administrativo.

### `/faturamento` — aba **Validação**
É o painel de controle do fluxo. Lista os B/Ls que ainda não viraram fatura,
com o motivo do bloqueio de cada um em texto claro ("Cliente não vinculado",
"Há linhas de taxa com revisão pendente", "Ainda não marcado como pronto para
faturar", "Revisão pendente: acesso ao portal não provisionado"…). Permite
selecionar vários B/Ls e executar em lote: **recalcular**, **aprovar revisão**,
**marcar pronto** (que já emite) ou **emitir individualmente**.

Também é aqui que se aprova/rejeita a conciliação de cliente pendente.

**Quem opera:** Documentação; a emissão exige perfil com permissão financeira.

### `/faturamento` — aba **Faturas**
Lista e detalhe das faturas emitidas: itens, B/Ls cobertos, pagamentos,
impressão do documento (via impressora/PDF do navegador, com QR PIX), registro
de pagamento, cancelamento, restituição.

**Quem opera:** Documentação e Administrativo; a conciliação de pagamento é do
Financeiro.

### `/portal/billing` — o que o cliente vê
Tabela com: B/L, número da fatura, tipo (individual/consolidada), navio/viagem,
POD, data de emissão, vencimento, **valor total e saldo**, e o status. Botão
"Detalhes" abre a fatura item a item.

O único portão de visibilidade no Portal é o **CE Mercante** — e ele já está
preenchido por construção, porque foi ele que disparou a fatura. **Não existe
um controle separado de "publicar fatura para o cliente".**

Observação factual: a lista do Portal **não filtra por status**. Faturas
canceladas continuam aparecendo para o cliente, com o rótulo "Cancelada".

---

## 5. Como funciona (e onde não funciona) a validação manual

Esta é a parte central do pedido, então vale ser explícito.

### O que o sistema confere sozinho, antes de emitir

Antes de deixar um B/L virar fatura, o banco verifica, em bloco:

1. Cliente vinculado e conciliado por documento;
2. Cliente com e-mail cadastrado;
3. Cliente com acesso ao Portal provisionado e ativo;
4. Peso informado, no caso de carga solta;
5. Nenhuma linha de taxa marcada como "revisão obrigatória";
6. Nenhuma linha em **USD** (moeda estrangeira trava a emissão de propósito);
7. Pelo menos uma linha em BRL com valor positivo;
8. Existência de tabela de taxas vigente para aquele POD/modo/data.

Se qualquer item falhar, o B/L **não é faturado** e fica na fila com o motivo
escrito. Isso é uma barreira real e funciona.

### O que o sistema **não** confere

Nada disso é uma conferência do **valor**. O sistema garante que o cálculo
*rodou de forma completa e coerente com o cadastro* — não que o cadastro esteja
certo, nem que o valor faça sentido comercialmente. Se a tabela de taxas tiver
um valor errado, ou o override do cliente estiver desatualizado, ou a
quantidade de containers estiver incorreta no B/L, a fatura sai errada, é
numerada e chega ao cliente sem que ninguém tenha olhado.

### Onde entra o humano hoje

**Só por exceção.** As situações que efetivamente param o processo e obrigam
alguém a olhar:

| Situação | O que o operador vê |
|---|---|
| Não existe tabela de taxas vigente para o POD/modo naquela data | Linha "Revisão manual obrigatória"; B/L travado |
| Container com perfil ambíguo (IMO + OOG na mesma taxa) | Linha em revisão obrigatória; B/L travado |
| Cliente não vinculado, sem e-mail ou sem Portal | B/L na fila de `/revisao` com o motivo |
| Alguma linha em USD | Emissão bloqueada — "Ajuste manualmente antes de faturar" |
| B/L de veículo / LCL | Marcado como **isento**, com o motivo "taxas pagas na origem" |

Fora desses casos, **o caminho é automático de ponta a ponta**. O botão "Marcar
revisado" existe e registra auditoria, mas é opcional: um gatilho no banco
promove o B/L de "calculado" para "pronto para faturar" assim que as oito
condições acima estão satisfeitas, sem esperar por ele.

> **Se o objetivo for instituir conferência prévia obrigatória, isso é uma
> mudança de comportamento do sistema, não uma mudança de rotina da equipe.**
> Hoje não há tela onde a equipe *possa* segurar a fatura: ela já nasceu emitida
> e visível. Ver seção 7.

---

## 6. Corrigir depois de emitida — o que dá e o que não dá

### Primeiro, um esclarecimento importante

A pergunta original supõe duas janelas: "corrigir antes de disponibilizar ao
cliente" e "corrigir depois". **Hoje só existe a segunda.** A fatura é criada,
numerada e publicada no Portal no mesmo instante. Não há estado de rascunho em
uso: tecnicamente o sistema sabe criar fatura em rascunho, mas **nenhuma tela
faz isso** — todas as chamadas pedem emissão imediata.

A única janela de correção "antes do cliente ver" é **antes de cadastrar o CE
Mercante**. Enquanto o CE não entra, o B/L pode ser recalculado, ajustado e
revisado à vontade — e o cliente não vê nada, porque o Portal também usa o CE
como portão de visibilidade.

### Depois de emitida: o que é possível

| Ação | Possível? | Condições |
|---|---|---|
| Editar as linhas de taxa do B/L | **Não** | Bloqueado na tela e no banco assim que o B/L fica "faturado" |
| Acrescentar/remover **Other Charge na fatura** | **Sim** | Perfil Administrativo; fatura **individual** (não consolidada); status Emitida/Vencida/Rascunho; **sem nenhum pagamento registrado** |
| Cancelar a fatura | **Sim** | Perfil Administrativo; **sem nenhum pagamento registrado**; exige motivo, que fica em auditoria |
| Reemitir corrigida | **Sim, indiretamente** | Cancelar → o B/L volta a "pendente" → recalcular/ajustar → emitir de novo |
| Corrigir fatura **já paga** | **Não diretamente** | É preciso primeiro estornar o pagamento (em `/reconciliacao`), e só então cancelar |

### O caminho prático de correção

Na prática, o roteiro de correção de uma fatura errada é:

1. `/faturamento` → aba Faturas → abrir a fatura → **Cancelar** (com motivo).
   Se houver pagamento, estornar antes em `/reconciliacao`.
2. O B/L volta ao estado "pendente" e destrava.
3. Corrigir a causa: valor na tabela em `/taxas-locais`, override do cliente,
   dado do B/L, ou linha manual na aba Cobranças.
4. Recalcular e emitir de novo.
5. Resultado: **fatura nova, com número novo**. A cancelada não desaparece —
   permanece no histórico e **continua visível ao cliente no Portal**, rotulada
   "Cancelada".

Toda essa cadeia fica registrada: cancelamento com motivo e autor em auditoria,
emissão e pagamento na linha do tempo da fatura, e o Histórico do B/L guarda
cálculo, revisão, emissão e pagamento.

---

## 7. Pontos de atenção

Cinco observações que valem uma decisão de gestão. As três primeiras são de
processo; as duas últimas são achados técnicos que a revisão encontrou de
passagem.

**A. Não existe ponto de conferência antes do cliente.** É o achado principal.
A fatura nasce visível. Se a operação quiser um "de-para" humano — alguém
confere o valor antes de publicar —, isso exige criar um estado intermediário
que hoje não é usado (a fatura em rascunho existe no banco, mas nenhuma tela a
utiliza). É uma mudança pequena em conceito e relevante em impacto: passaria a
haver uma fila de "faturas a liberar".

**B. A janela de correção fecha no primeiro pagamento.** Enquanto não há
pagamento, corrigir é simples (cancelar e reemitir). Depois do pagamento, o
caminho passa obrigatoriamente pelo estorno — mais burocrático e com mais
rastro. Vale a operação saber que a folga está entre a emissão e o pagamento.

**C. Alterar a tabela de taxas não recalcula o que já foi calculado.** Se um
valor da tabela estava errado, corrigir a tabela conserta o futuro, não o
passado. Os B/Ls já calculados (e as faturas já emitidas) precisam ser tratados
um a um.

**D. Acrescentar "Other Charge" a uma fatura já emitida deixa o Portal
inconsistente.** Ao adicionar um item manual a uma fatura individual já
emitida, o sistema soma o valor ao **total** da fatura, mas não atualiza o
**saldo em aberto** — que é calculado por outro caminho (o razão de recebíveis).
O cliente veria, na mesma linha, um total maior e um saldo menor. Recomendação
prática: para acrescentar cobrança a uma fatura já emitida, **cancelar e
reemitir** em vez de usar "Other Charge". *(Achado de leitura de código, não
verificado em ambiente rodando.)*

**E. A emissão automática exige perfil Administrativo.** A rotina que fatura
sozinha após o CE Mercante roda com as credenciais de quem salvou o CE, e a
função de banco que emite exige perfil Administrativo. Como hoje existe **um
único usuário interno, e ele é Administrativo**, não há impacto. Mas quando a
equipe crescer e alguém de Documentação cadastrar um CE, a fatura não sairá
sozinha: falhará em silêncio e o registro ficará no Histórico do B/L
(`bl_auto_billing_failed`). *(Achado de leitura de código.)*

---

## Anexo — onde cada afirmação foi verificada

Para quem quiser conferir tecnicamente.

| Afirmação | Onde |
|---|---|
| Import de B/L não calcula; CE Mercante é o gatilho único | `docs/adr/0020-ce-mercante-gatilho-calculo-taxas-locais.md` |
| Os três caminhos de disparo | `src/services/ceMercanteImport.ts`, `src/hooks/useBlEditForm.ts` |
| Cadeia automática cálculo → emissão | `src/services/reviewBillingAutomation.ts` |
| Motor de cálculo, isenção, pendências | `supabase/migrations/151_guard_definer_rpcs_active_user.sql` |
| Promoção automática sem revisão humana | `supabase/migrations/129_review_gate_hardening.sql` (`promote_calculated_bl_ready_for_billing`) |
| Gate de oito condições antes de faturar | `supabase/migrations/129_review_gate_hardening.sql` (`compute_bl_review_pendencies`, `mark_bl_ready_for_billing`) |
| Emissão + numeração no mesmo instante | `supabase/migrations/025_billing_orchestration_portal.sql`, `supabase/migrations/003_functions.sql` (`assign_invoice_number`) |
| Emissão sempre imediata (nunca rascunho) | `src/services/billing.ts`, `src/components/billing/ValidacaoTab.tsx` |
| Visibilidade no Portal e portão do CE | `supabase/migrations/123_portal_ce_mercante_gate.sql` |
| Notificação in-app ao cliente | `supabase/migrations/116_portal_fase2_notifications_disputes_profile.sql` |
| E-mail ao cliente desativado | `docs/ARCHITECTURE.md`, seção Edge Functions |
| Trava de edição do B/L faturado | `supabase/migrations/108_guard_manual_charges_and_clear_pix_on_reversal.sql`, `src/components/bl/BlCobrancasTab.tsx` |
| Regras de Other Charge na fatura | `supabase/migrations/108_guard_manual_charges_and_clear_pix_on_reversal.sql` |
| Cancelamento e retorno do B/L a "pendente" | `supabase/migrations/064_fix_granite_invoice_cancel_reissue.sql` |
| Telas e responsabilidades | `docs/modules/taxas-locais.md`, `docs/modules/faturamento.md` |

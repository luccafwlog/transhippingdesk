# Faturamento: executar a ADR 0038 e consolidar as abas de `/faturamento`

> **Origem:** [ADR 0038](../adr/0038-taxa-local-valor-congelado-ancorado-na-escala.md)
> (oito decisões) e as auditorias de
> [5 ago](../archive/audits/2026-08-05-revisao-fluxo-taxas-locais-fatura.md) e
> [6 ago](../archive/audits/2026-08-06-revisao-motor-calculo-taxas-locais.md)
> (onze achados).
>
> Absorve o plano de consolidação das abas, que existia separado e nunca foi
> executado. Foram fundidos porque a decisão 8 dá à aba Validação um papel que
> ela não tinha: executar as abas sem o motor produziria uma tela renomeada
> sobre o mesmo vazio.

**Regra que atravessa o plano inteiro:** nenhuma etapa está pronta enquanto a
decisão não estiver **visível na interface**. Motor certo com tela muda é
regressão, não progresso — o operador continua sem saber o que o sistema
decidiu, e o objetivo de tudo isto é justamente tirar decisões de dentro do
código. Cada etapa abaixo tem a seção **"O que o usuário vê"**, e ela é critério
de conclusão, não enfeite.

**Migrations:** `main` está na `260`. As novas começam em `261`, sequenciais
([ADR 0016](../adr/0016-migrations-nomenclatura-numerada-sequencial.md)).
Migrations existentes são protegidas — nunca editar, sempre criar nova.

---

## Ordem e dependências

```
Etapa 1  congelar a fatura na emissão
   └─ Etapa 2  travar recálculo de B/L faturado      (precisa de 1: sem congelamento não há o que proteger)

Etapa 3  desligar a promoção automática ─┐
Etapa 4  cálculo provisório no import    ─┴─ SHIP JUNTAS (3 sozinha para o faturamento automático)

Etapa 5  planilha de conferência         (precisa de 4)
Etapa 6  Validação vira a tela das duas fases  (precisa de 3+4)

Etapa 7  parar e sinalizar / TEU         ─┐
Etapa 8  Movimento FCL/LCL e isenção      │ independentes entre si,
Etapa 9  data de referência (ETA)         │ qualquer ordem,
Etapa 10 Condições de Cliente sem sobrepor│ todas depois de 4
Etapa 11 USD converte na emissão         ─┘

Etapa 12 consolidar as abas de /faturamento   (precisa de 6)
Etapa 13 arredondamento do rateio             (independente, baixa prioridade)
```

**Etapas 3 e 4 não podem ser entregues separadas.** A 3 sozinha desliga o
faturamento automático e não coloca nada no lugar.

---

## Etapa 1 — Congelar a fatura na emissão

**Decisão 2 da ADR.** Resolve o achado 3.

Hoje o detalhamento que o cliente vê é derivado ao vivo de `charge_calculations`,
e recalcular apaga e recria essas linhas. A fatura passa a guardar o próprio
detalhamento no momento da emissão.

- [ ] Migration `261`: tabela de itens da fatura local (ou colunas de snapshot),
      gravada por `mark_bl_ready_and_create_invoice` na emissão.
- [ ] O documento impresso e o Portal passam a ler o detalhamento **da fatura**,
      nunca de `charge_calculations`
      (`src/components/billing/InvoiceDocumentLocal.tsx`,
      `InvoiceDetailModal.tsx`, telas do Portal).
- [ ] Faturas já emitidas: backfill a partir de `charge_calculations`, com nota
      de que o valor congelado é reconstruído, não original.

### O que o usuário vê

- Nada muda visualmente — e **é isso que precisa ser verificado**. Abrir uma
  fatura antes e depois deve mostrar exatamente o mesmo detalhamento.
- No detalhe da fatura, indicar que aquele detalhamento é o **da emissão**
  (data), não o cálculo atual do B/L. É a primeira vez que os dois podem
  divergir legitimamente, e o usuário precisa saber qual está olhando.

---

## Etapa 2 — Travar recálculo de B/L já faturado

**Decisão 2 da ADR.** Resolve o achado 6.

- [ ] Migration `262`: `calculate_bl_local_charges` recusa quando
      `financial_status IN ('invoiced','partially_paid','paid')`, mesma trava que
      `add_manual_bl_charge` já tem (migration `108`).
- [ ] Retorno da RPC explica a recusa em vez de falhar em branco.
- [ ] O recálculo em lote da Validação pula B/Ls faturados e **reporta quantos**
      pulou, em vez de contá-los como sucesso.

### O que o usuário vê

- O botão de recalcular fica **desabilitado** na ficha do B/L faturado, com o
  motivo ao lado: "Fatura emitida — correção exige cancelar e reemitir."
  Desabilitado sem explicação vira chamado de suporte.
- No lote, o resultado passa a dizer "X recalculados, Y ignorados (já
  faturados)".

---

## Etapa 3 — Desligar a promoção automática

**Decisão 8 da ADR.** Habilita as duas fases.

- [ ] Migration `263`: remover o trigger `trg_promote_calculated_bl_ready`
      (definido na `129`). `calculated` volta a significar "calculado e
      conferível"; `ready_for_billing` passa a ser produzido pelo caminho do CE.
- [ ] `maybeAutoBillAfterCeMercante` promove explicitamente antes de emitir
      (`src/services/reviewBillingAutomation.ts`).
- [ ] Conferir se algum outro consumidor dependia da promoção implícita
      (`docs/RASTREABILIDADE.md`, testes de `reviewBillingAutomation`).

### O que o usuário vê

- Os dois estados passam a ser distinguíveis na Validação e na ficha do B/L, com
  rótulos que digam o que são: **"Calculado (provisório)"** e **"Pronto para
  faturar"**. Hoje um vira o outro sozinho e o operador nunca viu a diferença.

---

## Etapa 4 — Cálculo provisório no import, com recálculo de irmãos

**Decisão 8 da ADR.** Resolve o achado 11.

- [ ] Remover a recusa de calcular sem CE em `tryAutoIssueInvoice`
      (`src/services/reviewBillingAutomation.ts`) — ela passa a valer só para a
      **emissão**, não para o cálculo.
- [ ] Em `confirmBlFreightImport` (`src/services/blFreightImport.ts`), passo
      pós-commit best-effort e idempotente, no mesmo padrão de
      `applyBapliePhysicalFlags` — e **depois dele**: as flags IMO/OOG são
      aplicadas pós-commit e definem o perfil de carga, logo as quantidades de
      THD. Calcular antes produz perfil errado.
- [ ] O passo calcula os B/Ls importados **e os irmãos**: B/Ls da mesma viagem
      que compartilhem container e **não tenham fatura emitida**. B/L faturado
      nunca é tocado — cai no aviso de container compartilhado que já existe.
- [ ] Carga solta e granito seguem seus fluxos próprios; a fronteira da ADR 0020
      (só container) permanece.

### O que o usuário vê

- Depois de importar, o B/L **já mostra valor de taxas** na ficha, marcado como
  provisório. Hoje mostra "não calculado" até o CE.
- Linha de container compartilhado **identificada como tal** na ficha e na
  planilha, com o número de B/Ls que dividem o container. É a única linha cujo
  valor depende de um B/L que não está na tela.
- Ao cadastrar o CE, mensagem dizendo o que aconteceu: recalculou, confirmou e
  emitiu — e se o valor mudou em relação ao provisório, **quanto** mudou.

---

## Etapa 5 — Planilha de conferência

**Decisão 8 da ADR.** É o motivo pelo qual a fase provisória existe.

- [ ] Exportação das taxas calculadas, por viagem e por B/L, usando
      `downloadCsv` (`src/lib/csv.ts` — existe, com teste, e **sem nenhum
      consumidor hoje**).
- [ ] Colunas mínimas: B/L, cliente, POD, item, base de aplicação, quantidade,
      valor unitário, valor total, origem do preço (tabela padrão ou Condição de
      Cliente), e **marcação de container compartilhado com o `share_count`**.
- [ ] Cabeçalho com data/hora da extração e a tarifa usada, para a planilha ser
      conferível contra a tabela vigente.

### O que o usuário vê

- Botão de exportar na Validação e na Viagem, com escopo explícito ("as N linhas
  filtradas", não "tudo").
- A planilha diz, no topo, que é **conferência de cálculo provisório** e que o
  valor final sai no CE.

---

## Etapa 6 — Validação vira a tela das duas fases

**Decorre da 3 e da 4.** É onde a decisão 8 fica visível.

Hoje a aba mostra `Pronto faturar: X | Faturado automatico: Y | Diferenca: Z` —
métricas de uma cadeia que ninguém percorre. Com as duas fases, ela passa a ter
função: é a fila de B/Ls calculados aguardando CE.

- [ ] O funil (`ValidacaoControls.tsx`) passa a refletir as fases reais:
      provisório → conferido → aguardando CE → faturado.
- [ ] Ação de exportar planilha no passo do provisório.
- [ ] Rever o nome da aba. A Etapa 4 do plano de abas anterior propunha
      renomear "Validação" porque ela prometia uma conferência inexistente;
      **isso mudou** — agora a conferência existe. Decidir se o nome fica.

### O que o usuário vê

- A aba passa a responder "o que está calculado e ainda não faturado, e por
  quê". Cada linha bloqueada mostra o motivo em texto, não só um status.

---

## Etapa 7 — Parar e sinalizar, nunca cobrar zero

**Decisão 7 da ADR.** Resolve o achado 1 — o de maior risco.

- [ ] Migration `264`: no lugar de `IF COALESCE(v_qty,0) <= 0 THEN CONTINUE`,
      gravar linha `review_required`, no mesmo padrão de
      `review:weight_missing`. Cobre os três caminhos: `application_basis =
      'teu'` sem tratamento, item THD com `cargo_profile` no padrão `'any'`, e
      B/L de container sem containers cadastrados.
- [ ] **TEU:** decidir entre implementar o cálculo por TEU ou remover a opção do
      seletor (`src/components/taxasLocais/ChargeTableItemFormCard.tsx:96`).
      Enquanto as duas coisas não se alinharem, o cadastro aceita algo que o
      motor não sabe calcular.
- [ ] Teste: item TEU e item THD com perfil `'any'` produzem revisão, não
      silêncio.

### O que o usuário vê

- A tela de cadastro da tabela de taxas **impede salvar** um item que o motor não
  saberá calcular, com o motivo. Corrigir no cadastro é melhor que descobrir na
  revisão.
- O B/L com item não calculável mostra a pendência nomeando o item.

---

## Etapa 8 — Movimento FCL/LCL e a isenção de veículos

**Consequência da ADR.** Resolve os achados 8 e 10.

- [ ] Migration `265`: a isenção passa a exigir **veículo no B/L E `movement_to`
      indicando LCL**. Aceitar as duas notações: `LCL` e `CFS`.
- [ ] **Ausência ou notação irreconhecível cobra normalmente** — a isenção exige
      prova positiva. Este é o único ponto em que a Etapa 7 não se aplica, e de
      propósito: o padrão já é cobrar.
- [ ] O motor **para de escrever** `container_load_type`. Avaliar deprecar a
      coluna: seu único escritor no sistema é a função de cálculo.
- [ ] `movement_to` editável na ficha do B/L, com a correção no Histórico.

### O que o usuário vê

- O Movimento aparece na ficha do B/L como campo com significado, não texto
  solto — com o que ele implica ("LCL no destino → isento de taxas locais").
- B/L isento mostra **por quê**, citando o Movimento.
- Tela ou filtro listando as isenções aplicadas. Hoje a isenção é invisível: só
  aparece como valor zero, e o operador não tem como conferir se está certa.

---

## Etapa 9 — Data de referência da tarifa

**Decisão 3 da ADR.** Resolve o achado 4.

- [ ] Migration `266`: `v_ref_date` passa a ser a **ETA da escala do POD**
      (`voyages.pod_schedule_snapshot`, chave = POD), no lugar de
      `uploaded_at`/`created_at`. Vale para a tabela de taxas e para a Condição
      de Cliente.
- [ ] ETA ausente → pendência de revisão, não fallback. Duas âncoras alternando
      fazem o mesmo B/L dar preços diferentes em recálculos diferentes.
- [ ] **Verificar antes:** taxa de preenchimento da ETA por escala nos dados
      reais. A regra operacional diz que sempre existe; confirmar contra o banco.

### O que o usuário vê

- A ficha do B/L e a planilha mostram **qual tabela de taxas foi aplicada e por
  qual data**. Sem isso, "por que este B/L custou diferente" continua sem
  resposta na tela.

---

## Etapa 10 — Condições de Cliente não podem se sobrepor

**Decisão 5 da ADR.** Resolve o achado 5.

- [ ] Migration `267`: restrição de exclusão em `customer_rate_overrides`
      impedindo vigências sobrepostas para o mesmo cliente e item. Hoje há
      apenas um índice (`016_local_charges_stage_a.sql:215`).
- [ ] Remover o desempate `ORDER BY cro.created_at DESC LIMIT 1` do motor — com
      a restrição, ele deixa de ter função.
- [ ] Conferir dados existentes antes de aplicar: sobreposições já gravadas
      precisam ser resolvidas à mão, e a migration falha se houver.

### O que o usuário vê

- O cadastro **recusa** a condição conflitante, mostrando qual condição existente
  colide e seu período. Recusar sem dizer com o quê é pior que aceitar.
- A tela de Condições mostra a vigência de cada uma, para o conflito ser
  previsível antes de salvar.

---

## Etapa 11 — Taxa local em USD converte na emissão

**Decisão 6 da ADR.** Resolve o achado 7.

- [ ] Migration `268`: na emissão, itens em USD convertem pelo ROE vigente e o
      valor em BRL é congelado com o resto da fatura. Reusa a máquina de PTAX +
      markup do Demurrage, **sem** o Recálculo Diário.
- [ ] Remover o `billing_hold_reason` de USD, que hoje pede um "ajuste manual"
      sem tela onde ser feito.

### O que o usuário vê

- A fatura mostra o item em USD, o ROE aplicado e a data da cotação — mesma
  transparência que o Demurrage já dá.
- Deixa claro que este ROE **não muda** depois, diferente do Demurrage. Dois
  documentos com regras diferentes de câmbio na mesma tela exigem que a diferença
  esteja escrita.

---

## Etapa 12 — Consolidar as abas de `/faturamento`

Absorvido do plano anterior. `/faturamento` tem quatro abas; duas não se
sustentam.

**Pendências é subconjunto literal da Validação** — não é semelhança conceitual,
é identidade técnica: mesma função (`useLocalChargeOperations`), mesmo limite
(1200), mesma fonte. A única diferença é `chargeStatus = 'review_required'`
fixo, filtro que a Validação já oferece de duas formas. E entrega menos: sem
seleção múltipla, sem emissão individual, sem aprovar conciliação. O único
recurso exclusivo é recalcular em massa sem selecionar — isso é um botão, não
uma aba.

**Demurrage duplica `/demurrage`**, e a própria aba declara isso em card fixo.
Lá se cria e gerencia, com filtros e impressão; aqui é leitura sem nenhum filtro.
Mas há um recurso genuíno: como `/demurrage` segrega por status em abas, lá não
se enxerga o **total de demurrage em aberto**. As quatro métricas consolidadas
têm valor; a tabela repetida não.

- [ ] Adicionar "Recalcular todas em revisão" ao passo do funil, preservando o
      lote parcial (continua após erro, reporta contagem e primeiro erro).
- [ ] Remover a aba Pendências; redirecionar `?tab=pendencias` para a Validação
      com `chargeStatus=review_required` aplicado.
- [ ] Excluir `PendenciasFaturamentoTab.tsx`; avaliar se `PendenciasTable.tsx`
      ainda tem consumidor (a renderização de 100 em 100 pode servir à Validação).
- [ ] Mover as quatro métricas de demurrage para uma faixa na aba Faturas, com
      link para `/demurrage`; remover a aba, a lista, o modal e a impressão
      duplicados; redirecionar `?tab=demurrage` para `/demurrage`.
- [ ] Confirmar com a operação que ninguém imprime demurrage a partir de
      `/faturamento` antes de remover esse caminho.

### O que o usuário vê

- Três abas com papéis que não se sobrepõem: **Faturas** (emitido), **Validação**
  (as duas fases do cálculo), e nada mais.
- Os redirecionamentos preservam links salvos e memória muscular — a remoção não
  pode aparecer como erro 404 ou aba sumida sem explicação.

### Fica pendente de decisão do gestor

- **Unificar demurrage na aba Faturas?** Faturas locais e de demurrage vivem em
  tabelas separadas e a aba Faturas nunca mostra demurrage, nem com o filtro de
  tipo em "Todos". Hoje o único lugar que consolida as duas origens é o Saldo
  Pendente na Ficha do Cliente. Unificar a **exibição** não contraria a
  [ADR 0008](../adr/0008-demurrage-integrado-sem-unificar-persistencia.md);
  unificar a **persistência** contrariaria. Se não unificar, renomear a tela para
  refletir o escopo real e registrar em ADR.

---

## Etapa 13 — Arredondamento do rateio

**Achado 9.** Baixa prioridade, acabamento.

- [ ] Atribuir a diferença de arredondamento ao último rateio, para a soma das
      partes fechar o container. Hoje três B/Ls num container de R$ 100 pagam
      R$ 33,33 cada — R$ 99,99.

---

## Gates

- [ ] `npm run docs:check`, `npm run lint`, `npm test`, `npm run build`.
- [ ] Atualizar no mesmo change: `docs/ARCHITECTURE.md`,
      `docs/modules/taxas-locais.md`, `docs/modules/faturamento.md`,
      `docs/RASTREABILIDADE.md`, `docs/CHANGELOG.md`.
- [ ] **Remover os marcadores "decidida e ainda não implementada"** dos verbetes
      do `CONTEXT.md` conforme cada etapa entrega. Eles existem para o glossário
      não ser lido como descrição do motor; deixá-los depois de implementado
      inverte o erro.
- [ ] Ao concluir: mover este plano para `docs/archive/plans/` e remover a linha
      de `docs/plans/README.md`.

---

## Riscos

- **Etapas 3+4 são a mudança de comportamento mais visível do plano.** Passa a
  existir número antes do CE, onde antes não existia nada. Se a fase provisória
  não estiver clara na tela, o operador vai ler valor provisório como definitivo.
- **Etapa 8 muda receita:** veículo em FCL passa a pagar. É a única etapa com
  efeito financeiro imediato e merece comunicação à operação antes do deploy.
- **Etapa 10 pode falhar no dado existente.** Sobreposições já cadastradas
  precisam ser resolvidas antes da restrição entrar.
- **Etapa 9 depende de dado que ninguém verificou.** A regra operacional diz que
  a ETA sempre existe; se não existir em parte dos B/Ls, a etapa vira atrito.
- O `share_count` correto depende da regra operacional de os B/Ls que dividem
  container receberem CE junto ([ADR 0020](../adr/0020-ce-mercante-gatilho-calculo-taxas-locais.md),
  complemento de 2026-08-06). Se ela mudar, reavaliar a 0020 e a Etapa 4.

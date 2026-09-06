# Auditoria consolidada das PRs #654–#660

> Registro histórico consolidado em 2026-09-06. Esta documentação reúne integralmente os sete relatórios de auditoria produzidos nas PRs #654, #655, #656, #657, #658, #659 e #660, além das correções que já estavam implementadas nessas branches. Os relatórios originais não são mais mantidos como arquivos separados: seu conteúdo está preservado abaixo, sob a identificação da PR de origem.

## Finalidade e regra de leitura

O objetivo desta consolidação é apresentar as sete frentes como uma única auditoria do mesmo sistema, sem remover achados, ressalvas, recomendações, casos de teste ou limites de escopo. Os identificadores originais (`P0-1`, `A1`, `F1`, entre outros) foram mantidos para rastreabilidade. A seção de cada PR conserva o snapshot e a linguagem da auditoria que a originou; o quadro abaixo resolve apenas o estado relativo entre snapshots e não cria achados novos.

Código, migrations e configuração executável continuam sendo a evidência final. Como os relatórios foram produzidos em snapshots diferentes, uma afirmação histórica de uma seção não deve ser lida como uma segunda fotografia do estado posterior. Quando uma correção posterior incide sobre um achado anterior, o status reconciliado abaixo prevalece para a leitura desta auditoria consolidada.

## Fontes e evidência

| PR | Frente incorporada | Snapshot / evidência declarada |
|---|---|---|
| #654 | Parsers, ingestão de arquivos e EDI | Código reproduzido com sondas ad hoc; sem Runtime de RPC/RLS |
| #655 | Mensageria, Comunicados e régua de cobrança | Código e migrations; sem banco real |
| #656 | Performance, renderização, offline e acessibilidade | Código; Runtime de volumetria; teste do vazamento de listeners |
| #657 | CRUD, banco e requisições | Código, testes locais e migrations; correções implementadas |
| #658 | Precisão financeira, tarifação, invoices e PIX | Código, Teste de contrato SQL e reprodução numérica; sem Runtime |
| #659 | Conformidade arquitetural e dívida técnica | Código e Runtime no catálogo do Supabase de produção |
| #660 | Segurança multi-tenant, RBAC, Edge Functions e segredos | Código e Teste de contrato SQL; sem Runtime nesta sessão |

A diferença entre “Runtime” e “sem Runtime” é específica de cada frente: a PR #659 registrou consultas ao catálogo de produção; a PR #660 declarou que não havia projeto Supabase acessível. Esta consolidação não transforma as verificações estáticas em provas de runtime nem descarta a evidência Runtime que foi registrada na PR #659.

As conclusões de segurança também têm escopos diferentes. A conclusão da PR #660 de que não há IDOR nem leitura cruzada entre Clientes permanece compatível com o achado `A1` da PR #655: `A1` descreve roteamento indevido para outro contato do **mesmo** Cliente, não acesso de um Cliente aos dados de outro. Da mesma forma, a conclusão estática da PR #657 sobre ausência de RPC alcançável sem guard não substitui o achado posterior de catálogo da PR #659 sobre o grant a `PUBLIC` de `upsert_portal_invoice_exception`; quando há divergência, a evidência Runtime específica do catálogo e o status reconciliado deste documento prevalecem para esse grant.

## Reconciliação de achados sobrepostos e correções

### Importação de datas de container — PRs #654 e #657

O achado `P1-5` da PR #654 e o `P1-01` da PR #657 são o mesmo problema de origem: `containerDatesImport` gravava uma linha por transação e podia deixar uma carga parcial sem faturamento de Demurrage. A PR #657 foi incorporada: o lote agora continua após falha de gravação, coleta `errors[]`, exibe as linhas no modal, isola falha de faturamento por B/L e reprocessa B/Ls já marcados como `returned` no reimport. Isso mitiga o cenário de faturamento perdido descrito na PR #654.

Há uma precisão necessária entre os snapshots: no caminho exato mostrado no código da PR #654, `throw updateError` interrompe a função antes da segunda fase; portanto, aquela invocação não emite uma nova fatura. A formulação resumida de que a falha deixa “faturas de demurrage emitidas” é mais ampla que esse caminho específico. Para a leitura consolidada, prevalece a sequência detalhada da própria #654 e da #657: as linhas anteriores podem permanecer gravadas, o faturamento daquela execução não é alcançado e o reimport original não o recuperava.

A correção não cria rollback transacional do lote. Portanto, a não atomicidade original permanece como risco residual e a recomendação de uma RPC transacional continua válida. O status consolidado é **mitigado parcialmente**, não “resolvido integralmente”.

Para completar a proteção do mesmo fluxo, a implementação também não dispara faturamento de um B/L quando qualquer atualização desse B/L falhou; assim, a decisão não usa valores apenas propostos pela planilha para considerar todos os containers devolvidos. Isso continua sendo uma salvaguarda da mitigação parcial, não uma transação atômica.

### Falhas best-effort pós-importação — PR #657

Os quatro `catch` vazios identificados em `P1-02`/`P2-02` foram substituídos por `reportBestEffortFailure`, com `console.warn` e Sentry, mantendo o caráter best-effort das operações posteriores. A correção é adequada para tornar a falha observável sem converter uma importação documental já concluída em falso rollback; ela não substitui retry, fila ou feedback visual imediato. Os achados e propostas de atomicidade restantes continuam preservados no relatório integral da PR #657.

### Vazamento de listeners — PR #656

A troca de `useMemo` por `useEffect` em `Containers.tsx` e `Manifestos.tsx`, com limpeza local e teste de regressão para o menu de ações, foi incorporada. A correção é adequada ao defeito identificado e não conflita com os achados de escala, offline ou acessibilidade, que permanecem recomendações não implementadas.

### Guarda de Preview e HSTS — PR #660

A guarda `assertPreviewTarget` e a variável separada `PRODUCTION_SUPABASE_PROJECT_REF` corrigem o risco identificado de provisionar o admin de teste no projeto de produção; os testes cobrem produção, branch, substring, ausência de ref e URL inválida. O header `Strict-Transport-Security` também foi incorporado, sem `preload`, conforme a decisão de não transformar a auditoria em compromisso de domínio. Essas correções são adequadas ao escopo dos dois achados e os demais itens pendentes da PR #660 continuam explicitamente pendentes ou aceitos.

### Correções factuais na documentação viva — PR #659

As correções de referências inexistentes, contagens e rotas em `docs/RASTREABILIDADE.md`, `docs/ARCHITECTURE.md` e nos módulos foram incorporadas. Elas corrigem a documentação para refletir o executável; não encerram os achados de código, schema, jobs, grants ou trilhas de auditoria descritos na mesma PR.

## Quadro de status consolidado

| Fonte / identificadores | Status após a consolidação |
|---|---|
| PR #654: `P0-1` a `P0-4` | Achados preservados; sem correção implementada nesta consolidação |
| PR #654 `P1-5` / PR #657 `P1-01` | Mitigado parcialmente pela PR #657; atomicidade transacional continua pendente |
| PR #655: `A1` a `A9` | Achados preservados; recomendações não implementadas |
| PR #656: achados 1–5 e 7–9 | Preservados; correção de listeners é o único item implementado |
| PR #656: achado 6 | Corrigido e testado na PR #656 |
| PR #657: `P1-02` e `P2-02` | Mitigados em observabilidade por `reportBestEffortFailure`; remediação estrutural continua nos limites descritos |
| PR #657: `P2-01`, `P3-01` e `P3-03` | Pendentes, conforme o relatório de origem |
| PR #658: `F1` a `F17` | Achados preservados; nenhuma alteração de comportamento |
| PR #659: achados 1–10 | Achados preservados; somente correções factuais documentais aplicadas |
| PR #660: achado 1 | Pendente; migration proposta não aplicada |
| PR #660: achado 2 | Corrigido e testado: guarda de alvo de Preview |
| PR #660: achado 3 | Pendente; guardas de entrada propostas não aplicadas |
| PR #660: achado 4 | Corrigido: HSTS incorporado |
| PR #660: achado 5 e TOCTOU | Aceitos / não corrigidos, com as justificativas preservadas |

Este quadro não reclassifica nem elimina achados: apenas reconcilia o que era snapshot anterior, o que foi mitigado pelas correções incorporadas e o que permanece pendente. O conteúdo integral de cada auditoria segue abaixo.

## Conteúdo integral das auditorias de origem


---

## PR #654 — resiliência de parsers, ingestão de arquivos e EDI

Arquivo original incorporado integralmente abaixo. O snapshot, a evidência, os identificadores dos achados e as recomendações são preservados.

# Auditoria de resiliência de parsers, ingestão de arquivos e EDI — 5 set. 2026

> Registro histórico. Nenhum código funcional foi alterado nesta auditoria;
> este documento é a única mudança. Escopo: os módulos de importação
> versionados em `src/services/` e suas telas, no commit `bdf224133fce`.

## Método

Cada achado foi lido no código-fonte e, além disso, reproduzido por execução
ad hoc contra as dependências instaladas do repositório (`@e965/xlsx`,
parsers reais, sem mock) em sondas temporárias sob `src/services/__tests__/`,
removidas antes do commit. As saídas citadas neste documento são **medidas**,
não previstas. O rótulo de evidência continua **Código** — todo o
comportamento descrito é verificável por leitura estática; a execução apenas
eliminou a chance de erro de leitura.

O que **não** foi coberto: comportamento das RPCs `*_transactional` no
PostgreSQL (auditado apenas pela superfície TypeScript que as chama), RLS,
o extrato PIX (`reconciliacao.ts`) e o parser de PDF/DOCX de B/L avulso além
da sua superfície de erro.

## Resumo executivo

O sistema tem **duas disciplinas de importação convivendo**, e a diferença
entre elas não é documentada nem intencional:

- **Disciplina A — tudo ou nada com erro por linha.** `vaziosImport.ts`
  (Embarque de Vazios) e o caminho EDI de CE Mercante. Qualquer divergência
  aborta o lote antes de tocar o banco.
- **Disciplina B — pula a linha ruim e importa o resto.** Granito, Vazios de
  Importação, Breakbulk, Veículos, CE Mercante por planilha, Datas de
  Container. Os erros viram uma lista consultiva ("Avisos") truncada em 8–12
  linhas, e o botão de importar continua habilitado.

A pergunta do escopo — "insere os primeiros 486 ou aborta de forma atômica?" —
tem, portanto, três respostas diferentes conforme o arquivo, e em dois casos a
resposta é "insere os 486 e não avisa que 14 ficaram de fora".

Os cinco achados que considero bloqueantes, em ordem de dano:

| # | Achado | Dano |
|---|---|---|
| P0-1 | `toNumber` interpreta `"1.234"` como **1,234** e `"1e3"` como **13** | Peso de granito → fatura. Erro silencioso de 1000× |
| P0-2 | Baplie atribui POL/POD/peso ao container **errado** em dialeto EQD-antes-de-LOC | Carga inteira deslocada em uma posição, sem erro |
| P0-3 | CSV **UTF-8 sem BOM** é decodificado como CP1252 | Acentuação corrompida em nomes, depots e clientes |
| P0-4 | `findVoyageByNumberAndVessel` compara nome de navio por igualdade exata, sem alias | Programação cria **viagem duplicada** para a mesma escala |
| P1-5 | `containerDatesImport` faz `UPDATE` linha a linha fora de transação | Falha na linha 487 deixa 486 gravadas + faturas de demurrage emitidas |

Nenhum desses depende de arquivo "hostil": todos disparam com planilha e EDI
legítimos de armador.

---

## 1. Matriz de fragilidade por tipo de arquivo

Legenda de atomicidade: **RPC** = uma transação no banco; **RPC+cauda** = RPC
atômica seguida de escritas não transacionais; **Loop** = N escritas
independentes.

| Formato / módulo | Colunas obrigatórias | Encoding | Datas | Números | Atomicidade | Erro por linha | Importa com erro? |
|---|---|---|---|---|---|---|---|
| **Baplie EDI** `baplieParser.ts` → `baplieImport.ts` | n/a (EDI) | ⛔ `file.text()` = UTF-8 fixo | n/a | `parseFloat` | ✅ RPC | ⛔ nenhum | ⚠️ sempre (não há erro a reportar) |
| **CE Mercante EDI** `ceMercanteEdiParser.ts` | n/a (posicional) | ⛔ UTF-8 fixo | n/a | `onlyDigits` + tamanho 15 ✅ | ✅ RPC atômica | ✅ `line`+`raw` | ❌ bloqueado (`ediBlocked`) |
| **CE Mercante XLSX** `ceMercanteImport.ts` | ✅ `validateRequiredHeaders` | ⚠️ CP1252 | n/a | dígitos ✅ | ⛔ **Loop** de RPC por B/L | ✅ `row`+`bl_id` | ⚠️ sim, parcial |
| **Manifesto Granito** `graniteImport.ts` | ⛔ nenhuma verificação | ⚠️ CP1252 | ⛔ só `DD/MM/AAAA`; ISO vira `null` mudo | ⛔ `toNumber` | ✅ RPC | ✅ `row`+`raw` | ⚠️ sim, parcial |
| **Breakbulk** `breakbulkManifestParser.ts` | ✅ `matchHeaders` por layout | ⚠️ CP1252 | n/a | ⛔ `toNumber` | ✅ RPC (grava erros em tabela) | ✅ persistido no banco | ⚠️ sim, parcial |
| **Embarque de Vazios** `vaziosImport.ts` | ⛔ nenhuma verificação | ⚠️ CP1252 | ✅ infere DD/MM vs MM/DD | n/a | ✅ RPC | ✅ + aborta o lote | ❌ **não** |
| **Vazios de Importação** `vaziosImportacaoImport.ts` | ⛔ nenhuma verificação | ⚠️ CP1252 | n/a | ⚠️ heurística de milhar + `?? 0` | ✅ RPC | ✅ mas rotulado "Avisos" | ⛔ **sim, com dado inválido** |
| **Veículos** `vehicleImport.ts` | ✅ varre abas até achar | ⚠️ CP1252 | n/a | `toNumber` | ⚠️ RPC+cauda (cancelar fatura) | ✅ `row` | ⚠️ sim, parcial |
| **Datas de Container** `containerDatesImport.ts` | ✅ `matchHeaders` | ⚠️ CP1252 | ⚠️ assume DD/MM sempre | n/a | ⛔ **Loop** de `UPDATE` | ✅ `row`+`raw` | ⚠️ sim, parcial |
| **B/L planilha COSCO** `blParser.ts` | ⛔ coordenadas absolutas | ⚠️ CP1252 | ⚠️ `cellDates` + rótulo | ⛔ `toNumber` | ⚠️ RPC+cauda (`import_batches`) | ⛔ nenhum | ⚠️ sim |
| **B/L avulso PDF/DOCX** `blDocumentParser.ts` | n/a (por conteúdo) | ✅ `TextDecoder` explícito | ⚠️ | ⚠️ | ✅ reusa RPC de breakbulk | ✅ `errors`/`warnings` | ⚠️ só com warnings |
| **Base de clientes** `customerBase.ts` | ✅ `validateRequiredHeaders` | ⚠️ CP1252 | n/a | n/a | ⛔ upsert + **loop** de contatos | ✅ `row` | ⚠️ sim, parcial |
| **Programação (Chegadas e Saídas)** `ChegadasSaidas.tsx` | ⛔ nenhuma | ⚠️ CP1252 | ✅ `parseCellDate` | n/a | ⛔ **Loop** por viagem | ✅ por navio/viagem | ⚠️ sim, parcial |

---

## 2. Vetor 1 — encoding, colunas e coerções

### 2.1 O risco de encoding está invertido em relação ao esperado — **Código**

A pergunta era "e se vier em ISO-8859-1?". A resposta medida é o contrário do
esperado, e pior:

| Bytes do CSV | Célula lida |
|---|---|
| UTF-8 **sem** BOM | `ARMAZÃM SÃO JOSÃ` ⛔ |
| UTF-8 **com** BOM | `ARMAZÉM SÃO JOSÉ` ✅ |
| ISO-8859-1 | `ARMAZÉM SÃO JOSÉ` ✅ |

`readSheet` chama `XLSX.read(buffer, { type: 'array' })` sem `codepage`
([`importCore.ts#L63-L69`](../../../src/services/importCore.ts#L63)); o
SheetJS assume CP1252 quando não há BOM. Latin-1 é um superconjunto prático de
CP1252, então o cenário "temido" funciona — e o cenário moderno (export de
Google Sheets, `psql \copy`, qualquer pipeline Unix, uma API) corrompe em
silêncio. `.xlsx` não é afetado (o ZIP carrega XML UTF-8 declarado).

O dano não é cosmético: `validateLocalAgainstDepots` casa `local_code` contra
o Cadastro de Terminais por comparação de texto
([`vaziosImport.ts#L119`](../../../src/services/vaziosImport.ts#L119)), e a
reconciliação de cliente casa por nome. Mojibake vira "local não encontrado" e
"cliente não reconciliado" — um erro de encoding que se apresenta como um erro
de cadastro, o que é a pior forma de falhar.

**Simétrico e oposto nos formatos-texto:** `baplieParser.ts#L40` e
`ceMercanteEdiParser.ts#L27` usam `await file.text()`, que é UTF-8 fixo, sem
fallback. Um Baplie em UNOB/Latin-1 com acento no nome do navio vira `U+FFFD`.
Medido: `"BL EMISSÃO"` em Latin-1 → `"BL EMISS�O"`, e o parser segue em
frente sem erro.

### 2.2 `toNumber` é o achado mais caro do sistema — **Código**

`toNumber` ([`utils.ts#L175-L194`](../../../src/lib/utils.ts#L175)) é usado por
granito, breakbulk, B/L e veículos. Saídas medidas:

| Entrada | Saída | Comentário |
|---|---|---|
| `"1.234"` | `1.234` | ⛔ milhar pt-BR sem decimais → divide por 1000 |
| `"25.500"` | `25.5` | ⛔ idem |
| `"1.234.567"` | `null` | ⛔ descartado em silêncio |
| `"1e3"` | `13` | ⛔ `replace(/[A-Z]+/gi,'')` come o `e` |
| `"R$ 1.234,56"` | `null` | ⛔ o `$` sobrevive à limpeza e quebra o `Number` |
| `"(1.234)"` | `null` | ⛔ negativo contábil |
| `"1.234,56"` | `1234.56` | ✅ |
| `"1,234.56"` | `1234.56` | ✅ |

O caminho até o dinheiro é curto e direto:
`graniteImport.ts` grava `real_weight_kg` a partir de `toNumber`
([`#L120`](../../../src/services/graniteImport.ts#L120)) e
`graniteCharges.ts#L39-L70` multiplica esse valor pela tarifa `per_kg` ou
`per_ton`. Uma célula `1.234` numa planilha COSCO produz uma fatura de
**1,234 kg**. A única validação existente é `> 0`, que essa linha passa.

A ambiguidade `1.234` = mil-duzentos-e-trinta-e-quatro vs. um-vírgula-dois-três-quatro
**não é resolvível linha a linha** — é preciso decidir por planilha, como
`inferDateOrder` já faz para datas em `vaziosImport.ts#L162-L172`. Esse é o
padrão certo, e está aplicado em exatamente um parser.

### 2.3 Colunas ausentes ou cabeçalho deslocado — **Código**

Três parsers usam `createHeaderMapper(rows[0], HEADER_MAP)` sem nenhuma
verificação de colunas obrigatórias: granito, Embarque de Vazios e Vazios de
Importação. Cabeçalhos não reconhecidos são **ignorados por design**
([`importCore.ts#L34`](../../../src/services/importCore.ts#L34)).

Medido, com uma linha de título acima do cabeçalho — o caso mais banal de
planilha de armador:

```
bls importados = 0
erros = ["L2: BL ausente — linha ignorada.", "L3: BL ausente — linha ignorada."]
```

Uma falha **estrutural** (arquivo errado, aba errada, cabeçalho deslocado) se
apresenta como N erros de linha. Com 500 linhas, o operador recebe 500 avisos
truncados em 10 e nenhuma indicação de que o problema é o arquivo. O contraste
está no mesmo repositório: `vehicleImport.ts#L110-L131` varre as abas e falha
com `"Planilha invalida. Colunas obrigatorias: ..."`. É esse o comportamento
correto, e `matchHeaders` já existe para isso.

### 2.4 Datas: quatro políticas diferentes — **Código**

| Módulo | Política |
|---|---|
| `vaziosImport.ts` | Infere DD/MM vs MM/DD pela planilha inteira; serial Excel com faixa de plausibilidade; ISO aceito. **Referência.** |
| `containerDatesImport.ts` | Assume DD/MM sempre quando o primeiro grupo tem ≤2 dígitos. `03/07/2026` numa planilha norte-americana vira 3 de julho, calado. |
| `portalScheduleBulkImport.ts` | ISO ou `DD/MM/AAAA`; o resto vira `invalidCells` (aviso). |
| `graniteImport.ts` | Só `DD/MM/AA(AA)`. **`2026-05-22` retorna `null` sem erro de linha** ([`#L169-L176`](../../../src/services/graniteImport.ts#L169)) — medido. |

O caso granito é uma perda silenciosa de dado: a prontidão de carga some e
nada no preview indica isso.

### 2.5 Dado inválido que atravessa a validação — **Código**

`vaziosImportacaoImport.ts` registra o erro **e empurra a linha assim mesmo**
([`#L64-L86`](../../../src/services/vaziosImportacaoImport.ts#L64)), e a tela
libera o import com `canImport={(m) => m.containers.length > 0}`
([`VaziosImportacao.tsx#L428`](../../../src/pages/VaziosImportacao.tsx#L428)),
rotulando os erros como "Avisos". Medido:

```
containers = [{"container_number":"msku1234567", "tare_kg":3850},
              {"container_number":"NOTACONTAINER","tare_kg":0}]
erros      = ["L2: formato ISO esperado", "L3: formato ISO esperado"]
```

Note também que aqui o container **não é normalizado para maiúsculas**, ao
contrário de `vaziosImport.ts#L69`. `msku1234567` e `MSKU1234567` viram duas
unidades distintas no banco. E `tare_kg` cai para `?? 0` quando ilegível
([`#L76`](../../../src/services/vaziosImportacaoImport.ts#L76)) — zero é um
peso válido para o schema e indistinguível de "não sei".

### 2.6 Portos desconhecidos passam sem sinal — **Código**

`normalizePortCode` casa por `indexOf` de substring numa lista mantida à mão e,
não achando, **devolve o texto cru**
([`portCode.ts#L74-L80`](../../../src/services/portCode.ts#L74)). Medido:
`"GENOA"` → `"GENOA"`, `"SAO FRANCISCO DO SUL"` → texto cru,
`"XXXXX"` → `"XXXXX"`. O POD do B/L passa a ser texto livre e deixa de casar
com a escala. Não há erro de linha para "porto não reconhecido".

---

## 3. Vetor 2 — atomicidade e feedback

### 3.1 O que já é atômico

Sete importadores fecham a escrita numa única RPC `*_transactional`. O melhor
exemplar é o breakbulk: `import_breakbulk_manifest_transactional` recebe
`p_bls`, `p_items` **e `p_errors`** na mesma chamada
([`breakbulkImport.ts#L139-L153`](../../../src/services/breakbulkImport.ts#L139)),
persistindo `row_number` + `error_message` + `raw_data` junto com o lote. Esse
é o formato que os outros deveriam copiar: o relatório de erro fica auditável
depois do fechamento do modal, e não só num toast.

### 3.2 `containerDatesImport` — o caso do cenário da pergunta

É exatamente o cenário "linha 487 corrompida":

```ts
for (const row of uniqueRows) {
  const { error: updateError } = await supabase.from('bl_containers').update({...}).eq('id', container.id)
  if (updateError) throw updateError      // <- 486 já gravadas
  ...
  if (newStatus === 'returned') blsToCheckForInvoice.add(row.bl_id)
}
```

([`containerDatesImport.ts#L108-L140`](../../../src/services/containerDatesImport.ts#L108))

Um `UPDATE` por container, sem transação, com `throw` no primeiro erro. Pior:
a segunda fase chama `createInvoiceForReturnedBL(blId)` — o lote parcial pode
já ter **emitido faturas de demurrage** antes de abortar, e a mensagem que
chega ao operador é o erro cru do PostgREST.

### 3.3 Caudas não transacionais depois de uma RPC atômica

- `blFreightImport.ts#L513-L535`: depois da RPC, insere `import_batches` e faz
  `bls.update({ batch_id })`. Se o `insert` falhar, o operador vê erro **e os
  B/Ls estão importados** — sem lote, sem `batch_id`, com toast de falha.
- `vehicleImport.ts#L339-L358`: cancela faturas e recalcula taxas por B/L num
  loop pós-RPC. Aqui o erro é ao menos capturado e reportado por linha
  ("Ajuste manual no Faturamento") — a mitigação correta quando a operação não
  cabe na transação.
- `customerBase.ts#L104-L118`: upsert em massa (uma statement, ok) seguido de
  um loop de `ensure_customer_contact_email` que faz `throw` no primeiro erro —
  clientes gravados, contatos pela metade.
- `breakbulkImport.ts#L166-L175` e `blFreightImport.ts#L505-L510`: cálculos de
  taxa disparados com `void` + `.catch(() => {})`. Falha de cálculo de taxa é
  invisível por construção.

### 3.4 Loops de RPC: `importCeMercanteRows`

Uma chamada `apply_ce_mercante_update` **por B/L**
([`ceMercanteImport.ts#L175-L185`](../../../src/services/ceMercanteImport.ts#L175)),
sequencial. Para um manifesto de 500 B/Ls são 500 round-trips serializados
(≈50–150 ms cada em rede real) e nenhuma atomicidade. O caminho EDI do mesmo
domínio já resolveu isso com `apply_ce_mercante_manifest`, que valida e grava
tudo dentro da RPC. A planilha ficou para trás.

### 3.5 Qualidade do feedback

Nenhum importador entrega "Erro 500" cru — isso está melhor do que a hipótese
da pergunta. Mas o relatório tem três limitações consistentes:

1. **Truncado.** 8 (`Veiculos.tsx`), 10 (`Granite.tsx`, `VaziosImportacao.tsx`),
   12 (`CargaSolta.tsx`), 20 (`vaziosImport.ts`). Sem exportação, sem "ver
   todos". Com 60 linhas ruins o operador não consegue saber quais são.
2. **Efêmero.** Só o breakbulk persiste os erros no banco. Nos demais, fechar
   o modal apaga o relatório.
3. **Sem distinção de severidade.** "Avisos" e "Erros de parser" são a mesma
   lista com nomes diferentes por tela. Não há um campo que diga se a linha
   entrou ou não — e em `vaziosImportacaoImport` a linha com erro entra.

---

## 4. Vetor 3 — memória e travamento da UI

Todos os parsers rodam **no cliente, na main thread**. A única exceção é o
`pdfjs-dist`, que carrega seu worker de propósito
([`blDocumentPdf.ts#L103-L105`](../../../src/services/blDocumentPdf.ts#L103)).
Nenhum `new Worker` para XLSX ou EDI.

Medições (Node 22, CPU de servidor, **sem** o custo de render do React — num
notebook de operador com Chrome é razoável esperar 2–4× isso):

| Cenário | Tamanho | Tempo de bloqueio |
|---|---|---|
| Baplie, 6.000 containers | 718 KB | **549 ms** |
| XLSX, 20.000 linhas × 5 colunas | 4,2 MB | **833 ms** |

Extrapolando para o teto que o guard permite (`MAX_UPLOAD_BYTES` = 10 MB,
[`fileGuard.ts#L4`](../../../src/lib/fileGuard.ts#L4)): ~2 s para um Baplie de
10 MB e ~2 s para um XLSX no limite — sem `beforeunload`, sem indicador de
progresso além do texto estático "Processando...", e com a aba inerte a
cliques. Não é catastrófico, mas passa do limiar de 100 ms em que a UI deixa
de parecer viva, e o `FileImportModal` processa **múltiplos arquivos em
sequência** (`for (const file of files)`,
[`FileImportModal.tsx#L60-L67`](../../../src/components/shared/FileImportModal.tsx#L60)),
somando os bloqueios sem yield entre eles.

Ponto positivo: `assertUploadSize` roda **antes** de ler o arquivo em todos os
parsers, e o `import('@e965/xlsx')` é dinâmico — o custo fica fora do bundle
inicial.

Ponto negativo: `ChegadasSaidas.tsx#L149-L153` chama `XLSX.read` direto,
contrariando o próprio playbook do repositório (`skills/import-parser/SKILL.md`:
"Nunca chame `XLSX.read` num parser novo"), e valida só o tamanho — não a
extensão.

---

## 5. Vetor 4 — identificação e alias de navio

### 5.1 O alias funciona, mas é frágil a pontuação — **Código**

`canonicalizeVesselName` ([`vesselAlias.ts`](../../../src/lib/vesselAlias.ts))
exige o alias como prefixo **exato** seguido de um espaço. Medido:

| Entrada | Saída | |
|---|---|---|
| `ZYHY JIN QU` | `ZHONG YUAN HAI YUN JIN QU` | ✅ |
| `ZYHY  JIN QU` (espaço duplo) | `ZHONG YUAN HAI YUN JIN QU` | ✅ |
| `C.S. ALGOL` | `COSCO SHIPPING ALGOL` | ✅ |
| `zyhy jin qu` | `ZHONG YUAN HAI YUN JIN QU` | ✅ |
| `ZYHY-JIN QU` | `ZYHY-JIN QU` | ⛔ |
| `C.S ALGOL` (sem ponto final) | `C.S ALGOL` | ⛔ |
| `CS. ALGOL` | `CS. ALGOL` | ⛔ |
| `C S ALGOL` | `C S ALGOL` | ⛔ |
| `M/V ZYHY JIN QU` | `M/V ZYHY JIN QU` | ⛔ |

Na direção do falso positivo o desenho está **correto**: `CSCL ALGOL` e
`CSALGOL` não são reescritos, porque o alias precisa ser um token completo.
A pergunta "atribui carga ao navio errado?" tem resposta **não** pela via do
alias.

### 5.2 O dano real é duplicação de viagem, não troca de navio — **Código**

O alias só é consultado em dois lugares — `blFreightImport.ts#L1170` e
`blDocumentImport.ts#L103-L104` — e em ambos serve para **levantar uma
divergência** que o operador precisa sobrepor. O importador de programação de
navios não o usa:

```ts
// voyages.ts#L321-L325
if (imo && row.vessel?.imo) return row.vessel.imo.trim() === imo
return (row.vessel?.name ?? '').trim().toUpperCase() === name
```

Igualdade exata de string. E quando não casa, o chamador **cria a viagem**:

```ts
// voyageFromSchedule.ts#L133-L142
const existingId = options.voyageId ?? await findVoyageByNumberAndVessel(...)
const voyageId = existingId ?? (await createVoyage({ vesselName: input.vesselName, ... })).id
```

Uma planilha de programação que escreve `ZYHY JIN QU` para uma viagem
cadastrada como `ZHONG YUAN HAI YUN JIN QU`, **sem IMO na coluna**, cria uma
segunda viagem e um segundo navio com o mesmo número de viagem. A carga não vai
para o navio errado — ela se **divide entre dois registros do mesmo navio**,
que é operacionalmente igual de ruim e mais difícil de perceber.

Mitigação existente: quando o IMO está preenchido dos dois lados, ele tem
prioridade e o nome é ignorado. O IMO é o identificador certo; o problema é ele
ser opcional na planilha.

### 5.3 Efeito colateral do alias frágil

Em `blFreightImport`, a divergência de navio exige override do operador. Cada
variante de pontuação não coberta gera um alarme falso. Um gate que dispara
sem motivo treina o operador a sobrepor sem ler — e esse mesmo gate é o que
deveria barrar uma divergência real.

---

## 6. Recomendações

### 6.1 Consertar a fronteira de coerção antes de qualquer outra coisa

`toNumber`, `normalizePortCode` e as quatro políticas de data são o núcleo:
qualquer schema construído por cima de coerções erradas apenas valida um valor
já corrompido. Ordem proposta:

1. **`toNumber` por planilha, não por célula.** Espelhar `inferDateOrder`:
   varrer a coluna, decidir a convenção decimal com a primeira célula que
   desambigua (`1.234,56` ou `1,234.56`), e aplicá-la à coluna toda. Onde nada
   desambigua, `1.234` deve virar **erro de linha**, nunca `1.234`.
2. **`toNumber` deve distinguir "vazio" de "ilegível".** Hoje ambos são `null`
   e cada chamador inventa um default (`?? 0` em vazios de importação). Um
   `parseDecimal(): { ok: true, value } | { ok: false, reason }` força a
   decisão no call-site.
3. **Corrigir a limpeza destrutiva.** `replace(/[A-Z]+/gi,'')` transforma
   `1e3` em `13` e deixa `$` para trás. Trocar por uma whitelist explícita de
   `[0-9.,\-()]` e tratar parênteses como negativo.
4. **Um `parseDate` único** com política declarada por parser
   (`'dmy' | 'mdy' | 'infer'`), o serial Excel com faixa de plausibilidade e
   ISO já implementados em `vaziosImport.ts`. Aceitar ISO em todos.
5. **`normalizePortCode` deve poder falhar.** Passar a devolver
   `{ code, matched: boolean }`; o texto cru continua sendo persistido para
   auditoria, mas o parser emite um erro de linha "porto não reconhecido".

Custo: um módulo `src/lib/coercion.ts` + a migração dos call-sites. Sem isso,
os itens seguintes são cosméticos.

### 6.2 Schemas Zod na saída do parser

O `zod` já é dependência e é usado em `billing.ts`, `voyageForm.ts`,
`financialValidation.ts` e mais quatro módulos — não há decisão nova a tomar,
só extensão de um padrão existente.

O ponto de aplicação **não** é a célula (isso é trabalho da coerção, §6.1) e
**não** é o payload da RPC (tarde demais). É a linha já mapeada, entre
`createHeaderMapper` e o `push`:

```ts
// src/services/importSchemas.ts
export const isoContainer = z.string().trim().toUpperCase()
  .regex(/^[A-Z]{4}\d{7}$/, 'formato ISO esperado (XXXX0000000)')

export const graniteRow = z.object({
  bl_number: z.string().trim().toUpperCase().min(1, 'BL ausente'),
  real_weight_kg: decimal({ min: 0.001, label: 'Real Weight' }),
  cargo_readiness_date: isoDate.nullable(),
  discharge_port: portCode,
})
export type GraniteRow = z.infer<typeof graniteRow>
```

E um helper único que converte `ZodError` no `RowError` que os parsers já
usam, preservando `raw` — assim nada na UI precisa mudar:

```ts
export function parseRow<T>(schema: z.ZodType<T>, raw: unknown, rowNumber: number):
  | { ok: true; value: T }
  | { ok: false; errors: RowError[] } {
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, value: result.data }
  return { ok: false, errors: result.error.issues.map((issue) => ({
    row: rowNumber,
    message: `${issue.path.join('.')}: ${issue.message}`,
    raw,
  })) }
}
```

Três ganhos concretos: (a) `isoContainer` com `.toUpperCase()` fecha o bug de
§2.5 de graça; (b) o tipo `ParsedGraniteBl` deixa de ser escrito à mão e
passa a ser `z.infer`, eliminando a divergência entre o tipo e a validação;
(c) uma linha que falha **não pode** ser empurrada para o array, porque o
schema não devolve valor.

**Onde Zod não resolve nada** — e vale dizer isso explicitamente para não
vender a ferramenta errada: encoding (§2.1), colunas ausentes (§2.3),
atomicidade (§3) e travamento de UI (§4). Zod valida a linha; nenhum desses é
um problema de linha.

### 6.3 Validação estrutural antes da validação de linha

Uma etapa separada e anterior, com mensagem própria — `matchHeaders` já
entrega `missing`, basta usá-lo nos três parsers que não usam:

```
Arquivo não reconhecido como manifesto de granito.
Colunas obrigatórias ausentes: BL, REAL WEIGHT.
Cabeçalhos encontrados na linha 1: "RELATORIO DE CARGAS - COSCO", "", "".
Verifique se o cabeçalho está na primeira linha e se a aba correta foi enviada.
```

Vale também varrer as primeiras ~10 linhas em busca do cabeçalho, como
`vehicleImport` já faz entre abas, em vez de exigir a linha 1.

Para encoding, no mesmo passo: passar `codepage: 65001` quando o buffer
começa com bytes UTF-8 válidos e não-ASCII, e — para `.edi`/`.txt` — decodificar
com `TextDecoder('utf-8', { fatal: true })` e cair para `windows-1252` na
exceção. É determinístico e cabe em ~15 linhas dentro de `readSheet` e de um
`readTextFile` novo.

### 6.4 Rollback atômico

A regra que proponho, e que o repositório já segue em 7 de 13 casos:

> **Toda importação escreve por exatamente uma RPC transacional.** O que não
> couber nessa transação não é parte da importação — é um efeito posterior,
> explicitamente reportado, com reprocessamento manual disponível.

Aplicação, do maior dano para o menor:

1. **`containerDatesImport`** → RPC `import_container_dates_transactional(p_rows)`
   que faz o `UPDATE` em massa e devolve `{updated, unchanged, missing[]}`.
   A emissão de fatura de demurrage sai do loop e vira uma segunda fase,
   depois do commit, com erros coletados (padrão de `vehicleImport`).
2. **`importCeMercanteRows`** → uma RPC de manifesto, espelhando
   `apply_ce_mercante_manifest` que o caminho EDI já tem. Resolve
   atomicidade e os 500 round-trips na mesma mudança.
3. **`blFreightImport`** → mover a criação de `import_batches` e o
   `batch_id` para dentro de `import_bl_freight_transactional`. Hoje o
   operador pode ver erro com o import concluído.
4. **`customerBase`** → mover o loop de contatos para dentro de uma RPC, ou
   coletar os erros em vez de `throw` no primeiro.
5. **Programação de navios** → transação por linha da planilha é aceitável
   (cada viagem é uma unidade de negócio independente), mas precisa de um
   relatório final que diga quais linhas entraram — hoje ele existe e está
   correto; é o único loop desta lista que não vejo motivo para mudar.

**Decisão que precisa ser tomada e hoje não está:** aborto total vs. importação
parcial. Minha recomendação é **não** unificar em "tudo ou nada". O critério
deve ser o dano da linha ruim:

| Classe | Regra | Exemplos |
|---|---|---|
| **Bloqueante** | Aborta o lote | Coluna obrigatória ausente; container fora do padrão ISO; peso ilegível numa carga faturável; CE duplicado |
| **Recuperável** | Importa o resto, registra a linha | B/L não encontrado no sistema; cliente não reconciliado; porto desconhecido; data opcional ilegível |

O que não pode continuar é a classificação ser um acidente da tela. Ela
pertence ao schema (`z.infer` + um flag por campo), não ao `canImport` de cada
página.

### 6.5 Relatório de erro por linha

Três mudanças, em ordem de custo/benefício:

1. **Persistir sempre.** Generalizar o `p_errors` do breakbulk: toda RPC de
   importação recebe as linhas rejeitadas e grava em `import_errors` com
   `row_number`, `error_type`, `error_message`, `raw_data`. O relatório
   sobrevive ao fechamento do modal e vira auditoria.
2. **Parar de truncar.** Trocar as listas `.slice(0, 8|10|12|20)` por uma
   tabela rolável no `FileImportModal` (linha | campo | motivo | valor
   recebido) com download em CSV. O componente é compartilhado — é uma
   mudança, não treze.
3. **Separar severidade na UI.** Duas seções: "Impedem a importação" e
   "Importadas com ressalva", com a contagem de cada uma ao lado do botão.
   Hoje `VaziosImportacao` chama de "Avisos" erros que deveriam bloquear.

### 6.6 Navio e viagem

1. **Aplicar `canonicalizeVesselName` em `findVoyageByNumberAndVessel`**
   nos dois lados da comparação. É uma linha e elimina a duplicação de viagem
   da §5.2.
2. **Tolerar pontuação no alias.** Normalizar removendo `.`, `-`, `/` e
   colapsando espaços **antes** de comparar o prefixo, mantendo a exigência de
   token completo. `C.S ALGOL`, `CS. ALGOL` e `ZYHY-JIN QU` passam a casar sem
   abrir espaço para `CSCL`.
3. **Tornar a lista de aliases dado, não código.** Uma tabela
   `vessel_name_aliases` consultada pelo import; o operador cadastra o alias do
   próximo armador sem deploy.
4. **Exigir IMO na planilha de programação**, ou pelo menos avisar quando
   ausente — é o único identificador que não depende de heurística de nome.

### 6.7 Main thread

Não recomendo Web Worker agora: 550–850 ms não justifica o custo de mover
`@e965/xlsx` e a lógica de parse para um worker, com a serialização de
`ArrayBuffer` e o retrabalho de teste que isso implica. Recomendo, nesta ordem:

1. **`yield` entre arquivos** no `FileImportModal` (`await new Promise(r => setTimeout(r, 0))`),
   para que o loop multi-arquivo não empilhe bloqueios.
2. **Progresso real** ("Lendo 3 de 8: manifesto-santos.xlsx") em vez de
   "Processando...".
3. **Reavaliar o worker** se e quando um Baplie real passar de ~3 MB, ou se o
   limite de 10 MB do `fileGuard` for aumentado. Aí o custo se paga.

---

## 7. Ordem de execução sugerida

| Ordem | Item | Por quê antes do resto |
|---|---|---|
| 1 | `toNumber` + `parseDecimal` por planilha (§6.1) | Erro de faturamento ativo, silencioso |
| 2 | Alias em `findVoyageByNumberAndVessel` (§6.6.1) | Uma linha, elimina viagem duplicada |
| 3 | Encoding: UTF-8 sem BOM e `.edi` Latin-1 (§6.3) | Corrompe dado que já entrou no banco |
| 4 | Baplie: acumulador por container (§8) | Atribuição de carga errada por dialeto |
| 5 | `matchHeaders` nos 3 parsers sem verificação (§6.3) | Barato; melhora todo diagnóstico posterior |
| 6 | `containerDatesImport` transacional (§6.4.1) | Emite fatura em lote parcial |
| 7 | Schemas Zod por linha (§6.2) | Depende de 1 e 5 para valer a pena |
| 8 | `import_errors` + tabela rolável (§6.5) | Melhora contínua, sem urgência |

---

## 8. Anexo — Baplie em detalhe

O parser mantém **estado de container em variáveis soltas do laço** e assume
que `LOC+147` (posição de estiva) abre cada grupo, zerando o acumulador
([`baplieParser.ts#L79-L92`](../../../src/services/baplieParser.ts#L79)).
Duas premissas embutidas nessa escolha, ambas quebráveis por arquivo legítimo:

**Premissa 1 — `EQD` sempre vem depois dos `LOC`/`MEA` do seu container.**
Medido com um arquivo em que `EQD` abre o grupo (dialeto comum fora do
SMDG 2.x):

```
TEMU1234567  pol=null   pod=null   kg=null
TGHU7654325  pol=CNSHA  pod=BRSSA  kg=18500    <- dados do TEMU
```

Todos os containers ficam deslocados em uma posição. O primeiro perde os
dados, os demais herdam os do anterior, e o arquivo inteiro importa **sem um
único erro**.

**Premissa 2 — todo container é precedido por `LOC+147`.** Medido com dois
`EQD` consecutivos sob um único `LOC+147`:

```
TEMU1234567  slot=0010204  bl=BL001  kg=18500
TGHU7654325  slot=0010204  bl=BL001  kg=18500    <- herdado
```

Peso e B/L duplicados, sem aviso.

**Terceiro problema — sem `UNA` e sem release character.** O separador de
segmento é `'` fixo e o `?` de escape do EDIFACT é ignorado
([`#L44`](../../../src/services/baplieParser.ts#L44)). Medido com
`UNA:+.? '` e `O?'BRIEN VESSEL` no `TDT`: o nome do navio sai como `"O?"`.

**Correção recomendada:** trocar o acumulador global por um agrupamento
explícito — segmentar a mensagem em grupos delimitados por `EQD` (ou por
`LOC+147`, o que vier primeiro), montar cada container a partir do seu grupo,
e emitir erro de linha para container sem POL/POD/peso em vez de herdar o
anterior. Ler `UNA` quando presente e respeitar o release character. E, como
o parser hoje não tem **nenhum** canal de erro (`ParsedBaplie` só tem dados),
adicionar `rowErrors` ao tipo de retorno — sem isso não há onde reportar nada
do que está acima.


---

## PR #655 — mensageria, disparo de comunicados e automação de cobrança

Arquivo original incorporado integralmente abaixo. O snapshot, a evidência, os identificadores dos achados e as recomendações são preservados.

# Auditoria de mensageria, disparo de comunicados e automação de cobrança — 2026-09-05

Documento histórico. Retrata o estado do repositório em `bdf2241` (merge da
PR #653). Não é fonte de verdade corrente: em caso de divergência com o
código, o código manda.

Escopo auditado: `send-customer-communication`, `demurrage-dunning`,
`customer-communication-auto-runner`, `portal-email-webhook`,
`_shared/email.ts`, `_shared/portalBounceCascade.ts` e as RPCs
`claim_demurrage_dunning_candidates`, `create_customer_communication_atomic`,
`customer_communication_recipient_allowed`,
`repair_customer_contact_box_fallbacks`.

Decisões de referência: ADR 0058 (canal separado), ADR 0059 (chave global),
ADR 0064 (caixas de comunicação).

## Sumário dos achados

| # | Achado | Severidade | Vetor |
| --- | --- | --- | --- |
| [A1](#a1) | Fallback de caixa religa contato puramente operacional em `financeiro`/`demurrage` | **Alta** | Caixas |
| [A2](#a2) | Evento de bounce do Resend pode ser perdido permanentemente (dedup antes da resolução) | **Alta** | Pipeline |
| [A3](#a3) | Régua reclama eternamente faturas cujo cliente não tem contato em caixa elegível; starvation do lote | **Alta** | Régua |
| [A4](#a4) | Comunicado realmente enviado fica gravado como `simulado` | **Média-alta** | Auditoria |
| [A5](#a5) | `idempotency_key` guarda o e-mail em claro ao lado do `recipient_masked` | **Média** | Auditoria |
| [A6](#a6) | Sem teto por cliente: N faturas × M contatos no mesmo ciclo | **Média** | Spam |
| [A7](#a7) | Notificação de bounce ao cliente escapa da chave global | **Média** | Chave global |
| [A8](#a8) | Índice de idempotência de `customer_communications` inclui coluna mutável `status` | **Baixa (latente)** | Duplicidade |
| [A9](#a9) | Porta de opt-out da régua lê tabela morta (`customer_contact_preferences`) | **Baixa** | Régua |

## Vetor 1 — Trava global e governança

**Veredito: a trava se sustenta no caminho de Comunicado. Existe uma escapada
adjacente (A7), fora do canal.**

O canal inteiro tem um único ponto de saída para o provedor:
`supabase/functions/_shared/email.ts:79` é o único `fetch` para
`api.resend.com` em todo o repositório. Os três consumidores chegam nele assim:

- `send-customer-communication/index.ts:475-492` lê
  `app_settings.communications_enabled` e passa `resendApiKey: enabled ? key : null`;
- `demurrage-dunning/index.ts:260` faz o mesmo (`communicationsEnabled ? key : null`);
- `customer-communication-auto-runner` não fala com o Resend: delega por HTTP
  para `send-customer-communication` (`index.ts:103`), herdando a trava.

Com `resendApiKey` nulo, `sendEmail` grava a tentativa e retorna em dry-run
(`email.ts:66-69`) antes de qualquer I/O de rede. Não há caminho que envie com
a chave desligada.

O fail-safe também está correto nas duas leituras, por motivos diferentes:
`send-customer-communication` usa `.single()` (linha 411) — ausência da linha
`app_settings id=1` vira erro e 500; `demurrage-dunning` usa `.maybeSingle()`
(linha 373) — ausência vira `null` e `Boolean(undefined) === false`. Os dois
degradam para "não enviar". O seed nasce `false`
(`002_business_logic_and_security.sql:31216`) e a coluna é
`DEFAULT false NOT NULL` (`001_initial_schema.sql:472`), como manda a ADR 0059.

A escrita é guardada no servidor por `set_communications_enabled`, que exige
papel `administrativo` e grava em `audit_logs` — conforme a ADR 0059 e coberto
por `comunicadosFundacaoMigration.test.ts:42-43`.

<a id="a7"></a>
### A7 — Notificação de bounce ao cliente escapa da chave global (Média)

`portal-email-webhook/index.ts:134` envia a notificação de bounce ao contato
alternativo do cliente via `sendPortalEmail`, que lê `RESEND_API_KEY`
incondicionalmente (`_shared/portalEmail.ts:28`). Com
`communications_enabled = false`, um contato de cliente recebe um e-mail real.

A ADR 0059 enumera as isenções da chave: "convite, reenvio, recuperação de
senha e alteração de email". Notificação de bounce não está na lista, e o
gatilho dela é justamente um Comunicado que quicou. Em ambiente de
desenvolvimento com a chave desligada — o cenário que a ADR 0059 existe para
proteger — um bounce de teste dispara e-mail a cliente real.

Não é uma falha de implementação da trava; é uma lacuna de escopo entre a ADR
0059 e um caminho de e-mail criado depois dela. A correção é uma decisão de
produto: ou a notificação de bounce entra na lista de isenções (e a ADR 0059
é emendada dizendo por quê), ou ela passa a respeitar a chave.

## Vetor 2 — Resiliência da régua de Demurrage

Cron horário confirmado: `0 * * * *`
(`007_cron_secrets_no_vault.sql:229`). Cadência padrão de 7 dias
(`app_settings.demurrage_dunning_interval_days`).

### Reenvio múltiplo no mesmo dia: protegido, com três camadas

1. **Claim pessimista.** `claim_demurrage_dunning_candidates` insere em
   `demurrage_dunning_claims (invoice_id, attempt_discriminator)` com
   `ON CONFLICT ... DO UPDATE ... WHERE released_at IS NOT NULL`, e só emite o
   candidato se `ROW_COUNT = 1`. Duas execuções simultâneas não pegam a mesma
   fatura. O `FOR UPDATE OF di SKIP LOCKED` reforça.
2. **Porta de cadência.** `attempt_discriminator = attempt_count + 1`, onde
   `attempt_count` conta claims **não liberados**. O claim de um envio
   bem-sucedido nunca é liberado (o handler só libera em `falha`/`pausado`),
   então a fatura só reaparece quando
   `now >= first_billed_at + intervalo × attempt_count`.
3. **Idempotência por destinatário.** `demurrage:{invoice}:{disc}:{email}` é
   `UNIQUE` em `customer_communication_attempts.idempotency_key`
   (`001_initial_schema.sql:4795`). Numa reclamação com o mesmo discriminador,
   `recordAttempt` recebe 23505, devolve a tentativa existente, e `sendEmail`
   corta antes do POST se já houver `provider_message_id`
   (`email.ts:74`). O header `Idempotency-Key` no Resend é a rede final.

A reaper de 30 minutos (`claim_...:3484-3495`) libera claims órfãos só quando
não existe comunicado `enviado`/`simulado` para aquele par — correta em
intenção, mas ver A4 e A8 sobre a fragilidade de usar `status` como sinal.

**Conclusão: não há reenvio duplicado ao mesmo destinatário no mesmo dia.** O
risco de volume é outro e está em A6.

<a id="a3"></a>
### A3 — Loop horário perpétuo e starvation do lote (Alta)

Os dois lados da elegibilidade discordam:

`claim_demurrage_dunning_candidates` (`002:3515-3521`) exige apenas que exista
um `customer_contacts` do cliente com e-mail válido e não suprimido. **Não
filtra `deactivated_at` e não olha `customer_contact_box_links`.**

`loadRecipients` (`demurrage-dunning/index.ts:116-160`) exige
`deactivated_at IS NULL` **e** vínculo com a caixa `financeiro` ou `demurrage`.

Consequência para um cliente cujos contatos ativos estão vinculados só a
`documentacao_operacao` — cenário comum, porque `ensure_customer_contact_email`
(ADR 0064 §6) adiciona **apenas** `documentacao_operacao` a contatos
auto-capturados que não sejam o primeiro principal:

1. A RPC reclama a fatura e insere o claim;
2. `loadRecipients` devolve zero contatos → `sendCandidate` retorna `pausado`
   (`index.ts:234`);
3. O handler libera o claim (`index.ts:396`);
4. `attempt_count` volta a zero, a porta de cadência
   (`now >= first_billed_at + intervalo × 0`) reabre;
5. Hora seguinte, tudo de novo. **Para sempre.**

Nenhum e-mail sai — não é um vetor de spam ao cliente. O dano é outro e é
pior: `ORDER BY di.id LIMIT 50`. Faturas-zumbi com `id` baixo ocupam vagas do
lote em toda execução. Passando de 50 zumbis, **a régua para de cobrar
faturas legítimas em silêncio**, sem erro, sem alerta, com HTTP 200 e
`paused: 50` no corpo da resposta que ninguém lê.

Correção recomendada: alinhar o `EXISTS` da RPC ao critério real de
`loadRecipients` (contato ativo **com vínculo em `financeiro` ou `demurrage`**).
Isso resolve o loop e o starvation de uma vez, no ponto compartilhado. Como
paliativo independente, abrir alerta interno quando `paused > 0` persiste para
a mesma fatura em ciclos consecutivos.

### Critérios de pausa: corretos, com um detalhe

`demurrage_dunning_candidate_sendable` (`002:5762`) revalida `status IN
('issued','overdue') AND paid_at IS NULL AND dispute_open = false`, e é chamado
**duas vezes**: antes do lote de contatos (`index.ts:232`) e **antes de cada
destinatário** (`index.ts:267`). Isso é bom — fecha a janela TOCTOU entre o
claim e o envio.

Disputa aberta, fatura paga e bounce ativo pausam corretamente. "Cliente sem
contato válido" pausa na Edge Function, mas não na RPC — é exatamente A3.

## Vetor 3 — Ciclo de vida das caixas (ADR 0064)

### Segregação no caminho normal: respeitada

`customer_communication_recipient_allowed` (`008:1318`) é a guarda de servidor.
Ela reprova contato desativado, e-mail nulo, e-mail malformado, suprimido por
`bounce_permanente` (compartilhado, ADR 0058) ou por `complaint` de Comunicado,
e — o ponto da ADR 0064 — exige vínculo explícito com a caixa alvo ou com
alguma caixa que mapeie o `kind`. `send-customer-communication:402` a invoca
antes de qualquer registro ou envio. A régua faz o equivalente em SQL
(`loadRecipients`, restrito a `financeiro`/`demurrage`).

Um comunicado financeiro **não** vaza para um contato puramente operacional
por este caminho.

<a id="a1"></a>
### A1 — Mas vaza pelo fallback de reparo (Alta)

`repair_customer_contact_box_fallbacks` (`008:1131`) tem duas ramificações
quando uma caixa fica sem destinatário elegível:

- religa o **contato principal ativo** (`008:1218-1231`) — é o que a ADR 0064 §7
  autoriza: *"vincula o contato principal ativo àquela caixa como fallback"*;
- se não houver principal elegível, religa **qualquer contato ativo**
  (`008:1242-1256`), com `LIMIT 1` **e sem `ORDER BY`**.

A segunda ramificação não está na ADR. E o efeito dela é concreto: um contato
cadastrado deliberadamente só em `documentacao_operacao` — um despachante, um
terminal, um operador de armazém, um terceiro que não é o cliente — passa a
receber **cobrança de Demurrage e CE/Taxas** do cliente. É vazamento de dado
financeiro para fora da relação comercial, disparado por um evento automático
(bounce permanente do principal), sem revisão humana e sem sinal na tela.

Agravante: sem `ORDER BY`, o contato escolhido é o que o planner devolver. O
mesmo cliente pode receber substitutos diferentes em execuções diferentes, o
que torna o comportamento não reproduzível em investigação.

O caminho de acionamento é real e curto:
`portal-email-webhook:378` chama a RPC para todo `customerId` afetado por
bounce permanente, **antes** da cascata de notificação.

Correção recomendada, em ordem de preferência:

1. Remover a ramificação de substituto para as caixas `financeiro` e
   `demurrage`. Ficar sem destinatário financeiro é um fato operacional que
   merece triagem humana — que já existe: o alerta `caixa_sem_destinatario`
   (`008:1268`). Manter o substituto só para `documentacao_operacao`, se a
   equipe julgar que cobertura operacional vale mais que precisão de
   roteamento.

   O próprio código já assume esse desfecho. O comentário de invariante em
   `008_portal_contact_boxes.sql:681-683` diz, sobre
   `_apply_customer_contact_configuration`: *"O repair() deliberadamente
   permite caixa bloqueada vazia; este nucleo nao pode contradize-lo."*
   Caixa vazia com alerta já é um estado aceito e desenhado. Remover a
   ramificação de substituto para as caixas financeiras não introduz um estado
   novo — apenas deixa de trocar um estado já previsto e visível (caixa vazia,
   alerta aberto) por um estado invisível e pior (cobrança endereçada a um
   terceiro).
2. Se a ramificação ficar, restringi-la a contatos que já tenham vínculo com
   **alguma** caixa da mesma família e dar-lhe `ORDER BY id` para ser
   determinística.

Em qualquer dos casos, a ADR 0064 §7 precisa ser emendada para descrever o
comportamento real — hoje ela descreve só metade da função.

### Loops de bounce: contidos

O quebra-loop está em `portal-email-webhook:344`:
`permanentBounce && portalAttempt?.kind !== BOUNCE_NOTIFICATION_KIND`. Se a
própria notificação de bounce quicar, a cascata não roda de novo.

A convergência do segundo salto também está garantida, por um caminho
diferente: quando A quica, A entra em `portal_suppressed_emails` **antes** da
cascata (`index.ts:294`); se depois B quicar, `isValidAlternative`
(`portalBounceCascade.ts:31-38`) exclui A por `portalSuppressedEmails`. O
conjunto de alternativas só encolhe. Não há ciclo.

`openNoAlternativeAlert` usa `upsert_alert_item` e `openAlertOnce` — sem
enxurrada de alertas repetidos.

**Não há loop infinito.** Este vetor está sólido.

## Vetor 4 — Auditoria e logs

### Toda tentativa gera registro: sim

`recordAttempt` é chamado por `sendEmail` (`email.ts:64`) **antes** de decidir
entre dry-run e POST, e antes de qualquer I/O com o provedor. Não existe envio
sem linha em `customer_communication_attempts`. A janela de crash entre
persistência e chamada HTTP está tratada e comentada em `email.ts:71-75`:
`aceito` só é terminal com `provider_message_id`.

<a id="a4"></a>
### A4 — Comunicado enviado gravado como `simulado` (Média-alta)

`create_customer_communication_atomic` insere com `status = 'simulado'`
(`002:4347`) — o mesmo valor que a ADR 0059 reserva para "registrado, nada
saiu". O estado inicial e o estado terminal simulado são indistinguíveis.

Em `demurrage-dunning/sendCandidate`, o `status` real só é gravado na linha
333, no fim da função. Dois caminhos saem antes dela **depois** de já ter
enviado e-mail:

- **Pausa no meio do laço** (`index.ts:267`): contato 1 recebe e-mail real,
  disputa é aberta ou a fatura é paga, contato 2 revalida e a função retorna
  `pausado`. O `update` da linha 333 nunca roda.
- **Exceção na revalidação** (mesma linha 267): a chamada está **fora** do
  `try` que começa na linha 270. Um erro transitório de rede na RPC propaga
  para o `catch` do handler (`index.ts:402`), que conta `failed` e libera o
  claim — sem tocar no `status`. Este é o gatilho provável, e não depende de
  nenhuma corrida improvável.

O registro fica `simulado`. Pior, é **permanente** no primeiro caso: com
`dispute_open = true` ou `paid_at` preenchido, a fatura nunca mais é reclamada,
então nada corrige a linha depois.

Isso contraria diretamente a ADR 0059: *"o histórico passa a conter comunicados
que nunca saíram; eles são marcados, e qualquer leitura precisa distinguir
enviado de simulado"*. A distinção existe no papel e falha no registro. Numa
régua de cobrança, "provamos que notificamos" é o produto — e o banco diz que
não notificamos.

Correção recomendada: separar o estado inicial do terminal. Um valor
`pendente` no `CHECK` de `customer_communications_status_check`, gravado pela
RPC, e a transição para `enviado`/`simulado`/`falha` num `finally`. Isso torna
a inconsistência visível (linhas presas em `pendente`) em vez de silenciosa, e
dá à reaper de 30 minutos um sinal honesto para trabalhar.

<a id="a5"></a>
### A5 — E-mail em claro ao lado do campo mascarado (Média)

`customer_communication_attempts` guarda `recipient_masked`
(`j***@e***.com`, via `maskEmail`) e, na coluna vizinha,
`idempotency_key = 'demurrage:{invoice}:{disc}:joao@empresa.com'` — o endereço
completo, em texto puro. A tabela tem `GRANT SELECT ... TO authenticated` com
policy `is_active_read_user()` (`002:24980,30643`): o mesmo público lê as duas
colunas.

O mascaramento não protege nada, e cobra caro: `maskEmail` não é injetivo.
`joao@empresa.com` e `jose@empresa.com` colapsam em `j***@e***.com`. Pela
coluna que deveria ser a trilha de auditoria, é impossível dizer qual dos dois
contatos recebeu a cobrança.

E a ADR 0064 §8 aponta exatamente para essa trilha como fonte de auditoria:
*"a trilha `customer_communications` + tentativas é a fonte de auditoria do que
foi enviado"*. Ela não consegue responder "para quem".

É preciso escolher um dos dois lados, não ficar nos dois:

- **Se a auditoria manda** (é o que a natureza de cobrança sugere): gravar
  `contact_id` na tentativa. Resolve a identificação sem expor endereço a mais
  do que já está exposto, e sobrevive à troca de e-mail do contato.
- **Se a minimização manda**: derivar a `idempotency_key` de um hash do
  endereço, não do endereço. Aí o mascaramento passa a valer alguma coisa —
  mas a trilha continua sem responder "para quem", e a ADR 0064 §8 precisa
  reconhecer isso.

A recomendação é a primeira: `contact_id` na tentativa, e a `idempotency_key`
derivada de `contact_id` em vez do endereço.

## Diagnóstico de risco: spam e envios duplicados

**Duplicidade ao mesmo destinatário: risco baixo.** Três camadas independentes
(claim, `idempotency_key` único, header `Idempotency-Key` do Resend), e o
corte antecipado em `email.ts:74` quando já há `provider_message_id`. Não
encontrei caminho que entregue o mesmo comunicado duas vezes ao mesmo
endereço.

<a id="a6"></a>
### A6 — Volume por cliente, sem teto (Média)

O que não existe é controle de **volume agregado**. A cadência é por fatura
(`di.id`), nunca por cliente. `docs/modules/demurrage.md:203` registra a
ausência de teto como decisão consciente ("sem teto") — o que torna isto um
risco aceito, não um defeito. Mas o risco merece ser dimensionado:

- Cliente com 12 faturas de Demurrage em aberto e 3 contatos na caixa
  `financeiro` recebe **36 e-mails na mesma execução horária**, todos do mesmo
  remetente `portal@`, todos sobre cobrança.
- O lote é de 50 faturas por ciclo, então o pico teórico por hora é
  50 × (contatos por cliente).
- Não há atraso entre destinatários nem entre candidatos: o laço de
  `demurrage-dunning:266` dispara em sequência, sem pausa.

Trinta e seis e-mails idênticos em estrutura, na mesma hora, do mesmo domínio
é um padrão que filtros anti-spam classificam mal. A ADR 0058 identifica esse
dano com precisão — degradar a reputação do domínio derruba junto os convites
do Portal — e o descreve como aquilo que "o teto da Régua de Cobrança existe
para evitar". **Esse teto não está implementado.**

Recomendação: um comunicado por cliente por ciclo, agregando as faturas
vencidas num único e-mail (o template já recebe lista de B/Ls). Alternativa
mais barata: teto de N comunicados de Demurrage por cliente por dia, com o
excedente adiado para o ciclo seguinte.

**Vetor de spam interno adicional:** A3 gera 50 claims/liberações por hora,
indefinidamente, sem custo de e-mail mas com custo de banco e ocupando o lote.

## Integridade do pipeline Resend → Webhook → Banco

O caminho de entrada está bem defendido: assinatura Svix verificada com
`tolerance: 300` (`portal-email-webhook:230`), e dedup por `svix-id` numa
linha `UNIQUE` em `portal_email_events` (`index.ts:236`). Assinatura inválida
para em 401 antes de tocar no banco.

<a id="a2"></a>
### A2 — Evento perdido para sempre pela ordem dedup → resolução (Alta)

A ordem das operações no handler é:

1. `INSERT` do `svix-id` em `portal_email_events` (linha 236) — a partir
   daqui, **qualquer retry do Resend com o mesmo `svix-id` recebe 200 e não
   reprocessa nada** (linha 240);
2. resolução da tentativa por `provider_message_id` (linhas 249-263);
3. `if (!portalAttempt && !communicationAttempt) return 200` (linha 265).

O passo 3 descarta o evento **em silêncio, com o `svix-id` já queimado**.

A janela é real. Em `sendEmail`, o `provider_message_id` só é gravado por
`updateAttempt` **depois** que o POST ao Resend retorna (`email.ts:103-110`).
O webhook de `email.bounced` — sobretudo bounce síncrono de domínio
inexistente — pode chegar antes desse commit, ainda mais quando a execução
está no meio de um laço de destinatários com backoff de até 13 segundos.
Quando isso acontece:

- o bounce nunca vira `portal_suppressed_emails`;
- o endereço morto **continua elegível** para a régua e para os comunicados;
- `repair_customer_contact_box_fallbacks` nunca é acionado para aquele cliente;
- o retry do Resend, que existe exatamente para isso, é neutralizado pelo
  dedup.

O sistema insiste num endereço que não existe, ciclo após ciclo — o dano de
reputação de domínio que a ADR 0058 nomeia.

Correção recomendada: **só marcar o `svix-id` como processado depois de
resolvê-lo.** Em ordem de robustez:

1. Persistir o evento como não processado, e a resolução marcar
   `processed_at`; devolver 500 quando a tentativa não for encontrada, para
   que o retry do Resend tenha efeito. O dedup passa a checar
   `processed_at IS NOT NULL`.
2. Mínimo viável: quando nenhuma tentativa for encontrada, **apagar a linha de
   dedup** e devolver 500, deixando o retry do Resend fazer o trabalho.

### Outras observações do pipeline

- Falhas de `update` em `portal_email_attempts` e
  `customer_communication_attempts` são apenas logadas (linhas 269, 280). O
  handler devolve 200. É deliberado — o comentário em 322-329 explica o
  raciocínio para os alertas — mas aqui o efeito é o mesmo de A2: o status da
  tentativa fica desatualizado sem sinal e sem retry.
- `customer_communications.status` não é revisto quando o webhook registra
  `bounce` na única tentativa: o comunicado permanece `enviado` embora nada
  tenha sido entregue. É coerente com o modelo (a verdade da entrega é da
  tentativa), mas quem lê o histórico pelo cabeçalho lê errado. Vale registrar
  a regra de leitura em `docs/modules/`.
- `recordPortalSuppression` trata a hierarquia corretamente: `bounce_permanente`
  faz upsert e escala uma linha de `complaint`; `complaint` nunca rebaixa um
  `bounce_permanente` existente (linhas 66-72). Está de acordo com a ADR 0058.

<a id="a8"></a>
### A8 — `status` dentro do índice de idempotência (Baixa, latente)

```sql
CREATE UNIQUE INDEX customer_communications_idempotency
  ON public.customer_communications
  (kind, customer_id, status, anchor_voyage_id, anchor_port,
   anchor_atracacao_id, anchor_invoice_id, dispatch_id, attempt_discriminator)
  NULLS NOT DISTINCT;
```

`status` é mutável e muda depois do envio. Uma chave de idempotência
construída sobre coluna mutável deixa de restringir assim que o valor muda:
nada no índice impede que coexistam uma linha `enviado` e uma `simulado` para
o mesmo par âncora/discriminador.

Hoje isso não produz duplicata, porque o `SELECT ... FOR UPDATE` dentro de
`create_customer_communication_atomic` (`002:4320-4339`) **não filtra por
status** e reencontra a linha antiga. Ou seja: a proteção efetiva está no
corpo da RPC, e o índice — que deveria ser o backstop — não cobre o caso que
importa. Qualquer futuro caminho de escrita que insira sem passar pela RPC
duplica sem violar restrição.

Correção recomendada: remover `status` da chave do índice.

<a id="a9"></a>
### A9 — Porta de opt-out lê tabela morta (Baixa)

`claim_demurrage_dunning_candidates` (`002:3521`) avalia
`COALESCE((SELECT ccp.enabled FROM customer_contact_preferences ccp WHERE
ccp.contact_id = cc.id AND ccp.nature = 'demurrage'), true)`.

A ADR 0064 §9 declara que nenhuma consulta de produção lê essa tabela, e a
migration `008_portal_contact_boxes.sql:202` derruba
`trg_seed_customer_contact_preferences`. Contatos criados depois de 008 não
têm linha ali, então o `COALESCE` devolve `true` sempre: **a cláusula é
código morto que sempre aprova.** Não é falha de segurança — falha para o lado
permissivo do que a ADR já decidiu — mas é uma armadilha de leitura, porque
aparenta ser um controle de opt-out que não controla nada. Some junto com a
correção de A3.

## Checklist de validação pré-disparo

Para usar antes de ligar `communications_enabled` em produção, e como roteiro
de regressão a cada mudança na esteira.

### Bloqueadores — não ligar a chave sem isto

- [ ] **A2 corrigido.** Um `email.bounced` cujo `provider_message_id` ainda não
      está no banco deve resultar em retry efetivo, não em 200 silencioso.
      Teste: enfileirar o webhook antes do commit da tentativa e conferir que
      o endereço acaba em `portal_suppressed_emails`.
- [ ] **A1 decidido e implementado.** Provar, com um cliente cujo principal
      quicou e cujo único contato restante está só em `documentacao_operacao`,
      que ele **não** passa a receber `cobranca_demurrage`.
- [ ] **A3 corrigido.** O `EXISTS` da RPC de claim reflete o critério real de
      `loadRecipients`. Verificar em duas execuções consecutivas que uma
      fatura sem contato em caixa elegível **não** é reclamada de novo.
- [ ] **A6 dimensionado.** Contar, sobre os dados reais de produção,
      `COUNT(*)` de faturas elegíveis agrupadas por cliente. Se algum cliente
      passar de 3, implementar a agregação por cliente antes de ligar.

### Verificações operacionais antes de cada disparo em massa

- [ ] `SELECT communications_enabled FROM app_settings WHERE id = 1` confere
      com a intenção, e a faixa da tela concorda com o banco.
- [ ] `RESEND_API_KEY`, `PORTAL_FROM_EMAIL`, `COMMUNICATIONS_REPLY_TO` e
      `RESEND_WEBHOOK_SECRET` provisionados. Sem `RESEND_WEBHOOK_SECRET`
      válido, todo bounce é descartado em 401 e nenhuma supressão é registrada
      — a esteira envia às cegas.
- [ ] Webhook do Resend apontando para `portal-email-webhook`, com
      `email.delivered`, `email.bounced` e `email.complained` inscritos.
      Confirmar com um evento de teste que chega linha em
      `portal_email_events`.
- [ ] SPF, DKIM e DMARC do domínio de `PORTAL_FROM_EMAIL` verificados no
      Resend. Os dois canais dividem o remetente (ADR 0058); reputação é única.
- [ ] Ensaio completo com a chave **desligada**: conferir que o histórico
      grava `simulado`, que a tentativa é registrada, e que nada aparece no
      painel do Resend.

### Conferência de destinatários, por disparo

- [ ] A prévia por caixa foi conferida por uma pessoa, e a contagem de
      destinatários bate com a expectativa.
- [ ] Nenhum destinatário da lista está em `portal_suppressed_emails`
      (`bounce_permanente`) ou `customer_communication_suppressions`.
- [ ] Para comunicado financeiro: cada destinatário tem vínculo **explícito**
      com `financeiro`, e não um vínculo criado por
      `repair_customer_contact_box_fallbacks`. Consultar
      `customer_contact_change_events` por `change_summary->>'action' =
      'bounce_fallback_repair'` no cliente antes de disparar.
- [ ] Alertas `caixa_sem_destinatario` e `cliente_sem_contato_principal`
      abertos foram triados. Cada um é um cliente que ou não vai receber, ou
      vai receber pelo endereço errado.

### Após o disparo

- [ ] Toda linha de `customer_communications` do lote tem status terminal
      coerente. Enquanto A4 não for corrigido, checar especificamente se
      existe `status = 'simulado'` com tentativa carregando
      `provider_message_id` — é a assinatura do registro falsificado:

      ```sql
      SELECT c.id, c.status, a.provider_message_id
      FROM customer_communications c
      JOIN customer_communication_attempts a ON a.communication_id = c.id
      WHERE c.status = 'simulado' AND a.provider_message_id IS NOT NULL;
      ```

- [ ] Contagem de tentativas do lote bate com a contagem de destinatários
      conferida na prévia.
- [ ] Após ~15 minutos, conferir que os eventos `delivered` do Resend viraram
      `status = 'entregue'`. Tentativas paradas em `aceito` com
      `provider_message_id` preenchido são candidatas ao sintoma de A2.
- [ ] `paused` e `releaseFailures` na resposta de `demurrage-dunning` estão em
      zero, ou têm explicação.

## Recomendação de prioridade

1. **A2** — perda de bounce é o achado com pior composição: silencioso,
   permanente, e ataca a reputação do domínio que os dois canais dividem.
2. **A1** — vazamento de cobrança para terceiro operacional. Baixo esforço de
   correção, alto custo se acontecer.
3. **A3** — hoje é desperdício; quando os zumbis passarem de 50, vira falha
   total e silenciosa da cobrança.
4. **A6** — decidir e implementar o teto **antes** de ligar a chave, não
   depois do primeiro cliente com carteira grande.
5. **A4 e A5** — integridade da trilha. Não afetam entrega, afetam a
   capacidade de provar o que foi entregue — que é o produto de uma régua de
   cobrança.
6. **A7, A8, A9** — higiene, junto com as correções acima.

## O que esta auditoria não cobriu

- Nenhum teste foi executado contra banco real; as conclusões vêm de leitura
  de código e migrations em `bdf2241`.
- Templates e identidade visual (`_shared/customerCommunicationTemplates.ts`,
  `portalEmailTemplates.ts`) não foram auditados.
- `alerts-detector` e `portal-daily-digest` ficaram fora do escopo: não usam a
  chave global nem o canal de Comunicado.
- `evaluate_and_dispatch_automatic_communications` (a RPC de candidatura do
  auto-runner) não foi auditada em profundidade; o auto-runner em si foi.


---

## PR #656 — performance, renderização React e experiência do operador

Arquivo original incorporado integralmente abaixo. O snapshot, a evidência, os identificadores dos achados e as recomendações são preservados.

# Auditoria — performance, renderização React e experiência do operador

> **Snapshot histórico.** Este documento descreve o repositório e o projeto
> Supabase de produção em 2026-09-05. Para o estado atual, consulte o código e
> o banco.

**Data:** 2026-09-05 · **Branch:** `claude/transhipping-performance-audit-6z2p43` ·
**Escopo:** camada cliente (React 19, TanStack Query v5, Vite 8) — over-fetching,
re-render, comportamento offline, acessibilidade das telas densas.
**Rótulos de evidência:** [`docs/CONVENCOES.md`](../../CONVENCOES.md).

---

## Antes de ler: a premissa do pedido está parcialmente errada

O pedido assume um sistema sofrendo com volume ("milhares de linhas de B/Ls",
"DOM sobrecarregado", "Web Vitals"). **Isso não é o que os dados mostram.**

**Evidência: Runtime** (`pg_stat_user_tables` + `count(*)`, projeto
`fgmkhbzhaeebrsizwccx`, 2026-09-05):

| Tabela | Linhas hoje |
|---|---|
| `alert_item_events` | 11.523 |
| `audit_logs` | 269 |
| `voyages` | 36 |
| `bls` | **0** |
| `bl_containers` | **0** |
| `vehicles` | **0** |
| `customers` | **0** |

Os dados operacionais foram zerados (ver
[`docs/operations/reset-ambiente.md`](../../operations/reset-ambiente.md)). A
auditoria anterior
([2026-08-12](2026-08-12-investigacao-lentidao-carregamento-paginas.md)) já havia
medido o pico histórico: 135 B/Ls, 1.112 containers, 1.378 veículos — e concluído
que **volume não era gargalo**. O
[baseline de banco de 2026-08-13](../reports/2026-08-13-baseline-performance-producao.md)
fechou a mesma conclusão do lado do Postgres: 32 ms na consulta mais cara.

Três consequências para este relatório, ditas na cara:

1. **Não existe medição de CPU/memória de produção a ser feita hoje.** Um
   profile do navegador contra a base atual mediria uma tela vazia. Toda
   afirmação abaixo é **Código** — leitura estática do custo algorítmico — e
   não **Runtime**. Onde eu digo "vai doer", é projeção declarada, não medição.
2. **Nenhum dos achados é uma emergência de performance hoje.** São dívidas de
   escala: o código foi escrito com custo O(tabela) em pontos onde o banco já
   oferece filtro e paginação. O sintoma aparece na primeira safra grande de
   B/Ls, não antes.
3. **A pergunta "há virtualização de lista?" está mal calibrada** para este
   sistema. As telas densas já paginam em 20/50/100 linhas
   (`src/hooks/usePageFilters.ts:3`). Virtualizar uma tabela de 100 linhas é
   otimização prematura que custa acessibilidade (`Ctrl+F` do navegador, leitor
   de tela, impressão). O detalhe está em [§4](#4-virtualização-onde-sim-onde-não).

O que **é** real e vale corrigir está abaixo, ordenado por custo × probabilidade.

---

## Sumário dos achados

| # | Achado | Custo | Onde | Evidência |
|---|---|---|---|---|
| 1 | Busca livre sem debounce dispara varredura completa de `bls` com 5 embeds a **cada tecla** | Alto (escala) | `useBlSummary`, `useBls` | Código |
| 2 | `useContainers` materializa a tabela inteira no navegador para filtrar e paginar em JS | Alto (escala) | `src/hooks/useBls.ts:99` | Código |
| 3 | `useVoyages` carrega todas as viagens com 6 níveis de embed, e abre um waterfall de 2 fases | Alto (escala) | `src/hooks/useBls.ts:336` | Código |
| 4 | Zero memoização de render em todo o `src/` — nenhum `React.memo` | Médio | global | Código |
| 5 | `LineUpTVDisplay` repete um waterfall serial de 5 etapas a cada 30 s, 24/7 | Médio | `src/pages/LineUpTVDisplay.tsx:50` | Código |
| 6 | Vazamento de listeners: `useMemo` usado como `useEffect` | Baixo | `Containers.tsx`, `Manifestos.tsx` | **Teste** — corrigido nesta mudança |
| 7 | Offline: query pausada aparece como "nenhum registro", não como "sem conexão" | Médio (UX) | global | Código |
| 8 | `--app-muted-soft` reprova em contraste AA (3,03–3,68:1) em 78 usos | Médio (a11y) | `src/index.css:23` | Código |
| 9 | Tabelas sem `aria-sort` e sem `<caption>`; zero ocorrências no repositório | Baixo (a11y) | global | Código |

---

## 1. Os cinco maiores gargalos de CPU e memória

### 1.1 — Varredura completa de `bls` a cada tecla digitada

**Evidência: Código.** `useBlSummary` (`src/hooks/useBls.ts:135`) chama
`fetchAllBls`, que faz um laço de paginação de 1.000 em 1.000 até esgotar a
tabela, com este `select`:

```
*, customer(...), voyage(...vessel(...carrier(...))),
bl_containers(15 colunas), bl_freight_lines(8 colunas), bl_breakbulk_items(8 colunas)
```

A `queryKey` do resumo é `toSummaryFilters(filters)`, que remove **apenas**
`page` e `pageSize` — `search` continua na chave (`src/hooks/useBls.ts:582`). O
campo de busca de `/manifestos` grava direto no filtro, sem debounce:

```tsx
// src/pages/Manifestos.tsx:230
onChange={(event) => updateFilter('search', event.target.value)}
```

Resultado: digitar `CE-2026-001` (11 caracteres) produz **11 chaves de cache
distintas**, cada uma disparando uma varredura completa de `bls` com os cinco
embeds — e mantendo as 11 respostas vivas no cache do TanStack Query pelo
`gcTime` padrão de 5 minutos.

O mesmo caminho é reusado por `useBls` quando o operador filtra por
`cargoProfile` ou `chargeStatus` (`src/hooks/useBls.ts:68`) — aí a paginação
some e a página inteira passa a ser servida a partir de um `slice()` em memória.

**Custo projetado.** A 2.000 B/Ls × ~12 containers, uma resposta dessas passa de
20 MB de JSON. Multiplicado por 11 teclas, com todas retidas no cache: a aba
morre por memória antes de o operador terminar de digitar.

**Correção.**
- Debounce de 300 ms no campo (o projeto já tem a constante e o padrão em
  `src/components/ui/Combobox.tsx:28`) — remove 10 das 11 requisições, ~30 min
  de trabalho, zero risco.
- Tirar `search` da chave do resumo: o KPI de topo raramente precisa reagir ao
  texto livre; se precisar, ele deve vir de uma RPC de agregação, não de um
  `rows.filter()` no cliente (`src/hooks/useBls.ts:142-148`).
- Substituir `fetchAllBls` por uma RPC `bl_summary(filters)` que devolve sete
  inteiros. Os seis `filter()` do resumo são `count(*) FILTER (WHERE ...)` em SQL.

### 1.2 — `useContainers` pagina em JavaScript, não em Postgres

**Evidência: Código.** O próprio código admite (`src/hooks/useBls.ts:99`):

```ts
// ponytail: este filtro materializa todos os B/Ls/containers no cliente (O(tabela))
// para preservar filtros derivados; upgrade path = agregacao/filtros server-side.
```

O comentário `ponytail:` está correto e nomeia o teto — isso é a convenção do
projeto funcionando. O que ele não diz é que a página **soma três** varreduras
completas por carregamento:

| Hook | O que varre | Para quê |
|---|---|---|
| `useContainers` | `bls` + todos os embeds | listar 20 containers |
| `usePortOptions` | `bls` inteira (`pol, pod`) | preencher dois `<select>` |
| `useContainerTypeOptions` | `bl_containers` inteira (`type`) | preencher um `<select>` |

Os dois últimos existem só para montar combos de valores distintos. Isso é
`SELECT DISTINCT` — uma view ou RPC de ~10 linhas, resposta de poucos KB, com
`staleTime` alto (já são 10 min, o que ajuda mas não muda o custo da primeira
carga).

**Correção.** Nesta ordem de retorno sobre esforço:
1. `create view bl_port_options as select distinct pol, pod from bls` (+ idem
   para tipos de container). Elimina duas varreduras por página, ~1 h.
2. Mover `search`, `containerType` e `vehicleContainer` para o servidor —
   `search` já é aplicado por `normalizeText().includes()` no cliente
   (`src/hooks/useBls.ts:578`), o que é um `ilike` disfarçado.
3. `cargoProfile` (OOG/IMO) e a contagem de containers distintos exigem
   agregação — candidatos naturais a uma RPC única que devolve linhas + KPIs.

### 1.3 — `useVoyages`: um embed de seis níveis e um waterfall de duas fases

**Evidência: Código.** `src/hooks/useBls.ts:336` monta uma única query com:

```
voyages → vessel → carrier
        → import_batches
        → granite_manifests → granite_bls
        → vazios_manifests  → vazios_bookings → operation, local
        → bls → bl_containers (9 colunas), bl_breakbulk_items
```

sem `limit`, em laço de 1.000. Todos os containers de todos os B/Ls de todas as
viagens, em uma resposta — para desenhar uma faixa de cards
(`VoyageRail`) que exibe contagens agregadas.

Pior: `voyageIds` é derivado **do resultado** dessa query
(`src/pages/Viagens.tsx:152`), e nove outras queries dependem dele
(`useVoyageVehicleStats`, `useVaziosImportacaoStats` e as sete de
`useViagemSchedulesAndStats`). A página tem duas fases obrigatoriamente serial:
a query mais pesada do sistema **precede** todas as outras. É o achado D da
auditoria de 2026-08-12, ainda vivo.

**Correção.** A faixa precisa de ~10 campos por viagem, todos agregáveis:
`blCount`, `containerCount`, cobertura de CE, flags de módulo. Uma view
`voyage_rail_summary` os entrega em uma linha por viagem — resposta de KB, e
`voyageIds` fica disponível imediatamente, colapsando o waterfall para uma fase.
Este é o item de maior retorno da auditoria inteira e o mais caro (~2 dias).

### 1.4 — Zero memoização de render em todo o `src/`

**Evidência: Código.**

```
$ grep -rn "React.memo\|memo(" --include=*.tsx src | grep -v useMemo
(nenhum resultado)
```

29 usos de `useCallback` em ~950 arquivos. Consequência concreta: em
`/containers`, cada tecla no campo de busca troca `filters`, o que re-renderiza
`Containers` inteira — cabeçalho, dez `<Field>`, cinco `MetricCard`, o card de
resumo por tipo e as 20 linhas da tabela com seus badges. A tabela não depende
do texto (ela vem de `data`), mas re-renderiza junto porque nada a isola.

**Correção — na ordem que importa:**
1. **Debounce primeiro.** Ele elimina ~90% dos renders na origem. Sem debounce,
   memoizar é tapar o sintoma.
2. Extrair a linha da tabela para um componente com `React.memo` **apenas nas
   telas que renderizam ≥50 linhas** e com props escalares (`bl.id`, strings),
   não objetos recriados. Memoizar linha com prop-objeto instável é custo puro.
3. `useCallback` só nos handlers passados a componentes memoizados. Espalhar
   `useCallback` sem `React.memo` do outro lado não economiza nada — é ruído.

Um aviso honesto: React 19 tem o compilador, mas este projeto **não o usa**
(`vite.config.ts` carrega `@vitejs/plugin-react` sem `babel-plugin-react-compiler`).
Habilitá-lo resolveria a maior parte deste item sem escrever `memo` à mão, e é
uma experiência de meio dia — vale tentar antes de memoizar manualmente.

### 1.5 — Line Up de TV: waterfall serial repetido a cada 30 s, para sempre

**Evidência: Código.** `src/pages/LineUpTVDisplay.tsx:50` usa
`refetchInterval: 30_000`. O `queryFn` é
(`src/services/lineup.ts:474-620`) uma cadeia estritamente serial:

`voyages (limit 60)` → `bls` por chunk de 25 viagens → `bl_containers` por chunk
de 250 B/Ls → `vehicles` → manifestos de vazios → containers de vazios.

Cada etapa tem laço de paginação próprio. É a única tela do sistema que roda em
loop, tipicamente numa TV que fica ligada o dia inteiro — 2.880 execuções por
dia deste waterfall.

**Correção.** Uma RPC `lineup_snapshot()` que faz os `join`/`count` em SQL e
devolve as ~60 linhas prontas. É o caso mais claro de todo o relatório: o dado
é agregado, o consumidor é read-only e a repetição é infinita.

---

## 2. Bug corrigido nesta mudança: vazamento de listeners

**Evidência: Teste.** `src/pages/Containers.tsx` e `src/pages/Manifestos.tsx`
registravam quatro listeners globais (`scroll`, `resize`, `keydown`,
`mousedown`) dentro de um **`useMemo`**:

```tsx
useMemo(() => {
  if (!actionsMenu) return
  window.addEventListener('scroll', close, true)
  // ...
  return () => { window.removeEventListener('scroll', close, true) /* ... */ }
}, [actionsMenu])
```

O React **descarta** o valor de retorno de um `useMemo` — a função de limpeza
nunca é chamada. Cada abertura do menu "⋯" de uma linha somava quatro listeners
permanentes, e eles sobreviviam à navegação para outra rota. Num turno de
trabalho com dezenas de aberturas, é vazamento de memória **e** de CPU: cada
evento de `scroll` passa a executar N callbacks obsoletos que chamam `setState`
em componentes desmontados.

Corrigido para `useEffect` nos dois arquivos, com a função de fechamento local
ao efeito (`setActionsMenu` é estável, o que mantém a lista de dependências
correta). O teste de regressão está em
`src/pages/__tests__/Manifestos.behavior.test.tsx` — verificado que **falha** no
código anterior e passa no atual.

Este é o único achado de memória com efeito **hoje**, na base vazia: ele não
depende de volume de dados.

---

## 3. Redes instáveis e offline

### 3.1 — O que já funciona (e não precisa mexer)

**Evidência: Código.** A edição de atracação citada no pedido está bem
construída:

- `EscalaModal` mantém o modal aberto e o formulário preenchido quando o
  `onSaved` rejeita (`src/components/shared/VoyageScheduleModals.tsx:955`) — não
  há perda de digitação nem tela branca.
- Há controle otimista de concorrência com revisão: `REVISAO_OBSOLETA` vira a
  mensagem "A escala foi atualizada por outra pessoa"
  (`src/pages/Viagens.tsx:489`).
- `ErrorBoundary` tem variante `route`, que preserva header e navegação e reseta
  por `pathname` (`src/components/ErrorBoundary.tsx:38`).
- O retry global só reexecuta erros reconhecidamente transitórios
  (`isRetriableDbError`, `src/lib/queryClient.ts:27`) — não repete erro de
  validação.

A hipótese "quebra com tela branca" do pedido **não se confirma**.

### 3.2 — O que falha: offline vira "nenhum registro"

**Evidência: Código** (`node_modules/@tanstack/query-core`, versão instalada):

```js
// retryer.js:10  — o default é "online"
function canFetch(networkMode) {
  return (networkMode ?? "online") === "online" ? onlineManager.isOnline() : true;
}
// queryObserver.js:310
const isLoading = isPending && isFetching;
```

Com o operador offline, a query **não dispara**: fica em `fetchStatus: 'paused'`.
Como `isFetching` é `false`, `isLoading` também é `false`. As páginas ramificam
em `isLoading ? <Skeleton/> : <Tabela/>` — então o operador sem rede vê a tabela
**vazia**, com o `EmptyState` "Nenhum registro encontrado". Ele conclui que o dado
sumiu, não que a rede caiu.

```
$ grep -rn "isPaused\|fetchStatus" --include=*.ts --include=*.tsx src
(nenhum resultado fora de testes)
```

Não há tratamento de `isPaused` em lugar nenhum, nem indicador global de
reconexão.

**Correção (barata e de alto impacto percebido):**
1. Uma faixa global em `AppLayout` assinando `onlineManager.subscribe(...)`:
   "Sem conexão — os dados exibidos podem estar desatualizados." ~2 h.
2. Nos guards das páginas densas, trocar `isLoading ?` por
   `isLoading || isPaused ?` e distinguir a mensagem. Alternativamente, um
   componente `QueryStateGate` que encapsula os três estados
   (`paused` / `loading` / `empty`) e substitui as ramificações espalhadas.

### 3.3 — Debounce: existe, mas só no lugar certo pela metade

**Evidência: Código.** O `Combobox` (`src/components/ui/Combobox.tsx:28`) tem
debounce de 300 ms bem implementado — inclusive ignorando o disparo inicial
semeado pela URL. É o padrão certo e já está no repositório.

Mas ele só cobre os campos com autocomplete. Os campos de texto livre das telas
de lista escrevem direto no filtro, sem debounce:

| Tela | Linha |
|---|---|
| `/manifestos` | `src/pages/Manifestos.tsx:230` |
| `/containers` | `src/pages/Containers.tsx:196` |
| `/carga-solta` | `src/pages/CargaSolta.tsx:196` |
| `/veiculos` | `src/pages/Veiculos.tsx:380` |
| `/granito` | `src/pages/Granite.tsx:210` |
| `/vazios-importacao` | `src/pages/VaziosImportacao.tsx:230` |
| `/viagens` | `src/components/voyages/VoyageFilters.tsx:61` |

**Correção.** Um `useDebouncedValue(value, 300)` em `src/hooks/`, aplicado no
valor que entra na `queryKey` (mantendo o `<input>` controlado sem atraso, para
não engasgar a digitação). ~2 h para as sete telas. É a correção de melhor
relação custo/benefício de todo o relatório.

---

## 4. Virtualização: onde sim, onde não

Discordo de virtualizar as telas citadas no pedido. O critério:

| Tela | Linhas no DOM | Veredito |
|---|---|---|
| `/manifestos`, `/containers`, `/carga-solta`, `/veiculos` | 20–100 (paginado) | **Não virtualizar.** 100 linhas não sobrecarregam DOM nenhum. Virtualizar quebra `Ctrl+F`, impressão e leitor de tela — perda líquida. |
| `/chegadas-saidas` | todas as viagens do Portal, sem paginação (`src/pages/ChegadasSaidas.tsx:350`) | **Talvez.** Paginar ou filtrar por janela de data primeiro; virtualizar só se passar de ~300 linhas. |
| `VoyageRail` (faixa de `/viagens`) | todas as viagens, scroll horizontal (`src/components/voyages/VoyageRail.tsx`) | **Talvez.** Mesmo raciocínio; hoje são 36 viagens. |
| `LineUpTVDisplay` | ≤60 por construção (`limit(60)`) | **Não.** Já limitado. |

Ou seja: **nenhuma tela justifica virtualização hoje**, e nenhuma justificaria
com a base de pico histórico (135 B/Ls). O problema real dessas telas é a
quantidade de **dados buscados**, não a de nós renderizados — §1. Adicionar
`@tanstack/react-virtual` agora seria resolver o sintoma errado e pagar em
acessibilidade por isso.

O gatilho para reavaliar: quando `/chegadas-saidas` ou a faixa de `/viagens`
passarem de ~300 itens sem filtro. Aí, paginação ou janela de data antes de
virtualização.

---

## 5. Acessibilidade e micro-interações

### 5.1 — Confirmação de ações destrutivas: bom, com duas exceções

**Evidência: Código.** Existe um `ConfirmDialogProvider` correto — promessa,
foco preso, `tone: 'danger'`, `Esc` fecha
(`src/components/ui/ConfirmDialog.tsx`) — usado em 21 pontos. As ações citadas
no pedido estão cobertas com deliberação real:

| Ação | Fricção exigida |
|---|---|
| Cancelar viagem | Motivo obrigatório **+** diálogo de confirmação (`src/pages/Viagens.tsx:215`) |
| Reverter omissão de escala | Justificativa obrigatória em modal próprio (`src/components/voyages/TransshipmentInfoCard.tsx:80`) |
| Excluir viagem | Modal dedicado, texto explicando irreversibilidade |
| Excluir containers | Relatório de dependências antes da confirmação (`src/pages/Containers.tsx`) |

Duas exceções que destoam do padrão:

1. **`window.confirm()` nativo em quatro pontos** —
   `src/pages/ChegadasSaidas.tsx:294` (remover navio do Portal),
   `src/pages/ClientesComunicacao.tsx:363` e `:389` (**ligar/desligar a chave
   global de envio de e-mail real aos clientes**) e
   `src/components/billing/InvoiceCommunicationStatusCell.tsx:63`. O caso da
   chave global é o mais grave: é a ação de maior alcance externo do sistema, e
   está atrás de um diálogo do navegador — sem tom de perigo, sem rótulo de
   botão específico, bloqueando a thread. Deve usar o `ConfirmDialogProvider`
   com `tone: 'danger'`.
2. **Fechamento por clique no backdrop, sem guarda** — `Modal`
   (`src/components/ui/Modal.tsx:81`) chama `onClose` em qualquer clique fora.
   Em `EscalaModal`, um formulário longo, um clique acidental descarta tudo sem
   aviso. Sugestão: `dismissible={false}` para modais de edição, ou confirmação
   de descarte quando o formulário estiver sujo.

### 5.2 — Contraste: um token reprova em AA, em 78 usos

**Evidência: Código.** Razões calculadas sobre os tokens de
`src/index.css` (WCAG 2.1, texto normal exige 4,5:1):

| Par | Razão | AA |
|---|---|---|
| `--app-muted` sobre `--app-surface` (claro) | 7,42:1 | ✅ |
| `--app-muted` sobre `--app-surface-strong` (escuro) | 7,09:1 | ✅ |
| **`--app-muted-soft` sobre `--app-surface` (claro)** | **3,68:1** | ❌ |
| **`--app-muted-soft` sobre `--app-panel` (claro)** | **3,03:1** | ❌ |
| **`--app-muted-soft` sobre `--app-surface-strong` (escuro)** | **3,65:1** | ❌ |
| **`--app-gold` sobre `--app-surface` (claro)** | **2,85:1** | ❌ (reprova até 3:1) |
| `--app-green` sobre `--app-surface` (claro) | 4,28:1 | ❌ (marginal) |

`--app-muted-soft` aparece 62 vezes em `.tsx` e 16 em `index.css`, quase sempre
em tamanhos de 10 a 12 px — a combinação mais difícil possível. E não é
decoração: em `/chegadas-saidas`, o marcador **`OMIT`** (escala omitida pelo
armador) é renderizado exatamente nesse token
(`src/pages/ChegadasSaidas.tsx:24`). Informação operacional relevante, no menor
contraste da paleta. Para uso intensivo, oito horas por dia, isso é fadiga
visual mensurável.

**Correção.** Escurecer `--app-muted-soft` para ≥4,5:1 nos dois temas — no tema
claro, algo em torno de `#6b6558`; no escuro, em torno de `#8a9bb4`. É uma
mudança de duas linhas que atinge 78 pontos de uso. Estados semânticos
(`--app-gold`, `--app-green`) precisam de variantes `-text` mais escuras quando
usados como texto, mantendo as atuais para preenchimento e borda.

### 5.3 — Navegação por teclado nas tabelas

**Evidência: Código.**

- ✅ `Modal` tem armadilha de foco completa, `Esc`, e devolve o foco ao elemento
  anterior (`src/components/ui/Modal.tsx:38-76`).
- ✅ `Combobox` implementa o padrão ARIA de combobox com `aria-activedescendant`.
- ✅ `scope="col"` aplicado consistentemente nas tabelas.
- ❌ **Zero `aria-sort`** no repositório — colunas ordenáveis não anunciam o
  estado de ordenação.
- ❌ **Zero `<caption>`** — nenhuma tabela tem nome acessível; o leitor de tela
  anuncia "tabela com 12 colunas" sem dizer de quê.
- ⚠️ O menu de ações "⋯" abre por clique e posiciona por coordenada
  (`position: fixed`), sem `role="menu"`, sem mover o foco para o primeiro item
  e sem devolvê-lo ao gatilho ao fechar. Ele fecha com `Esc` (bom), mas não é
  navegável por teclado de ponta a ponta.
- ⚠️ `<tr onClick>` sem handler de teclado em `src/pages/ClientesPortal.tsx` e
  `src/pages/PortalOperacao.tsx` — linha clicável inacessível por teclado.

---

## 6. Plano de ação

Ordenado por (impacto percebido pelo operador) ÷ (esforço). As fases 1 e 2
cabem numa semana e entregam quase toda a melhoria percebida; a fase 3 é o
trabalho estrutural que só se paga com volume.

### Fase 1 — Dias 1–2: o que o operador sente amanhã

| # | Ação | Esforço | Risco |
|---|---|---|---|
| 1.1 | `useDebouncedValue(300)` nos 7 campos de busca livre | 2 h | Baixo |
| 1.2 | Indicador global de offline via `onlineManager` no `AppLayout` | 2 h | Baixo |
| 1.3 | Tratar `isPaused` nos guards de carregamento das telas de lista | 3 h | Baixo |
| 1.4 | `--app-muted-soft` e variantes de texto para gold/green em ≥4,5:1 | 2 h | Baixo |
| 1.5 | Trocar os 4 `window.confirm()` pelo `ConfirmDialogProvider` | 2 h | Baixo |
| — | ~~Vazamento de listeners (`useMemo` → `useEffect`)~~ | — | **Feito** |

### Fase 2 — Dias 3–5: tirar as varreduras evitáveis

| # | Ação | Esforço | Risco |
|---|---|---|---|
| 2.1 | Views `DISTINCT` para `usePortOptions` e `useContainerTypeOptions` | 4 h | Baixo — migration aditiva |
| 2.2 | RPC `bl_summary(filters)` substituindo `fetchAllBls` em `useBlSummary` | 1 d | Médio — precisa espelhar a semântica atual dos filtros |
| 2.3 | `search`/`containerType` de `/containers` para o servidor | 4 h | Médio |
| 2.4 | RPC `lineup_snapshot()` para a TV | 1 d | Baixo — consumidor read-only, isolado |
| 2.5 | `aria-sort` + `<caption>` nas tabelas de lista | 4 h | Baixo |

### Fase 3 — Semana 2+: estrutural

| # | Ação | Esforço | Risco |
|---|---|---|---|
| 3.1 | View `voyage_rail_summary`; colapsar o waterfall de 2 fases de `/viagens` | 2 d | Médio-alto — é o coração da tela mais usada |
| 3.2 | Avaliar `babel-plugin-react-compiler` antes de memoizar à mão | 4 h de spike | Baixo — reversível |
| 3.3 | `React.memo` nas linhas de tabela **só** se 3.2 não resolver | 1 d | Baixo |
| 3.4 | Padrão de foco/`role="menu"` no menu de ações "⋯" | 4 h | Baixo |
| 3.5 | Modais de edição sem descarte por clique no backdrop | 3 h | Baixo |

### O que eu explicitamente **não** recomendo

- **Virtualização de lista.** Nenhuma tela a justifica hoje (§4). Reavaliar
  quando `/chegadas-saidas` ou a faixa de `/viagens` passarem de ~300 itens.
- **Espalhar `useCallback`/`useMemo` preventivamente.** Sem `React.memo` do
  outro lado, é custo sem benefício, e polui a leitura do código.
- **Mexer em índices ou RLS.** O
  [baseline de 2026-08-13](../reports/2026-08-13-baseline-performance-producao.md)
  já mostrou que o banco está ocioso. O gargalo é a forma da consulta, não sua
  execução.

### Como validar que funcionou

O projeto já tem o instrumento certo:
`scripts/perf/measure-authenticated-startup.mjs` (Playwright, mede requisições,
bytes e as 10 mais lentas por categoria). Ele exige `PERF_BASE_URL`,
`PERF_USER_EMAIL` e `PERF_USER_PASSWORD`, que não estavam disponíveis nesta
auditoria.

**Recomendação:** rodá-lo contra um Preview com base semeada (~2.000 B/Ls) antes
e depois da Fase 2, com as métricas de aceitação abaixo. Sem essa semeadura, as
correções continuam sendo argumentos de código — corretos, mas não medidos.

| Métrica | Alvo |
|---|---|
| Requisições por tecla digitada na busca | 0 (uma por rajada, após 300 ms) |
| Bytes na primeira carga de `/containers` | −70% (fim de duas varreduras) |
| Bytes na primeira carga de `/viagens` | −90% (view de resumo) |
| Fases de rede em série em `/viagens` | 2 → 1 |
| Tokens de cor reprovando AA no texto | 3 → 0 |

---

## 7. Notas e divergências

- Este relatório **não** mediu Web Vitals, CPU ou memória em execução: a base de
  produção está sem dados operacionais e não havia credencial de teste para o
  harness autenticado. Toda estimativa de custo está rotulada como projeção.
- O achado 6 (vazamento de listeners) é o único corrigido nesta mudança. Todos
  os demais estão descritos com correção proposta, sem implementação — o pedido
  era de auditoria e plano.
- O achado 3 (`useVoyages`) recobre o achado D da auditoria de
  [2026-08-12](2026-08-12-investigacao-lentidao-carregamento-paginas.md), que
  segue aberto. O achado A daquela auditoria (Realtime) foi resolvido e
  confirmado pelo baseline de 2026-08-13.


---

## PR #657 — banco de dados, ciclo CRUD e requisições

Arquivo original incorporado integralmente abaixo. O snapshot, a evidência, os identificadores dos achados e as recomendações são preservados.

# Auditoria de Banco de Dados, Ciclo CRUD e Requisições

> **Snapshot histórico:** este relatório descreve o repositório na data indicada.
> Achados podem ter sido corrigidos depois. Para o estado atual, consulte
> [`docs/README.md`](../../README.md), o código e as migrations.

**Data:** 2026-09-05 · **Escopo:** os seis módulos do Transhipping Desk
(Operação Marítima, Cargas/B-Ls/CE Mercante, Financeiro/Demurrage,
Clientes/Caixas de Comunicação, Segurança/RLS/Portal, Alertas/`app_settings`) ·
**Método:** varredura estática das 8 migrations (43.297 linhas, 110 tabelas,
280 policies), extração com parser de parênteses balanceados das assinaturas de
funções e grants, resolução **transitiva** de guards de autorização através das
cadeias de wrappers, e varredura dos 945 arquivos TypeScript (133.198 linhas)
para chamadas `supabase.from/rpc`, `useMutation` e blocos `catch`.

Rótulos de evidência conforme [`docs/CONVENCOES.md`](../../CONVENCOES.md):
**Código**, **Teste**, **Suspeita**.

---

## 1. Veredito

A fronteira de segurança e a disciplina de cache **não têm lacunas**. Os achados
reais estão todos numa faixa estreita: **falhas parciais em importações que
gravam fora de uma RPC transacional**, e **erros engolidos com `catch` vazio**
contornando o repórter que o próprio projeto já mantém.

| Vetor auditado | Resultado |
|---|---|
| RLS habilitada em todas as tabelas | 110/110 — sem exceção |
| Tabelas alcançáveis pelo cliente sem policy | 0 (8 são deny-all e só têm acesso via `SECURITY DEFINER`) |
| Policies permissivas (`USING (true)`) para `authenticated` | 0 |
| Policies concedidas a `anon` | 0 |
| Vazamento multi-tenant no Portal | **Nenhum encontrado** (ver §2) |
| RPCs `SECURITY DEFINER` alcançáveis pelo cliente sem guard | 0 (ver §2.2) |
| Drift de nome/argumento entre `rpc()` no cliente e migrations | 0 |
| `useMutation` sem invalidação ou `onSuccess` | 0 de 79 |
| Updates otimistas sem rollback | N/A — não existe `onMutate` no repositório |
| String vazia gravada em coluna `uuid`/`date`/`numeric` | 0 |
| Botões de ação financeira sem trava de duplo clique | 0 (ver §4.3) |
| Importações não atômicas | **2** (P1-01, P2-01) |
| `catch` vazio engolindo falha de negócio | **5 sítios** (P1-02, P2-02, P3-02) |

---

## 2. Fase 1 — Schema, RLS e isolamento do Portal

### 2.1 Isolamento multi-tenant (P0 — sem achado)

O Portal e o app interno compartilham o mesmo projeto Supabase, portanto **uma
sessão do Portal também é `authenticated`**. Qualquer RPC ou policy concedida a
`authenticated` está ao alcance de um cliente externo. Essa foi a hipótese de
ataque central da auditoria.

O isolamento se apoia em duas populações disjuntas:

- interno → linha em `user_profiles` (`is_active_read_user()`, `is_admin()`);
- Portal → linha em `customer_portal_accounts` (`current_portal_customer_id()`).

O Portal não faz `supabase.from(...)` em tabela alguma: todo acesso passa por
`callPortalRpc` (`src/services/portalScope.ts`), e cada RPC deriva o
`customer_id` de `auth.uid()` — nunca de argumento do cliente.

As 14 RPCs `portal_inspect_*` **aceitam** `p_customer_id` e são concedidas a
`authenticated`, o que à primeira vista parece um vetor de troca de id. Elas são
seguras porque todas passam o argumento por `_portal_inspect_guard()`, que exige
`is_active_read_user()` — condição que uma sessão do Portal nunca satisfaz.
**Evidência: Código** (`supabase/migrations/002_business_logic_and_security.sql`,
`_portal_inspect_guard`).

### 2.2 Guards em `SECURITY DEFINER` (sem achado)

A varredura ingênua acusou 6 RPCs `SECURITY DEFINER` concedidas a `authenticated`
sem guard aparente. **Todas as 6 são falsos positivos**, por dois motivos
legítimos que qualquer auditoria futura deve considerar antes de abrir um P0:

1. **Guard na base da cadeia de wrappers.** `import_bl_freight_transactional`
   delega para `_legacy_357` → `_legacy_322` → `_legacy_284` → `_legacy_205`, e é
   o `_legacy_205` que valida `is_active_user()` e
   `p_changed_by IS DISTINCT FROM auth.uid()`. O mesmo padrão vale para
   `save_granite_bl_review` (guard em `_legacy_148`) e
   `save_voyage_escala_terminal_state_v2` (guard em
   `save_voyage_escala_terminal_state`).
2. **Guard inline em vez de helper.** As três RPCs de ADR por `report_id`
   (`set_agency_report_signoff_by_report_id` e irmãs) consultam `user_profiles`
   diretamente, sem chamar `is_active_read_user()`.

`portal_ship_schedule()` é concedida a `anon` **por desenho**: expõe apenas
viagens com `show_on_portal AND status = 'active'`, conforme
[`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md).

Observação de ordem, sem exploração conhecida:
`save_voyage_escala_terminal_state_v2` insere em `public.ports` **antes** de
delegar para a função guardada. Um chamador não autorizado não persiste nada
(a exceção aborta a transação), mas a ordem inverte a regra de "autorizar antes
de escrever". **Evidência: Código.**

### 2.3 Drift de tipos (sem achado)

14 tabelas existem nas migrations e não em `src/types/database.ts`
(`alert_items`, `internal_notifications`, `demurrage_disputes`, …). **Não é
drift**: nenhuma delas é acessada por `supabase.from(...)` no cliente — todas são
mediadas por RPC. Os tipos gerados cobrem exatamente a superfície de tabela
alcançável diretamente.

### 2.4 Invariantes de domínio conferidas

| Invariante | Estado |
|---|---|
| Omissão dupla do mesmo POD bloqueada | **Sim** — `UNIQUE (voyage_id, omitted_pod)` em `voyage_omissions`, mais checagem explícita em `omit_voyage_escala` que levanta `23505` com mensagem de negócio |
| Omissão preserva histórico | **Sim** — insere em `bl_transshipments`, dois registros em `audit_logs`, não toca `bls.pod` |
| Contatos: `FOR UPDATE` pessimista | **Sim** — `_apply_customer_contact_configuration` |
| Contatos: auditoria append-only | **Sim** — `customer_contact_change_events` |
| `app_settings` restrito a Administrativo + log | **Sim** — `set_communications_enabled` exige `_portal_actor_role() = 'administrativo'`, faz `FOR UPDATE` e grava em `audit_logs` |

**Correção à premissa do escopo:** a tabela `scale_omissions` **não existe**. O
nome real é `voyage_omissions`. `depots` também não tem
`preflight_depots_terminal_port_mapping` como constraint — é procedimento de
migração.

---

## 3. Fase 2 — Serviços e hooks

### 3.1 Cache React Query (sem achado)

79 blocos `useMutation`; **todos** têm `onSuccess`/`onSettled` com invalidação.
O padrão dominante extrai a invalidação para helper nomeado
(`useInvalidateRates()`) ou para os eventos de domínio de
`src/services/cacheEffects.ts` (`afterEscalaAlterada`, `afterViagemAlterada`),
conforme a skill `react-query-pattern`. Não há `onMutate` no repositório,
portanto o critério de rollback otimista não se aplica.

### 3.2 Tradução de erro do Postgres (sem achado de vazamento)

`src/lib/errors.ts` mapeia os códigos relevantes e — o detalhe que costuma
faltar — tem um guard `raw` que detecta `violates ... constraint` /
`permission denied for table` e **descarta** a mensagem crua mesmo quando a
entrada está marcada `preserveMessage`. Nenhum `23505` cru chega à tela.

Ponto de atenção, não achado: 27 sítios usam `classifyDbError` contra ~77 que
exibem `error.message` direto. A maioria destes últimos trata erros de aplicação
(`new Error('Falha ao ...')`), não erros do Postgres, mas a fronteira não é
explícita e tende a erodir. **Evidência: Suspeita.**

---

## 4. Fase 3 — Matriz de risco CRUD

`OK` = verificado sem achado. `P1`/`P2`/`P3` remetem à Fase 4.

| Entidade / Módulo | Create | Read | Update | Delete/Cancel | RLS | Status |
|---|---|---|---|---|---|---|
| Viagens / Escalas / Atracações | OK | OK | OK | OK (preserva vínculo) | OK | **OK** |
| Omissão de escala (`voyage_omissions`) | OK | OK | OK | OK (append-only) | OK | **OK** |
| ADR (`agency_departure_reports`) | OK | OK | OK | OK | OK | **OK** |
| Terminais / `depots` | OK | OK | OK | OK | OK | **OK** |
| B/Ls e frete (import) | P2-01 | OK | OK | OK | OK | **P2** |
| CE Mercante (planilha e EDI) | P1-02 | OK | OK | OK | OK | **P1** |
| Containers — datas/devolução (import) | P1-01 | OK | P1-01 | OK | OK | **P1** |
| Manifestos (Breakbulk/Granito/Vazios/Baplie) | OK (RPC transacional) | OK | OK | OK | OK | **OK** |
| Invoices / Taxas Locais | OK | OK | OK | OK | OK | **OK** |
| Demurrage / Disputas | OK | OK | OK | OK | OK | **OK** |
| Clientes / Contatos / Caixas | OK | OK | OK | OK (lógico) | OK | **OK** |
| Portal do Cliente | OK | OK | OK | OK | OK | **OK** |
| Alertas / Notificações | OK | OK | OK | OK | OK | **OK** |
| `app_settings` (singleton) | — | OK | OK | — | OK | **OK** |

### 4.3 Duplo clique (sem achado)

16 botões de ação aparecem sem prop `disabled`, mas o componente compartilhado
resolve isso na origem: `src/components/ui/Button.tsx` faz
`disabled={disabled || loading}`. Todos os botões de emissão, aprovação e
faturamento passam `loading={mutation.isPending}`. As exceções restantes são
seleção, impressão e abas — sem mutação.

---

## 5. Fase 4 — Inventário de lacunas

### P1-01 — Import de datas de container é não atômico e perde faturamento de Demurrage em definitivo

**Arquivo:** `src/services/containerDatesImport.ts#L133` (antes da correção)
**Evidência: Código + Teste**

`importContainerDates` percorre as linhas gravando **uma requisição PostgREST por
linha** — cada uma sua própria transação — e fazia `throw updateError` na
primeira falha.

Cenário de reprodução:

1. Planilha com 200 containers; a linha 120 falha (conflito, RLS, timeout).
2. As 119 primeiras **já estão gravadas**; o operador vê apenas
   `Falha ao importar datas.` sem contagem — a "meia carga" da premissa.
3. O laço de faturamento (`blsToCheckForInvoice`) **nunca roda**.
4. O operador reimporta o mesmo arquivo. As 119 linhas caem em
   `if (sameDischarge && sameReturn) { unchanged += 1; continue }` — e portanto
   **não** entram em `blsToCheckForInvoice`.

O passo 4 é o dano real: os containers ficam `returned` e a fatura de Demurrage
correspondente **nunca nasce**, e reimportar não cura. É perda de receita
silenciosa.

**Correção aplicada:** o laço acumula erro por linha em vez de abortar; a linha
inalterada cujo container já está `returned` é reenfileirada para faturamento
(`createInvoiceForReturnedBL` é idempotente); o laço de faturamento isola falha
por B/L; o resultado ganha `errors[]`, exibido no modal.

### P1-02 — Falha do faturamento automático pós-CE Mercante é engolida por `catch` vazio

**Arquivos:** `src/services/ceMercanteImport.ts#L208`, `#L264`
**Evidência: Código**

```ts
await maybeAutoBillAfterCeMercante(row.bl_id, options.changedBy).catch(() => {})
```

`maybeAutoBillAfterCeMercante` gera invoice. Sua falha não produzia toast, log,
nem evento Sentry — e o import ainda reportava sucesso. O projeto já mantém
`reportBestEffortFailure` (`src/lib/telemetry.ts`, `console.warn` + Sentry) usado
em 12 sítios exatamente para isto; estes dois o contornavam. Também não carregam
comentário `ponytail:`, ou seja, não são atalho sancionado pela convenção.

**Correção aplicada:** ambos os sítios passam a chamar
`reportBestEffortFailure` com contexto e `blId`.

### P2-01 — Gravações fora da RPC transacional no import de B/L

**Arquivo:** `src/services/blFreightImport.ts#L517-L537`
**Evidência: Código**

Depois de `import_bl_freight_transactional` (atômica), o serviço insere em
`import_batches` e faz `update` em `bls.batch_id` — duas transações separadas. Se
o `update` falhar, sobra uma linha de lote com `status: 'completed'` e
`total_bls: N` sem nenhum B/L apontando para ela.

**Correção sugerida (não aplicada):** mover ambas as gravações para dentro da RPC
transacional, ou criar `link_bl_import_batch(p_voyage_id, p_bl_ids, ...)` que faça
insert e vínculo numa transação. Fora do escopo desta correção por exigir
migration.

### P2-02 — Flags físicas do Baplie e taxas provisórias engolidas por `catch` vazio

**Arquivo:** `src/services/blFreightImport.ts#L503`, `#L509`
**Evidência: Código**

Mesmo padrão do P1-02. Agrava porque `applyBapliePhysicalFlags` aplica flags
IMO/OOG — carga perigosa. Sem sinal algum, ninguém descobre que não foram
aplicadas.

**Correção aplicada:** ambos passam por `reportBestEffortFailure`.

### P3-01 — `omit_voyage_escala` degrada a mensagem sob concorrência

**Arquivo:** `supabase/migrations/002_business_logic_and_security.sql`
**Evidência: Código**

O `IF EXISTS` seguido de `INSERT` não é atômico entre chamadas simultâneas. A
`UNIQUE` garante a correção, mas o segundo chamador recebe o `23505` cru — que
`classifyDbError` reduz a "Este registro ja existe." em vez da mensagem de
negócio. Impacto apenas de texto.

### P3-02 — `catch` vazio no sino de notificações

**Arquivo:** `src/components/layout/InternalNotificationBell.tsx#L85`, `#L123`
**Evidência: Código**

`markRead`/`markAllRead` engolem a falha. Consequência cosmética (o badge não
zera). Não corrigido para manter o diff estreito.

### P3-03 — Falha transitória ao carregar perfil derruba o perfil sem aviso

**Arquivo:** `src/hooks/useAuth.tsx#L136`, `#L153`
**Evidência: Suspeita**

`catch { setProfile(null) }` não distingue "sem perfil" de "rede caiu". Uma falha
transitória degrada o usuário a sem-perfil sem mensagem. Precisa de teste de
runtime para confirmar o efeito em `ProtectedRoute`.

---

## 6. Correções aplicadas nesta mudança

| Achado | Arquivo | Natureza |
|---|---|---|
| P1-01 | `src/services/containerDatesImport.ts` | Lote resiliente + cura do faturamento perdido + `errors[]` |
| P1-01 | `src/components/shared/ContainerDatesImportModal.tsx` | Exibe erros de gravação; usa `classifyDbError` |
| P1-02 | `src/services/ceMercanteImport.ts` | `reportBestEffortFailure` nos 2 sítios |
| P2-02 | `src/services/blFreightImport.ts` | `reportBestEffortFailure` nos 2 sítios |
| P1-01 | `src/services/__tests__/containerDatesImport.test.ts` | 2 testes de regressão (vermelho confirmado antes da correção) |

Pendentes por exigirem migration ou investigação de runtime: **P2-01**, **P3-01**,
**P3-03**.

## 7. Verificação

`npm run lint` limpo · `npm test` 2.833 testes passando, 43 skipped ·
`npm run build` sem erro · os 2 testes novos verificados **falhando** contra o
código anterior e passando após a correção.


---

## PR #658 — precisão financeira, tarifação e faturamento

Arquivo original incorporado integralmente abaixo. O snapshot, a evidência, os identificadores dos achados e as recomendações são preservados.

# Auditoria de precisão financeira, tarifação e faturamento — 2026-09-05

Registro histórico. Auditoria estática das rotinas de cálculo, precificação,
conversão cambial e emissão de cobranças: Taxas Locais, Demurrage, Invoices e
PIX. Nenhum comportamento foi alterado por esta auditoria.

Labels de evidência conforme `docs/CONVENCOES.md`. Inspeções de migration são
**Teste de contrato SQL**; nada aqui foi validado em ambiente real, portanto não
há label **Runtime**.

## Escopo e método

Leitura estática de `supabase/migrations/001_initial_schema.sql`,
`supabase/migrations/002_business_logic_and_security.sql`,
`supabase/functions/recalc-demurrage-ptax/`, `src/lib/pix.ts`,
`src/services/demurrage/`, `src/services/billing.ts`,
`src/services/reconciliacao.ts`, `src/components/demurrage/InvoiceDocument.tsx`
e `src/components/billing/InvoiceDocumentLocal.tsx`, confrontada com ADR 0008,
0014, 0015, 0026, 0038, 0040 e 0046.

Três achados numéricos foram reproduzidos com aritmética decimal exata (BigInt)
contra a aritmética de ponto flutuante do produto; o script está em
[Reprodução numérica](#reprodução-numérica) e roda com `node`, sem dependências.

## Sumário

| # | Achado | Severidade | Vetor |
|---|---|---|---|
| [F1](#f1--a-fatura-de-demurrage-impressa-não-fecha) | Soma das linhas impressas ≠ TOTAL impresso na fatura de Demurrage | Alta | Documentos |
| [F2](#f2--confirm_demurrage_pix_matches-é-uma-porta-aberta-para-baixa-de-fatura) | `confirm_demurrage_pix_matches` sem guard, sem dedupe de TXID, valor ditado pelo chamador | Alta | Idempotência / PIX |
| [F3](#f3--desconto-fixo-em-usd-não-tem-teto-total-negativo-e-qr-sem-valor) | Desconto fixo em USD sem teto → `current_total_brl` negativo e QR PIX sem valor | Alta | Cálculo |
| [F4](#f4--a-tabela-de-tarifas-de-demurrage-não-é-autoridade-no-servidor) | Tarifas/free time vêm do navegador; servidor só valida coerência interna | Alta | Tarifação |
| [F5](#f5--câmbio-global-gravável-por-qualquer-usuário-ativo-sem-faixa-de-sanidade) | ROE/PTAX graváveis por qualquer usuário ativo, sem faixa de sanidade nem `CHECK > 0` | Alta | Câmbio |
| [F6](#f6--container-compartilhado-quantidade-impressa-não-multiplica-e-b-l-tardio-eleva-a-cobrança) | Rateio de container: `quantidade × unitário ≠ total`; B/L tardio eleva a cobrança agregada | Média | Cálculo / Documentos |
| [F7](#f7--dois-geradores-de-payload-pix-escrevendo-a-mesma-coluna) | Payload PIX gerado em SQL **e** em TS, com arredondamentos diferentes | Média | PIX |
| [F8](#f8--desvios-em-relação-ao-br-code-do-bacen) | Sub-tag `05` dentro da tag `26`; txid de 35 chars; ausência da tag `01`; acento apagado | Média | PIX |
| [F9](#f9--ptax-reconstruída-por-divisão-grava-cotação-que-nunca-existiu) | `ROUND(current_roe / 1.065, 4)` fabrica PTAX e alimenta a conciliação | Média | Câmbio |
| [F10](#f10--o-markup-1065-está-replicado-em-sete-pontos) | Spread 1,065 replicado em 7 pontos, contra o texto do ADR 0014 | Média | Câmbio |
| [F11](#f11--o-caminho-de-pagamento-de-demurrage-escreve-dinheiro-direto-da-tabela) | Baixa de Demurrage grava colunas de dinheiro direto da tabela, sem RPC nem compare-and-swap | Média | Idempotência |
| [F12](#f12--a-rpc-de-readiness-não-é-o-gate-de-emissão-de-invoice) | Readiness é gate de **comunicação**, não de emissão; `STABLE` e fora da transação de despacho | Média | Prontidão |
| [F13](#f13--tarifas-de-demurrage-sem-nenhuma-constraint) | `demurrage_rates` sem nenhum `CHECK`: lacuna entre faixas não é cobrada, sobreposição bloqueia a emissão | Média | Tarifação |
| [F14](#f14--tolerância-de-r-001-quita-saldo-e-deixa-o-ledger-inconsistente) | Tolerância de R$ 0,01 quita o receivable e deixa `balance_brl` residual | Baixa | Ledger |
| [F15](#f15--falha-da-api-do-bacen-é-um-dia-sem-recálculo-e-nenhum-alerta) | Edge Function sem retry e sem alerta; falha do BCB é silenciosa | Baixa | Câmbio |
| [F16](#f16--filtros-de-status-divergentes-na-emissão-de-taxas-locais) | `v_usd_count` e o `INSERT` de itens usam filtros de status diferentes | Baixa | Faturamento |
| [F17](#f17--current_date-em-utc-data-de-faturamento-e-régua-de-cobrança-em-fusos-diferentes) | `CURRENT_DATE` (UTC) grava; a régua de dunning lê em `America/Sao_Paulo` | Baixa | Datas |

---

## 1. Demurrage e free time

### F1 — A fatura de Demurrage impressa não fecha

**Severidade: Alta. Evidência: Código + reprodução numérica.**

`src/components/demurrage/InvoiceDocument.tsx:22-31` calcula o BRL de cada
linha no navegador, **sem arredondar**, e imprime o total vindo do banco:

```ts
const itemsWithBRL = items.map((item) => ({ ...item, subtotal_brl: item.subtotal_usd * roeValue }))
const rawTotalBRL = itemsWithBRL.reduce((sum, item) => sum + item.subtotal_brl, 0)
const totalBRL = invoice.current_total_brl ?? Math.max(0, rawTotalBRL - discountBRL)
```

O banco grava `ROUND(total_usd * current_roe, 2)` — um arredondamento da
**soma**. O documento imprime N linhas arredondadas **individualmente** na
formatação. Os dois resultados divergem sempre que a soma dos resíduos de
meio centavo cruza o centavo:

| Itens (USD) | ROE | Linhas impressas | Soma do que está impresso | Subtotal impresso | TOTAL (banco) |
|---|---|---|---|---|---|
| 3 × 137,55 | 5,4321 | 747,19 + 747,19 + 747,19 | **R$ 2.241,57** | R$ 2.241,56 | **R$ 2.241,56** |
| 5 × 91,70 | 5,6789 | 5 × 520,76 | **R$ 2.603,80** | R$ 2.603,78 | **R$ 2.603,78** |

O cliente que soma as linhas da própria fatura encontra um valor diferente do
TOTAL e do valor do QR PIX. Em uma cobrança marítima isso é munição para
disputa, não um detalhe estético.

Agravante no mesmo bloco: `const roeValue = roe ?? 1`. Se `current_roe` e `roe`
forem nulos, o documento imprime os valores em USD com o rótulo `R$`. O
fallback deveria ser recusa de renderização, não a identidade.

**Correção proposta.** Parar de recalcular dinheiro no documento. `list_*` /
`portal_*` devem devolver o `subtotal_brl` de cada item já arredondado no
banco, e o TOTAL deve ser a soma dessas linhas — uma única autoridade
aritmética. Enquanto o payload não mudar, arredonde a linha antes de somar
(`Math.round(x * 100) / 100`) e imprima `rawTotalBRL` apenas quando ele for
idêntico a `current_total_brl`; divergindo, imprima o valor do banco nas duas
posições. Renderizar sem ROE deve lançar.

### F3 — Desconto fixo em USD não tem teto: total negativo e QR sem valor

**Severidade: Alta. Evidência: Teste de contrato SQL.**

`demurrage_invoices` restringe o desconto percentual a 0–100
(`demurrage_invoices_discount_percent_check`, `001:2107`) mas **não** limita o
desconto `fixed` ao `total_usd`. E `recalculate_demurrage_invoices`
(`002:14060-14066`) subtrai sem piso:

```sql
ELSE v_discount_usd := v_inv.discount_value;   -- fixo em USD
v_total_brl := ROUND((v_inv.total_usd - v_discount_usd) * v_roe, 2);
```

O TS faz o contrário — `applyDemurrageUsdDiscount` clampa com
`Math.max(0, ...)` (`src/services/demurrage/demurrageInvoices.ts:35`). Um
desconto fixo maior que o total produz, portanto: tela mostrando R$ 0,00,
banco guardando `current_total_brl` negativo, e
`build_transshipping_pix_payload` caindo no ramo `COALESCE(p_amount_brl,0) > 0`
→ **QR PIX emitido sem a tag 54**, isto é, valor livre para o pagador digitar.

**Correção proposta.** `CHECK ((discount_mode <> 'fixed') OR (discount_value >= 0 AND discount_value <= total_usd))`
na tabela, `GREATEST(..., 0)` na RPC, e `build_transshipping_pix_payload`
levantando exceção para valor ≤ 0 em vez de degradar para QR sem valor.

### F4 — A tabela de tarifas de Demurrage não é autoridade no servidor

**Severidade: Alta. Evidência: Teste de contrato SQL.**

`create_demurrage_invoice_with_items` (`002:4485-4499`) faz uma verificação
séria — recomputa `total_days` a partir das datas, exige
`subtotal_usd ≈ days_p1 × rate_p1 + days_p2 × rate_p2` e veta
`days_p1 + days_p2 > total_days - free_days` (ADR 0026). Mas **nada** confronta
`free_days`, `rate_p1_usd` e `rate_p2_usd` com `demurrage_rates`, com
`bls.free_time_override` ou com o acordo do cliente. A tarifa é o que o
navegador mandou; o servidor só confere se a conta fecha consigo mesma.

Isso não é escalonamento de privilégio (a RPC exige `is_admin()`), mas é
divergência silenciosa — e há um caminho concreto para ela. Em
`src/services/demurrage/demurrageRates.ts:104-125`, quando o refresh da tarifa
falha, o cache **em memória é servido do mesmo jeito e tem o timestamp
renovado**:

```ts
if (error || resolved.length === 0) {
  reportBestEffortFailure(...)
  if (!dynamicRateGroups) throw new Error(RATES_UNAVAILABLE_MESSAGE)
  dynamicRateGroupsLoadedAt = now   // <- TTL renovado com dado velho
  return
}
```

Cada falha estende o TTL por mais 5 minutos. Uma aba aberta durante uma
indisponibilidade prolongada emite faturas com a tarifa antiga por tempo
indeterminado, e o banco aceita.

O veto também é assimétrico: `days_p1 + days_p2 > chargeable` rejeita cobrança
**a mais**, mas cobrança **a menos** passa sem ruído.

**Correção proposta.** Uma função `demurrage_expected_item(container_id, discharge, return)`
`STABLE` no banco, resolvendo tarifa e free time a partir de
`demurrage_rates` + overrides + acordo, e o veto passando a comparar item a
item contra ela (tolerância zero em dias, R$ 0,00 em tarifa). O cliente segue
calculando para a prévia; o banco deixa de acreditar nele. Enquanto isso não
existe, o cache stale deve **expirar** em vez de renovar: mantenha
`dynamicRateGroupsLoadedAt` inalterado na falha e recuse o cálculo depois de um
teto absoluto (ex.: 30 min sem refresh bem-sucedido).

### F13 — Tarifas de Demurrage sem nenhuma constraint

**Severidade: Média. Evidência: Teste de contrato SQL.**

`demurrage_rates` (`001:2149-2164`) não tem um único `CHECK`. Não há garantia
de que `p1_day_from = free_days + 1`, de que `p2_day_from = p1_day_to + 1`, de
que os valores sejam não negativos, de que `valid_from <= valid_to`, nem
unicidade de vigência por `container_type`.

Duas consequências distintas, e vale separá-las porque só uma é cobrança
errada:

- **Lacuna** (`p2_day_from > p1_day_to + 1`): os dias do buraco não são
  cobrados por ninguém. Com free=10, P1=[11,15], P2 a partir do 18 e 20 dias
  de sobreestadia, o cálculo dá `days_p1=5`, `days_p2=3`, soma 8 ≤ 10 — passa
  no veto. Os dias 16 e 17 saem de graça, **silenciosamente**.
- **Sobreposição** (`p2_day_from <= p1_day_to`): o dia é contado nas duas
  faixas, a soma estoura o veto e a emissão é **rejeitada** com
  `Calculo de Demurrage inconsistente`. O dinheiro está protegido; o operador
  recebe uma mensagem que não aponta para a causa (o cadastro da tarifa).
- **Vigências sobrepostas**: `ensureDemurrageRatesLoaded` ordena por
  `valid_from DESC, id DESC` e `toRateGroups` fica com a **primeira** linha por
  tipo canônico. Duas linhas ativas para `20GP` resolvem por desempate
  implícito, sem aviso.

**Correção proposta.** `CHECK (p1_day_from = free_days + 1)`,
`CHECK (p2_day_from = p1_day_to + 1)`, `CHECK (p1_usd >= 0 AND p2_usd >= 0)`,
`CHECK (valid_to IS NULL OR valid_from <= valid_to)` e índice `EXCLUDE USING gist`
sobre `(container_type WITH =, daterange(valid_from, valid_to) WITH &&)` onde
`active`. Mensagem do veto de emissão citando o `charge`/tarifa que não fecha.

### Disputas: o que está congelado e o que não está

**Evidência: Teste de contrato SQL + ADR.**

Respondendo diretamente à pergunta do escopo:

- **Não existe juros, multa ou mora em lugar nenhum do sistema.** Uma busca por
  `juros|mora|interest_rate|multa` em `src/` e `supabase/` não retorna nenhuma
  regra financeira. Portanto não há "juros indevidos" a congelar — a exposição
  durante uma disputa é **cambial**, não de encargo.
- **A cobrança (dunning) está congelada.** `claim_demurrage_dunning_candidates`
  (`002:3513`) e `demurrage_dunning_candidate_sendable` (`002:5772`) exigem
  `COALESCE(dispute_open, false) = false`. Fatura em disputa não recebe
  cobrança automática.
- **O valor não está congelado, e isso é decisão registrada.** ADR 0014 diz
  textualmente: *"Disputas são ortogonais (nunca bloqueiam recálculo nem
  pagamento)"*, e `recalculate_demurrage_invoices` de fato não filtra
  `dispute_open`. O código está fiel ao ADR.

Onde discordo, e por quê: a decisão é defensável enquanto a disputa é sobre
**dias** (o USD está travado na emissão; só o câmbio flutua). Mas o cliente
disputa um documento com um número, e esse número muda todo dia útil enquanto a
disputa corre. Recomendo registrar no ADR o que o código já faz — a supressão
da régua de cobrança, que o ADR 0014 não menciona — e considerar congelar o
`current_roe` na abertura da disputa, mantendo o histórico de recálculo
correndo em paralelo para reprecificar na resolução. É uma mudança de política,
não um bug: fica como recomendação, não como achado.

### F6 — Container compartilhado: quantidade impressa não multiplica, e B/L tardio eleva a cobrança

**Severidade: Média. Evidência: Código + reprodução numérica.**

O rateio de container entre B/Ls da mesma viagem é bem-feito no total: os
não-últimos recebem `ROUND(unit / n, 2)` e o "último" (`MAX(b2.id)`, desempate
lexicográfico determinístico) absorve o resíduo — `resolve_bl_local_charge_items`
(`002:17429-17456`). O problema está em duas bordas.

**Borda 1 — o documento não multiplica.** `quantity` é gravada como
`NUMERIC(12,6)` (`1/n` truncado) enquanto o total vem do rateio com resíduo.
`InvoiceDocumentLocal.tsx:107-109` imprime as três colunas lado a lado:

| n | Qtd impressa | Unitário | Qtd × Unitário | Total gravado (último B/L) |
|---|---|---|---|---|
| 7 | 0.142857 | R$ 890,00 | R$ 127,14 | **R$ 127,16** |
| 6 | 0.166667 | R$ 1.000,00 | R$ 166,67 | **R$ 166,65** |

Além de não fechar, `0.142857` é uma quantidade ilegível em fatura de cliente.

**Borda 2 — B/L que chega depois.** `calculate_bl_local_charges` bloqueia o
recálculo de B/L já faturado (`002:2947`). Se o B/L `A` foi faturado sozinho
(share_count = 1, cobrança integral do container) e o B/L `B`, que compartilha
o mesmo container, é importado depois, `B` calcula com share_count = 2 e, sendo
`MAX(id)`, absorve o resíduo — cobrando metade. O agregado cobrado pelo mesmo
container passa a **150%**. Nada detecta isso.

**Borda 3 — duplicação do algoritmo.** A CTE `current_containers`/`shares`
existe duas vezes, quase idêntica, em `calculate_bl_local_charges` (`002:3042`)
e `resolve_bl_local_charge_items` (`002:17280`). Contraria a regra do
`CLAUDE.md` de corrigir na função compartilhada, e garante que a próxima
correção de rateio seja aplicada só numa das duas.

**Correção proposta.** (a) Imprimir a quantidade rateada como fração legível
(`1/7 de 1 container`) ou imprimir o unitário efetivo (`total / quantity`
arredondado) — o que fechar a conta na página. (b) Alerta operacional quando
`share_count` de um container muda depois de existir invoice ativa para
qualquer B/L que o compartilha: é o gatilho para cancelar e reemitir. (c)
Extrair as CTEs de rateio para uma única função `bl_container_shares(p_bl_id)`.

---

## 2. Câmbio e integração BACEN / PTAX

### F5 — Câmbio global gravável por qualquer usuário ativo, sem faixa de sanidade

**Severidade: Alta. Evidência: Teste de contrato SQL.**

Três problemas empilhados:

- `exchange_rate_reference` (`001:2262-2269`) tem exatamente um `CHECK`: `id = 1`.
  Não há `ptax > 0` nem `roe > 0`. Um ROE zero ou negativo é aceito pelo banco.
- `save_exchange_rate_reference` (`002:18783`) exige apenas `is_active_user()`
  e não valida nada — nem positividade, nem relação entre `p_ptax` e `p_roe`,
  nem proximidade da última cotação conhecida.
- `recalculate_demurrage_invoices_manual` (`002:14093`) também exige apenas
  `is_active_user()` — não `is_admin()`, ao contrário de
  `create_demurrage_invoice_with_items`, `register_ledger_invoice_payment` e
  `reconcile_invoice_payment_by_txid` — e repassa `p_ptax` com validação
  `p_ptax > 0` apenas. Um dedo trocado (55,00 em vez de 5,50) reprecifica
  **todas** as faturas emitidas e não pagas em uma transação, reescrevendo
  `current_total_brl` e os QR PIX.

A permissão do wrapper manual segue o ADR 0014 ao pé da letra, então trato como
achado de **validação de entrada**, não de autorização — mas a assimetria com
o resto do caminho de dinheiro merece revisão explícita.

**Correção proposta.** `CHECK (ptax > 0 AND roe > 0)` na tabela; faixa de
sanidade nas duas RPCs — rejeitar cotação que divirja mais de, digamos, 10% da
última `event_date` registrada, exigindo confirmação explícita
(`p_force_out_of_band boolean`) e gravando justificativa em `audit_logs`;
`is_admin()` no wrapper manual.

### F9 — PTAX reconstruída por divisão grava cotação que nunca existiu

**Severidade: Média. Evidência: Teste de contrato SQL.**

Três pontos derivam a PTAX invertendo o spread:

- `create_demurrage_invoice_with_items:4536` — `v_ptax := ROUND(p_current_roe / 1.065, 4)`
  para a foto inicial do histórico.
- `confirm_demurrage_pix_matches:4057` — `COALESCE(r.ptax_used, ROUND(d.current_roe / 1.065, 4))`.
- `confirm_unified_pix_matches:4137` — fallback de legado da janela das duas PTAX.

Quando `roe_source = 'manual'`, o ROE foi digitado à mão e **não** é
PTAX × 1,065. A divisão devolve um número que nunca foi cotação do Banco
Central, e ele é gravado em `demurrage_invoice_history.ptax_used` — a mesma
coluna que `get_demurrage_recent_values` serve para a conciliação da janela de
duas PTAX (ADR 0015). Auditoria de câmbio lendo essa coluna lê ficção.

**Correção proposta.** `ptax_used` deve ser `NULL` quando a PTAX real não é
conhecida (`roe_source = 'manual'`), e o consumidor deve tratar `NULL` como "sem
cotação de referência". Nunca derivar por divisão: o par (PTAX, ROE) já é
conhecido no ponto de entrada e deve ser propagado como par.

### F10 — O markup 1,065 está replicado em sete pontos

**Severidade: Média. Evidência: Código + ADR.**

ADR 0014 decide: *"O markup 1,065 é spread fixo; fica no código, **centralizado
num único ponto canônico**"*. A realidade:

| Local | Uso |
|---|---|
| `src/services/demurrage/demurrageKpis.ts:9` | `DEMURRAGE_ROE_MARKUP = 1.065` |
| `002:4042` | `ROUND(ptax_used * 1.065, 4)` |
| `002:4057` | `ROUND(current_roe / 1.065, 4)` (inverso) |
| `002:4137` | `ROUND(current_roe / 1.065, 4)` (inverso) |
| `002:4536` | `ROUND(p_current_roe / 1.065, 4)` (inverso) |
| `002:14047` | `ROUND(p_ptax * 1.065, 4)` |
| `src/components/layout/HeaderInfoBar.tsx:78,109` | texto de UI |

São sete pontos em três camadas, três deles usando o **inverso**. Se o armador
mudar o spread, a mudança tem de acertar cinco literais SQL em sincronia — e os
três inversos reinterpretariam retroativamente faturas antigas. O ADR está
descrito como implementado; não está.

**Correção proposta.** `public.demurrage_roe_markup()` `IMMUTABLE` no banco como
ponto canônico, consumida pelas cinco RPCs; o TS lendo o mesmo valor via RPC ou
`app_settings`; e um `ponytail:` no ponto canônico registrando que o spread é
versionado por data caso mude (hoje ele não é — faturas antigas seriam
reinterpretadas).

### F15 — Falha da API do BACEN é um dia sem recálculo e nenhum alerta

**Severidade: Baixa. Evidência: Código.**

`supabase/functions/recalc-demurrage-ptax/index.ts` acerta a parte difícil: a
janela de ~10 dias com `$top=1&$orderby=dataHoraCotacao desc` significa que fim
de semana, feriado e "ainda não divulgada" **não** quebram nada — devolvem a
última cotação disponível. É a política correta e está documentada no ADR 0014.
Respondendo diretamente ao escopo: **sim, o fallback de fim de semana/feriado é
determinístico.**

O que falta é o caminho de erro real:

- `fetch` único, `AbortSignal.timeout(12000)`, **sem retry**. Um blip de rede
  do BCB e o dia inteiro fica sem recálculo.
- A falha vira `console.error` + HTTP 502. Nada cria alerta operacional. O ADR
  diz que "o caminho manual em /demurrage cobre esse caso", mas ninguém é
  avisado de que precisa cobrir.
- `fmtBcbDate` usa `getMonth`/`getDate`/`getFullYear`, isto é, o fuso do runtime
  (UTC). Com o agendamento de ~14h BRT (17h UTC) isso é inofensivo; se alguém
  mover o cron para depois das 21h BRT, `today` vira o dia seguinte. A janela de
  10 dias absorve, mas o código não diz que depende disso.

**Correção proposta.** Três tentativas com backoff (2s/4s/8s) antes de desistir;
`block521_upsert_alert` no ramo de falha, com resolução automática no próximo
sucesso; `fmtBcbDate` explicitamente em `America/Sao_Paulo`.

### Ponto flutuante: onde está e onde não está

**Evidência: Código.**

Respondendo ao escopo: **o banco está certo, o navegador não.**

- Persistência é `numeric` com escala fixa em todo lugar relevante:
  `numeric(14,2)` para totais, `numeric(10,4)` para ROE/PTAX,
  `numeric(12,2)` para descontos e unitários. `ROUND(x, 2)` em `numeric` é
  meio-para-cima exato. Não há `float`/`double precision` em coluna monetária.
- O TypeScript, ao contrário, faz aritmética monetária em IEEE-754 e volta a
  gravar: `parseFloat((discountedUsd * roe).toFixed(2))`
  (`demurrageInvoices.ts:316,347`), `subtotal_usd * roeValue`
  (`InvoiceDocument.tsx:22`), `blItems.reduce((s, i) => s + Number(i.total_value_brl))`
  (`InvoiceDocumentLocal.tsx:90`), e `valor.toFixed(2)` no payload PIX
  (`src/lib/pix.ts:29`).

`toFixed(2)` **não** é `ROUND(numeric, 2)`. `toFixed` arredonda a representação
binária; `numeric` arredonda o decimal:

| Valor | `toFixed(2)` (TS) | `ROUND(...,2)` (SQL) |
|---|---|---|
| 1,005 | `"1.00"` | `1.01` |
| 2,675 | `"2.67"` | `2.68` |
| 1.234,565 | `"1234.57"` | `1234.57` |

Enquanto o TS recebe valores que já vieram com 2 casas do banco, o resultado
coincide. A divergência aparece exatamente onde o TS **multiplica** antes de
arredondar — F1, F7 e F11.

**Correção proposta.** Nenhuma reescrita para centavos-inteiros é necessária se
a regra for: **o navegador nunca produz um valor monetário que será gravado ou
impresso como autoridade**. Toda multiplicação/soma monetária desce para SQL; o
TS só formata. Onde o TS precisar mesmo somar para exibição, some em centavos
inteiros (`Math.round(v * 100)`) e divida no fim.

---

## 3. Prontidão (readiness) e idempotência

### F12 — A RPC de readiness não é o gate de emissão de invoice

**Severidade: Média. Evidência: Teste de contrato SQL.**

A premissa da pergunta está invertida, e vale corrigi-la antes de auditar:
`customer_local_charges_communication_readiness` (`002:5403`) **não** gateia a
geração de invoice. Ela exige
`financial_status IN ('invoiced', 'paid')` como uma de suas condições — ou seja,
ela roda **depois** do faturamento e libera o **comunicado** ao cliente.

O gate real da emissão é outro, e é sólido: `charge_status = 'ready_for_billing'`,
`financial_status = 'pending'`, `customer_reconciliation_status IN ('matched_document','reconciled')`
e ausência de vínculo ativo em `invoice_bls`, todos em
`create_invoice_from_bls_core` (`002:4670-4718`), com
`SELECT ... FROM bls WHERE id = ANY(...) FOR UPDATE` antes das checagens. O CE
Mercante entra pelo `compute_bl_review_pendencies` via `charge_status`
(ADR 0020/0042), não por essa RPC.

Dito isso, três observações sobre a readiness em si:

- **É `STABLE` e não participa da transação de despacho.** Existe janela
  TOCTOU entre `ready = true` e o envio; se um B/L do cliente for cancelado ou
  voltar a `pending_review` no intervalo, o comunicado sai com o estado velho.
- **Usa uma sobrecarga diferente de `compute_bl_review_pendencies`.** A
  readiness chama `(customer_id, cargo_mode, bb_weight_ton)` (`002:3983`);
  `recompute_bl_review_status` chama `(p_bl_id)` (`002:3953`). Duas funções com
  o mesmo nome e conjuntos de pendência potencialmente diferentes decidindo,
  respectivamente, se o cliente pode ser avisado e se o B/L pode ser faturado.
  Se divergirem, divergem em silêncio.
- **`reason_code` é `reasons ->> 0`**, isto é, o primeiro motivo em ordem
  alfabética (`ce_mercante_ausente` < `faturamento_pendente` < `revisao_pendente`).
  Determinístico, mas a ordem alfabética não é a ordem de prioridade
  operacional — o operador vê "CE ausente" mesmo quando o bloqueio dominante é
  outro.

**Correção proposta.** Reexecutar a readiness **dentro** de
`create_customer_communication_atomic`, antes do INSERT, para o kind de taxas
locais — a checagem fora da transação é uma prévia de UI, não um gate. Unificar
as duas sobrecargas de `compute_bl_review_pendencies` numa só. Substituir
`reasons ->> 0` por uma ordenação explícita de severidade.

### Emissão duplicada: o que já está protegido

**Evidência: Teste de contrato SQL.** Antes dos achados, o crédito devido — a
maior parte da pergunta sobre duplo clique já tem resposta boa no código:

| Caminho | Proteção |
|---|---|
| Invoice de Demurrage | `SELECT ... FROM bls WHERE id = p_bl_id FOR UPDATE` + `EXISTS(status IN ('issued','paid'))` + índice `uq_demurrage_invoices_active_bl` (`001:6998`). Duplo clique e corrida concorrente estão cobertos — o índice único é a garantia final. |
| Invoice de taxas locais | `FOR UPDATE` nos B/Ls + `financial_status <> 'pending'` + conflito em `invoice_bls` + trigger `prevent_duplicate_active_invoice_bl_link`. |
| Pagamento local | `register_ledger_invoice_payment` com `FOR UPDATE` na invoice e nos receivables, dedupe explícito de TXID **e** índice `idx_ledger_settlements_unique_normalized_pix_txid` (`001:6590`). |
| Comunicado ao cliente | `customer_communications_idempotency` (`001:5838`) `NULLS NOT DISTINCT` sobre a tupla de âncora + `attempt_discriminator`. |
| Recálculo diário de PTAX | `CONTINUE WHEN current_roe = v_roe` — rodar a Edge Function duas vezes no mesmo dia é no-op, sem linha de histórico duplicada. |

A lacuna está toda concentrada em um lugar: a baixa de Demurrage.

### F2 — `confirm_demurrage_pix_matches` é uma porta aberta para baixa de fatura

**Severidade: Alta. Evidência: Teste de contrato SQL.**

`confirm_demurrage_pix_matches` (`002:4025`) é `LANGUAGE plpgsql` **sem**
`SECURITY DEFINER`, **sem** nenhuma checagem de `auth.uid()`, `is_active_user()`
ou `is_admin()` — e está `GRANT ALL ... TO authenticated` (`002:27567`). Toda a
validação de valor mora no chamador, `confirm_unified_pix_matches` (`002:4123-4148`),
que confere o valor contra a janela das duas PTAX (ADR 0015) antes de delegar.

Chamada direta pula a validação inteira. Um usuário interno ativo qualquer
(a política `demurrage_invoices_update_active_global` permite o UPDATE) pode
executar:

```sql
select public.confirm_demurrage_pix_matches(
  '[{"invoice_id": 123, "paid_at": "2026-09-05", "pix_txid": "X", "total_brl": 1.00, "ptax_used": 1}]'::jsonb
);
```

e a fatura fica `paid`, com `current_total_brl = 1,00` e `current_roe = 1,065`.

Somam-se, no mesmo corpo:

- **Sem checagem de status.** O `UPDATE` não filtra `status`; uma fatura já
  paga é remarcada e ganha outra linha de histórico.
- **Sem dedupe de TXID.** O ramo local checa `ledger_settlements`; o ramo
  demurrage não checa nada. Reimportar o mesmo extrato reprocessa. (Na prática
  a UI oferece só faturas `status = 'issued'` — `reconciliacao.ts:234` — então a
  exposição pela tela é limitada; pela RPC direta, não.)
- **Desconto derivado do pagamento.** `GREATEST(0, ROUND(total_usd - total_brl / roe, 2))`
  transforma qualquer pagamento a menor em "desconto" no histórico, e apaga
  qualquer pagamento a maior no `GREATEST`.
- **Sem `audit_logs`.** O trigger `audit_demurrage_invoices` grava a mudança de
  coluna, mas não há registro de intenção/justificativa como no caminho local.

Compare com o caminho local, que exige `is_admin()`, valida
`ABS(p_amount_brl - v_open) > 0.01` para PIX, trava com `FOR UPDATE` e grava
auditoria. A assimetria não tem justificativa documentada.

**Correção proposta.** Nesta ordem:

1. `REVOKE ALL ON FUNCTION public.confirm_demurrage_pix_matches(jsonb) FROM authenticated;`
   e tornar `confirm_unified_pix_matches` `SECURITY DEFINER` com guard
   `is_admin()` — a validação e a execução passam a ser inseparáveis.
2. Guard `is_admin()` **também** dentro de `confirm_demurrage_pix_matches`
   (defesa em profundidade: uma função de dinheiro não deve depender de quem a
   chama).
3. `WHERE d.id = r.invoice_id AND d.status = 'issued' AND d.paid_at IS NULL` no
   `UPDATE`, para que reprocessar seja no-op em vez de reescrita.
4. Índice `CREATE UNIQUE INDEX ... ON demurrage_invoices (upper(regexp_replace(pix_txid,'[^A-Za-z0-9]','','g'))) WHERE pix_txid IS NOT NULL`
   — o espelho do que já existe em `ledger_settlements`.
5. Parar de inferir desconto do valor pago: gravar `discount_usd` a partir do
   desconto real da fatura e registrar divergência de valor como exceção de
   conciliação, não como desconto.

### F11 — O caminho de pagamento de Demurrage escreve dinheiro direto da tabela

**Severidade: Média. Evidência: Código.**

`markInvoicePaid` (`demurrageInvoices.ts:296-327`) e `recomputeDiscountedBrl`
(`:339-357`) fazem `supabase.from('demurrage_invoices').update({...})` do
navegador, gravando `status`, `paid_at`, `current_roe`, `current_total_brl` e
`pix_payload`. Consequências:

- **Sem compare-and-swap.** `markInvoicePaid` lê o status, decide, e depois
  atualiza sem `.eq('status', 'issued')`. Dois cliques concorrentes passam os
  dois; o segundo sobrescreve `paid_at`. Um `.eq('status','issued').eq('paid_at', null)`
  com verificação de linhas afetadas resolveria.
- **Autoridade de valor no cliente.** `current_total_brl` é calculado com
  `parseFloat((discountedUsd * roe).toFixed(2))` — a mesma coluna que
  `recalculate_demurrage_invoices` calcula com `ROUND(numeric, 2)`. Como o
  recálculo só roda `WHEN current_roe <> v_roe`, o valor escrito pelo TS
  **persiste** até a PTAX mudar, e então muda de centavo sozinho.
- **Assimetria com a reversão.** Existe `reverse_demurrage_payment` (`002:17738`)
  como RPC no servidor. Marcar como pago é do cliente; desmarcar é do servidor.

**Correção proposta.** Uma RPC `register_demurrage_payment(p_invoice_id, p_paid_at, p_roe, p_source)`
que faça `SELECT ... FOR UPDATE`, valide o status, calcule
`current_total_brl` **em SQL** e grave o payload PIX pela função SQL. As duas
funções TS passam a chamá-la. É o espelho exato do que o lado local já tem.

### F14 — Tolerância de R$ 0,01 quita saldo e deixa o ledger inconsistente

**Severidade: Baixa. Evidência: Teste de contrato SQL.**

`register_ledger_invoice_payment` (`002:16185-16190`) marca o receivable como
`settled` quando `balance - allocation <= 0.01`, mas grava
`balance_brl = GREATEST(balance - allocation, 0)` — o centavo residual **fica na
linha**. Como o saldo da invoice soma apenas receivables `open`/`partially_settled`,
o centavo desaparece da invoice e permanece no ledger.

Efeito: `SUM(balance_brl)` sobre todos os receivables ≠ `SUM(balance_brl)` sobre
os abertos, e a diferença é dinheiro perdoado que ninguém decidiu perdoar.
Individualmente irrelevante; sistematicamente, é um vazamento de contas a
receber sem trilha de decisão. O PIX está protegido (exige valor exato); o
caminho manual não.

**Correção proposta.** Zerar `balance_brl` quando a linha vira `settled` e
registrar o residual explicitamente — `invoice_write_offs` ou uma linha de
ajuste no ledger com o ator e a justificativa. Quitar por tolerância é decisão
contábil e deve deixar rastro.

---

## 4. Documentos e PIX

### F7 — Dois geradores de payload PIX escrevendo a mesma coluna

**Severidade: Média. Evidência: Código.**

Existem duas implementações independentes e byte-a-byte espelhadas do mesmo
payload:

- SQL: `build_transshipping_pix_payload` + `pix_tlv` + `pix_crc16_ccitt`
  (`002:2852`, `11456`, `11354`), usada pela trigger
  `populate_local_invoice_pix_payload` e por `create_demurrage_invoice_with_items`.
- TS: `buildTransshippingPixPayload` (`src/lib/pix.ts`), usada por
  `persistPixPayload` (`billing.ts:111`), `backfillInvoicePixPayload`
  (`billing.ts:766`), `markInvoicePaid` e `recomputeDiscountedBrl`.

**As duas gravam a mesma coluna `pix_payload`.** E formatam o valor de maneiras
diferentes: `TO_CHAR(ROUND(p_amount_brl, 2), 'FM...0.00')` sobre `numeric` versus
`valor.toFixed(2)` sobre `double`. Hoje elas coincidem porque o TS recebe
valores que já vieram com duas casas do banco — mas um centavo de diferença no
campo 54 muda o CRC16 e produz **um QR diferente para a mesma fatura**, e a
conciliação por TXID não perceberia (o TXID é o mesmo).

Verificado também: o CRC16 em ambas as implementações é CRC-16/CCITT-FALSE
correto (init `0xFFFF`, polinômio `0x1021`, sem reflexão, sem XOR final), e os
vetores dourados em `src/lib/__tests__/pix.test.ts` conferem contra o vetor
público `"123456789" → 0x29B1`. **O CRC não é o problema.** As duas
implementações também iteram *caracteres*, não *bytes* — inofensivo hoje porque
os campos são sanitizados para ASCII, frágil se a sanitização mudar.

**Correção proposta.** Uma autoridade só: a função SQL. O TS deve chamar
`build_transshipping_pix_payload` via RPC (ou deixar a trigger preencher) e
`src/lib/pix.ts` deve ficar restrito a `normalizePixTxid`. Se a geração local
for necessária para prévia offline, mantenha-a mas **nunca** grave o resultado —
e adicione um teste que compare as duas implementações sobre um conjunto de
valores de borda.

### F8 — Desvios em relação ao BR Code do BACEN

**Severidade: Média. Evidência: Código; itens marcados como Suspeita precisam
de conferência contra o Manual de Padrões BR Code vigente.**

Decompondo o vetor dourado do teste
(`00020126480014br.gov.bcb.pix0114063529720001210508TESTTXID52040000530398654061 23.455802BR5925TRANSHIPPING AGENCIAMENTO6003VIT62120508TESTTXID63049823`):

| Campo | Conteúdo | Situação |
|---|---|---|
| `00` | `01` | OK |
| `26/00` | `br.gov.bcb.pix` | OK |
| `26/01` | `06352972000121` | OK (chave CNPJ) |
| `26/05` | txid | **Fora da especificação** |
| `52` | `0000` | OK |
| `53` | `986` | OK |
| `54` | valor | OK, com as ressalvas de F3 |
| `58/59/60` | `BR` / nome / cidade | OK |
| `62/05` | txid | OK — é aqui que o txid pertence |
| `63` | CRC16 | OK |

- **Sub-tag `05` dentro da tag `26`.** O template de conta do PIX define `00`
  (GUI), `01` (chave) e `02` (informação adicional) para QR estático; `05` não
  existe ali. O txid já está corretamente em `62/05`, então o campo é ao mesmo
  tempo redundante e não conforme. Bancos costumam tolerar sub-tags
  desconhecidas, mas validadores estritos podem recusar. Presente nas duas
  implementações (`pix.ts:23` e `002:2869`).
- **txid truncado em 35 caracteres.** Para QR **estático** o txid é limitado a
  25 caracteres (35 vale para cobranças dinâmicas). O código corta em 35 e o
  teste `'limita o txid a 35 caracteres'` **fixa esse comportamento como
  correto**. Na prática os `doc_number`/`invoice_number` reais têm ~13
  caracteres, então nada quebra hoje — mas o limite está errado e o teste
  protege o erro. **Suspeita**: confirmar contra o manual vigente antes de
  mexer.
- **Ausência da tag `01` (Point of Initiation Method).** Sem `010212`, o QR é
  reutilizável. Cada fatura tem valor fixo e txid próprio — é semanticamente de
  uso único. Um cliente pode escanear o mesmo QR duas vezes; o segundo PIX
  chegaria com o mesmo TXID, seria recusado pelo dedupe local
  (`already_reconciled`) e viraria exceção não alocada. O comportamento
  defensivo existe, mas o dinheiro fica parado.
- **Acentos são apagados, não transliterados.** `replace(/[^A-Za-z0-9 ]/g, '')`
  em nome e cidade transforma `SÃO PAULO` em `SO PAULO`. Hoje `COMPANY.pixCity`
  é `'VIT'` e o nome é ASCII, então não morde — mas a função aceita parâmetros e
  é a primeira coisa a quebrar se a razão social mudar. Normalizar com
  `NFD` + remoção de diacríticos preserva a leitura.
- **Chave forçada a dígitos.** `chavePix.replace(/[^0-9]/g, '')` destrói
  qualquer chave que não seja CPF/CNPJ/telefone (e-mail, EVP). Assinatura
  genérica, comportamento específico.
- **Nome truncado no meio da palavra.** `TRANSHIPPING AGENCIAMENTO` (25 chars) —
  é o que o pagador vê no app. Cosmético, mas visível ao cliente.
- **Sem validação de tamanho do campo 54.** A tag 54 tem limite de 13
  caracteres; nenhuma das implementações verifica.

### O PDF bate com o banco?

**Evidência: Código.** Respondendo diretamente: **a fatura de taxas locais bate
com o banco; a de Demurrage não bate consigo mesma.**

- `InvoiceDocumentLocal.tsx:107-109,140` imprime `quantity`,
  `unit_value_brl` e `total_value_brl` **direto das colunas**, e o TOTAL de
  `invoice.total_brl`. Nenhum recálculo. Centavo por centavo com o banco. Os
  dois problemas são de *legibilidade aritmética*: `qtd × unitário ≠ total`
  para rateio de container (F6) e para linhas em USD com quantidade ≠ 1 — o
  banco arredonda `unit_value_brl` e `total_value_brl` **independentemente**
  (`002:4841-4842`), então 3 × R$ 135,80 = R$ 407,40 aparece ao lado de um total
  de R$ 407,41.
- `InvoiceDocument.tsx` (Demurrage) recalcula as linhas no navegador — F1.

O `subtotal` por B/L da fatura local também é somado em float no navegador
(`InvoiceDocumentLocal.tsx:90`); com a formatação em 2 casas o erro só apareceria
com muitas linhas, mas somar em centavos inteiros custa uma linha.

---

## 5. Casos de teste de borda para a esteira de faturamento

Casos que a suíte atual não cobre. Cada um tem um resultado esperado
verificável; os marcados com ✗ **falham hoje** contra o comportamento descrito
neste documento.

### Demurrage — cálculo

| # | Cenário | Esperado |
|---|---|---|
| D1 | ✗ Tarifa com lacuna: `free=10`, `p1=[11,15]`, `p2_from=18`, `dc=20` | Emissão recusada ou dias 16–17 cobrados. Hoje: passam de graça |
| D2 | Tarifa com sobreposição: `p1=[11,15]`, `p2_from=15` | Recusa com mensagem que cite a tarifa mal cadastrada |
| D3 | `free_time_override` maior que `p1_day_to` | `days_p1 = 0`, P2 começando em `override + 1` |
| D4 | `free_time_override = 0` | Cobrança a partir do dia 1 na faixa P1 |
| D5 | `return_date = discharge_date` | `total_days = 0`, `within_free_time`, `total_usd = 0` |
| D6 | `return_date < discharge_date` | Exceção nas duas camadas (TS e RPC) |
| D7 | Descarga e devolução cruzando 1º de janeiro | `total_days` = diferença de calendário, sem off-by-one |
| D8 | ✗ Duas linhas ativas de `demurrage_rates` para `20GP` com vigências sobrepostas | Recusa explícita. Hoje: desempate silencioso por `valid_from DESC, id DESC` |
| D9 | ✗ `demurrage_rates` indisponível e cache em memória com 1 h de idade | Recusa de cálculo. Hoje: tarifa velha usada indefinidamente |
| D10 | ✗ Item enviado com `rate_p1_usd` divergente da tabela | Recusa da RPC. Hoje: aceito |
| D11 | ✗ Item enviado com `days_p2` **menor** que o devido | Recusa. Hoje: veto só pega excesso |

### Demurrage — desconto e câmbio

| # | Cenário | Esperado |
|---|---|---|
| D12 | ✗ `discount_mode='fixed'`, `discount_value > total_usd` | Recusa no `CHECK`. Hoje: `current_total_brl` negativo e QR sem valor |
| D13 | `discount_mode='percent'`, `discount_value=100` | `current_total_brl = 0`, sem QR PIX (ou QR recusado) |
| D14 | ✗ `roe_source='manual'`, ROE digitado 5,0000 | `ptax_used` nulo no histórico. Hoje: grava 4,6948 (= 5,0000/1,065) |
| D15 | Recálculo rodando duas vezes com a mesma PTAX | Segunda execução é no-op, sem linha nova de histórico |
| D16 | Recálculo manual e Edge Function concorrentes | Serializados por `FOR UPDATE`; um deles vira no-op |
| D17 | ✗ `recalculate_demurrage_invoices_manual(55.0)` por engano | Confirmação exigida por faixa de sanidade. Hoje: reprecifica tudo |
| D18 | BCB devolve HTTP 500 | 3 tentativas com backoff e alerta operacional criado |
| D19 | BCB devolve período vazio em segunda-feira de feriado | Última cotação da janela de 10 dias, sem falha (comportamento atual, correto) |
| D20 | ✗ 3 containers de US$ 137,55, ROE 5,4321 | Soma das linhas impressas = TOTAL impresso |

### Idempotência e pagamento

| # | Cenário | Esperado |
|---|---|---|
| I1 | Duplo clique em "emitir invoice de Demurrage" | Uma fatura; segunda tentativa erra com `23505` |
| I2 | Duas sessões emitindo Demurrage para o mesmo B/L simultaneamente | Índice único vence; uma delas falha (comportamento atual, correto) |
| I3 | Duplo clique em "emitir invoice de taxas locais" | Uma fatura; segunda erra em `financial_status` ou `invoice_bls` |
| I4 | Mesmo extrato PIX importado duas vezes (caminho local) | Segunda importação: `already_reconciled` para todas as linhas |
| I5 | ✗ Mesmo extrato PIX importado duas vezes (caminho Demurrage) | Idem. Hoje: sem dedupe de TXID no ramo demurrage |
| I6 | ✗ `confirm_demurrage_pix_matches` chamada direto por usuário não-admin | `42501`. Hoje: executa |
| I7 | ✗ `confirm_demurrage_pix_matches` sobre fatura já `paid` | No-op. Hoje: remarca e insere histórico |
| I8 | ✗ Duplo clique em "marcar como pago" (Demurrage) | Segundo clique no-op. Hoje: sobrescreve `paid_at` |
| I9 | Pagamento PIX com R$ 0,01 a menos que o saldo | Recusa (`Conciliacao PIX exige valor exato`) — comportamento atual, correto |
| I10 | ✗ Pagamento manual com R$ 0,01 a menos | Residual registrado como write-off explícito. Hoje: perdoado em silêncio |
| I11 | Edge Function `recalc-demurrage-ptax` invocada duas vezes no mesmo minuto | Segunda: `updated = 0` |
| I12 | Comunicado despachado duas vezes com a mesma âncora e `attempt_discriminator` | Uma linha; índice de idempotência bloqueia |
| I13 | ✗ Readiness `true`, B/L cancelado, despacho em seguida | Recusa no `create_customer_communication_atomic`. Hoje: comunicado sai |

### Taxas locais e rateio

| # | Cenário | Esperado |
|---|---|---|
| L1 | ✗ B/L A faturado sozinho; B/L B do mesmo container importado depois | Alerta de mudança de rateio. Hoje: 150% do container cobrado no agregado |
| L2 | Container dividido entre 7 B/Ls | Soma dos 7 totais = valor cheio do container (comportamento atual, correto) |
| L3 | ✗ Fatura impressa de B/L com container rateado entre 7 | `qtd × unitário` fecha com o total impresso |
| L4 | ✗ Linha em USD com quantidade 3 | `unit_value_brl × 3` fecha com `total_value_brl` |
| L5 | ✗ Linha `exempt` com `total_value_usd > 0` e sem ROE configurado | Recusa. Hoje: item entra a R$ 0,00 (F16) |
| L6 | ROE não configurado com linhas em USD elegíveis | Recusa explícita (comportamento atual, correto) |
| L7 | ✗ `save_exchange_rate_reference(0, 0, hoje)` | Recusa no `CHECK`. Hoje: aceito |
| L8 | Container com `is_imo` **e** `is_oog` | Linha de revisão manual (comportamento atual, correto) |

### F16 — Filtros de status divergentes na emissão de taxas locais

**Severidade: Baixa. Evidência: Teste de contrato SQL.**

Em `create_invoice_from_bls_core`, a contagem que decide se o ROE é necessário
filtra `status IN ('calculated','reviewed','ready_for_billing')` (`002:4726`),
mas o `INSERT` de `invoice_items` inclui também `'exempt'` (`002:4872`). Uma
linha `exempt` com `total_value_usd > 0` entraria sem ROE carregado:
`ROUND(usd * NULL, 2)` → `NULL` → `COALESCE(..., 0)` → **item gravado a R$ 0,00
sem erro**. Hoje as linhas de isenção nascem com valor zero, então o caminho não
dispara — mas os dois filtros deveriam ser a mesma expressão.

**Correção proposta.** Extrair o predicado para uma constante única (CTE ou
função) usada nos três pontos, e substituir o `COALESCE(..., 0)` final por
exceção quando a conversão resultar em `NULL`.

### F17 — `CURRENT_DATE` em UTC: data de faturamento e régua de cobrança em fusos diferentes

**Severidade: Baixa. Evidência: Teste de contrato SQL.**

`create_demurrage_invoice_with_items` grava `billed_at`, `first_billed_at` e a
`event_date` inicial do histórico com `CURRENT_DATE`, que no Supabase é UTC.
Uma fatura emitida às 21h30 BRT nasce datada do dia seguinte. Já
`claim_demurrage_dunning_candidates` calcula o vencimento da régua com
`di.first_billed_at::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'` (`002:3521`).
Grava-se em UTC e lê-se em BRT — a régua de cobrança de faturas emitidas à noite
sai um dia deslocada.

**Correção proposta.** `(now() AT TIME ZONE 'America/Sao_Paulo')::date` em toda
data de negócio, como já é feito em `reconcile_voyage_baplie_coverage_alerts`
(`002:15119`). O fuso de negócio deve ser uma decisão explícita, não o default
do servidor.

---

## 6. Propostas de correção, priorizadas

Ordem de execução recomendada. Cada bloco é independente e pode virar um plano
em `docs/plans/`.

**Bloco 1 — Fechar a porta da baixa de Demurrage (F2, F11).**
`REVOKE` de `confirm_demurrage_pix_matches` para `authenticated`; guard
`is_admin()` dentro dela; `WHERE status = 'issued' AND paid_at IS NULL` no
`UPDATE`; índice único de `pix_txid` normalizado em `demurrage_invoices`; RPC
`register_demurrage_payment` substituindo o `update()` do navegador. É o único
bloco onde existe caminho para baixa arbitrária de fatura.

**Bloco 2 — Guardas de valor no banco (F3, F5, F13).**
`CHECK` de desconto fixo ≤ `total_usd`; `CHECK (ptax > 0 AND roe > 0)` em
`exchange_rate_reference`; `CHECK`s e `EXCLUDE` de vigência em `demurrage_rates`;
faixa de sanidade nas RPCs de PTAX/ROE; `GREATEST(..., 0)` no recálculo. Barato,
e move invariantes de negócio para onde elas não podem ser contornadas.

**Bloco 3 — Uma autoridade aritmética por valor (F1, F7, F10, F11).**
Documento de Demurrage deixando de recalcular; `pix_payload` gerado só em SQL;
`1,065` num único ponto canônico. Regra a ser escrita em ADR: *o navegador
formata, o banco calcula*.

**Bloco 4 — Autoridade de tarifa no servidor (F4, F13).**
`demurrage_expected_item()` e o veto comparando contra ela; cache de tarifa que
expira em vez de renovar na falha.

**Bloco 5 — Legibilidade e conformidade do documento (F6, F8).**
Quantidade rateada legível; `qtd × unitário` fechando com o total; remoção da
sub-tag `26/05`; revisão do limite de txid e da tag `01` contra o manual
vigente; transliteração de acentos.

**Bloco 6 — Observabilidade e datas (F9, F12, F14, F15, F16, F17).**
Retry e alerta na Edge Function; readiness reexecutada dentro da transação de
despacho; `ptax_used` nulo quando não há PTAX real; write-off explícito;
predicado de status unificado; datas de negócio em `America/Sao_Paulo`.

## Reprodução numérica

Reproduz os números das tabelas de F1, F6 e da seção de ponto flutuante.
`node <arquivo>`, sem dependências.

```js
function exactRound2(usd, roe) {              // ROUND(numeric, 2), meio-para-cima
  const u = BigInt(Math.round(usd * 100))
  const r = BigInt(Math.round(roe * 10000))
  const prod = u * r
  const q = prod / 10000n, rem = prod % 10000n
  return Number(rem * 2n >= 10000n ? q + 1n : q) / 100
}
const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// F1 — soma das linhas impressas vs TOTAL do banco
for (const [subs, roe] of [[[137.55, 137.55, 137.55], 5.4321], [[91.70, 91.70, 91.70, 91.70, 91.70], 5.6789]]) {
  const totalUsd = subs.reduce((a, b) => a + b, 0)
  const linhas = subs.map((s) => s * roe)                              // InvoiceDocument.tsx:22
  const somaImpressa = linhas.reduce((a, b) => a + Math.round(b * 100) / 100, 0)
  console.log(fmt(somaImpressa), 'vs', fmt(exactRound2(totalUsd, roe)))
}

// Ponto flutuante — toFixed(2) vs ROUND(numeric, 2)
for (const v of [1.005, 2.675, 1234.565]) {
  const cents = BigInt(Math.round(v * 1000)), q = cents / 10n, rem = cents % 10n
  console.log(v, v.toFixed(2), (Number(rem >= 5n ? q + 1n : q) / 100).toFixed(2))
}

// F6 — rateio de container
for (const [n, unit] of [[7, 890.0], [6, 1000.0]]) {
  const qty = Math.round((1 / n) * 1e6) / 1e6                          // NUMERIC(12,6)
  const share = Math.round((unit / n) * 100) / 100
  console.log(n, qty, fmt(qty * unit), 'vs', fmt(Math.round((unit - (n - 1) * share) * 100) / 100))
}
```

## Referências

- ADR [0008](../../adr/0008-demurrage-integrado-sem-unificar-persistencia.md) — Demurrage em persistência própria
- ADR [0014](../../adr/0014-demurrage-recalculo-diario-substitui-roe-congelado.md) — Recálculo diário, spread 1,065, disputas ortogonais
- ADR [0015](../../adr/0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md) — Janela das duas PTAX na conciliação
- ADR [0026](../../adr/0026-demurrage-validacao-item-rpc-veto.md) — Veto de item na RPC de emissão
- ADR [0038](../../adr/0038-taxa-local-valor-congelado-ancorado-na-escala.md) — Taxa local congelada na emissão
- ADR [0046](../../adr/0046-escrita-interna-global-com-rastro-obrigatorio.md) — Escrita interna global com rastro


---

## PR #659 — conformidade arquitetural, código morto e dívida técnica

Arquivo original incorporado integralmente abaixo. O snapshot, a evidência, os identificadores dos achados e as recomendações são preservados.

# Auditoria de conformidade arquitetural, código morto e dívida técnica

Data: 2026-09-06. Commit base: `bdf2241` (merge da PR 653).
Escopo: confronto entre o código executável e `docs/ARCHITECTURE.md`,
`docs/RASTREABILIDADE.md`, `docs/adr/` e `CONTEXT.md`.

Método: inventário estático do repositório (chamadas `.rpc`, corpos de função
das migrations 001–008, grafo de chamadas SQL, triggers, jobs `pg_cron`,
`.from()` do frontend) cruzado com verificação **Runtime** no projeto Supabase
de produção `fgmkhbzhaeebrsizwccx` (catálogo `pg_proc`, `proacl`, `cron.job`,
contagens de linhas). Nenhuma escrita foi feita no banco.

> **Contexto de volumetria que atravessa todo o relatório:** a base de produção
> está praticamente vazia — 0 B/Ls, 0 containers, 0 invoices, 0 faturas de
> Demurrage, 0 clientes, 0 contatos; 36 viagens, 121 `alert_items` e 269
> `audit_logs`. O sistema ainda não entrou em operação real (coerente com a
> ADR 0062, escrita "antes de sua entrada formal em produção"). Isso muda a
> leitura do vetor 3: **nenhum teto declarado em comentário `ponytail:` foi
> atingido**, porque não há volume. O valor do inventário aqui é priorizar o
> que quebra primeiro quando o volume chegar, não apagar incêndio. **Runtime.**

## Sumário executivo

| # | Achado | Severidade | Vetor | Evidência |
|---|---|---|---|---|
| 1 | `recalc-demurrage-ptax` não tem agendamento algum: o recálculo diário da ADR 0014 não roda | **P0** | 2, 4 | Runtime |
| 2 | `upsert_portal_invoice_exception` é executável por `anon` (grant a `PUBLIC` sobrevivente) | **P0** | 4 | Runtime |
| 3 | Modo Inspeção quebra na aba de faturamento: `portal_inspect_list_disputes` não existe | **P1** | 4 | Runtime |
| 4 | `src/types/database.ts` divergiu do schema: 55 RPCs expostas ausentes, 6 declaradas inexistentes | **P1** | 1, 2 | Código + Runtime |
| 5 | `portal_list_operation_bls_legacy` chama função inexistente — erro em tempo de execução | **P2** | 2 | Runtime |
| 6 | 14 funções mortas no schema (13 `*_legacy` + `reconcile_bl_review_alerts_item`) | **P2** | 2 | Runtime |
| 7 | `RASTREABILIDADE.md` desatualizada: contagens erradas, 2 caminhos inexistentes, 83 RPCs fora do índice | **P2** | 1 | Código |
| 8 | Trilha de auditoria escrita pelo cliente e não atômica em `applyBapliePhysicalFlags` (ADR 0046) | **P2** | 4 | Código |
| 9 | 4 colunas mortas e 2 write-only no schema | **P3** | 2 | Código |
| 10 | `ponytail:` obsoletos (1) e com gatilho de upgrade já disparado (2) | **P3** | 3 | Código |

---

## Vetor 1 — Drift de rastreabilidade

### 1.1 Cabeçalho de `RASTREABILIDADE.md` está numericamente errado

O documento declara (linhas 10–12):

> "Nesta etapa foram inventariados 61 nomes literais de RPC, 41 tabelas
> acessadas diretamente e os diretórios de `supabase/functions` (hoje 13 Edge
> Functions além de `_shared`)."

Contagem real no repositório:

| Métrica | Documento | Real | Método |
|---|---|---|---|
| Nomes literais de RPC chamados | 61 | **130** | `.rpc('…')` em `src/`, `supabase/functions/`, `scripts/` |
| RPCs expostas a `authenticated`/`anon` | — | **198** (repo) / **216** (produção) | grants das migrations; `has_function_privilege` |
| Tabelas acessadas diretamente pelo frontend | 41 | **62** | `.from('…')` em `src/` |
| Edge Functions | 13 | **15** | diretórios em `supabase/functions/` além de `_shared` |

As duas Edge Functions que entraram depois da última verificação do documento
são `customer-communication-auto-runner` e `send-customer-communication`
(ambas citadas no corpo do documento, mas não contabilizadas no cabeçalho).
**Código.**

### 1.2 Itens do índice que nunca existiram no código

Dois caminhos citados em backticks não existem (150 caminhos verificados, 2
falham). O ponto importante: **nenhum dos dois é resíduo de refatoração** —
`git log --all` sobre os dois caminhos não retorna commit algum. São
referências a artefatos que nunca foram escritos.

| Linha | Documento diz | Realidade |
|---|---|---|
| 195 | Rota `/line-up-tv` → `src/pages/LineUpTV.tsx`, com `Navigate` dedicado e `replace` | O arquivo nunca existiu e `/line-up-tv` nunca foi uma `<Route>` em `src/App.tsx`. O **comportamento** documentado até acontece — o catch-all `<Route path="*" element={<Navigate to="/painel" replace />} />` (`src/App.tsx:211`) leva qualquer caminho interno desconhecido a `/painel`. O que não existe é a implementação descrita. |
| 406 | `src/services/codAdjustments.ts` | Nunca existiu. O serviço real é `src/services/billingLedger.ts` (+ `src/hooks/useBillingLedger.ts`); `CodAdjustmentsPanel.tsx` consome `usePendingCodAdjustments`/`useSettleCodAdjustment` |

O caso `/line-up-tv` está replicado em três documentos vivos —
`docs/ARCHITECTURE.md:653`, `docs/RASTREABILIDADE.md:195` e
`docs/modules/operacao-suporte.md` (linhas 16, 134, 212, 216, esta última
descrevendo "`Navigate` com replace" como ação catalogada). É um comportamento
coerente e detalhado em três lugares, sustentado por um componente inexistente.

**Por que passou:** `scripts/check-docs.mjs:145` valida só um sentido — para
cada rota de `src/App.tsx`, exige uma menção no índice. Nada verifica o
inverso, nem que os caminhos `src/…` citados existam.

Estendendo a mesma checagem a **toda** a documentação viva (`docs/` menos
`archive/` e `design-audit/`), aparecem mais duas referências mortas, ambas em
catálogos de teste:

| Documento | Caminho citado | Realidade |
|---|---|---|
| `docs/modules/faturamento.md:335` | `src/components/billing/__tests__/PendenciasTable.test.tsx` | Nunca existiu. Estava numa lista de "arquivos que sustentam" filtros e emissão — ou seja, **cobertura de teste afirmada e inexistente**. A aba Pendências foi removida (`docs/modules/taxas-locais.md:96`) e a linha do teste ficou. |
| `docs/modules/viagens.md:134` | `src/components/shared/__tests__/VoyageImportActions.test.ts` | O arquivo real é `VoyageImportActions.behavior.test.tsx` |

Duas outras menções (`PendenciasFaturamentoTab.tsx` em `taxas-locais.md:96` e
`src/lib/uploadLimits.ts` em `docs/spec/README.md:106`) citam caminhos
inexistentes de forma **legítima**: ambas descrevem explicitamente a remoção ou
o rename do artefato. Não são defeito.

Recomendação: acrescentar ao `docs:check` a invariante "todo caminho
`src/…`/`supabase/…`/`scripts/…` em backticks na documentação viva existe no
disco", com uma lista curta de exceções para menções históricas declaradas.
Custo baixo, e teria pego os quatro casos acima. **Código.**

### 1.3 Superfície não indexada

- **83 das 198 RPCs expostas** não aparecem no índice. O bloco mais notável é o
  de PIX (`link_pix_reconciliation_candidate`,
  `list_pix_reconciliation_candidates`, `list_pix_reconciliation_exceptions`,
  `resolve_pix_reconciliation_exception`, `upsert_pix_reconciliation_exceptions`),
  o de notificações internas (`list_internal_notifications`,
  `mark_internal_notification_read`, `mark_all_internal_notifications_read`,
  `count_unread_internal_notifications`) e o de Vazios manual
  (`create_manual_vazios_booking`, `update_manual_vazios_booking`,
  `delete_manual_vazios_booking`).
- **15 dos 42 hooks** não são citados: `useAppSettings`, `useBilling`,
  `useBillingLedger`, `useCustomerCommunicationReadiness`,
  `useCustomerDemurrageAgreements`, `useDemurrageRates`, `usePageFilters`,
  `usePortalContactConfiguration`, `usePortalDisputes`, `usePortalNotifications`,
  `usePortalScope`, `useRoeHeaderRate`, `useRowSelection`, `useVisualTheme`,
  `useVoyageTimeline`.
- **7 tabelas** acessadas diretamente pelo frontend não são citadas:
  `customer_communication_boxes`, `customer_contact_box_links`,
  `portal_provisioning_events`, `portal_suppressed_emails`,
  `voyage_escala_operation_fronts`, `voyage_escala_revision_state`,
  `voyage_escala_terminal_state`.

**Código.**

### 1.4 Causa estrutural: parte da superfície de RPC é invisível à análise estática

`src/services/portalScope.ts:55` monta o nome da RPC em tempo de execução:

```ts
const rpcName = scope.mode === 'inspect' && !isShipSchedule
  ? `portal_inspect_${name.replace(/^portal_/, '')}`
  : name
```

Nenhuma das 11 RPCs `portal_inspect_*` aparece como literal no código. O mesmo
vale para `callReportIdAwareRpc` em `src/services/agencyDepartureReport.ts`.
Consequência prática: um índice mantido à mão **não tem como** ficar correto,
e a ausência de uma variante `portal_inspect_*` só aparece em runtime (é
exatamente o achado 3.2 abaixo). Recomendação: derivar o par
cliente/inspeção de uma tabela de constantes única, exportada, que sirva ao
mesmo tempo de fonte para o dispatcher, para o teste de contrato e para o
índice. **Código.**

---

## Vetor 2 — Código morto e RPCs fantasmas

### 2.1 Nenhum chamador aponta para RPC inexistente (lado do frontend)

Das 130 RPCs chamadas literalmente por `src/`, `supabase/functions/` e
`scripts/`, **todas as 130 existem** no schema consolidado. Não há RPC fantasma
no sentido de chamada para nome morto vindo do frontend. **Código.**

### 2.2 Edge Function órfã: `recalc-demurrage-ptax` — **P0**

`supabase/functions/recalc-demurrage-ptax/index.ts` **não é chamada por nada**:
nenhum caller em `src/`, nenhum job em `supabase/migrations/`, nenhum
workflow em `.github/`. Confirmado em produção — os 8 jobs ativos são:

```
alerts-foundation-detectors          */15 * * * *   ops.dispatch_edge_job('alerts-detector', …)
cleanup-portal-sessions              0 3 * * *
cleanup-provision-rate-limit         30 3 * * *
customer-communication-auto-runner   */15 * * * *   ops.dispatch_edge_job(…)
demurrage-dunning                    0 * * * *      ops.dispatch_edge_job(…)
portal-daily-digest                  0 11 * * *     ops.dispatch_edge_job(…)
portal-mark-expired-invites          */15 * * * *   SELECT public.portal_mark_expired_invites()
portal-refresh-general-pendencies    */15 * * * *   SELECT public.portal_refresh_general_pendencies()
```

Nenhum é `recalc-demurrage-ptax`. A tabela da ADR 0063 lista **quatro** jobs de
Edge Function e não inclui o recálculo; a migration `007_cron_secrets_no_vault.sql`
reagenda exatamente esses quatro.

**Por que isso é P0 e não faxina:** a ADR 0014 decide que "enquanto a invoice de
Demurrage não estiver paga, seu valor em BRL é recalculado a cada nova PTAX", e
nomeia a Edge Function agendada como o mecanismo — "necessária porque o portal
precisa do valor/QR atualizados mesmo sem ninguém com a página aberta". Sem
agendamento, o valor só muda quando um operador abre o modal "Informar PTAX".
O que a ADR descreve como automático é, hoje, manual. O cabeçalho da própria
Function ainda instrui a agendar pelo painel do Supabase
(`Schedule (cron) → dias úteis ~14h BRT`), o que contraria a ADR 0063 (a
configuração dos jobs é versionada e lê o Vault pelo dispatcher
`ops.dispatch_edge_job`).

O impacto está latente porque `demurrage_invoices` tem 0 linhas e
`demurrage_invoice_history` está vazia — ninguém percebeu porque não há o que
recalcular. Ele vira dinheiro errado na primeira fatura emitida.

Correção: uma migration `009` que agende
`SELECT ops.dispatch_edge_job('recalc-demurrage-ptax', 'RECALC_CRON_SECRET');`
em `0 17 * * 1-5` (UTC ≈ 14h BRT), cadastre `RECALC_CRON_SECRET` no Vault junto
com o Edge Function Secret de mesmo nome, e uma nota editorial na ADR 0063
somando o quinto job à tabela. Trocar também o comentário de cabeçalho da
Function, que hoje documenta um procedimento aposentado. **Runtime.**

### 2.3 Função quebrada: `portal_list_operation_bls_legacy` — **P2**

`portal_list_operation_bls_legacy()` chama
`public.portal_list_operation_bls_without_transshipment()`, que **não existe**
— nem no repositório nem em produção (`pg_proc` retorna 0). O que existe é
`portal_list_operation_bls_without_transshipment_legacy()` e o núcleo privado
`_portal_list_operation_bls_without_transshipment_core(bigint)`. Como plpgsql
resolve o corpo tardiamente, o `CREATE FUNCTION` passou e o erro só apareceria
na chamada. Ela é a única referência pendurada do schema inteiro (verificação
de todas as chamadas `public.X()` nos 417 corpos de função). Está morta, então
ninguém trombou — o que só reforça a remoção. **Runtime.**

### 2.4 Inventário de código morto — remoção segura

14 funções sem **nenhum** chamador (TS de produção, scripts, corpo de função
SQL, trigger ou cron) e **sem grant a `authenticated` ou `anon`** — o
fechamento da ADR 0047 está funcionando, o que torna a remoção de baixo risco:

| Função | Assinatura | Observação |
|---|---|---|
| `portal_get_current_roe_legacy` | `()` | substituída por núcleo `_portal_get_current_roe_core` + invólucro |
| `portal_get_profile_legacy` | `()` | idem |
| `portal_get_demurrage_invoice_detail_legacy` | `(p_invoice_id bigint)` | idem |
| `portal_invoice_details_legacy` | `(p_invoice_id bigint)` | idem |
| `portal_list_consolidatable_receivables_legacy` | `()` | idem |
| `portal_list_demurrage_invoices_legacy` | `()` | idem |
| `portal_list_notifications_legacy` | `(p_limit integer)` | idem |
| `portal_list_operation_bls_legacy` | `()` | **também quebrada** (2.3) |
| `portal_list_operation_bls_without_transshipment_legacy` | `()` | idem |
| `portal_list_provisioning_console_legacy` | `(p_customer_id bigint)` | idem |
| `portal_list_provisioning_events_legacy` | `(p_customer_id bigint, p_limit integer)` | idem |
| `portal_notification_unread_count_legacy` | `()` | idem |
| `close_legacy_agency_report_alerts_for_scale` | `(p_voyage_id bigint, p_port text)` | resíduo da unificação de alertas do ADR |
| `reconcile_bl_review_alerts_item` | `(p_type text, p_reason text, p_message text, p_bl_id text, p_reasons text[], p_source text)` | grant só a `service_role`, nenhum chamador |

**Não** estão nesta lista, e devem ser preservadas, as sete
`*_legacy_<NNN>` de import (`import_bl_freight_transactional_legacy_205/284/322/357`,
`import_manifest_transactional_legacy_165`,
`import_granite_manifest_transactional_legacy_136`,
`save_granite_bl_review_legacy_148`): elas formam uma cadeia viva de
sobrecarga por assinatura — `import_bl_freight_transactional` chama a `_357`,
que chama a `_322`, que chama a `_284`, que chama a `_205`. Remover qualquer
elo quebra o import.

Também **não** são mortas, apesar de não terem chamador em TS:
`portal_mark_expired_invites` e `portal_refresh_general_pendencies` (invocadas
por `cron.job`) e `rls_auto_enable` (event trigger `ensure_rls`).

**Runtime.**

### 2.5 Tabelas: nenhuma órfã

As 110 tabelas do schema têm todas ao menos um uso (frontend, corpo de função
ou policy). As 24 que não aparecem em TS são acessadas só por RPC — o que é
justamente o contrato da ADR 0004, não código morto. Nada a remover. **Código.**

### 2.6 Colunas mortas — **P3**

Seis colunas aparecem uma única vez no SQL (a própria declaração) e em nenhum
lugar do código:

| Coluna | Situação |
|---|---|
| `alerts.notified_at` | nullable, nunca escrita nem lida — **morta** |
| `bls.consignee_address` | nullable, nunca escrita nem lida — **morta** |
| `charge_calculations.reviewed_at` | nullable, nunca escrita nem lida — **morta** |
| `customer_portal_sessions.last_seen_at` | nullable, nunca escrita nem lida — **morta** |
| `ended_vessels.ended_at` | `DEFAULT now() NOT NULL` — write-only, escrita e jamais lida |
| `portal_email_events.received_at` | `DEFAULT now() NOT NULL` — write-only, escrita e jamais lida |

As quatro primeiras podem cair. As duas últimas são baratas e plausivelmente
úteis em investigação futura; a decisão aqui é registrar, não necessariamente
remover. `bls.consignee_address` merece uma olhada de domínio antes: pode ser
campo de documento que o parser deveria estar preenchendo e não preenche.
**Código.**

### 2.7 `src/types/database.ts` divergiu do schema — **P1**

O arquivo gerado (protegido por `.claude/hooks/protect-files.sh`) está fora de
sincronia com o schema consolidado nos dois sentidos:

- **55 RPCs expostas ausentes do tipo**, das quais **18 são efetivamente
  chamadas pelo app** — entre elas `list_alert_queue_page`,
  `list_internal_notifications`, `summarize_alert_queue_by_department`,
  `upsert_billing_alert`, `resolve_billing_alert`, `dismiss_alert_item`,
  `complete_review_customer_group`, `portal_open_inspection`,
  `refresh_customer_reconciliation_queue_for_bl`, `reopen_demurrage_dispute`.
- **6 RPCs declaradas que não existem** no schema: `can_edit_customers`,
  `can_edit_depots`, `can_edit_voyages`, `is_active_non_equipamentos_user`,
  `is_equipamentos_user`, `portal_list_operation_bls_without_transshipment`.
  As cinco primeiras foram removidas pelas ADRs 0044/0046/0060 (o teste
  `src/integration/rpcFinalDefinition.local-pg.test.ts:137` inclusive afirma que
  `can_edit_voyages` não deve existir após o replay); a sexta é a mesma função
  fantasma do achado 2.3.
- **Assinatura errada:** `settle_cod_adjustment` está declarada como
  `{ p_adjustment_id: number; p_actor?: string }`, mas a função real é
  `(p_adjustment_id bigint, p_actor uuid, p_resulting_document_id bigint,
  p_resulting_document_type text)`.

O custo já é visível: pelo menos três `as unknown as` no código de produção
existem só para contornar isso —
`src/services/billingLedger.ts:212`, `src/services/transshipments.ts:108`,
`src/services/portalScope.ts:40`. Cada um é um ponto onde o TypeScript deixou
de proteger a chamada.

Correção: regenerar `src/types/database.ts` contra o schema v1.0 (operação que
exige autorização explícita pelo hook de proteção) e remover os três adapters.
**Código + Runtime.**

---

## Vetor 3 — Inspeção dos comentários `ponytail:`

37 comentários `ponytail:` vivos (fora de `docs/archive/` e
`supabase/migrations_archive/`): 15 em `src/services`, 5 em `src/hooks`,
5 em `src/components`, 3 em `src/lib`, 3 em `supabase/migrations`,
2 em `src/pages`, mais `src/test`, `supabase/functions`, `scripts` e docs.

**Nenhum teto declarado foi atingido** — a operação tem 0 B/Ls, 0 invoices e
0 faturas de Demurrage. A tabela abaixo prioriza por *distância até o teto*:
quanto volume falta para cada atalho começar a doer.

### 3.1 Prontos para upgrade agora (o gatilho já disparou, independe de volume)

| Local | Situação |
|---|---|
| `src/components/bl/BlOperacionalTab.tsx:70` | **Obsoleto.** O comentário diz que `notify2_block` e `consignee_phone` "are not in generated database.ts yet" — mas os dois estão lá (`src/types/database.ts:942` e `:967`, no `Row` de `bls`). O cast `bl as BLDetail & {…}` pode sair junto com o comentário. |
| `src/pages/EmbarqueVazios.tsx:71` | **Gatilho disparado.** O upgrade é condicionado a "quando `docs/plans/2026-07-31-escala-unificada-pol-pod.md` for entregue" — o plano foi entregue e está em `docs/archive/plans/`. `docs/plans/` hoje só tem `README.md`. O caminho citado no comentário nem existe mais. |
| `src/services/agencyDepartureReport.ts:812` | Mesma duplicação, do outro lado: reimplementa a união `bls.pod`/`bls.pol` normalizada que `fetchVoyageEscalaPorts` faz. A justificativa registrada ("os dois planos são deliberadamente independentes") caducou com a entrega do plano de escala unificada. Os dois devem convergir para a projeção única na mesma mudança. |

### 3.2 Tetos que chegam cedo (volume baixo já basta)

| Local | Teto declarado | Quando dói |
|---|---|---|
| `src/services/customerCommunications.ts:682` e `src/services/customerContactConfiguration.ts:44` | Supressões filtradas por e-mail porque o full-scan estourava `max_rows=1000` | **Já estourou uma vez** — o comentário registra que "a conferência mentia". A mitigação atual é filtro no cliente; o upgrade nomeado (RPC com filtro server-side) continua pendente. Volta a doer quando um único cliente tiver >1000 contatos supressos. É o único ponytail do repositório que documenta um teto **já atingido no passado**. |
| `src/hooks/useBls.ts:99` | Materializa todos os B/Ls e containers no cliente (`O(tabela)`) para preservar filtros derivados | Primeiro a quebrar. Cada B/L traz seus containers; alguns milhares de B/Ls já significam dezenas de milhares de linhas por render da tela de Manifestos. Upgrade nomeado: agregação e filtros server-side. |
| `src/pages/Painel.tsx:52` | Snapshot cobre só as 60 viagens mais recentes | 36 viagens hoje. Passa de 60 dentro de meses de operação e o Painel silenciosamente para de mostrar histórico — sem erro, sem aviso. |
| `src/components/portal/PortalBillingTabs.tsx:36` e `:153` | Paginação client-side das faturas do Portal | Por cliente, não global — dói tarde, mas o mesmo trecho está duplicado em dois lugares, então o upgrade (`p_limit`/`p_offset` nas RPCs) precisa tocar os dois. |

### 3.3 Tetos distantes — registrar e deixar quieto

`src/hooks/useTransshipments.ts:21` (1+N por viagem aberta, hoje 0–1 omissão por
viagem), `src/services/alerts.ts:608` (uma consulta por tabela, página de 100),
`src/services/ladenOnBoardAtd.ts:41` (loop sequencial por consistência de
auditoria), `supabase/migrations/007:71` (uma leitura de cofre por disparo,
quatro por hora no pior caso), `src/lib/zipEntry.ts:7` (sem Zip64; teto de
65535 entradas ou 4 GB), `src/services/portCode.ts:6` (lookup UN/LOCODE à mão),
`src/services/blParser.ts:84` (acoplado ao layout COSCO Page 1).

### 3.4 Dívida estrutural, não de volumetria

| Local | Por que merece atenção separada |
|---|---|
| `src/test/setup.ts:4` | A ponte do squash v1.0 faz 201 testes `*Migration.test.ts` auditarem `supabase/migrations_archive/` em vez do schema aplicado. A própria ADR 0062 aceita o custo explicitamente e nomeia os dois gates que cobrem o artefato ativo (`verificar_guardas.py` e `consolidatedSchemaInvariants.test.ts`). **Esta auditoria é evidência de que os dois gates não são suficientes:** os achados 2.2, 2.3, 2.7 e o 4.1 abaixo passaram por eles. A dívida é real e está subvalorizada. |
| `src/services/voyageRouteSchedules.ts:627` | `entity_type` permanece `voyage_pod_schedule` "por compatibilidade histórica"; o upgrade nomeado é promover a escala a tabela própria "como previsto na ADR 0027". O acoplamento vaza para leitura: `src/services/voyageTimeline.ts:49` filtra por esses literais. Divergência viva entre uma ADR aceita e a persistência. |
| `src/services/billingLedger.ts:212` | Comentário **correto e ainda válido** — mas a causa (tipos desatualizados) é o achado 2.7, que é maior do que este adapter. Resolver 2.7 apaga este ponytail e mais dois. |
| `src/lib/portalCnpjLogin.ts:10` | Não valida dígito verificador porque `customers.cnpj_cpf` carrega documentos de teste que não fecham DV. Teto de **dados**, não de volume: some quando a base for limpa para produção — e a base está vazia, então a janela para fechar isso é agora. |

---

## Vetor 4 — Aderência aos ADRs aceitos

### 4.1 ADR 0047 e ADR 0011 — grant a `PUBLIC` sobrevivente — **P0**

`public.upsert_portal_invoice_exception(p_invoice_id bigint, p_bl_id text)`,
`SECURITY DEFINER`, `RETURNS void`, tem em produção:

```
proacl = {=X/postgres,postgres=X/postgres,service_role=X/postgres}
```

O `=X` inicial é o grant a **`PUBLIC`**. Consequência:
`has_function_privilege('anon', …, 'EXECUTE')` retorna `true`, e como a função
não retorna `trigger`, o PostgREST a expõe — uma requisição não autenticada com
a chave `anon` pode invocá-la.

A ADR 0011 revoga `anon` de `SECURITY DEFINER` e a ADR 0047 estabelece grants
fechados por padrão. Esta função é a **única** exceção callable no schema
inteiro: das 12 funções que `anon` pode executar em produção, 11 retornam
`trigger` (inertes via PostgREST) e esta é a décima segunda.

**Não é drift de produção — é defeito do repositório.** A migration
`002_business_logic_and_security.sql:22638` cria a função e nunca emite o
`REVOKE ALL … FROM PUBLIC` que todas as funções irmãs recebem. A migration
`006` fecha o buraco só para o futuro (`ALTER DEFAULT PRIVILEGES … REVOKE
EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated` só afeta funções criadas
**depois**). Replayar o repositório num banco limpo reproduz o mesmo furo.

Efeito prático: a função grava/resolve o alerta
`portal_excecao_critica_fatura` via `block521_upsert_alert` /
`block521_resolve_alert` para um par `(invoice_id, bl_id)` arbitrário. Pela ADR
0054 o Portal é o gate de faturamento, e esse alerta é o sinal de exceção do
gate — um chamador anônimo pode poluí-lo ou silenciá-lo.

Correção: migration `009` com
`REVOKE ALL ON FUNCTION public.upsert_portal_invoice_exception(bigint, text)
FROM PUBLIC, anon, authenticated;` (a função só é usada por triggers, que rodam
como `postgres`/definer — nenhum grant externo é necessário). Estender o mesmo
REVOKE às 10 funções de trigger com `=X` por higiene. E, mais importante:
`scripts/security/verificar_guardas.py` e
`src/services/__tests__/consolidatedSchemaInvariants.test.ts` — os dois gates
que a ADR 0062 nomeia como cobertura do artefato ativo — **não pegaram isto**.
Vale acrescentar a invariante "nenhuma função não-trigger em `public` mantém
grant a `PUBLIC`" a um deles. **Runtime.**

### 4.2 ADR 0045 — paridade cliente/inspeção quebrada — **P1**

A ADR 0045 estabelece que cada leitura escopada por Cliente tem um núcleo
privado e dois invólucros (`portal_*` e `portal_inspect_*`) que delegam ao mesmo
núcleo, e que "nenhuma RPC `portal_inspect_*` é criada para escritas".

`portal_list_disputes()` é uma **leitura** e não segue o padrão:

- não tem núcleo `_portal_list_disputes_core`;
- não tem invólucro `portal_inspect_list_disputes` — confirmado ausente em
  produção (`pg_proc` retorna 0) e em todo o repositório;
- resolve o cliente direto por `current_portal_customer_id()`
  (`002_business_logic_and_security.sql:12522`).

Mas `src/services/portalBilling.ts:214` a chama por `callPortalRpc(scope, …)`,
e `portal_list_disputes` **não** está em `portalWriteRpcNames`
(`src/services/portalScope.ts:18`) — logo não é barrada como escrita. Em modo
inspeção o dispatcher monta `portal_inspect_list_disputes` e a chamada falha
com `PGRST202`.

O caminho é alcançável: `src/hooks/usePortalDisputes.ts:12` traz
`enabled: isAuthenticated || scope.mode === 'inspect'` — habilitação explícita
para inspeção — e `PortalBilling` está montada em
`/clientes/portal/inspecao/:customerId/billing` (`src/App.tsx:163`).
Resultado: a aba de faturamento da Inspeção do Portal erra ao carregar
disputas. Não apareceu ainda porque `demurrage_disputes` tem 0 linhas e a
Inspeção provavelmente nunca foi exercitada contra um cliente com disputa.

Correção: extrair `_portal_list_disputes_core(p_customer_id bigint)` e criar os
dois invólucros, como as outras 11 leituras. Um teste de contrato que compare
`portalWriteRpcNames` ∪ {leituras com variante} contra os nomes efetivamente
passados a `callPortalRpc` fecharia a classe inteira desse bug. **Runtime.**

### 4.3 ADR 0046 — trilha de auditoria fora da transação — **P2**

A ADR 0046 libera a escrita interna a todo departamento e move o controle para
"o rastro obrigatório: toda escrita registra autor e Departamento congelado no
instante do evento", tornando a auditoria "caminho crítico da escrita".

`src/services/baplieReconciliation.ts:343-368` (`applyBapliePhysicalFlags`) é a
**única** escrita de `audit_logs` feita pelo cliente em todo o frontend — as
outras 56 acontecem dentro de funções SQL, na mesma transação da mudança. Ali:

1. `UPDATE bl_containers` e `INSERT audit_logs` são duas chamadas HTTP
   separadas, sem transação — falha na segunda deixa a mudança sem rastro;
2. o resultado do insert **não é verificado** (`await supabase.from('audit_logs').insert({…})`
   sem checar `error`), enquanto o update logo acima faz `if (error) throw error`;
3. `actor_role` e `actor_department` não são gravados, embora a ADR exija
   "autor e Departamento congelado";
4. `changed_by` vem de um `actorId` fornecido pelo cliente — forjável, ao
   contrário do `auth.uid()` que as RPCs usam.

Correção: mover a operação para uma RPC transacional, no mesmo molde das
outras escritas auditadas. **Código.**

### 4.4 ADR 0003 — acesso a Supabase fora de `services/` — **P3**

A ADR 0003 define que `services/` "concentra acesso a Supabase, RPCs, parsers,
regras de domínio testáveis". Onze páginas e componentes importam
`services/supabase` — dez legitimamente, só para `supabase.auth` (login,
recuperação de senha, ativação do Portal). A exceção real é uma:

`src/pages/Baplie.tsx:64` executa
`supabase.from('baplie_containers').select('voyage_id')` direto na página.
Uma linha, sem serviço intermediário. **Código.**

### 4.5 ADRs verificados sem divergência

- **ADR 0004** (RLS/RPC como fronteira): as 24 tabelas sem acesso em TS são
  alcançadas só por RPC — é o contrato funcionando, não código morto.
- **ADR 0013** (exceção `anon`): `portal_ship_schedule` é a única RPC de negócio
  com grant a `anon`, exatamente como decidido.
- **ADR 0016** (nomenclatura numerada sequencial): `001`–`008` sem lacuna.
- **ADR 0047** (grants fechados): 14 das 14 funções mortas estão sem grant
  externo. Só o caso 4.1 escapa.
- **ADR 0062** (squash v1.0): as 110 tabelas do repositório batem com as 110 de
  produção.

---

## Plano de remediação sugerido

| Ordem | Ação | Achado |
|---|---|---|
| 1 | Migration `009`: `REVOKE … FROM PUBLIC` em `upsert_portal_invoice_exception` (+ as 10 de trigger) e invariante nova em `consolidatedSchemaInvariants.test.ts` | 4.1 |
| 2 | Migration `009`: agendar `recalc-demurrage-ptax` por `ops.dispatch_edge_job`, cadastrar `RECALC_CRON_SECRET`, nota editorial na ADR 0063, corrigir o cabeçalho da Function | 2.2 |
| 3 | Núcleo + invólucros para `portal_list_disputes`; teste de contrato cobrindo todos os nomes passados a `callPortalRpc` | 4.2 |
| 4 | Regenerar `src/types/database.ts` (requer autorização do hook) e remover os três `as unknown as` | 2.7 |
| 5 | Migration: `DROP` das 14 funções mortas | 2.3, 2.4 |
| 6 | RPC transacional para `applyBapliePhysicalFlags` | 4.3 |
| 7 | Atualizar `RASTREABILIDADE.md`: contagens, linhas 189 e 400, RPCs/hooks/tabelas ausentes | 1.1–1.3 |
| 8 | Convergir `EmbarqueVazios`/`agencyDepartureReport` na projeção unificada; remover o ponytail obsoleto de `BlOperacionalTab` | 3.1 |
| 9 | `DROP` das 4 colunas mortas; mover a consulta de `Baplie.tsx:64` para um serviço | 2.6, 4.4 |

## Correções aplicadas nesta mudança

O contrato de documentação do `CLAUDE.md` manda corrigir o documento vivo
quando ele diverge do repositório executável. Foram aplicadas apenas as
correções **factuais e verificáveis** do vetor 1; nenhum código foi alterado.

| Arquivo | Correção |
|---|---|
| `docs/RASTREABILIDADE.md` | Cabeçalho: contagens atualizadas (130 RPCs literais, 62 tabelas, 15 Edge Functions), com a ressalva de que 83 das 198 RPCs expostas ainda não têm linha e de que os nomes `portal_inspect_*` são montados em runtime; data de verificação para 2026-09-06 |
| `docs/RASTREABILIDADE.md` | Linha `/line-up-tv`: descrita como catch-all de `src/App.tsx`, sem componente próprio |
| `docs/RASTREABILIDADE.md` | Linha `cod_adjustments`: `src/services/codAdjustments.ts` → `src/hooks/useBillingLedger.ts` + `src/services/billingLedger.ts` |
| `docs/ARCHITECTURE.md` | Linha `/line-up-tv` da tabela de rotas |
| `docs/modules/operacao-suporte.md` | Anatomia, catálogo de ações e prosa de `/line-up-tv` |
| `docs/modules/faturamento.md` | Removida a linha do teste inexistente `PendenciasTable.test.tsx` |
| `docs/modules/viagens.md` | `VoyageImportActions.test.ts` → `VoyageImportActions.behavior.test.tsx` |

**Deliberadamente não corrigido aqui:** as 83 RPCs, 15 hooks e 7 tabelas fora
do índice (volume que merece mudança própria), e tudo dos vetores 2, 3 e 4 —
são mudanças de código e de schema, não de documentação.

## Limites desta auditoria

- A análise de chamadas é estática e por nome; nomes montados em runtime
  (`portal_inspect_*`, `callReportIdAwareRpc`) foram tratados à mão. Um nome
  montado que eu tenha deixado passar apareceria falsamente como código morto —
  por isso cada item do inventário de remoção foi confirmado também contra o
  catálogo de produção.
- A verificação Runtime cobre catálogo, ACLs, agendamentos e contagens. **Não**
  houve execução de RPC, teste de RLS sob sessão real, nem validação de
  comportamento de PostgREST — a exposição descrita em 4.1 foi derivada de
  `proacl` e do tipo de retorno, não de uma requisição HTTP.
- Volumetria zerada impede afirmar que qualquer teto de `ponytail:` está
  próximo. As prioridades do vetor 3 são projeções, não medições.


---

## PR #660 — segurança, multi-tenancy e isolamento do Portal

Arquivo original incorporado integralmente abaixo. O snapshot, a evidência, os identificadores dos achados e as recomendações são preservados.

# Auditoria de segurança, multi-tenancy e isolamento do Portal — 2026-09-05

Documento histórico. Descreve o estado do repositório em 2026-09-05, no commit
de partida da branch `claude/security-audit-multi-tenant-hlchz1`. Correções
aplicadas na mesma mudança estão marcadas **[corrigido]**; as que exigem
migration ficaram **pendentes**, com o SQL no apêndice; o que foi deliberadamente
deixado como está aparece em "Aceito / não corrigido" com a justificativa.

Escopo: isolamento entre Clientes no Portal, RBAC interno, Edge Functions e
webhooks, funções `SECURITY DEFINER`, e vazamento de segredos.

Método: leitura estática do schema (`supabase/migrations/001`–`008`, 43.297
linhas), das 15 Edge Functions e do frontend, com extração programática de
funções, grants e policies. **Não houve execução contra banco real**: não há
projeto Supabase alcançável nesta sessão. Toda afirmação abaixo é **Código** ou
**Teste de contrato SQL**, nunca **Runtime**. As provas de conceito são
conceituais, como pedido — nenhuma foi executada.

## Sumário

O isolamento multi-tenant do Portal está **sólido**. A auditoria não encontrou
nenhum IDOR, nenhuma policy RLS permissiva e nenhum caminho pelo qual uma sessão
de Cliente alcance dado de outro Cliente. As três auditorias anteriores
(`security-audit-2026-06-25`, `security-audit-portal-2026-08-05`,
`security-audit-portal-2026-08-12`) deixaram marca visível: oráculos de
enumeração fechados, segredos fora de `cron.job.command`, grants de função
negados por padrão.

Foram encontrados **dois defeitos reais** (severidade média) e **três apontamentos
de robustez** (baixa). Nenhum é crítico e nenhum é explorável para leitura
cruzada entre Clientes.

| # | Severidade | OWASP | Achado | Estado |
|---|---|---|---|---|
| 1 | Média | A07 Identificação e autenticação | Credencial revogada do Portal ainda hidrata sessão até o token expirar | **Pendente** — SQL pronto no apêndice |
| 2 | Média | A05 Configuração incorreta | Provisionamento do admin de Preview sem guarda de ambiente | **[corrigido]** |
| 3 | Baixa | A01 Quebra de controle de acesso | Autorização no fundo da cadeia de delegação, não na fronteira do `GRANT` | **Pendente** — receita no apêndice |
| 4 | Baixa | A05 Configuração incorreta | Ausência de `Strict-Transport-Security` | **[corrigido]** |
| 5 | Baixa | A04 Design inseguro | Bloqueio de login por CNPJ permite negação de serviço contra o dono | Aceito (ADR 0049) — ver crítica |

> **Por que 1 e 3 estão pendentes.** Ambos exigem uma migration nova, e
> `supabase/migrations/` é diretório protegido por
> `.claude/hooks/protect-files.sh`. A correção foi escrita e revisada, mas o
> dono do repositório optou por não incluí-la nesta mudança; ela está no
> [apêndice](#apêndice--correções-sql-propostas-não-aplicadas) para ser aplicada
> como migration `009` numa mudança própria.

---

## Achado 1 — Credencial revogada continua hidratando a sessão do Portal

**Severidade:** Média · **OWASP:** A07:2021 · **Evidência:** Código

`customer_portal_accounts.credentials_revoked_at` existe desde a migration 001,
e o `COMMENT` da própria coluna declara o contrato:

> `Instante da última revogação de credencial do Portal. Token com iat anterior é
> recusado por current_portal_customer_id().`

`current_portal_customer_id()` cumpre o contrato
(`002_business_logic_and_security.sql:5289`). **`portal_get_session_overview_v2()`
não** — checava apenas `active`. E é essa a RPC que o navegador chama para
decidir se existe sessão (`src/hooks/usePortalAuth.tsx:42`).

`portal_revoke_sessions(p_user_id)` (`002:13643`) apaga sessões e refresh tokens
e carimba `credentials_revoked_at = now()`. Ele apaga o *refresh* token; o
*access* token já emitido continua válido até `jwt_expiry` (3600 s, ver
`supabase/config.toml`). É chamado por `portal-password-reset`,
`portal-account-suspend` e `portal-recovery-email-change`.

### Prova de conceito (conceitual)

1. Atacante detém um access token do Portal do Cliente A (roubado de um
   dispositivo compartilhado, de um log, ou simplesmente um funcionário
   desligado cuja senha acabou de ser trocada).
2. O Cliente A troca a senha. `portal-password-reset` revoga as sessões.
3. Por até 1 hora, `POST /rest/v1/rpc/portal_get_session_overview_v2` com o token
   antigo ainda responde **200**, devolvendo razão social, CNPJ,
   `pending_balance`, `contact_email` e `login_cnpj`.
4. O Portal renderiza como autenticado. Cada chamada de dado subsequente
   (faturas, operação, Demurrage) falha, porque todas passam por
   `current_portal_customer_id()`.
5. Efeito colateral: o `UPDATE ... SET last_login_at = now()` roda mesmo assim,
   registrando como login um acesso posterior à revogação — corrompendo o sinal
   que o console de provisionamento usa.

**Impacto real:** não há leitura cruzada entre Clientes; o token só alcança o
próprio Cliente. O que se perde é a *revogação*: um dado cadastral e financeiro
resumido continua legível por até uma hora depois de a empresa acreditar ter
cortado o acesso, e a trilha de auditoria registra um login que não deveria
existir.

### Correção proposta (não aplicada)

A mesma checagem de `current_portal_customer_id()`, com a mesma folga de 5 s
para desalinhamento de relógio, aplicada **antes** do `UPDATE last_login_at`.
SQL completo no [apêndice](#1--portal_get_session_overview_v2).

---

## Achado 2 — Provisionamento do admin de Preview sem guarda de ambiente

**Severidade:** Média · **OWASP:** A05:2021 · **Evidência:** Código

`scripts/provision-preview-admin.mjs` cria (ou repara) o usuário
`qa-admin@example.test` com `email_confirm: true` e faz upsert de
`user_profiles` com `role = 'admin'`, `active = true`. A senha vem do secret
`PREVIEW_ADMIN_PASSWORD` e é **fixa entre execuções** — é um fixture de QA.

Nada no script exigia que o alvo fosse uma Preview Branch. Ele usava
`SUPABASE_URL` como viesse do ambiente. Essa URL é produzida pelo step anterior
do workflow:

```
supabase --experimental branches get "$PR_HEAD_REF" \
  --project-ref "$SUPABASE_PROJECT_REF" -o env | node scripts/load-branch-env.mjs
```

`load-branch-env.mjs` despeja o resultado em `$GITHUB_ENV` sem inspecionar para
onde a URL aponta. O branching do Supabase expõe o projeto de produção como
branch persistente; um `PR_HEAD_REF` que resolva para ela — ou um
`SUPABASE_PROJECT_REF` mal configurado — provisiona uma conta administrativa de
credencial conhecida **em produção**, silenciosamente e a cada PR.

O `role = 'admin'` é o de maior alcance do sistema: `is_admin()` (`002:9701`) o
aceita, e a policy `user_profiles_update` permite a um admin alterar `role` de
qualquer perfil.

### Prova de conceito (conceitual)

Não requer atacante externo — é uma falha de configuração que se materializa
sozinha. Um `SUPABASE_PROJECT_REF` apontado para o projeto errado, ou uma branch
Supabase ausente que faça o CLI devolver as credenciais do projeto pai, basta.
A partir daí, qualquer pessoa com acesso ao secret (ou que o descubra) entra em
produção como administrador.

**Nota:** o fixture `PreviewAdmin2026!` que aparece em
`src/services/__tests__/previewAdminProvisioning.test.ts:7` é um valor de teste
com mocks, **não** a senha real — ela vive só como secret do GitHub Actions.
Ainda assim, se o secret real coincidir com esse literal, ele está publicado no
repositório. Vale conferir e rotacionar por precaução.

### Correção

`assertPreviewTarget(url, productionProjectRef)` recusa quando o host da URL
resolvida cita o ref de produção, e falha fechado se o ref não for informado. O
workflow passa o ref sob nome próprio (`PRODUCTION_SUPABASE_PROJECT_REF`) porque
uma chave `SUPABASE_PROJECT_REF` vinda do CLI sobrescreveria em `$GITHUB_ENV`
justamente a referência contra a qual se compara. A comparação é por rótulo de
host, não por `includes`, para não recusar um ref de branch que apenas contenha
o de produção como substring. Cinco testes cobrem os dois lados.

---

## Achado 3 — Autorização no fundo da cadeia, não na fronteira do `GRANT`

**Severidade:** Baixa (não explorável hoje) · **OWASP:** A01:2021 · **Evidência:** Código

Duas RPCs `SECURITY DEFINER` concedidas a `authenticated` — papel que a sessão
do Portal **também** carrega, já que Portal e app interno vivem no mesmo projeto
Supabase (`src/services/supabase.ts:27`) — faziam trabalho antes de delegar ao
núcleo guardado:

- `save_voyage_escala_terminal_state_v2` (`002:20014`) chega a
  `INSERT INTO public.ports` **antes** de qualquer checagem, e só então chama
  `save_voyage_escala_terminal_state`, que exige Operações/Admin;
- `import_bl_freight_transactional` (`002:7811`) faz um `SELECT` e um
  `set_config` antes de delegar a `..._legacy_357` → `..._legacy_322` →
  `..._legacy_205`, e é este último que valida
  `is_active_user()` e `p_changed_by = auth.uid()`.

**Isto não é explorável hoje.** Uma chamada RPC via PostgREST roda numa
transação; o `RAISE` do núcleo aborta tudo e a linha em `public.ports` é
desfeita pelo rollback. A auditoria verificou esse caminho antes de classificar.

O problema é estrutural: a segurança depende do rollback, não da autorização.
Um único `EXCEPTION WHEN OTHERS` adicionado em manutenção futura, uma
subtransação, ou uma reordenação da delegação converte isso em escrita
persistente alcançável por qualquer sessão autenticada — inclusive a de um
Cliente do Portal. Todo o resto do schema segue o princípio oposto: a checagem
mora na função concedida.

### Correção proposta (não aplicada)

A guarda passa a valer no ponto de entrada concedido. As guardas propostas são
idênticas às que os núcleos já aplicam, apenas antecipadas — nenhum chamador
legítimo muda de comportamento. Receita no
[apêndice](#2--guardas-no-ponto-de-entrada).

---

## Achado 4 — Ausência de `Strict-Transport-Security`

**Severidade:** Baixa · **OWASP:** A05:2021 · **Evidência:** Código

`vercel.json` já traz CSP restritiva, `X-Frame-Options: DENY`,
`X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy`, mas nenhum
HSTS. Sem ele, o primeiro acesso em rede hostil pode ser rebaixado para HTTP.

**Corrigido** com `max-age=31536000; includeSubDomains`. `preload`
deliberadamente **não** foi incluído: é um compromisso praticamente irreversível
sobre o apex e todos os subdomínios, e essa é uma decisão do dono do domínio,
não de uma auditoria.

---

## Aceito / não corrigido

### Achado 5 — Bloqueio de login por CNPJ é uma negação de serviço contra o dono

**Severidade:** Baixa · **OWASP:** A04:2021 · **Evidência:** Código

A ADR [0049](../../adr/0049-rate-limit-do-portal-chaveado-somente-por-cnpj.md)
documenta e **aceita** explicitamente: o CNPJ é público, cinco senhas erradas
trancam o dono por 15 minutos, e repetir a cada janela o mantém fora
indefinidamente. A ADR rejeita a chave por IP porque um escritório contábil
opera vários CNPJs do mesmo endereço, e contar por IP faria um cliente bloquear
outro.

**Crítica honesta ao raciocínio da ADR:** o argumento está correto contra IP
como chave *substituta*, mas a ADR trata a alternativa como binária e não
considera IP como dimensão *aditiva*. Bloquear apenas quando o balde do CNPJ
**e** o balde do IP estiverem quentes preserva integralmente o caso do escritório
compartilhado (aquele IP é legítimo e não estoura sozinho contra dezenas de
CNPJs distintos) e remove o bloqueio gratuito de um terceiro isolado. Um
desafio (captcha/turnstile) após N falhas tem o mesmo efeito sem trancar
ninguém, e `[auth.captcha]` já está previsto na configuração do Supabase.

Não foi corrigido nesta mudança: reverter uma decisão registrada em ADR exige
uma ADR nova e é chamada do dono do produto, não da auditoria. Recomendo
reabrir a 0049 com a dimensão aditiva sobre a mesa.

### TOCTOU teórico em `_apply_customer_contact_configuration`

**Severidade:** Informativa · **Evidência:** Código

O laço de validação (`008:596`) confirma que todo contato do payload pertence a
`p_customer_id`; a fase de aplicação (`008:764`) faz
`UPDATE public.customer_contacts ... WHERE id = v_item_id` sem reescopar por
`customer_id`. O `FOR UPDATE` pessimista trava a linha do **cliente**, não a dos
contatos.

**Não corrigido, deliberadamente.** Uma varredura do repositório confirma que
`customer_contacts.customer_id` **nunca é reatribuído** por nenhum caminho —
não há `UPDATE ... SET customer_id`. A janela é, portanto, inalcançável, e
reemitir uma função de ~300 linhas para fechá-la traz mais risco de transcrição
do que benefício. Se algum dia surgir um caminho de reatribuição de contato
entre Clientes, acrescentar `AND customer_id = p_customer_id` ao `UPDATE` e
escopar o `DELETE` de `customer_contact_box_links` passa a ser obrigatório.

### `portal_ship_schedule` concedida a `anon`

**Severidade:** Informativa · **Evidência:** Código

É a única função com `GRANT ... TO anon` (`002:29273`), e a ADR 0045 a nomeia
como exceção deliberada ("permanece leitura direta porque não é escopada por
Cliente"). Devolve navio, viagem, IMO, portos e datas de viagens com
`show_on_portal AND status = 'active'` — nenhum dado de Cliente. Quem tiver a
chave anon (que é pública por natureza) lê a programação. É uma escolha de
negócio consciente; registro apenas para que continue consciente.

---

## Superfície verificada e considerada correta

Vale registrar o que **não** é vulnerabilidade, para que a próxima auditoria não
refaça o caminho.

### Isolamento de tenants e RLS (vetor 1)

- **Nenhum IDOR.** O `customer_id` **nunca** chega do cliente. Toda RPC do Portal
  resolve a identidade por `current_portal_customer_id()`, que lê
  `customer_portal_accounts` por `auth.uid()`. O frontend só chama RPCs — a
  única escrita direta é upload ao Storage, e o bucket tem policy de prefixo por
  `customer_id`.
- As três RPCs que aceitam id de entidade (`portal_invoice_details`,
  `portal_get_demurrage_invoice_detail`, `portal_obsolete_consolidation`)
  filtram por `customer_id = <derivado da sessão>` na consulta que prova a posse,
  e erram com `P0002` quando não encontram.
- Os 11 núcleos `_portal_*_core` são parametrizados por `p_customer_id` e todos
  filtram por ele; os que aceitam id secundário só o usam depois de a posse
  estar provada.
- Os invólucros `portal_inspect_*` (Modo Inspeção interno) passam **todos** por
  `_portal_inspect_guard`, que exige usuário interno ativo.
- **110 de 110 tabelas** com RLS habilitado; **273 policies**, nenhuma com
  `USING (true)` ou `WITH CHECK (true)`, nenhuma concedida a `anon`.
- **Zero views** no schema — não existe a superfície clássica de view sem
  `security_invoker` furando RLS.
- Só três policies são alcançáveis por sessão de Portal
  (`demurrage_disputes`, `demurrage_dispute_messages`,
  `demurrage_dispute_attachments`), todas com predicado
  `customer_id = current_portal_customer_id()`.

### Edge Functions e webhooks (vetor 2)

- **`portal-email-webhook`:** assinatura Svix verificada com tolerância de 300 s,
  antes de qualquer efeito. Falha **fechado** — a construção do `Webhook` está
  dentro do `try`, então secret ausente devolve 401 em vez de aceitar. Deduplica
  por `svix-id` com índice único. Injeção forjada de bounce/complaint não passa.
- **`send-customer-communication`:** exige Bearer, checa papel
  (`administrativo`/`documentacao`/`equipamentos`) ou o secret de automação em
  comparação de tempo constante; valida que o destinatário **pertence ao Cliente**
  (`customer_contacts` por `customer_id`) antes de enviar, e consulta as duas
  listas de supressão.
- **`demurrage-dunning`, `alerts-detector`, `portal-daily-digest`,
  `customer-communication-auto-runner`, `recalc-demurrage-ptax`:** todas exigem
  segredo de cron em `timingSafeEqual`, e todas falham fechado se o segredo não
  estiver configurado.
- **`admin-users`:** `verify_jwt` padrão (true) mais `is_admin()`.
  `portal-invite-send` e `portal-account-suspend` checam
  `portal_current_role()`, que devolve `NULL` para sessão de Portal — e as
  comparações são NULL-safe.
- CORS por allowlist explícita, com ausência de header (não a string `null`) para
  origem não permitida.

### Funções `SECURITY DEFINER` (vetor 3)

- 417 funções mapeadas, **355 `SECURITY DEFINER`**, das quais 173 concedidas a
  `authenticated`/`anon`.
- **Todas as 355 fixam `SET search_path`.** Zero exceções — nenhuma superfície de
  sequestro de `search_path`.
- `EXECUTE` negado por padrão (`ALTER DEFAULT PRIVILEGES ... REVOKE` em 001 e
  006), com 407 `REVOKE ... FROM PUBLIC` explícitos.
- Análise transitiva da cadeia de chamadas: apenas `portal_ship_schedule` chega
  ao fim sem guarda, e é a exceção documentada. Os achados 3 acima são de
  *posição* da guarda, não de ausência.
- **Todas as 23 funções `*_legacy*` estão sem grant** para `authenticated`/`anon`
  — não há função-sombra antiga reexposta com regra mais frouxa. Verificado
  individualmente, incluindo `portal_list_provisioning_events_legacy`, cuja
  versão viva exclui corretamente o papel `operacoes`.
- Escalada de privilégio interna barrada em dois níveis: a policy
  `user_profiles_update` permite auto-edição, e o trigger
  `prevent_user_profile_privilege_escalation` recusa mudança de `role`/`active`
  por quem não é admin.

### Segredos (vetor 4)

- Nenhuma chave `service_role`, JWT, chave Resend ou credencial no frontend, no
  bundle ou no repositório. Varredura por padrões (`eyJ*.*`, `sb_secret_`,
  `sbp_`, `re_`, `SG.`) sem achado.
- `.env` fora do versionamento; só `.env.example` com placeholders.
- Segredos dos jobs `pg_cron` migrados para o Supabase Vault (ADR 0063,
  migration 007), com o comando do job citando apenas **nomes**, schema `ops`
  sem `USAGE` para `anon`/`authenticated`, e verificação executável que aborta
  se algum job voltar a exibir literal.
- `qa-admin@example.test` fica confinado à Preview: a senha só existe como secret
  do Actions, o workflow usa `workflow_run` com checkout da branch padrão (não
  executa código da PR com secrets), e PRs de fork são ignoradas. A lacuna era a
  ausência de guarda de destino — achado 2.

## Apêndice — correções SQL propostas (não aplicadas)

Devem entrar como `supabase/migrations/009_portal_revocation_and_entrypoint_guards.sql`,
seguindo o red-green do playbook de migrations: teste de contrato primeiro,
depois aplicação real.

**Aplicar não é salto no escuro.** O job `Migration replay (Postgres real)` do
`ci.yml` reexecuta *todas* as migrations do zero contra um PostgreSQL 16 real
(`scripts/setup-local-pg.sh --reset`), roda `scripts/check-squash-replay.sql` e
depois aplica `supabase/seed.sql`. Uma 009 sintaticamente inválida, com corpo de
função quebrado ou com o `DO $verify_009$` reprovando, derruba o gate da PR
imediatamente — sem depender de Preview Branch. A Preview continua sendo onde se
prova o *comportamento* (recusa por `iat`, guarda por papel) com sessão real;
o CI prova que o schema aplica.

### 1 — `portal_get_session_overview_v2`

Corpo idêntico ao da 002, com o bloco de revogação inserido **antes** do
`UPDATE ... last_login_at` (um token recusado não pode deixar rastro de login),
e `credentials_revoked_at` acrescentado ao `SELECT ... INTO v_account`:

```sql
-- declarar junto de v_account/v_customer:
--   v_issued_at TIMESTAMPTZ;
-- e acrescentar a coluna ao SELECT que carrega v_account:
--   SELECT a.id, a.customer_id, a.active, a.contact_email, a.login_cnpj,
--          a.credentials_revoked_at INTO v_account ...

IF v_account.credentials_revoked_at IS NOT NULL THEN
  v_issued_at := to_timestamp(NULLIF(auth.jwt() ->> 'iat', '')::double precision);
  IF v_issued_at IS NOT NULL
     AND v_issued_at < v_account.credentials_revoked_at - interval '5 seconds' THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;
END IF;
```

A folga de 5 s e a forma do teste são copiadas de `current_portal_customer_id()`
(`002:5289`) de propósito: duas implementações divergentes da mesma regra são o
que produziu este achado.

### 2 — Guardas no ponto de entrada

Reemitir as duas funções com `CREATE OR REPLACE`, corpo **byte a byte** igual ao
da 002 (extrair do arquivo, não transcrever à mão), inserindo a guarda logo após
o `BEGIN` de topo:

```sql
-- save_voyage_escala_terminal_state_v2: antes do INSERT INTO public.ports.
-- O núcleo save_voyage_escala_terminal_state segue dono da regra de papel
-- (Operações/Admin); aqui recusa-se quem não é usuário interno ativo --
-- inclusive a sessão do Portal, que também carrega o papel `authenticated`.
IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
  RAISE EXCEPTION 'Usuario sem permissao ativa para editar Atracacoes da escala.'
    USING ERRCODE = '42501';
END IF;

-- import_bl_freight_transactional: idêntica à guarda que
-- import_bl_freight_transactional_legacy_205 já aplica, apenas antecipada.
IF auth.uid() IS NULL OR NOT public.is_active_user()
   OR p_changed_by IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Usuario sem permissao ativa para importar B/L.'
    USING ERRCODE = '42501';
END IF;
```

Reafirmar o ACL na mesma migration (a 006 exige grant explícito), sem ampliar
nada além do que a 002 já concedia:

```sql
REVOKE ALL ON FUNCTION public.portal_get_session_overview_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_get_session_overview_v2() TO authenticated;
-- idem para as duas funções acima, com as assinaturas completas.
```

### 3 — Verificação executável sugerida

Não há como assumir a identidade de outro papel de dentro da migration; o que dá
para afirmar no catálogo é que as três funções seguem `SECURITY DEFINER`, com
`search_path` fixado, e sem `EXECUTE` para `anon`:

```sql
DO $verify_009$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('portal_get_session_overview_v2',
                      'save_voyage_escala_terminal_state_v2',
                      'import_bl_freight_transactional')
    AND (NOT p.prosecdef
         OR p.proconfig IS NULL
         OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
         OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '009: funcao fora do contrato: %', v_bad;
  END IF;
END;
$verify_009$;
```

## Testes e validação

- `src/services/__tests__/previewAdminProvisioning.test.ts` — 7 testes,
  **passando** (5 novos, cobrindo o guard de ambiente nos dois sentidos:
  recusa produção, aceita branch, não confunde substring, falha fechado sem ref,
  rejeita URL malformada).
- `npm run docs:check`, `npm run lint`, `npm test` e `npm run build` —
  ver a seção de verificação da PR.
- **Não executado:** qualquer validação contra banco real. Não há projeto
  Supabase alcançável nesta sessão, então **não há evidência Runtime** para
  nenhuma afirmação deste relatório. Todo o achado é leitura estática.
- O apêndice SQL **não foi aplicado nem testado**. Antes de virar migration
  precisa de teste de contrato próprio; a aplicação em si é coberta pelo job
  `Migration replay (Postgres real)` do CI, e o comportamento (recusa por `iat`,
  guarda por papel) por uma Preview Branch.

## Notas e divergências

- A auditoria foi estática por necessidade, não por escolha. Um teste de
  penetração de verdade contra uma Preview — duas contas de Portal reais
  tentando alcançar dado uma da outra — provaria o isolamento de um jeito que
  leitura de código não prova. Recomendo isso como próximo passo.
- O achado 3 é o tipo de coisa que uma auditoria futura pode reclassificar como
  falso positivo se olhar só para o efeito atual. Ele está registrado como
  **não explorável hoje** de propósito: o valor da correção é impedir que uma
  manutenção futura o torne explorável sem que ninguém perceba.

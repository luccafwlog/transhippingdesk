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

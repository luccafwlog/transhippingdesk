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

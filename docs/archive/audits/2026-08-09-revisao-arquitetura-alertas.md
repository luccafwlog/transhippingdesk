# Revisão da arquitetura de alertas — geradores, cobertura e modelo departamental (9 ago 2026)

> Registro histórico. Auditoria somente leitura conduzida sobre o commit
> `deadcbc5`. Nenhuma linha de código, migration ou documentação viva foi
> alterada.
>
> A pergunta que originou a revisão: **o que hoje gera alerta, o que só aparece
> na tela, e como separar alerta global de alerta departamental.** A resposta
> curta é que o eixo difícil já foi decidido pela [ADR 0034](../../adr/0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md)
> e não foi implementado — e que, enquanto isso, o alerta financeiro mais
> crítico do sistema praticamente não é criado.
>
> Escopo auditado: `public.alerts` e todos os seus produtores e consumidores
> (SQL, RPCs, triggers, Edge Functions, frontend), a rota `/alertas`, os
> indicadores derivados de tela, e `portal_notifications` como fronteira de
> comparação. Não auditado: conteúdo do banco de produção (nenhum acesso
> runtime), funcionamento interno de `portal_notifications`, telas de importação
> além do mapeamento de pendências.
>
> Labels de evidência conforme [`CONVENCOES.md`](../../CONVENCOES.md#labels-de-evidência).

---

## Resumo executivo

Quinze achados. Dois deles mudam a leitura do sistema:

1. **O alerta `invoice_overdue` quase nunca é criado.** Dois mecanismos
   competem pela transição `issued → overdue`, e o que vence não cria alerta.
2. **O modelo de alertas departamentais já foi decidido e está parado.** A ADR
   0034 (aceita em 24 jul 2026) define audiência por regra declarada em ponto
   único de fan-out. Não existe uma linha de implementação, mas o `CONTEXT.md`
   já descreve o vocabulário completo do sistema que não existe.

O restante são consequências previsíveis de um modelo central com dez colunas
que atende quatorze tipos de alerta produzidos por seis mecanismos diferentes.

| # | Achado | Categoria | Impacto | Esforço | Risco | Confiança | Evidência |
|---|---|---|---|---|---|---|---|
| A-01 | Alerta de fatura vencida engolido pelo cron | Correção | **Alto** | S | BAIXO | ALTA | **Código** + **Suspeita** (runtime) |
| A-02 | ADR 0034 aceita e não implementada | Arquitetura | **Alto** | L | MÉDIO | ALTA | **Código** |
| A-03 | 4 tipos vivos sem rótulo, 3 rótulos mortos | Correção | Médio | S | BAIXO | ALTA | **Código** |
| A-04 | Deep link de `portal_dispute_opened` aponta para página e ID errados | Correção | Médio | S | BAIXO | ALTA | **Código** |
| A-05 | `invoice_overdue` e `portal_dispute_opened` nunca fecham sozinhos | Correção | Médio | M | BAIXO | ALTA | **Código** |
| A-06 | Duas convenções incompatíveis de `entity_id` para `entity_type='invoice'` | Débito | Médio | M | MÉDIO | ALTA | **Código** |
| A-07 | Qualquer usuário ativo insere/fecha qualquer alerta, sem rastro de autoria | Segurança | Médio-alto | M | MÉDIO | ALTA | **Código** |
| A-08 | `/alertas` escreve no banco a cada montagem, sem throttle | Performance | Médio | S | BAIXO | ALTA | **Código** |
| A-09 | `entity_type='customer'` sem rótulo; `container` com rótulo e sem produtor | Correção | Baixo-médio | S | BAIXO | ALTA | **Código** |
| A-10 | `RASTREABILIDADE.md` atribui a `/alertas` hook e migration errados | Docs | Médio | S | BAIXO | ALTA | **Código** |
| A-11 | Lista truncada em 200 sem aviso nem paginação | Correção | Médio | S | BAIXO | ALTA | **Código** |
| A-12 | `useOperationalCounts` computa duas contagens que ninguém consome | Débito | Baixo | S | BAIXO | ALTA | **Código** |
| A-13 | Linhas legadas possivelmente abertas em produção | Débito | Baixo-médio | S | BAIXO | MÉDIA | **Suspeita** |
| A-14 | `agency_report_deadline_missed` não fecha ao assinar | Arquitetura | Baixo-médio | S | BAIXO | MÉDIA | **Código** + **Suspeita** |
| A-15 | `operacao-suporte.md` afirma que não há teste focado de `Alertas` | Docs | Baixo | S | BAIXO | ALTA | **Código** + **Teste** |

---

## 1. Os dois achados de topo

### A-01 — o alerta de fatura vencida é engolido pelo cron

Existem dois mecanismos que marcam faturas locais como `overdue`, e eles
competem:

- `mark_overdue_invoices()` — `supabase/migrations/031_overdue_enforcement.sql:16-42`,
  redefinida em `supabase/migrations/157_demurrage_drop_overdue.sql:10-25`. Roda
  por `pg_cron` **diariamente às 06:00 UTC** (`031:38-42`) e executa
  `UPDATE invoices SET status='overdue' WHERE status='issued' AND due_date < CURRENT_DATE`.
  **Não cria alerta nenhum.**
- `detect_overdue_invoices()` — `supabase/migrations/168_overdue_invoice_alerts_ptbr_entity.sql:37-83`.
  Cria o alerta **apenas dentro do `FOR v_row IN UPDATE ... RETURNING`**, ou
  seja, só para as linhas que ela própria transiciona
  (`WHERE status IN ('issued','partially_paid')`).

Como o cron chega primeiro em quase todos os casos, quando o usuário abre
`/faturamento` (`src/pages/Faturamento.tsx:105-113`, único chamador) a fatura já
está em `overdue`, o loop não retorna linha alguma e **nenhum alerta é
inserido**. A janela em que o mecanismo funciona é estreita: uma fatura que
vence e é vista antes das 06:00 UTC seguintes, ou uma fatura `partially_paid`
(que o cron não toca).

Efeito de segunda ordem: como não há alerta, também não há o que fechar — e o
guard `trg_block_invoice_overdue_customer` (`031:72-75`) bloqueia novas emissões
para aquele cliente sem que exista qualquer sinal na fila de alertas explicando
o bloqueio.

**Confiança:** ALTA na leitura do código. Falta confirmar em runtime que o job
`mark-overdue-invoices` está de fato agendado no projeto remoto — ver §7.

### A-02 — a decisão que responde à pergunta já existe e está parada

A [ADR 0034](../../adr/0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md)
(status: aceito, 24 jul 2026) decide exatamente o desenho pedido:

- `Alerta` é fila coletiva; `Notificação Interna` é entrega pessoal (§1).
- **Audiência é regra declarada por tipo de evento, num ponto único de
  fan-out**, com os papéis `administrativo | financeiro | operacoes |
  documentacao | equipamentos` (§3).
- `assigned_to` permanece deliberadamente sem uso (§3).
- A política de RLS de `alerts` **não muda** (§"Consequências").
- `alertEntityLink()` sai de `src/pages/Alertas.tsx` para módulo compartilhado (§9).
- Sem backfill (§10).

Não existe migration, tabela, RPC, hook ou componente correspondente: a busca
por `internal_notification` / `notificacao_interna` em `src/`, `supabase/` e
`docs/` retorna apenas a própria ADR e o índice de ADRs. Enquanto isso o
`CONTEXT.md` já carrega o glossário completo — Notificação Interna, Cópia
Congelada, Evento Notificável, Regra de Destinatários, Eco de Tratamento,
Indicador Operacional — descrevendo um sistema que não foi construído.

---

## 2. Mapa completo dos geradores atuais

**14 tipos vivos, 25 sites de `INSERT`, 6 mecanismos de origem distintos.**
"Fecha sozinho" indica se existe rotina que devolve o alerta a `closed` sem ação
humana.

| Tipo | Produtor (definição viva) | Mecanismo | Disparo | `entity_type` / `entity_id` | Dedupe | Fecha sozinho | Em `TYPE_LABELS`? |
|---|---|---|---|---|---|---|---|
| `invoice_overdue` | `detect_overdue_invoices` — `168:62` | RPC chamada pelo front | Abrir `/faturamento` | `invoice` / **`invoice_number`** | `NOT EXISTS` | **Não** | Sim |
| `invoice_payment_invalid` | `createAlert` — `src/components/billing/InvoiceDetailModal.tsx:152` | **Cliente**, `INSERT` direto | Erro de pagamento na modal | `invoice` / `id` | **Não** | **Não** | **Não** |
| `invoice_cancel_blocked` | `createAlert` — `src/components/billing/InvoiceDetailModal.tsx:219` | **Cliente**, `INSERT` direto | Cancelamento bloqueado | `invoice` / `id` | **Não** | **Não** | **Não** |
| `portal_invoice_created` | `portal_create_consolidation` — `123:314` | RPC do Portal | Cliente consolida | `invoice` / `id` | Não | Não | Sim |
| `portal_consolidation_obsoleted` | `portal_obsolete_consolidation` — `119:209` | RPC do Portal | Cliente desfaz consolidada | `invoice` / `id` | Não | Não | Sim |
| `portal_dispute_opened` | `portal_open_demurrage_dispute` — `117:257` | RPC do Portal | Cliente abre disputa | **`demurrage_invoice`** / `id` | Não | **Não** (`116:174` só notifica o cliente) | **Não** |
| `portal_excecao_critica_fatura` | trigger `portal_invoice_exception_on_issue` — `189:22` | Trigger em `invoices` | Emissão sem Portal ativo | `invoice` / `id` | `NOT EXISTS` | **Sim** (`189:47`) | Sim |
| `portal_pendencia_geral` | `portal_refresh_general_pendencies` — `190:8` | **`pg_cron` */15min** (`190:44`) | Cliente com processo ativo sem Portal | `customer` / `id` | `NOT EXISTS` | **Sim** (`190:24`) | Sim |
| `portal_convite_expirado` | `portal_mark_expired_invites` — `181:13` | **`pg_cron` */15min** (`181:27`) | Convite expira em 48 h | `customer` / `id` | `NOT EXISTS` | **Sim** (`supabase/functions/portal-invite-activate/index.ts:36`) | Sim |
| `portal_falha_envio` | `supabase/functions/portal-invite-send/index.ts:45` | **Edge Function** | Falha de envio Resend | `customer` / `id` | **Não** | Não | Sim |
| `portal_email_suprimido` | `supabase/functions/portal-email-webhook/index.ts:30` | **Webhook Resend** | Bounce permanente | `customer` / `id` | Não | Não | Sim |
| `portal_abuso_login` | `supabase/functions/portal-login/index.ts:44-45` | **Edge Function** | Bloqueio por rate limit | `customer` / `id` | Sim (query prévia) | Não | Sim |
| `agency_report_department_pending` | `detect_agency_report_pending` — `253:311` | RPC chamada pelo front | Abrir `/alertas` | `agency_departure_report` / `voyage::porto::depto` | `NOT EXISTS` | **Sim** (`253:231`) | **Não** |
| `agency_report_deadline_missed` | `detect_agency_report_deadline_missed` — `271:177` | RPC chamada pelo front | Abrir `/alertas` | `agency_departure_report` / `voyage::porto::depto` | `NOT EXISTS` + trigger de rejeição (`272:60`) | Só no Fechamento do ADR (`271:281`) | Sim |
| ~~`agency_report_section_pending`~~ | `219:87` — **aposentado pela 225** | — | — | `...::secao` | — | `271:293` fecha legados no Fechamento | Sim (rótulo órfão) |

Migrations citadas sem caminho estão em `supabase/migrations/`.

**Rótulos mortos em `TYPE_LABELS`** (`src/pages/Alertas.tsx:22-24`): `demurrage`,
`billing`, `review` — nenhum produtor no repositório inteiro. O fixture do teste
(`src/pages/__tests__/Alertas.behavior.test.tsx:7`) usa `type: 'demurrage'`, o
que perpetua a ilusão de que o tipo existe. **Teste**

**Distribuição dos mecanismos:** dos 14 tipos vivos, **2 dependem de o usuário
abrir `/alertas`**, **1 depende de abrir `/faturamento`**, **2 rodam em
`pg_cron`**, **3 vivem em Edge Functions**, **1 é trigger** e **2 nascem no
navegador**. Não existe um mecanismo único de detecção — existem seis, com
garantias de entrega completamente diferentes.

---

## 3. Matriz por departamento

O departamento **não é um campo**. É conhecimento tácito, exceto no ADR, onde
está embutido em string. Atribuição implícita reconstruída a partir das RPCs de
RBAC (`179:29`, `186:11`, `196:6`, `225:207-210`):

| Departamento (`user_profiles.role`) | Alertas que lhe pertencem hoje | Como o sistema sabe | Consegue filtrar? |
|---|---|---|---|
| **Financeiro** | `invoice_overdue`, `invoice_payment_invalid`, `invoice_cancel_blocked`, `portal_invoice_created`, `portal_consolidation_obsoleted`, `portal_dispute_opened` | **Não sabe** | Não |
| **Documentação** | `portal_pendencia_geral`, `portal_convite_expirado`, `portal_falha_envio`, `portal_email_suprimido`, `portal_excecao_critica_fatura`, `agency_report_*` (`documentacao`) | Só no ADR, via `split_part(entity_id,'::',3)` | Só no ADR, por string |
| **Administrativo** | `portal_abuso_login` e tudo de Documentação (as RPCs de Portal aceitam `administrativo` ∪ `documentacao`) | **Não sabe** | Não |
| **Operações** | `agency_report_*` (`operacoes`) | `entity_id` composto | Por string |
| **Equipamentos** | `agency_report_*` (`equipamentos`) | `entity_id` composto | Por string |
| **Global (sem dono)** | Nenhum tipo é conceitualmente global — todos têm dono natural que o modelo não registra | — | — |

**Consequência operacional:** um usuário de Equipamentos abre `/alertas` e
recebe faturas vencidas, abuso de login no Portal e disputas de demurrage
misturados às suas escalas pendentes, num único bloco de até 200 linhas
ordenadas por data. Não há filtro por tipo, departamento, entidade ou
severidade — só as três abas de status (`src/pages/Alertas.tsx:42-46`). A RLS
(`010_rls_by_role.sql:128-145`) garante que ele veja tudo e possa fechar tudo.

### O `entity_id` composto do ADR é contrato, não apresentação

`voyageId::porto::departamento` é hoje **chave de dedupe e de fechamento**: a
253 fecha o alerta por igualdade de string (`253:232-237`) e a 272 faz
`split_part` para descobrir a escala (`272:14`). É string-parsing exercendo
papel de chave estrangeira — workaround histórico, não modelo de ownership.

---

## 4. O que ainda não gera alerta (lacunas de cobertura)

Estas pendências são **calculadas em tela**. Para parte delas isso é uma escolha
defensável: o `CONTEXT.md` cunha o termo **Indicador Operacional** justamente
para elas ("contagem derivada do estado atual, sem instante de ocorrência nem
estado de leitura") e a ADR 0034 §6 as exclui explicitamente do sino. A tabela
separa o indicador legítimo da pendência disfarçada de indicador.

| Pendência | Onde é calculada | Natureza correta | Impacto de não ser alerta |
|---|---|---|---|
| B/L sem cliente | `src/hooks/useOperationalCounts.ts:83-94` | **Pendência** (dono: Documentação) | Só existe enquanto alguém olha; hoje nem badge tem (A-12) |
| B/L `pending_review` | `src/hooks/useOperationalCounts.ts:31-42` | **Pendência** | Badge em `/revisao`; sem SLA, sem rastro de tratamento |
| `charge_status = review_required` | `src/hooks/useOperationalCounts.ts:44-55` | **Pendência** | Único badge financeiro (`appLayoutNav.ts:65-66`); bloqueia faturamento sem gerar registro |
| Demurrage vencido | `src/hooks/useOperationalAlerts.ts:9-20` | **Indicador** (ADR 0034 §6) | Correto como está |
| Demurrage correndo | `src/components/clientes/VisaoGeralTab.tsx:48` | **Indicador** | Correto |
| Portal não ativo (por cliente) | `VisaoGeralTab.tsx:38` | **Duplicado** de `portal_pendencia_geral` | Duas fontes de verdade que podem discordar |
| Reconciliação de cliente pendente | `VisaoGeralTab.tsx:35` | **Pendência** | Sem registro, sem prazo |
| Invoices vencidas (por cliente) | `VisaoGeralTab.tsx:42` | **Duplicado** de `invoice_overdue` | Dado o A-01, é hoje a **única** superfície que funciona |
| Disputas abertas (por cliente) | `VisaoGeralTab.tsx:44` | **Duplicado** de `portal_dispute_opened` | Idem |
| Vigência de tabela vencida/futura | `src/pages/taxasLocaisHelpers.ts:163,170` | **Pendência de cadastro** | Só quem abre `/taxas-locais` vê; ADR 0040 tornou a vigência informativa, o que aumenta a chance de tabela errada ativa |
| Duas tabelas ativas no mesmo escopo | `src/pages/taxasLocaisHelpers.ts` (~135) | **Pendência crítica de cadastro** | Erro de precificação silencioso |
| Divergências Baplie × B/L | `VoyageAgencyReportTab` (`dischargeDivergence`, `vaziosDivergence`) | **Pendência** | Visível só dentro da aba ADR daquela viagem |
| Dados órfãos (granito/vazios fora das escalas) | idem (`orphanData`) | **Pendência** | Idem |
| Erros de importação (`import_errors`) | Nenhuma superfície consolidada em `src/` | **Lacuna real** | Tabela no schema, zero consumidores no frontend |
| Escala com ETA vencido sem ATA | `CONTEXT.md` §Próxima Escala | **Pendência de Operações** | Nem indicador nem alerta |
| ADR de escala omitida / sem ATD | `src/services/agencyReportSla.ts` | Fora de medição por design (ADR 0039) | Correto |

**Padrão que emerge:** três pendências (Portal não ativo, invoices vencidas,
disputas) existem **simultaneamente** como alerta persistido e como cálculo de
tela, com regras ligeiramente diferentes. Não é redundância inofensiva: são duas
fontes de verdade divergentes para a mesma pergunta operacional.

---

## 5. Modelo futuro recomendado

A recomendação é **não redesenhar do zero**. A ADR 0034 já decidiu o eixo difícil
(separar fila coletiva de entrega pessoal; audiência como regra declarada em
ponto único). Falta executá-la e resolver o que ela deliberadamente deixou de
fora: os atributos do próprio Alerta.

### 5.1 O que a ADR 0034 já resolve — executar como está

Tabela de Notificação Interna com RLS por destinatário; Regra de Destinatários
por tipo de Evento Notificável em ponto único de fan-out; `alerts` e sua RLS
inalteradas; `/alertas` mantida como central de trabalho; `alertEntityLink()`
extraída para módulo compartilhado; sem backfill.

### 5.2 O que falta decidir — atributos de `alerts`

| Campo proposto | Justificativa |
|---|---|
| `department` (nullable) | Torna explícito o que hoje é string-parsing no ADR (`272:14`) e tácito nos outros 12 tipos. Permite filtrar em `/alertas` sem tocar em RLS |
| `severity` | Hoje `portal_abuso_login` e `portal_invoice_created` ocupam a mesma linha visual, com o mesmo ícone âmbar (`Alertas.tsx:153`) |
| `category` (`pendencia` \| `evento`) | `portal_invoice_created` e `portal_consolidation_obsoleted` **não são pendências** — são avisos. Nunca fecham (A-05) porque não há o que fazer. Misturá-los com pendências é o que torna a fila não confiável |
| `dedupe_key` + índice único parcial `WHERE status <> 'closed'` | Substitui os oito blocos de `NOT EXISTS` copiados entre migrations e o `entity_id` composto. Dedupe passa a ser garantia do banco, não convenção de cada autor |
| `due_at` | O ADR já calcula prazo (`271:44`, `src/services/agencyReportDeadline.ts`), mas fora da tabela. Faturas vencidas não têm prazo de tratamento algum |
| `acknowledged_by` / `acknowledged_at` / `closed_by` | A-07. Hoje é impossível saber quem fechou um alerta, embora o `CONTEXT.md` prometa que o ato vale para toda a equipe |
| `payload jsonb` | Permite reconstituir mensagem e destino sem depender do parsing de `entity_id`; compatível com a rejeição do `link` congelado (ADR 0034 §9) |

**Deliberadamente fora:** `assigned_to` permanece sem uso (ADR 0034 §3);
`notified_at` deve ser removida ou reservada ao fan-out — ambas são colunas
mortas desde a `001`.

### 5.3 Global vs departamental — o desenho recomendado

Três camadas, cada uma respondendo uma pergunta diferente:

1. **`alerts` continua global e coletivo.** Todo usuário ativo lê tudo. É a
   memória compartilhada da operação; restringir por RLS quebraria a premissa
   de "tratado uma única vez pela equipe" e criaria alertas que ninguém vê
   porque o dono está de férias.
2. **`department` é atributo de *filtro e roteamento*, não de *acesso*.**
   `/alertas` ganha "Meu departamento" como filtro padrão e "Todos" como opção.
   Visibilidade permanece total, foco passa a ser opcional — e evita reescrever
   `010_rls_by_role.sql` com a superfície de regressão que isso traria.
3. **A entrega pessoal é a Notificação Interna** (ADR 0034), roteada pela Regra
   de Destinatários, com RLS por destinatário.

Em uma frase: **departamental na entrega, global na fila.** É o único arranjo
que preserva as duas invariantes já documentadas no `CONTEXT.md` — "tratada uma
única vez pela equipe" e "estado de leitura próprio de cada destinatário".

---

## 6. Ordem de implementação e dependências

```text
FASE 0 — parar a hemorragia (sem dependências)
  1. A-01  cron × detect_overdue_invoices          ─┐
  2. A-03  TYPE_LABELS + A-09 ENTITY_TYPE_LABELS   ─┤ independentes
  3. A-04  deep link de portal_dispute_opened      ─┤ entre si
  4. A-10 + A-15  correções de documentação viva   ─┘

FASE 1 — higiene da fila (depende de 0)
  5. A-05  fecho automático de invoice_overdue e portal_dispute_opened
              └─ depende de A-01 (não adianta fechar o que nunca abre)
  6. A-13  limpeza de linhas legadas em produção
              └─ depende de A-05 (senão reabrem)
  7. A-11  paginação / aviso de truncamento
  8. A-08  throttle dos detectores da página
  9. A-12  remover contagens mortas

FASE 2 — uniformizar a detecção (depende de 1)
 10. Mover os três detectores de front para pg_cron, seguindo o padrão já
     provado nas migrations 181 e 190
              └─ depende de A-01 e A-08
 11. A-06  unificar convenção de entity_id de invoice
              └─ depende de 10 (a migração de dados precisa de detecção estável)

FASE 3 — modelo (depende de 2)
 12. Migration de atributos: department, severity, category, dedupe_key,
     due_at, acknowledged_by/at, closed_by, payload + índice único parcial
              └─ depende de A-06 (dedupe_key só é confiável com entity_id são)
 13. Backfill de department/category nos 14 tipos vivos
 14. Filtro "Meu departamento" em /alertas
 15. A-07  fechar INSERT do cliente; mover invoice_payment_invalid e
     invoice_cancel_blocked para RPC
              └─ depende de 12
 16. A-14  decidir e documentar o ciclo de vida do deadline_missed

FASE 4 — ADR 0034 (depende de 3)
 17. Extrair alertEntityLink() para módulo compartilhado
 18. Tabela de Notificação Interna + RLS por destinatário
 19. Regra de Destinatários + ponto único de fan-out
              └─ depende de 12/13: o fan-out roteia POR department
 20. Sino no header + Eco de Tratamento
              └─ depende de 15: ecos só existem se ack/close forem rastreáveis
```

**Dependências críticas:**

- **12 antes de 19** — a Regra de Destinatários roteia por `department`; sem o
  campo, o fan-out volta a ser regra espalhada pelos produtores, que é
  exatamente o que a ADR 0034 §3 rejeita.
- **A-01 antes de A-05** — não faz sentido escrever a rotina de fecho de um
  alerta que hoje não nasce.
- **A-06 antes de `dedupe_key`** — duas convenções de `entity_id` para o mesmo
  `entity_type` produziriam chaves duplicadas no índice único.
- **A-07 antes do Eco de Tratamento** — o Eco precisa saber *quem* reconheceu.
- **A Fase 2 é o gate real.** Enquanto a detecção depender de navegação,
  qualquer melhoria de modelo fica sobre uma base que só funciona quando alguém
  abre a tela certa.

---

## 7. Verificações de runtime não realizadas

Precisam de acesso ao banco de produção e mudariam a confiança de três achados:

1. `SELECT jobname, schedule, active FROM cron.job;` — confirma A-01 (o job
   `mark-overdue-invoices` está mesmo agendado?) e se os jobs `portal-*` das
   migrations 181/190 sobreviveram.
2. `SELECT type, entity_type, status, count(*) FROM alerts GROUP BY 1,2,3 ORDER BY 4 DESC;`
   — quantifica A-05, A-11 e A-13 (quantas linhas legadas
   `agency_report_section_pending` e `entity_type='invoices'` estão abertas).
3. `SELECT count(*) FROM invoices WHERE status='overdue' AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.type='invoice_overdue' AND a.entity_id = invoices.invoice_number);`
   — mede diretamente o buraco do A-01.

---

## 8. Considerado e rejeitado como achado

- **RLS de `alerts` liberar leitura a todo usuário ativo** — não é
  vulnerabilidade: é premissa de domínio registrada no `CONTEXT.md` ("compartilhada
  por toda a equipe interna") e reafirmada na ADR 0034. O problema real é a
  *ausência de filtro de foco*, não o acesso.
- **`assigned_to` sem uso** — decisão explícita da ADR 0034 §3.
- **Indicadores do header não serem alertas** — decisão explícita da ADR 0034
  §6, coerente com o conceito de Indicador Operacional.
- **`portal_notifications` separada de `alerts`** — ADR 0034 §8 rejeitou a
  tabela polimórfica por superfície de vazamento entre audiências.
- **Duplicação de detectores nas migrations 214/219/225/228/251/253** — são
  redefinições sucessivas de `CREATE OR REPLACE` da mesma função, padrão normal
  de migrations; só a 253 está viva.

---

## Anexo — evidência por achado

| Achado | Arquivo e linha |
|---|---|
| A-01 | `supabase/migrations/031_overdue_enforcement.sql:38-42`; `supabase/migrations/157_demurrage_drop_overdue.sql:19-23`; `supabase/migrations/168_overdue_invoice_alerts_ptbr_entity.sql:37-44`; `src/pages/Faturamento.tsx:105-113` |
| A-02 | `docs/adr/0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md:1,38-159`; `CONTEXT.md` §"Alertas e notificações" |
| A-03 | `src/pages/Alertas.tsx:18-33` |
| A-04 | `src/pages/Alertas.tsx:214-218` vs `supabase/migrations/117_portal_fase3_rate_limiting.sql:257-263` |
| A-05 | `supabase/migrations/168_*.sql` (sem `UPDATE` de fecho); `supabase/migrations/116_portal_fase2_notifications_disputes_profile.sql:174-204`; contraste com `189:47`, `190:24`, `253:231` |
| A-06 | `supabase/migrations/168_*.sql:45` vs `supabase/migrations/189_portal_invoice_critical_exception.sql:23`; consequência em `src/pages/Alertas.tsx:215,223` |
| A-07 | `supabase/migrations/010_rls_by_role.sql:128-145`; `src/services/alerts.ts:44-84`; `src/components/billing/InvoiceDetailModal.tsx:152,219` |
| A-08 | `src/pages/Alertas.tsx:53-60` |
| A-09 | `src/pages/Alertas.tsx:35-40` |
| A-10 | `docs/RASTREABILIDADE.md:70` (cita `useOperationalAlerts`, que a página não usa, e migration `261` em vez da `271`) |
| A-11 | `src/services/alerts.ts:31` |
| A-12 | `src/hooks/useOperationalCounts.ts:57-94` vs `src/components/layout/AppLayout.tsx:53,56` |
| A-13 | `supabase/migrations/219_agency_report_alert_copy.sql:85-91`; `supabase/migrations/084_portal_auth_uid_rework.sql:284-290` (`entity_type='invoices'`, plural) |
| A-14 | `supabase/migrations/253_adr_embarque_vazios_secao_unica.sql:231-237` (fecha o `_pending`) vs `supabase/migrations/271_agency_report_deadline_missed.sql:281` (só no Fechamento) |
| A-15 | `docs/modules/operacao-suporte.md:330` vs `src/pages/__tests__/Alertas.behavior.test.tsx` |
| Tabela `alerts` | `supabase/migrations/001_schema.sql:24-35`; índices em `011_schema_hardening.sql:230-234` |

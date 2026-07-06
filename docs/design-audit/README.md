# Design Audit — Transhipping Desk

- **Data:** 2026-07-06
- **Commit base:** `4d3084f` (branch `claude/design-audit-i17u7e`)
- **Método:** app real rodando contra stack Supabase local (Postgres 16 + shim
  PostgREST/GoTrue em `scripts/design-audit/`), migrações `001`–`151+` aplicadas
  com `ON_ERROR_STOP=1`, seeds `validation_seed.sql` + `seed_audit.sql`.
  Screenshots desktop 1440×900 (fullPage nas listas) e mobile 390×844 via
  Playwright, com captura de erros de console e respostas HTTP ≥ 400 por rota.
- **Rotas cobertas:** login (+ estado de erro), painel, viagens (+ modal Nova
  Viagem), manifestos, containers, carga-solta, veículos, manifestos/:blId,
  revisão, clientes, clientes/:cnpj, taxas-locais, faturamento (+ modal
  Detalhes), alertas, relatórios, demurrage, demurrage/taxas, reconciliação,
  granito, granito/taxas, embarquevazios, vazios-importação, baplie,
  line-up-tv/display, admin/usuários, portal/login. Mobile: login, painel,
  manifestos, faturamento.
- **Artefatos de ambiente (não são bugs do produto):** Google Fonts e API PTAX
  do BCB bloqueados pelo proxy de egress (header mostra "INDISPONÍVEL" na
  cotação); websockets realtime falham contra o shim.

## Corrigido nesta auditoria

Verificação após as correções: `npx tsc -b`, `npm run lint`, `npm test`
(902 passed / 9 skipped), `npm run build`, `npm run docs:check` — tudo verde.
Re-screenshot confirmou zero erros de console nas rotas revisitadas.

| # | Problema | Correção | Evidência |
|---|----------|----------|-----------|
| 1 | Chaves React duplicadas em `/manifestos` (`closed-` para dois modais irmãos quando `voyageId` vazio) — warning de console em toda carga da página, risco de remonte incorreto | Prefixos distintos `upload-`/`bl-import-` nas keys (`src/pages/Manifestos.tsx`) | [antes](assets/manifestos.png) · [depois](assets/after-manifestos.png) (console limpo) |
| 2 | Ficha do cliente exibia códigos crus de máquina: Revisão "ok", Financeiro "invoiced"/"paid", status de invoice "issued"/"paid" | Reuso do mapa central `src/lib/statusLabels.ts` em `ClienteFicha.tsx` → "OK", "Faturado", "Pago", "Emitida", "Paga" | [antes](assets/cliente-detail.png) · [depois](assets/after-cliente-detail.png) |
| 3 | Modal de detalhe da fatura misturava EN/PT: título "Detalhe Invoice", botão "Adicionar other charge", labels sem acento (Descricao, Valor unitario, Observacao, Emissao, Acoes) | Copy pt-BR: "Detalhe da invoice" (invoice é linguagem de domínio, ver CONTEXT.md), "Adicionar cobrança manual", acentos nos labels; testes atualizados | [antes](assets/faturamento-detalhes-modal.png) · [depois](assets/after-faturamento-detalhes-modal.png) |
| 4 | Tarifas de Demurrage exibiam vigência em formato ISO `2026-07-06` em vez de pt-BR | `formatDate()` na coluna Vigência (`DemurrageRates.tsx`) → `06/07/2026` | [antes](assets/demurrage-taxas.png) · [depois](assets/after-demurrage-taxas.png) |
| 5 | Paginação sem acento em 11 telas ("Pagina 1 de 1", botão "Proxima") | "Página"/"Próxima" em todos os rodapés de tabela | [antes](assets/manifestos.png) · [depois](assets/after-manifestos.png) |
| 6 | Títulos de página sem acento: "Veiculos", "Vazios — Exportacao", "Vazios — Importacao", "Conciliacao PIX" (o título da aba já era acentuado — inconsistente) | Acentuação nos `PageHeader` e botões correspondentes | [antes](assets/veiculos.png) · [depois](assets/after-veiculos.png), [antes](assets/reconciliacao.png) · [depois](assets/after-reconciliacao.png) |
| 7 | Headers de tabela sem acento espalhados pelo app: Acoes (15 telas), Revisao, Emissao, Descricao, Vigencia, Operacao, Devolucao, Consignatario, Data Movimentacao | Correção em lote nos headers visíveis | [antes](assets/embarquevazios.png) · [depois](assets/after-embarquevazios.png) |
| 8 | Labels e textos visíveis sem acento: badge "Padrao", "Pendentes revisao" (KPI), empty state "Quando houver dados para este modulo, eles aparecerao aqui", descrições de página (Clientes, Taxas Locais, Manifestos, Baplie), labels do B/L (Consignatario, Descricao da carga, Justificativa da alteracao manual), meta da TV (Inicio do ciclo, Ultima alteracao, Atualizado as), toasts de exportação | Copy pt-BR consistente | [depois](assets/after-line-up-tv.png) |

## Achados priorizados

Eixos: **E** = Entendimento · **C** = Confiança · **$** = Conversão (fluxo
manifesto → revisão → taxas → fatura).

### P0 — nenhum

O fluxo principal (login → painel → manifestos → revisão → taxas → faturamento
→ fatura) completa sem erro, com dados coerentes entre telas. As migrações
aplicam limpas em Postgres 16 vazio (exceto nota sobre `supabase_realtime`
abaixo).

### P1

| Problema | Eixo | Onde | Fix recomendado |
|----------|------|------|-----------------|
| Alerta de fatura vencida gerado pelo banco em inglês e formato numérico US: "**Invoice** FAT-2026-0014 venceu em 26/06/2026 — saldo pendente: **R$ 1,510.00**" (vírgula de milhar + ponto decimal). Aparece em Alertas e no banner do Faturamento, exatamente onde o operador decide cobrança | C | `detect_overdue_invoices()` — migrações `024` e `151` (`to_char(..., 'FM999,999,990.00')` + literal "Invoice") | Nova migração trocando o literal para "Fatura" e o `to_char` para formato pt-BR (`FM999G999G990D00` com `lc_numeric` pt_BR, ou formatação em JS exibindo a partir de `entity_id`). Não aplicado aqui: mexe em RPC/migração (área protegida) |
| Painel TV (`/line-up-tv/display`): colunas VOY e POD colidem visualmente ("088ECNSHA" lê como um bloco só) e nome do navio corta nas duas pontas ("OSCO SHIPPING ARII") | E | `LineUpTable.tsx` (`table-fixed` + `<col>` de 4–6% + `px-1` + fonte 17–26px) | Rebalancear larguras das `<col>` no modo display e permitir quebra do nome do navio em duas linhas; validar em 1920×1080 real. Não aplicado: layout da TV é calibrado para o monitor da operação, mudança precisa de validação in loco |
| Alertas: coluna Entidade mistura `invoice / 205` (id interno) com `invoice / FAT-2026-0016` (número de documento) — operador não consegue correlacionar "205" com nada visível | E, C | `alerts.entity_id` gravado ora com id numérico, ora com invoice_number (migrações 024/151 vs 031) | Padronizar para invoice_number no INSERT do alerta (nova migração) e/ou resolver o número no render de Alertas |

### P2

| Problema | Eixo | Onde | Fix recomendado |
|----------|------|------|-----------------|
| Formato USD inconsistente entre telas: Demurrage lista "$ 1.200,00" (pt-BR) e Tarifas de Demurrage "$ 50.00" (US `toFixed`) | C | `Demurrage.tsx` vs `DemurrageRates.tsx` | Helper único `formatUSD` pt-BR em `lib/utils.ts` |
| Carga Solta: headers de KPI e tabela em inglês (PACKAGES TOTAL, WEIGHT (TON), SHIPPER, CONSIGNEE) enquanto o resto da tela é pt-BR | E | `CargaSolta.tsx` | Traduzir headers não-domínio (Shipper/Consignee são termos de manifesto, aceitáveis; "Weight (ton)" → "Peso (ton)") |
| Clientes: ícone de lixeira (excluir cliente) como ação de linha com o mesmo peso visual das ações neutras (Ficha, log, "...") | C | `Clientes.tsx` | Mover exclusão para dentro do menu "..." ou confirmar com danger styling (já existe ConfirmDialog) |
| Admin/Usuários: papel exibido como chip "ADMIN (LEGADO)" ao lado de um select com valor diferente ("Administrativo") — duas representações do mesmo dado na mesma linha | E | `AdminUsuarios` | Exibir só o select (fonte de verdade) e mover "legado" para tooltip |
| Mobile /manifestos: coluna fixa de Ações cobre a coluna CE Mercante sem affordance clara de scroll; conteúdo "1526…" cortado | E | `.app-table--sticky-actions` em viewport estreito | Reduzir colunas visíveis no mobile ou indicador de scroll horizontal |
| Manifesto BB (Revisão): linha com campo "Peso BB (ton)" + Salvar inline sem label do que está sendo salvo | E | `Revisao.tsx` | Label explícito "Informar peso BB para liberar cálculo" |
| Inputs nativos de data exibem `mm/dd/yyyy` conforme locale do navegador/SO, não do app | C | `Relatorios.tsx` e demais `input[type=date]` | Aceitar (comportamento nativo) ou documentar; alternativa é datepicker custom — não recomendado só por isso |
| Granito/Taxas: descrição vaza jargão técnico "peso real (real_weight_kg)" | E | `GraniteRates.tsx` | Remover o nome de coluna da copy |

### P3

| Problema | Eixo | Onde |
|----------|------|------|
| Chips de contagem "6 ATIVA(S) / 26 ITEM(NS) / 4 MANUAL(IS)" — pluralização mecânica | E | `TaxasLocais.tsx` |
| Chips "PRONTO 2", "PEND 2" na lista de clientes sem legenda | E | `Clientes.tsx` |
| Admin: "CRIADO EM 06/07/26" com ano de 2 dígitos vs 4 dígitos no resto do app | C | `AdminUsuarios` |
| Manifestos: coluna Invoice parcialmente encoberta pela coluna sticky de Ações em 1440px (scroll existe, mas o corte "FAT-…" sugere dado truncado) | E | `Manifestos.tsx` |
| Fatura CANCELADA ainda exibe "Saldo R$ 5.320,00" na lista — saldo de fatura cancelada não é cobrável | C | `InvoicesTable.tsx` |
| Portal login: área de logo em branco acima do título (logo não renderiza) | C | `PortalLogin.tsx` |
| Migração `124_vessel_schedules.sql` assume publication `supabase_realtime` existente — quebra bootstrap em Postgres vazio (afeta só ambientes locais/CI) | — | adicionar `create publication if not exists` guard |

## Resumo por dimensão

| Dimensão | Avaliação |
|----------|-----------|
| Primeira impressão | Forte: identidade visual consistente (navy/laranja), login limpo, painel Line-Up direto ao ponto |
| Navegação | Boa: menu por domínio (Importação/Exportação/Financeiro) com badges de pendência; breadcrumbs nos detalhes |
| Hierarquia visual | Boa nas listas (KPI cards → filtros → tabela); modal de fatura denso mas organizado |
| Consistência de componentes | Média: paginação, badges e formatos de moeda/data variavam entre telas (parcialmente corrigido nesta auditoria) |
| Estados loading/empty/error | Bons: skeletons, empty states com orientação de próximo passo, erro de login distingue credencial × transporte |
| Sinais de confiança | Média→boa: auditoria com justificativa nas edições, alertas financeiros visíveis; prejudicada por alerta em inglês/formato US (P1) e códigos crus (corrigido) |
| Caminho de conversão | Fluxo manifesto → revisão → taxas → fatura navegável sem docs; cards de status do B/L (Revisão/Cliente/Taxas/Financeiro) guiam o próximo passo |

## Top 5 — impacto em conversão

1. **Alerta de vencida em inglês/formato US** (P1): é o gatilho de cobrança; o
   operador precisa confiar no número que vê.
2. **Entidade de alerta `invoice / 205`** (P1): quebra o caminho alerta → fatura.
3. **Códigos crus na ficha do cliente** (corrigido): a ficha é onde se decide
   faturar; "invoiced"/"issued" exigiam tradução mental.
4. **USD inconsistente Demurrage × Tarifas** (P2): mina confiança no módulo que
   fatura em dólar.
5. **Lixeira de excluir cliente exposta na lista** (P2): erro destrutivo a um
   clique do fluxo de faturamento.

## Top 5 — quick wins

1. Acentuação e copy pt-BR em títulos, headers e paginação (feito, ~40 strings).
2. Label map na ficha do cliente reusando `statusLabels.ts` (feito).
3. "Adicionar cobrança manual" no modal de fatura (feito).
4. Vigência de tarifas em formato pt-BR (feito).
5. Keys únicas nos modais de Manifestos — console limpo (feito).

## Histórico

- **2026-07-06** — primeira auditoria completa (este documento).

# Design Audit — Transhipping Desk

- **Data:** 2026-07-07
- **Commit base:** `157f07b` (branch `claude/design-audit-restructure-v2kgyy`)
- **Método:** app real contra stack Supabase local (Postgres 16 + shim
  PostgREST/GoTrue de `scripts/design-audit/`), migrações aplicadas com
  `ON_ERROR_STOP=1` (todas passam limpas, incluindo a `124` com guard),
  seeds `validation_seed.sql` + `seed_audit.sql`. Screenshots desktop
  1440×900 (fullPage nas listas), mobile 390×844, tablet 768×1024 e TV
  1920×1080 via Playwright, com captura de erros de console e respostas
  HTTP ≥ 400 por rota. Prefixo `v2-` em `assets/`.
- **Rotas cobertas:** as 23 rotas da auditoria anterior + detalhe do B/L,
  modal de fatura, ficha do cliente, e verificação de teclado/foco/zoom.
- **Artefatos de ambiente (não são bugs do produto):** Google Fonts e API
  PTAX do BCB bloqueados pelo proxy de egress (tipografia cai para
  fallback nos screenshots; cotação mostra "INDISPONÍVEL"); websockets
  realtime falham contra o shim.

## Linha de gosto (taste baseline)

1. **Quem usa:** equipe interna de agenciamento marítimo (uso diário,
   intenso, em desktop) e clientes externos no portal (uso esporádico).
2. **Para quê:** levar a carga do manifesto à fatura sem erro — o fluxo
   manifesto → revisão → taxas → fatura é o produto.
3. **Caráter:** ferramenta operacional séria, identidade navy/laranja
   institucional. Densidade de dados é virtude, não defeito.

No seu melhor, o produto é **um balcão de operações**: tabelas densas,
estados inequívocos, números pt-BR nos quais o operador confia sem
tradução mental. O valor estético central é confiança — gradientes,
glassmorphism, emoji e motion decorativo não têm lugar aqui; cada pixel
que não ajuda a faturar é ruído. Tudo abaixo foi julgado contra essa
régua, não contra tendências.

**Estado geral:** o sistema está maduro. As correções da auditoria de
2026-07-06 (alertas pt-BR, entidade `FAT-…`, exclusão de cliente no menu,
papel único no Admin, label do peso BB, USD unificado) estão aplicadas e
verificadas em tela. O que esta auditoria encontrou é de outra natureza:
uma rota quebrada no caminho de conversão, regressões de microcopy e
dívidas de mobile.

## Corrigido nesta auditoria

Verificação: `npx tsc -b`, `npm run lint`, `npm test` (913 passed /
9 skipped), `npm run build`, `npm run docs:check` — tudo verde.

### P1 — caminho de conversão

| # | Problema | Correção | Evidência |
|---|----------|----------|-----------|
| 1 | **Ficha do cliente inacessível pela lista.** O link `Ficha` monta `/clientes/12.345.678/0001-90` com o CNPJ formatado; a barra extra não casa com a rota `/clientes/:cnpj` e o catch-all redireciona **silenciosamente ao painel**. A ficha é onde se decide faturar — o clique mais importante da tela de clientes não levava a lugar nenhum | `encodeURIComponent` no CNPJ dos dois pontos que montam o link (`Clientes.tsx`) | [depois](assets/v2-after-cliente-ficha.png) (URL `/clientes/23.456.789%2F0001-01` abre a ficha) |
| 2 | **Alertas financeiros ilegíveis no mobile.** Em 390px as linhas do banner de vencidas clipavam a mensagem no meio do valor e deixavam Reconhecer/Fechar fora da tela — exatamente o gatilho de cobrança | Linhas com `flex-wrap` e mensagem com quebra em vez de `truncate` (`FinancialAlertsPanel.tsx`) | [antes](assets/v2-mobile-faturamento.png) · [depois](assets/v2-after-mobile-faturamento.png) |

### P2

| # | Problema | Correção | Evidência |
|---|----------|----------|-----------|
| 3 | Regressão da auditoria anterior: paginação centralizada em `TableFooterPagination` reintroduziu "Pagina"/"Proxima" sem acento em ~12 telas | Acentuação no componente compartilhado (fix único) + testes | [depois](assets/v2-after-mobile-manifestos.png) (rodapé) |
| 4 | Relatórios: revisão `ok` renderizava badge âmbar rotulado "OK" — cor de pendência com texto de aprovação, semântica de estado contraditória | Tom verde para `ok` e `reviewed` (`Relatorios.tsx`), alinhado a `blStatusService` | [antes](assets/v2-relatorios.png) |
| 5 | Mobile: KPIs empilhados em coluna única — 7 cards de altura inteira antes de qualquer conteúdo em Manifestos (e mais 10 telas) | Grade de 2 colunas abaixo de 640px, desktop intacto (auto-fit preservado) | [antes](assets/v2-mobile-manifestos.png) · [depois](assets/v2-after-mobile-manifestos.png) |
| 6 | Painel: chip CES "EM APROVAÇÃO" colidia com a coluna Linked em 1440px | Rebalanceio de `<col>` só no modo lista (BB 10→8%, CES 7→9%); modo TV intacto | [antes](assets/v2-painel.png) · [depois](assets/v2-after-painel.png) |
| 7 | Portal: logo invisível — `.app-auth__logo` aplica `invert(1)` (branco para o painel navy do login interno), mas o card do portal é claro: branco sobre branco, o "espaço vazio" da auditoria anterior. O wrapper `.app-auth__brand` nem existia no CSS | Modificador `--on-light` sem filtro + grid com respiro no cabeçalho, nas 3 telas do portal | [antes](assets/v2-portal-login.png) · [depois](assets/v2-after-portal-login.png) |
| 8 | Veículos: dica de seleção estilizada como warning âmbar e copy que explicava o sistema ("A importação usa o seletor próprio dentro do modal") em vez de orientar a ação | Tom neutro + "Selecione uma viagem para ver a lista de veículos." | [antes](assets/v2-veiculos.png) |

### P3 — copy e consistência

| # | Problema | Correção |
|---|----------|----------|
| 9 | Alertas: coluna Entidade com códigos crus `invoice / …`, `bl / …` | Mapa `Fatura`/`Container`/`B/L` no render |
| 10 | ~25 strings visíveis sem acento: "Revisao" (cards de status do B/L, filtros), "Maquinas", "Unitario", "Operação" (header de Clientes), "pendências" (toasts do faturamento), "visíveis" (Demurrage), "número do container" (Containers), "Valor Unitário" (Granito), "Não" (ficha), subtítulo de Alertas | Lote de acentuação em componentes e serviços (apenas strings de exibição; chaves de export intactas) |
| 11 | "Free Days" (Tarifas de Demurrage) vs "Free time" (Demurrage) para o mesmo conceito | Unificado em "Free time" |

## Não corrigido — aceito ou aberto

| Página | Viewport | Problema | Severidade | Decisão |
|--------|----------|----------|------------|---------|
| /line-up-tv/display | 1440 | "Aguardando" clipa nas bordas | P3 | Aceito: o modo display é calibrado para o monitor real; em **1920×1080 está limpo** ([evidência](assets/v2-line-up-tv-1920.png)) |
| /manifestos | 390 | Coluna sticky de Ações ainda cobre CE Mercante (a affordance "Deslize para ver mais" existe) | P3 | Aberto: recomendo ocultar colunas de menor valor no mobile |
| /relatorios | desktop | Inputs nativos de data em `mm/dd/yyyy` (locale do SO) | P3 | Aceito (decisão da auditoria anterior mantida) |
| /admin/usuarios | desktop | Tab "Log De Ações" com "De" capitalizado (CSS `capitalize` sobre o rótulo) | P3 | Aberto, cosmético |
| /reconciliacao, /baplie | desktop | Empty state do Baplie é frase solta, sem o componente `EmptyState` usado nas demais telas | P3 | Aberto |

**Piso de correção verificado e limpo:** zero falhas de rede próprias nas
23 rotas (só artefatos de ambiente); focus trap do modal segura Tab e
devolve o foco ao fechar com Escape; skip-link presente; foco visível;
sem scroll horizontal do body em 390px nem no proxy de zoom 200% (720px);
migrações aplicam limpas em Postgres vazio.

## L3 — propostas (não aplicadas; exigem decisão de produto)

1. **Um único rodapé de paginação.** Coexistem dois: o compartilhado
   (`N registros · Página X de Y`, botão à direita) e o do
   Faturamento/Reconciliação (`Página X de Y · N registros`, acentuado
   desde sempre). A regressão de acento do item 3 só foi possível porque
   a microcopy vive em dois lugares. Fundir no componente compartilhado.
2. **Hierarquia de KPIs.** Manifestos tem 7 cards de peso idêntico, Carga
   Solta 8 — nenhum ponto focal; o operador varre tudo para achar
   "Pendentes revisão". Proposta: 1 métrica primária (a que pede ação) +
   strip secundária compacta. Muda o desenho da página; precisa de
   validação com a operação.
3. **Ações icon-only em Taxas Locais.** Lápis/`+`/`×`/`⌄` sem rótulo; o
   `×` parece "fechar" mas presumivelmente desativa a tabela tarifária.
   Rotular ou mover para menu — mesma direção já adotada em Clientes.
4. **Lixeira por linha em Manifestos/Containers.** Excluir B/L continua a
   um clique na lista (Clientes já moveu exclusão para o menu "…"). Há
   ConfirmDialog, mas o padrão diverge entre telas irmãs. Alinhar.
5. **Self-host das fontes** (Syne/DM Sans/IBM Plex Mono via pacote npm):
   hoje toda a tipografia da marca depende do Google Fonts em runtime —
   qualquer bloqueio de rede derruba o app para fallback (visto neste
   sandbox). Custo: +1 dependência; por isso é proposta, não fix.

## Resumo por dimensão

| Dimensão | Avaliação |
|----------|-----------|
| Primeira impressão | Forte e consistente com o caráter do produto (navy/laranja, login limpo, painel direto) |
| Navegação | Boa; **a quebra da Ficha do cliente era a exceção crítica — corrigida** |
| Hierarquia visual | Boa nas listas; KPIs sem ponto focal (proposta L3-2) |
| Consistência de componentes | Boa e melhorando; dois rodapés de paginação restantes (L3-1) |
| Estados | Bons (skeletons, empty states orientados a ação); Baplie fora do padrão |
| Acessibilidade | Sólida: focus trap, skip-link, foco visível, zoom 200% sem quebra |
| Confiança | Alta após v1+v2: alertas pt-BR, semântica de cor coerente, sem códigos crus |

## Histórico

- **2026-07-07** — segunda auditoria (este documento): rota da ficha,
  mobile, regressões de copy, portal, propostas L3.
- **2026-07-06** — [primeira auditoria completa](2026-07-06-auditoria.md)
  e [plano de remediação](../archive/plans/2026-07-06-design-audit-remediation.md)
  (fatias 1–5 verificadas como aplicadas nesta auditoria).

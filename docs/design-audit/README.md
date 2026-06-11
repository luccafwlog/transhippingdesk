# Auditoria de Design — Transhipping Desk

**Data:** 11/06/2026 · **Commit auditado:** `23b022d` · **Método:** site real rodando localmente (Vite + Postgres local com schema completo das 97 migrations + dados sintéticos), navegado via Playwright em desktop (1440×900) e mobile (390×844). Screenshots em [`assets/`](./assets/).

**Lente da auditoria:** não "o UI é bonito?", mas — um usuário normal consegue **entender** o produto, **confiar** nele e **completar a ação principal** (importar manifesto → revisar → faturar → receber) sem ler documentação?

---

## Veredicto geral

O produto é **forte para uma ferramenta interna**: navegação consistente, hierarquia de ações correta nas páginas principais (ação primária sempre em destaque no canto superior direito), estados vazios bem escritos com instrução do próximo passo, skip-link de acessibilidade, trilha de auditoria visível ("justificativa da alteração manual"), e o funil principal (manifesto → revisão → taxas → fatura) é navegável pelos KPI cards do Painel, que são todos clicáveis.

As fraquezas são concentradas e recorrentes — não são dezenas de problemas diferentes, são **4 padrões** repetidos em muitas telas:

1. **Códigos crus de máquina na interface** (`PENDING_REVIEW`, `invoice_overdue`, `Approved`, `active`) — mina entendimento e confiança.
2. **Mistura PT/EN sem critério** ("Invoices em aberto" vs "Faturas", "MANUAL ONLY", "SORT ORDER").
3. **Falhas silenciosas** — quando uma query falha, a UI mostra lista incompleta sem avisar (a fila de granito da Revisão estava quebrada em produção e ninguém via).
4. **Ações destrutivas banalizadas** — "Excluir" com o mesmo peso visual de "Editar"; lixeiras vermelhas sem rótulo em cada linha de tabela.

---

## O que foi corrigido nesta auditoria (já no código)

| Fix | Arquivo | Evidência |
|---|---|---|
| **Bug real de produção:** fila de Revisão consultava `granite_bls.updated_at`, coluna que não existe no schema → a query (e o fallback) falhavam e B/Ls de granito sumiam da fila **silenciosamente** | `src/hooks/useReview.ts` | console limpo em [`09-revisao.png`](./assets/09-revisao.png) |
| Quadro Line-Up esmagava 14 colunas em telas estreitas (texto sobreposto ilegível) em vez de ativar scroll horizontal | `src/index.css` (`.app-table--lineup { min-width: 1024px }`) | antes [`41-mobile-painel.png`](./assets/41-mobile-painel.png) · depois [`52-mobile-painel-after-fix.png`](./assets/52-mobile-painel-after-fix.png) |
| Vigência das tabelas de taxas exibia data ISO crua (`2026-01-01`) em vez de pt-BR | `src/components/taxasLocais/ChargeTablesTab.tsx` | depois [`51-taxas-locais-after-fix.png`](./assets/51-taxas-locais-after-fix.png) |
| Alertas exibiam o código do tipo (`invoice_overdue`, `billing`) em fonte mono | `src/pages/Alertas.tsx` (mapa de labels PT) | antes [`13-alertas.png`](./assets/13-alertas.png) · depois [`50-alertas-after-fix.png`](./assets/50-alertas-after-fix.png) |
| Chips do B/L mostravam `REVISAO: PENDING_REVIEW` / `FINANCEIRO: PENDING` | `src/components/bl/BlOperacionalTab.tsx` | [`08-bl-detalhe.png`](./assets/08-bl-detalhe.png) |
| Admin > Usuários: para usuário com role legado (`operator`), o select mostrava "Administrativo" (primeira opção) em vez do perfil real — risco de troca acidental de permissão | `src/pages/AdminUsuarios.tsx` | [`22-admin-usuarios.png`](./assets/22-admin-usuarios.png) |

`tsc`, ESLint e os 362 testes unitários passam após as mudanças.

---

## Issues (P0 = bloqueia confiança/uso · P3 = polish)

Cada issue indica qual eixo prejudica: **E**ntendimento · **C**onfiança · **V**conversão (conclusão da tarefa).

### P0

| # | Issue | Eixo | Fix |
|---|---|---|---|
| 1 | **Falha silenciosa de dados.** Quando uma query falha (caso real: granito na Revisão), a tela mostra a lista parcial sem nenhum aviso. O operador confia numa fila incompleta e B/Ls ficam sem faturar. A causa pontual foi corrigida, mas o *padrão* persiste: `console.error` + lista vazia. | C, V | Quando uma sub-query falhar, renderizar banner inline "Não foi possível carregar X — tente recarregar" em vez de omitir. Padronizar via componente `InlineError` que já existe. |
| 2 | **Error boundary descarta o app inteiro.** Qualquer exceção numa página derruba header e navegação; sobra um card com a mensagem técnica crua (`Data inválida em cálculo de demurrage: "2026-04-27T00:00:00.000Z"`) e um único botão "Recarregar página". Usuário fica preso e exposto a stack-speak. ([`30-error-boundary-state.png`](./assets/30-error-boundary-state.png)) | C, E | Error boundary por rota (dentro do `AppLayout`), mantendo navegação; mensagem genérica + detalhe técnico colapsado; botão "Voltar ao Painel". |

### P1

| # | Issue | Eixo | Fix |
|---|---|---|---|
| 3 | **Status em inglês cru espalhados pelo produto.** Line-Up: `Approved/Launching/Waiting/Missing`, `YES/NO`; Viagens: chip `active`; Relatórios: `invoiced/pending`, chip `PENDING_REVIEW`. O mesmo conceito aparece como "Pendente" numa tela e `PENDING` noutra. | E, C | Criar um módulo único `src/lib/statusLabels.ts` (mapa código→label PT) e usar em todos os Badges. Os labels já existem espalhados (Manifestos.tsx:882 etc.) — é consolidação, não criação. |
| 4 | **"Excluir" com o mesmo peso visual de "Editar"** em cada card de viagem ([`03b-viagens-viewport.png`](./assets/03b-viagens-viewport.png)); lixeiras vermelhas sem rótulo em cada linha de Containers/Clientes. Deleção de uma viagem em produção é catastrófica. | C | Rebaixar exclusão para menu "⋯" ou torná-la ghost-button; manter confirmação. Nas tabelas, mover a lixeira para dentro da linha expandida/detalhe. |
| 5 | **Jargão sem decodificação no Painel/Line-Up:** colunas `VIN CAR CG MTY RTW BB CES` sem tooltip. Um usuário novo (ou um diretor visitando a TV do terminal) não entende o quadro. ([`02-painel-desktop.png`](./assets/02-painel-desktop.png)) | E | `title=`/tooltip por coluna + legenda compacta sob o quadro (uma linha: "VIN = veículos · CAR = carga · …"). |
| 6 | **Portal do cliente sem caminho de recuperação.** Login externo não tem "esqueci a senha" nem contato; cliente bloqueado = ligação para o suporte ou fatura não paga. Também exibe espaço em branco onde deveria estar a marca. ([`23-portal-login.png`](./assets/23-portal-login.png)) | V, C | Adicionar mailto/WhatsApp de suporte no card ("Problemas para acessar? fale com…") + logo. Reset de senha self-service pode vir depois. |
| 7 | **Cotação USD/CNY falha em silêncio:** topo mostra `R$ —` sem explicação quando a API do BCB falha (CORS/fora do ar). Valores de demurrage dependem dessa taxa — o operador precisa saber que está desatualizada. | C | Tooltip/badge "cotação indisponível — usando última conhecida" + retry; cachear última cotação válida em localStorage. |

### P2

| # | Issue | Eixo | Fix |
|---|---|---|---|
| 8 | Tabela de Manifestos corta a coluna de ações ("Abrir B…") já em 1440px ([`04-manifestos.png`](./assets/04-manifestos.png)). | V | Congelar coluna de ações (`position: sticky; right: 0`) ou priorizar colunas (CE Mercante pode truncar). |
| 9 | Inputs de data nativos exibem `mm/dd/yyyy` (Relatórios, Taxas Locais) num produto pt-BR. | E | `lang="pt-BR"` no `<html>` já ajuda; para consistência real, usar input com máscara dd/mm/aaaa. |
| 10 | KPI "PODs sem tabela de cobrança" exibe permanentemente "–" (valor nunca é calculado — hardcoded em `Painel.tsx:237`). Parece quebrado. | C | Calcular de fato (PODs distintos das viagens ativas sem charge_table ativa) ou remover o card até existir. |
| 11 | Labels EN em formulários PT: "MANUAL ONLY", "SORT ORDER" (Taxas Locais), "Other Charges manuais" (detalhe da fatura), "Invoices draft (USD)" (Demurrage). | E | Renomear: "Apenas manual", "Ordem", "Outras cobranças (manuais)", "Faturas rascunho (USD)". |
| 12 | Página Carga Solta intitula-se "Manifestos BB" — o menu diz "Carga Solta", o glossário do domínio usa BB = break-bulk. Mesma coisa, três nomes. | E | Unificar: título "Carga Solta (BB)". |
| 13 | Veículos abre com KPIs zerados e tabela vazia até selecionar navio+viagem; parece sistema sem dados ([`07-veiculos.png`](./assets/07-veiculos.png)). | E, V | Estado vazio dedicado: "Selecione um navio para ver os veículos" no corpo, em vez de KPIs `0`. |
| 14 | Detalhe da fatura: tabela de B/L mostra "Subtotal R$ 0,00" enquanto os itens abaixo somam R$ 3.005 — leitura contraditória para quem confere valores ([`28-fatura-detalhes.png`](./assets/28-fatura-detalhes.png)). | C | Exibir o subtotal real do B/L ou ocultar a coluna quando não aplicável. |
| 15 | Números sem formatação pt-BR no B/L: peso `62300.000` (deveria ser `62.300,000`) ([`08-bl-detalhe.png`](./assets/08-bl-detalhe.png)). | E | Usar `formatNumber` pt-BR nos campos read-only. |
| 16 | TV Line-Up trunca nomes de navio ("OSCO SHIPPING ARIE") — numa TV de terminal, o nome do navio é o dado principal ([`21-lineup-tv-display.png`](./assets/21-lineup-tv-display.png)). | E | Reduzir min-width das colunas numéricas e permitir wrap do nome, ou fonte condensada. |
| 17 | Alertas não linkam para a entidade: "Fatura FAT-2026-0016 vencida" obriga navegação manual até Faturamento (só `portal_invoice_created` tem link hoje). | V | Reusar o padrão de link existente para `invoice_overdue` (→ `/faturamento?invoice=`) e demurrage (→ `/demurrage?busca=container`). |
| 18 | Texto repetido 7× "Considera os filtros ativos desta tela." sob cada KPI chip (Manifestos, Containers…) — ruído visual que empurra a tabela para baixo. | E | Uma única nota na linha dos chips, ou tooltip. |

### P3

| # | Issue | Eixo | Fix |
|---|---|---|---|
| 19 | Página Viagens: cada viagem é um bloco de ~1100px (planejamento + 4 cards + 3 acordeões) — 3 viagens = 3400px de scroll. Encontrar uma viagem específica é lento. | V | Modo lista compacta (uma linha por viagem, expande ao clicar). |
| 20 | Demurrage: um card por B/L com header de tabela repetido (15 containers = 3153px). | V | Tabela única com agrupamento visual por B/L. |
| 21 | Formulários "Nova tabela"/"Novo item" ocupam permanentemente o topo de Taxas Locais, antes da lista. | V | Colapsar atrás de botão "+ Nova tabela". |
| 22 | Chip "ADMIN (LEGADO)" exposto na UI de usuários — vocabulário de migração interna visível. | C | Migrar os 2 perfis legados e remover os labels, ou mostrar apenas o perfil efetivo. |
| 23 | Commit hash no topo de toda tela (`23b022d`) — útil para suporte, ruído para operador. | — | Mover para o menu do usuário ou rodapé do Admin. |
| 24 | Realtime: tela aberta longa não tem indicação de dados obsoletos além do "Atualizado HH:MM" pequeno no Painel. | C | Destacar "Atualizado há X min" quando > 10 min. |

---

## Dimensões avaliadas

- **Primeiras impressões:** Login interno transmite seriedade (marca, descrição do sistema, copy "credenciais provisionadas pelo administrador"). Painel responde "o que está acontecendo no porto agora" em 5s. **Bom.**
- **Navegação:** top-nav com 8 itens agrupados (Importação/Exportação/Financeiro como dropdowns), badges de pendência por grupo, breadcrumb no detalhe, "Voltar aos…" contextual. KPI cards todos clicáveis. **Bom** — só falta link nas entidades dos alertas (#17).
- **Hierarquia visual:** ação primária consistentemente destacada (azul, canto sup. direito). Falha pontual: destrutivas com peso de secundárias (#4).
- **Consistência de componentes:** alta (mesmo Card/Badge/Tabela/FilterBar em todo lugar) — o problema é consistência de *conteúdo* (códigos crus, idioma — #3, #11).
- **Loading / vazio / erro:** loading "Carregando tela…" ok; vazios **excelentes** (ícone + instrução + ação, ex. [`18-embarquevazios-empty.png`](./assets/18-embarquevazios-empty.png)); erros são o ponto fraco (#1, #2).
- **Sinais de confiança:** trilha de auditoria, justificativa obrigatória, versão/ambiente no Admin, bloqueio de fatura para cliente inadimplente (trigger do banco). **Bom** — minado pelos itens silenciosos (#1, #7, #10, #14).
- **Caminhos de conversão:** funil completo (manifesto→revisão→taxas→fatura→PIX) é alcançável sem docs; atalhos "Vincular em Revisão"/"Ver em Taxas Locais" nos KPIs são exemplares. Atritos: #8, #13, #17.
- **Mobile (390px):** header colapsa em hamburger, cards empilham, tabelas largas têm scroll horizontal ([`44-mobile-manifestos-table.png`](./assets/44-mobile-manifestos-table.png)). Única quebra real era o quadro Line-Up — **corrigida**.

---

## Top 5 — issues que mais machucam a conclusão de tarefa (conversão)

1. **#1 Falhas silenciosas de dados** — trabalho não faturado sem ninguém perceber; é perda direta de receita.
2. **#2 Error boundary sem saída** — um erro qualquer encerra a sessão de trabalho do operador.
3. **#6 Portal sem recuperação de acesso** — cliente bloqueado não paga fatura.
4. **#17 Alertas sem link** — o sistema sabe o que precisa de ação mas não leva o usuário até lá.
5. **#8 Coluna de ações cortada em Manifestos** — o botão "Abrir B/L" (porta de entrada do fluxo de revisão) exige scroll horizontal não-óbvio em monitor comum.

## Top 5 — quick wins (resolvíveis hoje)

1. **#3 Consolidar labels de status PT** — mapa único, ~1h, elimina o problema mais visível do produto. (Parcialmente feito nesta auditoria: Alertas + chips do B/L.)
2. **#5 Legenda/tooltips no quadro Line-Up** — uma linha de legenda.
3. **#11/#12 Renomear labels EN e unificar "Carga Solta (BB)"** — só copy.
4. **#18 Remover texto repetido dos KPI chips** — só copy.
5. **#10 Remover/computar o KPI "PODs sem tabela"** — hoje só transmite "isso está quebrado".

---

## Como esta auditoria rodou (reproduzir)

O ambiente remoto não alcança `*.supabase.co`, então o site rodou contra um stack local: Postgres 16 + as 97 migrations do repo + seed sintético + um shim Node que emula o subset de PostgREST/GoTrue que o app usa (`sb-shim.cjs`), atrás do proxy `/sb-proxy` do Vite. Nenhum dado de produção foi copiado. O fluxo completo está automatizado na skill **`design-audit`** (`.claude/skills/design-audit/`) — rode-a após cada release para regerar screenshots e re-checar esta lista.

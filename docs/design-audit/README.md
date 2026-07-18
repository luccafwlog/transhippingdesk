# Auditoria de design — Transhipping Desk

- **Data:** 2026-07-17
- **Commit base:** `8f141e1`
- **Método:** app real bootada contra stack local (Postgres 16 + `scripts/design-audit/bootstrap.sql` + 204 migrations + seeds sintéticos + `sb-shim.cjs`), navegada via Playwright em 1440×900 (desktop) e 390×844 (mobile). Screenshots em [`assets/`](assets/). Login `auditor@local.test` (admin).
- **Escopo:** todas as rotas do app interno + tela TV + logins do portal, avaliadas como um usuário de primeiro dia: dá para **entender**, **confiar** e **completar o fluxo** manifesto → revisão → taxas → fatura sem documentação?

Artefatos de ambiente que **não** são bugs do produto: Google Fonts e API PTAX
do BCB bloqueados pelo proxy de egress (aviso "Câmbio indisponível" no topo é o
comportamento correto), websockets realtime falham contra o shim.

## Corrigido nesta auditoria

| # | Problema | Eixo | Fix | Evidência |
|---|---|---|---|---|
| 1 | `/manifestos`: a coluna sticky **Ações** cobria a coluna **Invoice** em 1440px (tabela 1488px num wrapper de 1382px) — o link `FAT-2026-0018` renderizava como "F" e o header como "II". O link da fatura é o elo B/L→cobrança do fluxo principal. | Conversão | Truncate com tooltip em Navio/Viagem e CNEE (`app-table__truncate--sm`) + paddings `px-4→px-3` nas colunas estreitas de `src/pages/Manifestos.tsx`. Tabela agora cabe em 1440px; telas menores mantêm o scroll com sombra/hint. | antes [`manifestos-desktop.png`](assets/manifestos-desktop.png) · depois [`manifestos-desktop-fixed.png`](assets/manifestos-desktop-fixed.png) |
| 2 | `/line-up-tv/display`: status "Aguardando" clipava horizontalmente ("Aguardandc") na coluna CEs — inclusive na resolução alvo de TV (fonte 24px ≈ 150px numa coluna de 6% ≈ 115px em 1920px). | Entendimento | Coluna CEs de 6%→8% (folga existente no `colgroup` de `src/components/lineup/LineUpTable.tsx`) + fonte 24px→20px em `.app-lineup-display-status` (`src/index.css`). | antes [`line-up-tv-desktop.png`](assets/line-up-tv-desktop.png) · depois [`line-up-tv-desktop-fixed.png`](assets/line-up-tv-desktop-fixed.png) |
| 3 | Mobile (≤1024px): todo `PageHeader` abria ~200px de espaço morto entre título, descrição e ações — o `flex-basis: 340px` de `.page-header__copy` vira **altura mínima** quando o header muda para `flex-direction: column`. | Entendimento | `flex-basis: auto` no breakpoint (`src/index.css`). | antes [`painel-mobile.png`](assets/painel-mobile.png) · depois [`painel-mobile-fixed.png`](assets/painel-mobile-fixed.png) |
| 4 | Modal Nova Viagem: "exibicao" sem acento. | Confiança | Copy fix em `src/components/shared/VoyageCreateModal.tsx`. | [`viagens-nova-modal-desktop.png`](assets/viagens-nova-modal-desktop.png) |
| 5 | `/reconciliacao`: "extrato PIX do Itau" sem acento. | Confiança | Copy fix em `src/pages/Reconciliacao.tsx`. | [`reconciliacao-desktop.png`](assets/reconciliacao-desktop.png) |

Verificação após os fixes: `npx tsc -b`, `npm run lint`, `npm test`
(1092 passed), `npm run docs:check`, `npm run build` — todos verdes; páginas
re-screenshotadas (evidência "depois" acima). **Runtime**.

## Pendências priorizadas

### P0 — bloqueia o fluxo

Nenhum P0 encontrado. O fluxo core (manifesto → revisão → taxas → fatura) é
completável de ponta a ponta com a UI atual. **Runtime**.

### P1 — atrito alto no fluxo core

Nenhum P1 remanescente — o único achado P1 (Invoice coberta em `/manifestos`)
foi corrigido nesta auditoria.

### P2 — atrito moderado

| Problema | Eixo | Recomendação |
|---|---|---|
| `/viagens`: a lista master é um rail colapsado de pontos coloridos sem nomes; só expande no hover ("Passe o mouse para expandir"). No primeiro uso não se vê quais viagens existem, e o overlay expandido cobre o título do detalhe ([`viagens-desktop.png`](assets/viagens-desktop.png), [`viagens-detail-desktop.png`](assets/viagens-detail-desktop.png)). | Entendimento | Rail expandido por padrão em telas ≥1280px (há espaço), colapsável manualmente; sem hover em touch o rail é inoperável. |
| `/relatorios`: inputs `type="date"` nativos exibem `mm/dd/yyyy` quando o navegador está em locale EN ([`relatorios-desktop.png`](assets/relatorios-desktop.png)). `lang="pt-BR"` já está no `<html>`; o formato segue o locale do navegador, não o atributo. | Confiança | Aceitável para uso interno; se incomodar, trocar por um datepicker próprio ou exibir hint `dd/mm/aaaa` ao lado. **Suspeita** (depende do navegador do usuário). |
| Ações destrutivas em tabelas (lixeira em `/demurrage/taxas`, `/viagens` detalhe) têm o mesmo peso visual das ações neutras (lápis) ([`demurrage-taxas-desktop.png`](assets/demurrage-taxas-desktop.png)). | Confiança | Tom vermelho no ícone/hover da lixeira. Não tocado por envolver delete flows (fora do escopo seguro desta auditoria). |

### P3 — polimento

| Problema | Eixo | Recomendação |
|---|---|---|
| `/manifestos/:blId`: campos Peso total (kg) `48500` e CBM `112.5` sem formatação pt-BR, enquanto a tabela de containers logo abaixo formata certo (`24.250 kg`, `56,2`) ([`manifesto-bl-detail-desktop.png`](assets/manifesto-bl-detail-desktop.png)). | Confiança | Formatar exibição com `Intl.NumberFormat('pt-BR')` mantendo edição raw. |
| Modal "Detalhe da invoice" mistura "invoice" (EN) com "fatura" (PT) usado na listagem ([`faturamento-detalhes-modal.png`](assets/faturamento-detalhes-modal.png)). "Invoice" é termo de domínio aceito (`CONTEXT.md`), mas o título alterna entre os dois na mesma tela. | Entendimento | Padronizar o título do modal ("Detalhe da fatura FAT-…"). |
| `/carga-solta`: cards e headers "MAQUINAS" sem acento ([`carga-solta-desktop.png`](assets/carga-solta-desktop.png)). | Confiança | Copy fix "Máquinas". |
| `/admin/usuarios`: card "Ambiente: Produção" exibido mesmo em stack local ([`admin-usuarios-desktop.png`](assets/admin-usuarios-desktop.png)). | Confiança | Ler o ambiente de env/config em vez de fixo. **Suspeita** (não confirmado se vem de config). |

## Resumo por dimensão

| Dimensão | Avaliação |
|---|---|
| Primeira impressão | Forte. Login limpo, identidade consistente (navy/gold), tipografia display própria. |
| Navegação | Boa. Navbar por domínio (Importação/Exportação/Financeiro) com badges de pendência; breadcrumbs nos detalhes. Exceção: rail de `/viagens` (P2). |
| Hierarquia visual | Boa. KPI cards → filtros → tabela em todas as listas; padrão consistente. |
| Consistência de componentes | Boa. Badges, filtros, paginação e empty states compartilhados. Tabelas densas com sticky actions. |
| Loading/empty/error | Muito boa. Empty states orientados a ação em todas as telas visitadas; erro de login claro; aviso global de PTAX indisponível com retry. |
| Sinais de confiança | Bons. Pills de estado no B/L (Revisão/Cliente/Taxas/Financeiro), aviso "taxas recalculadas — fatura pode estar desatualizada", trilha de auditoria visível. Enfraquecidos por acentos faltando e formatação numérica inconsistente (P3s). |
| Caminho de conversão | Completo. Manifesto → revisão (fila com ações inline) → taxas (status por B/L) → fatura (link direto na tabela, agora visível) → conciliação. |

Consoles limpos em todas as rotas visitadas (apenas artefatos de ambiente:
PTAX bloqueado). Nenhuma falha silenciosa de query observada no log do shim.
**Runtime**.

## Top 5 — impacto em conversão

1. ~~Coluna Invoice coberta em `/manifestos`~~ — **corrigido** (era o elo visível B/L→fatura).
2. Rail de `/viagens` colapsado por padrão esconde o inventário de viagens (P2).
3. Lixeiras com peso visual de ação neutra em telas de tarifas (P2).
4. Formatação numérica inconsistente no detalhe do B/L (P3 — mina confiança em números que viram fatura).
5. Título "Detalhe da invoice" vs "fatura" (P3 — vocabulário do fluxo de cobrança).

## Top 5 — quick wins

1. ~~"Aguardando" clipado na TV~~ — **corrigido**.
2. ~~Espaço morto do PageHeader no mobile~~ — **corrigido**.
3. ~~Acentos ("exibição", "Itaú")~~ — **corrigidos**.
4. "MAQUINAS" → "Máquinas" em `/carga-solta` (copy de uma linha).
5. `Intl.NumberFormat('pt-BR')` nos campos de peso/CBM do detalhe do B/L.

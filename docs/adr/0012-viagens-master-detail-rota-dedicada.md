# 0012 — Página Viagens em master-detail com rota dedicada por viagem

Status: aceito — 2026-06-16 · **implementado** (rota `/viagens/:voyageId` ativa; ver [modules/viagens.md](../modules/viagens.md))

## Contexto

A página Viagens lista cada viagem como um card que, ao expandir ("Detalhes"), revela inline todo o conteúdo: planejamento POD/POL, cards de módulo e três acordeões (Importação, Exportação, Origem e Manifestos). Mesmo após a redução para o modo compacto (design-audit #19), um card expandido ainda produz blocos altos e só é possível analisar uma viagem por vez de forma confortável.

O conteúdo da viagem cresceu além de um resumo: passa a abrigar métricas de importação segmentadas por POD de descarga, métricas de exportação por terminal de embarque, detalhamento de manifestos com estado de conciliação, dados do Sistema Mercante (Número de Escala, CE Master) e uma linha do tempo de eventos. Empilhar tudo isso inline, dentro de um item de lista, não escala.

Além disso, outras telas (Painel, Alertas, Financeiro) precisam apontar para uma viagem específica, e hoje não há um endereço estável para isso.

## Decisão

Adotar um layout master-detail para Viagens, com o detalhe vivendo em uma **rota dedicada `/viagens/:id`**, seguindo o padrão de rotas do ADR 0003 (`App.tsx` como mapa canônico, `lazyPage()`).

- À esquerda, um **rail** compacto lista as viagens (busca, status, rota, estado de conciliação) e funciona como navegação.
- À direita, o **detalhe da viagem** abre em `/viagens/:id`, organizado em abas: Visão geral, Importação, Exportação, Escalas & Manifestos.
- O detalhe é deep-linkável: Painel, Alertas e Financeiro podem linkar direto para uma viagem.

A lista-de-cards inline deixa de ser o paradigma desta página.

## Alternativas consideradas

- **Manter card expansível inline, apenas reorganizando o conteúdo interno.** Menor mudança e menor risco, mas preserva o problema de altura quando expandido e não resolve o deep-link.
- **Rail + detalhe sem rota (estado local).** Mantém o foco numa viagem por vez, mas não oferece endereço estável para deep-link de outras telas.

## Consequências

- **Positivas**: foco numa viagem por vez sem scroll gigante; endereço estável e compartilhável por viagem; espaço para o conteúdo crescer (abas) sem inflar a lista; navegação rápida pelo rail.
- **Negativas / custos**: perde-se a varredura de várias viagens lado a lado (mitigado pelo rail com sinais de status); foge do padrão lista-de-cards usado em outras telas, criando uma exceção visual a ser justificada; exige tratar estados de rota inválida (`/viagens/:id` inexistente) e a responsividade do par rail+detalhe (desktop-first; em telas estreitas o rail vira lista de tela cheia e o detalhe ocupa a viewport).

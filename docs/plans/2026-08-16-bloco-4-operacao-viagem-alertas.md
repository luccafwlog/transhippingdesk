# Bloco 4 — Operação e Viagem: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implementar os contratos funcionais do Bloco 4 para BL, Baplie, CE
Mercante e exportação, preservando os eventos nulos e sem duplicar os ADRs do
#524.

**Architecture:** A fundação transversal #517 fornece catálogo de gravidade,
detecção server-only, estado de dispensa/revisão e fan-out de Notificações.
BL, Baplie e CE usam unidade viagem; exportação pós-ATD usa unidade escala.
Os detectores usam tabelas existentes e não criam uma linha por container ou BL.

**Tech Stack:** React/TypeScript, Supabase PostgreSQL/RPCs, migrations,
TanStack Query, Vitest e testes de contrato SQL.

---

## Pré-condições bloqueantes

### Task 0: liberar a fundação transversal

**Files:**

- Read: plano central de alertas na PR #517
- Read: ADR 0034
- Read: schema atual de viagem, escala, BL, Baplie e alerts
- Read: src/services/baplieReconciliation.ts
- Read: migrations de alertas e migration 271

- [ ] **Step 1: Confirmar merge da PR #517 e disponibilidade de E1/E2/E3.**

Se a PR não estiver mergeada, manter o trabalho de implementação BLOCKED.

- [ ] **Step 2: Confirmar o ponto server-only dos detectores.**

Não criar cron client-side, não depender de auth.uid de uma tela e não duplicar o
produtor do #517.

- [ ] **Step 3: Confirmar tabelas e próxima migration.**

Localizar as tabelas de viagem/escala e validar o contrato de alerts antes de
escolher qualquer nome de coluna, enum, RPC ou número de migration.

## Modelo de dados e configuração

### Task 1: adicionar primeiro porto brasileiro externo e ETA

**Files:**

- Modify: tabela/RPC existente de viagem ou programação, após inspeção do schema
- Modify: modal de viagem
- Test: comportamento do modal e contrato SQL

- [ ] **Step 1: Persistir porto e ETA externo no agregado correto.**

O dado é uma âncora de prazo da viagem, não uma escala operacional. Deve ser
opcional, auditável e representar o primeiro porto brasileiro não atendido pela
empresa.

- [ ] **Step 2: Validar POD e precedência.**

Bloquear sem POD, bloquear ETA externo que não seja anterior ao primeiro ETA
próprio e bloquear mudança do ETA próprio que o torne anterior ao externo.

- [ ] **Step 3: Implementar suspensão e retomada.**

Remover POD preserva ETA externo e suspende alertas de importação. Recolocar POD
reativa a âncora e recalcula D−7/D−5.

- [ ] **Step 4: Auditar alterações.**

Alterações entram na timeline e só re-notificam se abrirem ou reabrirem
condições.

### Task 2: adicionar tipo esperado de exportação na escala

**Files:**

- Modify: tabela/RPC existente de escala/schedule, após inspeção do schema
- Modify: modal da escala
- Test: comportamento do modal e contrato SQL

- [ ] **Step 1: Persistir valor controlado.**

Valores funcionais: somente granito, somente vazios ou ambos. Bloquear
salvamento de escala com exportação sem o tipo.

- [ ] **Step 2: Permitir escala mista sem POD.**

Exportação continua ativa; importação fica suspensa até existir POD.

- [ ] **Step 3: Recalcular após alteração.**

Mudança de tipo recalcula imediatamente a pendência pós-ATD e registra a
alteração.

### Task 3: completar modelo comum de alertas e dispensa

**Files:**

- Modify: contrato/migration comum da PR #517, somente se necessário
- Modify: serviços centrais de alertas/notificações
- Test: contrato SQL e testes de fechamento

- [ ] **Step 1: Registrar tipos funcionais.**

Registrar BL por cobertura POL/POD, Baplie ausente, cobertura documental
Baplie/BL, CE ausente e exportação pós-ATD.

- [ ] **Step 2: Persistir estado distinto de dispensa.**

Guardar motivo, usuário, data/hora, revisão e histórico. Mostrar dispensados em
filtros de exceção.

- [ ] **Step 3: Implementar vencimento da revisão.**

BL/Baplie/CE não podem ter revisão posterior ao primeiro ETA. Exportação exige
data futura sem limite máximo específico. Na revisão vencida, reabrir e
notificar se a condição persistir.

## Detectores

### Task 4: detector preliminar de BL por POL/POD

**Files:**

- Create/modify: detector server-only do #517
- Create/modify: migration/RPC idempotente após validação do schema
- Test: contrato SQL e testes de cobertura POL/POD

- [ ] **Step 1: Calcular expectativa de viagem.**

Usar POLs e PODs vinculados por Chegadas e Saídas ou manualmente. Cobrir cada
origem e destino individualmente; não exigir todas as combinações.

- [ ] **Step 2: Abrir alerta crítico no D−7.**

Abrir um alerta por viagem e notificar Documentação. Sem POL, mas com POD,
abrir no D−7 e fechar com o primeiro BL.

- [ ] **Step 3: Reavaliar ações materiais.**

Importação/associação/remoção de BL e inclusão/remoção de POL/POD recalculam
imediatamente. Remoção reabre; remoção da expectativa retira o item.

### Task 5: detector de Baplie ausente

**Files:**

- Modify: detector server-only do #517
- Test: contrato SQL para viagens de importação, mistas e somente exportação

- [ ] **Step 1: Abrir alerta crítico por viagem no D−7.**

Se houver qualquer escala de importação/mista, exigir Baplie. Somente
exportação não entra.

- [ ] **Step 2: Fechar e reabrir por estado de importação.**

Importação válida fecha; invalidação/remoção reabre e notifica. Falha da ação
de importação fica como feedback imediato.

### Task 6: detector de cobertura documental Baplie/BL

**Files:**

- Modify: src/services/baplieReconciliation.ts
- Modify: detector server-only do #517
- Create/modify: migration/RPC idempotente após validação do schema
- Test: testes de reconciliação e cobertura de rota
- Test: contrato SQL do ciclo de alerta

- [ ] **Step 1: Definir correspondência exata.**

Uma rota é confrontável quando há BL com containers vinculados para o par exato
POL → POD. O detector não compara Baplie diretamente com Chegadas e Saídas.

- [ ] **Step 2: Abrir imediatamente com cobertura completa.**

Quando todas as rotas estiverem confrontáveis e houver divergência de existência,
abrir alerta crítico por viagem, notificar genericamente Documentação e apontar
para Baplie.

- [ ] **Step 3: Forçar checagem em D−7.**

Mesmo com rotas sem BL, inserir rotas sem cobertura e divergências das rotas
confrontáveis no mesmo alerta. Esta é a exceção explícita à exigência absoluta
de source=reconciled.

- [ ] **Step 4: Fechar e criar ciclos.**

Fechar somente com todas as rotas cobertas por BL com containers e sem
divergência. Atualização do alerta aberto não notifica novamente; recorrência
após fechamento cria novo ciclo.

- [ ] **Step 5: Não alertar flags físicas nem granularidade indevida.**

Não criar alertas por container, BL ou flag IMO/OOG.

### Task 7: detector de CE Mercante

**Files:**

- Modify: detector server-only do #517
- Modify: serviço de associação de CE se necessário
- Test: contrato SQL e reabertura

- [ ] **Step 1: Abrir no D−5 por viagem.**

Considerar apenas BLs de importação/POD. Sem BL, não abrir CE.

- [ ] **Step 2: Fechar/reabrir por estado dos BLs.**

Fechar quando todos os BLs de importação existentes tiverem CE. BL novo sem
CE, remoção de CE ou nova pendência reabre e notifica.

### Task 8: detector pós-ATD de exportação

**Files:**

- Modify: detector server-only do #517
- Modify: serviço de escala/embarque se necessário
- Test: comportamento por tipo e contrato SQL

- [ ] **Step 1: Abrir no ATD confirmado por escala.**

Escala com exportação abre alerta normal para Equipamentos se faltar qualquer
tipo configurado.

- [ ] **Step 2: Aplicar tipos esperados.**

Granito exige granito; vazios exige vazio; ambos exigem os dois. Tipo não
esperado não mantém o alerta aberto.

- [ ] **Step 3: Fechar/reabrir.**

Fechar quando os tipos esperados tiverem vínculo; remoção reabre e notifica.
Destino é a viagem com escala selecionada.

## Reavaliação, navegação e não duplicação

### Task 9: reavaliar ações materiais

**Files:**

- Modify: serviços de importação/associação de BL
- Modify: serviço de importação/reprocessamento Baplie
- Modify: gravação de POD, POL, ETA e tipo de exportação
- Test: fluxos de reavaliação imediata

- [ ] **Step 1: Disparar reavaliação sem depender do render.**

BL, Baplie, POD, POL, ETA e tipo de exportação devem chamar o detector ou
invalidar o mecanismo central previsto no #517.

- [ ] **Step 2: Provar coexistência.**

BL, ausência Baplie, cobertura Baplie/BL e CE têm ciclos independentes. Se dois
eventos abrirem simultaneamente, cada um gera sua própria notificação.

### Task 10: destinos compartilhados

**Files:**

- Modify: roteador compartilhado da ADR 0034
- Modify: telas somente para consumir filtro/seleção
- Test: comportamento de links e filtros

- [ ] **Step 1: Mapear unidades.**

BL e CE abrem /viagens/:voyageId. Ausência e cobertura Baplie abrem
/baplie?voyage=<id>. Exportação abre a viagem com a escala selecionada.

- [ ] **Step 2: Não criar produtores nas páginas.**

Mensagens de ausência, preview, erro de planilha, depot e
awaiting_route_coverage continuam sendo estado ou feedback, não chamadas de
alerts.

## Verificação

### Task 11: testes e gates

**Files:**

- Test: Baplie, importação, Chegadas e Saídas, vazios e alertas

- [ ] **Step 1: Rodar testes focados.**

    npm test -- --run src/services/__tests__/baplieReconciliation.test.ts src/services/__tests__/baplieRouteCoverage.test.ts src/pages/__tests__/ChegadasSaidas.behavior.test.tsx

- [ ] **Step 2: Rodar gates completos.**

    npm run docs:check
    npm run lint
    npm test
    npm run build

- [ ] **Step 3: Validar contratos SQL.**

Provar abertura idempotente, D−7, cobertura POL/POD, Baplie normal e forçado,
CE apenas para importação, exportação por escala, fechamento automático,
dispensa/revisão e novos ciclos.

## Handoff

Depois do merge desta documentação e da liberação das dependências, abrir PR de
implementação separada com:

    PR type: implementation
    Part of #519
    Closes #523

Não encerrar #523 nesta PR documental. A issue só deve ser encerrada depois da
implementação e verificação completa.


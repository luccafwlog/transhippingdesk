# Correções pós-implementação do Agency Departure Report

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans para implementar este plano task a task. Steps usam checkboxes (`- [ ]`).

**Goal:** Corrigir os achados da revisão pós-merge dos commits `83e2ef7`,
`d976e21` e `8d722ec` (fechamento com snapshot, impressão e documentação do
Agency Departure Report), levando a entrega ao contrato definido na spec
arquivada `docs/archive/specs/2026-07-19-agency-departure-report-design.md` e
na ADR 0027.

**Contexto da revisão:** a implementação está em `main` (PR #407); os testes
direcionados (`VoyageAgencyReportTab.test.tsx`, `agencyReportMigration.test.ts`,
`agencyReportPendingAlertsMigration.test.ts`), `npm run docs:check` e o ciclo
de vida de planos/specs estão corretos. Os achados abaixo são o que restou.

**Regras transversais:**

- `src/types/database.ts` é arquivo protegido: tasks que o alteram exigem
  autorização explícita do usuário antes do edit.
- Migrations numeradas sequenciais (ADR 0016); a Task 2 usa a próxima livre
  (hoje `217`). **Não** editar `213`/`214` — após a aplicação remota da Task 0
  elas passam a ser imutáveis.
- Cada task termina com commit. Antes do push final:
  `npm run docs:check && npm run lint && npm test && npm run build`.

---

## Task 0 — P0 · Migrations 211–216 não aplicadas no projeto remoto

**Achado:** `main` contém as migrations `211`–`216` (hardening RBAC de
Equipamentos, agregado do ADR, fechamento/alertas, RBAC de
viagens/clientes, RPC de recebíveis), mas o projeto Supabase remoto
(`fgmkhbzhaeebrsizwccx`) tem histórico aplicado só até a `210`
(verificado via `list_migrations` em 2026-07-20). Consequências enquanto
persistir: a aba ADR quebra em produção (tabelas e RPCs inexistentes), o
hardening de `is_active_user()`/Equipamentos (211/212) não está em vigor e o
papel `equipamentos` criado pela `210` opera sem as restrições planejadas.

**Fix:**

- [ ] Verificar a execução da integração GitHub do Supabase para o merge do
      PR #407 (WORKFLOW.md §5: migrations chegam ao remoto por essa
      integração no merge em `main`; **não** usar `apply_migration` do MCP,
      que grava versão timestamp e quebra a checagem de branching).
- [ ] Se a integração falhou/não rodou, destravar e reexecutar; confirmar com
      `list_migrations` que o histórico remoto termina em `216`.
- [ ] Smoke test em produção: abrir a aba ADR de uma viagem com escala,
      registrar terminal e um sign-off.

**Verify:** `list_migrations` termina em `216`; aba ADR funcional no remoto.

## Task 1 — P1 · Seção “Carga solta” nunca derivada e ausente do snapshot

**Achado:** `VoyageAgencyReportTab.tsx:174` renderiza `<EmptyData />`
incondicionalmente para “Carga solta”; o snapshot de fechamento
(`VoyageAgencyReportTab.tsx:118-131`) não tem chave para o bloco; e
`AgencyReportDocument.tsx` lê `sections.cargaCarregada`, chave que nunca é
escrita — o documento fechado imprime “—” para sempre. A spec manda derivar
dos campos BB dos B/Ls do porto (máquinas, packages, ton, cbm); o plano
original omitiu a task de derivação (gap de plano que vazou para o código).

**Fix:**

- [ ] Em `agencyDepartureReport.ts`, derivar carga solta dos campos BB dos
      B/Ls com POD = porto da escala (mesma fonte usada pelo módulo
      Breakbulk), agregando máquinas, packages, ton e cbm.
- [ ] Renderizar o bloco na aba e incluir a agregação no snapshot com a chave
      lida pelo documento (`cargaSolta` — renomear a leitura em
      `AgencyReportDocument.tsx` junto, deixando chave única e consistente).
- [ ] Teste: agregação BB por porto + snapshot contém o bloco.

**Verify:** aba mostra carga solta quando há B/Ls BB; snapshot fechado imprime
os valores; Vitest do componente e do serviço verdes.

## Task 2 — P1 · Fidelidade do documento fechado/impresso ao modelo real

**Achado:** o plano exigia `AgencyReportDocument.tsx` no padrão de
`InvoiceDocumentKit.tsx`, com os blocos no layout do modelo real. O
implementado é um achatador genérico (`value()`): matrizes viram
`"20DC: carga_geral: 3 · …"`, arrays viram `"N registro(s)"`, e o modo
fechado da aba perde detalhes que o modo aberto mostra. Faltam no
documento: matrizes como tabelas, agregados de granito (ton/blocos), local
de desova por marca, OS/embarque direto/depots, ATB/restow do cabeçalho e o
autor do fechamento (spec: “fechado mostra data/autor”).

**Fix:**

- [ ] Reescrever `AgencyReportDocument.tsx` no padrão `InvoiceDocumentKit`
      com blocos na ordem do modelo real (cabeçalho, carga solta, granito,
      matriz de descarga, vazios descarregados, veículos com local de desova,
      embarque de vazios com OS/embarque direto/depots, serviço extra,
      storage, overtime, ocorrências), rendendo matrizes como tabelas.
- [ ] Enriquecer o snapshot com os derivados que o documento precisa e hoje
      ficam de fora: local de desova por marca (`vehicleLocations`), depots,
      contagem de embarque direto (todos calculados na aba mas não
      congelados).
- [ ] Exibir autor do fechamento (`closed_by` resolvido para nome) na barra
      “Fechado em …”.
- [ ] Teste de componente: estado fechado renderiza documento com matrizes e
      autor; snapshot congelado inclui os novos campos.

**Verify:** impressão espelha o modelo real; teste do estado fechado verde.

## Task 3 — P1 · Mapeamento seção × bloco divergente da spec

**Achado:** a spec mapeia “Carga solta” → seção `carga_descarregada`
(Documentação) e “Granito” → seção `carga_carregada` (Documentação). A aba
prendeu o chip de sign-off `carga_carregada` ao bloco “Carga solta”
(`VoyageAgencyReportTab.tsx:174`) e deixou “Granito (carga carregada)” sem
chip (`:175`). O sign-off de granito hoje não existe visualmente e o de
carga solta assina a seção errada.

**Fix:**

- [ ] Mover o chip `carga_carregada` para o bloco de Granito e agrupar
      “Carga solta” sob o sign-off `carga_descarregada` (ou como sub-bloco do
      card de descarga), seguindo a tabela “Blocos do relatório” da spec.
- [ ] Se preferirem manter o layout atual, registrar a exceção com nota
      editorial na ADR 0027 — decisão do usuário; padrão deste plano é
      seguir a spec.
- [ ] Ajustar teste do componente para o novo agrupamento.

**Verify:** cada chip de sign-off assina a seção que a spec atribui.

## Task 4 — P2 · RBAC do fechamento/reabertura mais frouxo no servidor que na UI

**Achado:** a UI só mostra “Reabrir” para admin
(`VoyageAgencyReportTab.tsx:149`), mas
`reopen_agency_departure_report` (migration `214`) aceita qualquer usuário
ativo não-equipamentos; `close_agency_departure_report` idem. Qualquer
usuário interno pode reabrir/fechar via RPC direta, contornando a intenção
da UI e enfraquecendo a estabilidade do snapshot congelado. As demais RPCs
do agregado validam papel (dono da seção ou administrativo) — o fechamento é
a exceção.

**Fix:**

- [ ] Nova migration (próximo número livre, hoje `217`): exigir
      `public.is_admin()` na reabertura e restringir o fechamento a
      `administrativo`/`operacoes` (mesmo padrão de
      `add_agency_report_occurrence`). Não editar a `214`.
- [ ] Esconder o botão “Fechar ADR” de papéis sem permissão de fechamento.
- [ ] Teste de contrato SQL da nova migration (padrão dos existentes).

**Verify:** RPC direta com papel não autorizado recebe `42501`; testes verdes.

## Task 5 — P2 · Snapshot aceito do cliente sem validação de forma

**Achado:** `close_agency_departure_report` valida apenas que
`p_snapshot.sections` é objeto; o conteúdo congelado — que vira o registro
estável do ADR — é o que o cliente mandar. Chamada direta à RPC pode
congelar JSON arbitrário. A derivação client-side é decisão da spec, mas a
forma do payload é verificável no servidor.

**Fix:**

- [ ] Na migration da Task 4, validar a forma do snapshot: presença das
      chaves de seção esperadas (`header`, `sections` com as chaves
      canônicas, `occurrences`, `signoffs`) e tamanho máximo razoável;
      rejeitar chaves de seção desconhecidas.
- [ ] Registrar na ADR 0027 (nota editorial) o risco residual aceito:
      conteúdo interno das seções continua derivado no cliente.

**Verify:** RPC rejeita snapshot sem as chaves canônicas; teste de contrato.

## Task 6 — P3 · Fechamento não invalida caches de alertas

**Achado:** `close_agency_departure_report` fecha os alertas
`agency_report_section_pending` no banco, mas `useCloseAgencyReport`
(`useAgencyReport.ts:48`) invalida só `['agency-report-own']` — `/alertas`,
contagens operacionais e Painel ficam obsoletos até refetch natural.

**Fix:**

- [ ] No `onSuccess` do close (e do reopen), invalidar também as famílias de
      alertas/contagens usadas por `useOperationalAlerts`/`useOperationalCounts`
      (seguir o padrão de invalidação existente nesses hooks).
- [ ] Teste do hook cobrindo as invalidações.

**Verify:** fechar ADR remove pendências de /alertas sem reload manual.

## Task 7 — P3 · Evidência incorreta na rastreabilidade

**Achado:** `docs/RASTREABILIDADE.md` cita `agencyReportClosingMigration.test.ts`
(linhas da rota ADR e da tabela do agregado) — o arquivo não existe; os testes
de fechamento vivem em `agencyReportMigration.test.ts` e os de alertas em
`agencyReportPendingAlertsMigration.test.ts`.

**Fix:**

- [ ] Corrigir as duas citações de evidência para os arquivos reais.
- [ ] `npm run docs:check`.

**Verify:** rastreabilidade cita apenas testes existentes.

## Task 8 — P3 · Cobertura de teste do estado fechado

**Achado:** nenhum teste renderiza o estado fechado da aba (documento,
botão Imprimir, gating admin do Reabrir, modal de justificativa). O único
teste novo cobre o clique em “Fechar ADR”.

**Fix:**

- [ ] Testes em `VoyageAgencyReportTab.test.tsx`: fechado renderiza
      documento e oculta seções editáveis; “Reabrir” só para admin;
      confirmação de reabertura exige justificativa não vazia.

**Verify:** Vitest verde com os novos casos.

## Nota sobre o PR #408

O PR #408 (nota de verificação no topo de `docs/RASTREABILIDADE.md`) registra
histórico datado em documento vivo — pela convenção, relatórios datados nascem
em `docs/archive/reports/`. Recomendação: fechar o PR #408 sem merge (a
verificação já está registrada no histórico do branch) ou movê-la para
`docs/archive/reports/`. A correção de evidência da Task 7 substitui o valor
informativo daquela nota.

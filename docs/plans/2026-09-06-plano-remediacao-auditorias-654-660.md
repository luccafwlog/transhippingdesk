# Remediação das auditorias #654–#660 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediar os riscos ainda presentes após a PR #661, com fronteiras financeiras e operacionais verificáveis, sem repetir correções entregues nem revogar decisões de domínio implicitamente.

**Architecture:** Preservar Page → Hook → Service → RPC/RLS e os domínios separados de Taxas Locais e Demurrage. Concentrar mudanças que precisam ser indivisíveis em RPCs; persistir efeitos recuperáveis na transação de origem e executá-los com idempotência, estados explícitos e auditoria. Evoluir schema e consumidores por expansão, migração e contração, mantendo snapshots financeiros e históricos append-only.

**Tech Stack:** React, TypeScript, TanStack Query, Zod, Vitest, PostgreSQL/Supabase, Deno Edge Functions, pg_cron/Vault, Resend, GitHub Actions e Vercel; versões conforme o lockfile e o workflow vigentes.

---

## 1. Resumo executivo e recomendação de ordem

**Estado deste documento: execução parcial em `codex/remediation-complete` (2026-09-07).** O plano continua aberto: a PR #669 foi usada como baseline e esta branch integra correções focais, mas os itens residuais permanecem tarefas obrigatórias. O histórico da auditoria e as decisões ainda não executadas não devem ser lidos como comportamento já entregue.

### 1.0 Registro de execução desta branch

As entregas desta etapa foram feitas no worktree isolado, preservando a ordem Page → Hook → Service → RPC/RLS:

- **S01–S02:** guards de RPC/entrada, revogação e validação de Preview já existentes foram preservados e cobertos por catálogo/testes (`2d23d2e6`, `e1120960`).
- **S03:** o parser Baplie passou a bloquear peso inválido, porto desconhecido/ausente e vazamento de contexto entre equipamentos, com testes focados.
- **S05:** efeitos pós-commit ganharam consumidor SQL server-only, retry/bloqueio, alerta persistente e runner agendado fail-closed (`025`–`026`). Granite/veículo sem consumidor completo continuam bloqueados.
- **S07:** eventos de email passaram a ser inbox durável, com claim, ordenação, retry, supressão, fallback e runner server-only (`022`).
- **S08–S09:** emissão de Demurrage passou a aceitar somente identidades no RPC autoritativo, gerar snapshot append-only e retirar cálculos/escritas financeiras do browser; falhas de PTAX abrem alerta persistente (`023`–`024`).
- **S11–S12:** a paridade de Inspeção ganhou os wrappers de billing paginado da migration `021`, com filtros, contagem, limites e isolamento; as listas operacionais usam projeções paginadas existentes e o Painel oferece janela incremental de viagens (`a851fbf4`, `b1444146`).
- **S13:** buscas operacionais têm debounce, as três listas principais distinguem offline sem cache de lista vazia, quatro confirmações nativas usam `ConfirmDialog`, e as tabelas/menus principais têm caption, semântica de menu e foco de teclado (`87a4d520`, `b417109d`, `b1444146`, `c58330eb`).
- **S14:** o checker executado de RPC passou a validar o catálogo ativo; documentação viva e rastreabilidade foram atualizadas (`1ff9e1bd`, `b1444146`).

Validação anterior do baseline está preservada no histórico abaixo. Nesta
integração, `npm test -- --run` passou com 557 arquivos, 2.942 testes aprovados
e 88 ignorados; typecheck, lint, build, `npm run docs:check` (214 Markdown/49
rotas), `npm run rpc:check` (168 RPCs), size-limit (195,19 kB brotlied) e
`git diff --check` também passaram. Os quatro testes locais opt-in de Postgres
passaram com 14 testes. Não foram publicados Edge Functions, preenchidos Vaults
ou ativados jobs remotos; Preview, gateway, Resend e BCB continuam evidências
externas pendentes.

### 1.1 Baseline e alcance da evidência

- **Código:** o baseline de `main` foi conferido no merge da PR #661 e a PR #669 foi adotada como baseline de integração. A árvore original estava limpa; nesta branch as migrations ativas relevantes incluem `009`–`013`, `015`–`026`. O arquivo histórico não é a definição final do banco.
- Fonte dos identificadores: [auditoria consolidada](../archive/audits/2026-09-06-auditoria-consolidada-prs-654-660.md). Preservar esse registro integralmente. Nas seções sem ID, usar o número e o título original; os sufixos deste plano apenas desdobram causas diferentes.
- Fontes de decisão: [CLAUDE.md](../../CLAUDE.md), [CONTEXT.md](../../CONTEXT.md), [WORKFLOW.md](../../WORKFLOW.md), [arquitetura](../ARCHITECTURE.md), [rastreabilidade](../RASTREABILIDADE.md), [convenções](../CONVENCOES.md) e [índice de ADRs](../adr/README.md).
- **Código** significa confirmação estática no baseline. **Teste de contrato SQL** significa inspeção textual de SQL; não prova execução, concorrência, grants efetivos ou PostgREST. Testes citados abaixo são existentes ou propostos, com essa distinção explícita; não foram executados para afirmar que uma remediação funciona.
- **Runtime histórico:** catálogo, volumetria e jobs citados na #659 pertencem à auditoria original. Não foi feita nova consulta ao banco de produção nesta sessão. Não presumir que a base continua vazia, que há exatamente 216 RPCs expostas ou que os volumes históricos representam a operação atual.
- **Runtime nesta sessão, somente leitura:** consulta ao GitHub confirmou a falha do Provision Preview Admin descrita em §1.3. Não foram criados usuário, PR, branch remota, job ou segredo.

### 1.2 Ordem por risco

1. **Fechar fronteiras pequenas e confirmadas:** grants, revogação de sessão e guards de entrada (S01); tornar a validação de Preview confiável (S02). Não condicionar um REVOKE urgente à conclusão de uma refatoração ampla.
2. **Impedir destinatário indevido e valor inválido:** roteamento de caixas (S06), baixa/discount/PIX de Demurrage (S08, primeira entrega). Corrigir a fronteira numérica dos imports em paralelo lógico (S03), sem depender de uma plataforma de importação nova.
3. **Restaurar atualização financeira automática de forma segura:** procedência de ROE/PTAX e job real (S09). Agendar somente depois de validar a autenticação da Edge e o contrato de recálculo.
4. **Eliminar perdas após commit:** atomicidade do import e da auditoria (S04), recuperação persistente (S05), inbox e estados dos comunicados (S07). Telemetria existente permanece; não é substituto de retry.
5. **Fechar coerência de documentos, ledger e prontidão:** restante de S08 e S10. Corrigir Inspeção e tipos (S11) cedo o suficiente para apoiar os novos contratos.
6. **Reduzir carga de leitura e erros de interação:** S12 e S13. Debounce, offline e acessibilidade podem sair antes das RPCs de paginação.
7. **Completar rastreabilidade e retirar legado comprovado:** S14. Os testes de catálogo que protegem segurança começam em S01, não esperam a limpeza final.

P0/P1/P2 neste plano indicam ordem de tratamento, não reclassificação retroativa das severidades originais. Uma dependência de decisão bloqueia apenas sua tarefa. Não usar a existência de decisões abertas para adiar correções independentes.

### 1.3 Provision Preview Admin: o que está e o que não está confirmado

**Runtime:** o [run 34039653860](https://github.com/luccafwlog/transhippingdesk/actions/runs/34039653860), iniciado às 14:35:41 UTC de 06/09, falhou em `Wait for Supabase Preview`: o check retornou `completed skipped`, causando saída 1. O log identifica `PR_HEAD_REF=codex/consolidate-audits-654-660` e `PR_HEAD_SHA=09a2fcc3f7f834d866e9729c193b0dbf433ef53b`. O workflow executado por `workflow_run` veio da branch confiável; seu `headSha` não deve ser confundido com o SHA da PR validada.

O [run 34039757857](https://github.com/luccafwlog/transhippingdesk/actions/runs/34039757857), associado ao merge `5cdf033…`, ficou **skipped**, coerente com o gate que aceita CI de pull request, não push em `main`. Portanto, a formulação “o provisionamento do merge atual falhou” não está comprovada. **Código:** o YAML atual ainda rejeita qualquer conclusão diferente de `success`, incluindo `skipped`; a fragilidade de tratamento de ciclo de vida persiste. A causa do check Supabase ter sido pulado requer investigação em S02.

**Não corrigir com `skipped == success`, não remover a guarda de produção, não fazer fallback para credenciais de produção.** Uma PR já encerrada pode resultar em encerramento limpo sem provisionar. Uma PR aberta no mesmo SHA exige comprovação de branch pronta ou erro operacional explícito.

## 2. Matriz completa de classificação

Categorias utilizadas literalmente: **Já corrigido**, **Mitigado parcialmente**, **Pendente**, **Aceito**, **Precisa de investigação**. Uma linha desdobrada pode ter classificação distinta da outra metade do mesmo achado. Toda linha pendente tem subprojeto; itens aceitos e já corrigidos não voltam como implementação.

### 2.1 PR #654 — parsing, ingestão e identidade

| ID original | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| P0-1 / §2.2 | Pendente | `src/lib/utils.ts::toNumber` remove letras e infere separador; `1e3` vira 13, `1.234` depende de convenção inexistente. Peso alimenta cobrança de Granito. | S03 |
| P0-2 | Pendente | `src/services/baplieParser.ts` acumula contexto, publica no EQD e reinicia no LOC; associação depende da ordem, sem canal de erro de grupo/UNA. | S03 |
| P0-3 / §2.1 | Pendente | `importCore.readSheet` entrega bytes CSV ao XLSX sem decodificação explícita; Baplie usa `file.text()`. XLSX binário não deve passar pelo decoder textual. | S03 |
| P0-4 / §§5.1–5.3 | Pendente | `vesselAlias.ts` e `voyages.ts` não compartilham identidade canônica suficiente; fallback de nome em Chegadas e Saídas continua frágil. Risco confirmado é duplicação/associação incorreta por nome, não troca comprovada entre IMOs distintos. | S03 |
| P1-5 / §3.2, igual a #657 P1-01 | Mitigado parcialmente | `src/services/containerDatesImport.ts` registra falhas por linha/B/L, continua outros B/Ls, não fatura B/L com update falho e reavalia devolução inalterada. RPC única/transação do conjunto ainda não existe. | S04 + S05 |
| §2.3 — colunas e cabeçalho | Pendente | Adotar o `matchHeaders` já existente nos parsers que não exigem estrutura mínima; layout fixo COSCO precisa de assinatura, não inferência silenciosa. | S03 |
| §2.4 — datas | Pendente | Política difere entre planilhas; datas inválidas/ambíguas podem virar ausência. Manter inferência de ano apenas onde já é contrato de programação. | S03 |
| §2.5 — dado inválido | Pendente | Vazios IMP conserva ISO inválido, tara pode virar zero e `canImport` não expressa severidade. | S03 |
| §2.6 — porto desconhecido | Pendente | Normalização pode devolver texto cru sem indicar reconhecimento; não inventar LOCODE. | S03 |
| §3.1 — imports já transacionais | Aceito | Preservar RPCs atômicas existentes; reexecutar seus contratos ao alterar helpers comuns. Não reconstruir esses imports. | Regressão S03/S04 |
| §3.3 — caudas BL/veículos/clientes/BB | Mitigado parcialmente | Núcleos persistem, mas lote/vínculo, efeitos de veículos e cadastro seguido de contatos têm fronteiras distintas; erros já visíveis não equivalem a rollback. | S04 + S05 |
| §3.4 — CE por linha vs manifesto | Pendente | Planilha confirma RPC por B/L; EDI aplica conjunto. Definir unidade explícita e relatório de aplicação, mantendo a distinção entre `bls` e Granito. | S04 + S05 |
| §3.5 — feedback truncado/efêmero | Pendente | Limites de exibição ocultam erros; BB já persiste parte do relatório. Evoluir relatório completo com severidade e estado aplicado. | S03 + S05 |
| §4 / §6.7 — main thread e uploads | Mitigado parcialmente | Limites e import dinâmico existem; faltam progresso/cessão de execução e validação uniforme de extensão em Chegadas e Saídas. Tempos históricos não são benchmark atual. | S03/S13 |
| §6.2 — schemas de saída | Pendente | Validar contratos concretos de cada parser após normalização, com Zod existente; sem framework genérico ou correção duplicada em cada tela. | S03 |
| §6.6 — tabela de aliases; §6.7 — worker | Precisa de investigação | Persistência de aliases e worker só com ambiguidade operacional ou bloqueio medido; parser Baplie >3 MB é gatilho sugerido, não obrigação de aumentar limite. | S03, §8 |

### 2.2 PR #655 — comunicação

| ID | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| A1 | Pendente | `008::repair_customer_contact_box_fallbacks` pode escolher qualquer contato ativo quando falta principal elegível. Contraria o fallback restrito ao principal da ADR 0064. Vazamento entre caixas do mesmo cliente, não IDOR entre clientes. | S06 |
| A2 | Mitigado parcialmente | `portal-email-webhook` agora autentica e persiste a inbox; `portal-email-events-runner` resolve/retenta em transição server-only e marca evento sem tentativa como investigação. Deploy remoto, retry real e observabilidade ainda precisam de Preview. | S07 |
| A3 | Pendente | Claim de dunning e resolução de destinatários divergem em desativação/caixas; release sem envio permite repetição dos primeiros 50 e starvation. | S06/S07 |
| A4 | Pendente | `simulado` é estado inicial e terminal; saída antecipada no laço de dunning pula agregação final, inclusive após envio parcial. | S07 |
| A5 | Pendente | Chave de idempotência de dunning contém email normalizado em claro, apesar de `recipient_masked`. Mascaramento não serve como chave única. | S07 |
| A6 — volume por cliente | Pendente | D11 aprovada: agrupar cobranças elegíveis por cliente e ciclo, preservando destinatários autorizados, identidade de cada fatura e repetição semanal até quitação. Dimensionamento e implementação ainda pendentes. | S06 / D11 |
| Régua contínua até liquidação | Aceito | Preservar repetição semanal sem máximo de semanas, conforme CONTEXT; decisão de volume por cliente em A6 é separada. | §8 |
| A7 | Pendente | D04 aprovada: a chave de Comunicados também silencia o aviso de bounce ao cliente; supressão, reparo e alerta interno continuam ativos. Implementação ainda pendente. | S06 / D04 |
| A8 | Mitigado parcialmente | Busca na RPC ignora status, mas índice de identidade inclui status mutável e não protege corrida de ausência. | S07 |
| A9 | Pendente | Claim ainda lê `customer_contact_preferences`, aposentada da produção pela ADR 0064. Remover leitura junto da elegibilidade, preservar tabela para compatibilidade. | S06 |

### 2.3 PR #656 — performance e UX

| ID / seção original | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| Achado 1 / §1.1 / §3.3 — buscas e resumo de B/L | Mitigado parcialmente | Migration `020_operational_read_pages.sql` e `operationalLists.ts` limitam a resposta de B/L e o resumo quando o cliente usa RPC; fallback legado ainda materializa linhas. | S12/S13 |
| Achado 2 / §1.2 — `useContainers` | Mitigado parcialmente | A rota RPC de `020` pagina containers e calcula agregados no servidor; fallback em `useBls.ts` ainda busca o conjunto completo. | S12 |
| Achado 3 / §1.3 — `useVoyages` | Pendente | Hook em `useBls.ts` agrega embeds e segunda fase de consultas; separar resumo e detalhe sem N+1. | S12 |
| Achado 4 / §1.4 — ausência de memoização | Precisa de investigação | Ausência de `React.memo` não prova lentidão. Medir commits e props; memoizar somente hotspot demonstrado. | S12/S13 |
| Achado 5 / §1.5 — Line Up TV | Mitigado parcialmente | `Painel` consulta janela inicial de 60 viagens, informa o total e oferece “Carregar mais” até 500; a montagem de agregados por janela e o refresh da TV ainda exigem medição. | S12 |
| Achado 6 / §2 — listeners | Já corrigido | `src/pages/Containers.tsx` e `src/pages/Manifestos.tsx` usam `useEffect` e cleanup nos menus de ações. Não planejar nova troca de lifecycle. | Só regressão existente |
| §3.1 — retry/cache existentes | Aceito | Preservar configuração compartilhada e persistência de preferências já funcionais; não substituir TanStack Query. | Regressão S13 |
| Achado 7 / §3.2 — offline como vazio | Mitigado parcialmente | `QueryStateGate` cobre Manifestos, Containers e Carga Solta, distinguindo query pausada sem cache de dados salvos; outras superfícies ainda precisam da mesma integração. | S13 |
| §4 — virtualização | Aceito | Paginação de 20–100 linhas não justifica virtualizar tudo. Investigar somente lista real >300 linhas ou profiler mostrando custo. | §8 |
| §5.1 — confirmações e modal sujo | Mitigado parcialmente | As quatro confirmações nativas auditadas agora usam `ConfirmDialog` com efeito descrito; proteção de formulário sujo e foco manual ainda não foram ampliados. | S13 |
| Achado 8 / §5.2 — contraste | Pendente | Tokens de texto secundário e cores de status precisam medição em ambos os temas; contagem histórica de 78 usos não é gate. | S13 |
| Achado 9 / §5.3 — teclado/tabelas | Mitigado parcialmente | Tabelas principais receberam `caption` e `scope`; menus e linhas expansíveis ainda precisam de operação por teclado/foco de retorno. | S13 |

### 2.4 PR #657 — transações, erros e sessão

| ID | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| P1-01 | Mitigado parcialmente | Mesmo item #654 P1-5; proteção contra emissão após update falho entregue, atomicidade e recuperação durável pendentes. | S04/S05 |
| P1-02 — observabilidade | Já corrigido | Catches pós-CE registram `reportBestEffortFailure`; não recriar logging como solução. | Preservar |
| P1-02 — retry/fila/feedback | Mitigado parcialmente | `import_pending_effects` e `import-effects-runner` preservam lease, retry, bloqueio e histórico após o commit; o consumidor segue fail-closed e Granite/veículo continuam sem implementação completa. | S05 |
| P2-01 | Pendente | `src/services/blFreightImport.ts` cria/vincula batch após RPC; o sucesso do núcleo não torna metadados atômicos. Respeitar ADR 0017: batch continua opcional. | S04 |
| P2-02 — observabilidade | Já corrigido | Falhas de flags Baplie e taxas provisórias têm telemetria. | Preservar |
| P2-02 — ordenação/retry | Pendente | Cauda usa execução separada; `.finally` pode calcular após falha de flags. Dependência precisa ser persistida. | S05, S04 auditoria |
| P3-01 | Pendente | `omit_voyage_escala` faz EXISTS antes do INSERT; unique já evita duplicata. Corrigir mensagem da corrida, sem alegar duplicação persistida. | S04 |
| P3-02 | Mitigado parcialmente | `useMarkInternalNotificationRead` restaura item/contador no erro e o sino exibe toast com retry; permanece validação manual de estados de rede. | S13 |
| P3-03 | Precisa de investigação | `useAuth` limpa perfil ao falhar hidratação; hidratação depende da identidade, não acontece indiscriminadamente a cada refresh. Reproduzir falha inicial/troca de usuário e distinguir inativo/revogado. | S13 |
| §§2–4 sem achado | Aceito | Não abrir refatoração genérica de RLS, cache, tradução de erros ou duplo clique; manter regressões dos contratos já protegidos. | §6 |

### 2.5 PR #658 — dinheiro, câmbio e documentos

| ID | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| F1 | Pendente | `components/demurrage/InvoiceDocument.tsx` reconverte linhas USD e admite ROE 1; arredondamento por linha pode divergir do total persistido. | S08 |
| F2 — contrato de confirmação | Pendente | `002::confirm_demurrage_pix_matches(jsonb)` é invoker sem guard/estado/dedup/janela equivalentes ao contrato atual. | S08 |
| F2 — baixa arbitrária persistida | Precisa de investigação | ACL final da 006 concede apenas SELECT em `demurrage_invoice_history`; INSERT do invoker pode abortar e desfazer UPDATE. Não há prova de exploração funcional nesta sessão; testar sob roles reais antes de afirmar. Não abrir INSERT para “consertar” RPC. | S08 |
| F3 | Pendente | Desconto USD acima do total aceito no SQL; UI limita resultado, mas banco pode ficar negativo e PIX perder valor. | S08 |
| F4 — autoridade server-side | Mitigado parcialmente | `create_demurrage_invoice_authoritative` calcula por IDs no banco e `demurrage_calculation_snapshots` congela versão/entradas/saída; falta validar Preview/roles reais e concluir os documentos/fluxos financeiros residuais. | S08-B / D02 |
| F4 — validade do cache | Pendente | `src/services/demurrage/demurrageRates.ts` renova timestamp ao falhar refresh, prolongando dado antigo sem limite visível. | S08-A |
| F5 | Pendente | Cotação aceita valor sem faixa de sanidade. Escrita por usuário ativo não é, sozinha, violação da ADR 0046; não impor admin implicitamente. | S09 |
| F6 — quantidade/fracionamento | Pendente | Exibição arredonda fração de container e não explica composição do total. Preservar rateio exato e resíduo já calculado no SQL. | S10 |
| F6 — B/L irmão tardio | Aceito | Risco residual reconhecido pela ADR 0020, complemento de 06/08: irmãos recebem CE juntos. Não recalcular/faturar irmãos automaticamente sem mudança dessa premissa. Validar ocorrência atual e promover decisão se houver evidência. | S10 diagnóstico / D05 |
| F7 | Mitigado parcialmente | A emissão SQL continua sendo a autoridade do payload PIX e os serviços/UI não o calculam nem persistem em paralelo; ACLs/rotas legadas e runtime remoto ainda exigem conferência. | S08/S10 |
| F8 | Precisa de investigação | Subcampo 26/05, txid/limites e caracteres exigem confronto com especificação oficial BR Code vigente. Ausência de campo 01 não torna QR estático expirável; não prometer invalidação de QR antigo. | S08-C |
| F9 | Pendente | Foto inicial reconstrói PTAX dividindo ROE por 1,065, inclusive cotação manual. Preservar procedência real; não inventar histórico retroativo. | S09 |
| F10 | Pendente | Spread 1,065 replicado; centralizar regra no servidor e snapshot/versionamento, sem refatoração de todas as moedas. | S09 |
| F11 | Pendente | `demurrageInvoices.ts` grava pagamento/desconto direto em tabela; mover para contratos separados com lock, guarda, idempotência e histórico. | S08 |
| F12 | Pendente | Readiness de comunicado não substitui gate de emissão; overloads de pendências e precedência divergem. Revalidar cada fronteira na própria transação. | S10/S07 |
| F13 — constraints intrínsecas | Pendente | `demurrage_rates` carece de validação de tarifa negativa, faixas e datas inválidas. | S08 |
| F13 — gaps/sobreposições | Aceito | Lacunas de faixa têm regra aceita na ADR 0026; sobreposição de tabelas locais é deliberada na ADR 0040. Não proibir ambas com EXCLUDE genérico. Conflito específico de acordos continua protegido. | §8 |
| F14 | Pendente | Tolerância de R$ 0,01 pode encerrar invoice local com saldo residual no ledger. Conferir manual e PIX no SQL atual; a afirmação histórica “PIX local exato” não basta. | S10 |
| F15 | Mitigado parcialmente | A Edge tem retry/backoff, erro sanitizado e alerta persistente; migration `018` declara o job PTAX nominalmente inativo. Ainda falta validar gateway/Vault/Preview e uma execução real. | S09, igual #659.1 |
| F16 | Pendente | Seleção para detectar USD e seleção de itens de emissão usam conjuntos de status distintos; risco latente para isento positivo. | S10 |
| F17 | Pendente | `CURRENT_DATE` de emissão pode diferir do dia BRT usado pela régua. | S09/S10 |
| Disputas e juros/multa | Aceito | Disputa pausa dunning, não PTAX/pagamento; juros/multa não são praticados. Não adicionar congelamento de câmbio ou encargos. | §8 |

### 2.6 PR #659 — arquitetura, schema, grants e dívida

| ID original | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| 1 / §2.2 | Mitigado parcialmente | `recalc-demurrage-ptax` agora tem job declarado e inativo em `018`, além do alerta persistente de `024`; ativação e execução remota permanecem pendentes. | S09 |
| 2 / §4.1 | Pendente | `upsert_portal_invoice_exception(bigint,text)` conserva PUBLIC; DEFAULT PRIVILEGES da 006 não revoga função já criada. Inventariar trigger ACLs sem fixar contagem histórica. | S01 |
| 3 / §4.2 | Pendente | `portalScope.ts` constrói variante de disputa inexistente; hook habilita Inspeção. | S11 |
| 4 / §2.7 | Pendente | Tipos não representam superfície final; `settle_cod_adjustment` tem assinatura divergente e adapters contornam inferência. Recalcular diferenças, não congelar 55/6 como meta. | S11 |
| 5 / §2.3 | Pendente | `portal_list_operation_bls_legacy()` chama nome inexistente e não tem consumidor vivo conhecido. Remover após prova de dependências; não restaurar função fantasma. | S14 |
| 6 / §2.4 | Precisa de investigação | 14 candidatas sem uso no inventário histórico; confirmar catálogo, dependências SQL/dinâmicas, triggers/jobs e consumidores externos atuais antes de DROP. | S14 |
| 7 / §§1.1–1.2 — fatos documentais | Já corrigido | Contagens/path/rota catch-all e testes citados foram corrigidos; #661 refinou `.from` para 60 tabelas + 2 buckets. Não repetir essas edições. | Preservar |
| 7 / §§1.3–1.4 — cobertura e prevenção | Mitigado parcialmente | `check-rpc-catalog.mjs` e o mapa literal de Portal conferem RPCs ativas e wrappers de Inspeção; inventário inverso de rotas/arquivos e jobs ainda é residual. | S11/S14 |
| 8 / §4.3 | Pendente | Flags e evento de intenção usam duas chamadas; autor é fornecido pelo cliente e resultado do INSERT não é checado. Trigger genérico pode registrar mudança de linha: não afirmar ausência absoluta de qualquer auditoria. | S04 |
| 9 / §2.6 — quatro nullable | Precisa de investigação | Confirmar escrita externa/uso documental, sobretudo `bls.consignee_address`; remoção não é urgente nem automaticamente segura pela ausência em TS. | S14 |
| 9 / §2.6 — duas write-only | Aceito | Manter `ended_vessels.ended_at` e `portal_email_events.received_at`; esta última será útil ao inbox. | §8 |
| 10 / §3.1 — cast obsoleto | Pendente | `notify2_block`/`consignee_phone` já existem nos tipos; limpar cast/comentário em BlOperacionalTab. | S11 |
| 10 / §3.1 — projeção de escalas | Pendente | EmbarqueVazios e agencyDepartureReport repetem união normalizada após entrega da projeção. Convergir no serviço existente. | S12 |
| §3.2 — supressões | Mitigado parcialmente | Filtro por emails do cliente evita full-scan global atual. RPC filtrada/paginada é necessária ao ultrapassar teto por cliente, não prova de falha atual. | S06 diagnóstico, S12 condicional |
| §3.2 — B/Ls | Mitigado parcialmente | `operational_list_bls`, `operational_list_containers` e `operational_list_bl_summary` têm filtros/limites server-side; fallback e listas derivadas ainda requerem convergência. | S12 |
| §3.2 — Painel 60 viagens | Mitigado parcialmente | Painel expõe janela inicial e “Carregar mais” com total; TV ainda mantém snapshot limitado e a cadeia de agregados não foi reestruturada. | S12 |
| §3.2 — PortalBillingTabs | Mitigado parcialmente | Taxas Locais e Demurrage usam páginas de 25, contagem, filtros e wrappers de Inspeção na migration `021`; exportação busca todas as páginas filtradas sob demanda. | S11/S12 |
| §3.3 — tetos distantes | Aceito | N+1 transbordos, alertas por página, ATD sequencial, Vault por disparo e ZIP sem Zip64 ficam condicionados a medição; lookup portos/layout COSCO recebem validação S03, sem substituição ampla. | §8 |
| §3.4 — ponte de testes do squash | Mitigado parcialmente | `src/test/setup.ts` combina ativo+archive, não lê exclusivamente archive; testes históricos não demonstram schema final. Ampliar execução de catálogo e invariantes ativas. | S01/S14 |
| §3.4 — `voyage_pod_schedule` | Aceito | ADRs 0027 e 0035 adiam explicitamente `port_calls`; literal histórico não é descumprimento que autorize migração ampla. | §8 |
| §3.4 — adapter billingLedger | Pendente | Mesma causa dos tipos, sem tarefa duplicada. | S11 |
| §3.4 — DV CNPJ | Precisa de investigação | `portalCnpjLogin.ts` aceita formato sem DV por dados de teste. Conferir base atual e variantes aceitas antes de restringir login. | S14 / D09 |
| §4.4 — Supabase em Baplie.tsx | Pendente | Leitura direta na página deve ir para service/hook, limitada à consulta auditada. | S12 |
| §2.5 / §4.5 — sem divergência | Aceito | Nenhuma tabela órfã comprovada; preservar cadeias de import, jobs válidos, triggers e decisões conferidas. | Regressão |

### 2.7 PR #660 e falha de workflow

| ID | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| Achado 1 | Pendente | `portal_get_session_overview_v2` verifica ativo, mas não `revoked_before`/iat antes de atualizar último login. Outros RPCs usam helper mais restritivo. | S01 |
| Achado 2 | Já corrigido | `assertPreviewTarget` roda antes de criar cliente; recusa produção, ref ausente e URL malformada. Testes em `previewAdminProvisioning.test.ts`. | Preservar, S02 regressão |
| Achado 3 | Pendente | Guard efetivo está delegado; subir autenticação/permissão/actor para a fronteira pública de escala v2 e import BL. Rollback já limita efeito anterior ao guard; sem afirmar escrita anônima persistida. | S01 |
| Achado 4 | Já corrigido | `vercel.json` inclui HSTS `max-age=31536000; includeSubDomains`. Não adicionar preload nem repetir header. | Preservar |
| Achado 5 | Aceito | DoS por rate limit somente CNPJ é tradeoff explícito ADR 0049. Monitorar, sem inventar identificação confiável por IP. | §8 |
| TOCTOU de contatos | Aceito | Hipótese depende de troca concorrente de customer_id, fora do fluxo atual. Preservar imutabilidade e lock do cliente; reabrir se essa capacidade nascer. | §8 |
| `portal_ship_schedule` anon | Aceito | Programação sem dados privados é exceção deliberada; grants nomeados, nunca PUBLIC genérico. | Regressão S01 |
| Vetores sem achado | Aceito | Não criar tarefas genéricas de IDOR, rotação de segredo sem incidente ou reescrita de Auth/webhooks. | §6 |
| Provision Preview Admin / §1.3 deste plano | Mitigado parcialmente | Guarda de alvo entregue; falha confirmada de lifecycle `skipped` permanece no YAML, causa do skip em investigação. | S02 |

## 3. Dependências entre subprojetos

```mermaid
flowchart TD
  S01["S01 Segurança e catálogo"] --> S04["S04 Transações de ingestão"]
  S01 --> S08["S08 Demurrage e PIX"]
  S02["S02 Preview"] --> V["Validação autenticada em Preview"]
  S03["S03 Parsing e identidade"] --> S04
  S04 --> S05["S05 Recuperação durável"]
  S06["S06 Caixas e elegibilidade"] --> S07["S07 Inbox e estados de envio"]
  S09["S09 ROE/PTAX e cron"] --> S08
  S08 --> S05
  S11["S11 Inspeção e tipos"] --> S12["S12 Leitura e paginação"]
  S10["S10 Ledger e prontidão"] --> S07
  S01 --> S11
  S12 --> S13["S13 UX e acessibilidade"]
  S01 --> S14["S14 Rastreabilidade e legado"]
  S11 --> S14
```

As setas são dependências de integração, não obrigação de bloquear toda uma frente: S08-A (guards/desconto/cache) precede S09; S08-B (snapshot de cálculo) consome S09. S05 pode entregar recuperação de taxas locais antes da emissão durável de Demurrage, com D02 aprovada e dependente da implementação de S08-B. S13 pode entregar debounce/offline/contraste sem aguardar S12. A correção de readiness de S10 pode integrar a primeira versão segura de S07 sem esperar a política de centavos do ledger.

Não existe dependência obrigatória entre refatorar o parser Baplie e revogar um grant. Novas migrations de frentes independentes precisam, contudo, ser integradas em sequência única. A ordem de PRs em §5 explicita esses cortes.

## 4. Planos de implementação detalhados

### Convenção de execução das tarefas

Cada subprojeto abaixo é um plano menor, com fronteira própria e entregas separáveis. Na execução, trabalhar em ramo `codex/` isolado, revisar o baseline vigente e selecionar apenas a entrega corrente. Não iniciar todas as frentes de uma vez. As decisões de §9 delimitam ramos condicionais, sem autorizar decisões comerciais por omissão.

Para cada tarefa de comportamento: escrever o caso que falha, executar o teste estreito e confirmar a falha específica, mudar o contrato mínimo, executar novamente esperando PASS e fazer commit pequeno. Os vetores e contratos abaixo são critérios de implementação, não código já aplicado. Testes devem usar os helpers existentes; não criar um framework de fixtures. As instruções de rollout e documentação de §7 integram os critérios de aceite de cada entrega.

### S01 — Fronteiras de segurança e catálogo executado

**Objetivo / IDs:** fechar PUBLIC indevido e a exceção de revogação do overview; tornar explícito o guard já exigido na entrada. #659.2/§4.1, #660.1/3; início da cobertura #659 §3.4. **Prioridade:** P0 para grant, P1 para overview, P2 para defesa de entrada. **Dependências:** nenhuma de implementação; Preview S02 para validação externa. **Decisões:** preservar matriz RBAC vigente e a exceção de programação pública; não ampliar `is_admin()` nem restaurar restrições departamentais antigas.

**Arquivos:** criar migration `supabase/migrations/009_rpc_entry_security.sql`, `src/integration/auditSecurityBoundaries.local-pg.test.ts`; modificar `scripts/security/verificar_guardas.py`, `src/services/__tests__/consolidatedSchemaInvariants.test.ts` e, na execução, `docs/RASTREABILIDADE.md`/`docs/operations/validacao.md`. A definição fonte dos três RPCs vive hoje em `supabase/migrations/002_business_logic_and_security.sql`; copiá-la para CREATE OR REPLACE em migration nova, nunca editar a 002.

**Contratos SQL:** `upsert_portal_invoice_exception(bigint,text)`, `portal_get_session_overview_v2()`, `current_portal_customer_id()`, `save_voyage_escala_terminal_state_v2(bigint,text,integer,jsonb,jsonb,jsonb,text)`, `import_bl_freight_transactional(jsonb,uuid)`.

- [ ] Registrar ACL efetiva no replay antes da mudança, usando a consulta de §6.2. Provar que o grant PUBLIC é herdado por anon, independentemente dos DEFAULT PRIVILEGES.
- [ ] Criar teste SQL que exige `has_function_privilege('anon', 'public.upsert_portal_invoice_exception(bigint,text)', 'EXECUTE') = false`; antes da migration deve falhar. Testar trigger legítimo que usa a função, com efeito de alerta esperado.
- [ ] Aplicar o fechamento exato; inventariar separadamente funções trigger com PUBLIC e revogar somente as assinaturas verificadas. Conservar chamadas internas e service_role onde já necessário.

```sql
REVOKE ALL ON FUNCTION public.upsert_portal_invoice_exception(bigint, text)
  FROM PUBLIC, anon, authenticated;
```

- [ ] No overview, validar identidade e revogação pelo mesmo contrato de `current_portal_customer_id()` antes do UPDATE de `last_login_at`; manter retorno e mensagens genéricas. Testar iat anterior, posterior, tolerância de 5 segundos, ausência e formato inválido. Se o helper atual não cobre token malformado, corrigir nele e usar nos dois caminhos; nunca permitir que cast de claim vaze erro interno.
- [ ] Antes de ler payload/tabelas/delegar no import, exigir `auth.uid() IS NOT NULL`, helper interno vigente e `p_changed_by IS NOT DISTINCT FROM auth.uid()`. No wrapper de escala, usar a mesma permissão do núcleo de escala, antes de criar porto. Manter `search_path=public,pg_temp` e grants fechados em todas as funções substituídas.
- [ ] Executar `npm test -- src/integration/auditSecurityBoundaries.local-pg.test.ts src/services/__tests__/consolidatedSchemaInvariants.test.ts` com o banco local de §6. Confirmar PASS, incluindo chamada negada sem nenhuma alteração persistida; commit `fix: close audited RPC security boundaries`.

**Compatibilidade / rollout:** mesmas assinaturas; aplicar SQL antes de frontend. Token revogado deve encerrar sessão conforme fluxo já existente. Não fazer rollback que reabra PUBLIC ou aceite token revogado. **Testes:** contrato textual de entrada; integração SQL com anon, Portal A/B, interno inativo, todos os perfis internos e ator divergente; runtime PostgREST com tokens reais. **Aceite:** nenhum dado/último login muda com token revogado; zero EXECUTE PUBLIC indevido no catálogo; programação pública e triggers válidos continuam funcionando. **Residual:** RLS local com shims não cobre gateway/Auth real; completar Preview antes de encerrar. **Ordem:** primeiro PR.

### S02 — Provisionamento de Preview coerente com o ciclo da PR

**Objetivo / IDs:** resolver o residual do workflow (§1.3), preservando #660.2. **Prioridade:** P1, habilita validação das outras frentes. **Dependências:** acesso de leitura aos runs/checks e uma PR aberta com branch Supabase. **Decisão técnica:** PR encerrada ou SHA superado não deve provisionar; `skipped` de PR aberta não é sucesso automático.

**Arquivos:** modificar `.github/workflows/provision-preview-admin.yml`; criar `scripts/preview-readiness.mjs` e `src/services/__tests__/previewReadiness.test.ts`; preservar `scripts/provision-preview-admin.mjs`, `scripts/load-branch-env.mjs` e os testes existentes. Atualizar `docs/setup/deploy.md` apenas na execução. **Migrations:** nenhuma.

- [ ] Reconsultar os runs de §1.3 e checks da PR; registrar estado da PR no horário do skip, integração emissora, SHA, branch ref e motivo disponível. Se a integração não fornecer motivo, registrar lacuna e validar o comportamento em PR nova; não inferir sucesso de branch.
- [ ] Extrair decisão pura em `preview-readiness.mjs`, usando contrato completo abaixo, e testar todos os retornos antes de ligar o YAML.

```js
export function decidePreviewReadiness({ open, currentSha, requestedSha, conclusion, branchReady }) {
  if (!open || currentSha !== requestedSha) return 'obsolete'
  if (conclusion === 'success' && branchReady) return 'ready'
  if (['failure', 'cancelled', 'timed_out', 'action_required'].includes(conclusion)) return 'failed'
  if (conclusion === 'skipped') return 'investigate'
  return 'wait'
}
```

```js
import { expect, it } from 'vitest'
// @ts-expect-error — script operacional JS sem declaração gerada.
import { decidePreviewReadiness } from '../../../scripts/preview-readiness.mjs'
it('não transforma skipped de PR aberta em autorização para provisionar', () => {
  expect(decidePreviewReadiness({ open: true, currentSha: 'a', requestedSha: 'a',
    conclusion: 'skipped', branchReady: true })).toBe('investigate')
})
```

- [ ] No YAML, consultar PR atual e check da integração confiável para o SHA exato, incluindo paginação; aguardar branch Supabase pronta com prazo limitado. `obsolete` conclui sem credenciais; `failed`/`investigate` produzem diagnóstico sem segredo; `wait` termina com timeout identificável. Revalidar SHA e estado antes de provisionar para cobrir merge durante a espera.
- [ ] Executar `npm test -- src/services/__tests__/previewReadiness.test.ts src/services/__tests__/previewAdminProvisioning.test.ts`; esperar PASS em cenário sem check, pending, success/branch ausente, skipped, fechamento, SHA novo e falha terminal. Commit `fix: handle obsolete and skipped preview checks`.
- [ ] Validar em PR aberta: integração Supabase pronta → variáveis da branch → provisionamento idempotente → login QA no Preview. Reexecutar mesmo SHA e fechar/superar PR durante espera; comprovar ausência de tentativa em produção.

**Compatibilidade / rollout:** manter checkout confiável da branch padrão e guards de fork/repositório; não executar código da PR com secrets desse workflow. Deploy do script na branch padrão precede prova real do `workflow_run`. **Aceite:** run verde com QA funcional em PR elegível; run encerrado sem escrita para PR obsoleta; skip inexplicado diagnosticado, sem fallback. **Residual:** indisponibilidade da integração permanece falha operacional recuperável; este PR não muda integração/Vercel nem refaz decode de dotenv já corrigido. **Ordem:** segundo PR, independente de SQL.

### S03 — Fronteira de ingestão: número, bytes, estrutura e identidade

**Objetivo / IDs:** impedir corrupção silenciosa antes da persistência. #654 P0-1–P0-4, §§2.1–2.6, 3.5, 4, 5, 6; validação de layout/portos da #659 §3.3. **Prioridade:** P0 para coerção/associação, P1 para validação e feedback. **Dependências:** nenhuma de schema para parsers; S04 usa a saída validada. **Decisões:** D01 (convenções de arquivos/datas), dialetos Baplie aceitos; identidade por IMO antes de aliases. Não adivinhar formato de arquivo ambíguo.

**Arquivos:** criar `src/lib/importNumber.ts`, `src/services/importText.ts`, `src/services/importValidation.ts`, `src/lib/__tests__/importNumber.test.ts`; modificar `src/lib/utils.ts`, `src/lib/vesselAlias.ts`, `src/services/importCore.ts`, `src/services/baplieParser.ts`, `src/services/graniteImport.ts`, `src/services/vaziosImport.ts`, `src/services/vaziosImportacaoImport.ts`, `src/services/containerDatesImport.ts`, `src/services/blParser.ts`, `src/services/portCode.ts`, `src/services/voyages.ts`, `src/services/portalScheduleBulkImport.ts`, `src/pages/ChegadasSaidas.tsx` e modais compartilhados de import. Estender testes existentes desses parsers. **Migrations:** nenhuma inicialmente; índice/alias persistido apenas após D01 e inventário de duplicatas, em PR separado.

**Contrato de saída compartilhado proposto:**

```ts
export type ImportIssue = {
  row: number
  field: string
  code: 'invalid_number' | 'ambiguous_number' | 'invalid_date' | 'missing_header' |
    'unknown_port' | 'invalid_iso' | 'invalid_group' | 'ambiguous_voyage'
  severity: 'error' | 'warning'
  message: string
}
export type ParsedNumber =
  | { kind: 'value'; decimal: string }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: 'syntax' | 'ambiguous' | 'non_finite' }
```

`decimal` é representação decimal canônica sem agrupamento, não resultado monetário calculado com float. Adaptar à API atual apenas após validar precisão/faixa. Um número JS nativo da célula é finito ou erro; string nunca perde letras para “virar número”. O helper não atribui valor zero à ausência.

- [ ] Inventariar callers de `toNumber` com `rg -n '\btoNumber\(' src`; classificar moeda/peso/quantidade e convenção da origem. Adicionar teste reproduzindo `1e3 → 13` antes de remover esse comportamento. Evitar mudar callers fora de import sem contrato de compatibilidade.
- [ ] Implementar gramáticas explícitas por coluna/formato: pt-BR aceita `1.234,56`, en-US aceita `1,234.56`; formato não declarado recusa `1.234` como ambíguo. Exponente textual somente se o formato o admitir, com resultado 1000 para `1e3`, nunca 13; default recusa. Tratar moedas/sinais contábeis apenas por allowlist da coluna e validar escala/faixa após parse.

| Entrada | Contexto | Resultado exigido |
|---|---|---|
| `1.234` | peso pt-BR declarado | 1234 |
| `1.234` | decimal en-US declarado | 1.234 |
| `1.234` | formato desconhecido | erro de ambiguidade |
| `1e3`, `12abc`, `NaN`, `Infinity` | decimal sem exponente | erro, sem substituição |
| vazio / número 0 | qualquer | estados diferentes: empty / value 0 |
| `1.234,56`, `1,234.56` | formato correspondente | decimal canônico `1234.56` |
| negativo em peso/tara | coluna não negativa | erro de domínio |

- [ ] Separar detecção de tipo e decode: XLS/XLSX continua binário; CSV/EDI lê ArrayBuffer, BOM/declarador quando disponível, UTF-8 estrito e fallback Windows-1252 somente para origem autorizada. Rejeitar bytes inválidos sem fallback aplicável; registrar encoding escolhido no preview. Testes byte a byte com `Vitória`, `São`, `ç` e UTF-8 sem BOM, incluindo round-trip no EDI gerado.
- [ ] Reescrever scanner Baplie para respeitar UNA, separadores e release character; construir grupo completo antes de emitir container. Delimitar grupos conforme dialeto validado, não assumir que todo LOC inicia container. Cobrir LOC→EQD, EQD→LOC, EQDs consecutivos, campos ausentes, DGS/OOG, EOF e duplicata; campos não herdam estado de grupo anterior. Grupo inválido gera issue visível e bloqueia aplicação daquele conjunto físico até correção.
- [ ] Usar `matchHeaders` e schemas concretos na saída de Granito/Vazios/Vazios IMP; localizar cabeçalho em janela pequena declarada pelo template e recusar múltiplos candidatos. Para COSCO fixo, validar marcadores/colunas antes de ler coordenadas. Validar ISO/case, tara, datas reais, ordem temporal e portos reconhecidos; warning permitido não pode afetar identidade/valor sem decisão explícita.
- [ ] Canonicalizar tokens de navio em `vesselAlias.ts` e reutilizar em busca/criação/anexação. Mesmo IMO prevalece sobre grafia; IMOs distintos nunca se fundem; ausência de IMO usa nome canônico + número da viagem. Testar `ZYHY`, `CS`, `C.S.`, espaços/pontuação e nomes `CSCL` que não são prefixo equivalente. Mais de um candidato retorna conflito no preview, nunca `.find()` arbitrário.
- [ ] Exibir contagens válidas/erros/warnings e relatório integral rolável/exportável. `canImport` usa erro bloqueante e conjunto aplicável, não só quantidade; não enviar `raw`/emails/arquivo inteiro à telemetria. BB conserva relatório já persistido; durabilidade transversal vem em S05.
- [ ] Executar `npm test -- src/lib/__tests__/importNumber.test.ts src/lib/__tests__/vesselAlias.test.ts src/services/__tests__/importCore.test.ts src/services/__tests__/baplieParser.test.ts src/services/__tests__/graniteImportAtomic.test.ts src/services/__tests__/vaziosImportacaoImport.test.ts`; esperar PASS com fixtures sintéticas pequenas e formatos reais anonimizados já disponíveis. Separar commits `fix: parse import decimals explicitly`, `fix: decode and validate import records`, `fix: resolve vessel identity consistently`.

**Compatibilidade / rollout:** conservar assinatura dos imports ou adaptar todos os callers no mesmo PR; avisar rejeições novas no preview. Não reprocessar lotes antigos nem fundir viagens já existentes automaticamente. **Testes:** unitários acima, integração parse→preview→RPC de Granito para verificar peso e valor, regressão de templates e EDI, runtime com arquivo real e alias. **Aceite:** nenhum campo inválido vira zero/null silenciosamente; duas unidades Baplie não trocam peso/POL/POD; nenhuma duplicata por alias conhecido e nenhum merge de IMO distinto. **Residual:** formatos não suportados são recusados com diagnóstico; cadastro amplo de aliases/UNLOCODE e worker exigem medição. **Ordem:** três PRs pequenos; precisão primeiro.

### S04 — Atomicidade da ingestão e da auditoria operacional

**Objetivo / IDs:** transformar sucessos parciais implícitos em unidades transacionais explícitas. #654 P1-5/§§3.2–3.4; #657 P1-01, P2-01, P3-01; #659.8. **Prioridade:** P1. **Dependências:** guard S01, contratos válidos S03; emissão posterior durável em S05. **Decisão D03:** padrão recomendado é atomicidade por B/L para datas/CE, mantendo B/Ls independentes aplicáveis; arquivo inteiro só se a operação exigir all-or-nothing. Baplie usa conjunto físico coerente por viagem; cadastro de cliente+contatos, por cliente.

**Arquivos:** modificar `src/services/containerDatesImport.ts`, `src/services/blFreightImport.ts`, `src/services/baplieReconciliation.ts`, `src/services/ceMercanteImport.ts`, `src/services/customerBase.ts`, `src/services/vehicleImport.ts`, `src/services/breakbulkImport.ts`, `src/components/shared/ContainerDatesImportModal.tsx`; criar `src/integration/importAtomicity.local-pg.test.ts`; estender `src/services/__tests__/containerDatesImport.test.ts`, `src/services/__tests__/blFreightImport.test.ts`, `src/services/__tests__/customerBase.test.ts`. Criar migrations `supabase/migrations/015_import_dates_and_flags_atomic.sql` e `supabase/migrations/016_import_metadata_and_omission_conflicts.sql` conforme §5. Atualizar módulos afetados na execução.

**Contratos propostos:** `apply_container_dates_atomic(p_request_id uuid,p_bl_id text,p_rows jsonb,p_changed_by uuid) returns jsonb`; `apply_baplie_physical_flags_atomic(p_voyage_id bigint,p_changes jsonb,p_changed_by uuid) returns jsonb`. O primeiro retorna `{request_id, bl_id, updated_ids, unchanged_ids, billing_state}`; o segundo retorna IDs realmente alterados e ação auditada. Erros de domínio abortam a unidade, com código conhecido; “unchanged” ainda permite verificar efeito financeiro pendente. Datas e flags não recebem valores financeiros livres.

- [ ] Criar testes de falha no segundo update, no evento de auditoria e na validação de pertencimento. Estado antes/depois de todas as linhas do B/L deve ser idêntico em falha; B/L seguinte pode ter sucesso e aparece separado no relatório. Executar contra baseline e confirmar que o teste reproduz a ausência de atomicidade atual.
- [ ] Na RPC de datas, validar duplicatas conflitantes do payload, relação B/L/viagem/container e valores esperados do preview; lock ordenado das linhas e do B/L, atualizar todas as datas ou nenhuma. Comparar estado atual para detectar preview obsoleto; reconsultar conjunto completo de containers, não só IDs enviados, antes de classificar pronto para emissão.
- [ ] Preservar a mitigação já entregue: update falho impede emissão daquele B/L; devolução inalterada pode recuperar emissão ausente; outras unidades têm resultado próprio. Ao trocar o caller pelo RPC, remover somente o loop de escrita substituído e o cálculo que assume sucesso de todas as linhas.
- [ ] Na RPC de flags, reconsultar staging e containers da viagem para derivar flags e valores anteriores; não confiar em `previous` ou snapshot de autoria fornecido pelo browser. Obter autor por `auth.uid()` e departamento no servidor, aplicar flags e evento semântico na mesma transação. Verificar interação com `audit_row_changes`: manter trilha de linha legítima e apenas um evento de intenção, correlacionados, sem falso evento duplicado. No-op não cria mudança fictícia; falha da auditoria desfaz flags.
- [ ] No BL, incluir metadado de import e vínculo necessários na transação existente, preservando toda cadeia `_legacy_357/322/284/205`. Não tornar `import_batches` obrigatório para B/L avulso: preferir registro leve por arquivo, conforme ADR 0017. Se um batch é explicitamente fornecido, validar viagem/pertencimento e gravar vínculo no mesmo commit; falha no vínculo aborta a unidade.
- [ ] No import de base de clientes, mover cadastro e chamada ao núcleo `_apply_customer_contact_configuration` para transação por cliente. Não fazer upsert global e descobrir depois que o principal/caixas são inválidos. Preservar soft-delete, unicidade e snapshots da ADR 0064.
- [ ] Declarar CE de planilha como resultado por B/L e EDI como conjunto atômico já existente; ambos persistem gatilho recuperável S05 na mesma transação. Granito continua com seu destino e invariantes 1:1. Caudas de veículo/cálculo BB que não precisam bloquear ingestão entram em S05: cancelamento de invoice sem pagamento e recálculo devem respeitar lifecycle, bloquear pagamento concorrente e mostrar etapa exata que falhou; tabela de tarifas indisponível em BB não pode ser interpretada como tabela vazia válida; não fingir rollback de HTTP já concluído.
- [ ] Em `omit_voyage_escala`, serializar pela viagem/escala ou capturar apenas a violação da constraint de omissão esperada, traduzindo para a mensagem de duplicidade existente. Não capturar toda `unique_violation`, que esconderia outra constraint. Testar duas sessões: uma criação e uma duplicidade amigável, uma única omissão persistida.
- [ ] Executar `npm test -- src/integration/importAtomicity.local-pg.test.ts src/services/__tests__/containerDatesImport.test.ts src/services/__tests__/blFreightImport.test.ts src/services/__tests__/customerBase.test.ts`; esperar PASS. Commits por contrato: `fix: apply container dates atomically`, `fix: audit physical flags in the same transaction`, `fix: keep import metadata consistent`.

**Compatibilidade / rollout:** publicar RPC nova, migrar caller e depois retirar escrita antiga sensível. Locks em ordem estável e limite explícito de linhas por chamada; não usar transação aberta atravessando arquivos/HTTP. **Testes:** payload misturando viagem/B/L, dates repetidas iguais vs conflitantes, alteração concorrente, autor falsificado, falha na última linha, falha na auditoria e reimport unchanged; runtime importar, fechar aba e conferir estado. **Aceite:** cada unidade tem estado aplicado/não aplicado verificável; nenhuma flag bem-sucedida sem trilha obrigatória; nenhum B/L faturado sobre subconjunto falho. **Residual:** S04 isolado não garante emissão após commit; comunicar “dados salvos, faturamento pendente” até S05. **Ordem:** após parsing mínimo; flags podem integrar antes de concluir todos os templates.

### S05 — Recuperação persistente dos efeitos pós-commit

**Objetivo / IDs:** completar retry/fila/feedback residual de #657 P1-02/P2-02/P1-01 e #654 §§3.3–3.5. **Prioridade:** P1. **Dependências:** S04 para evento na origem; S08-B/D02 para emissão automática de Demurrage sem browser; S10 para gates de emissão/prontidão. **Decisões:** reprocessamento automático de falhas transitórias, bloqueio visível de erros permanentes; efeitos financeiros validam regras atuais e preservam snapshot já emitido.

**Arquivos:** criar `src/services/importEffects.ts`, `src/hooks/useImportEffects.ts`, `src/components/shared/ImportResultPanel.tsx`, `supabase/functions/import-effects-runner/index.ts`, `src/services/__tests__/importEffects.test.ts`, `src/integration/importEffects.local-pg.test.ts` e migration `supabase/migrations/017_import_effects_outbox.sql`; modificar `src/services/reviewBillingAutomation.ts`, `src/services/ceMercanteImport.ts`, `src/services/blFreightImport.ts`, `src/services/containerDatesImport.ts`, `src/services/vehicleImport.ts`, `src/services/breakbulkImport.ts`, `supabase/config.toml` e modais existentes. Documentar job/secrets em WORKFLOW e ADR nova na execução.

**Contrato persistido proposto:** registro de import leve separado de `import_batches`; efeito com identidade lógica única `(source_action_id,effect_kind,entity_id)`, revisão de origem, dependência, estado, número de tentativas, próxima tentativa, lease e resultado. Dados de origem/autor/departamento são congelados no servidor ao aceitar o comando. Histórico de tentativas é append-only; estado da fila é mutável. Sem email/arquivo bruto no log de erro.

```ts
export type ImportEffectState = 'pending' | 'running' | 'retry_wait' |
  'blocked' | 'succeeded' | 'superseded'
export type ImportEffectKind = 'physical_flags' | 'provisional_charges' |
  'local_billing' | 'granite_billing' | 'demurrage_billing' | 'vehicle_followup'
```

- [ ] Provar a falha após CE salvo/aba fechada com caso local pequeno. Criar teste que espera um efeito pendente persistido mesmo quando o chamador nunca executa a cauda; deve falhar no baseline.
- [ ] Inserir efeito na transação do evento de origem. Repetição da mesma ação retorna registro existente; estado financeiro já concluído resolve como sucesso sem emitir outra invoice. Uma nova revisão usa nova identidade e invalida/supera a antiga antes de executar, evitando aplicar flags/cálculos sobre reimport mais novo.
- [ ] Implementar claim de lote com `FOR UPDATE SKIP LOCKED`, lease expirada recuperável e exclusão mútua por entidade. Definir ordem `physical_flags → provisional_charges → billing`; CE libera a etapa de emissão conforme modo/gates. Não manter `.finally` que calcula depois de falhar flags.
- [ ] Worker chama núcleos SQL privados com service_role; wrappers públicos continuam exigindo usuário real. Não passar `p_changed_by` inventado para burlar guard `auth.uid()`. Registrar separadamente iniciador validado e executor de sistema; não conservar autorização de usuário revogado como credencial do worker.
- [ ] Classificar erros: timeout/429/5xx usam 1, 5, 15 e 60 minutos, no máximo cinco tentativas totais; autorização inválida, payload obsoleto e pendência de domínio viram `blocked`/`superseded`. Lease sugerida de cinco minutos, renovável enquanto processa; prazo deve superar timeout real do efeito. Alerta interno único no esgotamento e ação de retry com permissão/auditoria, sem laço infinito.
- [ ] Persistir relatório integral com linha/unidade aplicada, bloqueada ou aguardando efeito. Exibir no modal e reabrir pelo resultado do import; contagem de sucesso é de dados aplicados, emissão tem estado próprio. Manter `reportBestEffortFailure`, agora correlacionado ao ID persistido.
- [ ] Para Demurrage, habilitar `demurrage_billing` automático apenas após S08-B. D02 está aprovada; até S08-B estar implementado e validado, salvar pendência e permitir retomada autenticada pelo operador, sem declarar recuperação automática concluída.
- [ ] Executar `npm test -- src/services/__tests__/importEffects.test.ts src/integration/importEffects.local-pg.test.ts src/services/__tests__/reviewBillingAutomation.test.ts`; verificar PASS em crash antes/depois do commit, timeout com resultado incerto, dois workers, replay de arquivo, efeitos fora de ordem e lease vencida. Commit `feat: recover import effects from a durable queue`.

**Job proposto:** `import-effects-runner`, a cada cinco minutos (`*/5 * * * *`), via `ops.dispatch_edge_job('import-effects-runner', 'IMPORT_EFFECTS_CRON_SECRET')`. Segredo homônimo no Vault e Edge, autenticação própria fail-closed e `verify_jwt` coerente, provados em Preview antes de ativação.

**SQL / grants:** tabela sem escrita direta do browser; leitura interna por helper vigente; RPCs de listar/retry escopadas e auditadas; claim/complete exclusivamente service_role. Agendar por `ops.dispatch_edge_job`/Vault, sem segredo em SQL. **Rollout:** schema e leitura primeiro, produtores depois, worker inicialmente pausado; não ligar duas caudas para o mesmo evento. Backfill somente de efeitos comprovadamente incompletos, com simulação e dedup financeiro; nunca reenfileirar todos os imports históricos. **Aceite:** falha após commit recupera sem nova invoice duplicada, operador encontra pendência após recarregar; flags falhas bloqueiam dependentes. **Residual:** entrega é pelo menos uma vez, não promessa de exactly-once HTTP; idempotência no consumidor é obrigatória. **Ordem:** depois das RPCs de origem; PRs separados para núcleo, produtores e ativação.

### S06 — Roteamento de caixas e elegibilidade da régua

**Objetivo / IDs:** preservar consentimento de caixa e impedir starvation. #655 A1/A3/A9; D04 aprovada para A7, agrupamento D11 aprovado para A6; #659 §3.2 supressões. **Prioridade:** P1, bloqueador de ativação de envio em massa. **Dependências:** nenhuma para correção de fallback; S07 completa estados/recuperação. **Decisões:** D04 para aviso de bounce e D11 para volume por cliente; régua semanal contínua permanece contrato aceito.

**Arquivos:** criar migration `supabase/migrations/010_contact_routing_and_dunning_eligibility.sql`; modificar `supabase/functions/demurrage-dunning/index.ts`, `supabase/functions/portal-email-webhook/index.ts`, `src/services/customerCommunicationBoxes.ts`, `src/services/customerContactConfiguration.ts`, `src/services/customerCommunications.ts`; estender `src/services/__tests__/customerCommunicationBoxes.test.ts`, `src/services/__tests__/demurrageDunningMigration.test.ts`, `src/services/__tests__/demurrageDunningFunction.test.ts`; criar `src/integration/communicationEligibility.local-pg.test.ts`. Atualizar ADR 0064/0059 só conforme decisão, módulos e validação na execução.

**Contratos SQL:** `repair_customer_contact_box_fallbacks`, `customer_communication_recipient_allowed`, `claim_demurrage_dunning_candidates`, `demurrage_dunning_candidate_sendable`, `release_demurrage_dunning_claim`; resolver elegibilidade de caixa pela mesma regra canônica, respeitando natureza de supressão.

- [ ] Criar cliente com principal suprimido e alternativo apenas operacional: cobrança de Demurrage não pode vincular/enviar ao alternativo. Criar caso positivo com principal elegível para fallback e preservar reparo auditado da ADR 0064. Teste deve falhar no caso indevido antes da mudança.
- [ ] Remover seleção de contato arbitrário no fallback; sem principal elegível, manter caixa sem destinatário, pausar cobrança e abrir/reusar alerta cadastral. Não proibir CE e Taxas para `documentacao_operacao`: essa caixa é destinatária legítima conforme catálogo.
- [ ] Alinhar claim e sendable com desativação, vínculo de caixa e supressões; retirar toda consulta de produção a `customer_contact_preferences`. Revalidar imediatamente antes do envio. Preservar tabela/coluna `purpose` de rollback, sem recriar seus triggers.
- [ ] Testar 60 candidatos, sendo os 50 primeiros inelegíveis: os últimos 10 elegíveis devem ser processáveis no primeiro lote útil. Candidatos pausados não consomem contador da régua nem voltam como trabalho quente a cada hora; regularização cadastral reabre elegibilidade. Preservar pausa por disputa e quitação.
- [ ] Implementar D11 aprovada: agrupar as faturas de Demurrage elegíveis em uma mensagem por cliente e ciclo, enviada a cada destinatário elegível sem duplicação. Na fixture de 12 faturas com os mesmos 3 contatos elegíveis, esperar 3 entregas contendo as 12 faturas, em vez de 36. Preservar identificadores, links e valores individuais; não consolidar invoices nem misturar clientes. Congelar a composição da tentativa, deduplicar por cliente/ciclo/destinatário e manter rastreabilidade e avanço da régua por fatura incluída. Revalidar quitação, disputa, supressão e caixa; testar conjuntos distintos de destinatários sem ampliar acesso, retry, falha parcial e retomada sem duplicação. Preservar a periodicidade semanal até quitação; medir limites do provedor sem descartar cobranças por cap arbitrário. Ajustar os contratos de S07 para a mensagem agrupada antes de ativar envio real.
- [ ] Inventariar contatos/supressões por cliente por contagens, sem expor emails. Testar acima de 1000 para dimensionar upgrade de paginação S12; o filtro atual não deve ser removido antes da alternativa server-side.
- [ ] Implementar D04 aprovada: submeter o aviso de bounce ao cliente à chave global de Comunicados. Com a chave desligada, nenhum aviso externo de bounce é enviado; supressão, reparo e alerta interno continuam funcionando. Testar chave desligada/ligada e revalidá-la antes do envio. Convite/reset/segurança mantêm as isenções já aceitas. Registrar a decisão em ADR e atualizar CONTEXT na implementação, sem apresentar a regra como já entregue.
- [ ] Executar `npm test -- src/services/__tests__/customerCommunicationBoxes.test.ts src/services/__tests__/demurrageDunningFunction.test.ts src/integration/communicationEligibility.local-pg.test.ts`; esperar PASS em caixas sobrepostas, principal desativado, opt-out, complaint por natureza e bounce permanente cruzado. Commit `fix: align contact fallback and dunning eligibility`.

**Compatibilidade / rollout:** schema/RPC primeiro, depois Edge; chave permanece no estado atual, sem ativação implícita. Simulação com destinatários de QA comprova recorte; excluir fixtures dos envios reais. **Aceite:** zero destinatário novo fora das caixas permitidas; nenhuma starvation pelos inelegíveis; decisões de fallback e pause aparecem na auditoria. **Residual:** alteração de contato entre conferência e envio exige revalidação, sem prometer transação entre banco e provedor; agrupamento por cliente/ciclo da D11 aprovada permanece pendente de implementação, sem alterar a continuidade semanal aceita. **Ordem:** primeiros PRs, antes de ativar envio real.

### S07 — Inbox de webhook, idempotência e estado observável do envio

**Objetivo / IDs:** não perder eventos e não chamar envio real de simulação. #655 A2/A4/A5/A8 e residual A3; fronteira de comunicado de #658 F12. **Prioridade:** P1. **Dependências:** S06 e núcleo de readiness S10; pode reutilizar padrões de lease de S05, sem impor uma fila genérica única a domínios distintos. **Decisões:** retenção de payload mínimo e PII (D07), estados de envio apresentados ao operador.

**Arquivos:** criar migration `supabase/migrations/018_email_inbox_and_dispatch_state.sql`, `supabase/functions/portal-email-events-runner/index.ts`, `src/integration/emailInbox.local-pg.test.ts`; modificar `supabase/functions/portal-email-webhook/index.ts`, `supabase/functions/demurrage-dunning/index.ts`, `supabase/functions/send-customer-communication/index.ts`, `supabase/functions/_shared/email.ts`, `src/services/customerCommunications.ts`, `src/components/billing/InvoiceCommunicationStatusCell.tsx` e testes `src/services/__tests__/portalEmailWebhook.test.ts`, `src/services/__tests__/sendCustomerCommunicationFunction.test.ts`, `src/services/__tests__/demurrageDunningFunction.test.ts`. Atualizar config/cron/Vault e docs na execução.

**Contratos:** estender `portal_email_events` com `provider_message_id`, payload mínimo validado, `processed_at`, tentativas/erro/lease; `received_at` existente é preservado. Recebimento deduplicado não significa processamento concluído. Claim/apply/complete são privados para service_role. Comunicado passa a distinguir pendente/processando, simulado terminal, enviado, parcial, pausado e falha; histórico de tentativas mantém o resultado real por destinatário.

- [ ] Testar evento assinado antes de persistir `provider_message_id` da tentativa: primeiro recebimento fica pendente, segunda execução após vínculo aplica efeito uma vez. Testar falha após dedup e antes de supressão, evento repetido e evento desconhecido ignorado com conclusão explícita. No baseline, retry perdido deve reproduzir A2.
- [ ] Persistir evento validado antes do ACK; erro de persistência retorna não-2xx. Duplicata pendente continua elegível; duplicata processada é no-op. Resolver tentativa e atualizar estado/supressão/reparo obrigatório numa transação; avisos HTTP secundários geram ação idempotente separada, sem consumir o evento antes de sucesso interno.
- [ ] Aplicar transições por evento e horário, sem regressão de `delivered` para `sent` por atraso. Bounce permanente/complaint preservam supressão segundo natureza; não usar simples ordenação numérica de estados para todos os eventos. Evento sem tentativa após janela de retry fica em investigação com alerta, sem descarte silencioso.
- [ ] Criar comunicação como pendente; agregar contadores em todas as saídas, inclusive pausa após primeiro destinatário. `finally` cobre retorno/erro, reconciliador de lease cobre crash do processo. `simulado` só quando nenhuma entrega real foi tentada e a execução simulada concluiu; parcial não é sucesso integral nem simulado.
- [ ] Trocar chave nova de dunning por identidade sem email, usando `communication_id`, `contact_id` e versão imutável do destinatário persistida na tentativa. Mesma tentativa conserva chave inclusive após resultado incerto. Não recalcular chaves antigas para reenvio, não usar email mascarado como identidade e não reescrever histórico antigo indiscriminadamente.
- [ ] Remover status mutável da unicidade lógica de `customer_communications` mantendo `NULLS NOT DISTINCT` nas dimensões existentes. Pré-consultar duplicatas de identidade e reconciliar referências de tentativas antes de criar índice; não apagar evidência. No conflito concorrente retornar comunicação existente, validando que o mesmo pedido não traz conteúdo incompatível.
- [ ] Para `kind = ce_mercante_taxas`, fazer readiness na transação de criação/claim de comunicação e revalidar antes do provedor. Preservar as condições próprias de comunicação institucional e da régua de Demurrage; testar institucional sem B/L e cobrança sem dependência de pendências de Taxas Locais. Função STABLE de leitura sozinha não serializa alteração concorrente; lock/revisão do agregado deve proteger a decisão persistida, sem segurar lock durante HTTP.
- [ ] Executar `npm test -- src/services/__tests__/portalEmailWebhook.test.ts src/services/__tests__/sendCustomerCommunicationFunction.test.ts src/services/__tests__/demurrageDunningFunction.test.ts src/integration/emailInbox.local-pg.test.ts`; esperar PASS em reordenação, duplicação, crash e corrida de dois dispatchers. Commit `fix: persist webhook processing and truthful dispatch state`.

**Job proposto:** `portal-email-events-runner`, a cada minuto (`* * * * *`), via `ops.dispatch_edge_job('portal-email-events-runner', 'PORTAL_EMAIL_EVENTS_CRON_SECRET')`. Usar segredo dedicado homônimo no Vault/Edge e mesmas provas de autenticação de S09. Retry de processamento em 1, 5, 15, 60 e 360 minutos, seis tentativas totais; após esgotamento, manter registro bloqueado e alertar para investigação, sem descartar. Ajustar janela somente com evidência da latência real de vínculo de tentativa.

**Rollout:** expandir CHECKs e leitores antes de novos estados; deploy Edge antes de ativar cron do inbox. Eventos antigos sem payload não são recuperáveis magicamente: buscar replay no provedor somente se disponível e permitido, senão registrar lacuna. Restringir leitura da chave histórica com PII; retenção/pseudonimização segue D07. **Aceite:** evento recebido duravelmente termina processado ou em fila de investigação; duplicata não duplica supressão/aviso; uma entrega seguida de pausa aparece parcial; retry não reenvia destinatário já aceito pelo provedor. **Residual:** exactly-once externo depende do provedor e da janela de idempotência; resultado ambíguo exige reconciliação antes de novo envio. **Ordem:** depois de corrigir elegibilidade, antes de qualquer liberação em massa.

### S08 — Integridade de Demurrage, descontos e PIX

**Objetivo / IDs:** dinheiro e documentos derivam de um estado validado e auditável. #658 F1–F4, F7–F8, F11, F13; contrato de emissão consumido por S05. **Prioridade:** P0 para baixa/desconto inválido; P1 para snapshot e precisão. **Dependências:** S01, S09 para cotação com procedência, D02 para autoridade de tarifa, D06 para parâmetros financeiros. D02 está aprovada; guards/desconto/cache continuam independentes da entrega do novo cálculo.

**Arquivos:** modificar `src/services/demurrage/demurrageInvoices.ts`, `src/services/demurrage/demurrageRates.ts`, `src/services/demurrage/demurrageContainers.ts`, `src/services/reconciliacao.ts`, `src/components/demurrage/InvoiceDocument.tsx`, `src/components/demurrage/PaymentModal.tsx`, `src/components/demurrage/DiscountModal.tsx`, `src/lib/pix.ts` (protegido); criar `src/integration/demurrageMoney.local-pg.test.ts`, estender testes de cálculo/discount/invoice/PIX existentes. Criar migrations `supabase/migrations/011_demurrage_mutation_guards.sql` e `supabase/migrations/014_demurrage_calculation_snapshot.sql`. Atualizar ADRs 0014/0015/0026 e módulo somente no PR correspondente.

**S08-A — guardas e correções que não dependem de mudar autoridade de tarifa.**

- [ ] Executar confirmação direta antiga sob `authenticated` ativo no PG/Preview e registrar rollback ou sucesso, incluindo ACL de history. Caso bloqueada no INSERT, classificá-la como contrato quebrado protegido incidentalmente; não relaxar ACL de histórico. Testar também chamada direta às tabelas para separar F11 de F2.
- [ ] Unificar o núcleo de confirmação, com wrapper de compatibilidade ou revogação do RPC antigo após mapear callers. Exigir role vigente, invoice bloqueada com `FOR UPDATE`, status permitido, identificador do pagamento/txid e janela das duas PTAX anteriores ou iguais à data do extrato. Não aceitar valor atual fora da janela quando há histórico nem aceitar `p_matches` como prova financeira.
- [ ] Criar contratos separados `register_demurrage_payment` e `apply_demurrage_discount`, usando assinaturas tipadas e UUID de pedido. O primeiro congela valor casado/data/recibo e histórico na mesma transação; segundo valida desconto, recalcula estado/PIX e audita, recusando documento pago/cancelado conforme contrato. Não converter desconto em evento de pagamento.
- [ ] Recusar desconto USD <0 ou >total base e percentual fora de 0–100, sem diferença SQL/UI. Desconto igual ao total produz zero explícito sem QR pagável; total negativo nunca persiste. Usar NUMERIC para operações e arredondar na fronteira monetária documentada.
- [ ] Retirar UPDATE direto de dinheiro, status de pagamento e payload dos services; fechar DML correspondente no banco sem quebrar campos operacionais legítimos. Reusar núcleos privados sob definer com grants mínimos; histórico segue sem INSERT/UPDATE/DELETE de authenticated.
- [ ] Corrigir cache de tarifas: refresh falho não renova instante do último sucesso; expor erro e idade. Para emissão, tarifa expirada além do TTL exige refresh bem-sucedido; consulta pode exibir último dado com indicação. Não limpar cache válido em todo render.
- [ ] Acrescentar constraints de sanidade intrínseca de tarifas: valores não negativos, dias inteiros/ordenados e vigência final não anterior à inicial. Pré-consultar inconsistências; corrigir dados por decisão auditada antes de VALIDATE. Manter gaps permitidos e regras distintas de acordos/tabelas.

**S08-B — snapshot de cálculo e impresso (D02 para cálculo server-side).**

- [ ] Formalizar na implementação a supersessão parcial da ADR 0026 conforme D02 aprovada: servidor resolve tarifa/acordo/override e valida conjunto de containers, datas e versão do preview. Tarifa global usa dia do cálculo, acordo usa sua âncora vigente de domínio; não substituir tudo por data de descarga. Incluir fixtures para precedência de acordo e override de free time/tarifa.
- [ ] Criar leitura de preview autoritativa e emissão com revisão esperada; payload adulterado/stale retorna conflito e exige nova conferência. Interno e worker usam o mesmo núcleo de cálculo, wrappers distintos de autorização. D02 está aprovada; manter o veto atual apenas durante a transição e concluir este núcleo antes de ativar a fila autônoma de Demurrage.
- [ ] Persistir snapshot com total USD, desconto, PTAX real quando houver, ROE, data/fonte, versão do cálculo e valores BRL de apresentação. Adotar política única para resíduo: preservar total autoritativo e distribuir centavos deterministicamente entre linhas, ou mostrar linha explícita de arredondamento; não mudar o total cobrado apenas para fechar a soma do impresso.
- [ ] Fazer documento ler snapshot/total persistido, recusar ROE ausente em documento que exige conversão e eliminar fallback 1. Histórico legado continua consultável com indicação de dado indisponível; faturas pagas não são reprecificadas. Correção de foto histórica é evento adicional, nunca UPDATE destrutivo de payment history.

**S08-C — BR Code e escritor único (F7/F8).**

- [ ] Conferir manual oficial do BCB vigente na execução para tags 01, 26/05, 62/05, txid, valor/tamanho e charset; registrar versão e vetores normativos. Confirmar escopo atual de chave CNPJ. Separar resultados por subitem F8: 26/05 e duplicação de txid; 62/05 e limite atual de 35 caracteres; presença/semântica de 01; campo 54 e limite de tamanho; normalização de acentos antes do corte de nome/cidade; chave numérica que atende ao CNPJ configurado mas não a tipos genéricos. Nome/cidade configurados hoje em ASCII limitam a manifestação do caso de acentos; builder privado não implica suporte público a todas as chaves. Não ampliar builder para todas as chaves nem migrar a PIX dinâmico sem necessidade.
- [ ] Tornar SQL a autoridade de payload persistido em emissão/recálculo/discount; TS pode permanecer como render/helper compatível, sem gravar outra versão na mesma coluna. Testar CRC, TLV e quantidade em centavos com decoder independente; concordância de dois builders errados não é teste de conformidade.
- [ ] Preservar `txid=doc_number` e reconhecimento de QR antigo na janela da ADR 0015. Campo 01 não expira QR estático. Saldo zero não gera instrução de pagamento; limite inválido falha com mensagem e impede emissão de payload incorreto.

**Vetores mínimos a implementar na suíte SQL/TS:**

| Caso | Resultado |
|---|---|
| desconto 101 sobre base USD 100 | erro; invoice e histórico inalterados |
| desconto 100 sobre base USD 100 | total zero; payload ausente |
| pagamento repetido mesmo identificador | retorna mesmo resultado, uma baixa/história |
| dois pagamentos concorrentes da mesma invoice | uma transição financeira; outro duplicado/conflito explícito |
| valor da terceira PTAX anterior | divergência, não quitação |
| tolerância de R$ 0,01 na janela Demurrage | preservar ADR 0015, sem confundir com ledger local F14 |
| soma de conversões fracionárias | soma das linhas exibidas + ajuste = total persistido, em centavos |
| falha ao inserir história | nenhuma mudança financeira persistida |
| caller Portal ou ator adulterado | recusado sem efeito |

- [ ] Executar `npm test -- src/integration/demurrageMoney.local-pg.test.ts src/services/demurrage/__tests__/applyDemurrageUsdDiscount.test.ts src/services/demurrage/__tests__/createDemurrageInvoiceAtomic.test.ts src/components/demurrage/__tests__/InvoiceDocument.behavior.test.tsx src/lib/__tests__/pix.test.ts`; exigir PASS. Commits separados `fix: enforce demurrage mutation invariants`, `fix: persist consistent demurrage document values`, `fix: use one authoritative PIX payload`.

**Compatibilidade / rollout:** migration expansiva e wrappers antes dos callers; bloquear escrita antiga ao promover contratos seguros, com tratamento de app desatualizado. Autorizar arquivos protegidos conforme §9, sem editar histórico aplicado. **Runtime:** emissão → Portal/impresso/QR → recálculo → pagamento com QR anterior → tentativa repetida → consulta de histórico. **Aceite:** total exibido = persistido = QR; pagamento válido encerra recálculo, inválido não escreve; somente writers autorizados alteram dinheiro. **Residual:** F4 server authority permanece pendente de implementação da D02 aprovada; F8 permanece pendente de conformidade; snapshot não recupera uma PTAX histórica que nunca foi gravada. **Ordem:** A cedo, B após S09/D02, C após confirmação normativa.

### S09 — ROE/PTAX com procedência e recálculo agendado

**Objetivo / IDs:** #658 F5/F9/F10/F15/F17 e #659.1; atualizar BRL sem sessão aberta e sem inventar cotação. **Prioridade:** P0/P1. **Dependências:** S01 e validação Preview S02; S08 usa o snapshot de câmbio. **Decisões D06:** manter escrita interna conforme RBAC, definir limite de sanidade/override com justificativa; execução diária às 17:00 UTC é proposta da auditoria, verificar disponibilidade de fechamento na operação.

**Arquivos:** modificar `supabase/functions/recalc-demurrage-ptax/index.ts`, `supabase/config.toml`, `src/services/demurrage/demurrageInvoices.ts`, `src/hooks/useRoeHeaderRate.ts`, `src/services/demurrage/demurrageKpis.ts`, `src/components/demurrage/PtaxModal.tsx` e os callers de `save_exchange_rate_reference`; criar `src/integration/exchangeRateIntegrity.local-pg.test.ts`, `src/services/__tests__/recalcDemurragePtax.test.ts`, migration `supabase/migrations/012_exchange_rate_provenance.sql`, com criação de job inicialmente inativo; se a entrega for desdobrada, alocar o próximo inteiro conforme §5. Atualizar ADRs 0014/0063 e WORKFLOW na execução.

**Contratos SQL:** `save_exchange_rate_reference`, `recalculate_demurrage_invoices`, foto inicial de `create_demurrage_invoice`, `ops.dispatch_edge_job`, função privada canônica de spread. Valor `NUMERIC` finito/positivo; procedência inclui `source`, `quote_date`, `ptax` real ou NULL e ROE aplicado. Não reconstruir PTAX com divisão em cotação manual sem fonte.

- [ ] Criar casos de zero, negativo, null, cotação inválida e alteração concorrente com pagamento. A atualização deve ser transacional e respeitar lock da invoice; uma fatura paga durante o recálculo não pode terminar com valor novo sem correspondência ao pagamento.
- [ ] Centralizar spread 1,065 em função SQL usada por emissão, recálculo e leituras que precisam da regra. Snapshot guarda resultado/versão; TS não recalcula spread independentemente. Não exigir decimal binário idêntico a NUMERIC; comparar valores canônicos e centavos.
- [ ] Persistir par PTAX/ROE verdadeiro para fonte BCB e origem manual explícita quando só há ROE. Eliminar fallback inverso da foto inicial; selecionar histórico pela data efetiva, sem empregar cotação de data posterior ao pagamento. Registros antigos de origem incerta ficam identificados, não corrigidos por dedução.
- [ ] Usar dia de negócio `(now() AT TIME ZONE 'America/Sao_Paulo')::date` na primeira emissão/âncoras da régua. Manter timestamp UTC de auditoria e data da publicação BCB como fatos distintos. Testar 02:59/03:00 UTC e sexta/feriado sem nova publicação; não alterar datas antigas em massa.
- [ ] Tornar fetch BCB limitado e recuperável: timeout por tentativa, três tentativas para timeout/429/5xx com backoff e jitter dentro do orçamento Edge; schema inválido/valor não positivo falha sem recálculo. Falha persistente abre alerta interno idempotente e conserva última cotação com indicação de desatualização, sem apresentá-la como nova.
- [ ] Validar Preview gateway: hoje `verify_jwt=true`, enquanto dispatcher usa bearer `RECALC_CRON_SECRET`. Se o gateway impedir o bearer dedicado, seguir padrão dos demais jobs: `verify_jwt=false` somente junto da autenticação própria fail-closed já exercitada com segredo ausente/errado/correto. Publicar Edge/config antes de ativar job; nenhuma rota deve aceitar anon por esse ajuste.
- [ ] Criar job nomeado e idempotente usando comando exato abaixo, inicialmente inativo até segredo/Edge validados. `RECALC_CRON_SECRET` tem mesmo valor no Vault e no secret da Edge daquele ambiente; SQL contém apenas nome do segredo. Não usar service_role como secret de cron nem expor valor no log.

```sql
-- Correcao 2026-09-09: `UPDATE cron.job` exige privilegio de tabela que o papel
-- de migrations do Supabase nao tem (42501) e aborta o replay. O agendamento
-- saiu da migration e virou passo operacional; ver
-- docs/operations/segredos-cron.md, "Agendar o recalculo de PTAX".
SELECT cron.schedule(
  'recalc-demurrage-ptax',
  '0 17 * * 1-5',
  $$SELECT ops.dispatch_edge_job('recalc-demurrage-ptax', 'RECALC_CRON_SECRET');$$
);
-- Pausar, se necessario, pela funcao da extensao:
-- SELECT cron.alter_job(jobid, active := false) FROM cron.job
-- WHERE jobname = 'recalc-demurrage-ptax';
```

- [ ] Verificar dispatcher/Vault e job em Preview real: sem segredo deve falhar fechado e alertar; autorizado atualiza uma invoice aberta e preserva paga. Repetição da mesma publicação não cria outra foto idêntica. Só então ativar pelo procedimento operacional registrado; verificar uma execução agendada real, não apenas chamada manual.
- [ ] Executar `npm test -- src/services/__tests__/recalcDemurragePtax.test.ts src/integration/exchangeRateIntegrity.local-pg.test.ts src/services/__tests__/demurrageRecalcAndPixWindowMigration.test.ts`; esperar PASS. Commit `fix: preserve exchange provenance and schedule PTAX recovery`.

**Compatibilidade / rollout:** dois estágios no mesmo subprojeto, procedência e job; pode dividir PR mantendo sequência de migrations. Se corrigir apenas job antes do snapshot, restringir canário e registrar F9 ainda aberto. **Aceite:** exatamente um job por ambiente com agenda/config/secret coerentes, execução real confirmada, falha BCB gera sinal persistente, replay não duplica história. **Residual:** publicação atrasada e indisponibilidade externa continuam possíveis; fallback manual precisa de procedência e sanity check. Não aplicar uma variação máxima arbitrária como regra comercial sem D06. **Ordem:** primeira onda financeira, antes de emissão durável autônoma.

### S10 — Ledger local, rateio e fronteiras de prontidão

**Objetivo / IDs:** #658 F6/F12/F14/F16/F17, parte local de F7. Separar três fatos: cálculo conferível, emissão permitida e comunicado pronto. **Prioridade:** P1. **Dependências:** S01, procedência/data S09, S11 para tipos; núcleo de readiness é dependência de S07. **Decisões:** D05 para centavo residual local e eventual mudança na premissa do compartilhamento tardio. Não aplicar regra de pagamento parcial local ao Demurrage.

**Arquivos:** modificar `src/services/billing.ts`, `src/services/billingLedger.ts`, `src/services/reconciliacao.ts`, `src/services/charges/chargeOperationsService.ts`, `src/services/customerCommunicationReadiness.ts`, `src/components/billing/InvoiceDocumentLocal.tsx`, `src/components/portal/PortalBillingTabs.tsx`; criar `src/integration/localBillingIntegrity.local-pg.test.ts`, migration `supabase/migrations/019_local_billing_integrity.sql`; estender testes de ledger/PIX, readiness e documento. Atualizar ADRs 0007/0020/0038/0040/0051/0054/0055 e módulos apenas no recorte alterado.

**Contratos SQL:** `register_ledger_invoice_payment`, `reconcile_invoice_payment_by_txid`, núcleos de `create_invoice_from_bls`/`create_local_consolidated_invoice`, `compute_bl_review_pendencies` e overloads, readiness de comunicação e `create_customer_communication_atomic`.

- [ ] Criar teste de invoice local R$ 100,00, pagamento R$ 99,99 e comparação entre status, recebido e saldo do ledger. Exercitar caminho manual e PIX, sem assumir que este é exato. Antes da correção deve reproduzir o fechamento inconsistente onde o SQL permite diferença de um centavo.
- [ ] Implementar D05 aprovada em um núcleo: qualquer saldo positivo, inclusive R$ 0,01, continua em aberto e a invoice parcialmente paga. Para R$ 100,00 devidos e R$ 99,99 recebidos, persistir recebido R$ 99,99 e saldo R$ 0,01; não criar baixa automática, ajuste de dispensa ou centavo recebido fictício. Aplicar igualmente ao pagamento manual e PIX local. Preservar a tolerância da janela Demurrage ADR 0015 como regra separada.
- [ ] Testar soma de pagamentos parciais, excedente/restituição, estorno, invoice obsoleta, consolidação/reconsolidação e COD; toda alteração precisa reconciliar saldo dos recebíveis, invoice e eventos na mesma transação. Idempotência por identificador do evento financeiro e locks por recebível/invoice, em ordem estável.
- [ ] Usar conjunto único de linhas elegíveis no cálculo de necessidade de ROE, inserção dos itens e totalização. Isento não entra no valor faturável mesmo se dado legado contiver valor positivo; esse dado vai para diagnóstico. Testar BRL, USD, misto, isento, review_required, cancelado e sem item cobravel; não criar invoice vazia.
- [ ] Manter precisão do rateio e a regra SQL de distribuição do resíduo. No impresso, exibir fração ou descrição que explique `1/7` sem sugerir multiplicação por `0,14` como valor exato; total da linha é o valor persistido. Testar 3 e 7 B/Ls compartilhando container, centavos e reordenação de linhas.
- [ ] Fazer consulta diagnóstica de irmãos com CE/faturamento em momentos divergentes, sem recalcular. Se houver caso real, levar D05 à operação e decidir alerta/bloqueio de novo cálculo ou ajuste manual. Não cancelar/reemitir irmãos nem alterar documento pago automaticamente; a ADR 0020 aceita a premissa de CE simultâneo.
- [ ] Consolidar critérios de emissão da ADR 0054 em núcleo server-side: conta ativa, situação de acesso utilizável, auth_user_id, recovery_email válido e não suprimido. Verificar individual, consolidada e Granito no wrapper correto. Cálculo continua permitido com Portal pendente; emissão é que bloqueia.
- [ ] Fazer overloads de pendências delegarem ao mesmo contrato e usar precedência explícita cliente → cálculo → CE → Portal, conforme contexto da fila; não ordenar mensagens alfabeticamente. Nomear motivo Portal sem convertê-lo em “Cálculo incompleto”. Não introduzir CE no gate de revisão que deliberadamente não o exige: CE é condição do fluxo de emissão/confirmação.
- [ ] Readiness do comunicado de CE Mercante e Taxas Locais (`ce_mercante_taxas`), exclusivamente, exige todos os B/Ls do cliente/viagem com CE, revisão liberada e financeiro concluído. Avaliar na criação/claim do comunicado, com revisão/lock, e revalidar no envio; não chamar essa leitura de autorização de emissão. Passar identidade de sistema pelo núcleo privado, sem forjar sessão interna no runner.
- [ ] Executar `npm test -- src/integration/localBillingIntegrity.local-pg.test.ts src/services/__tests__/customerCommunicationReadiness.test.ts src/components/billing/__tests__/InvoiceDocumentLocal.behavior.test.tsx`; esperar PASS. Separar commits `fix: reconcile local ledger settlement amounts`, `fix: align invoice eligibility and communication readiness`, `fix: explain shared-container invoice quantities`.

**Compatibilidade / rollout:** RPCs antigas delegam ao mesmo núcleo durante transição; mudança de política financeira exige ADR antes da migration. Auditar divergências existentes em relatório somente leitura; backfill de saldo só com origem comprovada e ato financeiro autorizado. **Runtime:** simulação com recebimento parcial/estorno/COD e Portal bloqueado; comparação de SQL, tela, impresso, QR e fila de comunicado. **Aceite:** `saldo = devido − liquidações − ajustes` em centavos e coerente com status; zero emissão sem gate; nenhuma mensagem enviada com prontidão invalidada antes do claim. **Residual:** corrida entre validação final e entrega HTTP é inevitável sem API transacional externa; snapshot de decisão torna-a auditável. **Ordem:** readiness pode preceder ledger para liberar S07; políticas financeiras não se misturam na mesma PR com UI.

### S11 — Paridade de Inspeção e tipos do schema final

**Objetivo / IDs:** #659.3/4, §1.4 e cast obsoleto §3.1; preparar paginação de Portal. **Prioridade:** P1. **Dependências:** S01; regeneração reexecutada a cada migration futura. **Decisões:** autorização para arquivo protegido; preservar leitura interna global, Inspeção sem escrita e sem login fictício (ADR 0045).

**Arquivos:** criar migration `supabase/migrations/013_portal_disputes_inspection.sql`, `src/services/portalRpcContracts.ts`, `src/integration/portalInspectionParity.local-pg.test.ts`; modificar `src/services/portalScope.ts`, `src/services/portalBilling.ts`, `src/hooks/usePortalDisputes.ts`, `src/types/database.ts`, `src/services/billingLedger.ts`, `src/services/transshipments.ts`, `src/components/bl/BlOperacionalTab.tsx`. Se necessário separar complementos manuais, criar `src/types/database.extensions.ts` e `scripts/generate-database-types.mjs`; o gerador deve manter exports consumidos. Atualizar rastreabilidade e ADR 0045 na execução.

- [ ] Criar teste de disputa com Cliente A/B, Portal A e Inspeção interna A: mesmos dados permitidos, nenhuma disputa B e nenhuma ação de escrita habilitada em inspeção. Teste inicial deve detectar ausência de `portal_inspect_list_disputes`.
- [ ] Extrair `_portal_list_disputes_core(p_customer_id bigint)` com retorno idêntico à leitura atual; wrapper Portal resolve `current_portal_customer_id()`, wrapper `portal_inspect_list_disputes(p_customer_id bigint)` usa `_portal_inspect_guard`. Núcleo privado sem EXECUTE externo, wrappers com search_path fixo e grants explícitos. Preservar overview especial de `portal_open_inspection`.
- [ ] Substituir construção livre de nome por mapa literal completo dos contratos de leitura e escrita. Enumerar também variantes de `callReportIdAwareRpc`, marcando diferenças de argumentos. O mapa serve ao dispatcher, teste contra catálogo e geração do índice. Escrever teste de completude: todo caller tem entrada e toda leitura inspecionável tem wrapper real; nenhuma escrita ganha variante.
- [ ] Gerar tipos contra replay completo, comparar com catálogo final e remover RPCs fantasma/ajustar `settle_cod_adjustment`. Não usar contagem 55/6 como lista eterna, nem editar blocos gerados à mão. Separar aliases/complementos que a aplicação usa antes de substituir arquivo para não perder exports.

```bash
npx supabase@2.113.0 gen types typescript \
  --db-url postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test \
  --schema public > /tmp/transhipping-database-schema.generated.ts
```

Este comando é somente de execução futura, para o banco descartável de §6; não exporta schema de produção. Conferir a versão do CLI no workflow ao executar. O arquivo temporário serve para diff/extração; a versão final deve ser reproduzível pelo gerador, sem misturar edição manual no bloco gerado.

- [ ] Remover os três adapters citados apenas quando o compilador aceitar os parâmetros reais. Retirar cast/comentário de `notify2_block`/`consignee_phone` já tipados. Adicionar teste de contrato de assinatura gerada vs `pg_proc`, cobrindo overloads e tipos de retorno usados, sem uma allowlist silenciosa de drift.
- [ ] Executar `npm run typecheck` e `npm test -- src/integration/portalInspectionParity.local-pg.test.ts src/pages/__tests__/PortalBilling.test.tsx`; esperar PASS. Commits `fix: restore portal dispute inspection parity` e `chore: regenerate database contracts from active schema`.

**Compatibilidade / rollout:** migration antes do dispatcher; mapa mantém assinaturas públicas. Query keys incluem modo/cliente/filtros para não reutilizar cache A em B. Regerar tipos de todo novo RPC nos PRs de domínio, não apenas no fechamento. **Runtime:** abrir faturamento em Inspeção e Portal, alternar clientes, verificar leitura e ausência de write/last_login indevido. **Aceite:** nenhum caller declarado aponta para contrato ausente, nenhum adapter mascara assinatura errada; resultados iguais para escopo equivalente. **Residual:** catalogar não testa todas as regras de negócio; executar chamadas representativas e manter testes por domínio. **Ordem:** primeira onda, após S01.

### S12 — Leituras proporcionais à página e projeção compartilhada

**Objetivo / IDs:** #656 §§1.1–1.5; #659 §3.1 projeção, §3.2 B/L/Painel/Portal e §4.4. **Prioridade:** P1 para varredura no caminho quente, P2 para redução de waterfall; memoização só medida. **Dependências:** S11 para contratos de Portal/tipos; pode iniciar debounce em S13. **Decisões:** manter filtros derivados e contadores corretos; limite visual TV não autoriza esconder histórico do Painel.

**Arquivos:** modificar `src/hooks/useBls.ts`, `src/services/bls.ts`, `src/services/containers.ts`, `src/services/voyages.ts`, `src/services/lineup.ts`, `src/services/voyageRouteSchedules.ts`, `src/services/agencyDepartureReport.ts`, `src/pages/EmbarqueVazios.tsx`, `src/pages/Baplie.tsx`, `src/pages/Painel.tsx`, `src/components/portal/PortalBillingTabs.tsx`; criar `src/services/operationalLists.ts`, `src/integration/operationalLists.local-pg.test.ts`, migration `supabase/migrations/020_operational_read_pages.sql`; estender `src/services/__tests__/lineupSnapshot.test.ts`, `src/services/__tests__/lineupScheduleDates.test.ts` e testes de filtros existentes. Índices só após EXPLAIN no dado sintético representativo.

**Contratos SQL propostos:** página e resumo de B/L/containers com os mesmos filtros canônicos, lista resumida de viagens e snapshot de Line Up; limite máximo de página 100, ordem total com ID de desempate. Portal usa núcleos escopados com dois wrappers. RPCs de consulta interna usam helper de leitura incluindo Equipamentos; consultas agregadas não podem escapar da política de escopo.

- [ ] Medir baseline com 100, 1000 e 10000 B/Ls sintéticos, containers compartilhados e múltiplas escalas. Registrar requests, bytes, EXPLAIN e p95 de leitura, hardware/ambiente; não tratar 550–850 ms da auditoria de parser como métrica dessas consultas.
- [ ] Reproduzir filtros derivados e contagens num contrato SQL paginado antes de trocar UI. Testar combinação de busca, status financeiro/revisão, rota, viagem e compartilhamento; resumo pode ter escopo diferente da página apenas se isso já é explícito no produto. Não calcular resumo a partir só da página.
- [ ] Substituir full-scan de containers/B/L por filtro/ordem/paginação no banco e opções distintas filtradas server-side. Usar `.range()` ou RPC conforme necessidade de derivação; não introduzir SECURITY DEFINER onde RLS/invoker basta. Se definer for necessário, exigir helper/escopo antes da query.
- [ ] Separar resumo de viagem dos embeds de detalhe, carregando detalhe ao selecionar. Para Line Up, reunir agregados em consulta/snapshot de leitura que preserve omissões, POL documental, escala/atracação, somente embarque e vazios; evitar consulta por linha. Não inferir que `port_calls` precisa existir para isso.
- [ ] Fazer EmbarqueVazios e agencyDepartureReport consumirem a projeção já responsável por união normalizada POL/POD/EXP, preservando terminais/relatórios fechados. Retirar somente duplicação obsoleta. Mover leitura auditada de Baplie.tsx para serviço e hook existente, sem remodelar a página toda.
- [ ] Oferecer janela/“carregar mais” no Painel ao exceder 60 viagens; TV mantém limite de exibição documentado e refresh 30 s sem refazer cadeia inteira. Paginar ambas as listas de PortalBillingTabs por cliente com total/filtros, incluindo wrappers de Inspeção.
- [ ] Se medição S06 confirmar teto de supressão por cliente, adicionar RPC server-side filtrada/paginada para conferência completa. Caso contrário, manter mitigação e registrar gatilho; não atrasar correções de caixas para otimizar caso não ocorrido.
- [ ] Comparar profiler antes/depois. Só adicionar `React.memo`/callbacks estáveis a linhas cujo custo e invalidação sejam demonstrados; não habilitar React Compiler ou virtualização global por contagem de usos.
- [ ] Executar `npm test -- src/integration/operationalLists.local-pg.test.ts src/services/__tests__/lineupSnapshot.test.ts src/services/__tests__/lineupScheduleDates.test.ts` e `npm run perf:authenticated-startup`; esperar filtros/contagens idênticos e ausência de regressão do orçamento existente. Commits separados por lista e snapshot.

**Compatibilidade / rollout:** RPCs de leitura novas antes dos hooks; remover consultas antigas depois de paridade. Novos índices com plano e custo conhecidos; migração não deve incluir alteração monetária. **Aceite:** página de 100 não transfere a tabela completa; requests por refresh permanecem limitados independentemente do número de linhas; histórico >60 é acessível; Portal A/B continua isolado; em 10000 B/Ls há redução mensurável de bytes e p95 vs baseline, com alvo definido no primeiro benchmark. **Residual:** totalizações ainda podem custar O(tabela) no servidor; EXPLAIN determina índice/cache, não promessa de custo constante. **Ordem:** depois de riscos de integridade; pode ser dividido em três PRs independentes por consumidor.

### S13 — Busca, offline, feedback e acessibilidade

**Objetivo / IDs:** #656 §3.2/3.3/5.1–5.3, avaliação §1.4; #657 P3-02/P3-03; progresso #654 §4. **Prioridade:** P1 para offline e falha silenciosa, P2 para interação. **Dependências:** nenhuma para correções locais; integrar estados das novas queries S12. **Decisões:** perfil com erro transitório não autoriza ações; nenhum perfil antigo de outro usuário pode sobreviver à troca de sessão.

**Arquivos:** modificar `src/hooks/useBls.ts`, `src/hooks/useAuth.tsx`, `src/components/layout/AppLayout.tsx`, `src/components/layout/PortalLayout.tsx`, `src/components/layout/InternalNotificationBell.tsx`, `src/components/ui/ConfirmDialog.tsx`, `src/components/ui/Modal.tsx`, `src/pages/ClientesComunicacao.tsx`, `src/pages/ChegadasSaidas.tsx`, `src/components/billing/InvoiceCommunicationStatusCell.tsx`, `src/pages/Manifestos.tsx`, `src/pages/Containers.tsx`, `src/pages/CargaSolta.tsx`, `src/pages/Veiculos.tsx`, `src/pages/Granite.tsx`, `src/pages/VaziosImportacao.tsx`, `src/components/voyages/VoyageFilters.tsx` e `src/index.css`; criar `src/hooks/useDebouncedValue.ts`, `src/hooks/__tests__/useDebouncedValue.test.ts`, `src/components/shared/QueryStateGate.tsx`, `src/components/shared/__tests__/QueryStateGate.test.tsx` e `src/hooks/__tests__/useAuthHydrationFailure.test.tsx`; estender `src/components/layout/__tests__/InternalNotificationBell.test.tsx`. O gate compartilhado serve aos shells interno e Portal, sem duplicar estado de conexão. **Migrations:** nenhuma.

- [ ] Cobrir busca com relógio falso: várias teclas em menos de 300 ms geram uma mudança de query após a pausa; selecionar filtro não espera debounce de texto. Extrair o padrão de 300 ms já existente no Combobox para o helper e aplicar a todas as listas auditadas, mantendo URL/limpeza/página inicial consistentes. Requests antigos não podem sobrescrever resultado mais novo.
- [ ] Testar query pausada offline sem cache e offline com dados anteriores. Primeiro caso mostra indisponibilidade, segundo conserva dados com indicação; nenhum mostra “nenhum registro” como fato confirmado. Reconnect retoma a leitura; escrita offline não é anunciada como salva e não ganha replay financeiro automático pelo browser.
- [ ] No sino, erro de marcar lida mostra aviso acionável, restaura estado otimista/contador e permite retry sem duplicar notificação. Preservar logging existente e invalidar apenas query keys pertinentes.
- [ ] Reproduzir P3-03 em hidratação inicial, troca de usuário, timeout e perfil inativo/removido. Distinguir `loading`, `error` e `unauthorized`; erro transitório permite recarregar perfil com ações bloqueadas, sem logout desnecessário se sessão Auth continua válida. Perfil confirmado inativo/revogado elimina acesso; não reutilizar autorização antiga para esconder falha.
- [ ] Substituir as quatro confirmações nativas restantes pelo ConfirmDialog existente, com descrição da entidade/efeito e foco previsível. Modal sujo intercepta backdrop/Escape/fechar; não exigir confirmação de formulário sem alteração. Preservar listeners corrigidos de Containers/Manifestos; não reaplicar a correção histórica.
- [ ] Medir contraste de texto normal >=4,5:1 e elementos/grandes textos conforme critério aplicável em fundos reais dos dois temas. Ajustar tokens compartilhados e verificar estados hover/disabled/status, sem copiar cor sugerida na auditoria sem medição. Informações de status não dependem apenas de cor.
- [ ] Implementar caption acessível, `aria-sort` no header ordenado, botão real para ordenar/abrir ação, menu por teclado e retorno de foco. Uma linha clicável precisa de ação equivalente por teclado; não transformar tabela em grid ARIA complexo sem necessidade.
- [ ] Nos uploads suportados, exibir progresso por fase/arquivo, permitir cancelamento entre unidades e ceder execução entre blocos. Medir long tasks em arquivo próximo do limite. Worker só se bloqueio persistir no benchmark; reavaliar >3 MB de Baplie sem aumentar automaticamente teto.
- [ ] Executar `npm test -- src/hooks/__tests__/useAuthProfileHydration.test.ts src/components/ui/__tests__/Modal.test.tsx src/components/billing/__tests__/InvoiceCommunicationStatusCell.test.tsx` e `npm test -- src/hooks/__tests__/useDebouncedValue.test.ts src/components/shared/__tests__/QueryStateGate.test.tsx src/hooks/__tests__/useAuthHydrationFailure.test.tsx src/components/layout/__tests__/InternalNotificationBell.test.tsx`; esperar PASS. Commits pequenos `fix: show offline and mutation failures`, `fix: debounce operational searches`, `fix: make audited controls keyboard accessible`.

**Compatibilidade / rollout:** sem schema, alterações reversíveis; mensagens usam linguagem operacional, sem expor SQL/stacktrace. **Runtime:** teclado sem mouse, leitor de tela, duas abas, offline/reconnect, formulário sujo e light/dark em Preview autenticado; medir contraste e número de requests. **Aceite:** nenhuma falha de rede parece lista vazia/sucesso; todas as ações auditadas alcançáveis por teclado; foco retorna ao acionador; busca respeita 300 ms; listeners permanecem estáveis após mount/unmount. **Residual:** leitores de tela/latência reais não são cobertos só por jsdom; registrar teste manual. **Ordem:** entregar partes independentes cedo, sem esperar S12 completo.

### S14 — Rastreabilidade verificável e retirada criteriosa de legado

**Objetivo / IDs:** #659.5/6/7/9, §3.4 ponte de testes/DV; preservar fatos documentais já corrigidos. **Prioridade:** P1 para prevenção de drift, P2/P3 para limpeza. **Dependências:** S01 (catálogo), S11 (mapas/tipos); remover legado só depois de verificar schema e uso atual. **Decisões:** D07/D09 para dados/retencão/DV; promoção de escala a tabela está fora do escopo aceito.

**Arquivos:** modificar `scripts/check-docs.mjs`, `scripts/check-squash-replay.sql`, `src/test/setup.ts` somente se necessário distinguir suítes, `src/services/__tests__/consolidatedSchemaInvariants.test.ts`, `src/integration/rpcFinalDefinition.local-pg.test.ts`, `src/lib/portalCnpjLogin.ts` apenas após D09; criar `scripts/check-rpc-catalog.mjs`, `src/integration/rpcCatalog.local-pg.test.ts`, `src/services/__tests__/documentationContracts.test.ts` e, condicionalmente, migration `supabase/migrations/021_remove_verified_legacy.sql`. Na execução atualizar `docs/RASTREABILIDADE.md`, módulos/índices pertinentes e ADR 0062 com cobertura real, preservando archive.

- [ ] Derivar inventário do catálogo final e mapa literal S11, cruzando rotas → componentes → hooks → serviços → RPC/args/grants → tabelas → testes. Completar as famílias ausentes de PIX, notificações, vazios manuais e os demais itens identificados; incluir hooks e tabelas do residual, sem recontar buckets como tabelas. Nenhum caminho ou teste planejado pode aparecer como cobertura entregue.
- [ ] Fortalecer docs:check nos dois sentidos para rotas vivas e existência de arquivos citados; excluir archive e classificar explicitamente referências históricas legítimas e arquivos “a criar” de planos. Não exigir existência de uma tarefa futura nem criar `/line-up-tv` para satisfazer texto histórico. Testar path inexistente, rota inventada, rename histórico legítimo e referência a teste real.
- [ ] Criar gate de catálogo executado: RPCs chamadas existem com assinatura esperada, wrappers dinâmicos completos, grants default-deny e jobs obrigatórios presentes; validar função quebrada mesmo se CREATE FUNCTION passou. Compor com security checker em S01; não confiar só em regex de corpos SQL ou contagem de funções.
- [ ] Manter testes históricos da ponte ativo+archive identificados como históricos; migrar invariantes críticas à execução do replay 001–última. Não remover 201 testes em lote nem alegar que uma asserção textual do archive prova comportamento atual.
- [ ] Conferir as 14 candidatas abaixo contra `pg_depend`, corpos PL/pgSQL, mapa dinâmico, triggers, `cron.job`, scripts e usos externos observáveis. Dependências dinâmicas podem não estar em `pg_depend`; ausência de chamada em TS não basta. Registrar assinaturas e resultado da inspeção antes de remover.

| Candidata | Argumentos de identidade |
|---|---|
| `portal_get_current_roe_legacy` | nenhum |
| `portal_get_profile_legacy` | nenhum |
| `portal_get_demurrage_invoice_detail_legacy` | bigint |
| `portal_invoice_details_legacy` | bigint |
| `portal_list_consolidatable_receivables_legacy` | nenhum |
| `portal_list_demurrage_invoices_legacy` | nenhum |
| `portal_list_notifications_legacy` | integer |
| `portal_list_operation_bls_legacy` | nenhum |
| `portal_list_operation_bls_without_transshipment_legacy` | nenhum |
| `portal_list_provisioning_console_legacy` | bigint |
| `portal_list_provisioning_events_legacy` | bigint, integer |
| `portal_notification_unread_count_legacy` | nenhum |
| `close_legacy_agency_report_alerts_for_scale` | bigint, text |
| `reconcile_bl_review_alerts_item` | text, text, text, text, text[], text |

- [ ] Remover apenas candidatas comprovadas com `DROP FUNCTION assinatura RESTRICT`, em migration nova. `portal_list_operation_bls_legacy()` entra como retirada da função morta quebrada, não como restauração do nome ausente. Preservar explicitamente os sete elos vivos de import (`import_bl_freight_transactional_legacy_205/284/322/357`, `import_manifest_transactional_legacy_165`, `import_granite_manifest_transactional_legacy_136`, `save_granite_bl_review_legacy_148`), jobs e event triggers.
- [ ] Investigar `alerts.notified_at`, `bls.consignee_address`, `charge_calculations.reviewed_at`, `customer_portal_sessions.last_seen_at` com contagem/preenchimento/consumidores externos. Remover coluna só com utilidade descartada e backup específico; se consignee_address é dado documental necessário, propor correção de captura vinculada ao achado, não DROP. Manter as duas write-only aceitas.
- [ ] Para DV, consultar apenas contagens de documentos válidos/inválidos e distinguir dados sintéticos dos reais; validar formato numérico/alfanumérico conforme contrato vigente antes de ativar restrição. Sem decisão sobre fixtures e tratamento de clientes existentes, não bloquear login. Resposta de autenticação continua genérica, preservando anti-enumeração/rate limit.
- [ ] Executar `npm run docs:check`, `npm test -- src/integration/rpcCatalog.local-pg.test.ts src/integration/rpcFinalDefinition.local-pg.test.ts src/services/__tests__/consolidatedSchemaInvariants.test.ts` e `LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test node scripts/check-rpc-catalog.mjs`; o novo script deve ler essa variável, recusar ambiente ausente e emitir erro por assinatura incompatível. Esperar PASS e zero referência ativa inexplicada. Commits `chore: verify live RPC and documentation contracts` e, somente após prova, `chore: remove unused legacy database contracts`.

**Compatibilidade / rollout:** primeiro observar/medir, depois retirar; `DROP RESTRICT`, sem CASCADE. Arquivar corpo original e preflight de dependências no PR para restauração em migration nova se necessário. Não alterar migrations_archive nem fatos históricos. **Aceite:** todos os contratos chamados têm linha/mapa/teste de existência; grants/jobs finais são verificados por SQL real; nenhuma função viva removida. **Residual:** consumidores externos sem telemetria impedem provar ausência absoluta; manter função fechada é alternativa aceitável e deve constar como investigação, não remoção concluída. **Ordem:** checker cedo, índice ao longo dos PRs, limpeza por último.

## 5. Sequência recomendada de PRs

Os nomes abaixo são títulos propostos, não PRs criadas. Cada PR deve terminar funcional e testável. A numeração SQL é uma **proposta de integração serial no baseline 001–008**: se `main` avançar, usar o próximo inteiro livre e renumerar apenas migration ainda não aplicada. Nunca duas migrations `009` concorrentes, timestamp, sufixo `a` ou renumeração de histórico aplicado.

| Ordem | Entrega | Subprojeto / IDs | SQL proposto | Gate de saída |
|---|---|---|---|---|
| 01 | Fechar RPCs expostas e revogação do Portal | S01, #659.2/#660.1/3 | `supabase/migrations/009_rpc_entry_security.sql` | ACL/roles/token e triggers no replay + Preview |
| 02 | Tratar lifecycle do Provision Preview Admin | S02 | nenhum | PR aberta provisionada; obsoleta não escreve |
| 03 | Corrigir fallback e elegibilidade de cobrança | S06, A1/A3/A9 | `supabase/migrations/010_contact_routing_and_dunning_eligibility.sql` | caixa/principal/supressão/starvation |
| 04 | Fechar baixa/desconto direto e cache de Demurrage | S08-A, F2/F3/F4-cache/F11/F13 | `supabase/migrations/011_demurrage_mutation_guards.sql` | dinheiro/história atômicos, sem abrir history DML |
| 05 | Preservar procedência e habilitar recálculo diário | S09, F5/F9/F10/F15/F17/#659.1 | `supabase/migrations/012_exchange_rate_provenance.sql` | Edge/auth/secret/cron real; job inicialmente inativo |
| 06 | Restaurar Inspeção de disputas e tipos | S11, #659.3/4 | `supabase/migrations/013_portal_disputes_inspection.sql` | igualdade de escopo e typecheck |
| 07 | Corrigir coerção numérica | S03, P0-1 | nenhum | vetores decimal/peso/valor de Granito |
| 08 | Corrigir bytes, grupos Baplie e schemas | S03, P0-2/P0-3/§2 | nenhum | round-trip, isolamento de grupos, preview bloqueante |
| 09 | Unificar identidade de navio/viagem | S03, P0-4 | nenhum inicialmente | alias e IMOs distintos; conflito explícito |
| 10 | Fixar snapshot de Demurrage e escritor PIX | S08-B/C, F1/F4-autoridade/F7/F8 | `supabase/migrations/014_demurrage_calculation_snapshot.sql` | D02 + referência BR Code; documento=SQL=QR |
| 11 | Aplicar datas/flags em transação | S04, P1-01/#659.8 | `supabase/migrations/015_import_dates_and_flags_atomic.sql` | falha na última linha/auditoria desfaz unidade |
| 12 | Fechar caudas de metadados e conflito de omissão | S04, P2-01/P3-01/#654§3.3 | `supabase/migrations/016_import_metadata_and_omission_conflicts.sql` | atomicidade por unidade e corrida de omissão |
| 13 | Persistir efeitos e relatório de import | S05, P1-02/P2-02 residual | `supabase/migrations/017_import_effects_outbox.sql` | crash/lease/replay, worker inicialmente pausado |
| 14 | Unificar gate de emissão e readiness | S10, F12 | primeira parte de `018` se separada | Portal/revisão/CE distintos; sistema sem ator forjado |
| 15 | Persistir inbox e estados de envio | S07, A2/A4/A5/A8 | próximo número após PR14; nome `email_inbox_and_dispatch_state` | eventos fora de ordem e envio parcial |
| 16 | Fechar ledger, status/itens e rateio do impresso | S10, F6/F14/F16/F17 | próximo número; nome `local_billing_integrity` | D05 e soma em centavos |
| 17 | Paginar listas e resumo; reduzir snapshot | S12 | próximo número; nome `operational_read_pages` | filtros/escopo e baseline de performance |
| 18 | Debounce, offline, feedback e acessibilidade | S13 | nenhum | comportamento, teclado e contraste |
| 19 | Completar índice e gate de catálogo | S14/#659.7 | nenhum | docs:check + catálogo; sem repetir fatos corrigidos |
| 20 | Retirar legado confirmado / DV condicional | S14/#659.5/6/9 | próximo número; nome `remove_verified_legacy` | evidência de uso/dados; DROP RESTRICT |

Para evitar falsa precisão após desdobrar PR14, os nomes numerados nos subprojetos são posições de referência, não reserva no remoto: registrar no corpo de cada PR o arquivo final alocado. Se readiness ficar junto de S07, a sequência compacta é `supabase/migrations/018_email_inbox_and_dispatch_state.sql`, `supabase/migrations/019_local_billing_integrity.sql`, `supabase/migrations/020_operational_read_pages.sql`, `supabase/migrations/021_remove_verified_legacy.sql`. Se vier antes em PR própria, usa `018` e desloca os posteriores em +1. O autor de cada PR deve rebasear e conferir o replay de `main + sua migration` antes do merge.

PRs 07–09 e 18 podem avançar antes de 04–06 por serem independentes de SQL; a ordenação não justifica manter parser P0 incorreto enquanto se discute autoridade de tarifa. A ativação dos workers/cron/envios é etapa operacional distinta da criação do schema. Não habilitar comunicações reais só porque PR03 foi mergeada: A2/A4 e prontidão também precisam passar.

## 6. Estratégia de testes e validação

### 6.1 Camadas de prova e comandos

**Nesta sessão:** apenas `npm run docs:check` e inspeção do diff para o plano. Nenhum teste de implementação, replay, seed, envio ou migração remota é necessário nem autorizado para produzir o documento.

**Na execução de cada PR:** Node conforme `package.json` (24.x no baseline), dependências pelo lockfile e os testes estreitos indicados no subprojeto. Confirmar RED pelo comportamento que se quer corrigir, não por import quebrado acidental. Depois da correção, confirmar GREEN e executar gates aplicáveis:

```bash
npm ci --legacy-peer-deps
npm run docs:check
npm run typecheck
npm run lint
npm test
npm run build
npm run size-limit
python scripts/security/verificar_guardas.py --ci
```

Instalar dependências apenas se necessário; não repetir `npm ci` a cada pequeno commit. `size-limit` usa artefato de build. Para PR documental, não rodar suíte inteira sem motivo.

**Replay local descartável:**

```bash
scripts/setup-local-pg.sh --reset
LOCAL_PG_INTEGRATION=1 \
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test \
  npm test -- src/integration
psql postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test \
  -v ON_ERROR_STOP=1 -f scripts/check-squash-replay.sql
```

Usar `LOCAL_PG_INTEGRATION=1` e `LOCAL_DATABASE_URL` também nos comandos estreitos dos subprojetos que incluem `.local-pg.test.ts`. Conferir as variáveis opt-in exigidas por cada teste existente; não aceitar suite pulada como integração bem-sucedida. O script provisiona PG16 local e shims; `supabase/config.toml` declara PG17 no baseline. PG16 prova compatibilidade do SQL local, não comportamento completo de PG17/Supabase. Os shims de cron/Vault/net/auth/storage não executam agendamento/HTTP/cifra reais. Não usar o script local com URL/cluster remoto nem o reset operacional suspenso.

Além do replay do zero, testar **upgrade**: banco descartável com 001–008 e dados representativos → migration nova → invariantes. Na evolução da série, base do upgrade passa a ser o último `main`. Testar preflight de dados inválidos, índices únicos, tempo de lock e recuperação por migration corretiva. Uma migration aplicada não precisa ser reaplicável cegamente; jobs/rotinas que podem ser reexecutados precisam ser idempotentes.

### 6.2 Consultas de contrato do catálogo

Exemplos somente leitura para a suíte local e preflight autorizado; resultado esperado indicado abaixo. Não selecionar `vault.decrypted_secrets` nem valores de segredos para anexar ao PR.

```sql
-- Deve retornar false depois de S01.
SELECT has_function_privilege(
  'anon', 'public.upsert_portal_invoice_exception(bigint,text)', 'EXECUTE'
) AS anon_can_execute;

-- Após hardening: zero funções de negócio com EXECUTE herdado de PUBLIC.
-- Exceção pública de programação deve ser grant nomeado a anon, não PUBLIC.
SELECT p.oid::regprocedure::text AS signature
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
WHERE n.nspname = 'public'
  AND p.prorettype <> 'trigger'::regtype
  AND a.grantee = 0
  AND a.privilege_type = 'EXECUTE';

-- Deve listar uma linha do job PTAX após S09; ativo só depois do rollout.
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'recalc-demurrage-ptax';

-- Mapa de funções/argumentos finais; usar por assinatura, não só por nome.
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args,
       pg_get_function_result(p.oid) AS result_type, p.prosecdef, p.proconfig
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, identity_args;
```

A consulta PUBLIC também pode revelar extensão/helper não pertencente à aplicação. Não revogar extensão automaticamente: a suíte deve distinguir funções do projeto e registrar exceção técnica explícita, sem permitir funções de negócio indevidas. Não assumir que “anon não executa” significa “Portal authenticated não executa”; testar ambos.

### 6.3 Matriz de regressão obrigatória

| Fronteira | Cenários | Evidência exigida |
|---|---|---|
| Auth/Portal/RLS | anon, Portal A/B, interno ativo por perfil, inativo, ator divergente, iat revogado, token novo | SQL executado + HTTP real; retorno filtrado correto, não só `error=null` |
| Parsing | UTF-8/1252, BOM, decimal ambíguo, cabeçalho deslocado/ausente, Baplie duas ordens/EOF, datas impossíveis, ISO/porto | unitário + arquivo real anonimizável → preview → banco |
| Atomicidade | falha na primeira/última linha/auditoria, dois operadores, retry após timeout, reimport unchanged | comparação de estado e auditoria antes/depois; duas conexões reais para corrida |
| Outbox/inbox | crash antes/depois do efeito, lease expirada, dupla entrega, nova revisão, webhook antecipado | integração SQL + execução Edge; efeito único e pendência recuperável |
| Demurrage | base/desconto/zero, duas PTAX/data do extrato, concorrência pagamento/recálculo, QR antigo, falta de história | dinheiro em centavos, histórico append-only e runtime Portal/impresso |
| Ledger local | parcial/excedente/estorno/COD, diferença 0,01, consolidada/reemissão, status isento USD | saldo e eventos fecham em centavos; documento não reescreve pagamento |
| Readiness | Portal ativo mas convite pendente/email suprimido, CE ausente, revisão bloqueada, cliente diferente | cada fronteira bloqueia somente sua ação; cálculo continua conferível |
| Comunicados | caixas distintas/sobrepostas, principal indisponível, inativo/opt-out, 60 candidatos, pausa após envio | simulação determinística, tentativa por destinatário, sem envio real indevido |
| Performance/UX | 10k B/Ls, >60 viagens, >1000 supressões, duas abas, offline, teclado, temas | requests/bytes/p95 comparáveis, foco/contraste e estados de erro reais |
| Schema/docs | replay/upgrade, grants, jobs, variantes dinâmicas, assinatura gerada, referência histórica legítima | catálogo executado + typecheck + docs:check |

Os testes existentes de listeners, guarda de Preview e HSTS são **regressão**, não novas tarefas de correção. Novos testes devem exercitar invariantes, não repetir a implementação ou apenas procurar strings. Não criar seeds grandes permanentes para testar um único caso; usar factories/helpers existentes e dados pequenos, exceto no benchmark explícito.

### 6.4 Preview e produção

- [ ] Supabase branch e Vercel Preview apontam para o mesmo ambiente da PR e SHA; a fixture QA é exclusiva da branch. Confirmar por referência de projeto, nunca imprimindo keys.
- [ ] SQL e Edge Functions correspondem ao contrato novo; conferir status da integração e testar RPC via PostgREST. Um frontend verde não prova migration ou Edge publicada.
- [ ] Usar clientes A/B e perfis internos sintéticos, faturas/containers e endereços QA controlados. Exercitar Inspeção sem sessão de Portal emprestada.
- [ ] Executar roteiro por domínio, registrando SHA, migration, ambiente, passos, resultado e evidência; falha impeditiva permanece aberta. “Não executado” deve ter motivo, nunca ser apresentado como PASS.
- [ ] No PR, reportar checks do SHA efetivamente enviado. Seguir CLAUDE: acompanhar CI até concluir, corrigir falhas; não manter monitoramento até merge nem criar automação sem pedido.
- [ ] Após deploy autorizado, produção recebe preflight somente leitura e smoke do fluxo permitido, sem fixtures QA nem mensagens reais de teste. Operação financeira real ou envio ao cliente exige autorização e caso de negócio apropriado.

## 7. Estratégia de rollout, migração e rollback

### 7.1 Regras de migrations e compatibilidade

1. **Preflight:** registrar catálogo/ACLs/jobs, dados incompatíveis, duplicatas por nova identidade, valores negativos e histórico sem fonte. Volume zero da auditoria histórica não dispensa preflight atual. Não modificar dados para fazer constraint passar sem decisão rastreável.
2. **Expansão:** novas colunas nullable/default seguro, RPCs novas/wrappers compatíveis, CHECKs que aceitam transição de estados, tipos regenerados e UI que lê velho/novo. Não ligar produtor de estado que o consumidor ainda não entende.
3. **Publicação:** migrations pelo fluxo GitHub/Supabase da ADR 0056; Edge Functions e secrets pelo procedimento próprio do ambiente; frontend pelo Vercel. Vercel não é mecanismo de deploy de SQL/Edge. Confirmar artefatos de cada camada antes de liberar.
4. **Migração de consumidores:** caller novo usa contrato novo; atualizações de segurança podem negar cliente antigo com mensagem de recarga. Nunca manter caminho antigo vulnerável indefinidamente para compatibilidade. Remover permissões de escrita direta financeira com estratégia conhecida para abas antigas.
5. **Ativação:** jobs/worker primeiro inativos; segredo no Vault e Edge por ambiente, autenticação e simulação validadas; ativação auditada. Sem habilitar chave global de envio nesta execução de plano nem por efeito colateral de migration.
6. **Contração:** retirar contrato/coluna legado somente após observar consumidores e preservar backup específico; DROP RESTRICT. Não reescrever 001–008 ou migrations_archive, não executar reset em produção e não usar ferramenta que gere migration timestamp fora da convenção numerada.

Os arquivos protegidos requerem a autorização de §9 na sessão de execução. Não usar variável de override do hook como substituto de autorização.

### 7.2 Rollback por domínio

| Mudança | Contenção imediata | Reversão segura / limite |
|---|---|---|
| Guards/grants | manter deny, corrigir wrapper defeituoso | migration corretiva; nunca reabrir PUBLIC ou revogação |
| Parser | suspender formato/import afetado, manter preview | reverter código se voltar a aceitar só formatos seguros; dados já aplicados exigem análise/auditoria, não rollback automático |
| RPC de import | pausar entrada se contrato falhar | compatibilidade de wrapper; transações falhas já desfazem unidade; não desproteger import para “destravar” |
| Outbox/inbox | pausar worker/claim, manter recepção durável | corrigir consumidor e retomar mesma identidade; não apagar fila nem recriar tentativas entregues |
| Email | desligar envio real, preservar ingestão de eventos e supressões | reverter consumidor compatível; enviado não se desfaz e não pode virar simulado retroativamente |
| PTAX | desativar job nominal, manter última cotação e alerta | restaurar Edge/config compatível; correção financeira por evento/reprocessamento autorizado, não apagar histórico |
| Financeiro | bloquear mutação afetada e manter leitura | migration de correção + ajuste auditado; não recalcular pago, reabrir invoice ou inventar recebimento |
| Read-only/UX | voltar consumidor compatível, preservar segurança | rollback de frontend normalmente possível; não remover RPC enquanto abas dependem dela |
| DROP legado | abortar se preflight/RESTRICT indicar uso | restaurar corpo/coluna em migration nova a partir de backup; dados de coluna removida não reaparecem só recriando schema |

### 7.3 Sinais e critérios de parada

Por PR, anexar baseline e janela de observação compatível com a cadência do domínio. Cron diário exige pelo menos uma execução agendada confirmada; dunning/inbox exige execução com falha e retry controlados em Preview. Produção monitora métricas existentes por procedimento operacional, sem agendar automações nesta sessão.

Sinais mínimos: efeitos pendentes mais antigos que a janela de retry, dead-letter/bloqueados, lease expirada, webhook sem tentativa resolvida, discrepância total/PIX/ledger, cotação sem atualização esperada, falha de autorização inesperada, comunicação parcial e request/bytes/p95 das listas. Correlacionar por action_id/entidade/versão, nunca email em claro ou arquivo bruto.

**Parar ativação** se surgir destinatário fora do recorte, dupla invoice/baixa, mutação financeira sem auditoria, acesso Portal cruzado, projeto de Preview incorreto ou novo estado sem leitor compatível. Contenção não apaga evidência. Ausência de incidente em base vazia não satisfaz aceite.

### 7.4 Documentação a atualizar durante a implementação

Cada PR altera documentação viva somente do contrato que entrega: módulos de import/Granito/Viagens, Demurrage/Faturamento/Portal/Comunicação, rastreabilidade e procedimentos de ambiente. Jobs/secrets atualizam WORKFLOW/ADR 0063; mudança de autoridade de cálculo exige ADR nova supersedendo parte da 0026; mudança de tolerância/volume/exceção de email requer decisão correspondente. Consultar `docs/README.md` antes de mudanças amplas.

Não repetir as correções factuais da #659: `/line-up-tv` continua catch-all, `billingLedger.ts` continua serviço real e os nomes de testes já corrigidos permanecem. O residual documental é cobertura/prevenção e descrição de comportamento novo. Atualizar índice deste plano apenas quando autorizado a editar documentação viva; ao concluir todas as tarefas, seguir ciclo de arquivamento do CLAUDE.

## 8. Riscos residuais e itens aceitos

| Item aceito | Justificativa atual | Gatilho para reabrir / responsável funcional |
|---|---|---|
| #655 — continuidade da régua | CONTEXT: semanal até quitação, sem limite de semanas. D11 aprovou agrupar mensagens por cliente/ciclo, preservando essa continuidade. | S06/S07 devem implementar e validar agrupamento e limites operacionais antes de ativação |
| #658 F4 — modelo atual em transição | ADR 0026 aceitou integridade interna do payload; D02 aprovou substituir esse modelo por cálculo server-side. Não é risco aceito como destino final. | S08-B: implementação, validação e formalização em ADR; não ativar worker autônomo antes disso |
| #658 F6 — CE simultâneo dos irmãos | Complemento final da ADR 0020 rejeita automação residual por premissa operacional. | Documentação/Financeiro: ocorrência real de irmão tardio; consultar soma dos rateios e decidir alerta/ajuste, sem mudar pagos |
| #658 F13 — gaps e tabelas sobrepostas | Não são equivalentes a valores negativos; regras de gaps de Demurrage e vigência informativa de taxa local são deliberadas. | Nova política de tarifas/acordos; não generalizar EXCLUDE |
| Disputa não congela PTAX | ADR 0014: apenas régua pausa; pagamento e atualização continuam. | Financeiro decide regra diferente em ADR, fora deste plano |
| Juros/multa/vencimento local | Não praticados; ADR 0055 retirou vencimento de taxas locais. | Nova necessidade comercial explícita; não restaurar overdue/due_date por auditoria |
| #660.5 — rate limit por CNPJ | ADR 0049 aceita risco de DoS sobre dono para evitar bypass por IP não confiável. | Evidência de abuso/impacto ou infraestrutura confiável nova; preservar erro genérico |
| #660 — TOCTOU de contato | Troca de tenant não é capacidade do fluxo atual; cliente é bloqueado no snapshot. | Introdução de transferência de contato entre clientes; revisão da operação e lock |
| Programação pública / HSTS sem preload | Programação não expõe carga privada; HSTS já entregue, preload é decisão distinta. | Mudança de payload ou política de domínios, sem nova implementação agora |
| #659 — `port_calls` adiado | ADRs 0027/0035 aceitam projeção sobre persistência histórica. | Necessidade concreta que exceda projeção atual; exige plano próprio, não limpeza de literal |
| #659 — duas colunas write-only | Baixo custo e potencial forense; `received_at` dá idade ao inbox. | Política de retenção fundamentada, sem DROP por ausência de SELECT |
| #656 — sem virtualização/memoização global | Ausência de técnica não comprova problema; páginas pequenas são adequadas. | Profiler, lista >300 linhas ou long task persistente |
| #654 — worker/aliases persistidos adiados | Limites atuais, template conhecido e função canônica podem resolver com menos risco. | Baplie >3 MB autorizado ou benchmark bloqueante; aliases ambíguos recorrentes |
| #659 — tetos distantes | `useTransshipments` N+1 por viagem, alertas por página, ATD sequencial por auditoria, Vault por disparo e ZIP sem Zip64 não tiveram teto atual demonstrado. | Request/p95/volume acima de orçamento; ZIP próximo de 65535 entradas/4 GB exige outro desenho, não elevar limite silenciosamente |
| Histórico de teste do squash | Archive é evidência histórica útil; removê-lo não melhora prova ativa. | Migrar invariantes críticas incrementalmente para catálogo/replay executado |

Os riscos aceitos não autorizam chamar itens pendentes de corrigidos. D02 aprovou substituir o modelo de F4, ainda pendente de implementação e formalização em ADR. A premissa operacional de F6 permanece aceita; a decisão do centavo em D05 não a altera. F8 depende de norma vigente; sem essa consulta não declarar “PIX conforme BCB”. F2 depende de prova sob roles reais para qualificar explorabilidade; o contrato inadequado continua no escopo de correção.

## 9. Lacunas e decisões que exigem confirmação na execução

D02, D04, D05 (centavo local) e D11 foram respondidas pelo usuário após a revisão da PR 662 e estão registradas abaixo. São decisões de planejamento, ainda não implementadas; não autorizam deploy, envio real ou alterações em arquivos protegidos. As demais confirmações bloqueiam apenas as tarefas correspondentes.

| Decisão | Recomendação concreta | Quem confirma / o que bloqueia |
|---|---|---|
| D01 — convenção de arquivos e ambiguidades | Usar formato declarado por template/coluna; bloquear ambiguidade, não inferir número/data de alto impacto. IMO primeiro, aliases por tokens e conflito explícito. | Operação/Documentação valida exemplos de arquivos, datas/ano e dialetos Baplie; bloqueia aceitação de formatos ambíguos, não correção de `1e3→13` |
| D02 — autoridade do cálculo de Demurrage | **Aprovada pelo usuário:** núcleo server-side com preview versionado, preservando precedência de tarifas/acordos/overrides; mudança de versão exige nova conferência. Formalizar supersessão parcial da ADR 0026 na implementação. | Decisão respondida; S08-B e worker autônomo dependem agora de implementação e validação, não de nova confirmação desta escolha |
| D03 — unidade de import | Atomicidade por B/L em datas/CE, por cliente em cadastro e conjunto físico por viagem em Baplie; relatório por unidade. | Operação; se exigir arquivo inteiro, contrato muda antes do SQL, nunca simular all-or-nothing no modal |
| D04 — aviso de bounce e chave global | **Decidida pelo usuário:** também deve ser silenciado pela chave de Comunicados; preservar supressão, reparo e alerta interno. | Decisão respondida; implementar A7 e registrar ADR/CONTEXT, preservando isenções de convite/reset/segurança |
| D05 — centavo local e compartilhamento tardio | **Centavo decidido pelo usuário:** manter qualquer saldo positivo em aberto, sem baixa automática; R$ 0,01 importa. Tolerância de Demurrage permanece separada. A premissa de CE simultâneo não foi alterada. | F14 liberado para implementação dessa política. F6 continua apenas diagnóstico; automação adicional exige ocorrência/decisão específica |
| D06 — câmbio manual e sanidade | Positivo/finito obrigatório; limite de variação e eventual override exigem justificativa/ator e parâmetro aprovado, sem transformar toda escrita em admin. | Financeiro/Administrativo; bloqueia valor do teto, não procedência/cron/erro de fonte |
| D07 — retenção de PII e dados históricos | Payload mínimo de inbox e relatório, acesso restrito, prazo conforme política da organização; manter chaves antigas que sustentam dedup sem reenvio. | Responsável de dados/Administrativo; bloqueia expurgo/pseudonimização destrutiva, não chave nova sem email |
| D08 — arquivos protegidos e deploy | Obter autorização explícita para os arquivos protegidos que a entrega realmente precisa e para rollout com dados/segredos do ambiente. | Usuário na sessão de implementação; `CLAUDE.md` e `.claude/hooks/protect-files.sh` proíbem bypass sem autorização |
| D09 — DV e dados sintéticos | Inventariar documentos vigentes, separar fixture e validar formatos aceitos antes de endurecer login; sem revelar existência de CNPJ. | Administrativo/Produto; bloqueia restrição de login e DROP documental de `consignee_address` |
| D10 — liberação de email real | Manter estado atual da chave; autorizar canário e recorte real somente após S06/S07/readiness validados. | Administrativo conforme ADR 0059; nenhum envio nesta sessão |
| D11 — volume de cobrança por cliente | **Decidida pelo usuário:** agrupar cobranças elegíveis por cliente/ciclo e destinatário, preservando faturas individuais, suas condições e repetição semanal até quitação. Não consolidar débitos nem descartar cobranças. | Decisão respondida; S06/S07 devem validar composição, destinatários, retry e rastreabilidade antes de liberar envio real |

**Investigações técnicas sem decisão comercial:** causa do check Supabase `skipped` (S02); efeito do gateway JWT no cron (S09); ACL/rollback real de F2 (S08); norma BR Code vigente (S08-C); reprodução de P3-03 (S13); profiler (S12/S13); dependências/uso externo das 14 funções e quatro colunas (S14). Cada uma termina com evidência e classificação atualizada, não com mudança especulativa.

### Checklist de revisão do plano

- [ ] Na execução, reconferir `main` e reclassificar achados que outra PR tenha resolvido; não repetir trabalho concorrente.
- [ ] Manter vínculo de cada PR com IDs da matriz e critérios objetivos do subprojeto.
- [ ] Registrar decisões D01–D11 somente quando aplicáveis; preservar explicitamente as aceitas enquanto não supersedidas.
- [ ] Comprovar contrato SQL final, comportamento sob roles reais, rollback/upgrade e runtime necessário antes de marcar entrega concluída.
- [ ] Ao encerrar o roadmap, distinguir corrigido, aceito e investigação ainda aberta; não arquivar como totalmente executado enquanto houver tarefa obrigatória pendente.

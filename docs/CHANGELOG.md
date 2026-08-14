# Changelog

> Histórico curado de entregas relevantes. Sintetizado dos planos de execução (arquivados em [archive/](archive/README.md)) e do histórico git. Não substitui o `git log`.

## 2026-08
- **Mensagens do login e da recuperação do Portal:** a tela de confirmação de
  `/portal/esqueci-senha` passa a afirmar o envio do link em vez de condicioná-lo
  a "se houver uma conta para este CNPJ" — o condicional devolvia ao cliente o
  sinal de enumeração que o backend já não dava (achado 3.2). Falha de rede
  deixa de reaproveitar esse texto e mostra erro real, e CNPJ com menos de 14
  caracteres é reprovado na própria tela, em `/portal/login` e
  `/portal/esqueci-senha`, por `src/lib/portalCnpjLogin.ts`. A validação cobre só
  o comprimento: metade dos `login_cnpj` reais não fecha dígito verificador.
- **Escrita interna global com rastro obrigatório:** migrations `294` e `295`
  congelam autor/departamento em `audit_logs`, registram mudanças por trigger,
  congelam a rota da importação e abrem a escrita interna aos cinco
  departamentos. Exclusão operacional, provisionamento do Portal,
  administração de usuários e sign-off departamental permanecem exceções;
  frontend, tipos, timeline e ADR 0046 foram alinhados. *(PR 533)*
- **Investigação da lentidão de inicialização:** adiciona harness autenticado
  frio/quente e checkpoints sanitizados de startup, impede cache de uma hora no
  shell `/` do Firebase Hosting e mantém Auth, banco e waterfalls pendentes até
  existir baseline autenticado e acesso administrativo ao Supabase.
- **Inspeção do Portal:** documentada a rota interna somente leitura
  `/clientes/portal/inspecao/:customerId/*`, com `PortalLayout` compartilhado
  entre cliente e inspeção, modo visual identificado, navegação por `basePath`,
  bloqueio das escritas do cliente e abertura auditada. A fidelidade usa
  núcleos parametrizados compartilhados pelas RPCs do cliente e de inspeção;
  `portal_get_session_overview_v2` é exceção por atualizar `last_login_at`.
  Equipamentos passa a descobrir o console sem disparar o self-heal gravável.
  *(ADR 0045; plano da PR 529)*
- **Remediação de segurança do Portal do Cliente:** `import_manifest_transactional`
  ganha guarda de identidade (sessão interna ativa + `p_uploaded_by = auth.uid()`,
  migration `290`), `/portal/esqueci-senha` deixa de enumerar CNPJs cadastrados,
  o token de reset/ativação é removido da URL e da telemetria, o CORS do
  `portal-invite-activate` passa a usar a allowlist, e o grant residual a
  `anon` em `portal_invoice_details` é revogado. *(plano arquivado
  `2026-08-12-remediacao-seguranca-portal`; origem: auditoria
  `security-audit-portal-2026-08-12`)*
  - **Revisão de código na mesma PR:** o envio de email de
    `portal-password-recovery` deixa de ser aguardado antes da resposta (roda
    em segundo plano via `EdgeRuntime.waitUntil`), fechando um oráculo de
    enumeração por *timing* que sobrevivia à equalização do corpo da
    resposta; `beforeSend` da telemetria passa a redigir também
    `breadcrumb.data` (não só `breadcrumb.message`), fechando o vazamento do
    token de reset/ativação pelo breadcrumb de navegação do Sentry que a
    própria remoção do token da URL disparava; e um teste de invariante
    (`portalInvoiceDetailsAnonGrantInvariant.test.ts`) passa a travar, em
    todas as migrations, que `anon` nunca retenha `EXECUTE` em
    `portal_invoice_details`, para o grant residual não voltar a ser
    reintroduzido silenciosamente por uma futura edição da função.

- **Leitura interna volta a ser global; departamento só restringe escrita
  (ADR 0044):** migration `291` corrige `014`/`020`/`066`/`111`, que haviam
  restringido o `SELECT` de 13 tabelas financeiras (`charge_tables`,
  `invoices`, `payments`, ledger de recebíveis etc.) a `is_admin()` — um
  resquício do modelo antigo admin/operator. Taxas Locais, Faturamento,
  Relatórios, Conciliação PIX e a aba Financeiro da Ficha do Cliente voltam a
  funcionar para Financeiro, Operações, Documentação e Equipamentos.
  `charge_tables`/`charge_table_items`/`customer_rate_overrides` também
  ganham `can_edit_local_charges()` no INSERT/UPDATE/DELETE, alinhando a RLS à
  permissão que Documentação já tinha no frontend. `/taxas-locais` separa
  visualização (sempre visível) de edição; `PROFILE_SCOPES` corrigido; gates
  de escrita de Viagens e Baplie alinhados a `voyages_edit`/`manifests_upload`
  em vez de `isAdmin`. *(plano `2026-08-13-rbac-leitura-global-por-departamento`,
  auditoria `2026-08-13-rbac-departamentos-visualizacao`)*

- **Spec comportamental na edição `2026-08-12`:** rebuild diferencial contra as
  migrations `001`–`289`, 42 rotas, 103 RPCs e 12 Edge Functions — 36 linhas
  novas (ADR, provisionamento e autenticação do Portal, `admin-users`, cadastro
  de depot e RPCs de CE master, omissão, granito, recebíveis, vencimento e ROE),
  3 linhas removidas por comportamento que não existe mais (gerador de EDI
  Mercante, redirect `/line-up-tv`, `provision-portal-user`) e 8 referências
  reparadas. A edição `2026-07-02` foi arquivada.

- **Controles de vencimento e COD:** administrador pode ajustar o vencimento de
  uma invoice aberta (RPC `update_invoice_due_date`, migration `282`), com o
  detector de atraso mantido como única rotina que transiciona para `overdue`;
  a ação Transbordo/COD do B/L passa a aparecer sempre que existe omissão, ainda
  sem disposição persistida. *(plano `2026-08-11-billing-adr-controls`)*

- **Fixture QA de exibição encerrada como engenharia:** os scripts
  `scripts/qa-display-production/` seguem disponíveis, a execução contra
  produção não foi realizada e o catálogo parcial saiu do repositório.
  *(plano `2026-08-09-fixture-qa-display-producao`)*

- **Desempenho de carregamento:** removidos canais Realtime sem consumidor,
  pré-carregados os chunks das rotas durante a autenticação, adicionados
  preconnects externos, índice linear do Line Up e orçamento de bundle alinhado.

- **CE Mercante confirma o faturamento do Granito:** Granito passa a importar
  CE para `granite_bls`, aguardar CE na Validação e emitir automaticamente após
  o cadastro; CEs preenchidos são únicos por B/L, resolvidos por viagem e
  auditados pela RPC. *(ADR 0042)*

- **Vínculo de cliente por documento:** CPF/CNPJ exato é o único vínculo
  automático; match por nome vira sugestão visível na fila de revisão para
  B/Ls de container, carga solta e Granito. Sugestões ficam em colunas próprias,
  não liberam faturamento, e o backfill preserva faturados e decisões humanas.
  *(ADR 0043; migrations 284–287)*
- **Correções da fila de bloqueios de faturamento:** restaura o fluxo de Granito, corrige a classificação de B/L pronto, toasts, invalidações e truncamento da fila. *(PR #512)*

- **Validação do Faturamento vira fila de bloqueios:** a aba passa a derivar
  três causas fechadas (cliente, cálculo e CE Mercante), remove o funil e os
  atos de aprovação/marcação em lote, mantém recálculo e emissão por linha,
  exporta a conferência em XLSX e registra falhas de emissão automática em
  Alertas. *(ADR 0041; plano arquivado `2026-08-10-validacao-fila-de-bloqueios`)*

- **Impresso do ADR padronizado na fatura:** o documento impresso do Agency
  Departure Report passa a usar a mesma linguagem visual da fatura de taxas
  locais — Arial 13px sobre branco, cabeçalho com a logo e identificação da
  escala, título centralizado com régua, fatos da escala no bloco de metadados
  (rótulo/valor), tabelas com cabeçalho navy `#1A2744` e texto branco, zebra
  `#f9fafb`, barra de total âmbar `#F59E0B` no fim de cada listagem (antes o
  total vinha no topo) e faixa clara `#e8edf5` como título de seção. A paleta e
  os estilos de tabela viraram tokens em
  `src/components/shared/invoiceFormat.ts`, consumidos pelos três documentos
  (taxas locais, Demurrage e ADR); o bloco CSS próprio do ADR
  (`agency-report-document__*`, paleta bege com grade cheia) saiu de
  `src/index.css`. Junto, correção de impressão: com o modal aberto, a
  pré-visualização do ADR na aba deixa de sair impressa em duplicidade.
  Mudança só de apresentação — snapshot, RPCs e cálculos intactos.
  *(plano arquivado `2026-08-08-impresso-adr-linguagem-visual-fatura`)*
- **Vigência da tabela de taxas vira informativo:** a vigência da Tabela de
  Taxas Locais deixa de participar do cálculo — `resolve_local_charge_table_id`
  resolve por escopo (modo de carga + POD) e por `active`, desempatando entre
  ativas pela vigência inicial mais recente; inativar passa a ser a única forma
  de tirar uma tabela do ar. Junto sai a trava do ETA: `review:no_eta` deixa de
  existir e o cálculo não para mais por falta de ETA da escala. A Data de
  Referência da Tarifa sobrevive só para resolver a Condição de Cliente (cuja
  vigência continua valendo), com precedência ETA da escala → ETA da viagem →
  data de hoje. Em `/taxas-locais`, a vigência ganha avisos no lugar da trava:
  vencida ou futura em tabela ativa, e "não aplicada" quando outra tabela ativa
  do mesmo POD e modo de carga vence o desempate. O gate de
  `ready_for_billing`, que exigia tabela vigente em `CURRENT_DATE` desde a
  migration `019`, passa a usar o mesmo critério de escopo + `active` — sem
  isso a trava só mudaria de lugar. Migrations `274` e `275`. *(ADR 0040;
  supersede parcialmente a decisão 3 da ADR 0038)*
- **Prazo de Conclusão do ADR — linha do tempo e medição por departamento:** a aba ADR ganha uma Linha do Tempo (ATD da escala unificada, POD canônico com fallback do POL, e o momento do seu registro; o Prazo de Conclusão — 3 dias úteis, segunda a sexta, feriados contam, dia do ATD nunca conta — calculado por uma função pura compartilhada entre tela, alerta e agregado; as 3 assinaturas departamentais com data/hora/assinante e reaberturas com justificativa; Fechamento sem prazo próprio). Sem ATD ou em escala omitida, a linha do tempo fica sem cor — nunca vencida por omissão. Novo alerta `agency_report_deadline_missed` (migration `261`), um por departamento vencido sem assinatura vigente, independente do alerta de pendência pós-ATD existente e fechado junto com o Fechamento; vigência própria não retroage a ADRs anteriores à feature. No fechamento, os marcos são congelados dentro das chaves já existentes de `closed_snapshot` (nenhuma chave de topo nova); o impresso mostra só as datas de assinatura e as reaberturas — nunca o veredito de prazo, cor ou contagem de dias, que ficam só nas telas. Agregado de calibração por (viagem, porto) em `/admin/usuarios` (aba "Prazo do ADR"), somando cumprimento **por departamento**, nunca por pessoa, para o prazo de 3 dias poder ser ajustado com dado real. *(plano arquivado `2026-08-06-adr-prazo-conclusao-linha-do-tempo`; ADR 0039)*
- **Faturamento: ADR 0038 completa e consolidação de `/faturamento`:** taxa
  local vira valor congelado ancorado na escala do POD, nas 13 etapas do
  plano. Fatura consolidada congela `invoice_items` na consolidação, não só a
  individual; recálculo é recusado para B/L já faturado; promoção automática
  `calculated → ready_for_billing` sai, e o cálculo passa a ter duas fases —
  provisório no import (antes do CE Mercante), confirmado e emitido no CE.
  Situações que cobravam zero em silêncio (item sem implementação no motor,
  THD com perfil `any`, B/L sem containers) agora param e sinalizam
  `review_required`. Isenção de veículo passa a exigir prova positiva de
  LCL/CFS em `movement_to` — corrige um bug que isentava 100% dos B/Ls com
  veículo por o motor escrever e ler seu próprio `container_load_type`. Data
  de referência da tarifa passa a ser a ETA da escala do POD, não o upload do
  lote. Condições de Cliente sobrepostas viram restrição de exclusão no
  banco. Taxa local em USD converte para BRL na emissão pelo ROE vigente, sem
  o Recálculo Diário do Demurrage — e a mesma migration corrige um bug
  pré-existente de emissão automática de fatura sem checar CE Mercante
  (trigger `trg_emit_invoice_on_bl_ready`, removido). Rateio de container
  compartilhado fecha exatamente o valor cheio do item (o último B/L do grupo
  absorve o centavo de arredondamento). `/faturamento` perde as abas
  Pendências (subconjunto literal da Validação) e Demurrage (duplicava
  `/demurrage`); a segunda vira uma faixa de métricas com link para o módulo
  real. Migrations `261`–`269`. *(plano arquivado
  `2026-08-06-faturamento-ajuste-completo`; ADR 0038, nota editorial na
  ADR 0008)*

- **Criação e gestão de usuários internos em `/admin/usuarios`:** administrador cadastra nome, e-mail, setor e senha (`email_confirm: true`, login imediato, sem convite por e-mail — diverge deliberadamente do fluxo do Portal do Cliente, ADR 0037); altera e-mail/senha a qualquer momento; cada usuário troca a própria senha mediante revalidação da senha atual. Setor passa a ser obrigatório no cadastro (papéis legados `admin`/`operator` recusados). Escrita privilegiada isolada na Edge Function `admin-users`, que reserva `service_role` às operações de autenticação e usa o cliente do chamador para escrever em tabela, preservando RLS e o autor na auditoria; leitura via RPC `admin_list_users` (`SECURITY DEFINER`, restrita a `authenticated`). Tela ganha busca por nome/e-mail, colunas de e-mail e último acesso, e confirmação ao trocar de setor exibindo o escopo do destino. Corrige dois defeitos pré-existentes: troca de setor/status agora é auditada por trigger no banco (`trg_audit_user_profile_changes`), e desativar um usuário agora encerra a sessão ativa dele (antes só virava o flag, com o token válido até expirar). Migrations `259`/`260` (revoga `EXECUTE` de `anon` em `admin_list_users`, achado numa checagem pós-deploy — o projeto concede `EXECUTE` a `anon` por default privilege a cada função nova, e `REVOKE ... FROM PUBLIC` não atinge esse grant nomeado). *(plano arquivado `2026-08-05-admin-usuarios-criacao`; ADR 0037)*
- **Veículos: local de desova na importação e cards de consolidação no ADR:** planilha de Veículos passa a ler a coluna opcional `Local de desova` (aliases), preenchendo `unpacking_location` no container correspondente; página `/veiculos` filtra por local de desova, com seleção de todas as linhas filtradas e ação em massa; a seção Veículos do ADR ganha os cards "Containers distintos por tipo" e "Veículos por modelo", além dos totais de VINs e locais já existentes. Migration `255`. *(plano arquivado `2026-08-05-vehicles-desova`)*

## 2026-07

- **Escala unificada POL/POD:** a escala passa a ser `(viagem, porto brasileiro)`, unificando linhas POD, POL e EXP na projeção consumida por Viagens, Próxima Escala, Line-Up, ADR e alertas; viagens só de exportação passam a ter escala/ADR/alerta; `voyage_export_schedules` aceita uma linha por `(voyage_id, pol)` e o alerta pós-ATD do ADR lê também o ATD documental do POL. A digitação vira **um botão e um modal por escala**, com a exportação atrás de um toggle explícito (`tem_exportacao`) que não pode ser retirado enquanto houver carga vinculada; as datas passam a ser exclusivamente da escala (`voyage_export_schedules` perde `eta`/`etb`) e o porto é escolhido entre os sete portos brasileiros, recusando estrangeiro. Line-Up, Painel e TV continuam segregando importação e exportação, com as mesmas datas da escala. Migrations `250`–`252`. *(plano arquivado `2026-07-31-escala-unificada-pol-pod`; ADR 0035 e sua nota editorial de 2026-08-03)*
- **ADR: cobertura do transbordo, fontes da descarga e relatório sem zeros:** carga em transbordo passa a contar no ADR do porto onde foi efetivamente descarregada, separada da carga de destino final desse porto; containers cheios saem exclusivamente dos B/Ls (documental, ADR 0025) e vazios do Baplie ganham natureza própria (`vazio`), com avisos de divergência contra o Baplie e contra os vazios descarregados; escala omitida com ADR já fechado antes da omissão continua acessível e imprimível; aba e impresso passam a exibir a Listagem do operado (sem matriz de zeros); impresso ganha resolução por seção (estado + assinante + data) e bloco final de Assinaturas departamentais (`departmentSignoffs`); granito casa por porto normalizado (`normalizePortCode`) com fallback do manifesto-pai; porto do Embarque de Vazios vira seleção entre as escalas da viagem; cálculo da linha de serviço unificado em `totalLinha`; validação do snapshot de fechamento restaurada (migration `249`); aviso informativo de dado órfão para granito/vazios embarcados fora das escalas da viagem. *(plano arquivado `2026-07-31-adr-cobertura-fontes-forma`; ADR 0035)*
- **Fechamento VAZIOS EXP / ADR:** importação de Unidades Embarcadas rejeita containers duplicados no parser e na RPC; inclusão manual é atômica (`243`/`244`), sem manifesto órfão, e suas regras de local/datas retornam mensagens de validação seguras (`245`). O impresso fechado passou a refletir Observações por seção e Linhas de Serviço, sem OS, overtime percentual ou Ocorrências aposentadas.
- **VAZIOS EXP / ADR 0033:** Embarque de Vazios por escala, Lista de Unidades Embarcadas com importação substitutiva de sete colunas, Linhas de Serviço manuais com percentual/preço efetivos, Cadastro de Terminais com free times por condição e catálogo de valores sugeridos; ADR passou a exibir linhas detalhadas e anexo de unidades de armazenagem. Migrations `238`–`240`.
- **Aprofundamento arquitetural:** invalidação de cache por eventos de domínio em `cacheEffects.ts`; classificação centralizada de recusas do banco em `classifyDbError`; leitura e casamento de cabeçalhos de planilha centralizados em `importCore.ts`; `FileImportModal` adotado em Carga Solta e Vazios de Importação; cobertura adicionada para Taxas Locais e Line-Up.

- **Correções pós-PR #424:** reparo do encoding da aba do ADR, reclassificação de `visual_check` como serviço de Quantidade (migration `236`), filtro de ativação e vigência no motor de custo, restauração do fluxo operacional do Vazios EXP, e recuperação da cobertura do ADR, RBAC e parser; migration `237` adiciona índice para `vazios_operation_service_qty(depot_service_id)`.

- **VAZIOS EXP / ADR 0031:** Cadastro de Depot com tarifas e serviços, importação por upsert no grão `(viagem, container)`, parser da planilha real, cálculo por container/operação em duas abas e valores consolidados na Operação de Pátio do ADR; migrations `229`–`233`.

- **ADR sign-off departamental:** aba do ADR reorganizada em 5 faixas na ordem do ciclo da escala (Escala → Importação → Operação de pátio → Exportação → Registro), com barra-resumo dos 3 departamentos no topo; sign-off passou a ser um ato por departamento (não por seção), habilitado só com todas as seções do departamento resolvidas, com reabertura auditada (`set_agency_report_department_signoff`, migration `223`); fechamento exige 3/3 departamentos, não 7/7 seções (migration `224`); alertas de pendência pós-ATD migraram de seção para departamento (migration `225`); Operação de pátio virou a 8ª seção, sob Equipamentos, separada de Embarque de vazios (migration `222`); ocorrências passaram a aceitar os 3 departamentos e tag opcional de seção (migration `226`); números-heróis, IMO destacado à parte e correções de cópia ("Veículos", "Descarga de importação"). Documento impresso (`AgencyReportDocument`) fica temporariamente desalinhado, redesenho em fase seguinte. *(plano arquivado `2026-07-21-adr-signoff-departamental-ciclo`; ADR 0029)*
- **ADR pós-implementação:** correções da revisão pós-merge do Agency Departure Report — carga solta derivada dos campos BB dos B/Ls e presente no snapshot; documento fechado/impresso reescrito fiel ao modelo real (matrizes como tabelas, granito, local de desova, OS/embarque direto/depots, autor do fechamento); chip de sign-off `carga_carregada` movido para Granito e carga solta sob `carga_descarregada`; reabertura do ADR passou a exigir `is_admin()` no servidor (migration `218`); `close_agency_departure_report` valida a forma do snapshot; fechamento/reabertura invalidam caches de alertas. Migrations `211`–`216` (e `217`–`221`) confirmadas aplicadas no remoto. *(plano arquivado `2026-07-20-adr-correcoes-pos-implementacao`; ADR 0027/0028)*
- **Pós-auditoria UX 2026-07-20:** saldo pendente da Ficha do Cliente passou a somar invoices vencidas e parcialmente pagas, não só emitidas (alinhado ao glossário); alertas pós-ATD do ADR ganharam mensagem legível com backfill (migration `219`); sign-offs e ocorrências do ADR mostram autor via RPC dedicada (`get_agency_report_actor_names`, migration `220`); nova página `/embarquevazios/taxas` para tarifas de reorganização; card "Operação da escala" sempre visível com seletor embutido; ação em massa de local de desova em `/veiculos`; aba Faturamento da Ficha BL com estado único "Faturado" quando já emitida fatura. *(auditoria `docs/design-audit/README.md`; plano `2026-07-20-ux-pendencias-pos-auditoria`)*
- **Pós-auditoria PRs #405/#406:** RBAC de COD/transbordo e de escrita de clientes/contatos passou a ser reforçado no banco (`can_edit_voyages()`/`can_edit_customers()`, migration `215`), não só escondido na UI; leitura de recebíveis do cliente migrou para RPC dedicada (`get_customer_receivables`, migration `216`) para não confundir "sem recebível" com "sem permissão"; corrigido overload duplicado de `omit_voyage_escala`; timeline da ficha do cliente passou a incluir pagamentos locais e a ser invalidada por mutação de contato; abas Visão Geral/Financeiro/Histórico da ficha e o card de status Baplie do B/L Cockpit distinguem carregando/erro/vazio; agregados (saldo, pendências) paginam até esgotar em vez de truncar. *(auditoria `docs/archive/audits/2026-07-19-pos-merge-audit-pr405-406.md`)*
- **Ficha do Cliente:** `/clientes/:cnpj` foi reestruturada como hub em cinco abas, com saldo pendente consolidado, demurrage, recebíveis, pagamentos, tarifas, histórico, pendências e deep link para Overrides de Taxas Locais; campos comerciais mortos foram removidos do código e do banco pela migration `207_drop_customer_commercial_fields.sql`.
- **B/L Cockpit 360°:** ficha `/manifestos/:blId` ganhou Visão Geral padrão, trilhos operacional/financeiro com próxima ação, réplica documental com Frete & Despesas, operação de Transbordo/COD no B/L, visibilidade do Portal e divergências Baplie; migrations `205` e `206` são forward-only. *(plano/spec `2026-07-18-bl-cockpit-360`)*
- **Qualidade de código:** formatadores e `PreviewBox` consolidados; serviços de billing/timeline e páginas/abas de Clientes, Demurrage, Taxas Locais e Validação de Faturamento decompostos sem mudança de contrato, com testes comportamentais nos componentes-página. *(plan `2026-07-18-code-quality-audit-remediation`)*
- **Refinamento operacional (WS1–WS4):** ingestão documental de B/L com alias de navio (`canonicalizeVesselName`), ciclo completo de datas por escala com estado derivado (`deriveEscalaState`) no Painel/Line-Up TV, registro global de transbordo com timeline consolidada no Portal (migrations `201`–`202`), e câmbio PTAX/ROE com data efetiva (migration `200`). *(spec `refinamento-operacional-viagens-importacoes-lineup-portal`; plans `2026-07-16-ws1`–`ws4`)*
- **Portal:** fila de provisionamento autorrecuperável (migration `198_portal_provisioning_queue_self_heal`). *(spec/plan `2026-07-16-portal-fila-autorrecuperavel`)*
- **Docs:** reorganização de `docs/` — planos vivos só em `plans/`, specs vivas só em `spec/`, archive achatado (`plans/`, `specs/`, `audits/`, `reports/`); pastas `superpowers/` aposentadas. Ciclo de vida documentado em `CONVENCOES.md`.

## 2026-06

- **Portal:** login visível alterado para CNPJ + senha via Edge Function `portal-login`; o navegador não resolve nem recebe o email técnico. O fluxo anterior de CNPJ/CPF/email com `portal_resolve_login` fica registrado como comportamento superado.

- **Revisão/Portal/Faturamento:** correções pós-PRs 249–251: gate canônico aplicado em importação e faturamento, status/auditoria sob autoridade do banco, portal válido somente com `active + auth_user_id`, UI compatível com RLS e provisionamento em sequência segura. Sem backfill de B/Ls históricos faturados. *(ADR 0006; migration `20260619130000_review_gate_hardening`; specs/plans `2026-06-19-review-gate-pr249-251-corrections`)*
- **Faturamento:** auto-faturamento após correção de cliente na revisão; guarda de estado `invoiceable_ready`. *(specs/plans `2026-06-18-auto-faturamento-apos-revisao`)*
- **Clientes/Importação:** preservar o motivo de bloqueio de faturamento do cliente durante a importação (sem inferência genérica). *(`2026-06-18-preservar-bloqueio-cliente-importacao`)*
- **Viagens:** refactor master-detail com rota dedicada `/viagens/:voyageId`, barra de filtros no topo, rail colapsável, linha do tempo (auditoria + eventos de CE), CE Master por manifesto, exportação de Baplie EDI. *(ADR 0012; `2026-06-17-viagens-refactor`; `docs/archive/plans/0001-viagens-redesign`)*
- **Chegadas/Saídas:** nova tela de schedule de navios por porto (`vessel_schedules`).
- **Portal:** gate por CE Mercante — só expõe B/Ls com CE preenchido. *(`2026-06-15-portal-ce-mercante-gate`)*
- **Portal:** login por CNPJ ou email (`portal_resolve_login`), endurecimento da resolução de login, rate limiting. *(supera o email-only do ADR 0001)*
- **Portal:** área de operação read-only (B/Ls, containers, demurrage), redesign de UX/UI, dashboard, disputas e notificações in-app. *(`2026-06-09-portal-operacao-cliente`, `2026-06-15-portal-cliente-ux-ui`)*

## 2026-06 (início)

- **Pós-auditoria:** correções de segurança e financeiras (demurrage PIX, revogação de anon, default-deny em funções). *(`2026-06-09-correcoes-pos-auditoria`; ADR 0011)*
- **Exclusões:** exclusão controlada de B/Ls, containers, veículos e clientes com enforcement de bloqueio fiscal. *(`2026-06-09-exclusao-bls-containers-veiculos-clientes`; ADR 0009)*
- **Clientes:** melhorias de UX na tabela (ações compactas, filtro, ordenação). *(`2026-06-11-clientes-ux-melhorias`)*
- **Ajustes operacionais/financeiros:** reconciliação Baplie e regras de cliente. *(`2026-06-01-ajustes-operacionais-financeiros`)*

## Manutenção (sprint 2026-06-15)

- Upgrade do toolchain Vite e dependências (fechamento de advisories).
- Endurecimento da resolução de login do portal (rate limit anti-enumeração).
- Correção do filtro de devolvidos na operação do portal.
- Export CSV do billing do portal respeitando filtros ativos.
- Alertas de vencimento do dashboard por dias de calendário.

> Planos e specs completos em [archive/plans/](archive/plans/) e [archive/specs/](archive/specs/).
## 2026-08-07

- Consolida a implementação do ADR 0039, as correções da revisão da PR 503 e
  a documentação da rota `/perfil` em uma única entrega pronta para `main`.
# Próxima entrega

- adiciona harness autenticado frio/quente e checkpoints sanitizados de startup;
- impede cache de uma hora no shell `/` do Firebase Hosting;
- mantém a investigação de Auth, banco e waterfalls pendente até haver baseline
  autenticado e acesso administrativo ao Supabase.

# Planos executados (archive)

Todos os planos de implementação **já executados**, consolidados aqui em
2026-07-18 (antes divididos entre `docs/archive/plans/` e
`docs/archive/superpowers/plans/`). O que cada entrega produziu está resumido
no [CHANGELOG](../../CHANGELOG.md); planos vivos ficam em
[`docs/plans/`](../../plans/README.md).

## Conteúdo

- **Planos datados** (`YYYY-MM-DD-<tema>.md`) — features e correções de
  2026-06-01 a 2026-07-18, na maioria gerados pelas skills
  brainstorming/writing-plans.
- [`2026-07-18-code-quality-audit-remediation`](2026-07-18-code-quality-audit-remediation.md)
  — consolidação de formatadores e `PreviewBox`, decomposição de serviços,
  páginas e abas monolíticas, com cobertura comportamental dos pais.
- [`2026-07-20-adr-correcoes-pos-implementacao`](2026-07-20-adr-correcoes-pos-implementacao.md)
  — correções pós-merge do Agency Departure Report (carga solta derivada,
  documento fechado fiel ao modelo, mapeamento seção×bloco, RBAC de
  reabertura, validação de forma do snapshot, invalidação de alertas). ADR 0027;
  Task 0 (migrations `211`–`216` no remoto) concluída — remoto em `221`.
- [`2026-07-21-adr-signoff-departamental-ciclo`](2026-07-21-adr-signoff-departamental-ciclo.md)
  — sign-off do ADR por departamento (não por seção), operação de pátio como
  8ª seção, fechamento por 3/3 departamentos, alertas por departamento,
  ocorrências abertas aos 3 departamentos com tag opcional de seção, layout em
  5 faixas do ciclo com barra-resumo, números-heróis e correções de cópia.
  ADR 0029; migrations `222`–`226`.
- [`2026-07-24-correcoes-pr-424-cadastro-depot`](2026-07-24-correcoes-pr-424-cadastro-depot.md)
  — correções da PR #424 sobre o Cadastro de Depot por tipo de cálculo (ADR
  0032; migrations `236`/`237`). **Encerrado sem execução completa:** a ADR 0033
  aposentou o modelo de tipos de cálculo que o plano preservava, e as tarefas
  pendentes foram absorvidas pelo plano do Embarque de Vazios.
- [`2026-07-31-adr-cobertura-fontes-forma`](2026-07-31-adr-cobertura-fontes-forma.md)
  — transbordo passa a contar no ADR do porto de descarga real; containers
  cheios saem dos B/Ls e vazios do Baplie ganham natureza própria, com
  avisos de divergência e de dado órfão; aba e impresso passam a listar só
  o operado, sem zeros; impresso ganha resolução por seção e as 3
  assinaturas departamentais; granito casa por porto normalizado; porto do
  Embarque de Vazios vira seleção entre escalas; cálculo da linha de
  serviço unificado. ADR 0035 (blocos 2–4); migration `249`.
- [`2026-08-06-adr-prazo-conclusao-linha-do-tempo`](2026-08-06-adr-prazo-conclusao-linha-do-tempo.md)
  — Linha do Tempo do ADR (ATD unificado e seu registro, prazo, as 3
  assinaturas departamentais com reaberturas/justificativa, Fechamento sem
  prazo próprio); Prazo de Conclusão de 3 dias úteis por departamento (função
  pura compartilhada entre tela, alerta e agregado); alerta de vencimento
  independente do de pendência; marcos congelados no `closed_snapshot`
  (impresso mostra só datas de assinatura, nunca o veredito); agregado de
  calibração por departamento em `/admin/usuarios`. ADR 0039; migration `261`.
- [`2026-08-07-adr-0039-correcoes-pr503`](2026-08-07-adr-0039-correcoes-pr503.md)
  — correções da revisão pós-implementação: SLA sem assinatura, autores de
  reabertura, timeline fechada, carregamento antes do fechamento, escalas
  deletadas e `colSpan` do agregado.
- [`2026-08-09-fixture-qa-display-producao`](2026-08-09-fixture-qa-display-producao.md)
  — scripts idempotentes da fixture sintética `QA-DISPLAY-2026`/`QAD26`
  (inventário, criadores operacional/ADR/financeiro/Portal, validação e limpeza
  seletiva em dry-run). **Encerrado com a engenharia concluída e a execução
  contra produção não realizada:** os "Step 5" de cada task dependiam de
  credenciais que nunca foram configuradas. Os scripts seguem utilizáveis;
  o artefato parcial de 2026-08-09 foi removido do repositório.
- [`2026-08-11-billing-adr-controls`](2026-08-11-billing-adr-controls.md)
  — vencimento de invoice aberta editável por administrador (RPC
  `update_invoice_due_date`, migration `282`, detector de atraso preservado como
  única rotina que transiciona para `overdue`) e ação Transbordo/COD alcançável
  no B/L quando existe omissão sem disposição persistida.
- **Planos numerados** (`001`–`006`, `0001`) — sprint de manutenção 2026-06-15
  ([README-2026-06-15-maintenance-sprint.md](README-2026-06-15-maintenance-sprint.md)),
  redesign de Viagens e correções pós-auditoria.
- **Subprojetos** (pastas com README próprio):
  - [`2026-07-08-transhipping-desk-edi-taxas/`](2026-07-08-transhipping-desk-edi-taxas/README.md)
  - [`cadastro-unico-navio-viagem/`](cadastro-unico-navio-viagem/README.md) (ADR 0021)
  - [`security-audit-2026-07-07/`](security-audit-2026-07-07/README.md)

As specs que originaram estes planos estão em [`../specs/`](../specs/).
Links internos podem refletir os caminhos anteriores à consolidação — o
conteúdo dos planos não é editado retroativamente.

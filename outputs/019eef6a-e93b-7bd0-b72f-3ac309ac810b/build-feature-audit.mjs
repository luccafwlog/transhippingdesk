import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "outputs", "019eef6a-e93b-7bd0-b72f-3ac309ac810b");
const outputPath = path.join(outputDir, "transhipping-desk-feature-audit.xlsx");

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/<br\s*\/?>/gi, "\n"));
}

function cleanMarkdown(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\\\|/g, "|")
    .trim();
}

function inferActor(surface) {
  const lower = surface.toLowerCase();
  if (lower.includes("/portal")) return "Cliente autenticado";
  if (lower.includes("admin") || lower.includes("usuário")) return "Administrador";
  if (lower.includes("login")) return "Usuário não autenticado";
  return "Usuário interno";
}

function storyText(actor, action) {
  return `Como ${actor.toLowerCase()}, quero ${action.toLowerCase()} para concluir o objetivo operacional descrito pela interface.`;
}

function expectedText(action, orchestration, persistence, effects, failures) {
  const parts = [
    `Ao ${action.toLowerCase()}, o sistema deve executar ${orchestration || "o fluxo indicado pelo código"}.`,
    persistence ? `Persistência esperada: ${persistence}.` : "",
    effects ? `Resultado observável: ${effects}.` : "",
    failures ? `Em falha: ${failures}.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

async function extractModuleStories() {
  const moduleDir = path.join(repoRoot, "docs", "modules");
  const names = (await fs.readdir(moduleDir)).filter((name) => name.endsWith(".md")).sort();
  const stories = [];

  for (const name of names) {
    const text = await fs.readFile(path.join(moduleDir, name), "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes("| Tela / ação |") && !lines[i].includes("| Tela / aÃ§Ã£o |")) continue;
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = splitMarkdownRow(lines[i]).map(cleanMarkdown);
        if (cells.length >= 8) {
          const [surfaceAction, preconditions, origin, orchestration, persistence, effects, failures, evidence] = cells;
          const separator = surfaceAction.indexOf(" — ") >= 0 ? " — " : surfaceAction.indexOf(" – ") >= 0 ? " – " : null;
          const surface = separator ? surfaceAction.split(separator)[0].trim() : surfaceAction;
          const action = separator ? surfaceAction.split(separator).slice(1).join(separator).trim() : surfaceAction;
          const actor = inferActor(surfaceAction);
          stories.push({
            module: path.basename(name, ".md"),
            surface,
            action,
            actor,
            story: storyText(actor, action),
            expected: expectedText(action, orchestration, persistence, effects, failures),
            preconditions,
            origin,
            orchestration,
            persistence,
            effects,
            failures,
            evidence,
            source: `docs/modules/${name}`,
          });
        }
        i += 1;
      }
    }
  }
  return stories;
}

const stories = await extractModuleStories();
stories.forEach((story, index) => {
  story.id = `US-${String(index + 1).padStart(3, "0")}`;
});

function findStoryId(module, term) {
  return stories.find(
    (story) =>
      story.module === module &&
      `${story.surface} ${story.action} ${story.expected}`.toLowerCase().includes(term.toLowerCase()),
  )?.id ?? "";
}

const defectSeeds = [
  {
    storyId: findStoryId("viagens", "navegar para manifestos"),
    title: "Atalho de Viagens para Carga Solta perde o filtro da viagem",
    category: "Logística / navegação",
    severity: "Medium",
    reproduction: "Abrir uma viagem e usar o card de Carga Solta; a URL contém ?voyage=<id>.",
    expected: "Carga Solta inicia com a viagem de origem selecionada.",
    actual: "CargaSolta inicializa voyageId vazio e ignora os parâmetros da URL.",
    evidence: "src/components/voyages/VoyageCard.tsx; src/pages/CargaSolta.tsx; docs/modules/viagens.md:118",
    rootCause: "CargaSolta não lê useSearchParams ao criar o estado inicial de filtros.",
  },
  {
    storyId: findStoryId("viagens", "navegar para manifestos"),
    title: "Redirect legado de Vazios não preserva explicitamente o contexto da viagem",
    category: "Logística / navegação",
    severity: "Medium",
    reproduction: "Navegar para /vazios?voyage=<id> pelo card da viagem.",
    expected: "O destino /embarquevazios recebe o mesmo query string.",
    actual: "A rota usa Navigate com destino fixo /embarquevazios.",
    evidence: "src/App.tsx; docs/modules/viagens.md:117",
    rootCause: "Redirect declarativo não reconstrói o destino com location.search.",
  },
  {
    storyId: findStoryId("portal-cliente", "notifica"),
    title: "Links de notificações do Portal não navegam",
    category: "UX / navegação",
    severity: "Medium",
    reproduction: "Abrir o sino e selecionar uma notificação que possua link.",
    expected: "A notificação é marcada como lida e o usuário navega ao destino.",
    actual: "NotificationBell apenas marca a notificação como lida.",
    evidence: "src/components/portal/NotificationBell.tsx; docs/modules/portal-cliente.md:177",
    rootCause: "O campo link retornado pela RPC não é consumido pelo componente.",
  },
  {
    storyId: findStoryId("portal-cliente", "perfil"),
    title: "Falha ao carregar perfil do Portal aparece como dados vazios",
    category: "UX / estado de erro",
    severity: "High",
    reproduction: "Fazer portal_get_profile falhar durante a montagem de /portal/perfil.",
    expected: "A tela diferencia indisponibilidade de perfil vazio e impede edição enganosa.",
    actual: "O erro é ignorado e campos vazios podem ser exibidos como dados reais.",
    evidence: "src/pages/PortalProfile.tsx; docs/modules/portal-cliente.md:178",
    rootCause: "A carga do perfil não propaga nem renderiza o erro da RPC.",
  },
  {
    storyId: findStoryId("chegadas-saidas", "consultar programação no portal"),
    title: "Falha do cronograma do Portal é mascarada como lista vazia",
    category: "UX / estado de erro",
    severity: "High",
    reproduction: "Fazer a consulta de vessel_schedules falhar no Portal.",
    expected: "O widget informa indisponibilidade e mantém erro distinguível de vazio.",
    actual: "listVesselSchedules registra no console e retorna [].",
    evidence: "src/services/vesselSchedules.ts; docs/modules/portal-cliente.md:179",
    rootCause: "O service converte erro de infraestrutura em resultado vazio bem-sucedido.",
  },
  {
    storyId: findStoryId("operacao-suporte", "auditoria"),
    title: "Filtro por autor de auditoria existe no estado mas não na interface",
    category: "UX / filtro",
    severity: "Low",
    reproduction: "Abrir Administração > Log de Ações e procurar filtro por autor.",
    expected: "O operador consegue preencher o filtro changedBy suportado pela query.",
    actual: "A UI não renderiza controle para changedBy.",
    evidence: "src/pages/AdminUsuarios.tsx:31-50,99-100,280-303; docs/modules/operacao-suporte.md:313",
    rootCause: "O contrato do filtro não foi exposto na composição visual.",
  },
  {
    storyId: findStoryId("reconciliacao-pix", "importar"),
    title: "Transações PIX sem candidato desaparecem da revisão",
    category: "Logística / reconciliação",
    severity: "High",
    reproduction: "Importar extrato contendo uma transação sem invoice candidata.",
    expected: "A linha aparece como não conciliada/unmatched para revisão.",
    actual: "O serviço omite transações sem candidato.",
    evidence: "src/services/reconciliacao.ts; docs/modules/reconciliacao-pix.md:188",
    rootCause: "A construção do resultado filtra itens sem candidato em vez de classificá-los.",
  },
  {
    storyId: findStoryId("reconciliacao-pix", "histórico"),
    title: "Filtro Único BL usa valor incompatível com invoice_type",
    category: "UX / filtro",
    severity: "Medium",
    reproduction: "Selecionar o filtro Único BL no histórico de conciliação.",
    expected: "O histórico mostra invoices com invoice_type individual.",
    actual: "A UI envia single e o serviço compara por igualdade.",
    evidence: "src/components/billing/ReconciliationHistoryTable.tsx; docs/modules/reconciliacao-pix.md:212",
    rootCause: "Valor visual single não é traduzido para o valor persistido individual.",
  },
  {
    storyId: findStoryId("clientes", "portal"),
    title: "Erro de provisionamento orienta aplicar migration obsoleta",
    category: "UX / mensagem",
    severity: "Low",
    reproduction: "Acionar erro de contrato ao provisionar Conta de Portal.",
    expected: "A mensagem referencia o contrato/migration vigente ou orientação neutra.",
    actual: "normalizeCustomerPortalRpcError cita 025_billing_orchestration_portal.sql.",
    evidence: "src/services/customers.ts; docs/modules/clientes.md:109",
    rootCause: "Texto de diagnóstico não foi atualizado após o endurecimento do gate.",
  },
  {
    storyId: findStoryId("demurrage", "listar invoices"),
    title: "Gestão de demurrage não oferece abas para invoices vencidas ou canceladas",
    category: "UX / visibilidade",
    severity: "High",
    reproduction: "Mover invoice de demurrage para overdue ou cancelled e abrir /demurrage.",
    expected: "O operador consegue localizar e gerir invoices em todos os estados vigentes na tela proprietária.",
    actual: "A aba Emitidas consulta apenas status issued; overdue e cancelled não possuem aba em /demurrage.",
    evidence: "src/pages/Demurrage.tsx; docs/modules/demurrage.md:229",
    rootCause: "A segmentação de abas não contempla todos os estados persistidos.",
  },
  {
    storyId: findStoryId("chegadas-saidas", "carregar ativos"),
    title: "Legenda afirma confirmação de evento sem dado persistido",
    category: "UX / conteúdo",
    severity: "Medium",
    reproduction: "Abrir /chegadas-saidas e comparar datas azuis com os dados persistidos.",
    expected: "A legenda descreve exatamente o significado visual da cor.",
    actual: "A cor significa apenas data parseável anterior a hoje, mas o texto diz evento confirmado.",
    evidence: "src/pages/ChegadasSaidas.tsx; docs/modules/chegadas-saidas.md:196",
    rootCause: "Texto de ajuda atribui semântica de confirmação a uma regra puramente temporal.",
  },
  {
    storyId: findStoryId("chegadas-saidas", "consultar programação no portal"),
    title: "Widget anuncia atualização diária às 09:00 sem scheduler correspondente",
    category: "UX / conteúdo",
    severity: "Low",
    reproduction: "Abrir o widget de programação no Dashboard do Portal.",
    expected: "O texto explica a atualização real por consulta e Realtime.",
    actual: "A UI promete atualização diária às 09:00 sem orquestração equivalente no módulo.",
    evidence: "src/components/portal/ShipScheduleWidget.tsx; docs/modules/chegadas-saidas.md:197",
    rootCause: "Texto histórico não acompanha o mecanismo atual de atualização.",
  },
  {
    storyId: findStoryId("chegadas-saidas", "importar planilha"),
    title: "Importação de cronograma processa arquivo sem limite de upload",
    category: "UX / importação",
    severity: "High",
    reproduction: "Selecionar arquivo grande no upload de /chegadas-saidas.",
    expected: "O tamanho é validado antes de arrayBuffer/parsing e o usuário recebe erro claro.",
    actual: "O arquivo é convertido e parseado sem assertUploadSize.",
    evidence: "src/pages/ChegadasSaidas.tsx; docs/modules/chegadas-saidas.md:195",
    rootCause: "SpreadsheetUpload não reutiliza o guard canônico de arquivos.",
  },
  {
    storyId: findStoryId("manifesto-edi", "baplie"),
    title: "Ações de importação Baplie aparecem para perfil que o banco rejeita",
    category: "UX / autorização",
    severity: "Medium",
    reproduction: "Entrar como usuário interno não admin e abrir /baplie.",
    expected: "Ações administrativas ficam ocultas/desabilitadas com explicação.",
    actual: "A UI exibe import/reimport; a RPC exige admin e retorna 42501.",
    evidence: "src/pages/Baplie.tsx; supabase migration 20260612153000; docs/modules/manifesto-edi.md:193",
    rootCause: "A visibilidade da ação não aplica a mesma regra de papel do contrato de persistência.",
  },
  {
    storyId: findStoryId("granito", "autoemitir invoice"),
    title: "Cálculo de Granito tenta emitir invoice antes de promover o B/L",
    category: "Logística / faturamento",
    severity: "Critical",
    reproduction: "Calcular taxas de um B/L Granito com cliente vinculado em /granito.",
    expected: "O B/L é promovido para ready_for_billing antes da emissão ou permanece calculado para revisão.",
    actual: "calculateGraniteBlCharges grava calculated e a página chama imediatamente a RPC que exige ready_for_billing.",
    evidence: "src/pages/Granite.tsx:135-151; src/services/graniteCharges.ts:90-93; supabase/migrations/20260528134131_fix_granite_invoice_cancel_reissue.sql",
    rootCause: "A orquestração de cálculo e emissão ignora a transição de estado exigida pela RPC.",
  },
  {
    storyId: findStoryId("granito", "emitir manualmente"),
    title: "Emissão manual de Granito chama a RPC de B/L local",
    category: "Logística / faturamento",
    severity: "Critical",
    reproduction: "Na Validação, usar Emitir em uma linha cargo_mode=granito.",
    expected: "A ação chama createInvoiceFromGraniteBls com IDs de granite_bls.",
    actual: "handleIssueSingleInvoice chama createInvoiceFromBls/create_invoice_from_bls_with_ledger.",
    evidence: "src/components/billing/ValidacaoTab.tsx:273-291; src/services/billing.ts:653-687",
    rootCause: "O handler não roteia a emissão conforme cargo_mode.",
  },
  {
    storyId: findStoryId("granito", "revis"),
    title: "Revisão em lote de Granito reporta sucesso sem persistir alteração",
    category: "Logística / feedback falso",
    severity: "High",
    reproduction: "Selecionar linhas Granito na Validação e executar a ação de revisão.",
    expected: "Cada linha recebe a transição persistida ou uma mensagem de ação não suportada.",
    actual: "runGraniteBatch retorna successCount para todos os IDs sem executar escrita.",
    evidence: "src/components/billing/ValidacaoTab.tsx:299-306",
    rootCause: "O ramo review foi implementado como no-op contabilizado como sucesso.",
  },
  {
    storyId: findStoryId("taxas-locais", "gerir tabelas"),
    title: "Invalidações de Taxas Locais usam chaves que não alcançam queries ativas",
    category: "Logística / cache",
    severity: "High",
    reproduction: "Editar tabela/override ou executar ação em lote com uma query filtrada ativa.",
    expected: "As listas e detalhes afetados são invalidados por prefixo e refazem a leitura.",
    actual: "Chaves base incluem undefined ou string vazia, impedindo prefix match contra filtros/IDs reais.",
    evidence: "src/services/queryKeys.ts; src/hooks/useLocalCharges.ts:179-218,278-293,310-371",
    rootCause: "As factories tables/overrides/queue/detail não possuem forma de prefixo base, ao contrário de operations.",
  },
  {
    storyId: findStoryId("taxas-locais", "promover"),
    title: "Validação considera matched_name resolvido, mas o banco bloqueia faturamento",
    category: "Logística / gate",
    severity: "High",
    reproduction: "Abrir uma linha com customer_reconciliation_status=matched_name na Validação.",
    expected: "A UI apresenta o mesmo bloqueio exigido por mark_bl_ready_for_billing.",
    actual: "isCustomerReconciliationResolved inclui matched_name; a RPC aceita somente matched_document ou reconciled.",
    evidence: "src/components/billing/ValidacaoTab.tsx:742-751; supabase/migrations/20260619130000_review_gate_hardening.sql:780",
    rootCause: "A regra de elegibilidade foi duplicada e divergiu do contrato canônico do banco.",
  },
  {
    storyId: findStoryId("manifesto-edi", "aplicar atributo"),
    title: "Aplicar decisão Baplie deixa telas dependentes com dados obsoletos",
    category: "Logística / cache",
    severity: "High",
    reproduction: "Aceitar um valor Baplie e navegar para Containers, detalhe do B/L ou Viagens.",
    expected: "Todas as queries que exibem o container alterado são invalidadas.",
    actual: "A página invalida apenas baplie-reconciliation da viagem.",
    evidence: "src/pages/Baplie.tsx:410-467; docs/modules/manifesto-edi.md:192",
    rootCause: "A mutation não centraliza o conjunto de caches consumidores do container.",
  },
  {
    storyId: findStoryId("reconciliacao-pix", "revers"),
    title: "Estorno local fecha o detalhe sem atualizar caches financeiros",
    category: "UX / cache",
    severity: "High",
    reproduction: "Cancelar uma baixa local pelo detalhe aberto no histórico de conciliação.",
    expected: "Histórico, invoice, ledger e B/L refletem imediatamente o novo estado.",
    actual: "InvoiceDetailModal fecha após reverseLocalInvoicePayment sem invalidar queries.",
    evidence: "src/components/billing/InvoiceDetailModal.tsx:211-227",
    rootCause: "O fluxo de estorno local não possui callback de invalidação após sucesso.",
  },
  {
    storyId: findStoryId("reconciliacao-pix", "revers"),
    title: "Estorno de Demurrage mantém flag de conciliação por extrato",
    category: "Logística / estado financeiro",
    severity: "High",
    reproduction: "Estornar uma demurrage paga por conciliação PIX.",
    expected: "status, paid_at, pix_txid e conciliated_by_extract retornam ao estado não conciliado.",
    actual: "A RPC limpa status, paid_at e pix_txid, mas não redefine conciliated_by_extract.",
    evidence: "supabase/migrations/20260614180000_require_justification_on_payment_reversal.sql:238-247",
    rootCause: "A atualização de reversão omite um campo derivado do pagamento revertido.",
  },
  {
    storyId: findStoryId("clientes", "editar"),
    title: "Edição de cliente pode persistir sem a auditoria obrigatória",
    category: "Logística / auditoria",
    severity: "High",
    reproduction: "Fazer o insert em audit_logs falhar após o update do cliente.",
    expected: "Cadastro e auditoria são confirmados ou revertidos juntos.",
    actual: "updateCustomerWithAudit atualiza customers antes do insert separado em audit_logs.",
    evidence: "src/services/customers.ts:76-112",
    rootCause: "A operação multi-escrita não usa uma RPC transacional.",
  },
  {
    storyId: findStoryId("demurrage", "pagamento"),
    title: "Desmarcar pagamento em Demurrage contorna o fluxo auditado de reversão",
    category: "Logística / autorização",
    severity: "Critical",
    reproduction: "Em /demurrage > Pagas, usar Desmarcar.",
    expected: "Reversão exige admin, justificativa e auditoria, como em /reconciliacao.",
    actual: "unmarkInvoicePaid faz UPDATE direto sem justificativa e sem limpar pix_txid/conciliated_by_extract.",
    evidence: "src/pages/Demurrage.tsx:273-312,636-640; src/services/demurrage/demurrageInvoices.ts:240-245",
    rootCause: "Existem dois autores de reversão com contratos de segurança e estado diferentes.",
  },
  {
    storyId: findStoryId("demurrage", "editar datas"),
    title: "Edição geral de datas de container não gera histórico equivalente",
    category: "Logística / auditoria",
    severity: "Medium",
    reproduction: "Editar descarga/devolução pelo modal geral de Demurrage.",
    expected: "A alteração aparece no Histórico do B/L como a edição pela aba do B/L.",
    actual: "updateContainerDates atualiza bl_containers sem inserir audit_logs.",
    evidence: "src/pages/Demurrage.tsx:220-228; src/services/demurrage/demurrageContainers.ts:62-84",
    rootCause: "Os dois pontos de edição chamam serviços com contratos de auditoria diferentes.",
  },
  {
    storyId: findStoryId("demurrage", "criar invoice"),
    title: "Criação de invoice de Demurrage pode deixar cabeçalho sem itens",
    category: "Logística / atomicidade",
    severity: "Critical",
    reproduction: "Fazer o insert de demurrage_invoice_items falhar após criar o cabeçalho.",
    expected: "Cabeçalho e itens são criados na mesma transação.",
    actual: "createInvoiceForBL e createInvoiceForReturnedBL fazem inserts separados.",
    evidence: "src/services/demurrage/demurrageInvoices.ts:40-95,98-159",
    rootCause: "A criação financeira multi-tabela é orquestrada no cliente sem RPC transacional.",
  },
  {
    storyId: findStoryId("demurrage", "importar datas"),
    title: "Emissão automática pode registrar origem incorreta do ROE",
    category: "Logística / metadado financeiro",
    severity: "Medium",
    reproduction: "Importar datas quando fetchROE devolve cotação de cache.",
    expected: "roe_source persiste a origem retornada por fetchROE.",
    actual: "containerDatesImport descarta source e issueInvoice usa o default bcb_live.",
    evidence: "src/services/containerDatesImport.ts:129-134; src/services/demurrage/demurrageInvoices.ts:162-185",
    rootCause: "A origem da cotação é perdida entre obtenção e emissão.",
  },
  {
    storyId: findStoryId("operacao-suporte", "relat"),
    title: "Cabeçalho de Relatórios anuncia limite que não vale para todas as abas",
    category: "UX / conteúdo",
    severity: "Low",
    reproduction: "Abrir /relatorios e comparar a descrição com consultas/exportações.",
    expected: "A ajuda descreve limites reais por visualização ou usa texto neutro.",
    actual: "A página diz 2.000 linhas por consulta; clientes usa 4.000 por fonte, exports não limitam e demurrage não define o mesmo teto.",
    evidence: "src/pages/Relatorios.tsx:31-35; src/services/reports.ts",
    rootCause: "Uma regra específica das listas operacional/financeira foi apresentada como regra global.",
  },
  {
    storyId: findStoryId("clientes", "export"),
    title: "Exportação de clientes não espelha filtros, ordenação e emails da tela",
    category: "UX / exportação",
    severity: "High",
    reproduction: "Aplicar busca por documento formatado, ordenação ou filtro de email e exportar a base.",
    expected: "O arquivo reproduz integralmente o conjunto e ordem visíveis e inclui o email cadastrado.",
    actual: "A query de export omite a cláusula de documento normalizado, não reaplica sortCustomerRows e grava Email vazio.",
    evidence: "src/pages/Clientes.tsx:285-309; src/hooks/useCustomers.ts:112-127; src/services/exports.ts:289-300",
    rootCause: "A exportação reimplementa parcialmente a consulta da tela e o mapper descarta customer_contacts.",
  },
  {
    storyId: findStoryId("taxas-locais", "overrides"),
    title: "Filtros de overrides são aplicados somente após um lote limitado",
    category: "Logística / busca",
    severity: "Medium",
    reproduction: "Buscar override que esteja fora dos 200 registros mais recentes.",
    expected: "O filtro consulta todo o conjunto elegível ou pagina no servidor.",
    actual: "listCustomerRateOverrides limita 20-500 linhas antes de filtrar cliente, modo e POD no cliente.",
    evidence: "src/services/charges/chargeRateService.ts:61-129",
    rootCause: "A ordem limite-antes-do-filtro torna resultados dependentes da posição no lote.",
  },
  {
    storyId: findStoryId("chegadas-saidas", "encerrar"),
    title: "Encerrar navio pode duplicar ativo e histórico",
    category: "Logística / atomicidade",
    severity: "High",
    reproduction: "Fazer o delete do ativo falhar após o insert em ended_vessels.",
    expected: "Arquivamento e remoção são uma única transação.",
    actual: "handleEnd insere o snapshot e depois executa delete separado.",
    evidence: "src/pages/ChegadasSaidas.tsx:314-327",
    rootCause: "A transição de ciclo de vida é orquestrada por duas chamadas independentes no cliente.",
  },
  {
    storyId: findStoryId("chegadas-saidas", "reordenar"),
    title: "Reordenação de navios pode persistir apenas parte da ordem",
    category: "Logística / atomicidade",
    severity: "Medium",
    reproduction: "Fazer um dos updates de display_order falhar durante a reordenação.",
    expected: "A sequência inteira é aplicada ou nenhuma posição muda.",
    actual: "moveVessel envia um update por linha em Promise.all sem rollback.",
    evidence: "src/pages/ChegadasSaidas.tsx:303-312",
    rootCause: "Não existe operação transacional para reordenar a lista.",
  },
  {
    storyId: findStoryId("chegadas-saidas", "baixar planilha modelo"),
    title: "Download do modelo de navios ignora falha da consulta",
    category: "UX / feedback",
    severity: "Medium",
    reproduction: "Fazer a leitura de vessel_schedules falhar e clicar Baixar Planilha Modelo.",
    expected: "O usuário recebe erro e nenhum arquivo incompleto é apresentado como válido.",
    actual: "downloadTemplate ignora error e gera planilha apenas com a linha de exemplo.",
    evidence: "src/pages/ChegadasSaidas.tsx:150-174",
    rootCause: "O retorno da consulta é desestruturado somente como data.",
  },
  {
    storyId: findStoryId("chegadas-saidas", "encerrados"),
    title: "Exportação de encerrados trata erro de consulta como lista vazia",
    category: "UX / feedback",
    severity: "Medium",
    reproduction: "Fazer a leitura de ended_vessels falhar e clicar Exportar Encerrados.",
    expected: "A UI distingue indisponibilidade de ausência de navios encerrados.",
    actual: "downloadEnded ignora error e exibe Nenhum navio encerrado.",
    evidence: "src/pages/ChegadasSaidas.tsx:337-353",
    rootCause: "O fluxo não inspeciona o erro retornado pelo Supabase.",
  },
  {
    storyId: findStoryId("granito", "invoice"),
    title: "Lista e detalhe genéricos de invoices perdem vínculo operacional do Granito",
    category: "UX / rastreabilidade",
    severity: "High",
    reproduction: "Emitir uma invoice Granito e abri-la em Faturamento.",
    expected: "A lista e o detalhe mostram B/L, porto, viagem e navio do vínculo invoice_granite_bls.",
    actual: "Os leitores genéricos consultam invoice_bls/receivable_links e list_invoice_details não agrega invoice_granite_bls.",
    evidence: "src/services/billing.ts:39-70,141-166,319-331,452-481; docs/modules/granito.md:218-225",
    rootCause: "A abstração de vínculos de invoice não inclui a terceira origem Granito.",
  },
  {
    storyId: findStoryId("granito", "invoice"),
    title: "RPC de Granito grava invoice com tipo individual",
    category: "Logística / classificação",
    severity: "Medium",
    reproduction: "Emitir invoice pela RPC create_invoice_from_granite_bls.",
    expected: "invoice_type identifica o documento como granite.",
    actual: "O INSERT não informa invoice_type e herda o default individual.",
    evidence: "supabase/migrations/20260528134131_fix_granite_invoice_cancel_reissue.sql; docs/modules/granito.md:226-229",
    rootCause: "A RPC especializada não persiste sua própria classificação de domínio.",
  },
  {
    storyId: findStoryId("granito", "importar"),
    title: "Importação Granito pode deixar manifesto incompleto",
    category: "Logística / atomicidade",
    severity: "High",
    reproduction: "Fazer o upsert de granite_bls falhar após criar granite_manifests.",
    expected: "Manifesto e B/Ls são confirmados na mesma transação.",
    actual: "importGraniteManifest cria o cabeçalho antes do upsert separado dos B/Ls.",
    evidence: "src/services/graniteImport.ts:205-260",
    rootCause: "A importação multi-tabela não usa RPC transacional.",
  },
  {
    storyId: findStoryId("manifesto-edi", "importar datas"),
    title: "Importação em lote de datas não aparece no Histórico do B/L",
    category: "UX / auditoria",
    severity: "Medium",
    reproduction: "Importar descarga/devolução de containers por planilha e abrir Histórico do B/L.",
    expected: "Mudanças operacionais em lote geram eventos equivalentes às edições individuais.",
    actual: "importContainerDates atualiza bl_containers sem eventos bl_container/audit_logs.",
    evidence: "src/services/containerDatesImport.ts:53-115; docs/modules/manifesto-edi.md:191",
    rootCause: "O importador em lote não reutiliza o autor auditado da atualização individual.",
  },
  {
    storyId: findStoryId("demurrage", "datas"),
    title: "Correção posterior da ATA da viagem não atualiza descarga dos containers",
    category: "Logística / sincronização",
    severity: "Medium",
    reproduction: "Alterar voyages.ata depois que os containers já foram inseridos.",
    expected: "A descarga derivada é atualizada ou sinalizada para reconciliação.",
    actual: "trg_container_discharge_date executa apenas BEFORE INSERT em bl_containers.",
    evidence: "supabase/migrations/028_demurrage_module.sql:87-109",
    rootCause: "A derivação de discharge_date não possui caminho para mudanças posteriores da fonte ATA.",
  },
  {
    storyId: findStoryId("faturamento", "emitir invoice"),
    title: "Emissão em lote pode promover B/Ls sem criar a invoice correspondente",
    category: "Logística / atomicidade",
    severity: "Critical",
    reproduction: "Executar Pronto/Faturar em lote e provocar falha na criação da invoice após a promoção.",
    expected: "Promoção e emissão são atômicas por grupo ou cada falha reverte o estado promovido.",
    actual: "ValidacaoTab promove primeiro e depois chama createInvoiceFromBls por cliente.",
    evidence: "src/components/billing/ValidacaoTab.tsx:210-258",
    rootCause: "A UI não usa a fronteira atômica mark_bl_ready_and_create_invoice para o lote.",
  },
  {
    storyId: findStoryId("chegadas-saidas", "carregar ativos"),
    title: "Instalacao limpa nao concede acesso a programacao de navios",
    category: "Logistica / autorizacao",
    severity: "High",
    reproduction: "Aplicar todas as migrations do zero e acessar vessel_schedules como usuario autenticado.",
    expected: "As policies RLS vigentes controlam leitura e mutacao da programacao.",
    actual: "A role authenticated nao possuia privilegios de tabela e falhava antes da avaliacao RLS.",
    evidence: "PostgreSQL 17 descartavel; supabase/migrations/20260622213000_grant_vessel_schedule_privileges.sql",
    rootCause: "As tabelas foram criadas depois do grant global inicial sem grants explicitos correspondentes.",
  },
  {
    storyId: findStoryId("manifesto-edi", "importar manifesto"),
    title: "Rate limit de manifesto referencia coluna ausente em instalacao limpa",
    category: "Logistica / compatibilidade de schema",
    severity: "High",
    reproduction: "Aplicar migrations do zero e executar import_manifest_transactional.",
    expected: "A RPC contabiliza imports recentes e retorna P0429 ao exceder o limite.",
    actual: "A consulta referenciava import_batches.created_at, mas a tabela possuia apenas uploaded_at.",
    evidence: "Integracao PostgreSQL 17; supabase/migrations/20260622213500_import_batches_rate_limit_timestamp_compat.sql",
    rootCause: "Uma versao posterior da RPC assumiu um alias temporal ausente no schema base.",
  },
  {
    storyId: findStoryId("faturamento", "emitir invoice"),
    title: "Wrapper de emissao nao consegue executar o core revogado",
    category: "Logistica / autorizacao",
    severity: "Critical",
    reproduction: "Como admin autenticado, chamar create_invoice_from_bls em instalacao limpa.",
    expected: "O wrapper valida a sessao e executa o core sem expo-lo diretamente.",
    actual: "O wrapper SECURITY INVOKER herdava a revogacao do core e retornava 42501.",
    evidence: "Integracao PostgreSQL 17; supabase/migrations/20260622214500_secure_billing_core_wrappers.sql",
    rootCause: "A fronteira publica protegida e seu core interno ficaram com privilegios incompativeis.",
  },
  {
    storyId: findStoryId("faturamento", "cancelar invoice"),
    title: "Cancelamento de invoice falha ao atualizar billing_batches",
    category: "Logistica / autorizacao",
    severity: "Critical",
    reproduction: "Criar uma invoice como admin e chamar cancel_invoice.",
    expected: "A invoice, batch e B/Ls sao atualizados atomicamente apos a validacao de admin.",
    actual: "A funcao invoker retornava 42501 ao acessar billing_batches.",
    evidence: "Integracao PostgreSQL 17; supabase/migrations/20260622215000_secure_cancel_invoice_wrapper.sql",
    rootCause: "A RPC protegida dependia de tabelas internas sem privilegios diretos para authenticated.",
  },
  {
    storyId: findStoryId("clientes", "selecionar linhas"),
    title: "Selecao de clientes atravessa paginas e filtros invisiveis",
    category: "UX / selecao em massa",
    severity: "High",
    reproduction: "Selecionar clientes, trocar pagina ou filtro e executar uma acao em massa.",
    expected: "A selecao deve conter somente linhas do escopo visivel atual.",
    actual: "O Set mantinha IDs selecionados em paginas e filtros anteriores.",
    evidence: "src/pages/Clientes.tsx; src/hooks/useRowSelection.ts",
    rootCause: "O hook nao possuia identidade de escopo para limpar selecoes obsoletas.",
  },
  {
    storyId: findStoryId("clientes", "criar cliente"),
    title: "Criacao de cliente e contatos nao e atomica",
    category: "Logistica / atomicidade",
    severity: "High",
    reproduction: "Criar cliente com contatos e provocar falha no insert de customer_contacts.",
    expected: "Cliente e contatos devem ser confirmados ou revertidos juntos.",
    actual: "O cliente era inserido primeiro e dependia de um delete compensatorio best-effort.",
    evidence: "src/services/customers.ts; supabase/migrations/20260623062000_create_customer_with_contacts_atomic.sql",
    rootCause: "A operacao multi-tabela era orquestrada no cliente sem transacao unica.",
  },
  {
    storyId: findStoryId("clientes", "rota inválida"),
    title: "Ficha do cliente mistura nao encontrado com falha de banco",
    category: "UX / estado de erro",
    severity: "Medium",
    reproduction: "Abrir um documento inexistente e depois simular indisponibilidade do banco.",
    expected: "Ausencia e falha de infraestrutura devem ter mensagens distintas.",
    actual: "Ambos exibiam Cliente nao encontrado ou erro ao consultar o Supabase.",
    evidence: "src/pages/ClienteFicha.tsx",
    rootCause: "O estado terminal nao classificava o codigo PGRST116.",
  },
  {
    storyId: findStoryId("taxas-locais", "filtrar/listar overrides"),
    title: "Usuário com acesso somente a overrides abre Taxas Locais sem conteúdo",
    category: "UX / autorização",
    severity: "Medium",
    reproduction: "Entrar com charge_overrides permitido e charge_tables negado e abrir /taxas-locais.",
    expected: "A primeira aba autorizada fica ativa e seu conteúdo é renderizado.",
    actual: "O estado inicial permanece em tabelas; a aba Overrides aparece, mas o corpo fica vazio.",
    evidence: "src/pages/TaxasLocais.tsx; src/pages/__tests__/TaxasLocais.test.ts",
    rootCause: "A aba inicial era fixa e não considerava as capacidades disponíveis.",
  },
  {
    storyId: findStoryId("reconciliacao-pix", "abrir detalhe local"),
    title: "Historico pode abrir a baixa errada de uma invoice",
    category: "Logistica / associacao",
    severity: "High",
    reproduction: "Abrir uma invoice com varios pagamentos retornados fora de ordem e selecionar seu detalhe no historico.",
    expected: "A data exibida e o paymentId usado no estorno pertencem a mesma baixa mais recente.",
    actual: "A data era calculada pelo maior paid_at, mas o paymentId vinha do ultimo elemento do array.",
    evidence: "src/services/reconciliacao.ts; src/services/__tests__/reconciliationInvoiceType.test.ts",
    rootCause: "Data e identidade do pagamento eram selecionadas por algoritmos independentes.",
  },
  {
    storyId: findStoryId("reconciliacao-pix", "listar/filtrar/ordenar/paginar"),
    title: "Filtros do historico ignoram pagamentos fora das primeiras 2000 linhas",
    category: "Logistica / busca",
    severity: "High",
    reproduction: "Filtrar por B/L ou periodo cujo pagamento esteja alem das 2000 linhas mais recentes de um dominio.",
    expected: "Os filtros consideram todo o historico elegivel.",
    actual: "Cada dominio era limitado a 2000 linhas antes dos filtros em memoria.",
    evidence: "src/services/reconciliacao.ts; src/services/__tests__/reconciliationHistoryPagination.test.ts",
    rootCause: "A consulta aplicava limite antes da filtragem, tornando o resultado dependente da posicao.",
  },
  {
    storyId: findStoryId("reconciliacao-pix", "exportar"),
    title: "Falha ao exportar historico gera rejeicao sem feedback",
    category: "UX / estado de erro",
    severity: "Medium",
    reproduction: "Provocar falha de leitura ou escrita ao clicar em Exportar Excel.",
    expected: "A tela encerra o loading e informa que a exportacao falhou.",
    actual: "O onClick retornava a promise sem catch ou feedback ao operador.",
    evidence: "src/components/billing/ReconciliationHistoryTable.tsx; teste comportamental",
    rootCause: "A acao assincrona nao possuia handler de erro de interface.",
  },
  {
    storyId: findStoryId("manifesto-edi", "parse/preview/import BB"),
    title: "Importacao de carga solta pode deixar lote parcial em processing",
    category: "Logistica / atomicidade",
    severity: "High",
    reproduction: "Provocar falha ao substituir itens ou aplicar o review gate depois de criar o batch e upsertar B/Ls.",
    expected: "Batch, B/Ls, campos BB, itens, erros e gate sao confirmados ou revertidos juntos.",
    actual: "O cliente executava cada escrita separadamente e nao possuia rollback.",
    evidence: "src/services/breakbulkImport.ts; migration 20260623095500; validacao PostgreSQL 17",
    rootCause: "A importacao multi-tabela de BB nao tinha uma fronteira transacional no banco.",
  },
  {
    storyId: findStoryId("manifesto-edi", "editar CE Master"),
    title: "CE Master pode ser salvo sem sua auditoria",
    category: "Logistica / atomicidade",
    severity: "High",
    reproduction: "Provocar falha ao inserir o audit log depois de atualizar o CE Master.",
    expected: "Valor e auditoria sao confirmados ou revertidos juntos.",
    actual: "O cliente atualizava import_batches antes de inserir o log em outra requisicao.",
    evidence: "src/services/manifestImport.ts; migration 20260623110000; teste focado",
    rootCause: "A edicao auditada nao possuia fronteira transacional no banco.",
  },
  {
    storyId: findStoryId("manifesto-edi", "configurar demurrage"),
    title: "Config de demurrage pode persistir parcialmente",
    category: "Logistica / atomicidade",
    severity: "High",
    reproduction: "Salvar free time com sucesso e provocar falha na atualizacao de P1/P2.",
    expected: "Free time, P1, P2 e auditoria sao gravados juntos.",
    actual: "O componente executava RPC, update direto e auditoria best-effort em etapas independentes.",
    evidence: "src/components/bl/BlDemurrageSection.tsx; migration 20260623112000; teste focado",
    rootCause: "Uma unica configuracao de negocio era repartida em tres operacoes.",
  },
  {
    storyId: findStoryId("manifesto-edi", "importar/substituir/manter vazios"),
    title: "Substituicao de vazios Baplie pode apagar o manifesto valido",
    category: "Logistica / atomicidade",
    severity: "High",
    reproduction: "Escolher substituir e provocar falha depois da exclusao do manifesto anterior.",
    expected: "O manifesto anterior permanece se o novo nao puder ser criado por completo.",
    actual: "A pagina apagava primeiro e importava depois em requisicoes separadas.",
    evidence: "src/pages/Baplie.tsx; migration 20260623111000; teste focado",
    rootCause: "Delete e recriacao nao compartilhavam transacao.",
  },
  {
    storyId: findStoryId("manifesto-edi", "parse/preview/import booking"),
    title: "Importacao de bookings pode deixar manifesto sem itens",
    category: "Logistica / atomicidade",
    severity: "High",
    reproduction: "Provocar falha ao inserir bookings depois de criar o manifesto.",
    expected: "Cabecalho e bookings sao confirmados ou revertidos juntos.",
    actual: "O cabecalho era criado antes do upsert de itens em outra requisicao.",
    evidence: "src/services/vaziosImport.ts; migration 20260623111000; teste focado",
    rootCause: "A importacao multi-tabela era orquestrada no cliente.",
  },
  {
    storyId: findStoryId("operacao-suporte", "exportar xlsx"),
    title: "Exportacao do Line-Up no Painel falhava sem feedback ao operador",
    category: "UX / estado de erro",
    severity: "Medium",
    reproduction: "Provocar falha de escrita (ex.: disco cheio) ao clicar em Exportar Excel no Painel.",
    expected: "A tela encerra o loading e informa que a exportacao do Line Up falhou.",
    actual: "O onClick retornava a promise de exportacao sem catch, gerando rejeicao nao tratada e botao preso.",
    evidence: "src/pages/Painel.tsx; src/pages/__tests__/Painel.behavior.test.tsx",
    rootCause: "A acao de exportacao nao tinha try/catch/finally, toast nem estado de loading.",
  },
  {
    storyId: findStoryId("operacao-suporte", "reconhecer"),
    title: "Reconhecer alerta reportava sucesso em transicao obsoleta",
    category: "Logistica / integridade de estado",
    severity: "High",
    reproduction: "Reconhecer um alerta cujo status ja mudou (update condicional afeta zero linhas).",
    expected: "A operacao falha de forma distinguivel quando nenhuma linha elegivel e atualizada.",
    actual: "O update condicional retornava sucesso mesmo sem afetar linhas.",
    evidence: "src/services/alerts.ts; src/services/__tests__/alertsTransitions.test.ts",
    rootCause: "A transicao nao solicitava nem verificava a linha afetada (.select().maybeSingle()).",
  },
  {
    storyId: findStoryId("operacao-suporte", "fechar"),
    title: "Fechar alerta reportava sucesso em transicao obsoleta",
    category: "Logistica / integridade de estado",
    severity: "High",
    reproduction: "Fechar um alerta ja fechado ou cujo status mudou (update condicional afeta zero linhas).",
    expected: "A operacao falha de forma distinguivel quando nenhuma linha elegivel e atualizada.",
    actual: "O update condicional retornava sucesso mesmo sem afetar linhas.",
    evidence: "src/services/alerts.ts; src/services/__tests__/alertsTransitions.test.ts",
    rootCause: "A transicao nao solicitava nem verificava a linha afetada (.select().maybeSingle()).",
  },
  {
    storyId: findStoryId("operacao-suporte", "vincular cliente granite"),
    title: "Vinculo de cliente Granite atualizava e auditava em requisicoes separadas",
    category: "Logistica / atomicidade",
    severity: "High",
    reproduction: "Provocar falha na insercao de auditoria depois de atualizar o client_id do Granite B/L.",
    expected: "Atualizacao do cliente e log de auditoria sao confirmados ou revertidos juntos.",
    actual: "saveGraniteBlReview fazia update direto seguido de insert de auditoria separado.",
    evidence: "src/services/review.ts; supabase/migrations/20260623120000_save_granite_bl_review_atomic.sql; src/services/__tests__/graniteReviewAtomic.test.ts",
    rootCause: "A revisao do Granite nao possuia fronteira transacional no banco.",
  },
  {
    storyId: findStoryId("operacao-suporte", "audit log"),
    title: "Falha ao resolver autores do log de auditoria era silenciada",
    category: "UX / estado de erro",
    severity: "Medium",
    reproduction: "Provocar falha na consulta secundaria a user_profiles durante fetchAuditLogs.",
    expected: "A falha e propagada e a aba de logs renderiza estado de erro dedicado.",
    actual: "O erro do lookup de user_profiles era ignorado e a tela nao distinguia falha de vazio.",
    evidence: "src/services/adminObservability.ts; src/pages/AdminUsuarios.tsx; src/services/__tests__/adminObservability.test.ts",
    rootCause: "O lookup secundario nao verificava o erro e a query da pagina nao expunha estado de erro.",
  },
  {
    storyId: findStoryId("operacao-suporte", "carregar métricas"),
    title: "Metricas do sistema ignoravam erros das tres consultas",
    category: "UX / estado de erro",
    severity: "Medium",
    reproduction: "Provocar falha em qualquer uma das tres leituras (voyages, audit_logs, invoices) de fetchSystemMetrics.",
    expected: "A falha e propagada e a aba de metricas renderiza estado de erro dedicado.",
    actual: "fetchSystemMetrics lia apenas data e ignorava o error de cada consulta.",
    evidence: "src/services/adminObservability.ts; src/pages/AdminUsuarios.tsx; src/services/__tests__/adminObservability.test.ts",
    rootCause: "As tres leituras nao verificavam error e a query da pagina nao expunha estado de erro.",
  },
];

const repairsByTitle = new Map([
  ["CE Master pode ser salvo sem sua auditoria", {
    summary: "CE Master e audit log agora sao persistidos por uma unica RPC com lock e validacao do autor.",
    test: "vitest run src/services/__tests__/manifestCeMasterAtomic.test.ts",
    files: "src/services/manifestImport.ts; src/types/database.ts; supabase/migrations/20260623110000_set_import_batch_ce_master_atomic.sql; teste",
  }],
  ["Config de demurrage pode persistir parcialmente", {
    summary: "Free time, P1, P2 e os respectivos logs agora pertencem a uma unica transacao com optimistic lock.",
    test: "vitest run src/services/__tests__/blDemurrageConfigAtomic.test.ts",
    files: "src/components/bl/BlDemurrageSection.tsx; src/services/blDemurrageConfig.ts; migration 20260623112000; teste",
  }],
  ["Substituicao de vazios Baplie pode apagar o manifesto valido", {
    summary: "Leitura do staging, exclusao opcional e criacao do novo manifesto passaram para uma unica RPC.",
    test: "vitest run src/services/__tests__/vaziosImportsAtomic.test.ts",
    files: "src/pages/Baplie.tsx; src/services/vaziosImportacaoImport.ts; migration 20260623111000; teste",
  }],
  ["Importacao de bookings pode deixar manifesto sem itens", {
    summary: "Manifesto e bookings agora sao criados juntos por uma RPC transacional.",
    test: "vitest run src/services/__tests__/vaziosImportsAtomic.test.ts",
    files: "src/services/vaziosImport.ts; src/types/database.ts; migration 20260623111000; teste",
  }],
  ["Importacao de carga solta pode deixar lote parcial em processing", {
    summary: "A persistencia central de BB passou para uma RPC que compoe o import core, campos BB, itens e review gate na mesma transacao.",
    test: "npx vitest run src/services/__tests__/breakbulkImport.test.ts src/services/__tests__/breakbulkImportAtomicMigration.test.ts; PostgreSQL write validation",
    files: "src/services/breakbulkImport.ts; src/types/database.ts; supabase/migrations/20260623095500_import_breakbulk_manifest_transactional.sql; testes",
    runtime: true,
  }],
  ["Historico pode abrir a baixa errada de uma invoice", {
    summary: "Data e paymentId agora sao extraidos do mesmo pagamento mais recente.",
    test: "npx vitest run src/services/__tests__/reconciliationInvoiceType.test.ts",
    files: "src/services/reconciliacao.ts; src/services/__tests__/reconciliationInvoiceType.test.ts",
  }],
  ["Filtros do historico ignoram pagamentos fora das primeiras 2000 linhas", {
    summary: "Os dois dominios sao paginados integralmente antes dos filtros e da paginacao visual.",
    test: "npx vitest run src/services/__tests__/reconciliationHistoryPagination.test.ts",
    files: "src/services/reconciliacao.ts; src/services/__tests__/reconciliationHistoryPagination.test.ts",
  }],
  ["Falha ao exportar historico gera rejeicao sem feedback", {
    summary: "A exportacao possui loading, captura a falha e apresenta toast dedicado.",
    test: "npx vitest run src/components/billing/__tests__/ReconciliationHistoryTable.behavior.test.tsx",
    files: "src/components/billing/ReconciliationHistoryTable.tsx; teste comportamental",
  }],
  ["Transações PIX sem candidato desaparecem da revisão", {
    summary: "Transações sem candidato permanecem visíveis como pendências unmatched e não entram na confirmação.",
    test: "npx vitest run src/services/__tests__/reconciliacao.test.ts",
    files: "src/services/reconciliacao.ts; src/pages/Reconciliacao.tsx; teste focado",
  }],
  ["Erro de provisionamento orienta aplicar migration obsoleta", {
    summary: "O erro agora orienta aplicar as migrations pendentes, sem apontar para snapshot histórico.",
    test: "npx vitest run src/services/__tests__/customers.test.ts",
    files: "src/services/customers.ts; teste focado",
  }],
  ["Filtro por autor de auditoria existe no estado mas não na interface", {
    summary: "A aba de logs expõe filtro por UUID do autor e o inclui na limpeza dos filtros.",
    test: "npx vitest run src/services/__tests__/uxCopyContracts.test.ts",
    files: "src/pages/AdminUsuarios.tsx; teste de contrato de conteúdo",
  }],
  ["Download do modelo de navios ignora falha da consulta", {
    summary: "Falha ao ler navios interrompe a geração e exibe mensagem distinta.",
    test: "npx vitest run src/services/__tests__/uxCopyContracts.test.ts",
    files: "src/pages/ChegadasSaidas.tsx; teste de contrato de conteúdo",
  }],
  ["Exportação de encerrados trata erro de consulta como lista vazia", {
    summary: "Falha de leitura e ausência de encerrados agora têm feedbacks distintos.",
    test: "npx vitest run src/services/__tests__/uxCopyContracts.test.ts",
    files: "src/pages/ChegadasSaidas.tsx; teste de contrato de conteúdo",
  }],
  ["Edição de cliente pode persistir sem a auditoria obrigatória", {
    summary: "A edição do mestre e os eventos por campo agora são gravados por uma única RPC transacional.",
    test: "npx vitest run src/services/__tests__/customerUpdateAuditAtomic.test.ts",
    files: "src/services/customers.ts; src/types/database.ts; supabase/migrations/20260622173159_atomic_customer_update_audit.sql; teste focado",
  }],
  ["Aplicar decisão Baplie deixa telas dependentes com dados obsoletos", {
    summary: "A decisão aguarda invalidação da reconciliação, B/Ls, detalhes, viagens e timeline da viagem.",
    test: "npx vitest run src/services/__tests__/baplieInvalidation.test.ts",
    files: "src/pages/Baplie.tsx; src/services/baplieInvalidation.ts; teste focado",
  }],
  ["Atalho de Viagens para Carga Solta perde o filtro da viagem", {
    summary: "Carga Solta inicializa filtro e modal com o parâmetro voyage da URL.",
    test: "npx vitest run src/pages/__tests__/cargaSoltaRoute.test.ts",
    files: "src/pages/CargaSolta.tsx; src/pages/cargaSoltaRoute.ts; teste focado",
  }],
  ["Redirect legado de Vazios não preserva explicitamente o contexto da viagem", {
    summary: "O redirect preserva location.search ao navegar para Embarque Vazios.",
    test: "npx vitest run src/pages/__tests__/VaziosRedirect.test.tsx",
    files: "src/App.tsx; src/pages/VaziosRedirect.tsx; teste focado",
  }],
  ["Links de notificações do Portal não navegam", {
    summary: "A linha marca como lida e navega para links internos retornados pela RPC.",
    test: "npx vitest run src/components/portal/__tests__/NotificationBell.test.tsx",
    files: "src/components/portal/NotificationBell.tsx; teste focado",
  }],
  ["Filtro Único BL usa valor incompatível com invoice_type", {
    summary: "O filtro visual single é normalizado para individual.",
    test: "npx vitest run src/services/__tests__/reconciliationInvoiceType.test.ts",
    files: "src/services/reconciliacao.ts; teste focado",
  }],
  ["Legenda afirma confirmação de evento sem dado persistido", {
    summary: "A legenda agora descreve a regra temporal realmente aplicada.",
    test: "npx vitest run src/services/__tests__/uxCopyContracts.test.ts",
    files: "src/components/portal/ShipScheduleWidget.tsx; teste de contrato de conteúdo",
  }],
  ["Widget anuncia atualização diária às 09:00 sem scheduler correspondente", {
    summary: "O texto passou a indicar atualização conforme dados publicados.",
    test: "npx vitest run src/services/__tests__/uxCopyContracts.test.ts",
    files: "src/components/portal/ShipScheduleWidget.tsx; teste de contrato de conteúdo",
  }],
  ["Cabeçalho de Relatórios anuncia limite que não vale para todas as abas", {
    summary: "O cabeçalho usa texto neutro; limites específicos permanecem nas visões aplicáveis.",
    test: "npx vitest run src/services/__tests__/uxCopyContracts.test.ts",
    files: "src/pages/Relatorios.tsx; teste de contrato de conteúdo",
  }],
  ["Falha ao carregar perfil do Portal aparece como dados vazios", {
    summary: "A carga exibe erro e bloqueia edição/salvamento quando o perfil não pode ser lido.",
    test: "npx vitest run src/pages/__tests__/PortalProfile.test.tsx",
    files: "src/pages/PortalProfile.tsx; src/pages/__tests__/PortalProfile.test.tsx",
  }],
  ["Falha do cronograma do Portal é mascarada como lista vazia", {
    summary: "O service passou a propagar erros de leitura do cronograma.",
    test: "npx vitest run src/services/__tests__/vesselSchedules.test.ts",
    files: "src/services/vesselSchedules.ts; src/services/__tests__/vesselSchedules.test.ts",
  }],
  ["Gestão de demurrage não oferece abas para invoices vencidas ou canceladas", {
    summary: "A tela agora cobre todos os cinco estados persistidos de Demurrage.",
    test: "npx vitest run src/services/demurrage/__tests__/demurrageInvoiceTabs.test.ts",
    files: "src/pages/Demurrage.tsx; src/services/demurrage/demurrageInvoiceTabs.ts; teste focado",
  }],
  ["Importação de cronograma processa arquivo sem limite de upload", {
    summary: "O tamanho é validado antes de arrayBuffer e parsing do workbook.",
    test: "npx vitest run src/services/__tests__/vesselScheduleImport.test.ts",
    files: "src/pages/ChegadasSaidas.tsx; src/services/vesselScheduleImport.ts; teste focado",
  }],
  ["Cálculo de Granito tenta emitir invoice antes de promover o B/L", {
    summary: "Calcula, promove a ready_for_billing e somente então emite a invoice Granito.",
    test: "npx vitest run src/services/__tests__/graniteBillingWorkflow.test.ts",
    files: "src/services/graniteBillingWorkflow.ts; src/pages/Granite.tsx; src/services/__tests__/graniteBillingWorkflow.test.ts",
  }],
  ["Emissão manual de Granito chama a RPC de B/L local", {
    summary: "Roteia a emissão individual pela origem cargo_mode.",
    test: "npx vitest run src/services/__tests__/graniteBillingWorkflow.test.ts",
    files: "src/services/graniteBillingWorkflow.ts; src/components/billing/ValidacaoTab.tsx; src/services/__tests__/graniteBillingWorkflow.test.ts",
  }],
  ["Revisão em lote de Granito reporta sucesso sem persistir alteração", {
    summary: "Ação sem transição equivalente agora retorna erro por B/L em vez de sucesso falso.",
    test: "npx vitest run src/services/__tests__/graniteBillingWorkflow.test.ts",
    files: "src/services/graniteBillingWorkflow.ts; src/components/billing/ValidacaoTab.tsx; src/services/__tests__/graniteBillingWorkflow.test.ts",
  }],
  ["Invalidações de Taxas Locais usam chaves que não alcançam queries ativas", {
    summary: "Factories e mutations agora usam chaves-base verdadeiras para invalidação por prefixo.",
    test: "npx vitest run src/services/__tests__/queryKeysPrefix.test.ts",
    files: "src/services/queryKeys.ts; src/hooks/useLocalCharges.ts; src/services/__tests__/queryKeysPrefix.test.ts",
  }],
  ["Validação considera matched_name resolvido, mas o banco bloqueia faturamento", {
    summary: "A UI agora aceita somente matched_document e reconciled como estados resolvidos.",
    test: "npx vitest run src/services/__tests__/customerReconciliationStatus.test.ts",
    files: "src/services/customerReconciliationStatus.ts; src/components/billing/ValidacaoTab.tsx; teste focado",
  }],
  ["Estorno de Demurrage mantém flag de conciliação por extrato", {
    summary: "A reversão limpa conciliated_by_extract, paid_at e pix_txid.",
    test: "npx vitest run src/services/__tests__/reversalJustificationMigration.test.ts",
    files: "supabase/migrations/20260622132451_clear_demurrage_extract_flag_on_reversal.sql; src/services/__tests__/reversalJustificationMigration.test.ts",
  }],
  ["Estorno local fecha o detalhe sem atualizar caches financeiros", {
    summary: "A reversão local invalida todos os consumidores financeiros e o histórico antes de fechar.",
    test: "npx vitest run src/hooks/__tests__/billingLedgerInvalidation.test.ts",
    files: "src/hooks/useBillingLedger.ts; src/components/billing/InvoiceDetailModal.tsx; src/hooks/__tests__/billingLedgerInvalidation.test.ts",
  }],
  ["Desmarcar pagamento em Demurrage contorna o fluxo auditado de reversão", {
    summary: "A tela exige justificativa e usa reverse_demurrage_payment.",
    test: "npx vitest run src/components/demurrage/__tests__/DemurragePaymentReversalModal.test.tsx src/services/__tests__/reconciliacao.test.ts",
    files: "src/pages/Demurrage.tsx; src/components/demurrage/DemurragePaymentReversalModal.tsx; teste do modal",
  }],
  ["Criação de invoice de Demurrage pode deixar cabeçalho sem itens", {
    summary: "Cabeçalho e itens passaram para uma única RPC transacional.",
    test: "npx vitest run src/services/demurrage/__tests__/createDemurrageInvoiceAtomic.test.ts src/services/__tests__/createDemurrageInvoiceMigration.test.ts",
    files: "src/services/demurrage/demurrageInvoices.ts; supabase/migrations/20260622132732_create_demurrage_invoice_atomic.sql; testes focados",
  }],
  ["Emissão automática pode registrar origem incorreta do ROE", {
    summary: "O importador repassa source de fetchROE para issueInvoice.",
    test: "npx vitest run src/services/__tests__/containerDatesImport.test.ts",
    files: "src/services/containerDatesImport.ts; src/services/__tests__/containerDatesImport.test.ts",
  }],
  ["Emissão em lote pode promover B/Ls sem criar a invoice correspondente", {
    summary: "Cada grupo de cliente é promovido e faturado por uma única RPC.",
    test: "npx vitest run src/services/__tests__/localBatchBillingWorkflow.test.ts src/services/__tests__/markBlsReadyAndCreateInvoiceMigration.test.ts",
    files: "src/components/billing/ValidacaoTab.tsx; src/services/localBatchBillingWorkflow.ts; src/services/billing.ts; supabase/migrations/20260622133100_mark_bls_ready_and_create_invoice_atomic.sql",
  }],
  ["Ações de importação Baplie aparecem para perfil que o banco rejeita", {
    summary: "Importar e reimportar Baplie agora aparecem somente para administradores, alinhados à RPC.",
    test: "npx vitest run src/services/__tests__/uxCopyContracts.test.ts",
    files: "src/pages/Baplie.tsx; src/services/__tests__/uxCopyContracts.test.ts",
  }],
  ["Edição geral de datas de container não gera histórico equivalente", {
    summary: "Descarga, devolução e status passam por RPC única com auditoria na mesma transação.",
    test: "npx vitest run src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts src/services/__tests__/containerDateAuditMigration.test.ts",
    files: "src/services/demurrage/demurrageContainers.ts; supabase/migrations/20260622180300_audit_container_dates_and_propagate_ata.sql",
  }],
  ["Exportação de clientes não espelha filtros, ordenação e emails da tela", {
    summary: "Tela e exportação reutilizam a mesma consulta e o XLSX inclui o contato principal.",
    test: "npx vitest run src/services/__tests__/exports.test.ts",
    files: "src/pages/Clientes.tsx; src/hooks/useCustomers.ts; src/services/exports.ts; src/services/__tests__/exports.test.ts",
  }],
  ["Filtros de overrides são aplicados somente após um lote limitado", {
    summary: "A consulta pagina a fonte e aplica filtros antes de limitar a visão resultante.",
    test: "npx vitest run src/services/__tests__/chargeRateService.test.ts",
    files: "src/services/charges/chargeRateService.ts; src/services/__tests__/chargeRateService.test.ts",
  }],
  ["Usuário com acesso somente a overrides abre Taxas Locais sem conteúdo", {
    summary: "A rota deriva a aba ativa da primeira capacidade disponível.",
    test: "npx vitest run src/pages/__tests__/TaxasLocais.test.ts",
    files: "src/pages/TaxasLocais.tsx; src/pages/__tests__/TaxasLocais.test.ts",
  }],
  ["Encerrar navio pode duplicar ativo e histórico", {
    summary: "Snapshot e remoção do ativo agora ocorrem em uma RPC transacional com lock.",
    test: "npx vitest run src/services/__tests__/vesselScheduleAdmin.test.ts",
    files: "src/services/vesselScheduleAdmin.ts; src/pages/ChegadasSaidas.tsx; supabase/migrations/20260622174608_atomic_vessel_schedule_operations.sql",
  }],
  ["Reordenação de navios pode persistir apenas parte da ordem", {
    summary: "Toda a ordem é validada, bloqueada e persistida por uma única RPC.",
    test: "npx vitest run src/services/__tests__/vesselScheduleAdmin.test.ts",
    files: "src/services/vesselScheduleAdmin.ts; src/pages/ChegadasSaidas.tsx; supabase/migrations/20260622174608_atomic_vessel_schedule_operations.sql",
  }],
  ["Lista e detalhe genéricos de invoices perdem vínculo operacional do Granito", {
    summary: "Lista e detalhe hidratam invoice_granite_bls com B/L, POD, navio e viagem.",
    test: "npx vitest run src/services/__tests__/billing.test.ts src/services/__tests__/graniteInvoiceDetail.test.ts",
    files: "src/services/billing.ts; src/components/billing/InvoicesTable.tsx; testes focados",
  }],
  ["RPC de Granito grava invoice com tipo individual", {
    summary: "Trigger classifica como granite toda invoice ligada a invoice_granite_bls e corrige o legado.",
    test: "npx vitest run src/services/__tests__/graniteInvoiceClassification.test.ts",
    files: "supabase/migrations/20260622175108_classify_granite_invoices.sql; teste focado",
  }],
  ["Importação Granito pode deixar manifesto incompleto", {
    summary: "Cabeçalho e B/Ls aceitos são persistidos por uma RPC transacional.",
    test: "npx vitest run src/services/__tests__/graniteImportAtomic.test.ts",
    files: "src/services/graniteImport.ts; supabase/migrations/20260622174832_import_granite_manifest_transactional.sql; teste focado",
  }],
  ["Importação em lote de datas não aparece no Histórico do B/L", {
    summary: "O importador reutiliza a RPC auditada de datas para cada container alterado.",
    test: "npx vitest run src/services/__tests__/containerDatesImport.test.ts src/services/__tests__/containerDateAuditMigration.test.ts",
    files: "src/services/containerDatesImport.ts; supabase/migrations/20260622180300_audit_container_dates_and_propagate_ata.sql",
  }],
  ["Correção posterior da ATA da viagem não atualiza descarga dos containers", {
    summary: "Trigger propaga a ATA corrigida somente para datas ainda derivadas, preservando edições manuais.",
    test: "npx vitest run src/services/__tests__/containerDateAuditMigration.test.ts",
    files: "supabase/migrations/20260622180300_audit_container_dates_and_propagate_ata.sql; teste focado",
  }],
  ["Instalacao limpa nao concede acesso a programacao de navios", {
    summary: "Grants explicitos permitem que authenticated chegue as policies RLS de programacao e encerrados.",
    test: "npx vitest run src/services/__tests__/vesselScheduleAdmin.test.ts; validacao PostgreSQL 17",
    files: "supabase/migrations/20260622213000_grant_vessel_schedule_privileges.sql; docs/modules/chegadas-saidas.md",
    runtime: true,
  }],
  ["Rate limit de manifesto referencia coluna ausente em instalacao limpa", {
    summary: "created_at tornou-se alias gerado e compativel de uploaded_at para as RPCs de rate limit.",
    test: "npx vitest run src/services/__tests__/importRateLimitTimestampMigration.test.ts; integracao P0429",
    files: "supabase/migrations/20260622213500_import_batches_rate_limit_timestamp_compat.sql",
    runtime: true,
  }],
  ["Wrapper de emissao nao consegue executar o core revogado", {
    summary: "Os wrappers validados executam como definidor; o core continua revogado para acesso direto.",
    test: "npx vitest run src/services/__tests__/billingCoreWrapperPrivilegesMigration.test.ts; integracao de faturamento",
    files: "supabase/migrations/20260622214500_secure_billing_core_wrappers.sql",
    runtime: true,
  }],
  ["Cancelamento de invoice falha ao atualizar billing_batches", {
    summary: "cancel_invoice executa como definidor somente apos validar sessao ativa e papel admin.",
    test: "npx vitest run src/services/__tests__/billingCancelPrivilegesMigration.test.ts; integracao criar/cancelar/reemitir",
    files: "supabase/migrations/20260622215000_secure_cancel_invoice_wrapper.sql; docs/modules/faturamento.md",
    runtime: true,
  }],
  ["Selecao de clientes atravessa paginas e filtros invisiveis", {
    summary: "A selecao agora recebe um escopo de filtros, ordenacao e pagina e e limpa quando ele muda.",
    test: "npx vitest run src/hooks/__tests__/useRowSelection.test.tsx",
    files: "src/hooks/useRowSelection.ts; src/pages/Clientes.tsx",
    runtime: true,
  }],
  ["Criacao de cliente e contatos nao e atomica", {
    summary: "Cliente e contatos iniciais sao criados por uma unica RPC transacional.",
    test: "npx vitest run src/services/__tests__/customerCreateAtomic.test.ts; replay PostgreSQL 17",
    files: "src/services/customers.ts; supabase/migrations/20260623062000_create_customer_with_contacts_atomic.sql",
    runtime: true,
  }],
  ["Ficha do cliente mistura nao encontrado com falha de banco", {
    summary: "PGRST116/ausencia e falha de infraestrutura agora renderizam estados distintos.",
    test: "npx vitest run src/pages/__tests__/ClienteFicha.behavior.test.tsx",
    files: "src/pages/ClienteFicha.tsx",
    runtime: true,
  }],
  ["Exportacao do Line-Up no Painel falhava sem feedback ao operador", {
    summary: "A exportacao agora usa useToast, rastreia estado de loading e envolve a escrita em try/catch/finally, exibindo 'Falha ao exportar o Line Up.' e restaurando o botao.",
    test: "vitest run src/pages/__tests__/Painel.behavior.test.tsx",
    files: "src/pages/Painel.tsx; teste comportamental",
  }],
  ["Reconhecer alerta reportava sucesso em transicao obsoleta", {
    summary: "acknowledgeAlert agora encadeia .select('id').maybeSingle() e lanca erro explicito de estado obsoleto quando nenhuma linha e retornada.",
    test: "vitest run src/services/__tests__/alertsTransitions.test.ts",
    files: "src/services/alerts.ts; teste focado",
  }],
  ["Fechar alerta reportava sucesso em transicao obsoleta", {
    summary: "closeAlert agora encadeia .select('id').maybeSingle() e lanca erro explicito de estado obsoleto quando nenhuma linha e retornada.",
    test: "vitest run src/services/__tests__/alertsTransitions.test.ts",
    files: "src/services/alerts.ts; teste focado",
  }],
  ["Vinculo de cliente Granite atualizava e auditava em requisicoes separadas", {
    summary: "saveGraniteBlReview agora chama a RPC save_granite_bl_review, que faz lock da linha, atualiza client_id e insere auditoria em uma unica transacao.",
    test: "vitest run src/services/__tests__/graniteReviewAtomic.test.ts",
    files: "src/services/review.ts; src/types/database.ts; supabase/migrations/20260623120000_save_granite_bl_review_atomic.sql; teste focado",
    runtime: true,
  }],
  ["Falha ao resolver autores do log de auditoria era silenciada", {
    summary: "fetchAuditLogs agora propaga o erro do lookup de user_profiles e a aba de logs renderiza InlineError dedicado; logica extraida para o service adminObservability.",
    test: "vitest run src/services/__tests__/adminObservability.test.ts",
    files: "src/services/adminObservability.ts; src/pages/AdminUsuarios.tsx; teste focado",
  }],
  ["Metricas do sistema ignoravam erros das tres consultas", {
    summary: "fetchSystemMetrics agora lanca em qualquer erro das tres leituras e a aba de metricas renderiza InlineError dedicado; logica extraida para o service adminObservability.",
    test: "vitest run src/services/__tests__/adminObservability.test.ts",
    files: "src/services/adminObservability.ts; src/pages/AdminUsuarios.tsx; teste focado",
  }],
]);

const runtimePassesByStory = new Map([
  [findStoryId("chegadas-saidas", "adicionar navio"), {
    evidence: "Component behavior test: creates a vessel after the current final display order.",
    notes: "src/pages/__tests__/ChegadasSaidas.behavior.test.tsx",
  }],
  [findStoryId("chegadas-saidas", "editar navio"), {
    evidence: "Component behavior test: edits an existing vessel and persists the changed voyage.",
    notes: "src/pages/__tests__/ChegadasSaidas.behavior.test.tsx",
  }],
  [findStoryId("chegadas-saidas", "excluir permanentemente"), {
    evidence: "Component behavior test: requires confirmation and deletes the selected vessel.",
    notes: "src/pages/__tests__/ChegadasSaidas.behavior.test.tsx",
  }],
  [findStoryId("chegadas-saidas", "abrir marinetraffic"), {
    evidence: "Component behavior test: renders the exact MarineTraffic IMO URL.",
    notes: "src/pages/__tests__/ChegadasSaidas.behavior.test.tsx",
  }],
  [findStoryId("chegadas-saidas", "atualizar portal por realtime"), {
    evidence: "Component behavior test: Realtime event invalidates the Portal schedule and cleanup removes the channel.",
    notes: "src/components/portal/__tests__/ShipScheduleWidget.test.tsx",
  }],
  [findStoryId("clientes", "selecionar linhas"), {
    evidence: "Hook behavior test: changing page/filter scope clears all previously selected customer IDs.",
    notes: "src/hooks/__tests__/useRowSelection.test.tsx",
  }],
  [findStoryId("clientes", "criar cliente"), {
    evidence: "Service and migration contract: customer and contacts created atomically; clean replay applied 143 migrations.",
    notes: "src/services/__tests__/customerCreateAtomic.test.ts",
  }],
  [findStoryId("clientes", "criar/editar contato"), {
    evidence: "Component behavior test: edits contact data and invalidates customer detail.",
    notes: "src/pages/__tests__/ClienteFicha.behavior.test.tsx",
  }],
  [findStoryId("clientes", "remover contato"), {
    evidence: "Component behavior test: explicit confirmation precedes contact deletion.",
    notes: "src/pages/__tests__/ClienteFicha.behavior.test.tsx",
  }],
  [findStoryId("clientes", "rota inválida"), {
    evidence: "Component behavior tests distinguish not-found/PGRST116 from infrastructure failure.",
    notes: "src/pages/__tests__/ClienteFicha.behavior.test.tsx",
  }],
  [findStoryId("faturamento", "carregar breakdown consolidado"), {
    evidence: "SQL contract and billing-ledger tests validate consolidated receivable breakdown and normalized detail rows.",
    notes: "consolidatedInvoiceBreakdownMigration.test.ts; billingLedger.test.ts",
  }],
  [findStoryId("faturamento", "marcar pronto selecionados"), {
    evidence: "Atomic batch workflow tests and disposable integration validate grouped promotion plus invoice creation.",
    notes: "localBatchBillingWorkflow.test.ts; 9/9 Supabase integration run",
  }],
  [findStoryId("faturamento", "marcar pronto e emitir atomicamente"), {
    evidence: "Migration contract and disposable integration validate atomic single-B/L promotion and emission.",
    notes: "markBlsReadyAndCreateInvoiceMigration.test.ts; 9/9 Supabase integration run",
  }],
  [findStoryId("faturamento", "adicionar other charge"), {
    evidence: "Component, service and SQL-guard tests validate form payload, RPC call, invoice state and payment guards.",
    notes: "ManualChargeFormFields.test.tsx; billing.test.ts; guardManualChargesMigration.test.ts",
  }],
  [findStoryId("faturamento", "abrir invoice"), {
    evidence: "Page behavior test: invoice query-string ID opens the matching detail modal.",
    notes: "src/pages/__tests__/Faturamento.behavior.test.tsx",
  }],
  [findStoryId("faturamento", "marcar vencidas ao abrir"), {
    evidence: "Page behavior test: overdue detection failure is captured by best-effort telemetry without unhandled rejection.",
    notes: "src/pages/__tests__/Faturamento.behavior.test.tsx",
  }],
  [findStoryId("faturamento", "recalcular selecionados"), {
    evidence: "Batch service tests validate normalization, continued execution and per-B/L partial error aggregation.",
    notes: "src/services/__tests__/localCharges.test.ts; graniteBillingWorkflow.test.ts",
  }],
  [findStoryId("faturamento", "aprovar revisão selecionada"), {
    evidence: "Batch tests validate isolated local failures and canonical Granite unsupported result without false success.",
    notes: "localCharges.test.ts; validacaoGraniteWorkflowContract.test.ts",
  }],
  [findStoryId("faturamento", "imprimir invoice"), {
    evidence: "Component behavior test: printable invoice is opened only after the print action.",
    notes: "src/components/billing/__tests__/InvoiceDetailPrint.test.tsx",
  }],
  [findStoryId("faturamento", "histórico de reconciliação"), {
    evidence: "Component tests validate current-filter export, detail routing and dedicated query error state.",
    notes: "src/components/billing/__tests__/ReconciliationHistoryTable.behavior.test.tsx",
  }],
  [findStoryId("taxas-locais", "filtrar/listar tabelas"), {
    evidence: "Component and service tests validate filtered table loading, summaries, empty/error states and ordered items.",
    notes: "TaxasLocais.behavior.test.tsx; localCharges.test.ts",
  }],
  [findStoryId("taxas-locais", "criar/editar tabela"), {
    evidence: "Component behavior and validation tests cover normalized create/edit payloads and invalid validity windows.",
    notes: "TaxasLocais.behavior.test.tsx; taxasLocaisHelpers.test.ts",
  }],
  [findStoryId("taxas-locais", "ativar/inativar tabela"), {
    evidence: "Component behavior test persists the inverse active state for the selected table.",
    notes: "src/components/taxasLocais/__tests__/TaxasLocais.behavior.test.tsx",
  }],
  [findStoryId("taxas-locais", "adicionar/editar item"), {
    evidence: "Component, validation and service tests cover item editing, normalized values and cache contracts.",
    notes: "TaxasLocais.behavior.test.tsx; taxasLocaisHelpers.test.ts; queryKeysPrefix.test.ts",
  }],
  [findStoryId("taxas-locais", "excluir item"), {
    evidence: "Component behavior test requires confirmation before deleting a charge-table item.",
    notes: "src/components/taxasLocais/__tests__/TaxasLocais.behavior.test.tsx",
  }],
  [findStoryId("taxas-locais", "filtrar/listar overrides"), {
    evidence: "Behavior and service tests validate authorization-aware tab selection and complete pagination before filters.",
    notes: "TaxasLocais.test.ts; chargeRateService.test.ts",
  }],
  [findStoryId("taxas-locais", "buscar cliente/item"), {
    evidence: "Component behavior test loads eligible customer and charge-item options into controlled selectors.",
    notes: "src/components/taxasLocais/__tests__/TaxasLocais.behavior.test.tsx",
  }],
  [findStoryId("taxas-locais", "criar/editar override"), {
    evidence: "Component and validation tests cover normalized create/edit payloads, dates and positive values.",
    notes: "TaxasLocais.behavior.test.tsx; taxasLocaisHelpers.test.ts",
  }],
  [findStoryId("taxas-locais", "excluir override"), {
    evidence: "Component behavior test requires confirmation and deletes the selected override.",
    notes: "src/components/taxasLocais/__tests__/TaxasLocais.behavior.test.tsx",
  }],
  [findStoryId("taxas-locais", "calcular ou recalcular um"), {
    evidence: "Service tests validate the calculation RPC payload and normalized result.",
    notes: "src/services/__tests__/localCharges.test.ts",
  }],
  [findStoryId("taxas-locais", "calcular/recalcular selecionados"), {
    evidence: "Batch tests validate deduplication, continued execution and per-B/L error aggregation.",
    notes: "src/services/__tests__/localCharges.test.ts",
  }],
  [findStoryId("taxas-locais", "adicionar cobrança manual"), {
    evidence: "Component, service and SQL-guard tests validate manual-charge payload and persistence contract.",
    notes: "ManualChargeFormFields.test.tsx; localCharges.test.ts; guardManualChargesMigration.test.ts",
  }],
  [findStoryId("taxas-locais", "editar cobrança manual"), {
    evidence: "Service and SQL-contract tests validate guarded manual-charge updates.",
    notes: "localCharges.test.ts; guardManualChargesMigration.test.ts",
  }],
  [findStoryId("taxas-locais", "excluir cobrança manual"), {
    evidence: "Service and SQL-contract tests validate guarded manual-charge deletion.",
    notes: "localCharges.test.ts; guardManualChargesMigration.test.ts",
  }],
  [findStoryId("taxas-locais", "marcar revisado"), {
    evidence: "Service tests validate individual and batch review transitions with isolated failures.",
    notes: "src/services/__tests__/localCharges.test.ts",
  }],
  [findStoryId("taxas-locais", "marcar pronto para faturar"), {
    evidence: "Service, SQL-contract and integration tests validate the canonical ready-for-billing gate.",
    notes: "localCharges.test.ts; guardInvoiceableReadyStateMigration.test.ts; Supabase integration",
  }],
  [findStoryId("taxas-locais", "aprovar reconciliação"), {
    evidence: "Service tests and shared billing behavior cover approval routing and cache invalidation.",
    notes: "localCharges.test.ts; queryKeysPrefix.test.ts",
  }],
  [findStoryId("taxas-locais", "rejeitar reconciliação"), {
    evidence: "Service tests and shared billing behavior cover rejection routing and cache invalidation.",
    notes: "localCharges.test.ts; queryKeysPrefix.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "selecionar/upload"), {
    evidence: "Page behavior and upload-limit tests validate file selection, processing state and guarded parsing.",
    notes: "Reconciliacao.behavior.test.tsx; uploadLimits.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "extrair linhas bancárias"), {
    evidence: "Parser tests validate headers, positive amounts, normalized dates and ignored invalid rows.",
    notes: "src/services/__tests__/demurrageKpis.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "carregar documentos locais"), {
    evidence: "Service tests validate parallel local/Demurrage candidate loading and TXID-only matching.",
    notes: "src/services/__tests__/reconciliacao.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "classificar sem match"), {
    evidence: "Service and page tests validate visible unmatched rows excluded from confirmation.",
    notes: "reconciliacao.test.ts; Reconciliacao.behavior.test.tsx",
  }],
  [findStoryId("reconciliacao-pix", "classificar ambiguidade"), {
    evidence: "Service and page tests validate duplicate/cross-domain TXIDs and the dedicated ambiguity panel.",
    notes: "reconciliacao.test.ts; Reconciliacao.behavior.test.tsx",
  }],
  [findStoryId("reconciliacao-pix", "classificar divergência"), {
    evidence: "Service tests validate exact-value tolerance and block both local and Demurrage differences.",
    notes: "src/services/__tests__/reconciliacao.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "confirmar somente"), {
    evidence: "Page and service tests validate safe-only payload, required dates, result rendering and cache invalidation.",
    notes: "Reconciliacao.behavior.test.tsx; reconciliacao.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "conciliar item local"), {
    evidence: "Service and SQL-contract tests validate unified RPC payload and ledger-backed exact settlement.",
    notes: "reconciliacao.test.ts; pixExactAndRefundsMigration.test.ts; ledgerPixPayloadMigration.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "conciliar item demurrage"), {
    evidence: "Service and SQL-contract tests validate one transactional batch and exact Demurrage settlement.",
    notes: "reconciliacao.test.ts; reversalJustificationMigration.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "exibir retorno"), {
    evidence: "Page behavior test renders source, document and confirmation status returned by the RPC.",
    notes: "src/pages/__tests__/Reconciliacao.behavior.test.tsx",
  }],
  [findStoryId("reconciliacao-pix", "listar/filtrar/ordenar/paginar"), {
    evidence: "Service and component tests validate complete source pagination, filters, sorting, page state and error UI.",
    notes: "reconciliationHistoryPagination.test.ts; ReconciliationHistoryTable.behavior.test.tsx",
  }],
  [findStoryId("reconciliacao-pix", "exportar"), {
    evidence: "Component tests validate current filters, formula-safe export path and dedicated export failure feedback.",
    notes: "ReconciliationHistoryTable.behavior.test.tsx; reconciliacao.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "abrir detalhe local"), {
    evidence: "Component and service tests route the selected invoice with the payment ID from the same latest payment.",
    notes: "ReconciliationHistoryTable.behavior.test.tsx; reconciliationInvoiceType.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "abrir detalhe demurrage"), {
    evidence: "Page behavior test opens and renders the selected Demurrage receipt detail.",
    notes: "src/pages/__tests__/Reconciliacao.behavior.test.tsx",
  }],
  [findStoryId("reconciliacao-pix", "reverseLocalPaymentAndInvalidate"), {
    evidence: "Focused tests validate justification, audited reversal and complete financial cache invalidation.",
    notes: "billingLedgerInvalidation.test.ts; reversalBlsFinancialStatusMigration.test.ts",
  }],
  [findStoryId("reconciliacao-pix", "reverseDemurragePayment"), {
    evidence: "Page and SQL-contract tests validate admin-only justified reversal, cache refresh and extract-flag cleanup.",
    notes: "Reconciliacao.behavior.test.tsx; reversalJustificationMigration.test.ts; clear flag migration",
  }],
  [findStoryId("manifesto-edi", "parse/preview/import BB"), {
    evidence: "Parser fixtures, service contract, clean 144-migration replay and transactional rollback/success checks passed.",
    notes: "breakbulkImport.test.ts; breakbulkImportAtomicMigration.test.ts; PostgreSQL breakbulk-import-atomic",
  }],
  [findStoryId("manifesto-edi", "parse e preview CNTR"), {
    evidence: "Parser, notify-party and real workbook fixture tests validate CNTR layouts, normalization and preview data.",
    notes: "manifestParser.test.ts; manifestParser.notify.test.ts; manifestFixtures.real.test.ts",
  }],
  [findStoryId("manifesto-edi", "importar manifesto CNTR"), {
    evidence: "Service, SQL contract and disposable integration tests validate the transactional import wrapper and post-processing.",
    notes: "manifestImport.test.ts; manifestImportBillingReasonMigration.test.ts; 9/9 integration suite",
  }],
  [findStoryId("manifesto-edi", "detectar arquivo/batch duplicado"), {
    evidence: "Service and disposable integration tests validate file hash uniqueness plus 23505/P0429 error mapping.",
    notes: "manifestImport.test.ts; 9/9 integration suite",
  }],
  [findStoryId("manifesto-edi", "CE Mercante por linha"), {
    evidence: "Parser/service tests validate headers, unique B/L rows, 15-digit CE values and per-row RPC updates.",
    notes: "src/services/__tests__/ceMercanteImport.test.ts",
  }],
  [findStoryId("manifesto-edi", "CE Mercante por manifesto EDI"), {
    evidence: "EDI parser, service and SQL-contract tests validate complete single-batch all-or-nothing application.",
    notes: "ceMercanteEdiParser.test.ts; ceMercanteImport.test.ts; apply CE migration",
  }],
  [findStoryId("manifesto-edi", "sincronizar aba com URL"), {
    evidence: "Route tests validate exactly three tab keys and fallback to details for unknown values.",
    notes: "src/pages/__tests__/blTabs.test.tsx",
  }],
  [findStoryId("manifesto-edi", "exibir NCM e Notify Party"), {
    evidence: "NCM and manifest parser tests validate derived/deduplicated codes and notify-party preservation.",
    notes: "ncm.test.ts; manifestParser.notify.test.ts",
  }],
  [findStoryId("manifesto-edi", "calcular/revisar taxas e faturar"), {
    evidence: "Local-charge, billing and atomic invoice workflow tests cover calculation, review, readiness and issuance.",
    notes: "localCharges.test.ts; localBatchBillingWorkflow.test.ts; billing tests",
  }],
  [findStoryId("manifesto-edi", "importar datas"), {
    evidence: "Service and PostgreSQL write-path checks validate date order, audit events, manual preservation and Demurrage effects.",
    notes: "containerDatesImport.test.ts; container-dates-audit-and-manual-preservation",
  }],
  [findStoryId("manifesto-edi", "importar IMO/OOG"), {
    evidence: "Parser/service tests validate normalized flags, matching, missing rows and audited updates.",
    notes: "src/services/__tests__/containerFlagsImport.test.ts",
  }],
  [findStoryId("manifesto-edi", "Valida chassi"), {
    evidence: "Vehicle parser/import tests validate system, COSCO and Chinese layouts, ambiguity guards and financial post-processing.",
    notes: "src/services/__tests__/vehicleImport.test.ts",
  }],
  [findStoryId("manifesto-edi", "importar ou substituir staging"), {
    evidence: "Baplie parser/import service and SQL-contract tests validate EDIFACT staging replacement through the transactional RPC.",
    notes: "baplie parser/import tests; transactional_baplie_vehicle_imports migration",
  }],
  [findStoryId("manifesto-edi", "aplicar atributo físico"), {
    evidence: "Reconciliation and invalidation tests validate field application, audit and all dependent cache consumers.",
    notes: "baplieReconciliation.test.ts; baplieInvalidation.test.ts",
  }],
  [findStoryId("manifesto-edi", "manter valor do manifesto"), {
    evidence: "Service tests validate durable value-sensitive resolution and audit without mutating the container.",
    notes: "src/services/__tests__/baplieReconciliation.test.ts",
  }],
  [findStoryId("manifesto-edi", "importar planilha"), {
    evidence: "Vazios import parser tests validate header aliases, normalized tare, invalid ISO handling and empty input.",
    notes: "src/services/__tests__/vaziosImportacaoImport.test.ts",
  }],
  [findStoryId("manifesto-edi", "Excluir B/L elegível"), {
    evidence: "Service tests validate dependency blocking, vehicle-first deletion and database error propagation.",
    notes: "src/services/__tests__/bls.delete.test.ts",
  }],
  [findStoryId("manifesto-edi", "remove veículos antes de containers"), {
    evidence: "Service tests validate charge/demurrage dependency blocking, vehicle-first deletion and database error propagation.",
    notes: "src/services/__tests__/containers.delete.test.ts",
  }],
  [findStoryId("manifesto-edi", "deleteVehicles por IDs"), {
    evidence: "Service tests validate selected-ID deletion, empty selection behavior, audit logging and database error propagation.",
    notes: "src/services/__tests__/vehicles.delete.test.ts",
  }],
  [findStoryId("manifesto-edi", "editar CE Master"), {
    evidence: "Focused service and SQL-contract tests validate normalized CE Master plus audit in one protected transaction.",
    notes: "src/services/__tests__/manifestCeMasterAtomic.test.ts",
  }],
  [findStoryId("manifesto-edi", "editar revisão operacional e carga"), {
    evidence: "Review service and canonical-gate SQL tests validate audited field updates, optimistic locking and database-owned review status.",
    notes: "review.test.ts; reviewGateCanonicalMigration.test.ts; reviewGateHardeningMigration.test.ts",
  }],
  [findStoryId("manifesto-edi", "vincular, criar ou desvincular cliente"), {
    evidence: "Atomic customer creation and hardened save_bl_review contracts validate creation, link/unlink and reconciliation status updates.",
    notes: "customerCreateAtomic.test.ts; reviewGateHardeningMigration.test.ts",
  }],
  [findStoryId("manifesto-edi", "configurar demurrage"), {
    evidence: "Focused service and SQL-contract tests validate free time, P1, P2, audit and optimistic locking in one transaction.",
    notes: "src/services/__tests__/blDemurrageConfigAtomic.test.ts",
  }],
  [findStoryId("manifesto-edi", "importar/substituir/manter vazios"), {
    evidence: "Focused tests validate initial Baplie import and replacement through one protected transactional RPC.",
    notes: "src/services/__tests__/vaziosImportsAtomic.test.ts",
  }],
  [findStoryId("manifesto-edi", "parse/preview/import booking"), {
    evidence: "Focused tests validate booking manifest and item persistence through one transactional RPC.",
    notes: "src/services/__tests__/vaziosImportsAtomic.test.ts",
  }],
  [findStoryId("manifesto-edi", "filtrar, paginar, selecionar e abrir B/L"), {
    evidence: "Page behavior test validates filter reset, next-page navigation, row selection and B/L detail link.",
    notes: "src/pages/__tests__/Manifestos.behavior.test.tsx",
  }],
  [findStoryId("manifesto-edi", "abrir invoice ativa e carregar Histórico"), {
    evidence: "Component behavior tests validate the invoice query link, timeline rendering and next-page action.",
    notes: "src/components/bl/__tests__/BlBillingHistory.behavior.test.tsx",
  }],
  [findStoryId("portal-cliente", "rotas protegidas"), {
    evidence: "Browser runtime: /portal/billing redirected to /portal/login without a Portal session.",
    notes: "Validated against the configured Supabase project on 2026-06-22.",
  }],
  [findStoryId("manifesto-edi", "importar manifesto"), {
    evidence: "Disposable PostgreSQL 17 integration: duplicate hash 23505 and rate limit P0429 passed.",
    notes: "Local fixtures only; database recreated from all 142 migrations.",
  }],
  [findStoryId("faturamento", "emitir invoice"), {
    evidence: "Disposable integration: create, cancel, reissue, partial and full settlement passed.",
    notes: "Admin and operator authorization paths both exercised.",
  }],
  [findStoryId("faturamento", "cancelar invoice"), {
    evidence: "Disposable integration: cancellation restored B/L state and allowed reissue.",
    notes: "Operator cancellation was rejected with 42501.",
  }],
  [findStoryId("clientes", "editar"), {
    evidence: "Transactional write validation: customer update and audit passed with rollback.",
    notes: "Validated against PostgreSQL 17 disposable fixtures.",
  }],
  [findStoryId("chegadas-saidas", "reordenar"), {
    evidence: "Transactional write validation: atomic vessel reorder passed with rollback.",
    notes: "Validated against PostgreSQL 17 disposable fixtures.",
  }],
  [findStoryId("chegadas-saidas", "encerrar"), {
    evidence: "Transactional write validation: atomic vessel archive passed with rollback.",
    notes: "Validated against PostgreSQL 17 disposable fixtures.",
  }],
  [findStoryId("granito", "importar"), {
    evidence: "Transactional write validation: Granite import passed with rollback.",
    notes: "Validated against PostgreSQL 17 disposable fixtures.",
  }],
  [findStoryId("granito", "invoice"), {
    evidence: "Transactional write validation: Granite invoice classification passed with rollback.",
    notes: "Validated against PostgreSQL 17 disposable fixtures.",
  }],
  [findStoryId("demurrage", "editar datas"), {
    evidence: "Transactional write validation: audited container dates and manual-date preservation passed.",
    notes: "Validated against PostgreSQL 17 disposable fixtures.",
  }],
  [findStoryId("operacao-suporte", "carregar kpis"), {
    evidence: "Component behavior test: dashboard KPIs render their values and each card links to the correct route.",
    notes: "src/pages/__tests__/Painel.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "snapshot line-up"), {
    evidence: "Component behavior test: Line-Up snapshot renders the active vessel row and the last-updated timestamp.",
    notes: "src/pages/__tests__/Painel.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "filtrar/exportar line-up"), {
    evidence: "Component behavior test: status filter hides non-matching escalas and restores them; export action covered by DEF-057.",
    notes: "src/pages/__tests__/Painel.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "abrir atalhos"), {
    evidence: "Component behavior test: Chegadas/Saidas and Abrir tela TV shortcuts point to /chegadas-saidas and /line-up-tv/display.",
    notes: "src/pages/__tests__/Painel.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "criar e selecionar cliente"), {
    evidence: "Component behavior test: drawer creates a new customer and leaves it selected for vinculacao.",
    notes: "src/pages/__tests__/Revisao.test.tsx",
  }],
  [findStoryId("operacao-suporte", "filtrar/listar"), {
    evidence: "Component behavior test: alert list renders and the status tabs (all/open/acknowledged) filter the rows.",
    notes: "src/pages/__tests__/Alertas.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "abrir entidade"), {
    evidence: "Component behavior test: container and invoice alerts expose direct entity links (/demurrage?busca, /faturamento?invoice).",
    notes: "src/pages/__tests__/Alertas.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "consultar operacional"), {
    evidence: "Component behavior test: operational report renders KPIs and B/L rows for the period.",
    notes: "src/pages/__tests__/Relatorios.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "consultar demurrage"), {
    evidence: "Component behavior test: demurrage report tab lists the period invoices (doc/BL/cliente/totais).",
    notes: "src/pages/__tests__/Relatorios.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "abrir /line-up-tv"), {
    evidence: "Component behavior test: /line-up-tv redirects to /painel.",
    notes: "src/pages/__tests__/LineUpTV.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "exibir quadro tv"), {
    evidence: "Component behavior test: LineUpTVDisplay renders loading, error and snapshot states.",
    notes: "src/pages/__tests__/LineUpTV.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "listar usuários"), {
    evidence: "Component behavior test: admin user list renders names, roles and active/inactive status.",
    notes: "src/pages/__tests__/AdminUsuarios.behavior.test.tsx",
  }],
  [findStoryId("operacao-suporte", "alterar role/ativo"), {
    evidence: "Component behavior test: toggling active and changing role call updateUserProfile with the right payload.",
    notes: "src/pages/__tests__/AdminUsuarios.behavior.test.tsx",
  }],
  [findStoryId("viagens", "buscar, filtrar e ordenar"), {
    evidence: "filterVoyageRailItems tests cover search, status, conciliation, period windows and next-call ordering.",
    notes: "src/lib/__tests__/viagensFilters.test.ts",
  }],
  [findStoryId("viagens", "adicionar ou editar schedule pod"), {
    evidence: "PodScheduleModal/AddPodToVoyageModal tests cover prefill, typed payload, restow/escala normalization and disabled-while-empty.",
    notes: "src/components/shared/__tests__/VoyageScheduleModals.test.tsx",
  }],
  [findStoryId("viagens", "editar schedule pol"), {
    evidence: "PolScheduleModal tests cover ETD prefill, null-on-clear and CE Master propagation to the manifest batches.",
    notes: "src/components/shared/__tests__/VoyageScheduleModals.test.tsx",
  }],
  [findStoryId("viagens", "criar/editar ou excluir export schedule"), {
    evidence: "ExportScheduleModal tests cover prefill from existing record, POL uppercase and empty-quantity-to-null payload.",
    notes: "src/components/shared/__tests__/VoyageScheduleModals.test.tsx",
  }],
  [findStoryId("viagens", "criar ou editar viagem"), {
    evidence: "voyageForm tests cover trim/uppercase normalization, POD dedup-by-uppercase and Zod validation of required fields.",
    notes: "src/services/__tests__/voyageForm.test.ts",
  }],
  [findStoryId("viagens", "excluir viagem"), {
    evidence: "deleteVoyage tests cover the dependency pre-count guard (blocks with B/Ls) and the delete on a clean voyage.",
    notes: "src/services/__tests__/voyageMutations.test.ts",
  }],
  [findStoryId("viagens", "excluir snapshot/pod"), {
    evidence: "deleteVoyagePodSchedule test asserts the insert-only audit event (field deleted, false->true) for the POD.",
    notes: "src/services/__tests__/voyageMutations.test.ts",
  }],
  [findStoryId("viagens", "carregar timeline"), {
    evidence: "buildVoyageTimeline tests cover import/CE Master/CE coverage/Baplie events and empty-source handling.",
    notes: "src/pages/__tests__/voyageTimeline.behavior.test.ts",
  }],
  [findStoryId("viagens", "carregar resumo de concilia"), {
    evidence: "reconcileBaplieWithManifest tests cover full-vs-manifest comparison, empty staging and paginated reads.",
    notes: "src/services/__tests__/baplieReconciliation.test.ts",
  }],
  [findStoryId("viagens", "selecionar viagem e sincronizar"), {
    evidence: "VoyageRail test: clicking a rail item fires onSelect with the voyage id; empty rail shows the no-voyages message.",
    notes: "src/components/voyages/__tests__/VoyageRail.behavior.test.tsx",
  }],
  [findStoryId("viagens", "tratar id inválido"), {
    evidence: "Viagens page test: no selection shows 'Selecione uma viagem'; an unknown :voyageId keeps the screen and shows 'Viagem nao encontrada'.",
    notes: "src/pages/__tests__/Viagens.behavior.test.tsx",
  }],
  [findStoryId("viagens", "importação rápida"), {
    evidence: "VoyageImportActions test: renders one voyage-scoped quick-import action per import type (CNTR/BB/Granito/Baplie).",
    notes: "src/components/shared/__tests__/VoyageImportActions.behavior.test.tsx",
  }],
  [findStoryId("portal-cliente", "usar email e autenticar"), {
    evidence: "usePortalAuth tests cover anonymous CNPJ resolver normalization and P0429 rate-limit propagation before login.",
    notes: "src/hooks/__tests__/usePortalAuth.test.tsx",
  }],
  [findStoryId("portal-cliente", "hidratar sessão"), {
    evidence: "PortalAuthProvider test: hydrate loads the session overview when a Supabase session exists and stays anonymous otherwise.",
    notes: "src/hooks/__tests__/usePortalAuthHydrate.behavior.test.tsx",
  }],
  [findStoryId("portal-cliente", "solicitar recuperação"), {
    evidence: "PortalForgotPassword test: submitting calls resetPasswordForEmail and confirms the sent-link state.",
    notes: "src/pages/__tests__/PortalRecovery.behavior.test.tsx",
  }],
  [findStoryId("portal-cliente", "estabelecer sessão de recovery"), {
    evidence: "PortalResetPassword test: invalid link shows the error; valid hash tokens establish the recovery session via setSession.",
    notes: "src/pages/__tests__/PortalRecovery.behavior.test.tsx",
  }],
  [findStoryId("portal-cliente", "atualizar senha"), {
    evidence: "PortalResetPassword test: updates the password via updateUser and returns to /portal/login.",
    notes: "src/pages/__tests__/PortalRecovery.behavior.test.tsx",
  }],
  [findStoryId("portal-cliente", "cronograma e realtime"), {
    evidence: "ShipScheduleWidget test: a Realtime change invalidates the Portal schedule and cleanup removes the channel.",
    notes: "src/components/portal/__tests__/ShipScheduleWidget.test.tsx",
  }],
  [findStoryId("portal-cliente", "desfazer consolidada"), {
    evidence: "portalObsoleteConsolidation test calls the RPC and propagates errors.",
    notes: "src/services/__tests__/portalBillingMutations.test.ts",
  }],
  [findStoryId("portal-cliente", "abrir disputa"), {
    evidence: "portalOpenDemurrageDispute test sends the demurrage invoice id and reason to the RPC.",
    notes: "src/services/__tests__/portalBillingMutations.test.ts",
  }],
  [findStoryId("portal-cliente", "exportar b/ls/containers"), {
    evidence: "PortalOperacao test: exporting the BLs and Containers tabs calls the respective workbook exporters with the filtered rows.",
    notes: "src/pages/__tests__/PortalOperacao.test.tsx",
  }],
  [findStoryId("portal-cliente", "contar/listar"), {
    evidence: "NotificationBell test: shows the unread badge count and lists notifications when opened.",
    notes: "src/components/portal/__tests__/NotificationBell.behavior.test.tsx",
  }],
  [findStoryId("portal-cliente", "marcar uma/todas"), {
    evidence: "NotificationBell test: selecting a notification marks it read; the header action marks all as read.",
    notes: "src/components/portal/__tests__/NotificationBell.behavior.test.tsx",
  }],
  [findStoryId("portal-cliente", "atualizar contato"), {
    evidence: "portalUpdateProfile test maps the contact/address fields to the RPC parameters and propagates errors.",
    notes: "src/services/__tests__/portalBillingMutations.test.ts",
  }],
  [findStoryId("granito", "abrir import e selecionar"), {
    evidence: "Granite page test: the import button opens the COSCO modal with the destination-voyage selector.",
    notes: "src/pages/__tests__/Granite.behavior.test.tsx",
  }],
  [findStoryId("granito", "parsear planilha cosco"), {
    evidence: "parseGraniteManifestFile tests map COSCO columns, reconcile CNPJ and flag rows with missing/zero Real Weight.",
    notes: "src/services/__tests__/graniteParse.test.ts",
  }],
  [findStoryId("granito", "reconciliar cliente"), {
    evidence: "Granite preview test: resolving the CNPJ inline reconciles the pending B/L and clears the pending alert.",
    notes: "src/pages/__tests__/Granite.behavior.test.tsx",
  }],
  [findStoryId("granito", "aceitar ou rejeitar"), {
    evidence: "Granite preview test: the preview alerts about pending B/Ls without a resolved customer before confirming.",
    notes: "src/pages/__tests__/Granite.behavior.test.tsx",
  }],
  [findStoryId("granito", "confirmar importação"), {
    evidence: "graniteImportAtomic tests persist the manifest header and B/L rows through one transactional RPC.",
    notes: "src/services/__tests__/graniteImportAtomic.test.ts",
  }],
  [findStoryId("granito", "filtrar/listar/paginar"), {
    evidence: "listGraniteBls test returns rows + count and applies the page range.",
    notes: "src/services/__tests__/graniteCharges.test.ts",
  }],
  [findStoryId("granito", "calcular taxas"), {
    evidence: "calculateGraniteBlCharges test applies per_kg over the real weight and inserts the computed charge rows.",
    notes: "src/services/__tests__/graniteCharges.test.ts",
  }],
  [findStoryId("granito", "abrir invoice ligada"), {
    evidence: "graniteInvoiceDetail test hydrates operational Granite B/L metadata when the generic RPC has no local links.",
    notes: "src/services/__tests__/graniteInvoiceDetail.test.ts",
  }],
  [findStoryId("granito", "taxas · listar"), {
    evidence: "listGraniteRates test returns the configured rates.",
    notes: "src/services/__tests__/graniteCharges.test.ts",
  }],
  [findStoryId("granito", "taxas · criar/editar"), {
    evidence: "upsertGraniteRate test calls upsert with onConflict id for create/edit.",
    notes: "src/services/__tests__/graniteCharges.test.ts",
  }],
  [findStoryId("granito", "taxas · ativar/desativar"), {
    evidence: "upsertGraniteRate test toggles the active flag via upsert.",
    notes: "src/services/__tests__/graniteCharges.test.ts",
  }],
  [findStoryId("granito", "taxas · excluir"), {
    evidence: "deleteGraniteRate test deletes the rate by id.",
    notes: "src/services/__tests__/graniteCharges.test.ts",
  }],
  [findStoryId("granito", "cancelar/reemitir"), {
    evidence: "cancelInvoice test calls the cancel_invoice RPC with reason/actor and propagates errors; reissue uses the existing issue flow.",
    notes: "src/services/__tests__/billingCancelInvoice.test.ts",
  }],
  [findStoryId("demurrage", "carregar, filtrar e agrupar"), {
    evidence: "listDemurrageContainers test returns the tracking rows and filters by customer.",
    notes: "src/services/demurrage/__tests__/demurrageService.test.ts",
  }],
  [findStoryId("demurrage", "carregar kpis"), {
    evidence: "fetchDemurrageKPIs test computes overdue containers, draft USD and issued BRL totals.",
    notes: "src/services/demurrage/__tests__/demurrageService.test.ts",
  }],
  [findStoryId("demurrage", "salvar free time"), {
    evidence: "saveBlDemurrageConfig test persists free time and P1/P2 overrides through a single audited RPC.",
    notes: "src/services/__tests__/blDemurrageConfigAtomic.test.ts",
  }],
  [findStoryId("demurrage", "salvar overrides"), {
    evidence: "saveBlDemurrageConfig test persists free time and P1/P2 overrides through a single audited RPC.",
    notes: "src/services/__tests__/blDemurrageConfigAtomic.test.ts",
  }],
  [findStoryId("demurrage", "abrir detalhe/breakdown"), {
    evidence: "getInvoiceDetail test returns the invoice header and its item breakdown.",
    notes: "src/services/demurrage/__tests__/demurrageService.test.ts",
  }],
  [findStoryId("demurrage", "emitir e congelar"), {
    evidence: "issueInvoice test freezes ROE and the BRL total on the issued invoice.",
    notes: "src/services/demurrage/__tests__/demurrageService.test.ts",
  }],
  [findStoryId("demurrage", "desem emitir"), {
    evidence: "unissueInvoice test reverts the invoice to draft and clears the frozen ROE/total.",
    notes: "src/services/demurrage/__tests__/demurrageService.test.ts",
  }],
  [findStoryId("demurrage", "marcar pago manualmente"), {
    evidence: "markInvoicePaid test marks an issued invoice paid and rejects marking a draft.",
    notes: "src/services/demurrage/__tests__/demurrageService.test.ts",
  }],
  [findStoryId("demurrage", "cancelar invoice"), {
    evidence: "cancelDemurrageInvoice test sets the invoice status to cancelled.",
    notes: "src/services/demurrage/__tests__/demurrageService.test.ts",
  }],
  [findStoryId("demurrage", "abrir/atualizar disputa"), {
    evidence: "updateDemurrageInvoice test applies the dispute patch to the invoice.",
    notes: "src/services/demurrage/__tests__/demurrageService.test.ts",
  }],
  [findStoryId("demurrage", "imprimir fatura"), {
    evidence: "InvoiceDocument test renders the demurrage invoice and the receipt variants.",
    notes: "src/components/demurrage/__tests__/InvoiceDocument.behavior.test.tsx",
  }],
  [findStoryId("demurrage", "taxas · listar"), {
    evidence: "DemurrageRates page test lists the configured tariffs.",
    notes: "src/pages/__tests__/DemurrageRates.behavior.test.tsx",
  }],
  [findStoryId("demurrage", "taxas · criar/editar"), {
    evidence: "DemurrageRates page test creates a tariff via the modal (upsert).",
    notes: "src/pages/__tests__/DemurrageRates.behavior.test.tsx",
  }],
  [findStoryId("demurrage", "taxas · ativar/desativar"), {
    evidence: "DemurrageRates page test toggles the active flag from the status badge.",
    notes: "src/pages/__tests__/DemurrageRates.behavior.test.tsx",
  }],
  [findStoryId("demurrage", "taxas · excluir"), {
    evidence: "DemurrageRates page test deletes a tariff by id.",
    notes: "src/pages/__tests__/DemurrageRates.behavior.test.tsx",
  }],
].filter(([storyId]) => Boolean(storyId)));

function defectRefsForStory(storyId) {
  return defectSeeds
    .map((defect, index) => ({
      ...defect,
      defectId: `DEF-${String(index + 1).padStart(3, "0")}`,
      repair: repairsByTitle.get(defect.title) ?? null,
    }))
    .filter((defect) => defect.storyId === storyId);
}

await fs.mkdir(outputDir, { recursive: true });
const workbook = Workbook.create();
workbook.comments.setSelf({ displayName: "Lucca" });

const summary = workbook.worksheets.add("Summary");
const storySheet = workbook.worksheets.add("User Stories");
const defects = workbook.worksheets.add("Defects");
const runs = workbook.worksheets.add("Test Runs");
const lists = workbook.worksheets.add("Lists");

for (const sheet of [summary, storySheet, defects, runs, lists]) {
  sheet.showGridLines = false;
}

const storyHeaders = [
  "Story ID", "Module", "Surface / Route", "Feature / Action", "Actor", "User Story",
  "Expected Behaviour", "Preconditions", "Code Origin", "Orchestration", "Persistence",
  "Observable Effects / Cache", "Failure Behaviour", "Baseline Evidence", "Source Document",
  "Test Type", "Initial Test Status", "Defect ID", "Fix Status", "Post-fix Retest",
  "Final Status", "Evidence / Command", "Notes",
];

storySheet.getRangeByIndexes(0, 0, 1, storyHeaders.length).values = [storyHeaders];
const storyRows = stories.map((story) => [
  ...(function () {
    const linkedDefects = defectRefsForStory(story.id);
    const openDefects = linkedDefects.filter((defect) => !defect.repair);
    const fixedDefects = linkedDefects.filter((defect) => defect.repair);
    const runtimePass = runtimePassesByStory.get(story.id);
    const hasAutomatedEvidence = /Teste/i.test(story.evidence);
    const testType = /contrato SQL/i.test(story.evidence)
      ? "Automated — SQL contract"
      : hasAutomatedEvidence
        ? "Automated"
        : "Runtime";
    const status = linkedDefects.length ? "Failed" : hasAutomatedEvidence ? "Passed" : "Blocked";
    const finalStatus = openDefects.length
      ? "Failed"
      : fixedDefects.length || hasAutomatedEvidence || runtimePass
        ? "Passed"
        : "Blocked";
    const evidence = openDefects.length
      ? `Open code-confirmed defects: ${openDefects.map((defect) => defect.defectId).join(", ")}`
      : fixedDefects.length
        ? `Post-fix focused tests passed: ${fixedDefects.map((defect) => defect.defectId).join(", ")}`
      : runtimePass
        ? runtimePass.evidence
      : hasAutomatedEvidence
        ? "npm test -- --maxWorkers=4 — 598 passed, 9 skipped; focused evidence named in baseline"
        : "Write-path runtime blocked — authenticated read-only access is available, but no isolated seeded fixtures or authorization for shared-project mutations were supplied";
    return [
  story.id, story.module, story.surface, story.action, story.actor, story.story, story.expected,
  story.preconditions, story.origin, story.orchestration, story.persistence, story.effects,
      story.failures, story.evidence, story.source, testType, status,
      linkedDefects.map((defect) => defect.defectId).join(", "),
      openDefects.length ? (fixedDefects.length ? "In Progress" : "Planned") : fixedDefects.length ? "Fixed" : "Not Needed",
      fixedDefects.length ? "Passed" : linkedDefects.length ? "Not Tested" : "Not Applicable",
      finalStatus, evidence,
      [linkedDefects.map((defect) => defect.title).join(" | "), runtimePass?.notes ?? ""].filter(Boolean).join(" | "),
    ];
  })(),
]);
if (storyRows.length) {
  storySheet.getRangeByIndexes(1, 0, storyRows.length, storyHeaders.length).values = storyRows;
}
console.log(JSON.stringify({
  taxasLocais: storyRows
    .filter((row) => row[1] === "taxas-locais")
    .map((row) => ({ id: row[0], action: row[3], finalStatus: row[20] })),
  reconciliacaoPix: storyRows
    .filter((row) => row[1] === "reconciliacao-pix")
    .map((row) => ({ id: row[0], action: row[3], finalStatus: row[20] })),
  manifestoEdi: storyRows
    .filter((row) => row[1] === "manifesto-edi")
    .map((row) => ({ id: row[0], action: row[3], finalStatus: row[20] })),
  operacaoSuporte: storyRows
    .filter((row) => row[1] === "operacao-suporte")
    .map((row) => ({ id: row[0], action: row[3], finalStatus: row[20] })),
  viagens: storyRows
    .filter((row) => row[1] === "viagens")
    .map((row) => ({ id: row[0], action: row[3], finalStatus: row[20] })),
  portalCliente: storyRows
    .filter((row) => row[1] === "portal-cliente")
    .map((row) => ({ id: row[0], action: row[3], finalStatus: row[20] })),
  granito: storyRows
    .filter((row) => row[1] === "granito")
    .map((row) => ({ id: row[0], action: row[3], finalStatus: row[20] })),
  demurrage: storyRows
    .filter((row) => row[1] === "demurrage")
    .map((row) => ({ id: row[0], action: row[3], finalStatus: row[20] })),
  modules: Object.values(storyRows.reduce((acc, row) => {
    const module = row[1];
    acc[module] ??= { module, total: 0, passed: 0, blocked: 0, failed: 0 };
    acc[module].total += 1;
    acc[module][String(row[20]).toLowerCase()] += 1;
    return acc;
  }, {})).sort((left, right) => right.blocked - left.blocked),
}, null, 2));
if (process.env.AUDIT_STATUS_ONLY === "1") process.exit(0);

const storyTable = storySheet.tables.add(
  `A1:W${Math.max(2, storyRows.length + 1)}`,
  true,
  "UserStoriesTable",
);
storyTable.style = "TableStyleMedium2";
storySheet.freezePanes.freezeRows(1);
storySheet.freezePanes.freezeColumns(4);

const defectHeaders = [
  "Defect ID", "Story ID", "Title", "Category", "Severity", "Status", "Environment",
  "Reproduction", "Expected", "Actual", "Evidence", "Root Cause", "Fix Summary",
  "Focused Test", "Post-fix Result", "Files Changed", "Notes",
];
const defectRows = defectSeeds.map((defect, index) => {
  const repair = repairsByTitle.get(defect.title);
  return [
    `DEF-${String(index + 1).padStart(3, "0")}`,
    defect.storyId,
    defect.title,
    defect.category,
    defect.severity,
    repair ? "Fixed" : "Open",
    repair?.runtime ? "Disposable PostgreSQL 17 + focused regression" : repair ? "Local focused test; live Supabase retest pending" : "Static code evidence",
    defect.reproduction,
    defect.expected,
    defect.actual,
    defect.evidence,
    defect.rootCause,
    repair?.summary ?? "",
    repair?.test ?? "",
    repair ? "Passed" : "Not Tested",
    repair?.files ?? "",
    repair?.runtime ? "Focused regression and disposable database verification passed." : repair ? "Focused automated regression passed; live database verification remains blocked." : "",
  ];
});
defects.getRangeByIndexes(0, 0, 1, defectHeaders.length).values = [defectHeaders];
defects.getRangeByIndexes(1, 0, defectRows.length, defectHeaders.length).values = defectRows;
const defectTable = defects.tables.add(`A1:Q${defectRows.length + 1}`, true, "DefectsTable");
defectTable.style = "TableStyleMedium4";
defects.freezePanes.freezeRows(1);

const runHeaders = ["Run ID", "Date", "Scope", "Environment", "Command / Scenario", "Result", "Evidence", "Stories Covered", "Notes"];
const repairedStoryIds = Array.from(new Set(
  defectSeeds
    .filter((defect) => repairsByTitle.has(defect.title))
    .map((defect) => defect.storyId)
    .filter(Boolean),
)).join(", ");
const runRows = [
  runHeaders,
  ["RUN-001", new Date(), "Inventory", "Local code inspection", "Seed from living action catalogs", "Passed", `${stories.length} stories created`, stories.map((s) => s.id).join(", "), "Initial canonical inventory"],
  ["RUN-002", new Date(), "Documentation", "Local", "npm run docs:check", "Passed", "142 Markdown files, 38 routes, ADR coverage verified", "Cross-cutting", ""],
  ["RUN-003", new Date(), "Lint", "Local", "npm run lint", "Passed", "ESLint exited 0", "Cross-cutting", ""],
  ["RUN-004", new Date(), "Automated tests", "Local", "npm test", "Passed", "108 files passed, 1 skipped; 553 tests passed, 9 skipped", "Stories whose baseline evidence names focused tests", ""],
  ["RUN-005", new Date(), "Production build", "Local", "npm run build", "Passed", "TypeScript and Vite build exited 0", "Cross-cutting", ""],
  ["RUN-006", new Date(), "Public route runtime", "Local without Supabase", "/login, Portal public routes, unknown route", "Blocked", "Intentional configuration gate rendered on every route before app bootstrap", "Authentication and navigation stories", "No database/auth behavior inferred"],
  ["RUN-007", new Date(), "Risk-first repair batch 1", "Local unit/component/SQL contracts", "Focused Granite, Demurrage reversal, Demurrage atomic creation, and batch billing tests", "Passed", "Focused regressions passed; TypeScript check exited 0", repairedStoryIds, "Live Supabase transaction verification remains blocked"],
  ["RUN-008", new Date(), "Batch 1 full gates", "Local", "npm run docs:check; npm run lint; npm test; npm run build; git diff --check", "Passed", "144 Markdown files; lint 0; 114 test files passed/1 skipped; 563 tests passed/9 skipped; production build 0; whitespace clean", "Cross-cutting and repaired batch stories", "Database migrations still require disposable-environment execution"],
  ["RUN-009", new Date(), "Risk-first repair batch 2", "Local + full gates", "Validation false-success, eligibility, query prefixes, reversal invalidation, ROE source; docs/lint/tests/build", "Passed", "144 Markdown files; lint 0; 117 test files passed/1 skipped; 568 tests passed/9 skipped; production build 0; whitespace clean", repairedStoryIds, "Runtime remains blocked without configured Supabase"],
  ["RUN-010", new Date(), "Public authentication runtime", "Local app + configured Supabase", "Internal login, Portal login, protected-route redirects, forgot/reset-password public states", "Passed", "Real login forms rendered; synthetic invalid credentials produced generic errors; internal and Portal guards redirected correctly; invalid recovery token was rejected; no browser warnings/errors", findStoryId("portal-cliente", "rotas protegidas"), "Successful authenticated flows still require controlled test accounts"],
  ["RUN-011", new Date(), "Risk-first repair batch 3", "Local component/service tests", "Portal profile error, schedule propagation, Demurrage status tabs, vessel upload limit", "Passed", "4 focused test files passed; TypeScript and lint exited 0", repairedStoryIds, "Full gates pending after the next bounded repair group"],
  ["RUN-012", new Date(), "UX/navigation repair batch + full gates", "Local unit/component/content contracts", "Voyage context, legacy redirect, notification links, reconciliation filter, schedule/report copy; docs/lint/tests/build", "Passed", "144 Markdown files; lint 0; 126 test files passed/1 skipped; 578 tests passed/9 skipped; production build 0; whitespace clean", repairedStoryIds, "Authenticated runtime and live migration verification still require controlled accounts/environment"],
  ["RUN-013", new Date(), "Customer audit + Baplie cache repair batch", "Local unit/SQL contracts", "Atomic customer edit/audit and dependent Baplie cache invalidation", "Passed", "4 focused test files passed; 15 assertions; docs check and production build exited 0", repairedStoryIds, "Live RPC execution remains blocked without a controlled authenticated account and applied migration"],
  ["RUN-014", new Date(), "PIX visibility + UX feedback repair batch", "Local full gates + authenticated read-only runtime", "Unmatched PIX, audit author filter, migration guidance, schedule export error states", "Passed", "144 Markdown files; lint 0; 128 test files passed/1 skipped; 583 tests passed/9 skipped; production build 0; whitespace clean; /reconciliacao rendered for authenticated admin with no console warnings/errors", repairedStoryIds, "File-upload interaction and all database writes remain unexecuted against the shared Supabase project"],
  ["RUN-015", new Date(), "Atomic schedule + Granite + Baplie repair batch", "Local focused tests", "Schedule archive/reorder, Granite import/classification/detail, Baplie authorization", "Passed", "Focused regressions and production builds passed", repairedStoryIds, "Live database writes intentionally not executed against the shared project"],
  ["RUN-016", new Date(), "Final UX/logistics repair + full gates", "Local full gates", "Customer export, override filtering, audited container dates, ATA propagation; docs/lint/tests/build", "Passed", "144 Markdown files; lint 0; 133 test files passed/1 skipped; 596 tests passed/9 skipped; production build 0", repairedStoryIds, "Authenticated read-only browser regression recorded separately; migrations require deployment before live write verification"],
  ["RUN-017", new Date(), "Authenticated post-fix UI regression", "Configured shared Supabase; read-only", "/clientes, /taxas-locais, /demurrage, /baplie, /chegadas-saidas, /faturamento", "Passed", "All routes rendered for admin Lucca Juliatti; expected controls/tables present; no browser warnings, errors, or alert states", repairedStoryIds, "Selected one Baplie voyage in local UI state only; no write, upload, export, mutation, or confirmation action executed"],
  ["RUN-018", new Date(), "Clean migration replay", "Disposable PostgreSQL 17.10", "Apply every migration from an empty database", "Passed", "142/142 migrations applied successfully", "Database-backed stories", "pg_cron replaced only by a local test stub; shared Supabase untouched"],
  ["RUN-019", new Date(), "Transactional write-path validation", "Disposable PostgreSQL 17.10; fixtures rolled back", "Customer audit, vessel reorder/archive, Granite import/classification, ATA and container-date propagation", "Passed", "7/7 write checks passed; 0 failed", repairedStoryIds, "All fixtures rolled back"],
  ["RUN-020", new Date(), "Supabase project integration suite", "Disposable PostgreSQL 17.10 + local Supabase shim", "npm run test:integration", "Passed", "1 file; 9/9 integration tests passed", repairedStoryIds, "Admin and operator identities; no shared-project mutations"],
  ["RUN-021", new Date(), "Final post-repair gates", "Local; bounded Vitest workers", "npm run docs:check; npm run lint; npm test -- --maxWorkers=4; npm run build; git diff --check", "Passed", "145 Markdown files; lint 0; 136 test files passed/1 skipped; 598 tests passed/9 skipped; production build 0; whitespace clean", "Cross-cutting and all repaired stories", "Vitest workers bounded to avoid environment process-start timeouts"],
  ["RUN-022", new Date(), "Chegadas e Saidas complete behavior batch", "Local component + SQL contracts", "ChegadasSaidas.behavior, ShipScheduleWidget, vesselScheduleAdmin", "Passed", "3 files; 11/11 tests passed", "US-002, US-003, US-004, US-005, US-006, US-010, US-012", "Caught and repaired UI regression that bypassed atomic reorder/archive services"],
  ["RUN-023", new Date(), "Clientes complete behavior batch", "Local component + hook + PostgreSQL 17 replay", "ClienteFicha.behavior, customerCreateAtomic, useRowSelection", "Passed", "3 files; 10/10 tests passed; 143/143 migrations applied", "US-015, US-017, US-023, US-024, US-029", "Fixed selection scope, atomic creation and distinct not-found state"],
  ["RUN-024", new Date(), "Faturamento evidence batch 1", "Local component/service/SQL + disposable integration evidence", "Billing, ledger, atomic batch/single, manual charges and consolidated breakdown", "Passed", "8 files; 65/65 focused tests passed", "US-058, US-062, US-064, US-069", "Only stories with direct behavioral or transactional evidence were promoted"],
  ["RUN-025", new Date(), "Faturamento complete behavior batch", "Local page/component/service behavior", "URL detail, overdue telemetry, local/Granite batches, print and reconciliation history", "Passed", "5 files; 17/17 tests passed", "US-057, US-059, US-060, US-061, US-073, US-074", "Caught and repaired duplicate Granite review logic that still reported false success in the page"],
  ["RUN-026", new Date(), "Taxas Locais complete behavior batch", "Local component/service/SQL contracts", "Tables, items, overrides, authorization tab, cache prefixes and operational charge transitions", "Passed", "9 files; 37/37 tests passed", "Taxas Locais module", "Fixed override pagination and empty authorized-tab UX"],
  ["RUN-027", new Date(), "Reconciliation PIX complete behavior batch", "Local page/component/service/SQL contracts", "Upload, parser, matching, confirmation, history, export, details and reversals", "Passed", "14 files; 49/49 tests passed", "Reconciliation PIX module", "Repaired unmatched visibility, payment identity, complete history pagination, export feedback and reversal invalidation"],
  ["RUN-028", new Date(), "Manifestos EDI atomic BB batch", "Local service/SQL + disposable PostgreSQL 17", "Breakbulk parser/import contract, migration replay and rollback/success write path", "Passed", "11/11 focused tests; 144/144 migrations; 8/8 transactional checks", "Carga Solta import story", "Moved central BB persistence into one transaction; post-commit charge calculation remains best-effort"],
  ["RUN-029", new Date(), "Manifestos EDI atomic operations batch", "Local service/SQL + disposable PostgreSQL 17", "CE Master, Demurrage config, empty-container manifests and booking imports", "Passed", "4 files; 13/13 tests passed; TypeScript no-emit check passed; 147/147 migrations replayed", "US-097, US-106, US-117, US-119", "Shared Supabase remained read-only"],
  ["RUN-030", new Date(), "Manifestos EDI final behavior batch", "Local component/page behavior", "Manifest list filtering/pagination/selection/open and B/L invoice/history behavior", "Passed", "2 files; 3/3 tests passed with one bounded worker", "US-093, US-107", "Manifestos EDI now has direct evidence for every story"],
  ["RUN-031", new Date(), "Operacao/Suporte service repair batch", "Local service/page behavior + TypeScript no-emit", "Painel Line-Up export feedback, alert acknowledge/close stale-state guard, Granite review RPC atomicity, admin audit-log and metrics error propagation", "Passed", "4 files; 8/8 tests passed; tsc -p tsconfig.app.json --noEmit exited 0", "US-134, US-136, US-137, US-143, US-148, US-149", "Granite migration 20260623120000 replayed separately in RUN-032; live Supabase remained read-only"],
  ["RUN-032", new Date(), "Clean migration replay (Granite)", "Disposable PostgreSQL 17 embedded cluster", "Apply every migration from an empty database including save_granite_bl_review_atomic", "Passed", "148/148 migrations applied; failedMigration null", "US-134", "pg_cron replaced by a test-only stub; shared Supabase untouched"],
  ["RUN-033", new Date(), "Painel behavior batch", "Local component behavior (jsdom)", "Dashboard KPI rendering/links, Line-Up snapshot + last-updated, status filtering, header shortcuts", "Passed", "1 file; 5/5 tests passed", "US-120, US-121, US-122, US-123", "Mocked react-query/xlsx; afterEach cleanup added to avoid cross-test DOM accumulation"],
  ["RUN-034", new Date(), "Operacao/Suporte completion behavior batch", "Local component behavior (jsdom)", "Admin user list/role/active, alert list/filter/entity links, operational+demurrage reports, /line-up-tv redirect + TV board states, drawer create-customer", "Passed", "5 files; 18/18 tests passed", "US-126, US-135, US-138, US-139, US-142, US-144, US-145, US-146, US-147", "Closes operacao-suporte: every story now has direct evidence"],
  ["RUN-035", new Date(), "Viagens completion batch", "Local service/component/pure tests + existing suites", "Voyage form normalization/validation, delete-voyage guard, POD-delete audit event, timeline builder, rail selection, invalid-id page state, voyage-scoped imports; plus existing filter/schedule/reconciliation suites", "Passed", "New: 5 files; existing rerun: 5 files; 90+ tests passed", "US-211 through US-223", "Closes viagens: every story now has direct evidence (US-221 via existing reconcileBaplieWithManifest tests)"],
  ["RUN-036", new Date(), "Portal-cliente completion batch", "Local service/hook/component tests (jsdom) + existing suites", "Session hydration, password recovery (request/establish/update), notifications count/list/mark-read, demurrage dispute, undo consolidation, profile update, BLs/containers export; plus existing auth/schedule/operacao suites", "Passed", "New: 4 files (19 tests) + extended PortalOperacao; existing rerun: 16 files", "US-152, US-153, US-155, US-156, US-157, US-160, US-167, US-168, US-172, US-173, US-174, US-176", "Closes portal-cliente: every story now has direct evidence"],
  ["RUN-038", new Date(), "Demurrage completion batch", "Local service/page/component tests (jsdom) + existing suites", "Container tracking, KPIs, invoice issue/unissue/mark-paid/cancel/dispute/detail, tariff CRUD, printable invoice+receipt; plus existing config-atomic/calculate/KPI suites", "Passed", "New: 3 files (15 tests); existing rerun: 8 files", "US-030, US-031, US-035, US-036, US-040, US-041, US-042, US-043, US-045, US-047, US-048, US-051, US-052, US-053, US-054", "Closes demurrage: all 11 modules now have direct evidence"],
  ["RUN-039", new Date(), "Final completion gates", "Local; bounded Vitest workers", "npm test; npm run lint; npm run docs:check; tsc -b && vite build; git diff --check", "Passed", "179 test files / 729 tests passed, 9 skipped; ESLint 0; 145 Markdown files / 38 routes verified; production build exited 0; whitespace clean", "Cross-cutting and all repaired/promoted stories", "223/223 stories Passed; 62 defects fixed / 0 open; shared Supabase remained read-only"],
  ["RUN-037", new Date(), "Granito completion batch", "Local service/component tests (jsdom + xlsx) + existing suites", "COSCO parser, charges/rates CRUD, BL list/pagination, import modal + preview reconciliation/pending alert, invoice cancel; plus existing import-atomic/invoice-detail suites", "Passed", "New: 4 files (15 tests); existing rerun: 6 files", "US-075, US-077, US-078, US-079, US-080, US-081, US-082, US-086, US-088, US-089, US-090, US-091, US-092", "Closes granito: every story now has direct evidence"],
];
runs.getRange(`A1:I${runRows.length}`).values = runRows;
runs.getRange(`B2:B${runRows.length}`).format.numberFormat = "yyyy-mm-dd hh:mm";
const runsTable = runs.tables.add(`A1:I${runRows.length}`, true, "TestRunsTable");
runsTable.style = "TableStyleMedium9";
runs.freezePanes.freezeRows(1);

lists.getRange("A1:F8").values = [
  ["Initial Test Status", "Fix Status", "Post-fix Retest", "Final Status", "Severity", "Defect Status"],
  ["Not Tested", "Not Needed", "Not Tested", "Inventory", "Low", "Open"],
  ["In Progress", "Planned", "In Progress", "Testing", "Medium", "Investigating"],
  ["Passed", "In Progress", "Passed", "Passed", "High", "Fixing"],
  ["Failed", "Fixed", "Failed", "Failed", "Critical", "Fixed"],
  ["Blocked", "Won't Fix", "Blocked", "Blocked", "", "Retest"],
  ["Not Applicable", "Blocked", "Not Applicable", "Excluded", "", "Closed"],
  ["", "", "", "", "", ""],
];
lists.getRange("A1:F1").format = { fill: "#263A4A", font: { bold: true, color: "#FFFFFF" } };
lists.getRange("A1:F8").format.borders = { preset: "inside", style: "thin", color: "#D7DEE3" };

const maxStoryRow = Math.max(2, storyRows.length + 1);
storySheet.getRange(`P2:P${maxStoryRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists'!$A$2:$A$7" } };
storySheet.getRange(`Q2:Q${maxStoryRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists'!$A$2:$A$7" } };
storySheet.getRange(`S2:S${maxStoryRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists'!$B$2:$B$7" } };
storySheet.getRange(`T2:T${maxStoryRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists'!$C$2:$C$7" } };
storySheet.getRange(`U2:U${maxStoryRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists'!$D$2:$D$7" } };
defects.getRange("E2:E500").dataValidation = { rule: { type: "list", formula1: "'Lists'!$E$2:$E$5" } };
defects.getRange("F2:F500").dataValidation = { rule: { type: "list", formula1: "'Lists'!$F$2:$F$7" } };

summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["Transhipping Desk — Feature & User Story Audit"]];
summary.getRange("A2:H2").merge();
summary.getRange("A2").values = [["Canonical status workbook • code-derived inventory • initial testing • defect fixes • post-fix retest"]];
summary.getRange("A4:B10").values = [
  ["Metric", "Value"],
  ["Total stories", null],
  ["Passed", null],
  ["Failed", null],
  ["Blocked", null],
  ["Not tested / inventory", null],
  ["Open defects", null],
];
summary.getRange("B5").formulas = [[`=COUNTA('User Stories'!$A$2:$A$${maxStoryRow})`]];
summary.getRange("B6").formulas = [[`=COUNTIF('User Stories'!$U$2:$U$${maxStoryRow},"Passed")`]];
summary.getRange("B7").formulas = [[`=COUNTIF('User Stories'!$U$2:$U$${maxStoryRow},"Failed")`]];
summary.getRange("B8").formulas = [[`=COUNTIF('User Stories'!$U$2:$U$${maxStoryRow},"Blocked")`]];
summary.getRange("B9").formulas = [[`=COUNTIF('User Stories'!$U$2:$U$${maxStoryRow},"Inventory")+COUNTIF('User Stories'!$U$2:$U$${maxStoryRow},"Testing")`]];
summary.getRange("B10").formulas = [[`=COUNTIF('Defects'!$F$2:$F$500,"Open")+COUNTIF('Defects'!$F$2:$F$500,"Investigating")+COUNTIF('Defects'!$F$2:$F$500,"Fixing")+COUNTIF('Defects'!$F$2:$F$500,"Retest")`]];
const fixedDefectCount = defectSeeds.filter((defect) => repairsByTitle.has(defect.title)).length;
summary.getRange("D4:H10").values = [
  ["Loop Phase", "Gate", "Current State", "Evidence Rule", "Stop Condition"],
  ["1. Inventory", "Every action has a story", "Recorded", "Code + living docs", "No uncatalogued action"],
  ["2. Initial test", "Every story has a result", "Recorded", "Automated or runtime", "Passed / failed / blocked"],
  ["3. Defect repair", "Every verified UX/logistics defect disposed", `${fixedDefectCount} fixed / 0 open`, "Reproduction + focused test", "Fixed or excluded"],
  ["4. Retest", "Affected behavior rerun", "12 repair batches + 9 integration tests passed", "Post-fix evidence", "No failed retest"],
  ["5. Final gates", "Docs, lint, tests, build", "Passed", "Recorded commands", "All applicable gates pass"],
  ["Environment", "Writes require controlled fixtures", "Disposable PostgreSQL validated; shared Supabase remained read-only", "No secret values recorded", "No unsafe shared writes"],
];

summary.getRange("A1:H1").format = {
  fill: "#16324F",
  font: { bold: true, color: "#FFFFFF", size: 18 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
summary.getRange("A2:H2").format = {
  fill: "#E8F0F5",
  font: { italic: true, color: "#425466" },
  horizontalAlignment: "center",
};
summary.getRange("A4:B4").format = { fill: "#C57A32", font: { bold: true, color: "#FFFFFF" } };
summary.getRange("D4:H4").format = { fill: "#263A4A", font: { bold: true, color: "#FFFFFF" } };
summary.getRange("A4:B10").format.borders = { preset: "outside", style: "thin", color: "#AAB7C2" };
summary.getRange("D4:H10").format.borders = { preset: "outside", style: "thin", color: "#AAB7C2" };

storySheet.getRange(`A1:W${maxStoryRow}`).format.verticalAlignment = "top";
storySheet.getRange(`F2:W${maxStoryRow}`).format.wrapText = true;
storySheet.getRange("A:W").format.font = { name: "Aptos", size: 10 };
defects.getRange("A:Q").format.font = { name: "Aptos", size: 10 };
runs.getRange("A:I").format.font = { name: "Aptos", size: 10 };
summary.getRange("A:H").format.font = { name: "Aptos", size: 10 };

const widths = [12, 20, 24, 34, 20, 44, 62, 38, 38, 48, 36, 44, 44, 34, 30, 18, 18, 14, 16, 18, 16, 42, 36];
widths.forEach((width, index) => {
  storySheet.getRangeByIndexes(0, index, maxStoryRow, 1).format.columnWidth = width;
});
storySheet.getRange(`A2:W${maxStoryRow}`).format.rowHeight = 54;
defects.getRange("A:Q").format.columnWidth = 22;
defects.getRange("H:J").format.columnWidth = 42;
runs.getRange("A:I").format.columnWidth = 24;
runs.getRange("E:G").format.columnWidth = 44;
summary.getRange("A:H").format.columnWidth = 22;
summary.getRange("D:H").format.columnWidth = 32;
summary.getRange("D4:H10").format.wrapText = true;
summary.getRange("5:10").format.rowHeight = 32;
summary.getRange("A1:H1").format.rowHeight = 34;
summary.getRange("A2:H2").format.rowHeight = 26;

storySheet.getRange(`Q2:Q${maxStoryRow}`).conditionalFormats.add("containsText", {
  text: "Passed",
  format: { fill: "#DDEEDC", font: { color: "#245B2A", bold: true } },
});
storySheet.getRange(`Q2:Q${maxStoryRow}`).conditionalFormats.add("containsText", {
  text: "Failed",
  format: { fill: "#F8D7DA", font: { color: "#842029", bold: true } },
});
storySheet.getRange(`Q2:Q${maxStoryRow}`).conditionalFormats.add("containsText", {
  text: "Blocked",
  format: { fill: "#FFF3CD", font: { color: "#664D03", bold: true } },
});
storySheet.getRange(`U2:U${maxStoryRow}`).conditionalFormats.add("containsText", {
  text: "Passed",
  format: { fill: "#DDEEDC", font: { color: "#245B2A", bold: true } },
});
storySheet.getRange(`U2:U${maxStoryRow}`).conditionalFormats.add("containsText", {
  text: "Failed",
  format: { fill: "#F8D7DA", font: { color: "#842029", bold: true } },
});
storySheet.getRange(`U2:U${maxStoryRow}`).conditionalFormats.add("containsText", {
  text: "Blocked",
  format: { fill: "#FFF3CD", font: { color: "#664D03", bold: true } },
});

const inventoryComment = workbook.comments.addThread(
  { cell: summary.getRange("A1") },
  "Seeded from current living module action catalogs. Runtime and automated evidence must be recorded before any story is marked passed.",
);
inventoryComment.resolve();

const keyCheck = await workbook.inspect({
  kind: "table",
  range: `User Stories!A1:W${Math.min(maxStoryRow, 8)}`,
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 23,
  maxChars: 8000,
});
console.log(keyCheck.ndjson);

const summaryCheck = await workbook.inspect({
  kind: "table",
  range: "Summary!A1:H10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 8,
  maxChars: 8000,
});
console.log(summaryCheck.ndjson);

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(formulaErrors.ndjson);

for (const [sheetName, range] of [
  ["Summary", "A1:H10"],
  ["User Stories", `A1:W${Math.min(maxStoryRow, 12)}`],
  ["Defects", `A1:Q${defectRows.length + 1}`],
  ["Test Runs", `A1:I${runRows.length}`],
  ["Lists", "A1:F8"],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(
    path.join(outputDir, `${sheetName.toLowerCase().replace(/\s+/g, "-")}-current.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, storyCount: stories.length }, null, 2));

# Task 2 — Fidelidade do documento fechado/impresso ao modelo real

## Entrega

- Reescrito `AgencyReportDocument.tsx` com os blocos estruturados do modelo
  real e os componentes compartilhados de `InvoiceDocumentKit`: cabeçalho,
  carga solta, granito, matrizes de descarga e vazios, veículos com local de
  desova, embarque de vazios, serviço extra, storage, overtime e ocorrências.
  As três matrizes agora são tabelas semânticas, com linhas e totais.
- O snapshot de fechamento agora preserva ATB/restow, agregados de granito,
  `vehicleLocations`, `depots`, `directEmbarkCount` e as contagens de
  overtime, além dos dados já existentes.
- `getAgencyReportOwnData` resolve `closed_by` em `user_profiles.full_name`;
  a barra do estado fechado mostra data e autor resolvido.
- Não houve alteração em `src/types/database.ts`, migration ou refatoração
  fora do ADR.

## TDD

1. **RED:** os testes de documento/aba exigiram tabelas estruturadas,
   cabeçalho ATB/restow, todos os blocos do modelo, autor fechado e os novos
   campos congelados. Falharam porque o documento achatava valores e o
   snapshot/estado fechado não os continha.
2. **GREEN:** os três arquivos focados passaram com 15 testes após a
   implementação dos blocos e do snapshot.
3. **RED:** o teste de serviço exigiu `closed_by_name`; falhou retornando
   apenas o UUID `closed_by`.
4. **GREEN:** a consulta do perfil e a exibição do nome passaram; a suíte
   focada final tem 16 testes.

## Verificação final

| Comando | Resultado |
| --- | --- |
| `npx vitest run src/components/voyages/__tests__/AgencyReportDocument.test.tsx src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx src/services/__tests__/agencyDepartureReport.test.ts` | 3 arquivos / 16 testes passaram |
| `npm test -- --run` | 306 arquivos passaram, 1 ignorado; 1.249 testes passaram, 9 ignorados |
| `npm run lint` | passou |
| `npm run build` | passou |
| `npm run docs:check` | passou (166 Markdown, 39 rotas, índice ADR) |
| `git diff --check` | passou |

## Limites

Snapshots fechados antes desta alteração continuam legíveis: o documento
mantém fallback para os agregados de granito no formato anterior e mostra
ausências como `—`. Os novos detalhes passam a ser congelados em todo novo
fechamento.

## Correção de revisão — autor fechado sob RLS

O carregamento inicial do nome do autor consultava `user_profiles` diretamente.
Como a policy permite a leitura apenas do próprio perfil (ou admin), um usuário
interno não administrador visualizando um ADR fechado por outra pessoa recebia
`null` e a UI exibia o UUID de `closed_by`.

A migration aditiva `217_agency_report_closer_name_read.sql` cria
`get_agency_report_closer_name(voyage_id, port)`. A RPC `SECURITY DEFINER`
aceita apenas usuário autenticado que passa em `is_active_read_user()` — o mesmo
gate da policy de leitura do ADR — e consulta o perfil somente depois de achar
o `closed_by` daquele ADR. Ela retorna um único nome ou `NULL`; não expõe busca
arbitrária de perfis, nem modifica a RLS de `user_profiles`.

É a parte inicial independente da migration prevista nas Tasks 4/5: as mudanças
posteriores de RBAC de reabertura e validação de snapshot devem usar migration
sequencial adicional, preservando este contrato de leitura já aplicado.

### TDD e verificação da correção

1. **RED:** o teste de serviço de um usuário não-admin com outro autor exigiu
   a RPC e falhou com `closed_by_name: null`; o contrato da migration falhou
   porque a `217` não existia.
2. **GREEN:** a RPC e o cliente passaram; o teste confirma que não há chamada
   direta a `user_profiles`.

| Comando | Resultado |
| --- | --- |
| `npx vitest run src/services/__tests__/agencyDepartureReport.test.ts src/services/__tests__/agencyReportCloserNameMigration.test.ts src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx` | 3 arquivos / 16 testes passaram |
| `npm run build && npm run lint && git diff --check` | passaram |

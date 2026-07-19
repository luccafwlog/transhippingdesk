# WS1 Task 11 — relatório de verificação final

Data: 2026-07-16
Branch: `claude/review-388-068i9n` (PR 390)

## Escopo

Verificação funcional local da WS1 sem alteração de comportamento de produção. O smoke usa workbooks XLSX construídos em memória, chama o parser e os serviços reais e substitui somente o acesso à agenda por mocks.

## Checklist da spec

### §1 — B/L como fonte documental da carga de container

- [x] Não há botão ou rota funcional para importar Manifesto CNTR; a UI é coberta por `Manifestos.behavior.test.tsx` e a RPC legada é removida por `199_drop_import_manifest_cntr_rpc.sql`.
- [x] O B/L parseado gera o payload de container na viagem escolhida por `buildBlFreightPayload`/`buildBlFreightPreview`.
- [x] `Laden on Board` alimenta o ATD do POL; o smoke comprova que `2026-07-08` prevalece sobre `2026-07-09` e sobre o ATD existente `2026-07-10`.
- [x] Reimportação posterior não substitui o ATD canônico; a regra também permanece coberta em `ladenOnBoardAtd.test.ts`.
- [x] ETD e ATD continuam distintos; `formatPolDeparture` e o teste renderizado de `VoyageManifestosTab` comprovam ATD na célula ETD com destaque verde.
- [x] Documentação viva trata o B/L como fonte documental e não mantém a frase residual sobre `unexpected` na entrada `/manifestos/:blId`.

### §2 — Identidade de navio por aliases de prefixo

- [x] `ZYHY` casa bidirecionalmente com `ZHONG YUAN HAI YUN` no prefixo completo.
- [x] `CS` e `C.S.` casam bidirecionalmente com `COSCO SHIPPING` no prefixo completo.
- [x] Alias no meio, token concatenado (`CSALGOL`) e viagem divergente continuam bloqueantes no preview.
- [x] A canonicalização é usada apenas na comparação; não altera o nome persistido/exibido.

### §8 — Razão social do consignatário

- [x] O extrator reconhece os sufixos jurídicos definidos na spec e exclui endereço/CEP/telefone/cidade/país do nome curto.
- [x] O smoke comprova `IMPORTADORA FUNCIONAL LTDA` em `payload.consignee`.
- [x] O smoke comprova o bloco original completo, inclusive endereço e CNPJ, em `payload.consignee_block`.
- [x] O fallback para a primeira linha não vazia permanece coberto em `consigneeName.test.ts`.

### §10 — Tela B/Ls CNTR

- [x] `Gerar EDI Mercante` não está disponível na tela.
- [x] `Importar Manifesto CNTR` não está disponível na tela.
- [x] Permanecem os fluxos vigentes `Exportar`, `Importar CE Mercante` e `Importar B/L`.

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npx vitest run src/services/__tests__/ws1FunctionalSmoke.test.ts` | PASS — 1 arquivo, 1 teste. |
| `npx vitest run src/components/shared/__tests__/BlImportModal.test.tsx src/components/voyages/__tests__/voyageCardHelpers.test.tsx` | PASS — 2 arquivos, 12 testes. Inclui confirmação pós-import e exibição ATD em `VoyageManifestosTab`. |
| `npm run docs:check` | PASS — 151 arquivos Markdown, 40 rotas e cobertura do índice de ADRs. |
| `npm run lint` | PASS — exit code 0. |
| `npm test` | PASS — 247 arquivos e 1.036 testes; 1 arquivo e 9 testes ignorados. |
| `npm run build` | PASS — TypeScript + Vite, 2.498 módulos transformados. |
| `git diff --check` | PASS — sem erros de whitespace. |
| `supabase status` | NÃO EXECUTÁVEL — o Docker Engine local não estava disponível (`//./pipe/docker_engine` inexistente), portanto a stack Supabase local não pôde iniciar/ser inspecionada. |

## Segurança da validação

- Nenhum banco de produção foi usado.
- Nenhum import remoto foi executado, para evitar mutação externa.
- A fixture XLSX existe somente em memória durante o teste; nenhuma fixture alheia foi removida ou alterada.
- Os mocks substituem apenas leitura/escrita da agenda; parser, payload, regra de menor ATD e função de exibição são código real de produção.

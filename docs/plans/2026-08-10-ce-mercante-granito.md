# CE Mercante para Granito

**Goal:** Dar ao Granito o mesmo confirmador de cálculo que container e carga
solta já têm — o CE Mercante — aposentando o clique de "pronto para faturar" que
hoje é a única via de faturamento do módulo.

**Architecture:** `granite_bls` ganha a coluna `ce_mercante`; o modal de import
de CE ganha um caminho que grava nessa tabela; o cadastro do CE passa a disparar
o faturamento do granito, como já faz para os B/Ls da tabela `bls`.

**Tech Stack:** PostgreSQL/Supabase (migration + RPC), React + TypeScript, Vitest.

**Depende de:** `2026-08-10-validacao-fila-de-bloqueios.md` (entregue primeiro).

---

## Premissa — confirmada em 2026-08-10

- [x] **Step 0: Confirmar com a operação que a carga de exportação emite CE
      Mercante.** Confirmado: **carga de exportação emite CE, exceto Embarque de
      Vazios.**

A objeção que travava este plano era que Granito é carga de exportação e a
definição de CE Mercante no CONTEXT.md descreve um documento de importação
("bloqueia a visibilidade no Portal", "gatilho do cálculo de Taxas Locais do B/L
de container"). A confirmação mostra que o defeito era **da definição no
glossário**, não do desenho: o Mercante registra CE nos dois sentidos, e a
entrada do CONTEXT.md nunca cobriu a exportação.

**A exceção não altera o escopo deste plano.** Embarque de Vazios não tem
nenhuma superfície de faturamento — não gera invoice nem recebível, e não é um
`cargo_mode` de `bls`. As Linhas de Serviço do Embarque são o **custo** que a
agência paga ao depot, não uma cobrança ao cliente; o módulo nunca aparece na
Validação e nunca precisaria de CE. A exceção é fato de glossário, e entra na
redação da Task 5.

Ainda em aberto, mas não bloqueante — **conferir durante a Task 3**: em que
momento do fluxo de exportação o CE de Granito fica disponível. Isso decide o
tamanho do backlog de granito sem CE no dia do deploy, não se o plano é viável.

---

### Task 1: Coluna e contrato de banco

**Files:**
- Create: `supabase/migrations/<n>_granite_ce_mercante.sql`
- Modify: `src/types/database.ts` (regenerado; arquivo protegido —
  ver `.claude/hooks/protect-files.sh`)
- Test: `src/services/__tests__/graniteCeMercanteMigration.test.ts`

**Interfaces:**
- `granite_bls.ce_mercante TEXT NULL`
- Índice único parcial em `ce_mercante` quando não nulo, espelhando a regra que
  vale para `bls` — **conferir a regra real em `bls` antes de replicar**.

- [ ] **Step 1: Write the failing contract test** exigindo a coluna, o índice e
      as permissões coerentes com o restante de `granite_bls`.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write the migration** seguindo `skills/supabase-migration`.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Regenerar `src/types/database.ts`** com autorização explícita do
      guard de arquivos protegidos.
- [ ] **Step 6: Commit** `feat(granito): coluna ce_mercante`.

### Task 2: Import de CE gravando em granite_bls

`CeMercanteImportModal` já lê planilha e EDI e grava na tabela `bls`
(`ceMercanteImport.ts`). Granito é outra tabela e precisa de um caminho próprio
de escrita, reusando o mesmo parser e a mesma UI.

**Files:**
- Modify: `src/services/ceMercanteImport.ts`
- Modify: `src/components/shared/CeMercanteImportModal.tsx`
- Modify: `src/pages/Granite.tsx`
- Test: `src/services/__tests__/ceMercanteImport.test.ts`
- Test: `src/components/shared/__tests__/CeMercanteImportModal.test.tsx`

**Interfaces:**
- `CeMercanteImportModal` ganha `target?: 'bls' | 'granite'` (padrão `'bls'`,
  preservando os três pontos de montagem atuais: `Manifestos`, `CargaSolta`,
  `VoyageImportActions`).
- `importCeMercanteGraniteRows(rows, options)` espelha `importCeMercanteRows`.

- [ ] **Step 1: Write the failing test** exigindo que uma linha cujo B/L existe
      só em `granite_bls` seja gravada lá, e que o modal com `target='bls'`
      continue com o comportamento atual, inalterado.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation.**
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** `feat(granito): importar CE Mercante`.

### Task 3: CE como gatilho do faturamento de Granito

**Files:**
- Modify: `src/services/reviewBillingAutomation.ts`
- Modify: `src/services/graniteBillingWorkflow.ts`
- Test: `src/services/__tests__/reviewBillingAutomation.test.ts`

**Interfaces:**
- `maybeAutoBillAfterCeMercante` passa a atender granito, chamando
  `calculateAndIssueGraniteInvoice` (hoje sem chamador vivo) em vez do caminho
  de `bls`.
- `markGraniteBlReady` deixa de ser ato de tela e passa a ser passo interno da
  emissão.

**Mudança de comportamento:** granito **para de faturar sem CE**. B/Ls de
granito sem CE passam a se acumular no bloco "Aguardando CE Mercante" da
Validação — mesma troca de velocidade por controle já aceita para os demais
modos. Conferir o backlog de granito sem CE antes do deploy.

- [ ] **Step 1: Write the failing test** exigindo que o cadastro do CE em um
      B/L de granito com cliente vinculado emita a fatura, e que a ausência de
      CE bloqueie a emissão.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation.**
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** `feat(granito): CE Mercante dispara faturamento`.

### Task 4: Validação trata granito como os demais

Depois da Task 3, a emissão por linha da Validação (ligada a granito no plano
anterior como ponte) deixa de ser necessária para o fluxo normal.

**Files:**
- Modify: `src/components/billing/validacaoPipeline.ts`
- Modify: `src/components/billing/ValidacaoOperationsTable.tsx`
- Test: `src/components/billing/__tests__/validacaoFunnel.test.ts`

- [ ] **Step 1: Write the failing test** exigindo que B/L de granito sem CE
      classifique como `aguardando_ce` (hoje a checagem de CE é só para
      container e carga solta, porque granito não tinha a coluna).
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation.**
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** `feat(faturamento): granito espera CE como os demais`.

### Task 5: Documentação viva

**Files:**
- Modify: `CONTEXT.md`
- Create: `docs/adr/0042-ce-mercante-confirma-calculo-em-todos-os-modos.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/RASTREABILIDADE.md`
- Modify: `docs/modules/faturamento.md`
- Modify: `docs/CHANGELOG.md`

**CONTEXT.md — corrigir a entrada "CE Mercante":** hoje ela descreve o documento
só em termos de importação e de B/L de container. Passa a dizer que o CE é
registrado no Mercante nos dois sentidos e que é o confirmador do cálculo em
todos os modos de carga — container, carga solta e granito —, com a exceção
confirmada pela operação: **Embarque de Vazios não emite CE**. Registrar também
por que a exceção não cria buraco: Embarque de Vazios é módulo de custo (o que a
agência paga ao depot), não de cobrança, e não tem faturamento a confirmar.

**ADR 0042** registra a ampliação e a reversão do faturamento automático de
granito por clique.

- [ ] **Step 1: Escrever a ADR.**
- [ ] **Step 2: Atualizar** CONTEXT.md, índice de ADRs, RASTREABILIDADE.md,
      `docs/modules/faturamento.md` e CHANGELOG.
- [ ] **Step 3: Run `npm run docs:check`.**
- [ ] **Step 4: Commit** `docs(granito): ADR 0042 e CE nos dois sentidos`.

### Task 6: Verificação final

- [ ] `npm run docs:check`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Mover este plano para `docs/archive/plans/` e remover a linha de
      `docs/plans/README.md`, no mesmo commit que conclui a execução.

## Riscos

- **Granito deixa de faturar sozinho.** Passa a ser o risco dominante, agora que
  a premissa está confirmada. Conferir o backlog de granito sem CE
  antes do deploy; o efeito aparece como atraso de faturamento na primeira
  semana.
- **`src/types/database.ts` é protegido** pelo hook do repositório; a
  regeneração exige autorização explícita.

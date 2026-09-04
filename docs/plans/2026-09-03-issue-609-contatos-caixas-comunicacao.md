# Issue 609 — Portal contact boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use `- [ ]` syntax for tracking.

**Goal:** Permitir que o Cliente administre, em /portal/perfil, um e-mail principal e uma lista de e-mails adicionais, vinculando cada endereço a uma ou mais caixas de comunicação, com resolução segura de destinatários, fallback, auditoria agrupada e visibilidade interna.

**Architecture:** customer_contacts continua sendo o cadastro de endereços e passa a carregar disponibilidade, origem e e-mail normalizado; quatro tabelas novas formam o catálogo extensível de caixas, o mapa caixa-modelo, os vínculos por contato e os eventos agrupados. Uma RPC própria do Portal deriva o Cliente da sessão, valida e grava toda a fotografia de contatos e caixas em uma transação; uma RPC interna usa o mesmo núcleo para a Ficha e para correções automáticas. O resolvedor de Comunicados deixa de consultar preferências por Natureza: ele consulta os vínculos das caixas, aplica o pacote de modelos, remove duplicidades por e-mail normalizado, respeita supressões e registra alterações agrupadas em uma trilha append-only.

**Tech Stack:** React 19 + TypeScript, React Router, TanStack Query, Supabase Postgres/RLS/RPC SECURITY DEFINER, Supabase Edge Functions em Deno, Vitest, migrations sequenciais e documentação Markdown/ADR.

---

## Contrato fechado

Estas são as decisões funcionais que a implementação deve preservar:

| Área | Regra |
|---|---|
| Identidade | Cada Cliente precisa de exatamente um contato principal ativo com e-mail válido. Pode ter qualquer quantidade de contatos adicionais. O e-mail de login/recuperação do Portal continua separado e não muda quando o principal de Comunicados muda. |
| Cadastro | E-mail é obrigatório em contato novo; nome e telefone são editáveis pelo Cliente no Portal e pela equipe na Ficha. A alteração do Cliente vale imediatamente após o commit. |
| Normalização | trim + minúsculas define igualdade. O mesmo endereço pode existir para Clientes diferentes, mas não pode aparecer duas vezes no mesmo Cliente, inclusive contra um registro inativo. A mensagem de duplicidade deve identificar o contato existente. |
| Ciclo de vida | Remover significa desativar logicamente, nunca apagar o contato individual. A desativação preserva contato, vínculos e histórico. Reativação reutiliza o mesmo registro; a captura automática de B/L nunca reativa um registro inativo. |
| Caixa Documentação e Operação | CE e Taxas, NOA, NOR e NOB. Código persistido: documentacao_operacao. |
| Caixa Financeiro | CE e Taxas e Cobranças de Demurrage. Código persistido: financeiro. |
| Caixa Demurrage | Cobranças de Demurrage e futuros modelos de Demurrage. Código persistido: demurrage. |
| Sobreposição | Um modelo pode pertencer a mais de uma caixa. Um contato pode estar em várias caixas. Se o mesmo endereço alcançar duas caixas no mesmo Comunicado, recebe somente uma cópia. |
| Principal | Ao nascer, o principal vem marcado nas três caixas. A UI pode propor sua retirada de uma caixa, mas o salvamento só passa se outro e-mail ativo e elegível ocupar aquela caixa na mesma operação. Quando um novo principal substitui o anterior, o novo principal recebe as três caixas e o antigo conserva seus vínculos até alteração explícita. |
| Contato adicional | Deve nascer com pelo menos uma caixa escolhida. O Portal não escolhe Natureza nem tipo de contato; mostra o pacote de modelos que cada caixa recebe. |
| Avisos gerais | Institucional e Comunicado livre no modo Todos os contatos alcançam todos os contatos ativos com e-mail elegível, sem opt-out por caixa. Supressão/bounce ainda impede o envio e exibe o motivo. |
| Comunicado livre | O operador escolhe Todos os contatos ou exatamente uma caixa (Documentação e Operação, Financeiro ou Demurrage). Não há seleção manual de endereços individuais. |
| Conferência | A Ficha e a conferência interna mostram os endereços agrupados por caixa, com seus vínculos e exclusões. Se a lista mudar entre conferência e envio, o envio é interrompido e exige nova conferência. |
| B/L | Se houver principal, o e-mail capturado entra como adicional ativo em Documentação e Operação. Sem principal, torna-se principal ativo e recebe as três caixas. Se o e-mail normalizado já existir, não cria, não reativa e não altera vínculos. A captura aparece na Ficha. |
| Indisponibilidade | Bounce permanente ou desativação remove o vínculo ativo afetado, grava uma correção agrupada e religa o principal elegível à caixa. Se o principal estiver indisponível e não houver substituto, a caixa fica bloqueada para envio e a equipe recebe alerta. Reclamação de Comunicados continua impedindo envio, mas não é tratada como reativação automática. |
| Auditoria | Cada salvamento do Portal gera uma ação única por Cliente, append-only, com estado anterior, estado posterior, mudanças, conta Portal, ator, origem e data. A equipe consulta isso na timeline da Ficha; não substitui o histórico dos Comunicados. |
| Segurança | O navegador do Portal chama somente RPCs próprias; não envia customer_id e não escreve tabelas. O modo Inspeção lê por wrapper interno e bloqueia qualquer gravação. Toda RPC privilegiada fixa search_path, deriva/valida o Cliente e recebe grants explícitos. |
| Compatibilidade | purpose e customer_contact_preferences deixam de ser fonte de roteamento. Permanecem no schema nesta entrega para permitir rollback e compatibilidade de código histórico, mas não são enviados pelo novo Portal, não são consultados pelo resolvedor e não recebem novos seeds. |

## Evidência atual que orienta a mudança

| Arquivo/trecho atual | Achado usado no plano |
|---|---|
| supabase/migrations/001_initial_schema.sql:1510-1535 | customer_contact_preferences ainda modela quatro Naturezas e customer_contacts ainda usa purpose, sem normalização, status ativo ou vínculo a caixa. |
| supabase/migrations/002_business_logic_and_security.sql:20135-20149 e 23974-23977 | Trigger cria preferências habilitadas para cada contato; ele deve deixar de alimentar o modelo antigo. |
| supabase/migrations/002_business_logic_and_security.sql:3357-3385 e 6661-6689 | Captura automática de B/L insere sempre purpose='financeiro', contato adicional e sem caixas; ambas as funções precisam compartilhar a regra nova. |
| supabase/migrations/002_business_logic_and_security.sql:4371-4425 | Criação de Cliente aceita lista sem principal/e-mail; a RPC deve passar a exigir o principal e criar vínculos. |
| supabase/migrations/002_business_logic_and_security.sql:11906-11916 e 13772-13820 | Perfil do Portal lê/atualiza e-mail e telefone por purpose='faturamento'; essa rota deve permanecer compatível, mas delegar contatos ao novo núcleo. |
| src/pages/PortalProfile.tsx:65-202 | /portal/perfil possui o campo único de e-mail, telefone e dados cadastrais; a seção de contatos deve substituir esse campo sem criar outra tela. |
| src/components/clientes/CadastroContatosTab.tsx:27-280 | Ficha grava contatos em chamadas separadas, apaga fisicamente e exibe checkboxes de Natureza; será substituída por uma fotografia atômica com caixas. |
| src/services/customerCommunications.ts:11-140, 294-303, 372-647 | Conferência resolve por customer_contact_preferences e Natureza; a estrutura deve passar a carregar vínculos, caixa-alvo e snapshot de destinatários. |
| supabase/functions/send-customer-communication/index.ts:387-423 | Envio valida contato e preferência antiga no último momento; deve validar a caixa/audiência e a disponibilidade vigente. |
| supabase/functions/demurrage-dunning/index.ts:117-185 e src/services/customerFinanceCommunications.ts:136-168 | Caminhos automáticos financeiro/demurrage também consultam preferências antigas; ambos devem usar o mesmo mapa caixa-modelo. |
| src/services/customerFicha.ts:39-153 | Timeline hoje expõe auditoria linha a linha e criação de contato, mas não uma ação agrupada de configuração. |
| src/services/portalScope.ts:18-28 | A allowlist de escritas do Portal precisa bloquear o novo RPC no modo Inspeção. |
| supabase/migrations/001_initial_schema.sql–007_cron_secrets_no_vault.sql | A próxima migration local é 008_portal_contact_boxes.sql; não reutilizar nomes históricos arquivados. |

## Mapa de arquivos

### Criar

- supabase/migrations/008_portal_contact_boxes.sql — catálogo de caixas, vínculo contato-caixa, disponibilidade, auditoria agrupada, RPCs, grants, RLS, fallback e atualização das funções de criação/captura.
- src/services/customerCommunicationBoxes.ts — códigos/rótulos/pacotes das caixas, tipos de audiência e resolvedor puro usado pela conferência.
- src/services/customerContactConfiguration.ts — leitura e gravação interna da fotografia de contatos, normalização de payload e tipos compartilhados com a Ficha.
- src/services/portalContactConfiguration.ts — adapter das RPCs próprias do Portal, sem customer_id no payload.
- src/hooks/usePortalContactConfiguration.ts — query/mutation do Portal e invalidação de caches.
- src/components/portal/PortalContactConfiguration.tsx — seção Contatos e recebimento no /portal/perfil.
- src/components/clientes/CustomerContactConfiguration.tsx — editor/visualização interna agrupada por caixa, usado pela Ficha.
- src/services/__tests__/issue609ContactBoxesMigration.test.ts — testes de contrato SQL da migration 008.
- src/services/__tests__/customerCommunicationBoxes.test.ts — testes puros de pacotes, audiência, fallback de dados e deduplicação.
- src/services/__tests__/customerContactConfiguration.test.ts — testes de payload, normalização e adapter interno/Portal.
- src/components/portal/__tests__/PortalContactConfiguration.test.tsx — comportamento do editor no Portal e no modo Inspeção.
- docs/adr/0064-caixas-de-comunicacao-e-auditoria-de-contatos.md — decisão arquitetural de roteamento, precedência e trilha agrupada.

### Modificar

- src/pages/PortalProfile.tsx, src/services/portalBilling.ts, src/hooks/usePortalProfile.ts — separar dados cadastrais de contatos; manter recuperação e compatibilidade de leitura sem mais editar contato por campo único.
- src/services/portalScope.ts — bloquear portal_save_contact_configuration em Inspeção.
- src/components/clientes/CadastroContatosTab.tsx, src/hooks/useCustomers.ts, src/services/customers.ts, src/pages/Clientes.tsx, src/lib/customerTableViewModel.ts — usar configuração de caixas, desativação lógica e resumo sem purpose como roteamento.
- src/services/customerFicha.ts, src/hooks/useCustomerFicha.ts, src/components/clientes/HistoricoTab.tsx — carregar/exibir eventos agrupados de contatos e captura automática.
- src/services/customerCommunications.ts, src/services/customerCommunicationDispatches.ts, src/hooks/useCustomerCommunications.ts, src/pages/ClientesComunicacao.tsx — resolver por caixa, audiência livre, agrupamento, snapshot e revalidação.
- src/services/customerFinanceCommunications.ts, src/services/demurrageDunning.ts — usar Financeiro/Demurrage e deduplicação comum.
- supabase/functions/send-customer-communication/index.ts, supabase/functions/demurrage-dunning/index.ts — validar caixa/audiência no envio real.
- supabase/functions/portal-email-webhook/index.ts, supabase/functions/_shared/portalBounceCascade.ts — acionar remoção de vínculo, fallback persistente e alerta por caixa.
- src/components/bl/BlClienteSection.tsx, src/services/customerBase.ts, src/components/customers/CreateCustomerModal.tsx, src/components/customers/customerCreateForm.ts, src/components/review/ReviewCustomerOnboarding.tsx, src/services/reviewCustomerGroup.ts — adaptar criação/importação/revisão à exigência de principal e ao mapeamento do B/L.
- src/services/portalProvisioning.ts, src/lib/portalProvisioningViewModel.ts, src/components/portal/PortalReviewPanel.tsx — remover purpose do significado de candidato de e-mail.
- src/types/database.ts — regenerar pelo Supabase CLI depois da migration; nunca editar manualmente.
- docs/RASTREABILIDADE.md, docs/ARCHITECTURE.md, docs/adr/README.md, CONTEXT.md, docs/plans/README.md — registrar rota, RPCs, segurança, modelo e plano vivo.

### Aposentar

- src/services/customerContactPreferences.ts e src/hooks/useCustomerContactPreferences.ts — remover depois que a Ficha não tiver mais importadores; a tabela legada fica apenas no banco nesta entrega, sem uso no produto.

## Plano de execução

### Task 1: Congelar o contrato com testes de migration

**Files:**
- Create: src/services/__tests__/issue609ContactBoxesMigration.test.ts
- Read: supabase/migrations/008_portal_contact_boxes.sql

- [ ] **Step 1: Escrever o teste de contrato SQL antes da implementação.**

Criar o teste usando a mesma convenção de inspeção textual do repositório:

~~~ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/008_portal_contact_boxes.sql', 'utf8')

describe('issue 609 — caixas de comunicação', () => {
  it('cria catálogo, mapa de modelos, vínculos e trilha agrupada', () => {
    expect(sql).toMatch(/CREATE TABLE public\.customer_communication_boxes/i)
    expect(sql).toMatch(/CREATE TABLE public\.customer_communication_box_kinds/i)
    expect(sql).toMatch(/CREATE TABLE public\.customer_contact_box_links/i)
    expect(sql).toMatch(/CREATE TABLE public\.customer_contact_change_events/i)
    expect(sql).toMatch(/email_normalized.*GENERATED ALWAYS/i)
    expect(sql).toMatch(/deactivated_at.*timestamp with time zone/i)
    expect(sql).toMatch(/UNIQUE INDEX.*customer_contacts.*email_normalized/i)
  })

  it('semeia exatamente as três caixas e os pacotes atuais', () => {
    expect(sql).toMatch(/documentacao_operacao/i)
    expect(sql).toMatch(/financeiro/i)
    expect(sql).toMatch(/demurrage/i)
    expect(sql).toMatch(/aviso_chegada_noa/i)
    expect(sql).toMatch(/aviso_prontidao_nor/i)
    expect(sql).toMatch(/aviso_atracacao_nob/i)
    expect(sql).toMatch(/ce_mercante_taxas/i)
    expect(sql).toMatch(/cobranca_demurrage/i)
  })

  it('expõe RPC própria do Portal e wrapper de Inspeção sem customer_id no save', () => {
    expect(sql).toMatch(/CREATE FUNCTION public\.portal_save_contact_configuration\(p_contacts jsonb\)/i)
    expect(sql).toMatch(/CREATE FUNCTION public\.portal_get_contact_configuration\(\)/i)
    expect(sql).toMatch(/CREATE FUNCTION public\.portal_inspect_get_contact_configuration\(p_customer_id bigint\)/i)
    expect(sql).toMatch(/current_portal_customer_id\(\)/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._apply_customer_contact_configuration/i)
  })

  it('fecha escrita direta em eventos e exige leitura interna', () => {
    expect(sql).toMatch(/REVOKE .*INSERT.*UPDATE.*DELETE.*customer_contact_change_events/i)
    expect(sql).toMatch(/CREATE POLICY .*customer_contact_change_events.*SELECT.*is_active_read_user/i)
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_seed_customer_contact_preferences/i)
  })
})
~~~

- [ ] **Step 2: Rodar o teste e confirmar a falha esperada.**

Executar:

~~~powershell
npx vitest run src/services/__tests__/issue609ContactBoxesMigration.test.ts --maxWorkers=1 --testTimeout=15000
~~~

Resultado esperado antes da migration: FAIL, porque supabase/migrations/008_portal_contact_boxes.sql ainda não existe.

- [ ] **Step 3: Registrar o primeiro checkpoint.**

~~~powershell
git add src/services/__tests__/issue609ContactBoxesMigration.test.ts
git commit -m "test: specify issue 609 contact box contract"
~~~

### Task 2: Criar o schema das caixas, disponibilidade e auditoria append-only

**Files:**
- Create: supabase/migrations/008_portal_contact_boxes.sql
- Test: src/services/__tests__/issue609ContactBoxesMigration.test.ts

- [ ] **Step 1: Adicionar os campos de ciclo de vida e igualdade de e-mail.**

Na migration, acrescentar email_normalized, deactivated_at e origin sem remover purpose nesta entrega. O contrato de banco deve ser equivalente a:

~~~sql
ALTER TABLE public.customer_contacts
  ADD COLUMN email_normalized text GENERATED ALWAYS AS (
    NULLIF(lower(btrim(email)), '')
  ) STORED,
  ADD COLUMN deactivated_at timestamptz,
  ADD COLUMN origin text NOT NULL DEFAULT 'interno',
  ADD CONSTRAINT customer_contacts_origin_check
    CHECK (origin IN ('portal', 'interno', 'bl_automatico', 'sistema'));

CREATE UNIQUE INDEX customer_contacts_customer_email_normalized_uidx
  ON public.customer_contacts (customer_id, email_normalized)
  WHERE customer_id IS NOT NULL AND email_normalized IS NOT NULL;

CREATE UNIQUE INDEX customer_contacts_one_active_primary_uidx
  ON public.customer_contacts (customer_id)
  WHERE customer_id IS NOT NULL
    AND is_primary = true
    AND deactivated_at IS NULL;
~~~

O índice de e-mail inclui registros inativos; o índice de principal impede dois principais ativos, mas a exigência de pelo menos um principal será validada pelo núcleo transacional e pelos fluxos de criação.

- [ ] **Step 2: Criar e semear o catálogo extensível.**

Criar customer_communication_boxes com code, label, description, sort_order e active; criar customer_communication_box_kinds com chave (box_code, kind). Semear somente:

~~~sql
INSERT INTO public.customer_communication_boxes (code, label, description, sort_order)
VALUES
  ('documentacao_operacao', 'Documentação e Operação', 'CE e Taxas, NOA, NOR e NOB.', 1),
  ('financeiro', 'Financeiro', 'CE e Taxas e Cobranças de Demurrage.', 2),
  ('demurrage', 'Demurrage', 'Cobranças de Demurrage e futuros comunicados de Demurrage.', 3)
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    active = true;

INSERT INTO public.customer_communication_box_kinds (box_code, kind)
VALUES
  ('documentacao_operacao', 'aviso_chegada_noa'),
  ('documentacao_operacao', 'aviso_prontidao_nor'),
  ('documentacao_operacao', 'aviso_atracacao_nob'),
  ('documentacao_operacao', 'ce_mercante_taxas'),
  ('financeiro', 'ce_mercante_taxas'),
  ('financeiro', 'cobranca_demurrage'),
  ('demurrage', 'cobranca_demurrage')
ON CONFLICT DO NOTHING;
~~~

Não cadastrar institucional ou livre no mapa: eles usam audiência geral ou uma caixa escolhida pelo operador.

- [ ] **Step 3: Criar os vínculos por contato.**

Criar customer_contact_box_links com FK para contato e catálogo, chave primária (contact_id, box_code), created_at e índices por (box_code, contact_id) e (contact_id, box_code). O vínculo deve aceitar o mesmo contato em três caixas, mas não duas vezes na mesma caixa. A exclusão em cascata só ocorre se o contato for apagado como parte da exclusão controlada do Cliente; o Portal nunca chama DELETE de contato.

- [ ] **Step 4: Criar a tabela de ação agrupada.**

Criar customer_contact_change_events com id, action_id uuid default gen_random_uuid(), customer_id, source, actor_id, portal_account_id, related_bl_id, before_snapshot jsonb, after_snapshot jsonb, change_summary jsonb e created_at. Validar source IN ('portal', 'interno', 'bl_automatico', 'sistema'). Os snapshots devem conter contatos, email_normalized, disponibilidade e caixas, ordenados de forma determinística; não incluir senha, token ou dados de recuperação do Portal.

- [ ] **Step 5: Aplicar RLS e ACL.**

Habilitar RLS nas quatro tabelas novas, revogar PUBLIC/anon, permitir SELECT somente a is_active_read_user() para usuários internos e não conceder INSERT, UPDATE ou DELETE de eventos a authenticated. As escritas de vínculos ocorrerão somente pelo núcleo SECURITY DEFINER; o cliente do Portal verá a projeção pelo getter, não pela tabela.

- [ ] **Step 6: Desligar o seed do modelo antigo sem apagar sua tabela.**

Executar DROP TRIGGER IF EXISTS trg_seed_customer_contact_preferences ON public.customer_contacts;. Não migrar preferências antigas para caixas: a decisão do produto informa que não há dados antigos em produção, e copiar Naturezas antigas recriaria a ambiguidade que foi removida.

- [ ] **Step 7: Rodar os testes de contrato e o replay local.**

Executar:

~~~powershell
npx vitest run src/services/__tests__/issue609ContactBoxesMigration.test.ts --maxWorkers=1 --testTimeout=15000
bash scripts/setup-local-pg.sh --reset
~~~

Esperado: o teste termina com PASS; o replay local termina sem erro de migration e imprime uma DATABASE_URL local. Nunca apontar esse replay ao projeto remoto de produção.

- [ ] **Step 8: Registrar o checkpoint do schema.**

~~~powershell
git add supabase/migrations/008_portal_contact_boxes.sql src/services/__tests__/issue609ContactBoxesMigration.test.ts
git commit -m "feat: add customer communication box schema"
~~~

### Task 3: Implementar o núcleo transacional de contatos, Portal e fallback

**Files:**
- Modify: supabase/migrations/008_portal_contact_boxes.sql
- Test: src/services/__tests__/issue609ContactBoxesMigration.test.ts

- [ ] **Step 1: Definir o payload único e o algoritmo de validação.**

O núcleo privado _apply_customer_contact_configuration deve receber p_customer_id, a fotografia JSON, source, ator, conta Portal e B/L relacionado. A fotografia aceita este formato, sem customer_id por item:

~~~json
[
  {
    "id": 17,
    "name": "Contas a pagar",
    "email": "  contas@cliente.com ",
    "phone": "+55 11 99999-0000",
    "is_primary": false,
    "active": true,
    "box_codes": ["financeiro"]
  },
  {
    "id": null,
    "name": "Operação",
    "email": "operacao@cliente.com",
    "phone": null,
    "is_primary": true,
    "active": true,
    "box_codes": ["documentacao_operacao", "financeiro", "demurrage"]
  }
]
~~~

Validar tudo antes de qualquer INSERT, UPDATE ou alteração de vínculo: JSON array, contato existente pertencente ao Cliente, e-mail válido em todo contato novo/ativo, unicidade normalizada contra o payload e contra o índice, caixas ativas existentes, ao menos uma caixa para cada contato ativo, exatamente um principal ativo e principal com e-mail. Se falhar, levantar erro sem persistir nada. A mensagem de duplicidade deve trazer o id/nome/e-mail já cadastrado.

- [ ] **Step 2: Implementar as regras de principal e substituição.**

Bloquear o salvamento quando o principal sair de uma caixa sem outro contato ativo, com e-mail não suprimido e vinculado àquela caixa na fotografia final. Se o principal mudar, tornar o novo principal vinculado às três caixas, mantendo os vínculos do principal anterior. Se um contato novo for principal, aplicar as três caixas quando box_codes vier ausente; se vier explícito, validar as retiradas com a mesma regra de substituição. Contatos inativos preservam seus vínculos e não contam como destinatários.

O resultado deve retornar a fotografia canônica, inclusive suppression_reason, sendable e box_codes, para que o Portal possa mostrar imediatamente o estado salvo.

- [ ] **Step 3: Criar os wrappers de segurança.**

Criar estas assinaturas:

~~~sql
CREATE FUNCTION public.portal_get_contact_configuration()
RETURNS jsonb;

CREATE FUNCTION public.portal_inspect_get_contact_configuration(p_customer_id bigint)
RETURNS jsonb;

CREATE FUNCTION public.portal_save_contact_configuration(p_contacts jsonb)
RETURNS jsonb;

CREATE FUNCTION public.internal_save_customer_contact_configuration(
  p_customer_id bigint,
  p_contacts jsonb,
  p_justification text DEFAULT NULL
)
RETURNS jsonb;
~~~

portal_get_contact_configuration e portal_save_contact_configuration devem usar current_portal_customer_id(); se a sessão não tiver conta ativa, retornar 42501. O wrapper de Inspeção aceita o p_customer_id injetado por callPortalRpc, valida is_active_read_user() e somente lê. O save do Portal deve chamar o núcleo com source='portal', auth.uid() e a conta Portal derivada da sessão. O save interno deve exigir usuário interno ativo e justificar a alteração quando a convenção da Ficha exigir.

- [ ] **Step 4: Criar os grants e fechar a função privada.**

Revogar PUBLIC, anon e authenticated do núcleo privado e conceder execução apenas aos wrappers e ao service_role quando necessário para Edge Functions. Conceder os wrappers de leitura/gravação ao papel autenticado apropriado; o wrapper fará a autorização. Todos os corpos SECURITY DEFINER devem usar SET search_path TO 'public', 'pg_temp' ou equivalente fixo.

- [ ] **Step 5: Atualizar a criação atômica de Cliente.**

Recriar create_customer_with_contacts para exigir uma lista com exatamente um principal e e-mail válido. O primeiro contato principal recebe as três caixas; cada adicional precisa de box_codes não vazio. A RPC deve inserir origin='interno', criar os vínculos dentro da mesma transação e registrar um evento source='interno' quando houver configuração inicial. A ausência de e-mail deve retornar erro de validação, não criar Cliente incompleto.

- [ ] **Step 6: Implementar o reparo automático por disponibilidade.**

Criar repair_customer_contact_box_fallbacks(p_customer_id bigint, p_kind text DEFAULT NULL, p_box_code text DEFAULT NULL) com execução restrita. Para cada caixa alcançada pelo modelo ou pela caixa-alvo:

1. remover o vínculo ativo de contatos com bounce permanente ou desativados;
2. se existir principal ativo e elegível, inserir o vínculo do principal e registrar uma ação source='sistema';
3. se o principal estiver indisponível, tentar outro contato ativo, elegível e já vinculado à caixa;
4. se não houver substituto, não escolher endereço fora da caixa, marcar a resolução como bloqueada e chamar upsert_alert_item com a caixa no metadata e destino /clientes.

O reparo deve ser idempotente: repetir a mesma indisponibilidade não cria vínculos ou eventos duplicados quando o estado não mudou.

- [ ] **Step 7: Atualizar contrato SQL e replay.**

Acrescentar ao teste de contrato asserções para portal_save_contact_configuration, portal_inspect_get_contact_configuration, current_portal_customer_id, erros de principal/caixa e repair_customer_contact_box_fallbacks. Rodar:

~~~powershell
npx vitest run src/services/__tests__/issue609ContactBoxesMigration.test.ts --maxWorkers=1 --testTimeout=15000
bash scripts/setup-local-pg.sh --reset
~~~

Esperado: PASS no teste e replay local sem erro de grants, search_path, RLS ou dependência de tabela legada.

### Task 4: Criar o domínio de caixas e o resolvedor determinístico

**Files:**
- Create: src/services/customerCommunicationBoxes.ts
- Create: src/services/__tests__/customerCommunicationBoxes.test.ts
- Modify: src/services/customerCommunications.ts

- [ ] **Step 1: Definir códigos, rótulos, pacotes e audiências.**

Criar tipos equivalentes a:

~~~ts
export const CUSTOMER_COMMUNICATION_BOXES = [
  { code: 'documentacao_operacao', label: 'Documentação e Operação', description: 'CE e Taxas, NOA, NOR e NOB.' },
  { code: 'financeiro', label: 'Financeiro', description: 'CE e Taxas e Cobranças de Demurrage.' },
  { code: 'demurrage', label: 'Demurrage', description: 'Cobranças de Demurrage e futuros comunicados de Demurrage.' },
] as const

export type CommunicationBoxCode = typeof CUSTOMER_COMMUNICATION_BOXES[number]['code']
export type CustomerCommunicationAudience =
  | { mode: 'todos' }
  | { mode: 'caixa'; boxCode: CommunicationBoxCode }

export const CUSTOMER_COMMUNICATION_BOX_KINDS: Record<CommunicationBoxCode, readonly string[]> = {
  documentacao_operacao: ['aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob', 'ce_mercante_taxas'],
  financeiro: ['ce_mercante_taxas', 'cobranca_demurrage'],
  demurrage: ['cobranca_demurrage'],
}
~~~

Os códigos de roteamento devem ser comparados com a tabela do banco; os rótulos e descrições são a apresentação. A adição futura de um modelo será uma nova linha em customer_communication_box_kinds, sem alterar vínculos existentes.

- [ ] **Step 2: Escrever testes puros antes do resolvedor.**

Cobrir, com contatos fictícios e vínculos explícitos:

- CE alcançando contato de Documentação e Operação e contato de Financeiro, retornando cada endereço uma vez;
- cobrança de Demurrage alcançando Financeiro e Demurrage, sem duplicação;
- contato em duas caixas aparecendo uma vez com as duas caixas correspondentes;
- audiência todos ignorando caixas, mas excluindo contato inativo, sem e-mail, complaint e bounce com motivos distintos;
- audiência de uma caixa excluindo contato de outra caixa;
- caixa sem destinatário elegível retornando blocked=true;
- principal religado na fotografia final sendo usado quando o endereço específico foi removido;
- normalização CONTAS@CLIENTE.COM = contas@cliente.com.

- [ ] **Step 3: Implementar o resolvedor sem ler Natureza.**

O resolvedor recebe contacts, boxLinks, kind, audience, supressões de Comunicados e supressões compartilhadas do Portal. Ele deriva as caixas pelo mapa, filtra por active e e-mail válido, aplica supressões, agrupa por e-mail normalizado, ordena principal antes de adicionais e devolve:

~~~ts
type CustomerCommunicationRecipient = CustomerContact & {
  boxCodes: CommunicationBoxCode[]
  matchedBoxCodes: CommunicationBoxCode[]
}

type ResolvedRecipients = {
  eligible: CustomerCommunicationRecipient[]
  excluded: Array<{ contact: CustomerContact; reason: 'contato_desativado' | 'email_ausente' | 'suprimido_complaint' | 'suprimido_bounce' }>
  blocked: boolean
}
~~~

CUSTOMER_COMMUNICATION_NATURES e getCustomerCommunicationNature permanecem somente como classificação técnica do template/histórico. Remover preferencia_desligada do conjunto de exclusões do roteamento.

- [ ] **Step 4: Adaptar a conferência e seu snapshot.**

Em customerCommunications.ts, substituir preferences por boxLinksByContact/boxCodes, adicionar audience à conferência e a cada linha, e incluir recipientSnapshot determinístico formado por customerId, kind, audiência, contactId e e-mail normalizado. A função fetchCommunicationContacts deve carregar contatos e vínculos em lotes, mantendo a ordenação do banco. A conferência deve mostrar matchedBoxCodes no modelo consumido pela UI.

- [ ] **Step 5: Rodar os testes focados.**

~~~powershell
npx vitest run src/services/__tests__/customerCommunicationBoxes.test.ts src/services/__tests__/customerCommunications.test.ts src/services/__tests__/customerCommunicationsE2EFlows.test.ts --maxWorkers=1 --testTimeout=15000
~~~

Esperado: os novos testes passam; testes antigos que esperam customer_contact_preferences falham até as chamadas das Tasks 6 e 7 serem migradas, sem mascarar a falha com any ou fixture incompleta.

### Task 5: Migrar o adapter do Portal e a tela /portal/perfil

**Files:**
- Create: src/services/portalContactConfiguration.ts
- Create: src/hooks/usePortalContactConfiguration.ts
- Create: src/components/portal/PortalContactConfiguration.tsx
- Create: src/components/portal/__tests__/PortalContactConfiguration.test.tsx
- Modify: src/pages/PortalProfile.tsx
- Modify: src/services/portalBilling.ts
- Modify: src/hooks/usePortalProfile.ts
- Modify: src/services/portalScope.ts
- Modify: src/pages/__tests__/PortalProfile.test.tsx
- Modify: src/services/__tests__/portalBillingMutations.test.ts

- [ ] **Step 1: Criar os adapters RPC sem customer_id.**

Implementar no serviço Portal:

~~~ts
export async function portalGetContactConfiguration(scope = clientPortalScope): Promise<PortalContactConfiguration> {
  const data = await callPortalRpc<PortalContactConfiguration>(scope, 'portal_get_contact_configuration')
  return data ?? { boxes: [], contacts: [] }
}

export async function portalSaveContactConfiguration(
  contacts: readonly PortalContactDraft[],
  scope = clientPortalScope,
): Promise<PortalContactConfiguration> {
  const data = await callPortalRpc<PortalContactConfiguration>(scope, 'portal_save_contact_configuration', {
    p_contacts: contacts.map(({ id, name, email, phone, isPrimary, active, boxCodes }) => ({
      id, name, email, phone, is_primary: isPrimary, active, box_codes: boxCodes,
    })),
  })
  return data ?? { boxes: [], contacts: [] }
}
~~~

O serviço não adiciona p_customer_id mesmo no modo Cliente. callPortalRpc adicionará p_customer_id somente ao wrapper de leitura em Inspeção; o save será rejeitado pela allowlist antes de qualquer chamada nesse modo.

- [ ] **Step 2: Separar o perfil cadastral dos contatos.**

Alterar PortalProfile/portalUpdateProfile para que o formulário principal grave endereço, cidade, UF e CEP. Manter a forma legada de leitura e os argumentos antigos da RPC no banco para rollback, mas não renderizar nem enviar contactEmail/phone por portal_update_profile; o telefone passa a ser propriedade do cartão do contato. A seção de recuperação continua independente e não compartilha seu e-mail com os contatos.

- [ ] **Step 3: Implementar query, mutation e invalidação.**

usePortalContactConfiguration deve usar chave ['portal-contact-configuration', scope.mode, scope.customerId], carregar quando houver sessão/inspeção, chamar a RPC nova e, após salvar, invalidar essa chave, ['portal-profile'] e overview. Erros de duplicidade, principal ausente, caixa ausente e substituição devem passar por portalErrorMessage preservando a mensagem do banco.

- [ ] **Step 4: Construir a seção Contatos e recebimento.**

Dentro de PortalProfile, sem nova rota, renderizar cartões para contatos ativos e inativos. Cada cartão deve permitir nome, e-mail, telefone, principal e estado ativo; exibir três caixas com descrição dos modelos; permitir múltiplas caixas; mostrar badge de principal, origem e motivo de supressão/bounce. O botão Novo contato cria um rascunho adicional sem caixa marcada, para que o cliente escolha ao menos uma.

O principal inicial deve aparecer marcado nas três caixas. Ao desmarcar uma caixa do principal, mostrar antes do envio: “Para retirar o contato principal desta caixa, selecione outro e-mail para substituí-lo.” O servidor continua sendo a autoridade e a mensagem de erro deve permanecer visível se a fotografia ficar inválida. Desativar um principal exige escolher outro principal no mesmo salvamento; desativar adicional conserva histórico e vínculos.

- [ ] **Step 5: Cobrir Cliente e Inspeção com testes de comportamento.**

Os testes devem verificar:

- carregamento de principal, adicional, telefone, caixas e motivo de endereço bloqueado;
- inclusão de adicional sem caixa sendo rejeitada no botão de salvar;
- principal com todas as caixas por padrão;
- remoção de principal de uma caixa exigindo substituto;
- payload do save sem customer_id, com p_contacts e box_codes;
- nome/telefone enviados pelo mesmo save de contatos;
- modo Inspeção exibindo dados, desabilitando salvar/desativar e não chamando RPC de escrita;
- seção de Email de Recuperação continuando presente e separada.

Rodar:

~~~powershell
npx vitest run src/components/portal/__tests__/PortalContactConfiguration.test.tsx src/pages/__tests__/PortalProfile.test.tsx src/services/__tests__/portalBillingMutations.test.ts --maxWorkers=1 --testTimeout=15000
~~~

Esperado: PASS, com o teste existente do perfil atualizado para não tratar o fallback da conta como e-mail de contato editável.

- [ ] **Step 6: Fechar a fronteira de Inspeção.**

Adicionar portal_save_contact_configuration a portalWriteRpcNames. Criar a asserção de contrato em portalScope/teste correspondente: em mode='inspect', a chamada lança Ação do cliente indisponível em Modo Inspeção. antes de alcançar o cliente Supabase.

### Task 6: Migrar a Ficha, edições internas e timeline

**Files:**
- Create: src/services/customerContactConfiguration.ts
- Create: src/components/clientes/CustomerContactConfiguration.tsx
- Create: src/services/__tests__/customerContactConfiguration.test.ts
- Modify: src/components/clientes/CadastroContatosTab.tsx
- Modify: src/hooks/useCustomers.ts
- Modify: src/services/customers.ts
- Modify: src/services/customerFicha.ts
- Modify: src/hooks/useCustomerFicha.ts
- Modify: src/components/clientes/HistoricoTab.tsx
- Modify: src/components/clientes/__tests__/CadastroContatosTab.test.tsx
- Modify: src/components/clientes/__tests__/HistoricoTab.test.tsx
- Modify: src/services/__tests__/customerFicha.test.ts
- Delete: src/services/customerContactPreferences.ts
- Delete: src/hooks/useCustomerContactPreferences.ts

- [ ] **Step 1: Criar leitura e escrita interna da configuração.**

customerContactConfiguration.ts deve buscar customer_contacts com deactivated_at/origin e customer_contact_box_links, montar a fotografia compartilhada e chamar internal_save_customer_contact_configuration para toda inclusão, edição, troca de principal, caixas e desativação. deleteCustomerContact deve virar uma operação de desativação por id, preservando o registro; não chamar DELETE para remover contato individual.

- [ ] **Step 2: Substituir a UI antiga de Naturezas.**

Remover ContactPreferences, CUSTOMER_COMMUNICATION_NATURES e o select Finalidade de CadastroContatosTab. Renderizar CustomerContactConfiguration com:

- lista plana de contatos com origem, estado, principal e supressão;
- três agrupamentos Documentação e Operação, Financeiro e Demurrage, listando todos os e-mails vinculados;
- edição de nome/e-mail/telefone/principal/caixas;
- ação Desativar/Reativar em vez de Remover;
- explicação de que purpose não controla mais recebimento;
- mensagem de permissão quando o usuário interno não pode editar.

A edição explícita da equipe usa source='interno' e pode corrigir a escolha do Cliente; o evento da timeline deve dizer que foi alteração interna, sem apagar a ação Portal anterior.

- [ ] **Step 3: Atualizar queries e resumos.**

Em useCustomers.ts e Clientes.tsx, incluir deactivated_at, origin e os vínculos necessários ou um resumo derivado. Em customerTableViewModel.ts/CustomerTable.tsx, remover os rótulos Geral, Operacional e Faturamento como indicação de roteamento; mostrar principal e quantidade de caixas quando disponível. A busca de e-mail do gate continua verificando e-mail não vazio.

- [ ] **Step 4: Exibir ação agrupada na timeline.**

Ampliar CustomerTimelineEvent com contact_configuration_changed. fetchCustomerTimelineSources deve consultar customer_contact_change_events por Cliente e buildCustomerTimeline deve produzir uma única linha por action_id, com origem (Portal, Equipe, B/L ou Sistema), resumo das alterações, quantidade de contatos/caixas e link nulo. Eventos de criação automática do B/L devem aparecer mesmo quando não houver alteração manual.

- [ ] **Step 5: Testar edição interna, preservação e log.**

Cobrir:

- edição de nome/telefone e caixas numa única chamada;
- desativação lógica sem DELETE;
- reativação do mesmo id;
- duplicate normalizado informando contato existente;
- principal obrigatório e substituição de caixa;
- grupo de alterações renderizado como um evento único;
- motivo de bounce/complaint visível na Ficha;
- contatos agrupados em cada caixa sem perder contatos presentes em mais de uma.

Rodar:

~~~powershell
npx vitest run src/services/__tests__/customerContactConfiguration.test.ts src/components/clientes/__tests__/CadastroContatosTab.test.tsx src/components/clientes/__tests__/HistoricoTab.test.tsx src/services/__tests__/customerFicha.test.ts --maxWorkers=1 --testTimeout=15000
~~~

Esperado: PASS e nenhuma consulta nova a customer_contact_preferences nos arquivos de produção.

### Task 7: Adaptar criação, importação e captura automática de B/L

**Files:**
- Modify: supabase/migrations/008_portal_contact_boxes.sql
- Modify: src/components/bl/BlClienteSection.tsx
- Modify: src/services/customerBase.ts
- Modify: src/components/customers/CreateCustomerModal.tsx
- Modify: src/components/customers/customerCreateForm.ts
- Modify: src/components/review/ReviewCustomerOnboarding.tsx
- Modify: src/services/customers.ts
- Modify: src/services/reviewCustomerGroup.ts
- Modify: src/services/__tests__/revisaoEfeitoCompletoConciliacaoMigration.test.ts
- Modify: src/services/__tests__/importacaoCapturaContatoMigration.test.ts
- Modify: src/services/__tests__/customerCreateAtomic.test.ts
- Modify: src/services/__tests__/ReviewCustomerOnboarding.test.tsx

- [ ] **Step 1: Reescrever as duas funções de captura com a regra final.**

capture_manifest_financial_contact e ensure_customer_contact_email devem normalizar antes de consultar, usar índice/lock do Cliente, e seguir este algoritmo:

~~~sql
SELECT id, is_primary, deactivated_at
INTO v_existing
FROM public.customer_contacts
WHERE customer_id = p_customer_id
  AND email_normalized = v_email
FOR UPDATE;

IF FOUND THEN
  RETURN false; -- ativo ou inativo: não duplica, não reativa, não altera caixas
END IF;

SELECT EXISTS (
  SELECT 1 FROM public.customer_contacts
  WHERE customer_id = p_customer_id
    AND is_primary = true
    AND deactivated_at IS NULL
)
INTO v_has_primary;

INSERT INTO public.customer_contacts (customer_id, name, email, origin, is_primary)
VALUES (p_customer_id, p_contact_name, v_email, 'bl_automatico', NOT v_has_primary)
RETURNING id INTO v_contact_id;

INSERT INTO public.customer_contact_box_links (contact_id, box_code)
SELECT v_contact_id, code
FROM public.customer_communication_boxes
WHERE active = true
  AND (NOT v_has_primary OR code = 'documentacao_operacao');
~~~

Usar o núcleo de snapshot para o evento, com source='bl_automatico'; passar o B/L relacionado quando o chamador o conhecer. Se o único endereço reaparecer como registro inativo e o Cliente continuar sem principal, não reativar nem duplicar: abrir alerta de Cliente sem principal e bloquear a resolução até correção explícita.

- [ ] **Step 2: Atualizar os chamadores SQL.**

Manter a captura em complete_review_customer_group, import_bl_freight_transactional_legacy_322 e save_bl_review, mas remover qualquer INSERT duplicado. O teste de contrato de importação deve continuar afirmando que a regra fica na função única; agora também deve afirmar que o adicional recebe documentacao_operacao, o novo principal recebe três caixas e endereço existente não sofre UPDATE.

- [ ] **Step 3: Corrigir criação manual e manifesto sem e-mail.**

Em CreateCustomerModal e customerCreateForm, remover finalidade do formulário e exibir caixas; exigir ao menos um e-mail principal antes de enviar. Em BlClienteSection, criar o Cliente do manifesto somente quando houver e-mail válido; sem e-mail, mostrar que o cadastro mínimo não pode ser criado e manter o B/L pendente para correção. A criação com e-mail do manifesto passa pelo principal e pelas três caixas.

- [ ] **Step 4: Corrigir base de Clientes e Revisão.**

Na importação, uma linha sem e-mail deve ser erro de linha e não criar Cliente incompleto. Para Cliente novo, a primeira ocorrência normalizada vira principal e recebe todas as caixas; demais recebem documentacao_operacao. Para Cliente existente, e-mails novos entram como adicionais em documentacao_operacao, sem trocar principal ou caixas já escolhidas. Repetições e registros inativos são ignorados sem reativação. addCustomerEmail e o onboarding devem chamar a função/RPC única, não inserir diretamente.

- [ ] **Step 5: Verificar captura e não-sobrescrita.**

Rodar:

~~~powershell
npx vitest run src/services/__tests__/revisaoEfeitoCompletoConciliacaoMigration.test.ts src/services/__tests__/importacaoCapturaContatoMigration.test.ts src/services/__tests__/customerCreateAtomic.test.ts src/services/__tests__/ReviewCustomerOnboarding.test.tsx --maxWorkers=1 --testTimeout=15000
~~~

Esperado: PASS; asserções antigas de purpose='financeiro' e inserção direta devem ser substituídas por origem/mapeamento de caixas, nunca removidas sem uma asserção equivalente.

### Task 8: Migrar a conferência, os disparos e os caminhos automáticos

**Files:**
- Modify: src/services/customerCommunications.ts
- Modify: src/services/customerCommunicationDispatches.ts
- Modify: src/hooks/useCustomerCommunications.ts
- Modify: src/pages/ClientesComunicacao.tsx
- Modify: src/services/customerFinanceCommunications.ts
- Modify: src/services/demurrageDunning.ts
- Modify: supabase/functions/send-customer-communication/index.ts
- Modify: supabase/functions/demurrage-dunning/index.ts
- Modify: supabase/functions/portal-email-webhook/index.ts
- Modify: supabase/functions/_shared/portalBounceCascade.ts
- Modify: src/services/__tests__/customerCommunications.test.ts
- Modify: src/services/__tests__/customerCommunicationsE2EFlows.test.ts
- Modify: src/services/__tests__/customerFinanceCommunications.test.ts
- Modify: src/services/__tests__/demurrageDunningRead.test.ts
- Modify: src/services/__tests__/sendCustomerCommunicationFunction.test.ts
- Modify: src/services/__tests__/portalBounceCascade.test.ts
- Modify: src/pages/__tests__/ClientesComunicacao.test.tsx

- [ ] **Step 1: Alterar o contrato de dispatch.**

Adicionar ao CustomerCommunicationDispatchInput:

~~~ts
audience?: CustomerCommunicationAudience
~~~

Serializar no body como audience_mode: todos | caixa e recipient_box_code quando houver caixa. A chave de idempotência deve incorporar modo e caixa, mantendo um único envio por endereço normalizado. O body não deve permitir que o operador informe Natureza para escolher destinatários.

- [ ] **Step 2: Alterar o formulário de Comunicado livre.**

Em ClientesComunicacao.tsx, substituir o campo Natureza habilitado para livre por Público: Todos os contatos, Documentação e Operação, Financeiro, Demurrage. Institucional fica em Todos os contatos. A conferência deve mostrar a audiência escolhida e, por cliente, cada destinatário com suas caixas correspondentes. A seleção continua por cliente/linha, nunca por endereço individual.

- [ ] **Step 3: Revalidar a lista antes de disparar.**

Ao clicar em enviar, buscar novamente a conferência com os mesmos filtros, modelo, audiência e supressões. Comparar recipientSnapshot com o snapshot exibido; se houver diferença, limpar confirmação de reenvio, não chamar a Edge Function e mostrar “A lista de destinatários mudou. Confira novamente antes de enviar.” Mesmo com snapshots iguais, a Edge Function deve validar o endereço no último momento.

- [ ] **Step 4: Atualizar o envio real.**

Em send-customer-communication, eliminar a consulta à preferência antiga e conferir pelo RPC/função de autorização da migration:

~~~sql
SELECT public.customer_communication_recipient_allowed(
  p_customer_id,
  p_contact_id,
  p_kind,
  p_audience_mode,
  p_recipient_box_code
);
~~~

O servidor deve confirmar que o e-mail normalizado pertence ao Cliente, está ativo, não está suprimido e, para uma caixa, ainda está vinculado a ela. institutional/livre geral aceita todos os contatos ativos elegíveis; livre por caixa exige o vínculo. A gravação da operação continua em create_customer_communication_atomic e preserva Natureza somente como classificação técnica.

- [ ] **Step 5: Atualizar Financeiro e Demurrage.**

customerFinanceCommunications.ts deve consultar a resolução do modelo ce_mercante_taxas, que alcança Documentação e Operação + Financeiro. demurrageDunning.ts e a Edge demurrage-dunning devem consultar cobranca_demurrage, que alcança Financeiro + Demurrage. Ambos devem deduplicar pelo e-mail normalizado e ignorar customer_contact_preferences.

- [ ] **Step 6: Integrar bounce, desativação e alertas.**

portal-email-webhook.ts deve carregar deactivated_at/origin, identificar o Cliente do endereço normalizado e chamar repair_customer_contact_box_fallbacks para os modelos afetados. portalBounceCascade.ts pode continuar como função pura de decisão de notificação, mas sua decisão deve considerar somente contatos ativos/elegíveis; a persistência do relink e do alerta fica no banco. Atualizar mensagem/metadata para informar a caixa bloqueada quando o principal também falhar.

- [ ] **Step 7: Atualizar testes de caminho completo.**

Substituir fixtures de preferências por fixtures de vínculos a caixas e cobrir:

- todos os contatos para aviso geral;
- D&O/Financeiro sobrepostos sem cópia duplicada;
- Demurrage usando Financeiro + Demurrage;
- livre por uma caixa;
- complaint/bounce com motivo e bloqueio;
- mudança de vínculo após conferência exigindo nova confirmação;
- endpoint rejeitando destinatário que perdeu a caixa entre conferência e envio;
- relink persistente para principal e alerta quando nenhum substituto existe.

Rodar:

~~~powershell
npx vitest run src/services/__tests__/customerCommunications.test.ts src/services/__tests__/customerCommunicationsE2EFlows.test.ts src/services/__tests__/customerFinanceCommunications.test.ts src/services/__tests__/demurrageDunningRead.test.ts src/services/__tests__/sendCustomerCommunicationFunction.test.ts src/services/__tests__/portalBounceCascade.test.ts src/pages/__tests__/ClientesComunicacao.test.tsx --maxWorkers=1 --testTimeout=15000
~~~

Esperado: PASS e rg -n customer_contact_preferences src supabase/functions sem ocorrência em código de produção, apenas em testes/compatibilidade explicitamente documentados.

### Task 9: Regenerar tipos, atualizar provisionamento e documentação viva

**Files:**
- Modify: src/types/database.ts via geração oficial
- Modify: src/services/portalProvisioning.ts
- Modify: src/lib/portalProvisioningViewModel.ts
- Modify: src/components/portal/PortalReviewPanel.tsx
- Modify: src/services/__tests__/portalProvisioning.test.ts
- Create: docs/adr/0064-caixas-de-comunicacao-e-auditoria-de-contatos.md
- Modify: docs/adr/README.md
- Modify: docs/RASTREABILIDADE.md
- Modify: docs/ARCHITECTURE.md
- Modify: CONTEXT.md
- Modify: docs/plans/README.md

- [ ] **Step 1: Regenerar os tipos sem edição manual.**

Com o Postgres local da Task 2 disponível, executar:

~~~powershell
npx supabase gen types typescript --local | Out-File -Encoding utf8 src/types/database.ts
~~~

Conferir que aparecem customer_communication_boxes, customer_communication_box_kinds, customer_contact_box_links, customer_contact_change_events, deactivated_at, origin e as novas RPCs. Se a geração falhar, corrigir schema/ambiente; não acrescentar tipos à mão.

- [ ] **Step 2: Retirar purpose do console de provisionamento.**

Alterar portal_list_provisioning_console e seus tipos/validações para projetar candidatos como { email, origin }, considerando qualquer contato com e-mail normalizado. Atualizar PortalReviewPanel para exibir Contato do Cliente, Capturado do B/L ou Informado no Portal a partir de origin, sem sugerir que purpose decide recebimento. Manter convites, conta e recuperação fora desta configuração.

- [ ] **Step 3: Escrever ADR 0064.**

Registrar status aceito, contexto da simplificação de Natureza/Finalidade para caixas, decisão de catálogo extensível, principal/fallback, precedence de escolha explícita do Cliente sobre captura automática, RPC do Portal, modo Inspeção e evento append-only. Referenciar a ADR 0004/0045 quanto a RLS/RPC e a ADR 0058 quanto à separação do canal de Comunicados. Adicionar a linha ao docs/adr/README.md.

- [ ] **Step 4: Atualizar arquitetura, rastreabilidade e glossário.**

Em docs/ARCHITECTURE.md, substituir a descrição de quatro preferências por contato pelo catálogo de três caixas e mencionar a migration 008, os RPCs, o resolvedor e o fallback. Em docs/RASTREABILIDADE.md, atualizar /portal/perfil, /clientes/:cnpj, customer_contacts, criar linhas para as RPCs novas e para a tabela append-only, e registrar os testes. Em CONTEXT.md, manter a definição final de Caixa de Comunicação, E-mail Capturado do B/L, Natureza do Comunicado técnica e Histórico de Autoatendimento de Contatos agrupado. Não alterar os documentos arquivados.

- [ ] **Step 5: Fechar o plano vivo somente após a implementação.**

Durante a implementação, manter o plano listado em docs/plans/README.md. Depois de todos os gates passarem, mover o plano para docs/archive/plans/, remover sua linha do índice vivo e registrar a entrega no docs/CHANGELOG.md, conforme docs/plans/README.md.

### Task 10: Verificação final, rollout e reversão segura

**Files:**
- Verify: todos os arquivos acima, migration supabase/migrations/008_portal_contact_boxes.sql
- Verify: docs/RASTREABILIDADE.md, docs/ARCHITECTURE.md, docs/adr/0064-caixas-de-comunicacao-e-auditoria-de-contatos.md

- [ ] **Step 1: Rodar a suíte funcional em série.**

~~~powershell
npm run docs:check
npm run typecheck
npm run lint
npm run test -- --maxWorkers=1 --testTimeout=15000
npm run build
git diff --check
~~~

Esperado: cada comando termina com código 0; docs:check não acusa links/estrutura; TypeScript, ESLint, Vitest e build não têm erro; git diff --check não encontra whitespace inválido.

- [ ] **Step 2: Executar o replay de banco descartável e os contratos de segurança.**

~~~powershell
bash scripts/setup-local-pg.sh --reset
npx vitest run src/services/__tests__/issue609ContactBoxesMigration.test.ts src/services/__tests__/portalInspectionMigration.test.ts src/services/__tests__/portalAuthenticatedBoundaryMigration.test.ts --maxWorkers=1 --testTimeout=15000
~~~

Esperado: replay local completo e testes de contrato PASS. Verificar manualmente no banco descartável que:

~~~sql
SELECT code, label FROM public.customer_communication_boxes ORDER BY sort_order;
SELECT box_code, kind FROM public.customer_communication_box_kinds ORDER BY box_code, kind;
SELECT has_table_privilege('authenticated', 'public.customer_contact_change_events', 'INSERT') AS authenticated_can_insert_event;
~~~

O último resultado deve ser false.

- [ ] **Step 3: Testar fluxo ponta a ponta em Preview.**

Após a branch action aplicar a migration no Supabase Preview, usar um Cliente de fixture com um principal e dois adicionais para verificar: salvar Portal, refletir na Ficha, conferir um CE em duas caixas sem duplicação, direcionar livre para Demurrage, desativar endereço e observar relink/alerta, entrar em Inspeção e confirmar somente leitura. Não habilitar envio real em produção para validar este recurso; a base atual não possui e-mails reais de produção.

- [ ] **Step 4: Fazer rollout na ordem segura.**

1. Merge/branch action da migration 008 e confirmar Supabase Preview saudável.
2. Publicar o código que entende schema novo e ainda tolera purpose/preferências antigas.
3. Confirmar docs:check, build, Preview e smoke test de Portal/Ficha/conferência.
4. Somente depois habilitar o fluxo de Comunicados no ambiente operacional.

Não aplicar migration por ferramenta que gere versão remota sem arquivo local; o deploy para produção continua sendo responsabilidade da integração GitHub/Supabase descrita em WORKFLOW.md.

- [ ] **Step 5: Preservar reversão sem migration destrutiva.**

Não remover purpose nem customer_contact_preferences nesta entrega. Se o código precisar ser revertido, o app anterior continuará encontrando as colunas/tabela e as tabelas novas serão inertes. Não executar down migration, git reset --hard, apagar histórico ou reativar automaticamente contatos; uma correção posterior deve ser uma migration forward. Em caso de falha do novo roteamento, desligar o disparo operacional, preservar eventos/snapshots para diagnóstico e corrigir a migration/código em nova revisão.

## Matriz de aceite da issue 609

| ID | Evidência de aceite |
|---|---|
| A1 | /portal/perfil possui uma única seção Contatos e recebimento; não existe segunda tela de contatos. |
| A2 | O Cliente cria/edita/desativa/reativa contatos com nome, e-mail e telefone; o principal é obrigatório. |
| A3 | E-mail normalizado não duplica dentro do Cliente; duplicidade informa o registro existente; Clientes diferentes podem compartilhar endereço. |
| A4 | Cada adicional tem ao menos uma caixa; o principal nasce nas três; retirar principal de uma caixa exige substituto na mesma gravação. |
| A5 | As caixas e pacotes atuais aparecem explicados e são sobrepostos; CE e Taxas e Cobrança de Demurrage resolvem as duas caixas correspondentes sem cópia duplicada. |
| A6 | Avisos gerais alcançam todos os contatos elegíveis; livre pode alcançar todos ou exatamente uma caixa, sem seleção de e-mail individual. |
| A7 | Ficha e conferência mostram os e-mails por caixa, inclusões/exclusões e motivo de supressão. |
| A8 | Alteração posterior à conferência força nova conferência; o envio real revalida caixa, status, supressão e pertencimento ao Cliente. |
| A9 | Captura de B/L adiciona em Documentação e Operação, promove a principal quando necessário, não duplica/não reativa e aparece na Ficha. |
| A10 | Bounce/desativação religa principal elegível e abre alerta quando não há substituto; caixa sem destinatário fica bloqueada. |
| A11 | Cada ação Portal é uma linha agrupada append-only com antes/depois, ator, conta, origem e horário; edição interna e automática também são distinguíveis. |
| A12 | Portal usa RPC com Cliente derivado da sessão; Inspeção é somente leitura; nenhum contato de recuperação/login é alterado pelo fluxo. |

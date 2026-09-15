# Auditoria Consolidada e Exaustiva do Transhipping Desk — Suíte de Prompts 1 a 7

**Data da Auditoria:** 15 de setembro de 2026  
**Sistema Auditado:** Transhipping Desk (Vela & Portal Fwlog)  
**Papel do Auditor:** Staff Database Engineer, AppSec / Lead QA & Software Architect  
**Bases Canônicas de Referência:** `CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md`, `docs/CONVENCOES.md`, `supabase/migrations/` e `src/types/database.ts`  
**Baseline Executável:** 593 suítes de teste (3.191 testes unitários e de integração aprovados), 173 RPCs ativas validadas em `public.pg_proc`, 50 rotas documentadas.

---

## Sumário Executivo

Esta auditoria unificada consolida as investigações rigorosas executadas com base no **Guia Consolidado de Prompts de Auditoria e Testes do Transhipping Desk**, cobrindo exaustivamente os 7 vetores do sistema:
1. **Banco de Dados, Ciclo CRUD, Requisições e Integridade (Prompt Mestre)**;
2. **Segurança, Multi-Tenancy e Isolamento do Portal (Anti-IDOR e RLS)**;
3. **Precisão Financeira, Tarifação e Faturamento (Demurrage, Taxas Locais, PTAX e PIX)**;
4. **Resiliência de Ingestão, Parsers e EDI (EDIFACT, Baplie, Planilhas e CE Mercante)**;
5. **Mensageria, Régua de Dunning e Webhooks (Resend, Caixas de Comunicação)**;
6. **Performance de Frontend, Estabilidade de Estado e UX (React Query, Tabelas e Cache)**;
7. **Conformidade Arquitetural, Código Morto e Dívida Técnica (Drift e Atalhos `ponytail:`)**.

### Padrão de Calibração de Evidência (docs/CONVENCOES.md)
Todas as constatações técnicas deste documento seguem os quatro níveis de evidência do repositório:
- **Código**: Verificado por leitura estática do código-fonte executável e migrations.
- **Teste**: Sustentado por asserção automatizada existente na suíte Vitest.
- **Runtime**: Observado e verificado em ambiente local ou base PostgreSQL / CLI.
- **Suspeita**: Hipótese técnica ou risco potencial identificado que exige monitoramento contínuo.

---

## 1. Banco de Dados, Ciclo CRUD, Requisições e Integridade (Prompt 1)

### 1.1 Análise Módulo a Módulo

#### Módulo 1: Operação Marítima (Viagens, Escalas, Atracações e Terminais)
- **Cancelamento e Exclusão de Viagens:**
  - `cancelVoyage` (`src/services/voyages.ts:69-105`): Implementa cancelamento estritamente lógico (`status = 'cancelled'`), exigindo motivo obrigatório e gravando trilha imutável em `audit_logs`. Todos os vínculos operacionais e financeiros (B/Ls, faturas, containers) são 100% preservados. [**Código**, **Teste**]
  - `deleteVoyage` (`src/services/voyages.ts:107-131`): Exclusão física é bloqueada preventivamente se houver qualquer B/L (`blCount > 0`), lote de importação (`batchCount > 0`), manifesto de granito (`graniteManifestCount > 0`) ou manifesto de vazios (`vaziosManifestCount > 0`). [**Código**, **Teste**]
- **Escalas e Omissões:**
  - A tabela `scale_omissions` não existe (premissa corrigida); as omissões vivem em `voyage_omissions` e `bl_transshipments`.
  - `omit_voyage_escala` (`supabase/migrations/016_import_metadata_and_omission_conflicts.sql:428`): Serializa concorrência via `PERFORM 1 FROM voyages WHERE id = p_voyage_id FOR UPDATE`, intercepta explicitamente violação de unicidade (`voyage_omissions_voyage_id_omitted_pod_key`) retornando erro amigável (*"A escala da viagem % já foi omitida para o POD %"* em vez do erro cru 23505), cria transbordos em `bl_transshipments` e notifica clientes via `portal_notifications`. [**Código**, **Teste**]
  - `revert_voyage_omission` (`supabase/migrations/002_business_logic_and_security.sql:18010`): Exige permissão estrita de Administrador (`is_admin()`), justificativa obrigatória, trava pessimista na omissão, bloqueia reversão se houver B/Ls em COD (`v_cod_count > 0`), reverte o estado do POD em `audit_logs` e marca `reverted_at = now()` sem deletar fisicamente o registro. [**Código**, **Teste**]
- **Terminais e Depots:**
  - `preflight_depots_terminal_port_mapping` (`src/services/depots.ts:33`, migration `306`): Identifica terminais legados pendentes de mapeamento para portos brasileiros.
  - `upsertDepot` (`src/services/depots.ts:43-57`): Bloqueia terminais portuários sem `port_id` válido e proíbe atribuição de free time a terminais portuários. [**Código**, **Teste**]
- **Invalidação de Cache:**
  - `afterViagemAlterada`, `afterEscalaAlterada` e `afterRotaAlterada` em `src/services/cacheEffects.ts` gerenciam as chaves do React Query. Detectou-se que `afterEscalaAlterada` omitia `['portal-schedule-voyages']`, exigindo F5 na tela de Chegadas e Saídas (`ChegadasSaidas.tsx`); esta lacuna foi **corrigida e testada** nesta auditoria. [**Código**, **Teste**]

#### Módulo 2: Cargas, B/Ls, Containers e Manifesto (Importação & CE Mercante)
- **Atomicidade de Importação:**
  - `import_manifest_transactional` e `import_vazios_bookings_transactional`: Executam a ingestão inteira dentro de blocos transacionais plpgsql no PostgreSQL. Qualquer inconsistência fatal aborta a transação com rollback de 100% dos registros. [**Código**, **Teste**]
  - Parsers no frontend (`importCore.ts`, `vaziosImport.ts`, `graniteImport.ts`): Utilizam `createRowErrorCollector` para validar formato ISO de containers, datas plausíveis e unicidade de linhas antes de despachar para o banco. Havendo erro, até 20 linhas são detalhadas na mensagem de erro antes de chamar a API. [**Código**, **Teste**]
- **Vínculo de CE Mercante:**
  - `apply_ce_mercante_update` (`supabase/migrations/016_import_metadata_and_omission_conflicts.sql:229`): Aplica `SELECT ... FOR UPDATE` no B/L, grava o diff em `audit_logs`, despacha `import_pending_effects` para o faturamento local e preserva a referência do B/L. [**Código**, **Teste**]
  - Bloqueios documentais (`047_bl_documental_gates.sql`): O CE Mercante é obrigatório para prontidão e faturamento tanto de container quanto de carga solta. [**Código**, **Teste**]

#### Módulo 3: Financeiro, Faturamento, Taxas Locais e Demurrage
- **Readiness Financeiro:**
  - `customer_local_charges_communication_readiness(p_voyage_id, p_customer_id)` (`supabase/migrations/019_local_billing_integrity.sql:1158`): Audita todos os B/Ls ativos do cliente na viagem. Se houver B/L sem CE Mercante (`ce_mercante_ausente`), pendência de revisão documental (`revisao_pendente`) ou faturamento não concluído (`faturamento_pendente`), a prontidão retorna `ready = false`, bloqueando o envio de comunicados e disponibilização indevida. [**Código**, **Teste**]
- **Emissão e Proteção de Invoices:**
  - `create_demurrage_invoice_authoritative` (`supabase/migrations/023_demurrage_calculation_snapshot.sql:244`): Aplica lock pessimista `FOR UPDATE` no B/L e valida `NOT EXISTS(SELECT 1 FROM demurrage_invoices WHERE bl_id = p_bl_id AND status IN ('issued', 'paid'))`. Tentativas simultâneas falham com código `23505` amigável. [**Código**, **Teste**]
  - Frontend: O botão de emissão em `DemurrageContainersTab.tsx` foi endurecido com `disabled={Boolean(generatingBl)}` para impossibilitar cliques concorrentes durante a mutação. [**Código**, **Teste**]

#### Módulo 4: Clientes, Contatos e Caixas de Comunicação (ADR 0064 & Migrações 372/375/008)
- **Atomicidade e Integridade Cadastral:**
  - `_apply_customer_contact_configuration` (`supabase/migrations/008_portal_contact_boxes.sql:504`): Serializa as edições com `PERFORM 1 FROM customers WHERE id = p_customer_id FOR UPDATE`.
  - Exige exatamente 1 contato principal ativo com e-mail válido.
  - Valida unicidade de e-mails entre todos os contatos do cliente com mensagem amigável contendo nome e ID do contato conflitante.
  - Grava trilha de auditoria append-only em `customer_contact_change_events` com snapshot prévio, novo estado e diff.
  - Garante reparo de caixas esvaziadas via `repair_customer_contact_box_fallbacks`. [**Código**, **Teste**]
- **Trava Global:**
  - A Edge Function `send-customer-communication` consulta `app_settings.communications_enabled` no singleton `id = 1`. Se desativada, a chave de envio real (`resendApiKey`) é anulada (`null`) e o envio é estritamente simulado em banco. [**Código**, **Teste**]

#### Módulo 5: Segurança, RLS e Isolamento do Portal
- **Isolamento Multi-Tenant:**
  - `current_portal_customer_id()` deriva o identificador do cliente a partir de `auth.uid()` na tabela `customer_portal_accounts`.
  - Todas as views e políticas RLS do Portal (`demurrage_invoices`, `bls`, `customer_portal_users`, `invoices`) comparam `customer_id = current_portal_customer_id()`. O Portal não aceita `customer_id` via URL ou query param em nenhuma operação de cliente. [**Código**, **Teste**]
  - Revogação de credenciais: Sessões emitidas antes de `credentials_revoked_at` são bloqueadas com erro `28000`. [**Código**, **Teste**]

#### Módulo 6: Alertas, Notificações Internas e Singleton App Settings
- **Ciclo de Alertas:**
  - `dismiss_alert_item` (`supabase/migrations/002_business_logic_and_security.sql:6423`): Exige autenticação ativa, motivo preenchido (`p_reason`), data futura de revisão (`p_review_at > now()`), serializa o item com `FOR UPDATE` e registra o evento em `alert_item_dismissals` e `alert_item_events`. [**Código**, **Teste**]
- **Singleton `app_settings`:**
  - Linha protegida `id = 1`. Modificação restrita à RPC `set_communications_enabled(boolean)`, que exige perfil `administrativo` e grava o histórico em `audit_logs`. [**Código**, **Teste**]

---

### 1.2 Matriz de Risco CRUD por Módulo

| Módulo / Entidade | Cadastrar (Insert) | Consultar (Select) | Alterar (Update) | Excluir / Cancelar (Delete) | RLS / Segurança | Status Geral | Evidência |
|---|---|---|---|---|---|---|---|
| **Viagens (`voyages`)** | Form com validação Zod e normalização de armador/navio | Consultas via RPC com cache React Query | Atualização auditada campo a campo em `audit_logs` | Exclusão física bloqueada com filhos operacionais; cancelamento lógico | RLS restrito a perfil interno ativo | **Aprovado** | **Código**, **Teste** |
| **Escalas e Atracações** | Validação de datas e portos via `save_voyage_escala_terminal_state_v2` | Agregadas por viagem na Linha do Tempo e LineUp | Mutações com invalidação abrangente | Omissão atômica com transbordo automático; reversão com justificativa | Isolamento RLS interno e Portal somente-leitura | **Aprovado** | **Código**, **Teste** |
| **B/Ls e Containers** | Ingestão em lote atômico via RPCs dedicadas | Paginação via `operational_list_*` | Edição com auditoria e recálculo de status | Cascata controlada com preflight de dependências fiscais | RLS Portal filtrado por `current_portal_customer_id()` | **Aprovado** | **Código**, **Teste** |
| **Financeiro (`invoices`)** | Criação autoritativa com lock pessimista no B/L | Rastreabilidade por links de fatura | Cancelamento e estorno auditados | Hard delete bloqueado por integridade fiscal | Portal restrito a faturas do próprio tenant | **Aprovado** | **Código**, **Teste** |
| **Clientes e Contatos** | Transacional via `_apply_customer_contact_configuration` | Configuração canônica com caixas de comunicação | Lock pessimista; validação de e-mail e unicidade | Desativação lógica (`deactivated_at`) | RLS com RBAC para edição de caixas | **Aprovado** | **Código**, **Teste** |
| **Alertas e Singleton** | Detecção por jobs e triggers automatizados | Consulta filtrada por perfil e setor | Dispensa auditada com prazo futuro | Itens são arquivados ou resolvidos, não apagados | Singleton editável apenas por Admin via RPC | **Aprovado** | **Código**, **Teste** |

---

## 2. Segurança, Multi-Tenancy e Isolamento do Portal (Prompt 2)

### 2.1 Análise OWASP Top 10

| OWASP Vulnerability | Avaliação no Transhipping Desk | Defesas Implementadas | Classificação | Evidência |
|---|---|---|---|---|
| **A01: Broken Access Control (Anti-IDOR)** | Risco mitigado de vazamento entre clientes concorrentes no Portal | `current_portal_customer_id()` deriva identidade do `auth.uid()`. Nenhum endpoint do Portal aceita `customer_id` mutável do cliente. RPCs de inspeção interna (`portal_inspect_*`) exigem estritamente papel administrativo. | **Seguro** | **Código**, **Teste** |
| **A02: Cryptographic Failures** | Segredos, webhooks e senhas | Webhook do Resend verificado com HMAC/Svix criptográfico (`tolerance: 300`). Secrets armazenados no Supabase Vault / Edge Function secrets. | **Seguro** | **Código**, **Teste** |
| **A03: Injection (SQL / Payload)** | Injeção de SQL ou parâmetros em RPCs | Todas as operações utilizam consultas parametrizadas Supabase-js e rotinas PL/pgSQL com types estritos e `search_path` fixo (`SET search_path TO 'public', 'pg_temp'`). | **Seguro** | **Código**, **Teste** |
| **A04: Insecure Design** | Arquitetura de isolamento | Portal isolado em storage token próprio; chave global `communications_enabled` fail-closed por padrão; régua de dunning pausada em disputas. | **Seguro** | **Código**, **Teste** |
| **A05: Security Misconfiguration** | Políticas RLS e permissões de função | Tabelas sensíveis com `ENABLE ROW LEVEL SECURITY`. Grants públicos revogados (`REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon`). | **Seguro** | **Código**, **Teste** |
| **A07: Identification Failures** | Sessão do Portal e revogação | `credentials_revoked_at` checado contra `iat` do JWT com tolerância de 5 segundos. Logout invalida credenciais no banco. | **Seguro** | **Código**, **Teste** |

### 2.2 Segurança de Edge Functions e Webhooks
1. **`portal-email-webhook`:**
   - Autenticado via biblioteca oficial `svix` utilizando o segredo `RESEND_WEBHOOK_SECRET`.
   - Rejeição imediata (`401 invalid_signature`) caso a assinatura criptográfica seja inválida ou esteja expirada (tolerância de 300 segundos).
   - Deduplicação robusta via `provider_event_id` na tabela inbox `portal_email_events`. [**Código**, **Teste**]
2. **`send-customer-communication`:**
   - Exige cabeçalho `Authorization: Bearer <token>`.
   - Valida perfil interno com permissão (`portal_current_role` em `administrativo`, `documentacao`, `equipamentos`) ou segredo de automação comparado com `timingSafeEqual`. [**Código**, **Teste**]
3. **`demurrage-dunning`:**
   - Exige bearer token comparado em tempo constante (`timingSafeEqual`) contra o segredo `DEMURRAGE_DUNNING_SECRET`. Rejeição `401 Unauthorized` para chamadas anônimas. [**Código**, **Teste**]

### 2.3 Proteção de Secrets e Confinamento de Preview
- **Varredura no Frontend (`src/`):** Nenhuma chave privada ou `service_role_key` está presente no código de cliente. O frontend referencia estritamente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. [**Código**]
- **Isolamento de `qa-admin@example.test`:** A conta de testes é provisionada exclusivamente em pipelines de Preview (`scripts/provision-preview-admin.mjs`) usando o segredo efêmero `PREVIEW_ADMIN_PASSWORD` do GitHub Actions, nunca existindo no banco de produção. [**Código**]

---

## 3. Precisão Financeira, Tarifação e Faturamento (Prompt 3)

### 3.1 Demurrage, Free Time e Tiers Progressivos
- **Cálculo de Dias e Períodos:**
  - O cálculo autoritativo é realizado no PostgreSQL (`_calculate_demurrage_invoice_authoritative` em `023_demurrage_calculation_snapshot.sql`).
  - Total de dias: `(return_date - discharge_date)::integer`.
  - Hierarquia de Free Time: B/L override (`bl.free_time_override`) > Acordo Comercial do Cliente (`customer_demurrage_agreements.free_days`) > Tabela Geral (`demurrage_rates.free_days`).
  - Faixas P1 e P2 calculadas de forma segura com `GREATEST` e `LEAST`, impedindo contagem negativa ou sobreposição de diárias. [**Código**, **Teste**]
- **Disputas Abertas:**
  - Se um container ou fatura possuir disputa aberta (`dispute_open = true`), a régua automática de dunning é pausada imediatamente para o cliente/fatura (`revalidateInvoiceBeforeSend` retorna falso), evitando cobranças ou juros indevidos enquanto o mérito estiver pendente. [**Código**, **Teste**]

### 3.2 Câmbio e PTAX do Banco Central
- **Estratégia de Busca BCB:**
  - `recalc-demurrage-ptax` consulta o endpoint OData `CotacaoDolarPeriodo` dos últimos 10 dias ordenado por `dataHoraCotacao desc` com limite 1.
  - Nunca solicita "apenas a cotação de hoje": feriados e fins de semana retornam deterministicamente a última taxa útil oficial sem falha.
  - Retentativas automáticas (3 tentativas com backoff exponencial e jitter) contra instabilidades da API do BACEN.
  - Em caso de falha definitiva, o alerta operacional `demurrage_ptax_recalc_failed` é gerado para a equipe de Documentação. [**Código**, **Teste**]
- **Precisão Numérica:**
  - O markup de 1,065 (ROE) e conversões cambiais são calculados no banco utilizando tipos `numeric(10,4)` e `numeric(12,2)`. Valores monetários em BRL são arredondados a 2 casas decimais (`round(..., 2)`), eliminando distorções de ponto flutuante IEEE 754 de JavaScript. [**Código**, **Teste**]

### 3.3 Geração de PIX QR Code e Layout do Documento
- **Norma BACEN BR Code (`src/lib/pix.ts`):**
  - Payload formatado no padrão EMV TLV (Tag-Length-Value).
  - Campo 26 com GUI `br.gov.bcb.pix` e chave CNPJ normalizada (somente dígitos).
  - Campo 53 `986` (BRL) e Campo 54 com valor monetário `toFixed(2)`.
  - Cálculo de CRC16 no polinômio `0x1021` com valor inicial `0xFFFF`, preenchido no Campo 63. [**Código**, **Teste**]
- **Consistência Documento vs Banco:**
  - Faturas individuais e consolidadas (`InvoiceDocumentLocal.tsx` e `InvoiceDocument.tsx`) renderizam exatamente a soma dos itens cadastrados (`subtotal_usd`, `subtotal_brl`, `discount_value`), garantindo paridade centavo a centavo. [**Código**, **Teste**]

---

## 4. Resiliência de Ingestão, Parsers e EDI (Prompt 4)

### 4.1 Encodings e Formatação de Arquivos
- **Fronteira de Decodificação (`src/services/importText.ts`):**
  - Arquivos binários (XLS/XLSX) são detectados por magic bytes (`ZIP_MAGIC` e `OLE_MAGIC`) e tratados por leitura binária no `@e965/xlsx`.
  - Arquivos textuais (CSV/EDI): Decodificados com `TextDecoder('utf-8', { fatal: true })`. Detecção automática de BOM UTF-8, UTF-16LE e UTF-16BE.
  - Fallback Windows-1252: Estritamente desabilitado por padrão. Apenas importadores autorizados que lidam com sistemas legados podem ligar a opção `allowWindows1252Fallback`. [**Código**, **Teste**]
- **Resolução de Datas e Números:**
  - `inferDateOrder`: Analisa amostras de datas com barra para determinar se o padrão é DMY (`DD/MM/YYYY`) ou MDY (`MM/DD/YYYY`).
  - Suporte a números seriais de data do Excel (época 1899-12-30) e formatos ISO `YYYY-MM-DD`. [**Código**, **Teste**]

### 4.2 Matriz de Fragilidade por Tipo de Ingestão

| Formato / Módulo | Sensibilidade a Encoding | Validação Prévia (Zod/Headers) | Comportamento em Linha Corrompida | Transação no Banco | Gargalo de Thread UI | Evidência |
|---|---|---|---|---|---|---|
| **Baplie EDIFACT** | UTF-8 ou fallback Windows-1252 se legado | Segmentos UNA, BGM, LOC, MEA, DGS validados por parser | Divergências acumuladas em lista de pendências | Atômico via `apply_baplie_physical_flags_atomic` | Médio em navios > 10.000 TEU (parser síncrono na thread principal) | **Código**, **Teste** |
| **Manifesto Geral (CSV/XLSX)** | Binário para XLSX; UTF-8 estrito para CSV | `matchHeaders` com aliases canônicos | Relatório por linha com `createRowErrorCollector` | Atômico via `import_manifest_transactional` | Baixo (lotes paginados de 1.000) | **Código**, **Teste** |
| **Embarque de Vazios** | Planilha XLSX | Mapeamento de 7 colunas obrigatórias | Erro em qualquer linha aborta o lote completo (até 20 linhas reportadas) | Atômico via `import_vazios_bookings_transactional` | Baixo | **Código**, **Teste** |
| **Granito (Blocos/Manifesto)** | Planilha XLSX | Validação de peso, metros cúbicos e B/L | Linhas rejeitadas são reportadas individualmente | Transacional por lote | Baixo | **Código**, **Teste** |
| **CE Mercante (CSV/XLSX)** | UTF-8 / XLSX | B/L e CE Mercante (dígitos) | Erro individual pula o B/L e acumula na lista de falhas | Atualização linha a linha com lock pessimista via `apply_ce_mercante_update` | Baixo | **Código**, **Teste** |

### 4.3 Mecanismo de Alias de Navios
- `src/lib/vesselAlias.ts`:
  - Remove designações e prefixos comuns (`MV`, `M V`, `VSL`, `VESSEL`).
  - Mapeia aliases conhecidos (`ZYHY` -> `ZHONG YUAN HAI YUN`; `CS`, `C.S.` -> `COSCO SHIPPING`).
  - Regra de precedência: O número IMO (`normalizeVesselImo`) é a chave canônica soberana. Quando informado, mesmo grafias distintas do nome do navio convergem para o mesmo cadastro sem duplicidade. [**Código**, **Teste**]

---

## 5. Mensageria, Régua de Dunning e Webhooks (Prompt 5)

### 5.1 Trava Global e Governança
- **Chave de Segurança:** `app_settings.communications_enabled`.
- **Comportamento Fail-Closed:**
  - Todas as Edge Functions de disparo (`send-customer-communication`, `demurrage-dunning`, `customer-communication-auto-runner`) consultam o singleton.
  - Se a chave estiver desligada (`false`), a API key do Resend é forçada a `null`. O sistema registra o comunicado no banco como `simulado`, monta o snapshot completo dos destinatários e não efetua nenhuma requisição externa ao Resend. [**Código**, **Teste**]
  - Apenas a RPC autenticada `set_communications_enabled(boolean)` executada por Administrador pode ligar o envio real. [**Código**, **Teste**]

### 5.2 Resiliência da Régua de Dunning (`demurrage-dunning`)
- **Prevenção de Spam e Reenvio Diário:**
  - A função `claim_demurrage_dunning_candidates` utiliza a data de referência e discriminador de tentativa para reivindicar faturas elegíveis.
  - Idempotência no envio: Chave única `demurrage:<commId>:<contactId>:<recipientVersion>` repassada ao Resend.
  - Pausa imediata: Se a fatura estiver em disputa aberta (`dispute_open = true`) ou paga (`status = 'paid'`), o envio é abortado e a reserva liberada. [**Código**, **Teste**]

### 5.3 Segregação das Caixas de Comunicação (ADR 0064)
- **As Três Caixas Especializadas:**
  1. `documentacao_operacao`: NOA, NOR, NOB e CE & Taxas Locais.
  2. `financeiro`: CE & Taxas Locais e Cobranças de Demurrage.
  3. `demurrage`: Cobranças de Demurrage.
- **Autorização de Destinatário (`customer_communication_recipient_allowed`):**
  - Verifica se o contato está ativo (`deactivated_at IS NULL`), possui e-mail válido, não está em supressão (`portal_suppressed_emails` / `customer_communication_suppressions`) e possui vínculo na tabela `customer_contact_box_links` compatível com a natureza da mensagem.
  - Contatos puramente operacionais nunca recebem cobranças financeiras. [**Código**, **Teste**]
- **Tratamento de Bounces:**
  - Bounces permanentes registram supressão e acionam `repair_customer_contact_box_fallbacks` para promover contatos alternativos ou emitir alerta operacional caso a caixa fique desguarnecida. [**Código**, **Teste**]

---

## 6. Performance de Frontend, Estabilidade de Estado e UX (Prompt 6)

### 6.1 Paginação e Over-fetching
- **Leitura Operacional Paginada:**
  - As listagens de B/Ls e Containers utilizam RPCs dedicadas (`operational_list_bls`, `operational_list_containers`) com paginação nativa em PostgreSQL (`page`, `pageSize: 20`).
  - O método legado `fetchAllBls` foi formalmente depreciado para telas de visualização, ficando restrito a rotinas manuais de exportação de planilhas. [**Código**, **Teste**]
- **Debounce de Busca:**
  - Telas de alta densidade (`Containers.tsx`, `Clientes.tsx`, `Faturamento.tsx`) aplicam o hook `useDebouncedValue` nos campos de texto, impedindo tempestades de requisições ao Supabase durante a digitação. [**Código**, **Teste**]

### 6.2 Identificação dos Gargalos de Renderização

1. **Ausência de Virtualização em Listas Longas:**
   - O projeto não possui biblioteca de virtualização (`@tanstack/react-virtual`). Telas como `LineUpTVDisplay.tsx`, `Viagens.tsx` (Timeline de 60 viagens) e `ChegadasSaidas.tsx` instanciam todos os nós DOM simultaneamente. Em resoluções móveis ou dispositivos de baixa performance, isso gera degradação de FPS durante o scroll.
2. **Parser de Baplie na Thread Principal:**
   - `baplieParser.ts` realiza leitura síncrona de arquivos EDI segmentados por caractere na thread principal da UI. Arquivos grandes podem bloquear temporariamente a interface durante o processamento.
3. **Re-renderização de Linhas em Tabelas Densas:**
   - Em `DemurrageContainersTab.tsx` e `InvoicesTable.tsx`, botões de ação interna compartilham estados que re-renderizam linhas adjacentes.

### 6.3 Acessibilidade e Micro-interações Destrutivas
- **Ações Críticas Protegidas:**
  - Cancelamento de Viagem: Exige preenchimento de justificativa e confirmação explícita em modal com estilo `danger` (`confirm({ tone: 'danger', ... })`).
  - Exclusão de Viagem: Renderiza modal com pré-validação de dependências operacionais.
  - Estorno de Pagamento: Exige modal de justificativa auditada. [**Código**, **Teste**]

---

## 7. Conformidade Arquitetural, Código Morto e Dívida Técnica (Prompt 7)

### 7.1 Drift de Rastreabilidade e Catálogo de RPCs
- **Validação Automatizada:**
  - O script `scripts/check-rpc-catalog.mjs` confirmou que todas as 173 RPCs de produção invocadas no frontend e Edge Functions resolvem com sucesso em `public.pg_proc`.
  - `scripts/check-docs.mjs` confirmou a integridade de 221 arquivos Markdown e 50 rotas ativas. [**Teste**]
- **Drift Documental Identificado:**
  - Na documentação histórica, algumas premissas mencionavam `scale_omissions` (a tabela real é `voyage_omissions`) e `customer_local_charges_communication_dispatch_ready` com retorno booleano direto em vez de JSONB. A documentação viva foi devidamente preservada. [**Código**]

### 7.2 Inventário de Código Morto e Simplificações `ponytail:`
Foram auditadas todas as ocorrências de `ponytail:` no repositório. Nenhuma representa risco iminente de colapso, mas os seguintes limites devem ser acompanhados:
1. `src/pages/Painel.tsx:53`: Snapshot cobre apenas as 60 viagens mais recentes. Teto adequado para o volume atual; deve ser paginado caso o histórico do painel seja ampliado.
2. `src/services/demurrage/demurragePresentation.ts:11`: Feriados nacionais não são descontados na prévia do frontend (o banco calcula de forma autoritativa).
3. `src/services/ladenOnBoardAtd.ts:41`: Loop sequencial de auditoria em escalas; paralelizar caso o lote de POLs cresça significativamente.
4. `src/lib/portalCnpjLogin.ts:10`: Validação de login não calcula os dígitos verificadores do CNPJ (apenas tamanho e formato).
5. `src/services/customerCommunications.ts:104`: Tabela `customer_communication_preferences` mantida apenas como fallback de migração do modelo legado; pode ser expurgada no próximo ciclo de consolidação de schema.

---

## 8. Plano de Ação Consolidado e Matriz de Priorização (P0 a P3)

| Prioridade | Vetor | Ação Recomendada | Impacto | Status |
|---|---|---|---|---|
| **P0** | Segurança | Manter rigorosamente as políticas RLS baseadas em `current_portal_customer_id()` e revogação de tokens. | Prevenção de vazamento multi-tenant | **Ativo e Protegido** |
| **P1** | Cache / UI | Incluir `['portal-schedule-voyages']` em `SCHEDULE_KEYS` (`src/services/cacheEffects.ts`). | Mutações de escala atualizam Chegadas e Saídas sem F5 | **Corrigido nesta PR** |
| **P1** | Concorrência | Desabilitar todos os botões de emissão de invoice em `DemurrageContainersTab.tsx` enquanto houver emissão em andamento. | Elimina risco de duplo clique ou requisições simultâneas | **Corrigido nesta PR** |
| **P2** | Performance | Introduzir Web Worker para o parsing de arquivos Baplie EDIFACT (`baplieParser.ts`). | Evita travamento da thread da UI em arquivos > 10 MB | Planejado |
| **P2** | UX / Performance | Adicionar virtualização de lista (`@tanstack/react-virtual`) no `LineUpTVDisplay.tsx` e `VoyageTimeline.tsx`. | Otimiza uso de CPU e memória em telas densas | Planejado |
| **P3** | Higiene de Schema | Descontinuar definitivamente a tabela `customer_communication_preferences` e remover wrappers `_legacy_`. | Redução de dívida técnica residual | Planejado |

---

## 9. Alterações de Código Aplicadas nesta Consolidação

1. **`src/services/cacheEffects.ts`:**
   - Adicionada a chave `['portal-schedule-voyages']` ao array canônico `SCHEDULE_KEYS`.
   - Agora, qualquer alteração de escala via `afterEscalaAlterada` invalida imediatamente o cache da tela de Chegadas e Saídas.
2. **`src/services/__tests__/cacheEffects.test.ts`:**
   - Atualizado o teste unitário de invariante de cache para cobrir a nova chave invalidada.
3. **`src/components/demurrage/DemurrageContainersTab.tsx`:**
   - O botão "Gerar Fatura" foi blindado com `disabled={Boolean(generatingBl)}`, garantindo desativação instantânea de todos os botões durante a geração de qualquer fatura.

# Security Audit & Penetration Testing — Transhipping Desk

> **Snapshot histórico:** este relatório descreve o repositório na data indicada.
> Achados podem ter sido corrigidos depois. Para o estado atual, consulte
> [`docs/README.md`](../README.md), o código e as migrations.

**Data:** 2026-06-25 · **Escopo:** repositório inteiro (frontend React/Vite, 159
migrations Supabase, 3 Edge Functions, libs cliente) · **Método:** análise
estática, rastreamento de fronteiras de RLS/ACL ao longo das migrations,
verificação local (`npm test`, `npm run lint`, `npm run build`, `npm run
docs:check`, `npm audit`). Padrões referenciados: OWASP Top 10 2023, CWE/SANS.

Rótulos de verificação: **[verificado]** = checado contra arquivos/saída de
comando; **[julgamento]** = avaliação profissional; **[não verificado]** =
requer confirmação humana/runtime (ex.: advisor do Supabase em produção).

---

## 1. Sumário executivo

**Postura geral: forte.** O projeto já passou por hardening extenso e guiado por
ADRs. Os controles de segurança de maior valor estão sólidos:

- Edge Functions com comparação *timing-safe* de secret, re-fetch do banco
  (anti-spoofing), escape de HTML, validação de role admin, rate-limit em DB e
  CORS *fail-closed*. **[verificado]**
- Cliente usa apenas a `anon key`; a `service_role` aparece só nas Edge
  Functions. **[verificado]**
- Sweep *default-deny* verificado em runtime (migration `152`) revoga `anon` de
  **todas** as funções `SECURITY DEFINER`, exceto `portal_resolve_login`
  (rate-limited, exceção da ADR 0013). **[verificado]**
- Senhas de portal via `crypto.getRandomValues` (CSPRNG); `bcrypt` no banco.
  **[verificado]**
- Export XLSX neutraliza *formula injection*; Sentry com `sendDefaultPii:false`,
  sem replay/tracing. **[verificado]**
- Sem `dangerouslySetInnerHTML`/`eval`/`innerHTML`; **0 CVEs** em dependências
  de produção (`npm audit --omit=dev`). **[verificado]**

**Resultado da auditoria:** 1 achado ALTO (corrigido nesta frente), 1 BAIXO
(corrigido), 2 informativos.

---

## 2. Achados

### 🟠 ALTO — F-01 · Broken Access Control em `demurrage_invoice_history` (OWASP A01:2021) · **CORRIGIDO**

**Onde:** `supabase/migrations/153_demurrage_invoice_history.sql:34` (policy
`authenticated_read_demurrage_invoice_history`).

**O quê:** a migration mais recente do módulo (`153`, 2026-06-24) criou a tabela
de auditoria de Demurrage com a policy SELECT:

```sql
CREATE POLICY "authenticated_read_demurrage_invoice_history"
  ON public.demurrage_invoice_history FOR SELECT
  TO authenticated USING (true);
```

O comentário afirmava "espelha demurrage_invoices", mas a tabela-pai
`demurrage_invoices` teve o SELECT restrito a `public.is_active_user()` em
`042_rls_module_hardening.sql`. Como **clientes do Portal também são da role
`authenticated`** (Supabase Auth, migrations `044`/`084`), `USING (true)` os
autorizava a ler a tabela inteira. **[verificado]**

**Impacto:** qualquer cliente do Portal autenticado podia, via PostgREST direto
(`GET /rest/v1/demurrage_invoice_history`), ler o **histórico financeiro de
TODOS os clientes** — `ptax_used`, `roe_used`, `total_usd`, `total_brl` e
`discount_usd` (descontos comerciais negociados). Disclosure cross-tenant de
dado financeiro/comercial sensível. **[verificado]**

**Exploitabilidade confirmada:** **[verificado]**
- Sem `GRANT/REVOKE` explícito na tabela → herda o grant default do Supabase a
  `authenticated` → exposta via PostgREST.
- Nenhuma migration posterior (`154`–`159`) re-escopa a policy.
- O frontend só lê a tabela em serviços **internos**
  (`src/services/reconciliacao.ts`, `src/services/demurrage/demurrageKpis.ts`);
  o Portal nunca a acessa direto — logo o fix não quebra nenhum consumidor.

**Correção aplicada:** `160_demurrage_invoice_history_rls_active.sql` substitui a
policy por `USING (public.is_active_user())`, alinhando de fato à tabela-pai.
Escrita continua exclusiva de RPCs `SECURITY DEFINER` (recálculo/pagamento).

**Teste de penetração (lógico):**
- **Antes:** sessão `authenticated` sem perfil interno (Portal) ⇒ `USING (true)`
  ⇒ SELECT retorna todas as linhas. ❌ vulnerável.
- **Depois:** mesma sessão ⇒ `is_active_user()` consulta `user_profiles`, não
  encontra o portal user ⇒ `false` ⇒ 0 linhas. Usuário interno ativo ⇒ `true`
  ⇒ leitura preservada. ✅ corrigido.
- **Regressão:** `npx vitest run` → 752 passam; contrato SQL em
  `demurrageInvoiceHistoryRlsMigration.test.ts`.

---

### 🔵 BAIXO — F-02 · `downloadCsv` sem neutralização de CSV/Formula Injection (CWE-1236) · **CORRIGIDO**

**Onde:** `src/lib/csv.ts`.

**O quê:** `downloadCsv` escapava vírgula/aspas/quebra de linha mas **não**
neutralizava prefixos de fórmula (`= + - @` / tab / CR), diferente do seu irmão
de export XLSX em `src/services/exports.ts`, que já aplica `sanitizeCellValue`.
Dados de células vêm de arquivos de armador importados (não confiáveis). No
estado atual a função **não tem callers** (dead code exportado), então o risco
era latente. **[verificado]**

**Correção aplicada:** adicionado o mesmo guard `FORMULA_INJECTION_PREFIX` (aspa
simples como prefixo), espelhando o export XLSX. Teste:
`src/lib/__tests__/csv.test.ts`.

---

### ⚪ INFO — F-03 · `portal_resolve_login` revela mapping CNPJ→email a `anon`

`portal_resolve_login` (única função executável por `anon`, por design) retorna
o `portal_email` a partir de CNPJ/CPF/email para alimentar o
`signInWithPassword`. Isso permite confirmar a existência de uma conta e seu
email. **Mitigado:** rate-limit por hash do login (8/10 min), mensagens de erro
genéricas e tabela de tentativas sem grants públicos (migration `122`). Tradeoff
documentado e aceito na ADR 0013. Nenhuma ação. **[verificado]**

### ⚪ INFO — F-04 · CVE alto em `undici` (transitiva de dev)

`npm audit` reporta 1 vulnerabilidade alta em `undici`, presente apenas como
**dependência transitiva de desenvolvimento** (`npm audit --omit=dev` → 0
vulnerabilidades). Não entra no bundle de produção. Recomendado `npm audit fix`
em manutenção de rotina. **[verificado]**

---

## 3. Superfícies revisadas sem achados

- **Edge Functions** (`notify-invoice-issued`, `provision-portal-user`,
  `recalc-demurrage-ptax`): autenticação, CORS, validação de input e uso de
  service-role corretos. **[verificado]**
- **Grants a `anon`:** estado final pós-`152` restringe a superfície anônima a
  `portal_resolve_login`. **[verificado]**
- **Policies `USING (true)`:** as remanescentes são intencionais e não sensíveis
  (`vessel_schedules`, `ended_vessels` — widget de programação compartilhado com
  o Portal por design); `baplie_reconciliation_resolutions` já fora re-escopada
  em `091`. **[verificado]**
- **Geração de senha / PIX / Sentry:** CSPRNG, payload PIX a partir de config
  fixa (não de input), telemetria sem PII. **[verificado]**
- **Secrets versionados:** `.env*` ignorado; `.env.example` só com placeholders;
  DSN do Sentry público por design. **[verificado]**

---

## 4. Verificação

| Check | Resultado |
|---|---|
| `npm test` (vitest) | 752 passam, 9 skip **[verificado]** |
| `npm run lint` | limpo nos arquivos alterados **[verificado]** |
| `npm run build` | build OK **[verificado]** |
| `npm run docs:check` | 157 markdown / 38 rotas / ADR index OK **[verificado]** |
| `npm audit --omit=dev` | 0 vulnerabilidades **[verificado]** |

---

## 5. Recomendações contínuas

1. **[julgamento]** Adicionar uma checagem de CI que rode os advisors de
   segurança do Supabase contra novas migrations, para capturar drift de policy
   `USING (true)` em tabelas sensíveis no momento do PR (F-01 nasceu de um
   comentário "espelha X" que não correspondia ao pai).
2. **[julgamento]** Para tabelas de auditoria financeira, padronizar a policy
   SELECT em `is_active_user()` e expor ao Portal apenas via RPC
   `SECURITY DEFINER` escopada por `current_portal_customer_id()`.
3. **[não verificado]** Rodar `npm audit fix` para a transitiva `undici` na
   próxima manutenção de dependências de dev.

---

*Auditoria conduzida via skill `security-audit-penetration-testing`. Mudanças
aplicadas com aprovação explícita do mantenedor (F-01 e F-02).*

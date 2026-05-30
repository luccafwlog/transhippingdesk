# Auditoria Completa — Transhipping Desk

**Data:** 2026-05-30
**Escopo:** Arquitetura, Segurança, Performance, UX/UI, Qualidade, Fluxos.
**Método:** Mapeamento do sistema + revisão profunda assistida por exploração
paralela (segurança, arquitetura, frontend) + verificação manual das alegações.
**Baseline de saúde:** `npm run build` ✅ · `npm test` ✅ (94 passam, 9 skip) ·
`npm run lint` ✅ (3 warnings menores) · `npm audit` → 2 vulns (1 high, 1 moderate).

---

## 1. Resumo executivo

O Transhipping Desk é uma aplicação **madura e bem cuidada**, já submetida a
várias rodadas de *hardening* de segurança (migrations 053 e série
20260530102906‑09; commits #130/#131). A separação service/hook/page é
consistente, o cache (React Query) é centralizado, o lazy loading é correto e a
camada de segurança é **RLS-first** com Edge Functions endurecidas (auth
*timing-safe*, escaping de HTML, re-fetch do banco, rate limiting persistido).

A auditoria **não encontrou vulnerabilidades críticas em aberto**. A alegação
mais grave levantada na varredura (RLS permissiva `USING(true)` em
`demurrage_invoices`) foi **verificada e refutada**: a migration `042` já
substituiu essas políticas por leitura `is_active_user()` e escrita `is_admin()`.

O principal débito não é segurança e sim **manutenibilidade**: cinco
páginas-monólito (900–2140 linhas) concentram estado e responsabilidades demais,
e os fluxos financeiros têm cobertura de testes parcial.

**Correções aplicadas nesta auditoria (baixo risco, verificadas):**
1. Sanitização contra **injeção de fórmula (CSV/Excel injection)** em todas as
   exportações de planilha.
2. **Escaping consistente de curingas LIKE / sintaxe PostgREST** em todos os
   filtros de busca que interpolam input do usuário (helper centralizado).
3. Novo teste unitário cobrindo o helper de escaping.

Tudo validado com `tsc -b` + suíte de testes (continua verde).

---

## 2. Problemas encontrados

### Segurança
| # | Sev. | Problema | Local | Situação |
|---|------|----------|-------|----------|
| S1 | ~~Crítico~~ → **N/A** | RLS `USING(true)` em `demurrage_invoices`/`_items` | `028_demurrage_module.sql:131-157` | **Falso positivo** — já corrigido por `042_rls_module_hardening.sql` (read `is_active_user()`, write `is_admin()`). |
| S2 | **Alto → corrigido** | Input de busca sem escaping de curingas LIKE/sintaxe `.or()` (enumeração/DoS/filtro) | `billing.ts`, `chargeOperationsService.ts` (×2), `chargeRateService.ts`, `useCustomers.ts`, `vaziosImportacaoImport.ts` | **Corrigido** (ver §3). |
| S3 | **Médio → corrigido** | Injeção de fórmula em exportações XLSX (dados de armador não confiáveis) | `services/exports.ts` | **Corrigido** (ver §3). |
| S4 | Médio | CORS em `provision-portal-user` depende de `APP_URL`/`SUPABASE_URL` corretos; sem validação explícita de origem | `functions/provision-portal-user/index.ts:18-24` | Recomendado (§4). A função já exige caller admin ativo + rate limit, então o risco residual é baixo. |
| S5 | Médio | Regex de email permissiva (`a@b.c`) | `provision-portal-user/index.ts:13` | Recomendado (§4). |
| S6 | Médio | Enumeração residual por timing no login do portal (mensagens/latência distintas) | `PortalLogin.tsx:30-36` | Recomendado (§4). Mitigado por rate limit (10/15min). |
| S7 | Baixo | Token legacy do portal em `sessionStorage` (exposto a XSS se houver outra falha) | `usePortalAuth.tsx` | Recomendado: limpar no logout, não cair no fallback se Supabase Auth ativo. |
| S8 | Baixo | Sem *bounds* em `pageSize`/`from` (DoS por paginação enorme) | `vaziosImportacaoImport.ts:236` | Recomendado: validar limites. |

> Verificações que passaram: sem segredos commitados (`.env` ignorado, `.mcp.json`
> limpo); CSP forte sem `unsafe-inline` em scripts; headers de segurança
> completos no `firebase.json`; webhook de email com auth *timing-safe* e HTML
> escapado; sem `dangerouslySetInnerHTML`/`eval`; `xlsx`/`jspdf` por import dinâmico.

### Arquitetura / Qualidade
| # | Sev. | Problema | Local |
|---|------|----------|-------|
| A1 | Alto | Páginas-monólito com 40+ `useState` e múltiplas responsabilidades | `Viagens.tsx` (2140), `BlDetalhe.tsx` (1500), `TaxasLocais.tsx` (1125), `Faturamento.tsx` (1024), `Revisao.tsx` (969) |
| A2 | Médio | ~8 parsers de import compartilham ~400 linhas de boilerplate (validar header → iterar → persistir → {created,updated,errors}) | `services/*Import.ts` |
| A3 | Médio | Formatação de moeda duplicada em 4 lugares | `lib/utils.ts:formatBRL` vs inline em modal/breakbulk/invoicePdf |
| A4 | Médio | Tratamento de erro inconsistente: alguns services logam e seguem (best-effort) em vez de lançar | `billing.ts:persistPixPayload`, `alerts.ts`, `operationalEvents.ts`, `demurrage/demurrageKpis.ts` (catch silencioso) |
| A5 | Baixo | `cargo_profile` como union de string com `'any'` em vez de enum dedicado | `types/database.ts` |
| A6 | Baixo | Invalidações de cache pontualmente amplas (ex.: `customers.detail()` sem id) | `hooks/useBilling.ts` |

### Performance
| # | Sev. | Problema | Local |
|---|------|----------|-------|
| P1 | Médio | Tabela de pendências renderiza ~1200 linhas sem virtualização | `Faturamento.tsx:696,762-805` |
| P2 | Baixo | `vite.config.ts` sem `manualChunks` (vendors estáveis não isolados p/ cache) | `vite.config.ts` |

> Pontos fortes: lazy loading por rota correto; `xlsx`/`jspdf` dinâmicos;
> paginação em Containers; memoização adequada em Viagens.

### UX / Acessibilidade
| # | Sev. | Problema | Local |
|---|------|----------|-------|
| U1 | Baixo | Botões/links ad-hoc estilizados inline em vez do primitivo `Button` | `TaxasLocais.tsx:760`, `Demurrage.tsx:378`, `Containers.tsx:174` |
| U2 | Baixo | Status por cor com texto fraco em resumo de import | `Manifestos.tsx:695` |

> Verificado: `Toast` usado de forma consistente; `Modal` com focus-trap e
> `aria-label`; tabelas com scroll horizontal responsivo; **focus styles JÁ
> existem** em `index.css` (`.app-input:focus`, `.app-btn:focus-visible`) —
> alegação de "focus ausente" foi refutada.

### Cobertura de testes
| # | Sev. | Lacuna |
|---|------|--------|
| T1 | Alto | `services/billing.ts` e `services/demurrage/*` sem testes unitários |
| T2 | Médio | Páginas-monólito (`Viagens`, `BlDetalhe`, `Revisao`) sem testes |
| T3 | Médio | `useAuth`/`usePortalAuth` sem testes |

> Bem testado: parsers de import (manifesto/breakbulk/CE/veículos com fixtures
> reais), taxas locais, reconciliação, reports, migrations de ledger.

### Dependências (`npm audit`)
- **`xlsx` (high)** — Prototype Pollution + ReDoS no SheetJS; **sem correção no
  npm**. A correção upstream exige instalar do CDN da SheetJS. Mitigação atual: o
  parsing roda sobre arquivos enviados por usuários internos autenticados.
- **`ws` (moderate)** — transitiva de dev (toolchain); `npm audit fix` resolve.

---

## 3. Melhorias implementadas (nesta auditoria)

Todas cirúrgicas, verificadas com `tsc -b` + `npm test` (verde).

1. **Anti-injeção de fórmula nas exportações XLSX** — `src/services/exports.ts`.
   Novo helper `toSheet()`/`sanitizeCellValue()` prefixa com `'` qualquer célula
   string iniciada por `= + - @` ou tab/CR antes de gerar a planilha. Aplicado às
   8 funções de export. **Motivo:** os dados vêm de arquivos de armador
   importados (não confiáveis) e abrem no Excel/Sheets do usuário.

2. **Escaping centralizado de filtros PostgREST** — novo `escapeFilterTerm()` em
   `src/lib/utils.ts` (remove `% _ , . ( ) : * " \`). Aplicado a todos os sites
   que interpolavam input de usuário em `.or()/.ilike()`:
   - `services/billing.ts` (busca de invoice)
   - `services/charges/chargeOperationsService.ts` (2 buscas)
   - `services/charges/chargeRateService.ts` (busca de cliente)
   - `hooks/useCustomers.ts` (lookup de cliente)
   - `services/vaziosImportacaoImport.ts` (substitui escaping parcial)
   - `hooks/useBls.ts` — removida a cópia local privada, agora usa o helper
     compartilhado (deduplicação).
   **Motivo:** prevenir enumeração via curinga `_`, DoS por `%` (full scan) e
   quebra de sintaxe do parser de filtros.

3. **Teste unitário** — `src/lib/__tests__/escapeFilterTerm.test.ts` (4 casos)
   travando o comportamento de escaping.

4. **Documentação** — criado `WORKFLOW.md` (referência completa do sistema) e
   este relatório.

---

## 4. Melhorias recomendadas (não implementadas — exigem decisão/risco maior)

**Segurança (baixo esforço, recomendado priorizar)**
- **S4** Validar origem explicitamente em `provision-portal-user` e falhar se
  `ALLOWED_ORIGIN` vier vazio na inicialização.
- **S5** Endurecer a regex de email (subset RFC 5322).
- **S6** Unificar status HTTP e latência no login do portal (sempre executar o
  `crypt()` completo mesmo com CNPJ inexistente) para eliminar enumeração por timing.
- **S7/S8** Limpar token legacy no logout do portal; validar *bounds* de paginação.

**Arquitetura / Qualidade (esforço médio/alto)**
- **A1** Decompor as páginas-monólito (extrair modais e seções de tabela em
  componentes). Maior ganho: `Viagens.tsx` e `BlDetalhe.tsx`.
- **A2** Extrair um helper comum de import (validação de header + iteração +
  relatório de erros) reutilizado pelos parsers.
- **A3** Unificar formatação de moeda em `formatBRL`.
- **A4** Padronizar tratamento de erro; onde o "best-effort" for intencional,
  documentar explicitamente e, no mínimo, registrar telemetria.

**Performance / UX (baixo esforço)**
- **P1** Virtualizar ou paginar a tabela de pendências do Faturamento.
- **P2** Adicionar `manualChunks` conservador no Vite (react, supabase).
- **U1/U2** Migrar botões ad-hoc para `Button`; reforçar contraste de status.

**Dependências**
- Migrar `xlsx` para a distribuição oficial da SheetJS (CDN) para sair da versão
  vulnerável do npm; rodar `npm audit fix` para `ws`.

**Testes**
- **T1/T2/T3** Cobrir billing, demurrage, e os fluxos de auth/portal.

---

## 5. Riscos identificados

| Risco | Impacto | Probabilidade | Mitigação atual |
|-------|---------|---------------|-----------------|
| Parser incompatível com novo layout de armador | Médio | Média | Parser isolado + fixtures de regressão |
| Cobertura parcial em billing/demurrage | Médio | Média | Suíte de integração + validação operacional manual |
| `xlsx` vulnerável sem patch no npm | Médio | Baixa | Entrada apenas de usuários internos autenticados |
| Escritas best-effort mascararem falhas (PIX/alertas) | Médio | Baixa | — (recomenda-se telemetria) |
| Páginas-monólito dificultam manutenção/regressão | Médio | Alta | — (recomenda-se decomposição) |
| Autorização real depende 100% de RLS (UI não é fronteira) | Baixo | Baixa | RLS auditada + helpers `is_admin/is_active_user` |

---

## 6. Débitos técnicos

1. **Páginas-monólito** (`Viagens`, `BlDetalhe`, `TaxasLocais`, `Faturamento`,
   `Revisao`) — 900–2140 linhas, estado excessivo.
2. **Boilerplate de import duplicado** entre ~8 services.
3. **Formatação de moeda** em 4 implementações distintas.
4. **Tratamento de erro inconsistente** (throw vs log silencioso).
5. **Lacunas de teste** em fluxos financeiros e de autenticação.
6. **`xlsx` vulnerável** preso à versão do npm.
7. **`cargo_profile`** modelado como string union com `'any'` em vez de enum.
8. **3 warnings de lint** (`exhaustive-deps`) em `LineUpTVDisplay.tsx`.

---

## Anexo — Decisões tomadas durante a auditoria

- **Não** criei migration nova para `demurrage_invoices`: verifiquei que a RLS
  já está endurecida (042). Criar seria redundante e arriscado em produção.
- **Não** alterei o comportamento "best-effort" de `persistPixPayload`/`alerts`:
  mudar para `throw` poderia quebrar fluxos de produção que dependem da
  tolerância a falha; documentei como recomendação.
- **Não** mexi em `src/types/database.ts`, RLS, nem `src/lib/pix.ts` (proibido
  sem contexto explícito por `CLAUDE.md`).
- **Não** apliquei `npm audit fix` para evitar churn de lockfile sem validação;
  deixei como recomendação.
- **Limitei** as correções de código a hardening verificável e sem efeito
  colateral funcional (escaping de filtro e de planilha), com teste cobrindo.

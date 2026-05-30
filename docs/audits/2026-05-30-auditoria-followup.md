# Auditoria — Follow-up (implementação das recomendações)

**Data:** 2026-05-30 (segunda rodada)
**Base:** `docs/audits/2026-05-30-auditoria-completa.md`
**Objetivo:** avançar em **todas** as recomendações do relatório de auditoria.

Cada item abaixo tem disposição explícita: **Implementado** (com verificação) ou
**Avaliado e adiado** (com justificativa de risco). Tudo validado com
`tsc -b` + `npm test` (130 testes, 121 passam / 9 skip) + `npm run lint`
(sem novos warnings) + `npm run build`.

---

## Implementado nesta rodada

### Segurança
| Item | O que foi feito | Arquivo |
|---|---|---|
| **S4** CORS/origem no edge function | Validação explícita de `Origin` (fail-closed): requisições de browser de outra origem recebem 403; server-to-server (sem Origin) seguem permitidas | `supabase/functions/provision-portal-user/index.ts` |
| **S5** Regex de email fraca | Subset prático de RFC 5322 (rejeita `a@b.c`, `user@.com`, TLD < 2) | `provision-portal-user/index.ts` |
| **S7** Token legado do portal | Limpa qualquer token legado do `sessionStorage` quando há sessão Supabase Auth ativa na hidratação (reduz superfície a XSS) | `src/hooks/usePortalAuth.tsx` |
| **S8** Sem bounds de paginação | `pageSize` limitado a [1, 200] e `page` ≥ 1 (evita DoS por alocação) | `src/services/vaziosImportacaoImport.ts` |
| **S2** (extensão) Escaping de `.ilike()` | Novo `sanitizeLikeTerm()` (neutraliza curingas `% _ \`) aplicado a todos os `.ilike()` com input do usuário: busca de invoice/BL/POD/voyage (sugestões + filtros), POD em charges, chassis em veículos | `src/lib/utils.ts`, `billing.ts`, `charges/*`, `useVehicles.ts` |

> **S6** (enumeração por timing no login do portal): **já mitigado**. O frontend
> já colapsa todos os erros não-rate-limit numa mensagem genérica
> ("Credenciais inválidas") e a RPC `portal_login` (migration 040) já executa
> `crypt()` completo mesmo para CNPJ inexistente. Sem mudança necessária.

### Qualidade / Arquitetura
| Item | O que foi feito | Arquivo |
|---|---|---|
| **A3** Formatação de moeda duplicada | `formatUSD` centralizado em `lib/utils.ts`; removidas 4 cópias locais idênticas | `Faturamento.tsx`, `TaxasLocais.tsx`, `BlDetalhe.tsx`, `ValidacaoTab.tsx` |

### Performance
| Item | O que foi feito | Arquivo |
|---|---|---|
| **P2** Sem `manualChunks` | Vendors estáveis isolados em `vendor-react` e `vendor-data`; chunk principal caiu de ~220 kB para ~30 kB (melhora cache entre deploys) | `vite.config.ts` |

### Dependências
| Item | O que foi feito |
|---|---|
| **`ws` (moderate)** | `npm audit fix` → `ws@8.21.0` (patch). `package.json` intacto, sem churn de Supabase. Resta apenas `xlsx` (high, sem correção no npm). |

### Testes (cobertura de áreas críticas)
| Novo arquivo | Cobre |
|---|---|
| `src/services/demurrage/__tests__/calculateDemurrage.test.ts` | Cálculo financeiro de demurrage: free time, períodos 1/2, tabelas por tipo, reefer, overrides de free/tarifa, datas inválidas (10 casos) |
| `src/pages/__tests__/faturamentoInvoiceStatus.test.ts` | Agrupamento dos 8 status reais em 3 estados (label, tone, opções de filtro) |
| `src/services/__tests__/billingHelpers.test.ts` | `getInvoiceBls`, `isConsolidatedInvoice`, `getInvoicePaymentDate` |
| `src/lib/__tests__/escapeFilterTerm.test.ts` (estendido) | `sanitizeLikeTerm` |

---

## Avaliado e deliberadamente adiado (com justificativa)

> Princípio (CLAUDE.md): mudanças cirúrgicas, sem refatorar o que não está
> quebrado, sem abstrações especulativas. Os itens abaixo são reais, mas exigem
> PRs dedicados com *scaffolding* de teste antes de mexer — fazê-los "de
> arrastão" sobre páginas de produção **sem cobertura de testes** introduziria
> mais risco do que valor.

| Item | Por que adiar | Pré-requisito para fazer com segurança |
|---|---|---|
| **A1** Decompor páginas-monólito (`Viagens` 2140, `BlDetalhe` 1500, etc.) | As 5 páginas têm **zero testes**; mover estado/efeitos pode causar regressões sutis invisíveis ao build | Primeiro criar testes de componente (RTL) que travem o comportamento atual; depois extrair em PRs pequenos |
| **A2** Helper comum dos parsers de import | A estrutura é *parecida*, não idêntica; uma abstração forçada seria a abstração errada (anti-padrão). Parsers têm testes, mas o ganho é incerto | Definir o contrato comum real (validação de header + relatório de erros) e migrar 1 parser por vez sob os fixtures existentes |
| **A4** Padronizar `throw` vs log silencioso | Escritas best-effort (alertas, eventos, PIX payload) hoje **não bloqueiam** a operação principal; transformá-las em `throw` mudaria semântica de produção e poderia travar fluxos | Mapear, por call-site, se a falha deve ou não abortar; adicionar telemetria antes de mudar o comportamento |
| **P1** Virtualizar tabela de pendências (~1200 linhas) | Exige nova dependência (`react-window`) + reescrita da tabela; risco médio sem teste de página | Adicionar a dep, virtualizar e validar scroll/seleção manualmente |
| **U1** Botões "ad-hoc" → primitivo `Button` | **Falso positivo**: os casos sinalizados são padrões intencionais — `app-table__icon-button` (classe dedicada com `aria-label`), abas, e um `<Link>` estilizado. Forçá-los no `Button` seria regressão visual | — (sem ação; manter o padrão existente) |
| **Lint** 3 warnings `exhaustive-deps` em `LineUpTVDisplay` | Omissão de `isMobile` é intencional (evita re-execução do efeito na tela de TV); "corrigir" pode causar re-render indesejado | Refator dedicado da lógica de resize com teste visual |
| **`xlsx` (high)** | Sem correção no registro npm | Migrar para a distribuição oficial da SheetJS (CDN) em PR próprio + validar todos os parsers |

---

## Resumo

- **Implementadas** todas as recomendações de **baixo risco e alto valor**:
  segurança (S2/S4/S5/S7/S8), dedup de moeda (A3), bundling (P2), dependência
  `ws`, e **cobertura de testes** em áreas financeiras críticas (demurrage,
  faturamento).
- **Adiados, com plano**, os refactors estruturais de maior risco (A1/A2/A4/P1),
  que devem ser feitos em PRs dedicados precedidos de testes — exatamente para
  não violar as diretrizes do projeto de mudanças cirúrgicas e seguras.

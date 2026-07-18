# Provisionamento do Portal do Cliente — Roadmap dos Planos de Implementação

> **For agentic workers:** Este é o documento-índice. NÃO é um plano executável.
> Execute os planos numerados na ordem abaixo, cada um com
> superpowers:subagent-driven-development ou superpowers:executing-plans.

**Fonte de verdade:** [Issue #370](https://github.com/luccafwlog/transhippingdesk/issues/370)
(ticket-mapa, label `wayfinder:map`) e `CONTEXT.md` (seção Portal do Cliente).
Antes de executar qualquer plano, leia ambos. Vocabulário do domínio é obrigatório.

**Objetivo geral:** operacionalizar o provisionamento do Portal do Cliente para o
GO LIVE: identidade por CNPJ, convites manuais de uso único, email transacional
via Resend, console operacional, desacoplamento financeiro e RBAC mínimo.

## Ordem de execução e dependências

| # | Plano | Depende de | Entrega |
|---|-------|------------|---------|
| 1 | `...-01-schema-maquina-estados.md` | — | Tabelas, máquina de estados, RPCs, pré-voo e backfill dos 309 |
| 2 | `...-02-rbac-portal.md` | — (paralelo ao 1) | Matriz `can()` corrigida + permissões de Portal |
| 3 | `...-03-login-identidade.md` | 1 | Edge Function de login CNPJ→identidade técnica; fim da resolução no cliente |
| 4 | `...-04-email-transacional.md` | 1 | Módulo Resend, templates, retries, webhook assinado, supressão |
| 5 | `...-05-convites-ativacao.md` | 1, 3, 4 | Envio/reenvio/cancelamento de convite, tela de ativação, recuperação de senha, troca de email, suspensão |
| 6 | `...-06-desacoplamento-alertas.md` | 1 | Portal fora do gate de revisão/faturamento; alertas preventivos/críticos; resumo diário |
| 7 | `...-07-console-operacional.md` | 1, 2, 5, 6 | Rota `/clientes/portal`, fila, painel lateral, seção da ficha |

Planos 1 e 2 podem rodar em paralelo. O restante é sequencial conforme a coluna
"Depende de".

## O que NÃO está nestes planos (deliberado)

- **Execução do piloto, runbook, evidências de teste e GO LIVE operacional** —
  são etapas operacionais do mapa (#370), não código. Os gates de segurança do
  piloto (isolamento por CNPJ, replay de token, webhook, anti-enumeração,
  recuperação assistida, inspeção de logs) têm testes automatizados criados nos
  planos 3–6; a execução com evidência registrada é tarefa do piloto.
- **Auditoria RBAC global** (88 usos de `isAdmin` em 27 arquivos) — o plano 2
  cobre somente o recorte mínimo do Portal decidido no mapa. O restante é frente
  separada, conforme decisão do issue.
- **Investigação da cota Supabase (carência 18/07/2026)** — risco independente,
  tratar fora destes planos e ANTES do GO LIVE.
- **Domínio próprio/DNS/registro** — decisão de produto pendente
  (`Not yet specified` no mapa); gate do piloto, não do desenvolvimento.
  Todo envio real fica bloqueado até o domínio estar verificado no Resend.

## Regras transversais (valem para todos os planos)

- Branch de trabalho: `claude/new-session-xnnt9n`. Commits frequentes, mensagens descritivas.
- Migrations novas seguem a skill `supabase-migration`; numeração contínua a
  partir de `178_`. **Nunca** editar migrations existentes (`001`–`177`) nem
  `src/types/database.ts` à mão (arquivo protegido — regenerar via fluxo da skill).
- Hooks/serviços seguem a skill `react-query-pattern`.
- `service_role` e chave Resend existem apenas em Edge Functions/segredos;
  nunca no cliente, em logs ou em auditoria.
- Senhas e tokens brutos nunca são persistidos nem logados; tokens só por hash;
  emails mascarados quando exibidos em alertas/auditoria.
- Documentação viva na mesma mudança: `docs/ARCHITECTURE.md`,
  `docs/RASTREABILIDADE.md`, `docs/modules/portal-cliente.md`, `WORKFLOW.md` e
  `CONTEXT.md` quando o comportamento descrito mudar. Rodar `npm run docs:check`.
- Verificação final de cada plano: `npm run lint`, `npm test`, `npm run build`,
  `npm run docs:check`.
- Nada de envio real de email em desenvolvimento: `RESEND_API_KEY` ausente ⇒
  módulo de email opera em modo dry-run logando metadados (nunca o token).

## Estado herdado relevante (medido em 2026-07-13)

- `customer_portal_accounts` já existe (025/044/115): `customer_id UNIQUE`,
  `contact_email`, `password_hash` (legado, não usar), `active`,
  `auth_user_id`, `login_cnpj`.
- `portal_resolve_login` é executável por `anon` e devolve o email técnico ao
  navegador — será substituído (plano 3).
- `provision-portal-user` (Edge Function) recebe senha em claro do operador —
  será desativado (plano 5).
- Zero Contas de Portal em produção; 309 Clientes; 81 com email em
  `customer_contacts`; não há legado a migrar (inventário 2026-07-10, a
  revalidar no pré-voo).
- Gate de revisão inclui `customer_portal_accounts.active`
  (migration 128/129) — será removido (plano 6).
- `notify-invoice-issued` já usa Resend e serve de referência de estilo para
  Edge Functions de email.

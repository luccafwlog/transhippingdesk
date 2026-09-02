# Arquivo Histórico de Migrações (Pré-v1.0) — Transhipping Desk

Este diretório contém a cópia fiel e imutável das **383 migrações históricas** originais do projeto Transhipping Desk, abrangendo o período de desenvolvimento que vai da migração `001_schema.sql` até a `384_comunicados_automacao_falhas.sql` (com o número `283` pulado no histórico original).

## 1. Finalidade do Arquivo
- **Trilha de Auditoria & Proveniência:** Preservação integral do histórico incremental de decisões arquiteturais, evolução de regras de negócio, correções de auditoria de segurança e permissões RLS.
- **Retrocompatibilidade de Testes:** Garantir que a suíte de testes de contratos estáticos de migration (`src/services/__tests__/*Migration.test.ts`) possa continuar validando os contratos e regras de cada etapa da evolução sem sofrer quebras por ausência de arquivos (`ENOENT`).
- **Referência de Consulta:** Suporte a consultas e investigações retroativas de DDL e DML durante o ciclo de vida do software.

## 2. Conteúdo Arquivado
- **Total de Arquivos:** 383 arquivos `.sql`
- **Data do Snapshot:** 2026-09-02 (após a conclusão e merge das PRs #647, #648 e #649 na branch `main`)
- **Integridade:** Verificação com 100% de paridade SHA-256 em relação ao diretório `supabase/migrations/` no momento do snapshot.

## 3. Diretrizes de Uso
- **Somente Leitura (Read-Only):** Nenhum arquivo deste diretório deve ser editado, renomeado ou removido.
- **Novas Migrações:** Novas migrações do projeto pós-squash devem ser criadas exclusivamente no diretório ativo `supabase/migrations/`, seguindo a convenção sequencial estipulada em `WORKFLOW.md` e na ADR correspondente.

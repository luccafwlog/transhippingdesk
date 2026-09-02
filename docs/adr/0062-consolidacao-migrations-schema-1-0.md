# ADR 0062 — Consolidação de Migrações: Schema Inicial v1.0 e Arquivo Morto

Status: aceito — 2026-09-02

## Contexto

Ao longo da fase de desenvolvimento pré-produção do Transhipping Desk, a camada de banco de dados acumulou **383 arquivos de migração** (`001_schema.sql` a `384_comunicados_automacao_falhas.sql`, com o número 283 pulado no histórico).

Esse volume histórico representou a evolução e o amadurecimento dos módulos operacionais, financeiros e de governança, mas gerou custos operacionais e técnicos acumulados:
- **763 declarações `CREATE FUNCTION`** para 394 funções únicas (funções essenciais de cálculo e transição de estado sofreram até 13 redefinições sucessivas);
- **366 comandos `ALTER TABLE`** incrementais sobre tabelas centrais (`bls` sofreu 36 reformas; `invoices`, 21);
- **111 tabelas criadas** e 6 descontinuadas ao longo do tempo, restando 106 tabelas ativas;
- Replay substancialmente mais lento na inicialização de bancos locais descartáveis e em branches efêmeras do Supabase;
- **201 arquivos de teste (`*Migration.test.ts`)** com mais de 240 leituras estáticas (`readFileSync`, `readdirSync`) inspecionando contratos de SQL específicos em migrações históricas.

Com o sistema pronto para a versão 1.0 e antes de sua entrada formal em produção, surgiu a oportunidade ideal para realizar a consolidação técnica (*squash*) definitiva do schema.

## Decisão

1. **Substituição da cadeia em `supabase/migrations/` pelo Schema Inicial v1.0:**
   - `001_initial_schema.sql`: DDL estrutural definitivo contendo as 106 tabelas sobreviventes, sequências, tipos, chaves primárias, constraints de checagem, índices otimizados e chaves estrangeiras com comportamento `ON DELETE` explícito; inclui o catálogo canônico de portos brasileiros (`public.ports`) necessário para vínculos de terminais e escalas.
   - `002_business_logic_and_security.sql`: Lógica de negócio, funções auxiliares, triggers de manutenção de `updated_at`, funções RPCs consolidadas com `SECURITY DEFINER` e `SET search_path = public, pg_temp;`, habilitação e definição das 273 políticas RLS ativas, catálogos essenciais de sistema (`app_settings`, `customer_communication_kinds`, `customer_communication_templates`, `alert_type_catalog`) e fechamento de privilégios conforme a ADR 0047.
   - `seed.sql`: Preservado intacto como carga canônica de faturamento (taxas locais, tarifas de Demurrage e serviços de terminais/depots com asserções de integridade).

2. **Criação do Arquivo Morto (`supabase/migrations_archive/`):**
   - Todas as 383 migrações históricas originais são preservadas integralmente em `supabase/migrations_archive/`, com paridade criptográfica (SHA-256) atestada.
   - O diretório é estritamente de arquivo/leitura histórica e de auditoria, acompanhado de seu respectivo `README.md`.

3. **Harness de Retrocompatibilidade da Suíte de Testes:**
   - Em `src/test/setup.ts`, foi implementado um adaptador seguro para os módulos de sistema de arquivos (`node:fs` e `fs`).
   - Quando um teste requisitar um arquivo de migração histórico em `supabase/migrations/` que não esteja presente no diretório ativo, o harness redireciona a chamada de forma transparente para `supabase/migrations_archive/`.
   - Listagens de diretório (`readdirSync`) em `supabase/migrations/` passam a responder o conjunto canônico arquivado para os testes de contrato estáticos, filtrando artefatos não-SQL e preservando a validação de mais de 2.700 testes sem necessidade de reescrever centenas de arquivos de teste.

4. **Numeração das Migrações Futuras:**
   - Novas migrações pós-v1.0 continuarão a convenção sequencial de três dígitos (ADR 0016), iniciando em `003_nome_da_migration.sql`.

## Consequências

- O tempo de bootstrap de novos ambientes, bancos de testes descartáveis e branches de preview do Supabase é drasticamente reduzido.
- O histórico completo de engenharia e decisões permanece arquivado e auditável em `supabase/migrations_archive/`.
- Nenhuma funcionalidade, tabela, trigger, política RLS ou RPC teve seu comportamento alterado; a equivalência de schema entre as 383 migrações históricas e o schema consolidado foi validada bit a bit (paridade de 100%).

## Relação com decisões anteriores

- Estende a ADR 0010 (Validação, testes e gates de deploy).
- Atualiza a ADR 0016 (Migrations: nomenclatura numerada sequencial única), mantendo o padrão numérico a partir do marco consolidado v1.0.
- Reafirma e consolida a ADR 0047 (Grants de função fechados por padrão em `public`).

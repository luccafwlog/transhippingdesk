# Correções do Gate de Revisão dos PRs 249–251 — Design

**Data:** 2026-06-19  
**Status:** aprovado pelo usuário em 2026-06-19

## Contexto

Os PRs 249, 250 e 251 redesenharam a fila de revisão manual:

- o PR 249 criou pendências canônicas e fez `save_bl_review` recomputar o gate;
- o PR 250 agrupou a fila por cliente e unificou a correção num drawer;
- o PR 251 adicionou e-mail e provisionamento de portal inline.

A revisão independente não encontrou review threads humanas abertas, mas
identificou regressões e lacunas de segurança, domínio e documentação.

## Evidências da auditoria

1. A migration do PR 249 recriou `save_bl_review` a partir de uma versão antiga
   e removeu:
   - atualização de `customer_reconciliation_status`;
   - atualização de `customer_reconciliation_notes`;
   - manutenção de `billing_hold_reason`;
   - chamada a `sync_customer_reconciliation_queue_for_bl`.
2. O frontend ainda envia audit log de `review_status = reviewed` mesmo quando a
   função recomputa `pending_review`.
3. `compute_bl_review_pendencies` é `SECURITY INVOKER`, mas consulta
   `customer_portal_accounts`, cuja RLS permite leitura direta somente a admin.
   Usuários internos não-admin recebem falso negativo para portal provisionado.
4. O gate considera apenas `active = true`; uma conta sem `auth_user_id` não tem
   login Supabase Auth funcional.
5. A função canônica e `save_bl_review` herdaram `EXECUTE` para `anon` por
   default privilege.
6. O gate só é recomputado durante revisão. A importação e a fronteira de
   faturamento não consultam a mesma regra canônica.
7. O provisionamento grava a conta ativa antes da Edge Function criar ou
   atualizar o usuário Auth. Falha na segunda etapa deixa estado parcial.
8. `src/types/database.ts` ainda declara retorno antigo para `save_bl_review`.
9. A documentação do módulo descreve o comportamento pretendido, mas não
   registra as restrições de rollout, a definição de portal provisionado nem a
   fronteira efetiva de faturamento.

No projeto Supabase conectado existem 104 B/Ls históricos que falhariam apenas
na trava de portal. Todos já têm invoice ativa e foram confirmados pelo usuário
como dados de teste. Eles não serão reabertos nem alterados.

## Abordagens consideradas

### 1. Reabrir todo o histórico

Recomputar o gate de todos os B/Ls e mover os 104 registros para
`pending_review`.

**Vantagem:** uniformidade retroativa.

**Desvantagens:** reabre documentos já faturados, polui a fila operacional e
transforma dados históricos de teste em trabalho atual.

**Decisão:** rejeitada.

### 2. Corrigir apenas o frontend

Manter o banco como está e ajustar queries, helpers e mensagens da página.

**Vantagem:** mudança menor.

**Desvantagens:** chamadas diretas às RPCs continuam podendo liberar ou faturar
um B/L inválido; RLS e estado parcial permanecem; a regra deixa de ser
canônica.

**Decisão:** rejeitada.

### 3. Corrigir a fronteira do banco para o ciclo futuro

Restaurar o contrato completo de `save_bl_review`, tornar a leitura do gate
segura, reforçar a emissão e aplicar a regra a B/Ls novos ou ainda não
faturados. Preservar registros históricos já faturados.

**Vantagens:** regra única, segurança no backend, rollout sem backfill
destrutivo e compatibilidade com a arquitetura atual.

**Desvantagem:** exige migration e testes de contrato mais completos.

**Decisão:** escolhida.

## Design aprovado

### Gate canônico

`compute_bl_review_pendencies(bl_id)` continua sendo a definição única das
travas:

1. cliente vinculado;
2. cliente com ao menos um e-mail não vazio;
3. conta de portal ativa **e** vinculada a `auth.users` por `auth_user_id`;
4. peso BB positivo para carga solta.

CE Mercante permanece fora desse gate de revisão. Sua ausência continua
controlada pelo gate específico de exposição no Portal.

A função será `SECURITY DEFINER`, com `search_path` fixo, validação de usuário
interno ativo e grants default-deny. Assim, ela pode consultar a tabela
admin-only sem expor seus campos ao caller.

### Salvamento da revisão

`save_bl_review` deve:

- preservar lock otimista `PT409`;
- aplicar campos editáveis;
- restaurar a semântica de reconciliação quando `customer_id` muda;
- recomputar pendências e status;
- manter notas humanas;
- sincronizar `customer_reconciliation_queue`;
- registrar o status real no audit log, sem confiar no valor enviado pelo
  cliente;
- retornar `{ updated_at, review_status, pendencias }`.

O frontend deixa de enviar `review_status` no payload e de fabricar sua linha de
auditoria. A RPC será a dona desse evento.

### Entrada e saída do gate

- Importações novas devem persistir `pending_review` quando o estado real exigir
  e continuar preservando motivos específicos de parser/reconciliação.
- `mark_bl_ready_for_billing` deve bloquear B/Ls não faturados quando
  `compute_bl_review_pendencies` não estiver vazio.
- B/Ls que já possuam invoice ativa não recebem backfill nem mudança de
  `review_status`.
- A migration não executa `UPDATE` em massa nos 104 históricos.

### Provisionamento do portal

O fluxo inline passa a considerar provisionado somente após a Edge Function
retornar `auth_user_id`.

Se a criação do usuário Auth falhar após o upsert da conta:

- a conta fica inativa;
- o gate permanece fechado;
- uma nova tentativa pode reutilizar a conta;
- a mensagem original da Edge Function chega ao operador.

Não será criada uma segunda infraestrutura de provisionamento.

### UI e consultas

A fila não fará join direto em `customer_portal_accounts` para derivar o gate.
O estado necessário será exposto por uma RPC ou consulta segura e mínima,
evitando conceder leitura da tabela inteira a usuários não-admin.

Ações admin-only continuam escondidas para outros perfis, mas esses perfis
conseguem visualizar corretamente se o portal já está provisionado.

### Documentação

Atualizar documentos vivos:

- `docs/modules/operacao-suporte.md`;
- `docs/operations/regras-de-negocio.md`;
- `docs/operations/seguranca.md`;
- `docs/operations/validacao.md`;
- `docs/CHANGELOG.md`;
- ADR 0006 com nota editorial corretiva ou nova ADR se a decisão alterar uma
  fronteira arquitetural.

Este design e o plano de execução ficam em `docs/archive/superpowers/` como
snapshots históricos, seguindo a governança documental.

## Testes

- Testes de contrato SQL para reconciliação, RLS, grants, portal funcional,
  audit log e ausência de backfill.
- Testes unitários do serviço de provisionamento para sucesso e falha parcial.
- Testes da fila para admin e não-admin.
- Testes das funções de faturamento que provem bloqueio por gate.
- Verificações finais:
  - `npm run docs:check`;
  - `npm run lint`;
  - `npm test`;
  - `npm run build`;
  - `git diff --check`.

## Fora de escopo

- Alterar ou excluir os 104 B/Ls históricos já faturados.
- Provisionar portal em lote para dados de teste.
- Responder comentários ou resolver threads no GitHub.
- Publicar branch, commit ou PR sem solicitação específica.

# Fundação de Alertas e Notificações — contrato de schema

Status: implementado nas migrations `317`–`320`; este documento é o contrato
de transição para os planos dos blocos `#520`–`#524`.

## Decisões

- `alert_type_catalog` é a fonte única de severidade, departamento responsável,
  audiência e destino padrão. Produtores não repetem listas de tipos críticos
  em código ou migrations futuras.
- `alerts` permanece como agregado histórico por `(entity_type, entity_id)`.
  `alert_items` representa cada pendência operacional do agregado e tem uma
  linha por `(alert_id, item_type)`.
- `alert_item_events` é o histórico append-only de abertura, atualização,
  resolução e reabertura. `occurrence_id` separa ocorrências sucessivas do
  mesmo item e impede que uma dispensa antiga suprima uma reabertura.
- `alert_item_dismissals` registra uma dispensa temporária com motivo, autor e
  `review_at` futuro. Não existe acknowledge nem fechamento manual para itens
  novos; a origem resolve ou reabre o item.
- `internal_notifications` é uma cópia congelada por destinatário e evento.
  A audiência é expandida por usuário no momento do fan-out. Um alerta crítico
  sem destinatário na audiência tenta usuários ativos de Administrativo/Admin;
  se ainda não houver destinatário, `alert_notification_failures` registra a
  falha sem descartar o alerta.

## Superfície SQL

| Objeto | Responsabilidade |
|---|---|
| `alert_type_catalog` | Catálogo ativo de tipos, severidade, departamento, audiência e destino |
| `alert_items` | Estado atual da pendência, mensagem, origem, entidade e ocorrência |
| `alert_item_events` | Histórico append-only das transições |
| `alert_item_dismissals` | Dispensas temporárias auditáveis |
| `internal_notifications` | Fan-out interno por usuário, com leitura individual |
| `alert_notification_failures` | Falha explícita de roteamento |
| `upsert_alert_item` | Abre, atualiza ou reabre item e dispara fan-out apenas em abertura/reabertura |
| `resolve_alert_item` | Resolve item e fecha o agregado quando não restam itens ativos |
| `dismiss_alert_item` | Registra dispensa com motivo obrigatório e revisão futura |
| `list_alert_queue` | Projeta a fila ativa, dispensada ou completa para `/alertas`; inclui legado e aceita filtro server-side por entidade |
| `count_alert_queue` | Conta a mesma projeção da fila para badges sem baixar as linhas |
| `list_internal_notifications` / `mark_internal_notification_read` | Consulta e leitura das notificações próprias |

As escritas de ciclo de vida são feitas por RPCs `SECURITY DEFINER` para
`service_role` (ou usuário interno ativo quando aplicável). Usuários internos
leem itens e histórico; notificações só podem ser lidas e marcadas como lidas
pelo próprio destinatário. A tabela de falhas é legível por usuários internos,
mas não é gravável pelo cliente.

## Compatibilidade e migração

As linhas antigas de `alerts` permanecem consultáveis por `list_alert_queue`
até que o produtor correspondente seja migrado. Inserts legados de tipos
presentes no catálogo são roteados para o novo ciclo por trigger AFTER INSERT,
preservando o tipo concreto porque produtores legados ainda fecham/deduplicam
por esse campo. O bridge também acompanha transições diretas de fechamento e
reabertura do carrier legado: o fechamento resolve o item e a reabertura cria
nova ocorrência e fan-out. Se já existir item do mesmo tipo, uma nova linha
legada é consumida pelo carrier existente para não duplicar a fila nem reabrir
um carrier Portal em conflito com o índice parcial. O tipo
`agency_report_section_pending` é encerrado pela migration `320`, preservando
as linhas para auditoria. O backfill inicial cria itens sem fan-out de
notificações; notificações só nas aberturas/reaberturas operacionais. O status
histórico `acknowledged` continua aceito para leitura; as novas RPCs não o
produzem.

Os tipos financeiros `invoice_payment_invalid` e `invoice_cancel_blocked` são
resolvidos automaticamente pelas transições autoritativas de `invoices`, e
`billing_auto_issue_failed` é resolvido quando a emissão automática termina
com sucesso.

O executor `alerts-detector` é uma Edge Function server-only chamada pelo job
`alerts-foundation-detectors` a cada 15 minutos. Ela invoca os detectores
existentes com contexto de serviço e não é chamada pelo browser. A agenda só é
criada quando `pg_cron` e `pg_net` estão disponíveis. Se URL ou segredo
estiverem ausentes, a migration avisa e deixa o job agendado para que a falha
seja observável até a configuração ser corrigida.

## Próximos consumidores

Os planos de B/L, Portal, Financeiro, Operação/Viagem e ADR devem produzir e
resolver itens por `upsert_alert_item`/`resolve_alert_item`, usando somente os
tipos do catálogo. Nenhum desses planos deve adicionar botão de reconhecer ou
fechar, escrever diretamente em `internal_notifications`, ou criar um segundo
catálogo de severidade.

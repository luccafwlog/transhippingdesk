# Auditoria da isenção de Taxas Locais para veículos LCL — 1º set. 2026

> Registro histórico de investigação do repositório atual. Nenhum código
> funcional foi alterado; esta nota é a única mudança desta auditoria. O
> escopo cobre somente código, migrations, testes e documentação versionados.

## Resumo executivo

Há uma correção importante de nomenclatura e de regra: **veículos não são um
`cargo_mode` de B/L**. O contrato de B/L aceita `container` e `carga_solta`; os
veículos são linhas próprias em `vehicles`, ligadas ao B/L por `bl_id`. A
isenção investigada ocorre para um B/L de `cargo_mode = 'container'` que tenha
pelo menos um veículo e cujo `movement_to` contenha `LCL` ou `CFS`.

Quando os três predicados são verdadeiros, `calculate_bl_local_charges` encerra
o cálculo antes de resolver tabela ou itens: remove as linhas automáticas
anteriores quando solicitado, grava uma linha sintética de isenção com valor
zero, atualiza o B/L para `charge_status = 'exempt'` e retorna um resultado
explicitamente isento. Ausência ou notação desconhecida em `movement_to` não
isenta; o fluxo segue para cobrança normal.

Na aba **Validação** de `/taxas-locais`, a isenção é tratada como estado
resolvido: o B/L fica oculto por padrão, aparece com o filtro `Motivo = Isento`
ou com “Incluir resolvidos”, mostra a justificativa e o status `Isento`, e não
fica elegível para emissão individual. O recálculo continua disponível para
um B/L não bloqueado financeiramente, permitindo que a mudança do
`movement_to` altere o resultado na próxima tentativa.

## 1. Contrato de dados e regra vigente

### 1.1 `cargo_mode` não é “veículos”

O schema de B/L restringe `bls.cargo_mode` a `container` ou `carga_solta`, com
default `container`. O módulo de veículos persiste unidades separadas e cada
unidade recebe o `bl_id` do B/L. Portanto, “veículos LCL” é uma combinação de
modo de B/L + relação de veículos + movimento documental, não um terceiro modo
de carga.

- [`006_breakbulk_module.sql#L1-L25`](../../../supabase/migrations/006_breakbulk_module.sql#L1-L25)
- [`vehicleImport.ts#L306-L316`](../../../src/services/vehicleImport.ts#L306-L316)

### 1.2 Predicado de isenção

Na definição vigente do motor, o sistema:

1. lê `b.movement_to` junto com o B/L;
2. calcula `v_has_vehicles` por `EXISTS` em `public.vehicles WHERE bl_id = p_bl_id`;
3. considera movimento LCL somente quando `movement_to` não é nulo e, após
   `TRIM`/`UPPER`, contém `LCL` ou `CFS`;
4. entra no ramo de isenção somente com
   `v_bl.cargo_mode = 'container' AND v_has_vehicles AND v_is_lcl_movement`.

`movement_from` não participa desta decisão. Também não há fallback para
ausência ou texto não reconhecido: nesses casos o predicado é falso e o
motor continua no caminho de cobrança.

- [`311_extract_local_charge_resolution.sql#L337-L380`](../../../supabase/migrations/311_extract_local_charge_resolution.sql#L337-L380)
- [`vehicleExemptionRequiresLclMovementMigration.test.ts#L22-L36`](../../../src/services/__tests__/vehicleExemptionRequiresLclMovementMigration.test.ts#L22-L36)
- [`BlOperacionalTab.tsx#L109-L114`](../../../src/components/bl/BlOperacionalTab.tsx#L109-L114)

O campo `movement_to` é persistido em `bls` e também faz parte do payload de
importação documental. A tela da ficha do B/L o edita como **Movement To** e
explica que LCL/CFS isenta o veículo no destino, enquanto ausência ou outra
notação cobra normalmente.

- [`205_bl_document_fields.sql#L1-L8`](../../../supabase/migrations/205_bl_document_fields.sql#L1-L8)
- [`205_bl_document_fields.sql#L185-L200`](../../../supabase/migrations/205_bl_document_fields.sql#L185-L200)
- [`blFreightImport.ts#L570-L614`](../../../src/services/blFreightImport.ts#L570-L614)

## 2. Como o cálculo realiza a isenção

Na versão atual da RPC `public.calculate_bl_local_charges` (`311`), a sequência
relevante é:

1. exige usuário autenticado e ativo;
2. recusa recálculo se o B/L estiver financeiramente bloqueado (`invoiced`,
   `partially_paid` ou `paid`);
3. se `p_recalculate` for verdadeiro, apaga somente linhas automáticas do
   B/L, preservando linhas manuais;
4. verifica existência de veículo e interpreta `movement_to`;
5. se o predicado de isenção for verdadeiro, retorna imediatamente — antes da
   resolução da tabela, do rateio, dos overrides e do loop de itens.

- [`311_extract_local_charge_resolution.sql#L332-L380`](../../../supabase/migrations/311_extract_local_charge_resolution.sql#L332-L380)
- [`311_extract_local_charge_resolution.sql#L414-L452`](../../../supabase/migrations/311_extract_local_charge_resolution.sql#L414-L452)

Esse early return significa isenção total do cálculo automático daquele B/L:

| Persistência | Valor gravado |
|---|---|
| `charge_calculations.source` | `auto` |
| `charge_calculations.status` | `exempt` |
| `charge_calculations.calculation_key` | `exempt:lcl_vehicle` |
| `charge_calculations.quantity` | `1` |
| `charge_calculations.unit_value_brl` | `0` |
| `charge_calculations.total_value_brl` | `0` |
| `charge_calculations.notes` | `Linha sintetica de isencao` |
| `charge_calculations.review_reason` | justificativa construída com `movement_to` |
| `charge_calculations.created_by` / `calculated_at` | ator efetivo e `NOW()` |
| `bls.charge_status` | `exempt` |
| `bls.charges_calculated_at` | `NOW()` |
| `bls.charge_exemption_reason` | mesma justificativa |
| `bls.billing_hold_reason` | `NULL` |

A chave única `(bl_id, calculation_key)` torna a linha sintética idempotente:
ela é atualizada em vez de duplicada. O retorno da RPC informa `status:
'exempt'`, `line_count: 1`, totais BRL/USD iguais a zero, `review_required:
false`, `exempt: true` e a justificativa.

- [`311_extract_local_charge_resolution.sql#L382-L411`](../../../supabase/migrations/311_extract_local_charge_resolution.sql#L382-L411)
- [`016_local_charges_stage_a.sql#L96-L155`](../../../supabase/migrations/016_local_charges_stage_a.sql#L96-L155)

O ramo também evita depender de tabela ativa. A resolução de tabela e o loop
normal só aparecem depois do retorno de isenção; quando não há isenção, o
motor segue para tabela/POD, perfis de container, rateio e itens normalmente.

## 3. Evolução da regra e correção do falso positivo

A implementação inicial (`016`) transformava qualquer B/L de container com
veículo em `container_load_type = 'LCL'` e, logo em seguida, usava esse valor
para isentar. Isso fazia a própria função fabricar a condição que precisava
ler e isentava também veículos FCL.

A migration `265` corrigiu esse desenho: deixou de escrever ou ler
`container_load_type` para a decisão e passou a exigir prova positiva em
`movement_to`. A documentação da migration explicita que a ausência ou
notação desconhecida cobra normalmente. A função redefinida mais recentemente
em `311` conserva esse contrato.

- [`016_local_charges_stage_a.sql#L521-L558`](../../../supabase/migrations/016_local_charges_stage_a.sql#L521-L558)
- [`265_vehicle_exemption_requires_lcl_movement.sql#L1-L21`](../../../supabase/migrations/265_vehicle_exemption_requires_lcl_movement.sql#L1-L21)
- [`265_vehicle_exemption_requires_lcl_movement.sql#L107-L162`](../../../supabase/migrations/265_vehicle_exemption_requires_lcl_movement.sql#L107-L162)
- [`311_extract_local_charge_resolution.sql#L371-L412`](../../../supabase/migrations/311_extract_local_charge_resolution.sql#L371-L412)
- [`0038-taxa-local-valor-congelado-ancorado-na-escala.md#L140-L149`](../../../docs/adr/0038-taxa-local-valor-congelado-ancorado-na-escala.md#L140-L149)

## 4. Gatilhos e efeitos de recálculo

O ponto de entrada do aplicativo chama a RPC `calculate_bl_local_charges` e
normaliza o retorno, incluindo `status`, `exempt` e `reason`. O hook invalida
linhas do B/L, detalhe, listas, fila de pendências e resumos após sucesso.

- [`chargeOperationsService.ts#L134-L169`](../../../src/services/charges/chargeOperationsService.ts#L134-L169)
- [`useLocalCharges.ts#L151-L170`](../../../src/hooks/useLocalCharges.ts#L151-L170)

O cadastro de veículos ocorre depois dos B/Ls/containers e pode encontrar uma
fatura já emitida. Por isso o importador, após inserir as linhas de veículos,
lista faturas ativas por B/L, cancela cada uma com o motivo “Carga de veiculos:
BL isento de taxas locais.” e só então recalcula o B/L. O teste correspondente
verifica tanto o cancelamento quanto a chamada de recálculo. Se a sequência
falhar, o resultado informa que os veículos foram cadastrados, mas a isenção ou
o cancelamento precisam de ajuste manual no Faturamento.

- [`vehicleImport.ts#L320-L356`](../../../src/services/vehicleImport.ts#L320-L356)
- [`vehicleImport.ts#L368-L380`](../../../src/services/vehicleImport.ts#L368-L380)
- [`vehicleImport.test.ts#L274-L279`](../../../src/services/__tests__/vehicleImport.test.ts#L274-L279)
- [`vehicleImport.test.ts#L281-L351`](../../../src/services/__tests__/vehicleImport.test.ts#L281-L351)

O recálculo iniciado pela importação documental também é provisório e limitado
a B/Ls de container; ele roda depois das flags físicas IMO/OOG e usa a mesma
RPC. A alteração da lista de veículos é classificada como impacto de
faturamento no diff do importador, mas a decisão efetiva continua sendo a RPC
central acima.

- [`chargeOperationsService.ts#L761-L835`](../../../src/services/charges/chargeOperationsService.ts#L761-L835)
- [`blFreightImport.ts#L697-L706`](../../../src/services/blFreightImport.ts#L697-L706)

## 5. Superfícies da Validação

### Entrada, filtro e visibilidade

`/taxas-locais` monta as abas **Faturas** e **Validação**; a segunda renderiza
`ValidacaoTab`. A Validação oferece modo (`Container`, `Carga Solta`, `Granito`),
POD, viagem, texto livre, motivo e a opção **Incluir resolvidos**. O motivo
`isento` é explícito.

- [`TaxasLocais.tsx#L197-L226`](../../../src/pages/TaxasLocais.tsx#L197-L226)
- [`ValidacaoControls.tsx#L24-L40`](../../../src/components/billing/ValidacaoControls.tsx#L24-L40)

Por padrão, `ValidacaoTab` remove da lista os blocos `faturado`, `isento` e
`pronto`. Ao escolher um desses motivos, a própria tela liga
`includeResolved`; assim, a isenção não desaparece semanticamente, apenas não
fica na fila aberta por padrão.

- [`ValidacaoTab.tsx#L27-L40`](../../../src/components/billing/ValidacaoTab.tsx#L27-L40)
- [`chargeOperationsService.ts#L222-L377`](../../../src/services/charges/chargeOperationsService.ts#L222-L377)

### Classificação do B/L isento

`getBillingBlock` dá precedência a `financial_status = 'invoiced'` e, depois,
classifica `charge_status = 'exempt'` como bloco `isento`, usando
`charge_exemption_reason` como detalhe. Portanto, a justificativa criada pela
RPC chega diretamente ao motivo da fila.

- [`validacaoPipeline.ts#L57-L117`](../../../src/components/billing/validacaoPipeline.ts#L57-L117)
- [`validacaoFunnel.test.ts#L4-L14`](../../../src/components/billing/__tests__/validacaoFunnel.test.ts#L4-L14)

Na tabela, a linha exibe o motivo, o modo `Container`, o status `Isento` e o
subtotal zero. A expansão mostra o callout do motivo, datas/último evento e a
`ConferenciaCalculo`, que lê as linhas persistidas — inclusive a linha
sintética — em vez de recalcular uma prévia diferente. O botão `Emitir` não é
habilitado porque a condição de emissão exige `isChargeReady`, isto é,
`ready_for_billing`, não `exempt`; o botão **Recalcular** segue sujeito apenas
à trava financeira do B/L.

- [`ValidacaoOperationsTable.tsx#L92-L129`](../../../src/components/billing/ValidacaoOperationsTable.tsx#L92-L129)
- [`ValidacaoOperationsTable.tsx#L143-L249`](../../../src/components/billing/ValidacaoOperationsTable.tsx#L143-L249)
- [`ValidacaoOperationsTable.tsx#L332-L342`](../../../src/components/billing/ValidacaoOperationsTable.tsx#L332-L342)
- [`ConferenciaCalculo.tsx#L41-L70`](../../../src/components/billing/ConferenciaCalculo.tsx#L41-L70)
- [`ConferenciaCalculo.tsx#L89-L140`](../../../src/components/billing/ConferenciaCalculo.tsx#L89-L140)
- [`chargeStatus.ts#L5-L22`](../../../src/lib/chargeStatus.ts#L5-L22)

### Automação pós-revisão/CE

Quando a automação tenta calcular e recebe `exempt`, ela não tenta emitir
invoice, resolve eventual alerta de cálculo bloqueado e retorna
`awaiting_flow` com “B/L isento de taxas locais.”. Os testes confirmam que uma
isenção válida não abre alerta nem chama criação de fatura.

- [`reviewBillingAutomation.ts#L238-L276`](../../../src/services/reviewBillingAutomation.ts#L238-L276)
- [`reviewBillingAutomation.test.ts#L374-L392`](../../../src/services/__tests__/reviewBillingAutomation.test.ts#L374-L392)
- [`reviewBillingAutomation.test.ts#L481-L492`](../../../src/services/__tests__/reviewBillingAutomation.test.ts#L481-L492)

## 6. Cobertura observada nos testes

- O teste da migration `265` verifica a redefinição da RPC, a remoção da
  escrita em `container_load_type`, a exigência de `movement_to` com `LCL` ou
  `CFS`, o comportamento de ausência/notação desconhecida e o grant somente
  para usuários autenticados.
- Os testes de importação de veículos verificam que inserir um veículo dispara
  recálculo, e que um B/L com fatura ativa cancela a fatura antes de recalcular.
- Os testes do funil da Validação verificam que `charge_status = 'exempt'` é
  classificado como `isento`, separado de `faturado`.
- Os testes da automação verificam que um resultado `exempt` não produz
  invoice nem alerta de bloqueio financeiro.
- O teste de contrato da migration `311` confirma que a função atual usa o
  resolver puro para o caminho normal e preserva a persistência de estados;
  a isenção, porém, é um early return anterior a esse resolver e continua
  definida na própria função de cálculo.

As evidências são predominantemente testes de contrato do SQL e testes de
orquestração com mocks; não há, nesta auditoria, prova de execução contra uma
instância remota ou produção. Isso delimita a conclusão: a nota descreve o
comportamento implementado e coberto pelo repositório, não uma confirmação de
que todas as migrations estejam aplicadas em um ambiente externo.

## Anexo — mapa compacto de fontes

| Pergunta | Fonte primária |
|---|---|
| Qual é a regra atual? | [`311_extract_local_charge_resolution.sql#L371-L412`](../../../supabase/migrations/311_extract_local_charge_resolution.sql#L371-L412) |
| Por que `movement_to` é obrigatório? | [`265_vehicle_exemption_requires_lcl_movement.sql#L1-L21`](../../../supabase/migrations/265_vehicle_exemption_requires_lcl_movement.sql#L1-L21) e [`vehicleExemptionRequiresLclMovementMigration.test.ts#L22-L36`](../../../src/services/__tests__/vehicleExemptionRequiresLclMovementMigration.test.ts#L22-L36) |
| O que fica persistido? | [`311_extract_local_charge_resolution.sql#L382-L411`](../../../supabase/migrations/311_extract_local_charge_resolution.sql#L382-L411) e [`016_local_charges_stage_a.sql#L96-L155`](../../../supabase/migrations/016_local_charges_stage_a.sql#L96-L155) |
| O que ocorre ao importar veículos? | [`vehicleImport.ts#L320-L356`](../../../src/services/vehicleImport.ts#L320-L356) |
| Como aparece na Validação? | [`validacaoPipeline.ts#L57-L117`](../../../src/components/billing/validacaoPipeline.ts#L57-L117), [`ValidacaoTab.tsx#L27-L40`](../../../src/components/billing/ValidacaoTab.tsx#L27-L40) e [`ValidacaoOperationsTable.tsx#L92-L129`](../../../src/components/billing/ValidacaoOperationsTable.tsx#L92-L129) |
| A isenção emite invoice? | [`reviewBillingAutomation.ts#L254-L276`](../../../src/services/reviewBillingAutomation.ts#L254-L276) e [`reviewBillingAutomation.test.ts#L481-L492`](../../../src/services/__tests__/reviewBillingAutomation.test.ts#L481-L492) |


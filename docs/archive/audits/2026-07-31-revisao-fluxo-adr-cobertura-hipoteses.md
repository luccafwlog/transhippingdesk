# Revisão do fluxo do ADR — cobertura de hipóteses operacionais (31 jul 2026)

> Registro histórico. Revisão conduzida na branch `claude/adr-flow-review-uq3puh`
> contra o repositório em `169b327` (31 jul 2026). O pedido foi verificar se o
> fluxo do **Agency Departure Report** cobre todas as hipóteses de escala —
> nomeadamente **transbordo**, **viagem criada exclusivamente para embarque de
> container** e **granito**.
>
> Nenhuma linha de código foi alterada para produzir o diagnóstico. A única
> correção entregue junto (IMP-1) está isolada no fim do documento.

## Escopo e método

Leitura estática de ponta a ponta do fluxo:

- Aba e documento: `VoyageAgencyReportTab.tsx`, `AgencyReportDocument.tsx`,
  `SignoffControl.tsx`, `DepartmentSignoffControl.tsx`.
- Derivação: `src/services/agencyDepartureReport.ts`, `voyageRouteSchedules.ts`,
  `voyageExportSchedules.ts`, `voyageSummaries.ts`, `vaziosCusto.ts`,
  `graniteImport.ts`.
- Origem das escalas: `VoyageCard.tsx`, `VoyageVisaoTab.tsx`, `voyages.ts`,
  `voyageForm.ts`, `VoyageScheduleModals.tsx`, `EmbarqueVazios.tsx`.
- Contrato SQL: migrations `213`, `214`, `218`, `221`–`228`, `174`, `176`, `201`.
- Documentos de decisão: `CONTEXT.md`, ADR 0027–0030 e 0033, a spec arquivada
  `2026-07-19-agency-departure-report-design.md`.

Labels de evidência conforme `docs/CONVENCOES.md`.

## Resumo executivo

O receio é procedente, e o mecanismo por trás das três hipóteses é o mesmo:
**o ADR só existe onde existe um POD**. A identidade `(viagem, porto)` é
alimentada exclusivamente pela lista de portos de descarga da viagem, e todas as
sete seções derivam de consultas com igualdade literal contra essa string de
porto. Escala que só carrega não entra na lista; carga que muda de porto de
descarga não acompanha; planilha que grafa o porto de outro jeito não casa.

O agravante é comum aos três casos: **ausência de dado é indistinguível de
ausência de fato na tela**. A seção mostra "Nenhum dado informado para esta
escala", o departamento assina "Nada a declarar", os três sign-offs fecham o
ADR e o snapshot congelado — que é o que o Financeiro usa para aprovar fatura —
registra zero como se fosse verdade conferida. É exatamente a distinção que a
ADR 0027 quis criar com o estado explícito de resolução, e ela se perde quando o
zero vem de um filtro que não casou.

| # | Achado | Sev. | Evidência |
|---|---|---|---|
| ESC-1 | Viagem só de embarque não tem ADR nenhum: nenhuma escala é oferecida | P0 | Código |
| ESC-2 | Seletor não filtra escalas brasileiras (a spec exige "só PODs brasileiros") | P1 | Código |
| ESC-3 | Alerta pós-ATD só enxerga `voyage_pod_schedule.atd`; escala de exportação não tem ATD | P1 | Código SQL |
| ESC-4 | ADR de escala omitida depois some do seletor, mesmo fechado e impressível | P2 | Código |
| TRB-1 | Carga em transbordo não entra no ADR do porto onde foi realmente descarregada | P0 | Código + Código SQL |
| TRB-2 | Categoria `transbordo` da matriz de descarga é inalcançável na prática | P1 | Código |
| TRB-3 | Dados do transbordo global (navio/viagem seguinte) não aparecem no ADR da escala | P2 | Código |
| GRA-1 | `granite_bls.loading_port` é gravado cru da planilha; o ADR compara com LOCODE | P1 | Código |
| GRA-2 | Sem fallback para `granite_manifests.loading_port` quando o B/L não traz L/PORT | P2 | Código |
| GRA-3 | "Carga carregada" é só granito: embarque de container de exportação não tem seção nem fonte | P1 | Código |
| VAZ-1 | `embark_port` do Embarque de Vazios é texto livre, sem normalização nem vínculo com a escala | P1 | Código |
| CAR-1 | Vazios do Baplie entram na matriz de carga descarregada como `carga_geral` | P1 | Código |
| CAR-2 | Total da linha de serviço no ADR aplica `percentual` legado e diverge do total da operação | P2 | Código |
| SNP-1 | A migration 224 removeu a validação de forma/tamanho do snapshot criada pela 218 | P1 | Código SQL |
| IMP-1 | Observações por seção nunca saíam no ADR impresso — **corrigido neste PR** | P1 | Teste |
| IMP-2 | O plano de atualização do documento impresso citado pela ADR 0030 não existe | P2 | Código |

## 1. O mecanismo: como o ADR escolhe as escalas

```
voyage.bls[].pod  ─┐
schedules de POD  ─┼─► collectVoyagePorts(...)  ─► podRows ─► activePods ─► pods do ADR
voyage.pod (fbk)  ─┘                                   (remove omitidas)
```

- `VoyageCard.tsx:167` monta `destinationPorts` com os PODs dos B/Ls, os PODs
  planejados (`voyage_pod_schedule`) e, se ambos vierem vazios, o `voyage.pod`
  como fallback (`voyageSummaries.ts:231-252`).
- `VoyageCard.tsx:193` remove as escalas omitidas e entrega o resultado à aba
  (`VoyageCard.tsx:383`).
- Sem nenhum porto, a aba mostra "Nenhuma escala ativa para compor o ADR"
  (`VoyageAgencyReportTab.tsx:151`).

Depois disso, **as sete seções são sete filtros por igualdade contra essa mesma
string** (`agencyDepartureReport.ts:309-350`):

| Seção | Filtro |
|---|---|
| Datas | `voyage_pod_schedule` de `{voyageId}::{PORTO}` |
| Carga descarregada | `bls.pod = porto` (+ `baplie_containers.pod = porto`) |
| Carga solta | `bls.pod = porto AND cargo_mode = 'carga_solta'` |
| Vazios descarregados | `vazios_importacao_containers.pod = porto` |
| Veículos | `vehicles → bls.pod = porto` |
| Carga carregada (granito) | `granite_bls.loading_port = porto` |
| Vazios embarcados / Operação de pátio | `vazios_export_operations.embark_port = porto` |

Duas dessas linhas são de **exportação** (granito e vazios embarcados) e usam o
porto de *carregamento*, mas o porto que chega até elas foi obtido de uma lista
de portos de *descarga*. Só funciona porque, na escala clássica de transbordo, o
porto brasileiro é as duas coisas ao mesmo tempo. Quando não é, ninguém avisa.

## 2. Hipótese "viagem exclusivamente para embarque" (ESC-1 a ESC-3)

**O sistema já modela essa escala — em outro lugar.** Uma viagem que só carrega
tem sua escala registrada como POL: `voyage_export_schedules` (uma linha por
viagem, com `pol`, `eta`, `etb`, `has_granite`, `containers_qty`,
`movements_qty`) mais os `voyage_pol_schedule` de `etd`/`atd`/`escala_number`.
Na Visão geral ela aparece com destaque, na linha marcada **EXP**
(`VoyageVisaoTab.tsx:300-320`).

O ADR não lê nenhuma dessas duas fontes. E como uma viagem criada pelo formulário
nasce com `pol_id`/`pod_id` nulos (`voyages.ts:20`) e granito/vazios de
exportação não criam linhas em `bls`, o resultado é:

> **`destinationPorts` vazio → `activePods` vazio → "Nenhuma escala ativa para
> compor o ADR".** A escala brasileira aconteceu, carregou container e/ou
> granito, e não existe ADR — nem aberto, nem pendente, nem alertado. (ESC-1)

Três consequências encadeadas:

- **ESC-2** — o seletor tampouco filtra escalas brasileiras. A spec de 2026-07-19
  fixou "PODs brasileiros; omitidas marcadas e sem ADR", mas a lista aceita
  qualquer POD. Se a viagem tiver PODs estrangeiros cadastrados, eles ganham chip
  de ADR (e um ADR vazio, assinável) contra a regra do glossário de que "portos
  de origem estrangeiros não geram ADR".
- **ESC-3** — o alerta de pendência lê `audit_logs` de `voyage_pod_schedule` com
  `field_name = 'atd'` (migration `228`, `detect_agency_report_pending`). Escala
  de exportação não tem ATD em lugar nenhum: `voyage_export_schedules` só guarda
  `eta`/`etb`. Ou seja, o ADR que não existe também nunca é cobrado. O silêncio é
  completo.
- **Mitigação que existe hoje** — cadastrar a escala brasileira como "porto de
  descarga" faz o ADR funcionar razoavelmente: granito (`loading_port`), vazios
  embarcados (`embark_port`) e datas passam a casar, porque todos comparam com a
  mesma string. É uma convenção de digitação não documentada, e ela não sobrevive
  a uma viagem em que o mesmo porto seja POL de exportação e não seja POD.

**Decisão que o produto precisa tomar antes de qualquer código:** a escala de
exportação passa a ser fonte de escala do ADR (unindo POD e POL numa única lista
de escalas brasileiras), ou o ADR continua ancorado em POD e a operação assume
formalmente a convenção de cadastrar a escala de embarque como POD? A primeira
opção é a que corresponde ao glossário ("cada escala brasileira de uma viagem
gera um ADR") e implica também dar ATB/ATD à escala de exportação — sem isso, a
seção Datas e o gatilho de alerta ficam sem substrato.

## 3. Hipótese "transbordo" (TRB-1 a TRB-3)

O modelo de omissão está correto e auditado; o que não acompanha é o ADR.

Quando a escala de um POD é omitida (`omit_voyage_escala`, migration `201`):

1. a escala é marcada `omitted` e sai de `activePods` — certo, o navio não
   atracou lá;
2. todos os B/Ls daquele POD ganham `bl_transshipments` com
   `disposition = 'transshipment'` (migration `201:139-143`);
3. **`bls.pod` permanece no POD omitido.** Só o COD reescreve o POD para o porto
   de descarga (`174:248`).

Logo, para a carga que segue em transbordo:

> O container foi descarregado fisicamente no **Porto de Transbordo**, mas o ADR
> desse porto filtra `bls.pod = porto` e não o encontra. E o ADR do POD omitido
> não existe. **A carga não aparece em ADR nenhum.** (TRB-1)

O ADR da escala que efetivamente trabalhou subconta a descarga — e é esse número
que o Financeiro usa para conferir a fatura do terminal. O Baplie não salva: o
`pod` do plano de estiva é o porto de descarga previsto, o mesmo omitido.

- **TRB-2** — a categoria `transbordo` da matriz
  (`agencyDepartureReport.ts:403-411`) só é atingida por um B/L cujo `pod` seja
  igual ao porto do ADR **e** que tenha registro de transbordo. Essa combinação é
  exatamente a escala omitida, que nunca ganha ADR. Na prática a categoria é
  inalcançável — a coluna existe no relatório e nunca conta nada.
- **TRB-3** — o registro global de transbordo (porto, navio, armador, viagem, ETD
  e ETA seguintes) alimenta a Linha do Tempo da Viagem, o card do B/L e o Portal,
  mas não aparece em nenhuma seção do ADR da escala de descarga, embora a omissão
  seja um acontecimento daquela escala e o ADR seja o registro da escala.
- **O COD está correto** e vale registrar: reescrevendo `bls.pod` para o porto de
  descarga, o container passa a contar no ADR certo, como `carga_geral` — que é o
  que ele é, já que ali ele é entregue e não segue viagem.
- **ESC-4** — omitir uma escala que já tinha ADR (inclusive fechado e assinado)
  remove o chip do seletor; o `initialEscala` do deep link também só é aceito se
  estiver em `pods` (`VoyageAgencyReportTab.tsx:134`). O relatório fechado fica
  inacessível para consulta e impressão.

## 4. Hipótese "granito" (GRA-1 a GRA-3)

O granito entra na seção "Carga carregada" por
`granite_bls.loading_port = porto do ADR`.

- **GRA-1** — `loading_port` é gravado **cru** da planilha COSCO: a coluna
  `L/PORT` sofre apenas `trim` (`graniteImport.ts:137`) e nada no caminho até o
  banco aplica `normalizePortCode` (a migration `136` repassa o valor). O porto do
  ADR, por outro lado, vem normalizado a LOCODE (`voyageRouteSchedules.ts:561`) ou
  do `pod` dos B/Ls, também normalizado na importação. Basta a planilha grafar
  `VITORIA` em vez de `BRVIX` para a seção ficar zerada com o granito carregado —
  e a Documentação assinar "Nada a declarar" sobre carga que existe.
- **GRA-2** — quando a planilha não traz a coluna, `granite_bls.loading_port`
  fica nulo e não há fallback para o `loading_port` do manifesto (que é gravado a
  partir do primeiro B/L, `graniteImport.ts:231`). Mesmo efeito, causa diferente.
- **GRA-3** — a seção mostra B/Ls, blocos e peso. É o que o modelo real da
  empresa pedia para granito, mas "carga carregada" no glossário é toda a carga
  embarcada na escala. **Embarque de container de exportação não tem seção, nem
  fonte, nem sign-off.** As fontes existem e não são consultadas:
  `baplie_containers.pol = porto` (o plano de estiva conhece o que embarcou) e
  `voyage_export_schedules.containers_qty` / `movements_qty` (o que a operação
  planejou). Uma viagem que só embarca container produz — na melhor das
  hipóteses, com a escala cadastrada como POD — um ADR com todas as seções
  vazias, fechável em três "Nada a declarar".

## 5. Outros achados do mesmo fluxo

- **VAZ-1** — o porto do Embarque de Vazios é digitado à mão e só recebe
  `trim().toUpperCase()` (`EmbarqueVazios.tsx:270`), sem `normalizePortCode` e sem
  vínculo com as escalas da viagem. Divergiu, o ADR zera **vazios embarcados** e
  **operação de pátio** — a seção que carrega dinheiro (linhas de serviço,
  armazenagem, total da operação). É o mesmo zero silencioso do granito, no ponto
  mais caro do relatório.
- **CAR-1** — a matriz de carga descarregada complementa os containers dos B/Ls
  com os do Baplie que não estão neles (`agencyDepartureReport.ts:414-422`). O
  `status` do Baplie (`full`/`empty`) é selecionado na consulta e nunca usado:
  **vazios descarregados entram na matriz como `carga_geral`**, duplicando o que
  a seção "Vazios descarregados" já conta a partir de
  `vazios_importacao_containers`. O ADR fica com a descarga inflada.
- **CAR-2** — a linha da tabela de serviços do ADR calcula
  `quantidade × unitário × percentual/100`
  (`VoyageAgencyReportTab.tsx:360`; mesmo cálculo no documento impresso), mas
  `totalLinha` ignora o percentual em linhas de armazenagem
  (`vaziosCusto.ts:66-70`). Para linhas legadas com percentual não nulo, a soma
  das linhas exibidas não bate com o "Total da operação" logo abaixo. A ADR 0033
  aposentou o percentual; o resíduo continua nas duas superfícies de exibição.
- **SNP-1** — a migration `218` blindou o fechamento revalidando o snapshot no
  banco: tipos de `header`/`sections`/`occurrences`/`signoffs`, allowlist de
  chaves de topo, allowlist de seções e limite de 1 MiB. A migration `224`
  reescreveu `close_agency_departure_report` para mudar o gate (3 departamentos em
  vez de 7 seções) e **manteve apenas "é objeto e tem `sections`"** — toda a
  revalidação se perdeu, provavelmente sem intenção, já que a allowlist da `218`
  também estava desatualizada (não previa `costs` nem `vaziosUnidades`, que a aba
  passou a enviar). Hoje o registro financeiro imutável aceita qualquer JSON de
  qualquer tamanho. A ADR 0027 ("a RPC valida a forma, as chaves canônicas e um
  limite de tamanho") e a linha correspondente da `RASTREABILIDADE.md` afirmam o
  contrário do que o código faz.
- **IMP-2** — a ADR 0030 registra que o documento impresso "continua refletindo o
  modelo anterior até uma fase seguinte, já registrada em plano próprio". Não há
  plano em `docs/plans/` (a tabela está vazia): o acompanhamento se perdeu.

## Recomendações, em ordem de valor

1. **Decidir a identidade da escala do ADR** (ESC-1/ESC-2/ESC-3). Enquanto a
   pergunta "o que é uma escala brasileira desta viagem?" tiver duas respostas —
   POD para o ADR, POD+EXP para a Visão geral — o ADR continuará cego para
   viagens de exportação. Uma vez decidida, dar ATB/ATD à escala de exportação é
   pré-requisito para a seção Datas e para o alerta pós-ATD.
2. **Fechar o buraco do transbordo** (TRB-1/TRB-2). A carga descarregada por
   omissão precisa contar no ADR do porto de descarga. Como `bls.pod` é a
   verdade documental do destino e não deve ser reescrito no transbordo (o COD é
   que muda destino), o caminho natural é a consulta de carga descarregada passar
   a considerar `voyage_omissions.discharge_pod` — o que, de quebra, torna a
   categoria `transbordo` finalmente alcançável e correta.
3. **Eliminar os zeros silenciosos de casamento de porto** (GRA-1, GRA-2, VAZ-1).
   Duas medidas complementares: normalizar porto na escrita (`normalizePortCode`
   na importação de granito e no `embark_port` do Embarque de Vazios) e, na aba,
   distinguir "não há dado para esta escala" de "há dado na viagem que não casou
   com este porto" — um aviso de dado órfão vale mais do que qualquer
   normalização, porque cobre também o que já está gravado torto.
4. **Decidir sobre container de exportação no ADR** (GRA-3) e, se entrar,
   renomear a seção para "Carga carregada" de fato, com granito e containers.
5. **Corrigir a contagem de vazios do Baplie na matriz de descarga** (CAR-1) —
   uma condição de `status`, mas que muda números já lidos pelo Financeiro; vale
   conferir contra uma escala real antes.
6. **Restaurar a validação do snapshot** (SNP-1), atualizando a allowlist para as
   chaves que a aba realmente envia, e realinhar ADR 0027/`RASTREABILIDADE.md`.

Nada disso muda o desenho do ADR: as sete seções, o dono departamental, a
resolução explícita e o snapshot de fechamento continuam adequados. O que falha é
o **alcance** — quais escalas entram e quais fatos chegam até elas.

## O que foi corrigido neste PR

**IMP-1 — as Observações por seção nunca saíam no ADR impresso.** A aba grava o
snapshot com `signoffs` na chave de topo (`VoyageAgencyReportTab.tsx:226-245`), e
o documento lia `sections.signoffs` — sempre indefinido. A seção "Observações por
seção" imprimia "—" em todo ADR fechado. O teste existente não pegava porque a
fixture montava o formato errado, o mesmo que o componente lia.

`AgencyReportDocument.tsx` passa a ler `snapshot.signoffs`, mantendo
`sections.signoffs` como fallback para snapshots já congelados em produção com
outro formato, e um teste novo cobre o formato real gravado pela aba.

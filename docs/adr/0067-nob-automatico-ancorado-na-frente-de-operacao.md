# 0067 — NOB automático, ancorado na Frente de Operação do B/L

Status: aceito — 2026-09-14

## Contexto

Dos três avisos operacionais, dois saíam sozinhos e um não. A produtora
`evaluate_and_dispatch_automatic_communications`, que o cron executa a cada 15
minutos, decidia o modelo com um `CASE` de dois ramos:

```sql
v_kind := CASE WHEN v_schedule.ata IS NOT NULL
               THEN 'aviso_prontidao_nor'
               ELSE 'aviso_chegada_noa' END;
```

O NOB não estava nessa frase nem em nenhuma outra. Existia apenas o alerta
`comunicado_nob_pendente`, que abre por terminal com ATB e só fecha quando
alguém dispara o NOB pela tela — um item de trabalho recorrente cuja única
resolução era manual.

A razão de o NOB ter ficado de fora é real, e não preguiça: NOA e NOR são por
**Escala** — um por porto, mesmo público. O NOB é por **Atracação**. Uma escala
com dois terminais tem dois ATBs, dois comunicados e **dois públicos
diferentes**. Produzi-lo automaticamente exige saber qual carga foi
descarregada em qual berço, e essa pergunta parecia não ter resposta no modelo.

Ela tem. O ADR 0035 e a Decisão 7 do design de múltiplos terminais estabelecem
a **Frente de Operação** `(sentido, modalidade)` como a unidade atribuível a um
terminal, e `voyage_escala_operation_fronts` a persiste. O `cargo_mode` do B/L
determina a sua frente de importação. A cadeia estava completa e não era usada:

```
bls.cargo_mode → modalidade → voyage_escala_operation_fronts.terminal_id
                            → voyage_escala_terminal_state (ATB, id)
                            → anchor_atracacao_id do NOB
```

O disparo manual do NOB também nunca usou essa cadeia:
`expandCandidatesForKind` replicava **cada** B/L da escala em **cada** Atracação
dela. Numa escala com dois terminais, o operador que disparasse o NOB do TERM-A
alcançava também os clientes que só descarregaram no TERM-B.

## Decisão

O NOB passa a ser produzido pela régua automática, por Atracação, restrito aos
Clientes cuja carga pertence a uma Frente de Operação atribuída **àquele**
terminal. A mesma restrição passa a valer na conferência manual.

Não há teto de idade do marco. O gatilho do NOB é o **registro** do ATB, não a
idade dele, e o mesmo passa a valer para o NOR: a guarda de 30 dias sobre o ATA
sai junto. O NOA mantém a sua janela, que não é guarda de idade e sim a
definição do comunicado — um aviso de chegada é antecipação, e depois do ETA
quem assume é o NOR.

A regra `cargo_mode → modalidade` ganha dono explícito nos dois lados:
`operationFrontKindForCargoMode` em TypeScript e
`public.bl_operation_front_modalidade` em SQL, presos à mesma tabela de casos
por `escalaOperationFrontKind.test.ts`.

### Atracação sem frente atribuída não comunica

Quando nenhuma Frente de Operação aponta para o terminal — a Atracação **TBC**
do CONTEXT.md —, nenhum NOB é produzido para ela, nem automática nem
manualmente, e o alerta `comunicado_nob_pendente` permanece aberto.

A alternativa recusada era cair para "toda a carga da escala" quando a
atribuição falta. Ela restaura exatamente o defeito que esta decisão corrige,
e o faz de forma invisível: o operador veria uma lista plausível sem saber que
ela mistura os dois berços. Um alerta aberto é um problema legível; um e-mail
para o cliente errado, não.

O custo aceito é que a atribuição de terminal, hoje impeditiva apenas no
fechamento do ADR (Decisão 8), passa a ser pré-requisito também do NOB. Quem não
atribui não comunica.

## Consequências

- O alerta `comunicado_nob_pendente` deixa de ser uma fila de trabalho manual e
  passa a sinalizar **atribuição de terminal faltando**, que é a sua causa real.
- O disparo manual do NOB continua existindo e é o caminho para os buracos que
  restam — cliente cadastrado depois do envio automático, e-mail corrigido
  depois, contato regularizado depois —, agora com o mesmo público da automação.
  Lançamento atrasado do ATB deixa de ser um desses buracos: a régua o alcança.
- Sem teto de idade, um import em massa de histórico depois do go-live
  dispararia NOB para viagem já encerrada. Nenhuma regra de tempo separa isso de
  um lançamento atrasado legítimo — a tentativa de separar por tempo é
  exatamente o defeito que esta decisão remove. A contenção é a chave global de
  envio, que nasce desligada; o upgrade é barrar por estado da viagem, e está
  marcado com `ponytail:` na migration.
- A produtora ganha um laço sobre `voyage_escala_terminal_state`. A leitura de
  escala excluída/omitida em `audit_logs` passa a ter três cópias no banco; a
  duplicação está marcada com `ponytail:` na migration, nomeando o upgrade
  (extrair `voyage_escala_suppressed(voyage_id, port)`).
- `bls.cargo_mode` vira entrada de uma decisão de envio. Um valor novo que não
  seja `carga_solta`, `veiculo` ou `veiculos` cai em `carga_cheia` por padrão,
  em ambos os lados; o teste de paridade falha se um lado ganhar um ramo que o
  outro não tem.

## Alternativas consideradas

**Descer o grão da atribuição ao documento.** Atribuir terminal por B/L
representaria o shifting que parte uma modalidade entre dois berços — o teto
declarado na Decisão 7. Recusada aqui pelo mesmo motivo de lá: troca quatro
cliques por centenas de atribuições manuais por escala. O grão só desce, nunca
precisa subir; esta decisão não fecha essa porta.

**Manter o NOB só manual e melhorar o alerta.** Resolve a ergonomia e não o
defeito: o disparo manual continuaria alcançando os clientes do berço vizinho.

## Relacionados

- ADR 0035 — escala unificada como âncora do ADR
- ADR 0064 — Caixas de Comunicação e auditoria de contatos
- `docs/archive/specs/2026-08-18-escala-multiplos-terminais-design.md` (Decisões 7 e 8)
- Migration `045_comunicados_caixas_e_nob_automatico.sql`

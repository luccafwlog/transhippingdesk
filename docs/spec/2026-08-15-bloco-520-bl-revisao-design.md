# Especificação funcional — B/L, Revisão Manual e Documentação (Bloco #520)

**Status:** aprovada para planejamento técnico  
**Issue:** [#520](https://github.com/luccafwlog/transhippingdesk/issues/520)  
**Épico:** [#519](https://github.com/luccafwlog/transhippingdesk/issues/519)  
**Data:** 2026-08-15

## 1. Objetivo

Definir quando as importações, a Revisão Manual, os B/Ls, containers, cargas
soltas e veículos representam pendências que exigem tratamento, sem confundir
erro transitório de importação com uma entidade persistida que precisa de ação.

Esta especificação também define como uma pendência deve ser projetada na ficha
do B/L, nas listas, na fila de revisão, no sino e na tela global de Alertas.
Ela depende da arquitetura transversal de alertas e das regras compartilhadas
de leitura individual e resolução coletiva.

## 2. Escopo das telas

| Superfície | Responsabilidade no bloco |
|---|---|
| `/manifestos` | Lista de B/Ls, importação em lote e indicação de pendências. |
| `/manifestos/:blId` | Ficha do B/L, painel contextual e correções diretas quando possível. |
| `/revisao` | Fila operacional de B/Ls que impedem o avanço normal do fluxo. |
| `/containers` | Projeção de pendências originadas em B/L, viagem ou Demurrage, sem duplicação. |
| `/carga-solta` | Importação e projeção de pendências dos B/Ls de carga solta. |
| `/veiculos` | Importação com validação antes da persistência; sem pendência própria de vínculo inválido. |
| `/alertas` e sino interno | Projeções transversais do alerta canônico. |

`/revisao` é uma fila de trabalho e não uma segunda fonte de alertas. A mesma
pendência pode ser tratada diretamente na ficha do B/L ou no módulo responsável
por sua origem.

## 3. Princípios

### 3.1 Erro de importação versus pendência persistente

Erro de importação é um resultado da operação de entrada de dados. Ele deve
ser mostrado no modal da própria importação e pode ser preservado no histórico
técnico, mas não cria alerta persistente, notificação ou exclamação.

Pendência persistente existe quando o B/L ou outra entidade foi criada e não
pode avançar no fluxo sem tratamento.

Em importações em lote, linhas válidas continuam sendo processadas mesmo que
outras linhas falhem.

### 3.2 Alerta único por B/L em revisão

Todo B/L que entra em Revisão Manual possui uma pendência bloqueadora e gera:

- um único alerta de revisão por B/L;
- notificação para Documentação;
- exclamação vermelha nas listas e projeções do B/L.

Se houver vários motivos, eles são detalhes do mesmo alerta. A mensagem lista
somente os motivos ainda pendentes.

Correção parcial atualiza o alerta existente. Quando todos os motivos forem
resolvidos:

- o B/L sai da fila de revisão;
- o alerta passa a resolvido;
- a pendência deixa de ser exibida como ativa;
- a exclamação desaparece.

Abrir a revisão, a ficha ou a notificação não resolve o problema.

### 3.3 Ficha contextual

O topo da ficha do B/L exibe painel persistente, visível em todas as abas, com:

- descrição detalhada da pendência;
- motivo e impacto no fluxo;
- departamento responsável;
- ambiente correto da correção;
- ação direta quando disponível;
- estado atual e histórico relevante.

Uma pendência corrigível na ficha deve oferecer a ação ali mesmo. Uma pendência
de outra origem deve encaminhar ao módulo correto, sem fingir que a correção
ocorre na ficha do B/L.

## 4. Importação de B/Ls e carga solta

### 4.1 Importação em lote de B/Ls

O modal deve identificar por linha:

- B/L processado com sucesso;
- B/L rejeitado;
- informação não reconhecida;
- motivo técnico ou de validação.

B/Ls válidos continuam o processamento. Falhas ficam no resultado da operação
e no histórico técnico da importação, mas não geram alerta persistente,
notificação ou marcador visual.

Se um B/L válido entrar posteriormente em Revisão Manual, aplica-se a regra do
alerta único por B/L.

### 4.2 Importação de carga solta

A importação de carga solta segue a mesma separação:

- erro da importação: modal e histórico técnico;
- B/L persistido que entra em Revisão Manual: alerta único por B/L,
  notificação para Documentação e exclamação persistente.

## 5. Motivos da Revisão Manual

Os motivos canônicos atuais do gate de revisão recebem o mesmo tratamento de
pendência do B/L:

- cliente não vinculado;
- cliente sem e-mail cadastrado/utilizável;
- peso de carga solta ausente.

O motivo pode ter uma origem ou correção diferente, mas não cria um alerta
separado. A unidade continua sendo o B/L em Revisão Manual.

Quando o problema for a ausência de e-mail ou Portal do cliente, a pendência
de cliente/Portal segue também a regra própria do bloco de Clientes e Portal.
O B/L continua exibindo a consequência financeira/operacional aplicável, sem
duplicar o alerta geral do cliente.

Quando a reconciliação identificar corretamente o cliente por documento, o
vínculo é resolvido automaticamente. Correspondência somente por nome ou fuzzy
match é sugestão e exige validação.

## 6. Correção direta e correção em outro módulo

### 6.1 Cliente no B/L

Se o cliente já existir, o usuário pode vinculá-lo diretamente na ficha do B/L.
Se não existir, pode iniciar o cadastro pelo fluxo disponível. A revisão é
apoio operacional, não local exclusivo da correção.

### 6.2 Baplie EDI

Se um container associado a um B/L não estiver no Baplie EDI, a inconsistência
é da viagem inteira, porque o Baplie representa o documento da viagem.

- a viagem recebe o alerta canônico;
- não se cria alerta independente para cada B/L ou container;
- B/Ls e containers afetados exibem o contexto e o caminho para o módulo Baplie;
- a correção ocorre no Baplie/viagem;
- a projeção desaparece quando a inconsistência da viagem for corrigida.

Essa regra será implementada no bloco operacional de viagens, mas deve ser
respeitada nas projeções deste bloco.

## 7. Containers

`/containers` pode exibir pendências cujo domínio canônico seja B/L, viagem ou
Demurrage, mas não deve criar cópia do alerta.

- Container descarregado dentro do free time e ainda não devolvido: sem alerta.
- Container fora do free time e não devolvido: pode gerar alerta de Demurrage
  por container, conforme as regras financeiras/operacionais de Demurrage.
- Pendência de cliente, Baplie ou Revisão: exibir contexto e link, mantendo o
  alerta na entidade canônica.

## 8. Veículos

A importação deve validar chassi, B/L, viagem, container, tipo e lacre antes de
persistir o veículo.

Se não houver container válido, o cadastro do veículo é rejeitado. Como a
entidade não é criada, não existe pendência persistente de vínculo a ser
alertada.

Falhas posteriores de faturamento, Portal ou revisão pertencem aos respectivos
domínios e não ao cadastro de veículos.

## 9. Visibilidade, notificação e auditoria

- A tela global `/alertas` exibe o alerta canônico para todos os departamentos.
- O sino encaminha a notificação para Documentação nos casos de Revisão Manual.
- A leitura é individual por usuário e não resolve a pendência.
- A resolução da condição de origem tem efeito coletivo para o departamento.
- Todos os usuários internos podem consultar e executar ações autorizadas, com
  logs completos.
- Ações manuais sensíveis exigem justificativa.
- O log registra usuário, departamento/role, data/hora, entidade, estado
  anterior, estado novo, origem, ação e justificativa.

## 10. Critérios de aceite funcionais

- **520-AC-01:** importação em lote mostra falhas por linha no modal e continua
  processando linhas válidas.
- **520-AC-02:** falha de importação não cria alerta, notificação ou exclamação.
- **520-AC-03:** todo B/L que entra em Revisão Manual possui alerta persistente e
  notificação para Documentação.
- **520-AC-04:** múltiplos motivos de um B/L permanecem em um único alerta.
- **520-AC-05:** correção parcial atualiza a mensagem sem duplicar alerta.
- **520-AC-06:** resolver todos os motivos remove o B/L da fila, resolve o
  alerta e remove a exclamação.
- **520-AC-07:** abrir a ficha ou a notificação não resolve a pendência.
- **520-AC-08:** ficha do B/L exibe painel contextual no topo em todas as abas.
- **520-AC-09:** correção possível na ficha pode ser executada diretamente ali.
- **520-AC-10:** pendência de outro domínio encaminha para o módulo correto.
- **520-AC-11:** carga solta segue as mesmas regras de importação e revisão.
- **520-AC-12:** `/containers` projeta alertas de B/L, viagem ou Demurrage sem
  duplicá-los.
- **520-AC-13:** container dentro do free time sem devolução não gera alerta.
- **520-AC-14:** veículo sem container válido não é persistido e não gera alerta.
- **520-AC-15:** divergência de Baplie gera alerta por viagem, nunca por B/L ou
  container.
- **520-AC-16:** todos os usuários internos veem e podem tratar as pendências,
  com auditoria.

## 11. Fora de escopo e dependências

Este documento não implementa nem redefine:

- a fundação técnica de alertas e notificações;
- os canais de e-mail e o sino transversal;
- a implementação do alerta de Baplie, que pertence ao bloco de viagens;
- a implementação de faturamento, Portal e Demurrage;
- a política de arquivamento de importações além do registro técnico do erro.

Esses pontos devem ser consumidos por contratos comuns e pelos blocos #521,
#522 e #523.

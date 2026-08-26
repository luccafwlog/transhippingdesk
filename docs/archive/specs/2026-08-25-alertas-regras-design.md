# Especificação funcional — Regras de Alertas

> **Nota editorial (2026-08-26).** Spec arquivada: o plano derivado foi
> executado e a rota `/alertas/regras` está em produção. O escopo de §2 ("as 28
> regras ativas do `alert_type_catalog`") está superado: `invoice_payment_invalid`
> e `invoice_cancel_blocked` não têm produtor desde a migration `327` e foram
> desativados no catálogo pela `347`, restando 26 regras ativas e 2 aposentadas.
> A spec também não previa que um alerta pode ser dirigido a mais de um setor.
> Comportamento vigente em
> [`../../modules/operacao-suporte.md`](../../modules/operacao-suporte.md) e na
> revisão [`../audits/2026-08-26-revisao-alertas-e-regras.md`](../audits/2026-08-26-revisao-alertas-e-regras.md).

**Data:** 2026-08-25  
**Status:** aprovada para implementação  
**Rota:** `/alertas/regras`  
**Origem:** melhoria da experiência da fila interna `/alertas`

## 1. Objetivo

Oferecer uma legenda/manual de apoio para que usuários internos entendam o que cada alerta significa, quando ele é gerado, quem deve tratá-lo, qual ação resolve a origem e em qual tela essa ação acontece.

A página é somente leitura. Ela explica as regras existentes; não configura detectores, não resolve itens e não dispensa alertas.

## 2. Escopo

O catálogo deve representar as 28 regras ativas do `alert_type_catalog`, incluindo alertas originados no Portal que exigem tratamento interno:

- `review_customer_unlinked`
- `review_customer_email_missing`
- `review_portal_not_ready`
- `review_breakbulk_weight_missing`
- `review_granite_customer_unlinked`
- `billing_calculation_blocked`
- `billing_auto_issue_failed`
- `invoice_overdue`
- `invoice_payment_invalid`
- `invoice_cancel_blocked`
- `pix_unreconciled`
- `portal_dispute_opened`
- `portal_pendencia_geral`
- `portal_convite_expirado`
- `portal_falha_envio`
- `portal_email_suprimido`
- `portal_abuso_login`
- `portal_excecao_critica_fatura`
- `portal_reprocessamento_falhou`
- `voyage_bl_expected`
- `voyage_baplie_missing`
- `voyage_baplie_documentary_coverage`
- `voyage_ce_mercante_missing`
- `voyage_schedule_date_pending`
- `voyage_terminal_date_pending`
- `voyage_export_after_atd`
- `agency_report_department_pending`
- `agency_report_deadline_missed`

O catálogo educativo deve reutilizar os identificadores, rótulos, severidades, setores e destinos do sistema. O texto explicativo pode ser mantido em um catálogo TypeScript dedicado, porque o banco não contém a linguagem didática de gatilhos e resolução.

Fora de escopo: alterações em migrations, detectores, RPCs, severidade, audiência, ciclo de vida, permissões, fila operacional ou Portal.

## 3. Acesso e navegação

`/alertas` recebe no topo um botão **Regras de Alertas**, com link para `/alertas/regras`. A nova rota permanece dentro do `ProtectedRoute` e do `AppLayout` interno.

O botão deve ser explícito, acessível por teclado e não deve apagar os filtros da fila quando o usuário voltar pelo navegador.

## 4. Estrutura visual

A página usa o layout híbrido aprovado:

1. cabeçalho com título e explicação curta;
2. filtros no topo;
3. contador de regras encontradas;
4. coluna esquerda com a lista filtrada;
5. painel direito com os detalhes da regra selecionada.

Filtros:

- busca livre por nome, resumo, entidade, gatilho ou destino;
- setor responsável: todos, Documentação, Equipamentos e Operações;
- domínio: Operação, Revisão, Financeiro e Portal;
- gravidade: todas, Crítico e Normal;
- ação para limpar todos os filtros.

A primeira regra filtrada é selecionada automaticamente. Em telas estreitas, a lista passa para a parte superior e o detalhe ocupa a largura disponível.

## 5. Conteúdo de cada verbete

Cada regra deve apresentar, com linguagem de negócio e sem chaves técnicas:

- nome e gravidade;
- resumo do que o alerta sinaliza;
- entidade afetada;
- setor responsável;
- gatilho;
- prazo e condição de aparecimento;
- como resolver a causa;
- tela de resolução com link para o destino atual;
- o que acontece após a correção;
- método de dispensa.

O manual deve diferenciar explicitamente resolução da origem e dispensa temporária. A dispensa é descrita como ação coletiva temporária, com motivo obrigatório e data futura de revisão; ela não libera um gate nem corrige a causa.

Regras derivadas devem explicar que o fechamento ocorre quando a origem é corrigida e o sistema reconcilia o item. Abrir a tela de destino, ler o alerta ou receber uma notificação não deve ser descrito como resolução.

## 6. URL e acessibilidade

A regra selecionada deve ser refletida em `?regra=<tipo>`. Filtros e seleção devem ser preserváveis em URL para permitir retorno e compartilhamento de contexto.

A lista deve ter foco visível, navegação por teclado e semântica de seleção; o painel deve ser associado à regra selecionada por `aria-controls`/`aria-selected` ou equivalente semântico. A solução responsiva não pode esconder o conteúdo explicativo.

## 7. Verificação

Devem existir testes para:

- completude: cada uma das 28 regras ativas do catálogo SQL possui exatamente um verbete;
- integridade: todo verbete possui os blocos essenciais e destino válido;
- filtros combinados e limpeza;
- seleção automática e deep-link por `regra`;
- renderização segura do painel.

Antes da entrega, executar `npm run docs:check`, lint, testes, build e `git diff --check`.

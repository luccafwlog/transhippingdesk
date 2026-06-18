# Portal do Cliente - Area Operacional

Status: aprovado para especificacao - 2026-06-09

## Contexto

O Portal do Cliente hoje esta centrado em `/portal/billing`: consulta faturas de taxas locais, faturas de demurrage, PIX e consolidacao de B/Ls. O cliente precisa tambem consultar informacoes operacionais pontuais sem depender da existencia de uma fatura.

Os dados pedidos ja existem no dominio principal:

- `bls.ce_mercante` guarda a numeracao de CE Mercante do B/L.
- `bl_containers.discharge_date`, `return_date` e `demurrage_status` guardam as datas e o estado de demurrage por container.
- `bls.free_time_override` e as tabelas de demurrage definem o free time aplicavel.
- As RPCs do portal ja resolvem o cliente via `current_portal_customer_id()` e usam `SECURITY DEFINER` com filtro explicito por cliente.

## Objetivo

Adicionar uma area operacional somente leitura ao Portal do Cliente, para que o cliente visualize seus B/Ls e containers com CE Mercante, datas de descarga/devolucao, dias de uso, free time e dias em demurrage.

## Fora de Escopo

- Edicao de dados operacionais pelo cliente.
- Exposicao de valores monetarios estimados de demurrage fora de fatura emitida.
- Alteracao de regras de faturamento, conciliacao, PIX ou consolidacao.
- Portal publico, cadastro publico ou mudanca no modelo de autenticacao.
- Suporte a cargas que nao tenham containers para os campos de uso/devolucao; nesses casos a area mostra o B/L e informa que nao ha containers vinculados.

## Abordagens Consideradas

1. Enriquecer apenas os detalhes de faturas existentes.
   - Menor mudanca.
   - Mantem o portal preso ao contexto financeiro e nao atende bem ao pedido de "nao apenas faturamento".

2. Criar uma nova area `/portal/operacao`.
   - Melhor equilibrio entre escopo e valor.
   - Separa informacao operacional de documentos financeiros.
   - Reusa o padrao atual de RPCs escopadas por cliente.

3. Criar um dashboard operacional amplo.
   - Mais flexivel para evolucoes futuras.
   - Grande demais para esta entrega e incluiria features nao pedidas.

A abordagem escolhida e a 2.

## Experiencia do Usuario

O `PortalLayout` passa a ter navegacao simples com duas entradas:

- Faturas: rota atual `/portal/billing`.
- Operacao: nova rota `/portal/operacao`.

A pagina `PortalOperacao` mostra uma lista de B/Ls do cliente autenticado. Cada B/L deve exibir:

- B/L.
- CE Mercante.
- Navio/viagem.
- POL/POD.
- Quantidade de containers.
- Resumo de status dos containers.

O cliente consegue abrir o detalhe de um B/L na propria pagina. O detalhe mostra uma tabela de containers com:

- Numero do container.
- Tipo.
- Data de descarga.
- Data de devolucao.
- Dias de uso.
- Free time.
- Dias em demurrage.
- Status operacional derivado: sem descarga, dentro do free time, em demurrage ou devolvido.

A pagina deve ter estados claros de carregamento, vazio e erro, seguindo os componentes e estilos existentes do portal.

## Dados e Contrato

Criar a RPC `portal_list_operation_bls()` em migration Supabase. A RPC deve:

- Resolver o cliente com `public.current_portal_customer_id()`.
- Retornar apenas B/Ls cujo `customer_id` seja o cliente autenticado.
- Trazer B/Ls de `public.bls`; granite fica fora desta primeira entrega porque o pedido se refere a CE/BL e dias de uso de container no fluxo principal.
- Incluir navio/viagem via `voyages` e `vessels`.
- Agregar containers de `bl_containers` por B/L.
- Retornar JSONB com payload estavel para o frontend.

Formato conceitual do payload:

```json
[
  {
    "bl_id": "BL001",
    "ce_mercante": "123456789012345",
    "pol": "CNSHA",
    "pod": "BRVIX",
    "voyage_id": 10,
    "voyage_number": "001W",
    "vessel_name": "NAVIO",
    "free_time_days": 21,
    "containers": [
      {
        "id": 1,
        "container_number": "ABCD1234567",
        "type": "40GP",
        "discharge_date": "2026-06-01",
        "return_date": "2026-06-20",
        "usage_days": 19,
        "free_time_days": 21,
        "demurrage_days": 0,
        "status": "devolvido"
      }
    ]
  }
]
```

## Calculo de Dias

Os calculos devem ser consistentes com a semantica atual de demurrage. Dias de uso sao a diferenca em dias calendario entre a data final e a data de descarga, seguindo a convencao atual em que 2026-01-01 ate 2026-01-15 resulta em 14 dias.

- Sem `discharge_date`: `usage_days`, `free_time_days` aplicado e `demurrage_days` ficam nulos no container.
- Com `discharge_date` e sem `return_date`: `usage_days` conta de `discharge_date` ate `CURRENT_DATE`.
- Com `return_date`: `usage_days` conta de `discharge_date` ate `return_date` e encerra nessa data.
- `free_time_days` vem de `bls.free_time_override` quando preenchido; caso contrario vem da tabela ativa de demurrage para o tipo do container. Se a tabela nao tiver correspondencia, usar fallback de 10 dias para containers reefer (`20RF`, `20RQ`, `20R1`, `40RF`, `40RQ`, `40R1`, `45R1`) e 21 dias para os demais tipos, alinhado aos defaults atuais do modulo.
- `demurrage_days = GREATEST(usage_days - free_time_days, 0)` quando ambos existirem.
- Status derivado por container:
  - `sem_descarga`: nao ha `discharge_date`.
  - `devolvido`: ha `return_date`.
  - `em_demurrage`: nao ha `return_date` e `demurrage_days > 0`.
  - `dentro_free_time`: nao ha `return_date` e `demurrage_days = 0`.

Para evitar divergencia entre frontend e banco, o backend deve retornar os numeros ja calculados. O frontend apenas formata e filtra.

## Seguranca

- A nova RPC deve seguir o padrao do portal: `SECURITY DEFINER`, `SET search_path TO 'public', 'pg_temp'` e filtro por `current_portal_customer_id()`.
- Nao expor dados de outros clientes por joins indiretos.
- Nao expor campos internos desnecessarios, notas, auditoria, dados fiscais completos ou valores de demurrage estimados.
- Manter `GRANT EXECUTE` apenas para os roles usados pelo portal conforme padrao atual.

## Componentes e Servicos

Frontend esperado:

- Novo service `src/services/portalOperation.ts`, seguindo o estilo atual de `portalListInvoices`.
- Novo hook `src/hooks/usePortalOperation.ts`, com React Query habilitado apenas quando o portal estiver autenticado.
- Nova pagina `src/pages/PortalOperacao.tsx`.
- Nova rota em `src/App.tsx`.
- Link de navegacao em `src/components/layout/PortalLayout.tsx`.

A implementacao deve preferir nomes em portugues na interface e manter nomes estruturais em ingles, conforme convencao do projeto.

## Testes

Cobertura minima:

- Teste unitario do normalizador/service para garantir arrays default, numeros convertidos e ausencia de quebra com containers vazios.
- Teste da migration SQL verificando que a RPC nova existe, usa `current_portal_customer_id()` e filtra por `customer_id`.
- Teste de UI da pagina com dados mockados cobrindo B/L com CE, container devolvido e container ainda sem devolucao.

Verificacoes finais:

- Rodar os testes focados da feature: service/normalizador, migration SQL e UI da nova pagina.
- Rodar `npm run build`.
- Rodar `npm run test` completo quando a implementacao alterar helpers compartilhados usados fora do portal.
- Validacao manual no navegador se houver servidor local disponivel.

## Criterios de Aceite

- Cliente autenticado acessa `/portal/operacao`.
- Cliente ve apenas B/Ls do seu proprio `customer_id`.
- Cada B/L mostra CE Mercante quando cadastrado.
- Containers mostram descarga, devolucao, dias de uso, free time e dias em demurrage.
- Quando existe data de devolucao, os dias de uso encerram na devolucao.
- Quando nao existe data de devolucao, os dias de uso contam ate a data atual.
- A area nao permite edicao nem expoe valores monetarios estimados.

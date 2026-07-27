# Revisão de arquitetura — oportunidades de aprofundamento (25 jul 2026)

> Registro histórico. Relatório produzido na branch
> `claude/improve-codebase-architecture-d5gqu5` em 25 jul 2026, entregue como
> HTML, e **conferido contra o repositório em `eab066c` no dia 27 jul 2026**.
> A conferência está registrada aqui na coluna *Verificação*.
>
> O trabalho derivado dele está em
> [`../../plans/2026-07-27-aprofundamento-arquitetural.md`](../../plans/2026-07-27-aprofundamento-arquitetural.md)
> (mova o link para `../plans/` quando o plano for arquivado).

## Método do relatório

Cinco candidatos ordenados por atrito observado no código, não por elegância
teórica. Cada um propõe transformar um **módulo raso** (interface quase tão
complexa quanto a implementação) num **módulo profundo** (muito comportamento
atrás de uma interface pequena). Nenhuma linha de código-fonte foi alterada
para produzir o relatório.

Critério de aceitação usado em cada candidato — o **teste da deleção**: imagine
apagar o módulo. Se a complexidade some, ele era pass-through. Se reaparece
espalhada por N chamadores, ele se pagava.

## Candidatos

| # | Candidato | Conceito de domínio | Força | Verificação (27 jul, `eab066c`) |
|---|---|---|---|---|
| 01 | Seam de invalidação de cache | Viagem, B/L, Revisão Operacional | Strong | **Confirmado** — 217 invalidações literais em 39 arquivos; `Viagens.tsx` com 6 listas sobrepostas e 3 divergências reais |
| 02 | Leitura da recusa do banco | Dupla proteção RBAC | Strong | **Confirmado** — 7 cópias de `isPermissionError`, só `reports.ts` trata `PGRST301` |
| 03 | Pipeline de importação de planilha | Importações (Baplie, B/L, Vazios, Granito, Veículos) | Strong | **Confirmado com ressalva** — ver abaixo |
| 04 | `voyageSummaries`: 28 funções puras sem dono | Próxima Escala, Estado de Conciliação | Worth exploring | **Confirmado** — 923 linhas, 29 exports, 9 consumidores |
| 05 | ADR: projeção da Escala pelos módulos de origem | Agency Departure Report, Escala portuária | Worth exploring | **Confirmado** — 8 `.from()` de tabelas alheias em `agencyDepartureReport.ts:301–332` |

## Métricas do relatório, reconferidas

| Afirmação | Estado em `eab066c` |
|---|---|
| 661 arquivos `.ts/.tsx` em `src/` | 661 ✅ |
| 328 arquivos de teste | 333 (cresceu 5) ✅ |
| 217 invalidações de cache com chave literal | 217, em 39 arquivos ✅ |
| 7 cópias de `isPermissionError` | 7 ✅ |
| 223 × `if (error) throw error` | 227 (cresceu 4) ✅ |
| 28 exports em `voyageSummaries.ts` | 29 (cresceu 1) ✅ |
| `importCore` usado por 3 de 10 parsers | 3 ✅ |
| `FileImportModal` usado por 1 de 7 telas | 1 ✅ |
| 5 combinações divergentes de opções do `xlsx` | 5 ✅ |
| `Object.entries(headerMap).find(...)` em 5 arquivos | 5 ✅ |
| `charges/` e `lineup.ts` sem teste | `charges/` com **zero** testes; `fetchLineUpSnapshot` (427 linhas) nunca exercido ✅ |
| 6 páginas com máquina de estado de importação à mão | **7** — `src/pages/Clientes.tsx` não foi contada |

## Duas correções ao relatório

**1. O candidato #03b subestima o trabalho.** O relatório afirma que "um bom
módulo profundo está sendo desperdiçado **por um parâmetro**" — que bastaria
trocar `voyageLabel` por um `subtitle` opcional para as telas adotarem
`FileImportModal`. As 6 páginas renderizam um `VoyageCombobox` **dentro** do
modal, antes do input de arquivo: o operador escolhe a Viagem de destino e só
então anexa o arquivo. `FileImportModal` vai direto ao input, porque assume que
a Viagem já é conhecida — a situação do seu único usuário
(`VoyageImportActions`, chamado de dentro da página de uma Viagem). Remover
`voyageLabel` é necessário mas não suficiente; o módulo também precisa de um
slot de pré-requisito que trave o input até estar satisfeito.

**2. A contagem de telas de importação é 7, não 6.** `src/pages/Clientes.tsx`
também reconstrói o trio `file` / `parsing` / `importing`.

## Recomendação do relatório

Começar pelo **#01**, por três motivos que os outros candidatos não têm:

- **O codebase já tentou duas vezes e acertou as duas.** `reviewCaches.ts` e
  `baplieInvalidation.ts` são dois adapters do mesmo seam — e dois adapters
  significam que o seam é real, não uma hipótese de arquitetura. O comentário
  do primeiro documenta exatamente a classe de bug que o seam previne, escrito
  por quem levou o bug.
- **É mecânico** — nenhuma regra de domínio muda de lugar, o que o torna
  revisável linha a linha.
- **É habilitador** — o #05 fica mais fácil quando o ADR pode declarar "fechei
  o relatório" em vez de listar seis chaves, e o #04 fica mais fácil quando as
  invalidações da Viagem já falam de Viagem.

O **#02** é o segundo natural: mesma forma, mesma evidência de fork, e fecha
uma lacuna adjacente à segurança — hoje uma recusa de RLS chega ao operador
como texto cru do PostgREST, apesar de a Dupla proteção RBAC tratar essa
recusa como a autoridade do sistema.

## Achado adjacente (não arquitetural)

`src/services/charges/chargeOperationsService.ts` (626 linhas, coração das
Taxas Locais) e `src/services/lineup.ts` (521 linhas) não têm arquivo de teste,
embora sejam perfeitamente testáveis — 59 arquivos de teste do projeto já
mockam `supabase` com `vi.mock`. É lacuna de cobertura, não de desenho.

## Vocabulário usado no relatório

| Termo | Significado |
|---|---|
| Módulo | Qualquer coisa com interface e implementação: função, classe, pacote, fatia. |
| Interface | Tudo que o chamador precisa saber — tipos, invariantes, modos de erro, ordem, configuração. Não só a assinatura. |
| Profundidade | Alavancagem na interface: muito comportamento atrás de pouca superfície. |
| Raso / Profundo | **Raso**: a interface custa quase tanto quanto a implementação. **Profundo**: alta alavancagem. |
| Seam | Onde uma interface mora — o ponto em que o comportamento pode ser alterado sem editar no lugar. |
| Adapter | Algo concreto que satisfaz uma interface num seam. Um adapter = seam hipotético; dois = seam real. |
| Locality | O que o mantenedor ganha com profundidade: mudança, bug e conhecimento concentrados num lugar. |
| Teste da deleção | Imagine apagar o módulo. Se a complexidade some, era pass-through. Se reaparece espalhada por N chamadores, ele se pagava. |

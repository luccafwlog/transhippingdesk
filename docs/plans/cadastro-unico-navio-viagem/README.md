# Implementation Plans — Cadastro único de navio/viagem (ADR 0021)

Gerados pela skill `writing-plans` em 2026-07-09, a partir da sessão de design
registrada em `docs/adr/0021-cadastro-unico-navio-viagem-programacao-projeta-viagem.md`
e nas entradas **Rota da Viagem** e **Programação de Navios (Chegadas e Saídas)**
do `CONTEXT.md`. Cada plano é autocontido: o executor não precisa (nem deve
assumir) contexto da sessão que os gerou.

> **Para executores agênticos:** implemente um plano por vez, na ordem abaixo.
> Cada plano tem TDD embutido (checkboxes). Rode toda verificação e confirme o
> resultado esperado antes de avançar. Honre as STOP conditions. Ao terminar um
> plano, atualize a linha dele na tabela.

## Problema

Hoje o operador cadastra o mesmo navio/viagem em dois lugares desconexos:

- **Tela Viagens** (`/viagens`) — cria a `voyage` real e sua **Rota**
  (POL+ETD / POD+ETA…), que alimenta manifestos, B/Ls, Baplie, faturamento e
  Line-Up TV.
- **Tela Chegadas e Saídas** (`/chegadas-saidas`) — grava na tabela isolada
  `vessel_schedules` (colunas fixas por porto, datas em texto livre), que
  alimenta só o widget "Programação de Navios" do Portal.

Não há vínculo. O navio é digitado duas vezes e os dados divergem.

## Decisão (ADR 0021)

Cadastrar em Chegadas e Saídas **é** cadastrar a Viagem; o widget do Portal
deixa de ter fonte própria e **projeta a Viagem**. Resumo das decisões travadas:

- Datas exigidas via seletor (ISO, com ano). `"X"` → estado "não escala" →
  porto sem data **não entra na rota**.
- Dedup por **VOY + IMO** (fallback nome normalizado): anexa à viagem existente
  em vez de duplicar.
- Sobrescrita a partir de Chegadas toca **só ETD (POL) e ETA (POD)**; ATA/ATD/
  RTW/CE status/linked nunca são tocados. Em conflito de ETD/ETA, digitação nova
  vence.
- Portal: colunas-vitrine fixas (constante única compartilhada), flag
  `show_on_portal` (default ligado p/ Chegadas, desligado p/ manual), ordenação
  automática por ETA, saída ao ficar `completed`.
- Armador default Cosco/CSSC silencioso. Tela Viagens ganha campos POL/ETD.
- Upload em lote mantido, reescrito sobre viagens. Sem migração (produção é teste).

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [01](./01-portas-vitrine-constante.md) | Constante única de portos-vitrine + LOCODEs canônicos | P1 | S | — | TODO |
| [02](./02-create-or-attach-voyage-flag.md) | `show_on_portal` + `createOrAttachVoyageFromSchedule` (serviço + migração) | P1 | M | 01 | TODO |
| [03](./03-chegadas-saidas-cria-viagem.md) | Formulário Chegadas e Saídas cria/anexa a Viagem | P1 | M | 02 | TODO |
| [04](./04-portal-projeta-viagem.md) | Portal projeta a Viagem (RPC `portal_ship_schedule` + widget) | P1 | M | 01, 02 | TODO |
| [05](./05-viagens-campos-pol-etd.md) | Tela Viagens ganha campos POL/ETD no cadastro | P2 | S | 01 | TODO |
| [06](./06-upload-lote-sobre-viagens.md) | Upload em lote reescrito sobre viagens | P2 | M | 01, 02 | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (motivo em uma linha) |
REJECTED (justificativa em uma linha).

## Dependency notes

- **01 é a fundação**: a constante de portos-vitrine governa colunas do Portal
  (04), campos do formulário de Chegadas (03) e template/mapeamento do upload
  (06). Faça-o primeiro.
- **02 é o núcleo**: expõe `createOrAttachVoyageFromSchedule` e adiciona a coluna
  `show_on_portal`. 03, 04 e 06 dependem dele.
- **03, 04, 05, 06 são paralelizáveis** entre si depois de 01+02, mas cada um é
  um PR próprio testável. Ordem recomendada: 01 → 02 → 03 → 04 → 05 → 06.
- **Sem migração de dados**: `vessel_schedules`/`ended_vessels` em produção são
  teste (decisão do operador). Nenhum plano faz backfill. As tabelas antigas
  ficam **inertes** (nenhuma tela nova escreve nelas) até serem removidas por um
  plano futuro, fora deste conjunto.

## Fronteira de segurança (revisor humano, atenção)

O plano **04** cria uma RPC `SECURITY DEFINER` para o Portal (cliente `anon`)
ler a programação projetada das viagens, em vez de expor `audit_logs`/`voyages`
diretamente ao `anon`. Isso segue as ADRs 0004 (RLS/RPC como fronteira), 0011
(default-deny de `anon`) e 0013 (exceção `anon` limitada). Nenhuma tabela nova é
concedida a `anon`; o acesso é só via a RPC allowlisted.

## Findings considered and rejected

- **Sincronização bidirecional `vessel_schedules` ⇄ `voyages`** (desenho B do
  ADR): rejeitado no ADR 0021 — mantém dois registros que divergem.
- **Espelhar `vessel_schedules` por trigger** (desenho C): rejeitado — mantém
  espelhamento sem benefício sobre projetar a viagem na leitura.
- **Tabela configurável de portos-vitrine**: rejeitado por ora (YAGNI); a rota
  do serviço é estável. Constante versionada elimina a duplicação atual.
- **Migração heurística das datas texto→ISO legadas**: rejeitado — produção é
  teste; parse de `"22/01"` sem ano planta dado ruim na operação.

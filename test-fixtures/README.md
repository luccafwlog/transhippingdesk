# Test Fixtures — Auditoria E2E (viagem → reconciliação)

Arquivos de importação consistentes entre si, para uma viagem de teste
(`QA TEST VESSEL`, voyage `QA001E`, CNSHA → BRSSA).

| Arquivo | Tela de import | Conteúdo |
|---|---|---|
| `qa-baplie-3cntr.edi` | `/baplie` (Baplie EDI) | 3 containers: `TEMU1234567` (45G1, 18.500 kg), `TGHU7654325` (45G1, 17.200 kg), `CSNU2049996` (22G1, 21.300 kg, IMO classe 9 / UN 3171). B/Ls `QABL001` e `QABL002`, slots e POL/POD por container. |
| `qa-manifest-cntr.xlsx` | `/manifestos` (Manifesto CNTR) | Formato header-mapped. 2 B/Ls / 3 containers, mesmos números do Baplie. `QABL001` → QA IMPORTADORA LTDA (CNPJ 11444777000161), `QABL002` → QA COMERCIO EXTERIOR SA (CNPJ 60746948000112). Pesos e CBM preenchidos para faturamento. |
| `qa-veiculos.xlsx` | `/veiculos` (Importar veículos) | 2 veículos (VW NIVUS e PEUGEOT 2008) dentro do container `TEMU1234567`, B/L `QABL001`, tipo `40HC` — exige que o manifesto CNTR já tenha sido importado. |

Ordem de uso: criar viagem → importar baplie → importar manifesto → importar veículos.

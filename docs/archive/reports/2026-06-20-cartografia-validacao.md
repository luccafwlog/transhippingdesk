# Cartografia e validação — registro de 2026-06-20

Registro histórico da validação executada sem ambiente Supabase configurado. Não é
um roteiro atual nem prova de comportamento Runtime posterior.

**Ambiente classificado:** `unavailable`.

O checkout não possuía `.env`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_RUN_INTEGRATION`, Supabase CLI vinculada ou credenciais/sessões
autorizadas. Nenhuma escrita externa foi tentada.

O Vite foi iniciado em `http://127.0.0.1:4176`. O navegador alcançou as rotas
públicas, porém o bootstrap exibiu **Erro de configuração** e registrou no
console que as duas variáveis `VITE_SUPABASE_*` eram obrigatórias. Portanto,
essa execução não provou renderização funcional, Auth, RLS, RPC, banco ou Edge
Functions.

| Fluxo | Ambiente | Status | Resultado | Evidência / limitação |
|---|---|---|---|---|
| Bootstrap local e `/login` | Local sem Supabase | parcial | Vite respondeu HTTP 200, mas a aplicação interrompeu o bootstrap no erro de configuração esperado | Browser em `127.0.0.1:4176/login`; console e heading “Erro de configuração” |
| `/portal/login` | Local sem Supabase | parcial | URL alcançada; formulário não renderizou porque o bootstrap exigia configuração Supabase | Browser, heading “Erro de configuração” |
| `/portal/esqueci-senha` | Local sem Supabase | parcial | URL alcançada; fluxo de recovery não pôde iniciar | Browser, heading “Erro de configuração” |
| `/portal/recuperar-senha` sem tokens | Local sem Supabase | parcial | URL alcançada; tratamento da ausência de tokens ficou bloqueado antes da montagem da página | Browser, heading “Erro de configuração” |
| Rota desconhecida | Local sem Supabase | parcial | URL foi servida, mas o redirecionamento por estado de Auth não pôde ser observado | Browser em `/rota-inexistente-cartografia`; bootstrap bloqueado |
| Login interno, perfil, logout e `/admin/usuarios` | Sem credenciais/Supabase | não executado | Requer sessão interna e projeto controlado | Nenhuma credencial foi solicitada ou inferida |
| Login Portal por identificador, logout, coexistência e recovery | Sem credenciais/Supabase | não executado | Requer Auth e ambiente controlado | Resolver/rate limit não foram exercitados |
| Histórico remoto de migrations, incluindo `20260619190144` | Sem CLI vinculada | não executado | Não foi possível comparar histórico local e remoto | Supabase CLI e `.temp/project-ref` ausentes |
| Viagem → Baplie → manifesto → reconciliação → veículos | Sem Supabase controlado | não executado | Fixtures existiam, mas nenhuma entidade foi persistida | `test-fixtures/README.md`; writes bloqueadas pelo gate de ambiente |
| Revisão, gate canônico e auto-faturamento | Sem Supabase controlado | não executado | Não houve criação/correção de B/L nem emissão | Cobertura estática e automatizada registrada nos módulos |
| Detalhe do B/L: três abas, NCM, Notify e Histórico | Sem Supabase controlado | não executado | Não houve B/L de QA navegável | Testes focados cobriam tabs, NCM, parser e apresentação; não eram Runtime |
| Dashboard, Line-Up, alertas, relatórios e drawer de revisão | Bootstrap bloqueado | bloqueado | Superfícies protegidas não montaram | Configuração Supabase obrigatória ausente |
| Taxas locais, invoice individual/consolidada e impressão | Sem Supabase controlado | não executado | Nenhuma mutação financeira ou preview com dados reais | Testes focados e contratos SQL não provavam persistência/Runtime |
| Conciliação PIX | Sem Supabase controlado | não executado | Workbook de QA não foi gerado nem submetido | Nenhuma transação/invoice de QA disponível |
| Demurrage, overrides, devolução auditada e invoice | Sem Supabase controlado | não executado | Nenhum container ou invoice de QA foi alterado | Cálculo e auditoria tinham teste automatizado, sem prova Runtime |
| Granite | Sem Supabase controlado/fixture compatível | não executado | Nenhuma planilha foi fabricada para obter cobertura artificial | Ausência de fixture Granite registrada no módulo |
| Portal: escopo de cliente, CE gate e self-service | Sem conta Portal de QA | não executado | Não houve acesso a dados autenticados nem mutação | Requer conta e entidades descartáveis |
| Programação de navios e widget Portal | Sem Supabase controlado | não executado | CRUD/import/archive/realtime não exercitados | Cobertura Runtime continuava necessária |
| Integração Supabase | Sem configuração | não executado | `npm run test:integration` não foi habilitado | `SUPABASE_RUN_INTEGRATION` ausente |

Integração Supabase não executada: ambiente controlado não configurado.

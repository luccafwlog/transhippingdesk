# 0008 — Demurrage integrado sem unificar persistência

Status: aceito — 2026-06-09

## Contexto

Demurrage depende do ciclo físico do container: descarga, devolução, free time, tipo de equipamento, tarifas e eventuais descontos. Embora apareça para o usuário junto de faturamento, portal e conciliação PIX, sua origem de dados é diferente das taxas locais por B/L.

Unificar Demurrage no ledger local simplificaria algumas telas, mas misturaria uma cobrança por container com recebíveis por B/L e aumentaria risco de regressão no cálculo.

## Decisão

Manter Demurrage em persistência própria, integrada nas superfícies financeiras sem absorvê-la pelo ledger local.

- `bl_containers` guarda datas operacionais relevantes para cálculo.
- `demurrage_rates` define tarifas.
- `demurrage_invoices` e `demurrage_invoice_items` representam documentos e itens de Demurrage.
- Services em `src/services/demurrage/` concentram cálculo, listagem, emissão, edição controlada e KPIs.
- O sistema rejeita devolução anterior à descarga na camada de cálculo, UI/importação e constraint de banco.
- `/faturamento`, `/demurrage`, `/reconciliacao` e `/portal/billing` podem exibir Demurrage junto de outras cobranças, mas cada baixa respeita o backend correto: ledger/RPC para taxas locais, atualização própria para Demurrage.

## Consequências

- **Positivas**: cálculo por container continua isolado e testável; a UI financeira entrega visão unificada sem forçar um modelo contábil único; regressões de ledger local não afetam diretamente Demurrage.
- **Negativas / custos**: conciliação PIX precisa tratar fontes diferentes; relatórios e portal precisam agregar famílias de invoice distintas.
- **Regra prática**: integrações devem unificar a experiência do usuário, não necessariamente a tabela de persistência, quando o domínio tem invariantes diferentes.

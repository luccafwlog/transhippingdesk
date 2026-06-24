# Context: Demurrage

Cobrança pela sobreestadia de containers — tempo entre descarga e devolução ao pátio, excedendo o free time contratado.

## Glossary

### Free Time

Período após a descarga durante o qual o container pode ficar no pátio sem cobrança. Definido por container type (grupo tarifário) ou por override por B/L.

### P1 (Período 1)

Primeira faixa tarifária após o free time. Taxa diária em USD aplicada aos dias entre o fim do free time e o início de P2. Quando o free time override do B/L é maior que o fim de P1 do grupo, P1 tem zero dias e a cobrança inicia direto em P2.

- **Synonyms / avoid:** "taxa P1", "tarifa P1"
- **Related:** Free Time, P2

### P2 (Período 2)

Segunda faixa tarifária, com taxa diária superior a P1. Aplicada a partir do dia definido pelo grupo tarifário, independentemente do free time override do B/L.

- **Synonyms / avoid:** "taxa P2", "tarifa P2"
- **Related:** P1, Free Time

### Free Time Override

Valor de free time específico de um B/L, sobrescrevendo o padrão do grupo tarifário. Afeta apenas o início da cobrança (P1 começa em override+1), sem deslocar as faixas P1/P2.

- **Related:** Free Time, P1, P2

### ROE (Taxa de Câmbio)

Taxa de câmbio USD→BRL aplicada à invoice, calculada a partir da PTAX do BCB com markup de 1,065. **Não é congelada na emissão**: enquanto a invoice não está paga, o ROE é recalculado a cada nova PTAX divulgada pelo BCB (dias úteis). O congelamento real do valor ocorre apenas no momento do pagamento, registrado de forma imutável no histórico da invoice. As colunas que guardam o último valor recalculado chamam-se `current_roe` e `current_total_brl`.

- **Related:** PTAX, Markup, Recálculo Diário

### Markup

Fator multiplicativo (1,065) aplicado à PTAX para obter o ROE. É o **spread fixo cobrado pelo armador**, não uma margem de proteção contra flutuação cambial — a proteção cambial deixa de existir quando o valor passa a ser recalculado diariamente.

- **Related:** ROE, PTAX

### Invoice de Demurrage

Documento financeiro que cobra sobreestadia de containers. Cada item armazena a composição completa do cálculo: free days, dias P1, taxa P1, dias P2, taxa P2, subtotal. O cliente (portal) deve ver free time e valor por período para garantir transparência. O admin vê o detalhe completo incluindo ROE e descontos.

- **Related:** P1, P2, Free Time, ROE

### Tarifa de Demurrage (Rate)

Configurável por container type com vigência temporal. A resolução usa precedência: override do B/L > tarifa do banco > fallback. A tarifa do banco é a única fonte de verdade; não existe fallback estático. O `active` flag é o mecanismo de desativação imediata; `valid_to` é para expiração agendada.

- **Related:** P1, P2, Free Time, Free Time Override

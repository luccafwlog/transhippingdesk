/**
 * Aliases de embed do PostgREST para pares de tabelas ligados por MAIS DE UMA
 * foreign key.
 *
 * Quando existe mais de um caminho de FK entre duas tabelas, o PostgREST nao
 * consegue escolher sozinho e responde `300 Multiple Choices` (`PGRST201`) —
 * a request inteira falha, nao so o embed. O `bls` aponta duas vezes para
 * `customers` (`customer_id`, o cliente efetivo, e `suggested_customer_id`, a
 * sugestao do importador de manifesto criada na migration 285), entao todo
 * embed entre `customers` e `bls` precisa nomear a FK explicitamente.
 *
 * Use estas constantes em vez de escrever `bls(...)` ou `customers(...)` cru:
 * `src/lib/__tests__/supabaseEmbeds.test.ts` varre o codigo-fonte e falha se
 * algum select voltar a usar a forma ambigua -- seja o embed aninhado
 * (`customers(... bls(...))`) ou o de primeiro nivel, cuja tabela raiz vem do
 * `.from(...)`. A ambiguidade so existe quando uma das duas e PAI da outra:
 * `bl:bls(...)` pendurado em `invoice_bls` tem caminho unico e dispensa a dica.
 */

/** Embed de `customers` -> `bls` pelo cliente efetivo (`bls.customer_id`). */
export const BLS_OF_CUSTOMER = 'bls!bls_customer_id_fkey'

/** Idem, forçando INNER JOIN (só clientes que possuem B/L). */
export const BLS_OF_CUSTOMER_INNER = `${BLS_OF_CUSTOMER}!inner`

/** Embed de `bls` -> `customers` pelo cliente efetivo (`bls.customer_id`). */
export const CUSTOMER_OF_BL = 'customers!bls_customer_id_fkey'

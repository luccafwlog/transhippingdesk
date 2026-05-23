-- Migration 051: aceita 'granito' como cargo_mode em charge_tables
--
-- Permite que o motor de Taxas Locais cubra B/Ls de Granito além de Container
-- e Carga Solta. A mudança é puramente aditiva: nenhuma linha existente é
-- afetada e nenhum default é alterado.
--
-- Contexto:
--  - granite_bls continua em tabela separada de bls (cargo_mode='granito'
--    nao se aplica a granite_bls); o cargo_mode adicional aqui serve para
--    permitir charge_tables especificas de granito e dar suporte ao
--    chargeOperationsService que agora une bls e granite_bls na visao
--    operacional de /taxas-locais.

ALTER TABLE public.charge_tables
  DROP CONSTRAINT IF EXISTS charge_tables_cargo_mode_check;

ALTER TABLE public.charge_tables
  ADD CONSTRAINT charge_tables_cargo_mode_check
  CHECK (cargo_mode IN ('container', 'carga_solta', 'granito'));

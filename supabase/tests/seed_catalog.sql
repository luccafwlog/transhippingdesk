\set ON_ERROR_STOP on

-- Executar depois do replay completo das migrations em PostgreSQL descartável.
-- O seed contém as asserções de contagem; este teste cobre os invariantes que
-- evitam o retorno do catálogo legado nas branches automáticas.
\ir ../seed.sql

DO $seed_catalog_test$
DECLARE
  v_legacy_tables INTEGER;
  v_demurrage_rows INTEGER;
  v_terminal_without_port INTEGER;
  v_routes_without_destination INTEGER;
BEGIN
  SELECT count(*)
  INTO v_legacy_tables
  FROM public.charge_tables
  WHERE name IN (
    'Tabela Other Charges v1',
    'Tabela BB BRSSA v1',
    'Tabela BB BRVIT v1',
    'Tabela CNTR BRSSA v1',
    'Tabela CNTR BRVIT v1'
  );

  SELECT count(*)
  INTO v_demurrage_rows
  FROM public.demurrage_rates
  WHERE container_type IN (
    '40FR', '20RQ', '20GP', '20RF', '40RQ', '20OT',
    '40HC', '40GP', '40OT', '40RF', '20HC', '20FR'
  );

  SELECT count(*)
  INTO v_terminal_without_port
  FROM public.depots
  WHERE tipo = 'terminal_portuario'
    AND port_id IS NULL;

  SELECT count(*)
  INTO v_routes_without_destination
  FROM public.depot_services
  WHERE natureza = 'transporte'
    AND route_destino_id IS NULL;

  IF v_legacy_tables <> 0 THEN
    RAISE EXCEPTION 'Catálogo legado de taxas locais ainda presente: % tabela(s).', v_legacy_tables;
  END IF;
  IF v_demurrage_rows <> 12 THEN
    RAISE EXCEPTION 'Catálogo canônico de demurrage incompleto: % linha(s).', v_demurrage_rows;
  END IF;
  IF v_terminal_without_port <> 0 THEN
    RAISE EXCEPTION 'Terminal sem vínculo com ports: % registro(s).', v_terminal_without_port;
  END IF;
  IF v_routes_without_destination <> 0 THEN
    RAISE EXCEPTION 'Serviço de transporte sem destino: % registro(s).', v_routes_without_destination;
  END IF;
END;
$seed_catalog_test$;

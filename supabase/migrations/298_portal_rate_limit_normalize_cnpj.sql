-- 298: Rate limit do Portal volta ao normalizador canônico de CNPJ.
--
-- Problema de negócio: as cinco funções de rate limit chaveavam o balde de
-- tentativas por `regexp_replace(p_login, '\D', '', 'g')`, que apaga tudo que
-- não é dígito -- inclusive as letras do CNPJ alfanumérico. `12ABC34501DE35` e
-- `12XYZ34501FG35` produzem a mesma chave `123450135`: dois clientes sem
-- relação dividem o balde, e cinco falhas em um trancam o login do outro por
-- 15 minutos.
--
-- Causa: a migration 040 chamava o normalizador compartilhado; a 183 trocou a
-- chamada por um regexp inline e a 191 copiou o mesmo trecho para a
-- recuperação. Quando a 293 corrigiu `normalize_cnpj` para preservar letras, o
-- rate limit já não a chamava. A correção não escreve um quarto regexp: remove
-- os três que existem e volta ao `public.normalize_cnpj`.
--
-- `normalize_cnpj` é STRICT e devolve NULL para entrada vazia; o COALESCE
-- externo preserva a chave textual atual ('' -> hash da string vazia) para
-- login ausente, em vez de gravar `cnpj_hash` nulo numa coluna NOT NULL.
--
-- Nota de dados: os hashes gravados antes desta migration foram calculados
-- pela regra antiga e deixam de casar com os novos, o que zera os contadores
-- em curso. A janela é de 15 minutos e o volume atual é nulo, então não há
-- migração de dados a fazer.
--
-- Rollback: restaurar os corpos das migrations 183 e 191 (reintroduz o defeito).

CREATE OR REPLACE FUNCTION public.portal_login_check_rate_limit(p_login TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_hash TEXT; v_count INTEGER;
BEGIN
  v_hash := encode(extensions.digest(coalesce(public.normalize_cnpj(coalesce(p_login,'')),''),'sha256'),'hex');
  SELECT count(*) INTO v_count FROM public.portal_login_attempts WHERE cnpj_hash=v_hash AND attempted_at > now()-interval '15 minutes' AND succeeded=false AND source='login';
  RETURN coalesce(v_count,0) >= 5;
END; $$;
REVOKE ALL ON FUNCTION public.portal_login_check_rate_limit(TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.portal_login_register_failure(p_login TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  INSERT INTO public.portal_login_attempts(cnpj_hash,succeeded,source)
  VALUES (encode(extensions.digest(coalesce(public.normalize_cnpj(coalesce(p_login,'')),''),'sha256'),'hex'),false,'login');
END; $$;
REVOKE ALL ON FUNCTION public.portal_login_register_failure(TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.portal_login_register_success(p_login TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  INSERT INTO public.portal_login_attempts(cnpj_hash,succeeded)
  VALUES (encode(extensions.digest(coalesce(public.normalize_cnpj(coalesce(p_login,'')),''),'sha256'),'hex'),true);
END; $$;
REVOKE ALL ON FUNCTION public.portal_login_register_success(TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.portal_recovery_check_rate_limit(p_login TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_hash TEXT; v_count INTEGER;
BEGIN
  v_hash := encode(extensions.digest(coalesce(public.normalize_cnpj(coalesce(p_login,'')),''),'sha256'),'hex');
  SELECT count(*) INTO v_count FROM public.portal_login_attempts WHERE cnpj_hash=v_hash AND attempted_at > now()-interval '15 minutes' AND succeeded=false AND source='recovery';
  RETURN coalesce(v_count,0) >= 5;
END; $$;
REVOKE ALL ON FUNCTION public.portal_recovery_check_rate_limit(TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.portal_recovery_register_failure(p_login TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  INSERT INTO public.portal_login_attempts(cnpj_hash,succeeded,source)
  VALUES (encode(extensions.digest(coalesce(public.normalize_cnpj(coalesce(p_login,'')),''),'sha256'),'hex'),false,'recovery');
END; $$;
REVOKE ALL ON FUNCTION public.portal_recovery_register_failure(TEXT) FROM PUBLIC,anon,authenticated;

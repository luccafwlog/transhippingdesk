import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/302_portal_release_suppressed_email.sql', 'utf8')

describe('Saída da lista de bloqueio de emails do Portal (302)', () => {
  // Achado F: sete pontos consultavam portal_suppressed_emails e nenhum a
  // apagava. Para resgatar um cliente bloqueado por engano, o operador tinha de
  // cadastrar um endereço diferente — gravar um dado errado para contornar um
  // sinalizador errado.
  it('remove o endereço da lista', () => {
    expect(sql).toContain('DELETE FROM public.portal_suppressed_emails WHERE email = v_email;')
    expect(sql).toContain("IF v_removed = 0 THEN RAISE EXCEPTION 'Endereço não está na lista de bloqueio.'")
  })

  it('restringe a liberação ao operador', () => {
    expect(sql).toContain("IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied'")
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.portal_release_suppressed_email(BIGINT,TEXT,TEXT) FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_release_suppressed_email(BIGINT,TEXT,TEXT) TO authenticated;')
  })

  // Desbloquear reexpõe o domínio a bounces; sem o rastro, o botão vira hábito.
  it('exige justificativa e deixa rastro de quem liberou e por quê', () => {
    expect(sql).toContain("IF NULLIF(trim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.'")
    expect(sql).toContain('PERFORM public._portal_log_event(')
    expect(sql).toContain("'Endereço ' || v_email || ' liberado da lista de bloqueio de emails. ' || trim(p_reason)")
  })

  it('limpa o sinal de email quebrado das contas que usavam o endereço', () => {
    expect(sql).toContain("UPDATE public.customer_portal_accounts SET recovery_email_status='ok'")
    expect(sql).toContain('WHERE lower(recovery_email) = v_email')
  })

  it('roda com search_path controlado', () => {
    expect(sql).toContain("SECURITY DEFINER SET search_path TO 'public','pg_temp'")
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8')

describe('migration 373 — anexos e templates de Comunicados', () => {
  const sql = read('373_comunicados_anexos.sql')

  it('cria bucket privado com limites de MIME e tamanho', () => {
    expect(sql).toMatch(/INSERT INTO storage\.buckets[\s\S]*id, name, public, file_size_limit[\s\S]*'customer-communications'[\s\S]*false/i)
    expect(sql).toMatch(/file_size_limit\s*=\s*10485760/i)
    for (const mime of ['application/pdf', 'image/jpeg', 'image/png', 'text/plain']) {
      expect(sql).toContain(`'${mime}'`)
    }
  })

  it('restringe policies do Storage e leitura dos templates a usuários internos', () => {
    expect(sql).toMatch(/CREATE POLICY customer_communications_objects_read[\s\S]*TO authenticated[\s\S]*is_active_read_user/i)
    expect(sql).toMatch(/CREATE POLICY customer_communications_objects_insert[\s\S]*TO authenticated[\s\S]*is_active_user/i)
    expect(sql).toMatch(/CREATE POLICY customer_communication_templates_internal_read[\s\S]*TO authenticated[\s\S]*is_active_read_user/i)
    expect(sql).toMatch(/GRANT ALL ON TABLE public\.customer_communication_templates TO service_role/i)
  })

  it('versiona um template por kind e persiste a criação atômica por cliente', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_communication_templates[\s\S]*subject_template[\s\S]*body_html_template[\s\S]*body_text_template/i)
    expect(sql).toMatch(/customer_communication_templates_kind_unique UNIQUE \(kind\)/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_customer_communication_atomic[\s\S]*SECURITY DEFINER[\s\S]*customer_communication_bls[\s\S]*ON CONFLICT DO NOTHING/i)
    expect(sql).toMatch(/B\/L fora do cliente do comunicado/i)
    expect(sql).toMatch(/Comunicado institucional nao pode conter B\/Ls/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_customer_communication_atomic[\s\S]*TO service_role/i)
  })

  it('persiste metadados dos anexos sem liberar escrita direta ao navegador', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_communication_attachments[\s\S]*storage_path TEXT NOT NULL UNIQUE[\s\S]*file_name TEXT NOT NULL[\s\S]*mime_type TEXT NOT NULL[\s\S]*size_bytes BIGINT NOT NULL/i)
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.customer_communication_attachments TO authenticated/i)
    expect(sql).toMatch(/GRANT ALL ON TABLE public\.customer_communication_attachments TO service_role/i)
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON TABLE public\.customer_communication_attachments FROM authenticated/i)
    expect(sql).toMatch(/CREATE POLICY customer_communication_attachments_internal_read[\s\S]*is_active_read_user/i)
  })
})

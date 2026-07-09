import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const sql = fs
  .readdirSync(path.resolve(process.cwd(), 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations', f), 'utf8'))
  .join('\n')

it('cria voyage_omissions e bl_transshipments com RLS de usuario ativo', () => {
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.voyage_omissions/i)
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.bl_transshipments/i)
  expect(sql).toMatch(/UNIQUE\s*\(voyage_id,\s*omitted_pod\)/i)
  expect(sql).toMatch(/disposition[\s\S]*CHECK[\s\S]*'transshipment'[\s\S]*'cod'/i)
  expect(sql).toMatch(/ALTER TABLE public\.voyage_omissions ENABLE ROW LEVEL SECURITY/i)
  expect(sql).toMatch(/ALTER TABLE public\.bl_transshipments ENABLE ROW LEVEL SECURITY/i)
  expect(sql).toMatch(/is_active_user\(\)/i)
})

it('adiciona o tipo transshipment ao CHECK de portal_notifications', () => {
  expect(sql).toMatch(/portal_notifications[\s\S]*ADD CONSTRAINT[\s\S]*'transshipment'/i)
})

it('define as RPCs auditadas de omissao, transbordo e COD', () => {
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.omit_voyage_escala/i)
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_bl_transshipment/i)
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_bl_cod/i)
  expect(sql).toMatch(/SECURITY DEFINER/i)
  expect(sql).toMatch(/field_name\s*,?\s*[\s\S]*'omitted'/i)
  expect(sql).toMatch(/INSERT INTO public\.portal_notifications[\s\S]*'transshipment'/i)
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.omit_voyage_escala[\s\S]*TO authenticated/i)
})

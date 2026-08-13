import { supabase } from './supabase'
import type { UserProfile, UserProfileRole } from '../types/database'

export type AdminUserRow = UserProfile & {
  email: string | null
  last_sign_in_at: string | null
}

export async function listAllUserProfiles(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) throw error
  return (data ?? []) as AdminUserRow[]
}

export async function updateUserProfile(
  id: string,
  updates: { role?: UserProfileRole; active?: boolean },
): Promise<void> {
  const { error } = await supabase.from('user_profiles').update(updates).eq('id', id)
  if (error) throw error
}

async function invokeAdminUsers(body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return
  // Em resposta não-2xx o supabase-js devolve `data` nulo e guarda o corpo em
  // error.context (um Response). Ler dali é o que faz "Já existe um usuário com
  // este e-mail" chegar à tela em vez da mensagem genérica.
  const context = (error as { context?: Response }).context
  const parsed = context ? await context.json().catch(() => null) as { error?: string } | null : null
  throw new Error(parsed?.error ?? 'Não foi possível concluir a operação.')
}

export async function createUser(input: {
  full_name: string
  email: string
  password: string
  role: UserProfileRole
}): Promise<void> {
  await invokeAdminUsers({ action: 'create', ...input })
}

export async function updateUserCredentials(input: {
  user_id: string
  email?: string
  password?: string
}): Promise<void> {
  await invokeAdminUsers({ action: 'update_credentials', ...input })
}

// Desativar passa pela Edge Function porque encerrar a sessão exige service_role;
// reativar é só o flag e continua em updateUserProfile.
export async function deactivateUser(userId: string): Promise<void> {
  await invokeAdminUsers({ action: 'deactivate', user_id: userId })
}

export const PROFILE_LABELS: Record<UserProfileRole, string> = {
  admin: 'Admin (legado)',
  operator: 'Operador (legado)',
  administrativo: 'Administrativo',
  financeiro: 'Financeiro',
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
}

export const MANAGED_PROFILES: UserProfileRole[] = ['administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos']

export const PROFILE_SCOPES: Record<string, string> = {
  administrativo: 'Visualização e edição completas em todos os módulos e configurações.',
  financeiro: 'Visualização completa de todos os módulos. Única edição: conciliação de pagamentos.',
  operacoes: 'Visualização completa de todos os módulos. Única edição: cadastro de Viagens.',
  documentacao: 'Visualização completa de todos os módulos. Edição de todas as ações de negócio (Clientes, Portal, B/Ls, Viagens, Taxas Locais, Faturamento), exceto conciliação de pagamentos e administração de usuários.',
  equipamentos: 'Visualização completa de todos os módulos. Edição restrita a Vazios (EXP), Veículos e Depots, incluindo o sign-off das suas seções no ADR.',
}

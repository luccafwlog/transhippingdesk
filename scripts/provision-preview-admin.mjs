import { createClient } from '@supabase/supabase-js'

const DEFAULT_EMAIL = 'qa-admin@example.test'
const DEFAULT_FULL_NAME = 'Preview Admin'

function errorMessage(error) {
  if (!error) return 'erro desconhecido'
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message)
  }
  return String(error)
}

function assertValidInput({ email, password, fullName }) {
  if (!email || !email.includes('@')) throw new Error('PREVIEW_ADMIN_EMAIL inválido.')
  if (!password || password.length < 8) throw new Error('PREVIEW_ADMIN_PASSWORD deve ter pelo menos 8 caracteres.')
  if (!fullName?.trim()) throw new Error('PREVIEW_ADMIN_FULL_NAME não pode ser vazio.')
}

/**
 * Creates or repairs the one shared test account inside one Supabase Preview
 * Branch. The clients are injected so this orchestration can be checked
 * without ever contacting a real project.
 */
export async function provisionPreviewAdmin({ authAdmin, profiles, email, password, fullName }) {
  assertValidInput({ email, password, fullName })

  const { data: listData, error: listError } = await authAdmin.listUsers({ page: 1, perPage: 1000 })
  if (listError) throw new Error(`Não foi possível listar os usuários da Preview: ${errorMessage(listError)}`)

  const matchingUsers = (listData?.users ?? []).filter(
    (user) => String(user.email ?? '').toLowerCase() === email.toLowerCase(),
  )
  if (matchingUsers.length > 1) {
    throw new Error(`Mais de um usuário corresponde ao e-mail de Preview ${email}.`)
  }

  const attributes = {
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, preview_fixture: true },
  }
  let user

  if (matchingUsers[0]) {
    const { data, error } = await authAdmin.updateUserById(matchingUsers[0].id, attributes)
    if (error) throw new Error(`Não foi possível atualizar o usuário de Preview: ${errorMessage(error)}`)
    user = data?.user
  } else {
    const { data, error } = await authAdmin.createUser({ email, ...attributes })
    if (error) throw new Error(`Não foi possível criar o usuário de Preview: ${errorMessage(error)}`)
    user = data?.user
  }

  if (!user?.id) throw new Error('A Auth API não devolveu o id do usuário de Preview.')

  const { error: profileError } = await profiles.upsert(
    { id: user.id, full_name: fullName, role: 'admin', active: true },
    { onConflict: 'id' },
  )
  if (profileError) throw new Error(`Não foi possível garantir o perfil admin da Preview: ${errorMessage(profileError)}`)

  return { id: user.id, email }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}.`)
  return value
}

async function main() {
  const url = requiredEnv('SUPABASE_URL')
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!secretKey) {
    throw new Error('Credencial server-side ausente: SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY.')
  }

  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const result = await provisionPreviewAdmin({
    authAdmin: client.auth.admin,
    profiles: client.from('user_profiles'),
    email: process.env.PREVIEW_ADMIN_EMAIL?.trim() || DEFAULT_EMAIL,
    password: requiredEnv('PREVIEW_ADMIN_PASSWORD'),
    fullName: process.env.PREVIEW_ADMIN_FULL_NAME?.trim() || DEFAULT_FULL_NAME,
  })

  console.log(`Usuário de Preview garantido: ${result.email} (${result.id})`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(errorMessage(error))
    process.exitCode = 1
  })
}

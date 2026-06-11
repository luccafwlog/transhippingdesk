type SignOutClient = {
  auth: {
    signOut: () => Promise<{ error: unknown | null }>
  }
}

const signOutRequests = new WeakMap<object, Promise<void>>()

function isLockStolenError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const message = String((error as { message?: unknown }).message ?? '')
  return message.includes('was released because another request stole it')
}

export async function signOutSupabaseClient(client: SignOutClient) {
  const authClient = client.auth as object
  const pendingSignOut = signOutRequests.get(authClient)
  if (pendingSignOut) return pendingSignOut

  const signOutRequest = (async () => {
    try {
      const { error } = await client.auth.signOut()
      if (error) throw error
    } catch (error) {
      if (isLockStolenError(error)) return
      throw error
    }
  })()

  signOutRequests.set(authClient, signOutRequest)

  try {
    await signOutRequest
  } finally {
    if (signOutRequests.get(authClient) === signOutRequest) {
      signOutRequests.delete(authClient)
    }
  }
}

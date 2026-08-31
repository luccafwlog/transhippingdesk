import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error — script operacional em JS puro, sem declarações geradas.
import { provisionPreviewAdmin } from '../../../scripts/provision-preview-admin.mjs'

const input = {
  email: 'qa-admin@example.test',
  password: 'PreviewAdmin2026!',
  fullName: 'Preview Admin',
}

describe('provisionPreviewAdmin', () => {
  it('creates the Auth user and its active admin profile when the fixture is absent', async () => {
    const authAdmin = {
      listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      createUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-preview-1', email: input.email } },
        error: null,
      }),
      updateUserById: vi.fn(),
    }
    const profiles = { upsert: vi.fn().mockResolvedValue({ error: null }) }

    const result = await provisionPreviewAdmin({ authAdmin, profiles, ...input })

    expect(result).toEqual({ id: 'user-preview-1', email: input.email })
    expect(authAdmin.createUser).toHaveBeenCalledWith({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName, preview_fixture: true },
    })
    expect(profiles.upsert).toHaveBeenCalledWith(
      { id: 'user-preview-1', full_name: input.fullName, role: 'admin', active: true },
      { onConflict: 'id' },
    )
  })

  it('repairs an existing fixture instead of creating a duplicate', async () => {
    const authAdmin = {
      listUsers: vi.fn().mockResolvedValue({
        data: { users: [{ id: 'user-preview-1', email: input.email }] },
        error: null,
      }),
      createUser: vi.fn(),
      updateUserById: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-preview-1', email: input.email } },
        error: null,
      }),
    }
    const profiles = { upsert: vi.fn().mockResolvedValue({ error: null }) }

    await provisionPreviewAdmin({ authAdmin, profiles, ...input })

    expect(authAdmin.createUser).not.toHaveBeenCalled()
    expect(authAdmin.updateUserById).toHaveBeenCalledWith('user-preview-1', {
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName, preview_fixture: true },
    })
  })
})

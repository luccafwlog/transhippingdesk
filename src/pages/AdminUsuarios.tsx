import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'
import { listAllUserProfiles, updateUserProfile } from '../services/adminUsers'

export function AdminUsuarios() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: listAllUserProfiles,
  })

  const mutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof updateUserProfile>[1] }) =>
      updateUserProfile(id, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showToast('Usuario atualizado.', 'success')
      setPendingId(null)
    },
    onError: () => {
      showToast('Erro ao atualizar usuario.', 'error')
      setPendingId(null)
    },
  })

  function handleToggleActive(id: string, current: boolean) {
    setPendingId(id)
    mutation.mutate({ id, updates: { active: !current } })
  }

  function handleToggleRole(id: string, current: 'admin' | 'operator') {
    setPendingId(id)
    mutation.mutate({ id, updates: { role: current === 'admin' ? 'operator' : 'admin' } })
  }

  const users = data ?? []

  return (
    <>
      <PageHeader
        title="Administracao de usuarios"
        description="Gerencie perfis, funcoes e acesso dos operadores do sistema."
      />

      {error ? <InlineError message="Erro ao carregar usuarios." /> : null}

      {isLoading ? (
        <div className="py-16 text-center text-slate-400">Carregando usuarios...</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#30363d]">
          <table className="app-table w-full text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Funcao</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Criado em</th>
                <th className="px-4 py-3 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-0">
                    <EmptyState title="Nenhum usuario encontrado." />
                  </td>
                </tr>
              ) : null}
              {users.map((u) => {
                const isBusy = pendingId === u.id && mutation.isPending
                return (
                  <tr key={u.id} className={`hover:bg-[#21262d]/60 ${!u.active ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium text-white">{u.full_name}</td>
                    <td className="px-4 py-3">
                      <Badge tone={u.role === 'admin' ? 'blue' : 'slate'}>
                        {u.role === 'admin' ? 'Admin' : 'Operador'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Ativo' : 'Inativo'}</Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">
                      {u.created_at
                        ? new Intl.DateTimeFormat('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                          }).format(new Date(u.created_at))
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleToggleRole(u.id, u.role)}
                          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-[#21262d] hover:text-slate-200 disabled:opacity-40 transition-colors"
                        >
                          {u.role === 'admin' ? 'Tornar operador' : 'Tornar admin'}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleToggleActive(u.id, u.active)}
                          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-[#21262d] hover:text-slate-200 disabled:opacity-40 transition-colors"
                        >
                          {u.active ? 'Desativar' : 'Ativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

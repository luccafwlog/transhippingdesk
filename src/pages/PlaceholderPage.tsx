import { Card, PageHeader } from '../components/ui/Card'

export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader
        title={title}
        description={`Módulo reservado para ${phase}. A base de rotas, autenticação e layout já está pronta para receber esta implementação.`}
      />
      <Card>
        <div className="text-sm text-slate-400">
          Próximo incremento: conectar este módulo às queries paginadas do Supabase e aos fluxos de negócio descritos no
          prompt.
        </div>
      </Card>
    </>
  )
}

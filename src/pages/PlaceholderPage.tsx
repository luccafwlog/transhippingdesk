import { Card, PageHeader } from '../components/ui/Card'

export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader
        title={title}
        description={`Modulo reservado para ${phase}. A base de rotas, autenticacao e layout ja esta pronta para receber esta implementacao.`}
      />
      <Card>
        <div className="text-sm text-slate-400">
          Proximo incremento: conectar este modulo as queries paginadas do Supabase e aos fluxos de negocio descritos no
          prompt.
        </div>
      </Card>
    </>
  )
}

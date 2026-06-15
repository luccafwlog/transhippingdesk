import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { usePortalAuth } from '../hooks/usePortalAuth'
import { portalGetProfile, portalUpdateProfile } from '../services/portalBilling'

export function PortalProfile() {
  const { overview, refreshOverview } = usePortalAuth()
  const { showToast } = useToast()

  const [contactEmail, setContactEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const profile = await portalGetProfile()
        setContactEmail(profile.contact_email ?? overview?.contact_email ?? '')
        setPhone(profile.phone ?? '')
        setAddress(profile.address ?? '')
        setCity(profile.city ?? '')
        setState(profile.state ?? '')
        setZip(profile.zip ?? '')
      } catch { /* fallback silencioso */ }
    }
    void load()
  }, [overview])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await portalUpdateProfile({
        contactEmail: contactEmail.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zip: zip.trim() || null,
      })
      await refreshOverview()
      showToast('Perfil atualizado com sucesso.', 'success')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar perfil.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader title="Meu perfil" description="Atualize seus dados de contato e endereco." />

      <Card className="max-w-xl p-5">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label="Email de contato">
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="Email para contato financeiro"
            />
          </Field>

          <Field label="Telefone / WhatsApp">
            <Input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-9999"
            />
          </Field>

          <Field label="Endereco">
            <Input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Rua, numero, complemento"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Cidade">
              <Input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Sao Paulo" />
            </Field>
            <Field label="Estado">
              <Input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" maxLength={2} />
            </Field>
            <Field label="CEP">
              <Input type="text" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="01000-000" />
            </Field>
          </div>

          {error ? <InlineError message={error} /> : null}

          <div className="flex justify-end">
            <Button loading={submitting} type="submit">Salvar alteracoes</Button>
          </div>
        </form>
      </Card>
    </>
  )
}

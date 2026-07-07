import { useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { usePortalProfile } from '../hooks/usePortalProfile'
import { portalErrorMessage } from '../lib/portalErrorMessage'
import type { PortalProfile as PortalProfileData } from '../services/portalBilling'

export function PortalProfile() {
  const profile = usePortalProfile()
  const loadError = profile.error
    ? portalErrorMessage(profile.error, 'Falha ao carregar perfil. Tente novamente em instantes.')
    : ''

  return (
    <>
      <PageHeader title="Meu perfil" description="Atualize seus dados de contato e endereco." />

      <Card className="max-w-xl p-5">
        {profile.data ? (
          <PortalProfileForm
            profile={profile.data}
            fallbackContactEmail={profile.fallbackContactEmail}
            updateProfile={profile.updateProfile.mutateAsync}
            loadError={loadError}
            loadFailed={profile.isError}
          />
        ) : (
          <div className="grid gap-4">
            {loadError ? <InlineError message={loadError} /> : <div className="text-sm text-[var(--app-muted)]">Carregando perfil...</div>}
            <div className="flex justify-end">
              <Button disabled type="button">Salvar alteracoes</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}

function PortalProfileForm({
  profile,
  fallbackContactEmail,
  updateProfile,
  loadError,
  loadFailed,
}: {
  profile: PortalProfileData
  fallbackContactEmail: string
  updateProfile: (input: {
    contactEmail?: string | null
    phone?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    zip?: string | null
  }) => Promise<unknown>
  loadError: string
  loadFailed: boolean
}) {
  const { showToast } = useToast()
  const [contactEmail, setContactEmail] = useState(profile.contact_email ?? fallbackContactEmail)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [address, setAddress] = useState(profile.address ?? '')
  const [city, setCity] = useState(profile.city ?? '')
  const [state, setState] = useState(profile.state ?? '')
  const [zip, setZip] = useState(profile.zip ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await updateProfile({
        contactEmail: contactEmail.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zip: zip.trim() || null,
      })
      showToast('Perfil atualizado com sucesso.', 'success')
    } catch (err: unknown) {
      setError(portalErrorMessage(err, 'Falha ao atualizar perfil. Tente novamente em instantes.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
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

          <Field label="Endereço">
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

          {loadError || error ? <InlineError message={error || loadError} /> : null}

          <div className="flex justify-end">
            <Button disabled={loadFailed} loading={submitting} type="submit">Salvar alteracoes</Button>
          </div>
        </form>
  )
}

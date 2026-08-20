import { FIXTURE_PREFIX, assertFixtureConfig } from './fixture-config.mjs'

function requireFixture(fixture) {
  assertFixtureConfig()
  if (!fixture || fixture.prefix !== FIXTURE_PREFIX) throw new Error('fixture prefix mismatch')
  if (!fixture.userId) throw new Error('fixture userId is required')
  if (!fixture.voyages?.[0]?.id) throw new Error('fixture requires a voyage')
  if (!fixture.bls?.[0]?.id) throw new Error('fixture requires B/Ls')
  if (fixture.voyages.some((voyage) => !['completed', 'active', 'pending'].includes(voyage.status ?? 'active'))) throw new Error('fixture contains an unsupported voyage status')
}

async function callRpc(client, name, payload) {
  const result = await client.rpc(name, payload)
  if (result?.error) throw result.error
  return result?.data ?? null
}

async function loadOmissionTargets(client, fixture, omissionPod) {
  const declared = fixture.bls.filter((bl) => bl.pod === omissionPod)
  if (typeof client?.from !== 'function') return declared
  const result = await client.from('bls').select('id,pod').eq('voyage_id', fixture.voyages[0].id).eq('pod', omissionPod)
  if (result.error) throw result.error
  const ids = new Set((result.data ?? []).map((bl) => bl.id))
  const targets = declared.filter((bl) => ids.has(bl.id))
  if (targets.length < 2) throw new Error(`database does not contain two fixture B/Ls with POD ${omissionPod}`)
  return targets
}

export async function createAdrScenarios(client, fixture) {
  requireFixture(fixture)
  const voyageId = fixture.voyages[0].id
  const omissionPod = 'SALVADOR'
  const omissionTargets = await loadOmissionTargets(client, fixture, omissionPod)
  if (omissionTargets.length < 2) throw new Error(`fixture requires at least two B/Ls with POD ${omissionPod}`)
  const [transshipmentBl, codBl] = omissionTargets
  const transshipmentBlId = transshipmentBl.id
  const codBlId = codBl.id

  const omissionId = await callRpc(client, 'omit_voyage_escala', {
    p_voyage_id: voyageId,
    p_omitted_pod: 'SALVADOR',
    p_discharge_pod: 'VITORIA',
    p_reason: `${FIXTURE_PREFIX} omissão sintética`,
    p_changed_by: fixture.userId,
    p_onward_vessel_name: `${FIXTURE_PREFIX} ONWARD ONE`,
    p_onward_carrier: `${FIXTURE_PREFIX} Carrier`,
    p_onward_voyage_number: 'QAD26-ONWARD',
    p_onward_etd: '2026-10-10T12:00:00Z',
    p_onward_eta: '2026-10-15T12:00:00Z',
  })
  if (!omissionId) throw new Error('omission RPC did not return an id')

  await callRpc(client, 'set_bl_transshipment', {
    p_bl_id: transshipmentBlId,
    p_omission_id: omissionId,
    p_onward_vessel_name: `${FIXTURE_PREFIX} ONWARD ONE`,
    p_onward_carrier: `${FIXTURE_PREFIX} Carrier`,
    p_onward_voyage_number: 'QAD26-ONWARD',
    p_onward_etd: '2026-10-10T12:00:00Z',
    p_onward_eta: '2026-10-15T12:00:00Z',
    p_justification: `${FIXTURE_PREFIX} transshipment confirmado`,
    p_changed_by: fixture.userId,
  })
  await callRpc(client, 'set_bl_cod', {
    p_bl_id: codBlId,
    p_omission_id: omissionId,
    p_justification: `${FIXTURE_PREFIX} COD autorizado pelo cliente`,
    p_changed_by: fixture.userId,
  })

  const result = { omissionId, voyageId, transshipmentBlId, codBlId }
  if (typeof client?.from === 'function') {
    const links = await client.from('bl_transshipments').select('id,bl_id').in('bl_id', [transshipmentBlId, codBlId]).eq('omission_id', omissionId)
    if (links.error) throw links.error
    for (const link of links.data ?? []) {
      if (link.bl_id === transshipmentBlId) result.transshipmentId = link.id
      if (link.bl_id === codBlId) result.codId = link.id
    }
  }
  return result
}

if ((await import('./fixture-runtime.mjs')).isMain(import.meta.url, process.argv[1])) {
  const { authClient, readCatalog, writeCatalog } = await import('./fixture-runtime.mjs')
  const { client, userId } = await authClient()
  const catalog = await readCatalog()
  catalog.userId = userId
  catalog.adr = await createAdrScenarios(client, catalog)
  await writeCatalog(catalog)
  console.log(JSON.stringify(catalog.adr, null, 2))
}

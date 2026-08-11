import { FIXTURE_PREFIX, assertFixtureConfig } from './fixture-config.mjs'

function requireFixture(fixture) {
  assertFixtureConfig()
  if (!fixture || fixture.prefix !== FIXTURE_PREFIX) throw new Error('fixture prefix mismatch')
  if (!fixture.userId) throw new Error('fixture userId is required')
  if (!fixture.voyages?.[0]?.id) throw new Error('fixture requires a voyage')
  if (!fixture.bls?.[0]?.id) throw new Error('fixture requires B/Ls')
}

async function callRpc(client, name, payload) {
  const result = await client.rpc(name, payload)
  if (result?.error) throw result.error
  return result?.data ?? null
}

export async function createAdrScenarios(client, fixture) {
  requireFixture(fixture)
  const voyageId = fixture.voyages[0].id
  const transshipmentBlId = fixture.bls[0].id
  const codBlId = fixture.bls[1]?.id ?? 'QAD26-BL-002'

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
    p_changed_by: fixture.userId,
  })
  await callRpc(client, 'set_bl_cod', {
    p_bl_id: codBlId,
    p_omission_id: omissionId,
    p_changed_by: fixture.userId,
  })

  return { omissionId, voyageId, transshipmentBlId, codBlId }
}

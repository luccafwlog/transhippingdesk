export const FIXTURE_PREFIX = 'QA-DISPLAY-2026'
export const FIXTURE_CODE = 'QAD26'
export const PROTECTED_TABLES = Object.freeze([
  'charge_tables',
  'charge_table_items',
  'depots',
  'terminals',
  'services',
])
export const EXTERNAL_SIDE_EFFECTS_DISABLED = true

export function assertFixtureConfig() {
  if (!/^QA-[A-Z0-9-]{8,}$/.test(FIXTURE_PREFIX)) throw new Error('fixture prefix invalid')
  if (!/^QAD\d{2}$/.test(FIXTURE_CODE)) throw new Error('fixture code invalid')
  if (!EXTERNAL_SIDE_EFFECTS_DISABLED) throw new Error('external side effects must remain disabled')
  return true
}

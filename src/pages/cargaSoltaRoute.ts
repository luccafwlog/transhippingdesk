export function getCargaSoltaVoyageId(searchParams: URLSearchParams) {
  return searchParams.get('voyage') ?? ''
}

import { countDistinctManifestContainers, type ParsedManifest } from '../../services/manifestParser'

type ManifestImportSummaryEntry = {
  filename: string
  preview: ParsedManifest
}

export function buildCntrManifestImportSummary(entries: ManifestImportSummaryEntry[]) {
  const distinctContainers = new Set<string>()
  const rows = entries.map(({ filename, preview }) => {
    for (const bl of preview.bls) {
      for (const container of bl.containers) {
        const normalized = container.container_number.trim().toUpperCase()
        if (normalized) distinctContainers.add(normalized)
      }
    }

    return {
      filename,
      pol: summarizeManifestPorts(preview.bls.map((bl) => bl.pol)),
      pod: summarizeManifestPorts(preview.bls.map((bl) => bl.pod)),
      blCount: preview.bls.length,
      containerCount: countDistinctManifestContainers(preview),
    }
  })

  return { rows, totalDistinctContainers: distinctContainers.size }
}

function summarizeManifestPorts(values: Array<string | null>) {
  const ports = Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
  return ports.join(' / ') || '-'
}

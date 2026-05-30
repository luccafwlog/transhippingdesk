// Limite padrão para uploads de planilhas (10 MB).
// Acima disso o parser do XLSX consome memória rápido demais e pode
// derrubar a aba do navegador — usado como salvaguarda contra DoS.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function assertUploadSize(file: File, maxBytes: number = MAX_UPLOAD_BYTES) {
  if (file.size > maxBytes) {
    const limitMb = (maxBytes / 1_048_576).toFixed(0)
    throw new Error(
      `Arquivo muito grande (${(file.size / 1_048_576).toFixed(1)} MB). O limite é ${limitMb} MB.`,
    )
  }
}

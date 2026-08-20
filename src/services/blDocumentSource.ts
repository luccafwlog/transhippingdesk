// Modelo de texto compartilhado pelos leitores de B/L (.pdf e .docx).
// Nenhuma regra de campo mora aqui: é só a forma como cada formato entrega o
// texto para blDocumentParser.ts.

/** Formato do arquivo de B/L aceito na importação. */
export type BlDocumentFormat = 'pdf' | 'docx'

/**
 * Trecho de texto com posição na página, em pontos, com origem no canto
 * superior esquerdo (y cresce para baixo). É o que o PDF entrega, e é o que
 * permite ancorar cada valor no rótulo impresso do formulário.
 */
export type BlTextRun = {
  page: number
  x: number
  y: number
  width: number
  height: number
  text: string
}

/**
 * Bloco de texto de um campo. O .docx entrega uma caixa de texto por campo,
 * sem rótulo e sem posição confiável (cada âncora é relativa ao parágrafo em
 * que mora), então `order` — a ordem no documento — é a informação estrutural
 * disponível. No PDF os blocos são o resultado do agrupamento por rótulo.
 */
export type BlTextBlock = {
  order: number
  page: number
  x: number | null
  y: number | null
  lines: string[]
  text: string
}

/** Página do PDF já convertida para o sistema de coordenadas de cima para baixo. */
export type BlPdfPage = {
  number: number
  width: number
  height: number
  runs: BlTextRun[]
}

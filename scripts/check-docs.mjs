import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules'])
const errors = []

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return []
    const absolutePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath]
  })
}

function relative(absolutePath) {
  return path.relative(root, absolutePath).replaceAll('\\', '/')
}

function addError(file, message) {
  errors.push(`${file}: ${message}`)
}

const markdownFiles = walk(root).filter((file) => /\.mdx?$/i.test(file))
const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf8')
  const prose = content.replace(/```[\s\S]*?```/g, '')
  for (const match of prose.matchAll(markdownLinkPattern)) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    target = target.replace(/\s+["'][^"']*["']$/, '')
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue

    const pathPart = target.split('#')[0]
    if (!pathPart) continue

    let decoded
    try {
      decoded = decodeURIComponent(pathPart)
    } catch {
      addError(relative(file), `link has invalid URL encoding: ${target}`)
      continue
    }

    if (path.isAbsolute(decoded)) {
      addError(relative(file), `link must be repository-relative: ${target}`)
      continue
    }

    const resolved = path.resolve(path.dirname(file), decoded)
    if (!fs.existsSync(resolved)) {
      addError(relative(file), `broken relative link: ${target}`)
    }
  }
}

const requiredFiles = ['docs/README.md', 'docs/adr/README.md']
for (const requiredFile of requiredFiles) {
  if (!fs.existsSync(path.join(root, requiredFile))) {
    addError(requiredFile, 'required documentation index is missing')
  }
}

const adrDirectory = path.join(root, 'docs', 'adr')
const adrIndexPath = path.join(adrDirectory, 'README.md')
if (fs.existsSync(adrIndexPath)) {
  const adrIndex = fs.readFileSync(adrIndexPath, 'utf8')
  const adrFiles = fs.readdirSync(adrDirectory)
    .filter((name) => /^\d{4}-.+\.md$/i.test(name))
    .sort()

  for (const adrFile of adrFiles) {
    if (!adrIndex.includes(adrFile)) {
      addError('docs/adr/README.md', `ADR is not indexed: ${adrFile}`)
    }
  }
}

const appRoutes = [...read('src/App.tsx').matchAll(/<Route\s+path="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((route) => route !== '*')
const architecture = read('docs/ARCHITECTURE.md')

for (const route of appRoutes) {
  if (!architecture.includes(`\`${route}\``)) {
    addError('docs/ARCHITECTURE.md', `route from src/App.tsx is not documented: ${route}`)
  }
}

const livingFiles = [
  'README.md',
  'CONTEXT.md',
  'WORKFLOW.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/README.md',
  'docs/ARCHITECTURE.md',
  'docs/ROADMAP.md',
  'docs/VALIDACAO.md',
  'docs/RESET_AMBIENTE.md',
  '.claude/skills/import-parser.skill',
  '.claude/skills/react-query-pattern.skill',
  '.claude/skills/invoice-pdf.skill',
  '.claude/skills/supabase-migration.skill',
]

const staleClaims = [
  {
    pattern: /001_schema\.sql\s*(?:→|->)\s*053_security_hardening\.sql/i,
    message: 'fixed migration range ending at 053 is obsolete',
  },
  {
    pattern: /\b053 migrations\b/i,
    message: 'fixed migration count 053 is obsolete',
  },
  {
    pattern: /fallback(?: de)? token|token legacy em `sessionStorage`/i,
    message: 'legacy Portal token fallback is obsolete',
  },
  {
    pattern: /\bjspdf\b/i,
    message: 'jsPDF is not used; invoices print through the browser',
  },
]

for (const livingFile of livingFiles) {
  const absolutePath = path.join(root, livingFile)
  if (!fs.existsSync(absolutePath)) continue
  const content = fs.readFileSync(absolutePath, 'utf8')
  for (const claim of staleClaims) {
    if (claim.pattern.test(content)) addError(livingFile, claim.message)
  }
}

if (errors.length > 0) {
  console.error(`Documentation check failed with ${errors.length} issue(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(
    `Documentation checks passed: ${markdownFiles.length} Markdown files, ` +
    `${appRoutes.length} routes, and ADR index coverage verified.`,
  )
}

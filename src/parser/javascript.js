function isExternalJS(raw) {
  return !raw.startsWith('.') && !raw.startsWith('/')
}

function resolveRelativePath(filePath, importPath) {
  if (isExternalJS(importPath)) return null
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  const parts = `${dir}/${importPath}`.split('/')
  const resolved = []
  for (const p of parts) {
    if (p === '..') resolved.pop()
    else if (p !== '.') resolved.push(p)
  }
  return resolved.join('/')
}

export function parseJS(content, filePath) {
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx')

  const node = {
    path: filePath,
    language: isTS ? 'typescript' : 'javascript',
    fileName: filePath.split('/').pop(),
    packageName: null,
    className: null,
    classType: 'module',
    annotations: [],
    imports: [],
    extends: null,
    implements: [],
    methods: [],
    lineCount: 0,
    isExternal: false,
    parseError: null,
    subtype: null,
    fqn: filePath
  }

  try {
    node.lineCount = content.split('\n').length

    const addImport = (raw, alias = null) => {
      if (!raw) return
      const resolved = isExternalJS(raw) ? null : resolveRelativePath(filePath, raw)
      node.imports.push({
        raw,
        alias,
        isExternal: isExternalJS(raw),
        resolvedPath: resolved
      })
    }

    let m

    // Named imports: import { X, Y } from 'path'
    const namedRe = /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm
    while ((m = namedRe.exec(content)) !== null) addImport(m[2])

    // Default import: import X from 'path'
    const defaultRe = /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm
    while ((m = defaultRe.exec(content)) !== null) addImport(m[2], m[1])

    // Namespace import: import * as X from 'path'
    const nsRe = /^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm
    while ((m = nsRe.exec(content)) !== null) addImport(m[2], m[1])

    // Side-effect import: import 'path'
    const sideRe = /^import\s+['"]([^'"]+)['"]/gm
    while ((m = sideRe.exec(content)) !== null) addImport(m[1])

    // Re-exports: export { X } from 'path'
    const reExportRe = /^export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/gm
    while ((m = reExportRe.exec(content)) !== null) addImport(m[1])

    // CommonJS require
    const requireRe = /(?:const|let|var)\s+(?:\{[^}]+\}|\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/gm
    while ((m = requireRe.exec(content)) !== null) addImport(m[1])

    // Deduplicate imports by raw path
    const seen = new Set()
    node.imports = node.imports.filter(i => {
      if (seen.has(i.raw)) return false
      seen.add(i.raw)
      return true
    })

    // Class detection
    const classRe = /(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?/gm
    const classes = []
    while ((m = classRe.exec(content)) !== null) {
      classes.push({ name: m[1], ext: m[2] || null })
    }
    if (classes.length > 0) {
      node.className = classes[0].name
      node.classType = 'class'
      node.extends = classes[0].ext
      node.fqn = filePath + '#' + node.className
    }

    // TypeScript interface
    if (isTS) {
      const ifaceRe = /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/gm
      while ((m = ifaceRe.exec(content)) !== null) {
        if (!node.className) {
          node.className = m[1]
          node.classType = 'interface'
          node.fqn = filePath + '#' + node.className
        }
      }

      const enumRe = /(?:export\s+)?enum\s+(\w+)/gm
      while ((m = enumRe.exec(content)) !== null) {
        if (!node.className) {
          node.className = m[1]
          node.classType = 'enum'
          node.fqn = filePath + '#' + node.className
        }
      }
    }

    // Named function exports
    const fnExportRe = /export\s+(?:async\s+)?function\s+(\w+)/gm
    while ((m = fnExportRe.exec(content)) !== null) {
      if (!node.methods.includes(m[1])) node.methods.push(m[1])
    }

    // Arrow function exports
    const arrowRe = /export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(/gm
    while ((m = arrowRe.exec(content)) !== null) {
      if (!node.methods.includes(m[1])) node.methods.push(m[1])
    }

    // Class methods (indented, not constructor)
    const methodRe = /^\s{2,}(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm
    const SKIP = new Set(['if', 'for', 'while', 'switch', 'catch', 'constructor'])
    while ((m = methodRe.exec(content)) !== null) {
      const name = m[1]
      if (!SKIP.has(name) && !node.methods.includes(name)) {
        node.methods.push(name)
      }
    }

  } catch (err) {
    node.parseError = err.message
  }

  return node
}

const PYTHON_STDLIB = new Set([
  'os', 'sys', 're', 'json', 'datetime', 'collections', 'itertools',
  'functools', 'pathlib', 'typing', 'abc', 'dataclasses', 'enum',
  'logging', 'unittest', 'io', 'copy', 'math', 'random', 'time',
  'threading', 'subprocess', 'hashlib', 'base64', 'urllib', 'http',
  'socket', 'struct', 'pickle', 'csv', 'xml', 'html', 'string',
  'textwrap', 'traceback', 'warnings', 'inspect', 'importlib', 'ast'
])

const PYTHON_KNOWN_EXTERNAL = new Set([
  'django', 'flask', 'fastapi', 'sqlalchemy', 'pandas', 'numpy',
  'requests', 'pydantic', 'celery', 'redis', 'boto3', 'pytest',
  'aiohttp', 'httpx', 'starlette', 'uvicorn', 'gunicorn', 'alembic',
  'marshmallow', 'attrs', 'click', 'typer', 'rich', 'loguru',
  'PIL', 'cv2', 'sklearn', 'torch', 'tensorflow', 'keras'
])

function isExternalPython(raw) {
  const root = raw.split('.')[0]
  return PYTHON_STDLIB.has(root) || PYTHON_KNOWN_EXTERNAL.has(root)
}

function isRelativePython(raw) {
  return raw.startsWith('.')
}

export function parsePython(content, filePath) {
  const node = {
    path: filePath,
    language: 'python',
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

    // Derive package name from file path
    const pathParts = filePath.replace(/\.py$/, '').split('/')
    if (pathParts.length > 1) {
      node.packageName = pathParts.slice(0, -1).join('.')
    }

    let m

    // import X or import X as Y
    const importRe = /^import\s+([\w.]+)(?:\s+as\s+\w+)?/gm
    while ((m = importRe.exec(content)) !== null) {
      const raw = m[1]
      node.imports.push({
        raw,
        alias: null,
        isExternal: isExternalPython(raw),
        resolvedPath: null
      })
    }

    // from X import Y  (absolute)
    const fromRe = /^from\s+([\w.]+)\s+import\s+/gm
    while ((m = fromRe.exec(content)) !== null) {
      const raw = m[1]
      if (!raw.startsWith('.')) {
        node.imports.push({
          raw,
          alias: null,
          isExternal: isExternalPython(raw),
          resolvedPath: null
        })
      }
    }

    // from . import X  (relative)
    const relRe = /^from\s+(\.+[\w.]*)\s+import/gm
    while ((m = relRe.exec(content)) !== null) {
      node.imports.push({
        raw: m[1],
        alias: null,
        isExternal: false,
        resolvedPath: null
      })
    }

    // Deduplicate
    const seen = new Set()
    node.imports = node.imports.filter(i => {
      if (seen.has(i.raw)) return false
      seen.add(i.raw)
      return true
    })

    // Class detection
    const classRe = /^class\s+(\w+)(?:\(([^)]*)\))?:/gm
    const classes = []
    while ((m = classRe.exec(content)) !== null) {
      const parents = m[2]
        ? m[2].split(',').map(s => s.trim()).filter(s => s && s !== 'object')
        : []
      classes.push({ name: m[1], parents })
    }

    if (classes.length > 0) {
      node.className = classes[0].name
      node.classType = 'class'
      node.extends = classes[0].parents[0] || null
      node.implements = classes[0].parents.slice(1)
      node.fqn = (node.packageName ? node.packageName + '.' : '') + node.className
    }

    // Methods — top-level defs and class-level (indented with 4 spaces)
    const methodRe = /^(?:    )?(?:async\s+)?def\s+(\w+)\s*\(/gm
    while ((m = methodRe.exec(content)) !== null) {
      const name = m[1]
      if (!node.methods.includes(name)) node.methods.push(name)
    }

  } catch (err) {
    node.parseError = err.message
  }

  return node
}

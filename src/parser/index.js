import { parseJava } from './java.js'
import { parseJS } from './javascript.js'
import { parsePython } from './python.js'

const EXTENSION_MAP = {
  '.java': parseJava,
  '.js': parseJS,
  '.ts': parseJS,
  '.jsx': parseJS,
  '.tsx': parseJS,
  '.py': parsePython
}

export function parseFile(content, filePath) {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot === -1) return null

  const ext = filePath.substring(lastDot)
  const parser = EXTENSION_MAP[ext]
  if (!parser) return null

  try {
    return parser(content, filePath)
  } catch (err) {
    return {
      path: filePath,
      language: ext.substring(1),
      fileName: filePath.split('/').pop(),
      packageName: null,
      className: null,
      classType: 'module',
      annotations: [],
      imports: [],
      extends: null,
      implements: [],
      methods: [],
      lineCount: content ? content.split('\n').length : 0,
      isExternal: false,
      parseError: err.message,
      subtype: null,
      fqn: filePath
    }
  }
}

export const NodeType = {
  PACKAGE:   'package',
  CLASS:     'class',
  INTERFACE: 'interface',
  ENUM:      'enum',
  FUNCTION:  'function',
  FILE:      'file',
  EXTERNAL:  'external'
}

export const EdgeType = {
  IMPORTS:    'imports',
  EXTENDS:    'extends',
  IMPLEMENTS: 'implements',
  INJECTS:    'injects',
  CIRCULAR:   'circular'
}

function deriveNodeType(fileNode) {
  if (fileNode.classType === 'interface') return NodeType.INTERFACE
  if (fileNode.classType === 'enum')      return NodeType.ENUM
  if (fileNode.className)                 return NodeType.CLASS
  return NodeType.FILE
}

function resolveJSPath(importPath, fromFilePath, nodeMap) {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) return null
  const dir = fromFilePath.substring(0, fromFilePath.lastIndexOf('/'))
  const parts = `${dir}/${importPath}`.split('/')
  const resolved = []
  for (const p of parts) {
    if (p === '..') resolved.pop()
    else if (p !== '.') resolved.push(p)
  }
  const base = resolved.join('/')
  const candidates = [
    base,
    `${base}.js`, `${base}.ts`, `${base}.jsx`, `${base}.tsx`,
    `${base}/index.js`, `${base}/index.ts`, `${base}/index.jsx`, `${base}/index.tsx`
  ]
  for (const c of candidates) {
    if (nodeMap.has(c)) return c
  }
  return null
}

function resolvePythonPath(importRaw, fromFilePath, nodeMap) {
  if (importRaw.startsWith('.')) {
    // Relative: from . import X
    const dir = fromFilePath.substring(0, fromFilePath.lastIndexOf('/'))
    const dots = importRaw.match(/^\.+/)[0].length
    const parts = dir.split('/')
    const base = parts.slice(0, parts.length - (dots - 1)).join('/')
    const rest = importRaw.replace(/^\.+/, '')
    const candidate = rest ? `${base}/${rest.replace(/\./g, '/')}.py` : `${base}/__init__.py`
    if (nodeMap.has(candidate)) return candidate
    return null
  }
  // Absolute module path: try to find matching file
  const asPath = importRaw.replace(/\./g, '/') + '.py'
  for (const key of nodeMap.keys()) {
    if (key.endsWith(asPath) || key === asPath) return key
  }
  return null
}

function makeEdgeId(source, target, type) {
  return `${source}→${target}:${type}`
}

export function buildGraph(fileNodes, repoMeta) {
  const nodeMap = new Map()   // id → Node
  const edgeMap = new Map()   // edgeId → Edge

  // Step 1: build node for each parsed file
  for (const fn of fileNodes) {
    const id = fn.fqn || fn.path
    const node = {
      id,
      label: fn.className || fn.fileName || fn.path.split('/').pop(),
      type: deriveNodeType(fn),
      language: fn.language,
      filePath: fn.path,
      subtype: fn.subtype || null,
      packageName: fn.packageName || null,
      methods: fn.methods || [],
      lineCount: fn.lineCount || 0,
      annotations: fn.annotations || [],
      metrics: { fanIn: 0, fanOut: 0, isHotspot: false, isOrphan: false, isCircular: false }
    }
    nodeMap.set(id, node)

    // Also index by file path for JS resolution
    if (id !== fn.path) nodeMap.set(fn.path, node)
  }

  // Step 2: create external nodes (deduplicated by root package name)
  const externalMap = new Map()  // rootPkg → external Node id

  for (const fn of fileNodes) {
    for (const imp of fn.imports || []) {
      if (!imp.isExternal) continue
      const rootPkg = imp.raw.split('.')[0].split('/')[0]
      if (!externalMap.has(rootPkg)) {
        const extId = `external:${rootPkg}`
        externalMap.set(rootPkg, extId)
        nodeMap.set(extId, {
          id: extId,
          label: rootPkg,
          type: NodeType.EXTERNAL,
          language: 'external',
          filePath: null,
          subtype: null,
          packageName: null,
          methods: [],
          lineCount: 0,
          annotations: [],
          metrics: { fanIn: 0, fanOut: 0, isHotspot: false, isOrphan: false, isCircular: false }
        })
      }
    }
  }

  // Step 3: resolve imports → edges
  for (const fn of fileNodes) {
    const sourceId = fn.fqn || fn.path

    for (const imp of fn.imports || []) {
      let targetId = null

      if (imp.isExternal) {
        const rootPkg = imp.raw.split('.')[0].split('/')[0]
        targetId = externalMap.get(rootPkg) || null
      } else if (fn.language === 'java') {
        // FQN match
        if (nodeMap.has(imp.raw)) targetId = imp.raw
      } else if (fn.language === 'javascript' || fn.language === 'typescript') {
        targetId = resolveJSPath(imp.raw, fn.path, nodeMap)
        // normalize: find canonical id (fqn may differ from path)
        if (targetId && nodeMap.has(targetId)) {
          const t = nodeMap.get(targetId)
          targetId = t.id
        }
      } else if (fn.language === 'python') {
        targetId = resolvePythonPath(imp.raw, fn.path, nodeMap)
        if (targetId && nodeMap.has(targetId)) {
          const t = nodeMap.get(targetId)
          targetId = t.id
        }
      }

      if (!targetId || targetId === sourceId) continue
      if (!nodeMap.has(targetId)) continue

      const edgeId = makeEdgeId(sourceId, targetId, EdgeType.IMPORTS)
      if (!edgeMap.has(edgeId)) {
        edgeMap.set(edgeId, {
          id: edgeId,
          source: sourceId,
          target: targetId,
          type: EdgeType.IMPORTS,
          label: null,
          isCircular: false
        })
      }
    }

    // Step 4: extends edges
    if (fn.extends) {
      const targetNode = findByClassName(fn.extends, nodeMap, fn.packageName)
      if (targetNode && targetNode.id !== sourceId) {
        const edgeId = makeEdgeId(sourceId, targetNode.id, EdgeType.EXTENDS)
        if (!edgeMap.has(edgeId)) {
          edgeMap.set(edgeId, {
            id: edgeId,
            source: sourceId,
            target: targetNode.id,
            type: EdgeType.EXTENDS,
            label: 'extends',
            isCircular: false
          })
        }
      }
    }

    // implements edges
    for (const iface of fn.implements || []) {
      const targetNode = findByClassName(iface, nodeMap, fn.packageName)
      if (targetNode && targetNode.id !== sourceId) {
        const edgeId = makeEdgeId(sourceId, targetNode.id, EdgeType.IMPLEMENTS)
        if (!edgeMap.has(edgeId)) {
          edgeMap.set(edgeId, {
            id: edgeId,
            source: sourceId,
            target: targetNode.id,
            type: EdgeType.IMPLEMENTS,
            label: 'implements',
            isCircular: false
          })
        }
      }
    }
  }

  // Remove path-aliased entries — keep only canonical ids
  const canonicalNodes = []
  const seenIds = new Set()
  for (const node of nodeMap.values()) {
    if (!seenIds.has(node.id)) {
      seenIds.add(node.id)
      canonicalNodes.push(node)
    }
  }

  return {
    nodes: canonicalNodes,
    edges: Array.from(edgeMap.values()),
    meta: {
      ...repoMeta,
      parsedFiles: fileNodes.length,
      generatedAt: Date.now()
    }
  }
}

// Find a node by class name (exact or package-qualified)
function findByClassName(name, nodeMap, samePackage) {
  // Direct FQN match
  if (nodeMap.has(name)) return nodeMap.get(name)

  // Same-package lookup for Java
  if (samePackage) {
    const fqn = `${samePackage}.${name}`
    if (nodeMap.has(fqn)) return nodeMap.get(fqn)
  }

  // Scan all nodes for label match
  for (const node of nodeMap.values()) {
    if (node.label === name && node.type !== NodeType.EXTERNAL) return node
  }

  return null
}

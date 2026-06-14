import { NodeType, EdgeType } from './builder.js'

const HOTSPOT_THRESHOLD = 8

export function computeInsights(graph) {
  const { nodes, edges } = graph

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Reset metrics
  for (const node of nodes) {
    node.metrics = { fanIn: 0, fanOut: 0, isHotspot: false, isOrphan: false, isCircular: false }
  }

  // Fan-in / fan-out
  for (const edge of edges) {
    const src = nodeMap.get(edge.source)
    const tgt = nodeMap.get(edge.target)
    if (src) src.metrics.fanOut++
    if (tgt) tgt.metrics.fanIn++
  }

  // Hotspot + orphan
  for (const node of nodes) {
    const total = node.metrics.fanIn + node.metrics.fanOut
    node.metrics.isHotspot = total > HOTSPOT_THRESHOLD && node.type !== NodeType.EXTERNAL
    node.metrics.isOrphan  = node.metrics.fanIn === 0 && node.metrics.fanOut === 0 && node.type !== NodeType.EXTERNAL
  }

  // Circular dependency detection (DFS)
  const adj = new Map()
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, [])
    adj.get(edge.source).push(edge.target)
  }

  const visited      = new Set()
  const recStack     = new Set()
  const circularChains = []
  const circularNodes  = new Set()

  function dfs(nodeId, path) {
    visited.add(nodeId)
    recStack.add(nodeId)

    for (const neighbor of (adj.get(nodeId) || [])) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, nodeId])
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor)
        const cycle = cycleStart >= 0
          ? [...path.slice(cycleStart), nodeId]
          : [neighbor, nodeId]
        circularChains.push(cycle)
        for (const id of cycle) circularNodes.add(id)
      }
    }

    recStack.delete(nodeId)
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) dfs(node.id, [])
  }

  // Mark circular nodes + edges
  for (const node of nodes) {
    if (circularNodes.has(node.id)) node.metrics.isCircular = true
  }

  for (const edge of edges) {
    if (circularNodes.has(edge.source) && circularNodes.has(edge.target)) {
      edge.isCircular = true
      edge.type = EdgeType.CIRCULAR
    }
  }

  // Build insights summary
  const hotspots = nodes
    .filter(n => n.metrics.isHotspot)
    .sort((a, b) => (b.metrics.fanIn + b.metrics.fanOut) - (a.metrics.fanIn + a.metrics.fanOut))

  const orphans = nodes.filter(n => n.metrics.isOrphan)

  const externalDeps = nodes.filter(n => n.type === NodeType.EXTERNAL)

  const langBreakdown = { java: 0, javascript: 0, typescript: 0, python: 0, other: 0 }
  for (const n of nodes) {
    if (n.type === NodeType.EXTERNAL) continue
    const lang = n.language
    if (lang in langBreakdown) langBreakdown[lang]++
    else langBreakdown.other++
  }

  return {
    hotspots,
    orphans,
    circularChains,
    externalDependencies: externalDeps,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    languageBreakdown: langBreakdown
  }
}

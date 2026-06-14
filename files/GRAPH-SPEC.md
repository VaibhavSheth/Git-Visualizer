# Graph Specification

---

## Data Structures

### Node
```js
{
  // Required
  id: string,            // unique — FQN for Java, abs path for JS/Python
  label: string,         // display name (className or fileName)
  type: NodeType,
  language: string,      // "java" | "javascript" | "typescript" | "python"
  filePath: string,

  // Optional metadata
  subtype: string | null,        // "service" | "controller" | "repository" | "component" | "config" | "entity"
  packageName: string | null,
  methods: string[],
  lineCount: number,
  annotations: string[],

  // Computed by insights.js
  metrics: {
    fanIn: number,         // incoming edges count
    fanOut: number,        // outgoing edges count
    isHotspot: boolean,    // fanIn + fanOut > HOTSPOT_THRESHOLD (default 8)
    isOrphan: boolean,     // fanIn === 0 AND fanOut === 0
    isCircular: boolean    // part of a circular dependency chain
  }
}
```

### NodeType enum
```js
const NodeType = {
  PACKAGE: 'package',       // Java package / Python module folder
  CLASS: 'class',           // Java class, Python class, JS class
  INTERFACE: 'interface',   // Java interface, TS interface
  ENUM: 'enum',             // Java/TS enum
  FUNCTION: 'function',     // Python top-level function, JS exported function
  FILE: 'file',             // JS/TS file without a dominant class
  EXTERNAL: 'external'      // npm package, Java stdlib, PyPI package
}
```

### Edge
```js
{
  id: string,            // "{sourceId}→{targetId}:{type}"
  source: string,        // node id
  target: string,        // node id
  type: EdgeType,
  label: string | null,  // e.g. "@Autowired", "extends"
  isCircular: boolean    // true if this edge is part of a cycle
}
```

### EdgeType enum
```js
const EdgeType = {
  IMPORTS: 'imports',         // file A imports from file B
  CALLS: 'calls',             // method A calls method B (future enhancement)
  EXTENDS: 'extends',         // class A extends class B
  IMPLEMENTS: 'implements',   // class A implements interface B
  INJECTS: 'injects',         // Spring @Autowired injection
  CIRCULAR: 'circular'        // part of a detected cycle (override type)
}
```

### Graph
```js
{
  nodes: Node[],
  edges: Edge[],
  meta: {
    owner: string,
    repo: string,
    branch: string,
    commitSha: string,
    language: string,         // dominant language
    totalFiles: number,
    parsedFiles: number,
    skippedFiles: number,
    generatedAt: timestamp
  }
}
```

### Insights
```js
{
  hotspots: Node[],           // sorted by fanIn + fanOut desc
  orphans: Node[],            // nodes with no connections
  circularChains: string[][], // each chain is an array of node ids
  totalNodes: number,
  totalEdges: number,
  externalDependencies: Node[], // all external nodes
  languageBreakdown: {
    java: number,
    javascript: number,
    python: number
  }
}
```

---

## graph/builder.js Algorithm

```
Input: FileNode[]
Output: { nodes: Node[], edges: Edge[] }

Step 1: Build node map
  For each FileNode:
    Create a Node with id = FQN (Java) or abs path (JS/Python)
    Add to nodeMap: Map<id, Node>

Step 2: Create external nodes
  For each FileNode's imports where isExternal === true:
    If no external node exists for this package name:
      Create an EXTERNAL Node
      Add to nodeMap

Step 3: Resolve imports and create edges
  For each FileNode:
    For each import in FileNode.imports:
      If isExternal:
        target = external node for this package
      Else (internal):
        Java: target = nodeMap.get(import.raw)  // FQN match
        JS:   target = nodeMap.get(resolveJSPath(import.raw, filePath))
        Python: target = nodeMap.get(resolvePythonPath(import.raw, filePath))
      
      If target found:
        Create Edge { source: currentNode.id, target: target.id, type: "imports" }
      Else:
        Skip (unresolved — possibly a transient dependency not in repo)

Step 4: Create extends/implements edges
  For each FileNode with extends or implements:
    Find the target node in nodeMap by class name (partial match)
    Create Edge with type "extends" or "implements"
```

### JS path resolution
```js
function resolveJSPath(importPath, fromFilePath) {
  // importPath = "./services/UserService"
  // fromFilePath = "src/components/UserCard.jsx"
  
  const dir = fromFilePath.substring(0, fromFilePath.lastIndexOf('/'))
  const resolved = path.join(dir, importPath)  // "src/components/services/UserService"
  
  // Try extensions in order:
  for (const ext of ['.js', '.ts', '.jsx', '.tsx', '/index.js', '/index.ts']) {
    const candidate = resolved + ext
    if (nodeMap.has(candidate)) return candidate
  }
  return null
}
```

---

## graph/insights.js Algorithm

### Fan-in / Fan-out
```js
// Initialize all nodes with metrics = { fanIn: 0, fanOut: 0 }
for (const edge of edges) {
  nodeMap.get(edge.source).metrics.fanOut++
  nodeMap.get(edge.target).metrics.fanIn++
}
```

### Hotspot detection
```js
const HOTSPOT_THRESHOLD = 8
for (const node of nodes) {
  node.metrics.isHotspot =
    (node.metrics.fanIn + node.metrics.fanOut) > HOTSPOT_THRESHOLD
    && node.type !== NodeType.EXTERNAL  // externals are always high fanIn
}
```

### Orphan detection
```js
for (const node of nodes) {
  node.metrics.isOrphan =
    node.metrics.fanIn === 0
    && node.metrics.fanOut === 0
    && node.type !== NodeType.EXTERNAL
}
```

### Circular dependency detection (DFS)
```js
function detectCycles(nodes, edges) {
  const adj = buildAdjacencyList(edges)  // Map<nodeId, nodeId[]>
  const visited = new Set()
  const recursionStack = new Set()
  const cycles = []

  function dfs(nodeId, path) {
    visited.add(nodeId)
    recursionStack.add(nodeId)
    path.push(nodeId)

    for (const neighbor of (adj.get(nodeId) || [])) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path])
      } else if (recursionStack.has(neighbor)) {
        // Found a cycle — extract the cycle
        const cycleStart = path.indexOf(neighbor)
        const cycle = path.slice(cycleStart)
        cycles.push(cycle)
        // Mark the edges in this cycle
        markCycleEdges(cycle, edges)
      }
    }

    recursionStack.delete(nodeId)
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) dfs(node.id, [])
  }

  return cycles
}
```

---

## D3-force Rendering Parameters

### Force simulation
```js
d3.forceSimulation(nodes)
  .force("link", d3.forceLink(edges)
    .id(d => d.id)
    .distance(edge => {
      if (edge.type === 'extends') return 60      // close — parent/child
      if (edge.type === 'implements') return 70
      if (edge.type === 'injects') return 80
      return 100  // default for imports
    })
  )
  .force("charge", d3.forceManyBody()
    .strength(node => node.metrics.isHotspot ? -400 : -200)
  )
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide()
    .radius(node => node.metrics.isHotspot ? 40 : 25)
  )
  .alphaDecay(0.02)  // slower decay = more settling time
```

### Node visual properties
```js
const NODE_COLORS = {
  package:    '#378ADD',  // blue
  class:      '#1D9E75',  // teal
  interface:  '#7F77DD',  // purple
  enum:       '#BA7517',  // amber
  function:   '#1D9E75',  // teal (same as class)
  file:       '#5F5E5A',  // gray
  external:   '#B4B2A9'   // light gray
}

const NODE_RADIUS = node => {
  if (node.metrics.isHotspot) return 18
  if (node.metrics.isOrphan)  return 8
  return 12
}

// Hotspot nodes get a pulsing amber ring
// Circular nodes get a red stroke
// Orphan nodes are smaller and faded
```

### Edge visual properties
```js
const EDGE_STYLES = {
  imports:    { stroke: '#B4B2A9', width: 1, dash: null },
  extends:    { stroke: '#7F77DD', width: 2, dash: null },
  implements: { stroke: '#7F77DD', width: 1.5, dash: '5,3' },
  injects:    { stroke: '#1D9E75', width: 1.5, dash: '3,2' },
  circular:   { stroke: '#E24B4A', width: 2, dash: null }
}
```

---

## Graph Performance — Large Repos

| Node count | Strategy |
|---|---|
| < 100 | Full simulation, all forces active, all labels visible |
| 100–300 | Labels hidden by default, show on hover only |
| 300–500 | Reduce charge force, disable collision force, cluster by package |
| > 500 | Warn user, only render first 500 nodes, add folder filter |

### Clustering strategy for large repos
Group nodes by package (Java) or top-level folder (JS/Python).
Render a `PACKAGE` super-node first, then allow expanding/collapsing individual packages.
This keeps large repos navigable without overwhelming D3.

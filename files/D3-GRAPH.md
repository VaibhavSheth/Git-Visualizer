# D3-force Graph Implementation Guide

Everything needed to implement the interactive dependency graph in `sidepanel.js`.

---

## Setup

D3 must be bundled locally (MV3 CSP blocks CDN):
```
src/lib/d3.min.js   ← copy from node_modules/d3/dist/d3.min.js
```

HTML:
```html
<script src="../lib/d3.min.js"></script>
```

---

## Core Structure

```js
// sidepanel.js

const svg = d3.select('#graph')
const width = window.innerWidth
const height = window.innerHeight - 60  // subtract toolbar height

// Zoom container — all graph elements go inside this group
const container = svg.append('g').attr('class', 'zoom-container')

// Zoom behavior
const zoom = d3.zoom()
  .scaleExtent([0.1, 4])
  .on('zoom', (event) => container.attr('transform', event.transform))
svg.call(zoom)

// Arrow marker defs (for directed edges)
svg.append('defs').selectAll('marker')
  .data(['imports', 'extends', 'implements', 'injects', 'circular'])
  .join('marker')
  .attr('id', d => `arrow-${d}`)
  .attr('viewBox', '0 0 10 10')
  .attr('refX', 20)   // offset so arrow doesn't overlap node
  .attr('refY', 5)
  .attr('markerWidth', 6)
  .attr('markerHeight', 6)
  .attr('orient', 'auto-start-reverse')
  .append('path')
  .attr('d', 'M2 1L8 5L2 9')
  .attr('fill', 'none')
  .attr('stroke', d => EDGE_COLORS[d])
  .attr('stroke-width', 1.5)
```

---

## Rendering the Graph

```js
function renderGraph({ nodes, edges }) {

  // --- FORCE SIMULATION ---
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges)
      .id(d => d.id)
      .distance(d => EDGE_DISTANCE[d.type] || 100)
    )
    .force('charge', d3.forceManyBody()
      .strength(d => d.metrics.isHotspot ? -400 : -200)
    )
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide()
      .radius(d => getNodeRadius(d) + 5)
    )

  // --- EDGES ---
  const link = container.append('g').attr('class', 'links')
    .selectAll('line')
    .data(edges)
    .join('line')
    .attr('stroke', d => EDGE_COLORS[d.type])
    .attr('stroke-width', d => EDGE_WIDTH[d.type] || 1)
    .attr('stroke-dasharray', d => EDGE_DASH[d.type] || null)
    .attr('marker-end', d => `url(#arrow-${d.type})`)
    .attr('opacity', 0.6)

  // --- NODES ---
  const node = container.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', dragStart)
      .on('drag', dragged)
      .on('end', dragEnd)
    )
    .on('click', (event, d) => {
      event.stopPropagation()
      selectNode(d, node, link)
    })

  // Circle
  node.append('circle')
    .attr('r', d => getNodeRadius(d))
    .attr('fill', d => NODE_COLORS[d.type] || '#888')
    .attr('stroke', d => d.metrics.isCircular ? '#E24B4A' : 'rgba(255,255,255,0.3)')
    .attr('stroke-width', d => d.metrics.isCircular ? 3 : 1)

  // Label (only shown for larger nodes or on hover)
  node.append('text')
    .text(d => d.label)
    .attr('font-size', '11px')
    .attr('text-anchor', 'middle')
    .attr('dy', d => getNodeRadius(d) + 12)
    .attr('fill', 'var(--text-secondary)')
    .style('pointer-events', 'none')
    .style('display', d => d.metrics.isHotspot ? 'block' : 'none')  // only show for hotspots initially

  // Hotspot ring (pulsing amber ring for hotspot nodes)
  node.filter(d => d.metrics.isHotspot)
    .append('circle')
    .attr('r', d => getNodeRadius(d) + 5)
    .attr('fill', 'none')
    .attr('stroke', '#BA7517')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '4 2')
    .attr('opacity', 0.6)

  // --- SIMULATION TICK ---
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)

    node.attr('transform', d => `translate(${d.x},${d.y})`)
  })

  // Click on background to deselect
  svg.on('click', () => clearSelection(node, link))

  return { simulation, node, link }
}
```

---

## Node Visual Config

```js
const NODE_COLORS = {
  package:   '#378ADD',
  class:     '#1D9E75',
  interface: '#7F77DD',
  enum:      '#BA7517',
  function:  '#1D9E75',
  file:      '#5F5E5A',
  external:  '#B4B2A9'
}

function getNodeRadius(d) {
  if (d.metrics.isHotspot) return 20
  if (d.metrics.isOrphan)  return 7
  if (d.type === 'external') return 8
  if (d.type === 'package')  return 16
  return 12
}
```

---

## Edge Visual Config

```js
const EDGE_COLORS = {
  imports:    '#B4B2A9',
  extends:    '#7F77DD',
  implements: '#7F77DD',
  injects:    '#1D9E75',
  circular:   '#E24B4A'
}

const EDGE_WIDTH = {
  imports:    1,
  extends:    2,
  implements: 1.5,
  injects:    1.5,
  circular:   2.5
}

const EDGE_DASH = {
  implements: '5 3',
  injects:    '3 2'
}

const EDGE_DISTANCE = {
  extends:    60,
  implements: 70,
  injects:    80,
  imports:    100
}
```

---

## Node Selection

```js
function selectNode(selectedNode, nodeSelection, linkSelection) {
  // Find all connected node IDs
  const connectedIds = new Set([selectedNode.id])
  linkSelection.each(d => {
    if (d.source.id === selectedNode.id) connectedIds.add(d.target.id)
    if (d.target.id === selectedNode.id) connectedIds.add(d.source.id)
  })

  // Dim unconnected nodes
  nodeSelection
    .transition().duration(200)
    .attr('opacity', d => connectedIds.has(d.id) ? 1 : 0.15)

  // Dim unconnected edges
  linkSelection
    .transition().duration(200)
    .attr('opacity', d =>
      (d.source.id === selectedNode.id || d.target.id === selectedNode.id) ? 1 : 0.05
    )

  // Show detail panel
  showDetailPanel(selectedNode)
}

function clearSelection(nodeSelection, linkSelection) {
  nodeSelection.transition().duration(200).attr('opacity', 1)
  linkSelection.transition().duration(200).attr('opacity', 0.6)
  hideDetailPanel()
}
```

---

## Drag Behavior

```js
function dragStart(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart()
  d.fx = d.x
  d.fy = d.y
}

function dragged(event, d) {
  d.fx = event.x
  d.fy = event.y
}

function dragEnd(event, d) {
  if (!event.active) simulation.alphaTarget(0)
  // Keep node pinned where user dropped it
  // (set fx/fy to null to release)
}
```

---

## Filter Implementation

```js
let activeFilter = 'all'

function applyFilter(type) {
  activeFilter = type

  d3.selectAll('.node')
    .transition().duration(300)
    .attr('opacity', d => {
      if (type === 'all') return 1
      if (type === 'external' && d.type === 'external') return 1
      if (type === d.type) return 1
      return 0.1
    })
    .style('pointer-events', d => {
      if (type === 'all' || type === d.type) return 'all'
      return 'none'
    })

  d3.selectAll('.links line')
    .transition().duration(300)
    .attr('opacity', d => {
      if (type === 'all') return 0.6
      const sourceMatch = d.source.type === type || type === 'all'
      const targetMatch = d.target.type === type || type === 'all'
      return sourceMatch || targetMatch ? 0.6 : 0.05
    })
}
```

---

## Search

```js
const searchInput = document.getElementById('search')

searchInput.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase().trim()

  d3.selectAll('.node')
    .transition().duration(200)
    .attr('opacity', d => {
      if (!term) return 1
      return d.label.toLowerCase().includes(term) ? 1 : 0.1
    })
})
```

---

## Performance — Large Graph Optimizations

```js
// For graphs > 200 nodes, disable tick animations and use one-shot layout
if (nodes.length > 200) {
  // Run simulation to completion without rendering each tick
  simulation.stop()
  for (let i = 0; i < 300; i++) simulation.tick()

  // Then render final positions
  link
    .attr('x1', d => d.source.x)
    .attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x)
    .attr('y2', d => d.target.y)

  node.attr('transform', d => `translate(${d.x},${d.y})`)
}

// Hide labels for large graphs — show only on hover
if (nodes.length > 100) {
  node.selectAll('text').style('display', 'none')
  node.on('mouseenter', (event, d) => {
    d3.select(event.currentTarget).select('text').style('display', 'block')
  })
  node.on('mouseleave', (event, d) => {
    d3.select(event.currentTarget).select('text').style('display', 'none')
  })
}
```

---

## Export as PNG

```js
function exportAsPNG() {
  const svgElement = document.getElementById('graph')
  const svgData = new XMLSerializer().serializeToString(svgElement)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const img = new Image()
  img.onload = () => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0)
    const link = document.createElement('a')
    link.download = 'code-graph.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }
  img.src = 'data:image/svg+xml;base64,' + btoa(svgData)
}
```

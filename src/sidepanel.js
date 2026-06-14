import { parseFile } from './parser/index.js'
import { buildGraph } from './graph/builder.js'
import { computeInsights } from './graph/insights.js'

// ── DOM refs ──────────────────────────────────────────────
const progressEl   = document.getElementById('progress')
const progressBar  = document.getElementById('progress-bar')
const progressText = document.getElementById('progress-text')
const errorPanel   = document.getElementById('error-panel')
const errorTitle   = document.getElementById('error-title')
const errorMessage = document.getElementById('error-message')
const errorHint    = document.getElementById('error-hint')
const idlePanel    = document.getElementById('idle-panel')
const graphContainer = document.getElementById('graph-container')
const filterBar    = document.getElementById('filter-bar')
const graphStats   = document.getElementById('graph-stats')
const repoName     = document.getElementById('repo-name')
const detailPanel  = document.getElementById('detail-panel')
const detailContent = document.getElementById('detail-content')
const insightsPanel = document.getElementById('insights-panel')

// ── Node / edge visual config ─────────────────────────────
const NODE_COLORS = {
  package:   '#378ADD',
  class:     '#1D9E75',
  interface: '#7F77DD',
  enum:      '#BA7517',
  function:  '#1D9E75',
  file:      '#5F5E5A',
  external:  '#B4B2A9'
}

const EDGE_COLORS = {
  imports:    '#B4B2A9',
  extends:    '#7F77DD',
  implements: '#7F77DD',
  injects:    '#1D9E75',
  circular:   '#E24B4A'
}
const EDGE_WIDTH  = { imports: 1, extends: 2, implements: 1.5, injects: 1.5, circular: 2.5 }
const EDGE_DASH   = { implements: '5 3', injects: '3 2' }
const EDGE_DIST   = { extends: 100, implements: 120, injects: 130, imports: 160 }

function nodeRadius(d) {
  if (d.metrics.isHotspot)    return 20
  if (d.metrics.isOrphan)     return 7
  if (d.type === 'external')  return 8
  if (d.type === 'package')   return 16
  return 12
}

// ── D3 state ─────────────────────────────────────────────
let simulation = null
let svgNode = null, svgLink = null
let currentGraph = null

function initSVG() {
  const svg = d3.select('#graph')
  svg.selectAll('*').remove()

  const w = graphContainer.clientWidth
  const h = graphContainer.clientHeight

  // Zoom container
  const container = svg.append('g').attr('class', 'zoom-container')

  const zoom = d3.zoom()
    .scaleExtent([0.05, 4])
    .on('zoom', e => container.attr('transform', e.transform))
  svg.call(zoom)

  // Arrow markers
  const defs = svg.append('defs')
  for (const [type, color] of Object.entries(EDGE_COLORS)) {
    defs.append('marker')
      .attr('id', `arrow-${type}`)
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 22).attr('refY', 5)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M2 1L8 5L2 9')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.5)
  }

  return { svg, container, w, h, zoom }
}

function renderGraph(graph) {
  currentGraph = graph
  const { nodes, edges } = graph

  const { svg, container, w, h } = initSVG()

  // Drag handlers need reference to simulation
  function dragStart(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart()
    d.fx = d.x; d.fy = d.y
  }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y }
  function dragEnd(event, d) { if (!event.active) simulation.alphaTarget(0) }

  // ── Simulation ──
  const chargeStrength = nodes.length > 100 ? -300 : nodes.length > 50 ? -500 : -800

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id).distance(d => EDGE_DIST[d.type] || 160))
    .force('charge', d3.forceManyBody().strength(d => d.metrics.isHotspot ? chargeStrength * 2 : chargeStrength))
    .force('center', d3.forceCenter(w / 2, h / 2))
    .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 20))
    .force('x', d3.forceX(w / 2).strength(0.03))
    .force('y', d3.forceY(h / 2).strength(0.03))
    .alphaDecay(0.015)
    .velocityDecay(0.4)

  // For large graphs — pre-compute layout, skip live animation
  if (nodes.length > 200) {
    simulation.stop()
    for (let i = 0; i < 500; i++) simulation.tick()
  }

  // ── Edges ──
  const linkG = container.append('g').attr('class', 'links')
  svgLink = linkG.selectAll('line').data(edges).join('line')
    .attr('stroke', d => EDGE_COLORS[d.type] || '#888')
    .attr('stroke-width', d => EDGE_WIDTH[d.type] || 1)
    .attr('stroke-dasharray', d => EDGE_DASH[d.type] || null)
    .attr('marker-end', d => `url(#arrow-${d.type})`)
    .attr('opacity', 0.55)

  // ── Nodes ──
  const nodeG = container.append('g').attr('class', 'nodes')
  svgNode = nodeG.selectAll('g').data(nodes).join('g')
    .attr('class', 'node')
    .call(d3.drag().on('start', dragStart).on('drag', dragged).on('end', dragEnd))
    .on('click', (event, d) => { event.stopPropagation(); selectNode(d) })

  // Circle
  svgNode.append('circle')
    .attr('r', d => nodeRadius(d))
    .attr('fill', d => NODE_COLORS[d.type] || '#888')
    .attr('stroke', d => d.metrics.isCircular ? '#E24B4A' : 'rgba(255,255,255,0.15)')
    .attr('stroke-width', d => d.metrics.isCircular ? 2.5 : 1)

  // Hotspot ring
  svgNode.filter(d => d.metrics.isHotspot)
    .append('circle')
    .attr('r', d => nodeRadius(d) + 6)
    .attr('fill', 'none')
    .attr('stroke', '#BA7517')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '4 2')
    .attr('opacity', 0.7)

  // Labels — only hotspots by default; all shown on hover for small graphs
  svgNode.append('text')
    .text(d => d.label)
    .attr('font-size', '10px')
    .attr('text-anchor', 'middle')
    .attr('dy', d => nodeRadius(d) + 13)
    .style('display', d => d.metrics.isHotspot ? 'block' : 'none')

  if (nodes.length <= 60) {
    svgNode.selectAll('text').style('display', 'block')
  } else if (nodes.length <= 150) {
    // Show only non-external labels
    svgNode.selectAll('text').style('display', d => d.type === 'external' ? 'none' : 'block')
  } else {
    // Hotspots always visible, rest on hover
    svgNode
      .on('mouseenter', (e, d) => d3.select(e.currentTarget).select('text').style('display', 'block'))
      .on('mouseleave', (e, d) => {
        if (!d.metrics.isHotspot) d3.select(e.currentTarget).select('text').style('display', 'none')
      })
  }

  // ── Tick ──
  if (nodes.length > 200) {
    // Already pre-computed — just set positions
    svgLink
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
    svgNode.attr('transform', d => `translate(${d.x},${d.y})`)
  } else {
    simulation.on('tick', () => {
      svgLink
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      svgNode.attr('transform', d => `translate(${d.x},${d.y})`)
    })
  }

  // Click background to deselect
  d3.select('#graph').on('click', clearSelection)
}

// ── Node selection ────────────────────────────────────────
function selectNode(d) {
  const connectedIds = new Set([d.id])
  svgLink.each(e => {
    if (e.source.id === d.id) connectedIds.add(e.target.id)
    if (e.target.id === d.id) connectedIds.add(e.source.id)
  })

  svgNode.transition().duration(200)
    .attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.1)
  svgLink.transition().duration(200)
    .attr('opacity', e =>
      (e.source.id === d.id || e.target.id === d.id) ? 1 : 0.04)

  showDetailPanel(d)
}

function clearSelection() {
  if (!svgNode) return
  svgNode.transition().duration(200).attr('opacity', 1)
  svgLink.transition().duration(200).attr('opacity', 0.55)
  detailPanel.hidden = true
}

// ── Detail panel ──────────────────────────────────────────
function showDetailPanel(d) {
  const badgeClass = `badge-${d.subtype || 'default'}`
  const annotations = (d.annotations || []).map(a =>
    `<span class="detail-badge ${badgeClass}">${a}</span>`).join('')
  const methods = (d.methods || []).slice(0, 20).map(m =>
    `<span class="method-chip">${m}()</span>`).join('')

  detailContent.innerHTML = `
    <h3>${d.label}</h3>
    ${annotations ? `<div class="detail-row"><span class="detail-label">Annotations</span><div>${annotations}</div></div>` : ''}
    <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${d.type}${d.subtype ? ` · ${d.subtype}` : ''}</span></div>
    <div class="detail-row"><span class="detail-label">Language</span><span class="detail-value">${d.language}</span></div>
    ${d.packageName ? `<div class="detail-row"><span class="detail-label">Package</span><span class="detail-value">${d.packageName}</span></div>` : ''}
    ${d.filePath ? `<div class="detail-row"><span class="detail-label">File</span><span class="detail-value">${d.filePath}</span></div>` : ''}
    <div class="detail-row"><span class="detail-label">Lines</span><span class="detail-value">${d.lineCount || '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Fan-in</span><span class="detail-value">${d.metrics.fanIn} &nbsp; <span style="color:#484f58">Fan-out</span> ${d.metrics.fanOut}</span></div>
    ${d.metrics.isHotspot ? '<div class="detail-row"><span style="color:#BA7517">⚡ Hotspot</span></div>' : ''}
    ${d.metrics.isCircular ? '<div class="detail-row"><span style="color:#E24B4A">🔄 Part of circular dependency</span></div>' : ''}
    ${methods ? `<div class="detail-row" style="flex-direction:column;gap:6px"><span class="detail-label">Methods</span><div class="methods-list">${methods}</div></div>` : ''}
  `
  detailPanel.hidden = false
}

document.getElementById('detail-close').addEventListener('click', () => {
  clearSelection()
})

// ── Filters ───────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    applyFilter(btn.dataset.filter)
  })
})

function applyFilter(type) {
  if (!svgNode) return
  svgNode.transition().duration(300)
    .attr('opacity', d => type === 'all' || d.type === type ? 1 : 0.08)
    .style('pointer-events', d => type === 'all' || d.type === type ? 'all' : 'none')

  svgLink.transition().duration(300)
    .attr('opacity', d => {
      if (type === 'all') return 0.55
      return (d.source.type === type || d.target.type === type) ? 0.55 : 0.03
    })
}

// ── Search ────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', e => {
  const term = e.target.value.toLowerCase().trim()
  if (!svgNode) return
  svgNode.transition().duration(200)
    .attr('opacity', d => !term || d.label.toLowerCase().includes(term) ? 1 : 0.08)
})

// ── Export PNG ────────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', () => {
  const svgEl = document.getElementById('graph')
  const data = new XMLSerializer().serializeToString(svgEl)
  const canvas = document.createElement('canvas')
  canvas.width = svgEl.clientWidth
  canvas.height = svgEl.clientHeight
  const ctx = canvas.getContext('2d')
  const img = new Image()
  img.onload = () => {
    ctx.fillStyle = '#0d1117'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    const a = document.createElement('a')
    a.download = `${repoName.textContent.replace('/', '-')}-graph.png`
    a.href = canvas.toDataURL('image/png')
    a.click()
  }
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)))
})

// ── Re-analyze ────────────────────────────────────────────
document.getElementById('reanalyze-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_REPO_INFO' }).catch(() => {})
  showIdle()
})

// ── Insights panel ────────────────────────────────────────
function showInsightsPanel(insights) {
  insightsPanel.hidden = false
  insightsPanel.innerHTML = `
    <div class="insight-row"><span>Nodes</span><span class="insight-val">${insights.totalNodes}</span></div>
    <div class="insight-row"><span>Edges</span><span class="insight-val">${insights.totalEdges}</span></div>
    <div class="insight-row"><span>Hotspots</span><span class="insight-val insight-amber">${insights.hotspots.length}</span></div>
    <div class="insight-row"><span>Circular</span><span class="insight-val insight-warn">${insights.circularChains.length}</span></div>
    <div class="insight-row"><span>Orphans</span><span class="insight-val">${insights.orphans.length}</span></div>
    <div class="insight-row"><span>External</span><span class="insight-val">${insights.externalDependencies.length}</span></div>
  `
}

// ── UI state helpers ──────────────────────────────────────
function showIdle() {
  idlePanel.hidden = false
  graphContainer.hidden = true
  filterBar.hidden = true
  errorPanel.hidden = true
  progressEl.hidden = true
  detailPanel.hidden = true
  insightsPanel.hidden = true
}

function showError(message) {
  idlePanel.hidden = true
  graphContainer.hidden = true
  filterBar.hidden = true
  errorPanel.hidden = false
  progressEl.hidden = true

  const labels = {
    NOT_FOUND: 'Repository Not Found',
    PRIVATE_REPO_NO_TOKEN: 'Private Repository',
    FORBIDDEN: 'Access Denied',
    RATE_LIMITED: 'Rate Limited',
    TOO_LARGE: 'Repository Too Large',
    EMPTY_REPO: 'No Source Files',
    FETCH_ERROR: 'Fetch Error'
  }
  errorTitle.textContent = labels[message.code] || 'Error'
  errorMessage.textContent = message.message || 'An unexpected error occurred.'

  if (message.code === 'PRIVATE_REPO_NO_TOKEN') {
    errorHint.hidden = false
    errorHint.textContent = 'Add a GitHub token in the extension popup to access private repos.'
  } else if (message.code === 'RATE_LIMITED') {
    const t = message.resetAt ? new Date(message.resetAt).toLocaleTimeString() : 'soon'
    errorHint.hidden = false
    errorHint.textContent = `Rate limit resets at ${t}. Retrying automatically...`
  } else {
    errorHint.hidden = true
  }
}

function showProgress(current, total, stage) {
  idlePanel.hidden = true
  graphContainer.hidden = true
  filterBar.hidden = true
  errorPanel.hidden = true
  progressEl.hidden = false

  progressBar.value = current
  progressBar.max = total
  progressText.textContent = `${stage === 'fetching' ? 'Fetching' : 'Parsing'} ${current} / ${total} files...`
}

// ── Parse + build graph pipeline ─────────────────────────
async function parseAndShow(files, meta) {
  const parsed = []
  const total = files.length

  showProgress(0, total, 'parsing')

  for (let i = 0; i < files.length; i++) {
    const node = parseFile(files[i].content, files[i].path)
    if (node) parsed.push(node)
    if (i % 5 === 0 || i === files.length - 1) {
      showProgress(i + 1, total, 'parsing')
      await new Promise(r => setTimeout(r, 0))
    }
  }

  const graph = buildGraph(parsed, meta)
  const insights = computeInsights(graph)

  console.log('[sidepanel] graph', graph.nodes.length, 'nodes', graph.edges.length, 'edges')

  // Show graph UI
  progressEl.hidden = true
  idlePanel.hidden = true
  errorPanel.hidden = true
  graphContainer.hidden = false
  filterBar.hidden = false

  repoName.textContent = `${meta.owner}/${meta.repo}`
  graphStats.textContent = `${graph.nodes.length} nodes · ${graph.edges.length} edges`

  renderGraph(graph)
  showInsightsPanel(insights)
}

// ── Message listener ──────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS') {
    showProgress(message.current, message.total, message.stage)
  }
  if (message.type === 'FILES_READY') {
    parseAndShow(message.files, message.meta)
  }
  if (message.type === 'ERROR') {
    showError(message)
    console.warn('[sidepanel] ERROR', message.code, message.message)
  }
})

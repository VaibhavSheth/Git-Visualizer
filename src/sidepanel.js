import { parseFile } from './parser/index.js'
import { buildGraph } from './graph/builder.js'
import { computeInsights } from './graph/insights.js'

// ── DOM refs ──────────────────────────────────────────────
const progressEl    = document.getElementById('progress')
const progressBar   = document.getElementById('progress-bar')
const progressText  = document.getElementById('progress-text')
const errorPanel    = document.getElementById('error-panel')
const errorTitle    = document.getElementById('error-title')
const errorMessage  = document.getElementById('error-message')
const errorHint     = document.getElementById('error-hint')
const idlePanel     = document.getElementById('idle-panel')
const graphContainer = document.getElementById('graph-container')
const filterBar     = document.getElementById('filter-bar')
const graphStats    = document.getElementById('graph-stats')
const repoName      = document.getElementById('repo-name')
const detailPanel   = document.getElementById('detail-panel')
const detailContent = document.getElementById('detail-content')
const insightsPanel = document.getElementById('insights-panel')
const tooltip       = document.getElementById('tooltip')
const repoMetaBar   = document.getElementById('repo-meta-bar')
const metaLanguage  = document.getElementById('meta-language')
const metaStars     = document.getElementById('meta-stars')
const metaFiles     = document.getElementById('meta-files')
const metaCache     = document.getElementById('meta-cache')
const folderPicker  = document.getElementById('folder-picker')
const folderList    = document.getElementById('folder-list')
const folderFileCount = document.getElementById('folder-file-count')

// ── Visual config ─────────────────────────────────────────
const NODE_COLORS = {
  package:   '#378ADD',
  class:     '#1D9E75',
  interface: '#7F77DD',
  enum:      '#BA7517',
  function:  '#1D9E75',
  file:      '#5F5E5A',
  external:  '#B4B2A9'
}

// Package → background hull color (subtle tint)
const PKG_COLORS = [
  'rgba(55,138,221,0.07)', 'rgba(29,158,117,0.07)', 'rgba(127,119,221,0.07)',
  'rgba(186,117,23,0.07)', 'rgba(226,75,74,0.07)',  'rgba(95,94,90,0.07)'
]

const EDGE_COLORS = {
  imports:    '#4a5568',
  extends:    '#7F77DD',
  implements: '#7F77DD',
  injects:    '#1D9E75',
  circular:   '#E24B4A'
}
const EDGE_WIDTH = { imports: 1, extends: 2, implements: 1.5, injects: 1.5, circular: 2.5 }
const EDGE_DASH  = { implements: '5 3', injects: '3 2' }
const EDGE_DIST  = { extends: 100, implements: 120, injects: 130, imports: 160 }

function nodeRadius(d) {
  if (d.metrics.isHotspot)   return 24
  if (d.metrics.isOrphan)    return 8
  if (d.type === 'external') return 10
  if (d.type === 'package')  return 18
  return 14
}

// ── Package color map ─────────────────────────────────────
function buildPackageColorMap(nodes) {
  const pkgs = [...new Set(nodes.filter(n => n.packageName).map(n => n.packageName))]
  const map = new Map()
  pkgs.forEach((pkg, i) => map.set(pkg, PKG_COLORS[i % PKG_COLORS.length]))
  return map
}

// ── D3 state ─────────────────────────────────────────────
let simulation = null
let svgNode = null, svgLink = null
let currentGraph = null
let currentZoomScale = 1

function initSVG() {
  const svg = d3.select('#graph')
  svg.selectAll('*').remove()
  const w = graphContainer.clientWidth
  const h = graphContainer.clientHeight
  const container = svg.append('g').attr('class', 'zoom-container')
  const zoom = d3.zoom().scaleExtent([0.05, 4])
    .on('zoom', e => {
      container.attr('transform', e.transform)
      currentZoomScale = e.transform.k
      if (svgNode && currentGraph && currentGraph.nodes.length > 80) {
        svgNode.selectAll('.node-label').style('display', function(d) {
          if (currentZoomScale >= 1.5) return 'block'
          if (currentZoomScale >= 0.8) return d.type !== 'external' ? 'block' : 'none'
          return d.metrics.isHotspot ? 'block' : 'none'
        })
      }
    })
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
      .append('path').attr('d', 'M2 1L8 5L2 9')
      .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.5)
  }
  return { svg, container, w, h, zoom }
}

function renderGraph(graph) {
  currentGraph = graph
  const { nodes, edges } = graph
  const { svg, container, w, h } = initSVG()
  const pkgColorMap = buildPackageColorMap(nodes)

  function dragStart(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart()
    d.fx = d.x; d.fy = d.y
  }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y }
  function dragEnd(event, d) { if (!event.active) simulation.alphaTarget(0) }

  // ── Simulation ──
  const chargeStrength = nodes.length > 100 ? -350 : nodes.length > 50 ? -600 : -900

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id).distance(d => EDGE_DIST[d.type] || 160))
    .force('charge', d3.forceManyBody().strength(d => d.metrics.isHotspot ? chargeStrength * 2 : chargeStrength))
    .force('center', d3.forceCenter(w / 2, h / 2))
    .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 22))
    .force('x', d3.forceX(w / 2).strength(0.03))
    .force('y', d3.forceY(h / 2).strength(0.03))
    .alphaDecay(0.015).velocityDecay(0.4)

  if (nodes.length > 200) {
    simulation.stop()
    for (let i = 0; i < 500; i++) simulation.tick()
  }

  // ── Package hull layer (behind edges) — skip for large graphs (perf) ──
  const showHulls = nodes.length <= 150
  const hullG = container.append('g').attr('class', 'hulls')

  // ── Edges ──
  const linkG = container.append('g').attr('class', 'links')
  svgLink = linkG.selectAll('line').data(edges).join('line')
    .attr('stroke', d => EDGE_COLORS[d.type] || '#4a5568')
    .attr('stroke-width', d => EDGE_WIDTH[d.type] || 1)
    .attr('stroke-dasharray', d => EDGE_DASH[d.type] || null)
    .attr('marker-end', d => `url(#arrow-${d.type})`)
    .attr('opacity', 0.5)

  // Edge labels for meaningful relationship types (not imports — too many)
  const edgeLabelG = container.append('g').attr('class', 'edge-labels')
  const labeledEdges = edges.filter(e => e.type !== 'imports' && e.type !== 'circular')
  const edgeLabels = edgeLabelG.selectAll('text').data(labeledEdges).join('text')
    .attr('font-size', '8px')
    .attr('text-anchor', 'middle')
    .attr('fill', d => EDGE_COLORS[d.type])
    .attr('opacity', 0.8)
    .attr('pointer-events', 'none')
    .text(d => d.type)

  // ── Nodes ──
  const nodeG = container.append('g').attr('class', 'nodes')
  svgNode = nodeG.selectAll('g').data(nodes).join('g')
    .attr('class', 'node')
    .call(d3.drag().on('start', dragStart).on('drag', dragged).on('end', dragEnd))
    .on('click', (event, d) => { event.stopPropagation(); selectNode(d) })
    .on('mouseenter', (event, d) => showTooltip(event, d))
    .on('mousemove', (event) => moveTooltip(event))
    .on('mouseleave', () => hideTooltip())

  // Circle
  svgNode.append('circle')
    .attr('r', d => nodeRadius(d))
    .attr('fill', d => NODE_COLORS[d.type] || '#888')
    .attr('stroke', d => d.metrics.isCircular ? '#E24B4A' : 'rgba(255,255,255,0.18)')
    .attr('stroke-width', d => d.metrics.isCircular ? 2.5 : 1.2)

  // Hotspot ring
  svgNode.filter(d => d.metrics.isHotspot)
    .append('circle')
    .attr('r', d => nodeRadius(d) + 6)
    .attr('fill', 'none')
    .attr('stroke', '#BA7517')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '4 2')
    .attr('opacity', 0.7)

  // Primary label — class/file name
  svgNode.append('text')
    .attr('class', 'node-label')
    .text(d => d.label)
    .attr('font-size', nodes.length > 100 ? '10px' : '11px')
    .attr('font-weight', '600')
    .attr('text-anchor', 'middle')
    .attr('dy', d => nodeRadius(d) + 14)
    .attr('fill', '#cdd9e5')
    .style('display', d => {
      if (nodes.length <= 80)  return 'block'
      if (nodes.length <= 150) return d.type === 'external' ? 'none' : 'block'
      return d.metrics.isHotspot ? 'block' : 'none'
    })

  // Secondary label — file name (shown for small graphs only)
  if (nodes.length <= 60) {
    svgNode.append('text')
      .attr('class', 'node-sublabel')
      .text(d => d.filePath ? d.filePath.split('/').pop() : '')
      .attr('font-size', '9px')
      .attr('text-anchor', 'middle')
      .attr('dy', d => nodeRadius(d) + 26)
      .attr('fill', '#484f58')
      .style('display', d => (d.filePath && d.label !== d.filePath.split('/').pop()) ? 'block' : 'none')
  }

  // ── Tick ──
  function ticked() {
    svgLink
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
    svgNode.attr('transform', d => `translate(${d.x},${d.y})`)
    edgeLabels
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 4)
    if (showHulls) drawHulls(hullG, nodes, pkgColorMap)
  }

  if (nodes.length > 200) {
    ticked()
  } else {
    simulation.on('tick', ticked)
  }

  d3.select('#graph').on('click', clearSelection)
}

// ── Package hulls ─────────────────────────────────────────
function drawHulls(hullG, nodes, pkgColorMap) {
  hullG.selectAll('*').remove()
  const byPkg = new Map()
  for (const n of nodes) {
    if (!n.packageName || n.type === 'external' || n.x == null) continue
    if (!byPkg.has(n.packageName)) byPkg.set(n.packageName, [])
    byPkg.get(n.packageName).push([n.x, n.y])
  }

  for (const [pkg, pts] of byPkg) {
    if (pts.length < 3) continue
    try {
      const hull = d3.polygonHull(pts)
      if (!hull) continue
      const color = pkgColorMap.get(pkg) || 'rgba(255,255,255,0.04)'
      const padded = hull.map(([x, y]) => {
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
        const dx = x - cx, dy = y - cy
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        return [x + (dx / len) * 30, y + (dy / len) * 30]
      })
      const shortPkg = pkg.split('.').pop()
      hullG.append('path')
        .attr('d', 'M' + padded.join('L') + 'Z')
        .attr('fill', color)
        .attr('stroke', color.replace(/[\d.]+\)$/, '0.25)'))
        .attr('stroke-width', 1.5)
        .attr('stroke-linejoin', 'round')

      // Package label
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const miny = Math.min(...pts.map(p => p[1]))
      hullG.append('text')
        .attr('x', cx).attr('y', miny - 36)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', 'rgba(255,255,255,0.25)')
        .attr('pointer-events', 'none')
        .text(shortPkg)
    } catch {}
  }
}

// ── Tooltip ───────────────────────────────────────────────
function showTooltip(event, d) {
  const subtypeStr = d.subtype ? ` · ${d.subtype}` : ''
  const metricStr = `in:${d.metrics.fanIn} out:${d.metrics.fanOut}`
  const flags = [
    d.metrics.isHotspot ? '⚡ hotspot' : '',
    d.metrics.isCircular ? '🔄 circular' : '',
    d.metrics.isOrphan ? '○ orphan' : ''
  ].filter(Boolean).join(' · ')

  tooltip.innerHTML = `
    <div class="tt-name">${d.label}</div>
    <div class="tt-meta">${d.type}${subtypeStr} · ${d.language}</div>
    <div class="tt-meta">${metricStr}${flags ? ' · ' + flags : ''}</div>
    ${d.packageName ? `<div class="tt-pkg">${d.packageName}</div>` : ''}
  `
  tooltip.hidden = false
  moveTooltip(event)
}

function moveTooltip(event) {
  const x = event.clientX + 14
  const y = event.clientY - 10
  tooltip.style.left = `${x}px`
  tooltip.style.top  = `${y}px`
}

function hideTooltip() {
  tooltip.hidden = true
}

// ── Node selection ────────────────────────────────────────
function selectNode(d) {
  hideTooltip()
  const connectedIds = new Set([d.id])
  svgLink.each(e => {
    if (e.source.id === d.id) connectedIds.add(e.target.id)
    if (e.target.id === d.id) connectedIds.add(e.source.id)
  })
  svgNode.transition().duration(200)
    .attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.08)
  svgLink.transition().duration(200)
    .attr('opacity', e =>
      (e.source.id === d.id || e.target.id === d.id) ? 1 : 0.03)
  showDetailPanel(d)
}

function clearSelection() {
  if (!svgNode) return
  svgNode.transition().duration(200).attr('opacity', 1)
  svgLink.transition().duration(200).attr('opacity', 0.5)
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
    <div class="detail-row"><span class="detail-label">Fan-in</span><span class="detail-value">${d.metrics.fanIn} &nbsp;<span style="color:#484f58">Fan-out</span> ${d.metrics.fanOut}</span></div>
    ${d.metrics.isHotspot  ? '<div class="detail-row"><span style="color:#BA7517">⚡ Hotspot — high connectivity</span></div>' : ''}
    ${d.metrics.isCircular ? '<div class="detail-row"><span style="color:#E24B4A">🔄 Part of circular dependency</span></div>' : ''}
    ${d.metrics.isOrphan   ? '<div class="detail-row"><span style="color:#6e7681">○ Orphan — no connections</span></div>' : ''}
    ${methods ? `<div class="detail-row" style="flex-direction:column;gap:6px"><span class="detail-label">Methods</span><div class="methods-list">${methods}</div></div>` : ''}
  `
  detailPanel.hidden = false
}

document.getElementById('detail-close').addEventListener('click', clearSelection)

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
    .attr('opacity', d => type === 'all' || d.type === type ? 1 : 0.06)
    .style('pointer-events', d => type === 'all' || d.type === type ? 'all' : 'none')
  svgLink.transition().duration(300)
    .attr('opacity', d => {
      if (type === 'all') return 0.5
      return (d.source.type === type || d.target.type === type) ? 0.5 : 0.02
    })
}

// ── Search ────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', e => {
  const term = e.target.value.toLowerCase().trim()
  if (!svgNode) return
  svgNode.transition().duration(200)
    .attr('opacity', d => !term || d.label.toLowerCase().includes(term) ? 1 : 0.06)
})

// ── Export PNG ────────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', () => {
  const svgEl = document.getElementById('graph')
  const data = new XMLSerializer().serializeToString(svgEl)
  const canvas = document.createElement('canvas')
  canvas.width = svgEl.clientWidth; canvas.height = svgEl.clientHeight
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

// ── Legend ────────────────────────────────────────────────
function showLegend() {
  const legend = document.getElementById('legend')
  legend.hidden = false
  legend.innerHTML = Object.entries(NODE_COLORS).map(([type, color]) =>
    `<div class="legend-row">
      <span class="legend-dot" style="background:${color}"></span>
      <span>${type}</span>
    </div>`
  ).join('') + `
    <div class="legend-row" style="margin-top:6px;border-top:1px solid #30363d;padding-top:6px">
      <span class="legend-line" style="background:#7F77DD"></span><span>extends</span>
    </div>
    <div class="legend-row">
      <span class="legend-line" style="background:#1D9E75"></span><span>injects</span>
    </div>
    <div class="legend-row">
      <span class="legend-line" style="background:#E24B4A"></span><span>circular</span>
    </div>
    <div class="legend-row">
      <span class="legend-line" style="background:#4a5568"></span><span>imports</span>
    </div>
  `
}

// ── UI state ──────────────────────────────────────────────
function showIdle() {
  idlePanel.hidden = false
  graphContainer.hidden = true
  filterBar.hidden = true
  errorPanel.hidden = true
  progressEl.hidden = true
  detailPanel.hidden = true
  insightsPanel.hidden = true
  repoMetaBar.hidden = true
  folderPicker.hidden = true
  document.getElementById('legend').hidden = true
}

function showError(message) {
  idlePanel.hidden = true
  graphContainer.hidden = true
  filterBar.hidden = true
  errorPanel.hidden = false
  progressEl.hidden = true

  const labels = {
    NOT_FOUND: 'Repository Not Found', PRIVATE_REPO_NO_TOKEN: 'Private Repository',
    FORBIDDEN: 'Access Denied', RATE_LIMITED: 'Rate Limited',
    TOO_LARGE: 'Repository Too Large', EMPTY_REPO: 'No Source Files', FETCH_ERROR: 'Fetch Error'
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
  progressBar.value = current; progressBar.max = total
  progressText.textContent = `${stage === 'fetching' ? 'Fetching' : 'Parsing'} ${current} / ${total} files...`
}

// ── Parse + build pipeline ────────────────────────────────
async function parseAndShow(files, meta) {
  const parsed = []
  showProgress(0, files.length, 'parsing')

  for (let i = 0; i < files.length; i++) {
    const node = parseFile(files[i].content, files[i].path)
    if (node) parsed.push(node)
    if (i % 5 === 0 || i === files.length - 1) {
      showProgress(i + 1, files.length, 'parsing')
      await new Promise(r => setTimeout(r, 0))
    }
  }

  const graph = buildGraph(parsed, meta)
  const insights = computeInsights(graph)

  progressEl.hidden = true
  idlePanel.hidden = true
  errorPanel.hidden = true
  graphContainer.hidden = false
  filterBar.hidden = false

  repoName.textContent = `${meta.owner}/${meta.repo}`
  graphStats.textContent = `${graph.nodes.length} nodes · ${graph.edges.length} edges`

  renderGraph(graph)
  showInsightsPanel(insights)
  showLegend()
  showRepoMeta({ ...meta, totalFiles: meta.totalFiles }, meta.fromCache)
}

// ── Repo meta bar ─────────────────────────────────────────
function showRepoMeta(meta, fromCache = false) {
  repoMetaBar.hidden = false
  if (meta.language) {
    metaLanguage.textContent = meta.language
    metaLanguage.hidden = false
  }
  if (meta.stars != null) {
    metaStars.textContent = `★ ${meta.stars >= 1000 ? (meta.stars / 1000).toFixed(1) + 'k' : meta.stars}`
    metaStars.hidden = false
  }
  if (meta.totalFiles) {
    metaFiles.textContent = `${meta.totalFiles} files`
    metaFiles.hidden = false
  }
  metaCache.hidden = !fromCache
}

// ── Folder picker (large repos) ───────────────────────────
function showFolderPicker(message) {
  idlePanel.hidden = true
  progressEl.hidden = true
  errorPanel.hidden = true
  graphContainer.hidden = true
  filterBar.hidden = true
  folderPicker.hidden = false

  folderFileCount.textContent = message.fileCount

  folderList.innerHTML = ''

  // "Analyze all" option
  const allBtn = document.createElement('button')
  allBtn.className = 'folder-btn folder-btn-all'
  allBtn.textContent = `Analyze all ${message.fileCount} files (slow)`
  allBtn.addEventListener('click', () => {
    folderPicker.hidden = true
    chrome.runtime.sendMessage({
      type: 'ANALYZE_REPO_FOLDER',
      owner: message.owner,
      repo: message.repo,
      folder: null
    })
  })
  folderList.appendChild(allBtn)

  for (const folder of message.folders) {
    const btn = document.createElement('button')
    btn.className = 'folder-btn'
    btn.textContent = `📁 ${folder}/`
    btn.addEventListener('click', () => {
      folderPicker.hidden = true
      chrome.runtime.sendMessage({
        type: 'ANALYZE_REPO_FOLDER',
        owner: message.owner,
        repo: message.repo,
        folder
      })
    })
    folderList.appendChild(btn)
  }
}

// ── Re-analyze (clears cache) ─────────────────────────────
document.getElementById('reanalyze-btn').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' })
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_REPO_INFO' }).catch(() => {})
  showIdle()
})

// ── Message listener ──────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS')    showProgress(message.current, message.total, message.stage)
  if (message.type === 'REPO_META')   showRepoMeta(message)
  if (message.type === 'FILES_READY') parseAndShow(message.files, message.meta)
  if (message.type === 'CACHE_HIT')   parseAndShow(message.files, { ...message.meta, fromCache: true })
  if (message.type === 'TOO_MANY_FILES') showFolderPicker(message)
  if (message.type === 'ERROR') {
    showError(message)
    console.warn('[sidepanel] ERROR', message.code, message.message)
  }
})

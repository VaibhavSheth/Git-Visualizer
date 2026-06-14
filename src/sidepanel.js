import { parseFile } from './parser/index.js'
import { buildGraph } from './graph/builder.js'
import { computeInsights } from './graph/insights.js'

const progressEl = document.getElementById('progress')
const progressBar = document.getElementById('progress-bar')
const progressText = document.getElementById('progress-text')
const errorPanel = document.getElementById('error-panel')
const errorTitle = document.getElementById('error-title')
const errorMessage = document.getElementById('error-message')
const errorHint = document.getElementById('error-hint')
const idlePanel = document.getElementById('idle-panel')
const filesReadyPanel = document.getElementById('files-ready-panel')
const filesSummary = document.getElementById('files-summary')
const filesList = document.getElementById('files-list')
const repoName = document.getElementById('repo-name')

function showIdle() {
  idlePanel.hidden = false
  filesReadyPanel.hidden = true
  errorPanel.hidden = true
  progressEl.hidden = true
}

function showError(message) {
  errorPanel.hidden = false
  idlePanel.hidden = true
  filesReadyPanel.hidden = true
  progressEl.hidden = true

  const codeLabels = {
    NOT_FOUND: 'Repository Not Found',
    PRIVATE_REPO_NO_TOKEN: 'Private Repository',
    FORBIDDEN: 'Access Denied',
    RATE_LIMITED: 'Rate Limited',
    TOO_LARGE: 'Repository Too Large',
    EMPTY_REPO: 'No Source Files',
    FETCH_ERROR: 'Fetch Error'
  }

  errorTitle.textContent = codeLabels[message.code] || 'Error'
  errorMessage.textContent = message.message || 'An unexpected error occurred.'

  if (message.code === 'PRIVATE_REPO_NO_TOKEN') {
    errorHint.hidden = false
    errorHint.innerHTML = 'Add a GitHub token in the <a href="#" id="open-popup-link">extension popup</a> to access private repos.'
    document.getElementById('open-popup-link')?.addEventListener('click', (e) => {
      e.preventDefault()
      chrome.runtime.openOptionsPage?.()
    })
  } else if (message.code === 'RATE_LIMITED') {
    const resetTime = message.resetAt ? new Date(message.resetAt).toLocaleTimeString() : 'soon'
    errorHint.hidden = false
    errorHint.textContent = `Rate limit resets at ${resetTime}. Retrying automatically...`
  } else {
    errorHint.hidden = true
  }
}

function showProgress(current, total, stage) {
  progressEl.hidden = false
  idlePanel.hidden = true
  errorPanel.hidden = true
  filesReadyPanel.hidden = true

  progressBar.value = current
  progressBar.max = total
  const label = stage === 'fetching' ? 'Fetching' : 'Parsing'
  progressText.textContent = `${label} ${current} / ${total} files...`
}

function showGraphReady(graph, insights, meta) {
  progressEl.hidden = true
  idlePanel.hidden = true
  errorPanel.hidden = true
  filesReadyPanel.hidden = false

  repoName.textContent = `${meta.owner}/${meta.repo}`

  const lang = insights.languageBreakdown
  const langParts = Object.entries(lang).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`)

  filesSummary.innerHTML = `
    <strong>${graph.nodes.length}</strong> nodes &nbsp;·&nbsp;
    <strong>${graph.edges.length}</strong> edges &nbsp;·&nbsp;
    ${langParts.join(', ')}
    ${insights.hotspots.length ? `&nbsp;·&nbsp; <span style="color:#BA7517">⚡ ${insights.hotspots.length} hotspots</span>` : ''}
    ${insights.circularChains.length ? `&nbsp;·&nbsp; <span style="color:#E24B4A">🔄 ${insights.circularChains.length} circular</span>` : ''}
    ${insights.orphans.length ? `&nbsp;·&nbsp; ${insights.orphans.length} orphans` : ''}
  `

  filesList.innerHTML = ''

  // Hotspots section
  if (insights.hotspots.length) {
    const header = document.createElement('li')
    header.style.cssText = 'color:#BA7517;font-weight:600;list-style:none;margin-top:8px'
    header.textContent = '⚡ Hotspots (high fan-in + fan-out)'
    filesList.appendChild(header)
    for (const n of insights.hotspots.slice(0, 10)) {
      const li = document.createElement('li')
      li.textContent = `${n.label}  (in:${n.metrics.fanIn} out:${n.metrics.fanOut})`
      li.title = n.filePath || n.id
      filesList.appendChild(li)
    }
  }

  // Circular deps
  if (insights.circularChains.length) {
    const header = document.createElement('li')
    header.style.cssText = 'color:#E24B4A;font-weight:600;list-style:none;margin-top:8px'
    header.textContent = '🔄 Circular dependencies'
    filesList.appendChild(header)
    for (const chain of insights.circularChains.slice(0, 5)) {
      const li = document.createElement('li')
      li.textContent = chain.map(id => id.split('.').pop()).join(' → ')
      li.style.color = '#E24B4A'
      filesList.appendChild(li)
    }
  }

  // All nodes
  const allHeader = document.createElement('li')
  allHeader.style.cssText = 'color:#8b949e;font-weight:600;list-style:none;margin-top:8px'
  allHeader.textContent = 'All nodes'
  filesList.appendChild(allHeader)

  for (const n of graph.nodes) {
    if (n.type === 'external') continue
    const li = document.createElement('li')
    const flag = n.metrics.isHotspot ? ' ⚡' : n.metrics.isCircular ? ' 🔄' : n.metrics.isOrphan ? ' ○' : ''
    li.textContent = `${n.label}${flag}`
    li.title = `${n.filePath || n.id} · in:${n.metrics.fanIn} out:${n.metrics.fanOut}`
    filesList.appendChild(li)
  }
}

async function parseAndShow(files, meta) {
  const parsed = []
  const total = files.length

  showProgress(0, total, 'parsing')

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const node = parseFile(f.content, f.path)
    if (node) parsed.push(node)

    if (i % 5 === 0 || i === files.length - 1) {
      showProgress(i + 1, total, 'parsing')
      // yield to keep UI responsive
      await new Promise(r => setTimeout(r, 0))
    }
  }

  console.log('[sidepanel] parsed', parsed.length, 'nodes')

  const graph = buildGraph(parsed, meta)
  const insights = computeInsights(graph)

  console.log('[sidepanel] graph', graph.nodes.length, 'nodes', graph.edges.length, 'edges')
  console.log('[sidepanel] insights', insights)

  showGraphReady(graph, insights, meta)
  // Phase 5 will render D3 graph here
}

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

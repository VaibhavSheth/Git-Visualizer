import { parseFile } from './parser/index.js'

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

function showFilesReady(nodes, meta) {
  progressEl.hidden = true
  idlePanel.hidden = true
  errorPanel.hidden = true
  filesReadyPanel.hidden = false

  repoName.textContent = `${meta.owner}/${meta.repo}`

  const byLang = nodes.reduce((acc, n) => {
    acc[n.language] = (acc[n.language] || 0) + 1
    return acc
  }, {})

  const langSummary = Object.entries(byLang)
    .map(([lang, count]) => `${count} ${lang}`)
    .join(', ')

  const withErrors = nodes.filter(n => n.parseError).length

  filesSummary.textContent =
    `${nodes.length} files parsed (${langSummary})` +
    (withErrors ? ` · ${withErrors} parse errors` : '') +
    ` · branch: ${meta.branch}`

  filesList.innerHTML = ''
  for (const n of nodes) {
    const li = document.createElement('li')
    const label = n.className ? `${n.className} (${n.language})` : n.path
    li.textContent = label + (n.parseError ? ' ⚠' : '')
    li.title = n.path
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
  showFilesReady(parsed, meta)
  // Phase 4+ will pass parsed nodes to graph/builder.js here
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

const SOURCE_EXTENSIONS = ['.java', '.js', '.ts', '.jsx', '.tsx', '.py']
const MAX_FILE_SIZE = 100 * 1024
const SKIP_PATHS = ['node_modules', 'vendor/', 'dist/', 'build/', '.min.', '__pycache__']
const BATCH_SIZE = 5
const MAX_FILES_WARNING = 500

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getLanguage(path) {
  if (path.endsWith('.java')) return 'java'
  if (path.endsWith('.py')) return 'python'
  if (path.match(/\.(jsx?|tsx?)$/)) return 'javascript'
  return 'unknown'
}

async function getAuthHeaders() {
  const { githubToken } = await chrome.storage.local.get('githubToken')
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`
  return headers
}

function sendToSidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {})
}

async function fetchWithRateLimit(url, headers) {
  const response = await fetch(url, { headers })
  const remaining = parseInt(response.headers.get('X-RateLimit-Remaining') ?? '999')
  const resetAt = parseInt(response.headers.get('X-RateLimit-Reset') ?? '0') * 1000

  if (response.status === 429 || remaining === 0) {
    const waitMs = Math.max(resetAt - Date.now() + 1000, 60000)
    sendToSidePanel({ type: 'ERROR', code: 'RATE_LIMITED', resetAt, waitMs })
    await sleep(waitMs)
    return fetchWithRateLimit(url, headers)
  }
  if (remaining < 10) await sleep(2000)
  return response
}

async function fetchFileContent(item, owner, repo, branch, headers) {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${item.path}?ref=${branch}`
    const response = await fetchWithRateLimit(url, headers)
    if (!response.ok) return null
    const data = await response.json()
    if (!data.content || data.encoding !== 'base64') return null
    const raw = atob(data.content.replace(/\n/g, ''))
    return { path: item.path, content: raw, language: getLanguage(item.path), size: item.size }
  } catch {
    return null
  }
}

async function analyzeRepo({ owner, repo, folderFilter = null }) {
  const headers = await getAuthHeaders()
  const cacheKey = `graph:${owner}/${repo}`

  // Check session cache first
  const cached = await chrome.storage.session.get(cacheKey)
  if (cached[cacheKey]) {
    sendToSidePanel({ type: 'CACHE_HIT', ...cached[cacheKey] })
    return
  }

  // Step 1: repo metadata
  const metaRes = await fetchWithRateLimit(
    `https://api.github.com/repos/${owner}/${repo}`, headers
  )

  if (metaRes.status === 404) {
    const { githubToken } = await chrome.storage.local.get('githubToken')
    sendToSidePanel({
      type: 'ERROR',
      code: githubToken ? 'NOT_FOUND' : 'PRIVATE_REPO_NO_TOKEN',
      message: githubToken
        ? `Repository "${owner}/${repo}" not found.`
        : `"${owner}/${repo}" may be private. Add a GitHub token in the extension popup.`
    })
    return
  }
  if (metaRes.status === 403) {
    sendToSidePanel({ type: 'ERROR', code: 'FORBIDDEN',
      message: `No access to "${owner}/${repo}". Your token may not have "repo" scope.` })
    return
  }
  if (!metaRes.ok) {
    sendToSidePanel({ type: 'ERROR', code: 'FETCH_ERROR',
      message: `GitHub API error ${metaRes.status}.` })
    return
  }

  const repoMeta = await metaRes.json()
  const branch = repoMeta.default_branch

  // Send repo metadata to side panel for toolbar display
  sendToSidePanel({
    type: 'REPO_META',
    owner, repo, branch,
    stars: repoMeta.stargazers_count,
    language: repoMeta.language,
    description: repoMeta.description,
    isPrivate: repoMeta.private
  })

  // Step 2: file tree
  const treeRes = await fetchWithRateLimit(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, headers
  )

  if (treeRes.status === 409) {
    sendToSidePanel({ type: 'ERROR', code: 'EMPTY_REPO',
      message: `"${owner}/${repo}" appears to be empty.` })
    return
  }
  if (!treeRes.ok) {
    sendToSidePanel({ type: 'ERROR', code: 'FETCH_ERROR',
      message: `Could not fetch file tree (${treeRes.status}).` })
    return
  }

  const treeData = await treeRes.json()
  const commitSha = treeData.sha

  let allFiles = treeData.tree.filter(item =>
    item.type === 'blob' &&
    SOURCE_EXTENSIONS.some(ext => item.path.endsWith(ext)) &&
    item.size < MAX_FILE_SIZE &&
    !SKIP_PATHS.some(skip => item.path.includes(skip))
  )

  // Apply folder filter if user selected one
  if (folderFilter) {
    allFiles = allFiles.filter(f => f.path.startsWith(folderFilter))
  }

  if (allFiles.length === 0) {
    sendToSidePanel({ type: 'ERROR', code: 'EMPTY_REPO',
      message: `No supported source files found in "${owner}/${repo}".` })
    return
  }

  // Warn if too large — send folder list and let user pick
  if (allFiles.length > MAX_FILES_WARNING && !folderFilter) {
    const folders = [...new Set(allFiles.map(f => f.path.split('/')[0]))]
    sendToSidePanel({
      type: 'TOO_MANY_FILES',
      fileCount: allFiles.length,
      folders,
      owner, repo
    })
    return
  }

  const skippedCount = treeData.tree.filter(i => i.type === 'blob').length - allFiles.length

  // Step 3: fetch contents in batches
  const fetchedFiles = []
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(item => fetchFileContent(item, owner, repo, branch, headers))
    )
    for (const r of results) { if (r) fetchedFiles.push(r) }

    sendToSidePanel({
      type: 'PROGRESS', stage: 'fetching',
      current: Math.min(i + BATCH_SIZE, allFiles.length),
      total: allFiles.length
    })

    if (i + BATCH_SIZE < allFiles.length) await sleep(200)

    if (i % 10 === 0) {
      await chrome.storage.session.set({
        fetchProgress: { completed: i, total: allFiles.length }
      })
    }
  }

  const payload = {
    files: fetchedFiles,
    meta: { owner, repo, branch, commitSha, totalFiles: allFiles.length, skippedFiles: skippedCount,
      stars: repoMeta.stargazers_count, language: repoMeta.language }
  }

  // Cache in session storage (cleared when browser closes)
  await chrome.storage.session.set({ [cacheKey]: payload })

  sendToSidePanel({ type: 'FILES_READY', ...payload })
}

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id })
  await sleep(300)
  chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_REPO_INFO' }).catch(() => {})
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_REPO') analyzeRepo(message)
  if (message.type === 'ANALYZE_REPO_FOLDER') analyzeRepo({ ...message, folderFilter: message.folder })
  if (message.type === 'CLEAR_CACHE') {
    chrome.storage.session.clear()
  }
  return true
})

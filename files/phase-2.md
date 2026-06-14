# Phase 2 — GitHub API Fetcher

**Outcome:** Given a GitHub repo URL, the extension fetches the full file tree and raw content of all source files and sends them to the side panel.

**Reference docs:** `API-REFERENCE.md`, `ARCHITECTURE.md`

---

## Files to Modify

- `src/content.js` — URL extraction + trigger message
- `src/background.js` — full GitHub API fetcher
- `src/sidepanel.html` + `src/sidepanel.js` — show progress bar

---

## content.js — implementation

```js
// Runs on every github.com/{owner}/{repo} page
// Extract owner and repo from URL
// Send ANALYZE_REPO message to background

function extractRepoInfo() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return {
    owner: parts[0],
    repo: parts[1]
  }
}

// Trigger analysis when extension icon is clicked
// (background.js will open the side panel and start fetching)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'REQUEST_REPO_INFO') {
    const info = extractRepoInfo()
    if (info) {
      chrome.runtime.sendMessage({ type: 'ANALYZE_REPO', ...info })
    }
  }
})
```

---

## background.js — full implementation

### Step 1: On icon click → get repo info from active tab
```js
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id })
  // Ask content script for repo info
  chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_REPO_INFO' })
})
```

### Step 2: On ANALYZE_REPO message → run pipeline
```js
async function analyzeRepo({ owner, repo }) {
  const headers = await getAuthHeaders()

  // 1. Get repo metadata (default branch, size, language)
  // 2. Get file tree (recursive)
  // 3. Filter to source files
  // 4. Fetch file contents in batches of 5
  // 5. Send FILES_READY to side panel
}
```

### Step 3: File filtering rules
Skip any file that:
- Is not `.java`, `.js`, `.ts`, `.jsx`, `.tsx`, `.py`
- Is larger than 100KB (`item.size > 102400`)
- Path contains: `node_modules`, `vendor/`, `dist/`, `build/`, `.min.`, `__pycache__`

### Step 4: Progress updates
Send after every batch:
```js
{ type: 'PROGRESS', stage: 'fetching', current: N, total: M }
```

### Step 5: Final message
```js
{
  type: 'FILES_READY',
  files: [{ path, content, language, size }],
  meta: { owner, repo, branch, commitSha, totalFiles, skippedFiles }
}
```

---

## Error messages to send to side panel

```js
{ type: 'ERROR', code: 'NOT_FOUND', message: '...' }
{ type: 'ERROR', code: 'PRIVATE_REPO_NO_TOKEN', message: '...' }
{ type: 'ERROR', code: 'RATE_LIMITED', resetAt: timestamp }
{ type: 'ERROR', code: 'TOO_LARGE', fileCount: N }
{ type: 'ERROR', code: 'EMPTY_REPO', message: '...' }
```

---

## sidepanel.js — progress display

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS') {
    document.getElementById('progress').hidden = false
    document.getElementById('progress-bar').value = message.current
    document.getElementById('progress-bar').max = message.total
    document.getElementById('progress-text').textContent =
      `${message.stage === 'fetching' ? 'Fetching' : 'Parsing'} ${message.current} / ${message.total} files...`
  }
  if (message.type === 'FILES_READY') {
    document.getElementById('progress').hidden = true
    console.log('Files ready:', message.files.length)
    // Phase 3 will handle parsing
  }
  if (message.type === 'ERROR') {
    showError(message)
  }
})
```

---

## Done When

- [ ] Opening any public GitHub repo and clicking the extension fetches the file tree
- [ ] Progress updates appear in the side panel during fetch
- [ ] `FILES_READY` message arrives with correct file count
- [ ] File contents are correctly base64 decoded (raw source is readable)
- [ ] Binary files, large files, and `node_modules` are skipped
- [ ] Rate limit headers are checked — slows down if < 10 remaining
- [ ] 404 on private repo (no token) shows a helpful "add token" message
- [ ] Tested on: `spring-projects/spring-petclinic` (Java) and a small JS repo

# GitHub API Reference

All calls go to `https://api.github.com`. Always include headers:

```js
const headers = {
  'Accept': 'application/vnd.github.v3+json',
  'Authorization': token ? `Bearer ${token}` : undefined,
  'X-GitHub-Api-Version': '2022-11-28'
}
```

---

## Endpoints Used

### 1. Get repository metadata
```
GET /repos/{owner}/{repo}
```

Response fields we use:
```js
{
  default_branch: "main",       // use this as branch if none specified
  language: "Java",             // dominant language
  size: 4096,                   // KB — skip if > 51200 (50MB)
  private: false,
  description: "...",
  stargazers_count: 1200
}
```

Use this first to:
- Get the default branch name
- Check repo size before proceeding
- Detect dominant language

---

### 2. Get full file tree (recursive)
```
GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
```

Response:
```js
{
  sha: "abc123",    // commit SHA — use as cache key
  truncated: false, // if true, repo is too large for recursive tree
  tree: [
    {
      path: "src/main/java/com/example/UserService.java",
      type: "blob",   // "blob" = file, "tree" = directory
      sha: "def456",
      size: 3240      // file size in bytes — skip if > 102400 (100KB)
    },
    ...
  ]
}
```

**Filtering the tree before fetching content:**
```js
const SOURCE_EXTENSIONS = ['.java', '.js', '.ts', '.jsx', '.tsx', '.py']
const MAX_FILE_SIZE = 100 * 1024  // 100KB

const filesToFetch = tree.filter(item =>
  item.type === 'blob' &&
  SOURCE_EXTENSIONS.some(ext => item.path.endsWith(ext)) &&
  item.size < MAX_FILE_SIZE &&
  !item.path.includes('node_modules') &&
  !item.path.includes('.min.') &&
  !item.path.includes('vendor/') &&
  !item.path.includes('dist/') &&
  !item.path.includes('build/')
)
```

---

### 3. Get file content
```
GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
```

Response:
```js
{
  content: "cGFja2FnZSBjb20uZXhhbXBsZTs...",  // base64 encoded
  encoding: "base64",
  size: 3240,
  sha: "def456"
}
```

Decode content:
```js
const raw = atob(response.content.replace(/\n/g, ''))
// atob decodes base64 → raw source string
```

**Important:** This endpoint is for individual files. Do NOT call it for directories.

---

### 4. Validate token (called from popup.js)
```
GET /user
```

Response (200 if valid):
```js
{
  login: "vaibhav",
  name: "Vaibhav",
  public_repos: 12
}
```

Response (401 if invalid):
```js
{ message: "Bad credentials" }
```

---

## Rate Limit Handling

### Check rate limit status
```
GET /rate_limit
```

Response:
```js
{
  resources: {
    core: {
      limit: 5000,       // 60 if unauthenticated
      remaining: 4823,
      reset: 1717000000  // unix timestamp when limit resets
    }
  }
}
```

### Reading rate limit from response headers (preferred)
Every API response includes:
```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4823
X-RateLimit-Reset: 1717000000
```

### Handling rate limits in background.js
```js
async function fetchWithRateLimit(url, headers) {
  const response = await fetch(url, { headers })

  const remaining = parseInt(response.headers.get('X-RateLimit-Remaining'))
  const resetAt = parseInt(response.headers.get('X-RateLimit-Reset')) * 1000

  if (response.status === 429 || remaining === 0) {
    const waitMs = resetAt - Date.now() + 1000  // +1s buffer
    sendProgress({ type: 'RATE_LIMITED', resetAt, waitMs })
    await sleep(waitMs)
    return fetchWithRateLimit(url, headers)  // retry
  }

  if (remaining < 10) {
    // Slow down — add delay between requests
    await sleep(2000)
  }

  return response
}
```

---

## Batched File Fetching

Never fetch all files at once. Always batch:

```js
async function fetchFilesInBatches(files, repoMeta, headers) {
  const BATCH_SIZE = 5
  const results = []

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)

    const batchResults = await Promise.all(
      batch.map(file => fetchFileContent(file, repoMeta, headers))
    )

    results.push(...batchResults.filter(Boolean))

    // Send progress update
    sendToSidePanel({
      type: 'PROGRESS',
      stage: 'fetching',
      current: Math.min(i + BATCH_SIZE, files.length),
      total: files.length
    })

    // Small delay between batches to be a good API citizen
    if (i + BATCH_SIZE < files.length) {
      await sleep(200)
    }
  }

  return results
}
```

---

## GitHub OAuth (for private repos)

The extension uses a **Personal Access Token (PAT)** approach, not full OAuth, because:
- OAuth requires a backend callback server
- PAT is simpler, user has control, works immediately

### Token scopes needed
- `repo` — for private repos
- `public_repo` — sufficient for public repos only

### Token storage
```js
// Save
chrome.storage.local.set({ githubToken: token })

// Read
const { githubToken } = await chrome.storage.local.get('githubToken')
```

### Token in requests
```js
headers['Authorization'] = `Bearer ${githubToken}`
```

---

## API Error Reference

| Status | Meaning | Action |
|---|---|---|
| 200 | OK | Use response |
| 403 | Forbidden (private repo, no token) | Prompt user to add token |
| 404 | Repo/file not found | Show "not found" message |
| 409 | Repo is empty | Show "empty repo" message |
| 422 | Too large (recursive tree truncated) | Use non-recursive tree + manual traversal |
| 429 | Rate limited | Wait for X-RateLimit-Reset and retry |
| 500 | GitHub server error | Retry after 5 seconds, max 2 retries |

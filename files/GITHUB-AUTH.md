# GitHub Authentication Guide

---

## Auth Strategy

This extension uses **Personal Access Token (PAT)** — not full OAuth.

| Approach | Pros | Cons |
|---|---|---|
| No token | Zero setup | 60 req/hr rate limit, no private repos |
| PAT (this project) | 5000 req/hr, private repos, simple | User must create token |
| GitHub OAuth App | Best UX, no token copy-paste | Requires backend callback server |

PAT is the right choice for a Chrome extension because there's no way to safely store an OAuth client secret inside an extension.

---

## Rate Limits

| Auth level | Rate limit | Notes |
|---|---|---|
| Unauthenticated | 60 req/hr per IP | Enough for tiny repos only |
| PAT authenticated | 5000 req/hr | Sufficient for most repos |
| GitHub App | 15000 req/hr | Optional backend proxy |

A medium Spring Boot repo (100 files) needs roughly 102 API calls:
- 1 for repo metadata
- 1 for file tree
- 100 for file contents

At 60 req/hr unauthenticated, that barely fits. Always encourage users to add a token.

---

## Token Creation Flow (shown in popup.html)

Exact steps to show the user:
1. Go to github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Set expiration (90 days recommended)
4. Select scopes:
   - `public_repo` — for public repos only
   - `repo` — for private repos too
5. Click "Generate token"
6. Copy the token (shown only once)
7. Paste it in the extension popup

Show a direct link: `https://github.com/settings/tokens/new?scopes=repo&description=GitHub+Code+Visualizer`

---

## Token Storage

```js
// popup.js — save token
async function saveToken(token) {
  // Validate first
  const valid = await validateToken(token)
  if (!valid) {
    showError('Invalid token — please check and try again')
    return
  }
  await chrome.storage.local.set({
    githubToken: token,
    tokenValidated: true,
    tokenSavedAt: Date.now()
  })
  showSuccess('Token saved!')
}

// popup.js — validate token
async function validateToken(token) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    })
    return response.status === 200
  } catch {
    return false
  }
}

// background.js — read token for API calls
async function getAuthHeaders() {
  const { githubToken } = await chrome.storage.local.get('githubToken')
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (githubToken) {
    headers['Authorization'] = `Bearer ${githubToken}`
  }
  return headers
}
```

---

## Private Repo Detection

```js
// When we get a 404 or 403, check if it's a private repo access issue
async function handleFetchError(status, owner, repo) {
  if (status === 404) {
    const { githubToken } = await chrome.storage.local.get('githubToken')
    if (!githubToken) {
      return {
        type: 'ERROR',
        code: 'PRIVATE_REPO_NO_TOKEN',
        message: `"${owner}/${repo}" may be private. Add a GitHub token to access it.`
      }
    } else {
      return {
        type: 'ERROR',
        code: 'NOT_FOUND',
        message: `Repository "${owner}/${repo}" not found.`
      }
    }
  }
  if (status === 403) {
    return {
      type: 'ERROR',
      code: 'FORBIDDEN',
      message: `No access to "${owner}/${repo}". Your token may not have "repo" scope.`
    }
  }
}
```

---

## Security Notes

- **Never log the token** to console
- **Never send the token to any server** — all API calls go directly to `api.github.com`
- Token is stored in `chrome.storage.local` — only accessible by this extension
- Inform users in the privacy policy that their token is stored locally and never transmitted anywhere except GitHub's API
- Consider adding a "Clear token" button in popup so users can revoke easily

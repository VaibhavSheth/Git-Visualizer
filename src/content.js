function extractRepoInfo() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return {
    owner: parts[0],
    repo: parts[1]
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'REQUEST_REPO_INFO') {
    const info = extractRepoInfo()
    if (info) {
      chrome.runtime.sendMessage({ type: 'ANALYZE_REPO', ...info })
    }
  }
})

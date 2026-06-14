const tokenInput = document.getElementById('token-input')
const saveBtn = document.getElementById('save-btn')
const clearBtn = document.getElementById('clear-btn')
const statusBar = document.getElementById('status-bar')
const statusText = document.getElementById('status-text')
const validationMsg = document.getElementById('validation-msg')

function setStatus(state, text) {
  statusBar.className = 'status-bar'
  if (state === 'ok') {
    statusBar.classList.add('status-ok')
  } else if (state === 'error') {
    statusBar.classList.add('status-error')
  } else {
    statusBar.classList.add('status-none')
  }
  statusText.textContent = text
}

function showValidation(type, text) {
  validationMsg.className = `validation-msg ${type}`
  validationMsg.textContent = text
  validationMsg.hidden = false
}

function hideValidation() {
  validationMsg.hidden = true
}

async function validateToken(token) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    })
    if (response.status === 200) {
      const user = await response.json()
      return { valid: true, login: user.login }
    }
    return { valid: false }
  } catch {
    return { valid: false }
  }
}

async function loadStoredToken() {
  const result = await chrome.storage.local.get(['githubToken', 'tokenLogin'])
  if (result.githubToken) {
    tokenInput.value = result.githubToken
    const login = result.tokenLogin || 'authenticated'
    setStatus('ok', `Token validated ✓  (${login})`)
  } else {
    setStatus('none', 'No token — rate limited to 60 req/hr')
  }
}

saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim()
  if (!token) {
    showValidation('error', 'Enter a token first.')
    return
  }

  saveBtn.disabled = true
  showValidation('loading', 'Validating token…')

  const result = await validateToken(token)

  if (result.valid) {
    await chrome.storage.local.set({
      githubToken: token,
      tokenLogin: result.login,
      tokenSavedAt: Date.now()
    })
    setStatus('ok', `Token validated ✓  (${result.login})`)
    showValidation('success', `Token saved! Signed in as ${result.login}.`)
  } else {
    showValidation('error', 'Invalid token — check scopes and try again.')
    setStatus('error', 'Token invalid')
  }

  saveBtn.disabled = false
})

clearBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['githubToken', 'tokenLogin', 'tokenSavedAt'])
  tokenInput.value = ''
  setStatus('none', 'No token — rate limited to 60 req/hr')
  hideValidation()
})

document.getElementById('analyze-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab) return

  if (!tab.url || !tab.url.startsWith('https://github.com/')) {
    showValidation('error', 'Navigate to a GitHub repository first.')
    return
  }

  await chrome.sidePanel.open({ tabId: tab.id })
  chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_REPO_INFO' }).catch(() => {})
  window.close()
})

loadStoredToken()

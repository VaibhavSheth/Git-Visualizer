# Chrome Extension MV3 — Patterns & Gotchas

Essential reference for building with Manifest V3. Read before writing any extension code.

---

## MV3 Key Differences from MV2

| Feature | MV2 | MV3 (this project) |
|---|---|---|
| Background | Persistent background page | Service worker (ephemeral) |
| `fetch()` from background | Yes | Yes |
| `eval()` | Allowed | BLOCKED by CSP |
| Inline script in HTML | Allowed | BLOCKED by CSP |
| `chrome.browserAction` | Yes | Replaced by `chrome.action` |
| Remote code execution | Allowed | BLOCKED |

---

## Service Worker Gotchas

The background script (`background.js`) is a service worker — it can be killed by Chrome at any time when idle, and restarted on the next event.

### DO NOT store state in global variables
```js
// WRONG — lost when service worker is killed
let currentGraph = null

// RIGHT — use chrome.storage.session
await chrome.storage.session.set({ currentGraph })
```

### DO keep service workers alive during long operations
Long fetch operations (parsing a large repo) can get killed mid-way.
Use `chrome.storage` to checkpoint progress:
```js
// Checkpoint every 10 files
if (i % 10 === 0) {
  await chrome.storage.session.set({
    fetchProgress: { completed: i, total: files.length, partialFiles: results }
  })
}
```

### DO use `chrome.alarms` for periodic work
If you need to poll or retry, use `chrome.alarms` — not `setInterval` (killed with the worker).

---

## Message Passing Patterns

### content.js → background.js (one-time message)
```js
// content.js
chrome.runtime.sendMessage({ type: 'ANALYZE_REPO', owner, repo, branch })

// background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_REPO') {
    analyzeRepo(message).then(result => sendResponse(result))
    return true  // IMPORTANT: return true to keep channel open for async response
  }
})
```

### background.js → side panel (streaming progress)
```js
// background.js — send progress updates
function sendToSidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel might not be open yet — ignore error
  })
}

// sidepanel.js — receive messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS') updateProgressBar(message)
  if (message.type === 'GRAPH_READY') renderGraph(message)
})
```

---

## Side Panel API

```js
// manifest.json — required
{
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "permissions": ["sidePanel"]
}

// Open side panel on extension icon click (background.js)
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id })
})

// Or open programmatically
chrome.sidePanel.open({ windowId: tab.windowId })
```

---

## Storage

```js
// chrome.storage.local — persists across browser restarts
// Use for: GitHub token, user settings
await chrome.storage.local.set({ key: value })
const result = await chrome.storage.local.get('key')
const value = result.key

// chrome.storage.session — cleared when browser closes
// Use for: cached graphs, in-progress fetch state
await chrome.storage.session.set({ key: value })
const result = await chrome.storage.session.get('key')

// NEVER use localStorage — not available in service workers
// NEVER use sessionStorage — not shared across extension contexts
```

---

## CSP Rules in MV3

### BLOCKED — will cause errors
```html
<!-- BLOCKED: inline scripts -->
<script>alert('hello')</script>
<button onclick="doThing()">Click</button>

<!-- BLOCKED: eval -->
eval("code")
new Function("code")()
```

### Correct patterns
```html
<!-- RIGHT: external script file -->
<script src="sidepanel.js"></script>

<!-- RIGHT: event listeners in JS file -->
document.getElementById('btn').addEventListener('click', doThing)
```

### Loading D3 in side panel
D3 must be bundled locally — cannot load from CDN in MV3:
```bash
npm install d3
# Copy d3.min.js to src/lib/d3.min.js
```
```html
<script src="lib/d3.min.js"></script>
<script src="sidepanel.js"></script>
```

---

## Permissions — Minimal Required Set

```json
{
  "permissions": [
    "storage",      // chrome.storage.local and .session
    "sidePanel",    // chrome.sidePanel API
    "tabs",         // read active tab URL
    "scripting"     // inject content scripts programmatically (if needed)
  ],
  "host_permissions": [
    "https://github.com/*",       // run content script on GitHub
    "https://api.github.com/*"    // fetch from GitHub API (from background)
  ]
}
```

Only request what you need — Chrome Web Store reviewers check this.

---

## Debugging Tips

### Service worker logs
1. Go to `chrome://extensions`
2. Find your extension → click "Service Worker" link
3. DevTools opens for the service worker

### Content script logs
Open DevTools on the GitHub tab → Console (select your extension from the context dropdown)

### Side panel logs
Right-click inside the side panel → Inspect

### Common errors and fixes
| Error | Cause | Fix |
|---|---|---|
| `Cannot read properties of undefined (reading 'sendMessage')` | Content script running before extension registered | Add `try/catch` around sendMessage |
| `Extension context invalidated` | Extension reloaded while tab open | Reload the GitHub tab |
| `net::ERR_BLOCKED_BY_CLIENT` | AdBlocker blocking API call | Test in Incognito with extensions disabled |
| `Refused to execute inline script` | Inline JS in HTML | Move to external .js file |
| `Could not establish connection` | Side panel not open | Open side panel before sending message |

---

## Packaging for Chrome Web Store

```bash
# From project root
cd src
zip -r ../github-visualizer.zip . \
  --exclude "*.DS_Store" \
  --exclude "*/.git/*" \
  --exclude "*/node_modules/*"
```

Required for submission:
- At least one icon (128px recommended for Web Store listing)
- Privacy policy URL (even if just a GitHub README section)
- At least 2 screenshots of the extension in action

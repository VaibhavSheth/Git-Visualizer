# Phase 1 — Extension Shell + Token Setup

**Outcome:** A working Chrome extension that loads, has an icon in the toolbar, opens a popup, and saves a GitHub token to storage.

**Reference docs:** `docs/CHROME-EXTENSION.md`, `API-REFERENCE.md`

---

## Files to Create

```
src/
├── manifest.json
├── popup.html
├── popup.js
├── popup.css
├── background.js       ← shell only
├── content.js          ← shell only
├── sidepanel.html      ← placeholder only
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## manifest.json — exact structure

```json
{
  "manifest_version": 3,
  "name": "GitHub Code Visualizer",
  "description": "Visualize code dependency graphs for any GitHub repository",
  "version": "0.1.0",
  "permissions": ["storage", "sidePanel", "tabs", "scripting"],
  "host_permissions": [
    "https://github.com/*",
    "https://api.github.com/*"
  ],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["https://github.com/*/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "side_panel": { "default_path": "sidepanel.html" },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

---

## popup.js — required functionality

- On load: check `chrome.storage.local` for existing token → show status
- Save button: validate token via `GET https://api.github.com/user` → save to storage
- Clear button: remove token from storage
- Never log the token to console

---

## background.js — shell only

```js
// Open side panel when icon clicked on a GitHub tab
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[background] received:', message.type)
  return true
})
```

---

## Done When

- [ ] Extension loads at `chrome://extensions` with zero errors
- [ ] Icon visible in Chrome toolbar
- [ ] Popup opens on click with token input and save button
- [ ] Valid token → "Token validated ✓" message
- [ ] Invalid token → clear error message
- [ ] Token persists across browser restart
- [ ] Clicking extension on a GitHub repo page opens side panel (placeholder text is fine)
- [ ] No errors in service worker console

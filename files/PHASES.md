# Build Phases — GitHub Code Visualizer

Each phase produces working, testable output before the next begins.
Never start a phase until the previous phase's "Done When" checklist is complete.

---

## Phase 1 — Extension Shell + Token Setup
**Goal:** A working Chrome extension that loads, shows a popup, and stores a GitHub token.

### Files to create
- `src/manifest.json`
- `src/popup.html`
- `src/popup.js`
- `src/background.js` (empty shell)
- `src/icons/` (16, 48, 128px placeholder icons)

### manifest.json must include
```json
{
  "manifest_version": 3,
  "name": "GitHub Code Visualizer",
  "version": "0.1.0",
  "permissions": ["storage", "sidePanel", "tabs", "scripting"],
  "host_permissions": ["https://github.com/*", "https://api.github.com/*"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["https://github.com/*/*"],
    "js": ["content.js"]
  }],
  "side_panel": { "default_path": "sidepanel.html" },
  "action": { "default_popup": "popup.html" }
}
```

### popup.html must have
- Input field for GitHub Personal Access Token
- Save button → stores token via `chrome.storage.local.set({ token })`
- Status indicator: "Token saved ✓" or "No token — rate limited to 60 req/hr"
- Link to GitHub token creation page

### Done when
- [ ] Extension loads in Chrome without errors (`chrome://extensions`)
- [ ] Popup opens when extension icon is clicked
- [ ] Token can be saved and persists across browser restarts
- [ ] No console errors in background service worker

---

## Phase 2 — GitHub API Fetcher
**Goal:** Given a repo URL, fetch the full file tree and raw content of source files.

### Files to create/modify
- `src/background.js` (implement fetcher)
- `src/content.js` (URL parser + message sender)

### content.js responsibilities
```js
// Extract from window.location.href:
// https://github.com/spring-projects/spring-boot
// → { owner: "spring-projects", repo: "spring-boot", branch: "main" }

// Send to background:
chrome.runtime.sendMessage({ type: "ANALYZE_REPO", owner, repo, branch })
```

### background.js responsibilities
```js
// 1. GET https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1
//    → Returns full file tree (all paths)

// 2. Filter to source files only:
//    Java:   ends with .java
//    JS/TS:  ends with .js, .ts, .jsx, .tsx
//    Python: ends with .py
//    Skip:   .md, .json, .xml, .png, .jar, any file > 100KB

// 3. Fetch file contents in batches of 5:
//    GET https://api.github.com/repos/{owner}/{repo}/contents/{path}
//    → response.content is base64 encoded → atob(content) to decode

// 4. Send progress updates to sidepanel:
//    { type: "PROGRESS", parsed: 23, total: 87 }

// 5. After all files fetched, send:
//    { type: "FILES_READY", files: [{ path, content, language }] }
```

### Rate limit handling
- Check `X-RateLimit-Remaining` header on every response
- If remaining < 10, pause 60 seconds before continuing
- Send `{ type: "RATE_LIMITED", resetAt }` to side panel so user sees a message

### Done when
- [ ] Opening a small public repo (< 50 files) fetches all source files
- [ ] Progress messages are logged to console correctly
- [ ] Binary files and large files are skipped
- [ ] Rate limit headers are checked and respected
- [ ] Works with and without a stored token

---

## Phase 3 — Parsers (Java first, then JS, then Python)
**Goal:** Given raw file content, extract structured dependency information.

### Files to create
- `src/parser/java.js`
- `src/parser/javascript.js`
- `src/parser/python.js`
- `src/parser/index.js` (routes to correct parser by language)

### Parser output — each file returns a FileNode
```js
{
  path: "src/main/java/com/example/UserService.java",
  language: "java",
  packageName: "com.example",
  className: "UserService",
  classType: "class",            // "class" | "interface" | "enum" | "annotation"
  annotations: ["@Service"],     // Spring annotations found
  imports: [                     // raw import strings
    "com.example.UserRepository",
    "org.springframework.stereotype.Service"
  ],
  extends: "BaseService",        // null if none
  implements: ["UserPort"],      // [] if none
  methods: ["getUser", "createUser", "deleteUser"],
  lineCount: 142
}
```

### Java parser rules (src/parser/java.js)
```
package com.example.service;  → packageName = "com.example.service"
import com.example.UserRepo;  → imports.push("com.example.UserRepo")
@Service                      → annotations.push("@Service")
public class UserService extends BaseService implements UserPort
  → className="UserService", extends="BaseService", implements=["UserPort"]
public void getUser(...)      → methods.push("getUser")
```

### Spring annotation → node subtype mapping
```
@Service      → subtype: "service"
@Controller   → subtype: "controller"
@RestController → subtype: "controller"
@Repository   → subtype: "repository"
@Component    → subtype: "component"
@Configuration → subtype: "config"
```

### JS/TS parser rules (src/parser/javascript.js)
```
import { foo } from './services/UserService'  → imports.push("./services/UserService")
import React from 'react'                     → imports.push("react") [external]
export default class UserComponent            → className="UserComponent"
export function getUserData()                 → methods.push("getUserData")
```

### Python parser rules (src/parser/python.js)
```
from services.user import UserService  → imports.push("services.user")
import os                              → imports.push("os") [external]
class UserService(BaseService):        → className="UserService", extends="BaseService"
def get_user(self):                    → methods.push("get_user")
```

### Done when
- [ ] `parseJava(content, path)` returns correct FileNode for a sample Spring Boot file
- [ ] `parseJS(content, path)` returns correct FileNode for a sample React component
- [ ] `parsePython(content, path)` returns correct FileNode for a sample Python class
- [ ] External imports (from npm / PyPI / Java stdlib) are flagged separately from project imports
- [ ] Malformed files don't throw — catch errors and return a partial FileNode

---

## Phase 4 — Graph Builder + Insights
**Goal:** Convert FileNode[] into a graph with nodes, edges, and computed metrics.

### Files to create
- `src/graph/builder.js`
- `src/graph/insights.js`

### builder.js — graph construction
```js
// Input: FileNode[]
// Output: { nodes: Node[], edges: Edge[] }

// Step 1: Create one node per FileNode
// Step 2: For each import in a FileNode, find the matching target node
//   - Java: match by fully qualified name (packageName + className)
//   - JS: resolve relative path to absolute path, match by path
//   - Python: match by module path
// Step 3: Create an edge for each resolved import
// Step 4: Create "external" nodes for unresolved imports (npm packages, stdlib)
```

### Edge type resolution
```
Java import → edge type "imports"
Java extends → edge type "extends"
Java implements → edge type "implements"
Java @Autowired field → edge type "injects"
JS/TS import → edge type "imports"
Python import → edge type "imports"
Python class inheritance → edge type "extends"
```

### insights.js — computed metrics
```js
// Fan-in: how many nodes have an edge pointing TO this node
// Fan-out: how many edges go FROM this node to others
// Hotspot: fanIn + fanOut > threshold (default: 8)
// Orphan: fanIn === 0 AND fanOut === 0
// Circular: detect cycles using DFS — A→B→C→A = circular
```

### Circular dependency detection
```js
// Use DFS with a visited set and recursion stack
// When you find an edge that points to a node already in the recursion stack
// → mark all edges in that cycle as type "circular"
// → add circularWith: ["NodeB", "NodeC"] to each involved node
```

### Done when
- [ ] A 10-file Spring Boot project produces correct nodes and edges
- [ ] Fan-in and fan-out are computed correctly
- [ ] Circular dependencies are detected and flagged
- [ ] Orphan files are identified
- [ ] External dependencies have their own node type

---

## Phase 5 — Side Panel + D3 Graph Rendering
**Goal:** A beautiful, interactive graph renders in Chrome's side panel on any GitHub repo page.

### Files to create
- `src/sidepanel.html`
- `src/sidepanel.js`
- `src/sidepanel.css`

### sidepanel.html structure
```html
<div id="toolbar">
  <span id="repo-name"></span>
  <div id="filters">
    <button data-filter="all">All</button>
    <button data-filter="class">Classes</button>
    <button data-filter="package">Packages</button>
    <button data-filter="external">External</button>
  </div>
  <input id="search" placeholder="Search node..." />
</div>
<div id="progress" hidden>
  <span id="progress-text">Parsing 0 / 0 files...</span>
  <progress id="progress-bar"></progress>
</div>
<div id="graph-container">
  <svg id="graph"></svg>
</div>
<div id="detail-panel" hidden>
  <!-- shows on node click -->
</div>
<div id="insights-panel">
  <!-- circular deps, hotspots, orphans -->
</div>
```

### D3-force configuration
```js
const simulation = d3.forceSimulation(nodes)
  .force("link", d3.forceLink(edges).id(d => d.id).distance(80))
  .force("charge", d3.forceManyBody().strength(-200))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide(30))
```

### Node colors by type
```
package     → #378ADD (blue)
class       → #1D9E75 (teal)
interface   → #7F77DD (purple)
external    → #888780 (gray)
circular    → #E24B4A (red)
hotspot     → #BA7517 (amber) — high fan-in+out
```

### Node click behavior
- Highlight the clicked node (enlarge, bright border)
- Dim all unconnected nodes to 20% opacity
- Highlight all edges connected to this node
- Show detail panel: name, type, file path, line count, methods list, fan-in, fan-out

### Done when
- [ ] Graph renders for a real repo within 15 seconds
- [ ] Nodes are draggable and the simulation stabilizes
- [ ] Zoom and pan work (d3.zoom)
- [ ] Filter buttons show/hide node types correctly
- [ ] Search highlights matching nodes
- [ ] Clicking a node shows its detail panel
- [ ] Progress bar shows during fetching/parsing
- [ ] Circular dependency edges are red

---

## Phase 6 — Polish, Edge Cases, and Publishing
**Goal:** Production-ready extension that handles real-world repos gracefully.

### Tasks
- [ ] Handle repos with 0 source files (show a "no supported files" message)
- [ ] Handle API errors (404 repo not found, 403 forbidden, 429 rate limited)
- [ ] Add "Re-analyze" button to refresh the graph
- [ ] Cache the last graph per repo in `chrome.storage.session` — instant reload if user closes and reopens panel
- [ ] Add export button — downloads graph as PNG (using `canvas.toDataURL()`)
- [ ] Add a settings page: token input, max file count slider, language toggles
- [ ] Write a README.md with screenshots
- [ ] Package and publish to Chrome Web Store

### Performance targets
- Repos up to 100 files: < 15 seconds end to end
- Repos up to 500 files: < 60 seconds with progress shown
- Repos > 500 files: show warning, offer to analyze only specific folders

### Done when
- [ ] Tested on 5 different real GitHub repos (including spring-petclinic, a JS React app, a Python project)
- [ ] No unhandled errors in any tested repo
- [ ] Extension packaged as `.zip` ready for Web Store submission

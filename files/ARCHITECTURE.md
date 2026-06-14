# Architecture — GitHub Code Visualizer

## System Design

```
┌─────────────────────────────────────────────────────┐
│                   CHROME BROWSER                     │
│                                                     │
│  ┌──────────────┐      ┌────────────────────────┐   │
│  │  GitHub Tab  │      │     Side Panel         │   │
│  │              │      │  ┌──────────────────┐  │   │
│  │  content.js  │─────▶│  │  sidepanel.js    │  │   │
│  │  (injected)  │      │  │  D3 graph render │  │   │
│  └──────┬───────┘      │  └──────────────────┘  │   │
│         │ sendMessage  └────────────────────────┘   │
│         ▼                        ▲                  │
│  ┌──────────────────────────────────────────────┐   │
│  │            background.js (service worker)    │   │
│  │                                              │   │
│  │  1. Receive ANALYZE_REPO message             │   │
│  │  2. Fetch file tree from GitHub API          │   │
│  │  3. Fetch file contents (batched)            │   │
│  │  4. Call parser/index.js                     │   │
│  │  5. Call graph/builder.js                    │   │
│  │  6. Call graph/insights.js                   │   │
│  │  7. Send GRAPH_READY to side panel           │   │
│  └──────────────┬───────────────────────────────┘   │
│                 │                                    │
└─────────────────┼────────────────────────────────────┘
                  │ fetch()
                  ▼
        ┌─────────────────┐
        │  GitHub REST    │
        │  API v3         │
        │  api.github.com │
        └─────────────────┘
```

---

## Component Responsibilities

### content.js
- Runs on every `https://github.com/*/*` page
- Reads `window.location.href` to extract `{ owner, repo, branch }`
- Listens for the extension icon click via `chrome.action.onClicked`
- Sends `ANALYZE_REPO` message to `background.js`
- Does NOT make any API calls (CORS restrictions in content scripts)

### background.js (service worker)
- Central coordinator — orchestrates the entire analysis pipeline
- Fetches GitHub API data (has access to `fetch()` without CORS issues)
- Calls parsers on file content
- Calls graph builder
- Sends progress updates and final graph to side panel
- Manages token retrieval from `chrome.storage.local`

### popup.js
- One-time setup: user saves their GitHub PAT
- Validates token by calling `GET /user` on GitHub API
- Stores valid token to `chrome.storage.local`

### parser/index.js
- Routes to correct parser based on file extension
- `.java` → `parser/java.js`
- `.js`, `.ts`, `.jsx`, `.tsx` → `parser/javascript.js`
- `.py` → `parser/python.js`
- Wraps all parsers in try/catch — bad files return partial data, never crash

### parser/java.js
- Regex-based AST-lite parser for Java source files
- Extracts: package, imports, class name, type, Spring annotations, extends, implements, methods
- Spring-aware: maps `@Service`, `@Controller`, etc. to node subtypes

### parser/javascript.js
- Handles ES modules (`import`/`export`) and CommonJS (`require`)
- Resolves relative imports to absolute paths
- Detects React components (default export returning JSX)
- Handles TypeScript (`interface`, `type`, `enum`)

### parser/python.js
- Handles `import X` and `from X import Y` patterns
- Detects class definitions and inheritance
- Resolves relative imports (dots in `from .utils import helper`)

### graph/builder.js
- Takes `FileNode[]` from parsers
- Creates one `Node` per FileNode
- Resolves imports to actual nodes in the graph (by matching FQN or path)
- Creates `external` nodes for unresolved imports (npm packages, Java stdlib)
- Builds `Edge[]` for each resolved dependency

### graph/insights.js
- Computes `fanIn` (how many nodes depend on this) for every node
- Computes `fanOut` (how many nodes this depends on) for every node
- Marks `isHotspot: true` if fanIn + fanOut > 8
- Marks `isOrphan: true` if fanIn === 0 AND fanOut === 0
- Runs DFS cycle detection → marks circular dependency edges
- Returns summary: `{ hotspots[], orphans[], circularChains[], totalNodes, totalEdges }`

### sidepanel.js
- Receives `GRAPH_READY` message with `{ nodes, edges, insights }`
- Initializes D3-force simulation
- Renders nodes as SVG circles (colored by type)
- Renders edges as SVG lines (styled by edge type)
- Handles zoom/pan via `d3.zoom`
- Handles node click → shows detail panel
- Handles filter buttons → shows/hides node types
- Handles search → highlights matching nodes

---

## Message Protocol

All messages use `chrome.runtime.sendMessage` and `chrome.runtime.onMessage`.

### content.js → background.js
```js
{ type: "ANALYZE_REPO", owner: string, repo: string, branch: string }
```

### background.js → sidepanel.js
```js
// During fetching/parsing:
{ type: "PROGRESS", stage: "fetching"|"parsing"|"building", current: number, total: number }

// Rate limit hit:
{ type: "RATE_LIMITED", resetAt: timestamp, remaining: number }

// Error:
{ type: "ERROR", code: "NOT_FOUND"|"FORBIDDEN"|"RATE_LIMITED"|"EMPTY_REPO", message: string }

// Success:
{ type: "GRAPH_READY", nodes: Node[], edges: Edge[], insights: Insights, meta: RepoDeta }
```

---

## Storage Schema

```js
// chrome.storage.local (persists across sessions)
{
  "token": "ghp_xxxxxxxxxxxx",           // GitHub PAT
  "tokenValidated": true,                // was token verified
}

// chrome.storage.session (cleared when browser closes)
{
  "cache:{owner}/{repo}:{sha}": {        // keyed by commit SHA
    nodes: Node[],
    edges: Edge[],
    insights: Insights,
    cachedAt: timestamp
  }
}
```

---

## Error Handling Strategy

| Error | User Message | Recovery |
|---|---|---|
| 404 Not Found | "Repo not found or private — add a token" | Show token setup prompt |
| 403 Forbidden | "No access to this repo" | Show token setup prompt |
| 429 Rate Limited | "Rate limited — resuming in Xs" | Auto-retry after reset |
| Parse error on file | Silent — skip that file | Log to console, continue |
| Empty repo | "No supported source files found" | Show supported languages |
| Repo > 500 files | "Large repo — showing first 500 files" | Truncate with warning |

---

## Performance Considerations

- **File batching:** Always fetch 5 files at a time, never all at once
- **Skip early:** Filter file tree BEFORE fetching content — never fetch `.md`, `.json`, images
- **Size limit:** Skip files > 100KB (GitHub API returns file size in tree response)
- **Caching:** Cache graph by `{owner}/{repo}/{latestCommitSHA}` — same commit = instant load
- **D3 performance:** For graphs > 200 nodes, disable link force animations after simulation stabilizes
- **Memory:** After graph is built, do not retain raw file content — only keep the graph data

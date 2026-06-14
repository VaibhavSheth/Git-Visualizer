# GitHub Code Visualizer — Chrome Extension
## Claude Code Reference Document

---

## Project Overview

A Chrome Extension that reads any GitHub repository directly via the GitHub API and renders an interactive dependency graph inside Chrome's native Side Panel — no backend server, no file cloning, no hosting required.

The user opens any GitHub repo page → clicks the extension icon → a side panel slides in showing an interactive graph of files, classes, imports, and dependencies.

---

## Core Philosophy

- **Zero backend for core functionality** — everything runs in the browser
- **GitHub API as the data source** — fetch file trees and contents directly
- **Parse in browser** — JS-based parsers extract dependencies from raw source
- **D3-force for rendering** — interactive, zoomable, draggable node graph
- **Chrome Side Panel API** — slides in beside GitHub, doesn't replace it

---

## Project Structure

```
github-visualizer/
├── CLAUDE.md                  ← You are here (primary reference)
├── PHASES.md                  ← Build order and milestones
├── ARCHITECTURE.md            ← Full system design and data flow
├── API-REFERENCE.md           ← GitHub API endpoints used
├── PARSER-SPEC.md             ← Parser rules for each language
├── GRAPH-SPEC.md              ← Node/edge schema and graph algorithms
├── TESTING.md                 ← Testing strategy and test cases
├── docs/
│   ├── CHROME-EXTENSION.md   ← Chrome MV3 extension patterns
│   ├── D3-GRAPH.md           ← D3-force implementation guide
│   └── GITHUB-AUTH.md        ← Auth flow and token handling
├── phases/
│   ├── phase-1.md            ← Manifest + popup + token setup
│   ├── phase-2.md            ← GitHub API fetcher
│   ├── phase-3.md            ← Java/Spring parser
│   ├── phase-4.md            ← Graph builder + insights
│   ├── phase-5.md            ← Side panel + D3 rendering
│   └── phase-6.md            ← Multi-language + polish
└── src/
    ├── manifest.json
    ├── background.js
    ├── content.js
    ├── popup.html / popup.js
    ├── sidepanel.html / sidepanel.js
    ├── parser/
    │   ├── java.js
    │   ├── javascript.js
    │   └── python.js
    ├── graph/
    │   ├── builder.js
    │   └── insights.js
    └── icons/
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Extension runtime | Chrome MV3 | Current Chrome standard, required for side panel |
| API fetching | GitHub REST API v3 | Fetch file tree + contents without cloning |
| Parsing | Custom JS regex parsers | Runs in browser, no server needed |
| Graph data structure | Plain JS objects (nodes/edges) | Simple, serializable, fast |
| Graph rendering | D3-force v7 | Best-in-class force-directed graph |
| Auth | GitHub Personal Access Token | Stored in chrome.storage.local |
| Styling | Plain CSS (no framework) | Extensions don't need a UI framework |

---

## Key Constraints — Read Before Writing Code

1. **Manifest V3 only** — no background pages, use service workers (`background.js`)
2. **No `eval()` or inline scripts** — blocked by MV3 CSP
3. **All `fetch()` calls must be in `background.js`** — content scripts have CORS restrictions
4. **Side panel must be registered in manifest** — `"side_panel": { "default_path": "sidepanel.html" }`
5. **GitHub API rate limit** — 60 req/hr unauthenticated, 5000/hr with token. Always batch file fetches.
6. **File size limit** — skip binary files and files > 100KB. GitHub API returns base64 content.
7. **Message passing** — content.js → background.js → sidepanel.js via `chrome.runtime.sendMessage`

---

## Data Flow (Summary)

```
GitHub page URL
  → content.js extracts { owner, repo, branch }
  → sends message to background.js
  → background.js calls GitHub API (file tree)
  → fetches each source file content (batched)
  → passes raw files to parser/*.js
  → parser returns FileNode[]
  → graph/builder.js creates { nodes[], edges[] }
  → graph/insights.js adds metrics (fan-in, fan-out, circular deps)
  → sends graph to sidepanel.js
  → D3-force renders interactive graph
```

---

## Node Schema

```js
{
  id: "com.example.UserService",      // unique — fully qualified name
  label: "UserService",               // display name
  type: "class" | "interface" | "package" | "file" | "external",
  subtype: "service" | "controller" | "repository" | "component" | null,
  filePath: "src/main/java/.../UserService.java",
  lineCount: 142,
  methods: ["getUser", "createUser"],
  metrics: {
    fanIn: 3,    // how many nodes depend on this
    fanOut: 5,   // how many nodes this depends on
    isHotspot: true
  }
}
```

---

## Edge Schema

```js
{
  id: "UserController→UserService",
  source: "com.example.UserController",
  target: "com.example.UserService",
  type: "imports" | "calls" | "extends" | "implements" | "injects" | "circular",
  label: "@Autowired"   // optional annotation label
}
```

---

## Commands

When Claude Code is working on this project:

- **Run extension locally**: Load `src/` as unpacked extension in Chrome (`chrome://extensions → Load unpacked`)
- **Test parser**: `node tests/parser.test.js`
- **Lint**: `npx eslint src/`
- **Package**: `zip -r extension.zip src/`

---

## Current Status

See `PHASES.md` for what is built and what is next.

---

## Do Not

- Do not use `jQuery` or any heavy library — keep the extension lightweight
- Do not store file contents persistently — parse and discard, keep only the graph
- Do not make API calls from `content.js` — always route through `background.js`
- Do not use `localStorage` — use `chrome.storage.local` instead
- Do not fetch more than 5 files in parallel — respect GitHub rate limits

# Phase 6 — Multi-language + Polish

**Outcome:** Extension works on Java, JS/TS, and Python repos. Handles edge cases gracefully. Ready for Chrome Web Store.

**Reference docs:** `PARSER-SPEC.md`, `TESTING.md`

---

## Files to Create/Modify

- `src/parser/javascript.js` — JS/TS parser
- `src/parser/python.js` — Python parser
- `src/parser/index.js` — add JS and Python routing
- `src/sidepanel.js` — add export, settings, re-analyze

---

## JS/TS parser

Follow `PARSER-SPEC.md` → "JavaScript/TypeScript Parser" section.

Handle:
- ES module imports (`import { } from`)
- CommonJS (`require()`)
- Default export class
- TypeScript interfaces and enums
- Relative path resolution (`./ and ../`)

## Python parser

Follow `PARSER-SPEC.md` → "Python Parser" section.

Handle:
- `import X` and `from X import Y`
- Relative imports (leading dots)
- Class inheritance

---

## Polish tasks

- [ ] Re-analyze button — clear current graph and re-fetch
- [ ] Cache graph in `chrome.storage.session` by `{owner}/{repo}/{commitSha}`
- [ ] Export as PNG button (see `docs/D3-GRAPH.md` → "Export as PNG")
- [ ] Handle repos > 500 files: warn user, offer folder filter
- [ ] Handle empty repos with zero source files
- [ ] Show repo metadata in toolbar: language, star count, file count
- [ ] All error states show clear user-facing messages (not just console logs)

---

## Final Checklist Before Publishing

- [ ] Tested on `spring-projects/spring-petclinic` (Java)
- [ ] Tested on `facebook/create-react-app` (JS)
- [ ] Tested on `django/django` (Python)
- [ ] Tested on a private repo with a valid token
- [ ] Tested on a repo with 0 source files
- [ ] No unhandled errors on any tested repo
- [ ] No token logged to console anywhere
- [ ] Manifest permissions are minimal (no extras)
- [ ] Icons are proper PNG files (not placeholder)
- [ ] README.md written with screenshots
- [ ] Extension packaged as `.zip` for Web Store

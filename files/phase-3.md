# Phase 3 — Java/Spring Parser

**Outcome:** Raw Java file content → structured `FileNode` with class name, package, imports, Spring annotations, extends, implements, and methods.

**Reference docs:** `PARSER-SPEC.md`

---

## Files to Create

- `src/parser/java.js` — Java parser
- `src/parser/index.js` — router (Java only for now)

---

## java.js — function signature

```js
export function parseJava(content, filePath) {
  // Returns FileNode or null
  // Must never throw — catch all errors
}
```

## Regex patterns to implement

See `PARSER-SPEC.md` → "Java Parser" section for exact patterns.

Key extractions:
1. `package` declaration → `packageName`
2. `import` statements → `imports[]` (mark external if starts with `java.`, `javax.`, `org.springframework.`, etc.)
3. Class declaration line → `className`, `classType`, `extends`, `implements[]`
4. Spring annotations above class → `annotations[]` → derive `subtype`
5. Public/protected method names → `methods[]`
6. Line count → `content.split('\n').length`

## Node ID for Java
```js
id = packageName + '.' + className
// e.g. "com.example.service.UserService"
```

---

## Done When

- [ ] `parseJava(userServiceContent, path)` returns correct `FileNode`
- [ ] Spring annotations correctly map to subtypes
- [ ] External imports are flagged as `isExternal: true`
- [ ] Malformed Java file returns partial result, never throws
- [ ] All test cases in `TESTING.md` → "Java test cases" pass

---

---

# Phase 4 — Graph Builder + Insights

**Outcome:** `FileNode[]` from parsers → `{ nodes[], edges[], insights }` — a complete graph with metrics.


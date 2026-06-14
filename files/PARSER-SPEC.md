# Parser Specification

All parsers live in `src/parser/`. Each parser takes `(content: string, filePath: string)` and returns a `FileNode` object. Parsers must never throw — wrap everything in try/catch and return partial data on error.

---

## FileNode Schema (output of every parser)

```js
{
  // Identity
  path: string,               // "src/main/java/com/example/UserService.java"
  language: string,           // "java" | "javascript" | "typescript" | "python"
  fileName: string,           // "UserService.java"

  // Class/module info
  packageName: string | null, // "com.example.service" (Java) or null
  className: string | null,   // "UserService" or null
  classType: string,          // "class" | "interface" | "enum" | "function" | "module"
  annotations: string[],      // ["@Service", "@Transactional"]

  // Dependencies
  imports: ImportEntry[],     // see below
  extends: string | null,     // "BaseService" or null
  implements: string[],       // ["UserPort", "Serializable"]

  // Contents
  methods: string[],          // ["getUser", "createUser"]
  lineCount: number,

  // Meta
  isExternal: false,          // always false for parsed files
  parseError: string | null   // error message if parsing partially failed
}
```

### ImportEntry schema
```js
{
  raw: string,         // raw import string "com.example.UserRepository"
  alias: string | null // import alias if any (TS: import X as Y)
  isExternal: boolean, // true if npm package / Java stdlib / PyPI
  resolvedPath: string | null // resolved to actual file path (set by graph/builder.js)
}
```

---

## Java Parser (`src/parser/java.js`)

### Regex patterns to use

```js
// Package
/^package\s+([\w.]+);/m

// Imports
/^import\s+(?:static\s+)?([\w.*]+);/gm

// Class/interface/enum declaration
/(?:public|private|protected)?\s*(abstract\s+)?(class|interface|enum|@interface)\s+(\w+)(?:\s+extends\s+([\w<>, ]+?))?(?:\s+implements\s+([\w<>, ]+?))?(?:\s*\{)/m

// Spring annotations (look for them above the class declaration)
/@(Service|Controller|RestController|Repository|Component|Configuration|SpringBootApplication|Entity|Mapper|FeignClient)\b/g

// Method declarations (public/protected/private, return type, name, params)
/(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?[\w<>\[\]]+\s+(\w+)\s*\(/g

// @Autowired fields
/@Autowired[\s\S]*?private\s+\w+\s+(\w+);/g
```

### External import detection (Java)
Imports are external if they start with any of:
```
java., javax., jakarta., org.springframework., com.fasterxml., org.apache.,
io.github., com.google., org.slf4j., ch.qos., org.junit., org.mockito.
```

### Spring annotation → subtype mapping
```js
const SPRING_SUBTYPES = {
  '@Service': 'service',
  '@Controller': 'controller',
  '@RestController': 'controller',
  '@Repository': 'repository',
  '@Component': 'component',
  '@Configuration': 'config',
  '@SpringBootApplication': 'app',
  '@Entity': 'entity',
  '@FeignClient': 'feign'
}
```

### Fully qualified name (FQN) construction
```
FQN = packageName + "." + className
Example: "com.example.service.UserService"
This is used as the node ID and for import resolution in graph/builder.js
```

---

## JavaScript / TypeScript Parser (`src/parser/javascript.js`)

### ES Module patterns

```js
// Named imports
/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm
// → extract module path from group 2

// Default import
/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm

// Namespace import
/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm

// Side-effect import
/^import\s+['"]([^'"]+)['"]/gm

// Re-export
/^export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/gm
```

### CommonJS patterns
```js
/(?:const|let|var)\s+(?:\{[^}]+\}|\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/gm
```

### Class and function detection
```js
// Class
/(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?/gm

// Named function export
/export\s+(?:async\s+)?function\s+(\w+)/gm

// Arrow function export
/export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(/gm

// Default export class
/export\s+default\s+class\s+(\w+)/gm
```

### TypeScript extras
```js
// Interface
/(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/gm

// Type alias
/(?:export\s+)?type\s+(\w+)\s*=/gm

// Enum
/(?:export\s+)?enum\s+(\w+)/gm
```

### External import detection (JS/TS)
An import is external if it does NOT start with `.` or `/`:
```js
const isExternal = !raw.startsWith('.') && !raw.startsWith('/')
// 'react' → external
// './services/UserService' → internal
// '../utils' → internal
```

### Path resolution (internal imports)
```js
// Given: filePath = "src/components/UserCard.jsx"
//        import from "./hooks/useUser"
// Resolved: "src/components/hooks/useUser"
// Then try: "src/components/hooks/useUser.js"
//           "src/components/hooks/useUser.ts"
//           "src/components/hooks/useUser/index.js"
// (graph/builder.js handles final resolution)
```

---

## Python Parser (`src/parser/python.js`)

### Import patterns

```js
// import X
/^import\s+([\w.]+)(?:\s+as\s+\w+)?/gm

// from X import Y
/^from\s+([\w.]+)\s+import\s+(?:\([\s\S]*?\)|[\w,\s*]+)/gm

// Relative imports (from . import X, from ..utils import Y)
/^from\s+(\.+[\w.]*)\s+import/gm
```

### Class detection
```js
// class UserService(BaseService):
/^class\s+(\w+)(?:\(([^)]*)\))?:/gm
// group 1 = class name
// group 2 = parent classes (comma separated)
```

### Function detection
```js
// def get_user(self):  or  async def get_user():
/^(?:    )?(?:async\s+)?def\s+(\w+)\s*\(/gm
// Only top-level and class-level (4-space indent) methods
```

### External import detection (Python)
Common stdlib and well-known packages to flag as external:
```
os, sys, re, json, datetime, collections, itertools, functools,
pathlib, typing, abc, dataclasses, enum, logging, unittest,
django, flask, fastapi, sqlalchemy, pandas, numpy, requests,
pydantic, celery, redis, boto3, pytest
```

---

## parser/index.js — Router

```js
import { parseJava } from './java.js'
import { parseJS } from './javascript.js'
import { parsePython } from './python.js'

const EXTENSION_MAP = {
  '.java': parseJava,
  '.js': parseJS,
  '.ts': parseJS,
  '.jsx': parseJS,
  '.tsx': parseJS,
  '.py': parsePython
}

export function parseFile(content, filePath) {
  const ext = filePath.substring(filePath.lastIndexOf('.'))
  const parser = EXTENSION_MAP[ext]
  if (!parser) return null
  try {
    return parser(content, filePath)
  } catch (err) {
    return {
      path: filePath,
      language: ext.substring(1),
      parseError: err.message,
      imports: [], methods: [], annotations: [],
      implements: [], extends: null, className: null
    }
  }
}
```

---

## Testing Parsers

Each parser should be tested against these cases:

### Java test cases
1. Simple `@Service` class with one import and two methods
2. `@RestController` with `@Autowired` field
3. Interface with `extends`
4. Class with multiple `implements`
5. File with syntax errors (partial parse expected, no throw)

### JS test cases
1. React functional component with named imports
2. CommonJS `require()` file
3. TypeScript `interface` file
4. `export default class` pattern
5. File with only re-exports

### Python test cases
1. Class with single inheritance
2. Class with multiple inheritance
3. File with only functions (no class)
4. Relative imports (`from . import x`)
5. File with no imports

# Testing Strategy

---

## Overview

Since this is a Chrome Extension, testing is split into:
1. **Unit tests** — parsers and graph builder (pure JS, run with Node.js)
2. **Manual integration tests** — loading the extension in Chrome against real repos
3. **Snapshot tests** — assert graph output for a known repo doesn't change

No test framework is required — use plain Node.js `assert` module to keep it lightweight.

---

## Running Tests

```bash
# Unit tests (from project root)
node tests/parser/java.test.js
node tests/parser/javascript.test.js
node tests/parser/python.test.js
node tests/graph/builder.test.js
node tests/graph/insights.test.js

# Run all tests
node tests/run-all.js
```

---

## Test File Structure

```
tests/
├── run-all.js
├── fixtures/
│   ├── java/
│   │   ├── UserService.java          ← sample Spring @Service class
│   │   ├── UserController.java       ← @RestController with @Autowired
│   │   ├── UserRepository.java       ← @Repository interface
│   │   ├── CircularA.java            ← imports CircularB
│   │   └── CircularB.java            ← imports CircularA
│   ├── javascript/
│   │   ├── UserCard.jsx              ← React component with named imports
│   │   ├── userService.js            ← CommonJS module
│   │   └── types.ts                  ← TypeScript interface file
│   └── python/
│       ├── user_service.py           ← class with inheritance
│       └── utils.py                  ← standalone functions only
├── parser/
│   ├── java.test.js
│   ├── javascript.test.js
│   └── python.test.js
└── graph/
    ├── builder.test.js
    └── insights.test.js
```

---

## Java Parser Tests (`tests/parser/java.test.js`)

```js
const assert = require('assert')
const { parseJava } = require('../../src/parser/java.js')
const fs = require('fs')

// Test 1: Basic @Service class
const userServiceSrc = fs.readFileSync('./tests/fixtures/java/UserService.java', 'utf8')
const result = parseJava(userServiceSrc, 'src/main/java/com/example/UserService.java')

assert.strictEqual(result.className, 'UserService')
assert.strictEqual(result.packageName, 'com.example')
assert.ok(result.annotations.includes('@Service'))
assert.strictEqual(result.subtype, 'service')
assert.ok(result.methods.includes('getUser'))
assert.ok(result.methods.includes('createUser'))
assert.ok(result.imports.some(i => i.raw === 'com.example.UserRepository'))
assert.ok(result.imports.some(i => i.isExternal && i.raw.startsWith('org.springframework')))

// Test 2: Interface detection
const repoSrc = fs.readFileSync('./tests/fixtures/java/UserRepository.java', 'utf8')
const repoResult = parseJava(repoSrc, 'src/main/java/com/example/UserRepository.java')
assert.strictEqual(repoResult.classType, 'interface')
assert.ok(repoResult.annotations.includes('@Repository'))

// Test 3: extends + implements
// (test that extends and implements arrays are correctly populated)

// Test 4: Malformed file should not throw
const malformedResult = parseJava('this is not java {{{{', 'broken.java')
assert.ok(malformedResult !== null)
assert.ok(malformedResult.parseError !== null || malformedResult.imports.length === 0)

console.log('✓ Java parser tests passed')
```

---

## JS Parser Tests (`tests/parser/javascript.test.js`)

Key assertions:
```js
// React component
assert.strictEqual(result.classType, 'class')  // or 'function' for functional
assert.ok(result.imports.some(i => i.raw === 'react' && i.isExternal))
assert.ok(result.imports.some(i => i.raw === './hooks/useUser' && !i.isExternal))

// CommonJS
assert.ok(result.imports.some(i => i.raw === 'express' && i.isExternal))
assert.ok(result.imports.some(i => i.raw === './routes/user' && !i.isExternal))

// TypeScript interface
assert.strictEqual(result.classType, 'interface')
assert.strictEqual(result.className, 'UserResponse')
```

---

## Graph Builder Tests (`tests/graph/builder.test.js`)

```js
const { buildGraph } = require('../../src/graph/builder.js')

// Three files: UserController depends on UserService depends on UserRepository
const fileNodes = [
  {
    path: 'src/UserController.java', className: 'UserController',
    packageName: 'com.example', language: 'java',
    imports: [{ raw: 'com.example.UserService', isExternal: false }]
  },
  {
    path: 'src/UserService.java', className: 'UserService',
    packageName: 'com.example', language: 'java',
    imports: [{ raw: 'com.example.UserRepository', isExternal: false }]
  },
  {
    path: 'src/UserRepository.java', className: 'UserRepository',
    packageName: 'com.example', language: 'java',
    imports: []
  }
]

const { nodes, edges } = buildGraph(fileNodes)

// Should have exactly 3 nodes (no external dependencies)
assert.strictEqual(nodes.length, 3)

// Should have 2 edges
assert.strictEqual(edges.length, 2)

// Edge from Controller → Service
assert.ok(edges.some(e =>
  e.source.includes('UserController') &&
  e.target.includes('UserService') &&
  e.type === 'imports'
))

console.log('✓ Graph builder tests passed')
```

---

## Insights Tests (`tests/graph/insights.test.js`)

```js
const { computeInsights } = require('../../src/graph/insights.js')

// Test circular dependency detection
// A → B → C → A
const nodes = [
  { id: 'A', type: 'class' },
  { id: 'B', type: 'class' },
  { id: 'C', type: 'class' }
]
const edges = [
  { id: 'A→B', source: 'A', target: 'B', type: 'imports' },
  { id: 'B→C', source: 'B', target: 'C', type: 'imports' },
  { id: 'C→A', source: 'C', target: 'A', type: 'imports' }
]

const insights = computeInsights(nodes, edges)

assert.ok(insights.circularChains.length > 0)
assert.ok(insights.circularChains[0].includes('A'))
assert.ok(nodes.find(n => n.id === 'A').metrics.isCircular)

// Test fan-in / fan-out
// Hub node: D is imported by A, B, C
// D.fanIn should be 3
const hubEdges = [
  { source: 'A', target: 'D', type: 'imports' },
  { source: 'B', target: 'D', type: 'imports' },
  { source: 'C', target: 'D', type: 'imports' }
]
// ... verify D.metrics.fanIn === 3

console.log('✓ Insights tests passed')
```

---

## Manual Integration Test Checklist

Test against these real repos:

### 1. spring-petclinic (Java, medium size)
```
https://github.com/spring-projects/spring-petclinic
```
- [ ] File tree fetches without error
- [ ] @Service, @Controller, @Repository nodes have correct subtypes
- [ ] Edges exist between controllers and services
- [ ] Graph renders within 15 seconds
- [ ] No console errors

### 2. facebook/react (JS, large)
```
https://github.com/facebook/react
```
- [ ] Extension handles large repo gracefully (warns if > 500 files)
- [ ] JS imports are parsed correctly
- [ ] External dependencies (npm packages) show as gray external nodes

### 3. django/django (Python, large)
```
https://github.com/django/django
```
- [ ] Python class hierarchy is detected
- [ ] Relative imports resolve correctly

### 4. Private repo (requires token)
- [ ] Extension prompts for token when accessing private repo
- [ ] After token is set, graph renders correctly

### 5. Empty / tiny repo
```
Any repo with 0 source files
```
- [ ] Shows "No supported source files found" message
- [ ] Does not crash

---

## Sample Fixture Files

### tests/fixtures/java/UserService.java
```java
package com.example.service;

import com.example.repository.UserRepository;
import com.example.model.User;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    public User getUser(Long id) {
        return userRepository.findById(id).orElseThrow();
    }

    public User createUser(User user) {
        return userRepository.save(user);
    }

    public void deleteUser(Long id) {
        userRepository.deleteById(id);
    }
}
```

### tests/fixtures/java/UserController.java
```java
package com.example.controller;

import com.example.service.UserService;
import com.example.model.User;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private UserService userService;

    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.getUser(id);
    }

    @PostMapping
    public User createUser(@RequestBody User user) {
        return userService.createUser(user);
    }
}
```

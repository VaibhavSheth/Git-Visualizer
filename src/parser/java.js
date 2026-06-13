const EXTERNAL_PREFIXES = [
  'java.', 'javax.', 'jakarta.', 'org.springframework.', 'com.fasterxml.',
  'org.apache.', 'io.github.', 'com.google.', 'org.slf4j.', 'ch.qos.',
  'org.junit.', 'org.mockito.', 'org.hibernate.', 'io.micrometer.',
  'com.amazonaws.', 'org.projectlombok.', 'io.swagger.'
]

const SPRING_SUBTYPES = {
  '@Service': 'service',
  '@Controller': 'controller',
  '@RestController': 'controller',
  '@Repository': 'repository',
  '@Component': 'component',
  '@Configuration': 'config',
  '@SpringBootApplication': 'app',
  '@Entity': 'entity',
  '@FeignClient': 'feign',
  '@Mapper': 'mapper'
}

function isExternalJava(raw) {
  return EXTERNAL_PREFIXES.some(p => raw.startsWith(p))
}

export function parseJava(content, filePath) {
  const node = {
    path: filePath,
    language: 'java',
    fileName: filePath.split('/').pop(),
    packageName: null,
    className: null,
    classType: 'class',
    annotations: [],
    imports: [],
    extends: null,
    implements: [],
    methods: [],
    lineCount: 0,
    isExternal: false,
    parseError: null,
    subtype: null,
    fqn: null
  }

  try {
    node.lineCount = content.split('\n').length

    // Package
    const pkgMatch = content.match(/^package\s+([\w.]+);/m)
    if (pkgMatch) node.packageName = pkgMatch[1]

    // Imports
    const importRe = /^import\s+(?:static\s+)?([\w.*]+);/gm
    let m
    while ((m = importRe.exec(content)) !== null) {
      const raw = m[1]
      node.imports.push({
        raw,
        alias: null,
        isExternal: isExternalJava(raw),
        resolvedPath: null
      })
    }

    // Annotations (scan entire file for Spring annotations)
    const annotationRe = /@(Service|Controller|RestController|Repository|Component|Configuration|SpringBootApplication|Entity|Mapper|FeignClient)\b/g
    while ((m = annotationRe.exec(content)) !== null) {
      const ann = `@${m[1]}`
      if (!node.annotations.includes(ann)) node.annotations.push(ann)
    }

    // Subtype from annotations
    for (const ann of node.annotations) {
      if (SPRING_SUBTYPES[ann]) {
        node.subtype = SPRING_SUBTYPES[ann]
        break
      }
    }

    // Class / interface / enum declaration
    const classDeclRe = /(?:public|private|protected)?\s*(?:abstract\s+)?(?:final\s+)?(class|interface|enum|@interface)\s+(\w+)(?:\s+extends\s+([\w<>, ]+?))?(?:\s+implements\s+([\w<>, ]+?))?(?:\s*(?:\{|$))/m
    const classMatch = content.match(classDeclRe)
    if (classMatch) {
      node.classType = classMatch[1] === '@interface' ? 'annotation' : classMatch[1]
      node.className = classMatch[2]

      if (classMatch[3]) {
        // Strip generics for cleaner name
        node.extends = classMatch[3].replace(/<[^>]*>/g, '').trim().split(',')[0].trim()
      }

      if (classMatch[4]) {
        node.implements = classMatch[4]
          .replace(/<[^>]*>/g, '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      }
    }

    // FQN
    if (node.packageName && node.className) {
      node.fqn = `${node.packageName}.${node.className}`
    } else if (node.className) {
      node.fqn = node.className
    }

    // Methods
    const methodRe = /(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:abstract\s+)?[\w<>\[\]]+\s+(\w+)\s*\(/g
    const SKIP_METHODS = new Set(['if', 'while', 'for', 'switch', 'catch', 'return'])
    while ((m = methodRe.exec(content)) !== null) {
      const name = m[1]
      if (!SKIP_METHODS.has(name) && !node.methods.includes(name)) {
        node.methods.push(name)
      }
    }

  } catch (err) {
    node.parseError = err.message
  }

  return node
}

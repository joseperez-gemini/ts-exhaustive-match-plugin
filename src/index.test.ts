import { init } from "./plugin"

import ts from "typescript"
import { beforeEach, describe, expect, it } from "vitest"

type TestCase = {
  name: string
  code: string
  expectedRefactor?: boolean
  expectedCode?: string
}

describe("TypeScript Exhaustive Match Plugin", () => {
  let plugin: ts.server.PluginModule
  let files: Map<string, string>
  let testFileName: string

  beforeEach(() => {
    plugin = init({ typescript: ts })
    files = new Map()
    testFileName = "test.ts"
  })

  function createLanguageService(code: string): ts.LanguageService {
    files.set(testFileName, code)

    const servicesHost: ts.LanguageServiceHost = {
      getScriptFileNames: () => [testFileName],
      getScriptVersion: () => "1",
      getScriptSnapshot: (fileName) => {
        const content = files.get(fileName)
        if (content === undefined) return undefined
        return ts.ScriptSnapshot.fromString(content)
      },
      getCurrentDirectory: () => process.cwd(),
      getCompilationSettings: () => ({ strict: true }),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (path) => files.has(path),
      readFile: (path) => files.get(path),
      readDirectory: () => [],
      directoryExists: () => true,
      getDirectories: () => [],
    }

    const documentRegistry = ts.createDocumentRegistry()
    const baseService = ts.createLanguageService(servicesHost, documentRegistry)

    const pluginCreateInfo: ts.server.PluginCreateInfo = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      project: {} as ts.server.Project,
      languageService: baseService,
      languageServiceHost: servicesHost,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      serverHost: {} as ts.server.ServerHost,
      config: {},
    }

    return plugin.create(pluginCreateInfo)
  }

  function getCursorPosition(code: string): number {
    const marker = "/*cursor*/"
    const position = code.indexOf(marker)
    if (position === -1) {
      throw new Error("Cursor marker not found in test code")
    }
    return position
  }

  function getCleanCode(code: string): string {
    return code.replace("/*cursor*/", "")
  }

  function testRefactor(testCase: TestCase) {
    const cleanCode = getCleanCode(testCase.code)
    const cursorPos = getCursorPosition(testCase.code)
    const enhancedService = createLanguageService(cleanCode)

    // Test if refactor is available
    const refactors = enhancedService.getApplicableRefactors(
      testFileName,
      cursorPos,
      {},
      undefined,
      undefined,
    )

    const exhaustiveMatchRefactor = refactors.find(
      (r) => r.name === "Generate exhaustive match",
    )

    if (testCase.expectedRefactor === false) {
      expect(exhaustiveMatchRefactor).toBeUndefined()
      return
    }

    expect(exhaustiveMatchRefactor).toBeDefined()
    expect(exhaustiveMatchRefactor?.actions?.length).toBeGreaterThan(0)

    if (testCase.expectedCode !== undefined) {
      // Test the generated code
      const edits = enhancedService.getEditsForRefactor(
        testFileName,
        {},
        cursorPos,
        "Generate exhaustive match",
        "generateExhaustiveMatch",
        {},
      )

      expect(edits).toBeDefined()
      expect(edits?.edits.length).toBeGreaterThan(0)

      const generatedCode = edits?.edits?.[0]?.textChanges?.[0]?.newText?.trim()
      expect(generatedCode).toContain(testCase.expectedCode)
    }
  }

  const testCases: TestCase[] = [
    {
      name: "should work with variable declarations",
      code: `
type Test = { tag: "a" } | { tag: "b" };
const /*cursor*/x: Test = { tag: "a" };
      `,
      expectedRefactor: true,
      expectedCode: `if (x.tag === "a") {
  
} else if (x.tag === "b") {
  
} else {
  x satisfies never;
}`,
    },
    {
      name: "should work with standalone identifiers",
      code: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = { tag: "a" };
/*cursor*/x
      `,
      expectedRefactor: true,
      expectedCode: `if (x.tag === "a") {
  
} else if (x.tag === "b") {
  
} else {
  x satisfies never;
}`,
    },
    {
      name: "should work with function parameters",
      code: `
type Status = { kind: "loading" } | { kind: "success"; data: string } | { kind: "error"; message: string };
function handleStatus(/*cursor*/status: Status) {}
      `,
      expectedRefactor: true,
      expectedCode: `if (status.kind === "loading") {
  
} else if (status.kind === "success") {
  
} else if (status.kind === "error") {
  
} else {
  status satisfies never;
}`,
    },
    {
      name: "should work with different discriminant property names",
      code: `
type Shape = { type: "circle"; radius: number } | { type: "rectangle"; width: number; height: number };
const /*cursor*/shape: Shape = { type: "circle", radius: 5 };
      `,
      expectedRefactor: true,
      expectedCode: `if (shape.type === "circle") {
  
} else if (shape.type === "rectangle") {
  
} else {
  shape satisfies never;
}`,
    },
    {
      name: "should work with complex union types",
      code: `
type Event = 
  | { type: "click"; x: number; y: number }
  | { type: "keydown"; key: string }
  | { type: "focus" };
function handleEvent(/*cursor*/event: Event) {}
      `,
      expectedRefactor: true,
      expectedCode: `if (event.type === "click") {
  
} else if (event.type === "keydown") {
  
} else if (event.type === "focus") {
  
} else {
  event satisfies never;
}`,
    },
    {
      name: "should not work with non-discriminated unions",
      code: `
type SimpleUnion = string | number;
const /*cursor*/x: SimpleUnion = "hello";
      `,
      expectedRefactor: false,
    },
    {
      name: "should not work with non-union types",
      code: `
type Simple = { name: string };
const /*cursor*/x: Simple = { name: "test" };
      `,
      expectedRefactor: false,
    },
    {
      name: "should work with three-way discriminated union",
      code: `
type Result<T, E> = 
  | { tag: "ok"; value: T }
  | { tag: "err"; error: E }
  | { tag: "loading" };
const /*cursor*/result: Result<string, Error> = { tag: "ok", value: "success" };
      `,
      expectedRefactor: true,
      expectedCode: `} else {
  result satisfies never;
}`,
    },
    {
      name: "should work when cursor is on variable name in declaration",
      code: `
type MyType = { tag: "alt-1"; key1: string } | { tag: "alt-2"; key2: number };
const /*cursor*/x: MyType = { tag: "alt-1", key1: "hello" };
      `,
      expectedRefactor: true,
      expectedCode: `if (x.tag === "alt-1") {
  
} else if (x.tag === "alt-2") {
  
} else {
  x satisfies never;
}`,
    },
  ]

  testCases.forEach((testCase) => {
    it(testCase.name, () => {
      testRefactor(testCase)
    })
  })

  describe("Edge cases", () => {
    it("should handle unions with no common discriminant", () => {
      const code = `
type Mixed = { a: string } | { b: number };
const /*cursor*/x: Mixed = { a: "test" };
      `

      const cleanCode = getCleanCode(code)
      const cursorPos = getCursorPosition(code)
      const enhancedService = createLanguageService(cleanCode)

      const refactors = enhancedService.getApplicableRefactors(
        testFileName,
        cursorPos,
        {},
        undefined,
        undefined,
      )

      const exhaustiveMatchRefactor = refactors.find(
        (r) => r.name === "Generate exhaustive match",
      )
      expect(exhaustiveMatchRefactor).toBeUndefined()
    })

    it("should handle empty unions gracefully", () => {
      // This is a theoretical case as TypeScript wouldn't allow this,
      // but we test the plugin's robustness
      const code = `
type Never = never;
const /*cursor*/x: Never = null as any;
      `

      const cleanCode = getCleanCode(code)
      const cursorPos = getCursorPosition(code)
      const enhancedService = createLanguageService(cleanCode)

      const refactors = enhancedService.getApplicableRefactors(
        testFileName,
        cursorPos,
        {},
        undefined,
        undefined,
      )

      const exhaustiveMatchRefactor = refactors.find(
        (r) => r.name === "Generate exhaustive match",
      )
      expect(exhaustiveMatchRefactor).toBeUndefined()
    })
  })
})

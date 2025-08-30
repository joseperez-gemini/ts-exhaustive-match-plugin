import { init } from "./plugin"

import ts from "typescript"
import { describe, expect, it } from "vitest"

const TEST_FILE_NAME = "test.ts"

describe("TypeScript Exhaustive Match Plugin", () => {
  function createLanguageService(code: string): ts.LanguageService {
    const plugin = init({ typescript: ts })
    const files: Map<string, string> = new Map()
    files.set(TEST_FILE_NAME, code)

    const servicesHost: ts.LanguageServiceHost = {
      getScriptFileNames: () => [TEST_FILE_NAME],
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

    const pluginCreateInfo: ts.server.PluginCreateInfo = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      project: {} as ts.server.Project,
      languageService: ts.createLanguageService(
        servicesHost,
        ts.createDocumentRegistry(),
      ),
      languageServiceHost: servicesHost,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      serverHost: {} as ts.server.ServerHost,
      config: {},
    }

    return plugin.create(pluginCreateInfo)
  }

  const CURSOR_MARKER = "/*cursor*/"
  function processInput(input: string): [code: string, position: number] {
    const position = input.indexOf(CURSOR_MARKER)
    if (position === -1) throw new Error("Cursor marker not found in input")
    return [input.replace(CURSOR_MARKER, ""), position]
  }

  const REFACTOR_BASE_TEST_CASES = [
    {
      name: "should work with const variable declarations",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const /*cursor*/x: Test = { tag: "a" };
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = { tag: "a" };
if (x.tag === "a") {
  \\
} else if (x.tag === "b") {
  \\
} else {
  x satisfies never;
}
      `,
    },
    {
      name: "should work with let variable declarations",
      input: `
type Test = { tag: "a" } | { tag: "b" };
let /*cursor*/x: Test = { tag: "a" };
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
let x: Test = { tag: "a" };
if (x.tag === "a") {
  \\
} else if (x.tag === "b") {
  \\
} else {
  x satisfies never;
}
      `,
    },
    {
      name: "should work with standalone identifiers",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = { tag: "a" };
/*cursor*/x
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = { tag: "a" };
if (x.tag === "a") {
  \\
} else if (x.tag === "b") {
  \\
} else {
  x satisfies never;
}
      `,
    },
    {
      name: "should work with function parameters",
      input: `
type Test = { tag: "a" } | { tag: "b" };
function handleTest(/*cursor*/x: Test) {}
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
function handleTest(x: Test) {
  if (x.tag === "a") {
    \\
  } else if (x.tag === "b") {
    \\
  } else {
    x satisfies never;
  }
}
      `,
    },
    {
      name: "should work with complex union types",
      input: `
type Test = 
  | { tag: "a"; prop1: number; prop2: number }
  | { tag: "b"; prop3: string }
  | { tag: "c" };
function handleTest(/*cursor*/x: Test) {}
      `,
      output: `
type Test = 
  | { tag: "a"; prop1: number; prop2: number }
  | { tag: "b"; prop3: string }
  | { tag: "c" };
function handleTest(x: Test) {
  if (x.tag === "a") {
    \\
  } else if (x.tag === "b") {
    \\
  } else if (x.tag === "c") {
    \\
  } else {
    x satisfies never;
  }
}
      `,
    },
    {
      name: "should work with generic union",
      input: `
type Result<T, E> = 
  | { tag: "ok"; value: T }
  | { tag: "error"; error: E }
  | { tag: "loading" };
const /*cursor*/result: Result<string, Error> = { tag: "ok", value: "success" };
      `,
      output: `
type Result<T, E> = 
  | { tag: "ok"; value: T }
  | { tag: "error"; error: E }
  | { tag: "loading" };
const result: Result<string, Error> = { tag: "ok", value: "success" };
if (result.tag === "ok") {
  \\
} else if (result.tag === "error") {
  \\
} else if (result.tag === "loading") {
  \\
} else {
  result satisfies never;
}
      `,
    },
  ]

  const ALTERNATIVE_TEST_HANDLING = [
    {
      name: "should preserve order of declaration of tags",
      input: `
type Test = { tag: "b" } | { tag: "a" };
const /*cursor*/x: Test = { tag: "a" };
      `,
      output: `
type Test = { tag: "b" } | { tag: "a" };
const x: Test = { tag: "a" };
if (x.tag === "b") {
  \\
} else if (x.tag === "a") {
  \\
} else {
  x satisfies never;
}
      `,
    },
    {
      name: "should work with function parameters with already opened braces",
      input: `
type Test = { tag: "a" } | { tag: "b" };
function handleTest(/*cursor*/x: Test) {
}
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
function handleTest(x: Test) {
  if (x.tag === "a") {
    \\
  } else if (x.tag === "b") {
    \\
  } else {
    x satisfies never;
  }
}
      `,
    },
    {
      name: "should work with function parameters with content in the function",
      input: `
type Test = { tag: "a" } | { tag: "b" };
function handleTest(/*cursor*/x: Test) {
  const something = 0;
}
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
function handleTest(x: Test) {
  if (x.tag === "a") {
    \\
  } else if (x.tag === "b") {
    \\
  } else {
    x satisfies never;
  }
  const something = 0;
}
      `,
    },
  ]

  for (const { name, input, output } of [
    ...REFACTOR_BASE_TEST_CASES,
    ...ALTERNATIVE_TEST_HANDLING,
  ]) {
    it(name, () => {
      const [inputCode, cursorPosition] = processInput(input)
      const expectedCode = output.replace(/ \\\n/g, " \n")

      const enhancedService = createLanguageService(inputCode)
      const refactors = enhancedService.getApplicableRefactors(
        TEST_FILE_NAME,
        cursorPosition,
        {},
        undefined,
        undefined,
      )

      const exhaustiveMatchRefactor = refactors.find(
        (r) => r.name === "Generate exhaustive match",
      )
      expect(exhaustiveMatchRefactor).toBeDefined()

      // Apply the refactor
      const edits = enhancedService.getEditsForRefactor(
        TEST_FILE_NAME,
        {},
        cursorPosition,
        "Generate exhaustive match",
        "generateExhaustiveMatch",
        {},
      )
      expect(edits).toBeDefined()
      expect(edits?.edits).toHaveLength(1)

      // Check that the generated code matches expected
      const textChange = edits?.edits[0]?.textChanges[0]
      expect(textChange).toBeDefined()

      // Apply the edit to get the final code
      let resultCode = inputCode
      if (textChange) {
        resultCode =
          inputCode.slice(0, textChange.span.start) +
          textChange.newText +
          inputCode.slice(textChange.span.start + textChange.span.length)
      }

      // Compare the result with expected code
      expect(resultCode.trim()).toBe(expectedCode.trim())
    })
  }

  const REFACTOR_NEGATIVE_TEST_CASES = [
    {
      name: "should not work with non-discriminated unions",
      input: `
type SimpleUnion = string | number;
const /*cursor*/x: SimpleUnion = "hello";
      `,
    },
    {
      name: "should not work with non-union types",
      input: `
type Simple = { name: string };
const /*cursor*/x: Simple = { name: "test" };
      `,
    },
    {
      name: "should not work with unions with no common discriminant",
      input: `
type Mixed = { a: string } | { b: number };
const /*cursor*/x: Mixed = { a: "test" };
      `,
    },
    {
      name: "should not work with empty unions",
      input: `
type Never = never;
const /*cursor*/x: Never = null as any;
      `,
    },
  ]

  for (const { name, input } of REFACTOR_NEGATIVE_TEST_CASES) {
    it(name, () => {
      const [inputCode, cursorPosition] = processInput(input)
      const enhancedService = createLanguageService(inputCode)

      const refactors = enhancedService.getApplicableRefactors(
        TEST_FILE_NAME,
        cursorPosition,
        {},
        undefined,
        undefined,
      )

      const exhaustiveMatchRefactor = refactors.find(
        (r) => r.name === "Generate exhaustive match",
      )
      expect(exhaustiveMatchRefactor).toBeUndefined()
    })
  }

  const COMPLETION_TEST_CASES = [
    {
      name: "should provide exhaustive match completion when typing identifier",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = { tag: "a" };
x/*cursor*/
      `,
      completion: `
if (x.tag === "a") {
  \${1}
} else if (x.tag === "b") {
  \${2}
} else {
  x satisfies never;
}
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = { tag: "a" };
if (x.tag === "a") {
  \\
} else if (x.tag === "b") {
  \\
} else {
  x satisfies never;
}
      `,
    },
  ]

  for (const { name, input, completion, output } of COMPLETION_TEST_CASES) {
    it(name, () => {
      const [inputCode, cursorPosition] = processInput(input)
      const enhancedService = createLanguageService(inputCode)
      const completions = enhancedService.getCompletionsAtPosition(
        TEST_FILE_NAME,
        cursorPosition,
        {},
      )
      expect(completions).toBeDefined()
      const exhaustiveCompletion = completions?.entries.find((entry) =>
        entry.name.includes("exhaustive match"),
      )
      expect(exhaustiveCompletion).toBeDefined()
      expect(exhaustiveCompletion?.isSnippet).toBe(true)
      expect(exhaustiveCompletion?.insertText?.trim()).toBe(completion.trim())

      // Test that the completion correctly replaces the identifier
      if (exhaustiveCompletion?.replacementSpan) {
        const replacementStart = exhaustiveCompletion.replacementSpan.start
        const replacementLength = exhaustiveCompletion.replacementSpan.length
        const snippetWithoutTabStops = completion.replace(
          /\\\$\{\\d+\}/g,
          "\\\\",
        )

        const resultCode =
          inputCode.slice(0, replacementStart) +
          snippetWithoutTabStops.trim() +
          inputCode.slice(replacementStart + replacementLength)

        const expectedCode = output.replace(/ \\\\\n/g, " \n")
        expect(resultCode.trim()).toBe(expectedCode.trim())
      }
    })
  }
})

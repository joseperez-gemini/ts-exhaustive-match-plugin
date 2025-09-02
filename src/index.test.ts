import {
  getCodeIndentationLevel,
  getExistingCodeIndentationSpaces,
  getTokenAtPosition,
  init,
} from "./plugin"

import assert from "assert"
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
  const CURSOR_POS_MARKER = "/*cursor pos*/"
  const CURSOR_END_MARKER = "/*cursor end*/"

  function processInput(
    input: string,
  ): [code: string, position: number | { pos: number; end: number }] {
    const trimmedInput = input.trim()

    // Check for range markers first
    const posIndex = trimmedInput.indexOf(CURSOR_POS_MARKER)
    const endIndex = trimmedInput.indexOf(CURSOR_END_MARKER)

    if (posIndex !== -1 && endIndex !== -1) {
      if (posIndex >= endIndex)
        throw new Error("cursor pos must come before cursor end")

      const code = trimmedInput
        .replace(CURSOR_POS_MARKER, "")
        .replace(CURSOR_END_MARKER, "")

      const adjustedEndIndex = endIndex - CURSOR_POS_MARKER.length

      return [code, { pos: posIndex, end: adjustedEndIndex }]
    }

    // Fall back to single cursor marker
    const code = trimmedInput.replace(CURSOR_MARKER, "")
    const position = trimmedInput.indexOf(CURSOR_MARKER)
    if (position === -1) throw new Error("Cursor marker not found in input")
    return [code, position]
  }

  const REFACTOR_BASE_TEST_CASES = [
    {
      name: "should work with const variable declarations",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const /*cursor*/x: Test = {} as Test;
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
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
      name: "should work with string literal unions",
      input: `
type Test = "a" | "b";
const /*cursor*/x: Test = "" as Test;
      `,
      output: `
type Test = "a" | "b";
const x: Test = "" as Test;
if (x === "a") {
  \\
} else if (x === "b") {
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
let /*cursor*/x: Test = {} as Test;
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
let x: Test = {} as Test;
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
const x: Test = {} as Test;
/*cursor*/x
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
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
const /*cursor*/result: Result<string, Error> = {} as Result<string, Error>;
      `,
      output: `
type Result<T, E> = 
  | { tag: "ok"; value: T }
  | { tag: "error"; error: E }
  | { tag: "loading" };
const result: Result<string, Error> = {} as Result<string, Error>;
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

  const REFACTOR_NARROWING_TEST_CASES = [
    {
      name: "should work with narrowed types after type guard",
      input: `
type Test = { tag: "a"; value: number } | { tag: "b"; value: string } | { tag: "c"; value: boolean };
const x: Test = {} as Test;
if (x.tag !== "c") {
  /*cursor*/x
}
      `,
      output: `
type Test = { tag: "a"; value: number } | { tag: "b"; value: string } | { tag: "c"; value: boolean };
const x: Test = {} as Test;
if (x.tag !== "c") {
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
  ]

  const ALTERNATIVE_TEST_HANDLING = [
    {
      name: "should preserve order of declaration of tags",
      input: `
type Test = { tag: "b" } | { tag: "a" };
const /*cursor*/x: Test = {} as Test;
      `,
      output: `
type Test = { tag: "b" } | { tag: "a" };
const x: Test = {} as Test;
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
      name: "should preserve order for plain string literal unions",
      input: `
type Test = "c" | "a" | "b";
const /*cursor*/x: Test = "" as Test;
      `,
      output: `
type Test = "c" | "a" | "b";
const x: Test = "" as Test;
if (x === "c") {
  \\
} else if (x === "a") {
  \\
} else if (x === "b") {
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
    {
      name: "should work with function expressions",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const func = function(/*cursor*/x: Test) {};
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
const func = function(x: Test) {
  if (x.tag === "a") {
    \\
  } else if (x.tag === "b") {
    \\
  } else {
    x satisfies never;
  }
};
      `,
    },
    {
      name: "should work with arrow functions",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const func = (/*cursor*/x: Test) => {};
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
const func = (x: Test) => {
  if (x.tag === "a") {
    \\
  } else if (x.tag === "b") {
    \\
  } else {
    x satisfies never;
  }
};
      `,
    },
    {
      name: "should work with method declarations",
      input: `
type Test = { tag: "a" } | { tag: "b" };
class MyClass {
  method(/*cursor*/x: Test) {}
}
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
class MyClass {
  method(x: Test) {
    if (x.tag === "a") {
      \\
    } else if (x.tag === "b") {
      \\
    } else {
      x satisfies never;
    }
  }
}
      `,
    },
    {
      name: "should work with async function declarations",
      input: `
type Test = { tag: "a" } | { tag: "b" };
async function handleAsync(/*cursor*/x: Test) {}
      `,
      output: `
type Test = { tag: "a" } | { tag: "b" };
async function handleAsync(x: Test) {
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
  ]

  for (const { name, input, output } of [
    ...REFACTOR_BASE_TEST_CASES,
    ...REFACTOR_NARROWING_TEST_CASES,
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
const /*cursor*/x: SimpleUnion = {} as SimpleUnion;
      `,
    },
    {
      name: "should not work with non-union types",
      input: `
type Simple = { name: string };
const /*cursor*/x: Simple = {} as Simple;
      `,
    },
    {
      name: "should not work with unions with no common discriminant",
      input: `
type Mixed = { a: string } | { b: number };
const /*cursor*/x: Mixed = {} as Mixed;
      `,
    },
    {
      name: "should not work with empty unions",
      input: `
type Never = never;
const /*cursor*/x: Never = null as any;
      `,
    },
    {
      name: "should not work with identifiers not in supported contexts",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
const y = /*cursor*/x + 1;
      `,
    },
    {
      name: "should not work with cursor ranges",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const /*cursor pos*/x: Test/*cursor end*/ = {} as Test;
      `,
    },
    {
      name: "should not work when cursor is outside an identifier",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} /*cursor*/as Test;
      `,
    },
    {
      name: "should not work with non-string literal discriminant",
      input: `
type Test = { tag: 0 } | { tag: 1 };
const /*cursor*/x: Test = {} as Test;
      `,
    },
    {
      name: "should not work with function declarations without body",
      input: `
type Test = { tag: "a" } | { tag: "b" };
declare function handleTest(/*cursor*/x: Test): void;
      `,
    },
    {
      name: "should not work with partially typed function without body",
      input: `
type Test = { tag: "a" } | { tag: "b" };
function handleTest(/*cursor*/x: Test)
      `,
    },
    {
      name: "should not work with single string literal",
      input: `
type Test = "single";
const /*cursor*/x: Test = "" as Test;
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

  // Base completion test cases - testing core functionality
  const COMPLETION_BASE_TEST_CASES = [
    {
      name: "should provide exhaustive match completion when typing identifier",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
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
const x: Test = {} as Test;
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
      name: "should provide exhaustive match completion when typing property access",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
x./*cursor*/
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
const x: Test = {} as Test;
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
      name: "should provide exhaustive match completion when typing discriminant prefix",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
x.t/*cursor*/
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
const x: Test = {} as Test;
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
      name: "should provide exhaustive match for plain string literal union",
      input: `
type Test = "a" | "b"
const x: Test = "" as Test
x/*cursor*/
      `,
      completion: `
if (x === "a") {
  \${1}
} else if (x === "b") {
  \${2}
} else {
  x satisfies never;
}
      `,
      output: `
type Test = "a" | "b"
const x: Test = "" as Test
if (x === "a") {
  \\
} else if (x === "b") {
  \\
} else {
  x satisfies never;
}
      `,
    },
  ]

  // Generate test cases for if statement contexts using both x. and x.t patterns

  const propertyAccessPrefixes = [
    { cursor: "x/*cursor*/", name: "plain identifier" },
    { cursor: "x./*cursor*/", name: "property access" },
    { cursor: "x.t/*cursor*/", name: "discriminant prefix" },
  ]

  const ifStatementContexts = [
    {
      template: "if (__CURSOR__",
      name: "incomplete if statement",
    },
    {
      template: "if (__CURSOR__)",
      name: "if statement with auto-completed closing paren",
    },
    {
      template: "if (__CURSOR__) {}",
      name: "if statement with empty braces",
    },
    {
      template: "if (__CURSOR__) {\n}",
      name: "if statement with multiline empty braces",
    },
  ]

  const COMPLETION_IF_STATEMENT_TEST_CASES = []
  for (const prefix of propertyAccessPrefixes) {
    for (const context of ifStatementContexts) {
      const contextInput = context.template.replace("__CURSOR__", prefix.cursor)
      COMPLETION_IF_STATEMENT_TEST_CASES.push({
        name: `should provide exhaustive match completion when typing ${prefix.name} in ${context.name}`,
        input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
${contextInput}
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
const x: Test = {} as Test;
if (x.tag === "a") {
  \\
} else if (x.tag === "b") {
  \\
} else {
  x satisfies never;
}
        `,
      })
    }
  }

  COMPLETION_IF_STATEMENT_TEST_CASES.push({
    name: `should provide exhaustive match completion when for if statements with unrelated content after them`,
    input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
if (x.t/*cursor*/)
console.log()
        `,
    completion: `
if (x.tag === "a") {
  \${1}
} else if (x.tag === "b") {
  \${2}
} else {
  x satisfies never;
}
\\
        `,
    output: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
if (x.tag === "a") {
  \\
} else if (x.tag === "b") {
  \\
} else {
  x satisfies never;
}
console.log()
        `,
  })

  const COMPLETION_NEGATIVE_TEST_CASES = [
    {
      name: "should not provide exhaustive match completion for non-discriminant prefix",
      input: `
type Test = { tag: "a"; prop: string } | { tag: "b"; prop: string };
const x: Test = {} as Test;
x.prop/*cursor*/
      `,
    },
    {
      name: "should not provide exhaustive match completion for unrelated prefix",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
x.foo/*cursor*/
      `,
    },
    {
      name: "should not provide exhaustive match completion for non-discriminated union in if statement",
      input: `
type SimpleUnion = string | number;
const x: SimpleUnion = {} as SimpleUnion;
if (x/*cursor*/
      `,
    },
    {
      name: "should not provide exhaustive match completion for non-union type in if statement",
      input: `
type Simple = { name: string };
const x: Simple = {} as Simple;
if (x/*cursor*/
      `,
    },
    {
      name: "should not provide exhaustive match completion for non-if/statement contexts",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
const result = x/*cursor*/ + 1;
      `,
    },
    {
      name: "should not provide exhaustive match completion for identifiers without parent",
      input: `
/*cursor*/x
      `,
    },
    {
      name: "should not provide exhaustive match completion for non-supported tokens",
      input: `
type Test = { tag: "a" } | { tag: "b" }/*cursor*/
      `,
    },
    {
      name: "should not provide exhaustive match completion for empty files",
      input: `
/*cursor*/
      `,
    },
    {
      name: "should not provide exhaustive match completion for property access on complex expressions",
      input: `
type Test = { tag: "a" } | { tag: "b" };
const x = { y: {} as Test };
(x.y)./*cursor*/
      `,
    },
    {
      name: "should not provide exhaustive match completion for single string literal",
      input: `
type Test = "single";
const x: Test = "" as Test;
x/*cursor*/
      `,
    },
    {
      name: "should not provide exhaustive match completion for property access on string literal union",
      input: `
type Test = "a" | "b";
const x: Test = "" as Test;
x./*cursor*/
      `,
    },
  ]

  // Type narrowing test cases
  const COMPLETION_NARROWING_TEST_CASES = [
    {
      name: "should provide narrowed completions when typing property access after type guard",
      input: `
type Test = { tag: "a"; value: number } | { tag: "b"; value: string } | { tag: "c"; value: boolean };
const x: Test = {} as Test;
if (x.tag !== "c") {
  x./*cursor*/
}
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
type Test = { tag: "a"; value: number } | { tag: "b"; value: string } | { tag: "c"; value: boolean };
const x: Test = {} as Test;
if (x.tag !== "c") {
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
  ]

  // Combine base cases with generated if statement cases and narrowing cases
  const COMPLETION_TEST_CASES = [
    ...COMPLETION_BASE_TEST_CASES,
    ...COMPLETION_IF_STATEMENT_TEST_CASES,
    ...COMPLETION_NARROWING_TEST_CASES,
  ]

  for (const { name, input, completion, output } of COMPLETION_TEST_CASES) {
    it(name, () => {
      const [inputCode, cursorPosition] = processInput(input)
      assert(typeof cursorPosition === "number")
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
      expect(exhaustiveCompletion?.insertText).toBe(
        completion.trim().replace(/\\\n/, "\n").replace(/\\$/, ""),
      )

      // Test that the completion correctly replaces the identifier
      if (
        exhaustiveCompletion?.replacementSpan !== undefined &&
        exhaustiveCompletion?.insertText !== undefined
      ) {
        const replacement = exhaustiveCompletion.replacementSpan
        const snippetWithoutTabStops = exhaustiveCompletion.insertText.replace(
          /\$\{\d+\}/g,
          "",
        )

        // Get the source file to calculate indentation
        const sourceFile = ts.createSourceFile(
          TEST_FILE_NAME,
          inputCode,
          ts.ScriptTarget.Latest,
          true,
        )

        // Find the node at the replacement position to get indentation level
        const nodeAtPosition = getTokenAtPosition(
          ts,
          sourceFile,
          replacement.start,
        )
        const indentLevel = nodeAtPosition
          ? getCodeIndentationLevel(ts, nodeAtPosition)
          : 0
        const baseIndent = "  ".repeat(indentLevel)

        // Apply indentation to each line of the snippet
        const indentedSnippet = snippetWithoutTabStops
          .split("\n")
          .map((line, index) => {
            // Don't indent empty lines
            if (line.length === 0) return line
            // First line doesn't need indentation if it's continuing the current line
            if (
              index === 0 &&
              replacement.start > 0 &&
              inputCode[replacement.start - 1] !== "\n"
            ) {
              return line
            }
            return baseIndent + line
          })
          .join("\n")

        const resultCode =
          inputCode.slice(0, replacement.start) +
          indentedSnippet +
          inputCode.slice(replacement.start + replacement.length)

        const expectedCode = output.replace(/ \\\n/g, " \n")
        expect(resultCode.trim()).toBe(expectedCode.trim())
      }
    })
  }

  for (const { name, input } of COMPLETION_NEGATIVE_TEST_CASES) {
    it(name, () => {
      const [inputCode, cursorPosition] = processInput(input)
      assert(typeof cursorPosition === "number")
      const enhancedService = createLanguageService(inputCode)
      const completions = enhancedService.getCompletionsAtPosition(
        TEST_FILE_NAME,
        cursorPosition,
        {},
      )

      const exhaustiveCompletion = completions?.entries.find((entry) =>
        entry.name.includes("exhaustive match"),
      )
      expect(exhaustiveCompletion).toBeUndefined()
    })
  }

  // Tests for plugin utility functions
  describe("plugin utility functions", () => {
    const UTILITY_TEST_CASES = [
      {
        name: "should handle getExistingCodeIndentationSpaces with tabs",
        input: `
type Test = { tag: "a" } | { tag: "b" };
		const x: Test = {} as Test;
        `,
      },
      {
        name: "should handle getTokenAtPosition",
        input: `
type Test = { tag: "a" } | { tag: "b" };
const x: Test = {} as Test;
        `,
        cursorPos: 50,
      },
      {
        name: "should handle getExistingCodeIndentationSpaces with mixed indentation",
        input: `
type Test = { tag: "a" } | { tag: "b" };
	 x const x: Test = {} as Test;
        `,
      },
      {
        name: "should handle getCodeIndentationLevel",
        input: `
type Test = { tag: "a" } | { tag: "b" };
class MyClass {
  method(x: Test) {
    const y = x;
  }
}
        `,
      },
    ]

    for (const { name, input, cursorPos } of UTILITY_TEST_CASES) {
      it(name, () => {
        const inputCode = input.trim()
        const sourceFile = ts.createSourceFile(
          TEST_FILE_NAME,
          inputCode,
          ts.ScriptTarget.Latest,
          true,
        )

        if (name.includes("getExistingCodeIndentationSpaces")) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const varStatement = sourceFile.statements[1] as ts.VariableStatement
          if (varStatement !== undefined) {
            const spaces = getExistingCodeIndentationSpaces(
              ts,
              sourceFile,
              varStatement,
            )
            expect(spaces).toBeGreaterThanOrEqual(0)
          }
        }

        if (name.includes("getTokenAtPosition")) {
          const position = cursorPos ?? 0
          if (position !== 0) {
            const token = getTokenAtPosition(ts, sourceFile, position)
            expect(token).toBeDefined()
          }
        }

        if (name.includes("getCodeIndentationLevel")) {
          const classDecl = sourceFile.statements[1]
          assert(classDecl && ts.isClassDeclaration(classDecl))
          if (classDecl?.members[0]) {
            const method = classDecl.members[0]
            assert(ts.isMethodDeclaration(method))
            if (method.body?.statements[0]) {
              const level = getCodeIndentationLevel(
                ts,
                method.body.statements[0],
              )
              expect(level).toBeGreaterThan(0)
            }
          }
        }
      })
    }
  })
})

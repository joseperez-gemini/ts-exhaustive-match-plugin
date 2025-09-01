import type * as ts from "typescript/lib/tsserverlibrary"

type TS = typeof ts

const DEBUG: "console" | "ts-logger" | undefined = "console"

let logger: (...args: unknown[]) => void =
  DEBUG === "console"
    ? console.log
    : () => {
        /* Do nothing, if it is ts-logger then it will be replaced later */
      }

export function log(...args: unknown[]) {
  logger(...args)
}

export function setTSLogger(newLogger: typeof logger) {
  if (DEBUG === "ts-logger") {
    logger = newLogger
  }
}

type SimplifiedNode = {
  type: string
  text: string | undefined
  start: number | undefined
  end: number | undefined
  hasCursor: boolean
  children: SimplifiedNode[]
}
export function simplifyNode(
  typescript: TS,
  node: ts.Node,
  cursorPos: number | undefined = undefined,
): SimplifiedNode {
  const type =
    Object.entries(typescript.SyntaxKind)
      .filter(([, v]) => v === node.kind)
      .map(([k]) => k)
      .find((k) => !k.startsWith("First") && !k.startsWith("Last")) ??
    typescript.SyntaxKind[node.kind]

  let text: string | undefined
  let start: number | undefined
  let end: number | undefined

  try {
    text = node.kind === typescript.SyntaxKind.SourceFile ? "" : node.getText()
  } catch {
    const dummySourceFile = typescript.createSourceFile(
      "dummy.ts",
      "",
      typescript.ScriptTarget.Latest,
      false,
      typescript.ScriptKind.TS,
    )
    const printer = typescript.createPrinter({
      newLine: typescript.NewLineKind.LineFeed,
      removeComments: false,
      omitTrailingSemicolon: false,
    })
    text = printer.printNode(
      typescript.EmitHint.Unspecified,
      node,
      dummySourceFile,
    )
  }
  try {
    start = node.getStart()
    end = node.getEnd()
  } catch {}

  const hasCursor =
    cursorPos !== undefined &&
    start !== undefined &&
    end !== undefined &&
    cursorPos >= start &&
    cursorPos < end

  const children: SimplifiedNode[] = []
  typescript.forEachChild(node, (child) => {
    children.push(simplifyNode(typescript, child, cursorPos))
  })

  return {
    type,
    text,
    start,
    end,
    hasCursor,
    children,
  }
}
export function pprintSimplifiedNode(node: SimplifiedNode, indent = 0) {
  const pre = " ".repeat(indent * 2) + (node.hasCursor ? "\x1b[1m" : "")
  const post = node.hasCursor ? "\x1b[0m" : ""
  const escapedText =
    node.text === undefined
      ? ""
      : node.text.includes("\n")
        ? JSON.stringify(node.text)
        : node.text
  const positionText =
    node.start !== undefined && node.end !== undefined
      ? ` [${node.start}-${node.end}]`
      : ""
  logger(`${pre}${node.type}${positionText}: ${escapedText}${post}`)
  for (const child of node.children) {
    pprintSimplifiedNode(child, indent + 1)
  }
}
export function getCodeIndentationLevel(typescript: TS, node: ts.Node): number {
  let level = 0
  let current = node.parent

  while (current !== undefined) {
    // Check if this parent actually contributes to indentation
    if (shouldIndentChildren(typescript, current)) {
      level++
    }
    current = current.parent
  }

  return level
}

export function getExistingCodeIndentationSpaces(
  typescript: TS,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): number {
  // Get the line start position for the node
  const nodeStart = node.getStart()
  const lineStart = typescript.getLineAndCharacterOfPosition(
    sourceFile,
    nodeStart,
  )
  const lineStartPos = typescript.getPositionOfLineAndCharacter(
    sourceFile,
    lineStart.line,
    0,
  )

  // Get the text from line start to node start
  const sourceText = sourceFile.text
  const linePrefix = sourceText.substring(lineStartPos, nodeStart)

  // Count leading spaces
  let spaceCount = 0
  for (const char of linePrefix) {
    if (char === " ") {
      spaceCount++
    } else if (char === "\t") {
      // Treat tabs as equivalent to some number of spaces (commonly 2 or 4)
      // For now treating as 2 spaces but this could be configurable
      spaceCount += 2
    } else {
      break
    }
  }

  return spaceCount
}
function shouldIndentChildren(typescript: TS, node: ts.Node): boolean {
  return (
    // Blocks always indent their content
    typescript.isBlock(node) ||
    typescript.isModuleBlock(node) ||
    typescript.isCaseBlock(node) ||
    // Object/array literals indent their content
    // These we avoid for now, we just handle statements
    // typescript.isObjectLiteralExpression(node) ||
    // typescript.isArrayLiteralExpression(node) ||
    // Class/interface/enum bodies
    typescript.isClassDeclaration(node) ||
    typescript.isInterfaceDeclaration(node) ||
    typescript.isEnumDeclaration(node) ||
    // Switch cases
    typescript.isCaseClause(node) ||
    typescript.isDefaultClause(node)
  )

  // Note: ExpressionStatement, IfStatement, VariableStatement, etc.
  // do NOT add indentation to their children
}
export function getTokenAtPosition(
  typescript: TS,
  node: ts.Node,
  position: number,
): ts.Node | undefined {
  if (position < node.getStart() || node.getEnd() <= position) {
    return undefined
  }
  return (
    typescript.forEachChild(node, (child) => {
      return getTokenAtPosition(typescript, child, position)
    }) ?? node
  )
}

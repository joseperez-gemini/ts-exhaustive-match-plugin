/* v8 ignore start -- @preserve */
import type * as ts from "typescript/lib/tsserverlibrary"

type TS = typeof ts

let logger: (...args: unknown[]) => void = console.log
export function log(...args: unknown[]) {
  logger(...args)
}

let skipTSLogger = false
export function setSkipTSLogger(skip: boolean) {
  skipTSLogger = skip
}

export function setTSLogger(newLogger: typeof logger) {
  if (!skipTSLogger) {
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

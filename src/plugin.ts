import { setTSLogger } from "./utils"
import assert from "assert"
import type * as ts from "typescript/lib/tsserverlibrary"

export type TS = typeof ts

export function init(modules: { typescript: TS }): ts.server.PluginModule {
  const typescript = modules.typescript

  function create(info: ts.server.PluginCreateInfo) {
    /* v8 ignore start -- @preserve */
    /* eslint-disable */
    const proxy: ts.LanguageService = Object.create(null)
    for (const k of Object.keys(
      info.languageService,
    ) as (keyof ts.LanguageService)[]) {
      const x = info.languageService[k]!
      ;(proxy as any)[k] = (...args: unknown[]) =>
        (x as any).apply(info.languageService, args)
    }
    setTSLogger((...args) => {
      info.project?.projectService?.logger?.info(
        "[ts-exhaustive-match] " +
          args
            .map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)))
            .join(" "),
      )
    })
    /* eslint-enable */
    /* v8 ignore stop -- @preserve */

    function getLSContest(fileName: string) {
      const sourceFile = info.languageService
        .getProgram()
        ?.getSourceFile(fileName)
      assert(sourceFile !== undefined)

      const typeChecker = info.languageService.getProgram()?.getTypeChecker()
      assert(typeChecker !== undefined)
      return { sourceFile, typeChecker }
    }

    proxy.getApplicableRefactors = (
      fileName,
      positionOrRange,
      preferences,
      triggerReason,
      kind,
    ) => {
      const prior = info.languageService.getApplicableRefactors(
        fileName,
        positionOrRange,
        preferences,
        triggerReason,
        kind,
      )
      if (typeof positionOrRange !== "number") return prior

      const { sourceFile, typeChecker } = getLSContest(fileName)

      const refactorCase = getRefactorCase(
        typescript,
        sourceFile,
        positionOrRange,
      )
      if (refactorCase === undefined) return prior

      const discriminatedUnionContext = getExhaustiveCaseGenerationContext(
        typescript,
        typeChecker,
        refactorCase.identifier,
      )
      if (discriminatedUnionContext === undefined) return prior

      const refactor: ts.ApplicableRefactorInfo = {
        name: "Generate exhaustive match",
        description: "Generate exhaustive if-else pattern match",
        actions: [
          {
            name: "generateExhaustiveMatch",
            description: "Generate exhaustive if-else pattern match",
            kind: "refactor.rewrite.exhaustive-match",
          },
        ],
      }
      return [...prior, refactor]
    }

    proxy.getEditsForRefactor = (
      fileName,
      formatOptions,
      positionOrRange,
      refactorName,
      actionName,
      preferences,
    ) => {
      /* v8 ignore start -- @preserve */
      // We don't care for refactors not involving this action
      if (actionName !== "generateExhaustiveMatch") {
        return info.languageService.getEditsForRefactor(
          fileName,
          formatOptions,
          positionOrRange,
          refactorName,
          actionName,
          preferences,
        )
      }
      /* v8 ignore stop -- @preserve */

      assert(typeof positionOrRange === "number")
      const { sourceFile, typeChecker } = getLSContest(fileName)

      const refactorCase = getRefactorCase(
        typescript,
        sourceFile,
        positionOrRange,
      )
      assert(refactorCase !== undefined)

      const discriminatedUnionContext = getExhaustiveCaseGenerationContext(
        typescript,
        typeChecker,
        // TODO: We should use the expression itself, not only its symbol name
        // which only works for identifiers
        refactorCase.identifier,
      )
      assert(discriminatedUnionContext !== undefined)
      const { targetUnion } = discriminatedUnionContext

      const ast = createExhaustiveMatchAST(
        typescript,
        refactorCase.identifier.text,
        targetUnion.discriminant,
        [...targetUnion.alternatives],
      )

      let newText = printASTWithPlaceholderReplacement(
        typescript,
        sourceFile,
        ast,
        {
          isSnippet: false,
          allLinesIndent:
            getCodeIndentationLevel(typescript, refactorCase.identifier) +
            (refactorCase.tag === "parameter" ? 1 : 0),
          existingIndentFirstLine:
            refactorCase.tag === "expressionStatement"
              ? getExistingCodeIndentationSpaces(
                  typescript,
                  sourceFile,
                  refactorCase.identifier,
                )
              : 0,
        },
      )

      let replacementSpan: {
        start: number
        length: number
      }
      if (refactorCase.tag === "parameter") {
        const body = refactorCase.body
        newText = "\n" + newText
        replacementSpan = {
          start: body.getStart() + 1,
          length: 0,
        }
        if (body.getStart() + 2 === body.getEnd()) {
          const fnIndent = getExistingCodeIndentationSpaces(
            typescript,
            sourceFile,
            refactorCase.node,
          )
          newText += "\n" + " ".repeat(fnIndent)
        }
      } else if (refactorCase.tag === "variableDeclaration") {
        newText = "\n" + newText
        replacementSpan = {
          start: refactorCase.node.getEnd() + 1,
          length: 0,
        }
      } else if (refactorCase.tag === "expressionStatement") {
        replacementSpan = {
          start: refactorCase.node.getStart(),
          length: refactorCase.node.getEnd() - refactorCase.node.getStart(),
        }
        /* v8 ignore next 3 -- @preserve */
      } else {
        replacementSpan = refactorCase satisfies never
      }

      return {
        edits: [
          {
            fileName,
            textChanges: [
              {
                span: replacementSpan,
                newText,
              },
            ],
          },
        ],
      }
    }

    proxy.getCompletionsAtPosition = (fileName, position, options) => {
      const prior = info.languageService.getCompletionsAtPosition(
        fileName,
        position,
        options,
      )
      const { sourceFile, typeChecker } = getLSContest(fileName)

      const comp = getCompletionCase(typescript, sourceFile, position)
      if (comp === undefined) return prior

      const target =
        comp.sub.tag === "identifier" ? comp.sub.node : comp.sub.node.expression

      const discriminatedUnionContext = getExhaustiveCaseGenerationContext(
        typescript,
        typeChecker,
        target,
      )
      if (discriminatedUnionContext === undefined) return undefined
      const { targetUnion, targetSymbol } = discriminatedUnionContext

      // Bail out when prop access is not a prefix of the discriminant
      if (
        comp.sub.tag === "propAccess" &&
        !targetUnion.discriminant.startsWith(comp.sub.node.name.text)
      ) {
        return prior
      }

      // TODO: We should use the expression itself, not only its symbol name
      // which only works for identifiers
      const ast = createExhaustiveMatchAST(
        typescript,
        targetSymbol.name,
        targetUnion.discriminant,
        [...targetUnion.alternatives],
      )

      let snippetText = printASTWithPlaceholderReplacement(
        typescript,
        sourceFile,
        ast,
        {
          isSnippet: true,
        },
      )
      const replacementSpan = {
        start: comp.node.getStart(),
        length: comp.node.getEnd() - comp.node.getStart(),
      }

      if (
        comp.tag === "ifStatement" &&
        !(
          comp.node.thenStatement.getStart() ===
            comp.node.thenStatement.getEnd() ||
          (typescript.isBlock(comp.node.thenStatement) &&
            comp.node.thenStatement.statements.length === 0)
        )
      ) {
        replacementSpan.length =
          comp.node.thenStatement.getStart() - comp.node.getStart()
        snippetText += "\n"
      }

      const customCompletion = {
        name: `${targetSymbol.name}.${targetUnion.discriminant} (exhaustive match)`,
        kind: typescript.ScriptElementKind.unknown,
        kindModifiers: "",
        sortText: "0", // High priority
        insertText: snippetText,
        isSnippet: true as const,
        replacementSpan,
      }

      if (prior) {
        prior.entries = [customCompletion, ...prior.entries]
        /* v8 ignore start -- @preserve */
      } else {
        // It's very unlikely we'll get here, but we add it for completeness
        // without coverage
        return {
          isGlobalCompletion: false,
          isMemberCompletion: false,
          isNewIdentifierLocation: false,
          entries: [customCompletion],
        }
      }
      /* v8 ignore stop -- @preserve */

      return prior
    }

    return proxy
  }
  return { create }
}

type RefactorCase =
  | {
      tag: "parameter"
      node: ts.FunctionLikeDeclaration
      body: ts.FunctionBody
      identifier: ts.Identifier
    }
  | {
      tag: "variableDeclaration"
      node: ts.VariableStatement
      identifier: ts.Identifier
    }
  | {
      tag: "expressionStatement"
      node: ts.ExpressionStatement
      identifier: ts.Identifier
    }

function getRefactorCase(
  typescript: TS,
  sourceFile: ts.SourceFile,
  position: number,
): RefactorCase | undefined {
  const identifier = getTokenAtPosition(typescript, sourceFile, position)
  if (identifier === undefined || !typescript.isIdentifier(identifier))
    return undefined

  const parent = identifier.parent
  assert(parent !== undefined)
  if (typescript.isParameter(parent)) {
    // Get the function that contains this parameter
    const functionNode = parent.parent
    if (
      typescript.isFunctionDeclaration(functionNode) ||
      typescript.isFunctionExpression(functionNode) ||
      typescript.isArrowFunction(functionNode) ||
      typescript.isMethodDeclaration(functionNode)
    ) {
      // Don't offer refactor for functions without bodies, lambdas or function
      // declarations
      if (
        functionNode.body === undefined ||
        typescript.isExpression(functionNode.body) ||
        (typescript.isFunctionDeclaration(functionNode) &&
          (functionNode.modifiers?.some(
            (mod) => mod.kind === typescript.SyntaxKind.DeclareKeyword,
          ) ??
            false))
      ) {
        return undefined
      }

      return {
        tag: "parameter",
        identifier,
        node: functionNode,
        body: functionNode.body,
      }
    }
  } else if (typescript.isVariableDeclaration(parent)) {
    const varDeclList = parent.parent
    if (typescript.isVariableDeclarationList(varDeclList)) {
      const varStatement = varDeclList.parent
      if (typescript.isVariableStatement(varStatement)) {
        return {
          tag: "variableDeclaration",
          identifier,
          node: varStatement,
        }
      }
    }
  } else if (typescript.isExpressionStatement(parent)) {
    return {
      tag: "expressionStatement",
      identifier,
      node: parent,
    }
  }

  return undefined
}

type ExprCompletionCase =
  | {
      tag: "identifier"
      node: ts.Identifier
    }
  | {
      tag: "propAccess"
      node: ts.PropertyAccessExpression
    }
type CompletionCase =
  | {
      tag: "statement"
      node: ts.ExpressionStatement
      sub: ExprCompletionCase
    }
  | {
      tag: "ifStatement"
      node: ts.IfStatement
      sub: ExprCompletionCase
    }

function getVarCompletionCase(
  typescript: TS,
  sourceFile: ts.SourceFile,
  position: number,
): ExprCompletionCase | undefined {
  const prevPos = position - 1
  if (prevPos < 0) return undefined

  const prevToken = getTokenAtPosition(typescript, sourceFile, prevPos)
  assert(prevToken !== undefined)

  if (typescript.isIdentifier(prevToken)) {
    const parent = prevToken.parent
    // TODO: Handle property chains
    if (parent !== undefined && typescript.isPropertyAccessExpression(parent)) {
      return {
        tag: "propAccess",
        node: parent,
      }
    } else {
      return {
        tag: "identifier",
        node: prevToken,
      }
    }
  } else if (typescript.isPropertyAccessExpression(prevToken)) {
    return {
      tag: "propAccess",
      node: prevToken,
    }
  } else {
    return undefined
  }
}

function getCompletionCase(
  typescript: TS,
  sourceFile: ts.SourceFile,
  position: number,
): CompletionCase | undefined {
  const varCase = getVarCompletionCase(typescript, sourceFile, position)
  if (varCase === undefined) return undefined

  const varCaseParent = varCase.node.parent
  assert(varCaseParent !== undefined)

  if (typescript.isIfStatement(varCaseParent)) {
    return {
      tag: "ifStatement",
      node: varCaseParent,
      sub: varCase,
    }
  } else if (typescript.isExpressionStatement(varCaseParent)) {
    return {
      tag: "statement",
      node: varCaseParent,
      sub: varCase,
    }
  } else {
    return undefined
  }
}

function getExhaustiveCaseGenerationContext(
  typescript: TS,
  typeChecker: ts.TypeChecker,
  node: ts.Node,
) {
  const narrowedTargetType = typeChecker.getTypeAtLocation(node)
  const targetUnion = getDiscriminatedUnionFromType(
    typescript,
    typeChecker,
    narrowedTargetType,
  )
  if (targetUnion === undefined) return undefined

  const targetSymbol = typeChecker.getSymbolAtLocation(node)
  if (targetSymbol === undefined) return undefined

  const declarationType = getSourceDeclarationType(
    typescript,
    targetSymbol,
    typeChecker,
  )
  assert(declarationType !== undefined)

  const declarationUnion = getDiscriminatedUnionFromType(
    typescript,
    typeChecker,
    declarationType,
    { preserveSourceOrder: true },
  )
  assert(declarationUnion !== undefined)

  const declSortedCases = [...declarationUnion.alternatives]
  const sortedCases = [...targetUnion.alternatives].sort(
    (a, b) => declSortedCases.indexOf(a) - declSortedCases.indexOf(b),
  )

  return {
    targetSymbol,
    targetUnion: {
      ...targetUnion,
      alternatives: new Set(sortedCases),
    } satisfies DiscriminatedUnionInfo,
  }
}

function isUnionType(typescript: TS, type: ts.Type): type is ts.UnionType {
  return (type.flags & typescript.TypeFlags.Union) !== 0
}

function isObjectType(typescript: TS, type: ts.Type): type is ts.ObjectType {
  return (type.flags & typescript.TypeFlags.Object) !== 0
}

function isStringLiteral(
  typescript: TS,
  type: ts.Type,
): type is ts.StringLiteralType {
  return (type.flags & typescript.TypeFlags.StringLiteral) !== 0
}

type DiscriminatedUnionInfo = {
  discriminant: "tag"
  alternatives: Set<string>
}
function getDiscriminatedUnionFromType(
  typescript: TS,
  typeChecker: ts.TypeChecker,
  type: ts.Type,
  options?: { preserveSourceOrder?: boolean },
): DiscriminatedUnionInfo | undefined {
  const { preserveSourceOrder = false } = options ?? {}
  if (!isUnionType(typescript, type)) return

  const alternativesWithPositions: { value: string; position: number }[] = []

  // TODO: Auto-detect discriminant name
  for (const subtype of type.types) {
    if (!isObjectType(typescript, subtype)) return
    let foundDiscriminant = false
    for (const prop of typeChecker.getPropertiesOfType(subtype)) {
      if (prop.name !== "tag") continue
      const propType = typeChecker.getTypeOfSymbol(prop)
      if (!isStringLiteral(typescript, propType)) return

      // Get source position if needed for ordering
      let position = 0
      if (preserveSourceOrder && prop.valueDeclaration) {
        position = prop.valueDeclaration.getStart()
      }

      alternativesWithPositions.push({
        value: propType.value,
        position,
      })
      foundDiscriminant = true
    }
    if (!foundDiscriminant) return
  }

  // Sort by source position if requested
  if (preserveSourceOrder) {
    alternativesWithPositions.sort((a, b) => a.position - b.position)
  }

  // Convert to Set maintaining order
  const alternatives = new Set(alternativesWithPositions.map((a) => a.value))

  return {
    discriminant: "tag",
    alternatives,
  }
}

function getSourceDeclarationType(
  typescript: TS,
  symbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
): ts.Type | undefined {
  assert(symbol.declarations?.[0])
  // Get the declared type from source for tag ordering purposes
  const decl = symbol.declarations[0]
  let declaredType: ts.Type | undefined
  if (
    (typescript.isVariableDeclaration(decl) || typescript.isParameter(decl)) &&
    decl.type
  ) {
    const nodeType = typeChecker.getTypeFromTypeNode(decl.type)
    if ((nodeType.flags & typescript.TypeFlags.Union) !== 0) {
      declaredType = nodeType
    }
  }
  return declaredType
}

function createExhaustiveMatchAST(
  typescript: TS,
  variableName: string,
  discriminantProperty: string,
  cases: string[],
): ts.IfStatement {
  function createCondition(tagValue: string) {
    return typescript.factory.createBinaryExpression(
      typescript.factory.createPropertyAccessExpression(
        typescript.factory.createIdentifier(variableName),
        discriminantProperty,
      ),
      typescript.SyntaxKind.EqualsEqualsEqualsToken,
      typescript.factory.createStringLiteral(tagValue),
    )
  }

  function createCaseBlock(index: number) {
    return typescript.factory.createBlock(
      [
        typescript.factory.createExpressionStatement(
          typescript.factory.createIdentifier(
            `__SNIPPET_PLACEHOLDER_${index + 1}__`,
          ),
        ),
      ],
      true,
    )
  }

  function createNeverBlock() {
    return typescript.factory.createBlock(
      [
        typescript.factory.createExpressionStatement(
          typescript.factory.createSatisfiesExpression(
            typescript.factory.createIdentifier(variableName),
            typescript.factory.createKeywordTypeNode(
              typescript.SyntaxKind.NeverKeyword,
            ),
          ),
        ),
      ],
      true,
    )
  }

  // Build the if-else chain from the end backwards
  let statement: ts.Statement = createNeverBlock()
  for (let i = cases.length - 1; i >= 0; i--) {
    statement = typescript.factory.createIfStatement(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      createCondition(cases[i]!),
      createCaseBlock(i),
      statement,
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return statement as ts.IfStatement
}

function printASTWithPlaceholderReplacement(
  typescript: TS,
  sourceFile: ts.SourceFile,
  astNode: ts.Node,
  options: {
    isSnippet: boolean
    allLinesIndent?: number
    existingIndentFirstLine?: number
  },
): string {
  const { isSnippet, allLinesIndent = 0, existingIndentFirstLine = 0 } = options
  const printer = typescript.createPrinter({
    newLine: typescript.NewLineKind.LineFeed,
    removeComments: false,
    omitTrailingSemicolon: false,
  })

  let formattedCode = printer.printNode(
    typescript.EmitHint.Unspecified,
    astNode,
    sourceFile,
  )

  if (isSnippet) {
    formattedCode = formattedCode.replace(
      /__SNIPPET_PLACEHOLDER_(\d+)__;?/g,
      // eslint-disable-next-line no-template-curly-in-string
      "${$1}",
    )
  } else {
    formattedCode = formattedCode.replace(
      /__SNIPPET_PLACEHOLDER_(\d+)__;?/g,
      "",
    )
  }

  formattedCode = formattedCode.replace(/^(    )+/gm, (match) => {
    const spaceCount = match.length
    const indentLevel = spaceCount / 4
    return "  ".repeat(indentLevel)
  })
  formattedCode = formattedCode.replace(/}\s*\n(\s*)else if/g, "} else if")
  formattedCode = formattedCode.replace(/}\s*\n(\s*)else \{/g, "} else {")

  // Apply base indentation to all lines at the end
  if (allLinesIndent > 0 || existingIndentFirstLine > 0) {
    const baseIndent = "  ".repeat(allLinesIndent)

    formattedCode = formattedCode
      .split("\n")
      .map((line, index) => {
        // For the first line, subtract the existing indent since it's already there
        if (index === 0 && existingIndentFirstLine > 0) {
          const spacesToAdd = Math.max(
            0,
            allLinesIndent * 2 - existingIndentFirstLine,
          )
          return " ".repeat(spacesToAdd) + line
        }
        // Use regular indentation for other lines
        return baseIndent + line
      })
      .join("\n")
  }

  return formattedCode
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

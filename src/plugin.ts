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

    function getLSContext(fileName: string) {
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
      let position: number
      if (typeof positionOrRange === "number") {
        position = positionOrRange
      } else if (positionOrRange.pos === positionOrRange.end) {
        position = positionOrRange.pos
      } else {
        return prior
      }

      const { sourceFile, typeChecker } = getLSContext(fileName)

      const refactorCase = getRefactorCase(typescript, sourceFile, position)
      if (refactorCase === undefined) return prior

      const discriminatedUnionContext = getExhaustiveCaseGenerationContext(
        typescript,
        typeChecker,
        refactorCase.identifier,
      )
      if (discriminatedUnionContext === undefined) return prior
      const { targetUnion } = discriminatedUnionContext

      // Don't offer refactor when type is already fully narrowed
      if (targetUnion.alternatives.size === 1) {
        return prior
      }

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
      const prior = info.languageService.getEditsForRefactor(
        fileName,
        formatOptions,
        positionOrRange,
        refactorName,
        actionName,
        preferences,
      )
      /* v8 ignore start -- @preserve */
      // We don't care for refactors not involving this action
      if (actionName !== "generateExhaustiveMatch") return prior
      /* v8 ignore stop -- @preserve */

      let position: number
      if (typeof positionOrRange === "number") {
        position = positionOrRange
      } else if (positionOrRange.pos === positionOrRange.end) {
        position = positionOrRange.pos
        /* v8 ignore start -- @preserve */
        // We validated above that we receive a number or a same range position
      } else {
        return prior
      }
      /* v8 ignore stop -- @preserve */

      const { sourceFile, typeChecker } = getLSContext(fileName)

      const refactorCase = getRefactorCase(typescript, sourceFile, position)
      assert(refactorCase !== undefined)

      const discriminatedUnionContext = getExhaustiveCaseGenerationContext(
        typescript,
        typeChecker,
        // TODO: We should use the expression itself, not only its symbol name
        // which only works for identifiers
        refactorCase.identifier,
      )
      assert(discriminatedUnionContext !== undefined)
      const { targetUnion, targetSymbol } = discriminatedUnionContext

      const compare = ((): ExhaustiveMatchLeftCompare => {
        if (targetUnion.tag === "discriminated") {
          return {
            tag: "prop-access",
            variableName: targetSymbol.name,
            discriminantProperty: targetUnion.discriminant,
          }
        } else if (targetUnion.tag === "literal-union") {
          return {
            tag: "identifier",
            variableName: targetSymbol.name,
          }
          /* v8 ignore next 3 -- @preserve */
        } else {
          return targetUnion satisfies never
        }
      })()
      const ast = createExhaustiveMatchAST(typescript, compare, [
        ...targetUnion.alternatives,
      ])

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

    proxy.getCodeFixesAtPosition = (
      fileName,
      start,
      end,
      errorCodes,
      formatOptions,
      preferences,
    ) => {
      const prior = info.languageService.getCodeFixesAtPosition(
        fileName,
        start,
        end,
        errorCodes,
        formatOptions,
        preferences,
      )

      const { sourceFile, typeChecker } = getLSContext(fileName)
      const satisfiesNeverStructure = getSatisfiesNeverStructure(
        typescript,
        sourceFile,
        start,
      )
      if (satisfiesNeverStructure === undefined) return prior
      const { identifier, elseStatement } = satisfiesNeverStructure

      const discriminatedUnionContext = getExhaustiveCaseGenerationContext(
        typescript,
        typeChecker,
        identifier,
      )
      if (discriminatedUnionContext === undefined) return prior
      const { targetUnion } = discriminatedUnionContext

      // Generate the comparison logic
      const compare = ((): ExhaustiveMatchLeftCompare => {
        if (targetUnion.tag === "discriminated") {
          return {
            tag: "prop-access",
            variableName: identifier.text,
            discriminantProperty: targetUnion.discriminant,
          }
        } else if (targetUnion.tag === "literal-union") {
          return {
            tag: "identifier",
            variableName: identifier.text,
          }
          /* v8 ignore next 3 */
        } else {
          return targetUnion satisfies never
        }
      })()

      const ast = createExhaustiveMatchAST(typescript, compare, [
        ...targetUnion.alternatives,
      ])

      const newText = printASTWithPlaceholderReplacement(
        typescript,
        sourceFile,
        ast,
        {
          isSnippet: false,
          allLinesIndent: getCodeIndentationLevel(typescript, elseStatement),
        },
      ).trimStart()

      const insertionPoint = {
        start: elseStatement.getStart(),
        length: elseStatement.getEnd() - elseStatement.getStart(),
      }

      const quickFix: ts.CodeFixAction = {
        fixName: "addMissingCases",
        description: `Add missing cases: ${[...targetUnion.alternatives].join(", ")}`,
        changes: [
          {
            fileName,
            textChanges: [
              {
                span: insertionPoint,
                newText,
              },
            ],
          },
        ],
      }

      return [...prior, quickFix]
    }

    proxy.getCompletionsAtPosition = (fileName, position, options) => {
      const prior = info.languageService.getCompletionsAtPosition(
        fileName,
        position,
        options,
      )
      const { sourceFile, typeChecker } = getLSContext(fileName)

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
        targetUnion.tag === "discriminated" &&
        comp.sub.tag === "propAccess" &&
        !targetUnion.discriminant.startsWith(comp.sub.node.name.text)
      ) {
        return prior
      }

      // Bail out when trying to access properties on string literal unions
      if (
        targetUnion.tag === "literal-union" &&
        comp.sub.tag === "propAccess"
      ) {
        return prior
      }

      // Bail out when there's only one alternative (type is already fully narrowed)
      if (targetUnion.alternatives.size === 1) {
        return prior
      }

      const compare = ((): ExhaustiveMatchLeftCompare => {
        if (targetUnion.tag === "discriminated") {
          return {
            tag: "prop-access",
            variableName: targetSymbol.name,
            discriminantProperty: targetUnion.discriminant,
          }
        } else if (targetUnion.tag === "literal-union") {
          return {
            tag: "identifier",
            variableName: targetSymbol.name,
          }
          /* v8 ignore next 3 */
        } else {
          return targetUnion satisfies never
        }
      })()

      const ast = createExhaustiveMatchAST(typescript, compare, [
        ...targetUnion.alternatives,
      ])

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

      const completionName = ((): string => {
        if (targetUnion.tag === "discriminated") {
          return `${targetSymbol.name}.${targetUnion.discriminant} (exhaustive match)`
        } else if (targetUnion.tag === "literal-union") {
          return `${targetSymbol.name} (exhaustive match)`
          /* v8 ignore next 3 */
        } else {
          return targetUnion satisfies never
        }
      })()
      const customCompletion = {
        name: completionName,
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
    true,
  )
  if (targetUnion === undefined) return undefined

  const targetSymbol = typeChecker.getSymbolAtLocation(node)
  if (targetSymbol === undefined) return undefined

  const declarationType = getSourceDeclarationType(
    typescript,
    targetSymbol,
    typeChecker,
  )
  if (declarationType === undefined) return undefined

  const declarationUnion = getDiscriminatedUnionFromType(
    typescript,
    typeChecker,
    declarationType,
    false,
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
    } satisfies UnionInfo,
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

type UnionInfo =
  | {
      tag: "discriminated"
      discriminant: "tag"
      alternatives: Set<string>
    }
  | {
      tag: "literal-union"
      alternatives: Set<string>
    }

function getDiscriminatedUnionFromType(
  typescript: TS,
  typeChecker: ts.TypeChecker,
  type: ts.Type,
  allowSingleElementTypes = false,
): UnionInfo | undefined {
  if (allowSingleElementTypes) {
    // Allow single tag items
    if (isObjectType(typescript, type)) {
      const tagProp = type.getProperty("tag")
      if (tagProp === undefined) return undefined

      const propType = typeChecker.getTypeOfSymbol(tagProp)
      if (!isStringLiteral(typescript, propType)) return undefined

      return {
        tag: "discriminated",
        discriminant: "tag",
        alternatives: new Set([propType.value]),
      }
    }
    // Or single literals
    if (isStringLiteral(typescript, type)) {
      return {
        tag: "literal-union",
        alternatives: new Set([type.value]),
      }
    }
  }

  if (!isUnionType(typescript, type)) return

  const isObjectsUnion = type.types.every((t) => isObjectType(typescript, t))

  if (isObjectsUnion) {
    const alternativesWithPositions: { value: string; position: number }[] = []

    // TODO: Auto-detect discriminant name
    for (const subtype of type.types) {
      assert(isObjectType(typescript, subtype))
      let foundDiscriminant = false
      for (const prop of typeChecker.getPropertiesOfType(subtype)) {
        if (prop.name !== "tag") continue
        const propType = typeChecker.getTypeOfSymbol(prop)
        if (!isStringLiteral(typescript, propType)) return

        const position = prop.valueDeclaration?.getStart()
        assert(position !== undefined)
        alternativesWithPositions.push({
          value: propType.value,
          // Get source position if possible for ordering
          position,
        })
        foundDiscriminant = true
      }
      if (!foundDiscriminant) return
    }
    alternativesWithPositions.sort((a, b) => a.position - b.position)
    // Convert to Set maintaining order
    const alternatives = new Set(alternativesWithPositions.map((a) => a.value))

    return {
      tag: "discriminated",
      discriminant: "tag",
      alternatives,
    }
  }

  // Check if all types are string literals
  const isStringLiteralUnion = type.types.every((t) =>
    isStringLiteral(typescript, t),
  )

  if (isStringLiteralUnion) {
    const alternatives: Set<string> = new Set()
    for (const subtype of type.types) {
      assert(isStringLiteral(typescript, subtype))
      alternatives.add(subtype.value)
    }
    return {
      tag: "literal-union",
      alternatives,
    }
  }

  return undefined
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

type ExhaustiveMatchLeftCompare =
  | { tag: "prop-access"; variableName: string; discriminantProperty: string }
  | { tag: "identifier"; variableName: string }
function createExhaustiveMatchAST(
  typescript: TS,
  expr: ExhaustiveMatchLeftCompare,
  cases: string[],
): ts.IfStatement {
  function createLeftExpr() {
    if (expr.tag === "prop-access") {
      return typescript.factory.createPropertyAccessExpression(
        typescript.factory.createIdentifier(expr.variableName),
        expr.discriminantProperty,
      )
    } else if (expr.tag === "identifier") {
      return typescript.factory.createIdentifier(expr.variableName)
      /* v8 ignore next 3 */
    } else {
      return expr satisfies never
    }
  }
  function createCondition(tagValue: string) {
    return typescript.factory.createBinaryExpression(
      createLeftExpr(),
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
            typescript.factory.createIdentifier(expr.variableName),
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

function findAncestorMatching<T extends ts.Node>(
  descendant: ts.Node,
  pred: (node: ts.Node) => node is T,
  proper?: boolean,
): T | undefined
function findAncestorMatching(
  descendant: ts.Node,
  pred: (node: ts.Node) => boolean,
  proper?: boolean,
): ts.Node | undefined
function findAncestorMatching(
  descendant: ts.Node,
  pred: (node: ts.Node) => boolean,
  proper: boolean | undefined = true,
): ts.Node | undefined {
  let current = proper === true ? descendant.parent : descendant
  while (current !== undefined) {
    if (pred(current)) {
      return current
    }
    current = current.parent
  }
  return undefined
}

function isAncestor(
  possibleAncestor: ts.Node,
  descendant: ts.Node,
  proper = true,
): boolean {
  return (
    findAncestorMatching(
      descendant,
      (node) => node === possibleAncestor,
      proper,
    ) !== undefined
  )
}

type SatisfiesNeverStructure = {
  identifier: ts.Identifier
  elseStatement: ts.Statement
}
function getSatisfiesNeverStructure(
  typescript: TS,
  sourceFile: ts.SourceFile,
  position: number,
): SatisfiesNeverStructure | undefined {
  const node = getTokenAtPosition(typescript, sourceFile, position)
  assert(node !== undefined)

  const satisfiesExpr = findAncestorMatching(
    node,
    typescript.isSatisfiesExpression,
    false,
  )
  if (satisfiesExpr === undefined) return undefined

  const identifier = satisfiesExpr.expression
  if (!typescript.isIdentifier(identifier)) return undefined

  const ifStatement = findAncestorMatching(
    satisfiesExpr,
    typescript.isIfStatement,
  )
  if (ifStatement === undefined) return undefined

  const elseStatement = ifStatement.elseStatement
  if (
    elseStatement === undefined ||
    !isAncestor(elseStatement, satisfiesExpr)
  ) {
    return undefined
  }

  return {
    identifier,
    elseStatement,
  }
}

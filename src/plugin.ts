import {
  getCodeIndentationLevel,
  getExistingCodeIndentationSpaces,
  getTokenAtPosition,
  setTSLogger,
} from "./utils"
import type * as ts from "typescript/lib/tsserverlibrary"

export type TS = typeof ts

export function init(modules: { typescript: TS }): ts.server.PluginModule {
  const typescript = modules.typescript

  function create(info: ts.server.PluginCreateInfo) {
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

      const sourceFile = info.languageService
        .getProgram()
        ?.getSourceFile(fileName)
      if (!sourceFile) return prior

      const typeChecker = info.languageService.getProgram()?.getTypeChecker()
      if (!typeChecker) return prior

      if (typeof positionOrRange !== "number") return prior

      const refactorCase = getRefactorCase(
        typescript,
        sourceFile,
        positionOrRange,
      )
      if (refactorCase === undefined) return prior

      const narrowedTargetType = typeChecker.getTypeAtLocation(
        refactorCase.identifier,
      )
      const targetType = getDiscriminatedUnionFromType(
        typescript,
        typeChecker,
        narrowedTargetType,
      )
      if (targetType === undefined) return prior

      const targetSymbol = typeChecker.getSymbolAtLocation(
        refactorCase.identifier,
      )
      if (targetSymbol === undefined) return prior

      const declarationType = getSourceDeclarationType(
        typescript,
        targetSymbol,
        typeChecker,
      )
      if (declarationType === undefined) return prior

      const declarationUnion = getDiscriminatedUnionFromType(
        typescript,
        typeChecker,
        declarationType,
        true, // preserveSourceOrder
      )
      if (declarationUnion === undefined) return prior

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

      const sourceFile = info.languageService
        .getProgram()
        ?.getSourceFile(fileName)
      if (!sourceFile) return undefined

      const typeChecker = info.languageService.getProgram()?.getTypeChecker()
      if (!typeChecker) return undefined

      if (typeof positionOrRange !== "number") return undefined

      const refactorCase = getRefactorCase(
        typescript,
        sourceFile,
        positionOrRange,
      )
      if (refactorCase === undefined) return undefined

      const narrowedTargetType = typeChecker.getTypeAtLocation(
        refactorCase.identifier,
      )
      const targetType = getDiscriminatedUnionFromType(
        typescript,
        typeChecker,
        narrowedTargetType,
      )
      if (targetType === undefined) return undefined

      const targetSymbol = typeChecker.getSymbolAtLocation(
        refactorCase.identifier,
      )
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
        true, // preserveSourceOrder
      )
      if (declarationUnion === undefined) return undefined

      const declSortedCases = [...declarationUnion.alternatives]
      const sortedCases = [...targetType.alternatives].sort(
        (a, b) => declSortedCases.indexOf(a) - declSortedCases.indexOf(b),
      )
      // TODO: We should use the expression itself, not only its symbol name
      // which only works for identifiers
      const ast = createExhaustiveMatchAST(
        typescript,
        targetSymbol.name,
        targetType.discriminant,
        sortedCases,
      )

      let newText = printASTWithPlaceholderReplacement(
        typescript,
        sourceFile,
        ast,
        false,
        getCodeIndentationLevel(typescript, refactorCase.identifier) +
          (refactorCase.tag === "parameter" ? 1 : 0),
        refactorCase.tag === "expressionStatement"
          ? getExistingCodeIndentationSpaces(
              typescript,
              sourceFile,
              refactorCase.identifier,
            )
          : 0,
      )

      let replacementSpan: {
        start: number
        length: number
      }
      if (refactorCase.tag === "parameter") {
        const body = refactorCase.node.body
        if (
          body === undefined ||
          typescript.isExpression(body) ||
          !typescript.isBlock(body)
        ) {
          return undefined
        }
        newText = "\n" + newText
        replacementSpan = {
          start: body.getStart() + 1,
          length: 0,
        }
        if (body.getStart() + 2 === body.getEnd()) {
          newText += "\n"
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

    // Override getCompletionsAtPosition to provide exhaustive match completions
    proxy.getCompletionsAtPosition = (fileName, position, options) => {
      const prior = info.languageService.getCompletionsAtPosition(
        fileName,
        position,
        options,
      )
      const sourceFile = info.languageService
        .getProgram()
        ?.getSourceFile(fileName)
      if (sourceFile === undefined) return prior
      const typeChecker = info.languageService.getProgram()?.getTypeChecker()
      if (typeChecker === undefined) return prior

      const comp = getCompletionCase(typescript, sourceFile, position)
      if (comp === undefined) return prior

      const target =
        comp.sub.tag === "identifier" ? comp.sub.node : comp.sub.node.expression
      const narrowedTargetType = typeChecker.getTypeAtLocation(target)
      const targetType = getDiscriminatedUnionFromType(
        typescript,
        typeChecker,
        narrowedTargetType,
      )
      if (targetType === undefined) return prior

      // Bail out when prop access is not a prefix of the discriminant
      if (
        comp.sub.tag === "propAccess" &&
        !targetType.discriminant.startsWith(comp.sub.node.name.text)
      ) {
        return prior
      }

      const targetSymbol = typeChecker.getSymbolAtLocation(target)
      if (targetSymbol === undefined) return prior

      const declarationType = getSourceDeclarationType(
        typescript,
        targetSymbol,
        typeChecker,
      )
      if (declarationType === undefined) return prior

      const declarationUnion = getDiscriminatedUnionFromType(
        typescript,
        typeChecker,
        declarationType,
        true, // preserveSourceOrder
      )
      if (declarationUnion === undefined) return prior

      const declSortedCases = [...declarationUnion.alternatives]
      const sortedCases = [...targetType.alternatives].sort(
        (a, b) => declSortedCases.indexOf(a) - declSortedCases.indexOf(b),
      )
      // TODO: We should use the expression itself, not only its symbol name
      // which only works for identifiers
      const ast = createExhaustiveMatchAST(
        typescript,
        targetSymbol.name,
        targetType.discriminant,
        sortedCases,
      )

      let snippetText = printASTWithPlaceholderReplacement(
        typescript,
        sourceFile,
        ast,
        true,
        0,
        0,
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
        name: `${targetSymbol.name}.${targetType.discriminant} (exhaustive match)`,
        kind: typescript.ScriptElementKind.unknown,
        kindModifiers: "",
        sortText: "0", // High priority
        insertText: snippetText,
        isSnippet: true as const,
        replacementSpan,
      }

      if (prior) {
        prior.entries = [customCompletion, ...prior.entries]
      } else {
        return {
          isGlobalCompletion: false,
          isMemberCompletion: false,
          isNewIdentifierLocation: false,
          entries: [customCompletion],
        }
      }

      return prior
    }

    return proxy
  }
  return { create }
}

function getSourceDeclarationType(
  typescript: TS,
  symbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
): ts.Type | undefined {
  // Get the declared type from source for tag ordering purposes
  if (symbol.declarations && symbol.declarations.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const decl = symbol.declarations[0]!
    if (typescript.isVariableDeclaration(decl) && decl.type) {
      const declaredType = typeChecker.getTypeFromTypeNode(decl.type)
      if ((declaredType.flags & typescript.TypeFlags.Union) !== 0) {
        return declaredType
      }
    } else if (typescript.isParameter(decl) && decl.type) {
      const declaredType = typeChecker.getTypeFromTypeNode(decl.type)
      if ((declaredType.flags & typescript.TypeFlags.Union) !== 0) {
        return declaredType
      }
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
  if (prevToken === undefined) return undefined

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
  if (varCaseParent === undefined) return undefined

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

type RefactorCase =
  | {
      tag: "parameter"
      node: ts.FunctionLikeDeclaration
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
  if (parent === undefined) return undefined

  if (typescript.isParameter(parent)) {
    // Get the function that contains this parameter
    const functionNode = parent.parent
    if (
      typescript.isFunctionDeclaration(functionNode) ||
      typescript.isFunctionExpression(functionNode) ||
      typescript.isArrowFunction(functionNode) ||
      typescript.isMethodDeclaration(functionNode)
    ) {
      return {
        tag: "parameter",
        identifier,
        node: functionNode,
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

type DiscriminatedUnion = {
  discriminant: "tag"
  alternatives: Set<string>
}
function getDiscriminatedUnionFromType(
  typescript: TS,
  typeChecker: ts.TypeChecker,
  type: ts.Type,
  preserveSourceOrder = false,
): DiscriminatedUnion | undefined {
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
  isSnippet: boolean,
  allLinesIndent: number,
  existingIndentFirstLine: number,
): string {
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
        if (line.length === 0) return line
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

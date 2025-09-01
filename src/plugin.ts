import {
  getTokenAtPosition,
  log,
  pprintSimplifiedNode,
  setTSLogger,
  simplifyNode,
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

      const start =
        typeof positionOrRange === "number"
          ? positionOrRange
          : positionOrRange.pos

      // Find the identifier at the current position
      const token = getTokenAtPosition(typescript, sourceFile, start)
      if (!token) return prior

      // Handle both standalone identifiers and identifiers in declarations
      let identifier: ts.Identifier | undefined

      if (typescript.isIdentifier(token)) {
        identifier = token
      } else if (
        typescript.isVariableDeclaration(token) &&
        typescript.isIdentifier(token.name)
      ) {
        identifier = token.name
      } else if (
        typescript.isParameter(token) &&
        typescript.isIdentifier(token.name)
      ) {
        identifier = token.name
      } else {
        // Try to find an identifier in the parent chain
        let current = token.parent
        while (current !== undefined && !identifier) {
          if (
            typescript.isVariableDeclaration(current) &&
            typescript.isIdentifier(current.name)
          ) {
            identifier = current.name
            break
          }
          if (
            typescript.isParameter(current) &&
            typescript.isIdentifier(current.name)
          ) {
            identifier = current.name
            break
          }
          current = current.parent
        }
      }

      if (!identifier) return prior

      const typeChecker = info.languageService.getProgram()?.getTypeChecker()
      if (!typeChecker) return prior

      const symbol = typeChecker.getSymbolAtLocation(identifier)
      if (!symbol) return prior

      // Use the narrowed type at the current location for exhaustiveness checking
      const type = typeChecker.getTypeAtLocation(identifier)
      if (!isDiscriminatedUnion(type, typeChecker, typescript)) return prior

      const discriminantProperty = findDiscriminantProperty(
        type,
        typeChecker,
        typescript,
      )
      if (discriminantProperty === null) return prior

      const refactor: ts.ApplicableRefactorInfo = {
        name: "Generate exhaustive match",
        description: "Generate exhaustive if-else pattern match",
        actions: [
          {
            name: "generateExhaustiveMatch",
            description: "Generate exhaustive if-else pattern match",
            notApplicableReason: undefined,
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
      if (
        refactorName !== "Generate exhaustive match" ||
        actionName !== "generateExhaustiveMatch"
      ) {
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

      const start =
        typeof positionOrRange === "number"
          ? positionOrRange
          : positionOrRange.pos

      // Find the identifier at the current position
      const token = getTokenAtPosition(typescript, sourceFile, start)
      if (!token) return undefined

      let identifier: ts.Identifier | undefined

      if (typescript.isIdentifier(token)) {
        identifier = token
      } else if (
        typescript.isVariableDeclaration(token) &&
        typescript.isIdentifier(token.name)
      ) {
        identifier = token.name
      } else if (
        typescript.isParameter(token) &&
        typescript.isIdentifier(token.name)
      ) {
        identifier = token.name
      } else {
        // Try to find an identifier in the parent chain
        let current = token.parent
        while (current !== undefined && !identifier) {
          if (
            typescript.isVariableDeclaration(current) &&
            typescript.isIdentifier(current.name)
          ) {
            identifier = current.name
            break
          }
          if (
            typescript.isParameter(current) &&
            typescript.isIdentifier(current.name)
          ) {
            identifier = current.name
            break
          }
          current = current.parent
        }
      }

      if (!identifier) return undefined

      const typeChecker = info.languageService.getProgram()?.getTypeChecker()
      if (!typeChecker) return undefined

      const symbol = typeChecker.getSymbolAtLocation(identifier)
      if (!symbol) return undefined

      // Use the narrowed type at the current location for exhaustiveness checking
      const type = typeChecker.getTypeAtLocation(identifier)
      if (!isDiscriminatedUnion(type, typeChecker, typescript)) return undefined

      const discriminantProperty = findDiscriminantProperty(
        type,
        typeChecker,
        typescript,
      )
      if (discriminantProperty === undefined) return undefined

      // Get source declaration type for tag ordering
      const sourceDeclarationType = getSourceDeclarationType(
        typescript,
        symbol,
        typeChecker,
      )

      const newText = generateExhaustiveMatch(
        identifier.text,
        type,
        discriminantProperty,
        typeChecker,
        typescript,
        sourceDeclarationType,
        sourceFile,
      )

      // Find the best position to insert the code
      let insertPosition = identifier.end
      let replaceLength = 0
      let needsNewline = false
      let currentNode: ts.Node = identifier

      // If we're in a variable declaration, insert after the statement
      while (currentNode.parent !== undefined) {
        if (typescript.isVariableStatement(currentNode.parent)) {
          insertPosition = currentNode.parent.end
          break
        }
        if (
          typescript.isVariableDeclaration(currentNode.parent) &&
          currentNode.parent.parent !== undefined &&
          typescript.isVariableDeclarationList(currentNode.parent.parent) &&
          currentNode.parent.parent.parent !== undefined &&
          typescript.isVariableStatement(currentNode.parent.parent.parent)
        ) {
          insertPosition = currentNode.parent.parent.parent.end
          break
        }
        // For standalone identifiers, replace the entire expression statement
        if (typescript.isExpressionStatement(currentNode.parent)) {
          insertPosition = currentNode.parent.getStart()
          replaceLength = currentNode.parent.getWidth()
          break
        }
        // For function parameters, insert at the beginning of the function body
        if (
          typescript.isFunctionDeclaration(currentNode.parent) ||
          typescript.isFunctionExpression(currentNode.parent) ||
          typescript.isArrowFunction(currentNode.parent) ||
          typescript.isMethodDeclaration(currentNode.parent)
        ) {
          const func = currentNode.parent
          if (func.body) {
            if (typescript.isBlock(func.body)) {
              // Insert after the opening brace
              insertPosition = func.body.getStart() + 1

              // Check if function body has content (not just empty {})
              const bodyText = func.body.getText()
              const hasContent = bodyText.trim().length > 2 // More than just "{}"
              if (!hasContent) {
                // Empty function body {} - add trailing newline
                needsNewline = true
              }
            } else {
              // Arrow function with expression body - insert before it
              insertPosition = func.body.getStart()
            }
          }
          break
        }
        currentNode = currentNode.parent
      }

      // Calculate base indentation based on AST block nesting at insertion point
      let blockDepth = 0

      // Use TypeScript's utility to find the node containing the insertion position
      const insertionNode = getTokenAtPosition(
        typescript,
        sourceFile,
        insertPosition,
      )
      let contextNode: ts.Node | undefined = insertionNode

      // Count how many block statements we're nested inside at the insertion point
      while (contextNode) {
        if (typescript.isBlock(contextNode)) {
          blockDepth++
        }
        contextNode = contextNode.parent
      }

      // Calculate base indentation: 2 spaces per block level
      const baseIndent = "  ".repeat(blockDepth)

      // Check if we need a newline based on replacement context
      if (needsNewline === false) needsNewline = replaceLength === 0

      // Apply base indentation to the AST-generated code
      const formattedText =
        (needsNewline ? "\n" : "") +
        newText
          .split("\n")
          .map((line) => (line.length > 0 ? baseIndent + line : ""))
          .join("\n")

      return {
        edits: [
          {
            fileName,
            textChanges: [
              {
                span: { start: insertPosition, length: replaceLength },
                newText: formattedText,
              },
            ],
          },
        ],
        renameFilename: undefined,
        renameLocation: undefined,
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
      if (!sourceFile) return prior
      const typeChecker = info.languageService.getProgram()?.getTypeChecker()
      if (!typeChecker) return prior

      log("DEBUG: cursor pos", position)
      log("DEBUG: AST")
      pprintSimplifiedNode(simplifyNode(typescript, sourceFile, position - 1))
      log("DEBUG: END AST")
      const varCase = getVarCompletionCase(typescript, sourceFile, position)
      log(
        "DEBUG: sub case",
        varCase && { ...varCase, node: simplifyNode(typescript, varCase.node) },
      )
      const comp = getCompletionCase(typescript, sourceFile, position)
      log(
        "DEBUG: Completion case",
        comp && {
          ...comp,
          node: simplifyNode(typescript, comp.node),
          sub: { ...comp.sub, node: simplifyNode(typescript, comp.sub.node) },
        },
      )
      if (comp === undefined) return prior

      const target =
        comp.sub.tag === "identifier" ? comp.sub.node : comp.sub.node.expression
      const narrowedTargetType = typeChecker.getTypeAtLocation(target)
      log("DEBUG: target expr", simplifyNode(typescript, target))
      log("DEBUG: target type", typeChecker.typeToString(narrowedTargetType))
      const targetTypeUnion = getDiscriminatedUnionFromType(
        typescript,
        typeChecker,
        narrowedTargetType,
      )
      if (targetTypeUnion === undefined) return prior
      log("DEBUG: target type union", targetTypeUnion)
      if (
        comp.sub.tag === "propAccess" &&
        !targetTypeUnion.discriminant.startsWith(comp.sub.node.name.text)
      ) {
        return prior
      }

      const targetSymbol = typeChecker.getSymbolAtLocation(target)
      if (targetSymbol === undefined) return prior
      log("DEBUG: target symbol", typeChecker.symbolToString(targetSymbol))
      const declarationType = getSourceDeclarationType(
        typescript,
        targetSymbol,
        typeChecker,
      )
      if (declarationType === undefined) return prior
      log(
        "DEBUG: target symbol decl",
        typeChecker.typeToString(declarationType),
      )

      const declarationUnion = getDiscriminatedUnionFromType(
        typescript,
        typeChecker,
        declarationType,
      )
      if (declarationUnion === undefined) return prior
      log("DEBUG: declaration union", declarationUnion)

      const declSortedCases = [...declarationUnion.alternatives]
      const sortedCases = [...targetTypeUnion.alternatives].sort(
        (a, b) => declSortedCases.indexOf(a) - declSortedCases.indexOf(b),
      )

      // TODO: We should use the expression itself, not only its symbol name
      // which only works for identifiers
      const ast = createExhaustiveMatchAST(
        typescript,
        targetSymbol.name,
        targetTypeUnion.discriminant,
        sortedCases,
      )
      log("DEBUG: AST")
      pprintSimplifiedNode(simplifyNode(typescript, ast))

      let snippetText = printASTWithPlaceholderReplacement(
        typescript,
        sourceFile,
        ast,
        true,
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
      log("DEBUG: result snippet\n", snippetText)

      const customCompletion = {
        name: `${targetSymbol.name}.${targetTypeUnion.discriminant} (exhaustive match)`,
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

function isDiscriminatedUnion(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  typescript: TS,
): boolean {
  if ((type.flags & typescript.TypeFlags.Union) === 0) return false

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const unionType = type as ts.UnionType
  if (unionType.types.length < 2) return false

  // Check if it's a discriminated union by looking for a common property with literal types
  const commonProps: Map<string, boolean> = new Map()

  for (let i = 0; i < unionType.types.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const subType = unionType.types[i]!
    const props = typeChecker.getPropertiesOfType(subType)

    if (i === 0) {
      // Initialize with first type's properties
      for (const prop of props) {
        const propType = typeChecker.getTypeOfSymbolAtLocation(
          prop,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          prop.valueDeclaration!,
        )
        const isLiteral =
          (propType.flags & typescript.TypeFlags.StringLiteral) !== 0
        commonProps.set(prop.getName(), isLiteral)
      }
    } else {
      // Check if other types have the same properties
      const currentProps = new Set(props.map((p) => p.getName()))
      for (const [propName] of commonProps) {
        if (!currentProps.has(propName)) {
          commonProps.delete(propName)
        }
      }
    }
  }

  // Return true if there's at least one common property with literal types
  return Array.from(commonProps.values()).some((isLiteral) => isLiteral)
}

function findDiscriminantProperty(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  typescript: TS,
): string | undefined {
  if ((type.flags & typescript.TypeFlags.Union) === 0) return undefined

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const unionType = type as ts.UnionType
  const unionTypes = unionType.types
  if (unionTypes.length === 0) return undefined

  const candidateProps: Map<string, Set<string>> = new Map()

  for (const subType of unionTypes) {
    const props = typeChecker.getPropertiesOfType(subType)
    for (const prop of props) {
      const propName = prop.getName()
      const propType = typeChecker.getTypeOfSymbolAtLocation(
        prop,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        prop.valueDeclaration!,
      )

      if ((propType.flags & typescript.TypeFlags.StringLiteral) !== 0) {
        if (!candidateProps.has(propName)) {
          candidateProps.set(propName, new Set())
        }
        candidateProps
          .get(propName)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          ?.add((propType as ts.StringLiteralType).value)
      }
    }
  }

  // Find a property that has unique values for each union member
  for (const [propName, values] of candidateProps) {
    if (values.size === unionTypes.length) {
      return propName
    }
  }

  // Fallback to common property names
  const commonNames = ["tag", "type", "kind", "discriminator", "variant"]
  for (const name of commonNames) {
    if (candidateProps.has(name)) {
      return name
    }
  }

  // Return the first candidate if any
  if (candidateProps.size > 0) {
    return candidateProps.keys().next().value
  }

  return undefined
}

function generateExhaustiveMatch(
  variableName: string,
  type: ts.Type,
  discriminantProperty: string,
  typeChecker: ts.TypeChecker,
  typescript: TS,
  sourceDeclarationType?: ts.Type,
  sourceFile?: ts.SourceFile,
): string {
  if ((type.flags & typescript.TypeFlags.Union) === 0) return ""

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const unionType = type as ts.UnionType
  const unionTypes = unionType.types

  // Use source declaration type for ordering if available, otherwise use narrowed type
  const typeForOrdering =
    sourceDeclarationType &&
    (sourceDeclarationType.flags & typescript.TypeFlags.Union) !== 0
      ? // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (sourceDeclarationType as ts.UnionType)
      : unionType

  // Collect cases with their source positions for ordering
  const casesWithPositions: { value: string; position: number }[] = []

  for (const subType of typeForOrdering.types) {
    const discriminantProp = subType.getProperty(discriminantProperty)
    if (discriminantProp) {
      const discriminantType = typeChecker.getTypeOfSymbolAtLocation(
        discriminantProp,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        discriminantProp.valueDeclaration!,
      )

      if ((discriminantType.flags & typescript.TypeFlags.StringLiteral) !== 0) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const literalValue = (discriminantType as ts.StringLiteralType).value

        // Only include this case if it exists in the narrowed type
        const existsInNarrowedType = unionTypes.some((narrowedSubType) => {
          const narrowedDiscriminantProp =
            narrowedSubType.getProperty(discriminantProperty)
          if (narrowedDiscriminantProp) {
            const narrowedDiscriminantType =
              typeChecker.getTypeOfSymbolAtLocation(
                narrowedDiscriminantProp,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                narrowedDiscriminantProp.valueDeclaration!,
              )
            if (
              (narrowedDiscriminantType.flags &
                typescript.TypeFlags.StringLiteral) !==
              0
            ) {
              return (
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                (narrowedDiscriminantType as ts.StringLiteralType).value ===
                literalValue
              )
            }
          }
          return false
        })

        if (existsInNarrowedType) {
          // Try to get source position from the discriminant property's value declaration
          let sourcePosition = 0
          if (discriminantProp.valueDeclaration) {
            sourcePosition = discriminantProp.valueDeclaration.getStart()
          }

          casesWithPositions.push({
            value: literalValue,
            position: sourcePosition,
          })
        }
      }
    }
  }

  // Sort by source position to maintain declaration order
  casesWithPositions.sort((a, b) => a.position - b.position)
  const cases = casesWithPositions.map((c) => c.value)

  if (cases.length === 0) return ""

  // Use AST-based generation if sourceFile is provided
  if (sourceFile) {
    const astNode = createExhaustiveMatchAST(
      typescript,
      variableName,
      discriminantProperty,
      cases,
    )
    return printASTWithPlaceholderReplacement(
      typescript,
      sourceFile,
      astNode,
      false,
      0,
    )
  }

  // Fallback to string-based generation (legacy)
  let result = ""
  for (let i = 0; i < cases.length; i++) {
    if (i === 0) {
      result += `if (${variableName}.${discriminantProperty} === "${cases[i]}") {\n`
    } else {
      result += `} else if (${variableName}.${discriminantProperty} === "${cases[i]}") {\n`
    }
    result += `  \n`
  }
  result += `} else {\n`
  result += `  ${variableName} satisfies never;\n`
  result += `}`

  return result
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

  const curToken = getTokenAtPosition(typescript, sourceFile, position)
  log("DEBUG: curToken", curToken && simplifyNode(typescript, curToken))

  const prevToken = getTokenAtPosition(typescript, sourceFile, prevPos)
  log("DEBUG: prevToken", prevToken && simplifyNode(typescript, prevToken))
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
): DiscriminatedUnion | undefined {
  if (!isUnionType(typescript, type)) return

  const alternatives: Set<string> = new Set()

  // TODO: Auto-detect discriminant name
  for (const subtype of type.types) {
    if (!isObjectType(typescript, subtype)) return
    let foundDiscriminant = false
    for (const prop of typeChecker.getPropertiesOfType(subtype)) {
      if (prop.name !== "tag") continue
      const propType = typeChecker.getTypeOfSymbol(prop)
      if (!isStringLiteral(typescript, propType)) return
      alternatives.add(propType.value)
      foundDiscriminant = true
    }
    if (!foundDiscriminant) return
  }

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
  if (allLinesIndent > 0) {
    const baseIndent = "  ".repeat(allLinesIndent)
    formattedCode = formattedCode
      .split("\n")
      .map((line) => (line.length > 0 ? baseIndent + line : line))
      .join("\n")
  }

  return formattedCode
}

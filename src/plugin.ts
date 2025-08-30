import * as ts from "typescript/lib/tsserverlibrary"

export function init(modules: {
  typescript: typeof ts
}): ts.server.PluginModule {
  const typescript = modules.typescript

  function create(info: ts.server.PluginCreateInfo) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const proxy: ts.LanguageService = Object.create(null)

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    for (const k of Object.keys(
      info.languageService,
    ) as (keyof ts.LanguageService)[]) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const x = info.languageService[k]!
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      ;(proxy as any)[k] = (...args: unknown[]) =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (x as any).apply(info.languageService, args)
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

      const sourceFile = info.languageService
        .getProgram()
        ?.getSourceFile(fileName)
      if (!sourceFile) return prior

      const start =
        typeof positionOrRange === "number"
          ? positionOrRange
          : positionOrRange.pos

      // Find the identifier at the current position
      const token = getTokenAtPosition(sourceFile, start, typescript)
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

      // Get the declared type from the type annotation if available, otherwise use the inferred type
      let type = typeChecker.getTypeOfSymbolAtLocation(symbol, identifier)

      // For standalone identifiers, try to get the declared type from the variable declaration
      if (symbol.declarations && symbol.declarations.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const decl = symbol.declarations[0]!
        if (typescript.isVariableDeclaration(decl) && decl.type) {
          const declaredType = typeChecker.getTypeFromTypeNode(decl.type)
          if ((declaredType.flags & typescript.TypeFlags.Union) !== 0) {
            type = declaredType
          }
        } else if (typescript.isParameter(decl) && decl.type) {
          const declaredType = typeChecker.getTypeFromTypeNode(decl.type)
          if ((declaredType.flags & typescript.TypeFlags.Union) !== 0) {
            type = declaredType
          }
        }
      }
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
      const token = getTokenAtPosition(sourceFile, start, typescript)
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

      // Get the declared type from the type annotation if available, otherwise use the inferred type
      let type = typeChecker.getTypeOfSymbolAtLocation(symbol, identifier)

      // For standalone identifiers, try to get the declared type from the variable declaration
      if (symbol.declarations && symbol.declarations.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const decl = symbol.declarations[0]!
        if (typescript.isVariableDeclaration(decl) && decl.type) {
          const declaredType = typeChecker.getTypeFromTypeNode(decl.type)
          if ((declaredType.flags & typescript.TypeFlags.Union) !== 0) {
            type = declaredType
          }
        } else if (typescript.isParameter(decl) && decl.type) {
          const declaredType = typeChecker.getTypeFromTypeNode(decl.type)
          if ((declaredType.flags & typescript.TypeFlags.Union) !== 0) {
            type = declaredType
          }
        }
      }
      if (!isDiscriminatedUnion(type, typeChecker, typescript)) return undefined

      const discriminantProperty = findDiscriminantProperty(
        type,
        typeChecker,
        typescript,
      )
      if (discriminantProperty === undefined) return undefined

      const newText = generateExhaustiveMatch(
        identifier.text,
        type,
        discriminantProperty,
        typeChecker,
        typescript,
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

      // Get proper indentation based on context
      let baseIndent = ""

      // Check if we're inserting inside a function body
      let isInsideFunction = false
      let tempNode = currentNode
      while (tempNode.parent !== undefined) {
        if (
          (typescript.isFunctionDeclaration(tempNode.parent) ||
            typescript.isFunctionExpression(tempNode.parent) ||
            typescript.isArrowFunction(tempNode.parent) ||
            typescript.isMethodDeclaration(tempNode.parent)) &&
          tempNode.parent.body &&
          typescript.isBlock(tempNode.parent.body)
        ) {
          isInsideFunction = true
          const funcNode = tempNode.parent
          const funcLine = sourceFile.getLineAndCharacterOfPosition(
            funcNode.getStart(),
          )
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const funcLineStart = sourceFile.getLineStarts()[funcLine.line]!
          const funcLineText = sourceFile.text.substring(
            funcLineStart,
            funcNode.getStart(),
          )
          const funcIndent = /^(\s*)/.exec(funcLineText)?.[1] ?? ""
          baseIndent = funcIndent + "  " // Add one level of indentation
          break
        }
        tempNode = tempNode.parent
      }

      if (!isInsideFunction) {
        // For other cases, get indentation from current position
        const currentLine =
          sourceFile.getLineAndCharacterOfPosition(insertPosition)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const lineStart = sourceFile.getLineStarts()[currentLine.line]!
        const lineText = sourceFile.text.substring(lineStart, insertPosition)
        baseIndent = /^(\s*)/.exec(lineText)?.[1] ?? ""
        if (needsNewline === false) needsNewline = replaceLength === 0
      }

      // Format the generated code with proper indentation
      const formattedText =
        (needsNewline || isInsideFunction ? "\n" : "") +
        newText
          .split("\n")
          .map((line) => (line.length > 0 ? baseIndent + line : ""))
          .join("\n") +
        (needsNewline && isInsideFunction ? "\n" : "")

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

      // Get source file
      const sourceFile = info.languageService
        .getProgram()
        ?.getSourceFile(fileName)
      if (!sourceFile) return prior

      // Find the token at the current position
      const token = getTokenAtPosition(sourceFile, position, typescript)

      // Get type checker
      const typeChecker = info.languageService.getProgram()?.getTypeChecker()
      if (!typeChecker) return prior

      let variableToken: ts.Identifier | undefined
      let symbol: ts.Symbol | undefined
      let discriminantPrefix: string | undefined

      // Check for standalone identifier (e.g., "x")
      if (token && typescript.isIdentifier(token)) {
        // Check if this identifier is part of a property access
        if (
          token.parent !== undefined &&
          typescript.isPropertyAccessExpression(token.parent)
        ) {
          // This is "x" in "x.something"
          if (token.parent.expression === token) {
            variableToken = token
            symbol = typeChecker.getSymbolAtLocation(token)
          }
          // This is "something" in "x.something"
          else if (
            token.parent.name === token &&
            typescript.isIdentifier(token.parent.expression)
          ) {
            variableToken = token.parent.expression
            symbol = typeChecker.getSymbolAtLocation(variableToken)
            discriminantPrefix = token.text
          }
        } else {
          // Check if we're in an if statement context - if so, only proceed if there's a dot
          const variableStart = token.getStart(sourceFile)
          const textBeforeVariable = sourceFile.text.substring(0, variableStart)
          const ifPattern = /if\s*\(\s*$/

          if (ifPattern.test(textBeforeVariable)) {
            // We're in an if statement - only proceed if there's property access intention
            const variableEnd = token.getEnd()
            const textFromVariable = sourceFile.text.substring(
              variableEnd,
              position,
            )
            if (!textFromVariable.includes(".")) {
              return prior // Don't provide completion for plain "if (x"
            }
          }

          // Regular standalone identifier
          variableToken = token
          symbol = typeChecker.getSymbolAtLocation(token)
        }
      }
      // Check for scenarios where cursor is right after dot (e.g., "x.|")
      else {
        // Look backwards for a dot token
        let searchPos = position - 1
        while (searchPos > 0) {
          const charAtPos = sourceFile.text.charAt(searchPos)
          if (charAtPos === ".") {
            // Found a dot, now find the property access expression
            const dotToken = getTokenAtPosition(
              sourceFile,
              searchPos,
              typescript,
            )
            if (dotToken && dotToken.kind === typescript.SyntaxKind.DotToken) {
              const propAccess = dotToken.parent
              if (
                typescript.isPropertyAccessExpression(propAccess) &&
                typescript.isIdentifier(propAccess.expression)
              ) {
                variableToken = propAccess.expression
                symbol = typeChecker.getSymbolAtLocation(variableToken)
                break
              }
            }
          } else if (!/\s/.test(charAtPos)) {
            // Hit non-whitespace that's not a dot, stop searching
            break
          }
          searchPos--
        }
      }

      if (!variableToken || !symbol) return prior

      let type = typeChecker.getTypeOfSymbolAtLocation(symbol, variableToken)

      // For variables, try to get the declared type
      if (symbol.declarations && symbol.declarations.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const decl = symbol.declarations[0]!
        if (typescript.isVariableDeclaration(decl) && decl.type) {
          const declaredType = typeChecker.getTypeFromTypeNode(decl.type)
          if ((declaredType.flags & typescript.TypeFlags.Union) !== 0) {
            type = declaredType
          }
        } else if (typescript.isParameter(decl) && decl.type) {
          const declaredType = typeChecker.getTypeFromTypeNode(decl.type)
          if ((declaredType.flags & typescript.TypeFlags.Union) !== 0) {
            type = declaredType
          }
        }
      }

      // Check if it's a discriminated union
      if (!isDiscriminatedUnion(type, typeChecker, typescript)) return prior

      const discriminantProperty = findDiscriminantProperty(
        type,
        typeChecker,
        typescript,
      )
      if (discriminantProperty === undefined) return prior

      // If we have a discriminant prefix, check if it matches the discriminant property
      if (discriminantPrefix !== undefined) {
        if (!discriminantProperty.startsWith(discriminantPrefix)) {
          return prior
        }
      }

      // Generate exhaustive match completion
      const variableName = variableToken.text
      const snippetText = generateExhaustiveMatchSnippet(
        variableName,
        type,
        discriminantProperty,
        typeChecker,
        typescript,
      )

      if (snippetText !== undefined) {
        // Calculate replacement span based on the scenario
        let replacementSpan: { start: number; length: number }

        // Check if we're inside an incomplete if statement
        const ifStatementInfo = findIncompleteIfStatement(
          sourceFile,
          variableToken,
          position,
        )

        if (ifStatementInfo !== undefined) {
          // Replace from the start of the if statement to the end of the incomplete expression
          replacementSpan = {
            start: ifStatementInfo.start,
            length: ifStatementInfo.end - ifStatementInfo.start,
          }
        } else if (discriminantPrefix !== undefined) {
          // For "x.t" scenarios, replace from the variable start to the cursor position
          replacementSpan = {
            start: variableToken.getStart(sourceFile),
            length: position - variableToken.getStart(sourceFile),
          }
        } else {
          // For "x." or "x" scenarios, replace from variable start to cursor position
          replacementSpan = {
            start: variableToken.getStart(sourceFile),
            length: position - variableToken.getStart(sourceFile),
          }
        }

        const customCompletion = {
          name: `${variableName} (exhaustive match)`,
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
      }

      return prior
    }

    return proxy
  }

  return { create }
}

function getTokenAtPosition(
  sourceFile: ts.SourceFile,
  position: number,
  typescript: typeof ts,
): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (position >= node.getStart(sourceFile) && position <= node.getEnd()) {
      const children: ts.Node[] = []
      typescript.forEachChild(node, (child) => {
        children.push(child)
        return undefined
      })

      for (const child of children) {
        const result = find(child)
        if (result) return result
      }

      return node
    }
    return undefined
  }
  return find(sourceFile)
}

function findIncompleteIfStatement(
  sourceFile: ts.SourceFile,
  variableToken: ts.Identifier,
  cursorPosition: number,
): { start: number; end: number } | undefined {
  // Look backwards from the variable token to find "if (" pattern
  const variableStart = variableToken.getStart(sourceFile)
  const textBeforeVariable = sourceFile.text.substring(0, variableStart)

  // Look for "if (" pattern before the variable, allowing for whitespace
  const ifPattern = /if\s*\(\s*$/
  const match = ifPattern.exec(textBeforeVariable)

  if (match) {
    // Check if there's a dot after the variable - only handle property access scenarios
    const variableEnd = variableToken.getEnd()
    const textFromVariable = sourceFile.text.substring(
      variableEnd,
      cursorPosition,
    )

    // Only proceed if we find a dot (indicating property access intention)
    if (!textFromVariable.includes(".")) {
      return undefined
    }

    const ifStartPosition = textBeforeVariable.length - match[0].length

    // Look forward from cursor to find the end of the incomplete expression
    // Handle cases like "if (x.|)" or "if (x.|) {}"
    let endPosition = cursorPosition
    const textAfterCursor = sourceFile.text.substring(cursorPosition)

    // Look for closing paren and potentially empty braces (including multiline)
    const closingParenMatch = /^\s*\)(\s*\{[\s\n]*\})?/.exec(textAfterCursor)
    if (closingParenMatch) {
      endPosition = cursorPosition + closingParenMatch[0].length
    }

    return {
      start: ifStartPosition,
      end: endPosition,
    }
  }

  return undefined
}

function isDiscriminatedUnion(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  typescript: typeof ts,
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
  typescript: typeof ts,
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
  typescript: typeof ts,
): string {
  if ((type.flags & typescript.TypeFlags.Union) === 0) return ""

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const unionType = type as ts.UnionType
  const unionTypes = unionType.types

  // Collect cases with their source positions for ordering
  const casesWithPositions: { value: string; position: number }[] = []

  for (const subType of unionTypes) {
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

  // Sort by source position to maintain declaration order
  casesWithPositions.sort((a, b) => a.position - b.position)
  const cases = casesWithPositions.map((c) => c.value)

  if (cases.length === 0) return ""

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

function generateExhaustiveMatchSnippet(
  variableName: string,
  type: ts.Type,
  discriminantProperty: string,
  typeChecker: ts.TypeChecker,
  typescript: typeof ts,
): string | undefined {
  if ((type.flags & typescript.TypeFlags.Union) === 0) return undefined

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const unionType = type as ts.UnionType
  const unionTypes = unionType.types

  // Collect cases with their source positions for ordering
  const casesWithPositions: { value: string; position: number }[] = []

  for (const subType of unionTypes) {
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

  // Sort by source position to maintain declaration order
  casesWithPositions.sort((a, b) => a.position - b.position)
  const cases = casesWithPositions.map((c) => c.value)

  if (cases.length === 0) return undefined

  let result = `if (${variableName}.${discriminantProperty} === "${cases[0]}") {\n`
  // eslint-disable-next-line no-template-curly-in-string
  result += "  ${1}\n"

  for (let i = 1; i < cases.length; i++) {
    result += `} else if (${variableName}.${discriminantProperty} === "${cases[i]}") {\n`
    result += `  \${${i + 1}}\n`
  }

  result += `} else {\n`
  result += `  ${variableName} satisfies never;\n`
  result += `}`

  return result
}

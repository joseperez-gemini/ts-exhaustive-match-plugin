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
        // For standalone identifiers, insert after the current line
        if (typescript.isExpressionStatement(currentNode.parent)) {
          insertPosition = currentNode.parent.end
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
            } else {
              // Arrow function with expression body - insert before it
              insertPosition = func.body.getStart()
            }
          }
          break
        }
        currentNode = currentNode.parent
      }

      // Get indentation from the current line
      const currentLine =
        sourceFile.getLineAndCharacterOfPosition(insertPosition)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lineStart = sourceFile.getLineStarts()[currentLine.line]!
      const _lineEnd =
        currentLine.line < sourceFile.getLineStarts().length - 1
          ? sourceFile.getLineStarts()[currentLine.line + 1]
          : sourceFile.getEnd()
      const lineText = sourceFile.text.substring(lineStart, insertPosition)
      const baseIndent = /^(\s*)/.exec(lineText)?.[1] ?? ""

      // Format the generated code with proper indentation
      const formattedText =
        "\n" +
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
                span: { start: insertPosition, length: 0 },
                newText: formattedText,
              },
            ],
          },
        ],
        renameFilename: undefined,
        renameLocation: undefined,
      }
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
  const cases: string[] = []

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
        cases.push((discriminantType as ts.StringLiteralType).value)
      }
    }
  }

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

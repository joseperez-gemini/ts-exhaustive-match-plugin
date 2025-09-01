# ts-exhaustive-match-plugin

[![npm version](https://img.shields.io/npm/v/ts-exhaustive-match-plugin.svg)](https://www.npmjs.com/package/ts-exhaustive-match-plugin)
[![npm downloads](https://img.shields.io/npm/dm/ts-exhaustive-match-plugin.svg)](https://www.npmjs.com/package/ts-exhaustive-match-plugin)
[![CI](https://github.com/joseperez-gemini/ts-exhaustive-match-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/joseperez-gemini/ts-exhaustive-match-plugin/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/joseperez-gemini/ts-exhaustive-match-plugin/badge.svg?branch=main)](https://coveralls.io/github/joseperez-gemini/ts-exhaustive-match-plugin?branch=main)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript Language Service Plugin that generates exhaustive pattern matching for discriminated union types with zero dependencies.

## Features

✨ **Automatic Exhaustive Pattern Generation**: Generates complete if-else chains with TypeScript's `satisfies never` for compile-time exhaustiveness checking

🎯 **Multiple Integration Points**:

- **Refactoring**: Right-click on identifiers to generate exhaustive matches
- **Auto-completion**: Type-ahead support for discriminated union identifiers and property access
- **IntelliSense**: Works seamlessly in VS Code, WebStorm, and other TypeScript-enabled editors

🔧 **Comprehensive Support**:

- Function parameters (regular, async, methods, arrow functions)
- Variable declarations (const, let)
- Standalone identifier expressions
- If-statement contexts with intelligent completion
- Type narrowing support (works within type guards)

🏷️ **Smart Discriminant Detection**: Automatically detects `tag` property as discriminant (configurable in future versions)

## Supported Contexts

The plugin generates exhaustive matches for discriminated union types in these contexts:

```typescript
type Result = { tag: "success"; data: string } | { tag: "error"; message: string }

// Function parameters
function handle(result: Result) {
  // Cursor on 'result' → generates exhaustive match
}

// Variable declarations
const result: Result = getResult()
// Cursor on 'result' → generates exhaustive match

// Standalone expressions
result // Cursor here → generates exhaustive match

// If statements with smart completion
if (result. // Auto-completes with exhaustive match
```

## Installation

Install the plugin as a development dependency:

```bash
npm install --save-dev ts-exhaustive-match-plugin
```

## Configuration

Add the plugin to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ts-exhaustive-match-plugin"
      }
    ]
  }
}
```

## Usage

### Via Refactoring (Right-click menu)

1. Place your cursor on a discriminated union identifier
2. Right-click and select "Refactor..."
3. Choose "Generate exhaustive match"

### Via Auto-completion

1. Type a discriminated union identifier followed by `.`
2. Select the exhaustive match completion from the suggestion list
3. Tab through the generated placeholder blocks

### Generated Output

For a discriminated union like:

```typescript
type ApiResponse =
  | { tag: "loading" }
  | { tag: "success"; data: User[] }
  | { tag: "error"; error: string }

function handleResponse(response: ApiResponse) {
  // Generated exhaustive match:
  if (response.tag === "loading") {
    // Handle loading
  } else if (response.tag === "success") {
    // Handle success - data is typed as User[]
  } else if (response.tag === "error") {
    // Handle error - error is typed as string
  } else {
    response satisfies never // Ensures exhaustiveness
  }
}
```

## Editor Support

- ✅ **VS Code**: Full support with IntelliSense and refactoring
- ✅ **WebStorm/IntelliJ**: Works with TypeScript Language Service
- ✅ **Vim/Neovim**: Via TypeScript LSP clients
- ✅ **Emacs**: Via TypeScript mode

## Requirements

- TypeScript 5.0 or higher
- A TypeScript-enabled editor or IDE

## Future Enhancements

- Configurable discriminant property names
- Support for literal union types
- Quick fixes for incomplete pattern matches

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

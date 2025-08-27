# ts-exhaustive-match-plugin

Zero-dependencies exhaustive checking

## Functionality

- Generates exhaustive if-else pattern matching for discriminated union types for
  - Function parameters
  - Variable declarations
  - Standalone identifiers
  - future: Arbitrary expressions
- Automatically detects the discriminant property (e.g., `tag`, `type`, `kind`, etc.)
  - Make this user configurable, default to `tag`
- future: Generate cases for literals (not necessarily tagged unions)
- future: Add missing cases by hovering on the satisfies never error

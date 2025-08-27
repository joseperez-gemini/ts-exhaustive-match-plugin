import { globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"

export default tseslint.config(
  globalIgnores(["lib", "node_modules", "coverage", "*.config.ts"]),
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        // @ts-expect-error doesn't affect anything really
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/consistent-generic-constructors": [
        "error",
        "type-annotation",
      ],
      "@typescript-eslint/consistent-indexed-object-style": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/unified-signatures": [
        "error",
        {
          ignoreDifferentlyNamedParameters: true,
        },
      ],
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        {
          ignoreTernaryTests: true,
        },
      ],
      // Though I've been bitten by precision problems, I think it hinders
      // readability to have to use String(...) for numbers in templates
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
        },
      ],
      "@typescript-eslint/dot-notation": "off",
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
      // Always use shorthand if possible
      "object-shorthand": ["error", "always"],
      // No dangerous truthiness
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: false,
          allowNumber: false,
        },
      ],
      "@typescript-eslint/require-array-sort-compare": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-loop-func": "off",
      "@typescript-eslint/no-loop-func": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unsafe-type-assertion": "error",

      "no-promise-executor-return": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "no-unmodified-loop-condition": "error",
      eqeqeq: ["error", "always"],
      "guard-for-in": "error",
      "no-eval": "error",
      "no-throw-literal": "error",
    },
  },
)

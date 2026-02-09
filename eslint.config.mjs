// TypeScript ESLint の設定モジュールを表す
import typescriptEslint from 'typescript-eslint';

// ESLint のフラット設定を表す
const eslintConfig = [
  {
    files: ['**/*.ts'],
  },
  {
    plugins: {
      '@typescript-eslint': typescriptEslint.plugin,
    },
    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
      ],
      'arrow-parens': ['error', 'always'],
      'arrow-spacing': ['error', { before: true, after: true }],
      'comma-dangle': ['error', 'always-multiline'],
      curly: 'warn',
      eqeqeq: 'warn',
      indent: ['error', 2, { SwitchCase: 1 }],
      'keyword-spacing': ['error', { before: true, after: true }],
      'no-throw-literal': 'warn',
      'no-var': 'error',
      'object-curly-spacing': ['error', 'always'],
      'prefer-const': 'error',
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
      'space-before-function-paren': ['error', 'never'],
    },
  },
];

// ESLint のフラット設定を公開する
export default eslintConfig;
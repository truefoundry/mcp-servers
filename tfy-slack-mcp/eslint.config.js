import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import noRelativeImports from 'eslint-plugin-path';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from '@typescript-eslint/eslint-plugin';
import tseslintParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'], // ✅ Ignores build & dependency folders
  },
  eslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        __dirname: true,
        __filename: true,
        require: true,
        module: true,
        exports: true,
        process: true,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'unused-imports': unusedImports,
      'no-relative-imports': noRelativeImports,
    },
    rules: {
      'no-relative-imports/no-relative-imports': ['error', { maxDepth: 1, suggested: true }],
      'max-len': [
        'warn',
        {
          code: 120,
          ignoreUrls: true,
          ignoreTrailingComments: true,
          ignoreComments: true,
        },
      ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'no-prototype-builtins': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'warn',
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'error',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'warn',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': 'error',
      'no-throw-literal': 'off',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',
      '@typescript-eslint/non-nullable-type-assertion-style': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-confusing-non-null-assertion': 'error',
      '@typescript-eslint/no-duplicate-enum-values': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',
      '@typescript-eslint/no-empty-interface': 'error',
      'no-empty-function': 'off',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-extra-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-mixed-enums': 'error',
      '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      'no-loop-func': 'off',
      '@typescript-eslint/no-loop-func': 'error',
      '@typescript-eslint/no-require-imports': 'off',
      quotes: [
        'warn',
        'single',
        {
          avoidEscape: true,
          allowTemplateLiterals: true,
        },
      ],
      curly: 'error',
    },
  },
];

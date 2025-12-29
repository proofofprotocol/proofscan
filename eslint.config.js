import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // Relax rules for initial adoption (warning mode)
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      'no-console': 'off', // CLI tool uses console
      'prefer-const': 'warn',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '**/*.test.ts',
      '**/*.d.ts',
    ],
  }
);

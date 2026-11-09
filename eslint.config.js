import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-audit', 'dist-http', 'dist-server', 'release', 'artifacts/screens', 'docs/er.svg', 'test-results', 'playwright-report', 'ios/build', 'ios/**/.build', 'ios/Packages/FamilyHubKit/Sources/FHGateway/Resources/sample-engine.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // サーバーが読めるのは共有の規則と文言だけ。画面やモックを持ち込まない。
    files: ['server/**/*.ts'],
    ignores: ['server/test/**', 'server/testing/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '(^|/)src/(?!domain/|authz/|content/)', message: 'server/ may import only src/domain, src/authz and src/content.' }] }],
    },
  },
  {
    // 代役を読めるのは試験と開発用の起動だけ。
    files: ['server/**/*.ts'],
    ignores: ['server/test/**', 'server/testing/**', 'server/dev.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '(^|/)src/(?!domain/|authz/|content/)', message: 'server/ may import only src/domain, src/authz and src/content.' }, { regex: '(^|/)testing/', message: 'Test doubles stay out of the production server.' }] }],
    },
  },
);

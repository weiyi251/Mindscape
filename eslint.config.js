// ============================================================================
// 模块说明（中文）
// ESLint 扁平配置（ESLint 9 起使用 eslint.config.js）。
// 覆盖范围：src 下的 TS / TSX。忽略构建产物与 Rust 侧目录。
// 说明：ESLint 由开发计划书 T0.2 明确要求接入（10.1 技术栈清单未逐项列出）。
// ============================================================================

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src-tauri'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  }
)

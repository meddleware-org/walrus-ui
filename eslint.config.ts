import { suiBoundary } from '@meddleware/eslint-config'
import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginA11y from 'eslint-plugin-vuejs-accessibility'

// Flat ESLint config for the component library. Layers vue-a11y (WAI-ARIA
// linting for templates) on top of the standard Vue + TypeScript recommended
// rules, so accessibility regressions are caught in CI.
export default defineConfigWithVueTs(
  {
    name: 'walrus-ui/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/coverage/**', '**/*.d.ts']),

  ...pluginVue.configs['flat/essential'],
  ...pluginA11y.configs['flat/recommended'],
  vueTsConfigs.recommended,

  {
    name: 'walrus-ui/overrides',
    rules: {
      // Accept both valid label-association patterns: a label wrapping its
      // control (nesting) or a label[for] pointing at a control[id].
      'vuejs-accessibility/label-has-for': [
        'error',
        { required: { some: ['nesting', 'id'] } },
      ],
      // Underscore-prefixed args/vars are an intentional "unused" marker.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  ...suiBoundary(),
)

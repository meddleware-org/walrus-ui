// @meddleware/walrus-ui — library entry.
//
// Exports the core Walrus tool view (no app shell) for inline embedding in the dashboard.
// The standalone SPA (App.vue + main.ts) is unaffected and still builds/deploys as before.
//
// Consumers must import the shared design tokens + UI base once at their entry:
//   import '@meddleware/design-tokens/tokens.css'
//   import '@meddleware/ui/base.css'

export { default as WalrusView } from './components/WalrusView.vue'

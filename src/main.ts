import '@meddleware/design-tokens/tokens.css'
import '@meddleware/design-tokens/seasons.css'
import '@meddleware/ui/base.css'
import { createApp } from 'vue'
import { useSeason } from '@meddleware/ui'
import App from './App.vue'

useSeason()
createApp(App).mount('#app')

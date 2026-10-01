import '@meddleware/design-tokens/tokens.css'
import '@meddleware/design-tokens/seasons.css'
import '@meddleware/ui/base.css'
import { createApp } from 'vue'
import { useSeason } from '@meddleware/ui'
import { useNetwork } from '@meddleware/wallet-adapter'
import App from './App.vue'

// The standalone build targets one network; select it in the shared selector so the client, the
// relay, the gate and the stored resume keys all agree. (Embedded, the host's selector rules.)
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
const built = env.VITE_NETWORK || 'testnet'
if (built === 'testnet' || built === 'mainnet') useNetwork().setNetwork(built)

useSeason()
createApp(App).mount('#app')

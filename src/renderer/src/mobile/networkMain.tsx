/**
 * app.wivodent.com: the Wivo Network and nothing else (VITE_NETWORK_ONLY=true,
 * vite.mobile.config.ts, page network.html).
 *
 * No staff sign-in, no clinic screens, no clinic Supabase project: this entry
 * imports none of them, so none of their code is in the bundle and the build
 * needs neither VITE_SUPABASE_URL nor VITE_SUPABASE_ANON_KEY
 * (mobile/networkOnly.test.ts builds it and checks). The only servers it
 * talks to are the Network (VITE_NETWORK_URL) and, with a session the clinic
 * gave, a clinic's own network-client.
 *
 * Every address that is not /network or below goes to /network.
 */
import '../lib/i18n'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installErrorLog } from '../lib/errorLog'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ConfirmHost } from '../components/ui/ConfirmHost'
import { NetworkApp } from './network/NetworkApp'
import { networkOnlyPath } from './route'
import '../styles/index.css'

document.documentElement.classList.add('mobile')
installErrorLog()

const target = networkOnlyPath(location.pathname)
if (target !== location.pathname) history.replaceState(null, '', target + location.search + location.hash)

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConfirmHost />
        <NetworkApp />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

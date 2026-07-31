import { useCallback, useEffect, useMemo, useState } from 'react'
import { I18nContext, createI18n, type TranslationKey } from './i18n'
import { resolveLocale } from './lib/host'
import { ensureDeviceId } from './lib/device'
import { ToastHost, type Toast } from './components/ui'
import { HomeScreen } from './screens/HomeScreen'
import { CreateScreen } from './screens/CreateScreen'
import { KittyScreen } from './screens/KittyScreen'

export type Route =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'kitty'; id: string }

function parseRoute(pathname: string): Route {
  const match = pathname.match(/^\/k\/([A-Za-z0-9]+)/)
  if (match) return { name: 'kitty', id: match[1] }
  if (pathname.startsWith('/create')) return { name: 'create' }
  return { name: 'home' }
}

export interface Nav {
  go: (route: Route) => void
  back: () => void
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))
  const [toasts, setToasts] = useState<Toast[]>([])

  const i18n = useMemo(() => createI18n(resolveLocale()), [])

  // Reflect the resolved language on <html> for correct hyphenation and for
  // assistive tech, which reads the document language rather than our state.
  useEffect(() => {
    document.documentElement.lang = i18n.locale
  }, [i18n.locale])

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Warm the device identifier as soon as the app opens *only* if the user has
  // already granted it. We never prompt on load — the prompt appears when the
  // user does something that needs it, with a reason that makes sense there.
  useEffect(() => {
    void ensureDeviceId
  }, [])

  const nav = useMemo<Nav>(
    () => ({
      go(next) {
        const path =
          next.name === 'home' ? '/' : next.name === 'create' ? '/create' : `/k/${next.id}`
        window.history.pushState({}, '', path)
        setRoute(next)
        window.scrollTo(0, 0)
      },
      back() {
        window.history.back()
      },
    }),
    [],
  )

  const toast = useCallback(
    (key: TranslationKey, tone: Toast['tone'] = 'neutral', vars?: Record<string, string>) => {
      const id = Date.now() + Math.random()
      setToasts((current) => [...current, { id, message: i18n.t(key, vars), tone }])
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200)
    },
    [i18n],
  )

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        {route.name === 'home' && <HomeScreen nav={nav} onToast={toast} />}
        {route.name === 'create' && <CreateScreen nav={nav} onToast={toast} />}
        {route.name === 'kitty' && (
          <KittyScreen key={route.id} kittyId={route.id} nav={nav} onToast={toast} />
        )}
        <ToastHost toasts={toasts} />
      </div>
    </I18nContext.Provider>
  )
}

export type ToastFn = (
  key: TranslationKey,
  tone?: Toast['tone'],
  vars?: Record<string, string>,
) => void

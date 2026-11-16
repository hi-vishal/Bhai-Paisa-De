import { AnimatePresence, motion } from 'framer-motion'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { Dock } from './components/Chrome'
import { Spinner } from './components/bits'
import { DesktopPoster } from './components/DesktopPoster'
import { GroupPicker } from './components/GroupPicker'
import { UnlockHost } from './components/UnlockHost'
import { isStandalone } from './lib/install'
import { useSession } from './lib/session'

// every screen is its own chunk, so a friend opening a pay link downloads only the pay page
const Activity = lazy(() => import('./screens/Activity').then((m) => ({ default: m.Activity })))
const Card = lazy(() => import('./screens/Card').then((m) => ({ default: m.Card })))
const Help = lazy(() => import('./screens/Help').then((m) => ({ default: m.Help })))
const Link = lazy(() => import('./screens/Link').then((m) => ({ default: m.Link })))
const Statement = lazy(() => import('./screens/Statement').then((m) => ({ default: m.Statement })))
const Dues = lazy(() => import('./screens/Dues').then((m) => ({ default: m.Dues })))
const AddExpense = lazy(() => import('./screens/AddExpense').then((m) => ({ default: m.AddExpense })))
const Group = lazy(() => import('./screens/Group').then((m) => ({ default: m.Group })))
const GroupSettings = lazy(() => import('./screens/GroupSettings').then((m) => ({ default: m.GroupSettings })))
const Home = lazy(() => import('./screens/Home').then((m) => ({ default: m.Home })))
const Landing = lazy(() => import('./screens/Landing').then((m) => ({ default: m.Landing })))
const Join = lazy(() => import('./screens/Join').then((m) => ({ default: m.Join })))
const LedgerProof = lazy(() => import('./screens/LedgerProof').then((m) => ({ default: m.LedgerProof })))
const Me = lazy(() => import('./screens/Me').then((m) => ({ default: m.Me })))
const NewGroup = lazy(() => import('./screens/NewGroup').then((m) => ({ default: m.NewGroup })))
const Pay = lazy(() => import('./screens/Pay').then((m) => ({ default: m.Pay })))
const Verify = lazy(() => import('./screens/Verify').then((m) => ({ default: m.Verify })))
const Welcome = lazy(() => import('./screens/Welcome').then((m) => ({ default: m.Welcome })))
const Unlock = lazy(() => import('./screens/Unlock').then((m) => ({ default: m.Unlock })))
const Wallet = lazy(() => import('./screens/Wallet').then((m) => ({ default: m.Wallet })))
const Wrapped = lazy(() => import('./screens/Wrapped').then((m) => ({ default: m.Wrapped })))

registerSW({ immediate: true })

function Gate({ children }: { children: ReactNode }) {
  const { user, ready, status } = useSession()
  const loc = useLocation()
  if (!ready) return <Spinner />
  if (status === 'locked') return <Navigate to={`/unlock?next=${encodeURIComponent(loc.pathname)}`} replace />
  if (!user) return <Navigate to={`/welcome?next=${encodeURIComponent(loc.pathname)}`} replace />
  return <>{children}</>
}

const page = {
  initial: { opacity: 0, x: 18, rotate: 0.4 },
  animate: { opacity: 1, x: 0, rotate: 0 },
  exit: { opacity: 0, x: -12, transition: { duration: 0.12 } },
}

export function App() {
  const loc = useLocation()
  const nav = useNavigate()
  const { user, ready, status } = useSession()
  const [picker, setPicker] = useState(false)
  const inGroup = useMatch('/g/:id')
  const groupId = inGroup && inGroup.params.id !== 'new' ? inGroup.params.id : null
  const showDock = !!user && (/^\/(activity|me|dues)?$/.test(loc.pathname) || !!groupId)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [loc.pathname])

  // New visitors in a browser get the full-width landing page; the installed app goes straight to sign-up.
  const landing = loc.pathname === '/about' || (loc.pathname === '/' && ready && !user && status !== 'locked' && !isStandalone())
  if (landing)
    return (
      <Suspense fallback={<Spinner />}>
        <Landing />
      </Suspense>
    )

  return (
    <div className="desk">
      <DesktopPoster />
      <div className="app">
        <AnimatePresence mode="wait" initial={false}>
          <motion.main key={loc.pathname} className="page" {...page} transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
            <Suspense fallback={<Spinner />}>
            <Routes location={loc}>
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/unlock" element={<Unlock />} />
              <Route path="/p/:token" element={<Pay />} />
              <Route path="/j/:code" element={<Join />} />
              <Route path="/link" element={<Link />} />
              <Route path="/u/:id" element={<Card />} />
              <Route path="/help" element={<Help />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/trust" element={<Navigate to="/help#safety" replace />} />
              <Route path="/" element={<Gate><Home onAdd={() => setPicker(true)} /></Gate>} />
              <Route path="/activity" element={<Gate><Activity /></Gate>} />
              <Route path="/dues" element={<Gate><Dues /></Gate>} />
              <Route path="/me" element={<Gate><Me /></Gate>} />
              <Route path="/wallet" element={<Gate><Wallet /></Gate>} />
              <Route path="/g/new" element={<Gate><NewGroup /></Gate>} />
              <Route path="/g/:id" element={<Gate><Group /></Gate>} />
              <Route path="/g/:id/add" element={<Gate><AddExpense /></Gate>} />
              <Route path="/g/:id/settings" element={<Gate><GroupSettings /></Gate>} />
              <Route path="/g/:id/ledger" element={<Gate><LedgerProof /></Gate>} />
              <Route path="/g/:id/wrapped" element={<Gate><Wrapped /></Gate>} />
              <Route path="/g/:id/statement" element={<Gate><Statement /></Gate>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </motion.main>
        </AnimatePresence>
        {showDock && <Dock onAdd={() => (groupId ? nav(`/g/${groupId}/add`) : setPicker(true))} />}
        <GroupPicker open={picker} onClose={() => setPicker(false)} />
        <UnlockHost />
      </div>
    </div>
  )
}

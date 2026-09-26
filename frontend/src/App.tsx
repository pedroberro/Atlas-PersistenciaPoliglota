import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { Activity, ArrowRight, Bell, ChartNoAxesCombined, ChevronDown, CircleHelp, CreditCard, Info, LayoutDashboard, LogOut, Menu, MessageCircle, RadioTower, UserRound, UsersRound, X } from 'lucide-react'
import { api, post } from './api'
import { Brand, Loading } from './components'
import type { Page, Session, User } from './types'
const Overview = lazy(() => import('./pages/Overview'))
const Sensors = lazy(() => import('./pages/Sensors'))
const Reports = lazy(() => import('./pages/Reports'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Messages = lazy(() => import('./pages/Messages'))
const Billing = lazy(() => import('./pages/Billing'))
const Users = lazy(() => import('./pages/Users'))
const Profile = lazy(() => import('./pages/Profile'))
const About = lazy(() => import('./pages/About'))
const pageLoading = <div className="page-content"><Loading /></div>

const nav = [
  { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
  { id: 'sensors', label: 'Sensores', icon: RadioTower },
  { id: 'reports', label: 'Informes', icon: ChartNoAxesCombined },
  { id: 'alerts', label: 'Alertas', icon: Bell, staff: true },
  { id: 'messages', label: 'Mensajes', icon: MessageCircle },
  { id: 'billing', label: 'Facturación', icon: CreditCard },
  { id: 'users', label: 'Usuarios', icon: UsersRound, admin: true },
] as const
const labels: Record<Page, string> = { overview: 'Resumen', sensors: 'Sensores', reports: 'Informes', alerts: 'Alertas', messages: 'Mensajes', billing: 'Facturación', users: 'Usuarios', profile: 'Mi perfil', about: 'Acerca de' }
const validPages: Page[] = ['overview', 'sensors', 'reports', 'alerts', 'messages', 'billing', 'users', 'profile', 'about']
function pageFromHash(): Page { const value = window.location.hash.replace('#', '') as Page; return validPages.includes(value) ? value : 'overview' }
function savedSession(): Session | null { try { const value = sessionStorage.getItem('atlas-session'); return value ? JSON.parse(value) as Session : null } catch { return null } }

export default function App() {
  const [session, setSession] = useState<Session | null>(savedSession)
  const [user, setUser] = useState<User | null>(null)
  const [page, setPage] = useState<Page>(pageFromHash)
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  const [profileError, setProfileError] = useState('')
  useEffect(() => { const listener = () => setPage(pageFromHash()); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }, [])
  useEffect(() => { const listener = () => { sessionStorage.removeItem('atlas-session'); setSession(null); setUser(null) }; window.addEventListener('atlas:unauthorized', listener); return () => window.removeEventListener('atlas:unauthorized', listener) }, [])
  useEffect(() => {
    if (!session) return
    let active = true
    api<User>('/users/me', session).then(value => { if (active) { setUser(value); setProfileError('') } }).catch(error => { if (active) setProfileError(error.message) })
    return () => { active = false }
  }, [session])
  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOutside = (event: PointerEvent) => { if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountMenuOpen(false); accountButtonRef.current?.focus() } }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [accountMenuOpen])
  function navigate(next: Page) { window.location.hash = next; setPage(next); setMenuOpen(false); setAccountMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function onLogin(value: Session) { sessionStorage.setItem('atlas-session', JSON.stringify(value)); setSession(value); navigate('overview') }
  async function logout() { try { await post('/auth/logout', {}, session) } catch { /* local token is removed even if API is unavailable */ } sessionStorage.removeItem('atlas-session'); setSession(null); setUser(null); navigate('overview') }
  if (!session) return page === 'about' ? <Suspense fallback={pageLoading}><About publicMode onBack={() => navigate('overview')} /></Suspense> : <Login onLogin={onLogin} onAbout={() => navigate('about')} />
  if (!user) return <div className="full-loading"><Brand /><Loading text={profileError || 'Preparando tu observatorio…'} />{profileError && <button className="button button-dark" onClick={logout}>Volver al acceso</button>}</div>
  const isStaff = session.role !== 'USER'
  const visibleNav = nav.filter(item => (!('staff' in item && item.staff) || isStaff) && (!('admin' in item && item.admin) || session.role === 'ADMIN'))
  return <div className="app-shell">
    {menuOpen && <div className="mobile-backdrop" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand /><button className="icon-button mobile-close" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={20} /></button></div>
      <div className="sidebar-workspace"><span className="workspace-glyph"><Activity size={17} /></span><span><strong>Observatorio global</strong><small>Espacio de trabajo</small></span><ChevronDown size={15} /></div>
      <div className="nav-caption">EXPLORAR</div>
      <nav aria-label="Navegación principal" className="side-nav">{visibleNav.map(item => <button key={item.id} onClick={() => navigate(item.id)} className={`nav-item ${page === item.id ? 'active' : ''}`}><item.icon size={19} strokeWidth={1.9} /><span>{item.label}</span>{item.id === 'alerts' && <span className="nav-tiny-dot" />}</button>)}</nav>
      <div className="nav-caption nav-caption-secondary">PLATAFORMA</div>
      <nav className="side-nav"><button onClick={() => navigate('about')} className={`nav-item ${page === 'about' ? 'active' : ''}`}><Info size={19} strokeWidth={1.9} /><span>Acerca de</span></button></nav>
      <div className="sidebar-bottom"><div className="sidebar-help"><span className="help-orb"><CircleHelp size={20} /></span><strong>Entendé tus datos</strong><p>Conocé cómo viaja y se guarda cada medición.</p><button onClick={() => navigate('about')}>Explorar arquitectura <ArrowRight size={14} /></button></div><div className="sidebar-user"><span className="avatar">{user.full_name.split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase()}</span><span><strong>{user.full_name}</strong><small>{session.role === 'ADMIN' ? 'Administrador' : session.role === 'TECHNICIAN' ? 'Técnico' : 'Usuario'}</small></span><button onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={18} /></button></div></div>
    </aside>
    <div className="app-main"><header className="topbar"><div className="topbar-left"><button className="icon-button menu-trigger" onClick={() => setMenuOpen(true)} aria-label="Abrir menú"><Menu size={21} /></button><span className="breadcrumb">Plataforma</span><span className="breadcrumb-separator">/</span><strong>{labels[page]}</strong></div><div className="topbar-right"><span className="topbar-live"><span className="live-pulse" />Sistema en línea</span><span className="topbar-divider" /><span className="topbar-date">{new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date())}</span><div className="account-menu-anchor" ref={accountMenuRef}>
      <button ref={accountButtonRef} className="topbar-avatar account-avatar-button" onClick={() => setAccountMenuOpen(open => !open)} aria-label="Abrir menú de usuario" aria-expanded={accountMenuOpen} aria-controls="account-menu">{user.full_name[0].toUpperCase()}</button>
      {accountMenuOpen && <div id="account-menu" className="account-dropdown"><div className="account-dropdown-header"><strong>{user.full_name}</strong><span>{user.email}</span></div><button onClick={() => navigate('profile')}><UserRound size={17} /> Mi perfil</button><button onClick={logout}><LogOut size={17} /> Cerrar sesión</button></div>}
    </div></div></header>
      <main><Suspense fallback={pageLoading}>{page === 'overview' && <Overview session={session} user={user} onNavigate={navigate} />}{page === 'sensors' && <Sensors session={session} />}{page === 'reports' && <Reports session={session} />}{page === 'alerts' && isStaff && <Alerts session={session} />}{page === 'messages' && <Messages session={session} user={user} />}{page === 'billing' && <Billing session={session} />}{page === 'users' && session.role === 'ADMIN' && <Users session={session} currentUser={user} />}{page === 'profile' && <Profile user={user} />}{page === 'about' && <About />}</Suspense></main>
    </div>
  </div>
}

function Login({ onLogin, onAbout }: { onLogin: (value: Session) => void; onAbout: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (mode === 'register') await post('/auth/register', { fullName: name, email, password })
      const result = await post<Session>('/auth/login', { email, password })
      onLogin(result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo continuar.') }
    finally { setBusy(false) }
  }
  return <div className="auth-layout"><section className="auth-art"><div className="auth-art-top"><Brand /><span>OBSERVATORIO · 2026</span></div><div className="auth-art-center"><span className="auth-kicker"><span className="live-pulse" /> INTELIGENCIA CLIMÁTICA GLOBAL</span><h1>Comprender el clima<br />empieza con <em>mirarlo<br />de cerca.</em></h1><p>Una plataforma para convertir datos de sensores alrededor del mundo en información que importa.</p><div className="auth-art-stat"><span><strong>04</strong><small>tecnologías de datos</small></span><span><strong>24/7</strong><small>monitoreo continuo</small></span><span><strong>01</strong><small>visión del planeta</small></span></div></div><div className="auth-art-bottom"><span>DATOS · CONTEXTO · DECISIONES</span><button onClick={onAbout}>Conocer la plataforma <ArrowRight size={16} /></button></div><div className="auth-circle circle-a" /><div className="auth-circle circle-b" /><div className="auth-globe"><div className="globe-line globe-one" /><div className="globe-line globe-two" /><div className="globe-line globe-three" /><span className="globe-point gp-one" /><span className="globe-point gp-two" /><span className="globe-point gp-three" /><span className="globe-point gp-four" /></div></section>
    <section className="auth-form-side"><div className="auth-mobile-brand"><Brand /></div><div className="auth-form-wrap"><div className="auth-form-heading"><span className="eyebrow">BIENVENIDO A ATLAS CLIMA</span><h2>{mode === 'login' ? 'Ingresá a tu espacio.' : 'Creá tu cuenta.'}</h2><p>{mode === 'login' ? 'Toda la información climática, en un solo lugar.' : 'El registro público crea una cuenta de usuario. Un administrador puede habilitarte como técnico o administrador después.'}</p></div><form onSubmit={submit} className="auth-form">{mode === 'register' && <label>Nombre completo<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Tu nombre y apellido" required /></label>}<label>Correo electrónico<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="nombre@empresa.com" required /></label><label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder="Ingresá tu contraseña" minLength={mode === 'register' ? 6 : undefined} required /></label>{error && <div className="form-error">{error}</div>}<button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Ingresar al observatorio' : 'Crear cuenta e ingresar'} <ArrowRight size={18} /></button></form><div className="auth-switch">{mode === 'login' ? '¿Todavía no tenés cuenta?' : '¿Ya tenés una cuenta?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? 'Crear una cuenta' : 'Ingresar'}</button></div><div className="demo-note"><strong>Explorá con datos de demostración</strong><span>Después de ejecutar el sembrado local, encontrás las credenciales en <code>demo-credentials.json</code>.</span></div></div><div className="auth-form-footer"><span>© 2026 Atlas Clima</span><button onClick={onAbout}>Acerca de la plataforma</button></div></section></div>
}

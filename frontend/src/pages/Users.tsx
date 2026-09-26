import { useEffect, useState } from 'react'
import { Search, ShieldCheck, UserRoundCheck, UsersRound } from 'lucide-react'
import { api, post } from '../api'
import { Card, CardTitle, InlineError, Loading, SectionHeading } from '../components'
import type { Role, Session, User } from '../types'

const roleLabels: Record<Role, string> = { USER: 'Usuario', TECHNICIAN: 'Técnico', ADMIN: 'Administrador' }
const roles: Role[] = ['USER', 'TECHNICIAN', 'ADMIN']

export default function Users({ session, currentUser }: { session: Session; currentUser: User }) {
  const [users, setUsers] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function refresh() {
    try { setUsers(await api<User[]>('/users', session)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el directorio.') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [session])

  async function changeRole(person: User, role: Role) {
    if (person.role === role) return
    setBusy(`${person.id}:${role}`); setError(''); setNotice('')
    try {
      await post<void>(`/users/${person.id}/roles`, { role }, session)
      await refresh()
      setNotice(`${person.full_name} ahora tiene el rol ${roleLabels[role]}. Deberá volver a ingresar.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el rol.') }
    finally { setBusy('') }
  }

  if (loading) return <div className="page-content"><Loading /></div>
  const filtered = users.filter(person => `${person.full_name} ${person.email}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page-content users-page">
    <SectionHeading eyebrow="ADMINISTRACIÓN DE ACCESO" title="Usuarios y permisos." description="Cada persona se registra como usuario. Desde acá podés habilitar funciones técnicas o administrativas." />
    {error && <InlineError message={error} onRetry={refresh} />}
    {notice && <div className="success-notice">{notice}</div>}
    <div className="user-stats">
      <Card><span className="user-stat-icon"><UsersRound size={22} /></span><span>CUENTAS REGISTRADAS</span><strong>{users.length}</strong></Card>
      <Card><span className="user-stat-icon"><UserRoundCheck size={22} /></span><span>TÉCNICOS</span><strong>{users.filter(person => person.role === 'TECHNICIAN').length}</strong></Card>
      <Card><span className="user-stat-icon"><ShieldCheck size={22} /></span><span>ADMINISTRADORES</span><strong>{users.filter(person => person.role === 'ADMIN').length}</strong></Card>
    </div>
    <Card className="users-card">
      <CardTitle title="Directorio de usuarios" caption="Elegí un único rol para cada cuenta" />
      <div className="user-search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre o correo" aria-label="Buscar usuarios" /><span>{filtered.length} resultados</span></div>
      <div className="users-list">{filtered.map(person => <div className="user-row" key={person.id}>
        <div className="user-identity"><span className="user-avatar">{person.full_name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{person.full_name}{person.id === currentUser.id && <small> · Tu cuenta</small>}</strong><small>{person.email}</small></span>{person.active === false && <span className="user-inactive">Inactivo</span>}</div>
        <div className="user-roles" role="radiogroup" aria-label={`Rol de ${person.full_name}`}>{roles.map(role => { const assigned = person.role === role; const disabled = !!busy || assigned || person.id === currentUser.id; return <button key={role} type="button" role="radio" className={`user-role ${assigned ? 'assigned' : ''}`} onClick={() => changeRole(person, role)} disabled={disabled} aria-checked={assigned} title={person.id === currentUser.id ? 'No podés cambiar tu propio rol.' : assigned ? 'Rol actual' : `Cambiar a ${roleLabels[role]}`}><span>{assigned ? '✓' : '+'}</span>{roleLabels[role]}</button> })}</div>
      </div>)}{!filtered.length && <div className="user-no-results">No hay usuarios para esta búsqueda.</div>}</div>
    </Card>
    <div className="users-guidance"><ShieldCheck size={20} /><p><strong>¿Cómo se obtiene acceso técnico?</strong> La persona crea su cuenta como Usuario. Al cambiarle el rol aquí, su sesión actual se cierra y accede con el nuevo rol la próxima vez que ingresa.</p></div>
  </div>
}

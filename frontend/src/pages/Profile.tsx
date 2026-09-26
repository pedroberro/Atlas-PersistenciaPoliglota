import { CalendarDays, CircleCheck, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { Card, CardTitle, SectionHeading } from '../components'
import { formatDate } from '../api'
import type { Role, User } from '../types'

const roleLabels: Record<Role, string> = { USER: 'Usuario', TECHNICIAN: 'Técnico', ADMIN: 'Administrador' }

export default function Profile({ user }: { user: User }) {
  const initials = user.full_name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()

  return <div className="page-content profile-page">
    <SectionHeading eyebrow="TU CUENTA" title="Mi perfil" description="Consultá los datos de tu cuenta y el rol con el que accedés a la plataforma." />
    <div className="profile-layout">
      <Card className="profile-summary">
        <span className="profile-large-avatar" aria-hidden="true">{initials}</span>
        <h2>{user.full_name}</h2>
        <p>{user.email}</p>
        <span className="profile-role"><ShieldCheck size={15} />{roleLabels[user.role]}</span>
      </Card>
      <Card className="profile-details">
        <CardTitle title="Información de la cuenta" caption="Los datos asociados a tu usuario" />
        <dl className="profile-fields">
          <div><dt><UserRound size={17} />Nombre completo</dt><dd>{user.full_name}</dd></div>
          <div><dt><Mail size={17} />Correo electrónico</dt><dd>{user.email}</dd></div>
          <div><dt><ShieldCheck size={17} />Rol</dt><dd>{roleLabels[user.role]}</dd></div>
          <div><dt><CalendarDays size={17} />Fecha de registro</dt><dd>{formatDate(user.created_at, false)}</dd></div>
          <div><dt><CircleCheck size={17} />Estado de la cuenta</dt><dd>{user.active === false ? 'Inactiva' : 'Activa'}</dd></div>
        </dl>
      </Card>
    </div>
  </div>
}

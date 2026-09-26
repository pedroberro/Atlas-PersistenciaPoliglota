import type { ReactNode } from 'react'
import { ArrowUpRight, CloudOff, LoaderCircle } from 'lucide-react'
import type { Sensor } from './types'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-mark"><span className="brand-orbit" /><span className="brand-core" /></span>
    {!compact && <span className="brand-word"><strong>atlas<span>clima</span></strong><small>OBSERVATORIO GLOBAL</small></span>}
  </div>
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section> }
export function CardTitle({ title, caption, action }: { title: string; caption?: string; action?: ReactNode }) { return <div className="card-heading"><div><h2>{title}</h2>{caption && <p>{caption}</p>}</div>{action}</div> }
export function StatePill({ status }: { status: string }) {
  const copy: Record<string,string> = { ACTIVE:'Activo', INACTIVE:'Inactivo', FAULT:'En falla', RESOLVED:'Resuelta', PENDING:'Pendiente', RUNNING:'En curso', COMPLETED:'Completado', FAILED:'Fallido', CANCELLED:'Cancelado', PAID:'Pagada', OVERDUE:'Vencida' }
  return <span className={`status status-${status.toLowerCase()}`}><span className="status-dot" />{copy[status] || status}</span>
}
export function SensorLabel({ sensor, showCountry = true }: { sensor: Sensor; showCountry?: boolean }) {
  return <span className="sensor-label"><span className="sensor-icon">{sensor.city.slice(0, 2).toUpperCase()}</span><span><strong>{sensor.city}</strong>{showCountry && <small>{sensor.country}</small>}</span></span>
}
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return <div className="empty-state"><span><CloudOff size={26} strokeWidth={1.7} /></span><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>
}
export function Loading({ text = 'Cargando información…' }: { text?: string }) { return <div className="loading"><LoaderCircle className="spin" size={22} />{text}</div> }
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="inline-error"><span>{message}</span>{onRetry && <button className="text-button" onClick={onRetry}>Reintentar <ArrowUpRight size={14} /></button>}</div> }

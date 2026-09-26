import { useEffect, useState } from 'react'
import { Bell, Check, CheckCircle2, Clock3, Filter, RadioTower, ThermometerSun } from 'lucide-react'
import { api, formatDate, post } from '../api'
import { Card, EmptyState, InlineError, Loading, SectionHeading, StatePill } from '../components'
import type { Alert, Sensor, Session } from '../types'

function describeAlert(description: string) {
  if (description === 'Measurement outside configured thresholds') return 'La medición superó los límites de temperatura o humedad configurados para esta estación.'
  if (description.startsWith('Sensor marked as faulty:')) return `Sensor marcado en falla: ${description.slice('Sensor marked as faulty:'.length).trim()}`
  return description
}

export default function Alerts({ session }: { session: Session }) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [sensors, setSensors] = useState<Sensor[]>([])
  const [filter, setFilter] = useState<'ACTIVE'|'RESOLVED'|'ALL'>('ACTIVE')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  async function refresh() {
    try { const [events, stations] = await Promise.all([api<Alert[]>('/alerts', session), api<Sensor[]>('/sensors', session)]); setAlerts(events); setSensors(stations); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las alertas.') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [session])
  async function resolve(id: string) { setBusyId(id); try { await post(`/alerts/${id}/resolve`, {}, session); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo resolver la alerta.') } finally { setBusyId('') } }
  if (loading) return <div className="page-content"><Loading /></div>
  const visible = alerts.filter(alert => filter === 'ALL' || alert.status === filter)
  const active = alerts.filter(alert => alert.status === 'ACTIVE')
  return <div className="page-content alerts-page"><SectionHeading eyebrow="CENTRO DE MONITOREO" title="Alertas y eventos." description="Seguí las condiciones fuera de rango y el estado de funcionamiento de la red." />{error && <InlineError message={error} onRetry={refresh} />}
    <div className="alert-stats"><Card><span className="alert-stat-icon danger"><Bell size={22} /></span><div><small>ALERTAS ACTIVAS</small><strong>{active.length}</strong><span>Requieren revisión</span></div></Card><Card><span className="alert-stat-icon warm"><ThermometerSun size={22} /></span><div><small>CONDICIONES CLIMÁTICAS</small><strong>{active.filter(a => a.type === 'CLIMATE').length}</strong><span>Fuera de los umbrales</span></div></Card><Card><span className="alert-stat-icon cool"><RadioTower size={22} /></span><div><small>ESTADO DE SENSORES</small><strong>{active.filter(a => a.type === 'SENSOR').length}</strong><span>Estaciones para revisar</span></div></Card></div>
    <Card className="alerts-list-card"><div className="card-heading"><div><h2>Registro de eventos</h2><p>Alertas ordenadas por fecha de emisión</p></div><div className="filter-tabs"><Filter size={16} />{(['ACTIVE','RESOLVED','ALL'] as const).map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'ACTIVE' ? 'Activas' : value === 'RESOLVED' ? 'Resueltas' : 'Todas'}</button>)}</div></div>{visible.length ? <div className="alert-list">{visible.map(alert => { const sensor = sensors.find(s => s.id === alert.sensorId); return <article className="alert-item" key={alert._id}><span className={`alert-type-icon ${alert.type === 'CLIMATE' ? 'climate' : 'device'}`}>{alert.type === 'CLIMATE' ? <ThermometerSun size={22} /> : <RadioTower size={22} />}</span><div className="alert-content"><div><strong>{alert.type === 'CLIMATE' ? 'Medición fuera de rango' : 'Revisión del sensor requerida'}</strong><StatePill status={alert.status} /></div><p>{describeAlert(alert.description)}</p><small><span><RadioTower size={13} /> {sensor ? `${sensor.city}, ${sensor.country}` : alert.sensorId}</span><span><Clock3 size={13} /> {formatDate(alert.createdAt)}</span></small></div>{alert.status === 'ACTIVE' && <button className="button button-light alert-resolve" onClick={() => resolve(alert._id)} disabled={busyId === alert._id}><Check size={16} /> {busyId === alert._id ? 'Resolviendo…' : 'Resolver'}</button>}</article> })}</div> : <EmptyState title={filter === 'ACTIVE' ? 'Sin alertas activas' : 'No hay eventos para mostrar'} text={filter === 'ACTIVE' ? 'La red está operando dentro de los parámetros registrados.' : undefined} action={filter === 'ACTIVE' && <CheckCircle2 size={22} className="empty-success" />} />}</Card>
  </div>
}

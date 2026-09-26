import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowRight, Bell, Droplets, RadioTower, Thermometer, TrendingUp } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, formatDate, formatNumber, locationKey } from '../api'
import { Card, CardTitle, EmptyState, InlineError, Loading, SectionHeading, SensorLabel, StatePill } from '../components'
import type { Alert, Measurement, Page, ProcessRequest, Sensor, Session, User } from '../types'

function measurementPath(sensor: Sensor, hours: number) {
  const to = new Date(); const from = new Date(to.getTime() - hours * 3600_000)
  return `/measurements?${new URLSearchParams({ scopeType: 'CITY', scopeKey: locationKey(sensor), from: from.toISOString(), to: to.toISOString() })}`
}

export default function Overview({ session, user, onNavigate }: { session: Session; user: User; onNavigate: (page: Page) => void }) {
  const [sensors, setSensors] = useState<Sensor[]>([])
  const [latest, setLatest] = useState<Record<string, Measurement>>({})
  const [requests, setRequests] = useState<ProcessRequest[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [series, setSeries] = useState<Measurement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const staff = session.role !== 'USER'
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [sensorList, requestList, alertList] = await Promise.all([
          api<Sensor[]>('/sensors', session),
          api<ProcessRequest[]>(staff ? '/processes/admin/requests' : '/processes/requests', session),
          staff ? api<Alert[]>('/alerts?status=ACTIVE', session) : Promise.resolve([] as Alert[]),
        ])
        const readings = await Promise.all(sensorList.map(async sensor => {
          try { const values = await api<Measurement[]>(measurementPath(sensor, 24), session); return [sensor.id, values.find(m => m.sensorId === sensor.id)] as const }
          catch { return [sensor.id, undefined] as const }
        }))
        if (active) { const recent: Record<string, Measurement> = {}; for (const [id, value] of readings) if (value) recent[id] = value; setSensors(sensorList); setRequests(requestList); setAlerts(alertList); setLatest(recent); setSelectedId(value => value || sensorList[0]?.id || ''); setError('') }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los datos.') }
      finally { if (active) setLoading(false) }
    }
    load(); return () => { active = false }
  }, [session, staff])
  const selected = sensors.find(s => s.id === selectedId)
  const locations = sensors.filter((sensor, index) => sensors.findIndex(other => locationKey(other) === locationKey(sensor)) === index)
  useEffect(() => {
    if (!selected) return
    let active = true
    api<Measurement[]>(measurementPath(selected, 24 * 7), session).then(values => { if (active) setSeries(values.filter(m => m.sensorId === selected.id).reverse()) }).catch(() => { if (active) setSeries([]) })
    return () => { active = false }
  }, [selected, session])
  const available = Object.values(latest)
  const avgTemp = available.filter(m => m.temperature != null).reduce((sum, m) => sum + Number(m.temperature), 0) / (available.filter(m => m.temperature != null).length || 1)
  const avgHumidity = available.filter(m => m.humidity != null).reduce((sum, m) => sum + Number(m.humidity), 0) / (available.filter(m => m.humidity != null).length || 1)
  const chartData = useMemo(() => series.map(m => ({ time: new Date(m.measuredAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }), detail: formatDate(m.measuredAt), temperature: m.temperature == null ? null : Number(m.temperature), humidity: m.humidity == null ? null : Number(m.humidity) })), [series])
  if (loading) return <div className="page-content"><Loading /></div>
  return <div className="page-content overview-page">
    <SectionHeading eyebrow="VISTA GENERAL" title={`Buen día, ${user.full_name.split(' ')[0]}.`} description="Así se encuentra tu red climática en este momento." action={<button className="button button-primary" onClick={() => onNavigate('sensors')}><RadioTower size={17} /> Explorar sensores <ArrowRight size={16} /></button>} />
    {error && <InlineError message={error} />}
    <div className="welcome-strip"><div><span className="welcome-icon"><Activity size={20} /></span><span><strong>El planeta no se detiene. Tu información tampoco.</strong><small>Se muestran las últimas lecturas disponibles de sensores activos.</small></span></div><span className="welcome-strip-right"><span className="live-pulse" /> DATOS EN LÍNEA</span></div>
    <div className="stats-grid">
      <Card className="stat-card"><div className="stat-icon stat-blue"><RadioTower size={23} /></div><span className="stat-label">Sensores registrados</span><div className="stat-line"><strong>{sensors.length}</strong><span>en {new Set(sensors.map(s => s.country)).size} países</span></div><small>{sensors.filter(s => s.status === 'ACTIVE').length} activos en la red</small></Card>
      <Card className="stat-card"><div className="stat-icon stat-orange"><Thermometer size={23} /></div><span className="stat-label">Temperatura promedio</span><div className="stat-line"><strong>{available.length ? formatNumber(avgTemp) : '—'}<em>°C</em></strong><span>últimas 24 h</span></div><small>Basado en {available.length} sensores con lecturas</small></Card>
      <Card className="stat-card"><div className="stat-icon stat-cyan"><Droplets size={23} /></div><span className="stat-label">Humedad promedio</span><div className="stat-line"><strong>{available.length ? formatNumber(avgHumidity, 0) : '—'}<em>%</em></strong><span>últimas 24 h</span></div><small>Lecturas de toda la red</small></Card>
      <Card className="stat-card"><div className="stat-icon stat-purple"><TrendingUp size={23} /></div><span className="stat-label">Solicitudes de procesos</span><div className="stat-line"><strong>{requests.length}</strong><span>{requests.filter(r => r.status === 'PENDING').length} pendientes</span></div><small>{requests.filter(r => r.status === 'COMPLETED').length} completadas</small></Card>
    </div>
    <div className="dashboard-grid"><Card className="trend-card"><CardTitle title="Evolución de temperatura" caption={selected ? `${selected.city}, ${selected.country} · últimos 7 días` : 'Elegí un sensor'} action={<select className="small-select" aria-label="Sensor para la gráfica" value={selectedId} onChange={e => setSelectedId(e.target.value)}>{sensors.map(s => <option key={s.id} value={s.id}>{s.city} · {s.code}</option>)}</select>} />{chartData.length ? <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 15, right: 15, left: -25, bottom: 0 }}><defs><linearGradient id="temperatureFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#19a397" stopOpacity={0.21} /><stop offset="95%" stopColor="#19a397" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8edeb" strokeDasharray="3 5" /><XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: '#8a9893', fontSize: 11 }} minTickGap={35} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8a9893', fontSize: 11 }} unit="°" /><Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.detail || ''} formatter={(value) => [`${formatNumber(Number(value))} °C`, 'Temperatura']} contentStyle={{ borderRadius: 12, border: '1px solid #e4ebe8', boxShadow: '0 10px 30px #11282018' }} /><Area type="monotone" dataKey="temperature" stroke="#159f94" strokeWidth={2.5} fill="url(#temperatureFill)" dot={false} activeDot={{ r: 5, strokeWidth: 3, stroke: '#fff' }} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div> : <EmptyState title="Aún no hay mediciones" text="Cargá datos de demostración para ver la evolución." />}{selected && latest[selected.id] && <div className="chart-footer"><span><span className="legend-dot" /> Temperatura actual <strong>{formatNumber(latest[selected.id].temperature)} °C</strong></span><span><Droplets size={16} /> Humedad actual <strong>{formatNumber(latest[selected.id].humidity, 0)} %</strong></span></div>}</Card>
      <Card className="network-card"><CardTitle title="Red global" caption="Última lectura por ubicación" action={<button className="text-button" onClick={() => onNavigate('sensors')}>Ver todos <ArrowRight size={15} /></button>} /><div className="network-list">{locations.slice(0, 7).map(sensor => <button key={sensor.id} className={`network-row ${selectedId === sensor.id ? 'selected' : ''}`} onClick={() => setSelectedId(sensor.id)}><SensorLabel sensor={sensor} /><span className="network-value"><strong>{formatNumber(latest[sensor.id]?.temperature)}°</strong><small>{formatNumber(latest[sensor.id]?.humidity, 0)}% HR</small></span></button>)}</div>{!sensors.length && <EmptyState title="Sin sensores" />}</Card></div>
    <div className="dashboard-bottom"><Card><CardTitle title={staff ? 'Alertas que requieren atención' : 'Tus procesos recientes'} caption={staff ? 'Eventos activos en la red' : 'Estado de tus últimas solicitudes'} action={<button className="text-button" onClick={() => onNavigate(staff ? 'alerts' : 'reports')}>Ver detalle <ArrowRight size={15} /></button>} />{staff ? alerts.length ? <div className="event-list">{alerts.slice(0, 3).map(alert => <div className="event-row" key={alert._id}><span className="event-icon"><Bell size={18} /></span><span><strong>{alert.type === 'CLIMATE' ? 'Alerta climática' : 'Sensor sin señal o en falla'}</strong><small>{sensors.find(s => s.id === alert.sensorId)?.city || 'Sensor'} · {formatDate(alert.createdAt)}</small></span><StatePill status={alert.status} /></div>)}</div> : <EmptyState title="Todo en orden" text="No hay alertas activas en este momento." /> : requests.length ? <div className="event-list">{requests.slice(0,3).map(request => <div className="event-row" key={request.id}><span className="event-icon"><TrendingUp size={18} /></span><span><strong>{request.process_name}</strong><small>{formatDate(request.requested_at)}</small></span><StatePill status={request.status} /></div>)}</div> : <EmptyState title="Sin solicitudes" text="Pedí un informe desde la sección Informes." />}</Card><Card className="insight-card"><span className="insight-icon"><Activity size={24} /></span><div className="eyebrow">CONOCÉ LA PLATAFORMA</div><h3>Cuatro bases.<br />Una visión completa.</h3><p>Descubrí cómo cada dato encuentra su lugar y permanece disponible.</p><button onClick={() => onNavigate('about')}>Explorar la arquitectura <ArrowRight size={17} /></button></Card></div>
  </div>
}

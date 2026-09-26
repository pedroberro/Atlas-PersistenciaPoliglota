import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, CirclePlus, Clock3, Droplets, MapPin, RadioTower, Search, Settings2, Thermometer, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, formatDate, formatNumber, locationKey, post } from '../api'
import { Card, CardTitle, EmptyState, InlineError, Loading, SectionHeading, SensorLabel, StatePill } from '../components'
import type { Measurement, Sensor, Session } from '../types'

export default function Sensors({ session }: { session: Session }) {
  const [sensors, setSensors] = useState<Sensor[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('ALL')
  const [createOpen, setCreateOpen] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const staff = session.role !== 'USER'
  async function refresh() {
    try { const list = await api<Sensor[]>('/sensors', session); setSensors(list); setSelectedId(value => value || list[0]?.id || ''); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los sensores.') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [session])
  const selected = sensors.find(sensor => sensor.id === selectedId)
  useEffect(() => {
    if (!selected) return
    let active = true
    const to = new Date(), from = new Date(to.getTime() - 7 * 86400_000)
    const query = new URLSearchParams({ scopeType: 'CITY', scopeKey: locationKey(selected), from: from.toISOString(), to: to.toISOString() })
    api<Measurement[]>(`/measurements?${query}`, session).then(rows => { if (active) setMeasurements(rows.filter(m => m.sensorId === selected.id)) }).catch(() => { if (active) setMeasurements([]) })
    return () => { active = false }
  }, [selected, session])
  const filtered = sensors.filter(sensor => (country === 'ALL' || sensor.country === country) && `${sensor.code} ${sensor.city} ${sensor.country} ${sensor.zone}`.toLowerCase().includes(search.toLowerCase()))
  const countries = [...new Set(sensors.map(s => s.country))].sort()
  const latest = measurements[0]
  const chartData = useMemo(() => [...measurements].reverse().map(m => ({ time: new Date(m.measuredAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }), detail: formatDate(m.measuredAt), temperature: m.temperature, humidity: m.humidity })), [measurements])
  async function createSensor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string,string>
    const body: Record<string,string | number> = { code: data.code, sensorType: data.sensorType, latitude: Number(data.latitude), longitude: Number(data.longitude), city: data.city, zone: data.zone, country: data.country }
    for (const name of ['minTemperature', 'maxTemperature', 'minHumidity', 'maxHumidity']) if (data[name]) body[name] = Number(data[name])
    try { const created = await post<{id:string;sensorKey:string}>('/sensors', body, session); setCreateOpen(false); setNewKey(created.sensorKey); await refresh(); setSelectedId(created.id) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el sensor.') }
    finally { setBusy(false) }
  }
  async function updateStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !status) return
    setBusy(true); setError('')
    const notes = String(new FormData(event.currentTarget).get('notes') || '')
    try { await post(`/sensors/${selected.id}/controls`, { status, notes }, session); await refresh(); setStatus('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el sensor.') }
    finally { setBusy(false) }
  }
  if (loading) return <div className="page-content"><Loading /></div>
  return <div className="page-content sensors-page">
    <SectionHeading eyebrow="RED DE OBSERVACIÓN" title="Sensores alrededor del mundo." description="Explorá cada estación y sus lecturas recientes." action={staff && <button className="button button-primary" onClick={() => setCreateOpen(true)}><CirclePlus size={18} /> Agregar sensor</button>} />
    {error && <InlineError message={error} onRetry={refresh} />}
    <div className="filter-bar"><div className="search-field"><Search size={18} /><input placeholder="Buscar por ciudad, país o código" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar sensores" /></div><div className="filter-separator" /><Settings2 size={17} className="filter-icon" /><select value={country} onChange={e => setCountry(e.target.value)} aria-label="Filtrar por país"><option value="ALL">Todos los países</option>{countries.map(item => <option key={item}>{item}</option>)}</select><span className="filter-count">{filtered.length} estaciones</span></div>
    <div className="sensor-layout"><Card className="sensor-list-card"><div className="list-title"><span>ESTACIONES</span><span>{filtered.length}</span></div><div className="sensor-list">{filtered.map(sensor => <button key={sensor.id} className={`sensor-list-item ${selectedId === sensor.id ? 'selected' : ''}`} onClick={() => setSelectedId(sensor.id)}><span className="sensor-list-main"><SensorLabel sensor={sensor} /><small>{sensor.code}</small></span><span className="sensor-list-end"><StatePill status={sensor.status} /><ArrowRight size={16} /></span></button>)}{!filtered.length && <EmptyState title="No hay resultados" text="Probá otra búsqueda o país." />}</div></Card>
      {selected ? <div className="sensor-detail"><Card className="sensor-detail-hero"><div className="sensor-detail-top"><span className="eyebrow">ESTACIÓN DE MONITOREO</span><StatePill status={selected.status} /></div><div className="sensor-detail-name"><span className="sensor-detail-icon"><RadioTower size={27} /></span><div><h2>{selected.city}</h2><span><MapPin size={15} /> {selected.zone}, {selected.country}</span></div></div><div className="sensor-detail-meta"><span>Código <strong>{selected.code}</strong></span><span>Tipo <strong>{selected.sensor_type === 'BOTH' ? 'Temperatura y humedad' : selected.sensor_type === 'TEMPERATURE' ? 'Temperatura' : 'Humedad'}</strong></span><span>Coordenadas <strong>{Number(selected.latitude).toFixed(2)}°, {Number(selected.longitude).toFixed(2)}°</strong></span></div></Card>
      <div className="sensor-values"><Card className="reading-card"><span className="reading-icon warm"><Thermometer size={22} /></span><span>TEMPERATURA</span><strong>{formatNumber(latest?.temperature)}<em>°C</em></strong><small>Última lectura registrada</small></Card><Card className="reading-card"><span className="reading-icon cool"><Droplets size={22} /></span><span>HUMEDAD RELATIVA</span><strong>{formatNumber(latest?.humidity, 0)}<em>%</em></strong><small>Última lectura registrada</small></Card></div>
      <Card className="sensor-chart-card"><CardTitle title="Historial de mediciones" caption="Temperatura y humedad · últimos 7 días" />{chartData.length ? <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 15, right: 15, left: -25, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e8edeb" strokeDasharray="3 5" /><XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: '#8a9893', fontSize: 11 }} minTickGap={28} /><YAxis yAxisId="temp" tickLine={false} axisLine={false} tick={{ fill: '#8a9893', fontSize: 11 }} unit="°" /><YAxis yAxisId="humidity" orientation="right" tickLine={false} axisLine={false} tick={{ fill: '#8a9893', fontSize: 11 }} unit="%" /><Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.detail || ''} contentStyle={{ borderRadius: 12, border: '1px solid #e4ebe8' }} /><Line yAxisId="temp" type="monotone" dataKey="temperature" name="Temperatura °C" stroke="#ed945d" strokeWidth={2.5} dot={false} isAnimationActive={false} /><Line yAxisId="humidity" type="monotone" dataKey="humidity" name="Humedad %" stroke="#36a7b4" strokeWidth={2.3} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div> : <EmptyState title="Sin lecturas en este período" text="Cuando el sensor emita datos, aparecerán aquí." />}<div className="chart-legend"><span><i className="legend-orange" /> Temperatura</span><span><i className="legend-blue" /> Humedad</span></div></Card>
      <Card className="recent-card"><CardTitle title="Lecturas recientes" caption="Los últimos valores recibidos" /><div className="table-scroll"><table><thead><tr><th>FECHA Y HORA</th><th>TEMPERATURA</th><th>HUMEDAD</th></tr></thead><tbody>{measurements.slice(0,5).map(m => <tr key={m.id}><td><Clock3 size={14} /> {formatDate(m.measuredAt)}</td><td>{formatNumber(m.temperature)} °C</td><td>{formatNumber(m.humidity, 0)} %</td></tr>)}</tbody></table></div>{!measurements.length && <EmptyState title="Aún no hay lecturas" />}</Card>
      {staff && <Card className="control-card"><CardTitle title="Control de funcionamiento" caption="Actualizá el estado técnico de esta estación" /><form onSubmit={updateStatus} className="control-form"><select value={status} onChange={e => setStatus(e.target.value)} required><option value="">Seleccionar estado</option><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option><option value="FAULT">En falla</option></select><input name="notes" placeholder="Observaciones (opcional)" /><button className="button button-dark" disabled={busy || !status}>Guardar control</button></form></Card>}
    </div> : <Card><EmptyState title="Seleccioná un sensor" text="Elegí una estación de la lista para consultar sus datos." /></Card>}</div>
    {createOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setCreateOpen(false) }}><div className="modal"><div className="modal-header"><div><span className="eyebrow">NUEVA ESTACIÓN</span><h2>Agregar sensor</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)} aria-label="Cerrar"><X size={20} /></button></div><form onSubmit={createSensor} className="form-grid"><label>Código<input name="code" required placeholder="Ej. BA-PLAZA-01" /></label><label>Tipo<select name="sensorType"><option value="BOTH">Temperatura y humedad</option><option value="TEMPERATURE">Temperatura</option><option value="HUMIDITY">Humedad</option></select></label><label>Ciudad<input name="city" required /></label><label>Zona / provincia<input name="zone" required /></label><label>País<input name="country" required /></label><label>Latitud<input name="latitude" type="number" min="-90" max="90" step="0.000001" required /></label><label>Longitud<input name="longitude" type="number" min="-180" max="180" step="0.000001" required /></label><label>Temp. máxima (°C)<input name="maxTemperature" type="number" step="0.1" /></label><button type="submit" className="button button-primary form-full" disabled={busy}>{busy ? 'Guardando…' : 'Crear sensor'} <ArrowRight size={16} /></button></form></div></div>}
    {newKey && <div className="modal-backdrop"><div className="modal key-modal"><span className="reading-icon cool"><RadioTower size={24} /></span><h2>Sensor creado</h2><p>Guardá esta clave ahora. Se muestra una sola vez y permite al dispositivo enviar mediciones.</p><code>{newKey}</code><button className="button button-primary" onClick={() => setNewKey('')}>Entendido</button></div></div>}
  </div>
}

import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, BarChart3, CalendarDays, CirclePlus, Clock3, FileBarChart2, FileText, Play, RefreshCw, SlidersHorizontal, ThermometerSun, X } from 'lucide-react'
import { api, formatDate, formatMoney, formatNumber, locationKey, post } from '../api'
import { Card, CardTitle, EmptyState, InlineError, Loading, SectionHeading, StatePill } from '../components'
import type { Execution, Process, ProcessRequest, Report, Sensor, Session } from '../types'

const processNames: Record<string,string> = { MIN_MAX:'Máximos y mínimos', AVERAGE:'Promedios', THRESHOLD:'Fuera de rango', RAW:'Consulta detallada', PERIODIC_AVERAGE:'Promedio periódico' }
const columns: Record<string,string> = { period:'PERÍODO', count:'LECTURAS', temperatureCount:'TEMP. DATOS', temperatureMin:'TEMP. MÍN.', temperatureMax:'TEMP. MÁX.', temperatureAverage:'TEMP. PROM.', humidityCount:'HUM. DATOS', humidityMin:'HUM. MÍN.', humidityMax:'HUM. MÁX.', humidityAverage:'HUM. PROM.', measuredAt:'FECHA', temperature:'TEMPERATURA', humidity:'HUMEDAD', sensorId:'SENSOR' }
const catalogIcons: Record<string, typeof BarChart3> = { MIN_MAX: ThermometerSun, AVERAGE: BarChart3, THRESHOLD: SlidersHorizontal, RAW: FileText, PERIODIC_AVERAGE: RefreshCw }
const dateInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`

export default function Reports({ session }: { session: Session }) {
  const [catalog, setCatalog] = useState<Process[]>([])
  const [requests, setRequests] = useState<ProcessRequest[]>([])
  const [sensors, setSensors] = useState<Sensor[]>([])
  const [scope, setScope] = useState<'mine'|'all'>('mine')
  const [selectedProcess, setSelectedProcess] = useState<Process | null>(null)
  const [createProcess, setCreateProcess] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const staff = session.role !== 'USER'
  const canRequest = session.role !== 'ADMIN'
  async function refresh() {
    try { const [processList, requestList, sensorList] = await Promise.all([
      api<Process[]>('/processes', session),
      api<ProcessRequest[]>(scope === 'all' ? '/processes/admin/requests' : '/processes/requests', session),
      api<Sensor[]>('/sensors', session),
    ]); setCatalog(processList); setRequests(requestList); setSensors(sensorList); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los informes.') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [session, scope])
  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedProcess || !canRequest) return
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string,string>
    const sensor = sensors.find(s => s.id === data.sensorId)
    if (!sensor) { setError('Seleccioná una ubicación.'); return }
    const scopeType = data.scopeType as 'CITY'|'ZONE'|'COUNTRY'
    const body: Record<string,string|number> = { scopeType, scopeKey: locationKey(sensor, scopeType), from: new Date(data.from).toISOString(), to: new Date(data.to).toISOString(), granularity: data.granularity }
    for (const field of ['minTemperature','maxTemperature','minHumidity','maxHumidity','repeatHours']) if (data[field]) body[field] = Number(data[field])
    setBusy(true); setError('')
    try { await post(`/processes/${selectedProcess.id}/requests`, body, session); setSelectedProcess(null); setNotice('Solicitud creada. Podés seguir su estado en el historial.'); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo solicitar el informe.') }
    finally { setBusy(false) }
  }
  async function submitProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const allowedRoles = ['USER','TECHNICIAN'].filter(role => data.has(role))
    setBusy(true); setError('')
    try { await post('/processes', { name: data.get('name'), description: data.get('description'), type: data.get('type'), price: Number(data.get('price')), allowedRoles }, session); setCreateProcess(false); setNotice('Proceso agregado al catálogo.'); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el proceso.') }
    finally { setBusy(false) }
  }
  async function execute(request: ProcessRequest, retry = false) {
    setBusy(true); setError('')
    try { await post(`/processes/requests/${request.id}/${retry ? 'retry' : 'execute'}`, {}, session); setNotice(retry ? 'Solicitud preparada para reintento.' : 'Proceso ejecutado y factura emitida.'); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'La operación falló.') }
    finally { setBusy(false) }
  }
  async function openReport(request: ProcessRequest) {
    setBusy(true); setError('')
    try { const executions = await api<Execution[]>(`/processes/requests/${request.id}/executions`, session); const done = executions.find(e => e.status === 'COMPLETED' && e.report_id); if (!done?.report_id) throw new Error('No se encontró un informe completado.'); setReport(await api<Report>(`/processes/reports/${done.report_id}`, session)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo abrir el informe.') }
    finally { setBusy(false) }
  }
  if (loading) return <div className="page-content"><Loading /></div>
  return <div className="page-content reports-page"><SectionHeading eyebrow="INTELIGENCIA CLIMÁTICA" title="Informes que dan contexto." description="Solicitá análisis sobre una ciudad, zona o país y consultá cada resultado." action={session.role === 'ADMIN' && <button className="button button-light" onClick={() => setCreateProcess(true)}><CirclePlus size={17} /> Nuevo proceso</button>} />
    {error && <InlineError message={error} onRetry={refresh} />}{notice && <div className="success-notice">{notice}<button onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={15} /></button></div>}
    <div className="section-small-heading"><div><span className="eyebrow">CATÁLOGO DE SERVICIOS</span><h2>Elegí cómo analizar los datos</h2></div><span>{catalog.length} procesos disponibles</span></div>
    <div className="catalog-grid">{catalog.map(process => { const Icon = catalogIcons[process.type] || FileBarChart2; return <Card key={process.id} className="catalog-card"><span className="catalog-icon"><Icon size={24} /></span><span className="catalog-type">{processNames[process.type] || process.type}</span><h3>{process.name}</h3><p>{process.description}</p><div className="catalog-footer"><span>{formatMoney(process.price)} <small>por ejecución</small></span>{canRequest && <button onClick={() => setSelectedProcess(process)} aria-label={`Solicitar ${process.name}`}><ArrowRight size={19} /></button>}</div></Card> })}{!catalog.length && <Card><EmptyState title="Sin procesos disponibles" text="Un administrador puede crear los primeros servicios." /></Card>}</div>
    <Card className="requests-card"><CardTitle title="Historial de solicitudes" caption="Seguimiento de tus análisis y resultados" action={staff && <div className="segmented"><button className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}>Mis solicitudes</button><button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>Toda la operación</button></div>} />{requests.length ? <div className="table-scroll"><table className="requests-table"><thead><tr><th>PROCESO</th><th>UBICACIÓN</th>{scope === 'all' && <th>USUARIO</th>}<th>FECHA</th><th>ESTADO</th><th /></tr></thead><tbody>{requests.map(request => <tr key={request.id}><td><span className="table-primary">{request.process_name}</span><small>{processNames[request.process_type] || request.process_type}</small></td><td>{String(request.parameters?.scopeKey || '—')}</td>{scope === 'all' && <td>{request.user_name || '—'}</td>}<td>{formatDate(request.requested_at)}</td><td><StatePill status={request.status} /></td><td className="table-actions">{request.status === 'COMPLETED' && <button onClick={() => openReport(request)} disabled={busy}>Ver informe <ArrowRight size={14} /></button>}{staff && request.status === 'PENDING' && <button onClick={() => execute(request)} disabled={busy}><Play size={14} /> Ejecutar</button>}{staff && request.status === 'FAILED' && <button onClick={() => execute(request, true)} disabled={busy}><RefreshCw size={14} /> Reintentar</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="Todavía no hay solicitudes" text="Elegí un proceso del catálogo para crear la primera." />}</Card>
    {selectedProcess && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedProcess(null) }}><div className="modal modal-wide"><div className="modal-header"><div><span className="eyebrow">NUEVA SOLICITUD</span><h2>{selectedProcess.name}</h2><p>{selectedProcess.description}</p></div><button className="icon-button" onClick={() => setSelectedProcess(null)} aria-label="Cerrar"><X size={20} /></button></div><form className="form-grid" onSubmit={submitRequest}><label>Ubicación de referencia<select name="sensorId" required>{sensors.map(sensor => <option key={sensor.id} value={sensor.id}>{sensor.city}, {sensor.country}</option>)}</select></label><label>Escala geográfica<select name="scopeType"><option value="CITY">Ciudad</option><option value="ZONE">Zona / provincia</option><option value="COUNTRY">País</option></select></label><label>Desde<input name="from" type="datetime-local" defaultValue={dateInput(new Date(Date.now() - 7*86400_000))} required /></label><label>Hasta<input name="to" type="datetime-local" defaultValue={dateInput(new Date())} required /></label><label>Agrupar por<select name="granularity"><option value="DAY">Día</option><option value="MONTH">Mes</option><option value="YEAR">Año</option></select></label>{selectedProcess.type === 'PERIODIC_AVERAGE' && <label>Repetir cada (horas)<input name="repeatHours" type="number" min="1" max="8760" defaultValue="24" required /></label>}{selectedProcess.type === 'THRESHOLD' && <><label>Temperatura mínima (°C)<input name="minTemperature" type="number" step="0.1" /></label><label>Temperatura máxima (°C)<input name="maxTemperature" type="number" step="0.1" defaultValue="30" /></label><label>Humedad mínima (%)<input name="minHumidity" type="number" step="0.1" /></label><label>Humedad máxima (%)<input name="maxHumidity" type="number" step="0.1" /></label></>}<div className="form-full form-context"><CalendarDays size={18} /><span>Las fechas se interpretan en tu horario local. El análisis utiliza las lecturas disponibles en Cassandra.</span></div><button className="button button-primary form-full" disabled={busy || !sensors.length}>{busy ? 'Enviando…' : `Solicitar por ${formatMoney(selectedProcess.price)}`} <ArrowRight size={16} /></button></form></div></div>}
    {createProcess && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setCreateProcess(false) }}><div className="modal"><div className="modal-header"><div><span className="eyebrow">ADMINISTRACIÓN</span><h2>Nuevo proceso</h2></div><button className="icon-button" onClick={() => setCreateProcess(false)} aria-label="Cerrar"><X size={20} /></button></div><form className="form-grid" onSubmit={submitProcess}><label className="form-full">Nombre<input name="name" required placeholder="Ej. Informe de máximas" /></label><label className="form-full">Descripción<textarea name="description" required rows={3} /></label><label>Tipo<select name="type"><option value="AVERAGE">Promedios</option><option value="MIN_MAX">Máximos y mínimos</option><option value="THRESHOLD">Fuera de rango</option><option value="RAW">Consulta detallada</option><option value="PERIODIC_AVERAGE">Promedio periódico</option></select></label><label>Precio (USD)<input name="price" type="number" min="0" step="0.01" defaultValue="0" required /></label><fieldset className="form-full role-options"><legend>Roles autorizados</legend>{(['USER','TECHNICIAN'] as const).map(role => <label key={role}><input type="checkbox" name={role} defaultChecked={role === 'USER'} /> {role === 'USER' ? 'Usuario' : 'Técnico'}</label>)}</fieldset><button className="button button-primary form-full" disabled={busy}>Crear proceso <ArrowRight size={16} /></button></form></div></div>}
    {report && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setReport(null) }}><div className="modal report-modal"><div className="modal-header"><div><span className="eyebrow">INFORME GENERADO</span><h2>{processNames[report.processType] || report.processType}</h2><p>{formatDate(report.createdAt)} · {String(report.parameters.scopeKey || '')}</p></div><button className="icon-button" onClick={() => setReport(null)} aria-label="Cerrar"><X size={20} /></button></div><div className="report-summary"><span><FileBarChart2 size={20} /> {report.result?.length || 0} registros</span><span><Clock3 size={19} /> {formatDate(report.createdAt)}</span></div>{report.result?.length ? <div className="table-scroll"><table><thead><tr>{Object.keys(report.result[0]).filter(key => key !== 'id').map(key => <th key={key}>{columns[key] || key.toUpperCase()}</th>)}</tr></thead><tbody>{report.result.map((row, index) => <tr key={index}>{Object.keys(report.result[0]).filter(key => key !== 'id').map(key => <td key={key}>{typeof row[key] === 'number' ? formatNumber(row[key] as number, key.includes('Count') || key === 'count' ? 0 : 2) : String(row[key] ?? '—')}</td>)}</tr>)}</tbody></table></div> : <EmptyState title="Sin mediciones en el período" text="El proceso se completó, pero no encontró datos para el rango solicitado." />}</div></div>}
  </div>
}

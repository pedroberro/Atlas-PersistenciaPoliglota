import type { Session } from './types'

const base = import.meta.env.VITE_API_BASE_URL || ''
export const apiBase = base
export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }

export async function api<T>(path: string, session?: Session | null, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`)
  let response: Response
  try { response = await fetch(`${base}/api${path}`, { ...options, headers }) }
  catch { throw new ApiError(0, 'No se pudo conectar con la API. Comprobá que el backend esté activo.') }
  if (!response.ok) {
    let detail = ''
    try { detail = (await response.json()).error || '' } catch { /* empty or non-JSON response */ }
    if (response.status === 401 && session) window.dispatchEvent(new Event('atlas:unauthorized'))
    throw new ApiError(response.status, detail || `La solicitud falló (${response.status}).`)
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T
  const body = await response.text()
  return body ? JSON.parse(body) as T : undefined as T
}

export const post = <T>(path: string, body: unknown, session?: Session | null) =>
  api<T>(path, session, { method: 'POST', body: JSON.stringify(body) })

export const formatDate = (date?: string | null, withTime = true) =>
  date ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(date)) : 'Sin datos'
export const formatNumber = (value?: number | null, digits = 1) => value == null ? '—' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value))
export const formatMoney = (value?: number | null) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD' }).format(Number(value || 0))
export const locationKey = (sensor: { country: string; zone: string; city: string }, scope: 'CITY' | 'ZONE' | 'COUNTRY' = 'CITY') =>
  scope === 'COUNTRY' ? sensor.country : scope === 'ZONE' ? `${sensor.country}/${sensor.zone}` : `${sensor.country}/${sensor.zone}/${sensor.city}`

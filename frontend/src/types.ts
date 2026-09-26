export type Role = 'USER' | 'TECHNICIAN' | 'ADMIN'
export type Page = 'overview' | 'sensors' | 'reports' | 'alerts' | 'messages' | 'billing' | 'users' | 'profile' | 'about'

export interface Session { token: string; sessionId: string; role: Role; expiresAt: string }
export interface User { id: string; full_name: string; email: string; active?: boolean; role: Role; created_at: string }
export interface Sensor {
  id: string; code: string; sensor_type: string; latitude: number; longitude: number;
  city: string; zone: string; country: string; status: 'ACTIVE' | 'INACTIVE' | 'FAULT';
  started_at: string; last_seen_at: string | null;
  min_temperature: number | null; max_temperature: number | null;
  min_humidity: number | null; max_humidity: number | null;
}
export interface Measurement { id: string; sensorId: string; measuredAt: string; temperature: number | null; humidity: number | null }
export interface Alert { _id: string; type: 'SENSOR' | 'CLIMATE'; sensorId: string; measurementId?: string; createdAt: string; description: string; status: 'ACTIVE' | 'RESOLVED' }
export interface Process { id: string; name: string; description: string; type: string; price: number; active: boolean }
export interface ProcessRequest {
  id: string; user_id: string; process_id: string; parameters: Record<string, unknown>; requested_at: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  process_name: string; process_type: string; user_name?: string; user_email?: string;
}
export interface Execution { id: string; request_id: string; started_at: string; finished_at?: string; status: string; report_id?: string; error_text?: string }
export interface Report { _id: string; requestId: string; userId: string; processType: string; createdAt: string; parameters: Record<string, unknown>; result: Record<string, unknown>[] }
export interface Invoice { id: string; user_id: string; issued_at: string; due_at: string; status: 'PENDING' | 'PAID' | 'OVERDUE'; total: number; paid: number; user_name?: string; user_email?: string }
export interface Movement { id: string; kind: 'DEBIT' | 'CREDIT'; amount: number; occurred_at: string; invoice_id?: string }
export interface Account { id: string; balance: number }
export interface Message { _id: string; type: 'PRIVATE' | 'GROUP'; senderId: string; recipientId?: string; groupId?: string; createdAt: string; content: string }
export interface Group { id: string; name: string }

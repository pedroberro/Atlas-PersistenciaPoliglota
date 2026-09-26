import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowRight, CirclePlus, MessageCircle, Search, Send, Users, X } from 'lucide-react'
import { api, formatDate, post } from '../api'
import { Card, EmptyState, InlineError, Loading, SectionHeading } from '../components'
import type { Group, Message, Session, User } from '../types'

type Thread = { kind: 'PRIVATE'|'GROUP'; id: string; name: string; detail: string }
export default function Messages({ session, user }: { session: Session; user: User }) {
  const [directory, setDirectory] = useState<User[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [selected, setSelected] = useState<Thread | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  async function refreshDirectory() {
    try { const [users, groupList] = await Promise.all([api<User[]>('/users/directory', session), api<Group[]>('/messages/groups', session)]); setDirectory(users.filter(person => person.id !== user.id)); setGroups(groupList); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo abrir la mensajería.') }
    finally { setLoading(false) }
  }
  useEffect(() => { refreshDirectory() }, [session, user.id])
  useEffect(() => {
    if (!selected) return
    let active = true
    const path = selected.kind === 'GROUP' ? `/messages/groups/${selected.id}` : `/messages/private/${selected.id}`
    const refreshMessages = () => api<Message[]>(path, session).then(value => { if (active) setMessages([...value].reverse()) }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la conversación.') })
    refreshMessages(); const interval = window.setInterval(refreshMessages, 15000)
    return () => { active = false; window.clearInterval(interval) }
  }, [selected, session])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, selected])
  const threads: Thread[] = [...groups.map(group => ({ kind: 'GROUP' as const, id: group.id, name: group.name, detail: 'Grupo de trabajo' })), ...directory.map(person => ({ kind: 'PRIVATE' as const, id: person.id, name: person.full_name, detail: person.email }))]
  const filtered = threads.filter(thread => `${thread.name} ${thread.detail}`.toLowerCase().includes(search.toLowerCase()))
  async function send(event: FormEvent) {
    event.preventDefault(); if (!selected || !draft.trim()) return
    setSending(true); setError('')
    try { const path = selected.kind === 'GROUP' ? `/messages/groups/${selected.id}` : '/messages/private'; await post(path, selected.kind === 'GROUP' ? { content: draft.trim() } : { recipientId: selected.id, content: draft.trim() }, session); setDraft(''); const value = await api<Message[]>(selected.kind === 'GROUP' ? `/messages/groups/${selected.id}` : `/messages/private/${selected.id}`, session); setMessages([...value].reverse()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo enviar el mensaje.') }
    finally { setSending(false) }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }
  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const name = String(data.get('name') || '').trim(); if (!name) return
    setSending(true); setError('')
    try { const group = await post<{id:string}>('/messages/groups', { name }, session); const members = [user.id, ...data.getAll('members').map(String)]; await Promise.all(members.map(id => post(`/messages/groups/${group.id}/members/${id}`, {}, session))); setCreateOpen(false); await refreshDirectory(); setSelected({ kind: 'GROUP', id: group.id, name, detail: 'Grupo de trabajo' }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el grupo.') }
    finally { setSending(false) }
  }
  if (loading) return <div className="page-content"><Loading /></div>
  return <div className="page-content messages-page"><SectionHeading eyebrow="COLABORACIÓN" title="Conversaciones que conectan." description="Coordiná con usuarios y equipos técnicos desde un mismo lugar." action={session.role === 'ADMIN' && <button className="button button-light" onClick={() => setCreateOpen(true)}><CirclePlus size={17} /> Crear grupo</button>} />{error && <InlineError message={error} />}
    <Card className="messenger"><aside className="conversation-sidebar"><div className="conversation-sidebar-head"><div><h2>Mensajes</h2><span>{threads.length} contactos y grupos</span></div><span className="conversation-icon"><MessageCircle size={19} /></span></div><div className="conversation-search"><Search size={17} /><input placeholder="Buscar conversación" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar conversación" /></div><div className="conversation-list">{filtered.map(thread => <button key={`${thread.kind}-${thread.id}`} className={`conversation-item ${selected?.id === thread.id && selected.kind === thread.kind ? 'active' : ''}`} onClick={() => { setSelected(thread); setMessages([]) }}><span className={`conversation-avatar ${thread.kind === 'GROUP' ? 'group' : ''}`}>{thread.kind === 'GROUP' ? <Users size={19} /> : thread.name.split(' ').map(part => part[0]).slice(0,2).join('').toUpperCase()}</span><span><strong>{thread.name}</strong><small>{thread.detail}</small></span><ArrowRight size={15} /></button>)}{!filtered.length && <EmptyState title="Sin contactos" text="No se encontraron coincidencias." />}</div></aside>
      <div className="conversation-main">{selected ? <><div className="conversation-header"><span className={`conversation-avatar ${selected.kind === 'GROUP' ? 'group' : ''}`}>{selected.kind === 'GROUP' ? <Users size={19} /> : selected.name.split(' ').map(part => part[0]).slice(0,2).join('').toUpperCase()}</span><span><strong>{selected.name}</strong><small>{selected.kind === 'GROUP' ? 'Conversación grupal' : 'Mensaje privado'}</small></span></div><div className="message-stream">{messages.length ? messages.map(message => <div key={message._id} className={`message-line ${message.senderId === user.id ? 'mine' : ''}`}><div className="message-bubble">{selected.kind === 'GROUP' && message.senderId !== user.id && <strong>{directory.find(person => person.id === message.senderId)?.full_name || 'Integrante'}</strong>}<p>{message.content}</p><small>{formatDate(message.createdAt)}</small></div></div>) : <EmptyState title="Empezá esta conversación" text="Los mensajes que envíes aparecerán aquí." />}<div ref={endRef} /></div><form className="message-compose" onSubmit={send}><textarea placeholder="Escribí un mensaje…" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} rows={2} maxLength={5000} /><button type="submit" disabled={sending || !draft.trim()} aria-label="Enviar mensaje"><Send size={19} /></button><span>Ctrl + Enter para enviar</span></form></> : <div className="conversation-placeholder"><span><MessageCircle size={30} /></span><h3>Elegí una conversación</h3><p>Seleccioná un contacto o grupo para comenzar a intercambiar mensajes.</p></div>}</div></Card>
    {createOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setCreateOpen(false) }}><div className="modal"><div className="modal-header"><div><span className="eyebrow">COLABORACIÓN</span><h2>Nuevo grupo</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)} aria-label="Cerrar"><X size={20} /></button></div><form className="form-grid" onSubmit={createGroup}><label className="form-full">Nombre del grupo<input name="name" placeholder="Ej. Equipo de mantenimiento" required /></label><fieldset className="form-full member-options"><legend>Elegí integrantes</legend>{directory.map(person => <label key={person.id}><input type="checkbox" name="members" value={person.id} /><span>{person.full_name}<small>{person.email}</small></span></label>)}</fieldset><button className="button button-primary form-full" disabled={sending}>Crear grupo <ArrowRight size={16} /></button></form></div></div>}
  </div>
}

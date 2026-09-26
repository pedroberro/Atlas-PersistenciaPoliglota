import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CheckCircle2, CreditCard, FileText, Landmark, ReceiptText, Wallet, X } from 'lucide-react'
import { api, ApiError, formatDate, formatMoney, post } from '../api'
import { Card, CardTitle, EmptyState, InlineError, Loading, SectionHeading, StatePill } from '../components'
import type { Account, Invoice, Movement, Session } from '../types'

interface InvoiceItem { id: string; description: string; amount: number; execution_id: string }
interface Payment { id: string; paid_at: string; amount: number; method: string; reference: string }
export default function Billing({ session }: { session: Session }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [movements, setMovements] = useState<Movement[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [scope, setScope] = useState<'mine'|'all'>('mine')
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function refresh() {
    try {
      const invoiceList = await api<Invoice[]>(scope === 'all' ? '/billing/admin/invoices' : '/billing/invoices', session)
      setInvoices(invoiceList)
      if (scope === 'mine') {
        try { const current = await api<Account>('/billing/account', session); setAccount(current); setMovements(await api<Movement[]>('/billing/account/movements', session)) }
        catch (cause) { if (cause instanceof ApiError && cause.status === 404) { setAccount(null); setMovements([]) } else throw cause }
      }
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar la facturación.') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [session, scope])
  async function openAccount() { setBusy(true); try { await post('/billing/account', {}, session); await refresh(); setNotice('Cuenta corriente habilitada.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo habilitar la cuenta.') } finally { setBusy(false) } }
  async function openInvoice(invoice: Invoice) { setSelected(invoice); try { const [lines, recorded] = await Promise.all([api<InvoiceItem[]>(`/billing/invoices/${invoice.id}/items`, session), api<Payment[]>(`/billing/invoices/${invoice.id}/payments`, session)]); setItems(lines); setPayments(recorded) } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar la factura.') } }
  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    const data = new FormData(event.currentTarget); setBusy(true); setError('')
    try { await post(`/billing/invoices/${selected.id}/payments`, { amount: Number(data.get('amount')), method: data.get('method'), reference: data.get('reference') }, session); setPaymentOpen(false); setSelected(null); setNotice('Pago registrado y acreditado.'); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo registrar el pago.') }
    finally { setBusy(false) }
  }
  if (loading) return <div className="page-content"><Loading /></div>
  const pending = invoices.filter(invoice => invoice.status !== 'PAID')
  const totalPending = pending.reduce((sum, invoice) => sum + Number(invoice.total) - Number(invoice.paid), 0)
  return <div className="page-content billing-page"><SectionHeading eyebrow="ADMINISTRACIÓN FINANCIERA" title="Facturación y cuenta corriente." description="Un registro claro de cada proceso ejecutado, factura emitida y pago acreditado." />{error && <InlineError message={error} onRetry={refresh} />}{notice && <div className="success-notice">{notice}<button onClick={() => setNotice('')} aria-label="Cerrar"><X size={15} /></button></div>}
    {session.role === 'ADMIN' && <div className="scope-bar"><div className="segmented"><button className={scope === 'mine' ? 'active' : ''} onClick={() => { setScope('mine'); setSelected(null) }}>Mi cuenta</button><button className={scope === 'all' ? 'active' : ''} onClick={() => { setScope('all'); setSelected(null) }}>Facturas de usuarios</button></div></div>}
    <div className="billing-overview"><Card className="balance-card"><div className="balance-top"><span className="balance-icon"><Wallet size={24} /></span><span>CUENTA CORRIENTE</span></div><small>Saldo actual</small><strong>{account ? formatMoney(account.balance) : 'Sin cuenta'}</strong><p>{account ? 'Débitos por informes menos pagos acreditados.' : 'Podés habilitarla para registrar tus movimientos.'}</p>{!account && scope === 'mine' && <button className="button button-light" onClick={openAccount} disabled={busy}>Habilitar cuenta <ArrowRight size={16} /></button>}</Card><Card className="bill-metric"><span className="bill-metric-icon orange"><ReceiptText size={24} /></span><span>FACTURAS EMITIDAS</span><strong>{invoices.length}</strong><small>En la vista seleccionada</small></Card><Card className="bill-metric"><span className="bill-metric-icon teal"><Landmark size={24} /></span><span>SALDO PENDIENTE</span><strong>{formatMoney(totalPending)}</strong><small>{pending.length} factura{pending.length === 1 ? '' : 's'} por cancelar</small></Card></div>
    <div className="billing-grid"><Card className="invoice-card"><CardTitle title="Facturas" caption={scope === 'all' ? 'Facturas de todos los usuarios' : 'Tus servicios facturados'} />{invoices.length ? <div className="invoice-list">{invoices.map(invoice => <button key={invoice.id} className={`invoice-row ${selected?.id === invoice.id ? 'selected' : ''}`} onClick={() => openInvoice(invoice)}><span className="invoice-icon"><FileText size={20} /></span><span className="invoice-main"><strong>Factura #{invoice.id.slice(0,8).toUpperCase()}</strong><small>{scope === 'all' ? `${invoice.user_name || invoice.user_email} · ` : ''}{formatDate(invoice.issued_at, false)}</small></span><span className="invoice-end"><strong>{formatMoney(invoice.total)}</strong><StatePill status={invoice.status} /></span><ArrowRight size={17} /></button>)}</div> : <EmptyState title="Sin facturas por ahora" text="Aparecerán aquí cuando se complete un proceso de pago." />}</Card><Card className="invoice-detail-card">{selected ? <><CardTitle title={`Factura #${selected.id.slice(0,8).toUpperCase()}`} caption={`Emitida el ${formatDate(selected.issued_at, false)}`} action={<StatePill status={selected.status} />} /><div className="invoice-detail-meta"><span>Vencimiento <strong>{formatDate(selected.due_at, false)}</strong></span><span>Total <strong>{formatMoney(selected.total)}</strong></span><span>Pagado <strong>{formatMoney(selected.paid)}</strong></span><span>Pendiente <strong>{formatMoney(Number(selected.total) - Number(selected.paid))}</strong></span></div><div className="invoice-subtitle">CONCEPTOS FACTURADOS</div>{items.map(item => <div className="invoice-line" key={item.id}><span>{item.description}</span><strong>{formatMoney(item.amount)}</strong></div>)}<div className="invoice-subtitle payment-subtitle">PAGOS REGISTRADOS</div>{payments.length ? payments.map(payment => <div className="invoice-line" key={payment.id}><span>{payment.method}<small>{formatDate(payment.paid_at)}</small></span><strong>{formatMoney(payment.amount)}</strong></div>) : <p className="muted-text">Todavía no hay pagos registrados.</p>}{session.role === 'ADMIN' && Number(selected.total) > Number(selected.paid) && <button className="button button-primary invoice-pay" onClick={() => setPaymentOpen(true)}><CreditCard size={17} /> Registrar pago verificado</button>}</> : <div className="invoice-placeholder"><span><FileText size={30} /></span><h3>Detalle de la factura</h3><p>Seleccioná una factura para ver conceptos, pagos y saldo pendiente.</p></div>}</Card></div>
    {scope === 'mine' && <Card className="movements-card"><CardTitle title="Movimientos de cuenta" caption="Cada débito y crédito queda registrado" />{movements.length ? <div className="table-scroll"><table><thead><tr><th>FECHA</th><th>CONCEPTO</th><th>TIPO</th><th>MONTO</th></tr></thead><tbody>{movements.map(movement => <tr key={movement.id}><td>{formatDate(movement.occurred_at)}</td><td>Factura #{movement.invoice_id?.slice(0,8).toUpperCase()}</td><td><span className={`movement-kind ${movement.kind === 'CREDIT' ? 'credit' : 'debit'}`}>{movement.kind === 'CREDIT' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}{movement.kind === 'CREDIT' ? 'Crédito' : 'Débito'}</span></td><td>{formatMoney(movement.amount)}</td></tr>)}</tbody></table></div> : <EmptyState title="Sin movimientos" text="Los cargos y pagos aparecerán después de utilizar servicios." />}</Card>}
    {paymentOpen && selected && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setPaymentOpen(false) }}><div className="modal"><div className="modal-header"><div><span className="eyebrow">ACREDITACIÓN MANUAL</span><h2>Registrar pago</h2><p>Solo registrá montos ya verificados por fuera de la plataforma.</p></div><button className="icon-button" onClick={() => setPaymentOpen(false)} aria-label="Cerrar"><X size={20} /></button></div><form className="form-grid" onSubmit={recordPayment}><label>Monto (USD)<input name="amount" type="number" min="0.01" max={Number(selected.total)-Number(selected.paid)} step="0.01" defaultValue={(Number(selected.total)-Number(selected.paid)).toFixed(2)} required /></label><label>Método<select name="method"><option value="BANK_TRANSFER">Transferencia bancaria</option><option value="CASH">Efectivo</option><option value="CARD_EXTERNAL">Tarjeta verificada externamente</option></select></label><label className="form-full">Referencia / comprobante<input name="reference" required placeholder="Código único del comprobante" /></label><div className="form-full form-context"><CheckCircle2 size={18} /> Este paso acredita el pago y actualiza la cuenta corriente.</div><button type="submit" className="button button-primary form-full" disabled={busy}>Confirmar pago <ArrowRight size={16} /></button></form></div></div>}
  </div>
}

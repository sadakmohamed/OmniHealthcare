import React, { useState, useEffect } from 'react'
import {
  DollarSign,
  Plus,
  CreditCard,
  CheckCircle,
  AlertTriangle,
  X,
  FileText,
  ShieldAlert,
  Layers,
  Clock
} from 'lucide-react'
import {
  getBills,
  createBill,
  getPayments,
  createPayment,
  getPatients,
  getEncounters
} from '../api'

export default function Billing({ me }) {
  const [bills, setBills] = useState([])
  const [payments, setPayments] = useState([])
  const [patients, setPatients] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [selectedBillForPayment, setSelectedBillForPayment] = useState(null)

  // Invoice form
  const [invoiceForm, setInvoiceForm] = useState({
    patient: '',
    encounter: '',
    items: [
      { description: 'General Consultation', amount_cents: 5000 },
      { description: 'Diagnostic Blood Panel', amount_cents: 2500 }
    ]
  })

  // Payment form
  const [paymentForm, setPaymentForm] = useState({
    amount_cents: 0,
    method: 'fictional_insurance',
    reference: 'CLM-SYNTH-' + Math.floor(1000 + Math.random() * 9000)
  })

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [bRes, pRes, ptRes, eRes] = await Promise.all([
        getBills(),
        getPayments(),
        getPatients().catch(() => ({ data: [] })),
        getEncounters().catch(() => ({ data: [] }))
      ])

      setBills(bRes.data?.results || bRes.data || [])
      setPayments(pRes.data?.results || pRes.data || [])
      setPatients(ptRes.data?.results || ptRes.data || [])
      setEncounters(eRes.data?.results || eRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load billing records.')
    } finally {
      setLoading(false)
    }
  }

  function addItemRow() {
    setInvoiceForm({
      ...invoiceForm,
      items: [...invoiceForm.items, { description: 'Medication Dispensing', amount_cents: 1500 }]
    })
  }

  function removeItemRow(idx) {
    const next = invoiceForm.items.filter((_, i) => i !== idx)
    setInvoiceForm({ ...invoiceForm, items: next })
  }

  function updateItem(idx, field, val) {
    const next = [...invoiceForm.items]
    next[idx][field] = field === 'amount_cents' ? (parseInt(val, 10) || 0) : val
    setInvoiceForm({ ...invoiceForm, items: next })
  }

  async function handleCreateInvoice(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const invNum = 'INV-' + Math.floor(100000 + Math.random() * 900000)
      await createBill({
        patient: invoiceForm.patient,
        encounter: invoiceForm.encounter || null,
        invoice_number: invNum,
        items: invoiceForm.items,
        status: 'unpaid'
      })
      setSuccess(`Itemized invoice ${invNum} generated. Total calculated by server.`)
      setShowCreateModal(false)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create invoice. Server checks permissions.')
    } finally {
      setSubmitting(false)
    }
  }

  function openPaymentModal(bill) {
    const paidForThisBill = payments
      .filter((p) => p.bill === bill.id)
      .reduce((sum, p) => sum + (p.amount_cents || 0), 0)
    const balance = Math.max(0, bill.total_cents - paidForThisBill)

    setSelectedBillForPayment(bill)
    setPaymentForm({
      amount_cents: balance,
      method: 'fictional_insurance',
      reference: 'CLM-SYNTH-' + Math.floor(1000 + Math.random() * 9000)
    })
    setShowPaymentModal(true)
  }

  async function handleRecordPayment(e) {
    e.preventDefault()
    if (!selectedBillForPayment) return
    setSubmitting(true)
    setError('')
    try {
      await createPayment({
        bill: selectedBillForPayment.id,
        amount_cents: parseInt(paymentForm.amount_cents, 10),
        method: paymentForm.method,
        reference: paymentForm.reference
      })
      setSuccess(`Simulated payment of $${(paymentForm.amount_cents / 100).toFixed(2)} recorded.`)
      setShowPaymentModal(false)
      setSelectedBillForPayment(null)
      loadData()
    } catch (err) {
      const data = err.response?.data
      if (data?.amount_cents) {
        setError(Array.isArray(data.amount_cents) ? data.amount_cents.join(', ') : data.amount_cents)
      } else {
        setError(err.response?.data?.detail || 'Payment cannot exceed outstanding invoice balance.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const role = me?.role || 'admin'
  const canManageBilling = ['billing', 'admin'].includes(role)

  return (
    <div className="billing-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MODULE F10</span>
          <h1>Healthcare Billing & Simulated Claims</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            Itemized clinical charges, server-calculated totals, fictional insurer adjudication, and payment bounds validation.
          </p>
        </div>
        <div className="page-actions">
          {canManageBilling && (
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={16} /> Generate Itemized Invoice
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertTriangle size={16} />
          <div style={{ flex: 1 }}>{error}</div>
          <button className="alert-close" onClick={() => setError('')}>&times;</button>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <div style={{ flex: 1 }}>{success}</div>
          <button className="alert-close" onClick={() => setSuccess('')}>&times;</button>
        </div>
      )}

      <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ShieldAlert size={18} color="#92400e" />
        <div>
          <strong>FINANCIAL INTEGRITY NOTICE:</strong> Totals are strictly computed on the server from line items. Payments cannot exceed outstanding balance. All insurer names and amounts are synthetic.
        </div>
      </div>

      {/* Invoices List */}
      <div className="panel">
        <div className="panel-header">
          <h3>Invoices & Billing Ledger ({bills.length})</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>Refresh</button>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading financial accounts...
            </div>
          ) : bills.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No billing invoices found.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice Number</th>
                  <th>Patient</th>
                  <th>Itemized Breakdown</th>
                  <th>Total Amount</th>
                  <th>Paid Amount</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => {
                  const pt = patients.find((p) => p.id === bill.patient)
                  const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${bill.patient?.slice ? bill.patient.slice(0, 8) : bill.patient}`
                  const totalPaid = payments
                    .filter((p) => p.bill === bill.id)
                    .reduce((sum, p) => sum + (p.amount_cents || 0), 0)
                  return (
                    <tr key={bill.id}>
                      <td>
                        <strong style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>
                          {bill.invoice_number}
                        </strong>
                      </td>
                      <td>
                        <strong>{ptName}</strong>
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        {Array.isArray(bill.items) ? bill.items.map((it) => it.description).join(', ') : 'Standard charges'}
                      </td>
                      <td>
                        <strong style={{ fontSize: '15px' }}>${((bill.total_cents || 0) / 100).toFixed(2)}</strong>
                      </td>
                      <td>
                        <span style={{ color: totalPaid >= bill.total_cents ? '#16a34a' : 'inherit', fontWeight: 600 }}>
                          ${(totalPaid / 100).toFixed(2)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-${bill.status}`}>{bill.status}</span>
                      </td>
                      <td>
                        {canManageBilling && bill.status !== 'paid' && (
                          <button
                            className="btn btn-success btn-xs"
                            onClick={() => openPaymentModal(bill)}
                          >
                            <CreditCard size={12} /> Record Payment
                          </button>
                        )}
                        {bill.status === 'paid' && (
                          <span style={{ color: '#16a34a', fontSize: '12px', fontWeight: 600 }}>
                            Fully Settled
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Generate Itemized Medical Invoice</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowCreateModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="panel-body">
              <div className="form-group">
                <label>Select Patient *</label>
                <select
                  required
                  value={invoiceForm.patient}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, patient: e.target.value })}
                >
                  <option value="">-- Choose Patient --</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} ({p.medical_record_number})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Linked Encounter (Optional)</label>
                <select
                  value={invoiceForm.encounter}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, encounter: e.target.value })}
                >
                  <option value="">-- None (Longitudinal Charge) --</option>
                  {encounters.map((enc) => (
                    <option key={enc.id} value={enc.id}>
                      Encounter {enc.id.slice(0, 8)} &mdash; {enc.status}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 700 }}>Line Items (Calculated by Server)</label>
                  <button type="button" className="btn btn-secondary btn-xs" onClick={addItemRow}>
                    + Add Item
                  </button>
                </div>
                {invoiceForm.items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Item description"
                      required
                      value={item.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      style={{ flex: 1, height: '36px', padding: '0 8px', borderRadius: '6px', border: '1px solid var(--line)' }}
                    />
                    <input
                      type="number"
                      placeholder="Amount in cents"
                      required
                      value={item.amount_cents}
                      onChange={(e) => updateItem(idx, 'amount_cents', e.target.value)}
                      style={{ width: '130px', height: '36px', padding: '0 8px', borderRadius: '6px', border: '1px solid var(--line)' }}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--muted)', width: '60px' }}>
                      ${(item.amount_cents / 100).toFixed(2)}
                    </span>
                    {invoiceForm.items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItemRow(idx)}
                        style={{ border: 0, background: 'none', color: '#ef4444', cursor: 'pointer' }}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
                <div style={{ textAlign: 'right', fontWeight: 700, marginTop: '8px', fontSize: '14px' }}>
                  Estimated Total: ${(invoiceForm.items.reduce((s, i) => s + (i.amount_cents || 0), 0) / 100).toFixed(2)}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Generating...' : 'Save & Issue Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {showPaymentModal && selectedBillForPayment && (
        <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Record Payment for {selectedBillForPayment.invoice_number}</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowPaymentModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="panel-body">
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '14px', border: '1px solid var(--line)' }}>
                <div><strong>Invoice Total:</strong> ${(selectedBillForPayment.total_cents / 100).toFixed(2)}</div>
                <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
                  Payments cannot exceed the outstanding balance.
                </div>
              </div>

              <div className="form-group">
                <label>Payment Amount (in Cents) *</label>
                <input
                  type="number"
                  required
                  value={paymentForm.amount_cents}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount_cents: e.target.value })}
                />
                <span className="form-hint">
                  Equivalent to: ${(paymentForm.amount_cents / 100).toFixed(2)}
                </span>
              </div>

              <div className="form-group">
                <label>Payment / Claims Method *</label>
                <select
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                >
                  <option value="fictional_insurance">Fictional Insurance Claim (Aetna-Synthetic)</option>
                  <option value="fictional_nhif">NHIF / SHA Fictional Cover</option>
                  <option value="card">Simulated Visa / Mastercard</option>
                  <option value="mpesa">Simulated Mobile Money / M-Pesa</option>
                  <option value="cash">Simulated Cash</option>
                </select>
              </div>

              <div className="form-group">
                <label>Transaction / Claim Authorization Code</label>
                <input
                  type="text"
                  required
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowPaymentModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Processing...' : 'Apply Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

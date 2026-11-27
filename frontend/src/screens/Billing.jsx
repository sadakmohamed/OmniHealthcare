import React, { useState, useEffect } from 'react'
import {
  DollarSign,
  Plus,
  CreditCard,
  CheckCircle,
  AlertTriangle,
  X,
} from 'lucide-react'
import {
  getBills,
  createBill,
  getPayments,
  createPayment,
  getPatients,
  getEncounters,
  getInsuranceClaims,
  createInsuranceClaim,
  submitInsuranceClaim,
  adjudicateInsuranceClaim
} from '../api'

export default function Billing({ me, listFilters }) {
  const [bills, setBills] = useState([])
  const [payments, setPayments] = useState([])
  const [patients, setPatients] = useState([])
  const [encounters, setEncounters] = useState([])
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [activeSection, setActiveSection] = useState('opd')

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [selectedBillForPayment, setSelectedBillForPayment] = useState(null)

  // Invoice form
  const [invoiceForm, setInvoiceForm] = useState({
    patient: '',
    encounter: '',
    care_type: 'opd',
    items: [
      { description: 'General Consultation', amount_cents: 5000 },
      { description: 'Diagnostic Blood Panel', amount_cents: 2500 }
    ]
  })

  // Payment form
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'cash',
    reference: ''
  })
  const [claimForm, setClaimForm] = useState({
    bill: '',
    payer_name: '',
    member_reference: '',
    requested_amount: ''
  })
  const [claimDecisions, setClaimDecisions] = useState({})

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [bRes, pRes, ptRes, eRes, claimRes] = await Promise.all([
        getBills(),
        getPayments(),
        getPatients().catch(() => ({ data: [] })),
        getEncounters().catch(() => ({ data: [] })),
        getInsuranceClaims()
      ])

      setBills(bRes.data?.results || bRes.data || [])
      setPayments(pRes.data?.results || pRes.data || [])
      setPatients(ptRes.data?.results || ptRes.data || [])
      setEncounters(eRes.data?.results || eRes.data || [])
      setClaims(claimRes.data?.results || claimRes.data || [])
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
        care_type: invoiceForm.care_type,
        invoice_number: invNum,
        items: invoiceForm.items,
        status: 'unpaid'
      })
      setSuccess(`Itemized invoice ${invNum} generated. Total calculated by server.`)
      setShowCreateModal(false)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data || 'Failed to create invoice.'))
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
      amount: (balance / 100).toFixed(2),
      method: 'cash',
      reference: ''
    })
    setShowPaymentModal(true)
  }

  async function handleRecordPayment(e) {
    e.preventDefault()
    if (!selectedBillForPayment) return
    setSubmitting(true)
    setError('')
    try {
      const amountCents = Math.round(Number(paymentForm.amount) * 100)
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        setError('Enter a valid payment amount.')
        return
      }
      await createPayment({
        bill: selectedBillForPayment.id,
        amount_cents: amountCents,
        method: paymentForm.method,
        reference: paymentForm.reference
      })
      setSuccess(`Payment of $${(amountCents / 100).toFixed(2)} recorded.`)
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

  async function handleCreateClaim(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await createInsuranceClaim({
        bill: claimForm.bill,
        payer_name: claimForm.payer_name,
        member_reference: claimForm.member_reference,
        requested_cents: Math.round(Number(claimForm.requested_amount) * 100)
      })
      setSuccess('Draft insurance claim created.')
      setClaimForm({ bill: '', payer_name: '', member_reference: '', requested_amount: '' })
      setShowClaimModal(false)
      await loadData()
    } catch (err) {
      const data = err.response?.data
      setError(data?.detail || data?.requested_cents?.[0] || data?.bill?.[0] || 'Unable to create the claim.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitClaim(claim) {
    setError('')
    try {
      await submitInsuranceClaim(claim.id)
      setSuccess(`Claim ${claim.claim_number} submitted.`)
      await loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to submit this claim.')
    }
  }

  async function handleAdjudicateClaim(claim) {
    const decision = claimDecisions[claim.id] || {
      status: 'approved',
      amount: (claim.requested_cents / 100).toFixed(2),
      notes: ''
    }
    setError('')
    try {
      await adjudicateInsuranceClaim(claim.id, {
        status: decision.status,
        approved_cents: decision.status === 'denied' ? 0 : Math.round(Number(decision.amount) * 100),
        notes: decision.notes
      })
      setSuccess(`Claim ${claim.claim_number} decision recorded.`)
      await loadData()
    } catch (err) {
      const data = err.response?.data
      setError(data?.detail || data?.approved_cents?.[0] || 'Unable to record the claim decision.')
    }
  }

  const role = me?.role || 'admin'
  const canManageBilling = ['billing', 'admin'].includes(role)
  const opdBills = bills.filter((bill) => bill.care_type !== 'ipd')
  const ipdBills = bills.filter((bill) => bill.care_type === 'ipd')
  const visibleBills = activeSection === 'ipd' ? ipdBills : opdBills

  return (
    <div className="billing-screen">
      <div className="page-heading">
        <div>
          <h1>Billing & Claims</h1>
        </div>
        <div className="page-actions">
          {canManageBilling && (
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={16} /> Generate Itemized Invoice
            </button>
          )}
        </div>
      </div>

      {listFilters}
      {error && (
        <div className="alert alert-error">
          <AlertTriangle size={16} />
          <div style={{ flex: 1 }}>{error}</div>
          <button className="alert-close" onClick={() => setError('')}>&times;</button>
        </div>
      )}
      {showClaimModal && (
        <div className="modal-overlay" onClick={() => setShowClaimModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h3>Create insurance claim</h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowClaimModal(false)} aria-label="Close claim form"><X size={16} /></button>
            </div>
            <form className="panel-body" onSubmit={handleCreateClaim}>
              <div className="form-group">
                <label htmlFor="claim-bill">Invoice</label>
                <select id="claim-bill" required value={claimForm.bill} onChange={(event) => {
                  const bill = bills.find((item) => String(item.id) === event.target.value)
                  setClaimForm({ ...claimForm, bill: event.target.value, requested_amount: bill ? (bill.total_cents / 100).toFixed(2) : '' })
                }}>
                  <option value="">Select an invoice</option>
                  {bills.map((bill) => <option key={bill.id} value={bill.id}>{bill.invoice_number} · ${(bill.total_cents / 100).toFixed(2)}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="claim-payer">Payer name</label>
                  <input id="claim-payer" required maxLength={120} value={claimForm.payer_name} onChange={(event) => setClaimForm({ ...claimForm, payer_name: event.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="claim-member">Member reference</label>
                  <input id="claim-member" required maxLength={100} value={claimForm.member_reference} onChange={(event) => setClaimForm({ ...claimForm, member_reference: event.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="claim-amount">Requested amount ($)</label>
                <input id="claim-amount" type="number" min="0.01" step="0.01" required value={claimForm.requested_amount} onChange={(event) => setClaimForm({ ...claimForm, requested_amount: event.target.value })} />
              </div>
              <div className="form-hint">Creates a simulated draft claim record. It does not submit data to an insurer.</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowClaimModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={submitting}>Create draft</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <div style={{ flex: 1 }}>{success}</div>
          <button className="alert-close" onClick={() => setSuccess('')}>&times;</button>
        </div>
      )}

      {/* Invoices List */}
      <div className="panel">
        <div className="panel-header">
          <h3>{activeSection === 'ipd' ? 'Inpatient bills' : 'Outpatient bills'} ({visibleBills.length})</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>Refresh</button>
        </div>
        <div className="tabs billing-tabs" role="tablist" aria-label="Billing patient type">
          <button type="button" className={`tab-btn ${activeSection === 'opd' ? 'active' : ''}`} onClick={() => setActiveSection('opd')}>
            OPD ({opdBills.length})
          </button>
          <button type="button" className={`tab-btn ${activeSection === 'ipd' ? 'active' : ''}`} onClick={() => setActiveSection('ipd')}>
            IPD ({ipdBills.length})
          </button>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading financial accounts...
            </div>
          ) : visibleBills.length === 0 ? (
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
                {visibleBills.map((bill) => {
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

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <div>
            <h3>Insurance claims ({claims.length})</h3>
            <small className="form-hint">Simulated workflow only; no payer or insurer is contacted.</small>
          </div>
          {canManageBilling && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowClaimModal(true)}>
              <Plus size={14} /> Create claim
            </button>
          )}
        </div>
        <div className="table-wrap">
          {claims.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No claims have been created.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Claim</th><th>Invoice / Patient</th><th>Payer</th><th>Requested</th><th>Approved</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim.id}>
                    <td>{claim.claim_number}</td>
                    <td>{claim.invoice_number}<small style={{ display: 'block' }}>{claim.patient_name}</small></td>
                    <td>{claim.payer_name}<small style={{ display: 'block' }}>{claim.member_reference}</small></td>
                    <td>${(claim.requested_cents / 100).toFixed(2)}</td>
                    <td>${(claim.approved_cents / 100).toFixed(2)}</td>
                    <td><span className={`badge badge-${claim.status}`}>{claim.status.replace('_', ' ')}</span></td>
                    <td>
                      {canManageBilling && claim.status === 'draft' && (
                        <button className="btn btn-primary btn-xs" onClick={() => handleSubmitClaim(claim)}>Submit</button>
                      )}
                      {canManageBilling && claim.status === 'submitted' && (
                        <div style={{ display: 'grid', gap: 4, minWidth: 150 }}>
                          <select
                            aria-label={`Decision for ${claim.claim_number}`}
                            value={claimDecisions[claim.id]?.status || 'approved'}
                            onChange={(event) => setClaimDecisions({
                              ...claimDecisions,
                              [claim.id]: { ...claimDecisions[claim.id], status: event.target.value }
                            })}
                          >
                            <option value="approved">Approve</option>
                            <option value="partially_approved">Partially approve</option>
                            <option value="denied">Deny</option>
                          </select>
                          {(claimDecisions[claim.id]?.status || 'approved') !== 'denied' && (
                            <input
                              aria-label={`Approved amount for ${claim.claim_number}`}
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={claimDecisions[claim.id]?.amount ?? (claim.requested_cents / 100).toFixed(2)}
                              onChange={(event) => setClaimDecisions({
                                ...claimDecisions,
                                [claim.id]: { ...claimDecisions[claim.id], amount: event.target.value }
                              })}
                            />
                          )}
                          <input
                            aria-label={`Decision notes for ${claim.claim_number}`}
                            placeholder="Decision note"
                            value={claimDecisions[claim.id]?.notes || ''}
                            onChange={(event) => setClaimDecisions({
                              ...claimDecisions,
                              [claim.id]: { ...claimDecisions[claim.id], notes: event.target.value }
                            })}
                          />
                          <button className="btn btn-secondary btn-xs" onClick={() => handleAdjudicateClaim(claim)}>Record decision</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
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
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <div className="form-group">
                <label>Select Patient *</label>
                <select
                  required
                  value={invoiceForm.patient}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, patient: e.target.value, encounter: '' })}
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
                  {encounters.filter((enc) => !invoiceForm.patient || String(enc.patient) === invoiceForm.patient).map((enc) => (
                    <option key={enc.id} value={enc.id}>
                      Encounter {enc.id} &mdash; {enc.status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Patient type *</label>
                <select
                  required
                  value={invoiceForm.care_type}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, care_type: e.target.value })}
                >
                  <option value="opd">OPD — Outpatient</option>
                  <option value="ipd">IPD — Inpatient</option>
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
                <label>Payment amount ($) *</label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Payment method *</label>
                <select
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                >
                  <option value="card">Card</option>
                  <option value="mpesa">Mobile money</option>
                  <option value="cash">Cash</option>
                </select>
              </div>

              <div className="form-group">
                <label>Reference (optional)</label>
                <input
                  type="text"
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

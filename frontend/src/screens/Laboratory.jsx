import React, { useState, useEffect } from 'react'
import {
  HeartPulse,
  Plus,
  FileCheck,
  CheckCircle,
  AlertTriangle,
  X,
  Search,
  Filter,
  Microscope,
  Calendar,
  User
} from 'lucide-react'
import {
  getLabOrders,
  createLabOrder,
  getLabResults,
  createLabResult,
  getPatients,
  getEncounters
} from '../api'

export default function Laboratory({ me }) {
  const [activeTab, setActiveTab] = useState('orders')
  const [orders, setOrders] = useState([])
  const [results, setResults] = useState([])
  const [patients, setPatients] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modals
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [selectedOrderForResults, setSelectedOrderForResults] = useState(null)

  // Order form (clinician)
  const [orderForm, setOrderForm] = useState({
    patient: '',
    encounter: '',
    test_name: 'Complete Blood Count (CBC)'
  })

  // Result form (lab staff)
  const [resultForm, setResultForm] = useState({
    result: 'WBC: 6.8 x10^9/L, Hb: 14.2 g/dL, Platelets: 240 x10^9/L',
    reference_range: 'WBC 4.5-11.0, Hb 13.0-17.5',
    status: 'final'
  })

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [oRes, rRes, pRes, eRes] = await Promise.all([
        getLabOrders(),
        getLabResults(),
        getPatients().catch(() => ({ data: [] })),
        getEncounters().catch(() => ({ data: [] }))
      ])

      setOrders(oRes.data?.results || oRes.data || [])
      setResults(rRes.data?.results || rRes.data || [])
      setPatients(pRes.data?.results || pRes.data || [])
      setEncounters(eRes.data?.results || eRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load laboratory records.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateOrder(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await createLabOrder({
        patient: orderForm.patient,
        encounter: orderForm.encounter,
        test_name: orderForm.test_name,
        status: 'ordered'
      })
      setSuccess(`Lab order for "${orderForm.test_name}" submitted successfully.`)
      setShowOrderModal(false)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to submit laboratory order.')
    } finally {
      setSubmitting(false)
    }
  }

  function openEnterResultModal(order) {
    setSelectedOrderForResults(order)
    setShowResultModal(true)
  }

  async function handleCreateResult(e) {
    e.preventDefault()
    if (!selectedOrderForResults) return
    setSubmitting(true)
    setError('')
    try {
      await createLabResult({
        order: selectedOrderForResults.id,
        patient: selectedOrderForResults.patient,
        result: resultForm.result,
        reference_range: resultForm.reference_range,
        status: resultForm.status
      })
      setSuccess(`Result for ${selectedOrderForResults.test_name} recorded and matched to patient chart.`)
      setShowResultModal(false)
      setSelectedOrderForResults(null)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data || 'Failed to enter laboratory result.')
    } finally {
      setSubmitting(false)
    }
  }

  const role = me?.role || 'admin'
  const canOrder = ['clinician', 'admin'].includes(role)
  const canEnterResult = ['lab', 'admin'].includes(role)

  return (
    <div className="lab-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MODULE F06</span>
          <h1>Diagnostic Laboratory Information System</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            Specimen testing, clinician order requisitions, technologist result entry, reference ranges, and chart integration.
          </p>
        </div>
        <div className="page-actions">
          {canOrder && (
            <button className="btn btn-primary" onClick={() => setShowOrderModal(true)}>
              <Plus size={16} /> Order Diagnostic Test
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

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          className={`btn ${activeTab === 'orders' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('orders')}
        >
          <Microscope size={16} /> Lab Orders Queue ({orders.length})
        </button>
        <button
          className={`btn ${activeTab === 'results' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('results')}
        >
          <FileCheck size={16} /> Verified Lab Results ({results.length})
        </button>
      </div>

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <div className="panel">
          <div className="panel-header">
            <h3>Laboratory Requisitions</h3>
            <button className="btn btn-secondary btn-sm" onClick={loadData}>Refresh</button>
          </div>
          <div className="table-wrap">
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                Loading requisitions...
              </div>
            ) : orders.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                No active lab orders found.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ordered Date</th>
                    <th>Patient</th>
                    <th>Diagnostic Test</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const pt = patients.find((p) => p.id === o.patient)
                    const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${o.patient?.slice ? o.patient.slice(0, 8) : o.patient}`
                    return (
                      <tr key={o.id}>
                        <td>{new Date(o.created_at).toLocaleString()}</td>
                        <td>
                          <strong>{ptName}</strong>
                        </td>
                        <td>
                          <strong>{o.test_name}</strong>
                        </td>
                        <td>
                          <span className={`badge badge-${o.status}`}>{o.status}</span>
                        </td>
                        <td>
                          {canEnterResult && o.status !== 'reviewed' && (
                            <button
                              className="btn btn-primary btn-xs"
                              onClick={() => openEnterResultModal(o)}
                            >
                              Enter Result
                            </button>
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
      )}

      {/* Results Tab */}
      {activeTab === 'results' && (
        <div className="panel">
          <div className="panel-header">
            <h3>Laboratory Results Log</h3>
            <button className="btn btn-secondary btn-sm" onClick={loadData}>Refresh</button>
          </div>
          <div className="table-wrap">
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                Loading results...
              </div>
            ) : results.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                No verified lab results recorded yet.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Verified Timestamp</th>
                    <th>Patient</th>
                    <th>Quantitative / Qualitative Findings</th>
                    <th>Reference Range</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const pt = patients.find((p) => p.id === r.patient)
                    const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${r.patient?.slice ? r.patient.slice(0, 8) : r.patient}`
                    return (
                      <tr key={r.id}>
                        <td>{new Date(r.created_at).toLocaleString()}</td>
                        <td>
                          <strong>{ptName}</strong>
                        </td>
                        <td>
                          <strong style={{ color: 'var(--navy)' }}>{r.result}</strong>
                        </td>
                        <td>
                          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                            {r.reference_range || 'Normal'}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-green">{r.status}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Order Test Modal (Clinician) */}
      {showOrderModal && (
        <div className="modal-overlay" onClick={() => setShowOrderModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Order Diagnostic Laboratory Test</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowOrderModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateOrder} className="panel-body">
              <div className="form-group">
                <label>Select Patient *</label>
                <select
                  required
                  value={orderForm.patient}
                  onChange={(e) => setOrderForm({ ...orderForm, patient: e.target.value })}
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
                <label>Select Active Encounter *</label>
                <select
                  required
                  value={orderForm.encounter}
                  onChange={(e) => setOrderForm({ ...orderForm, encounter: e.target.value })}
                >
                  <option value="">-- Choose Encounter --</option>
                  {encounters
                    .filter((e) => !orderForm.patient || e.patient === orderForm.patient)
                    .map((enc) => (
                      <option key={enc.id} value={enc.id}>
                        Encounter {enc.id.slice(0, 8)} &mdash; {enc.status}
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-group">
                <label>Test Panel / Investigation *</label>
                <select
                  value={orderForm.test_name}
                  onChange={(e) => setOrderForm({ ...orderForm, test_name: e.target.value })}
                >
                  <option value="Complete Blood Count (CBC)">Complete Blood Count (CBC)</option>
                  <option value="Basic Metabolic Panel (BMP)">Basic Metabolic Panel (BMP)</option>
                  <option value="Comprehensive Metabolic Panel (CMP)">Comprehensive Metabolic Panel (CMP)</option>
                  <option value="Lipid Profile">Lipid Profile</option>
                  <option value="Liver Function Test (LFT)">Liver Function Test (LFT)</option>
                  <option value="Urinalysis Routine">Urinalysis Routine</option>
                  <option value="Blood Glucose Fasting">Blood Glucose Fasting</option>
                  <option value="HbA1c Glycated Hemoglobin">HbA1c Glycated Hemoglobin</option>
                  <option value="Rapid Malaria Antigen">Rapid Malaria Antigen</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowOrderModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Submitting Order...' : 'Submit Requisition'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enter Result Modal (Lab staff) */}
      {showResultModal && selectedOrderForResults && (
        <div className="modal-overlay" onClick={() => setShowResultModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Enter Laboratory Test Result</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowResultModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateResult} className="panel-body">
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '14px', border: '1px solid var(--line)' }}>
                <div><strong>Test:</strong> {selectedOrderForResults.test_name}</div>
                <div><strong>Order ID:</strong> {selectedOrderForResults.id}</div>
              </div>

              <div className="form-group">
                <label>Test Result Findings *</label>
                <textarea
                  required
                  placeholder="Enter numerical findings, units, or qualitative analysis..."
                  value={resultForm.result}
                  onChange={(e) => setResultForm({ ...resultForm, result: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Reference Range</label>
                <input
                  type="text"
                  placeholder="e.g. 4.5 - 11.0 x10^9/L"
                  value={resultForm.reference_range}
                  onChange={(e) => setResultForm({ ...resultForm, reference_range: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Result Verification Status</label>
                <select
                  value={resultForm.status}
                  onChange={(e) => setResultForm({ ...resultForm, status: e.target.value })}
                >
                  <option value="final">Final (Verified & Signed)</option>
                  <option value="preliminary">Preliminary</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowResultModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Verifying...' : 'Commit & Sign Result'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

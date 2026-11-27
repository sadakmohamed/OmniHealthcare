import React, { useState, useEffect } from 'react'
import {
  Plus,
  FileCheck,
  CheckCircle,
  AlertTriangle,
  X,
  Search,
  Microscope,
} from 'lucide-react'
import {
  getLabOrders,
  createLabOrder,
  reviewLabOrder,
  getLabResults,
  getLabTests,
  createLabResult,
  getPatients,
  getEncounters
} from '../api'

export default function Laboratory({ me }) {
  const [activeTab, setActiveTab] = useState('orders')
  const [orders, setOrders] = useState([])
  const [results, setResults] = useState([])
  const [labTests, setLabTests] = useState([])
  const [patients, setPatients] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [patientSearch, setPatientSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')

  // Modals
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [selectedOrderForResults, setSelectedOrderForResults] = useState(null)
  const [amendedResult, setAmendedResult] = useState(null)

  // Order form (clinician)
  const [orderForm, setOrderForm] = useState({
    patient: '',
    encounter: '',
    test_name: ''
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
      const [oRes, rRes, pRes, eRes, tRes] = await Promise.all([
        getLabOrders(),
        getLabResults(),
        getPatients().catch(() => ({ data: [] })),
        getEncounters().catch(() => ({ data: [] })),
        ['clinician', 'admin'].includes(me?.role) ? getLabTests() : Promise.resolve({ data: [] })
      ])

      setOrders(oRes.data?.results || oRes.data || [])
      setResults(rRes.data?.results || rRes.data || [])
      setLabTests(tRes.data.filter((test) => test.active))
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
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data || 'Failed to submit laboratory order.'))
    } finally {
      setSubmitting(false)
    }
  }

  function openEnterResultModal(order) {
    setAmendedResult(null)
    setResultForm({ result: '', reference_range: '', status: 'final' })
    setSelectedOrderForResults(order)
    setShowResultModal(true)
  }

  function openAmendResultModal(result) {
    setAmendedResult(result)
    setSelectedOrderForResults({ id: result.order, patient: result.patient, test_name: result.test_name })
    setResultForm({ result: result.result, reference_range: result.reference_range, status: result.status })
    setShowResultModal(true)
  }

  async function handleReview(orderId) {
    setError('')
    try {
      await reviewLabOrder(orderId)
      setSuccess('Laboratory result reviewed.')
      await loadData()
    } catch (err) {
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data || 'Failed to review result.'))
    }
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
        status: resultForm.status,
        ...(amendedResult ? { amended_from: amendedResult.id } : {})
      })
      setSuccess(`Result for ${selectedOrderForResults.test_name} recorded and awaiting clinician review.`)
      setShowResultModal(false)
      setSelectedOrderForResults(null)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data || 'Failed to enter laboratory result.'))
    } finally {
      setSubmitting(false)
    }
  }

  const role = me?.role || 'admin'
  const canOrder = ['clinician', 'admin'].includes(role)
  const canEnterResult = ['lab', 'admin'].includes(role)
  const searchTerm = patientSearch.trim().toLowerCase()
  const matchesFilters = (record) => {
    const patient = patients.find((item) => item.id === record.patient)
    const patientDetails = [
      patient?.first_name,
      patient?.last_name,
      patient?.medical_record_number,
      patient?.id,
      record.patient
    ].filter(Boolean).join(' ').toLowerCase()
    const timestamp = new Date(record.created_at)
    const localDate = Number.isNaN(timestamp.getTime())
      ? ''
      : `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}`

    return (!searchTerm || patientDetails.includes(searchTerm))
      && (!departmentFilter || (record.care_type || 'opd') === departmentFilter)
      && (!dateFilter || localDate === dateFilter)
  }
  const filteredOrders = orders.filter(matchesFilters)
  const filteredResults = results.filter(matchesFilters)

  return (
    <div className="lab-screen">
      <div className="page-heading">
        <div>
          <h1>Laboratory</h1>
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
          <FileCheck size={16} /> Lab Results ({results.length})
        </button>
      </div>

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <div className="panel">
          <div className="panel-header">
            <h3>Laboratory Requisitions</h3>
            <button className="btn btn-secondary btn-sm" onClick={loadData}>Refresh</button>
          </div>
          <div className="toolbar">
            <div className="toolbar-search">
              <Search size={16} />
              <input
                aria-label="Search laboratory patients"
                placeholder="Search patient name or ID"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />
            </div>
            <select
              className="filter-select"
              aria-label="Filter laboratory by department"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
            >
              <option value="">All departments</option>
              <option value="opd">OPD</option>
              <option value="ipd">IPD</option>
            </select>
            <input
              className="filter-select"
              type="date"
              aria-label="Filter laboratory by date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>
          <div className="table-wrap">
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                Loading requisitions...
              </div>
            ) : filteredOrders.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                {orders.length ? 'No lab orders match the selected filters.' : 'No active lab orders found.'}
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ordered Date</th>
                    <th>Patient</th>
                    <th>Patient type</th>
                    <th>Diagnostic Test</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => {
                    const pt = patients.find((p) => p.id === o.patient)
                    const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${o.patient?.slice ? o.patient.slice(0, 8) : o.patient}`
                    return (
                      <tr key={o.id}>
                        <td>{new Date(o.created_at).toLocaleString()}</td>
                        <td>
                          <strong>{ptName}</strong>
                        </td>
                        <td><span className={`badge ${o.care_type === 'ipd' ? 'badge-blue' : 'badge-gray'}`}>{o.care_type === 'ipd' ? 'IPD' : 'OPD'}</span></td>
                        <td>
                          <strong>{o.test_name}</strong>
                        </td>
                        <td>
                          <span className={`badge badge-${o.status}`}>{o.status}</span>
                        </td>
                        <td>
                          {canEnterResult && o.status === 'ordered' && (
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
          <div className="toolbar">
            <div className="toolbar-search">
              <Search size={16} />
              <input
                aria-label="Search laboratory patients"
                placeholder="Search patient name or ID"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />
            </div>
            <select
              className="filter-select"
              aria-label="Filter laboratory by department"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
            >
              <option value="">All departments</option>
              <option value="opd">OPD</option>
              <option value="ipd">IPD</option>
            </select>
            <input
              className="filter-select"
              type="date"
              aria-label="Filter laboratory by date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>
          <div className="table-wrap">
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                Loading results...
              </div>
            ) : filteredResults.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                {results.length ? 'No results match the selected filters.' : 'No lab results recorded yet.'}
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Recorded Timestamp</th>
                    <th>Patient</th>
                    <th>Patient type</th>
                    <th>Diagnostic Test</th>
                    <th>Quantitative / Qualitative Findings</th>
                    <th>Reference Range</th>
                    <th>Status</th>
                    <th>Review</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r) => {
                    const pt = patients.find((p) => p.id === r.patient)
                    const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${r.patient?.slice ? r.patient.slice(0, 8) : r.patient}`
                    return (
                      <tr key={r.id}>
                        <td>{new Date(r.created_at).toLocaleString()}</td>
                        <td>
                          <strong>{ptName}</strong>
                        </td>
                        <td><span className={`badge ${r.care_type === 'ipd' ? 'badge-blue' : 'badge-gray'}`}>{r.care_type === 'ipd' ? 'IPD' : 'OPD'}</span></td>
                        <td>{r.test_name || '—'}</td>
                        <td>
                          <strong style={{ color: 'var(--navy)' }}>{r.result}</strong>
                        </td>
                        <td>
                          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                            {r.reference_range || '—'}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-green">{r.status}</span>
                        </td>
                        <td>{r.is_current ? r.order_status : 'Superseded'}</td>
                        <td>
                          {r.is_current && r.order_status === 'resulted' && canOrder && (
                            <button type="button" className="btn btn-secondary btn-xs" onClick={() => handleReview(r.order)}>Review</button>
                          )}{' '}
                          {r.is_current && ['resulted', 'reviewed'].includes(r.order_status) && canEnterResult && (
                            <button type="button" className="btn btn-secondary btn-xs" onClick={() => openAmendResultModal(r)}>Correct</button>
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
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <div className="form-group">
                <label>Select Patient *</label>
                <select
                  required
                  value={orderForm.patient}
                  onChange={(e) => setOrderForm({ ...orderForm, patient: e.target.value, encounter: '' })}
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
                    .filter((e) => !orderForm.patient || String(e.patient) === orderForm.patient)
                    .map((enc) => (
                      <option key={enc.id} value={enc.id}>
                        Encounter {enc.id} &mdash; {enc.status}
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-group">
                <label>Test Panel / Investigation *</label>
                <select
                  required
                  value={orderForm.test_name}
                  onChange={(e) => setOrderForm({ ...orderForm, test_name: e.target.value })}
                >
                  <option value="">-- Choose an active test --</option>
                  {labTests.map((test) => <option key={test.id} value={test.name}>{test.name}</option>)}
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
              <h3>{amendedResult ? 'Correct Laboratory Result' : 'Enter Laboratory Test Result'}</h3>
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
                <label>Result Status</label>
                <select
                  value={resultForm.status}
                  onChange={(e) => setResultForm({ ...resultForm, status: e.target.value })}
                >
                  <option value="final">Final</option>
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

import React, { useState, useEffect } from 'react'
import {
  Plus,
  CheckCircle,
  AlertTriangle,
  X,
  Check,
  Search,
} from 'lucide-react'
import {
  getPrescriptions,
  createPrescription,
  dispensePrescription,
  getPatients,
  getEncounters,
  getInpatientMedicationPlans
} from '../api'

export default function Pharmacy({ me }) {
  const [prescriptions, setPrescriptions] = useState([])
  const [inpatientPlans, setInpatientPlans] = useState([])
  const [patients, setPatients] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [patientSearch, setPatientSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [activeSection, setActiveSection] = useState('opd')

  // Modal to authorize prescription
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    patient: '',
    encounter: '',
    medication: 'Amoxicillin 500mg Capsule',
    dosage: '1 capsule three times daily for 7 days',
    instructions: 'Take with food and full glass of water. Complete entire course.'
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [pRes, ptRes, eRes, ipdRes] = await Promise.all([
        getPrescriptions(),
        getPatients().catch(() => ({ data: [] })),
        getEncounters().catch(() => ({ data: [] })),
        getInpatientMedicationPlans()
      ])

      setPrescriptions(pRes.data?.results || pRes.data || [])
      setInpatientPlans(ipdRes.data?.results || ipdRes.data || [])
      setPatients(ptRes.data?.results || ptRes.data || [])
      setEncounters(eRes.data?.results || eRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load pharmacy prescriptions.')
    } finally {
      setLoading(false)
    }
  }

  async function handleAuthorize(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await createPrescription({
        patient: form.patient,
        encounter: form.encounter,
        medication: form.medication,
        dosage: form.dosage,
        instructions: form.instructions
      })
      setSuccess(`Prescription for "${form.medication}" authorized by clinical staff.`)
      setShowModal(false)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || JSON.stringify(err.response?.data || 'Failed to authorize prescription.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDispense(id, medName) {
    setError('')
    try {
      await dispensePrescription(id)
      setSuccess(`Medication "${medName}" marked as dispensed by pharmacy.`)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Only pharmacy staff may dispense prescriptions.')
    }
  }

  const role = me?.role || 'admin'
  const canPrescribe = role === 'admin'
  const canDispense = ['pharmacist', 'admin'].includes(role)

  const filtered = filterStatus
    ? prescriptions.filter((p) => p.status === filterStatus)
    : prescriptions
  const searchTerm = patientSearch.trim().toLowerCase()
  const sectionPrescriptions = activeSection === 'opd' ? filtered : inpatientPlans
  const visiblePrescriptions = sectionPrescriptions.filter((rx) => {
    const patientId = activeSection === 'ipd' ? rx.patient_mrn : rx.patient
    const patient = patients.find((item) =>
      item.id === patientId || (activeSection === 'ipd' && item.medical_record_number === patientId)
    )
    const patientDetails = activeSection === 'ipd'
      ? `${rx.patient_name || ''} ${rx.patient_mrn || ''} ${patient?.id || ''}`
      : `${patient?.first_name || ''} ${patient?.last_name || ''} ${patient?.medical_record_number || ''} ${patientId || ''}`
    const timestamp = new Date(rx.created_at)
    const localDate = Number.isNaN(timestamp.getTime())
      ? ''
      : `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}`

    return (!searchTerm || patientDetails.toLowerCase().includes(searchTerm))
      && (!dateFilter || localDate === dateFilter)
  })

  return (
    <div className="pharmacy-screen">
      <div className="page-heading">
        <div>
          <h1>Pharmacy</h1>
        </div>
        <div className="page-actions">
          {canPrescribe && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Authorize Prescription
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

      {/* Toolbar */}
      <div className="tabs pharmacy-tabs" role="tablist" aria-label="Prescription patient type">
        <button type="button" className={`tab-btn ${activeSection === 'opd' ? 'active' : ''}`} onClick={() => setActiveSection('opd')}>
          OPD prescriptions ({prescriptions.length})
        </button>
        <button type="button" className={`tab-btn ${activeSection === 'ipd' ? 'active' : ''}`} onClick={() => setActiveSection('ipd')}>
          IPD medication plans ({inpatientPlans.length})
        </button>
      </div>
      <div className="toolbar">
        <div className="toolbar-search">
          <Search size={16} />
          <input
            aria-label="Search pharmacy patients"
            placeholder="Search patient name or ID"
            value={patientSearch}
            onChange={(e) => setPatientSearch(e.target.value)}
          />
        </div>
        <input
          className="filter-select"
          type="date"
          aria-label="Filter pharmacy by date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        />
        {activeSection === 'opd' && (
          <select
            className="filter-select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All Statuses ({prescriptions.length})</option>
            <option value="authorized">Authorized / Pending Dispensing</option>
            <option value="dispensed">Dispensed & Fulfilled</option>
          </select>
        )}
        <button className="btn btn-secondary" onClick={loadData}>
          Refresh
        </button>
      </div>

      {/* Prescriptions Table */}
      <div className="panel">
        <div className="panel-header">
          <h3>{activeSection === 'ipd' ? 'Inpatient medication plans' : 'OPD prescriptions'}</h3>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading pharmacy orders...
            </div>
          ) : visiblePrescriptions.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No prescriptions found for the selected filter.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Authorized Date</th>
                  <th>Patient</th>
                  <th>Medication & Strength</th>
                  <th>Dosage Regimen</th>
                  <th>Instructions</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visiblePrescriptions.map((rx) => {
                  const patientId = activeSection === 'ipd' ? null : rx.patient
                  const pt = patients.find((p) => p.id === patientId)
                  const ptName = activeSection === 'ipd'
                    ? `${rx.patient_name || 'Inpatient'}${rx.ward_name ? ` · ${rx.ward_name}` : ''}`
                    : pt
                      ? `${pt.first_name} ${pt.last_name}`
                      : `Patient ${patientId?.slice ? patientId.slice(0, 8) : patientId}`
                  return (
                    <tr key={rx.id}>
                      <td>
                        <strong>{new Date(rx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {new Date(rx.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td>
                        <strong>{ptName}</strong>
                      </td>
                      <td>
                        <strong style={{ color: 'var(--navy)' }}>{rx.medication}</strong>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{rx.dosage}</span>
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--muted)', maxWidth: '240px' }}>
                        {activeSection === 'ipd' && <strong style={{ display: 'block', marginBottom: '3px' }}>Prescribed by {rx.prescribed_by_name}</strong>}
                        {rx.instructions || (activeSection === 'ipd' ? '—' : 'Standard dosing schedule.')}
                      </td>
                      <td>
                        <span className={`badge badge-${activeSection === 'ipd' ? rx.status : rx.status}`}>
                          {rx.status}
                        </span>
                        {activeSection === 'opd' && rx.dispensed_at && (
                          <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>
                            at {new Date(rx.dispensed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </td>
                      <td>
                        {activeSection === 'opd' && rx.status === 'authorized' && canDispense && (
                          <button
                            className="btn btn-success btn-xs"
                            onClick={() => handleDispense(rx.id, rx.medication)}
                          >
                            <Check size={12} /> Dispense
                          </button>
                        )}
                        {activeSection === 'opd' && rx.status === 'dispensed' && (
                          <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>
                            Fulfilled
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

      {/* Authorize Prescription Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Authorize New Prescription</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAuthorize} className="panel-body">
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <div className="form-group">
                <label>Select Patient *</label>
                <select
                  required
                  value={form.patient}
                  onChange={(e) => setForm({ ...form, patient: e.target.value, encounter: '' })}
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
                <label>Select Active Clinical Encounter *</label>
                <select
                  required
                  value={form.encounter}
                  onChange={(e) => setForm({ ...form, encounter: e.target.value })}
                >
                  <option value="">-- Choose Encounter --</option>
                  {encounters
                    .filter((e) => !form.patient || String(e.patient) === form.patient)
                    .map((enc) => (
                      <option key={enc.id} value={enc.id}>
                        Encounter {enc.id} &mdash; {enc.status}
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-group">
                <label>Medication & Strength *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Metformin 500mg, Amoxicillin 500mg, Amlodipine 5mg"
                  value={form.medication}
                  onChange={(e) => setForm({ ...form, medication: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Dosage Regimen *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 1 tablet twice daily with meals"
                  value={form.dosage}
                  onChange={(e) => setForm({ ...form, dosage: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Patient Clinical Instructions</label>
                <textarea
                  placeholder="e.g. Drink plenty of water, avoid alcohol, take after breakfast..."
                  value={form.instructions}
                  onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Authorizing...' : 'Authorize Prescription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

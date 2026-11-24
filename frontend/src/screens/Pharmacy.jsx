import React, { useState, useEffect } from 'react'
import {
  Pill,
  Plus,
  CheckCircle,
  AlertTriangle,
  X,
  Search,
  Check,
  Clock,
  ShieldAlert
} from 'lucide-react'
import {
  getPrescriptions,
  createPrescription,
  dispensePrescription,
  getPatients,
  getEncounters
} from '../api'

export default function Pharmacy({ me }) {
  const [prescriptions, setPrescriptions] = useState([])
  const [patients, setPatients] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

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
      const [pRes, ptRes, eRes] = await Promise.all([
        getPrescriptions(),
        getPatients().catch(() => ({ data: [] })),
        getEncounters().catch(() => ({ data: [] }))
      ])

      setPrescriptions(pRes.data?.results || pRes.data || [])
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
      setError(err.response?.data?.detail || 'Only authorized clinicians can prescribe medication.')
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
  const canPrescribe = ['clinician', 'admin'].includes(role)
  const canDispense = ['pharmacist', 'admin'].includes(role)

  const filtered = filterStatus
    ? prescriptions.filter((p) => p.status === filterStatus)
    : prescriptions

  return (
    <div className="pharmacy-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MODULE F07</span>
          <h1>Clinical Pharmacy & Medication Dispensing</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            Simulated medication orders, clinician e-prescribing authorization, dosage instructions, and pharmacist dispensing verification.
          </p>
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

      <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ShieldAlert size={18} color="#92400e" />
        <div>
          <strong>SIMULATED PHARMACY WORKFLOW:</strong> Clinicians authorize medication orders; pharmacists verify and record dispensing. Role boundaries strictly enforced server-side.
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <select
          className="filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses ({prescriptions.length})</option>
          <option value="authorized">Authorized / Pending Dispensing</option>
          <option value="dispensed">Dispensed & Fulfilled</option>
        </select>
        <button className="btn btn-secondary" onClick={loadData}>
          Refresh
        </button>
      </div>

      {/* Prescriptions Table */}
      <div className="panel">
        <div className="panel-header">
          <h3>Prescriptions Queue</h3>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading pharmacy orders...
            </div>
          ) : filtered.length === 0 ? (
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
                {filtered.map((rx) => {
                  const pt = patients.find((p) => p.id === rx.patient)
                  const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${rx.patient?.slice ? rx.patient.slice(0, 8) : rx.patient}`
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
                        {rx.instructions || 'Standard dosing schedule.'}
                      </td>
                      <td>
                        <span className={`badge badge-${rx.status}`}>{rx.status}</span>
                        {rx.dispensed_at && (
                          <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>
                            at {new Date(rx.dispensed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </td>
                      <td>
                        {rx.status === 'authorized' && canDispense && (
                          <button
                            className="btn btn-success btn-xs"
                            onClick={() => handleDispense(rx.id, rx.medication)}
                          >
                            <Check size={12} /> Dispense
                          </button>
                        )}
                        {rx.status === 'dispensed' && (
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
              <div className="form-group">
                <label>Select Patient *</label>
                <select
                  required
                  value={form.patient}
                  onChange={(e) => setForm({ ...form, patient: e.target.value })}
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
                    .filter((e) => !form.patient || e.patient === form.patient)
                    .map((enc) => (
                      <option key={enc.id} value={enc.id}>
                        Encounter {enc.id.slice(0, 8)} &mdash; {enc.status}
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

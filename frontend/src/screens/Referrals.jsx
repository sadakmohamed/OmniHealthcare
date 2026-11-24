import React, { useState, useEffect } from 'react'
import {
  Share2,
  Plus,
  CheckCircle,
  AlertTriangle,
  X,
  ExternalLink,
  Building,
  User,
  Clock
} from 'lucide-react'
import {
  getReferrals,
  createReferral,
  updateReferral,
  getPatients,
  getEncounters
} from '../api'

export default function Referrals({ me }) {
  const [referrals, setReferrals] = useState([])
  const [patients, setPatients] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    patient: '',
    encounter: '',
    specialty: 'Cardiology',
    destination: 'Nairobi National Referral Hospital',
    summary: 'Referral for comprehensive echocardiogram and specialist cardiologist review.'
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [rRes, pRes, eRes] = await Promise.all([
        getReferrals(),
        getPatients().catch(() => ({ data: [] })),
        getEncounters().catch(() => ({ data: [] }))
      ])

      setReferrals(rRes.data?.results || rRes.data || [])
      setPatients(pRes.data?.results || pRes.data || [])
      setEncounters(eRes.data?.results || eRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load referrals.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await createReferral({
        patient: form.patient,
        encounter: form.encounter || null,
        specialty: form.specialty,
        destination: form.destination,
        summary: form.summary,
        status: 'requested'
      })
      setSuccess(`Specialist referral to ${form.destination} created.`)
      setShowModal(false)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create referral.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStatusChange(id, newStatus) {
    setError('')
    try {
      await updateReferral(id, { status: newStatus })
      setSuccess(`Referral status updated to ${newStatus}.`)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update referral.')
    }
  }

  const role = me?.role || 'admin'
  const canCreate = ['clinician', 'admin'].includes(role)

  return (
    <div className="referrals-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MODULE F08</span>
          <h1>Clinical Referral Management & Specialist Tracking</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            External destination centers, clinical handover summaries, specialty consultations, and cross-facility continuity.
          </p>
        </div>
        <div className="page-actions">
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Create Specialist Referral
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

      {/* Referrals Table */}
      <div className="panel">
        <div className="panel-header">
          <h3>Tracked Referrals ({referrals.length})</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>Refresh</button>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading referrals...
            </div>
          ) : referrals.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No specialist referrals documented yet.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Patient</th>
                  <th>Target Specialty</th>
                  <th>Destination Center</th>
                  <th>Clinical Referral Summary</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((ref) => {
                  const pt = patients.find((p) => p.id === ref.patient)
                  const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${ref.patient?.slice ? ref.patient.slice(0, 8) : ref.patient}`
                  return (
                    <tr key={ref.id}>
                      <td>{new Date(ref.created_at).toLocaleDateString()}</td>
                      <td>
                        <strong>{ptName}</strong>
                      </td>
                      <td>
                        <span className="badge badge-blue">{ref.specialty}</span>
                      </td>
                      <td>
                        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Building size={14} color="var(--muted)" />
                          {ref.destination}
                        </strong>
                      </td>
                      <td style={{ fontSize: '13px', color: 'var(--navy)', maxWidth: '280px' }}>
                        {ref.summary || 'Clinical handover notes'}
                      </td>
                      <td>
                        <span className={`badge badge-${ref.status}`}>{ref.status}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {ref.status === 'requested' && (
                            <button
                              className="btn btn-success btn-xs"
                              onClick={() => handleStatusChange(ref.id, 'accepted')}
                            >
                              Mark Accepted
                            </button>
                          )}
                          {ref.status === 'accepted' && (
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() => handleStatusChange(ref.id, 'completed')}
                            >
                              Complete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Referral Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Create Specialist Clinical Referral</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="panel-body">
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
                <label>Target Clinical Specialty *</label>
                <select
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                >
                  <option value="Cardiology">Cardiology</option>
                  <option value="Neurology">Neurology</option>
                  <option value="Orthopedic Surgery">Orthopedic Surgery</option>
                  <option value="Oncology">Oncology</option>
                  <option value="Ophthalmology">Ophthalmology</option>
                  <option value="Nephrology">Nephrology</option>
                  <option value="Pulmonology">Pulmonology</option>
                </select>
              </div>

              <div className="form-group">
                <label>Destination Hospital / Specialty Center *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Regional University Teaching Hospital"
                  value={form.destination}
                  onChange={(e) => setForm({ ...form, destination: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Clinical Summary & Reason for Transfer</label>
                <textarea
                  required
                  placeholder="Detail symptoms, relevant investigations, and requested specialist evaluation..."
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
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
                  {submitting ? 'Creating...' : 'Submit Referral'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

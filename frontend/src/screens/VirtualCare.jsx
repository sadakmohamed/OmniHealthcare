import React, { useState, useEffect } from 'react'
import {
  Video,
  Plus,
  CheckCircle,
  AlertTriangle,
  X,
  Play,
  Pause,
  Clock,
  User,
  ShieldCheck,
  Radio,
  FileText
} from 'lucide-react'
import {
  getVirtualSessions,
  createVirtualSession,
  transitionVirtualSession,
  getPatients,
  getClinicians
} from '../api'

export default function VirtualCare({ me }) {
  const [sessions, setSessions] = useState([])
  const [patients, setPatients] = useState([])
  const [clinicians, setClinicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    patient: '',
    clinician: '',
    scheduled_at: ''
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [sRes, pRes, cRes] = await Promise.all([
        getVirtualSessions(),
        getPatients().catch(() => ({ data: [] })),
        getClinicians().catch(() => ({ data: [] }))
      ])

      setSessions(sRes.data?.results || sRes.data || [])
      setPatients(pRes.data?.results || pRes.data || [])
      setClinicians(cRes.data?.results || cRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load virtual care sessions.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const dateObj = new Date(form.scheduled_at)
      await createVirtualSession({
        patient: form.patient,
        clinician: form.clinician,
        scheduled_at: dateObj.toISOString(),
        status: 'booked'
      })
      setSuccess('Virtual consultation session booked successfully.')
      setShowModal(false)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to book virtual care visit.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleTransition(id, targetStatus) {
    setError('')
    try {
      await transitionVirtualSession(id, targetStatus)
      setSuccess(`Session transitioned to "${targetStatus.toUpperCase()}".`)
      loadData()
    } catch (err) {
      const msg = err.response?.data?.status || err.response?.data?.detail || 'Invalid virtual care transition.'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
  }

  const role = me?.role || 'admin'
  const isClinicianOrAdmin = ['clinician', 'admin'].includes(role)

  const allowedTransitions = {
    booked: ['intake', 'cancelled'],
    intake: ['waiting', 'cancelled'],
    waiting: ['consulting', 'cancelled'],
    consulting: ['completed', 'waiting'],
    completed: [],
    cancelled: []
  }

  return (
    <div className="virtual-care-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">EXPANDED SCOPE</span>
          <h1>Virtual Care & Telehealth Consultation</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            Simulated telehealth journey: booked &rarr; intake &rarr; waiting &rarr; consulting &rarr; completed, with re-entry and consent verification.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Book Virtual Visit
          </button>
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

      {/* Simulated Virtual Room Banner */}
      <div className="panel" style={{ marginBottom: '20px', background: 'linear-gradient(135deg, #1a3c5e 0%, #00a8e8 100%)', color: '#fff', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', opacity: .85 }}>
              <Radio size={14} color="#4ade80" /> Simulated WebRTC Audio/Video Boundary
            </div>
            <h2 style={{ fontSize: '22px', marginTop: '4px', color: '#fff' }}>OmniHealth Telehealth Engine</h2>
            <p style={{ fontSize: '13px', opacity: .9, marginTop: '4px', maxWidth: '600px' }}>
              Virtual sessions follow rigorous intake, waiting room queueing, and clinician admission. Media devices are simulated without requiring live cameras.
            </p>
          </div>
          <Video size={48} style={{ opacity: .8 }} />
        </div>
      </div>

      {/* Sessions Table */}
      <div className="panel">
        <div className="panel-header">
          <h3>Virtual Care Sessions ({sessions.length})</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>Refresh</button>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading virtual sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No virtual sessions scheduled. Click "+ Book Virtual Visit" to start.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Scheduled Time</th>
                  <th>Patient</th>
                  <th>Attending Clinician</th>
                  <th>Telehealth State</th>
                  <th>Available State Transitions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((sess) => {
                  const pt = patients.find((p) => p.id === sess.patient)
                  const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${sess.patient?.slice ? sess.patient.slice(0, 8) : sess.patient}`
                  const allowed = allowedTransitions[sess.status] || []

                  return (
                    <tr key={sess.id}>
                      <td>
                        <strong>{new Date(sess.scheduled_at).toLocaleDateString()}</strong>{' '}
                        <small style={{ color: 'var(--muted)' }}>{new Date(sess.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                      </td>
                      <td>
                        <strong>{ptName}</strong>
                      </td>
                      <td>
                        <span>{sess.clinician_name || 'Dr. Assigned Clinician'}</span>
                      </td>
                      <td>
                        <span className={`badge badge-${sess.status}`}>{sess.status}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {allowed.map((target) => (
                            <button
                              key={target}
                              className={`btn btn-xs ${target === 'completed' ? 'btn-success' : target === 'cancelled' ? 'btn-danger' : 'btn-primary'}`}
                              onClick={() => handleTransition(sess.id, target)}
                            >
                              &rarr; {target}
                            </button>
                          ))}
                          {allowed.length === 0 && (
                            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Finalized</span>
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

      {/* Book Virtual Session Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Book Simulated Telehealth Consultation</h3>
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
                <label>Select Telehealth Clinician *</label>
                <select
                  required
                  value={form.clinician}
                  onChange={(e) => setForm({ ...form, clinician: e.target.value })}
                >
                  <option value="">-- Choose Clinician --</option>
                  {clinicians.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || `Dr. ${c.specialty}`} ({c.specialty || 'General'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Appointment Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={form.scheduled_at}
                  onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
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
                  {submitting ? 'Booking...' : 'Confirm Virtual Slot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

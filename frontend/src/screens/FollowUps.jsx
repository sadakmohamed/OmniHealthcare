import React, { useState, useEffect } from 'react'
import {
  Bell,
  Plus,
  CheckCircle,
  AlertTriangle,
  X,
  Clock,
  Calendar,
  Check,
  Filter
} from 'lucide-react'
import {
  getFollowUps,
  createFollowUp,
  completeFollowUp,
  getPatients,
  getEncounters
} from '../api'

export default function FollowUps({ me, listFilters }) {
  const [followUps, setFollowUps] = useState([])
  const [patients, setPatients] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filter, setFilter] = useState('all')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    patient: '',
    encounter: '',
    due_at: '',
    message: 'Follow-up on blood pressure control and repeat electrolytes panel.'
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [fRes, pRes, eRes] = await Promise.all([
        getFollowUps(),
        getPatients().catch(() => ({ data: [] })),
        getEncounters().catch(() => ({ data: [] }))
      ])

      setFollowUps(fRes.data?.results || fRes.data || [])
      setPatients(pRes.data?.results || pRes.data || [])
      setEncounters(eRes.data?.results || eRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load follow-up reminders.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const dateObj = new Date(form.due_at)
      await createFollowUp({
        patient: form.patient,
        encounter: form.encounter || null,
        due_at: dateObj.toISOString(),
        message: form.message,
        completed: false
      })
      setSuccess('In-app clinical follow-up reminder scheduled.')
      setShowModal(false)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to schedule follow-up.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMarkComplete(id) {
    setError('')
    try {
      await completeFollowUp(id)
      setSuccess('Follow-up reminder marked as completed.')
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to complete reminder.')
    }
  }

  const role = me?.role || 'admin'
  const canManage = ['receptionist', 'clinician', 'nurse', 'admin'].includes(role)

  const now = new Date()
  const filtered = followUps.filter((f) => {
    if (filter === 'pending') return !f.completed
    if (filter === 'completed') return f.completed
    return true
  })

  return (
    <div className="followups-screen">
      <div className="page-heading">
        <div>
          <h1>Follow-ups</h1>
        </div>
        <div className="page-actions">
          {canManage && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Schedule Reminder
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

      {success && (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <div style={{ flex: 1 }}>{success}</div>
          <button className="alert-close" onClick={() => setSuccess('')}>&times;</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <select
          className="filter-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All Reminders ({followUps.length})</option>
          <option value="pending">Pending Only</option>
          <option value="completed">Completed Only</option>
        </select>
        <button className="btn btn-secondary" onClick={loadData}>
          Refresh
        </button>
      </div>

      {/* Follow-up list */}
      <div className="panel">
        <div className="panel-header">
          <h3>Reminders Schedule</h3>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading reminders...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No follow-up reminders found.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Due Date & Time</th>
                  <th>Patient</th>
                  <th>Reminder Task / Clinical Directive</th>
                  <th>Timing Status</th>
                  <th>Completion</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const pt = patients.find((p) => p.id === f.patient)
                  const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${f.patient?.slice ? f.patient.slice(0, 8) : f.patient}`
                  const dueDate = new Date(f.due_at)
                  const isOverdue = !f.completed && dueDate < now
                  const isToday = !f.completed && dueDate.toDateString() === now.toDateString()

                  return (
                    <tr key={f.id}>
                      <td>
                        <strong>{dueDate.toLocaleDateString()}</strong>{' '}
                        <small style={{ color: 'var(--muted)' }}>{dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                      </td>
                      <td>
                        <strong>{ptName}</strong>
                      </td>
                      <td style={{ fontSize: '13px', color: 'var(--navy)', maxWidth: '320px' }}>
                        {f.message}
                      </td>
                      <td>
                        {f.completed ? (
                          <span className="badge badge-green">Resolved</span>
                        ) : isOverdue ? (
                          <span className="badge badge-red">Overdue</span>
                        ) : isToday ? (
                          <span className="badge badge-amber">Due Today</span>
                        ) : (
                          <span className="badge badge-blue">Upcoming</span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: '12px', color: f.completed ? '#16a34a' : 'var(--muted)', fontWeight: 600 }}>
                          {f.completed ? '✓ Completed' : 'Pending Action'}
                        </span>
                      </td>
                      <td>
                        {!f.completed && canManage && (
                          <button
                            className="btn btn-success btn-xs"
                            onClick={() => handleMarkComplete(f.id)}
                          >
                            <Check size={12} /> Mark Done
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

      {/* Create Follow-Up Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Schedule Clinical Follow-Up Reminder</h3>
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
                <label>Due Date & Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={form.due_at}
                  onChange={(e) => setForm({ ...form, due_at: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Reminder Directive / Reason</label>
                <textarea
                  required
                  placeholder="e.g. Check repeat blood pressure, evaluate medication tolerability..."
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
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
                  {submitting ? 'Scheduling...' : 'Set Reminder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import {
  CalendarDays,
  Plus,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Stethoscope,
  Filter,
  AlertTriangle,
  X
} from 'lucide-react'
import {
  getAppointments,
  createAppointment,
  checkInAppointment,
  cancelAppointment,
  getPatients,
  getClinicians,
  createEncounter
} from '../api'

export default function Appointments({ me, onNavigate }) {
  const [appointments, setAppointments] = useState([])
  const [patients, setPatients] = useState([])
  const [clinicians, setClinicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Booking modal
  const [showModal, setShowModal] = useState(false)
  const [bookingForm, setBookingForm] = useState({
    patient: '',
    clinician: '',
    starts_at: '',
    reason: ''
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [statusFilter])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      const [apptsRes, ptsRes, clinsRes] = await Promise.all([
        getAppointments(params),
        getPatients().catch(() => ({ data: [] })),
        getClinicians().catch(() => ({ data: [] }))
      ])

      setAppointments(apptsRes.data?.results || apptsRes.data || [])
      setPatients(ptsRes.data?.results || ptsRes.data || [])
      setClinicians(clinsRes.data?.results || clinsRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load appointments.')
    } finally {
      setLoading(false)
    }
  }

  async function handleBook(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      // Ensure ISO UTC timestamp
      const dateObj = new Date(bookingForm.starts_at)
      if (isNaN(dateObj.getTime())) {
        setError('Please provide a valid appointment date and time.')
        setSubmitting(false)
        return
      }

      const payload = {
        patient: bookingForm.patient,
        clinician: bookingForm.clinician,
        starts_at: dateObj.toISOString(),
        reason: bookingForm.reason || 'General Health Consultation'
      }

      await createAppointment(payload)
      setSuccess('Appointment successfully scheduled.')
      setShowModal(false)
      setBookingForm({ patient: '', clinician: '', starts_at: '', reason: '' })
      loadData()
    } catch (err) {
      const data = err.response?.data
      if (data?.starts_at) {
        setError(Array.isArray(data.starts_at) ? data.starts_at.join(', ') : data.starts_at)
      } else if (data?.detail) {
        setError(data.detail)
      } else if (typeof data === 'object') {
        setError(Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('; '))
      } else {
        setError('Failed to book appointment. Double booking is strictly prevented.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCheckIn(id) {
    setError('')
    try {
      await checkInAppointment(id)
      setSuccess('Patient successfully checked in. Ready for nursing triage & vitals.')
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to check in patient.')
    }
  }

  async function handleCancel(id) {
    if (!window.confirm('Are you sure you want to cancel this scheduled appointment?')) return
    setError('')
    try {
      await cancelAppointment(id)
      setSuccess('Appointment marked as cancelled.')
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to cancel appointment.')
    }
  }

  async function handleStartEncounter(appt) {
    try {
      await createEncounter({
        patient: appt.patient,
        clinician: appt.clinician,
        appointment: appt.id,
        status: 'in_progress'
      })
      setSuccess('Clinical encounter opened. Redirecting to consultation...')
      setTimeout(() => onNavigate('encounters'), 800)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to start encounter for this appointment.')
    }
  }

  const role = me?.role || 'admin'
  const canBook = ['admin', 'receptionist', 'clinician', 'patient'].includes(role)
  const canCheckIn = ['admin', 'receptionist', 'nurse'].includes(role)

  return (
    <div className="appointments-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MODULE F02</span>
          <h1>Appointment Scheduling & Availability</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            Clinician availability calendar, double-booking prevention, automated UTC normalization, and check-in workflow.
          </p>
        </div>
        <div className="page-actions">
          {canBook && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Book Appointment
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

      {/* Toolbar / Status Filter */}
      <div className="toolbar">
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="checked_in">Checked In</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="btn btn-secondary" onClick={loadData}>
          Refresh
        </button>
      </div>

      {/* Appointments List Panel */}
      <div className="panel">
        <div className="panel-header">
          <h3>Appointments List ({appointments.length})</h3>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading appointments calendar...
            </div>
          ) : appointments.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No appointments found for the selected criteria.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Scheduled Slot</th>
                  <th>Patient</th>
                  <th>Clinician</th>
                  <th>Clinical Reason</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => {
                  const dateObj = new Date(a.starts_at)
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </td>
                      <td>
                        <strong style={{ fontSize: '14px' }}>
                          {a.patient_name || (patients.find((p) => p.id === a.patient)?.first_name ? `${patients.find((p) => p.id === a.patient).first_name} ${patients.find((p) => p.id === a.patient).last_name}` : `Patient ${a.patient?.slice ? a.patient.slice(0, 8) : a.patient}`)}
                        </strong>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Stethoscope size={14} color="var(--accent)" />
                          {a.clinician_name || (clinicians.find((c) => c.id === a.clinician)?.name || 'Dr. Assigned Clinician')}
                        </span>
                      </td>
                      <td style={{ color: 'var(--navy)', fontSize: '13px' }}>
                        {a.reason || 'Routine follow-up'}
                      </td>
                      <td>
                        <span className={`badge badge-${a.status}`}>
                          {a.status?.replace('_', ' ')}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {a.status === 'scheduled' && canCheckIn && (
                            <button
                              className="btn btn-success btn-xs"
                              onClick={() => handleCheckIn(a.id)}
                            >
                              Check In
                            </button>
                          )}
                          {a.status === 'checked_in' && (role === 'clinician' || role === 'admin') && (
                            <button
                              className="btn btn-primary btn-xs"
                              onClick={() => handleStartEncounter(a)}
                            >
                              Open Encounter
                            </button>
                          )}
                          {a.status === 'scheduled' && (
                            <button
                              className="btn btn-danger btn-xs"
                              onClick={() => handleCancel(a.id)}
                            >
                              Cancel
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

      {/* Book Appointment Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Book Clinician Appointment</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleBook} className="panel-body">
              <div className="form-group">
                <label>Select Patient *</label>
                <select
                  required
                  value={bookingForm.patient}
                  onChange={(e) => setBookingForm({ ...bookingForm, patient: e.target.value })}
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
                <label>Select Clinician *</label>
                <select
                  required
                  value={bookingForm.clinician}
                  onChange={(e) => setBookingForm({ ...bookingForm, clinician: e.target.value })}
                >
                  <option value="">-- Choose Clinician --</option>
                  {clinicians.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || `Dr. ${c.specialty || 'General Practitioner'}`} ({c.specialty || 'General'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Date & Time Slot (Normalized to UTC) *</label>
                <input
                  type="datetime-local"
                  required
                  value={bookingForm.starts_at}
                  onChange={(e) => setBookingForm({ ...bookingForm, starts_at: e.target.value })}
                />
                <span className="form-hint">Server verifies slot availability to prevent double-booking.</span>
              </div>

              <div className="form-group">
                <label>Reason for Visit</label>
                <textarea
                  placeholder="e.g. Follow-up consultation on hypertension, routine lab review"
                  value={bookingForm.reason}
                  onChange={(e) => setBookingForm({ ...bookingForm, reason: e.target.value })}
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
                  {submitting ? 'Confirming...' : 'Confirm Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

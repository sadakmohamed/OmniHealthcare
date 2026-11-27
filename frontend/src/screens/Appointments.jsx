import React, { useCallback, useState, useEffect } from 'react'
import {
  Plus,
  Search,
  CheckCircle,
  Stethoscope,
  AlertTriangle,
  X
} from 'lucide-react'
import {
  getAppointments,
  getAllPages,
  getAppointmentSlots,
  createAppointment,
  checkInAppointment,
  cancelAppointment,
  getPatients,
  getClinicians,
  createVirtualSession,
  linkVirtualAppointmentSession,
  transitionVirtualSession
} from '../api'

function newBookingKey() {
  return globalThis.crypto?.randomUUID?.() || `appointment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function dateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function bookingErrorMessage(error) {
  const data = error.response?.data
  if (!error.response) {
    return 'Cannot reach the hospital API. Check that the backend is running and the /api/ proxy is available.'
  }
  if (data?.detail) return data.detail
  if (data && typeof data === 'object') {
    return Object.entries(data)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('; ')
  }
  if (error.response.status >= 500) {
    return `The hospital API returned an error (${error.response.status}). Check that database migrations are applied and review the backend logs.`
  }
  return 'The appointment could not be booked.'
}

export default function Appointments({ me, onNavigate }) {
  const [appointments, setAppointments] = useState([])
  const [patients, setPatients] = useState([])
  const [clinicians, setClinicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [visitTypeFilter, setVisitTypeFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Booking modal
  const [showModal, setShowModal] = useState(false)
  const [bookingForm, setBookingForm] = useState({
    patient: '',
    clinician: '',
    date: '',
    starts_at: '',
    visit_type: 'clinic',
    reason: ''
  })
  const [bookingKey, setBookingKey] = useState(() => newBookingKey())
  const [availableSlots, setAvailableSlots] = useState([])
  const [submitting, setSubmitting] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      if (visitTypeFilter) params.visit_type = visitTypeFilter
      if (search.trim()) params.search = search.trim()
      const [apptsRes, ptsRes, clinsRes] = await Promise.all([
        getAllPages(getAppointments, params),
        getAllPages(getPatients),
        getAllPages(getClinicians)
      ])

      setAppointments(apptsRes)
      setPatients(ptsRes)
      setClinicians(clinsRes)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load appointments.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, visitTypeFilter, search])

  const refreshData = useCallback(() => {
    setLoading(true)
    setError('')
    return loadData()
  }, [loadData])

  // State updates here follow the API request, not the effect's synchronous phase.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!showModal || !bookingForm.clinician || !bookingForm.date) {
      return
    }
    let active = true
    getAppointmentSlots(bookingForm.clinician, bookingForm.date)
      .then((response) => {
        if (active) setAvailableSlots(response.data?.slots || [])
      })
      .catch((err) => {
        if (active) {
          setAvailableSlots([])
          setError(bookingErrorMessage(err))
        }
      })
    return () => { active = false }
  }, [showModal, bookingForm.clinician, bookingForm.date])

  async function handleBook(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    let appointmentCreated = false
    try {
      if (!bookingForm.starts_at) {
        setError('Choose an available 30-minute slot.')
        setSubmitting(false)
        return
      }

      const payload = {
        patient: bookingForm.patient,
        clinician: bookingForm.clinician,
        starts_at: bookingForm.starts_at,
        visit_type: bookingForm.visit_type,
        reason: bookingForm.reason || 'General Health Consultation'
      }

      const appointmentResponse = await createAppointment(payload, bookingKey)
      const appointment = appointmentResponse.data
      appointmentCreated = true
      if (bookingForm.visit_type === 'virtual') {
        const patient = patients.find((item) => String(item.id) === String(bookingForm.patient))
        const clinician = clinicians.find((item) => String(item.id) === String(bookingForm.clinician))
        const sessionResponse = await createVirtualSession({
          appointment_id: String(appointment.id),
          patient_id: String(bookingForm.patient),
          patient_name: patient ? `${patient.first_name} ${patient.last_name}`.trim() : '',
          patient_mrn: patient?.medical_record_number || '',
          clinician_id: String(bookingForm.clinician),
          clinician_name: appointment.clinician_name || clinician?.name || '',
          scheduled_at: appointment.starts_at,
          reason: payload.reason
        }, bookingKey)
        await linkVirtualAppointmentSession(appointment.id, String(sessionResponse.data.id))
      }
      setSuccess(bookingForm.visit_type === 'virtual'
        ? 'Virtual appointment and care session booked.'
        : 'Appointment successfully scheduled.')
      setShowModal(false)
      setBookingForm({ patient: '', clinician: '', date: '', starts_at: '', visit_type: 'clinic', reason: '' })
      setBookingKey(newBookingKey())
      refreshData()
    } catch (err) {
      if (appointmentCreated && bookingForm.visit_type === 'virtual') {
        setError(
          `The appointment was booked, but its Virtual Care session was not set up. ${bookingErrorMessage(err)} Start/check the Virtual Care service, then retry without changing the booking; the same appointment will be reused.`
        )
        setLoading(true)
        loadData()
      } else {
        setError(bookingErrorMessage(err))
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
      refreshData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to check in patient.')
    }
  }

  async function handleCancel(appointment) {
    if (!window.confirm('Are you sure you want to cancel this scheduled appointment?')) return
    setError('')
    try {
      if (appointment.visit_type === 'virtual' && appointment.virtual_session_ref) {
        await transitionVirtualSession(appointment.virtual_session_ref, 'cancelled')
      }
      await cancelAppointment(appointment.id)
      setSuccess('Appointment marked as cancelled.')
      refreshData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to cancel appointment.')
    }
  }

  async function handleProvisionVirtualCare(appointment) {
    setError('')
    setSuccess('')
    try {
      const sessionResponse = await createVirtualSession({
        appointment_id: String(appointment.id),
        patient_id: String(appointment.patient),
        patient_name: appointment.patient_name || '',
        patient_mrn: appointment.patient_mrn || '',
        clinician_id: String(appointment.clinician),
        clinician_name: appointment.clinician_name || '',
        scheduled_at: appointment.starts_at,
        reason: appointment.reason || ''
      }, `appointment-${appointment.id}`)
      await linkVirtualAppointmentSession(
        appointment.id,
        String(sessionResponse.data.id)
      )
      setSuccess('Virtual Care session is linked to this appointment.')
      await refreshData()
    } catch (err) {
      const data = err.response?.data
      setError(
        data && typeof data === 'object'
          ? Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('; ')
          : data || 'Failed to link the Virtual Care session.'
      )
    }
  }

  async function handleStartEncounter() {
    try {
      setSuccess('Opening the checked-in patient in the OPD workflow...')
      setTimeout(() => onNavigate('encounters'), 500)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to start encounter for this appointment.')
    }
  }

  const role = me?.role || 'admin'
  const canBook = ['admin', 'receptionist', 'clinician', 'patient'].includes(role)
  const canCheckIn = ['admin', 'receptionist', 'nurse'].includes(role)
  const filteredAppointments = dateFilter
    ? appointments.filter((appointment) => dateKey(new Date(appointment.starts_at)) === dateFilter)
    : appointments
  const calendarStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
  const calendarDays = Array.from({ length: 42 }, (_, index) =>
    new Date(calendarStart.getFullYear(), calendarStart.getMonth(), 1 - calendarStart.getDay() + index))
  const countsByDay = appointments.reduce((counts, appointment) => {
    const key = dateKey(new Date(appointment.starts_at))
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})

  function chooseDate(value) {
    setDateFilter(value)
    if (value) {
      const [year, month] = value.split('-').map(Number)
      setCalendarMonth(new Date(year, month - 1, 1))
    }
  }

  return (
    <div className="appointments-screen">
      <div className="page-heading">
        <div>
          <h1>Appointments</h1>
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
        <label className="toolbar-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search patient, ID, or clinician"
            value={search}
            onChange={(e) => {
              setLoading(true)
              setError('')
              setSearch(e.target.value)
            }}
          />
        </label>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => {
            setLoading(true)
            setError('')
            setStatusFilter(e.target.value)
          }}
        >
          <option value="">All Statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="checked_in">Checked In</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="filter-select"
          value={visitTypeFilter}
          onChange={(e) => {
            setLoading(true)
            setError('')
            setVisitTypeFilter(e.target.value)
          }}
        >
          <option value="">All Visit Types</option>
          <option value="clinic">Clinic</option>
          <option value="virtual">Virtual</option>
        </select>
        <input
          className="filter-select"
          type="date"
          aria-label="Filter appointments by date"
          value={dateFilter}
          onChange={(e) => {
            setError('')
            chooseDate(e.target.value)
          }}
        />
        <button className="btn btn-secondary" onClick={refreshData}>
          Refresh
        </button>
      </div>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h3>Appointment Calendar — {calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Previous month" onClick={() => { setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)); setDateFilter('') }}>Previous</button>
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Next month" onClick={() => { setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)); setDateFilter('') }}>Next</button>
            {dateFilter && <button type="button" className="btn btn-secondary btn-sm" onClick={() => chooseDate('')}>Show all dates</button>}
          </div>
        </div>
        <div className="panel-body">
          <p className="form-hint">Select a day to filter the list. Times use your browser's local time zone.</p>
          <div className="appointment-calendar">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <strong key={day} className="appointment-calendar-heading">{day}</strong>)}
            {calendarDays.map((day) => {
              const key = dateKey(day)
              const count = countsByDay[key] || 0
              return <button type="button" key={key} className={`appointment-calendar-day${dateFilter === key ? ' selected' : ''}${day.getMonth() !== calendarMonth.getMonth() ? ' outside' : ''}`} aria-label={`${day.toLocaleDateString(undefined, { dateStyle: 'full' })}: ${count} appointments`} aria-pressed={dateFilter === key} onClick={() => chooseDate(dateFilter === key ? '' : key)}>
                <span>{day.getDate()}</span>{count > 0 && <small>{count} {count === 1 ? 'appointment' : 'appointments'}</small>}
              </button>
            })}
          </div>
        </div>
      </section>

      {/* Appointments List Panel */}
      <div className="panel">
        <div className="panel-header">
          <h3>Appointments List ({filteredAppointments.length})</h3>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading appointments calendar...
            </div>
          ) : filteredAppointments.length === 0 ? (
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
                  <th>Visit Type</th>
                  <th>Clinical Reason</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAppointments.map((a) => {
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
                      <td><span className={`badge badge-${a.visit_type}`}>{a.visit_type || 'clinic'}</span></td>
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
                              onClick={handleStartEncounter}
                            >
                              Open Encounter
                            </button>
                          )}
                          {a.visit_type === 'virtual' && a.status === 'scheduled' && !a.virtual_session_ref && (
                            <button
                              className="btn btn-primary btn-xs"
                              onClick={() => handleProvisionVirtualCare(a)}
                            >
                              Set up Virtual Care
                            </button>
                          )}
                          {a.visit_type === 'virtual' && a.virtual_session_ref && a.status !== 'cancelled' && (
                            <button
                              className="btn btn-primary btn-xs"
                              onClick={() => onNavigate('virtual')}
                            >
                              Open Virtual Care
                            </button>
                          )}
                          {a.status === 'scheduled' && (
                            <button
                              className="btn btn-danger btn-xs"
                              onClick={() => handleCancel(a)}
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
                  onChange={(e) => {
                    setAvailableSlots([])
                    setBookingForm({ ...bookingForm, clinician: e.target.value, starts_at: '' })
                  }}
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
                <label>Visit Type *</label>
                <select
                  required
                  value={bookingForm.visit_type}
                  onChange={(e) => setBookingForm({ ...bookingForm, visit_type: e.target.value })}
                >
                  <option value="clinic">Clinic</option>
                  <option value="virtual">Virtual</option>
                </select>
              </div>

              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  required
                  value={bookingForm.date}
                  onChange={(e) => {
                    setAvailableSlots([])
                    setBookingForm({ ...bookingForm, date: e.target.value, starts_at: '' })
                  }}
                />
              </div>
              <div className="form-group">
                <label>Available time (30 minutes) *</label>
                <select
                  required
                  value={bookingForm.starts_at}
                  disabled={!bookingForm.clinician || !bookingForm.date}
                  onChange={(e) => setBookingForm({ ...bookingForm, starts_at: e.target.value })}
                >
                  <option value="">Select an available slot</option>
                  {availableSlots.map((slot) => (
                    <option key={slot.starts_at} value={slot.starts_at}>{slot.local_time}</option>
                  ))}
                </select>
                {bookingForm.clinician && bookingForm.date && availableSlots.length === 0 && (
                  <span className="form-hint">No available times on this date.</span>
                )}
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

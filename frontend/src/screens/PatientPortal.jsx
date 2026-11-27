import React, { useState, useEffect, useCallback } from 'react'
import {
  User,
  Calendar,
  HeartPulse,
  Pill,
  DollarSign,
  FileText,
  Shield,
  Plus,
  CheckCircle,
  AlertTriangle,
  X
} from 'lucide-react'
import {
  getAppointments,
  getLabResults,
  getPrescriptions,
  getBills,
  getCarePlans,
  getClinicians,
  getMedicalHistories,
  getAllAllergies,
  getAllPages,
  getNotes,
  getDiagnoses,
  getAllPatientMessages,
  sendPatientMessage,
  createAppointment,
  getAppointmentSlots,
  getPatient,
  createVirtualSession,
  linkVirtualAppointmentSession,
  getProxyGrants,
  createProxyGrant,
  revokeProxyGrant
} from '../api'

export default function PatientPortal({ me, listFilters }) {
  const patientId = me?.patient_id
  const [activeTab, setActiveTab] = useState('appointments')
  const [appointments, setAppointments] = useState([])
  const [labResults, setLabResults] = useState([])
  const [prescriptions, setPrescriptions] = useState([])
  const [bills, setBills] = useState([])
  const [carePlans, setCarePlans] = useState([])
  const [clinicians, setClinicians] = useState([])
  const [medicalHistory, setMedicalHistory] = useState([])
  const [allergies, setAllergies] = useState([])
  const [registrationAllergies, setRegistrationAllergies] = useState('')
  const [notes, setNotes] = useState([])
  const [diagnoses, setDiagnoses] = useState([])
  const [messages, setMessages] = useState([])
  const [proxies, setProxies] = useState([])
  const [recordPatientId, setRecordPatientId] = useState(String(me?.patient_id || ''))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Proxy modal
  const [showProxyModal, setShowProxyModal] = useState(false)
  const [showBookingModal, setShowBookingModal] = useState(false)
  const [proxyForm, setProxyForm] = useState({ grantee_username: '', scope: 'records' })
  const [submitting, setSubmitting] = useState(false)
  const [bookingForm, setBookingForm] = useState({
    clinician: '',
    date: '',
    starts_at: '',
    visit_type: 'clinic',
    reason: ''
  })
  const [availableSlots, setAvailableSlots] = useState([])
  const [messageText, setMessageText] = useState('')
  const [bookingKey, setBookingKey] = useState(
    () => `portal-${globalThis.crypto?.randomUUID?.() || Date.now()}`
  )

  const loadPortalData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const patientParams = recordPatientId ? { patient: recordPatientId } : {}
      const [appts, labs, rxs, bls, cps, pxs, doctors, histories, allergyRows, noteRows, diagnosisRows, messageRows, patientRecord] = await Promise.all([
        getAllPages(getAppointments, patientParams),
        getAllPages(getLabResults, patientParams),
        getAllPages(getPrescriptions, patientParams),
        getAllPages(getBills, patientParams),
        getAllPages(getCarePlans, patientParams),
        getAllPages(getProxyGrants),
        getAllPages(getClinicians),
        getAllPages(getMedicalHistories, patientParams),
        getAllAllergies(patientParams),
        getAllPages(getNotes, patientParams),
        getAllPages(getDiagnoses, patientParams),
        getAllPatientMessages(patientParams),
        recordPatientId && recordPatientId === String(patientId || '')
          ? getPatient(recordPatientId) : Promise.resolve({ data: null })
      ])

      setAppointments(appts)
      setLabResults(labs)
      setPrescriptions(rxs)
      setBills(bls)
      setCarePlans(cps)
      setClinicians(doctors)
      setMedicalHistory(histories)
      setAllergies(allergyRows)
      setRegistrationAllergies(patientRecord.data?.allergies || '')
      setNotes(noteRows)
      setDiagnoses(diagnosisRows)
      setMessages(messageRows)
      setProxies(pxs)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load patient portal records.')
    } finally {
      setLoading(false)
    }
  }, [recordPatientId, patientId])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    loadPortalData()
  }, [loadPortalData])

  useEffect(() => {
    if (!showBookingModal || !bookingForm.clinician || !bookingForm.date) {
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
          setError(err.response?.data?.detail || 'Could not load this clinician’s available times.')
        }
      })
    return () => { active = false }
  }, [showBookingModal, bookingForm.clinician, bookingForm.date])

  async function handleBookAppointment(e) {
    e.preventDefault()
    if (!me?.patient_id) {
      setError('Your account is not linked to a patient record. Contact reception for assistance.')
      return
    }
    setSubmitting(true)
    setError('')
    let appointmentCreated = false
    try {
      const appointmentResponse = await createAppointment({
        patient: me.patient_id,
        clinician: bookingForm.clinician,
        starts_at: bookingForm.starts_at,
        visit_type: bookingForm.visit_type,
        reason: bookingForm.reason
      }, bookingKey)
      appointmentCreated = true
      if (bookingForm.visit_type === 'virtual') {
        const [patientResponse, clinician] = await Promise.all([
          getPatient(me.patient_id),
          Promise.resolve(clinicians.find((item) => String(item.id) === String(bookingForm.clinician)))
        ])
        const patient = patientResponse.data
        const sessionResponse = await createVirtualSession({
          appointment_id: String(appointmentResponse.data.id),
          patient_id: String(patient.id),
          patient_name: `${patient.first_name} ${patient.last_name}`.trim(),
          patient_mrn: patient.medical_record_number,
          clinician_id: String(bookingForm.clinician),
          clinician_name: appointmentResponse.data.clinician_name || clinician?.name || '',
          scheduled_at: appointmentResponse.data.starts_at,
          reason: bookingForm.reason
        }, bookingKey)
        await linkVirtualAppointmentSession(appointmentResponse.data.id, String(sessionResponse.data.id))
      }
      setSuccess('Appointment booked successfully.')
      setShowBookingModal(false)
      setBookingForm({ clinician: '', date: '', starts_at: '', visit_type: 'clinic', reason: '' })
      setBookingKey(`portal-${globalThis.crypto?.randomUUID?.() || Date.now()}`)
      await loadPortalData()
    } catch (err) {
      const data = err.response?.data
      const message = data?.detail || data?.starts_at?.[0] || data?.patient?.[0] || 'Unable to book this appointment. Choose an available slot and try again.'
      if (appointmentCreated) {
        await loadPortalData()
        setError(`The appointment was booked, but Virtual Care setup failed. ${message} Retry with the same details to reuse the booking.`)
      } else {
        setError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSendMessage(e) {
    e.preventDefault()
    if (!messageText.trim() || !me?.patient_id) return
    setSubmitting(true)
    setError('')
    try {
      await sendPatientMessage({ patient: recordPatientId || me.patient_id, body: messageText.trim() })
      setMessageText('')
      setSuccess('Message sent to your assigned clinician.')
      await loadPortalData()
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.patient?.[0] || 'Unable to send your message.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGrantProxy(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await createProxyGrant({
        grantee_username: proxyForm.grantee_username,
        scope: proxyForm.scope,
        active: true
      })
      setSuccess('Family proxy access grant authorized.')
      setShowProxyModal(false)
      loadPortalData()
    } catch (err) {
      const data = err.response?.data
      setError(data?.detail || data?.grantee_username?.[0] || data?.scope?.[0] || 'Failed to grant proxy access.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevokeProxy(id) {
    if (!window.confirm('Revoke family/proxy access grant?')) return
    setError('')
    try {
      await revokeProxyGrant(id)
      setSuccess('Proxy access revoked.')
      loadPortalData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to revoke proxy.')
    }
  }

  const inboundProxies = proxies.filter(
    (grant) => grant.active && String(grant.grantee) === String(me?.id)
  )

  return (
    <div className="patient-portal-screen">
      <div className="page-heading">
        <div>
          <h1>My Health Record</h1>
          {recordPatientId !== String(me?.patient_id || '') && (
            <p className="form-hint">Viewing records shared by {inboundProxies.find((grant) => String(grant.patient) === recordPatientId)?.patient_name || 'another patient'}.</p>
          )}
        </div>
        <div className="page-actions">
          {recordPatientId !== String(me?.patient_id || '') && (
            <button className="btn btn-secondary" onClick={() => setRecordPatientId(String(me?.patient_id || ''))}>
              Return to my record
            </button>
          )}
          {activeTab === 'appointments' && recordPatientId === String(me?.patient_id || '') && (
            <button className="btn btn-primary" onClick={() => setShowBookingModal(true)}>
              <Plus size={16} /> Book appointment
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { id: 'appointments', label: `My Appointments (${appointments.length})`, icon: Calendar },
          { id: 'labs', label: `Lab Results (${labResults.length})`, icon: HeartPulse },
          { id: 'prescriptions', label: `Medications (${prescriptions.length})`, icon: Pill },
          { id: 'history', label: 'History & Allergies', icon: FileText },
          { id: 'messages', label: `Messages (${messages.length})`, icon: User },
          { id: 'carePlans', label: `Care Plans (${carePlans.length})`, icon: FileText },
          { id: 'billing', label: `Invoices (${bills.length})`, icon: DollarSign },
          { id: 'family', label: `Family & Proxy Access (${proxies.length})`, icon: Shield }
        ].map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              className={`btn ${activeTab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab(t.id)}
            >
              <Icon size={16} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab Contents */}
      <div className="panel">
        <div className="panel-header">
          <h3>
            {activeTab === 'appointments' && 'Scheduled Consultations'}
            {activeTab === 'labs' && 'Diagnostic Results'}
            {activeTab === 'prescriptions' && 'Authorized Prescriptions'}
            {activeTab === 'history' && 'Medical History & Allergies'}
            {activeTab === 'messages' && 'Messages with your clinician'}
            {activeTab === 'carePlans' && 'Clinical Care Directives'}
            {activeTab === 'billing' && 'Billing Statements'}
            {activeTab === 'family' && 'Authorized Caregiver & Proxy Grants'}
          </h3>
          <button className="btn btn-secondary btn-sm" onClick={loadPortalData}>Refresh</button>
        </div>

        <div className="panel-body">
          {loading ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading your records...
            </div>
          ) : (
            <div>
              {/* Appointments */}
              {activeTab === 'appointments' && (
                appointments.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No upcoming appointments scheduled.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {appointments.map((a) => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                        <div>
                          <strong>{new Date(a.starts_at).toLocaleDateString()} at {new Date(a.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                          <div style={{ fontSize: '13px', color: 'var(--navy)', marginTop: '2px' }}>Reason: {a.reason || 'General check-up'}</div>
                        </div>
                        <span className={`badge badge-${a.status}`}>{a.status?.replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>
                )
              )}

              {activeTab === 'history' && (
                <div style={{ display: 'grid', gap: '16px' }}>
                  <section>
                    <h4>Allergies</h4>
                    {registrationAllergies && <div className="notice" style={{ marginBottom: 8 }}>{registrationAllergies}</div>}
                    {allergies.length ? allergies.map((item) => (
                      <div key={item.id} className="notice" style={{ marginBottom: 8 }}>
                        <strong>{item.substance}</strong> — {item.reaction || 'Reaction not recorded'}
                      </div>
                    )) : !registrationAllergies && <p className="form-hint">No allergies recorded.</p>}
                  </section>
                  <section>
                    <h4>Medical history</h4>
                    {medicalHistory.length ? medicalHistory.map((item) => (
                      <div key={item.id} className="list-item" style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
                        <strong>{item.condition || item.title || 'History entry'}</strong>
                        <span style={{ display: 'block' }}>{item.details || item.description || item.notes || ''}</span>
                        <small>{new Date(item.created_at).toLocaleDateString()}</small>
                      </div>
                    )) : <p className="form-hint">No medical history recorded.</p>}
                  </section>
                  <section>
                    <h4>Diagnoses & clinical notes</h4>
                    {[...diagnoses.map((item) => ({ ...item, entryType: 'Diagnosis' })), ...notes.map((item) => ({ ...item, entryType: 'Clinical note' }))].map((item) => (
                      <div key={`${item.entryType}-${item.id}`} style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
                        <strong>{item.entryType}</strong>
                        <div>{item.description || item.content || item.code}</div>
                        <small>{new Date(item.created_at).toLocaleString()}</small>
                      </div>
                    ))}
                    {!diagnoses.length && !notes.length && <p className="form-hint">No diagnoses or notes recorded.</p>}
                  </section>
                </div>
              )}

              {activeTab === 'messages' && (
                <div>
                  {messages.length === 0 ? (
                    <p className="form-hint">No messages yet. Send a message to your assigned clinician.</p>
                  ) : messages.map((message) => (
                    <article key={message.id} style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <strong>{message.sender_name}</strong>
                        <small>{new Date(message.created_at).toLocaleString()}</small>
                      </div>
                      <p style={{ margin: '6px 0' }}>{message.body}</p>
                    </article>
                  ))}
                  {recordPatientId === String(me?.patient_id || '') && (
                    <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                      <input
                        aria-label="Message your clinician"
                        value={messageText}
                        onChange={(event) => setMessageText(event.target.value)}
                        maxLength={4000}
                        placeholder="Write a message to your assigned clinician"
                        required
                      />
                      <button className="btn btn-primary" disabled={submitting}>Send</button>
                    </form>
                  )}
                </div>
              )}

              {/* Lab Results */}
              {activeTab === 'labs' && (
                labResults.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No diagnostic test results on file.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {labResults.map((lr) => (
                      <div key={lr.id} style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <strong style={{ fontSize: '14px', color: 'var(--navy)' }}>Result: {lr.result}</strong>
                          <span className="badge badge-green">{lr.is_current ? lr.status : 'Superseded'}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          Reference: {lr.reference_range || 'Not provided'} &bull; Entered: {new Date(lr.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
                        {showBookingModal && (
                          <div className="modal-overlay" onClick={() => setShowBookingModal(false)}>
                            <div className="modal" onClick={(event) => event.stopPropagation()}>
                              <div className="panel-header">
                                <h3>Book an appointment</h3>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowBookingModal(false)} aria-label="Close booking form">
                                  <X size={16} />
                                </button>
                              </div>
                              <form className="panel-body" onSubmit={handleBookAppointment}>
                                {error && <div className="alert alert-error" role="alert">{error}</div>}
                                <div className="form-group">
                                  <label htmlFor="portal-clinician">Clinician</label>
                                  <select
                                    id="portal-clinician"
                                    required
                                    value={bookingForm.clinician}
                                    onChange={(event) => {
                                      setAvailableSlots([])
                                      setBookingForm({ ...bookingForm, clinician: event.target.value, starts_at: '' })
                                    }}
                                  >
                                    <option value="">Select a clinician</option>
                                    {clinicians.map((clinician) => (
                                      <option key={clinician.id} value={clinician.id}>
                                        {clinician.name || clinician.specialty} · {clinician.department || clinician.specialty}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="form-group">
                                  <label htmlFor="portal-visit-type">Visit type</label>
                                  <select
                                    id="portal-visit-type"
                                    value={bookingForm.visit_type}
                                    onChange={(event) => setBookingForm({ ...bookingForm, visit_type: event.target.value })}
                                  >
                                    <option value="clinic">Clinic</option>
                                    <option value="virtual">Virtual</option>
                                  </select>
                                </div>
                                <div className="form-group">
                                  <label htmlFor="portal-appointment-date">Date</label>
                                  <input
                                    id="portal-appointment-date"
                                    type="date"
                                    required
                                    value={bookingForm.date}
                                    onChange={(event) => {
                                      setAvailableSlots([])
                                      setBookingForm({ ...bookingForm, date: event.target.value, starts_at: '' })
                                    }}
                                  />
                                </div>
                                <div className="form-group">
                                  <label htmlFor="portal-appointment-slot">Available time</label>
                                  <select
                                    id="portal-appointment-slot"
                                    required
                                    value={bookingForm.starts_at}
                                    onChange={(event) => setBookingForm({ ...bookingForm, starts_at: event.target.value })}
                                    disabled={!bookingForm.clinician || !bookingForm.date}
                                  >
                                    <option value="">Select an available slot</option>
                                    {availableSlots.map((slot) => (
                                      <option key={slot.starts_at} value={slot.starts_at}>{slot.local_time}</option>
                                    ))}
                                  </select>
                                  {bookingForm.clinician && bookingForm.date && availableSlots.length === 0 && (
                                    <small className="form-hint">No available times on this date.</small>
                                  )}
                                </div>
                                <div className="form-group">
                                  <label htmlFor="portal-appointment-reason">Reason (optional)</label>
                                  <textarea
                                    id="portal-appointment-reason"
                                    maxLength={300}
                                    value={bookingForm.reason}
                                    onChange={(event) => setBookingForm({ ...bookingForm, reason: event.target.value })}
                                  />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                  <button type="button" className="btn btn-secondary" onClick={() => setShowBookingModal(false)}>Cancel</button>
                                  <button className="btn btn-primary" disabled={submitting || !availableSlots.length}>Book</button>
                                </div>
                              </form>
                            </div>
                          </div>
                        )}
                        {showProxyModal && (
                          <div className="modal-overlay" onClick={() => setShowProxyModal(false)}>
                            <div className="modal" onClick={(event) => event.stopPropagation()}>
                              <div className="panel-header">
                                <h3>Grant family access</h3>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowProxyModal(false)} aria-label="Close proxy form">
                                  <X size={16} />
                                </button>
                              </div>
                              <form className="panel-body" onSubmit={handleGrantProxy}>
                                <div className="form-group">
                                  <label htmlFor="proxy-username">Patient account username</label>
                                  <input
                                    id="proxy-username"
                                    required
                                    value={proxyForm.grantee_username}
                                    onChange={(event) => setProxyForm({ ...proxyForm, grantee_username: event.target.value })}
                                    placeholder="Username of the person receiving access"
                                  />
                                </div>
                                <div className="form-group">
                                  <label htmlFor="proxy-scope">Access scope</label>
                                  <select
                                    id="proxy-scope"
                                    value={proxyForm.scope}
                                    onChange={(event) => setProxyForm({ ...proxyForm, scope: event.target.value })}
                                  >
                                    <option value="records">Medical record</option>
                                    <option value="appointments">Appointments</option>
                                    <option value="results">Lab results</option>
                                    <option value="billing">Billing</option>
                                    <option value="medications">Medications</option>
                                    <option value="appointments,records,results">Records, appointments & results</option>
                                  </select>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                  <button type="button" className="btn btn-secondary" onClick={() => setShowProxyModal(false)}>Cancel</button>
                                  <button className="btn btn-primary" disabled={submitting}>Grant access</button>
                                </div>
                              </form>
                            </div>
                          </div>
                        )}
              {/* Prescriptions */}
              {activeTab === 'prescriptions' && (
                prescriptions.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No active prescriptions on file.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {prescriptions.map((rx) => (
                      <div key={rx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                        <div>
                          <strong style={{ fontSize: '14px', color: 'var(--primary)' }}>{rx.medication}</strong>
                          <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px' }}>Dosage: {rx.dosage}</div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{rx.instructions}</div>
                        </div>
                        <span className={`badge badge-${rx.status}`}>{rx.status}</span>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Care Plans */}
              {activeTab === 'carePlans' && (
                carePlans.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No documented care plans.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {carePlans.map((cp) => (
                      <div key={cp.id} style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                        <p style={{ fontSize: '13px', color: 'var(--navy)' }}>{cp.description}</p>
                        <small style={{ color: 'var(--muted)', display: 'block', marginTop: '4px' }}>
                          Approved: {new Date(cp.created_at).toLocaleDateString()}
                        </small>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Billing */}
              {activeTab === 'billing' && (
                bills.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No invoices issued.</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invoice Number</th>
                        <th>Itemized Services</th>
                        <th>Amount Due</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map((b) => (
                        <tr key={b.id}>
                          <td><strong>{b.invoice_number}</strong></td>
                          <td style={{ fontSize: '12px' }}>
                            {Array.isArray(b.items) ? b.items.map((it) => it.description).join(', ') : 'Medical care'}
                          </td>
                          <td><strong>${(b.total_cents / 100).toFixed(2)}</strong></td>
                          <td><span className={`badge badge-${b.status}`}>{b.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}

              {/* Family / Proxy Access */}
              {activeTab === 'family' && (
                <div>
                  {inboundProxies.length > 0 && (
                    <section style={{ marginBottom: 16 }}>
                      <h4>Records shared with you</h4>
                      {inboundProxies.map((grant) => (
                        <div key={grant.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderBottom: '1px solid var(--line)' }}>
                          <span>{grant.patient_name} · {grant.scope}</span>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setRecordPatientId(String(grant.patient))
                              setActiveTab('history')
                            }}
                          >
                            View shared records
                          </button>
                        </div>
                      ))}
                    </section>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
                      Grant scoped access to a trusted family member or caregiver to view your records, appointments, or results.
                    </p>
                    {recordPatientId === String(me?.patient_id || '') && (
                      <button className="btn btn-primary btn-sm" onClick={() => setShowProxyModal(true)}>
                        <Plus size={14} /> Grant Family Access
                      </button>
                    )}
                  </div>

                  {proxies.length === 0 ? (
                    <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>
                      No active family proxy grants.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {proxies.map((px) => (
                        <div key={px.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                          <div>
                            <strong>{String(px.patient) === String(me?.patient_id) ? `Grantee: ${px.grantee_name}` : `Shared by: ${px.patient_name}`}</strong>
                            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Scope: {px.scope}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span className={`badge ${px.active ? 'badge-green' : 'badge-red'}`}>
                              {px.active ? 'Active' : 'Revoked'}
                            </span>
                            {px.active && (
                              <button
                                className="btn btn-danger btn-xs"
                                onClick={() => handleRevokeProxy(px.id)}
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

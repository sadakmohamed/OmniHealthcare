import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  Clock3,
  Plus,
  Search,
  ShieldCheck,
  Video,
  X
} from 'lucide-react'
import {
  completeVirtualAppointment,
  completeVirtualCareSession,
  createVirtualSession,
  getClinicians,
  getPatients,
  getVirtualSessions,
  getVirtualCareDirectory,
  createVirtualCareAccount,
  updateVirtualCareAccount,
  grantVirtualCareConsent,
  linkVirtualAppointmentSession,
  markVirtualSessionHospitalSynced,
  submitVirtualCareIntake,
  transitionVirtualSession
} from '../api'

function messageFromError(error) {
  const data = error.response?.data
  if (typeof data?.detail === 'string') return data.detail
  if (data && typeof data === 'object') {
    return Object.entries(data)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('; ')
  }
  if (!error.response) {
    return 'Cannot reach Virtual Care. Ensure its service is running and the /virtual-api/ proxy is configured.'
  }
  return `Virtual Care returned an error (${error.response.status}). Check the service logs and database migrations.`
}

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `virtual-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatDuration(startedAt, now) {
  if (!startedAt) return '00:00'
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function hospitalSyncPayload(session) {
  return {
    note: session.note,
    summary: session.summary,
    follow_up_plan: session.follow_up_plan,
    follow_up_date: session.follow_up_date,
    lab_orders: session.lab_orders || [],
    prescriptions: session.prescriptions || [],
    virtual_session_id: String(session.id),
    consent_revision: session.consent_revision,
    completion_signature: session.completion_signature
  }
}

export default function VirtualCare({ me, standalone = false, onExit }) {
  const [sessions, setSessions] = useState([])
  const [patients, setPatients] = useState([])
  const [clinicians, setClinicians] = useState([])
  const [accounts, setAccounts] = useState([])
  const [accountRole, setAccountRole] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [bookingKey, setBookingKey] = useState(() => newIdempotencyKey())
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [form, setForm] = useState({
    patient_id: '',
    clinician_id: '',
    scheduled_at: '',
    reason: ''
  })
  const [accountForm, setAccountForm] = useState({
    role: 'clinician',
    username: '',
    display_name: '',
    password: ''
  })
  const [intake, setIntake] = useState({
    reason: '',
    verified: false,
    interpreter_requested: false,
    language: ''
  })
  const [note, setNote] = useState('')
  const [summary, setSummary] = useState('')
  const [followUpPlan, setFollowUpPlan] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [labRows, setLabRows] = useState([{ test_name: '' }])
  const [prescriptionRows, setPrescriptionRows] = useState([
    { medication: '', dosage: '', instructions: '' }
  ])

  const selectSession = useCallback((session) => {
    if (!session) {
      setSelectedId('')
      return
    }
    setSelectedId(String(session.id))
    setIntake({
      reason: session.reason || '',
      verified: session.verified || false,
      interpreter_requested: session.interpreter_requested || false,
      language: session.language || ''
    })
    setNote(session.note || '')
    setSummary(session.summary || '')
    setFollowUpPlan(session.follow_up_plan || '')
    setFollowUpDate(session.follow_up_date || '')
    setLabRows(session.lab_orders?.length ? session.lab_orders : [{ test_name: '' }])
    setPrescriptionRows(
      session.prescriptions?.length
        ? session.prescriptions
        : [{ medication: '', dosage: '', instructions: '' }]
    )
  }, [])

  const loadData = useCallback(async () => {
    try {
      const params = {}
      if (search.trim()) params.search = search.trim()
      if (dateFilter) params.date = dateFilter
      if (statusFilter) params.status = statusFilter
      const directoryRequest = standalone
        ? getVirtualCareDirectory()
        : Promise.all([
            getPatients().catch(() => ({ data: [] })),
            getClinicians().catch(() => ({ data: [] }))
          ])
      const [response, directory] = await Promise.all([
        getVirtualSessions(params),
        directoryRequest
      ])
      const records = response.data?.results || response.data || []
      setSessions(records)
      selectSession(records[0] || null)
      if (standalone) {
        setPatients(directory.data?.patients || [])
        setClinicians(directory.data?.clinicians || [])
        setAccounts(directory.data?.accounts || [])
      } else {
        const [patientResult, clinicianResult] = directory
        setPatients(patientResult.data?.results || patientResult.data || [])
        setClinicians(clinicianResult.data?.results || clinicianResult.data || [])
      }
    } catch (requestError) {
      setError(messageFromError(requestError))
    } finally {
      setLoading(false)
    }
  }, [dateFilter, search, selectSession, statusFilter, standalone])

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

  const selected = sessions.find((session) => String(session.id) === String(selectedId))
  const role = me?.role || ''
  const canSchedule = ['admin', 'receptionist', 'clinician', 'patient'].includes(role)
  const canManageQueue = role === 'clinician'
  const canSyncHospital = !standalone && ['admin', 'clinician'].includes(role)
  const canCreateAccounts = standalone && role === 'admin'
  const waitingSessions = sessions.filter((session) => session.status === 'waiting')

  useEffect(() => {
    if (!selected || selected.status !== 'consulting') return undefined
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [selected])

  function updateSession(session) {
    setSessions((current) => current.map((item) => (
      String(item.id) === String(session.id) ? session : item
    )))
    setSelectedId(String(session.id))
  }

  async function handleCreate(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const scheduledAt = new Date(form.scheduled_at)
      if (Number.isNaN(scheduledAt.getTime())) {
        setError('Choose a valid date and time.')
        return
      }
      const response = await createVirtualSession({
        patient_id: standalone && role === 'patient' ? me.patient_id : form.patient_id,
        patient_name: patients.find((item) => String(item.id) === String(standalone && role === 'patient' ? me.patient_id : form.patient_id))
          ? `${patients.find((item) => String(item.id) === String(standalone && role === 'patient' ? me.patient_id : form.patient_id)).first_name} ${patients.find((item) => String(item.id) === String(standalone && role === 'patient' ? me.patient_id : form.patient_id)).last_name}`.trim()
          : '',
        patient_mrn: patients.find((item) => String(item.id) === String(standalone && role === 'patient' ? me.patient_id : form.patient_id))?.medical_record_number || '',
        clinician_id: form.clinician_id,
        clinician_name: clinicians.find((item) => String(item.id) === String(form.clinician_id))?.name || '',
        scheduled_at: scheduledAt.toISOString(),
        reason: form.reason.trim()
      }, bookingKey)
      updateSession(response.data)
      setSuccess('Virtual visit scheduled. The patient must grant consent before starting intake.')
      setShowModal(false)
      setForm({ patient_id: '', clinician_id: '', scheduled_at: '', reason: '' })
      setBookingKey(newIdempotencyKey())
    } catch (requestError) {
      setError(messageFromError(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateAccount(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await createVirtualCareAccount(accountForm)
      setSuccess(`${accountForm.role} account created.`)
      setAccountForm({ role: 'clinician', username: '', display_name: '', password: '' })
      setShowAccountModal(false)
      await refreshData()
    } catch (requestError) {
      const data = requestError.response?.data
      setError(data?.detail || data?.username?.[0] || data?.password?.[0] || 'Unable to create the account.')
    } finally {
      setSubmitting(false)
    }
  }

  async function changeAccount(account, data, message) {
    setError('')
    setSuccess('')
    try {
      await updateVirtualCareAccount(account.id, data)
      setSuccess(message)
      await refreshData()
    } catch (requestError) {
      const body = requestError.response?.data
      setError(body?.detail || body?.password?.[0] || body?.display_name?.[0] || 'Unable to update the account.')
    }
  }

  function renameAccount(account) {
    const name = window.prompt('New display name', account.display_name)
    if (name && name.trim() && name.trim() !== account.display_name) {
      changeAccount(account, { display_name: name.trim() }, 'Account renamed.')
    }
  }

  function resetAccountPassword(account) {
    const password = window.prompt(`New password for ${account.username} (at least 12 characters)`)
    if (!password) return
    if (password.length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }
    changeAccount(account, { password }, 'Password reset. Share it securely with the account holder.')
  }

  const visibleAccounts = accounts.filter((account) => (
    (!accountRole || account.role === accountRole) &&
    `${account.username} ${account.display_name}`.toLowerCase().includes(accountSearch.trim().toLowerCase())
  ))

  async function handleTransition(session, nextStatus) {
    setError('')
    setSuccess('')
    try {
      const response = await transitionVirtualSession(session.id, nextStatus)
      updateSession(response.data)
      setSuccess(`Session moved to ${nextStatus.replace('_', ' ')}.`)
    } catch (requestError) {
      setError(messageFromError(requestError))
    }
  }

  async function handleConsent(session, granted) {
    setError('')
    setSuccess('')
    try {
      const response = await grantVirtualCareConsent(session.id, granted)
      updateSession(response.data)
      setSuccess(granted ? 'Virtual-care consent is active.' : 'Consent revoked. The session cannot continue.')
    } catch (requestError) {
      setError(messageFromError(requestError))
    }
  }

  async function handleIntake(event) {
    event.preventDefault()
    if (!selected) return
    setError('')
    setSuccess('')
    try {
      const response = await submitVirtualCareIntake(selected.id, intake)
      updateSession(response.data)
      setSuccess('Intake saved. The patient can now join the waiting queue.')
    } catch (requestError) {
      setError(messageFromError(requestError))
    }
  }

  async function handleComplete(event) {
    event.preventDefault()
    if (!selected) return
    setSubmitting(true)
    setError('')
    setSuccess('')
    const payload = {
      note,
      summary,
      follow_up_plan: followUpPlan,
      follow_up_date: followUpDate || null,
      lab_orders: labRows.filter((row) => row.test_name.trim()),
      prescriptions: prescriptionRows.filter((row) => row.medication.trim() && row.dosage.trim())
    }
    try {
      const completedResponse = await completeVirtualCareSession(selected.id, payload)
      updateSession(completedResponse.data)
      if (completedResponse.data.appointment_id) {
        try {
          await linkVirtualAppointmentSession(
            completedResponse.data.appointment_id,
            String(completedResponse.data.id)
          )
          await completeVirtualAppointment(
            completedResponse.data.appointment_id,
            hospitalSyncPayload(completedResponse.data)
          )
          const syncedResponse = await markVirtualSessionHospitalSynced(completedResponse.data.id)
          updateSession(syncedResponse.data)
          setSuccess('Virtual consultation completed and hospital record synchronized.')
        } catch (syncError) {
          setError(`Visit saved in Virtual Care. Hospital record synchronization is pending: ${messageFromError(syncError)}`)
        }
      } else {
        setSuccess('Virtual consultation completed.')
      }
    } catch (requestError) {
      setError(messageFromError(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleHospitalSync(session) {
    setError('')
    setSuccess('')
    try {
      await linkVirtualAppointmentSession(session.appointment_id, String(session.id))
      await completeVirtualAppointment(session.appointment_id, hospitalSyncPayload(session))
      const response = await markVirtualSessionHospitalSynced(session.id)
      updateSession(response.data)
      setSuccess('Hospital OPD record synchronized.')
    } catch (requestError) {
      setError(`Virtual Care remains complete. Hospital synchronization failed: ${messageFromError(requestError)}`)
    }
  }

  function renderActions(session) {
    const actions = []
    if (role === 'patient' && session.status !== 'completed' && session.status !== 'cancelled') {
      actions.push(
        <button
          key="consent"
          className={`btn btn-xs ${session.consent_active ? 'btn-secondary' : 'btn-primary'}`}
          onClick={() => handleConsent(session, !session.consent_active)}
        >
          <ShieldCheck size={14} /> {session.consent_active ? 'Revoke consent' : 'Grant consent'}
        </button>
      )
    }
    if (session.status === 'booked' && session.consent_active && ['patient', 'admin', 'receptionist'].includes(role)) {
      actions.push(
        <button key="intake" className="btn btn-primary btn-xs" onClick={() => handleTransition(session, 'intake')}>
          Begin intake
        </button>
      )
    }
    if (session.status === 'intake' && session.consent_active && ['patient', 'admin', 'receptionist'].includes(role)) {
      actions.push(
        <button key="intake-form" className="btn btn-primary btn-xs" onClick={() => selectSession(session)}>
          Complete intake
        </button>
      )
    }
    if (session.status === 'intake' && session.consent_active && session.verified && session.reason && ['patient', 'admin', 'receptionist'].includes(role)) {
      actions.push(
        <button key="queue" className="btn btn-primary btn-xs" onClick={() => handleTransition(session, 'waiting')}>
          Join queue
        </button>
      )
    }
    if (session.status === 'waiting' && canManageQueue) {
      actions.push(
        <button key="start" className="btn btn-success btn-xs" onClick={() => handleTransition(session, 'consulting')}>
          Start consultation
        </button>
      )
    }
    if (session.status === 'consulting' && canManageQueue) {
      actions.push(
        <button key="hold" className="btn btn-secondary btn-xs" onClick={() => handleTransition(session, 'interrupted')}>
          Hold
        </button>
      )
    }
    if (session.status === 'interrupted' && canManageQueue) {
      actions.push(
        <button key="resume" className="btn btn-primary btn-xs" onClick={() => handleTransition(session, 'waiting')}>
          Resume
        </button>
      )
    }
    if (['booked', 'intake', 'waiting'].includes(session.status) && ['admin', 'receptionist', 'patient'].includes(role)) {
      actions.push(
        <button key="cancel" className="btn btn-danger btn-xs" onClick={() => handleTransition(session, 'cancelled')}>
          Cancel
        </button>
      )
    }
    return actions
  }

  return (
    <div className="virtual-care-screen">
      <div className="page-heading">
        <div>
          <h1>Virtual Care</h1>
          
          {standalone && <p className="form-hint">Independent mode · separate Virtual Care accounts and data.</p>}
        </div>
        <div className="page-actions">
          {canCreateAccounts && (
            <button className="btn btn-secondary" onClick={() => setShowAccountModal(true)}>
              <Plus size={16} /> Add directory account
            </button>
          )}
          {canSchedule && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Schedule visit
            </button>
          )}
          {standalone && (
            <button className="btn btn-secondary" onClick={onExit}>Exit Virtual Care</button>
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

      <div className="toolbar">
        <label className="toolbar-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search patient, ID, or clinician"
            value={search}
            onChange={(event) => {
              setLoading(true)
              setError('')
              setSearch(event.target.value)
            }}
          />
        </label>
        <input
          className="filter-select"
          type="date"
          aria-label="Filter visits by date"
          value={dateFilter}
          onChange={(event) => {
            setLoading(true)
            setError('')
            setDateFilter(event.target.value)
          }}
        />
        <select
          className="filter-select"
          aria-label="Filter visits by status"
          value={statusFilter}
          onChange={(event) => {
            setLoading(true)
            setError('')
            setStatusFilter(event.target.value)
          }}
        >
          <option value="">All statuses</option>
          {['booked', 'intake', 'waiting', 'consulting', 'interrupted', 'completed', 'cancelled'].map((value) => (
            <option key={value} value={value}>{value.replace('_', ' ')}</option>
          ))}
        </select>
        <button className="btn btn-secondary" onClick={refreshData}>Refresh</button>
      </div>

      {canCreateAccounts && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h3>Registered accounts ({accounts.length})</h3>
            <div className="page-actions">
              <select className="filter-select" aria-label="Filter accounts by role" value={accountRole} onChange={(event) => setAccountRole(event.target.value)}>
                <option value="">All roles</option>
                {['admin', 'receptionist', 'clinician', 'patient'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <input type="search" aria-label="Search accounts" placeholder="Search accounts" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} />
            </div>
          </div>
          {visibleAccounts.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th /></tr></thead>
                <tbody>
                  {visibleAccounts.map((account) => (
                    <tr key={account.id}>
                      <td><strong>{account.display_name}</strong></td>
                      <td>{account.username}</td>
                      <td>{account.role}</td>
                      <td>{account.is_active ? 'Active' : 'Inactive'}</td>
                      <td>{new Date(account.created_at).toLocaleDateString()}</td>
                      <td>
                        <button className="btn btn-secondary btn-xs" onClick={() => renameAccount(account)}>Rename</button>{' '}
                        <button className="btn btn-secondary btn-xs" onClick={() => resetAccountPassword(account)}>Reset password</button>{' '}
                        {account.id !== me?.id && (
                          <button
                            className={`btn btn-xs ${account.is_active ? 'btn-danger' : 'btn-success'}`}
                            onClick={() => changeAccount(account, { is_active: !account.is_active }, account.is_active ? 'Account inactivated.' : 'Account reactivated.')}
                          >
                            {account.is_active ? 'Inactivate' : 'Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-state">No accounts match.</div>}
        </div>
      )}

      {['clinician', 'patient'].includes(role) && standalone && (
        <p className="form-hint">Showing only your own visits{role === 'clinician' ? ' — patients appear in the waiting queue after consent and intake.' : '.'}</p>
      )}

      {role === 'clinician' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h3>Waiting queue ({waitingSessions.length})</h3>
          </div>
          {waitingSessions.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Patient</th><th>Reason</th><th>Interpreter</th><th>Scheduled</th><th /></tr></thead>
                <tbody>
                  {waitingSessions.map((session) => (
                    <tr key={session.id}>
                      <td><strong>{session.patient_name || session.patient_id}</strong><div className="table-subtext">{session.patient_mrn}</div></td>
                      <td>{session.reason || '—'}</td>
                      <td>{session.interpreter_requested ? `Requested: ${session.language}` : 'No'}</td>
                      <td>{new Date(session.scheduled_at).toLocaleString()}</td>
                      <td><button className="btn btn-primary btn-xs" onClick={() => selectSession(session)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-state">No patients are waiting.</div>}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h3>Sessions ({sessions.length})</h3>
        </div>
        <div className="table-wrap">
          {loading ? <div className="empty-state">Loading sessions…</div> : sessions.length === 0 ? (
            <div className="empty-state">No virtual visits match these filters.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Scheduled</th><th>Patient</th><th>Clinician</th><th>Status</th><th>Consent</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className={String(selectedId) === String(session.id) ? 'selected-row' : ''}>
                    <td>{new Date(session.scheduled_at).toLocaleString()}</td>
                    <td><strong>{session.patient_name || session.patient_id}</strong><div className="table-subtext">{session.patient_mrn || session.appointment_id}</div></td>
                    <td>{session.clinician_name || session.clinician_id}</td>
                    <td><span className={`badge badge-${session.status}`}>{session.status.replace('_', ' ')}</span></td>
                    <td><span className={`badge ${session.consent_active ? 'badge-completed' : 'badge-cancelled'}`}>{session.consent_active ? 'Active' : 'Pending'}</span></td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn-secondary btn-xs" onClick={() => selectSession(session)}>Open</button>
                        {renderActions(session)}
                        {session.status === 'completed' && session.appointment_id && !session.hospital_synced_at && canSyncHospital && (
                          <button className="btn btn-primary btn-xs" onClick={() => handleHospitalSync(session)}>Sync hospital record</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <div className="panel virtual-session-detail">
          <div className="panel-header">
            <div>
              <h3>{selected.patient_name || `Patient ${selected.patient_id}`}</h3>
              <div className="table-subtext">
                {selected.patient_mrn || 'Patient'} · {selected.clinician_name || 'Clinician'} · {new Date(selected.scheduled_at).toLocaleString()}
              </div>
            </div>
            <button className="btn btn-secondary btn-xs" onClick={() => selectSession(null)} aria-label="Close session details"><X size={15} /></button>
          </div>
          <div className="panel-body">
            {!selected.consent_active && !['completed', 'cancelled'].includes(selected.status) && (
              <div className="alert alert-warning">
                <ShieldCheck size={16} /> Active patient consent is required before this visit can progress.
              </div>
            )}

            {selected.status === 'intake' && (
              <form onSubmit={handleIntake} className="panel inset-panel">
                <h4>Patient intake</h4>
                <div className="form-group">
                  <label>Reason for visit *</label>
                  <textarea required value={intake.reason} onChange={(event) => setIntake({ ...intake, reason: event.target.value })} />
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={intake.verified} onChange={(event) => setIntake({ ...intake, verified: event.target.checked })} />
                  Confirm patient identity and check-in details
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={intake.interpreter_requested} onChange={(event) => setIntake({ ...intake, interpreter_requested: event.target.checked })} />
                  Request an interpreter
                </label>
                {intake.interpreter_requested && (
                  <div className="form-group">
                    <label>Language *</label>
                    <input required value={intake.language} onChange={(event) => setIntake({ ...intake, language: event.target.value })} />
                  </div>
                )}
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">Save intake</button>
                  {selected.verified && selected.reason && (
                    <button className="btn btn-secondary" type="button" onClick={() => handleTransition(selected, 'waiting')}>Join queue</button>
                  )}
                </div>
              </form>
            )}

            {selected.status === 'consulting' && (
              <div className="simulated-call">
                <div className="simulated-call-icon"><Video size={28} /></div>
                <div>
                  <strong>Simulated consultation</strong>
                  <div className="table-subtext">No camera, microphone, or live media connection</div>
                </div>
                <div className="call-timer"><Clock3 size={16} /> {formatDuration(selected.call_started_at, now)}</div>
              </div>
            )}

            {selected.status === 'consulting' && role === 'clinician' && (
              <form onSubmit={handleComplete} className="panel inset-panel">
                <h4>Consultation record</h4>
                <div className="form-group">
                  <label>Clinical note *</label>
                  <textarea required value={note} onChange={(event) => setNote(event.target.value)} />
                </div>
                <div className="form-group">
                  <label>Visit summary *</label>
                  <textarea required value={summary} onChange={(event) => setSummary(event.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Follow-up plan</label>
                    <input value={followUpPlan} onChange={(event) => setFollowUpPlan(event.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Follow-up date</label>
                    <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
                  </div>
                </div>
                <div className="virtual-order-section">
                  <div className="section-title-row">
                    <h4>Optional lab orders</h4>
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => setLabRows([...labRows, { test_name: '' }])}><Plus size={14} /> Add row</button>
                  </div>
                  {labRows.map((row, index) => (
                    <div className="virtual-order-row" key={`lab-${index}`}>
                      <input aria-label={`Lab test ${index + 1}`} placeholder="Lab test" value={row.test_name} onChange={(event) => setLabRows(labRows.map((item, rowIndex) => rowIndex === index ? { ...item, test_name: event.target.value } : item))} />
                      {labRows.length > 1 && <button type="button" className="btn btn-danger btn-xs" onClick={() => setLabRows(labRows.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>}
                    </div>
                  ))}
                </div>
                <div className="virtual-order-section prescription-section">
                  <div className="section-title-row">
                    <h4>Optional prescriptions</h4>
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => setPrescriptionRows([...prescriptionRows, { medication: '', dosage: '', instructions: '' }])}><Plus size={14} /> Add row</button>
                  </div>
                  {prescriptionRows.map((row, index) => (
                    <div className="virtual-order-row" key={`rx-${index}`}>
                      <input aria-label={`Medication ${index + 1}`} placeholder="Medication" value={row.medication} onChange={(event) => setPrescriptionRows(prescriptionRows.map((item, rowIndex) => rowIndex === index ? { ...item, medication: event.target.value } : item))} />
                      <input aria-label={`Dosage ${index + 1}`} placeholder="Dose" value={row.dosage} onChange={(event) => setPrescriptionRows(prescriptionRows.map((item, rowIndex) => rowIndex === index ? { ...item, dosage: event.target.value } : item))} />
                      <input aria-label={`Instructions ${index + 1}`} placeholder="Instructions" value={row.instructions} onChange={(event) => setPrescriptionRows(prescriptionRows.map((item, rowIndex) => rowIndex === index ? { ...item, instructions: event.target.value } : item))} />
                      {prescriptionRows.length > 1 && <button type="button" className="btn btn-danger btn-xs" onClick={() => setPrescriptionRows(prescriptionRows.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>}
                    </div>
                  ))}
                </div>
                <div className="form-actions">
                  <button className="btn btn-success" type="submit" disabled={submitting}>{submitting ? 'Completing…' : 'Complete consultation'}</button>
                </div>
              </form>
            )}

            {selected.status === 'completed' && (
              <div className="completed-summary">
                <h4>Visit summary</h4>
                <p>{selected.summary || 'No summary recorded.'}</p>
                {selected.follow_up_plan && <p><strong>Follow-up:</strong> {selected.follow_up_plan}{selected.follow_up_date ? ` — ${selected.follow_up_date}` : ''}</p>}
                {selected.appointment_id && (
                  <p>{selected.hospital_synced_at ? 'Hospital OPD record synchronized.' : 'Hospital OPD record synchronization is pending.'}</p>
                )}
                {!!selected.audit_events?.length && <span className="table-subtext">Audit history: {selected.audit_events.length} events</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h3>Schedule virtual visit</h3>
              <button className="icon-button" onClick={() => setShowModal(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <form onSubmit={handleCreate} className="panel-body">
              <div className="form-group">
                <label>Patient *</label>
                {standalone && role === 'patient' ? (
                  <input value={me.display_name || `${me.first_name} ${me.last_name}`} readOnly aria-label="Patient" />
                ) : (
                <select required value={form.patient_id} onChange={(event) => setForm({ ...form, patient_id: event.target.value })}>
                  <option value="">Select patient</option>
                  {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name} ({patient.medical_record_number})</option>)}
                </select>
                )}
              </div>
              <div className="form-group">
                <label>Clinician *</label>
                <select required value={form.clinician_id} onChange={(event) => setForm({ ...form, clinician_id: event.target.value })}>
                  <option value="">Select clinician</option>
                  {clinicians.map((clinician) => <option key={clinician.id} value={clinician.id}>{clinician.name || `Dr. ${clinician.specialty}`} · {clinician.department || clinician.specialty}</option>)}
                </select>
                {standalone && !clinicians.length && (
                  <small className="form-hint">No clinicians are registered yet. Ask your administrator to add a clinician account.</small>
                )}
              </div>
              <div className="form-group">
                <label>Date and time *</label>
                <input type="datetime-local" step="1800" required value={form.scheduled_at} onChange={(event) => setForm({ ...form, scheduled_at: event.target.value })} />
              </div>
              <div className="form-group">
                <label>Reason (optional)</label>
                <textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Close</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Scheduling…' : 'Schedule'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showAccountModal && (
        <div className="modal-overlay" onClick={() => setShowAccountModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h3>Add Virtual Care directory account</h3>
              <button type="button" className="icon-button" onClick={() => setShowAccountModal(false)} aria-label="Close account form"><X size={18} /></button>
            </div>
            <form className="panel-body" onSubmit={handleCreateAccount}>
              <div className="form-group">
                <label htmlFor="vc-account-role">Role</label>
                <select id="vc-account-role" value={accountForm.role} onChange={(event) => setAccountForm({ ...accountForm, role: event.target.value })}>
                  <option value="clinician">Clinician</option>
                  <option value="patient">Patient</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="vc-account-name">Full name</label>
                <input id="vc-account-name" required value={accountForm.display_name} onChange={(event) => setAccountForm({ ...accountForm, display_name: event.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="vc-account-username">Username</label>
                <input id="vc-account-username" required value={accountForm.username} onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="vc-account-password">Temporary password</label>
                <input id="vc-account-password" type="password" minLength={12} required value={accountForm.password} onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} />
                <small className="form-hint">At least 12 characters. Share it securely with the account holder.</small>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAccountModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={submitting}>Create account</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

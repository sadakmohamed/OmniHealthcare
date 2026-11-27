import React, { useState, useEffect } from 'react'
import {
  Stethoscope,
  Plus,
  FileText,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCheck,
  Pill,
  HeartPulse,
  Eye,
  X,
  Clock,
  ShieldCheck
} from 'lucide-react'
import {
  getEncounters,
  createEncounter,
  transitionEncounter,
  getNotes,
  getAllPages,
  createNote,
  getDiagnoses,
  createDiagnosis,
  getCarePlans,
  createCarePlan,
  getVitals,
  getLabOrders,
  getPrescriptions,
  getPatients,
  getClinicians
} from '../api'

export default function Encounters({ me, onNavigate, listFilters }) {
  const [encounters, setEncounters] = useState([])
  const [patients, setPatients] = useState([])
  const [clinicians, setClinicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Selected encounter for full consultation workspace
  const [selectedEncounter, setSelectedEncounter] = useState(null)
  const [activeTab, setActiveTab] = useState('notes')
  const [encounterDetails, setEncounterDetails] = useState({
    notes: [],
    diagnoses: [],
    carePlans: [],
    vitals: [],
    labOrders: [],
    prescriptions: []
  })
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Forms inside encounter workspace
  const [newNote, setNewNote] = useState({ note_type: 'progress', content: '' })
  const [amendingNote, setAmendingNote] = useState(null)
  const [newDiagnosis, setNewDiagnosis] = useState({ code: 'I10', description: 'Essential (primary) hypertension' })
  const [newCarePlan, setNewCarePlan] = useState({ description: 'Lifestyle modification, daily BP monitoring, repeat labs in 4 weeks.' })
  const [submittingAction, setSubmittingAction] = useState(false)

  // Modal to open a new encounter
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newEncForm, setNewEncForm] = useState({ patient: '', clinician: '' })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [eRes, pRes, cRes] = await Promise.all([
        getEncounters(),
        getPatients().catch(() => ({ data: [] })),
        getClinicians().catch(() => ({ data: [] }))
      ])
      setEncounters(eRes.data?.results || eRes.data || [])
      setPatients(pRes.data?.results || pRes.data || [])
      setClinicians(cRes.data?.results || cRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load encounters.')
    } finally {
      setLoading(false)
    }
  }

  async function openEncounterWorkspace(enc) {
    setSelectedEncounter(enc)
    setAmendingNote(null)
    setLoadingDetails(true)
    setError('')
    setSuccess('')
    try {
      const [nRes, dRes, cpRes, vRes, lRes, pRes] = await Promise.all([
        getAllPages(getNotes, { encounter: enc.id }),
        getAllPages(getDiagnoses, { encounter: enc.id }),
        getAllPages(getCarePlans, { encounter: enc.id }),
        getAllPages(getVitals, { encounter: enc.id }),
        getAllPages(getLabOrders, { encounter: enc.id }),
        getAllPages(getPrescriptions, { encounter: enc.id })
      ])

      setEncounterDetails({
        notes: nRes,
        diagnoses: dRes,
        carePlans: cpRes,
        vitals: vRes,
        labOrders: lRes,
        prescriptions: pRes
      })
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load consultation records.')
    } finally {
      setLoadingDetails(false)
    }
  }

  async function handleTransition(targetStatus) {
    if (!selectedEncounter) return
    setError('')
    setSuccess('')
    setSubmittingAction(true)
    try {
      const res = await transitionEncounter(selectedEncounter.id, targetStatus)
      const updated = res.data
      setSelectedEncounter(updated)
      setSuccess(`Encounter state changed to: ${targetStatus.toUpperCase()}`)
      loadData()
    } catch (err) {
      const msg = err.response?.data?.status || err.response?.data?.detail || 'State transition rejected by server.'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setSubmittingAction(false)
    }
  }

  async function handleAddNote(e) {
    e.preventDefault()
    if (!newNote.content.trim()) return
    setError('')
    setSubmittingAction(true)
    try {
      await createNote({
        encounter: selectedEncounter.id,
        patient: selectedEncounter.patient,
        note_type: newNote.note_type,
        content: newNote.content,
        approved: true,
        ...(amendingNote ? { amended_from: amendingNote.id } : {})
      })
      const wasAmendment = Boolean(amendingNote)
      setNewNote({ note_type: 'progress', content: '' })
      await openEncounterWorkspace(selectedEncounter)
      setSuccess(wasAmendment ? 'Correction saved as a new note; the original is preserved.' : 'Clinical note authored and saved immutably.')
    } catch (err) {
      const data = err.response?.data
      setError(data?.detail || (data ? JSON.stringify(data) : 'Failed to save clinical note.'))
    } finally {
      setSubmittingAction(false)
    }
  }

  async function handleAddDiagnosis(e) {
    e.preventDefault()
    if (!newDiagnosis.code || !newDiagnosis.description) return
    setError('')
    try {
      await createDiagnosis({
        encounter: selectedEncounter.id,
        patient: selectedEncounter.patient,
        code: newDiagnosis.code,
        description: newDiagnosis.description
      })
      setSuccess('Clinical diagnosis added.')
      setNewDiagnosis({ code: '', description: '' })
      openEncounterWorkspace(selectedEncounter)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add diagnosis.')
    }
  }

  async function handleAddCarePlan(e) {
    e.preventDefault()
    if (!newCarePlan.description) return
    setError('')
    try {
      await createCarePlan({
        encounter: selectedEncounter.id,
        patient: selectedEncounter.patient,
        description: newCarePlan.description
      })
      setSuccess('Care plan documented.')
      setNewCarePlan({ description: '' })
      openEncounterWorkspace(selectedEncounter)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to document care plan.')
    }
  }

  async function handleCreateEncounterSubmit(e) {
    e.preventDefault()
    try {
      const res = await createEncounter({
        patient: newEncForm.patient,
        clinician: newEncForm.clinician
      })
      setShowCreateModal(false)
      loadData()
      openEncounterWorkspace(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to open encounter.')
    }
  }

  const role = me?.role || 'admin'
  const isClinicianOrAdmin = ['clinician', 'admin'].includes(role)

  // Map allowed next states based on current state
  const allowedTransitions = {
    scheduled: ['checked_in', 'cancelled'],
    checked_in: ['in_progress', 'cancelled'],
    in_progress: ['documentation_pending', 'entered_in_error'],
    documentation_pending: ['completed', 'entered_in_error'],
    completed: [],
    cancelled: [],
    entered_in_error: []
  }

  const nextAllowed = selectedEncounter ? (allowedTransitions[selectedEncounter.status] || []) : []

  return (
    <div className="encounters-screen">
      <div className="page-heading">
        <div>
          <h1>Consultations</h1>
        </div>
        <div className="page-actions">
          {isClinicianOrAdmin && (
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={16} /> Open Clinical Encounter
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
          <CheckCircle2 size={16} />
          <div style={{ flex: 1 }}>{success}</div>
          <button className="alert-close" onClick={() => setSuccess('')}>&times;</button>
        </div>
      )}

      {/* State Machine Rule Notice */}
      <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ShieldCheck size={18} color="#92400e" />
        <div>
          <strong>CLINICAL INTEGRITY RULE:</strong> Encounters follow the explicit progression:
          <code> scheduled &rarr; checked_in &rarr; in_progress &rarr; documentation_pending &rarr; completed</code>.
          Transition to <strong>completed</strong> strictly requires an authored clinical note linked to the exact encounter.
        </div>
      </div>

      {/* Main List of Encounters */}
      <div className="panel" style={{ marginBottom: '24px' }}>
        <div className="panel-header">
          <h3>Active & Historical Encounters ({encounters.length})</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>Refresh</button>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading clinical encounters...
            </div>
          ) : encounters.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No encounters found.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Encounter ID</th>
                  <th>Patient</th>
                  <th>Clinician</th>
                  <th>State Machine Status</th>
                  <th>Started / Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {encounters.map((enc) => {
                  const pt = patients.find((p) => p.id === enc.patient)
                  const ptName = pt
                    ? `${pt.first_name} ${pt.last_name}`
                    : enc.patient_name || `Patient ${enc.patient?.slice ? enc.patient.slice(0, 8) : enc.patient}`
                  return (
                    <tr
                      key={enc.id}
                      style={{ background: selectedEncounter?.id === enc.id ? '#f0f9ff' : 'inherit' }}
                    >
                      <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                        {enc.id}
                      </td>
                      <td>
                        <strong>{ptName}</strong>
                      </td>
                      <td>
                        <span style={{ fontSize: '13px' }}>
                          {enc.clinician_name || 'Dr. Attending Clinician'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-${enc.status}`}>
                          {enc.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {new Date(enc.created_at).toLocaleDateString()} {new Date(enc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => openEncounterWorkspace(enc)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <FileText size={12} /> Open Chart Workspace
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Selected Encounter Clinical Workspace */}
      {selectedEncounter && (
        <div className="panel" style={{ border: '2px solid var(--accent)' }}>
          <div className="panel-header" style={{ background: '#f8fafc', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <span className="eyebrow">CONSULTATION WORKSPACE</span>
              <h3 style={{ fontSize: '16px' }}>
                Encounter: {selectedEncounter.id} &mdash; Patient:{' '}
                {selectedEncounter.patient_name || [
                  patients.find((p) => p.id === selectedEncounter.patient)?.first_name,
                  patients.find((p) => p.id === selectedEncounter.patient)?.last_name
                ].filter(Boolean).join(' ') || 'Patient'}
              </h3>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                <span className={`badge badge-${selectedEncounter.status}`}>
                  Current Status: {selectedEncounter.status?.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  Created: {new Date(selectedEncounter.created_at).toLocaleString()}
                </span>
              </div>
            </div>

            {/* State Transition Actions */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Allowed Transitions:</span>
              {nextAllowed.length === 0 ? (
                <span style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>
                  Terminal State (Locked)
                </span>
              ) : (
                nextAllowed.map((target) => (
                  <button
                    key={target}
                    className={`btn btn-xs ${target === 'completed' ? 'btn-success' : target === 'cancelled' || target === 'entered_in_error' ? 'btn-danger' : 'btn-primary'}`}
                    disabled={submittingAction}
                    onClick={() => handleTransition(target)}
                  >
                    Transition to &rarr; {target.replace(/_/g, ' ')}
                  </button>
                ))
              )}
              <button
                className="btn btn-secondary btn-xs"
                onClick={() => setSelectedEncounter(null)}
              >
                Close Workspace
              </button>
            </div>
          </div>

          {/* Sub-tabs within consultation */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', background: '#fff', padding: '0 16px' }}>
            {[
              { id: 'notes', label: `Clinical Notes (${encounterDetails.notes.length})`, icon: FileText },
              { id: 'diagnoses', label: `Diagnoses (${encounterDetails.diagnoses.length})`, icon: Stethoscope },
              { id: 'carePlans', label: `Care Plans (${encounterDetails.carePlans.length})`, icon: FileCheck },
              { id: 'vitals', label: `Vitals (${encounterDetails.vitals.length})`, icon: Activity },
              { id: 'orders', label: `Lab Orders (${encounterDetails.labOrders.length})`, icon: HeartPulse },
              { id: 'rx', label: `Prescriptions (${encounterDetails.prescriptions.length})`, icon: Pill },
            ].map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: '12px 16px',
                    border: '0',
                    background: 'transparent',
                    borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                    color: activeTab === tab.id ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: activeTab === tab.id ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '13px'
                  }}
                >
                  <Icon size={14} /> {tab.label}
                </button>
              )
            })}
          </div>

          <div className="panel-body">
            {loadingDetails ? (
              <div className="inpatient-empty">Loading consultation records...</div>
            ) : (
              <>
            {/* Notes Tab */}
            {activeTab === 'notes' && (
              <div>
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>{amendingNote ? `Correct note #${amendingNote.id}` : 'Append Immutable Clinical Note'}</h4>
                  {amendingNote && <p className="form-hint">The correction is a new entry. The original note remains in the history.</p>}
                  <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <select
                        value={newNote.note_type}
                        onChange={(e) => setNewNote({ ...newNote, note_type: e.target.value })}
                        style={{ width: '180px', height: '38px', borderRadius: '8px', border: '1px solid var(--line)', padding: '0 8px' }}
                      >
                        <option value="progress">Progress Note</option>
                        <option value="consultation">Consultation Note</option>
                        <option value="discharge">Discharge Summary</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Document clinical findings, history of present illness, examination..."
                        required
                        value={newNote.content}
                        onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                        style={{ flex: 1, height: '38px', borderRadius: '8px', border: '1px solid var(--line)', padding: '0 12px' }}
                      />
                      <button type="submit" className="btn btn-primary btn-sm" disabled={submittingAction}>
                        {amendingNote ? 'Save Correction' : '+ Save Note'}
                      </button>
                      {amendingNote && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAmendingNote(null); setNewNote({ note_type: 'progress', content: '' }) }}>Cancel Correction</button>}
                    </div>
                  </form>
                </div>

                <h4 style={{ fontSize: '13px', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Documented Notes History
                </h4>
                {encounterDetails.notes.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', background: '#f8fafc', borderRadius: '8px' }}>
                    No notes authored yet for this encounter. A note is required before completing!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {encounterDetails.notes.map((n) => (
                      <div key={n.id} style={{ background: '#f8fafc', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <strong style={{ textTransform: 'capitalize', color: 'var(--primary)' }}>
                            {n.note_type} Note #{n.id}{n.amended_from ? ` (corrects #${n.amended_from})` : ''}
                          </strong>
                          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                            {new Date(n.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p style={{ fontSize: '13px', color: 'var(--navy)' }}>{n.content}</p>
                        {isClinicianOrAdmin && <button type="button" className="btn btn-secondary btn-xs" onClick={() => { setAmendingNote(n); setNewNote({ note_type: n.note_type, content: '' }) }}>Correct this note</button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Diagnoses Tab */}
            {activeTab === 'diagnoses' && (
              <div>
                <form onSubmit={handleAddDiagnosis} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                  <input
                    type="text"
                    placeholder="ICD Code (e.g. E11.9)"
                    required
                    style={{ width: '160px', height: '38px', borderRadius: '8px', border: '1px solid var(--line)', padding: '0 10px' }}
                    value={newDiagnosis.code}
                    onChange={(e) => setNewDiagnosis({ ...newDiagnosis, code: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Diagnosis description (e.g. Type 2 diabetes mellitus without complications)"
                    required
                    style={{ flex: 1, height: '38px', borderRadius: '8px', border: '1px solid var(--line)', padding: '0 12px' }}
                    value={newDiagnosis.description}
                    onChange={(e) => setNewDiagnosis({ ...newDiagnosis, description: e.target.value })}
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    + Add Diagnosis
                  </button>
                </form>

                <h4 style={{ fontSize: '13px', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Encounter Diagnoses
                </h4>
                {encounterDetails.diagnoses.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>No diagnoses added.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {encounterDetails.diagnoses.map((d) => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                        <span className="badge badge-blue" style={{ fontFamily: 'monospace' }}>{d.code}</span>
                        <strong style={{ fontSize: '13px' }}>{d.description}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Care Plans Tab */}
            {activeTab === 'carePlans' && (
              <div>
                <form onSubmit={handleAddCarePlan} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                  <input
                    type="text"
                    placeholder="Document ongoing care plan, diet, lifestyle, and follow-up guidance..."
                    required
                    style={{ flex: 1, height: '38px', borderRadius: '8px', border: '1px solid var(--line)', padding: '0 12px' }}
                    value={newCarePlan.description}
                    onChange={(e) => setNewCarePlan({ ...newCarePlan, description: e.target.value })}
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    + Add Care Plan
                  </button>
                </form>

                {encounterDetails.carePlans.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>No care plans recorded.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {encounterDetails.carePlans.map((cp) => (
                      <div key={cp.id} style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                        <p style={{ fontSize: '13px', color: 'var(--navy)' }}>{cp.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Vitals Tab */}
            {activeTab === 'vitals' && (
              <div>
                {encounterDetails.vitals.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>
                    No vitals recorded for this encounter yet. Use Triage to record vitals.
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Temp</th>
                        <th>BP</th>
                        <th>HR</th>
                        <th>RR</th>
                        <th>SpO2</th>
                      </tr>
                    </thead>
                    <tbody>
                      {encounterDetails.vitals.map((v) => (
                        <tr key={v.id}>
                          <td>{new Date(v.created_at).toLocaleTimeString()}</td>
                          <td>{v.temperature_c ? `${v.temperature_c} °C` : '—'}</td>
                          <td>{v.systolic && v.diastolic ? `${v.systolic}/${v.diastolic} mmHg` : '—'}</td>
                          <td>{v.heart_rate || '—'} bpm</td>
                          <td>{v.respiratory_rate || '—'} /min</td>
                          <td>{v.oxygen_saturation ? `${v.oxygen_saturation}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Lab Orders Tab */}
            {activeTab === 'orders' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '13px', textTransform: 'uppercase', color: 'var(--muted)' }}>Ordered Tests</h4>
                  <button className="btn btn-secondary btn-xs" onClick={() => onNavigate('laboratory')}>
                    Manage in Laboratory Module &rarr;
                  </button>
                </div>
                {encounterDetails.labOrders.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>No lab orders requested yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {encounterDetails.labOrders.map((lo) => (
                      <div key={lo.id} style={{ display: 'flex', justifyContent: 'space-between', background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                        <strong>{lo.test_name}</strong>
                        <span className={`badge badge-${lo.status}`}>{lo.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Prescriptions Tab */}
            {activeTab === 'rx' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '13px', textTransform: 'uppercase', color: 'var(--muted)' }}>Prescriptions</h4>
                  <button className="btn btn-secondary btn-xs" onClick={() => onNavigate('pharmacy')}>
                    Manage in Pharmacy Module &rarr;
                  </button>
                </div>
                {encounterDetails.prescriptions.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>No prescriptions authorized.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {encounterDetails.prescriptions.map((p) => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                        <div>
                          <strong>{p.medication}</strong> &mdash; {p.dosage}
                          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{p.instructions}</div>
                        </div>
                        <span className={`badge badge-${p.status}`}>{p.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
                  </>
                )}
              </div>
          </div>
      )}

      {/* Modal to Open New Encounter */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Open New Clinical Encounter</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowCreateModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateEncounterSubmit} className="panel-body">
              <div className="form-group">
                <label>Select Patient *</label>
                <select
                  required
                  value={newEncForm.patient}
                  onChange={(e) => setNewEncForm({ ...newEncForm, patient: e.target.value })}
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
                  value={newEncForm.clinician}
                  onChange={(e) => setNewEncForm({ ...newEncForm, clinician: e.target.value })}
                >
                  <option value="">-- Choose Clinician --</option>
                  {clinicians.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || `Dr. ${c.specialty || 'General Practitioner'}`} ({c.specialty || 'General'})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Begin Encounter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

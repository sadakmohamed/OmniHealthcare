import React, { useState, useEffect } from 'react'
import {
  Search,
  Plus,
  User,
  HeartPulse,
  Calendar,
  FileText,
  AlertTriangle,
  Pill,
  Activity,
  X,
  CheckCircle,
  Eye,
  ShieldAlert
} from 'lucide-react'
import {
  getPatients,
  createPatient,
  getEncounters,
  getVitals,
  getPrescriptions,
  getLabResults,
  getAllergies,
  getMedicalHistories
} from '../api'

export default function Patients({ me, onNavigate }) {
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modals
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [patientDetails, setPatientDetails] = useState({
    allergies: [],
    history: [],
    encounters: [],
    vitals: [],
    prescriptions: [],
    labResults: []
  })
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Registration form
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    sex: 'Female',
    phone: '+254-700-000000',
    email: '',
    allergies: 'No known drug allergies'
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchPatients()
  }, [])

  async function fetchPatients(query = '') {
    setLoading(true)
    setError('')
    try {
      const res = await getPatients(query ? { search: query } : {})
      const list = res.data?.results || res.data || []
      setPatients(list)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to fetch patients list.')
    } finally {
      setLoading(false)
    }
  }

  function handleSearch(e) {
    e.preventDefault()
    fetchPatients(search)
  }

  async function handleRegister(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      // Auto-generate MRN if not provided
      const mrn = 'MRN-' + Math.floor(100000 + Math.random() * 900000)
      const payload = {
        ...formData,
        medical_record_number: mrn
      }
      await createPatient(payload)
      setSuccess(`Patient ${formData.first_name} ${formData.last_name} registered successfully with MRN: ${mrn}`)
      setShowRegisterModal(false)
      setFormData({
        first_name: '',
        last_name: '',
        date_of_birth: '',
        sex: 'Female',
        phone: '+254-700-000000',
        email: '',
        allergies: 'No known drug allergies'
      })
      fetchPatients()
    } catch (err) {
      const data = err.response?.data
      if (typeof data === 'object') {
        const msgs = Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | ')
        setError(msgs)
      } else {
        setError(data || 'Failed to register patient.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function openPatientChart(patient) {
    setSelectedPatient(patient)
    setLoadingDetails(true)
    try {
      const [allRes, histRes, encRes, vitRes, rxRes, labRes] = await Promise.all([
        getAllergies({ patient: patient.id }).catch(() => ({ data: [] })),
        getMedicalHistories({ patient: patient.id }).catch(() => ({ data: [] })),
        getEncounters({ patient: patient.id }).catch(() => ({ data: [] })),
        getVitals({ patient: patient.id }).catch(() => ({ data: [] })),
        getPrescriptions({ patient: patient.id }).catch(() => ({ data: [] })),
        getLabResults({ patient: patient.id }).catch(() => ({ data: [] }))
      ])

      setPatientDetails({
        allergies: allRes.data?.results || allRes.data || [],
        history: histRes.data?.results || histRes.data || [],
        encounters: encRes.data?.results || encRes.data || [],
        vitals: vitRes.data?.results || vitRes.data || [],
        prescriptions: rxRes.data?.results || rxRes.data || [],
        labResults: labRes.data?.results || labRes.data || []
      })
    } catch {
      // fallback
    } finally {
      setLoadingDetails(false)
    }
  }

  const canRegister = ['admin', 'receptionist', 'clinician'].includes(me?.role)

  return (
    <div className="patients-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MODULE F01</span>
          <h1>Patient Registry & Master Index</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            Searchable patient records, medical record numbers, demographic identities, and longitudinal charts.
          </p>
        </div>
        <div className="page-actions">
          {canRegister && (
            <button className="btn btn-primary" onClick={() => setShowRegisterModal(true)}>
              <Plus size={16} /> Register New Patient
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
      <div className="toolbar">
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', flex: 1 }}>
          <div className="toolbar-search">
            <Search size={16} color="var(--muted)" />
            <input
              type="text"
              placeholder="Search by patient name, MRN, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
          {search && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSearch('')
                fetchPatients('')
              }}
            >
              Clear
            </button>
          )}
        </form>
        <button className="btn btn-secondary" onClick={() => fetchPatients(search)}>
          Refresh
        </button>
      </div>

      {/* Patient Table */}
      <div className="panel">
        <div className="panel-header">
          <h3>Registered Patients ({patients.length})</h3>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading patient directory...
            </div>
          ) : patients.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No patients found matching your query.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>MRN</th>
                  <th>Full Name</th>
                  <th>Date of Birth / Age</th>
                  <th>Sex</th>
                  <th>Contact Info</th>
                  <th>Allergies Notice</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => {
                  const birthYear = p.date_of_birth ? new Date(p.date_of_birth).getFullYear() : null
                  const age = birthYear ? new Date().getFullYear() - birthYear : 'N/A'
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>
                          {p.medical_record_number}
                        </strong>
                      </td>
                      <td>
                        <strong style={{ fontSize: '14px' }}>
                          {p.first_name} {p.last_name}
                        </strong>
                      </td>
                      <td>
                        {p.date_of_birth} <small style={{ color: 'var(--muted)' }}>({age} yrs)</small>
                      </td>
                      <td>
                        <span className="badge badge-gray">{p.sex || 'Unspecified'}</span>
                      </td>
                      <td>
                        <div>{p.phone || '—'}</div>
                        <small style={{ color: 'var(--muted)' }}>{p.email || '—'}</small>
                      </td>
                      <td>
                        {p.allergies ? (
                          <span style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 500 }}>
                            {p.allergies.length > 25 ? `${p.allergies.slice(0, 25)}...` : p.allergies}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>NKDA</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => openPatientChart(p)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Eye size={13} /> View Chart
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

      {/* Register Patient Modal */}
      {showRegisterModal && (
        <div className="modal-overlay" onClick={() => setShowRegisterModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Register New Patient</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowRegisterModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRegister} className="panel-body">
              <div className="form-row">
                <div className="form-group">
                  <label>First Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Amina"
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Last Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Hassan"
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Date of Birth *</label>
                  <input
                    type="date"
                    required
                    value={formData.date_of_birth}
                    onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Biological Sex *</label>
                  <select
                    value={formData.sex}
                    onChange={(e) => setFormData({ ...formData, sex: e.target.value })}
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other / Non-binary</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Phone Contact</label>
                  <input
                    type="text"
                    placeholder="+254-700-000000"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    placeholder="patient@example.invalid"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Known Allergies / Sensitivities</label>
                <textarea
                  placeholder="e.g. Penicillin (rash), Latex (mild), or 'No known allergies'"
                  value={formData.allergies}
                  onChange={(e) => setFormData({ ...formData, allergies: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowRegisterModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Registering...' : 'Register Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Patient Longitudinal Chart Modal */}
      {selectedPatient && (
        <div className="modal-overlay" onClick={() => setSelectedPatient(null)}>
          <div
            className="modal"
            style={{ maxWidth: '820px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header" style={{ background: '#f8fafc' }}>
              <div>
                <span className="eyebrow">LONGITUDINAL PATIENT CHART</span>
                <h3 style={{ fontSize: '18px', marginTop: '2px' }}>
                  {selectedPatient.first_name} {selectedPatient.last_name}
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--muted)', fontFamily: 'monospace' }}>
                  MRN: {selectedPatient.medical_record_number} &bull; DOB: {selectedPatient.date_of_birth} &bull; Sex: {selectedPatient.sex}
                </span>
              </div>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setSelectedPatient(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="panel-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {loadingDetails ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--muted)' }}>
                  Loading patient chart history...
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Allergies and Alert Box */}
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#991b1b', fontWeight: 700, fontSize: '13px' }}>
                      <ShieldAlert size={16} /> Allergies & Adverse Reactions
                    </div>
                    <p style={{ marginTop: '4px', fontSize: '13px', color: '#7f1d1d' }}>
                      {selectedPatient.allergies || 'No known synthetic allergies documented.'}
                    </p>
                    {patientDetails.allergies.length > 0 && (
                      <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {patientDetails.allergies.map((a) => (
                          <span key={a.id} className="badge badge-red">
                            {a.substance} ({a.severity}) &mdash; {a.reaction}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Vitals Summary */}
                  <div>
                    <h4 style={{ fontSize: '14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Activity size={16} color="var(--accent)" /> Recent Recorded Vitals
                    </h4>
                    {patientDetails.vitals.length === 0 ? (
                      <div style={{ fontSize: '13px', color: 'var(--muted)' }}>No triage vitals on file yet.</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                        {patientDetails.vitals.slice(0, 3).map((v) => (
                          <div key={v.id} style={{ background: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '12px' }}>
                            <div><strong>Temp:</strong> {v.temperature_c ? `${v.temperature_c}°C` : 'N/A'}</div>
                            <div><strong>BP:</strong> {v.systolic && v.diastolic ? `${v.systolic}/${v.diastolic} mmHg` : 'N/A'}</div>
                            <div><strong>HR:</strong> {v.heart_rate ? `${v.heart_rate} bpm` : 'N/A'} | <strong>SpO2:</strong> {v.oxygen_saturation ? `${v.oxygen_saturation}%` : 'N/A'}</div>
                            <small style={{ color: 'var(--muted)', display: 'block', marginTop: '4px' }}>
                              Recorded: {new Date(v.created_at).toLocaleDateString()}
                            </small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Encounters */}
                  <div>
                    <h4 style={{ fontSize: '14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileText size={16} color="var(--primary)" /> Encounters & Consultations ({patientDetails.encounters.length})
                    </h4>
                    {patientDetails.encounters.length === 0 ? (
                      <div style={{ fontSize: '13px', color: 'var(--muted)' }}>No encounters recorded.</div>
                    ) : (
                      <table className="data-table" style={{ fontSize: '12px' }}>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Status</th>
                            <th>Clinician</th>
                          </tr>
                        </thead>
                        <tbody>
                          {patientDetails.encounters.map((enc) => (
                            <tr key={enc.id}>
                              <td>{new Date(enc.created_at).toLocaleDateString()}</td>
                              <td><span className={`badge badge-${enc.status}`}>{enc.status?.replace('_', ' ')}</span></td>
                              <td>{enc.clinician_name || enc.clinician}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Active Prescriptions */}
                  <div>
                    <h4 style={{ fontSize: '14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Pill size={16} color="#7c3aed" /> Medication History & Prescriptions ({patientDetails.prescriptions.length})
                    </h4>
                    {patientDetails.prescriptions.length === 0 ? (
                      <div style={{ fontSize: '13px', color: 'var(--muted)' }}>No authorized medications.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {patientDetails.prescriptions.map((rx) => (
                          <div key={rx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '13px' }}>
                            <div>
                              <strong>{rx.medication}</strong> &mdash; <small>{rx.dosage}</small>
                              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{rx.instructions}</div>
                            </div>
                            <span className={`badge badge-${rx.status}`}>{rx.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Lab Results */}
                  <div>
                    <h4 style={{ fontSize: '14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <HeartPulse size={16} color="#0891b2" /> Laboratory Reports ({patientDetails.labResults.length})
                    </h4>
                    {patientDetails.labResults.length === 0 ? (
                      <div style={{ fontSize: '13px', color: 'var(--muted)' }}>No completed lab results.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {patientDetails.labResults.map((lr) => (
                          <div key={lr.id} style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '13px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <strong>Result: {lr.result}</strong>
                              <span className="badge badge-green">{lr.status}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                              Ref Range: {lr.reference_range || 'Standard'} &bull; Date: {new Date(lr.created_at).toLocaleDateString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="panel-header" style={{ justifyContent: 'flex-end', gap: '8px', background: '#f8fafc' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedPatient(null)}>
                Close Chart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

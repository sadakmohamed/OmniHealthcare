import React, { useState, useEffect } from 'react'
import {
  Users,
  Plus,
  Stethoscope,
  Activity,
  Heart,
  Calendar,
  CheckCircle,
  AlertTriangle,
  X,
  UserCheck,
  Search,
  Filter,
  DollarSign,
  Clock,
  ArrowRight,
  ShieldAlert
} from 'lucide-react'
import {
  getPatients,
  createPatient,
  getClinicians,
  createVitals,
  getEncounters
} from '../api'

export default function OPDQueue({ me, onSelectConsultation, listFilters }) {
  const [patients, setPatients] = useState([])
  const [clinicians, setClinicians] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [clinicianFilter, setClinicianFilter] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modals
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [showVitalsModal, setShowVitalsModal] = useState(false)
  const [selectedPatientForVitals, setSelectedPatientForVitals] = useState(null)

  // Registration Form (Receptionist)
  const [regForm, setRegForm] = useState({
    first_name: '',
    last_name: '',
    sex: 'Female',
    age: '',
    date_of_birth: '',
    phone: '',
    email: '',
    registration_date: new Date().toISOString().split('T')[0],
    assigned_clinician: '',
    allergies: ''
  })

  // Nurse Vitals Form
  const [vitalsForm, setVitalsForm] = useState({
    temperature_c: '36.8',
    systolic: '120',
    diastolic: '80',
    heart_rate: '72',
    respiratory_rate: '16',
    oxygen_saturation: '98',
    weight_kg: '68.5',
    height_cm: '168'
  })

  const [submitting, setSubmitting] = useState(false)

  const role = me?.role || 'admin'
  const isClinician = role === 'clinician'
  const isNurse = role === 'nurse'
  const isReceptionist = role === 'receptionist'
  const isAdmin = role === 'admin'

  useEffect(() => {
    loadData()
  }, [statusFilter, clinicianFilter])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = { is_opd: true }
      if (statusFilter) params.opd_status = statusFilter
      if (clinicianFilter) params.assigned_clinician = clinicianFilter

      const [pRes, cRes, eRes] = await Promise.all([
        getPatients(params),
        getClinicians().catch(() => ({ data: [] })),
        getEncounters().catch(() => ({ data: [] }))
      ])

      setPatients(pRes.data?.results || pRes.data || [])
      setClinicians(cRes.data?.results || cRes.data || [])
      setEncounters(eRes.data?.results || eRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load OPD queue.')
    } finally {
      setLoading(false)
    }
  }

  // Selected Doctor details in registration
  const chosenDoctor = clinicians.find((c) => String(c.id) === String(regForm.assigned_clinician))
  const chosenDoctorPrice = chosenDoctor
    ? ((chosenDoctor.opd_consultation_price || 5000) / 100).toFixed(2)
    : '0.00'

  async function handleRegisterOPD(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      // Calculate date of birth if age provided
      let dob = regForm.date_of_birth
      if (!dob && regForm.age) {
        const year = new Date().getFullYear() - parseInt(regForm.age, 10)
        dob = `${year}-06-15`
      }

      const mrn = 'OPD-' + Math.floor(100000 + Math.random() * 900000)
      const response = await createPatient({
        medical_record_number: mrn,
        first_name: regForm.first_name,
        last_name: regForm.last_name,
        sex: regForm.sex,
        age: parseInt(regForm.age, 10) || null,
        date_of_birth: dob,
        phone: regForm.phone,
        email: regForm.email,
        registration_date: regForm.registration_date,
        allergies: regForm.allergies,
        is_opd: true,
        opd_status: 'registered',
        assigned_clinician: regForm.assigned_clinician || null
      })

      const docName = chosenDoctor?.name || 'Assigned Consultant'
      setSuccess(
        `OPD Patient ${regForm.first_name} ${regForm.last_name} registered successfully. Username: ${response.data.phone}. Temporary password: ${response.data.temporary_password}. Give it privately to the patient; it will not be shown again. Assigned to ${docName}. Consultation fee ($${chosenDoctorPrice}) billed.`
      )
      setShowRegisterModal(false)
      setRegForm({
        first_name: '',
        last_name: '',
        sex: 'Female',
        age: '',
        date_of_birth: '',
        phone: '',
        email: '',
        registration_date: new Date().toISOString().split('T')[0],
        assigned_clinician: '',
        allergies: ''
      })
      loadData()
    } catch (err) {
      const data = err.response?.data
      if (typeof data === 'object') {
        setError(Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | '))
      } else {
        setError(data || 'Failed to register OPD patient.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function openVitalsModal(patient) {
    setSelectedPatientForVitals(patient)
    setShowVitalsModal(true)
  }

  async function handleSaveVitals(e) {
    e.preventDefault()
    if (!selectedPatientForVitals) return
    setSubmitting(true)
    setError('')
    try {
      // Find or link encounter
      const linkedEnc = encounters.find((e) => String(e.patient) === String(selectedPatientForVitals.id))
      await createVitals({
        patient: selectedPatientForVitals.id,
        encounter: linkedEnc ? linkedEnc.id : null,
        temperature_c: parseFloat(vitalsForm.temperature_c) || null,
        systolic: parseInt(vitalsForm.systolic, 10) || null,
        diastolic: parseInt(vitalsForm.diastolic, 10) || null,
        heart_rate: parseInt(vitalsForm.heart_rate, 10) || null,
        respiratory_rate: parseInt(vitalsForm.respiratory_rate, 10) || null,
        oxygen_saturation: parseInt(vitalsForm.oxygen_saturation, 10) || null,
        weight_kg: parseFloat(vitalsForm.weight_kg) || null,
        height_cm: parseInt(vitalsForm.height_cm, 10) || null
      })

      setSuccess(`Vitals recorded for ${selectedPatientForVitals.first_name}. Patient is ready for doctor consultation.`)
      setShowVitalsModal(false)
      setSelectedPatientForVitals(null)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to record vitals.')
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = patients.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.first_name?.toLowerCase().includes(q) ||
      p.last_name?.toLowerCase().includes(q) ||
      p.medical_record_number?.toLowerCase().includes(q) ||
      p.phone?.includes(q)
    )
  })

  return (
    <div className="opd-queue-screen">
      <div className="page-heading">
        <div>
          <h1>OPD Queue</h1>
        </div>
        <div className="page-actions">
          {(isReceptionist || isAdmin) && (
            <button className="btn btn-primary" onClick={() => setShowRegisterModal(true)}>
              <Plus size={16} /> Register OPD Patient
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

      {/* Filters & Status Bar */}
      <div className="toolbar">
        <div className="toolbar-search">
          <Search size={16} color="var(--muted)" />
          <input
            type="text"
            placeholder="Search OPD patient by name, MRN, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All OPD Statuses ({patients.length})</option>
          <option value="registered">Awaiting Triage Vitals</option>
          <option value="vitals_recorded">Ready for Doctor Consultation</option>
          <option value="in_consultation">In Doctor Consultation</option>
          <option value="investigations_pending">Investigations Ordered</option>
          <option value="completed">Completed Consultations</option>
        </select>

        {!isClinician && (
          <select
            className="filter-select"
            value={clinicianFilter}
            onChange={(e) => setClinicianFilter(e.target.value)}
          >
            <option value="">All Consultants</option>
            {clinicians.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || 'Doctor'} ({c.department || c.specialty})
              </option>
            ))}
          </select>
        )}

        <button className="btn btn-secondary" onClick={loadData}>
          Refresh Queue
        </button>
      </div>

      {/* OPD Patients Table */}
      <div className="panel">
        <div className="panel-header">
          <h3>
            {isClinician ? 'My patients' : 'OPD queue'} ({filtered.length})
          </h3>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading OPD queue...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No patients found.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>MRN / Date</th>
                  <th>Patient</th>
                  <th>Clinician</th>
                  <th>Status</th>
                  <th>Vitals</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((pt) => {
                  const doc = clinicians.find((c) => c.id === pt.assigned_clinician)
                  const docName = doc ? (doc.name || `Dr. ${doc.specialty}`) : (pt.assigned_clinician_name || 'General OPD')
                  const docPrice = doc ? ((doc.opd_consultation_price || 5000) / 100).toFixed(2) : '50.00'
                  const vitals = pt.latest_vitals

                  return (
                    <tr key={pt.id}>
                      <td>
                        <strong style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>
                          {pt.medical_record_number}
                        </strong>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {pt.registration_date || new Date(pt.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td>
                        <strong style={{ fontSize: '14px' }}>
                          {pt.first_name} {pt.last_name}
                        </strong>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          Sex: {pt.sex || '—'} &bull; Age: {pt.age ? `${pt.age} yrs` : '—'} &bull; Phone: {pt.phone || '—'}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Stethoscope size={14} color="var(--accent)" />
                          <strong>{docName}</strong>
                        </div>
                        <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
                          OPD Fee: ${docPrice}
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-${pt.opd_status === 'vitals_recorded' ? 'cyan' : pt.opd_status === 'completed' ? 'green' : pt.opd_status === 'in_consultation' ? 'blue' : 'amber'}`}>
                          {pt.opd_status ? pt.opd_status.replace(/_/g, ' ') : 'registered'}
                        </span>
                      </td>
                      <td>
                        {isReceptionist ? (
                          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
                            {pt.opd_status !== 'registered' ? 'Triage recorded' : 'Awaiting nurse triage'}
                          </span>
                        ) : vitals ? (
                          <div style={{ fontSize: '12px' }}>
                            <span style={{ fontWeight: 600 }}>BP:</span> {vitals.systolic}/{vitals.diastolic} mmHg &bull;{' '}
                            <span style={{ fontWeight: 600 }}>HR:</span> {vitals.heart_rate} bpm
                            <div style={{ color: 'var(--muted)', fontSize: '11px' }}>
                              Temp: {vitals.temperature_c}°C &bull; SpO2: {vitals.oxygen_saturation}%
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#d97706', fontSize: '12px', fontStyle: 'italic' }}>
                            Awaiting nurse vitals
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {/* Nurse Record Vitals Button */}
                          {(isNurse || isAdmin) && pt.opd_status !== 'completed' && (
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() => openVitalsModal(pt)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <Activity size={12} color="#0891b2" />
                              {vitals ? 'Re-take Vitals' : 'Measure Vitals'}
                            </button>
                          )}

                          {/* Doctor Start / Open Consultation */}
                          {(isClinician || isAdmin) && (
                            pt.opd_status === 'completed' ? (
                              <span className="badge badge-green">Consultation complete</span>
                            ) : pt.latest_vitals ? <button
                              className="btn btn-primary btn-xs"
                              onClick={() => onSelectConsultation(pt)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <Stethoscope size={12} />
                              Consult Doctor &rarr;
                            </button> : <span className="badge badge-amber">Awaiting nurse triage</span>
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

      {/* Receptionist Register Patient Modal */}
      {showRegisterModal && (
        <div className="modal-overlay" onClick={() => setShowRegisterModal(false)}>
          <div className="modal" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Reception: Register OPD Patient & Assign Consultant</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowRegisterModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRegisterOPD} className="panel-body">
              <div className="form-row">
                <div className="form-group">
                  <label>First Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Amina"
                    value={regForm.first_name}
                    onChange={(e) => setRegForm({ ...regForm, first_name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Last Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Hassan"
                    value={regForm.last_name}
                    onChange={(e) => setRegForm({ ...regForm, last_name: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row-3">
                <div className="form-group">
                  <label>Biological Sex *</label>
                  <select
                    value={regForm.sex}
                    onChange={(e) => setRegForm({ ...regForm, sex: e.target.value })}
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Age (Years) *</label>
                  <input
                    type="number"
                    required
                    placeholder="e.g. 34"
                    value={regForm.age}
                    onChange={(e) => setRegForm({ ...regForm, age: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Visit Date *</label>
                  <input
                    type="date"
                    required
                    value={regForm.registration_date}
                    onChange={(e) => setRegForm({ ...regForm, registration_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Phone Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="+254-700-123456"
                    value={regForm.phone}
                    onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Email (Optional)</label>
                  <input
                    type="email"
                    placeholder="patient@example.invalid"
                    value={regForm.email}
                    onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                  />
                </div>
              </div>

              {/* Consultant Assignment with Auto-Pricing */}
              <div
                style={{
                  background: '#f0f9ff',
                  border: '1.5px solid #bae6fd',
                  borderRadius: '10px',
                  padding: '14px',
                  marginTop: '6px',
                  marginBottom: '14px'
                }}
              >
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ color: '#0369a1', fontSize: '13px' }}>
                    Select Consultant Doctor to Assign Patient *
                  </label>
                  <select
                    required
                    value={regForm.assigned_clinician}
                    onChange={(e) => setRegForm({ ...regForm, assigned_clinician: e.target.value })}
                    style={{ borderColor: '#38bdf8', marginTop: '4px' }}
                  >
                    <option value="">-- Choose Doctor / Department --</option>
                    {clinicians.map((c) => {
                      const price = ((c.opd_consultation_price || 5000) / 100).toFixed(2)
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name || 'Dr.'} &bull; {c.department || c.specialty} &mdash; Fee: ${price}
                        </option>
                      )
                    })}
                  </select>
                  {chosenDoctor && (
                    <div style={{ marginTop: '8px', fontSize: '13px', color: '#0c4a6e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
                        Department: <strong>{chosenDoctor.department || chosenDoctor.specialty}</strong>
                      </span>
                      <strong style={{ color: '#15803d', fontSize: '14px' }}>
                        OPD Consultation Fee: ${chosenDoctorPrice}
                      </strong>
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>Known Allergies / Alerts</label>
                <input
                  type="text"
                  placeholder="e.g. Penicillin, Sulfa, or 'NKDA'"
                  value={regForm.allergies}
                  onChange={(e) => setRegForm({ ...regForm, allergies: e.target.value })}
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
                  {submitting ? 'Registering...' : 'Complete OPD Registration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* OPD Nurse Record Vitals Modal */}
      {showVitalsModal && selectedPatientForVitals && (
        <div className="modal-overlay" onClick={() => setShowVitalsModal(false)}>
          <div className="modal" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
            <div className="panel-header" style={{ background: '#f8fafc' }}>
              <div>
                <span className="eyebrow">Patient vitals</span>
                <h3 style={{ fontSize: '16px' }}>
                  Measure Vitals: {selectedPatientForVitals.first_name} {selectedPatientForVitals.last_name}
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  Age: {selectedPatientForVitals.age} &bull; Sex: {selectedPatientForVitals.sex} &bull; MRN: {selectedPatientForVitals.medical_record_number}
                </span>
              </div>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowVitalsModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveVitals} className="panel-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Systolic BP (mmHg) *</label>
                  <input
                    type="number"
                    required
                    placeholder="120"
                    value={vitalsForm.systolic}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, systolic: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Diastolic BP (mmHg) *</label>
                  <input
                    type="number"
                    required
                    placeholder="80"
                    value={vitalsForm.diastolic}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, diastolic: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Body Temperature (°C) *</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    placeholder="36.8"
                    value={vitalsForm.temperature_c}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, temperature_c: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Heart Rate (BPM) *</label>
                  <input
                    type="number"
                    required
                    placeholder="72"
                    value={vitalsForm.heart_rate}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, heart_rate: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Respiratory Rate (/min)</label>
                  <input
                    type="number"
                    placeholder="16"
                    value={vitalsForm.respiratory_rate}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, respiratory_rate: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Oxygen Saturation (SpO2 %)</label>
                  <input
                    type="number"
                    placeholder="98"
                    value={vitalsForm.oxygen_saturation}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, oxygen_saturation: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Patient Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="68.5"
                    value={vitalsForm.weight_kg}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, weight_kg: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Patient Height (cm)</label>
                  <input
                    type="number"
                    placeholder="168"
                    value={vitalsForm.height_cm}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, height_cm: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowVitalsModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Recording...' : 'Commit Vitals & Ready Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

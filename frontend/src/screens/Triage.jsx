import React, { useState, useEffect } from 'react'
import {
  Activity,
  Plus,
  Heart,
  Thermometer,
  Wind,
  Droplets,
  AlertTriangle,
  CheckCircle,
  X,
  UserCheck,
  Search
} from 'lucide-react'
import {
  getVitals,
  createVitals,
  getEncounters,
  getPatients,
  getAllAllergies,
  getInpatientAdmissions
} from '../api'

export default function Triage({ me, onNavigate, listFilters }) {
  const [vitalsList, setVitalsList] = useState([])
  const [encounters, setEncounters] = useState([])
  const [patients, setPatients] = useState([])
  const [admissions, setAdmissions] = useState([])
  const [patientAllergies, setPatientAllergies] = useState(null)
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    encounter: '',
    patient: '',
    temperature_c: '36.8',
    systolic: '120',
    diastolic: '80',
    heart_rate: '72',
    respiratory_rate: '16',
    oxygen_saturation: '98'
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    let active = true
    if (form.patient) {
      getAllAllergies({ patient: form.patient }).then((allergies) => {
        if (active) setPatientAllergies(allergies)
      }).catch((err) => {
        if (active) setError(err.response?.data?.detail || 'Unable to load patient allergies.')
      })
    }
    return () => { active = false }
  }, [form.patient])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [vRes, eRes, pRes, aRes] = await Promise.all([
        getVitals(),
        getEncounters(),
        getPatients(),
        getInpatientAdmissions()
      ])
      setVitalsList(vRes.data?.results || vRes.data || [])
      setEncounters(eRes.data?.results || eRes.data || [])
      setPatients(pRes.data?.results || pRes.data || [])
      setAdmissions(aRes.data?.results || aRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load triage vitals.')
    } finally {
      setLoading(false)
    }
  }

  function handleEncounterSelect(encId) {
    const enc = encounters.find((e) => String(e.id) === encId)
    setPatientAllergies(null)
    setForm({
      ...form,
      encounter: encId,
      patient: enc ? enc.patient : form.patient
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        encounter: form.encounter,
        patient: form.patient,
        temperature_c: parseFloat(form.temperature_c) || null,
        systolic: parseInt(form.systolic, 10) || null,
        diastolic: parseInt(form.diastolic, 10) || null,
        heart_rate: parseInt(form.heart_rate, 10) || null,
        respiratory_rate: parseInt(form.respiratory_rate, 10) || null,
        oxygen_saturation: parseInt(form.oxygen_saturation, 10) || null
      }

      await createVitals(payload)
      setSuccess('Patient vitals recorded and verified successfully in triage.')
      setShowModal(false)
      loadData()
    } catch (err) {
      const data = err.response?.data
      if (typeof data === 'object') {
        setError(Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('; '))
      } else {
        setError(data || 'Failed to record vitals.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const role = me?.role || 'admin'
  const canRecord = ['nurse', 'admin'].includes(role)
  const activeAdmissionByPatient = new Map(admissions.map((admission) => [admission.patient, admission]))
  const filteredVitals = vitalsList.filter((vital) => {
    const patient = patients.find((item) => item.id === vital.patient)
    const admission = activeAdmissionByPatient.get(vital.patient)
    const department = admission ? 'ipd' : patient?.is_opd ? 'opd' : ''
    const matchesDepartment = !departmentFilter || department === departmentFilter
    const searchValue = [
      patient?.first_name,
      patient?.last_name,
      patient?.medical_record_number,
      vital.patient
    ].join(' ').toLowerCase()
    return matchesDepartment && searchValue.includes(search.toLowerCase())
  })

  return (
    <div className="triage-screen">
      <div className="page-heading">
        <div>
          <h1>Triage & Vitals</h1>
        </div>
        <div className="page-actions">
          {canRecord && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Record Patient Vitals
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

      {/* Triage Reference Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' }}>
        <div className="panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626', fontWeight: 600, fontSize: '13px' }}>
            <Heart size={18} /> Heart Rate
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>60 &ndash; 100 bpm</div>
          <small style={{ color: 'var(--muted)' }}>Normal adult resting range</small>
        </div>
        <div className="panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#2563eb', fontWeight: 600, fontSize: '13px' }}>
            <Activity size={18} /> Blood Pressure
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>120 / 80 mmHg</div>
          <small style={{ color: 'var(--muted)' }}>Standard systolic / diastolic</small>
        </div>
        <div className="panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0891b2', fontWeight: 600, fontSize: '13px' }}>
            <Droplets size={18} /> SpO2 Saturation
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>&ge; 95%</div>
          <small style={{ color: 'var(--muted)' }}>Normal arterial oxygenation</small>
        </div>
        <div className="panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#d97706', fontWeight: 600, fontSize: '13px' }}>
            <Thermometer size={18} /> Temperature
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>36.5 &ndash; 37.5 °C</div>
          <small style={{ color: 'var(--muted)' }}>Normothermic afebrile range</small>
        </div>
      </div>

      {/* Vitals History Log */}
      <div className="panel">
        <div className="panel-header">
          <h3>Recorded Triage Vitals History ({filteredVitals.length})</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>
            Refresh
          </button>
        </div>
        <div className="toolbar triage-filters">
          <div className="toolbar-search">
            <Search size={16} />
            <input
              aria-label="Search patients in triage"
              placeholder="Search patient name or ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            aria-label="Filter by care department"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="">All departments</option>
            <option value="opd">OPD</option>
            <option value="ipd">IPD</option>
          </select>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading triage observations...
            </div>
          ) : filteredVitals.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No vitals match this search.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Patient</th>
                  <th>Department</th>
                  <th>Temperature</th>
                  <th>Blood Pressure</th>
                  <th>Heart Rate</th>
                  <th>Resp Rate</th>
                  <th>SpO2 Sat</th>
                  <th>Recorded By</th>
                </tr>
              </thead>
              <tbody>
                {filteredVitals.map((v) => {
                  const pt = patients.find((p) => p.id === v.patient)
                  const admission = activeAdmissionByPatient.get(v.patient)
                  const ptName = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${v.patient?.slice ? v.patient.slice(0, 8) : v.patient}`
                  return (
                    <tr key={v.id}>
                      <td>
                        <strong>{new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {new Date(v.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td>
                        <strong>{ptName}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {pt?.medical_record_number || ''}
                        </div>
                      </td>
                      <td>{admission ? `IPD · ${admission.ward_name}` : pt?.is_opd ? 'OPD' : '—'}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: v.temperature_c > 38 ? '#dc2626' : 'inherit' }}>
                          {v.temperature_c ? `${v.temperature_c} °C` : '—'}
                        </span>
                      </td>
                      <td>
                        <strong>{v.systolic && v.diastolic ? `${v.systolic}/${v.diastolic}` : '—'}</strong>{' '}
                        <small style={{ color: 'var(--muted)' }}>mmHg</small>
                      </td>
                      <td>
                        <strong>{v.heart_rate || '—'}</strong> <small style={{ color: 'var(--muted)' }}>bpm</small>
                      </td>
                      <td>
                        <strong>{v.respiratory_rate || '—'}</strong> <small style={{ color: 'var(--muted)' }}>/min</small>
                      </td>
                      <td>
                        <span
                          className={`badge ${v.oxygen_saturation && v.oxygen_saturation < 94 ? 'badge-red' : 'badge-green'}`}
                        >
                          {v.oxygen_saturation ? `${v.oxygen_saturation}%` : '—'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '12px', color: 'var(--navy)' }}>
                          {v.recorded_by_name || 'Nursing Staff'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Record Vitals Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Record Triage Vital Signs</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="panel-body">
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <div className="form-group">
                <label>Linked Encounter / Active Visit *</label>
                <select
                  required
                  value={form.encounter}
                  onChange={(e) => handleEncounterSelect(e.target.value)}
                >
                  <option value="">-- Select Active Encounter --</option>
                  {encounters.map((enc) => {
                    const pt = patients.find((p) => p.id === enc.patient)
                    const name = pt ? `${pt.first_name} ${pt.last_name}` : `Patient ${enc.patient?.slice ? enc.patient.slice(0, 8) : enc.patient}`
                    return (
                      <option key={enc.id} value={enc.id}>
                        {name} &mdash; Status: {enc.status} (ID: {enc.id})
                      </option>
                    )
                  })}
                </select>
              </div>

              {form.patient && (
                <div className="notice">
                  Allergies: {[
                    patients.find((patient) => String(patient.id) === String(form.patient))?.allergies,
                    ...(patientAllergies || []).map((allergy) => `${allergy.substance}${allergy.reaction ? ` — ${allergy.reaction}` : ''}`)
                  ].filter(Boolean).join('; ') || 'Not recorded'}
                  {patientAllergies === null && ' (Structured allergies not yet available)'}
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Temperature (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="36.8"
                    value={form.temperature_c}
                    onChange={(e) => setForm({ ...form, temperature_c: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Heart Rate (BPM)</label>
                  <input
                    type="number"
                    placeholder="72"
                    value={form.heart_rate}
                    onChange={(e) => setForm({ ...form, heart_rate: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Systolic Pressure (mmHg)</label>
                  <input
                    type="number"
                    placeholder="120"
                    value={form.systolic}
                    onChange={(e) => setForm({ ...form, systolic: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Diastolic Pressure (mmHg)</label>
                  <input
                    type="number"
                    placeholder="80"
                    value={form.diastolic}
                    onChange={(e) => setForm({ ...form, diastolic: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Respiratory Rate (/min)</label>
                  <input
                    type="number"
                    placeholder="16"
                    value={form.respiratory_rate}
                    onChange={(e) => setForm({ ...form, respiratory_rate: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Oxygen Saturation (SpO2 %)</label>
                  <input
                    type="number"
                    placeholder="98"
                    value={form.oxygen_saturation}
                    onChange={(e) => setForm({ ...form, oxygen_saturation: e.target.value })}
                  />
                </div>
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
                  {submitting ? 'Saving...' : 'Save Triage Vitals'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import {
  Stethoscope,
  Activity,
  Heart,
  Thermometer,
  Wind,
  Droplets,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  X,
  Calendar,
  Clock,
  FileText,
  Microscope,
  DollarSign,
  ArrowLeft,
  CheckCircle2,
  FileCheck,
  ShieldCheck,
  User
} from 'lucide-react'
import {
  getEncounters,
  createEncounter,
  getVitals,
  saveConsultation,
  batchOrderLabInvestigations,
  getLabOrders,
  getLabResults,
  getLabTests,
  getMedications,
  getAllAllergies,
  batchPrescribe,
  getPrescriptions,
  getImagingTests,
  createImagingOrder
} from '../api'

export default function DoctorConsultation({ patient, me, onBack }) {
  const [encounter, setEncounter] = useState(null)
  const [vitals, setVitals] = useState(null)
  const [labOrders, setLabOrders] = useState([])
  const [labTests, setLabTests] = useState([])
  const [medications, setMedications] = useState([])
  const [allergies, setAllergies] = useState([])
  const [prescriptions, setPrescriptions] = useState([])
  const [medicationRows, setMedicationRows] = useState([
    { medication: '', dosage: '', instructions: '' }
  ])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Structured Medical History
  const [historyForm, setHistoryForm] = useState({
    history_of_present_illness: '',
    past_medical_history: '',
    history_of_surgery: '',
    follow_up_days: '7',
    follow_up_date: '',
    follow_up_message: 'Review lab investigations and assess clinical response.'
  })

  // Dynamic Multiple Investigations Rows
  const [investigations, setInvestigations] = useState([
    { test_name: '', price: 0 }
  ])

  // Imaging Tests
  const [imagingTests, setImagingTests] = useState([])
  const [imagingOrders, setImagingOrders] = useState([])
  const [imagingRows, setImagingRows] = useState([
    { test_name: '', price: 0 }
  ])

  const [savingHistory, setSavingHistory] = useState(false)
  const [orderingLabs, setOrderingLabs] = useState(false)
  const [orderingImaging, setOrderingImaging] = useState(false)
  const [savingPrescriptions, setSavingPrescriptions] = useState(false)

  useEffect(() => {
    loadConsultationData()
  }, [patient])

  useEffect(() => {
    if (!encounter) return undefined
    const timer = window.setInterval(() => {
      refreshLabOrders(encounter.id)
      refreshPrescriptions(encounter.id)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [encounter?.id, patient?.id])

  async function loadConsultationData() {
    setLoading(true)
    setError('')
    try {
      // Find or create active encounter for this OPD patient
      const [eRes, vRes, testsRes, imagingTestsRes, medicationsRes, allergiesRes] = await Promise.all([
        getEncounters({ patient: patient.id }),
        getVitals({ patient: patient.id }),
        getLabTests(),
        getImagingTests(),
        getMedications(),
        getAllAllergies({ patient: patient.id })
      ])
      setLabTests(testsRes.data.filter((test) => test.active))
      setImagingTests(imagingTestsRes.data.filter((test) => test.active))
      setMedications(medicationsRes.data)
      setAllergies(allergiesRes)

      const encs = eRes.data?.results || eRes.data || []
      let activeEnc = encs.find((e) => e.status !== 'completed' && e.status !== 'cancelled')

      if (!activeEnc) {
        if (encs.length > 0) {
          activeEnc = encs[0]
        } else {
          // Create an encounter for this consultation
          const newEncRes = await createEncounter({
            patient: patient.id,
            clinician: patient.assigned_clinician || me?.clinician_id
          })
          activeEnc = newEncRes.data
        }
      }

      setEncounter(activeEnc)

      // Pre-fill history if already documented
      if (activeEnc) {
        setHistoryForm((prev) => ({
          ...prev,
          history_of_present_illness: activeEnc.history_of_present_illness || '',
          past_medical_history: activeEnc.past_medical_history || '',
          history_of_surgery: activeEnc.history_of_surgery || '',
          follow_up_days: activeEnc.follow_up_days || '7',
          follow_up_date: activeEnc.follow_up_date || ''
        }))
      }

      // Latest Vitals
      const vitalsList = vRes.data?.results || vRes.data || []
      if (vitalsList.length > 0) {
        setVitals(vitalsList[0])
      }

      // Load patient lab orders with results
      if (activeEnc) {
        await Promise.all([
          refreshLabOrders(activeEnc.id),
          refreshPrescriptions(activeEnc.id)
        ])
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load consultation workspace.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshLabOrders(encId) {
    try {
      const [ordersRes, resultsRes] = await Promise.all([
        getLabOrders({ patient: patient.id, encounter: encId }),
        getLabResults({ patient: patient.id, encounter: encId })
      ])
      const orders = ordersRes.data?.results || ordersRes.data || []
      const results = resultsRes.data?.results || resultsRes.data || []

      // Merge results with orders
      const merged = orders.map((o) => {
        const res = results.find((r) => r.order === o.id && r.is_current)
        return {
          ...o,
          result: res ? res.result : null,
          reference_range: res ? res.reference_range : null,
          result_status: res ? res.status : null
        }
      })
      setLabOrders(merged)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not refresh laboratory results.')
    }
  }

  async function refreshPrescriptions(encId) {
    try {
      const res = await getPrescriptions({ patient: patient.id, encounter: encId })
      setPrescriptions(res.data?.results || res.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load prescriptions.')
    }
  }

  // Dynamic Investigation Row Management
  function addInvestigationRow() {
    setInvestigations([
      ...investigations,
      { test_name: '', price: 0 }
    ])
  }

  function removeInvestigationRow(index) {
    if (investigations.length <= 1) {
      setInvestigations([{ test_name: '', price: 0 }])
      return
    }
    const updated = investigations.filter((_, i) => i !== index)
    setInvestigations(updated)
  }

  function updateInvestigationRow(index, field, value) {
    const updated = [...investigations]
    if (field === 'test_name') {
      const match = labTests.find((t) => t.name === value)
      updated[index].test_name = value
      updated[index].price = match ? match.price_cents / 100 : 0
    }
    setInvestigations(updated)
  }

  // Imaging Row Management
  function addImagingRow() {
    setImagingRows([
      ...imagingRows,
      { test_name: '', price: 0 }
    ])
  }

  function removeImagingRow(index) {
    if (imagingRows.length <= 1) {
      setImagingRows([{ test_name: '', price: 0 }])
      return
    }
    const updated = imagingRows.filter((_, i) => i !== index)
    setImagingRows(updated)
  }

  function updateImagingRow(index, field, value) {
    const updated = [...imagingRows]
    if (field === 'test_name') {
      const match = imagingTests.find((t) => t.name === value)
      updated[index].test_name = value
      updated[index].price = match ? match.price_cents / 100 : 0
    }
    setImagingRows(updated)
  }

  // Submit Multiple Investigations and Auto-Bill
  async function handleOrderInvestigations(e) {
    e.preventDefault()
    const validTests = investigations.filter((it) => it.test_name.trim() !== '')
    if (validTests.length === 0) {
      setError('Please specify at least one laboratory test investigation.')
      return
    }

    setOrderingLabs(true)
    setError('')
    try {
      const payload = {
        patient: patient.id,
        encounter: encounter ? encounter.id : null,
        investigations: validTests.map((it) => ({
          test_name: it.test_name,
          price_cents: Math.round(it.price * 100)
        }))
      }

      await batchOrderLabInvestigations(payload)
      setSuccess(`${validTests.length} test${validTests.length === 1 ? '' : 's'} ordered and sent for billing.`)

      // Reset to one blank row
      setInvestigations([{ test_name: '', price: 0 }])
      await refreshLabOrders(encounter?.id)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to order investigations.')
    } finally {
      setOrderingLabs(false)
    }
  }

  // Order Imaging Tests
  async function handleOrderImaging(e) {
    e.preventDefault()
    const validTests = imagingRows.filter((it) => it.test_name.trim() !== '')
    if (validTests.length === 0) {
      setError('Please specify at least one imaging test.')
      return
    }

    setOrderingImaging(true)
    setError('')
    try {
      // Order each imaging test one by one
      for (const test of validTests) {
        const payload = {
          patient: patient.id,
          encounter: encounter ? encounter.id : null,
          test_name: test.test_name,
          price_cents: Math.round(test.price * 100)
        }
        await createImagingOrder(payload)
      }
      setSuccess(`${validTests.length} imaging test${validTests.length === 1 ? '' : 's'} ordered and sent for billing.`)

      // Reset to one blank row
      setImagingRows([{ test_name: '', price: 0 }])
      setImagingOrders([])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to order imaging tests.')
    } finally {
      setOrderingImaging(false)
    }
  }

  // Save Clinical History & Follow-Up
  async function handleSaveHistory(completeVisit = false) {
    if (!encounter) {
      setError('No active encounter found to save clinical history.')
      return
    }
    setSavingHistory(true)
    setError('')
    try {
      const payload = {
        history_of_present_illness: historyForm.history_of_present_illness,
        past_medical_history: historyForm.past_medical_history,
        history_of_surgery: historyForm.history_of_surgery,
        follow_up_days: historyForm.follow_up_days,
        follow_up_date: historyForm.follow_up_date || null,
        follow_up_message: historyForm.follow_up_message,
        complete: completeVisit
      }

      const res = await saveConsultation(encounter.id, payload)
      setEncounter(res.data)

      if (completeVisit) {
        setSuccess('Consultation completed.')
        setTimeout(() => onBack(), 1200)
      } else {
        setSuccess('Clinical notes saved.')
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save clinical history.')
    } finally {
      setSavingHistory(false)
    }
  }

  function addMedicationRow() {
    setMedicationRows((rows) => [...rows, { medication: '', dosage: '', instructions: '' }])
  }

  function removeMedicationRow(index) {
    setMedicationRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
  }

  function updateMedicationRow(index, field, value) {
    setMedicationRows((rows) => rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [field]: value } : row
    ))
  }

  async function handleSavePrescriptions(e) {
    e.preventDefault()
    if (!encounter) {
      setError('Open an active encounter before prescribing.')
      return
    }
    const items = medicationRows.filter((row) => row.medication.trim() && row.dosage.trim())
    if (!items.length) {
      setError('Enter a medication name and dosage for at least one row.')
      return
    }
    setSavingPrescriptions(true)
    setError('')
    try {
      const response = await batchPrescribe({
        patient: patient.id,
        encounter: encounter.id,
        prescriptions: items
      })
      const count = response.data.prescriptions.length
      setSuccess(`${count} prescription${count === 1 ? '' : 's'} sent to the pharmacy queue.`)
      setMedicationRows([{ medication: '', dosage: '', instructions: '' }])
      await refreshPrescriptions(encounter.id)
    } catch (err) {
      const data = err.response?.data
      setError(data?.detail || data?.prescriptions?.[0] || 'Unable to send prescriptions to pharmacy.')
    } finally {
      setSavingPrescriptions(false)
    }
  }

  if (loading) {
    return <div className="loading-state"><span className="spinner spinner-lg" /> Loading consultation and patient records...</div>
  }

  return (
    <div className="doctor-consultation-workspace">
      {/* Top Header / Back Button */}
      <div className="page-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-secondary btn-sm" onClick={onBack}>
            <ArrowLeft size={16} /> Back to OPD Queue
          </button>
          <div>
            <h1 style={{ fontSize: '22px' }}>
              {patient.first_name} {patient.last_name}
            </h1>
          </div>
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

      {/* ── Section 1: Patient Demographics & Pre-Doctor Vitals Banner ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 34%) 1fr', gap: '16px', marginBottom: '20px' }}>
        {/* Patient Identity Card */}
        <div className="panel" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                background: 'var(--primary)',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800
              }}
            >
              <User size={20} />
            </div>
            <div>
              <strong style={{ fontSize: '16px' }}>{patient.first_name} {patient.last_name}</strong>
              <div style={{ fontSize: '12px', color: 'var(--muted)', fontFamily: 'monospace' }}>
                MRN: {patient.medical_record_number}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
            <div><span style={{ color: 'var(--muted)' }}>Age:</span> <strong>{patient.age || '—'} yrs</strong></div>
            <div><span style={{ color: 'var(--muted)' }}>Sex:</span> <strong>{patient.sex || '—'}</strong></div>
            <div><span style={{ color: 'var(--muted)' }}>Phone:</span> <strong>{patient.phone || '—'}</strong></div>
            <div><span style={{ color: 'var(--muted)' }}>Date:</span> <strong>{patient.registration_date || 'Today'}</strong></div>
          </div>

          <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--line)', fontSize: '12px' }}>
            <span style={{ color: 'var(--muted)' }}>Assigned Doctor:</span>{' '}
            <strong style={{ color: 'var(--navy)' }}>{patient.assigned_clinician_name || 'Attending Doctor'}</strong>
          </div>
          {patient.allergies && (
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#b91c1c', fontWeight: 600 }}>
              ⚠ Allergy Alert: {patient.allergies}
            </div>
          )}
          {allergies.map((allergy) => (
            <div className="notice" key={allergy.id}>
              Allergy: {allergy.substance}{allergy.reaction ? ` — ${allergy.reaction}` : ''}
            </div>
          ))}
        </div>

        {/* Pre-Doctor Nurse Vitals Panel */}
        <div className="panel" style={{ padding: '18px', background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={16} color="var(--accent)" /> Vitals
            </h3>
            {vitals ? (
              <span className="badge badge-green">✓ Measured Before Consultation</span>
            ) : (
              <span className="badge badge-amber">Awaiting Nurse Measurement</span>
            )}
          </div>

          {vitals ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
              <div style={{ background: '#fff', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Heart size={13} color="#dc2626" /> Blood Pressure
                </div>
                <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '2px' }}>
                  {vitals.systolic}/{vitals.diastolic} <small style={{ fontSize: '11px', fontWeight: 500 }}>mmHg</small>
                </div>
              </div>

              <div style={{ background: '#fff', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Thermometer size={13} color="#d97706" /> Temperature
                </div>
                <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '2px' }}>
                  {vitals.temperature_c}°C
                </div>
              </div>

              <div style={{ background: '#fff', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Activity size={13} color="#2563eb" /> Heart Rate
                </div>
                <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '2px' }}>
                  {vitals.heart_rate} <small style={{ fontSize: '11px', fontWeight: 500 }}>bpm</small>
                </div>
              </div>

              <div style={{ background: '#fff', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Droplets size={13} color="#0891b2" /> SpO2 Saturation
                </div>
                <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '2px' }}>
                  {vitals.oxygen_saturation}%
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
              No nurse vitals recorded for this visit yet.
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Structured Patient History (HPI, PMH, Surgery) ── */}
      <div className="panel" style={{ marginBottom: '20px' }}>
        <div className="panel-header" style={{ background: '#f8fafc' }}>
          <h3>Clinical history</h3>
        </div>
        <div className="panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            {/* 1. History of Present Illness (HPI) */}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileText size={15} color="var(--primary)" />
                <strong>Presenting illness *</strong>
              </label>
              <textarea
                rows={5}
                placeholder="Presenting complaint and duration"
                value={historyForm.history_of_present_illness}
                onChange={(e) =>
                  setHistoryForm({ ...historyForm, history_of_present_illness: e.target.value })
                }
              />
            </div>

            {/* 2. Past Medical History (PMH) */}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Stethoscope size={15} color="#0891b2" />
                <strong>Medical history *</strong>
              </label>
              <textarea
                rows={5}
                placeholder="Relevant conditions and medications"
                value={historyForm.past_medical_history}
                onChange={(e) =>
                  setHistoryForm({ ...historyForm, past_medical_history: e.target.value })
                }
              />
            </div>

            {/* 3. History of Surgery */}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Activity size={15} color="#7c3aed" />
                <strong>Surgical history *</strong>
              </label>
              <textarea
                rows={5}
                placeholder="Previous procedures"
                value={historyForm.history_of_surgery}
                onChange={(e) =>
                  setHistoryForm({ ...historyForm, history_of_surgery: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: Multiple Lab Investigations with Dynamic Rows & Auto-Billing ── */}
      <div className="panel" style={{ marginBottom: '20px' }}>
        <div className="panel-header" style={{ background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3>Laboratory tests</h3>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addInvestigationRow}>
            <Plus size={15} /> Add Row
          </button>
        </div>

        <form onSubmit={handleOrderInvestigations} className="panel-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {investigations.map((row, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)'
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--muted)', width: '24px' }}>
                  #{idx + 1}
                </span>

                <div style={{ flex: 1 }}>
                  <select
                    required
                    value={row.test_name}
                    onChange={(e) => updateInvestigationRow(idx, 'test_name', e.target.value)}
                    style={{ width: '100%', height: '38px', borderRadius: '6px', border: '1px solid var(--line)', padding: '0 10px' }}
                  >
                    <option value="">Select a lab test</option>
                    {labTests.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name} (${(t.price_cents / 100).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  className="btn btn-danger btn-xs"
                  onClick={() => removeInvestigationRow(idx)}
                  title="Delete row"
                  style={{ display: 'grid', placeItems: 'center', width: '32px', height: '32px' }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px',
              paddingTop: '12px',
              borderTop: '1px solid var(--line)'
            }}
          >
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addInvestigationRow}>
                <Plus size={15} /> Add test
              </button>
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                {investigations.length} test{investigations.length === 1 ? '' : 's'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button type="submit" className="btn btn-primary" disabled={orderingLabs}>
                {orderingLabs ? 'Ordering...' : 'Order tests'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* ── Section 3B: Imaging Tests with Dynamic Rows & Auto-Billing ── */}
      <div className="panel" style={{ marginBottom: '20px' }}>
        <div className="panel-header" style={{ background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3>Imaging tests</h3>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addImagingRow}>
            <Plus size={15} /> Add Row
          </button>
        </div>

        <form onSubmit={handleOrderImaging} className="panel-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {imagingRows.map((row, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)'
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--muted)', width: '24px' }}>
                  #{idx + 1}
                </span>

                <div style={{ flex: 1 }}>
                  <select
                    required
                    value={row.test_name}
                    onChange={(e) => updateImagingRow(idx, 'test_name', e.target.value)}
                    style={{ width: '100%', height: '38px', borderRadius: '6px', border: '1px solid var(--line)', padding: '0 10px' }}
                  >
                    <option value="">Select an imaging test</option>
                    {imagingTests.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name} (${(t.price_cents / 100).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  className="btn btn-danger btn-xs"
                  onClick={() => removeImagingRow(idx)}
                  title="Delete row"
                  style={{ display: 'grid', placeItems: 'center', width: '32px', height: '32px' }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px',
              paddingTop: '12px',
              borderTop: '1px solid var(--line)'
            }}
          >
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addImagingRow}>
                <Plus size={15} /> Add test
              </button>
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                {imagingRows.length} test{imagingRows.length === 1 ? '' : 's'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button type="submit" className="btn btn-primary" disabled={orderingImaging}>
                {orderingImaging ? 'Ordering...' : 'Order imaging'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* ── Section 4: Verified Laboratory Results for this Patient ── */}
      <div className="panel" style={{ marginBottom: '20px' }}>
        <div className="panel-header" style={{ background: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <h3>Lab results ({labOrders.length})</h3>
          </div>
          <button className="btn btn-secondary btn-xs" onClick={() => refreshLabOrders(encounter?.id)}>
            Refresh Results
          </button>
        </div>

        <div className="panel-body">
          {labOrders.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>No tests ordered.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ordered Test</th>
                  <th>Order Status</th>
                  <th>Laboratory Findings / Result</th>
                  <th>Reference Range</th>
                  <th>Verification</th>
                </tr>
              </thead>
              <tbody>
                {labOrders.map((lo) => (
                  <tr key={lo.id}>
                    <td>
                      <strong style={{ fontSize: '14px' }}>{lo.test_name}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        Ordered: {new Date(lo.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(lo.created_at).toLocaleDateString()})
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-${lo.status}`}>{lo.status}</span>
                    </td>
                    <td>
                      {lo.result ? (
                        <strong style={{ color: '#0f172a', fontSize: '13px' }}>{lo.result}</strong>
                      ) : (
                        <span style={{ color: '#d97706', fontSize: '12px', fontStyle: 'italic' }}>
                          Pending
                        </span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        {lo.reference_range || 'Normal'}
                      </span>
                    </td>
                    <td>
                      {lo.result ? (
                        <span className="badge badge-green">✓ Result Verified</span>
                      ) : (
                        <span className="badge badge-amber">Pending Result</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Section 5: Multiple Clinician-Authorized Prescriptions ── */}
      <div className="panel" style={{ marginBottom: '20px' }}>
        <div className="panel-header" style={{ background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3>Prescriptions</h3>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addMedicationRow}>
            <Plus size={15} /> Add medication
          </button>
        </div>
        <form onSubmit={handleSavePrescriptions} className="panel-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {medicationRows.map((row, index) => (
              <div key={index} className="medication-row">
                <span className="medication-index">{index + 1}</span>
                <div className="form-group">
                  <label htmlFor={`medication-${index}`}>Medication and strength *</label>
                  <input
                    id={`medication-${index}`}
                    required
                    list="active-medications"
                    value={row.medication}
                    onChange={(e) => updateMedicationRow(index, 'medication', e.target.value)}
                    placeholder="Enter medication name and strength"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`dosage-${index}`}>Dosage instructions *</label>
                  <input
                    id={`dosage-${index}`}
                    required
                    value={row.dosage}
                    onChange={(e) => updateMedicationRow(index, 'dosage', e.target.value)}
                    placeholder="Enter clinician-directed dosage"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`instructions-${index}`}>Additional instructions</label>
                  <input
                    id={`instructions-${index}`}
                    value={row.instructions}
                    onChange={(e) => updateMedicationRow(index, 'instructions', e.target.value)}
                    placeholder="Optional instructions"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-danger btn-xs"
                  title="Remove medication"
                  aria-label={`Remove medication row ${index + 1}`}
                  onClick={() => removeMedicationRow(index)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <datalist id="active-medications">
             {medications.map((medication) => <option key={medication.id} value={medication.name} />)}
            </datalist>
          </div>
          <div className="medication-actions">
            <span>{medicationRows.length} medication row{medicationRows.length === 1 ? '' : 's'}</span>
            <button type="submit" className="btn btn-primary" disabled={savingPrescriptions || !encounter}>
              {savingPrescriptions ? 'Sending to pharmacy...' : 'Authorize and send to pharmacy'}
            </button>
          </div>
        </form>

        <div className="table-wrap">
          <div className="panel-header"><h3>Prescriptions for this encounter ({prescriptions.length})</h3></div>
          {prescriptions.length ? (
            <table className="data-table">
              <thead><tr><th>Medication</th><th>Dosage</th><th>Instructions</th><th>Status</th></tr></thead>
              <tbody>
                {prescriptions.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.medication}</strong></td>
                    <td>{item.dosage}</td>
                    <td>{item.instructions || '—'}</td>
                    <td><span className={`badge badge-${item.status}`}>{item.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div style={{ padding: '20px', color: 'var(--muted)', fontSize: '13px' }}>No prescriptions have been sent for this encounter.</div>}
        </div>
      </div>

      {/* ── Section 6: Doctor Follow-Up Day & Visit Completion ── */}
      <div className="panel">
        <div className="panel-header" style={{ background: '#f8fafc' }}>
          <h3>Follow-up</h3>
        </div>
        <div className="panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: '180px 220px 1fr', gap: '16px', alignItems: 'flex-start' }}>
            <div className="form-group">
              <label>Follow-up in (Days):</label>
              <select
                value={historyForm.follow_up_days}
                onChange={(e) => {
                  const days = parseInt(e.target.value, 10)
                  const target = new Date()
                  target.setDate(target.getDate() + days)
                  setHistoryForm({
                    ...historyForm,
                    follow_up_days: e.target.value,
                    follow_up_date: target.toISOString().split('T')[0]
                  })
                }}
              >
                <option value="3">3 Days (Acute Review)</option>
                <option value="7">7 Days (1 Week)</option>
                <option value="14">14 Days (2 Weeks)</option>
                <option value="30">30 Days (1 Month)</option>
                <option value="90">90 Days (3 Months)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Follow-up date:</label>
              <input
                type="date"
                value={historyForm.follow_up_date}
                onChange={(e) => setHistoryForm({ ...historyForm, follow_up_date: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Instructions:</label>
              <input
                type="text"
                placeholder="Follow-up instructions"
                value={historyForm.follow_up_message}
                onChange={(e) => setHistoryForm({ ...historyForm, follow_up_message: e.target.value })}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: '1px solid var(--line)'
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              disabled={savingHistory}
              onClick={() => handleSaveHistory(false)}
            >
              Save notes
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={savingHistory}
              onClick={() => handleSaveHistory(true)}
              style={{ padding: '0 24px' }}
            >
              <CheckCircle2 size={16} /> Complete consultation
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

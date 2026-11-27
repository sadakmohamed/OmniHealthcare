import React, { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  ClipboardList,
  FileText,
  FlaskConical,
  HeartPulse,
  Pill,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  X
} from 'lucide-react'
import {
  batchCreateInpatientMedicationPlans,
  batchOrderLabInvestigations,
  createInpatientDoctorNote,
  createInpatientMedicationAdministration,
  createVitals,
  dischargeInpatientAdmission,
  getInpatientDoctorNotes,
  getInpatientMedicationAdministrations,
  getInpatientMedicationPlans,
  getInpatientAdmissions,
  getLabOrders,
  getLabResults,
  getLabTests,
  getMedicalHistories,
  getVitals,
  updateInpatientAdmission,
  updateInpatientMedicationPlan
} from '../api'

const TABS = [
  { id: 'history', label: 'History', icon: ClipboardList },
  { id: 'vitals', label: 'Vitals', icon: HeartPulse },
  { id: 'drug-sheet', label: 'Drug sheet', icon: Pill },
  { id: 'labs', label: 'Labs', icon: FlaskConical },
  { id: 'plan', label: 'Plan', icon: Stethoscope },
  { id: 'doctor-notes', label: 'Doctor note', icon: FileText }
]

function listFromResponse(response) {
  return response.data?.results || response.data || []
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function formatDuration(seconds) {
  const totalHours = Math.floor(Math.max(0, seconds) / 3600)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return days ? `${days}d ${hours}h` : `${hours}h`
}

function formatCountdown(value, now) {
  const seconds = Math.max(0, Math.floor((new Date(value).getTime() - now) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function localDateTimeValue() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

export default function Inpatients({ me, listFilters }) {
  const [admissions, setAdmissions] = useState([])
  const [labTests, setLabTests] = useState([])
  const [selectedAdmission, setSelectedAdmission] = useState(null)
  const [records, setRecords] = useState({
    histories: [],
    vitals: [],
    administrations: [],
    plans: [],
    labOrders: [],
    labResults: [],
    notes: []
  })
  const [activeTab, setActiveTab] = useState('history')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [modalType, setModalType] = useState('')
  const [form, setForm] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!['admin', 'clinician'].includes(me?.role)) return
    getLabTests()
      .then((response) => setLabTests(response.data.filter((test) => test.active)))
      .catch((err) => setError(err.response?.data?.detail || 'Unable to load the laboratory catalog.'))
  }, [me?.role])

  const refreshAdmissions = useCallback(async (showLoading = false, isActive = () => true) => {
    if (showLoading) setLoading(true)
    else setRefreshing(true)
    try {
      const response = await getInpatientAdmissions()
      if (!isActive()) return null
      const nextAdmissions = listFromResponse(response)
      setAdmissions(nextAdmissions)
      setSelectedAdmission((current) =>
        current ? nextAdmissions.find((item) => item.id === current.id) || current : null
      )
      setError('')
      return nextAdmissions
    } catch (err) {
      if (isActive()) setError(err.response?.data?.detail || 'Failed to load admitted patients.')
      return null
    } finally {
      if (isActive()) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    let active = true
    const load = () => refreshAdmissions(true, () => active)
    load()
    const refresh = setInterval(() => {
      setNow(Date.now())
      refreshAdmissions(false, () => active)
    }, 60_000)
    return () => {
      active = false
      clearInterval(refresh)
    }
  }, [refreshAdmissions])

  const selectedAdmissionId = selectedAdmission?.id
  const selectedAdmissionPatient = selectedAdmission?.patient
  useEffect(() => {
    if (!selectedAdmissionId || !selectedAdmissionPatient) return undefined
    let active = true
    const refreshLabRecords = async () => {
      try {
        const [orderResponse, resultResponse] = await Promise.all([
          getLabOrders({ admission: selectedAdmissionId }),
          getLabResults({ patient: selectedAdmissionPatient })
        ])
        if (!active) return
        setRecords((current) => ({
          ...current,
          labOrders: listFromResponse(orderResponse),
          labResults: listFromResponse(resultResponse)
        }))
      } catch (err) {
        if (active) setError(err.response?.data?.detail || 'Unable to refresh inpatient lab results.')
      }
    }
    const interval = window.setInterval(refreshLabRecords, 15_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [selectedAdmissionId, selectedAdmissionPatient])

  async function loadDetails(admission) {
    setLoadingDetails(true)
    setError('')
    try {
      const params = { patient: admission.patient }
      const admissionParams = { admission: admission.id }
      const [
        historyResponse,
        vitalsResponse,
        administrationResponse,
        planResponse,
        orderResponse,
        resultResponse,
        noteResponse
      ] = await Promise.all([
        getMedicalHistories(params),
        getVitals(params),
        getInpatientMedicationAdministrations(admissionParams),
        getInpatientMedicationPlans(admissionParams),
        getLabOrders(admissionParams),
        getLabResults(params),
        getInpatientDoctorNotes(admissionParams)
      ])
      setRecords({
        histories: listFromResponse(historyResponse),
        vitals: listFromResponse(vitalsResponse),
        administrations: listFromResponse(administrationResponse),
        plans: listFromResponse(planResponse),
        labOrders: listFromResponse(orderResponse),
        labResults: listFromResponse(resultResponse),
        notes: listFromResponse(noteResponse)
      })
      setSelectedAdmission(admission)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load inpatient records.')
    } finally {
      setLoadingDetails(false)
    }
  }

  function openForm(type) {
    const defaults = {
      diagnosis: { diagnosis: selectedAdmission.diagnosis || '' },
      history: {
        history_of_present_illness: selectedAdmission.history_of_present_illness || '',
        past_medical_history: selectedAdmission.past_medical_history || '',
        history_of_surgery: selectedAdmission.history_of_surgery || ''
      },
      vitals: {
        temperature_c: '',
        systolic: '',
        diastolic: '',
        heart_rate: '',
        respiratory_rate: '',
        oxygen_saturation: '',
        weight_kg: '',
        height_cm: ''
      },
      administration: {
        plan: '',
        medication: '',
        dosage: '',
        administered_at: localDateTimeValue(),
        notes: ''
      },
      labs: { investigations: [{ test_name: '' }] },
      plan: { plans: [{ medication: '', dosage: '', frequency: '', instructions: '' }] },
      note: { content: '' }
    }
    setForm(defaults[type])
    setModalType(type)
  }

  function addFormRow(collection, row) {
    setForm((current) => ({ ...current, [collection]: [...current[collection], row] }))
  }

  function updateFormRow(collection, index, field, value) {
    setForm((current) => ({
      ...current,
      [collection]: current[collection].map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      )
    }))
  }

  function removeFormRow(collection, index) {
    setForm((current) => ({
      ...current,
      [collection]: current[collection].filter((_, rowIndex) => rowIndex !== index)
    }))
  }

  async function refreshDetails() {
    const nextAdmissions = await refreshAdmissions()
    if (selectedAdmission) {
      const current = (nextAdmissions || []).find(
        (item) => item.id === selectedAdmission.id
      )
      if (current) await loadDetails(current)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedAdmission) return
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      if (modalType === 'diagnosis' || modalType === 'history') {
        const data = modalType === 'diagnosis'
          ? { diagnosis: form.diagnosis }
          : {
              history_of_present_illness: form.history_of_present_illness,
              past_medical_history: form.past_medical_history,
              history_of_surgery: form.history_of_surgery
            }
        await updateInpatientAdmission(selectedAdmission.id, data)
      } else if (modalType === 'vitals') {
        const numericFields = [
          'temperature_c',
          'systolic',
          'diastolic',
          'heart_rate',
          'respiratory_rate',
          'oxygen_saturation',
          'weight_kg',
          'height_cm'
        ]
        const values = Object.fromEntries(
          numericFields.map((field) => [
            field,
            form[field] === '' ? null : Number(form[field])
          ])
        )
        await createVitals({
          patient: selectedAdmission.patient,
          encounter: null,
          ...values
        })
      } else if (modalType === 'administration') {
        await createInpatientMedicationAdministration({
          admission: selectedAdmission.id,
          plan: form.plan || null,
          medication: form.medication,
          dosage: form.dosage,
          administered_at: new Date(form.administered_at).toISOString(),
          notes: form.notes
        })
      } else if (modalType === 'plan') {
        const plans = form.plans.filter((plan) =>
          plan.medication.trim() || plan.dosage.trim()
        )
        if (!plans.length || plans.some((plan) => !plan.medication.trim() || !plan.dosage.trim())) {
          setError('Enter both a medication and dose for each plan row.')
          return
        }
        await batchCreateInpatientMedicationPlans({
          admission: selectedAdmission.id,
          plans
        })
      } else if (modalType === 'labs') {
        const investigations = form.investigations.filter((item) => item.test_name.trim())
        if (!investigations.length) {
          setError('Enter at least one laboratory test.')
          return
        }
        await batchOrderLabInvestigations({
          patient: selectedAdmission.patient,
          admission: selectedAdmission.id,
          investigations: investigations.map((item) => ({
            test_name: item.test_name.trim()
          }))
        })
      } else if (modalType === 'note') {
        await createInpatientDoctorNote({
          admission: selectedAdmission.id,
          content: form.content
        })
      }
      setSuccess('Record saved.')
      setModalType('')
      await refreshDetails()
    } catch (err) {
      const responseData = err.response?.data
      const details = responseData && typeof responseData === 'object'
        ? Object.entries(responseData)
          .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(' ') : typeof messages === 'object' ? JSON.stringify(messages) : messages}`)
          .join('; ')
        : responseData
      setError(responseData?.detail || details || 'Unable to save this record.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDischarge() {
    if (!selectedAdmission) return
    const patientName = `${selectedAdmission.patient_name}`
    if (!window.confirm(`Discharge ${patientName} from ${selectedAdmission.bed_label}?`)) return
    setError('')
    try {
      await dischargeInpatientAdmission(selectedAdmission.id)
      setSelectedAdmission(null)
      setSuccess(`${patientName} discharged.`)
      await refreshAdmissions()
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to discharge this patient.')
    }
  }

  async function togglePlanStatus(plan) {
    const status = plan.status === 'continue' ? 'stopped' : 'continue'
    setError('')
    try {
      await updateInpatientMedicationPlan(plan.id, { status })
      setSuccess(`${plan.medication} marked ${status}.`)
      await refreshDetails()
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to update medication plan.')
    }
  }

  const role = me?.role || ''
  const canWriteClinical = ['admin', 'clinician'].includes(role)
  const canRecordNursing = ['admin', 'nurse'].includes(role)
  const canDischarge = ['admin', 'nurse', 'clinician'].includes(role)
  const filteredAdmissions = admissions.filter((admission) => {
    const value = [
      admission.patient_name,
      admission.patient_mrn,
      admission.doctor_name,
      admission.ward_name,
      admission.bed_label,
      admission.ward_name,
      admission.diagnosis
    ].join(' ').toLowerCase()
    return value.includes(search.toLowerCase())
  })

  function handleRowKeyDown(event, admission) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      loadDetails(admission)
    }
  }

  function renderTable(headers, rows, emptyMessage) {
    return (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length ? rows : (
              <tr><td colSpan={headers.length} className="inpatient-empty">{emptyMessage}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  function renderTabContent() {
    if (loadingDetails) return <div className="inpatient-empty">Loading patient records...</div>

    if (activeTab === 'history') {
      return (
        <div className="inpatient-history">
          <div className="inpatient-history-block">
            <h3>Present illness</h3>
            <p>{selectedAdmission.history_of_present_illness || 'No history recorded.'}</p>
          </div>
          <div className="inpatient-history-block">
            <h3>Past medical history</h3>
            <p>{selectedAdmission.past_medical_history || 'No history recorded.'}</p>
          </div>
          <div className="inpatient-history-block">
            <h3>Surgical history</h3>
            <p>{selectedAdmission.history_of_surgery || 'No history recorded.'}</p>
          </div>
          {records.histories.map((item) => (
            <div className="inpatient-history-block" key={item.id}>
              <h3>{item.condition}</h3>
              <p>{item.notes || 'No additional notes.'}</p>
              <small>{formatDateTime(item.created_at)}</small>
            </div>
          ))}
        </div>
      )
    }

    if (activeTab === 'vitals') {
      return renderTable(
        ['Date & time', 'Temperature', 'Blood pressure', 'Heart rate', 'Resp. rate', 'SpO₂', 'Weight', 'Height'],
        records.vitals.map((vital) => (
          <tr key={vital.id}>
            <td>{formatDateTime(vital.created_at)}</td>
            <td>{vital.temperature_c ? `${vital.temperature_c} °C` : '—'}</td>
            <td>{vital.systolic && vital.diastolic ? `${vital.systolic}/${vital.diastolic}` : '—'}</td>
            <td>{vital.heart_rate ? `${vital.heart_rate} bpm` : '—'}</td>
            <td>{vital.respiratory_rate || '—'}</td>
            <td>{vital.oxygen_saturation ? `${vital.oxygen_saturation}%` : '—'}</td>
            <td>{vital.weight_kg ? `${vital.weight_kg} kg` : '—'}</td>
            <td>{vital.height_cm ? `${vital.height_cm} cm` : '—'}</td>
          </tr>
        )),
        'No vital signs recorded.'
      )
    }

    if (activeTab === 'drug-sheet') {
      return renderTable(
        ['Date & time', 'Medication', 'Dose', 'Recorded by', 'Notes'],
        records.administrations.map((item) => (
          <tr key={item.id}>
            <td>{formatDateTime(item.administered_at)}</td>
            <td>{item.medication}</td>
            <td>{item.dosage}</td>
            <td>{item.administered_by_name}</td>
            <td>{item.notes || '—'}</td>
          </tr>
        )),
        'No medication administrations recorded.'
      )
    }

    if (activeTab === 'labs') {
      const resultRows = records.labOrders.flatMap((order) => {
        const matches = records.labResults.filter((item) => item.order === order.id)
        if (!matches.length) {
          return [(
            <tr key={`order-${order.id}`}>
              <td>{formatDateTime(order.created_at)}</td>
              <td>{order.test_name}</td>
              <td><span className={`badge badge-${order.status}`}>{order.status.replaceAll('_', ' ')}</span></td>
              <td>—</td>
              <td>—</td>
            </tr>
          )]
        }
        return matches.map((result) => (
          <tr key={result.id}>
            <td>{formatDateTime(result.created_at)}</td>
            <td>{order.test_name}</td>
            <td><span className={`badge badge-${result.status}`}>{result.is_current ? result.status : 'Superseded'}</span></td>
            <td>{result.result}</td>
            <td>{result.reference_range || '—'}</td>
          </tr>
        ))
      })
      return renderTable(
        ['Date & time', 'Investigation', 'Status', 'Result', 'Reference range'],
        resultRows,
        'No laboratory orders or results.'
      )
    }

    if (activeTab === 'plan') {
      return renderTable(
        ['Date', 'Medication', 'Dose', 'Frequency', 'Status', 'Prescribed by', ''],
        records.plans.map((plan) => (
          <tr key={plan.id}>
            <td>{formatDateTime(plan.created_at)}</td>
            <td>{plan.medication}</td>
            <td>{plan.dosage}</td>
            <td>{plan.frequency || '—'}</td>
            <td><span className={`badge badge-${plan.status}`}>{plan.status}</span></td>
            <td>{plan.prescribed_by_name}</td>
            <td>
              {canWriteClinical && (
                <button
                  type="button"
                  className={`btn btn-xs ${plan.status === 'continue' ? 'btn-danger' : 'btn-secondary'}`}
                  onClick={() => togglePlanStatus(plan)}
                >
                  {plan.status === 'continue' ? 'Stop' : 'Continue'}
                </button>
              )}
            </td>
          </tr>
        )),
        'No medication plan recorded.'
      )
    }

    return renderTable(
      ['Date & time', 'Doctor', 'Note'],
      records.notes.map((note) => (
        <tr key={note.id}>
          <td>{formatDateTime(note.created_at)}</td>
          <td>{note.author_name}</td>
          <td className="inpatient-note-content">{note.content}</td>
        </tr>
      )),
      'No doctor notes recorded.'
    )
  }

  function renderModalFields() {
    if (modalType === 'diagnosis') {
      return (
        <div className="form-group">
          <label htmlFor="inpatient-diagnosis">Diagnosis *</label>
          <textarea
            id="inpatient-diagnosis"
            required
            value={form.diagnosis}
            onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
          />
        </div>
      )
    }
    if (modalType === 'history') {
      return (
        <>
          <div className="form-group">
            <label htmlFor="history-present">History of present illness</label>
            <textarea id="history-present" value={form.history_of_present_illness} onChange={(e) => setForm({ ...form, history_of_present_illness: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="history-medical">Past medical history</label>
            <textarea id="history-medical" value={form.past_medical_history} onChange={(e) => setForm({ ...form, past_medical_history: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="history-surgery">History of surgery</label>
            <textarea id="history-surgery" value={form.history_of_surgery} onChange={(e) => setForm({ ...form, history_of_surgery: e.target.value })} />
          </div>
        </>
      )
    }
    if (modalType === 'vitals') {
      const fields = [
        ['temperature_c', 'Temperature (°C)', '0.1'],
        ['systolic', 'Systolic pressure', '1'],
        ['diastolic', 'Diastolic pressure', '1'],
        ['heart_rate', 'Heart rate (bpm)', '1'],
        ['respiratory_rate', 'Respiratory rate', '1'],
        ['oxygen_saturation', 'Oxygen saturation (%)', '1'],
        ['weight_kg', 'Weight (kg)', '0.01'],
        ['height_cm', 'Height (cm)', '1']
      ]
      return (
        <div className="form-row">
          {fields.map(([name, label, step]) => (
            <div className="form-group" key={name}>
              <label htmlFor={`vital-${name}`}>{label}</label>
              <input id={`vital-${name}`} type="number" min="0" step={step} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} />
            </div>
          ))}
        </div>
      )
    }
    if (modalType === 'administration') {
      return (
        <>
          <div className="form-group">
            <label htmlFor="administration-plan">Medication plan (optional)</label>
            <select
              id="administration-plan"
              value={form.plan}
              onChange={(e) => {
                const plan = records.plans.find((item) => item.id === e.target.value)
                setForm({
                  ...form,
                  plan: e.target.value,
                  medication: plan?.medication || '',
                  dosage: plan?.dosage || ''
                })
              }}
            >
              <option value="">Select a plan or enter medication below</option>
              {records.plans.filter((plan) => plan.status === 'continue').map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.medication} — {plan.dosage}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="admin-medication">Medication *</label>
              <input id="admin-medication" required value={form.medication} onChange={(e) => setForm({ ...form, medication: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="admin-dosage">Dose *</label>
              <input id="admin-dosage" required value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="admin-time">Date & time *</label>
            <input id="admin-time" type="datetime-local" required value={form.administered_at} onChange={(e) => setForm({ ...form, administered_at: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="admin-notes">Notes</label>
            <textarea id="admin-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </>
      )
    }
    if (modalType === 'plan') {
      return (
        <>
          <div className="inpatient-row-heading">
            <strong>Medication plan</strong>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addFormRow('plans', { medication: '', dosage: '', frequency: '', instructions: '' })}>
              <Plus size={14} /> Add row
            </button>
          </div>
          {form.plans.map((plan, index) => (
            <div className="inpatient-entry-row" key={`plan-${index}`}>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor={`plan-medication-${index}`}>Medication *</label>
                  <input id={`plan-medication-${index}`} value={plan.medication} onChange={(e) => updateFormRow('plans', index, 'medication', e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor={`plan-dosage-${index}`}>Dose *</label>
                  <input id={`plan-dosage-${index}`} value={plan.dosage} onChange={(e) => updateFormRow('plans', index, 'dosage', e.target.value)} />
                </div>
                {form.plans.length > 1 && (
                  <button type="button" className="btn btn-secondary btn-sm inpatient-remove-row" onClick={() => removeFormRow('plans', index)} aria-label={`Remove medication row ${index + 1}`}>
                    <X size={15} />
                  </button>
                )}
              </div>
              <div className="form-group">
                <label htmlFor={`plan-frequency-${index}`}>Frequency</label>
                <input id={`plan-frequency-${index}`} placeholder="e.g. Every 8 hours" value={plan.frequency} onChange={(e) => updateFormRow('plans', index, 'frequency', e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor={`plan-instructions-${index}`}>Instructions</label>
                <textarea id={`plan-instructions-${index}`} value={plan.instructions} onChange={(e) => updateFormRow('plans', index, 'instructions', e.target.value)} />
              </div>
            </div>
          ))}
        </>
      )
    }
    if (modalType === 'labs') {
      return (
        <>
          <div className="inpatient-row-heading">
            <strong>Laboratory investigations</strong>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addFormRow('investigations', { test_name: '' })}>
              <Plus size={14} /> Add row
            </button>
          </div>
          {form.investigations.map((item, index) => (
            <div className="inpatient-entry-row" key={`lab-${index}`}>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor={`inpatient-lab-name-${index}`}>Test *</label>
                  <select id={`inpatient-lab-name-${index}`} required value={item.test_name} onChange={(e) => updateFormRow('investigations', index, 'test_name', e.target.value)}>
                    <option value="">-- Choose an active test --</option>
                    {labTests.map((test) => <option key={test.id} value={test.name}>{test.name}</option>)}
                  </select>
                </div>
                {form.investigations.length > 1 && (
                  <button type="button" className="btn btn-secondary btn-sm inpatient-remove-row" onClick={() => removeFormRow('investigations', index)} aria-label={`Remove test row ${index + 1}`}>
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )
    }
    return (
      <div className="form-group">
        <label htmlFor="doctor-note">Doctor note *</label>
        <textarea id="doctor-note" required value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      </div>
    )
  }

  function modalTitle() {
    return {
      diagnosis: 'Add diagnosis',
      history: 'Update history',
      vitals: 'Record vitals',
      administration: 'Record medication given',
      labs: 'Order inpatient laboratory tests',
      plan: 'Add medication plan',
      note: 'Add doctor note'
    }[modalType]
  }

  if (selectedAdmission) {
    const nextCharge = selectedAdmission.next_charge_at
      ? formatCountdown(selectedAdmission.next_charge_at, now)
      : null
    const actionButton = {
      history: canWriteClinical && (
        <button className="btn btn-primary" onClick={() => openForm('history')}>
          <Plus size={15} /> Update history
        </button>
      ),
      vitals: canRecordNursing && (
        <button className="btn btn-primary" onClick={() => openForm('vitals')}><Plus size={15} /> Record vitals</button>
      ),
      'drug-sheet': canRecordNursing && (
        <button className="btn btn-primary" onClick={() => openForm('administration')}><Plus size={15} /> Record drug</button>
      ),
      labs: ['admin', 'clinician'].includes(role) && (
        <button className="btn btn-primary" onClick={() => openForm('labs')}><FlaskConical size={15} /> Order lab tests</button>
      ),
      plan: canWriteClinical && (
        <button className="btn btn-primary" onClick={() => openForm('plan')}><Plus size={15} /> Add plan</button>
      ),
      'doctor-notes': canWriteClinical && (
        <button className="btn btn-primary" onClick={() => openForm('note')}><Plus size={15} /> Add note</button>
      )
    }[activeTab]

    return (
      <div className="inpatient-screen">
        <div className="page-heading inpatient-detail-heading">
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedAdmission(null)}>
              <ArrowLeft size={15} /> Inpatients
            </button>
            <h1>{selectedAdmission.patient_name}</h1>
            <p>{selectedAdmission.patient_mrn} · {selectedAdmission.bed_label} · {selectedAdmission.ward_name}</p>
          </div>
          <div className="page-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadDetails(selectedAdmission)} disabled={loadingDetails}>
              <RefreshCw size={14} /> Refresh
            </button>
            {canWriteClinical && (
              <button className="btn btn-secondary" onClick={() => openForm('diagnosis')}>
                <Plus size={15} /> Add diagnosis
              </button>
            )}
            {canDischarge && (
              <button className="btn btn-danger" onClick={handleDischarge}>Discharge</button>
            )}
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className="inpatient-summary">
          <div><small>Admitted</small><strong>{formatDateTime(selectedAdmission.admitted_at)}</strong></div>
          <div><small>Doctor</small><strong>{selectedAdmission.doctor_name || 'Not assigned'}</strong></div>
          <div><small>Department / ward</small><strong>{selectedAdmission.ward_name || selectedAdmission.department || '—'}</strong></div>
          <div><small>Diagnosis</small><strong>{selectedAdmission.diagnosis || 'Not recorded'}</strong></div>
          <div><small>Stay</small><strong>{formatDuration(Math.floor((now - new Date(selectedAdmission.admitted_at).getTime()) / 1000))}</strong></div>
          <div><small>Next room charge</small><strong>{nextCharge || 'Rate not set'}</strong></div>
          <div><small>Room charges billed</small><strong>${((selectedAdmission.room_charge_total_cents || 0) / 100).toFixed(2)}</strong></div>
        </div>

        <div className="inpatient-tabs-bar">
          <div className="tabs inpatient-tabs" role="tablist" aria-label="Inpatient records">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                className={`tab-btn ${activeTab === id ? 'active' : ''}`}
                onClick={() => setActiveTab(id)}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
          {actionButton && <div className="inpatient-tab-action">{actionButton}</div>}
        </div>

        <div className="panel inpatient-record-panel">
          {activeTab === 'history' && (
            <div className="panel-header">
              <h3>Patient history</h3>
            </div>
          )}
          {renderTabContent()}
        </div>

        {modalType && (
          <div className="modal-overlay" onClick={() => setModalType('')}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
              <div className="panel-header">
                <h3>{modalTitle()}</h3>
                <button type="button" className="modal-close" onClick={() => setModalType('')} aria-label="Close form">×</button>
              </div>
              <form className="panel-body" onSubmit={handleSubmit}>
                {renderModalFields()}
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setModalType('')}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="inpatient-screen">
      <div className="page-heading">
        <div>
          <h1>Inpatients</h1>
          <p>{admissions.length} currently admitted</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => refreshAdmissions()} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {listFilters}
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="toolbar">
        <div className="toolbar-search">
          <Search size={16} />
          <input
            aria-label="Search admitted patients"
            placeholder="Search patient, doctor, bed"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="panel">
        <div className="table-wrap">
          {loading ? (
            <div className="inpatient-empty">Loading admitted patients...</div>
          ) : !filteredAdmissions.length ? (
            <div className="inpatient-empty">No admitted patients found.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Patient ID</th>
                  <th>Patient name</th>
                  <th>Admitted date</th>
                  <th>Doctor</th>
                  <th>Department</th>
                  <th>Bed</th>
                  <th>Diagnosis</th>
                  <th>Stay / next charge</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdmissions.map((admission, index) => (
                  <tr
                    key={admission.id}
                    className="clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => loadDetails(admission)}
                    onKeyDown={(e) => handleRowKeyDown(e, admission)}
                  >
                    <td>{index + 1}</td>
                    <td><strong>{admission.patient_mrn}</strong></td>
                    <td>{admission.patient_name}</td>
                    <td>{formatDateTime(admission.admitted_at)}</td>
                    <td>{admission.doctor_name || '—'}</td>
                    <td>{admission.ward_name || admission.department || '—'}</td>
                    <td>{admission.ward_name} / {admission.bed_label}</td>
                    <td>{admission.diagnosis || '—'}</td>
                    <td>
                      <strong>{formatDuration(Math.floor((now - new Date(admission.admitted_at).getTime()) / 1000))}</strong>
                      <small className="inpatient-countdown">
                        {admission.next_charge_at
                          ? `Next charge in ${formatCountdown(admission.next_charge_at, now)}`
                          : 'Room rate not set'}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  )
}

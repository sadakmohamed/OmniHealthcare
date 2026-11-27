import React, { useState, useEffect } from 'react'
import {
  Stethoscope,
  Plus,
  Search,
  DollarSign,
  Phone,
  MapPin,
  CheckCircle,
  AlertTriangle,
  X,
  User,
  Building,
  ShieldCheck,
  Pencil
} from 'lucide-react'
import {
  getClinicians,
  createClinician,
  updateClinician,
  getClinicianAvailability,
  createClinicianAvailability,
  deleteClinicianAvailability
} from '../api'

export default function Consultants({ me, listFilters }) {
  const [consultants, setConsultants] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modal to register consultant
  const [showModal, setShowModal] = useState(false)
  const [availabilityConsultant, setAvailabilityConsultant] = useState(null)
  const [availabilityRows, setAvailabilityRows] = useState([])
  const [availabilityForm, setAvailabilityForm] = useState({
    weekday: '0',
    starts_at: '08:00',
    ends_at: '17:00'
  })
  const [editingConsultant, setEditingConsultant] = useState(null)
  const [form, setForm] = useState({
    name: 'Dr. Sarah Al-Mansoor',
    department: 'Cardiology',
    specialty: 'Cardiologist',
    address: '42 Medical Plaza, Wing B',
    phone: '+254-711-300400',
    sex: 'Female',
    opd_consultation_price: 65, // in dollars (convert to cents)
    username: '',
    password: ''
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadConsultants()
  }, [])

  async function loadConsultants() {
    setLoading(true)
    setError('')
    try {
      const res = await getClinicians()
      setConsultants(res.data?.results || res.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load consultants list.')
    } finally {
      setLoading(false)
    }
  }

  async function openAvailability(consultant) {
    setAvailabilityConsultant(consultant)
    setError('')
    try {
      const response = await getClinicianAvailability({ clinician: consultant.id })
      setAvailabilityRows(response.data?.results || response.data || [])
    } catch (err) {
      setAvailabilityConsultant(null)
      setError(err.response?.data?.detail || 'Could not load clinician availability.')
    }
  }

  async function handleAddAvailability(event) {
    event.preventDefault()
    if (!availabilityConsultant) return
    setSubmitting(true)
    setError('')
    try {
      await createClinicianAvailability({
        clinician: availabilityConsultant.id,
        weekday: Number(availabilityForm.weekday),
        starts_at: availabilityForm.starts_at,
        ends_at: availabilityForm.ends_at,
        active: true
      })
      const response = await getClinicianAvailability({ clinician: availabilityConsultant.id })
      setAvailabilityRows(response.data?.results || response.data || [])
      setSuccess('Clinician availability added.')
    } catch (err) {
      const data = err.response?.data
      setError(data?.detail || data?.non_field_errors?.[0] || data?.starts_at?.[0] || data?.ends_at?.[0] || 'Could not save availability.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteAvailability(id) {
    if (!availabilityConsultant) return
    setError('')
    try {
      await deleteClinicianAvailability(id)
      setAvailabilityRows((rows) => rows.filter((row) => row.id !== id))
      setSuccess('Availability window removed.')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove availability.')
    }
  }

  function openEditModal(consultant) {
    setEditingConsultant(consultant)
    setForm({
      name: consultant.name || '',
      department: consultant.department || '',
      specialty: consultant.specialty || '',
      address: consultant.address || '',
      phone: consultant.phone || '',
      sex: consultant.sex || '',
      opd_consultation_price: ((consultant.opd_consultation_price || 0) / 100).toFixed(2),
      username: '',
      password: ''
    })
    setShowModal(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const priceCents = Math.round(parseFloat(form.opd_consultation_price || 0) * 100)
      const data = {
        name: form.name,
        department: form.department,
        specialty: form.specialty,
        address: form.address,
        phone: form.phone,
        sex: form.sex,
        opd_consultation_price: priceCents
      }
      if (editingConsultant) {
        await updateClinician(editingConsultant.id, data)
      } else {
        await createClinician({
          ...data,
          username: form.username,
          password: form.password
        })
      }

      setSuccess(editingConsultant
        ? `Consultant ${form.name} updated.`
        : `Consultant ${form.name} (${form.specialty}) registered with OPD fee of $${form.opd_consultation_price}.`)
      setShowModal(false)
      setEditingConsultant(null)
      setForm({
        name: '',
        department: 'Cardiology',
        specialty: 'Cardiologist',
        address: '',
        phone: '',
        sex: 'Female',
        opd_consultation_price: 50,
        username: '',
        password: ''
      })
      loadConsultants()
    } catch (err) {
      const data = err.response?.data
      if (typeof data === 'object') {
        setError(Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | '))
      } else {
        setError(data || 'Failed to register consultant.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const role = me?.role || 'admin'
  const canRegister = role === 'admin'

  const filtered = consultants.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.name?.toLowerCase().includes(q) ||
      c.department?.toLowerCase().includes(q) ||
      c.specialty?.toLowerCase().includes(q) ||
      c.phone?.includes(q)
    )
  })

  return (
    <div className="consultants-screen">
      <div className="page-heading">
        <div>
          <h1>Consultants</h1>
        </div>
        <div className="page-actions">
          {canRegister && (
            <button className="btn btn-primary" onClick={() => {
              setEditingConsultant(null)
              setShowModal(true)
            }}>
              <Plus size={16} /> Register New Consultant
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

      {/* Notice Banner */}
      <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ShieldCheck size={18} color="#92400e" />
        <div>
          <strong>CONSULTATION PRICING LOGIC:</strong> When the receptionist registers an outpatient and assigns them to a consultant, the patient's OPD bill automatically pulls the doctor's set consultation fee.
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-search">
          <Search size={16} color="var(--muted)" />
          <input
            type="text"
            placeholder="Search by doctor name, department, or specialty..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-secondary" onClick={loadConsultants}>
          Refresh
        </button>
      </div>

      {/* Consultants Grid */}
      <div className="panel">
        <div className="panel-header">
          <h3>Registered Medical Consultants ({filtered.length})</h3>
        </div>
        <div className="panel-body">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading consultants list...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No medical consultants found.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
              {filtered.map((c) => {
                const price = ((c.opd_consultation_price || 5000) / 100).toFixed(2)
                const docName = c.name || (c.user_detail ? `Dr. ${c.user_detail.first_name} ${c.user_detail.last_name}` : 'Dr. Consultant')
                return (
                  <div
                    key={c.id}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: '10px',
                      padding: '18px',
                      background: '#fff',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <div
                          style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '50%',
                            background: '#dbeafe',
                            color: '#1d4ed8',
                            display: 'grid',
                            placeItems: 'center',
                            fontWeight: 800,
                            fontSize: '16px'
                          }}
                        >
                          <Stethoscope size={20} />
                        </div>
                        <div>
                          <strong style={{ fontSize: '15px', color: 'var(--navy)' }}>{docName}</strong>
                          <div style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 600 }}>
                            {c.department || c.specialty}
                          </div>
                        </div>
                      </div>
                      <span className="badge badge-green" style={{ fontSize: '13px', padding: '4px 8px' }}>
                        ${price} OPD
                      </span>
                      {canRegister && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="btn btn-secondary btn-xs" onClick={() => openEditModal(c)} aria-label={`Edit ${docName}`}>
                            <Pencil size={13} /> Edit
                          </button>
                          <button type="button" className="btn btn-secondary btn-xs" onClick={() => openAvailability(c)}>
                            Availability
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px', borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Building size={13} /> {c.specialty || c.department}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <MapPin size={13} /> {c.address || 'Central Consultation Wing'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Phone size={13} /> {c.phone || '+254-700-000000'} &bull; Sex: {c.sex || 'Unspecified'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Register Consultant Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>{editingConsultant ? 'Update consultant' : 'Register Medical Consultant (Doctor)'}</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave} className="panel-body">
              <div className="form-group">
                <label>Doctor Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Sarah Al-Mansoor"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Department *</label>
                  <select
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                  >
                    <option value="Cardiology">Cardiology</option>
                    <option value="General Medicine">General Medicine</option>
                    <option value="Pediatrics">Pediatrics</option>
                    <option value="Orthopedics">Orthopedics</option>
                    <option value="Neurology">Neurology</option>
                    <option value="Obstetrics & Gynaecology">Obstetrics & Gynaecology</option>
                    <option value="Internal Medicine">Internal Medicine</option>
                    <option value="Ophthalmology">Ophthalmology</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Specialty Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Cardiologist"
                    value={form.specialty}
                    onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Biological Sex</label>
                  <select
                    value={form.sex}
                    onChange={(e) => setForm({ ...form, sex: e.target.value })}
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>OPD Consultation Fee ($ USD) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="60.00"
                    value={form.opd_consultation_price}
                    onChange={(e) => setForm({ ...form, opd_consultation_price: e.target.value })}
                  />
                  <span className="form-hint">Auto-billed when receptionist routes patient to this doctor.</span>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Phone Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="+254-711-300400"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Consultation Office / Address</label>
                  <input
                    type="text"
                    placeholder="Suite 402, Doctor Plaza, 4th Floor"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
              </div>

              {!editingConsultant && <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', marginTop: '10px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--navy)', display: 'block', marginBottom: '8px' }}>
                  Doctor System Login Account
                </span>
                <div className="form-row">
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Username</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. dr_sarah"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Initial Password</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  </div>
                </div>
              </div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : editingConsultant ? 'Save changes' : 'Register Consultant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {availabilityConsultant && (
        <div className="modal-overlay" onClick={() => setAvailabilityConsultant(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h3>Availability · {availabilityConsultant.name}</h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAvailabilityConsultant(null)} aria-label="Close availability">
                <X size={16} />
              </button>
            </div>
            <div className="panel-body">
              <form onSubmit={handleAddAvailability}>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="availability-weekday">Day</label>
                    <select id="availability-weekday" value={availabilityForm.weekday} onChange={(event) => setAvailabilityForm({ ...availabilityForm, weekday: event.target.value })}>
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => (
                        <option key={day} value={index}>{day}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="availability-start">From</label>
                    <input id="availability-start" type="time" required value={availabilityForm.starts_at} onChange={(event) => setAvailabilityForm({ ...availabilityForm, starts_at: event.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="availability-end">Until</label>
                    <input id="availability-end" type="time" required value={availabilityForm.ends_at} onChange={(event) => setAvailabilityForm({ ...availabilityForm, ends_at: event.target.value })} />
                  </div>
                </div>
                <button className="btn btn-primary" disabled={submitting}>Add availability</button>
              </form>
              <div style={{ marginTop: 16 }}>
                {availabilityRows.length ? availabilityRows.map((row) => (
                  <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderBottom: '1px solid var(--line)' }}>
                    <span>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][row.weekday]} · {row.starts_at.slice(0, 5)}–{row.ends_at.slice(0, 5)}</span>
                    <button type="button" className="btn btn-danger btn-xs" onClick={() => handleDeleteAvailability(row.id)}>Remove</button>
                  </div>
                )) : <p className="form-hint">No availability windows configured. Patients cannot book until a window is added.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

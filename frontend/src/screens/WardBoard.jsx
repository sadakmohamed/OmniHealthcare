import React, { useState, useEffect } from 'react'
import {
  BedDouble,
  UserPlus,
  UserMinus,
  CheckCircle,
  AlertTriangle,
  X,
  Building,
  Activity,
  Layers,
  DollarSign,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import {
  getWards,
  getBeds,
  createWard,
  deleteWard,
  createBed,
  deleteBed,
  assignBed,
  dischargeBed,
  getPatients,
  getClinicians,
  updateBed,
  setBedActive
} from '../api'

export default function WardBoard({ me }) {
  const [wards, setWards] = useState([])
  const [beds, setBeds] = useState([])
  const [patients, setPatients] = useState([])
  const [clinicians, setClinicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Assign modal
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedBed, setSelectedBed] = useState(null)
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [selectedClinicianId, setSelectedClinicianId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [rateBed, setRateBed] = useState(null)
  const [rateAmount, setRateAmount] = useState('')
  const [showWardModal, setShowWardModal] = useState(false)
  const [showBedModal, setShowBedModal] = useState(false)
  const [wardForm, setWardForm] = useState({ name: '', location: '' })
  const [bedForm, setBedForm] = useState({ ward: '', label: '', daily_rate: '0.00' })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [wRes, bRes, pRes, cRes] = await Promise.all([
        getWards(),
        getBeds(),
        getPatients().catch(() => ({ data: [] })),
        getClinicians().catch(() => ({ data: [] }))
      ])

      setWards(wRes.data?.results || wRes.data || [])
      setBeds(bRes.data?.results || bRes.data || [])
      setPatients(pRes.data?.results || pRes.data || [])
      setClinicians(cRes.data?.results || cRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load ward board.')
    } finally {
      setLoading(false)
    }
  }

  function openAssignModal(bed) {
    setSelectedBed(bed)
    setSelectedPatientId('')
    setSelectedClinicianId('')
    setShowAssignModal(true)
  }

  function openRateModal(bed) {
    setRateBed(bed)
    setRateAmount(((bed.daily_rate_cents || 0) / 100).toFixed(2))
  }

  async function handleAssignSubmit(e) {
    e.preventDefault()
    if (!selectedBed || !selectedPatientId || !selectedClinicianId) return
    setSubmitting(true)
    setError('')
    try {
      await assignBed(selectedBed.id, selectedPatientId, selectedClinicianId)
      setSuccess(`Bed ${selectedBed.label} allocated to patient.`)
      setShowAssignModal(false)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to allocate bed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRateSubmit(e) {
    e.preventDefault()
    if (!rateBed) return
    const dailyRateCents = Math.round(Number(rateAmount) * 100)
    if (!Number.isFinite(dailyRateCents) || dailyRateCents < 0) {
      setError('Enter a valid daily room rate.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await updateBed(rateBed.id, { daily_rate_cents: dailyRateCents })
      setSuccess(`Bed ${rateBed.label} room rate updated.`)
      setRateBed(null)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update room rate.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDischarge(bed) {
    if (!window.confirm(`Discharge patient from Bed ${bed.label} and mark as available?`)) return
    setError('')
    try {
      await dischargeBed(bed.id)
      setSuccess(`Patient discharged from Bed ${bed.label}. Bed is now available.`)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to discharge bed.')
    }
  }

  async function handleCreateWard(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await createWard(wardForm)
      setSuccess(`Ward ${wardForm.name} created.`)
      setWardForm({ name: '', location: '' })
      setShowWardModal(false)
      await loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create ward.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateBed(e) {
    e.preventDefault()
    const dailyRate = Math.round(Number(bedForm.daily_rate) * 100)
    if (!Number.isFinite(dailyRate) || dailyRate < 0) {
      setError('Enter a valid daily room rate.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await createBed({
        ward: bedForm.ward,
        label: bedForm.label,
        daily_rate_cents: dailyRate
      })
      setSuccess(`Bed ${bedForm.label} created.`)
      setBedForm({ ward: '', label: '', daily_rate: '0.00' })
      setShowBedModal(false)
      await loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create bed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteBed(bed) {
    if (!window.confirm(`Delete bed ${bed.label}?`)) return
    setError('')
    try {
      await deleteBed(bed.id)
      setSuccess(`Bed ${bed.label} deleted.`)
      await loadData()
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.bed?.[0] || 'Unable to delete this bed.')
    }
  }

  async function handleSetActive(bed) {
    const active = bed.status === 'inactive'
    setError('')
    try {
      await setBedActive(bed.id, active)
      setSuccess(`Bed ${bed.label} ${active ? 'activated' : 'inactivated'}.`)
      await loadData()
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.bed?.[0] || 'Unable to change bed availability.')
    }
  }

  async function handleDeleteWard(ward) {
    if (!window.confirm(`Delete ward ${ward.name}?`)) return
    setError('')
    try {
      await deleteWard(ward.id)
      setSuccess(`Ward ${ward.name} deleted.`)
      await loadData()
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.ward?.[0] || 'Unable to delete this ward.')
    }
  }

  const totalBeds = beds.length
  const occupiedBeds = beds.filter((b) => b.status === 'occupied').length
  const availableBeds = beds.filter((b) => b.status === 'available').length
  const activeBeds = beds.filter((b) => b.status !== 'inactive').length
  const occupancyRate = activeBeds > 0 ? Math.round((occupiedBeds / activeBeds) * 100) : 0

  const role = me?.role || 'admin'
  const canManage = ['nurse', 'clinician', 'admin'].includes(role)
  const canSetRoomRate = role === 'admin'

  return (
    <div className="ward-screen">
      <div className="page-heading">
        <div>
          <h1>Ward & Beds</h1>
        </div>
        {role === 'admin' && (
          <div className="page-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setShowWardModal(true)}>
              <Plus size={15} /> Create ward
            </button>
            <button type="button" className="btn btn-primary" onClick={() => {
              setBedForm({ ward: wards[0]?.id || '', label: '', daily_rate: '0.00' })
              setShowBedModal(true)
            }} disabled={!wards.length}>
              <Plus size={15} /> Add bed
            </button>
          </div>
        )}
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

      {/* Metric Cards */}
      <div className="stat-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-card">
          <div className="stat-icon blue"><Layers size={24} /></div>
          <div>
            <div className="stat-label">Total Licensed Beds</div>
            <div className="stat-value">{totalBeds}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red"><BedDouble size={24} /></div>
          <div>
            <div className="stat-label">Occupied Inpatient Beds</div>
            <div className="stat-value">{occupiedBeds}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><CheckCircle size={24} /></div>
          <div>
            <div className="stat-label">Available Clean Beds</div>
            <div className="stat-value">{availableBeds}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber"><Activity size={24} /></div>
          <div>
            <div className="stat-label">Facility Occupancy Rate</div>
            <div className="stat-value">{occupancyRate}%</div>
          </div>
        </div>
      </div>

      {/* Wards & Beds Board */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
          Loading facility wards and beds...
        </div>
      ) : wards.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
          No wards configured.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {wards.map((w) => {
            const wardBeds = beds.filter((b) => b.ward === w.id)
            return (
              <div key={w.id} className="panel">
                <div className="panel-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Building size={18} color="var(--primary)" />
                    <h3 style={{ fontSize: '16px' }}>{w.name}</h3>
                    <small style={{ color: 'var(--muted)' }}>({w.location || 'Main Hospital Block'})</small>
                  </div>
                  <span className="badge badge-gray">{wardBeds.length} Beds</span>
                  {role === 'admin' && wardBeds.length === 0 && (
                    <button type="button" className="btn btn-danger btn-xs" onClick={() => handleDeleteWard(w)}>
                      <Trash2 size={12} /> Delete ward
                    </button>
                  )}
                </div>
                <div className="panel-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
                    {wardBeds.map((bed) => {
                      const isOccupied = bed.status === 'occupied'
                      const isInactive = bed.status === 'inactive'
                      const pt = isOccupied ? patients.find((p) => p.id === bed.patient) : null
                      const ptName = pt ? `${pt.first_name} ${pt.last_name}` : (isOccupied ? `Patient ${bed.patient?.slice ? bed.patient.slice(0, 8) : bed.patient}` : null)
                      return (
                        <div
                          key={bed.id}
                          style={{
                            border: `1.5px solid ${isOccupied ? '#fca5a5' : isInactive ? '#cbd5e1' : '#86efac'}`,
                            background: isOccupied ? '#fff5f5' : isInactive ? '#f8fafc' : '#f0fdf4',
                            borderRadius: '10px',
                            padding: '14px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong style={{ fontSize: '15px', color: 'var(--navy)' }}>
                              Bed {bed.label}
                            </strong>
                            <span className={`badge ${isOccupied ? 'badge-red' : isInactive ? 'badge-gray' : 'badge-green'}`}>
                              {bed.status}
                            </span>
                          </div>

                          <div style={{ minHeight: '36px', fontSize: '12px' }}>
                            {isOccupied ? (
                              <div>
                                <div style={{ fontWeight: 700, color: '#991b1b' }}>{ptName}</div>
                                <span style={{ color: 'var(--muted)' }}>
                                  MRN: {pt?.medical_record_number || 'Inpatient'}
                                </span>
                              </div>
                            ) : isInactive ? (
                              <div style={{ color: 'var(--muted)', paddingTop: '8px' }}>Unavailable for admission</div>
                            ) : (
                              <div style={{ color: '#166534', fontStyle: 'italic', paddingTop: '8px' }}>
                                Cleaned & Ready for Admission
                              </div>
                            )}
                          </div>

                          <div className="bed-rate">
                            <span>
                              <DollarSign size={13} />
                              {bed.daily_rate_cents > 0
                                ? `$${(bed.daily_rate_cents / 100).toFixed(2)} / 24h`
                                : 'Rate not set'}
                            </span>
                            {canSetRoomRate && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-xs"
                                onClick={() => openRateModal(bed)}
                              >
                                <Pencil size={12} /> Set rate
                              </button>
                            )}
                          </div>

                          {canManage && (
                            <div style={{ marginTop: 'auto', paddingTop: '6px' }}>
                              {!isOccupied && !isInactive ? (
                                <button
                                  className="btn btn-primary btn-xs"
                                  style={{ width: '100%', justifyContent: 'center' }}
                                  onClick={() => openAssignModal(bed)}
                                >
                                  <UserPlus size={13} /> Admit Patient
                                </button>
                              ) : isOccupied ? (
                                <button
                                  className="btn btn-danger btn-xs"
                                  style={{ width: '100%', justifyContent: 'center' }}
                                  onClick={() => handleDischarge(bed)}
                                >
                                  <UserMinus size={13} /> Discharge Bed
                                </button>
                              ) : null}
                              {role === 'admin' && !isOccupied && (
                                <>
                                  <button type="button" className="btn btn-secondary btn-xs" onClick={() => handleSetActive(bed)}>
                                    {isInactive ? 'Activate bed' : 'Inactivate bed'}
                                  </button>
                                  <button type="button" className="btn btn-secondary btn-xs" onClick={() => handleDeleteBed(bed)}>
                                    <Trash2 size={12} /> Delete bed
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Assign Patient Modal */}
      {showAssignModal && selectedBed && (
        <div className="modal-overlay" onClick={() => setShowAssignModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Admit Patient to Bed {selectedBed.label}</h3>
              <button
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setShowAssignModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAssignSubmit} className="panel-body">
              <div className="form-group">
                <label>Select Inpatient to Allocate *</label>
                <select
                  required
                  value={selectedPatientId}
                  onChange={(e) => {
                    const patientId = e.target.value
                    const patient = patients.find((item) => item.id === patientId)
                    setSelectedPatientId(patientId)
                    setSelectedClinicianId(patient?.assigned_clinician || '')
                  }}
                >
                  <option value="">-- Choose Patient for Admission --</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} ({p.medical_record_number})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Attending Doctor *</label>
                <select
                  required
                  value={selectedClinicianId}
                  onChange={(e) => setSelectedClinicianId(e.target.value)}
                >
                  <option value="">-- Select Doctor --</option>
                  {clinicians.map((clinician) => (
                    <option key={clinician.id} value={clinician.id}>
                      {clinician.name || clinician.user_detail?.username || clinician.specialty}
                      {' - '}
                      {clinician.department || clinician.specialty}
                    </option>
                  ))}
                </select>
              </div>
              {selectedBed.daily_rate_cents > 0 ? (
                <p className="form-hint">
                  Room charge: ${(selectedBed.daily_rate_cents / 100).toFixed(2)} per completed 24 hours.
                </p>
              ) : (
                <p className="form-hint">No room rate is set for this bed.</p>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAssignModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Admitting...' : 'Confirm Admission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rateBed && (
        <div className="modal-overlay" onClick={() => setRateBed(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Room Rate - Bed {rateBed.label}</h3>
              <button
                type="button"
                style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setRateBed(null)}
                aria-label="Close room rate form"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRateSubmit} className="panel-body">
              <div className="form-group">
                <label htmlFor="daily-room-rate">Rate per 24 hours ($) *</label>
                <input
                  id="daily-room-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={rateAmount}
                  onChange={(e) => setRateAmount(e.target.value)}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setRateBed(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save rate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showWardModal && (
        <div className="modal-overlay" onClick={() => setShowWardModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Create ward</h3>
              <button type="button" className="modal-close" onClick={() => setShowWardModal(false)} aria-label="Close">×</button>
            </div>
            <form className="panel-body" onSubmit={handleCreateWard}>
              <div className="form-group">
                <label htmlFor="ward-name">Ward name *</label>
                <input id="ward-name" required value={wardForm.name} onChange={(e) => setWardForm({ ...wardForm, name: e.target.value })} placeholder="e.g. Ward A, ICU, Maternity" />
              </div>
              <div className="form-group">
                <label htmlFor="ward-location">Location</label>
                <input id="ward-location" value={wardForm.location} onChange={(e) => setWardForm({ ...wardForm, location: e.target.value })} placeholder="e.g. East wing, first floor" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowWardModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Create ward'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBedModal && (
        <div className="modal-overlay" onClick={() => setShowBedModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Add bed</h3>
              <button type="button" className="modal-close" onClick={() => setShowBedModal(false)} aria-label="Close">×</button>
            </div>
            <form className="panel-body" onSubmit={handleCreateBed}>
              <div className="form-group">
                <label htmlFor="bed-ward">Ward *</label>
                <select id="bed-ward" required value={bedForm.ward} onChange={(e) => setBedForm({ ...bedForm, ward: e.target.value })}>
                  <option value="">Select a ward</option>
                  {wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="bed-label">Bed name or number *</label>
                <input id="bed-label" required value={bedForm.label} onChange={(e) => setBedForm({ ...bedForm, label: e.target.value })} placeholder="e.g. A-01" />
              </div>
              <div className="form-group">
                <label htmlFor="new-bed-rate">Rate per 24 hours ($)</label>
                <input id="new-bed-rate" type="number" min="0" step="0.01" value={bedForm.daily_rate} onChange={(e) => setBedForm({ ...bedForm, daily_rate: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowBedModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : 'Create bed'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

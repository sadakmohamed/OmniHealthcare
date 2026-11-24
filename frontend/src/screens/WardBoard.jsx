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
  Layers
} from 'lucide-react'
import { getWards, getBeds, assignBed, dischargeBed, getPatients } from '../api'

export default function WardBoard({ me }) {
  const [wards, setWards] = useState([])
  const [beds, setBeds] = useState([])
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Assign modal
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedBed, setSelectedBed] = useState(null)
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [wRes, bRes, pRes] = await Promise.all([
        getWards(),
        getBeds(),
        getPatients().catch(() => ({ data: [] }))
      ])

      setWards(wRes.data?.results || wRes.data || [])
      setBeds(bRes.data?.results || bRes.data || [])
      setPatients(pRes.data?.results || pRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load ward board.')
    } finally {
      setLoading(false)
    }
  }

  function openAssignModal(bed) {
    setSelectedBed(bed)
    setSelectedPatientId('')
    setShowAssignModal(true)
  }

  async function handleAssignSubmit(e) {
    e.preventDefault()
    if (!selectedBed || !selectedPatientId) return
    setSubmitting(true)
    setError('')
    try {
      await assignBed(selectedBed.id, selectedPatientId)
      setSuccess(`Bed ${selectedBed.label} allocated to patient.`)
      setShowAssignModal(false)
      loadData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to allocate bed.')
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

  const totalBeds = beds.length
  const occupiedBeds = beds.filter((b) => b.status === 'occupied').length
  const availableBeds = beds.filter((b) => b.status === 'available').length
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0

  const role = me?.role || 'admin'
  const canManage = ['nurse', 'clinician', 'admin'].includes(role)

  return (
    <div className="ward-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MODULE F09</span>
          <h1>Inpatient Ward Management & Bed Allocation</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            Real-time inpatient census, bed occupancy status, admission allocation, and patient discharge tracking.
          </p>
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
                </div>
                <div className="panel-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
                    {wardBeds.map((bed) => {
                      const isOccupied = bed.status === 'occupied'
                      const pt = isOccupied ? patients.find((p) => p.id === bed.patient) : null
                      const ptName = pt ? `${pt.first_name} ${pt.last_name}` : (isOccupied ? `Patient ${bed.patient?.slice ? bed.patient.slice(0, 8) : bed.patient}` : null)
                      return (
                        <div
                          key={bed.id}
                          style={{
                            border: `1.5px solid ${isOccupied ? '#fca5a5' : '#86efac'}`,
                            background: isOccupied ? '#fff5f5' : '#f0fdf4',
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
                            <span className={`badge ${isOccupied ? 'badge-red' : 'badge-green'}`}>
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
                            ) : (
                              <div style={{ color: '#166534', fontStyle: 'italic', paddingTop: '8px' }}>
                                Cleaned & Ready for Admission
                              </div>
                            )}
                          </div>

                          {canManage && (
                            <div style={{ marginTop: 'auto', paddingTop: '6px' }}>
                              {!isOccupied ? (
                                <button
                                  className="btn btn-primary btn-xs"
                                  style={{ width: '100%', justifyContent: 'center' }}
                                  onClick={() => openAssignModal(bed)}
                                >
                                  <UserPlus size={13} /> Admit Patient
                                </button>
                              ) : (
                                <button
                                  className="btn btn-danger btn-xs"
                                  style={{ width: '100%', justifyContent: 'center' }}
                                  onClick={() => handleDischarge(bed)}
                                >
                                  <UserMinus size={13} /> Discharge Bed
                                </button>
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
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                >
                  <option value="">-- Choose Patient for Admission --</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} ({p.medical_record_number})
                    </option>
                  ))}
                </select>
              </div>

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
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import {
  User,
  Calendar,
  HeartPulse,
  Pill,
  DollarSign,
  FileText,
  Shield,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  X
} from 'lucide-react'
import {
  getAppointments,
  getLabResults,
  getPrescriptions,
  getBills,
  getCarePlans,
  getConsents,
  createConsent,
  getProxyGrants,
  createProxyGrant,
  revokeProxyGrant,
  getMe
} from '../api'

export default function PatientPortal({ me }) {
  const [activeTab, setActiveTab] = useState('appointments')
  const [appointments, setAppointments] = useState([])
  const [labResults, setLabResults] = useState([])
  const [prescriptions, setPrescriptions] = useState([])
  const [bills, setBills] = useState([])
  const [carePlans, setCarePlans] = useState([])
  const [consents, setConsents] = useState([])
  const [proxies, setProxies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Proxy modal
  const [showProxyModal, setShowProxyModal] = useState(false)
  const [proxyForm, setProxyForm] = useState({ grantee_username: '', scope: 'read,appointments' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadPortalData()
  }, [])

  async function loadPortalData() {
    setLoading(true)
    setError('')
    try {
      const [appts, labs, rxs, bls, cps, cns, pxs] = await Promise.all([
        getAppointments().catch(() => ({ data: [] })),
        getLabResults().catch(() => ({ data: [] })),
        getPrescriptions().catch(() => ({ data: [] })),
        getBills().catch(() => ({ data: [] })),
        getCarePlans().catch(() => ({ data: [] })),
        getConsents().catch(() => ({ data: [] })),
        getProxyGrants().catch(() => ({ data: [] }))
      ])

      setAppointments(appts.data?.results || appts.data || [])
      setLabResults(labs.data?.results || labs.data || [])
      setPrescriptions(rxs.data?.results || rxs.data || [])
      setBills(bls.data?.results || bls.data || [])
      setCarePlans(cps.data?.results || cps.data || [])
      setConsents(cns.data?.results || cns.data || [])
      setProxies(pxs.data?.results || pxs.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load patient portal records.')
    } finally {
      setLoading(false)
    }
  }

  async function handleGrantProxy(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await createProxyGrant({
        scope: proxyForm.scope,
        active: true
      })
      setSuccess('Family proxy access grant authorized.')
      setShowProxyModal(false)
      loadPortalData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to grant proxy access.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevokeProxy(id) {
    if (!window.confirm('Revoke family/proxy access grant?')) return
    setError('')
    try {
      await revokeProxyGrant(id)
      setSuccess('Proxy access revoked.')
      loadPortalData()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to revoke proxy.')
    }
  }

  return (
    <div className="patient-portal-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PATIENT SELF-SERVICE PORTAL</span>
          <h1>My Health Record & Care Portal</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            Secure personal chart access, verified laboratory results, medication instructions, invoices, and family proxy permissions.
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { id: 'appointments', label: `My Appointments (${appointments.length})`, icon: Calendar },
          { id: 'labs', label: `Lab Results (${labResults.length})`, icon: HeartPulse },
          { id: 'prescriptions', label: `Medications (${prescriptions.length})`, icon: Pill },
          { id: 'carePlans', label: `Care Plans (${carePlans.length})`, icon: FileText },
          { id: 'billing', label: `Invoices (${bills.length})`, icon: DollarSign },
          { id: 'family', label: `Family & Proxy Access (${proxies.length})`, icon: Shield }
        ].map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              className={`btn ${activeTab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab(t.id)}
            >
              <Icon size={16} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab Contents */}
      <div className="panel">
        <div className="panel-header">
          <h3>
            {activeTab === 'appointments' && 'Scheduled Consultations'}
            {activeTab === 'labs' && 'Diagnostic Results'}
            {activeTab === 'prescriptions' && 'Authorized Prescriptions'}
            {activeTab === 'carePlans' && 'Clinical Care Directives'}
            {activeTab === 'billing' && 'Billing Statements'}
            {activeTab === 'family' && 'Authorized Caregiver & Proxy Grants'}
          </h3>
          <button className="btn btn-secondary btn-sm" onClick={loadPortalData}>Refresh</button>
        </div>

        <div className="panel-body">
          {loading ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading your records...
            </div>
          ) : (
            <div>
              {/* Appointments */}
              {activeTab === 'appointments' && (
                appointments.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No upcoming appointments scheduled.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {appointments.map((a) => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                        <div>
                          <strong>{new Date(a.starts_at).toLocaleDateString()} at {new Date(a.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                          <div style={{ fontSize: '13px', color: 'var(--navy)', marginTop: '2px' }}>Reason: {a.reason || 'General check-up'}</div>
                        </div>
                        <span className={`badge badge-${a.status}`}>{a.status?.replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Lab Results */}
              {activeTab === 'labs' && (
                labResults.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No diagnostic test results on file.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {labResults.map((lr) => (
                      <div key={lr.id} style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <strong style={{ fontSize: '14px', color: 'var(--navy)' }}>Result: {lr.result}</strong>
                          <span className="badge badge-green">{lr.status}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          Reference: {lr.reference_range || 'Normal'} &bull; Verified: {new Date(lr.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Prescriptions */}
              {activeTab === 'prescriptions' && (
                prescriptions.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No active prescriptions on file.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {prescriptions.map((rx) => (
                      <div key={rx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                        <div>
                          <strong style={{ fontSize: '14px', color: 'var(--primary)' }}>{rx.medication}</strong>
                          <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px' }}>Dosage: {rx.dosage}</div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{rx.instructions}</div>
                        </div>
                        <span className={`badge badge-${rx.status}`}>{rx.status}</span>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Care Plans */}
              {activeTab === 'carePlans' && (
                carePlans.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No documented care plans.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {carePlans.map((cp) => (
                      <div key={cp.id} style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                        <p style={{ fontSize: '13px', color: 'var(--navy)' }}>{cp.description}</p>
                        <small style={{ color: 'var(--muted)', display: 'block', marginTop: '4px' }}>
                          Approved: {new Date(cp.created_at).toLocaleDateString()}
                        </small>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Billing */}
              {activeTab === 'billing' && (
                bills.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>No invoices issued.</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invoice Number</th>
                        <th>Itemized Services</th>
                        <th>Amount Due</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map((b) => (
                        <tr key={b.id}>
                          <td><strong>{b.invoice_number}</strong></td>
                          <td style={{ fontSize: '12px' }}>
                            {Array.isArray(b.items) ? b.items.map((it) => it.description).join(', ') : 'Medical care'}
                          </td>
                          <td><strong>${(b.total_cents / 100).toFixed(2)}</strong></td>
                          <td><span className={`badge badge-${b.status}`}>{b.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}

              {/* Family / Proxy Access */}
              {activeTab === 'family' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
                      Grant scoped access to a trusted family member or caregiver to view your records, appointments, or results.
                    </p>
                    <button className="btn btn-primary btn-sm" onClick={() => setShowProxyModal(true)}>
                      <Plus size={14} /> Grant Family Access
                    </button>
                  </div>

                  {proxies.length === 0 ? (
                    <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>
                      No active family proxy grants.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {proxies.map((px) => (
                        <div key={px.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                          <div>
                            <strong>Grantee: {px.grantee_username || px.grantee || 'Caregiver User'}</strong>
                            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Scope: {px.scope}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span className={`badge ${px.active ? 'badge-green' : 'badge-red'}`}>
                              {px.active ? 'Active' : 'Revoked'}
                            </span>
                            {px.active && (
                              <button
                                className="btn btn-danger btn-xs"
                                onClick={() => handleRevokeProxy(px.id)}
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

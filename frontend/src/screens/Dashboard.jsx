import React, { useEffect, useState } from 'react'
import {
  Users,
  CalendarDays,
  Stethoscope,
  DollarSign,
  Activity,
  BedDouble,
  ArrowRight,
} from 'lucide-react'
import { getAnalytics, getAppointments } from '../api'

export default function Dashboard({ me, onNavigate, listFilters, filterValues }) {
  const role = me?.role
  const hasAppointments = ['admin', 'receptionist', 'clinician', 'patient'].includes(role)
  const hasStats = ['admin', 'receptionist', 'clinician', 'nurse', 'lab', 'pharmacist', 'billing'].includes(role)
  const [statsResult, setStatsResult] = useState(null)
  const [appointmentsResult, setAppointmentsResult] = useState(null)
  const appointmentKey = JSON.stringify([role, filterValues.search, filterValues.date])
  const currentStats = statsResult?.role === role ? statsResult : null
  const currentAppointments = appointmentsResult?.key === appointmentKey ? appointmentsResult : null
  const stats = currentStats?.data
  const statsError = currentStats?.error
  const statsLoading = hasStats && !currentStats
  const appointments = currentAppointments?.data || []
  const appointmentsError = currentAppointments?.error
  const appointmentsLoading = hasAppointments && !currentAppointments

  useEffect(() => {
    if (!hasStats) return
    let active = true
    getAnalytics()
      .then((response) => { if (active) setStatsResult({ role, data: response.data }) })
      .catch(() => { if (active) setStatsResult({ role, error: 'Unable to load dashboard statistics.' }) })
    return () => { active = false }
  }, [role, hasStats])

  useEffect(() => {
    if (!hasAppointments) return
    let active = true
    getAppointments()
      .then((response) => {
        if (active) setAppointmentsResult({
          key: appointmentKey, data: (response.data?.results || response.data || []).slice(0, 6),
        })
      })
      .catch(() => { if (active) setAppointmentsResult({ key: appointmentKey, error: 'Unable to load appointments.' }) })
    return () => { active = false }
  }, [appointmentKey, hasAppointments])

  const value = (key) => stats?.[key]
  const cardsByRole = {
    admin: [
      { label: 'Registered Patients', value: value('total_patients'), icon: Users, color: 'blue', target: 'patients' },
      { label: "Today's Schedule", value: value('scheduled_today'), icon: CalendarDays, color: 'cyan', target: 'appointments' },
      { label: 'Active Encounters', value: value('active_encounters'), icon: Stethoscope, color: 'violet', target: 'encounters' },
      { label: 'Outstanding Balance', value: stats && `$${(value('outstanding_bills_cents') / 100).toFixed(2)}`, icon: DollarSign, color: 'amber', target: 'billing' },
    ],
    receptionist: [
      { label: 'Registered OPD Patients', value: value('total_patients'), icon: Users, color: 'blue', target: 'opd' },
      { label: "Today's Schedule", value: value('scheduled_today'), icon: CalendarDays, color: 'cyan', target: 'appointments' },
    ],
    clinician: [
      { label: 'My Patients', value: value('total_patients'), icon: Users, color: 'blue', target: 'patients' },
      { label: "My Schedule Today", value: value('scheduled_today'), icon: CalendarDays, color: 'cyan', target: 'appointments' },
      { label: 'My Active Encounters', value: value('active_encounters'), icon: Stethoscope, color: 'violet', target: 'encounters' },
      { label: 'My Pending Lab Orders', value: value('pending_lab_orders'), icon: Activity, color: 'amber', target: 'laboratory' },
    ],
    nurse: [
      { label: 'Awaiting Triage', value: value('awaiting_triage'), icon: Activity, color: 'cyan', target: 'opd' },
      { label: 'Occupied Beds', value: stats && `${value('occupied_beds')} / ${value('total_beds')}`, icon: BedDouble, color: 'violet', target: 'wards' },
    ],
    lab: [
      { label: 'Orders Awaiting Results', value: value('pending_labs'), icon: Activity, color: 'cyan', target: 'laboratory' },
    ],
    pharmacist: [
      { label: 'Prescriptions to Dispense', value: value('pending_prescriptions'), icon: Activity, color: 'cyan', target: 'pharmacy' },
    ],
    billing: [
      { label: 'Unpaid or Partial Bills', value: value('unpaid_bills'), icon: DollarSign, color: 'blue', target: 'billing' },
      { label: 'Outstanding Balance', value: stats && `$${(value('outstanding_bills_cents') / 100).toFixed(2)}`, icon: DollarSign, color: 'amber', target: 'billing' },
    ],
  }
  const statCards = cardsByRole[role] || []

  return (
    <div className="dashboard-view">
      <div className="page-heading">
        <h1>{role === 'patient' ? `Welcome, ${me?.first_name || me?.username}` : 'Dashboard'}</h1>
        <div className="page-actions">
          {['receptionist', 'admin'].includes(role) && (
            <button className="btn btn-primary" onClick={() => onNavigate('opd')}>+ Register OPD Patient</button>
          )}
          {role === 'clinician' && (
            <button className="btn btn-primary" onClick={() => onNavigate('opd')}>
              <Stethoscope size={16} /> My OPD Consultations
            </button>
          )}
          {role === 'nurse' && (
            <button className="btn btn-primary" onClick={() => onNavigate('opd')}>
              <Activity size={16} /> OPD Triage Vitals
            </button>
          )}
          {role === 'patient' && (
            <button className="btn btn-primary" onClick={() => onNavigate('appointments')}>Book Appointment</button>
          )}
        </div>
      </div>

      {hasAppointments && listFilters}
      {statsError && <div className="alert alert-error" role="alert">{statsError}</div>}
      {appointmentsError && <div className="alert alert-error" role="alert">{appointmentsError}</div>}
      {statCards.length > 0 && <div className="stat-grid">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <button className="stat-card dashboard-stat-card" key={card.label} onClick={() => onNavigate(card.target)}>
              <div className={`stat-icon ${card.color}`}><Icon size={24} /></div>
              <div style={{ flex: 1 }}>
                <div className="stat-label">{card.label}</div>
                <div className="stat-value">{statsLoading ? '...' : statsError || card.value == null ? 'Unavailable' : card.value}</div>
              </div>
              <ArrowRight size={16} color="var(--muted)" />
            </button>
          )
        })}
      </div>}

      {hasAppointments && <div className={`dashboard-grid ${role !== 'admin' ? 'patient-dashboard-grid' : ''}`}>
        <section className="panel">
          <div className="panel-header">
            <h3>{['clinician', 'patient'].includes(role) ? 'My Appointments' : 'Recent Appointments'}</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('appointments')}>View All</button>
          </div>
          <div className="table-wrap">
            {appointmentsError ? null : appointmentsLoading ? (
              <div style={{ padding: '32px', textAlign: 'center' }}>Loading appointments...</div>
            ) : appointments.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>No appointments found.</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Time / Date</th><th>Patient</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>
                        {new Date(a.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                        <small style={{ color: 'var(--muted)' }}>({new Date(a.starts_at).toLocaleDateString()})</small>
                      </td>
                      <td><strong>{a.patient_name || `Patient ${a.patient?.slice ? a.patient.slice(0, 8) : a.patient}`}</strong></td>
                      <td style={{ color: 'var(--muted)', fontSize: '12px' }}>{a.reason || 'Routine Consultation'}</td>
                      <td><span className={`badge badge-${a.status}`}>{a.status?.replace('_', ' ')}</span></td>
                      <td><button className="btn btn-secondary btn-xs" onClick={() => onNavigate('appointments')}>Manage</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        {role === 'admin' && <section className="panel">
          <div className="panel-header">
            <h3>Facility overview</h3>
            <button className="btn btn-secondary btn-xs" onClick={() => onNavigate('wards')}>Ward Board</button>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><BedDouble size={16} color="var(--accent)" /> Bed Occupancy</span>
              <strong>
                {statsLoading ? '...' : statsError || !stats ? 'Unavailable' : (
                  <>{stats.occupied_beds} / {stats.total_beds}{' '}
                    <small style={{ color: 'var(--muted)', fontWeight: 'normal' }}>
                      ({stats.total_beds ? Math.round((stats.occupied_beds / stats.total_beds) * 100) : 0}%)
                    </small>
                  </>
                )}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><Activity size={16} color="#0891b2" /> Pending Lab Orders</span>
              <span className="badge badge-amber">{statsLoading ? '...' : statsError || !stats ? 'Unavailable' : `${stats.pending_lab_orders} tests`}</span>
            </div>
          </div>
        </section>}
      </div>}
    </div>
  )
}

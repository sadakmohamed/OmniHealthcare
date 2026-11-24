import React, { useState, useEffect } from 'react'
import {
  Users,
  CalendarDays,
  Stethoscope,
  DollarSign,
  Activity,
  BedDouble,
  FileText,
  Clock,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle
} from 'lucide-react'
import { getAnalytics, getAppointments, getEncounters } from '../api'

export default function Dashboard({ me, onNavigate }) {
  const [stats, setStats] = useState({
    patients: 0,
    appointments_today: 0,
    encounters_active: 0,
    outstanding_bills_cents: 0,
    occupied_beds: 0,
    total_beds: 0,
    pending_lab_orders: 0
  })
  const [appointments, setAppointments] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData()
  }, [])

  async function loadDashboardData() {
    setLoading(true)
    try {
      const res = await getAnalytics()
      if (res.data) {
        setStats(res.data)
      }
    } catch {
      // fallback
    }

    try {
      const apptRes = await getAppointments()
      const appts = apptRes.data?.results || apptRes.data || []
      setAppointments(appts.slice(0, 6))
    } catch {
      // fallback
    }

    try {
      const encRes = await getEncounters()
      const encs = encRes.data?.results || encRes.data || []
      setEncounters(encs.slice(0, 5))
    } catch {
      // fallback
    } finally {
      setLoading(false)
    }
  }

  const role = me?.role || 'admin'
  const isPatient = role === 'patient'

  const statCards = isPatient ? [
    { label: 'My Appointments', value: appointments.length, icon: CalendarDays, color: 'cyan', target: 'appointments' },
    { label: 'My Care Plans', value: 'Active', icon: FileText, color: 'blue', target: 'patient-portal' },
    { label: 'Health Status', value: 'Good', icon: Activity, color: 'green', target: 'patient-portal' },
    { label: 'Virtual Care', value: 'Ready', icon: Stethoscope, color: 'violet', target: 'virtual' },
  ] : [
    { label: 'Registered Patients', value: stats.patients, icon: Users, color: 'blue', target: 'patients' },
    { label: "Today's Schedule", value: stats.appointments_today, icon: CalendarDays, color: 'cyan', target: 'appointments' },
    { label: 'Active Encounters', value: stats.encounters_active, icon: Stethoscope, color: 'violet', target: 'encounters' },
    { label: 'Outstanding Balance', value: `$${((stats.outstanding_bills_cents || 0) / 100).toFixed(2)}`, icon: DollarSign, color: 'amber', target: 'billing' },
  ]

  return (
    <div className="dashboard-view">
      <div className="page-heading">
        <div>
          <span className="eyebrow">OMNIHEALTH OPERATIONAL DASHBOARD</span>
          <h1>Welcome, {me?.first_name || me?.username}</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '2px' }}>
            Logged in as <strong>{role.toUpperCase()}</strong> &bull; Organization: {me?.organization_name || 'OmniHealthcare Synthetic'}
          </p>
        </div>
        <div className="page-actions">
          {(role === 'receptionist' || role === 'admin') && (
            <button className="btn btn-primary" onClick={() => onNavigate('patients')}>
              + Register Patient
            </button>
          )}
          {(role === 'clinician' || role === 'admin') && (
            <button className="btn btn-primary" onClick={() => onNavigate('encounters')}>
              + New Consultation
            </button>
          )}
          {role === 'nurse' && (
            <button className="btn btn-primary" onClick={() => onNavigate('triage')}>
              + Record Vitals
            </button>
          )}
          {isPatient && (
            <button className="btn btn-primary" onClick={() => onNavigate('appointments')}>
              Book Appointment
            </button>
          )}
        </div>
      </div>

      <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ShieldCheck size={18} color="#92400e" />
        <div>
          <strong>SYNTHETIC DEMONSTRATION DATA ONLY</strong> &mdash; Fictional patients, synthetic records, and simulated clinical workflows. Not for actual diagnostic or clinical use.
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="stat-grid">
        {statCards.map((c) => {
          const Icon = c.icon
          return (
            <div
              className="stat-card"
              key={c.label}
              style={{ cursor: 'pointer' }}
              onClick={() => onNavigate(c.target)}
            >
              <div className={`stat-icon ${c.color}`}>
                <Icon size={24} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="stat-label">{c.label}</div>
                <div className="stat-value">{loading ? '...' : c.value}</div>
              </div>
              <ArrowRight size={16} color="var(--muted)" />
            </div>
          )
        })}
      </div>

      {/* Main Panels Grid */}
      <div className="dashboard-grid">
        {/* Left Column: Scheduled appointments */}
        <section className="panel">
          <div className="panel-header">
            <h3>Recent Appointments</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('appointments')}>
              View All
            </button>
          </div>
          <div className="table-wrap">
            {appointments.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
                No scheduled appointments found for today.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time / Date</th>
                    <th>Patient</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>
                        {new Date(a.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                        <small style={{ color: 'var(--muted)' }}>({new Date(a.starts_at).toLocaleDateString()})</small>
                      </td>
                      <td>
                        <strong>{a.patient_name || `Patient ${a.patient?.slice ? a.patient.slice(0, 8) : a.patient}`}</strong>
                      </td>
                      <td style={{ color: 'var(--muted)', fontSize: '12px' }}>
                        {a.reason || 'Routine Consultation'}
                      </td>
                      <td>
                        <span className={`badge badge-${a.status}`}>{a.status?.replace('_', ' ')}</span>
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => onNavigate('appointments')}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Right Column: Care Status & Hospital Quick Overview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <section className="panel">
            <div className="panel-header">
              <h3>Inpatient & Facility Status</h3>
              <button className="btn btn-secondary btn-xs" onClick={() => onNavigate('wards')}>
                Ward Board
              </button>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
                <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <BedDouble size={16} color="var(--accent)" /> Bed Occupancy
                </span>
                <strong>
                  {stats.occupied_beds || 0} / {stats.total_beds || 10}{' '}
                  <small style={{ color: 'var(--muted)', fontWeight: 'normal' }}>
                    ({Math.round(((stats.occupied_beds || 0) / (stats.total_beds || 10)) * 100)}%)
                  </small>
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
                <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Activity size={16} color="#0891b2" /> Pending Lab Orders
                </span>
                <span className="badge badge-amber">{stats.pending_lab_orders || 0} tests</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={16} color="#16a34a" /> Clinical System
                </span>
                <span className="badge badge-green">Operational</span>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Role Quick Links</h3>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('patients')}>
                Patient Charts
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('triage')}>
                Triage / Vitals
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('laboratory')}>
                Lab Orders
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('pharmacy')}>
                Prescriptions
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('billing')}>
                Invoices & Claims
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('virtual')}>
                Virtual Clinic
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

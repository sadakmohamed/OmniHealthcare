import React, { useState, useEffect } from 'react'
import {
  Users,
  CalendarDays,
  Stethoscope,
  Activity,
  HeartPulse,
  Pill,
  Share2,
  BedDouble,
  DollarSign,
  Bell,
  Video,
  ShieldCheck,
  LayoutDashboard,
  LogOut,
  User,
  Menu,
  X,
  FileText
} from 'lucide-react'
import { login, getMe, register } from './api'
import './App.css'

// Screens
import Dashboard from './screens/Dashboard'
import Patients from './screens/Patients'
import Appointments from './screens/Appointments'
import Triage from './screens/Triage'
import Encounters from './screens/Encounters'
import Laboratory from './screens/Laboratory'
import Pharmacy from './screens/Pharmacy'
import Referrals from './screens/Referrals'
import WardBoard from './screens/WardBoard'
import Billing from './screens/Billing'
import FollowUps from './screens/FollowUps'
import AuditHistory from './screens/AuditHistory'
import VirtualCare from './screens/VirtualCare'
import PatientPortal from './screens/PatientPortal'

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('oh_token'))
  const [me, setMe] = useState(() => {
    try {
      const u = localStorage.getItem('oh_user')
      return u ? JSON.parse(u) : null
    } catch {
      return null
    }
  })
  const [currentScreen, setCurrentScreen] = useState('dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (token) {
      getMe()
        .then((res) => {
          setMe(res.data)
          localStorage.setItem('oh_user', JSON.stringify(res.data))
        })
        .catch(() => {
          handleLogout()
        })
    }
  }, [token])

  function handleLoginSuccess(authToken, userData) {
    localStorage.setItem('oh_token', authToken)
    if (userData) {
      localStorage.setItem('oh_user', JSON.stringify(userData))
      setMe(userData)
    }
    setToken(authToken)
    setCurrentScreen('dashboard')
  }

  function handleLogout() {
    localStorage.removeItem('oh_token')
    localStorage.removeItem('oh_user')
    setToken(null)
    setMe(null)
    setCurrentScreen('dashboard')
  }

  if (!token) {
    return <LoginView onLogin={handleLoginSuccess} />
  }

  const role = me?.role || 'admin'

  // Navigation Items with Role-Based Permissions
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['*'] },
    { id: 'patients', label: 'Patient Registry', icon: Users, roles: ['admin', 'receptionist', 'clinician', 'nurse'] },
    { id: 'appointments', label: 'Appointments', icon: CalendarDays, roles: ['admin', 'receptionist', 'clinician', 'patient'] },
    { id: 'triage', label: 'Triage & Vitals', icon: Activity, roles: ['admin', 'nurse', 'clinician'] },
    { id: 'encounters', label: 'Consultations', icon: Stethoscope, roles: ['admin', 'clinician'] },
    { id: 'laboratory', label: 'Laboratory', icon: HeartPulse, roles: ['admin', 'lab', 'clinician'] },
    { id: 'pharmacy', label: 'Pharmacy', icon: Pill, roles: ['admin', 'pharmacist', 'clinician'] },
    { id: 'referrals', label: 'Referrals', icon: Share2, roles: ['admin', 'clinician'] },
    { id: 'wards', label: 'Ward & Beds', icon: BedDouble, roles: ['admin', 'nurse', 'clinician'] },
    { id: 'billing', label: 'Billing & Claims', icon: DollarSign, roles: ['admin', 'billing'] },
    { id: 'follow-ups', label: 'Follow-ups', icon: Bell, roles: ['admin', 'receptionist', 'clinician', 'nurse'] },
    { id: 'virtual', label: 'Virtual Care', icon: Video, roles: ['admin', 'clinician', 'receptionist', 'patient'] },
    { id: 'patient-portal', label: 'My Health Portal', icon: FileText, roles: ['patient', 'admin'] },
    { id: 'audit', label: 'Audit History', icon: ShieldCheck, roles: ['admin'] }
  ]

  const visibleNav = navItems.filter(
    (item) => item.roles.includes('*') || item.roles.includes(role)
  )

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="brand">
          <img src="/logo.png" alt="OmniTeckno" onError={(e) => { e.target.style.display = 'none' }} />
          <div className="brand-text">
            <strong>OmniHealthcare</strong>
            <span>OmniTeckno &bull; Prototype</span>
          </div>
        </div>

        <nav>
          <div className="nav-section-label">Main Navigation</div>
          {visibleNav.map((item) => {
            const Icon = item.icon
            const isActive = currentScreen === item.id
            return (
              <button
                key={item.id}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setCurrentScreen(item.id)
                  setMobileMenuOpen(false)
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">
              {me?.first_name ? me.first_name[0] : me?.username ? me.username[0].toUpperCase() : 'U'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {me?.first_name ? `${me.first_name} ${me.last_name || ''}` : me?.username}
              </strong>
              <small>{role}</small>
            </div>
          </div>
          <button className="nav-item logout" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main>
        <header className="topbar">
          <button className="menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy)' }}>
            OmniHealthcare &mdash; Connected Clinical System
          </div>
          <div className="topbar-right">
            <span className="badge badge-blue" style={{ textTransform: 'uppercase' }}>
              Role: {role}
            </span>
            <div className="topbar-user" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="topbar-avatar">
                {me?.first_name ? me.first_name[0] : me?.username ? me.username[0].toUpperCase() : 'U'}
              </div>
              <div>
                <strong>{me?.first_name ? `${me.first_name} ${me.last_name || ''}` : me?.username}</strong>
                <small>{role.toUpperCase()}</small>
              </div>
            </div>
          </div>
        </header>

        <div className="content">
          {currentScreen === 'dashboard' && <Dashboard me={me} onNavigate={setCurrentScreen} />}
          {currentScreen === 'patients' && <Patients me={me} onNavigate={setCurrentScreen} />}
          {currentScreen === 'appointments' && <Appointments me={me} onNavigate={setCurrentScreen} />}
          {currentScreen === 'triage' && <Triage me={me} onNavigate={setCurrentScreen} />}
          {currentScreen === 'encounters' && <Encounters me={me} onNavigate={setCurrentScreen} />}
          {currentScreen === 'laboratory' && <Laboratory me={me} />}
          {currentScreen === 'pharmacy' && <Pharmacy me={me} />}
          {currentScreen === 'referrals' && <Referrals me={me} />}
          {currentScreen === 'wards' && <WardBoard me={me} />}
          {currentScreen === 'billing' && <Billing me={me} />}
          {currentScreen === 'follow-ups' && <FollowUps me={me} />}
          {currentScreen === 'virtual' && <VirtualCare me={me} />}
          {currentScreen === 'patient-portal' && <PatientPortal me={me} />}
          {currentScreen === 'audit' && <AuditHistory me={me} />}
        </div>
      </main>
    </div>
  )
}

function LoginView({ onLogin }) {
  const [username, setUsername] = useState('receptionist')
  const [password, setPassword] = useState('Password123!')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showRegister, setShowRegister] = useState(false)

  // Registration state
  const [regForm, setRegForm] = useState({
    username: '',
    password: 'Password123!',
    first_name: '',
    last_name: '',
    date_of_birth: '1995-06-15',
    sex: 'Female',
    email: '',
    phone: '+254-700-000000',
    allergies: 'None'
  })
  const [regSuccess, setRegSuccess] = useState('')

  async function handleLoginSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await login(username, password)
      const token = res.data.access
      localStorage.setItem('oh_token', token)
      const meRes = await getMe()
      onLogin(token, meRes.data)
    } catch (err) {
      setError('Authentication failed. Please verify demo username and credentials.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegisterSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setRegSuccess('')
    try {
      await register({
        ...regForm,
        medical_record_number: 'MRN-' + Math.floor(100000 + Math.random() * 900000)
      })
      setRegSuccess('Registration successful! You can now sign in as your new patient account.')
      setUsername(regForm.username)
      setShowRegister(false)
    } catch (err) {
      const data = err.response?.data
      if (typeof data === 'object') {
        setError(Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('; '))
      } else {
        setError(data || 'Registration failed.')
      }
    } finally {
      setLoading(false)
    }
  }

  function pickDemoRole(roleUser) {
    setUsername(roleUser)
    setPassword('Password123!')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(320px, 45%) 1fr', background: '#f8fafc' }}>
      {/* Brand Visual Left Panel */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1a3c5e 0%, #0b2239 100%)',
          color: '#fff',
          padding: '60px 48px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '32px' }}>
            <img
              src="/logo.png"
              alt="OmniTeckno"
              style={{ width: '48px', height: '48px', borderRadius: '10px', background: '#fff', padding: '4px' }}
              onError={(e) => { e.target.style.display = 'none' }}
            />
            <div>
              <h1 style={{ fontSize: '24px', color: '#fff', fontWeight: 800 }}>OmniHealthcare</h1>
              <span style={{ fontSize: '11px', letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--accent)' }}>
                OmniTeckno &bull; Full-Stack Healthcare
              </span>
            </div>
          </div>

          <h2 style={{ fontSize: '28px', lineHeight: 1.25, fontWeight: 700, marginBottom: '16px' }}>
            Connected Care.<br />Clear Clinical Operations.
          </h2>
          <p style={{ fontSize: '14px', opacity: .8, lineHeight: 1.6, maxWidth: '440px' }}>
            A unified prototype delivering electronic health records, appointment scheduling, nursing triage, consultation notes, laboratory, pharmacy, inpatient bed status, and billing.
          </p>
        </div>

        <div style={{ background: 'rgba(255,255,255,.07)', borderRadius: '12px', padding: '18px', border: '1px solid rgba(255,255,255,.12)' }}>
          <div style={{ fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700, marginBottom: '6px' }}>
            SYNTHETIC DATASET NOTICE
          </div>
          <p style={{ fontSize: '12px', opacity: .85, margin: 0, lineHeight: 1.5 }}>
            Built strictly for the OmniTeckno confidential engineering assessment. Fictional patients, synthetic payments, and no live clinical decisions.
          </p>
        </div>
      </div>

      {/* Login / Register Card Right Panel */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        <div style={{ width: '100%', maxWidth: '460px' }}>
          {!showRegister ? (
            <div className="panel" style={{ padding: '36px 32px' }}>
              <span className="eyebrow">ASSESSMENT PROTOTYPE</span>
              <h2 style={{ fontSize: '22px', marginTop: '4px', marginBottom: '8px' }}>Sign in to OmniHealth</h2>
              <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '20px' }}>
                Select a demo role below or enter credentials.
              </p>

              {error && <div className="alert alert-error">{error}</div>}
              {regSuccess && <div className="alert alert-success">{regSuccess}</div>}

              {/* Demo Roles Quick Chips */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                  Quick Demo Role Select (Password: Password123!)
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[
                    'receptionist',
                    'clinician',
                    'nurse',
                    'lab',
                    'pharmacist',
                    'billing',
                    'patient',
                    'admin'
                  ].map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`btn btn-xs ${username === r ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => pickDemoRole(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleLoginSubmit}>
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: '12px' }}
                  disabled={loading}
                >
                  {loading ? 'Authenticating...' : 'Sign In to Workspace'}
                </button>
              </form>

              <div style={{ textAlign: 'center', marginTop: '20px', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Are you a new patient? </span>
                <button
                  type="button"
                  style={{ background: 'none', border: 0, color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}
                  onClick={() => setShowRegister(true)}
                >
                  Register Portal Account
                </button>
              </div>
            </div>
          ) : (
            <div className="panel" style={{ padding: '36px 32px' }}>
              <span className="eyebrow">PATIENT SELF-REGISTRATION</span>
              <h2 style={{ fontSize: '20px', marginTop: '4px', marginBottom: '16px' }}>Create Patient Account</h2>

              {error && <div className="alert alert-error">{error}</div>}

              <form onSubmit={handleRegisterSubmit}>
                <div className="form-row">
                  <div className="form-group">
                    <label>First Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="Amina"
                      value={regForm.first_name}
                      onChange={(e) => setRegForm({ ...regForm, first_name: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Last Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="Example"
                      value={regForm.last_name}
                      onChange={(e) => setRegForm({ ...regForm, last_name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Desired Username *</label>
                    <input
                      type="text"
                      required
                      placeholder="patient_amina"
                      value={regForm.username}
                      onChange={(e) => setRegForm({ ...regForm, username: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Date of Birth *</label>
                    <input
                      type="date"
                      required
                      value={regForm.date_of_birth}
                      onChange={(e) => setRegForm({ ...regForm, date_of_birth: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Email Address</label>
                    <input
                      type="email"
                      placeholder="amina@example.invalid"
                      value={regForm.email}
                      onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Password *</label>
                    <input
                      type="password"
                      required
                      value={regForm.password}
                      onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowRegister(false)}
                  >
                    Back to Sign In
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ flex: 1, justifyContent: 'center' }}
                    disabled={loading}
                  >
                    {loading ? 'Creating...' : 'Register Account'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

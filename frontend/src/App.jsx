import React, { useState, useEffect, useLayoutEffect } from 'react'
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
  FileText,
  Eye,
  EyeOff
} from 'lucide-react'
import {
  login,
  changeInitialPassword,
  getMe,
  register
} from './api'
import ListFilters from './components/ListFilters'
import './App.css'

const GLOBAL_LIST_FILTER_SCREENS = {
  dashboard: { search: true },
  opd: { search: false },
  consultants: { search: false },
  patients: { search: false },
  triage: { search: false },
  encounters: { search: true },
  referrals: { search: true },
  inpatients: { search: false },
  billing: { search: true },
  'follow-ups': { search: true },
  'patient-portal': { search: true },
  audit: { search: false }
}

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
import OPDQueue from './screens/OPDQueue'
import DoctorConsultation from './screens/DoctorConsultation'
import Consultants from './screens/Consultants'
import Inpatients from './screens/Inpatients'
import LabTests from './screens/LabTests'
import ManageUsers from './screens/ManageUsers'
import Medications from './screens/Medications'
import Profile from './screens/Profile'
import ClinicianMessages from './screens/ClinicianMessages'

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('oh_token'))
  const [loginMessage, setLoginMessage] = useState('')
  const [me, setMe] = useState(() => {
    try {
      const u = localStorage.getItem('oh_user')
      return u ? JSON.parse(u) : null
    } catch {
      return null
    }
  })
  const [currentScreen, setCurrentScreen] = useState('dashboard')
  const [listFilters, setListFilters] = useState(() => ({
    search: localStorage.getItem('oh_list_search_dashboard') || '',
    date: localStorage.getItem('oh_list_date_dashboard') || ''
  }))
  const [selectedConsultationPatient, setSelectedConsultationPatient] = useState(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useLayoutEffect(() => {
    localStorage.setItem('oh_active_screen', currentScreen)
  }, [currentScreen])

  useEffect(() => {
    if (token) {
      getMe()
        .then((res) => {
          setMe(res.data)
          localStorage.setItem('oh_user', JSON.stringify(res.data))
        })
        .catch((error) => {
          if (error.response?.status === 401) {
            handleLogout()
          }
        })
    }
  }, [token])

  function handleLoginSuccess(authToken, userData) {
    setLoginMessage('')
    localStorage.setItem('oh_token', authToken)
    if (userData) {
      localStorage.setItem('oh_user', JSON.stringify(userData))
      setMe(userData)
    }
    setToken(authToken)
    navigateTo('dashboard')
  }

  function handleLogout() {
    localStorage.removeItem('oh_token')
    localStorage.removeItem('oh_user')
    setToken(null)
    setMe(null)
    navigateTo('dashboard')
  }

  function navigateTo(screen) {
    localStorage.setItem('oh_active_screen', screen)
    setCurrentScreen(screen)
    setListFilters({
      search: localStorage.getItem(`oh_list_search_${screen}`) || '',
      date: localStorage.getItem(`oh_list_date_${screen}`) || ''
    })
    setSelectedConsultationPatient(null)
  }

  function applyListFilters(filters) {
    localStorage.setItem(`oh_list_search_${currentScreen}`, filters.search)
    localStorage.setItem(`oh_list_date_${currentScreen}`, filters.date)
    setListFilters(filters)
  }

  if (!token) {
    return <LoginView onLogin={handleLoginSuccess} initialMessage={loginMessage} />
  }

  const role = me?.role || 'pending'

  // Navigation Items with Role-Based Permissions
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['*'] },
    { id: 'opd', label: 'OPD Queue', icon: Stethoscope, roles: ['admin', 'receptionist', 'clinician', 'nurse'] },
    { id: 'consultants', label: 'Consultants Directory', icon: User, roles: ['admin'] },
    { id: 'users', label: 'User Accounts', icon: Users, roles: ['admin'] },
    { id: 'profile', label: 'My Profile', icon: User, roles: ['*'] },
    { id: 'patients', label: 'Patient Charts', icon: Users, roles: ['admin', 'clinician', 'nurse'] },
    { id: 'appointments', label: 'Appointments', icon: CalendarDays, roles: ['admin', 'receptionist', 'clinician', 'patient'] },
    { id: 'triage', label: 'Triage & Vitals', icon: Activity, roles: ['admin', 'nurse'] },
    { id: 'encounters', label: 'Consultations', icon: Stethoscope, roles: ['admin', 'clinician'] },
    { id: 'messages', label: 'Patient Messages', icon: Bell, roles: ['clinician'] },
    { id: 'laboratory', label: 'Laboratory', icon: HeartPulse, roles: ['admin', 'clinician', 'lab'] },
    { id: 'lab-tests', label: 'Lab Test Catalog', icon: HeartPulse, roles: ['admin', 'billing'] },
    { id: 'pharmacy', label: 'Pharmacy', icon: Pill, roles: ['admin', 'pharmacist'] },
    { id: 'medications', label: 'Medication Catalog', icon: Pill, roles: ['admin', 'pharmacist'] },
    { id: 'referrals', label: 'Referrals', icon: Share2, roles: ['admin', 'clinician'] },
    { id: 'inpatients', label: 'Inpatients', icon: BedDouble, roles: ['admin', 'clinician', 'nurse'] },
    { id: 'wards', label: 'Ward & Beds', icon: BedDouble, roles: ['admin', 'nurse'] },
    { id: 'billing', label: 'Billing & Claims', icon: DollarSign, roles: ['admin', 'billing'] },
    { id: 'follow-ups', label: 'Follow-ups', icon: Bell, roles: ['admin', 'receptionist', 'clinician', 'nurse'] },
    { id: 'virtual', label: 'Virtual Care', icon: Video, roles: ['admin', 'clinician', 'receptionist', 'patient'] },
    { id: 'patient-portal', label: 'My Health Portal', icon: FileText, roles: ['patient', 'admin'] },
    { id: 'audit', label: 'Audit History', icon: ShieldCheck, roles: ['admin'] }
  ]

  const visibleNav = navItems.filter(
    (item) => item.roles.includes('*') || item.roles.includes(role)
  )
  const filters = GLOBAL_LIST_FILTER_SCREENS[currentScreen] && (
    <ListFilters
      screen={currentScreen}
      value={listFilters}
      showSearch={GLOBAL_LIST_FILTER_SCREENS[currentScreen].search}
      onApply={applyListFilters}
    />
  )

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="brand">
          <img src="/logo.png" alt="OmniTeckno" onError={(e) => { e.target.style.display = 'none' }} />
          <div className="brand-text">
            <strong>OmniHealth</strong>
          </div>
        </div>

        <nav>
          {visibleNav.map((item) => {
            const Icon = item.icon
            const isActive = currentScreen === item.id
            return (
              <button
                key={item.id}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  navigateTo(item.id)
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
      {mobileMenuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation menu"
        />
      )}

      {/* Main Content Area */}
      <main>
        <header className={`topbar${mobileMenuOpen ? ' menu-open' : ''}`}>
          <button
            className="menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy)' }}>
            OmniHealth
          </div>
        </header>

        <div className="content" key={`${currentScreen}-${listFilters.search}-${listFilters.date}`}>
          {currentScreen === 'dashboard' && <Dashboard me={me} onNavigate={navigateTo} listFilters={filters} filterValues={listFilters} />}
          {currentScreen === 'opd' && (
            selectedConsultationPatient ? (
              <DoctorConsultation
                patient={selectedConsultationPatient}
                me={me}
                onBack={() => {
                  localStorage.setItem('oh_active_screen', 'opd')
                  setSelectedConsultationPatient(null)
                }}
              />
            ) : (
              <OPDQueue
                me={me}
                listFilters={filters}
                onSelectConsultation={(pt) => {
                  localStorage.setItem('oh_active_screen', 'doctor-consultation')
                  setSelectedConsultationPatient(pt)
                }}
              />
            )
          )}
          {currentScreen === 'consultants' && <Consultants me={me} listFilters={filters} />}
          {currentScreen === 'users' && <ManageUsers me={me} />}
          {currentScreen === 'profile' && me && <Profile me={me} onUpdate={(user) => {
            setMe(user)
            localStorage.setItem('oh_user', JSON.stringify(user))
          }} onPasswordChanged={() => {
            setLoginMessage('Password changed. Sign in with your new password.')
            handleLogout()
          }} />}
          {currentScreen === 'patients' && <Patients me={me} onNavigate={navigateTo} listFilters={filters} />}
          {currentScreen === 'appointments' && <Appointments me={me} onNavigate={navigateTo} />}
          {currentScreen === 'triage' && <Triage me={me} onNavigate={navigateTo} listFilters={filters} />}
          {currentScreen === 'encounters' && <Encounters me={me} onNavigate={navigateTo} listFilters={filters} />}
          {currentScreen === 'messages' && <ClinicianMessages me={me} />}
          {currentScreen === 'laboratory' && <Laboratory me={me} />}
          {currentScreen === 'lab-tests' && <LabTests />}
          {currentScreen === 'pharmacy' && <Pharmacy me={me} />}
          {currentScreen === 'medications' && <Medications />}
          {currentScreen === 'referrals' && <Referrals me={me} listFilters={filters} />}
          {currentScreen === 'inpatients' && (
            <Inpatients me={me} onNavigate={navigateTo} listFilters={filters} />
          )}
          {currentScreen === 'wards' && <WardBoard me={me} />}
          {currentScreen === 'billing' && <Billing me={me} listFilters={filters} />}
          {currentScreen === 'follow-ups' && <FollowUps me={me} listFilters={filters} />}
          {currentScreen === 'virtual' && <VirtualCare me={me} />}
          {currentScreen === 'patient-portal' && <PatientPortal me={me} listFilters={filters} />}
          {currentScreen === 'audit' && <AuditHistory me={me} listFilters={filters} />}
        </div>
      </main>
    </div>
  )
}

function LoginView({ onLogin, initialMessage }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [changeToken, setChangeToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Registration state
  const [regForm, setRegForm] = useState({
    username: '',
    password: '',
    first_name: '',
    last_name: '',
    date_of_birth: '',
    sex: '',
    email: '',
    phone: '',
    allergies: ''
  })
  const [regSuccess, setRegSuccess] = useState(initialMessage || '')

  async function handleLoginSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await login(username, password)
      if (res.data.password_change_token) {
        setChangeToken(res.data.password_change_token)
        setPassword('')
        return
      }
      const token = res.data.access
      localStorage.setItem('oh_token', token)
      const meRes = await getMe()
      onLogin(token, meRes.data)
    } catch (requestError) {
      localStorage.removeItem('oh_token')
      if (requestError.response?.status === 401) {
        setError(requestError.response?.data?.detail || 'Invalid username or password.')
      } else if (!requestError.response) {
        setError('Unable to reach the sign-in service. Check your connection and try again.')
      } else {
        setError('Sign-in is temporarily unavailable. Please try again or contact your administrator.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleInitialPassword(e) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await changeInitialPassword(changeToken, newPassword)
      setChangeToken('')
      setNewPassword('')
      setConfirmPassword('')
      setRegSuccess('Password changed. Sign in with your new password.')
    } catch (requestError) {
      const data = requestError.response?.data
      setError(data?.password?.join(' ') || data?.detail || 'Unable to change password.')
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
      setRegSuccess('Account created.')
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

  const authTabs = (
    <div className="vc-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={!showRegister} className={!showRegister ? 'active' : ''} onClick={() => { setShowRegister(false); setError('') }}>Sign in</button>
      <button type="button" role="tab" aria-selected={showRegister} className={showRegister ? 'active' : ''} onClick={() => { setShowRegister(true); setError('') }}>New patient</button>
    </div>
  )

  return (
    <div className="login-page">
      <div className="login-form-panel">
        <div className="auth-card">
          <div className="login-brand">
            <div className="login-logo">
              <img src="/logo.png" alt="OmniTeckno" />
            </div>
            <h1>OmniHealth</h1>
            <p>Care connected, every step of the way.</p>
          </div>

          {changeToken ? (
            <div className="panel auth-panel">
              <h2>Choose a new password</h2>
              <p>Change your temporary password before accessing your account.</p>
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <form onSubmit={handleInitialPassword}>
                <div className="form-group">
                  <label htmlFor="initial-password">New password</label>
                  <input id="initial-password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="initial-confirm">Confirm new password</label>
                  <input id="initial-confirm" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
                <button className="btn btn-primary login-submit" type="submit" disabled={loading}>Change password</button>
                <button className="btn btn-secondary login-submit" type="button" onClick={() => { setChangeToken(''); setError(''); setNewPassword(''); setConfirmPassword('') }}>Back to sign in</button>
              </form>
            </div>
          ) : !showRegister ? (
            <div className="panel auth-panel">
              <h2>Sign in</h2>
              {authTabs}
              {error && <div className="alert alert-error">{error}</div>}
              {regSuccess && <div className="alert alert-success">{regSuccess}</div>}

              <form onSubmit={handleLoginSubmit}>
                <div className="form-group">
                  <label htmlFor="login-username">Username</label>
                  <input
                    id="login-username"
                    type="text"
                    required
                    autoComplete="username"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="login-password">Password</label>
                  <div className="password-input-wrap">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary login-submit"
                  disabled={loading}
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
              <div className="auth-switch">
                <span>Remote consultation?</span>
                <button type="button" onClick={() => { window.location.href = '/virtual-care' }}>Virtual Care</button>
              </div>
            </div>
          ) : (
            <div className="panel auth-panel">
              <h2>Create account</h2>
              {authTabs}

              {error && <div className="alert alert-error">{error}</div>}

              <form onSubmit={handleRegisterSubmit}>
                <div className="form-row">
                  <div className="form-group">
                    <label>First Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Amina"
                      value={regForm.first_name}
                      onChange={(e) => setRegForm({ ...regForm, first_name: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Last Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Hassan"
                      value={regForm.last_name}
                      onChange={(e) => setRegForm({ ...regForm, last_name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="register-username">Username *</label>
                    <input
                      id="register-username"
                      type="text"
                      required
                      placeholder="Choose a username"
                      value={regForm.username}
                      onChange={(e) => setRegForm({ ...regForm, username: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="register-date-of-birth">Date of Birth *</label>
                    <input
                      id="register-date-of-birth"
                      type="date"
                      required
                      placeholder="Select date of birth"
                      value={regForm.date_of_birth}
                      onChange={(e) => setRegForm({ ...regForm, date_of_birth: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="register-sex">Sex *</label>
                    <select
                      id="register-sex"
                      required
                      value={regForm.sex}
                      onChange={(e) => setRegForm({ ...regForm, sex: e.target.value })}
                    >
                      <option value="">Select sex</option>
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                      <option value="Other">Other / Non-binary</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="register-phone">Phone *</label>
                    <input
                      id="register-phone"
                      type="tel"
                      required
                      placeholder="e.g. 0612345678"
                      value={regForm.phone}
                      onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Email Address</label>
                    <input
                      type="email"
                      placeholder="e.g. name@example.com"
                      value={regForm.email}
                      onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="register-password">Password *</label>
                    <input
                      id="register-password"
                      type="password"
                      required
                      autoComplete="new-password"
                      placeholder="Create a password"
                      value={regForm.password}
                      onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ marginTop: '16px' }}>
                  <button
                    type="submit"
                    className="btn btn-primary login-submit"
                    disabled={loading}
                  >
                    {loading ? 'Creating...' : 'Create account'}
                  </button>
                </div>
              </form>
              <div className="auth-switch">
                <span>Remote consultation?</span>
                <button type="button" onClick={() => { window.location.href = '/virtual-care' }}>Virtual Care</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

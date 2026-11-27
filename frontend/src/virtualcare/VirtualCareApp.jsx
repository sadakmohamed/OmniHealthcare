import React, { useCallback, useEffect, useState } from 'react'
import {
  CalendarClock, Eye, EyeOff, HeartPulse, LayoutDashboard, LogOut, Lock, Menu, Plus, Search,
  ShieldCheck, Stethoscope, UserCog, UserRound, Users, Video, X
} from 'lucide-react'
import {
  VC_TOKEN_KEY, VC_USER_KEY, bootstrapVirtualCare, createVirtualCareAccount,
  getVirtualCareDirectory, getVirtualCareStatus, getVirtualSessions,
  updateVirtualCareAccount, updateVirtualCareProfile, virtualCareLogin, virtualCareRegister
} from '../api'
import VirtualCare from '../screens/VirtualCare'
import './virtualcare.css'

const ROLE_LABELS = { admin: 'Administrator', clinician: 'Doctor', patient: 'Patient', receptionist: 'Receptionist' }

function errorText(error, fallback) {
  const data = error.response?.data
  if (!error.response) return 'Cannot reach Virtual Care. Make sure its service is running.'
  if (typeof data?.detail === 'string') return data.detail
  if (data && typeof data === 'object') {
    const first = Object.values(data)[0]
    return Array.isArray(first) ? first[0] : String(first)
  }
  return fallback
}

function storedUser() {
  try {
    const raw = localStorage.getItem(VC_USER_KEY)
    return raw && localStorage.getItem(VC_TOKEN_KEY) ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function clearSession() {
  localStorage.removeItem(VC_TOKEN_KEY)
  localStorage.removeItem(VC_USER_KEY)
}

export default function VirtualCareApp() {
  const [user, setUser] = useState(storedUser)

  useEffect(() => {
    const handler = () => setUser(null)
    window.addEventListener('vc-signed-out', handler)
    return () => window.removeEventListener('vc-signed-out', handler)
  }, [])

  function handleSignedIn(access, signedInUser) {
    localStorage.setItem(VC_TOKEN_KEY, access)
    localStorage.setItem(VC_USER_KEY, JSON.stringify(signedInUser))
    setUser(signedInUser)
  }

  function handleProfileUpdated(updated) {
    const merged = { ...user, ...updated }
    localStorage.setItem(VC_USER_KEY, JSON.stringify(merged))
    setUser(merged)
  }

  if (!user) return <AuthScreen onSignedIn={handleSignedIn} />
  return <Shell user={user} onSignOut={() => { clearSession(); setUser(null) }} onProfileUpdated={handleProfileUpdated} />
}

function AuthScreen({ onSignedIn }) {
  const [status, setStatus] = useState(null)
  const [mode, setMode] = useState('login')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ organization: '', username: '', password: '', display_name: '', phone: '', bootstrap_key: '' })

  useEffect(() => {
    getVirtualCareStatus()
      .then((response) => {
        setStatus(response.data)
        if (!response.data.initialized) setMode('setup')
      })
      .catch((requestError) => setError(errorText(requestError, 'Virtual Care is unavailable.')))
  }, [])

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  const needsOrganization = mode === 'setup' || status?.needs_organization

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const organization = form.organization.trim()
    try {
      let response
      if (mode === 'setup') {
        response = await bootstrapVirtualCare({
          bootstrap_key: form.bootstrap_key, organization, username: form.username,
          display_name: form.display_name, password: form.password
        })
      } else if (mode === 'register') {
        response = await virtualCareRegister({
          organization, username: form.username, display_name: form.display_name,
          phone: form.phone, password: form.password
        })
      } else {
        response = await virtualCareLogin({ organization, username: form.username, password: form.password })
      }
      onSignedIn(response.data.access, response.data.user)
    } catch (requestError) {
      setError(errorText(requestError, 'Unable to continue. Check your details and try again.'))
    } finally {
      setLoading(false)
    }
  }

  const titles = {
    login: ['Welcome back', 'Sign in as an administrator, doctor or patient.'],
    register: ['Create patient account', 'Register to book and join video visits.'],
    setup: ['First-time setup', 'Create the organization and its administrator.']
  }

  return (
    <div className="login-page">
      <div className="login-form-panel">
        <div className="auth-card">
          <div className="login-brand">
            <div className="login-logo"><img src="/logo.png" alt="OmniHealth" /></div>
            <h1>OmniHealth</h1>
            <p>Virtual Care</p>
          </div>
          <div className="panel auth-panel">
        <form onSubmit={submit}>
          <h2>{titles[mode][0]}</h2>
          <p className="vc-muted">{titles[mode][1]}</p>

          {mode !== 'setup' && status?.initialized && (
            <div className="vc-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button>
              <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>New patient</button>
            </div>
          )}

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          {mode === 'setup' && (
            <div className="form-group">
              <label htmlFor="vc-key">Setup key</label>
              <input id="vc-key" type="password" required placeholder="Enter the setup key" value={form.bootstrap_key} onChange={set('bootstrap_key')} />
            </div>
          )}
          {needsOrganization && (
            <div className="form-group">
              <label htmlFor="vc-org">Organization code</label>
              <input id="vc-org" required value={form.organization} onChange={set('organization')} placeholder="e.g. my-clinic" />
            </div>
          )}
          {(mode === 'register' || mode === 'setup') && (
            <div className="form-group">
              <label htmlFor="vc-name">{mode === 'setup' ? 'Administrator name' : 'Full name'}</label>
              <input id="vc-name" required placeholder={mode === 'setup' ? 'e.g. Clinic Administrator' : 'e.g. Amina Hassan'} value={form.display_name} onChange={set('display_name')} />
            </div>
          )}
          {mode === 'register' && (
            <div className="form-group">
              <label htmlFor="vc-phone">Phone</label>
              <input id="vc-phone" type="tel" placeholder="e.g. 0612345678" value={form.phone} onChange={set('phone')} />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="vc-username">Username</label>
            <input id="vc-username" required autoComplete="username" placeholder={mode === 'login' ? 'Enter your username' : 'Choose a username'} value={form.username} onChange={set('username')} />
          </div>
          <div className="form-group">
            <label htmlFor="vc-password">Password</label>
            <div className="password-input-wrap">
              <input
                id="vc-password" required minLength={mode === 'login' ? undefined : 8}
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={form.password} onChange={set('password')}
                placeholder={mode === 'login' ? 'Enter your password' : 'At least 8 characters'}
              />
              <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            {mode !== 'login' && <small className="form-hint">            Use at least 8 characters.</small>}
          </div>

          <button className="btn btn-primary login-submit" type="submit" disabled={loading || (!status && !error)}>
            <Lock size={16} />
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Create organization'}
          </button>

          {status && !status.initialized && status.setup_enabled === false && (
            <p className="vc-muted">Setup is disabled. Set VIRTUALCARE_BOOTSTRAP_KEY on the service first.</p>
          )}
        </form>
          <div className="auth-switch">
            <span>Hospital staff or patient?</span>
            <button type="button" onClick={() => { window.location.href = '/' }}>Back to hospital login</button>
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function navFor(role) {
  const base = [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }]
  const visits = { id: 'visits', label: role === 'admin' ? 'All visits' : 'My visits', icon: Video }
  const profile = { id: 'profile', label: 'My profile', icon: UserRound }
  if (role === 'admin') {
    return [
      ...base, visits,
      { id: 'doctors', label: 'Doctors', icon: Stethoscope },
      { id: 'patients', label: 'Patients', icon: Users },
      { id: 'staff', label: 'Administrators', icon: UserCog },
      profile
    ]
  }
  return [...base, visits, profile]
}

function Shell({ user, onSignOut, onProfileUpdated }) {
  const [page, setPage] = useState('overview')
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="vc-shell">
      {menuOpen && <div className="vc-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`vc-sidebar${menuOpen ? ' open' : ''}`}>
        <div className="vc-sidebar-brand">
          <img src="/logo.png" alt="OmniHealth" />
          <span>Virtual Care</span>
          <button className="vc-sidebar-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <nav>
          {navFor(user.role).map((item) => (
            <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setMenuOpen(false) }}>
              <item.icon size={18} /> {item.label}
            </button>
          ))}
        </nav>
        <button className="vc-signout" onClick={onSignOut}><LogOut size={18} /> Sign out</button>
      </aside>

      <div className="vc-main">
        <header className="vc-topbar">
          <button className="vc-menu-btn" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={22} /></button>
          <div className="vc-org-chip"><ShieldCheck size={14} /> {user.organization_id || 'Virtual Care'}</div>
          <div className="vc-user">
            <div className="vc-avatar">{(user.display_name || '?').slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{user.display_name}</strong>
              <span className={`vc-role vc-role-${user.role}`}>{ROLE_LABELS[user.role] || user.role}</span>
            </div>
          </div>
        </header>

        <div className="vc-content">
          {page === 'overview' && <Overview user={user} onNavigate={setPage} />}
          {page === 'visits' && <VirtualCare me={user} standalone />}
          {page === 'doctors' && <AccountsPage key="doctors" me={user} kind="doctors" />}
          {page === 'patients' && <AccountsPage key="patients" me={user} kind="patients" />}
          {page === 'staff' && <AccountsPage key="staff" me={user} kind="staff" />}
          {page === 'profile' && <Profile user={user} onUpdated={onProfileUpdated} />}
        </div>
      </div>
    </div>
  )
}

function Overview({ user, onNavigate }) {
  const [sessions, setSessions] = useState([])
  const [directory, setDirectory] = useState({ accounts: [], clinicians: [] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getVirtualSessions({}), getVirtualCareDirectory()])
      .then(([visitResponse, directoryResponse]) => {
        setSessions(visitResponse.data?.results || visitResponse.data || [])
        setDirectory(directoryResponse.data)
      })
      .catch((requestError) => setError(errorText(requestError, 'Unable to load the overview.')))
      .finally(() => setLoading(false))
  }, [])

  const today = new Date().toDateString()
  const todays = sessions.filter((visit) => new Date(visit.scheduled_at).toDateString() === today)
  const count = (statuses) => sessions.filter((visit) => statuses.includes(visit.status)).length
  const accounts = directory.accounts || []
  const upcoming = sessions
    .filter((visit) => ['booked', 'intake', 'waiting', 'consulting', 'interrupted'].includes(visit.status))
    .slice(0, 6)

  const cards = user.role === 'admin'
    ? [
        ['Active doctors', accounts.filter((a) => a.role === 'clinician' && a.is_active).length, Stethoscope, 'cyan'],
        ['Active patients', accounts.filter((a) => a.role === 'patient' && a.is_active).length, Users, 'blue'],
        ['Inactive accounts', accounts.filter((a) => !a.is_active).length, Lock, 'red'],
        ['Visits today', todays.length, CalendarClock, 'amber']
      ]
    : [
        ['Today', todays.length, CalendarClock, 'blue'],
        ['Upcoming', count(['booked', 'intake']), Video, 'cyan'],
        [user.role === 'clinician' ? 'In my queue' : 'Waiting / live', count(['waiting', 'consulting', 'interrupted']), HeartPulse, 'amber'],
        ['Completed', count(['completed']), ShieldCheck, 'green']
      ]

  return (
    <>
      <div className="vc-hero-banner">
        <div>
          <h1>Welcome, {user.display_name}</h1>
          <p>
            {user.role === 'admin' && 'Manage doctors, patients and every visit across your Virtual Care organization.'}
            {user.role === 'clinician' && 'Your waiting patients and scheduled consultations are below.'}
            {user.role === 'patient' && 'Book a visit with a doctor, give consent, and join when you are called.'}
          </p>
        </div>
        <div className="vc-hero-actions">
          {user.role === 'admin' && (
            <>
              <button className="btn btn-primary" onClick={() => onNavigate('doctors')}><Plus size={16} /> Add doctor</button>
              <button className="btn btn-secondary" onClick={() => onNavigate('patients')}><Plus size={16} /> Add patient</button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => onNavigate('visits')}>
            <Video size={16} /> {user.role === 'patient' ? 'Book a visit' : user.role === 'clinician' ? 'Open my queue' : 'Visits'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="stat-grid">
        {cards.map(([label, value, Icon, tone]) => (
          <div className="stat-card" key={label}>
            <div className={`stat-icon ${tone}`}><Icon size={22} /></div>
            <div><div className="stat-label">{label}</div><div className="stat-value">{loading ? '–' : value}</div></div>
          </div>
        ))}
      </div>

      <div className="vc-grid-2">
        <section className="panel">
          <div className="panel-header"><h3>Upcoming and active visits</h3></div>
          {upcoming.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>When</th><th>{user.role === 'patient' ? 'Doctor' : 'Patient'}</th><th>Status</th></tr></thead>
                <tbody>
                  {upcoming.map((visit) => (
                    <tr key={visit.id}>
                      <td>{new Date(visit.scheduled_at).toLocaleString()}</td>
                      <td>{user.role === 'patient' ? visit.clinician_name : visit.patient_name}</td>
                      <td><span className={`badge badge-${visit.status}`}>{visit.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-state">No upcoming visits.</div>}
        </section>

        <section className="panel">
          <div className="panel-header"><h3>{user.role === 'admin' ? 'Newest accounts' : 'Doctors available'}</h3></div>
          <div className="vc-list">
            {user.role === 'admin'
              ? [...accounts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6).map((account) => (
                  <div className="vc-list-row" key={account.id}>
                    <div className="vc-avatar sm">{account.display_name.slice(0, 1).toUpperCase()}</div>
                    <div><strong>{account.display_name}</strong><small>{ROLE_LABELS[account.role]} · {account.username}</small></div>
                    <span className={`badge ${account.is_active ? 'badge-active' : 'badge-red'}`}>{account.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                ))
              : (directory.clinicians || []).slice(0, 6).map((doctor) => (
                  <div className="vc-list-row" key={doctor.id}>
                    <div className="vc-avatar sm"><Stethoscope size={14} /></div>
                    <div><strong>{doctor.name}</strong><small>{doctor.specialty}</small></div>
                  </div>
                ))}
            {user.role !== 'admin' && !(directory.clinicians || []).length && <div className="empty-state">No doctors yet.</div>}
          </div>
        </section>
      </div>
    </>
  )
}

const KINDS = {
  doctors: { title: 'Doctors', singular: 'doctor', roles: ['clinician'] },
  patients: { title: 'Patients', singular: 'patient', roles: ['patient'] },
  staff: { title: 'Administrators & reception', singular: 'staff member', roles: ['admin', 'receptionist'] }
}

function AccountsPage({ me, kind }) {
  const config = KINDS[kind]
  const [accounts, setAccounts] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await getVirtualCareDirectory()
      setAccounts(response.data.accounts || [])
    } catch (requestError) {
      setError(errorText(requestError, 'Unable to load accounts.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function change(account, data, message) {
    setError('')
    setSuccess('')
    try {
      await updateVirtualCareAccount(account.id, data)
      setSuccess(message)
      await load()
    } catch (requestError) {
      setError(errorText(requestError, 'Unable to update the account.'))
    }
  }

  function resetPassword(account) {
    const password = window.prompt(`New password for ${account.username}     (at least 8 characters)`)
    if (!password) return
        if (password.length < 8) {
          setError('Password must be at least 8 characters.')
      return
    }
    change(account, { password }, `Password reset for ${account.display_name}. Share it securely.`)
  }

  const total = accounts.filter((account) => config.roles.includes(account.role))
  const visible = total.filter((account) => (
    (!statusFilter || (statusFilter === 'active') === account.is_active) &&
    `${account.display_name} ${account.username} ${account.specialty || ''} ${account.phone || ''}`.toLowerCase().includes(search.trim().toLowerCase())
  ))

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{config.title}</h1>
          <p className="form-hint">{total.filter((a) => a.is_active).length} active · {total.filter((a) => !a.is_active).length} inactive</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Add {config.singular}</button>
        </div>
      </div>

      {error && <div className="alert alert-error"><div style={{ flex: 1 }}>{error}</div><button className="alert-close" onClick={() => setError('')}>&times;</button></div>}
      {success && <div className="alert alert-success"><div style={{ flex: 1 }}>{success}</div><button className="alert-close" onClick={() => setSuccess('')}>&times;</button></div>}

      <div className="toolbar">
        <label className="toolbar-search"><Search size={16} />
          <input type="search" placeholder={`Search ${config.title.toLowerCase()}`} value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <select className="filter-select" aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="panel">
        {loading ? <div className="empty-state">Loading…</div> : visible.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th><th>Username</th>
                  {kind === 'doctors' && <th>Specialty</th>}
                  {kind === 'staff' && <th>Role</th>}
                  <th>Phone</th><th>Status</th><th>Created</th><th />
                </tr>
              </thead>
              <tbody>
                {visible.map((account) => (
                  <tr key={account.id} className={account.is_active ? '' : 'vc-row-inactive'}>
                    <td><div className="vc-name-cell"><div className="vc-avatar sm">{account.display_name.slice(0, 1).toUpperCase()}</div><strong>{account.display_name}</strong></div></td>
                    <td>{account.username}</td>
                    {kind === 'doctors' && <td>{account.specialty || '—'}</td>}
                    {kind === 'staff' && <td>{ROLE_LABELS[account.role]}</td>}
                    <td>{account.phone || '—'}</td>
                    <td><span className={`badge ${account.is_active ? 'badge-active' : 'badge-red'}`}>{account.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>{new Date(account.created_at).toLocaleDateString()}</td>
                    <td className="vc-actions">
                      <button className="btn btn-secondary btn-xs" onClick={() => setEditing(account)}>Edit</button>
                      <button className="btn btn-secondary btn-xs" onClick={() => resetPassword(account)}>Reset password</button>
                      {account.id !== me.id && (
                        <button
                          className={`btn btn-xs ${account.is_active ? 'btn-danger' : 'btn-success'}`}
                          onClick={() => change(account, { is_active: !account.is_active }, account.is_active ? `${account.display_name} inactivated.` : `${account.display_name} reactivated.`)}
                        >
                          {account.is_active ? 'Inactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state"><strong>No {config.title.toLowerCase()} found</strong><p>Add one with the button above.</p></div>}
      </div>

      {creating && (
        <AccountModal
          title={`Add ${config.singular}`} kind={kind} roles={config.roles}
          onClose={() => setCreating(false)}
          onSaved={async (message) => { setCreating(false); setSuccess(message); await load() }}
        />
      )}
      {editing && (
        <AccountModal
          title={`Edit ${editing.display_name}`} kind={kind} account={editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => { setEditing(null); setSuccess(message); await load() }}
        />
      )}
    </>
  )
}

function AccountModal({ title, kind, account, roles, onClose, onSaved }) {
  const [form, setForm] = useState({
    role: account?.role || roles?.[0] || 'patient',
    display_name: account?.display_name || '',
    username: account?.username || '',
    specialty: account?.specialty || '',
    phone: account?.phone || '',
    password: ''
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  const isDoctor = form.role === 'clinician'

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (account) {
        await updateVirtualCareAccount(account.id, {
          display_name: form.display_name, username: form.username, phone: form.phone,
          ...(isDoctor ? { specialty: form.specialty } : {})
        })
        await onSaved('Account updated.')
      } else {
        await createVirtualCareAccount({ ...form, specialty: isDoctor ? form.specialty : '' })
        await onSaved(`${form.display_name} was created. Share the temporary password securely.`)
      }
    } catch (requestError) {
      setError(errorText(requestError, 'Unable to save the account.'))
      setSaving(false)
    }
  }

  const roleIcon = { clinician: Stethoscope, patient: Users, admin: UserCog, receptionist: UserCog }[form.role] || UserRound
  const RoleIcon = roleIcon

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal vc-modal" onClick={(event) => event.stopPropagation()}>
        <div className="vc-modal-head">
          <div className="vc-modal-icon"><RoleIcon size={22} /></div>
          <div>
            <h3>{title}</h3>
            <p>{account ? 'Update the details below.' : 'Fill in the details to create the account.'}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <form className="vc-modal-body" onSubmit={submit}>
          {error && <div className="alert alert-error">{error}</div>}
          {!account && kind === 'staff' && (
            <div className="form-group">
              <label>Role</label>
              <select value={form.role} onChange={set('role')}>
                {roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
              </select>
            </div>
          )}
          <div className="form-group"><label>Full name *</label><input required placeholder={isDoctor ? 'e.g. Dr. Ahmed Ali' : 'e.g. Amina Hassan'} value={form.display_name} onChange={set('display_name')} /></div>
          <div className="form-row">
            <div className="form-group"><label>Username *</label><input required placeholder="e.g. amina.h" autoComplete="off" value={form.username} onChange={set('username')} /></div>
            <div className="form-group"><label>Phone</label><input type="tel" placeholder="e.g. 0612345678" value={form.phone} onChange={set('phone')} /></div>
          </div>
          {isDoctor && (
            <div className="form-group"><label>Specialty</label><input value={form.specialty} onChange={set('specialty')} placeholder="e.g. General practice, Cardiology" /></div>
          )}
          {!account && (
            <div className="form-group">
              <label>Temporary password *</label>
              <input type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" value={form.password} onChange={set('password')} />
              <small className="form-hint">Share it securely; they can change it from My profile.</small>
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : account ? 'Save changes' : 'Create account'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Profile({ user, onUpdated }) {
  const [form, setForm] = useState({ display_name: user.display_name || '', phone: user.phone || '' })
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' })
  const [message, setMessage] = useState({ type: '', text: '' })

  async function saveDetails(event) {
    event.preventDefault()
    try {
      const response = await updateVirtualCareProfile(form)
      onUpdated(response.data)
      setMessage({ type: 'success', text: 'Profile updated.' })
    } catch (requestError) {
      setMessage({ type: 'error', text: errorText(requestError, 'Unable to update your profile.') })
    }
  }

  async function savePassword(event) {
    event.preventDefault()
    try {
      await updateVirtualCareProfile(passwords)
      setPasswords({ current_password: '', new_password: '' })
      setMessage({ type: 'success', text: 'Password changed.' })
    } catch (requestError) {
      setMessage({ type: 'error', text: errorText(requestError, 'Unable to change the password.') })
    }
  }

  return (
    <>
      <div className="page-heading"><div><h1>My profile</h1><p className="form-hint">{ROLE_LABELS[user.role]} · {user.username}</p></div></div>
      {message.text && <div className={`alert alert-${message.type === 'error' ? 'error' : 'success'}`}>{message.text}</div>}
      <div className="vc-grid-2">
        <form className="panel" onSubmit={saveDetails}>
          <div className="panel-header"><h3>Details</h3></div>
          <div className="panel-body">
            <div className="form-group"><label>Full name</label>            <input required placeholder="Your full name" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></div>
                        <div className="form-group"><label>Phone</label><input type="tel" placeholder="e.g. 0612345678" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
            <button className="btn btn-primary">Save details</button>
          </div>
        </form>
        <form className="panel" onSubmit={savePassword}>
          <div className="panel-header"><h3>Change password</h3></div>
          <div className="panel-body">
            <div className="form-group"><label>Current password</label><input type="password" required autoComplete="current-password" placeholder="Enter your current password" value={passwords.current_password} onChange={(event) => setPasswords({ ...passwords, current_password: event.target.value })} /></div>
            <div className="form-group"><label>New password</label><input type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" value={passwords.new_password} onChange={(event) => setPasswords({ ...passwords, new_password: event.target.value })} /><small className="form-hint">At least 8 characters.</small></div>
            <button className="btn btn-primary">Change password</button>
          </div>
        </form>
      </div>
    </>
  )
}

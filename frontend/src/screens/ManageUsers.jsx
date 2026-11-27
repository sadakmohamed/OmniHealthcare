import React, { useEffect, useState } from 'react'
import { createUser, getPatients, getUsers, updateUser } from '../api'

const roles = ['receptionist', 'clinician', 'nurse', 'lab', 'pharmacist', 'billing', 'patient', 'admin']
const emptyForm = { username: '', first_name: '', last_name: '', email: '', role: 'receptionist', patient: '', password: '' }

function errorMessage(error) {
  const data = error.response?.data
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' | ')
  }
  return 'Unable to manage user accounts.'
}

export default function ManageUsers({ me }) {
  const [users, setUsers] = useState([])
  const [patients, setPatients] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const filteredUsers = users.filter((user) => {
    const query = search.trim().toLowerCase()
    const name = `${user.first_name} ${user.last_name}`.toLowerCase()
    return (!query || name.includes(query) || user.username.toLowerCase().includes(query))
      && (!roleFilter || user.role === roleFilter)
      && (!statusFilter || (statusFilter === 'active') === user.is_active)
  })

  async function load() {
    try {
      const usersResponse = await getUsers()
      const allPatients = []
      let page = 1
      let next = true
      while (next) {
        const response = await getPatients({ page })
        if (Array.isArray(response.data)) {
          allPatients.push(...response.data)
          next = false
        } else {
          allPatients.push(...response.data.results)
          next = Boolean(response.data.next)
          page += 1
        }
      }
      setUsers(usersResponse.data)
      setPatients(allPatients)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  useEffect(() => { load() }, [])

  async function save(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      const data = { ...form, patient: form.role === 'patient' ? form.patient : null }
      if (!data.password) delete data.password
      if (editing) await updateUser(editing.id, data)
      else await createUser(data)
      setEditing(null)
      setForm(emptyForm)
      setSuccess(editing ? 'Account updated.' : 'Account created.')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(user) {
    setError('')
    setSuccess('')
    try {
      await updateUser(user.id, { is_active: !user.is_active })
      setSuccess(`Account ${user.is_active ? 'inactivated' : 'activated'}.`)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  function edit(user) {
    setEditing(user)
    setForm({ username: user.username, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role, patient: user.patient || '', password: '' })
  }

  return (
    <div>
      <div className="page-heading"><h1>User Accounts</h1></div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success" role="status">{success}</div>}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h3>{editing ? 'Edit account' : 'Create account'}</h3></div>
        <form className="panel-body" onSubmit={save}>
          <div className="form-row">
            <div className="form-group"><label htmlFor="account-username">Username</label><input id="account-username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="account-role">Role</label><select id="account-role" disabled={Boolean(editing)} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, patient: '' })}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="account-first">First name</label><input id="account-first" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="account-last">Last name</label><input id="account-last" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="account-email">Email</label><input id="account-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="account-password">{editing ? 'New password (optional)' : 'Password'}</label><input id="account-password" type="password" autoComplete="new-password" required={!editing} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          </div>
          {form.role === 'patient' && <div className="form-group"><label htmlFor="account-patient">Patient</label><select id="account-patient" required disabled={Boolean(editing)} value={form.patient} onChange={(e) => setForm({ ...form, patient: e.target.value })}><option value="">Select a patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name} ({patient.medical_record_number})</option>)}</select></div>}
          <button type="submit" className="btn btn-primary" disabled={busy}>{editing ? 'Save changes' : 'Create account'}</button>{' '}
          {editing && <button type="button" className="btn btn-secondary" onClick={() => { setEditing(null); setForm(emptyForm) }}>Cancel</button>}
        </form>
      </div>
      <div className="panel"><div className="panel-header"><h3>Accounts</h3></div><div className="panel-body table-wrap">
        <div className="form-row">
          <div className="form-group"><label htmlFor="users-search">Search name or username</label><input id="users-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="form-group"><label htmlFor="users-role-filter">Role</label><select id="users-role-filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="">All roles</option>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></div>
          <div className="form-group"><label htmlFor="users-status-filter">Status</label><select id="users-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        </div>
        <table className="data-table"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {filteredUsers.map((user) => <tr key={user.id}><td>{user.username}</td><td>{user.first_name} {user.last_name}</td><td>{user.role}</td><td>{user.is_active ? 'Active' : 'Inactive'}</td><td>
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => edit(user)}>Edit</button>{' '}
            <button type="button" className="btn btn-secondary btn-xs" disabled={user.id === me?.id} onClick={() => toggle(user)}>{user.is_active ? 'Inactivate' : 'Activate'}</button>
          </td></tr>)}
          {filteredUsers.length === 0 && <tr><td colSpan="5">No accounts match your filters.</td></tr>}
        </tbody></table>
      </div></div>
    </div>
  )
}

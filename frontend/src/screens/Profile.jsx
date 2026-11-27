import React, { useState } from 'react'
import { changePassword, updateMe } from '../api'

export default function Profile({ me, onUpdate, onPasswordChanged }) {
  const [form, setForm] = useState(() => ({
    first_name: me.first_name || '', last_name: me.last_name || '', email: me.email || ''
  }))
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [passwordError, setPasswordError] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)

  async function save(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      const response = await updateMe(form)
      onUpdate(response.data)
      setSuccess('Profile updated.')
    } catch (err) {
      const data = err.response?.data
      setError(data?.detail || (data ? JSON.stringify(data) : 'Unable to update profile.'))
    } finally {
      setBusy(false)
    }
  }

  async function savePassword(event) {
    event.preventDefault()
    setPasswordError('')
    if (passwords.next !== passwords.confirm) {
      setPasswordError('New passwords do not match.')
      return
    }
    setPasswordBusy(true)
    try {
      await changePassword(passwords.current, passwords.next)
      onPasswordChanged()
    } catch (err) {
      const data = err.response?.data
      setPasswordError(data?.current_password?.join(' ') || data?.new_password?.join(' ') || data?.detail || 'Unable to change password.')
    } finally {
      setPasswordBusy(false)
    }
  }

  return (
    <div>
      <div className="page-heading"><h1>My Profile</h1></div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success" role="status">{success}</div>}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h3>Account details</h3></div>
        <form className="panel-body" onSubmit={save}>
          <div className="form-row">
            <div className="form-group"><label htmlFor="profile-username">Username</label><input id="profile-username" value={me.username} readOnly /></div>
            <div className="form-group"><label htmlFor="profile-role">Role</label><input id="profile-role" value={me.role} readOnly /></div>
          </div>
          <div className="form-group">
            <label htmlFor="profile-first-name">First name</label>
            <input id="profile-first-name" maxLength={150} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="profile-last-name">Last name</label>
            <input id="profile-last-name" maxLength={150} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="profile-email">Email</label>
            <input id="profile-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Save profile</button>
        </form>
      </div>
      <div className="panel">
        <div className="panel-header"><h3>Change password</h3></div>
        <form className="panel-body" onSubmit={savePassword}>
          <p>For security, changing your password signs you out on all devices.</p>
          {passwordError && <div className="alert alert-error" role="alert">{passwordError}</div>}
          <div className="form-group"><label htmlFor="profile-current-password">Current password</label><input id="profile-current-password" type="password" autoComplete="current-password" required value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} /></div>
          <div className="form-group"><label htmlFor="profile-new-password">New password</label><input id="profile-new-password" type="password" autoComplete="new-password" minLength={8} required value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} /></div>
          <div className="form-group"><label htmlFor="profile-confirm-password">Confirm new password</label><input id="profile-confirm-password" type="password" autoComplete="new-password" minLength={8} required value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} /></div>
          <button type="submit" className="btn btn-primary" disabled={passwordBusy}>Change password</button>
        </form>
      </div>
    </div>
  )
}

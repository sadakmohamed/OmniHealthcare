import React, { useEffect, useState } from 'react'
import { createMedication, getMedications, updateMedication } from '../api'

const emptyForm = { name: '', description: '' }

function message(error) {
  const data = error.response?.data
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' | ')
  }
  return 'Unable to save the medication.'
}

export default function Medications() {
  const [medications, setMedications] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const response = await getMedications()
      setMedications(response.data)
    } catch (err) {
      setError(message(err))
    }
  }

  useEffect(() => {
    getMedications()
      .then((response) => setMedications(response.data))
      .catch((err) => setError(message(err)))
  }, [])

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      if (editing) await updateMedication(editing.id, form)
      else await createMedication(form)
      setForm(emptyForm)
      setEditing(null)
      setSuccess(editing ? 'Medication updated.' : 'Medication created.')
      await load()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(medication) {
    setError('')
    setSuccess('')
    try {
      await updateMedication(medication.id, { active: !medication.active })
      setSuccess(`Medication ${medication.active ? 'inactivated' : 'activated'}.`)
      await load()
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <div>
      <div className="page-heading"><h1>Medication Catalog</h1></div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success" role="status">{success}</div>}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h3>{editing ? 'Edit medication' : 'Create medication'}</h3></div>
        <form className="panel-body" onSubmit={save}>
          <div className="form-group">
            <label htmlFor="medication-name">Name and strength</label>
            <input id="medication-name" required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="medication-description">Description</label>
            <textarea id="medication-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{editing ? 'Save changes' : 'Create medication'}</button>
          {editing && <button type="button" className="btn btn-secondary" onClick={() => { setEditing(null); setForm(emptyForm) }}>Cancel</button>}
        </form>
      </div>
      <div className="panel">
        <div className="panel-header"><h3>Medications</h3></div>
        <div className="panel-body table-wrap">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {medications.map((medication) => (
                <tr key={medication.id}>
                  <td>{medication.name}</td><td>{medication.description}</td><td>{medication.active ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => { setEditing(medication); setForm({ name: medication.name, description: medication.description }) }}>Edit</button>{' '}
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => toggle(medication)}>{medication.active ? 'Inactivate' : 'Activate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!medications.length && <p>No medications configured.</p>}
        </div>
      </div>
    </div>
  )
}

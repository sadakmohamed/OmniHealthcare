import React, { useEffect, useState } from 'react'
import { createLabTest, getLabTests, updateLabTest } from '../api'

const emptyForm = { name: '', price: '' }

function message(error) {
  const data = error.response?.data
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' | ')
  }
  return 'Unable to save the laboratory test.'
}

export default function LabTests() {
  const [tests, setTests] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const response = await getLabTests()
      setTests(response.data)
    } catch (err) {
      setError(message(err))
    }
  }

  useEffect(() => { load() }, [])

  async function save(event) {
    event.preventDefault()
    const cents = Math.round(Number(form.price) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter a price greater than zero.')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const data = { name: form.name, price_cents: cents }
      if (editing) await updateLabTest(editing.id, data)
      else await createLabTest(data)
      setForm(emptyForm)
      setEditing(null)
      setSuccess(editing ? 'Lab test updated.' : 'Lab test created.')
      await load()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(test) {
    setError('')
    setSuccess('')
    try {
      await updateLabTest(test.id, { active: !test.active })
      setSuccess(`Lab test ${test.active ? 'inactivated' : 'activated'}.`)
      await load()
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <div>
      <div className="page-heading"><h1>Lab Test Catalog</h1></div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success" role="status">{success}</div>}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h3>{editing ? 'Edit lab test' : 'Create lab test'}</h3></div>
        <form className="panel-body" onSubmit={save}>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="lab-test-name">Test name</label>
              <input id="lab-test-name" required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="lab-test-price">Price</label>
              <input id="lab-test-price" type="number" min="0.01" step="0.01" required value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{editing ? 'Save changes' : 'Create test'}</button>
          {editing && <button type="button" className="btn btn-secondary" onClick={() => { setEditing(null); setForm(emptyForm) }}>Cancel</button>}
        </form>
      </div>
      <div className="panel">
        <div className="panel-header"><h3>Tests</h3></div>
        <div className="panel-body table-wrap">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {tests.map((test) => (
                <tr key={test.id}>
                  <td>{test.name}</td><td>${(test.price_cents / 100).toFixed(2)}</td><td>{test.active ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => { setEditing(test); setForm({ name: test.name, price: (test.price_cents / 100).toFixed(2) }) }}>Edit</button>{' '}
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => toggle(test)}>{test.active ? 'Inactivate' : 'Activate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tests.length && <p>No lab tests configured.</p>}
        </div>
      </div>
    </div>
  )
}

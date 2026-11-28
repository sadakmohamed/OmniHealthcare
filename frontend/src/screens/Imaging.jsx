import React, { useState, useEffect } from 'react'
import { Plus, Edit, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { getImagingTests, createImagingTest, updateImagingTest, deleteImagingTest } from '../api'
import './Imaging.css'

export default function Imaging() {
  const [imaging, setImaging] = useState([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', price: '' })
  const [expandedId, setExpandedId] = useState(null)
  const [filters, setFilters] = useState({ search: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetchImaging()
  }, [])

  async function fetchImaging() {
    setLoading(true)
    setError('')
    try {
      const { data } = await getImagingTests()
      setImaging(data)
    } catch (err) {
      setError('Failed to fetch imaging tests')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.price) {
      setError('Please fill in all required fields')
      return
    }
    try {
      const price_cents = Math.round(parseFloat(form.price) * 100)
      if (!Number.isFinite(price_cents) || price_cents <= 0) {
        setError('Price must be greater than zero')
        return
      }
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        price_cents
      }
      if (editingId) {
        await updateImagingTest(editingId, payload)
        setSuccess('Imaging test updated')
      } else {
        await createImagingTest(payload)
        setSuccess('Imaging test created')
      }
      setForm({ name: '', description: '', price: '' })
      setEditingId(null)
      setShowForm(false)
      setError('')
      await fetchImaging()
    } catch (err) {
      const data = err.response?.data
      if (data && typeof data === 'object') {
        setError(Object.entries(data).map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' | '))
      } else {
        setError('Error saving imaging test')
      }
    }
  }

  async function handleDelete(id) {
    if (!confirm('Inactivate this imaging test?')) return
    try {
      await deleteImagingTest(id)
      setSuccess('Imaging test inactivated')
      setError('')
      await fetchImaging()
    } catch (err) {
      setError('Error deleting imaging test')
    }
  }

  function handleEdit(item) {
    setForm({
      name: item.name,
      description: item.description,
      price: (item.price_cents / 100).toFixed(2)
    })
    setEditingId(item.id)
    setShowForm(true)
    setError('')
  }

  const filtered = imaging.filter(
    (item) => !filters.search || item.name.toLowerCase().includes(filters.search.toLowerCase())
  )

  return (
    <div className="imaging-container">
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      
      <div className="imaging-header">
        <div>
          <h1>Imaging Test Catalog</h1>
          <p>Manage imaging tests and prices</p>
        </div>
        <button className="btn btn-primary" onClick={() => {
          setShowForm(!showForm)
          setEditingId(null)
          setForm({ name: '', description: '', price: '' })
          setError('')
        }}>
          <Plus size={16} />
          Add Imaging Test
        </button>
      </div>

      {showForm && (
        <div className="imaging-form-card">
          <h2>{editingId ? 'Edit' : 'New'} Imaging Test</h2>
          <form onSubmit={handleSubmit} className="form-row">
            <div className="form-group">
              <label>Test Name *</label>
              <input
                type="text"
                placeholder="e.g., Neck Ultrasound"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Price ($) *</label>
              <input
                type="number"
                placeholder="e.g., 100.00"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
                min="0.01"
                step="0.01"
              />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label>Description</label>
              <textarea
                placeholder="Describe this imaging test..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows="3"
              />
            </div>
            <div className="form-actions" style={{ gridColumn: 'span 2', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowForm(false)
                  setEditingId(null)
                  setForm({ name: '', description: '', price: '' })
                  setError('')
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingId ? 'Update' : 'Create'} Test
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="imaging-filter">
        <input
          type="text"
          placeholder="Search imaging tests..."
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          className="form-control"
        />
      </div>

      {loading ? (
        <div className="loading">Loading imaging tests...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>No imaging tests found</p>
        </div>
      ) : (
        <div className="imaging-list">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="imaging-card"
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
            >
              <div className="imaging-card-header">
                <div className="imaging-card-title">
                  <h3>{item.name}</h3>
                  <span className="imaging-price">${(item.price_cents / 100).toFixed(2)}</span>
                </div>
                <div className="imaging-card-actions">
                  <button
                    className="btn-icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEdit(item)
                    }}
                    title="Edit"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    className="btn-icon btn-danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(item.id)
                    }}
                    title="Inactivate"
                  >
                    <Trash2 size={16} />
                  </button>
                  {expandedId === item.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>
              {expandedId === item.id && item.description && (
                <div className="imaging-card-body">
                  <p>{item.description}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

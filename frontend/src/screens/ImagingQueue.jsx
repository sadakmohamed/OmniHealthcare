import React, { useState, useEffect } from 'react'
import { Plus, Edit2, CheckCircle, AlertCircle, Loader, ArrowLeft, RefreshCw, Play } from 'lucide-react'
import { getImagingOrders, createImagingResult, updateImagingResult, updateImagingOrder } from '../api'
import './ImagingQueue.css'

export default function ImagingQueue({ me, onBack }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [resultForm, setResultForm] = useState({ findings: '', impression: '' })
  const [submitting, setSubmitting] = useState(false)
  const [filterStatus, setFilterStatus] = useState('ordered')
  const [updatingOrder, setUpdatingOrder] = useState(null)

  useEffect(() => {
    loadOrders()
    const timer = setInterval(loadOrders, 15000)
    return () => clearInterval(timer)
  }, [filterStatus])

  async function loadOrders() {
    setLoading(true)
    setError('')
    try {
      const { data } = await getImagingOrders({ status: filterStatus })
      setOrders(Array.isArray(data) ? data : data.results || [])
    } catch (err) {
      setError('Failed to load imaging orders')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleMarkInProgress(orderId) {
    setUpdatingOrder(orderId)
    setError('')
    try {
      await updateImagingOrder(orderId, { status: 'in_progress' })
      setSuccess('Imaging marked as in progress')
      await loadOrders()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update imaging status')
    } finally {
      setUpdatingOrder(null)
    }
  }

  async function handleSubmitResult(e) {
    e.preventDefault()
    if (!selectedOrder || !resultForm.findings.trim()) {
      setError('Please enter imaging findings')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const payload = {
        order: selectedOrder.id,
        findings: resultForm.findings.trim(),
        impression: resultForm.impression.trim() || ''
      }

      await createImagingResult(payload)
      setSuccess('Imaging result submitted successfully')
      setResultForm({ findings: '', impression: '' })
      setSelectedOrder(null)
      await loadOrders()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to submit imaging result')
    } finally {
      setSubmitting(false)
    }
  }

  const statusColors = {
    ordered: '#3b82f6',
    in_progress: '#f59e0b',
    resulted: '#10b981',
    reviewed: '#6366f1',
    awaiting_payment: '#ef4444'
  }

  if (!selectedOrder) {
    return (
      <div className="imaging-queue-container">
        <div className="page-heading" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn btn-icon" onClick={onBack} title="Back">
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1>Imaging Queue</h1>
              <p>Review and enter imaging results</p>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className="imaging-queue-toolbar">
          <div className="filter-buttons">
            {['ordered', 'in_progress', 'resulted'].map((status) => (
              <button
                key={status}
                className={`btn btn-sm ${filterStatus === status ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilterStatus(status)}
              >
                {status.replace(/_/g, ' ').toUpperCase()}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={loadOrders} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="loading-state">
            <Loader size={32} className="spinner" /> Loading imaging orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <AlertCircle size={48} />
            <p>No imaging orders with status: {filterStatus}</p>
          </div>
        ) : (
          <div className="imaging-queue-list">
            {orders.map((order) => (
              <div key={order.id} className="imaging-queue-card">
                <div className="card-header">
                  <div className="card-title">
                    <h3>{order.test_name}</h3>
                    <span className="card-badge" style={{ backgroundColor: statusColors[order.status] }}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="card-patient">
                    <strong>Patient:</strong> {order.patient?.first_name} {order.patient?.last_name}
                    {order.patient?.medical_record_number && (
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>MRN: {order.patient.medical_record_number}</div>
                    )}
                  </div>
                </div>

                <div className="card-details">
                  <div className="detail-row">
                    <span className="label">Ordered:</span>
                    <span>{new Date(order.created_at).toLocaleString()}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Price:</span>
                    <span>${(order.price_cents / 100).toFixed(2)}</span>
                  </div>
                  {order.encounter && (
                    <div className="detail-row">
                      <span className="label">Encounter:</span>
                      <span>#{order.encounter.id}</span>
                    </div>
                  )}
                </div>

                <div className="card-actions">
                  {order.status === 'ordered' && (
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleMarkInProgress(order.id)}
                      disabled={updatingOrder === order.id}
                      title="Mark this imaging as in progress"
                    >
                      <Play size={14} />
                      {updatingOrder === order.id ? 'Updating...' : 'Start'}
                    </button>
                  )}
                  <button
                    className={`btn btn-sm ${order.status === 'ordered' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => {
                      setSelectedOrder(order)
                      setResultForm({ findings: '', impression: '' })
                      setError('')
                    }}
                  >
                    <Edit2 size={14} />
                    {order.status === 'ordered' ? 'Enter Result' : 'View/Edit Result'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Result Entry Form
  return (
    <div className="imaging-queue-container">
      <div className="page-heading" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-icon" onClick={() => setSelectedOrder(null)} title="Back">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1>Imaging Result Entry</h1>
            <p>{selectedOrder.test_name}</p>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="imaging-result-form-container">
        <div className="form-section">
          <h2>Patient Information</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Patient Name</label>
              <input
                type="text"
                value={`${selectedOrder.patient?.first_name || ''} ${selectedOrder.patient?.last_name || ''}`}
                disabled
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label>MRN</label>
              <input
                type="text"
                value={selectedOrder.patient?.medical_record_number || 'N/A'}
                disabled
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label>Test</label>
              <input
                type="text"
                value={selectedOrder.test_name}
                disabled
                className="form-control"
              />
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmitResult} className="form-section">
          <h2>Imaging Findings</h2>

          <div className="form-group">
            <label>Findings *</label>
            <textarea
              placeholder="Describe the imaging findings in detail..."
              value={resultForm.findings}
              onChange={(e) => setResultForm({ ...resultForm, findings: e.target.value })}
              required
              rows="8"
              className="form-control"
              style={{ fontFamily: 'monospace', fontSize: '13px' }}
            />
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
              {resultForm.findings.length} characters
            </div>
          </div>

          <div className="form-group">
            <label>Impression (Summary)</label>
            <textarea
              placeholder="Provide a concise summary/impression of findings..."
              value={resultForm.impression}
              onChange={(e) => setResultForm({ ...resultForm, impression: e.target.value })}
              rows="4"
              className="form-control"
              style={{ fontFamily: 'monospace', fontSize: '13px' }}
            />
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
              {resultForm.impression.length} characters
            </div>
          </div>

          <div className="form-actions" style={{ marginTop: '24px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelectedOrder(null)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !resultForm.findings.trim()}>
              {submitting ? 'Submitting...' : 'Submit Result'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

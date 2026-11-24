import React, { useState, useEffect } from 'react'
import {
  ShieldCheck,
  Search,
  Filter,
  Clock,
  User,
  Activity,
  FileCode,
  AlertTriangle
} from 'lucide-react'
import { getAuditLogs } from '../api'

export default function AuditHistory({ me }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadLogs()
  }, [])

  async function loadLogs() {
    setLoading(true)
    setError('')
    try {
      const res = await getAuditLogs()
      setLogs(res.data?.results || res.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Only administrative staff have permission to view clinical audit logs.')
    } finally {
      setLoading(false)
    }
  }

  const filtered = logs.filter((log) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      log.action?.toLowerCase().includes(q) ||
      log.resource_type?.toLowerCase().includes(q) ||
      log.resource_id?.toLowerCase().includes(q) ||
      log.actor_name?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="audit-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MODULE F12</span>
          <h1>Clinical Governance & System Audit History</h1>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
            Append-only security log, timestamped transaction trails, role actor attributions, and HIPAA-oriented safeguard controls.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertTriangle size={16} />
          <div style={{ flex: 1 }}>{error}</div>
        </div>
      )}

      <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ShieldCheck size={18} color="#92400e" />
        <div>
          <strong>TAMPER-EVIDENT AUDIT TRAIL:</strong> Every mutating clinical operation, transition, user login, and prescription event creates an immutable record. Read-only access restricted to Admin role.
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-search">
          <Search size={16} color="var(--muted)" />
          <input
            type="text"
            placeholder="Search by action, resource type, or actor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-secondary" onClick={loadLogs}>
          Refresh Audit
        </button>
      </div>

      {/* Audit Log Table */}
      <div className="panel">
        <div className="panel-header">
          <h3>Security & Audit Trail Events ({filtered.length})</h3>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading audit trails...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No audit records found.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp (UTC)</th>
                  <th>Actor / User</th>
                  <th>Action Executed</th>
                  <th>Resource Target</th>
                  <th>Resource ID</th>
                  <th>Event Metadata / Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <strong>{new Date(log.created_at).toLocaleTimeString()}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {new Date(log.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--navy)' }}>
                        {log.actor_name || log.actor || 'System'}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-blue">{log.action}</span>
                    </td>
                    <td>
                      <strong>{log.resource_type}</strong>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--muted)' }}>
                        {log.resource_id ? `${log.resource_id.slice(0, 8)}...` : '—'}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--navy)', maxWidth: '300px' }}>
                      {log.details ? JSON.stringify(log.details) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

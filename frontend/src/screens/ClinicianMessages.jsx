import React, { useEffect, useState } from 'react'
import { getAllPatientMessages, markPatientMessageRead, sendPatientMessage } from '../api'

export default function ClinicianMessages({ me }) {
  const [messages, setMessages] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadMessages() {
    setError('')
    try {
      setMessages(await getAllPatientMessages())
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to load patient messages.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    loadMessages()
  }, [])

  const conversations = new Map()
  for (const message of messages) {
    const previous = conversations.get(message.patient)
    conversations.set(message.patient, {
      id: message.patient,
      name: message.patient_name,
      latest: message,
      unread: (previous?.unread || 0) + (message.recipient === me.id && !message.read_at ? 1 : 0)
    })
  }
  const thread = messages.filter((message) => message.patient === selectedPatient)

  async function markRead(message) {
    setError('')
    try {
      const response = await markPatientMessageRead(message.id)
      setMessages((current) => current.map((item) => item.id === message.id ? response.data : item))
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to mark the message as read.')
    }
  }

  async function reply(event) {
    event.preventDefault()
    if (!selectedPatient || !body.trim()) return
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      await sendPatientMessage({ patient: selectedPatient, body: body.trim() })
      setBody('')
      setSuccess('Reply sent.')
      await loadMessages()
    } catch (err) {
      const data = err.response?.data
      setError(data?.detail || data?.patient?.[0] || 'Unable to send your reply.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="page-heading">
        <h1>Patient Messages</h1>
        <button className="btn btn-secondary" onClick={loadMessages}>Refresh</button>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="panel">
        <div className="panel-header"><h3>Conversations</h3></div>
        <div className="panel-body">
          {loading ? <p>Loading messages...</p> : conversations.size === 0 ? (
            <p className="form-hint">No patient messages yet.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Array.from(conversations.values()).reverse().map((conversation) => (
                <button key={conversation.id} type="button"
                  className={`btn ${selectedPatient === conversation.id ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setSelectedPatient(conversation.id); setBody(''); setSuccess('') }}>
                  {conversation.name} {conversation.unread > 0 && `(${conversation.unread} unread)`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {selectedPatient && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header"><h3>{conversations.get(selectedPatient)?.name}</h3></div>
          <div className="panel-body">
            {thread.map((message) => (
              <article key={message.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                <strong>{message.sender_name}</strong>{' '}
                <small>{new Date(message.created_at).toLocaleString()}</small>
                <p style={{ whiteSpace: 'pre-wrap' }}>{message.body}</p>
                {message.recipient === me.id && !message.read_at && (
                  <button type="button" className="btn btn-secondary btn-xs" onClick={() => markRead(message)}>Mark read</button>
                )}
              </article>
            ))}
            <form onSubmit={reply} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <input aria-label="Reply to patient" value={body} onChange={(event) => setBody(event.target.value)}
                maxLength={4000} placeholder="Write a reply" required />
              <button className="btn btn-primary" disabled={submitting}>Send reply</button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

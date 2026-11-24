import axios from 'axios'

const api = axios.create({
  baseURL: 'http://127.0.0.1:8000/api/v1',
})

// Request interceptor: attach JWT from localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('oh_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('oh_token')
      localStorage.removeItem('oh_user')
    }
    return Promise.reject(error)
  }
)

export default api

// ─── Auth ────────────────────────────────────────────────────────────────────
export const login = (username, password) =>
  api.post('/auth/login/', { username, password })

export const getMe = () => api.get('/me/')
export const register = (data) => api.post('/register/', data)

// ─── Analytics ───────────────────────────────────────────────────────────────
export const getAnalytics = () => api.get('/analytics/')

// ─── Patients ────────────────────────────────────────────────────────────────
export const getPatients = (params) => api.get('/patients/', { params })
export const getPatient = (id) => api.get(`/patients/${id}/`)
export const createPatient = (data) => api.post('/patients/', data)
export const updatePatient = (id, data) => api.patch(`/patients/${id}/`, data)

// ─── Clinicians ──────────────────────────────────────────────────────────────
export const getClinicians = (params) => api.get('/clinicians/', { params })

// ─── Appointments ────────────────────────────────────────────────────────────
export const getAppointments = (params) => api.get('/appointments/', { params })
export const getAppointment = (id) => api.get(`/appointments/${id}/`)
export const createAppointment = (data) => api.post('/appointments/', data)
export const updateAppointment = (id, data) => api.patch(`/appointments/${id}/`, data)
export const checkInAppointment = (id) => api.post(`/appointments/${id}/checkin/`)
export const cancelAppointment = (id) => api.post(`/appointments/${id}/cancel/`)

// ─── Encounters ──────────────────────────────────────────────────────────────
export const getEncounters = (params) => api.get('/encounters/', { params })
export const getEncounter = (id) => api.get(`/encounters/${id}/`)
export const createEncounter = (data) => api.post('/encounters/', data)
export const updateEncounter = (id, data) => api.patch(`/encounters/${id}/`, data)
export const transitionEncounter = (id, status) =>
  api.post(`/encounters/${id}/transition/`, { status })

// ─── Vitals / Triage ─────────────────────────────────────────────────────────
export const getVitals = (params) => api.get('/vitals/', { params })
export const createVitals = (data) => api.post('/vitals/', data)

// ─── Clinical Notes ──────────────────────────────────────────────────────────
export const getNotes = (params) => api.get('/notes/', { params })
export const createNote = (data) => api.post('/notes/', data)

// ─── Diagnoses ───────────────────────────────────────────────────────────────
export const getDiagnoses = (params) => api.get('/diagnoses/', { params })
export const createDiagnosis = (data) => api.post('/diagnoses/', data)

// ─── Care Plans ──────────────────────────────────────────────────────────────
export const getCarePlans = (params) => api.get('/care-plans/', { params })
export const createCarePlan = (data) => api.post('/care-plans/', data)

// ─── Lab Orders / Results ────────────────────────────────────────────────────
export const getLabOrders = (params) => api.get('/lab-orders/', { params })
export const createLabOrder = (data) => api.post('/lab-orders/', data)
export const updateLabOrder = (id, data) => api.patch(`/lab-orders/${id}/`, data)
export const getLabResults = (params) => api.get('/lab-results/', { params })
export const createLabResult = (data) => api.post('/lab-results/', data)
export const updateLabResult = (id, data) => api.patch(`/lab-results/${id}/`, data)

// ─── Prescriptions / Pharmacy ────────────────────────────────────────────────
export const getPrescriptions = (params) => api.get('/prescriptions/', { params })
export const createPrescription = (data) => api.post('/prescriptions/', data)
export const dispensePrescription = (id) => api.post(`/prescriptions/${id}/dispense/`)

// ─── Referrals ───────────────────────────────────────────────────────────────
export const getReferrals = (params) => api.get('/referrals/', { params })
export const createReferral = (data) => api.post('/referrals/', data)
export const updateReferral = (id, data) => api.patch(`/referrals/${id}/`, data)

// ─── Wards & Beds ────────────────────────────────────────────────────────────
export const getWards = (params) => api.get('/wards/', { params })
export const getBeds = (params) => api.get('/beds/', { params })
export const assignBed = (id, patientId) => api.post(`/beds/${id}/assign/`, { patient: patientId })
export const dischargeBed = (id) => api.post(`/beds/${id}/assign/`, { patient: null })

// ─── Billing ─────────────────────────────────────────────────────────────────
export const getBills = (params) => api.get('/bills/', { params })
export const createBill = (data) => api.post('/bills/', data)
export const getPayments = (params) => api.get('/payments/', { params })
export const createPayment = (data) => api.post('/payments/', data)

// ─── Follow-ups ──────────────────────────────────────────────────────────────
export const getFollowUps = (params) => api.get('/follow-ups/', { params })
export const createFollowUp = (data) => api.post('/follow-ups/', data)
export const completeFollowUp = (id) => api.patch(`/follow-ups/${id}/`, { completed: true })

// ─── Audit ───────────────────────────────────────────────────────────────────
export const getAuditLogs = (params) => api.get('/audit/', { params })

// ─── Virtual Care ────────────────────────────────────────────────────────────
export const getVirtualSessions = (params) => api.get('/virtual-sessions/', { params })
export const createVirtualSession = (data) => api.post('/virtual-sessions/', data)
export const transitionVirtualSession = (id, status) =>
  api.post(`/virtual-sessions/${id}/transition/`, { status })

// ─── Allergies & Medical History ─────────────────────────────────────────────
export const getAllergies = (params) => api.get('/allergies/', { params })
export const createAllergy = (data) => api.post('/allergies/', data)
export const getMedicalHistories = (params) => api.get('/medical-history/', { params })
export const createMedicalHistory = (data) => api.post('/medical-history/', data)

// ─── Discharge Notes ─────────────────────────────────────────────────────────
export const getDischargeNotes = (params) => api.get('/discharge-notes/', { params })
export const createDischargeNote = (data) => api.post('/discharge-notes/', data)

// ─── Proxy Grants ────────────────────────────────────────────────────────────
export const getProxyGrants = (params) => api.get('/proxy-grants/', { params })
export const createProxyGrant = (data) => api.post('/proxy-grants/', data)
export const revokeProxyGrant = (id) => api.patch(`/proxy-grants/${id}/`, { active: false })

// ─── Consents ────────────────────────────────────────────────────────────────
export const getConsents = (params) => api.get('/consents/', { params })
export const createConsent = (data) => api.post('/consents/', data)

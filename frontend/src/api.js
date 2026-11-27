import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
})
const virtualApi = axios.create({
  baseURL: import.meta.env.VITE_VIRTUAL_CARE_API_URL || '/virtual-api/api/v1',
})

const listEndpointsByScreen = {
  dashboard: ['appointments', 'inpatient-admissions'],
  opd: [
    'patients',
    'encounters',
    'vitals',
    'notes',
    'diagnoses',
    'medical-history',
    'lab-orders',
    'lab-results',
    'prescriptions',
    'care-plans',
    'follow-ups'
  ],
  patients: ['patients'],
  triage: ['patients', 'vitals'],
  encounters: ['encounters'],
  consultants: ['clinicians'],
  inpatients: ['inpatient-admissions'],
  billing: ['bills', 'payments'],
  'follow-ups': ['follow-ups'],
  referrals: ['referrals'],
  audit: ['audit'],
  'patient-portal': [
    'appointments',
    'bills',
    'lab-orders',
    'lab-results',
    'prescriptions',
    'follow-ups',
    'consents',
    'medical-history',
    'discharge-notes'
  ]
}

// Request interceptor: attach JWT from localStorage
const attachToken = (config) => {
  const token = localStorage.getItem('oh_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (config.method === 'get' && config.url) {
    const url = config.url.split('?')[0].replace(/^\/|\/$/g, '')
    const segments = url.split('/')
    const activeScreen = localStorage.getItem('oh_active_screen')
    const filters = listEndpointsByScreen[activeScreen]
    if (segments.length === 1 && filters?.includes(segments[0])) {
      const search = localStorage.getItem(`oh_list_search_${activeScreen}`)
      const date = localStorage.getItem(`oh_list_date_${activeScreen}`)
      config.params = {
        ...config.params,
        ...(search ? { search } : {}),
        ...(date ? { date } : {})
      }
    }
  }
  return config
}
api.interceptors.request.use(attachToken)
virtualApi.interceptors.request.use(attachToken)

// Standalone Virtual Care sign-in was removed; discard any token it left in the browser so it
// can never override the signed-in hospital user's identity.
localStorage.removeItem('oh_virtualcare_token')
localStorage.removeItem('oh_virtualcare_user')

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
virtualApi.interceptors.response.use(
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
export const changeInitialPassword = (token, password) =>
  api.post('/auth/change-initial-password/', { token, password })
export const changePassword = (currentPassword, newPassword) =>
  api.post('/auth/change-password/', { current_password: currentPassword, new_password: newPassword })

export const getMe = () => api.get('/me/')
export const updateMe = (data) => api.patch('/me/', data)
export const register = (data) => api.post('/register/', data)

export const getUsers = () => api.get('/users/')
export const createUser = (data) => api.post('/users/', data)
export const updateUser = (id, data) => api.patch(`/users/${id}/`, data)

export const getLabTests = () => api.get('/lab-tests/')
export const createLabTest = (data) => api.post('/lab-tests/', data)
export const updateLabTest = (id, data) => api.patch(`/lab-tests/${id}/`, data)
export const getMedications = () => api.get('/medications/')
export const createMedication = (data) => api.post('/medications/', data)
export const updateMedication = (id, data) => api.patch(`/medications/${id}/`, data)

// ─── Analytics ───────────────────────────────────────────────────────────────
export const getAnalytics = () => api.get('/analytics/')

// ─── Patients ────────────────────────────────────────────────────────────────
export const getPatients = (params) => api.get('/patients/', { params })
export const getPatient = (id) => api.get(`/patients/${id}/`)
export const createPatient = (data) => api.post('/patients/', data)
export const updatePatient = (id, data) => api.patch(`/patients/${id}/`, data)

// ─── Clinicians ──────────────────────────────────────────────────────────────
export const getClinicians = (params) => api.get('/clinicians/', { params })
export const createClinician = (data) => api.post('/clinicians/', data)
export const updateClinician = (id, data) => api.patch(`/clinicians/${id}/`, data)
export const getClinicianAvailability = (params) => api.get('/clinician-availability/', { params })
export const createClinicianAvailability = (data) => api.post('/clinician-availability/', data)
export const deleteClinicianAvailability = (id) => api.delete(`/clinician-availability/${id}/`)

// ─── Appointments ────────────────────────────────────────────────────────────
export const getAppointments = (params) => api.get('/appointments/', { params })
export const getAppointmentSlots = (clinician, date) =>
  api.get('/appointments/availability-slots/', { params: { clinician, date } })
export const getAppointment = (id) => api.get(`/appointments/${id}/`)
export const createAppointment = (data, idempotencyKey) =>
  api.post('/appointments/', data, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
  })
export const updateAppointment = (id, data) => api.patch(`/appointments/${id}/`, data)
export const checkInAppointment = (id) => api.post(`/appointments/${id}/checkin/`)
export const cancelAppointment = (id) => api.post(`/appointments/${id}/cancel/`)
export const linkVirtualAppointmentSession = (id, sessionRef) =>
  api.post(`/appointments/${id}/link-virtual-session/`, { virtual_session_ref: sessionRef })
export const completeVirtualAppointment = (id, data) =>
  api.post(`/appointments/${id}/complete-virtual/`, data)

// ─── Encounters ──────────────────────────────────────────────────────────────
export const getEncounters = (params) => api.get('/encounters/', { params })
export const getEncounter = (id) => api.get(`/encounters/${id}/`)
export const createEncounter = (data) => api.post('/encounters/', data)
export const updateEncounter = (id, data) => api.patch(`/encounters/${id}/`, data)
export const transitionEncounter = (id, status) =>
  api.post(`/encounters/${id}/transition/`, { status })
export const saveConsultation = (id, data) =>
  api.post(`/encounters/${id}/save-consultation/`, data)

// ─── Vitals / Triage ─────────────────────────────────────────────────────────
export const getVitals = (params) => api.get('/vitals/', { params })
export const createVitals = (data) => api.post('/vitals/', data)
export const updatePatientOpdStatus = (patientId, opd_status) =>
  api.post(`/patients/${patientId}/update-opd-status/`, { opd_status })

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
export const reviewLabOrder = (id) => api.post(`/lab-orders/${id}/review/`)
export const batchOrderLabInvestigations = (data) =>
  api.post('/lab-orders/batch-order/', data)
export const updateLabOrder = (id, data) => api.patch(`/lab-orders/${id}/`, data)
export const getLabResults = (params) => api.get('/lab-results/', { params })
export const createLabResult = (data) => api.post('/lab-results/', data)
export const updateLabResult = (id, data) => api.patch(`/lab-results/${id}/`, data)

// ─── Prescriptions / Pharmacy ────────────────────────────────────────────────
export const getPrescriptions = (params) => api.get('/prescriptions/', { params })
export const createPrescription = (data) => api.post('/prescriptions/', data)
export const batchPrescribe = (data) => api.post('/prescriptions/batch-prescribe/', data)
export const dispensePrescription = (id) => api.post(`/prescriptions/${id}/dispense/`)

// ─── Referrals ───────────────────────────────────────────────────────────────
export const getReferrals = (params) => api.get('/referrals/', { params })
export const createReferral = (data) => api.post('/referrals/', data)
export const updateReferral = (id, data) => api.patch(`/referrals/${id}/`, data)

// ─── Wards & Beds ────────────────────────────────────────────────────────────
export const getWards = (params) => api.get('/wards/', { params })
export const createWard = (data) => api.post('/wards/', data)
export const deleteWard = (id) => api.delete(`/wards/${id}/`)
export const getBeds = (params) => api.get('/beds/', { params })
export const createBed = (data) => api.post('/beds/', data)
export const deleteBed = (id) => api.delete(`/beds/${id}/`)
export const updateBed = (id, data) => api.patch(`/beds/${id}/`, data)
export const setBedActive = (id, active) => api.post(`/beds/${id}/set-active/`, { active })
export const assignBed = (id, patientId, clinicianId) =>
  api.post(`/beds/${id}/assign/`, { patient: patientId, clinician: clinicianId })
export const dischargeBed = (id) => api.post(`/beds/${id}/assign/`, { patient: null })
export const getInpatientAdmissions = (params) =>
  api.get('/inpatient-admissions/', { params })
export const updateInpatientAdmission = (id, data) =>
  api.patch(`/inpatient-admissions/${id}/`, data)
export const dischargeInpatientAdmission = (id) =>
  api.post(`/inpatient-admissions/${id}/discharge/`)
export const getInpatientMedicationPlans = (params) =>
  api.get('/inpatient-medication-plans/', { params })
export const createInpatientMedicationPlan = (data) =>
  api.post('/inpatient-medication-plans/', data)
export const batchCreateInpatientMedicationPlans = (data) =>
  api.post('/inpatient-medication-plans/batch-create/', data)
export const updateInpatientMedicationPlan = (id, data) =>
  api.patch(`/inpatient-medication-plans/${id}/`, data)
export const getInpatientMedicationAdministrations = (params) =>
  api.get('/inpatient-medication-administrations/', { params })
export const createInpatientMedicationAdministration = (data) =>
  api.post('/inpatient-medication-administrations/', data)
export const getInpatientDoctorNotes = (params) =>
  api.get('/inpatient-doctor-notes/', { params })
export const createInpatientDoctorNote = (data) =>
  api.post('/inpatient-doctor-notes/', data)

// ─── Billing ─────────────────────────────────────────────────────────────────
export const getBills = (params) => api.get('/bills/', { params })
export const createBill = (data) => api.post('/bills/', data)
export const getPayments = (params) => api.get('/payments/', { params })
export const createPayment = (data) => api.post('/payments/', data)

// ─── Insurance claims ────────────────────────────────────────────────────────
export const getInsuranceClaims = (params) => api.get('/insurance-claims/', { params })
export const createInsuranceClaim = (data) => api.post('/insurance-claims/', data)
export const submitInsuranceClaim = (id) => api.post(`/insurance-claims/${id}/submit/`)
export const adjudicateInsuranceClaim = (id, data) =>
  api.post(`/insurance-claims/${id}/adjudicate/`, data)

// ─── Follow-ups ──────────────────────────────────────────────────────────────
export const getFollowUps = (params) => api.get('/follow-ups/', { params })
export const createFollowUp = (data) => api.post('/follow-ups/', data)
export const completeFollowUp = (id) => api.patch(`/follow-ups/${id}/`, { completed: true })

// ─── Audit ───────────────────────────────────────────────────────────────────
export const getAuditLogs = (params) => api.get('/audit/', { params })

// ─── Virtual Care ────────────────────────────────────────────────────────────
export const getVirtualSessions = (params) => virtualApi.get('/sessions/', { params })
export const virtualCareLogin = (data) => virtualApi.post('/auth/login/', data)
export const virtualCareRegister = (data) => virtualApi.post('/auth/register/', data)
export const getVirtualCareDirectory = () => virtualApi.get('/directory/')
export const createVirtualCareAccount = (data) => virtualApi.post('/directory/', data)
export const updateVirtualCareAccount = (id, data) => virtualApi.patch(`/directory/${id}/`, data)
export const createVirtualSession = (data, idempotencyKey) =>
  virtualApi.post('/sessions/', data, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
  })
export const transitionVirtualSession = (id, status) =>
  virtualApi.post(`/sessions/${id}/transition/`, { status })
export const getVirtualCareQueue = (params) => virtualApi.get('/sessions/queue/', { params })
export const grantVirtualCareConsent = (id, granted) =>
  virtualApi.post(`/sessions/${id}/consent/`, { granted })
export const submitVirtualCareIntake = (id, data) =>
  virtualApi.post(`/sessions/${id}/intake/`, data)
export const completeVirtualCareSession = (id, data) =>
  virtualApi.post(`/sessions/${id}/complete/`, data)
export const markVirtualSessionHospitalSynced = (id) =>
  virtualApi.post(`/sessions/${id}/mark-hospital-synced/`)

// ─── Allergies & Medical History ─────────────────────────────────────────────
export const getAllergies = (params) => api.get('/allergies/', { params })
export const createAllergy = (data) => api.post('/allergies/', data)
export const getMedicalHistories = (params) => api.get('/medical-history/', { params })
export const createMedicalHistory = (data) => api.post('/medical-history/', data)
export const getPatientMessages = (params) => api.get('/patient-messages/', { params })
export const getAllPages = async (fetchPage, params = {}) => {
  const records = []
  let page = 1
  let hasNext = true
  while (hasNext) {
    const response = await fetchPage({ ...params, page })
    const data = response.data
    records.push(...(data?.results || data || []))
    hasNext = Boolean(data?.next)
    page += 1
  }
  return records
}
export const getAllAllergies = (params) => getAllPages(getAllergies, params)
export const getAllPatientMessages = (params) => getAllPages(getPatientMessages, params)
export const sendPatientMessage = (data) => api.post('/patient-messages/', data)
export const markPatientMessageRead = (id) => api.post(`/patient-messages/${id}/mark-read/`)

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

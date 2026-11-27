"""Read-only FHIR R4-shaped views over fictional data. Not a certified FHIR server."""

from rest_framework.response import Response

from .models import Appointment, Encounter, LabResult, Patient, Vital
from .views import TenantViewSet

GENDERS = {"male": "male", "female": "female", "m": "male", "f": "female"}
APPOINTMENT_STATUS = {
    "scheduled": "booked",
    "checked_in": "arrived",
    "in_progress": "fulfilled",
    "completed": "fulfilled",
    "cancelled": "cancelled",
}
ENCOUNTER_STATUS = {
    "scheduled": "planned",
    "checked_in": "arrived",
    "in_progress": "in-progress",
    "documentation_pending": "in-progress",
    "completed": "finished",
    "cancelled": "cancelled",
    "entered_in_error": "entered-in-error",
}
VITAL_CODES = (
    ("temperature_c", "8310-5", "Body temperature", "Cel"),
    ("systolic", "8480-6", "Systolic blood pressure", "mm[Hg]"),
    ("diastolic", "8462-4", "Diastolic blood pressure", "mm[Hg]"),
    ("heart_rate", "8867-4", "Heart rate", "/min"),
    ("respiratory_rate", "9279-1", "Respiratory rate", "/min"),
    ("oxygen_saturation", "59408-5", "Oxygen saturation", "%"),
    ("weight_kg", "29463-7", "Body weight", "kg"),
    ("height_cm", "8302-2", "Body height", "cm"),
)


def _ref(resource_type, pk):
    return {"reference": f"{resource_type}/{pk}"}


def _iso(value):
    return value.isoformat() if value else None


def _clean(resource):
    return {key: value for key, value in resource.items() if value not in (None, "", [])}


def patient_to_fhir(patient):
    return _clean({
        "resourceType": "Patient",
        "id": str(patient.pk),
        "identifier": [{"system": "urn:omnihealthcare:mrn", "value": patient.medical_record_number}],
        "name": [{"family": patient.last_name, "given": [patient.first_name]}],
        "gender": GENDERS.get((patient.sex or "").lower(), "unknown"),
        "birthDate": _iso(patient.date_of_birth),
    })


def appointment_to_fhir(appointment):
    return _clean({
        "resourceType": "Appointment",
        "id": str(appointment.pk),
        "status": APPOINTMENT_STATUS.get(appointment.status, "proposed"),
        "start": _iso(appointment.starts_at),
        "description": appointment.reason,
        "participant": [
            {"actor": _ref("Patient", appointment.patient_id), "status": "accepted"},
            {"actor": {"display": appointment.clinician.name}, "status": "accepted"},
        ],
    })


def encounter_to_fhir(encounter):
    return _clean({
        "resourceType": "Encounter",
        "id": str(encounter.pk),
        "status": ENCOUNTER_STATUS.get(encounter.status, "unknown"),
        "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB"},
        "subject": _ref("Patient", encounter.patient_id),
        "appointment": [_ref("Appointment", encounter.appointment_id)] if encounter.appointment_id else None,
    })


def vital_to_fhir(vital):
    components = []
    for field, code, display, unit in VITAL_CODES:
        value = getattr(vital, field)
        if value is not None:
            components.append({
                "code": {"coding": [{"system": "http://loinc.org", "code": code, "display": display}]},
                "valueQuantity": {"value": float(value), "unit": unit, "system": "http://unitsofmeasure.org"},
            })
    return _clean({
        "resourceType": "Observation",
        "id": str(vital.pk),
        "status": "final",
        "category": [{"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/observation-category",
            "code": "vital-signs",
        }]}],
        "code": {"coding": [{"system": "http://loinc.org", "code": "85353-1", "display": "Vital signs panel"}]},
        "subject": _ref("Patient", vital.patient_id),
        "encounter": _ref("Encounter", vital.encounter_id) if vital.encounter_id else None,
        "effectiveDateTime": _iso(vital.created_at),
        "component": components,
    })


def lab_result_to_fhir(result):
    return _clean({
        "resourceType": "DiagnosticReport",
        "id": str(result.pk),
        "status": "amended" if result.amended_from_id else "final",
        "category": [{"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/v2-0074", "code": "LAB",
        }]}],
        "code": {"text": result.order.test_name},
        "subject": _ref("Patient", result.patient_id),
        "encounter": _ref("Encounter", result.order.encounter_id) if result.order.encounter_id else None,
        "issued": _iso(result.created_at),
        "conclusion": result.result,
    })


class FhirViewSet(TenantViewSet):
    """Inherits tenant, role, patient-ownership and clinician scoping from the REST API."""

    http_method_names = ["get", "head", "options"]
    filter_backends = []
    to_fhir = None
    select_related_fields = ()

    def get_queryset(self):
        return super().get_queryset().select_related(*self.select_related_fields)

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        page = self.paginate_queryset(queryset)
        total = self.paginator.page.paginator.count
        return Response({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": total,
            "entry": [{"resource": type(self).to_fhir(obj)} for obj in page],
        })

    def retrieve(self, request, *args, **kwargs):
        return Response(type(self).to_fhir(self.get_object()))


class FhirPatientViewSet(FhirViewSet):
    queryset = Patient.objects.all().order_by("-created_at")
    to_fhir = staticmethod(patient_to_fhir)


class FhirAppointmentViewSet(FhirViewSet):
    queryset = Appointment.objects.all().order_by("-starts_at")
    select_related_fields = ("clinician",)
    to_fhir = staticmethod(appointment_to_fhir)


class FhirEncounterViewSet(FhirViewSet):
    queryset = Encounter.objects.all().order_by("-created_at")
    to_fhir = staticmethod(encounter_to_fhir)


class FhirObservationViewSet(FhirViewSet):
    queryset = Vital.objects.all().order_by("-created_at")
    to_fhir = staticmethod(vital_to_fhir)


class FhirDiagnosticReportViewSet(FhirViewSet):
    queryset = LabResult.objects.all().order_by("-created_at")
    select_related_fields = ("order",)
    to_fhir = staticmethod(lab_result_to_fhir)

from datetime import date
import hashlib
import hmac
import json
import secrets
import uuid

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import AuthenticationFailed, NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import AccessToken

from .models import VirtualAuditEvent, VirtualCareAccount, VirtualVisit
from .serializers import VirtualVisitSerializer


def virtualcare_account_payload(account):
    return {
        "id": str(account.pk),
        "username": account.username,
        "display_name": account.display_name,
        "role": account.role,
        "organization_id": account.organization,
        "patient_id": account.patient_id,
        "clinician_id": account.clinician_id,
        "specialty": account.specialty,
        "phone": account.phone,
        "is_active": account.is_active,
        "created_at": account.created_at,
        "first_name": account.display_name.split(" ", 1)[0],
        "last_name": account.display_name.split(" ", 1)[1] if " " in account.display_name else "",
    }


def resolve_organization(value):
    """Use the supplied organization, or the only initialized one when none is given."""
    organization = str(value or "").strip()
    if organization:
        return organization
    organizations = list(
        VirtualCareAccount.objects.filter(role=VirtualCareAccount.Role.ADMIN, is_active=True)
        .order_by()
        .values_list("organization", flat=True)
        .distinct()[:2]
    )
    if len(organizations) != 1:
        raise ValidationError({"organization": "Enter your organization code."})
    return organizations[0]


def issue_virtualcare_token(account):
    token = AccessToken()
    token["user_id"] = str(account.pk)
    token["virtualcare_account_id"] = str(account.pk)
    token["role"] = account.role
    token["organization_id"] = account.organization
    token["patient_id"] = account.patient_id
    token["clinician_id"] = account.clinician_id
    return str(token)


class VirtualCareLoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        organization = resolve_organization(request.data.get("organization"))
        username = str(request.data.get("username", "")).strip()
        password = request.data.get("password", "")
        account = VirtualCareAccount.objects.filter(
            organization=organization, username=username
        ).first()
        if not account or not check_password(password, account.password):
            raise AuthenticationFailed("Virtual Care username or password is incorrect.")
        if not account.is_active:
            raise PermissionDenied("This account is inactive. Contact your administrator.")
        return Response({
            "access": issue_virtualcare_token(account),
            "user": virtualcare_account_payload(account),
        })


class VirtualCareRegistrationView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        organization = resolve_organization(request.data.get("organization"))
        username = str(request.data.get("username", "")).strip()
        display_name = str(request.data.get("display_name", "")).strip()
        password = request.data.get("password", "")
        if not username or not display_name:
            raise ValidationError({"detail": "Username and name are required."})
        if len(password) < 8:
            raise ValidationError({"password": "Use a password with at least 8 characters."})
        if not VirtualCareAccount.objects.filter(
            organization=organization, role=VirtualCareAccount.Role.ADMIN, is_active=True
        ).exists():
            raise ValidationError(
                {"organization": "This Virtual Care organization has not been initialized."}
            )
        account_id = uuid.uuid4()
        try:
            account = VirtualCareAccount.objects.create(
                id=account_id,
                organization=organization,
                username=username,
                password=make_password(password),
                display_name=display_name,
                role=VirtualCareAccount.Role.PATIENT,
                patient_id=str(account_id),
                phone=str(request.data.get("phone", "")).strip()[:30],
            )
        except IntegrityError as exc:
            raise ValidationError({"username": "That username is already registered."}) from exc
        return Response({
            "access": issue_virtualcare_token(account),
            "user": virtualcare_account_payload(account),
        }, status=status.HTTP_201_CREATED)


class VirtualCareStatusView(APIView):
    """Public: tells the sign-in page whether the service is set up and which organization to use."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        organizations = list(
            VirtualCareAccount.objects.filter(role=VirtualCareAccount.Role.ADMIN, is_active=True)
            .order_by()
            .values_list("organization", flat=True)
            .distinct()[:2]
        )
        return Response({
            "initialized": bool(organizations),
            "organization": organizations[0] if len(organizations) == 1 else "",
            "needs_organization": len(organizations) > 1,
            "setup_enabled": bool(getattr(settings, "VIRTUALCARE_BOOTSTRAP_KEY", "")),
        })


class VirtualCareBootstrapView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        configured_key = getattr(settings, "VIRTUALCARE_BOOTSTRAP_KEY", "")
        supplied_key = str(request.data.get("bootstrap_key", ""))
        if not configured_key or not secrets.compare_digest(configured_key, supplied_key):
            raise PermissionDenied("Virtual Care bootstrap is not authorized.")
        organization = str(request.data.get("organization", "")).strip()
        username = str(request.data.get("username", "")).strip()
        display_name = str(request.data.get("display_name", "")).strip()
        password = request.data.get("password", "")
        if not organization or not username or not display_name:
            raise ValidationError({"detail": "Organization, username, and name are required."})
        if len(password) < 8:
            raise ValidationError({"password": "Use a password with at least 8 characters."})
        if VirtualCareAccount.objects.filter(
            organization=organization, role=VirtualCareAccount.Role.ADMIN
        ).exists():
            raise PermissionDenied("This organization already has an administrator.")
        try:
            account = VirtualCareAccount.objects.create(
                organization=organization,
                username=username,
                password=make_password(password),
                display_name=display_name,
                role=VirtualCareAccount.Role.ADMIN,
            )
        except IntegrityError as exc:
            raise ValidationError({"username": "That username is already registered."}) from exc
        return Response({
            "access": issue_virtualcare_token(account),
            "user": virtualcare_account_payload(account),
        }, status=status.HTTP_201_CREATED)


class VirtualCareDirectoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        accounts = VirtualCareAccount.objects.filter(
            organization=request.user.organization_id, is_active=True
        )
        patients = []
        clinicians = []
        for account in accounts:
            if account.role == VirtualCareAccount.Role.PATIENT:
                patients.append({
                    "id": account.patient_id,
                    "patient_id": account.patient_id,
                    "first_name": account.display_name.split(" ", 1)[0],
                    "last_name": account.display_name.split(" ", 1)[1] if " " in account.display_name else "",
                    "medical_record_number": f"VC-{str(account.pk)[:8].upper()}",
                })
            elif account.role == VirtualCareAccount.Role.CLINICIAN:
                clinicians.append({
                    "id": account.clinician_id,
                    "clinician_id": account.clinician_id,
                    "name": account.display_name,
                    "specialty": account.specialty or "Virtual Care",
                    "department": account.specialty or "Virtual Care",
                })
        if request.user.role == VirtualCareAccount.Role.PATIENT:
            patients = [item for item in patients if item["id"] == request.user.patient_id]
        elif request.user.role == VirtualCareAccount.Role.CLINICIAN:
            clinicians = [item for item in clinicians if item["id"] == request.user.clinician_id]
        elif request.user.role not in {
            VirtualCareAccount.Role.ADMIN,
            VirtualCareAccount.Role.RECEPTIONIST,
        }:
            raise PermissionDenied("Your role cannot access the Virtual Care directory.")
        return Response({"patients": patients, "clinicians": clinicians, **self._admin_accounts(request)})

    @staticmethod
    def _admin_accounts(request):
        if request.user.role != VirtualCareAccount.Role.ADMIN:
            return {}
        return {"accounts": [
            virtualcare_account_payload(account)
            for account in VirtualCareAccount.objects.filter(
                organization=request.user.organization_id
            ).order_by("role", "display_name")
        ]}

    def post(self, request):
        if request.user.role != VirtualCareAccount.Role.ADMIN:
            raise PermissionDenied("Only Virtual Care administrators can add directory accounts.")
        role = request.data.get("role")
        if role not in VirtualCareAccount.Role.values:
            raise ValidationError({"role": "Choose administrator, receptionist, clinician or patient."})
        username = str(request.data.get("username", "")).strip()
        display_name = str(request.data.get("display_name", "")).strip()
        password = request.data.get("password", "")
        if not username or not display_name:
            raise ValidationError({"detail": "Username and name are required."})
        if len(password) < 8:
            raise ValidationError({"password": "Use a password with at least 8 characters."})
        account_id = uuid.uuid4()
        try:
            account = VirtualCareAccount.objects.create(
                id=account_id,
                organization=request.user.organization_id,
                username=username,
                password=make_password(password),
                display_name=display_name,
                role=role,
                patient_id=str(account_id) if role == VirtualCareAccount.Role.PATIENT else "",
                clinician_id=str(account_id) if role == VirtualCareAccount.Role.CLINICIAN else "",
                specialty=str(request.data.get("specialty", "")).strip()[:120],
                phone=str(request.data.get("phone", "")).strip()[:30],
            )
        except IntegrityError as exc:
            raise ValidationError({"username": "That username is already registered."}) from exc
        return Response(virtualcare_account_payload(account), status=status.HTTP_201_CREATED)


class VirtualCareAccountDetailView(APIView):
    """Administrators update, deactivate or reactivate accounts in their own organization."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if request.user.role != VirtualCareAccount.Role.ADMIN:
            raise PermissionDenied("Only Virtual Care administrators can manage accounts.")
        account = VirtualCareAccount.objects.filter(
            pk=pk, organization=request.user.organization_id
        ).first()
        if not account:
            raise NotFound("Account not found.")
        changed = []
        for field in ("display_name", "username"):
            if field in request.data:
                value = str(request.data[field]).strip()
                if not value:
                    raise ValidationError({field: "This field cannot be blank."})
                setattr(account, field, value)
                changed.append(field)
        for field, limit in (("specialty", 120), ("phone", 30)):
            if field in request.data:
                setattr(account, field, str(request.data[field]).strip()[:limit])
                changed.append(field)
        if "is_active" in request.data:
            is_active = request.data["is_active"]
            if not isinstance(is_active, bool):
                raise ValidationError({"is_active": "Choose active or inactive."})
            if not is_active and str(account.pk) == str(request.user.id):
                raise ValidationError({"is_active": "You cannot deactivate your own account."})
            account.is_active = is_active
            changed.append("is_active")
        if "password" in request.data:
            if len(request.data["password"]) < 8:
                raise ValidationError({"password": "Use a password with at least 8 characters."})
            account.password = make_password(request.data["password"])
            changed.append("password")
        if not changed:
            raise ValidationError({"detail": "Nothing to update."})
        try:
            account.save(update_fields=changed)
        except IntegrityError as exc:
            raise ValidationError({"username": "That username is already registered."}) from exc
        return Response(virtualcare_account_payload(account))


class VirtualCareProfileView(APIView):
    """Any Virtual Care user can view and update their own name, phone and password."""

    permission_classes = [IsAuthenticated]

    def _account(self, request):
        account = VirtualCareAccount.objects.filter(pk=request.user.id).first()
        if not account:
            raise PermissionDenied("This profile is only available to Virtual Care accounts.")
        return account

    def get(self, request):
        return Response(virtualcare_account_payload(self._account(request)))

    def patch(self, request):
        account = self._account(request)
        changed = []
        if "display_name" in request.data:
            name = str(request.data["display_name"]).strip()
            if not name:
                raise ValidationError({"display_name": "Enter your name."})
            account.display_name = name
            changed.append("display_name")
        if "phone" in request.data:
            account.phone = str(request.data["phone"]).strip()[:30]
            changed.append("phone")
        if "new_password" in request.data:
            if not check_password(request.data.get("current_password", ""), account.password):
                raise ValidationError({"current_password": "The current password is incorrect."})
            if len(request.data["new_password"]) < 8:
                raise ValidationError({"new_password": "Use a password with at least 8 characters."})
            account.password = make_password(request.data["new_password"])
            changed.append("password")
        if not changed:
            raise ValidationError({"detail": "Nothing to update."})
        account.save(update_fields=changed)
        return Response(virtualcare_account_payload(account))


class VirtualVisitViewSet(viewsets.ModelViewSet):
    queryset = VirtualVisit.objects.all()
    serializer_class = VirtualVisitSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "patient_name",
        "patient_mrn",
        "clinician_name",
        "reason",
        "appointment_id",
    ]
    ordering_fields = ["scheduled_at", "status", "created_at"]
    http_method_names = ["get", "post", "head", "options"]

    TRANSITIONS = {
        VirtualVisit.Status.BOOKED: {VirtualVisit.Status.INTAKE, VirtualVisit.Status.CANCELLED},
        VirtualVisit.Status.INTAKE: {VirtualVisit.Status.WAITING, VirtualVisit.Status.CANCELLED},
        VirtualVisit.Status.WAITING: {VirtualVisit.Status.CONSULTING, VirtualVisit.Status.CANCELLED},
        VirtualVisit.Status.CONSULTING: {VirtualVisit.Status.INTERRUPTED},
        VirtualVisit.Status.INTERRUPTED: {VirtualVisit.Status.WAITING, VirtualVisit.Status.CANCELLED},
        VirtualVisit.Status.COMPLETED: set(),
        VirtualVisit.Status.CANCELLED: set(),
    }

    def get_queryset(self):
        user = self.request.user
        queryset = VirtualVisit.objects.filter(organization=user.organization_id)
        if user.role == "patient":
            queryset = queryset.filter(patient_id=user.patient_id)
        elif user.role == "clinician":
            queryset = queryset.filter(clinician_id=user.clinician_id)
        elif user.role not in {"admin", "receptionist"}:
            raise PermissionDenied("Your role cannot access Virtual Care.")

        params = self.request.query_params
        if params.get("status"):
            queryset = queryset.filter(status=params["status"])
        if params.get("date"):
            queryset = queryset.filter(scheduled_at__date=params["date"])
        if params.get("date_from"):
            queryset = queryset.filter(scheduled_at__date__gte=params["date_from"])
        if params.get("date_to"):
            queryset = queryset.filter(scheduled_at__date__lte=params["date_to"])
        return queryset

    def create(self, request, *args, **kwargs):
        key = (
            request.headers.get("Idempotency-Key")
            or request.data.get("idempotency_key")
            or ""
        ).strip()
        if len(key) > 100:
            raise ValidationError({"idempotency_key": "The key must be 100 characters or fewer."})

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        existing = self._find_existing(request.user.organization_id, values, key)
        if existing:
            self._validate_duplicate(existing, values)
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                visit = self._create_visit(serializer, key)
        except IntegrityError:
            existing = self._find_existing(request.user.organization_id, values, key)
            if existing:
                self._validate_duplicate(existing, values)
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
            raise ValidationError({"appointment_id": "This visit is already booked."})

        self._audit(visit, request.user, "session.booked")
        return Response(
            self.get_serializer(visit).data,
            status=status.HTTP_201_CREATED,
        )

    @staticmethod
    def _find_existing(organization, values, key):
        query = VirtualVisit.objects.filter(organization=organization)
        if key:
            found = query.filter(idempotency_key=key).first()
            if found:
                return found
        appointment_id = values.get("appointment_id", "")
        if appointment_id:
            return query.filter(appointment_id=appointment_id).first()
        return None

    @staticmethod
    def _validate_duplicate(existing, values):
        if (
            existing.patient_id != values["patient_id"]
            or existing.clinician_id != values["clinician_id"]
            or existing.scheduled_at != values["scheduled_at"]
            or existing.appointment_id != values.get("appointment_id", "")
        ):
            raise ValidationError(
                {"appointment_id": "This appointment is already linked to a different visit."}
            )

    def _create_visit(self, serializer, idempotency_key):
        user = self.request.user
        if user.role not in {"admin", "receptionist", "clinician", "patient"}:
            raise PermissionDenied("Your role cannot schedule virtual visits.")
        values = serializer.validated_data
        patient_id = str(values["patient_id"])
        clinician_id = str(values["clinician_id"])
        scheduled_at = values["scheduled_at"]
        if (
            scheduled_at.minute not in (0, 30)
            or scheduled_at.second
            or scheduled_at.microsecond
        ):
            raise ValidationError(
                {"scheduled_at": "Choose a 30-minute slot on the hour or half-hour."}
            )
        if getattr(user, "identity_mode", "hospital") == "virtualcare":
            patient_exists = VirtualCareAccount.objects.filter(
                organization=user.organization_id,
                role=VirtualCareAccount.Role.PATIENT,
                patient_id=patient_id,
                is_active=True,
            ).exists()
            clinician_exists = VirtualCareAccount.objects.filter(
                organization=user.organization_id,
                role=VirtualCareAccount.Role.CLINICIAN,
                clinician_id=clinician_id,
                is_active=True,
            ).exists()
            if not patient_exists or not clinician_exists:
                raise ValidationError(
                    {"detail": "Choose a patient and clinician from the Virtual Care directory."}
                )
        if user.role == "patient" and patient_id != user.patient_id:
            raise PermissionDenied("You can only schedule a visit for your own patient record.")
        if user.role == "clinician" and clinician_id != user.clinician_id:
            raise PermissionDenied("You can only schedule a visit with yourself as clinician.")
        visit = serializer.save(
            organization=user.organization_id,
            idempotency_key=idempotency_key,
            created_by=user.id,
        )
        return visit

    @action(detail=True, methods=["post"])
    def consent(self, request, pk=None):
        visit = self.get_object()
        if request.user.role != "patient" or str(visit.patient_id) != request.user.patient_id:
            raise PermissionDenied("Only the patient can grant or revoke virtual-care consent.")
        granted = request.data.get("granted")
        if not isinstance(granted, bool):
            raise ValidationError({"granted": "Choose whether to grant or revoke consent."})
        visit.consent_active = granted
        visit.consent_updated_at = timezone.now()
        visit.consent_revision += 1
        if not granted and visit.status == VirtualVisit.Status.CONSULTING:
            visit.status = VirtualVisit.Status.INTERRUPTED
        visit.save(
            update_fields=[
                "consent_active",
                "consent_updated_at",
                "consent_revision",
                "status",
                "updated_at",
            ]
        )
        self._audit(visit, request.user, "consent.granted" if granted else "consent.revoked")
        return Response(self.get_serializer(visit).data)

    @action(detail=True, methods=["post"])
    def intake(self, request, pk=None):
        visit = self.get_object()
        if request.user.role not in {"patient", "admin", "receptionist"}:
            raise PermissionDenied("Only the patient or reception can complete intake.")
        if request.user.role == "patient" and str(visit.patient_id) != request.user.patient_id:
            raise PermissionDenied("You can only complete intake for your own visit.")
        self._require_consent(visit)
        if visit.status != VirtualVisit.Status.INTAKE:
            raise ValidationError({"status": "Move the booked visit to intake before entering these details."})

        reason = str(request.data.get("reason", "")).strip()
        verified = request.data.get("verified")
        interpreter_requested = request.data.get("interpreter_requested", False)
        language = str(request.data.get("language", "")).strip()
        if not reason:
            raise ValidationError({"reason": "Enter a reason for the visit."})
        if verified is not True:
            raise ValidationError({"verified": "Confirm the check-in verification to continue."})
        if not isinstance(interpreter_requested, bool):
            raise ValidationError({"interpreter_requested": "Choose yes or no."})
        if interpreter_requested and not language:
            raise ValidationError({"language": "Enter the requested interpreter language."})

        visit.reason = reason
        visit.verified = verified
        visit.interpreter_requested = interpreter_requested
        visit.language = language if interpreter_requested else ""
        visit.save(
            update_fields=[
                "reason",
                "verified",
                "interpreter_requested",
                "language",
                "updated_at",
            ]
        )
        self._audit(visit, request.user, "intake.completed")
        return Response(self.get_serializer(visit).data)

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        visit = self.get_object()
        target = request.data.get("status")
        if target == visit.status == VirtualVisit.Status.CANCELLED:
            return Response(self.get_serializer(visit).data)
        allowed = self.TRANSITIONS.get(visit.status, set())
        if target not in allowed:
            raise ValidationError({"status": "This virtual-care session cannot move to that stage."})

        if target == VirtualVisit.Status.INTAKE and request.user.role not in {
            "patient",
            "admin",
            "receptionist",
        }:
            raise PermissionDenied("Only the patient or reception can begin intake.")
        if target == VirtualVisit.Status.WAITING and visit.status == VirtualVisit.Status.INTAKE:
            if request.user.role not in {"patient", "admin", "receptionist"}:
                raise PermissionDenied("Only the patient or reception can submit intake.")
            if request.user.role == "patient" and str(visit.patient_id) != request.user.patient_id:
                raise PermissionDenied("You can only submit intake for your own visit.")
        if target in {
            VirtualVisit.Status.INTAKE,
            VirtualVisit.Status.WAITING,
            VirtualVisit.Status.CONSULTING,
        }:
            self._require_consent(visit)
        if target == VirtualVisit.Status.WAITING and (
            not visit.reason or not visit.verified
        ):
            raise ValidationError({"intake": "Complete the visit reason and check-in verification first."})
        if target == VirtualVisit.Status.WAITING and visit.interpreter_requested and not visit.language:
            raise ValidationError({"language": "Add the requested interpreter language before joining the queue."})
        if target in {VirtualVisit.Status.CONSULTING, VirtualVisit.Status.INTERRUPTED}:
            if request.user.role != "clinician" or str(visit.clinician_id) != request.user.clinician_id:
                raise PermissionDenied("Only the assigned clinician can control the consultation.")
        if target == VirtualVisit.Status.WAITING and visit.status == VirtualVisit.Status.INTERRUPTED:
            if request.user.role != "clinician" or str(visit.clinician_id) != request.user.clinician_id:
                raise PermissionDenied("Only the assigned clinician can resume the session.")
        if target == VirtualVisit.Status.CANCELLED:
            if request.user.role == "patient":
                if str(visit.patient_id) != request.user.patient_id:
                    raise PermissionDenied("You can only cancel your own virtual visit.")
            elif request.user.role not in {"admin", "receptionist"}:
                raise PermissionDenied("Your role cannot cancel virtual visits.")

        visit.status = target
        update_fields = ["status", "updated_at"]
        if target == VirtualVisit.Status.CONSULTING and not visit.call_started_at:
            visit.call_started_at = timezone.now()
            update_fields.append("call_started_at")
        visit.save(update_fields=update_fields)
        self._audit(visit, request.user, f"session.{target}")
        return Response(self.get_serializer(visit).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        visit = self.get_object()
        if request.user.role != "clinician" or str(visit.clinician_id) != request.user.clinician_id:
            raise PermissionDenied("Only the assigned clinician can complete this consultation.")
        if visit.status != VirtualVisit.Status.CONSULTING:
            raise ValidationError({"status": "Only an active consultation can be completed."})
        self._require_consent(visit)

        note = str(request.data.get("note", "")).strip()
        summary = str(request.data.get("summary", "")).strip()
        follow_up_plan = str(request.data.get("follow_up_plan", "")).strip()
        follow_up_date = request.data.get("follow_up_date")
        lab_orders = request.data.get("lab_orders", [])
        prescriptions = request.data.get("prescriptions", [])
        if not note or not summary:
            raise ValidationError({"note": "A consultation note and visit summary are required."})
        if not isinstance(lab_orders, list) or not isinstance(prescriptions, list):
            raise ValidationError({"follow_up_actions": "Lab orders and prescriptions must be lists."})
        for index, lab_order in enumerate(lab_orders):
            if not isinstance(lab_order, dict) or not str(lab_order.get("test_name", "")).strip():
                raise ValidationError({"lab_orders": f"Lab order {index + 1} needs a test name."})
        for index, prescription in enumerate(prescriptions):
            if (
                not isinstance(prescription, dict)
                or not str(prescription.get("medication", "")).strip()
                or not str(prescription.get("dosage", "")).strip()
            ):
                raise ValidationError(
                    {"prescriptions": f"Prescription {index + 1} needs a medication and dose."}
                )
        if follow_up_date:
            try:
                follow_up_date = date.fromisoformat(follow_up_date)
            except (TypeError, ValueError):
                raise ValidationError({"follow_up_date": "Enter a valid follow-up date."})

        visit.note = note
        visit.summary = summary
        visit.follow_up_plan = follow_up_plan
        visit.follow_up_date = follow_up_date
        visit.lab_orders = [
            {"test_name": str(item["test_name"]).strip()}
            for item in lab_orders
        ]
        visit.prescriptions = [
            {
                "medication": str(item["medication"]).strip(),
                "dosage": str(item["dosage"]).strip(),
                "instructions": str(item.get("instructions", "")).strip(),
            }
            for item in prescriptions
        ]
        visit.status = VirtualVisit.Status.COMPLETED
        visit.save(
            update_fields=[
                "note",
                "summary",
                "follow_up_plan",
                "follow_up_date",
                "lab_orders",
                "prescriptions",
                "status",
                "updated_at",
            ]
        )
        visit.completion_signature = self._completion_signature(visit)
        visit.save(update_fields=["completion_signature", "updated_at"])
        self._audit(
            visit,
            request.user,
            "session.completed",
            {"appointment_id": visit.appointment_id},
        )
        return Response(self.get_serializer(visit).data)

    @staticmethod
    def _completion_signature(visit):
        payload = {
            "appointment_id": visit.appointment_id,
            "session_id": str(visit.pk),
            "patient_id": visit.patient_id,
            "clinician_id": visit.clinician_id,
            "consent_revision": visit.consent_revision,
            "note": visit.note,
            "summary": visit.summary,
            "follow_up_plan": visit.follow_up_plan,
            "follow_up_date": visit.follow_up_date.isoformat() if visit.follow_up_date else "",
            "lab_orders": visit.lab_orders,
            "prescriptions": visit.prescriptions,
        }
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        secret = settings.VIRTUALCARE_SYNC_SECRET.encode("utf-8")
        return hmac.new(secret, serialized.encode("utf-8"), hashlib.sha256).hexdigest()

    @action(detail=True, methods=["post"], url_path="mark-hospital-synced")
    def mark_hospital_synced(self, request, pk=None):
        visit = self.get_object()
        if request.user.role not in {"clinician", "admin"}:
            raise PermissionDenied("Only clinical staff can synchronize the hospital record.")
        if request.user.role == "clinician" and str(visit.clinician_id) != request.user.clinician_id:
            raise PermissionDenied("You can only synchronize your own virtual visits.")
        if visit.status != VirtualVisit.Status.COMPLETED or not visit.appointment_id:
            raise ValidationError({"status": "This completed visit has no linked hospital appointment."})
        visit.hospital_synced_at = visit.hospital_synced_at or timezone.now()
        visit.save(update_fields=["hospital_synced_at", "updated_at"])
        self._audit(visit, request.user, "hospital_record.synchronized")
        return Response(self.get_serializer(visit).data)

    @action(detail=False, methods=["get"])
    def queue(self, request):
        visits = self.filter_queryset(
            self.get_queryset().filter(status=VirtualVisit.Status.WAITING)
        )
        page = self.paginate_queryset(visits)
        serializer = self.get_serializer(page or visits, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @staticmethod
    def _require_consent(visit):
        if not visit.consent_active:
            raise ValidationError({"consent": "Active virtual-care consent is required to continue."})

    @staticmethod
    def _audit(visit, user, action, details=None):
        VirtualAuditEvent.objects.create(
            organization=visit.organization,
            visit=visit,
            actor_id=user.id,
            action=action,
            details=details or {},
        )

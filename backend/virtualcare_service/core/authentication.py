import json
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from django.conf import settings
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import APIException, AuthenticationFailed
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from .models import VirtualCareAccount


class HospitalIdentityUnavailable(APIException):
    status_code = 503
    default_detail = "Hospital identity verification is unavailable. Try again later."


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_hospital_identity(token_text, claims):
    request = Request(
        settings.HOSPITAL_IDENTITY_URL,
        headers={"Authorization": f"Bearer {token_text}", "Accept": "application/json"},
    )
    try:
        with build_opener(NoRedirect()).open(request, timeout=3) as response:
            identity = json.load(response)
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise AuthenticationFailed("The hospital account is no longer authorized.") from exc
        raise HospitalIdentityUnavailable() from exc
    except (URLError, TimeoutError, ValueError) as exc:
        raise HospitalIdentityUnavailable() from exc
    expected = {
        "id": claims.get("user_id"),
        "role": claims.get("role"),
        "organization": claims.get("organization_id"),
        "patient_id": claims.get("patient_id"),
        "clinician_id": claims.get("clinician_id"),
    }
    if not isinstance(identity, dict) or any(
        str(identity.get(key) or "") != str(value or "") for key, value in expected.items()
    ):
        raise AuthenticationFailed("The hospital account identity has changed.")


class VirtualCareUser:
    is_authenticated = True
    is_anonymous = False

    def __init__(self, claims, account=None):
        self.id = str(claims.get("user_id", ""))
        self.role = claims.get("role", "")
        self.organization_id = claims.get("organization_id", "")
        self.patient_id = claims.get("patient_id", "")
        self.clinician_id = claims.get("clinician_id", "")
        self.identity_mode = "hospital"
        self.is_active = True
        if account:
            self.id = str(account.pk)
            self.role = account.role
            self.organization_id = account.organization
            self.patient_id = account.patient_id
            self.clinician_id = account.clinician_id
            self.display_name = account.display_name
            self.identity_mode = "virtualcare"
            self.is_active = account.is_active


class VirtualCareTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header:
            return None
        if header[0].lower() != b"bearer" or len(header) != 2:
            raise AuthenticationFailed("Use a valid Bearer access token.")
        try:
            token = AccessToken(header[1].decode("utf-8"))
        except (UnicodeDecodeError, TokenError) as exc:
            raise AuthenticationFailed("The access token is invalid or expired.") from exc

        account_id = token.get("virtualcare_account_id")
        if account_id:
            account = VirtualCareAccount.objects.filter(
                pk=account_id, is_active=True
            ).first()
            if not account:
                raise AuthenticationFailed("The Virtual Care account is inactive or no longer exists.")
            if str(token.get("organization_id", "")) != account.organization:
                raise AuthenticationFailed("The Virtual Care account token is invalid.")
            user = VirtualCareUser(token, account)
        else:
            verify_hospital_identity(header[1].decode("utf-8"), token)
            user = VirtualCareUser(token)
        if not user.organization_id or not user.role:
            raise AuthenticationFailed("The access token is missing required identity claims.")
        return user, token

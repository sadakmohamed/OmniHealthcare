import os
from pathlib import Path
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent
SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "django-insecure-demo-only-key-that-is-at-least-32-characters",
)
VIRTUALCARE_SYNC_SECRET = os.getenv("VIRTUALCARE_SYNC_SECRET", SECRET_KEY)
VIRTUALCARE_BOOTSTRAP_KEY = os.getenv("VIRTUALCARE_BOOTSTRAP_KEY", "")
HOSPITAL_IDENTITY_URL = os.getenv(
    "HOSPITAL_IDENTITY_URL", "http://127.0.0.1:8000/api/v1/me/"
)
DEBUG = os.getenv("DJANGO_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = os.getenv(
    "DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,virtualcare"
).split(",")

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "rest_framework",
    "virtualcare_service.core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "virtualcare_service.urls"
WSGI_APPLICATION = "virtualcare_service.wsgi.application"

DATABASE_URL = os.getenv("VIRTUALCARE_DATABASE_URL")
if DATABASE_URL:
    import dj_database_url

    DATABASES = {
        "default": dj_database_url.parse(DATABASE_URL, conn_max_age=60),
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "virtualcare.sqlite3",
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"
SIMPLE_JWT = {
    "SIGNING_KEY": SECRET_KEY,
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
}
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "virtualcare_service.core.authentication.VirtualCareTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": [
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
}

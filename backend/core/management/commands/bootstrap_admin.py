"""Interactively create an organization and its initial administrator."""

from getpass import getpass

from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Organization


class Command(BaseCommand):
    help = "Create an organization and initial administrator without demo accounts."

    def handle(self, *args, **options):
        name = input("Organization name: ").strip()
        code = input("Organization code: ").strip()
        username = input("Administrator username: ").strip()
        if not name or not code or not username:
            raise CommandError("Organization name, code, and username are required.")
        if Organization.objects.filter(code=code).exists():
            raise CommandError("Organization code already exists.")
        User = get_user_model()
        if User.objects.filter(username=username).exists():
            raise CommandError("Username already exists.")
        password = getpass("Administrator password: ")
        if password != getpass("Confirm password: "):
            raise CommandError("Passwords do not match.")
        user = User(username=username, role=User.Role.ADMIN)
        try:
            user.full_clean(exclude=["password"])
            password_validation.validate_password(password, user)
        except ValidationError as exc:
            raise CommandError("; ".join(exc.messages)) from exc
        with transaction.atomic():
            organization = Organization.objects.create(name=name, code=code)
            User.objects.create_superuser(
                username=username, password=password, role=User.Role.ADMIN,
                organization=organization,
            )
        self.stdout.write(self.style.SUCCESS("Organization and administrator created."))

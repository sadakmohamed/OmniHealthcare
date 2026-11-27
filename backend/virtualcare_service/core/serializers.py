from rest_framework import serializers

from .models import VirtualAuditEvent, VirtualVisit


class VirtualAuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = VirtualAuditEvent
        fields = ["id", "actor_id", "action", "details", "created_at"]


class VirtualVisitSerializer(serializers.ModelSerializer):
    audit_events = VirtualAuditEventSerializer(many=True, read_only=True)

    class Meta:
        model = VirtualVisit
        fields = "__all__"
        read_only_fields = [
            "id",
            "organization",
            "idempotency_key",
            "status",
            "consent_active",
            "consent_updated_at",
            "consent_revision",
            "verified",
            "call_started_at",
            "note",
            "summary",
            "follow_up_plan",
            "follow_up_date",
            "lab_orders",
            "prescriptions",
            "completion_signature",
            "hospital_synced_at",
            "created_by",
            "created_at",
            "updated_at",
            "audit_events",
        ]

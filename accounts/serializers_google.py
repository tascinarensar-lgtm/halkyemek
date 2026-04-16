from rest_framework import serializers

class GoogleLoginSerializer(serializers.Serializer):
    id_token = serializers.CharField()

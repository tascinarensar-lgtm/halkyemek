from django.urls import path

from accounts.api.views import AuthMeView
from accounts.views_google import GoogleLoginAPIView

urlpatterns = [
    path("google/", GoogleLoginAPIView.as_view(), name="auth_google"),
    path("me/", AuthMeView.as_view(), name="auth_me"),
]

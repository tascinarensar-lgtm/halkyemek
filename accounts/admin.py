from django.contrib import admin
from .models import User
 
# Register your models here
# admin.site.register(User, UserAdmin) #eski yöntem

@admin.register(User) #user modelini admin paneline koyduk (yeni yöntem
class UserAdmin(admin.ModelAdmin): #özelleştirilmiş User classu 
    # Not: ('id''username', ...) ifadesi Python'da string birleştirir ve admin'i kırar.
    list_display = ('id', 'username', 'email', 'role', 'is_active', 'is_staff')
    list_filter = ('role', 'is_active')
    search_fields = ('username', 'email')





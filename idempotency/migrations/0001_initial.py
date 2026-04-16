# Generated manually for the project (Django 3.1+ compatible)

import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='IdempotencyRecord',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('key', models.CharField(max_length=128)),
                ('scope', models.CharField(max_length=64)),
                ('status', models.CharField(choices=[('IN_PROGRESS', 'In progress'), ('COMPLETED', 'Completed'), ('FAILED', 'Failed')], default='IN_PROGRESS', max_length=16)),
                ('response_status', models.PositiveSmallIntegerField(blank=True, null=True)),
                ('response_body', models.JSONField(blank=True, null=True)),
                ('error_code', models.CharField(blank=True, max_length=64, null=True)),
                ('error_message', models.TextField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='idempotency_records', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'indexes': [
                    models.Index(fields=['user', 'scope', 'key'], name='idempotency_user_scope_key_idx'),
                    models.Index(fields=['status', 'created_at'], name='idempotency_status_created_at_idx'),
                ],
            },
        ),
        migrations.AddConstraint(
            model_name='idempotencyrecord',
            constraint=models.UniqueConstraint(fields=('user', 'scope', 'key'), name='uniq_idempotency_user_scope_key'),
        ),
    ]

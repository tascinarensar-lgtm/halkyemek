from io import StringIO

from django.core.management import call_command
from django.test import Client, SimpleTestCase, override_settings
import yaml


@override_settings(GOOGLE_OAUTH_CLIENT_ID="test-client-id")
class OpenApiSchemaGenerationTests(SimpleTestCase):
    def test_spectacular_schema_validate_runs_without_warnings(self):
        out = StringIO()
        err = StringIO()
        call_command("spectacular", "--validate", stdout=out, stderr=err)
        stderr = err.getvalue().lower()
        self.assertNotIn("warning", stderr)
        self.assertNotIn("error", stderr)

    def test_schema_and_docs_endpoints_render(self):
        client = Client()

        schema_response = client.get("/api/schema/")
        self.assertEqual(schema_response.status_code, 200)
        schema = yaml.safe_load(schema_response.content.decode("utf-8"))
        self.assertIn("paths", schema)
        self.assertIn("/api/v1/discovery/home/", schema["paths"])
        self.assertIn("/api/v1/payments/ops/settlement/dashboard/", schema["paths"])
        self.assertIn("/api/v1/notifications/devices/", schema["paths"])

        docs_response = client.get("/api/docs/")
        self.assertEqual(docs_response.status_code, 200)
        self.assertContains(docs_response, "swagger-ui")

    def test_schema_contains_updated_operation_ids(self):
        out = StringIO()
        call_command("spectacular", stdout=out)
        content = out.getvalue()
        self.assertIn("operationId: discovery_home", content)
        self.assertIn("operationId: catalog_business_detail", content)
        self.assertIn("operationId: notification_list", content)
        self.assertIn("operationId: ops_payout_dashboard", content)

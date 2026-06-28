import json
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, override_settings

from notifications.fcm import send_fcm_message


class FcmPayloadTests(SimpleTestCase):
    @override_settings(FCM_PROJECT_ID="notifications-test")
    @patch("notifications.fcm._access_token", return_value="access-token")
    @patch("notifications.fcm.requests.post")
    def test_web_push_payload_is_data_only_so_service_worker_displays_it(self, mock_post: Mock, _mock_token: Mock):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"name": "projects/test/messages/1"}
        mock_post.return_value = response

        result = send_fcm_message(
            token="fcm-token",
            title="Duyuru",
            body="Yeni bildirim",
            data={"url": "http://localhost:3000/bildirimler"},
        )

        self.assertEqual(result, {"name": "projects/test/messages/1"})
        request_payload = json.loads(mock_post.call_args.kwargs["data"])
        message = request_payload["message"]
        self.assertNotIn("notification", message)
        self.assertEqual(message["data"]["title"], "Duyuru")
        self.assertEqual(message["data"]["body"], "Yeni bildirim")
        self.assertEqual(message["webpush"]["fcm_options"]["link"], "http://localhost:3000/bildirimler")

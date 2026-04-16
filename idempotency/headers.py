# Django request.META içinde header isimleri "HTTP_" prefix ile gelir.
# Client tarafında: "Idempotency-Key: <uuid>" gönderileceği için
# request.META'da "HTTP_IDEMPOTENCY_KEY" olarak okunur.
IDEMPOTENCY_META_KEY = 'HTTP_IDEMPOTENCY_KEY'

"""
client header gönderdi mi? göndermediyse işlemi durdur tarzı kontroller yapmak için request.meta.get kullanımı ile içerisinden alınacak key
 karışıklık olmasın okunurluk düzgün olsun diyre oluşturuldu
"""


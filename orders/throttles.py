from rest_framework.throttling import SimpleRateThrottle # brute-force attaklarını engellemek için kullanılır. Limit motoru.
 
class LoginRateThrottle(SimpleRateThrottle): # simpleRateThrottle classından miras alıyoruz
    scope = 'login' #scope bu sınıfın bir özelliğidir. settingse yaptığım bir ayarlama sayesinde login kısmını alıyorum 10 dakikalık bir ayarımız var. HANGİ İŞLEM OLDUĞNU ALDIK

    def get_cache_key(self, request, view): # bu fonksiyon request ve view parametresini alacak isteği yapan kişiyi kriteri belirlemek için.
        ident = self.get_ident(request) #isteği yapan kişinin ip adresini alıyorum
        return self.cache_format % {"scope": self.scope, "ident": ident} #scope ve ident degerlerini alıp işlem miktarlarını hesaplar ve limit belirler aşılırsa eğer hata döndürür.

class OrderCreateRateThrottle(SimpleRateThrottle):
    scope = "orders_create" # scope bu sınıfın bir özelliğidir. settingse yaptığım bir ayarlama sayesinde order_create kısmını alıyorum 12 dakikalık bir ayarımız var. HANGİ İŞLEM OLDUĞNU ALDIK
    def get_cache_key(self, request, view): # bu fonksiyon request ve view parametresini alacak isteği yapan kişiyi kriteri belirlemek için.
        if request.user and request.user.is_authenticated: #kullanıcı varsa kullanıcıyı alacağız
            ident = str(request.user.pk)
        else:
            ident = self.get_ident(request) #kullanıcı yoksa ip adresini alcağız 
        return self.cache_format % {"scope": self.scope, "ident": ident}

class OrderUseRateThrottle(SimpleRateThrottle):
    scope = "orders_use"

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            ident = str(request.user.pk)
        else:
            ident = self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}
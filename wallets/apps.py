from django.apps import AppConfig


class WalletsConfig(AppConfig):
    name = 'wallets'

    def ready(self): #bu fonksiyon djangonun bütün projeyi algılayıp okuduğu zmaanı temsil ediyor.
        # Signal kayıtları
        from . import signals  # noqa: F401

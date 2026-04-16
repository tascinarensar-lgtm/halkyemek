from django.db.models.signals import post_save #bir model save edildikten sonra çalıştırılacak herhangi bir iey için. method olabilir
from django.dispatch import receiver #post_save methodunun bir modelin save edlimesini anlık izleyip takip edip dinlemesi için 
from django.conf import settings

from .models import Wallet


@receiver(post_save, sender=settings.AUTH_USER_MODEL) #receiver ile post save methodunun user modelini dinlemesini söyledik ve ardından aşağıdaki methodu çalıştırmasını istedik.
def create_wallet_for_user(sender, instance, created, **kwargs): #bu parametrelerin hepsi zorunlu 
    """Yeni kullanıcı oluşunca otomatik cüzdan aç.

    Not: Bu, geliştirme/mvp için kritik bir ergonomi sağlar; üretimde de
    kullanıcı onboarding'inde cüzdan yaratma adımını garanti eder.
    """

    if not created: #true gelmemişse bu parametreye yani createed olmamışsa otomatik algılar django bunu 
        return

    Wallet.objects.get_or_create(user=instance)

from __future__ import annotations 

"""“Eğer veri cache’te varsa onu ver.
Yoksa üret, cache’e koy, sonra ver.”"""

from django.core.cache import cache #geçici hafızamızı dahil ettik settings.py içindeki CACHES ayarını kullanır
from typing import Callable, TypeVar

T = TypeVar("T") #fonksiyon hangi tip dönerse dönsün, onu aynen döndürmek için kullanacağız yani gerekli değil ama por sistemde olması güzel


def cached(key: str, ttl: int, fn: Callable[[], T]) -> T: # caache ismi, kaç saniyr saklasın,Eğer cache’te yoksa çalışacak fonksiyon
    val = cache.get(key) # “Bu isimli key ile cache’te veri var mı?”
    if val is not None: #eğer atadığımz değer boş değilse
        return val # db ye gitmene gerek yok val ı döndür
    val = fn() #eğer cache de yoksa fonksiyonu çalıştır. (fn yukarıdaki parmametreden gelen method sorgusudur. menu.objectsall gibi)
    cache.set(key, val, ttl) # daha sonra bütün objelerimizi cache ye set eidyoruz
    return val # val ı döndürüyoruz en son
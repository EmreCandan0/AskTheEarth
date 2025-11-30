# CDSE Downloader - Basit Kullanım

## 📋 Özellikler

✅ YAML konfigürasyondan ayarları okur  
✅ Tek ürün indirme (threading/queue YOK)  
✅ Otomatik ZIP extract  
✅ Email/mail özellikleri YOK  
✅ Basit ve temiz kod yapısı  

## 🚀 Kurulum

```bash
# Gereksinimleri yükle
pip install pyyaml requests
```

## ⚙️ Konfigürasyon

`app/config/downloader.yaml` dosyasını düzenleyin:

```yaml
# Kullanıcı bilgileri
CDSE_USERNAME: "your-email@example.com"
CDSE_PASSWORD: "your-password"

# Dosya yolları
OUTPUT_PATH: "./downloads"
EXTRACT_PATH: "./extracted"
GEOJSON_PATH: "./selanik.geojson"

# Sentinel ayarları
COLLECTION_NAME: "SENTINEL-2"
PRODUCT_TYPE: "S2MSI2A"
GRID_CODE:
  - "34TFL"
  - "34TFK"

CLOUDCOVER_MAX: 20

# Tarih ayarları
DATE_AUTO: true
DATE_AUTO_RANGE: 20
START_DATE: "2025-07-28"
END_DATE: "2025-07-30"

# Maksimum ürün sayısı
MAX_PRODUCTS: 10
```

## 🎯 Kullanım

### 1. Script Olarak Çalıştırma

```bash
python app/service/downloader.py
```

Bu komut:
1. Konfigürasyonu okur
2. CDSE'den token alır
3. En yeni 1 ürünü arar
4. İndirir
5. Otomatik extract eder

### 2. Python Kodu Olarak

```python
from app.service.downloader import download_single_product

# Tek ürün indir ve extract et
result = download_single_product(extract_after_download=True)

if result["success"]:
    print(f"✓ İndirme başarılı!")
    print(f"Ürün: {result['product']['name']}")
    print(f"Dosya: {result['product']['downloaded_file']}")
    print(f"Klasör: {result['product']['extracted_folder']}")
else:
    print(f"✗ Hata: {result['message']}")
```

### 3. Fonksiyonları Tek Tek Kullanma

```python
from app.service.downloader import (
    get_access_token,
    search_products,
    download_product,
    extract_zip,
    calculate_dates
)

# 1. Token al
token = get_access_token()

# 2. Tarih aralığını hesapla
start_date, end_date = calculate_dates()

# 3. Ürün ara
products = search_products(token, start_date, end_date, max_results=5)
print(f"Bulunan ürün sayısı: {len(products)}")

# 4. İlk ürünü indir
if products:
    product = products[0]
    result = download_product(
        token,
        product['Id'],
        product['Name'],
        "./downloads"
    )
    
    # 5. Extract et
    if result["success"]:
        extract_result = extract_zip(result["filename"])
        print(f"Extract klasörü: {extract_result['folder']}")
```

## 📂 Dosya Yapısı

```
asktheearth/
├── app/
│   ├── config/
│   │   └── downloader.yaml       # Konfigürasyon
│   └── service/
│       └── downloader.py          # Ana script
├── downloads/                     # İndirilen ZIP dosyaları
├── extracted/                     # Extract edilen SAFE klasörleri
└── selanik.geojson               # GeoJSON alan filtresi
```

## 🔧 Fonksiyonlar

### `download_single_product(extract_after_download=True)`
Ana fonksiyon - Tek bir ürün indirir.

**Parametreler:**
- `extract_after_download` (bool): İndirdikten sonra extract edilsin mi?

**Döndürür:**
```python
{
    "success": True/False,
    "message": "...",
    "product": {
        "name": "S2A_MSIL2A_...",
        "id": "abc-123",
        "downloaded_file": "./downloads/...",
        "extracted_folder": "./extracted/..."
    }
}
```

### `get_access_token()`
CDSE access token alır.

### `search_products(token, start_date, end_date, wkt_polygon, max_results)`
Ürün arar ve liste döner.

### `download_product(token, product_id, product_name, output_folder)`
Tek bir ürünü indirir.

### `extract_zip(zip_path)`
ZIP dosyasını extract eder.

### `calculate_dates()`
Config'e göre tarih aralığı hesaplar.

### `geojson_to_wkt(geojson_path)`
GeoJSON'u WKT formatına çevirir.

## 📝 Örnek Çıktı

```
======================================================================
  CDSE Downloader - Tek Ürün İndirme
======================================================================

[CONFIG] ✓ Configuration loaded from: app/config/downloader.yaml
[CONFIG] Collection: SENTINEL-2, Product Type: S2MSI2A
[CONFIG] Output: ./downloads, Extract: ./extracted
[CDSE] Getting access token...
[CDSE] ✓ Access token received
[CDSE] Date range: 2025-11-10 to 2025-11-30
[CDSE] ✓ GeoJSON loaded: ./selanik.geojson
[CDSE] Searching for products...
[CDSE] Found 5 product(s)
[CDSE] Selected product: S2A_MSIL2A_20251128T094031_N0511_R036_T34TFL_20251128T114725
[CDSE] Product ID: abc-123-def-456
[CDSE] Size: 1.23 GB
[DOWNLOAD] Starting: S2A_MSIL2A_20251128T094031_N0511_R036_T34TFL_20251128T114725.zip
[DOWNLOAD] Progress: 100.0%
[DOWNLOAD] ✓ Completed: S2A_MSIL2A_20251128T094031_N0511_R036_T34TFL_20251128T114725.zip
[EXTRACT] Starting: S2A_MSIL2A_20251128T094031_N0511_R036_T34TFL_20251128T114725.zip
[EXTRACT] ✓ Extracted and renamed to: S2A_S2A_MSIL2A_20251128T094031_N0511_R036_T34TFL_20251128T114725.SAFE

======================================================================
  ✓ İşlem Başarılı!
  Ürün: S2A_MSIL2A_20251128T094031_N0511_R036_T34TFL_20251128T114725
  Dosya: ./downloads/S2A_MSIL2A_20251128T094031_N0511_R036_T34TFL_20251128T114725.zip
  Klasör: ./extracted/S2A_S2A_MSIL2A_20251128T094031_N0511_R036_T34TFL_20251128T114725.SAFE
======================================================================
```

## 🔄 Değişiklikler (Önceki Versiyona Göre)

### ✅ Eklendi
- YAML konfigürasyon okuma
- Basit tek ürün indirme
- İndirme progress bar'ı

### ❌ Kaldırıldı
- Threading sistemi
- Queue yapısı
- Email gönderme/alma
- Batch indirme
- Otomatik döngü (while loop)
- Worker threads
- Mail fonksiyonları

## ❓ Sık Sorulan Sorular

**S: Birden fazla ürün nasıl indiririm?**  
C: Script'i birden fazla kez çalıştırın veya `search_products()` fonksiyonunu kullanarak döngü oluşturun.

**S: GeoJSON kullanmak zorunda mıyım?**  
C: Hayır. Dosya yoksa veya okunamazsa otomatik olarak atlanır.

**S: Eski indirilen dosyalar silinir mi?**  
C: Hayır. Eğer dosya zaten varsa tekrar indirilmez.

**S: Extract işlemini devre dışı bırakabilir miyim?**  
C: Evet: `download_single_product(extract_after_download=False)`

## 🆘 Hata Giderme

### ModuleNotFoundError: yaml
```bash
pip install pyyaml
```

### ModuleNotFoundError: requests
```bash
pip install requests
```

### Authentication Error
- `CDSE_USERNAME` ve `CDSE_PASSWORD` doğru mu kontrol edin
- CDSE hesabınız aktif mi kontrol edin

### No products found
- Tarih aralığını genişletin
- `CLOUDCOVER_MAX` değerini artırın
- `GRID_CODE` filtrelerini kaldırın veya değiştirin

---

**Son Güncelleme:** 30 Kasım 2025  
**Versiyon:** 1.0 (Basit)

# AskTheEarth - Sentinel-2 Downloader & NDVI API

Copernicus Data Space Ecosystem (CDSE) üzerinden Sentinel-2 uydu görüntülerini indiren ve NDVI hesaplaması yapan FastAPI servisi.

## 📋 Özellikler

- ✅ Sentinel-2 L2A ürünlerini CDSE'den indirme
- ✅ GeoJSON ile coğrafi filtreleme
- ✅ Otomatik ZIP extract
- ✅ NDVI (Normalized Difference Vegetation Index) hesaplama
- ✅ RESTful API arayüzü
- ✅ Environment variable ile güvenli credential yönetimi

## 🚀 Kurulum

### 1. Gereksinimleri Yükle

```bash
# Temel paketler
pip install -r requirements.txt
```

### 2. GDAL Kurulumu

GDAL'ı pip ile kurmak zor olabilir. Önerilen yöntemler:

**Conda ile (önerilen):**
```bash
conda install -c conda-forge gdal
```

**Ubuntu/Debian:**
```bash
sudo apt install python3-gdal gdal-bin
```

**Windows:**
- [OSGeo4W](https://trac.osgeo.org/osgeo4w/) kullanın
- veya [Christoph Gohlke's wheels](https://www.lfd.uci.edu/~gohlke/pythonlibs/#gdal)

### 3. Environment Variables

Proje kök dizininde `.env` dosyası oluşturun:

```env
CDSE_USERNAME=your-email@example.com
CDSE_PASSWORD=your-password
```

> ⚠️ **Güvenlik**: `.env` dosyasını asla git'e commit etmeyin!

## ⚙️ Konfigürasyon

`app/config/downloader.yaml` dosyasını düzenleyin:

```yaml
# Dosya yolları
OUTPUT_PATH: "./downloads"
EXTRACT_PATH: "./extracted"
GEOJSON_PATH: "./geojson"

# Sentinel ayarları
COLLECTION_NAME: "SENTINEL-2"
PRODUCT_TYPE: "S2MSI2A"

# Grid kodları (opsiyonel)
GRID_CODE:
  - "34TFL"
  - "34TFK"

# Maksimum bulut örtüsü (%)
CLOUDCOVER_MAX: 20

# Tarih ayarları
DATE_AUTO: true
DATE_AUTO_RANGE: 20
START_DATE: "2025-07-28"
END_DATE: "2025-07-30"

# API ayarları
MAX_PRODUCTS: 10
```

## 🎯 Kullanım

### API Sunucusunu Başlat

```bash
python -m app.core.main
# veya
uvicorn app.core.main:app --reload
```

Sunucu `http://localhost:8000` adresinde çalışacaktır.

### API Endpoints

#### 1. Sentinel-2 İndirme

```http
POST /download/sentinel2
Content-Type: application/json

{
    "geojson_name": "selanik.geojson",
    "date_auto": true,
    "cloudcover_max": 20
}
```

**Response:**
```json
{
    "success": true,
    "message": "Download completed successfully",
    "product": "S2A_MSIL2A_20251212T091421_...",
    "band_folder": "./extracted/.../IMG_DATA/R10m"
}
```

#### 2. NDVI Hesaplama

```http
POST /ndvi
Content-Type: application/json

{
    "lat": 40.5,
    "lon": 23.0
}
```

**Response:**
```json
{
    "success": true,
    "mean_ndvi": 0.45,
    "point_ndvi": 0.52
}
```

#### 3. Sağlık Kontrolü

```http
GET /health
```

#### 4. Band Folder Listesi

```http
GET /state/band-folders
```

### Swagger UI

API dokümantasyonu için: `http://localhost:8000/docs`

## 📂 Proje Yapısı

```
asktheearth/
├── app/
│   ├── config/
│   │   └── downloader.yaml     # Konfigürasyon
│   ├── core/
│   │   └── main.py             # FastAPI uygulaması
│   └── service/
│       ├── downloader.py       # CDSE indirme servisi
│       └── calculate_ndvi.py   # NDVI hesaplama
├── downloads/                   # İndirilen ZIP dosyaları
├── extracted/                   # Extract edilen SAFE klasörleri
├── geojson/                     # GeoJSON dosyaları
│   └── selanik.geojson
├── .env                         # Credentials (git'e eklenmez)
├── .gitignore
├── requirements.txt
└── README.md
```

## 🔧 API Fonksiyonları

### `download_sentinel_product()`
Sentinel-2 ürünü arar, indirir ve extract eder.

### `calculate_ndvi()`
Kırmızı (B04) ve NIR (B08) bantlarından NDVI hesaplar.

**NDVI Formülü:**
```
NDVI = (NIR - RED) / (NIR + RED)
```

**NDVI Değerleri:**
- `-1 to 0`: Su, kar, bulut
- `0 to 0.2`: Çıplak toprak, kaya
- `0.2 to 0.4`: Seyrek bitki örtüsü
- `0.4 to 0.6`: Orta yoğunlukta bitki örtüsü
- `0.6 to 1`: Yoğun bitki örtüsü

## ❓ Sorun Giderme

### CDSE Authentication Error
- `.env` dosyasındaki credentials'ı kontrol edin
- CDSE hesabınızın aktif olduğundan emin olun
- [CDSE](https://dataspace.copernicus.eu/) üzerinden hesap oluşturun

### No products found
- Tarih aralığını genişletin (`DATE_AUTO_RANGE` değerini artırın)
- `CLOUDCOVER_MAX` değerini artırın
- `GRID_CODE` filtrelerini kaldırın veya değiştirin

### GDAL/JP2 Error
- GDAL'ın JP2OpenJPEG driver'ı ile kurulu olduğundan emin olun
- Test için: `python -c "from osgeo import gdal; print(gdal.GetDriverByName('JP2OpenJPEG'))"`

### ModuleNotFoundError
```bash
pip install -r requirements.txt
```

## 📝 Geliştirme Notları

- Python 3.10+ gereklidir
- GDAL 3.6+ önerilir
- Production için Redis veya database ile state management kullanın

## 📄 Lisans

MIT License

---

**Son Güncelleme:** 16 Aralık 2025  
**Versiyon:** 1.1.0

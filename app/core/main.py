import os
import json
import threading
from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from app.service.downloader import DownloadRequest, download_sentinel_product, find_sentinel_band_folder, set_cancel_flag, reset_cancel_flag, is_cancelled
from app.service.calculate_ndvi import calculate_ndvi
from app.service.raster_service import create_rgb_composite, create_ndvi_raster, create_index_raster, list_rasters
from app.service.statistics import calculate_zonal_stats, get_point_stats
from app.service.export_service import export_to_csv, export_stats_to_json, list_exports
from app.service.ai_chat import chat_with_gemini, chat_with_ollama
import uvicorn

GEOJSON_PATH = "./geojson"

app = FastAPI(
    title="AskTheEarth - Sentinel-2 NDVI Analyzer",
    version="1.1.0",
    description="Sentinel-2 indirme ve NDVI hesaplama servisi"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files
app.mount("/static", StaticFiles(directory="static"), name="static")


# Session state yonetimi icin basit in-memory store
# Production'da Redis veya database kullanilmali
class SessionState:
    def __init__(self):
        self._band_folders: list[str] = []
        self._is_downloading: bool = False
        self._active_band_folder: Optional[str] = None  # Aktif raster için kullanılan tile

    def add_band_folder(self, folder: str):
        if folder not in self._band_folders:
            self._band_folders.append(folder)

    def set_band_folders(self, folders: list[str]):
        self._band_folders = folders

    def get_band_folders(self) -> list[str]:
        return self._band_folders

    def get_latest_band_folder(self) -> Optional[str]:
        """Son eklenen band folder'i doner (basit kullanim icin)"""
        if self._band_folders:
            return self._band_folders[-1]
        return None
    
    def set_active_band_folder(self, folder: str):
        """Aktif raster için kullanılan tile'ı ayarla"""
        self._active_band_folder = folder
        print(f"[STATE] Active band folder set: {folder}")
    
    def get_active_band_folder(self) -> Optional[str]:
        """Aktif raster için kullanılan tile'ı döndür"""
        return self._active_band_folder

    def clear(self):
        self._band_folders = []
        self._active_band_folder = None

    def set_downloading(self, status: bool):
        self._is_downloading = status

    def is_downloading(self) -> bool:
        return self._is_downloading


state = SessionState()


# Response modelleri
class DownloadResponse(BaseModel):
    success: bool
    message: str
    product: Optional[str] = None
    products: Optional[list[str]] = None
    band_folder: Optional[str] = None
    band_folders: Optional[list[str]] = None
    tiles: Optional[list[str]] = None


class NDVIRequest(BaseModel):
    lat: float
    lon: float
    band_folder: Optional[str] = None  # Opsiyonel, belirtilmezse son indirilen kullanılır


class NDVIResponse(BaseModel):
    success: bool
    mean_ndvi: Optional[float] = None
    point_ndvi: Optional[float] = None
    message: Optional[str] = None



# ============================================
# Cancellation Endpoint
# ============================================

@app.post("/api/cancel")
def cancel_operations():
    """
    Mevcut indirme işlemlerini iptal eder.
    Sayfa yenilendiğinde frontend tarafından çağrılır.
    """
    set_cancel_flag()
    state.set_downloading(False)
    print("[API] Cancel request received - all operations will be aborted")
    return {"success": True, "message": "Cancellation signal sent"}


# ============================================
# Statistics Endpoints
# ============================================

class ZonalStatsRequest(BaseModel):
    index_type: str = "ndvi"
    band_folder: Optional[str] = None
    aoi_geojson: Optional[dict] = None  # AOI polygon geometry

class PointStatsRequest(BaseModel):
    lat: float
    lon: float
    index_type: str = "ndvi"
    band_folder: Optional[str] = None
    window_size: int = 5


@app.post("/api/stats/zonal")
def api_zonal_stats(req: ZonalStatsRequest):
    """
    Zonal istatistikleri hesaplar.
    
    - **index_type**: İndeks tipi (ndvi, ndwi, evi, savi, nbr)
    - **aoi_geojson**: Opsiyonel AOI polygon geometry - sağlanırsa sadece bu alan için hesaplanır
    """
    # Önce aktif tile'ı dene (raster oluştururken kaydedilen)
    active_folder = state.get_active_band_folder()
    
    if active_folder:
        result = calculate_zonal_stats(active_folder, req.index_type, aoi_geojson=req.aoi_geojson)
        if result.get("success"):
            return result
    
    # Aktif tile yoksa tüm tile'ları dene
    band_folders = state.get_band_folders()
    
    if not band_folders:
        raise HTTPException(status_code=400, detail="Önce veri indirilmeli")
    
    # Tüm tile'lardan istatistikleri birleştir veya en büyüğünü seç
    all_results = []
    for band_folder in band_folders:
        if band_folder == active_folder:
            continue
        result = calculate_zonal_stats(band_folder, req.index_type, aoi_geojson=req.aoi_geojson)
        if result.get("success"):
            all_results.append(result)
    
    if not all_results:
        raise HTTPException(status_code=500, detail="Hiçbir tile için istatistik hesaplanamadı")
    
    # En fazla piksel içeren sonucu döndür (en büyük alan kapsayan tile)
    best_result = max(all_results, key=lambda r: r.get("pixel_count", 0))
    return best_result


@app.post("/api/stats/point")
def api_point_stats(req: PointStatsRequest):
    """
    Belirli bir nokta için istatistikleri hesaplar.
    
    - **lat**: Enlem
    - **lon**: Boylam
    - **index_type**: İndeks tipi
    - **window_size**: Pencere boyutu (piksel)
    """
    # Önce aktif tile'ı dene (raster oluştururken kaydedilen)
    active_folder = state.get_active_band_folder()
    if active_folder:
        result = get_point_stats(active_folder, req.lat, req.lon, req.index_type, req.window_size)
        if result.get("success"):
            return result
        print(f"[API] Active tile failed: {result.get('message')}")
    
    # Aktif tile'da bulunamazsa tüm tile'ları dene
    band_folders = state.get_band_folders()
    
    if not band_folders:
        raise HTTPException(status_code=400, detail="Önce veri indirilmeli")
    
    # Tüm tile'ları dene - birinde başarılı olursa döndür
    last_error = None
    for band_folder in band_folders:
        if band_folder == active_folder:
            continue  # Aktif tile zaten denendi
        result = get_point_stats(band_folder, req.lat, req.lon, req.index_type, req.window_size)
        
        if result.get("success"):
            return result
        
        # Bu tile'da başarısız olduysa, hatayı sakla ve devam et
        last_error = result.get("message", "Nokta istatistik hatası")
        print(f"[API] Point query failed for {band_folder}: {last_error}")
    
    # Hiçbir tile'da bulunamadı
    raise HTTPException(
        status_code=400, 
        detail=f"Koordinat ({req.lat:.4f}, {req.lon:.4f}) indirilen hiçbir tile içinde değil. Lütfen yeşil raster alanı içinden bir nokta seçin."
    )


@app.get("/api/stats/available-indices")
def get_available_indices():
    """Kullanılabilir indeksleri listeler"""
    return {
        "indices": [
            {"id": "ndvi", "name": "NDVI", "description": "Normalized Difference Vegetation Index", "bands": ["B04", "B08"]},
            {"id": "ndwi", "name": "NDWI", "description": "Normalized Difference Water Index", "bands": ["B03", "B08"]},
            {"id": "evi", "name": "EVI", "description": "Enhanced Vegetation Index", "bands": ["B02", "B04", "B08"]},
            {"id": "savi", "name": "SAVI", "description": "Soil-Adjusted Vegetation Index", "bands": ["B04", "B08"]},
            {"id": "nbr", "name": "NBR", "description": "Normalized Burn Ratio", "bands": ["B08", "B12"]}
        ]
    }


# ============================================
# Export Endpoints
# ============================================

class ExportRequest(BaseModel):
    index_type: str = "ndvi"
    format: str = "csv"  # csv veya json


@app.post("/api/export/stats")
def api_export_stats(req: ExportRequest):
    """İstatistikleri dışa aktar (CSV veya JSON)"""
    band_folder = state.get_latest_band_folder()
    
    if not band_folder:
        raise HTTPException(status_code=400, detail="Önce veri indirin")
    
    # Önce istatistik hesapla
    stats = calculate_zonal_stats(band_folder, req.index_type)
    
    if not stats.get("success"):
        raise HTTPException(status_code=500, detail=stats.get("message"))
    
    # Export et
    if req.format == "json":
        result = export_stats_to_json(stats)
    else:
        result = export_to_csv(stats)
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("message"))
    
    return result


@app.get("/api/export/list")
def api_list_exports():
    """Mevcut export dosyalarını listeler"""
    return {"exports": list_exports()}


# ============================================
# Raster Generation Endpoints
# ============================================

class CreateRasterRequest(BaseModel):
    index_type: str = "ndvi"
    aoi_geojson: Optional[dict] = None  # GeoJSON geometry (Polygon veya MultiPolygon)


@app.post("/api/raster/create")
def api_create_index_raster(req: CreateRasterRequest):
    """
    Belirtilen indeks tipine göre harita katmanı oluşturur.
    
    - **index_type**: ndvi, ndwi, evi, savi, nbr
    - **aoi_geojson**: Opsiyonel GeoJSON geometry (Polygon). Belirtilirse raster bu alana clip edilir.
    """
    band_folder = state.get_latest_band_folder()
    
    if not band_folder:
        raise HTTPException(status_code=400, detail="Önce veri indirin")
    
    # AOI varsa create_index_raster'a geç
    result = create_index_raster(band_folder, req.index_type, aoi_geojson=req.aoi_geojson)
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("message"))
    
    # Başarılı olursa, bu tile'ı aktif tile olarak kaydet (nokta sorgusu için)
    state.set_active_band_folder(band_folder)
    
    return result


@app.get("/", response_class=HTMLResponse)
async def root():
    """Ana sayfa - Frontend"""
    return FileResponse("static/index.html")


@app.get("/geojson/{filename}")
async def get_geojson(filename: str):
    """GeoJSON dosyasını döner"""
    filepath = os.path.join(GEOJSON_PATH, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="GeoJSON file not found")

    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/geojson/list")
async def list_geojson():
    """Mevcut GeoJSON dosyalarını listeler"""
    if not os.path.exists(GEOJSON_PATH):
        return {"files": []}

    files = [f for f in os.listdir(GEOJSON_PATH) if f.endswith(('.geojson', '.json'))]
    return {"files": files}


@app.post("/api/geojson/upload")
async def upload_geojson(file: UploadFile = File(...)):
    """GeoJSON dosyası yükler"""
    if not file.filename.endswith(('.geojson', '.json')):
        raise HTTPException(status_code=400, detail="Only GeoJSON files are allowed")

    # Klasör yoksa oluştur
    os.makedirs(GEOJSON_PATH, exist_ok=True)

    filepath = os.path.join(GEOJSON_PATH, file.filename)

    try:
        contents = await file.read()
        # JSON olarak parse et (geçerlilik kontrolü)
        json.loads(contents)

        with open(filepath, "wb") as f:
            f.write(contents)

        return {
            "success": True,
            "message": "File uploaded successfully",
            "filename": file.filename
        }
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# API Routes
# ============================================

@app.post("/download/sentinel2", response_model=DownloadResponse)
def api_download(req: DownloadRequest):
    """
    Sentinel-2 urunu indirir ve extract eder.
    Secilen alan birden fazla tile'a denk gelirse hepsini indirir.

    - **geojson_name**: GeoJSON dosya adi (geojson/ klasorunde olmali)
    - **start_date**: Baslangic tarihi (YYYY-MM-DD)
    - **end_date**: Bitis tarihi (YYYY-MM-DD)
    - **date_auto**: True ise otomatik tarih araligi kullanilir
    - **cloudcover_max**: Maksimum bulut ortusu yuzdesi
    """
    # İptal bayrağını sıfırla ve indirme durumunu ayarla
    reset_cancel_flag()
    state.set_downloading(True)
    
    try:
        result = download_sentinel_product(
            geojson_name=req.geojson_name,
            start_date=req.start_date,
            end_date=req.end_date,
            date_auto=req.date_auto,
            cloudcover_max=req.cloudcover_max
        )
    finally:
        state.set_downloading(False)

    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("message", "Download failed")
        )

    # Onceki band folder'lari temizle
    state.clear()

    products = result.get("products", [])
    band_folders = []

    for product_name in products:
        try:
            band_folder = find_sentinel_band_folder(product_name)
            band_folders.append(band_folder)
            state.add_band_folder(band_folder)
            print(f"[API] Band folder added: {band_folder}")
        except FileNotFoundError as e:
            print(f"[API] Band folder not found for {product_name}: {e}")

    if not band_folders:
        raise HTTPException(
            status_code=500,
            detail="Products downloaded but no band folders found"
        )

    # Otomatik raster oluşturma kaldırıldı
    # Kullanıcı manuel olarak "Harita Katmanı Oluştur" butonuyla istediği indeksi oluşturabilir
    print(f"[API] Download complete. User can now create index layers manually.")

    return DownloadResponse(
        success=True,
        message=f"{len(band_folders)} tile indirildi",
        product=products[0] if products else None,
        products=products,
        band_folder=band_folders[0] if band_folders else None,
        band_folders=band_folders,
        tiles=result.get("tiles", [])
    )


@app.post("/ndvi", response_model=NDVIResponse)
def get_ndvi(req: NDVIRequest):
    """
    Belirtilen koordinat icin NDVI degerini hesaplar.
    Birden fazla tile varsa, noktayi iceren tile'i otomatik bulur.

    - **lat**: Enlem (EPSG:4326)
    - **lon**: Boylam (EPSG:4326)
    - **band_folder**: Band klasoru yolu (opsiyonel, belirtilmezse tum indirilenler denenir)
    """
    # Band folder belirle
    if req.band_folder:
        band_folders = [req.band_folder]
    else:
        band_folders = state.get_band_folders()

    if not band_folders:
        raise HTTPException(
            status_code=400,
            detail="Band folder not specified and no previous download found. "
                   "Please download a Sentinel-2 product first or specify band_folder."
        )

    # Tum band folder'lari dene, noktayi icereni bul
    last_error = None
    nodata_count = 0
    outside_count = 0
    
    for band_folder in band_folders:
        try:
            print(f"[NDVI] Trying band folder: {band_folder}")
            result = calculate_ndvi(band_folder, req.lat, req.lon)

            # Sinir disi mi kontrol et
            if result.get("outside_bounds"):
                outside_count += 1
                print(f"[NDVI] Outside bounds in: {band_folder}")
                continue

            # NoData alani mi kontrol et
            if result.get("is_nodata"):
                nodata_count += 1
                print(f"[NDVI] NoData area in: {band_folder}")
                continue

            # point_ndvi None degilse ve gecerli bir deger ise bu tile'i kullan
            if result.get("point_ndvi") is not None:
                print(f"[NDVI] Found valid NDVI in: {band_folder}")
                return NDVIResponse(
                    success=True,
                    mean_ndvi=result.get("mean_ndvi"),
                    point_ndvi=result.get("point_ndvi"),
                    message=f"Tile: {band_folder.split('/')[-1] if '/' in band_folder else band_folder}"
                )
        except Exception as e:
            print(f"[NDVI] Error in {band_folder}: {e}")
            last_error = e
            continue

    # NoData alanina denk geldi
    if nodata_count > 0 and outside_count == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Koordinat ({req.lat}, {req.lon}) siyah/NoData alaninda. "
                   f"Bu bolge uydu goruntusu disinda. Farkli bir nokta secin."
        )

    # Hicbir tile'da bulunamadi
    if last_error:
        raise HTTPException(
            status_code=404,
            detail=f"Koordinat ({req.lat}, {req.lon}) hicbir indirilen tile icinde degil. "
                   f"Farkli bir alan secin veya daha fazla tile indirin."
        )

    raise HTTPException(
        status_code=500,
        detail="NDVI hesaplanamadi"
    )


@app.get("/health")
def health_check():
    """API sağlık kontrolü"""
    return {"status": "healthy", "version": "1.1.0"}


@app.get("/state/band-folders")
def get_band_folders():
    """Mevcut band folder'lari listeler"""
    return {
        "band_folders": state.get_band_folders(),
        "count": len(state.get_band_folders()),
        "latest": state.get_latest_band_folder()
    }


# ============================================
# Raster Endpoints
# ============================================

class RasterRequest(BaseModel):
    band_folder: Optional[str] = None  # Belirtilmezse tüm tile'lar için oluşturulur
    raster_type: str = "rgb"  # "rgb" veya "ndvi"


class RasterResponse(BaseModel):
    success: bool
    message: str
    rasters: Optional[list] = None


@app.post("/raster/create", response_model=RasterResponse)
def create_raster(req: RasterRequest):
    """
    İndirilen Sentinel-2 görüntülerinden raster oluşturur.
    
    - **raster_type**: "rgb" (True Color) veya "ndvi" (NDVI renk haritası)
    - **band_folder**: Belirli bir tile için (opsiyonel, belirtilmezse tüm tile'lar)
    """
    # Band folder'ları belirle
    if req.band_folder:
        band_folders = [req.band_folder]
    else:
        band_folders = state.get_band_folders()
    
    if not band_folders:
        raise HTTPException(
            status_code=400,
            detail="Henüz indirilmiş görüntü yok. Önce Sentinel-2 indirin."
        )
    
    created_rasters = []
    errors = []
    
    for band_folder in band_folders:
        try:
            if req.raster_type == "rgb":
                result = create_rgb_composite(band_folder)
            elif req.raster_type == "ndvi":
                result = create_ndvi_raster(band_folder)
            else:
                raise HTTPException(status_code=400, detail="Geçersiz raster tipi. 'rgb' veya 'ndvi' kullanın.")
            
            if result.get("success"):
                created_rasters.append({
                    "band_folder": band_folder,
                    "web_path": result.get("web_path"),
                    "bounds": result.get("bounds"),
                    "type": req.raster_type
                })
            else:
                errors.append(f"{band_folder}: {result.get('message')}")
                
        except Exception as e:
            errors.append(f"{band_folder}: {str(e)}")
    
    if not created_rasters:
        raise HTTPException(
            status_code=500,
            detail=f"Raster oluşturulamadı: {'; '.join(errors)}"
        )
    
    return RasterResponse(
        success=True,
        message=f"{len(created_rasters)} raster oluşturuldu",
        rasters=created_rasters
    )


@app.get("/raster/list")
def get_rasters():
    """Mevcut raster dosyalarını listeler"""
    return {
        "rasters": list_rasters()
    }


@app.post("/raster/create-all")
def create_all_rasters():
    """
    Tüm indirilen tile'lar için NDVI raster oluşturur.
    RGB artık oluşturulmaz - base map katmanları kullanılır.
    İndirme sonrası otomatik çağrılabilir.
    """
    band_folders = state.get_band_folders()
    
    if not band_folders:
        raise HTTPException(
            status_code=400,
            detail="Henüz indirilmiş görüntü yok."
        )
    
    results = {
        "rgb": [],  # Artık boş - geriye dönük uyumluluk için tutuldu
        "ndvi": []
    }
    
    for band_folder in band_folders:
        # Sadece NDVI oluştur (RGB base map'lerden sağlanıyor)
        ndvi_result = create_ndvi_raster(band_folder)
        if ndvi_result.get("success"):
            results["ndvi"].append({
                "web_path": ndvi_result.get("web_path"),
                "bounds": ndvi_result.get("bounds")
            })
    
    return {
        "success": True,
        "message": f"NDVI: {len(results['ndvi'])} raster oluşturuldu",
        "rasters": results
    }


# ============================================
# AI Chat Endpoint
# ============================================

class ChatRequest(BaseModel):
    message: str
    provider: str = "gemini"  # "gemini" or "ollama"
    api_key: Optional[str] = None
    context: Optional[str] = None
    history: Optional[list] = None


@app.post("/api/chat")
async def api_chat(req: ChatRequest):
    """
    AI chat endpoint
    
    - **message**: Kullanıcı mesajı
    - **provider**: AI provider (gemini veya ollama)
    - **api_key**: Gemini API key (provider=gemini ise gerekli)
    - **context**: Arazi verileri bağlamı
    - **history**: Önceki mesajlar
    """
    if req.provider == "gemini":
        if not req.api_key:
            raise HTTPException(status_code=400, detail="Gemini için API key gerekli")
        
        result = await chat_with_gemini(
            api_key=req.api_key,
            message=req.message,
            context=req.context,
            history=req.history
        )
    elif req.provider == "ollama":
        result = await chat_with_ollama(
            message=req.message,
            context=req.context,
            history=req.history
        )
    else:
        raise HTTPException(status_code=400, detail=f"Bilinmeyen provider: {req.provider}")
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "AI hatası"))
    
    return {
        "success": True,
        "response": result.get("response")
    }


if __name__ == "__main__":
    uvicorn.run("app.core.main:app", host="192.168.1.162", port=8000, reload=True)

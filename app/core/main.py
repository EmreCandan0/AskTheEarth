import os
import json
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from app.service.downloader import DownloadRequest, download_sentinel_product, find_sentinel_band_folder
from app.service.calculate_ndvi import calculate_ndvi
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

    def clear(self):
        self._band_folders = []


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
    result = download_sentinel_product(
        geojson_name=req.geojson_name,
        start_date=req.start_date,
        end_date=req.end_date,
        date_auto=req.date_auto,
        cloudcover_max=req.cloudcover_max
    )

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


if __name__ == "__main__":
    uvicorn.run("app.core.main:app", host="192.168.1.162", port=8000, reload=True)

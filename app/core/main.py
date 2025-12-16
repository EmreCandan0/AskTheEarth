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


# Session state yönetimi için basit in-memory store
# Production'da Redis veya database kullanılmalı
class SessionState:
    def __init__(self):
        self._band_folders: dict[str, str] = {}
    
    def set_band_folder(self, session_id: str, folder: str):
        self._band_folders[session_id] = folder
    
    def get_band_folder(self, session_id: str) -> Optional[str]:
        return self._band_folders.get(session_id)
    
    def get_latest_band_folder(self) -> Optional[str]:
        """Son eklenen band folder'ı döner (basit kullanım için)"""
        if self._band_folders:
            return list(self._band_folders.values())[-1]
        return None


state = SessionState()


# Response modelleri
class DownloadResponse(BaseModel):
    success: bool
    message: str
    product: Optional[str] = None
    band_folder: Optional[str] = None


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
    Sentinel-2 ürünü indirir ve extract eder.
    
    - **geojson_name**: GeoJSON dosya adı (geojson/ klasöründe olmalı)
    - **start_date**: Başlangıç tarihi (YYYY-MM-DD)
    - **end_date**: Bitiş tarihi (YYYY-MM-DD)
    - **date_auto**: True ise otomatik tarih aralığı kullanılır
    - **cloudcover_max**: Maksimum bulut örtüsü yüzdesi
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

    product_name = result.get("product")
    band_folder = None
    
    if product_name:
        try:
            band_folder = find_sentinel_band_folder(product_name)
            
            # State'e kaydet
            state.set_band_folder(product_name, band_folder)
        except FileNotFoundError as e:
            # Extract başarılı ama band folder bulunamadı
            raise HTTPException(
                status_code=500,
                detail=f"Product downloaded but band folder not found: {str(e)}"
            )

    return DownloadResponse(
        success=True,
        message="Download completed successfully",
        product=product_name,
        band_folder=band_folder
    )


@app.post("/ndvi", response_model=NDVIResponse)
def get_ndvi(req: NDVIRequest):
    """
    Belirtilen koordinat için NDVI değerini hesaplar.
    
    - **lat**: Enlem (EPSG:4326)
    - **lon**: Boylam (EPSG:4326)
    - **band_folder**: Band klasörü yolu (opsiyonel, belirtilmezse son indirilen kullanılır)
    """
    # Band folder belirle
    band_folder = req.band_folder or state.get_latest_band_folder()
    
    if not band_folder:
        raise HTTPException(
            status_code=400,
            detail="Band folder not specified and no previous download found. "
                   "Please download a Sentinel-2 product first or specify band_folder."
        )

    try:
        result = calculate_ndvi(band_folder, req.lat, req.lon)
        return NDVIResponse(
            success=True,
            mean_ndvi=result.get("mean_ndvi"),
            point_ndvi=result.get("point_ndvi")
        )
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=f"Required band files not found: {str(e)}"
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"NDVI calculation failed: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error during NDVI calculation: {str(e)}"
        )


@app.get("/health")
def health_check():
    """API sağlık kontrolü"""
    return {"status": "healthy", "version": "1.1.0"}


@app.get("/state/band-folders")
def get_band_folders():
    """Mevcut band folder'ları listeler"""
    return {
        "band_folders": state._band_folders,
        "latest": state.get_latest_band_folder()
    }


if __name__ == "__main__":
    uvicorn.run("app.core.main:app", host="0.0.0.0", port=8000, reload=True)

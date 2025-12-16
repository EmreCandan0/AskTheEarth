from fastapi import FastAPI
from app.service.downloader import DownloadRequest, download_sentinel_product,find_sentinel_band_folder
from app.service.calculate_ndvi import generate_ndvi_tif,calculate_ndvi_and_stats
import uvicorn


app = FastAPI(
    title="Copernicus Sentinel-2 Downloader API",
    version="1.0.0",
    description="Sentinel-2 indirme servisi (FastAPI uyarlaması)"
)

GLOBAL_BAND_FOLDER: str

@app.post("/download/sentinel2")
def api_download(req: DownloadRequest):
    global GLOBAL_BAND_FOLDER
    result = download_sentinel_product(
        geojson_name=req.geojson_name,
        start_date=req.start_date,
        end_date=req.end_date,
        date_auto=req.date_auto,
        cloudcover_max=req.cloudcover_max
    )

    if result.get("product"):
        extracted_folder=result.get("product")
        GLOBAL_BAND_FOLDER = find_sentinel_band_folder(extracted_folder)
    else:
        raise FileNotFoundError("Cant find the extracted folder")
    return {
        "band_folder":GLOBAL_BAND_FOLDER
    }


@app.post("/ndvi")
def full_ndvi_process(lat: float = None, lon: float = None):
    global GLOBAL_BAND_FOLDER
    ndvi_path = generate_ndvi_tif(GLOBAL_BAND_FOLDER)
    stats = calculate_ndvi_and_stats(ndvi_path, lat, lon)

    return {
        "mean_ndvi": stats["mean_ndvi"],
        "point_ndvi": stats["point_ndvi"]
    }


if __name__ == "__main__":
    uvicorn.run("app.core.main:app", host="0.0.0.0", port=8000, reload=True)

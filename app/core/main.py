from fastapi import FastAPI, HTTPException
from app.service.downloader import DownloadRequest, download_sentinel_product
import uvicorn


app = FastAPI(
    title="Copernicus Sentinel-2 Downloader API",
    version="1.0.0",
    description="Sentinel-2 indirme servisi (FastAPI uyarlaması)"
)


@app.post("/download/sentinel2")
def api_download(req: DownloadRequest):

    result = download_sentinel_product(
        geojson_name=req.geojson_name,
        start_date=req.start_date,
        end_date=req.end_date,
        date_auto=req.date_auto,
        cloudcover_max=req.cloudcover_max
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result)

    return result


if __name__ == "__main__":
    uvicorn.run("app.core.main:app", host="0.0.0.0", port=8000, reload=True)

import os
import numpy as np
from osgeo import gdal,osr


def generate_ndvi_tif(band_folder: str) -> str:

    # Band dosyalarını bul
    files = os.listdir(band_folder)

    b04 = next((os.path.join(band_folder, f) for f in files if "_B04_" in f), None)
    b08 = next((os.path.join(band_folder, f) for f in files if "_B08_" in f), None)

    if not b04 or not b08:
        raise FileNotFoundError("B04 veya B08 band dosyası bulunamadı.")

    # GDAL ile oku
    ds_red = gdal.Open(b04)
    ds_nir = gdal.Open(b08)

    if ds_red is None or ds_nir is None:
        raise RuntimeError("GDAL band dosyalarını açamadı.")

    red = ds_red.ReadAsArray().astype(np.float32)
    nir = ds_nir.ReadAsArray().astype(np.float32)

    # NDVI hesapla
    ndvi = (nir - red) / (nir + red + 1e-6)

    # Çıktı dosyası yolu
    output_path = os.path.join(band_folder, "NDVI.tif")

    # GeoTIFF oluştur
    driver = gdal.GetDriverByName("GTiff")
    out_ds = driver.Create(
        output_path,
        ds_red.RasterXSize,
        ds_red.RasterYSize,
        1,
        gdal.GDT_Float32
    )

    # GeoTransform + Projeksiyon ayarla
    out_ds.SetGeoTransform(ds_red.GetGeoTransform())
    out_ds.SetProjection(ds_red.GetProjection())

    out_band = out_ds.GetRasterBand(1)
    out_band.WriteArray(ndvi)
    out_band.SetNoDataValue(-9999)
    out_band.FlushCache()
    out_ds = None  # dosyayı kapat

    return output_path

def calculate_ndvi_and_stats(ndvi_tif_path: str, lat: float = None, lon: float = None):
    # Rasterı aç
    ds = gdal.Open(ndvi_tif_path)
    if ds is None:
        raise FileNotFoundError(f"NDVI raster açılamadı: {ndvi_tif_path}")

    band = ds.GetRasterBand(1)
    ndvi = band.ReadAsArray().astype(np.float32)

    # NoData temizle
    nodata = band.GetNoDataValue()
    if nodata is not None:
        ndvi = np.where(ndvi == nodata, np.nan, ndvi)

    # Ortalama NDVI hesapla
    mean_ndvi = float(np.nanmean(ndvi))

    # Eğer koordinat verilmemişse sadece ortalamayı döndür
    if lat is None or lon is None:
        return {
            "mean_ndvi": mean_ndvi,
            "point_ndvi": None
        }

    gt = ds.GetGeoTransform()
    proj = ds.GetProjection()

    # Raster koordinat sistemi
    srs_raster = osr.SpatialReference()
    srs_raster.ImportFromWkt(proj)


    srs_wgs84 = osr.SpatialReference()
    srs_wgs84.ImportFromEPSG(4326)

    transform = osr.CoordinateTransformation(srs_wgs84, srs_raster)
    px, py, _ = transform.TransformPoint(lon, lat)

    # Piksel koordinatı hesapla
    pixel_x = int((px - gt[0]) / gt[1])
    pixel_y = int((py - gt[3]) / gt[5])

    # Piksel raster içinde mi?
    if pixel_x < 0 or pixel_y < 0 or pixel_x >= ds.RasterXSize or pixel_y >= ds.RasterYSize:
        point_ndvi = None
    else:
        point_ndvi = float(ndvi[pixel_y, pixel_x])

    return {
        "mean_ndvi": mean_ndvi,
        "point_ndvi": point_ndvi
    }
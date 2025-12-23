import os
import numpy as np
from osgeo import gdal, osr


def calculate_ndvi(band_folder: str, lat: float, lon: float) -> dict:
    """
    Sentinel-2 bantlarindan NDVI hesaplar ve belirtilen noktanin NDVI degerini dondurur.
    Koordinatlar EPSG:4326 (lat/lon) formatinda beklenir.
    
    Siyah/NoData alanlari (bant degeri 0) icin point_ndvi=None doner.
    """

    # B04 (Kirmizi) ve B08 (NIR) bantlarini bul
    files = os.listdir(band_folder)
    b04 = next((f for f in files if "_B04_" in f), None)
    b08 = next((f for f in files if "_B08_" in f), None)

    if not b04 or not b08:
        raise FileNotFoundError("B04 veya B08 bandi bulunamadi")

    # Bantlari ac
    b04_path = os.path.join(band_folder, b04)
    b08_path = os.path.join(band_folder, b08)
    
    ds_red = gdal.Open(b04_path)
    ds_nir = gdal.Open(b08_path)

    if ds_red is None or ds_nir is None:
        raise FileNotFoundError("Bant dosyalari acilamadi")

    red = ds_red.ReadAsArray().astype(np.float32)
    nir = ds_nir.ReadAsArray().astype(np.float32)

    # NoData maskesi olustur (her iki bantta da 0 olan pikseller)
    nodata_mask = (red == 0) & (nir == 0)
    
    # NDVI hesapla
    with np.errstate(divide='ignore', invalid='ignore'):
        ndvi = np.where(
            nodata_mask,
            np.nan,  # NoData alanlari icin NaN
            (nir - red) / (nir + red + 1e-6)
        )

    # Ortalama NDVI (sadece gecerli pikseller)
    valid_ndvi = ndvi[~np.isnan(ndvi)]
    mean_ndvi = float(np.mean(valid_ndvi)) if len(valid_ndvi) > 0 else None

    # Koordinat donusumu: EPSG:4326 -> Raster CRS (UTM)
    # Raster'in CRS'ini al
    raster_srs = osr.SpatialReference()
    raster_srs.ImportFromWkt(ds_red.GetProjection())
    
    # WGS84 (EPSG:4326)
    wgs84_srs = osr.SpatialReference()
    wgs84_srs.ImportFromEPSG(4326)
    
    # Koordinat donusturucuyu olustur
    # GDAL 3.x icin axis order'i ayarla
    wgs84_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    raster_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    
    transform = osr.CoordinateTransformation(wgs84_srs, raster_srs)
    
    # lat/lon -> UTM
    try:
        utm_x, utm_y, _ = transform.TransformPoint(lon, lat)
        print(f"[NDVI] WGS84 ({lon}, {lat}) -> UTM ({utm_x:.2f}, {utm_y:.2f})")
    except Exception as e:
        print(f"[NDVI] Koordinat donusumu hatasi: {e}")
        return {
            "mean_ndvi": mean_ndvi,
            "point_ndvi": None,
            "is_nodata": False,
            "outside_bounds": True
        }

    # GeoTransform'u al ve piksel koordinatlarini hesapla
    gt = ds_red.GetGeoTransform()
    # gt[0] = top left x, gt[3] = top left y
    # gt[1] = pixel width, gt[5] = pixel height (negatif)
    
    pixel_x = int((utm_x - gt[0]) / gt[1])
    pixel_y = int((utm_y - gt[3]) / gt[5])
    
    print(f"[NDVI] Piksel koordinatlari: ({pixel_x}, {pixel_y})")
    print(f"[NDVI] Raster boyutu: {ds_red.RasterXSize} x {ds_red.RasterYSize}")

    # Nokta NDVI
    point_ndvi = None
    is_nodata = False
    outside_bounds = False
    
    if 0 <= pixel_x < ds_red.RasterXSize and 0 <= pixel_y < ds_red.RasterYSize:
        raw_value = float(ndvi[pixel_y, pixel_x])
        
        # NoData kontrolu (NaN veya siyah alan)
        if np.isnan(raw_value):
            point_ndvi = None
            is_nodata = True
            print(f"[NDVI] Koordinat NoData/siyah alanda")
        else:
            point_ndvi = raw_value
            print(f"[NDVI] NDVI degeri: {point_ndvi:.4f}")
    else:
        outside_bounds = True
        print(f"[NDVI] Koordinat raster sinirlari disinda")

    # Temizlik
    ds_red = None
    ds_nir = None

    return {
        "mean_ndvi": mean_ndvi,
        "point_ndvi": point_ndvi,
        "is_nodata": is_nodata,
        "outside_bounds": outside_bounds
    }

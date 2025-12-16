import os
import numpy as np
from osgeo import gdal


def calculate_ndvi(band_folder: str, lat: float, lon: float) -> dict:
    """
    Sentinel-2 bantlarından NDVI hesaplar ve belirtilen noktanın NDVI değerini döndürür.
    Koordinatlar EPSG:4326 (lat/lon) formatında beklenir.
    """

    # B04 (Kırmızı) ve B08 (NIR) bantlarını bul
    files = os.listdir(band_folder)
    b04 = next((f for f in files if "_B04_" in f), None)
    b08 = next((f for f in files if "_B08_" in f), None)

    if not b04 or not b08:
        raise FileNotFoundError("B04 veya B08 bandı bulunamadı")

    # Bantları aç
    ds_red = gdal.Open(os.path.join(band_folder, b04))
    ds_nir = gdal.Open(os.path.join(band_folder, b08))

    red = ds_red.ReadAsArray().astype(np.float32)
    nir = ds_nir.ReadAsArray().astype(np.float32)

    # NDVI hesapla (native UTM'de)
    ndvi = (nir - red) / (nir + red + 1e-6)

    # Ortalama NDVI
    mean_ndvi = float(np.nanmean(ndvi))

    # NDVI'yi geçici olarak native CRS'te kaydet
    ndvi_native_path = os.path.join(band_folder, "temp_ndvi_native.tif")

    driver = gdal.GetDriverByName("GTiff")
    out_ds = driver.Create(
        ndvi_native_path,
        ds_red.RasterXSize,
        ds_red.RasterYSize,
        1,
        gdal.GDT_Float32
    )
    out_ds.SetGeoTransform(ds_red.GetGeoTransform())
    out_ds.SetProjection(ds_red.GetProjection())
    band = out_ds.GetRasterBand(1)
    band.WriteArray(ndvi)
    band.SetNoDataValue(-9999)
    band.FlushCache()
    out_ds = None

    # VRT ile in-memory reprojection (EPSG:4326'ya)
    vrt_options = gdal.WarpOptions(
        format='VRT',
        dstSRS='EPSG:4326',
        resampleAlg=gdal.GRA_Bilinear
    )
    vrt_ds = gdal.Warp('', ndvi_native_path, options=vrt_options)

    if vrt_ds is None:
        raise RuntimeError("VRT reprojection başarısız")

    # EPSG:4326'daki VRT'den piksel oku
    gt = vrt_ds.GetGeoTransform()
    inv_gt = gdal.InvGeoTransform(gt)
    if inv_gt is None:
        raise RuntimeError("Inverse GeoTransform hesaplanamadı")

    pixel_x, pixel_y = gdal.ApplyGeoTransform(inv_gt, lon, lat)
    pixel_x = int(pixel_x)
    pixel_y = int(pixel_y)

    print(f"Debug: lon={lon}, lat={lat}")
    print(f"Debug: pixel_x={pixel_x}, pixel_y={pixel_y}")
    print(f"Debug: Raster boyutu (4326): {vrt_ds.RasterXSize} x {vrt_ds.RasterYSize}")

    # Nokta NDVI
    if 0 <= pixel_x < vrt_ds.RasterXSize and 0 <= pixel_y < vrt_ds.RasterYSize:
        ndvi_4326_array = vrt_ds.GetRasterBand(1).ReadAsArray()
        point_ndvi = float(ndvi_4326_array[pixel_y, pixel_x])

        # NoData kontrolü
        nodata_value = vrt_ds.GetRasterBand(1).GetNoDataValue()
        if nodata_value is not None and abs(point_ndvi - nodata_value) < 0.001:
            point_ndvi = None
    else:
        point_ndvi = None
        print(f"Uyarı: Koordinat ({lat}, {lon}) raster sınırları dışında")

    # Temizlik
    ds_red = None
    ds_nir = None
    vrt_ds = None

    # Geçici dosyayı sil (opsiyonel)
    try:
        os.remove(ndvi_native_path)
    except:
        pass

    return {
        "mean_ndvi": mean_ndvi,
        "point_ndvi": point_ndvi
    }
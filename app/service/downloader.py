import yaml
import os
import zipfile
import re
import json
import hashlib
import datetime
import requests
from collections import Counter
from pydantic import BaseModel
from typing import Optional

from requests import HTTPError

config_path = os.path.join(os.path.dirname(__file__), "..", "config", "downloader.yaml")
with open(config_path, "r", encoding="utf-8") as f:
    config = yaml.safe_load(f)


CDSE_USERNAME = config["CDSE_USERNAME"]
CDSE_PASSWORD = config["CDSE_PASSWORD"]

OUTPUT_PATH = config["OUTPUT_PATH"]
EXTRACT_PATH = config["EXTRACT_PATH"]

COLLECTION_NAME = config["COLLECTION_NAME"]
PRODUCT_TYPE = config["PRODUCT_TYPE"]
GRID_CODE = config.get("GRID_CODE", [])
DATE_AUTO_RANGE = config["DATE_AUTO_RANGE"]


MAX_PRODUCTS = config.get("MAX_PRODUCTS", 10)


print(f"[CONFIG] [OK] Configuration loaded from: {config_path}")
print(f"[CONFIG] Collection: {COLLECTION_NAME}, Product Type: {PRODUCT_TYPE}")
print(f"[CONFIG] Output: {OUTPUT_PATH}, Extract: {EXTRACT_PATH}")


def geojson_to_wkt(geojson_path: str) -> str:
    """GeoJSON dosyasını WKT polygon formatına çevirir"""
    with open(geojson_path, encoding="utf-8") as f:
        data = json.load(f)

    if data["type"] == "FeatureCollection":
        geom = data["features"][0]["geometry"]
    else:
        geom = data["geometry"]

    if geom["type"] == "Polygon":
        coords = geom["coordinates"][0]
    elif geom["type"] == "MultiPolygon":
        coords = geom["coordinates"][0][0]
    else:
        raise Exception("Only Polygon or MultiPolygon are supported!")

    coord_str = ",".join([f"{lon} {lat}" for lon, lat in coords])
    if coords[0] != coords[-1]:
        coord_str += f",{coords[0][0]} {coords[0][1]}"

    return f"POLYGON(({coord_str}))"


def get_access_token() -> str:
    """CDSE access token alır"""
    url = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
    data = {
        "grant_type": "password",
        "username": CDSE_USERNAME,
        "password": CDSE_PASSWORD,
        "client_id": "cdse-public",
    }
    resp = requests.post(url, data=data)
    resp.raise_for_status()
    return resp.json()["access_token"]


def md5sum(filename: str) -> str:
    """Dosyanın MD5 hash'ini hesaplar"""
    hash_md5 = hashlib.md5()
    with open(filename, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def build_odata_filter(
    collection_name: str,
    product_type: str,
    cloudcover_max: int,
    start_date: str,
    end_date: str,
    geo_filter: str = "",
    grid_code: list = None,
) -> str:
    """OData filtre string'i oluşturur"""

    # Bulut örtüsü filtresi (sadece Sentinel-2 için)
    if collection_name.upper().startswith("SENTINEL-2"):
        cloudcover_filter = (
            f"and Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' "
            f"and att/OData.CSC.DoubleAttribute/Value le {cloudcover_max}) "
        )
    else:
        cloudcover_filter = ""

    # Grid kodu filtresi
    grid_filter = ""
    if grid_code:
        or_filters = [
                f"Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'tileId' and "
                f"att/OData.CSC.StringAttribute/Value eq '{g}')"
            for g in grid_code
        ]
        grid_filter = "and (" + " or ".join(or_filters) + ") "

    odata_filter = (
        f"Collection/Name eq '{collection_name}' "
        f"{cloudcover_filter}"
        f"{grid_filter}"
        f"and Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'productType' "
        f"and att/OData.CSC.StringAttribute/Value eq '{product_type}') "
        f"{geo_filter}"
        f"and ContentDate/Start ge {start_date} "
        f"and ContentDate/End le {end_date}"
    )
    return odata_filter


def search_products(
    token: str,
    start_date: str,
    end_date: str,
    cloudcover_max:int,
    wkt_polygon: str | None = None,
    max_results: int = 10
) -> list:
    """Ürün arar ve sonuçları döner"""
    url = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
    headers = {"Authorization": f"Bearer {token}"}

    geo_filter = ""
    if wkt_polygon:
        geo_filter = f"and OData.CSC.Intersects(area=geography'SRID=4326;{wkt_polygon}') "

    odata_filter = build_odata_filter(
        COLLECTION_NAME,
        PRODUCT_TYPE,
        cloudcover_max,
        start_date,
        end_date,
        geo_filter,
        GRID_CODE,
    )

    params = {
        "$filter": odata_filter,
        "$top": max_results,
        "$orderby": "ContentDate/Start desc",
    }

    resp = requests.get(url, headers=headers, params=params)
    resp.raise_for_status()
    return resp.json().get("value", [])


def download_product(
    token: str,
    product_id: str,
    product_name: str,
    output_folder: str
) -> dict:
    """
    Tek bir ürünü indirir

    Returns:
        dict: {"success": bool, "message": str, "filename": str}
    """
    filename = os.path.join(output_folder, f"{product_name}.zip")

    # Zaten varsa atla
    if os.path.exists(filename):
        print(f"[DOWNLOAD] Already exists: {os.path.basename(filename)}")
        return {
            "success": False,
            "message": "File already exists",
            "filename": filename
        }

    url = f"https://download.dataspace.copernicus.eu/odata/v1/Products({product_id})/$value"
    headers = {"Authorization": f"Bearer {token}"}

    print(f"[DOWNLOAD] Starting: {os.path.basename(filename)}")

    try:
        with requests.get(url, headers=headers, stream=True) as r:
            r.raise_for_status()

            # Dosya boyutu
            total_size = int(r.headers.get('content-length', 0))
            downloaded = 0

            with open(filename, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)

                    # Progress göster
                    if total_size > 0:
                        percent = (downloaded / total_size) * 100
                        print(f"\r[DOWNLOAD] Progress: {percent:.1f}%", end="", flush=True)

            print()  # Yeni satır
            print(f"[DOWNLOAD] [OK] Completed: {os.path.basename(filename)}")

            return {
                "success": True,
                "message": "Download completed",
                "filename": filename
            }

    except Exception as e:
        print(f"\n[DOWNLOAD ERROR] {e}")
        if os.path.exists(filename):
            os.remove(filename)
        return {
            "success": False,
            "message": str(e),
            "filename": None
        }


def extract_zip(zip_path: str) -> dict:
    """
    Zip dosyasını extract eder

    Returns:
        dict: {"success": bool, "message": str, "folder": str}
    """
    try:
        print(f"[EXTRACT] Starting: {os.path.basename(zip_path)}")

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(EXTRACT_PATH)
            filename = os.path.basename(zip_path)
            prefix = filename.split("_")[0]

            # SAFE klasörünü bul
            safe_candidates = []
            for entry in zip_ref.namelist():
                m = re.match(r"([^/]+\.SAFE)/", entry)
                if m:
                    safe_candidates.append(m.group(1))

            if not safe_candidates:
                for entry in zip_ref.namelist():
                    if ".SAFE/" in entry:
                        safe_candidates.append(entry.split("/")[0])
                    elif ".SAFE" in entry:
                        safe_candidates.append(entry.split("/")[0])

            if safe_candidates:
                top_folder = Counter(safe_candidates).most_common(1)[0][0]
                src_path = os.path.join(EXTRACT_PATH, top_folder)
                dst_path = os.path.join(EXTRACT_PATH, f"{prefix}_{top_folder}")

                if not top_folder.startswith(f"{prefix}_"):
                    if os.path.exists(src_path) and not os.path.exists(dst_path):
                        os.rename(src_path, dst_path)
                        print(f"[EXTRACT] [OK] Extracted and renamed to: {prefix}_{top_folder}")
                        return {
                            "success": True,
                            "message": "Extracted and renamed",
                            "folder": dst_path
                        }
                    elif os.path.exists(dst_path):
                        print(f"[EXTRACT] Folder already exists: {dst_path}")
                        return {
                            "success": True,
                            "message": "Folder already exists",
                            "folder": dst_path
                        }
                else:
                    print(f"[EXTRACT] [OK] Extracted: {top_folder}")
                    return {
                        "success": True,
                        "message": "Extracted",
                        "folder": src_path
                    }
            else:
                print(f"[EXTRACT WARN] Could not find SAFE folder")
                return {
                    "success": False,
                    "message": "SAFE folder not found",
                    "folder": None
                }

    except Exception as e:
        print(f"[EXTRACT ERROR] {e}")
        return {
            "success": False,
            "message": str(e),
            "folder": None
        }


def calculate_dates(date_auto:bool,start_date,end_date) -> tuple:
    """Tarih aralığını hesaplar"""
    if date_auto:
        today = datetime.datetime.now()
        start = today - datetime.timedelta(days=DATE_AUTO_RANGE)
        start_str = start.strftime("%Y-%m-%dT00:00:00.000Z")
        end_str = today.strftime("%Y-%m-%dT23:59:59.999Z")
    else:
        start_str = datetime.datetime.strptime(start_date, "%Y-%m-%d").strftime(
            "%Y-%m-%dT00:00:00.000Z"
        )
        end_str = datetime.datetime.strptime(end_date, "%Y-%m-%d").strftime(
            "%Y-%m-%dT23:59:59.999Z"
        )

    return start_str, end_str

def download_sentinel_product(geojson_name, start_date, end_date, date_auto, cloudcover_max):

    geojson_path = f"./geojson/{geojson_name}"
    try:
        print("[CDSE] Getting access token...")
        token = get_access_token()
        print("[CDSE] [OK] Access token received")

        # Tarih hesapla
        start_date, end_date = calculate_dates(date_auto, start_date, end_date)

        print(f"[CDSE] Date range: {start_date[:10]} to {end_date[:10]}")

        # GeoJSON → WKT
        wkt_polygon = None
        if geojson_path and os.path.exists(geojson_path):
            wkt_polygon = geojson_to_wkt(geojson_path)
            print(f"[CDSE] [OK] GeoJSON loaded: {geojson_path}")

        print(f"[CDSE] Searching for products...")

        products = search_products(
            token,
            start_date,
            end_date,
            cloudcover_max,
            wkt_polygon,
            MAX_PRODUCTS
        )

        if not products:
            print("[CDSE] No products found")
            raise HTTPError("No products found")

        product = products[0]

        print(f"[CDSE] Selected: {product['Name']}")

        download_result = download_product(
            token,
            product["Id"],
            product["Name"],
            OUTPUT_PATH
        )

        if not download_result["success"]:
            return {
                "success": False,
                "message": download_result["message"],
                "product": product["Name"],
            }

        extract_zip(download_result["filename"])

        return {
            "success": True,
            "message": "Download completed successfully",
            "product": product["Name"],
        }

    except Exception as e:
        print(f"[ERROR] {e}")
        return {
            "success": False,
            "message": str(e),
            "product": None
        }


def find_sentinel_band_folder(safe_folder: str, resolution: str = "R10m") -> str:
    """
    SAFE klasörü içinden GRANULE → IMG_DATA → resolution (R10m/R20m/R60m) klasörünü döner.
    """

    granule_path = os.path.join("extracted",safe_folder, "GRANULE")
    if not os.path.exists(granule_path):

        raise FileNotFoundError("GRANULE klasörü bulunamadı")

    granule_dirs = [os.path.join(granule_path, d) for d in os.listdir(granule_path)]
    granule_dirs = [d for d in granule_dirs if os.path.isdir(d)]

    if not granule_dirs:
        raise FileNotFoundError("GRANULE içinde alt klasör bulunamadı")

    granule_dir = granule_dirs[0]

    img_data_path = os.path.join(granule_dir, "IMG_DATA")
    if not os.path.exists(img_data_path):
        raise FileNotFoundError("IMG_DATA klasörü bulunamadı")

    resolution_path = os.path.join(img_data_path, resolution)
    if not os.path.exists(resolution_path):
        raise FileNotFoundError(f"{resolution} klasörü bulunamadı")

    return resolution_path

class DownloadRequest(BaseModel):
    geojson_name: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    cloudcover_max: Optional[int] = 20
    date_auto: bool = True

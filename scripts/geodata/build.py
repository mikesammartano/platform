"""
Builds the real-world terrain assets in public/geo/ for a central Andes transect through Lascar volcano (~23.4 S).

Sources (fetched over HTTPS, cached in $GEO_CACHE):
  - Elevation and bathymetry: Mapzen/Tilezen "Terrarium" tiles on AWS Open Data (SRTM, GMTED, ETOPO1 and others).
  - Colour: Sentinel-2 L2A 120 m cloudless mosaic (Sinergise / Sentinel Hub on AWS Open Data), CC-BY 4.0,
    "Contains modified Copernicus data 2020 processed by Sentinel Hub".

Scene frame (km): sinusoidal projection centred on the trench axis at the cut latitude.
  x = east, z = -(north distance from the cut), so the land runs away from the camera toward -z.

Run:  python3 -I scripts/geodata/build.py     (needs rasterio, numpy, pillow)
"""

import io
import json
import math
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'geo')
CACHE = os.environ.get('GEO_CACHE', '/tmp/geo-cache')
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

R = 6371000.0
LAT0 = -23.37  # cut latitude: Lascar volcano
LASCAR = (-67.73, -23.37)
MOSAIC = ['2020/8/22', '2020/9/11', '2020/8/2']  # dry season (clear Altiplano, snow on the high peaks)

# Scene-space grids: (x0, x1, zNear, zFar) in km, and texture sizes
NEAR = dict(x0=-650.0, x1=1100.0, z0=0.0, z1=-1750.0, color=4096, dem=2048)
FAR = dict(x0=-1600.0, x1=2600.0, z0=0.0, z1=-4400.0, color=2048, dem=1024)
# Sharpest tier: the margin around the cut (trench to Puna, first 800 km of coast)
MID = dict(x0=-150.0, x1=650.0, z0=0.0, z1=-800.0, color=4096, dem=2048)

ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CURL_CA_BUNDLE='/root/.ccr/ca-bundle.crt', GDAL_HTTP_MAX_RETRY='4',
           GDAL_HTTP_RETRY_DELAY='2', VSI_CACHE='TRUE', GDAL_CACHEMAX=512)


def fetch(url, path):
    if os.path.exists(path):
        return path
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            with open(path, 'wb') as f:
                f.write(data)
            return path
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                print('fail', url, e, file=sys.stderr)
                return None


# ------------------------------------------------------------------ elevation (Terrarium, web mercator)
def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def terrarium_mosaic(z, lon0, lon1, lat0, lat1):
    tx0, ty0 = lonlat_to_tile(lon0, lat1, z)
    tx1, ty1 = lonlat_to_tile(lon1, lat0, z)
    xs = range(int(tx0), int(tx1) + 1)
    ys = range(int(ty0), int(ty1) + 1)
    jobs = [(x, y) for y in ys for x in xs]

    def get(t):
        x, y = t
        p = os.path.join(CACHE, f'terrarium_{z}_{x}_{y}.png')
        return t, fetch(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', p)

    with ThreadPoolExecutor(16) as ex:
        res = list(ex.map(get, jobs))
    W, H = len(xs) * 256, len(ys) * 256
    out = np.zeros((H, W), np.float32)
    for (x, y), p in res:
        if not p:
            continue
        a = np.asarray(Image.open(p).convert('RGB'), np.float32)
        h = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        out[(y - ys[0]) * 256:(y - ys[0] + 1) * 256, (x - xs[0]) * 256:(x - xs[0] + 1) * 256] = h
    # web mercator transform of the mosaic
    world = 2 * math.pi * 6378137
    res_m = world / (256 * 2 ** z)
    left = xs[0] * 256 * res_m - world / 2
    top = world / 2 - ys[0] * 256 * res_m
    return out, Affine(res_m, 0, left, 0, -res_m, top)


# ------------------------------------------------------------------ projection helpers
def scene_crs(lon_t):
    return CRS.from_proj4(f'+proj=sinu +lon_0={lon_t} +x_0=0 +y_0=0 +R={R} +units=m +no_defs')


Y0 = R * math.radians(LAT0)


def grid_transform(g, n_w, n_h):
    """North-up raster covering the scene box; row 0 is the far (north) edge."""
    res_x = (g['x1'] - g['x0']) * 1000 / n_w
    res_y = (g['z0'] - g['z1']) * 1000 / n_h
    top = Y0 + (g['z0'] - g['z1']) * 1000
    return Affine(res_x, 0, g['x0'] * 1000, 0, -res_y, top)


def to_scene(lon, lat, lon_t):
    x = R * math.radians(lon - lon_t) * math.cos(math.radians(lat)) / 1000
    z = -(R * math.radians(lat) - Y0) / 1000
    return x, z


def scene_lonlat_box(g, lon_t):
    lat_s = LAT0 - 0.5
    lat_n = math.degrees((Y0 + (g['z0'] - g['z1']) * 1000) / R) + 0.5
    cmin = min(math.cos(math.radians(lat_s)), math.cos(math.radians(lat_n)), 1.0 if lat_s < 0 < lat_n else 2)
    cmin = min(cmin, math.cos(math.radians(max(abs(lat_s), abs(lat_n)))))
    lon0 = lon_t + math.degrees(g['x0'] * 1000 / R / cmin) - 0.5
    lon1 = lon_t + math.degrees(g['x1'] * 1000 / R / cmin) + 0.5
    return lon0, lon1, lat_s, lat_n


def warp_dem(g, lon_t, z, size):
    lon0, lon1, lat_s, lat_n = scene_lonlat_box(g, lon_t)
    src, src_tr = terrarium_mosaic(z, max(lon0, -179), min(lon1, 179), lat_s, lat_n)
    dst = np.zeros((size, size), np.float32)
    reproject(src, dst, src_transform=src_tr, src_crs=CRS.from_epsg(3857), dst_transform=grid_transform(g, size, size),
              dst_crs=scene_crs(lon_t), resampling=Resampling.cubic)
    return dst


# ------------------------------------------------------------------ colour (Sentinel-2 120 m mosaic, UTM tiles)
BANDS_LAT = 'CDEFGHJKLMNPQRSTUVWX'


def mgrs_tiles(lon0, lon1, lat0, lat1):
    out = []
    for zone in range(int((lon0 + 180) // 6) + 1, int((lon1 + 180) // 6) + 2):
        for i, b in enumerate(BANDS_LAT):
            bl = -80 + 8 * i
            if bl + 8 > lat0 and bl < lat1:
                out.append(f'{zone:02d}{b}')
    return out


def warp_color(g, lon_t, size, overview):
    lon0, lon1, lat_s, lat_n = scene_lonlat_box(g, lon_t)
    tiles = mgrs_tiles(lon0, lon1, lat_s, lat_n)
    acc = np.zeros((3, size, size), np.float32)
    have = np.zeros((size, size), bool)
    dst_tr = grid_transform(g, size, size)
    dst_crs = scene_crs(lon_t)

    def one(tile):
        result = None
        for date in MOSAIC:
            bands = []
            try:
                for b in ('B04', 'B03', 'B02'):
                    url = f'/vsicurl/https://sentinel-s2-l2a-mosaic-120.s3.amazonaws.com/{date}/{tile}/{b}.tif'
                    with rasterio.Env(**ENV):
                        with rasterio.open(url, overview_level=overview) as src:
                            arr = src.read(1).astype(np.float32)
                            dst = np.zeros((size, size), np.float32)
                            reproject(arr, dst, src_transform=src.transform, src_crs=src.crs, dst_transform=dst_tr,
                                      dst_crs=dst_crs, resampling=Resampling.bilinear, src_nodata=0, dst_nodata=0)
                            bands.append(dst)
            except Exception as e:  # noqa: BLE001
                print('  skip', tile, date, str(e)[:80])
                continue
            stack = np.stack(bands)
            if result is None:
                result = stack
            else:
                hole = result[0] <= 0
                result[:, hole] = stack[:, hole]
            if not (result[0] <= 0).any():
                break
        print('  tile', tile, 'ok' if result is not None else 'none')
        return result

    with ThreadPoolExecutor(6) as ex:
        for r in ex.map(one, tiles):
            if r is None:
                continue
            m = (r[0] > 0) & ~have
            acc[:, m] = r[:, m]
            have |= m
    return acc / 10000.0, have


# ------------------------------------------------------------------ de-shading
def sun_vector(lat):
    """Sentinel-2 overpass (~10:30 local solar time) in late August."""
    dec = math.radians(10.0)
    ha = math.radians(-22.5)
    la = math.radians(lat)
    el = math.asin(math.sin(la) * math.sin(dec) + math.cos(la) * math.cos(dec) * math.cos(ha))
    az = math.atan2(-math.sin(ha), math.tan(dec) * math.cos(la) - math.sin(la) * math.cos(ha))  # from north, clockwise
    return math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)  # east, north, up


def deshade(rgb, dem, g, size):
    """Removes the terrain shading baked into the satellite image, so the scene lighting does the shading."""
    d = np.asarray(Image.fromarray(dem).resize((size, size), Image.BILINEAR), np.float32)
    px = (g['x1'] - g['x0']) * 1000 / size
    gy, gx = np.gradient(np.maximum(d, 0), px)  # rows run north -> south
    ne, nn, nu = -gx, gy, np.ones_like(gx)
    inv = 1 / np.sqrt(ne * ne + nn * nn + 1)
    ne, nn, nu = ne * inv, nn * inv, nu * inv
    lat_rows = LAT0 + np.degrees((g['z0'] - g['z1']) * 1000 * (1 - (np.arange(size) + 0.5) / size) / R)
    sh = np.zeros_like(d)
    for i, lat in enumerate(lat_rows):
        se, sn, su = sun_vector(lat)
        lam = ne[i] * se + nn[i] * sn + nu[i] * su
        sh[i] = np.clip(lam, 0.12, 1) / su
    sh = np.clip(sh, 0.35, 1.6)
    return rgb / (1 + 0.85 * (sh - 1))[None]


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def save_color(rgb, have, path):
    # fill gaps (open ocean, no data) with a dark neutral; the ocean shader covers water anyway
    rgb = rgb.copy()
    rgb[:, ~have] = np.array([0.05, 0.055, 0.06])[:, None]
    img = (srgb(rgb).transpose(1, 2, 0) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(img).save(path, quality=84, method=6)


def save_dem(dem, path):
    """Terrarium encoding (R * 256 + G + B / 256 - 32768 m), rounded to whole metres so it compresses well."""
    v = np.clip(np.round(dem) + 32768, 0, 65535)
    r = np.floor(v / 256)
    gch = v - r * 256
    Image.fromarray(np.stack([r, gch, np.zeros_like(r)], -1).astype(np.uint8)).save(path, lossless=True, quality=100, method=6)


def main():
    # 1. trench axis at the cut latitude: deepest point of a coarse E-W profile
    src, tr = terrarium_mosaic(9, -73.5, -69.5, LAT0 - 0.1, LAT0 + 0.1)
    inv = ~tr
    best = (1e9, None)
    for lon in np.arange(-72.6, -70.4, 0.01):
        mx = R * math.radians(lon) * (6378137 / R)
        my = 6378137 * math.log(math.tan(math.pi / 4 + math.radians(LAT0) / 2))
        c, r = inv * (mx, my)
        h = src[int(r), int(c)]
        if h < best[0]:
            best = (h, lon)
    lon_t = round(float(best[1]), 3)
    print('trench', lon_t, best[0])

    meta = dict(lat0=LAT0, lonTrench=lon_t, R_km=R / 1000, near=NEAR, far=FAR, mid=MID,
                lascar=to_scene(*LASCAR, lon_t),
                credit='Elevation: Mapzen Terrarium (SRTM, GMTED, ETOPO1); imagery: contains modified Copernicus Sentinel data 2020 processed by Sentinel Hub (CC-BY 4.0)')

    only = sys.argv[1:] or ['far', 'near', 'mid']
    for name, g, zl, ov in (('far', FAR, 6, 3), ('near', NEAR, 9, 0), ('mid', MID, 10, 0)):
        if name not in only:
            continue
        print(name, 'dem')
        dem = warp_dem(g, lon_t, zl, g['dem'])
        save_dem(dem, os.path.join(OUT, f'{name}_dem.webp'))
        print(name, 'color')
        rgb, have = warp_color(g, lon_t, g['color'], ov)
        dem_full = warp_dem(g, lon_t, zl, g['dem'])
        rgb = deshade(rgb, dem_full, g, g['color'])
        save_color(rgb, have, os.path.join(OUT, f'{name}_color.webp'))
        np.save(os.path.join(CACHE, f'{name}_rgb.npy'), rgb)

    # profile along the cut for the model constants (coast, peaks)
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == '__main__':
    main()

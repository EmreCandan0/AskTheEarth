/**
 * AskTheEarth - NDVI Analyzer
 * Frontend Application
 */

// ============================================
// Global State
// ============================================
const state = {
    selectedFile: null,
    selectedFileName: null,
    isUploaded: false,
    bandFolder: null,
    bandFolders: [],
    marker: null,
    geojsonLayer: null,
    drawnLayer: null,
    drawnBounds: null,
    isDrawing: false,
    drawHandler: null,
    // Raster layers
    rgbLayers: [],
    ndviLayers: [],
    rasterData: null,
    hasDownloadedData: false,
    currentTiles: [], // Mevcut indirilen tile'lar
    isDownloading: false, // İndirme durumu
    // Index layers for all types
    indexLayers: {}, // { ndvi: layer, ndwi: layer, ... }
    layerOpacity: 0.8,
    // İstatistik cache - her indeks tipi için hesaplanan veriler
    statsCache: {}, // { ndvi: { statistics, histogram, classification }, nbr: {...}, ... }
    // AOI (Area of Interest) - çizilen alan geometrisi
    aoiGeometry: null, // GeoJSON geometry
    drawMode: 'rectangle', // 'rectangle' veya 'polygon'
    // AI Chat state
    chatMessages: [],
    geminiApiKey: localStorage.getItem('gemini_api_key') || '',
    aiProvider: 'gemini',
    isChatLoading: false
};

// ============================================
// Page Unload Handler - Cancel Backend Operations
// ============================================
window.addEventListener('beforeunload', (event) => {
    if (state.isDownloading) {
        // Sayfa kapanırken/yenilenirken backend'e iptal sinyali gönder
        // sendBeacon kullanarak güvenilir teslimat sağla
        navigator.sendBeacon('/api/cancel', JSON.stringify({ reason: 'page_unload' }));
        console.log('[CANCEL] Sent cancellation signal to backend');
    }
});

// Sayfa yüklendiğinde mevcut işlemleri iptal et (önceki sayfadan kalan olabilir)
window.addEventListener('load', () => {
    // Sayfa yüklendiğinde backend'e temizlik sinyali gönder
    fetch('/api/cancel', { method: 'POST' })
        .then(() => console.log('[CANCEL] Cleanup signal sent on page load'))
        .catch(() => { });
});


// ============================================
// Map Initialization
// ============================================
const map = L.map('map', {
    center: [40.8, 29.5],
    zoom: 8,
    zoomControl: true
});

// ============================================
// Base Layer Options
// ============================================

// Dark (Varsayılan)
const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
});

// Street Map (Sokak Haritası)
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
});

// Topographic (Topografik)
const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenTopoMap (CC-BY-SA)',
    maxZoom: 17
});

// Satellite (Uydu - ESRI)
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19
});

// Terrain (Arazi - Stamen/Stadia)
const terrainLayer = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; Stamen Design, Stadia Maps',
    maxZoom: 18
});

// Base layers object for control
const baseLayers = {
    "🌙 Koyu": darkLayer,
    "🗺️ Sokak": streetLayer,
    "🏔️ Topografik": topoLayer,
    "🛰️ Uydu": satelliteLayer,
    "🌄 Arazi": terrainLayer
};

// Add default layer
darkLayer.addTo(map);

// Add layer control to map
L.control.layers(baseLayers, null, {
    position: 'topright',
    collapsed: true
}).addTo(map);

// Custom marker icon
const markerIcon = L.divIcon({
    className: 'custom-marker',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

// ============================================
// Leaflet Draw Setup
// ============================================
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// Rectangle draw options
const rectangleDrawOptions = {
    shapeOptions: {
        color: '#22c55e',
        fillColor: '#22c55e',
        fillOpacity: 0.15,
        weight: 2
    }
};

// Polygon draw options
const polygonDrawOptions = {
    allowIntersection: false,
    showArea: true,
    shapeOptions: {
        color: '#22c55e',
        fillColor: '#22c55e',
        fillOpacity: 0.15,
        weight: 2
    }
};

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;

    container.appendChild(toast);

    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.remove();
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// ============================================
// Loading State
// ============================================
function showLoading(text = 'Isleniyor...') {
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loading-text');
    if (loading && loadingText) {
        loadingText.textContent = text;
        loading.style.display = 'flex';
    }
}

function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'none';
    }
}

// ============================================
// Status Update
// ============================================
function setStatus(text) {
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.textContent = text;
    }
}

// ============================================
// GeoJSON Generation from Bounds
// ============================================
function boundsToGeoJSON(bounds) {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    return {
        type: "FeatureCollection",
        features: [{
            type: "Feature",
            properties: {},
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [sw.lng, sw.lat],
                    [ne.lng, sw.lat],
                    [ne.lng, ne.lat],
                    [sw.lng, ne.lat],
                    [sw.lng, sw.lat]
                ]]
            }
        }]
    };
}

// ============================================
// Save Generated GeoJSON
// ============================================
async function saveGeneratedGeoJSON(geojson) {
    const timestamp = Date.now();
    const filename = `drawn_area_${timestamp}.geojson`;

    try {
        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
        const file = new File([blob], filename, { type: 'application/json' });

        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/geojson/upload', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            state.selectedFileName = filename;
            loadExistingFiles();
            return filename;
        } else {
            throw new Error('Upload failed');
        }
    } catch (err) {
        console.error('Failed to save GeoJSON:', err);
        throw err;
    }
}

// ============================================
// Draw Event Handlers
// ============================================
map.on('draw:created', async (e) => {
    const layer = e.layer;
    const layerType = e.layerType; // 'rectangle' veya 'polygon'

    // Clear previous drawings
    drawnItems.clearLayers();
    if (state.geojsonLayer) {
        map.removeLayer(state.geojsonLayer);
        state.geojsonLayer = null;
    }

    drawnItems.addLayer(layer);
    state.drawnLayer = layer;
    state.drawnBounds = layer.getBounds();

    // Layer'dan GeoJSON geometry al ve sakla
    const layerGeoJSON = layer.toGeoJSON();
    state.aoiGeometry = layerGeoJSON.geometry;
    console.log('[DRAW] AOI Geometry saved:', state.aoiGeometry.type);

    // Update UI
    const nw = state.drawnBounds.getNorthWest();
    const se = state.drawnBounds.getSouthEast();

    const coordNW = document.getElementById('coord-nw');
    const coordSE = document.getElementById('coord-se');
    const drawnAreaInfo = document.getElementById('drawn-area-info');
    const btnClearDraw = document.getElementById('btn-clear-draw');
    const fileInfo = document.getElementById('file-info');
    const existingGeojson = document.getElementById('existing-geojson');

    if (coordNW) coordNW.textContent = `${nw.lat.toFixed(4)}, ${nw.lng.toFixed(4)}`;
    if (coordSE) coordSE.textContent = `${se.lat.toFixed(4)}, ${se.lng.toFixed(4)}`;
    if (drawnAreaInfo) drawnAreaInfo.style.display = 'block';
    if (btnClearDraw) btnClearDraw.style.display = 'flex';

    // GeoJSON olustur ve kaydet (poligon veya dikdortgen)
    let geojson;
    if (state.aoiGeometry.type === 'Polygon') {
        // Poligon icin direkt layer'dan al
        geojson = {
            type: 'FeatureCollection',
            features: [layerGeoJSON]
        };
    } else {
        // Dikdortgen icin bounds'tan olustur
        geojson = boundsToGeoJSON(state.drawnBounds);
    }

    try {
        showLoading('Alan kaydediliyor...');
        const filename = await saveGeneratedGeoJSON(geojson);
        showToast(`Alan kaydedildi: ${filename}`, 'success');
        setStatus('Alan secildi');

        // Clear file upload selection
        if (fileInfo) fileInfo.style.display = 'none';
        if (existingGeojson) existingGeojson.value = '';
    } catch (err) {
        showToast('Alan kaydedilemedi', 'error');
    } finally {
        hideLoading();
    }

    state.isDrawing = false;
});

map.on('draw:drawstart', () => {
    state.isDrawing = true;
});

map.on('draw:drawstop', () => {
    state.isDrawing = false;
});

// ============================================
// Start Drawing Function (Rectangle)
// ============================================
function startDrawing() {
    startDrawingWithMode('rectangle');
}

function startDrawingPolygon() {
    startDrawingWithMode('polygon');
}

function startDrawingWithMode(mode) {
    console.log(`startDrawing called with mode: ${mode}`);
    state.drawMode = mode;

    try {
        // Disable any existing draw handler
        if (state.drawHandler) {
            state.drawHandler.disable();
        }

        // Check if L.Draw exists
        if (typeof L.Draw === 'undefined') {
            console.error('L.Draw is not defined! Leaflet Draw plugin not loaded.');
            showToast('Hata: Leaflet Draw yuklenmemis!', 'error');
            return;
        }

        // Create draw handler based on mode
        if (mode === 'polygon') {
            state.drawHandler = new L.Draw.Polygon(map, polygonDrawOptions);
            showToast('Haritada poligon cizin (cift tikla tamamla)', 'info');
        } else {
            state.drawHandler = new L.Draw.Rectangle(map, rectangleDrawOptions);
            showToast('Haritada dikdortgen cizin', 'info');
        }

        state.drawHandler.enable();
        setStatus('Cizim modu aktif...');
    } catch (error) {
        console.error('startDrawing error:', error);
        showToast('Hata: ' + error.message, 'error');
    }
}

// ============================================
// Clear Drawing Function
// ============================================
function clearDrawing() {
    console.log('Clearing drawing...');

    drawnItems.clearLayers();
    state.drawnLayer = null;
    state.drawnBounds = null;
    state.selectedFileName = null;
    state.aoiGeometry = null; // AOI'yi de temizle

    const drawnAreaInfo = document.getElementById('drawn-area-info');
    const btnClearDraw = document.getElementById('btn-clear-draw');

    if (drawnAreaInfo) drawnAreaInfo.style.display = 'none';
    if (btnClearDraw) btnClearDraw.style.display = 'none';

    setStatus('Hazir');
    showToast('Alan temizlendi', 'info');
}

// ============================================
// Toggle Upload Section
// ============================================
function toggleUploadSection() {
    console.log('toggleUploadSection called!');

    const content = document.getElementById('upload-content');
    const btn = document.getElementById('btn-toggle-upload');

    if (!content) {
        console.error('upload-content element not found');
        return;
    }

    const icon = btn ? btn.querySelector('.toggle-icon') : null;

    if (content.style.display === 'none' || content.style.display === '') {
        content.style.display = 'block';
        if (icon) icon.style.transform = 'rotate(180deg)';
    } else {
        content.style.display = 'none';
        if (icon) icon.style.transform = 'rotate(0deg)';
    }
}

// ============================================
// File Upload Handlers
// ============================================
async function handleFileSelect(file) {
    if (!file) return;

    if (!file.name.endsWith('.geojson') && !file.name.endsWith('.json')) {
        showToast('Lutfen GeoJSON dosyasi secin', 'error');
        return;
    }

    state.selectedFile = file;
    state.selectedFileName = file.name;

    const selectedFileName = document.getElementById('selected-file-name');
    const fileInfo = document.getElementById('file-info');
    const existingGeojson = document.getElementById('existing-geojson');

    if (selectedFileName) selectedFileName.textContent = file.name;
    if (fileInfo) fileInfo.style.display = 'flex';
    if (existingGeojson) existingGeojson.value = '';

    // Clear drawn area
    drawnItems.clearLayers();
    state.drawnLayer = null;
    state.drawnBounds = null;

    const drawnAreaInfo = document.getElementById('drawn-area-info');
    const btnClearDraw = document.getElementById('btn-clear-draw');

    if (drawnAreaInfo) drawnAreaInfo.style.display = 'none';
    if (btnClearDraw) btnClearDraw.style.display = 'none';

    // Parse and display on map
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const geojson = JSON.parse(e.target.result);
            displayGeoJSON(geojson);

            // Upload to server
            await uploadGeoJSON(file);

            showToast('GeoJSON basariyla yuklendi', 'success');
            setStatus('GeoJSON yuklendi');
        } catch (err) {
            showToast('GeoJSON parse hatasi', 'error');
        }
    };
    reader.readAsText(file);
}

function displayGeoJSON(geojson) {
    if (state.geojsonLayer) {
        map.removeLayer(state.geojsonLayer);
    }

    // Clear drawn items
    drawnItems.clearLayers();

    state.geojsonLayer = L.geoJSON(geojson, {
        style: {
            fillColor: '#22c55e',
            fillOpacity: 0.15,
            color: '#22c55e',
            weight: 2
        }
    }).addTo(map);

    map.fitBounds(state.geojsonLayer.getBounds(), { padding: [50, 50] });
}

// Load existing GeoJSON files from API
async function loadExistingFiles() {
    try {
        const response = await fetch('/api/geojson/list');
        if (response.ok) {
            const data = await response.json();
            const existingGeojson = document.getElementById('existing-geojson');
            if (existingGeojson) {
                existingGeojson.innerHTML = '<option value="">Mevcut dosyalardan sec...</option>';
                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file;
                    option.textContent = file;
                    existingGeojson.appendChild(option);
                });
            }
        }
    } catch (err) {
        console.error('Failed to load existing files:', err);
    }
}

// Upload new GeoJSON file
async function uploadGeoJSON(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/geojson/upload', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            loadExistingFiles();
        } else {
            const data = await response.json();
            showToast(data.detail || 'Yukleme hatasi', 'error');
        }
    } catch (err) {
        showToast('Yukleme hatasi', 'error');
    }
}

// Clear file selection
function clearFileSelection() {
    state.selectedFile = null;
    state.selectedFileName = null;

    const fileInfo = document.getElementById('file-info');
    const geojsonInput = document.getElementById('geojson-input');
    const existingGeojson = document.getElementById('existing-geojson');

    if (fileInfo) fileInfo.style.display = 'none';
    if (geojsonInput) geojsonInput.value = '';
    if (existingGeojson) existingGeojson.value = '';

    if (state.geojsonLayer) {
        map.removeLayer(state.geojsonLayer);
        state.geojsonLayer = null;
    }

    setStatus('Hazir');
}

// Handle existing file selection
async function handleExistingFileSelect(filename) {
    if (!filename) return;

    state.selectedFileName = filename;
    state.selectedFile = null;

    const selectedFileName = document.getElementById('selected-file-name');
    const fileInfo = document.getElementById('file-info');

    if (selectedFileName) selectedFileName.textContent = filename;
    if (fileInfo) fileInfo.style.display = 'flex';

    // Clear drawn area
    drawnItems.clearLayers();
    state.drawnLayer = null;
    state.drawnBounds = null;
    state.aoiGeometry = null; // Reset AOI

    const drawnAreaInfo = document.getElementById('drawn-area-info');
    const btnClearDraw = document.getElementById('btn-clear-draw');

    if (drawnAreaInfo) drawnAreaInfo.style.display = 'none';
    if (btnClearDraw) btnClearDraw.style.display = 'none';

    // Load and display existing GeoJSON
    try {
        const response = await fetch(`/geojson/${filename}`);
        if (response.ok) {
            const geojson = await response.json();
            displayGeoJSON(geojson);

            // AOI geometry'yi set et (stats hesaplaması için)
            if (geojson.features && geojson.features.length > 0) {
                state.aoiGeometry = geojson.features[0].geometry;
                console.log('[GEOJSON] AOI geometry loaded from file:', state.aoiGeometry.type);

                // Bounds'u da set et
                if (state.geojsonLayer) {
                    state.drawnBounds = state.geojsonLayer.getBounds();
                    console.log('[GEOJSON] Bounds set from loaded layer');
                }
            }

            showToast('GeoJSON yuklendi', 'success');
            setStatus('GeoJSON secildi');
        }
    } catch (err) {
        showToast('GeoJSON yuklenemedi', 'error');
    }
}

// ============================================
// Download Handler
// ============================================
async function handleDownload() {
    if (!state.selectedFileName) {
        showToast('Once alan secin veya GeoJSON yukleyin', 'warning');
        return;
    }

    showLoading('Sentinel-2 verisi indiriliyor... (Birden fazla tile inebilir)');
    setStatus('Indiriliyor...');

    const dateAuto = document.getElementById('date-auto');
    const cloudcover = document.getElementById('cloudcover');
    const startDate = document.getElementById('start-date');
    const endDate = document.getElementById('end-date');

    const requestBody = {
        geojson_name: state.selectedFileName,
        date_auto: dateAuto ? dateAuto.checked : true,
        cloudcover_max: cloudcover ? parseInt(cloudcover.value) : 20
    };

    if (dateAuto && !dateAuto.checked && startDate && endDate) {
        requestBody.start_date = startDate.value;
        requestBody.end_date = endDate.value;
    }

    // İndirme durumunu ayarla
    state.isDownloading = true;

    try {
        const response = await fetch('/download/sentinel2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            // Önceki raster layer'ları temizle
            state.rgbLayers.forEach(layer => map.removeLayer(layer));
            state.ndviLayers.forEach(layer => map.removeLayer(layer));
            state.rgbLayers = [];
            state.ndviLayers = [];

            state.bandFolder = data.band_folder;
            state.bandFolders = data.band_folders || [data.band_folder];
            state.hasDownloadedData = true;
            state.currentTiles = data.tiles || []; // Mevcut tile'ları sakla

            const tileCount = data.tiles ? data.tiles.length : 1;
            const tileNames = data.tiles ? data.tiles.join(', ') : '';

            showToast(`${tileCount} tile indirildi: ${tileNames}`, 'success');
            setStatus('RGB görüntüsü oluşturuluyor...');

            // Otomatik RGB görüntüsü oluştur ve haritaya ekle
            try {
                await autoCreateRGBLayers();
                setStatus('Hazır - İndeks katmanı oluşturabilirsiniz');
            } catch (rgbErr) {
                console.error('RGB oluşturma hatası:', rgbErr);
                setStatus('Hazır - RGB oluşturulamadı');
            }
        } else {
            showToast(data.detail || 'Indirme hatasi', 'error');
            setStatus('Hata');
        }
    } catch (err) {
        showToast('Baglanti hatasi', 'error');
        setStatus('Baglanti hatasi');
    } finally {
        state.isDownloading = false;
        hideLoading();
    }
}

// ============================================
// Map Click Handler
// ============================================
map.on('click', (e) => {
    // Don't place marker if drawing
    if (state.isDrawing) return;

    const { lat, lng } = e.latlng;

    // Update inputs
    const latInput = document.getElementById('lat');
    const lonInput = document.getElementById('lon');
    const coordsDisplay = document.getElementById('coords-display');
    const coordsText = document.getElementById('coords-text');

    if (latInput) latInput.value = lat.toFixed(6);
    if (lonInput) lonInput.value = lng.toFixed(6);

    // Update marker
    if (state.marker) {
        state.marker.setLatLng([lat, lng]);
    } else {
        state.marker = L.marker([lat, lng], { icon: markerIcon }).addTo(map);
    }

    // Show coordinates
    if (coordsDisplay) coordsDisplay.style.display = 'flex';
    if (coordsText) coordsText.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
});

// ============================================
// NDVI Calculation
// ============================================
async function calculatePointIndex() {
    const latInput = document.getElementById('lat');
    const lonInput = document.getElementById('lon');
    // İndeks seçimini Alan İstatistikleri panelinden al
    const indexSelect = document.getElementById('index-select');

    const lat = latInput ? parseFloat(latInput.value) : NaN;
    const lon = lonInput ? parseFloat(lonInput.value) : NaN;
    const indexType = indexSelect ? indexSelect.value : 'ndvi';
    const indexName = indexSelect ? indexSelect.options[indexSelect.selectedIndex].text : 'NDVI';

    if (isNaN(lat) || isNaN(lon)) {
        showToast('Koordinat girin veya haritada bir nokta seçin', 'warning');
        return;
    }

    if (!state.hasDownloadedData) {
        showToast('Önce Sentinel-2 verisi indirin', 'warning');
        return;
    }

    showLoading(`${indexName} hesaplanıyor...`);
    setStatus(`${indexType.toUpperCase()} hesaplanıyor...`);

    try {
        const response = await fetch('/api/stats/point', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lat: lat,
                lon: lon,
                index_type: indexType,
                window_size: 5
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            displayPointResult(data, indexType, indexName);
            addPointMarker(lat, lon, data.point_value, indexType);
            showToast(`${indexName} hesaplandı`, 'success');
            setStatus('Hazır');
        } else {
            showToast(data.detail || 'İndeks hesaplama hatası', 'error');
            setStatus('Hata');
        }
    } catch (err) {
        console.error('Point index error:', err);
        showToast('Bağlantı hatası', 'error');
        setStatus('Bağlantı hatası');
    } finally {
        hideLoading();
    }
}

function displayPointResult(data, indexType, indexName) {
    const resultPanel = document.getElementById('panel-result');
    if (resultPanel) resultPanel.style.display = 'block';

    // Başlık
    const resultTitle = document.getElementById('result-title');
    if (resultTitle) resultTitle.textContent = `${indexName} Sonucu`;

    // Labels
    const pointLabel = document.getElementById('point-result-label');
    const meanLabel = document.getElementById('mean-result-label');
    if (pointLabel) pointLabel.textContent = `Nokta ${indexType.toUpperCase()}`;
    if (meanLabel) meanLabel.textContent = `Ortalama ${indexType.toUpperCase()}`;

    // Values
    const pointResult = document.getElementById('point-result');
    const meanResult = document.getElementById('mean-result');

    if (pointResult) {
        const valueEl = pointResult.querySelector('.value');
        if (valueEl) valueEl.textContent = data.point_value.toFixed(3);
    }

    if (meanResult) {
        const valueEl = meanResult.querySelector('.value');
        if (valueEl) valueEl.textContent = data.window_stats.mean.toFixed(3);
    }

    // Interpretation
    const interpretation = document.getElementById('result-interpretation');
    if (interpretation && data.interpretation) {
        interpretation.textContent = data.interpretation;
        interpretation.className = 'ndvi-interpretation';
    }

    // Scale marker
    updateScaleMarker(data.point_value);
}

function addPointMarker(lat, lon, value, indexType) {
    // Mevcut marker'ı kaldır
    if (state.marker) {
        map.removeLayer(state.marker);
    }

    const info = INDEX_INFO[indexType] || { icon: '📊', name: indexType.toUpperCase() };

    state.marker = L.marker([lat, lon], {
        icon: L.divIcon({
            className: 'point-marker-icon',
            html: `<div style="background: rgba(34, 197, 94, 0.9); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; white-space: nowrap;">${info.icon} ${value.toFixed(3)}</div>`,
            iconSize: null
        })
    }).addTo(map);

    state.marker.bindPopup(`
        <strong>${info.name}</strong><br>
        Değer: ${value.toFixed(4)}<br>
        Koordinat: ${lat.toFixed(5)}, ${lon.toFixed(5)}
    `);
}

function updateScaleMarker(value) {
    const marker = document.getElementById('scale-marker');
    if (!marker) return;

    // -1 to 1 aralığını 0-100% aralığına dönüştür
    const percent = ((value + 1) / 2) * 100;
    marker.style.left = `${Math.max(0, Math.min(100, percent))}%`;
    marker.style.display = 'block';
}

// Legacy calculateNDVI for backward compatibility
async function calculateNDVI() {
    document.getElementById('point-index-select').value = 'ndvi';
    await calculatePointIndex();
}

// ============================================
// Raster Layer Management
// ============================================

async function autoCreateRGBLayers() {
    // İndirme sonrası otomatik RGB görüntü oluşturma
    if (!state.bandFolders || state.bandFolders.length === 0) {
        console.warn('[RGB] No band folders available');
        return;
    }

    console.log('[RGB] Creating RGB layers for', state.bandFolders.length, 'tiles');

    for (const bandFolder of state.bandFolders) {
        try {
            const response = await fetch('/raster/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    band_folder: bandFolder,
                    raster_type: 'rgb'
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                console.log('[RGB] Created RGB for:', bandFolder);

                // Haritaya ekle
                if (data.web_path && data.bounds) {
                    const layer = addImageOverlay(data.web_path, data.bounds, 'rgb');
                    if (layer) {
                        state.rgbLayers.push(layer);
                        showToast('RGB görüntüsü eklendi', 'success');
                    }
                }
            } else {
                console.error('[RGB] Failed:', data.detail || 'Unknown error');
            }
        } catch (err) {
            console.error('[RGB] Error creating RGB:', err);
        }
    }

    // Layer kontrollerini göster
    const layerControls = document.getElementById('layer-controls');
    if (layerControls) layerControls.style.display = 'block';
}

async function autoLoadRasters() {
    // İndirme sonrası otomatik olarak görüntüleri yükle
    try {
        // Backend'den raster bilgilerini al (create-all endpoint'i bounds bilgisi de döner)
        const response = await fetch('/raster/create-all', {
            method: 'POST'
        });

        if (!response.ok) {
            // Eğer henüz oluşturulmamışsa, biraz bekle ve tekrar dene
            console.log('Rasters not ready yet, waiting...');
            setTimeout(async () => {
                await autoLoadRasters();
            }, 3000);
            return;
        }

        const data = await response.json();

        if (data.success && data.rasters) {
            // Backend zaten sadece mevcut tile'lar için raster oluşturuyor, filtrelemeye gerek yok
            console.log('Loading rasters:', data.rasters);

            // Görüntüleri haritaya ekle
            await displayRasterLayers(data.rasters);

            // Layer kontrollerini göster
            const layerControls = document.getElementById('layer-controls');
            const rasterHint = document.getElementById('raster-hint');

            if (layerControls) layerControls.style.display = 'block';
            if (rasterHint) rasterHint.textContent = 'Katman görünürlüğünü ayarlayın';

            setStatus('Görüntüler hazır');
            showToast('Görüntüler haritaya eklendi', 'success');
        } else {
            // Biraz bekle ve tekrar dene
            setTimeout(async () => {
                await autoLoadRasters();
            }, 2000);
        }

    } catch (err) {
        console.error('Auto-load rasters error:', err);
        // Hata olsa bile tekrar dene
        setTimeout(async () => {
            await autoLoadRasters();
        }, 3000);
    }
}

function filterRastersByTiles(rasters, currentTiles) {
    // Raster'ları mevcut tile ID'lerine göre filtrele
    if (!currentTiles || currentTiles.length === 0) {
        console.warn('No current tiles, showing all rasters');
        return rasters; // Tile bilgisi yoksa hepsini göster
    }

    const filtered = {
        rgb: [],
        ndvi: []
    };

    // RGB raster'ları filtrele
    if (rasters.rgb) {
        filtered.rgb = rasters.rgb.filter(raster => {
            const path = raster.web_path || '';
            // Tile ID formatı: T36TTL (örn: T36TTL)
            // Path formatı: /static/rasters/rgb_S2A_MSIL2A_20251216T085411_N0511_R107_T36TTL_20251216T110312.png
            // Tile ID'yi path'te ara: _T36TTL_ şeklinde geçiyor
            const matches = currentTiles.some(tile => {
                // Tile ID'yi path'te ara
                return path.includes(`_${tile}_`) || path.includes(`_${tile}.png`);
            });

            if (!matches) {
                console.log(`RGB raster filtered out: ${path} (tiles: ${currentTiles.join(', ')})`);
            }

            return matches;
        });
    }

    // NDVI raster'ları filtrele
    if (rasters.ndvi) {
        filtered.ndvi = rasters.ndvi.filter(raster => {
            const path = raster.web_path || '';
            const matches = currentTiles.some(tile => {
                return path.includes(`_${tile}_`) || path.includes(`_${tile}.png`);
            });

            if (!matches) {
                console.log(`NDVI raster filtered out: ${path} (tiles: ${currentTiles.join(', ')})`);
            }

            return matches;
        });
    }

    console.log(`Filtered rasters: RGB=${filtered.rgb.length}/${rasters.rgb?.length || 0}, NDVI=${filtered.ndvi.length}/${rasters.ndvi?.length || 0} (tiles: ${currentTiles.join(', ')})`);

    return filtered;
}

async function createRasters() {
    if (!state.hasDownloadedData) {
        showToast('Önce Sentinel-2 görüntüsü indirin', 'warning');
        return;
    }

    showLoading('Görüntüler oluşturuluyor...');
    setStatus('RGB ve NDVI görüntüleri hazırlanıyor...');

    try {
        const response = await fetch('/raster/create-all', {
            method: 'POST'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            state.rasterData = data.rasters;

            // Display rasters
            await displayRasterLayers(data.rasters);

            // Show layer controls
            const layerControls = document.getElementById('layer-controls');
            const rasterHint = document.getElementById('raster-hint');

            if (layerControls) layerControls.style.display = 'block';
            if (rasterHint) rasterHint.textContent = 'Katman görünürlüğünü ayarlayın';

            showToast(data.message, 'success');
            setStatus('Görüntüler hazır');
        } else {
            showToast(data.detail || 'Görüntü oluşturulamadı', 'error');
            setStatus('Hata');
        }
    } catch (err) {
        console.error('Raster creation error:', err);
        showToast('Bağlantı hatası', 'error');
        setStatus('Bağlantı hatası');
    } finally {
        hideLoading();
    }
}

async function displayRasterLayers(rasters) {
    // Clear existing raster layers
    state.rgbLayers.forEach(layer => map.removeLayer(layer));
    state.ndviLayers.forEach(layer => map.removeLayer(layer));
    state.rgbLayers = [];
    state.ndviLayers = [];

    let allBounds = null;

    // Process NDVI layers (now the primary overlay - shown by default)
    if (rasters.ndvi && rasters.ndvi.length > 0) {
        console.log(`Adding ${rasters.ndvi.length} NDVI layers`);
        for (const raster of rasters.ndvi) {
            try {
                if (!raster.web_path) {
                    console.warn('NDVI raster missing web_path:', raster);
                    continue;
                }
                if (!raster.bounds) {
                    console.warn('NDVI raster missing bounds:', raster);
                    continue;
                }

                const layer = addImageOverlay(raster.web_path, raster.bounds, 'ndvi');
                if (layer && raster.bounds) {
                    // Track bounds for fitting
                    if (!allBounds) {
                        allBounds = L.latLngBounds(
                            [raster.bounds.minLat, raster.bounds.minLon],
                            [raster.bounds.maxLat, raster.bounds.maxLon]
                        );
                    } else {
                        allBounds.extend([raster.bounds.minLat, raster.bounds.minLon]);
                        allBounds.extend([raster.bounds.maxLat, raster.bounds.maxLon]);
                    }
                }
            } catch (err) {
                console.error('Failed to add NDVI layer:', err, raster);
            }
        }
    } else {
        console.warn('No NDVI rasters to display');
    }

    // Fit to all bounds
    if (allBounds) {
        map.fitBounds(allBounds, { padding: [20, 20] });
    }

    // Set initial visibility (NDVI shown by default)
    updateLayerVisibility();
}

function addImageOverlay(webPath, bounds, type) {
    try {
        console.log(`Loading image: ${webPath}`);
        console.log(`Bounds:`, bounds);

        // Bounds kontrolü
        if (!bounds || !bounds.minLat || !bounds.maxLat || !bounds.minLon || !bounds.maxLon) {
            console.error(`Invalid bounds for ${webPath}:`, bounds);
            return null;
        }

        // Cache buster ekle
        const cacheBuster = `?t=${Date.now()}`;
        const imageUrl = webPath + cacheBuster;

        // Leaflet bounds (minLat, minLon) -> (maxLat, maxLon)
        const imageBounds = [
            [bounds.minLat, bounds.minLon],  // Güney-Batı
            [bounds.maxLat, bounds.maxLon]    // Kuzey-Doğu
        ];

        console.log(`Image bounds for Leaflet:`, imageBounds);

        // Image overlay oluştur
        const layer = L.imageOverlay(imageUrl, imageBounds, {
            opacity: 0.8,
            interactive: false
        });

        if (type === 'ndvi') {
            state.ndviLayers.push(layer);
            layer.addTo(map); // NDVI artık varsayılan olarak gösteriliyor
        } else if (type === 'rgb') {
            state.rgbLayers.push(layer);
            // RGB artık kullanılmıyor
        }

        console.log(`${type.toUpperCase()} layer added successfully at bounds:`, imageBounds);
        return layer;

    } catch (err) {
        console.error(`Failed to load ${type} image:`, err);
        return null;
    }
}

function updateLayerVisibility() {
    const toggleNdvi = document.getElementById('toggle-ndvi-layer');
    const opacitySlider = document.getElementById('layer-opacity');

    const showNdvi = toggleNdvi ? toggleNdvi.checked : true; // NDVI varsayılan olarak açık
    const opacity = opacitySlider ? parseInt(opacitySlider.value) / 100 : 0.8;

    // Update NDVI layers
    state.ndviLayers.forEach(layer => {
        if (showNdvi) {
            if (!map.hasLayer(layer)) {
                layer.addTo(map);
            }
            layer.setOpacity(opacity);
        } else {
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        }
    });
}

function setLayerOpacity(opacity) {
    const normalizedOpacity = opacity / 100;

    state.rgbLayers.forEach(layer => {
        if (map.hasLayer(layer)) {
            layer.setOpacity(normalizedOpacity);
        }
    });

    state.ndviLayers.forEach(layer => {
        if (map.hasLayer(layer)) {
            layer.setOpacity(normalizedOpacity);
        }
    });
}

// ============================================
// Display NDVI Result
// ============================================
function displayNDVIResult(data) {
    const panelResult = document.getElementById('panel-result');
    const ndviPointEl = document.querySelector('#ndvi-point .value');
    const ndviMeanEl = document.querySelector('#ndvi-mean .value');
    const scaleMarker = document.getElementById('scale-marker');
    const ndviInterpretation = document.getElementById('ndvi-interpretation');

    if (panelResult) panelResult.style.display = 'block';

    const pointNdvi = data.point_ndvi;
    const meanNdvi = data.mean_ndvi;

    // Display values
    if (ndviPointEl) ndviPointEl.textContent = pointNdvi !== null ? pointNdvi.toFixed(4) : 'N/A';
    if (ndviMeanEl) ndviMeanEl.textContent = meanNdvi !== null ? meanNdvi.toFixed(4) : 'N/A';

    // Update scale marker
    if (pointNdvi !== null && scaleMarker) {
        const position = ((pointNdvi + 1) / 2) * 100;
        scaleMarker.style.display = 'block';
        scaleMarker.style.left = `${Math.max(0, Math.min(100, position))}%`;
    }

    // Interpretation
    let interpretation = '';
    const ndvi = pointNdvi !== null ? pointNdvi : meanNdvi;

    if (ndvi !== null) {
        if (ndvi < 0) {
            interpretation = 'Su, kar veya bulut';
        } else if (ndvi < 0.2) {
            interpretation = 'Ciplak toprak veya kaya';
        } else if (ndvi < 0.4) {
            interpretation = 'Seyrek bitki ortusu';
        } else if (ndvi < 0.6) {
            interpretation = 'Orta yogunlukta bitki ortusu';
        } else {
            interpretation = 'Yogun bitki ortusu';
        }
    }

    if (ndviInterpretation) ndviInterpretation.textContent = interpretation;

    // Update marker popup
    if (state.marker) {
        state.marker.bindPopup(`
            <div style="font-family: sans-serif; padding: 8px;">
                <strong>NDVI:</strong> ${pointNdvi !== null ? pointNdvi.toFixed(4) : 'N/A'}<br>
                <small>${interpretation}</small>
            </div>
        `).openPopup();
    }
}

// ============================================
// Initialize Application
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing AskTheEarth...');

    // Set default dates
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setDate(lastMonth.getDate() - 20);

    const endDateInput = document.getElementById('end-date');
    const startDateInput = document.getElementById('start-date');

    if (endDateInput) endDateInput.value = today.toISOString().split('T')[0];
    if (startDateInput) startDateInput.value = lastMonth.toISOString().split('T')[0];

    // Load existing GeoJSON files
    loadExistingFiles();

    // ============================================
    // Event Listeners
    // ============================================

    // Draw button (Rectangle)
    const btnStartDraw = document.getElementById('btn-start-draw');
    if (btnStartDraw) {
        btnStartDraw.addEventListener('click', (e) => {
            e.preventDefault();
            startDrawing();
        });
        console.log('Draw button listener attached');
    } else {
        console.error('btn-start-draw not found');
    }

    // Draw Polygon button
    const btnDrawPolygon = document.getElementById('btn-draw-polygon');
    if (btnDrawPolygon) {
        btnDrawPolygon.addEventListener('click', (e) => {
            e.preventDefault();
            startDrawingPolygon();
        });
        console.log('Polygon draw button listener attached');
    }

    // Clear draw button
    const btnClearDraw = document.getElementById('btn-clear-draw');
    if (btnClearDraw) {
        btnClearDraw.addEventListener('click', (e) => {
            e.preventDefault();
            clearDrawing();
        });
        console.log('Clear draw button listener attached');
    }

    // Toggle upload section
    const btnToggleUpload = document.getElementById('btn-toggle-upload');
    if (btnToggleUpload) {
        btnToggleUpload.addEventListener('click', (e) => {
            e.preventDefault();
            toggleUploadSection();
        });
        console.log('Toggle upload button listener attached');
    } else {
        console.error('btn-toggle-upload not found');
    }

    // Upload zone
    const uploadZone = document.getElementById('upload-zone');
    const geojsonInput = document.getElementById('geojson-input');

    if (uploadZone && geojsonInput) {
        uploadZone.addEventListener('click', () => {
            geojsonInput.click();
        });

        geojsonInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                handleFileSelect(e.target.files[0]);
            }
        });

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            if (e.dataTransfer.files[0]) {
                handleFileSelect(e.dataTransfer.files[0]);
            }
        });

        console.log('Upload zone listeners attached');
    }

    // Existing file selection
    const existingGeojson = document.getElementById('existing-geojson');
    if (existingGeojson) {
        existingGeojson.addEventListener('change', (e) => {
            handleExistingFileSelect(e.target.value);
        });
    }

    // Clear file button
    const clearFile = document.getElementById('clear-file');
    if (clearFile) {
        clearFile.addEventListener('click', clearFileSelection);
    }

    // Date auto checkbox
    const dateAuto = document.getElementById('date-auto');
    const dateInputs = document.getElementById('date-inputs');
    if (dateAuto && dateInputs) {
        dateAuto.addEventListener('change', (e) => {
            dateInputs.style.display = e.target.checked ? 'none' : 'grid';
        });
    }

    // Cloud cover slider
    const cloudcover = document.getElementById('cloudcover');
    const cloudcoverValue = document.getElementById('cloudcover-value');
    if (cloudcover && cloudcoverValue) {
        cloudcover.addEventListener('input', (e) => {
            cloudcoverValue.textContent = e.target.value;
        });
    }

    // Download button
    const btnDownload = document.getElementById('btn-download');
    if (btnDownload) {
        btnDownload.addEventListener('click', (e) => {
            e.preventDefault();
            handleDownload();
        });
    }

    // Point Query button (generalized from NDVI)
    const btnPointQuery = document.getElementById('btn-point-query');
    if (btnPointQuery) {
        btnPointQuery.addEventListener('click', (e) => {
            e.preventDefault();
            calculatePointIndex();
        });
    }

    // ============================================
    // Raster Layer Controls
    // ============================================

    // RGB toggle
    const toggleRgb = document.getElementById('toggle-rgb');
    if (toggleRgb) {
        toggleRgb.addEventListener('change', () => {
            updateLayerVisibility();
        });
    }

    // Opacity slider
    const layerOpacity = document.getElementById('layer-opacity');
    const opacityValue = document.getElementById('opacity-value');
    if (layerOpacity) {
        layerOpacity.addEventListener('input', (e) => {
            const value = e.target.value;
            if (opacityValue) opacityValue.textContent = value;
            setLayerOpacity(parseInt(value));
        });
    }

    // Statistics button
    const btnCalculateStats = document.getElementById('btn-calculate-stats');
    if (btnCalculateStats) {
        btnCalculateStats.addEventListener('click', (e) => {
            e.preventDefault();
            calculateZonalStats();
        });
    }

    // İndeks tipi değiştiğinde cache'den istatistikleri göster
    const indexSelect = document.getElementById('index-select');
    if (indexSelect) {
        indexSelect.addEventListener('change', () => {
            onIndexTypeChange();
        });
    }

    setStatus('Hazir');
    console.log('AskTheEarth initialized successfully');
});

// ============================================
// Zonal Statistics Functions
// ============================================

async function calculateZonalStats() {
    if (!state.hasDownloadedData) {
        showToast('Önce Sentinel-2 verisi indirin', 'warning');
        return;
    }

    // Seçilen indeksi al
    const indexSelect = document.getElementById('index-select');
    const indexType = indexSelect ? indexSelect.value : 'ndvi';

    showLoading(`${indexType.toUpperCase()} istatistikleri hesaplanıyor...`);
    setStatus(`${indexType.toUpperCase()} hesaplanıyor...`);

    try {
        // Request body - AOI varsa ekle
        const requestBody = {
            index_type: indexType
        };

        // DEBUG: AOI durumunu kontrol et
        console.log('[STATS DEBUG] state.aoiGeometry:', state.aoiGeometry);
        console.log('[STATS DEBUG] state.drawnBounds:', state.drawnBounds);

        if (state.aoiGeometry) {
            requestBody.aoi_geojson = state.aoiGeometry;
            console.log('[STATS] Sending AOI geometry for zonal stats:', JSON.stringify(state.aoiGeometry).substring(0, 200));
        } else {
            console.warn('[STATS] WARNING: No AOI geometry! Stats will be calculated for entire tile.');
        }

        const response = await fetch('/api/stats/zonal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Cache'e kaydet
            state.statsCache[indexType] = data;
            console.log(`[STATS] Cached stats for ${indexType}`);

            displayZonalStats(data);
            showToast('İstatistikler hesaplandı', 'success');
            setStatus('İstatistikler hazır');
        } else {
            showToast(data.detail || 'İstatistik hesaplama hatası', 'error');
            setStatus('Hata');
        }
    } catch (err) {
        console.error('Stats error:', err);
        showToast('Bağlantı hatası', 'error');
        setStatus('Bağlantı hatası');
    } finally {
        hideLoading();
    }
}

// ============================================
// Calculate Point Index Value
// ============================================
async function calculatePointIndex() {
    const latInput = document.getElementById('lat');
    const lonInput = document.getElementById('lon');
    const indexSelect = document.getElementById('index-select');

    const lat = parseFloat(latInput?.value);
    const lon = parseFloat(lonInput?.value);
    const indexType = indexSelect ? indexSelect.value : 'ndvi';
    const indexName = indexSelect ? indexSelect.options[indexSelect.selectedIndex].text : 'NDVI';

    if (isNaN(lat) || isNaN(lon)) {
        showToast('Lütfen geçerli koordinat girin veya haritaya tıklayın', 'warning');
        return;
    }

    if (!state.hasDownloadedData) {
        showToast('Önce Sentinel-2 verisi indirin', 'warning');
        return;
    }

    showLoading(`${indexName} nokta değeri hesaplanıyor...`);
    setStatus('Hesaplanıyor...');

    try {
        const response = await fetch('/api/stats/point', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lat: lat,
                lon: lon,
                index_type: indexType,
                window_size: 5
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Sonucu göster
            const pointValue = data.point_value?.toFixed(4) || '-';
            showToast(`${indexName}: ${pointValue} (${data.interpretation || ''})`, 'success');
            setStatus(`${indexType.toUpperCase()}: ${pointValue}`);

            // Result panel'i güncelle
            const resultPanel = document.getElementById('panel-result');
            const pointResult = document.getElementById('point-result');
            const pointResultLabel = document.getElementById('point-result-label');
            const resultInterpretation = document.getElementById('result-interpretation');

            if (resultPanel) resultPanel.style.display = 'block';
            if (pointResult) {
                const valueSpan = pointResult.querySelector('.value');
                if (valueSpan) valueSpan.textContent = pointValue;
            }
            if (pointResultLabel) pointResultLabel.textContent = `${indexName} Nokta Değeri`;
            if (resultInterpretation) resultInterpretation.textContent = data.interpretation || '';
        } else {
            showToast(data.detail || 'Hesaplama hatası', 'error');
            setStatus('Hata');
        }
    } catch (err) {
        console.error('Point query error:', err);
        showToast('Bağlantı hatası', 'error');
        setStatus('Hata');
    } finally {
        hideLoading();
    }
}

// İndeks tipi değiştiğinde çağrılır - cache'den göster veya paneli temizle
function onIndexTypeChange() {
    const indexSelect = document.getElementById('index-select');
    const indexType = indexSelect ? indexSelect.value : 'ndvi';

    // Cache'de bu indeks için veri var mı?
    if (state.statsCache[indexType]) {
        console.log(`[STATS] Loading cached stats for ${indexType}`);
        displayZonalStats(state.statsCache[indexType]);
        showToast(`${indexType.toUpperCase()} istatistikleri cache'den yüklendi`, 'info');
    } else {
        // Cache'de yok, paneli temizle
        clearStatsPanel();
        console.log(`[STATS] No cached stats for ${indexType}`);
    }
}

// İstatistik panelini temizle
function clearStatsPanel() {
    const statMin = document.getElementById('stat-min');
    const statMax = document.getElementById('stat-max');
    const statMean = document.getElementById('stat-mean');
    const statStd = document.getElementById('stat-std');

    if (statMin) statMin.textContent = '-';
    if (statMax) statMax.textContent = '-';
    if (statMean) statMean.textContent = '-';
    if (statStd) statStd.textContent = '-';

    // Histogram'ı temizle
    const canvas = document.getElementById('histogram-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0d1210';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Sınıflandırma listesini temizle
    const classList = document.getElementById('class-list');
    if (classList) classList.innerHTML = '';

    // Export butonlarını gizle (panel görünür kalsın ama değerler boş)
    const exportButtons = document.getElementById('export-buttons');
    if (exportButtons) exportButtons.style.display = 'none';
}

function displayZonalStats(data) {
    // Show stats panel
    const statsPanel = document.getElementById('panel-stats');
    if (statsPanel) statsPanel.style.display = 'block';

    // Update statistics values
    const stats = data.statistics;
    document.getElementById('stat-min').textContent = stats.min.toFixed(3);
    document.getElementById('stat-max').textContent = stats.max.toFixed(3);
    document.getElementById('stat-mean').textContent = stats.mean.toFixed(3);
    document.getElementById('stat-std').textContent = stats.std.toFixed(3);

    // Draw histogram
    if (data.histogram) {
        drawHistogram(data.histogram);
    }

    // Display classification
    if (data.classification) {
        displayClassification(data.classification);
    }

    // Show export buttons
    const exportButtons = document.getElementById('export-buttons');
    if (exportButtons) exportButtons.style.display = 'block';

    // Setup export button handlers
    setupExportHandlers();
}

// Export handler setup
function setupExportHandlers() {
    const btnCsv = document.getElementById('btn-export-csv');
    const btnJson = document.getElementById('btn-export-json');

    if (btnCsv) {
        btnCsv.onclick = () => exportStats('csv');
    }
    if (btnJson) {
        btnJson.onclick = () => exportStats('json');
    }
}

async function exportStats(format) {
    const indexSelect = document.getElementById('index-select');
    const indexType = indexSelect ? indexSelect.value : 'ndvi';

    showLoading(`${format.toUpperCase()} hazırlanıyor...`);

    try {
        const response = await fetch('/api/export/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index_type: indexType, format: format })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Dosyayı indir
            const link = document.createElement('a');
            link.href = data.web_path;
            link.download = data.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            showToast(`${format.toUpperCase()} dosyası indirildi`, 'success');
        } else {
            showToast(data.detail || 'Export hatası', 'error');
        }
    } catch (err) {
        console.error('Export error:', err);
        showToast('Export hatası', 'error');
    } finally {
        hideLoading();
    }
}

// Create Index Map
async function createIndexMap() {
    if (!state.hasDownloadedData) {
        showToast('Önce Sentinel-2 verisi indirin', 'warning');
        return;
    }

    const indexSelect = document.getElementById('index-select');
    const indexType = indexSelect ? indexSelect.value : 'ndvi';
    const indexName = indexSelect ? indexSelect.options[indexSelect.selectedIndex].text : 'NDVI';

    // AOI kontrolü
    if (!state.aoiGeometry) {
        showToast('Önce haritada bir alan çizin', 'warning');
        return;
    }

    showLoading(`${indexName} haritası oluşturuluyor...`);
    setStatus(`${indexType.toUpperCase()} haritası hazırlanıyor`);

    try {
        // API'ye AOI geometry'yi de gönder
        const requestBody = {
            index_type: indexType,
            aoi_geojson: state.aoiGeometry  // Çizilen alan geometrisi
        };
        console.log('[MAP] Sending request with AOI:', state.aoiGeometry.type);

        const response = await fetch('/api/raster/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Haritaya ekle
            addIndexLayerToMap(data, indexType, indexName);
            const clipMsg = data.clipped ? ' (AOI\'ye kırpıldı)' : '';
            showToast(`${indexName} haritası oluşturuldu${clipMsg}`, 'success');
            setStatus('Hazır');
        } else {
            showToast(data.detail || 'Harita oluşturma hatası', 'error');
            setStatus('Hata');
        }
    } catch (err) {
        console.error('Create map error:', err);
        showToast('Harita oluşturma hatası', 'error');
        setStatus('Hata');
    } finally {
        hideLoading();
    }
}

function addIndexLayerToMap(data, indexType, indexName) {
    // Mevcut katmanı kaldır (aynı indeks için)
    if (state.indexLayers && state.indexLayers[indexType]) {
        map.removeLayer(state.indexLayers[indexType]);
    }

    // Yeni katman ekle
    const bounds = [
        [data.bounds.minLat, data.bounds.minLon],
        [data.bounds.maxLat, data.bounds.maxLon]
    ];

    const layer = L.imageOverlay(data.web_path + '?t=' + Date.now(), bounds, {
        opacity: state.layerOpacity,
        interactive: true
    });

    layer.addTo(map);
    state.indexLayers[indexType] = layer;

    // Layer controls güncelle
    updateLayerControls();

    // Haritayı bounds'a fit et
    map.fitBounds(bounds, { padding: [20, 20] });
}

// İndeks ikon ve isim bilgileri
const INDEX_INFO = {
    ndvi: { icon: '🌿', name: 'NDVI', color: '#22c55e' },
    ndwi: { icon: '💧', name: 'NDWI', color: '#3b82f6' },
    evi: { icon: '🌳', name: 'EVI', color: '#16a34a' },
    savi: { icon: '🏜️', name: 'SAVI', color: '#ca8a04' },
    nbr: { icon: '🔥', name: 'NBR', color: '#ef4444' }
};

function updateLayerControls() {
    const container = document.getElementById('active-layers-container');
    const layersList = document.getElementById('layers-list');
    const emptyState = document.getElementById('empty-layers');

    if (!container || !layersList) return;

    const layers = Object.keys(state.indexLayers || {});

    if (layers.length === 0) {
        container.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    // Katmanlar var, container'ı göster
    container.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';

    // Mevcut listeyi temizle ve yeniden oluştur
    layersList.innerHTML = '';

    layers.forEach(indexType => {
        const layer = state.indexLayers[indexType];
        const info = INDEX_INFO[indexType] || { icon: '📊', name: indexType.toUpperCase() };
        const isVisible = map.hasLayer(layer);

        const layerItem = document.createElement('div');
        layerItem.className = 'layer-item';
        layerItem.dataset.indexType = indexType;

        layerItem.innerHTML = `
            <div class="layer-item-left">
                <input type="checkbox" ${isVisible ? 'checked' : ''} data-layer="${indexType}">
                <span class="layer-item-icon">${info.icon}</span>
                <span class="layer-item-name">${info.name}</span>
            </div>
            <button class="layer-item-remove" data-layer="${indexType}" title="Katmanı kaldır">✕</button>
        `;

        layersList.appendChild(layerItem);
    });

    // Event listener'ları ekle
    setupLayerEventListeners();
}

function setupLayerEventListeners() {
    const layersList = document.getElementById('layers-list');
    if (!layersList) return;

    // Checkbox toggle
    layersList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.onchange = function () {
            const indexType = this.dataset.layer;
            const layer = state.indexLayers[indexType];
            if (!layer) return;

            if (this.checked) {
                layer.addTo(map);
            } else {
                map.removeLayer(layer);
            }
        };
    });

    // Remove buttons
    layersList.querySelectorAll('.layer-item-remove').forEach(btn => {
        btn.onclick = function () {
            const indexType = this.dataset.layer;
            removeIndexLayer(indexType);
        };
    });
}

function removeIndexLayer(indexType) {
    if (state.indexLayers[indexType]) {
        map.removeLayer(state.indexLayers[indexType]);
        delete state.indexLayers[indexType];
        updateLayerControls();
        showToast(`${INDEX_INFO[indexType]?.name || indexType} katmanı kaldırıldı`, 'info');
    }
}

// Global opacity control
function setupOpacityControl() {
    const opacitySlider = document.getElementById('layer-opacity');
    const opacityValue = document.getElementById('opacity-value');

    if (opacitySlider) {
        opacitySlider.oninput = function () {
            const opacity = this.value / 100;
            state.layerOpacity = opacity;
            if (opacityValue) opacityValue.textContent = this.value;

            // Tüm katmanlara uygula
            Object.values(state.indexLayers).forEach(layer => {
                layer.setOpacity(opacity);
            });
        };
    }
}

// Setup create map button and opacity
document.addEventListener('DOMContentLoaded', function () {
    const btnCreateMap = document.getElementById('btn-create-map');
    if (btnCreateMap) {
        btnCreateMap.onclick = createIndexMap;
    }
    setupOpacityControl();
});

function drawHistogram(histogramData) {
    const canvas = document.getElementById('histogram-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 10;

    // Clear canvas
    ctx.fillStyle = '#0d1210';
    ctx.fillRect(0, 0, width, height);

    const counts = histogramData.counts;
    const maxCount = Math.max(...counts);
    const barWidth = (width - padding * 2) / counts.length;

    // Draw bars
    counts.forEach((count, i) => {
        const barHeight = (count / maxCount) * (height - padding * 2);
        const x = padding + i * barWidth;
        const y = height - padding - barHeight;

        // Color based on NDVI value (-1 to 1)
        const ndviValue = -1 + (i / counts.length) * 2;
        ctx.fillStyle = getNDVIColor(ndviValue);
        ctx.fillRect(x, y, barWidth - 1, barHeight);
    });

    // Draw axis labels
    ctx.fillStyle = '#8fa89d';
    ctx.font = '10px Outfit';
    ctx.textAlign = 'center';
    ctx.fillText('-1', padding, height - 2);
    ctx.fillText('0', width / 2, height - 2);
    ctx.fillText('1', width - padding, height - 2);
}

function getNDVIColor(value) {
    if (value < 0) return '#1e3a5f';
    if (value < 0.2) return '#a67c52';
    if (value < 0.4) return '#c4b454';
    if (value < 0.6) return '#7cb342';
    return '#2e7d32';
}

function displayClassification(classification) {
    const classList = document.getElementById('class-list');
    if (!classList) return;

    classList.innerHTML = '';

    Object.entries(classification).forEach(([key, classData]) => {
        const classItem = document.createElement('div');
        classItem.className = 'class-item';
        classItem.innerHTML = `
            <div class="class-header">
                <span class="class-name">
                    <span class="class-color" style="background: ${classData.color}"></span>
                    ${classData.label}
                </span>
                <span class="class-percent">${classData.percentage.toFixed(1)}%</span>
            </div>
            <div class="class-bar">
                <div class="class-bar-fill" style="width: ${classData.percentage}%; background: ${classData.color}"></div>
            </div>
        `;
        classList.appendChild(classItem);
    });
}

// ============================================
// Sidebar Toggle Functions
// ============================================
function initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const openBtn = document.getElementById('sidebar-open');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            const isCollapsed = sidebar.getAttribute('data-collapsed') === 'true';
            sidebar.setAttribute('data-collapsed', !isCollapsed);
            updatePanelOpenButtons();
        });
    }

    if (openBtn && sidebar) {
        openBtn.addEventListener('click', () => {
            sidebar.setAttribute('data-collapsed', 'false');
            updatePanelOpenButtons();
        });
    }
}

function updatePanelOpenButtons() {
    const sidebar = document.getElementById('sidebar');
    const chatPanel = document.getElementById('ai-chat-panel');
    const sidebarOpen = document.getElementById('sidebar-open');
    const chatOpen = document.getElementById('chat-open');

    if (sidebarOpen) {
        sidebarOpen.style.display = sidebar?.getAttribute('data-collapsed') === 'true' ? 'flex' : 'none';
    }
    if (chatOpen) {
        chatOpen.style.display = chatPanel?.getAttribute('data-collapsed') === 'true' ? 'flex' : 'none';
    }

    // Haritayı yeniden boyutlandır (panel değişikliklerinden sonra)
    setTimeout(() => {
        try {
            // Map element'ini bul ve Leaflet instance'ını al
            const mapEl = document.getElementById('map');
            if (mapEl && mapEl._leaflet_map) {
                mapEl._leaflet_map.invalidateSize();
            }
        } catch (e) {
            console.log('[CHAT] Map resize skipped:', e.message);
        }
    }, 350); // CSS transition süresinden sonra
}

// ============================================
// AI Chat Panel Functions
// ============================================
function initAIChat() {
    const chatToggle = document.getElementById('chat-toggle');
    const chatPanel = document.getElementById('ai-chat-panel');
    const chatOpenBtn = document.getElementById('chat-open');
    const sendBtn = document.getElementById('send-message');
    const chatInput = document.getElementById('chat-input');
    const saveApiKeyBtn = document.getElementById('save-api-key');
    const apiKeyInput = document.getElementById('gemini-api-key');
    const providerSelect = document.getElementById('ai-provider');

    // Chat panel toggle
    if (chatToggle && chatPanel) {
        chatToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isCollapsed = chatPanel.getAttribute('data-collapsed') === 'true';
            chatPanel.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
            console.log('[CHAT] Panel toggled:', !isCollapsed);
            updatePanelOpenButtons();
        });
    } else {
        console.error('[CHAT] Toggle button or panel not found!', { chatToggle, chatPanel });
    }

    // Chat panel open button (when collapsed)
    if (chatOpenBtn && chatPanel) {
        chatOpenBtn.addEventListener('click', () => {
            chatPanel.setAttribute('data-collapsed', 'false');
            updatePanelOpenButtons();
        });
    }

    // Settings toggle (collapsible)
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsWrapper = document.querySelector('.chat-settings-wrapper');
    if (settingsToggle && settingsWrapper) {
        settingsToggle.addEventListener('click', () => {
            settingsWrapper.classList.toggle('expanded');
        });
    }

    // Send message on button click
    if (sendBtn) {
        sendBtn.addEventListener('click', sendChatMessage);
    }

    // Send message on Enter (but Shift+Enter for new line) + Auto-resize textarea
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });

        // Character counter
        const charCount = document.getElementById('char-count');
        chatInput.addEventListener('input', () => {
            if (charCount) {
                charCount.textContent = chatInput.value.length;
            }
            // Auto-resize
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
        });
    }

    // Save API key
    if (saveApiKeyBtn && apiKeyInput) {
        // Load saved key
        if (state.geminiApiKey) {
            apiKeyInput.value = state.geminiApiKey;
        }

        saveApiKeyBtn.addEventListener('click', () => {
            const key = apiKeyInput.value.trim();
            if (key) {
                state.geminiApiKey = key;
                localStorage.setItem('gemini_api_key', key);
                showToast('API key kaydedildi', 'success');
            }
        });
    }

    // Provider change - hide/show API key field
    if (providerSelect) {
        const apiKeyGroup = document.getElementById('api-key-group');

        // Initial state - hide if Ollama
        if (providerSelect.value === 'ollama' && apiKeyGroup) {
            apiKeyGroup.style.display = 'none';
        }

        providerSelect.addEventListener('change', (e) => {
            state.aiProvider = e.target.value;
            // Hide API key for Ollama, show for Gemini
            if (apiKeyGroup) {
                apiKeyGroup.style.display = e.target.value === 'ollama' ? 'none' : 'block';
            }
        });
    }
}

async function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput?.value.trim();

    if (!message || state.isChatLoading) return;

    // Check API key for Gemini
    if (state.aiProvider === 'gemini' && !state.geminiApiKey) {
        showToast('Lütfen Gemini API key girin', 'warning');
        return;
    }

    // Add user message to UI
    addChatMessage('user', message);
    chatInput.value = '';

    // Build context from terrain data
    const includeContext = document.getElementById('include-context')?.checked;
    const context = includeContext ? buildTerrainContext() : null;

    // Show loading
    state.isChatLoading = true;
    const loadingMsg = addChatMessage('ai', 'Düşünüyorum...', true);

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                provider: state.aiProvider,
                api_key: state.geminiApiKey,
                context: context,
                history: state.chatMessages.slice(-10) // Son 10 mesaj
            })
        });

        const data = await response.json();

        // Remove loading message
        loadingMsg.remove();

        if (response.ok && data.success) {
            addChatMessage('ai', data.response);
        } else {
            addChatMessage('ai', `Hata: ${data.detail || 'Bir şeyler yanlış gitti'}`);
        }
    } catch (err) {
        loadingMsg.remove();
        addChatMessage('ai', 'Bağlantı hatası. Lütfen tekrar deneyin.');
        console.error('Chat error:', err);
    } finally {
        state.isChatLoading = false;
    }
}

function addChatMessage(role, content, isLoading = false) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return null;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}${isLoading ? ' loading' : ''}`;

    // Premium message structure with avatar
    const avatarSvg = role === 'ai'
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
             <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
           </svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
             <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
           </svg>`;

    messageDiv.innerHTML = `
        <div class="message-avatar">${avatarSvg}</div>
        <div class="message-bubble">${isLoading ? '' : escapeHtml(content)}</div>
    `;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Update status
    updateChatStatus(isLoading ? 'Düşünüyor...' : 'Hazır');

    // Save to state (except loading messages)
    if (!isLoading) {
        state.chatMessages.push({ role, content });
    }

    return messageDiv;
}

function updateChatStatus(text, isOnline = true) {
    const statusText = document.querySelector('.status-text');
    const statusDot = document.querySelector('.status-dot');
    if (statusText) statusText.textContent = text;
    if (statusDot) {
        statusDot.style.background = isOnline ? 'var(--accent-primary)' : 'var(--text-muted)';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
}

function buildTerrainContext() {
    const indexSelect = document.getElementById('index-select');
    const currentIndex = indexSelect?.value || 'ndvi';

    let context = `=== AskTheEarth Arazi Verisi ===\n`;
    context += `Aktif indeks: ${currentIndex.toUpperCase()}\n`;

    // Mevcut indeksin istatistiklerini ekle
    const cachedStats = state.statsCache[currentIndex];
    if (cachedStats?.statistics) {
        const stats = cachedStats.statistics;
        context += `\n📊 ${currentIndex.toUpperCase()} İstatistikleri:\n`;
        context += `  • Minimum: ${stats.min?.toFixed(4) || 'N/A'}\n`;
        context += `  • Maksimum: ${stats.max?.toFixed(4) || 'N/A'}\n`;
        context += `  • Ortalama: ${stats.mean?.toFixed(4) || 'N/A'}\n`;
        context += `  • Medyan: ${stats.median?.toFixed(4) || 'N/A'}\n`;
        context += `  • Standart Sapma: ${stats.std?.toFixed(4) || 'N/A'}\n`;
    }

    if (cachedStats?.classification) {
        context += `\n🗺️ Arazi Sınıflandırması:\n`;
        Object.entries(cachedStats.classification).forEach(([key, data]) => {
            const bar = '█'.repeat(Math.round(data.percentage / 5));
            context += `  • ${data.label}: ${data.percentage?.toFixed(1)}% ${bar}\n`;
        });
    }

    // Diğer hesaplanmış indeksleri de ekle
    const otherIndices = Object.keys(state.statsCache).filter(k => k !== currentIndex);
    if (otherIndices.length > 0) {
        context += `\n📈 Diğer hesaplanmış indeksler:\n`;
        otherIndices.forEach(idx => {
            const otherStats = state.statsCache[idx]?.statistics;
            if (otherStats) {
                context += `  • ${idx.toUpperCase()}: Ort=${otherStats.mean?.toFixed(3) || 'N/A'}, Min=${otherStats.min?.toFixed(3) || 'N/A'}, Max=${otherStats.max?.toFixed(3) || 'N/A'}\n`;
            }
        });
    }

    // Alan bilgisi
    if (state.aoiGeometry) {
        context += `\n📍 Seçili alan mevcut (kullanıcı haritada bir bölge belirlemiş)\n`;
    }

    if (state.drawnBounds) {
        const bounds = state.drawnBounds;
        context += `  Koordinatlar: ${bounds.getSouth().toFixed(4)}°N - ${bounds.getNorth().toFixed(4)}°N, ${bounds.getWest().toFixed(4)}°E - ${bounds.getEast().toFixed(4)}°E\n`;
    }

    // Eğer hiç veri yoksa uyar
    if (!cachedStats && Object.keys(state.statsCache).length === 0) {
        context += `\n⚠️ Henüz hesaplanmış indeks verisi yok. Kullanıcıya önce haritada alan seçip indeks hesaplamasını öner.\n`;
    }

    console.log('[CHAT] Context oluşturuldu:', context);
    return context;
}

// Initialize sidebar and chat when page loads
document.addEventListener('DOMContentLoaded', () => {
    initSidebarToggle();
    initAIChat();
});

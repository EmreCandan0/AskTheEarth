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
    marker: null,
    geojsonLayer: null,
    drawnLayer: null,
    drawnBounds: null,
    isDrawing: false,
    drawHandler: null
};

// ============================================
// Map Initialization
// ============================================
const map = L.map('map', {
    center: [40.8, 29.5],
    zoom: 8,
    zoomControl: true
});

// Dark tile layer
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
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
    
    // Clear previous drawings
    drawnItems.clearLayers();
    if (state.geojsonLayer) {
        map.removeLayer(state.geojsonLayer);
        state.geojsonLayer = null;
    }
    
    drawnItems.addLayer(layer);
    state.drawnLayer = layer;
    state.drawnBounds = layer.getBounds();
    
    // Update UI
    const nw = state.drawnBounds.getNorthWest();
    const se = state.drawnBounds.getSouthEast();
    
    const coordNW = document.getElementById('coord-nw');
    const coordSE = document.getElementById('coord-se');
    const drawnAreaInfo = document.getElementById('drawn-area-info');
    const btnClearDraw = document.getElementById('btn-clear-draw');
    const btnStartDraw = document.getElementById('btn-start-draw');
    const fileInfo = document.getElementById('file-info');
    const existingGeojson = document.getElementById('existing-geojson');
    
    if (coordNW) coordNW.textContent = `${nw.lat.toFixed(4)}, ${nw.lng.toFixed(4)}`;
    if (coordSE) coordSE.textContent = `${se.lat.toFixed(4)}, ${se.lng.toFixed(4)}`;
    if (drawnAreaInfo) drawnAreaInfo.style.display = 'block';
    if (btnClearDraw) btnClearDraw.style.display = 'flex';
    if (btnStartDraw) {
        btnStartDraw.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18M9 21V9"/>
            </svg>
            Yeniden Ciz
        `;
    }
    
    // Generate and save GeoJSON
    const geojson = boundsToGeoJSON(state.drawnBounds);
    
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
// Start Drawing Function
// ============================================
window.startDrawing = function() {
    console.log('startDrawing called!');
    
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
        
        // Create and enable new rectangle draw handler
        state.drawHandler = new L.Draw.Rectangle(map, rectangleDrawOptions);
        state.drawHandler.enable();
        
        showToast('Haritada dikdortgen cizin', 'info');
        setStatus('Cizim modu aktif...');
    } catch (error) {
        console.error('startDrawing error:', error);
        showToast('Hata: ' + error.message, 'error');
    }
};

// ============================================
// Clear Drawing Function
// ============================================
window.clearDrawing = function() {
    console.log('Clearing drawing...');
    
    drawnItems.clearLayers();
    state.drawnLayer = null;
    state.drawnBounds = null;
    state.selectedFileName = null;
    
    const drawnAreaInfo = document.getElementById('drawn-area-info');
    const btnClearDraw = document.getElementById('btn-clear-draw');
    const btnStartDraw = document.getElementById('btn-start-draw');
    
    if (drawnAreaInfo) drawnAreaInfo.style.display = 'none';
    if (btnClearDraw) btnClearDraw.style.display = 'none';
    if (btnStartDraw) {
        btnStartDraw.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18M9 21V9"/>
            </svg>
            Dikdortgen Ciz
        `;
    }
    
    setStatus('Hazir');
    showToast('Alan temizlendi', 'info');
};

// ============================================
// Toggle Upload Section
// ============================================
window.toggleUploadSection = function() {
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
};

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
    
    try {
        const response = await fetch('/download/sentinel2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            state.bandFolder = data.band_folder;
            state.bandFolders = data.band_folders || [data.band_folder];
            
            const tileCount = data.tiles ? data.tiles.length : 1;
            const tileNames = data.tiles ? data.tiles.join(', ') : '';
            
            showToast(`${tileCount} tile indirildi: ${tileNames}`, 'success');
            setStatus(`${tileCount} tile hazir`);
        } else {
            showToast(data.detail || 'Indirme hatasi', 'error');
            setStatus('Hata');
        }
    } catch (err) {
        showToast('Baglanti hatasi', 'error');
        setStatus('Baglanti hatasi');
    } finally {
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
async function calculateNDVI() {
    const latInput = document.getElementById('lat');
    const lonInput = document.getElementById('lon');
    
    const lat = latInput ? parseFloat(latInput.value) : NaN;
    const lon = lonInput ? parseFloat(lonInput.value) : NaN;
    
    if (isNaN(lat) || isNaN(lon)) {
        showToast('Koordinat girin veya haritada bir nokta secin', 'warning');
        return;
    }
    
    showLoading('NDVI hesaplaniyor...');
    setStatus('NDVI hesaplaniyor...');
    
    try {
        const response = await fetch('/ndvi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lat: lat,
                lon: lon,
                band_folder: state.bandFolder
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            displayNDVIResult(data);
            showToast('NDVI hesaplandi', 'success');
            setStatus('NDVI hesaplandi');
        } else {
            showToast(data.detail || 'NDVI hesaplama hatasi', 'error');
            setStatus('Hata');
        }
    } catch (err) {
        showToast('Baglanti hatasi', 'error');
        setStatus('Baglanti hatasi');
    } finally {
        hideLoading();
    }
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
    
    // Draw button
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
    
    // NDVI button
    const btnNdvi = document.getElementById('btn-ndvi');
    if (btnNdvi) {
        btnNdvi.addEventListener('click', (e) => {
            e.preventDefault();
            calculateNDVI();
        });
    }
    
    setStatus('Hazir');
    console.log('AskTheEarth initialized successfully');
});

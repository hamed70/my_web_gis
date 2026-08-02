(function () {
    'use strict';

    // ===== Constants =====
    const STORAGE_KEY = 'webgis_markers';
    const DEFAULT_CENTER = [0, 20];
    const DEFAULT_ZOOM = 2;
    const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
    const SOURCE_ID = 'markers-source';
    const LAYER_ID = 'markers-layer';

    // ===== State =====
    let markers = [];          // Array of marker data objects
    let activePopup = null;    // Currently open popup
    let map = null;
    let geoMarkerSource = null; // Geolocation marker source

    // ===== Initialize =====
    function init() {
        initMap();
        loadFromStorage();
        bindEvents();
    }

    // ===== Map Initialization =====
    function initMap() {
        map = new maplibregl.Map({
            container: 'map',
            style: MAP_STYLE,
            center: DEFAULT_CENTER,
            zoom: DEFAULT_ZOOM,
            attributionControl: true
        });

        map.addControl(new maplibregl.NavigationControl(), 'top-right');
        map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

        // Track mouse coordinates
        map.on('mousemove', function (e) {
            document.getElementById('coord-lat').textContent = e.lngLat.lat.toFixed(6);
            document.getElementById('coord-lng').textContent = e.lngLat.lng.toFixed(6);
        });

        // Click to add marker
        map.on('click', function (e) {
            addMarker(e.lngLat.lng, e.lngLat.lat);
        });

        // Initialize source and layer when map loads
        map.on('load', function() {
            // Source for markers
            map.addSource(SOURCE_ID, {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });

            // Circle layer for markers
            map.addLayer({
                id: LAYER_ID,
                type: 'circle',
                source: SOURCE_ID,
                paint: {
                    'circle-radius': 8,
                    'circle-color': '#FF6B35',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#FFFFFF',
                    'circle-opacity': 0.9
                }
            });

            // Add hover effect
            map.on('mouseenter', LAYER_ID, function() {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', LAYER_ID, function() {
                map.getCanvas().style.cursor = '';
            });

            // Click on circle to open popup
            map.on('click', LAYER_ID, function(e) {
                if (e.features && e.features.length > 0) {
                    var feature = e.features[0];
                    if (feature.properties && feature.properties.id) {
                        openPopup(feature.properties.id);
                    }
                }
            });

            // Load existing markers after source is ready
            if (markers.length > 0) {
                updateMapMarkers();
                renderMarkerList();
            }
        });
    }

    // ===== Event Bindings =====
    function bindEvents() {
        document.getElementById('btn-geolocate').addEventListener('click', handleGeolocate);
        document.getElementById('btn-export').addEventListener('click', handleExport);
        document.getElementById('btn-import').addEventListener('change', handleImport);
        document.getElementById('btn-clear-all').addEventListener('click', handleClearAll);
    }

    // ===== Marker Management =====
    function generateId() {
        return 'mk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    function addMarker(lng, lat, properties) {
        var id = (properties && properties.id) || generateId();
        var now = new Date();
        var data = {
            id: id,
            lng: lng,
            lat: lat,
            notes: (properties && properties.notes) || '',
            createdAt: (properties && properties.createdAt) || now.toISOString(),
            createdAtDisplay: (properties && properties.createdAtDisplay) || formatDate(now)
        };

        // Avoid duplicate IDs on import
        var existingIndex = markers.findIndex(function (m) { return m.id === id; });
        if (existingIndex > -1) {
            markers[existingIndex] = data;
        } else {
            markers.push(data);
        }

        updateMapMarkers();
        saveToStorage();
        renderMarkerList();
        showToast('نقطه اضافه شد!', 'success');
    }

    function updateMapMarkers() {
        if (!map || !map.getSource(SOURCE_ID)) return;

        var features = markers.map(function(m) {
            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [m.lng, m.lat]
                },
                properties: {
                    id: m.id,
                    notes: m.notes,
                    createdAt: m.createdAt,
                    createdAtDisplay: m.createdAtDisplay
                }
            };
        });

        map.getSource(SOURCE_ID).setData({
            type: 'FeatureCollection',
            features: features
        });
    }

    function deleteMarker(id) {
        markers = markers.filter(function (m) { return m.id !== id; });
        updateMapMarkers();
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }
        saveToStorage();
        renderMarkerList();
        showToast('نقطه حذف شد', 'error');
    }

    function updateMarkerNotes(id, notes) {
        var marker = markers.find(function (m) { return m.id === id; });
        if (marker) {
            marker.notes = notes;
            updateMapMarkers();
            saveToStorage();
            renderMarkerList();
            showToast('یادداشت ذخیره شد!', 'success');
        }
    }

    // ===== Popup =====
    function openPopup(id) {
        var data = markers.find(function (m) { return m.id === id; });
        if (!data) return;

        // Close any open popup
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }

        // Build popup HTML
        var html = '<div class="popup-content">' +
            '<div class="popup-header">' +
            '<strong class="popup-title">📍 نقطه</strong>' +
            '<button class="popup-delete-btn" data-id="' + data.id + '" title="Delete marker">✕</button>' +
            '</div>' +
            '<div class="popup-date">🕐 ' + data.createdAtDisplay + '</div>' +
            '<div class="popup-coords">📐 ' + data.lat.toFixed(6) + ', ' + data.lng.toFixed(6) + '</div>' +
            '<textarea class="popup-notes" data-id="' + data.id + '" placeholder="یادداشت خود را بنویسید..." rows="4">' +
            escapeHtml(data.notes) +
            '</textarea>' +
            '<button class="popup-save-btn btn btn-primary btn-sm" data-id="' + data.id + '">ذخیره یادداشت</button>' +
            '</div>';

        var popup = new maplibregl.Popup({
            closeOnClick: false,
            closeButton: true,
            maxWidth: '300px',
            offset: 25
        })
            .setLngLat([data.lng, data.lat])
            .setHTML(html)
            .addTo(map);

        activePopup = popup;

        // After DOM is ready, attach event listeners
        setTimeout(function () {
            var popupEl = popup.getElement();
            if (!popupEl) return;

            var deleteBtn = popupEl.querySelector('.popup-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var markerId = this.getAttribute('data-id');
                    if (confirm('آیا این نقطه حذف شود؟')) {
                        deleteMarker(markerId);
                    }
                });
            }

            var saveBtn = popupEl.querySelector('.popup-save-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var markerId = this.getAttribute('data-id');
                    var textarea = popupEl.querySelector('.popup-notes');
                    if (textarea) {
                        updateMarkerNotes(markerId, textarea.value);
                    }
                });
            }

            // Save on Enter (Ctrl+Enter to allow newlines)
            var textarea = popupEl.querySelector('.popup-notes');
            if (textarea) {
                textarea.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        var markerId = this.getAttribute('data-id');
                        updateMarkerNotes(markerId, this.value);
                    }
                });
                // Prevent map click when clicking textarea
                textarea.addEventListener('click', function (e) {
                    e.stopPropagation();
                });
            }
        }, 50);

        // Fly to marker
        map.flyTo({
            center: [data.lng, data.lat],
            zoom: Math.max(map.getZoom(), 8),
            duration: 800
        });
    }

    // ===== Sidebar Marker List =====
    function renderMarkerList() {
        var container = document.getElementById('marker-list');
        var countEl = document.getElementById('marker-count');

        countEl.textContent = markers.length;

        if (markers.length === 0) {
            container.innerHTML = '<p class="empty-message">هنوز نقطه‌ای ثبت نشده. روی نقشه کلیک کنید تا یک نقطه اضافه کنید!</p>';
            return;
        }

        // Sort by newest first
        var sorted = markers.slice().sort(function (a, b) {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        var html = '';
        sorted.forEach(function (m) {
            var notesPreview = m.notes ? escapeHtml(m.notes) : 'بدون یادداشت';
            var notesClass = m.notes ? 'item-notes' : 'item-notes empty';

            html += '<div class="marker-list-item" data-id="' + m.id + '">' +
                '<div class="item-header">' +
                '<span class="item-id">📍 ' + m.id.substring(0, 12) + '…</span>' +
                '<span class="item-date">' + m.createdAtDisplay + '</span>' +
                '</div>' +
                '<div class="item-coords">' + m.lat.toFixed(4) + ', ' + m.lng.toFixed(4) + '</div>' +
                '<div class="' + notesClass + '">' + notesPreview + '</div>' +
                '</div>';
        });

        container.innerHTML = html;

        // Attach click events to list items
        var items = container.querySelectorAll('.marker-list-item');
        items.forEach(function (item) {
            item.addEventListener('click', function () {
                var id = this.getAttribute('data-id');
                openPopup(id);
            });
        });
    }

    // ===== Local Storage =====
    function saveToStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
        } catch (e) {
            console.error('Failed to save to localStorage:', e);
            showToast('ذخیره داده با خطا مواجه شد', 'error');
        }
    }

    function loadFromStorage() {
        try {
            var data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                var parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    markers = parsed;
                    if (map && map.getSource(SOURCE_ID)) {
                        updateMapMarkers();
                    }
                    renderMarkerList();
                    if (markers.length > 0) {
                        showToast(markers.length + ' نقطه بارگذاری شد', 'success');
                    }
                }
            } else {
                renderMarkerList();
            }
        } catch (e) {
            console.error('Failed to load from localStorage:', e);
            renderMarkerList();
        }
    }

    // ===== Geolocation =====
    function handleGeolocate() {
        if (!navigator.geolocation) {
            showToast('مرورگر شما از موقعیت‌یابی پشتیبانی نمی‌کند', 'error');
            return;
        }

        showToast('در حال یافتن موقعیت شما…', 'success');

        navigator.geolocation.getCurrentPosition(
            function (position) {
                var lng = position.coords.longitude;
                var lat = position.coords.latitude;
                var accuracy = position.coords.accuracy;

                // Add geolocation point to map
                if (!map.getSource('geolocation-source')) {
                    map.addSource('geolocation-source', {
                        type: 'geojson',
                        data: {
                            type: 'FeatureCollection',
                            features: []
                        }
                    });

                    map.addLayer({
                        id: 'geolocation-layer',
                        type: 'circle',
                        source: 'geolocation-source',
                        paint: {
                            'circle-radius': 12,
                            'circle-color': '#00AAFF',
                            'circle-stroke-width': 3,
                            'circle-stroke-color': '#FFFFFF',
                            'circle-opacity': 0.8
                        }
                    });

                    // Add pulsing effect with second layer
                    map.addLayer({
                        id: 'geolocation-pulse',
                        type: 'circle',
                        source: 'geolocation-source',
                        paint: {
                            'circle-radius': 20,
                            'circle-color': '#00AAFF',
                            'circle-opacity': 0.3,
                            'circle-stroke-width': 0
                        }
                    });
                }

                var geoData = {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [lng, lat]
                        },
                        properties: {
                            accuracy: accuracy
                        }
                    }]
                };

                map.getSource('geolocation-source').setData(geoData);

                // Fly to location
                map.flyTo({
                    center: [lng, lat],
                    zoom: 15,
                    duration: 2000
                });

                showToast('موقعیت یافت شد! دقت: ' + Math.round(accuracy) + ' متر', 'success');

                // Animate pulse
                var pulseLayer = map.getLayer('geolocation-pulse');
                if (pulseLayer) {
                    var pulseRadius = 12;
                    var pulseOpacity = 0.8;
                    var growing = true;

                    function animatePulse() {
                        if (growing) {
                            pulseRadius += 0.5;
                            pulseOpacity -= 0.02;
                            if (pulseRadius >= 28) {
                                growing = false;
                            }
                        } else {
                            pulseRadius -= 0.5;
                            pulseOpacity += 0.02;
                            if (pulseRadius <= 12) {
                                growing = true;
                            }
                        }

                        map.setPaintProperty('geolocation-pulse', 'circle-radius', pulseRadius);
                        map.setPaintProperty('geolocation-pulse', 'circle-opacity', Math.max(0, Math.min(0.8, pulseOpacity)));

                        if (map.getSource('geolocation-source')) {
                            requestAnimationFrame(animatePulse);
                        }
                    }

                    animatePulse();
                }
            },
            function (error) {
                var messages = {
                    1: 'دسترسی به موقعیت رد شد',
                    2: 'موقعیت در دسترس نیست',
                    3: 'درخواست موقعیت زمان‌بر شد'
                };
                showToast(messages[error.code] || 'موقعیت یافت نشد', 'error');
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000
            }
        );
    }

    // ===== Export GeoJSON =====
    function handleExport() {
        if (markers.length === 0) {
            showToast('نقطه‌ای برای خروجی وجود ندارد', 'error');
            return;
        }

        var geojson = {
            type: 'FeatureCollection',
            features: markers.map(function (m) {
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [m.lng, m.lat]
                    },
                    properties: {
                        id: m.id,
                        notes: m.notes,
                        createdAt: m.createdAt,
                        createdAtDisplay: m.createdAtDisplay
                    }
                };
            })
        };

        var dataStr = JSON.stringify(geojson, null, 2);
        var blob = new Blob([dataStr], { type: 'application/geo+json' });
        var url = URL.createObjectURL(blob);

        var link = document.createElement('a');
        link.href = url;
        link.download = 'field_notes_' + new Date().toISOString().slice(0, 10) + '.geojson';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(markers.length + ' نقطه به صورت GeoJSON خروجی گرفته شد', 'success');
    }

    // ===== Import GeoJSON =====
    function handleImport(event) {
        var file = event.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var geojson = JSON.parse(e.target.result);

                if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
                    showToast('GeoJSON نامعتبر: باید FeatureCollection باشد', 'error');
                    return;
                }

                var importedCount = 0;
                var skippedCount = 0;

                geojson.features.forEach(function (feature) {
                    if (
                        feature.type === 'Feature' &&
                        feature.geometry &&
                        feature.geometry.type === 'Point' &&
                        Array.isArray(feature.geometry.coordinates) &&
                        feature.geometry.coordinates.length >= 2
                    ) {
                        var coords = feature.geometry.coordinates;
                        var props = feature.properties || {};

                        addMarker(coords[0], coords[1], {
                            id: props.id || generateId(),
                            notes: props.notes || '',
                            createdAt: props.createdAt || new Date().toISOString(),
                            createdAtDisplay: props.createdAtDisplay || formatDate(new Date(props.createdAt || Date.now()))
                        });
                        importedCount++;
                    } else {
                        skippedCount++;
                    }
                });

                var msg = importedCount + ' نقطه وارد شد';
                if (skippedCount > 0) {
                    msg += ' (' + skippedCount + ' غیرنقطه نادیده گرفته شد)';
                }
                showToast(msg, 'success');

                // Fit map to imported markers if any
                if (importedCount > 0 && markers.length > 0) {
                    fitMapToMarkers();
                }
            } catch (err) {
                console.error('Import error:', err);
                showToast('خطا در خواندن فایل GeoJSON', 'error');
            }
        };

        reader.readAsText(file);

        // Reset file input so the same file can be imported again
        event.target.value = '';
    }

    // ===== Clear All =====
    function handleClearAll() {
        if (markers.length === 0) {
            showToast('نقطه‌ای برای پاک کردن وجود ندارد', 'error');
            return;
        }

        if (!confirm('آیا از حذف همه ' + markers.length + ' نقطه مطمئنید؟ این عمل قابل بازگشت نیست.')) {
            return;
        }

        markers = [];
        updateMapMarkers();
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }
        saveToStorage();
        renderMarkerList();
        showToast('همه نقاط پاک شدند', 'error');
    }

    // ===== Fit Map to Markers =====
    function fitMapToMarkers() {
        if (markers.length === 0) return;

        if (markers.length === 1) {
            map.flyTo({
                center: [markers[0].lng, markers[0].lat],
                zoom: 10,
                duration: 1500
            });
            return;
        }

        var bounds = new maplibregl.LngLatBounds();
        markers.forEach(function (m) {
            bounds.extend([m.lng, m.lat]);
        });

        map.fitBounds(bounds, {
            padding: 80,
            duration: 1500,
            maxZoom: 16
        });
    }

    // ===== Utility Functions =====
    function formatDate(date) {
        var d = new Date(date);
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        var hours = String(d.getHours()).padStart(2, '0');
        var minutes = String(d.getMinutes()).padStart(2, '0');
        var seconds = String(d.getSeconds()).padStart(2, '0');
        return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showToast(message, type) {
        // Remove existing toasts
        var existing = document.querySelectorAll('.toast');
        existing.forEach(function (t) { t.remove(); });

        var toast = document.createElement('div');
        toast.className = 'toast ' + (type || '');
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(function () {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 3000);
    }

    // ===== Start Application =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

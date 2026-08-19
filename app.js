(function () {
    'use strict';

    // ===== Constants =====
    var STORAGE_KEY_MARKERS = 'webgis_markers';
    var STORAGE_KEY_LAYERS = 'webgis_layers';
    var STORAGE_KEY_ACTIVE_LAYER = 'webgis_active_layer';

    // Default view: Mashhad, Iran
    var DEFAULT_CENTER = [59.6042, 36.2972];
    var DEFAULT_ZOOM = 12;

    var MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
    var SOURCE_ID = 'markers-source';
    var LAYER_ID = 'markers-layer';

    var FALLBACK_COLOR = '#8fa3ac';
    var LAYER_PALETTE = ['#e2a13d', '#4fb0c6', '#5fa88f', '#c76b98', '#8f7fe8', '#e2584f', '#79c26f', '#cf9a4c'];

    var DEFAULT_LAYERS = [
        { id: 'personal', name: 'شخصی', color: '#e2a13d', visible: true },
        { id: 'friends', name: 'دوستان', color: '#4fb0c6', visible: true }
    ];

    var CITIES = [
        { name: 'مشهد', center: [59.6042, 36.2972], zoom: 12 },
        { name: 'تهران', center: [51.3890, 35.6892], zoom: 11 },
        { name: 'شیراز', center: [52.5311, 29.5918], zoom: 12 },
        { name: 'نیویورک', center: [-74.0060, 40.7128], zoom: 11 },
        { name: 'شیکاگو', center: [-87.6298, 41.8781], zoom: 11 }
    ];

    var MOBILE_BREAKPOINT = 768;

    // ===== State =====
    var markers = [];          // Array of marker data objects
    var layers = [];           // Array of layer definitions
    var activeLayerId = null;  // Layer used for newly created markers
    var activePopup = null;    // Currently open popup
    var map = null;

    // ===== Initialize =====
    function init() {
        loadLayers();
        loadMarkersFromStorage();
        initMap();
        bindEvents();
        renderLayers();
        renderMarkerList();
        renderCities();
    }

    function isMobileViewport() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
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

        map.addControl(new maplibregl.NavigationControl(), 'top-left');
        map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

        // Track mouse coordinates
        map.on('mousemove', function (e) {
            document.getElementById('coord-lat').textContent = e.lngLat.lat.toFixed(6);
            document.getElementById('coord-lng').textContent = e.lngLat.lng.toFixed(6);
        });

        // Click on empty map area to add a marker.
        // Fix: if the click actually landed on an existing marker feature,
        // do nothing here — the dedicated layer click handler below will
        // open that marker's popup instead of also creating a new point.
        map.on('click', function (e) {
            if (map.getLayer(LAYER_ID)) {
                var hit = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
                if (hit && hit.length > 0) {
                    return;
                }
            }
            addMarker(e.lngLat.lng, e.lngLat.lat);
        });

        // Initialize source and layer when map loads
        map.on('load', function () {
            map.addSource(SOURCE_ID, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });

            map.addLayer({
                id: LAYER_ID,
                type: 'circle',
                source: SOURCE_ID,
                paint: {
                    'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 10, 8],
                    'circle-color': FALLBACK_COLOR,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.95
                }
            });

            map.on('mouseenter', LAYER_ID, function () {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', LAYER_ID, function () {
                map.getCanvas().style.cursor = '';
            });

            // Click on a marker circle opens its popup
            map.on('click', LAYER_ID, function (e) {
                if (e.features && e.features.length > 0) {
                    var feature = e.features[0];
                    if (feature.properties && feature.properties.id) {
                        openPopup(feature.properties.id);
                    }
                }
            });

            updateLayerStyle();
            updateMapMarkers();
        });
    }

    // ===== Event Bindings =====
    function bindEvents() {
        document.getElementById('btn-geolocate').addEventListener('click', handleGeolocate);
        document.getElementById('btn-export').addEventListener('click', handleExport);
        document.getElementById('btn-import').addEventListener('change', handleImport);
        document.getElementById('btn-clear-all').addEventListener('click', handleClearAll);

        document.getElementById('btn-add-layer').addEventListener('click', function () {
            var form = document.getElementById('add-layer-form');
            form.hidden = false;
            document.getElementById('btn-add-layer').hidden = true;
            document.getElementById('new-layer-color').value = LAYER_PALETTE[layers.length % LAYER_PALETTE.length];
            document.getElementById('new-layer-name').focus();
        });

        document.getElementById('cancel-add-layer').addEventListener('click', function () {
            hideAddLayerForm();
        });

        document.getElementById('confirm-add-layer').addEventListener('click', handleAddLayer);

        document.getElementById('new-layer-name').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAddLayer();
            }
        });

        document.getElementById('btn-cities').addEventListener('click', function () {
            var panel = document.getElementById('cities-panel');
            panel.hidden = !panel.hidden;
        });

        document.getElementById('btn-share-layer').addEventListener('click', function () {
            var form = document.getElementById('share-layer-form');
            renderShareChecklist();
            form.hidden = false;
        });

        document.getElementById('cancel-share-layer').addEventListener('click', function () {
            document.getElementById('share-layer-form').hidden = true;
        });

        document.getElementById('confirm-share-layer').addEventListener('click', handleShareLayers);
    }

    function hideAddLayerForm() {
        document.getElementById('add-layer-form').hidden = true;
        document.getElementById('btn-add-layer').hidden = false;
        document.getElementById('new-layer-name').value = '';
    }

    function handleAddLayer() {
        var nameInput = document.getElementById('new-layer-name');
        var colorInput = document.getElementById('new-layer-color');
        var name = nameInput.value.trim();

        if (!name) {
            showToast('یک نام برای لایه وارد کنید', 'error');
            nameInput.focus();
            return;
        }

        var id = addLayer(name, colorInput.value);
        setActiveLayer(id);
        hideAddLayerForm();
        showToast('لایه «' + name + '» اضافه شد', 'success');
    }

    // ===== Layer Management =====
    function generateLayerId() {
        return 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    }

    function getLayerById(id) {
        return layers.find(function (l) { return l.id === id; });
    }

    function addLayer(name, color) {
        var id = generateLayerId();
        layers.push({
            id: id,
            name: name,
            color: color || LAYER_PALETTE[layers.length % LAYER_PALETTE.length],
            visible: true
        });
        saveLayers();
        updateLayerStyle();
        renderLayers();
        return id;
    }

    // Used on import: reuse an existing layer by name, or create one on the fly
    function ensureLayerExists(layerId, layerName) {
        if (layerId) {
            var existing = getLayerById(layerId);
            if (existing) return existing.id;
        }
        if (layerName) {
            var byName = layers.find(function (l) { return l.name === layerName; });
            if (byName) return byName.id;
        }
        var newId = layerId || generateLayerId();
        layers.push({
            id: newId,
            name: layerName || 'وارد شده',
            color: LAYER_PALETTE[layers.length % LAYER_PALETTE.length],
            visible: true
        });
        saveLayers();
        return newId;
    }

    function setActiveLayer(id) {
        if (!getLayerById(id)) return;
        activeLayerId = id;
        saveActiveLayer();
        renderLayers();
    }

    function toggleLayerVisibility(id) {
        var layer = getLayerById(id);
        if (!layer) return;
        layer.visible = !layer.visible;
        saveLayers();
        updateLayerStyle();
        renderLayers();
        renderMarkerList();
    }

    function deleteLayer(id) {
        if (layers.length <= 1) {
            showToast('حداقل یک لایه باید باقی بماند', 'error');
            return;
        }
        var layer = getLayerById(id);
        if (!layer) return;

        var count = markers.filter(function (m) { return m.layerId === id; }).length;
        var msg = 'لایه «' + layer.name + '» حذف شود؟';
        if (count > 0) {
            msg += ' ' + count + ' نقطه این لایه هم حذف خواهد شد.';
        }
        if (!confirm(msg)) return;

        markers = markers.filter(function (m) { return m.layerId !== id; });
        layers = layers.filter(function (l) { return l.id !== id; });

        if (activeLayerId === id) {
            activeLayerId = layers[0].id;
            saveActiveLayer();
        }

        saveLayers();
        saveMarkersToStorage();
        updateLayerStyle();
        updateMapMarkers();
        renderLayers();
        renderMarkerList();
        showToast('لایه حذف شد', 'error');
    }

    function buildColorExpression() {
        var expr = ['match', ['get', 'layerId']];
        layers.forEach(function (l) {
            expr.push(l.id, l.color);
        });
        expr.push(FALLBACK_COLOR);
        return expr;
    }

    function getVisibleLayerIds() {
        return layers.filter(function (l) { return l.visible; }).map(function (l) { return l.id; });
    }

    function updateLayerStyle() {
        if (!map || !map.getLayer(LAYER_ID)) return;
        map.setPaintProperty(LAYER_ID, 'circle-color', buildColorExpression());
        map.setFilter(LAYER_ID, ['in', ['get', 'layerId'], ['literal', getVisibleLayerIds()]]);
    }

    function renderLayers() {
        var container = document.getElementById('layers-list');
        var html = '';

        layers.forEach(function (l) {
            var count = markers.filter(function (m) { return m.layerId === l.id; }).length;
            var classes = 'layer-item';
            if (l.id === activeLayerId) classes += ' active';
            if (!l.visible) classes += ' hidden-layer';

            html += '<div class="' + classes + '" data-id="' + l.id + '" style="--layer-color:' + l.color + '">' +
                '<span class="layer-color-dot"></span>' +
                '<span class="layer-name">' + escapeHtml(l.name) + '</span>' +
                (l.id === activeLayerId ? '<span class="layer-active-tag">فعال</span>' : '') +
                '<span class="layer-count">' + count + '</span>' +
                '<button class="layer-icon-btn layer-visibility-btn" data-id="' + l.id + '" title="نمایش/عدم نمایش لایه">' + (l.visible ? '👁' : '🚫') + '</button>' +
                (layers.length > 1 ? '<button class="layer-icon-btn layer-delete-btn" data-id="' + l.id + '" title="حذف لایه">✕</button>' : '') +
                '</div>';
        });

        container.innerHTML = html;

        var items = container.querySelectorAll('.layer-item');
        items.forEach(function (item) {
            item.addEventListener('click', function (e) {
                if (e.target.closest('.layer-icon-btn')) return;
                setActiveLayer(this.getAttribute('data-id'));
            });
        });

        var visBtns = container.querySelectorAll('.layer-visibility-btn');
        visBtns.forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleLayerVisibility(this.getAttribute('data-id'));
            });
        });

        var delBtns = container.querySelectorAll('.layer-delete-btn');
        delBtns.forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                deleteLayer(this.getAttribute('data-id'));
            });
        });
    }

    // ===== Cities =====
    function renderCities() {
        var container = document.getElementById('cities-list');
        var html = '';
        CITIES.forEach(function (c, index) {
            html += '<button type="button" class="city-item" data-index="' + index + '">' +
                '<span class="city-mark">◎</span> ' + escapeHtml(c.name) +
                '</button>';
        });
        container.innerHTML = html;

        var items = container.querySelectorAll('.city-item');
        items.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var city = CITIES[parseInt(this.getAttribute('data-index'), 10)];
                if (!city || !map) return;
                map.flyTo({ center: city.center, zoom: city.zoom, duration: 1800 });
                document.getElementById('cities-panel').hidden = true;
                showToast('پرش به ' + city.name, 'success');
            });
        });
    }

    // ===== Share Layer(s) =====
    function renderShareChecklist() {
        var container = document.getElementById('share-layer-checklist');
        var html = '';
        layers.forEach(function (l) {
            var count = markers.filter(function (m) { return m.layerId === l.id; }).length;
            html += '<label class="share-layer-item" style="--layer-color:' + l.color + '">' +
                '<input type="checkbox" class="share-layer-checkbox" value="' + l.id + '">' +
                '<span class="layer-color-dot"></span>' +
                '<span class="layer-name">' + escapeHtml(l.name) + '</span>' +
                '<span class="layer-count">' + count + '</span>' +
                '</label>';
        });
        container.innerHTML = html;
    }

    function buildGeoJSON(markerSubset) {
        return {
            type: 'FeatureCollection',
            features: markerSubset.map(function (m) {
                var layer = getLayerById(m.layerId);
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
                    properties: {
                        id: m.id,
                        notes: m.notes,
                        layerId: m.layerId,
                        layerName: layer ? layer.name : '',
                        layerColor: layer ? layer.color : FALLBACK_COLOR,
                        createdAt: m.createdAt,
                        createdAtDisplay: m.createdAtDisplay
                    }
                };
            })
        };
    }

    function downloadBlob(blob, fileName) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function handleShareLayers() {
        var checked = document.querySelectorAll('.share-layer-checkbox:checked');
        if (checked.length === 0) {
            showToast('حداقل یک لایه را انتخاب کنید', 'error');
            return;
        }

        var selectedIds = Array.prototype.map.call(checked, function (cb) { return cb.value; });
        var subset = markers.filter(function (m) { return selectedIds.indexOf(m.layerId) > -1; });

        if (subset.length === 0) {
            showToast('این لایه‌ها نقطه‌ای ندارند', 'error');
            return;
        }

        var layerNames = selectedIds.map(function (id) {
            var l = getLayerById(id);
            return l ? l.name : '';
        }).join('، ');

        var geojson = buildGeoJSON(subset);
        var dataStr = JSON.stringify(geojson, null, 2);
        var fileName = 'field_notes_' + layerNames.replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.geojson';
        var blob = new Blob([dataStr], { type: 'application/geo+json' });
        var file = null;

        try {
            file = new File([blob], fileName, { type: 'application/geo+json' });
        } catch (e) {
            file = null;
        }

        document.getElementById('share-layer-form').hidden = true;

        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
                files: [file],
                title: 'یادداشت میدانی',
                text: 'نقاط لایه‌ی «' + layerNames + '»'
            }).catch(function (err) {
                if (err && err.name !== 'AbortError') {
                    downloadBlob(blob, fileName);
                    showToast('اشتراک‌گذاری ممکن نشد؛ فایل دانلود شد', 'error');
                }
            });
        } else {
            downloadBlob(blob, fileName);
            showToast('مرورگر شما از اشتراک‌گذاری مستقیم پشتیبانی نمی‌کند؛ فایل «' + layerNames + '» دانلود شد', 'success');
        }
    }

    // ===== Marker Management =====
    function generateId() {
        return 'mk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    function addMarker(lng, lat, properties) {
        var id = (properties && properties.id) || generateId();
        var now = new Date();
        var layerId = (properties && ensureLayerExists(properties.layerId, properties.layerName)) || activeLayerId;

        var data = {
            id: id,
            lng: lng,
            lat: lat,
            notes: (properties && properties.notes) || '',
            layerId: layerId,
            createdAt: (properties && properties.createdAt) || now.toISOString(),
            createdAtDisplay: (properties && properties.createdAtDisplay) || formatDate(now)
        };

        var existingIndex = markers.findIndex(function (m) { return m.id === id; });
        if (existingIndex > -1) {
            markers[existingIndex] = data;
        } else {
            markers.push(data);
        }

        updateMapMarkers();
        saveMarkersToStorage();
        renderMarkerList();
        renderLayers();
        showToast('نقطه اضافه شد!', 'success');
    }

    function updateMapMarkers() {
        if (!map || !map.getSource(SOURCE_ID)) return;

        var features = markers.map(function (m) {
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
                properties: {
                    id: m.id,
                    notes: m.notes,
                    layerId: m.layerId,
                    createdAt: m.createdAt,
                    createdAtDisplay: m.createdAtDisplay
                }
            };
        });

        map.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features: features });
    }

    function deleteMarker(id) {
        markers = markers.filter(function (m) { return m.id !== id; });
        updateMapMarkers();
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }
        saveMarkersToStorage();
        renderMarkerList();
        renderLayers();
        showToast('نقطه حذف شد', 'error');
    }

    function updateMarkerNotes(id, notes) {
        var marker = markers.find(function (m) { return m.id === id; });
        if (marker) {
            marker.notes = notes;
            updateMapMarkers();
            saveMarkersToStorage();
            renderMarkerList();
            showToast('یادداشت ذخیره شد!', 'success');
        }
    }

    // ===== Popup =====
    function openPopup(id) {
        var data = markers.find(function (m) { return m.id === id; });
        if (!data) return;

        // Close any open popup first
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }

        var layer = getLayerById(data.layerId) || layers[0];

        var html = '<div class="popup-content">' +
            '<div class="popup-header">' +
            '<strong class="popup-title"><span class="popup-layer-dot" style="--layer-color:' + layer.color + '"></span> نقطه</strong>' +
            '</div>' +
            '<div class="popup-date">🕐 ' + data.createdAtDisplay + '</div>' +
            '<div class="popup-coords">' + data.lat.toFixed(6) + ', ' + data.lng.toFixed(6) + '</div>' +
            '<div class="popup-layer-name">لایه: ' + escapeHtml(layer.name) + '</div>' +
            '<textarea class="popup-notes" data-id="' + data.id + '" placeholder="یادداشت خود را بنویسید..." rows="4">' +
            escapeHtml(data.notes) +
            '</textarea>' +
            '<div class="popup-actions">' +
            '<button class="popup-save-btn btn btn-primary btn-sm" data-id="' + data.id + '">ذخیره یادداشت</button>' +
            '<button class="popup-delete-btn btn btn-danger btn-sm" data-id="' + data.id + '" title="حذف نقطه">حذف</button>' +
            '</div>' +
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

        // Keep state in sync however the popup gets closed (X button, delete, etc.)
        popup.on('close', function () {
            if (activePopup === popup) {
                activePopup = null;
            }
        });

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

            var textarea = popupEl.querySelector('.popup-notes');
            if (textarea) {
                textarea.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        var markerId = this.getAttribute('data-id');
                        updateMarkerNotes(markerId, this.value);
                    }
                });
                textarea.addEventListener('click', function (e) {
                    e.stopPropagation();
                });
            }
        }, 50);

        // On mobile the map is only the top ~54vh of the screen. Pad the
        // bottom of the "usable" area before centering so the popup (which
        // can be tall — notes + save/delete buttons) doesn't get clipped by
        // the map container's edge / the coordinates overlay.
        var mobile = isMobileViewport();
        map.flyTo({
            center: [data.lng, data.lat],
            zoom: Math.max(map.getZoom(), 14),
            duration: 800,
            padding: mobile
                ? { top: 20, bottom: Math.min(260, Math.round(map.getContainer().clientHeight * 0.55)), left: 20, right: 20 }
                : { top: 40, bottom: 40, left: 40, right: 40 }
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

        var visibleIds = getVisibleLayerIds();
        var visibleMarkers = markers.filter(function (m) { return visibleIds.indexOf(m.layerId) > -1; });

        if (visibleMarkers.length === 0) {
            container.innerHTML = '<p class="empty-message">همه لایه‌ها مخفی هستند. یک لایه را نمایان کنید.</p>';
            return;
        }

        var sorted = visibleMarkers.slice().sort(function (a, b) {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        var html = '';
        sorted.forEach(function (m) {
            var notesPreview = m.notes ? escapeHtml(m.notes) : 'بدون یادداشت';
            var notesClass = m.notes ? 'item-notes' : 'item-notes empty';
            var layer = getLayerById(m.layerId);
            var color = layer ? layer.color : FALLBACK_COLOR;
            var layerName = layer ? layer.name : '';

            html += '<div class="marker-list-item" data-id="' + m.id + '" style="--item-color:' + color + '">' +
                '<div class="item-header">' +
                '<span class="item-id">' + m.id.substring(0, 10) + '…</span>' +
                '<span class="item-date">' + m.createdAtDisplay + '</span>' +
                '</div>' +
                '<div class="item-coords">' + m.lat.toFixed(4) + ', ' + m.lng.toFixed(4) + ' · ' + escapeHtml(layerName) + '</div>' +
                '<div class="' + notesClass + '">' + notesPreview + '</div>' +
                '</div>';
        });

        container.innerHTML = html;

        var items = container.querySelectorAll('.marker-list-item');
        items.forEach(function (item) {
            item.addEventListener('click', function () {
                var id = this.getAttribute('data-id');
                openPopup(id);
            });
        });
    }

    // ===== Local Storage =====
    function saveMarkersToStorage() {
        try {
            localStorage.setItem(STORAGE_KEY_MARKERS, JSON.stringify(markers));
        } catch (e) {
            console.error('Failed to save markers to localStorage:', e);
            showToast('ذخیره داده با خطا مواجه شد', 'error');
        }
    }

    function loadMarkersFromStorage() {
        try {
            var data = localStorage.getItem(STORAGE_KEY_MARKERS);
            if (data) {
                var parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    markers = parsed.map(function (m) {
                        if (!m.layerId) m.layerId = activeLayerId;
                        return m;
                    });
                }
            }
        } catch (e) {
            console.error('Failed to load markers from localStorage:', e);
        }
    }

    function saveLayers() {
        try {
            localStorage.setItem(STORAGE_KEY_LAYERS, JSON.stringify(layers));
        } catch (e) {
            console.error('Failed to save layers to localStorage:', e);
        }
    }

    function saveActiveLayer() {
        try {
            localStorage.setItem(STORAGE_KEY_ACTIVE_LAYER, activeLayerId);
        } catch (e) {
            console.error('Failed to save active layer:', e);
        }
    }

    function loadLayers() {
        try {
            var data = localStorage.getItem(STORAGE_KEY_LAYERS);
            if (data) {
                var parsed = JSON.parse(data);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    layers = parsed;
                }
            }
        } catch (e) {
            console.error('Failed to load layers from localStorage:', e);
        }

        if (layers.length === 0) {
            layers = DEFAULT_LAYERS.map(function (l) { return Object.assign({}, l); });
            saveLayers();
        }

        var storedActive = null;
        try {
            storedActive = localStorage.getItem(STORAGE_KEY_ACTIVE_LAYER);
        } catch (e) {
            storedActive = null;
        }

        if (storedActive && getLayerById(storedActive)) {
            activeLayerId = storedActive;
        } else {
            activeLayerId = layers[0].id;
            saveActiveLayer();
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

                if (!map.getSource('geolocation-source')) {
                    map.addSource('geolocation-source', {
                        type: 'geojson',
                        data: { type: 'FeatureCollection', features: [] }
                    });

                    map.addLayer({
                        id: 'geolocation-layer',
                        type: 'circle',
                        source: 'geolocation-source',
                        paint: {
                            'circle-radius': 12,
                            'circle-color': '#4fb0c6',
                            'circle-stroke-width': 3,
                            'circle-stroke-color': '#ffffff',
                            'circle-opacity': 0.85
                        }
                    });

                    map.addLayer({
                        id: 'geolocation-pulse',
                        type: 'circle',
                        source: 'geolocation-source',
                        paint: {
                            'circle-radius': 20,
                            'circle-color': '#4fb0c6',
                            'circle-opacity': 0.3,
                            'circle-stroke-width': 0
                        }
                    });
                }

                var geoData = {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [lng, lat] },
                        properties: { accuracy: accuracy }
                    }]
                };

                map.getSource('geolocation-source').setData(geoData);

                map.flyTo({ center: [lng, lat], zoom: 15, duration: 2000 });

                showToast('موقعیت یافت شد! دقت: ' + Math.round(accuracy) + ' متر', 'success');

                var pulseLayer = map.getLayer('geolocation-pulse');
                if (pulseLayer) {
                    var pulseRadius = 12;
                    var pulseOpacity = 0.8;
                    var growing = true;

                    function animatePulse() {
                        if (growing) {
                            pulseRadius += 0.5;
                            pulseOpacity -= 0.02;
                            if (pulseRadius >= 28) growing = false;
                        } else {
                            pulseRadius -= 0.5;
                            pulseOpacity += 0.02;
                            if (pulseRadius <= 12) growing = true;
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
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    }

    // ===== Export GeoJSON =====
    function handleExport() {
        if (markers.length === 0) {
            showToast('نقطه‌ای برای خروجی وجود ندارد', 'error');
            return;
        }

        var geojson = buildGeoJSON(markers);
        var dataStr = JSON.stringify(geojson, null, 2);
        var blob = new Blob([dataStr], { type: 'application/geo+json' });
        downloadBlob(blob, 'field_notes_mashhad_' + new Date().toISOString().slice(0, 10) + '.geojson');

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
                            layerId: props.layerId || null,
                            layerName: props.layerName || null,
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

                if (importedCount > 0 && markers.length > 0) {
                    fitMapToMarkers();
                }
            } catch (err) {
                console.error('Import error:', err);
                showToast('خطا در خواندن فایل GeoJSON', 'error');
            }
        };

        reader.readAsText(file);
        event.target.value = '';
    }

    // ===== Clear All =====
    function handleClearAll() {
        if (markers.length === 0) {
            showToast('نقطه‌ای برای پاک کردن وجود ندارد', 'error');
            return;
        }

        if (!confirm('آیا از حذف همه ' + markers.length + ' نقطه (در همه لایه‌ها) مطمئنید؟ این عمل قابل بازگشت نیست.')) {
            return;
        }

        markers = [];
        updateMapMarkers();
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }
        saveMarkersToStorage();
        renderMarkerList();
        renderLayers();
        showToast('همه نقاط پاک شدند', 'error');
    }

    // ===== Fit Map to Markers =====
    function fitMapToMarkers() {
        if (markers.length === 0) return;

        if (markers.length === 1) {
            map.flyTo({ center: [markers[0].lng, markers[0].lat], zoom: 12, duration: 1500 });
            return;
        }

        var bounds = new maplibregl.LngLatBounds();
        markers.forEach(function (m) {
            bounds.extend([m.lng, m.lat]);
        });

        map.fitBounds(bounds, { padding: 80, duration: 1500, maxZoom: 16 });
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

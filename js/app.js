// ============================================================
// Main App Logic — Screen Navigation, Camera, Analysis
// ============================================================

let selectedPaletteKey = null;
let cameraStream = null;
let availableCameras = [];
let currentCameraIndex = 0;

// --- Screen Navigation ---

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// --- Palette Selection ---

function initPaletteSelector() {
  const select = document.getElementById('palette-select');
  const options = getAllPaletteOptions();

  const groups = {
    'Spring (Warm & Light)': options.filter(o => o.key.includes('spring')),
    'Summer (Cool & Soft)': options.filter(o => o.key.includes('summer')),
    'Autumn (Warm & Rich)': options.filter(o => o.key.includes('autumn')),
    'Winter (Cool & Deep)': options.filter(o => o.key.includes('winter'))
  };

  for (const [groupName, groupOptions] of Object.entries(groups)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupName;
    for (const opt of groupOptions) {
      const el = document.createElement('option');
      el.value = opt.key;
      el.textContent = opt.name;
      optgroup.appendChild(el);
    }
    select.appendChild(optgroup);
  }

  const defaultCheck = document.getElementById('default-check');

  select.addEventListener('change', () => {
    selectedPaletteKey = select.value;
    showPalettePreview(selectedPaletteKey);
    document.getElementById('btn-start').disabled = false;
    if (defaultCheck.checked) {
      localStorage.setItem('defaultPalette', selectedPaletteKey);
    }
  });

  defaultCheck.addEventListener('change', () => {
    if (defaultCheck.checked && selectedPaletteKey) {
      localStorage.setItem('defaultPalette', selectedPaletteKey);
    } else {
      localStorage.removeItem('defaultPalette');
    }
  });

  // Restore default palette
  const saved = localStorage.getItem('defaultPalette');
  if (saved && PALETTES[saved]) {
    select.value = saved;
    selectedPaletteKey = saved;
    defaultCheck.checked = true;
    showPalettePreview(saved);
    document.getElementById('btn-start').disabled = false;
  }
}

function showPalettePreview(key) {
  const palette = getPaletteByKey(key);
  if (!palette) return;

  document.getElementById('palette-name').textContent = palette.name;
  document.getElementById('palette-desc').textContent = palette.description;

  const container = document.getElementById('palette-swatches');
  container.innerHTML = '';
  for (const color of palette.colors) {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = color.hex;
    swatch.title = color.name;
    container.appendChild(swatch);
  }

  document.getElementById('palette-preview').classList.remove('hidden');
}

// --- Camera ---

async function loadCameraList() {
  try {
    // Need a temporary stream to trigger permission, then enumerate
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
    tempStream.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    availableCameras = devices.filter(d => d.kind === 'videoinput');

    // Try to default to a rear/environment camera
    const rearIdx = availableCameras.findIndex(d =>
      d.label.toLowerCase().includes('back') ||
      d.label.toLowerCase().includes('rear') ||
      d.label.toLowerCase().includes('environment')
    );
    if (rearIdx >= 0) currentCameraIndex = rearIdx;

    // Show/hide switch button
    const switchBtn = document.getElementById('btn-switch-camera');
    if (switchBtn) {
      switchBtn.style.display = availableCameras.length > 1 ? '' : 'none';
    }
  } catch (e) {
    availableCameras = [];
  }
}

async function startCamera() {
  try {
    if (availableCameras.length === 0) {
      await loadCameraList();
    }

    const constraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 } } };

    if (availableCameras.length > 0 && availableCameras[currentCameraIndex]) {
      constraints.video.deviceId = { exact: availableCameras[currentCameraIndex].deviceId };
    } else {
      constraints.video.facingMode = 'environment';
    }

    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);

    const video = document.getElementById('camera-feed');
    video.srcObject = cameraStream;
    showScreen('screen-camera');

    // Show camera label
    updateCameraLabel();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      alert('Camera access was denied. Please allow camera access to use this feature.');
    } else if (err.name === 'NotFoundError') {
      alert('No camera found on this device.');
    } else {
      alert('Could not access camera: ' + err.message);
    }
  }
}

function updateCameraLabel() {
  const label = document.getElementById('camera-label');
  if (!label || availableCameras.length <= 1) {
    if (label) label.textContent = '';
    return;
  }
  const cam = availableCameras[currentCameraIndex];
  // Show a short label: "Camera 1 of 3" or the device label if available
  const name = cam.label ? cam.label.split('(')[0].trim() : `Camera ${currentCameraIndex + 1}`;
  label.textContent = name;
}

async function switchCamera() {
  if (availableCameras.length <= 1) return;
  currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
  stopCamera();
  await startCamera();
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const video = document.getElementById('camera-feed');
  video.srcObject = null;
}

function capturePhoto() {
  const video = document.getElementById('camera-feed');
  const canvas = document.getElementById('capture-canvas');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  stopCamera();
  return canvas;
}

// --- Analysis ---

function runAnalysis(canvas) {
  const loading = document.getElementById('loading');
  loading.classList.remove('hidden');

  // Use setTimeout to allow the loading UI to render
  setTimeout(() => {
    const palette = getPaletteByKey(selectedPaletteKey);
    const allColors = extractDominantColors(canvas, 4);

    if (allColors.length === 0) {
      loading.classList.add('hidden');
      alert('Could not detect any colors. Please try again with better lighting.');
      showScreen('screen-palette');
      return;
    }

    // Focus on the single dominant color (largest cluster)
    const dominantColors = [allColors[0]];

    // Normalize percentages
    const total = dominantColors.reduce((s, c) => s + c.percentage, 0);
    dominantColors.forEach(c => {
      c.percentage = Math.round((c.percentage / total) * 100);
    });

    const analysis = analyzeColors(dominantColors, palette, selectedPaletteKey);
    showResults(analysis, palette);

    loading.classList.add('hidden');
    showScreen('screen-results');
  }, 100);
}

// --- Results Display ---

function showResults(analysis, palette) {
  // Overall verdict
  const verdictCard = document.getElementById('overall-verdict');
  verdictCard.className = 'verdict-card verdict-' + analysis.overallLevel;

  const icons = {
    great: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
  };

  document.getElementById('verdict-icon').innerHTML = icons[analysis.overallLevel] || icons.ok;
  document.getElementById('verdict-text').textContent = analysis.overallVerdict;
  document.getElementById('verdict-palette').textContent = 'Your palette: ' + palette.name;

  // Show dimension feedback for overall verdict
  const feedbackEl = document.getElementById('verdict-feedback');
  if (feedbackEl) {
    if (analysis.overallFeedback && analysis.overallLevel !== 'great') {
      feedbackEl.textContent = analysis.overallFeedback;
      feedbackEl.className = 'verdict-feedback';
    } else {
      feedbackEl.textContent = '';
    }
  }

  // Show best palettes recommendation
  const bestPalettesEl = document.getElementById('best-palettes');
  if (bestPalettesEl && analysis.bestPalettes && analysis.bestPalettes.length > 0) {
    const validPalettes = analysis.bestPalettes.filter(p => p.score > 0);
    if (validPalettes.length === 0) {
      bestPalettesEl.innerHTML = '';
    } else {
      const listHtml = validPalettes
        .map((p, i) => {
          const isCurrent = p.key === selectedPaletteKey;
          const classes = `best-palette-tag${i === 0 ? ' top' : ''}`;
          return `<span class="${classes}">${p.name} (${p.score}%)${isCurrent ? ' — yours!' : ''}</span>`;
        })
        .join(' ');
      bestPalettesEl.innerHTML = `<div class="best-palettes-label">Best palettes for this item:</div>${listHtml}`;
    }
  }

  // Color results
  const container = document.getElementById('color-results');
  container.innerHTML = '';

  for (const result of analysis.results) {
    const card = document.createElement('div');
    card.className = 'color-card level-' + result.level;

    card.innerHTML = `
      <div class="color-comparison">
        <div class="color-block">
          <div class="color-circle" style="background-color: ${result.detectedColor.hex}"></div>
          <span class="color-label">Detected</span>
          <span class="color-hex">${result.detectedColor.hex}</span>
        </div>
        <div class="color-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </div>
        <div class="color-block">
          <div class="color-circle" style="background-color: ${result.closestPaletteColor.hex}"></div>
          <span class="color-label">Closest Match</span>
          <span class="color-hex">${result.closestPaletteColor.name}</span>
        </div>
      </div>
      <div class="color-verdict">
        <span class="badge badge-${result.level}">${result.verdict}</span>
        <span class="distance">Distance: ${result.distance}</span>
      </div>
      ${result.feedback ? `<div class="color-feedback feedback-${result.level}">${result.feedback}</div>` : ''}
      <div class="color-dimensions">
        <span class="dim-tag dim-temp" title="Temperature">${result.dimensions.temperature > 0.1 ? 'Warm' : result.dimensions.temperature < -0.1 ? 'Cool' : 'Neutral'}</span>
        <span class="dim-tag dim-value" title="Value">${result.dimensions.value > 0.65 ? 'Light' : result.dimensions.value < 0.35 ? 'Dark' : 'Medium'}</span>
        <span class="dim-tag dim-chroma" title="Chroma">${result.dimensions.chroma > 0.55 ? 'Bright' : result.dimensions.chroma < 0.3 ? 'Muted' : 'Moderate'}</span>
      </div>
      <div class="color-best-palette">Best for: ${result.bestPalette.name}</div>
    `;

    container.appendChild(card);
  }
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
  initPaletteSelector();

  document.querySelectorAll('.exit-app-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.close();
      setTimeout(() => {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#a0a0b0;font-family:sans-serif;text-align:center;padding:20px"><p>You can now swipe up to close the app.</p></div>';
      }, 300);
    });
  });

  document.getElementById('btn-start').addEventListener('click', startCamera);

  document.getElementById('btn-back').addEventListener('click', () => {
    stopCamera();
    showScreen('screen-palette');
  });

  document.getElementById('btn-capture').addEventListener('click', () => {
    const canvas = capturePhoto();
    runAnalysis(canvas);
  });

  document.getElementById('btn-switch-camera').addEventListener('click', switchCamera);

  document.getElementById('btn-retry').addEventListener('click', startCamera);

  document.getElementById('btn-change-palette').addEventListener('click', () => {
    showScreen('screen-palette');
  });
});

// --- Service Worker Registration ---

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// ============================================================
// Main App Logic — Screen Navigation, Camera, Analysis
// ============================================================

let selectedPaletteKey = null;
let cameraStream = null;
let calibrationData = null; // { labOffset: [dL, da, db] }

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
  const calibCheck = document.getElementById('default-calib-check');

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

  calibCheck.addEventListener('change', () => {
    if (calibCheck.checked && calibrationData) {
      localStorage.setItem('defaultCalibration', JSON.stringify(calibrationData));
    } else {
      localStorage.removeItem('defaultCalibration');
      calibrationData = null;
      updateCalibrationStatus();
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

  // Restore default calibration
  const savedCalib = localStorage.getItem('defaultCalibration');
  if (savedCalib) {
    try {
      calibrationData = JSON.parse(savedCalib);
      calibCheck.checked = true;
      updateCalibrationStatus();
    } catch (e) {
      localStorage.removeItem('defaultCalibration');
    }
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

async function startCamera() {
  try {
    // Always use the standard 1x rear camera
    const constraints = {
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        // Avoid ultra-wide or telephoto — request ~26mm focal length (standard 1x)
        zoom: { ideal: 1.0 }
      }
    };

    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);

    const video = document.getElementById('camera-feed');
    video.srcObject = cameraStream;
    showScreen('screen-camera');
    updateCalibrationIndicator();
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

// --- White Balance Calibration ---

function calibrateWhiteBalance() {
  const video = document.getElementById('camera-feed');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  // Sample the probe area (center 8%)
  const probeSize = Math.floor(Math.min(canvas.width, canvas.height) * 0.08);
  const mx = Math.floor((canvas.width - probeSize) / 2);
  const my = Math.floor((canvas.height - probeSize) / 2);
  const imageData = ctx.getImageData(mx, my, probeSize, probeSize);
  const data = imageData.data;

  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    sumR += data[i];
    sumG += data[i + 1];
    sumB += data[i + 2];
    count++;
  }

  if (count === 0) {
    alert('Could not read probe area. Try again.');
    return;
  }

  const avgR = sumR / count;
  const avgG = sumG / count;
  const avgB = sumB / count;

  // Check that the sample is roughly white/light gray (brightness > 120)
  const brightness = (avgR + avgG + avgB) / 3;
  if (brightness < 100) {
    alert('The probe area is too dark. Please point at a white sheet of paper under your current lighting.');
    return;
  }

  // Convert sampled white to Lab
  const whiteLab = rgbToLab(Math.round(avgR), Math.round(avgG), Math.round(avgB));

  // Pure white in Lab = [100, 0, 0]
  // Correction offset: shift any captured color so this white maps to true white
  calibrationData = {
    labOffset: [100 - whiteLab[0], 0 - whiteLab[1], 0 - whiteLab[2]]
  };

  // If "set as default" is checked, save it
  const calibCheck = document.getElementById('default-calib-check');
  if (calibCheck && calibCheck.checked) {
    localStorage.setItem('defaultCalibration', JSON.stringify(calibrationData));
  }

  updateCalibrationIndicator();
  updateCalibrationStatus();

  // Brief visual feedback
  const indicator = document.getElementById('calib-indicator');
  if (indicator) {
    indicator.classList.add('calib-flash');
    setTimeout(() => indicator.classList.remove('calib-flash'), 600);
  }
}

function clearCalibration() {
  calibrationData = null;
  const calibCheck = document.getElementById('default-calib-check');
  if (calibCheck) calibCheck.checked = false;
  localStorage.removeItem('defaultCalibration');
  updateCalibrationIndicator();
  updateCalibrationStatus();
}

function applyCalibration(lab) {
  if (!calibrationData || !calibrationData.labOffset) return lab;
  return [
    lab[0] + calibrationData.labOffset[0],
    lab[1] + calibrationData.labOffset[1],
    lab[2] + calibrationData.labOffset[2]
  ];
}

function updateCalibrationIndicator() {
  const indicator = document.getElementById('calib-indicator');
  if (!indicator) return;
  if (calibrationData) {
    indicator.textContent = 'WB Calibrated';
    indicator.classList.add('active');
  } else {
    indicator.textContent = '';
    indicator.classList.remove('active');
  }
}

function updateCalibrationStatus() {
  const statusEl = document.getElementById('calib-status');
  if (!statusEl) return;
  if (calibrationData) {
    const o = calibrationData.labOffset;
    statusEl.textContent = `Active (L${o[0] > 0 ? '+' : ''}${o[0].toFixed(1)}, a${o[1] > 0 ? '+' : ''}${o[1].toFixed(1)}, b${o[2] > 0 ? '+' : ''}${o[2].toFixed(1)})`;
    statusEl.className = 'calib-status active';
  } else {
    statusEl.textContent = 'Not calibrated';
    statusEl.className = 'calib-status';
  }
}

// --- Color Correction Screen ---

let capturedCanvas = null;
let detectedDominantColor = null;
let baseLab = null; // original Lab values for slider adjustments

function showColorPicker(canvas) {
  capturedCanvas = canvas;
  const allColors = extractDominantColors(canvas, 4);

  if (allColors.length === 0) {
    alert('Could not detect any colors. Please try again with better lighting.');
    showScreen('screen-palette');
    return;
  }

  detectedDominantColor = allColors[0];
  // Apply white balance calibration if active
  baseLab = applyCalibration(detectedDominantColor.lab.slice());

  // Show original (raw camera) color and calibrated starting color
  document.getElementById('original-color-preview').style.backgroundColor = detectedDominantColor.hex;
  const calibRgb = labToRgb(baseLab[0], baseLab[1], baseLab[2]);
  const calibHex = rgbToHex(calibRgb[0], calibRgb[1], calibRgb[2]);
  document.getElementById('adjusted-color-preview').style.backgroundColor = calibHex;

  // Reset sliders
  document.getElementById('slider-temp').value = 0;
  document.getElementById('slider-light').value = 0;
  document.getElementById('slider-sat').value = 0;

  showScreen('screen-color-pick');
}

function getAdjustedColor() {
  const tempVal = parseInt(document.getElementById('slider-temp').value);
  const lightVal = parseInt(document.getElementById('slider-light').value);
  const satVal = parseInt(document.getElementById('slider-sat').value);

  let L = baseLab[0];
  let a = baseLab[1];
  let b = baseLab[2];

  // Lightness: shift L by up to ±25
  L = Math.max(0, Math.min(100, L + lightVal * 0.25));

  // Temperature: warm shifts toward yellow (increase b, slight increase a)
  // cool shifts toward blue (decrease b, slight decrease a)
  const tempShift = tempVal * 0.25;
  b = b + tempShift;
  a = a + tempShift * 0.3;

  // Saturation: scale chroma (a and b) up or down
  const satFactor = 1 + satVal * 0.008; // range: 0.2 to 1.8
  a = a * satFactor;
  b = b * satFactor;

  const rgb = labToRgb(L, a, b);
  const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
  const lab = [L, a, b];

  return { rgb, hex, lab };
}

function updateColorPreview() {
  const adjusted = getAdjustedColor();
  document.getElementById('adjusted-color-preview').style.backgroundColor = adjusted.hex;
}

function runAnalysisWithAdjusted() {
  const loading = document.getElementById('loading');
  loading.classList.remove('hidden');

  setTimeout(() => {
    const palette = getPaletteByKey(selectedPaletteKey);
    const adjusted = getAdjustedColor();

    const dominantColors = [{
      rgb: adjusted.rgb,
      hex: adjusted.hex,
      lab: adjusted.lab,
      percentage: 100
    }];

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
    showColorPicker(canvas);
  });

  // Color correction sliders — update preview in real-time
  ['slider-temp', 'slider-light', 'slider-sat'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateColorPreview);
  });

  document.getElementById('btn-use-color').addEventListener('click', runAnalysisWithAdjusted);

  document.getElementById('btn-reset-sliders').addEventListener('click', () => {
    document.getElementById('slider-temp').value = 0;
    document.getElementById('slider-light').value = 0;
    document.getElementById('slider-sat').value = 0;
    updateColorPreview();
  });

  document.getElementById('btn-retake').addEventListener('click', startCamera);

  document.getElementById('btn-calibrate').addEventListener('click', calibrateWhiteBalance);
  document.getElementById('btn-clear-calib').addEventListener('click', clearCalibration);

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

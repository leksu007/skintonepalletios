// ============================================================
// Color Analysis Engine
// RGB → Lab conversion, K-means clustering, Delta E matching
// ============================================================

// --- RGB to Lab conversion ---

function rgbToXyz(r, g, b) {
  // Normalize to 0-1
  r /= 255; g /= 255; b /= 255;

  // Linearize (inverse sRGB companding)
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  r *= 100; g *= 100; b *= 100;

  // sRGB D65
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  return [x, y, z];
}

function xyzToLab(x, y, z) {
  // D65 reference
  const xn = 95.047, yn = 100.000, zn = 108.883;
  x /= xn; y /= yn; z /= zn;

  const epsilon = 0.008856;
  const kappa = 903.3;

  x = x > epsilon ? Math.cbrt(x) : (kappa * x + 16) / 116;
  y = y > epsilon ? Math.cbrt(y) : (kappa * y + 16) / 116;
  z = z > epsilon ? Math.cbrt(z) : (kappa * z + 16) / 116;

  const L = 116 * y - 16;
  const a = 500 * (x - y);
  const b = 200 * (y - z);
  return [L, a, b];
}

function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16)
  ];
}

function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

// --- Color Dimension Analysis ---
// Analyzes a color's temperature (warm/cool), value (light/dark), chroma (bright/muted)

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return [h, s, v];
}

function colorTemperature(r, g, b) {
  // Returns -1.0 (fully cool/blue) to +1.0 (fully warm/yellow)
  // Based on article: warm = yellow-based, cool = blue-based
  const [h, s, v] = rgbToHsv(r, g, b);

  // Low saturation or very dark/light = neutral temperature
  if (s < 0.05) return 0;

  // Hue-based temperature assessment
  // Warm hues: ~10-75° (red-orange-yellow-yellow-green)
  // Cool hues: ~170-290° (cyan-blue-violet)
  // Transitional: green (75-170°) and magenta/red (290-10°)
  let hueTemp;
  if (h >= 10 && h <= 75) {
    // Warm zone: peak warmth around 40° (orange-yellow)
    hueTemp = 1.0 - Math.abs(h - 40) / 35 * 0.3;
  } else if (h > 75 && h < 170) {
    // Green zone: transitions from warm to cool
    // Yellow-green (75-120) is slightly warm, blue-green (120-170) is slightly cool
    hueTemp = 1.0 - (h - 75) / 95 * 2.0; // goes from ~0.7 to ~-1.0
  } else if (h >= 170 && h <= 290) {
    // Cool zone: peak coolness around 230° (blue)
    hueTemp = -1.0 + Math.abs(h - 230) / 60 * 0.3;
  } else {
    // Red-magenta zone (290-360, 0-10): warm-leaning but less than orange
    const normH = h > 290 ? h - 360 : h;
    hueTemp = 0.4 + (10 - Math.abs(normH)) / 80 * 0.3;
  }

  // Factor in the RGB balance as a secondary signal
  // Warm colors tend to have high R and low B; cool colors the opposite
  const rgbSignal = ((r / 255) * 0.5 + (g / 255) * 0.1 - (b / 255) * 0.6);

  // Blend hue-based and RGB-based, hue is primary
  let temp = hueTemp * 0.7 + rgbSignal * 0.3 / 0.6;

  return Math.max(-1, Math.min(1, temp));
}

function colorValueDimension(lab) {
  // Returns 0.0 (dark) to 1.0 (light) based on Lab L*
  return lab[0] / 100;
}

function colorChroma(r, g, b, lab) {
  // Returns 0.0 (muted/grey) to 1.0 (bright/saturated)
  // Combine HSV saturation with Lab chroma for robustness
  const [h, s, v] = rgbToHsv(r, g, b);

  // Lab chroma: distance from grey axis
  const labChroma = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
  // Normalize: typical max chroma is ~130 for vivid colors
  const labChromaNorm = Math.min(1, labChroma / 100);

  // HSV saturation weighted by value (dark saturated colors appear less chromatic)
  const hsvComponent = s * (0.5 + v * 0.5);

  // Blend both signals
  return Math.min(1, hsvComponent * 0.5 + labChromaNorm * 0.5);
}

function analyzeColorDimensions(r, g, b) {
  const lab = rgbToLab(r, g, b);
  return {
    temperature: colorTemperature(r, g, b),
    value: colorValueDimension(lab),
    chroma: colorChroma(r, g, b, lab)
  };
}

// --- Delta E (CIEDE2000) ---

function deltaE(lab1, lab2) {
  const L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
  const L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];

  const avgL = (L1 + L2) / 2;
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avgCp = (C1p + C2p) / 2;

  let h1p = Math.atan2(b1, a1p) * 180 / Math.PI;
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * 180 / Math.PI;
  if (h2p < 0) h2p += 360;

  let dLp = L2 - L1;
  let dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);

  let avgHp;
  if (C1p * C2p === 0) {
    avgHp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    avgHp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    avgHp = (h1p + h2p + 360) / 2;
  } else {
    avgHp = (h1p + h2p - 360) / 2;
  }

  const T = 1
    - 0.17 * Math.cos((avgHp - 30) * Math.PI / 180)
    + 0.24 * Math.cos(2 * avgHp * Math.PI / 180)
    + 0.32 * Math.cos((3 * avgHp + 6) * Math.PI / 180)
    - 0.20 * Math.cos((4 * avgHp - 63) * Math.PI / 180);

  const SL = 1 + 0.015 * Math.pow(avgL - 50, 2) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const SC = 1 + 0.045 * avgCp;
  const SH = 1 + 0.015 * avgCp * T;

  const RT_exp = -2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const deltaTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const RC = RT_exp * Math.sin(2 * deltaTheta * Math.PI / 180);

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
    Math.pow(dCp / SC, 2) +
    Math.pow(dHp / SH, 2) +
    RC * (dCp / SC) * (dHp / SH)
  );
}

// --- K-Means Clustering ---

function kMeans(pixels, k, maxIter = 20) {
  if (pixels.length === 0) return [];
  if (pixels.length <= k) return pixels.map(p => ({ rgb: p, count: 1 }));

  // Initialize centroids with k-means++
  const centroids = [pixels[Math.floor(Math.random() * pixels.length)].slice()];

  for (let i = 1; i < k; i++) {
    const distances = pixels.map(p => {
      const minDist = Math.min(...centroids.map(c =>
        Math.pow(p[0] - c[0], 2) + Math.pow(p[1] - c[1], 2) + Math.pow(p[2] - c[2], 2)
      ));
      return minDist;
    });
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalDist;
    for (let j = 0; j < distances.length; j++) {
      rand -= distances[j];
      if (rand <= 0) {
        centroids.push(pixels[j].slice());
        break;
      }
    }
    if (centroids.length <= i) {
      centroids.push(pixels[Math.floor(Math.random() * pixels.length)].slice());
    }
  }

  let assignments = new Array(pixels.length);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign pixels to nearest centroid
    let changed = false;
    for (let i = 0; i < pixels.length; i++) {
      let minDist = Infinity;
      let minIdx = 0;
      for (let j = 0; j < k; j++) {
        const dist = Math.pow(pixels[i][0] - centroids[j][0], 2) +
                     Math.pow(pixels[i][1] - centroids[j][1], 2) +
                     Math.pow(pixels[i][2] - centroids[j][2], 2);
        if (dist < minDist) {
          minDist = dist;
          minIdx = j;
        }
      }
      if (assignments[i] !== minIdx) {
        assignments[i] = minIdx;
        changed = true;
      }
    }

    if (!changed) break;

    // Update centroids
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < pixels.length; i++) {
      const c = assignments[i];
      sums[c][0] += pixels[i][0];
      sums[c][1] += pixels[i][1];
      sums[c][2] += pixels[i][2];
      counts[c]++;
    }
    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) {
        centroids[j][0] = sums[j][0] / counts[j];
        centroids[j][1] = sums[j][1] / counts[j];
        centroids[j][2] = sums[j][2] / counts[j];
      }
    }
  }

  // Count cluster sizes
  const counts = new Array(k).fill(0);
  for (let i = 0; i < pixels.length; i++) {
    counts[assignments[i]]++;
  }

  return centroids.map((c, i) => ({
    rgb: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])],
    count: counts[i]
  })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
}

// --- Skin Tone Detection ---

function isSkinTone(r, g, b) {
  // Convert to normalized values
  const total = r + g + b;
  if (total === 0) return false;

  // HSV-based skin detection
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max / 255;

  // Skin tones: hue roughly 0-50°, moderate saturation, not too dark
  const isSkinHue = (h >= 0 && h <= 50) || h >= 350;
  const isSkinSat = s >= 0.1 && s <= 0.7;
  const isSkinVal = v >= 0.2 && v <= 0.85;

  // Additional RGB rule: skin tends to have R > G > B
  const rgbSkin = r > g && g > b && (r - b) > 15;

  return isSkinHue && isSkinSat && isSkinVal && rgbSkin;
}

// --- Color Extraction from Canvas ---

function extractDominantColors(canvas, numColors = 5) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Sample from center 60% of image to avoid background
  const marginX = Math.floor(width * 0.2);
  const marginY = Math.floor(height * 0.2);
  const sampleWidth = width - 2 * marginX;
  const sampleHeight = height - 2 * marginY;

  const imageData = ctx.getImageData(marginX, marginY, sampleWidth, sampleHeight);
  const data = imageData.data;

  // Sample every 4th pixel for performance
  const pixels = [];
  let skinCount = 0;
  let totalSampled = 0;

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Only exclude near-black (pure shadows) and near-white (blown highlights)
    const brightness = (r + g + b) / 3;
    if (brightness < 8 || brightness > 248) continue;

    totalSampled++;

    // Track skin pixels but don't add them
    if (isSkinTone(r, g, b)) {
      skinCount++;
      continue;
    }

    // For mid-to-bright pixels, filter out very low saturation (likely white/gray background)
    // But always keep dark pixels — dark navy, charcoal, etc. are valid garment colors
    if (brightness > 60) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      // Only filter greys in the mid-bright range
      if (saturation < 0.04 && brightness > 80 && brightness < 220) {
        continue;
      }
    }

    pixels.push([r, g, b]);
  }

  // If too many pixels were filtered as skin (>80%), it might be wrong — retry without skin filter
  if (pixels.length < 10 && skinCount > totalSampled * 0.5) {
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      if (brightness >= 8 && brightness <= 248) {
        pixels.push([r, g, b]);
      }
    }
  }

  if (pixels.length < 10) {
    // Last resort — take everything except pure black/white
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      if (brightness >= 4 && brightness <= 252) {
        pixels.push([r, g, b]);
      }
    }
  }

  if (pixels.length === 0) {
    return [];
  }

  const clusters = kMeans(pixels, numColors);

  return clusters.map(c => {
    const hex = '#' + c.rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
    return {
      rgb: c.rgb,
      hex: hex.toUpperCase(),
      lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]),
      percentage: c.count
    };
  });
}

// --- Dimension-Based Scoring ---

function scoreDimensionFit(value, range) {
  // Score how well a value fits within a season's expected range (0-1)
  if (value >= range.min && value <= range.max) {
    // Inside range — score based on distance from ideal
    const maxDist = Math.max(range.ideal - range.min, range.max - range.ideal);
    const dist = Math.abs(value - range.ideal);
    return maxDist === 0 ? 1.0 : 1.0 - (dist / maxDist) * 0.4; // 0.6-1.0 range
  }
  // Outside range — penalize based on how far outside
  const overshoot = value < range.min ? range.min - value : value - range.max;
  const rangeSize = range.max - range.min;
  const penalty = rangeSize > 0 ? overshoot / rangeSize : overshoot;
  return Math.max(0, 0.5 - penalty);
}

function getDimensionWeights(profile) {
  // Primary dimension = 50%, secondary = 30%, third = 20%
  const dims = ["temperature", "value", "chroma"];
  const traitToDim = {
    warm: "temperature", cool: "temperature",
    light: "value", dark: "value",
    bright: "chroma", muted: "chroma"
  };

  const primaryDim = traitToDim[profile.primary];
  const secondaryDim = traitToDim[profile.secondary];

  const weights = {};
  for (const dim of dims) {
    if (dim === primaryDim) weights[dim] = 0.50;
    else if (dim === secondaryDim) weights[dim] = 0.30;
    else weights[dim] = 0.20;
  }
  return weights;
}

function scoreDimensions(colorDims, seasonKey) {
  const profile = getSeasonProfile(seasonKey);
  if (!profile) return { dimensionScore: 0.5, feedback: "", scores: {} };

  const tempScore = scoreDimensionFit(colorDims.temperature, profile.temperature);
  const valueScore = scoreDimensionFit(colorDims.value, profile.value);
  const chromaScore = scoreDimensionFit(colorDims.chroma, profile.chroma);

  const weights = getDimensionWeights(profile);
  const dimensionScore =
    tempScore * weights.temperature +
    valueScore * weights.value +
    chromaScore * weights.chroma;

  const scores = {
    temperature: { score: tempScore, value: colorDims.temperature },
    value: { score: valueScore, value: colorDims.value },
    chroma: { score: chromaScore, value: colorDims.chroma }
  };

  // Generate feedback — identify the biggest mismatch
  const feedback = generateDimensionFeedback(colorDims, profile, scores);

  return { dimensionScore, feedback, scores };
}

function generateDimensionFeedback(colorDims, profile, scores) {
  const seasonName = profile.name;

  // Find the worst-scoring dimension
  const dimEntries = [
    { dim: "temperature", score: scores.temperature.score, value: colorDims.temperature, range: profile.temperature },
    { dim: "value", score: scores.value.score, value: colorDims.value, range: profile.value },
    { dim: "chroma", score: scores.chroma.score, value: colorDims.chroma, range: profile.chroma }
  ].sort((a, b) => a.score - b.score);

  const worst = dimEntries[0];

  // If everything scores well, give positive feedback
  if (worst.score >= 0.7) {
    const traitLabels = {
      warm: "warm", cool: "cool", light: "light", dark: "dark", bright: "bright", muted: "muted"
    };
    return `Good ${traitLabels[profile.primary]} and ${traitLabels[profile.secondary]} match`;
  }

  // Generate specific negative feedback
  if (worst.dim === "temperature") {
    if (worst.value > worst.range.max) {
      return `Too warm for ${seasonName}`;
    } else {
      return `Too cool for ${seasonName}`;
    }
  } else if (worst.dim === "value") {
    if (worst.value > worst.range.max) {
      return `Too light for ${seasonName}`;
    } else {
      return `Too dark for ${seasonName}`;
    }
  } else {
    if (worst.value > worst.range.max) {
      return `Too bright for ${seasonName}`;
    } else {
      return `Too muted for ${seasonName}`;
    }
  }
}

// --- Find Best Palette for a Color (dimension-aware) ---

function findBestPalette(colorLab, colorRgb) {
  const dims = analyzeColorDimensions(colorRgb[0], colorRgb[1], colorRgb[2]);
  let bestKey = null;
  let bestName = null;
  let bestScore = -Infinity;

  for (const [key] of Object.entries(PALETTES)) {
    const profile = getSeasonProfile(key);
    if (!profile) continue;

    // Combine dimension score with Delta E to best palette swatch
    const dimResult = scoreDimensions(dims, key);
    const deMatch = matchColorToPalette(colorLab, PALETTES[key].colors);
    let deScore;
    if (deMatch.distance < 6) deScore = 1.0;
    else if (deMatch.distance < 12) deScore = 0.65;
    else if (deMatch.distance < 20) deScore = 0.3;
    else deScore = 0.0;

    const combined = dimResult.dimensionScore * 0.6 + deScore * 0.4;
    if (combined > bestScore) {
      bestScore = combined;
      bestKey = key;
      bestName = profile.name;
    }
  }

  return { key: bestKey, name: bestName, score: bestScore };
}

// --- Find Best Overall Palette (weighted by cluster size, dimension-aware) ---

function findBestOverallPalette(dominantColors) {
  const totalPixels = dominantColors.reduce((s, c) => s + c.percentage, 0);
  const paletteScores = {};

  for (const [key, palette] of Object.entries(PALETTES)) {
    const profile = getSeasonProfile(key);
    if (!profile) continue;

    let weightedScore = 0;
    for (const color of dominantColors) {
      const weight = totalPixels > 0 ? color.percentage / totalPixels : 1 / dominantColors.length;

      // Delta E score
      const deMatch = matchColorToPalette(color.lab, palette.colors);
      let deScore;
      if (deMatch.distance < 6) deScore = 1.0;
      else if (deMatch.distance < 12) deScore = 0.65;
      else if (deMatch.distance < 20) deScore = 0.3;
      else deScore = 0.0;

      // Dimension score
      const dims = analyzeColorDimensions(color.rgb[0], color.rgb[1], color.rgb[2]);
      const dimResult = scoreDimensions(dims, key);

      const combined = dimResult.dimensionScore * 0.6 + deScore * 0.4;
      weightedScore += combined * weight;
    }
    paletteScores[key] = { name: palette.name, score: weightedScore };
  }

  return Object.entries(paletteScores)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 3)
    .map(([key, data]) => ({ key, name: data.name, score: Math.round(data.score * 100) }));
}

// --- Palette Matching ---

function matchColorToPalette(colorLab, paletteColors) {
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const pc of paletteColors) {
    const pcLab = hexToLab(pc.hex);
    const dist = deltaE(colorLab, pcLab);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = pc;
    }
  }

  return { paletteColor: bestMatch, distance: bestDistance };
}

function analyzeColors(dominantColors, palette, seasonKey) {
  const totalPixels = dominantColors.reduce((s, c) => s + c.percentage, 0);

  const results = dominantColors.map(color => {
    const match = matchColorToPalette(color.lab, palette.colors);
    const weight = totalPixels > 0 ? color.percentage / totalPixels : 1 / dominantColors.length;

    // Delta E score
    let deScore;
    if (match.distance < 6) deScore = 1.0;
    else if (match.distance < 12) deScore = 0.65;
    else if (match.distance < 20) deScore = 0.3;
    else deScore = 0.0;

    // Dimension-based score
    const dims = analyzeColorDimensions(color.rgb[0], color.rgb[1], color.rgb[2]);
    const dimResult = scoreDimensions(dims, seasonKey);

    // Combined score: 60% dimensions (theory-based), 40% Delta E (swatch proximity)
    const score = dimResult.dimensionScore * 0.6 + deScore * 0.4;

    let verdict, level;
    if (score >= 0.75) {
      verdict = "Great match!";
      level = "great";
    } else if (score >= 0.55) {
      verdict = "Close enough";
      level = "ok";
    } else if (score >= 0.35) {
      verdict = "Slightly off";
      level = "warning";
    } else {
      verdict = "Not in your palette";
      level = "bad";
    }

    // Make feedback consistent with verdict — don't show negative feedback for good verdicts
    let feedback = dimResult.feedback;
    if (level === "great") {
      feedback = dimResult.dimensionScore >= 0.7 ? dimResult.feedback : "Good match for your palette";
    } else if (level === "ok" && dimResult.dimensionScore >= 0.6) {
      feedback = "Reasonably close to your palette";
    }

    // Find which palette this color fits best
    const bestPalette = findBestPalette(color.lab, color.rgb);

    return {
      detectedColor: color,
      closestPaletteColor: match.paletteColor,
      distance: Math.round(match.distance * 10) / 10,
      verdict,
      level,
      weight,
      score,
      bestPalette,
      feedback,
      dimensions: dims,
      dimensionScores: dimResult.scores
    };
  });

  // Weighted overall score
  const weightedScore = results.reduce((sum, r) => sum + r.score * r.weight, 0);
  const dominantResult = results[0];

  let overallVerdict, overallLevel;

  if (dominantResult.weight > 0.3 && dominantResult.level === "bad") {
    overallVerdict = "This isn't in your color palette";
    overallLevel = "bad";
  } else if (dominantResult.weight > 0.3 && dominantResult.level === "warning") {
    if (weightedScore > 0.6) {
      overallVerdict = "Main color is slightly off your palette";
      overallLevel = "warning";
    } else {
      overallVerdict = "This isn't the best match for your palette";
      overallLevel = "warning";
    }
  } else if (weightedScore >= 0.7) {
    overallVerdict = "This looks great on you!";
    overallLevel = "great";
  } else if (weightedScore >= 0.5) {
    overallVerdict = "Pretty good — close to your palette";
    overallLevel = "ok";
  } else if (weightedScore >= 0.3) {
    overallVerdict = "Some colors don't match your palette";
    overallLevel = "warning";
  } else {
    overallVerdict = "This isn't in your color palette";
    overallLevel = "bad";
  }

  // Overall feedback — from the dominant color's dimension analysis
  const overallFeedback = dominantResult.feedback;

  // Find which palettes this garment suits best overall
  const bestPalettes = findBestOverallPalette(dominantColors);

  return { results, overallVerdict, overallLevel, overallFeedback, weightedScore: Math.round(weightedScore * 100), bestPalettes };
}

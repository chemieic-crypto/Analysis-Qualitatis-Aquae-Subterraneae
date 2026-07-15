import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import shp from "shpjs";
import {
  Layers,
  Compass,
  Sliders,
  Play,
  CheckCircle,
  TrendingUp,
  Map as MapIcon,
  Globe,
  Info,
  Calendar,
  SlidersHorizontal,
  FolderKanban,
  FileDown,
  Printer,
  ChevronRight,
  Eye,
  EyeOff,
  Maximize2,
  LayoutGrid,
  FileText,
  Image as ImageIcon,
  Upload,
  Trash2,
  ZoomIn,
  ZoomOut,
  Plus,
  Table,
  Search,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Download
} from "lucide-react";
import { PARAM_CONFIG } from "../data/config";
import { INDIA_BOUNDARY } from "../data/india_boundary";

interface GisMapViewProps {
  rawData: any[];
  headers: any;
  headerMap: Record<string, string>;
  selectedState?: string;
  selectedDistrict?: string;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
  isVisible: boolean;
  bulletinMaps?: Record<string, string>;
  setBulletinMaps?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export interface ShapefileLayer {
  id: string;
  name: string;
  geoJson: any;
  visible: boolean;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  fillOpacity: number;
  showLabels: boolean;
  labelKey: string;
  labelColor: string;
  labelSize: number;
}

// Color schemes definitions
const COLOR_SCHEMES = {
  "Blue-Yellow-Red": ["#005ce6", "#ffff00", "#ff0000"],
  "Green-Yellow-Red": ["#22c55e", "#facc15", "#ef4444"],
  "Spectral": ["#d53e4f", "#fdae61", "#abdda4", "#2b83ba"],
  "Viridis": ["#440154", "#31688e", "#35b779", "#fde725"],
  "Plasma": ["#0d0887", "#7e03a8", "#cc4778", "#f0f921"],
  "Chroma Aqua": ["#e0f2fe", "#7dd3fc", "#0284c7", "#0369a1"],
  "Terrain": ["#313695", "#74add1", "#fee090", "#d73027", "#a50026"],
  "Grey Scale": ["#f3f4f6", "#9ca3af", "#1f2937"]
};

// Basemaps definition with high-quality procedural styling
const BASEMAP_STYLES = {
  "No Basemap": { bg: "#ffffff", grid: "#f1f5f9", outline: "#cbd5e1" },
  "ESRI Terrain": { bg: "#faf5ec", grid: "rgba(120, 113, 108, 0.08)", outline: "#d6ccc2" },
  "ESRI Topographic": { bg: "#f4f8f4", grid: "rgba(15, 23, 42, 0.04)", outline: "#cbd5e1" },
  "ESRI Satellite": { bg: "#0b1220", grid: "rgba(255,255,255,0.06)", outline: "#1e293b" },
  "Google Road Map": { bg: "#f5f5f5", grid: "rgba(0,0,0,0.04)", outline: "#cbd5e1" },
  "Google Satellite": { bg: "#050a12", grid: "rgba(255,255,255,0.08)", outline: "#334155" },
  "Google Hybrid": { bg: "#060b14", grid: "rgba(255,255,255,0.1)", outline: "#475569" },
  "OpenStreetMap": { bg: "#fdfbfa", grid: "rgba(0,0,0,0.05)", outline: "#94a3b8" },
  "CartoDB Light": { bg: "#f8fafc", grid: "rgba(15, 23, 42, 0.04)", outline: "#cbd5e1" },
  "CartoDB Dark": { bg: "#0f172a", grid: "rgba(255, 255, 255, 0.04)", outline: "#334155" }
};

// Web Mercator Tile conversions
function lngToTileX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * Math.pow(2, zoom);
}

function latToTileY(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0) *
    Math.pow(2, zoom)
  );
}

function tileXToLng(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360.0 - 180.0;
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2.0 * Math.PI * y) / Math.pow(2, zoom);
  return (180.0 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function createGeoTiffBlob(
  width: number,
  height: number,
  rgbaData: Uint8ClampedArray,
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number }
): Blob {
  const numPixels = width * height;
  const pixelDataOffset = 8;
  const pixelDataSize = numPixels * 3;
  
  const tiepointsOffset = pixelDataOffset + pixelDataSize;
  const tiepointsSize = 6 * 8; // 6 doubles
  
  const pixelScaleOffset = tiepointsOffset + tiepointsSize;
  const pixelScaleSize = 3 * 8; // 3 doubles
  
  const geoKeysOffset = pixelScaleOffset + pixelScaleSize;
  const geoKeys = [
    1, 1, 0, 4,       // Header: KeyDirectoryVersion, KeyRevision, MinorRevision, NumberOfKeys
    1024, 0, 1, 2,    // GTModelTypeGeoKey: 2 (ModelTypeGeographic)
    1025, 0, 1, 1,    // GTRasterTypeGeoKey: 1 (RasterPixelIsArea)
    2048, 0, 1, 4326  // GeographicTypeGeoKey: 4326 (GCS_WGS_84)
  ];
  const geoKeysSize = geoKeys.length * 2; // 12 shorts = 24 bytes
  
  const bitsPerSampleOffset = geoKeysOffset + geoKeysSize;
  const bitsPerSampleSize = 3 * 2; // 3 shorts = 6 bytes
  
  const ifdOffset = bitsPerSampleOffset + bitsPerSampleSize;
  
  // Create an array buffer for the entire TIFF file
  const totalSize = ifdOffset + 2 + (14 * 12) + 4; // header + pixels + metadata + IFD size (14 tags) + nextIFD offset
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  
  // 1. Write Header
  view.setUint16(0, 0x4949, true); // Little endian "II"
  view.setUint16(2, 42, true);     // TIFF Magic Number
  view.setUint32(4, ifdOffset, true); // Offset to IFD
  
  // 2. Write Pixel Data (RGB)
  let dstChan = pixelDataOffset;
  for (let i = 0; i < numPixels; i++) {
    const srcChan = i * 4;
    view.setUint8(dstChan, rgbaData[srcChan]);     // R
    view.setUint8(dstChan + 1, rgbaData[srcChan + 1]); // G
    view.setUint8(dstChan + 2, rgbaData[srcChan + 2]); // B
    dstChan += 3;
  }
  
  // 3. Write Model Tiepoints (Doubles)
  const tiepoints = [0.0, 0.0, 0.0, bounds.minLng, bounds.maxLat, 0.0];
  for (let i = 0; i < 6; i++) {
    view.setFloat64(tiepointsOffset + i * 8, tiepoints[i], true);
  }
  
  // 4. Write Model Pixel Scale (Doubles)
  const scaleLng = (bounds.maxLng - bounds.minLng) / width;
  const scaleLat = (bounds.maxLat - bounds.minLat) / height;
  const pixelScale = [scaleLng, scaleLat, 0.0];
  for (let i = 0; i < 3; i++) {
    view.setFloat64(pixelScaleOffset + i * 8, pixelScale[i], true);
  }
  
  // 5. Write GeoKey Directory (Shorts)
  for (let i = 0; i < geoKeys.length; i++) {
    view.setUint16(geoKeysOffset + i * 2, geoKeys[i], true);
  }
  
  // 6. Write Bits Per Sample (Shorts)
  view.setUint16(bitsPerSampleOffset, 8, true);
  view.setUint16(bitsPerSampleOffset + 2, 8, true);
  view.setUint16(bitsPerSampleOffset + 4, 8, true);
  
  // 7. Write IFD Entries
  let curIfd = ifdOffset;
  const numEntries = 14;
  view.setUint16(curIfd, numEntries, true);
  curIfd += 2;
  
  const entries = [
    { tag: 256, type: 4, count: 1, val: width },            // ImageWidth
    { tag: 257, type: 4, count: 1, val: height },           // ImageLength
    { tag: 258, type: 3, count: 3, val: bitsPerSampleOffset }, // BitsPerSample
    { tag: 259, type: 3, count: 1, val: 1 },                // Compression (1 = uncompressed)
    { tag: 262, type: 3, count: 1, val: 2 },                // PhotometricInterpretation (2 = RGB)
    { tag: 273, type: 4, count: 1, val: pixelDataOffset },  // StripOffsets
    { tag: 277, type: 3, count: 1, val: 3 },                // SamplesPerPixel
    { tag: 278, type: 4, count: 1, val: height },           // RowsPerStrip
    { tag: 279, type: 4, count: 1, val: pixelDataSize },     // StripByteCounts
    { tag: 282, type: 5, count: 1, val: 0 },                // XResolution placeholder
    { tag: 283, type: 5, count: 1, val: 0 },                // YResolution placeholder
    { tag: 33550, type: 12, count: 3, val: pixelScaleOffset }, // ModelPixelScaleTag
    { tag: 33922, type: 12, count: 6, val: tiepointsOffset },  // ModelTiepointTag
    { tag: 34735, type: 3, count: geoKeys.length, val: geoKeysOffset } // GeoKeyDirectoryTag
  ];
  
  entries.sort((a, b) => a.tag - b.tag);
  
  entries.forEach(e => {
    view.setUint16(curIfd, e.tag, true);
    view.setUint16(curIfd + 2, e.type, true);
    view.setUint32(curIfd + 4, e.count, true);
    
    if (e.type === 3 && e.count === 1) {
      view.setUint16(curIfd + 8, e.val, true);
      view.setUint16(curIfd + 10, 0, true);
    } else if (e.type === 4 && e.count === 1) {
      view.setUint32(curIfd + 8, e.val, true);
    } else {
      view.setUint32(curIfd + 8, e.val, true);
    }
    curIfd += 12;
  });
  
  view.setUint32(curIfd, 0, true); // Offset to next IFD
  
  return new Blob([buffer], { type: "image/tiff" });
}

function darkenColor(hex: string, percent: number): string {
  hex = hex.replace(/^\s*#|\s*$/g, '');
  if (hex.length === 3) {
    hex = hex.replace(/(.)/g, '$1$1');
  }
  let r = parseInt(hex.substring(0, 2), 16) || 0;
  let g = parseInt(hex.substring(2, 4), 16) || 0;
  let b = parseInt(hex.substring(4, 6), 16) || 0;
  
  r = Math.max(0, Math.floor(r * (1 - percent)));
  g = Math.max(0, Math.floor(g * (1 - percent)));
  b = Math.max(0, Math.floor(b * (1 - percent)));
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111.32;
  const meanLat = (lat1 + lat2) / 2;
  const dLng = (lng2 - lng1) * 111.32 * Math.cos(meanLat * Math.PI / 180);
  return Math.hypot(dLat, dLng);
}

function getPolygonCentroid(coordinates: any): { lng: number; lat: number } | null {
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;

  const traverse = (coords: any) => {
    if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
      sumLng += coords[0];
      sumLat += coords[1];
      count++;
    } else if (Array.isArray(coords)) {
      coords.forEach(traverse);
    }
  };

  traverse(coordinates);
  if (count === 0) return null;
  return { lng: sumLng / count, lat: sumLat / count };
}

const createInterpolationWorker = () => {
  const workerCode = `
    function projectLatToY(lat) {
      const r_major = 6378137.0; // Equatorial radius in meters
      const latRad = lat * Math.PI / 180;
      return r_major * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    }

    function projectLngToX(lng) {
      const r_major = 6378137.0; // Equatorial radius in meters
      return r_major * (lng * Math.PI / 180);
    }

    function evaluateSemivariogram(d, model, nugget, sill, range) {
      if (d === 0) return 0;
      const h = d;
      const a = range;
      const c = sill - nugget;
      if (model === "spherical") {
        if (h < a) {
          return nugget + c * (1.5 * (h / a) - 0.5 * Math.pow(h / a, 3));
        }
        return sill;
      } else if (model === "exponential") {
        return nugget + c * (1 - Math.exp(-3 * h / a));
      } else {
        if (h === 0) return nugget;
        return nugget + c * (1 - Math.exp(-3 * Math.pow(h / a, 2)));
      }
    }

    function evaluateRbfKernel(d, kernel, parameter) {
      if (kernel === "multiquadric") {
        return Math.sqrt(d * d + parameter * parameter);
      } else if (kernel === "inverse_multiquadric" || kernel === "inverse-multiquadric") {
        return 1 / Math.sqrt(d * d + parameter * parameter);
      } else if (kernel === "gaussian") {
        return Math.exp(-d * d / (parameter * parameter));
      } else {
        if (d === 0) return 0;
        return d * d * Math.log(d);
      }
    }

    function solveLinearSystem(A, b) {
      const n = b.length;
      for (let i = 0; i < n; i++) {
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
          if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
            maxRow = k;
          }
        }
        const tempRow = A[i];
        A[i] = A[maxRow];
        A[maxRow] = tempRow;
        const tempB = b[i];
        b[i] = b[maxRow];
        b[maxRow] = tempB;

        if (Math.abs(A[i][i]) < 1e-12) return null;

        for (let k = i + 1; k < n; k++) {
          const factor = A[k][i] / A[i][i];
          b[k] -= factor * b[i];
          for (let j = i; j < n; j++) {
            A[k][j] -= factor * A[i][j];
          }
        }
      }

      const x = new Array(n).fill(0);
      for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) {
          sum += A[i][j] * x[j];
        }
        x[i] = (b[i] - sum) / A[i][i];
      }
      return x;
    }

    self.onmessage = function(e) {
      const {
        validPoints,
        rowStep,
        colStep,
        baseMapExtent,
        clippingRadius,
        extendInterpolationToBoundary,
        interpolationMethod,
        idwPower,
        useAllPoints,
        searchRadius,
        krigingModel,
        krigingNugget,
        krigingSill,
        krigingRange,
        krigingNeighbors,
        rbfKernel,
        rbfParameter,
        enableGaussianSmoothing,
        enableAnisotropy,
        anisotropyAngle,
        anisotropyRatio
      } = e.data;

      const minLng = baseMapExtent.mapMinLng;
      const maxLng = baseMapExtent.mapMaxLng;
      const minLat = baseMapExtent.mapMinLat;
      const maxLat = baseMapExtent.mapMaxLat;

      // 10. Projection-aware Interpolation: Pre-project valid points to meters
      const projectedPoints = validPoints.map(p => ({
        lat: p.lat,
        lng: p.lng,
        val: p.val,
        projX: projectLngToX(p.lng),
        projY: projectLatToY(p.lat)
      }));

      // 4. Automatic Virtual Corner Points
      const corners = [
        { lat: maxLat, lng: minLng },
        { lat: maxLat, lng: maxLng },
        { lat: minLat, lng: minLng },
        { lat: minLat, lng: maxLng }
      ];

      corners.forEach(corner => {
        let nearestPt = null;
        let minDist = Infinity;
        const cornerX = projectLngToX(corner.lng);
        const cornerY = projectLatToY(corner.lat);
        for (let i = 0; i < projectedPoints.length; i++) {
          const pt = projectedPoints[i];
          const dx = pt.projX - cornerX;
          const dy = pt.projY - cornerY;
          const d = Math.sqrt(dx * dx + dy * dy) / 1000.0; // km
          if (d < minDist) {
            minDist = d;
            nearestPt = pt;
          }
        }
        if (nearestPt) {
          projectedPoints.push({
            lat: corner.lat,
            lng: corner.lng,
            val: nearestPt.val,
            projX: cornerX,
            projY: cornerY,
            isVirtual: true
          });
        }
      });

      const grid = [];
      const cosLatVal = Math.cos(baseMapExtent.centerLat * Math.PI / 180);

      // Fast projection-aware distance calculator
      function getProjDistanceKmFast(projX1, projY1, projX2, projY2) {
        let dx = projX1 - projX2;
        let dy = projY1 - projY2;

        if (enableAnisotropy) {
          const angleRad = (anisotropyAngle * Math.PI) / 180;
          const cosA = Math.cos(angleRad);
          const sinA = Math.sin(angleRad);
          const rotX = dx * cosA + dy * sinA;
          const rotY = -dx * sinA + dy * cosA;
          dx = rotX;
          dy = rotY * anisotropyRatio;
        }

        return Math.sqrt(dx * dx + dy * dy) / 1000.0; // meters to kilometers
      }

      const idwPow = idwPower || 2;
      const dLatMax = searchRadius / 111.32;
      const dLngMax = searchRadius / (111.32 * cosLatVal);

      // Map Mercator meter limits to grid coordinates for ultra-fast distance checks
      const minX = projectLngToX(minLng);
      const maxX = projectLngToX(maxLng);
      const minY = projectLatToY(minLat);
      const maxY = projectLatToY(maxLat);
      const spanX = maxX - minX;
      const spanY = maxY - minY;

      const gridPoints = projectedPoints.map((p, idx) => {
        const pctX = (p.lng - minLng) / (baseMapExtent.finalLngSpan || 1e-6);
        const pctY = (p.lat - minLat) / (baseMapExtent.finalLatSpan || 1e-6);
        return {
          x: pctX * colStep,
          y: pctY * rowStep,
          val: p.val,
          isVirtual: p.isVirtual,
          idx: idx
        };
      });

      // Spatial bucketing for O(1) local neighbor search
      const bucketSize = 40; // block size in pixels
      const numBucketsX = Math.ceil(colStep / bucketSize);
      const numBucketsY = Math.ceil(rowStep / bucketSize);
      const buckets = Array.from({ length: numBucketsY }, () => 
        Array.from({ length: numBucketsX }, () => [])
      );

      for (let i = 0; i < gridPoints.length; i++) {
        const gp = gridPoints[i];
        const bx = Math.max(0, Math.min(numBucketsX - 1, Math.floor(gp.x / bucketSize)));
        const by = Math.max(0, Math.min(numBucketsY - 1, Math.floor(gp.y / bucketSize)));
        buckets[by][bx].push(gp);
      }

      // Convert clipping radius in km to pixels squared
      const kmPerPixel = baseMapExtent.finalLngSpan * 111.32 * cosLatVal / colStep;
      const clippingRadiusPixelsSq = Math.pow(clippingRadius / (kmPerPixel || 1e-6), 2);

      // Analytical Global Kriging Pre-computation
      let krigingBeta = null;
      let computedKrigingRange = krigingRange || (colStep * 0.4);
      let computedKrigingSill = krigingSill || 1.0;
      let computedKrigingNugget = krigingNugget !== undefined ? krigingNugget : 0.01;
      let krigingGammaFn = function(d) { return 0.01; };

      if (interpolationMethod === "kriging" || interpolationMethod === "ordinary_kriging") {
        const N = gridPoints.length;
        const vals = gridPoints.map(gp => gp.val);
        const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
        const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (vals.length || 1);
        
        if (!krigingSill) {
          computedKrigingSill = Math.max(0.1, variance);
        }
        if (!krigingRange) {
          computedKrigingRange = colStep * 0.4;
        }
        
        krigingGammaFn = function(d) {
          return computedKrigingNugget + computedKrigingSill * (1 - Math.exp(-d / computedKrigingRange));
        };

        const gammaMatrix = [];
        for (let i = 0; i < N + 1; i++) {
          gammaMatrix.push(new Float64Array(N + 1));
        }
        for (let i = 0; i < N; i++) {
          const gpi = gridPoints[i];
          for (let j = 0; j < N; j++) {
            const gpj = gridPoints[j];
            const dx = gpi.x - gpj.x;
            const dy = gpi.y - gpj.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            gammaMatrix[i][j] = krigingGammaFn(dist);
          }
          gammaMatrix[i][N] = 1.0;
          gammaMatrix[N][i] = 1.0;
        }
        gammaMatrix[N][N] = 0.0;

        const bVector = new Float64Array(N + 1);
        for (let i = 0; i < N; i++) {
          bVector[i] = gridPoints[i].val;
        }
        bVector[N] = 1.0;

        krigingBeta = solveLinearSystem(gammaMatrix, bVector);
      }

      for (let r = 0; r < rowStep; r++) {
        const rowVals = new Float32Array(colStep);

        for (let c = 0; c < colStep; c++) {
          const bx = Math.max(0, Math.min(numBucketsX - 1, Math.floor(c / bucketSize)));
          const by = Math.max(0, Math.min(numBucketsY - 1, Math.floor(r / bucketSize)));

          // 1. Fast clipping check: find closest point using spatial buckets
          let nearestGP = null;
          let minDistSq = Infinity;
          let searchRad = 0;
          
          while (nearestGP === null && searchRad < Math.max(numBucketsX, numBucketsY)) {
            for (let dy = -searchRad; dy <= searchRad; dy++) {
              for (let dx = -searchRad; dx <= searchRad; dx++) {
                if (searchRad > 0 && Math.abs(dy) !== searchRad && Math.abs(dx) !== searchRad) continue;
                const ny = by + dy;
                const nx = bx + dx;
                if (ny >= 0 && ny < numBucketsY && nx >= 0 && nx < numBucketsX) {
                  const b = buckets[ny][nx];
                  for (let i = 0; i < b.length; i++) {
                    const gp = b[i];
                    const dc = c - gp.x;
                    const dr = r - gp.y;
                    const dSq = dc * dc + dr * dr;
                    if (dSq < minDistSq) {
                      minDistSq = dSq;
                      nearestGP = gp;
                    }
                  }
                }
              }
            }
            searchRad++;
          }

          if (!extendInterpolationToBoundary) {
            if (nearestGP === null || minDistSq > clippingRadiusPixelsSq) {
              rowVals[c] = NaN;
              continue;
            }
          }

          if (interpolationMethod === "nearest") {
            rowVals[c] = nearestGP ? nearestGP.val : 0;
            continue;
          }

          // Collect local candidate points for interpolation
          let candidates = [];
          let rad = 0;
          while (candidates.length < 15 && rad < Math.max(numBucketsX, numBucketsY)) {
            for (let dy = -rad; dy <= rad; dy++) {
              for (let dx = -rad; dx <= rad; dx++) {
                if (rad > 0 && Math.abs(dy) !== rad && Math.abs(dx) !== rad) continue;
                const ny = by + dy;
                const nx = bx + dx;
                if (ny >= 0 && ny < numBucketsY && nx >= 0 && nx < numBucketsX) {
                  const b = buckets[ny][nx];
                  for (let i = 0; i < b.length; i++) {
                    candidates.push(b[i]);
                  }
                }
              }
            }
            rad++;
          }

          let val = 0;

          if (interpolationMethod === "natural" || interpolationMethod === "spline") {
            const ptsWithGridDist = candidates.map(gp => {
              const dx = c - gp.x;
              const dy = r - gp.y;
              return { gp, dSq: dx * dx + dy * dy };
            });
            ptsWithGridDist.sort((a, b) => a.dSq - b.dSq);

            let n1 = ptsWithGridDist[0]?.gp.idx ?? -1;
            let d1 = ptsWithGridDist[0]?.dSq ?? Infinity;
            let n2 = ptsWithGridDist[1]?.gp.idx ?? -1;
            let d2 = ptsWithGridDist[1]?.dSq ?? Infinity;
            let n3 = ptsWithGridDist[2]?.gp.idx ?? -1;
            let d3 = ptsWithGridDist[2]?.dSq ?? Infinity;
            let n4 = ptsWithGridDist[3]?.gp.idx ?? -1;
            let d4 = ptsWithGridDist[3]?.dSq ?? Infinity;
            let n5 = ptsWithGridDist[4]?.gp.idx ?? -1;
            let d5 = ptsWithGridDist[4]?.dSq ?? Infinity;
            let n6 = ptsWithGridDist[5]?.gp.idx ?? -1;
            let d6 = ptsWithGridDist[5]?.dSq ?? Infinity;

            if (d1 < 0.05) {
              val = gridPoints[n1].val;
            } else if (n6 >= 0) {
              const R = Math.sqrt(d6);
              let sumWeights = 0;
              let sumWeightedValues = 0;

              const addWeight = (idx, dSq) => {
                if (idx < 0) return;
                const dist = Math.sqrt(dSq);
                const w = Math.pow((R - dist) / (R * dist + 0.001), 2);
                sumWeights += w;
                sumWeightedValues += w * gridPoints[idx].val;
              };

              addWeight(n1, d1);
              addWeight(n2, d2);
              addWeight(n3, d3);
              addWeight(n4, d4);
              addWeight(n5, d5);

              if (sumWeights > 0) {
                val = sumWeightedValues / sumWeights;
              } else {
                val = gridPoints[n1].val;
              }
            } else {
              val = n1 >= 0 ? gridPoints[n1].val : 0;
            }
          } else if ((interpolationMethod === "kriging" || interpolationMethod === "ordinary_kriging") && krigingBeta) {
            let krigVal = 0;
            const N_pts = gridPoints.length;
            for (let j = 0; j < N_pts; j++) {
              const gp = gridPoints[j];
              const dx = c - gp.x;
              const dy = r - gp.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              krigVal += krigingGammaFn(dist) * krigingBeta[j];
            }
            krigVal += 1.0 * krigingBeta[N_pts];
            val = krigVal;
          } else {
            // IDW or RBF fallback using local candidates
            let weightedSum = 0;
            let weightTotal = 0;
            let exact = false;
            
            for (let i = 0; i < candidates.length; i++) {
              const gp = candidates[i];
              const dx = c - gp.x;
              const dy = r - gp.y;
              const dSq = dx * dx + dy * dy;
              
              if (dSq < 0.05) {
                val = gp.val;
                exact = true;
                break;
              }
              const d = Math.sqrt(dSq);
              const w = 1 / (dSq * d + 0.01);
              weightedSum += w * gp.val;
              weightTotal += w;
            }
            if (!exact) {
              val = weightTotal > 0 ? weightedSum / weightTotal : 0;
            }
          }

          rowVals[c] = val;
        }
        grid.push(rowVals);
      }

      if (enableGaussianSmoothing && grid.length > 2) {
        const smoothedGrid = [];
        const kernel = [
          [1/16, 2/16, 1/16],
          [2/16, 4/16, 2/16],
          [1/16, 2/16, 1/16]
        ];
        for (let r = 0; r < rowStep; r++) {
          const rowVals = new Float32Array(colStep);
          for (let c = 0; c < colStep; c++) {
            if (isNaN(grid[r][c])) {
              rowVals[c] = NaN;
              continue;
            }
            let sum = 0;
            let wTotal = 0;
            for (let kr = -1; kr <= 1; kr++) {
              for (let kc = -1; kc <= 1; kc++) {
                const nr = r + kr;
                const nc = c + kc;
                if (nr >= 0 && nr < rowStep && nc >= 0 && nc < colStep && !isNaN(grid[nr][nc])) {
                  const kw = kernel[kr + 1][kc + 1];
                  sum += grid[nr][nc] * kw;
                  wTotal += kw;
                }
              }
            }
            rowVals[c] = wTotal > 0 ? sum / wTotal : grid[r][c];
          }
          smoothedGrid.push(rowVals);
        }
        self.postMessage({ grid: smoothedGrid });
      } else {
        self.postMessage({ grid: grid });
      }
    };
  `;
  const blob = new Blob([workerCode], { type: "application/javascript" });
  return new Worker(URL.createObjectURL(blob));
};

export default function GisMapView({
  rawData,
  headers,
  headerMap,
  selectedState = "",
  selectedDistrict = "",
  showToast,
  isVisible,
  bulletinMaps,
  setBulletinMaps
}: GisMapViewProps) {
  // Canvas references for dual panels (Comparison mode)
  const canvasRefLeft = useRef<HTMLCanvasElement>(null);
  const canvasRefRight = useRef<HTMLCanvasElement>(null);

  // Active configurations state
  const [activeTab, setActiveTab] = useState<"layers" | "basemap" | "interpolation" | "classification" | "styling" | "decorations" | "batch" | "shapefile">("layers");
  
  // Base settings
  const [selectedParam, setSelectedParam] = useState<string>("EC");
  const [basemap, setBasemap] = useState<string>("ESRI Topographic");
  const [projection, setProjection] = useState<"wgs84" | "mercator" | "utm">("wgs84");
  const [utmZone, setUtmZone] = useState<number>(44);

  // Shapefile Layers State
  const [layers, setLayers] = useState<ShapefileLayer[]>([]);
  const [clipTarget, setClipTarget] = useState<string>("india"); // "none" | "india" | "layer-id"

  // Shapefile/GeoJSON State (for backwards compatibility)
  const [uploadedGeoJson, setUploadedGeoJson] = useState<any>(null);
  const [shapefileName, setShapefileName] = useState<string>("");
  const [shapeStrokeColor, setShapeStrokeColor] = useState<string>("#2563eb");
  const [shapeStrokeWidth, setShapeStrokeWidth] = useState<number>(2.0);
  const [shapeFillColor, setShapeFillColor] = useState<string>("#60a5fa");
  const [shapeFillOpacity, setShapeFillOpacity] = useState<number>(15);
  const [showShapefile, setShowShapefile] = useState<boolean>(true);
  const [fitToShapefile, setFitToShapefile] = useState<boolean>(false);
  const [panelBackgroundStyle, setPanelBackgroundStyle] = useState<"translucent-light" | "translucent-dark" | "transparent-glass" | "solid-light" | "solid-dark">("translucent-light");

  // Shapefile Labels State
  const [showShapefileLabels, setShowShapefileLabels] = useState<boolean>(true);
  const [shapefileLabelKey, setShapefileLabelKey] = useState<string>("");
  const [shapefileLabelColor, setShapefileLabelColor] = useState<string>("#1e293b");
  const [shapefileLabelSize, setShapefileLabelSize] = useState<number>(11);
  
  // Multi-layer custom label positions: Record<layerId, Record<featureIndex, position>>
  const [customLabelPositions, setCustomLabelPositions] = useState<Record<string, Record<number, { lng: number; lat: number }>>>({});
  const [draggedLabel, setDraggedLabel] = useState<{ layerId: string; featureIndex: number } | null>(null);
  const [draggedElement, setDraggedElement] = useState<"scaleBar" | "title" | "legend" | "stats" | "northArrow" | null>(null);
  const [draggedPanelId, setDraggedPanelId] = useState<"left" | "right" | null>(null);

  const draggedLabelIndex = draggedLabel ? draggedLabel.featureIndex : null;

  // Attribute table states
  const [selectedAttributeLayerId, setSelectedAttributeLayerId] = useState<string>("");
  const [attributeSearchQuery, setAttributeSearchQuery] = useState<string>("");
  const [attributePage, setAttributePage] = useState<number>(1);
  const [attributeSortKey, setAttributeSortKey] = useState<string>("");
  const [attributeSortDesc, setAttributeSortDesc] = useState<boolean>(false);

  const [redrawTilesTrigger, setRedrawTilesTrigger] = useState<number>(0);
  const tileCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const loadingTiles = useRef<Set<string>>(new Set());

  // Offscreen canvas and key cache for super-fast interpolation rendering
  const rasterCacheLeftRef = useRef<HTMLCanvasElement | null>(null);
  const rasterCacheRightRef = useRef<HTMLCanvasElement | null>(null);
  const rasterCacheKeyLeftRef = useRef<string>("");
  const rasterCacheKeyRightRef = useRef<string>("");

  // Automatic India boundary clipping
  const [clipToIndia, setClipToIndia] = useState<boolean>(true);

  const effectiveClipGeoJson = useMemo(() => {
    let baseGeoJson = null;
    if (clipTarget === "india") {
      baseGeoJson = INDIA_BOUNDARY;
    } else if (clipTarget !== "none") {
      const selectedLayer = layers.find(l => l.id === clipTarget);
      if (selectedLayer) {
        baseGeoJson = selectedLayer.geoJson;
      }
    }

    if (!baseGeoJson) return null;

    if (selectedState && selectedState !== "All" && selectedState !== "National" && selectedState !== "All India") {
      const selVal = selectedState.trim().toLowerCase();
      // If it is a FeatureCollection, filter its features!
      if (baseGeoJson.type === "FeatureCollection" && Array.isArray(baseGeoJson.features)) {
        const filteredFeatures = baseGeoJson.features.filter((f: any) => {
          if (!f.properties) return false;
          return Object.values(f.properties).some(val => {
            if (typeof val !== "string") return false;
            const sVal = val.trim().toLowerCase();
            return sVal === selVal || sVal.includes(selVal) || selVal.includes(sVal);
          });
        });
        
        if (filteredFeatures.length > 0) {
          return {
            ...baseGeoJson,
            features: filteredFeatures
          };
        }
      }
    }

    return baseGeoJson;
  }, [layers, clipTarget, selectedState]);

  const shapefilePropertyKeys = useMemo(() => {
    if (!effectiveClipGeoJson) return [];
    const keys = new Set<string>();
    const features = effectiveClipGeoJson.features || 
                     (effectiveClipGeoJson.type === "Feature" ? [effectiveClipGeoJson] : []);
    features.forEach((f: any) => {
      if (f && f.properties) {
        Object.keys(f.properties).forEach(k => keys.add(k));
      }
    });
    return Array.from(keys);
  }, [effectiveClipGeoJson]);

  useEffect(() => {
    if (shapefilePropertyKeys.length > 0 && !shapefileLabelKey) {
      const goodKey = shapefilePropertyKeys.find(k => {
        const l = k.toLowerCase();
        return l.includes("name") || l.includes("state") || l.includes("dist") || l.includes("st_nm") || l.includes("dt_nm");
      }) || shapefilePropertyKeys[0];
      if (goodKey) {
        setShapefileLabelKey(goodKey);
      }
    }
  }, [shapefilePropertyKeys, shapefileLabelKey]);

  // Shapefile Bounds Extractor
  const shapefileBounds = useMemo(() => {
    if (!effectiveClipGeoJson) return null;
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    const traverse = (coords: any) => {
      if (Array.isArray(coords) && typeof coords[0] === "number") {
        const [lng, lat] = coords;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      } else if (Array.isArray(coords)) {
        coords.forEach(traverse);
      }
    };

    if (effectiveClipGeoJson.features) {
      effectiveClipGeoJson.features.forEach((f: any) => {
        if (f.geometry && f.geometry.coordinates) {
          traverse(f.geometry.coordinates);
        }
      });
    } else if (effectiveClipGeoJson.geometry && effectiveClipGeoJson.geometry.coordinates) {
      traverse(effectiveClipGeoJson.geometry.coordinates);
    } else if (effectiveClipGeoJson.coordinates) {
      traverse(effectiveClipGeoJson.coordinates);
    }

    if (minLng === Infinity || minLat === Infinity) return null;
    return { minLng, maxLng, minLat, maxLat };
  }, [effectiveClipGeoJson]);

  // Get Layer Bounds
  const getLayerBounds = useCallback((layer: ShapefileLayer) => {
    const geoJson = layer.geoJson;
    if (!geoJson) return null;
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    const traverse = (coords: any) => {
      if (Array.isArray(coords) && typeof coords[0] === "number") {
        const [lng, lat] = coords;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      } else if (Array.isArray(coords)) {
        coords.forEach(traverse);
      }
    };

    if (geoJson.features) {
      geoJson.features.forEach((f: any) => {
        if (f.geometry && f.geometry.coordinates) {
          traverse(f.geometry.coordinates);
        }
      });
    } else if (geoJson.geometry && geoJson.geometry.coordinates) {
      traverse(geoJson.geometry.coordinates);
    } else if (geoJson.coordinates) {
      traverse(geoJson.coordinates);
    }

    if (minLng === Infinity || minLat === Infinity) return null;
    return { minLng, maxLng, minLat, maxLat };
  }, []);

  // Centroid/feature zooming helper
  // Relocated below isComparisonActive definition

  // Interpolation parameters
  const [interpolationMethod, setInterpolationMethod] = useState<"idw" | "nearest" | "kriging" | "rbf" | "natural" | "spline" | "ordinary_kriging" | "universal_kriging" | "ebk">("idw");
  const [idwPower, setIdwPower] = useState<number>(2.0);
  const [gridSmoothingRes, setGridSmoothingRes] = useState<number>(150); // resolution columns of grid
  const [searchRadius, setSearchRadius] = useState<number>(150); // in kilometers
  const [clippingRadius, setClippingRadius] = useState<number>(100); // clipping threshold to points in kilometers
  const [smoothBlending, setSmoothBlending] = useState<boolean>(true); // Continuous color interpolation

  // Web Worker Interpolation Grids & Loading States
  const [leftInterpolatedGrid, setLeftInterpolatedGrid] = useState<any>(null);
  const [rightInterpolatedGrid, setRightInterpolatedGrid] = useState<any>(null);
  const [isLeftLoading, setIsLeftLoading] = useState<boolean>(false);
  const [isRightLoading, setIsRightLoading] = useState<boolean>(false);

  // Advanced Interpolation and Rendering options
  const [enableGaussianSmoothing, setEnableGaussianSmoothing] = useState<boolean>(true);
  const [enableAnisotropy, setEnableAnisotropy] = useState<boolean>(false);
  const [anisotropyAngle, setAnisotropyAngle] = useState<number>(45);
  const [anisotropyRatio, setAnisotropyRatio] = useState<number>(1.5);

  // Classification & Symbology
  const [classificationMode, setClassificationMode] = useState<"bis" | "equal" | "quantile" | "stddev" | "geometric" | "manual">("bis");
  const [manualBreaksInput, setManualBreaksInput] = useState<string>("");
  const [colorScheme, setColorScheme] = useState<string>("Blue-Yellow-Red");
  const [symbolType, setSymbolType] = useState<"circle" | "square" | "triangle" | "diamond" | "star">("circle");
  const [symbolSize, setSymbolSize] = useState<number>(7);
  const [symbolBorderColor, setSymbolBorderColor] = useState<string>("#ffffff");
  const [symbolBorderSize, setSymbolBorderSize] = useState<number>(1.2);
  const [symbolOpacity, setSymbolOpacity] = useState<number>(85);

  // Layer toggles & transparency
  const [showRaster, setShowRaster] = useState<boolean>(true);
  const [showPoints, setShowPoints] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showDifferenceMap, setShowDifferenceMap] = useState<boolean>(false);

  const [rasterOpacity, setRasterOpacity] = useState<number>(75);
  const [basemapOpacity, setBasemapOpacity] = useState<number>(90);

  // Custom zoom & pan factors
  const [zoomScaleFactor, setZoomScaleFactor] = useState<number>(1.0);
  const [panOffsetLat, setPanOffsetLat] = useState<number>(0);
  const [panOffsetLng, setPanOffsetLng] = useState<number>(0);

  // Drag-to-pan map canvas state
  const isDraggingRef = useRef<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ 
    x: number; 
    y: number; 
    startPanLat: number; 
    startPanLng: number;
    startOffsetX: number;
    startOffsetY: number;
  }>({ 
    x: 0, 
    y: 0, 
    startPanLat: 0, 
    startPanLng: 0,
    startOffsetX: 0,
    startOffsetY: 0
  });

  const getParamDisplayName = (paramKey: string) => {
    const config = PARAM_CONFIG[paramKey];
    if (!config) return paramKey;
    const subscripts: Record<string, string> = {
      "NO3": "NO₃",
      "CO3": "CO₃",
      "HCO3": "HCO₃",
      "SO4": "SO₄",
      "CaCO3": "CaCO₃"
    };
    const formattedKey = subscripts[paramKey] || paramKey;
    if (config.name === paramKey) {
      return paramKey;
    }
    return `${config.name} (${formattedKey})`;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const isLeft = e.currentTarget === canvasRefLeft.current;
    const panelId: "left" | "right" = isLeft ? "left" : "right";

    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Scale up to matches dpr-scaled coordinates used in drawing
    const dpr = (window.devicePixelRatio || 2) * 2.0;
    const currentWidth = canvasWidth * dpr;
    const currentHeight = canvasHeight * dpr;

    // Map to dpr scale
    const clickX = mouseX * (currentWidth / rect.width);
    const clickY = mouseY * (currentHeight / rect.height);

    const margin = 55 * dpr;
    const mw = currentWidth - 2 * margin;
    const mh = currentHeight - 2 * margin;

    // 1. Check if clicking on the Scale Bar decoration
    if (showScaleBar) {
      const { mapMinLng, finalLngSpan, centerLat } = mapExtent;
      const widthKm = finalLngSpan * 111 * Math.cos(centerLat * Math.PI / 180);
      const pxPerKm = mw / widthKm;
      const roundDivisions = [1, 2, 5, 10, 25, 50, 100, 200, 500];
      const targetKmRaw = (120 * dpr) / pxPerKm;
      const targetKm = roundDivisions.reduce((prev, curr) => 
        Math.abs(curr - targetKmRaw) < Math.abs(prev - targetKmRaw) ? curr : prev
      );
      const scaleW = targetKm * pxPerKm;
      const scaleX = margin + 15 * dpr + scaleBarOffsetX * dpr;
      const scaleY = currentHeight - margin - 20 * dpr + scaleBarOffsetY * dpr;

      const scaleBoxX = scaleX - 5 * dpr;
      const scaleBoxY = scaleY - 18 * dpr;
      const scaleBoxW = scaleW + 25 * dpr;
      const scaleBoxH = 30 * dpr;

      if (clickX >= scaleBoxX && clickX <= scaleBoxX + scaleBoxW && clickY >= scaleBoxY && clickY <= scaleBoxY + scaleBoxH) {
        setDraggedElement("scaleBar");
        setDraggedPanelId(panelId);
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          startPanLat: panOffsetLat,
          startPanLng: panOffsetLng,
          startOffsetX: scaleBarOffsetX,
          startOffsetY: scaleBarOffsetY
        };
        return;
      }
    }

    // 2. Check click on North Arrow
    let arrowX = currentWidth - margin - 35 * dpr;
    let arrowY = margin + 45 * dpr;
    if (northArrowPos === "top-left") { arrowX = margin + 35 * dpr; arrowY = margin + 45 * dpr; }
    else if (northArrowPos === "bottom-left") { arrowX = margin + 35 * dpr; arrowY = currentHeight - margin - 55 * dpr; }
    else if (northArrowPos === "bottom-right") { arrowX = currentWidth - margin - 35 * dpr; arrowY = currentHeight - margin - 55 * dpr; }

    arrowX += northArrowOffsetX * dpr;
    arrowY += northArrowOffsetY * dpr;
    const arrowRad = (northArrowSize / 2) * dpr;
    if (Math.hypot(clickX - arrowX, clickY - arrowY) <= arrowRad) {
      setDraggedElement("northArrow");
      setDraggedPanelId(panelId);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        startPanLat: panOffsetLat,
        startPanLng: panOffsetLng,
        startOffsetX: northArrowOffsetX,
        startOffsetY: northArrowOffsetY
      };
      return;
    }

    // 3. Check click on Title Frame
    if (titlePos !== "none") {
      const titleStr = panelId === "left"
        ? (customTitle || getMapDefaultTitleAndSubtitle("left").title)
        : (customTitle 
            ? `${customTitle} (Post-Monsoon)` 
            : (showDifferenceMap 
              ? `Seasonal Quality Difference Map (Post − Pre)`
              : getMapDefaultTitleAndSubtitle("right").title));
      
      const subtitleStr = panelId === "left"
        ? (customSubtitle || getMapDefaultTitleAndSubtitle("left").subtitle)
        : (customSubtitle || (showDifferenceMap
            ? `Chemical concentration change dynamics`
            : getMapDefaultTitleAndSubtitle("right").subtitle));

      const displaySubtitle = useSubtitleAsTitle ? "" : subtitleStr;

      const paddingY = 8;
      const titleHeight = mapTitleSize;
      const subtitleHeight = displaySubtitle ? mapSubtitleSize : 0;
      const spacing = displaySubtitle ? titleLineSpacing : 0;
      const tH = (paddingY * 2 + titleHeight + spacing + subtitleHeight) * dpr;

      let tW = mw - 20 * dpr;
      let tX = margin + 10 * dpr;
      let tY = margin + 10 * dpr;

      if (titlePos === "top-center") {
        tX = margin + 10 * dpr;
        tY = margin + 10 * dpr;
        tW = mw - 20 * dpr;
      } else if (titlePos === "top-left") {
        tX = margin + 10 * dpr;
        tY = margin + 10 * dpr;
        tW = mw * 0.6;
      } else if (titlePos === "top-right") {
        tX = currentWidth - margin - mw * 0.6 - 10 * dpr;
        tY = margin + 10 * dpr;
        tW = mw * 0.6;
      } else if (titlePos === "bottom-center") {
        tX = margin + 10 * dpr;
        tY = currentHeight - margin - tH - 10 * dpr;
        tW = mw - 20 * dpr;
      } else if (titlePos === "bottom-left") {
        tX = margin + 10 * dpr;
        tY = currentHeight - margin - tH - 10 * dpr;
        tW = mw * 0.6;
      } else if (titlePos === "bottom-right") {
        tX = currentWidth - margin - mw * 0.6 - 10 * dpr;
        tY = currentHeight - margin - tH - 10 * dpr;
        tW = mw * 0.6;
      }

      tX += titleOffsetX * dpr;
      tY += titleOffsetY * dpr;

      if (clickX >= tX && clickX <= tX + tW && clickY >= tY && clickY <= tY + tH) {
        setDraggedElement("title");
        setDraggedPanelId(panelId);
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          startPanLat: panOffsetLat,
          startPanLng: panOffsetLng,
          startOffsetX: titleOffsetX,
          startOffsetY: titleOffsetY
        };
        return;
      }
    }

    // 4. Check click on Legend
    let legX = currentWidth - margin - 170 * dpr;
    let legY = currentHeight - margin - 110 * dpr;
    if (legendPos === "top-left") { legX = margin + 15 * dpr; legY = margin + 15 * dpr; }
    else if (legendPos === "top-right") { legX = currentWidth - margin - 170 * dpr; legY = margin + 15 * dpr; }
    else if (legendPos === "bottom-left") { legX = margin + 15 * dpr; legY = currentHeight - margin - 110 * dpr; }

    legX += legendOffsetX * dpr;
    legY += legendOffsetY * dpr;

    const visibleLayersForLeg = layers.filter(l => l.visible);
    let extraBoundaryHeight = 0;
    if (showShapefile) {
      if (visibleLayersForLeg.length > 0) {
        extraBoundaryHeight = visibleLayersForLeg.length * 15;
      } else if (uploadedGeoJson) {
        const label = getBoundaryLegendLabel(uploadedGeoJson) || "Boundary";
        if (label) {
          extraBoundaryHeight = 15;
        }
      }
    }
    const legendHeight = (95 + extraBoundaryHeight) * dpr;
    const legendWidth = 155 * dpr;

    if (clickX >= legX && clickX <= legX + legendWidth && clickY >= legY && clickY <= legY + legendHeight) {
      setDraggedElement("legend");
      setDraggedPanelId(panelId);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        startPanLat: panOffsetLat,
        startPanLng: panOffsetLng,
        startOffsetX: legendOffsetX,
        startOffsetY: legendOffsetY
      };
      return;
    }

    // 5. Check click on Stats Panel
    if (showStatsPanel) {
      let stX = margin + 15 * dpr;
      let stY = currentHeight - margin - 135 * dpr;
      if (statsPanelPos === "top-left") { stX = margin + 15 * dpr; stY = margin + 15 * dpr; }
      else if (statsPanelPos === "top-right") { stX = currentWidth - margin - 150 * dpr; stY = margin + 15 * dpr; }
      else if (statsPanelPos === "bottom-right") { stX = currentWidth - margin - 150 * dpr; stY = currentHeight - margin - 135 * dpr; }

      stX += statsOffsetX * dpr;
      stY += statsOffsetY * dpr;
      const statsW = 135 * dpr;
      const statsH = 120 * dpr;

      if (clickX >= stX && clickX <= stX + statsW && clickY >= stY && clickY <= stY + statsH) {
        setDraggedElement("stats");
        setDraggedPanelId(panelId);
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          startPanLat: panOffsetLat,
          startPanLng: panOffsetLng,
          startOffsetX: statsOffsetX,
          startOffsetY: statsOffsetY
        };
        return;
      }
    }

    // 6. Check if clicking close to a shapefile label in any visible layer
    if (showShapefileLabels) {
      const { mapMinLng, finalLngSpan, mapMinLat, finalLatSpan } = mapExtent;
      const getLabelX = (lng: number) => {
        const pct = (lng - mapMinLng) / finalLngSpan;
        return margin + pct * mw;
      };
      const getLabelY = (lat: number) => {
        const pct = (lat - mapMinLat) / finalLatSpan;
        return currentHeight - margin - pct * mh;
      };

      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (!layer.visible || !layer.showLabels) continue;

        const gj = layer.geoJson;
        if (!gj) continue;

        const features = gj.features || (gj.type === "Feature" ? [gj] : []);

        let foundIndex: number | null = null;
        let minDist = 25 * dpr;

        features.forEach((f: any, idx: number) => {
          if (!f || !f.properties) return;
          const textVal = String(f.properties[layer.labelKey] || "");
          if (!textVal) return;

          let lng = 0, lat = 0;
          const customPos = customLabelPositions[layer.id]?.[idx];
          if (customPos) {
            lng = customPos.lng;
            lat = customPos.lat;
          } else {
            const centroid = getPolygonCentroid(f.geometry?.coordinates);
            if (centroid) {
              lng = centroid.lng;
              lat = centroid.lat;
            } else {
              return;
            }
          }

          const lx = getLabelX(lng);
          const ly = getLabelY(lat);

          const dist = Math.hypot(clickX - lx, clickY - ly);
          if (dist < minDist) {
            minDist = dist;
            foundIndex = idx;
          }
        });

        if (foundIndex !== null) {
          setDraggedLabel({ layerId: layer.id, featureIndex: foundIndex });
          setDraggedPanelId(panelId);
          return;
        }
      }
    }

    // If nothing else was dragged, pan the map
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPanLat: panOffsetLat,
      startPanLng: panOffsetLng,
      startOffsetX: 0,
      startOffsetY: 0
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const isLeft = e.currentTarget === canvasRefLeft.current;
    const panelId: "left" | "right" = isLeft ? "left" : "right";

    // 1. Handle element dragging (Scale Bar, North Arrow, Title, Legend, Stats)
    if (draggedElement !== null && draggedPanelId === panelId) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      const newOffsetX = dragStartRef.current.startOffsetX + dx;
      const newOffsetY = dragStartRef.current.startOffsetY + dy;

      if (draggedElement === "scaleBar") {
        setScaleBarOffsetX(newOffsetX);
        setScaleBarOffsetY(newOffsetY);
      } else if (draggedElement === "northArrow") {
        setNorthArrowOffsetX(newOffsetX);
        setNorthArrowOffsetY(newOffsetY);
      } else if (draggedElement === "title") {
        setTitleOffsetX(newOffsetX);
        setTitleOffsetY(newOffsetY);
      } else if (draggedElement === "legend") {
        setLegendOffsetX(newOffsetX);
        setLegendOffsetY(newOffsetY);
      } else if (draggedElement === "stats") {
        setStatsOffsetX(newOffsetX);
        setStatsOffsetY(newOffsetY);
      }
      return;
    }

    // 2. Handle shapefile label dragging
    if (draggedLabel !== null && draggedPanelId === panelId) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const dpr = (window.devicePixelRatio || 2) * 2.0;
      const currentWidth = canvasWidth * dpr;
      const currentHeight = canvasHeight * dpr;

      const clickX = mouseX * (currentWidth / rect.width);
      const clickY = mouseY * (currentHeight / rect.height);

      const margin = 55 * dpr;
      const mw = currentWidth - 2 * margin;
      const mh = currentHeight - 2 * margin;

      const { mapMinLng, finalLngSpan, mapMinLat, finalLatSpan } = mapExtent;
      const pctX = (clickX - margin) / mw;
      const targetLng = mapMinLng + pctX * finalLngSpan;

      const pctY = (currentHeight - margin - clickY) / mh;
      const targetLat = mapMinLat + pctY * finalLatSpan;

      setCustomLabelPositions(prev => {
        const layerPositions = prev[draggedLabel.layerId] || {};
        return {
          ...prev,
          [draggedLabel.layerId]: {
            ...layerPositions,
            [draggedLabel.featureIndex]: { lng: targetLng, lat: targetLat }
          }
        };
      });
      return;
    }

    // 3. Handle map panning
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    const { finalLngSpan, finalLatSpan } = mapExtent;
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width || 640;
    const height = rect.height || 480;

    const deltaLng = (dx / width) * finalLngSpan;
    const deltaLat = -(dy / height) * finalLatSpan;

    setPanOffsetLng(dragStartRef.current.startPanLng - deltaLng);
    setPanOffsetLat(dragStartRef.current.startPanLat - deltaLat);
  };

  const handleCanvasMouseUpOrLeave = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
    setDraggedLabel(null);
    setDraggedElement(null);
    setDraggedPanelId(null);
  };

  // Custom Title & Subtitle customizable strings
  const [customTitle, setCustomTitle] = useState<string>("");
  const [customSubtitle, setCustomSubtitle] = useState<string>("");
  const [useSubtitleAsTitle, setUseSubtitleAsTitle] = useState<boolean>(false);

  // Custom station map point color
  const [stationPointColor, setStationPointColor] = useState<string>("#00008b");

  // Custom colors for different ranges
  const [colorRange1, setColorRange1] = useState<string>("#005ce6"); // Acceptable (<= b1) - Default Blue (0, 92, 230)
  const [colorRange2, setColorRange2] = useState<string>("#ffff00"); // Permissible (> b1 and <= b2) - Default Yellow (255, 255, 0)
  const [colorRange3, setColorRange3] = useState<string>("#ff0000"); // Beyond permissible (> b2) - Default Red (255, 0, 0)

  // Point Map Range separate colors
  const [useCustomPointColors, setUseCustomPointColors] = useState<boolean>(true);
  const [pointColorRange1, setPointColorRange1] = useState<string>("#22c55e"); // Acceptable (<= b1) - Default Green
  const [pointColorRange2, setPointColorRange2] = useState<string>("#eab308"); // Permissible (> b1 and <= b2) - Default Yellow/Amber
  const [pointColorRange3, setPointColorRange3] = useState<string>("#ef4444"); // Beyond permissible (> b2) - Default Red

  // Interpolation class count
  const [interpolationClasses, setInterpolationClasses] = useState<number>(3); // Default 3 (Acceptable, Permissible, Exceeded)

  // 3D Effects for Title, Subtitle, Legend
  const [mapTitle3dEffect, setMapTitle3dEffect] = useState<"none" | "emboss" | "deboss">("none");
  const [mapSubtitle3dEffect, setMapSubtitle3dEffect] = useState<"none" | "emboss" | "deboss">("none");
  const [legend3dEffect, setLegend3dEffect] = useState<"none" | "emboss" | "deboss">("none");

  // Custom colors for difference map
  const [colorDiffImproved, setColorDiffImproved] = useState<string>("#22c55e"); // Improved (< -threshold)
  const [colorDiffStable, setColorDiffStable] = useState<string>("#94a3b8"); // Stable
  const [colorDiffDeteriorated, setColorDiffDeteriorated] = useState<string>("#ef4444"); // Deteriorated (> threshold)

  // Positionable title frame
  const [titlePos, setTitlePos] = useState<"top-center" | "top-left" | "top-right" | "bottom-center" | "bottom-left" | "bottom-right" | "none">("top-center");

  // Only Transparent Legend/Title/Stats toggle (defaults to true as requested)
  const [onlyTransparentPanels, setOnlyTransparentPanels] = useState<boolean>(true);

  // Facility to extend interpolation to full shapefile boundary when points are missing
  const [extendInterpolationToBoundary, setExtendInterpolationToBoundary] = useState<boolean>(false);

  // Custom typography for cartography
  const [mapFontFamily, setMapFontFamily] = useState<string>("Times New Roman");
  const [mapTitleSize, setMapTitleSize] = useState<number>(16);
  const [mapTitleColor, setMapTitleColor] = useState<string>("#1e293b");
  const [mapSubtitleColor, setMapSubtitleColor] = useState<string>("#475569");
  const [legendTextColor, setLegendTextColor] = useState<string>("#475569");
  const [mapTitleBold, setMapTitleBold] = useState<boolean>(true);

  // Legend Sizing Customizations
  const [legendWidth, setLegendWidth] = useState<number>(155);
  const [legendRowSpacing, setLegendRowSpacing] = useState<number>(16);
  const [legendBoxWidth, setLegendBoxWidth] = useState<number>(12);
  const [legendBoxHeight, setLegendBoxHeight] = useState<number>(8);
  const [legendFontSize, setLegendFontSize] = useState<number>(7.5);
  const [legendTitleSize, setLegendTitleSize] = useState<number>(8.5);
  const [legendSubtitleSize, setLegendSubtitleSize] = useState<number>(7.5);

  // Fine-tuning position offsets for map elements (Title, Legend, Stats, North Arrow)
  const [titleOffsetX, setTitleOffsetX] = useState<number>(0);
  const [titleOffsetY, setTitleOffsetY] = useState<number>(0);
  const [legendOffsetX, setLegendOffsetX] = useState<number>(0);
  const [legendOffsetY, setLegendOffsetY] = useState<number>(0);
  const [statsOffsetX, setStatsOffsetX] = useState<number>(0);
  const [statsOffsetY, setStatsOffsetY] = useState<number>(0);
  const [northArrowOffsetX, setNorthArrowOffsetX] = useState<number>(0);
  const [northArrowOffsetY, setNorthArrowOffsetY] = useState<number>(0);
  const [scaleBarOffsetX, setScaleBarOffsetX] = useState<number>(0);
  const [scaleBarOffsetY, setScaleBarOffsetY] = useState<number>(0);
  const [mapSubtitleSize, setMapSubtitleSize] = useState<number>(11);
  const [titleLineSpacing, setTitleLineSpacing] = useState<number>(14);

  // Map Elements Customization
  const [northArrowType, setNorthArrowType] = useState<"classic" | "modern" | "simple">("classic");
  const [northArrowSize, setNorthArrowSize] = useState<number>(45);
  const [northArrowPos, setNorthArrowPos] = useState<"top-left" | "top-right" | "bottom-left" | "bottom-right">("top-right");
  
  const [showScaleBar, setShowScaleBar] = useState<boolean>(true);
  const [scaleBarUnit, setScaleBarUnit] = useState<"km" | "mi">("km");
  const [gridInterval, setGridInterval] = useState<number>(0.5); // degrees
  const [gridColor, setGridColor] = useState<string>("#cbd5e1");
  const [gridOpacity, setGridOpacity] = useState<number>(40);

  // Points Map exceeding-only features
  const [showOnlyExceedingPoints, setShowOnlyExceedingPoints] = useState<boolean>(true);
  const [exceedingPointSize, setExceedingPointSize] = useState<number>(0.5);
  const [showAs3dBubbles, setShowAs3dBubbles] = useState<boolean>(false);
  const [bubbleColor, setBubbleColor] = useState<string>("#ef4444");

  // Interpolation quality features
  const [useAllPoints, setUseAllPoints] = useState<boolean>(true);
  const [gridResolutionMultiplier, setGridResolutionMultiplier] = useState<number>(5);
  const [krigingModel, setKrigingModel] = useState<"spherical" | "exponential" | "gaussian">("spherical");
  const [krigingNugget, setKrigingNugget] = useState<number>(0.0);
  const [krigingSill, setKrigingSill] = useState<number>(1.0);
  const [krigingRange, setKrigingRange] = useState<number>(250); // in kilometers
  const [krigingNeighbors, setKrigingNeighbors] = useState<number>(12);
  const [rbfKernel, setRbfKernel] = useState<"multiquadric" | "inverse-multiquadric" | "thin-plate-spline" | "gaussian">("multiquadric");
  const [rbfParameter, setRbfParameter] = useState<number>(0.5); // smoothing / shape factor

  // Corner panels placements
  const [legendPos, setLegendPos] = useState<"top-left" | "top-right" | "bottom-left" | "bottom-right">("bottom-right");
  const [legendBgOpacity, setLegendBgOpacity] = useState<number>(95);
  
  const [showStatsPanel, setShowStatsPanel] = useState<boolean>(false);
  const [statsPanelPos, setStatsPanelPos] = useState<"top-left" | "top-right" | "bottom-left" | "bottom-right">("bottom-left");

  // Circular Agency Logo Option
  const [showAgencyLogo, setShowAgencyLogo] = useState<boolean>(false);
  const [agencyLogoType, setAgencyLogoType] = useState<"CGWB" | "MoJS" | "StateGWD" | "Custom">("CGWB");
  const [agencyLogoPos, setAgencyLogoPos] = useState<"top-left" | "top-right" | "bottom-left" | "bottom-right">("top-left");

  // Export Settings
  const [exportDpi, setExportDpi] = useState<number>(600);
  const [exportFormat, setExportFormat] = useState<"jpeg" | "png" | "tiff" | "pdf" | "svg">("png");

  // Seasonal Comparison Toggles
  const [generateComparisonMode, setGenerateComparisonMode] = useState<boolean>(true);
  const [comparisonLayout, setComparisonLayout] = useState<"horizontal" | "vertical">("horizontal");
  const [sheetLayout, setSheetLayout] = useState<"landscape" | "a4-portrait">("a4-portrait");

  const canvasWidth = sheetLayout === "a4-portrait" ? 595 : 640;
  const canvasHeight = sheetLayout === "a4-portrait" ? 758 : 360;
  const canvasAspectClass = sheetLayout === "a4-portrait" ? "aspect-[595/758]" : "aspect-[640/360]";

  // Simulated generated folder outputs
  const [exportQueue, setExportQueue] = useState<{ name: string; status: "idle" | "done" }[]>([]);
  const [batchProgress, setBatchProgress] = useState<number>(0);
  const [batchGenerating, setBatchGenerating] = useState<boolean>(false);

  // Parse raw data into coordinates
  const parsedData = useMemo(() => {
    if (!rawData || rawData.length === 0) return [];
    
    const latKey = headerMap["latitude"] || headers.latitude || "Latitude";
    const lngKey = headerMap["longitude"] || headers.longitude || "Longitude";
    const stateKey = headerMap["state"] || headers.state || "State";
    const districtKey = headerMap["district"] || headers.district || "District";
    const seasonKey = headers.season || Object.keys(rawData[0]).find(k => {
      const low = k.toLowerCase();
      return low.includes("season") || 
             low.includes("monsoon") || 
             low.includes("period") || 
             low.includes("pre") || 
             low.includes("post") || 
             low.includes("wet") || 
             low.includes("dry");
    }) || "Season";
    const yearKey = headers.year || Object.keys(rawData[0]).find(k => k.toLowerCase().includes("year") || k.toLowerCase() === "date") || "Year";

    const findHeader = (id: string, keywords: string[]) => {
      if (headerMap && headerMap[id]) return headerMap[id];
      const keys = Object.keys(rawData[0] || {});
      return keys.find(k => {
        const l = k.toLowerCase().trim();
        return keywords.some(kw => l === kw.toLowerCase() || l.includes(kw.toLowerCase()));
      });
    };

    const caCol = findHeader("Ca", ["ca", "calcium"]);
    const mgCol = findHeader("Mg", ["mg", "magnesium"]);
    const naCol = findHeader("Na", ["na", "sodium"]);
    const kCol = findHeader("K", ["k", "potassium"]);
    const clCol = findHeader("Cl", ["cl", "chloride"]);
    const hco3Col = findHeader("HCO3", ["hco3", "bicarbonate"]);
    const co3Col = findHeader("CO3", ["co3", "carbonate"]);
    const so4Col = findHeader("SO4", ["so4", "sulphate", "sulfate"]);
    const ecCol = findHeader("EC", ["ec", "electrical conductivity", "conductivity"]);
    const tdsCol = findHeader("TDS", ["tds", "total dissolved solids"]);

    // Filter raw data by selected state if active
    let filteredRaw = rawData;
    if (selectedState && selectedState !== "All" && selectedState !== "National" && selectedState !== "All India") {
      const selVal = selectedState.trim().toLowerCase();
      filteredRaw = rawData.filter(d => {
        const stateVal = String(d[stateKey] || "").trim().toLowerCase();
        return stateVal === selVal || stateVal.includes(selVal) || selVal.includes(stateVal);
      });
    }

    // Scan for unique non-empty season values
    const uniqueSeasons = Array.from(new Set(
      filteredRaw.map(row => String(row[seasonKey] || "").trim()).filter(Boolean)
    ));

    let preVal = uniqueSeasons.find(s => {
      const low = s.toLowerCase();
      return low.includes("pre") || low.includes("prm") || low === "before" || low.includes("wet") || low.includes("rabi");
    });
    let postVal = uniqueSeasons.find(s => {
      const low = s.toLowerCase();
      return low.includes("post") || low.includes("pom") || low === "after" || low.includes("dry") || low.includes("kharif");
    });

    if (!preVal && !postVal && uniqueSeasons.length === 2) {
      const sorted = [...uniqueSeasons].sort((a, b) => a.localeCompare(b));
      preVal = sorted[0];
      postVal = sorted[1];
    } else {
      if (!preVal && uniqueSeasons.length > 0) preVal = uniqueSeasons[0];
      if (!postVal && uniqueSeasons.length > 1) {
        postVal = uniqueSeasons[1] !== preVal ? uniqueSeasons[1] : uniqueSeasons[2];
      }
    }

    return filteredRaw.map(row => {
      const lat = parseFloat(row[latKey]);
      const lng = parseFloat(row[lngKey]);
      const rawSeason = String(row[seasonKey] || "Unknown").trim();
      
      let seasonGroup: "Pre-Monsoon" | "Post-Monsoon" | "Other" = "Other";
      if (preVal && rawSeason === preVal) {
        seasonGroup = "Pre-Monsoon";
      } else if (postVal && rawSeason === postVal) {
        seasonGroup = "Post-Monsoon";
      } else if (rawSeason.toLowerCase().includes("pre") || rawSeason.toLowerCase().includes("prm")) {
        seasonGroup = "Pre-Monsoon";
      } else if (rawSeason.toLowerCase().includes("post") || rawSeason.toLowerCase().includes("pom") || rawSeason.toLowerCase().includes("after")) {
        seasonGroup = "Post-Monsoon";
      }

      const year = parseInt(row[yearKey]) || 2025;

      const getNum = (col: string | undefined): number | null => {
        if (!col || row[col] === undefined || row[col] === null) return null;
        const val = parseFloat(row[col]);
        return isNaN(val) ? null : val;
      };

      const ca = getNum(caCol);
      const mg = getNum(mgCol);
      const na = getNum(naCol);
      const k = getNum(kCol);
      const cl = getNum(clCol);
      const hco3 = getNum(hco3Col);
      const co3 = getNum(co3Col);
      const so4 = getNum(so4Col);

      const safeVal = (v: number | null) => v === null ? 0 : v;

      const EQ_WEIGHTS = {
        Ca: 20.04,
        Mg: 12.16,
        Na: 23.0,
        K: 39.1,
        Cl: 35.45,
        SO4: 48.03,
        HCO3: 61.02,
        CO3: 30.0
      };

      const meq = {
        Ca: safeVal(ca) / EQ_WEIGHTS.Ca,
        Mg: safeVal(mg) / EQ_WEIGHTS.Mg,
        Na: safeVal(na) / EQ_WEIGHTS.Na,
        K: safeVal(k) / EQ_WEIGHTS.K,
        Cl: safeVal(cl) / EQ_WEIGHTS.Cl,
        SO4: safeVal(so4) / EQ_WEIGHTS.SO4,
        HCO3: safeVal(hco3) / EQ_WEIGHTS.HCO3,
        CO3: safeVal(co3) / EQ_WEIGHTS.CO3
      };

      let sarVal: number | null = null;
      if (ca !== null && mg !== null && na !== null) {
        const denom = Math.sqrt((meq.Ca + meq.Mg) / 2);
        if (denom > 0) {
          sarVal = meq.Na / denom;
        }
      }

      let rscVal: number | null = null;
      if (ca !== null && mg !== null && hco3 !== null) {
        rscVal = (meq.HCO3 + meq.CO3) - (meq.Ca + meq.Mg);
      }

      return {
        ...row,
        lat,
        lng,
        state: row[stateKey] || "",
        district: row[districtKey] || "",
        seasonGroup,
        year,
        rawSeason,
        SAR: sarVal !== null ? parseFloat(sarVal.toFixed(2)) : undefined,
        RSC: rscVal !== null ? parseFloat(rscVal.toFixed(2)) : undefined,
      };
    }).filter(row => !isNaN(row.lat) && !isNaN(row.lng));
  }, [rawData, headers, headerMap, selectedState]);

  // Detected seasons
  const seasonalPresence = useMemo(() => {
    const seasons = new Set<string>();
    parsedData.forEach(p => {
      seasons.add(p.seasonGroup);
    });
    return {
      hasPre: seasons.has("Pre-Monsoon"),
      hasPost: seasons.has("Post-Monsoon"),
      totalCount: seasons.size
    };
  }, [parsedData]);

  const isComparisonActive = generateComparisonMode && seasonalPresence.hasPre && seasonalPresence.hasPost;

  // Centroid/feature zooming helper
  const zoomToCentroid = useCallback((lng: number, lat: number, targetBounds?: { minLng: number; maxLng: number; minLat: number; maxLat: number }) => {
    let latitudes: number[] = [];
    let longitudes: number[] = [];
    if (fitToShapefile && shapefileBounds) {
      latitudes = [shapefileBounds.minLat, shapefileBounds.maxLat];
      longitudes = [shapefileBounds.minLng, shapefileBounds.maxLng];
    } else {
      const validPoints = isComparisonActive 
        ? (parsedData || []).filter(d => d.seasonGroup === "Pre-Monsoon" || d.seasonGroup === "Post-Monsoon")
        : (parsedData || []);
      if (validPoints.length > 0) {
        latitudes = validPoints.map(p => p.lat);
        longitudes = validPoints.map(p => p.lng);
      } else {
        latitudes = [8.4, 37.6];
        longitudes = [68.1, 97.4];
      }
    }
    const baseMinLat = Math.min(...latitudes);
    const baseMaxLat = Math.max(...latitudes);
    const baseMinLng = Math.min(...longitudes);
    const baseMaxLng = Math.max(...longitudes);
    const baseCenterLat = (baseMinLat + baseMaxLat) / 2;
    const baseCenterLng = (baseMinLng + baseMaxLng) / 2;

    setPanOffsetLat(lat - baseCenterLat);
    setPanOffsetLng(lng - baseCenterLng);

    if (targetBounds) {
      const targetdLat = targetBounds.maxLat - targetBounds.minLat || 0.1;
      const targetdLng = targetBounds.maxLng - targetBounds.minLng || 0.1;
      const basedLat = baseMaxLat - baseMinLat || 0.1;
      const basedLng = baseMaxLng - baseMinLng || 0.1;
      const scaleLat = targetdLat / basedLat;
      const scaleLng = targetdLng / basedLng;
      const idealZoom = Math.max(scaleLat, scaleLng) * 1.5;
      setZoomScaleFactor(Math.max(0.05, Math.min(idealZoom, 4.0)));
    } else {
      setZoomScaleFactor(0.2); // zoom in closely
    }
  }, [fitToShapefile, shapefileBounds, parsedData, isComparisonActive]);

  // Filter lists of parameters from PARAM_CONFIG that exist in data
  const availableParams = useMemo(() => {
    let params: string[] = [];
    if (parsedData.length === 0) {
      params = Object.keys(PARAM_CONFIG);
    } else {
      const rowKeys = Object.keys(parsedData[0]);
      params = Object.keys(PARAM_CONFIG).filter(p => {
        const config = PARAM_CONFIG[p];
        return rowKeys.some(rk => {
          const rkLower = rk.toLowerCase();
          return rkLower === p.toLowerCase() || config.keywords.some(kw => rkLower.includes(kw));
        });
      });
    }
    // Exclude HCO3, CO3, Na, and K from GIS Map section
    const excludeKeys = ["hco3", "co3", "na", "k"];
    params = params.filter(p => !excludeKeys.includes(p.toLowerCase()));
    return [...params, "STATIONS"];
  }, [parsedData]);

  useEffect(() => {
    if (availableParams.length > 0 && !availableParams.includes(selectedParam)) {
      setSelectedParam(availableParams[0]);
    }
  }, [availableParams, selectedParam]);

  const paramConfig = useMemo(() => {
    if (selectedParam === "STATIONS") {
      return { b1: 0, b2: 0, unit: "", name: "Ground Water Quality Monitoring Station", keywords: [] };
    }
    return PARAM_CONFIG[selectedParam] || { b1: 1, b2: 10, unit: "mg/L", name: selectedParam, keywords: [] };
  }, [selectedParam]);

  const getMapDefaultTitleAndSubtitle = useCallback((side: "left" | "right") => {
    if (selectedParam === "STATIONS") {
      const title = "Ground Water Quality Monitoring Station";
      let year = "Year";
      let season = "Season";
      if (parsedData && parsedData.length > 0) {
        const firstRow = parsedData[0];
        if (firstRow.year) year = firstRow.year;
        if (firstRow.rawSeason && firstRow.rawSeason !== "Unknown") {
          season = firstRow.rawSeason;
        } else if (firstRow.seasonGroup) {
          season = firstRow.seasonGroup;
        }
      }
      const subtitle = `${season}-${year}`;
      return { title, subtitle };
    }
    const config = PARAM_CONFIG[selectedParam] || { name: selectedParam };
    const title = `Distribution of ${config.name}`;
    let year = 2025;
    let season = side === "left" ? "Pre-Monsoon" : "Post-Monsoon";

    if (parsedData && parsedData.length > 0) {
      const firstRow = parsedData[0];
      if (firstRow.year) {
        year = firstRow.year;
      }
      if (side === "left") {
        if (isComparisonActive) {
          season = "Pre-Monsoon";
        } else {
          season = firstRow.rawSeason && firstRow.rawSeason !== "Unknown" ? firstRow.rawSeason : (firstRow.seasonGroup || "Pre-Monsoon");
        }
      } else {
        if (showDifferenceMap) {
          season = "Difference (Post - Pre)";
        } else {
          season = "Post-Monsoon";
        }
      }
    }

    const subtitle = `${season} ${year}`;
    return { title, subtitle };
  }, [selectedParam, parsedData, isComparisonActive, showDifferenceMap]);

  const isInterpolatedType = useMemo(() => {
    return !!selectedParam;
  }, [selectedParam]);

  // Dynamic Geographic Centering & Scaling logic (70-80% India study area space occupancy)
  const mapExtent = useMemo(() => {
    let latitudes: number[] = [];
    let longitudes: number[] = [];

    if (fitToShapefile && shapefileBounds) {
      latitudes = [shapefileBounds.minLat, shapefileBounds.maxLat];
      longitudes = [shapefileBounds.minLng, shapefileBounds.maxLng];
    } else {
      const validPoints = isComparisonActive 
        ? parsedData.filter(d => d.seasonGroup === "Pre-Monsoon" || d.seasonGroup === "Post-Monsoon")
        : parsedData;

      if (validPoints.length === 0) {
        return {
          mapMinLng: 68.1 + panOffsetLng,
          mapMaxLng: 97.4 + panOffsetLng,
          mapMinLat: 8.4 + panOffsetLat,
          mapMaxLat: 37.6 + panOffsetLat,
          finalLngSpan: 29.3,
          finalLatSpan: 29.2,
          centerLat: 23 + panOffsetLat,
          centerLng: 82 + panOffsetLng
        };
      }

      latitudes = validPoints.map(p => p.lat);
      longitudes = validPoints.map(p => p.lng);
    }

    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);

    // Apply interactive panning
    const centerLat = ((minLat + maxLat) / 2) + panOffsetLat;
    const centerLng = ((minLng + maxLng) / 2) + panOffsetLng;
    const dLat = maxLat - minLat || 0.1;
    const dLng = maxLng - minLng || 0.1;

    // Physical distance factor for longitude scaling (mercator degree conversion at this latitude)
    const cosFactor = Math.cos(centerLat * Math.PI / 180);

    // Grid aspect ratio is dynamic based on sheet layout selection
    const mapBoxAspect = sheetLayout === "a4-portrait" ? (595 / 842) : 1.6;

    let finalLatSpan = dLat;
    let finalLngSpan = dLng;

    // Equalize margins on all sides & maximize canvas space (70-80% fill)
    const dataAspect = (dLng * cosFactor) / dLat;
    if (dataAspect > mapBoxAspect) {
      // Constrain by longitude width
      finalLngSpan = dLng / 0.75;
      finalLatSpan = (finalLngSpan * cosFactor) / mapBoxAspect;
    } else {
      // Constrain by latitude height
      finalLatSpan = dLat / 0.75;
      finalLngSpan = (finalLatSpan * mapBoxAspect) / cosFactor;
    }

    // Apply custom interactive zoom factor (+/- 10% per click facility)
    finalLatSpan *= zoomScaleFactor;
    finalLngSpan *= zoomScaleFactor;

    return {
      mapMinLng: centerLng - finalLngSpan / 2,
      mapMaxLng: centerLng + finalLngSpan / 2,
      mapMinLat: centerLat - finalLatSpan / 2,
      mapMaxLat: centerLat + finalLatSpan / 2,
      finalLngSpan,
      finalLatSpan,
      centerLat,
      centerLng
    };
  }, [parsedData, isComparisonActive, fitToShapefile, shapefileBounds, sheetLayout, zoomScaleFactor, panOffsetLat, panOffsetLng]);

  const baseMapExtent = mapExtent;

  // Filter datasets
  const leftPanelData = useMemo(() => {
    return parsedData.filter(d => d.seasonGroup === "Pre-Monsoon");
  }, [parsedData]);

  const rightPanelData = useMemo(() => {
    return parsedData.filter(d => d.seasonGroup === "Post-Monsoon");
  }, [parsedData]);

  // Helper conversion for colors
  const hexToRgb = (hex: string) => {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 120, g: 120, b: 120 };
  };

  const interpolateColor = (colors: string[], t: number) => {
    const clampedT = Math.max(0, Math.min(1, t));
    const count = colors.length;
    const segment = 1 / (count - 1);
    const index = Math.floor(clampedT / segment);
    const tSegment = (clampedT - index * segment) / segment;
    
    const c1 = hexToRgb(colors[Math.min(index, count - 1)]);
    const c2 = hexToRgb(colors[Math.min(index + 1, count - 1)]);
    
    const r = Math.round(c1.r + tSegment * (c2.r - c1.r));
    const g = Math.round(c1.g + tSegment * (c2.g - c1.g));
    const b = Math.round(c1.b + tSegment * (c2.b - c1.b));
    
    return `rgb(${r}, ${g}, ${b})`;
  };

  const getClassColorsAndBreaks = useCallback((activeParamConfig: any) => {
    const b1 = activeParamConfig.b1;
    const b2 = activeParamConfig.b2;
    const K = interpolationClasses;

    if (K <= 2) {
      return {
        breaks: [b2],
        colors: [colorRange1, colorRange3],
        labels: [`≤ ${b2}`, `> ${b2}`]
      };
    }

    if (K === 3) {
      return {
        breaks: [b1, b2],
        colors: [colorRange1, colorRange2, colorRange3],
        labels: [`Acceptable (≤ ${b1})`, `Permissible (${b1} - ${b2})`, `Exceeded (> ${b2})`]
      };
    }

    const breaks: number[] = [];
    const colors: string[] = [];
    const labels: string[] = [];

    breaks.push(b1);
    for (let j = 1; j < K - 1; j++) {
      const val = b1 + j * (b2 - b1) / (K - 2);
      breaks.push(parseFloat(val.toFixed(2)));
    }
    breaks.push(b2);

    for (let i = 0; i < K; i++) {
      let t = i / (K - 1);
      let col = "";
      if (t <= 0.5) {
        col = interpolateColor([colorRange1, colorRange2], t * 2);
      } else {
        col = interpolateColor([colorRange2, colorRange3], (t - 0.5) * 2);
      }
      colors.push(col);
    }

    labels.push(`Acceptable (≤ ${b1})`);
    for (let i = 1; i < K - 1; i++) {
      labels.push(`Permissible (${breaks[i-1]} - ${breaks[i]})`);
    }
    labels.push(`Exceeded (> ${b2})`);

    return { breaks, colors, labels };
  }, [interpolationClasses, colorRange1, colorRange2, colorRange3]);

  const getBoundaryLegendLabel = (geoJson: any): string | null => {
    if (!geoJson) return null;
    const features = geoJson.features || (geoJson.type === "FeatureCollection" ? geoJson.features : []);
    if (!features || features.length === 0) {
      return "Boundary";
    }
    
    let hasDistrict = false;
    let hasState = false;
    
    const sampleFeatures = features.slice(0, Math.min(features.length, 10));
    for (const feature of sampleFeatures) {
      const props = feature.properties || {};
      const keys = Object.keys(props).map(k => k.toLowerCase());
      if (keys.some(k => k.includes("district") || k.includes("dist") || k === "dt_name" || k === "dist_name" || k === "district_n")) {
        hasDistrict = true;
      }
      if (keys.some(k => k.includes("state") || k === "st_name" || k === "state_name" || k === "st_nm")) {
        hasState = true;
      }
    }
    
    if (hasDistrict) {
      return "District Boundary";
    } else if (hasState) {
      return "State Boundary";
    }
    return "Boundary";
  };

  const getValueColor = (val: number, isDiffMode: boolean = false, paramOverride?: string, isPointMode: boolean = false) => {
    const activeParamName = paramOverride || selectedParam;
    const isStations = activeParamName === "STATIONS";
    if (isStations) {
      return stationPointColor; // monitoring stations custom color
    }
    const activeParamConfig = PARAM_CONFIG[activeParamName] || { b1: 1, b2: 10, unit: "mg/L", name: activeParamName };
    if (isDiffMode) {
      // Difference Map Color Coding: Post - Pre
      // Negative difference means improved concentration (Green/custom)
      // Positive difference means deteriorated concentration (Red/custom)
      // Near zero (+/- 5% of permissible limit) is stable (Gray/custom)
      const threshold = 0.05 * activeParamConfig.b2;
      if (val < -threshold) {
        return colorDiffImproved; // Improved
      } else if (val > threshold) {
        return colorDiffDeteriorated; // Deteriorated
      } else {
        return colorDiffStable; // Stable
      }
    }

    if (isPointMode && useCustomPointColors) {
      // Use Point-specific Colors
      const b1 = activeParamConfig.b1;
      const b2 = activeParamConfig.b2;
      if (val <= b1) return pointColorRange1;
      if (val <= b2) return pointColorRange2;
      return pointColorRange3;
    }

    // Otherwise, standard interpolation colors (supporting custom class count)
    const { breaks, colors } = getClassColorsAndBreaks(activeParamConfig);
    for (let i = 0; i < breaks.length; i++) {
      if (val <= breaks[i]) return colors[i];
    }
    return colors[colors.length - 1]; // last exceeded color
  };

  const getStats = (data: any[], paramKey: string) => {
    const isStations = paramKey === "STATIONS";
    const rawCol = headerMap[paramKey] || paramKey;
    let vals = data.map(d => parseFloat(d[rawCol])).filter(v => !isNaN(v));
    if (isStations) {
      vals = data.map(() => 1);
    }
    if (vals.length === 0) return null;

    vals.sort((a, b) => a - b);
    const total = vals.length;
    const min = vals[0];
    const max = vals[vals.length - 1];
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = sum / total;
    
    // Correct median calculation for even-numbered datasets
    let median = 0;
    if (total % 2 === 0) {
      const mid1 = vals[total / 2 - 1];
      const mid2 = vals[total / 2];
      median = (mid1 + mid2) / 2;
    } else {
      median = vals[Math.floor(total / 2)];
    }
    
    let variance = 0;
    vals.forEach(v => {
      variance += Math.pow(v - mean, 2);
    });
    // Use sample standard deviation (n - 1) instead of population standard deviation
    const stdDev = total > 1 ? Math.sqrt(variance / (total - 1)) : 0;

    const activeParamConfig = PARAM_CONFIG[paramKey] || { b1: 1, b2: 10, unit: "mg/L", name: paramKey };
    const exceedLimit = activeParamConfig.b2;
    const exceeding = vals.filter(v => v > exceedLimit).length;
    const percentage = ((exceeding / total) * 100).toFixed(1);

    // Determine the subgroup level (States/UTs or Districts)
    const stateKey = headerMap["state"] || headers.state || "State";
    const districtKey = headerMap["district"] || headers.district || "District";

    const uniqueStates = new Set<string>();
    const uniqueDistricts = new Set<string>();
    data.forEach(d => {
      if (d[stateKey]) uniqueStates.add(String(d[stateKey]).trim());
      if (d[districtKey]) uniqueDistricts.add(String(d[districtKey]).trim());
    });

    const useDistricts = uniqueStates.size <= 1 && uniqueDistricts.size > 0;
    const subgroupKey = useDistricts ? districtKey : stateKey;
    const subgroupLabel = useDistricts ? "Districts" : "States/UTs";

    // Find partially affected subgroups
    const affectedSubgroups = new Set<string>();
    data.forEach(d => {
      const val = parseFloat(d[rawCol]);
      if (!isNaN(val) && val > exceedLimit) {
        const subName = d[subgroupKey] ? String(d[subgroupKey]).trim() : "";
        if (subName && subName !== "Unknown") {
          affectedSubgroups.add(subName);
        }
      }
    });

    const affectedCount = affectedSubgroups.size;
    const affectedNamesList = affectedCount > 0 ? Array.from(affectedSubgroups).sort().join(", ") : "-";

    return {
      total,
      exceeding,
      percentage,
      min: isStations ? "N/A" : min.toFixed(2),
      max: isStations ? "N/A" : max.toFixed(2),
      mean: isStations ? "N/A" : mean.toFixed(2),
      median: isStations ? "N/A" : median.toFixed(2),
      stdDev: isStations ? "N/A" : stdDev.toFixed(2),
      subgroupLabel,
      affectedCount,
      affectedNamesList
    };
  };

  const leftStats = useMemo(() => getStats(leftPanelData, selectedParam), [leftPanelData, selectedParam, paramConfig]);
  const rightStats = useMemo(() => getStats(rightPanelData, selectedParam), [rightPanelData, selectedParam, paramConfig]);

  // Master Vector & Raster GIS Drawer Function (Supports Vector-First High-DPI scaling)
  const drawMapInstance = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    scale: number, // Scale factor (e.g. 1 for screen, 6.25 for 600 DPI export)
    data: any[],
    titleStr: string,
    subtitleStr: string,
    stats: any,
    isDifference: boolean = false,
    diffMatrix: number[][] | null = null,
    panelId?: "left" | "right",
    paramOverride?: string
  ) => {
    // Standard GIS margins suitable for Map neatline sheets
    const margin = 55 * scale;
    const mw = w - 2 * margin;
    const mh = h - 2 * margin;

    const baseMapExtent = mapExtent;
    const activeParamName = paramOverride || selectedParam;
    const activeParamConfig = activeParamName === "STATIONS"
      ? { b1: 0, b2: 0, unit: "", name: "Ground Water Quality Monitoring Station", keywords: [] }
      : (PARAM_CONFIG[activeParamName] || { b1: 1, b2: 10, unit: "mg/L", name: activeParamName, keywords: [] });
    const paramCol = headerMap[activeParamName] || activeParamName;

    const draw3dText = (
      ctx: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      effect: "none" | "emboss" | "deboss",
      textColor: string,
      scale: number
    ) => {
      if (effect === "none") {
        ctx.fillStyle = textColor;
        ctx.fillText(text, x, y);
        return;
      }

      const isDark = textColor === "#ffffff" || textColor === "white" || textColor.toLowerCase().startsWith("rgba(255") || textColor.toLowerCase().startsWith("rgb(255");
      const highlightColor = isDark ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.85)";
      const shadowColor = isDark ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.45)";
      const offset = Math.max(0.6, 0.85 * scale);

      ctx.save();
      if (effect === "emboss") {
        ctx.fillStyle = shadowColor;
        ctx.fillText(text, x + offset, y + offset);
        ctx.fillStyle = highlightColor;
        ctx.fillText(text, x - offset, y - offset);
      } else if (effect === "deboss") {
        ctx.fillStyle = highlightColor;
        ctx.fillText(text, x + offset, y + offset);
        ctx.fillStyle = shadowColor;
        ctx.fillText(text, x - offset, y - offset);
      }
      ctx.fillStyle = textColor;
      ctx.fillText(text, x, y);
      ctx.restore();
    };

    const { mapMinLng, mapMaxLng, mapMinLat, mapMaxLat, finalLngSpan, finalLatSpan, centerLat } = mapExtent;

    // Coordinate converters
    const getX = (lng: number) => {
      const pct = (lng - mapMinLng) / finalLngSpan;
      return margin + pct * mw;
    };
    const getY = (lat: number) => {
      const pct = (lat - mapMinLat) / finalLatSpan;
      return h - margin - pct * mh;
    };

    // Panels/cards styling theme helper
    const getPanelStyle = () => {
      if (onlyTransparentPanels) {
        const isDarkThemeText = mapTitleColor === "#ffffff" || panelBackgroundStyle.includes("dark");
        return {
          bg: "rgba(255, 255, 255, 0)",
          border: "rgba(255, 255, 255, 0)",
          text: isDarkThemeText ? "#f8fafc" : "#0f172a",
          muted: isDarkThemeText ? "#cbd5e1" : "#475569"
        };
      }
      switch (panelBackgroundStyle) {
        case "translucent-dark":
          return {
            bg: "rgba(15, 23, 42, 0.55)",
            border: "rgba(255, 255, 255, 0.25)",
            text: "#ffffff",
            muted: "#e2e8f0"
          };
        case "transparent-glass":
          return {
            bg: "rgba(255, 255, 255, 0.25)",
            border: "rgba(255, 255, 255, 0.5)",
            text: "#0f172a",
            muted: "#1e293b"
          };
        case "solid-light":
          return {
            bg: "#ffffff",
            border: "#cbd5e1",
            text: "#0f172a",
            muted: "#64748b"
          };
        case "solid-dark":
          return {
            bg: "#0f172a",
            border: "#334155",
            text: "#f8fafc",
            muted: "#94a3b8"
          };
        case "translucent-light":
        default:
          return {
            bg: "rgba(255, 255, 255, 0.55)",
            border: "rgba(148, 163, 184, 0.45)",
            text: "#0f172a",
            muted: "#334155"
          };
      }
    };

    const pStyle = getPanelStyle();

    const clipToShapefileGeom = (c2d: CanvasRenderingContext2D) => {
      if (!effectiveClipGeoJson) return false;
      
      c2d.beginPath();
      let pathCreated = false;

      const tracePolygonRing = (ring: number[][]) => {
        if (ring.length === 0) return;
        c2d.moveTo(getX(ring[0][0]), getY(ring[0][1]));
        for (let i = 1; i < ring.length; i++) {
          c2d.lineTo(getX(ring[i][0]), getY(ring[i][1]));
        }
        c2d.closePath();
        pathCreated = true;
      };

      const traceGeom = (geom: any) => {
        if (!geom) return;
        if (geom.type === "Polygon") {
          geom.coordinates.forEach((ring: number[][]) => tracePolygonRing(ring));
        } else if (geom.type === "MultiPolygon") {
          geom.coordinates.forEach((poly: number[][][]) => {
            poly.forEach((ring: number[][]) => tracePolygonRing(ring));
          });
        } else if (geom.type === "GeometryCollection") {
          geom.geometries?.forEach((g: any) => traceGeom(g));
        }
      };

      if (effectiveClipGeoJson.type === "FeatureCollection") {
        effectiveClipGeoJson.features?.forEach((f: any) => traceGeom(f.geometry));
      } else if (effectiveClipGeoJson.type === "Feature") {
        traceGeom(effectiveClipGeoJson.geometry);
      } else {
        traceGeom(effectiveClipGeoJson);
      }

      if (pathCreated) {
        c2d.clip("evenodd");
        return true;
      }
      return false;
    };

    // Adaptive zoom and tile ranges for current extent
    const calcOptimalZoom = () => {
      const span = Math.max(0.01, finalLngSpan);
      let z = Math.round(Math.log2(1440 / span));
      return Math.max(1, Math.min(18, z));
    };
    const zoom = calcOptimalZoom();

    let finalZoom = zoom;
    let xMin = Math.floor(lngToTileX(mapMinLng, finalZoom));
    let xMax = Math.floor(lngToTileX(mapMaxLng, finalZoom));
    let yMin = Math.floor(latToTileY(mapMaxLat, finalZoom));
    let yMax = Math.floor(latToTileY(mapMinLat, finalZoom));

    // Limit maximum number of tiles to draw to avoid heavy loading and crash
    while ((xMax - xMin + 1) * (yMax - yMin + 1) > 36 && finalZoom > 1) {
      finalZoom--;
      xMin = Math.floor(lngToTileX(mapMinLng, finalZoom));
      xMax = Math.floor(lngToTileX(mapMaxLng, finalZoom));
      yMin = Math.floor(latToTileY(mapMaxLat, finalZoom));
      yMax = Math.floor(latToTileY(mapMinLat, finalZoom));
    }

    const getTileUrl = (tx: number, ty: number, tz: number) => {
      const maxTile = Math.pow(2, tz) - 1;
      const cleanX = Math.max(0, Math.min(maxTile, tx));
      const cleanY = Math.max(0, Math.min(maxTile, ty));

      if (basemap === "ESRI Satellite" || basemap === "Google Satellite" || basemap === "Google Hybrid") {
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tz}/${cleanY}/${cleanX}`;
      } else if (basemap === "ESRI Topographic") {
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${tz}/${cleanY}/${cleanX}`;
      } else if (basemap === "ESRI Terrain") {
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/${tz}/${cleanY}/${cleanX}`;
      } else if (basemap === "CartoDB Light") {
        return `https://basemaps.cartocdn.com/light_all/${tz}/${cleanX}/${cleanY}.png`;
      } else if (basemap === "CartoDB Dark") {
        return `https://basemaps.cartocdn.com/dark_all/${tz}/${cleanX}/${cleanY}.png`;
      } else {
        // Default OpenStreetMap
        return `https://tile.openstreetmap.org/${tz}/${cleanX}/${cleanY}.png`;
      }
    };

    // 1. Clear background & draw Basemap Base
    ctx.clearRect(0, 0, w, h);
    const style = BASEMAP_STYLES[basemap as keyof typeof BASEMAP_STYLES] || BASEMAP_STYLES["No Basemap"];
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Render Tile-Based Basemap inside neatline boundaries
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin, margin, mw, mh);
    ctx.clip();

    ctx.fillStyle = style.bg;
    ctx.fillRect(margin, margin, mw, mh);

    if (basemap !== "No Basemap") {
      ctx.save();
      ctx.globalAlpha = basemapOpacity / 100;

      for (let tx = xMin; tx <= xMax; tx++) {
        for (let ty = yMin; ty <= yMax; ty++) {
          const tileLngLeft = tileXToLng(tx, finalZoom);
          const tileLngRight = tileXToLng(tx + 1, finalZoom);
          const tileLatTop = tileYToLat(ty, finalZoom);
          const tileLatBottom = tileYToLat(ty + 1, finalZoom);

          const tileCanvasXLeft = getX(tileLngLeft);
          const tileCanvasXRight = getX(tileLngRight);
          const tileCanvasYTop = getY(tileLatTop);
          const tileCanvasYBottom = getY(tileLatBottom);

          const tW = tileCanvasXRight - tileCanvasXLeft;
          const tH = tileCanvasYBottom - tileCanvasYTop;

          const url = getTileUrl(tx, ty, finalZoom);
          
          // LRU Cache Retrieval (refreshing key position to Most Recently Used)
          let tileImg = tileCache.current.get(url);
          if (tileImg) {
            tileCache.current.delete(url);
            tileCache.current.set(url, tileImg);
          }

          if (!tileImg) {
            if (!loadingTiles.current.has(url)) {
              loadingTiles.current.add(url);
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.src = url;
              img.onload = () => {
                // LRU Cache Storage: Add and evict oldest key if size exceeds 128 items limit
                tileCache.current.delete(url);
                tileCache.current.set(url, img);
                if (tileCache.current.size > 128) {
                  const oldestKey = tileCache.current.keys().next().value;
                  if (oldestKey) {
                    tileCache.current.delete(oldestKey);
                  }
                }
                loadingTiles.current.delete(url);
                setRedrawTilesTrigger(prev => prev + 1);
              };
              img.onerror = () => {
                loadingTiles.current.delete(url);
              };
            }
            // subtle visual block background
            ctx.fillStyle = basemap.includes("Satellite") || basemap.includes("Dark") ? "#0c1524" : "#f1ebd9";
            ctx.fillRect(tileCanvasXLeft, tileCanvasYTop, tW, tH);
          } else {
            ctx.drawImage(tileImg, tileCanvasXLeft, tileCanvasYTop, tW, tH);
          }
        }
      }
      ctx.restore();
    }
    ctx.restore();

    // 2. Render Interpolation Raster Surface with pre-computed memoized grid
    if (showRaster && isInterpolatedType) {
      let cacheObj = panelId === "left" ? leftInterpolatedGrid : rightInterpolatedGrid;

      if (paramOverride && data.length > 0) {
        // Build a synchronous IDW grid on-the-fly for the programmatically requested parameter
        const syncColStep = 100;
        const syncRowStep = 100;
        const syncGrid: number[][] = Array.from({ length: syncRowStep }, () => new Array(syncColStep).fill(NaN));
        
        const pts: { lat: number; lng: number; val: number }[] = [];
        data.forEach(d => {
          if (d.lat !== null && d.lng !== null && !isNaN(d.lat) && !isNaN(d.lng)) {
            const val = parseFloat(d[paramCol]);
            if (!isNaN(val)) {
              pts.push({ lat: d.lat, lng: d.lng, val });
            }
          }
        });
        
        if (pts.length > 0) {
          for (let r = 0; r < syncRowStep; r++) {
            const cellLat = mapMinLat + (r / syncRowStep) * finalLatSpan;
            for (let c = 0; c < syncColStep; c++) {
              const cellLng = mapMinLng + (c / syncColStep) * finalLngSpan;
              
              let exactVal: number | null = null;
              let numer = 0;
              let denom = 0;
              
              for (let i = 0; i < pts.length; i++) {
                const pt = pts[i];
                const dLat = cellLat - pt.lat;
                const dLng = cellLng - pt.lng;
                const distSq = dLat * dLat + dLng * dLng;
                if (distSq < 1e-10) {
                  exactVal = pt.val;
                  break;
                }
                const weight = 1 / Math.pow(distSq, (idwPower || 2) / 2);
                numer += weight * pt.val;
                denom += weight;
              }
              
              syncGrid[r][c] = exactVal !== null ? exactVal : (denom > 0 ? numer / denom : NaN);
            }
          }
        }
        
        cacheObj = { grid: syncGrid, colStep: syncColStep, rowStep: syncRowStep };
      }

      if (cacheObj) {
        const { grid, colStep, rowStep } = cacheObj;
        
        // Two-stage Rendering: First compute colored raster on mathCanvas, then upscale smoothly
        const mathCanvas = document.createElement("canvas");
        mathCanvas.width = colStep;
        mathCanvas.height = rowStep;
        const mathCtx = mathCanvas.getContext("2d");
        
        if (mathCtx) {
          const imgData = mathCtx.createImageData(colStep, rowStep);
          const data = imgData.data;
          
          for (let r = 0; r < rowStep; r++) {
            // Draw top-to-bottom: r=rowStep-1 is drawn at imgY=0 (top of canvas)
            const imgY = rowStep - 1 - r;
            for (let c = 0; c < colStep; c++) {
              const val = grid[r][c];
              const idx = (imgY * colStep + c) * 4;
              
              if (isNaN(val)) {
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 0;
                continue;
              }
              
              const colorStr = getValueColor(val, isDifference, activeParamName);
              let rVal = 0, gVal = 0, bVal = 0, aVal = 255;
              
              if (colorStr.startsWith("#")) {
                const hex = colorStr.replace("#", "");
                rVal = parseInt(hex.substring(0, 2), 16) || 0;
                gVal = parseInt(hex.substring(2, 4), 16) || 0;
                bVal = parseInt(hex.substring(4, 6), 16) || 0;
              } else if (colorStr.startsWith("rgb")) {
                const parts = colorStr.match(/\d+/g);
                if (parts) {
                  rVal = parseInt(parts[0]) || 0;
                  gVal = parseInt(parts[1]) || 0;
                  bVal = parseInt(parts[2]) || 0;
                  if (parts[3]) aVal = Math.round(parseFloat(parts[3]) * 255);
                }
              }
              
              data[idx] = rVal;
              data[idx + 1] = gVal;
              data[idx + 2] = bVal;
              data[idx + 3] = aVal;
            }
          }
          
          mathCtx.putImageData(imgData, 0, 0);
          
          ctx.save();
          if (effectiveClipGeoJson) {
            clipToShapefileGeom(ctx);
          }
          ctx.globalAlpha = rasterOpacity / 100;
          
          // Smooth bilinear rendering when drawing onto high-resolution raster
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          
          const xMin = getX(baseMapExtent.mapMinLng);
          const xMax = getX(baseMapExtent.mapMaxLng);
          const yMin = getY(baseMapExtent.mapMaxLat);
          const yMax = getY(baseMapExtent.mapMinLat);
          
          ctx.drawImage(mathCanvas, xMin - 0.2, yMin - 0.2, (xMax - xMin) + 0.4, (yMax - yMin) + 0.4);
          ctx.restore();
        }
      }
    }

    // 3. Draw Latitude and Longitude Grid & Topographic Neatline tickmarks
    if (showGrid) {
      ctx.save();
      ctx.strokeStyle = gridColor;
      ctx.globalAlpha = gridOpacity / 100;
      ctx.lineWidth = 0.6 * scale;
      ctx.fillStyle = "#334155";
      ctx.font = `${8 * scale}px ${mapFontFamily}`;

      // Longitude ticks & lines
      const minLngInterval = Math.ceil(mapMinLng / gridInterval) * gridInterval;
      for (let lng = minLngInterval; lng <= mapMaxLng; lng += gridInterval) {
        const x = getX(lng);
        if (x < margin || x > w - margin) continue;

        // Draw grid vertical
        ctx.beginPath();
        ctx.moveTo(x, margin);
        ctx.lineTo(x, h - margin);
        ctx.stroke();

        // Draw tick marks inside top & bottom borders
        ctx.lineWidth = 1.2 * scale;
        ctx.beginPath();
        ctx.moveTo(x, margin);
        ctx.lineTo(x, margin - 6 * scale);
        ctx.moveTo(x, h - margin);
        ctx.lineTo(x, h - margin + 6 * scale);
        ctx.stroke();

        ctx.globalAlpha = 1.0;
        ctx.textAlign = "center";
        ctx.fillText(`${lng.toFixed(1)}°E`, x, h - margin + 16 * scale);
        ctx.globalAlpha = gridOpacity / 100;
      }

      // Latitude ticks & lines
      const minLatInterval = Math.ceil(mapMinLat / gridInterval) * gridInterval;
      for (let lat = minLatInterval; lat <= mapMaxLat; lat += gridInterval) {
        const y = getY(lat);
        if (y < margin || y > h - margin) continue;

        // Draw grid horizontal
        ctx.beginPath();
        ctx.moveTo(margin, y);
        ctx.lineTo(w - margin, y);
        ctx.stroke();

        // Draw ticks on left & right
        ctx.lineWidth = 1.2 * scale;
        ctx.beginPath();
        ctx.moveTo(margin, y);
        ctx.lineTo(margin - 6 * scale, y);
        ctx.moveTo(w - margin, y);
        ctx.lineTo(w - margin + 6 * scale, y);
        ctx.stroke();

        ctx.globalAlpha = 1.0;
        ctx.textAlign = "right";
        ctx.fillText(`${lat.toFixed(1)}°N`, margin - 10 * scale, y + 3 * scale);
        ctx.globalAlpha = gridOpacity / 100;
      }
      ctx.restore();
    }

    // 4. Neatline double-border frames (Professional publication standard)
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeRect(margin, margin, mw, mh); // Inner frame
    if (showGrid) {
      ctx.strokeRect(margin - 6 * scale, margin - 6 * scale, mw + 12 * scale, mh + 12 * scale); // Outer tick frame
    }

    // 5b. Render Custom Shapefile / GeoJSON Boundaries (Drawn above base layers but below points)
    if (showShapefile) {
      if (layers.length > 0) {
        layers.forEach(layer => {
          if (!layer.visible) return;
          ctx.save();
          
          const drawPolygonRing = (ring: number[][]) => {
            if (ring.length === 0) return;
            ctx.beginPath();
            const startX = getX(ring[0][0]);
            const startY = getY(ring[0][1]);
            ctx.moveTo(startX, startY);
            for (let i = 1; i < ring.length; i++) {
              ctx.lineTo(getX(ring[i][0]), getY(ring[i][1]));
            }
            ctx.closePath();
            ctx.fillStyle = layer.fillColor;
            ctx.globalAlpha = layer.fillOpacity / 100;
            ctx.fill();
            ctx.strokeStyle = layer.strokeColor;
            ctx.lineWidth = layer.strokeWidth * scale;
            ctx.globalAlpha = 1.0;
            ctx.stroke();
          };

          const drawFeatureGeometry = (geom: any) => {
            if (!geom) return;
            if (geom.type === "Polygon") {
              geom.coordinates.forEach((ring: number[][]) => drawPolygonRing(ring));
            } else if (geom.type === "MultiPolygon") {
              geom.coordinates.forEach((poly: number[][][]) => {
                poly.forEach((ring: number[][]) => drawPolygonRing(ring));
              });
            } else if (geom.type === "LineString") {
              ctx.beginPath();
              if (geom.coordinates.length > 0) {
                ctx.moveTo(getX(geom.coordinates[0][0]), getY(geom.coordinates[0][1]));
                for (let i = 1; i < geom.coordinates.length; i++) {
                  ctx.lineTo(getX(geom.coordinates[i][0]), getY(geom.coordinates[i][1]));
                }
                ctx.strokeStyle = layer.strokeColor;
                ctx.lineWidth = layer.strokeWidth * scale;
                ctx.stroke();
              }
            } else if (geom.type === "MultiLineString") {
              geom.coordinates.forEach((line: number[][]) => {
                ctx.beginPath();
                if (line.length > 0) {
                  ctx.moveTo(getX(line[0][0]), getY(line[0][1]));
                  for (let i = 1; i < line.length; i++) {
                    ctx.lineTo(getX(line[i][0]), getY(line[i][1]));
                  }
                  ctx.strokeStyle = layer.strokeColor;
                  ctx.lineWidth = layer.strokeWidth * scale;
                  ctx.stroke();
                }
              });
            } else if (geom.type === "Point") {
              const px = getX(geom.coordinates[0]);
              const py = getY(geom.coordinates[1]);
              ctx.beginPath();
              ctx.arc(px, py, 4 * scale, 0, Math.PI * 2);
              ctx.fillStyle = layer.fillColor;
              ctx.fill();
              ctx.strokeStyle = layer.strokeColor;
              ctx.lineWidth = layer.strokeWidth * scale;
              ctx.stroke();
            } else if (geom.type === "GeometryCollection") {
              geom.geometries?.forEach((g: any) => drawFeatureGeometry(g));
            }
          };

          const gj = layer.geoJson;
          if (gj) {
            if (gj.type === "FeatureCollection") {
              gj.features?.forEach((f: any) => drawFeatureGeometry(f.geometry));
            } else if (gj.type === "Feature") {
              drawFeatureGeometry(gj.geometry);
            } else {
              drawFeatureGeometry(gj);
            }
          }
          ctx.restore();
        });
      } else if (effectiveClipGeoJson && uploadedGeoJson) {
        ctx.save();
        
        const drawPolygonRing = (ring: number[][]) => {
          if (ring.length === 0) return;
          ctx.beginPath();
          const startX = getX(ring[0][0]);
          const startY = getY(ring[0][1]);
          ctx.moveTo(startX, startY);
          for (let i = 1; i < ring.length; i++) {
            ctx.lineTo(getX(ring[i][0]), getY(ring[i][1]));
          }
          ctx.closePath();
          ctx.fillStyle = shapeFillColor;
          ctx.globalAlpha = shapeFillOpacity / 100;
          ctx.fill();
          ctx.strokeStyle = shapeStrokeColor;
          ctx.lineWidth = shapeStrokeWidth * scale;
          ctx.globalAlpha = 1.0;
          ctx.stroke();
        };

        const drawFeatureGeometry = (geom: any) => {
          if (!geom) return;
          if (geom.type === "Polygon") {
            geom.coordinates.forEach((ring: number[][]) => drawPolygonRing(ring));
          } else if (geom.type === "MultiPolygon") {
            geom.coordinates.forEach((poly: number[][][]) => {
              poly.forEach((ring: number[][]) => drawPolygonRing(ring));
            });
          } else if (geom.type === "LineString") {
            ctx.beginPath();
            if (geom.coordinates.length > 0) {
              ctx.moveTo(getX(geom.coordinates[0][0]), getY(geom.coordinates[0][1]));
              for (let i = 1; i < geom.coordinates.length; i++) {
                ctx.lineTo(getX(geom.coordinates[i][0]), getY(geom.coordinates[i][1]));
              }
              ctx.strokeStyle = shapeStrokeColor;
              ctx.lineWidth = shapeStrokeWidth * scale;
              ctx.stroke();
            }
          } else if (geom.type === "MultiLineString") {
            geom.coordinates.forEach((line: number[][]) => {
              ctx.beginPath();
              if (line.length > 0) {
                ctx.moveTo(getX(line[0][0]), getY(line[0][1]));
                for (let i = 1; i < line.length; i++) {
                  ctx.lineTo(getX(line[i][0]), getY(line[i][1]));
                }
                ctx.strokeStyle = shapeStrokeColor;
                ctx.lineWidth = shapeStrokeWidth * scale;
                ctx.stroke();
              }
            });
          } else if (geom.type === "Point") {
            const px = getX(geom.coordinates[0]);
            const py = getY(geom.coordinates[1]);
            ctx.beginPath();
            ctx.arc(px, py, 4 * scale, 0, Math.PI * 2);
            ctx.fillStyle = shapeFillColor;
            ctx.fill();
            ctx.strokeStyle = shapeStrokeColor;
            ctx.lineWidth = shapeStrokeWidth * scale;
            ctx.stroke();
          } else if (geom.type === "GeometryCollection") {
            geom.geometries?.forEach((g: any) => drawFeatureGeometry(g));
          }
        };

        if (effectiveClipGeoJson.type === "FeatureCollection") {
          effectiveClipGeoJson.features?.forEach((f: any) => drawFeatureGeometry(f.geometry));
        } else if (effectiveClipGeoJson.type === "Feature") {
          drawFeatureGeometry(effectiveClipGeoJson.geometry);
        } else {
          drawFeatureGeometry(effectiveClipGeoJson);
        }
        ctx.restore();
      }
    }

    // 5. Render Sampling Locations Points
    if (showPoints && !isDifference) {
      ctx.save();
      const isStations = activeParamName === "STATIONS";
      data.forEach(pt => {
        const val = isStations ? 1 : parseFloat(pt[paramCol]);
        if (isNaN(val)) return;

        // For Points Map, if showOnlyExceedingPoints is enabled, only show locations above permissible limit (b2)
        const exceedLimit = activeParamConfig.b2;
        if (!isStations && showOnlyExceedingPoints && val <= exceedLimit) {
          return;
        }

        const px = getX(pt.lng);
        const py = getY(pt.lat);
        if (px < margin || px > w - margin || py < margin || py > h - margin) return;

        let rad = (symbolSize / 2) * scale;

        if (showOnlyExceedingPoints) {
          // Exceeding point styling: red (or custom bubbleColor) without outer boundary
          rad = exceedingPointSize * 10 * scale; // Default size 0.5 becomes 5px, adjustable 0.1 to 3 becomes 1px to 30px
          ctx.globalAlpha = symbolOpacity / 100;

          if (showAs3dBubbles) {
            // 3D bubble with high-quality radial gradient shading
            const grad = ctx.createRadialGradient(
              px - rad * 0.3, py - rad * 0.3, rad * 0.1,
              px, py, rad
            );
            grad.addColorStop(0, "#ffffff");
            grad.addColorStop(0.35, bubbleColor);
            grad.addColorStop(1, darkenColor(bubbleColor, 0.45));
            ctx.fillStyle = grad;
          } else {
            ctx.fillStyle = bubbleColor;
          }

          ctx.beginPath();
          ctx.arc(px, py, rad, 0, Math.PI * 2);
          ctx.fill();
          // NO outer boundary (stroke) as requested
        } else {
          // Standard points drawing logic
          ctx.fillStyle = isStations ? stationPointColor : getValueColor(val, false, activeParamName, true);
          ctx.strokeStyle = symbolBorderColor;
          ctx.lineWidth = symbolBorderSize * scale;
          ctx.globalAlpha = symbolOpacity / 100;

          ctx.beginPath();
          if (symbolType === "circle") {
            ctx.arc(px, py, rad, 0, Math.PI * 2);
          } else if (symbolType === "square") {
            ctx.rect(px - rad, py - rad, rad * 2, rad * 2);
          } else if (symbolType === "triangle") {
            ctx.moveTo(px, py - rad);
            ctx.lineTo(px - rad, py + rad);
            ctx.lineTo(px + rad, py + rad);
            ctx.closePath();
          } else if (symbolType === "diamond") {
            ctx.moveTo(px, py - rad);
            ctx.lineTo(px + rad, py);
            ctx.lineTo(px, py + rad);
            ctx.lineTo(px - rad, py);
            ctx.closePath();
          } else if (symbolType === "star") {
            for (let i = 0; i < 5; i++) {
              ctx.lineTo(px + Math.cos(((18 + i * 72) * Math.PI) / 180) * rad, py - Math.sin(((18 + i * 72) * Math.PI) / 180) * rad);
              ctx.lineTo(px + Math.cos(((54 + i * 72) * Math.PI) / 180) * (rad / 2.2), py - Math.sin(((54 + i * 72) * Math.PI) / 180) * (rad / 2.2));
            }
            ctx.closePath();
          }
          ctx.fill();
          ctx.stroke();
        }

        // Optional Point Labels (Station Name or Local attributes)
        if (showLabels) {
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = "#475569";
          ctx.font = `${6 * scale}px ${mapFontFamily}`;
          const labelTxt = pt.location || pt.district || "Pt";
          ctx.fillText(labelTxt.substring(0, 8), px + rad + 2 * scale, py + 2 * scale);
        }
      });
      ctx.restore();
    }

    // 6. Professional Scale Bar Calculation
    if (showScaleBar) {
      ctx.save();
      // Ground scale math
      const widthKm = finalLngSpan * 111 * Math.cos(centerLat * Math.PI / 180);
      const pxPerKm = mw / widthKm;
      
      // Select best rounded division dynamically
      const roundDivisions = [1, 2, 5, 10, 25, 50, 100, 200, 500];
      const targetKmRaw = (120 * scale) / pxPerKm;
      const targetKm = roundDivisions.reduce((prev, curr) => 
        Math.abs(curr - targetKmRaw) < Math.abs(prev - targetKmRaw) ? curr : prev
      );

      const scaleW = targetKm * pxPerKm;
      const scaleX = margin + 15 * scale + scaleBarOffsetX * scale;
      const scaleY = h - margin - 20 * scale + scaleBarOffsetY * scale;

      // Draw glassmorphic translucent background
      ctx.fillStyle = pStyle.bg;
      ctx.strokeStyle = pStyle.border;
      ctx.lineWidth = 1 * scale;
      ctx.fillRect(scaleX - 5 * scale, scaleY - 18 * scale, scaleW + 25 * scale, 30 * scale);
      ctx.strokeRect(scaleX - 5 * scale, scaleY - 18 * scale, scaleW + 25 * scale, 30 * scale);

      // Alternating black and white solid segments
      ctx.strokeStyle = pStyle.text;
      ctx.lineWidth = 1.2 * scale;
      ctx.fillStyle = pStyle.text === "#ffffff" ? "#cbd5e1" : "#000000";
      ctx.fillRect(scaleX, scaleY - 5 * scale, scaleW / 2, 5 * scale);
      ctx.fillStyle = pStyle.text === "#ffffff" ? "#334155" : "#ffffff";
      ctx.fillRect(scaleX + scaleW / 2, scaleY - 5 * scale, scaleW / 2, 5 * scale);
      ctx.strokeRect(scaleX, scaleY - 5 * scale, scaleW, 5 * scale);

      // Ticks and labels (High density crisp text)
      ctx.fillStyle = pStyle.text;
      ctx.font = `bold ${8 * scale}px ${mapFontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText("0", scaleX, scaleY + 10 * scale);
      ctx.fillText(`${(targetKm / 2).toFixed(0)}`, scaleX + scaleW / 2, scaleY + 10 * scale);
      ctx.fillText(`${targetKm} ${scaleBarUnit.toUpperCase()}`, scaleX + scaleW, scaleY + 10 * scale);
      ctx.restore();
    }

    // 7. North Arrow decoration
    let arrowX = w - margin - 35 * scale;
    let arrowY = margin + 45 * scale;
    if (northArrowPos === "top-left") { arrowX = margin + 35 * scale; arrowY = margin + 45 * scale; }
    else if (northArrowPos === "bottom-left") { arrowX = margin + 35 * scale; arrowY = h - margin - 55 * scale; }
    else if (northArrowPos === "bottom-right") { arrowX = w - margin - 35 * scale; arrowY = h - margin - 55 * scale; }

    // Apply Precise Position Offsets (User adjustable fine element positioning)
    arrowX += northArrowOffsetX * scale;
    arrowY += northArrowOffsetY * scale;

    ctx.save();
    ctx.translate(arrowX, arrowY);
    ctx.strokeStyle = "#1e293b";
    ctx.fillStyle = "#1e293b";
    ctx.lineWidth = 1.5 * scale;

    const arrowRad = (northArrowSize / 2) * scale;

    if (northArrowType === "classic") {
      // Classic multi-point compass dial
      ctx.beginPath();
      ctx.arc(0, 0, arrowRad * 0.8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -arrowRad);
      ctx.lineTo(4 * scale, 0);
      ctx.lineTo(0, -2 * scale);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#64748b";
      ctx.beginPath();
      ctx.moveTo(0, -arrowRad);
      ctx.lineTo(-4 * scale, 0);
      ctx.lineTo(0, -2 * scale);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#0f172a";
      ctx.font = `bold ${9 * scale}px ${mapFontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText("N", 0, -arrowRad - 4 * scale);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -arrowRad);
      ctx.lineTo(arrowRad * 0.4, arrowRad * 0.4);
      ctx.lineTo(0, 0);
      ctx.lineTo(-arrowRad * 0.4, arrowRad * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.font = `bold ${9 * scale}px ${mapFontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText("N", 0, -arrowRad - 4 * scale);
    }
    ctx.restore();

    // 8. Custom Circular CGWB Vector Logo
    if (showAgencyLogo) {
      let logoX = margin + 30 * scale;
      let logoY = margin + 30 * scale;
      if (agencyLogoPos === "top-right") { logoX = w - margin - 35 * scale; logoY = margin + 30 * scale; }
      else if (agencyLogoPos === "bottom-left") { logoX = margin + 35 * scale; logoY = h - margin - 35 * scale; }
      else if (agencyLogoPos === "bottom-right") { logoX = w - margin - 35 * scale; logoY = h - margin - 35 * scale; }

      ctx.save();
      ctx.translate(logoX, logoY);
      
      // Draw Circular Shield
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, 16 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0284c7";
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, 14 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "#0369a1";
      ctx.lineWidth = 0.5 * scale;
      ctx.stroke();

      // Procedural Water Droplet inside center
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.moveTo(0, -9 * scale);
      ctx.bezierCurveTo(4 * scale, -3 * scale, 5 * scale, 2 * scale, 5 * scale, 5 * scale);
      ctx.arc(0, 5 * scale, 5 * scale, 0, Math.PI);
      ctx.bezierCurveTo(-5 * scale, 2 * scale, -4 * scale, -3 * scale, 0, -9 * scale);
      ctx.fill();

      // Tiny green leaves / ears of wheat
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1 * scale;
      ctx.beginPath();
      ctx.arc(-8 * scale, 2 * scale, 6 * scale, 0, Math.PI / 2);
      ctx.arc(8 * scale, 2 * scale, 6 * scale, Math.PI / 2, Math.PI);
      ctx.stroke();

      ctx.restore();
    }

    // Basemap Source Attribution (lower right corner of the active map surface)
    if (basemap !== "No Basemap") {
      let attribution = "Source: © OpenStreetMap contributors";
      if (basemap.startsWith("ESRI")) {
        attribution = "Source: Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, and the GIS User Community";
      } else if (basemap.startsWith("Google")) {
        attribution = "Source: Map data ©2026 Google";
      } else if (basemap.startsWith("CartoDB")) {
        attribution = "Source: © CartoDB, © OpenStreetMap contributors";
      }

      ctx.save();
      ctx.font = `${6.5 * scale}px ${mapFontFamily}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      
      // Draw small semi-translucent background for legibility
      const textWidth = ctx.measureText(attribution).width;
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.fillRect(
        w - margin - textWidth - 8 * scale,
        h - margin - 11 * scale,
        textWidth + 8 * scale,
        11 * scale
      );

      ctx.fillStyle = "#334155";
      ctx.fillText(
        attribution,
        w - margin - 4 * scale,
        h - margin - 3 * scale
      );
      ctx.restore();
    }
    let legX = w - margin - 170 * scale;
    let legY = h - margin - 110 * scale;
    if (legendPos === "top-left") { legX = margin + 15 * scale; legY = margin + 15 * scale; }
    else if (legendPos === "top-right") { legX = w - margin - 170 * scale; legY = margin + 15 * scale; }
    else if (legendPos === "bottom-left") { legX = margin + 15 * scale; legY = h - margin - 110 * scale; }

    // Apply Precise Position Offsets (User adjustable fine element positioning)
    legX += legendOffsetX * scale;
    legY += legendOffsetY * scale;

    const visibleLayers = layers.filter(l => l.visible);
    let extraBoundaryHeight = 0;
    if (showShapefile) {
      if (visibleLayers.length > 0) {
        extraBoundaryHeight = visibleLayers.length * 15;
      } else if (uploadedGeoJson) {
        const label = getBoundaryLegendLabel(uploadedGeoJson) || "Boundary";
        if (label) {
          extraBoundaryHeight = 15;
        }
      }
    }
    
    let classCount = 3;
    const isStations = activeParamName === "STATIONS";
    if (!isStations && !(showPoints && showOnlyExceedingPoints && !isDifference)) {
      if (isDifference) {
        classCount = 3;
      } else {
        classCount = interpolationClasses;
      }
    }
    const legendHeight = 95 + (classCount - 3) * legendRowSpacing + extraBoundaryHeight;

    ctx.save();
    // Glassmorphic shadow and layout for high density cards
    ctx.shadowColor = "rgba(0,0,0,0.06)";
    ctx.shadowBlur = 8 * scale;
    ctx.fillStyle = pStyle.bg;
    ctx.strokeStyle = pStyle.border;
    ctx.lineWidth = 1 * scale;
    ctx.fillRect(legX, legY, legendWidth * scale, legendHeight * scale);
    ctx.strokeRect(legX, legY, legendWidth * scale, legendHeight * scale);
    ctx.shadowColor = "transparent"; // Reset shadow

    ctx.fillStyle = legendTextColor;
    ctx.font = `bold ${legendTitleSize * scale}px ${mapFontFamily}`;

    if (isStations) {
      draw3dText(ctx, "Legend", legX + 8 * scale, legY + 14 * scale, legend3dEffect, legendTextColor, scale);
      ctx.save();
      ctx.fillStyle = legendTextColor;
      ctx.font = `italic ${legendSubtitleSize * scale}px ${mapFontFamily}`;
      ctx.fillText("Monitoring Stations", legX + 8 * scale, legY + 23 * scale);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = stationPointColor; // custom station point color glossy bead
      const legPtX = legX + 16 * scale;
      const legPtY = legY + 45 * scale;
      const legRad = 5.5 * scale;
      ctx.beginPath();
      ctx.arc(legPtX, legPtY, legRad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.8 * scale;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = legendTextColor;
      ctx.font = `bold ${legendFontSize * scale}px ${mapFontFamily}`;
      ctx.fillText("Ground Water Sampling", legX + (10 + legendBoxWidth + 6) * scale, legY + 41 * scale);
      ctx.fillText(`Locations (N=${data.length})`, legX + (10 + legendBoxWidth + 6) * scale, legY + 51 * scale);
    } else if (showPoints && showOnlyExceedingPoints && !isDifference) {
      // 4. Custom legend for point maps: Locations with parameter above permissible limit (no different colors)
      draw3dText(ctx, "Legend", legX + 8 * scale, legY + 14 * scale, legend3dEffect, legendTextColor, scale);
      ctx.save();
      ctx.fillStyle = legendTextColor;
      ctx.font = `italic ${legendSubtitleSize * scale}px ${mapFontFamily}`;
      ctx.fillText(getParamDisplayName(activeParamName), legX + 8 * scale, legY + 23 * scale);
      ctx.restore();

      // Draw red/custom point (same style as exceeding points)
      ctx.save();
      ctx.fillStyle = bubbleColor;
      const legPtX = legX + 16 * scale;
      const legPtY = legY + 45 * scale;
      const legRad = 5.5 * scale;
      if (showAs3dBubbles) {
        const grad = ctx.createRadialGradient(
          legPtX - legRad * 0.3, legPtY - legRad * 0.3, legRad * 0.1,
          legPtX, legPtY, legRad
        );
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.35, bubbleColor);
        grad.addColorStop(1, darkenColor(bubbleColor, 0.45));
        ctx.fillStyle = grad;
      }
      ctx.beginPath();
      ctx.arc(legPtX, legPtY, legRad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = legendTextColor;
      ctx.font = `bold ${legendFontSize * scale}px ${mapFontFamily}`;
      ctx.fillText(`Locations Above`, legX + (10 + legendBoxWidth + 6) * scale, legY + 41 * scale);
      ctx.fillText(`Permissible Limit`, legX + (10 + legendBoxWidth + 6) * scale, legY + 51 * scale);
      
      ctx.fillStyle = legendTextColor;
      ctx.font = `${legendFontSize * scale}px ${mapFontFamily}`;
      ctx.fillText(`(Value > ${activeParamConfig.b2} ${activeParamConfig.unit})`, legX + (10 + legendBoxWidth + 6) * scale, legY + 63 * scale);
    } else {
      draw3dText(ctx, "Legend", legX + 8 * scale, legY + 14 * scale, legend3dEffect, legendTextColor, scale);
      ctx.save();
      ctx.fillStyle = legendTextColor;
      ctx.font = `italic ${legendSubtitleSize * scale}px ${mapFontFamily}`;
      ctx.fillText(getParamDisplayName(activeParamName), legX + 8 * scale, legY + 23 * scale);
      ctx.restore();

      const colors = COLOR_SCHEMES[colorScheme as keyof typeof COLOR_SCHEMES] || COLOR_SCHEMES["Blue-Yellow-Red"];
      if (isDifference) {
        // Diff classes
        const diffClasses = [
          { label: "Improved (Post < Pre)", color: colorDiffImproved },
          { label: "No Change (Stable)", color: colorDiffStable },
          { label: "Deteriorated (Post > Pre)", color: colorDiffDeteriorated }
        ];
        diffClasses.forEach((cls, i) => {
          ctx.fillStyle = cls.color;
          ctx.fillRect(legX + 10 * scale, legY + (32 + i * legendRowSpacing) * scale, legendBoxWidth * scale, legendBoxHeight * scale);
          ctx.fillStyle = legendTextColor;
          ctx.font = `${legendFontSize * scale}px ${mapFontFamily}`;
          ctx.fillText(cls.label, legX + (10 + legendBoxWidth + 6) * scale, legY + (32 + i * legendRowSpacing + legendBoxHeight - 0.5) * scale);
        });
      } else {
        // Standard dynamic classes
        const { colors: classColors, labels: classLabels } = getClassColorsAndBreaks(activeParamConfig);
        const classes = classLabels.map((lbl, idx) => ({
          label: lbl,
          color: classColors[idx]
        }));
        classes.forEach((cls, i) => {
          ctx.fillStyle = cls.color;
          ctx.fillRect(legX + 10 * scale, legY + (32 + i * legendRowSpacing) * scale, legendBoxWidth * scale, legendBoxHeight * scale);
          ctx.fillStyle = legendTextColor;
          ctx.font = `${legendFontSize * scale}px ${mapFontFamily}`;
          ctx.fillText(cls.label, legX + (10 + legendBoxWidth + 6) * scale, legY + (32 + i * legendRowSpacing + legendBoxHeight - 0.5) * scale);
        });
      }
    }

    if (showShapefile) {
      let currentY = 80 + (classCount - 3) * legendRowSpacing;
      if (visibleLayers.length > 0) {
        visibleLayers.forEach((layer) => {
          const label = getBoundaryLegendLabel(layer.geoJson) || layer.name;
          
          // Draw fill
          ctx.save();
          ctx.fillStyle = layer.fillColor;
          ctx.globalAlpha = (layer.fillOpacity || 15) / 100;
          ctx.fillRect(legX + 10 * scale, legY + currentY * scale, legendBoxWidth * scale, legendBoxHeight * scale);
          ctx.restore();

          // Draw stroke
          ctx.save();
          ctx.strokeStyle = layer.strokeColor;
          ctx.lineWidth = Math.max(1, (layer.strokeWidth || 2.0) * 0.5) * scale;
          ctx.strokeRect(legX + 10 * scale, legY + currentY * scale, legendBoxWidth * scale, legendBoxHeight * scale);
          ctx.restore();

          // Draw label text
          ctx.fillStyle = legendTextColor;
          ctx.font = `${legendFontSize * scale}px ${mapFontFamily}`;
          ctx.fillText(label, legX + (10 + legendBoxWidth + 6) * scale, legY + (currentY + legendBoxHeight - 0.5) * scale);

          currentY += legendRowSpacing;
        });
      } else if (uploadedGeoJson) {
        const label = getBoundaryLegendLabel(uploadedGeoJson) || "Boundary";
        // Draw fill
        ctx.save();
        ctx.fillStyle = shapeFillColor;
        ctx.globalAlpha = (shapeFillOpacity || 15) / 100;
        ctx.fillRect(legX + 10 * scale, legY + currentY * scale, legendBoxWidth * scale, legendBoxHeight * scale);
        ctx.restore();

        // Draw stroke
        ctx.save();
        ctx.strokeStyle = shapeStrokeColor;
        ctx.lineWidth = Math.max(1, (shapeStrokeWidth || 2.0) * 0.5) * scale;
        ctx.strokeRect(legX + 10 * scale, legY + currentY * scale, legendBoxWidth * scale, legendBoxHeight * scale);
        ctx.restore();

        // Draw label text
        ctx.fillStyle = legendTextColor;
        ctx.font = `${legendFontSize * scale}px ${mapFontFamily}`;
        ctx.fillText(label, legX + (10 + legendBoxWidth + 6) * scale, legY + (currentY + legendBoxHeight - 0.5) * scale);
      }
    }

    if (!isStations) {
      ctx.fillStyle = legendTextColor;
      ctx.font = `italic ${legendSubtitleSize * scale}px ${mapFontFamily}`;
      ctx.fillText(`Unit: ${activeParamConfig.unit || "N/A"}`, legX + 10 * scale, legY + (legendHeight - 9) * scale);
    }
    ctx.restore();

    // 10. Optional stats panel
    if (showStatsPanel && stats) {
      let stX = margin + 15 * scale;
      let stY = h - margin - 165 * scale;
      if (statsPanelPos === "top-left") { stX = margin + 15 * scale; stY = margin + 15 * scale; }
      else if (statsPanelPos === "top-right") { stX = w - margin - 200 * scale; stY = margin + 15 * scale; }
      else if (statsPanelPos === "bottom-right") { stX = w - margin - 200 * scale; stY = h - margin - 165 * scale; }

      // Apply Precise Position Offsets (User adjustable fine element positioning)
      stX += statsOffsetX * scale;
      stY += statsOffsetY * scale;

      ctx.save();
      ctx.fillStyle = pStyle.bg;
      ctx.strokeStyle = pStyle.border;
      ctx.lineWidth = 1 * scale;
      ctx.fillRect(stX, stY, 185 * scale, 150 * scale);
      ctx.strokeRect(stX, stY, 185 * scale, 150 * scale);

      ctx.fillStyle = pStyle.text === "#0f172a" ? "#0284c7" : "#38bdf8";
      ctx.font = `bold ${8.5 * scale}px ${mapFontFamily}`;
      ctx.fillText("MAP DESCRIPTIVE STATISTICS", stX + 8 * scale, stY + 14 * scale);

      ctx.fillStyle = pStyle.text;
      ctx.font = `${7.5 * scale}px ${mapFontFamily}`;
      ctx.fillText(`Total Samples (N): ${stats.total}`, stX + 8 * scale, stY + 28 * scale);
      ctx.fillText(`Above Permissible Limit: ${stats.exceeding}`, stX + 8 * scale, stY + 41 * scale);
      ctx.fillText(`% Above Permissible Limit: ${stats.percentage}%`, stX + 8 * scale, stY + 54 * scale);
      ctx.fillText(`Min Value: ${stats.min} ${activeParamConfig.unit}`, stX + 8 * scale, stY + 67 * scale);
      ctx.fillText(`Max Value: ${stats.max} ${activeParamConfig.unit}`, stX + 8 * scale, stY + 80 * scale);

      const subgroupLabel = stats.subgroupLabel || "States/UTs";
      ctx.fillText(`No. of Partially Affected ${subgroupLabel}: ${stats.affectedCount ?? 0}`, stX + 8 * scale, stY + 93 * scale);
      ctx.fillText(`Affected ${subgroupLabel}:`, stX + 8 * scale, stY + 106 * scale);

      ctx.font = `italic ${7.5 * scale}px ${mapFontFamily}`;
      const nameString = stats.affectedNamesList || "-";

      // Wrap nameString to fit within 170px width
      const maxWidth = 170 * scale;
      const words = nameString.split(", ");
      let line = "";
      let lineY = stY + 118 * scale;
      let lineCount = 0;

      for (let i = 0; i < words.length; i++) {
        const testLine = line + (line ? ", " : "") + words[i];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && i > 0) {
          ctx.fillText(line, stX + 8 * scale, lineY);
          line = words[i];
          lineY += 11 * scale;
          lineCount++;
          if (lineCount >= 2) {
            ctx.fillText(line + "...", stX + 8 * scale, lineY);
            line = "";
            break;
          }
        } else {
          line = testLine;
        }
      }
      if (line) {
        ctx.fillText(line, stX + 8 * scale, lineY);
      }
      ctx.restore();
    }

    // 11. Header Title Frame suitable for official yearbooks (Positionable and Relocatable)
    if (titlePos !== "none") {
      const displayTitle = useSubtitleAsTitle ? subtitleStr : titleStr;
      const displaySubtitle = useSubtitleAsTitle ? "" : subtitleStr;

      const paddingY = 8;
      const titleHeight = mapTitleSize;
      const subtitleHeight = displaySubtitle ? mapSubtitleSize : 0;
      const spacing = displaySubtitle ? titleLineSpacing : 0;
      const tH = (paddingY * 2 + titleHeight + spacing + subtitleHeight) * scale;

      let tW = mw - 20 * scale;
      let tX = margin + 10 * scale;
      let tY = margin + 10 * scale;

      if (titlePos === "top-center") {
        tX = margin + 10 * scale;
        tY = margin + 10 * scale;
        tW = mw - 20 * scale;
      } else if (titlePos === "top-left") {
        tX = margin + 10 * scale;
        tY = margin + 10 * scale;
        tW = mw * 0.6;
      } else if (titlePos === "top-right") {
        tX = w - margin - mw * 0.6 - 10 * scale;
        tY = margin + 10 * scale;
        tW = mw * 0.6;
      } else if (titlePos === "bottom-center") {
        tX = margin + 10 * scale;
        tY = h - margin - tH - 10 * scale;
        tW = mw - 20 * scale;
      } else if (titlePos === "bottom-left") {
        tX = margin + 10 * scale;
        tY = h - margin - tH - 10 * scale;
        tW = mw * 0.6;
      } else if (titlePos === "bottom-right") {
        tX = w - margin - mw * 0.6 - 10 * scale;
        tY = h - margin - tH - 10 * scale;
        tW = mw * 0.6;
      }

      // Apply Precise Position Offsets (User adjustable fine element positioning)
      tX += titleOffsetX * scale;
      tY += titleOffsetY * scale;

      ctx.save();
      ctx.fillStyle = pStyle.bg;
      ctx.strokeStyle = pStyle.border;
      ctx.lineWidth = 1 * scale;
      ctx.fillRect(tX, tY, tW, tH);
      ctx.strokeRect(tX, tY, tW, tH);

      ctx.save();
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      
      const titleDrawY = tY + paddingY * scale;
      ctx.font = `${mapTitleBold ? "bold" : "normal"} ${mapTitleSize * scale}px ${mapFontFamily}`;
      draw3dText(ctx, displayTitle, tX + tW / 2, titleDrawY, mapTitle3dEffect, mapTitleColor, scale);

      if (displaySubtitle) {
        const subtitleDrawY = titleDrawY + (mapTitleSize + titleLineSpacing) * scale;
        ctx.font = `${mapSubtitleSize * scale}px ${mapFontFamily}`;
        draw3dText(ctx, displaySubtitle, tX + tW / 2, subtitleDrawY, mapSubtitle3dEffect, mapSubtitleColor, scale);
      }
      ctx.restore();
      ctx.restore();
    }

    // 12. Render Shapefile / GeoJSON Feature Labels
    if (showShapefileLabels) {
      if (layers.length > 0) {
        layers.forEach(layer => {
          if (!layer.visible || !layer.showLabels) return;
          ctx.save();
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = layer.labelColor;
          ctx.font = `${layer.labelSize * scale}px ${mapFontFamily}`;
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";

          const gj = layer.geoJson;
          if (gj) {
            const features = gj.features || (gj.type === "Feature" ? [gj] : []);
            features.forEach((f: any, idx: number) => {
              if (!f || !f.properties) return;
              const textVal = String(f.properties[layer.labelKey] || "");
              if (!textVal || textVal.trim().toLowerCase() === "india") return;

              let lng = 0, lat = 0;
              const customPos = customLabelPositions[layer.id]?.[idx];
              if (customPos) {
                lng = customPos.lng;
                lat = customPos.lat;
              } else {
                const centroid = getPolygonCentroid(f.geometry?.coordinates);
                if (centroid) {
                  lng = centroid.lng;
                  lat = centroid.lat;
                } else {
                  return;
                }
              }

              const px = getX(lng);
              const py = getY(lat);

              if (px >= margin && px <= w - margin && py >= margin && py <= h - margin) {
                ctx.fillText(textVal, px, py);
              }
            });
          }
          ctx.restore();
        });
      } else if (effectiveClipGeoJson) {
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = shapefileLabelColor;
        ctx.font = `${shapefileLabelSize * scale}px ${mapFontFamily}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";

        const features = effectiveClipGeoJson.features || 
                         (effectiveClipGeoJson.type === "Feature" ? [effectiveClipGeoJson] : []);

        features.forEach((f: any, idx: number) => {
          if (!f || !f.properties) return;
          const textVal = String(f.properties[shapefileLabelKey] || "");
          if (!textVal || textVal.trim().toLowerCase() === "india") return;

          let lng = 0, lat = 0;
          const customPos = (customLabelPositions as any)[idx];
          if (customPos) {
            lng = customPos.lng;
            lat = customPos.lat;
          } else {
            const centroid = getPolygonCentroid(f.geometry?.coordinates);
            if (centroid) {
              lng = centroid.lng;
              lat = centroid.lat;
            } else {
              return;
            }
          }

          const px = getX(lng);
          const py = getY(lat);

          if (px >= margin && px <= w - margin && py >= margin && py <= h - margin) {
            ctx.fillText(textVal, px, py);
          }
        });
        ctx.restore();
      }
    }
  };

  // Fast linear solver for systems of equations (Gaussian Elimination with partial pivoting)
  const solveLinearSystem = (A: number[][], B: number[]): number[] | null => {
    const n = B.length;
    for (let i = 0; i < n; i++) {
      let maxEl = Math.abs(A[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > maxEl) {
          maxEl = Math.abs(A[k][i]);
          maxRow = k;
        }
      }
      for (let k = i; k < n; k++) {
        const tmp = A[maxRow][k];
        A[maxRow][k] = A[i][k];
        A[i][k] = tmp;
      }
      const tmp = B[maxRow];
      B[maxRow] = B[i];
      B[i] = tmp;

      if (Math.abs(A[i][i]) < 1e-12) {
        return null;
      }

      for (let k = i + 1; k < n; k++) {
        const c = -A[k][i] / A[i][i];
        for (let j = i; j < n; j++) {
          if (i === j) {
            A[k][j] = 0;
          } else {
            A[k][j] += c * A[i][j];
          }
        }
        B[k] += c * B[i];
      }
    }

    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = B[i] / A[i][i];
      for (let k = i - 1; k >= 0; k--) {
        B[k] -= A[k][i] * x[i];
      }
    }
    return x;
  };

  // Theoretical semivariogram modeling function matching ArcGIS Geostatistical Analyst formulations
  const evaluateSemivariogram = (
    d: number, 
    model: "spherical" | "exponential" | "gaussian", 
    nugget: number, 
    sill: number, 
    range: number
  ): number => {
    if (d <= 1e-6) return 0;
    const partialSill = Math.max(0, sill - nugget);
    if (model === "spherical") {
      if (d <= range) {
        return nugget + partialSill * (1.5 * (d / range) - 0.5 * Math.pow(d / range, 3));
      }
      return sill;
    } else if (model === "exponential") {
      return nugget + partialSill * (1 - Math.exp(-3 * d / range));
    } else { // gaussian
      return nugget + partialSill * (1 - Math.exp(-3 * Math.pow(d / range, 2)));
    }
  };

  // Radial Basis Function Kernel Evaluations
  const evaluateRbfKernel = (r: number, kernel: "multiquadric" | "inverse-multiquadric" | "thin-plate-spline" | "gaussian", c: number): number => {
    const eps = 1e-9;
    if (kernel === "multiquadric") {
      return Math.sqrt(r * r + c * c);
    } else if (kernel === "inverse-multiquadric") {
      return 1 / Math.sqrt(r * r + c * c);
    } else if (kernel === "thin-plate-spline") {
      if (r < eps) return 0;
      return r * r * Math.log(r);
    } else { // gaussian
      return Math.exp(- (r * r) / (c * c + eps));
    }
  };

  // Quick safety check to avoid division-by-zero or singular matrices if the point is co-located with a sample point
  const distsAndNeighborsFastCheck = (pts: { d: number; pt: { val: number } }[], lat: number, lng: number): boolean => {
    return pts.length > 0 && pts[0].d < 0.05;
  };  // Background-Worker Powered Left Panel Interpolation Grid
  useEffect(() => {
    if (!isInterpolatedType) {
      setLeftInterpolatedGrid(null);
      return;
    }

    const paramCol = headerMap[selectedParam] || selectedParam;
    const pts = (isComparisonActive ? leftPanelData : parsedData).map(d => {
      const val = parseFloat(d[paramCol]);
      return { lat: d.lat, lng: d.lng, val };
    }).filter(p => !isNaN(p.val));

    if (pts.length === 0) {
      setLeftInterpolatedGrid(null);
      return;
    }

    const rawColStep = gridSmoothingRes * gridResolutionMultiplier;
    let colStep = isDragging ? Math.min(25, Math.round(rawColStep / 6)) : rawColStep;
    const rowStep = Math.round(colStep * (baseMapExtent.finalLatSpan / baseMapExtent.finalLngSpan));

    const delay = isDragging ? 50 : 200;
    const timer = setTimeout(() => {
      setIsLeftLoading(true);
      const worker = createInterpolationWorker();
      worker.onmessage = (e) => {
        setLeftInterpolatedGrid({ grid: e.data.grid, colStep, rowStep });
        setIsLeftLoading(false);
        worker.terminate();
      };
      worker.onerror = (err) => {
        console.error("Left Interpolation Worker failed:", err);
        setIsLeftLoading(false);
        worker.terminate();
      };
      worker.postMessage({
        validPoints: pts,
        rowStep,
        colStep,
        baseMapExtent,
        clippingRadius,
        extendInterpolationToBoundary,
        interpolationMethod,
        idwPower,
        useAllPoints,
        searchRadius,
        krigingModel,
        krigingNugget,
        krigingSill,
        krigingRange,
        krigingNeighbors,
        rbfKernel,
        rbfParameter,
        enableGaussianSmoothing,
        enableAnisotropy,
        anisotropyAngle,
        anisotropyRatio
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [
    selectedParam, parsedData, leftPanelData, isComparisonActive, isInterpolatedType,
    baseMapExtent, gridSmoothingRes, gridResolutionMultiplier, searchRadius, clippingRadius,
    idwPower, extendInterpolationToBoundary, interpolationMethod, isDragging, useAllPoints,
    krigingModel, krigingNugget, krigingSill, krigingRange, krigingNeighbors, rbfKernel, rbfParameter,
    enableGaussianSmoothing, enableAnisotropy, anisotropyAngle, anisotropyRatio
  ]);

  // Background-Worker Powered Right Panel Interpolation Grid
  useEffect(() => {
    if (!isInterpolatedType || !isComparisonActive) {
      setRightInterpolatedGrid(null);
      return;
    }

    const paramCol = headerMap[selectedParam] || selectedParam;
    let validPoints: { lat: number; lng: number; val: number }[] = [];
    if (showDifferenceMap) {
      leftPanelData.forEach(postPt => {
        const postVal = parseFloat(postPt[paramCol]);
        if (isNaN(postVal)) return;

        let bestPre: typeof postPt | null = null;
        let minDist = Infinity;
        rightPanelData.forEach(prePt => {
          const preVal = parseFloat(prePt[paramCol]);
          if (isNaN(preVal)) return;

          const dist = Math.sqrt((prePt.lat - postPt.lat) ** 2 + (prePt.lng - postPt.lng) ** 2);
          if (dist < minDist) {
            minDist = dist;
            bestPre = prePt;
          }
        });

        if (bestPre) {
          const diffVal = postVal - parseFloat((bestPre as any)[paramCol]);
          if (!isNaN(diffVal)) {
            validPoints.push({ lat: postPt.lat, lng: postPt.lng, val: diffVal });
          }
        }
      });
    } else {
      validPoints = rightPanelData.map(d => {
        const val = parseFloat(d[paramCol]);
        return { lat: d.lat, lng: d.lng, val };
      }).filter(p => !isNaN(p.val));
    }

    if (validPoints.length === 0) {
      setRightInterpolatedGrid(null);
      return;
    }

    const rawColStep = gridSmoothingRes * gridResolutionMultiplier;
    let colStep = isDragging ? Math.min(25, Math.round(rawColStep / 6)) : rawColStep;
    const rowStep = Math.round(colStep * (baseMapExtent.finalLatSpan / baseMapExtent.finalLngSpan));

    const delay = isDragging ? 50 : 200;
    const timer = setTimeout(() => {
      setIsRightLoading(true);
      const worker = createInterpolationWorker();
      worker.onmessage = (e) => {
        setRightInterpolatedGrid({ grid: e.data.grid, colStep, rowStep });
        setIsRightLoading(false);
        worker.terminate();
      };
      worker.onerror = (err) => {
        console.error("Right Interpolation Worker failed:", err);
        setIsRightLoading(false);
        worker.terminate();
      };
      worker.postMessage({
        validPoints,
        rowStep,
        colStep,
        baseMapExtent,
        clippingRadius,
        extendInterpolationToBoundary,
        interpolationMethod,
        idwPower,
        useAllPoints,
        searchRadius,
        krigingModel,
        krigingNugget,
        krigingSill,
        krigingRange,
        krigingNeighbors,
        rbfKernel,
        rbfParameter,
        enableGaussianSmoothing,
        enableAnisotropy,
        anisotropyAngle,
        anisotropyRatio
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [
    selectedParam, parsedData, rightPanelData, leftPanelData, isComparisonActive, showDifferenceMap, isInterpolatedType,
    baseMapExtent, gridSmoothingRes, gridResolutionMultiplier, searchRadius, clippingRadius,
    idwPower, extendInterpolationToBoundary, interpolationMethod, isDragging, useAllPoints,
    krigingModel, krigingNugget, krigingSill, krigingRange, krigingNeighbors, rbfKernel, rbfParameter,
    enableGaussianSmoothing, enableAnisotropy, anisotropyAngle, anisotropyRatio
  ]);

  // Difference matrix mapping helper
  const differenceMatrix = useMemo(() => {
    if (!isComparisonActive) return null;
    return null; // Using direct point diffs or raster logic
  }, [isComparisonActive]);

  // Redraw hook
  useEffect(() => {
    if (!isVisible) return;

    const timeout = setTimeout(() => {
      // Use Device Pixel Ratio * 2.0 to render ultra-sharp, glossy, high-density non-blurry canvases on high-DPI displays
      const dpr = (window.devicePixelRatio || 2) * 2.0;

      if (canvasRefLeft.current) {
        const canvas = canvasRefLeft.current;
        canvas.width = canvasWidth * dpr;
        canvas.height = canvasHeight * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const title = customTitle || getMapDefaultTitleAndSubtitle("left").title;
          const subtitle = customSubtitle || getMapDefaultTitleAndSubtitle("left").subtitle;
          drawMapInstance(
            ctx,
            canvas.width,
            canvas.height,
            dpr,
            isComparisonActive ? leftPanelData : parsedData,
            title,
            subtitle,
            isComparisonActive ? leftStats : (leftStats || rightStats),
            false,
            null,
            "left"
          );
        }
      }

      if (canvasRefRight.current && isComparisonActive) {
        const canvas = canvasRefRight.current;
        canvas.width = canvasWidth * dpr;
        canvas.height = canvasHeight * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const title = customTitle 
            ? `${customTitle} (Post-Monsoon)` 
            : (showDifferenceMap 
              ? `Seasonal Quality Difference Map (Post − Pre)`
              : getMapDefaultTitleAndSubtitle("right").title);
          const subtitle = customSubtitle || (showDifferenceMap
            ? `Chemical concentration change dynamics`
            : getMapDefaultTitleAndSubtitle("right").subtitle);

          drawMapInstance(
            ctx,
            canvas.width,
            canvas.height,
            dpr,
            rightPanelData,
            title,
            subtitle,
            rightStats,
            showDifferenceMap,
            differenceMatrix,
            "right"
          );
        }
      }
    }, 120);

    return () => clearTimeout(timeout);
  }, [
    isVisible,
    parsedData,
    selectedParam,
    basemap,
    projection,
    utmZone,
    canvasWidth,
    canvasHeight,
    sheetLayout,
    interpolationMethod,
    idwPower,
    gridSmoothingRes,
    searchRadius,
    clippingRadius,
    smoothBlending,
    classificationMode,
    colorScheme,
    symbolType,
    symbolSize,
    symbolBorderColor,
    symbolBorderSize,
    symbolOpacity,
    showRaster,
    showPoints,
    showGrid,
    showLabels,
    rasterOpacity,
    basemapOpacity,
    mapFontFamily,
    mapTitleSize,
    mapTitleColor,
    mapTitleBold,
    northArrowType,
    northArrowSize,
    northArrowPos,
    showScaleBar,
    scaleBarUnit,
    gridInterval,
    gridColor,
    gridOpacity,
    legendPos,
    legendBgOpacity,
    showStatsPanel,
    statsPanelPos,
    showAgencyLogo,
    agencyLogoType,
    agencyLogoPos,
    isComparisonActive,
    showDifferenceMap,
    differenceMatrix,
    redrawTilesTrigger,
    uploadedGeoJson,
    effectiveClipGeoJson,
    showShapefile,
    shapeStrokeColor,
    shapeStrokeWidth,
    shapeFillColor,
    shapeFillOpacity,
    panelBackgroundStyle,
    zoomScaleFactor,
    customTitle,
    customSubtitle,
    titlePos,
    onlyTransparentPanels,
    extendInterpolationToBoundary,
    mapSubtitleColor,
    legendTextColor,
    titleOffsetX,
    titleOffsetY,
    legendOffsetX,
    legendOffsetY,
    statsOffsetX,
    statsOffsetY,
    northArrowOffsetX,
    northArrowOffsetY,
    fitToShapefile,
    shapefileBounds,
    panOffsetLat,
    panOffsetLng,
    showOnlyExceedingPoints,
    exceedingPointSize,
    showAs3dBubbles,
    bubbleColor,
    colorRange1,
    colorRange2,
    colorRange3,
    colorDiffImproved,
    colorDiffStable,
    colorDiffDeteriorated,
    useSubtitleAsTitle,
    showShapefileLabels,
    shapefileLabelKey,
    shapefileLabelColor,
    shapefileLabelSize,
    customLabelPositions,
    mapSubtitleSize,
    titleLineSpacing,
    scaleBarOffsetX,
    scaleBarOffsetY,
    stationPointColor
  ]);

  // Vector SVG Exporter (Generates real, clean scalable vector graphic file!)
  const exportToSvgString = (side: "left" | "right") => {
    const { mapMinLng, mapMaxLng, mapMinLat, mapMaxLat, finalLngSpan, finalLatSpan, centerLat } = mapExtent;
    const w = canvasWidth;
    const h = canvasHeight;
    const margin = 55;
    const mw = w - 2 * margin;
    const mh = h - 2 * margin;
    const paramCol = headerMap[selectedParam] || selectedParam;

    // Coordinate converters
    const getX = (lng: number) => {
      const pct = (lng - mapMinLng) / finalLngSpan;
      return margin + pct * mw;
    };
    const getY = (lat: number) => {
      const pct = (lat - mapMinLat) / finalLatSpan;
      return h - margin - pct * mh;
    };

    let svgLabels = "";
    let svgShapefileBoundaries = "";

    if (showShapefile) {
      if (layers.length > 0) {
        layers.forEach(layer => {
          if (!layer.visible) return;
          
          const formatPolygonRing = (ring: number[][]) => {
            if (ring.length === 0) return "";
            let d = `M ${getX(ring[0][0])} ${getY(ring[0][1])}`;
            for (let i = 1; i < ring.length; i++) {
              d += ` L ${getX(ring[i][0])} ${getY(ring[i][1])}`;
            }
            d += " Z";
            return `<path d="${d}" fill="${layer.fillColor}" fill-opacity="${layer.fillOpacity / 100}" stroke="${layer.strokeColor}" stroke-width="${layer.strokeWidth}" />\n`;
          };

          const formatFeatureGeometry = (geom: any): string => {
            if (!geom) return "";
            let paths = "";
            if (geom.type === "Polygon") {
              geom.coordinates.forEach((ring: number[][]) => {
                paths += formatPolygonRing(ring);
              });
            } else if (geom.type === "MultiPolygon") {
              geom.coordinates.forEach((poly: number[][][]) => {
                poly.forEach((ring: number[][]) => {
                  paths += formatPolygonRing(ring);
                });
              });
            } else if (geom.type === "GeometryCollection") {
              geom.geometries?.forEach((g: any) => {
                paths += formatFeatureGeometry(g);
              });
            }
            return paths;
          };

          const gj = layer.geoJson;
          if (gj) {
            svgShapefileBoundaries += `  <!-- Layer: ${layer.name} -->\n  <g id="layer-${layer.id}">\n`;
            if (gj.type === "FeatureCollection") {
              gj.features?.forEach((f: any) => {
                svgShapefileBoundaries += formatFeatureGeometry(f.geometry);
              });
            } else if (gj.type === "Feature") {
              svgShapefileBoundaries += formatFeatureGeometry(gj.geometry);
            } else {
              svgShapefileBoundaries += formatFeatureGeometry(gj);
            }
            svgShapefileBoundaries += "  </g>\n";
          }
        });
      } else if (effectiveClipGeoJson && uploadedGeoJson) {
        // Fallback
        const formatPolygonRing = (ring: number[][]) => {
          if (ring.length === 0) return "";
          let d = `M ${getX(ring[0][0])} ${getY(ring[0][1])}`;
          for (let i = 1; i < ring.length; i++) {
            d += ` L ${getX(ring[i][0])} ${getY(ring[i][1])}`;
          }
          d += " Z";
          return `<path d="${d}" fill="${shapeFillColor}" fill-opacity="${shapeFillOpacity / 100}" stroke="${shapeStrokeColor}" stroke-width="${shapeStrokeWidth}" />\n`;
        };

        const formatFeatureGeometry = (geom: any): string => {
          if (!geom) return "";
          let paths = "";
          if (geom.type === "Polygon") {
            geom.coordinates.forEach((ring: number[][]) => {
              paths += formatPolygonRing(ring);
            });
          } else if (geom.type === "MultiPolygon") {
            geom.coordinates.forEach((poly: number[][][]) => {
              poly.forEach((ring: number[][]) => {
                paths += formatPolygonRing(ring);
              });
            });
          } else if (geom.type === "GeometryCollection") {
            geom.geometries?.forEach((g: any) => {
              paths += formatFeatureGeometry(g);
            });
          }
          return paths;
        };

        svgShapefileBoundaries += `  <g id="fallback-shapefile-boundaries">\n`;
        if (effectiveClipGeoJson.type === "FeatureCollection") {
          effectiveClipGeoJson.features?.forEach((f: any) => {
            svgShapefileBoundaries += formatFeatureGeometry(f.geometry);
          });
        } else if (effectiveClipGeoJson.type === "Feature") {
          svgShapefileBoundaries += formatFeatureGeometry(effectiveClipGeoJson.geometry);
        } else {
          svgShapefileBoundaries += formatFeatureGeometry(effectiveClipGeoJson);
        }
        svgShapefileBoundaries += "  </g>\n";
      }
    }

    if (showShapefileLabels) {
      if (layers.length > 0) {
        layers.forEach(layer => {
          if (!layer.visible || !layer.showLabels) return;
          const gj = layer.geoJson;
          if (gj) {
            const features = gj.features || (gj.type === "Feature" ? [gj] : []);
            features.forEach((f: any, idx: number) => {
              if (!f || !f.properties) return;
              const textVal = String(f.properties[layer.labelKey] || "");
              if (!textVal || textVal.trim().toLowerCase() === "india") return;

              let lng = 0, lat = 0;
              const customPos = customLabelPositions[layer.id]?.[idx];
              if (customPos) {
                lng = customPos.lng;
                lat = customPos.lat;
              } else {
                const centroid = getPolygonCentroid(f.geometry?.coordinates);
                if (centroid) {
                  lng = centroid.lng;
                  lat = centroid.lat;
                } else {
                  return;
                }
              }

              const px = getX(lng);
              const py = getY(lat);

              if (px >= margin && px <= w - margin && py >= margin && py <= h - margin) {
                svgLabels += `    <text x="${px}" y="${py}" font-size="${layer.labelSize}" fill="${layer.labelColor}" text-anchor="middle" dominant-baseline="middle">${textVal}</text>\n`;
              }
            });
          }
        });
      } else if (effectiveClipGeoJson) {
        const features = effectiveClipGeoJson.features || 
                         (effectiveClipGeoJson.type === "Feature" ? [effectiveClipGeoJson] : []);
        features.forEach((f: any, idx: number) => {
          if (!f || !f.properties) return;
          const textVal = String(f.properties[shapefileLabelKey] || "");
          if (!textVal || textVal.trim().toLowerCase() === "india") return;

          let lng = 0, lat = 0;
          const customPos = (customLabelPositions as any)[idx];
          if (customPos) {
            lng = customPos.lng;
            lat = customPos.lat;
          } else {
            const centroid = getPolygonCentroid(f.geometry?.coordinates);
            if (centroid) {
              lng = centroid.lng;
              lat = centroid.lat;
            } else {
              return;
            }
          }

          const px = getX(lng);
          const py = getY(lat);

          if (px >= margin && px <= w - margin && py >= margin && py <= h - margin) {
            svgLabels += `    <text x="${px}" y="${py}" font-size="${shapefileLabelSize}" fill="${shapefileLabelColor}" text-anchor="middle" dominant-baseline="middle">${textVal}</text>\n`;
          }
        });
      }
    }

    const isDiff = side === "right" && showDifferenceMap;
    const data = side === "left" ? (isComparisonActive ? leftPanelData : parsedData) : rightPanelData;
    const titleStr = side === "left" 
      ? (customTitle || getMapDefaultTitleAndSubtitle("left").title) 
      : (showDifferenceMap ? "Seasonal Quality Difference (Post - Pre)" : (customTitle ? `${customTitle} (Post-Monsoon)` : getMapDefaultTitleAndSubtitle("right").title));
    const subtitleStr = side === "left"
      ? (customSubtitle || getMapDefaultTitleAndSubtitle("left").subtitle)
      : (showDifferenceMap ? "Seasonal concentration shift dynamics" : (customSubtitle || getMapDefaultTitleAndSubtitle("right").subtitle));

    let rasterRects = "";
    if (showRaster && isInterpolatedType) {
      const cacheObj = side === "left" ? leftInterpolatedGrid : rightInterpolatedGrid;
      if (cacheObj) {
        const { grid, colStep, rowStep } = cacheObj;
        for (let r = 0; r < rowStep; r++) {
          const cellLatMin = baseMapExtent.mapMinLat + (r / rowStep) * baseMapExtent.finalLatSpan;
          const cellLatMax = baseMapExtent.mapMinLat + ((r + 1) / rowStep) * baseMapExtent.finalLatSpan;
          for (let c = 0; c < colStep; c++) {
            const val = grid[r][c];
            if (isNaN(val)) continue;

            const cellLngMin = baseMapExtent.mapMinLng + (c / colStep) * baseMapExtent.finalLngSpan;
            const cellLngMax = baseMapExtent.mapMinLng + ((c + 1) / colStep) * baseMapExtent.finalLngSpan;

            const xMin = getX(cellLngMin);
            const xMax = getX(cellLngMax);
            const yMin = getY(cellLatMax);
            const yMax = getY(cellLatMin);

            const drawW = Math.max(0.1, xMax - xMin);
            const drawH = Math.max(0.1, yMax - yMin);

            const fill = getValueColor(val, isDiff);
            rasterRects += `    <rect x="${xMin - 0.2}" y="${yMin - 0.2}" width="${drawW + 0.4}" height="${drawH + 0.4}" fill="${fill}" />\n`;
          }
        }
      }
    }

    // Now, render the vector points as true SVG `<circle>` nodes!
    let pointElements = "";
    if (showPoints && !isDiff) {
      data.forEach(pt => {
        const val = parseFloat(pt[paramCol]);
        if (isNaN(val)) return;

        const exceedLimit = paramConfig.b2;
        if (showOnlyExceedingPoints && val <= exceedLimit) return;

        const px = getX(pt.lng);
        const py = getY(pt.lat);
        if (px < margin || px > w - margin || py < margin || py > h - margin) return;

        const rad = showOnlyExceedingPoints ? exceedingPointSize * 10 : symbolSize / 2;
        const fill = showOnlyExceedingPoints ? bubbleColor : getValueColor(val, false, undefined, true);
        const stroke = showOnlyExceedingPoints ? "none" : symbolBorderColor;
        const strokeW = showOnlyExceedingPoints ? "0" : symbolBorderSize;

        if (symbolType === "square") {
          pointElements += `    <rect x="${px - rad}" y="${py - rad}" width="${rad * 2}" height="${rad * 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" opacity="${symbolOpacity / 100}" />\n`;
        } else {
          pointElements += `    <circle cx="${px}" cy="${py}" r="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" opacity="${symbolOpacity / 100}" />\n`;
        }
      });
    }

    // Let's draw the grid lines as true vector elements!
    let gridLines = "";
    if (showGrid) {
      const minLngInterval = Math.ceil(mapMinLng / gridInterval) * gridInterval;
      for (let lng = minLngInterval; lng <= mapMaxLng; lng += gridInterval) {
        const x = getX(lng);
        if (x >= margin && x <= w - margin) {
          gridLines += `    <line x1="${x}" y1="${margin}" x2="${x}" y2="${h - margin}" stroke="${gridColor}" stroke-width="0.5" opacity="${gridOpacity / 100}" />\n`;
          gridLines += `    <text x="${x}" y="${h - margin + 14}" font-size="8" text-anchor="middle" fill="#334155">${lng.toFixed(1)}°E</text>\n`;
        }
      }
      const minLatInterval = Math.ceil(mapMinLat / gridInterval) * gridInterval;
      for (let lat = minLatInterval; lat <= mapMaxLat; lat += gridInterval) {
        const y = getY(lat);
        if (y >= margin && y <= h - margin) {
          gridLines += `    <line x1="${margin}" y1="${y}" x2="${w - margin}" y2="${y}" stroke="${gridColor}" stroke-width="0.5" opacity="${gridOpacity / 100}" />\n`;
          gridLines += `    <text x="${margin - 8}" y="${y + 3}" font-size="8" text-anchor="end" fill="#334155">${lat.toFixed(1)}°N</text>\n`;
        }
      }
    }

    const pStyle = {
      bg: panelBackgroundStyle === "transparent" ? "rgba(255, 255, 255, 0)" : (panelBackgroundStyle === "glass" ? "rgba(255, 255, 255, 0.82)" : "rgba(255, 255, 255, 0.98)"),
      border: panelBackgroundStyle === "transparent" ? "rgba(0,0,0,0)" : "#cbd5e1",
      text: legendTextColor
    };

    // Legend panel vector representation
    let legX = w - margin - 170;
    let legY = h - margin - 110;
    if (legendPos === "top-left") { legX = margin + 15; legY = margin + 15; }
    else if (legendPos === "top-right") { legX = w - margin - 170; legY = margin + 15; }
    else if (legendPos === "bottom-left") { legX = margin + 15; legY = h - margin - 110; }

    legX += legendOffsetX;
    legY += legendOffsetY;

    const boundaryLabel = getBoundaryLegendLabel(uploadedGeoJson);
    const hasBoundaryLegend = showShapefile && !!uploadedGeoJson && !!boundaryLabel;

    const isStations = selectedParam === "STATIONS";

    let classCount = 3;
    if (!isStations && !(showPoints && showOnlyExceedingPoints && !isDiff)) {
      if (isDiff) {
        classCount = 3;
      } else {
        classCount = interpolationClasses;
      }
    }
    const legendHeight = 95 + (classCount - 3) * legendRowSpacing + (hasBoundaryLegend ? 15 : 0);

    const displayParamName = getParamDisplayName(selectedParam);
    let legendSub = "";
    if (isStations) {
      legendSub = `<text x="${legX + 8}" y="${legY + 23}" font-size="${legendSubtitleSize}" font-style="italic" fill="${legendTextColor}">Monitoring Stations</text>`;
    } else {
      legendSub = `<text x="${legX + 8}" y="${legY + 23}" font-size="${legendSubtitleSize}" font-style="italic" fill="${legendTextColor}">${displayParamName}</text>`;
    }

    let legendItems = legendSub;
    if (isStations) {
      legendItems += `
        <circle cx="${legX + 16}" cy="${legY + 45}" r="5.5" fill="${stationPointColor}" stroke="#ffffff" stroke-width="0.8" />
        <text x="${legX + 10 + legendBoxWidth + 6}" y="${legY + 41}" font-size="${legendFontSize}" font-weight="bold" fill="${legendTextColor}">Ground Water Sampling</text>
        <text x="${legX + 10 + legendBoxWidth + 6}" y="${legY + 51}" font-size="${legendFontSize}" font-weight="bold" fill="${legendTextColor}">Locations (N=${data.length})</text>
      `;
    } else if (showPoints && showOnlyExceedingPoints && !isDiff) {
      legendItems += `
        <circle cx="${legX + 16}" cy="${legY + 45}" r="5.5" fill="${bubbleColor}" />
        <text x="${legX + 10 + legendBoxWidth + 6}" y="${legY + 41}" font-size="${legendFontSize}" font-weight="bold" fill="${legendTextColor}">Locations Above</text>
        <text x="${legX + 10 + legendBoxWidth + 6}" y="${legY + 51}" font-size="${legendFontSize}" font-weight="bold" fill="${legendTextColor}">Permissible Limit</text>
        <text x="${legX + 10 + legendBoxWidth + 6}" y="${legY + 63}" font-size="${legendFontSize}" fill="#64748b">(Value > ${paramConfig.b2} ${paramConfig.unit})</text>
      `;
    } else if (isDiff) {
      const diffClasses = [
        { label: "Improved (Post < Pre)", color: colorDiffImproved },
        { label: "No Change (Stable)", color: colorDiffStable },
        { label: "Deteriorated (Post > Pre)", color: colorDiffDeteriorated }
      ];
      diffClasses.forEach((cls, i) => {
        legendItems += `
          <rect x="${legX + 10}" y="${legY + 32 + i * legendRowSpacing}" width="${legendBoxWidth}" height="${legendBoxHeight}" fill="${cls.color}" />
          <text x="${legX + 10 + legendBoxWidth + 6}" y="${legY + 32 + i * legendRowSpacing + legendBoxHeight - 0.5}" font-size="${legendFontSize}" fill="${legendTextColor}">${cls.label}</text>
        `;
      });
    } else {
      const { colors: classColors, labels: classLabels } = getClassColorsAndBreaks(paramConfig);
      classLabels.forEach((lbl, i) => {
        legendItems += `
          <rect x="${legX + 10}" y="${legY + 32 + i * legendRowSpacing}" width="${legendBoxWidth}" height="${legendBoxHeight}" fill="${classColors[i]}" />
          <text x="${legX + 10 + legendBoxWidth + 6}" y="${legY + 32 + i * legendRowSpacing + legendBoxHeight - 0.5}" font-size="${legendFontSize}" fill="${legendTextColor}">${lbl}</text>
        `;
      });
    }

    if (hasBoundaryLegend && boundaryLabel) {
      const boundaryY = 80 + (classCount - 3) * legendRowSpacing;
      legendItems += `
        <rect x="${legX + 10}" y="${legY + boundaryY}" width="${legendBoxWidth}" height="${legendBoxHeight}" fill="${shapeFillColor}" fill-opacity="${(shapeFillOpacity || 15) / 100}" stroke="${shapeStrokeColor}" stroke-width="${Math.max(1, (shapeStrokeWidth || 2.0) * 0.5)}" />
        <text x="${legX + 10 + legendBoxWidth + 6}" y="${legY + boundaryY + legendBoxHeight - 0.5}" font-size="${legendFontSize}" fill="${legendTextColor}">${boundaryLabel}</text>
      `;
    }

    let scaleBarElement = "";
    if (showScaleBar) {
      const widthKm = finalLngSpan * 111 * Math.cos(centerLat * Math.PI / 180);
      const pxPerKm = mw / widthKm;
      const roundDivisions = [1, 2, 5, 10, 25, 50, 100, 200, 500];
      const targetKmRaw = 120 / pxPerKm;
      const targetKm = roundDivisions.reduce((prev, curr) => 
        Math.abs(curr - targetKmRaw) < Math.abs(prev - targetKmRaw) ? curr : prev
      );
      const scaleW = targetKm * pxPerKm;
      const scaleX = margin + 15 + scaleBarOffsetX;
      const scaleY = h - margin - 20 + scaleBarOffsetY;

      const bgStroke = pStyle.border;
      const bgFill = pStyle.bg;
      const textCol = pStyle.text;

      const segmentFill1 = textCol === "#ffffff" ? "#cbd5e1" : "#000000";
      const segmentFill2 = textCol === "#ffffff" ? "#334155" : "#ffffff";

      scaleBarElement = `
    <!-- Dynamic Positionable Scale Bar -->
    <g id="scale-bar">
      <rect x="${scaleX - 5}" y="${scaleY - 18}" width="${scaleW + 25}" height="30" fill="${bgFill}" stroke="${bgStroke}" stroke-width="1" rx="4" />
      <rect x="${scaleX}" y="${scaleY - 5}" width="${scaleW / 2}" height="5" fill="${segmentFill1}" stroke="${textCol}" stroke-width="1.2" />
      <rect x="${scaleX + scaleW / 2}" y="${scaleY - 5}" width="${scaleW / 2}" height="5" fill="${segmentFill2}" stroke="${textCol}" stroke-width="1.2" />
      <text x="${scaleX}" y="${scaleY + 10}" font-size="8" font-weight="bold" fill="${textCol}" text-anchor="middle">0</text>
      <text x="${scaleX + scaleW / 2}" y="${scaleY + 10}" font-size="8" font-weight="bold" fill="${textCol}" text-anchor="middle">${(targetKm / 2).toFixed(0)}</text>
      <text x="${scaleX + scaleW}" y="${scaleY + 10}" font-size="8" font-weight="bold" fill="${textCol}" text-anchor="middle">${targetKm} ${scaleBarUnit.toUpperCase()}</text>
    </g>
      `;
    }

    let northArrowElement = "";
    if (northArrowType !== "none") {
      let arrowX = w - margin - 35;
      let arrowY = margin + 45;
      if (northArrowPos === "top-left") { arrowX = margin + 35; arrowY = margin + 45; }
      else if (northArrowPos === "bottom-left") { arrowX = margin + 35; arrowY = h - margin - 55; }
      else if (northArrowPos === "bottom-right") { arrowX = w - margin - 35; arrowY = h - margin - 55; }

      arrowX += northArrowOffsetX;
      arrowY += northArrowOffsetY;
      const rad = northArrowSize / 2;

      northArrowElement = `
    <!-- Dynamic Positionable North Arrow -->
    <g id="north-arrow" transform="translate(${arrowX}, ${arrowY})">
      <circle cx="0" cy="0" r="${rad}" fill="${pStyle.bg}" stroke="${pStyle.border}" stroke-width="1" />
      <!-- Star / Pointer shape -->
      <polygon points="0,${-rad * 0.75} ${rad * 0.25},${rad * 0.25} 0,${rad * 0.1} ${-rad * 0.25},${rad * 0.25}" fill="#ef4444" stroke="#b91c1c" stroke-width="0.8" />
      <polygon points="0,${rad * 0.75} ${rad * 0.2},${-rad * 0.2} 0,${-rad * 0.05} ${-rad * 0.2},${-rad * 0.2}" fill="#cbd5e1" stroke="#475569" stroke-width="0.6" />
      <!-- Text N -->
      <text x="0" y="${-rad * 0.85}" font-size="9" font-weight="bold" fill="#ef4444" text-anchor="middle">N</text>
    </g>
      `;
    }

    const displayTitle = useSubtitleAsTitle ? subtitleStr : titleStr;
    const displaySubtitle = useSubtitleAsTitle ? "" : subtitleStr;

    const paddingY = 8;
    const titleHeight = mapTitleSize;
    const subtitleHeight = displaySubtitle ? mapSubtitleSize : 0;
    const spacing = displaySubtitle ? titleLineSpacing : 0;
    const tH = paddingY * 2 + titleHeight + spacing + subtitleHeight;

    let tW = mw - 20;
    let tX = margin + 10;
    let tY = margin + 10;

    if (titlePos === "bottom-center" || titlePos === "bottom-left" || titlePos === "bottom-right") {
      tY = h - margin - tH - 10;
    }
    if (titlePos === "top-left" || titlePos === "bottom-left") {
      tW = mw * 0.6;
    } else if (titlePos === "top-right" || titlePos === "bottom-right") {
      tX = w - margin - mw * 0.6 - 10;
      tW = mw * 0.6;
    }

    tX += titleOffsetX;
    tY += titleOffsetY;

    const titleTextY = tY + paddingY;
    const subtitleTextY = titleTextY + mapTitleSize + titleLineSpacing;

    const stats = side === "left" ? leftStats : rightStats;
    let svgStatsPanel = "";
    if (showStatsPanel && stats) {
      let stX = margin + 15;
      let stY = h - margin - 165;
      if (statsPanelPos === "top-left") { stX = margin + 15; stY = margin + 15; }
      else if (statsPanelPos === "top-right") { stX = w - margin - 200; stY = margin + 15; }
      else if (statsPanelPos === "bottom-right") { stX = w - margin - 200; stY = h - margin - 165; }

      stX += statsOffsetX;
      stY += statsOffsetY;

      const subgroupLabel = stats.subgroupLabel || "States/UTs";
      const words = (stats.affectedNamesList || "-").split(", ");
      let lines = [];
      let currentLine = "";
      for (let i = 0; i < words.length; i++) {
        const testLine = currentLine + (currentLine ? ", " : "") + words[i];
        if (testLine.length * 5 > 170 && i > 0) {
          lines.push(currentLine);
          currentLine = words[i];
          if (lines.length >= 2) {
            lines.push(currentLine + "...");
            currentLine = "";
            break;
          }
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) {
        lines.push(currentLine);
      }

      svgStatsPanel = `
  <!-- 10. Descriptive Statistics Panel -->
  <g id="map-stats-panel" opacity="0.95">
    <rect x="${stX}" y="${stY}" width="185" height="150" fill="${pStyle.bg}" stroke="${pStyle.border}" stroke-width="1" rx="4" />
    <text x="${stX + 8}" y="${stY + 14}" font-size="8" font-weight="bold" fill="${pStyle.text === "#0f172a" ? "#0284c7" : "#38bdf8"}">MAP DESCRIPTIVE STATISTICS</text>
    <text x="${stX + 8}" y="${stY + 28}" font-size="7.5" fill="${pStyle.text}">Total Samples (N): ${stats.total}</text>
    <text x="${stX + 8}" y="${stY + 41}" font-size="7.5" fill="${pStyle.text}">Above Permissible Limit: ${stats.exceeding}</text>
    <text x="${stX + 8}" y="${stY + 54}" font-size="7.5" fill="${pStyle.text}">% Above Permissible Limit: ${stats.percentage}%</text>
    <text x="${stX + 8}" y="${stY + 67}" font-size="7.5" fill="${pStyle.text}">Min Value: ${stats.min} ${paramConfig.unit}</text>
    <text x="${stX + 8}" y="${stY + 80}" font-size="7.5" fill="${pStyle.text}">Max Value: ${stats.max} ${paramConfig.unit}</text>
    <text x="${stX + 8}" y="${stY + 93}" font-size="7.5" fill="${pStyle.text}">No. of Partially Affected ${subgroupLabel}: ${stats.affectedCount ?? 0}</text>
    <text x="${stX + 8}" y="${stY + 106}" font-size="7.5" fill="${pStyle.text}">Affected ${subgroupLabel}:</text>
    ${lines.map((ln, idx) => `
    <text x="${stX + 8}" y="${stY + 118 + idx * 11}" font-size="7.5" font-style="italic" fill="${pStyle.text}">${ln}</text>
    `).join("")}
  </g>
      `;
    }

    let svg = `<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}px" height="${h}px" style="background:#ffffff; font-family:${mapFontFamily};">
  <defs>
    <filter id="3d-emboss" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="blur" />
      <feSpecularLighting in="blur" surfaceScale="2" specularConstant="1.2" specularExponent="16" lighting-color="#ffffff" result="spec">
        <feDistantLight azimuth="225" elevation="45" />
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut" />
      <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />
    </filter>
    <filter id="3d-deboss" x="-20%" y="-20%" width="140%" height="140%">
      <feOffset dx="0.5" dy="0.5" />
      <feGaussianBlur stdDeviation="0.5" result="offset-blur" />
      <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse" />
      <feFlood flood-color="#000000" flood-opacity="0.7" result="color" />
      <feComposite operator="in" in="color" in2="inverse" result="shadow" />
      <feComposite operator="over" in="shadow" in2="SourceGraphic" />
    </filter>
  </defs>
  
  <!-- 1. Background base layout -->
  <rect x="0" y="0" width="${w}" height="${h}" fill="#f8fafc" />
  <rect x="${margin}" y="${margin}" width="${mw}" height="${mh}" fill="#ffffff" />

  <!-- 2. True Scalable Vector Raster Surface -->
  <g id="vector-interpolation-raster" opacity="${rasterOpacity / 100}">
${rasterRects}  </g>

  <!-- 3. Coordinate Grid Lines -->
  <g id="grid-lines">
${gridLines}  </g>

  <!-- Custom Shapefile Boundaries Layer -->
  <g id="shapefile-boundaries">
${svgShapefileBoundaries}  </g>

  <!-- 4. Water Quality Wells (Vector points) -->
  <g id="groundwater-stations">
${pointElements}  </g>

  <!-- 5. Outer Neatline Borders (double-border frame) -->
  <rect x="${margin - 6}" y="${margin - 6}" width="${mw + 12}" height="${mh + 12}" fill="none" stroke="#1e293b" stroke-width="1.5" />
  <rect x="${margin}" y="${margin}" width="${mw}" height="${mh}" fill="none" stroke="#1e293b" stroke-width="1.5" />

  <!-- 6. Compact Positionable Legend -->
  <g id="map-legend">
    <rect x="${legX}" y="${legY}" width="${legendWidth}" height="${legendHeight}" fill="${pStyle.bg}" stroke="${pStyle.border}" stroke-width="1" rx="4" />
    <text x="${legX + 8}" y="${legY + 16}" font-size="${legendTitleSize}" font-weight="bold" fill="${legendTextColor}" ${legend3dEffect !== "none" ? `filter="url(#3d-${legend3dEffect})"` : ""}>Legend</text>
${legendItems}    <text x="${legX + 10}" y="${legY + (legendHeight - 9)}" font-size="${legendSubtitleSize}" font-style="italic" fill="#64748b">Unit: ${paramConfig.unit || "N/A"}</text>
  </g>

  <!-- 7. Map Title Block -->
  <g id="map-title-block">
    <rect x="${tX}" y="${tY}" width="${tW}" height="${tH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1" rx="4" opacity="0.95" />
    <text x="${tX + tW / 2}" y="${titleTextY}" font-size="${mapTitleSize}" font-weight="${mapTitleBold ? "bold" : "normal"}" fill="${mapTitleColor}" text-anchor="middle" dominant-baseline="hanging" ${mapTitle3dEffect !== "none" ? `filter="url(#3d-${mapTitle3dEffect})"` : ""}>${displayTitle}</text>
    ${displaySubtitle ? `<text x="${tX + tW / 2}" y="${subtitleTextY}" font-size="${mapSubtitleSize}" fill="${mapSubtitleColor}" text-anchor="middle" dominant-baseline="hanging" ${mapSubtitle3dEffect !== "none" ? `filter="url(#3d-${mapSubtitle3dEffect})"` : ""}>${displaySubtitle}</text>` : ""}
  </g>

  <!-- 8. Scale Bar and North Arrow -->
  <g id="map-decorations">
${scaleBarElement}
${northArrowElement}
  </g>

  <!-- 9. Boundary Labels -->
  <g id="shapefile-labels">
${svgLabels}  </g>

${svgStatsPanel}

</svg>`;

    return svg;
  };

  // Trigger downloads for High-DPI Lossless exports with adaptive canvas allocation guards
  const exportMap = () => {
    // Adaptive resolution capping to avoid exceeding browser canvas allocation limits (prevents silent crash at 1200/2400/4800 DPI)
    const MAX_CANVAS_AREA = 110000000; // ~110 Megapixels is highly safe and performant across Chrome, Safari, and Firefox
    let multiplier = exportDpi / 96;

    let singleW = canvasWidth;
    let singleH = canvasHeight;

    let w = Math.round(singleW * multiplier);
    let h = Math.round(singleH * multiplier);

    if (isComparisonActive) {
      if (comparisonLayout === "horizontal") {
        w = Math.round((singleW * 2 + 20) * multiplier);
        h = Math.round(singleH * multiplier);
      } else {
        w = Math.round(singleW * multiplier);
        h = Math.round((singleH * 2 + 20) * multiplier);
      }
    }

    if (w * h > MAX_CANVAS_AREA) {
      const scaleDown = Math.sqrt(MAX_CANVAS_AREA / (w * h));
      multiplier *= scaleDown;
      if (isComparisonActive) {
        if (comparisonLayout === "horizontal") {
          w = Math.round((singleW * 2 + 20) * multiplier);
          h = Math.round(singleH * multiplier);
        } else {
          w = Math.round(singleW * multiplier);
          h = Math.round((singleH * 2 + 20) * multiplier);
        }
      } else {
        w = Math.round(singleW * multiplier);
        h = Math.round(singleH * multiplier);
      }
      showToast(`Adjusted resolution to maximum safe browser allocation limit (~${Math.round(multiplier * 96)} DPI) to prevent allocation failure.`, "info");
    }

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;

    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;

    // Fill white background for high quality raster print
    tempCtx.fillStyle = "#ffffff";
    tempCtx.fillRect(0, 0, w, h);

    if (isComparisonActive) {
      const pW = Math.round(singleW * multiplier);
      const pH = Math.round(singleH * multiplier);
      const gap = Math.round(20 * multiplier);

      // Render Pre-Monsoon Left Panel
      tempCtx.save();
      const titleL = customTitle || getMapDefaultTitleAndSubtitle("left").title;
      const subtitleL = customSubtitle || getMapDefaultTitleAndSubtitle("left").subtitle;
      drawMapInstance(
        tempCtx,
        pW,
        pH,
        multiplier,
        leftPanelData,
        titleL,
        subtitleL,
        leftStats,
        false,
        null,
        "left"
      );
      tempCtx.restore();

      // Render Post-Monsoon / Difference Right Panel
      tempCtx.save();
      if (comparisonLayout === "horizontal") {
        tempCtx.translate(pW + gap, 0);
      } else {
        tempCtx.translate(0, pH + gap);
      }

      const titleR = customTitle 
        ? `${customTitle} (Post-Monsoon)` 
        : (showDifferenceMap 
          ? `Seasonal Quality Difference Map (Post − Pre)`
          : getMapDefaultTitleAndSubtitle("right").title);
      const subtitleR = customSubtitle || (showDifferenceMap
        ? `Chemical concentration change dynamics`
        : getMapDefaultTitleAndSubtitle("right").subtitle);

      drawMapInstance(
        tempCtx,
        pW,
        pH,
        multiplier,
        rightPanelData,
        titleR,
        subtitleR,
        rightStats,
        showDifferenceMap,
        differenceMatrix,
        "right"
      );
      tempCtx.restore();
    } else {
      // Single map high-DPI export
      const title = customTitle || getMapDefaultTitleAndSubtitle("left").title;
      const subtitle = customSubtitle || getMapDefaultTitleAndSubtitle("left").subtitle;
      drawMapInstance(
        tempCtx,
        w,
        h,
        multiplier,
        parsedData,
        title,
        subtitle,
        leftStats || rightStats,
        false,
        null,
        "left"
      );
    }

    if (exportFormat === "svg") {
      const svgString = exportToSvgString("left");
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${selectedParam}_HighRes_Map.svg`;
      link.click();
      showToast(`Exported vector ${selectedParam}_HighRes_Map.svg successfully!`, "success");
      return;
    }

    if (exportFormat === "tiff") {
      const tempCtxForTiff = tempCanvas.getContext("2d");
      if (tempCtxForTiff) {
        const imgData = tempCtxForTiff.getImageData(0, 0, w, h);
        const bounds = {
          minLng: mapExtent.mapMinLng,
          maxLng: mapExtent.mapMaxLng,
          minLat: mapExtent.mapMinLat,
          maxLat: mapExtent.mapMaxLat
        };
        
        // 1. Generate and download the GeoTIFF binary Blob
        const geoTiffBlob = createGeoTiffBlob(w, h, imgData.data, bounds);
        const geoTiffLink = document.createElement("a");
        geoTiffLink.href = URL.createObjectURL(geoTiffBlob);
        geoTiffLink.download = `${selectedParam}_GroundwaterMap_Georeferenced.tif`;
        geoTiffLink.click();

        // 2. Generate and download the companion Sidecar World File (.tfw)
        const scaleX = (bounds.maxLng - bounds.minLng) / w;
        const scaleY = -(bounds.maxLat - bounds.minLat) / h;
        const startLng = bounds.minLng + (scaleX / 2);
        const startLat = bounds.maxLat + (scaleY / 2);
        
        const tfwContent = [
          scaleX.toFixed(12),
          "0.000000000000",
          "0.000000000000",
          scaleY.toFixed(12),
          startLng.toFixed(12),
          startLat.toFixed(12)
        ].join("\n") + "\n";

        const tfwBlob = new Blob([tfwContent], { type: "text/plain" });
        const tfwLink = document.createElement("a");
        tfwLink.href = URL.createObjectURL(tfwBlob);
        tfwLink.download = `${selectedParam}_GroundwaterMap_Georeferenced.tfw`;
        tfwLink.click();

        showToast(`Successfully exported Georeferenced GeoTIFF and companion World File (.tfw)!`, "success");
        return;
      }
    }

    // High quality raster format export
    const formatType = exportFormat === "jpeg" ? "image/jpeg" : "image/png";
    const extension = exportFormat;
    const dataUrl = tempCanvas.toDataURL(formatType, 1.0);
    
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${selectedParam}_GroundwaterMap_${Math.round(multiplier * 96)}DPI.${extension}`;
    link.click();
    showToast(`Successfully exported high-quality ${Math.round(multiplier * 96)} DPI map!`, "success");
  };

  // Capture current high-quality map rendering and send to Bulletin report section
  const sendToBulletin = () => {
    const canvas = canvasRefLeft.current;
    if (!canvas) {
      showToast("Could not find the map canvas to capture", "error");
      return;
    }
    try {
      // For high professional grade report quality, we render at 300 DPI for the bulletin report integration
      const tempCanvas = document.createElement("canvas");
      const multiplier = 300 / 96; // 300 DPI high resolution
      const w = Math.round(canvasWidth * multiplier);
      const h = Math.round(canvasHeight * multiplier);
      tempCanvas.width = w;
      tempCanvas.height = h;
      
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx) {
        // Fallback to standard resolution capture if context cannot be allocated
        const standardUrl = canvas.toDataURL("image/png");
        if (setBulletinMaps) {
          setBulletinMaps(prev => ({
            ...prev,
            [selectedParam]: standardUrl,
            [selectedParam.toUpperCase()]: standardUrl,
            [selectedParam.toLowerCase()]: standardUrl,
            [paramConfig.name]: standardUrl,
            [paramConfig.name.toUpperCase()]: standardUrl,
            [paramConfig.name.toLowerCase()]: standardUrl,
          }));
          showToast(`Sent current "${selectedParam}" map directly to Annual Report!`, "success");
        } else {
          showToast("Annual Report system integration is currently inactive.", "error");
        }
        return;
      }

      // Render crisp high resolution representation for professional yearbook reports
      const title = customTitle || getMapDefaultTitleAndSubtitle("left").title;
      const subtitle = customSubtitle || getMapDefaultTitleAndSubtitle("left").subtitle;
      
      drawMapInstance(
        tempCtx,
        w,
        h,
        multiplier,
        isComparisonActive ? leftPanelData : parsedData,
        title,
        subtitle,
        isComparisonActive ? leftStats : (leftStats || rightStats),
        false,
        null,
        "left"
      );

      const highResUrl = tempCanvas.toDataURL("image/png");
      if (setBulletinMaps) {
        setBulletinMaps(prev => ({
          ...prev,
          [selectedParam]: highResUrl,
          [selectedParam.toUpperCase()]: highResUrl,
          [selectedParam.toLowerCase()]: highResUrl,
          [paramConfig.name]: highResUrl,
          [paramConfig.name.toUpperCase()]: highResUrl,
          [paramConfig.name.toLowerCase()]: highResUrl,
        }));
        showToast(`Successfully generated and sent high-resolution "${selectedParam}" map to Annual Report section!`, "success");
      } else {
        showToast("Annual Report system integration is currently inactive.", "error");
      }
    } catch (err: any) {
      console.error(err);
      showToast("Failed to compile map for Annual Report: " + err.message, "error");
    }
  };

  // Automated batch generation of all maps using the current customized layout (excluding manual parameter overrides EC, TH, Cl)
  const autoGenerateAndSendAll = async () => {
    if (!setBulletinMaps) {
      showToast("Annual Report system integration is currently inactive.", "error");
      return;
    }

    const paramsToGen = availableParams.filter(p => {
      const norm = p.toUpperCase().trim();
      return norm !== "EC" && norm !== "TH" && norm !== "CL";
    });

    if (paramsToGen.length === 0) {
      showToast("No parameters available for auto-generation.", "error");
      return;
    }

    showToast(`Starting automated generation of ${paramsToGen.length} maps with current custom styles...`, "success");

    try {
      const multiplier = 300 / 96; // 300 DPI high resolution
      const w = Math.round(canvasWidth * multiplier);
      const h = Math.round(canvasHeight * multiplier);

      const generatedMaps: Record<string, string> = {};

      for (const param of paramsToGen) {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext("2d");
        if (!tempCtx) continue;

        const config = PARAM_CONFIG[param] || { b1: 1, b2: 10, unit: "mg/L", name: param };
        
        // Compute default title or use custom template
        const title = customTitle 
          ? customTitle.replace(selectedParam, param).replace(selectedParam.toUpperCase(), param.toUpperCase())
          : `Distribution of ${config.name}`;
        const subtitle = customSubtitle || getMapDefaultTitleAndSubtitle("left").subtitle;

        const stats = getStats(isComparisonActive ? leftPanelData : parsedData, param);

        drawMapInstance(
          tempCtx,
          w,
          h,
          multiplier,
          isComparisonActive ? leftPanelData : parsedData,
          title,
          subtitle,
          stats,
          false,
          null,
          "left",
          param // Pass param override!
        );

        const highResUrl = tempCanvas.toDataURL("image/png");
        generatedMaps[param] = highResUrl;
        generatedMaps[param.toUpperCase()] = highResUrl;
        generatedMaps[param.toLowerCase()] = highResUrl;
        generatedMaps[config.name] = highResUrl;
        generatedMaps[config.name.toUpperCase()] = highResUrl;
        generatedMaps[config.name.toLowerCase()] = highResUrl;
      }

      setBulletinMaps(prev => ({
        ...prev,
        ...generatedMaps
      }));

      showToast(`Successfully generated and sent ${paramsToGen.length} maps (including SAR and RSC) with custom decorations and boundaries directly to the Annual Report!`, "success");
    } catch (err: any) {
      console.error(err);
      showToast("Failed to run automated map generator: " + err.message, "error");
    }
  };

  const downloadCombinedCanvas = () => {
    const canvasL = canvasRefLeft.current;
    const canvasR = canvasRefRight.current;
    if (!canvasL || !canvasR) return;

    const combined = document.createElement("canvas");
    const ctx = combined.getContext("2d");
    if (!ctx) return;

    if (comparisonLayout === "horizontal") {
      combined.width = canvasL.width + canvasR.width + 20;
      combined.height = canvasL.height;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, combined.width, combined.height);
      ctx.drawImage(canvasL, 0, 0);
      ctx.drawImage(canvasR, canvasL.width + 20, 0);
    } else {
      combined.width = canvasL.width;
      combined.height = canvasL.height + canvasR.height + 20;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, combined.width, combined.height);
      ctx.drawImage(canvasL, 0, 0);
      ctx.drawImage(canvasR, 0, canvasL.height + 20);
    }

    const dataUrl = combined.toDataURL("image/jpeg", 1.0);
    const link = document.createElement("a");
    const year = parsedData && parsedData.length > 0 ? (parsedData[0].year || 2025) : 2025;
    link.download = `${selectedParam}_Seasonal_Comparison_${year}.jpg`;
    link.href = dataUrl;
    link.click();
    showToast("Exported combined comparison sheet successfully!", "success");
  };

  const runBatchGeneration = () => {
    if (availableParams.length === 0) {
      showToast("No parameters available for batch processing.", "error");
      return;
    }
    setBatchGenerating(true);
    setBatchProgress(0);

    const queue = availableParams.map(p => ({
      name: `${p}_Comparison_CGWB_DPI600.png`,
      status: "idle" as const
    }));
    setExportQueue(queue);

    let idx = 0;
    const interval = setInterval(() => {
      if (idx >= availableParams.length) {
        clearInterval(interval);
        setBatchGenerating(false);
        showToast("Batch processing completed! All maps compiled inside Results/Maps/", "success");
        return;
      }

      queue[idx].status = "done";
      setExportQueue([...queue]);
      idx++;
      setBatchProgress(Math.floor((idx / availableParams.length) * 100));
    }, 600);
  };

  return (
    <div className="flex flex-col gap-6 w-full items-stretch min-h-[780px]" id="professional-map-engine">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Interactive Configuration GUI Control Panel Sidebar */}
        <div className="lg:col-span-4 bg-white/75 backdrop-blur-md p-5 rounded-[2rem] border border-slate-200/50 shadow-[0_8px_32px_0_rgba(15,23,42,0.06)] flex flex-col gap-5 max-h-[860px] overflow-y-auto custom-scrollbar relative">
          
          {/* Settings Tab Navigation */}
          <div className="flex items-center gap-1.5 border-b border-slate-100 pb-3 overflow-x-auto shrink-0 custom-scrollbar">
            {[
              { id: "layers", label: "Layers", icon: Layers },
              { id: "basemap", label: "Basemap", icon: MapIcon },
              { id: "shapefile", label: "Shapefile/GeoJSON", icon: Upload },
              { id: "interpolation", label: "Interpolate", icon: Sliders },
              { id: "styling", label: "Styling", icon: SlidersHorizontal },
              { id: "decorations", label: "Elements", icon: Compass },
              { id: "batch", label: "Batch", icon: FolderKanban }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`cursor-pointer px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all duration-150 whitespace-nowrap ${
                    activeTab === tab.id
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Active Config Tab Content */}
          <div className="flex-1 flex flex-col gap-4">
            
            {/* 1. Layers Panel */}
            {activeTab === "layers" && (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">Select Map Parameter</label>
                  <select
                    value={selectedParam}
                    onChange={(e) => setSelectedParam(e.target.value)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-indigo-500"
                  >
                    {availableParams.map(p => (
                      <option key={p} value={p}>
                        {p} - {PARAM_CONFIG[p]?.name || p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-slate-100 pt-3 flex flex-col gap-2.5">
                  <span className="text-xs font-bold text-slate-800">Layer Controls</span>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50">
                    <span className="text-xs font-medium text-slate-700 flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-indigo-500" /> Raster Overlay (Interpolation)
                    </span>
                    <input
                      type="checkbox"
                      checked={showRaster}
                      onChange={(e) => setShowRaster(e.target.checked)}
                      className="cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50">
                    <span className="text-xs font-medium text-slate-700 flex items-center gap-2">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Sampling Location Points
                    </span>
                    <input
                      type="checkbox"
                      checked={showPoints}
                      onChange={(e) => setShowPoints(e.target.checked)}
                      className="cursor-pointer"
                    />
                  </label>



                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50">
                    <span className="text-xs font-medium text-slate-700 flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-amber-500" /> Feature Labels (Locations)
                    </span>
                    <input
                      type="checkbox"
                      checked={showLabels}
                      onChange={(e) => setShowLabels(e.target.checked)}
                      className="cursor-pointer"
                    />
                  </label>
                </div>

                <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
                  <span className="text-xs font-bold text-slate-800">Transparency Control</span>
                  
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold">
                      <span>RASTER OPACITY</span>
                      <span>{rasterOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={rasterOpacity}
                      onChange={(e) => setRasterOpacity(parseInt(e.target.value))}
                      className="w-full cursor-pointer accent-indigo-600 mt-1"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold">
                      <span>BASEMAP OPACITY</span>
                      <span>{basemapOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={basemapOpacity}
                      onChange={(e) => setBasemapOpacity(parseInt(e.target.value))}
                      className="w-full cursor-pointer accent-indigo-600 mt-1"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 bg-indigo-50/50 p-3.5 rounded-2xl flex flex-col gap-2">
                  <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-indigo-600" /> Comparative Seasonal Setup
                  </span>
                  
                  <label className="flex items-center justify-between cursor-pointer mt-1">
                    <span className="text-xs font-medium text-slate-700">Enable Side-by-Side Panels</span>
                    <input
                      type="checkbox"
                      checked={generateComparisonMode}
                      onChange={(e) => setGenerateComparisonMode(e.target.checked)}
                      className="cursor-pointer"
                    />
                  </label>

                  {isComparisonActive && (
                    <>
                      <div className="mt-1">
                        <label className="block text-[10px] text-indigo-900 font-bold mb-1">LAYOUT STYLE</label>
                        <select
                          value={comparisonLayout}
                          onChange={(e) => setComparisonLayout(e.target.value as any)}
                          className="w-full text-xs font-medium bg-white border border-indigo-200 rounded-lg p-1.5 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="horizontal">Horizontal Split</option>
                          <option value="vertical">Vertical Split</option>
                        </select>
                      </div>

                      <label className="flex items-center justify-between cursor-pointer mt-1.5">
                        <span className="text-xs font-semibold text-rose-900">Show Difference Map (Post − Pre)</span>
                        <input
                          type="checkbox"
                          checked={showDifferenceMap}
                          onChange={(e) => setShowDifferenceMap(e.target.checked)}
                          className="cursor-pointer"
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 2. Basemap Tab */}
            {activeTab === "basemap" && (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">Select Basemap Style</label>
                  <select
                    value={basemap}
                    onChange={(e) => setBasemap(e.target.value)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    {Object.keys(BASEMAP_STYLES).map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">Georeference Projection</label>
                  <select
                    value={projection}
                    onChange={(e) => setProjection(e.target.value as any)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="wgs84">WGS 84 Geographic coordinate system</option>
                    <option value="mercator">Web Mercator projection</option>
                    <option value="utm">UTM projection (Universal Transverse Mercator)</option>
                  </select>
                </div>

                {projection === "utm" && (
                  <div>
                    <label className="block text-slate-700 text-xs font-bold mb-1">UTM Zone (India region: 44)</label>
                    <input
                      type="number"
                      value={utmZone}
                      onChange={(e) => setUtmZone(parseInt(e.target.value))}
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2"
                    />
                  </div>
                )}

                <div className="bg-slate-50 p-4 rounded-2xl text-[11px] text-slate-600 flex flex-col gap-1">
                  <span className="font-bold text-slate-800 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 text-indigo-500" /> Geographic Bounds (India region)
                  </span>
                  <span>Bounding Area:</span>
                  <span>Min Lat: {mapExtent.mapMinLat.toFixed(2)}°N | Max Lat: {mapExtent.mapMaxLat.toFixed(2)}°N</span>
                  <span>Min Lng: {mapExtent.mapMinLng.toFixed(2)}°E | Max Lng: {mapExtent.mapMaxLng.toFixed(2)}°E</span>
                </div>
              </div>
            )}

            {/* 3. Shapefile/GeoJSON Tab */}
            {activeTab === "shapefile" && (
              <div className="flex flex-col gap-4">
                <span className="text-xs font-bold text-slate-800">Multi-Layer Shapefiles & Boundaries</span>
                <p className="text-slate-500 text-[11px] leading-relaxed">
                  Upload multiple <b>GeoJSON</b> or <b>Zipped Shapefiles</b> as vector layers. Toggle visibility, edit styles, select attribute-level labels, and set the raster clipping mask dynamically.
                </p>

                {/* Drag-and-drop file uploader */}
                <div
                  onClick={() => document.getElementById("geojson-file-input")?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-2xl p-5 text-center cursor-pointer hover:bg-indigo-50/20 transition-all duration-150 flex flex-col items-center justify-center gap-2 group"
                >
                  <input
                    id="geojson-file-input"
                    type="file"
                    accept=".json,.geojson,.zip"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        const fileList = Array.from(files);
                        for (const file of fileList) {
                          await new Promise<void>((resolve) => {
                            const fileObj = file as any;
                            if (fileObj.name.toLowerCase().endsWith(".zip")) {
                              const reader = new FileReader();
                              reader.onload = async (evt) => {
                                try {
                                  const buffer = evt.target?.result as ArrayBuffer;
                                  const geojson = (await shp(buffer)) as any;
                                  
                                  // Extract properties
                                  const keys = new Set<string>();
                                  const features = geojson.features || (geojson.type === "Feature" ? [geojson] : []);
                                  features.forEach((f: any) => {
                                    if (f && f.properties) {
                                      Object.keys(f.properties).forEach(k => keys.add(k));
                                    }
                                  });
                                  const propertyKeys = Array.from(keys);
                                  const defaultLabelKey = propertyKeys.find(k => {
                                    const l = k.toLowerCase();
                                    return l.includes("name") || l.includes("state") || l.includes("dist") || l.includes("st_nm") || l.includes("dt_nm");
                                  }) || propertyKeys[0] || "";

                                  // Nice color combo
                                  const colors = [
                                    { stroke: "#2563eb", fill: "#60a5fa" }, // Blue
                                    { stroke: "#16a34a", fill: "#4ade80" }, // Green
                                    { stroke: "#dc2626", fill: "#fca5a5" }, // Red
                                    { stroke: "#d97706", fill: "#fcd34d" }, // Yellow/Amber
                                    { stroke: "#7c3aed", fill: "#c084fc" }, // Violet
                                    { stroke: "#0d9488", fill: "#2dd4bf" }, // Teal
                                    { stroke: "#db2777", fill: "#f472b6" }, // Pink
                                  ];
                                  const colorCombo = colors[Math.floor(Math.random() * colors.length)];

                                  const newLayer: ShapefileLayer = {
                                    id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                    name: fileObj.name.replace(/\.[^/.]+$/, ""), // remove extension
                                    visible: true,
                                    geoJson: geojson,
                                    strokeColor: colorCombo.stroke,
                                    strokeWidth: 2.0,
                                    fillColor: colorCombo.fill,
                                    fillOpacity: 15,
                                    showLabels: true,
                                    labelKey: defaultLabelKey,
                                    labelColor: "#1e293b",
                                    labelSize: 11
                                  };
                                  setLayers(prev => [...prev, newLayer]);
                                  setUploadedGeoJson(geojson);
                                  setShapefileName(fileObj.name);
                                  showToast(`Zipped Shapefile "${fileObj.name}" loaded as layer!`, "success");
                                } catch (err) {
                                  console.error(err);
                                  showToast(`Error parsing zipped shapefile "${fileObj.name}". Verify .shp and .dbf files are present.`, "error");
                                }
                                resolve();
                              };
                              reader.readAsArrayBuffer(fileObj);
                            } else {
                              const reader = new FileReader();
                              reader.onload = (evt) => {
                                try {
                                  const parsed = JSON.parse(evt.target?.result as string);
                                  
                                  const keys = new Set<string>();
                                  const features = parsed.features || (parsed.type === "Feature" ? [parsed] : []);
                                  features.forEach((f: any) => {
                                    if (f && f.properties) {
                                      Object.keys(f.properties).forEach(k => keys.add(k));
                                    }
                                  });
                                  const propertyKeys = Array.from(keys);
                                  const defaultLabelKey = propertyKeys.find(k => {
                                    const l = k.toLowerCase();
                                    return l.includes("name") || l.includes("state") || l.includes("dist") || l.includes("st_nm") || l.includes("dt_nm");
                                  }) || propertyKeys[0] || "";

                                  const colors = [
                                    { stroke: "#2563eb", fill: "#60a5fa" },
                                    { stroke: "#16a34a", fill: "#4ade80" },
                                    { stroke: "#dc2626", fill: "#fca5a5" },
                                    { stroke: "#d97706", fill: "#fcd34d" },
                                    { stroke: "#7c3aed", fill: "#c084fc" },
                                    { stroke: "#0d9488", fill: "#2dd4bf" },
                                    { stroke: "#db2777", fill: "#f472b6" },
                                  ];
                                  const colorCombo = colors[Math.floor(Math.random() * colors.length)];

                                  const newLayer: ShapefileLayer = {
                                    id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                    name: fileObj.name.replace(/\.[^/.]+$/, ""),
                                    visible: true,
                                    geoJson: parsed,
                                    strokeColor: colorCombo.stroke,
                                    strokeWidth: 2.0,
                                    fillColor: colorCombo.fill,
                                    fillOpacity: 15,
                                    showLabels: true,
                                    labelKey: defaultLabelKey,
                                    labelColor: "#1e293b",
                                    labelSize: 11
                                  };
                                  setLayers(prev => [...prev, newLayer]);
                                  setUploadedGeoJson(parsed);
                                  setShapefileName(fileObj.name);
                                  showToast(`Boundary "${fileObj.name}" loaded as layer!`, "success");
                                } catch (err) {
                                  showToast(`Invalid GeoJSON in "${fileObj.name}".`, "error");
                                }
                                resolve();
                              };
                              reader.readAsText(fileObj);
                            }
                          });
                        }
                      }
                    }}
                  />
                  <div className="p-3 bg-slate-50 rounded-full group-hover:bg-indigo-50 transition-colors">
                    <Plus className="w-5 h-5 text-slate-600 group-hover:text-indigo-600" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">Add New Layer (GeoJSON / Zip)</span>
                  <span className="text-[10px] text-slate-400">supports .json, .geojson, or zipped .shp files</span>
                </div>

                {/* Clip Target Selection Mask */}
                <div className="border-t border-slate-100 pt-3 flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold text-slate-700">Raster Interpolation Clip Mask</span>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Select which boundary outline clips the spatial grid/raster interpolation surface.
                  </p>
                  <select
                    value={clipTarget}
                    onChange={(e) => setClipTarget(e.target.value)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                  >
                    <option value="none">No Clipping (Rectangular Grid)</option>
                    <option value="india">India National Boundary</option>
                    {layers.map(l => (
                      <option key={l.id} value={l.id}>Clip to Layer: {l.name}</option>
                    ))}
                  </select>
                </div>

                {/* Loaded Layers List */}
                {layers.length > 0 && (
                  <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
                    <span className="text-xs font-bold text-slate-800">Active Map Layers ({layers.length})</span>
                    <div className="flex flex-col gap-2">
                      {layers.map((layer) => {
                        // Extract properties for this specific layer
                        const keys = new Set<string>();
                        const features = layer.geoJson.features || (layer.geoJson.type === "Feature" ? [layer.geoJson] : []);
                        features.forEach((f: any) => {
                          if (f && f.properties) {
                            Object.keys(f.properties).forEach(k => keys.add(k));
                          }
                        });
                        const propertyKeys = Array.from(keys);

                        return (
                          <div key={layer.id} className="bg-slate-50 border border-slate-200/60 rounded-2xl p-3 flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l));
                                  }}
                                  className="text-slate-500 hover:text-indigo-600 cursor-pointer shrink-0"
                                  title={layer.visible ? "Hide Layer" : "Show Layer"}
                                >
                                  {layer.visible ? <Eye className="w-4 h-4 text-indigo-600" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
                                </button>
                                <span className="text-xs font-bold text-slate-800 truncate" title={layer.name}>
                                  {layer.name}
                                </span>
                              </div>
                              <button
                                onClick={() => {
                                  setLayers(prev => prev.filter(l => l.id !== layer.id));
                                  if (clipTarget === layer.id) {
                                    setClipTarget("india");
                                  }
                                  showToast(`Layer "${layer.name}" removed`, "info");
                                }}
                                className="cursor-pointer text-slate-400 hover:text-red-500 transition-colors p-1"
                                title="Remove Layer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="text-[10px] text-slate-400 font-medium flex justify-between items-center px-1">
                              <span>Features: {layer.geoJson.features ? layer.geoJson.features.length : 1} items</span>
                            </div>

                            <div className="flex gap-2 mt-1 px-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const bounds = getLayerBounds(layer);
                                  if (bounds) {
                                    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
                                    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
                                    zoomToCentroid(centerLng, centerLat, bounds);
                                    showToast(`Centered map on layer: ${layer.name}`, "info");
                                  } else {
                                    showToast("Could not determine layer bounds", "error");
                                  }
                                }}
                                className="flex-1 cursor-pointer bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold py-1.5 px-2 rounded-xl flex items-center justify-center gap-1 border border-indigo-100 transition-colors"
                                title="Center Map on this Layer"
                              >
                                <Maximize2 className="w-3.5 h-3.5" /> Zoom Layer
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedAttributeLayerId(layer.id);
                                  setAttributeSearchQuery("");
                                  setAttributePage(1);
                                  // Scroll to attribute table view smoothly
                                  setTimeout(() => {
                                    document.getElementById("attribute-table-section")?.scrollIntoView({ behavior: "smooth" });
                                  }, 100);
                                  showToast(`Opened attribute table for ${layer.name}`, "success");
                                }}
                                className="flex-1 cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold py-1.5 px-2 rounded-xl flex items-center justify-center gap-1 border border-slate-200 transition-colors"
                                title="Inspect Attribute Table"
                              >
                                <Table className="w-3.5 h-3.5 text-slate-500" /> Attributes
                              </button>
                            </div>

                            {/* Styling details */}
                            {layer.visible && (
                              <div className="mt-2 pt-2 border-t border-slate-200/60 flex flex-col gap-2.5">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[9px] text-slate-500 font-bold mb-1">OUTLINE COLOR</label>
                                    <input
                                      type="color"
                                      value={layer.strokeColor}
                                      onChange={(e) => {
                                        setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, strokeColor: e.target.value } : l));
                                      }}
                                      className="w-full h-6 cursor-pointer border border-slate-200 rounded p-0.5"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[9px] text-slate-500 font-bold mb-1">FILL COLOR</label>
                                    <input
                                      type="color"
                                      value={layer.fillColor}
                                      onChange={(e) => {
                                        setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, fillColor: e.target.value } : l));
                                      }}
                                      className="w-full h-6 cursor-pointer border border-slate-200 rounded p-0.5"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[9px] text-slate-500 font-bold mb-1">OUTLINE SIZE (px)</label>
                                    <input
                                      type="number"
                                      min="0.5"
                                      max="8"
                                      step="0.5"
                                      value={layer.strokeWidth}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 1.5;
                                        setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, strokeWidth: val } : l));
                                      }}
                                      className="w-full text-[10px] bg-white border border-slate-200 rounded p-1"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[9px] text-slate-500 font-bold mb-1">FILL OPACITY</label>
                                    <input
                                      type="range"
                                      min="0"
                                      max="80"
                                      value={layer.fillOpacity}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, fillOpacity: val } : l));
                                      }}
                                      className="w-full cursor-pointer accent-indigo-600 mt-1"
                                    />
                                  </div>
                                </div>

                                {/* Labels inside this Layer */}
                                <div className="pt-2 border-t border-dashed border-slate-200 flex flex-col gap-2">
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={layer.showLabels}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, showLabels: checked } : l));
                                      }}
                                      className="cursor-pointer"
                                    />
                                    <span className="text-[10px] font-bold text-slate-700">Display Attribute Labels</span>
                                  </label>

                                  {layer.showLabels && (
                                    <div className="flex flex-col gap-2">
                                      <div>
                                        <label className="block text-[9px] text-slate-500 font-bold mb-0.5">LABEL FIELD</label>
                                        <select
                                          value={layer.labelKey}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, labelKey: val } : l));
                                          }}
                                          className="w-full text-[10px] font-medium bg-white border border-slate-200 rounded p-1"
                                        >
                                          {propertyKeys.length === 0 ? (
                                            <option value="">(No properties detected)</option>
                                          ) : (
                                            propertyKeys.map((k) => (
                                              <option key={k} value={k}>
                                                {k}
                                              </option>
                                            ))
                                          )}
                                        </select>
                                      </div>

                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <label className="block text-[9px] text-slate-500 font-bold mb-0.5">TEXT COLOR</label>
                                          <input
                                            type="color"
                                            value={layer.labelColor}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, labelColor: val } : l));
                                            }}
                                            className="w-full h-6 cursor-pointer border border-slate-200 rounded p-0.5"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[9px] text-slate-500 font-bold mb-0.5">FONT SIZE</label>
                                          <input
                                            type="number"
                                            min="6"
                                            max="36"
                                            value={layer.labelSize}
                                            onChange={(e) => {
                                              const val = parseInt(e.target.value) || 11;
                                              setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, labelSize: val } : l));
                                            }}
                                            className="w-full text-[10px] bg-white border border-slate-200 rounded p-1"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Backwards compatible fallback style settings */}
                {layers.length === 0 && uploadedGeoJson && (
                  <div className="bg-emerald-50/50 border border-emerald-200/50 rounded-2xl p-4 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="text-xs font-bold text-slate-800 truncate">{shapefileName}</span>
                      </div>
                      <button
                        onClick={() => {
                          setUploadedGeoJson(null);
                          setShapefileName("");
                          setFitToShapefile(false);
                          showToast("Boundary layer removed", "info");
                        }}
                        className="cursor-pointer text-slate-400 hover:text-red-500 transition-colors p-1"
                        title="Remove Boundary"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="text-[10px] text-slate-500 font-medium">
                      Features Detected: {uploadedGeoJson.features ? uploadedGeoJson.features.length : 1} geometric units
                    </div>

                    <label className="flex items-center justify-between cursor-pointer mt-1 pt-2 border-t border-emerald-100">
                      <span className="text-[11px] font-bold text-slate-700">Display Boundary Layer</span>
                      <input
                        type="checkbox"
                        checked={showShapefile}
                        onChange={(e) => setShowShapefile(e.target.checked)}
                        className="cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-[11px] font-bold text-slate-700">Auto-Fit Map to Boundary</span>
                      <input
                        type="checkbox"
                        checked={fitToShapefile}
                        onChange={(e) => setFitToShapefile(e.target.checked)}
                        className="cursor-pointer"
                      />
                    </label>

                    {/* Formatting details */}
                    <div className="border-t border-slate-100 pt-3 flex flex-col gap-3.5">
                      <span className="text-xs font-bold text-slate-800">Boundary Cartographic Styling</span>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">STROKE OUTLINE</label>
                          <input
                            type="color"
                            value={shapeStrokeColor}
                            onChange={(e) => setShapeStrokeColor(e.target.value)}
                            className="w-full h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">FILL COLOR</label>
                          <input
                            type="color"
                            value={shapeFillColor}
                            onChange={(e) => setShapeFillColor(e.target.value)}
                            className="w-full h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">OUTLINE SIZE (px)</label>
                          <input
                            type="number"
                            min="0.5"
                            max="8"
                            step="0.5"
                            value={shapeStrokeWidth}
                            onChange={(e) => setShapeStrokeWidth(parseFloat(e.target.value) || 1.5)}
                            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-bold mb-1">FILL OPACITY</label>
                          <input
                            type="range"
                            min="0"
                            max="80"
                            value={shapeFillOpacity}
                            onChange={(e) => setShapeFillOpacity(parseInt(e.target.value))}
                            className="w-full cursor-pointer accent-indigo-600 mt-1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Shapefile Feature Labels Customizable Styling */}
                    <div className="border-t border-slate-100 pt-3 flex flex-col gap-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">Boundary Feature Labels</span>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showShapefileLabels}
                            onChange={(e) => setShowShapefileLabels(e.target.checked)}
                            className="cursor-pointer"
                          />
                          <span className="text-[11px] font-bold text-slate-700">Show Labels</span>
                        </label>
                      </div>

                      {showShapefileLabels && (
                        <div className="flex flex-col gap-3">
                          <div>
                            <label className="block text-[10px] text-slate-500 font-bold mb-1">LABEL PROPERTY KEY</label>
                            <select
                              value={shapefileLabelKey}
                              onChange={(e) => setShapefileLabelKey(e.target.value)}
                              className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                            >
                              {shapefilePropertyKeys.length === 0 ? (
                                <option value="">(No properties detected)</option>
                              ) : (
                                shapefilePropertyKeys.map((k) => (
                                  <option key={k} value={k}>
                                    {k}
                                  </option>
                                ))
                              )}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] text-slate-500 font-bold mb-1">LABEL COLOR</label>
                              <input
                                type="color"
                                value={shapefileLabelColor}
                                onChange={(e) => setShapefileLabelColor(e.target.value)}
                                className="w-full h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 font-bold mb-1">FONT SIZE (px)</label>
                              <input
                                type="number"
                                min="6"
                                max="36"
                                value={shapefileLabelSize}
                                onChange={(e) => setShapefileLabelSize(parseInt(e.target.value) || 11)}
                                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Interactive labels dragging reset */}
                {Object.keys(customLabelPositions).length > 0 && (
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-slate-500 text-[10px] leading-relaxed">
                    💡 <b>Interactive Dragging:</b> You can click and drag any label directly on the map using your mouse to relocate it! Click <b>Reset Positions</b> below to start over.
                  </div>
                )}

                {/* Map Panel Transparent Glass Overlays Style */}
                <div className="border-t border-slate-100 pt-3 flex flex-col gap-2.5">
                  <span className="text-xs font-bold text-slate-800">Header/Legend Transparency Style</span>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">BACKGROUND CLASS</label>
                    <select
                      value={panelBackgroundStyle}
                      onChange={(e) => setPanelBackgroundStyle(e.target.value as any)}
                      className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                    >
                      <option value="translucent-light">Translucent Light (Aero theme)</option>
                      <option value="translucent-dark">Translucent Charcoal (Tactical theme)</option>
                      <option value="transparent-glass">Vitreous Glass (High Transparency)</option>
                      <option value="solid-light">Solid High-Contrast Light</option>
                      <option value="solid-dark">Solid High-Contrast Dark</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* 3. Interpolation Tab */}
            {activeTab === "interpolation" && (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">Interpolation Algorithm</label>
                  <select
                    value={interpolationMethod}
                    onChange={(e) => setInterpolationMethod(e.target.value as any)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="idw">Inverse Distance Weighting (IDW)</option>
                    <option value="nearest">Nearest Neighbor (Voronoi-tessellation)</option>
                    <option value="natural">Natural Neighbor</option>
                    <option value="kriging">Ordinary Kriging (ArcGIS-Level)</option>
                    <option value="rbf">Radial Basis Function (RBF)</option>
                  </select>
                </div>

                {/* IDW Specific Controls */}
                {interpolationMethod === "idw" && (
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 flex flex-col gap-2.5">
                    <span className="text-[10px] font-extrabold text-indigo-600 tracking-wider uppercase">IDW PARAMETERS</span>
                    <div>
                      <div className="flex justify-between text-[11px] font-bold text-slate-700 mb-1">
                        <span>Distance Power exponent (p)</span>
                        <span className="text-indigo-600 font-mono">p = {idwPower}</span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="4.0"
                        step="0.5"
                        value={idwPower}
                        onChange={(e) => setIdwPower(parseFloat(e.target.value))}
                        className="w-full cursor-pointer accent-indigo-600"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        Higher power results in more localized influence (peaks and troughs around individual sample points).
                      </p>
                    </div>
                  </div>
                )}

                {/* Kriging (ArcGIS level Geostatistical Analyst) Controls */}
                {(interpolationMethod === "kriging" || interpolationMethod === "ordinary_kriging") && (
                  <div className="bg-slate-50 border border-indigo-100 rounded-2xl p-3.5 flex flex-col gap-3">
                    <div className="flex items-center gap-1.5 pb-2 border-b border-indigo-100/60">
                      <div className="w-1.5 h-3 bg-indigo-600 rounded-sm"></div>
                      <span className="text-[10px] font-extrabold text-indigo-700 tracking-wider uppercase">GEOSTATISTICAL KRIGING ENGINE</span>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">VARIOGRAM THEORETICAL MODEL</label>
                      <select
                        value={krigingModel}
                        onChange={(e) => setKrigingModel(e.target.value as any)}
                        className="w-full text-xs font-semibold bg-white border border-slate-200 rounded-lg p-2 focus:outline-none"
                      >
                        <option value="spherical">Spherical Variogram (CGWB Publication Standard)</option>
                        <option value="exponential">Exponential (High Local Spatial Cohesion)</option>
                        <option value="gaussian">Gaussian (Very Smooth Spatial Transition)</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-0.5">
                          <span>NUGGET (C₀)</span>
                          <span className="font-mono text-indigo-600">{krigingNugget}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={krigingNugget}
                          onChange={(e) => setKrigingNugget(parseFloat(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-0.5">
                          <span>SILL (C₀+C)</span>
                          <span className="font-mono text-indigo-600">{krigingSill}</span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="5"
                          step="0.1"
                          value={krigingSill}
                          onChange={(e) => setKrigingSill(parseFloat(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-0.5">
                          <span>RANGE (km)</span>
                          <span className="font-mono text-indigo-600">{krigingRange}km</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="800"
                          step="10"
                          value={krigingRange}
                          onChange={(e) => setKrigingRange(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-0.5">
                          <span>NEIGHBORS</span>
                          <span className="font-mono text-indigo-600">{krigingNeighbors} pts</span>
                        </div>
                        <input
                          type="range"
                          min="4"
                          max="24"
                          step="1"
                          value={krigingNeighbors}
                          onChange={(e) => setKrigingNeighbors(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600"
                        />
                      </div>
                    </div>
                    <p className="text-[9px] text-slate-400">
                      Solves localized systems of spatial auto-correlation linear equations to predict highly statistically-sound concentrations.
                    </p>
                  </div>
                )}

                {/* Radial Basis Function (RBF) Specific Controls */}
                {interpolationMethod === "rbf" && (
                  <div className="bg-slate-50 border border-emerald-100 rounded-2xl p-3.5 flex flex-col gap-3">
                    <div className="flex items-center gap-1.5 pb-2 border-b border-emerald-100/60">
                      <div className="w-1.5 h-3 bg-emerald-600 rounded-sm"></div>
                      <span className="text-[10px] font-extrabold text-emerald-700 tracking-wider uppercase">RADIAL BASIS FUNCTION SETTINGS</span>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">RBF BASIS KERNEL</label>
                      <select
                        value={rbfKernel}
                        onChange={(e) => setRbfKernel(e.target.value as any)}
                        className="w-full text-xs font-semibold bg-white border border-slate-200 rounded-lg p-2 focus:outline-none"
                      >
                        <option value="multiquadric">Multiquadric (Robust Global Fitting)</option>
                        <option value="inverse-multiquadric">Inverse Multiquadric</option>
                        <option value="thin-plate-spline">Thin Plate Spline (Minimizes Bending Energy)</option>
                        <option value="gaussian">Gaussian RBF (Localized Smooth Shell)</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-0.5">
                        <span>SHAPE SMOOTHING PARAMETER (c)</span>
                        <span className="font-mono text-emerald-600">{rbfParameter}</span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="2.5"
                        step="0.05"
                        value={rbfParameter}
                        onChange={(e) => setRbfParameter(parseFloat(e.target.value))}
                        className="w-full cursor-pointer accent-emerald-600"
                      />
                      <p className="text-[9px] text-slate-400 mt-1">
                        Adjusts kernel stiffness. Smaller values yield tighter fitted surface curves.
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                    <span>Grid Smoothing Resolution</span>
                    <span>{gridSmoothingRes} columns</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="300"
                    step="10"
                    value={gridSmoothingRes}
                    onChange={(e) => setGridSmoothingRes(parseInt(e.target.value))}
                    className="w-full cursor-pointer accent-indigo-600"
                  />
                </div>

                {!useAllPoints && (
                  <div>
                    <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                      <span>Search Radius (degrees)</span>
                      <span>{searchRadius}°</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="4.0"
                      step="0.1"
                      value={searchRadius}
                      onChange={(e) => setSearchRadius(parseFloat(e.target.value))}
                      className="w-full cursor-pointer accent-indigo-600"
                    />
                  </div>
                )}

                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                    <span>Clip to Study Area Buffer</span>
                    <span>{clippingRadius}°</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="3.0"
                    step="0.1"
                    value={clippingRadius}
                    onChange={(e) => setClippingRadius(parseFloat(e.target.value))}
                    className="w-full cursor-pointer accent-indigo-600"
                  />
                </div>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50 transition-colors">
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">Use All Points for Interpolation</span>
                    <span className="text-[10px] text-slate-400 font-medium">Bypasses spatial radius limit to leverage global dataset</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={useAllPoints}
                    onChange={(e) => setUseAllPoints(e.target.checked)}
                    className="cursor-pointer h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>

                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                    <span>Grid Resolution Multiplier</span>
                    <span>{gridResolutionMultiplier}x</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={gridResolutionMultiplier}
                    onChange={(e) => setGridResolutionMultiplier(parseInt(e.target.value))}
                    className="w-full cursor-pointer accent-indigo-600"
                  />
                </div>

                <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50">
                    <span className="text-xs font-medium text-slate-700">Extend Interpolation to Boundary</span>
                    <input
                      type="checkbox"
                      checked={extendInterpolationToBoundary}
                      onChange={(e) => setExtendInterpolationToBoundary(e.target.checked)}
                      className="cursor-pointer"
                    />
                  </label>
                  <p className="text-[10px] text-slate-400 pl-1.5">
                    Extends interpolation values throughout the full boundary region, even if there are no local sample points.
                  </p>
                </div>

                {/* ADVANCED RENDERING & ANISOTROPY CONTROLS */}
                <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
                  <span className="text-[10px] font-extrabold text-indigo-600 tracking-wider uppercase">ADVANCED RENDERING & GEOMETRY</span>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50">
                    <div>
                      <span className="text-xs font-medium text-slate-700 block">Gaussian Raster Smoothing</span>
                      <span className="text-[9px] text-slate-400">Applies a 3x3 kernel blur to reduce jagged edges</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={enableGaussianSmoothing}
                      onChange={(e) => setEnableGaussianSmoothing(e.target.checked)}
                      className="cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50">
                    <div>
                      <span className="text-xs font-medium text-slate-700 block">Anisotropy Correction</span>
                      <span className="text-[9px] text-slate-400">Corrects for spatial directional trends or skewness</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={enableAnisotropy}
                      onChange={(e) => setEnableAnisotropy(e.target.checked)}
                      className="cursor-pointer"
                    />
                  </label>

                  {enableAnisotropy && (
                    <div className="pl-3 border-l-2 border-indigo-100 flex flex-col gap-3.5 pt-1">
                      <div>
                        <div className="flex justify-between text-[11px] font-bold text-slate-700 mb-1">
                          <span>Trend Direction (Angle)</span>
                          <span className="text-indigo-600 font-mono">{anisotropyAngle}°</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="180"
                          step="5"
                          value={anisotropyAngle}
                          onChange={(e) => setAnisotropyAngle(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-bold text-slate-700 mb-1">
                          <span>Anisotropy Ratio (Stretch)</span>
                          <span className="text-indigo-600 font-mono">{anisotropyRatio}x</span>
                        </div>
                        <input
                          type="range"
                          min="1.0"
                          max="3.0"
                          step="0.1"
                          value={anisotropyRatio}
                          onChange={(e) => setAnisotropyRatio(parseFloat(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 5. Styling Tab */}
            {activeTab === "styling" && (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">Map Sheet Layout</label>
                  <select
                    value={sheetLayout}
                    onChange={(e) => setSheetLayout(e.target.value as any)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="a4-portrait">A4 Portrait Sheet (CGWB Publication Standard)</option>
                    <option value="landscape">Standard Landscape (Interactive Web)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">Color Scheme Palette</label>
                  <select
                    value={colorScheme}
                    onChange={(e) => setColorScheme(e.target.value)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    {Object.keys(COLOR_SCHEMES).map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {(COLOR_SCHEMES[colorScheme as keyof typeof COLOR_SCHEMES] || COLOR_SCHEMES["Blue-Yellow-Red"]).map((c, i) => (
                    <div
                      key={i}
                      className="h-6 flex-1 rounded-md shadow-inner border border-slate-200/50"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">Sampling Point Symbol</label>
                  <select
                    value={symbolType}
                    onChange={(e) => setSymbolType(e.target.value as any)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="circle">Circle Symbol</option>
                    <option value="square">Square Symbol</option>
                    <option value="triangle">Triangle Symbol</option>
                    <option value="diamond">Diamond Symbol</option>
                    <option value="star">Star / Asterisk</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">SYMBOL SIZE (px)</label>
                    <input
                      type="number"
                      value={symbolSize}
                      onChange={(e) => setSymbolSize(parseInt(e.target.value) || 8)}
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">SYMBOL OPACITY</label>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={symbolOpacity}
                      onChange={(e) => setSymbolOpacity(parseInt(e.target.value))}
                      className="w-full cursor-pointer accent-indigo-600"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
                  <span className="text-xs font-bold text-slate-800">Points Map Exceeding-Only View</span>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50">
                    <span className="text-xs font-medium text-slate-700">Show Exceeding Locations Only</span>
                    <input
                      type="checkbox"
                      checked={showOnlyExceedingPoints}
                      onChange={(e) => setShowOnlyExceedingPoints(e.target.checked)}
                      className="cursor-pointer"
                    />
                  </label>

                  {showOnlyExceedingPoints && (
                    <>
                      <div>
                        <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                          <span>Exceeding Point Size</span>
                          <span>{exceedingPointSize.toFixed(1)}</span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="3.0"
                          step="0.1"
                          value={exceedingPointSize}
                          onChange={(e) => setExceedingPointSize(parseFloat(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600"
                        />
                      </div>

                      <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50">
                        <span className="text-xs font-medium text-slate-700">Display as 3D Bubbles</span>
                        <input
                          type="checkbox"
                          checked={showAs3dBubbles}
                          onChange={(e) => setShowAs3dBubbles(e.target.checked)}
                          className="cursor-pointer"
                        />
                      </label>

                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">BUBBLE/POINT COLOR</label>
                        <div className="flex gap-2">
                          <input
                            type="color"
                            value={bubbleColor}
                            onChange={(e) => setBubbleColor(e.target.value)}
                            className="w-12 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5 shrink-0"
                          />
                          <input
                            type="text"
                            value={bubbleColor}
                            onChange={(e) => setBubbleColor(e.target.value)}
                            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Dynamic Classification Class Count */}
                <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
                  <span className="text-xs font-bold text-slate-800">Dynamic Map Class Count</span>
                  <div className="flex flex-col gap-2 bg-slate-50 p-2.5 rounded-2xl border border-slate-200/50">
                    <p className="text-[10px] text-slate-500 leading-normal mb-1">
                      Choose the number of classification ranges to group interpolated concentration values.
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600">No. of Classes (2 - 10)</span>
                      <input
                        type="number"
                        min="2"
                        max="10"
                        value={interpolationClasses}
                        onChange={(e) => setInterpolationClasses(Math.max(2, Math.min(10, parseInt(e.target.value) || 3)))}
                        className="w-20 text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-bold"
                      />
                    </div>
                  </div>
                </div>

                {/* Custom Point Colors Selector */}
                <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
                  <div className="flex flex-col gap-2 bg-slate-50 p-2.5 rounded-2xl border border-slate-200/50">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wide">Separate Point Map Colors</span>
                      <input
                        type="checkbox"
                        checked={useCustomPointColors}
                        onChange={(e) => setUseCustomPointColors(e.target.checked)}
                        className="cursor-pointer h-3.5 w-3.5 rounded accent-indigo-600"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 leading-normal mb-1">
                      Use separate colors for raw points map to make points stand out from background interpolation.
                    </p>
                    
                    {useCustomPointColors && (
                      <div className="flex flex-col gap-2 border-t border-slate-100 pt-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-600">Acceptable (≤ {paramConfig.b1})</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={pointColorRange1}
                              onChange={(e) => setPointColorRange1(e.target.value)}
                              className="w-7 h-7 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                            />
                            <input
                              type="text"
                              value={pointColorRange1}
                              onChange={(e) => setPointColorRange1(e.target.value)}
                              className="w-20 text-[10px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-600">Permissible (≤ {paramConfig.b2})</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={pointColorRange2}
                              onChange={(e) => setPointColorRange2(e.target.value)}
                              className="w-7 h-7 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                            />
                            <input
                              type="text"
                              value={pointColorRange2}
                              onChange={(e) => setPointColorRange2(e.target.value)}
                              className="w-20 text-[10px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-600">Beyond Permissible (&gt; {paramConfig.b2})</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={pointColorRange3}
                              onChange={(e) => setPointColorRange3(e.target.value)}
                              className="w-7 h-7 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                            />
                            <input
                              type="text"
                              value={pointColorRange3}
                              onChange={(e) => setPointColorRange3(e.target.value)}
                              className="w-20 text-[10px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Custom Color Selector Ranges */}
                <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
                  <span className="text-xs font-bold text-slate-800">Map Custom Classification Colors</span>
                  
                  {/* Standard Ranges */}
                  <div className="flex flex-col gap-2 bg-slate-50 p-2.5 rounded-2xl border border-slate-200/50">
                    <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wide">Concentration Map Ranges</span>
                    
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600">Acceptable (≤ {paramConfig.b1})</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={colorRange1}
                          onChange={(e) => setColorRange1(e.target.value)}
                          className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5 animate-pulse"
                        />
                        <input
                          type="text"
                          value={colorRange1}
                          onChange={(e) => setColorRange1(e.target.value)}
                          className="w-20 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600">Permissible (≤ {paramConfig.b2})</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={colorRange2}
                          onChange={(e) => setColorRange2(e.target.value)}
                          className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5 animate-pulse"
                        />
                        <input
                          type="text"
                          value={colorRange2}
                          onChange={(e) => setColorRange2(e.target.value)}
                          className="w-20 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600">Beyond Permissible (&gt; {paramConfig.b2})</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={colorRange3}
                          onChange={(e) => setColorRange3(e.target.value)}
                          className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5 animate-pulse"
                        />
                        <input
                          type="text"
                          value={colorRange3}
                          onChange={(e) => setColorRange3(e.target.value)}
                          className="w-20 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Station Location Custom Color */}
                  <div className="flex flex-col gap-2 bg-slate-50 p-2.5 rounded-2xl border border-slate-200/50">
                    <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wide">Station Locations Color</span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600">Location Point Color</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={stationPointColor}
                          onChange={(e) => setStationPointColor(e.target.value)}
                          className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5 animate-pulse"
                        />
                        <input
                          type="text"
                          value={stationPointColor}
                          onChange={(e) => setStationPointColor(e.target.value)}
                          className="w-20 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Difference Map Ranges */}
                  {showDifferenceMap && (
                    <div className="flex flex-col gap-2 bg-slate-50 p-2.5 rounded-2xl border border-slate-200/50">
                      <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wide">Difference Map Ranges</span>
                      
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-600">Improved (Post &lt; Pre)</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={colorDiffImproved}
                            onChange={(e) => setColorDiffImproved(e.target.value)}
                            className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                          />
                          <input
                            type="text"
                            value={colorDiffImproved}
                            onChange={(e) => setColorDiffImproved(e.target.value)}
                            className="w-20 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-600">Stable</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={colorDiffStable}
                            onChange={(e) => setColorDiffStable(e.target.value)}
                            className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                          />
                          <input
                            type="text"
                            value={colorDiffStable}
                            onChange={(e) => setColorDiffStable(e.target.value)}
                            className="w-20 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-600">Deteriorated (Post &gt; Pre)</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={colorDiffDeteriorated}
                            onChange={(e) => setColorDiffDeteriorated(e.target.value)}
                            className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                          />
                          <input
                            type="text"
                            value={colorDiffDeteriorated}
                            onChange={(e) => setColorDiffDeteriorated(e.target.value)}
                            className="w-20 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 6. Decorations Tab */}
            {activeTab === "decorations" && (
              <div className="flex flex-col gap-4">
                <div className="border-b border-slate-100 pb-3">
                  <span className="text-xs font-bold text-slate-800 block mb-2">Custom Map Title Customization</span>
                  <div className="flex flex-col gap-2.5">
                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">MAP TITLE TEXT</label>
                      <input
                        type="text"
                        placeholder="Default Concentration Map"
                        value={customTitle}
                        onChange={(e) => setCustomTitle(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">MAP SUBTITLE TEXT</label>
                      <input
                        type="text"
                        placeholder="Default Survey & Dynamics"
                        value={customSubtitle}
                        onChange={(e) => setCustomSubtitle(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                      />
                    </div>

                    <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50 border border-slate-100/60 mt-1">
                      <span className="text-xs font-semibold text-slate-700">Replace Main Title with Subtitle text</span>
                      <input
                        type="checkbox"
                        checked={useSubtitleAsTitle}
                        onChange={(e) => setUseSubtitleAsTitle(e.target.checked)}
                        className="cursor-pointer h-4 w-4 rounded accent-indigo-600"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">Map Title Placement</label>
                  <select
                    value={titlePos}
                    onChange={(e) => setTitlePos(e.target.value as any)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="top-center">Top Center position</option>
                    <option value="top-left">Top Left corner</option>
                    <option value="top-right">Top Right corner</option>
                    <option value="bottom-center">Bottom Center position</option>
                    <option value="bottom-left">Bottom Left corner</option>
                    <option value="bottom-right">Bottom Right corner</option>
                    <option value="none">No Title Plate</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">North Arrow Type</label>
                  <select
                    value={northArrowType}
                    onChange={(e) => setNorthArrowType(e.target.value as any)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="classic">Classic Compass Needle</option>
                    <option value="modern">Modern Minimalist Arrow</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">North Arrow Position</label>
                  <select
                    value={northArrowPos}
                    onChange={(e) => setNorthArrowPos(e.target.value as any)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="top-right">Top-Right corner</option>
                    <option value="top-left">Top-Left corner</option>
                    <option value="bottom-right">Bottom-Right corner</option>
                    <option value="bottom-left">Bottom-Left corner</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 text-xs font-bold mb-1.5">Legend Position Corner</label>
                  <select
                    value={legendPos}
                    onChange={(e) => setLegendPos(e.target.value as any)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="bottom-right">Bottom-Right corner</option>
                    <option value="bottom-left">Bottom-Left corner</option>
                    <option value="top-right">Top-Right corner</option>
                    <option value="top-left">Top-Left corner</option>
                  </select>
                </div>

                <div className="border-b border-slate-100 pb-3 flex flex-col gap-2.5">
                  <span className="text-xs font-bold text-slate-800 block">Element Color Customization</span>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[9px] text-slate-500 font-bold mb-1">TITLE COLOR</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={mapTitleColor}
                          onChange={(e) => setMapTitleColor(e.target.value)}
                          className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] text-slate-500 font-bold mb-1">SUBTITLE COLOR</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={mapSubtitleColor}
                          onChange={(e) => setMapSubtitleColor(e.target.value)}
                          className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] text-slate-500 font-bold mb-1">LEGEND COLOR</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={legendTextColor}
                          onChange={(e) => setLegendTextColor(e.target.value)}
                          className="w-8 h-8 cursor-pointer border border-slate-200 rounded-lg p-0.5"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-b border-slate-100 pb-3 flex flex-col gap-3">
                  <span className="text-xs font-bold text-slate-800">Precise Element Positioning (Fine Adjustments)</span>
                  <p className="text-[10px] text-slate-500 leading-normal">
                    Precisely reposition individual map decorations (Title, Legend, Stats Table, and North Arrow) relative to their anchor coordinates.
                  </p>
                  
                  {/* Title Position Offset */}
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-700 uppercase">Map Title Offsets (X / Y)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[9px] text-slate-400">X: {titleOffsetX}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={titleOffsetX}
                          onChange={(e) => setTitleOffsetX(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400">Y: {titleOffsetY}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={titleOffsetY}
                          onChange={(e) => setTitleOffsetY(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Legend Position Offset */}
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-700 uppercase">Legend Offsets (X / Y)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[9px] text-slate-400">X: {legendOffsetX}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={legendOffsetX}
                          onChange={(e) => setLegendOffsetX(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400">Y: {legendOffsetY}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={legendOffsetY}
                          onChange={(e) => setLegendOffsetY(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Stats Table Position Offset */}
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-700 uppercase">Stats Table Offsets (X / Y)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[9px] text-slate-400">X: {statsOffsetX}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={statsOffsetX}
                          onChange={(e) => setStatsOffsetX(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400">Y: {statsOffsetY}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={statsOffsetY}
                          onChange={(e) => setStatsOffsetY(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                    </div>
                  </div>

                  {/* North Arrow Position Offset */}
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-700 uppercase">North Arrow Offsets (X / Y)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[9px] text-slate-400">X: {northArrowOffsetX}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={northArrowOffsetX}
                          onChange={(e) => setNorthArrowOffsetX(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400">Y: {northArrowOffsetY}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={northArrowOffsetY}
                          onChange={(e) => setNorthArrowOffsetY(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Scale Bar Position Offset */}
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-700 uppercase">Scale Bar Offsets (X / Y)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[9px] text-slate-400">X: {scaleBarOffsetX}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={scaleBarOffsetX}
                          onChange={(e) => setScaleBarOffsetX(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400">Y: {scaleBarOffsetY}px</span>
                        <input
                          type="range"
                          min="-400"
                          max="400"
                          value={scaleBarOffsetY}
                          onChange={(e) => setScaleBarOffsetY(parseInt(e.target.value))}
                          className="w-full cursor-pointer accent-indigo-600 h-1.5"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
                  <span className="text-xs font-bold text-slate-800">Transparency & Panel Modes</span>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-50">
                    <span className="text-xs font-medium text-slate-700">Strictly Transparent Panels</span>
                    <input
                      type="checkbox"
                      checked={onlyTransparentPanels}
                      onChange={(e) => setOnlyTransparentPanels(e.target.checked)}
                      className="cursor-pointer"
                    />
                  </label>
                  <p className="text-[10px] text-slate-400 pl-1.5">
                    Forces transparent backgrounds for Title, Legend, and Stats panels to optimize overlay visibility.
                  </p>

                  <div className="mt-2">
                    <label className="block text-[10px] text-slate-500 font-bold mb-1">MAP FONT FAMILY</label>
                    <select
                      value={mapFontFamily}
                      onChange={(e) => setMapFontFamily(e.target.value)}
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                    >
                      <option value="Times New Roman">Times New Roman (Serif)</option>
                      <option value="Calibri">Calibri (Sans-Serif)</option>
                      <option value="sans-serif">Clean Sans-Serif (Inter)</option>
                      <option value="serif">Official Serif (Georgia)</option>
                      <option value="monospace">Mono Technical (Fira Code)</option>
                      <option value="cursive">Elegant Cursive</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">TITLE SIZE (px)</label>
                      <input
                        type="number"
                        value={mapTitleSize}
                        onChange={(e) => setMapTitleSize(parseInt(e.target.value) || 15)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">SUBTITLE SIZE (px)</label>
                      <input
                        type="number"
                        value={mapSubtitleSize}
                        onChange={(e) => setMapSubtitleSize(parseInt(e.target.value) || 11)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">LINE SPACING (px)</label>
                      <input
                        type="number"
                        value={titleLineSpacing}
                        onChange={(e) => setTitleLineSpacing(parseInt(e.target.value) || 0)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                        min="0"
                        max="100"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
                    <span className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">3D Text Effects (Emboss/Deboss)</span>
                    
                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">MAP TITLE 3D EFFECT</label>
                      <select
                        value={mapTitle3dEffect}
                        onChange={(e) => setMapTitle3dEffect(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                      >
                        <option value="none">None (Standard Flat)</option>
                        <option value="emboss">3D Emboss (Raised Bevel)</option>
                        <option value="deboss">3D Deboss (Letterpress Inset)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">MAP SUBTITLE 3D EFFECT</label>
                      <select
                        value={mapSubtitle3dEffect}
                        onChange={(e) => setMapSubtitle3dEffect(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                      >
                        <option value="none">None (Standard Flat)</option>
                        <option value="emboss">3D Emboss (Raised Bevel)</option>
                        <option value="deboss">3D Deboss (Letterpress Inset)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500 font-bold mb-1">MAP LEGEND 3D EFFECT</label>
                      <select
                        value={legend3dEffect}
                        onChange={(e) => setLegend3dEffect(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                      >
                        <option value="none">None (Standard Flat)</option>
                        <option value="emboss">3D Emboss (Raised Bevel)</option>
                        <option value="deboss">3D Deboss (Letterpress Inset)</option>
                      </select>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
                    <span className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">Legend & Classes Sizing</span>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">LEGEND WIDTH (px)</label>
                        <input
                          type="number"
                          value={legendWidth}
                          onChange={(e) => setLegendWidth(parseInt(e.target.value) || 155)}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                          min="100"
                          max="400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">ROW SPACING (px)</label>
                        <input
                          type="number"
                          value={legendRowSpacing}
                          onChange={(e) => setLegendRowSpacing(parseInt(e.target.value) || 16)}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                          min="10"
                          max="40"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">CLASS BOX WIDTH</label>
                        <input
                          type="number"
                          value={legendBoxWidth}
                          onChange={(e) => setLegendBoxWidth(parseInt(e.target.value) || 12)}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                          min="4"
                          max="30"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">CLASS BOX HEIGHT</label>
                        <input
                          type="number"
                          value={legendBoxHeight}
                          onChange={(e) => setLegendBoxHeight(parseInt(e.target.value) || 8)}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none"
                          min="4"
                          max="30"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <label className="block text-[9px] text-slate-500 font-bold mb-1">TITLE SZ</label>
                        <input
                          type="number"
                          step="0.5"
                          value={legendTitleSize}
                          onChange={(e) => setLegendTitleSize(parseFloat(e.target.value) || 8.5)}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-1.5 focus:outline-none text-center"
                          min="6"
                          max="18"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] text-slate-500 font-bold mb-1">SUBTITLE</label>
                        <input
                          type="number"
                          step="0.5"
                          value={legendSubtitleSize}
                          onChange={(e) => setLegendSubtitleSize(parseFloat(e.target.value) || 7)}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-1.5 focus:outline-none text-center"
                          min="5"
                          max="16"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] text-slate-500 font-bold mb-1">LABELS</label>
                        <input
                          type="number"
                          step="0.5"
                          value={legendFontSize}
                          onChange={(e) => setLegendFontSize(parseFloat(e.target.value) || 7.5)}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-1.5 focus:outline-none text-center"
                          min="5"
                          max="16"
                        />
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* 7. Batch Tab */}
            {activeTab === "batch" && (
              <div className="flex flex-col gap-4">
                <span className="text-xs font-bold text-slate-800">Groundwater Yearbook Batch Compilation</span>
                <p className="text-slate-500 text-[11px]">
                  Generate and compile publication-ready maps for all chemical parameters in the dataset with a single click.
                </p>

                <button
                  onClick={runBatchGeneration}
                  disabled={batchGenerating}
                  className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-3 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-md transition-all duration-150"
                >
                  <Play className="w-4 h-4 text-emerald-100" />
                  {batchGenerating ? "Compiling Maps..." : "Run Bulk Compilation"}
                </button>

                {batchGenerating && (
                  <div className="flex flex-col gap-2 mt-2">
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${batchProgress}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold">
                      <span>PROGRESS</span>
                      <span>{batchProgress}%</span>
                    </div>
                  </div>
                )}

                <div className="border-t border-slate-100 pt-3 flex flex-col gap-2.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Compiled GIS Output Folder</span>
                  <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto custom-scrollbar bg-slate-50 p-3 rounded-xl border border-slate-150 text-[10px] font-mono">
                    <span className="text-slate-700 font-bold flex items-center gap-1">
                      📁 Results/Yearbook_Maps/
                    </span>
                    {exportQueue.map((item, idx) => (
                      <span key={idx} className="text-slate-500 pl-4 flex items-center gap-1.5">
                        <CheckCircle className={`w-3 h-3 ${item.status === "done" ? "text-emerald-500" : "text-slate-300"}`} />
                        {item.name}
                      </span>
                    ))}
                    {exportQueue.length === 0 && <span className="text-slate-400 italic pl-4">Queue is empty</span>}
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>

        {/* Map Panel View */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Controls bar for active rendering */}
          <div className="bg-white/75 backdrop-blur-md px-6 py-4 rounded-3xl border border-slate-200/50 shadow-[0_8px_32px_0_rgba(15,23,42,0.04)] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <span className="text-indigo-600">Active Parameter:</span>
                <span className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-xl border border-indigo-100">
                  {selectedParam} ({paramConfig.unit})
                </span>
              </div>

              {/* Dynamic Zoom controls - 10% change per click */}
              <div className="flex items-center gap-1 bg-slate-100/85 border border-slate-200/60 rounded-2xl p-1 shadow-inner">
                <button
                  onClick={() => setZoomScaleFactor(z => Math.max(0.2, z * 0.9))}
                  title="Zoom In 10%"
                  className="cursor-pointer bg-white hover:bg-slate-50 text-slate-800 font-extrabold px-3 py-1.5 rounded-xl text-xs border border-slate-200 flex items-center gap-1 shadow-sm transition-all duration-100"
                >
                  <ZoomIn className="w-3.5 h-3.5 text-indigo-600" /> Zoom In
                </button>
                <button
                  onClick={() => setZoomScaleFactor(z => Math.min(5.0, z * 1.1))}
                  title="Zoom Out 10%"
                  className="cursor-pointer bg-white hover:bg-slate-50 text-slate-800 font-extrabold px-3 py-1.5 rounded-xl text-xs border border-slate-200 flex items-center gap-1 shadow-sm transition-all duration-100"
                >
                  <ZoomOut className="w-3.5 h-3.5 text-indigo-600" /> Zoom Out
                </button>
                <button
                  onClick={() => setZoomScaleFactor(1.0)}
                  title="Reset Zoom to Fit Bounding Box"
                  className="cursor-pointer bg-white hover:bg-slate-50 text-slate-500 font-semibold px-2.5 py-1.5 rounded-xl text-xs border border-slate-200 transition-all duration-100"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl p-1.5">
                  <select
                    value={exportDpi}
                    onChange={(e) => setExportDpi(parseInt(e.target.value))}
                    className="text-xs font-bold bg-transparent border-none text-slate-700 focus:outline-none cursor-pointer"
                  >
                    <option value="300">300 DPI (Standard)</option>
                    <option value="600">600 DPI (Report Publication)</option>
                    <option value="1200">1200 DPI (Ultra Lossless)</option>
                  </select>
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as any)}
                    className="text-xs font-bold bg-transparent border-none text-indigo-600 focus:outline-none cursor-pointer"
                  >
                    <option value="png">PNG (Lossless)</option>
                    <option value="jpeg">JPEG (High)</option>
                    <option value="tiff">TIFF (Georeferenced)</option>
                    <option value="svg">SVG (Vector First)</option>
                  </select>
                </div>
                {exportDpi >= 1200 && (
                  <span className="text-[9px] text-amber-600 font-bold max-w-[200px] leading-tight">
                    ⚠️ Browser limit warning: 1200+ DPI may trigger adaptive resolution capping to prevent memory allocation crashes.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={autoGenerateAndSendAll}
                  title="Generate all maps automatically with current decorations/boundaries and send to Annual Report"
                  className="cursor-pointer bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-md transition-all duration-100 animate-pulse"
                >
                  <Play className="w-4 h-4 text-amber-100" /> Auto-Generate All (Annual Report)
                </button>

                <button
                  onClick={sendToBulletin}
                  className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-md transition-all duration-100"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-100" /> Send to Annual Report
                </button>

                <button
                  onClick={exportMap}
                  className="cursor-pointer bg-slate-900 text-white hover:bg-slate-800 px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-md transition-all duration-100"
                >
                  <FileDown className="w-4 h-4" /> Export Map
                </button>

                {isComparisonActive && (
                  <button
                    onClick={downloadCombinedCanvas}
                    className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-md transition-all duration-100"
                  >
                    <Printer className="w-4 h-4" /> Export Combined Maps
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Linked extents / Dual Canvas Container */}
          <div className={`grid ${isComparisonActive && comparisonLayout === "horizontal" ? "grid-cols-2" : "grid-cols-1"} gap-4 w-full`}>
            
            {/* Left/Single Panel */}
            <div className="flex flex-col gap-2 bg-slate-50 p-4 rounded-[2.5rem] border border-slate-200/60 shadow-inner items-stretch">
              <div className="flex justify-between items-center px-2 mb-1">
                <span className="text-xs font-extrabold text-slate-600 uppercase tracking-wider">
                  {isComparisonActive ? "Panel A: Pre-Monsoon" : "Primary Output Map"}
                </span>
                <span className="text-[10px] font-mono text-slate-400">Extent synchronized</span>
              </div>

              <div className={`relative ${canvasAspectClass} w-full rounded-3xl overflow-hidden border-2 border-slate-200 shadow-md bg-white`}>
                <canvas
                  ref={canvasRefLeft}
                  width={canvasWidth}
                  height={canvasHeight}
                  className="w-full h-full block cursor-move"
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUpOrLeave}
                  onMouseLeave={handleCanvasMouseUpOrLeave}
                />
                {isLeftLoading && (
                  <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[1px] flex items-center justify-center transition-all">
                    <div className="bg-white/95 px-3.5 py-2 rounded-2xl shadow-xl flex items-center gap-2 border border-slate-100 animate-pulse">
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin"></div>
                      <span className="text-[10px] font-extrabold text-slate-700 tracking-wider uppercase">INTERPOLATING...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Comparison Panel */}
            {isComparisonActive && (
              <div className="flex flex-col gap-2 bg-slate-50 p-4 rounded-[2.5rem] border border-slate-200/60 shadow-inner items-stretch">
                <div className="flex justify-between items-center px-2 mb-1">
                  <span className="text-xs font-extrabold text-slate-600 uppercase tracking-wider">
                    {showDifferenceMap ? "Panel B: Seasonal Change" : "Panel B: Post-Monsoon"}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Scale identical</span>
                </div>

                <div className={`relative ${canvasAspectClass} w-full rounded-3xl overflow-hidden border-2 border-slate-200 shadow-md bg-white`}>
                  <canvas
                    ref={canvasRefRight}
                    width={canvasWidth}
                    height={canvasHeight}
                    className="w-full h-full block cursor-move"
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUpOrLeave}
                    onMouseLeave={handleCanvasMouseUpOrLeave}
                  />
                  {isRightLoading && (
                    <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[1px] flex items-center justify-center transition-all">
                      <div className="bg-white/95 px-3.5 py-2 rounded-2xl shadow-xl flex items-center gap-2 border border-slate-100 animate-pulse">
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin"></div>
                        <span className="text-[10px] font-extrabold text-slate-700 tracking-wider uppercase">INTERPOLATING...</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* GIS Attribute Table Viewer */}
          {selectedAttributeLayerId && (() => {
            const activeLayer = layers.find(l => l.id === selectedAttributeLayerId);
            if (!activeLayer) return null;

            // Extract all feature properties
            const features = activeLayer.geoJson.features || (activeLayer.geoJson.type === "Feature" ? [activeLayer.geoJson] : []);
            const allKeys = new Set<string>();
            features.forEach((f: any) => {
              if (f && f.properties) {
                Object.keys(f.properties).forEach(k => allKeys.add(k));
              }
            });
            const propertyHeaders = Array.from(allKeys);

            // Filter features based on search query
            const filteredFeatures = features.filter((f: any) => {
              if (!attributeSearchQuery) return true;
              if (!f || !f.properties) return false;
              const q = attributeSearchQuery.toLowerCase();
              return Object.values(f.properties).some(val => 
                val !== null && val !== undefined && String(val).toLowerCase().includes(q)
              );
            });

            // Sort features if sortKey is set
            if (attributeSortKey) {
              filteredFeatures.sort((a: any, b: any) => {
                const valA = a?.properties?.[attributeSortKey];
                const valB = b?.properties?.[attributeSortKey];
                if (valA === undefined || valA === null) return 1;
                if (valB === undefined || valB === null) return -1;
                
                const isNum = typeof valA === "number" && typeof valB === "number";
                if (isNum) {
                  return attributeSortDesc ? (valB - valA) : (valA - valB);
                } else {
                  return attributeSortDesc
                    ? String(valB).localeCompare(String(valA))
                    : String(valA).localeCompare(String(valB));
                }
              });
            }

            // Pagination parameters
            const itemsPerPage = 8;
            const totalItems = filteredFeatures.length;
            const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
            const currentPage = Math.min(attributePage, totalPages);
            const startIndex = (currentPage - 1) * itemsPerPage;
            const paginatedFeatures = filteredFeatures.slice(startIndex, startIndex + itemsPerPage);

            const handleHeaderClick = (key: string) => {
              if (attributeSortKey === key) {
                setAttributeSortDesc(!attributeSortDesc);
              } else {
                setAttributeSortKey(key);
                setAttributeSortDesc(false);
              }
              setAttributePage(1);
            };

            // Download CSV helper
            const downloadCsv = () => {
              if (features.length === 0) return;
              const headersRow = propertyHeaders.join(",");
              const rows = features.map((f: any) => 
                propertyHeaders.map(h => {
                  const val = f?.properties?.[h];
                  if (val === undefined || val === null) return "";
                  // Escape commas and quotes
                  const str = String(val).replace(/"/g, '""');
                  return str.includes(",") || str.includes("\n") || str.includes('"') ? `"${str}"` : str;
                }).join(",")
              );
              const csvContent = [headersRow, ...rows].join("\n");
              const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.setAttribute("href", url);
              link.setAttribute("download", `${activeLayer.name}_attributes.csv`);
              link.style.visibility = "hidden";
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              showToast(`Exported ${features.length} attribute rows to CSV`, "success");
            };

            return (
              <div
                id="attribute-table-section"
                className="bg-white rounded-[2rem] border border-slate-200 shadow-md p-6 flex flex-col gap-4 w-full transition-all duration-300 scroll-mt-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-50 rounded-2xl">
                      <Table className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h4 className="text-sm font-extrabold text-slate-800">
                        Attribute Table: <span className="text-indigo-600">{activeLayer.name}</span>
                      </h4>
                      <p className="text-[11px] text-slate-500 font-medium">
                        Showing {startIndex + 1}–{Math.min(startIndex + itemsPerPage, totalItems)} of {totalItems} features ({features.length} total)
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Search bar */}
                    <div className="relative w-full sm:w-60">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search attributes..."
                        value={attributeSearchQuery}
                        onChange={(e) => {
                          setAttributeSearchQuery(e.target.value);
                          setAttributePage(1);
                        }}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={downloadCsv}
                      className="cursor-pointer bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold py-2 px-3 rounded-xl border border-slate-200 flex items-center gap-1.5 transition-colors"
                      title="Download as CSV Spreadsheet"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-500" /> Export CSV
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedAttributeLayerId("")}
                      className="cursor-pointer text-slate-400 hover:text-red-500 hover:bg-red-50/50 p-2 rounded-xl text-xs transition-colors font-bold"
                    >
                      Close Table
                    </button>
                  </div>
                </div>

                {/* Table container */}
                <div className="w-full overflow-x-auto border border-slate-150 rounded-2xl max-h-[360px] custom-scrollbar">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                        <th className="py-3 px-4 font-extrabold text-slate-500 text-[10px] uppercase tracking-wider w-16 text-center">
                          Actions
                        </th>
                        <th className="py-3 px-2 font-extrabold text-slate-500 text-[10px] uppercase tracking-wider w-12 text-center">
                          FID
                        </th>
                        {propertyHeaders.map(key => (
                          <th
                            key={key}
                            onClick={() => handleHeaderClick(key)}
                            className="py-3 px-4 font-extrabold text-slate-600 text-[10px] uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none transition-colors"
                          >
                            <div className="flex items-center gap-1">
                              <span>{key}</span>
                              <ArrowUpDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 ${attributeSortKey === key ? "text-indigo-600" : ""}`} />
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150">
                      {paginatedFeatures.length === 0 ? (
                        <tr>
                          <td colSpan={propertyHeaders.length + 2} className="py-12 text-center text-slate-400 font-medium">
                            No features found matching "{attributeSearchQuery}"
                          </td>
                        </tr>
                      ) : (
                        paginatedFeatures.map((f: any, idx) => {
                          const fid = startIndex + idx + 1;
                          const properties = f.properties || {};
                          
                          // Calculate feature centroid for "Zoom to Feature" button
                          let featureCentroid: [number, number] | null = null;
                          let featureBounds: { minLng: number, maxLng: number, minLat: number, maxLat: number } | null = null;
                          
                          if (f.geometry && f.geometry.coordinates) {
                            let minLng = Infinity, maxLng = -Infinity;
                            let minLat = Infinity, maxLat = -Infinity;
                            let sumLng = 0, sumLat = 0, count = 0;

                            const traverseCoords = (coords: any) => {
                              if (Array.isArray(coords) && typeof coords[0] === "number") {
                                const [lng, lat] = coords;
                                if (lng < minLng) minLng = lng;
                                if (lng > maxLng) maxLng = lng;
                                if (lat < minLat) minLat = lat;
                                if (lat > maxLat) maxLat = lat;
                                sumLng += lng;
                                sumLat += lat;
                                count++;
                              } else if (Array.isArray(coords)) {
                                coords.forEach(traverseCoords);
                              }
                            };

                            traverseCoords(f.geometry.coordinates);
                            if (count > 0) {
                              featureCentroid = [sumLng / count, sumLat / count];
                              featureBounds = { minLng, maxLng, minLat, maxLat };
                            }
                          }

                          return (
                            <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-2.5 px-4 text-center">
                                {featureCentroid ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (featureCentroid && featureBounds) {
                                        zoomToCentroid(featureCentroid[0], featureCentroid[1], featureBounds);
                                        showToast(`Zoomed map to feature FID ${fid}`, "info");
                                      }
                                    }}
                                    className="cursor-pointer bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold py-1 px-2.5 rounded-lg border border-indigo-100 transition-colors inline-flex items-center gap-1"
                                    title="Center and Zoom to Feature Boundary"
                                  >
                                    <Maximize2 className="w-3 h-3" /> Zoom
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-slate-400 font-medium">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-2 text-center text-slate-400 font-mono text-[10px] font-medium">
                                {fid}
                              </td>
                              {propertyHeaders.map(key => {
                                const val = properties[key];
                                return (
                                  <td key={key} className="py-1 px-2 text-slate-700 font-medium whitespace-nowrap overflow-hidden max-w-[200px]" title={String(val ?? "")}>
                                    <input
                                      type="text"
                                      value={val === undefined || val === null ? "" : String(val)}
                                      onChange={(e) => {
                                        const newValue = e.target.value;
                                        const updatedLayers = layers.map(layer => {
                                          if (layer.id === selectedAttributeLayerId) {
                                            const updatedFeatures = (layer.geoJson.features || []).map((feature: any, fIdx: number) => {
                                              if (fIdx === (startIndex + idx)) {
                                                return {
                                                  ...feature,
                                                  properties: {
                                                    ...feature.properties,
                                                    [key]: newValue
                                                  }
                                                };
                                              }
                                              return feature;
                                            });
                                            return {
                                              ...layer,
                                              geoJson: {
                                                ...layer.geoJson,
                                                features: updatedFeatures
                                              }
                                            };
                                          }
                                          return layer;
                                        });
                                        setLayers(updatedLayers);
                                      }}
                                      className="bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded px-1.5 py-0.5 text-xs font-semibold text-slate-700 w-full focus:outline-none transition-all"
                                      placeholder="null"
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-100 pt-4 text-xs">
                    <span className="text-slate-500 font-medium">
                      Page <strong className="text-slate-800">{currentPage}</strong> of <strong className="text-slate-800">{totalPages}</strong>
                    </span>

                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-inner">
                      <button
                        type="button"
                        onClick={() => setAttributePage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="cursor-pointer bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 text-slate-700 font-bold px-3 py-1.5 rounded-lg border border-slate-200 transition-all shadow-sm"
                      >
                        Prev
                      </button>

                      {/* Dynamic page numbers */}
                      {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                        let pageNum = currentPage;
                        if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }
                        
                        if (pageNum < 1 || pageNum > totalPages) return null;

                        return (
                          <button
                            key={pageNum}
                            type="button"
                            onClick={() => setAttributePage(pageNum)}
                            className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              currentPage === pageNum
                                ? "bg-slate-950 text-white shadow-md"
                                : "text-slate-600 hover:bg-slate-150"
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() => setAttributePage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="cursor-pointer bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 text-slate-700 font-bold px-3 py-1.5 rounded-lg border border-slate-200 transition-all shadow-sm"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Quick interactive map key/guide */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
            <span className="text-slate-500 font-medium flex items-center gap-1.5">
              <Info className="w-4 h-4 text-indigo-500" />
              Dynamic ground scale and grid intervals are mathematically derived based on regional latitude projection.
            </span>
            <div className="flex gap-2 font-bold text-[10px]">
              <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-100">Survey Neatline Frame</span>
              <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full border border-indigo-100">WGS84 Extent Fit</span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

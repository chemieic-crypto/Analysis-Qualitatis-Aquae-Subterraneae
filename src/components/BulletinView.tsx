import React, { useState, useEffect, useMemo, useRef } from "react";
import JSZip from "jszip";
import { DataHeaders } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { getStats, getPercentile } from "../utils/math";
import { generateParamDonutChart, generateOfflineChartBase64, buildColumnsChartOptions } from "../utils/chartHelpers";
import { downloadMhtmlWordDoc, convertHtmlToWordDocHtml, convertHtmlToMhtml, convertHtmlToDocxBlob } from "../utils/export";
import {
  FileText,
  DownloadCloud,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  ChevronUp,
  Upload,
  UploadCloud,
  Trash2,
  Map,
  Clipboard,
  X,
  Globe
} from "lucide-react";

interface BulletinViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState: string;
  bulletinMaps?: Record<string, string>;
  setBulletinMaps?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  shapefileGeoJson?: any | null;
}

export default function BulletinView({
  rawData,
  headers,
  headerMap,
  selectedState,
  bulletinMaps: propsBulletinMaps,
  setBulletinMaps: propsSetBulletinMaps,
  shapefileGeoJson: propsShapefileGeoJson,
}: BulletinViewProps) {
  const [bulletinScope, setBulletinScope] = useState("National");
  const bulletinScopeRef = useRef(bulletinScope);
  bulletinScopeRef.current = bulletinScope;
  const [bulletinSeason, setBulletinSeason] = useState("2025");
  const [selectedBulletinParams, setSelectedBulletinParams] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isHindi = false;

  // Map and Legend Customization State Variables
  const [showStylingPanel, setShowStylingPanel] = useState(false);
  const [customMapTitleText, setCustomMapTitleText] = useState("");
  const [customMapTitleColor, setCustomMapTitleColor] = useState("#0f172a");
  const [customMapTitleSize, setCustomMapTitleSize] = useState("16");
  const [customMapTitleFont, setCustomMapTitleFont] = useState("Inter");

  const [customLegendTitleText, setCustomLegendTitleText] = useState("");
  const [customLegendTitleColor, setCustomLegendTitleColor] = useState("#0f172a");
  const [customLegendTitleSize, setCustomLegendTitleSize] = useState("9.5");
  const [customLegendTitleFont, setCustomLegendTitleFont] = useState("Inter");
  const bulletinMaps = propsBulletinMaps || {};
  const setBulletinMaps = propsSetBulletinMaps;
  const [generationProgress, setGenerationProgress] = useState<string>("");

  const shapefileGeoJson = propsShapefileGeoJson || null;

  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [bulletinHtml, setBulletinHtml] = useState("");
  const [compiledMapImages, setCompiledMapImages] = useState<Record<string, string>>({});
  const [customArsenicWellImage, setCustomArsenicWellImage] = useState<string | null>(null);
  const [uploadParamSelected, setUploadParamSelected] = useState("STATIONS");

  const [customSets, setCustomSets] = useState<Array<{
    id: string;
    name: string;
    selectedLocations: string[];
  }>>([]);

  useEffect(() => {
    setCustomSets([]);
  }, [bulletinScope]);

  const availableDiagramLocations = useMemo(() => {
    const stateCol = headers && headers.state ? headers.state : null;
    const districtCol = headers && headers.district ? headers.district : null;
    const groupCol = bulletinScope === "National" ? stateCol : districtCol;
    
    if (!groupCol || !rawData) return [];
    
    let dataset = rawData;
    if (bulletinScope !== "National" && stateCol) {
      dataset = rawData.filter(
        (d) => d && String(d[stateCol] || "").trim() === bulletinScope
      );
    }
    
    return [...new Set(dataset.map((d) => d && d[groupCol] ? String(d[groupCol]).trim() : ""))]
      .filter((v) => v && v !== "Unknown" && v !== "-" && v !== "—")
      .sort();
  }, [rawData, bulletinScope, headers]);

  const uniqueActiveMapKeys = useMemo(() => {
    const keys = Object.keys(bulletinMaps);
    const seen = new Set<string>();
    const result: string[] = [];
    keys.forEach((k) => {
      const upper = k.toUpperCase();
      if (!seen.has(upper)) {
        seen.add(upper);
        result.push(k);
      }
    });
    return result;
  }, [bulletinMaps]);

  const handleUploadCustomMap = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result && setBulletinMaps) {
        const base64Str = event.target.result as string;
        setBulletinMaps((prev) => ({
          ...prev,
          [uploadParamSelected]: base64Str,
          [uploadParamSelected.toUpperCase()]: base64Str,
          [uploadParamSelected.toLowerCase()]: base64Str,
        }));
        if (hasGenerated) {
          setTimeout(() => handleGenerateBulletin(), 120);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const scopeStates = useMemo(() => {
    const key = headers?.state || "";
    if (!key || !rawData) return [];
    return [...new Set(rawData.map((d) => d ? String(d[key] || "").trim() : ""))]
      .filter((v) => v && v !== "Unknown")
      .sort();
  }, [rawData, headers?.state]);

  const scopeData = useMemo(() => {
    let filtered = rawData || [];
    const stateKey = headers?.state;
    if (bulletinScope !== "National" && stateKey) {
      filtered = filtered.filter(
        (d) => d && String(d[stateKey] || "").trim() === bulletinScope
      );
    }
    return filtered;
  }, [rawData, bulletinScope, headers?.state]);

  // Filter out Na, K, HCO3, CO3 from bulletin parameter list (parameters without BIS limits)
  const availableParams = useMemo(() => {
    if (!headers || !headers.params) return [];
    return headers.params.filter(p => {
      const paramId = headerMap[p] || p;
      return !["Na", "K", "HCO3", "CO3"].includes(paramId);
    });
  }, [headers, headerMap]);

  useEffect(() => {
    if (availableParams.length > 0) {
      setSelectedBulletinParams([...availableParams]);
    } else {
      setSelectedBulletinParams([]);
    }
  }, [availableParams]);

  const handleSelectAll = () => {
    if (selectedBulletinParams.length === availableParams.length) {
      setSelectedBulletinParams([]);
    } else {
      setSelectedBulletinParams([...availableParams]);
    }
  };

  const handleToggleParam = (val: string) => {
    if (selectedBulletinParams.includes(val)) {
      setSelectedBulletinParams(selectedBulletinParams.filter((p) => p !== val));
    } else {
      setSelectedBulletinParams([...selectedBulletinParams, val]);
    }
  };

  // Helper stats gatherer
  const getBulletinStats = (paramKey: string, filteredDataset: any[]) => {
    let total = 0;
    let exceed = 0;
    const config = PARAM_CONFIG[paramKey];
    if (!config) return { total: 0, exceed: 0, pct: "0.00" };

    const mappedHeader = Object.keys(headerMap).find((k) => headerMap[k] === paramKey);
    if (!mappedHeader) return { total: 0, exceed: 0, pct: "0.00" };

    filteredDataset.forEach((d) => {
      const val = parseFloat(d[mappedHeader]);
      if (!isNaN(val)) {
        total++;
        const isSingleLimit = config.b1 === config.b2 && paramKey !== "pH";
        const limit = isSingleLimit ? config.b1 : config.b2;
        if (paramKey === "pH") {
          if (val < config.b1 || val > config.b2) exceed++;
        } else if (val > limit) {
          exceed++;
        }
      }
    });

    const pct = total > 0 ? ((exceed / total) * 100).toFixed(2) : "0.00";
    return { total, exceed, pct };
  };

  const safeStringToBase64 = (str: string): string => {
    try {
      const bytes = new TextEncoder().encode(str);
      let binary = "";
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    } catch (e) {
      console.error("safeStringToBase64 failed:", e);
      return "";
    }
  };

  const safeSvgToBase64 = (svgString: string): Promise<string> => {
    return new Promise((resolve) => {
      try {
        const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result as string || "");
        };
        reader.onerror = () => {
          resolve("");
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        console.error("safeSvgToBase64 error:", e);
        resolve("");
      }
    });
  };

  const convertSvgToPngBase64 = (svgString: string, w = 600, h = 800): Promise<string> => {
    return new Promise((resolve) => {
      let blobUrl = "";
      try {
        if (!svgString) {
          resolve("");
          return;
        }

        const scaleFactor = 4.0; // High-resolution 4x supersampling for crystal clear 300+ DPI vector maps
        const targetW = w * scaleFactor;
        const targetH = h * scaleFactor;

        // Force browser's SVG engine to rasterize at 4x resolution by replacing root attributes
        let processedSvg = svgString;
        processedSvg = processedSvg.replace(/width="600"/, `width="${targetW}"`);
        processedSvg = processedSvg.replace(/height="800"/, `height="${targetH}"`);

        const svgBlob = new Blob([processedSvg], { type: "image/svg+xml;charset=utf-8" });
        blobUrl = URL.createObjectURL(svgBlob);
        const image = new Image();
        
        let finished = false;
        const complete = (val: string) => {
          if (!finished) {
            finished = true;
            if (blobUrl) {
              try { URL.revokeObjectURL(blobUrl); } catch (_) {}
            }
            resolve(val);
          }
        };

        const timeoutId = setTimeout(() => {
          // If canvas conversion takes too long, resolve with a safe base64 data URL to ensure report proceeds
          safeSvgToBase64(svgString).then((safeBase64) => {
            complete(safeBase64);
          });
        }, 350);

        image.onload = () => {
          clearTimeout(timeoutId);
          try {
            const scaleFactor = 4.0; // High-resolution 4x supersampling for crystal clear 300+ DPI vector maps
            const canvas = document.createElement("canvas");
            canvas.width = w * scaleFactor;
            canvas.height = h * scaleFactor;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
              complete(canvas.toDataURL("image/png", 1.0));
              return;
            }
          } catch (canvasErr) {
            console.error("convertSvgToPngBase64 canvas render failed, using fallback:", canvasErr);
          }
          safeSvgToBase64(svgString).then((safeBase64) => {
            complete(safeBase64);
          });
        };

        image.onerror = (e) => {
          clearTimeout(timeoutId);
          console.error("convertSvgToPngBase64 image src loader failed, using fallback:", e);
          safeSvgToBase64(svgString).then((safeBase64) => {
            complete(safeBase64);
          });
        };

        image.src = blobUrl;
      } catch (err) {
        console.error("convertSvgToPngBase64 outer execution error:", err);
        if (blobUrl) {
          try { URL.revokeObjectURL(blobUrl); } catch (_) {}
        }
        safeSvgToBase64(svgString).then((safeBase64) => {
          resolve(safeBase64);
        });
      }
    });
  };

  const findHeaderByKeys = (row: any, candidates: string[]): string | undefined => {
    if (!row) return undefined;
    const keys = Object.keys(row);
    for (const c of candidates) {
      const found = keys.find(k => k.toLowerCase().trim() === c.toLowerCase().trim());
      if (found) return found;
    }
    return undefined;
  };

  const cachedMapGeometry = useMemo(() => {
    if (!scopeData.length) {
      return null;
    }

    try {
      const sampleRow = scopeData[0];
      const latHeader = headers.latitude || findHeaderByKeys(sampleRow, ["latitude", "lat", "latitude_dd", "y", "northing"]);
      const lngHeader = headers.longitude || findHeaderByKeys(sampleRow, ["longitude", "lng", "lon", "longitude_dd", "x", "easting"]);
      const stateHeader = headers.state || findHeaderByKeys(sampleRow, ["state", "st_nm", "state_name"]);

      if (!latHeader || !lngHeader) {
        return null;
      }

      // Filter dataset based on current state-level or similar boundary scope
      const filteredDataset = scopeData.filter((d) => {
        if (bulletinScope !== "National" && stateHeader) {
          return String(d[stateHeader] || "").trim() === bulletinScope;
        }
        return true;
      });

      let minLat = 90;
      let maxLat = -90;
      let minLng = 180;
      let maxLng = -180;
      let hasCoords = false;

      filteredDataset.forEach((d) => {
        const lat = parseFloat(d[latHeader]);
        const lng = parseFloat(d[lngHeader]);
        if (!isNaN(lat) && !isNaN(lng)) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          hasCoords = true;
        }
      });

      const getGeoJsonBounds = (geojson: any) => {
        let gMinLat = Infinity;
        let gMaxLat = -Infinity;
        let gMinLng = Infinity;
        let gMaxLng = -Infinity;
        let found = false;

        const traverseCoords = (coords: any) => {
          if (!coords) return;
          if (Array.isArray(coords)) {
            if (typeof coords[0] === "number" && typeof coords[1] === "number") {
              const lng = coords[0];
              const lat = coords[1];
              if (!isNaN(lat) && !isNaN(lng)) {
                if (lat < gMinLat) gMinLat = lat;
                if (lat > gMaxLat) gMaxLat = lat;
                if (lng < gMinLng) gMinLng = lng;
                if (lng > gMaxLng) gMaxLng = lng;
                found = true;
              }
            } else {
              for (let i = 0; i < coords.length; i++) {
                traverseCoords(coords[i]);
              }
            }
          }
        };

        const traverseFeatures = (node: any) => {
          if (!node) return;
          if (Array.isArray(node)) {
            node.forEach(traverseFeatures);
            return;
          }
          if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
            node.features.forEach(traverseFeatures);
          } else if (node.type === "Feature") {
            if (node.geometry) {
              traverseCoords(node.geometry.coordinates);
            }
          } else if (node.geometry) {
            traverseCoords(node.geometry.coordinates);
          } else if (node.coordinates) {
            traverseCoords(node.coordinates);
          }
        };

        traverseFeatures(geojson);
        return found ? { minLat: gMinLat, maxLat: gMaxLat, minLng: gMinLng, maxLng: gMaxLng } : null;
      };

      if (shapefileGeoJson) {
        const bounds = getGeoJsonBounds(shapefileGeoJson);
        if (bounds) {
          minLat = bounds.minLat;
          maxLat = bounds.maxLat;
          minLng = bounds.minLng;
          maxLng = bounds.maxLng;
          hasCoords = true;
        }
      }

      if (!hasCoords) return null;

      if (minLat >= maxLat || minLng >= maxLng || minLat === 90 || minLng === 180) {
        minLat = 8.0;
        maxLat = 37.0;
        minLng = 68.0;
        maxLng = 97.0;
      }

      const latSpan = maxLat - minLat || 0.1;
      const lngSpan = maxLng - minLng || 0.1;
      const pad = shapefileGeoJson ? 0.08 : 0.15;
      minLat -= latSpan * pad;
      maxLat += latSpan * pad;
      minLng -= lngSpan * pad;
      maxLng += lngSpan * pad;

      const mapStartX = 45;
      const mapEndX = 550;
      const mapStartY = 120;
      const mapEndY = 640;

      const tx = (lng: number) => {
        const denom = maxLng - minLng || 0.1;
        return mapStartX + ((lng - minLng) / denom) * (mapEndX - mapStartX);
      };
      
      const ty = (lat: number) => {
        const denom = maxLat - minLat || 0.1;
        return mapEndY - ((lat - minLat) / denom) * (mapEndY - mapStartY);
      };

      // Faster SVG path compiler with optimized geometry coordinate simplification
      const renderGeoJsonToSvg = (geojson: any): string => {
        let paths = "";

        const renderCoordsToPath = (coords: any, isClosed: boolean): string => {
          if (!Array.isArray(coords) || coords.length === 0) return "";
          let d = "";
          // Simplify denser polygons to avoid huge SVG outputs
          const step = coords.length > 500 ? Math.ceil(coords.length / 250) : 1;

          for (let i = 0; i < coords.length; i += step) {
            const pt = coords[i];
            if (Array.isArray(pt) && typeof pt[0] === "number" && typeof pt[1] === "number") {
              const x = tx(pt[0]);
              const y = ty(pt[1]);
              if (d === "") {
                d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
              } else {
                d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
              }
            }
          }
          if (coords.length > 1 && step > 1) {
            const lastPt = coords[coords.length - 1];
            if (Array.isArray(lastPt) && typeof lastPt[0] === "number" && typeof lastPt[1] === "number") {
              const x = tx(lastPt[0]);
              const y = ty(lastPt[1]);
              d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
            }
          }

          if (isClosed && d) d += " Z";
          return d;
        };

        const traverseAndGenerate = (node: any) => {
          if (!node) return;
          if (Array.isArray(node)) {
            node.forEach(traverseAndGenerate);
            return;
          }
          if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
            node.features.forEach(traverseAndGenerate);
          } else {
            const geom = node.type === "Feature" ? node.geometry : node;
            if (geom && geom.coordinates) {
              if (geom.type === "Polygon") {
                if (Array.isArray(geom.coordinates)) {
                  geom.coordinates.forEach((ring: any) => {
                    const pathData = renderCoordsToPath(ring, true);
                    if (pathData) {
                      paths += `<path d="${pathData}" fill="none" stroke="#1e293b" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />\n`;
                    }
                  });
                }
              } else if (geom.type === "MultiPolygon") {
                if (Array.isArray(geom.coordinates)) {
                  geom.coordinates.forEach((poly: any) => {
                    if (Array.isArray(poly)) {
                      poly.forEach((ring: any) => {
                        const pathData = renderCoordsToPath(ring, true);
                        if (pathData) {
                          paths += `<path d="${pathData}" fill="none" stroke="#1e293b" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />\n`;
                        }
                      });
                    }
                  });
                }
              } else if (geom.type === "LineString") {
                const pathData = renderCoordsToPath(geom.coordinates, false);
                if (pathData) {
                  paths += `<path d="${pathData}" fill="none" stroke="#1e3a8a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />\n`;
                }
              } else if (geom.type === "MultiLineString") {
                if (Array.isArray(geom.coordinates)) {
                  geom.coordinates.forEach((line: any) => {
                    const pathData = renderCoordsToPath(line, false);
                    if (pathData) {
                      paths += `<path d="${pathData}" fill="none" stroke="#1e3a8a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />\n`;
                    }
                  });
                }
              }
            }
          }
        };

        traverseAndGenerate(geojson);
        return paths;
      };

      const renderGeoJsonToClipPath = (geojson: any): string => {
        let paths = "";

        const renderCoordsToPath = (coords: any, isClosed: boolean): string => {
          if (!Array.isArray(coords) || coords.length === 0) return "";
          let d = "";
          const step = coords.length > 500 ? Math.ceil(coords.length / 250) : 1;

          for (let i = 0; i < coords.length; i += step) {
            const pt = coords[i];
            if (Array.isArray(pt) && typeof pt[0] === "number" && typeof pt[1] === "number") {
              const x = tx(pt[0]);
              const y = ty(pt[1]);
              if (d === "") {
                d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
              } else {
                d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
              }
            }
          }
          if (coords.length > 1 && step > 1) {
            const lastPt = coords[coords.length - 1];
            if (Array.isArray(lastPt) && typeof lastPt[0] === "number" && typeof lastPt[1] === "number") {
              const x = tx(lastPt[0]);
              const y = ty(lastPt[1]);
              d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
            }
          }

          if (isClosed && d) d += " Z";
          return d;
        };

        const traverseClip = (node: any) => {
          if (!node) return;
          if (Array.isArray(node)) {
            node.forEach(traverseClip);
            return;
          }
          if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
            node.features.forEach(traverseClip);
          } else {
            const geom = node.type === "Feature" ? node.geometry : node;
            if (geom && geom.coordinates) {
              if (geom.type === "Polygon") {
                if (Array.isArray(geom.coordinates)) {
                  geom.coordinates.forEach((ring: any) => {
                    const pathData = renderCoordsToPath(ring, true);
                    if (pathData) {
                      paths += `<path d="${pathData}" />\n`;
                    }
                  });
                }
              } else if (geom.type === "MultiPolygon") {
                if (Array.isArray(geom.coordinates)) {
                  geom.coordinates.forEach((poly: any) => {
                    if (Array.isArray(poly)) {
                      poly.forEach((ring: any) => {
                        const pathData = renderCoordsToPath(ring, true);
                        if (pathData) {
                          paths += `<path d="${pathData}" />\n`;
                        }
                      });
                    }
                  });
                }
              }
            }
          }
        };

        traverseClip(geojson);
        return paths;
      };

      const shapefilePaths = shapefileGeoJson ? renderGeoJsonToSvg(shapefileGeoJson) : "";
      const shapefileClips = shapefileGeoJson ? renderGeoJsonToClipPath(shapefileGeoJson) : "";

      return {
        minLat,
        maxLat,
        minLng,
        maxLng,
        tx,
        ty,
        shapefilePaths,
        shapefileClips,
        filteredDataset
      };
    } catch (e) {
      console.error("Failed to generate cachedMapGeometry:", e);
      return null;
    }
  }, [scopeData, bulletinScope, shapefileGeoJson, headers.latitude, headers.longitude, headers.state]);

  const getAutoSvgMap = (paramKey: string, dataset: any[]): string => {
    try {
      const isStationsMap = paramKey === "STATIONS" || paramKey === "STATIONS_ALL" || paramKey === "ALL";
      let config = PARAM_CONFIG[paramKey];
      if (!config && isStationsMap) {
        config = { b1: 0, b2: 0, unit: "", name: "Ground Water Quality Monitoring Station", keywords: [] };
      }
      if (!config) return "";

      const sampleRow = dataset[0];
      const latHeader = headers.latitude || findHeaderByKeys(sampleRow, ["latitude", "lat", "latitude_dd", "y", "northing"]);
      const lngHeader = headers.longitude || findHeaderByKeys(sampleRow, ["longitude", "lng", "lon", "longitude_dd", "x", "easting"]);
      if (!latHeader || !lngHeader) return "";

      const geom = cachedMapGeometry;
      if (!geom) return "";

      const mappedPts: any[] = [];

      // If SAR or RSC, calculate on-the-fly, otherwise locate via config key
      if (paramKey === "SAR" || paramKey === "RSC") {
        const findColByAliases = (row: any, aliases: string[]): string | null => {
          if (!row) return null;
          const rowKeys = Object.keys(row);
          for (const alias of aliases) {
            const matched = rowKeys.find(k => {
              try {
                return new RegExp(`\\b${alias}\\b`, "i").test(k);
              } catch {
                return k.toLowerCase() === alias.toLowerCase();
              }
            });
            if (matched) return matched;
          }
          return null;
        };

        const getVal = (row: any, col: string | null): number => {
          if (!col || row[col] === undefined || row[col] === null) return 0;
          const val = parseFloat(row[col]);
          return isNaN(val) ? 0 : val;
        };

        const caCol = findColByAliases(sampleRow, ["ca", "calcium", "ca++", "ca2+"]);
        const mgCol = findColByAliases(sampleRow, ["mg", "magnesium", "mg++", "mg2+"]);
        const naCol = findColByAliases(sampleRow, ["na", "sodium", "na+"]);
        const hco3Col = findColByAliases(sampleRow, ["hco3", "bicarbonate", "hco3-"]);
        const co3Col = findColByAliases(sampleRow, ["co3", "carbonate", "co3--"]);

        geom.filteredDataset.forEach((d) => {
          const lat = parseFloat(d[latHeader]);
          const lng = parseFloat(d[lngHeader]);
          if (isNaN(lat) || isNaN(lng)) return;

          let val = 0;
          if (paramKey === "SAR") {
            const caVal = getVal(d, caCol);
            const mgVal = getVal(d, mgCol);
            const naVal = getVal(d, naCol);
            const meqCa = caVal / 20.04;
            const meqMg = mgVal / 12.16;
            const meqNa = naVal / 23.0;
            val = (meqCa + meqMg > 0) ? (meqNa / Math.sqrt((meqCa + meqMg) / 2)) : 0;
          } else {
            const caVal = getVal(d, caCol);
            const mgVal = getVal(d, mgCol);
            const hco3Val = getVal(d, hco3Col);
            const co3Val = getVal(d, co3Col);
            const meqCa = caVal / 20.04;
            const meqMg = mgVal / 12.16;
            const meqHCO3 = hco3Val / 61.02;
            const meqCO3 = co3Val / 30.0;
            val = (meqHCO3 + meqCO3) - (meqCa + meqMg);
          }
          mappedPts.push({ lat, lng, value: val });
        });
      } else if (isStationsMap) {
        geom.filteredDataset.forEach((d) => {
          const lat = parseFloat(d[latHeader]);
          const lng = parseFloat(d[lngHeader]);
          if (!isNaN(lat) && !isNaN(lng)) {
            mappedPts.push({ lat, lng, value: 1 });
          }
        });
      } else {
        const mappedHeader = Object.keys(headerMap).find((k) => headerMap[k] === paramKey) || findHeaderByKeys(sampleRow, [paramKey, ...(config.keywords || [])]);
        if (mappedHeader) {
          geom.filteredDataset.forEach((d) => {
            const lat = parseFloat(d[latHeader]);
            const lng = parseFloat(d[lngHeader]);
            const val = parseFloat(d[mappedHeader]);
            if (!isNaN(lat) && !isNaN(lng) && !isNaN(val)) {
              mappedPts.push({ lat, lng, value: val });
            }
          });
        }
      }

      if (mappedPts.length === 0) return "";

      const minLat = geom.minLat;
      const maxLat = geom.maxLat;
      const minLng = geom.minLng;
      const maxLng = geom.maxLng;
      const tx = geom.tx;
      const ty = geom.ty;

      // Coordinate Grid area matching original cached layout
      const mapStartX = 45;
      const mapEndX = 550;
      const mapStartY = 120;
      const mapEndY = 640;

      const mapW = mapEndX - mapStartX;
      const mapH = mapEndY - mapStartY;
      const canvasScale = 4.0; // Perfect high-DPI balance

      const canvas = document.createElement("canvas");
      canvas.width = mapW * canvasScale;
      canvas.height = mapH * canvasScale;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // Soft glossy subtle background gradient
        const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        bgGrad.addColorStop(0, "#ffffff");
        bgGrad.addColorStop(1, "#f8fafc");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const isInterpolationMap = false;

        // 1. Draw clipped background (interpolation grid OR default shapefile fill)
        if (shapefileGeoJson) {
          ctx.save();
          ctx.beginPath();
          
          const drawPolygonRings = (rings: any[]) => {
            rings.forEach((ring) => {
              if (!Array.isArray(ring) || ring.length === 0) return;
              const p0 = ring[0];
              if (!Array.isArray(p0) || p0.length < 2 || typeof p0[0] !== "number" || typeof p0[1] !== "number" || isNaN(p0[0]) || isNaN(p0[1])) return;
              ctx.moveTo((tx(p0[0]) - mapStartX) * canvasScale, (ty(p0[1]) - mapStartY) * canvasScale);
              for (let i = 1; i < ring.length; i++) {
                const p = ring[i];
                if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || isNaN(p[0]) || isNaN(p[1])) continue;
                ctx.lineTo((tx(p[0]) - mapStartX) * canvasScale, (ty(p[1]) - mapStartY) * canvasScale);
              }
              ctx.closePath();
            });
          };

          const traverseFeaturesForCanvas = (node: any) => {
            if (!node) return;
            if (Array.isArray(node)) {
              node.forEach(traverseFeaturesForCanvas);
              return;
            }
            if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
              node.features.forEach(traverseFeaturesForCanvas);
            } else if (node.type === "Feature") {
              traverseFeaturesForCanvas(node.geometry);
            } else if (node.type === "Polygon") {
              drawPolygonRings(node.coordinates);
            } else if (node.type === "MultiPolygon") {
              node.coordinates.forEach((poly: any) => {
                drawPolygonRings(poly);
              });
            }
          };

          traverseFeaturesForCanvas(shapefileGeoJson);
          
          if (isInterpolationMap) {
            // Apply clipping path for the interpolation grid inside the boundary
            ctx.clip("evenodd");

            // Perform highly optimized IDW spatial interpolation for TH, CL, and EC
            const cols = 75;
            const rows = 75;
            const cellW = mapW / cols;
            const cellH = mapH / rows;

            const b1 = config.b1 || 1.0;
            const b2 = config.b2 || b1 || 1.5;

            const getContinuousColor = (v: number) => {
              if (v <= b1) {
                const t = Math.max(0, v / b1);
                // interpolate between clean indigo/blue and soft emerald green
                return `rgb(${Math.round(59 + t * (16 - 59))}, ${Math.round(130 + t * (185 - 130))}, ${Math.round(246 + t * (129 - 246))})`;
              } else if (v <= b2) {
                const t = Math.max(0, (v - b1) / (b2 - b1));
                // interpolate between yellow and warm orange
                return `rgb(${Math.round(250 + t * (249 - 250))}, ${Math.round(204 + t * (115 - 204))}, ${Math.round(21 + t * (22 - 21))})`;
              } else {
                const t = Math.min(1.0, (v - b2) / b2);
                // interpolate between vibrant red and deep maroon
                return `rgb(${Math.round(239 + t * (127 - 239))}, ${Math.round(68 + t * (29 - 68))}, ${Math.round(68 + t * (29 - 68))})`;
              }
            };

            for (let r = 0; r < rows; r++) {
              const cellLat = minLat + ((mapH - r * cellH - cellH / 2) / mapH) * (maxLat - minLat);
              for (let c = 0; c < cols; c++) {
                const cellLng = minLng + ((c * cellW + cellW / 2) / mapW) * (maxLng - minLng);

                let cellValue = 0;
                let num = 0;
                let den = 0;
                let exactMatch: number | null = null;

                for (let i = 0; i < mappedPts.length; i++) {
                  const dLat = cellLat - mappedPts[i].lat;
                  const dLng = cellLng - mappedPts[i].lng;
                  const dSq = dLat * dLat + dLng * dLng;

                  if (dSq < 1e-12) {
                    exactMatch = mappedPts[i].value;
                    break;
                  }
                  const weight = 1 / (dSq * dSq); // Power 4 IDW is highly responsive
                  num += mappedPts[i].value * weight;
                  den += weight;
                }

                cellValue = exactMatch !== null ? exactMatch : (den > 0 ? num / den : 0);
                ctx.fillStyle = getContinuousColor(cellValue);
                ctx.fillRect(c * cellW * canvasScale, r * cellH * canvasScale, cellW * canvasScale + 0.6, cellH * canvasScale + 0.6);
              }
            }
          } else {
            // Draw standard background map fill
            const mapGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            mapGradient.addColorStop(0, "#f8fafc");
            mapGradient.addColorStop(1, "#f1f5f9");
            ctx.fillStyle = mapGradient;
            ctx.fill();
            ctx.clip("evenodd");
          }

          ctx.restore();
        }

        // 2. Draw Compliance Points with premium glossy 3D bead styling
        const limitVal = config.b2 || config.b1 || 0;
        mappedPts.forEach((pt) => {
          if (pt.value === undefined || isNaN(pt.value)) return;

          let isAbove = false;
          if (isStationsMap) {
            isAbove = false;
          } else if (paramKey === "pH") {
            isAbove = (pt.value < 6.5 || pt.value > 8.5);
          } else if (paramKey === "SAR") {
            isAbove = (pt.value > 26);
          } else if (paramKey === "RSC") {
            isAbove = (pt.value > 2.5);
          } else {
            isAbove = (pt.value > limitVal);
          }

          // If NOT an interpolation map, ONLY locate and draw points exceeding permissible limits
          if (!isInterpolationMap && !isAbove && !isStationsMap) {
            return; // Skip normal points for non-interpolation maps
          }

          const cx = (tx(pt.lng) - mapStartX) * canvasScale;
          const cy = (ty(pt.lat) - mapStartY) * canvasScale;
          const r = (isInterpolationMap ? 2.5 : 3.8) * canvasScale; // Bold beads for highlight

          ctx.save();
          
          // Outer high-dpi soft drop glow shadow
          ctx.shadowColor = isAbove 
            ? "rgba(239, 68, 68, 0.45)" 
            : (isStationsMap ? "rgba(2, 132, 199, 0.45)" : "rgba(16, 185, 129, 0.45)");
          ctx.shadowBlur = 3.5 * canvasScale;
          ctx.shadowOffsetX = 0.5 * canvasScale;
          ctx.shadowOffsetY = 1 * canvasScale;

          // Radial gradient for glossy 3D bead effect
          const grad = ctx.createRadialGradient(
            cx - r * 0.25,
            cy - r * 0.25,
            r * 0.05,
            cx,
            cy,
            r
          );
          
          if (isAbove) {
            // Premium glossy deep red for failure
            grad.addColorStop(0, "#ffc9c9");
            grad.addColorStop(0.35, "#ef4444");
            grad.addColorStop(1, "#991b1b");
          } else if (isStationsMap) {
            // Premium glossy royal blue/indigo for monitoring stations
            grad.addColorStop(0, "#e0f2fe");
            grad.addColorStop(0.35, "#0284c7");
            grad.addColorStop(1, "#0369a1");
          } else {
            // Premium glossy vibrant emerald green for safety
            grad.addColorStop(0, "#d1fae5");
            grad.addColorStop(0.35, "#10b981");
            grad.addColorStop(1, "#065f46");
          }

          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, 2 * Math.PI);
          ctx.fillStyle = grad;
          ctx.fill();

          // Reset shadow
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;

          // High-contrast clean white border outline
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 0.8 * canvasScale;
          ctx.stroke();

          // Tiny glossy white highlight reflection on top-left of the bead
          ctx.beginPath();
          ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.2, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.fill();

          ctx.restore();
        });

        // 3. Draw shapefile border cleanly on top
        if (shapefileGeoJson) {
          ctx.save();
          ctx.beginPath();
          const drawPolygonRings = (rings: any[]) => {
            rings.forEach((ring) => {
              if (!Array.isArray(ring) || ring.length === 0) return;
              const p0 = ring[0];
              if (!Array.isArray(p0) || p0.length < 2 || typeof p0[0] !== "number" || typeof p0[1] !== "number" || isNaN(p0[0]) || isNaN(p0[1])) return;
              ctx.moveTo((tx(p0[0]) - mapStartX) * canvasScale, (ty(p0[1]) - mapStartY) * canvasScale);
              for (let i = 1; i < ring.length; i++) {
                const p = ring[i];
                if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || isNaN(p[0]) || isNaN(p[1])) continue;
                ctx.lineTo((tx(p[0]) - mapStartX) * canvasScale, (ty(p[1]) - mapStartY) * canvasScale);
              }
              ctx.closePath();
            });
          };

          const traverseFeaturesForCanvas = (node: any) => {
            if (!node) return;
            if (Array.isArray(node)) {
              node.forEach(traverseFeaturesForCanvas);
              return;
            }
            if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
              node.features.forEach(traverseFeaturesForCanvas);
            } else if (node.type === "Feature") {
              traverseFeaturesForCanvas(node.geometry);
            } else if (node.type === "Polygon") {
              drawPolygonRings(node.coordinates);
            } else if (node.type === "MultiPolygon") {
              node.coordinates.forEach((poly: any) => {
                drawPolygonRings(poly);
              });
            }
          };

          traverseFeaturesForCanvas(shapefileGeoJson);
          ctx.strokeStyle = "#475569"; // premium slate border
          ctx.lineWidth = 1.0 * canvasScale;
          ctx.stroke();
          ctx.restore();
        }

        const mapImageBase64 = canvas.toDataURL("image/png");
        return mapImageBase64;
      }
    } catch (err) {
      console.error("Failed to generate auto map:", err);
    }
    return "";
  };
  const _unused_getAutoSvgMap = (paramKey: string, dataset: any[]): string => {
    return "";
    const physicalMapStyle: any = "interpolation";
    const bulletinInterpolationMethod: any = "idw";
    try {
      const config = PARAM_CONFIG[paramKey];
      if (!config) return "";

      const sampleRow = dataset[0];
      const latHeader = headers.latitude || findHeaderByKeys(sampleRow, ["latitude", "lat", "latitude_dd", "y", "northing"]);
      const lngHeader = headers.longitude || findHeaderByKeys(sampleRow, ["longitude", "lng", "lon", "longitude_dd", "x", "easting"]);
      if (!latHeader || !lngHeader) return "";

      const geom = cachedMapGeometry;
      if (!geom) return "";

      const mappedHeader = Object.keys(headerMap).find((k) => headerMap[k] === paramKey) || findHeaderByKeys(sampleRow, [paramKey, ...(config.keywords || [])]);
      if (!mappedHeader) return "";

      const mappedPts: any[] = [];
      geom.filteredDataset.forEach((d) => {
        const lat = parseFloat(d[latHeader]);
        const lng = parseFloat(d[lngHeader]);
        const val = parseFloat(d[mappedHeader]);
        if (!isNaN(lat) && !isNaN(lng)) {
          mappedPts.push({ lat, lng, value: val });
        }
      });

      if (mappedPts.length === 0) return "";

      const minLat = geom.minLat;
      const maxLat = geom.maxLat;
      const minLng = geom.minLng;
      const maxLng = geom.maxLng;
      const tx = geom.tx;
      const ty = geom.ty;
      
      const isInterpolationMap = false;
      let shapefilePaths = geom.shapefilePaths;
      if (shapefilePaths) {
        shapefilePaths = shapefilePaths.replace(/fill="rgba\(30, 41, 59, 0\.05\)"/g, 'fill="none"');
      }
      const shapefileClips = geom.shapefileClips;

      const svgW = 595;
      const svgH = 842;

      // Coordinate Grid area
      const mapStartX = 45;
      const mapEndX = 550;
      const mapStartY = 120;
      const mapEndY = 640;

      // 1. Setup beautiful progressive color bins dynamically based on standard limits
      const b1 = config.b1 || 1.0;
      const b2 = config.b2 || b1 || 1.5;
      const unit = config.unit || "";

      interface Bin {
        min: number;
        max: number;
        label: string;
        color: string;
        percent: number;
      }

      let bins: Bin[] = [];
      if (isInterpolationMap) {
        bins = [
          { min: 0, max: b1, label: `≤ ${b1}`, color: "#0044cc", percent: 0 },
          { min: b1, max: b2, label: `>${b1} to ${b2}`, color: "#ffff00", percent: 0 },
          { min: b2, max: Infinity, label: `> ${b2}`, color: "#ff0000", percent: 0 },
        ];
      } else if (paramKey === "pH") {
        bins = [
          { min: 0, max: 6.5, label: "< 6.5 (Acidic)", color: "#ea580c", percent: 0 },
          { min: 6.5, max: 7.2, label: "6.5 - 7.2 (Ideal)", color: "#2563eb", percent: 0 },
          { min: 7.2, max: 7.8, label: "7.2 - 7.8 (Optimal)", color: "#0d9488", percent: 0 },
          { min: 7.8, max: 8.5, label: "7.8 - 8.5 (Safe)", color: "#16a34a", percent: 0 },
          { min: 8.5, max: 9.0, label: "8.5 - 9.0 (Alkaline)", color: "#dc2626", percent: 0 },
          { min: 9.0, max: 14, label: "> 9.0 (Severe)", color: "#7f1d1d", percent: 0 },
        ];
      } else {
        const step1 = b1 * 0.5;
        const step2 = b1;
        const step3 = b2;
        const step4 = b2 * 1.5;
        const step5 = b2 * 2.5;

        bins = [
          { min: 0, max: step1, label: `0 - ${step1.toFixed(1)}`, color: "#2563eb", percent: 0 }, // Blue
          { min: step1, max: step2, label: `${step1.toFixed(1)} - ${step2.toFixed(1)}`, color: "#16a34a", percent: 0 }, // Green
          { min: step2, max: step3, label: `${step2.toFixed(1)} - ${step3.toFixed(1)}`, color: "#eab308", percent: 0 }, // Yellow (Permissible)
          { min: step3, max: step4, label: `${step3.toFixed(1)} - ${step4.toFixed(1)}`, color: "#ea580c", percent: 0 }, // Orange
          { min: step4, max: step5, label: `${step4.toFixed(1)} - ${step5.toFixed(1)}`, color: "#dc2626", percent: 0 }, // Red
          { min: step5, max: Infinity, label: `> ${step5.toFixed(1)}`, color: "#7f1d1d", percent: 0 }, // Brown
        ];
      }

      // Calculate sample point count percentages per bin
      if (mappedPts.length > 0) {
        if (isInterpolationMap) {
          let count1 = 0;
          let count2 = 0;
          let count3 = 0;
          mappedPts.forEach((pt) => {
            const val = pt.value;
            if (val <= b1) count1++;
            else if (val <= b2) count2++;
            else count3++;
          });
          bins[0].percent = parseFloat(((count1 / mappedPts.length) * 100).toFixed(1));
          bins[1].percent = parseFloat(((count2 / mappedPts.length) * 100).toFixed(1));
          bins[2].percent = parseFloat(((count3 / mappedPts.length) * 100).toFixed(1));
        } else {
          const counts = Array(bins.length).fill(0);
          mappedPts.forEach((pt) => {
            const val = pt.value;
            let counted = false;
            for (let i = 0; i < bins.length; i++) {
              if (val >= bins[i].min && val < bins[i].max) {
                counts[i]++;
                counted = true;
                break;
              }
            }
            if (!counted && val >= bins[bins.length - 1].min) {
              counts[bins.length - 1]++;
            }
          });
          for (let i = 0; i < bins.length; i++) {
            bins[i].percent = parseFloat(((counts[i] / mappedPts.length) * 100).toFixed(1));
          }
        }
      }

      // 2. Generate spatial interpolation grid using IDW (continuous steps across map box) - Only for EC, TH, Chloride
      let interpolationGridSvg = "";
      
      // High-performance map canvas image rendering
      let mapImageBase64 = "";
      try {
        const mapW = mapEndX - mapStartX; // 505
        const mapH = mapEndY - mapStartY; // 520
        const canvasScale = 3; // 3x high-density resolution for crisp, professional print quality (greatly optimizes speed)
        const canvas = document.createElement("canvas");
        canvas.width = mapW * canvasScale;
        canvas.height = mapH * canvasScale;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          // Draw light background if there's no shapefile
          if (!shapefileGeoJson) {
            ctx.fillStyle = "#f8fafc";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          if (shapefileGeoJson) {
            ctx.save();
            ctx.beginPath();
            const drawPolygonRings = (rings: any[]) => {
              rings.forEach((ring) => {
                if (!Array.isArray(ring) || ring.length === 0) return;
                const p0 = ring[0];
                if (!Array.isArray(p0) || p0.length < 2 || typeof p0[0] !== "number" || typeof p0[1] !== "number" || isNaN(p0[0]) || isNaN(p0[1])) return;
                ctx.moveTo((tx(p0[0]) - mapStartX) * canvasScale, (ty(p0[1]) - mapStartY) * canvasScale);
                for (let i = 1; i < ring.length; i++) {
                  const p = ring[i];
                  if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || isNaN(p[0]) || isNaN(p[1])) continue;
                  ctx.lineTo((tx(p[0]) - mapStartX) * canvasScale, (ty(p[1]) - mapStartY) * canvasScale);
                }
              });
            };

            const traverseFeaturesForCanvas = (node: any) => {
              if (!node) return;
              if (Array.isArray(node)) {
                node.forEach(traverseFeaturesForCanvas);
                return;
              }
              if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
                node.features.forEach(traverseFeaturesForCanvas);
              } else if (node.type === "Feature") {
                traverseFeaturesForCanvas(node.geometry);
              } else if (node.type === "Polygon") {
                drawPolygonRings(node.coordinates);
              } else if (node.type === "MultiPolygon") {
                node.coordinates.forEach((poly: any) => {
                  drawPolygonRings(poly);
                });
              }
            };

            traverseFeaturesForCanvas(shapefileGeoJson);
            ctx.clip("evenodd");
          }

          // Draw Interpolation Grid
          if (isInterpolationMap) {
            const startX = mapStartX;
            const endX = mapEndX;
            const startY = mapStartY;
            const endY = mapEndY;
            const gridW = endX - startX;
            const gridH = endY - startY;

            // Downsample math points to avoid browser lag
            let mathPts = mappedPts;
            if (mappedPts.length > 150) {
              const step = Math.ceil(mappedPts.length / 150);
              mathPts = [];
              for (let i = 0; i < mappedPts.length; i += step) {
                mathPts.push(mappedPts[i]);
              }
            }

            const cols = 80;
            const rows = 65;
            const cellW = gridW / cols;
            const cellH = gridH / rows;

            const getContinuousColor = (val: number, limit1: number, limit2: number): string => {
              if (val <= limit1) {
                return "#0044cc";
              } else if (val <= limit2) {
                return "#ffff00";
              } else {
                return "#ff0000";
              }
            };

            const colLngs = new Float64Array(cols);
            for (let c = 0; c < cols; c++) {
              colLngs[c] = minLng + ((c * cellW + cellW / 2) / gridW) * (maxLng - minLng);
            }

            const rowLats = new Float64Array(rows);
            for (let r = 0; r < rows; r++) {
              rowLats[r] = minLat + ((gridH - r * cellH - cellH / 2) / gridH) * (maxLat - minLat);
            }

            const pLats = new Float64Array(mathPts.length);
            const pLngs = new Float64Array(mathPts.length);
            const pVals = new Float64Array(mathPts.length);
            for (let i = 0; i < mathPts.length; i++) {
              pLats[i] = mathPts[i].lat;
              pLngs[i] = mathPts[i].lng;
              pVals[i] = mathPts[i].value;
            }

            const mathPtsLen = pLats.length;

            for (let r = 0; r < rows; r++) {
              const lat = rowLats[r];
              for (let c = 0; c < cols; c++) {
                const lng = colLngs[c];

                let cellValue = 0;
                let numerator = 0;
                let denominator = 0;
                let exactMatchVal: number | null = null;

                for (let i = 0; i < mathPtsLen; i++) {
                  const dLat = lat - pLats[i];
                  const dLng = lng - pLngs[i];
                  const dSq = dLat * dLat + dLng * dLng;

                  if (dSq < 1e-12) {
                    exactMatchVal = pVals[i];
                    break;
                  }
                  // Fast power 4 IDW avoids extremely slow Math.pow() and Math.sqrt() on the main thread
                  const w = 1 / (dSq * dSq);
                  numerator += pVals[i] * w;
                  denominator += w;
                }
                cellValue = exactMatchVal !== null ? exactMatchVal : (denominator > 0 ? numerator / denominator : 0);

                ctx.fillStyle = getContinuousColor(cellValue, b1, b2);
                ctx.fillRect(c * cellW * canvasScale, r * cellH * canvasScale, cellW * canvasScale + 0.5, cellH * canvasScale + 0.5);
              }
            }
          } else {
            // Draw Compliance Points as Red Circles
            const limitVal = config.b2 || config.b1 || 0;
            mappedPts.forEach((pt) => {
              const isAbove = (paramKey === "pH")
                ? (pt.value < 6.5 || pt.value > 8.5)
                : (pt.value > limitVal);

              if (isAbove) {
                const cx = (tx(pt.lng) - mapStartX) * canvasScale;
                const cy = (ty(pt.lat) - mapStartY) * canvasScale;
                ctx.beginPath();
                ctx.arc(cx, cy, 2.2 * canvasScale, 0, 2 * Math.PI);
                ctx.fillStyle = "#dc2626";
                ctx.fill();
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 0.5 * canvasScale;
                ctx.stroke();
              }
            });
          }

          // Restore clipping path
          if (shapefileGeoJson) {
            ctx.restore();
          }

          // Draw shapefile border cleanly on top
          if (shapefileGeoJson) {
            ctx.beginPath();
            const drawPolygonRings = (rings: any[]) => {
              rings.forEach((ring) => {
                if (!Array.isArray(ring) || ring.length === 0) return;
                const p0 = ring[0];
                if (!Array.isArray(p0) || p0.length < 2 || typeof p0[0] !== "number" || typeof p0[1] !== "number" || isNaN(p0[0]) || isNaN(p0[1])) return;
                ctx.moveTo((tx(p0[0]) - mapStartX) * canvasScale, (ty(p0[1]) - mapStartY) * canvasScale);
                for (let i = 1; i < ring.length; i++) {
                  const p = ring[i];
                  if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || isNaN(p[0]) || isNaN(p[1])) continue;
                  ctx.lineTo((tx(p[0]) - mapStartX) * canvasScale, (ty(p[1]) - mapStartY) * canvasScale);
                }
              });
            };

            const traverseFeaturesForCanvas = (node: any) => {
              if (!node) return;
              if (Array.isArray(node)) {
                node.forEach(traverseFeaturesForCanvas);
                return;
              }
              if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
                node.features.forEach(traverseFeaturesForCanvas);
              } else if (node.type === "Feature") {
                traverseFeaturesForCanvas(node.geometry);
              } else if (node.type === "Polygon") {
                drawPolygonRings(node.coordinates);
              } else if (node.type === "MultiPolygon") {
                node.coordinates.forEach((poly: any) => {
                  drawPolygonRings(poly);
                });
              }
            };

            traverseFeaturesForCanvas(shapefileGeoJson);
            ctx.strokeStyle = "#475569"; // elegant slate border
            ctx.lineWidth = 1.2 * canvasScale;
            ctx.stroke();
          }

          mapImageBase64 = canvas.toDataURL("image/png");
        }
      } catch (canvasErr) {
        console.error("Canvas raster map compilation failed inside getAutoSvgMap:", canvasErr);
      }

      if (mapImageBase64) {
        interpolationGridSvg = `<image x="${mapStartX}" y="${mapStartY}" width="${mapEndX - mapStartX}" height="${mapEndY - mapStartY}" href="${mapImageBase64}" />`;
      }

      if (false) {
        const startX = mapStartX;
        const endX = mapEndX;
        const startY = mapStartY;
        const endY = mapEndY;
        const gridW = endX - startX;
        const gridH = endY - startY;

        // Downsample specifically for math computation to keep performance blazing fast (max 300 points)
        let mathPts = mappedPts;
        if (mappedPts.length > 300) {
          const step = Math.ceil(mappedPts.length / 300);
          mathPts = [];
          for (let i = 0; i < mappedPts.length; i += step) {
            mathPts.push(mappedPts[i]);
          }
        }

        const cols = 160;
        const rows = 125;
        const cellW = gridW / cols;
        const cellH = gridH / rows;

        // Continuous color mapper for smooth, professional Natural Neighbour feeling gradient
        const getContinuousColor = (val: number, limit1: number, limit2: number): string => {
          const cHealthy: [number, number, number] = [0, 68, 204];    // beautiful blue (#0044cc)
          const cWarning: [number, number, number] = [255, 255, 0];   // warning yellow (#ffff00)
          const cDanger: [number, number, number] = [255, 0, 0];      // danger red (#ff0000)
          const cExtreme: [number, number, number] = [255, 0, 0];     // pure red (#ff0000)

          if (val <= limit1) {
            const factor = limit1 > 0 ? Math.max(0, Math.min(1, val / limit1)) : 0;
            const r = Math.round(cHealthy[0] + factor * (cWarning[0] - cHealthy[0]));
            const g = Math.round(cHealthy[1] + factor * (cWarning[1] - cHealthy[1]));
            const b = Math.round(cHealthy[2] + factor * (cWarning[2] - cHealthy[2]));
            return `rgb(${r},${g},${b})`;
          } else if (val <= limit2) {
            const denom = limit2 - limit1 || 1.0;
            const factor = Math.max(0, Math.min(1, (val - limit1) / denom));
            const r = Math.round(cWarning[0] + factor * (cDanger[0] - cWarning[0]));
            const g = Math.round(cWarning[1] + factor * (cDanger[1] - cWarning[1]));
            const b = Math.round(cWarning[2] + factor * (cDanger[2] - cWarning[2]));
            return `rgb(${r},${g},${b})`;
          } else {
            const maxScale = 2.5 * limit2;
            const denom = maxScale - limit2 || 1.0;
            const factor = Math.max(0, Math.min(1, (val - limit2) / denom));
            const r = Math.round(cDanger[0] + factor * (cExtreme[0] - cDanger[0]));
            const g = Math.round(cDanger[1] + factor * (cExtreme[1] - cDanger[1]));
            const b = Math.round(cDanger[2] + factor * (cExtreme[2] - cDanger[2]));
            return `rgb(${r},${g},${b})`;
          }
        };

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const px = startX + c * cellW;
            const py = startY + r * cellH;

            const cx = px + cellW / 2;
            const cy = py + cellH / 2;

            // Back map coordinates solved at cell center to resolve half-cell coordinate offsets
            const lng = minLng + ((cx - mapStartX) / (mapEndX - mapStartX)) * (maxLng - minLng);
            const lat = minLat + ((mapEndY - cy) / (mapEndY - mapStartY)) * (maxLat - minLat);

            let cellValue = 0;

            if (bulletinInterpolationMethod === "nearest") {
              // Nearest Neighbour Method
              let minDistSq = Infinity;
              for (let i = 0; i < mathPts.length; i++) {
                const pt = mathPts[i];
                const dLat = lat - pt.lat;
                const dLng = lng - pt.lng;
                const distSq = dLat * dLat + dLng * dLng;
                if (distSq < minDistSq) {
                  minDistSq = distSq;
                  cellValue = pt.value;
                }
              }
            } else if (bulletinInterpolationMethod === "natural") {
              // Natural Neighbour Approximation
              let m1 = Infinity, m2 = Infinity, m3 = Infinity;
              let v1 = 0, v2 = 0, v3 = 0;
              for (let i = 0; i < mathPts.length; i++) {
                const p = mathPts[i];
                const dLat = lat - p.lat;
                const dLng = lng - p.lng;
                const dSq = dLat * dLat + dLng * dLng;
                if (dSq < m1) {
                  m3 = m2; v3 = v2;
                  m2 = m1; v2 = v1;
                  m1 = dSq; v1 = p.value;
                } else if (dSq < m2) {
                  m3 = m2; v3 = v2;
                  m2 = dSq; v2 = p.value;
                } else if (dSq < m3) {
                  m3 = dSq; v3 = p.value;
                }
              }
              let exactVal = null;
              let numer = 0;
              let denom = 0;
              if (m1 < 1e-12) {
                exactVal = v1;
              } else {
                const w1 = 1 / m1;
                numer += w1 * v1;
                denom += w1;
                if (m2 < Infinity) {
                  const w2 = 1 / m2;
                  numer += w2 * v2;
                  denom += w2;
                }
                if (m3 < Infinity) {
                  const w3 = 1 / m3;
                  numer += w3 * v3;
                  denom += w3;
                }
              }
              cellValue = exactVal !== null ? exactVal : (denom > 0 ? numer / denom : 0);
            } else if (bulletinInterpolationMethod === "kriging") {
              // Ordinary Kriging Method
              cellValue = 0;
            } else {
              // Default IDW Distance Weighting
              let numerator = 0;
              let denominator = 0;
              let exactMatchVal: number | null = null;

              for (let i = 0; i < mathPts.length; i++) {
                const pt = mathPts[i];
                const dLat = lat - pt.lat;
                const dLng = lng - pt.lng;
                const dSq = dLat * dLat + dLng * dLng;

                if (dSq < 1e-12) {
                  exactMatchVal = pt.value;
                  break;
                }
                const dist = Math.sqrt(dSq);
                // Exponential distance tuning
                const w = 1 / Math.pow(dist, 2.5);
                numerator += pt.value * w;
                denominator += w;
              }
              cellValue = exactMatchVal !== null ? exactMatchVal : (denominator > 0 ? numerator / denominator : 0);
            }

            const fillColor = getContinuousColor(cellValue, b1, b2);

            interpolationGridSvg += `<rect x="${px}" y="${py}" width="${cellW + 0.6}" height="${cellH + 0.6}" fill="${fillColor}" shape-rendering="crispEdges" />`;
          }
        }
      }

      // 3. Grid axes lines, ticks, and coordinates labels wrapping outer box
      let gridLinesSvg = "";
      const nGrid = 4;
      for (let i = 0; i <= nGrid; i++) {
        const latVal = minLat + (i / nGrid) * (maxLat - minLat);
        const lngVal = minLng + (i / nGrid) * (maxLng - minLng);
        const fy = ty(latVal);
        const fx = tx(lngVal);

        // Lat coordinate ticks on left and right borders (no intersecting line across map)
        gridLinesSvg += `<line x1="${mapStartX - 5}" y1="${fy}" x2="${mapStartX}" y2="${fy}" stroke="#1e293b" stroke-width="1.2" />`;
        gridLinesSvg += `<line x1="${mapEndX}" y1="${fy}" x2="${mapEndX + 5}" y2="${fy}" stroke="#1e293b" stroke-width="1.2" />`;
        gridLinesSvg += `<text x="${mapStartX - 8}" y="${fy + 3}" font-family="'JetBrains Mono', monospace, Arial" font-size="8.5" font-weight="bold" fill="#0f172a" text-anchor="end">${latVal.toFixed(2)}°N</text>`;

        // Lng coordinate ticks on top and bottom borders (no intersecting line across map)
        gridLinesSvg += `<line x1="${fx}" y1="${mapEndY}" x2="${fx}" y2="${mapEndY + 5}" stroke="#1e293b" stroke-width="1.2" />`;
        gridLinesSvg += `<line x1="${fx}" y1="${mapStartY - 5}" x2="${fx}" y2="${mapStartY}" stroke="#1e293b" stroke-width="1.2" />`;
        gridLinesSvg += `<text x="${fx}" y="${mapEndY + 13}" font-family="'JetBrains Mono', monospace, Arial" font-size="8.5" font-weight="bold" fill="#0f172a" text-anchor="middle">${lngVal.toFixed(2)}°E</text>`;
      }

      // 4. Trace dots on the map (pre-rendered onto the canvas image)
      let circlesSvg = "";

      // 5. Minimalist North Arrow Component inside the map area (top right)
      const compassSvg = `
        <g transform="translate(515, 155)">
          <!-- Clean minimalist north arrow triangle -->
          <path d="M0 -18 L6 6 L0 2 L-6 6 Z" fill="#1e293b" />
          <path d="M0 -18 L-6 6 L0 2 Z" fill="#94a3b8" />
          <text x="0" y="-23" font-family="'Inter', Arial, sans-serif" font-size="12" font-weight="900" fill="#0f172a" text-anchor="middle">N</text>
        </g>
      `;

      // Removed scale bar as requested for minimalist A4 layout
      const scaleBarSvg = "";

      // Metadata Info Sheet box (Removed as requested)
      const metadataPanelSvg = "";

      // 6. Professional Legend folder box matching the design layout
      let legendContentSvg = "";
      if (isInterpolationMap) {
        const legTitle = customLegendTitleText ? customLegendTitleText : `${config.name} Interpolation (${unit || 'unitless'})`;
        legendContentSvg = `
          <rect width="245" height="110" rx="4" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" />
          <text x="14" y="20" font-family="${customLegendTitleFont}" font-size="${customLegendTitleSize}" font-weight="800" fill="${customLegendTitleColor}" letter-spacing="0.1">${legTitle}</text>
          <line x1="14" y1="28" x2="231" y2="28" stroke="#e2e8f0" stroke-width="1" />
        `;

        bins.forEach((bin, idx) => {
          const iy = 46 + idx * 22;
          legendContentSvg += `
            <rect x="14" y="${iy - 5}" width="14" height="10" rx="1.5" fill="${bin.color}" stroke="#1e293b" stroke-width="0.5" />
            <text x="36" y="${iy + 3}" font-family="'Inter', Arial, sans-serif" font-size="8.5" font-weight="bold" fill="#334155">${bin.label}</text>
            <text x="150" y="${iy + 3}" font-family="'JetBrains Mono', monospace, Arial" font-size="8" font-weight="800" fill="#64748b">(${bin.percent}% Area)</text>
          `;
        });
      } else {
        const limitVal = config.b2 || config.b1 || 0;
        const limitStr = paramKey === "pH" ? "6.5 - 8.5" : `${limitVal} ${unit}`;
        const countAbove = mappedPts.filter(pt => {
          return paramKey === "pH" ? (pt.value < 6.5 || pt.value > 8.5) : (pt.value > limitVal);
        }).length;
        const countWithin = mappedPts.length - countAbove;

        const legComplianceTitle = customLegendTitleText ? customLegendTitleText : `${config.name} Compliance`;
        legendContentSvg = `
          <rect width="245" height="88" rx="4" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" />
          <text x="14" y="20" font-family="${customLegendTitleFont}" font-size="${customLegendTitleSize}" font-weight="800" fill="${customLegendTitleColor}" letter-spacing="0.1">${legComplianceTitle}</text>
          <line x1="14" y1="28" x2="231" y2="28" stroke="#e2e8f0" stroke-width="1" />
          
          <circle cx="21" cy="48" r="4.5" fill="#dc2626" stroke="#ffffff" stroke-width="0.5" />
          <text x="36" y="51" font-family="'Inter', Arial, sans-serif" font-size="8.5" font-weight="bold" fill="#dc2626">Above Permissible Limit</text>
          <text x="165" y="51" font-family="'JetBrains Mono', monospace" font-size="8" font-weight="800" fill="#dc2626">(${countAbove} wells)</text>
          
          <line x1="14" y1="66" x2="231" y2="66" stroke="#e2e8f0" stroke-width="1" />
          <text x="14" y="78" font-family="'Inter', sans-serif" font-size="7.5" font-weight="bold" fill="#64748b">TOTAL AUDITED: ${mappedPts.length} ACTIVE WELLS</text>
        `;
      }

      // 7. Assemble the master sheet SVG string container
      const clipPathId = shapefileGeoJson ? `shapefileClip_${paramKey}` : `mapBoundsClip_${paramKey}`;
      const titleText = customMapTitleText ? customMapTitleText : `${config.name} Map`;
      const subtitleText = bulletinSeason;

      const svg = `
        <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" fill="none" xmlns="http://www.w3.org/2000/svg" style="font-family: 'Inter', Arial, sans-serif; margin: 20px auto; display: block; background-color: transparent; border: none; box-shadow: none;">
          <defs>
            <clipPath id="mapBoundsClip_${paramKey}">
              <rect x="${mapStartX}" y="${mapStartY}" width="${mapEndX - mapStartX}" height="${mapEndY - mapStartY}" />
            </clipPath>
            
            ${shapefileGeoJson && shapefileClips ? `
            <clipPath id="shapefileClip_${paramKey}">
              ${shapefileClips}
            </clipPath>
            ` : ""}

            <filter id="smoothMapFilter_${paramKey}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
              <feGaussianBlur stdDeviation="1.8" />
            </filter>
          </defs>

          <!-- White Base Canvas Plate -->
          <rect width="${svgW}" height="${svgH}" fill="none" />

          <!-- Transparent Header: Map Title & Subtitle centered with elegant typography -->
          <text x="${svgW / 2}" y="45" font-family="${customMapTitleFont}" font-size="${customMapTitleSize}" font-weight="800" fill="${customMapTitleColor}" text-anchor="middle" letter-spacing="0.5">${titleText}</text>
          <text x="${svgW / 2}" y="68" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="#475569" text-anchor="middle" letter-spacing="0.25">${subtitleText.toUpperCase()}</text>

          <!-- Spatial interpolation grid showing stepped color contour divisions clipped inside boundaries -->
          <g clip-path="url(#${clipPathId})">
            <g filter="url(#smoothMapFilter_${paramKey})">
              ${interpolationGridSvg}
            </g>
          </g>

          <!-- Vector administrative boundaries loaded from shapefile -->
          ${shapefileGeoJson && shapefilePaths ? `
          <g clip-path="url(#mapBoundsClip_${paramKey})">
            ${shapefilePaths}
          </g>
          ` : ""}

          <!-- Outer border frame for the map coordinate system -->
          <rect x="${mapStartX}" y="${mapStartY}" width="${mapEndX - mapStartX}" height="${mapEndY - mapStartY}" fill="none" stroke="#1e293b" stroke-width="1.2" />

          <!-- Coordinate ticks and labels -->
          ${gridLinesSvg}

          <!-- Fine well reference markers -->
          ${circlesSvg}

          <!-- Simple North Arrow Component -->
          ${compassSvg}

          <!-- Simple Floating Legend component positioned at the lower right -->
          <g transform="translate(300, 675)">
            ${legendContentSvg}
          </g>
        </svg>
      `;

      return svg;
    } catch (err) {
      console.error("Failed to generate auto SVG map for key:", paramKey, err);
      return "";
    }
  };

  const mapCacheRef = useRef<Record<string, string>>({});
  const lastScopeDataRef = useRef<any[] | null>(null);
  const lastGeometryRef = useRef<any | null>(null);

  if (lastScopeDataRef.current !== scopeData || lastGeometryRef.current !== cachedMapGeometry) {
    mapCacheRef.current = {};
    lastScopeDataRef.current = scopeData;
    lastGeometryRef.current = cachedMapGeometry;
  }

  const computedAutoSvgMaps = useMemo(() => {
    return {};
  }, []);

  const generateGibbsDiagramHTML = (type: "cation" | "anion", title: string, samples: any[], groupColorMap: Record<string, string>): string => {
    // Gibbs diagram dimensions
    const width = 280;
    const height = 360;
    const padding = { left: 45, right: 15, top: 25, bottom: 40 };

    const getX = (ratio: number) => {
      const w = width - padding.left - padding.right;
      return padding.left + ratio * w;
    };
    const getY = (tds: number) => {
      const h = height - padding.top - padding.bottom;
      const logMin = 1; // Log10 of 10
      const logMax = 4.5; // Log10 of ~31620
      const logVal = Math.log10(Math.max(10, tds || 10));
      return padding.top + h - ((logVal - logMin) / (logMax - logMin)) * h;
    };

    // Parallelogram shape as in GibbsDiagrams.tsx:
    const envelopePath = `M ${getX(0.1)} ${getY(5000)} L ${getX(0.9)} ${getY(10000)} L ${getX(0.9)} ${getY(1000)} L ${getX(0.1)} ${getY(10)} L ${getX(0.1)} ${getY(5000)} Z`;

    const gridY = [10, 100, 1000, 10000];
    const gridX = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

    let gridLinesSvg = "";
    gridY.forEach(yVal => {
      const y = getY(yVal);
      gridLinesSvg += `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#cbd5e1" stroke-width="0.5" stroke-dasharray="2,2" />
        <text x="${padding.left - 6}" y="${y + 3}" font-size="7.5" fill="#475569" text-anchor="end" font-weight="bold">${yVal}</text>
      `;
    });

    gridX.forEach(xVal => {
      const x = getX(xVal);
      gridLinesSvg += `
        <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="#cbd5e1" stroke-width="0.5" stroke-dasharray="2,2" />
        <text x="${x}" y="${height - padding.bottom + 12}" font-size="7.5" fill="#475569" text-anchor="middle" font-weight="bold">${xVal.toFixed(1)}</text>
      `;
    });

    const labelRain = `<text x="${getX(0.15)}" y="${getY(20)}" font-size="8.5" font-weight="bold" fill="#64748b" text-anchor="start" opacity="0.8">Precipitation</text>`;
    const labelWeathering = `<text x="${getX(0.5)}" y="${getY(500)}" font-size="8.5" font-weight="bold" fill="#64748b" text-anchor="middle" opacity="0.8">Rock</text>`;
    const labelEvaporation = `<text x="${getX(0.85)}" y="${getY(8000)}" font-size="8.5" font-weight="bold" fill="#64748b" text-anchor="end" opacity="0.8">Evaporation</text>`;

    let pointsSvg = "";
    samples.forEach(s => {
      const hasGibbs = s.hasGibbs;
      const r = type === "cation" ? (s.gibbsCation ?? s.gibbsCationVal) : (s.gibbsAnion ?? s.gibbsAnionVal);
      const t = s.tdsVal ?? s.tds;
      if (!hasGibbs || r === null || t === null || isNaN(r) || isNaN(t) || t <= 0) return;

      const cx = getX(r);
      const cy = getY(t);
      const color = groupColorMap[s.groupVal || "Other"] || "#94a3b8";

      pointsSvg += `
        <circle cx="${cx}" cy="${cy}" r="2.8" fill="${color}" fill-opacity="0.9" stroke="#ffffff" stroke-width="0.3" />
      `;
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background-color: #ffffff; font-family: 'Inter', sans-serif;" xmlns="http://www.w3.org/2000/svg">
        <text x="${width / 2}" y="15" font-size="9" font-weight="900" fill="#64748b" text-anchor="middle" style="letter-spacing: 0.1em;">${title.toUpperCase()}</text>
        
        <!-- Y-Axis Label -->
        <text x="12" y="${height / 2}" font-size="8" font-weight="900" fill="#64748b" transform="rotate(-90 12 ${height / 2})" text-anchor="middle" style="letter-spacing: 0.1em;">TDS (MG/L)</text>
        
        <!-- X-Axis Label -->
        <text x="${width / 2}" y="${height - 12}" font-size="8" font-weight="900" fill="#64748b" text-anchor="middle" style="letter-spacing: 0.1em;">${type === "cation" ? "NA+ / (NA+ + CA2+)" : "CL- / (CL- + HCO3-)"}</text>
        
        <!-- Envelope -->
        <path d="${envelopePath}" fill="#000000" fill-opacity="0.02" stroke="#000000" stroke-opacity="0.08" stroke-dasharray="4" stroke-width="1.5" />
        
        <!-- Grid and Labels -->
        ${gridLinesSvg}
        ${labelRain}
        ${labelWeathering}
        ${labelEvaporation}
        
        <!-- Axis Borders -->
        <rect x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${height - padding.top - padding.bottom}" fill="none" stroke="#94a3b8" stroke-width="1.5" />
        
        <!-- Plotted Points -->
        ${pointsSvg}
      </svg>
    `;
    return svg;
  };

  const generateUsslDiagramHTML = (samples: any[], groupColorMap: Record<string, string>): string => {
    const width = 450;
    const height = 360;
    const padding = { left: 45, right: 15, top: 25, bottom: 40 };

    const getX = (ec: number) => {
      const w = width - padding.left - padding.right;
      const logMin = Math.log10(100);
      const logMax = Math.log10(10000);
      const logVal = Math.log10(Math.max(100, Math.min(10000, ec || 100)));
      return padding.left + ((logVal - logMin) / (logMax - logMin)) * w;
    };

    const getY = (sar: number) => {
      const h = height - padding.top - padding.bottom;
      const maxSar = 32;
      const val = Math.min(maxSar, Math.max(0, sar || 0));
      return padding.top + h - (val / maxSar) * h;
    };

    const s1s2 = (ec: number) => 18.8515824 - 4.4257912 * Math.log10(ec);
    const s2s3 = (ec: number) => 31.4031902 - 6.6827811 * Math.log10(ec);
    const s3s4 = (ec: number) => 43.675205 - 8.8394965 * Math.log10(ec);

    let gridLinesSvg = "";

    // Vertical borders at EC 250, 750, 2250
    const ecBorders = [250, 750, 2250];
    ecBorders.forEach((border) => {
      const x = getX(border);
      gridLinesSvg += `
        <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4" />
      `;
    });

    // Curves
    const ecs = Array.from({ length: 100 }, (_, i) => 100 + i * 100);
    const curve1Path = ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s1s2(ec))}`).join(" ");
    const curve2Path = ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s2s3(ec))}`).join(" ");
    const curve3Path = ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s3s4(ec))}`).join(" ");

    const curvesSvg = `
      <path d="${curve1Path}" fill="none" stroke="#cbd5e1" stroke-width="1.5" />
      <path d="${curve2Path}" fill="none" stroke="#cbd5e1" stroke-width="1.5" />
      <path d="${curve3Path}" fill="none" stroke="#cbd5e1" stroke-width="1.5" />
    `;

    // Category labels inside zones
    const xCentroids = [
      { id: "C1", val: Math.pow(10, (Math.log10(100) + Math.log10(250)) / 2) },
      { id: "C2", val: Math.pow(10, (Math.log10(250) + Math.log10(750)) / 2) },
      { id: "C3", val: Math.pow(10, (Math.log10(750) + Math.log10(2250)) / 2) },
      { id: "C4", val: Math.pow(10, (Math.log10(2250) + Math.log10(10000)) / 2) },
    ];

    let labelsSvg = "";
    xCentroids.forEach((xC) => {
      labelsSvg += `
        <g opacity="0.6">
          <text x="${getX(xC.val)}" y="${getY(s1s2(xC.val) / 2)}" text-anchor="middle" font-size="8" fill="#64748b" font-weight="bold">${xC.id}-S1</text>
          <text x="${getX(xC.val)}" y="${getY((s1s2(xC.val) + s2s3(xC.val)) / 2)}" text-anchor="middle" font-size="8" fill="#64748b" font-weight="bold">${xC.id}-S2</text>
          <text x="${getX(xC.val)}" y="${getY((s2s3(xC.val) + s3s4(xC.val)) / 2)}" text-anchor="middle" font-size="8" fill="#64748b" font-weight="bold">${xC.id}-S3</text>
          <text x="${getX(xC.val)}" y="${getY((s3s4(xC.val) + 32) / 2)}" text-anchor="middle" font-size="8" fill="#64748b" font-weight="bold">${xC.id}-S4</text>
        </g>
      `;
    });

    // Grid ticks and values
    const ticksX = [100, 250, 750, 2250, 5000, 10000];
    ticksX.forEach(tick => {
      const x = getX(tick);
      gridLinesSvg += `
        <line x1="${x}" y1="${height - padding.bottom}" x2="${x}" y2="${height - padding.bottom + 5}" stroke="#94a3b8" stroke-width="1.5" />
        <text x="${x}" y="${height - padding.bottom + 15}" font-size="8" fill="#64748b" font-weight="bold" text-anchor="middle">${tick}</text>
      `;
    });

    const ticksY = [0, 10, 20, 30];
    ticksY.forEach(tick => {
      const y = getY(tick);
      gridLinesSvg += `
        <line x1="${padding.left - 5}" y1="${y}" x2="${padding.left}" y2="${y}" stroke="#94a3b8" stroke-width="1.5" />
        <text x="${padding.left - 10}" y="${y + 3}" font-size="8" fill="#64748b" font-weight="bold" text-anchor="end">${tick}</text>
      `;
    });

    // Plotted points
    let pointsSvg = "";
    samples.forEach(s => {
      const ec = s.ecVal ?? s.ec;
      const sar = s.sar;
      if (ec === null || sar === null || isNaN(ec) || isNaN(sar)) return;

      const cx = getX(ec);
      const cy = getY(sar);
      const color = groupColorMap[s.groupVal || "Other"] || "#94a3b8";

      pointsSvg += `
        <circle cx="${cx}" cy="${cy}" r="2.8" fill="${color}" fill-opacity="0.9" stroke="#ffffff" stroke-width="0.3" />
      `;
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background-color: #ffffff; font-family: 'Inter', sans-serif;" xmlns="http://www.w3.org/2000/svg">
        <text x="${width / 2}" y="15" font-size="9.5" font-weight="900" fill="#64748b" text-anchor="middle" style="letter-spacing: 0.1em;">USSL CLASSIFICATION MATRIX</text>
        
        <!-- Y-Axis Label -->
        <text x="12" y="${height / 2}" font-size="8" font-weight="900" fill="#64748b" transform="rotate(-90 12 ${height / 2})" text-anchor="middle" style="letter-spacing: 0.1em;">SAR (SODIUM ADSORPTION RATIO)</text>
        
        <!-- X-Axis Label -->
        <text x="${width / 2}" y="${height - 12}" font-size="8" font-weight="900" fill="#64748b" text-anchor="middle" style="letter-spacing: 0.1em;">EC (EC, &mu;S/CM)</text>
        
        <!-- Grid and curves -->
        ${gridLinesSvg}
        ${curvesSvg}
        ${labelsSvg}
        
        <!-- Axis Box -->
        <rect x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${height - padding.top - padding.bottom}" fill="none" stroke="#94a3b8" stroke-width="1.5" />
        
        <!-- Plotted points -->
        ${pointsSvg}
      </svg>
    `;
    return svg;
  };

  const getUsslCategory = (ec: number, sar: number): string => {
    if (ec === null || sar === null || isNaN(ec) || isNaN(sar)) return "Unknown";
    
    // Salinity Hazard Class (C1 to C4)
    let cClass = "";
    if (ec < 250) cClass = "C1";
    else if (ec < 750) cClass = "C2";
    else if (ec < 2250) cClass = "C3";
    else cClass = "C4";

    // Sodium Hazard Class (S1 to S4)
    const s1s2 = (e: number) => 18.8515824 - 4.4257912 * Math.log10(e);
    const s2s3 = (e: number) => 31.4031902 - 6.6827811 * Math.log10(e);
    const s3s4 = (e: number) => 43.675205 - 8.8394965 * Math.log10(e);

    let sClass = "S1";
    const limit1 = s1s2(ec);
    const limit2 = s2s3(ec);
    const limit3 = s3s4(ec);

    if (sar < limit1) sClass = "S1";
    else if (sar < limit2) sClass = "S2";
    else if (sar < limit3) sClass = "S3";
    else sClass = "S4";

    return `${cClass}-${sClass}`;
  };

  const generateUsslDistributionDiagramHTML = (samples: any[]): string => {
    const counts: Record<string, number> = {};
    let totalCount = 0;

    samples.forEach(s => {
      const ec = s.ecVal ?? s.ec;
      const sar = s.sar;
      if (ec === null || sar === null || isNaN(ec) || isNaN(sar)) return;

      const cat = getUsslCategory(ec, sar);
      if (cat !== "Unknown") {
        counts[cat] = (counts[cat] || 0) + 1;
        totalCount++;
      }
    });

    const activeCategories = Object.entries(counts)
      .map(([cat, count]) => ({
        cat,
        count,
        pct: totalCount > 0 ? (count / totalCount) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count);

    if (activeCategories.length === 0) {
      return `
        <div style="background-color: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 25px; text-align: center; margin: 20px 0;">
          <p style="font-weight: bold; font-size: 11pt; color: #475569; margin: 0;">No samples with valid EC and SAR data to classify.</p>
        </div>
      `;
    }

    const padding = { left: 70, right: 130, top: 25, bottom: 35 };
    const rowHeight = 32;
    const chartHeight = padding.top + padding.bottom + activeCategories.length * rowHeight;
    const width = 500;
    const chartWidth = width - padding.left - padding.right;

    let barsSvg = "";
    let gridLinesSvg = "";

    // Draw vertical grid lines at 25%, 50%, 75%, 100%
    const gridPct = [25, 50, 75, 100];
    gridPct.forEach(pct => {
      const x = padding.left + (pct / 100) * chartWidth;
      gridLinesSvg += `
        <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${chartHeight - padding.bottom}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3 3" />
        <text x="${x}" y="${chartHeight - padding.bottom + 14}" font-size="8" fill="#64748b" font-weight="bold" text-anchor="middle">${pct}%</text>
      `;
    });

    // Base vertical axis line
    gridLinesSvg += `
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${chartHeight - padding.bottom}" stroke="#94a3b8" stroke-width="1.5" />
    `;

    // Draw bars
    activeCategories.forEach((item, idx) => {
      const y = padding.top + idx * rowHeight + (rowHeight - 16) / 2;
      const barWidth = Math.max(2, (item.pct / 100) * chartWidth);
      
      const color = "#1e3a8a"; // Deep corporate blue

      barsSvg += `
        <g>
          <!-- Category Label on the left -->
          <text x="${padding.left - 10}" y="${y + 12}" font-size="9" font-weight="900" fill="#1e293b" text-anchor="end" font-family="'Inter', sans-serif">${item.cat}</text>
          
          <!-- Background track -->
          <rect x="${padding.left}" y="${y}" width="${chartWidth}" height="16" fill="#f1f5f9" rx="3" />
          
          <!-- Filled bar -->
          <rect x="${padding.left}" y="${y}" width="${barWidth}" height="16" fill="${color}" rx="3" />
          
          <!-- Text label on the right -->
          <text x="${padding.left + barWidth + 8}" y="${y + 12}" font-size="9" font-weight="bold" fill="#334155" font-family="'Inter', sans-serif">
            ${item.count} ${item.count === 1 ? "sample" : "samples"} (${item.pct.toFixed(1)}%)
          </text>
        </g>
      `;
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${chartHeight}" width="100%" height="${chartHeight}" style="background-color: #ffffff; font-family: 'Inter', sans-serif;" xmlns="http://www.w3.org/2000/svg">
        <!-- Title -->
        <text x="${width / 2}" y="15" font-size="10.5" font-weight="900" fill="#1e3a8a" text-anchor="middle" style="letter-spacing: 0.05em;">DISTRIBUTION OF GROUNDWATER SAMPLES IN USSL CATEGORIES</text>
        
        <!-- Grid Lines -->
        ${gridLinesSvg}
        
        <!-- Bars -->
        ${barsSvg}
      </svg>
    `;

    return svg;
  };

  const getStdDev = (values: number[], mean: number) => {
    if (values.length <= 1) return 0;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
  };

  const generateBulletinDetailedTableHTML = (paramKey: string, dataset: any[], breakdownLevel: "State" | "District", tableNum: number) => {
    const config = PARAM_CONFIG[paramKey];
    const mappedHeader = Object.keys(headerMap).find((k) => headerMap[k] === paramKey);
    if (!mappedHeader || !config) {
      return "";
    }

    const b1 = config.b1;
    const b2 = config.b2;
    const groupKey = breakdownLevel === "State" ? headers.state : headers.district;

    if (!groupKey) {
      return "";
    }

    // Collect values per location
    const locValues: Record<string, number[]> = {};
    dataset.forEach((d) => {
      const locName = String(d[groupKey] || "Unknown").trim();
      if (locName === "Unknown" || !locName) return;

      const val = parseFloat(d[mappedHeader]);
      if (!isNaN(val)) {
        if (!locValues[locName]) {
          locValues[locName] = [];
        }
        locValues[locName].push(val);
      }
    });

    const sortedGroups = Object.keys(locValues).sort();
    const tblLevelName = breakdownLevel === "State" ? "State / UT" : "District";

    // Table Header depending on parameter
    const rangesHeader = paramKey === "pH" 
      ? `
        <th style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">< 6.5<br>(Acidic)</th>
        <th style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">6.5 - 8.5<br>(Acceptable)</th>
        <th style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">> 8.5<br>(Alkaline)</th>
      `
      : `
        <th style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">Acceptable<br>(≤ ${b1})</th>
        <th style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">Permissible<br>(${b1} - ${b2})</th>
        <th style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">Exceeded<br>(> ${b2})</th>
      `;

    const limitUnit = config.unit ? ` (${config.unit})` : "";
    const nameWithUnit = `${config.name}${limitUnit}`;
    const tableCaption = `<p style="text-align: center; font-weight: bold; font-size: 11pt; margin-bottom: 5px; color: #1e3a8a;">Table ${tableNum}: Detailed ${breakdownLevel}-wise Statistical Distribution of ${nameWithUnit}</p>`;

    let tableHTML = `
      <div style="margin-top: 15px; margin-bottom: 25px; page-break-inside: avoid;">
        ${tableCaption}
        <table border="1" cellpadding="4" cellspacing="0" style="width: auto; margin-left: auto; margin-right: auto; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 9.5pt; text-align: center; margin-bottom: 20px; white-space: nowrap;">
          <thead style="background-color: #f8fafc;">
            <tr>
              <th rowspan="2" style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">Sl. No.</th>
              <th rowspan="2" style="padding: 6px; border: 1px solid #475569; font-size: 9pt; text-align: left;">${tblLevelName}</th>
              <th rowspan="2" style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">Samples Analysed</th>
              <th colspan="3" style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">${config.name} (${paramKey}) ${config.unit ? `(${config.unit})` : ""} - No. of Samples in Ranges</th>
              <th rowspan="2" style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">Min</th>
              <th rowspan="2" style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">Max</th>
              <th rowspan="2" style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">75%ile</th>
              <th rowspan="2" style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">90%ile</th>
              <th rowspan="2" style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">95%ile</th>
              <th rowspan="2" style="padding: 6px; border: 1px solid #475569; font-size: 9pt;">Std Dev</th>
            </tr>
            <tr>
              ${rangesHeader}
            </tr>
          </thead>
          <tbody>
    `;

    let globalAllVals: number[] = [];
    let globalR1 = 0;
    let globalR2 = 0;
    let globalR3 = 0;
    let idx = 1;

    sortedGroups.forEach((locName) => {
      const vals = locValues[locName];
      if (!vals || vals.length === 0) return;

      globalAllVals.push(...vals);

      // Categorize values
      let r1 = 0; // Acidic or Acceptable
      let r2 = 0; // Acceptable or Permissible
      let r3 = 0; // Alkaline or Exceeded

      vals.forEach((v) => {
        if (paramKey === "pH") {
          if (v < 6.5) r1++;
          else if (v <= 8.5) r2++;
          else r3++;
        } else {
          if (v <= b1) r1++;
          else if (v <= b2) r2++;
          else r3++;
        }
      });

      globalR1 += r1;
      globalR2 += r2;
      globalR3 += r3;

      const minVal = Math.min(...vals).toFixed(2);
      const maxVal = Math.max(...vals).toFixed(2);
      const p75Val = getPercentile(vals, 75).toFixed(2);
      const p90Val = getPercentile(vals, 90).toFixed(2);
      const p95Val = getPercentile(vals, 95).toFixed(2);
      
      const sum = vals.reduce((s, x) => s + x, 0);
      const mean = sum / vals.length;
      const stdDevVal = getStdDev(vals, mean).toFixed(2);

      tableHTML += `
        <tr>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8;">${idx++}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8; text-align: left; font-weight: bold; font-size: 9pt;">${locName}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8;">${vals.length}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8; background-color: #f0fdf4;">${r1}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8; background-color: #fefce8;">${r2}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8; background-color: #fef2f2; color: ${r3 > 0 ? "#b91c1c" : "#1e293b"}; font-weight: ${r3 > 0 ? "bold" : "normal"};">${r3}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8;">${minVal}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8;">${maxVal}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8;">${p75Val}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8;">${p90Val}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8;">${p95Val}</td>
          <td style="padding: 4px 6px; border: 1px solid #94a3b8; font-style: italic;">${stdDevVal}</td>
        </tr>
      `;
    });

    if (globalAllVals.length > 0) {
      const gMin = Math.min(...globalAllVals).toFixed(2);
      const gMax = Math.max(...globalAllVals).toFixed(2);
      const gP75 = getPercentile(globalAllVals, 75).toFixed(2);
      const gP90 = getPercentile(globalAllVals, 90).toFixed(2);
      const gP95 = getPercentile(globalAllVals, 95).toFixed(2);
      const gSum = globalAllVals.reduce((s, x) => s + x, 0);
      const gMean = gSum / globalAllVals.length;
      const gStd = getStdDev(globalAllVals, gMean).toFixed(2);

      tableHTML += `
        <tr style="font-weight: bold; background-color: #f1f5f9; border-top: 1.5pt solid #475569;">
          <td colspan="2" style="padding: 4px 6px; border: 1px solid #475569; text-align: right;">GRAND TOTAL</td>
          <td style="padding: 4px 6px; border: 1px solid #475569;">${globalAllVals.length}</td>
          <td style="padding: 4px 6px; border: 1px solid #475569; background-color: #f0fdf4;">${globalR1}</td>
          <td style="padding: 4px 6px; border: 1px solid #475569; background-color: #fefce8;">${globalR2}</td>
          <td style="padding: 4px 6px; border: 1px solid #475569; background-color: #fef2f2; color: #b91c1c;">${globalR3}</td>
          <td style="padding: 4px 6px; border: 1px solid #475569;">${gMin}</td>
          <td style="padding: 4px 6px; border: 1px solid #475569;">${gMax}</td>
          <td style="padding: 4px 6px; border: 1px solid #475569;">${gP75}</td>
          <td style="padding: 4px 6px; border: 1px solid #475569;">${gP90}</td>
          <td style="padding: 4px 6px; border: 1px solid #475569;">${gP95}</td>
          <td style="padding: 4px 6px; border: 1px solid #475569; font-style: italic;">${gStd}</td>
        </tr>
      `;
    }

    tableHTML += `
          </tbody>
        </table>
      </div>
    `;

    return tableHTML;
  };

  const generateBulletinTableHTML = (paramKey: string, dataset: any[], breakdownLevel: "State" | "District", tableIndex: number) => {
    const config = PARAM_CONFIG[paramKey];
    const mappedHeader = Object.keys(headerMap).find((k) => headerMap[k] === paramKey);
    if (!mappedHeader || !config) {
      return { html: `<p><em>Data for ${paramKey} is unmapped.</em></p>`, dataMap: {} };
    }

    const limit = config.b1 === config.b2 ? config.b1 : config.b2;
    const limitUnit = config.unit ? ` ${config.unit}` : "";
    const groupKey = breakdownLevel === "State" ? headers.state : headers.district;
    const subGroupKey = breakdownLevel === "State" ? headers.district : headers.block;
    const subGroupName = breakdownLevel === "State" ? "District" : "Block";

    if (!groupKey) {
      return { html: `<p><em>Identifier (${breakdownLevel}) is unmapped. Table skipped.</em></p>`, dataMap: {} };
    }

    const groupedData: Record<string, { total: number; exceed: number; affectedSubGroups: Set<string> }> = {};
    dataset.forEach((d) => {
      const locName = String(d[groupKey] || "Unknown").trim();
      if (locName === "Unknown" || !locName) return;

      if (!groupedData[locName]) {
        groupedData[locName] = { total: 0, exceed: 0, affectedSubGroups: new Set<string>() };
      }

      const val = parseFloat(d[mappedHeader]);
      if (!isNaN(val)) {
        groupedData[locName].total++;
        let isExceed = false;
        if (paramKey === "pH") {
          if (val < config.b1 || val > config.b2) isExceed = true;
        } else if (val > limit) {
          isExceed = true;
        }

        if (isExceed) {
          groupedData[locName].exceed++;
          if (subGroupKey) {
            const subVal = String(d[subGroupKey] || "Unknown").trim();
            if (subVal !== "Unknown" && subVal) {
              groupedData[locName].affectedSubGroups.add(subVal);
            }
          }
        }
      }
    });

    const sortedGroups = Object.keys(groupedData).sort();

    const tblLevelName = breakdownLevel;
      
    let tableHTML = `
      <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 11pt; text-align: center; margin-bottom: 20px;">
        <thead style="background-color: #f1f5f9;">
          <tr>
            <th style="padding: 8px; border: 1px solid #475569;">Sl. No.</th>
            <th style="padding: 8px; border: 1px solid #475569; text-align: left;">${tblLevelName}</th>
            <th style="padding: 8px; border: 1px solid #475569;">No. of Samples Analysed</th>
            <th style="padding: 8px; border: 1px solid #475569;">Exceeding Limit (${paramKey === "pH" ? "6.5-8.5" : `> ${limit}${limitUnit}`})</th>
            <th style="padding: 8px; border: 1px solid #475569;">Exceedance %</th>
            <th style="padding: 8px; border: 1px solid #475569;">No. of Partially Affected ${subGroupName}s</th>
            <th style="padding: 8px; border: 1px solid #475569; text-align: left;">Names of Partially Affected ${subGroupName}s</th>
          </tr>
        </thead>
        <tbody>
    `;

    let globalTotal = 0;
    let globalExceed = 0;
    let globalPartiallyAffectedSum = 0;
    const grandAffectedSubGroups = new Set<string>();
    let idx = 1;

    sortedGroups.forEach((locName) => {
      const stats = groupedData[locName];
      if (!stats || stats.total === 0) return;

      globalTotal += stats.total;
      globalExceed += stats.exceed;
      const pctValue = ((stats.exceed / stats.total) * 100).toFixed(2);
      const subGroupCount = stats.affectedSubGroups.size;
      const subGroupNames = subGroupCount > 0 ? Array.from(stats.affectedSubGroups).sort().join(", ") : "-";
      stats.affectedSubGroups.forEach((val) => grandAffectedSubGroups.add(val));
      globalPartiallyAffectedSum += subGroupCount;

      tableHTML += `
        <tr>
          <td style="padding: 6px; border: 1px solid #94a3b8;">${idx++}</td>
          <td style="padding: 6px; border: 1px solid #94a3b8; text-align: left; font-weight: bold;">${locName}</td>
          <td style="padding: 6px; border: 1px solid #94a3b8;">${stats.total}</td>
          <td style="padding: 6px; border: 1px solid #94a3b8; color: ${stats.exceed > 0 ? "#b91c1c" : "#1e293b"}; font-weight: ${stats.exceed > 0 ? "bold" : "normal"};">${stats.exceed}</td>
          <td style="padding: 6px; border: 1px solid #94a3b8; font-weight: bold;">${pctValue}%</td>
          <td style="padding: 6px; border: 1px solid #94a3b8; font-weight: bold;">${subGroupCount}</td>
          <td style="padding: 6px; border: 1px solid #94a3b8; text-align: left; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${subGroupNames}">${subGroupNames}</td>
        </tr>
      `;
    });

    const globalPct = globalTotal > 0 ? ((globalExceed / globalTotal) * 100).toFixed(2) : "0.00";
    const grandSubGroupCount = grandAffectedSubGroups.size;
    const grandSubGroupNames = grandSubGroupCount > 0 ? Array.from(grandAffectedSubGroups).sort().join(", ") : "-";

    tableHTML += `
        <tr style="font-weight: bold; background-color: #f8fafc; border-top: 1.5pt solid #475569;">
          <td colspan="2" style="padding: 6px; border: 1px solid #475569; text-align: right;">GRAND TOTAL</td>
          <td style="padding: 6px; border: 1px solid #475569;">${globalTotal}</td>
          <td style="padding: 6px; border: 1px solid #475569; color: #b91c1c;">${globalExceed}</td>
          <td style="padding: 6px; border: 1px solid #475569;">${globalPct}%</td>
          <td style="padding: 6px; border: 1px solid #475569;">${grandSubGroupCount}</td>
          <td style="padding: 6px; border: 1px solid #475569; text-align: left;">-</td>
        </tr>
      </tbody>
    </table>
    `;

    return { html: tableHTML, dataMap: groupedData };
  };

  const getCategorizationText = (groupedData: Record<string, { total: number; exceed: number }>, paramName: string, breakdownLevel: "State" | "District") => {
    const buckets: Record<string, string[]> = {
      "0%": [],
      ">0-5%": [],
      ">5-10%": [],
      ">10-15%": [],
      ">15-20%": [],
      ">20-30%": [],
      ">30-50%": [],
      ">50%": [],
    };

    let totalRegions = 0;
    Object.entries(groupedData).forEach(([loc, s]) => {
      if (loc === "Unknown") return;
      if (s.total === 0) return;

      totalRegions++;
      const pct = (s.exceed / s.total) * 100;

      if (pct === 0) buckets["0%"].push(loc);
      else if (pct <= 5) buckets[">0-5%"].push(loc);
      else if (pct <= 10) buckets[">5-10%"].push(loc);
      else if (pct <= 15) buckets[">10-15%"].push(loc);
      else if (pct <= 20) buckets[">15-20%"].push(loc);
      else if (pct <= 30) buckets[">20-30%"].push(loc);
      else if (pct <= 50) buckets[">30-50%"].push(loc);
      else buckets[">50%"].push(loc);
    });

    if (totalRegions === 0) return "";

    const isHindi = false;

    const unitPluralLower = breakdownLevel === "State" ? "States" : "districts";
    const unitSingularLower = breakdownLevel === "State" ? "State" : "district";
    const unitPluralCap = breakdownLevel === "State" ? "States" : "Districts";

    const lines: string[] = [];
    lines.push(
      `An analysis of the ${breakdownLevel.toLowerCase()}-wise data for ${paramName} reveals distinct spatial variations in exceedance levels across the ${totalRegions} monitored ${unitPluralLower}.`
    );

    if (buckets["0%"].length > 0) {
      lines.push(
        `${buckets["0%"].length} ${buckets["0%"].length === 1 ? unitSingularLower : unitPluralLower} reported highly compliant groundwater with exactly 0% exceedance; this includes ${buckets["0%"].join(", ")}.`
      );
    }
    if (buckets[">0-5%"].length > 0) {
      lines.push(
        `Marginal exceedances (>0% to 5%) were observed in ${buckets[">0-5%"].length} ${buckets[">0-5%"].length === 1 ? unitSingularLower : unitPluralLower}: ${buckets[">0-5%"].join(", ")}.`
      );
    }
    if (buckets[">5-10%"].length > 0) {
      lines.push(`Moderate exceedances (>5% to 10%) were observed in ${buckets[">5-10%"].join(", ")}.`);
    }
    if (buckets[">10-15%"].length > 0) {
      lines.push(`${unitPluralCap} falling into the elevated >10-15% bracket include ${buckets[">10-15%"].join(", ")}.`);
    }
    if (buckets[">15-20%"].length > 0) {
      lines.push(
        `Higher exceedance levels ranging from >15% to 20% were documented in ${buckets[">15-20%"].join(", ")}.`
      );
    }
    if (buckets[">20-30%"].length > 0) {
      lines.push(
        `Notable concerns are present in ${unitPluralLower} with >20-30% exceedance, specifically ${buckets[">20-30%"].join(", ")}.`
      );
    }
    if (buckets[">30-50%"].length > 0) {
      lines.push(
        `Severe contamination levels where >30% to 50% of the sample sites exceeded safe limits were found in ${buckets[">30-50%"].join(", ")}.`
      );
    }
    if (buckets[">50%"].length > 0) {
      lines.push(
        `Critically high exceedances (>50%) were recorded in ${buckets[">50%"].join(", ")}, requiring immediate attention, targeted interventions, and long-term geogenic mitigation technologies.`
      );
    }

    return `<p style="text-align: justify; line-height: 1.6; margin-top: 15px; margin-bottom: 25px;">${lines.join(" ")}</p>`;
  };

  const toProperCase = (str: string): string => {
    if (!str) return "";
    if (str.toUpperCase() === "INDIA" || str.toUpperCase() === "NATIONAL") return "India";
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  const getParameterRemedialHTML = (configKey: string, paramName: string, figCounter?: { current: number }, subSecIndex: number = 1): string => {
    const key = configKey.toUpperCase().trim();
    if (key !== "AS" && key !== "ARSENIC" && key !== "F" && key !== "FLUORIDE") {
      return "";
    }
    const isHindi = false;
    
    if (key === "AS" || key === "ARSENIC") {
      const figNum = figCounter ? figCounter.current++ : 1;

      const svgWellDesignEnglish = `
        <svg width="720" height="400" viewBox="0 0 720 400" style="background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; font-family: 'Times New Roman', Times, serif; display: block; margin: 15px auto;">
          <rect x="10" y="50" width="700" height="110" fill="#fee2e2" opacity="0.6"/>
          <rect x="10" y="160" width="700" height="70" fill="#cbd5e1" opacity="0.8"/>
          <rect x="10" y="230" width="700" height="130" fill="#e0f2fe" opacity="0.6"/>

          <text x="25" y="80" fill="#991b1b" font-size="10.5" font-weight="bold">Shallow Aquifer (Arsenic Contaminated, &lt; 80m bgl)</text>
          <text x="25" y="195" fill="#334155" font-size="10.5" font-weight="bold">Clay / Confining Layer (Impermeable Barrier)</text>
          <text x="25" y="270" fill="#0369a1" font-size="10.5" font-weight="bold">Deeper Aquifer (Arsenic Safe, Semi-confined/Confined)</text>

          <line x1="10" y1="50" x2="710" y2="50" stroke="#475569" stroke-width="2"/>
          
          <rect x="180" y="150" width="30" height="90" fill="#15803d" opacity="0.8"/>
          <rect x="190" y="40" width="10" height="280" fill="#475569"/>
          <rect x="190" y="300" width="10" height="40" fill="none" stroke="#475569" stroke-dasharray="3,3" stroke-width="2"/>
          
          <rect x="185" y="25" width="20" height="15" fill="#1e3a8a" rx="2"/>
          <line x1="195" y1="40" x2="195" y2="300" stroke="#94a3b8" stroke-width="2"/>

          <rect x="520" y="40" width="10" height="280" fill="#475569"/>
          <rect x="520" y="300" width="10" height="40" fill="none" stroke="#475569" stroke-dasharray="3,3" stroke-width="2"/>
          
          <path d="M 515 130 L 515 250" stroke="#ef4444" stroke-width="2" marker-end="url(#arrow)" fill="none" stroke-dasharray="4,4"/>
          <path d="M 535 130 L 535 250" stroke="#ef4444" stroke-width="2" marker-end="url(#arrow)" fill="none" stroke-dasharray="4,4"/>

          <rect x="515" y="25" width="20" height="15" fill="#1e3a8a" rx="2"/>
          <line x1="525" y1="40" x2="525" y2="300" stroke="#94a3b8" stroke-width="2"/>

          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444"/>
            </marker>
            <marker id="blue-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb"/>
            </marker>
          </defs>

          <path d="M 160 320 L 185 320" stroke="#2563eb" stroke-width="1.5" marker-end="url(#blue-arrow)" fill="none"/>
          <path d="M 230 320 L 205 320" stroke="#2563eb" stroke-width="1.5" marker-end="url(#blue-arrow)" fill="none"/>

          <path d="M 490 320 L 515 320" stroke="#ef4444" stroke-width="1.5" marker-end="url(#arrow)" fill="none"/>
          
          <text x="195" y="385" fill="#16a34a" font-size="11" font-weight="bold" text-anchor="middle">PROPERLY DESIGNED WELL</text>
          <text x="195" y="18" fill="#15803d" font-size="10" font-weight="bold" text-anchor="middle">✔ CEMENT SEAL PREVENTS SEEPAGE</text>
          
          <text x="525" y="385" fill="#dc2626" font-size="11" font-weight="bold" text-anchor="middle">IMPROPERLY DESIGNED WELL</text>
          <text x="525" y="18" fill="#b91c1c" font-size="10" font-weight="bold" text-anchor="middle">❌ CONTAMINATION MIXING RISK</text>

          <line x1="210" y1="180" x2="280" y2="180" stroke="#15803d" stroke-width="1"/>
          <text x="285" y="184" fill="#15803d" font-size="10" font-weight="bold">Cement Grout Seal</text>
          
          <line x1="530" y1="180" x2="600" y2="180" stroke="#ef4444" stroke-width="1"/>
          <text x="605" y="184" fill="#ef4444" font-size="10" font-weight="bold">No Annular Seal</text>
          <text x="605" y="196" fill="#7f1d1d" font-size="9">(Contamination trickles down)</text>

          <text x="350" y="110" fill="#991b1b" font-size="10" text-anchor="middle">High Arsenic Zone</text>
          <text x="350" y="325" fill="#0369a1" font-size="10" text-anchor="middle">Arsenic Free Zone</text>
        </svg>
      `;

      const svgWellDesignHindi = `
        <svg width="720" height="400" viewBox="0 0 720 400" style="background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; font-family: 'Times New Roman', Times, serif; display: block; margin: 15px auto;">
          <rect x="10" y="50" width="700" height="110" fill="#fee2e2" opacity="0.6"/>
          <rect x="10" y="160" width="700" height="70" fill="#cbd5e1" opacity="0.8"/>
          <rect x="10" y="230" width="700" height="130" fill="#e0f2fe" opacity="0.6"/>

          <text x="25" y="80" fill="#991b1b" font-size="10.5" font-weight="bold">उथला जलभृत (आर्सेनिक संदूषित, &lt; 80 मीटर)</text>
          <text x="25" y="195" fill="#334155" font-size="10.5" font-weight="bold">मिट्टी / संरोधक परत (अभेद्य अवरोध)</text>
          <text x="25" y="270" fill="#0369a1" font-size="10.5" font-weight="bold">गहरा जलभृत (आर्सेनिक सुरक्षित, अर्ध-सीमित/सीमित)</text>

          <line x1="10" y1="50" x2="710" y2="50" stroke="#475569" stroke-width="2"/>
          
          <rect x="180" y="150" width="30" height="90" fill="#15803d" opacity="0.8"/>
          <rect x="190" y="40" width="10" height="280" fill="#475569"/>
          <rect x="190" y="300" width="10" height="40" fill="none" stroke="#475569" stroke-dasharray="3,3" stroke-width="2"/>
          
          <rect x="185" y="25" width="20" height="15" fill="#1e3a8a" rx="2"/>
          <line x1="195" y1="40" x2="195" y2="300" stroke="#94a3b8" stroke-width="2"/>

          <rect x="520" y="40" width="10" height="280" fill="#475569"/>
          <rect x="520" y="300" width="10" height="40" fill="none" stroke="#475569" stroke-dasharray="3,3" stroke-width="2"/>
          
          <path d="M 515 130 L 515 250" stroke="#ef4444" stroke-width="2" marker-end="url(#arrow)" fill="none" stroke-dasharray="4,4"/>
          <path d="M 535 130 L 535 250" stroke="#ef4444" stroke-width="2" marker-end="url(#arrow)" fill="none" stroke-dasharray="4,4"/>

          <rect x="515" y="25" width="20" height="15" fill="#1e3a8a" rx="2"/>
          <line x1="525" y1="40" x2="525" y2="300" stroke="#94a3b8" stroke-width="2"/>

          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444"/>
            </marker>
            <marker id="blue-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb"/>
            </marker>
          </defs>

          <path d="M 160 320 L 185 320" stroke="#2563eb" stroke-width="1.5" marker-end="url(#blue-arrow)" fill="none"/>
          <path d="M 230 320 L 205 320" stroke="#2563eb" stroke-width="1.5" marker-end="url(#blue-arrow)" fill="none"/>

          <path d="M 490 320 L 515 320" stroke="#ef4444" stroke-width="1.5" marker-end="url(#arrow)" fill="none"/>
          
          <text x="195" y="385" fill="#16a34a" font-size="11" font-weight="bold" text-anchor="middle">सुरक्षित रूप से डिजाइन किया गया कुआं</text>
          <text x="195" y="18" fill="#15803d" font-size="10" font-weight="bold" text-anchor="middle">✔ सीमेंट सील रिसाव को रोकती है</text>
          
          <text x="525" y="385" fill="#dc2626" font-size="11" font-weight="bold" text-anchor="middle">असुरक्षित रूप से डिजाइन किया गया कुआं</text>
          <text x="525" y="18" fill="#b91c1c" font-size="10" font-weight="bold" text-anchor="middle">❌ संदूषण मिश्रण का खतरा</text>

          <line x1="210" y1="180" x2="280" y2="180" stroke="#15803d" stroke-width="1"/>
          <text x="285" y="184" fill="#15803d" font-size="10" font-weight="bold">सीमेंट ग्राउट सील</text>
          
          <line x1="530" y1="180" x2="600" y2="180" stroke="#ef4444" stroke-width="1"/>
          <text x="605" y="184" fill="#ef4444" font-size="10" font-weight="bold">कोई वलयाकार सील नहीं</text>
          <text x="605" y="196" fill="#7f1d1d" font-size="9">(संदूषण नीचे बहता है)</text>

          <text x="350" y="110" fill="#991b1b" font-size="10" text-anchor="middle">उच्च आर्सेनिक क्षेत्र</text>
          <text x="350" y="325" fill="#0369a1" font-size="10" text-anchor="middle">आर्सेनिक मुक्त क्षेत्र</text>
        </svg>
      `;

      const arsenicWellImageHTML = svgWellDesignEnglish;

      if (false) {
        return `
          <div style="margin-top: 20px; margin-bottom: 25px; font-family: 'Times New Roman', Times, serif; font-size: 11pt; text-align: justify; line-height: 1.6;">
            <h4 style="font-size: 13pt; font-weight: bold; color: #1e3a8a; text-align: left; margin-bottom: 15px; border-bottom: 1.5px solid #94a3b8; padding-bottom: 4px;">
              7.${subSecIndex} भूजल में आर्सेनिक संदूषण का शमन (Mitigation of Arsenic Contamination)
            </h4>
            
            <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
              देश में भूजल में आर्सेनिक संदूषण आम तौर पर भूगर्भीय (geogenic) प्रकृति का होता है। भूजल में आर्सेनिक प्राकृतिक रूप से चट्टानों और मिट्टी के टूटने या अपक्षय और वायुमंडलीय कणों के जमाव से उत्पन्न होता है। प्राकृतिक पानी में आर्सेनिक की उपस्थिति चट्टानों के प्रकार, जलवायु परिस्थितियों, हाइड्रोजियोलॉजिकल परतों की प्रकृति, भूमिगत हाइड्रो-रासायनिक स्थिति और चट्टान तथा परिसंचारी भूजल के बीच संपर्क के समय से प्रभावित होती है।
            </p>

            <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
              आर्सेनिक विभिन्न सांद्रता में सभी भूवैज्ञानिक सामग्रियों में व्यापक रूप से वितरित है। आर्सेनिक भू-रसायन विज्ञान के आधार पर, भूजल में आर्सेनिक जुटाव (mobilization) के संभावित तंत्रों को निम्नलिखित माना जाता है:
            </p>
            
            <ul style="margin: 0 0 15px 0; padding-left: 20px; line-height: 1.6; text-align: justify;">
              <li style="margin-bottom: 6px;">
                <strong>(i) उपसतह में अपचायक परिस्थितियों (reducing conditions) की शुरुआत के कारण आर्सेनिक-समृद्ध आयरन ऑक्सीहाइड्रॉक्साइड (FeOOH) का विघटन।</strong>
              </li>
              <li style="margin-bottom: 6px;">
                <strong>(ii) आर्सेनिक-युक्त पाइराइट खनिजों के ऑक्सीकरण के कारण आर्सेनिक का जुटाव।</strong>
              </li>
              <li style="margin-bottom: 6px;">
                <strong>(iii) फॉस्फेट (H₂PO₄⁻) आयनों के साथ प्रतिस्पर्धी विनिमय द्वारा जलभृत खनिजों में सोख लिए गए आर्सेनिक का विमोचन।</strong>
              </li>
            </ul>

            <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
              इन तीनों में से, अपचायक परिस्थितियों में FeOOH के विघटन को बड़े जलोढ़ जलभृतों में भूजल में अत्यधिक आर्सेनिक संचय का सबसे संभावित कारण माना जाता है।
            </p>

            <p style="text-align: justify; line-height: 1.6; margin-bottom: 20px;">
              उत्तर प्रदेश, बिहार और पश्चिम बंगाल के कुछ हिस्सों को कवर करने वाले गंगा-भागीरथी जलोढ़ क्षेत्र में आर्सेनिक संदूषण ज्यादातर उथले जलभृतों तक सीमित है। अत्यधिक आर्सेनिक मानव स्वास्थ्य को गंभीर नुकसान पहुँचा सकता है जैसे श्वसन संकट और हृदय रोग। एनीमिया और ल्यूकोपेनिया आर्सेनिक विषाक्तता के अन्य सामान्य प्रभाव हैं। बीआईएस (भारतीय मानक ब्यूरो) पेयजल मानकों (IS 10500:2012) के अनुसार पीने के उद्देश्य से आर्सेनिक की अधिकतम स्वीकार्य सीमा <strong>0.01 mg/L (या 10 ppb)</strong> है। आर्सेनिक की बीआईएस स्वीकार्य सीमा को वर्ष 2015 में 0.05 mg/L (50 ppb) से संशोधित कर 0.01 mg/L (10 ppb) किया गया था।
            </p>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.1 मुख्य संदूषण का शमन (Mitigation of Major Contamination)</h5>
            <ul style="margin: 0 0 20px 0; padding-left: 20px; line-height: 1.6; text-align: justify;">
              <li style="margin-bottom: 6px;">आर्सेनिक संदूषण ज्यादातर भूगर्भीय प्रकृति का होता है और उर्वरकों और कीटनाशकों के उपयोग तथा औद्योगिक प्रदूषण से जुड़ी मानव गतिविधियों के कारण होने वाला मानवजनित संदूषण कम पाया जाता है।</li>
              <li style="margin-bottom: 6px;">मानवजनित संदूषण के मामले में, उचित निवारक उपाय अपनाकर शमन किया जा सकता है।</li>
              <li style="margin-bottom: 6px;">भूगर्भीय संदूषण को पूर्ववत नहीं किया जा सकता क्योंकि संदूषण जलभृत में ही मौजूद होता है जो भूजल का स्रोत है। हालांकि, जलभृत के कृत्रिम पुनर्भरण जैसे उपायों के माध्यम से इसे पतला (dilute) किया जा सकता है। संदूषित क्षेत्रों में सतही और भूजल का संयुक्त उपयोग भी महत्वपूर्ण भूमिका निभाएगा।</li>
              <li style="margin-bottom: 6px;">जब पीने और घरेलू उद्देश्यों के लिए भूजल स्रोतों का उपयोग किया जाता है, तो संदूषित क्षेत्र में आपूर्ति के लिए वैकल्पिक सुरक्षित स्रोत खोजने की सलाह दी जाती है। आर्सेनिक मुक्त पानी के साथ मिलाकर पीने के पानी में आर्सेनिक के स्तर को कम किया जा सकता है।</li>
              <li style="margin-bottom: 6px;">चिन्हित संदूषित स्रोतों जैसे कुओं, बोरवेल, ट्यूबवेलों को चिन्हित किया जाना चाहिए और उनके उपयोग को प्रतिबंधित किया जाना चाहिए और जनता को इन प्रतिबंधित स्रोतों के बारे में जागरूक किया जाना चाहिए।</li>
              <li style="margin-bottom: 6px;">पीने के पानी से आर्सेनिक निकालने की मानक वैज्ञानिक रूप से प्रमाणित तकनीकें हैं, जिनका उपयोग केवल तभी किया जाना चाहिए जब भूजल आपूर्ति के लिए कोई वैकल्पिक सुरक्षित स्रोत उपलब्ध न हो।</li>
            </ul>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.2 आर्सेनिक के लिए उपचारात्मक उपाय (Remedial Measures for Arsenic)</h5>
            <div style="line-height: 1.6; text-align: justify; margin-bottom: 20px;">
              <p style="margin: 0 0 8px 0;"><strong>(क) अवक्षेपण प्रक्रियाएं (Precipitation processes):</strong> Al³⁺ और Fe³⁺ जैसी धातु आयनों के साथ सह-अवक्षेपण और अधिशोषण पानी से आर्सेनिक निकालने की सबसे आम उपचार तकनीक है। अवक्षेप को हटाने के लिए अवसादन के बाद रैपिड सैंड फिल्ट्रेशन या प्रत्यक्ष निस्पंदन या माइक्रोफिल्ट्रेशन का उपयोग किया जाता है। इस विधि की दक्षता में सुधार के लिए, As(III) का As(V) में पूर्व-ऑक्सीकरण करने की सलाह दी जाती है। ऑक्सीकरण के लिए हाइपोक्लोराइड और परमैंगनेट का आमतौर पर उपयोग किया जाता है।</p>
              <p style="margin: 0 0 8px 0;"><strong>(ख) अधिशोषण प्रक्रियाएं (Adsorptive processes):</strong> सक्रिय एल्युमिना, सक्रिय कार्बन और आयरन/मैंगनीज ऑक्साइड आधारित या लेपित फिल्टर मीडिया पर अधिशोषण। अधिशोषण प्रक्रियाओं में पानी को एक संपर्क बेड से गुजारा जाता है जहां सतह रासायनिक प्रतिक्रियाओं द्वारा आर्सेनिक को हटा दिया जाता है। भारत में सक्रिय एल्युमिना आधारित सोखने वाले मीडिया का उपयोग किया जा रहा है। दानेदार फेरिक हाइड्रोक्साइड प्राकृतिक पानी से आर्सेनेट, आर्सेनाइट को हटाने के लिए एक highly effective अधिशोषक है।</p>
              <p style="margin: 0 0 8px 0;"><strong>(ग) आयन-विनिमय प्रक्रियाएं (Ion-exchange processes):</strong> यह सक्रिय एल्युमिना के समान है, हालांकि, इस विधि में माध्यम अपेक्षाकृत अच्छी तरह से परिभाषित आयन विनिमय क्षमता का सिंथेटिक राल (resin) होता है। सिंथेटिक आयन एक्सचेंज राल केवल नकारात्मक रूप से चार्ज की गई As(V) प्रजातियों को हटाता है।</p>
              <p style="margin: 0 0 0 0;"><strong>(घ) झिल्ली प्रक्रियाएं (Membrane processes):</strong> इसमें नैनो-फिल्ट्रेशन, अल्ट्राफिल्ट्रेशन, रिवर्स ऑस्मोसिस (RO) और इलेक्ट्रोडायलिसिस शामिल हैं जिसमें आर्सेनिक सहित कई प्रदूषकों को हटाने के लिए सिंथेटिक झिल्ली का उपयोग किया जाता है। वे निस्पंदन, विद्युत प्रतिकर्षण और आर्सेनिक युक्त यौगिकों के अधिशोषण के माध्यम से आर्सेनिक को हटाते हैं</p>
            </div>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.3 आर्सेनिक संदूषण के शमन की दिशा में सीजीडब्ल्यूबी (CGWB) द्वारा किया गया कार्य</h5>
            <ol style="margin: 0 0 15px 0; padding-left: 20px; line-height: 1.6; text-align: justify;">
              <li style="margin-bottom: 6px;">केंद्रीय भूजल बोर्ड देश में अपनी स्थापना के बाद से भूजल अन्वेषण कर रहा है और सभी राज्यों में जल-भूवैज्ञानिक स्थितियों की परवाह किए बिना बड़ी संख्या के बोरवेल और ट्यूबवेल का निर्माण किया है। रासायनिक विश्लेषण के बाद संदूषण मुक्त कुओं को सामुदायिक पेयजल आपूर्ति के लिए राज्य भूजल विभागों को सौंप दिया जाता है।</li>
              <li style="margin-bottom: 6px;">सीजीडब्ल्यूबी के पास उपलब्ध भूजल गुणवत्ता डेटा और संदूषण की जानकारी आवश्यक उपचारात्मक उपाय करने के लिए संबंधित राज्य सरकारों के साथ साझा की जाती है।</li>
              <li style="margin-bottom: 6px;">भूजल प्रदूषण को रोकने और संदूषित पानी के सुरक्षित उपयोग सहित विभिन्न पहलुओं पर सीजीडब्ल्यूबी द्वारा समय-समय पर जागरूकता कार्यक्रम/कार्यशाला आयोजित की जाती हैं।</li>
              <li style="margin-bottom: 6px;">भूजल अन्वेषण के अनुभवों के आधार पर, सीजीडब्ल्यूबी ने उपयुक्त कुआं डिजाइन और सीमेंट सीलिंग तकनीकों का उपयोग करके फ्लोराइड और आर्सेनिक मुक्त कुओं के निर्माण के लिए तरीके विकसित किए हैं। इन्हें राज्य एजेंसियों के साथ साझा किया गया है।</li>
              <li style="margin-bottom: 6px;">राष्ट्रीय जलभृत मानचित्रण कार्यक्रम (NAQUIM) के तहत भूजल गुणवत्ता और आर्सेनिक जैसे विषाक्त पदार्थों पर विशेष ध्यान दिया जा रहा है।</li>
              <li style="margin-bottom: 6px;">सीजीडब्ल्यूबी ने एनआईएच (NIH), रुड़की के सहयोग से जून 2010 में "Mitigation and Remedy of Ground water Arsenic Menace in India" पर एक विजन दस्तावेज तैयार किया जो ऑनलाइन उपलब्ध है।</li>
            </ol>
            <p style="margin: 10px 0 20px 0; text-align: justify; line-height: 1.6;">
              जल शक्ति मंत्रालय के DoWR, RD और GR ने 24 सितंबर 2020 को भूजल निष्कर्षण के नियंत्रण और नियमन के लिए अखिल भारतीय दिशा-निर्देश जारी किए हैं। प्रदूषक उद्योगों (चर्मशोधन, बूचड़खाने, रंग, रसायन, कोयला वाशंकर आदि) के परिसर में भूजल को प्रदूषित होने से बचाने के लिए अच्छी स्वच्छता स्थिति में ट्यूबवेल का निर्माण, आरसीसी (RCC) ग्राउटिंग और जलभृत संरक्षण जैसे उपाय अनिवार्य किए गए हैं।
            </p>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.4 सुरक्षित वैकल्पिक जलभृत को टैप करने के लिए कुआं निर्माण (CGWB)</h5>
            <p style="margin: 0 0 12px 0; text-align: justify; line-height: 1.6;">
              यह तकनीक प्रभावित क्षेत्रों के भीतर ही सुरक्षित वैकल्पिक जलभृतों को टैप करने की वकालत करती है। छत्तीसगढ़ राज्य के राजनांदगांव को छोड़कर, बिहार और उत्तर प्रदेश को कवर करने वाले गंगा के मैदानों के साथ-साथ पश्चिम बंगाल में डेल्टा के मैदान बहु-जलभृत प्रणालियों (multi aquifer systems) द्वारा चिह्नित हैं। यहाँ संदूषण उथले जलभृत तंत्र (80 मीटर की गहराई के भीतर) तक ही सीमित है। इसलिए, गहरे कुओं का निर्माण गहरे जोन के आर्सेनिक मुक्त भूजल को टैप करने के लिए किया जाता है। इस बहु-जलभृत प्रणाली में उथले संदूषित पानी को गहरे साफ पानी से मिलने से रोकने के लिए अनूठी सीमेंट सीलिंग तकनीक अपनाई जाती है। सुरक्षित गहरे नलकूप निर्माण के लिए सीमेंट सीलिंग तकनीक का आरेख चित्र ${figNum} में प्रदर्शित है।
            </p>

            ${arsenicWellImageHTML}
            <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 8px; margin-bottom: 15px;">
              चित्र ${figNum}: सीमेंट सीलिंग तकनीक के साथ आर्सेनिक मुक्त ट्यूबवेल का योजनाबद्ध डिजाइन
            </p>

            <p style="margin: 15px 0 0 0; text-align: justify; line-height: 1.6;">
              एनएक्यूआईएम (NAQUIM) कार्यक्रम के तहत इस तकनीक से अब तक 522 खोजपूर्ण कुएं बनाए गए हैं जिनमें बिहार में 40, पश्चिम बंगाल में 188 और उत्तर प्रदेश में 294 शामिल हैं। सीजीडब्ल्यूबी की इस सीमेंट सीलिंग तकनीक को राज्य एजेंसियों के साथ साझा किया गया है।
            </p>
          </div>
        `;
      } else {
        return `
          <div style="margin-top: 20px; margin-bottom: 25px; font-family: 'Times New Roman', Times, serif; font-size: 11pt; text-align: justify; line-height: 1.6;">
            <h4 style="font-size: 13pt; font-weight: bold; color: #1e3a8a; text-align: left; margin-bottom: 15px; border-bottom: 1.5px solid #94a3b8; padding-bottom: 4px;">
              7.${subSecIndex} Mitigation of Arsenic Contamination in Ground Water
            </h4>
            
            <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
              The contamination of ground water by Arsenic in the country is in general geogenic in nature. Arsenic in ground water occurs naturally from the breakdown of rocks and soils or weathering and deposition of atmospheric particles. Arsenic occurrence in natural water is affected by the type of rocks, climatic conditions, nature of hydrogeological strata, underground hydro-chemical conditions, and time of contact between rock and the circulating ground water.
            </p>

            <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
              Arsenic is widely distributed in all geological materials at varying concentrations. On the basis of the arsenic geochemistry, the probable mechanisms of arsenic mobilization in groundwater are attributed to:
            </p>
            
            <ul style="margin: 0 0 15px 0; padding-left: 20px; line-height: 1.6; text-align: justify;">
              <li style="margin-bottom: 6px;">
                <strong>(i) Dissolution of As-rich iron oxyhydroxides (FeOOH)</strong> due to the onset of reducing conditions in the subsurface.
              </li>
              <li style="margin-bottom: 6px;">
                <strong>(ii) Mobilization of As</strong> due to the oxidation of As-bearing pyrite minerals.
              </li>
              <li style="margin-bottom: 6px;">
                <strong>(iii) Release of As sorbed to aquifer minerals</strong> by competitive exchange with phosphate (H₂PO₄⁻) ions.
              </li>
            </ul>

            <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
              Out of the above three, the first mechanism involving dissolution of FeOOH under reducing conditions is considered to be the most probable reason for excessive As accumulation in groundwater in large alluvial aquifers.
            </p>

            <p style="text-align: justify; line-height: 1.6; margin-bottom: 20px;">
              The Arsenic contamination in the Ganga-Bhagirathi alluvial tract covering parts of Uttar Pradesh, Bihar, and West Bengal is mostly confined to shallow aquifers. The excess arsenic may cause sufficient damage to human health like respiratory distress and cardiac diseases. Anaemia and leucopenia are other common effects of arsenic poisoning. The maximum permissible limit of Arsenic for drinking purpose is <strong>0.01 mg/L (or 10 ppb)</strong> as per BIS (Bureau of Indian Standards) Drinking Water Standards (IS 10500:2012). The BIS permissible limit of Arsenic was revised from 0.05 mg/L (50 ppb) to 0.01 mg/L (10 ppb) in the year 2015.
            </p>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.1 Mitigation of Major Contamination</h5>
            <ul style="margin: 0 0 20px 0; padding-left: 20px; line-height: 1.6; text-align: justify;">
              <li style="margin-bottom: 6px;">Arsenic contamination is mostly geogenic in nature and less commonly due to anthropogenic causes involving human activities such as the use of fertilizers and pesticides and industrial pollution.</li>
              <li style="margin-bottom: 6px;">In case of anthropogenic contamination, mitigation may be done through adopting proper preventive measures.</li>
              <li style="margin-bottom: 6px;">Geogenic contamination cannot be undone as the contamination is in the aquifer which is the source of the ground water. However, it can be diluted through measures such as artificial recharge of the aquifer. Conjunctive use of surface and ground water will also play an important role in ground water contaminated areas.</li>
              <li style="margin-bottom: 6px;">When ground water sources are used for drinking and domestic purposes, it is always advisable to find alternate safe sources for supply in the ground water contaminated area. The level of Arsenic in drinking water can be reduced by blending with Arsenic-free water.</li>
              <li style="margin-bottom: 6px;">Identified contaminated sources or ground water utilization sources such as dug wells, bore wells, and tube wells are to be marked and their utilization is to be prohibited, and the public should be made aware of these prohibited sources.</li>
              <li style="margin-bottom: 6px;">There are standard scientifically proven techniques to remove Arsenic from drinking water, which should only be used in case no alternate source for ground water supply is available.</li>
            </ul>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.2 Remedial Measures for Arsenic</h5>
            <div style="line-height: 1.6; text-align: justify; margin-bottom: 20px;">
              <p style="margin: 0 0 8px 0;"><strong>(a) Precipitation processes:</strong> Adsorption, co-precipitation with hydrolysing metals such as Al³⁺ and Fe³⁺ is the most common treatment technique for removing arsenic from water. Sedimentation followed by rapid sand filtration or direct filtration or microfiltration is used to remove the precipitate. To improve the efficiency of this method, prior oxidation of As (III) to As (V) is advisable. Hypochlorite and permanganate are commonly used for oxidation.</p>
              <p style="margin: 0 0 8px 0;"><strong>(b) Adsorptive processes:</strong> Adsorption onto activated alumina, activated carbon, and iron/manganese oxide-based or coated filter media. Adsorptive processes involve the passage of water through a contact bed where arsenic is removed by surface chemical reactions. Activated alumina-based sorptive media are being used in India. Granular ferric hydroxide is a highly effective adsorbent used for the adsorptive removal of arsenate and arsenite from natural water.</p>
              <p style="margin: 0 0 8px 0;"><strong>(c) Ion-exchange processes:</strong> This is similar to that of activated alumina, however, in this method the medium is synthetic resin of relatively well-defined ion exchange capacity. In these processes, ions held electrostatically on the surface of a solid phase are exchanged for ions of similar charge dissolved in water. Usually, a synthetic anion exchange resin is used as a solid. Ion exchange removes only negatively charged As (V) species.</p>
              <p style="margin: 0 0 0 0;"><strong>(d) Membrane processes:</strong> This includes nano-filtration, ultrafiltration, reverse osmosis, and electrodialysis in which synthetic membranes are used for the removal of many contaminants including arsenic. They remove arsenic through filtration, electric repulsion, and adsorption of arsenic-bearing compounds.</p>
            </div>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.3 Work Done by CGWB towards Mitigation of Arsenic Contamination</h5>
            <ol style="margin: 0 0 15px 0; padding-left: 20px; line-height: 1.6; text-align: justify;">
              <li style="margin-bottom: 6px;">Central Ground Water Board is doing ground water exploration in the country since its establishment and has constructed a large number of borewells and tubewells in all states, irrespective of the hydrogeological conditions. The water samples from each of these wells undergo chemical analysis, and successful wells free from any contaminants were handed over to state ground water departments for their use for community drinking water supply.</li>
              <li style="margin-bottom: 6px;">Data on ground water quality available with CGWB along with information on ground water contamination are shared with concerned State Governments for taking necessary remedial measures.</li>
              <li style="margin-bottom: 6px;">Awareness generation programs/workshops on various aspects of ground water including preventing ground water pollution and safe use of contaminated water are being conducted by CGWB periodically.</li>
              <li style="margin-bottom: 6px;">Based on the findings of the studies and experience of ground water exploration, CGWB has developed certain methods for constructing fluoride and arsenic-free wells by employing suitable designing of wells and cement sealing techniques. Such techniques of construction of contaminant-free bore wells/tube wells are shared with the state ground water departments to use them in similar terrains.</li>
              <li style="margin-bottom: 6px;">Under the National Aquifer Mapping Programme (NAQUIM) of CGWB, special attention is being given to the aspect of ground water quality including contamination by toxic substances such as Arsenic in ground water.</li>
              <li style="margin-bottom: 6px;">CGWB in collaboration with NIH, Roorkee prepared a vision document on “Mitigation and Remedy of Ground water Arsenic Menace in India” in June 2010 which is available for online access.</li>
            </ol>
            <p style="margin: 10px 0 20px 0; text-align: justify; line-height: 1.6;">
              Department of Water Resources, River Development, and Ganga Rejuvenation, Ministry of Jal Shakti has issued guidelines for the control and regulation of groundwater extraction with pan-India applicability notified on 24 September 2020. The guidelines include clauses on <em>'Measures to be adopted to ensure prevention from pollution in the plant premises of polluting industries/projects'</em>. It is pointed out that ground water in and around polluting industries like Tannery, Slaughter Houses, Dye, Chemical, Coal-washery, other hazardous units, etc. is generally observed to be polluted. In order to prevent further deterioration of ground water quality in such places, it is essential to take necessary measures for wellhead protection, such as constructing tube wells/bore wells at hygienically maintained locations, RCC (Reinforced Concrete Cement) grouting around tube wells, and prohibiting recharge measures within plant premises.
            </p>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.4 Well Construction for Tapping Arsenic-safe Alternate Aquifer (CGWB)</h5>
            <p style="margin: 0 0 12px 0; text-align: justify; line-height: 1.6;">
              This technique advocates tapping safe alternate aquifers right within the affected areas. In India, except at Rajnandgaon in Chhattisgarh state, the vast As-affected areas in the Gangetic Plains covering Bihar and Uttar Pradesh as well as the Deltaic Plains in West Bengal are marked by multi-aquifer systems. All the arsenic-affected districts in UP and Bihar are aligned along the linear track of the river Ganga, as is the position in West Bengal where it is along the eastern side of the river Bhagirathi. The sedimentary sequence is made up of Quaternary deposits, where the aquifers consist of unconsolidated sands which are separated by clay/sandy clay, making the deeper aquifer/aquifers semi-confined to confined. The contamination is confined to the upper slice of the sediments, within the depth of 80 m, affecting the shallow aquifer system. At places, like Maldah district of West Bengal, a single aquifer exists until the bed rock is encountered at 70-120 m bgl.
            </p>
            <p style="margin: 0 0 15px 0; text-align: justify; line-height: 1.6;">
              It has been observed that shallow aquifers have more arsenic contamination in comparison to deep aquifers. Therefore, deep wells are constructed to tap deeper zones of arsenic-free ground water. In the multi-aquifer system, the cement sealing technique is adopted to prevent the mixing of arsenic-contaminated water with arsenic-free ground water. The design of construction of an Arsenic-free Tube well with cement sealing technology is illustrated in Figure ${figNum}.
            </p>

            ${arsenicWellImageHTML}
            <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 8px; margin-bottom: 15px;">
              Figure ${figNum}: Schematic design of an Arsenic-safe Tube well with cement sealing technology
            </p>

            <p style="margin: 15px 0 0 0; text-align: justify; line-height: 1.6;">
              So far, 522 exploratory wells tapping arsenic-safe aquifers have been constructed under the NAQUIM programme, including 40 in Bihar, 188 in West Bengal, and 294 in Uttar Pradesh with this technique. The innovative cement sealing technique of CGWB has been shared with state agencies to utilize for constructing arsenic-free wells.
            </p>
          </div>
        `;
      }
    } else if (key === "F" || key === "FLUORIDE") {
      const figNum = figCounter ? figCounter.current++ : 16;

      const svgFluorideEnglish = `
        <svg width="720" height="240" viewBox="0 0 720 240" style="background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; font-family: 'Times New Roman', Times, serif; display: block; margin: 15px auto;">
          <rect x="235" y="15" width="250" height="40" fill="#1e3a8a" rx="5" />
          <text x="360" y="40" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">DEFLUORIDATION TECHNOLOGIES</text>
          
          <path d="M 360 55 L 360 85" stroke="#475569" stroke-width="2" fill="none" />
          <path d="M 140 85 L 580 85" stroke="#475569" stroke-width="2" fill="none" />
          <path d="M 140 85 L 140 115" stroke="#475569" stroke-width="2" fill="none" />
          <path d="M 360 85 L 360 115" stroke="#475569" stroke-width="2" fill="none" />
          <path d="M 580 85 L 580 115" stroke="#475569" stroke-width="2" fill="none" />
          
          <rect x="35" y="115" width="210" height="90" fill="#f0fdf4" stroke="#16a34a" stroke-width="1.5" rx="5" />
          <text x="140" y="135" fill="#14532d" font-size="11" font-weight="bold" text-anchor="middle">Adsorption &amp; Ion-Exchange</text>
          <text x="140" y="155" fill="#166534" font-size="9.5" text-anchor="middle">• Activated Alumina (AA)</text>
          <text x="140" y="172" fill="#166534" font-size="9.5" text-anchor="middle">• Bone Char / Synthetic Resins</text>
          <text x="140" y="189" fill="#166534" font-size="9.5" text-anchor="middle">• Clay Minerals &amp; Brick Pieces</text>
          
          <rect x="255" y="115" width="210" height="90" fill="#fffbeb" stroke="#d97706" stroke-width="1.5" rx="5" />
          <text x="360" y="135" fill="#78350f" font-size="11" font-weight="bold" text-anchor="middle">Coagulation–Precipitation</text>
          <text x="360" y="155" fill="#92400e" font-size="9.5" text-anchor="middle">• Nalgonda Technique (Alum+Lime)</text>
          <text x="360" y="172" fill="#92400e" font-size="9.5" text-anchor="middle">• PAC / PAHS Coagulants</text>
          <text x="360" y="189" fill="#92400e" font-size="9.5" text-anchor="middle">• Brushite &amp; Calcium Precipitation</text>

          <rect x="475" y="115" width="210" height="90" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" rx="5" />
          <text x="580" y="135" fill="#0c4a6e" font-size="11" font-weight="bold" text-anchor="middle">Ionic Separation (Membrane)</text>
          <text x="580" y="155" fill="#075985" font-size="9.5" text-anchor="middle">• Reverse Osmosis (RO)</text>
          <text x="580" y="172" fill="#075985" font-size="9.5" text-anchor="middle">• Nanofiltration (NF)</text>
          <text x="580" y="189" fill="#075985" font-size="9.5" text-anchor="middle">• Electrodialysis / Dialysis</text>
        </svg>
      `;

      const svgFluorideHindi = `
        <svg width="720" height="240" viewBox="0 0 720 240" style="background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; font-family: 'Times New Roman', Times, serif; display: block; margin: 15px auto;">
          <rect x="235" y="15" width="250" height="40" fill="#1e3a8a" rx="5" />
          <text x="360" y="40" fill="#ffffff" font-size="12" font-weight="bold" text-anchor="middle">फ्लोराइड निष्कासन तकनीकें</text>
          
          <path d="M 360 55 L 360 85" stroke="#475569" stroke-width="2" fill="none" />
          <path d="M 140 85 L 580 85" stroke="#475569" stroke-width="2" fill="none" />
          <path d="M 140 85 L 140 115" stroke="#475569" stroke-width="2" fill="none" />
          <path d="M 360 85 L 360 115" stroke="#475569" stroke-width="2" fill="none" />
          <path d="M 580 85 L 580 115" stroke="#475569" stroke-width="2" fill="none" />
          
          <rect x="35" y="115" width="210" height="90" fill="#f0fdf4" stroke="#16a34a" stroke-width="1.5" rx="5" />
          <text x="140" y="135" fill="#14532d" font-size="11" font-weight="bold" text-anchor="middle">अधिशोषण और आयन-विनिमय</text>
          <text x="140" y="155" fill="#166534" font-size="9.5" text-anchor="middle">• सक्रिय एल्युमिना (AA)</text>
          <text x="140" y="172" fill="#166534" font-size="9.5" text-anchor="middle">• बोन चार / सिंथेटिक रेजिन</text>
          <text x="140" y="189" fill="#166534" font-size="9.5" text-anchor="middle">• मिट्टी के खनिज और ईंट के टुकड़े</text>
          
          <rect x="255" y="115" width="210" height="90" fill="#fffbeb" stroke="#d97706" stroke-width="1.5" rx="5" />
          <text x="360" y="135" fill="#78350f" font-size="11" font-weight="bold" text-anchor="middle">स्कंदन-अवक्षेपण प्रक्रियाएं</text>
          <text x="360" y="155" fill="#92400e" font-size="9.5" text-anchor="middle">• नालगोंडा तकनीक (एलम+चूना)</text>
          <text x="360" y="172" fill="#92400e" font-size="9.5" text-anchor="middle">• पीएसी (PAC) / पीएएचएस (PAHS)</text>
          <text x="360" y="189" fill="#92400e" font-size="9.5" text-anchor="middle">• ब्रशाइट और कैल्शियम अवक्षेपण</text>

          <rect x="475" y="115" width="210" height="90" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" rx="5" />
          <text x="580" y="135" fill="#0c4a6e" font-size="11" font-weight="bold" text-anchor="middle">झिल्ली पृथक्करण प्रक्रियाएं</text>
          <text x="580" y="155" fill="#075985" font-size="9.5" text-anchor="middle">• रिवर्स ऑस्मोसिस (RO)</text>
          <text x="580" y="172" fill="#075985" font-size="9.5" text-anchor="middle">• नैनोफिल्ट्रेशन (NF)</text>
          <text x="580" y="189" fill="#075985" font-size="9.5" text-anchor="middle">• इलेक्ट्रोडायलिसिस / डायलिसिस</text>
        </svg>
      `;

      if (false) {
        return `
          <div style="margin-top: 20px; margin-bottom: 25px; font-family: 'Times New Roman', Times, serif; font-size: 11pt; text-align: justify; line-height: 1.6;">
            <h4 style="font-size: 13pt; font-weight: bold; color: #1e3a8a; text-align: left; margin-bottom: 15px; border-bottom: 1.5px solid #94a3b8; padding-bottom: 4px;">
              7.${subSecIndex} भूजल में फ्लोराइड संदूषण का निवारण और उपचारात्मक प्रबंधन (Preventive and Remedial Management for Fluoride)
            </h4>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.1 फ्लोराइड संदूषण के लिए निवारक उपाय (Preventive Measures)</h5>
            <p style="margin: 0 0 12px 0; text-align: justify; line-height: 1.6;">
              भूजल में फ्लोराइड संदूषण मुख्य रूप से भूगर्भीय (geogenic) स्रोतों से उत्पन्न होता है और इसलिए इसे पूरी तरह से समाप्त करना संभव नहीं है। फिर भी, उचित भूजल प्रबंधन प्रथाओं और स्रोतों के संरक्षण के उपायों के माध्यम से फ्लोराइड के जोखिम को काफी कम किया जा सकता है और सुरक्षित पेयजल की उपलब्धता सुनिश्चित की जा सकती है। निवारक उपायों का उद्देश्य फ्लोराइड गतिशीलता को न्यूनतम करना, कम फ्लोराइड वाले जलभृतों की रक्षा करना और संदूषित भूजल स्रोतों पर निर्भरता को कम करना है।
            </p>
            
            <ul style="margin: 0 0 20px 0; padding-left: 20px; line-height: 1.6; text-align: justify;">
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.1 सुरक्षित जलभृतों की पहचान और संरक्षण:</strong> पेयजल मानकों के भीतर फ्लोराइड सांद्रता वाले जलभृतों की पहचान के लिए व्यापक भूजल गुणवत्ता जांच की जानी चाहिए। घरेलू जल आपूर्ति के लिए ऐसे जलभृतों को प्राथमिकता दी जानी चाहिए और अत्यधिक दोहन से संरक्षित किया जाना चाहिए।
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.2 वैकल्पिक पेयजल स्रोतों का विकास:</strong> फ्लोराइड प्रभावित क्षेत्रों में वैकल्पिक पेयजल स्रोतों को विकसित किया जाना चाहिए। सतही जल निकायों, बारहमासी नदियों, झरनों और कम फ्लोराइड वाले जलभृतों का उपयोग सुरक्षित पेयजल आपूर्ति के रूप में किया जा सकता है।
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.3 वर्षा जल संचयन और कृत्रिम भूजल पुनर्भरण:</strong> परकोलेशन टैंक, रिचार्ज शाफ्ट, रिचार्ज कुएं, चेक डैम और छत पर वर्षा जल संचयन प्रणालियाँ भूजल संसाधनों को बढ़ाने और फ्लोराइड युक्त भूजल को पतला (dilute) करने में मदद करती हैं।
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.4 वैज्ञानिक भूजल विकास:</strong> फ्लोराइड प्रवण क्षेत्रों में अत्यधिक और अनियमित भूजल निकासी से बचना चाहिए, क्योंकि गिरते जल स्तर से पानी का चट्टान के साथ संपर्क समय और फ्लोराइड का विघटन बढ़ता है।
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.5 मानवजनित स्रोतों का नियंत्रण:</strong> फॉस्फेट उर्वरकों का विवेकपूर्ण उपयोग, औद्योगिक कचरे का उचित निपटान और विसर्जन से पहले फ्लोराइड युक्त औद्योगिक अपशिष्टों का उपचार सुनिश्चित किया जाना चाहिए।
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.6 नियमित भूजल गुणवत्ता निगरानी:</strong> मौसमी आधार पर फ्लोराइड सांद्रता की समय-समय पर निगरानी की जानी चाहिए ताकि नए हॉटस्पॉट की समय पर पहचान हो सके।
              </li>
              <li style="margin-bottom: 6px;">
                <strong>7.${subSecIndex}.1.7 सामुदायिक जागरूकता और स्वास्थ्य निगरानी:</strong> दंत और कंकाल फ्लोरोसिस के जोखिमों के बारे में स्थानीय समुदायों को जागरूक करना और घरेलू स्तर पर फ्लोराइड हटाने की सरल विधियों के उपयोग को बढ़ावा देना।
              </li>
            </ul>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 25px 0 10px 0;">7.${subSecIndex}.2 फ्लोराइड हटाने की तकनीकों के लिए उपचारात्मक उपाय (Remedial Measures)</h5>
            <p style="margin: 0 0 12px 0; text-align: justify; line-height: 1.6;">
              जहाँ भूजल में फ्लोराइड की मात्रा निर्धारित पेयजल सीमा से अधिक होती है, वहां सार्वजनिक स्वास्थ्य की रक्षा के लिए उचित उपचार आवश्यक हो जाता है। भूजल से फ्लोराइड निकालने की तकनीकों को उनके उपचार तंत्र के आधार पर तीन मुख्य श्रेणियों में वर्गीकृत किया जा सकता है (चित्र \${figNum}):
            </p>

            <!-- Figure Classification SVG diagram -->
            \${svgFluorideHindi}

            <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 8px; margin-bottom: 20px;">
              चित्र \${figNum}: फ्लोराइड निष्कासन तकनीकों का योजनाबद्ध वर्गीकरण
            </p>

            <div style="line-height: 1.6; text-align: justify;">
              <p style="margin: 0 0 12px 0;">
                <strong>7.${subSecIndex}.2.1 अधिशोषण और आयन-विनिमय प्रक्रियाएं (Adsorption and Ion-Exchange):</strong> यह फ्लोराइड हटाने की सबसे व्यापक और आर्थिक रूप से व्यावहारिक विधि है। पानी को अधिशोषक बेड से गुजारा जाता है जहां फ्लोराइड आयन चिपक जाते हैं। मुख्य अधिशोषकों में <strong>सक्रिय एल्युमिना (Activated Alumina - AA)</strong>, बोन चार, हेमेटाइट, मिट्टी के खनिज और सिंथेटिक आयन विनिमय राल शामिल हैं। सक्रिय एल्युमिना का उपयोग भारत में सबसे अधिक होता है।
              </p>
              <p style="margin: 0 0 12px 0;">
                <strong>7.${subSecIndex}.2.2 स्कंदन–अवक्षेपण प्रक्रियाएं (Coagulation–Precipitation):</strong> पानी में एलम, चूना या पॉली एल्युमिनियम क्लोराइड (PAC) जैसे कोगुलेंट मिलाने से अघुलनशील एल्युमिनियम हाइड्रोक्साइड फ्लॉक्स बनते हैं, जो फ्लोराइड आयनों को अधिशोषित कर अवसादन द्वारा अलग कर देते हैं।
              </p>
              <p style="background-color: #f1f5f9; padding: 10px; border-radius: 4px; margin: 10px 0 15px 0;">
                <strong>नालगोंडा तकनीक (Nalgonda Technique):</strong> नीरी (NEERI, India) द्वारा विकसित यह तकनीक ग्रामीण और सामुदायिक जल आपूर्ति के लिए सबसे सस्ती है। इस उपचार प्रक्रिया में चरणबद्ध तरीके से एलम मिलाना, चूना मिलाना (pH बनाए रखने के लिए), ब्लीचिंग पाउडर (कीटाणुशोधन), तीव्र मिश्रण, फ्लोकुलेशन, अवसादन और निस्पंदन शामिल हैं। यह तकनीक १.५ से २० mg/L फ्लोराइड और १५०० mg/L से कम टीडीएस वाले पानी के लिए अत्यधिक उपयुक्त है।
              </p>
              <p style="margin: 0 0 0 0;">
                <strong>7.${subSecIndex}.2.3 झिल्ली प्रक्रियाएं (Ionic Separation / Membrane Processes):</strong> इसमें रिवर्स ऑस्मोसिस (RO), नैनोफिल्ट्रेशन (NF) और इलेक्ट्रोडायलिसिस शामिल हैं। रिवर्स ऑस्मोसिस तकनीक ९०-९५% से अधिक फ्लोराइड हटाने में सक्षम है, लेकिन यह अधिक खर्चीली है, इसके लिए निरंतर बिजली और कुशल रखरखाव की आवश्यकता होती है, और यह भारी मात्रा में reject पानी उत्पन्न करती है।
              </p>
            </div>
          </div>
        `;
      } else {
        return `
          <div style="margin-top: 20px; margin-bottom: 25px; font-family: 'Times New Roman', Times, serif; font-size: 11pt; text-align: justify; line-height: 1.6;">
            <h4 style="font-size: 13pt; font-weight: bold; color: #1e3a8a; text-align: left; margin-bottom: 15px; border-bottom: 1.5px solid #94a3b8; padding-bottom: 4px;">
              7.${subSecIndex} Preventive and Remedial Management for Fluoride Contamination
            </h4>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 20px 0 10px 0;">7.${subSecIndex}.1 Preventive Measures for Fluoride Contamination</h5>
            <p style="margin: 0 0 12px 0; text-align: justify; line-height: 1.6;">
              Fluoride contamination in groundwater is predominantly geogenic in origin and therefore cannot be completely eliminated. Nevertheless, appropriate groundwater management practices and source protection measures can substantially reduce fluoride exposure and ensure the availability of safe drinking water. Preventive measures are aimed at minimizing fluoride mobilization, protecting low-fluoride aquifers, and reducing the dependence on contaminated groundwater sources.
            </p>
            
            <ul style="margin: 0 0 20px 0; padding-left: 20px; line-height: 1.6; text-align: justify;">
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.1 Identification and Protection of Safe Aquifers:</strong> Comprehensive groundwater quality investigations should be undertaken to identify aquifers containing fluoride concentrations within the acceptable drinking water limits. Such aquifers should be prioritized for domestic water supply and protected from over-exploitation. Hydrogeological investigations should be carried out before developing new drinking water sources to ensure that groundwater abstraction is undertaken from low-fluoride zones.
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.2 Development of Alternative Drinking Water Sources:</strong> In fluoride-affected regions, alternative drinking water sources should be developed wherever feasible. Surface water reservoirs, perennial rivers, springs, and low-fluoride aquifers may be utilized as safe drinking water sources. In severely affected regions, multi-village piped water supply schemes based on treated surface water can provide a sustainable long-term solution.
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.3 Rainwater Harvesting and Artificial Groundwater Recharge:</strong> Rainwater harvesting and artificial recharge are effective measures for augmenting groundwater resources and improving groundwater quality. Recharge structures such as percolation tanks, recharge shafts, recharge wells, check dams, infiltration ponds, and rooftop rainwater harvesting systems facilitate dilution of fluoride-rich groundwater while increasing groundwater availability. These measures are particularly beneficial in hard rock terrains where natural recharge is limited.
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.4 Scientific Groundwater Development:</strong> Unregulated and excessive groundwater abstraction should be avoided in fluoride-prone areas. Declining groundwater levels increase groundwater residence time and enhance water-rock interaction, resulting in greater dissolution of fluoride-bearing minerals. Groundwater development should therefore be based on scientific hydrogeological investigations, aquifer mapping, and sustainable groundwater management principles.
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.5 Control of Anthropogenic Sources:</strong> Although natural geological processes are the dominant source of fluoride, anthropogenic inputs should also be minimized. Judicious use of phosphate fertilizers, proper disposal of industrial waste, and treatment of fluoride-bearing industrial effluents before discharge are essential to prevent localized groundwater contamination. Industries handling fluoride-bearing raw materials should adopt appropriate pollution control measures in accordance with environmental regulations.
              </li>
              <li style="margin-bottom: 8px;">
                <strong>7.${subSecIndex}.1.6 Regular Groundwater Quality Monitoring:</strong> A systematic groundwater quality monitoring programme should be implemented to monitor fluoride concentrations periodically. Seasonal monitoring helps identify emerging fluoride hotspots, assess temporal variations, and evaluate the effectiveness of mitigation measures. Monitoring data should be integrated with hydrogeological investigations to support evidence-based groundwater management and planning.
              </li>
              <li style="margin-bottom: 6px;">
                <strong>7.${subSecIndex}.1.7 Community Awareness and Health Surveillance:</strong> Community participation plays a crucial role in mitigating fluoride-related health risks. Awareness programmes should educate the public regarding the health effects of excessive fluoride intake, identification of safe drinking water sources, household defluoridation options, and the importance of avoiding prolonged consumption of fluoride-rich groundwater. Regular health surveillance programmes in fluoride-endemic regions can facilitate early diagnosis and management of dental and skeletal fluorosis.
              </li>
            </ul>
            <p style="margin: 10px 0 20px 0; text-align: justify; line-height: 1.6;">
              Preventive measures alone may not completely eliminate fluoride contamination in areas where groundwater naturally contains high fluoride concentrations. Therefore, these measures should be complemented by appropriate defluoridation technologies and safe water supply interventions to ensure long-term protection of public health.
            </p>

            <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin: 25px 0 10px 0;">7.${subSecIndex}.2 Remedial Measures for Fluoride Removal Technologies</h5>
            <p style="margin: 0 0 12px 0; text-align: justify; line-height: 1.6;">
              Fluoride contamination in groundwater is predominantly of geogenic origin and, therefore, complete prevention is generally not feasible. In areas where groundwater contains fluoride concentrations exceeding the permissible limit for drinking water, appropriate treatment measures become essential to safeguard public health. The remedial measures adopted for fluoride removal are predominantly ex-situ treatment technologies, in which groundwater is extracted and treated before consumption. Based on the treatment mechanism, fluoride removal technologies can be broadly classified into three categories:
            </p>

                      <div style="line-height: 1.6; text-align: justify;">
              <p style="margin: 0 0 12px 0;">
                <strong>7.${subSecIndex}.2.1 Adsorption and Ion-Exchange Processes:</strong> Adsorption is one of the most widely adopted and economically viable techniques for fluoride removal from drinking water. The process involves passing fluoride-contaminated water through a bed of adsorbent material, where fluoride ions are removed through surface adsorption, ion exchange, or surface chemical reactions.
                Numerous adsorbents have been investigated for fluoride removal, including: <em>Activated Alumina (AA), Bone Char, Bauxite, Hematite, Magnesia, Fly Ash, Limestone, Activated Carbon, Clay Minerals, Red Mud, Brick Pieces, Granular Ceramic Media, Mud Pot Filters, and Polymeric Anion-Exchange Resins</em>.
                Among these, <strong>Activated Alumina</strong> is the most extensively used adsorbent because of its high adsorption capacity, commercial availability, ease of operation, and cost-effectiveness. Once the adsorption sites become saturated, the media require regeneration using suitable alkaline and acidic solutions before reuse. Bone Char is also effective but may be limited because of social, cultural, and religious considerations. Anion-exchange resins selectively replace fluoride ions but are generally restricted by higher operational costs.
              </p>
              <p style="margin: 0 0 12px 0;">
                <strong>7.${subSecIndex}.2.2 Coagulation–Precipitation Processes:</strong> In this process, suitable coagulants are added to fluoride-contaminated water, resulting in the formation of insoluble aluminium or calcium hydroxide flocs that adsorb fluoride ions. The principal chemicals used include: <em>Aluminium Sulphate (Alum), Lime, Poly Aluminium Chloride (PAC), Poly Aluminium Hydroxy Sulphate (PAHS), and Brushite</em>.
              </p>
              <p style="background-color: #f1f5f9; padding: 10px; border-radius: 4px; margin: 10px 0 15px 0;">
                <strong>Nalgonda Technique:</strong> Developed by the National Environmental Engineering Research Institute (NEERI), India, this is one of the most widely accepted and cost-effective defluoridation technologies for rural and community water supply systems.
                The treatment process consists of the following sequential steps:
                (1) Addition of alum in the required dosage, (2) Addition of lime to maintain optimum pH, (3) Addition of bleaching powder for disinfection, (4) Rapid mixing, (5) Flocculation, (6) Sedimentation, (7) Filtration, and (8) Storage and distribution.
                It performs effectively when the raw water possesses fluoride concentration of 1.5–20 mg/L, TDS less than 1500 mg/L, and total hardness less than 600 mg/L.
              </p>
              <p style="margin: 0 0 0 0;">
                <strong>7.${subSecIndex}.2.3 Ionic Separation (Membrane) Processes:</strong> This includes Reverse Osmosis (RO), Nanofiltration (NF), Electrodialysis (ED), and Dialysis. Reverse Osmosis typically achieves fluoride removal efficiencies exceeding 90–95%. However, membrane-based systems are often constrained by high capital investment, elevated operating and maintenance costs, continuous energy requirements, membrane fouling, and disposal of concentrated reject water. In rural settings, simpler technologies such as adsorption and the Nalgonda Technique are often more practical.
              </p>
            </div>
          </div>
        `;
      }
    }

    // Devanagari Names map
    const paramNamesHindi: Record<string, string> = {
      "PH": "पीएच (pH)",
      "TDS": "कुल घुले हुए ठोस पदार्थ (TDS)",
      "TURBIDITY": "गंदलापन (Turbidity)",
      "ALKALINITY": "क्षारीयता (Alkalinity)",
      "TH": "कुल कठोरता (Total Hardness)",
      "EC": "विद्युत चालकता (Electrical Conductivity)",
      "CL": "क्लोराइड (Chloride)",
      "NO3": "नाइट्रेट (Nitrate)",
      "F": "फ्लोराइड (Fluoride)",
      "CA": "कैल्शियम (Calcium)",
      "MG": "मैग्नीशियम (Magnesium)",
      "SO4": "सल्फेट (Sulfate)",
      "FE": "आयरन / लोहा (Iron)",
      "AS": "आर्सेनिक (Arsenic)",
      "U": "यूरेनियम (Uranium)",
      "ZN": "जस्ता (Zinc)",
      "CU": "तांबा (Copper)",
      "PB": "सीसा (Lead)",
      "CD": "कैडमियम (Cadmium)",
      "CR": "क्रोमियम (Chromium)",
      "HG": "पारा (Mercury)",
      "NI": "निकल (Nickel)",
      "SE": "सेलेनियम (Selenium)",
      "MN": "मैंगनीज (Manganese)",
      "AL": "एल्युमिनियम (Aluminum)",
      "BA": "बेरियम (Barium)",
      "B": "बोरोन (Boron)",
      "MO": "मोलिब्डेनम (Molybdenum)"
    };
    const paramNameHindi = paramNamesHindi[key] || paramName;

    let preventive = "";
    let remedial = "";
    
    if (false) {
      if (key === "EC") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">मिट्टी में लवणता के संचय को कम करने के लिए सिंचाई जल के अनुप्रयोगों को कुशलतापूर्वक प्रबंधित करें।</li>
            <li style="margin-bottom: 5px;">तटीय क्षेत्रों में समुद्र के खारे पानी के प्रवेश को रोकने के लिए भूजल निकासी पर कड़ा नियंत्रण रखें।</li>
            <li style="margin-bottom: 5px;">वास्तविक समय में लवणता और चालकता की निगरानी के लिए एक सघन नेटवर्क स्थापित करें।</li>
            <li style="margin-bottom: 5px;">मानसून के मौसम में उथले ताजे पानी के क्षेत्रों को कृत्रिम रूप से रिचार्ज करें।</li>
            <li style="margin-bottom: 5px;">लवण-सहिष्णु फसलों की खेती और अनुकूलित फसल चक्र को बढ़ावा दें।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">अत्यधिक विद्युत चालकता (EC) वाले हॉटस्पॉट्स में रिवर्स ऑस्मोसिस (RO) या इलेक्ट्रोडायलिसिस संयंत्र स्थापित करें।</li>
            <li style="margin-bottom: 5px;">मिट्टी से संचित लवणों को बाहर निकालने के लिए उप-सतही जल निकासी प्रणालियों का निर्माण करें।</li>
            <li style="margin-bottom: 5px;">मिट्टी के क्षारीय और लवणीय प्रभावों को संतुलित करने के लिए जिप्सम या तत्वीय गंधक जैसे रसायनों का उपयोग करें।</li>
            <li style="margin-bottom: 5px;">खारे भूजल को वर्षा जल या ताजे सतही जल के साथ मिलाकर उपयोग में लाएं।</li>
            <li style="margin-bottom: 5px;">लवणता की सघनता को कम करने के लिए कृत्रिम गतिशील पुनर्भरण (Recharge) प्रणालियों को लागू करें।</li>
          </ul>
        `;
      } else if (key === "F" || key === "FLUORIDE") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">उच्च फ्लोराइड वाले भू-वैज्ञानिक क्षेत्रों की पहचान करें और इन कुओं को लाल या चेतावनी रंग से चिह्नित करें।</li>
            <li style="margin-bottom: 5px;">वैकल्पिक पेय जल स्रोतों के रूप में घरेलू और क्षेत्रीय स्तर पर वर्षा जल संचयन को बढ़ावा दें।</li>
            <li style="margin-bottom: 5px;">दंत और कंकाल फ्लोरोसिस के जोखिमों के बारे में स्थानीय समुदायों में जागरूकता उत्पन्न करें।</li>
            <li style="margin-bottom: 5px;">उच्च फ्लोराइड वाले भूजल को कम फ्लोराइड वाले सतही स्रोतों के साथ मिलाकर उसका प्रभाव कम करें।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">सामुदायिक जल आपूर्ति कुओं के लिए एलम और चूना आधारित 'नालगोंडा' फ्लोराइड निष्कासन संयंत्र स्थापित करें।</li>
            <li style="margin-bottom: 5px;">सक्रिय एल्युमिना (Activated Alumina) फिल्टर या बोन चार फिल्टर इकाइयां स्थापित करें।</li>
            <li style="margin-bottom: 5px;">घरेलू उपयोग के लिए रिवर्स ऑस्मोसिस (RO) और आयन एक्सचेंज निस्पंदन प्रणालियों को तैनात करें।</li>
            <li style="margin-bottom: 5px;">शरीर में फ्लोराइड के अवशोषण को कम करने के लिए कैल्शियम और विटामिन-सी से भरपूर आहार सप्लीमेंट को बढ़ावा दें।</li>
          </ul>
        `;
      } else if (key === "NO3" || key === "NITRATE") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">घरेलू कुओं से सेप्टिक प्रणालियों की पर्याप्त दूरी सुनिश्चित करने के लिए स्थानीय दूरी नियमों को सख्ती से लागू करें।</li>
            <li style="margin-bottom: 5px;">जैविक खेती को बढ़ावा दें और कृषि क्षेत्रों में रासायनिक नाइट्रोजन उर्वरकों के उपयोग को अनुकूलित करें।</li>
            <li style="margin-bottom: 5px;">सतही प्रदूषित जल के रिसाव को रोकने के लिए पेयजल कुओं के आसपास कंक्रीट प्लेटफॉर्म और सील का निर्माण करें।</li>
            <li style="margin-bottom: 5px;">कुओं के पास मवेशी घरों या कचरा डंपिंग स्थलों के निर्माण से बचें।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">नाइट्रेट-विशिष्ट रेजिन का उपयोग करने वाले सामुदायिक आयन एक्सचेंज संयंत्र स्थापित करें।</li>
            <li style="margin-bottom: 5px;">पीने और खाना पकाने की आवश्यकताओं के लिए घरेलू रिवर्स ऑस्मोसिस (RO) फिल्टर तैनात करें।</li>
            <li style="margin-bottom: 5px;">औद्योगिक या बड़े नगरपालिका अपशिष्ट स्रोतों के लिए जैविक विनाइट्रीकरण (Biological Denitrification) प्रणालियों का उपयोग करें।</li>
            <li style="margin-bottom: 5px;">शिशुओं और गर्भवती महिलाओं के लिए वैकल्पिक सुरक्षित पेयजल या पाइप जलापूर्ति की व्यवस्था करें।</li>
          </ul>
        `;
      } else if (key === "AS" || key === "ARSENIC") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">आर्सेनिक संदूषित जलभृतों का मानचित्रण करें और सुरक्षित गहरे जलभृतों से जल खींचने के लिए कड़े कुआं गहराई नियम लागू करें।</li>
            <li style="margin-bottom: 5px;">रंग-कोडित कुओं के माध्यम से आर्सेनिक सुरक्षा स्तरों के प्रति जनता में व्यापक जागरूकता अभियान चलाएं।</li>
            <li style="margin-bottom: 5px;">सतही जल उपचार और वर्षा जल संचयन को प्राथमिक वैकल्पिक पेयजल के रूप में प्रोत्साहित करें।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">लोहे और एलम लवणों का उपयोग करने वाले घरेलू और सामुदायिक स्तर पर सह-अवक्षेपण फिल्टर प्रदान करें।</li>
            <li style="margin-bottom: 5px;">कुओं के लिए सक्रिय एल्युमिना या आयरन ऑक्साइड-लेपित रेत फिल्टर इकाइयां स्थापित करें।</li>
            <li style="margin-bottom: 5px;">उच्च जोखिम वाले परिवारों के लिए रिवर्स ऑस्मोसिस (RO) या आयन एक्सचेंज प्रणालियों को तैनात करें।</li>
            <li style="margin-bottom: 5px;">आर्सेनिक के चयापचय को तेज करने के लिए एंटीऑक्सीडेंट से भरपूर आहार संशोधनों को बढ़ावा दें।</li>
          </ul>
        `;
      } else if (key === "U" || key === "URANIUM") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">ग्रेनाइट चट्टानों वाले या अत्यधिक फॉस्फेट उर्वरक उपयोग वाले क्षेत्रों में भूजल निष्कर्षण को ट्रैक और नियंत्रित करें।</li>
            <li style="margin-bottom: 5px;">यूरेनियम की गतिशीलता को रोकने के लिए कृषि फॉस्फेट के उपयोग और कचरे के डंपिंग को विनियमित करें।</li>
            <li style="margin-bottom: 5px;">उच्च यूरेनियम प्रभावित क्षेत्रों में अनुपचारित भूजल के सीधे सेवन के विरुद्ध सार्वजनिक चेतावनी संकेत लगाएं।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">पीने के पानी के कुओं के लिए रिवर्स ऑस्मोसिस (RO) झिल्ली या यूरेनियम-विशिष्ट आयन-एक्सचेंज फिल्टर सिस्टम स्थापित करें।</li>
            <li style="margin-bottom: 5px;">शून्य-संयोजक आयरन बैरियर या रासायनिक अवक्षेपण विधियों का उपयोग करें।</li>
            <li style="margin-bottom: 5px;">उच्च जोखिम वाले समुदायों के लिए सुरक्षित स्रोतों से साफ पाइपयुक्त या बोतलबंद पानी उपलब्ध कराएं।</li>
          </ul>
        `;
      } else if (key === "FE" || key === "IRON") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">खनन गतिविधियों, औद्योगिक विसर्जन और लोहे की वितरण पाइपलाइनों के जंग से होने वाले संदूषण को रोकें।</li>
            <li style="margin-bottom: 5px;">भूजल पुनर्भरण को बढ़ावा दें जहाँ हाइड्रोजियोलॉजिकल स्थितियाँ अनुकूल हों ताकि वातन (Aeration) हो सके।</li>
            <li style="margin-bottom: 5px;">कुओं के पास सुरक्षात्मक कंक्रीट सील और स्वच्छता बनाए रखें।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">लोहा निकालने के लिए वातन (Aeration) और रैपिड सैंड फिल्ट्रेशन प्रणाली स्थापित करें।</li>
            <li style="margin-bottom: 5px;">क्लोरीन, पोटेशियम परमैंगनेट, या ओजोन जैसी ऑक्सीकरण विधियों का उपयोग करें।</li>
            <li style="margin-bottom: 5px;">लोहा निकालने के लिए मैंगनीज ग्रीनसैंड या कैटेलिटिक फिल्टर का उपयोग करें।</li>
            <li style="margin-bottom: 5px;">संक्षारित लोहे की पाइपलाइनों को बदलें जो पानी में लोहे के स्तर को बढ़ाती हैं।</li>
          </ul>
        `;
      } else if (key === "PH") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">अम्लीय/क्षारीय औद्योगिक अपशिष्टों के विसर्जन को नियंत्रित करें और कृषि रसायनों की निगरानी करें।</li>
            <li style="margin-bottom: 5px;">अम्लीय रिसाव प्रवण क्षेत्रों और अत्यधिक क्षारीय मिट्टी वाले क्षेत्रों का कड़ा मानचित्रण करें।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">सोडियम कार्बोनेट, चूना पत्थर, या सोडा ऐश का उपयोग करके रासायनिक तटस्थीकरण प्रणाली स्थापित करें।</li>
            <li style="margin-bottom: 5px;">अम्लीय पानी को कैल्साइट या मैग्नीशियम ऑक्साइड न्यूट्रलाइजिंग फिल्टर से गुजारें।</li>
            <li style="margin-bottom: 5px;">अत्यधिक अम्लीय या क्षारीय पानी को तटस्थ सतही जल के साथ मिलाकर उपचारित करें।</li>
          </ul>
        `;
      } else if (key === "TDS") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">उच्च खनिज लवणों वाले घरेलू और कृषि अपशिष्ट जल के सीधे बहाव को नियंत्रित करें।</li>
            <li style="margin-bottom: 5px;">गहरे खारे जलभृतों के ऊपर की ओर रिसाव को रोकने के लिए भूजल निष्कर्षण को हमेशा संतुलित रखें।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">घरेलू और सामुदायिक पीने के पानी के लिए रिवर्स ऑस्मोसिस (RO) झिल्ली शुद्धिकरण इकाइयां स्थापित करें।</li>
            <li style="margin-bottom: 5px;">सौर आसवन (Solar Distillation) प्रणालियों या इलेक्ट्रोडायलिसिस का उपयोग करें।</li>
            <li style="margin-bottom: 5px;">खनिज समृद्ध भूजल को ताजे जल स्रोतों के साथ मिलाकर समग्र लवणता कम करें।</li>
          </ul>
        `;
      } else if (key === "TH" || key === "HARDNESS") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">कठोर रॉक कार्बोनेट क्षेत्रों में वर्षा जल संचयन के माध्यम से भूजल के संदूषण को कम करें।</li>
            <li style="margin-bottom: 5px;">कम कठोरता वाले वर्षा अपवाह का उपयोग करके जलभृत रिचार्ज को बढ़ावा दें।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">घरेलू जल प्रणालियों के लिए सोडियम धनायन-विनिमय (Sodium Cation-Exchange) वाटर सॉफ्टनर लागू करें।</li>
            <li style="margin-bottom: 5px;">सामुदायिक स्तर पर चूना-सोडा ऐश उपचार का उपयोग करके रासायनिक अवक्षेपण करें।</li>
            <li style="margin-bottom: 5px;">कैल्शियम और मैग्नीशियम आयनों को निकालने के लिए घरेलू रिवर्स ऑस्मोसिस (RO) फिल्ट्रेशन का उपयोग करें।</li>
          </ul>
        `;
      } else {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">आसपास के औद्योगिक कचरे, सीवर लाइनों और कृषि कचरे के जमाव की बारीकी से निगरानी करें।</li>
            <li style="margin-bottom: 5px;">सतही जल के कुएं में प्रवेश को रोकने के लिए कंक्रीट सुरक्षा दीवार का निर्माण करें।</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">बहु-स्तरीय झिल्ली निस्पंदन प्रणाली (RO/NF) स्थापित करें।</li>
            <li style="margin-bottom: 5px;">घरेलू स्तर पर सक्रिय कार्बन और तलछट निस्पंदन प्रणालियों को तैनात करें।</li>
          </ul>
        `;
      }
    } else {
      if (key === "EC") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Manage irrigation water applications to minimize over-watering and drainage salinity buildup.</li>
            <li style="margin-bottom: 5px;">Restrict groundwater withdrawal in coastal regions to prevent seawater intrusion.</li>
            <li style="margin-bottom: 5px;">Establish a comprehensive, dense monitoring network for real-time salinity tracking.</li>
            <li style="margin-bottom: 5px;">Recharge shallow freshwater zones dynamically during monsoon seasons.</li>
            <li style="margin-bottom: 5px;">Implement salt-tolerant crops and customized crop rotation routines.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Install Reverse Osmosis (RO) plants or electrodialysis systems in high-EC hotspots.</li>
            <li style="margin-bottom: 5px;">Construct subsurface drainage systems to leach accumulated salts away from soils.</li>
            <li style="margin-bottom: 5px;">Apply chemical soil amendments (gypsum, elemental sulfur) to balance sodic effects.</li>
            <li style="margin-bottom: 5px;">Blend high-EC saline groundwater with safe, harvested rainwater where feasible.</li>
            <li style="margin-bottom: 5px;">Introduce artificial dynamic recharge to dilute aquifer salt concentrations.</li>
          </ul>
        `;
      } else if (key === "F" || key === "FLUORIDE") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Identify fluoride-enriched geogenic zones and demarcate wells with high safety markings.</li>
            <li style="margin-bottom: 5px;">Encourage domestic and regional rainwater harvesting to bypass shallow groundwater use.</li>
            <li style="margin-bottom: 5px;">Educate vulnerable communities on the risks of dental and skeletal fluorosis.</li>
            <li style="margin-bottom: 5px;">Dilute high-fluoride groundwater with low-fluoride surface sources or monsoonal pools.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Construct Nalgonda de-fluoridation plants employing alum and lime treatment.</li>
            <li style="margin-bottom: 5px;">Install activated alumina filtration or bone char filters for community water supply wells.</li>
            <li style="margin-bottom: 5px;">Implement reverse osmosis and ion exchange technology for small-scale household units.</li>
            <li style="margin-bottom: 5px;">Provide calcium-rich dietary supplements to lower systemic fluoride absorption.</li>
          </ul>
        `;
      } else if (key === "NO3" || key === "NITRATE") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Enforce strict spatial regulations on septic system locations relative to domestic wells.</li>
            <li style="margin-bottom: 5px;">Promote organic farming practices and optimize synthetic nitrogen fertilizer usage rates.</li>
            <li style="margin-bottom: 5px;">Construct sanitary concrete seals on all water wells to stop superficial waste infiltration.</li>
            <li style="margin-bottom: 5px;">Avoid cattle pen locations directly adjacent to drinking groundwater extraction wells.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Utilize ion exchange plants with nitrate-selective anion resins.</li>
            <li style="margin-bottom: 5px;">Install small-scale household reverse osmosis filters for drinking and cooking needs.</li>
            <li style="margin-bottom: 5px;">Conduct biological denitrification treatments for municipal or large industrial sources.</li>
            <li style="margin-bottom: 5px;">Provide clean alternative water supplies (bottled/piped water) for infants and pregnant women.</li>
          </ul>
        `;
      } else if (key === "AS" || key === "ARSENIC") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Map toxic geogenic aquifers and establish strict well casing depths to draw from safe deep aquifers.</li>
            <li style="margin-bottom: 5px;">Implement public awareness campaigns using color-coded wells to indicate safety levels.</li>
            <li style="margin-bottom: 5px;">Encourage surface water treatments and monsoonal storage as drinking alternatives.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Provide domestic and community-scale co-precipitation filters using iron and alum salts.</li>
            <li style="margin-bottom: 5px;">Install activated alumina or iron oxide-coated sand filter packages for wells.</li>
            <li style="margin-bottom: 5px;">Deploy reverse osmosis systems or ion-exchange resins for high-risk households.</li>
            <li style="margin-bottom: 5px;">Promote dietary modifications with anti-oxidants to accelerate arsenic metabolism.</li>
          </ul>
        `;
      } else if (key === "U" || key === "URANIUM") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Track and control groundwater extraction in granitic terrains or zones with intensive phosphate fertilizing.</li>
            <li style="margin-bottom: 5px;">Regulate toxic waste dumps and agricultural phosphates to prevent uranium mobilization.</li>
            <li style="margin-bottom: 5px;">Provide public signage warning against untreated consumption in uranium-rich regions.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Install reverse osmosis membranes or uranium-specific anion-exchange filtration systems for drinking wells.</li>
            <li style="margin-bottom: 5px;">Use zero-valent iron barrier remediation or chemical precipitation methods.</li>
            <li style="margin-bottom: 5px;">Provide bottled water or piped water from clean sources for high-risk communities.</li>
          </ul>
        `;
      } else if (key === "FE" || key === "IRON") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Prevent contamination from mining activities, industrial discharges, and rust of iron infrastructure.</li>
            <li style="margin-bottom: 5px;">Promote groundwater recharge with highly aerated freshwater where hydrogeologically feasible.</li>
            <li style="margin-bottom: 5px;">Maintain well casing integrity and secure sanitary protection around all water wells.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Install iron removal filters employing aeration followed by rapid sand filtration.</li>
            <li style="margin-bottom: 5px;">Use oxidation methods (chlorine, potassium permanganate, or ozone) followed by filtration.</li>
            <li style="margin-bottom: 5px;">Employ manganese greensand or catalytic filters for highly efficient iron extraction.</li>
            <li style="margin-bottom: 5px;">Replace corroded steel pipes contributing to elevated iron concentrations.</li>
          </ul>
        `;
      } else if (key === "PH") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Regulate acidic/basic industrial waste discharges and monitor agricultural chemicals.</li>
            <li style="margin-bottom: 5px;">Map areas prone to acidic leachate from mines or alkaline soils to control well locations.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Install chemical neutralization systems using sodium carbonate, limestone, or soda ash.</li>
            <li style="margin-bottom: 5px;">Pass acidic water through calcite or magnesium oxide neutralizing filters.</li>
            <li style="margin-bottom: 5px;">Blend excessively acidic or basic water with neutral surface streams.</li>
          </ul>
        `;
      } else if (key === "TDS") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Control domestic and agricultural wastewater runoff containing high mineral salts.</li>
            <li style="margin-bottom: 5px;">Optimize dynamic groundwater extraction to prevent upward leakage of deeper high-saline aquifers.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Install reverse osmosis (RO) membrane purification units.</li>
            <li style="margin-bottom: 5px;">Utilize electrodialysis or solar distillation systems for residential drinking.</li>
            <li style="margin-bottom: 5px;">Blend mineral-rich groundwater with freshwater recharge pools.</li>
          </ul>
        `;
      } else if (key === "TH" || key === "HARDNESS") {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Ensure adequate rainwater dilution of groundwater in hard-rock carbonate terrains.</li>
            <li style="margin-bottom: 5px;">Promote managed aquifer recharge using low-hardness storm runoffs.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Implement sodium cation-exchange water softeners for domestic water systems.</li>
            <li style="margin-bottom: 5px;">Perform chemical precipitation using lime-soda ash softening on a larger community scale.</li>
            <li style="margin-bottom: 5px;">Apply household reverse osmosis filtration to extract magnesium and calcium ions.</li>
          </ul>
        `;
      } else {
        preventive = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Strictly monitor nearby industrial effluents, municipal sewers, and agricultural dumps.</li>
            <li style="margin-bottom: 5px;">Enforce sanitary sealing of drinking wells to block superficial water runoff.</li>
          </ul>
        `;
        remedial = `
          <ul style="margin: 0; padding-left: 15px;">
            <li style="margin-bottom: 5px;">Install multi-stage membrane filtration systems (RO/NF).</li>
            <li style="margin-bottom: 5px;">Implement household-level activated carbon and sediment filtration packages.</li>
          </ul>
        `;
      }
    }

    return `
      <div style="margin-top: 25px; page-break-inside: avoid; border-top: 1px solid #cbd5e1; padding-top: 15px; margin-bottom: 25px;">
        <h5 style="font-size: 11.5pt; font-weight: bold; color: #1e3a8a; margin-bottom: 12px; font-family: 'Times New Roman', Times, serif;">
          Preventive and Remedial Management for ${paramName} (${configKey})
        </h5>
        
        <div style="margin-bottom: 12px; text-align: justify;">
          <p style="font-weight: bold; color: #1e293b; margin: 0 0 6px 0; font-size: 11pt; font-family: 'Times New Roman', Times, serif;">
            A. Preventive Measures:
          </p>
          <div style="font-size: 11pt; color: #334155; line-height: 1.6; font-family: 'Times New Roman', Times, serif; padding-left: 5px;">
            ${preventive}
          </div>
        </div>

        <div style="margin-bottom: 12px; text-align: justify;">
          <p style="font-weight: bold; color: #1e293b; margin: 0 0 6px 0; font-size: 11pt; font-family: 'Times New Roman', Times, serif;">
            B. Remedial Measures:
          </p>
          <div style="font-size: 11pt; color: #334155; line-height: 1.6; font-family: 'Times New Roman', Times, serif; padding-left: 5px;">
            ${remedial}
          </div>
        </div>
      </div>
    `;
  };

  const handleGenerateBulletin = async (overrideScopeInput?: string | React.MouseEvent<HTMLButtonElement>) => {
    const overrideScope = typeof overrideScopeInput === "string" ? overrideScopeInput : undefined;

    if (!rawData || !rawData.length || !selectedBulletinParams || selectedBulletinParams.length === 0) {
      setErrorMessage("No dataset selected or no parameter columns selected for analysis.");
      return "";
    }

    // Shadow state bulletinScope locally inside this function if override is provided
    const bulletinScope = overrideScope || bulletinScopeRef.current;

    if (!overrideScope) {
      setErrorMessage(null);
      setIsGenerating(true);
      setGenerationProgress("Compiling basic hydrochemical statistics and cylinder graphs...");
    }
    await new Promise((resolve) => setTimeout(resolve, 150)); // let UI spin lock

    try {
      const formatChemicalFormula = (formula: string): string => {
        const mapping: Record<string, string> = {
          "NO3": "NO<sub>3</sub><sup>-</sup>",
          "F": "F<sup>-</sup>",
          "Cl": "Cl<sup>-</sup>",
          "Ca": "Ca<sup>2+</sup>",
          "Mg": "Mg<sup>2+</sup>",
          "Na": "Na<sup>+</sup>",
          "K": "K<sup>+</sup>",
          "HCO3": "HCO<sub>3</sub><sup>-</sup>",
          "CO3": "CO<sub>3</sub><sup>2-</sup>",
          "SO4": "SO<sub>4</sub><sup>2-</sup>",
          "Fe": "Fe",
          "As": "As",
          "U": "U",
          "Zn": "Zn",
          "Cu": "Cu",
          "Pb": "Pb",
          "Cd": "Cd",
          "Cr": "Cr",
          "Hg": "Hg",
          "Ni": "Ni",
          "Se": "Se",
          "Mn": "Mn",
          "Al": "Al",
          "Ba": "Ba",
          "B": "B",
          "Mo": "Mo",
          "NH4": "NH<sub>4</sub><sup>+</sup>",
          "PO4": "PO<sub>4</sub><sup>3-</sup>"
        };
        return mapping[formula] || formula;
      };

      const latestCompiledMaps: Record<string, string> = {};
      const isHindi = false;
      let filteredData = rawData;
      let titleRegion = "India";
      let breakdownLevel: "State" | "District" = "State";

      if (bulletinScope !== "National") {
        titleRegion = toProperCase(bulletinScope);
        breakdownLevel = "District";
        filteredData = filteredData.filter(
          (d) => String(d[(headers && headers.state) || ""] || "").trim() === bulletinScope
        );
      }

      let mainReportData = filteredData;
      const preKeywords = ["pre", "before", "kharif"];
      const seasonKey = headers?.season;
      if (seasonKey) {
        const preMonsoonRows = filteredData.filter((d) => {
          const s = String(d[seasonKey] || "").toLowerCase();
          return preKeywords.some((kw) => s.includes(kw));
        });
        if (preMonsoonRows.length > 0) {
          mainReportData = preMonsoonRows;
        }
      }
      filteredData = mainReportData;

      const totalSamples = mainReportData.length;
      if (totalSamples === 0) {
        if (!overrideScope) {
          setErrorMessage(`No groundwater samples found matching style region '${bulletinScope}'. Please verify your data filters.`);
          setIsGenerating(false);
        }
        return "";
      }

      const basicParamsList = ["pH", "TDS", "Turbidity", "Alkalinity", "TH", "EC", "Cl", "NO3", "F", "Ca", "Mg", "SO4"];
      const heavyMetalsList = ["Fe", "As", "U", "Zn", "Cu", "Pb", "Cd", "Cr", "Hg", "Ni", "Se", "Mn", "Al", "Ba", "B", "Mo"];

      let basicSummaryListHTML = "";
      let heavySummaryListHTML = "";
      const basicChartDataSeries: any[] = [];
      const heavyChartDataSeries: any[] = [];
      const selectedBasicNames: string[] = [];
      const selectedHeavyNames: string[] = [];

      selectedBulletinParams.forEach((paramName) => {
        const configKey = headerMap[paramName];
        if (!configKey) return;

        const stats = getBulletinStats(configKey, mainReportData);
        const chartDataPoint = { name: configKey, y: parseFloat(stats.pct) };
        const listItem = `<li style="margin-bottom: 8px;"><strong>${PARAM_CONFIG[configKey]?.name || paramName} (${formatChemicalFormula(configKey)})</strong> was found above the permissible limit in <strong>${stats.pct}%</strong> of samples.</li>`;

        if (heavyMetalsList.includes(configKey)) {
          heavyChartDataSeries.push(chartDataPoint);
          heavySummaryListHTML += listItem;
          selectedHeavyNames.push(`${PARAM_CONFIG[configKey]?.name} (${formatChemicalFormula(configKey)})`);
        } else if (basicParamsList.includes(configKey)) {
          basicChartDataSeries.push(chartDataPoint);
          basicSummaryListHTML += listItem;
          selectedBasicNames.push(`${PARAM_CONFIG[configKey]?.name} (${formatChemicalFormula(configKey)})`);
        }
      });

      // 1. Generate cylinder/column chart image base64 directly
      const cylinderTitle = `Beyond Permissible Limit(BIS,10500)<br>${bulletinSeason}(n=${totalSamples})`;
      const buildCylinderOptions = (title: string, dataPoints: any[]): Highcharts.Options => {
        const validValues = dataPoints.map((d) => isNaN(d.y) ? 0 : d.y);
        const calculatedMax = (validValues.length > 0 ? Math.max(...validValues, 5) : 5) * 1.3;
        
        return {
          chart: {
            type: "cylinder",
            options3d: {
              enabled: true,
              alpha: 5,
              beta: 15,
              depth: 60,
              viewDistance: 25,
              frame: { bottom: { size: 10, color: "#e0e0e0" } },
            },
            backgroundColor: "transparent",
            plotBackgroundColor: "transparent",
            margin: [100, 50, 80, 50],
          },
          title: {
            text: title,
            style: { fontSize: "12pt", fontWeight: "bold", color: "#1e3a8a", fontFamily: "'Times New Roman', Times, serif" },
            y: 40,
          },
          xAxis: {
            categories: dataPoints.map((d) => d.name),
            labels: { style: { fontSize: "12pt", fontWeight: "bold", color: "#1e3a8a", fontFamily: "'Times New Roman', Times, serif" }, y: 35 },
            lineWidth: 0,
            tickWidth: 0,
          },
          yAxis: {
            title: { text: "" },
            labels: { enabled: false },
            gridLineWidth: 0,
            max: calculatedMax,
          },
          plotOptions: {
            cylinder: {
              depth: 45,
              color: "#4cb7e3",
              dataLabels: {
                enabled: true,
                format: "{y:.2f}%",
                style: { color: "#dc2626", fontSize: "12pt", textOutline: "none", fontWeight: "bold", fontFamily: "'Times New Roman', Times, serif" },
                crop: false,
                overflow: "allow",
              },
            },
          },
          series: [
            {
              type: "cylinder",
              name: "Exceedance %",
              data: dataPoints.map((d) => isNaN(d.y) ? 0 : d.y),
              showInLegend: false,
            }
          ],
          credits: { enabled: false },
        };
      };

      // --- Helper: Dynamic Impact of Monsoon ---
      const getMonsoonImpactAnalysis = (
        configKey: string,
        paramName: string,
        rawData: any[],
        headers: DataHeaders,
        headerMap: Record<string, string>,
        bulletinScope: string,
        isHindi: boolean,
        tableNum: number
      ) => {
        const isNational = bulletinScope === "National";
        const scopeData = isNational
          ? rawData
          : rawData.filter((row) => {
              if (!headers.state) return true;
              return String(row[headers.state] || "").trim().toUpperCase() === bulletinScope.toUpperCase();
            });

        // 1. Find unique periods
        const uniquePeriods = new Set<string>();
        scopeData.forEach((row) => {
          const y = headers.year ? String(row[headers.year] || "").trim() : "";
          const s = headers.season ? String(row[headers.season] || "").trim() : "";
          const period = (y && s) ? `${y} | ${s}` : (y || s);
          if (period) uniquePeriods.add(period);
        });

        const periodList = Array.from(uniquePeriods);

        // 2. Identify Pre and Post monsoon periods
        let prePeriod = "";
        let postPeriod = "";

        const preKeywords = ["pre", "before", "kharif"];
        const postKeywords = ["post", "after", "rabi"];

        prePeriod = periodList.find((p) => 
          preKeywords.some((kw) => p.toLowerCase().includes(kw))
        ) || "";

        postPeriod = periodList.find((p) => 
          postKeywords.some((kw) => p.toLowerCase().includes(kw))
        ) || "";

        if (!prePeriod || !postPeriod) {
          if (periodList.length >= 2) {
            prePeriod = periodList[0];
            postPeriod = periodList[1];
          } else {
            return {
              html: `<p style="text-align: justify; line-height: 1.6; color: #64748b; font-style: italic;">
                       Dynamic Monsoon Impact analysis requires both Pre-Monsoon and Post-Monsoon data to be uploaded. 
                       Please ensure your dataset includes both seasons with matching location identifiers.
                     </p>`,
              hasData: false
            };
          }
        }

        // 3. Perform pairing (Smart auto-fallback: choosing the pairing logic that yields more paired stations)
        const mappedHeader = Object.keys(headerMap).find((k) => headerMap[k] === configKey) || configKey;

        const testPairing = (logic: "well_id" | "location") => {
          const baseRecordsMap: Record<string, any> = {};
          const compRecordsMap: Record<string, any> = {};

          scopeData.forEach((row) => {
            const y = headers.year ? String(row[headers.year] || "").trim() : "";
            const s = headers.season ? String(row[headers.season] || "").trim() : "";
            const period = (y && s) ? `${y} | ${s}` : (y || s);

            let key = "";
            if (logic === "well_id" && headers.wellId && row[headers.wellId]) {
              key = String(row[headers.wellId]).trim().toUpperCase();
            } else {
              const stateVal = String(row[headers.state || "State"] || "").trim();
              const distVal = String(row[headers.district || "District"] || "").trim();
              const blockVal = String(row[headers.block || "Block"] || "").trim();
              const locVal = String(row[headers.location || "Location"] || "").trim();
              key = `${stateVal}|${distVal}|${blockVal}|${locVal}`.toUpperCase();
            }

            if (!key) return;

            if (period === prePeriod) {
              baseRecordsMap[key] = row;
            } else if (period === postPeriod) {
              compRecordsMap[key] = row;
            }
          });

          const list: any[] = [];
          const keys = new Set([...Object.keys(baseRecordsMap), ...Object.keys(compRecordsMap)]);

          keys.forEach((key) => {
            const preRow = baseRecordsMap[key];
            const postRow = compRecordsMap[key];

            if (preRow && postRow) {
              const state = String(preRow[headers.state || ""] || "Unknown").trim();
              const district = String(preRow[headers.district || ""] || "Unknown").trim();
              const block = String(preRow[headers.block || ""] || "Unknown").trim();
              const loc = String(preRow[headers.location || ""] || "Unknown").trim();
              
              const preVal = parseFloat(preRow[mappedHeader]);
              const postVal = parseFloat(postRow[mappedHeader]);

              if (!isNaN(preVal) && !isNaN(postVal)) {
                list.push({
                  key,
                  state,
                  district,
                  block,
                  location: loc,
                  preVal,
                  postVal
                });
              }
            }
          });

          return list;
        };

        let pairedList = testPairing("well_id");
        if (pairedList.length === 0 && headers.wellId) {
          pairedList = testPairing("location");
        } else if (headers.wellId) {
          const locPaired = testPairing("location");
          if (locPaired.length > pairedList.length) {
            pairedList = locPaired;
          }
        }

        if (pairedList.length === 0) {
          return {
            html: `<p style="text-align: justify; line-height: 1.6; color: #64748b; font-style: italic;">
                     No matching paired monitoring stations (matching Well ID or Location) were found between the ${prePeriod} and ${postPeriod} datasets. 
                     Please verify Well ID alignment or location coordinates.
                   </p>`,
            hasData: false
          };
        }

        const groupKey = isNational ? "state" : "district";
        const groupNoun = isNational ? "State/UT" : "District";
        const groupNounPlural = isNational ? "States/UTs" : "Districts";

        // Group data
        const groups: Record<string, {
          name: string;
          analyzed: number;
          improved: number;
          deteriorated: number;
          unchanged: number;
          shiftedSafeToUnsafe: number;
          shiftedUnsafeToSafe: number;
        }> = {};

        const isSafe = (val: number) => {
          const config = PARAM_CONFIG[configKey];
          if (!config) return true;
          if (configKey === "pH") {
            return val >= config.b1 && val <= config.b2;
          }
          const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
          const limit = isSingleLimit ? config.b1 : config.b2;
          return val <= limit;
        };

        pairedList.forEach((item) => {
          const gName = item[groupKey] || "Unknown";
          if (gName === "Unknown") return;

          if (!groups[gName]) {
            groups[gName] = {
              name: gName,
              analyzed: 0,
              improved: 0,
              deteriorated: 0,
              unchanged: 0,
              shiftedSafeToUnsafe: 0,
              shiftedUnsafeToSafe: 0
            };
          }

          const g = groups[gName];
          g.analyzed++;

          const preVal = item.preVal;
          const postVal = item.postVal;

          const isPreSafe = isSafe(preVal);
          const isPostSafe = isSafe(postVal);

          if (isPreSafe && !isPostSafe) {
            g.shiftedSafeToUnsafe++;
          } else if (!isPreSafe && isPostSafe) {
            g.shiftedUnsafeToSafe++;
          }

          if (preVal === 0) {
            if (postVal === 0) {
              g.unchanged++;
            } else {
              g.deteriorated++;
            }
          } else {
            const pct = ((postVal - preVal) / preVal) * 100;
            if (pct < -20) {
              g.improved++;
            } else if (pct > 20) {
              g.deteriorated++;
            } else {
              g.unchanged++;
            }
          }
        });

        const groupList = Object.values(groups).filter(g => g.analyzed > 0);
        if (groupList.length === 0) {
          return {
            html: `<p style="text-align: justify; line-height: 1.6; color: #64748b; font-style: italic;">
                     No regional data group could be compiled.
                   </p>`,
            hasData: false
          };
        }

        // Calculate overall totals
        const totalSamples = pairedList.length;
        const totalImproved = pairedList.reduce((acc, item) => {
          const pct = item.preVal === 0 ? (item.postVal === 0 ? 0 : 100) : ((item.postVal - item.preVal) / item.preVal) * 100;
          return acc + (pct < -20 ? 1 : 0);
        }, 0);
        const totalDeteriorated = pairedList.reduce((acc, item) => {
          const pct = item.preVal === 0 ? (item.postVal === 0 ? 0 : 100) : ((item.postVal - item.preVal) / item.preVal) * 100;
          return acc + (pct > 20 ? 1 : 0);
        }, 0);
        const totalUnchanged = totalSamples - totalImproved - totalDeteriorated;

        const totalShiftedSafeToUnsafe = pairedList.reduce((acc, item) => {
          return acc + (isSafe(item.preVal) && !isSafe(item.postVal) ? 1 : 0);
        }, 0);
        const totalShiftedUnsafeToSafe = pairedList.reduce((acc, item) => {
          return acc + (!isSafe(item.preVal) && isSafe(item.postVal) ? 1 : 0);
        }, 0);

        const pctImproved = ((totalImproved / totalSamples) * 100).toFixed(2);
        const pctDeteriorated = ((totalDeteriorated / totalSamples) * 100).toFixed(2);
        const pctUnchanged = ((totalUnchanged / totalSamples) * 100).toFixed(2);

        const totalDistricts = groupList.length;

        // Dominant trend
        let dominantTrend = "No Significant Change";
        let dominantCount = totalUnchanged;
        let dominantPct = pctUnchanged;

        if (totalImproved > totalUnchanged && totalImproved > totalDeteriorated) {
          dominantTrend = "Improved";
          dominantCount = totalImproved;
          dominantPct = pctImproved;
        } else if (totalDeteriorated > totalUnchanged && totalDeteriorated > totalImproved) {
          dominantTrend = "Deteriorated";
          dominantCount = totalDeteriorated;
          dominantPct = pctDeteriorated;
        }

        let analysisParagraph = "";
        if (false) {
          analysisParagraph = `भूजल <strong>${paramName}</strong> की मानसून के बाद की गतिशीलता को निम्नलिखित सीमाओं के आधार पर वर्गीकृत किया गया है:
          <br>• <strong>सुधार (Improved):</strong> मानसून के बाद का मान, पूर्व-मानसून मान से >20% कम है
          <br>• <strong>गिरावट (Deteriorated):</strong> मानसून के बाद का मान, पूर्व-मानसून मान से >20% अधिक है
          <br>• <strong>कोई महत्वपूर्ण बदलाव नहीं (No significant Change):</strong> मानसून के बाद का मान, पूर्व-मानसून मान के ±20% के भीतर है।
          <br><br>
          पूर्व-मानसून और मानसून के बाद के दोनों मौसमों के दौरान ${totalDistricts} ${groupNounPlural} में विश्लेषण किए गए कुल ${totalSamples} भूजल नमूनों में से, मानसून के बाद मुख्य प्रवृत्ति <strong>${dominantTrend === "No Significant Change" ? "कोई महत्वपूर्ण बदलाव नहीं" : (dominantTrend === "Improved" ? "सुधार" : "गिरावट")}</strong> है। परीक्षण स्थलों के एक बड़े हिस्से—${dominantCount} नमूने या ${dominantPct}%—ने जल गुणवत्ता में कोई महत्वपूर्ण परिवर्तन नहीं दर्शाया। जहाँ बदलाव हुए, वहाँ कुल सुधार गिरावट की तुलना में अधिक देखे गए, जिसमें ${totalImproved} नमूने (${pctImproved}%) सुधार दर्शाते हैं जबकि ${totalDeteriorated} नमूने (${pctDeteriorated}%) गिरावट दर्शाते हैं।
          <br><br>
          इसके अतिरिक्त, संक्रमण विश्लेषण दर्शाता है कि मानसून के बाद <strong>${totalShiftedSafeToUnsafe} नमूने</strong> सुरक्षित स्थिति से असुरक्षित स्थिति (मानक सीमाओं से अधिक) में स्थानांतरित हो गए, जबकि <strong>${totalShiftedUnsafeToSafe} नमूने</strong> ताज़ा पुनर्भरण तनुकरण के कारण असुरक्षित स्थिति से वापस सुरक्षित स्थिति में परिवर्तित हो गए।
          <br><br>
          ${paramName} पर मानसून का गतिशील प्रभाव (युग्मित साइट विश्लेषण) <strong>तालिका ${tableNum}</strong> में दिया गया है।`;
        } else {
          let dominantTextNoun = dominantTrend === "No Significant Change" ? "No significant Change" : (dominantTrend === "Improved" ? "Improved" : "Deteriorated");
          
          let halfText = "A significant portion";
          if (dominantCount > totalSamples * 0.5) {
            halfText = "More than half";
          } else if (dominantCount > totalSamples * 0.4) {
            halfText = "Nearly half";
          }

          let shiftsText = "";
          if (totalImproved > totalDeteriorated) {
            const ratio = totalDeteriorated > 0 ? (totalImproved / totalDeteriorated).toFixed(1) : "high";
            if (parseFloat(ratio) === 2.0) {
              shiftsText = `overall improvements happened at exactly twice the rate of deteriorations, with ${totalImproved} samples (${pctImproved}%) showing improvement compared to just ${totalDeteriorated} samples (${pctDeteriorated}%) that declined`;
            } else {
              shiftsText = `overall improvements happened at approximately ${ratio} times the rate of deteriorations, with ${totalImproved} samples (${pctImproved}%) showing improvement compared to ${totalDeteriorated} samples (${pctDeteriorated}%) that declined`;
            }
          } else if (totalDeteriorated > totalImproved) {
            const ratio = totalImproved > 0 ? (totalDeteriorated / totalImproved).toFixed(1) : "high";
            shiftsText = `overall deteriorations outnumbered improvements, with ${totalDeteriorated} samples (${pctDeteriorated}%) showing deterioration compared to ${totalImproved} samples (${pctImproved}%) that showed positive shifts`;
          } else {
            shiftsText = `overall improvements and deteriorations occurred at equal rates, with ${totalImproved} samples (${pctImproved}%) each`;
          }

          const sortedByStability = [...groupList].sort((a, b) => (b.unchanged / b.analyzed) - (a.unchanged / a.analyzed));
          const stable1 = sortedByStability[0];
          const stable2 = sortedByStability[1];
          const stable3 = sortedByStability[2];

          let stabilitySentence = "";
          if (stable1) {
            const s1Pct = ((stable1.unchanged / stable1.analyzed) * 100).toFixed(1);
            stabilitySentence = `${stable1.name} stood out with ${s1Pct === "100.0" ? "absolute consistency" : "high stability"}, as ${s1Pct === "100.0" ? "all" : s1Pct + "%"} of its ${stable1.analyzed} samples showed no significant change.`;
            if (stable2) {
              const s2Pct = ((stable2.unchanged / stable2.analyzed) * 100).toFixed(1);
              if (stable3) {
                const s3Pct = ((stable3.unchanged / stable3.analyzed) * 100).toFixed(1);
                stabilitySentence += ` ${stable2.name} and ${stable3.name} also recorded highly stable readings at ${s2Pct}% and ${s3Pct}%, respectively.`;
              } else {
                stabilitySentence += ` ${stable2.name} also recorded stable readings at ${s2Pct}%.`;
              }
            }
          }

          const sortedByUnchangedVol = [...groupList].sort((a, b) => b.unchanged - a.unchanged);
          const volStable1 = sortedByUnchangedVol[0];
          const volStable2 = sortedByUnchangedVol[1];
          const volStable3 = sortedByUnchangedVol[2];

          let unchangedVolSentence = "";
          if (volStable1) {
            unchangedVolSentence = `In terms of sheer volume, ${volStable1.name} (${volStable1.unchanged} samples)`;
            if (volStable2) {
              if (volStable3) {
                unchangedVolSentence += `, ${volStable2.name} (${volStable2.unchanged} samples), and ${volStable3.name} (${volStable3.unchanged} samples)`;
              } else {
                unchangedVolSentence += ` and ${volStable2.name} (${volStable2.unchanged} samples)`;
              }
            }
            unchangedVolSentence += ` reported the highest absolute numbers of unchanged readings.`;
          }

          const sortedByImprovement = [...groupList].sort((a, b) => (b.improved / b.analyzed) - (a.improved / a.analyzed));
          const imp1 = sortedByImprovement[0];
          const imp2 = sortedByImprovement[1];
          const imp3 = sortedByImprovement[2];

          let improvementSentence = "";
          if (imp1 && imp1.improved > 0) {
            const imp1Pct = ((imp1.improved / imp1.analyzed) * 100).toFixed(1);
            improvementSentence = `${imp1.name} led the ${groupNoun.toLowerCase()} proportionally, with a significant ${imp1Pct}% (${imp1.improved} out of ${imp1.analyzed}) of its samples showing improvement.`;
            if (imp2 && imp2.improved > 0) {
              const imp2Pct = ((imp2.improved / imp2.analyzed) * 100).toFixed(1);
              if (imp3 && imp3.improved > 0) {
                const imp3Pct = ((imp3.improved / imp3.analyzed) * 100).toFixed(1);
                improvementSentence += ` ${imp2.name} and ${imp3.name} followed closely, reporting improvements in ${imp2Pct}% and ${imp3Pct}% of their testing sites, respectively.`;
              } else {
                improvementSentence += ` ${imp2.name} followed, reporting improvements in ${imp2Pct}% of its testing sites.`;
              }
            }
          }

          const sortedByImpVol = [...groupList].sort((a, b) => b.improved - a.improved);
          const volImp1 = sortedByImpVol[0];
          let volImpSentence = "";
          if (volImp1 && volImp1.improved > 0) {
            volImpSentence = `Furthermore, ${volImp1.name} recorded the highest overall volume of improved sites, with ${volImp1.improved} out of its ${volImp1.analyzed} samples showing positive results.`;
          }

          const sortedByDeterioration = [...groupList].sort((a, b) => (b.deteriorated / b.analyzed) - (a.deteriorated / a.analyzed));
          const det1 = sortedByDeterioration[0];
          const det2 = sortedByDeterioration[1];
          const det3 = sortedByDeterioration[2];

          let deteriorationSentence = "";
          if (det1 && det1.deteriorated > 0) {
            const det1Pct = ((det1.deteriorated / det1.analyzed) * 100).toFixed(1);
            deteriorationSentence = `${det1.name} saw the highest rate of deterioration at ${det1Pct}% (${det1.deteriorated} out of ${det1.analyzed} samples)`;
            if (det2 && det2.deteriorated > 0) {
              const det2Pct = ((det2.deteriorated / det2.analyzed) * 100).toFixed(1);
              if (det3 && det3.deteriorated > 0) {
                const det3Pct = ((det3.deteriorated / det3.analyzed) * 100).toFixed(1);
                deteriorationSentence += `, followed by ${det2.name} at ${det2Pct}% and ${det3.name} at ${det3Pct}%.`;
              } else {
                deteriorationSentence += `, followed by ${det2.name} at ${det2Pct}%.`;
              }
            } else {
              deteriorationSentence += `.`;
            }
          }

          const zeroImpList = groupList.filter(g => g.improved === 0).slice(0, 4).map(g => g.name);
          let zeroImpSentence = "";
          if (zeroImpList.length > 0) {
            const listStr = zeroImpList.length === 1 ? zeroImpList[0] : (zeroImpList.slice(0, -1).join(", ") + " and " + zeroImpList[zeroImpList.length - 1]);
            zeroImpSentence = `It is also notable that ${zeroImpList.length === 1 ? "region" : "regions"}—${listStr}—failed to record a single improved sample.`;
          }

          const polarizedCandidate = [...groupList]
            .filter(g => g.improved > 0 && g.deteriorated > 0)
            .sort((a, b) => b.analyzed - a.analyzed)[0];
          let polarizedSentence = "";
          if (polarizedCandidate) {
            polarizedSentence = `Interestingly, ${polarizedCandidate.name} emerged as a highly polarized region; due to its large sample size of ${polarizedCandidate.analyzed}, it simultaneously recorded both a high number of improved samples (${polarizedCandidate.improved}) and a high number of deteriorated samples (${polarizedCandidate.deteriorated}), highlighting extreme localized variability within its borders.`;
          }

          analysisParagraph = `
            Post-Monsoon Dynamics of Groundwater <strong>${paramName}</strong> is categorized based on the following thresholds:
            <ul style="margin: 5px 0 15px 20px; padding: 0; list-style-type: none;">
              <li>• <strong>Improved:</strong> Post-Monsoon Value &gt;20% lower than pre-monsoon value</li>
              <li>• <strong>Deteriorated:</strong> Post-Monsoon Value &gt;20% higher than pre-monsoon value</li>
              <li>• <strong>No significant Change:</strong> Post-Monsoon Value within &plusmn;20% pre-monsoon value</li>
            </ul>
            Out of the <strong>${totalSamples} total groundwater samples</strong> analyzed across <strong>${totalDistricts} ${groupNounPlural.toLowerCase()}</strong>, the dominant trend following the monsoon is <strong>${dominantTextNoun}</strong>. 
            ${halfText} of the testing sites—<strong>${dominantCount} samples, or ${dominantPct}%</strong>—showed no significant change in water quality. 
            Where shifts did occur, ${shiftsText}.
            <br><br>
            Additionally, the transition analysis shows that <strong>${totalShiftedSafeToUnsafe} sample(s)</strong> shifted from a Safe state to an Unsafe state (exceeding standard thresholds) post-monsoon, while <strong>${totalShiftedUnsafeToSafe} sample(s)</strong> transitioned from an Unsafe/exceeding state back to a Safe state due to fresh recharge dilution.
            <br><br>
            Several ${groupNounPlural.toLowerCase()} exhibited remarkable stability, maintaining their baseline measurements across the vast majority of their sites. 
            ${stabilitySentence} 
            ${unchangedVolSentence}
            <br><br>
            Conversely, localized areas of strong recharge or recovery were highly evident, with a proportion of the ${groupNounPlural.toLowerCase()} seeing positive shifts in half or more of their samples. 
            ${improvementSentence} 
            ${volImpSentence}
            <br><br>
            While deterioration was the least common outcome across the board, a few ${groupNounPlural.toLowerCase()} experienced concentrated declines. 
            ${deteriorationSentence} 
            ${zeroImpSentence} 
            ${polarizedSentence}
            <br><br>
            Dynamic Impact of Monsoon on ${paramName} (Paired Site Analysis) is given in <strong>Table No. ${tableNum}</strong>.
          `;
        }

        const tableHeaders = [
          groupNoun,
          "No. of Samples (Common Locations)",
          "Improved (No.)",
          "Improved (%)",
          "Deteriorated (No.)",
          "Deteriorated (%)",
          "No Significant Change (No.)",
          "No Significant Change (%)",
          "Shifted Safe to Unsafe",
          "Shifted Unsafe to Safe"
        ];

        let rowsHTML = "";
        groupList.forEach((g) => {
          const impPct = g.analyzed > 0 ? ((g.improved / g.analyzed) * 100).toFixed(2) : "0.00";
          const detPct = g.analyzed > 0 ? ((g.deteriorated / g.analyzed) * 100).toFixed(2) : "0.00";
          const uncPct = g.analyzed > 0 ? ((g.unchanged / g.analyzed) * 100).toFixed(2) : "0.00";

          rowsHTML += `
            <tr style="border-bottom: 1px solid #cbd5e1;">
              <td style="padding: 8px; text-align: left; font-weight: bold; border: 1px solid #94a3b8;">${g.name}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #94a3b8;">${g.analyzed}</td>
              <td style="padding: 8px; text-align: center; color: #16a34a; font-weight: bold; border: 1px solid #94a3b8;">${g.improved}</td>
              <td style="padding: 8px; text-align: center; color: #16a34a; border: 1px solid #94a3b8;">${impPct}%</td>
              <td style="padding: 8px; text-align: center; color: #dc2626; font-weight: bold; border: 1px solid #94a3b8;">${g.deteriorated}</td>
              <td style="padding: 8px; text-align: center; color: #dc2626; border: 1px solid #94a3b8;">${detPct}%</td>
              <td style="padding: 8px; text-align: center; color: #475569; border: 1px solid #94a3b8;">${g.unchanged}</td>
              <td style="padding: 8px; text-align: center; color: #475569; border: 1px solid #94a3b8;">${uncPct}%</td>
              <td style="padding: 8px; text-align: center; color: #b91c1c; font-weight: bold; border: 1px solid #94a3b8;">${g.shiftedSafeToUnsafe}</td>
              <td style="padding: 8px; text-align: center; color: #047857; font-weight: bold; border: 1px solid #94a3b8;">${g.shiftedUnsafeToSafe}</td>
            </tr>
          `;
        });

        rowsHTML += `
          <tr style="background-color: #f1f5f9; font-weight: bold; border-top: 2px solid #94a3b8;">
            <td style="padding: 8px; text-align: left; border: 1px solid #94a3b8;">Total</td>
            <td style="padding: 8px; text-align: center; border: 1px solid #94a3b8;">${totalSamples}</td>
            <td style="padding: 8px; text-align: center; color: #16a34a; border: 1px solid #94a3b8;">${totalImproved}</td>
            <td style="padding: 8px; text-align: center; color: #16a34a; border: 1px solid #94a3b8;">${pctImproved}%</td>
            <td style="padding: 8px; text-align: center; color: #dc2626; border: 1px solid #94a3b8;">${totalDeteriorated}</td>
            <td style="padding: 8px; text-align: center; color: #dc2626; border: 1px solid #94a3b8;">${pctDeteriorated}%</td>
            <td style="padding: 8px; text-align: center; color: #475569; border: 1px solid #94a3b8;">${totalUnchanged}</td>
            <td style="padding: 8px; text-align: center; color: #475569; border: 1px solid #94a3b8;">${pctUnchanged}%</td>
            <td style="padding: 8px; text-align: center; color: #b91c1c; border: 1px solid #94a3b8;">${totalShiftedSafeToUnsafe}</td>
            <td style="padding: 8px; text-align: center; color: #047857; border: 1px solid #94a3b8;">${totalShiftedUnsafeToSafe}</td>
          </tr>
        `;

        const tableHTML = `
          <div style="margin-top: 15px; margin-bottom: 25px; page-break-inside: avoid;">
            <table style="width: 100%; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 10pt; border: 1px solid #94a3b8;">
              <thead>
                <tr style="background-color: #1e3a8a; color: white; font-weight: bold;">
                  ${tableHeaders.map(h => `<th style="padding: 8px; text-align: center; border: 1px solid #94a3b8; font-size: 9.5pt;">${h}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${rowsHTML}
              </tbody>
            </table>
            <p style="text-align: center; font-size: 9.5pt; font-weight: bold; margin-top: 5px; color: #475569;">
              Table ${tableNum}: Dynamic Impact of Monsoon on ${paramName} (Paired Site Analysis)
            </p>
          </div>
        `;

        return {
          html: `
            <p style="text-align: justify; line-height: 1.6; font-size: 11.5pt; margin-top: 20px; margin-bottom: 12px; font-weight: bold; color: #1e3a8a; font-family: 'Times New Roman', Times, serif;">
              Dynamic Impact of Monsoon on ${paramName} (Paired Site Analysis)
            </p>
            <div style="text-align: justify; line-height: 1.6; font-size: 11pt; margin-bottom: 15px; font-family: 'Times New Roman', Times, serif;">
              ${analysisParagraph}
            </div>
            ${tableHTML}
          `,
          hasData: true
        };
      };

      let stationsMapBase64 = bulletinMaps["STATIONS"] || bulletinMaps["stations"] || "";
      if (!stationsMapBase64) {
        stationsMapBase64 = getAutoSvgMap("STATIONS", mainReportData);
      }
      let figIndex = 1;
      let stationsMapHTML = "";
      if (stationsMapBase64) {
        stationsMapHTML = `
          <div style="text-align: center; margin-top: 15px; margin-bottom: 25px; page-break-inside: avoid;">
            <img src="${stationsMapBase64}" width="650" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: transparent;" alt="Distribution of Ground Water Quality Monitoring Station" />
            <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 8px;">Figure ${figIndex++}: ${
              (titleRegion && titleRegion.toUpperCase() !== "INDIA")
                ? "Statewide"
                : "Nationwide"
            } Distribution of Ground Water Quality Monitoring Station</p>
          </div>
        `;
      }
      let tblIndex = 1;

      // --- Compile Parameter Standards and Min/Max Table ---
      let paramStandardsTableHTML = "";
      if (selectedBulletinParams.length > 0) {
        paramStandardsTableHTML = `
          <div style="margin-top: 25px; margin-bottom: 30px; page-break-inside: avoid;">
            <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
              The regulatory standard thresholds prescribed by the Bureau of Indian Standards (BIS, IS 10500:2012) for the selected parameters, along with the actual maximum concentrations observed across the active monitoring stations, are compiled in the table below:
            </p>
            <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: center; margin-bottom: 10px;">
              <thead>
                <tr style="background-color: #1e3a8a; color: white;">
                  <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">S. No.</th>
                  <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold; text-align: left;">Parameter Name</th>
                  <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">Chemical Formula</th>
                  <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">Unit</th>
                  <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">BIS Acceptable Limit</th>
                  <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">BIS Permissible Limit</th>
                  <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">Observed Max</th>
                </tr>
              </thead>
              <tbody>
        `;

        selectedBulletinParams.forEach((paramName, idx) => {
          const configKey = headerMap[paramName];
          if (!configKey) return;
          const config = PARAM_CONFIG[configKey];
          if (!config) return;

          // Calculate actual min & max
          let maxVal = -Infinity;
          let hasValues = false;

          mainReportData.forEach((row) => {
            const val = parseFloat(row[paramName]);
            if (!isNaN(val)) {
              hasValues = true;
              if (val > maxVal) maxVal = val;
            }
          });

          const maxStr = hasValues ? maxVal.toFixed(configKey === "pH" || configKey === "SAR" || configKey === "RSC" ? 2 : 3) : "N/A";

          // Format acceptable / permissible thresholds nicely
          let accStr = String(config.b1);
          let permStr = String(config.b2);

          if (configKey === "pH") {
            accStr = "6.5";
            permStr = "8.5";
          } else if (config.b1 === config.b2) {
            accStr = String(config.b1);
            permStr = "No Relaxation";
          }

          paramStandardsTableHTML += `
            <tr style="background-color: ${idx % 2 === 0 ? "#f8fafc" : "#ffffff"};">
              <td style="padding: 8px; border: 1px solid #e2e8f0;">${idx + 1}</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: left; font-weight: bold;">${config.name}</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #475569;">${configKey}</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0; font-style: italic;">${config.unit || "-"}</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0;">${accStr}</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0;">${permStr}</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #b91c1c;">${maxStr}</td>
            </tr>
          `;
        });

        paramStandardsTableHTML += `
              </tbody>
            </table>
            <p style="text-align: center; font-weight: bold; font-size: 11pt; margin-top: 5px; margin-bottom: 25px; color: #1e3a8a;">
              Table ${tblIndex++}: Standard limits of selected parameters with observed maximum ranges
            </p>
          </div>
        `;
      }

      // 1.1 Generate cylinder charts for basic and heavy parameters
      let basicCylinderBase64 = "";
      if (basicChartDataSeries.length > 0) {
        try {
          setGenerationProgress("Generating basic hydrochemical cylinder chart...");
          await new Promise((resolve) => setTimeout(resolve, 80));
          const options = buildCylinderOptions("Beyond Permissible Limit - Basic Hydrochemical Parameters (%)", basicChartDataSeries);
          basicCylinderBase64 = await generateOfflineChartBase64(options, 750, 420);
        } catch (err) {
          console.error("Failed to generate basic cylinder chart:", err);
        }
      }

      let heavyCylinderBase64 = "";
      if (heavyChartDataSeries.length > 0) {
        try {
          setGenerationProgress("Generating trace metals cylinder chart...");
          await new Promise((resolve) => setTimeout(resolve, 80));
          const options = buildCylinderOptions("Beyond Permissible Limit - Trace & Heavy Metals (%)", heavyChartDataSeries);
          heavyCylinderBase64 = await generateOfflineChartBase64(options, 750, 420);
        } catch (err) {
          console.error("Failed to generate heavy cylinder chart:", err);
        }
      }

      let summaryChartsHTML = "";
      if (basicChartDataSeries.length > 0) {
        summaryChartsHTML += `<h4 style="font-size: 13pt; font-weight: bold; margin-top: 25px; color: #1e3a8a;">3.1 Basic Hydrochemical Parameters</h4>`;
        summaryChartsHTML += `<p style="text-align: justify; line-height: 1.6; margin-top: 10px; margin-bottom: 15px;">The groundwater samples were evaluated across ${bulletinScope === "National" ? "India" : bulletinScope}, focusing on key physical and chemical features containing ${selectedBasicNames.join(", ")}.</p>`;
        
        if (basicCylinderBase64) {
          summaryChartsHTML += `
            <div style="text-align: center; margin: 20px 0; page-break-inside: avoid;">
              <img src="${basicCylinderBase64}" width="580" style="display: block; margin: 0 auto; max-width: 100%; height: auto;" alt="Basic Parameters Exceedance" />
              <p style="text-align: center; font-style: italic; font-size: 10pt; margin-top: 8px; color: #475569;">
                <strong>Figure ${figIndex++}:</strong> Percent exceedance of basic hydrochemical parameters beyond BIS permissible limit
              </p>
            </div>
          `;
        }

        if (basicSummaryListHTML) {
          summaryChartsHTML += `<ul style="line-height: 1.6; margin-bottom: 20px; padding-left: 20px;">${basicSummaryListHTML}</ul>`;
        }
      }

      if (heavyChartDataSeries.length > 0) {
        summaryChartsHTML += `<h4 style="font-size: 13pt; font-weight: bold; margin-top: 25px; color: #1e3a8a;">3.2 Trace and Heavy Metals</h4>`;
        summaryChartsHTML += `<p style="text-align: justify; line-height: 1.6; margin-top: 10px; margin-bottom: 15px;">The groundwater samples were evaluated to map localized toxic heavy metals such as ${selectedHeavyNames.join(", ")}.</p>`;
        
        if (heavyCylinderBase64) {
          summaryChartsHTML += `
            <div style="text-align: center; margin: 20px 0; page-break-inside: avoid;">
              <img src="${heavyCylinderBase64}" width="580" style="display: block; margin: 0 auto; max-width: 100%; height: auto;" alt="Trace Metals Exceedance" />
              <p style="text-align: center; font-style: italic; font-size: 10pt; margin-top: 8px; color: #475569;">
                <strong>Figure ${figIndex++}:</strong> Percent exceedance of trace and heavy metals beyond BIS permissible limit
              </p>
            </div>
          `;
        }

        if (heavySummaryListHTML) {
          summaryChartsHTML += `<ul style="line-height: 1.6; margin-bottom: 20px; padding-left: 20px;">${heavySummaryListHTML}</ul>`;
        }
      }

      // 2. Process detailed parameters
      let parameterSectionsHTML = "";
      
      // Pre-compile all donut charts, exceedance column charts, and map images sequentially with dynamic frame-pacing to keep memory light and avoid crashes!
      const rasterizedMaps: Record<string, string> = {};
      const rasterizedDonuts: Record<string, string> = {};
      const rasterizedExceedanceCharts: Record<string, string> = {};
      const rasterizedOgives: Record<string, string> = {};
      const rasterizedFrequencyCharts: Record<string, string> = {};
      const rasterizedExceedanceBarCharts: Record<string, string> = {};

      const seenPrecompileKeys = new Set<string>();
      let index = 0;
      for (const paramName of selectedBulletinParams) {
        const configKey = headerMap[paramName];
        if (!configKey) continue;
        if (seenPrecompileKeys.has(configKey)) continue;
        seenPrecompileKeys.add(configKey);
        index++;
        const config = PARAM_CONFIG[configKey];
        if (!config) continue;

        setGenerationProgress(`Generating Trend Analysis for ${config.name} (${index} of ${selectedBulletinParams.length})...`);
        // Give the browser event loop a tiny break to release memory and render frames
        await new Promise((resolve) => setTimeout(resolve, 35));

        // 2. Precompile Donut Charts
        let nAcc = 0;
        let nPerm = 0;
        let nFail = 0;
        let validCount = 0;

        mainReportData.forEach((row) => {
          const v = parseFloat(row[paramName]);
          if (!isNaN(v)) {
            validCount++;
            if (configKey === "pH") {
              if (v >= config.b1 && v <= config.b2) nAcc++;
              else nFail++;
            } else if (config.b1 === config.b2) {
              if (v <= config.b1) nAcc++;
              else nFail++;
            } else {
              if (v <= config.b1) nAcc++;
              else if (v <= config.b2) nPerm++;
              else nFail++;
            }
          }
        });

        const isSingle = config.b1 === config.b2 && configKey !== "pH";
        
        let donutDataPoints: any[] = [];
        if (configKey === "SAR") {
          let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
          mainReportData.forEach((row) => {
            const v = parseFloat(row[paramName]);
            if (!isNaN(v)) {
              if (v <= 10) s1++;
              else if (v <= 18) s2++;
              else if (v <= 26) s3++;
              else s4++;
            }
          });
          donutDataPoints = [
            { name: "S1: Excellent (≤10)", y: s1, color: "#10b981" },
            { name: "S2: Medium (>10–18)", y: s2, color: "#f59e0b" },
            { name: "S3: High (>18–26)", y: s3, color: "#f97316" },
            { name: "S4: Very High (>26)", y: s4, color: "#f43f5e" },
          ].filter(p => p.y > 0);
        } else {
          let accLabel = "";
          let permLabel = "";
          let failLabel = "";
          const unitStr = config.unit ? ` ${config.unit}` : "";

          if (configKey === "RSC") {
            accLabel = "Excellent (<1.25 meq/L)";
            permLabel = "Acceptable (1.25–2.5 meq/L)";
            failLabel = "Unsuitable (>2.5 meq/L)";
          } else if (configKey === "pH") {
            accLabel = `pH: ${config.b1}–${config.b2}`;
            failLabel = `pH: <${config.b1} or >${config.b2}`;
          } else if (isSingle) {
            accLabel = `≤${config.b1}${unitStr}`;
            failLabel = `>${config.b1}${unitStr}`;
          } else {
            accLabel = `≤${config.b1}${unitStr}`;
            permLabel = `>${config.b1}–${config.b2}${unitStr}`;
            failLabel = `>${config.b2}${unitStr}`;
          }

          donutDataPoints = [
            ...(nAcc > 0 ? [{ name: accLabel, y: nAcc, color: "#10b981" }] : []),
            ...(!isSingle && configKey !== "pH" && nPerm > 0 ? [{ name: permLabel, y: nPerm, color: "#f59e0b" }] : []),
            ...(nFail > 0 ? [{ name: failLabel, y: nFail, color: "#f43f5e" }] : []),
          ];
        }

        if (donutDataPoints.length > 0) {
          const donutChartTitle = configKey === "SAR"
            ? `Distribution of SAR Values in different Limits`
            : `Distribution of ${config.name} in different BIS 10500:2012 Limits`;
          try {
            const dBase64 = await generateParamDonutChart(donutChartTitle, donutDataPoints);
            if (dBase64) {
              rasterizedDonuts[configKey] = dBase64;
            }
          } catch (err) {
            console.error(`Failed to precompile donut chart for ${configKey}:`, err);
          }
        }

        // 2b. Precompile Ogive Cumulative Frequency Curves
        const ogiveVals: number[] = [];
        mainReportData.forEach((row) => {
          const v = parseFloat(row[paramName]);
          if (!isNaN(v)) {
            ogiveVals.push(v);
          }
        });

        if (ogiveVals.length > 0) {
          ogiveVals.sort((a, b) => a - b);
          const p50 = getPercentile(ogiveVals, 50);
          const p90 = getPercentile(ogiveVals, 90);
          const p95 = getPercentile(ogiveVals, 95);

          const minVal = ogiveVals[0];
          const maxVal = ogiveVals[ogiveVals.length - 1];

          const steps = 15;
          const dataPoints: { x: number; y: number }[] = [];

          if (minVal === maxVal) {
            dataPoints.push({ x: minVal - 1, y: 0 });
            dataPoints.push({ x: minVal, y: 100 });
            dataPoints.push({ x: minVal + 1, y: 100 });
          } else {
            const interval = (maxVal - minVal) / (steps - 1);
            const padding = interval * 0.5;
            dataPoints.push({ x: Math.max(0, minVal - padding), y: 0 });

            for (let s = 0; s < steps; s++) {
              const threshold = minVal + s * interval;
              const count = ogiveVals.filter((v) => v <= threshold).length;
              const percentage = (count / ogiveVals.length) * 100;
              dataPoints.push({ x: Number(threshold.toFixed(3)), y: Number(percentage.toFixed(1)) });
            }
          }

          const ogiveTitleText = `Cumulative Frequency (Ogive) Curve - ${config.name}`;
          const ogiveOptions: Highcharts.Options = {
            chart: {
              type: "spline",
              backgroundColor: "#ffffff",
            },
            title: {
              text: ogiveTitleText,
              style: { fontWeight: "bold", color: "#1e3a8a", fontSize: "24px", fontFamily: "'Times New Roman', Times, serif" }
            },
            xAxis: {
              title: {
                text: `${config.name}${config.unit ? ` (${config.unit})` : ""}`,
                style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "24px", fontWeight: "bold", color: "#1e293b" }
              },
              labels: {
                style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "22px", color: "#334155" }
              },
              gridLineWidth: 1,
              gridLineDashStyle: "Dash",
              gridLineColor: "rgba(0,0,0,0.05)",
              plotLines: [
                {
                  color: "#2563eb",
                  dashStyle: "Dash",
                  width: 3.0,
                  value: p50,
                  zIndex: 4,
                  label: {
                    text: `Median (P50) = ${p50.toFixed(2)}`,
                    verticalAlign: "top",
                    align: "left",
                    rotation: 0,
                    y: 30,
                    x: 10,
                    style: { color: "#2563eb", fontWeight: "bold", fontSize: "22px", fontFamily: "'Times New Roman', Times, serif" }
                  }
                },
                {
                  color: "#f97316",
                  dashStyle: "Dash",
                  width: 3.0,
                  value: p90,
                  zIndex: 4,
                  label: {
                    text: `P90 = ${p90.toFixed(2)}`,
                    verticalAlign: "top",
                    align: "right",
                    rotation: 0,
                    y: 80,
                    x: -10,
                    style: { color: "#f97316", fontWeight: "bold", fontSize: "22px", fontFamily: "'Times New Roman', Times, serif" }
                  }
                },
                {
                  color: "#dc2626",
                  dashStyle: "Dash",
                  width: 3.0,
                  value: p95,
                  zIndex: 4,
                  label: {
                    text: `P95 = ${p95.toFixed(2)}`,
                    verticalAlign: "top",
                    align: "left",
                    rotation: 0,
                    y: 130,
                    x: 10,
                    style: { color: "#dc2626", fontWeight: "bold", fontSize: "22px", fontFamily: "'Times New Roman', Times, serif" }
                  }
                }
              ]
            },
            yAxis: {
              title: {
                text: "Cumulative Percentage (%)",
                style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "24px", fontWeight: "bold", color: "#1e293b" }
              },
              labels: {
                style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "22px", color: "#334155" }
              },
              min: 0,
              max: 100,
              tickInterval: 10,
              gridLineWidth: 1,
              gridLineColor: "rgba(0,0,0,0.05)"
            },
            plotOptions: {
              spline: {
                marker: { enabled: true, radius: 4 }
              }
            },
            series: [
              {
                name: "Cumulative %",
                type: "spline",
                data: dataPoints.map((pt) => [pt.x, pt.y]),
                color: "#4f46e5",
                lineWidth: 3.5,
                showInLegend: false
              }
            ],
            credits: { enabled: false }
          };

          try {
            const ogiveBase64 = await generateOfflineChartBase64(ogiveOptions, 1100, 580);
            if (ogiveBase64) {
              rasterizedOgives[configKey] = ogiveBase64;
            }
          } catch (err) {
            console.error(`Failed to precompile ogive chart for ${configKey}:`, err);
          }
        }

        // 2c. Precompile Parameter-wise Frequency Distribution Charts
        const freqVals: number[] = [];
        mainReportData.forEach((row) => {
          const v = parseFloat(row[paramName]);
          if (!isNaN(v)) {
            freqVals.push(v);
          }
        });

        if (freqVals.length > 0) {
          const formatVal = (val: number) => {
            if (val === 0) return "0";
            if (val >= 100) return Math.round(val).toString();
            if (val >= 10) return val.toFixed(1);
            if (val >= 0.1) return val.toFixed(2);
            return val.toFixed(3);
          };

          const classes: { label: string; count: number; color: string; min: number; max: number }[] = [];
          const totalCount = freqVals.length;

          if (configKey === "pH") {
            const phClasses = [
              { label: "< 6.5", min: 0, max: 6.5, color: "#ef4444" },
              { label: "6.5 – 7.0", min: 6.5, max: 7.0, color: "#15803d" },
              { label: "7.0 – 7.5", min: 7.0, max: 7.5, color: "#22c55e" },
              { label: "7.5 – 8.0", min: 7.5, max: 8.0, color: "#84cc16" },
              { label: "8.0 – 8.5", min: 8.0, max: 8.5, color: "#eab308" },
              { label: "8.5 – 9.0", min: 8.5, max: 9.0, color: "#f97316" },
              { label: "9.0 – 9.5", min: 9.0, max: 9.5, color: "#ea580c" },
              { label: "> 9.5", min: 9.5, max: 999, color: "#b91c1c" },
            ];
            phClasses.forEach((cls) => {
              const count = freqVals.filter(v => {
                if (cls.label.startsWith("<")) return v < cls.max;
                if (cls.label.startsWith(">")) return v >= cls.min;
                return v >= cls.min && v < cls.max;
              }).length;
              classes.push({ ...cls, count });
            });
          } else {
            let L = config.b2 || config.b1;
            if (!L || isNaN(L) || L <= 0) {
              L = 100;
            }
            const w = L / 4;
            const customColors = [
              "#15803d", // Class 1
              "#22c55e", // Class 2
              "#84cc16", // Class 3
              "#eab308", // Class 4
              "#f97316", // Class 5
              "#ea580c", // Class 6
              "#ef4444", // Class 7
              "#b91c1c", // Class 8
            ];
            for (let c = 0; c < 8; c++) {
              let label = "";
              let min = 0;
              let max = Infinity;
              if (c < 4) {
                min = c * w;
                max = (c + 1) * w;
                label = `${formatVal(min)} – ${formatVal(max)}`;
              } else if (c < 7) {
                min = c * w;
                max = (c + 1) * w;
                label = `${formatVal(min)} – ${formatVal(max)}`;
              } else {
                min = 7 * w;
                max = Infinity;
                label = `> ${formatVal(min)}`;
              }
              const count = freqVals.filter(v => {
                if (max === Infinity) return v >= min;
                return v >= min && v < max;
              }).length;
              classes.push({
                label,
                count,
                color: customColors[c],
                min,
                max
              });
            }
          }

          const freqTitleText = `Frequency Distribution of ${config.name} (${formatChemicalFormula(configKey)})`;
          const freqOptions: Highcharts.Options = {
            chart: {
              type: "column",
              backgroundColor: "#ffffff",
            },
            title: {
              text: freqTitleText,
              style: { fontWeight: "bold", color: "#1e3a8a", fontSize: "24px", fontFamily: "'Times New Roman', Times, serif" }
            },
            xAxis: {
              categories: classes.map(c => c.label),
              title: {
                text: `Concentration Range Classes ${configKey === "pH" ? "" : `(${config.unit || "mg/L"})`}`,
                style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "24px", fontWeight: "bold", color: "#1e293b" }
              },
              labels: {
                style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "20px", fontWeight: "bold", color: "#334155" }
              },
              gridLineWidth: 0
            },
            yAxis: {
              title: {
                text: "Percentage of Stations (%)",
                style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "24px", fontWeight: "bold", color: "#1e293b" }
              },
              labels: {
                style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "22px", color: "#334155" }
              },
              min: 0,
              max: 100,
              tickInterval: 10,
              gridLineWidth: 1,
              gridLineColor: "rgba(0,0,0,0.05)"
            },
            plotOptions: {
              column: {
                colorByPoint: true,
                colors: classes.map(c => c.color),
                dataLabels: {
                  enabled: true,
                  crop: false,
                  overflow: "allow",
                  formatter: function(this: any): string {
                    const count = this.point.options.count;
                    return `${this.y.toFixed(1)}%<br>(n=${count})`;
                  },
                  style: {
                    fontFamily: "'Times New Roman', Times, serif",
                    fontSize: "20px",
                    fontWeight: "bold",
                    color: "#1e293b"
                  }
                }
              }
            },
            series: [
              {
                name: "Percentage of Stations",
                type: "column",
                data: classes.map((cls) => {
                  const pct = totalCount > 0 ? (cls.count / totalCount) * 100 : 0;
                  return {
                    y: Number(pct.toFixed(1)),
                    count: cls.count,
                    color: cls.color
                  };
                }),
                showInLegend: false
              }
            ],
            credits: { enabled: false }
          };

          try {
            const freqBase64 = await generateOfflineChartBase64(freqOptions, 1100, 580);
            if (freqBase64) {
              rasterizedFrequencyCharts[configKey] = freqBase64;
            }
          } catch (err) {
            console.error(`Failed to precompile frequency chart for ${configKey}:`, err);
          }
        }

        // 2d. Precompile Bar Chart for partially affected States/UTs or Districts in decreasing order of exceedance
        const mappedHeader = Object.keys(headerMap).find((k) => headerMap[k] === configKey) || paramName;
        const barGroupKey = breakdownLevel === "State" ? headers.state : headers.district;
        if (barGroupKey) {
          const barGroupedData: Record<string, { total: number; exceed: number }> = {};
          
          mainReportData.forEach((row) => {
            const locName = String(row[barGroupKey] || "Unknown").trim();
            if (locName === "Unknown" || !locName) return;

            if (!barGroupedData[locName]) {
              barGroupedData[locName] = { total: 0, exceed: 0 };
            }

            const val = parseFloat(row[mappedHeader]);
            if (!isNaN(val)) {
              barGroupedData[locName].total++;
              let isExceed = false;
              if (configKey === "pH") {
                if (val < config.b1 || val > config.b2) isExceed = true;
              } else {
                const limit = config.b1 === config.b2 ? config.b1 : config.b2;
                if (val > limit) isExceed = true;
              }

              if (isExceed) {
                barGroupedData[locName].exceed++;
              }
            }
          });

          // Filter for partially affected (exceed > 0)
          const partiallyAffected = Object.entries(barGroupedData)
            .filter(([_, stats]) => stats.exceed > 0)
            .map(([locName, stats]) => {
              const pct = (stats.exceed / stats.total) * 100;
              return {
                name: locName,
                y: Number(pct.toFixed(2)),
                exceed: stats.exceed,
                total: stats.total
              };
            });

          // Sort in decreasing order of exceedance %
          partiallyAffected.sort((a, b) => b.y - a.y);

          // Limit to top 25 to ensure the report compiles quickly and the chart is highly readable
          const slicedPartiallyAffected = partiallyAffected.slice(0, 25);

          if (slicedPartiallyAffected.length > 0) {
            const categories = slicedPartiallyAffected.map(item => item.name);
            const seriesData = slicedPartiallyAffected.map(item => ({
              name: item.name,
              y: item.y,
              count: item.exceed,
              total: item.total
            }));

            const barTitleText = `Exceedance Rate of ${config.name} (${configKey}) by ${breakdownLevel === "State" ? "State/UT" : "District"}${partiallyAffected.length > 25 ? " (Top 25)" : ""}`;
            const barOptions: Highcharts.Options = {
              chart: {
                type: "bar",
                backgroundColor: "#ffffff",
              },
              title: {
                text: barTitleText,
                style: { fontWeight: "bold", color: "#1e3a8a", fontSize: "24px", fontFamily: "'Times New Roman', Times, serif" }
              },
              xAxis: {
                categories: categories,
                title: {
                  text: breakdownLevel === "State" ? "State/UT" : "District",
                  style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "22px", fontWeight: "bold", color: "#1e293b" }
                },
                labels: {
                  style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "18px", fontWeight: "bold", color: "#334155" }
                },
                gridLineWidth: 0
              },
              yAxis: {
                title: {
                  text: "Exceedance Percentage (%)",
                  style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "22px", fontWeight: "bold", color: "#1e293b" }
                },
                labels: {
                  style: { fontFamily: "'Times New Roman', Times, serif", fontSize: "18px", color: "#334155" }
                },
                min: 0,
                max: 100,
                tickInterval: 10,
                gridLineWidth: 1,
                gridLineColor: "rgba(0,0,0,0.05)"
              },
              plotOptions: {
                bar: {
                  colorByPoint: false,
                  dataLabels: {
                    enabled: true,
                    crop: false,
                    overflow: "allow",
                    formatter: function(this: any): string {
                      const yVal = typeof this.y === "number" ? this.y : 0;
                      const count = this.point && this.point.options && typeof this.point.options.count === "number" ? this.point.options.count : 0;
                      const tot = this.point && this.point.options && typeof this.point.options.total === "number" ? this.point.options.total : 0;
                      return `${yVal.toFixed(1)}% (${count}/${tot})`;
                    },
                    style: {
                      fontFamily: "'Times New Roman', Times, serif",
                      fontSize: "18px",
                      fontWeight: "bold",
                      color: "#1e293b"
                    }
                  }
                }
              },
              series: [
                {
                  name: "Exceedance %",
                  type: "bar",
                  data: seriesData,
                  color: "#dc2626", // Crimson/red color for exceedance
                  showInLegend: false
                }
              ],
              credits: { enabled: false }
            };

            // Calculate height dynamically based on the number of categories to avoid squishing
            const dynamicHeight = Math.max(450, categories.length * 40 + 150);

            try {
              const barBase64 = await generateOfflineChartBase64(barOptions, 1100, dynamicHeight);
              if (barBase64) {
                rasterizedExceedanceBarCharts[configKey] = barBase64;
              }
            } catch (err) {
              console.error(`Failed to precompile bar chart for ${configKey}:`, err);
            }
          }
        }


      }

      let subSecIndex = 1;
      const seenRenderKeys = new Set<string>();
      for (let i = 0; i < selectedBulletinParams.length; i++) {
        const paramName = selectedBulletinParams[i];
        const configKey = headerMap[paramName];
        if (!configKey) continue;
        if (configKey === "SAR" || configKey === "RSC") continue; // Skip SAR and RSC to prevent double rendering and duplication in Section 4
        if (seenRenderKeys.has(configKey)) continue;
        seenRenderKeys.add(configKey);
        const config = PARAM_CONFIG[configKey];
        if (!config) continue;

        const isHindi = false;

        let thresholdStr = "";
        if (configKey === "pH") {
          thresholdStr = `${config.b1} to ${config.b2}`;
        } else if (config.b1 === config.b2) {
          thresholdStr = `≤ ${config.b1} ${config.unit}`;
        } else {
          thresholdStr = `≤ ${config.b2} ${config.unit}`;
        }

        let description = `The ${breakdownLevel.toLowerCase()}-wise distribution of samples exceeding the permissible limit (${thresholdStr}) for ${config.name} is presented below.`;
        if (configKey === "EC") {
          description = `Electrical Conductivity (EC) is one of the most widely used parameters for assessing groundwater quality, as it provides an indirect measure of the total dissolved solids (TDS) present in water. It reflects the ability of water to conduct an electric current, which is directly proportional to the concentration of dissolved ions such as calcium, magnesium, sodium, potassium, chloride, sulfate, and bicarbonate. Higher EC values generally indicate elevated salinity levels, which may be attributed to natural processes such as mineral dissolution, rock–water interaction, and seawater ingress, or to anthropogenic influences including irrigation return flows, industrial effluents, and improper waste disposal.
					Electrical conductance is directly related to the abundance of charged ionic compounds (Hem 1985). Salinity always exists in ground water but in variable amounts. It is mostly influenced by aquifer material, solubility of minerals, duration of contact and factors such as the permeability of soil, drainage facilities, and quantity of rainfall and above all, the climate of the area. The salinity of groundwater in coastal areas in addition to the above may be due to air borne salts originating from air water interface over the sea and due to over pumping of fresh water which overlays saline water in coastal aquifer systems. 
					Monitoring EC is important because it influences the suitability of groundwater for drinking, irrigation, and industrial use. While water with low EC may be unsuitable due to corrosiveness and lack of essential minerals, excessively high EC imparts undesirable taste, reduces crop productivity through soil salinization, and may lead to long-term health concerns. As per BIS:10500 guidelines, the acceptable limit for EC is 750 µS/cm at 25°C, with a permissible limit of 3000 µS/cm in the absence of an alternative source. Given its significance as a rapid indicator of groundwater quality, EC serves as a baseline parameter in water quality assessments, providing insights into the extent of salinity, hydrogeochemical processes, and anthropogenic stress on aquifers.`;
        } else if (configKey === "F") {
          if (false) {
            description = `
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                फ्लोराइड भूजल का एक प्राकृतिक घटक है और भारत के कई हिस्सों में पीने के पानी की गुणवत्ता को प्रभावित करने वाले सबसे महत्वपूर्ण भूगर्भीय (geogenic) प्रदूषकों में से एक है। सूक्ष्म सांद्रता में, फ्लोराइड मानव स्वास्थ्य के लिए फायदेमंद है क्योंकि यह दांतों और हड्डियों के विकास को बढ़ावा देता है और दंत क्षय (dental caries) को रोकने में मदद करता है। हालांकि, निर्धारित स्वीकार्य सीमा से अधिक फ्लोराइड युक्त पानी के लंबे समय तक सेवन से गंभीर स्वास्थ्य विकार हो सकते हैं, जिन्हें सामूहिक रूप से फ्लोरोसिस (fluorosis) कहा जाता है। दंत फ्लोरोसिस (Dental fluorosis) आमतौर पर 1.5 mg/L से अधिक फ्लोराइड सांद्रता से जुड़ा होता है, जबकि 5-10 mg/L या उससे अधिक फ्लोराइड वाले पानी के लंबे समय तक सेवन से कंकाल फ्लोरोसिस (skeletal fluorosis) हो सकता है, जिससे जोड़ों का दर्द, हड्डियों में विकृति और स्थायी विकलांगता हो सकती है। दांतों और कंकाल प्रणाली के निरंतर विकास के कारण बच्चे अत्यधिक फ्लोराइड जोखिम के प्रति विशेष रूप से संवेदनशील होते हैं।
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                भारतीय मानक ब्यूरो (BIS IS 10500:2012) के अनुसार, पीने के पानी में फ्लोराइड की स्वीकार्य सीमा 1.0 mg/L है, जबकि वैकल्पिक स्रोत की अनुपस्थिति में अनुमेय सीमा 1.5 mg/L है। इसी तरह, विश्व स्वास्थ्य संगठन (WHO) प्रतिकूल स्वास्थ्य प्रभावों को कम करने के लिए पीने के पानी में फ्लोराइड के लिए 1.5 mg/L के दिशानिर्देश मूल्य की सिफारिश करता है।
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                भूजल में मौजूद फ्लोराइड प्राकृतिक (भूगर्भीय) और मानवजनित दोनों स्रोतों से उत्पन्न होता है, हालांकि भारत के अधिकांश हिस्सों में भूगर्भीय प्रक्रियाएं प्रमुख स्रोत हैं। प्राकृतिक फ्लोराइड संवर्धन आग्नेय, कायांतरित और अवसादी चट्टानों में मौजूद फ्लोराइड युक्त खनिजों के अपक्षय और विघटन के माध्यम से होता है। महत्वपूर्ण फ्लोराइड युक्त खनिजों में फ्लोराइट (CaF₂), फ्लोरापेटाइट [Ca₅(PO₄)₃F], बायोटाइट, मस्कोवाइट, हॉर्नब्लेंड, एम्फीबोल्स, अभ्रक और टूमलाइन शामिल हैं। ये खनिज विशेष रूप से ग्रेनाइट, नीस और क्रिस्टलीय संरचनाओं वाले कठोर चट्टानी क्षेत्रों में लंबे समय तक जल-चट्टान संपर्क के माध्यम से धीरे-धीरे भूजल में फ्लोराइड छोड़ते हैं।
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                महाद्वीपीय परत की औसत फ्लोराइड सामग्री लगभग 611 mg/kg है, हालांकि अलग-अलग चट्टानों में इसकी प्रचुरता भिन्न होती है। भूजल में फ्लोराइड का संवर्धन और स्थानिक वितरण काफी हद तक क्षेत्र की भूवैज्ञानिक विशेषताओं पर निर्भर करता है। शुष्क और अर्ध-शुष्क क्षेत्रों में, उच्च वाष्पीकरण दर, कम भूजल पुनर्भरण और लंबे समय तक भूजल निवास समय अक्सर फ्लोराइड संवर्धन को बढ़ाते हैं।
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                भूजल रसायन विज्ञान फ्लोराइड की घुलनशीलता को नियंत्रित करने में महत्वपूर्ण भूमिका निभाता है। फ्लोराइड संवर्धन आमतौर पर कम कैल्शियम (Ca²⁺) सांद्रता और अपेक्षाकृत उच्च सोडियम (Na⁺) और बाइकार्बोनेट (HCO₃⁻) सांद्रता वाले क्षारीय भूजल में देखा जाता है। कई अध्ययनों से पता चला है कि सोडियम-बाइकार्बोनेट (Na–HCO₃) प्रकार का भूजल फ्लोराइड विघटन के लिए अनुकूल परिस्थितियां प्रदान करता है। कैल्शियम कार्बोनेट का अवक्षेपण घुलनशील कैल्शियम सांद्रता को कम करता है, जिससे फ्लोराइड युक्त खनिजों की घुलनशीलता बढ़ जाती है। इस भू-रासायनिक प्रक्रिया का एक सरलीकृत निरूपण नीचे दिया गया है:
              </p>
              <p style="text-align: center; font-weight: bold; font-family: 'Times New Roman', Times, serif; font-size: 11.5pt; margin: 15px 0;">
                CaF₂ + Na₂CO₃ → CaCO₃ + 2Na⁺ + 2F⁻
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                भूजल pH भी फ्लोराइड गतिशीलता पर महत्वपूर्ण नियंत्रण रखता है। हल्के अम्लीय परिस्थितियों (pH 5.0–6.5) में, फ्लोराइड आयन मिट्टी के खनिजों पर आसानी से अधिशोषित हो जाते हैं, जिससे भूजल में इनकी सांद्रता सीमित हो जाती है। इसके विपरीत, क्षारीय परिस्थितियों (pH > 7.0) में, हाइड्रॉक्सिल (OH⁻) आयन आयन-विनिमय प्रतिक्रियाओं के माध्यम से अधिशोषित फ्लोराइड को प्रतिस्थापित करते हैं, जिससे मिट्टी और सिलिकेट खनिजों जैसे कि बायोटाइट, मस्कोवाइट, हॉर्नब्लेंड और एम्फीबोल्स से अधिक फ्लोराइड मुक्त होता है।
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                हालांकि भूगर्भीय प्रक्रियाएं मुख्य स्रोत हैं, फॉस्फेट उर्वरकों का अत्यधिक उपयोग, औद्योगिक कचरे का निपटान और एल्यूमीनियम स्मेल्टरों, ईंट भट्टों और सिरेमिक उद्योगों से उत्सर्जन स्थानीय स्तर पर योगदान कर सकते हैं। विशेष रूप से सिंगल सुपरफॉस्फेट (SSP) के निर्माण के दौरान, अम्लीय प्रसंस्करण परिस्थितियां चट्टानों से फ्लोराइड की रिहाई को सुगम बनाती हैं, जिससे औद्योगिक उत्सर्जन भी भूजल प्रदूषण का एक महत्वपूर्ण माध्यमिक स्रोत बन जाता है।
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                अतः, भूजल में फ्लोराइड की उपस्थिति कई परस्पर संबंधित कारकों पर निर्भर करती है। इसके प्रभावी शमन के लिए एक एकीकृत दृष्टिकोण की आवश्यकता है जिसमें जलभृत प्रणालियों का वैज्ञानिक मूल्यांकन, निरंतर गुणवत्ता निगरानी, कम फ्लोराइड वाले पेयजल स्रोतों का संरक्षण, उचित उपचार प्रौद्योगिकियों को अपनाना और सक्रिय सामुदायिक भागीदारी शामिल है। दीर्घकालिक प्रबंधन रणनीतियों को न केवल दूषित पानी से फ्लोराइड हटाने पर ध्यान केंद्रित करना चाहिए बल्कि सतत भूजल संसाधन प्रबंधन और सुरक्षित पेयजल प्रणालियों के माध्यम से मानव जोखिम को कम करने पर भी ध्यान देना चाहिए।
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 10px;">
                नीचे सक्रिय जल निगरानी स्टेशनों के आधार पर फ्लोराइड की अनुमेय पेयजल सीमा (>1.5 mg/L) से अधिक नमूनों का ${breakdownLevel.toLowerCase()}-वार वितरण विस्तृत रूप से प्रस्तुत किया गया है।
              </p>
            `;
          } else {
            description = `
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                Fluoride is a naturally occurring constituent of groundwater and is one of the most significant geogenic contaminants affecting drinking water quality in many parts of India. In trace concentrations, fluoride is beneficial for human health as it promotes the development of teeth and bones and helps prevent dental caries. However, prolonged consumption of drinking water containing fluoride above the prescribed permissible limit may lead to serious health disorders, collectively known as fluorosis. Dental fluorosis is generally associated with fluoride concentrations exceeding 1.5 mg/L, while long-term consumption of water containing fluoride concentrations of 5–10 mg/L or higher may result in skeletal fluorosis, causing joint pain, bone deformities, restricted movement, and permanent disability. Children are particularly vulnerable to excessive fluoride exposure because of the ongoing development of their teeth and skeletal system.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                According to the Bureau of Indian Standards (BIS IS 10500:2012), the acceptable limit of fluoride in drinking water is 1.0 mg/L, while the permissible limit in the absence of an alternate source is 1.5 mg/L. Similarly, the World Health Organization (WHO) recommends a guideline value of 1.5 mg/L for fluoride in drinking water to minimize adverse health effects.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                Fluoride present in groundwater originates from both natural (geogenic) and anthropogenic sources, although geogenic processes are the predominant source in most parts of India. Natural fluoride enrichment occurs through the weathering and dissolution of fluoride-bearing minerals present in igneous, metamorphic, and sedimentary rocks. Important fluoride-bearing minerals include fluorite (CaF₂), fluorapatite [Ca₅(PO₄)₃F], biotite, muscovite, hornblende, amphiboles, mica, and tourmaline. These minerals gradually release fluoride into groundwater through prolonged water-rock interaction, particularly in hard rock terrains characterized by granites, gneisses, and crystalline formations.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                The average fluoride content of the continental crust is approximately 611 mg/kg, although its abundance varies considerably among different rock types. Reported average concentrations include approximately 360 mg/kg in basalt, 810 mg/kg in granite, 220 mg/kg in limestone, 180 mg/kg in sandstone, 800 mg/kg in shale, 730 mg/kg in oceanic sediments, and 285 mg/kg in soils. Consequently, the occurrence and spatial distribution of fluoride in groundwater largely depend on the geological characteristics of an area.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                The mobilization of fluoride into groundwater is governed by a combination of hydrogeological and geochemical processes. Climatic conditions, groundwater residence time, lithology, aquifer mineralogy, groundwater flow characteristics, and the extent of water-rock interaction collectively influence fluoride concentration in groundwater. In arid and semi-arid regions, high evaporation rates, low groundwater recharge, and prolonged groundwater residence time often enhance fluoride enrichment.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                Fluoride is generally sparingly soluble under normal conditions; however, its mobility is strongly influenced by groundwater chemistry. In natural waters, fluoride predominantly exists as the fluoride ion (F⁻). Under acidic conditions, hydrogen fluoride (HF) may form, whereas under near-neutral to alkaline conditions fluoride remains in its ionic form. Fluoride also forms stable complexes with aluminium, beryllium, and ferric iron under specific geochemical environments. Owing to its ionic radius, which is comparable to that of hydroxyl ions (OH⁻), fluoride readily substitutes hydroxyl groups in hydroxyl-bearing silicate minerals, thereby enhancing its release into groundwater during mineral weathering.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                Groundwater chemistry plays a critical role in controlling fluoride solubility. Fluoride enrichment is commonly observed in alkaline groundwater characterized by low calcium (Ca²⁺) concentrations and relatively high sodium (Na⁺) and bicarbonate (HCO₃⁻) concentrations. Several hydrogeochemical investigations have demonstrated that sodium-bicarbonate (Na–HCO₃) type groundwater provides favourable conditions for fluoride dissolution. The precipitation of calcium carbonate reduces dissolved calcium concentration, thereby increasing the solubility of fluoride-bearing minerals. A simplified representation of this geochemical process is:
              </p>
              <p style="text-align: center; font-weight: bold; font-family: 'Times New Roman', Times, serif; font-size: 11.5pt; margin: 15px 0;">
                CaF₂ + Na₂CO₃ → CaCO₃ + 2Na⁺ + 2F⁻
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                Groundwater pH also exerts significant control on fluoride mobilization. Under mildly acidic conditions (pH 5.0–6.5), fluoride ions are readily adsorbed onto clay minerals and hydrous oxides, thereby limiting fluoride concentration in groundwater. Conversely, under alkaline conditions (pH > 7.0), hydroxyl ions replace adsorbed fluoride through ion-exchange reactions, resulting in increased fluoride release from clay minerals and fluoride-bearing silicate minerals such as biotite, muscovite, hornblende, apatite, and amphiboles.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                Although geogenic processes constitute the principal source of fluoride in groundwater, anthropogenic activities may also contribute locally. Excessive application of phosphate fertilizers, disposal of industrial effluents, and emissions from aluminium smelters, brick kilns, ceramic industries, glass manufacturing units, and phosphate fertilizer plants can increase fluoride loading in soil and groundwater. During the manufacture of phosphate fertilizers, particularly Single Superphosphate (SSP), acidic processing conditions facilitate the release of fluoride from phosphate rock, making industrial emissions an important secondary source of groundwater contamination in certain areas.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                The occurrence of fluoride in groundwater is therefore controlled by several interrelated factors, including lithology, aquifer mineralogy, climatic conditions, groundwater residence time, recharge characteristics, groundwater flow dynamics, pH, and the concentration of major ions such as calcium, sodium, and bicarbonate. Low calcium concentrations generally favour fluoride dissolution, while elevated bicarbonate concentrations promote desorption and mobilization of fluoride from aquifer materials.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 12px;">
                Considering the widespread occurrence of fluoride in groundwater and its implications for public health, effective mitigation requires an integrated approach involving scientific assessment of aquifer systems, continuous groundwater quality monitoring, protection of low-fluoride drinking water sources, adoption of appropriate treatment technologies, and active community participation. Long-term management strategies should focus not only on removing fluoride from contaminated water but also on minimizing human exposure through sustainable groundwater resource management and safe drinking water supply systems.
              </p>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 10px;">
                The ${breakdownLevel.toLowerCase()}-wise distribution of samples exceeding the fluoride drinking limit (>1.5 mg/L) across active monitoring stations is detailed below.
              </p>
            `;
          }
        } else if (configKey === "NO3") {
          description = `Nitrate in Groundwater  is one of the most widespread groundwater contaminants and constitutes a major concern for drinking water quality due to its adverse impacts on human health. Elevated nitrate concentrations in groundwater primarily result from anthropogenic activities, including excessive application of nitrogenous fertilizers, improper disposal of animal wastes, leakage from septic tanks and sewerage systems, and infiltration of untreated or partially treated domestic wastewater. In agricultural regions, nitrate contamination is predominantly associated with intensive fertilizer use and irrigation practices that enhance the leaching of nitrogen through the unsaturated zone into underlying aquifers.

Consumption of drinking water containing nitrate above the prescribed permissible limit poses significant health risks, particularly to infants below six months of age, in whom it may cause methemoglobinemia (Blue Baby Syndrome) by impairing the oxygen-carrying capacity of blood. Long-term exposure to elevated nitrate concentrations has also been associated with adverse health effects in adults, including potential risks related to thyroid dysfunction, reproductive disorders, and the endogenous formation of N-nitroso compounds, although these associations continue to be investigated. Consequently, nitrate concentrations exceeding the prescribed drinking water standards render groundwater unsuitable for potable use without appropriate treatment.

The aqueous geochemistry of nitrogen is governed by the nitrogen cycle and is strongly influenced by redox conditions, microbial activity, pH, and the availability of organic carbon. Nitrogen occurs in groundwater in several oxidation states, including nitrate (NO₃⁻), nitrite (NO₂⁻), ammonium (NH₄⁺), ammonia (NH₃), dissolved molecular nitrogen (N₂), nitrous oxide (N₂O), and organically bound nitrogen. Under oxidizing conditions, nitrate is the thermodynamically stable and most mobile inorganic nitrogen species; consequently, it is the predominant form detected in groundwater. In contrast, ammonium is more stable under reducing environments, while nitrite generally occurs only as a transient intermediate during nitrification and denitrification processes.

Natural nitrogen concentrations in soils are generally insufficient to sustain intensive agricultural production. Therefore, nitrogen is commonly supplemented through the application of fertilizers such as urea [CO(NH₂)₂], ammonium nitrate (NH₄NO₃), calcium ammonium nitrate (CAN), ammonium sulphate [(NH₄)₂SO₄], and diammonium phosphate (DAP, (NH₄)₂HPO₄). Following application, these fertilizers undergo microbial transformation in the soil. Ammonium released from fertilizers is oxidized to nitrate through the process of nitrification, after which the highly soluble and weakly sorbed nitrate ion is readily transported with infiltrating recharge water. Because nitrate exhibits negligible adsorption onto most soil minerals, it is highly susceptible to leaching and can migrate through the vadose zone into groundwater, particularly in areas with permeable soils, shallow water tables, and excessive irrigation or rainfall.

The occurrence of elevated nitrate concentrations in groundwater is therefore indicative of the transport of nitrogen from surface and near-surface sources into the aquifer system. The principal sources include agricultural fertilizers, livestock manure, septic tank effluents, sewage leakage, municipal waste disposal sites, and other nitrogen-rich organic wastes. Hydrogeological factors such as aquifer lithology, recharge characteristics, groundwater flow dynamics, and redox conditions further influence the transport, transformation, and persistence of nitrate in groundwater.`;
        } else if (configKey === "As") {
          description = `Arsenic (As) is a naturally occurring toxic metalloid that is widely distributed in the Earth's crust, with an average crustal abundance of approximately 1.5–2.0 mg/kg. It has emerged as one of the most significant groundwater contaminants worldwide and poses a serious public health concern in several countries, including India. Chronic exposure to arsenic through the consumption of contaminated drinking water can result in arsenicosis and is associated with various adverse health effects. Recognizing its toxicity, the Bureau of Indian Standards (BIS), under IS 10500:2012, has prescribed an acceptable limit of 0.01 mg/L (10 μg/L) for arsenic in drinking water, with no relaxation in the absence of an alternate safe source.

The occurrence of arsenic in groundwater is predominantly of geogenic origin, resulting from natural water–rock interactions and geochemical processes occurring within aquifer systems. Arsenic is present as a trace constituent in a variety of sulphide and sulphosalt minerals, including arsenopyrite (FeAsS), realgar (As₄S₄), orpiment (As₂S₃), pyrite (FeS₂), enargite (Cu₃AsS₄), and tennantite ((Cu,Fe)₁₂As₄S₁₃). In addition to its occurrence in primary minerals, arsenic is frequently adsorbed or co-precipitated with secondary mineral phases such as iron oxyhydroxides (FeOOH), manganese oxides, clay minerals, and natural organic matter. The mobilization of arsenic into groundwater is largely governed by hydrogeochemical processes, including the oxidation of arsenic-bearing sulphide minerals, reductive dissolution of iron oxyhydroxides, competitive desorption, and changes in pH and redox conditions.

Although natural geological sources account for the majority of arsenic contamination in groundwater, anthropogenic activities may also contribute locally to elevated arsenic concentrations. Such sources include mining and ore processing, metallurgical and smelting industries, coal combustion, the historical use of arsenic-containing pesticides and herbicides, discharge of industrial effluents, and improper disposal of arsenic-bearing wastes. In most groundwater systems, however, the contribution from anthropogenic sources is generally secondary compared to naturally occurring geogenic processes that control the release, transport, and distribution of arsenic within aquifers.`;
        }

        // Count values per category
        let nAcc = 0;
        let nPerm = 0;
        let nFail = 0;
        let validCount = 0;

        mainReportData.forEach((row) => {
          const v = parseFloat(row[paramName]);
          if (!isNaN(v)) {
            validCount++;
            if (configKey === "pH") {
              if (v >= config.b1 && v <= config.b2) nAcc++;
              else nFail++;
            } else if (config.b1 === config.b2) {
              if (v <= config.b1) nAcc++;
              else nFail++;
            } else {
              if (v <= config.b1) nAcc++;
              else if (v <= config.b2) nPerm++;
              else nFail++;
            }
          }
        });

        const isSingle = config.b1 === config.b2 && configKey !== "pH";
        const donutChartTitle = `Distribution of ${config.name} in Monitored Ranges`;
        const donutBase64 = bulletinMaps[`donut_${configKey}`] || bulletinMaps[`donut_${paramName}`] || rasterizedDonuts[configKey] || "";

        const pctAcc = validCount > 0 ? ((nAcc / validCount) * 100).toFixed(2) : "0.00";
        const pctPerm = validCount > 0 ? ((nPerm / validCount) * 100).toFixed(2) : "0.00";
        const pctFail = validCount > 0 ? ((nFail / validCount) * 100).toFixed(2) : "0.00";

        const tableANum = tblIndex;
        const tableBNum = tblIndex + 1;
        const tableCNum = tblIndex + 2;

        let textSummaryRange = `<p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">A total of <strong>${validCount}</strong> samples were successfully analyzed for ${config.name} in ${bulletinScope === "National" ? "India" : bulletinScope}. Safe compliance ranges are categorized as follows: `;
        if (configKey === "pH") {
          textSummaryRange += `<strong>${nAcc} sites (${pctAcc}%)</strong> fall safely inside the BIS guidelines, with <strong>${nFail} sites (${pctFail}%)</strong> registering alkaline or acidic out-of-range metrics.</p>`;
        } else if (isSingle) {
          textSummaryRange += `<strong>${nAcc} sites (${pctAcc}%)</strong> are fully compliant, whereas <strong>${nFail} sites (${pctFail}%)</strong> exceed the safety permissible standard.</p>`;
        } else {
          textSummaryRange += `<strong>${nAcc} sites (${pctAcc}%)</strong> fall within the acceptable limit, <strong>${nPerm} sites (${pctPerm}%)</strong> within permissible margins, and <strong>${nFail} sites (${pctFail}%)</strong> exhibit elevated values exceeding safe standards.</p>`;
        }

        // Table A Reference
        const limitValue = isSingle ? config.b1 : config.b2;
        const limitLabelStr = configKey === "pH" ? "6.5-8.5" : `>${limitValue} ${config.unit || ""}`;

        if (false) {
          textSummaryRange += `<p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">${config.name} की अनुमेय पेयजल सीमा (${thresholdStr}) से अधिक नमूनों का ${breakdownLevel === "State" ? "राज्य/संघ राज्य क्षेत्र" : "जिला"}-वार वितरण <strong>तालिका सं. ${tableANum}</strong> में दर्शाया गया है।</p>`;
        } else {
          textSummaryRange += `<p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">The ${breakdownLevel.toLowerCase()}-wise distribution of samples above the ${config.name} permissible limit (${limitLabelStr}) is depicted in Table No. ${tableANum}.</p>`;
        }

        const tableInfo = generateBulletinTableHTML(configKey, filteredData, breakdownLevel, tableANum);
        const classificationCaption = `<p style="text-align: center; font-weight: bold; font-size: 11pt; margin-bottom: 5px; color: #1e3a8a;">Table No. ${tableANum}: Distribution of ${config.name} (${formatChemicalFormula(configKey)}) exceedances</p>`;
        
        const detailedTableHTML = generateBulletinDetailedTableHTML(configKey, filteredData, breakdownLevel, tableBNum);
        const categorizationParagraph = getCategorizationText(tableInfo.dataMap, config.name, breakdownLevel);

        const paramUnitLabel = config.unit ? ` (${config.unit})` : "";
        const tableBReference = `<p style="text-align: justify; line-height: 1.6; margin-top: 15px; margin-bottom: 15px;">Detailed ${breakdownLevel}-wise Statistical Distribution of ${config.name}${paramUnitLabel} is given in Table No. ${tableBNum}.</p>`;

        // Robust fuzzy map image resolver
        let mapImageBase64 = "";
        if (bulletinMaps) {
          if (configKey && bulletinMaps[configKey]) {
            mapImageBase64 = bulletinMaps[configKey];
          } else if (configKey && bulletinMaps[configKey.toUpperCase()]) {
            mapImageBase64 = bulletinMaps[configKey.toUpperCase()];
          } else if (configKey && bulletinMaps[configKey.toLowerCase()]) {
            mapImageBase64 = bulletinMaps[configKey.toLowerCase()];
          } else if (paramName && bulletinMaps[paramName]) {
            mapImageBase64 = bulletinMaps[paramName];
          } else if (paramName && bulletinMaps[paramName.trim()]) {
            mapImageBase64 = bulletinMaps[paramName.trim()];
          } else if (paramName && bulletinMaps[paramName.toUpperCase()]) {
            mapImageBase64 = bulletinMaps[paramName.toUpperCase()];
          } else {
            // Find any fuzzy match
            const foundKey = Object.keys(bulletinMaps).find(k => {
              const kClean = k.toLowerCase().replace(/[^a-z0-9]/g, "");
              const pClean = paramName.toLowerCase().replace(/[^a-z0-9]/g, "");
              const cClean = configKey.toLowerCase().replace(/[^a-z0-9]/g, "");
              return kClean === pClean || kClean === cClean || kClean.includes(cClean) || cClean.includes(kClean);
            });
            if (foundKey) {
              mapImageBase64 = bulletinMaps[foundKey];
            }
          }
        }

        if (!mapImageBase64 && nFail > 0) {
          mapImageBase64 = getAutoSvgMap(configKey, filteredData);
        }
        if (nFail === 0) {
          mapImageBase64 = "";
        }
        if (mapImageBase64) {
          latestCompiledMaps[configKey] = mapImageBase64;
        }
        const mapSvgString = "";

        const monsoonImpact = getMonsoonImpactAnalysis(
          configKey,
          config.name,
          rawData,
          headers,
          headerMap,
          bulletinScope,
          isHindi,
          tableCNum
        );

        if (monsoonImpact.hasData) {
          tblIndex += 3;
        } else {
          tblIndex += 2;
        }

        const allVals: number[] = [];
        mainReportData.forEach((row) => {
          const v = parseFloat(row[paramName]);
          if (!isNaN(v)) {
            allVals.push(v);
          }
        });

        let ogiveBase64 = "";
        if (bulletinMaps) {
          const matchingKey = Object.keys(bulletinMaps).find((k) => {
            return k.startsWith(`sent_chart_ogive_${configKey}_`) || k.startsWith(`sent_chart_ogive_${paramName}_`);
          });
          if (matchingKey) {
            ogiveBase64 = bulletinMaps[matchingKey];
          }
        }
        if (!ogiveBase64) {
          ogiveBase64 = rasterizedOgives[configKey] || "";
        }

        let donutHTML = "";
        if (donutBase64) {
          donutHTML = `
            <div style="text-align: center; margin-top: 15px; margin-bottom: 25px; page-break-inside: avoid;">
              <img src="${donutBase64}" width="390" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: transparent;" alt="${donutChartTitle}" />
              <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 8px;">Figure ${figIndex++}: ${donutChartTitle}</p>
            </div>
          `;
        }

        let mapHTML = "";
        if (mapImageBase64) {
          mapHTML = `
            <p style="text-align: justify; line-height: 1.6; margin-top: 15px; margin-bottom: 15px;">
              Spatial GIS Map showing ${config.name} (${formatChemicalFormula(configKey)}) distribution is given in figure ${figIndex}.
            </p>
            <div style="text-align: center; margin-top: 15px; margin-bottom: 25px; page-break-inside: avoid;">
              <img src="${mapImageBase64}" width="650" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: transparent;" alt="GIS Spatial Map of ${config.name}" />
              <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 8px;">Figure ${figIndex++}: Spatial GIS Map showing ${config.name} (${formatChemicalFormula(configKey)}) distribution</p>
            </div>
          `;
        }

        let ogiveHTML = "";
        if (ogiveBase64 && allVals.length > 0) {
          const medianVal = getPercentile(allVals, 50);
          const p90Val = getPercentile(allVals, 90);
          const p95Val = getPercentile(allVals, 95);
          const unitLabel = config.unit ? ` ${config.unit}` : "";

          ogiveHTML = `
            <p style="text-align: justify; line-height: 1.6; margin-top: 15px; margin-bottom: 15px;">
              The cumulative probability distribution of ${config.name} is represented by the <strong>Cumulative Frequency (Ogive) Curve</strong> shown in Figure ${figIndex}. An Ogive curve is a non-parametric statistical tool that illustrates the percentage of monitoring locations that fall below any given concentration value.
            </p>
            <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
              For this dataset, the <strong>Median (50th Percentile)</strong> concentration of ${config.name} is <strong>${medianVal.toFixed(2)}${unitLabel}</strong>, indicating that 50% of the monitored sites register concentrations below this value. The <strong>90th Percentile (P90)</strong> concentration is <strong>${p90Val.toFixed(2)}${unitLabel}</strong>, and the <strong>95th Percentile (P95)</strong> is observed at <strong>${p95Val.toFixed(2)}${unitLabel}</strong>, representing the upper bound of the concentration distribution for the vast majority (95%) of the sampling stations. High-slope gradients on the Ogive curve suggest a highly uniform distribution of concentrations within the aquifer, whereas a prolonged, low-slope horizontal trailing tail highlights localized extreme anomalies or contamination hotspots.
            </p>
            <div style="text-align: center; margin-top: 15px; margin-bottom: 25px; page-break-inside: avoid;">
              <img src="${ogiveBase64}" width="750" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: transparent;" alt="Ogive Cumulative Frequency Curve of ${config.name}" />
              <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 8px;">Figure ${figIndex++}: Cumulative Frequency (Ogive) Curve of ${config.name} (${formatChemicalFormula(configKey)}) across monitored stations</p>
            </div>
          `;
        }

        let frequencyHTML = "";
        const freqBase64 = rasterizedFrequencyCharts[configKey] || "";
        if (freqBase64 && allVals.length > 0) {
          frequencyHTML = `
            <div style="text-align: center; margin-top: 15px; margin-bottom: 25px; page-break-inside: avoid;">
              <img src="${freqBase64}" width="750" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: transparent;" alt="Frequency Distribution Diagram of ${config.name}" />
              <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 8px;">Figure ${figIndex++}: Parameter-wise Frequency Distribution Diagram of ${config.name} (${formatChemicalFormula(configKey)}) across monitored stations</p>
            </div>
          `;
        }

        let exceedanceBarChartHTML = "";
        const barChartBase64 = rasterizedExceedanceBarCharts[configKey] || "";
        if (barChartBase64) {
          exceedanceBarChartHTML = `
            <p style="text-align: justify; line-height: 1.6; margin-top: 15px; margin-bottom: 15px;">
              To visually compare the intensity of contamination across different regions, the <strong>Exceedance Percentage Bar Chart</strong> is compiled in Figure ${figIndex}. This chart illustrates the percentage of groundwater sampling locations exceeding the BIS guidelines for ${config.name} (${formatChemicalFormula(configKey)}) within each partially affected ${breakdownLevel === "State" ? "State/UT" : "District"} in descending order of severity.
            </p>
            <div style="text-align: center; margin-top: 15px; margin-bottom: 25px; page-break-inside: avoid;">
              <img src="${barChartBase64}" width="750" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: transparent;" alt="Exceedance rate of ${config.name} by ${breakdownLevel}" />
              <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 8px;">Figure ${figIndex++}: Exceedance Rate of ${config.name} (${formatChemicalFormula(configKey)}) across partially affected ${breakdownLevel === "State" ? "States/UTs" : "Districts"}</p>
            </div>
          `;
        }

        parameterSectionsHTML += `
          <div style="margin-bottom: 40px; page-break-inside: auto;">
            <h4 style="font-size: 13pt; font-weight: bold; margin-top: 25px; color: #1e3a8a; border-bottom: 1.5px solid #94a3b8; padding-bottom: 4px;">4.${subSecIndex++} ${config.name} (${formatChemicalFormula(configKey)})</h4>
            <div style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
              ${description}
            </div>
            ${textSummaryRange}
            
            ${donutHTML}

            ${classificationCaption}
            ${tableInfo.html}

            ${exceedanceBarChartHTML}

            ${tableBReference}
            ${detailedTableHTML}

            ${categorizationParagraph}

            ${mapHTML}

            ${ogiveHTML}

            ${frequencyHTML}

            ${monsoonImpact.html}
            
          </div>
        `;
      }

      // --- Major Ion and Hydrogeochemical Facies (Piper Plot) Section ---
      const EQ_WEIGHTS = {
        Ca: 20.04,
        Mg: 12.15,
        Na: 22.99,
        K: 39.10,
        Cl: 35.45,
        SO4: 48.03,
        HCO3: 61.02,
        CO3: 30.00
      };

      const ION_ALIASES: Record<string, string[]> = {
        Ca: ["ca", "calcium"],
        Mg: ["mg", "magnesium"],
        Na: ["na", "sodium"],
        K: ["k", "potassium"],
        Cl: ["cl", "chloride"],
        SO4: ["so4", "sulphate", "sulfate"],
        HCO3: ["hco3", "bicarbonate"],
        CO3: ["co3", "carbonate"],
        Location: ["location", "village", "site", "name", "site name", "site_name"],
        EC: ["ec", "electrical conductivity", "cond", "conductivity", "el_cond"],
        TDS: ["tds", "total dissolved solids", "dissolved solids", "solids"]
      };

      const localMapping: Record<string, string> = {};
      if (filteredData.length > 0) {
        const rowHeaders = Object.keys(filteredData[0]);
        Object.entries(ION_ALIASES).forEach(([colId, aliases]) => {
          if (colId === "Location" && headers.location) {
            localMapping.Location = headers.location;
            return;
          }
          const mappedCol = Object.keys(headerMap).find(k => headerMap[k] === colId);
          if (mappedCol) {
            localMapping[colId] = mappedCol;
            return;
          }

          const matched = rowHeaders.find(h => {
            return aliases.some(alias => {
              try {
                return new RegExp(`\\b${alias}\\b`, "i").test(h);
              } catch {
                return h.toLowerCase() === alias.toLowerCase();
              }
            });
          });
          if (matched) {
            localMapping[colId] = matched;
          }
        });
      }

      const stateCol = headers && headers.state ? headers.state : null;
      const districtCol = headers && headers.district ? headers.district : null;
      const groupCol = bulletinScope === "National" ? stateCol : districtCol;

      const processedFaciesSamples = filteredData.map((row, index) => {
        const getMappedNum = (id: string): number | null => {
          const key = localMapping[id];
          if (key && row[key] !== undefined && row[key] !== null) {
            const textVal = String(row[key]).trim();
            if (textVal !== "" && textVal !== "-" && textVal !== "—") {
              const val = parseFloat(textVal);
              return isNaN(val) ? null : val;
            }
          }
          return null;
        };

        const ca = getMappedNum("Ca");
        const mg = getMappedNum("Mg");
        const na = getMappedNum("Na");
        const k = getMappedNum("K");
        const cl = getMappedNum("Cl");
        const so4 = getMappedNum("SO4");
        const hco3 = getMappedNum("HCO3");
        const co3 = getMappedNum("CO3");

        const locName = (localMapping.Location && row[localMapping.Location]) ? String(row[localMapping.Location]).trim() : `Site ${index + 1}`;
        const safeVal = (v: number | null) => v === null ? 0 : v;

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

        const catSumReal = meq.Ca + meq.Mg + meq.Na + meq.K;
        const anSumReal = meq.Cl + meq.SO4 + meq.HCO3 + meq.CO3;
        const catSum = catSumReal || 1;
        const anSum = anSumReal || 1;

        const meqPerc = {
          Ca: (meq.Ca / catSum) * 100,
          Mg: (meq.Mg / catSum) * 100,
          Na: (meq.Na / catSum) * 100,
          K: (meq.K / catSum) * 100,
          Cl: (meq.Cl / anSum) * 100,
          SO4: (meq.SO4 / anSum) * 100,
          HCO3: (meq.HCO3 / anSum) * 100,
          CO3: (meq.CO3 / anSum) * 100
        };

        let facies = "Unknown";
        let hasFacies = ca !== null && mg !== null && na !== null && cl !== null && so4 !== null && hco3 !== null;

        if (hasFacies && catSumReal > 0 && anSumReal > 0) {
          const c = meqPerc.Ca + meqPerc.Mg;
          const a = meqPerc.Cl + meqPerc.SO4;
          if (c >= 50 && a >= 50) {
            if (c + a >= 150) facies = "Ca-Cl Type";
            else facies = "Mixed Type A";
          } else if (c >= 50 && a < 50) {
            facies = "Ca-Mg-HCO3 Type";
          } else if (c < 50 && a >= 50) {
            facies = "Na-Cl Type";
          } else if (c < 50 && a < 50) {
            if (c + a >= 50) facies = "Mixed Type B";
            else facies = "Na-HCO3 Type";
          }
        } else {
          hasFacies = false;
        }

        const rawGroupVal = groupCol && row[groupCol] !== undefined && row[groupCol] !== null ? String(row[groupCol]).trim() : "Other";
        const groupVal = rawGroupVal === "" || rawGroupVal === "-" || rawGroupVal === "—" ? "Other" : rawGroupVal;
        const rawStateVal = stateCol && row[stateCol] !== undefined && row[stateCol] !== null ? String(row[stateCol]).trim() : "";

        const hasSAR = ca !== null && mg !== null && na !== null;
        const sar = hasSAR && (meq.Ca + meq.Mg > 0) ? (meq.Na / Math.sqrt((meq.Ca + meq.Mg) / 2)) : null;

        const hasRSC = ca !== null && mg !== null && hco3 !== null;
        const rsc = hasRSC ? ((meq.HCO3 + meq.CO3) - (meq.Ca + meq.Mg)) : null;

        const ecVal = getMappedNum("EC");
        let tdsVal = getMappedNum("TDS");
        if (tdsVal === null && ecVal !== null) {
          tdsVal = ecVal * 0.65;
        }

        const hasGibbs = tdsVal !== null && tdsVal > 0 && na !== null && ca !== null && cl !== null && hco3 !== null;
        const gibbsCation = hasGibbs ? (meq.Na + meq.K) / (meq.Na + meq.K + meq.Ca || 1) : null;
        const gibbsAnion = hasGibbs ? meq.Cl / (meq.Cl + meq.HCO3 || 1) : null;

        return {
          locName,
          meqPerc,
          facies,
          hasFacies,
          groupVal,
          stateVal: rawStateVal,
          sar,
          rsc,
          hasSAR,
          hasRSC,
          ecVal,
          tdsVal,
          hasGibbs,
          gibbsCation,
          gibbsAnion
        };
      });

      const validFaciesSamples = processedFaciesSamples.filter(s => s.hasFacies);
      const totalValidFacies = validFaciesSamples.length;

      // Calculate distinct group counts for dynamic color mapping
      const groupCounts: Record<string, number> = {};
      validFaciesSamples.forEach(s => {
        const g = s.groupVal || "Other";
        groupCounts[g] = (groupCounts[g] || 0) + 1;
      });

      // Sort unique groups by sample count descending so top regions get beautiful, vibrant colors
      const sortedGroups = Object.keys(groupCounts).sort((a, b) => groupCounts[b] - groupCounts[a]);

      // Professional, highly distinct color palette for up to 14 groups
      const PALETTE = [
        "#2563eb", // Vibrant Blue
        "#10b981", // Emerald Green
        "#ef4444", // Coral Red
        "#f59e0b", // Amber Yellow
        "#8b5cf6", // Purple
        "#ec4899", // Warm Pink
        "#06b6d4", // Clear Cyan
        "#f97316", // Bright Orange
        "#14b8a6", // Teal
        "#6366f1", // Indigo
        "#a855f7", // Lavender/Purple-Light
        "#059669", // Dark Green
        "#dc2626", // Dark Red
        "#d97706"  // Dark Gold
      ];

      const groupColorMap: Record<string, string> = {};
      sortedGroups.forEach((g, idx) => {
        if (g === "Other") {
          groupColorMap[g] = "#94a3b8"; // Muted slate gray for unspecified
        } else if (idx < 14) {
          groupColorMap[g] = PALETTE[idx];
        } else {
          groupColorMap[g] = "#94a3b8"; // Fallback to slate gray for smaller minor groups
        }
      });
      groupColorMap["Other"] = "#94a3b8";

      const faciesCounts: Record<string, number> = {
        "Ca-Mg-HCO3 Type": 0,
        "Mixed Type A": 0,
        "Mixed Type B": 0,
        "Na-Cl Type": 0,
        "Na-HCO3 Type": 0,
        "Ca-Cl Type": 0,
        "Unknown": 0
      };

      validFaciesSamples.forEach(s => {
        if (faciesCounts[s.facies] !== undefined) {
          faciesCounts[s.facies]++;
        } else {
          faciesCounts["Unknown"]++;
        }
      });

      const getFaciesPct = (count: number) => totalValidFacies > 0 ? ((count / totalValidFacies) * 100).toFixed(2) : "0.00";

      const pCaHCO3Val = parseFloat(getFaciesPct(faciesCounts["Ca-Mg-HCO3 Type"]));
      const pMixedVal = parseFloat(getFaciesPct(faciesCounts["Mixed Type A"] + faciesCounts["Mixed Type B"]));
      const pNaClVal = parseFloat(getFaciesPct(faciesCounts["Na-Cl Type"]));
      const pNaHCO3Val = parseFloat(getFaciesPct(faciesCounts["Na-HCO3 Type"]));
      const pCaCl2Val = parseFloat(getFaciesPct(faciesCounts["Ca-Cl Type"]));

      const hasCompleteFaciesData = totalValidFacies > 0;

      const getDiagramCaption = (type: "Piper" | "USSL" | "Gibbs", label: string, samples: any[]) => {
        const isNational = bulletinScope === "National";
        const typeLabel = isNational ? "States/UT" : "Districts";
        
        let suffix = "";
        const lowerLabel = label.toLowerCase();
        if (lowerLabel.includes("national") || lowerLabel.includes("overall level")) {
          suffix = isNational ? "All States/UTs" : `All Districts of ${bulletinScope}`;
        } else if (lowerLabel.includes("overall state level")) {
          suffix = `All Districts of ${bulletinScope}`;
        } else if (lowerLabel.includes("district:") || lowerLabel.includes("district :")) {
          const dName = label.replace(/district\s*:\s*/gi, "").trim();
          suffix = dName;
        } else {
          // Check if this label matches a custom set name
          const matchedCustomSet = customSets?.find(s => s.name === label);
          if (matchedCustomSet) {
            suffix = matchedCustomSet.selectedLocations.join(", ");
          } else {
            // Check if label contains some specific location names or rset samples
            const locs = Array.from(new Set(samples.map((s: any) => isNational ? s.stateVal : s.groupVal).filter(Boolean)));
            if (locs.length > 0) {
              suffix = locs.join(", ");
            } else {
              suffix = label;
            }
          }
        }

        const diagramName = type === "Piper" 
          ? "Piper Trilinear Diagram" 
          : type === "USSL" 
            ? "U.S. Salinity Laboratory (USSL) Diagram" 
            : "Gibbs Diagram";

        return `${diagramName} for the ${typeLabel} : ${suffix}`;
      };

      // Define custom renderSets for the diagrams
      interface RenderSet {
        name: string;
        samples: typeof validFaciesSamples;
        description: string;
      }
      
      const renderSets: RenderSet[] = [];
      if (customSets && customSets.length > 0) {
        customSets.forEach((set) => {
          const matchedSamples = validFaciesSamples.filter((s) => {
            const locVal = bulletinScope === "National" ? s.stateVal : s.groupVal;
            return set.selectedLocations.some(
              (sel) => sel.toLowerCase() === locVal.toLowerCase()
            );
          });
          renderSets.push({
            name: set.name,
            samples: matchedSamples,
            description: `This custom diagram set includes ${matchedSamples.length} samples from: ${set.selectedLocations.join(", ")}.`
          });
        });
      } else {
        renderSets.push({
          name: bulletinScope === "National" ? "National / Overall Level (All States)" : `Overall State Level (${bulletinScope})`,
          samples: validFaciesSamples,
          description: `This diagram displays the chemical water types for all ${validFaciesSamples.length} monitoring points.`
        });
      }

      const dCaHCO3 = hasCompleteFaciesData ? `${pCaHCO3Val.toFixed(2)}%` : "44.25% (National)";
      const dMixed = hasCompleteFaciesData ? `${pMixedVal.toFixed(2)}%` : "37.55% (National)";
      const dNaCl = hasCompleteFaciesData ? `${pNaClVal.toFixed(2)}%` : "9.21% (National)";
      const dNaHCO3 = hasCompleteFaciesData ? `${pNaHCO3Val.toFixed(2)}%` : "7.39% (National)";
      const dCaCl2 = hasCompleteFaciesData ? `${pCaCl2Val.toFixed(2)}%` : "1.60% (National)";

      // Regional matchers for India state names (UP, Bihar, Jharkhand, Chhattisgarh, West Bengal, MP, Sikkim, North Eastern States, Ladakh, J&K, Himachal, Uttarakhand, Delhi, Haryana, Punjab, Rajasthan, Gujarat, Maharashtra, Karnataka, Telangana, AP, Tamil Nadu, Kerala)
      const matchesRegionA = (state: string): boolean => {
        const s = state.toLowerCase();
        return s.includes("uttar pradesh") || s.includes("up") || s.includes("bihar") || s.includes("jharkhand") || s.includes("chhattisgarh") || s.includes("chattisgar") || s.includes("west bengal") || s.includes("madhya pradesh") || s.includes("mp");
      };

      const matchesRegionB = (state: string): boolean => {
        const s = state.toLowerCase();
        return s.includes("sikkim") || s.includes("assam") || s.includes("arunachal") || s.includes("manipur") || s.includes("meghalaya") || s.includes("mizoram") || s.includes("nagaland") || s.includes("tripura") || s.includes("ladakh") || s.includes("jammu") || s.includes("j&k") || s.includes("himachal") || s.includes("uttarakhand") || s.includes("uttaranchal");
      };

      const matchesRegionC = (state: string): boolean => {
        const s = state.toLowerCase();
        return s.includes("delhi") || s.includes("haryana") || s.includes("punjab") || s.includes("rajasthan") || s.includes("rajsthan") || s.includes("gujarat") || s.includes("gujrat");
      };

      const matchesRegionD = (state: string): boolean => {
        const s = state.toLowerCase();
        return s.includes("maharashtra") || s.includes("maharastra") || s.includes("karnataka");
      };

      const matchesRegionE = (state: string): boolean => {
        const s = state.toLowerCase();
        return s.includes("telangana") || s.includes("andhra") || s.includes("ap") || s.includes("tamil") || s.includes("kerala");
      };

      // Reusable Piper Diagram SVG generator without legend for high-definition rendering
      const generatePiperDiagramHTML = (title: string, samples: typeof validFaciesSamples, groupColorMap: Record<string, string>) => {
        if (samples.length === 0) {
          return `
            <div style="background-color: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 25px; text-align: center; margin: 20px 0; max-width: 500px; margin-left: auto; margin-right: auto;">
              <p style="font-weight: bold; font-size: 11pt; color: #475569; margin: 0 0 10px 0;">Piper Trilinear Diagram (No Data)</p>
              <p style="font-size: 9.5pt; color: #64748b; line-height: 1.5; max-width: 400px; margin: 0 auto;">
                No samples were found in the uploaded dataset for: <strong>${title}</strong>.
              </p>
            </div>
          `;
        }

        const SQRT3 = Math.sqrt(3);
        const H_val = (100 * SQRT3) / 2;
        const tx = (x: number) => x + 40;
        const ty = (y: number) => 230 - y;
        const gridLineColor = "#e2e8f0";
        const frameColor = "#1f2937";

        let gridLines = "";
        for (let i = 20; i < 100; i += 20) {
          const y = (i * SQRT3) / 2;
          const strokeProps = `stroke="${gridLineColor}" stroke-dasharray="2 2" stroke-width="0.8" fill="none"`;
          gridLines += `<line x1="${tx(0.5 * i)}" y1="${ty(y)}" x2="${tx(100 - 0.5 * i)}" y2="${ty(y)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(i)}" y1="${ty(0)}" x2="${tx(50 + 0.5 * i)}" y2="${ty(((100 - i) * SQRT3) / 2)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(100 - i)}" y1="${ty(0)}" x2="${tx(0.5 * (100 - i))}" y2="${ty(((100 - i) * SQRT3) / 2)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(120 + 0.5 * i)}" y1="${ty(y)}" x2="${tx(220 - 0.5 * i)}" y2="${ty(y)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(120 + i)}" y1="${ty(0)}" x2="${tx(170 + 0.5 * i)}" y2="${ty(((100 - i) * SQRT3) / 2)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(220 - i)}" y1="${ty(0)}" x2="${tx(120 + 0.5 * (100 - i))}" y2="${ty(((100 - i) * SQRT3) / 2)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(110 - 0.5 * i)}" y1="${ty(10 * SQRT3 + 0.5 * i * SQRT3)}" x2="${tx(160 - 0.5 * i)}" y2="${ty(60 * SQRT3 + 0.5 * i * SQRT3)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(110 + 0.5 * i)}" y1="${ty(10 * SQRT3 + 0.5 * i * SQRT3)}" x2="${tx(60 + 0.5 * i)}" y2="${ty(60 * SQRT3 + 0.5 * i * SQRT3)}" ${strokeProps} />`;
        }

        let pointsMarkup = "";
        const pointRadius = 0.55;

        samples.forEach((d) => {
          const ca = d.meqPerc.Ca || 0;
          const mg = d.meqPerc.Mg || 0;
          const nak = (d.meqPerc.Na || 0) + (d.meqPerc.K || 0);
          const cl = d.meqPerc.Cl || 0;
          const so4 = d.meqPerc.SO4 || 0;
          const hco3 = (d.meqPerc.HCO3 || 0) + (d.meqPerc.CO3 || 0);

          if (ca + mg + nak === 0 || cl + so4 + hco3 === 0) return;

          const xc = nak + 0.5 * mg;
          const yc = (mg * SQRT3) / 2;
          const xa = 120 + cl + 0.5 * so4;
          const ya = (so4 * SQRT3) / 2;
          const xd = 0.5 * (xa + xc) + (ya - yc) / (2 * SQRT3);
          const yd = SQRT3 * (xd - xc) + yc;

          const color = groupColorMap[d.groupVal || "Other"] || "#94a3b8";

          pointsMarkup += `
            <circle cx="${tx(xc)}" cy="${ty(yc)}" r="${pointRadius}" fill="${color}" fill-opacity="0.95" />
            <circle cx="${tx(xa)}" cy="${ty(ya)}" r="${pointRadius}" fill="${color}" fill-opacity="0.95" />
            <circle cx="${tx(xd)}" cy="${ty(yd)}" r="${pointRadius}" fill="${color}" fill-opacity="0.95" />
          `;
        });

        const svgMarkup = `
          <svg viewBox="-20 15 340 240" width="600" height="440" style="background: transparent; font-family: 'Times New Roman', Times, serif; margin: 0 auto; display: block;" xmlns="http://www.w3.org/2000/svg">
            <line x1="${tx(25)}" y1="${ty(H_val / 2)}" x2="${tx(75)}" y2="${ty(H_val / 2)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />
            <line x1="${tx(25)}" y1="${ty(H_val / 2)}" x2="${tx(50)}" y2="${ty(0)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />
            <line x1="${tx(75)}" y1="${ty(H_val / 2)}" x2="${tx(50)}" y2="${ty(0)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />

            <line x1="${tx(145)}" y1="${ty(H_val / 2)}" x2="${tx(195)}" y2="${ty(H_val / 2)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />
            <line x1="${tx(145)}" y1="${ty(H_val / 2)}" x2="${tx(170)}" y2="${ty(0)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />
            <line x1="${tx(195)}" y1="${ty(H_val / 2)}" x2="${tx(170)}" y2="${ty(0)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />

            <line x1="${tx(85)}" y1="${ty(85 * SQRT3)}" x2="${tx(135)}" y2="${ty(85 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />
            <line x1="${tx(85)}" y1="${ty(35 * SQRT3)}" x2="${tx(135)}" y2="${ty(35 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />
            <line x1="${tx(85)}" y1="${ty(85 * SQRT3)}" x2="${tx(110)}" y2="${ty(60 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />
            <line x1="${tx(135)}" y1="${ty(85 * SQRT3)}" x2="${tx(110)}" y2="${ty(60 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />
            <line x1="${tx(85)}" y1="${ty(35 * SQRT3)}" x2="${tx(110)}" y2="${ty(60 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />
            <line x1="${tx(135)}" y1="${ty(35 * SQRT3)}" x2="${tx(110)}" y2="${ty(60 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.4" />

            <g>${gridLines}</g>

            <path d="M ${tx(0)} ${ty(0)} L ${tx(100)} ${ty(0)} L ${tx(50)} ${ty(H_val)} Z" stroke="${frameColor}" stroke-width="1.2" fill="none" stroke-linejoin="round" />
            <path d="M ${tx(120)} ${ty(0)} L ${tx(220)} ${ty(0)} L ${tx(170)} ${ty(H_val)} Z" stroke="${frameColor}" stroke-width="1.2" fill="none" stroke-linejoin="round" />
            <path d="M ${tx(110)} ${ty(10 * SQRT3)} L ${tx(160)} ${ty(60 * SQRT3)} L ${tx(110)} ${ty(110 * SQRT3)} L ${tx(60)} ${ty(60 * SQRT3)} Z" stroke="${frameColor}" stroke-width="1.2" fill="none" stroke-linejoin="round" />

            <text transform="translate(${tx(50)}, ${ty(-12)}) rotate(0)" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold" font-family="'Times New Roman', Times, serif">Ca²⁺</text>
            <text transform="translate(${tx(82)}, ${ty(45)}) rotate(60)" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold" font-family="'Times New Roman', Times, serif">Na⁺ + K⁺</text>
            <text transform="translate(${tx(18)}, ${ty(45)}) rotate(-60)" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold" font-family="'Times New Roman', Times, serif">Mg²⁺</text>
 
            <text transform="translate(${tx(138)}, ${ty(45)}) rotate(-60)" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold" font-family="'Times New Roman', Times, serif">HCO₃⁻ + CO₃²⁻</text>
            <text transform="translate(${tx(170)}, ${ty(-12)}) rotate(0)" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold" font-family="'Times New Roman', Times, serif">Cl⁻</text>
            <text transform="translate(${tx(202)}, ${ty(45)}) rotate(60)" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold" font-family="'Times New Roman', Times, serif">SO₄²⁻</text>

            <text transform="translate(${tx(75)}, ${ty(135)}) rotate(-60)" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold" font-family="'Times New Roman', Times, serif">SO₄²⁻ + Cl⁻</text>
            <text transform="translate(${tx(145)}, ${ty(135)}) rotate(60)" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold" font-family="'Times New Roman', Times, serif">Ca²⁺ + Mg²⁺</text>

            <g>${pointsMarkup}</g>
          </svg>
        `;

        return `
          <div style="text-align: center; margin-top: 5px; margin-bottom: 10px; page-break-inside: avoid;">
            <div style="display: inline-block; padding: 0px; border: none; background: transparent; box-shadow: none;">
              ${svgMarkup}
            </div>
            <p style="text-align: center; font-style: italic; font-size: 10pt; margin-top: 5px; color: #475569;">
              <strong>Figure ${figIndex++}:</strong> ${getDiagramCaption("Piper", title, samples)}
            </p>
          </div>
        `;
      };

      let piperPlotHTML = "";
      let regionalPiperHTML = "";
      let districtPiperHTML = "";
      let faciesListHTML = "";
      let overallFaciesSummaryParagraph = "";

      if (hasCompleteFaciesData) {
        if (customSets && customSets.length > 0) {
          piperPlotHTML = `<div style="display: flex; flex-direction: column; gap: 30px; margin-top: 20px;">`;
          renderSets.forEach((rset) => {
            const plotMarkup = generatePiperDiagramHTML(rset.name, rset.samples, groupColorMap);
            piperPlotHTML += `
              <div style="background-color: #ffffff; padding: 20px; margin-bottom: 20px; page-break-inside: avoid; text-align: center;">
                <h5 style="margin: 0 0 10px 0; font-size: 11pt; font-weight: bold; color: #1e3a8a; text-align: left; border-bottom: 2px dotted #1e3a8a; padding-bottom: 5px;"></h5>
                <div style="display: inline-block; margin: 0 auto;">
                  ${plotMarkup}
                </div>
              </div>
            `;
          });
          piperPlotHTML += `</div>`;
          regionalPiperHTML = "";
          districtPiperHTML = "";

          faciesListHTML = `
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>Custom Diagram Sets Overview:</strong> Cation-anion distributions are organized across selected customized groupings of states/districts to isolate localized recharge signatures, rock-water interaction indices, and mineralization gradients.
            </li>
          `;
          overallFaciesSummaryParagraph = `
            Overall, the customized Hydrochemical diagram sets allow comparative hydrogeochemical profiling across regional domains, highlighting specific ionic compositions and mineral signatures unique to the selected state/district combinations.
          `;
        } else if (bulletinScope === "National") {
          piperPlotHTML = generatePiperDiagramHTML("National / Overall Level (All States)", validFaciesSamples, groupColorMap);
          regionalPiperHTML = "";

          faciesListHTML = `
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>Ca-HCO₃ Type (Temporary Hardness, Freshwater Signature) — Representing ${dCaHCO3}:</strong><br/>
              Ca-HCO₃ is the most widespread facies, dominating in many states. High proportions are seen in Jammu & Kashmir (95.9%), Uttarakhand (90.4%), Uttar Pradesh (82.8%), Chhattisgarh (77.8%), and Madhya Pradesh (70.8%). This facies reflects carbonate weathering and recharge from fresh rainfall, and it marks the primary hydro chemical signature in Himalayan foothills, central India, and Indo-Gangetic plains.
            </li>
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>Mixed Type (Ca–Mg–Cl–SO₄ and Variable Combinations) — Representing ${dMixed}:</strong><br/>
              Mixed facies are widespread and significant, with particularly high proportions in Jharkhand (89.1%), Kerala (81%), Meghalaya (73.7%), Tamil Nadu (56.9%), and West Bengal (54.3%). This indicates areas where multiple hydro chemical processes interact, often influenced by complex lithology, anthropogenic inputs, and hydrogeological mixing. Southern and northeastern states show clear dominance of mixed water types.
            </li>
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>NaCl Type (Saline Water) — Representing ${dNaCl}:</strong><br/>
              NaCl (saline facies) is strongly dominant in coastal and arid regions, especially Gujarat (53.7%), Rajasthan (55%), and Delhi (47.4%). Other significant shares appear in Nagaland (24.2%) and Tripura (23.3%). This facies is strongly associated with marine influence (coastal areas), salinity ingress in aquifers, and anthropogenic contamination. Its dominance in western India (Rajasthan, Gujarat) reflects arid climate and evaporation-driven salinization.
            </li>
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>Na-HCO₃ Type (Alkali Bicarbonate Water) — Representing ${dNaHCO3}:</strong><br/>
              Na-HCO₃ facies is moderately represented across India, with significant dominance in Punjab (39.6%), Haryana (28.1%), and Andhra Pradesh (26.7%). States such as Jharkhand, Kerala, Chhattisgarh, Jammu & Kashmir, and Tripura report negligible or no presence. Overall, Na-HCO₃ occurs mostly in alluvial plains (Punjab, Haryana, UP) and hard rock terrains (Andhra, Karnataka), indicating cation exchange and alkali enrichment in groundwater.
            </li>
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>CaCl₂ Type (Permanent Hardness Water) — Representing ${dCaCl2}:</strong><br/>
              CaCl₂ facies is generally minor but notable in some regions. The highest values occur in Haryana (9.2%), Delhi (6.3%), and Himachal Pradesh (6.7%). Most other states report less than 3%. Its occurrence is linked to saline intrusion, industrial effluents, and evaporite dissolution, often concentrated in urban/semi-arid regions.
            </li>
          `;

          overallFaciesSummaryParagraph = `
            Overall, the dominance of Ca-HCO₃ and Mixed type facies reflects the natural buffering capacity of aquifers, but the presence of saline and alkali-rich waters (NaCl and Na-HCO₃) in nearly 17% of samples points to increasing water quality stress in specific hydrogeological settings.
          `;
        } else {
          // --- State Level Customization ---
          piperPlotHTML = generatePiperDiagramHTML(`Overall State Level (${bulletinScope})`, validFaciesSamples, groupColorMap);

          const distinctDistricts = Array.from(new Set(validFaciesSamples.map(s => s.groupVal).filter(Boolean))).sort();
          districtPiperHTML = `
            <h4 style="font-size: 13pt; font-weight: bold; color: #1e3a8a; margin-top: 35px; margin-bottom: 10px; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 5px; page-break-before: always;">5.1 District-wise Groundwater Hydrochemical Facies Analysis</h4>
            <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
              To provide highly localized hydrogeochemical insights within <strong>${titleRegion}</strong>, groundwater samples have been grouped and plotted individually for each monitoring district. This displays the distinct chemical water types (e.g., Na-Cl type, Ca-HCO₃ type, or Mixed type) prevalent in each local administrative division:
            </p>
            <div style="display: grid; grid-template-columns: 1fr; gap: 25px; margin-top: 25px;">
          `;

          distinctDistricts.forEach((dist) => {
            const distSamples = validFaciesSamples.filter(s => s.groupVal === dist);
            const distPlot = generatePiperDiagramHTML(`District: ${dist}`, distSamples, groupColorMap);
            
            // Calculate dominant water type for this district
            const distFaciesCounts: Record<string, number> = {};
            distSamples.forEach(s => {
              distFaciesCounts[s.facies] = (distFaciesCounts[s.facies] || 0) + 1;
            });
            const sortedDistFacies = Object.keys(distFaciesCounts).sort((a,b) => distFaciesCounts[b] - distFaciesCounts[a]);
            const dominantType = sortedDistFacies[0] || "Unknown Type";

            districtPiperHTML += `
              <div style="background-color: transparent; border: none; padding: 20px; box-shadow: none; text-align: center; page-break-inside: avoid;">
                <h5 style="margin: 0 0 10px 0; font-size: 11pt; font-weight: bold; color: #1e3a8a;">District: ${dist}</h5>
                <p style="font-size: 9.5pt; color: #475569; line-height: 1.4; max-width: 600px; margin: 0 auto 10px auto; text-align: justify;">
                  This district includes <strong>${distSamples.length}</strong> analyzed samples. Cation-anion balance reveals that the water quality in <strong>${dist}</strong> is predominantly characterized by the <strong>${dominantType}</strong> chemical configuration, reflecting localized geological interactions and groundwater flow regimes.
                </p>
                ${distPlot}
              </div>
            `;
          });

          districtPiperHTML += `</div>`;

          // --- State Level Custom Facies Descriptions by District ---
          const getFaciesDistrictsList = (targetFaciesList: string[]) => {
            const distData: Record<string, { total: number; match: number }> = {};
            validFaciesSamples.forEach(s => {
              const dist = s.groupVal || "Other";
              if (!distData[dist]) distData[dist] = { total: 0, match: 0 };
              distData[dist].total++;
              if (targetFaciesList.includes(s.facies)) {
                distData[dist].match++;
              }
            });

            const results = Object.keys(distData)
              .map(dist => {
                const info = distData[dist];
                const pct = info.total > 0 ? (info.match / info.total) * 100 : 0;
                return { dist, pct, count: info.match };
              })
              .filter(r => r.count > 0 && r.dist !== "Other")
              .sort((a, b) => b.pct - a.pct);

            if (results.length === 0) return "negligible or no districts";
            return results.slice(0, 4).map(r => `<strong>${r.dist}</strong> (${r.pct.toFixed(1)}%)`).join(", ");
          };

          const listCaHCO3 = getFaciesDistrictsList(["Ca-Mg-HCO3 Type"]);
          const listMixed = getFaciesDistrictsList(["Mixed Type A", "Mixed Type B"]);
          const listNaCl = getFaciesDistrictsList(["Na-Cl Type"]);
          const listNaHCO3 = getFaciesDistrictsList(["Na-HCO3 Type"]);
          const listCaCl2 = getFaciesDistrictsList(["Ca-Cl Type"]);

          faciesListHTML = `
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>Ca-HCO₃ Type (Temporary Hardness, Freshwater Signature) — Representing ${dCaHCO3}:</strong><br/>
              Ca-HCO₃ is characterized by fresh rainfall recharge and carbonate weathering. Inside <strong>${bulletinScope}</strong>, high proportions of this facies are particularly observed in the following districts: ${listCaHCO3}. This facies generally represents fresh potable groundwater with low mineral dissolution.
            </li>
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>Mixed Type (Ca–Mg–Cl–SO₄ and Variable Combinations) — Representing ${dMixed}:</strong><br/>
              Mixed facies represent transition zones where multiple geochemical processes (such as rock-water interaction and local agricultural runoff) blend together. In this state, it is most prominent in: ${listMixed}.
            </li>
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>NaCl Type (Saline Water Signature) — Representing ${dNaCl}:</strong><br/>
              NaCl facies represents high mineralized and evaporated saline groundwater. It is heavily pronounced in: ${listNaCl}. The prevalence of this facies in these districts points to severe arid climate conditions, high localized evaporation rates, or saline groundwater upconing.
            </li>
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>Na-HCO₃ Type (Alkali Bicarbonate Water) — Representing ${dNaHCO3}:</strong><br/>
              Na-HCO₃ facies indicates advanced cation exchange where calcium/magnesium ions are replaced by sodium. This water type is primarily found in: ${listNaHCO3}.
            </li>
            <li style="margin-bottom: 12px; text-align: justify;">
              <strong>CaCl₂ Type (Permanent Hardness Water) — Representing ${dCaCl2}:</strong><br/>
              CaCl₂ is an uncommon facies indicating highly weathered and concentrated brackish conditions. It is mainly registered in: ${listCaCl2}.
            </li>
          `;

          overallFaciesSummaryParagraph = `
            Overall, the dynamic water quality analysis of <strong>${bulletinScope}</strong> indicates a distinct hydrogeochemical layout where safe compliance configurations coexist with specialized geogenic hotspots across specific administrative districts.
          `;
        }
      } else {
        piperPlotHTML = `
          <div style="background-color: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 25px; text-align: center; margin: 25px 0;">
            <p style="font-weight: bold; font-size: 11pt; color: #475569; margin: 0 0 10px 0;">Piper Trilinear Diagram (Not Plotted)</p>
            <p style="font-size: 9.5pt; color: #64748b; line-height: 1.5; max-width: 550px; margin: 0 auto;">
              Complete major ionic concentration data (Ca²⁺, Mg²⁺, Na⁺, K⁺, Cl⁻, SO₄²⁻, and HCO₃⁻) was not fully mapped in the uploaded dataset. 
              To automatically display a custom Piper diagram here, make sure your source spreadsheet contains these major ions and map them in the primary parameters tab.
            </p>
          </div>
        `;
      }

      const faciesHeading = "5.0 Hydrogeochemistry and Piper Plot Analysis";
      const faciesP1 = `Hydrogeochemistry plots are valuable tools for assessing groundwater quality data. These plots help visualize the chemical composition of groundwater and reveal important trends, relationships, and potential issues related to the water quality. The <strong>Piper plot (Piper 1944)</strong> is a crucial tool in a water quality report, especially for groundwater studies, as it provides a clear visual representation of the chemical composition of groundwater quality data. It helps interpret complex ionic data and enables the comparison of water samples based on their dominant ion composition.`;
      const faciesP2 = `Based on the major cation and major anion content in the water samples and plotting them in the trilinear diagram, hydrochemical facies could be identified. In India, cation chemistry is dominated by Calcium (Ca²⁺) followed by Sodium (Na⁺) and Potassium (K⁺). In anion side, Bicarbonate (HCO₃⁻) is the dominating anion followed by Chloride (Cl⁻) and Sulphate (SO₄²⁻).`;
      const faciesP3 = `The hydrochemical facies analysis of groundwater during this period reveals the baseline groundwater chemistry across ${titleRegion.toUpperCase() === "INDIA" ? "India" : titleRegion}. Safe and stable chemical configurations dominate, but substantial heterogeneity highlights localized quality stresses.`;
      const faciesSubheading = "Facies-Wise Summary of Groundwater Chemistry";

      let faciesSummaryHTML = `
        <h3 style="font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #475569; padding-bottom: 5px; margin-top: 35px; page-break-before: always;">${faciesHeading}</h3>
        <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
          ${faciesP1}
        </p>
        <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
          ${faciesP2}
        </p>

        ${piperPlotHTML}

        <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
          ${faciesP3}
        </p>

        <h4 style="font-size: 12pt; font-weight: bold; color: #1e3a8a; margin-top: 20px; margin-bottom: 10px;">${faciesSubheading}</h4>
        
        <ol style="line-height: 1.6; padding-left: 20px; margin-bottom: 25px;">
          ${faciesListHTML}
        </ol>

        <p style="text-align: justify; line-height: 1.6; margin-bottom: 20px;">
          ${overallFaciesSummaryParagraph}
        </p>

        <table style="width: 100%; border-collapse: collapse; margin: 25px 0; font-size: 10pt; font-family: 'Times New Roman', serif;">
          <thead>
            <tr style="background-color: #1e3a8a; color: white;">
              <th style="padding: 10px; border: 1px solid #1e3a8a; text-align: left; font-weight: bold;">Hydrochemical Facies Type</th>
              <th style="padding: 10px; border: 1px solid #1e3a8a; text-align: center; font-weight: bold;">Dominant Mineral/Signature</th>
              <th style="padding: 10px; border: 1px solid #1e3a8a; text-align: center; font-weight: bold;">Sample Count</th>
              <th style="padding: 10px; border: 1px solid #1e3a8a; text-align: center; font-weight: bold;">Proportion (%)</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background-color: #f8fafc;">
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Ca-HCO₃ Type</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-style: italic;">Carbonate weathering / Fresh recharge</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${hasCompleteFaciesData ? faciesCounts["Ca-Mg-HCO3 Type"] : "N/A"}</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: bold; color: #a855f7;">${dCaHCO3}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Mixed Type</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-style: italic;">Lithological mixing / Transitional water</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${hasCompleteFaciesData ? (faciesCounts["Mixed Type A"] + faciesCounts["Mixed Type B"]) : "N/A"}</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: bold; color: #10b981;">${dMixed}</td>
            </tr>
            <tr style="background-color: #f8fafc;">
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">NaCl Type</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-style: italic;">Coastal intrusion / Arid salinization</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${hasCompleteFaciesData ? faciesCounts["Na-Cl Type"] : "N/A"}</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: bold; color: #ec4899;">${dNaCl}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Na-HCO₃ Type</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-style: italic;">Cation exchange / Alkali enrichment</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${hasCompleteFaciesData ? faciesCounts["Na-HCO3 Type"] : "N/A"}</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: bold; color: #06b6d4;">${dNaHCO3}</td>
            </tr>
            <tr style="background-color: #f8fafc;">
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">CaCl₂ Type</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-style: italic;">Permanent hardness / Industrial effluents</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${hasCompleteFaciesData ? faciesCounts["Ca-Cl Type"] : "N/A"}</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: bold; color: #eab308;">${dCaCl2}</td>
            </tr>
          </tbody>
        </table>
        <p style="text-align: center; font-weight: bold; font-size: 10.5pt; margin-top: 5px; margin-bottom: 25px; color: #1e3a8a;">
          Table ${tblIndex++}: ${bulletinScope === "National" ? "National and Regional" : `Percent`} Distribution of Hydrochemical Facies${bulletinScope !== "National" ? ` in ${toProperCase(bulletinScope)}` : ""}
        </p>

        ${regionalPiperHTML}
      `;

      let gibbsPlotHTML = "";
      if (hasCompleteFaciesData) {
        gibbsPlotHTML = `
          <h4 style="font-size: 13pt; font-weight: bold; color: #1e3a8a; margin-top: 35px; margin-bottom: 10px; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 5px; page-break-before: always;">5.2 Gibbs Mechanisms of Aquifer Chemistry</h4>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            The <strong>Gibbs Diagrams (Gibbs 1970)</strong> are widely used to understand the functional mechanisms controlling groundwater chemistry, distinguishing among three major natural processes: <strong>precipitation dominance</strong> (low TDS, high Na/Cl ratios), <strong>rock-weathering dominance</strong> (medium TDS, low Na/Cl ratios), and <strong>evaporation-crystallization dominance</strong> (very high TDS, high Na/Cl ratios).
          </p>
          <div style="display: flex; flex-direction: column; gap: 35px; margin-top: 20px;">
        `;
        
        renderSets.forEach((rset) => {
          const gibbsCationSVG = generateGibbsDiagramHTML("cation", `Cation Dominance - ${rset.name}`, rset.samples, groupColorMap);
          const gibbsAnionSVG = generateGibbsDiagramHTML("anion", `Anion Dominance - ${rset.name}`, rset.samples, groupColorMap);
          
          gibbsPlotHTML += `
            <div style="background-color: #ffffff; padding: 25px; page-break-inside: avoid; text-align: center; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px;">
              <div style="display: flex; flex-direction: row; justify-content: center; gap: 20px; flex-wrap: wrap;">
                <div style="width: 280px; display: inline-block; vertical-align: top;">
                  ${gibbsCationSVG}
                </div>
                <div style="width: 280px; display: inline-block; vertical-align: top;">
                  ${gibbsAnionSVG}
                </div>
              </div>
              <p style="text-align: center; font-style: italic; font-size: 10pt; margin-top: 15px; color: #475569;">
                <strong>Figure ${figIndex++}:</strong> ${getDiagramCaption("Gibbs", rset.name, rset.samples)}
              </p>
            </div>
          `;
        });
        
        gibbsPlotHTML += `</div>`;
      }

      faciesSummaryHTML += gibbsPlotHTML;

      // --- Agricultural Suitability and Alkali Hazard (SAR & RSC) Section ---
      let agriculturalSuitabilityHTML = "";
      const sarSamples = processedFaciesSamples.filter((s) => s.hasSAR && s.sar !== null);
      const totalSARSamples = sarSamples.length;
      const rscSamples = processedFaciesSamples.filter((s) => s.hasRSC && s.rsc !== null);
      const totalRSCSamples = rscSamples.length;

      if (totalSARSamples > 0 || totalRSCSamples > 0) {
        // --- 1. SAR Computations ---
        let s1Count = 0;
        let s2Count = 0;
        let s3Count = 0;
        let s4Count = 0;

        let sarMin = Infinity;
        let sarMax = -Infinity;
        let sarSum = 0;

        sarSamples.forEach((s) => {
          const v = s.sar!;
          if (v < sarMin) sarMin = v;
          if (v > sarMax) sarMax = v;
          sarSum += v;

          if (v < 10) s1Count++;
          else if (v <= 18) s2Count++;
          else if (v <= 26) s3Count++;
          else s4Count++;
        });

        const s1Pct = totalSARSamples > 0 ? (s1Count / totalSARSamples) * 100 : 0;
        const s2Pct = totalSARSamples > 0 ? (s2Count / totalSARSamples) * 100 : 0;
        const s3Pct = totalSARSamples > 0 ? (s3Count / totalSARSamples) * 100 : 0;
        const s4Pct = totalSARSamples > 0 ? (s4Count / totalSARSamples) * 100 : 0;

        if (sarMin === Infinity) sarMin = 0;
        if (sarMax === -Infinity) sarMax = 0;
        const sarAvg = totalSARSamples > 0 ? sarSum / totalSARSamples : 0;

        // Group aggregation for Table 22
        const sarGroupData: Record<string, { total: number; min: number; max: number; exceed: number }> = {};
        sarSamples.forEach((s) => {
          const g = s.groupVal || "Other";
          if (!sarGroupData[g]) {
            sarGroupData[g] = { total: 0, min: Infinity, max: -Infinity, exceed: 0 };
          }
          const v = s.sar!;
          const item = sarGroupData[g];
          item.total++;
          if (v < item.min) item.min = v;
          if (v > item.max) item.max = v;
          if (v > 26) item.exceed++;
        });

        const sortedSarGroups = Object.keys(sarGroupData).sort().map((g) => {
          const item = sarGroupData[g];
          return {
            name: g,
            total: item.total,
            min: item.min === Infinity ? 0 : item.min,
            max: item.max === -Infinity ? 0 : item.max,
            exceed: item.exceed,
            exceedPct: item.total > 0 ? (item.exceed / item.total) * 100 : 0
          };
        });

        // --- 2. RSC Computations ---
        let rscExcellentCount = 0;
        let rscAcceptableCount = 0;
        let rscUnsuitableCount = 0;

        let rscMin = Infinity;
        let rscMax = -Infinity;
        let rscSum = 0;

        rscSamples.forEach((s) => {
          const v = s.rsc!;
          if (v < rscMin) rscMin = v;
          if (v > rscMax) rscMax = v;
          rscSum += v;

          if (v < 1.25) rscExcellentCount++;
          else if (v <= 2.5) rscAcceptableCount++;
          else rscUnsuitableCount++;
        });

        const rscExPct = totalRSCSamples > 0 ? (rscExcellentCount / totalRSCSamples) * 100 : 0;
        const rscAcPct = totalRSCSamples > 0 ? (rscAcceptableCount / totalRSCSamples) * 100 : 0;
        const rscUnPct = totalRSCSamples > 0 ? (rscUnsuitableCount / totalRSCSamples) * 100 : 0;

        if (rscMin === Infinity) rscMin = 0;
        if (rscMax === -Infinity) rscMax = 0;
        const rscAvg = totalRSCSamples > 0 ? rscSum / totalRSCSamples : 0;

        let sarMapImgBase64 = bulletinMaps["SAR"] || bulletinMaps["sar"] || bulletinMaps["Sodium Adsorption Ratio"];
        if (s4Count > 0) {
          if (!sarMapImgBase64) {
            try {
              sarMapImgBase64 = getAutoSvgMap("SAR", filteredData);
              if (sarMapImgBase64) {
                latestCompiledMaps["SAR"] = sarMapImgBase64;
              }
            } catch (e) {
              console.error("Failed to generate SAR Map:", e);
            }
          } else {
            latestCompiledMaps["SAR"] = sarMapImgBase64;
          }
        } else {
          sarMapImgBase64 = "";
        }

        let rscMapImgBase64 = bulletinMaps["RSC"] || bulletinMaps["rsc"] || bulletinMaps["Residual Sodium Carbonate"];
        if (rscUnsuitableCount > 0) {
          if (!rscMapImgBase64) {
            try {
              rscMapImgBase64 = getAutoSvgMap("RSC", filteredData);
              if (rscMapImgBase64) {
                latestCompiledMaps["RSC"] = rscMapImgBase64;
              }
            } catch (e) {
              console.error("Failed to generate RSC Map:", e);
            }
          } else {
            latestCompiledMaps["RSC"] = rscMapImgBase64;
          }
        } else {
          rscMapImgBase64 = "";
        }

        // Generate 3D Donut charts for SAR and RSC asynchronously
        let sarDonutBase64 = bulletinMaps["donut_SAR"] || "";
        const sarDonutDataPoints = [
          ...(s1Count > 0 ? [{ name: "S1: Excellent (≤10)", y: s1Count, color: "#10b981" }] : []),
          ...(s2Count > 0 ? [{ name: "S2: Medium (>10–18)", y: s2Count, color: "#3b82f6" }] : []),
          ...(s3Count > 0 ? [{ name: "S3: High (>18–26)", y: s3Count, color: "#f59e0b" }] : []),
          ...(s4Count > 0 ? [{ name: "S4: Very High (>26)", y: s4Count, color: "#ef4444" }] : []),
        ];
        if (!sarDonutBase64 && totalSARSamples > 0 && sarDonutDataPoints.length > 0) {
          try {
            setGenerationProgress("Generating SAR 3D Donut Chart...");
            sarDonutBase64 = await generateParamDonutChart(`Distribution of SAR Values (n=${totalSARSamples})`, sarDonutDataPoints);
          } catch (e) {
            console.error("Failed to generate SAR Donut chart:", e);
          }
        }

        let rscDonutBase64 = bulletinMaps["donut_RSC"] || "";
        const rscDonutDataPoints = [
          ...(rscExcellentCount > 0 ? [{ name: "Excellent (<1.25 meq/L)", y: rscExcellentCount, color: "#10b981" }] : []),
          ...(rscAcceptableCount > 0 ? [{ name: "Acceptable (1.25-2.5 meq/L)", y: rscAcceptableCount, color: "#f59e0b" }] : []),
          ...(rscUnsuitableCount > 0 ? [{ name: "Unsuitable (>2.5 meq/L)", y: rscUnsuitableCount, color: "#ef4444" }] : []),
        ];
        if (!rscDonutBase64 && totalRSCSamples > 0 && rscDonutDataPoints.length > 0) {
          try {
            setGenerationProgress("Generating RSC 3D Donut Chart...");
            rscDonutBase64 = await generateParamDonutChart(`Distribution of RSC Values (n=${totalRSCSamples})`, rscDonutDataPoints);
          } catch (e) {
            console.error("Failed to generate RSC Donut chart:", e);
          }
        }

        // Group aggregation for Table 23
        const rscGroupData: Record<string, { total: number; min: number; max: number; exceed: number }> = {};
        rscSamples.forEach((s) => {
          const g = s.groupVal || "Other";
          if (!rscGroupData[g]) {
            rscGroupData[g] = { total: 0, min: Infinity, max: -Infinity, exceed: 0 };
          }
          const v = s.rsc!;
          const item = rscGroupData[g];
          item.total++;
          if (v < item.min) item.min = v;
          if (v > item.max) item.max = v;
          if (v > 2.5) item.exceed++;
        });

        const sortedRscGroups = Object.keys(rscGroupData).sort().map((g) => {
          const item = rscGroupData[g];
          return {
            name: g,
            total: item.total,
            min: item.min === Infinity ? 0 : item.min,
            max: item.max === -Infinity ? 0 : item.max,
            exceed: item.exceed,
            exceedPct: item.total > 0 ? (item.exceed / item.total) * 100 : 0
          };
        });

        // Precompile SAR and RSC Exceedance Charts - Removed as requested by user
        let sarExceedanceChartBase64 = "";
        let rscExceedanceChartBase64 = "";

        // --- 3. Draw inline SVGs for Figures ---
        const drawSarDistributionChart = () => {
          const barWidth = 350;
          const s1W = (s1Pct / 100) * barWidth;
          const s2W = (s2Pct / 100) * barWidth;
          const s3W = (s3Pct / 100) * barWidth;
          const s4W = (s4Pct / 100) * barWidth;

          return `
            <svg viewBox="0 0 500 120" width="100%" height="120" style="background: transparent; font-family: 'Times New Roman', serif; margin: 10px auto; display: block;" xmlns="http://www.w3.org/2000/svg">
              <text x="250" y="20" text-anchor="middle" font-size="11" font-weight="bold" fill="#1e3a8a">Percent Distribution of Groundwater Samples in SAR Ranges</text>
              <rect x="75" y="40" width="${barWidth}" height="24" rx="4" fill="#f1f5f9" />
              ${s1W > 0 ? `<rect x="75" y="40" width="${s1W}" height="24" rx="4" fill="#10b981" />` : ""}
              ${s2W > 0 ? `<rect x="${75 + s1W}" y="40" width="${s2W}" height="24" fill="#f59e0b" />` : ""}
              ${s3W > 0 ? `<rect x="${75 + s1W + s2W}" y="40" width="${s3W}" height="24" fill="#f97316" />` : ""}
              ${s4W > 0 ? `<rect x="${75 + s1W + s2W + s3W}" y="40" width="${s4W}" height="24" rx="4" fill="#ef4444" />` : ""}
              <g transform="translate(15, 85)" font-size="8.5" font-family="'Times New Roman', serif">
                <circle cx="20" cy="5" r="4.5" fill="#10b981" />
                <text x="30" y="8" font-weight="bold" fill="#334155">S1: Low (&lt;10)</text>
                <text x="30" y="20" font-weight="bold" fill="#10b981" font-size="10">${s1Pct.toFixed(1)}%</text>
                <circle cx="140" cy="5" r="4.5" fill="#f59e0b" />
                <text x="150" y="8" font-weight="bold" fill="#334155">S2: Medium (10-18)</text>
                <text x="150" y="20" font-weight="bold" fill="#d97706" font-size="10">${s2Pct.toFixed(1)}%</text>
                <circle cx="270" cy="5" r="4.5" fill="#f97316" />
                <text x="280" y="8" font-weight="bold" fill="#334155">S3: High (18-26)</text>
                <text x="280" y="20" font-weight="bold" fill="#ea580c" font-size="10">${s3Pct.toFixed(1)}%</text>
                <circle cx="390" cy="5" r="4.5" fill="#ef4444" />
                <text x="400" y="8" font-weight="bold" fill="#334155">S4: Very High (&gt;26)</text>
                <text x="400" y="20" font-weight="bold" fill="#dc2626" font-size="10">${s4Pct.toFixed(1)}%</text>
              </g>
            </svg>
          `;
        };

        const drawRscDistributionChart = () => {
          const barWidth = 350;
          const exW = (rscExPct / 100) * barWidth;
          const acW = (rscAcPct / 100) * barWidth;
          const unW = (rscUnPct / 100) * barWidth;

          return `
            <svg viewBox="0 0 500 120" width="100%" height="120" style="background: transparent; font-family: 'Times New Roman', serif; margin: 10px auto; display: block;" xmlns="http://www.w3.org/2000/svg">
              <text x="250" y="20" text-anchor="middle" font-size="11" font-weight="bold" fill="#1e3a8a">Percent Distribution of Groundwater Samples in RSC Ranges</text>
              <rect x="75" y="40" width="${barWidth}" height="24" rx="4" fill="#f1f5f9" />
              ${exW > 0 ? `<rect x="75" y="40" width="${exW}" height="24" rx="4" fill="#10b981" />` : ""}
              ${acW > 0 ? `<rect x="${75 + exW}" y="40" width="${acW}" height="24" fill="#f59e0b" />` : ""}
              ${unW > 0 ? `<rect x="${75 + exW + acW}" y="40" width="${unW}" height="24" rx="4" fill="#ef4444" />` : ""}
              <g transform="translate(60, 85)" font-size="8.5" font-family="'Times New Roman', serif">
                <circle cx="20" cy="5" r="4.5" fill="#10b981" />
                <text x="30" y="8" font-weight="bold" fill="#334155">Safe (&lt;1.25 meq/L)</text>
                <text x="30" y="20" font-weight="bold" fill="#10b981" font-size="10">${rscExPct.toFixed(1)}%</text>
                <circle cx="160" cy="5" r="4.5" fill="#f59e0b" />
                <text x="170" y="8" font-weight="bold" fill="#334155">Marginal (1.25 - 2.5)</text>
                <text x="170" y="20" font-weight="bold" fill="#d97706" font-size="10">${rscAcPct.toFixed(1)}%</text>
                <circle cx="320" cy="5" r="4.5" fill="#ef4444" />
                <text x="330" y="8" font-weight="bold" fill="#334155">Unsuitable (&gt;2.5)</text>
                <text x="330" y="20" font-weight="bold" fill="#dc2626" font-size="10">${rscUnPct.toFixed(1)}%</text>
              </g>
            </svg>
          `;
        };

        // --- 4. Prepare Table 22 HTML ---
        let table22HTML = `
          <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: center; margin-bottom: 25px;">
            <thead>
              <tr style="background-color: #1e3a8a; color: white;">
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">S. No.</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold; text-align: left;">${breakdownLevel}</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">No. of Samples</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">Min</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">Max</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">No. of Samples (SAR &gt; 26)</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">% of Samples (SAR &gt; 26)</th>
              </tr>
            </thead>
            <tbody>
        `;

        sortedSarGroups.forEach((g, idx) => {
          table22HTML += `
            <tr style="background-color: ${idx % 2 === 0 ? "#f8fafc" : "#ffffff"};">
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${idx + 1}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: left; font-weight: bold;">${g.name}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${g.total}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${g.min.toFixed(2)}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${g.max.toFixed(2)}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; color: ${g.exceed > 0 ? "#b91c1c" : "#1e293b"}; font-weight: ${g.exceed > 0 ? "bold" : "normal"};">${g.exceed}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; color: ${g.exceed > 0 ? "#b91c1c" : "#1e293b"};">${g.exceedPct.toFixed(2)}%</td>
            </tr>
          `;
        });

        const totalSarSamplesCount = sortedSarGroups.reduce((acc, g) => acc + g.total, 0);
        const totalSarExceedCount = sortedSarGroups.reduce((acc, g) => acc + g.exceed, 0);
        const totalSarExceedPct = totalSarSamplesCount > 0 ? (totalSarExceedCount / totalSarSamplesCount) * 100 : 0;

        table22HTML += `
              <tr style="background-color: #f1f5f9; font-weight: bold;">
                <td style="padding: 8px; border: 1px solid #94a3b8;" colspan="2">Total / Regional Average</td>
                <td style="padding: 8px; border: 1px solid #94a3b8;">${totalSarSamplesCount}</td>
                <td style="padding: 8px; border: 1px solid #94a3b8;">${sarMin.toFixed(2)}</td>
                <td style="padding: 8px; border: 1px solid #94a3b8;">${sarMax.toFixed(2)}</td>
                <td style="padding: 8px; border: 1px solid #94a3b8; color: #b91c1c;">${totalSarExceedCount}</td>
                <td style="padding: 8px; border: 1px solid #94a3b8; color: #b91c1c;">${totalSarExceedPct.toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        `;

        // --- 5. Prepare Table 23 HTML ---
        let table23HTML = `
          <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: center; margin-bottom: 25px;">
            <thead>
              <tr style="background-color: #1e3a8a; color: white;">
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">S. No.</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold; text-align: left;">${breakdownLevel}</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">No. of Samples</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">Min</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">Max</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">No. of Samples (RSC &gt; 2.5 meq/L)</th>
                <th style="padding: 8px; border: 1px solid #1e3a8a; font-weight: bold;">% of Samples (RSC &gt; 2.5 meq/L)</th>
              </tr>
            </thead>
            <tbody>
        `;

        sortedRscGroups.forEach((g, idx) => {
          table23HTML += `
            <tr style="background-color: ${idx % 2 === 0 ? "#f8fafc" : "#ffffff"};">
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${idx + 1}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: left; font-weight: bold;">${g.name}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${g.total}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${g.min.toFixed(2)}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${g.max.toFixed(2)}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; color: ${g.exceed > 0 ? "#b91c1c" : "#1e293b"}; font-weight: ${g.exceed > 0 ? "bold" : "normal"};">${g.exceed}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; color: ${g.exceed > 0 ? "#b91c1c" : "#1e293b"};">${g.exceedPct.toFixed(2)}%</td>
            </tr>
          `;
        });

        const totalRscSamplesCount = sortedRscGroups.reduce((acc, g) => acc + g.total, 0);
        const totalRscExceedCount = sortedRscGroups.reduce((acc, g) => acc + g.exceed, 0);
        const totalRscExceedPct = totalRscSamplesCount > 0 ? (totalRscExceedCount / totalRscSamplesCount) * 100 : 0;

        table23HTML += `
              <tr style="background-color: #f1f5f9; font-weight: bold;">
                <td style="padding: 8px; border: 1px solid #94a3b8;" colspan="2">Total / Regional Average</td>
                <td style="padding: 8px; border: 1px solid #94a3b8;">${totalRscSamplesCount}</td>
                <td style="padding: 8px; border: 1px solid #94a3b8;">${rscMin.toFixed(2)}</td>
                <td style="padding: 8px; border: 1px solid #94a3b8;">${rscMax.toFixed(2)}</td>
                <td style="padding: 8px; border: 1px solid #94a3b8; color: #b91c1c;">${totalRscExceedCount}</td>
                <td style="padding: 8px; border: 1px solid #94a3b8; color: #b91c1c;">${totalRscExceedPct.toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        `;

        const agHeading = "6.0 Agricultural Suitability and Irrigation Hazards";
        const agP1 = `In irrigation water, quality is characterized by both absolute and relative concentrations of cations and anions. If sodium concentrations are high, the alkali/sodicity hazard is high, whereas if calcium and magnesium levels are high, this hazard is low. Alkali soils are formed by the accumulation of exchangeable sodium and are characterized by poor tilth and low soil permeability. The U.S. Salinity Laboratory has recommended the use of the Sodium Adsorption Ratio (SAR) as it is closely related to the adsorption of sodium by the soil.`;

        const sarHeading = "6.1 Sodium Adsorption Ratio (SAR)";
        const sarP1 = `The Sodium Adsorption Ratio (SAR) is one of the most critical parameters for determining the suitability of water for irrigation. It is closely related to the adsorption of sodium by the soil.`;

        const sarP2 = `Irrigation waters are classified into four categories based on their SAR values:`;

        const sarList = `
              <li style="margin-bottom: 8px;"><strong>S1 – Low Sodium Water (SAR &lt; 10)</strong>: Such waters can be used on practically all kinds of soils without any risk or increase in exchangeable sodium.</li>
              <li style="margin-bottom: 8px;"><strong>S2 – Medium Sodium Water (SAR 10 - 18)</strong>: Such waters may produce an appreciable sodium hazard in fine-textured soils having high cation exchange capacities under low leaching.</li>
              <li style="margin-bottom: 8px;"><strong>S3 – High Sodium Water (SAR 18 - 26)</strong>: Such waters indicate harmful concentrations of exchangeable sodium in most soils and would require special management, good drainage, high leaching, and organic matter additions.</li>
              <li style="margin-bottom: 8px;"><strong>S4 – Very High Sodium Water (SAR &gt; 26)</strong>: Generally, such waters are unsatisfactory for irrigation purposes except at low or perhaps medium salinity, where the solution of calcium from the soil or addition of gypsum or other amendments makes the use of such waters feasible.</li>
            `;
        
        const sarP3 = `Based on the dynamic evaluation of <strong>${totalSARSamples} groundwater samples</strong>, <strong>${s1Pct.toFixed(2)}%</strong> of samples belong to the excellent/low sodium category (S1), <strong>${s2Pct.toFixed(2)}%</strong> fall into the medium sodium category (S2), <strong>${s3Pct.toFixed(2)}%</strong> are in the high sodium category (S3), and <strong>${s4Pct.toFixed(2)}%</strong> belong to the very high sodium category (S4).`;

        const sarP4 = `The ${breakdownLevel.toLowerCase()}-wise distribution of SAR values across ${titleRegion} is compiled in Table ${tblIndex++} below:`;

        const table22Caption = `Table ${tblIndex - 1}: Percent distribution of SAR values in different ${breakdownLevel}s of ${titleRegion}`;

        const sarMonsoonImpact = getMonsoonImpactAnalysis(
          "SAR",
          "Sodium Adsorption Ratio",
          rawData,
          headers,
          headerMap,
          bulletinScope,
          isHindi,
          tblIndex
        );
        if (sarMonsoonImpact.hasData) {
          tblIndex++;
        }

        const rscHeading = "6.2 Residual Sodium Carbonate (RSC)";
        const rscP1 = `In irrigation water, quality is characterized by both absolute and relative concentrations of cations and anions. If sodium concentrations are high, the alkali/sodicity hazard is high, whereas if calcium and magnesium levels are high, this hazard is low. Alkali soils are formed by the accumulation of exchangeable sodium and are characterized by poor tilth and low soil permeability. The U.S. Salinity Laboratory has recommended the use of the Sodium Adsorption Ratio (SAR) as it is closely related to the adsorption of sodium by the soil.`;
        
        const rscP2 = "The highly soluble sodium carbonate known as residual sodium carbonate (RSC) is defined as:";
        
        const rscP3 = `Waters with high RSC produce harmful effects on plant development and are not suitable for irrigation. Waters associated with RSC &lt; 1.25 meq/L are of excellent irrigation quality and can be safely applied for irrigation for almost all crops without the risks associated with residual sodium carbonate (Wilcox et al., 1954). If the RSC values lie between 1.25 and 2.5 meq/L, the water is of an acceptable/marginal quality for irrigation. Waters associated with RSC values higher than 2.5 meq/L are not acceptable for irrigation.`;

        const rscP4 = `Our dynamic calculation on <strong>${totalRSCSamples} valid samples</strong> reveals that <strong>${rscExPct.toFixed(2)}%</strong> of samples recorded safe RSC values (&lt;1.25 meq/L), <strong>${rscAcPct.toFixed(2)}%</strong> fall into the marginal range (1.25 - 2.5 meq/L), and <strong>${rscUnPct.toFixed(2)}%</strong> exceeded the critical limit of 2.5 meq/L, suggesting localized sodium hazards that require soil amendments and drainage interventions.`;

        const rscP5 = `The detailed geographical compliance distribution of RSC across ${titleRegion} is compiled in Table ${tblIndex++} below:`;

        const table23Caption = `Table ${tblIndex - 1}: Percent distribution of RSC values in different ${breakdownLevel}s of ${titleRegion}`;

        const rscMonsoonImpact = getMonsoonImpactAnalysis(
          "RSC",
          "Residual Sodium Carbonate",
          rawData,
          headers,
          headerMap,
          bulletinScope,
          isHindi,
          tblIndex
        );
        if (rscMonsoonImpact.hasData) {
          tblIndex++;
        }

        agriculturalSuitabilityHTML = `
          <h3 style="font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #475569; padding-bottom: 5px; margin-top: 35px; page-break-before: always;">${agHeading}</h3>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${agP1}
          </p>

          <h4 style="font-size: 12pt; font-weight: bold; color: #1e3a8a; margin-top: 20px; margin-bottom: 10px;">${sarHeading}</h4>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${sarP1}
          </p>
          <div style="text-align: center; margin: 15px 0; font-family: 'Times New Roman', serif; font-size: 12pt; font-weight: bold; color: #1e3a8a;">
            SAR = [Na⁺] / &radic;(([Ca²⁺] + [Mg²⁺]) / 2)
          </div>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${sarP2}
          </p>
          <ul style="line-height: 1.6; padding-left: 20px; margin-bottom: 20px; text-align: justify;">
            ${sarList}
          </ul>

          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${sarP3}
          </p>

          <div style="text-align: center; margin: 25px 0; page-break-inside: avoid;">
            <div style="display: inline-block; padding: 15px; border: none; background: transparent; box-shadow: none; width: 100%; max-width: 330px;">
              ${
                sarDonutBase64
                  ? `<img src="${sarDonutBase64}" width="330" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: transparent;" alt="SAR Distribution Chart" />`
                  : drawSarDistributionChart()
              }
            </div>
            <p style="text-align: center; font-style: italic; font-size: 10.5pt; margin-top: 10px;">
              <strong>Figure ${figIndex++}:</strong> Percent distribution of groundwater samples in SAR ranges
            </p>
          </div>

          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${sarP4}
          </p>

          <div style="page-break-inside: auto;">
            <p style="text-align: center; font-weight: bold; font-size: 11pt; margin-bottom: 5px; color: #1e3a8a;">
              ${table22Caption}
            </p>
            ${table22HTML}

            ${
              sarMapImgBase64
                ? `<div style="text-align: center; margin: 25px 0; page-break-inside: avoid;">
                     <img src="${sarMapImgBase64}" width="550" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: #ffffff;" alt="SAR Exceedance Map" />
                     <p style="text-align: center; font-style: italic; font-size: 10.5pt; margin-top: 10px;">
                       <strong>Figure ${figIndex++}:</strong> Geographic distribution of groundwater locations exceeding SAR permissible limits (>26)
                     </p>
                   </div>`
                : ""
            }

            ${sarMonsoonImpact.hasData ? sarMonsoonImpact.html : ""}
          </div>

          <h4 style="font-size: 12pt; font-weight: bold; color: #1e3a8a; margin-top: 30px; margin-bottom: 10px; page-break-before: always;">${rscHeading}</h4>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${rscP1}
          </p>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${rscP2}
          </p>
          <div style="text-align: center; margin: 15px 0; font-family: 'Times New Roman', serif; font-size: 12pt; font-weight: bold; color: #1e3a8a;">
            RSC = ([HCO₃⁻] + [CO₃²⁻]) - ([Ca²⁺] + [Mg²⁺])
          </div>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${rscP3}
          </p>

          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${rscP4}
          </p>

          <div style="text-align: center; margin: 25px 0; page-break-inside: avoid;">
            <div style="display: inline-block; padding: 15px; border: none; background: transparent; box-shadow: none; width: 100%; max-width: 330px;">
              ${
                rscDonutBase64
                  ? `<img src="${rscDonutBase64}" width="330" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: transparent;" alt="RSC Distribution Chart" />`
                  : drawRscDistributionChart()
              }
            </div>
            <p style="text-align: center; font-style: italic; font-size: 10.5pt; margin-top: 10px;">
              <strong>Figure ${figIndex++}:</strong> Percent distribution of groundwater samples in RSC ranges
            </p>
          </div>

          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${rscP5}
          </p>

          <div style="page-break-inside: auto;">
            <p style="text-align: center; font-weight: bold; font-size: 11pt; margin-bottom: 5px; color: #1e3a8a;">
              ${table23Caption}
            </p>
            ${table23HTML}
          </div>

          ${
            rscMapImgBase64
              ? `<div style="text-align: center; margin: 25px 0; page-break-inside: avoid;">
                   <img src="${rscMapImgBase64}" width="550" style="max-width: 100%; height: auto; border: none; display: block; margin: 0 auto; background: #ffffff;" alt="RSC Exceedance Map" />
                   <p style="text-align: center; font-style: italic; font-size: 10.5pt; margin-top: 10px;">
                     <strong>Figure ${figIndex++}:</strong> Geographic distribution of groundwater locations exceeding RSC permissible limits (>2.5)
                   </p>
                 </div>`
              : ""
          }

          ${rscMonsoonImpact.hasData ? rscMonsoonImpact.html : ""}

          ${(() => {
            const usslHeading = isHindi ? "6.3 यू.एस. लवणता प्रयोगशाला (USSL) आरेख वर्गीकरण" : "6.3 U.S. Salinity Laboratory (USSL) Diagram Classification";
            const usslP1 = "The U.S. Salinity Laboratory (USSL) Diagram, developed by the U.S. Salinity Laboratory Staff (Richards, 1954), is one of the most widely accepted hydrochemical classification systems for evaluating the suitability of groundwater for irrigation. The classification is based on two important water quality parameters: salinity hazard, represented by Electrical Conductivity (EC), and sodium hazard, represented by the Sodium Adsorption Ratio (SAR). Salinity influences the osmotic potential of soil water, thereby reducing the availability of water to plants, while excessive sodium relative to calcium and magnesium adversely affects soil physical properties by causing clay dispersion, soil swelling, surface crusting, and reduced infiltration and hydraulic conductivity. Consequently, the combined evaluation of EC and SAR provides a comprehensive assessment of the potential impacts of irrigation water on crop productivity, soil permeability, and long-term agricultural sustainability.";

            const detailedExplanation = `
              <h5 style="font-size: 11pt; font-weight: bold; color: #1e3a8a; margin-top: 20px; margin-bottom: 8px;">Classification of Irrigation Water</h5>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
                The USSL diagram classifies irrigation water into sixteen categories, formed by combining four salinity hazard classes (C1–C4) with four sodium hazard classes (S1–S4). Each groundwater sample is plotted on the diagram using its EC and SAR values to determine its suitability for irrigation.
              </p>

              <div style="display: flex; gap: 20px; margin-bottom: 20px; page-break-inside: avoid;">
                <div style="flex: 1;">
                  <h6 style="font-size: 10pt; font-weight: bold; color: #1e3a8a; margin: 0 0 8px 0;">Salinity Hazard (C)</h6>
                  <table style="width: 100%; border-collapse: collapse; font-size: 8.5pt; border: 1px solid #cbd5e1; text-align: left;">
                    <thead>
                      <tr style="background-color: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
                        <th style="padding: 6px 8px; font-weight: bold;">Class</th>
                        <th style="padding: 6px 8px; font-weight: bold;">EC (µS/cm)</th>
                        <th style="padding: 6px 8px; font-weight: bold;">Salinity Hazard</th>
                        <th style="padding: 6px 8px; font-weight: bold;">General Suitability</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 6px 8px; font-weight: bold; color: #1e3a8a;">C1</td>
                        <td style="padding: 6px 8px;">&lt;250</td>
                        <td style="padding: 6px 8px;">Low</td>
                        <td style="padding: 6px 8px;">Suitable for almost all crops and soils</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 6px 8px; font-weight: bold; color: #1e3a8a;">C2</td>
                        <td style="padding: 6px 8px;">250–750</td>
                        <td style="padding: 6px 8px;">Medium</td>
                        <td style="padding: 6px 8px;">Suitable for most crops with moderate leaching</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 6px 8px; font-weight: bold; color: #1e3a8a;">C3</td>
                        <td style="padding: 6px 8px;">750–2250</td>
                        <td style="padding: 6px 8px;">High</td>
                        <td style="padding: 6px 8px;">Suitable for salt-tolerant crops under good drainage</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 8px; font-weight: bold; color: #1e3a8a;">C4</td>
                        <td style="padding: 6px 8px;">&gt;2250</td>
                        <td style="padding: 6px 8px;">Very High</td>
                        <td style="padding: 6px 8px;">Generally unsuitable except under special management</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style="flex: 1;">
                  <h6 style="font-size: 10pt; font-weight: bold; color: #1e3a8a; margin: 0 0 8px 0;">Sodium Hazard (S)</h6>
                  <table style="width: 100%; border-collapse: collapse; font-size: 8.5pt; border: 1px solid #cbd5e1; text-align: left;">
                    <thead>
                      <tr style="background-color: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
                        <th style="padding: 6px 8px; font-weight: bold;">Class</th>
                        <th style="padding: 6px 8px; font-weight: bold;">SAR</th>
                        <th style="padding: 6px 8px; font-weight: bold;">Sodium Hazard</th>
                        <th style="padding: 6px 8px; font-weight: bold;">General Suitability</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 6px 8px; font-weight: bold; color: #1e3a8a;">S1</td>
                        <td style="padding: 6px 8px;">&lt;10</td>
                        <td style="padding: 6px 8px;">Low</td>
                        <td style="padding: 6px 8px;">Suitable for most soils</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 6px 8px; font-weight: bold; color: #1e3a8a;">S2</td>
                        <td style="padding: 6px 8px;">10–18</td>
                        <td style="padding: 6px 8px;">Medium</td>
                        <td style="padding: 6px 8px;">Suitable for coarse-textured soils with moderate management</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 6px 8px; font-weight: bold; color: #1e3a8a;">S3</td>
                        <td style="padding: 6px 8px;">18–26</td>
                        <td style="padding: 6px 8px;">High</td>
                        <td style="padding: 6px 8px;">May adversely affect soil permeability; careful management required</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 8px; font-weight: bold; color: #1e3a8a;">S4</td>
                        <td style="padding: 6px 8px;">&gt;26</td>
                        <td style="padding: 6px 8px;">Very High</td>
                        <td style="padding: 6px 8px;">Generally unsuitable for irrigation</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <h5 style="font-size: 11pt; font-weight: bold; color: #1e3a8a; margin-top: 25px; margin-bottom: 8px; page-break-before: always;">Interpretation of USSL Classes</h5>
              <div style="font-size: 9.5pt; line-height: 1.6; color: #334155;">
                <p style="margin-bottom: 12px; text-align: justify;">
                  <strong style="color: #1e3a8a;">C1–S1: Low Salinity – Low Sodium Hazard</strong><br/>
                  Groundwater belonging to the C1–S1 class is considered excellent for irrigation. It has low salinity and low sodium hazards and is suitable for nearly all soil types and crops without requiring special management practices.
                </p>
                <p style="margin-bottom: 12px; text-align: justify;">
                  <strong style="color: #1e3a8a;">C2–S1 and C2–S2: Medium Salinity – Low to Medium Sodium Hazard</strong><br/>
                  Groundwater in the C2–S1 and C2–S2 classes is generally suitable for irrigation under normal agricultural conditions. However, moderate leaching may be necessary to prevent salt accumulation within the crop root zone, particularly in moderately drained soils.
                </p>
                <p style="margin-bottom: 12px; text-align: justify;">
                  <strong style="color: #1e3a8a;">C3–S1 to C3–S3: High Salinity Hazard</strong><br/>
                  Groundwater classified under the C3 salinity class exhibits a high salinity hazard and should be used only where adequate drainage facilities are available. Successful irrigation with such water requires periodic leaching and cultivation of moderately to highly salt-tolerant crops to minimize adverse effects on crop yield.
                </p>
                <p style="margin-bottom: 12px; text-align: justify;">
                  <strong style="color: #1e3a8a;">C4 Classes: Very High Salinity Hazard</strong><br/>
                  Groundwater belonging to the C4 salinity class possesses very high salinity and is generally unsuitable for irrigation. Its use is restricted to exceptional situations where efficient drainage systems, intensive leaching practices, blending with better-quality water, and suitable soil amendments such as gypsum are adopted to minimize salt accumulation and maintain soil productivity.
                </p>
                <p style="margin-bottom: 12px; text-align: justify;">
                  <strong style="color: #1e3a8a;">S3 and S4: High to Very High Sodium Hazard</strong><br/>
                  Groundwater falling under the S3 and S4 sodium hazard classes contains high concentrations of sodium relative to calcium and magnesium. Continuous use of such water may result in soil sodicity, leading to clay dispersion, deterioration of soil structure, reduced infiltration and permeability, poor aeration, and surface crust formation. Consequently, irrigation with S3 and S4 waters requires appropriate soil and water management practices, including gypsum application, periodic leaching, provision of adequate drainage, and cultivation of sodium-tolerant crops.
                </p>
              </div>
            `;

            let usslPlotsHTML = `<div style="display: flex; flex-direction: column; gap: 35px; margin-top: 20px;">`;
            renderSets.forEach((rset) => {
              const usslPlotSVG = generateUsslDiagramHTML(rset.samples, groupColorMap);
              const usslDistSVG = generateUsslDistributionDiagramHTML(rset.samples);
              usslPlotsHTML += `
                <div style="background-color: #ffffff; padding: 25px; page-break-inside: avoid; text-align: center; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px;">
                  <div style="display: inline-block; margin: 0 auto; width: 100%; max-width: 550px;">
                    ${usslPlotSVG}
                  </div>
                  <p style="text-align: center; font-style: italic; font-size: 10pt; margin-top: 5px; margin-bottom: 30px; color: #475569;">
                    <strong>Figure ${figIndex++}:</strong> ${getDiagramCaption("USSL", rset.name, rset.samples)}
                  </p>

                  <div style="display: inline-block; margin: 20px auto 0 auto; width: 100%; max-width: 550px; border-top: 1px dashed #cbd5e1; padding-top: 25px;">
                    ${usslDistSVG}
                  </div>
                  <p style="text-align: center; font-style: italic; font-size: 10pt; margin-top: 10px; color: #475569;">
                    <strong>Figure ${figIndex++}:</strong> Distribution and Percentage of Groundwater Samples in USSL Salinity-Sodium Hazard Classes - ${rset.name}
                  </p>
                </div>
              `;
            });
            usslPlotsHTML += `</div>`;

            return `
              <h4 style="font-size: 12pt; font-weight: bold; color: #1e3a8a; margin-top: 30px; margin-bottom: 10px; page-break-before: always;">${usslHeading}</h4>
              <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
                ${usslP1}
              </p>
              ${detailedExplanation}
              ${usslPlotsHTML}
            `;
          })()}
        `;
      } else {
        agriculturalSuitabilityHTML = `
          <h3 style="font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #475569; padding-bottom: 5px; margin-top: 35px; page-break-before: always;">6.0 Agricultural Suitability and Irrigation Hazards</h3>
          <div style="background-color: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 25px; text-align: center; margin: 25px 0;">
            <p style="font-weight: bold; font-size: 11pt; color: #475569; margin: 0 0 10px 0;">Agricultural Suitability Indices (Not Calculated)</p>
            <p style="font-size: 9.5pt; color: #64748b; line-height: 1.5; max-width: 550px; margin: 0 auto;">
              Calculating the Sodium Adsorption Ratio (SAR) and Residual Sodium Carbonate (RSC) requires complete major ionic concentration data (Ca²⁺, Mg²⁺, Na⁺, and HCO₃⁻) expressed in mg/L. 
              Please verify that these parameters are correctly mapped in the primary parameters tab to enable automatic calculations of irrigation hazards.
            </p>
          </div>
        `;
      }

      // 3. Compile remedial and preventive measures HTML dynamically (pointwise and bilingual)
      let remedialMeasuresPointsHTML = "";
      let remedialIndex = 1;
      selectedBulletinParams.forEach((paramName) => {
        const configKey = headerMap[paramName];
        if (!configKey) return;
        const figCounter = { current: figIndex };
        remedialMeasuresPointsHTML += getParameterRemedialHTML(configKey, paramName, figCounter, remedialIndex++);
        figIndex = figCounter.current;
      });

      const remedialMeasuresHeading = "7.0 Preventive and Remedial Measures for Water Quality Contaminants";
      const remedialMeasuresIntro = "To ensure long-term groundwater security and mitigate hazards posed by groundwater contamination, a dual strategy consisting of proactive preventive controls and targeted remedial technologies is essential. The following pointwise outlines describe established protocols for managing the selected chemical contaminants of concern:";

      const remedialMeasuresHTML = remedialMeasuresPointsHTML.trim() !== "" ? `
        <h3 style="font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #475569; padding-bottom: 5px; margin-top: 40px; page-break-before: always;">${remedialMeasuresHeading}</h3>
        <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
          ${remedialMeasuresIntro}
        </p>
        ${remedialMeasuresPointsHTML}
      ` : "";

      // 4. Assemble document structures with bilingual options
      const introHeading = "1.0 Introduction";
      const introP1 = `All water contains some dissolved substances, regardless of its source. Even rainwater, which is often considered near-pure, contains small amounts of dissolved gases and minerals. As water moves through the natural hydrological cycle, it comes into contact with air, soil strata, and rocks, picking up various chemical substances from both natural processes and human activities.`;
      const introP2 = `Evaluation of water quality involves assessing the presence and concentration of various physical and chemical constituents in groundwater to determine its suitability for intended uses such as drinking, agriculture, and industrial applications.`;
      const introP3 = `The present annual groundwater quality report is based on the hydrochemical evaluation of <strong>${totalSamples} groundwater samples</strong>. This extensive coverage improves spatial representative density and bolsters statistical validity across ${bulletinScope === "National" ? "India" : toProperCase(bulletinScope)}.`;

      const objHeading = "2.0 Objectives of Groundwater Quality Monitoring";
      const objP1 = `The primary objective of this annual groundwater quality report is to assess the status of groundwater quality across ${titleRegion.toUpperCase() === "INDIA" ? "India" : titleRegion}, providing a comprehensive baseline for understanding spatial variability and supporting long-term monitoring of groundwater resources.`;

      const scenarioHeading = `3.0 Groundwater Quality Scenario in ${titleRegion.toUpperCase() === "INDIA" ? "India" : titleRegion}`;
      const scenarioP1 = `The groundwater quality assessment carried out, based on the data analysis of <strong>${totalSamples} samples</strong>, indicates that most groundwater sources are within permissible limits prescribed by BIS (IS 10500:2012). However, certain parameters were observed to bear exceedances.`;

      const paramHeading = "4.0 Selected Water Quality Parameters";

      const execHeading = "8.0 Executive Summary";
      const execP1 = `The seasonal assessment of groundwater compliance suggests that most regions maintain drinking-ready water compliance, but specific geogenic hotspots for metals/metalloids, plus localized salinity buildup present genuine concerns. Continued seasonal testing, protection of recharge aquifers, public filtration infrastructures, and desalination methods represent mandatory safeguards to guarantee drinking water security.`;

      if (stationsMapBase64) {
        latestCompiledMaps["STATIONS"] = stationsMapBase64;
      }

      // Helper for Roman numerals in Annexures
      const getRomanNumeral = (num: number): string => {
        const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
        return roman[num - 1] || num.toString();
      };

      const formatParameterValueForAnnexure = (val: number, key: string): string => {
        if (val === undefined || val === null || isNaN(val)) return "N/A";
        const norm = key.toUpperCase().trim();
        // Group 1: 0 decimal places
        if (
          norm === "EC" ||
          norm === "TH" ||
          norm === "CL" ||
          norm === "NA" ||
          norm === "SO4" ||
          norm === "NO3" ||
          norm === "NITRATE" ||
          norm === "TDS" ||
          norm === "ALKALINITY"
        ) {
          return val.toFixed(0);
        }
        // Group 2: 2 decimal places
        if (
          norm === "PH" ||
          norm === "F" ||
          norm === "FLUORIDE" ||
          norm === "K" ||
          norm === "CA" ||
          norm === "MG" ||
          norm === "U" ||
          norm === "URANIUM" ||
          norm === "AS" ||
          norm === "ARSENIC" ||
          norm === "SAR" ||
          norm === "RSC"
        ) {
          return val.toFixed(2);
        }
        // Group 3: Other Heavy metals - 3 decimal places
        return val.toFixed(3);
      };

      const formatCoord = (valStr: string): string => {
        const num = parseFloat(valStr);
        if (isNaN(num)) return valStr || "N/A";
        return String(parseFloat(num.toFixed(5)));
      };

      // Annexures Calculation for selected parameters exceeding permissible limits
      let annexuresHTML = "";
      if (filteredData && filteredData.length > 0) {
        // Extract unique seasons and years from dataset to ensure they are written in the report
        const datasetSeasons = headers?.season && filteredData
          ? [...new Set(filteredData.map(d => String(d[headers.season] || "").trim()).filter(Boolean))]
          : [];
        const datasetYears = headers?.year && filteredData
          ? [...new Set(filteredData.map(d => String(d[headers.year] || "").trim()).filter(Boolean))]
          : [];
        
        const displaySeasonText = datasetSeasons.length > 0 ? datasetSeasons.join(", ") : "Seasonal";
        const displayYearText = datasetYears.length > 0 ? datasetYears.join(", ") : bulletinSeason;

        const sampleRow = filteredData[0];
        const stateHeader = (headers && headers.state) || findHeaderByKeys(sampleRow, ["state", "st_nm", "state_name"]) || "State";
        const districtHeader = (headers && headers.district) || findHeaderByKeys(sampleRow, ["district", "dist", "district_name"]) || "District";
        const blockHeader = (headers && headers.block) || findHeaderByKeys(sampleRow, ["block", "block_name", "tehsil", "taluka"]) || "Block";
        const locationHeader = (headers && headers.location) || findHeaderByKeys(sampleRow, ["location", "loc_name", "well_name", "village", "site", "station"]) || "Location";
        const latHeader = (headers && headers.latitude) || findHeaderByKeys(sampleRow, ["latitude", "lat", "latitude_dd", "y", "northing"]) || "Latitude";
        const lngHeader = (headers && headers.longitude) || findHeaderByKeys(sampleRow, ["longitude", "lng", "lon", "longitude_dd", "x", "easting"]) || "Longitude";
        const sourceHeader = (headers && headers.source) || findHeaderByKeys(sampleRow, ["source", "type", "source type", "source_type", "well type", "well_type", "source_type_code", "source_code"]) || "";

        let annexureIndex = 1;

        // Precompute parameter mapping details for ultra-fast loop execution
        const paramMappings = selectedBulletinParams.map((paramName) => {
          const configKey = headerMap[paramName] || paramName;
          const config = PARAM_CONFIG[configKey];
          const mappedHeader = Object.keys(headerMap).find((k) => headerMap[k] === configKey) || paramName;
          return { paramName, configKey, config, mappedHeader };
        }).filter((item) => !!item.config);

        paramMappings.forEach(({ paramName, configKey, config, mappedHeader }) => {
          const exceedingRows: { row: any; value: number }[] = [];
          filteredData.forEach((d) => {
            const val = parseFloat(d[mappedHeader]);
            if (!isNaN(val)) {
              const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
              const limit = isSingleLimit ? config.b1 : config.b2;
              let exceeds = false;
              if (configKey === "pH") {
                if (val < config.b1 || val > config.b2) exceeds = true;
              } else if (val > limit) {
                exceeds = true;
              }
              if (exceeds) {
                exceedingRows.push({ row: d, value: val });
              }
            }
          });

          if (exceedingRows.length === 0) return;

          const romanNum = getRomanNumeral(annexureIndex);
          annexureIndex++;

          let limitText = "";
          if (configKey === "pH") {
            limitText = `outside the permissible range of ${config.b1} - ${config.b2}`;
          } else {
            const isSingleLimit = config.b1 === config.b2;
            const limit = isSingleLimit ? config.b1 : config.b2;
            limitText = `above the permissible limit of ${limit} ${config.unit}`;
          }

          // Show all rows as requested by user, no capping
          const totalExceeded = exceedingRows.length;
          const slicedRows = exceedingRows;

          let tableRowsHTML = "";
          slicedRows.forEach((item, rIdx) => {
            const d = item.row;
            const sVal = toProperCase(String(d[stateHeader] || ""));
            const dVal = toProperCase(String(d[districtHeader] || ""));
            const bVal = toProperCase(String(d[blockHeader] || ""));
            const lVal = toProperCase(String(d[locationHeader] || ""));
            const latVal = formatCoord(String(d[latHeader] || "").trim());
            const lngVal = formatCoord(String(d[lngHeader] || "").trim());
            const srcVal = sourceHeader ? (String(d[sourceHeader] || "")) : "N/A";
            const pVal = formatParameterValueForAnnexure(item.value, configKey);

            const rowBg = rIdx % 2 === 1 ? 'background-color: #f8fafc;' : '';

            tableRowsHTML += `
              <tr style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; ${rowBg}">
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${rIdx + 1}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: left;">${sVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: left;">${dVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: left;">${bVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: left;">${lVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${latVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${lngVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${srcVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: right; font-weight: bold; color: #000000;">${pVal}</td>
              </tr>
            `;
          });

          const truncationWarning = "";

          const paramHeaderCol = config.unit ? `${config.name} (${config.unit})` : config.name;

          annexuresHTML += `
            <div style="font-family: 'Times New Roman', Times, serif; margin-top: 20px;">
              <h3 style="page-break-before: always; font-family: 'Times New Roman', Times, serif; font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 5px; color: #1e3a8a; text-transform: uppercase; margin-bottom: 15px; text-align: center;">
                ANNEXURE ${romanNum}
              </h3>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 11pt; font-weight: bold; margin-bottom: 10px; text-align: center; color: #334155;">
                List of Locations Exceeding Permissible Limit for ${config.name} (${formatChemicalFormula(configKey)}) - Season: ${displaySeasonText}, Year: ${displayYearText}
              </p>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: justify; line-height: 1.6; margin-bottom: 15px; color: #475569;">
                The following table lists the groundwater sampling locations where the concentration of <strong>${config.name} (${formatChemicalFormula(configKey)})</strong> was detected ${limitText} (BIS IS 10500:2012 guidelines) during the <strong>${displaySeasonText} (${displayYearText})</strong> monitoring period. A total of <strong>${totalExceeded}</strong> location(s) exceeded the specified standard in the analyzed dataset.
              </p>

              <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; table-layout: fixed; word-wrap: break-word; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: left; margin-bottom: 10px; border: 1px solid #7f7f7f;">
                <thead>
                  <tr style="background-color: #f2f2f2; color: #000000; font-weight: bold; text-align: center;">
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 6%; font-weight: bold; text-align: center;">Sl. No.</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 12%; font-weight: bold; text-align: left;">State</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 12%; font-weight: bold; text-align: left;">District</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 12%; font-weight: bold; text-align: left;">Block</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 18%; font-weight: bold; text-align: left;">Location</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 10%; font-weight: bold; text-align: center;">Latitude</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 10%; font-weight: bold; text-align: center;">Longitude</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 10%; font-weight: bold; text-align: center;">Source</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 10%; font-weight: bold; text-align: right;">${paramHeaderCol}</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRowsHTML}
                </tbody>
              </table>
              ${truncationWarning}
            </div>
          `;
        });

        // Additional consolidated annexure for locations exceeding one or more selected parameters
        const consolidatedExceedingRows: {
          row: any;
          exceededParamsList: string[];
        }[] = [];

        filteredData.forEach((d) => {
          const exceededList: string[] = [];
          paramMappings.forEach(({ configKey, config, mappedHeader }) => {
            const val = parseFloat(d[mappedHeader]);
            if (!isNaN(val)) {
              const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
              const limit = isSingleLimit ? config.b1 : config.b2;
              let exceeds = false;
              if (configKey === "pH") {
                if (val < config.b1 || val > config.b2) exceeds = true;
              } else if (val > limit) {
                exceeds = true;
              }
              if (exceeds) {
                const formattedVal = formatParameterValueForAnnexure(val, configKey);
                const unitStr = config.unit ? ` ${config.unit}` : "";
                exceededList.push(`${formatChemicalFormula(configKey)}: ${formattedVal}${unitStr}`);
              }
            }
          });

          if (exceededList.length > 0) {
            consolidatedExceedingRows.push({
              row: d,
              exceededParamsList: exceededList
            });
          }
        });

        if (consolidatedExceedingRows.length > 0) {
          const romanNum = getRomanNumeral(annexureIndex);
          annexureIndex++;

          // Show all rows as requested by user, no capping
          const totalExceeded = consolidatedExceedingRows.length;
          const slicedRows = consolidatedExceedingRows;

          let consolidatedTableRowsHTML = "";
          slicedRows.forEach((item, rIdx) => {
            const d = item.row;
            const sVal = toProperCase(String(d[stateHeader] || ""));
            const dVal = toProperCase(String(d[districtHeader] || ""));
            const bVal = toProperCase(String(d[blockHeader] || ""));
            const lVal = toProperCase(String(d[locationHeader] || ""));
            const latVal = formatCoord(String(d[latHeader] || "").trim());
            const lngVal = formatCoord(String(d[lngHeader] || "").trim());
            const srcVal = sourceHeader ? (String(d[sourceHeader] || "")) : "N/A";
            const exceededCount = item.exceededParamsList.length;
            const exceededStr = item.exceededParamsList.join(", ");

            const rowBg = rIdx % 2 === 1 ? 'background-color: #f8fafc;' : '';

            consolidatedTableRowsHTML += `
              <tr style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; ${rowBg}">
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${rIdx + 1}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: left;">${sVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: left;">${dVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: left;">${bVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: left;">${lVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${latVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${lngVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${srcVal}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: right; font-weight: bold; color: #1e3a8a;">${exceededCount}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: right; font-weight: bold; color: #000000;">${exceededStr}</td>
              </tr>
            `;
          });

          const truncationWarning = "";

          annexuresHTML += `
            <div style="font-family: 'Times New Roman', Times, serif; margin-top: 20px;">
              <h3 style="page-break-before: always; font-family: 'Times New Roman', Times, serif; font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 5px; color: #1e3a8a; text-transform: uppercase; margin-bottom: 15px; text-align: center;">
                ANNEXURE ${romanNum}
              </h3>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 11pt; font-weight: bold; margin-bottom: 10px; text-align: center; color: #334155;">
                Consolidated List of Locations with One or More Parameter Exceedances - Season: ${displaySeasonText}, Year: ${displayYearText}
              </p>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: justify; line-height: 1.6; margin-bottom: 15px; color: #475569;">
                The following table lists the groundwater sampling locations where one or more of the selected parameters exceeded the permissible limit (BIS IS 10500:2012 guidelines) during the <strong>${displaySeasonText} (${displayYearText})</strong> monitoring period. A total of <strong>${totalExceeded}</strong> location(s) were found with at least one parameter exceedance.
              </p>

              <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; table-layout: fixed; word-wrap: break-word; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: left; margin-bottom: 10px; border: 1px solid #7f7f7f;">
                <thead>
                  <tr style="background-color: #f2f2f2; color: #000000; font-weight: bold; text-align: center;">
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 5%; font-weight: bold; text-align: center;">Sl. No.</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 10%; font-weight: bold; text-align: left;">State</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 10%; font-weight: bold; text-align: left;">District</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 10%; font-weight: bold; text-align: left;">Block</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 14%; font-weight: bold; text-align: left;">Location</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 8%; font-weight: bold; text-align: center;">Latitude</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 8%; font-weight: bold; text-align: center;">Longitude</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 8%; font-weight: bold; text-align: center;">Source</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 10%; font-weight: bold; text-align: right;">No. of Parameters Exceeded</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 17%; font-weight: bold; text-align: right;">Parameter Exceeded with Values</th>
                  </tr>
                </thead>
                <tbody>
                  ${consolidatedTableRowsHTML}
                </tbody>
              </table>
              ${truncationWarning}
            </div>
          `;
        }

        // Additional summary statistics and spatial coverage annexure across all selected parameters
        if (paramMappings.length > 0) {
          const romanNum = getRomanNumeral(annexureIndex);
          annexureIndex++;

          let summaryTableRowsHTML = "";
          let validRowCount = 0;

          paramMappings.forEach(({ configKey, config, mappedHeader }) => {
            let totalValidSamples = 0;
            let abovePermissibleCount = 0;
            const affectedRegionsSet = new Set<string>();

            const regionHeader = breakdownLevel === "State" ? stateHeader : districtHeader;

            filteredData.forEach((d) => {
              const val = parseFloat(d[mappedHeader]);
              if (!isNaN(val)) {
                totalValidSamples++;
                const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
                const limit = isSingleLimit ? config.b1 : config.b2;
                let exceeds = false;
                if (configKey === "pH") {
                  if (val < config.b1 || val > config.b2) exceeds = true;
                } else if (val > limit) {
                  exceeds = true;
                }
                if (exceeds) {
                  abovePermissibleCount++;
                  const regionVal = String(d[regionHeader] || "").trim();
                  if (regionVal) {
                    affectedRegionsSet.add(toProperCase(regionVal));
                  }
                }
              }
            });

            validRowCount++;
            const pctAbove = totalValidSamples > 0 ? ((abovePermissibleCount / totalValidSamples) * 100).toFixed(2) : "0.00";
            
            let limitStr = "";
            if (configKey === "pH") {
              limitStr = `${config.b1} - ${config.b2}`;
            } else {
              const isSingleLimit = config.b1 === config.b2;
              const limit = isSingleLimit ? config.b1 : config.b2;
              limitStr = `> ${limit} ${config.unit || ""}`;
            }

            const noAffected = affectedRegionsSet.size;
            const namesAffected = noAffected > 0 ? Array.from(affectedRegionsSet).sort().join(", ") : "None";

            const rowBg = validRowCount % 2 === 0 ? 'background-color: #f8fafc;' : '';

            summaryTableRowsHTML += `
              <tr style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; ${rowBg}">
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${validRowCount}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; font-weight: bold;">${config.name} (${formatChemicalFormula(configKey)})</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${limitStr}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center; font-weight: bold;">${abovePermissibleCount}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${pctAbove}%</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${noAffected}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; font-size: 9.5pt;">${namesAffected}</td>
              </tr>
            `;
          });

          const regionTypeName = breakdownLevel === "State" ? "State/UTs" : "Districts";

          annexuresHTML += `
            <div style="font-family: 'Times New Roman', Times, serif; margin-top: 20px;">
              <h3 style="page-break-before: always; font-family: 'Times New Roman', Times, serif; font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 5px; color: #1e3a8a; text-transform: uppercase; margin-bottom: 15px; text-align: center;">
                ANNEXURE ${romanNum}
              </h3>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 11pt; font-weight: bold; margin-bottom: 10px; text-align: center; color: #334155;">
                Overall Water Quality Exceedance and Spatial Coverage Summary for Selected Parameters - Season: ${displaySeasonText}, Year: ${displayYearText}
              </p>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: justify; line-height: 1.6; margin-bottom: 15px; color: #475569;">
                The following table provides a comprehensive consolidation of groundwater exceedance statistics and spatial impact across the monitored areas for all selected water quality parameters during the <strong>${displaySeasonText} (${displayYearText})</strong> period, assessed in reference to Bureau of Indian Standards (BIS IS 10500:2012) standards.
              </p>

              <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; table-layout: fixed; word-wrap: break-word; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: left; margin-bottom: 25px; border: 1px solid #7f7f7f;">
                <thead>
                  <tr style="background-color: #f2f2f2; color: #000000; font-weight: bold; text-align: center;">
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 5%; font-weight: bold;">Sl. No.</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 18%; font-weight: bold;">Parameter</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 12%; font-weight: bold;">Permissible Limits</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 12%; font-weight: bold;">No. of Samples Above Permissible Limit</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 12%; font-weight: bold;">Percentage of Samples Above Permissible Limit</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 11%; font-weight: bold;">No. of Partially Affected ${regionTypeName}</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 30%; font-weight: bold;">Name(s) of Partially Affected ${regionTypeName}</th>
                  </tr>
                </thead>
                <tbody>
                  ${summaryTableRowsHTML}
                </tbody>
              </table>
            </div>
          `;
        }

        // Additional regional profiling annexure
        if (paramMappings.length > 0) {
          const romanNum = getRomanNumeral(annexureIndex);
          annexureIndex++;

          const regionHeader = breakdownLevel === "State" ? stateHeader : districtHeader;
          const regionTypeName = breakdownLevel === "State" ? "State/UT" : "District";

          // Group data by region
          const regionGroups: Record<string, {
            totalAnalysed: number;
            exceededSamples: number;
            exceededParams: Set<string>;
          }> = {};

          filteredData.forEach((d) => {
            const regionVal = String(d[regionHeader] || "").trim() || "Unknown";
            if (!regionGroups[regionVal]) {
              regionGroups[regionVal] = {
                totalAnalysed: 0,
                exceededSamples: 0,
                exceededParams: new Set<string>()
              };
            }

            const rData = regionGroups[regionVal];
            rData.totalAnalysed++;

            let sampleExceeded = false;
            paramMappings.forEach(({ configKey, config, mappedHeader }) => {
              const val = parseFloat(d[mappedHeader]);
              if (!isNaN(val)) {
                const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
                const limit = isSingleLimit ? config.b1 : config.b2;
                let exceeds = false;
                if (configKey === "pH") {
                  if (val < config.b1 || val > config.b2) exceeds = true;
                } else if (val > limit) {
                  exceeds = true;
                }
                if (exceeds) {
                  sampleExceeded = true;
                  rData.exceededParams.add(`${config.name} (${formatChemicalFormula(configKey)})`);
                }
              }
            });

            if (sampleExceeded) {
              rData.exceededSamples++;
            }
          });

          const regionList = Object.keys(regionGroups)
            .filter((r) => r !== "Unknown")
            .sort((a, b) => a.localeCompare(b));

          let regionalTableRowsHTML = "";
          let rIndex = 0;

          regionList.forEach((rName) => {
            const data = regionGroups[rName];
            rIndex++;

            const noParamsContaminated = data.exceededParams.size;
            const paramsContaminatedStr = noParamsContaminated > 0 
              ? Array.from(data.exceededParams).sort().join(", ") 
              : "None";

            const rowBg = rIndex % 2 === 0 ? 'background-color: #f8fafc;' : '';

            regionalTableRowsHTML += `
              <tr style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; ${rowBg}">
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${rIndex}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; font-weight: bold;">${toProperCase(rName)}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${data.totalAnalysed}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center; font-weight: bold; color: #000000;">${data.exceededSamples}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center; font-weight: bold;">${noParamsContaminated}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; font-size: 9.5pt;">${paramsContaminatedStr}</td>
              </tr>
            `;
          });

          annexuresHTML += `
            <div style="font-family: 'Times New Roman', Times, serif; margin-top: 20px;">
              <h3 style="page-break-before: always; font-family: 'Times New Roman', Times, serif; font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 5px; color: #1e3a8a; text-transform: uppercase; margin-bottom: 15px; text-align: center;">
                ANNEXURE ${romanNum}
              </h3>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 11pt; font-weight: bold; margin-bottom: 10px; text-align: center; color: #334155;">
                Regional Water Quality Contamination Profiling (${regionTypeName} Level) - Season: ${displaySeasonText}, Year: ${displayYearText}
              </p>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: justify; line-height: 1.6; margin-bottom: 15px; color: #475569;">
                The following table compiles the water quality contamination profile across individual <strong>${regionTypeName}s</strong> during the <strong>${displaySeasonText} (${displayYearText})</strong> period. It illustrates the total number of analyzed samples, the count of samples exceeding at least one selected parameter, the number of distinct contaminated parameters, and the names of the specific parameters causing the contamination in each region.
              </p>

              <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; table-layout: fixed; word-wrap: break-word; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: left; margin-bottom: 25px; border: 1px solid #7f7f7f;">
                <thead>
                  <tr style="background-color: #f2f2f2; color: #000000; font-weight: bold; text-align: center;">
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 5%; font-weight: bold;">Sl. No.</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 20%; font-weight: bold;">${regionTypeName}</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 15%; font-weight: bold;">Total No. of Analysed Samples</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 18%; font-weight: bold;">No. of Samples Exceeding One or More Selected Parameters</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 15%; font-weight: bold;">No. of Contaminated Parameters</th>
                    <th style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; width: 27%; font-weight: bold;">Name(s) of Affected Parameters</th>
                  </tr>
                </thead>
                <tbody>
                  ${regionalTableRowsHTML}
                </tbody>
              </table>
            </div>
          `;
        }

        // Additional district-wise contamination summary annexure (explicitly requested by user)
        if (paramMappings.length > 0) {
          const romanNum = getRomanNumeral(annexureIndex);
          annexureIndex++;

          // Group strictly by district
          const distContamGroups: Record<string, {
            stateName: string;
            districtName: string;
            totalAnalysed: number;
            exceededSamples: number;
            exceededParams: Set<string>;
          }> = {};

          filteredData.forEach((d) => {
            const sVal = String(d[stateHeader] || "").trim() || "N/A";
            const dVal = String(d[districtHeader] || "").trim() || "N/A";
            const key = `${sVal} | ${dVal}`;

            if (!distContamGroups[key]) {
              distContamGroups[key] = {
                stateName: sVal,
                districtName: dVal,
                totalAnalysed: 0,
                exceededSamples: 0,
                exceededParams: new Set<string>()
              };
            }

            const group = distContamGroups[key];
            group.totalAnalysed++;

            let sampleExceeded = false;
            paramMappings.forEach(({ configKey, config, mappedHeader }) => {
              const val = parseFloat(d[mappedHeader]);
              if (!isNaN(val)) {
                const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
                const limit = isSingleLimit ? config.b1 : config.b2;
                let exceeds = false;
                if (configKey === "pH") {
                  if (val < config.b1 || val > config.b2) exceeds = true;
                } else if (val > limit) {
                  exceeds = true;
                }
                if (exceeds) {
                  sampleExceeded = true;
                  group.exceededParams.add(`${config.name} (${formatChemicalFormula(configKey)})`);
                }
              }
            });

            if (sampleExceeded) {
              group.exceededSamples++;
            }
          });

          const sortedDistKeys = Object.keys(distContamGroups).sort((a, b) => {
            const gA = distContamGroups[a];
            const gB = distContamGroups[b];
            const stateComp = gA.stateName.localeCompare(gB.stateName);
            if (stateComp !== 0) return stateComp;
            return gA.districtName.localeCompare(gB.districtName);
          });

          let distContamRowsHTML = "";
          let dIdx = 0;

          sortedDistKeys.forEach((key) => {
            const g = distContamGroups[key];
            dIdx++;

            const pctExceeded = g.totalAnalysed > 0 
              ? ((g.exceededSamples / g.totalAnalysed) * 100).toFixed(2) 
              : "0.00";

            const numContaminatedParams = g.exceededParams.size;
            const contaminatedParamsStr = numContaminatedParams > 0 
              ? Array.from(g.exceededParams).sort().join(", ") 
              : "None";

            const rowBg = dIdx % 2 === 0 ? 'background-color: #f8fafc;' : '';

            distContamRowsHTML += `
              <tr style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; ${rowBg}">
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${dIdx}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle;">${g.stateName}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; font-weight: bold;">${g.districtName}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center;">${g.totalAnalysed}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center; font-weight: bold; color: #000000;">${g.exceededSamples}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center; font-weight: bold; color: #000000;">${pctExceeded}%</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; text-align: center; font-weight: bold;">${numContaminatedParams}</td>
                <td style="border: 1px solid #7f7f7f; padding: 2px 4px; vertical-align: middle; font-size: 9.5pt; font-style: italic;">${contaminatedParamsStr}</td>
              </tr>
            `;
          });

          const annexTitle = `ANNEXURE ${romanNum}`;
          const annexSub = `District-Wise Water Quality Contamination Summary for Selected Parameters - Season: ${displaySeasonText}, Year: ${displayYearText}`;
          const annexDesc = `The following table compiles the detailed district-wise groundwater contamination analysis for the selected water quality parameter(s) during the <strong>${displaySeasonText} (${displayYearText})</strong> period. It details the total number of samples analysed, the count and percentage of samples exceeding the permissible limits, the total number of contaminated parameters, and the names of the specific parameters exceeding the standards within each district.`;

          const thSlNo = "Sl. No.";
          const thState = "State/ UT";
          const thDistrict = "District";
          const thAnalysed = "No. of samples analysed";
          const thAbovePerm = "No. of samples above permissible limit";
          const thPctAbove = "Percentage of samples above permissible limit";
          const thNumContam = "No. of parameters contaminated";
          const thNamesContam = "Name(s) of contaminated parameters";

          annexuresHTML += `
            <div style="font-family: 'Times New Roman', Times, serif; margin-top: 20px;">
              <h3 style="page-break-before: always; font-family: 'Times New Roman', Times, serif; font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 5px; color: #1e3a8a; text-transform: uppercase; margin-bottom: 15px; text-align: center;">
                ${annexTitle}
              </h3>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 11pt; font-weight: bold; margin-bottom: 10px; text-align: center; color: #334155;">
                ${annexSub}
              </p>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: justify; line-height: 1.6; margin-bottom: 15px; color: #475569;">
                ${annexDesc}
              </p>

              <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; table-layout: fixed; word-wrap: break-word; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: left; margin-bottom: 25px; border: 1px solid #7f7f7f;">
                <thead>
                  <tr style="height: 0.3in; background-color: #f2f2f2; color: #000000; font-weight: bold; text-align: center;">
                    <th style="border: 1px solid #7f7f7f; padding: 0 4px; height: 0.3in; box-sizing: border-box; vertical-align: middle; width: 5%; font-weight: bold;">${thSlNo}</th>
                    <th style="border: 1px solid #7f7f7f; padding: 0 4px; height: 0.3in; box-sizing: border-box; vertical-align: middle; width: 14%; font-weight: bold;">${thState}</th>
                    <th style="border: 1px solid #7f7f7f; padding: 0 4px; height: 0.3in; box-sizing: border-box; vertical-align: middle; width: 14%; font-weight: bold;">${thDistrict}</th>
                    <th style="border: 1px solid #7f7f7f; padding: 0 4px; height: 0.3in; box-sizing: border-box; vertical-align: middle; width: 12%; font-weight: bold;">${thAnalysed}</th>
                    <th style="border: 1px solid #7f7f7f; padding: 0 4px; height: 0.3in; box-sizing: border-box; vertical-align: middle; width: 13%; font-weight: bold;">${thAbovePerm}</th>
                    <th style="border: 1px solid #7f7f7f; padding: 0 4px; height: 0.3in; box-sizing: border-box; vertical-align: middle; width: 13%; font-weight: bold;">${thPctAbove}</th>
                    <th style="border: 1px solid #7f7f7f; padding: 0 4px; height: 0.3in; box-sizing: border-box; vertical-align: middle; width: 10%; font-weight: bold;">${thNumContam}</th>
                    <th style="border: 1px solid #7f7f7f; padding: 0 4px; height: 0.3in; box-sizing: border-box; vertical-align: middle; width: 19%; font-weight: bold;">${thNamesContam}</th>
                  </tr>
                </thead>
                <tbody>
                  ${distContamRowsHTML}
                </tbody>
              </table>
            </div>
          `;
        }

        // --- Landscape Multi-Parameter Exceedance Summary Table (Section 2) ---
        if (paramMappings.length > 0) {
          const romanNum = getRomanNumeral(annexureIndex);
          annexureIndex++;

          // Group data strictly by state and district
          const distParamGroupData: Record<string, {
            stateName: string;
            districtName: string;
            totalAnalysed: number;
            paramStats: Record<string, { above: number; analysed: number }>;
          }> = {};

          filteredData.forEach((d) => {
            const sVal = String(d[stateHeader] || "").trim() || "N/A";
            const dVal = String(d[districtHeader] || "").trim() || "N/A";
            const key = `${sVal} | ${dVal}`;

            if (!distParamGroupData[key]) {
              distParamGroupData[key] = {
                stateName: sVal,
                districtName: dVal,
                totalAnalysed: 0,
                paramStats: {}
              };
              paramMappings.forEach(({ configKey }) => {
                distParamGroupData[key].paramStats[configKey] = { above: 0, analysed: 0 };
              });
            }

            const group = distParamGroupData[key];
            group.totalAnalysed++;

            paramMappings.forEach(({ configKey, config, mappedHeader }) => {
              const val = parseFloat(d[mappedHeader]);
              if (!isNaN(val)) {
                group.paramStats[configKey].analysed++;
                const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
                const limit = isSingleLimit ? config.b1 : config.b2;
                let exceeds = false;
                if (configKey === "pH") {
                  if (val < config.b1 || val > config.b2) exceeds = true;
                } else if (val > limit) {
                  exceeds = true;
                }
                if (exceeds) {
                  group.paramStats[configKey].above++;
                }
              }
            });
          });

          const sortedDistKeys = Object.keys(distParamGroupData).sort((a, b) => {
            const gA = distParamGroupData[a];
            const gB = distParamGroupData[b];
            const stateComp = gA.stateName.localeCompare(gB.stateName);
            if (stateComp !== 0) return stateComp;
            return gA.districtName.localeCompare(gB.districtName);
          });

          let headerRow1HTML = "";
          let headerRow2HTML = "";

          paramMappings.forEach(({ configKey, config }) => {
            headerRow1HTML += `
              <th colspan="2" style="border: 1px solid #7f7f7f; padding: 4px; font-weight: bold; text-align: center; background-color: #1e3a8a; color: white; font-size: 8.5pt;">
                ${config.name} (${formatChemicalFormula(configKey)})
              </th>
            `;
            headerRow2HTML += `
              <th style="border: 1px solid #7f7f7f; padding: 4px; font-weight: bold; text-align: center; background-color: #f2f2f2; color: #000000; font-size: 8pt; width: 60px;">No. Above</th>
              <th style="border: 1px solid #7f7f7f; padding: 4px; font-weight: bold; text-align: center; background-color: #f2f2f2; color: #000000; font-size: 8pt; width: 60px;">% Above</th>
            `;
          });

          let tableRowsHTML = "";
          let dIdx = 0;

          // Grand Total Accumulators
          let grandTotalAnalysed = 0;
          const grandParamStats: Record<string, { above: number; analysed: number }> = {};
          paramMappings.forEach(({ configKey }) => {
            grandParamStats[configKey] = { above: 0, analysed: 0 };
          });

          sortedDistKeys.forEach((key) => {
            const g = distParamGroupData[key];
            dIdx++;

            grandTotalAnalysed += g.totalAnalysed;

            let paramColsHTML = "";
            paramMappings.forEach(({ configKey }) => {
              const stats = g.paramStats[configKey];
              const above = stats.above;
              const totalForParam = stats.analysed;
              const pctText = totalForParam > 0 ? `${((above / totalForParam) * 100).toFixed(2)}%` : "N/A";
              
              const valColor = above > 0 ? "color: #b91c1c; font-weight: bold;" : "color: #1e293b;";
              const pctColor = above > 0 ? "color: #b91c1c; font-weight: bold;" : "color: #475569;";

              paramColsHTML += `
                <td style="border: 1px solid #7f7f7f; padding: 4px; text-align: center; ${valColor}">${above}</td>
                <td style="border: 1px solid #7f7f7f; padding: 4px; text-align: center; ${pctColor}">${pctText}</td>
              `;

              // Accumulate grand totals
              grandParamStats[configKey].above += above;
              grandParamStats[configKey].analysed += totalForParam;
            });

            const rowBg = dIdx % 2 === 0 ? 'background-color: #f8fafc;' : 'background-color: #ffffff;';

            tableRowsHTML += `
              <tr style="font-family: 'Times New Roman', Times, serif; font-size: 9pt; ${rowBg}">
                <td style="border: 1px solid #7f7f7f; padding: 4px; vertical-align: middle; text-align: center;">${dIdx}</td>
                <td style="border: 1px solid #7f7f7f; padding: 4px; vertical-align: middle; text-align: left;">${toProperCase(g.stateName)}</td>
                <td style="border: 1px solid #7f7f7f; padding: 4px; vertical-align: middle; text-align: left; font-weight: bold;">${toProperCase(g.districtName)}</td>
                <td style="border: 1px solid #7f7f7f; padding: 4px; vertical-align: middle; text-align: center;">${g.totalAnalysed}</td>
                ${paramColsHTML}
              </tr>
            `;
          });

          // Generate Grand Total columns
          let grandParamColsHTML = "";
          paramMappings.forEach(({ configKey }) => {
            const stats = grandParamStats[configKey];
            const above = stats.above;
            const totalForParam = stats.analysed;
            const pctText = totalForParam > 0 ? `${((above / totalForParam) * 100).toFixed(2)}%` : "N/A";

            const valColor = above > 0 ? "color: #b91c1c; font-weight: bold;" : "color: #1e293b;";
            const pctColor = above > 0 ? "color: #b91c1c; font-weight: bold;" : "color: #475569;";

            grandParamColsHTML += `
              <td style="border: 1px solid #7f7f7f; padding: 4px; text-align: center; font-weight: bold; background-color: #f1f5f9; ${valColor}">${above}</td>
              <td style="border: 1px solid #7f7f7f; padding: 4px; text-align: center; font-weight: bold; background-color: #f1f5f9; ${pctColor}">${pctText}</td>
            `;
          });

          // Append Grand Total Row to tableRowsHTML
          tableRowsHTML += `
            <tr style="font-family: 'Times New Roman', Times, serif; font-size: 9pt; background-color: #e2e8f0; font-weight: bold;">
              <td colspan="3" style="border: 1px solid #7f7f7f; padding: 4px; vertical-align: middle; text-align: right; font-weight: bold; background-color: #f1f5f9;">Grand Total</td>
              <td style="border: 1px solid #7f7f7f; padding: 4px; vertical-align: middle; text-align: center; font-weight: bold; background-color: #f1f5f9;">${grandTotalAnalysed}</td>
              ${grandParamColsHTML}
            </tr>
          `;

          annexuresHTML += `
            </div> <!-- Close default Section1 portrait block for MS Word page-split -->
            <div class="Section2" style="font-family: 'Times New Roman', Times, serif; margin-top: 35px;">
              <h3 style="page-break-before: always; font-family: 'Times New Roman', Times, serif; font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 5px; color: #1e3a8a; text-transform: uppercase; margin-bottom: 15px; text-align: center;">
                ANNEXURE ${romanNum} (LANDSCAPE)
              </h3>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 11pt; font-weight: bold; margin-bottom: 10px; text-align: center; color: #334155;">
                State & District-Wise Multiple Parameter Exceedance Matrix - Season: ${displaySeasonText}, Year: ${displayYearText}
              </p>
              <p style="font-family: 'Times New Roman', Times, serif; font-size: 10pt; text-align: justify; line-height: 1.6; margin-bottom: 15px; color: #475569;">
                The following landscape table presents a consolidated district-wise monitoring compliance matrix for all selected groundwater quality parameters during the <strong>${displaySeasonText} (${displayYearText})</strong> period. It provides the total number of samples analyzed, alongside parameter-specific counts and percentages exceeding Bureau of Indian Standards (BIS IS 10500:2012) permissible thresholds.
              </p>

              <div style="overflow-x: auto; width: 100%;">
                <table border="1" cellpadding="4" cellspacing="0" style="width: 100%; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 9pt; text-align: left; margin-bottom: 25px; border: 1.5pt solid #1e3a8a;">
                  <thead>
                    <tr style="background-color: #1e3a8a; color: white; text-align: center; height: 35px;">
                      <th rowspan="2" style="border: 1px solid #7f7f7f; padding: 4px; font-weight: bold; text-align: center; background-color: #1e3a8a; color: white; width: 45px;">Sl. No.</th>
                      <th rowspan="2" style="border: 1px solid #7f7f7f; padding: 4px; font-weight: bold; text-align: left; background-color: #1e3a8a; color: white; width: 110px;">State</th>
                      <th rowspan="2" style="border: 1px solid #7f7f7f; padding: 4px; font-weight: bold; text-align: left; background-color: #1e3a8a; color: white; width: 110px;">District</th>
                      <th rowspan="2" style="border: 1px solid #7f7f7f; padding: 4px; font-weight: bold; text-align: center; background-color: #1e3a8a; color: white; width: 65px;">Total Samples Analysed</th>
                      ${headerRow1HTML}
                    </tr>
                    <tr style="text-align: center; height: 30px;">
                      ${headerRow2HTML}
                    </tr>
                  </thead>
                  <tbody>
                    ${tableRowsHTML}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="Section1"> <!-- Re-open Section1 portrait block to maintain original container layout -->
          `;
        }
      }

      const mainTitle = isHindi 
        ? `${titleRegion} की वार्षिक भूजल गुणवत्ता रिपोर्ट` 
        : `ANNUAL GROUND WATER QUALITY REPORT OF ${titleRegion.toUpperCase()}`;

      const assembledHTML = `
        <div style="max-w: 900px; margin: 0 auto; font-family: 'Times New Roman', Times, serif;">
          
          <!-- Bulletin Covers -->
          <div style="text-align: center; margin-bottom: 40px;">
            <h1 style="font-size: 24pt; font-weight: bold; color: #1e3a8a; margin: 0 0 8px 0;">${mainTitle}</h1>
          </div>

          <h3 style="font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #475569; padding-bottom: 5px; margin-top: 30px;">${introHeading}</h3>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${introP1}
          </p>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${introP2}
          </p>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${introP3}
          </p>

          <h3 style="font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #475569; padding-bottom: 5px; margin-top: 30px;">${objHeading}</h3>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${objP1}
          </p>

          <h3 style="font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #475569; padding-bottom: 5px; margin-top: 30px;">${scenarioHeading}</h3>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${scenarioP1}
          </p>

          ${stationsMapHTML}

          ${paramStandardsTableHTML}

          ${summaryChartsHTML}

          <h3 style="font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #475569; padding-bottom: 5px; margin-top: 35px;">${paramHeading}</h3>
          ${parameterSectionsHTML}

          ${faciesSummaryHTML}

          ${agriculturalSuitabilityHTML}

          ${remedialMeasuresHTML}

          <h3 style="font-size: 14pt; font-weight: bold; border-bottom: 1.5px solid #475569; padding-bottom: 5px; margin-top: 40px; page-break-before: always;">${execHeading}</h3>
          <p style="text-align: justify; line-height: 1.6; margin-bottom: 15px;">
            ${execP1}
          </p>

          ${annexuresHTML}

        </div>
      `;

      if (!overrideScope) {
        setBulletinHtml(assembledHTML);
        setCompiledMapImages(latestCompiledMaps);
        setHasGenerated(true);
      }
      return assembledHTML;
    } catch (e: any) {
      console.error(e);
      if (!overrideScope) {
        setErrorMessage(`An unexpected error occurred while compiling the report: ${e?.message || e || "Unknown error"}. Please check that your dataset columns are mapped correctly.`);
      }
      return "";
    } finally {
      if (!overrideScope) {
        setIsGenerating(false);
      }
    }
  };

  const handleExportWord = async (format: "doc" | "html" | "docx" = "doc") => {
    const titleVal = bulletinScope === "National" ? "National" : bulletinScope;
    const seasonString = bulletinSeason.replace(/\s+/g, "_");
    
    setIsGenerating(true);
    setGenerationProgress(`Re-assembling and preparing latest annual report in ${format.toUpperCase()} format...`);
    try {
      const latestHtml = await handleGenerateBulletin();
      if (latestHtml) {
        await downloadMhtmlWordDoc(latestHtml, `GWQ_AnnualReport_${titleVal}_${seasonString}`, format);
      } else {
        await downloadMhtmlWordDoc(bulletinHtml, `GWQ_AnnualReport_${titleVal}_${seasonString}`, format);
      }
    } catch (err) {
      console.error("Export compilation failed, falling back to cached HTML:", err);
      await downloadMhtmlWordDoc(bulletinHtml, `GWQ_AnnualReport_${titleVal}_${seasonString}`, format);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadAllStatesZip = async (format: "doc" | "docx" = "docx") => {
    if (!scopeStates || scopeStates.length === 0) {
      setErrorMessage("No states found in the current dataset to generate reports for.");
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const zip = new JSZip();
      const seasonString = bulletinSeason.replace(/\s+/g, "_");
      
      for (let i = 0; i < scopeStates.length; i++) {
        const stateName = scopeStates[i];
        setGenerationProgress(`[Batch ${i + 1}/${scopeStates.length}] Compiling Groundwater Quality Bulletin for ${stateName}...`);
        
        // Brief timeout to let React render progress updates
        await new Promise((resolve) => setTimeout(resolve, 100));
        
        const stateHtml = await handleGenerateBulletin(stateName);
        if (stateHtml) {
          setGenerationProgress(`[Batch ${i + 1}/${scopeStates.length}] Formatting ${stateName} bulletin for Microsoft Word (.${format})...`);
          await new Promise((resolve) => setTimeout(resolve, 50));
          
          const docFileName = `GWQ_Bulletin_${stateName.replace(/\s+/g, "_")}_${seasonString}`;
          const wordHtml = await convertHtmlToWordDocHtml(stateHtml, docFileName);
          
          if (format === "docx") {
            console.log(`[Batch] Converting ${stateName} HTML to native .docx...`);
            const docxBlob = await convertHtmlToDocxBlob(wordHtml, docFileName);
            zip.file(`${docFileName}.docx`, docxBlob);
          } else {
            const mhtmlContent = convertHtmlToMhtml(wordHtml, docFileName);
            zip.file(`${docFileName}.doc`, mhtmlContent);
          }
        }
      }
      
      setGenerationProgress("Compressing and packing all state bulletins into ZIP file...");
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      const zipContent = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipContent);
      const link = document.createElement("a");
      link.href = url;
      link.download = `GWQ_State_Bulletins_All_${seasonString}_${format.toUpperCase()}.zip`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setGenerationProgress("");
    } catch (err: any) {
      console.error("[Batch Export] Failed:", err);
      setErrorMessage(`Batch generation failed: ${err?.message || err}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadMapsZip = async () => {
    try {
      if (Object.keys(compiledMapImages).length === 0) {
        setErrorMessage("No compiled maps found. Please assemble the bulletin first.");
        return;
      }
      
      const zip = new JSZip();
      const folderName = `${bulletinScope.replace(/\s+/g, "_")}_Maps_${bulletinSeason.replace(/\s+/g, "_")}`;
      const imgFolder = zip.folder(folderName);
      
      if (!imgFolder) {
        setErrorMessage("Failed to create folder inside the ZIP file.");
        return;
      }
      
      Object.entries(compiledMapImages).forEach(([paramKey, base64Data]) => {
        const parts = (base64Data as string).split(",");
        if (parts.length === 2) {
          const rawBase64 = parts[1];
          const config = PARAM_CONFIG[paramKey];
          const fileName = `${paramKey}_${config ? config.name.replace(/[^a-zA-Z0-9]/g, "_") : "Map"}.png`;
          imgFolder.file(fileName, rawBase64, { base64: true });
        }
      });
      
      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      console.error("Failed to generate ZIP file:", err);
      setErrorMessage(`Failed to package maps into ZIP: ${err.message || err}`);
    }
  };

  const parsedParamsLength = selectedBulletinParams.length;

  return (
    <div className="space-y-6">
      <div className="glossy-panel p-6 rounded-3xl">
        
        {/* Title */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-white/50 pb-4">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2 drop-shadow-sm">
            <FileText className="w-5 h-5 text-indigo-500" />
            Official Groundwater Quality Annual Report Generator
          </h3>
        </div>

        {/* Configuration toolbar */}
        <div className="bg-white/40 shadow-inner p-6 rounded-2xl mb-6 border border-white/60 relative z-30">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            
            {/* Scope */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block drop-shadow-sm">
                1. Select Region Scope
              </label>
              <select
                value={bulletinScope}
                onChange={(e) => setBulletinScope(e.target.value)}
                className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 bg-white text-xs"
              >
                <option value="National">National (All India)</option>
                {scopeStates.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>

            {/* Season title */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block drop-shadow-sm">
                2. Year Title
              </label>
              <input
                type="text"
                value={bulletinSeason}
                onChange={(e) => setBulletinSeason(e.target.value)}
                className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 bg-white text-xs"
              />
            </div>

            {/* Parameters checklist dropdown */}
            <div className="flex flex-col gap-2 relative">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block drop-shadow-sm">
                3. Choose Parameters
              </label>
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 flex justify-between items-center text-left bg-white text-xs select-none"
                >
                  <span className="truncate">
                    {selectedBulletinParams.length === availableParams.length
                      ? "All Selected"
                      : `${selectedBulletinParams.length}/${availableParams.length} Selected`}
                  </span>
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                </button>
                {dropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl z-[120] max-h-60 overflow-y-auto custom-scrollbar p-2">
                    <label className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-100 font-bold text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedBulletinParams.length === availableParams.length}
                        onChange={handleSelectAll}
                        className="rounded text-indigo-600 w-4 h-4"
                      />
                      <span>Select All</span>
                    </label>
                    {availableParams.map((val) => (
                      <label key={val} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer text-xs font-semibold text-slate-600">
                        <input
                          type="checkbox"
                          checked={selectedBulletinParams.includes(val)}
                          onChange={() => handleToggleParam(val)}
                          className="rounded text-indigo-600 w-4 h-4"
                        />
                        <span>{val}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Triggers */}
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={handleGenerateBulletin}
                disabled={isGenerating || parsedParamsLength === 0}
                className="glossy-btn-indigo px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 w-full disabled:opacity-50 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
              >
                Assemble Annual Report
              </button>
              {scopeStates && scopeStates.length > 0 && (
                <>
                  <button
                    onClick={() => handleDownloadAllStatesZip("docx")}
                    disabled={isGenerating || parsedParamsLength === 0}
                    className="glossy-btn-emerald px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 w-full disabled:opacity-50 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                    title="Generate, format, and package comprehensive water quality reports for all individual states/UTs into a single ZIP archive containing modern MS Word (.docx) documents."
                  >
                    <DownloadCloud className="w-4 h-4" /> Generate All States (.ZIP of .docx)
                  </button>
                  <button
                    onClick={() => handleDownloadAllStatesZip("doc")}
                    disabled={isGenerating || parsedParamsLength === 0}
                    className="glossy-btn-emerald/75 px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 w-full disabled:opacity-50 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                    title="Generate ZIP archive containing legacy MS Word (.doc) documents."
                  >
                    <DownloadCloud className="w-4 h-4" /> All States ZIP (.doc Legacy)
                  </button>
                </>
              )}
              {hasGenerated && (
                <>
                  <button
                    onClick={() => handleExportWord("docx")}
                    className="glossy-btn-emerald px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 w-full hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                    title="Best for modern Microsoft Word, Google Docs, and WPS Office."
                  >
                    <DownloadCloud className="w-4 h-4" /> Download MS Word (.docx)
                  </button>
                  <button
                    onClick={() => handleExportWord("doc")}
                    className="glossy-btn-emerald/75 px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 w-full hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                    title="Legacy MS Word format."
                  >
                    <DownloadCloud className="w-4 h-4" /> Download Word (.doc Legacy)
                  </button>
                  <button
                    onClick={() => handleExportWord("html")}
                    className="glossy-btn-indigo px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 w-full hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                    title="Download as standard HTML with base64 images - highly compatible with web browsers and Google Drive."
                  >
                    <Globe className="w-4 h-4" /> Download Google Docs/WPS (.html)
                  </button>
                  {Object.keys(compiledMapImages).length > 0 && (
                    <button
                      onClick={handleDownloadMapsZip}
                      className="glossy-btn-indigo px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 w-full hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                    >
                      <Map className="w-4 h-4" /> Download Compiled Maps (.ZIP)
                    </button>
                  )}
                </>
              )}
            </div>

          </div>

        </div>

        {/* Custom Diagram Sets Configuration Panel */}
        <div className="bg-white/40 border border-white/60 p-6 rounded-2xl mb-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Clipboard className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">Custom Hydrochemical Diagram Sets (Piper & USSL)</h4>
                <p className="text-[11px] text-slate-600 leading-relaxed max-w-xl">
                  Configure up to 5 custom sets of combinations of {bulletinScope === "National" ? "States" : "Districts"}. Each set will generate its own customized Piper and USSL diagrams in the report. By default (with no custom sets), one diagram of each type with all data points is displayed.
                </p>
              </div>
            </div>
            {customSets.length < 5 && (
              <button
                type="button"
                onClick={() => {
                  const newId = `set_${Date.now()}`;
                  setCustomSets([
                    ...customSets,
                    {
                      id: newId,
                      name: `Diagram Set ${customSets.length + 1}`,
                      selectedLocations: []
                    }
                  ]);
                }}
                className="glossy-btn-indigo px-4 py-2 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] cursor-pointer"
              >
                + Add Custom Set
              </button>
            )}
          </div>

          {customSets.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
              {customSets.map((set, setIdx) => (
                <div key={set.id} className="bg-white/60 p-4 rounded-xl border border-slate-100 flex flex-col gap-3 relative">
                  <div className="flex items-center justify-between gap-4">
                    <input
                      type="text"
                      value={set.name}
                      onChange={(e) => {
                        const nextName = e.target.value;
                        setCustomSets(
                          customSets.map((s) =>
                            s.id === set.id ? { ...s, name: nextName } : s
                          )
                        );
                      }}
                      placeholder="Set Name (e.g. Punjab & Haryana)"
                      className="w-full font-bold text-xs text-slate-800 bg-transparent border-b border-dashed border-slate-300 focus:border-indigo-500 pb-1 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setCustomSets(customSets.filter((s) => s.id !== set.id));
                      }}
                      className="text-slate-400 hover:text-rose-500 p-1 rounded-lg hover:bg-rose-50/50 transition-all shrink-0 cursor-pointer"
                      title="Remove Set"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                      Select {bulletinScope === "National" ? "States" : "Districts"} for this set:
                    </span>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto custom-scrollbar p-1 border border-slate-200/50 rounded-lg bg-white/40">
                      {availableDiagramLocations.length === 0 ? (
                        <span className="text-[10px] text-slate-400 font-bold p-1">No locations found.</span>
                      ) : (
                        availableDiagramLocations.map((loc) => {
                          const isChecked = set.selectedLocations.includes(loc);
                          return (
                            <label
                              key={loc}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-[10px] font-bold select-none transition-all border ${
                                isChecked
                                  ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  const nextLocs = isChecked
                                    ? set.selectedLocations.filter((l) => l !== loc)
                                    : [...set.selectedLocations, loc];
                                  setCustomSets(
                                    customSets.map((s) =>
                                      s.id === set.id ? { ...s, selectedLocations: nextLocs } : s
                                    )
                                  );
                                }}
                                className="hidden"
                              />
                              <span>{loc}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <Clipboard className="w-6 h-6 text-slate-300 mb-1" />
              <p className="text-[10px] font-bold text-slate-500">Defaulting to Single Set (All Locations)</p>
              <p className="text-[9px] text-slate-400 max-w-xs mt-0.5 px-3 leading-relaxed">
                Click "+ Add Custom Set" to create separate customized Piper and USSL diagrams for different combinations of states or districts!
              </p>
            </div>
          )}
        </div>

        {/* Manage & Upload Custom Maps Panel */}
        <div className="bg-white/40 border border-white/60 p-6 rounded-2xl mb-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <Map className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-800">Custom Map Manager & Uploader</h4>
              <p className="text-[11px] text-slate-600 leading-relaxed max-w-xl">
                Upload your own prepared map images for any specific parameter, or auto-send/push them from the <strong>GIS Spatial Map</strong> tab. Uploaded maps will automatically replace the automatically generated maps in the compiled bulletin.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Upload form */}
            <div className="bg-white/60 p-4 rounded-xl border border-slate-100 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                  1. Select Target Parameter / Layout Map
                </label>
                <select
                  value={uploadParamSelected}
                  onChange={(e) => setUploadParamSelected(e.target.value)}
                  className="w-full glossy-input rounded-lg p-2.5 font-bold text-slate-700 bg-white text-xs border border-slate-200"
                >
                  <option value="STATIONS">STATIONS (Monitoring Stations Map)</option>
                  <option value="SAR">SAR (Sodium Adsorption Ratio Map)</option>
                  <option value="RSC">RSC (Residual Sodium Carbonate Map)</option>
                  {availableParams.map((p) => (
                    <option key={p} value={p}>
                      {p} Map
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                  2. Upload Prepared Map Image
                </label>
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:bg-indigo-50/50 hover:border-indigo-400 transition-all p-3 text-center">
                  <Upload className="w-5 h-5 text-indigo-500 mb-1 animate-bounce" />
                  <span className="text-xs font-bold text-slate-700">Click to upload map</span>
                  <span className="text-[10px] text-slate-500 mt-0.5">PNG, JPG, SVG up to 5MB</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleUploadCustomMap(file);
                      }
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Active maps status/preview list */}
            <div className="bg-white/60 p-4 rounded-xl border border-slate-100 flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                Active Map Statuses & Previews ({uniqueActiveMapKeys.length})
              </label>

              {uniqueActiveMapKeys.length > 0 ? (
                <div className="space-y-2 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                  {uniqueActiveMapKeys.map((k) => {
                    const originalKey = k;
                    const base64Str = bulletinMaps[k] || "";
                    return (
                      <div
                        key={k}
                        className="flex items-center justify-between p-2 bg-emerald-50/70 border border-emerald-100/80 rounded-xl gap-3 hover:bg-emerald-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {base64Str.startsWith("data:image") ? (
                            <div className="w-10 h-10 rounded border border-slate-200 overflow-hidden bg-white shrink-0 group relative cursor-zoom-in">
                              <img src={base64Str} className="w-full h-full object-cover" alt="Map Thumbnail" />
                              {/* Hover zoom tooltip */}
                              <div className="hidden group-hover:block fixed bottom-4 right-4 z-[9999] p-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-w-sm">
                                <img src={base64Str} className="max-h-60 rounded" alt="Large Map Preview" />
                                <div className="text-[10px] text-center text-slate-500 mt-1 font-bold">{originalKey} Map</div>
                              </div>
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded border border-slate-200 bg-slate-100 flex items-center justify-center shrink-0">
                              <Map className="w-5 h-5 text-slate-400" />
                            </div>
                          )}
                          <div className="text-left">
                            <div className="text-xs font-bold text-slate-800">{originalKey} Map</div>
                            <div className="text-[9px] text-emerald-600 font-semibold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Active (Overrides Auto-GIS)
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            if (setBulletinMaps) {
                              setBulletinMaps((prev) => {
                                const next = { ...prev };
                                delete next[originalKey];
                                delete next[originalKey.toLowerCase()];
                                delete next[originalKey.toUpperCase()];
                                // also delete activeParam versions if matched
                                Object.keys(next).forEach((key) => {
                                  if (key.toUpperCase() === originalKey.toUpperCase()) {
                                    delete next[key];
                                  }
                                });
                                return next;
                              });
                              if (hasGenerated) {
                                setTimeout(() => handleGenerateBulletin(), 120);
                              }
                            }
                          }}
                          className="p-1.5 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                          title="Remove custom map"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  <Map className="w-6 h-6 text-slate-300 mb-1" />
                  <p className="text-[10px] font-bold text-slate-500">No active custom maps loaded</p>
                  <p className="text-[9px] text-slate-400 max-w-xs mt-0.5 px-3 leading-relaxed">
                    Maps generated in "GIS Spatial Map" or uploaded above will populate here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Arsenic Well Custom Diagram Upload Section */}
        <div className="bg-white/40 border border-white/60 p-4 rounded-2xl mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800">Custom Arsenic Well Diagram (Optional)</h4>
              <p className="text-[11px] text-slate-600 leading-relaxed max-w-xl">
                Upload a custom diagram for the cement sealing Arsenic-safe well. If uploaded, this image will replace the default schematic diagram in the compiled bulletin.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {customArsenicWellImage ? (
              <div className="flex items-center gap-2">
                <div className="relative w-12 h-12 rounded-lg border border-slate-200 overflow-hidden bg-white shadow-xs">
                  <img src={customArsenicWellImage} className="w-full h-full object-cover" alt="Arsenic Well Diagram Preview" />
                </div>
                <button
                  onClick={() => {
                    setCustomArsenicWellImage(null);
                    // Trigger a re-assembly if bulletin is already generated so changes apply immediately
                    if (hasGenerated) {
                      setTimeout(() => handleGenerateBulletin(), 100);
                    }
                  }}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-[11px] rounded-lg cursor-pointer transition-colors"
                >
                  Remove Image
                </button>
              </div>
            ) : (
              <label className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl cursor-pointer shadow-sm transition-all hover:scale-[1.02] active:scale-95 block">
                <span>Upload Well Diagram</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        if (event.target?.result) {
                          setCustomArsenicWellImage(event.target.result as string);
                          // Trigger a re-assembly if bulletin is already generated so changes apply immediately
                          if (hasGenerated) {
                            setTimeout(() => handleGenerateBulletin(), 100);
                          }
                        }
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </div>

        {/* Real-time preview bulletin document canvas */}
        <div className="bg-white p-6 md:p-12 rounded-2xl shadow-sm border border-slate-200 overflow-y-auto max-h-[800px] custom-scrollbar text-black">
          {isGenerating ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              <p className="font-bold text-slate-600 uppercase tracking-widest text-center text-xs animate-pulse">
                {generationProgress || "Assembling groundwater annual report structures..."}
              </p>
            </div>
          ) : errorMessage ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center max-w-md mx-auto">
              <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 border border-rose-100">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-bold text-slate-800">Annual Report Assembly Interrupted</h4>
              <p className="text-sm text-slate-500 leading-relaxed">
                {errorMessage}
              </p>
              <button 
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  handleGenerateBulletin();
                }} 
                className="mt-2 px-6 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer transition-all"
              >
                Retry Assembly
              </button>
            </div>
          ) : hasGenerated ? (
            <div 
              className="max-w-4xl mx-auto space-y-6"
              style={{ fontFamily: "'Times New Roman', Times, serif" }}
              dangerouslySetInnerHTML={{ __html: bulletinHtml }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-60">
              <FileText className="w-16 h-16 text-slate-400" />
              <p className="font-bold text-slate-500 uppercase tracking-widest text-center text-xs">
                Click "Assemble Annual Report" to parse current datasets <br />
                and construct the official regulatory annual report preview.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

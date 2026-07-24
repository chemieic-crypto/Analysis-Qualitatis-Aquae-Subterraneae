import React, { useState, useMemo, useEffect, useRef } from "react";
import { INDIA_BOUNDARY } from "../data/india_boundary";
import { Plus, Minus, RotateCcw, Info, Globe, Calendar, Send, Table, Edit2, Edit3, Search, Move, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, CornerDownLeft } from "lucide-react";
import { ShapefileLayer } from "../types";
import { getShortName } from "../utils/stateAbbreviations";
import { PARAM_CONFIG } from "../data/config";

interface GisChoroplethMapProps {
  rawData: any[];
  headers: any;
  headerMap: Record<string, string>;
  activeParam: string;
  activeConfig: any;
  reportingLevel: "State" | "District" | "Block";
  selectedState?: string;
  selectedDistrict?: string;
  showToast?: (msg: string, type: "success" | "error") => void;
  sendToBulletin?: (title: string, svgOrImageBase64: string) => void;
  customMapTitle?: string;
  layers?: ShapefileLayer[];
  choroplethClasses?: { limit: number; color: string; label: string }[];
  setChoroplethClasses?: React.Dispatch<React.SetStateAction<{ limit: number; color: string; label: string }[]>>;
  isVisible?: boolean;
}

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

// Point in polygon helpers for interactive clicking/renaming
const isPointInPolygon = (point: [number, number], polygon: number[][][]) => {
  const [x, y] = point;
  let inside = false;
  if (!polygon || polygon.length === 0) return false;
  
  const exterior = polygon[0];
  if (!exterior || exterior.length === 0) return false;
  
  for (let i = 0, j = exterior.length - 1; i < exterior.length; j = i++) {
    const xi = exterior[i][0], yi = exterior[i][1];
    const xj = exterior[j][0], yj = exterior[j][1];
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  if (inside && polygon.length > 1) {
    for (let k = 1; k < polygon.length; k++) {
      const hole = polygon[k];
      let insideHole = false;
      if (!hole) continue;
      for (let i = 0, j = hole.length - 1; i < hole.length; j = i++) {
        const xi = hole[i][0], yi = hole[i][1];
        const xj = hole[j][0], yj = hole[j][1];
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) insideHole = !insideHole;
      }
      if (insideHole) {
        return false;
      }
    }
  }
  
  return inside;
};

const isPointInFeature = (lon: number, lat: number, f: any): boolean => {
  if (!f || !f.geometry) return false;
  const geom = f.geometry;
  if (geom.type === "Polygon") {
    return isPointInPolygon([lon, lat], geom.coordinates);
  } else if (geom.type === "MultiPolygon") {
    return geom.coordinates.some((poly: any) => isPointInPolygon([lon, lat], poly));
  }
  return false;
};

interface GroupData {
  name: string;
  centroidLon: number;
  centroidLat: number;
  totalSamples: number;
  failCount: number;
  pctExceedance: number;
  avgValue: number;
}

export default function GisChoroplethMap({
  rawData,
  headers,
  headerMap,
  activeParam,
  activeConfig,
  reportingLevel,
  selectedState,
  selectedDistrict,
  showToast,
  sendToBulletin,
  customMapTitle,
  layers,
  choroplethClasses,
  setChoroplethClasses,
  isVisible,
}: GisChoroplethMapProps) {
  // Local toast message state
  const [localToast, setLocalToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const triggerToast = (msg: string, type: "success" | "error" | "info" = "success") => {
    if (showToast) {
      showToast(msg, type === "info" ? "success" : type);
    } else {
      setLocalToast({ message: msg, type });
      setTimeout(() => setLocalToast(null), 3000);
    }
  };

  // Local season toggle state: "pre" | "post" | "both"
  const [seasonFilter, setSeasonFilter] = useState<"pre" | "post" | "both">("both");

  // Customizable GIS layout and rendering modes
  const [choroplethMode, setChoroplethMode] = useState<"region" | "voronoi">("region");
  const [transparentBackground, setTransparentBackground] = useState(false);
  const [showCompass, setShowCompass] = useState(true);
  const [showScaleBar, setShowScaleBar] = useState(true);
  const [showGridLines, setShowGridLines] = useState(true);
  const [showIndiaBoundary, setShowIndiaBoundary] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"default" | "a4-portrait" | "a4-landscape">("default");
  const [showMapBorder, setShowMapBorder] = useState(true);
  
  // Advanced Features
  

  const [useShortNames, setUseShortNames] = useState(false);
  const pixelRatio = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 2; // Exact screen crispness without over-multiplying
  const [mapTheme, setMapTheme] = useState<"light" | "dark" | "blueprint">("light");

  const handleExportImage = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `GIS_Choropleth_Map_${new Date().getTime()}.png`;
    link.click();
    triggerToast("Map exported successfully!", "success");
  };

  // Local fallback state if parent doesn't provide them
  const [localChoroplethClasses, setLocalChoroplethClasses] = useState([
    { limit: 10, color: "#22c55e", label: "Low" },
    { limit: 25, color: "#eab308", label: "Moderate" },
    { limit: 50, color: "#f97316", label: "High" },
    { limit: 75, color: "#ef4444", label: "Very High" },
    { limit: 100, color: "#a855f7", label: "Severe" }
  ]);

  const activeClasses = useMemo(() => {
    return choroplethClasses || localChoroplethClasses;
  }, [choroplethClasses, localChoroplethClasses]);

  const updateClasses = (newClasses: typeof localChoroplethClasses) => {
    setLocalChoroplethClasses(newClasses);
    if (setChoroplethClasses) {
      setChoroplethClasses(newClasses);
    }
  };

  const handleClassCountChange = (count: number) => {
    if (count === activeClasses.length) return;
    
    let newClasses = [];
    const colors = ["#22c55e", "#84cc16", "#eab308", "#f97316", "#ef4444"];
    
    if (count === 2) {
      newClasses = [
        { limit: 10, color: colors[0], label: "Safe (≤10%)" },
        { limit: 100, color: colors[4], label: "Severe (>10%)" }
      ];
    } else if (count === 3) {
      newClasses = [
        { limit: 5, color: colors[0], label: "Safe (≤5%)" },
        { limit: 15, color: colors[2], label: "Moderate (>5-15%)" },
        { limit: 100, color: colors[4], label: "Severe (>15%)" }
      ];
    } else if (count === 4) {
      newClasses = [
        { limit: 5, color: colors[0], label: "Safe (0-5%)" },
        { limit: 10, color: colors[1], label: "Low (>5-10%)" },
        { limit: 20, color: colors[3], label: "High (>10-20%)" },
        { limit: 100, color: colors[4], label: "Severe (>20%)" }
      ];
    } else { // 5 classes
      newClasses = [
        { limit: 5, color: colors[0], label: "Safe (0-5%)" },
        { limit: 10, color: colors[1], label: "Low (>5-10%)" },
        { limit: 15, color: colors[2], label: "Moderate (>10-15%)" },
        { limit: 20, color: colors[3], label: "High (>15-20%)" },
        { limit: 100, color: colors[4], label: "Severe (>20%)" }
      ];
    }
    updateClasses(newClasses);
    triggerToast(`Set map to ${count} classification levels.`, "success");
  };

  const applyPreset = (presetType: "0-5" | "standard" | "dense") => {
    let newClasses;
    if (presetType === "0-5") {
      newClasses = [
        { limit: 5, color: "#22c55e", label: "Safe (0-5%)" },
        { limit: 10, color: "#84cc16", label: "Low (>5-10%)" },
        { limit: 15, color: "#eab308", label: "Moderate (>10-15%)" },
        { limit: 20, color: "#f97316", label: "High (>15-20%)" },
        { limit: 100, color: "#ef4444", label: "Severe (>20%)" }
      ];
    } else if (presetType === "dense") {
      newClasses = [
        { limit: 2, color: "#22c55e", label: "Safe (0-2%)" },
        { limit: 4, color: "#84cc16", label: "Slight (>2-4%)" },
        { limit: 6, color: "#eab308", label: "Moderate (>4-6%)" },
        { limit: 8, color: "#f97316", label: "High (>6-8%)" },
        { limit: 100, color: "#ef4444", label: "Critical (>8%)" }
      ];
    } else {
      newClasses = [
        { limit: 10, color: "#22c55e", label: "Low (0-10%)" },
        { limit: 25, color: "#eab308", label: "Moderate (>10-25%)" },
        { limit: 50, color: "#f97316", label: "High (>25-50%)" },
        { limit: 75, color: "#ef4444", label: "Very High (>50-75%)" },
        { limit: 100, color: "#a855f7", label: "Severe (>75%)" }
      ];
    }
    updateClasses(newClasses);
    triggerToast(`Applied ${presetType === "0-5" ? "0-5% Interval" : presetType === "dense" ? "High Granularity" : "Standard"} range preset!`, "success");
  };

  // State for draggable & resizable statistical classification overlay
  const [showTableOverlay, setShowTableOverlay] = useState(true);
  const [tableOverlayTransparent, setTableOverlayTransparent] = useState(true);
  const [tableScale, setTableScale] = useState(0.72); // comfortable default scale
  const [tablePos, setTablePos] = useState({ x: 15, y: 55 });
  const [isDraggingTable, setIsDraggingTable] = useState(false);
  const dragStartOffset = useRef({ x: 0, y: 0 });

  const handleTableMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent map panning during table drag
    setIsDraggingTable(true);
    dragStartOffset.current = {
      x: e.clientX - tablePos.x,
      y: e.clientY - tablePos.y
    };
  };

  useEffect(() => {
    if (!isDraggingTable) return;

    const handleMouseMoveGlobal = (e: MouseEvent) => {
      let nextX = e.clientX - dragStartOffset.current.x;
      let nextY = e.clientY - dragStartOffset.current.y;

      // Restrict within reasonable boundaries relative to canvas viewport
      const container = canvasRef.current?.parentElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        const maxX = rect.width - 80;
        const maxY = rect.height - 40;
        nextX = Math.max(-150, Math.min(maxX, nextX));
        nextY = Math.max(-50, Math.min(maxY, nextY));
      }

      setTablePos({ x: nextX, y: nextY });
    };

    const handleMouseUpGlobal = () => {
      setIsDraggingTable(false);
    };

    window.addEventListener("mousemove", handleMouseMoveGlobal);
    window.addEventListener("mouseup", handleMouseUpGlobal);
    return () => {
      window.removeEventListener("mousemove", handleMouseMoveGlobal);
      window.removeEventListener("mouseup", handleMouseUpGlobal);
    };
  }, [isDraggingTable]);

  // Map interactive state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Draggable sub-elements states
  const [northArrowPos, setNorthArrowPos] = useState({ x: 550, y: 40 });
  const [legendPos, setLegendPos] = useState({ x: 420, y: 280 });
  const [titlePos, setTitlePos] = useState({ x: 20, y: 30 });

  const [isDraggingNorthArrow, setIsDraggingNorthArrow] = useState(false);
  const [isDraggingLegend, setIsDraggingLegend] = useState(false);
  const [isDraggingTitle, setIsDraggingTitle] = useState(false);
  const dragElementStartOffset = useRef({ x: 0, y: 0 });

  // Custom Font styling states
  const [fontFamily, setFontFamily] = useState<string>("Inter");
  const [fontStyle, setFontStyle] = useState<string>("bold");
  const [fontSizeTitle, setFontSizeTitle] = useState<number>(14);
  const [fontSizeSubtitle, setFontSizeSubtitle] = useState<number>(9);
  const [fontSizeLegend, setFontSizeLegend] = useState<number>(9);
  const [fontColor, setFontColor] = useState<string>("#1e293b");
  const [legendTransparent, setLegendTransparent] = useState<boolean>(true);

  // New Font styling states for State name visible on Choropleth
  const [stateFontFamily, setStateFontFamily] = useState<string>("Inter");
  const [stateFontSize, setStateFontSize] = useState<number>(10);
  const [showRegionNames, setShowRegionNames] = useState<boolean>(true);
  const [showStateNames, setShowStateNames] = useState<boolean>(true);
  const [showDistrictNames, setShowDistrictNames] = useState<boolean>(true);
  const [showBlockNames, setShowBlockNames] = useState<boolean>(true);
  const [drawnNames] = useState<Set<string>>(new Set());
  const [stateFontStyle, setStateFontStyle] = useState<string>("bold");
  const [stateFontColor, setStateFontColor] = useState<string>("#1e293b");

  // Sub-label states for (% of samples above permissible limit)
  const [showExceedanceSubLabel, setShowExceedanceSubLabel] = useState<boolean>(true);
  const [subLabelFontFamily, setSubLabelFontFamily] = useState<string>("Inter");
  const [subLabelFontSize, setSubLabelFontSize] = useState<number>(8);
  const [subLabelFontStyle, setSubLabelFontStyle] = useState<string>("normal");
  const [subLabelFontColor, setSubLabelFontColor] = useState<string>("#475569");
  const [subLabelFormat, setSubLabelFormat] = useState<string>("percent"); // 'percent', 'full', 'exceedance', 'short_limit'

  // New Title specific controls
  const [titleFontFamily, setTitleFontFamily] = useState<string>("Inter");
  const [titleFontSize, setTitleFontSize] = useState<number>(14);
  const [titleFontStyle, setTitleFontStyle] = useState<string>("bold");
  const [titleFontColor, setTitleFontColor] = useState<string>("#0f172a");

  // New Subtitle specific controls
  const [subtitleFontFamily, setSubtitleFontFamily] = useState<string>("Inter");
  const [subtitleFontSize, setSubtitleFontSize] = useState<number>(9);
  const [subtitleFontStyle, setSubtitleFontStyle] = useState<string>("normal");
  const [subtitleFontColor, setSubtitleFontColor] = useState<string>("#475569");

  // New Legend specific controls
  const [legendFontFamily, setLegendFontFamily] = useState<string>("Inter");
  const [legendFontSize, setLegendFontSize] = useState<number>(9);
  const [legendFontStyle, setLegendFontStyle] = useState<string>("normal");
  const [legendFontColor, setLegendFontColor] = useState<string>("#1e293b");

  const [nilColor, setNilColor] = useState<string>("#38bdf8");
  const [nilLabel, setNilLabel] = useState<string>("Nil Exceedance (0%)");

  const [expandedTypography, setExpandedTypography] = useState<boolean>(false);

  // Basemap settings
  const [basemap, setBasemap] = useState<string>("No Basemap");
  const [basemapOpacity, setBasemapOpacity] = useState<number>(90);
  const [redrawTilesTrigger, setRedrawTilesTrigger] = useState<number>(0);
  const tileCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const loadingTiles = useRef<Set<string>>(new Set());

  // Interactive renaming states and mouse tracking
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [renamingFeature, setRenamingFeature] = useState<{
    feature: any;
    layer: any;
    originalName: string;
    currentName: string;
  } | null>(null);
  const [newNameInput, setNewNameInput] = useState("");
  const clickStartPos = useRef({ x: 0, y: 0 });

  // Side-by-side seasonal state
  const sideBySide = seasonFilter === "both";
  const canvasPostRef = useRef<HTMLCanvasElement>(null);

  // Tooltip & Label Position Repositioning States
  const [hoveredGroup, setHoveredGroup] = useState<GroupData | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Map Label Location Repositioning State (Allows moving any State/UT/District label location on the map area using mouse)
  const [labelOffsets, setLabelOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const [isDraggingLabel, setIsDraggingLabel] = useState<string | null>(null);
  const [hoveredLabelName, setHoveredLabelName] = useState<string | null>(null);
  const dragLabelOffsetStart = useRef({ x: 0, y: 0, initialDx: 0, initialDy: 0 });
  const renderedLabelPositionsRef = useRef<Map<string, { sx: number; sy: number; name: string }>>(new Map());

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Cache for findGroupForFeature to prevent massive Levenshtein computations on every render
  const featureMatchCache = useRef(new WeakMap<any, any>());

  useEffect(() => {
    featureMatchCache.current = new WeakMap();
  }, [rawData, layers, reportingLevel, activeParam]);

  // Helper to parse coordinates safely
  const parseCoordinate = (val: any): number | null => {
    if (val === undefined || val === null) return null;
    const num = Number(val);
    if (!isNaN(num) && num !== 0) return num;
    return null;
  };

  // Pre-Monsoon Data Subset
  const preDataSubset = useMemo(() => {
    const rawList = rawData || [];
    const safeHeaders = headers || {};
    const seasonCol = safeHeaders.season || "Season";
    return rawList.filter((row) => {
      const rowSeason = String((row && row[seasonCol]) || "").toLowerCase();
      return rowSeason.includes("pre") || rowSeason.includes("before");
    });
  }, [rawData, headers]);

  // Post-Monsoon Data Subset
  const postDataSubset = useMemo(() => {
    const rawList = rawData || [];
    const safeHeaders = headers || {};
    const seasonCol = safeHeaders.season || "Season";
    return rawList.filter((row) => {
      const rowSeason = String((row && row[seasonCol]) || "").toLowerCase();
      return rowSeason.includes("post") || rowSeason.includes("after");
    });
  }, [rawData, headers]);

  // General seasonalFilteredData for the standard single view
  const seasonalFilteredData = useMemo(() => {
    const rawList = rawData || [];
    const safeHeaders = headers || {};
    const seasonCol = safeHeaders.season || "Season";
    return rawList.filter((row) => {
      const rowSeason = String((row && row[seasonCol]) || "").toLowerCase();
      if (seasonFilter === "pre") {
        return rowSeason.includes("pre") || rowSeason.includes("before");
      }
      if (seasonFilter === "post") {
        return rowSeason.includes("post") || rowSeason.includes("after");
      }
      return true;
    });
  }, [rawData, seasonFilter, headers]);

  // 2. Helper to compute group list from any raw data array
  const computeGroupList = (dataSubset: any[]) => {
    const safeHeaders = headers || {};
    const groupKey =
      reportingLevel === "State"
        ? safeHeaders.state
        : reportingLevel === "District"
        ? safeHeaders.district
        : safeHeaders.block;

    if (!groupKey) return [];

    const groups: Record<string, { lats: number[]; lons: number[]; vals: number[] }> = {};

    const safeSubset = dataSubset || [];
    safeSubset.forEach((row) => {
      if (!row) return;
      const gName = String(row[groupKey] || "Unknown").trim();
      const lat = parseCoordinate(row[safeHeaders.latitude]);
      const lon = parseCoordinate(row[safeHeaders.longitude]);

      let val = NaN;
      const isVirtual = ["SAR", "RSC", "SSP", "Na%", "PI", "KR", "MH", "TDS", "Alkalinity"].includes(activeParam);
      if (isVirtual) {
        const caCol = Object.keys(headerMap).find((k) => headerMap[k] === "Ca") || "Ca";
        const mgCol = Object.keys(headerMap).find((k) => headerMap[k] === "Mg") || "Mg";
        const naCol = Object.keys(headerMap).find((k) => headerMap[k] === "Na") || "Na";
        const kCol = Object.keys(headerMap).find((k) => headerMap[k] === "K") || "K";
        const hco3Col = Object.keys(headerMap).find((k) => headerMap[k] === "HCO3") || "HCO3";
        const co3Col = Object.keys(headerMap).find((k) => headerMap[k] === "CO3") || "CO3";
        const ecCol = Object.keys(headerMap).find((k) => headerMap[k] === "EC") || "EC";
        const tdsCol = Object.keys(headerMap).find((k) => headerMap[k] === "TDS") || "TDS";
        const alkCol = Object.keys(headerMap).find((k) => headerMap[k] === "Alkalinity") || "Alkalinity";

        const caVal = parseFloat(row[caCol]);
        const mgVal = parseFloat(row[mgCol]);
        const naVal = parseFloat(row[naCol]);
        const kVal = parseFloat(row[kCol]) || 0;
        const hco3Val = parseFloat(row[hco3Col]);
        const co3Val = parseFloat(row[co3Col]) || 0;
        const ecVal = parseFloat(row[ecCol]);
        const tdsVal = parseFloat(row[tdsCol]);
        const alkVal = parseFloat(row[alkCol]);

        const caMeq = !isNaN(caVal) ? caVal / 20.04 : 0;
        const mgMeq = !isNaN(mgVal) ? mgVal / 12.15 : 0;
        const naMeq = !isNaN(naVal) ? naVal / 22.99 : 0;
        const kMeq = !isNaN(kVal) ? kVal / 39.10 : 0;
        const hco3Meq = !isNaN(hco3Val) ? hco3Val / 61.02 : 0;
        const co3Meq = co3Val / 30.00;

        if (activeParam === "SAR") {
          if (!isNaN(caVal) && !isNaN(mgVal) && !isNaN(naVal)) {
            const denom = Math.sqrt((caMeq + mgMeq) / 2);
            if (denom > 0) val = naMeq / denom;
          }
        } else if (activeParam === "RSC") {
          if (!isNaN(caVal) && !isNaN(mgVal) && !isNaN(hco3Val)) {
            val = hco3Meq + co3Meq - (caMeq + mgMeq);
          }
        } else if (activeParam === "TDS") {
          if (!isNaN(tdsVal)) {
            val = tdsVal;
          } else if (!isNaN(ecVal)) {
            val = ecVal * 0.65;
          }
        } else if (activeParam === "Alkalinity") {
          if (!isNaN(alkVal)) {
            val = alkVal;
          } else if (!isNaN(hco3Val)) {
            val = (hco3Meq + co3Meq) * 50;
          }
        } else if (activeParam === "SSP" || activeParam === "Na%") {
          const sum = caMeq + mgMeq + naMeq + kMeq;
          if (sum > 0) val = ((naMeq + kMeq) * 100) / sum;
        } else if (activeParam === "PI") {
          const denom = caMeq + mgMeq + naMeq;
          if (denom > 0) val = ((naMeq + Math.sqrt(hco3Meq)) * 100) / denom;
        } else if (activeParam === "KR") {
          const denom = caMeq + mgMeq;
          if (denom > 0) val = naMeq / denom;
        } else if (activeParam === "MH") {
          const denom = caMeq + mgMeq;
          if (denom > 0) val = (mgMeq * 100) / denom;
        }
      } else {
        const paramCol = Object.keys(headerMap).find((k) => headerMap[k] === activeParam) || activeParam;
        val = parseFloat(row[paramCol] || row[activeParam]);
      }

      if (!isNaN(val)) {
        if (!groups[gName]) {
          groups[gName] = { lats: [], lons: [], vals: [] };
        }
        if (lat !== null && lon !== null) {
          groups[gName].lats.push(lat);
          groups[gName].lons.push(lon);
        }
        groups[gName].vals.push(val);
      }
    });

    const list: GroupData[] = [];
    Object.entries(groups).forEach(([name, data]) => {
      if (data.vals.length === 0) return;

      // Calculate centroid of coordinates
      let centroidLon = 78.96;
      let centroidLat = 20.59;
      if (data.lons.length > 0 && data.lats.length > 0) {
        centroidLon = data.lons.reduce((a, b) => a + b, 0) / data.lons.length;
        centroidLat = data.lats.reduce((a, b) => a + b, 0) / data.lats.length;
      }

      // Calculate exceedance rate
      let failCount = 0;
      let sum = 0;
      data.vals.forEach((v) => {
        sum += v;
        if (activeParam === "SAR") {
          if (v > 26) failCount++;
        } else if (activeParam === "RSC") {
          if (v > 2.5) failCount++;
        } else if (activeParam === "SSP" || activeParam === "Na%") {
          if (v > 60) failCount++;
        } else if (activeParam === "PI") {
          if (v < 25) failCount++;
        } else if (activeParam === "KR") {
          if (v > 1.0) failCount++;
        } else if (activeParam === "MH") {
          if (v > 50) failCount++;
        } else if (activeParam === "pH") {
          if (v < activeConfig.b1 || v > activeConfig.b2) failCount++;
        } else if (activeConfig.b1 === activeConfig.b2) {
          if (v > activeConfig.b1) failCount++;
        } else {
          if (v > activeConfig.b2) failCount++;
        }
      });

      const pctExceedance = (failCount / data.vals.length) * 100;
      const avgValue = sum / data.vals.length;

      list.push({
        name,
        centroidLon,
        centroidLat,
        totalSamples: data.vals.length,
        failCount,
        pctExceedance,
        avgValue,
      });
    });

    return list;
  };

  const groupList = useMemo(() => {
    return computeGroupList(seasonalFilteredData);
  }, [seasonalFilteredData, headers, activeParam, activeConfig, headerMap, reportingLevel]);

  const groupListPre = useMemo(() => {
    return computeGroupList(preDataSubset);
  }, [preDataSubset, headers, activeParam, activeConfig, headerMap, reportingLevel]);

  const groupListPost = useMemo(() => {
    return computeGroupList(postDataSubset);
  }, [postDataSubset, headers, activeParam, activeConfig, headerMap, reportingLevel]);
  useEffect(() => {
    // Defaults only run if classes were reset (already removed from metric switch)
  }, [activeParam, groupList]);

  // 3. Determine map bounding box dynamically based on active centroids
  const mapBounds = useMemo(() => {
    // Default bounding box for India
    const defaultBounds = {
      minLon: 68.1,
      maxLon: 97.4,
      minLat: 8.0,
      maxLat: 36.0,
    };

    if (groupList.length === 0) return defaultBounds;

    // If state/district filter is applied, crop the bounds to fit our active points perfectly
    const validCoords = groupList.filter((g) => g.centroidLon !== 78.96 || g.centroidLat !== 20.59);
    if (validCoords.length === 0) return defaultBounds;

    const lons = validCoords.map((g) => g.centroidLon).filter(v => typeof v === "number" && !isNaN(v) && Number.isFinite(v));
    const lats = validCoords.map((g) => g.centroidLat).filter(v => typeof v === "number" && !isNaN(v) && Number.isFinite(v));

    if (lons.length === 0 || lats.length === 0) return defaultBounds;

    let minLon = Math.min(...lons);
    let maxLon = Math.max(...lons);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);

    // If single point, expand bounds slightly
    if (minLon === maxLon) {
      minLon -= 1.0;
      maxLon += 1.0;
    }
    if (minLat === maxLat) {
      minLat -= 1.0;
      maxLat += 1.0;
    }

    // Add 15% padding to bounds so centroids are not right on the border
    const lonPadding = (maxLon - minLon) * 0.15;
    const latPadding = (maxLat - minLat) * 0.15;

    return {
      minLon: Math.max(65.0, minLon - lonPadding),
      maxLon: Math.min(99.0, maxLon + lonPadding),
      minLat: Math.max(5.0, minLat - latPadding),
      maxLat: Math.min(39.0, maxLat + latPadding),
    };
  }, [groupList]);

  // Five-color gradient for groundwater parameter exceedance percentage (customizable classes)
  const getColorForExceedance = (pct: number): string => {
    if (pct === 0) return nilColor; // Nil Exceedance color
    if (activeClasses && activeClasses.length > 0) {
      const matched = activeClasses.find(c => pct <= c.limit);
      if (matched) return matched.color;
      return activeClasses[activeClasses.length - 1].color;
    }
    if (pct <= 10) return "#22c55e"; // Green (Low)
    if (pct <= 25) return "#eab308"; // Yellow (Moderate)
    if (pct <= 50) return "#f97316"; // Orange (High)
    if (pct <= 75) return "#ef4444"; // Red (Very High)
    return "#a855f7"; // Purple (Severe)
  };

  // Projection coordinate helpers - Geospatial Equirectangular/Mercator with true aspect-ratio scaling
  const project = (lon: number, lat: number, width: number, height: number): [number, number] => {
    const { minLon, maxLon, minLat, maxLat } = mapBounds;

    const midLon = (minLon + maxLon) / 2;
    const midLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((midLat * Math.PI) / 180) || 0.92;

    const spanXDeg = (maxLon - minLon) * cosLat || 1e-6;
    const spanYDeg = (maxLat - minLat) || 1e-6;

    // Viewport inner area with padding for borders/labels
    const padX = Math.min(18, width * 0.025);
    const padY = Math.min(18, height * 0.025);
    const availW = Math.max(10, width - padX * 2);
    const availH = Math.max(10, height - padY * 2);

    // Uniform spatial scale (pixels per degree of latitude/effective longitude)
    const scaleX = availW / spanXDeg;
    const scaleY = availH / spanYDeg;
    const fitScale = Math.min(scaleX, scaleY);

    const midX = width / 2;
    const midY = height / 2;

    // Relative offset from map center
    const screenX0 = midX + (lon - midLon) * cosLat * fitScale;
    const screenY0 = midY - (lat - midLat) * fitScale;

    // Apply interactive zoom and pan
    const x = (screenX0 - midX) * zoom + midX + panX;
    const y = (screenY0 - midY) * zoom + midY + panY;

    return [x, y];
  };

  const unproject = (x: number, y: number, width: number, height: number): [number, number] => {
    const { minLon, maxLon, minLat, maxLat } = mapBounds;

    const midLon = (minLon + maxLon) / 2;
    const midLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((midLat * Math.PI) / 180) || 0.92;

    const spanXDeg = (maxLon - minLon) * cosLat || 1e-6;
    const spanYDeg = (maxLat - minLat) || 1e-6;

    const padX = Math.min(18, width * 0.025);
    const padY = Math.min(18, height * 0.025);
    const availW = Math.max(10, width - padX * 2);
    const availH = Math.max(10, height - padY * 2);

    const fitScale = Math.min(availW / spanXDeg, availH / spanYDeg);

    const midX = width / 2;
    const midY = height / 2;

    const screenX0 = (x - panX - midX) / zoom + midX;
    const screenY0 = (y - panY - midY) / zoom + midY;

    const dxDeg = (screenX0 - midX) / fitScale;
    const dyDeg = (midY - screenY0) / fitScale;

    const lon = midLon + dxDeg / cosLat;
    const lat = midLat + dyDeg;

    return [lon, lat];
  };

  // Helper to find a matched statistical group for a given GeoJSON feature using fuzzy matching
  const findGroupForFeature = (f: any, gList: any[]) => {
    if (!f || !f.properties) return null;
    
    if (featureMatchCache.current.has(f)) {
      const cachedName = featureMatchCache.current.get(f);
      if (cachedName) return gList.find(g => g.name === cachedName) || null;
      return null;
    }

    const propValues = Object.values(f.properties).map(v => String(v).trim());

    const getFuzzyScore = (s1: string, s2: string): number => {
      const norm = (s: string) => s.toLowerCase()
        .replace(/[^a-z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b(state|ut|union territory|islands?|and)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();

      const n1 = norm(s1);
      const n2 = norm(s2);

      if (!n1 || !n2) return 0;
      if (n1 === n2) return 1.0;
      if (n1.includes(n2) || n2.includes(n1)) return 0.95;

      const len1 = n1.length;
      const len2 = n2.length;
      const maxLen = Math.max(len1, len2);
      
      const dp = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));
      for (let i = 0; i <= len1; i++) dp[i][0] = i;
      for (let j = 0; j <= len2; j++) dp[0][j] = j;

      for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
          if (n1[i - 1] === n2[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1];
          } else {
            dp[i][j] = Math.min(
              dp[i - 1][j - 1] + 1,
              dp[i][j - 1] + 1,
              dp[i - 1][j] + 1
            );
          }
        }
      }

      const dist = dp[len1][len2];
      return 1 - dist / maxLen;
    };

    let bestGroup: any = null;
    let bestScore = 0;

    for (const g of gList) {
      for (const val of propValues) {
        // First check exact normalized equality
        const score = getFuzzyScore(val, g.name);
        if (score > bestScore) {
          bestScore = score;
          bestGroup = g;
        }
      }
    }

    // Require a confidence threshold
    if (bestScore >= 0.55 && bestGroup) {
      featureMatchCache.current.set(f, bestGroup.name);
      return bestGroup;
    }
    featureMatchCache.current.set(f, null);
    return null;
  };

  // Helper to check if a feature matches the selectedState or selectedDistrict filters
  const checkIfFeatureMatchesFilter = (f: any, gList: any[]): boolean => {
    if (!f || !f.properties) return false;

    const selDist = selectedDistrict ? selectedDistrict.trim().toLowerCase() : "";
    const selState = selectedState ? selectedState.trim().toLowerCase() : "";

    if (!selDist && !selState) return false;

    // Gather all string property values from the feature
    const propValues = Object.values(f.properties).map(v => String(v).trim().toLowerCase());

    // Check fuzzy match with the group list
    const matchedGroup = findGroupForFeature(f, gList);
    const matchedGroupName = matchedGroup ? matchedGroup.name.trim().toLowerCase() : "";

    if (selDist) {
      // Check direct match
      const propMatch = propValues.some(val => val === selDist || val.includes(selDist) || selDist.includes(val));
      const groupMatch = matchedGroupName && (matchedGroupName === selDist || matchedGroupName.includes(selDist) || selDist.includes(matchedGroupName));
      if (propMatch || groupMatch) return true;
    } else if (selState) {
      // Check direct match
      const propMatch = propValues.some(val => val === selState || val.includes(selState) || selState.includes(val));
      const groupMatch = matchedGroupName && (matchedGroupName === selState || matchedGroupName.includes(selState) || selState.includes(matchedGroupName));
      if (propMatch || groupMatch) return true;
    }

    return false;
  };

  // A4 layout configurations
  const layoutSizes = useMemo(() => ({
    default: { width: 650, height: 500, style: "w-full lg:w-2/3 h-[500px]" },
    "a4-portrait": { width: 595, height: 842, style: "w-full max-w-[500px] aspect-[1/1.414] h-auto border border-slate-200 shadow-lg mx-auto" },
    "a4-landscape": { width: 842, height: 595, style: "w-full max-w-[750px] aspect-[1.414/1] h-auto border border-slate-200 shadow-lg mx-auto" },
  }), []);

  const currentLayout = layoutSizes[layoutMode] || layoutSizes.default;

  // 4. Draw Map using discrete Voronoi algorithm or direct Region-based choropleth
  const drawMapOnCanvas = (canvas: HTMLCanvasElement, gList: GroupData[], titleText: string, subtitleText: string) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Reset transform before scaling to avoid cumulative scales
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(pixelRatio, pixelRatio);

    const width = canvas.width / pixelRatio;
    const height = canvas.height / pixelRatio;

    // Clear canvas - support transparent background
    drawnNames.clear();
    renderedLabelPositionsRef.current.clear();
    if (transparentBackground) {
      ctx.clearRect(0, 0, width, height);
    } else {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, width, height);
    }

    // Render basemap tiles if active
    if (basemap !== "No Basemap") {
      ctx.save();
      ctx.globalAlpha = basemapOpacity / 100;

      // Calculate full canvas view lon/lat bounds to cover entire map canvas area without gaps
      const [cMinLon, cMaxLat] = unproject(0, 0, width, height);
      const [cMaxLon, cMinLat] = unproject(width, height, width, height);

      const tileMinLon = Math.max(-180, Math.min(180, Math.min(cMinLon, cMaxLon) - 0.2));
      const tileMaxLon = Math.max(-180, Math.min(180, Math.max(cMinLon, cMaxLon) + 0.2));
      const tileMinLat = Math.max(-85, Math.min(85, Math.min(cMinLat, cMaxLat) - 0.2));
      const tileMaxLat = Math.max(-85, Math.min(85, Math.max(cMinLat, cMaxLat) + 0.2));

      const spanLon = (mapBounds.maxLon - mapBounds.minLon) || 1e-6;
      let baseZ = Math.round(Math.log2(360 / spanLon)) + 2;
      let finalZoom = Math.max(1, Math.min(18, baseZ + Math.round(Math.log2(zoom))));

      let xMin = Math.floor(lngToTileX(tileMinLon, finalZoom));
      let xMax = Math.floor(lngToTileX(tileMaxLon, finalZoom));
      let yMin = Math.floor(latToTileY(tileMaxLat, finalZoom));
      let yMax = Math.floor(latToTileY(tileMinLat, finalZoom));

      // Limit maximum number of tiles to draw to avoid heavy loading and crash
      while ((xMax - xMin + 1) * (yMax - yMin + 1) > 80 && finalZoom > 1) {
        finalZoom--;
        xMin = Math.floor(lngToTileX(tileMinLon, finalZoom));
        xMax = Math.floor(lngToTileX(tileMaxLon, finalZoom));
        yMin = Math.floor(latToTileY(tileMaxLat, finalZoom));
        yMax = Math.floor(latToTileY(tileMinLat, finalZoom));
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

      for (let tx = xMin; tx <= xMax; tx++) {
        for (let ty = yMin; ty <= yMax; ty++) {
          const tileLngLeft = tileXToLng(tx, finalZoom);
          const tileLngRight = tileXToLng(tx + 1, finalZoom);
          const tileLatTop = tileYToLat(ty, finalZoom);
          const tileLatBottom = tileYToLat(ty + 1, finalZoom);

          const [tileCanvasXLeft, tileCanvasYTop] = project(tileLngLeft, tileLatTop, width, height);
          const [tileCanvasXRight, tileCanvasYBottom] = project(tileLngRight, tileLatBottom, width, height);

          const tW = tileCanvasXRight - tileCanvasXLeft;
          const tH = tileCanvasYBottom - tileCanvasYTop;

          // Viewport bounding check
          if (
            tileCanvasXRight < 0 ||
            tileCanvasXLeft > width ||
            tileCanvasYBottom < 0 ||
            tileCanvasYTop > height
          ) {
            continue;
          }

          const url = getTileUrl(tx, ty, finalZoom);
          
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
            ctx.fillStyle = basemap.includes("Satellite") || basemap.includes("Dark") ? "#0c1524" : "#f1ebd9";
            ctx.fillRect(tileCanvasXLeft, tileCanvasYTop, tW, tH);
          } else {
            ctx.drawImage(tileImg, tileCanvasXLeft, tileCanvasYTop, tW, tH);
          }
        }
      }
      ctx.restore();
    }

    const activeLayers = (layers || []).filter(l => l.visible && l.geoJson);
    const hasLayers = activeLayers.length > 0;
    const shouldDrawIndiaBoundary = !hasLayers || showIndiaBoundary;

    // Draw grid background if transparent background is OFF and grid lines are enabled
    if (!transparentBackground && showGridLines) {
      ctx.strokeStyle = "rgba(71, 85, 105, 0.05)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    if (gList.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = `bold 14px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText("No spatial data available to plot.", width / 2, height / 2);
      return;
    }

    // Draw high-fidelity Latitude/Longitude Grid lines
    if (showGridLines) {
      ctx.save();
      ctx.strokeStyle = "rgba(71, 85, 105, 0.08)";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);

      const { minLon, maxLon, minLat, maxLat } = mapBounds;
      const lonStep = Math.max(0.5, Math.ceil((maxLon - minLon) / 5));
      const latStep = Math.max(0.5, Math.ceil((maxLat - minLat) / 5));

      const startLon = Math.floor(minLon / lonStep) * lonStep;
      const endLon = Math.ceil(maxLon / lonStep) * lonStep;
      for (let lon = startLon; lon <= endLon; lon += lonStep) {
        ctx.beginPath();
        for (let lat = minLat; lat <= maxLat; lat += (maxLat - minLat) / 10) {
          const [sx, sy] = project(lon, lat, width, height);
          if (lat === minLat) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        // Draw label at the bottom of the grid
        const [sx] = project(lon, minLat + (maxLat - minLat) * 0.015, width, height);
        if (sx > 15 && sx < width - 15) {
          ctx.font = "bold 8px Courier, monospace";
          ctx.fillStyle = "rgba(71, 85, 105, 0.45)";
          ctx.textAlign = "center";
          ctx.fillText(`${lon.toFixed(1)}°E`, sx, height - 12);
        }
      }

      const startLat = Math.floor(minLat / latStep) * latStep;
      const endLat = Math.ceil(maxLat / latStep) * latStep;
      for (let lat = startLat; lat <= endLat; lat += latStep) {
        ctx.beginPath();
        for (let lon = minLon; lon <= maxLon; lon += (maxLon - minLon) / 10) {
          const [sx, sy] = project(lon, lat, width, height);
          if (lon === minLon) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        // Draw label at the left of the grid
        const [, sy] = project(minLon + (maxLon - minLon) * 0.015, lat, width, height);
        if (sy > 15 && sy < height - 15) {
          ctx.font = "bold 8px Courier, monospace";
          ctx.fillStyle = "rgba(71, 85, 105, 0.45)";
          ctx.textAlign = "left";
          ctx.fillText(`${lat.toFixed(1)}°N`, 12, sy);
        }
      }
      ctx.restore();
    }

    // Map screen coordinates for active centroids
    const screenCentroids = gList.map((g) => {
      const [sx, sy] = project(g.centroidLon, g.centroidLat, width, height);
      return { sx, sy, g };
    });

    // MODE A: REGION-BASED SHAPEFILE CHOROPLETH (Colors uploaded shapefile features directly)
    if (choroplethMode === "region" && hasLayers) {
      activeLayers.forEach((layer) => {
        try {
          if (!layer || !layer.geoJson) return;
          ctx.save();
          
          const strokeColor = layer.strokeColor || "#475569";
          const strokeWidth = layer.strokeWidth || 1.0;
          const features = layer.geoJson.features || (layer.geoJson.type === "Feature" ? [layer.geoJson] : []);

          features.forEach((f: any) => {
            try {
              if (!f || !f.geometry) return;

          const matchedGroup = findGroupForFeature(f, gList);
          const finalFillColor = matchedGroup 
            ? getColorForExceedance(matchedGroup.pctExceedance)
            : (transparentBackground ? "rgba(226, 232, 240, 0.05)" : "rgba(226, 232, 240, 0.45)");

          const drawPolygonRing = (ring: any[]) => {
            if (!ring || !Array.isArray(ring) || ring.length === 0) return;
            
            // PRECOMPUTE SCREEN COORDINATES TO AVOID RE-PROJECTING 3 TIMES
            const screenPts: [number, number][] = [];
            ring.forEach((pt: any) => {
              if (!pt || !Array.isArray(pt) || pt.length < 2) return;
              const [lon, lat] = pt;
              if (typeof lon !== "number" || typeof lat !== "number" || isNaN(lon) || isNaN(lat)) return;
              screenPts.push(project(lon, lat, width, height));
            });
            if (screenPts.length === 0) return;

            // Build path and find local vertical bounding box
            ctx.beginPath();
            let minY = Infinity;
            let maxY = -Infinity;
            
            screenPts.forEach(([sx, sy], idx) => {
              if (idx === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
              if (Number.isFinite(sy)) {
                if (sy < minY) minY = sy;
                if (sy > maxY) maxY = sy;
              }
            });
            ctx.closePath();
            
            ctx.fillStyle = finalFillColor;
            ctx.fill();

            // Guard against divide by zero, infinite values, or extreme shapes
            if (Number.isFinite(minY) && Number.isFinite(maxY) && maxY > minY) {
              // Apply a premium flat glossy sheen overlay clipped to the polygon ring bounds
              ctx.save();

            }

            if (layer.showStroke !== false) {
              ctx.strokeStyle = matchedGroup ? "#1e293b" : strokeColor;
              ctx.lineWidth = matchedGroup ? 1.0 : strokeWidth;
              ctx.stroke();
            }
          };

          const drawGeom = (geom: any) => {
            if (!geom) return;
            if (geom.type === "Polygon") {
              geom.coordinates.forEach((ring: any[]) => drawPolygonRing(ring));
            } else if (geom.type === "MultiPolygon") {
              geom.coordinates.forEach((poly: any[][]) => {
                poly.forEach((ring: any[]) => drawPolygonRing(ring));
              });
            } else if (geom.type === "GeometryCollection") {
              geom.geometries?.forEach((g: any) => drawGeom(g));
            }
          };

          drawGeom(f.geometry);

          // Labels for region mode showing exceedance percentage
          if (layer.showLabels && layer.labelKey) {
            let avgLon = 0, avgLat = 0, count = 0;
            const accum = (ring: any[]) => {
              if (!ring || !Array.isArray(ring)) return;
              ring.forEach((pt: any) => {
                if (!pt || !Array.isArray(pt) || pt.length < 2) return;
                const [lon, lat] = pt;
                if (typeof lon !== "number" || typeof lat !== "number" || isNaN(lon) || isNaN(lat)) return;
                avgLon += lon;
                avgLat += lat;
                count++;
              });
            };
            
            const geom = f.geometry;
            if (geom.type === "Polygon") {
              geom.coordinates.forEach(accum);
            } else if (geom.type === "MultiPolygon") {
              geom.coordinates.forEach((poly: any[][]) => poly.forEach(accum));
            }
            
            if (count > 0) {
              const lon = avgLon / count;
              const lat = avgLat / count;
              const [sx, sy] = project(lon, lat, width, height);
              
              if (sx >= 0 && sx <= width && sy >= 0 && sy <= height) {
                const baseLabel = String(f.properties?.[layer.labelKey] || "");
                const isLayerState = (layer.name || "").toLowerCase().includes("state");
                const isLayerDist = (layer.name || "").toLowerCase().includes("dist") || (layer.name || "").toLowerCase().includes("district");
                const isLayerBlock = (layer.name || "").toLowerCase().includes("block");
                const showThisLayerLabels = showRegionNames && (
                  isLayerState ? showStateNames : isLayerDist ? showDistrictNames : isLayerBlock ? showBlockNames : true
                );
                if (showThisLayerLabels && baseLabel) {
                  const labelText = nameOverrides[baseLabel] || baseLabel;
                  const labelLower = labelText.trim().toLowerCase();
                  if (!drawnNames.has(labelLower)) {
                    drawnNames.add(labelLower);
                    ctx.font = `${stateFontStyle} ${stateFontSize || layer.labelSize || 9}px ${stateFontFamily || "sans-serif"}`;
                    ctx.fillStyle = stateFontColor || layer.labelColor || "#0f172a";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    const offset = labelOffsets[baseLabel] || labelOffsets[labelText] || { dx: 0, dy: 0 };
                    const finalSx = sx + offset.dx;
                    const finalSy = sy + offset.dy;
                    ctx.fillText(labelText, finalSx, finalSy);

                    // Draw sub-label (% of samples above permissible limit) if match found in gList
                    if (showExceedanceSubLabel) {
                      const match = gList.find((g) => g.name.toLowerCase() === baseLabel.toLowerCase() || g.name.toLowerCase() === labelText.toLowerCase());
                      if (match) {
                        ctx.font = `${subLabelFontStyle} ${subLabelFontSize}px ${subLabelFontFamily || "sans-serif"}`;
                        ctx.fillStyle = subLabelFontColor;
                        ctx.textAlign = "center";
                        ctx.textBaseline = "top";
                        let subText = `(${match.pctExceedance.toFixed(1)}%)`;
                        if (subLabelFormat === "full") subText = `(${match.pctExceedance.toFixed(1)}% of samples above permissible limit)`;
                        else if (subLabelFormat === "exceedance") subText = `(${match.pctExceedance.toFixed(1)}% Exceedance)`;
                        else if (subLabelFormat === "short_limit") subText = `(${match.pctExceedance.toFixed(1)}% samples > limit)`;
                        const subY = finalSy + Math.round((stateFontSize || layer.labelSize || 9) / 2) + 2;
                        ctx.fillText(subText, finalSx, subY);
                      }
                    }

                    renderedLabelPositionsRef.current.set(baseLabel.toLowerCase(), { sx: finalSx, sy: finalSy, name: baseLabel });
                    if (labelText !== baseLabel) {
                      renderedLabelPositionsRef.current.set(labelText.toLowerCase(), { sx: finalSx, sy: finalSy, name: baseLabel });
                    }
                  }
                }
              }
            }
          }
            } catch (err) {
              console.error("Error rendering feature in Mode A:", err);
            }
          });

          ctx.restore();
        } catch (err) {
          console.error("Error rendering layer in Mode A:", err);
        }
      });
    } 
    // MODE B: INTERPOLATED CONTINUOUS VORONOI GRID
    else {
      const offW = 150;
      const offH = 125;
      const offCanvas = document.createElement("canvas");
      offCanvas.width = offW;
      offCanvas.height = offH;
      const offCtx = offCanvas.getContext("2d");

      if (offCtx) {
        const drawGeomForClip = (geom: any) => {
          if (!geom) return;
          if (geom.type === "Polygon") {
            geom.coordinates.forEach((ring: any[]) => {
              if (!ring || !Array.isArray(ring)) return;
              ring.forEach((pt: any, idx: number) => {
                if (!pt || !Array.isArray(pt) || pt.length < 2) return;
                const [lon, lat] = pt;
                if (typeof lon !== "number" || typeof lat !== "number" || isNaN(lon) || isNaN(lat)) return;
                const [sx, sy] = project(lon, lat, width, height);
                if (idx === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              });
            });
          } else if (geom.type === "MultiPolygon") {
            geom.coordinates.forEach((poly: any[][]) => {
              if (!poly || !Array.isArray(poly)) return;
              poly.forEach((ring: any[]) => {
                if (!ring || !Array.isArray(ring)) return;
                ring.forEach((pt: any, idx: number) => {
                  if (!pt || !Array.isArray(pt) || pt.length < 2) return;
                  const [lon, lat] = pt;
                  if (typeof lon !== "number" || typeof lat !== "number" || isNaN(lon) || isNaN(lat)) return;
                  const [sx, sy] = project(lon, lat, width, height);
                  if (idx === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
              });
            });
          }
        };

        const imgData = offCtx.createImageData(offW, offH);
        const data = imgData.data;

        const offCentroids = gList.map((g) => {
          const [osx, osy] = project(g.centroidLon, g.centroidLat, offW, offH);
          return { osx, osy, g };
        });

        for (let y = 0; y < offH; y++) {
          for (let x = 0; x < offW; x++) {
            let minDist = Infinity;
            let nearestIdx = -1;

            for (let i = 0; i < offCentroids.length; i++) {
              const dx = x - offCentroids[i].osx;
              const dy = y - offCentroids[i].osy;
              const dist = dx * dx + dy * dy;
              if (dist < minDist) {
                minDist = dist;
                nearestIdx = i;
              }
            }

            if (nearestIdx !== -1) {
              const g = offCentroids[nearestIdx].g;
              const colorHex = getColorForExceedance(g.pctExceedance);

              const r = parseInt(colorHex.substring(1, 3), 16);
              const g_val = parseInt(colorHex.substring(3, 5), 16);
              const b = parseInt(colorHex.substring(5, 7), 16);

              const idx = (y * offW + x) * 4;
              data[idx] = r;
              data[idx + 1] = g_val;
              data[idx + 2] = b;
              data[idx + 3] = 220; // 85% opacity for professional blending
            }
          }
        }

        offCtx.putImageData(imgData, 0, 0);

        ctx.save();
        ctx.beginPath();
        
        // Define Clipping Path
        if (hasLayers) {
          // Clip to union of custom shapefile geometries
          activeLayers.forEach(l => {
            try {
              if (!l || !l.geoJson) return;
              const features = l.geoJson.features || (l.geoJson.type === "Feature" ? [l.geoJson] : []);
              features.forEach(f => {
                if (f && f.geometry) drawGeomForClip(f.geometry);
              });
            } catch (err) {
              console.error("Error in clip drawing for layer:", err);
            }
          });
        } else if (shouldDrawIndiaBoundary) {
          // Fallback to India boundary clip
          const coords = INDIA_BOUNDARY.geometry.coordinates[0];
          coords.forEach((pt: any, idx: number) => {
            const [lon, lat] = pt;
            const [sx, sy] = project(lon, lat, width, height);
            if (idx === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
        }

        ctx.closePath();
        // Render Voronoi stretched to canvas
        ctx.drawImage(offCanvas, 0, 0, width, height);


      }

      // Draw custom boundaries on top of cells
      if (hasLayers) {
        activeLayers.forEach((layer) => {
          try {
            if (!layer || !layer.geoJson) return;
            ctx.save();
            const strokeColor = layer.strokeColor || "#3b82f6";
            const strokeWidth = layer.strokeWidth || 1.5;
            
            const drawPolygonRing = (ring: any[]) => {
              if (!ring || !Array.isArray(ring) || ring.length === 0) return;
              ctx.beginPath();
              ring.forEach((pt: any, idx: number) => {
                if (!pt || !Array.isArray(pt) || pt.length < 2) return;
                const [lon, lat] = pt;
                if (typeof lon !== "number" || typeof lat !== "number" || isNaN(lon) || isNaN(lat)) return;
                const [sx, sy] = project(lon, lat, width, height);
                if (idx === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              });
              ctx.closePath();
              if (layer.showStroke !== false) {
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = strokeWidth;
                ctx.stroke();
              }
            };

            const drawGeom = (geom: any) => {
              if (!geom) return;
              if (geom.type === "Polygon") {
                geom.coordinates.forEach((ring: any[]) => drawPolygonRing(ring));
              } else if (geom.type === "MultiPolygon") {
                geom.coordinates.forEach((poly: any[][]) => {
                  poly.forEach((ring: any[]) => drawPolygonRing(ring));
                });
              }
            };

            const features = layer.geoJson.features || (layer.geoJson.type === "Feature" ? [layer.geoJson] : []);
            features.forEach((f: any) => {
              if (f && f.geometry) drawGeom(f.geometry);
            });
            ctx.restore();
          } catch (err) {
            console.error("Error drawing custom boundaries on top of cells:", err);
          }
        });
      } else if (shouldDrawIndiaBoundary) {
        ctx.beginPath();
        const coords = INDIA_BOUNDARY.geometry.coordinates[0];
        coords.forEach((pt: any, idx: number) => {
          const [lon, lat] = pt;
          const [sx, sy] = project(lon, lat, width, height);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
    }

    // Highlight the selected administrative region if any is active (with a thicker border or different stroke color)
    if (hasLayers && (selectedState || selectedDistrict)) {
      activeLayers.forEach((layer) => {
        try {
          if (!layer || !layer.geoJson) return;
          const features = layer.geoJson.features || (layer.geoJson.type === "Feature" ? [layer.geoJson] : []);
          features.forEach((f: any) => {
            try {
              if (!f || !f.geometry) return;
              if (!checkIfFeatureMatchesFilter(f, gList)) return;

              ctx.save();
              const drawPolygonRingHighlight = (ring: any[]) => {
                if (!ring || !Array.isArray(ring) || ring.length === 0) return;
                ctx.beginPath();
                ring.forEach((pt: any, idx: number) => {
                  if (!pt || !Array.isArray(pt) || pt.length < 2) return;
                  const [lon, lat] = pt;
                  if (typeof lon !== "number" || typeof lat !== "number" || isNaN(lon) || isNaN(lat)) return;
                  const [sx, sy] = project(lon, lat, width, height);
                  if (idx === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();



                // First pass: thicker outer border for deep contrast and separation
                ctx.save();
                ctx.strokeStyle = "#1e293b";
                ctx.lineWidth = 5;
                ctx.lineJoin = "round";
                ctx.stroke();
                ctx.restore();


              };

              const drawGeomHighlight = (geom: any) => {
                if (!geom) return;
                if (geom.type === "Polygon") {
                  geom.coordinates.forEach((ring: any[]) => drawPolygonRingHighlight(ring));
                } else if (geom.type === "MultiPolygon") {
                  geom.coordinates.forEach((poly: any[][]) => {
                    poly.forEach((ring: any[]) => drawPolygonRingHighlight(ring));
                  });
                } else if (geom.type === "GeometryCollection") {
                  geom.geometries?.forEach((g: any) => drawGeomHighlight(g));
                }
              };

              drawGeomHighlight(f.geometry);
              ctx.restore();
            } catch (err) {
              console.error("Error highlighting feature:", err);
            }
          });
        } catch (err) {
          console.error("Error highlighting layer:", err);
        }
      });
    }

    // Draw Compass Rose (North Arrow)
    if (showCompass) {
      ctx.save();
      const cx = northArrowPos.x === 550 ? width - 40 : northArrowPos.x;
      const cy = northArrowPos.y === 40 ? 50 : northArrowPos.y;

      // Draw beautiful outer ring
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(15, 23, 42, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Inner precise circle
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
      ctx.fillStyle = "#0f172a";
      ctx.fill();

      // Sharp North Pointer (Left side - filled dark, right side - white/contrasting)
      ctx.beginPath();
      ctx.moveTo(cx, cy - 18); // top tip
      ctx.lineTo(cx - 5, cy);  // left tip
      ctx.lineTo(cx, cy - 2);  // inner join
      ctx.closePath();
      ctx.fillStyle = "#0f172a"; // solid dark slate
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx, cy - 18); // top tip
      ctx.lineTo(cx + 5, cy);  // right tip
      ctx.lineTo(cx, cy - 2);  // inner join
      ctx.closePath();
      ctx.fillStyle = "#f1f5f9"; // solid light grey
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.fill();

      // Sharp South Pointer (Left side - light, right side - dark)
      ctx.beginPath();
      ctx.moveTo(cx, cy + 18); // bottom tip
      ctx.lineTo(cx - 5, cy);  // left tip
      ctx.lineTo(cx, cy + 2);  // inner join
      ctx.closePath();
      ctx.fillStyle = "#cbd5e1"; // light grey-blue
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx, cy + 18); // bottom tip
      ctx.lineTo(cx + 5, cy);  // right tip
      ctx.lineTo(cx, cy + 2);  // inner join
      ctx.closePath();
      ctx.fillStyle = "#475569"; // slate dark grey
      ctx.fill();

      // Premium elegant "N" lettering above the pointer
      ctx.font = `bold 10px ${fontFamily || "sans-serif"}`;
      ctx.fillStyle = "#0f172a";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("N", cx, cy - 20);

      ctx.restore();
    }

    // Draw Scale Bar (Lower Left Side)
    if (showScaleBar) {
      ctx.save();
      const sx = 20;
      const sy = height - 25;
      const barWidth = 80;

      const [lon1, lat1] = unproject(sx, sy, width, height);
      const [lon2] = unproject(sx + barWidth, sy, width, height);

      const R = 6371;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.cos(lat1 * Math.PI / 180) * Math.cos(lat1 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distanceKm = R * c;

      if (distanceKm > 0) {
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 1.2;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + barWidth, sy);
        ctx.moveTo(sx, sy - 3);
        ctx.lineTo(sx, sy + 3);
        ctx.moveTo(sx + barWidth, sy - 3);
        ctx.lineTo(sx + barWidth, sy + 3);
        ctx.moveTo(sx + barWidth / 2, sy - 3);
        ctx.lineTo(sx + barWidth / 2, sy + 3);
        ctx.stroke();

        ctx.font = "bold 8px Inter, sans-serif";
        ctx.fillStyle = "#1e293b";
        ctx.textAlign = "center";
        ctx.fillText("0", sx, sy - 6);
        ctx.fillText((distanceKm / 2).toFixed(0), sx + barWidth / 2, sy - 6);
        ctx.fillText(`${distanceKm.toFixed(0)} km`, sx + barWidth, sy - 6);
      }
      ctx.restore();
    }

    // Draw Centroids as text labels
    const shouldDrawCentroidLabels = showRegionNames && (
      reportingLevel === "State"
        ? showStateNames
        : reportingLevel === "District"
        ? showDistrictNames
        : showBlockNames
    );
    if (shouldDrawCentroidLabels) {
      screenCentroids.forEach(({ sx, sy, g }) => {
        if (sx < -20 || sx > width + 20 || sy < -20 || sy > height + 20) return;
        
        let displayName = nameOverrides[g.name] || g.name;
        if (useShortNames) {
          displayName = getShortName(displayName, reportingLevel, useShortNames);
        }
        const labelText = displayName; // Full name up to 20+ characters, fully visible
        const labelLower = displayName.trim().toLowerCase();
        
        if (!drawnNames.has(labelLower)) {
          drawnNames.add(labelLower);
          ctx.save();
          
          // 1. Main State / UT / District Name Label
          ctx.font = `${stateFontStyle} ${stateFontSize}px ${stateFontFamily}, sans-serif`;
          ctx.fillStyle = stateFontColor;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const offset = labelOffsets[g.name] || labelOffsets[displayName] || { dx: 0, dy: 0 };
          const finalSx = Math.round(sx + offset.dx);
          const finalSy = Math.round(sy + offset.dy);
          ctx.fillText(labelText, finalSx, finalSy);

          // 2. Sub-label: (% of samples above permissible limit)
          if (showExceedanceSubLabel) {
            ctx.font = `${subLabelFontStyle} ${subLabelFontSize}px ${subLabelFontFamily}, sans-serif`;
            ctx.fillStyle = subLabelFontColor;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";

            let subText = `(${g.pctExceedance.toFixed(1)}%)`;
            if (subLabelFormat === "full") subText = `(${g.pctExceedance.toFixed(1)}% of samples above permissible limit)`;
            else if (subLabelFormat === "exceedance") subText = `(${g.pctExceedance.toFixed(1)}% Exceedance)`;
            else if (subLabelFormat === "short_limit") subText = `(${g.pctExceedance.toFixed(1)}% samples > limit)`;

            const subY = finalSy + Math.round(stateFontSize / 2) + 2;
            ctx.fillText(subText, finalSx, subY);
          }

          ctx.restore();
          renderedLabelPositionsRef.current.set(g.name.toLowerCase(), { sx: finalSx, sy: finalSy, name: g.name });
          if (displayName !== g.name) {
            renderedLabelPositionsRef.current.set(displayName.toLowerCase(), { sx: finalSx, sy: finalSy, name: g.name });
          }
        }
      });
    }

    // Draw customizable map title & subtitle (Rule 5 & 8) - Centered & Draggable at upper side
    ctx.save();
    const tY = Math.round(titlePos.y);
    const titleX = titlePos.x === 20 ? Math.round(width / 2) : Math.round(titlePos.x);

    ctx.font = `${titleFontStyle} ${titleFontSize}px ${titleFontFamily}`;
    ctx.fillStyle = titleFontColor;
    ctx.textAlign = "center";
    ctx.fillText(titleText, titleX, tY);

    ctx.font = `${subtitleFontStyle} ${subtitleFontSize}px ${subtitleFontFamily}`;
    ctx.fillStyle = subtitleFontColor;
    ctx.textAlign = "center";
    ctx.fillText(subtitleText, titleX, tY + Math.round(titleFontSize * 1.1));
    ctx.restore();

    // Draw Customizable map legend with transparent/translucent background (Rule 4 & 6 & 8) - Draggable!
    ctx.save();
    const lW = 160;
    const lH = Math.max(110, (activeClasses.length + 2) * 15 + 30);
    const lX = legendPos.x === 420 ? Math.round(width - 180) : Math.round(legendPos.x);
    const lY = legendPos.y === 280 ? Math.round(height - lH - 20) : Math.round(legendPos.y);

    if (!legendTransparent) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.strokeStyle = "rgba(15, 23, 42, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lX, lY, lW, lH, 12);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lX, lY, lW, lH, 12);
      ctx.stroke();
    }

    ctx.font = `${legendFontStyle} ${legendFontSize}px ${legendFontFamily}`;
    ctx.fillStyle = legendFontColor;
    ctx.textAlign = "left";
    ctx.fillText("% Exceedance Legend", lX + 12, lY + 20);

    const activeLegendClasses: {color: string, label: string}[] = [];
    activeLegendClasses.push({ color: nilColor, label: nilLabel });
    
    activeClasses.forEach((cls, idx) => {
      const prevLimit = idx === 0 ? 0 : activeClasses[idx - 1].limit;
      let rangeText = "";
      if (true) {
        rangeText = idx === 0 ? `>0% – ${cls.limit}%` : `>${prevLimit}% – ${cls.limit}%`;
      } else {
        rangeText = idx === 0 ? `≤ ${cls.limit}` : `>${prevLimit} – ${cls.limit}`;
      }
      activeLegendClasses.push({ color: cls.color, label: cls.label || rangeText });
    });

    activeLegendClasses.forEach((item, idx) => {
      const itemY = lY + 36 + idx * 13;
      if (itemY + 10 < lY + lH) {
        ctx.save();
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.roundRect(lX + 12, itemY - 8, 9, 9, 2.5);
        ctx.fill();
        ctx.restore();

        ctx.font = `${legendFontStyle} ${legendFontSize}px ${legendFontFamily}`;
        ctx.fillStyle = legendFontColor;
        ctx.fillText(item.label, lX + 27, itemY);
      }
    });
    ctx.restore();



    // Draw a premium classic cartographic border around the canvas
    if (showMapBorder) {
      ctx.save();
      // Outer thick border
      ctx.strokeStyle = fontColor === "#ffffff" ? "#f8fafc" : "#0f172a";
      ctx.lineWidth = 3;
      ctx.strokeRect(6, 6, width - 12, height - 12);
      
      // Inner thin border
      ctx.strokeStyle = fontColor === "#ffffff" ? "rgba(248, 250, 252, 0.3)" : "#475569";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(10, 10, width - 20, height - 20);
      
      // Corner markers
      if (layoutMode !== "default") {
        ctx.fillStyle = fontColor === "#ffffff" ? "#f8fafc" : "#0f172a";
        const size = 4;
        ctx.fillRect(6, 6, size, size);
        ctx.fillRect(width - 6 - size, 6, size, size);
        ctx.fillRect(6, height - 6 - size, size, size);
        ctx.fillRect(width - 6 - size, height - 6 - size, size, size);
      }
      ctx.restore();
    }
  };

  const renderMap = () => {
    let yearStr = "";
    if (rawData && rawData.length > 0 && headers.year) {
      const years = Array.from(new Set(rawData.map((d: any) => d[headers.year]).filter(Boolean)));
      if (years.length > 0) yearStr = `${years.join(", ")}`;
    }

    const fullName = PARAM_CONFIG[activeParam]?.name || activeParam;

    if (canvasRef.current) {
      const gList = sideBySide ? groupListPre : groupList;
      const baseTitle = sideBySide ? `Heat Map For ${fullName} (Pre)` : customMapTitle || `Heat Map For ${fullName}`;
      const title = baseTitle;

      const seasonText = sideBySide ? `Pre-Monsoon` : `${seasonFilter === "both" ? "All Seasons" : seasonFilter === "pre" ? "Pre-Monsoon" : "Post-Monsoon"}`;
      const subtitle = yearStr ? `${seasonText} ${yearStr}` : seasonText;

      drawMapOnCanvas(canvasRef.current, gList, title, subtitle);
    }
    if (sideBySide && canvasPostRef.current) {
      const baseTitle = `Heat Map For ${fullName} (Post)`;
      const title = baseTitle;

      const seasonText = `Post-Monsoon`;
      const subtitle = yearStr ? `${seasonText} ${yearStr}` : seasonText;

      drawMapOnCanvas(canvasPostRef.current, groupListPost, title, subtitle);
    }
  };

  useEffect(() => {
    renderMap();
  }, [
    groupList, 
    groupListPre,
    groupListPost,
    sideBySide,
    zoom, 
    panX, 
    panY, 
    hoveredGroup, 
    mapBounds, 
    customMapTitle, 
    layers, 
    activeClasses, 
    choroplethMode, 
    transparentBackground, 
    showCompass, 
    showScaleBar, 
    showGridLines,
    showRegionNames, 
    showStateNames,
    showDistrictNames,
    showBlockNames,
    showIndiaBoundary,
    layoutMode,
    showMapBorder,
    basemap,
    basemapOpacity,
    fontFamily,
    fontStyle,
    fontSizeTitle,
    fontSizeSubtitle,
    fontSizeLegend,
    fontColor,
    legendTransparent,
    northArrowPos,
    legendPos,
    titlePos,
    redrawTilesTrigger,
    nameOverrides,
    labelOffsets,
    stateFontFamily,
    stateFontSize,
    stateFontStyle,
    stateFontColor,
    showExceedanceSubLabel,
    subLabelFontFamily,
    subLabelFontSize,
    subLabelFontStyle,
    subLabelFontColor,
    subLabelFormat,
    titleFontFamily,
    titleFontSize,
    titleFontStyle,
    titleFontColor,
    subtitleFontFamily,
    subtitleFontSize,
    subtitleFontStyle,
    subtitleFontColor,
    legendFontFamily,
    legendFontSize,
    legendFontStyle,
    legendFontColor,
    nilColor,
    nilLabel,
    isVisible
  ]);

  // Drag to pan or move sub-elements handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    if (!canvas) return;

    clickStartPos.current = { x: e.clientX, y: e.clientY };

    const rect = canvas.getBoundingClientRect();
    const scaleX = (canvas.width / pixelRatio) / rect.width;
    const scaleY = (canvas.height / pixelRatio) / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // 0. Check if clicked near a Map Label (to drag and replace its location on the map area using mouse)
    for (const pos of renderedLabelPositionsRef.current.values()) {
      const dist = Math.hypot(x - pos.sx, y - pos.sy);
      if (dist <= 30) {
        setIsDraggingLabel(pos.name);
        const currentOff = labelOffsets[pos.name] || { dx: 0, dy: 0 };
        dragLabelOffsetStart.current = {
          x,
          y,
          initialDx: currentOff.dx,
          initialDy: currentOff.dy,
        };
        return;
      }
    }

    // 1. Check if clicked near North Arrow (Compass)
    const compassX = northArrowPos.x === 550 ? (canvas.width / pixelRatio) - 40 : northArrowPos.x;
    const compassY = northArrowPos.y === 40 ? 50 : northArrowPos.y;
    if (showCompass && Math.sqrt((x - compassX)**2 + (y - compassY)**2) < 25) {
      setIsDraggingNorthArrow(true);
      dragElementStartOffset.current = { x: x - compassX, y: y - compassY };
      return;
    }

    // 2. Check if clicked in Legend box (bounds: lX to lX+160, lY to lY+lH)
    const lH = Math.max(110, (activeClasses.length + 2) * 15 + 30);
    const lX = legendPos.x === 420 ? Math.round((canvas.width / pixelRatio) - 180) : legendPos.x;
    const lY = legendPos.y === 280 ? Math.round((canvas.height / pixelRatio) - lH - 20) : legendPos.y;
    if (x >= lX && x <= lX + 160 && y >= lY && y <= lY + lH) {
      setIsDraggingLegend(true);
      dragElementStartOffset.current = { x: x - lX, y: y - lY };
      return;
    }

    // 3. Check if clicked near Title
    const titleX = titlePos.x === 20 ? (canvas.width / pixelRatio) / 2 : titlePos.x;
    const titleY = titlePos.y === 30 ? 30 : titlePos.y;
    if (x >= titleX - 150 && x <= titleX + 150 && y >= titleY - 20 && y <= titleY + 35) {
      setIsDraggingTitle(true);
      dragElementStartOffset.current = { x: x - titleX, y: y - titleY };
      return;
    }

    // 4. Default to panning the map
    setIsDragging(true);
    setDragStart({ x: e.clientX * scaleX - panX, y: e.clientY * scaleY - panY });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    
    const scaleX = (canvas.width / pixelRatio) / rect.width;
    const scaleY = (canvas.height / pixelRatio) / rect.height;
    const x = cssX * scaleX;
    const y = cssY * scaleY;

    const width = canvas.width / pixelRatio;
    const height = canvas.height / pixelRatio;

    if (isDraggingLabel) {
      const deltaX = x - dragLabelOffsetStart.current.x;
      const deltaY = y - dragLabelOffsetStart.current.y;
      const newDx = Math.round(dragLabelOffsetStart.current.initialDx + deltaX);
      const newDy = Math.round(dragLabelOffsetStart.current.initialDy + deltaY);
      setLabelOffsets((prev) => ({
        ...prev,
        [isDraggingLabel]: { dx: newDx, dy: newDy },
      }));
    } else if (isDraggingNorthArrow) {
      setNorthArrowPos({
        x: Math.max(10, Math.min(width - 10, x - dragElementStartOffset.current.x)),
        y: Math.max(10, Math.min(height - 10, y - dragElementStartOffset.current.y))
      });
    } else if (isDraggingLegend) {
      const lH = Math.max(110, (activeClasses.length + 2) * 15 + 30);
      setLegendPos({
        x: Math.max(10, Math.min(width - 160, x - dragElementStartOffset.current.x)),
        y: Math.max(10, Math.min(height - lH, y - dragElementStartOffset.current.y))
      });
    } else if (isDraggingTitle) {
      setTitlePos({
        x: Math.max(5, Math.min(width - 50, x - dragElementStartOffset.current.x)),
        y: Math.max(15, Math.min(height - 15, y - dragElementStartOffset.current.y))
      });
    } else if (isDragging) {
      setPanX(e.clientX * scaleX - dragStart.x);
      setPanY(e.clientY * scaleY - dragStart.y);
    } else {
      // Check if mouse is near any map label to set move cursor
      let nearLabelName: string | null = null;
      for (const pos of renderedLabelPositionsRef.current.values()) {
        if (Math.hypot(x - pos.sx, y - pos.sy) <= 30) {
          nearLabelName = pos.name;
          break;
        }
      }
      setHoveredLabelName(nearLabelName);

      // Unproject screen coordinates to geographic coordinates
      const [mouseLon, mouseLat] = unproject(x, y, width, height);

      const activeLayers = (layers || []).filter((l) => l.visible && l.geoJson);
      let foundGroup: GroupData | null = null;

      // 1. Polygon hit-test: check if mouse is inside any GeoJSON shapefile feature
      if (activeLayers.length > 0 && Number.isFinite(mouseLon) && Number.isFinite(mouseLat)) {
        for (const layer of activeLayers) {
          const features = layer.geoJson.features || (layer.geoJson.type === "Feature" ? [layer.geoJson] : []);
          for (const f of features) {
            if (f && f.geometry && isPointInFeature(mouseLon, mouseLat, f)) {
              const matched = findGroupForFeature(f, groupList);
              if (matched) {
                foundGroup = matched;
                break;
              } else {
                const featName = String(
                  f.properties?.[layer.labelKey] ||
                  f.properties?.STNAME ||
                  f.properties?.DISTRICT ||
                  f.properties?.District ||
                  f.properties?.State_Name ||
                  f.properties?.STATE ||
                  f.properties?.NAME ||
                  ""
                ).trim();
                if (featName) {
                  foundGroup = {
                    name: featName,
                    centroidLon: mouseLon,
                    centroidLat: mouseLat,
                    totalSamples: 0,
                    failCount: 0,
                    pctExceedance: 0,
                    avgValue: 0,
                  };
                  break;
                }
              }
            }
          }
          if (foundGroup) break;
        }
      }

      // 2. Fallback distance check: search centroids with generous 250px radius to locate state/district everywhere
      if (!foundGroup && groupList.length > 0) {
        let minDist = Infinity;
        let nearest: GroupData | null = null;

        groupList.forEach((g) => {
          const [sx, sy] = project(g.centroidLon, g.centroidLat, width, height);
          const dx = x - sx;
          const dy = y - sy;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < minDist) {
            minDist = dist;
            nearest = g;
          }
        });

        if (nearest && minDist < 250) {
          foundGroup = nearest;
        }
      }

      setHoveredGroup(foundGroup);
      if (foundGroup) {
        setTooltipPos({ x: cssX + 15, y: cssY + 15 });
      }
    }
  };

  const handleCanvasClickEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = (canvas.width / pixelRatio) / rect.width;
    const scaleY = (canvas.height / pixelRatio) / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // 1. Skip if clicked on North arrow, legend or title dragging areas
    const compassX = northArrowPos.x === 550 ? (canvas.width / pixelRatio) - 40 : northArrowPos.x;
    const compassY = northArrowPos.y === 40 ? 50 : northArrowPos.y;
    if (showCompass && Math.sqrt((x - compassX)**2 + (y - compassY)**2) < 25) return;

    const lH = Math.max(110, (activeClasses.length + 2) * 15 + 30);
    const lX = legendPos.x === 420 ? Math.round((canvas.width / pixelRatio) - 180) : legendPos.x;
    const lY = legendPos.y === 280 ? Math.round((canvas.height / pixelRatio) - lH - 20) : legendPos.y;
    if (x >= lX && x <= lX + 160 && y >= lY && y <= lY + lH) return;

    const titleX = titlePos.x === 20 ? (canvas.width / pixelRatio) / 2 : titlePos.x;
    const titleY = titlePos.y === 30 ? 30 : titlePos.y;
    if (x >= titleX - 150 && x <= titleX + 150 && y >= titleY - 20 && y <= titleY + 35) return;

    // 2. Unproject screen click to geographic lon/lat
    const [lon, lat] = unproject(x, y, canvas.width, canvas.height);

    // 3. Find which feature was clicked
    const activeLayers = (layers || []).filter(l => l.visible && l.geoJson);
    let clickedFeature: any = null;
    let clickedLayer: any = null;

    for (const layer of activeLayers) {
      const features = layer.geoJson.features || (layer.geoJson.type === "Feature" ? [layer.geoJson] : []);
      for (const f of features) {
        if (f && f.geometry && isPointInFeature(lon, lat, f)) {
          clickedFeature = f;
          clickedLayer = layer;
          break;
        }
      }
      if (clickedFeature) break;
    }

    if (clickedFeature && clickedLayer) {
      const isPostCanvas = sideBySide && canvas === canvasPostRef.current;
      const gList = isPostCanvas ? groupListPost : (sideBySide ? groupListPre : groupList);
      const matchedG = findGroupForFeature(clickedFeature, gList);
      const featPropName = String(
        clickedFeature.properties?.[clickedLayer.labelKey] ||
        clickedFeature.properties?.STNAME ||
        clickedFeature.properties?.DISTRICT ||
        clickedFeature.properties?.District ||
        clickedFeature.properties?.State_Name ||
        clickedFeature.properties?.STATE ||
        clickedFeature.properties?.NAME ||
        ""
      ).trim();

      const originalName = matchedG ? matchedG.name : (featPropName || "");
      if (originalName) {
        setRenamingFeature({
          feature: clickedFeature,
          layer: clickedLayer,
          originalName,
          currentName: nameOverrides[originalName] || originalName,
        });
        setNewNameInput(nameOverrides[originalName] || originalName);
      }
    } else {
      // Fallback: Check if clicked near any of the centroids or hoveredGroup
      const isPostCanvas = sideBySide && canvas === canvasPostRef.current;
      const gList = isPostCanvas ? groupListPost : (sideBySide ? groupListPre : groupList);
      let closestG: GroupData | null = hoveredGroup;
      let minDistance = 120; // Expanded click tolerance in pixels for easy mouse replacement

      gList.forEach((g) => {
        const [sx, sy] = project(g.centroidLon, g.centroidLat, canvas.width, canvas.height);
        const dist = Math.sqrt((x - sx)**2 + (y - sy)**2);
        if (dist < minDistance) {
          minDistance = dist;
          closestG = g;
        }
      });

      if (closestG) {
        const originalName = (closestG as GroupData).name;
        setRenamingFeature({
          feature: null,
          layer: null,
          originalName,
          currentName: nameOverrides[originalName] || originalName,
        });
        setNewNameInput(nameOverrides[originalName] || originalName);
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingLabel) {
      triggerToast(`Location of label "${isDraggingLabel}" updated on map!`, "success");
      setIsDraggingLabel(null);
    }
    setIsDragging(false);
    setIsDraggingNorthArrow(false);
    setIsDraggingLegend(false);
    setIsDraggingTitle(false);

    // If it's a simple click (mouse didn't move significantly)
    const dx = e.clientX - clickStartPos.current.x;
    const dy = e.clientY - clickStartPos.current.y;
    const isClick = Math.sqrt(dx * dx + dy * dy) < 5;
    if (isClick) {
      handleCanvasClickEvent(e);
    }
  };

  // Zoom helpers - exact +/- 5% zoom in and zoom out facility on every click
  const handleZoomIn = () => setZoom((z) => Math.min(20, z * 1.05));
  const handleZoomOut = () => setZoom((z) => Math.max(0.1, z * 0.95));
  const handleReset = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setHoveredGroup(null);
  };

  // Pre-calculate class statistics for the classification table
  const tableData = useMemo(() => {
    let rows = [];
    
    // 1. Special 0% category (ONLY FOR EXCEEDANCE)
    if (true) {
      const zeroMatched = groupList.filter((g) => g.pctExceedance === 0);
      rows.push({
        slNo: 0,
        rangeText: "0%",
        label: "Nil Exceedance",
        color: "#38bdf8",
        count: zeroMatched.length,
        items: zeroMatched.map(m => ({
          name: m.name,
          pct: m.pctExceedance,
          fail: m.failCount,
          total: m.totalSamples,
        })),
      });
    }

    // 2. The standard customizable classes
    const classes = activeClasses;
    const standardRows = classes.map((cls, idx) => {
      const prevLimit = idx === 0 ? 0 : classes[idx - 1].limit;
      
      let rangeText = "";
      if (true) {
        rangeText = idx === 0 ? `>0% – ${cls.limit}%` : `>${prevLimit}% – ${cls.limit}%`;
      } else {
        rangeText = idx === 0 ? `≤ ${cls.limit}` : `>${prevLimit} – ${cls.limit}`;
      }
      
      // Match groups belonging to this range
      const matched = groupList.filter((g) => {
        const val = g.pctExceedance;
        
        if (true) {
          if (val === 0) return false; // Handled by zeroRow
          if (idx === 0) return val > 0 && val <= cls.limit;
        } else {
          // For average or count, 0 is a valid number inside standard classes
          if (idx === 0) return val <= cls.limit;
        }
        return val > prevLimit && val <= cls.limit;
      });

      return {
        slNo: idx + 1,
        rangeText,
        label: cls.label,
        color: cls.color,
        count: matched.length,
        items: matched.map(m => ({
          name: m.name,
          pct: m.pctExceedance,
          fail: m.failCount,
          total: m.totalSamples,
        })),
      };
    });

    return [...rows, ...standardRows];
  }, [groupList, activeClasses]);

  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `GIS_Choropleth_Map_${layoutMode}_${activeParam}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      triggerToast("Downloaded high-quality map successfully!", "success");
    } catch (err) {
      console.error(err);
      triggerToast("Failed to download image.", "error");
    }
  };

  const handlePrint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        // Pop-up blocked fallback
        downloadPng();
        triggerToast("Pop-up blocked! High-res map downloaded instead for direct printing.", "success");
        return;
      }
      printWindow.document.write(`
        <html>
          <head>
            <title>Print GIS Map - ${activeParam}</title>
            <style>
              body { margin: 0; display: flex; align-items: center; justify-content: center; background-color: #f8fafc; font-family: system-ui, sans-serif; }
              .container { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 20px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05); text-align: center; }
              img { max-width: 100%; max-height: 85vh; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 4px; }
              .btn { background-color: #4f46e5; color: white; padding: 10px 24px; border: none; border-radius: 8px; font-weight: bold; font-size: 14px; cursor: pointer; margin-bottom: 20px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2); }
              @media print {
                body { background: white; }
                .btn { display: none; }
                .container { border: none; box-shadow: none; padding: 0; margin: 0; }
                img { border: none; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <button class="btn" onclick="window.print()">Print This Map</button>
              <br/>
              <img src="${dataUrl}" />
              <div style="margin-top: 12px; font-size: 12px; color: #64748b; font-weight: 500;">
                GIS Exceedance Map Layout (${layoutMode}) - Generated on ${new Date().toLocaleDateString()}
              </div>
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
    } catch (err) {
      console.error(err);
      downloadPng();
      triggerToast("Error opening print window. Map downloaded instead.", "success");
    }
  };

  // Function to send Map Image to Bulletin Report
  const handleSendToBulletin = () => {
    const canvas = canvasRef.current;
    if (!canvas || !sendToBulletin) return;

    try {
      const dataUrl = canvas.toDataURL("image/png");
      sendToBulletin(`Spatial Exceedance Map (${seasonFilter === "both" ? "All Seasons" : seasonFilter === "pre" ? "Pre-Monsoon" : "Post-Monsoon"})`, dataUrl);
      triggerToast("GIS Exceedance Map sent to report successfully!", "success");
    } catch (err) {
      console.error(err);
      triggerToast("Failed to compile spatial map image.", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-md p-5 flex flex-col xl:flex-row gap-6 relative">
      {/* Local Toast Alert */}
      {localToast && (
        <div className={`absolute top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-xs font-bold text-white transition-all flex items-center gap-2 ${
          localToast.type === "success" ? "bg-emerald-500 shadow-emerald-100" : "bg-rose-500 shadow-rose-100"
        }`}>
          <span>{localToast.message}</span>
        </div>
      )}
      {/* Sidebar Controls Panel */}
      <div className="w-full xl:w-[320px] shrink-0 flex flex-col justify-between gap-4 border-r border-slate-100 xl:pr-5 max-h-[750px] overflow-y-auto">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-600" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">
              {customMapTitle || "GIS Choropleth Analysis"}
            </h4>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed font-medium">
            Professional GIS choropleth mapping tool. Renders and colors boundaries dynamically based on groundwater permissible limit exceedances.
          </p>

          {/* Season Selector */}
          <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/50">
            <label className="text-[9px] font-black uppercase text-indigo-950 tracking-wider block mb-1.5 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-indigo-500" />
              Season Filter
            </label>
            <div className="grid grid-cols-3 gap-1 bg-slate-200/50 p-0.5 rounded-lg">
              <button
                onClick={() => setSeasonFilter("pre")}
                className={`py-1 rounded-md text-[10px] font-bold transition-all ${
                  seasonFilter === "pre"
                    ? "bg-white text-indigo-600 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Pre-Mon
              </button>
              <button
                onClick={() => setSeasonFilter("post")}
                className={`py-1 rounded-md text-[10px] font-bold transition-all ${
                  seasonFilter === "post"
                    ? "bg-white text-indigo-600 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Post-Mon
              </button>
              <button
                onClick={() => setSeasonFilter("both")}
                className={`py-1 rounded-md text-[10px] font-bold transition-all ${
                  seasonFilter === "both"
                    ? "bg-white text-indigo-600 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Both
              </button>
            </div>
          </div>

          {/* Options */}
          <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/50 space-y-2">
            <span className="text-[9px] font-black uppercase text-indigo-950 tracking-wider block">
              Label & Name Settings
            </span>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-100/50 transition-all">
                <input
                  type="checkbox"
                  checked={showStateNames}
                  onChange={(e) => setShowStateNames(e.target.checked)}
                  className="text-indigo-600 focus:ring-indigo-500 rounded border-slate-300 w-3 h-3"
                />
                <span className="text-[10px] font-bold text-slate-800">Show State/UT Names</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-100/50 transition-all">
                <input
                  type="checkbox"
                  checked={showDistrictNames}
                  onChange={(e) => setShowDistrictNames(e.target.checked)}
                  className="text-indigo-600 focus:ring-indigo-500 rounded border-slate-300 w-3 h-3"
                />
                <span className="text-[10px] font-bold text-slate-800">Show District Names</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-100/50 transition-all">
                <input
                  type="checkbox"
                  checked={showBlockNames}
                  onChange={(e) => setShowBlockNames(e.target.checked)}
                  className="text-indigo-600 focus:ring-indigo-500 rounded border-slate-300 w-3 h-3"
                />
                <span className="text-[10px] font-bold text-slate-800">Show Block Names</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-100/50 transition-all border-t border-slate-200/50 pt-1.5 mt-0.5">
                <input
                  type="checkbox"
                  checked={useShortNames}
                  onChange={(e) => setUseShortNames(e.target.checked)}
                  className="text-indigo-600 focus:ring-indigo-500 rounded border-slate-300 w-3 h-3"
                />
                <span className="text-[10px] font-bold text-slate-800">Use Short Names (Abbreviate)</span>
              </label>
            </div>
          </div>



          {/* Choropleth Mode Selector */}
          <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/50 space-y-1.5">
            <label className="text-[9px] font-black uppercase text-indigo-950 tracking-wider block">
              Map Visualization Mode
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-2 cursor-pointer p-1.5 rounded-lg hover:bg-slate-100/50 transition-all">
                <input
                  type="radio"
                  name="choroplethMode"
                  checked={choroplethMode === "region"}
                  onChange={() => setChoroplethMode("region")}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-slate-800">Region-based (Shapefile)</span>
                  <span className="text-[9px] text-slate-400">Color individual shapefile polygons directly. Renders names and exceedance percentages in place.</span>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer p-1.5 rounded-lg hover:bg-slate-100/50 transition-all">
                <input
                  type="radio"
                  name="choroplethMode"
                  checked={choroplethMode === "voronoi"}
                  onChange={() => setChoroplethMode("voronoi")}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-slate-800">Continuous Heatmap Grid</span>
                  <span className="text-[9px] text-slate-400">Interpolate data point values across coordinates and clip the rendering to polygon bounds.</span>
                </div>
              </label>
            </div>
          </div>

          {/* Map Aesthetics / Layout Toggles */}
          <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/50 space-y-2">
            <label className="text-[9px] font-black uppercase text-indigo-950 tracking-wider block">
              Base Map & Layout Settings
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={transparentBackground}
                  onChange={(e) => setTransparentBackground(e.target.checked)}
                  className="rounded text-indigo-600 w-3.5 h-3.5"
                />
                <span className="text-[10px] font-bold text-slate-700">Transparent Bg</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGridLines}
                  onChange={(e) => setShowGridLines(e.target.checked)}
                  className="rounded text-indigo-600 w-3.5 h-3.5"
                />
                <span className="text-[10px] font-bold text-slate-700">Lat/Lon Grid</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCompass}
                  onChange={(e) => setShowCompass(e.target.checked)}
                  className="rounded text-indigo-600 w-3.5 h-3.5"
                />
                <span className="text-[10px] font-bold text-slate-700">Compass (North)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showScaleBar}
                  onChange={(e) => setShowScaleBar(e.target.checked)}
                  className="rounded text-indigo-600 w-3.5 h-3.5"
                />
                <span className="text-[10px] font-bold text-slate-700">Scale Bar (km)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMapBorder}
                  onChange={(e) => setShowMapBorder(e.target.checked)}
                  className="rounded text-indigo-600 w-3.5 h-3.5"
                />
                <span className="text-[10px] font-bold text-slate-700">Double Border Line</span>
              </label>
              <label className="col-span-2 flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showIndiaBoundary}
                  onChange={(e) => setShowIndiaBoundary(e.target.checked)}
                  className="rounded text-indigo-600 w-3.5 h-3.5"
                />
                <span className="text-[10px] font-bold text-slate-700">Draw India Fallback Border</span>
              </label>

              <div className="col-span-2 pt-2 border-t border-slate-200/40 space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={handleExportImage}
                    className="flex-1 text-[10px] font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1.5 rounded-lg transition-colors shadow-sm"
                  >
                    Export PNG
                  </button>
                </div>
              </div>

              <div className="col-span-2 pt-2 border-t border-slate-200/40 space-y-2">
                <div className="space-y-0.5">
                  <label className="text-[8px] font-bold text-slate-500 uppercase tracking-wider block">Base Map Style</label>
                  <select
                    value={basemap}
                    onChange={(e) => setBasemap(e.target.value)}
                    className="w-full text-[10px] font-bold p-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                  >
                    <option value="No Basemap">No Basemap (Solid Color)</option>
                    <option value="OpenStreetMap">OpenStreetMap</option>
                    <option value="ESRI Terrain">ESRI Terrain</option>
                    <option value="ESRI Topographic">ESRI Topographic</option>
                    <option value="ESRI Satellite">ESRI Satellite</option>
                    <option value="CartoDB Light">CartoDB Light (Minimalist)</option>
                    <option value="CartoDB Dark">CartoDB Dark (Night)</option>
                  </select>
                </div>
                {basemap !== "No Basemap" && (
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[8px] font-bold text-slate-500 uppercase tracking-wider">
                      <span>Basemap Opacity</span>
                      <span>{basemapOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={basemapOpacity}
                      onChange={(e) => setBasemapOpacity(parseInt(e.target.value))}
                      className="w-full accent-indigo-600 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* A4 Size & Portrait/Landscape Layout */}
          <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/50 space-y-2">
            <label className="text-[9px] font-black uppercase text-indigo-950 tracking-wider block">
              Layout & Sheet Sizing
            </label>
            <div className="grid grid-cols-3 gap-1 bg-slate-200/50 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => { setLayoutMode("default"); }}
                className={`py-1 rounded-md text-[10px] font-bold transition-all ${
                  layoutMode === "default"
                    ? "bg-white text-indigo-600 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Default
              </button>
              <button
                type="button"
                onClick={() => { setLayoutMode("a4-portrait"); }}
                className={`py-1 rounded-md text-[10px] font-bold transition-all ${
                  layoutMode === "a4-portrait"
                    ? "bg-white text-indigo-600 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                A4 Portrait
              </button>
              <button
                type="button"
                onClick={() => { setLayoutMode("a4-landscape"); }}
                className={`py-1 rounded-md text-[10px] font-bold transition-all ${
                  layoutMode === "a4-landscape"
                    ? "bg-white text-indigo-600 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                A4 Landscape
              </button>
            </div>
          </div>

          {/* Map Zoom & View Controls */}
          <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/50 space-y-2">
            <label className="text-[9px] font-black uppercase text-indigo-950 tracking-wider block">
              Map Zoom & View Controls
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={handleZoomIn}
                className="py-1 px-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-indigo-600 font-bold text-[9px] flex items-center justify-center gap-1 shadow-3xs transition-all"
                title="Zoom In (+5%)"
              >
                <Plus className="w-3 h-3" /> Zoom In
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                className="py-1 px-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-indigo-600 font-bold text-[9px] flex items-center justify-center gap-1 shadow-3xs transition-all"
                title="Zoom Out (-5%)"
              >
                <Minus className="w-3 h-3" /> Zoom Out
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="py-1 px-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-indigo-600 font-bold text-[9px] flex items-center justify-center gap-1 shadow-3xs transition-all"
                title="Reset View Zoom/Pan"
              >
                <RotateCcw className="w-3 h-3" /> Reset View
              </button>
            </div>
          </div>

          {/* Typography Settings Collapsible Panel */}
          <div className="bg-slate-50/50 rounded-xl border border-slate-200/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedTypography(!expandedTypography)}
              className="w-full p-2.5 flex items-center justify-between text-[10px] font-black uppercase text-indigo-950 tracking-wider hover:bg-slate-100/50 transition-colors"
            >
              <span>Map Typography Settings</span>
              <span className="text-xs">{expandedTypography ? "▼" : "▶"}</span>
            </button>

            {expandedTypography && (
              <div className="p-3 border-t border-slate-200/50 space-y-4 max-h-[300px] overflow-y-auto">
                {/* 1. State Name Labels */}
                <div className="space-y-1.5 pb-2.5 border-b border-slate-200/40">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-indigo-900 tracking-wider block">State / District Name Labels</span>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={showRegionNames} onChange={(e) => setShowRegionNames(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-2.5 h-2.5" />
                      <span className="text-[9px] font-bold text-slate-600">Show Labels</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Family</label>
                      <select
                        value={stateFontFamily}
                        onChange={(e) => setStateFontFamily(e.target.value)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      >
                        <option value="Inter">Inter</option>
                        <option value="Space Grotesk">Space Grotesk</option>
                        <option value="JetBrains Mono">JetBrains Mono</option>
                        <option value="Playfair Display">Playfair Display</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Arial">Arial</option>
                        <option value="sans-serif">Sans-Serif</option>
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500 block">Font Size (px)</label>
                      <input
                        type="number"
                        min="6"
                        max="28"
                        value={stateFontSize}
                        onChange={(e) => setStateFontSize(parseInt(e.target.value) || 10)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Style</label>
                      <select
                        value={stateFontStyle}
                        onChange={(e) => setStateFontStyle(e.target.value)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      >
                        <option value="normal">Normal</option>
                        <option value="bold">Bold</option>
                        <option value="italic">Italic</option>
                        <option value="bold italic">Bold Italic</option>
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Color</label>
                      <div className="flex gap-1">
                        <input
                          type="color"
                          value={stateFontColor}
                          onChange={(e) => setStateFontColor(e.target.value)}
                          className="w-5 h-5 p-0 border-0 cursor-pointer bg-transparent rounded shrink-0"
                        />
                        <input
                          type="text"
                          value={stateFontColor}
                          onChange={(e) => setStateFontColor(e.target.value)}
                          className="w-full text-[8px] font-mono p-0.5 bg-white border border-slate-200 rounded uppercase font-bold"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 1b. Sub-label (% of samples above permissible limit) */}
                <div className="space-y-1.5 pb-2.5 border-b border-slate-200/40 bg-indigo-50/40 p-2 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-indigo-900 tracking-wider block">Sub-Label (% Above Limit)</span>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={showExceedanceSubLabel} onChange={(e) => setShowExceedanceSubLabel(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-2.5 h-2.5" />
                      <span className="text-[9px] font-bold text-indigo-700">Show Sub-Label</span>
                    </label>
                  </div>
                  {showExceedanceSubLabel && (
                    <div className="space-y-2 pt-1">
                      <div className="space-y-0.5">
                        <label className="text-[8px] font-bold text-slate-500">Label Format</label>
                        <select
                          value={subLabelFormat}
                          onChange={(e) => setSubLabelFormat(e.target.value)}
                          className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                        >
                          <option value="percent">(X%) - Percentage Only (Default)</option>
                          <option value="full">(% of samples above permissible limit)</option>
                          <option value="exceedance">(% Exceedance)</option>
                          <option value="short_limit">(% samples &gt; limit)</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <label className="text-[8px] font-bold text-slate-500">Font Family</label>
                          <select
                            value={subLabelFontFamily}
                            onChange={(e) => setSubLabelFontFamily(e.target.value)}
                            className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                          >
                            <option value="Inter">Inter</option>
                            <option value="Space Grotesk">Space Grotesk</option>
                            <option value="JetBrains Mono">JetBrains Mono</option>
                            <option value="Playfair Display">Playfair Display</option>
                            <option value="Georgia">Georgia</option>
                            <option value="Arial">Arial</option>
                            <option value="sans-serif">Sans-Serif</option>
                          </select>
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[8px] font-bold text-slate-500">Font Size (px)</label>
                          <input
                            type="number"
                            min="6"
                            max="22"
                            value={subLabelFontSize}
                            onChange={(e) => setSubLabelFontSize(parseInt(e.target.value) || 8)}
                            className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[8px] font-bold text-slate-500">Font Style</label>
                          <select
                            value={subLabelFontStyle}
                            onChange={(e) => setSubLabelFontStyle(e.target.value)}
                            className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                          >
                            <option value="normal">Normal</option>
                            <option value="bold">Bold</option>
                            <option value="italic">Italic</option>
                            <option value="bold italic">Bold Italic</option>
                          </select>
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[8px] font-bold text-slate-500">Font Color</label>
                          <div className="flex gap-1">
                            <input
                              type="color"
                              value={subLabelFontColor}
                              onChange={(e) => setSubLabelFontColor(e.target.value)}
                              className="w-5 h-5 p-0 border-0 cursor-pointer bg-transparent rounded shrink-0"
                            />
                            <input
                              type="text"
                              value={subLabelFontColor}
                              onChange={(e) => setSubLabelFontColor(e.target.value)}
                              className="w-full text-[8px] font-mono p-0.5 bg-white border border-slate-200 rounded uppercase font-bold"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Map Title */}
                <div className="space-y-1.5 pb-2.5 border-b border-slate-200/40">
                  <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider block">Map Title</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Family</label>
                      <select
                        value={titleFontFamily}
                        onChange={(e) => setTitleFontFamily(e.target.value)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      >
                        <option value="Inter">Inter</option>
                        <option value="Space Grotesk">Space Grotesk</option>
                        <option value="JetBrains Mono">JetBrains Mono</option>
                        <option value="Playfair Display">Playfair Display</option>
                        <option value="Georgia">Georgia</option>
                        <option value="sans-serif">Sans-Serif</option>
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Size</label>
                      <input
                        type="number"
                        min="8"
                        max="36"
                        value={titleFontSize}
                        onChange={(e) => setTitleFontSize(parseInt(e.target.value) || 14)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Style</label>
                      <select
                        value={titleFontStyle}
                        onChange={(e) => setTitleFontStyle(e.target.value)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      >
                        <option value="normal">Normal</option>
                        <option value="bold">Bold</option>
                        <option value="italic">Italic</option>
                        <option value="bold italic">Bold Italic</option>
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Color</label>
                      <div className="flex gap-1">
                        <input
                          type="color"
                          value={titleFontColor}
                          onChange={(e) => setTitleFontColor(e.target.value)}
                          className="w-5 h-5 p-0 border-0 cursor-pointer bg-transparent rounded shrink-0"
                        />
                        <input
                          type="text"
                          value={titleFontColor}
                          onChange={(e) => setTitleFontColor(e.target.value)}
                          className="w-full text-[8px] font-mono p-0.5 bg-white border border-slate-200 rounded uppercase font-bold"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Map Subtitle */}
                <div className="space-y-1.5 pb-2.5 border-b border-slate-200/40">
                  <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider block">Map Subtitle</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Family</label>
                      <select
                        value={subtitleFontFamily}
                        onChange={(e) => setSubtitleFontFamily(e.target.value)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      >
                        <option value="Inter">Inter</option>
                        <option value="Space Grotesk">Space Grotesk</option>
                        <option value="JetBrains Mono">JetBrains Mono</option>
                        <option value="Playfair Display">Playfair Display</option>
                        <option value="Georgia">Georgia</option>
                        <option value="sans-serif">Sans-Serif</option>
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Size</label>
                      <input
                        type="number"
                        min="6"
                        max="24"
                        value={subtitleFontSize}
                        onChange={(e) => setSubtitleFontSize(parseInt(e.target.value) || 9)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Style</label>
                      <select
                        value={subtitleFontStyle}
                        onChange={(e) => setSubtitleFontStyle(e.target.value)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      >
                        <option value="normal">Normal</option>
                        <option value="bold">Bold</option>
                        <option value="italic">Italic</option>
                        <option value="bold italic">Bold Italic</option>
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Color</label>
                      <div className="flex gap-1">
                        <input
                          type="color"
                          value={subtitleFontColor}
                          onChange={(e) => setSubtitleFontColor(e.target.value)}
                          className="w-5 h-5 p-0 border-0 cursor-pointer bg-transparent rounded shrink-0"
                        />
                        <input
                          type="text"
                          value={subtitleFontColor}
                          onChange={(e) => setSubtitleFontColor(e.target.value)}
                          className="w-full text-[8px] font-mono p-0.5 bg-white border border-slate-200 rounded uppercase font-bold"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Legend Text */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider block">Legend Text</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Family</label>
                      <select
                        value={legendFontFamily}
                        onChange={(e) => setLegendFontFamily(e.target.value)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      >
                        <option value="Inter">Inter</option>
                        <option value="Space Grotesk">Space Grotesk</option>
                        <option value="JetBrains Mono">JetBrains Mono</option>
                        <option value="Playfair Display">Playfair Display</option>
                        <option value="Georgia">Georgia</option>
                        <option value="sans-serif">Sans-Serif</option>
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Size</label>
                      <input
                        type="number"
                        min="6"
                        max="24"
                        value={legendFontSize}
                        onChange={(e) => setLegendFontSize(parseInt(e.target.value) || 9)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Style</label>
                      <select
                        value={legendFontStyle}
                        onChange={(e) => setLegendFontStyle(e.target.value)}
                        className="w-full text-[9px] font-bold p-1 bg-white border border-slate-200 rounded"
                      >
                        <option value="normal">Normal</option>
                        <option value="bold">Bold</option>
                        <option value="italic">Italic</option>
                        <option value="bold italic">Bold Italic</option>
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[8px] font-bold text-slate-500">Font Color</label>
                      <div className="flex gap-1">
                        <input
                          type="color"
                          value={legendFontColor}
                          onChange={(e) => setLegendFontColor(e.target.value)}
                          className="w-5 h-5 p-0 border-0 cursor-pointer bg-transparent rounded shrink-0"
                        />
                        <input
                          type="text"
                          value={legendFontColor}
                          onChange={(e) => setLegendFontColor(e.target.value)}
                          className="w-full text-[8px] font-mono p-0.5 bg-white border border-slate-200 rounded uppercase font-bold"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Statistics Side Table Settings */}
          <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/50 space-y-2">
            <label className="text-[9px] font-black uppercase text-indigo-950 tracking-wider block">
              Side-By-Side Statistics Table
            </label>
            <div className="space-y-2 text-[10px] font-bold text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTableOverlay}
                  onChange={(e) => setShowTableOverlay(e.target.checked)}
                  className="rounded text-indigo-600 w-3.5 h-3.5"
                />
                <span>Show Stats Table next to map</span>
              </label>
              <p className="text-[8.5px] text-slate-400 font-medium leading-relaxed">
                Renders a detailed tabular breakdown of exceedance classification bounds and regional totals directly to the side of the map container.
              </p>
            </div>
          </div>

          {/* Dynamic Class & Legend Customizer */}
          <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-200/50 space-y-2.5">
            <span className="text-[9px] font-black uppercase text-indigo-950 tracking-wider block">
              Classification & Ranges
            </span>

            {/* Class Count Selector */}
            <div className="space-y-1">
              <span className="text-[9px] font-bold text-slate-500">Number of Classes (up to 5):</span>
              <div className="grid grid-cols-4 gap-1">
                {[2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleClassCountChange(num)}
                    className={`py-0.5 rounded text-[10px] font-extrabold border transition-all ${
                      activeClasses.length === num
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {num} Cls
                  </button>
                ))}
              </div>
            </div>

            {/* Range Presets */}
            <div className="space-y-1 border-t border-slate-200/50 pt-2">
              <span className="text-[9px] font-bold text-slate-500">Quick Range Presets:</span>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => applyPreset("0-5")}
                  className="py-1 px-1 rounded text-[8px] font-black bg-white hover:bg-slate-50 text-indigo-700 border border-slate-200 shadow-3xs"
                  title="5% intervals: 0-5, 5-10, 10-15, 15-20, >20%"
                >
                  0–5% Step
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("dense")}
                  className="py-1 px-1 rounded text-[8px] font-black bg-white hover:bg-slate-50 text-indigo-700 border border-slate-200 shadow-3xs"
                  title="Dense low ranges: 0-2, 2-4, 4-6, 6-8, >8%"
                >
                  2–4–6% step
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("standard")}
                  className="py-1 px-1 rounded text-[8px] font-black bg-white hover:bg-slate-50 text-indigo-700 border border-slate-200 shadow-3xs"
                  title="Standard bounds: 0-10, 10-25, 25-50, 50-75, >75%"
                >
                  Standard
                </button>
              </div>
            </div>

            {/* Editable Classes list */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 border-t border-slate-200/50 pt-2">
              <span className="text-[9px] font-bold text-slate-500 block mb-1">Modify Bounds & Palette:</span>
              
              {/* Nil Exceedance Row */}
              <div className="flex items-center gap-1.5 p-1 bg-white rounded-lg border border-slate-200/60 shadow-3xs">
                <input
                  type="text"
                  value={nilLabel}
                  title="Nil Exceedance Label"
                  onChange={(e) => setNilLabel(e.target.value)}
                  className="flex-1 min-w-[70px] text-[9px] px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded font-bold"
                  placeholder="Nil Exceedance"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[9px] font-bold text-slate-400">0% Only</span>
                </div>
                <input
                  type="color"
                  value={nilColor}
                  onChange={(e) => setNilColor(e.target.value)}
                  className="w-5 h-5 p-0 cursor-pointer border-0 rounded bg-transparent ml-auto shrink-0"
                />
              </div>

              {activeClasses.map((cls, idx) => {
                const prevLimit = idx === 0 ? 0 : activeClasses[idx - 1].limit;
                return (
                  <div key={idx} className="flex items-center gap-1.5 p-1 bg-white rounded-lg border border-slate-200/60 shadow-3xs">
                    {/* Class Label Input */}
                    <input
                      type="text"
                      value={cls.label}
                      title="Class Label"
                      onChange={(e) => {
                        const updated = [...activeClasses];
                        updated[idx] = { ...updated[idx], label: e.target.value };
                        updateClasses(updated);
                      }}
                      className="flex-1 min-w-[70px] text-[9px] px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded font-bold"
                    />

                    {/* Class limit input */}
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[9px] font-bold text-slate-400">
                        {idx === 0 ? "≤" : ">"}
                      </span>
                      <input
                        type="number"
                        min={prevLimit + 1}
                        max="100"
                        value={cls.limit}
                        onChange={(e) => {
                          const updated = [...activeClasses];
                          updated[idx] = { ...updated[idx], limit: Math.max(prevLimit + 1, Math.min(100, parseInt(e.target.value) || 0)) };
                          updateClasses(updated);
                        }}
                        disabled={idx === activeClasses.length - 1}
                        className="w-8 text-[9px] p-0.5 border border-slate-200 rounded text-center font-bold"
                      />
                      <span className="text-[9px] font-bold text-slate-400">%</span>
                    </div>

                    {/* Color picker */}
                    <input
                      type="color"
                      value={cls.color}
                      onChange={(e) => {
                        const updated = [...activeClasses];
                        updated[idx] = { ...updated[idx], color: e.target.value };
                        updateClasses(updated);
                      }}
                      className="w-5 h-5 p-0 cursor-pointer border-0 rounded bg-transparent ml-auto shrink-0"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* GIS Metadata / Controls */}
        <div className="space-y-2.5 pt-2">
          <div className="text-[9px] text-slate-400 leading-relaxed bg-indigo-50/50 p-2 border border-indigo-100 rounded-xl flex gap-1">
            <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>
              <strong>GIS Tip:</strong> Scroll to Zoom, Drag to Pan. Hover on centers to view statistics in real-time.
            </span>
          </div>

          {sendToBulletin && (
            <button
              onClick={handleSendToBulletin}
              className="w-full py-2 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-bold text-xs hover:from-indigo-700 hover:to-indigo-800 transition-all flex items-center justify-center gap-2 shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
              Export Map to Report
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={downloadPng}
              className="py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[11px] transition-all flex items-center justify-center gap-1.5 border border-slate-200/80 shadow-xs"
            >
              Download PNG
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[11px] transition-all flex items-center justify-center gap-1.5 border border-slate-200/80 shadow-xs"
            >
              Print Map (A4 Ready)
            </button>
          </div>
        </div>
      </div>

      {/* Map and Side-Table Container Wrapper */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 items-start min-w-0">

        {/* Main Map Interactive Viewport */}
        <div className={`flex flex-col sm:flex-row gap-4 ${currentLayout.style} relative flex-1 min-w-0 border border-slate-100 rounded-2xl bg-slate-50/30 overflow-hidden select-none`}>
          <div className="flex-1 relative min-w-0 h-full flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={currentLayout.width * pixelRatio}
              height={currentLayout.height * pixelRatio}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onDoubleClick={(e) => handleCanvasClickEvent(e)}
              onContextMenu={(e) => {
                e.preventDefault();
                handleCanvasClickEvent(e);
              }}
              className={`block bg-transparent pointer-events-auto mx-auto ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
              style={{
                width: `${currentLayout.width}px`,
                height: `${currentLayout.height}px`,
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain"
              }}
            />
          </div>
          {sideBySide && (
            <div className="flex-1 relative min-w-0 h-full border-l border-slate-200/50 flex items-center justify-center">
              <canvas
                ref={canvasPostRef}
                width={currentLayout.width * pixelRatio}
                height={currentLayout.height * pixelRatio}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onDoubleClick={(e) => handleCanvasClickEvent(e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  handleCanvasClickEvent(e);
                }}
                className={`block bg-transparent pointer-events-auto mx-auto ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
                style={{
                  width: `${currentLayout.width}px`,
                  height: `${currentLayout.height}px`,
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain"
                }}
              />
            </div>
          )}

          {/* Hover Information Tooltip */}
          {hoveredGroup && (
            <div
              className="absolute z-20 pointer-events-auto bg-white/95 backdrop-blur border border-indigo-100 p-3 rounded-2xl shadow-xl max-w-xs transition-all duration-75 text-xs text-slate-700 font-medium select-none"
              style={{ left: tooltipPos.x, top: tooltipPos.y }}
            >
              <div className="border-b border-slate-100 pb-1.5 mb-2 flex items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wider block">
                    {reportingLevel} Center
                  </span>
                  <strong className="text-slate-800 text-sm font-extrabold">{nameOverrides[hoveredGroup.name] || hoveredGroup.name}</strong>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingFeature({
                      feature: null,
                      layer: null,
                      originalName: hoveredGroup.name,
                      currentName: nameOverrides[hoveredGroup.name] || hoveredGroup.name,
                    });
                    setNewNameInput(nameOverrides[hoveredGroup.name] || hoveredGroup.name);
                  }}
                  className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-all border border-indigo-200/60 shadow-2xs cursor-pointer shrink-0"
                  title={`Click to Replace Name of ${nameOverrides[hoveredGroup.name] || hoveredGroup.name}`}
                >
                  <Edit2 className="w-3.5 h-3.5 text-indigo-600" />
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center gap-6">
                  <span className="text-slate-500">{"Exceedance Percentage:"}</span>
                  <span
                    className="font-extrabold px-1.5 py-0.5 rounded text-[11px]"
                    style={{
                      backgroundColor: getColorForExceedance(hoveredGroup.pctExceedance) + "15",
                      color: getColorForExceedance(hoveredGroup.pctExceedance),
                    }}
                  >
                    {hoveredGroup.pctExceedance.toFixed(2) + "%"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Total Samples:</span>
                  <span className="font-bold text-slate-800">{hoveredGroup.totalSamples}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Exceeded Samples:</span>
                  <span className="font-bold text-rose-600">{hoveredGroup.failCount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Average Value:</span>
                  <span className="font-extrabold text-slate-800">
                    {hoveredGroup.avgValue.toFixed(2)}{" "}
                    <span className="text-[10px] text-slate-400 font-medium font-mono">
                      {activeConfig.unit}
                    </span>
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingFeature({
                    feature: null,
                    layer: null,
                    originalName: hoveredGroup.name,
                    currentName: nameOverrides[hoveredGroup.name] || hoveredGroup.name,
                  });
                  setNewNameInput(nameOverrides[hoveredGroup.name] || hoveredGroup.name);
                }}
                className="w-full mt-2.5 py-1.5 px-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-extrabold rounded-xl flex items-center justify-center gap-1.5 text-[11px] transition-all shadow-xs cursor-pointer"
              >
                <Move className="w-3 h-3 text-indigo-200" />
                Move / Reposition Label Location on Map
              </button>
            </div>
          )}
        </div>

        {/* Statistical Table Panel Side-by-Side (not absolute, just static/relative side-by-side) */}
        {showTableOverlay && (
          <div className="w-full lg:w-[420px] shrink-0 bg-white border border-slate-200/80 rounded-2xl flex flex-col shadow-xs overflow-hidden max-h-[600px] select-text">
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 bg-slate-50/60 select-none">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-indigo-950">
                <Table className="w-3.5 h-3.5 text-indigo-600" />
                <span>Classification Table</span>
              </div>
              <button
                type="button"
                onClick={() => setShowTableOverlay(false)}
                title="Hide Table"
                className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors text-[10px] font-black"
              >
                ✕
              </button>
            </div>

            {/* Table Content (Scrollable) */}
            <div className="p-2 sm:p-4 overflow-y-auto overflow-x-auto custom-scrollbar flex-1 bg-white">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider font-semibold text-slate-400 border-b border-slate-100 pb-2">
                    <th className="pb-2 px-1 w-10">Sl. No.</th>
                    <th className="pb-2 px-1 w-16">Ranges</th>
                    <th className="pb-2 px-1 w-20">Colour</th>
                    <th className="pb-2 px-1 text-center w-16">No. {reportingLevel === "State" ? "State/UT" : "Districts"}</th>
                    <th className="pb-2 px-1">Name(s) of {reportingLevel === "State" ? "State/UT" : "Districts"}</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {tableData.map((row, i) => (
                    <tr key={row.slNo} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 px-1 font-mono font-medium text-slate-900 text-center">
                        {i + 1}
                      </td>
                      <td className="py-2 px-1 font-mono font-medium text-slate-900 whitespace-nowrap">
                        {row.rangeText}
                      </td>
                      <td className="py-2 px-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: row.color }}
                          />
                          <span className="text-[10px] truncate max-w-[110px]" title={row.label}>
                            {row.label}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-1 text-center">
                        <span className="font-semibold text-[10px] text-slate-900">
                          {row.count}
                        </span>
                      </td>
                      <td className="py-2 px-1">
                        {row.items.length > 0 ? (
                          <div className="text-[10px] text-slate-500 font-medium leading-relaxed max-h-[80px] overflow-y-auto pr-1">
                            {row.items.map(i => {
                               let n = nameOverrides[i.name] || i.name;
                               if (useShortNames) n = getShortName(n, reportingLevel, useShortNames);
                               return n;
                            }).join(", ")}
                          </div>
                        ) : (
                          <span className="text-slate-300 italic text-[10px]">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {renamingFeature && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newNameInput.trim() && newNameInput.trim() !== renamingFeature.originalName) {
                setNameOverrides((prev) => ({
                  ...prev,
                  [renamingFeature.originalName]: newNameInput.trim(),
                }));
              }
              triggerToast(`Label settings for ${renamingFeature.originalName} saved!`, "success");
              setRenamingFeature(null);
            }}
            className="bg-white/95 backdrop-blur border border-indigo-100 rounded-3xl p-6 shadow-2xl max-w-md w-full space-y-4 select-none"
          >
            <div className="space-y-1 border-b border-slate-100 pb-3">
              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5 text-indigo-500" />
                REPOSITION MAP LABEL LOCATION
              </span>
              <h3 className="text-base font-black text-slate-800 leading-tight">
                Move Label Position on Map
              </h3>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                You can click and drag any label directly on the map area using your mouse, or use the nudge controls below.
              </p>
            </div>

            <div className="space-y-3">
              {/* Region Selector Dropdown */}
              {groupList.length > 0 && (
                <div className="space-y-1 text-xs">
                  <label className="font-bold text-slate-600 block">Select Region on Map</label>
                  <select
                    value={renamingFeature.originalName}
                    onChange={(e) => {
                      const selName = e.target.value;
                      setRenamingFeature({
                        feature: null,
                        layer: null,
                        originalName: selName,
                        currentName: nameOverrides[selName] || selName,
                      });
                      setNewNameInput(nameOverrides[selName] || selName);
                    }}
                    className="w-full text-xs font-bold p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-800 cursor-pointer"
                  >
                    {groupList.map((g) => (
                      <option key={g.name} value={g.name}>
                        {g.name} {labelOffsets[g.name] ? `(Moved: dx=${labelOffsets[g.name].dx}, dy=${labelOffsets[g.name].dy})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Mouse Drag Banner Tip */}
              <div className="bg-indigo-50/80 border border-indigo-100/80 p-2.5 rounded-xl text-[11px] text-indigo-900 font-semibold flex items-center gap-2">
                <Move className="w-4 h-4 text-indigo-600 shrink-0" />
                <span><strong>Direct Mouse Control:</strong> Simply click and drag the label text on the map area with your mouse!</span>
              </div>

              {/* D-Pad Nudge Buttons */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600 block">Directional Nudge Position</label>
                <div className="flex items-center justify-center gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
                  <div className="grid grid-cols-3 gap-1.5 w-36">
                    <div />
                    <button
                      type="button"
                      onClick={() => {
                        const cur = labelOffsets[renamingFeature.originalName] || { dx: 0, dy: 0 };
                        setLabelOffsets((prev) => ({ ...prev, [renamingFeature.originalName]: { ...cur, dy: cur.dy - 10 } }));
                      }}
                      className="p-2 bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 rounded-lg flex items-center justify-center transition-all cursor-pointer shadow-2xs active:scale-95"
                      title="Nudge Up 10px"
                    >
                      <ArrowUp className="w-3.5 h-3.5 text-indigo-600" />
                    </button>
                    <div />

                    <button
                      type="button"
                      onClick={() => {
                        const cur = labelOffsets[renamingFeature.originalName] || { dx: 0, dy: 0 };
                        setLabelOffsets((prev) => ({ ...prev, [renamingFeature.originalName]: { ...cur, dx: cur.dx - 10 } }));
                      }}
                      className="p-2 bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 rounded-lg flex items-center justify-center transition-all cursor-pointer shadow-2xs active:scale-95"
                      title="Nudge Left 10px"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 text-indigo-600" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLabelOffsets((prev) => {
                          const copy = { ...prev };
                          delete copy[renamingFeature.originalName];
                          return copy;
                        });
                        triggerToast(`Reset label position for ${renamingFeature.originalName}`, "info");
                      }}
                      className="p-2 bg-slate-200 hover:bg-rose-100 border border-slate-300 text-slate-700 hover:text-rose-700 rounded-lg flex items-center justify-center transition-all cursor-pointer text-[9px] font-black uppercase"
                      title="Reset Position"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const cur = labelOffsets[renamingFeature.originalName] || { dx: 0, dy: 0 };
                        setLabelOffsets((prev) => ({ ...prev, [renamingFeature.originalName]: { ...cur, dx: cur.dx + 10 } }));
                      }}
                      className="p-2 bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 rounded-lg flex items-center justify-center transition-all cursor-pointer shadow-2xs active:scale-95"
                      title="Nudge Right 10px"
                    >
                      <ArrowRight className="w-3.5 h-3.5 text-indigo-600" />
                    </button>

                    <div />
                    <button
                      type="button"
                      onClick={() => {
                        const cur = labelOffsets[renamingFeature.originalName] || { dx: 0, dy: 0 };
                        setLabelOffsets((prev) => ({ ...prev, [renamingFeature.originalName]: { ...cur, dy: cur.dy + 10 } }));
                      }}
                      className="p-2 bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 rounded-lg flex items-center justify-center transition-all cursor-pointer shadow-2xs active:scale-95"
                      title="Nudge Down 10px"
                    >
                      <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
                    </button>
                    <div />
                  </div>
                </div>
              </div>

              {/* X and Y Sliders */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <label className="font-bold text-slate-600">Horizontal Shift (X)</label>
                    <span className="font-mono text-indigo-600 font-extrabold">
                      {(labelOffsets[renamingFeature.originalName]?.dx || 0)}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-200"
                    max="200"
                    value={labelOffsets[renamingFeature.originalName]?.dx || 0}
                    onChange={(e) => {
                      const dx = parseInt(e.target.value) || 0;
                      const cur = labelOffsets[renamingFeature.originalName] || { dx: 0, dy: 0 };
                      setLabelOffsets((prev) => ({ ...prev, [renamingFeature.originalName]: { ...cur, dx } }));
                    }}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between">
                    <label className="font-bold text-slate-600">Vertical Shift (Y)</label>
                    <span className="font-mono text-indigo-600 font-extrabold">
                      {(labelOffsets[renamingFeature.originalName]?.dy || 0)}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-200"
                    max="200"
                    value={labelOffsets[renamingFeature.originalName]?.dy || 0}
                    onChange={(e) => {
                      const dy = parseInt(e.target.value) || 0;
                      const cur = labelOffsets[renamingFeature.originalName] || { dx: 0, dy: 0 };
                      setLabelOffsets((prev) => ({ ...prev, [renamingFeature.originalName]: { ...cur, dy } }));
                    }}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Optional Text Rename Input */}
              <div className="space-y-1 text-xs pt-1 border-t border-slate-100">
                <label className="font-bold text-slate-500 block">Edit Display Text (Optional)</label>
                <input
                  type="text"
                  value={newNameInput}
                  onChange={(e) => setNewNameInput(e.target.value)}
                  placeholder={renamingFeature.originalName}
                  className="w-full text-xs font-semibold p-2.5 bg-white border border-slate-200 focus:border-indigo-500 rounded-xl focus:outline-none transition-all text-slate-800"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 text-xs font-bold">
              <button
                type="submit"
                className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100 transition-all cursor-pointer"
              >
                Done
              </button>
              {labelOffsets[renamingFeature.originalName] && (
                <button
                  type="button"
                  onClick={() => {
                    setLabelOffsets((prev) => {
                      const updated = { ...prev };
                      delete updated[renamingFeature.originalName];
                      return updated;
                    });
                    triggerToast(`Label position reset for ${renamingFeature.originalName}`, "info");
                  }}
                  className="py-2.5 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 transition-all cursor-pointer"
                >
                  Reset Location
                </button>
              )}
              <button
                type="button"
                onClick={() => setRenamingFeature(null)}
                className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all cursor-pointer"
              >
                Close
              </button>
            </div>

            {Object.keys(labelOffsets).length > 0 && (
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400">
                  {Object.keys(labelOffsets).length} label position override(s) active
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLabelOffsets({});
                    triggerToast("All label positions reset to default.", "info");
                  }}
                  className="text-[10px] font-bold text-rose-600 hover:text-rose-700 hover:underline cursor-pointer"
                >
                  Reset All Label Positions
                </button>
              </div>
            )}
          </form>
        </div>
      )}

    </div>
  </div>
);
}

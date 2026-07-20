import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import shp from "shpjs";
import { DataHeaders, ShapefileLayer } from "./types";
import { PARAM_CONFIG } from "./data/config";
import { getStats } from "./utils/math";
import MappingModal from "./components/MappingModal";
import DetailedView from "./components/DetailedView";
import ComparisonsView from "./components/ComparisonsView";
import PamphletView from "./components/PamphletView";
import BulletinView from "./components/BulletinView";
import MasterSummaryView from "./components/MasterSummaryView";
import UsslPiperAnalysisView from "./components/UsslPiperAnalysisView";
import RankingStatsView from "./components/RankingStatsView";
import MonsoonImpactView from "./components/MonsoonImpactView";
import GisMapView from "./components/GisMapView";
import HydrochemistryView from "./components/HydrochemistryView";
import { CombinationAnalysisView } from "./components/CombinationAnalysisView";
import PcaAnalysisView from "./components/PcaAnalysisView";
import FortnightlyAlertsView from "./components/FortnightlyAlertsView";
import LimitsManagerView from "./components/LimitsManagerView";
import AdvancedAnalysisView from "./components/AdvancedAnalysisView";
import CalculatoriusView from "./components/CalculatoriusView";
import GisChoroplethMap from "./components/GisChoroplethMap";
import { generateOfflineChartBase64 } from "./utils/chartHelpers";

import {
  Database,
  UploadCloud,
  Download,
  Info,
  AlertTriangle,
  Table2,
  TableProperties,
  LayoutDashboard,
  BarChart3,
  LayoutTemplate,
  FileText,
  CheckCircle,
  Activity,
  X,
  AlertCircle,
  Compass,
  TrendingUp,
  Globe,
  Layers,
  Cpu,
  Settings,
  Clock,
  Calendar,
  Map,
  Calculator
} from "lucide-react";

import Highcharts from "highcharts";
// @ts-ignore
import Highcharts3D from "highcharts/highcharts-3d";
// @ts-ignore
import Cylinder from "highcharts/modules/cylinder";
// @ts-ignore
import Exporting from "highcharts/modules/exporting";
// @ts-ignore
import OfflineExporting from "highcharts/modules/offline-exporting";
// @ts-ignore
import Heatmap from "highcharts/modules/heatmap";

// Safe loader to prevent ESM default-wrap failures in Vite
function initHighchartsModule(module: any, core: any) {
  if (typeof module === "function") {
    module(core);
  } else if (module && typeof module.default === "function") {
    module.default(core);
  }
}

// Initialize Highcharts 3D and Cylinder modules to enable offline reports securely
if (typeof Highcharts === "object") {
  try {
    initHighchartsModule(Highcharts3D, Highcharts);
  } catch (err) {
    console.warn("Highcharts3D module initialization skipped:", err);
  }
  try {
    initHighchartsModule(Cylinder, Highcharts);
  } catch (err) {
    console.warn("Highcharts Cylinder module initialization skipped:", err);
  }
  try {
    initHighchartsModule(Exporting, Highcharts);
  } catch (err) {
    console.warn("Highcharts Exporting module initialization skipped:", err);
  }
  try {
    initHighchartsModule(OfflineExporting, Highcharts);
  } catch (err) {
    console.warn("Highcharts OfflineExporting module initialization skipped:", err);
  }
  try {
    initHighchartsModule(Heatmap, Highcharts);
  } catch (err) {
    console.warn("Highcharts Heatmap module initialization skipped:", err);
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<
    "single" | "master" | "multi" | "bar" | "aisummary" | "bulletin" | "about" | "guidelines" | "ussl" | "ranking" | "monsoon" | "gis" | "choropleth" | "hydrochemistry" | "combination" | "pca" | "fortnightly" | "limits" | "advancedAnalysis" | "calculatorius"
  >("single");

  // State to trigger dynamic recalculation and re-rendering of all components on parameter limit changes
  const [limitsVersion, setLimitsVersion] = useState(0);

  // Live modern date and time state with high precision
  const [currentDateTime, setCurrentDateTime] = useState<Date>(new Date());
  const [tableFont, setTableFont] = useState<string>(() => localStorage.getItem("table_num_font") || "Inter");

  useEffect(() => {
    localStorage.setItem("table_num_font", tableFont);
    const fontMapping: Record<string, string> = {
      "Roboto": "'Roboto', sans-serif",
      "Poppins": "'Poppins', sans-serif",
      "Manrope": "'Manrope', sans-serif",
      "IBM Plex Sans": "'IBM Plex Sans', sans-serif",
      "Segoe UI": "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
      "Inter": "'Inter', sans-serif"
    };
    const fontValue = fontMapping[tableFont] || "'Inter', sans-serif";
    document.documentElement.style.setProperty("--table-num-font", fontValue);
  }, [tableFont]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // State values for uploaded records
  const [rawData, setRawData] = useState<any[]>([]);
  const [uploadedHeaders, setUploadedHeaders] = useState<string[]>([]);
  const [headers, setHeaders] = useState<DataHeaders>({
    state: "State",
    district: "District",
    block: "Block",
    wellId: "Well ID",
    location: "Location",
    longitude: "Longitude",
    latitude: "Latitude",
    year: "Year",
    season: "Season",
    source: "Source",
    params: ["pH", "TDS", "TH", "EC", "Cl", "NO3", "F"]
  });
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({
    "pH": "pH",
    "TDS": "TDS",
    "TH": "TH",
    "EC": "EC",
    "Cl": "Cl",
    "NO3": "NO3",
    "F": "F"
  });

  // Filters State
  const [reportingLevel, setReportingLevel] = useState<"State" | "District" | "Block">("State");
  const [selectedState, setSelectedState] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("");

  const [activeParam, setActiveParam] = useState("pH");

  // Export configuration
  const [exportParams, setExportParams] = useState<string[]>([]);
  const [combinedParams, setCombinedParams] = useState<string[]>([]);
  const [exportIndividualExceedance, setExportIndividualExceedance] = useState(true);
  const [exportCombinedExceedance, setExportCombinedExceedance] = useState(true);

  // Shared state to transfer maps directly to Bulletin Report
  const [sharedBulletinMaps, setSharedBulletinMaps] = useState<Record<string, string>>({});

  // Shared Shapefile Layers State
  const [sharedLayers, setSharedLayers] = useState<ShapefileLayer[]>([]);

  // Shared Choropleth Classes config (limits, colors, and labels)
  const [choroplethClasses, setChoroplethClasses] = useState<{ limit: number; color: string; label: string }[]>([
    { limit: 5, color: "#22c55e", label: "0% - 5%" },
    { limit: 10, color: "#eab308", label: ">5% - 10%" },
    { limit: 15, color: "#f97316", label: "10% - 15%" },
    { limit: 25, color: "#ef4444", label: "15% - 25%" },
    { limit: 100, color: "#a855f7", label: ">25%" }
  ]);

  useEffect(() => {
    // Attempt to automatically pre-load default shapefiles (State and Districts) from root
    const loadDefaultShapefiles = async () => {
      const filesToTry = [
        { name: "State Layer", url: "./State.zip" },
        { name: "Districts Layer", url: "./Districts.zip" },
        { name: "District Layer", url: "./District.zip" }
      ];

      for (const item of filesToTry) {
        try {
          let response = await fetch(item.url);
          if (!response.ok) {
            response = await fetch(item.url.substring(2));
          }
          if (!response.ok) continue;

          const ct = response.headers.get("content-type") || "";
          if (ct.includes("text/html") || ct.includes("application/xhtml+xml")) {
            continue;
          }

          const buffer = await response.arrayBuffer();
          const geojson = (await shp(buffer)) as any;
          if (!geojson) continue;

          let labelKey = "";
          const sampleFeatures = geojson.type === "FeatureCollection" ? geojson.features : (Array.isArray(geojson) ? geojson[0]?.features : null);
          if (sampleFeatures && sampleFeatures.length > 0) {
            const props = sampleFeatures[0].properties || {};
            const keys = Object.keys(props);
            labelKey = keys.find(k => k.toLowerCase().includes("state") || k.toLowerCase().includes("dist") || k.toLowerCase() === "dt_name" || k.toLowerCase() === "dist_name" || k.toLowerCase() === "district_n") || keys[0] || "";
          }

          const id = `${item.name.toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`;
          const newLayer: ShapefileLayer = {
            id,
            name: item.name,
            geoJson: geojson,
            visible: true,
            strokeColor: item.name.includes("State") ? "#dc2626" : "#2563eb",
            strokeWidth: item.name.includes("State") ? 2.5 : 1.5,
            fillColor: item.name.includes("State") ? "#fca5a5" : "#93c5fd",
            fillOpacity: 10,
            showLabels: true,
            labelKey,
            labelColor: "#1e293b",
            labelSize: 10,
            showInLegend: true,
            showStroke: true,
          };

          setSharedLayers(prev => {
            if (prev.some(l => l.name === item.name)) return prev;
            return [...prev, newLayer];
          });
        } catch (err) {
          console.warn("Could not pre-load " + item.name + ":", err);
        }
      }
    };

    loadDefaultShapefiles();
  }, []);

  // Mapping Modal state overlay
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [tempHeaders, setTempHeaders] = useState<DataHeaders>({ params: [] });
  const [tempHeaderMap, setTempHeaderMap] = useState<Record<string, string>>({});

  // Toast notifications State
  const [toasts, setToasts] = useState<{ id: string; message: string; type: "success" | "error" }[]>([]);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    const id = `${Date.now()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Memoized filtered data to use consistently across exports and pre-generation
  const filteredData = useMemo(() => {
    let filtered = rawData;
    if (selectedState) {
      filtered = filtered.filter(
        (d) => String(d[headers.state || ""] || "").trim() === selectedState
      );
    }
    if (selectedDistrict) {
      filtered = filtered.filter(
        (d) => String(d[headers.district || ""] || "").trim() === selectedDistrict
      );
    }
    return [...filtered];
  }, [rawData, selectedState, selectedDistrict, headers.state, headers.district, limitsVersion]);

  // Filtered by State, District, and selected Year (without Season, for comparisons / monsoon impact)
  const yearFilteredData = useMemo(() => {
    let filtered = rawData;
    if (selectedState) {
      filtered = filtered.filter(
        (d) => String(d[headers.state || ""] || "").trim() === selectedState
      );
    }
    if (selectedDistrict) {
      filtered = filtered.filter(
        (d) => String(d[headers.district || ""] || "").trim() === selectedDistrict
      );
    }
    if (selectedYear) {
      filtered = filtered.filter(
        (d) => String(d[headers.year || ""] || "").trim() === selectedYear
      );
    }
    return [...filtered];
  }, [rawData, selectedState, selectedDistrict, selectedYear, headers.state, headers.district, headers.year, limitsVersion]);

  // Filtered by State, District, selected Year, AND selected Season
  const yearSeasonFilteredData = useMemo(() => {
    let filtered = yearFilteredData;
    if (selectedSeason) {
      filtered = filtered.filter(
        (d) => String(d[headers.season || ""] || "").trim() === selectedSeason
      );
    }
    return [...filtered];
  }, [yearFilteredData, selectedSeason, headers.season, limitsVersion]);

  // Charts are generated lazily inside BulletinView during bulletin compilation, or asynchronously when viewing a specific parameter in DetailedView.
  // This avoids blocking the main thread during data parsing and filtering.

  // Pre-guess columns matching
  const guessHeaders = (rawHeaders: string[]): { guessed: DataHeaders; map: Record<string, string> } => {
    const find = (targets: string[]) =>
      rawHeaders.find((k) => k && typeof k === "string" && targets.some((t) => k.toLowerCase().trim() === t.toLowerCase()));

    const guessed: DataHeaders = {
      state: find(["State", "State_Name", "State/UT"]),
      district: find(["District", "Dist"]),
      block: find(["Block", "Tehsil", "Block/Talluka", "Tehsil_Name"]),
      wellId: find(["Well ID", "Well_ID", "Station ID", "Site ID", "WLS_ID"]),
      location: find(["Location", "Village", "Site Name", "Place", "Location_Name"]),
      longitude: find(["Longitude", "Long", "Lon", "X"]),
      latitude: find(["Latitude", "Lat", "Y"]),
      year: find(["Year", "year"]),
      season: find(["Season", "season"]),
      aquifer: find(["Aquifer", "Aquifer Type", "Aquifer_Type", "Aquifer Name", "Aquifer_Name"]),
      source: find(["Source", "Well Type", "Well_Type", "Source Type", "Source_Type", "Water Source", "Water_Source", "src"]),
      depth: find(["Depth", "Well Depth", "Depth BGL", "Well_Depth", "Casing Depth", "Drill Depth", "Depth(m)", "Depth (m)", "BGL", "depth_m"]),
      params: [],
    };

    const knownKeys = Object.values(guessed).filter((h) => typeof h === "string") as string[];
    const map: Record<string, string> = {};

    rawHeaders.forEach((header) => {
      if (!header || typeof header !== "string") return;
      if (knownKeys.includes(header)) return;
      const hLower = header.toLowerCase().trim();
      const staticKeywords = ["location", "lat", "lon", "district", "state", "block", "village", "well", "sl. no", "serial", "unit", "source"];
      if (staticKeywords.some((sw) => hLower.includes(sw))) return;

      const matchedKey = Object.keys(PARAM_CONFIG).find((key) => {
        const config = PARAM_CONFIG[key]!;
        if (hLower === key.toLowerCase()) return true;
        if (
          config.keywords &&
          config.keywords.some((kw) => {
            if (hLower === kw) return true;
            if (hLower.includes(`(${kw})`)) return true;
            try {
              const regex = new RegExp(`\\b${kw}\\b`, "i");
              return regex.test(hLower);
            } catch {
              return hLower.includes(kw);
            }
          })
        ) {
          return true;
        }
        return false;
      });

      if (matchedKey) {
        guessed.params.push(header);
        map[header] = matchedKey;
      }
    });

    return { guessed, map };
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const arrayBuffer = evt.target?.result as ArrayBuffer;
        if (!arrayBuffer) return;

        let wb;
        try {
          wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array", cellFormula: false, cellHTML: false, cellText: false });
        } catch (readErr) {
          // Fallback: try parsing as string (for CSV text standard formats)
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(arrayBuffer);
          wb = XLSX.read(text, { type: "string", cellFormula: false, cellHTML: false, cellText: false });
        }

        if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
          showToast("Uploaded spreadsheet contains no readable sheets.", "error");
          return;
        }

        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        if (!ws) {
          showToast("Could not retrieve primary worksheet.", "error");
          return;
        }

        const parsedData = XLSX.utils.sheet_to_json(ws);
        if (!parsedData || parsedData.length === 0) {
          showToast("Uploaded spreadsheet contains no plottable data rows.", "error");
          return;
        }

        // Gather all header values from worksheet structure first
        const headersList: string[] = [];
        if (ws["!ref"]) {
          const range = XLSX.utils.decode_range(ws["!ref"]);
          const R = range.s.r; // First row
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[cellRef];
            if (cell && (cell.v !== undefined && cell.v !== null)) {
              headersList.push(String(cell.v).trim());
            } else if (cell && cell.w !== undefined) {
              headersList.push(String(cell.w).trim());
            }
          }
        }

        // Fallback: extract headers from parsed rows (for resilient mapping)
        const allKeys = new Set<string>();
        parsedData.forEach((row: any) => {
          if (row && typeof row === "object") {
            Object.keys(row).forEach((k) => {
              if (k && !k.startsWith("__EMPTY")) {
                allKeys.add(String(k).trim());
              }
            });
          }
        });

        // Merge standard worksheet headers with json keys
        const headersSet = new Set<string>(headersList.filter(Boolean));
        allKeys.forEach((k) => headersSet.add(k));
        const uniqueHeaders = Array.from(headersSet);

        if (uniqueHeaders.length === 0) {
          showToast("Could not extract column headers. Verify spreadsheet structure.", "error");
          return;
        }

        setRawData(parsedData);
        setUploadedHeaders(uniqueHeaders);

        const { guessed, map } = guessHeaders(uniqueHeaders);
        setTempHeaders(guessed);
        setTempHeaderMap(map);
        
        // Open the mapping modal overlay
        setMappingModalOpen(true);
      } catch (err) {
        console.error(err);
        showToast("Parser error: ensure file is a valid standard .csv, .xls, or .xlsx spreadsheet.", "error");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSaveMapping = (finalHeaders: DataHeaders, finalHeaderMap: Record<string, string>) => {
    setHeaders(finalHeaders);
    setHeaderMap(finalHeaderMap);
    setMappingModalOpen(false);

    // Initial dropdown values
    if (finalHeaders.params.length > 0) {
      const firstParam = finalHeaders.params[0]!;
      setActiveParam(firstParam);
      setExportParams([...finalHeaders.params]);
      setCombinedParams([...finalHeaders.params]);
    }

    showToast("Data columns mapped and synchronized successfully!", "success");
  };

  const handleCancelMapping = () => {
    setMappingModalOpen(false);
    showToast("Mapping canceled. Data was not imported.", "error");
  };

  useEffect(() => {
    // Attempt to auto-load default data from public/root path with multiple fallback file options
    const autoLoadDefaultData = async () => {
      const dataFilesToTry = [
        "./Pre-Monsoon.xlsx",
        "/Pre-Monsoon.xlsx",
        "./Pre-Monsoon 2025.xlsx",
        "/Pre-Monsoon 2025.xlsx",
        "./Pre-Monsoon.xlsx.xlsx",
        "/Pre-Monsoon.xlsx.xlsx",
        "./Pre-Monsoon 2025.xlsx.xlsx",
        "/Pre-Monsoon 2025.xlsx.xlsx",
        "./Pre_Monsoon.xlsx",
        "/Pre_Monsoon.xlsx",
        "./PreMonsoon.xlsx",
        "/PreMonsoon.xlsx",
        "./pre-monsoon.xlsx",
        "/pre-monsoon.xlsx",
        "./Pre-Monsoon.xls",
        "/Pre-Monsoon.xls",
        "./Pre-Monsoon 2025.xls",
        "/Pre-Monsoon 2025.xls",
        "./groundwater_data.xlsx",
        "/groundwater_data.xlsx",
        "./data.xlsx",
        "/data.xlsx",
        "./groundwater.xlsx",
        "/groundwater.xlsx",
        "./data.csv",
        "/data.csv"
      ];

      for (const fileUrl of dataFilesToTry) {
        try {
          const response = await fetch(fileUrl);
          if (response.ok) {
            const ct = response.headers.get("content-type") || "";
            if (!ct.includes("text/html") && !ct.includes("application/xhtml+xml")) {
              console.log(`Auto-loading default data from: ${fileUrl}`);
              return { response, filename: fileUrl.split("/").pop() || "Default Data" };
            }
          }
        } catch (err) {
          // Continue trying other files
        }
      }
      console.log("No default spreadsheet could be auto-loaded. Waiting for user upload.");
      return null;
    };

    autoLoadDefaultData().then(async (result) => {
      if (!result) return;
      const { response, filename } = result;
      try {
        const arrayBuffer = await response.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array", cellFormula: false, cellHTML: false, cellText: false });
        if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) return;

        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        if (!ws) return;

        const parsedData = XLSX.utils.sheet_to_json(ws);
        if (!parsedData || parsedData.length === 0) return;

        const headersList: string[] = [];
        if (ws["!ref"]) {
          const range = XLSX.utils.decode_range(ws["!ref"]);
          const R = range.s.r;
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[cellRef];
            if (cell && (cell.v !== undefined && cell.v !== null)) {
              headersList.push(String(cell.v).trim());
            } else if (cell && cell.w !== undefined) {
              headersList.push(String(cell.w).trim());
            }
          }
        }

        const allKeys = new Set<string>();
        parsedData.forEach((row: any) => {
          if (row && typeof row === "object") {
            Object.keys(row).forEach((k) => {
              if (k && !k.startsWith("__EMPTY")) {
                allKeys.add(String(k).trim());
              }
            });
          }
        });

        const headersSet = new Set<string>(headersList.filter(Boolean));
        allKeys.forEach((k) => headersSet.add(k));
        const uniqueHeaders = Array.from(headersSet);

        setRawData(parsedData);
        setUploadedHeaders(uniqueHeaders);

        const { guessed, map } = guessHeaders(uniqueHeaders);
        setHeaders(guessed);
        setHeaderMap(map);

        if (guessed.params.length > 0) {
          const firstParam = guessed.params[0]!;
          setActiveParam(firstParam);
          setExportParams([...guessed.params]);
          setCombinedParams([...guessed.params]);
        }

        showToast(`Auto-loaded default data: ${filename} successfully!`, "success");
      } catch (err) {
        console.error("Error parsing auto-loaded default data:", err);
      }
    });
  }, []);

  // State Options dropdown values List
  const stateList = useMemo(() => {
    const key = headers.state || "";
    if (!key) return [];
    return [...new Set(rawData.map((d) => String(d[key] || "").trim()))]
      .filter((v) => v && v !== "Unknown")
      .sort();
  }, [rawData, headers.state]);

  // District options list linked automatically to selected state
  const districtList = useMemo(() => {
    if (!selectedState) return [];
    const stateKey = headers.state || "";
    const distKey = headers.district || "";
    if (!distKey) return [];
    return [
      ...new Set(
        rawData
          .filter((d) => String(d[stateKey] || "").trim() === selectedState)
          .map((d) => String(d[distKey] || "").trim())
      ),
    ]
      .filter((v) => v && v !== "Unknown")
      .sort();
  }, [rawData, selectedState, headers.state, headers.district]);

  // Year options list
  const yearList = useMemo(() => {
    const key = headers.year || "";
    if (!key || !rawData || rawData.length === 0) return [];
    return [...new Set(rawData.map((d) => String(d[key] || "").trim()))]
      .filter((v) => v && v !== "Unknown" && v !== "")
      .sort();
  }, [rawData, headers.year]);

  // Season options list
  const seasonList = useMemo(() => {
    const key = headers.season || "";
    if (!key || !rawData || rawData.length === 0) return [];
    return [...new Set(rawData.map((d) => String(d[key] || "").trim()))]
      .filter((v) => v && v !== "Unknown" && v !== "")
      .sort();
  }, [rawData, headers.season]);

  const handleStateChange = (stateVal: string) => {
    setSelectedState(stateVal);
    setSelectedDistrict(""); // Reset district
  };

  const handleLevelChange = (level: "State" | "District" | "Block") => {
    setReportingLevel(level);
  };

  // Spreadsheet styles applicator helper
  const applyExcelStyles = (ws: any, headerRowCount = 1) => {
    if (!ws["!ref"]) return;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const colWidths: any[] = [];
    const rowHeights: any[] = [];

    // Columns width
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellRef]) ws[cellRef] = { t: "s", v: "" };
        const cellText = ws[cellRef].w || String(ws[cellRef].v || "");

        const maxLineLen = Math.max(...cellText.split("\n").map((l: string) => l.length));
        const textLen = maxLineLen + 2;

        if (!colWidths[C] || colWidths[C].wch < textLen) {
          colWidths[C] = { wch: Math.min(Math.max(textLen, 10), 40) };
        }
      }
    }

    // Styles writing logic
    for (let R = range.s.r; R <= range.e.r; ++R) {
      const isHeader = R < headerRowCount;
      let maxRowHeight = isHeader ? 25 : 18;

      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[cellRef];
        const cellText = cell.w || String(cell.v || "");
        const lines = cellText.split("\n");
        const colWidthLimit = colWidths[C].wch;

        let estimatedLines = 0;
        lines.forEach((line: string) => {
          estimatedLines += Math.max(1, Math.ceil((line.length + 1) / colWidthLimit));
        });

        const calcHeight = estimatedLines * 15 + 4;
        if (calcHeight > maxRowHeight) maxRowHeight = calcHeight;

        cell.s = {
          font: {
            name: "Times New Roman",
            sz: 11,
            bold: isHeader,
            color: { rgb: isHeader ? "FFFFFF" : "000000" },
          },
          fill: isHeader ? { fgColor: { rgb: "3b82f6" } } : undefined, // Cool primary blue headers
          border: {
            top: { style: "thin", color: { rgb: "cbd5e1" } },
            bottom: { style: "thin", color: { rgb: "cbd5e1" } },
            left: { style: "thin", color: { rgb: "cbd5e1" } },
            right: { style: "thin", color: { rgb: "cbd5e1" } },
          },
          alignment: {
            wrapText: true,
            vertical: "center",
            horizontal: isHeader ? "center" : "left",
          },
        };
      }
      rowHeights[R] = { hpt: maxRowHeight };
    }

    ws["!cols"] = colWidths;
    ws["!rows"] = rowHeights;
  };

  // Compliance calculations for sheets
  const computeComplianceDataRows = (paramName: string, filteredDataset: any[], level: "State" | "District" | "Block") => {
    const configKey = headerMap[paramName];
    const config = PARAM_CONFIG[configKey];
    if (!config) return null;

    const unit = config.unit;
    const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";

    let accLabel = "", permLabel = "", failLabel = "";
    if (configKey === "pH") {
      accLabel = `pH: ${config.b1}-${config.b2}`;
      failLabel = "Out Range";
    } else if (isSingleLimit) {
      accLabel = `≤${config.b1} ${unit}`;
      failLabel = `>${config.b1} ${unit}`;
    } else {
      accLabel = `≤${config.b1} ${unit}`;
      permLabel = `>${config.b1}-${config.b2} ${unit}`;
      failLabel = `>${config.b2} ${unit}`;
    }

    // Set headers
    const cols = ["S.No."];
    if (level === "State") cols.push("State");
    else if (level === "District") cols.push("State", "District");
    else cols.push("State", "District", "Block");

    cols.push("Total Samples", `${accLabel} (No)`, `${accLabel} (%)`);
    if (!isSingleLimit && configKey !== "pH") {
      cols.push(`${permLabel} (No)`, `${permLabel} (%)`);
    }
    cols.push(`${failLabel} (No)`, `${failLabel} (%)`, "Min", "Max", "Average", "SD");

    // Gather groups
    const groupKey =
      level === "State"
        ? headers.state
        : level === "District"
        ? headers.district
        : headers.block;

    if (!groupKey) return null;

    const groupMap: Record<string, { state: string; district: string; samples: any[] }> = {};
    let globalAcc = 0, globalPerm = 0, globalFail = 0;
    const globalVals: number[] = [];

    filteredDataset.forEach((row) => {
      const loc = String(row[groupKey] || "Unknown").trim();
      if (!groupMap[loc]) {
        groupMap[loc] = {
          state: String(row[headers.state || ""] || ""),
          district: String(row[headers.district || ""] || ""),
          samples: [],
        };
      }
      groupMap[loc].samples.push(row);

      const val = parseFloat(row[paramName]);
      if (!isNaN(val)) globalVals.push(val);
    });

    const bodyRows: any[][] = [];
    const sortedEntries = Object.entries(groupMap).sort((a, b) => a[0].localeCompare(b[0]));

    sortedEntries.forEach(([name, data], idx) => {
      const vals = data.samples.map((s) => parseFloat(s[paramName])).filter((v) => !isNaN(v));
      const total = vals.length;
      if (total === 0) return;

      let nAcc = 0, nPerm = 0, nFail = 0;
      vals.forEach((v) => {
        if (configKey === "pH") {
          if (v >= config.b1 && v <= config.b2) {
            nAcc++;
            globalAcc++;
          } else {
            nFail++;
            globalFail++;
          }
        } else if (isSingleLimit) {
          if (v <= config.b1) {
            nAcc++;
            globalAcc++;
          } else {
            nFail++;
            globalFail++;
          }
        } else {
          if (v <= config.b1) {
            nAcc++;
            globalAcc++;
          } else if (v <= config.b2) {
            nPerm++;
            globalPerm++;
          } else {
            nFail++;
            globalFail++;
          }
        }
      });

      const mathStats = getStats(vals);
      const rowItem: any[] = [idx + 1];

      if (level === "State") rowItem.push(data.state);
      else if (level === "District") rowItem.push(data.state, data.district);
      else rowItem.push(data.state, data.district, name);

      rowItem.push(total);
      rowItem.push(nAcc, { v: (nAcc / total) * 100, t: "n", z: "0.00" });
      if (!isSingleLimit && configKey !== "pH") {
        rowItem.push(nPerm, { v: (nPerm / total) * 100, t: "n", z: "0.00" });
      }
      rowItem.push(nFail, { v: (nFail / total) * 100, t: "n", z: "0.00" });

      rowItem.push(
        parseFloat(mathStats.min.toFixed(2)),
        parseFloat(mathStats.max.toFixed(2)),
        parseFloat(mathStats.avg.toFixed(2)),
        parseFloat(mathStats.std.toFixed(2))
      );

      bodyRows.push(rowItem);
    });

    // Grand total
    if (globalVals.length > 0) {
      const grandStats = getStats(globalVals);
      const totalCount = globalVals.length;
      const totalRow: any[] = ["-"];

      if (level === "State") totalRow.push("TOTAL SUMMARY");
      else if (level === "District") totalRow.push("TOTAL SUMMARY", "");
      else totalRow.push("TOTAL SUMMARY", "", "");

      totalRow.push(totalCount);
      totalRow.push(globalAcc, { v: (globalAcc / totalCount) * 100, t: "n", z: "0.00" });
      if (!isSingleLimit && configKey !== "pH") {
        totalRow.push(globalPerm, { v: (globalPerm / totalCount) * 100, t: "n", z: "0.00" });
      }
      totalRow.push(globalFail, { v: (globalFail / totalCount) * 100, t: "n", z: "0.00" });

      totalRow.push(
        parseFloat(grandStats.min.toFixed(2)),
        parseFloat(grandStats.max.toFixed(2)),
        parseFloat(grandStats.avg.toFixed(2)),
        parseFloat(grandStats.std.toFixed(2))
      );

      bodyRows.push(totalRow);
    }

    return [cols, ...bodyRows];
  };

  const handleExportIndividual = () => {
    if (!rawData.length) {
      showToast("Uploaded dataset is empty. Cannot export.", "error");
      return;
    }

    if (exportParams.length === 0 && combinedParams.length === 0) {
      showToast("Minimum of one parameter must be checked to begin exporting.", "error");
      return;
    }

    let filtered = yearSeasonFilteredData;

    const wb = XLSX.utils.book_new();
    const uniqueSheetNames = new Set<string>();

    // 1. Generate compliance sheet tab per parameter selection
    exportParams.forEach((paramName) => {
      const dataArr = computeComplianceDataRows(paramName, filtered, reportingLevel);
      if (dataArr && dataArr.length > 1) {
        const ws = XLSX.utils.aoa_to_sheet(dataArr);
        applyExcelStyles(ws, 1);

        let cleanName = paramName.substring(0, 24).replace(/[\[\]\*\/\\\?\:]/g, "_");
        let sheetNameVal = cleanName;
        let counter = 1;
        while (uniqueSheetNames.has(sheetNameVal)) {
          sheetNameVal = `${cleanName}_${counter++}`;
        }
        uniqueSheetNames.add(sheetNameVal);

        XLSX.utils.book_append_sheet(wb, ws, sheetNameVal);
      }
    });

    // 2. Generate Exceedance logs
    if (exportIndividualExceedance || exportCombinedExceedance) {
      const indRows: any[][] = [];
      const combRows: any[][] = [];
      let indSl = 1;
      let combSl = 1;

      const indCols = [
        "Sl. No",
        "Well ID",
        "State/UT",
        "District",
        "Block/Tehsil",
        "Location",
        "Longitude",
        "Latitude",
        "Measured Value",
        "Parameter Name",
        "BIS Permissible Limit",
        "Unit",
      ];

      const combCols = [
        "Sl. No",
        "Well ID",
        "State/UT",
        "District",
        "Block/Tehsil",
        "Location",
        "Longitude",
        "Latitude",
        "Count of Exceedances",
        "Names of Exceedances",
        "Exceeding Values Detail",
        "Classification",
      ];

      filtered.forEach((row) => {
        const localExceedances: string[] = [];
        const localNames: string[] = [];
        let hasHeavyMetal = false;

        Object.keys(headerMap).forEach((headerCol) => {
          const isExpInd = exportParams.includes(headerCol);
          const isExpComb = combinedParams.includes(headerCol);

          if (!isExpInd && !isExpComb) return;

          const key = headerMap[headerCol]!;
          const config = PARAM_CONFIG[key]!;
          const val = parseFloat(row[headerCol]);

          if (isNaN(val)) return;

          const isSingleLimit = config.b1 === config.b2 && key !== "pH";
          const checkLimit = key === "pH" ? null : isSingleLimit ? config.b1 : config.b2;

          let isExceeding = false;
          let limitStr = "";

          if (key === "pH") {
            if (val < config.b1 || val > config.b2) {
              isExceeding = true;
              limitStr = `${config.b1}-${config.b2}`;
            }
          } else if (checkLimit !== null) {
            if (val > checkLimit) {
              isExceeding = true;
              limitStr = `${checkLimit}`;
            }
          }

          if (isExceeding) {
            const wholeNums = ["EC", "NO3", "TH", "Ca", "SO4", "Mg", "Cl"];
            const decimalPlaces = wholeNums.includes(key) ? 0 : 4;
            const zFormat = wholeNums.includes(key) ? "0" : key === "F" ? "0.00" : "0.000";

            if (isExpInd) {
              indRows.push([
                indSl++,
                row[headers.wellId || ""] || "-",
                row[headers.state || ""] || "-",
                row[headers.district || ""] || "-",
                row[headers.block || ""] || "-",
                row[headers.location || ""] || "-",
                row[headers.longitude || ""] || "-",
                row[headers.latitude || ""] || "-",
                { v: val, t: "n", z: zFormat },
                headerCol,
                `${limitStr} ${config.unit}`.trim(),
                config.unit,
              ]);
            }

            if (isExpComb) {
              const heavyList = ["Fe", "As", "U", "Zn", "Cu", "Pb", "Cd", "Cr", "Hg", "Ni", "Se", "Ba"];
              if (heavyList.includes(key)) hasHeavyMetal = true;

              localExceedances.push(`${headerCol} (${val.toFixed(decimalPlaces)} ${config.unit})`);
              localNames.push(headerCol);
            }
          }
        });

        if (localExceedances.length > 0) {
          let typeClass = "One Parameter Contamination";
          if (hasHeavyMetal) typeClass = "Contamination with heavy metals";
          else if (localExceedances.length > 1) typeClass = "Multi Parameter Contamination";

          combRows.push([
            combSl++,
            row[headers.wellId || ""] || "-",
            row[headers.state || ""] || "-",
            row[headers.district || ""] || "-",
            row[headers.block || ""] || "-",
            row[headers.location || ""] || "-",
            row[headers.longitude || ""] || "-",
            row[headers.latitude || ""] || "-",
            localNames.length,
            localNames.join(", "),
            localExceedances.join(", "),
            typeClass,
          ]);
        }
      });

      if (exportIndividualExceedance && indRows.length > 0) {
        const titleRow = ["Locations where parameter values exceed the respective permissible limits as per BIS: 10500"];
        const wsIndData = [titleRow, indCols, ...indRows];
        const wsInd = XLSX.utils.aoa_to_sheet(wsIndData);
        wsInd["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
        applyExcelStyles(wsInd, 2);
        XLSX.utils.book_append_sheet(wb, wsInd, "Exceedance Locations");
      }

      if (exportCombinedExceedance && combRows.length > 0) {
        const titleRow = ["Locations with one or more parameters exceeding permissible limits as per BIS: 10500"];
        const wsCombData = [titleRow, combCols, ...combRows];
        const wsComb = XLSX.utils.aoa_to_sheet(wsCombData);
        wsComb["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
        applyExcelStyles(wsComb, 2);
        XLSX.utils.book_append_sheet(wb, wsComb, "Combined Exceedances");
      }
    }

    if (wb.SheetNames.length === 0) {
      showToast("No mapped data available to write sheets.", "error");
      return;
    }

    XLSX.writeFile(wb, `Groundwater_Compliance_Report_${Date.now()}.xlsx`);
    showToast("Styled Excel Workbook written successfully!", "success");
  };

  const getActiveTabButtonClasses = (tab: typeof activeTab) => {
    return activeTab === tab
      ? "whitespace-nowrap px-6 py-3 font-black text-indigo-600 border-b-4 border-indigo-650 transition-all select-none"
      : "whitespace-nowrap px-6 py-3 font-bold text-slate-400 border-b-4 border-transparent hover:text-slate-700 transition-all select-none";
  };

  return (
    <div className="min-h-screen p-4 md:p-8 relative">
      
      {/* Dynamic Toast Notifications */}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-6 py-3 rounded-xl font-bold text-white shadow-lg flex items-center gap-2 duration-300 pointer-events-auto transform translate-y-0 opacity-100 ${
              toast.type === "success" ? "bg-emerald-600" : "bg-rose-600"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            <span>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-2 hover:bg-white/20 p-0.5 rounded-lg transition-colors border border-transparent"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Upload Mapping Modal Overlay */}
      <MappingModal
        isOpen={mappingModalOpen}
        uploadedHeaders={uploadedHeaders}
        initialHeaders={tempHeaders}
        initialHeaderMap={tempHeaderMap}
        onSave={handleSaveMapping}
        onCancel={handleCancelMapping}
      />

      <div className="w-full mx-auto max-w-none">
        
        {/* Official Bilingual Header Branding */}
        <div className="bg-white rounded-3xl p-5 md:p-6 mb-8 border border-slate-200/80 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-cyan-400 via-blue-600 to-indigo-600"></div>
          
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 w-full md:w-auto">
            {/* 1. Animated Cup of Tea with Rising Steam/Warm Vapor */}
            <div className="relative flex-shrink-0 w-16 h-16 flex items-center justify-center select-none bg-slate-900/5 rounded-2xl animate-radiate shine-sweep-container transition-transform duration-300 hover:scale-110">
              {/* Shine sweep element */}
              <div className="shine-sweep-element"></div>
              
              {/* Hot Tea Cup SVG */}
              <svg className="w-12 h-12 drop-shadow-[0_4px_10px_rgba(249,115,22,0.4)]" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  {/* Gradients for warm ceramic cup and tea liquid */}
                  <linearGradient id="ceramicGrad" x1="50" y1="48" x2="50" y2="78" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#1d4ed8" />
                  </linearGradient>
                  <linearGradient id="saucerGrad" x1="50" y1="78" x2="50" y2="86" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#e2e8f0" />
                    <stop offset="100%" stopColor="#94a3b8" />
                  </linearGradient>
                  <linearGradient id="teaLiquidGrad" x1="50" y1="46" x2="50" y2="50" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#fb923c" />
                    <stop offset="100%" stopColor="#7c2d12" />
                  </linearGradient>
                  <linearGradient id="steamGrad" x1="50" y1="40" x2="50" y2="5" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#fef08a" stopOpacity="0.8" />
                    <stop offset="50%" stopColor="#ffffff" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Rotating accent aura around tea cup */}
                <circle cx="50" cy="50" r="44" stroke="#fb923c" strokeWidth="1" strokeDasharray="4 6" opacity="0.3" className="animate-spin" style={{ transformOrigin: '50px 50px', animationDuration: '24s' }} />
                <circle cx="50" cy="50" r="38" stroke="#38bdf8" strokeWidth="0.75" strokeDasharray="2 3" opacity="0.2" className="animate-spin" style={{ transformOrigin: '50px 50px', animationDuration: '14s', animationDirection: 'reverse' }} />

                {/* Saucer at bottom */}
                <ellipse cx="50" cy="80" rx="32" ry="5" fill="url(#saucerGrad)" stroke="#64748b" strokeWidth="1" />

                {/* Cup handle */}
                <path d="M 72 54 C 84 54, 84 70, 70 70" fill="none" stroke="url(#ceramicGrad)" strokeWidth="4" strokeLinecap="round" />

                {/* Main Cup Body */}
                <path d="M 26 48 C 26 48, 24 76, 50 76 C 76 76, 74 48, 74 48 Z" fill="url(#ceramicGrad)" stroke="#1e3a8a" strokeWidth="1.5" />

                {/* Inside rim of cup */}
                <ellipse cx="50" cy="48" rx="24" ry="4.5" fill="#1e40af" stroke="#93c5fd" strokeWidth="1" />

                {/* Tea Liquid inside */}
                <ellipse cx="50" cy="49" rx="21" ry="3.5" fill="url(#teaLiquidGrad)" />

                {/* Rising Steam Wisps (wavy trails with custom riser animations) */}
                <g stroke="url(#steamGrad)" strokeWidth="2.5" strokeLinecap="round" fill="none">
                  {/* Steam 1 (Left) */}
                  <path d="M 38 41 C 35 30, 43 23, 37 12 C 34 7, 39 3, 37 -3" className="animate-steam-1" style={{ transformOrigin: '38px 41px' }} />
                  {/* Steam 2 (Middle) */}
                  <path d="M 50 41 C 47 28, 55 19, 49 8 C 46 2, 51 -2, 49 -8" className="animate-steam-2" style={{ transformOrigin: '50px 41px' }} />
                  {/* Steam 3 (Right) */}
                  <path d="M 62 41 C 59 30, 67 23, 61 12 C 58 7, 63 3, 61 -3" className="animate-steam-3" style={{ transformOrigin: '62px 41px' }} />
                </g>
              </svg>
            </div>

            {/* 2. Header Branding */}
            <div className="text-center sm:text-left">
              <div className="flex flex-col sm:flex-row sm:items-center gap-x-5 gap-y-1">
                {/* Main Title 'भूजल गुणवत्ता' (Bhujal Gunvaatta in Devanagari Cursive) */}
                <h1 className="text-[47px] font-black text-blue-700 tracking-wide font-cursive-devanagari select-none" style={{ fontFamily: "'Kalam', 'Yatra One', cursive", lineHeight: "1.1" }}>
                  भूजल गुणवत्ता
                </h1>
                {/* English Title styled in British Cursive Script */}
                <h2 className="text-[47px] md:text-[62px] font-medium text-indigo-950 tracking-wide font-cursive select-none pt-1" style={{ fontFamily: "'Great Vibes', 'Playfair Display', serif", lineHeight: "1.1" }}>
                  Data Analysis Interface
                </h2>
              </div>
            </div>
          </div>

          {/* 3. Modern Live Date and Time Display */}
          <div className="flex flex-row md:flex-col items-center md:items-end gap-1 shrink-0 w-full md:w-auto justify-between md:justify-end text-right select-none">
            <span className="text-xl md:text-2xl font-black text-black font-mono tracking-tight tabular-nums">
              {(() => {
                const hours = String(currentDateTime.getHours() % 12 || 12).padStart(2, '0');
                const minutes = String(currentDateTime.getMinutes()).padStart(2, '0');
                const seconds = String(currentDateTime.getSeconds()).padStart(2, '0');
                const ampm = currentDateTime.getHours() >= 12 ? 'PM' : 'AM';
                return `${hours}:${minutes}:${seconds} ${ampm}`;
              })()}
            </span>
            <span className="text-xs font-extrabold text-[#8B4513] tracking-wide uppercase">
              {currentDateTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>

        {/* Global Geographical Filter Strip when data is present */}
        {rawData.length > 0 && (
          <div className="glossy-panel glossy-panel-dropdown p-5 rounded-3xl mb-6 flex flex-col md:flex-row gap-4 items-stretch md:items-end relative z-[60]">
            
            <div className="flex-1 min-w-[150px]">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5 drop-shadow-xs">1. Reporting Level</label>
              <select
                value={reportingLevel}
                onChange={(e) => handleLevelChange(e.target.value as any)}
                className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 bg-white cursor-pointer select-none text-xs"
              >
                <option value="State">States and UTs Wise</option>
                <option value="District">District Wise</option>
                <option value="Block">Block Wise</option>
              </select>
            </div>

            <div className="flex-1 min-w-[150px]">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5 drop-shadow-xs">2. Choose States and UTs</label>
              <select
                value={selectedState}
                onChange={(e) => handleStateChange(e.target.value)}
                className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 bg-white cursor-pointer select-none text-xs"
              >
                <option value="">All States and UTs</option>
                {stateList.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>

            {selectedState && reportingLevel !== "State" && (
              <div className="flex-1 min-w-[150px]">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5 drop-shadow-xs">3. Choose District</label>
                <select
                  value={selectedDistrict}
                  onChange={(e) => setSelectedDistrict(e.target.value)}
                  className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 bg-white cursor-pointer select-none text-xs"
                >
                  <option value="">All Districts</option>
                  {districtList.map((dist) => (
                    <option key={dist} value={dist}>{dist}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Year Filter */}
            {yearList.length > 0 && (
              <div className="flex-1 min-w-[120px]">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5 drop-shadow-xs">Year</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 bg-white cursor-pointer select-none text-xs"
                >
                  <option value="">All Years</option>
                  {yearList.map((yr) => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Season Filter */}
            {seasonList.length > 0 && (
              <div className="flex-1 min-w-[120px]">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5 drop-shadow-xs">Season</label>
                <select
                  value={selectedSeason}
                  onChange={(e) => setSelectedSeason(e.target.value)}
                  className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 bg-white cursor-pointer select-none text-xs"
                >
                  <option value="">All Seasons</option>
                  {seasonList.map((sea) => (
                    <option key={sea} value={sea}>{sea}</option>
                  ))}
                </select>
              </div>
            )}

          </div>
        )}

        {/* Responsive Mobile Tab Select Dropdown */}
        <div className="md:hidden mb-6 flex flex-col gap-3">
          <div>
            <label className="text-[10px] font-black text-indigo-650 uppercase tracking-widest block mb-2 drop-shadow-sm">
              Primary Navigation Module
            </label>
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as any)}
              className="w-full glossy-input rounded-2xl p-4 font-black text-slate-700 bg-white cursor-pointer select-none text-sm border-2 border-slate-200 outline-none focus:border-indigo-500 shadow-md transition-all"
            >
              <option value="single">📊 Detailed Analysis</option>
              <option value="advancedAnalysis">🧪 Advanced Data Analysis</option>
              <option value="ranking">📈 Ranking Stats</option>
              <option value="ussl">📈 USSL & Piper Diagram</option>
              <option value="combination">🧬 Combination Analysis</option>
              <option value="pca">📊 PCA Analysis</option>
              <option value="hydrochemistry">📋 Hydrochemistry Sheet</option>
              <option value="calculatorius">🧮 Calculatorius</option>
              <option value="gis">🌍 Geospatial Map Module</option>
              <option value="choropleth">✨ GIS Choropleth Map</option>
              <option value="master">📋 Master Summary Matrix</option>
              <option value="monsoon">🌧️ Dynamic Impact of Monsoon</option>
              <option value="bar">📊 Comparative Exceedance (Bar)</option>
              <option value="aisummary">📄 District Pamphlet</option>
              <option value="bulletin">📰 Annual Ground Water Quality Report</option>
              <option value="fortnightly">🔔 Fortnightly Quality Alerts</option>
              <option value="limits">⚙️ Parameter Limits Manager</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            {rawData.length > 0 && (
              <button
                onClick={handleExportIndividual}
                className="w-full glossy-btn-emerald px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm text-white"
              >
                <Download className="w-3.5 h-3.5 text-white" /> Export Styled Report
              </button>
            )}

            <div className="flex items-center gap-2.5">
              <div className={`text-white font-extrabold text-[10px] tracking-widest px-4 py-2.5 rounded-xl select-none animate-pulse flex items-center justify-center min-w-[70px] border transition-all duration-300 ${
                rawData.length > 0 
                  ? "bg-gradient-to-b from-blue-500 to-blue-700 shadow-[0_4px_10px_rgba(59,130,246,0.4),inset_0_-2px_4px_rgba(0,0,0,0.2),inset_0_2px_4px_rgba(255,255,255,0.3)] border-blue-600/50" 
                  : "bg-gradient-to-b from-red-500 to-red-700 shadow-[0_4px_10px_rgba(239,68,68,0.4),inset_0_-2px_4px_rgba(0,0,0,0.2),inset_0_2px_4px_rgba(255,255,255,0.3)] border-red-600/50"
              }`}>
                READY
              </div>

              <label className="flex-1 cursor-pointer glossy-btn-dark px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 select-none shadow-sm border border-slate-300 bg-slate-900 text-white hover:bg-slate-800">
                <UploadCloud className="w-3.5 h-3.5 text-slate-300 animate-pulse" /> Upload Excel or CSV
                <input type="file" onChange={handleFileUpload} className="hidden" accept=".xlsx, .xls, .csv" />
              </label>
            </div>
          </div>
        </div>

        {/* Desktop Tab Controls Bar */}
        <div className="hidden md:flex flex-wrap gap-x-4 gap-y-4 mb-8 select-none p-4 bg-slate-50/75 rounded-3xl border border-slate-200 shadow-inner">
          {[
            { id: "single", label: "Detailed Analysis", icon: LayoutDashboard, baseColor: "blue" },
            { id: "advancedAnalysis", label: "Advanced Data Analysis", icon: Activity, baseColor: "indigo" },
            { id: "ranking", label: "Ranking Stats", icon: TrendingUp, baseColor: "violet" },
            { id: "ussl", label: "USSL & Piper Analysis", icon: Compass, baseColor: "indigo" },
            { id: "combination", label: "Combination Analysis", icon: Layers, baseColor: "indigo" },
            { id: "pca", label: "PCA Analysis", icon: Cpu, baseColor: "violet" },
            { id: "hydrochemistry", label: "Hydrochemistry Sheet", icon: TableProperties, baseColor: "emerald" },
            { id: "calculatorius", label: "Calculatorius", icon: Calculator, baseColor: "indigo" },
            { id: "gis", label: "Geospatial Map Module", icon: Globe, baseColor: "teal" },
            { id: "choropleth", label: "GIS Choropleth Map", icon: Map, baseColor: "indigo" },
            { id: "master", label: "Master Summary", icon: Table2, baseColor: "amber" },
            { id: "monsoon", label: "Dynamic Monsoon Impact", icon: Database, baseColor: "emerald" },
            { id: "bar", label: "Comparative Exceedance (Bar)", icon: BarChart3, baseColor: "orange" },
            { id: "aisummary", label: "District Pamphlet", icon: LayoutTemplate, baseColor: "fuchsia" },
            { id: "bulletin", label: "Annual Ground Water Quality Report", icon: FileText, baseColor: "red" },
            { id: "fortnightly", label: "Fortnightly Quality Alerts", icon: AlertTriangle, baseColor: "rose" },
            { id: "limits", label: "Limits Manager", icon: Settings, baseColor: "blue" },
          ].map((tabItem) => {
            const IconComponent = tabItem.icon;
            const isActive = activeTab === tabItem.id;
            
            const colorMap: Record<string, { activeBg: string; ring: string }> = {
              blue: {
                activeBg: "bg-slate-700 border-slate-700 shadow-slate-800/10",
                ring: "ring-slate-400",
              },
              violet: {
                activeBg: "bg-slate-750 border-slate-750 shadow-slate-800/10",
                ring: "ring-slate-400",
              },
              teal: {
                activeBg: "bg-teal-800 border-teal-800 shadow-teal-900/10",
                ring: "ring-teal-400",
              },
              indigo: {
                activeBg: "bg-indigo-900 border-indigo-900 shadow-indigo-950/10",
                ring: "ring-indigo-400",
              },
              amber: {
                activeBg: "bg-amber-800 border-amber-800 shadow-amber-900/10",
                ring: "ring-amber-400",
              },
              emerald: {
                activeBg: "bg-emerald-800 border-emerald-800 shadow-emerald-900/10",
                ring: "ring-emerald-400",
              },
              pink: {
                activeBg: "bg-stone-800 border-stone-800 shadow-stone-900/10",
                ring: "ring-stone-400",
              },
              orange: {
                activeBg: "bg-amber-900 border-amber-900 shadow-amber-950/10",
                ring: "ring-amber-400",
              },
              fuchsia: {
                activeBg: "bg-slate-800 border-slate-800 shadow-slate-900/10",
                ring: "ring-slate-400",
              },
              red: {
                activeBg: "bg-rose-950 border-rose-950 shadow-rose-950/10",
                ring: "ring-rose-400",
              },
              slate: {
                activeBg: "bg-slate-800 border-slate-800 shadow-slate-900/10",
                ring: "ring-slate-400",
              },
              rose: {
                activeBg: "bg-stone-800 border-stone-800 shadow-stone-900/10",
                ring: "ring-stone-400",
              },
            };

            const style = colorMap[tabItem.baseColor] || colorMap.blue;

            return (
              <button
                key={tabItem.id}
                onClick={() => setActiveTab(tabItem.id as any)}
                className={`
                  whitespace-nowrap px-4 py-2.5 rounded-2xl font-extrabold text-xs flex items-center gap-2 select-none transition-all duration-150 cursor-pointer border
                  ${isActive 
                    ? `${style.activeBg} text-white shadow-md translate-y-[1px] ring-2 ${style.ring} ring-offset-2` 
                    : `bg-slate-50 hover:bg-slate-100/95 text-slate-600 hover:text-slate-850 border-slate-200/80 shadow-xs hover:translate-y-[-1px] active:translate-y-[1px]`
                  }
                `}
              >
                <IconComponent className={`w-4 h-4 ${isActive ? "scale-110 opacity-100" : "opacity-75"}`} />
                {tabItem.label}
              </button>
            );
          })}

          {/* Separation line for clear visual layout */}
          <div className="h-8 w-[2px] bg-slate-200 self-center mx-2 hidden xl:block" />

          {/* Desktop Right Action Panel - Side by side with Limits Manager */}
          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-1.5 bg-slate-100/80 border border-slate-200 px-2.5 py-1.5 rounded-xl shadow-inner mr-2">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Table Font:</span>
              <select
                value={tableFont}
                onChange={(e) => setTableFont(e.target.value)}
                className="text-[10px] font-black text-indigo-950 bg-transparent border-none focus:ring-0 cursor-pointer focus:outline-none uppercase"
              >
                <option value="Inter">Inter</option>
                <option value="Roboto">Roboto</option>
                <option value="Poppins">Poppins</option>
                <option value="Manrope">Manrope</option>
                <option value="IBM Plex Sans">IBM Plex</option>
                <option value="Segoe UI">Segoe UI</option>
              </select>
            </div>
            {rawData.length > 0 && (
              <button
                onClick={handleExportIndividual}
                className="glossy-btn-emerald px-4 py-2 rounded-2xl font-bold text-xs flex items-center gap-2 shadow-sm text-white"
              >
                <Download className="w-3.5 h-3.5 text-white" /> Export Styled Report
              </button>
            )}

            <div className={`text-white font-extrabold text-[11px] tracking-widest px-4 py-2 rounded-2xl select-none animate-pulse flex items-center justify-center min-w-[75px] border transition-all duration-300 ${
              rawData.length > 0 
                ? "bg-gradient-to-b from-blue-500 to-blue-700 shadow-[0_4px_10px_rgba(59,130,246,0.4),inset_0_-2px_4px_rgba(0,0,0,0.2),inset_0_2px_4px_rgba(255,255,255,0.3)] border-blue-600/50" 
                : "bg-gradient-to-b from-red-500 to-red-700 shadow-[0_4px_10px_rgba(239,68,68,0.4),inset_0_-2px_4px_rgba(0,0,0,0.2),inset_0_2px_4px_rgba(255,255,255,0.3)] border-red-600/50"
            }`}>
              READY
            </div>

            <label className="cursor-pointer glossy-btn-dark px-4 py-2.5 rounded-2xl font-bold text-xs flex items-center gap-2 select-none shadow-sm border border-slate-300 bg-slate-900 hover:bg-slate-800 text-white transition-all">
              <UploadCloud className="w-3.5 h-3.5 text-slate-300" /> Upload Excel or CSV
              <input type="file" onChange={handleFileUpload} className="hidden" accept=".xlsx, .xls, .csv" />
            </label>
          </div>
        </div>

        {/* Tab Canvas Content Blocks */}
        <div>
          
          {/* Default Upload Placement Helper */}
          {rawData.length === 0 && activeTab !== "about" && activeTab !== "guidelines" && (
            <div className="mb-6 mx-auto max-w-full bg-slate-900 border-l-4 border-amber-500 rounded-2xl p-4 shadow-md backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 rounded-xl">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-500 animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-xs font-black text-white uppercase tracking-wider">No Active Spreadsheet Data Loaded</h4>
                  <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wide mt-0.5">
                    Currently rendering structured empty template columns & rows. Please use the upload panel above to run compliance operations on actual row models.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "single" && (
            <DetailedView
              rawData={yearSeasonFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
              reportingLevel={reportingLevel}
              activeParam={activeParam}
              setActiveParam={setActiveParam}
              exportParams={exportParams}
              setExportParams={setExportParams}
              combinedParams={combinedParams}
              setCombinedParams={setCombinedParams}
              exportIndividualExceedance={exportIndividualExceedance}
              setExportIndividualExceedance={setExportIndividualExceedance}
              exportCombinedExceedance={exportCombinedExceedance}
              setExportCombinedExceedance={setExportCombinedExceedance}
              sharedBulletinMaps={sharedBulletinMaps}
              setSharedBulletinMaps={setSharedBulletinMaps}
              allRawData={rawData}
              selectedYear={selectedYear}
              selectedSeason={selectedSeason}
              layers={sharedLayers}
              setLayers={setSharedLayers}
            />
          )}

          {activeTab === "ranking" && (
            <RankingStatsView
              rawData={yearSeasonFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
            />
          )}

          {activeTab === "master" && (
            <MasterSummaryView
              rawData={yearSeasonFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
              onExportExcel={handleExportIndividual}
              reportingLevel={reportingLevel}
            />
          )}

          {activeTab === "monsoon" && (
            <MonsoonImpactView
              rawData={yearFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
            />
          )}

          {activeTab === "bar" && (
            <ComparisonsView
              rawData={yearSeasonFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
            />
          )}

          {activeTab === "aisummary" && (
            <PamphletView
              rawData={yearSeasonFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
            />
          )}

          {activeTab === "bulletin" && (
            <BulletinView
              rawData={yearFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              bulletinMaps={sharedBulletinMaps}
              setBulletinMaps={setSharedBulletinMaps}
            />
          )}

          {activeTab === "fortnightly" && (
            <FortnightlyAlertsView
              rawData={yearFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
            />
          )}

          {activeTab === "combination" && (
            <CombinationAnalysisView
              rawData={rawData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
              selectedYear={selectedYear}
              selectedSeason={selectedSeason}
              layers={sharedLayers}
            />
          )}

          {activeTab === "pca" && (
            <PcaAnalysisView
              rawData={yearSeasonFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
              showToast={showToast}
            />
          )}

          <div className={activeTab === "ussl" ? "block" : "hidden"}>
            <UsslPiperAnalysisView
              mainRawData={yearSeasonFilteredData}
              mainHeaders={headers}
              showToast={showToast}
              isVisible={activeTab === "ussl"}
              bulletinMaps={sharedBulletinMaps}
              setBulletinMaps={setSharedBulletinMaps}
              setGlobalRawData={setRawData}
              setGlobalHeaders={setHeaders}
              setGlobalHeaderMap={setHeaderMap}
            />
          </div>

          <div className={activeTab === "hydrochemistry" ? "block" : "hidden"}>
            <HydrochemistryView
              rawData={yearSeasonFilteredData}
              mainHeaders={headers}
              showToast={showToast}
              isVisible={activeTab === "hydrochemistry"}
            />
          </div>

          <div className={activeTab === "calculatorius" ? "block" : "hidden"}>
            <CalculatoriusView rawData={rawData} headerMap={headerMap} headers={headers} />
          </div>

          <div className={activeTab === "gis" ? "block" : "hidden"}>
            <GisMapView
              rawData={yearSeasonFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
              showToast={showToast}
              isVisible={activeTab === "gis"}
              bulletinMaps={sharedBulletinMaps}
              setBulletinMaps={setSharedBulletinMaps}
              layers={sharedLayers}
              setLayers={setSharedLayers}
              choroplethClasses={choroplethClasses}
              setChoroplethClasses={setChoroplethClasses}
            />
          </div>

          <div className={activeTab === "choropleth" ? "block" : "hidden"}>
            {(() => {
              const activeConfigKey = activeParam === "SAR" ? "SAR" : activeParam === "RSC" ? "RSC" : (headerMap[activeParam] || "");
              const virtualConfigs: Record<string, { b1: number; b2: number; unit: string; name: string }> = {
                SAR: { b1: 10, b2: 18, unit: "Ratio", name: "Sodium Adsorption Ratio (SAR)" },
                RSC: { b1: 1.25, b2: 2.5, unit: "meq/L", name: "Residual Sodium Carbonate (RSC)" },
                SSP: { b1: 40, b2: 60, unit: "%", name: "Soluble Sodium Percentage (SSP)" },
                "Na%": { b1: 40, b2: 60, unit: "%", name: "Sodium Percentage (%Na)" },
                PI: { b1: 25, b2: 75, unit: "%", name: "Permeability Index (PI)" },
                KR: { b1: 1.0, b2: 2.0, unit: "Ratio", name: "Kelly's Ratio (KR)" },
                MH: { b1: 50, b2: 50, unit: "%", name: "Magnesium Hazard (MH)" }
              };
              const activeConfig = PARAM_CONFIG[activeConfigKey] || PARAM_CONFIG[activeParam] || virtualConfigs[activeParam] || { b1: 0, b2: 0, unit: "units", perm: 0 };
              
              return (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-white rounded-3xl border border-slate-100 shadow-md p-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div>
                        <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                          <Map className="w-5 h-5 text-indigo-600" />
                          Groundwater Quality Choropleth Map
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                          Dynamic geospatial visualization of groundwater quality parameter compliance and permissible limit exceedances.
                        </p>
                      </div>
                      
                      {/* Parameter selector */}
                      <div className="flex items-center gap-2 bg-indigo-50/50 px-3.5 py-2 rounded-xl border border-indigo-100/50 w-full md:w-auto shrink-0">
                        <span className="text-[10px] font-black uppercase text-indigo-950 tracking-wider">
                          Active Parameter:
                        </span>
                        <select
                          value={activeParam}
                          onChange={(e) => setActiveParam(e.target.value)}
                          className="bg-white border border-indigo-200 rounded-lg p-1.5 font-bold text-xs text-indigo-800 cursor-pointer min-w-[120px] shadow-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          {(() => {
                            const baseParams = headers.params || ["pH", "TDS", "TH", "EC", "Cl", "NO3", "F"];
                            const cleanBase = baseParams.filter(p => !["Na", "K", "HCO3", "CO3"].includes(p));
                            
                            const extraMap = [
                              { value: "Alkalinity", label: "Total Alkalinity (Alkalinity)" },
                              { value: "SAR", label: "Sodium Adsorption Ratio (SAR)" },
                              { value: "RSC", label: "Residual Sodium Carbonate (RSC)" },
                              { value: "SSP", label: "Soluble Sodium Percentage (SSP)" },
                              { value: "Na%", label: "Sodium Percentage (%Na)" },
                              { value: "PI", label: "Permeability Index (PI)" },
                              { value: "KR", label: "Kelly's Ratio (KR)" },
                              { value: "MH", label: "Magnesium Hazard (MH)" },
                              { value: "TDS", label: "Total Dissolved Solids (TDS)" }
                            ];

                            const renderedValues = new Set<string>();
                            const options: React.ReactNode[] = [];

                            cleanBase.forEach(p => {
                              const match = extraMap.find(m => m.value.toLowerCase() === p.toLowerCase() || (headerMap[p] && m.value.toLowerCase() === headerMap[p].toLowerCase()));
                              const val = match ? match.value : p;
                              const label = match ? match.label : p;
                              if (!renderedValues.has(val)) {
                                renderedValues.add(val);
                                options.push(<option key={val} value={val}>{label}</option>);
                              }
                            });

                            extraMap.forEach(m => {
                              if (!renderedValues.has(m.value)) {
                                renderedValues.add(m.value);
                                options.push(<option key={m.value} value={m.value}>{m.label}</option>);
                              }
                            });

                            return options;
                          })()}
                        </select>
                      </div>
                    </div>
                  </div>

                  {rawData.length > 0 ? (
                    <GisChoroplethMap
                      rawData={yearFilteredData}
                      headers={headers}
                      headerMap={headerMap}
                      activeParam={activeParam}
                      activeConfig={activeConfig}
                      reportingLevel={reportingLevel}
                      selectedState={selectedState}
                      selectedDistrict={selectedDistrict}
                      sendToBulletin={(title, base64) => {
                        setSharedBulletinMaps((prev) => ({
                          ...prev,
                          [title]: base64,
                        }));
                      }}
                      layers={sharedLayers}
                      choroplethClasses={choroplethClasses}
                      setChoroplethClasses={setChoroplethClasses}
                      isVisible={activeTab === "choropleth"}
                    />
                  ) : (
                    <div className="bg-white rounded-3xl border border-slate-100 shadow-md p-12 text-center text-slate-400 font-bold uppercase tracking-wider">
                      No data uploaded yet. Please upload a spreadsheet to view the Choropleth Map.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {activeTab === "limits" && (
            <LimitsManagerView
              headers={headers}
              uploadedHeaders={uploadedHeaders}
              headerMap={headerMap}
              onLimitsChanged={() => setLimitsVersion((v) => v + 1)}
              onUpdateHeaders={(newHeaders, newHeaderMap) => {
                setHeaders(newHeaders);
                setHeaderMap(newHeaderMap);
                if (newHeaders.params && newHeaders.params.length > 0) {
                  setExportParams([...newHeaders.params]);
                  setCombinedParams([...newHeaders.params]);
                }
              }}
            />
          )}

          <div className={activeTab === "advancedAnalysis" ? "block" : "hidden"}>
            <AdvancedAnalysisView
              rawData={yearSeasonFilteredData}
              headers={headers}
              headerMap={headerMap}
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
              showToast={showToast}
              isVisible={activeTab === "advancedAnalysis"}
            />
          </div>

        </div>

      </div>
    </div>
  );
}

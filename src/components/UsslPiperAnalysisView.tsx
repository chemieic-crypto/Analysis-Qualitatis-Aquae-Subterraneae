import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
// @ts-ignore
import ExcelJS from "exceljs/dist/exceljs.min.js";
import {
  EQ_WEIGHTS,
  INITIAL_FACIES_NAMES,
  INITIAL_FACIES_COLORS,
  INITIAL_USSL_COLORS,
  processAquiferData,
  ProcessedSample
} from "../utils/usslMath";
import { PARAM_CONFIG } from "../data/config";
import { PiperDiagram } from "./PiperDiagram";
import { UsslDiagram } from "./UsslDiagram";
import { GibbsPlot } from "./GibbsDiagrams";
import { DonutChart } from "./UsslFaciesDonuts";
import { krigingInterpolate } from "../utils/kriging";

// Custom Phosphor style or fallback Lucide icons integration
import {
  UploadCloud,
  FileSpreadsheet,
  MapPin,
  CheckCircle,
  Table,
  BookOpen,
  Waves,
  Sun,
  Layout,
  Layers,
  Sparkles,
  Download,
  XCircle,
  TrendingUp,
  Sliders,
  Filter,
  Database,
  CircleDot
} from "lucide-react";

interface ColumnDefinition {
  id: string;
  group: string;
  label: string;
  aliases: string[];
}

const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  { id: "State", group: "Location", label: "State Name", aliases: ["state", "st"] },
  { id: "District", group: "Location", label: "District Name", aliases: ["district", "dist"] },
  { id: "Block", group: "Location", label: "Block / Tehsil", aliases: ["block", "tehsil", "taluka"] },
  { id: "Location", group: "Location", label: "Site Location Name", aliases: ["location", "village", "site", "name", "site name", "site_name"] },
  { id: "Lat", group: "Location", label: "Latitude", aliases: ["latitude", "lat", "y"] },
  { id: "Lng", group: "Location", label: "Longitude", aliases: ["longitude", "long", "lng", "x"] },

  { id: "EC", group: "Chemistry", label: "EC (μS/cm)", aliases: ["ec", "electrical conductivity", "spc", "conductivity"] },
  { id: "TDS", group: "Chemistry", label: "TDS (mg/L)", aliases: ["tds", "total dissolved solids"] },
  { id: "Ca", group: "Chemistry", label: "Calcium (Ca)", aliases: ["ca", "calcium"] },
  { id: "Mg", group: "Chemistry", label: "Magnesium (Mg)", aliases: ["mg", "magnesium"] },
  { id: "Na", group: "Chemistry", label: "Sodium (Na)", aliases: ["na", "sodium"] },
  { id: "K", group: "Chemistry", label: "Potassium (K)", aliases: ["k", "potassium"] },
  { id: "Cl", group: "Chemistry", label: "Chloride (Cl)", aliases: ["cl", "chloride"] },
  { id: "SO4", group: "Chemistry", label: "Sulphate (SO4)", aliases: ["so4", "sulphate", "sulfate"] },
  { id: "HCO3", group: "Chemistry", label: "Bicarbonate (HCO3)", aliases: ["hco3", "bicarbonate"] },
  { id: "CO3", group: "Chemistry", label: "Carbonate (CO3)", aliases: ["co3", "carbonate"] },

  { id: "Source", group: "Metadata", label: "Source Type", aliases: ["source", "type"] },
  { id: "Aquifer", group: "Metadata", label: "Aquifer Name", aliases: ["aquifer", "aq", "formation"] },
  { id: "Year", group: "Metadata", label: "Year", aliases: ["year", "yr"] },
  { id: "Season", group: "Metadata", label: "Season", aliases: ["season", "period", "monsoon"] },
];

const APP_THEMES = [
  { id: "light", name: "Light Base", bg: "bg-slate-50", text: "text-slate-900", icon: Sun, tint: "bg-slate-100" },
  { id: "nature", name: "Nature Greens", bg: "bg-emerald-50", text: "text-emerald-950", icon: Sparkles, tint: "bg-emerald-100" },
  { id: "ocean", name: "Ocean Cyan", bg: "bg-cyan-50", text: "text-cyan-950", icon: Waves, tint: "bg-cyan-100" },
  { id: "sunset", name: "Sunset Warm", bg: "bg-orange-50/60", text: "text-orange-950", icon: Sun, tint: "bg-orange-100" }
];

interface UsslPiperAnalysisViewProps {
  mainRawData?: any[];
  mainHeaders?: any;
  showToast: (msg: string, type?: "success" | "error") => void;
  isVisible: boolean;
  bulletinMaps?: Record<string, string>;
  setBulletinMaps?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  shapefileGeoJson?: any | null;
  setShapefileGeoJson?: (geo: any | null) => void;
  shapefileName?: string;
  setShapefileName?: (name: string) => void;
  setGlobalRawData?: React.Dispatch<React.SetStateAction<any[]>>;
  setGlobalHeaders?: React.Dispatch<React.SetStateAction<any>>;
  setGlobalHeaderMap?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export default function UsslPiperAnalysisView({
  mainRawData = [],
  mainHeaders = {},
  showToast,
  isVisible,
  bulletinMaps,
  setBulletinMaps,
  shapefileGeoJson: propsShapefileGeoJson,
  setShapefileGeoJson: propsSetShapefileGeoJson,
  shapefileName: propsShapefileName,
  setShapefileName: propsSetShapefileName,
  setGlobalRawData,
  setGlobalHeaders,
  setGlobalHeaderMap
}: UsslPiperAnalysisViewProps) {
  const [rawData, setRawData] = useState<any[]>([]);
  const [originalHeaders, setOriginalHeaders] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"ussl" | "piper" | "gibbs" | "aquifer_compare" | "analytics_ussl" | "analytics_facies" | "completeness" | "table">("ussl");
  const [selectedCompareAquifers, setSelectedCompareAquifers] = useState<string[]>([]);
  const [activeThemeId, setActiveThemeId] = useState("light");

  // Mapping Modal States
  const [pendingData, setPendingData] = useState<any[] | null>(null);
  const [pendingHeaders, setPendingHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [showMappingModal, setShowMappingModal] = useState(false);

  // Styling Customizer States
  const [matrixLevel, setMatrixLevel] = useState<"state" | "district" | "block">("state");

  const [faciesNames, setFaciesNames] = useState<Record<string, string>>(INITIAL_FACIES_NAMES);
  const [usslColors, setUsslColors] = useState<Record<string, string>>(INITIAL_USSL_COLORS);
  const [faciesColors, setFaciesColors] = useState<Record<string, string>>(INITIAL_FACIES_COLORS);

  const [usslSizes, setUsslSizes] = useState<Record<string, number>>(() =>
    Object.keys(INITIAL_USSL_COLORS).reduce((acc, key) => ({ ...acc, [key]: 1.3 }), {})
  );
  const [faciesSizes, setFaciesSizes] = useState<Record<string, number>>(() =>
    Object.keys(INITIAL_FACIES_COLORS).reduce((acc, key) => ({ ...acc, [key]: 1.3 }), {})
  );

  const [piperColorBy, setPiperColorBy] = useState<"facies" | "state" | "district" | "block" | "location" | "source" | "aquifer" | "year" | "season">("facies");
  const [usslColorBy, setUsslColorBy] = useState<"ussl" | "state" | "district" | "block" | "location" | "source" | "aquifer" | "year" | "season">("ussl");
  const [gibbsColorBy, setGibbsColorBy] = useState<"state" | "district" | "block" | "location" | "source" | "aquifer" | "year" | "season">("state");

  const [sourceColors, setSourceColors] = useState<Record<string, string>>({});
  const [sourceSizes, setSourceSizes] = useState<Record<string, number>>({});

  const [aquiferColors, setAquiferColors] = useState<Record<string, string>>({});
  const [aquiferSizes, setAquiferSizes] = useState<Record<string, number>>({});

  const [yearColors, setYearColors] = useState<Record<string, string>>({});
  const [yearSizes, setYearSizes] = useState<Record<string, number>>({});

  const [stateColors, setStateColors] = useState<Record<string, string>>({});
  const [stateSizes, setStateSizes] = useState<Record<string, number>>({});

  const [districtColors, setDistrictColors] = useState<Record<string, string>>({});
  const [districtSizes, setDistrictSizes] = useState<Record<string, number>>({});

  const [blockColors, setBlockColors] = useState<Record<string, string>>({});
  const [blockSizes, setBlockSizes] = useState<Record<string, number>>({});

  const [locationColors, setLocationColors] = useState<Record<string, string>>({});
  const [locationSizes, setLocationSizes] = useState<Record<string, number>>({});

  const [seasonColors, setSeasonColors] = useState<Record<string, string>>({});
  const [seasonSizes, setSeasonSizes] = useState<Record<string, number>>({});

  const [is3d, setIs3d] = useState(true);
  const [bubbleSizeMultiplier, setBubbleSizeMultiplier] = useState(2.2);

  // --- GIS Mapping States ---
  const [localShapefileGeoJson, setLocalShapefileGeoJson] = useState<any | null>(null);
  const shapefileGeoJson = propsShapefileGeoJson !== undefined ? propsShapefileGeoJson : localShapefileGeoJson;
  const setShapefileGeoJson = propsSetShapefileGeoJson || setLocalShapefileGeoJson;

  const [localShapefileName, setLocalShapefileName] = useState<string>("");
  const shapefileName = propsShapefileName !== undefined ? propsShapefileName : localShapefileName;
  const setShapefileName = propsSetShapefileName || setLocalShapefileName;
  const [activeMapTheme, setActiveMapTheme] = useState<"osm" | "satellite" | "hybrid" | "streets">("osm");
  const [showIdw, setShowIdw] = useState(true);
  const [idwParam, setIdwParam] = useState<string>("EC");
  const [idwPower, setIdwPower] = useState<number>(2.0);
  const [idwOpacity, setIdwOpacity] = useState<number>(0.65);

  const [shapefileColor, setShapefileColor] = useState<string>("#6366f1");
  const [shapefileWeight, setShapefileWeight] = useState<number>(2);

  const [mapExceedanceFilter, setMapExceedanceFilter] = useState<"all" | "any_exceedance" | "selected_exceedance">("all");
  const [mapExceedanceParam, setMapExceedanceParam] = useState<string>("pH");

  const [interpolationMethod, setInterpolationMethod] = useState<"idw" | "nearest" | "natural" | "kriging">("kriging");
  const [northArrowPos, setNorthArrowPos] = useState<"top-left" | "top-right" | "bottom-left" | "bottom-right">("top-right");

  const [legendLabelBelow, setLegendLabelBelow] = useState("Below Acceptable Limit");
  const [legendLabelBetween, setLegendLabelBetween] = useState("Between Acceptable & Permissible Limit");
  const [legendLabelAbove, setLegendLabelAbove] = useState("Above Permissible Limit");
  const [legendLabelBoundary, setLegendLabelBoundary] = useState("Boundary Shapefile Region");

  const [colorBelow, setColorBelow] = useState("#3b82f6"); // Default Blue
  const [colorBetween, setColorBetween] = useState("#fef08a"); // Default Light Yellow
  const [colorAbove, setColorAbove] = useState("#ef4444"); // Default Red
  const [smoothGradients, setSmoothGradients] = useState<boolean>(false); // For interpolation smoothness control

  const mapRef = useRef<HTMLDivElement>(null);
  const parseShapefileZipWithFallback = async (arrayBuffer: ArrayBuffer): Promise<any> => {
    return { type: "FeatureCollection", features: [] };
  };



  // Synchronize parameter selections and automate raster/point toggles
  useEffect(() => {
    const isIdwParam = ["EC", "TH", "CL", "CHLORIDE", "CL-", "CHLORID", "CL"].includes(mapExceedanceParam.toUpperCase().trim());
    if (isIdwParam) {
      setIdwParam(mapExceedanceParam);
      setShowIdw(true);
    } else {
      setShowIdw(false);
    }
  }, [mapExceedanceParam]);

  useEffect(() => {
    const isIdwParam = ["EC", "TH", "CL", "CHLORIDE", "CL-", "CHLORID", "CL"].includes(idwParam.toUpperCase().trim());
    if (isIdwParam && mapExceedanceParam !== idwParam) {
      setMapExceedanceParam(idwParam);
    }
  }, [idwParam]);

  const handleShapefileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setShapefileName(file.name);

    try {
      // Safely check and inject required global objects for browser compatibility with standard zip parsing
      if (typeof window !== "undefined") {
        if (!(window as any).global) {
          (window as any).global = window;
        }
        if (!(window as any).Buffer) {
          (window as any).Buffer = {
            isBuffer: (obj: any) => obj && !!obj._isBuffer,
            from: (data: any) => {
              if (typeof data === "string") return new TextEncoder().encode(data);
              return new Uint8Array(data);
            },
            concat: (list: any[]) => {
              let length = list.reduce((sum, item) => sum + item.length, 0);
              let result = new Uint8Array(length);
              let offset = 0;
              for (let item of list) {
                result.set(item, offset);
                offset += item.length;
              }
              return result;
            }
          };
        }
      }

      const arrayBuffer = await file.arrayBuffer();
      const geojson = await parseShapefileZipWithFallback(arrayBuffer);
      setShapefileGeoJson(geojson);
    } catch (error) {
      console.error("Failed to parse Shapefile Zip:", error);
      setShapefileGeoJson(null);
      setShapefileName("Extraction failed (Invalid shp/dbf/shx ZIP bundle)");
    }
  };

  const filterHierarchy = ["State", "District", "Block", "Location", "Source", "Aquifer", "Year", "Season"];

  const stateHeader = columnMapping.State;
  const distHeader = columnMapping.District;
  const blockHeader = columnMapping.Block;

  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({
    State: "All",
    District: "All",
    Block: "All",
    Location: "All",
    Source: "All",
    Aquifer: "All",
    Year: "All",
    Season: "All",
  });

  // Attempt to load main rawData on first mount/upload if user hasn't explicitly uploaded inside this tab
  useEffect(() => {
    if (mainRawData && mainRawData.length > 0 && rawData.length === 0) {
      // Auto map standard columns from the primary data
      const headers = Object.keys(mainRawData[0]);
      const initialMapping: Record<string, string> = {};

      COLUMN_DEFINITIONS.forEach((col) => {
        const matchedHeader = headers.find((h) => {
          return col.aliases.some((alias) => {
            try {
              return new RegExp(`\\b${alias}\\b`, "i").test(h);
            } catch {
              return h.toLowerCase() === alias.toLowerCase();
            }
          });
        });
        if (matchedHeader) initialMapping[col.id] = matchedHeader;
      });

      // Supplement any existing headers from main mapping context
      if (mainHeaders.state) initialMapping.State = mainHeaders.state;
      if (mainHeaders.district) initialMapping.District = mainHeaders.district;
      if (mainHeaders.block) initialMapping.Block = mainHeaders.block;
      if (mainHeaders.location) initialMapping.Location = mainHeaders.location;
      if (mainHeaders.latitude) initialMapping.Lat = mainHeaders.latitude;
      if (mainHeaders.longitude) initialMapping.Lng = mainHeaders.longitude;
      if (mainHeaders.year) initialMapping.Year = mainHeaders.year;
      if (mainHeaders.season) initialMapping.Season = mainHeaders.season;

      setOriginalHeaders(headers);
      setColumnMapping(initialMapping);
      setRawData(mainRawData);
    }
  }, [mainRawData, mainHeaders]);

  // Map synchronization is handled lower in the file after validData declarations

  // Adjust Matrix Reporting Level based on selection
  useEffect(() => {
    if (activeFilters.District !== "All") {
      setMatrixLevel("block");
    } else if (activeFilters.State !== "All") {
      setMatrixLevel("district");
    } else {
      setMatrixLevel("state");
    }
  }, [activeFilters.State, activeFilters.District]);

  // Handle SheetJS Upload within this module
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result as ArrayBuffer;
        if (!bstr) return;

        let wb;
        try {
          wb = XLSX.read(new Uint8Array(bstr), { type: "array" });
        } catch (readErr) {
          // Fallback: try parsing as string (for CSV text standard formats)
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(bstr);
          wb = XLSX.read(text, { type: "string" });
        }

        if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
          showToast("Uploaded sheet contains no readable sheets.", "error");
          return;
        }

        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        if (!ws) {
          showToast("Could not retrieve primary worksheet inside USSL tab.", "error");
          return;
        }

        const json: any[] = XLSX.utils.sheet_to_json(ws);

        if (json && json.length > 0) {
          const firstRow = json.find(row => row && typeof row === "object");
          if (!firstRow) {
            showToast("Sheet contains no valid object records.", "error");
            return;
          }
          const headers = Object.keys(firstRow);
          setPendingHeaders(headers);
          setPendingData(json);

          // Auto-detect mappings using strict words boundary
          const initialMapping: Record<string, string> = {};
          COLUMN_DEFINITIONS.forEach((col) => {
            const matchedHeader = headers.find((h) => {
              if (!h || typeof h !== "string") return false;
              return col.aliases.some((alias) => {
                try {
                  return new RegExp(`\\b${alias}\\b`, "i").test(h);
                } catch {
                  return h.toLowerCase() === alias.toLowerCase();
                }
              });
            });
            if (matchedHeader) initialMapping[col.id] = matchedHeader;
          });

          setColumnMapping(initialMapping);
          setShowMappingModal(true);
        } else {
          showToast("Sheet contains no readable data.", "error");
        }
      } catch (err) {
        showToast("Error parsing file inside USSL tab.", "error");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const confirmMapping = () => {
    if (pendingData) {
      setOriginalHeaders(pendingHeaders);
      setRawData(pendingData);
      setActiveFilters({ State: "All", District: "All", Block: "All", Location: "All", Source: "All", Aquifer: "All", Year: "All", Season: "All" });
      setShowMappingModal(false);
      setPendingData(null);
      showToast("USSL data columns mapped successfully!", "success");

      // Synchronize with the global application states
      if (setGlobalRawData && setGlobalHeaders && setGlobalHeaderMap) {
        const finalHeaders = {
          state: columnMapping.State || undefined,
          district: columnMapping.District || undefined,
          block: columnMapping.Block || undefined,
          location: columnMapping.Location || undefined,
          latitude: columnMapping.Lat || undefined,
          longitude: columnMapping.Lng || undefined,
          year: columnMapping.Year || undefined,
          season: columnMapping.Season || undefined,
          aquifer: columnMapping.Aquifer || undefined,
          params: [] as string[]
        };

        const finalHeaderMap: Record<string, string> = {};

        const chemParams = ["EC", "TDS", "Ca", "Mg", "Na", "K", "Cl", "SO4", "HCO3", "CO3"];
        chemParams.forEach((paramId) => {
          const excelHeader = columnMapping[paramId];
          if (excelHeader) {
            finalHeaders.params.push(excelHeader);
            finalHeaderMap[excelHeader] = paramId;
          }
        });

        setGlobalHeaders(finalHeaders);
        setGlobalHeaderMap(finalHeaderMap);
        setGlobalRawData(pendingData);
      }
    }
  };

  const filterOptions = useMemo(() => {
    const optionsMap: Record<string, string[]> = {};
    filterHierarchy.forEach((filterKey) => {
      const keyIndex = filterHierarchy.indexOf(filterKey);
      let filteredOptionsData = rawData;
      for (let i = 0; i < keyIndex; i++) {
        const parentKey = filterHierarchy[i]!;
        const parentValue = activeFilters[parentKey];
        if (parentValue !== "All") {
          const header = columnMapping[parentKey];
          if (header) {
            filteredOptionsData = filteredOptionsData.filter(
              (row) => String(row[header] || "") === String(parentValue)
            );
          }
        }
      }

      const targetHeader = columnMapping[filterKey];
      if (!targetHeader) {
        optionsMap[filterKey] = ["All"];
        return;
      }

      const values = Array.from(new Set(filteredOptionsData.map((row) => row[targetHeader]).filter(Boolean)));
      optionsMap[filterKey] = ["All", ...values.map(String).sort()];
    });
    return optionsMap;
  }, [rawData, activeFilters, columnMapping]);

  const getOptions = useCallback((filterKey: string) => {
    return filterOptions[filterKey] || ["All"];
  }, [filterOptions]);

  const handleFilterChange = (filterKey: string, newValue: string) => {
    const keyIndex = filterHierarchy.indexOf(filterKey);
    setActiveFilters((prev) => {
      const next = { ...prev, [filterKey]: newValue };
      for (let i = keyIndex + 1; i < filterHierarchy.length; i++) {
        next[filterHierarchy[i]!] = "All";
      }
      return next;
    });
  };

  // Run water chemistry math calculations
  const processedData = useMemo(() => {
    const filtered = rawData.filter((row) => {
      return Object.entries(activeFilters).every(([filterKey, filterValue]) => {
        if (filterValue === "All") return true;
        const header = columnMapping[filterKey];
        if (!header) return true;
        return String(row[header] || "") === String(filterValue);
      });
    });

    return processAquiferData(filtered, columnMapping);
  }, [rawData, activeFilters, columnMapping]);

  const allProcessedData = useMemo(() => {
    return processAquiferData(rawData, columnMapping);
  }, [rawData, columnMapping]);

  const validData = useMemo(() => processedData.filter((d) => d._calc.isComplete), [processedData]);

  // Unique Years and Seasons inside validData
  const uniqueYears = useMemo(() => {
    const header = columnMapping.Year;
    if (!header) return [];
    return Array.from(new Set(validData.map(d => String(d[header] || "")).filter(Boolean))).sort();
  }, [validData, columnMapping.Year]);

  const uniqueSeasons = useMemo(() => {
    const header = columnMapping.Season;
    if (!header) return [];
    return Array.from(new Set(validData.map(d => String(d[header] || "")).filter(Boolean))).sort();
  }, [validData, columnMapping.Season]);

  type CompareByType = "none" | "year" | "season" | "aquifer" | "source" | "location" | "block" | "district" | "state";

  // Comparison States for USSL Tab
  const [usslCompareBy, setUsslCompareBy] = useState<CompareByType>("none");
  const [usslLeftVal, setUsslLeftVal] = useState<string>("");
  const [usslRightVal, setUsslRightVal] = useState<string>("");

  // Comparison States for Piper Tab
  const [piperCompareBy, setPiperCompareBy] = useState<CompareByType>("none");
  const [piperLeftVal, setPiperLeftVal] = useState<string>("");
  const [piperRightVal, setPiperRightVal] = useState<string>("");

  const isUsslComparisonActive = usslCompareBy !== "none" && usslLeftVal && usslRightVal;
  const isPiperComparisonActive = piperCompareBy !== "none" && piperLeftVal && piperRightVal;
  const isComparisonActive = viewMode === "ussl" ? !!isUsslComparisonActive : (viewMode === "piper" ? !!isPiperComparisonActive : false);

  // Comparison States for Gibbs Tab
  const [gibbsCompareBy, setGibbsCompareBy] = useState<CompareByType>("none");
  const [gibbsLeftVal, setGibbsLeftVal] = useState<string>("");
  const [gibbsRightVal, setGibbsRightVal] = useState<string>("");

  // Extra category sets
  const uniqueAquifers = useMemo(() => {
    const header = columnMapping.Aquifer;
    if (!header) return [];
    return Array.from(new Set(validData.map(d => String(d[header] || "")).filter(Boolean))).sort();
  }, [validData, columnMapping.Aquifer]);

  const currentSelectedAquifers = useMemo(() => {
    if (selectedCompareAquifers.length > 0) {
      const filtered = selectedCompareAquifers.filter(aq => uniqueAquifers.includes(aq));
      if (filtered.length > 0) return filtered;
    }
    return uniqueAquifers.slice(0, 4);
  }, [uniqueAquifers, selectedCompareAquifers]);

  const uniqueSources = useMemo(() => {
    const header = columnMapping.Source;
    if (!header) return [];
    return Array.from(new Set(validData.map(d => String(d[header] || "")).filter(Boolean))).sort();
  }, [validData, columnMapping.Source]);

  const uniqueLocations = useMemo(() => {
    const header = columnMapping.Location;
    if (!header) return [];
    return Array.from(new Set(validData.map(d => String(d[header] || "")).filter(Boolean))).sort();
  }, [validData, columnMapping.Location]);

  const uniqueBlocks = useMemo(() => {
    const header = columnMapping.Block;
    if (!header) return [];
    return Array.from(new Set(validData.map(d => String(d[header] || "")).filter(Boolean))).sort();
  }, [validData, columnMapping.Block]);

  const uniqueDistricts = useMemo(() => {
    const header = columnMapping.District;
    if (!header) return [];
    return Array.from(new Set(validData.map(d => String(d[header] || "")).filter(Boolean))).sort();
  }, [validData, columnMapping.District]);

  const uniqueStates = useMemo(() => {
    const header = columnMapping.State;
    if (!header) return [];
    return Array.from(new Set(validData.map(d => String(d[header] || "")).filter(Boolean))).sort();
  }, [validData, columnMapping.State]);

  const getCompareOptions = useCallback((compareBy: CompareByType): string[] => {
    if (compareBy === "year") return uniqueYears;
    if (compareBy === "season") return uniqueSeasons;
    if (compareBy === "aquifer") return uniqueAquifers;
    if (compareBy === "source") return uniqueSources;
    if (compareBy === "location") return uniqueLocations;
    if (compareBy === "block") return uniqueBlocks;
    if (compareBy === "district") return uniqueDistricts;
    if (compareBy === "state") return uniqueStates;
    return [];
  }, [uniqueYears, uniqueSeasons, uniqueAquifers, uniqueSources, uniqueLocations, uniqueBlocks, uniqueDistricts, uniqueStates]);

  const getHeaderForCompareBy = useCallback((compareBy: CompareByType) => {
    if (compareBy === "year") return columnMapping.Year;
    if (compareBy === "season") return columnMapping.Season;
    if (compareBy === "aquifer") return columnMapping.Aquifer;
    if (compareBy === "source") return columnMapping.Source;
    if (compareBy === "location") return columnMapping.Location;
    if (compareBy === "block") return columnMapping.Block;
    if (compareBy === "district") return columnMapping.District;
    if (compareBy === "state") return columnMapping.State;
    return undefined;
  }, [columnMapping]);

  // Sync left and right options automatically when compare dimension changes
  useEffect(() => {
    if (usslCompareBy !== "none") {
      const opts = getCompareOptions(usslCompareBy);
      if (opts.length > 0) {
        setUsslLeftVal(opts[0] || "");
        setUsslRightVal(opts[1] || opts[0] || "");
      }
    }
  }, [usslCompareBy, getCompareOptions]);

  useEffect(() => {
    if (piperCompareBy !== "none") {
      const opts = getCompareOptions(piperCompareBy);
      if (opts.length > 0) {
        setPiperLeftVal(opts[0] || "");
        setPiperRightVal(opts[1] || opts[0] || "");
      }
    }
  }, [piperCompareBy, getCompareOptions]);

  useEffect(() => {
    if (gibbsCompareBy !== "none") {
      const opts = getCompareOptions(gibbsCompareBy);
      if (opts.length > 0) {
        setGibbsLeftVal(opts[0] || "");
        setGibbsRightVal(opts[1] || opts[0] || "");
      }
    }
  }, [gibbsCompareBy, getCompareOptions]);

  // Filtered comparison datasets
  const usslLeftData = useMemo(() => {
    if (usslCompareBy === "none" || !usslLeftVal) return validData;
    const header = getHeaderForCompareBy(usslCompareBy);
    if (!header) return validData;
    return validData.filter(d => String(d[header] || "") === usslLeftVal);
  }, [validData, usslCompareBy, usslLeftVal, getHeaderForCompareBy]);

  const usslRightData = useMemo(() => {
    if (usslCompareBy === "none" || !usslRightVal) return validData;
    const header = getHeaderForCompareBy(usslCompareBy);
    if (!header) return validData;
    return validData.filter(d => String(d[header] || "") === usslRightVal);
  }, [validData, usslCompareBy, usslRightVal, getHeaderForCompareBy]);

  const piperLeftData = useMemo(() => {
    if (piperCompareBy === "none" || !piperLeftVal) return validData;
    const header = getHeaderForCompareBy(piperCompareBy);
    if (!header) return validData;
    return validData.filter(d => String(d[header] || "") === piperLeftVal);
  }, [validData, piperCompareBy, piperLeftVal, getHeaderForCompareBy]);

  const piperRightData = useMemo(() => {
    if (piperCompareBy === "none" || !piperRightVal) return validData;
    const header = getHeaderForCompareBy(piperCompareBy);
    if (!header) return validData;
    return validData.filter(d => String(d[header] || "") === piperRightVal);
  }, [validData, piperCompareBy, piperRightVal, getHeaderForCompareBy]);

  const gibbsLeftData = useMemo(() => {
    if (gibbsCompareBy === "none" || !gibbsLeftVal) return validData;
    const header = getHeaderForCompareBy(gibbsCompareBy);
    if (!header) return validData;
    return validData.filter(d => String(d[header] || "") === gibbsLeftVal);
  }, [validData, gibbsCompareBy, gibbsLeftVal, getHeaderForCompareBy]);

  const gibbsRightData = useMemo(() => {
    if (gibbsCompareBy === "none" || !gibbsRightVal) return validData;
    const header = getHeaderForCompareBy(gibbsCompareBy);
    if (!header) return validData;
    return validData.filter(d => String(d[header] || "") === gibbsRightVal);
  }, [validData, gibbsCompareBy, gibbsRightVal, getHeaderForCompareBy]);

  const getPointKeyForMode = useCallback((d: ProcessedSample, mode: "piper" | "ussl" | "gibbs"): string => {
    const colorBy = mode === "piper" ? piperColorBy : mode === "ussl" ? usslColorBy : gibbsColorBy;
    if (colorBy === "state" && stateHeader) return String(d[stateHeader] || "Unknown");
    if (colorBy === "district" && columnMapping.District) return String(d[columnMapping.District] || "Unknown");
    if (colorBy === "block" && columnMapping.Block) return String(d[columnMapping.Block] || "Unknown");
    if (colorBy === "location" && columnMapping.Location) return String(d[columnMapping.Location] || "Unknown");
    if (colorBy === "source" && columnMapping.Source) return String(d[columnMapping.Source] || "Unknown");
    if (colorBy === "aquifer" && columnMapping.Aquifer) return String(d[columnMapping.Aquifer] || "Unknown");
    if (colorBy === "year" && columnMapping.Year) return String(d[columnMapping.Year] || "Unknown");
    if (colorBy === "season" && columnMapping.Season) return String(d[columnMapping.Season] || "Unknown");
    if (colorBy === "ussl") return d._calc.ussl;
    return d._calc.facies;
  }, [piperColorBy, usslColorBy, gibbsColorBy, stateHeader, columnMapping]);

  const getActiveColorsForMode = useCallback((mode: "piper" | "ussl" | "gibbs") => {
    const colorBy = mode === "piper" ? piperColorBy : mode === "ussl" ? usslColorBy : gibbsColorBy;
    if (colorBy === "state") return stateColors;
    if (colorBy === "district") return districtColors;
    if (colorBy === "block") return blockColors;
    if (colorBy === "location") return locationColors;
    if (colorBy === "source") return sourceColors;
    if (colorBy === "aquifer") return aquiferColors;
    if (colorBy === "year") return yearColors;
    if (colorBy === "season") return seasonColors;
    if (colorBy === "ussl") return usslColors;
    return faciesColors;
  }, [piperColorBy, usslColorBy, gibbsColorBy, stateColors, districtColors, blockColors, locationColors, sourceColors, aquiferColors, yearColors, seasonColors, usslColors, faciesColors]);

  const getActiveSizesForMode = useCallback((mode: "piper" | "ussl" | "gibbs") => {
    const colorBy = mode === "piper" ? piperColorBy : mode === "ussl" ? usslColorBy : gibbsColorBy;
    if (colorBy === "state") return stateSizes;
    if (colorBy === "district") return districtSizes;
    if (colorBy === "block") return blockSizes;
    if (colorBy === "location") return locationSizes;
    if (colorBy === "source") return sourceSizes;
    if (colorBy === "aquifer") return aquiferSizes;
    if (colorBy === "year") return yearSizes;
    if (colorBy === "season") return seasonSizes;
    if (colorBy === "ussl") return usslSizes;
    return faciesSizes;
  }, [piperColorBy, usslColorBy, gibbsColorBy, stateSizes, districtSizes, blockSizes, locationSizes, sourceSizes, aquiferSizes, yearSizes, seasonSizes, usslSizes, faciesSizes]);

  /*
  // Render and sync Leaflet Map
  useEffect(() => {
    if (viewMode !== "map" || !mapRef.current) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      return;
    }

    const latCol = columnMapping.Lat;
    const lngCol = columnMapping.Lng;
    if (!latCol || !lngCol) return;

    // Destroy to recreate cleanly
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Filter points to show by compliance
    const checkSingleExceedance = (key: string, val: number) => {
      const config = PARAM_CONFIG[key];
      if (!config) return false;
      if (key === "pH") {
        return val < config.b1 || val > config.b2;
      }
      const limit = config.b1 === config.b2 ? config.b1 : config.b2;
      return val > limit;
    };

    const checkComplianceExceedsMap = (d: any) => {
      if (mapExceedanceParam === "any") {
        // Checking for any mapped chemical exceedance
        for (const [key, c] of Object.entries(PARAM_CONFIG)) {
          const userCol = columnMapping[key];
          if (userCol) {
            const val = parseFloat((d as any)[userCol]);
            if (!isNaN(val) && checkSingleExceedance(key, val)) {
              return true;
            }
          }
        }
        return false;
      } else {
        const userCol = columnMapping[mapExceedanceParam];
        if (!userCol) return false;
        const val = parseFloat((d as any)[userCol]);
        return !isNaN(val) && checkSingleExceedance(mapExceedanceParam, val);
      }
    };

    const pointsToRender: any[] = [];
    let sumLat = 0, sumLng = 0;

    processedData.forEach((d) => {
      const lat = d._calc.lat;
      const lng = d._calc.lng;
      if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && lat !== 0 && lng !== 0) {
        const exceeds = checkComplianceExceedsMap(d);
        if (mapExceedanceFilter === "above" && !exceeds) {
          return; // skip if we only want exceedance points
        }
        pointsToRender.push({
          lat,
          lng,
          rawData: d,
          exceeds
        });
        sumLat += lat;
        sumLng += lng;
      }
    });

    const avgLat = pointsToRender.length > 0 ? sumLat / pointsToRender.length : 22.9734;
    const avgLng = pointsToRender.length > 0 ? sumLng / pointsToRender.length : 78.6569;
    const initZoom = pointsToRender.length > 0 ? 8 : 5;

    // Create the Leaflet map instance cleanly
    if (mapRef.current) {
      if ((mapRef.current as any)._leaflet_id) {
        delete (mapRef.current as any)._leaflet_id;
      }
      mapRef.current.innerHTML = "";
    }

    const map = L.map(mapRef.current!, {
      zoomControl: true,
      attributionControl: true
    }).setView([avgLat, avgLng], initZoom);

    mapInstanceRef.current = map;

    // Trigger map invalidation to force correct size calculation on mobile or transition shifts
    setTimeout(() => {
      try {
        map.invalidateSize();
      } catch (err) {}
    }, 250);

    // Mount Base Layer theme
    let tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    let attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    let subdomains = ['a', 'b', 'c'];

    if (activeMapTheme === "satellite") {
      tileUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      attribution = "Tiles &copy; Esri &mdash; Ground Resolution 1m";
      subdomains = [];
    } else if (activeMapTheme === "hybrid") {
      tileUrl = "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";
      attribution = "&copy; Google Maps Road & Satellite Hybrid";
      subdomains = ['mt0', 'mt1', 'mt2', 'mt3'];
    } else if (activeMapTheme === "streets") {
      tileUrl = "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";
      attribution = "&copy; Google Maps Standard Roads";
      subdomains = ['mt0', 'mt1', 'mt2', 'mt3'];
    }

    L.tileLayer(tileUrl, {
      attribution,
      subdomains,
      maxZoom: 22
    }).addTo(map);

    // Mount IDW Spatial Interpolation Layer if enabled
    let idwOverlay: any = null;
    if (showIdw) {
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      const pts: { lat: number; lng: number; val: number }[] = [];

      const paramColName = columnMapping[idwParam];
      allProcessedData.forEach((d) => {
        const lat = d._calc.lat;
        const lng = d._calc.lng;
        if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
          let val = NaN;
          if (paramColName) {
            val = parseFloat((d as any)[paramColName]);
          } else {
            if (idwParam === "EC") {
              val = d._calc.ecVal;
            } else if (idwParam === "TH") {
              val = parseFloat((d as any).TH || (d as any).th || (d as any)["Total Hardness"] || "0");
            }
          }
          if (!isNaN(val)) {
            pts.push({ lat, lng, val });
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
          }
        }
      });

      if (pts.length > 0) {
        // Apply padding around interpolation zone
        const latSpan = maxLat - minLat;
        const lngSpan = maxLng - minLng;
        const pad = 0.15;
        minLat = minLat - (latSpan || 0.1) * pad;
        maxLat = maxLat + (latSpan || 0.1) * pad;
        minLng = minLng - (lngSpan || 0.1) * pad;
        maxLng = maxLng + (lngSpan || 0.1) * pad;

        // Optimized high speed calculation grid (200x200 for higher precision ArcGIS/MapInfo level density)
        const resW = 200;
        const resH = 200;
        const grid: number[][] = Array.from({ length: resH }, () => new Array(resW));

        // Web Mercator projection vertical scaling to eliminate projection stretch discrepancies
        const latToMercatorY = (l: number) => {
          const rad = (l * Math.PI) / 180;
          return Math.log(Math.tan(Math.PI / 4 + rad / 2));
        };
        const mercatorYToLat = (yMerc: number) => {
          return (2 * Math.atan(Math.exp(yMerc)) - Math.PI / 2) * (180 / Math.PI);
        };

        const yMinMerc = latToMercatorY(minLat);
        const yMaxMerc = latToMercatorY(maxLat);

        for (let y = 0; y < resH; y++) {
          const cellYMerc = yMaxMerc - (y / resH) * (yMaxMerc - yMinMerc);
          const cellLat = mercatorYToLat(cellYMerc);
          for (let x = 0; x < resW; x++) {
            const cellLng = minLng + (x / resW) * (maxLng - minLng);

            let val = 0;

            if (interpolationMethod === "nearest") {
              // Feature 6: Nearest Neighbour Method
              let minDistSq = Infinity;
              for (let i = 0; i < pts.length; i++) {
                const pt = pts[i];
                const dLat = cellLat - pt.lat;
                const dLng = cellLng - pt.lng;
                const distSq = dLat * dLat + dLng * dLng;
                if (distSq < minDistSq) {
                  minDistSq = distSq;
                  val = pt.val;
                }
              }
            } else if (interpolationMethod === "natural") {
              // Highly optimized O(N) single-pass dynamic subset blender (Top 3 nearest values) with 0 memory allocation
              let m1 = Infinity, m2 = Infinity, m3 = Infinity;
              let v1 = 0, v2 = 0, v3 = 0;
              for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                const dLat = cellLat - p.lat;
                const dLng = cellLng - p.lng;
                const dSq = dLat * dLat + dLng * dLng;
                if (dSq < m1) {
                  m3 = m2; v3 = v2;
                  m2 = m1; v2 = v1;
                  m1 = dSq; v1 = p.val;
                } else if (dSq < m2) {
                  m3 = m2; v3 = v2;
                  m2 = dSq; v2 = p.val;
                } else if (dSq < m3) {
                  m3 = dSq; v3 = p.val;
                }
              }
              let exactVal = null;
              let numer = 0;
              let denom = 0;
              if (m1 < 1e-10) {
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
              val = exactVal !== null ? exactVal : (denom > 0 ? numer / denom : 0);
            } else if (interpolationMethod === "kriging") {
              const krigPts = pts.map(p => ({ lat: p.lat, lng: p.lng, val: p.val }));
              val = krigingInterpolate(cellLat, cellLng, krigPts);
            } else {
              // Classic IDW Inverse Distance Weighting
              let numer = 0;
              let denom = 0;
              let exactVal = null;

              for (let i = 0; i < pts.length; i++) {
                const pt = pts[i];
                const dLat = cellLat - pt.lat;
                const dLng = cellLng - pt.lng;
                const distSq = dLat * dLat + dLng * dLng;
                if (distSq < 1e-10) {
                  exactVal = pt.val;
                  break;
                }
                let weight = 0;
                if (idwPower === 2) {
                  weight = 1 / distSq;
                } else if (idwPower === 1) {
                  weight = 1 / Math.sqrt(distSq);
                } else if (idwPower === 3) {
                  weight = 1 / (distSq * Math.sqrt(distSq));
                } else {
                  weight = 1 / Math.pow(distSq, idwPower / 2);
                }
                numer += weight * pt.val;
                denom += weight;
              }
              val = exactVal !== null ? exactVal : (denom > 0 ? numer / denom : 0);
            }

            grid[y][x] = val;
          }
        }

        // Scaled up to 1000x1000 for extremely sharp boundaries and zero pixelation/blurriness on the map
        const finalW = 1000;
        const finalH = 1000;
        const canvas = document.createElement("canvas");
        canvas.width = finalW;
        canvas.height = finalH;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const imgData = ctx.createImageData(finalW, finalH);

          const hexToRgbLocal = (hexStr: string) => {
            const h = hexStr.replace("#", "");
            return {
              r: parseInt(h.substring(0, 2), 16),
              g: parseInt(h.substring(2, 4), 16),
              b: parseInt(h.substring(4, 6), 16)
            };
          };
          const rgbBelow = hexToRgbLocal(colorBelow);
          const rgbBetween = hexToRgbLocal(colorBetween);
          const rgbAbove = hexToRgbLocal(colorAbove);
          const cfg = PARAM_CONFIG[idwParam] || { b1: 500, b2: 2000, name: idwParam };

          const scaleX = (resW - 1) / finalW;
          const scaleY = (resH - 1) / finalH;

          for (let y = 0; y < finalH; y++) {
            const gy = y * scaleY;
            const y0 = Math.floor(gy);
            const y1 = Math.min(resH - 1, y0 + 1);
            const ty = gy - y0;
            const oneMinusTy = 1 - ty;
            const row0 = grid[y0];
            const row1 = grid[y1];

            for (let x = 0; x < finalW; x++) {
              const gx = x * scaleX;
              const x0 = Math.floor(gx);
              const x1 = Math.min(resW - 1, x0 + 1);
              const tx = gx - x0;

              const v00 = row0[x0];
              const v10 = row0[x1];
              const v01 = row1[x0];
              const v11 = row1[x1];

              const val = v00 * (1 - tx) * oneMinusTy + v10 * tx * oneMinusTy + v01 * (1 - tx) * ty + v11 * tx * ty;

              let rColor = rgbBelow.r;
              let gColor = rgbBelow.g;
              let bColor = rgbBelow.b;

              if (idwParam === "pH") {
                if (val < cfg.b1 || val > cfg.b2) {
                  rColor = rgbAbove.r;
                  gColor = rgbAbove.g;
                  bColor = rgbAbove.b;
                } else {
                  rColor = rgbBelow.r;
                  gColor = rgbBelow.g;
                  bColor = rgbBelow.b;
                }
              } else if (cfg.b1 === cfg.b2) {
                if (val <= cfg.b1) {
                  rColor = rgbBelow.r;
                  gColor = rgbBelow.g;
                  bColor = rgbBelow.b;
                } else {
                  rColor = rgbAbove.r;
                  gColor = rgbAbove.g;
                  bColor = rgbAbove.b;
                }
              } else {
                if (val < cfg.b1) {
                  rColor = rgbBelow.r;
                  gColor = rgbBelow.g;
                  bColor = rgbBelow.b;
                } else if (val <= cfg.b2) {
                  rColor = rgbBetween.r;
                  gColor = rgbBetween.g;
                  bColor = rgbBetween.b;
                } else {
                  rColor = rgbAbove.r;
                  gColor = rgbAbove.g;
                  bColor = rgbAbove.b;
                }
              }

              const idx = (y * finalW + x) * 4;
              imgData.data[idx] = rColor;
              imgData.data[idx + 1] = gColor;
              imgData.data[idx + 2] = bColor;
              imgData.data[idx + 3] = 255;
            }
          }
          ctx.putImageData(imgData, 0, 0);

            // Perform fast canvas-based clipping mask using destination-in compositing
            if (shapefileGeoJson) {
              const tx = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * finalW;
              const ty = (lat: number) => {
                const yMerc = latToMercatorY(lat);
                return (1 - (yMerc - yMinMerc) / (yMaxMerc - yMinMerc)) * finalH;
              };

              const tempCanvas = document.createElement("canvas");
              tempCanvas.width = finalW;
              tempCanvas.height = finalH;
            const tempCtx = tempCanvas.getContext("2d");

            if (tempCtx) {
              tempCtx.fillStyle = "#ffffff";

              const drawPolygon = (polygonCoords: any[][]) => {
                tempCtx.beginPath();
                polygonCoords.forEach((ring: any[]) => {
                  if (!Array.isArray(ring) || ring.length < 3) return;
                  ring.forEach((c: any, idx: number) => {
                    const x = tx(c[0]);
                    const y = ty(c[1]);
                    if (idx === 0) tempCtx.moveTo(x, y);
                    else tempCtx.lineTo(x, y);
                  });
                  tempCtx.closePath();
                });
                tempCtx.fill("evenodd");
              };

              const drawGeometry = (geom: any) => {
                if (!geom) return;
                const type = geom.type;
                const coords = geom.coordinates;
                if (!coords) return;

                if (type === "Polygon") {
                  drawPolygon(coords);
                } else if (type === "MultiPolygon") {
                  coords.forEach((poly: any) => {
                    drawPolygon(poly);
                  });
                } else if (type === "GeometryCollection" && Array.isArray(geom.geometries)) {
                  geom.geometries.forEach((g: any) => drawGeometry(g));
                }
              };

              const traverseDrawing = (node: any) => {
                if (!node) return;
                if (Array.isArray(node)) {
                  node.forEach(traverseDrawing);
                  return;
                }
                if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
                  node.features.forEach(traverseDrawing);
                } else if (node.type === "Feature") {
                  if (node.geometry) {
                    drawGeometry(node.geometry);
                  }
                } else if (node.geometry) {
                  drawGeometry(node.geometry);
                } else if (node.type === "Polygon" || node.type === "MultiPolygon" || node.type === "GeometryCollection") {
                  drawGeometry(node);
                }
              };
              traverseDrawing(shapefileGeoJson);

              ctx.globalCompositeOperation = "destination-in";
              ctx.drawImage(tempCanvas, 0, 0);
              ctx.globalCompositeOperation = "source-over"; // restore default
            }
          }

          const dataUrl = canvas.toDataURL();
          idwOverlay = L.imageOverlay(dataUrl, [[minLat, minLng], [maxLat, maxLng]], {
            opacity: idwOpacity,
            interactive: false,
            className: "crisp-interpolation-overlay"
          });
          idwOverlay.addTo(map);

          // Focus on IDW bounding area
          if (!shapefileGeoJson) {
            try {
              map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [20, 20] });
            } catch (e) {}
          }
        }
      }
    }

    // Apply Zipped Boundary shapefile if loaded
    if (shapefileGeoJson) {
      try {
        const boundaryLayer = L.geoJSON(shapefileGeoJson, {
          style: {
            color: "#6366f1",
            weight: 2,
            fillColor: "#818cf8",
            fillOpacity: 0.15
          },
          onEachFeature: (feature: any, layer: any) => {
            if (feature.properties) {
              let tbl = "<div class='p-1 max-h-[140px] overflow-y-auto custom-scrollbar text-[10px]'><strong class='block mb-1 border-b pb-1 text-slate-700 uppercase tracking-wider text-[8px]'>Boundary Metadata</strong>";
              Object.entries(feature.properties).forEach(([k, v]) => {
                tbl += `<div class='flex gap-2 py-0.5 border-b border-dashed border-slate-100'><span class='font-black text-slate-400'>\${k}:</span><span class='font-semibold text-slate-600 truncate'>\${v}</span></div>`;
              });
              tbl += "</div>";
              layer.bindPopup(tbl);
            }
          }
        });
        boundaryLayer.addTo(map);
        if (!showIdw && boundaryLayer && typeof boundaryLayer.getBounds === "function") {
          try {
            const bounds = boundaryLayer.getBounds();
            if (bounds && typeof bounds.isValid === "function" && bounds.isValid()) {
              map.fitBounds(bounds);
            } else if (bounds && bounds.getNorthEast && bounds.getSouthWest) {
              const ne = bounds.getNorthEast();
              const sw = bounds.getSouthWest();
              if (sw && ne && !isNaN(sw.lat) && !isNaN(sw.lng) && !isNaN(ne.lat) && !isNaN(ne.lng)) {
                map.fitBounds(bounds);
              }
            }
          } catch (boundErr) {
            console.warn("Cleared invalid boundary fitBounds safely:", boundErr);
          }
        }
      } catch (err) {
        console.warn("Could not load boundary shapefile layer:", err);
      }
    }

    // Plot coordinate markers
    const markersGroup = L.featureGroup();
    pointsToRender.forEach((p) => {
      const d = p.rawData;
      const exceeds = p.exceeds;

      // Map marker styling to match scatter plots & USSL diagram points!
      const pointKey = getPointKey(d);
      const color = activeColors[pointKey] || "#10b981";
      const customRadius = (activeSizes[pointKey] || 1.3) * 4.0;

      // Popups
      const usslName = d._calc.ussl;
      const faciesName = faciesNames[d._calc.facies] || d._calc.facies;
      const locName = d._calc.locName;

      let popupContent = `
        <div class="p-2 font-sans min-w-[190px]">
          <h4 class="font-black text-slate-900 border-b border-slate-200 pb-1 mb-1.5 uppercase tracking-wide text-xs flex items-center gap-1">
            📍 <span class="truncate">${locName}</span>
          </h4>
          <div class="space-y-1 text-[10px]">
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">State:</span> <span class="font-bold text-slate-700">${stateHeader ? d[stateHeader] : ""}</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">District:</span> <span class="font-bold text-slate-700">${distHeader ? d[distHeader] : ""}</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">EC Level:</span> <span class="font-mono font-bold text-teal-600">${d._calc.ecVal} μS/cm</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">SAR Value:</span> <span class="font-mono font-bold text-orange-600">${d._calc.sar.toFixed(2)}</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">% Sodium:</span> <span class="font-mono font-bold text-emerald-600">${d._calc.naPerc.toFixed(1)}%</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">Hydro-Facies:</span> <span class="font-black hover:underline" style="color: ${faciesColors[d._calc.facies] || '#475569'}">${faciesName}</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-1"><span class="text-slate-400 font-bold">USSL Class:</span> <span class="font-black hover:underline" style="color: ${usslColors[d._calc.ussl] || '#475569'}">${usslName}</span></div>
          </div>
      `;

      popupContent += `<div class='mt-1.5 pt-1.5 border-t border-slate-200 grid grid-cols-2 gap-x-1 text-[9px] gap-y-0.5 max-h-[100px] overflow-y-auto custom-scrollbar'>`;
      Object.entries(columnMapping).forEach(([k, userCol]) => {
        if (k !== "State" && k !== "District" && k !== "Block" && k !== "Location" && k !== "Lat" && k !== "Lng" && k !== "Source" && k !== "Season") {
          const val = parseFloat((d as any)[userCol as any]);
          if (!isNaN(val)) {
            const config = PARAM_CONFIG[k];
            const isExceed = checkSingleExceedance(k, val);
            popupContent += `
              <div class="flex justify-between pr-1">
                <span class="text-slate-400 font-semibold">${k}:</span>
                <span class="font-bold cursor-help ${isExceed ? "text-rose-600 animate-pulse font-extrabold" : "text-slate-750"}" title="${config?.name || k}">
                  ${val} ${config?.unit || ""}
                </span>
              </div>
            `;
          }
        }
      });
      popupContent += "</div></div>";

      const marker = L.circleMarker([p.lat, p.lng], {
        radius: customRadius,
        stroke: true,
        color: exceeds ? "#ef4444" : "#ffffff",
        weight: exceeds ? 3 : 1.5,
        opacity: exceeds ? 0.9 : 1,
        fillColor: color,
        fillOpacity: 0.95
      });

      marker.bindPopup(popupContent);
      marker.addTo(markersGroup);
    });

    markersGroup.addTo(map);

    if (pointsToRender.length > 0 && !shapefileGeoJson && !showIdw) {
      try {
        map.fitBounds(markersGroup.getBounds(), { padding: [40, 40] });
      } catch (err) {}
    }

    const handleWindowResize = () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    };
    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [
    viewMode,
    activeMapTheme,
    shapefileGeoJson,
    mapExceedanceFilter,
    mapExceedanceParam,
    colorBy,
    processedData,
    columnMapping,
    scatterColorBy,
    activeColors,
    activeSizes,
    getPointKey,
    showIdw,
    idwParam,
    idwPower,
    idwOpacity,
    leafletLoaded
  ]);
  */

  /*
  // Render and sync Active Leaflet Map (Features 1, 2, 3, 4, 5, 6, 9)
  useEffect(() => {
    if (viewMode !== "map" || !mapRef.current) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      return;
    }

    const latCol = columnMapping.Lat;
    const lngCol = columnMapping.Lng;
    if (!latCol || !lngCol) return;

    // Destroy to recreate cleanly
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const hexToRgb = (hexStr: string) => {
      const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
      const fullHex = hexStr.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);
      const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
      return res ? {
        r: parseInt(res[1], 16),
        g: parseInt(res[2], 16),
        b: parseInt(res[3], 16)
      } : { r: 59, g: 130, b: 246 };
    };

    const rgbBelow = hexToRgb(colorBelow);
    const rgbBetween = hexToRgb(colorBetween);
    const rgbAbove = hexToRgb(colorAbove);

    const lerpColor = (c1: {r: number; g: number; b: number}, c2: {r: number; g: number; b: number}, t: number) => {
      const clampedT = Math.max(0, Math.min(1, t));
      return {
        r: Math.round(c1.r + (c2.r - c1.r) * clampedT),
        g: Math.round(c1.g + (c2.g - c1.g) * clampedT),
        b: Math.round(c1.b + (c2.b - c1.b) * clampedT),
      };
    };

    const getContinuousColor = (val: number, paramKey: string): {r: number; g: number; b: number} => {
      const config = PARAM_CONFIG[paramKey];
      if (!config) return rgbBelow;

      if (paramKey === "pH") {
        const b1 = config.b1;
        const b2 = config.b2;
        const mid = (b1 + b2) / 2;
        if (val < b1) {
          const t = Math.max(0, Math.min(1, (val - (b1 - 1.0)) / 1.0));
          return lerpColor(rgbAbove, rgbBetween, t);
        } else if (val <= mid) {
          const t = (val - b1) / (mid - b1 || 1);
          return lerpColor(rgbBetween, rgbBelow, t);
        } else if (val <= b2) {
          const t = (val - mid) / (b2 - mid || 1);
          return lerpColor(rgbBelow, rgbBetween, t);
        } else {
          const t = Math.max(0, Math.min(1, (val - b2) / 1.0));
          return lerpColor(rgbBetween, rgbAbove, t);
        }
      }

      if (config.b1 === config.b2) {
        if (val <= config.b1) {
          const t = val / (config.b1 || 1);
          return lerpColor(rgbBelow, rgbBetween, t);
        } else {
          const t = Math.max(0, Math.min(1, (val - config.b1) / (config.b1 || 1)));
          return lerpColor(rgbBetween, rgbAbove, t);
        }
      }

      if (val < config.b1) {
        const t = Math.max(0, Math.min(1, val / config.b1));
        return lerpColor(rgbBelow, rgbBetween, t);
      } else if (val <= config.b2) {
        const t = Math.max(0, Math.min(1, (val - config.b1) / (config.b2 - config.b1)));
        return lerpColor(rgbBetween, rgbAbove, t);
      } else {
        return rgbAbove;
      }
    };

    const checkSingleExceedance = (key: string, val: number) => {
      const config = PARAM_CONFIG[key];
      if (!config) return false;
      if (key === "pH") {
        return val < config.b1 || val > config.b2;
      }
      const limit = config.b1 === config.b2 ? config.b1 : config.b2;
      return val > limit;
    };

    const checkComplianceExceedsMapAny = (d: any) => {
      for (const [key, c] of Object.entries(PARAM_CONFIG)) {
        const userCol = columnMapping[key];
        if (userCol) {
          const val = parseFloat((d as any)[userCol]);
          if (!isNaN(val) && checkSingleExceedance(key, val)) {
            return true;
          }
        }
      }
      return false;
    };

    const checkSelectedExceedance = (d: any) => {
      const userCol = columnMapping[mapExceedanceParam];
      if (!userCol) return false;
      const val = parseFloat((d as any)[userCol]);
      return !isNaN(val) && checkSingleExceedance(mapExceedanceParam, val);
    };

    const classifyValue = (val: number, paramKey: string): "below" | "between" | "above" => {
      const config = PARAM_CONFIG[paramKey];
      if (!config) return "below";

      if (paramKey === "pH") {
        const b1 = config.b1;
        const b2 = config.b2;
        const mid = (b1 + b2) / 2;
        if (val < b1 || val > b2) return "above";
        if (val >= mid && val <= b2) return "between";
        return "below";
      }

      if (config.b1 === config.b2) {
        if (val < config.b1 * 0.5) return "below";
        if (val <= config.b1) return "between";
        return "above";
      }

      if (val < config.b1) {
        return "below";
      } else if (val <= config.b2) {
        return "between";
      } else {
        return "above";
      }
    };

    const getPointColor = (d: any) => {
      const userCol = columnMapping[mapExceedanceParam];
      if (!userCol) return colorBelow;
      const val = parseFloat((d as any)[userCol]);
      if (isNaN(val)) return colorBelow;

      const category = classifyValue(val, mapExceedanceParam);
      if (category === "below") return colorBelow;
      if (category === "between") return colorBetween;
      return colorAbove;
    };

    const pointsToRender: any[] = [];
    let sumLat = 0, sumLng = 0;

    processedData.forEach((d) => {
      const lat = d._calc.lat;
      const lng = d._calc.lng;
      if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && lat !== 0 && lng !== 0) {
        const hasAnyExceed = checkComplianceExceedsMapAny(d);
        const hasSelectedExceed = checkSelectedExceedance(d);

        // 3. For other parameters, we ONLY show point map of locations where selected parameter is above permissible limit.
        const isIdwParam = ["EC", "TH", "CL", "CHLORIDE", "CL-", "CHLORID", "CL"].includes(mapExceedanceParam.toUpperCase().trim());
        if (!isIdwParam) {
          if (!hasSelectedExceed) {
            return;
          }
        }

        // Exceedance Filters (Feature 4 & 5)
        if (mapExceedanceFilter === "any_exceedance" && !hasAnyExceed) {
          return; // skip if we only want overall exceedance locations
        }
        if (mapExceedanceFilter === "selected_exceedance" && !hasSelectedExceed) {
          return; // skip if we only want selected parameter exceedance locations
        }

        pointsToRender.push({
          lat,
          lng,
          rawData: d,
          exceedsAny: hasAnyExceed,
          exceedsSelected: hasSelectedExceed
        });
        sumLat += lat;
        sumLng += lng;
      }
    });

    const avgLat = pointsToRender.length > 0 ? sumLat / pointsToRender.length : 22.9734;
    const avgLng = pointsToRender.length > 0 ? sumLng / pointsToRender.length : 78.6569;
    
    // Maintain persistent viewport across styling and layers toggles
    let initCenter: [number, number] = [avgLat, avgLng];
    let initZoom = pointsToRender.length > 0 ? 8 : 5;

    const isValidCoords = (lt: number, lg: number) => {
      return typeof lt === "number" && typeof lg === "number" && !isNaN(lt) && !isNaN(lg) && lt >= -90 && lt <= 90 && lg >= -180 && lg <= 180;
    };

    if (lastMapStateRef.current) {
      const savedLat = lastMapStateRef.current.center[0];
      const savedLng = lastMapStateRef.current.center[1];
      if (isValidCoords(savedLat, savedLng)) {
        initCenter = [savedLat, savedLng];
        initZoom = lastMapStateRef.current.zoom;
      }
    }

    // Create the Leaflet map instance cleanly
    if (mapRef.current) {
      if ((mapRef.current as any)._leaflet_id) {
        delete (mapRef.current as any)._leaflet_id;
      }
      mapRef.current.innerHTML = "";
    }

    const map = L.map(mapRef.current!, {
      zoomControl: true,
      attributionControl: true
    }).setView(initCenter, initZoom);

    mapInstanceRef.current = map;

    // Trigger map invalidation to force correct size calculation
    setTimeout(() => {
      try {
        map.invalidateSize();
      } catch (err) {}
    }, 250);

    // Mount Base Layer theme (Feature 2 - Layer Control)
    let tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    let attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    let subdomains = ['a', 'b', 'c'];

    if (activeMapTheme === "satellite") {
      tileUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      attribution = "Tiles &copy; Esri &mdash; Ground Resolution 1m";
      subdomains = [];
    } else if (activeMapTheme === "hybrid") {
      tileUrl = "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";
      attribution = "&copy; Google Maps Road & Satellite Hybrid";
      subdomains = ['mt0', 'mt1', 'mt2', 'mt3'];
    } else if (activeMapTheme === "streets") {
      tileUrl = "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";
      attribution = "&copy; Google Maps Standard Roads";
      subdomains = ['mt0', 'mt1', 'mt2', 'mt3'];
    }

    L.tileLayer(tileUrl, {
      attribution,
      subdomains,
      maxZoom: 22
    }).addTo(map);

    // Mount spatial Interpolation (IDW / Nearest Neighbour / Natural Neighbour Method) (Feature 6)
    let interpolationOverlay: any = null;
    if (showIdw) {
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      const pts: { lat: number; lng: number; val: number }[] = [];

      const paramColName = columnMapping[idwParam];
      allProcessedData.forEach((d) => {
        const lat = d._calc.lat;
        const lng = d._calc.lng;
        if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
          let val = NaN;
          if (paramColName) {
            val = parseFloat((d as any)[paramColName]);
          } else {
            if (idwParam === "EC") {
              val = d._calc.ecVal;
            } else if (idwParam === "TH") {
              val = parseFloat((d as any).TH || (d as any).th || (d as any)["Total Hardness"] || "0");
            }
          }
          if (!isNaN(val)) {
            pts.push({ lat, lng, val });
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
          }
        }
      });

      if (pts.length > 0) {
        // Calculate bounding box based on shapefile if loaded, otherwise fallback to points
        let boundsMinLat = 90, boundsMaxLat = -90, boundsMinLng = 180, boundsMaxLng = -180;

        if (shapefileGeoJson) {
          const extractCoords = (geom: any) => {
            if (!geom || !geom.coordinates) return;
            const flatten = (arr: any) => {
              if (!Array.isArray(arr)) return;
              if (arr.length === 2 && typeof arr[0] === "number" && typeof arr[1] === "number") {
                const [lng, lat] = arr;
                if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                  if (lat < boundsMinLat) boundsMinLat = lat;
                  if (lat > boundsMaxLat) boundsMaxLat = lat;
                  if (lng < boundsMinLng) boundsMinLng = lng;
                  if (lng > boundsMaxLng) boundsMaxLng = lng;
                }
                return;
              }
              arr.forEach((item) => flatten(item));
            };
            flatten(geom.coordinates);
          };

          const features = shapefileGeoJson.features || (shapefileGeoJson.type === "FeatureCollection" ? shapefileGeoJson.features : [shapefileGeoJson]);
          if (Array.isArray(features)) {
            features.forEach((f: any) => {
              if (f && f.geometry) extractCoords(f.geometry);
            });
          } else if (shapefileGeoJson.geometry) {
            extractCoords(shapefileGeoJson.geometry);
          }
        }

        if (boundsMinLat >= boundsMaxLat || boundsMinLng >= boundsMaxLng || isNaN(boundsMinLat) || isNaN(boundsMaxLat) || isNaN(boundsMinLng) || isNaN(boundsMaxLng) || !isFinite(boundsMinLat) || !isFinite(boundsMaxLat) || !isFinite(boundsMinLng) || !isFinite(boundsMaxLng)) {
          const latSpan = maxLat - minLat;
          const lngSpan = maxLng - minLng;
          const pad = 0.15;
          boundsMinLat = minLat - (latSpan || 0.1) * pad;
          boundsMaxLat = maxLat + (latSpan || 0.1) * pad;
          boundsMinLng = minLng - (lngSpan || 0.1) * pad;
          boundsMaxLng = maxLng + (lngSpan || 0.1) * pad;
        } else {
          const latSpan = boundsMaxLat - boundsMinLat;
          const lngSpan = boundsMaxLng - boundsMinLng;
          const pad = 0.05;
          boundsMinLat -= (latSpan || 0.1) * pad;
          boundsMaxLat += (latSpan || 0.1) * pad;
          boundsMinLng -= (lngSpan || 0.1) * pad;
          boundsMaxLng += (lngSpan || 0.1) * pad;
        }

        // Spatial aggregation for massive datasets to maintain ultra-fast, smooth calculations
        let interpolationPts = pts;
        if (pts.length > 1500) {
          const binRows = 80;
          const binCols = 80;
          const gridBins: { sumLat: number; sumLng: number; sumVal: number; count: number }[][] = 
            Array.from({ length: binRows }, () => Array.from({ length: binCols }, () => ({ sumLat: 0, sumLng: 0, sumVal: 0, count: 0 })));
          
          pts.forEach(p => {
            const latFraction = (p.lat - minLat) / (maxLat - minLat || 0.0001);
            const lngFraction = (p.lng - minLng) / (maxLng - minLng || 0.0001);
            const r = Math.max(0, Math.min(binRows - 1, Math.floor(latFraction * binRows)));
            const c = Math.max(0, Math.min(binCols - 1, Math.floor(lngFraction * binCols)));
            const cell = gridBins[r][c];
            cell.sumLat += p.lat;
            cell.sumLng += p.lng;
            cell.sumVal += p.val;
            cell.count++;
          });

          const binnedPts: { lat: number; lng: number; val: number }[] = [];
          for (let r = 0; r < binRows; r++) {
            for (let c = 0; c < binCols; c++) {
              const cell = gridBins[r][c];
              if (cell.count > 0) {
                binnedPts.push({
                  lat: cell.sumLat / cell.count,
                  lng: cell.sumLng / cell.count,
                  val: cell.sumVal / cell.count
                });
              }
            }
          }
          interpolationPts = binnedPts;
        }

        const latRange = boundsMaxLat - boundsMinLat;
        const lngRange = boundsMaxLng - boundsMinLng;

        // Optimized high speed calculation grid (300x300 for higher precision ArcGIS/MapInfo level density)
        const resW = 300;
        const resH = 300;
        const grid: number[][] = Array.from({ length: resH }, () => new Array(resW));
        const cfg = PARAM_CONFIG[idwParam] || { b1: 500, b2: 2000, name: "Default" };

        // Web Mercator projection vertical scaling to eliminate projection stretch discrepancies
        const latToMercatorY = (l: number) => {
          const clampedLat = Math.max(-85, Math.min(85, l));
          const rad = (clampedLat * Math.PI) / 180;
          return Math.log(Math.tan(Math.PI / 4 + rad / 2));
        };
        const mercatorYToLat = (yMerc: number) => {
          if (isNaN(yMerc) || !isFinite(yMerc)) return 0;
          return (2 * Math.atan(Math.exp(yMerc)) - Math.PI / 2) * (180 / Math.PI);
        };

        const yMinMerc = latToMercatorY(boundsMinLat);
        const yMaxMerc = latToMercatorY(boundsMaxLat);

        for (let y = 0; y < resH; y++) {
          const cellYMerc = yMaxMerc - ((y + 0.5) / resH) * (yMaxMerc - yMinMerc);
          const cellLat = mercatorYToLat(cellYMerc);
          for (let x = 0; x < resW; x++) {
            const cellLng = boundsMinLng + ((x + 0.5) / resW) * (boundsMaxLng - boundsMinLng);

            let val = 0;

            // Fast candidate filtering for nearest points (bounding box optimization)
            let localCandidates = interpolationPts;
            if (interpolationPts.length > 150) {
              const latDelta = latRange * 0.12;
              const lngDelta = lngRange * 0.12;
              localCandidates = interpolationPts.filter(p => 
                Math.abs(p.lat - cellLat) < latDelta && Math.abs(p.lng - cellLng) < lngDelta
              );
              if (localCandidates.length < 8) {
                localCandidates = interpolationPts; // Fallback
              }
            }

            if (interpolationMethod === "nearest") {
              // Feature 6: Nearest Neighbour Method
              let minDistSq = Infinity;
              for (let i = 0; i < localCandidates.length; i++) {
                const pt = localCandidates[i];
                const dLat = cellLat - pt.lat;
                const dLng = cellLng - pt.lng;
                const distSq = dLat * dLat + dLng * dLng;
                if (distSq < minDistSq) {
                  minDistSq = distSq;
                  val = pt.val;
                }
              }
            } else if (interpolationMethod === "natural") {
              // Highly optimized O(N) single-pass dynamic subset blender (Top 3 nearest values) with 0 memory allocation
              let m1 = Infinity, m2 = Infinity, m3 = Infinity;
              let v1 = 0, v2 = 0, v3 = 0;
              for (let i = 0; i < localCandidates.length; i++) {
                const p = localCandidates[i];
                const dLat = cellLat - p.lat;
                const dLng = cellLng - p.lng;
                const dSq = dLat * dLat + dLng * dLng;
                if (dSq < m1) {
                  m3 = m2; v3 = v2;
                  m2 = m1; v2 = v1;
                  m1 = dSq; v1 = p.val;
                } else if (dSq < m2) {
                  m3 = m2; v3 = v2;
                  m2 = dSq; v2 = p.val;
                } else if (dSq < m3) {
                  m3 = dSq; v3 = p.val;
                }
              }
              let exactVal = null;
              let numer = 0;
              let denom = 0;
              if (m1 < 1e-10) {
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
              val = exactVal !== null ? exactVal : (denom > 0 ? numer / denom : 0);
            } else if (interpolationMethod === "kriging") {
              // Ordinary Kriging Method with local candidates pre-filtered
              val = krigingInterpolate(cellLat, cellLng, localCandidates);
            } else {
              // Localized IDW with top 16 nearest neighbors for stunning local gradients and high speed
              const localK = Math.min(16, localCandidates.length);
              const neighbors = localCandidates
                .map(pt => {
                  const dLat = cellLat - pt.lat;
                  const dLng = cellLng - pt.lng;
                  const distSq = dLat * dLat + dLng * dLng;
                  return { pt, distSq };
                })
                .sort((a, b) => a.distSq - b.distSq)
                .slice(0, localK);

              let numer = 0;
              let denom = 0;
              let exactVal = null;

              for (let i = 0; i < neighbors.length; i++) {
                const item = neighbors[i];
                if (item.distSq < 1e-10) {
                  exactVal = item.pt.val;
                  break;
                }
                let weight = 0;
                if (idwPower === 2) {
                  weight = 1 / item.distSq;
                } else if (idwPower === 1) {
                  weight = 1 / Math.sqrt(item.distSq);
                } else if (idwPower === 3) {
                  weight = 1 / (item.distSq * Math.sqrt(item.distSq));
                } else {
                  weight = 1 / Math.pow(item.distSq, idwPower / 2);
                }
                numer += weight * item.pt.val;
                denom += weight;
              }
              val = exactVal !== null ? exactVal : (denom > 0 ? numer / denom : 0);
            }

            grid[y][x] = val;
          }
        }

        // Scaled up to 1000x1000 for extremely sharp boundaries and zero pixelation/blurriness on the map
        const finalW = 1000;
        const finalH = 1000;
        const canvas = document.createElement("canvas");
        canvas.width = finalW;
        canvas.height = finalH;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const imgData = ctx.createImageData(finalW, finalH);

          const scaleX = (resW - 1) / finalW;
          const scaleY = (resH - 1) / finalH;

          for (let y = 0; y < finalH; y++) {
            const gy = y * scaleY;
            const y0 = Math.floor(gy);
            const y1 = Math.min(resH - 1, y0 + 1);
            const ty = gy - y0;
            const oneMinusTy = 1 - ty;
            const row0 = grid[y0] || grid[0] || [];
            const row1 = grid[y1] || grid[0] || [];

            for (let x = 0; x < finalW; x++) {
              const gx = x * scaleX;
              const x0 = Math.floor(gx);
              const x1 = Math.min(resW - 1, x0 + 1);
              const tx = gx - x0;

              const v00 = row0[x0] !== undefined ? row0[x0] : 0;
              const v10 = row0[x1] !== undefined ? row0[x1] : 0;
              const v01 = row1[x0] !== undefined ? row1[x0] : 0;
              const v11 = row1[x1] !== undefined ? row1[x1] : 0;

              const val = v00 * (1 - tx) * oneMinusTy + v10 * tx * oneMinusTy + v01 * (1 - tx) * ty + v11 * tx * ty;

              const c = getContinuousColor(val, idwParam);

              const idx = (y * finalW + x) * 4;
              imgData.data[idx] = c.r;
              imgData.data[idx + 1] = c.g;
              imgData.data[idx + 2] = c.b;
              imgData.data[idx + 3] = 255;
            }
          }
          ctx.putImageData(imgData, 0, 0);

            // Perform fast canvas-based clipping mask using destination-in compositing
            if (shapefileGeoJson) {
              const lngDiff = (boundsMaxLng - boundsMinLng) || 0.00001;
              const yMercDiff = (yMaxMerc - yMinMerc) || 0.00001;
              const tx = (lng: number) => {
                if (typeof lng !== "number" || isNaN(lng)) return 0;
                return ((lng - boundsMinLng) / lngDiff) * finalW;
              };
              const ty = (lat: number) => {
                if (typeof lat !== "number" || isNaN(lat)) return 0;
                const yMerc = latToMercatorY(lat);
                return (1 - (yMerc - yMinMerc) / yMercDiff) * finalH;
              };

              const tempCanvas = document.createElement("canvas");
              tempCanvas.width = finalW;
              tempCanvas.height = finalH;
              const tempCtx = tempCanvas.getContext("2d");

              if (tempCtx) {
                tempCtx.fillStyle = "#ffffff";

                const drawPolygon = (polygonCoords: any[][]) => {
                  if (!Array.isArray(polygonCoords)) return;
                  tempCtx.beginPath();
                  polygonCoords.forEach((ring: any[]) => {
                    if (!Array.isArray(ring) || ring.length < 3) return;
                    ring.forEach((c: any, idx: number) => {
                      if (!Array.isArray(c) || c.length < 2) return;
                      const x = tx(c[0]);
                      const y = ty(c[1]);
                      if (idx === 0) tempCtx.moveTo(x, y);
                      else tempCtx.lineTo(x, y);
                    });
                    tempCtx.closePath();
                  });
                  tempCtx.fill("evenodd");
                };

                const drawGeometry = (geom: any) => {
                  if (!geom) return;
                  const type = geom.type;
                  const coords = geom.coordinates;
                  if (!coords) return;

                  if (type === "Polygon") {
                    drawPolygon(coords);
                  } else if (type === "MultiPolygon") {
                    coords.forEach((poly: any) => {
                      drawPolygon(poly);
                    });
                  } else if (type === "GeometryCollection" && Array.isArray(geom.geometries)) {
                    geom.geometries.forEach((g: any) => drawGeometry(g));
                  }
                };

                const features = shapefileGeoJson.features || (shapefileGeoJson.type === "FeatureCollection" ? shapefileGeoJson.features : [shapefileGeoJson]);
                if (Array.isArray(features)) {
                  features.forEach((f: any) => {
                    if (f && f.geometry) drawGeometry(f.geometry);
                  });
                } else if (shapefileGeoJson.geometry) {
                  drawGeometry(shapefileGeoJson.geometry);
                }

                ctx.globalCompositeOperation = "destination-in";
                ctx.drawImage(tempCanvas, 0, 0);
                ctx.globalCompositeOperation = "source-over"; // restore default
              }
            }

            const dataUrl = canvas.toDataURL();
            interpolationOverlay = L.imageOverlay(dataUrl, [[boundsMinLat, boundsMinLng], [boundsMaxLat, boundsMaxLng]], {
              opacity: idwOpacity,
              interactive: false,
              className: smoothGradients ? "smooth-interpolation-overlay" : "crisp-interpolation-overlay"
            });
            interpolationOverlay.addTo(map);

            if (!shapefileGeoJson) {
              try {
                map.fitBounds([[boundsMinLat, boundsMinLng], [boundsMaxLat, boundsMaxLng]], { padding: [20, 20] });
              } catch (e) {}
            }
          }
        }
      }

    // Apply Zipped Boundary shapefile if loaded (Feature 3 - shapefile color and thickness control)
    if (shapefileGeoJson) {
      try {
        const boundaryLayer = L.geoJSON(shapefileGeoJson, {
          style: {
            color: shapefileColor,
            weight: shapefileWeight,
            fillColor: shapefileColor,
            fillOpacity: 0.12
          },
          onEachFeature: (feature: any, layer: any) => {
            if (feature.properties) {
              let tbl = "<div class='p-1 max-h-[140px] overflow-y-auto custom-scrollbar text-[10px]'><strong class='block mb-1 border-b pb-1 text-slate-700 uppercase tracking-wider text-[8px]'>Boundary Metadata</strong>";
              Object.entries(feature.properties).forEach(([k, v]) => {
                tbl += `<div class='flex gap-2 py-0.5 border-b border-dashed border-slate-100'><span class='font-black text-slate-400'>${k}:</span><span class='font-semibold text-slate-600 truncate'>${v}</span></div>`;
              });
              tbl += "</div>";
              layer.bindPopup(tbl);
            }
          }
        });
        boundaryLayer.addTo(map);
        if (!showIdw && boundaryLayer && typeof boundaryLayer.getBounds === "function") {
          try {
            const bounds = boundaryLayer.getBounds();
            if (bounds && typeof bounds.isValid === "function" && bounds.isValid()) {
              map.fitBounds(bounds);
            } else if (bounds && bounds.getNorthEast && bounds.getSouthWest) {
              const ne = bounds.getNorthEast();
               const sw = bounds.getSouthWest();
               if (sw && ne && !isNaN(sw.lat) && !isNaN(sw.lng) && !isNaN(ne.lat) && !isNaN(ne.lng)) {
                 map.fitBounds(bounds);
               }
            }
          } catch (boundErr) {
            console.warn("Cleared invalid boundary fitBounds safely:", boundErr);
          }
        }
      } catch (err) {
        console.warn("Could not load boundary shapefile layer:", err);
      }
    }

    // Plot coordinate markers with dynamic color-limit associations (Feature 1 & Feature 9)
    const markersGroup = L.featureGroup();
    pointsToRender.forEach((p) => {
      const d = p.rawData;
      const isExceededSelected = p.exceedsSelected;

      // Map marker dynamic custom color bands (Feature 9)
      const color = getPointColor(d);
      const customRadius = 4.5; // compact elegant touch size

      const usslName = d._calc.ussl;
      const faciesName = faciesNames[d._calc.facies] || d._calc.facies;
      const locName = d._calc.locName;

      let popupContent = `
        <div class="p-2 font-sans min-w-[210px] max-w-[280px]">
          <h4 class="font-black text-slate-900 border-b border-slate-200 pb-1 mb-1.5 uppercase tracking-wide text-xs flex items-center gap-1">
            📍 <span class="truncate">${locName}</span>
          </h4>
          <div class="space-y-1 text-[10px]">
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">State:</span> <span class="font-bold text-slate-700">${stateHeader ? d[stateHeader] : ""}</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">District:</span> <span class="font-bold text-slate-700">${distHeader ? d[distHeader] : ""}</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">EC Level:</span> <span class="font-mono font-bold text-teal-600">${d._calc.ecVal} μS/cm</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">SAR Value:</span> <span class="font-mono font-bold text-orange-600">${d._calc.sar.toFixed(2)}</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-0.5"><span class="text-slate-400 font-bold">% Sodium:</span> <span class="font-mono font-bold text-emerald-600">${d._calc.naPerc.toFixed(1)}%</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-1"><span class="text-slate-400 font-bold">Hydro-Facies:</span> <span class="font-black hover:underline text-indigo-750">${faciesName}</span></div>
            <div class="flex justify-between border-b border-slate-50 pb-1"><span class="text-slate-400 font-bold">USSL Class:</span> <span class="font-black hover:underline text-teal-800">${usslName}</span></div>
          </div>
      `;

      popupContent += `<div class='mt-1.5 pt-1.5 border-t border-slate-200 grid grid-cols-2 gap-x-2 text-[9px] gap-y-0.5 max-h-[110px] overflow-y-auto custom-scrollbar'>`;
      Object.entries(columnMapping).forEach(([k, userCol]) => {
        if (k !== "State" && k !== "District" && k !== "Block" && k !== "Location" && k !== "Lat" && k !== "Lng" && k !== "Source" && k !== "Season") {
          const val = parseFloat((d as any)[userCol as any]);
          if (!isNaN(val)) {
            const config = PARAM_CONFIG[k];
            const isExceed = checkSingleExceedance(k, val);
            popupContent += `
              <div class="flex justify-between pr-1 border-b border-slate-100/40">
                <span class="text-slate-400 font-semibold">${k}:</span>
                <span class="font-bold ${isExceed ? "text-rose-600 font-black animate-pulse" : "text-slate-750"}" title="${config?.name || k}">
                  ${val}
                </span>
              </div>
            `;
          }
        }
      });
      popupContent += "</div></div>";

      // Highlight point ring if exceeds selected or has any exceedance
      const ringColor = isExceededSelected ? colorAbove : "#ffffff";
      const ringWeight = isExceededSelected ? 3 : 1.5;

      const marker = L.circleMarker([p.lat, p.lng], {
        radius: customRadius,
        stroke: true,
        color: ringColor,
        weight: ringWeight,
        opacity: 0.95,
        fillColor: color,
        fillOpacity: 0.92
      });

      marker.bindPopup(popupContent);
      marker.addTo(markersGroup);
    });

    markersGroup.addTo(map);

    if (pointsToRender.length > 0 && !shapefileGeoJson && !showIdw && !lastMapStateRef.current) {
      try {
        map.fitBounds(markersGroup.getBounds(), { padding: [40, 40] });
      } catch (err) {}
    }

    const handleWindowResize = () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    };
    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      if (mapInstanceRef.current) {
        try {
          const center = mapInstanceRef.current.getCenter();
          if (center && typeof center.lat === "number" && typeof center.lng === "number" && !isNaN(center.lat) && !isNaN(center.lng)) {
            lastMapStateRef.current = {
              center: [center.lat, center.lng],
              zoom: mapInstanceRef.current.getZoom()
            };
          }
        } catch (e) {}
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [
    viewMode,
    activeMapTheme,
    shapefileGeoJson,
    shapefileColor,
    shapefileWeight,
    mapExceedanceFilter,
    mapExceedanceParam,
    showIdw,
    idwParam,
    idwPower,
    idwOpacity,
    interpolationMethod,
    smoothGradients,
    colorBelow,
    colorBetween,
    colorAbove,
    processedData,
    allProcessedData,
    columnMapping,
    leafletLoaded
  ]);
  */

  // Establish state palettes automatically
  useEffect(() => {
    if (!stateHeader || validData.length === 0) return;
    const headerKey = stateHeader as string;
    const uniqueStates: string[] = Array.from(
      new Set(validData.map((d) => String(d[headerKey] || "Unknown")))
    );
    const defaultPalette = ["#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981", "#ef4444", "#3b82f6", "#14b8a6", "#f97316", "#64748b"];

    setStateColors((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueStates.forEach((s, i) => {
        if (!next[s]) {
          next[s] = defaultPalette[i % defaultPalette.length]!;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setStateSizes((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueStates.forEach((s) => {
        if (!next[s]) {
          next[s] = 1.3;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [validData, stateHeader]);

  // Establish district palettes automatically
  useEffect(() => {
    const distHeader = columnMapping.District;
    if (!distHeader || validData.length === 0) return;
    const headerKey = distHeader as string;
    const uniqueDists = Array.from(
      new Set(validData.map((d) => String(d[headerKey] || "Unknown")))
    ) as string[];
    const defaultPalette = ["#06b6d4", "#ec4899", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#14b8a6", "#f97316", "#64748b"];

    setDistrictColors((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueDists.forEach((s, i) => {
        if (!next[s]) {
          next[s] = defaultPalette[i % defaultPalette.length]!;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setDistrictSizes((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueDists.forEach((s) => {
        if (!next[s]) {
          next[s] = 1.3;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [validData, columnMapping.District]);

  // Establish block palettes automatically
  useEffect(() => {
    const blockHeader = columnMapping.Block;
    if (!blockHeader || validData.length === 0) return;
    const headerKey = blockHeader as string;
    const uniqueBlocks = Array.from(
      new Set(validData.map((d) => String(d[headerKey] || "Unknown")))
    ) as string[];
    const defaultPalette = ["#10b981", "#f97316", "#3b82f6", "#ec4899", "#8b5cf6", "#06b6d4", "#f59e0b", "#ef4444", "#14b8a6", "#64748b"];

    setBlockColors((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueBlocks.forEach((s, i) => {
        if (!next[s]) {
          next[s] = defaultPalette[i % defaultPalette.length]!;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setBlockSizes((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueBlocks.forEach((s) => {
        if (!next[s]) {
          next[s] = 1.3;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [validData, columnMapping.Block]);

  // Establish location palettes automatically
  useEffect(() => {
    const locHeader = columnMapping.Location;
    if (!locHeader || validData.length === 0) return;
    const headerKey = locHeader as string;
    const uniqueLocs = Array.from(
      new Set(validData.map((d) => String(d[headerKey] || "Unknown")))
    ) as string[];
    const defaultPalette = ["#3b82f6", "#14b8a6", "#ef4444", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981", "#f97316", "#64748b"];

    setLocationColors((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueLocs.forEach((s, i) => {
        if (!next[s]) {
          next[s] = defaultPalette[i % defaultPalette.length]!;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setLocationSizes((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueLocs.forEach((s) => {
        if (!next[s]) {
          next[s] = 1.3;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [validData, columnMapping.Location]);

  // Establish season palettes automatically
  useEffect(() => {
    const seasonHeader = columnMapping.Season;
    if (!seasonHeader || validData.length === 0) return;
    const headerKey = seasonHeader as string;
    const uniqueSeasons = Array.from(
      new Set(validData.map((d) => String(d[headerKey] || "Unknown")))
    ) as string[];
    const defaultPalette = ["#ea580c", "#0891b2", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#14b8a6", "#ec4899", "#64748b"];

    setSeasonColors((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueSeasons.forEach((s, i) => {
        if (!next[s]) {
          next[s] = defaultPalette[i % defaultPalette.length]!;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setSeasonSizes((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueSeasons.forEach((s) => {
        if (!next[s]) {
          next[s] = 1.3;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [validData, columnMapping.Season]);

  // Establish source palettes automatically
  useEffect(() => {
    const sourceHeader = columnMapping.Source;
    if (!sourceHeader || validData.length === 0) return;
    const headerKey = sourceHeader as string;
    const uniqueSources = Array.from(
      new Set(validData.map((d) => String(d[headerKey] || "Unknown")))
    ) as string[];
    const defaultPalette = ["#84cc16", "#e11d48", "#4f46e5", "#06b6d4", "#f59e0b", "#ec4899", "#10b981", "#ef4444", "#3b82f6", "#64748b"];

    setSourceColors((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueSources.forEach((s, i) => {
        if (!next[s]) {
          next[s] = defaultPalette[i % defaultPalette.length]!;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setSourceSizes((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueSources.forEach((s) => {
        if (!next[s]) {
          next[s] = 1.3;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [validData, columnMapping.Source]);

  // Establish aquifer palettes automatically
  useEffect(() => {
    const aquiferHeader = columnMapping.Aquifer;
    if (!aquiferHeader || validData.length === 0) return;
    const headerKey = aquiferHeader as string;
    const uniqueAquifers = Array.from(
      new Set(validData.map((d) => String(d[headerKey] || "Unknown")))
    ) as string[];
    const defaultPalette = ["#0284c7", "#f43f5e", "#a855f7", "#eab308", "#10b981", "#ff7849", "#7e5bef", "#ffc82c", "#2780e3", "#64748b"];

    setAquiferColors((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueAquifers.forEach((s, i) => {
        if (!next[s]) {
          next[s] = defaultPalette[i % defaultPalette.length]!;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setAquiferSizes((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueAquifers.forEach((s) => {
        if (!next[s]) {
          next[s] = 1.3;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [validData, columnMapping.Aquifer]);

  // Establish year palettes automatically
  useEffect(() => {
    const yearHeader = columnMapping.Year;
    if (!yearHeader || validData.length === 0) return;
    const headerKey = yearHeader as string;
    const uniqueYearsVal = Array.from(
      new Set(validData.map((d) => String(d[headerKey] || "Unknown")))
    ) as string[];
    const defaultPalette = ["#6d28d9", "#be185d", "#0369a1", "#15803d", "#b45309", "#a21caf", "#115e59", "#9a3412", "#451a03", "#64748b"];

    setYearColors((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueYearsVal.forEach((s, i) => {
        if (!next[s]) {
          next[s] = defaultPalette[i % defaultPalette.length]!;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setYearSizes((prev) => {
      const next = { ...prev };
      let changed = false;
      uniqueYearsVal.forEach((s) => {
        if (!next[s]) {
          next[s] = 1.3;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [validData, columnMapping.Year]);

  // Aggregate stats counts to render donut panels
  const stats = useMemo(() => {
    const uCounts: Record<string, number> = {};
    const fCounts: Record<string, number> = {};
    const sCounts: Record<string, number> = {};

    validData.forEach((d) => {
      uCounts[d._calc.ussl] = (uCounts[d._calc.ussl] || 0) + 1;
      fCounts[d._calc.facies] = (fCounts[d._calc.facies] || 0) + 1;
      if (stateHeader) {
        const sName = String(d[stateHeader] || "Unknown");
        sCounts[sName] = (sCounts[sName] || 0) + 1;
      }
    });

    return {
      ussl: Object.entries(uCounts).map(([key, count]) => ({ key, name: key, count })).sort((a, b) => b.count - a.count),
      facies: Object.entries(fCounts).map(([key, count]) => ({ key, name: faciesNames[key] || key, count })).sort((a, b) => b.count - a.count),
      states: Object.entries(sCounts).map(([key, count]) => ({ key, name: key, count })).sort((a, b) => b.count - a.count)
    };
  }, [validData, faciesNames, stateHeader]);

  // Comparison mode stats
  const leftStats = useMemo(() => {
    const dataToUse = viewMode === "ussl" ? usslLeftData : piperLeftData;
    const uCounts: Record<string, number> = {};
    const fCounts: Record<string, number> = {};

    dataToUse.forEach((d) => {
      uCounts[d._calc.ussl] = (uCounts[d._calc.ussl] || 0) + 1;
      fCounts[d._calc.facies] = (fCounts[d._calc.facies] || 0) + 1;
    });

    return {
      ussl: Object.entries(uCounts).map(([key, count]) => ({ key, name: key, count })).sort((a, b) => b.count - a.count),
      facies: Object.entries(fCounts).map(([key, count]) => ({ key, name: faciesNames[key] || key, count })).sort((a, b) => b.count - a.count)
    };
  }, [usslLeftData, piperLeftData, viewMode, faciesNames]);

  const rightStats = useMemo(() => {
    const dataToUse = viewMode === "ussl" ? usslRightData : piperRightData;
    const uCounts: Record<string, number> = {};
    const fCounts: Record<string, number> = {};

    dataToUse.forEach((d) => {
      uCounts[d._calc.ussl] = (uCounts[d._calc.ussl] || 0) + 1;
      fCounts[d._calc.facies] = (fCounts[d._calc.facies] || 0) + 1;
    });

    return {
      ussl: Object.entries(uCounts).map(([key, count]) => ({ key, name: key, count })).sort((a, b) => b.count - a.count),
      facies: Object.entries(fCounts).map(([key, count]) => ({ key, name: faciesNames[key] || key, count })).sort((a, b) => b.count - a.count)
    };
  }, [usslRightData, piperRightData, viewMode, faciesNames]);

  const comparisonTableData = useMemo(() => {
    const leftList = viewMode === "ussl" ? leftStats.ussl : leftStats.facies;
    const rightList = viewMode === "ussl" ? rightStats.ussl : rightStats.facies;

    // Union of all keys
    const allKeys = Array.from(new Set([
      ...leftList.map(item => item.key),
      ...rightList.map(item => item.key)
    ]));

    const leftTotal = leftList.reduce((sum, item) => sum + item.count, 0);
    const rightTotal = rightList.reduce((sum, item) => sum + item.count, 0);

    return allKeys.map(key => {
      const leftItem = leftList.find(item => item.key === key);
      const rightItem = rightList.find(item => item.key === key);
      
      const leftCount = leftItem ? leftItem.count : 0;
      const rightCount = rightItem ? rightItem.count : 0;

      const leftPct = leftTotal > 0 ? (leftCount / leftTotal) * 100 : 0;
      const rightPct = rightTotal > 0 ? (rightCount / rightTotal) * 100 : 0;

      const name = viewMode === "ussl" ? key : (faciesNames[key] || key);

      return {
        key,
        name,
        leftCount,
        leftPct,
        rightCount,
        rightPct
      };
    }).sort((a, b) => b.leftCount + b.rightCount - (a.leftCount + a.rightCount));
  }, [leftStats, rightStats, viewMode, faciesNames]);

  // Custom matrices calculation
  const analytics = useMemo(() => {
    const sHeader = columnMapping.State;
    const dHeader = columnMapping.District;
    const bHeader = columnMapping.Block;

    const buildSummary = (keyHeader: string | undefined, dataset: any[], isCompleteness: boolean) => {
      if (!keyHeader) return [];
      const map: Record<string, any> = {};

      dataset.forEach((d) => {
        const key = d[keyHeader] ? String(d[keyHeader]) : "Unknown";
        if (!map[key]) {
          map[key] = {
            name: key,
            state: sHeader ? String(d[sHeader] || "-") : "-",
            district: dHeader ? String(d[dHeader] || "-") : "-",
            total: 0,
            ussl: {},
            facies: {},
            validUSSL: 0,
            validFacies: 0,
            validGibbs: 0,
            complete: 0
          };
        }
        map[key].total++;

        if (isCompleteness) {
          if (d._calc.hasUSSL) map[key].validUSSL++;
          if (d._calc.hasFacies) map[key].validFacies++;
          if (d._calc.hasGibbs) map[key].validGibbs++;
          if (d._calc.isComplete) map[key].complete++;
        } else {
          map[key].ussl[d._calc.ussl] = (map[key].ussl[d._calc.ussl] || 0) + 1;
          map[key].facies[d._calc.facies] = (map[key].facies[d._calc.facies] || 0) + 1;
        }
      });

      return Object.values(map).sort((a, b) => b.total - a.total).map((row) => {
        const rowData: Record<string, any> = { Name: row.name, State: row.state, District: row.district, Total: row.total };

        if (isCompleteness) {
          rowData.validUSSL_count = row.validUSSL;
          rowData.validUSSL_perc = row.total ? Number(((row.validUSSL / row.total) * 100).toFixed(1)) : 0;
          rowData.validFacies_count = row.validFacies;
          rowData.validFacies_perc = row.total ? Number(((row.validFacies / row.total) * 100).toFixed(1)) : 0;
          rowData.validGibbs_count = row.validGibbs;
          rowData.validGibbs_perc = row.total ? Number(((row.validGibbs / row.total) * 100).toFixed(1)) : 0;
          rowData.complete_count = row.complete;
          rowData.complete_perc = row.total ? Number(((row.complete / row.total) * 100).toFixed(1)) : 0;
        } else {
          stats.ussl.forEach((s) => {
            const count = row.ussl[s.key] || 0;
            rowData[`${s.key}_count`] = count;
            rowData[`${s.key}_perc`] = row.total ? Number(((count / row.total) * 100).toFixed(1)) : 0;
          });

          stats.facies.forEach((s) => {
            const count = row.facies[s.key] || 0;
            rowData[`${s.key}_count`] = count;
            rowData[`${s.key}_perc`] = row.total ? Number(((count / row.total) * 100).toFixed(1)) : 0;
          });
        }
        return rowData;
      });
    };

    return {
      state: buildSummary(sHeader, validData, false),
      district: buildSummary(dHeader, validData, false),
      block: buildSummary(bHeader, validData, false),
      comp_state: buildSummary(sHeader, processedData, true),
      comp_district: buildSummary(dHeader, processedData, true),
      comp_block: buildSummary(bHeader, processedData, true)
    };
  }, [processedData, validData, stats]);

  // ExcelJS Export Module
  const exportExcel = async () => {
    if (!validData.length) {
      showToast("There is no completed data to write.", "error");
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Valid Data Report");

    const ions = ["Ca", "Mg", "Na", "K", "Cl", "SO4", "HCO3", "CO3"];
    const additionalCols = [
      { header: "SAR Value", key: "sar" },
      { header: "Sodium Percentage (%Na)", key: "naPerc" },
      { header: "USSL Class", key: "ussl" },
      { header: "Hydrochemical Facies", key: "facies" },
      ...ions.map((ion) => ({ header: `${ion} (meq/l)`, key: `meq_${ion}` })),
      ...ions.map((ion) => ({ header: `${ion} (% meq)`, key: `meqPerc_${ion}` }))
    ];

    ws.columns = [
      { header: "SL", key: "sl" },
      ...originalHeaders.map((h) => ({ header: h, key: h })),
      ...additionalCols
    ];

    validData.forEach((item) => {
      const rowObj: Record<string, any> = { sl: item._calc.sl };

      originalHeaders.forEach((h) => {
        const val = item[h];
        if (typeof val === "string" && val.trim() !== "" && !isNaN(Number(val))) {
          rowObj[h] = Number(val);
        } else {
          rowObj[h] = val;
        }
      });

      rowObj.sar = Number(item._calc.sar.toFixed(2));
      rowObj.naPerc = Number(item._calc.naPerc.toFixed(1));
      rowObj.ussl = item._calc.ussl;
      rowObj.facies = faciesNames[item._calc.facies] || item._calc.facies;

      ions.forEach((ion) => {
        rowObj[`meq_${ion}`] = item._calc.meq[ion as keyof typeof EQ_WEIGHTS]
          ? Number(item._calc.meq[ion as keyof typeof EQ_WEIGHTS].toFixed(4))
          : 0;
        rowObj[`meqPerc_${ion}`] = item._calc.meqPerc[ion as keyof typeof EQ_WEIGHTS]
          ? Number(item._calc.meqPerc[ion as keyof typeof EQ_WEIGHTS].toFixed(2))
          : 0;
      });

      ws.addRow(rowObj);
    });

    const usslCols = stats.ussl.flatMap((s) => [
      { header: `${s.name} (Count)`, key: `${s.key}_count`, width: 15 },
      { header: `${s.name} (%)`, key: `${s.key}_perc`, width: 10 }
    ]);
    const faciesCols = stats.facies.flatMap((s) => [
      { header: `${s.name} (Count)`, key: `${s.key}_count`, width: 35 },
      { header: `${s.name} (%)`, key: `${s.key}_perc`, width: 10 }
    ]);

    const safeString = (val: any) => String(val || "");

    const generateTotalRow = (dataRows: any[], categoryStats: any[], level: string) => {
      const totalObj: Record<string, any> = {};
      if (level === "state") totalObj.Name = "GRAND TOTAL";
      else totalObj.State = "GRAND TOTAL";

      const grandTotal = dataRows.reduce((sum, row) => sum + (row.Total || 0), 0);
      totalObj.Total = grandTotal;

      categoryStats.forEach((s) => {
        const countSum = dataRows.reduce((sum, row) => sum + (row[`${s.key}_count`] || 0), 0);
        totalObj[`${s.key}_count`] = countSum;
        totalObj[`${s.key}_perc`] = grandTotal ? Number(((countSum / grandTotal) * 100).toFixed(1)) : 0;
      });
      return totalObj;
    };

    if (analytics.state && analytics.state.length > 0) {
      const sortedState = [...analytics.state].sort((a, b) => safeString(a.Name).localeCompare(safeString(b.Name)));
      const stateColsBase = [{ header: "State Name", key: "Name", width: 25 }, { header: "Valid Samples", key: "Total", width: 15 }];

      const stateUsslWs = workbook.addWorksheet("State Matrix - USSL");
      stateUsslWs.columns = [...stateColsBase, ...usslCols];
      sortedState.forEach((item) => stateUsslWs.addRow(item));
      stateUsslWs.addRow(generateTotalRow(sortedState, stats.ussl, "state"));

      const stateFaciesWs = workbook.addWorksheet("State Matrix - Facies");
      stateFaciesWs.columns = [...stateColsBase, ...faciesCols];
      sortedState.forEach((item) => stateFaciesWs.addRow(item));
      stateFaciesWs.addRow(generateTotalRow(sortedState, stats.facies, "state"));
    }

    if (analytics.district && analytics.district.length > 0) {
      const sortedDistrict = [...analytics.district].sort((a, b) => {
        const cmp = safeString(a.State).localeCompare(safeString(b.State));
        return cmp !== 0 ? cmp : safeString(a.Name).localeCompare(safeString(b.Name));
      });
      const distColsBase = [
        { header: "State Name", key: "State", width: 20 },
        { header: "District Name", key: "Name", width: 25 },
        { header: "Valid Samples", key: "Total", width: 15 }
      ];

      const distUsslWs = workbook.addWorksheet("District Matrix - USSL");
      distUsslWs.columns = [...distColsBase, ...usslCols];
      sortedDistrict.forEach((item) => distUsslWs.addRow(item));
      distUsslWs.addRow(generateTotalRow(sortedDistrict, stats.ussl, "district"));

      const distFaciesWs = workbook.addWorksheet("District Matrix - Facies");
      distFaciesWs.columns = [...distColsBase, ...faciesCols];
      sortedDistrict.forEach((item) => distFaciesWs.addRow(item));
      distFaciesWs.addRow(generateTotalRow(sortedDistrict, stats.facies, "district"));
    }

    workbook.worksheets.forEach((sheet) => {
      sheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell!({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = Math.min(maxLength + 3, 60);
      });

      sheet.eachRow((row, rowNumber) => {
        const firstCellVal = row.getCell(1).value;
        const isTotalRow = firstCellVal === "GRAND TOTAL";

        row.eachCell((cell) => {
          if (rowNumber === 1) {
            cell.font = { name: "Times New Roman", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3b82f6" } }; // Standard compliance blue
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          } else if (isTotalRow) {
            cell.font = { name: "Times New Roman", size: 12, bold: true };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
            cell.alignment = { vertical: "middle", wrapText: true };
          } else {
            cell.font = { name: "Times New Roman", size: 12 };
            cell.alignment = { vertical: "middle", wrapText: true };
          }

          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" }
          };
        });
      });
    });

    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `WQ_USSL_Piper_Report.xlsx`;
    link.click();
    showToast("Styled Excel Report written successfully!", "success");
  };

  const activeColorMode = viewMode === "ussl" ? "ussl" : viewMode === "gibbs" ? "gibbs" : "piper";

  const colorByOptions = useMemo(() => {
    if (activeColorMode === "ussl") {
      return [
        { value: "ussl", label: "USSL Class" },
        { value: "state", label: "State" },
        { value: "district", label: "District" },
        { value: "block", label: "Block" },
        { value: "location", label: "Location" },
        { value: "source", label: "Source" },
        { value: "aquifer", label: "Aquifer" },
        { value: "year", label: "Year" },
        { value: "season", label: "Season" },
      ] as const;
    } else if (activeColorMode === "gibbs") {
      return [
        { value: "state", label: "State" },
        { value: "district", label: "District" },
        { value: "block", label: "Block" },
        { value: "location", label: "Location" },
        { value: "source", label: "Source" },
        { value: "aquifer", label: "Aquifer" },
        { value: "year", label: "Year" },
        { value: "season", label: "Season" },
      ] as const;
    } else {
      return [
        { value: "facies", label: "Hydro Facies" },
        { value: "state", label: "State" },
        { value: "district", label: "District" },
        { value: "block", label: "Block" },
        { value: "location", label: "Location" },
        { value: "source", label: "Source" },
        { value: "aquifer", label: "Aquifer" },
        { value: "year", label: "Year" },
        { value: "season", label: "Season" },
      ] as const;
    }
  }, [activeColorMode]);

  const currentColorBy = activeColorMode === "ussl" ? usslColorBy : activeColorMode === "gibbs" ? gibbsColorBy : piperColorBy;
  const setCurrentColorBy = (val: any) => {
    if (activeColorMode === "ussl") setUsslColorBy(val);
    else if (activeColorMode === "gibbs") setGibbsColorBy(val);
    else setPiperColorBy(val);
  };

  if (!isVisible) return null;

  return (
    <div className="space-y-6 w-full animate-fade-in">
      {/* --- Dynamic Mapping Helper Modal --- */}
      {showMappingModal && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                  <Layers className="text-indigo-600" /> Map USSL & Piper Diagram Inputs
                </h2>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                  Specify Excel columns containing major ions, conductivity, and coordinates
                </p>
              </div>
              <button
                onClick={() => {
                  setShowMappingModal(false);
                  setPendingData(null);
                }}
                className="text-slate-400 hover:text-rose-500 transition-colors"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="overflow-y-auto custom-scrollbar flex-1 p-6 bg-white space-y-6">
              {["Location", "Chemistry", "Metadata"].map((group) => (
                <div key={group} className="border-b last:border-b-0 border-slate-100 pb-4">
                  <h3 className="text-xs font-black uppercase text-indigo-500 tracking-widest mb-4 flex items-center gap-1.5">
                    <Sliders className="w-4 h-4" /> {group} Columns config
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {COLUMN_DEFINITIONS.filter((c) => c.group === group).map((col) => (
                      <div key={col.id} className="flex flex-col gap-1 p-3 rounded-xl border border-slate-100 bg-slate-50 hover:bg-indigo-50/20 transition-colors">
                        <label className="text-[10px] font-black text-slate-600 uppercase tracking-wider">{col.label}</label>
                        <select
                          value={columnMapping[col.id] || ""}
                          onChange={(e) => setColumnMapping((prev) => ({ ...prev, [col.id]: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 bg-white font-bold"
                        >
                          <option value="">-- Drop / Leave Empty --</option>
                          {pendingHeaders.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => {
                  setShowMappingModal(false);
                  setPendingData(null);
                }}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmMapping}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-500/20 transition-all"
              >
                Set Column Mappings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Primary tab branding & quick settings */}
      <div className={`glossy-panel p-6 rounded-3xl border border-slate-200 shadow-lg bg-white flex flex-col md:flex-row justify-between items-center gap-6`}>
        <div className="text-center md:text-left space-y-1">
          <h2 className="text-xl font-black text-indigo-950 flex items-center justify-center md:justify-start gap-2 uppercase tracking-tight">
            <TrendingUp className="text-indigo-600" /> USSL & Piper Diagram Analysis
          </h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest leading-none">
            Hydrochemical Facies • Agro-Salinity Quality Classification Matrix
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5 justify-center items-center">
          {/* Theme customizer layout */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1 mr-2">
            {APP_THEMES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveThemeId(t.id)}
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${
                    activeThemeId === t.id
                      ? "bg-slate-800 text-white shadow-md border border-slate-900"
                      : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
                  }`}
                  title={t.name}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>

          <label className="bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer px-4 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-md flex items-center gap-1.5 transition-all active:scale-95">
            <UploadCloud className="w-3.5 h-3.5" /> Import USSL Sheet
            <input type="file" className="hidden" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} />
          </label>

          {validData.length > 0 && (
            <button
              onClick={exportExcel}
              className="bg-teal-600 hover:bg-teal-500 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-md flex items-center gap-1.5 transition-all"
            >
              <Download className="w-3.5 h-3.5" /> Export Excel
            </button>
          )}

          {/* Sub Navigation controls within this specific tab */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1 select-none flex-wrap">
            {(["ussl", "piper", "gibbs", "aquifer_compare", "analytics_ussl", "analytics_facies", "completeness", "table"] as const).map((view) => {
              const label =
                view === "ussl"
                  ? "USSL Diagram"
                  : view === "piper"
                  ? "Piper Diagram"
                  : view === "gibbs"
                  ? "Gibbs Diagram"
                  : view === "aquifer_compare"
                  ? "Aquifer Comparison"
                  : view === "analytics_ussl"
                  ? "USSL Class"
                  : view === "analytics_facies"
                  ? "Facies Matrix"
                  : view === "completeness"
                  ? "Completeness"
                  : "Grid Table";

              const cl =
                viewMode === view
                  ? "bg-indigo-600 text-white shadow-sm rounded-lg"
                  : "bg-white text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200/50";

              return (
                <button
                  key={view}
                  onClick={() => setViewMode(view)}
                  className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all ${cl}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {rawData.length > 0 && (
        <div className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-md">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-0.5">Cascading Spatial Selection Filters</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3.5 items-end">
            {filterHierarchy.map((filter) => {
              const options = getOptions(filter);
              const isAll = activeFilters[filter] === "All";

              return (
                <div key={filter} className="flex flex-col gap-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{filter}</span>
                  <select
                    value={activeFilters[filter]}
                    onChange={(e) => handleFilterChange(filter, e.target.value)}
                    className={`w-full border rounded-xl px-3 py-2 text-[11px] font-bold transition-all focus:ring-1 focus:ring-indigo-500 outline-none ${
                      isAll ? "bg-white border-slate-200 text-slate-800" : "bg-indigo-50 border-indigo-200 text-indigo-700"
                    }`}
                  >
                    {options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {processedData.length > 0 || !["ussl", "piper", "gibbs", "aquifer_compare"].includes(viewMode) ? (
        ["ussl", "piper", "gibbs", "aquifer_compare"].includes(viewMode) ? (
          <div className="flex flex-col gap-6 w-full items-stretch animate-fadeIn">
            <div className="w-full space-y-6">
              {/* Aqueous Styling, Color-by & 3D Settings Panel */}
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-4 justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckCircle className="text-indigo-500 w-4.5 h-4.5" />
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Aqueous Color-By Accent:</span>
                    <div className="flex flex-wrap bg-slate-100 p-0.5 rounded-xl border border-slate-200 gap-1 ml-2">
                      {colorByOptions.map((opt) => {
                        const mode = opt.value;
                        if (mode === "state" && !stateHeader) return null;
                        if (mode === "district" && !columnMapping.District) return null;
                        if (mode === "block" && !columnMapping.Block) return null;
                        if (mode === "location" && !columnMapping.Location) return null;
                        if (mode === "source" && !columnMapping.Source) return null;
                        if (mode === "aquifer" && !columnMapping.Aquifer) return null;
                        if (mode === "year" && !columnMapping.Year) return null;
                        if (mode === "season" && !columnMapping.Season) return null;
                        return (
                          <button
                            key={mode}
                            onClick={() => setCurrentColorBy(mode)}
                            className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${
                              currentColorBy === mode ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:text-slate-800"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 border border-emerald-200 rounded-lg whitespace-nowrap">
                    {validData.length} Plottable Complete Water Records
                  </span>
                </div>

                {/* 3D Bubble Facility Controls */}
                <div className="flex flex-wrap items-center gap-6 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <div className="flex items-center gap-2.5">
                    <CircleDot className="text-indigo-500 w-4 h-4" />
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">3D Bubble Rendering:</span>
                    <button
                      onClick={() => setIs3d(!is3d)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                        is3d ? "bg-indigo-600" : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          is3d ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                    <span className="text-[10px] font-black uppercase text-slate-600">
                      {is3d ? "Glossy Sphere" : "Flat Circle"}
                    </span>
                  </div>

                  {is3d && (
                    <div className="flex items-center gap-3 flex-1 min-w-[240px]">
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest whitespace-nowrap">Bubble Size Multiplier:</span>
                      <input
                        type="range"
                        min="1"
                        max="4"
                        step="0.2"
                        value={bubbleSizeMultiplier}
                        onChange={(e) => setBubbleSizeMultiplier(parseFloat(e.target.value))}
                        className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                      <span className="text-xs font-mono font-black text-slate-700 px-2 py-0.5 bg-slate-200 rounded-lg whitespace-nowrap">
                        {bubbleSizeMultiplier.toFixed(1)}x
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Comparison Control Panel */}
              {validData.length > 0 && viewMode !== "aquifer_compare" && (
                <div className="bg-slate-50 border border-slate-200 rounded-3xl p-5 flex flex-wrap gap-4 items-center justify-between shadow-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Compare Dual Panels By:</span>
                    <select
                      value={viewMode === "ussl" ? usslCompareBy : viewMode === "piper" ? piperCompareBy : gibbsCompareBy}
                      onChange={(e) => {
                        const val = e.target.value as CompareByType;
                        if (viewMode === "ussl") setUsslCompareBy(val);
                        if (viewMode === "piper") setPiperCompareBy(val);
                        if (viewMode === "gibbs") setGibbsCompareBy(val);
                      }}
                      className="border border-slate-200 rounded-xl px-3 py-1.5 text-[11px] font-black text-indigo-700 bg-white shadow-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                    >
                      <option value="none">Single View (No Comparison)</option>
                      {uniqueYears.length > 1 && <option value="year">Compare Years</option>}
                      {uniqueSeasons.length > 1 && <option value="season">Compare Seasons</option>}
                      {uniqueAquifers.length > 1 && <option value="aquifer">Compare Aquifers</option>}
                      {uniqueSources.length > 1 && <option value="source">Compare Sources</option>}
                      {uniqueLocations.length > 1 && <option value="location">Compare Locations</option>}
                      {uniqueBlocks.length > 1 && <option value="block">Compare Blocks / Tehsils</option>}
                      {uniqueDistricts.length > 1 && <option value="district">Compare Districts</option>}
                      {uniqueStates.length > 1 && <option value="state">Compare States</option>}
                    </select>
                  </div>

                  {(viewMode === "ussl" ? usslCompareBy : viewMode === "piper" ? piperCompareBy : gibbsCompareBy) !== "none" && (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Left Panel:</span>
                        <select
                          value={viewMode === "ussl" ? usslLeftVal : viewMode === "piper" ? piperLeftVal : gibbsLeftVal}
                          onChange={(e) => {
                            if (viewMode === "ussl") setUsslLeftVal(e.target.value);
                            if (viewMode === "piper") setPiperLeftVal(e.target.value);
                            if (viewMode === "gibbs") setGibbsLeftVal(e.target.value);
                          }}
                          className="border border-slate-200 rounded-xl px-2.5 py-1 text-[11px] font-black text-indigo-750 bg-white focus:ring-1 focus:ring-indigo-500 outline-none"
                        >
                          {getCompareOptions(viewMode === "ussl" ? usslCompareBy : viewMode === "piper" ? piperCompareBy : gibbsCompareBy).map(val => (
                            <option key={val} value={val}>{val}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Right Panel:</span>
                        <select
                          value={viewMode === "ussl" ? usslRightVal : viewMode === "piper" ? piperRightVal : gibbsRightVal}
                          onChange={(e) => {
                            if (viewMode === "ussl") setUsslRightVal(e.target.value);
                            if (viewMode === "piper") setPiperRightVal(e.target.value);
                            if (viewMode === "gibbs") setGibbsRightVal(e.target.value);
                          }}
                          className="border border-slate-200 rounded-xl px-2.5 py-1 text-[11px] font-black text-indigo-750 bg-white focus:ring-1 focus:ring-indigo-500 outline-none"
                        >
                          {getCompareOptions(viewMode === "ussl" ? usslCompareBy : viewMode === "piper" ? piperCompareBy : gibbsCompareBy).map(val => (
                            <option key={val} value={val}>{val}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Dynamic Tab Panel Content */}
              {viewMode === "ussl" && (
                <div className="space-y-6">
                  {usslCompareBy === "none" ? (
                    <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-md flex justify-center w-full">
                      <UsslDiagram
                        data={validData}
                        pointColors={getActiveColorsForMode("ussl")}
                        pointSizes={getActiveSizesForMode("ussl")}
                        getPointKey={(d) => getPointKeyForMode(d, "ussl")}
                        stateHeader={stateHeader}
                        is3d={is3d}
                        bubbleSizeMultiplier={bubbleSizeMultiplier}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-md relative w-full">
                        <div className="absolute top-4 left-4 bg-indigo-50 text-indigo-700 text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider border border-indigo-200 z-10 shadow-xs">
                          {usslCompareBy.charAt(0).toUpperCase() + usslCompareBy.slice(1)}: {usslLeftVal}
                        </div>
                        <UsslDiagram
                          data={usslLeftData}
                          pointColors={getActiveColorsForMode("ussl")}
                          pointSizes={getActiveSizesForMode("ussl")}
                          getPointKey={(d) => getPointKeyForMode(d, "ussl")}
                          stateHeader={stateHeader}
                          is3d={is3d}
                          bubbleSizeMultiplier={bubbleSizeMultiplier}
                          customTitle={`USSL Matrix (${usslLeftVal})`}
                        />
                      </div>
                      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-md relative w-full">
                        <div className="absolute top-4 left-4 bg-indigo-50 text-indigo-700 text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider border border-indigo-200 z-10 shadow-xs">
                          {usslCompareBy.charAt(0).toUpperCase() + usslCompareBy.slice(1)}: {usslRightVal}
                        </div>
                        <UsslDiagram
                          data={usslRightData}
                          pointColors={getActiveColorsForMode("ussl")}
                          pointSizes={getActiveSizesForMode("ussl")}
                          getPointKey={(d) => getPointKeyForMode(d, "ussl")}
                          stateHeader={stateHeader}
                          is3d={is3d}
                          bubbleSizeMultiplier={bubbleSizeMultiplier}
                          customTitle={`USSL Matrix (${usslRightVal})`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {viewMode === "piper" && (
                <div className="space-y-6">
                  {piperCompareBy === "none" ? (
                    <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-md flex justify-center w-full">
                      <PiperDiagram
                        data={validData}
                        pointColors={getActiveColorsForMode("piper")}
                        pointSizes={getActiveSizesForMode("piper")}
                        getPointKey={(d) => getPointKeyForMode(d, "piper")}
                        stateHeader={stateHeader}
                        is3d={is3d}
                        bubbleSizeMultiplier={bubbleSizeMultiplier}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-md relative w-full">
                        <div className="absolute top-4 left-4 bg-indigo-50 text-indigo-700 text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider border border-indigo-200 z-10 shadow-xs">
                          {piperCompareBy.charAt(0).toUpperCase() + piperCompareBy.slice(1)}: {piperLeftVal}
                        </div>
                        <PiperDiagram
                          data={piperLeftData}
                          pointColors={getActiveColorsForMode("piper")}
                          pointSizes={getActiveSizesForMode("piper")}
                          getPointKey={(d) => getPointKeyForMode(d, "piper")}
                          stateHeader={stateHeader}
                          is3d={is3d}
                          bubbleSizeMultiplier={bubbleSizeMultiplier}
                          customTitle={`Piper Diagram (${piperLeftVal})`}
                        />
                      </div>
                      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-md relative w-full">
                        <div className="absolute top-4 left-4 bg-indigo-50 text-indigo-700 text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider border border-indigo-200 z-10 shadow-xs">
                          {piperCompareBy.charAt(0).toUpperCase() + piperCompareBy.slice(1)}: {piperRightVal}
                        </div>
                        <PiperDiagram
                          data={piperRightData}
                          pointColors={getActiveColorsForMode("piper")}
                          pointSizes={getActiveSizesForMode("piper")}
                          getPointKey={(d) => getPointKeyForMode(d, "piper")}
                          stateHeader={stateHeader}
                          is3d={is3d}
                          bubbleSizeMultiplier={bubbleSizeMultiplier}
                          customTitle={`Piper Diagram (${piperRightVal})`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {viewMode === "gibbs" && (
                <div className="space-y-6">
                  {gibbsCompareBy === "none" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-transparent p-5 rounded-3xl">
                        <GibbsPlot
                          data={validData}
                          type="cation"
                          defaultTitle="Gibbs: Cation Dominance"
                          pointColors={getActiveColorsForMode("gibbs")}
                          pointSizes={getActiveSizesForMode("gibbs")}
                          getPointKey={(d) => getPointKeyForMode(d, "gibbs")}
                          stateHeader={stateHeader}
                          is3d={is3d}
                          bubbleSizeMultiplier={bubbleSizeMultiplier}
                        />
                      </div>
                      <div className="bg-transparent p-5 rounded-3xl">
                        <GibbsPlot
                          data={validData}
                          type="anion"
                          defaultTitle="Gibbs: Anion Dominance"
                          pointColors={getActiveColorsForMode("gibbs")}
                          pointSizes={getActiveSizesForMode("gibbs")}
                          getPointKey={(d) => getPointKeyForMode(d, "gibbs")}
                          stateHeader={stateHeader}
                          is3d={is3d}
                          bubbleSizeMultiplier={bubbleSizeMultiplier}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Left Side Comparison Column */}
                      <div className="space-y-6 border-r border-dashed border-slate-200/80 pr-3">
                        <div className="flex justify-between items-center bg-indigo-50 p-2.5 rounded-2xl border border-indigo-100 shadow-xs">
                          <span className="text-[10px] font-black uppercase text-indigo-700 tracking-widest pl-1">
                            Panel Left Selection
                          </span>
                          <span className="text-[10px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded-lg border shadow-xs">
                            {gibbsCompareBy.charAt(0).toUpperCase() + gibbsCompareBy.slice(1)}: {gibbsLeftVal}
                          </span>
                        </div>
                        <div className="bg-transparent p-4 rounded-3xl">
                          <GibbsPlot
                            data={gibbsLeftData}
                            type="cation"
                            defaultTitle={`Gibbs Cation (${gibbsLeftVal})`}
                            pointColors={getActiveColorsForMode("gibbs")}
                            pointSizes={getActiveSizesForMode("gibbs")}
                            getPointKey={(d) => getPointKeyForMode(d, "gibbs")}
                            stateHeader={stateHeader}
                            is3d={is3d}
                            bubbleSizeMultiplier={bubbleSizeMultiplier}
                          />
                        </div>
                        <div className="bg-transparent p-4 rounded-3xl">
                          <GibbsPlot
                            data={gibbsLeftData}
                            type="anion"
                            defaultTitle={`Gibbs Anion (${gibbsLeftVal})`}
                            pointColors={getActiveColorsForMode("gibbs")}
                            pointSizes={getActiveSizesForMode("gibbs")}
                            getPointKey={(d) => getPointKeyForMode(d, "gibbs")}
                            stateHeader={stateHeader}
                            is3d={is3d}
                            bubbleSizeMultiplier={bubbleSizeMultiplier}
                          />
                        </div>
                      </div>

                      {/* Right Side Comparison Column */}
                      <div className="space-y-6 pl-3">
                        <div className="flex justify-between items-center bg-indigo-50 p-2.5 rounded-2xl border border-indigo-100 shadow-xs">
                          <span className="text-[10px] font-black uppercase text-indigo-700 tracking-widest pl-1">
                            Panel Right Selection
                          </span>
                          <span className="text-[10px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded-lg border shadow-xs">
                            {gibbsCompareBy.charAt(0).toUpperCase() + gibbsCompareBy.slice(1)}: {gibbsRightVal}
                          </span>
                        </div>
                        <div className="bg-transparent p-4 rounded-3xl">
                          <GibbsPlot
                            data={gibbsRightData}
                            type="cation"
                            defaultTitle={`Gibbs Cation (${gibbsRightVal})`}
                            pointColors={getActiveColorsForMode("gibbs")}
                            pointSizes={getActiveSizesForMode("gibbs")}
                            getPointKey={(d) => getPointKeyForMode(d, "gibbs")}
                            stateHeader={stateHeader}
                            is3d={is3d}
                            bubbleSizeMultiplier={bubbleSizeMultiplier}
                          />
                        </div>
                        <div className="bg-transparent p-4 rounded-3xl">
                          <GibbsPlot
                            data={gibbsRightData}
                            type="anion"
                            defaultTitle={`Gibbs Anion (${gibbsRightVal})`}
                            pointColors={getActiveColorsForMode("gibbs")}
                            pointSizes={getActiveSizesForMode("gibbs")}
                            getPointKey={(d) => getPointKeyForMode(d, "gibbs")}
                            stateHeader={stateHeader}
                            is3d={is3d}
                            bubbleSizeMultiplier={bubbleSizeMultiplier}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {viewMode === "aquifer_compare" && (
                <div className="space-y-12 w-full">
                  {!columnMapping.Aquifer ? (
                    <div className="p-8 text-center bg-amber-50 border border-amber-200 rounded-3xl">
                      <XCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                      <p className="text-xs font-black text-amber-800 uppercase tracking-wider">
                        Aquifer Column Mapping Required
                      </p>
                      <p className="text-[10px] text-amber-600 mt-1">
                        Please open the column mapper at the top of the page and select the column containing your Aquifer data to enable this comparison.
                      </p>
                    </div>
                  ) : uniqueAquifers.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-3xl">
                      <Database className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                      <p className="text-xs font-black text-slate-500 uppercase tracking-wider">
                        No Aquifers Detected
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        No non-empty aquifer names were detected in the uploaded dataset.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-12">
                      {/* Aquifer Selection Controller Widget */}
                      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-950 text-white p-6 rounded-[2rem] border border-slate-950 shadow-xl space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                          <div>
                            <span className="text-[10px] font-black uppercase text-indigo-400 tracking-wider flex items-center gap-1.5">
                              <Sparkles className="w-4 h-4 text-indigo-400" />
                              AQUIFER COMPARATIVE ANALYSIS CONTROL PANEL
                            </span>
                            <h3 className="text-sm font-black tracking-tight text-white mt-0.5">
                              Select Aquifers to Compare
                            </h3>
                            <p className="text-[10px] text-slate-400 leading-tight">
                              Select three or four aquifers to compare their Piper, USSL, and Gibbs diagrams, tables, and classification ratios side-by-side.
                            </p>
                          </div>
                          
                          {/* Quick Actions */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCompareAquifers(uniqueAquifers.slice(0, 4));
                              }}
                              className="cursor-pointer px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-[10px] font-bold text-slate-200 transition-all uppercase tracking-wider"
                            >
                              First 4 Aquifers
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCompareAquifers(uniqueAquifers);
                              }}
                              className="cursor-pointer px-3 py-1.5 bg-indigo-600/50 hover:bg-indigo-600 border border-indigo-500 rounded-xl text-[10px] font-bold text-white transition-all uppercase tracking-wider"
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCompareAquifers([]);
                              }}
                              className="cursor-pointer px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-[10px] font-bold text-slate-400 transition-all uppercase tracking-wider"
                            >
                              Clear All
                            </button>
                          </div>
                        </div>

                        {/* Aquifer Checkboxes */}
                        <div className="flex flex-wrap gap-2 pt-1 max-h-[160px] overflow-y-auto custom-scrollbar">
                          {uniqueAquifers.map((aq) => {
                            const sampleCount = validData.filter(d => String(d[columnMapping.Aquifer] || "Unknown") === aq).length;
                            const isChecked = currentSelectedAquifers.includes(aq);
                            return (
                              <label
                                key={aq}
                                className={`cursor-pointer flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold border transition-all select-none ${
                                  isChecked
                                    ? "bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/10"
                                    : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="accent-indigo-400 cursor-pointer w-3.5 h-3.5 rounded"
                                  checked={isChecked}
                                  onChange={() => {
                                    if (isChecked) {
                                      setSelectedCompareAquifers(prev => {
                                        // If empty or default is active, populate first
                                        const baseList = prev.length > 0 ? prev : uniqueAquifers.slice(0, 4);
                                        return baseList.filter(v => v !== aq);
                                      });
                                    } else {
                                      setSelectedCompareAquifers(prev => {
                                        const baseList = prev.length > 0 ? prev : uniqueAquifers.slice(0, 4);
                                        return [...baseList, aq];
                                      });
                                    }
                                  }}
                                />
                                <span>{aq}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono ${isChecked ? 'bg-indigo-850 text-indigo-200' : 'bg-slate-800 text-slate-500'}`}>
                                  {sampleCount}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="bg-indigo-50/50 border border-indigo-150 p-4 rounded-3xl">
                        <p className="text-[10px] text-indigo-800 font-extrabold uppercase tracking-widest text-center flex items-center justify-center gap-2">
                          <Sparkles className="w-4 h-4 text-indigo-500" /> Comparing {currentSelectedAquifers.length} Aquifer Groups side-by-side
                        </p>
                      </div>

                      {currentSelectedAquifers.map((aq) => {
                        const aquiferData = validData.filter(d => String(d[columnMapping.Aquifer] || "Unknown") === aq);
                        
                        // Compute local stats for donut and table
                        const uCounts: Record<string, number> = {};
                        const fCounts: Record<string, number> = {};
                        aquiferData.forEach((d) => {
                          uCounts[d._calc.ussl] = (uCounts[d._calc.ussl] || 0) + 1;
                          fCounts[d._calc.facies] = (fCounts[d._calc.facies] || 0) + 1;
                        });

                        const aqUsslStats = Object.entries(uCounts)
                          .map(([key, count]) => ({ key, name: key, count }))
                          .sort((a, b) => b.count - a.count);

                        const aqFaciesStats = Object.entries(fCounts)
                          .map(([key, count]) => ({ key, name: faciesNames[key] || key, count }))
                          .sort((a, b) => b.count - a.count);

                        const totalSamples = aquiferData.length;

                        return (
                          <div key={aq} className="glossy-panel bg-white border border-slate-200 rounded-[2.5rem] shadow-xl overflow-hidden p-6 space-y-6" id={`aq-panel-${aq.replace(/\s+/g, "-")}`}>
                            {/* Card Header */}
                            <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-100 pb-4">
                              <div>
                                <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                                  <Database className="text-indigo-600 w-5 h-5" /> Aquifer: <span className="text-indigo-950 font-black">{aq}</span>
                                </h3>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                                  Isolated dataset subset analysis
                                </p>
                              </div>
                              <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-3 py-1.5 border border-emerald-200 rounded-xl whitespace-nowrap">
                                {totalSamples} Mapped Samples
                              </span>
                            </div>

                            {aquiferData.length === 0 ? (
                              <div className="p-8 text-center bg-slate-50 border border-slate-100 rounded-3xl text-slate-400 text-[10px] font-bold">
                                No complete samples available for this aquifer in current filter selections.
                              </div>
                            ) : (
                              <div className="space-y-6">
                                {/* Diagram Grid */}
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                  {/* USSL Diagram */}
                                  <div className="bg-slate-50/50 p-4 rounded-3xl border border-slate-200/80 flex flex-col items-center">
                                    <span className="text-[9.5px] font-black uppercase text-indigo-950 tracking-wider mb-2">
                                      USSL Classification ({aq})
                                    </span>
                                    <UsslDiagram
                                      data={aquiferData}
                                      pointColors={getActiveColorsForMode("ussl")}
                                      pointSizes={getActiveSizesForMode("ussl")}
                                      getPointKey={(d) => getPointKeyForMode(d, "ussl")}
                                      stateHeader={stateHeader}
                                      is3d={is3d}
                                      bubbleSizeMultiplier={bubbleSizeMultiplier}
                                      customTitle={`USSL Matrix (${aq})`}
                                    />
                                  </div>

                                  {/* Piper Diagram */}
                                  <div className="bg-slate-50/50 p-4 rounded-3xl border border-slate-200/80 flex flex-col items-center">
                                    <span className="text-[9.5px] font-black uppercase text-indigo-950 tracking-wider mb-2">
                                      Piper Trilinear Diagram ({aq})
                                    </span>
                                    <PiperDiagram
                                      data={aquiferData}
                                      pointColors={getActiveColorsForMode("piper")}
                                      pointSizes={getActiveSizesForMode("piper")}
                                      getPointKey={(d) => getPointKeyForMode(d, "piper")}
                                      stateHeader={stateHeader}
                                      is3d={is3d}
                                      bubbleSizeMultiplier={bubbleSizeMultiplier}
                                      customTitle={`Piper Diagram (${aq})`}
                                    />
                                  </div>

                                  {/* Gibbs Cation Plot */}
                                  <div className="bg-slate-50/50 p-4 rounded-3xl border border-slate-200/80 flex flex-col items-center">
                                    <span className="text-[9.5px] font-black uppercase text-indigo-950 tracking-wider mb-2">
                                      Gibbs Cation Dominance ({aq})
                                    </span>
                                    <GibbsPlot
                                      data={aquiferData}
                                      type="cation"
                                      defaultTitle={`Gibbs Cation (${aq})`}
                                      pointColors={getActiveColorsForMode("gibbs")}
                                      pointSizes={getActiveSizesForMode("gibbs")}
                                      getPointKey={(d) => getPointKeyForMode(d, "gibbs")}
                                      stateHeader={stateHeader}
                                      is3d={is3d}
                                      bubbleSizeMultiplier={bubbleSizeMultiplier}
                                    />
                                  </div>

                                  {/* Gibbs Anion Plot */}
                                  <div className="bg-slate-50/50 p-4 rounded-3xl border border-slate-200/80 flex flex-col items-center">
                                    <span className="text-[9.5px] font-black uppercase text-indigo-950 tracking-wider mb-2">
                                      Gibbs Anion Dominance ({aq})
                                    </span>
                                    <GibbsPlot
                                      data={aquiferData}
                                      type="anion"
                                      defaultTitle={`Gibbs Anion (${aq})`}
                                      pointColors={getActiveColorsForMode("gibbs")}
                                      pointSizes={getActiveSizesForMode("gibbs")}
                                      getPointKey={(d) => getPointKeyForMode(d, "gibbs")}
                                      stateHeader={stateHeader}
                                      is3d={is3d}
                                      bubbleSizeMultiplier={bubbleSizeMultiplier}
                                    />
                                  </div>
                                </div>

                                {/* Donuts & Stats Section */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                                  {/* USSL Donut Chart */}
                                  <div className="bg-slate-50 p-4 rounded-3xl border border-slate-200 shadow-sm">
                                    <DonutChart
                                      data={aqUsslStats}
                                      colors={usslColors}
                                      sizes={usslSizes}
                                      onColorChange={(k, c) => setUsslColors((p) => ({ ...p, [k]: c }))}
                                      onSizeChange={(k, s) => setUsslSizes((p) => ({ ...p, [k]: s }))}
                                      defaultTitle="USSL Classes"
                                      compact={true}
                                    />
                                  </div>

                                  {/* Facies Donut Chart */}
                                  <div className="bg-slate-50 p-4 rounded-3xl border border-slate-200 shadow-sm">
                                    <DonutChart
                                      data={aqFaciesStats}
                                      colors={faciesColors}
                                      sizes={faciesSizes}
                                      onColorChange={(k, c) => setFaciesColors((p) => ({ ...p, [k]: c }))}
                                      onSizeChange={(k, s) => setFaciesSizes((p) => ({ ...p, [k]: s }))}
                                      onNameChange={(k, n) => setFaciesNames((p) => ({ ...p, [k]: n }))}
                                      defaultTitle="Water Hydro-Facies"
                                      compact={true}
                                    />
                                  </div>

                                  {/* Aquifer Classes Breakdown Distribution Table */}
                                  <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-md space-y-2.5">
                                    <div className="border-b border-slate-100 pb-1.5">
                                      <h4 className="text-[11px] font-black uppercase text-slate-800 tracking-wider">
                                        Classification Breakdown
                                      </h4>
                                      <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                                        Frequency and proportions inside {aq}
                                      </p>
                                    </div>

                                    <div className="overflow-hidden rounded-xl border border-slate-200 max-h-[210px] overflow-y-auto custom-scrollbar">
                                      <table className="w-full text-left text-[10px] border-collapse">
                                        <thead className="bg-slate-50 text-slate-600 font-bold text-[8.5px] tracking-wider border-b border-slate-200 sticky top-0">
                                          <tr>
                                            <th className="px-2 py-1.5">Category</th>
                                            <th className="px-2 py-1.5 text-center">Type</th>
                                            <th className="px-2 py-1.5 text-center">Count</th>
                                            <th className="px-2 py-1.5 text-center">%</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-150 text-slate-700 font-medium text-[10px]">
                                          {/* USSL rows */}
                                          {aqUsslStats.map((row) => (
                                            <tr key={`ussl-${row.key}`} className="hover:bg-slate-50/50 transition-colors">
                                              <td className="px-2 py-1.5 font-bold text-slate-800 flex items-center gap-1.5">
                                                <span 
                                                  className="w-1.5 h-1.5 rounded-full border border-slate-300 shadow-xs shrink-0" 
                                                  style={{ backgroundColor: usslColors[row.key] || "#94a3b8" }}
                                                />
                                                {row.name}
                                              </td>
                                              <td className="px-2 py-1.5 text-center text-[8px] font-black text-indigo-500 uppercase tracking-widest">
                                                USSL
                                              </td>
                                              <td className="px-2 py-1.5 text-center font-mono font-extrabold text-slate-900">
                                                {row.count}
                                              </td>
                                              <td className="px-2 py-1.5 text-center font-mono text-slate-500">
                                                {totalSamples > 0 ? ((row.count / totalSamples) * 100).toFixed(1) : "0.0"}%
                                              </td>
                                            </tr>
                                          ))}
                                          {/* Facies rows */}
                                          {aqFaciesStats.map((row) => (
                                            <tr key={`facies-${row.key}`} className="hover:bg-slate-50/50 transition-colors">
                                              <td className="px-2 py-1.5 font-bold text-slate-800 flex items-center gap-1.5">
                                                <span 
                                                  className="w-1.5 h-1.5 rounded-full border border-slate-300 shadow-xs shrink-0" 
                                                  style={{ backgroundColor: faciesColors[row.key] || "#94a3b8" }}
                                                />
                                                {row.name}
                                              </td>
                                              <td className="px-2 py-1.5 text-center text-[8px] font-black text-teal-600 uppercase tracking-widest">
                                                Facies
                                              </td>
                                              <td className="px-2 py-1.5 text-center font-mono font-extrabold text-slate-900">
                                                {row.count}
                                              </td>
                                              <td className="px-2 py-1.5 text-center font-mono text-slate-500">
                                                {totalSamples > 0 ? ((row.count / totalSamples) * 100).toFixed(1) : "0.0"}%
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!["gibbs", "aquifer_compare"].includes(viewMode) && (
              <div className={isComparisonActive ? "w-full grid grid-cols-1 lg:grid-cols-2 gap-6 items-start" : "w-full max-w-xl mx-auto space-y-6"}>
                {(() => {
                  const isUsslComparisonActive = usslCompareBy !== "none" && usslLeftVal && usslRightVal;
                  const isPiperComparisonActive = piperCompareBy !== "none" && piperLeftVal && piperRightVal;
                  const isComparisonActive = viewMode === "ussl" ? isUsslComparisonActive : isPiperComparisonActive;

                  if (isComparisonActive) {
                    return (
                      <div className="contents">
                        <div className="bg-slate-50 p-4 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                          <h4 className="text-xs font-black uppercase text-indigo-700 tracking-wider">
                            Comparison Donut Charts
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {viewMode === "ussl" ? (
                              <>
                                <DonutChart
                                  data={leftStats.ussl}
                                  colors={usslColors}
                                  sizes={usslSizes}
                                  onColorChange={(k, c) => setUsslColors((p) => ({ ...p, [k]: c }))}
                                  onSizeChange={(k, s) => setUsslSizes((p) => ({ ...p, [k]: s }))}
                                  defaultTitle={`${usslLeftVal} - USSL Classes`}
                                  compact={true}
                                />
                                <DonutChart
                                  data={rightStats.ussl}
                                  colors={usslColors}
                                  sizes={usslSizes}
                                  onColorChange={(k, c) => setUsslColors((p) => ({ ...p, [k]: c }))}
                                  onSizeChange={(k, s) => setUsslSizes((p) => ({ ...p, [k]: s }))}
                                  defaultTitle={`${usslRightVal} - USSL Classes`}
                                  compact={true}
                                />
                              </>
                            ) : (
                              <>
                                <DonutChart
                                  data={leftStats.facies}
                                  colors={faciesColors}
                                  sizes={faciesSizes}
                                  onColorChange={(k, c) => setFaciesColors((p) => ({ ...p, [k]: c }))}
                                  onSizeChange={(k, s) => setFaciesSizes((p) => ({ ...p, [k]: s }))}
                                  onNameChange={(k, n) => setFaciesNames((p) => ({ ...p, [k]: n }))}
                                  defaultTitle={`${piperLeftVal} - Water Hydro-Facies`}
                                  compact={true}
                                />
                                <DonutChart
                                  data={rightStats.facies}
                                  colors={faciesColors}
                                  sizes={faciesSizes}
                                  onColorChange={(k, c) => setFaciesColors((p) => ({ ...p, [k]: c }))}
                                  onSizeChange={(k, s) => setFaciesSizes((p) => ({ ...p, [k]: s }))}
                                  onNameChange={(k, n) => setFaciesNames((p) => ({ ...p, [k]: n }))}
                                  defaultTitle={`${piperRightVal} - Water Hydro-Facies`}
                                  compact={true}
                                />
                              </>
                            )}
                          </div>
                        </div>

                        {/* Class distribution comparison table */}
                        <div className="bg-white p-2.5 rounded-3xl border border-slate-200 shadow-md space-y-2.5">
                          <div className="border-b border-slate-100 pb-1.5">
                            <h4 className="text-[11px] font-black uppercase text-slate-800 tracking-wider">
                              Distribution Comparison Table
                            </h4>
                            <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                              Total samples and percentage comparison
                            </p>
                          </div>

                          <div className="overflow-hidden rounded-xl border border-slate-200">
                            <table className="w-full text-left text-[10px] border-collapse">
                              <thead className="bg-slate-50 text-slate-600 font-bold text-[8.5px] tracking-wider border-b border-slate-200">
                                <tr>
                                  <th className="px-2 py-1">Category / Class</th>
                                  <th className="px-2 py-1 text-center bg-indigo-50/50 text-indigo-900">
                                    {viewMode === "ussl" ? usslLeftVal : piperLeftVal}
                                  </th>
                                  <th className="px-2 py-1 text-center bg-amber-50/50 text-amber-900">
                                    {viewMode === "ussl" ? usslRightVal : piperRightVal}
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-150 text-slate-700 font-medium text-[10px]">
                                {comparisonTableData.map((row) => (
                                  <tr key={row.key} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-2 py-1 font-bold text-slate-800 flex items-center gap-1.5">
                                      <span 
                                        className="w-1.5 h-1.5 rounded-full border border-slate-300 shadow-xs shrink-0" 
                                        style={{ backgroundColor: (viewMode === "ussl" ? usslColors : faciesColors)[row.key] || "#94a3b8" }}
                                      />
                                      {row.name}
                                    </td>
                                    <td className="px-2 py-1 text-center font-mono text-slate-650 bg-indigo-50/10">
                                      <span className="font-extrabold text-slate-900">{row.leftCount}</span>{" "}
                                      <span className="text-[8px] text-indigo-650">({row.leftPct.toFixed(1)}%)</span>
                                    </td>
                                    <td className="px-2 py-1 text-center font-mono text-slate-650 bg-amber-50/10">
                                      <span className="font-extrabold text-slate-900">{row.rightCount}</span>{" "}
                                      <span className="text-[8px] text-amber-650">({row.rightPct.toFixed(1)}%)</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="bg-slate-100 font-black text-slate-900 border-t border-slate-300 text-[10px]">
                                <tr>
                                  <td className="px-2 py-1">Total Samples</td>
                                  <td className="px-2 py-1 text-center font-mono">
                                    {comparisonTableData.reduce((sum, r) => sum + r.leftCount, 0)}
                                  </td>
                                  <td className="px-2 py-1 text-center font-mono">
                                    {comparisonTableData.reduce((sum, r) => sum + r.rightCount, 0)}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <>
                      {viewMode === "ussl" && (
                        <DonutChart
                          data={stats.ussl}
                          colors={usslColors}
                          sizes={usslSizes}
                          onColorChange={(k, c) => setUsslColors((p) => ({ ...p, [k]: c }))}
                          onSizeChange={(k, s) => setUsslSizes((p) => ({ ...p, [k]: s }))}
                          defaultTitle="Irrigation USSL Classes"
                          compact={true}
                        />
                      )}
                      {viewMode === "piper" && (
                        <DonutChart
                          data={stats.facies}
                          colors={faciesColors}
                          sizes={faciesSizes}
                          onColorChange={(k, c) => setFaciesColors((p) => ({ ...p, [k]: c }))}
                          onSizeChange={(k, s) => setFaciesSizes((p) => ({ ...p, [k]: s }))}
                          onNameChange={(k, n) => setFaciesNames((p) => ({ ...p, [k]: n }))}
                          defaultTitle="Water Hydro-Facies"
                          compact={true}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        ) : false ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full items-stretch min-h-[720px]">
            {/* GIS Configuration Control Sidebar Panel */}
            <div className="lg:col-span-4 bg-white/90 backdrop-blur-xs p-5 rounded-[2rem] border border-slate-200/80 shadow-md flex flex-col gap-5 max-h-[820px] overflow-y-auto custom-scrollbar">
              <div>
                <span className="text-[10px] font-black uppercase text-indigo-650 tracking-wider flex items-center gap-1.5 mb-1.5">
                  🌍 GIS Control Workstation
                </span>
                <p className="text-[9.5px] font-bold text-slate-400">
                  Manage spatial mappings, compliance filter masks, and digital interpolation models.
                </p>
              </div>

              {/* Feature 1 & 4 & 5: Compliance Filter & Locate Location Points */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/65 space-y-3">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-600 block border-b pb-1">
                  1. Compliance Location Point Locator
                </span>
                <div className="space-y-1.5">
                  <span className="text-[8.5px] font-black uppercase text-slate-400 block tracking-widest">
                    Masking Exceedance Filter:
                  </span>
                  <div className="flex flex-col gap-1 bg-white p-2 rounded-xl border border-slate-200 text-[10px] font-bold">
                    <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:text-indigo-600 transition-colors">
                      <input
                        type="radio"
                        checked={mapExceedanceFilter === "all"}
                        onChange={() => setMapExceedanceFilter("all")}
                        className="text-indigo-600 focus:ring-indigo-500 rounded-sm"
                      />
                      <span>Show All Sample Points</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:text-indigo-600 transition-colors">
                      <input
                        type="radio"
                        checked={mapExceedanceFilter === "any_exceedance"}
                        onChange={() => setMapExceedanceFilter("any_exceedance")}
                        className="text-indigo-600 focus:ring-indigo-500 rounded-sm"
                      />
                      <span>One or More Parameter Exceeds Limit (Feature 4)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:text-indigo-600 transition-colors">
                      <input
                        type="radio"
                        checked={mapExceedanceFilter === "selected_exceedance"}
                        onChange={() => setMapExceedanceFilter("selected_exceedance")}
                        className="text-indigo-600 focus:ring-indigo-500 rounded-sm"
                      />
                      <span>Selected Param Exceeds Limit (Feature 5)</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[8.5px] font-black uppercase text-slate-400 block tracking-widest">
                    Exceedance Check Chemistry Param:
                  </span>
                  <select
                    value={mapExceedanceParam}
                    onChange={(e) => setMapExceedanceParam(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-2 font-bold text-[10px] text-slate-700 focus:ring-indigo-500"
                  >
                    {Object.keys(PARAM_CONFIG).map((k) => (
                      <option key={k} value={k}>
                        {k} - {PARAM_CONFIG[k].name} ({PARAM_CONFIG[k].unit})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Feature 2: Terrains and Layer Control */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/65 space-y-3">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-600 block border-b pb-1">
                  2. GIS Map Tile Layer Control
                </span>
                <div className="grid grid-cols-2 gap-2 text-[9.5px]">
                  {(["osm", "streets", "satellite", "hybrid"] as const).map((thm) => (
                    <button
                      key={thm}
                      onClick={() => setActiveMapTheme(thm)}
                      className={`p-2 rounded-xl border font-black uppercase tracking-wider transition-all ${
                        activeMapTheme === thm
                          ? "bg-slate-800 text-white border-slate-800 shadow-xs"
                          : "bg-white text-slate-500 border-slate-200 hover:text-slate-800 hover:border-slate-300"
                      }`}
                    >
                      {thm === "osm" ? "OpenStreetMap" : thm}
                    </button>
                  ))}
                </div>
              </div>

              {/* Feature 3: Upload zipped boundary file & control color and thickness */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/65 space-y-3">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-600 block border-b pb-1">
                  3. Boundary Shapefile ZIP Overlay
                </span>
                <div className="space-y-2">
                  <label className="block border-2 border-dashed border-slate-200 bg-white/50 hover:bg-white p-3.5 rounded-xl cursor-pointer text-center group transition-colors">
                    <UploadCloud className="w-6 h-6 text-indigo-400 mx-auto mb-1 group-hover:scale-105 transition-transform" />
                    <span className="text-[9px] font-black uppercase tracking-wide text-indigo-650 block">
                      {shapefileName || "Import Shapefile Zip"}
                    </span>
                    <span className="text-[7.5px] font-bold text-slate-400 block mt-0.5">
                      Accepts zipped .shp, .shx, .dbf bundle
                    </span>
                    <input
                      type="file"
                      accept=".zip"
                      onChange={handleShapefileUpload}
                      className="hidden"
                    />
                  </label>

                  {shapefileGeoJson && (
                    <div className="space-y-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80 text-[9.5px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-400">Boundary Outline Color:</span>
                        <input
                          type="color"
                          value={shapefileColor}
                          onChange={(e) => setShapefileColor(e.target.value)}
                          className="w-8 h-5 rounded cursor-pointer border border-slate-200"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between">
                          <span className="font-bold text-slate-400">Boundary Thickness:</span>
                          <span className="font-black text-slate-700">{shapefileWeight}px</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="5"
                          value={shapefileWeight}
                          onChange={(e) => setShapefileWeight(parseInt(e.target.value))}
                          className="w-full h-1 bg-slate-200 rounded appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>
                      <button
                        onClick={() => {
                          setShapefileGeoJson(null);
                          setShapefileName("");
                        }}
                        className="w-full text-center py-1 mt-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg font-black uppercase text-[8px] tracking-widest"
                      >
                        Unmount Shapefile Boundary
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Feature 6: Interpolation map with IDW / Nearest Neighbour / Natural Neighbour Method */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/65 space-y-3">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-600 block border-b pb-1">
                  6. Dynamic Spatial Interpolations
                </span>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-500">Enable Spatial Overlay:</span>
                    <button
                      onClick={() => setShowIdw(!showIdw)}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                        showIdw ? "bg-emerald-600" : "bg-slate-200"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          showIdw ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {showIdw && (
                    <div className="space-y-2.5 bg-white p-2.5 rounded-xl border border-slate-200 text-[9.5px]">
                      <div className="space-y-1">
                        <span className="text-[8.5px] font-black uppercase text-slate-400 block tracking-widest">
                          Interpolate Chemical Element:
                        </span>
                        <select
                          value={idwParam}
                          onChange={(e) => setIdwParam(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-bold text-[9.5px] text-slate-700"
                        >
                          {Object.keys(PARAM_CONFIG).map((k) => (
                            <option key={k} value={k}>
                              {k} - {PARAM_CONFIG[k].name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[8.5px] font-black uppercase text-slate-400 block tracking-widest">
                          Interpolation Algorithm:
                        </span>
                        <select
                          value={interpolationMethod}
                          onChange={(e) => setInterpolationMethod(e.target.value as any)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-bold text-[9.5px] text-slate-700"
                        >
                          <option value="idw">Inverse Distance Weighting (IDW)</option>
                          <option value="kriging">Ordinary Kriging Method</option>
                          <option value="nearest">Nearest Neighbour Method</option>
                          <option value="natural">Natural Neighbour Approximation</option>
                        </select>
                      </div>

                      {interpolationMethod === "idw" && (
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between font-bold text-slate-400">
                            <span>IDW Distance Exponent:</span>
                            <span className="font-black text-indigo-650">{idwPower.toFixed(1)}</span>
                          </div>
                          <input
                            type="range"
                            min="1.0"
                            max="4.0"
                            step="0.5"
                            value={idwPower}
                            onChange={(e) => setIdwPower(parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                          />
                        </div>
                      )}

                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between font-bold text-slate-400">
                          <span>Overlay Transparency Opacity:</span>
                          <span className="font-black text-slate-750">{Math.round(idwOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.05"
                          value={idwOpacity}
                          onChange={(e) => setIdwOpacity(parseFloat(e.target.value))}
                          className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>

                      <div className="flex items-center gap-2 mt-1 bg-slate-100/50 p-2 rounded-xl">
                        <input
                          type="checkbox"
                          id="smooth-gradients-checkbox"
                          checked={smoothGradients}
                          onChange={(e) => setSmoothGradients(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                        />
                        <label htmlFor="smooth-gradients-checkbox" className="text-[9.5px] font-bold text-slate-700 cursor-pointer">
                          Smooth Blending Gradients
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Feature 7 & 8: North Arrow & Legend Positioning Controls */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/65 space-y-3">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-600 block border-b pb-1">
                  7. North Compass Relocator
                </span>
                <div className="space-y-1">
                  <span className="text-[8.5px] font-black uppercase text-slate-400 block tracking-widest">
                    North Compass Position on Map:
                  </span>
                  <select
                    value={northArrowPos}
                    onChange={(e) => setNorthArrowPos(e.target.value as any)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 font-bold text-[10px] text-slate-700"
                  >
                    <option value="top-left">Top-Left Corner</option>
                    <option value="top-right">Top-Right Corner</option>
                    <option value="bottom-left">Bottom-Left Corner</option>
                    <option value="bottom-right">Bottom-Right Corner</option>
                  </select>
                </div>
              </div>

              {/* Feature 9: Customizable Legend Limits and Colors Configuration */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/65 space-y-3">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-600 block border-b pb-1">
                  8 & 9. Customizable Compliance Legend
                </span>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[9.5px]">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-black text-slate-400">Below Acceptable:</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={colorBelow}
                          onChange={(e) => setColorBelow(e.target.value)}
                          className="w-6 h-5 cursor-pointer border border-slate-200 rounded"
                        />
                        <input
                          type="text"
                          value={legendLabelBelow}
                          onChange={(e) => setLegendLabelBelow(e.target.value)}
                          className="flex-1 min-w-0 bg-white border border-slate-200 rounded px-1 py-0.5 font-bold text-[8.5px]"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <span className="font-black text-slate-400">Acceptable-Permissible:</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={colorBetween}
                          onChange={(e) => setColorBetween(e.target.value)}
                          className="w-6 h-5 cursor-pointer border border-slate-200 rounded"
                        />
                        <input
                          type="text"
                          value={legendLabelBetween}
                          onChange={(e) => setLegendLabelBetween(e.target.value)}
                          className="flex-1 min-w-0 bg-white border border-slate-200 rounded px-1 py-0.5 font-bold text-[8.5px]"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-0.5 col-span-2">
                      <span className="font-black text-slate-400">Above Permissible:</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={colorAbove}
                          onChange={(e) => setColorAbove(e.target.value)}
                          className="w-6 h-5 cursor-pointer border border-slate-200 rounded"
                        />
                        <input
                          type="text"
                          value={legendLabelAbove}
                          onChange={(e) => setLegendLabelAbove(e.target.value)}
                          className="flex-1 min-w-0 bg-white border border-slate-200 rounded px-1.5 py-0.5 font-bold text-[8.5px]"
                        />
                      </div>
                    </div>

                    {shapefileGeoJson && (
                      <div className="flex flex-col gap-0.5 col-span-2">
                        <span className="font-black text-slate-400">Boundary Overlay Label:</span>
                        <input
                          type="text"
                          value={legendLabelBoundary}
                          onChange={(e) => setLegendLabelBoundary(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded px-1.5 py-0.5 font-bold text-[8.5px]"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setColorBelow("#3b82f6");
                      setColorBetween("#fef08a");
                      setColorAbove("#ef4444");
                      setLegendLabelBelow("Below Acceptable Limit");
                      setLegendLabelBetween("Between Acceptable & Permissible Limit");
                      setLegendLabelAbove("Above Permissible Limit");
                      setLegendLabelBoundary("Boundary Shapefile Region");
                    }}
                    className="w-full py-1 text-center bg-slate-200/80 hover:bg-slate-350 text-slate-700 border border-slate-300 rounded-lg font-black uppercase text-[8px] tracking-widest transition-colors"
                  >
                    Reset Colors & Titles to Standards (Feature 9)
                  </button>
                </div>
              </div>
            </div>

            {/* Live Interactive Map Workspace Panel */}
            <div className="lg:col-span-8 bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-lg flex flex-col items-stretch relative min-h-[620px] lg:h-auto">
              <div className="flex justify-between items-center p-4 bg-slate-50 border-b border-slate-200 shrink-0 z-10">
                <span className="text-[10px] font-black uppercase text-indigo-650 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-indigo-500" /> Interactive Spatial GIS Workspace
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[8.5px] font-black uppercase text-slate-400 tracking-wider">
                    Plotted Points:
                  </span>
                  <span className="text-[10px] font-black text-indigo-650 bg-indigo-50 px-2.5 py-1 border border-indigo-200 rounded-lg">
                    {processedData.filter(d => d._calc.lat !== null && d._calc.lng !== null).length} Coordinates Mapped
                  </span>
                </div>
              </div>

              {/* The Map Rendering Target container with custom floating overlays */}
              <div className="flex-1 w-full h-full relative bg-slate-100 min-h-[550px] pointer-events-auto">
                <div ref={mapRef} id="leaflet-map-element" className="w-full h-full absolute inset-0 z-10" />

                {/* Draggable/Relocatable North Arrow Needle (Feature 7) */}
                <div className={`absolute z-35 bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-slate-200/80 shadow-md flex flex-col items-center gap-1 transition-all pointer-events-auto ${
                  northArrowPos === "top-left" ? "top-4 left-4" :
                  northArrowPos === "top-right" ? "top-4 right-4" :
                  northArrowPos === "bottom-left" ? "bottom-4 left-4" :
                  "bottom-4 right-4"
                }`}>
                  <svg width="42" height="42" viewBox="0 0 100 100" className="drop-shadow-xs text-slate-800 animate-pulse">
                    <polygon points="50,10 65,50 50,42" fill="#ef4444" />
                    <polygon points="50,10 35,50 50,42" fill="#3b82f6" />
                    <polygon points="50,90 65,50 50,58" fill="#eab308" />
                    <polygon points="50,90 35,50 50,58" fill="#94a3b8" />
                    <text x="50" y="31" fontSize="12" fontWeight="900" fill="#1e293b" textAnchor="middle">N</text>
                  </svg>
                  <span className="text-[8px] font-black tracking-widest text-slate-400">NORTH</span>
                </div>

                {/* Replaceable Legend Section (Feature 8, 9) */}
                <div className={`absolute z-35 bg-white/95 backdrop-blur-md px-4 py-3 rounded-2xl border border-slate-200 shadow-md min-w-[210px] pointer-events-auto space-y-2 select-none ${
                  northArrowPos === "bottom-left" ? "top-4 right-4" : "bottom-4 left-4"
                }`}>
                  <div className="border-b pb-1">
                    <h5 className="font-extrabold text-[9px] uppercase tracking-wider text-slate-700 flex items-center gap-1">
                      📊 Legend: <span className="text-indigo-650 font-black">{mapExceedanceParam}</span> Class
                    </h5>
                    <span className="text-[7.5px] font-black uppercase text-slate-400">Custom labels allowed</span>
                  </div>
                  <div className="space-y-1.5 text-[9px]">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm border border-slate-300 shrink-0" style={{ backgroundColor: colorBelow }}></div>
                      <span className="font-bold text-slate-600 truncate max-w-[170px]" title={legendLabelBelow}>
                        {legendLabelBelow}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm border border-slate-300 shrink-0" style={{ backgroundColor: colorBetween }}></div>
                      <span className="font-bold text-slate-600 truncate max-w-[170px]" title={legendLabelBetween}>
                        {legendLabelBetween}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm border border-slate-300 shrink-0" style={{ backgroundColor: colorAbove }}></div>
                      <span className="font-bold text-slate-600 truncate max-w-[170px]" title={legendLabelAbove}>
                        {legendLabelAbove}
                      </span>
                    </div>
                    {shapefileGeoJson && (
                      <div className="flex items-center gap-2 pt-1 border-t border-dashed border-slate-100">
                        <div className="w-3 h-1.5 rounded-xs shrink-0" style={{ backgroundColor: shapefileColor, height: `${shapefileWeight}px` }}></div>
                        <span className="font-bold text-slate-500 truncate max-w-[170px]" title={legendLabelBoundary}>
                          {legendLabelBoundary}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : viewMode === "completeness" ? (
          <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-lg flex flex-col h-[650px] w-full">
            <div className="flex justify-between items-center p-4 bg-slate-50 border-b border-slate-200 sticky top-0 shrink-0 z-20">
              <span className="text-[10px] font-black uppercase text-indigo-650 flex items-center gap-1">
                <BookOpen className="w-4 h-4" /> Quality Assurance & Data Completeness Indexes
              </span>
              <div className="flex bg-slate-200/60 p-0.5 rounded-xl border border-slate-300 gap-1 font-bold text-[9px]">
                {(["state", "district", "block"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setMatrixLevel(lvl)}
                    className={`px-3 py-1.5 rounded-lg uppercase tracking-wider ${
                      matrixLevel === lvl ? "bg-white text-indigo-650 shadow-xs" : "text-slate-600"
                    }`}
                  >
                    {lvl} Matrix
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-auto flex-1 custom-scrollbar">
              <table className="w-full text-left text-[10px] border-collapse min-w-max">
                <thead className="bg-slate-900 text-white font-black uppercase tracking-widest sticky top-0 z-15">
                  <tr>
                    {matrixLevel !== "state" && <th rowSpan={2} className="p-3 border-r border-slate-800">State</th>}
                    {matrixLevel === "block" && <th rowSpan={2} className="p-3 border-r border-slate-800">District</th>}
                    <th rowSpan={2} className="p-3 border-r border-slate-800 sticky left-0 bg-slate-900 z-10">{matrixLevel} Name</th>
                    <th rowSpan={2} className="p-3 border-r border-slate-800 text-center bg-slate-850">Total Rows</th>
                    <th colSpan={2} className="p-2 border-r border-slate-800 text-center bg-blue-900/90">USSL Valid</th>
                    <th colSpan={2} className="p-2 border-r border-slate-800 text-center bg-purple-900/90">Facies Valid</th>
                    <th colSpan={2} className="p-2 border-r border-slate-800 text-center bg-teal-900/90">Gibbs Valid</th>
                    <th colSpan={2} className="p-2 text-center bg-emerald-900/90">FULLY COMPLETE</th>
                  </tr>
                  <tr>
                    <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850">Count</th>
                    <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850 text-blue-300">%</th>
                    <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850">Count</th>
                    <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850 text-purple-300">%</th>
                    <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850">Count</th>
                    <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850 text-teal-300">%</th>
                    <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850">Count</th>
                    <th className="p-2 border-t border-slate-800 text-center bg-slate-850 text-emerald-300">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!analytics["comp_" + matrixLevel] || analytics["comp_" + matrixLevel].length === 0) ? (
                    <tr>
                      <td colSpan={12} className="p-12 text-center text-slate-400 font-bold uppercase tracking-wider bg-white">
                        No data uploaded yet. Please upload a spreadsheet to view completeness index stats.
                      </td>
                    </tr>
                  ) : (
                    analytics["comp_" + matrixLevel]?.map((r: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        {matrixLevel !== "state" && <td className="p-2 border-r border-slate-100 font-medium text-slate-500">{r.State}</td>}
                        {matrixLevel === "block" && <td className="p-2 border-r border-slate-100 font-medium text-slate-500">{r.District}</td>}
                        <td className="p-2 border-r border-slate-100 font-bold sticky left-0 bg-white group-hover:bg-slate-50 z-10">{r.Name}</td>
                        <td className="p-2 border-r border-slate-100 text-center font-bold text-slate-700 bg-slate-50">{r.Total}</td>

                        <td className="p-2 border-r border-slate-100 text-center text-slate-600">{r.validUSSL_count}</td>
                        <td className="p-2 border-r border-slate-100 text-center font-bold text-indigo-600 bg-indigo-50/20">{r.validUSSL_perc}%</td>

                        <td className="p-2 border-r border-slate-100 text-center text-slate-600">{r.validFacies_count}</td>
                        <td className="p-2 border-r border-slate-100 text-center font-bold text-fuchsia-600 bg-fuchsia-50/20">{r.validFacies_perc}%</td>

                        <td className="p-2 border-r border-slate-100 text-center text-slate-600">{r.validGibbs_count}</td>
                        <td className="p-2 border-r border-slate-100 text-center font-bold text-teal-600 bg-teal-50/20">{r.validGibbs_perc}%</td>

                        <td className="p-2 border-r border-slate-100 text-center font-black text-emerald-600">{r.complete_count}</td>
                        <td className="p-2 text-center font-black text-white bg-emerald-500">{r.complete_perc}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : viewMode === "analytics_ussl" || viewMode === "analytics_facies" ? (
          <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-lg flex flex-col h-[650px] w-full">
            <div className="flex justify-between items-center p-4 bg-slate-50 border-b border-slate-200 sticky top-0 shrink-0 z-20">
              <span className="text-[10px] font-black uppercase text-indigo-650 flex items-center gap-1">
                <Table className="w-4 h-4 text-indigo-500" /> {viewMode === "analytics_ussl" ? "USSL Salinity/Sodicity" : "Hydro-Facies"} Spatial Breakdown Distribution
              </span>
              <div className="flex bg-slate-200/60 p-0.5 rounded-xl border border-slate-300 gap-1 font-bold text-[9px]">
                {(["state", "district", "block"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setMatrixLevel(lvl)}
                    className={`px-3 py-1.5 rounded-lg uppercase tracking-wider ${
                      matrixLevel === lvl ? "bg-white text-indigo-650" : "text-slate-600"
                    }`}
                  >
                    {lvl} Wise
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-auto flex-1 custom-scrollbar">
              <table className="w-full text-left text-[10px] border-collapse min-w-max">
                <thead className="bg-slate-900 text-white font-black uppercase tracking-widest sticky top-0 z-15">
                  <tr>
                    {matrixLevel !== "state" && <th rowSpan={2} className="p-3 border-r border-slate-800">State</th>}
                    {matrixLevel === "block" && <th rowSpan={2} className="p-3 border-r border-slate-800">District</th>}
                    <th rowSpan={2} className="p-3 border-r border-slate-800 sticky left-0 bg-slate-900 z-10">{matrixLevel} Name</th>
                    <th rowSpan={2} className="p-3 border-r border-slate-800 text-center bg-slate-850">Valid Rows</th>
                    {viewMode === "analytics_ussl" && stats.ussl.map((s) => (
                      <th key={s.key} colSpan={2} className="p-2 border-r border-slate-800 text-center bg-blue-900/80">{s.name}</th>
                    ))}
                    {viewMode === "analytics_facies" && stats.facies.map((s) => (
                      <th key={s.key} colSpan={2} className="p-2 border-r border-slate-800 text-center bg-purple-900/80">{s.name}</th>
                    ))}
                  </tr>
                  <tr>
                    {viewMode === "analytics_ussl" && stats.ussl.map((s) => (
                      <React.Fragment key={s.key}>
                        <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850">n</th>
                        <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850 text-blue-300">%</th>
                      </React.Fragment>
                    ))}
                    {viewMode === "analytics_facies" && stats.facies.map((s) => (
                      <React.Fragment key={s.key}>
                        <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850">n</th>
                        <th className="p-2 border-r border-t border-slate-800 text-center bg-slate-850 text-purple-300">%</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!analytics[matrixLevel] || analytics[matrixLevel].length === 0) ? (
                    <tr>
                      <td colSpan={viewMode === "analytics_ussl" ? 4 + stats.ussl.length * 2 : 4 + stats.facies.length * 2} className="p-12 text-center text-slate-400 font-bold uppercase tracking-wider bg-white">
                        No data uploaded yet. Please upload a spreadsheet to view spatial breakdown distribution stats.
                      </td>
                    </tr>
                  ) : (
                    analytics[matrixLevel]?.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        {matrixLevel !== "state" && <td className="p-2 border-r border-slate-100 font-medium text-slate-500">{row.State}</td>}
                        {matrixLevel === "block" && <td className="p-2 border-r border-slate-100 font-medium text-slate-500">{row.District}</td>}
                        <td className="p-2 border-r border-slate-100 font-bold sticky left-0 bg-white group-hover:bg-slate-50 z-10">{row.Name}</td>
                        <td className="p-2 border-r border-slate-100 text-center font-bold text-blue-700 bg-blue-50/20">{row.Total}</td>

                        {viewMode === "analytics_ussl" && stats.ussl.map((s) => (
                          <React.Fragment key={s.key}>
                            <td className="p-2 border-r border-slate-100 text-center text-slate-600">{row[`${s.key}_count`] || "-"}</td>
                            <td className="p-2 border-r border-slate-100 text-center font-bold text-slate-500 bg-slate-50/50">{row[`${s.key}_perc`] ? `${row[`${s.key}_perc`]}%` : "-"}</td>
                          </React.Fragment>
                        ))}

                        {viewMode === "analytics_facies" && stats.facies.map((s) => (
                          <React.Fragment key={s.key}>
                            <td className="p-2 border-r border-slate-100 text-center text-slate-600">{row[`${s.key}_count`] || "-"}</td>
                            <td className="p-2 border-r border-slate-100 text-center font-bold text-slate-500 bg-slate-50/50">{row[`${s.key}_perc`] ? `${row[`${s.key}_perc`]}%` : "-"}</td>
                          </React.Fragment>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-lg flex flex-col h-[650px] w-full">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0 z-10">
              <span className="text-[10px] font-black uppercase text-indigo-650 flex items-center gap-1">
                <Table className="w-4 h-4 text-indigo-500" /> Analytically Valid Chemical Rows
              </span>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                {validData.length} Completed Samples
              </span>
            </div>
            <div className="overflow-auto flex-1 custom-scrollbar">
              <table className="w-full text-left text-[11px] whitespace-nowrap border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-black uppercase tracking-widest border-b border-slate-200 sticky top-0 z-10 shadow-xs">
                  <tr>
                    <th className="p-3">SL</th>
                    <th className="p-3">State</th>
                    <th className="p-3">District</th>
                    <th className="p-3">Block</th>
                    <th className="p-3">Location Name</th>
                    <th className="p-3">EC (μS/cm)</th>
                    <th className="p-3">SAR</th>
                    <th className="p-3">% Sodium</th>
                    <th className="p-3">USSL Class</th>
                    <th className="p-3">Hydro-Facies</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {validData.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-12 text-center text-slate-400 font-bold uppercase tracking-wider bg-white">
                        No data uploaded yet. Please upload a spreadsheet to view plottable water records.
                      </td>
                    </tr>
                  ) : (
                    validData.map((d, i) => (
                      <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-3 text-slate-500 font-mono">{d._calc.sl}</td>
                        <td className="p-3 text-slate-600 font-medium">{stateHeader ? String(d[stateHeader] || "-") : "-"}</td>
                        <td className="p-3 text-slate-600 font-medium">{distHeader ? String(d[distHeader] || "-") : "-"}</td>
                        <td className="p-3 text-slate-600 font-medium">{blockHeader ? String(d[blockHeader] || "-") : "-"}</td>
                        <td className="p-3 font-bold text-slate-900">{d._calc.locName}</td>
                        <td className="p-3 font-mono text-slate-700 font-bold">{d._calc.ecVal || "-"}</td>
                        <td className="p-3 font-mono text-amber-600 font-bold">{d._calc.sar.toFixed(2)}</td>
                        <td className="p-3 font-mono text-emerald-600 font-bold">{d._calc.naPerc.toFixed(1)}%</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black" style={{ backgroundColor: (usslColors[d._calc.ussl] || "#64748b") + "20", color: usslColors[d._calc.ussl] || "#64748b" }}>
                            {d._calc.ussl}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[9px] font-black" style={{ backgroundColor: (faciesColors[d._calc.facies] || "#64748b") + "20", color: faciesColors[d._calc.facies] || "#64748b" }}>
                            {faciesNames[d._calc.facies] || d._calc.facies}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )

      ) : (
        <div className="py-24 text-center border-2 border-dashed border-slate-300 rounded-[3rem] bg-indigo-50/10">
          <UploadCloud className="w-12 h-12 text-slate-300 mx-auto mb-3 animate-pulse" />
          <p className="text-slate-500 font-black uppercase tracking-widest text-[11px] italic">
            Waiting for USSL Data Import to generate diagrams and classifications
          </p>
        </div>
      )}
    </div>
  );
}

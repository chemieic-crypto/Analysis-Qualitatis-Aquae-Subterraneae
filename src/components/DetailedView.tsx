import React, { useState, useEffect, useRef } from "react";
import Highcharts from "highcharts";
// @ts-ignore
import HighchartsMore from "highcharts/highcharts-more";
import { DataHeaders, GroupedStatRow, ShapefileLayer } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { getStats } from "../utils/math";
import { buildDonutChartOptions, generateOfflineChartBase64 } from "../utils/chartHelpers";
import { Settings2, Image, ChevronDown, Check, Circle, Maximize2, Send, X, BarChart3, SlidersHorizontal, Activity, Table, PieChart, TrendingUp } from "lucide-react";


const getCategoryColor = (name: string, index: number) => {
  const palette = [
    "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", 
    "#ec4899", "#06b6d4", "#14b8a6", "#f43f5e", "#a855f7",
    "#6366f1", "#22c55e", "#eab308", "#3a86ff", "#8338ec",
    "#fb5607", "#00f5d4", "#70e000"
  ];
  return palette[index % palette.length];
};

const hexToRgba = (hex: string, alpha: number) => {
  if (!hex || hex[0] !== '#') return `rgba(99, 102, 241, ${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

try {
  if (typeof Highcharts === "object") {
    (HighchartsMore as any)(Highcharts);
  }
} catch (err) {
  console.warn("HighchartsMore error in DetailedView:", err);
}

function toTableHeaderUnit(unit: string): string {
  return unit;
}

function getTableHeaderLabels(configKey: string, config: any) {
  const unit = config?.unit || "";
  const unitStr = unit ? ` ${toTableHeaderUnit(unit)}` : "";
  const isSingle = config ? (config.b1 === config.b2 && configKey !== "pH") : false;

  if (configKey === "pH") {
    return {
      acc: "pH: 6.5–8.5",
      perm: "",
      fail: "Above Permissible Limit (pH: <6.5 or >8.5)"
    };
  }

  if (isSingle) {
    return {
      acc: `≤${config.b1}${unitStr}`,
      perm: "",
      fail: `Above Permissible Limit (>${config.b1}${unitStr})`
    };
  }

  return {
    acc: `≤${config.b1}${unitStr}`,
    perm: `>${config.b1}–${config.b2}${unitStr}`,
    fail: `Above Permissible Limit (>${config.b2}${unitStr})`
  };
}

interface DetailedViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState: string;
  selectedDistrict: string;
  reportingLevel: "State" | "District" | "Block";
  activeParam: string;
  setActiveParam: (val: string) => void;
  exportParams: string[];
  setExportParams: (val: string[]) => void;
  combinedParams: string[];
  setCombinedParams: (val: string[]) => void;
  exportIndividualExceedance: boolean;
  setExportIndividualExceedance: (val: boolean) => void;
  exportCombinedExceedance: boolean;
  setExportCombinedExceedance: (val: boolean) => void;
  sharedBulletinMaps?: Record<string, string>;
  setSharedBulletinMaps?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  allRawData?: any[];
  selectedYear?: string;
  selectedSeason?: string;
  layers?: ShapefileLayer[];
  setLayers?: React.Dispatch<React.SetStateAction<ShapefileLayer[]>>;
}

const VIRTUAL_CONFIGS: Record<string, { b1: number; b2: number; unit: string; name: string; perm: number }> = {
  SAR: { b1: 10, b2: 18, unit: "Ratio", name: "Sodium Adsorption Ratio (SAR)", perm: 0 },
  RSC: { b1: 1.25, b2: 2.5, unit: "meq/L", name: "Residual Sodium Carbonate (RSC)", perm: 0 },
  SSP: { b1: 40, b2: 60, unit: "%", name: "Soluble Sodium Percentage (SSP)", perm: 0 },
  "Na%": { b1: 40, b2: 60, unit: "%", name: "Sodium Percentage (%Na)", perm: 0 },
  PI: { b1: 25, b2: 75, unit: "%", name: "Permeability Index (PI)", perm: 0 },
  KR: { b1: 1.0, b2: 2.0, unit: "Ratio", name: "Kelly's Ratio (KR)", perm: 0 },
  MH: { b1: 50, b2: 50, unit: "%", name: "Magnesium Hazard (MH)", perm: 0 },
  TDS: { b1: 500, b2: 2000, unit: "mg/l", name: "Total Dissolved Solids (TDS)", perm: 0 },
  Alkalinity: { b1: 200, b2: 600, unit: "mg/l", name: "Total Alkalinity", perm: 0 }
};

export default function DetailedView({
  rawData,
  headers,
  headerMap,
  selectedState,
  selectedDistrict,
  reportingLevel,
  activeParam,
  setActiveParam,
  exportParams,
  setExportParams,
  combinedParams,
  setCombinedParams,
  exportIndividualExceedance,
  setExportIndividualExceedance,
  exportCombinedExceedance,
  setExportCombinedExceedance,
  sharedBulletinMaps,
  setSharedBulletinMaps,
  allRawData = [],
  selectedYear = "",
  selectedSeason = "",
  layers,
  setLayers,
}: DetailedViewProps) {
  // Analytical filters
  const [groupScope, setGroupScope] = useState<"selected" | "national">("selected");
  const [exceedanceFilter, setExceedanceFilter] = useState<"all" | "affected">("all");

  const [sentItems, setSentItems] = useState<Record<string, boolean>>({});
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedStatesList, setSelectedStatesList] = useState<string[]>([]);
  const [selectedDistrictsList, setSelectedDistrictsList] = useState<string[]>([]);
  const [stateSearch, setStateSearch] = useState("");
  const [districtSearch, setDistrictSearch] = useState("");

  const allStates = React.useMemo(() => {
    if (!allRawData || !headers.state) return [];
    const states = new Set<string>();
    allRawData.forEach(row => {
      const s = String(row[headers.state] || "").trim();
      if (s) states.add(s);
    });
    return Array.from(states).sort();
  }, [allRawData, headers.state]);

  const allDistricts = React.useMemo(() => {
    if (!allRawData || !headers.district) return [];
    const districts = new Set<string>();
    allRawData.forEach(row => {
      const d = String(row[headers.district] || "").trim();
      if (d) districts.add(d);
    });
    return Array.from(districts).sort();
  }, [allRawData, headers.district]);

  const filteredStatesForSelect = React.useMemo(() => {
    return allStates.filter(s => s.toLowerCase().includes(stateSearch.toLowerCase()));
  }, [allStates, stateSearch]);

  const filteredDistrictsForSelect = React.useMemo(() => {
    return allDistricts.filter(d => d.toLowerCase().includes(districtSearch.toLowerCase()));
  }, [allDistricts, districtSearch]);

  const getPeriodKey = (row: any) => {
    const yr = headers.year ? String(row[headers.year] || "").trim() : "";
    const seas = headers.season ? String(row[headers.season] || "").trim() : "";
    let key = "";
    if (yr && seas) {
      key = `${yr} ${seas}`;
    } else if (seas) {
      key = seas;
    } else if (yr) {
      key = yr;
    }
    return key && key !== "Unknown" ? key : "All Data";
  };

  // Chart Customization State
  const [chartTitle, setChartTitle] = useState("");
  const [exceedanceChartTitle, setExceedanceChartTitle] = useState("");
  const [exceedanceXAxisTitle, setExceedanceXAxisTitle] = useState("");
  const [exceedanceYAxisTitle, setExceedanceYAxisTitle] = useState("");
  const [seasonalChartTitle, setSeasonalChartTitle] = useState("");
  const [seasonalXAxisTitle, setSeasonalXAxisTitle] = useState("");
  const [seasonalYAxisTitle, setSeasonalYAxisTitle] = useState("");

  const [chartTheme, setChartTheme] = useState("theme-white");
  const [fontFamily, setFontFamily] = useState("'Plus Jakarta Sans'");
  const [fontSize, setFontSize] = useState(12);
  const [fontBold, setFontBold] = useState(true);
  const [colorAcc, setColorAcc] = useState("#10b981");

  const getParamVal = React.useCallback((row: any, paramName: string): number => {
    const isVirtual = ["SAR", "RSC", "SSP", "Na%", "PI", "KR", "MH", "TDS", "Alkalinity"].includes(paramName);
    if (isVirtual) {
      // First check if there is an actual Excel column mapped to the parameter
      const excelCol = headerMap[paramName];
      if (excelCol && row[excelCol] !== undefined && row[excelCol] !== null) {
        const parsedVal = parseFloat(row[excelCol]);
        if (!isNaN(parsedVal)) return parsedVal;
      }
      
      const caCol = Object.keys(headerMap).find(k => headerMap[k] === "Ca") || "Ca";
      const mgCol = Object.keys(headerMap).find(k => headerMap[k] === "Mg") || "Mg";
      const naCol = Object.keys(headerMap).find(k => headerMap[k] === "Na") || "Na";
      const kCol = Object.keys(headerMap).find(k => headerMap[k] === "K") || "K";
      const hco3Col = Object.keys(headerMap).find(k => headerMap[k] === "HCO3") || "HCO3";
      const co3Col = Object.keys(headerMap).find(k => headerMap[k] === "CO3") || "CO3";
      const ecCol = Object.keys(headerMap).find(k => headerMap[k] === "EC") || "EC";
      const tdsCol = Object.keys(headerMap).find(k => headerMap[k] === "TDS") || "TDS";
      const alkCol = Object.keys(headerMap).find(k => headerMap[k] === "Alkalinity") || "Alkalinity";
      
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

      if (paramName === "SAR") {
        if (!isNaN(caVal) && !isNaN(mgVal) && !isNaN(naVal)) {
          const denom = Math.sqrt((caMeq + mgMeq) / 2);
          return denom > 0 ? naMeq / denom : NaN;
        }
      } else if (paramName === "RSC") {
        if (!isNaN(caVal) && !isNaN(mgVal) && !isNaN(hco3Val)) {
          return hco3Meq + co3Meq - (caMeq + mgMeq);
        }
      } else if (paramName === "TDS") {
        if (!isNaN(tdsVal)) return tdsVal;
        if (!isNaN(ecVal)) return ecVal * 0.65;
      } else if (paramName === "Alkalinity") {
        if (!isNaN(alkVal)) return alkVal;
        if (!isNaN(hco3Val)) return (hco3Meq + co3Meq) * 50;
      } else if (paramName === "SSP" || paramName === "Na%") {
        const sum = caMeq + mgMeq + naMeq + kMeq;
        if (sum > 0) return ((naMeq + kMeq) * 100) / sum;
      } else if (paramName === "PI") {
        const denom = caMeq + mgMeq + naMeq;
        if (denom > 0) return ((naMeq + Math.sqrt(hco3Meq)) * 100) / denom;
      } else if (paramName === "KR") {
        const denom = caMeq + mgMeq;
        if (denom > 0) return naMeq / denom;
      } else if (paramName === "MH") {
        const denom = caMeq + mgMeq;
        if (denom > 0) return (mgMeq * 100) / denom;
      }
      return NaN;
    } else {
      const realCol = headerMap[paramName] || paramName;
      return parseFloat(row[realCol] || row[paramName]);
    }
  }, [headerMap]);

  // Filter out Na, K, HCO3, CO3 from detailed views (parameters without BIS limits) and include virtual/calculated parameters
  const availableParams = React.useMemo(() => {
    if (!headers || !headers.params) return [];
    const base = headers.params.filter(p => {
      const paramId = headerMap[p] || p;
      return !["Na", "K", "HCO3", "CO3"].includes(paramId);
    });

    const extras = ["Alkalinity", "SAR", "RSC", "SSP", "Na%", "PI", "KR", "MH", "TDS"];
    extras.forEach(ext => {
      if (!base.includes(ext)) {
        base.push(ext);
      }
    });
    return base;
  }, [headers, headerMap]);
  const [colorPerm, setColorPerm] = useState("#f59e0b");
  const [colorFail, setColorFail] = useState("#f43f5e");

  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [combinedDropdownOpen, setCombinedDropdownOpen] = useState(false);

  // Grouped stats data
  const [tableRows, setTableRows] = useState<GroupedStatRow[]>([]);
  const [grandTotalRow, setGrandTotalRow] = useState<GroupedStatRow | null>(null);

  // Fullscreen and sending states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const chartRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeConfigKey = activeParam === "SAR" ? "SAR" : activeParam === "RSC" ? "RSC" : (headerMap[activeParam] || "");
  const activeConfig = PARAM_CONFIG[activeConfigKey] || PARAM_CONFIG[activeParam] || VIRTUAL_CONFIGS[activeParam] || { b1: 0, b2: 0, unit: "units", perm: 0, name: activeParam };

  // Tab state for additional statistical charts
  const [statTab, setStatTab] = useState<"boxplot" | "average" | "violin" | "donut" | "ogive">("boxplot");

  const uniquePeriods = React.useMemo(() => {
    const periods = new Set<string>();
    const dataToUse = groupScope === "national" ? (allRawData || rawData) : rawData;
    
    dataToUse.forEach(row => {
      const yr = headers.year ? String(row[headers.year] || "").trim() : "";
      const seas = headers.season ? String(row[headers.season] || "").trim() : "";
      
      let key = "";
      if (yr && seas) {
        key = `${yr} ${seas}`;
      } else if (seas) {
        key = seas;
      } else if (yr) {
        key = yr;
      }
      
      if (key && key !== "Unknown") {
        periods.add(key);
      }
    });
    
    if (periods.size === 0) {
      periods.add("All Data");
    }
    
    return Array.from(periods).sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aHasPre = aLower.includes("pre") || aLower.includes("prm");
      const bHasPre = bLower.includes("pre") || bLower.includes("prm");
      const aHasPost = aLower.includes("post") || aLower.includes("pom") || aLower.includes("after");
      const bHasPost = bLower.includes("post") || bLower.includes("pom") || bLower.includes("after");
      
      if (aHasPre && bHasPost) return -1;
      if (aHasPost && bHasPre) return 1;
      
      return a.localeCompare(b);
    });
  }, [rawData, allRawData, groupScope, headers.year, headers.season]);

  const isGroupAffected = (samples: any[]) => {
    if (!samples || samples.length === 0) return false;
    return samples.some(row => {
      let val = getParamVal(row, activeParam);

      if (isNaN(val)) return false;

      if (activeParam === "SAR") {
        return val > 26;
      } else if (activeParam === "RSC") {
        return val > 2.5;
      } else if (activeParam === "SSP" || activeParam === "Na%") {
        return val > 60;
      } else if (activeParam === "PI") {
        return val < 25;
      } else if (activeParam === "KR") {
        return val > 1.0;
      } else if (activeParam === "MH") {
        return val > 50;
      } else if (activeConfigKey === "pH") {
        return val < activeConfig.b1 || val > activeConfig.b2;
      } else if (activeConfig.b1 === activeConfig.b2) {
        return val > activeConfig.b1;
      } else {
        return val > activeConfig.b2;
      }
    });
  };

  const seasonalGroupedData = React.useMemo(() => {
    if (!activeParam || !activeConfig) return {};

    let filtered = groupScope === "national" ? (allRawData || rawData) : rawData;

    if (groupScope === "selected") {
      if (multiSelectMode) {
        if (selectedStatesList.length > 0) {
          filtered = filtered.filter(
            (d) => selectedStatesList.includes(String(d[headers.state || ""] || "").trim())
          );
        }
        if (selectedDistrictsList.length > 0) {
          filtered = filtered.filter(
            (d) => selectedDistrictsList.includes(String(d[headers.district || ""] || "").trim())
          );
        }
      } else {
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
      }
    }

    const groupKey =
      groupScope === "national"
        ? headers.state
        : reportingLevel === "State"
        ? headers.state
        : reportingLevel === "District"
        ? headers.district
        : headers.block;

    if (!groupKey) return {};

    const results: Record<string, Record<string, number[]>> = {};

    const samplesByGroup: Record<string, any[]> = {};
    filtered.forEach((row) => {
      const gName = String(row[groupKey] || "Unknown").trim();
      if (!samplesByGroup[gName]) {
        samplesByGroup[gName] = [];
      }
      samplesByGroup[gName].push(row);
    });

    const validGroups = Object.keys(samplesByGroup).filter((gName) => {
      if (exceedanceFilter === "all") return true;
      return isGroupAffected(samplesByGroup[gName]);
    });

    filtered.forEach((row) => {
      const gName = String(row[groupKey] || "Unknown").trim();
      if (!validGroups.includes(gName)) return;

      let sName = "All Data";
      const rawS = headers.season ? String(row[headers.season] || "").trim() : "";
      const rawY = headers.year ? String(row[headers.year] || "").trim() : "";
      
      if (rawS && rawS !== "Unknown" && rawY && rawY !== "Unknown") {
        sName = `${rawS} ${rawY}`;
      } else if (rawS && rawS !== "Unknown") {
        sName = rawS;
      } else if (rawY && rawY !== "Unknown") {
        sName = rawY;
      }

      let val = getParamVal(row, activeParam);

      if (!isNaN(val)) {
        if (!results[sName]) {
          results[sName] = {};
        }
        if (!results[sName][gName]) {
          results[sName][gName] = [];
        }
        results[sName][gName].push(val);
      }
    });

    return results;
  }, [rawData, allRawData, groupScope, exceedanceFilter, activeParam, selectedState, selectedDistrict, reportingLevel, headers, headerMap, activeConfig, multiSelectMode, selectedStatesList, selectedDistrictsList]);

  const exceedanceChartData = React.useMemo(() => {
    const dataToUse = groupScope === "national" ? (allRawData || rawData) : rawData;
    
    let filtered = dataToUse;
    if (groupScope === "selected") {
      if (multiSelectMode) {
        if (selectedStatesList.length > 0) {
          filtered = filtered.filter(
            (d) => selectedStatesList.includes(String(d[headers.state || ""] || "").trim())
          );
        }
        if (selectedDistrictsList.length > 0) {
          filtered = filtered.filter(
            (d) => selectedDistrictsList.includes(String(d[headers.district || ""] || "").trim())
          );
        }
      } else {
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
      }
    }

    const groupKey =
      groupScope === "national"
        ? headers.state
        : reportingLevel === "State"
        ? headers.state
        : reportingLevel === "District"
        ? headers.district
        : headers.block;

    if (!groupKey) return { categories: [], series: [] };

    const groupPeriodVals: Record<string, Record<string, number[]>> = {};
    const allGroups = new Set<string>();

    filtered.forEach((row) => {
      const gName = String(row[groupKey] || "Unknown").trim();
      allGroups.add(gName);

      const pKey = getPeriodKey(row);

      let val = getParamVal(row, activeParam);

      if (!isNaN(val)) {
        if (!groupPeriodVals[gName]) {
          groupPeriodVals[gName] = {};
        }
        if (!groupPeriodVals[gName][pKey]) {
          groupPeriodVals[gName][pKey] = [];
        }
        groupPeriodVals[gName][pKey].push(val);
      }
    });

    let categoriesList = Array.from(allGroups).sort();
    if (exceedanceFilter === "affected") {
      categoriesList = categoriesList.filter(gName => {
        const allGroupSamples: number[] = [];
        const groupPeriods = groupPeriodVals[gName] || {};
        Object.values(groupPeriods).forEach(vals => allGroupSamples.push(...vals));
        
        return allGroupSamples.some(v => {
          if (activeParam === "SAR") {
            return v > 26;
          } else if (activeConfigKey === "pH") {
            return v < activeConfig.b1 || v > activeConfig.b2;
          } else if (activeConfig.b1 === activeConfig.b2) {
            return v > activeConfig.b1;
          } else {
            return v > activeConfig.b2;
          }
        });
      });
    }

    const seriesList = uniquePeriods.map((period) => {
      const data = categoriesList.map((cat, catIdx) => {
        const vals = (groupPeriodVals[cat] && groupPeriodVals[cat][period]) || [];
        if (vals.length === 0) return { y: 0, color: getCategoryColor(cat, catIdx) };
        
        let failCount = 0;
        vals.forEach((v) => {
          if (activeParam === "SAR") {
            if (v > 26) failCount++;
          } else if (activeConfigKey === "pH") {
            if (v < activeConfig.b1 || v > activeConfig.b2) failCount++;
          } else if (activeConfig.b1 === activeConfig.b2) {
            if (v > activeConfig.b1) failCount++;
          } else {
            if (v > activeConfig.b2) failCount++;
          }
        });

        const pct = parseFloat(((failCount / vals.length) * 100).toFixed(1));
        const color = getCategoryColor(cat, catIdx);
        return {
          y: pct,
          color: color
        };
      });

      return {
        name: period,
        data: data
      };
    });

    return {
      categories: categoriesList,
      series: seriesList
    };
  }, [rawData, allRawData, groupScope, exceedanceFilter, activeParam, selectedState, selectedDistrict, reportingLevel, headers, headerMap, activeConfig, uniquePeriods, multiSelectMode, selectedStatesList, selectedDistrictsList]);

  const calculateBoxPlotStats = (values: number[]) => {
    if (values.length === 0) {
      return { low: 0, q1: 0, median: 0, q3: 0, high: 0 };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    
    const getPercentile = (p: number) => {
      if (sorted.length === 1) return sorted[0];
      const index = (sorted.length - 1) * p;
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const weight = index - lower;
      return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    };

    const q1 = getPercentile(0.25);
    const median = getPercentile(0.5);
    const q3 = getPercentile(0.75);

    return { low, q1, median, q3, high };
  };

  const getViolinSeriesAndCategories = (groupsData: { name: string; values: number[] }[]) => {
    const series: any[] = [];
    
    groupsData.forEach((group, i) => {
      const vals = group.values.filter(v => !isNaN(v));
      if (vals.length === 0) return;
      
      const categoryColor = getCategoryColor(group.name, i);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const avg = vals.reduce((sum, v) => sum + v, 0) / vals.length;
      
      const std = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / vals.length) || 1.0;
      const bandwidth = 1.06 * std * Math.pow(vals.length, -0.2) || 0.5;
      
      const steps = 30;
      const padding = 1.5 * bandwidth;
      const yStart = min - padding;
      const yEnd = max + padding;
      const stepSize = (yEnd - yStart) / steps;
      
      const densityPoints: { y: number; density: number }[] = [];
      for (let j = 0; j <= steps; j++) {
        const yVal = yStart + j * stepSize;
        let sumDensity = 0;
        vals.forEach(v => {
          const u = (yVal - v) / bandwidth;
          const kernelVal = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * u * u);
          sumDensity += kernelVal;
        });
        const density = sumDensity / (vals.length * bandwidth);
        densityPoints.push({ y: yVal, density });
      }
      
      const maxD = Math.max(...densityPoints.map(p => p.density)) || 1.0;
      const scale = 0.35 / maxD;
      
      const polygonData: [number, number][] = [];
      for (let j = 0; j <= steps; j++) {
        const p = densityPoints[j];
        polygonData.push([i - p.density * scale, p.y]);
      }
      for (let j = steps; j >= 0; j--) {
        const p = densityPoints[j];
        polygonData.push([i + p.density * scale, p.y]);
      }
      
      series.push({
        name: group.name,
        type: "polygon",
        data: polygonData,
        color: hexToRgba(categoryColor, 0.45),
        borderColor: categoryColor,
        borderWidth: 1.5,
        tooltip: {
          headerFormat: `<b>${group.name}</b><br/>`,
          pointFormat: `Value: <b>{point.y:.2f}</b>`
        },
        showInLegend: false
      });
      
      const boxStats = calculateBoxPlotStats(vals);
      
      series.push({
        name: `${group.name} IQR`,
        type: "line",
        data: [[i, boxStats.q1], [i, boxStats.q3]],
        color: "#111827",
        lineWidth: 4,
        marker: { enabled: false },
        showInLegend: false,
        enableMouseTracking: false
      });
      
      series.push({
        name: `${group.name} Range`,
        type: "line",
        data: [[i, boxStats.low], [i, boxStats.high]],
        color: "#4b5563",
        lineWidth: 1.5,
        marker: { enabled: false },
        showInLegend: false,
        enableMouseTracking: false
      });
      
      series.push({
        name: `${group.name} Median`,
        type: "scatter",
        data: [[i, boxStats.median]],
        marker: {
          symbol: "circle",
          fillColor: "#ffffff",
          lineColor: "#111827",
          lineWidth: 2,
          radius: 4
        },
        showInLegend: false,
        tooltip: {
          pointFormat: `Median: <b>{point.y:.2f}</b>`
        }
      });
    });
    
    return series;
  };

  const drawBoxPlots = (season: string, containerId: string) => {
    const seasonData = seasonalGroupedData[season] || {};
    const categories = Object.keys(seasonData).sort();
    
    const boxData = categories.map((cat, catIdx) => {
      const vals = seasonData[cat] || [];
      const stats = calculateBoxPlotStats(vals);
      const color = getCategoryColor(cat, catIdx);
      return {
        x: catIdx,
        low: stats.low,
        q1: stats.q1,
        median: stats.median,
        q3: stats.q3,
        high: stats.high,
        color: color,
        fillColor: hexToRgba(color, 0.25)
      };
    });

    const outlierData: any[] = [];
    categories.forEach((cat, catIdx) => {
      const vals = seasonData[cat] || [];
      const stats = calculateBoxPlotStats(vals);
      const iqr = stats.q3 - stats.q1;
      const lowerBound = stats.q1 - 1.5 * iqr;
      const upperBound = stats.q3 + 1.5 * iqr;
      const color = getCategoryColor(cat, catIdx);
      
      vals.forEach((v) => {
        if (v < lowerBound || v > upperBound) {
          outlierData.push({
            x: catIdx,
            y: v,
            color: color
          });
        }
      });
    });

    const options: Highcharts.Options = {
      chart: {
        type: "boxplot",
        backgroundColor: "transparent"
      },
      title: {
        text: seasonalChartTitle ? `${seasonalChartTitle} - ${season}` : `${activeParam} Box Plot - ${season}`,
        style: { fontWeight: "bold", color: "#1e293b", fontSize: "14px", fontFamily: fontFamily }
      },
      xAxis: {
        categories: categories,
        title: { text: seasonalXAxisTitle || (reportingLevel === "State" ? "State" : reportingLevel === "District" ? "District" : "Block") },
        labels: { style: { fontWeight: "600", fontSize: "10px" } }
      },
      yAxis: {
        title: { text: seasonalYAxisTitle || `${activeParam} (${activeConfig.unit || ""})` }
      },
      series: [
        {
          name: "Observations",
          type: "boxplot",
          data: boxData as any,
          tooltip: {
            headerFormat: "<em>Group: {point.key}</em><br/>"
          }
        },
        {
          name: "Outliers",
          type: "scatter",
          data: outlierData,
          marker: {
            lineWidth: 1
          },
          tooltip: {
            pointFormat: "Value: {point.y:.2f}"
          }
        }
      ],
      credits: { enabled: false }
    };

    Highcharts.chart(containerId, options);
  };

  const drawAveragePlots = (season: string, containerId: string) => {
    const seasonData = seasonalGroupedData[season] || {};
    const categories = Object.keys(seasonData).sort();
    
    const avgData = categories.map((cat, catIdx) => {
      const vals = seasonData[cat] || [];
      if (vals.length === 0) return { y: 0, color: getCategoryColor(cat, catIdx) };
      const sum = vals.reduce((a, b) => a + b, 0);
      const val = parseFloat((sum / vals.length).toFixed(3));
      return {
        y: val,
        color: getCategoryColor(cat, catIdx)
      };
    });

    const options: Highcharts.Options = {
      chart: {
        type: "column",
        backgroundColor: "transparent"
      },
      title: {
        text: seasonalChartTitle ? `${seasonalChartTitle} - ${season}` : `${activeParam} Average Values - ${season}`,
        style: { fontWeight: "bold", color: "#1e293b", fontSize: "14px", fontFamily: fontFamily }
      },
      xAxis: {
        categories: categories,
        title: { text: seasonalXAxisTitle || (reportingLevel === "State" ? "State" : reportingLevel === "District" ? "District" : "Block") },
        labels: { style: { fontWeight: "600", fontSize: "10px" } }
      },
      yAxis: {
        title: { text: seasonalYAxisTitle || `Average ${activeParam} (${activeConfig.unit || ""})` }
      },
      plotOptions: {
        column: {
          dataLabels: {
            enabled: true,
            format: "{point.y:.2f}"
          }
        }
      },
      series: [
        {
          name: `Average ${activeParam}`,
          type: "column",
          data: avgData as any,
          showInLegend: false
        }
      ],
      credits: { enabled: false }
    };

    Highcharts.chart(containerId, options);
  };

  const drawViolinPlots = (season: string, containerId: string) => {
    const seasonData = seasonalGroupedData[season] || {};
    const categories = Object.keys(seasonData).sort();
    
    const groupsData = categories.map((cat) => ({
      name: cat,
      values: seasonData[cat] || []
    }));

    const violinSeries = getViolinSeriesAndCategories(groupsData);

    const options: Highcharts.Options = {
      chart: {
        backgroundColor: "transparent"
      },
      title: {
        text: seasonalChartTitle ? `${seasonalChartTitle} - ${season}` : `${activeParam} Violin Plots (Distribution) - ${season}`,
        style: { fontWeight: "bold", color: "#1e293b", fontSize: "14px", fontFamily: fontFamily }
      },
      xAxis: {
        categories: categories,
        title: { text: seasonalXAxisTitle || (reportingLevel === "State" ? "State" : reportingLevel === "District" ? "District" : "Block") },
        labels: { style: { fontWeight: "600", fontSize: "10px" } },
        min: -0.5,
        max: categories.length - 0.5
      },
      yAxis: {
        title: { text: seasonalYAxisTitle || `${activeParam} (${activeConfig.unit || ""})` }
      },
      series: violinSeries as any,
      credits: { enabled: false }
    };

    Highcharts.chart(containerId, options);
  };

  const drawDonutPlots = (season: string, containerId: string) => {
    const seasonData = seasonalGroupedData[season] || {};
    const allVals: number[] = [];
    Object.values(seasonData).forEach((groupVals) => {
      if (Array.isArray(groupVals)) {
        allVals.push(...(groupVals as number[]));
      }
    });

    let sAcc = 0;
    let sPerm = 0;
    let sFail = 0;
    let sSarS1 = 0;
    let sSarS2 = 0;
    let sSarS3 = 0;
    let sSarS4 = 0;

    const isSingle = activeConfig.b1 === activeConfig.b2 && activeConfigKey !== "pH";

    allVals.forEach((val) => {
      if (activeParam === "SAR") {
        if (val <= 10) sSarS1++;
        else if (val <= 18) sSarS2++;
        else if (val <= 26) sSarS3++;
        else sSarS4++;
      } else if (activeConfigKey === "pH") {
        if (val >= activeConfig.b1 && val <= activeConfig.b2) sAcc++;
        else sFail++;
      } else if (isSingle) {
        if (val <= activeConfig.b1) sAcc++;
        else sFail++;
      } else {
        if (val <= activeConfig.b1) sAcc++;
        else if (val <= activeConfig.b2) sPerm++;
        else sFail++;
      }
    });

    let chartData: any[] = [];
    if (activeParam === "SAR") {
      chartData = [
        { name: "S1: Excellent (≤10)", y: sSarS1, color: colorAcc },
        { name: "S2: Medium (>10–18)", y: sSarS2, color: colorPerm },
        { name: "S3: High (>18–26)", y: sSarS3, color: "#f97316" },
        { name: "S4: Very High (>26)", y: sSarS4, color: colorFail },
      ].filter((point) => point.y > 0);
    } else {
      let accLabel = "";
      let permLabel = "";
      let failLabel = "";

      const unitStr = activeConfig.unit ? ` ${activeConfig.unit}` : "";

      if ((activeParam === "RSC" || activeConfigKey === "RSC") && activeConfig.b1 !== activeConfig.b2) {
        accLabel = `Excellent (<${activeConfig.b1} meq/L)`;
        permLabel = `Acceptable (${activeConfig.b1}–${activeConfig.b2} meq/L)`;
        failLabel = `Unsuitable (>${activeConfig.b2} meq/L)`;
      } else if (activeConfigKey === "pH") {
        accLabel = `pH: ${activeConfig.b1}–${activeConfig.b2}`;
        failLabel = `pH: <${activeConfig.b1} or >${activeConfig.b2}`;
      } else if (isSingle) {
        accLabel = `≤${activeConfig.b1}${unitStr}`;
        failLabel = `>${activeConfig.b1}${unitStr}`;
      } else {
        accLabel = `≤${activeConfig.b1}${unitStr}`;
        permLabel = `>${activeConfig.b1}–${activeConfig.b2}${unitStr}`;
        failLabel = `>${activeConfig.b2}${unitStr}`;
      }

      chartData = [
        { name: accLabel, y: sAcc, color: colorAcc },
        ...(isSingle || activeConfigKey === "pH" ? [] : [{ name: permLabel, y: sPerm, color: colorPerm }]),
        { name: failLabel, y: sFail, color: colorFail },
      ].filter((point) => point.y > 0);
    }

    const titleText = seasonalChartTitle ? `${seasonalChartTitle} - ${season}` : `${activeParam} Compliance Donut - ${season}`;

    const isRscOrSar = activeParam === "SAR" || activeParam === "RSC";
    const chartFontFamily = isRscOrSar ? "'Times New Roman', Times, serif" : fontFamily;
    
    const fontStyle = {
      fontFamily: chartFontFamily,
      fontSize: "12px",
      fontWeight: fontBold ? "bold" : "normal",
      color: chartTheme === "theme-dark" ? "#f8fafc" : "#1e293b",
    };

    const options: Highcharts.Options = {
      chart: {
        type: "pie",
        options3d: { enabled: true, alpha: 45, beta: 0, depth: 40 },
        backgroundColor: "transparent",
      },
      title: {
        text: titleText,
        style: {
          ...fontStyle,
          fontSize: "13px",
          fontWeight: "800",
        },
      },
      tooltip: {
        style: { fontFamily: chartFontFamily },
        pointFormat: "<b>{point.y} samples</b> ({point.percentage:.1f}%)",
      },
      plotOptions: {
        pie: {
          innerSize: "55%",
          depth: 40,
          borderWidth: 2,
          borderColor: chartTheme === "theme-dark" ? "#1e293b" : "#ffffff",
          slicedOffset: 15,
          dataLabels: {
            enabled: true,
            useHTML: true,
            format: isRscOrSar
              ? `<div style="text-align: center; line-height: 1.4; padding: 2px; font-family: 'Times New Roman', Times, serif; font-size: 10pt;">
                  <span style="font-weight: 700; color: {point.color};">{point.name}</span><br/>
                  <span style="font-weight: 800; color: ${chartTheme === "theme-dark" ? "#f8fafc" : "#0f172a"};">{point.percentage:.1f}%</span>
                  <span style="font-weight: 500; color: ${chartTheme === "theme-dark" ? "#94a3b8" : "#64748b"};"> ({point.y})</span>
                </div>`
              : `<div style="text-align: center; line-height: 1.4; padding: 2px; font-family: ${fontFamily};">
                  <span style="font-size: 10px; font-weight: 700; color: {point.color};">{point.name}</span><br/>
                  <span style="font-size: 12px; font-weight: 800; color: ${chartTheme === "theme-dark" ? "#f8fafc" : "#0f172a"};">{point.percentage:.1f}%</span>
                  <span style="font-size: 10px; font-weight: 500; color: ${chartTheme === "theme-dark" ? "#94a3b8" : "#64748b"};"> ({point.y})</span>
                </div>`,
            style: {
              fontFamily: chartFontFamily,
              fontSize: isRscOrSar ? "10pt" : `11px`,
              textOutline: "none",
            },
            connectorWidth: 1.5,
            connectorPadding: 4,
          },
        },
      },
      series: [
        {
          type: "pie",
          name: "Samples",
          data: chartData,
        },
      ],
      credits: { enabled: false },
    };

    Highcharts.chart(containerId, options);
  };

  const drawOgivePlots = (season: string, containerId: string) => {
    const seasonData = seasonalGroupedData[season] || {};
    const allVals: number[] = [];
    Object.values(seasonData).forEach((groupVals) => {
      if (Array.isArray(groupVals)) {
        allVals.push(...(groupVals as number[]));
      }
    });

    if (allVals.length === 0) {
      const containerEl = document.getElementById(containerId);
      if (containerEl) {
        containerEl.innerHTML = `<div class="h-full flex items-center justify-center text-slate-400 font-bold p-8">No data available for Ogive curve.</div>`;
      }
      return;
    }

    // Sort values in ascending order
    allVals.sort((a, b) => a - b);

    // Helper to calculate percentile values
    const getPercentile = (arr: number[], percentile: number): number => {
      if (arr.length === 0) return 0;
      const index = (percentile / 100) * (arr.length - 1);
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const weight = index - lower;
      return arr[lower] * (1 - weight) + arr[upper] * weight;
    };

    const p50 = getPercentile(allVals, 50);
    const p75 = getPercentile(allVals, 75);
    const p90 = getPercentile(allVals, 90);
    const p95 = getPercentile(allVals, 95);

    const minVal = allVals[0];
    const maxVal = allVals[allVals.length - 1];
    
    // We will generate 15 points for the Ogive curve
    const steps = 15;
    const dataPoints: { x: number; y: number }[] = [];
    
    if (minVal === maxVal) {
      // If all values are the same, just plot points around it
      dataPoints.push({ x: minVal - 1, y: 0 });
      dataPoints.push({ x: minVal, y: 100 });
      dataPoints.push({ x: minVal + 1, y: 100 });
    } else {
      const interval = (maxVal - minVal) / (steps - 1);
      
      // Let's also include a starting point at 0% slightly before the minVal
      const padding = interval * 0.5;
      dataPoints.push({ x: Math.max(0, minVal - padding), y: 0 });

      for (let i = 0; i < steps; i++) {
        const threshold = minVal + i * interval;
        // count how many elements are <= threshold
        const count = allVals.filter(v => v <= threshold).length;
        const percentage = (count / allVals.length) * 100;
        dataPoints.push({ x: Number(threshold.toFixed(3)), y: Number(percentage.toFixed(1)) });
      }
    }

    const titleText = seasonalChartTitle ? `${seasonalChartTitle} - ${season}` : `${activeParam} Cumulative Frequency (Ogive) Curve - ${season}`;
    const isRscOrSar = activeParam === "SAR" || activeParam === "RSC";
    const chartFontFamily = isRscOrSar ? "'Times New Roman', Times, serif" : fontFamily;

    const fontStyle = {
      fontFamily: chartFontFamily,
      fontSize: "12px",
      fontWeight: fontBold ? "bold" : "normal",
      color: chartTheme === "theme-dark" ? "#f8fafc" : "#1e293b",
    };

    const options: Highcharts.Options = {
      chart: {
        type: "spline",
        backgroundColor: "transparent",
      },
      title: {
        text: titleText,
        style: {
          ...fontStyle,
          fontSize: "13px",
          fontWeight: "800",
        },
      },
      xAxis: {
        title: {
          text: seasonalXAxisTitle || `${activeParam}${activeConfig.unit ? ` (${activeConfig.unit})` : ""}`,
          style: fontStyle,
        },
        labels: { style: fontStyle },
        gridLineWidth: 1,
        gridLineDashStyle: "Dash",
        gridLineColor: chartTheme === "theme-dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)",
        plotLines: [
          {
            color: "#2563eb",
            dashStyle: "Dash",
            width: 1.5,
            value: p50,
            zIndex: 4,
            label: {
              text: `Median (P50) = ${p50.toFixed(1)}`,
              verticalAlign: "top",
              align: "left",
              rotation: 0,
              y: 15,
              x: 5,
              style: { color: "#2563eb", fontWeight: "bold", fontSize: "10px", fontFamily: chartFontFamily, backgroundColor: "rgba(255,255,255,0.7)" }
            }
          },
          {
            color: "#8b5cf6",
            dashStyle: "Dash",
            width: 1.5,
            value: p75,
            zIndex: 4,
            label: {
              text: `P75 = ${p75.toFixed(1)}`,
              verticalAlign: "top",
              align: "left",
              rotation: 0,
              y: 30,
              x: 5,
              style: { color: "#8b5cf6", fontWeight: "bold", fontSize: "10px", fontFamily: chartFontFamily, backgroundColor: "rgba(255,255,255,0.7)" }
            }
          },
          {
            color: "#f97316",
            dashStyle: "Dash",
            width: 1.5,
            value: p90,
            zIndex: 4,
            label: {
              text: `P90 = ${p90.toFixed(1)}`,
              verticalAlign: "top",
              align: "left",
              rotation: 0,
              y: 45,
              x: 5,
              style: { color: "#f97316", fontWeight: "bold", fontSize: "10px", fontFamily: chartFontFamily, backgroundColor: "rgba(255,255,255,0.7)" }
            }
          },
          {
            color: "#dc2626",
            dashStyle: "Dash",
            width: 1.5,
            value: p95,
            zIndex: 4,
            label: {
              text: `P95 = ${p95.toFixed(1)}`,
              verticalAlign: "top",
              align: "left",
              rotation: 0,
              y: 60,
              x: 5,
              style: { color: "#dc2626", fontWeight: "bold", fontSize: "10px", fontFamily: chartFontFamily, backgroundColor: "rgba(255,255,255,0.7)" }
            }
          }
        ]
      },
      yAxis: {
        title: {
          text: seasonalYAxisTitle || "Cumulative Percentage (%)",
          style: fontStyle,
        },
        labels: {
          style: fontStyle,
          format: "{value}%",
        },
        min: 0,
        max: 100,
        gridLineWidth: 1,
        gridLineDashStyle: "Dash",
        gridLineColor: chartTheme === "theme-dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)",
      },
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function (this: any) {
          const point = this.points ? this.points[0].point : (this.point || {});
          const unit = activeConfig.unit ? ` ${activeConfig.unit}` : "";
          let s = `<div style="font-family: ${chartFontFamily}; font-size: 11px; padding: 4px;">`;
          s += `<small style="font-size: 10px; color: #64748b;">${activeParam} value &le; <b>${point.x}${unit}</b></small><br/>`;
          s += `<span style="color:#4f46e5;">\u25CF</span> Cumulative Compliance: <b>${point.y}%</b> of samples<br/>`;
          s += `<hr style="margin: 6px 0; border: 0; border-top: 1px solid #e2e8f0;"/>`;
          s += `<strong style="color: #0f172a; display: block; margin-bottom: 3px;">Statistical Percentiles:</strong>`;
          s += `<span style="color: #2563eb;">\u25CF</span> Median (P50): <b>${p50.toFixed(2)}${unit}</b><br/>`;
          s += `<span style="color: #f97316;">\u25CF</span> 90th Percentile (P90): <b>${p90.toFixed(2)}${unit}</b><br/>`;
          s += `<span style="color: #dc2626;">\u25CF</span> 95th Percentile (P95): <b>${p95.toFixed(2)}${unit}</b><br/>`;
          s += `</div>`;
          return s;
        },
        style: { fontFamily: chartFontFamily },
      },
      plotOptions: {
        spline: {
          marker: {
            enabled: true,
            radius: 4,
            symbol: "circle",
            fillColor: "#4f46e5",
            lineWidth: 2,
            lineColor: "#ffffff",
          },
          lineWidth: 3,
          color: "#4f46e5",
        },
      },
      series: [
        {
          type: "spline",
          name: "Cumulative Compliance",
          data: dataPoints.map(p => [p.x, p.y]),
        },
      ],
      credits: { enabled: false },
    };

    Highcharts.chart(containerId, options);
  };

  useEffect(() => {
    if (rawData.length === 0) return;
    
    const timer = setTimeout(() => {
      const seasonsList = Object.keys(seasonalGroupedData).sort();
      seasonsList.forEach((season) => {
        const idSafeSeason = season.replace(/\s+/g, "-");
        const containerId = `${statTab}-chart-${idSafeSeason}`;
        const containerEl = document.getElementById(containerId);
        
        if (containerEl) {
          if (statTab === "boxplot") {
            drawBoxPlots(season, containerId);
          } else if (statTab === "average") {
            drawAveragePlots(season, containerId);
          } else if (statTab === "violin") {
            drawViolinPlots(season, containerId);
          } else if (statTab === "donut") {
            drawDonutPlots(season, containerId);
          } else if (statTab === "ogive") {
            drawOgivePlots(season, containerId);
          }
        }
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [statTab, seasonalGroupedData, activeParam, fontFamily, reportingLevel, colorAcc, colorPerm, colorFail, seasonalChartTitle, seasonalXAxisTitle, seasonalYAxisTitle]);

  const drawExceedancePlot = (containerId: string) => {
    const { categories, series } = exceedanceChartData;
    const containerEl = document.getElementById(containerId);
    if (!containerEl) return;

    if (categories.length === 0) {
      containerEl.innerHTML = `<div class="h-full flex items-center justify-center text-slate-400 font-bold p-8">No groups match the exceedance criteria.</div>`;
      return;
    }

    const options: Highcharts.Options = {
      chart: {
        type: "column",
        backgroundColor: "transparent"
      },
      title: {
        text: exceedanceChartTitle || `Percentage of Samples Above Permissible Limit - ${activeParam}`,
        style: { fontWeight: "black", color: "#1e293b", fontSize: "14px", fontFamily: fontFamily }
      },
      subtitle: {
        text: `Comparing across detected seasons/years for ${reportingLevel === "State" ? "States" : reportingLevel === "District" ? "Districts" : "Blocks"}`,
        style: { fontSize: "11px", color: "#64748b", fontFamily: fontFamily }
      },
      xAxis: {
        categories: categories,
        title: { text: exceedanceXAxisTitle || (groupScope === "national" ? "State Name" : reportingLevel === "State" ? "State" : reportingLevel === "District" ? "District" : "Block") },
        labels: { style: { fontWeight: "600", fontSize: "10px" } }
      },
      yAxis: {
        title: { text: exceedanceYAxisTitle || "Percentage Exceeding Limit (%)" },
        max: 100,
        labels: { format: "{value}%" }
      },
      tooltip: {
        headerFormat: "<b>{point.key}</b><br/>",
        pointFormat: "{series.name}: <b>{point.y:.1f}% samples</b> exceeding limit"
      },
      plotOptions: {
        column: {
          dataLabels: {
            enabled: true,
            format: "{point.y:.1f}%",
            style: { fontSize: "9px" }
          },
          borderRadius: 4
        }
      },
      colors: ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6"],
      series: series as any,
      credits: { enabled: false }
    };

    Highcharts.chart(containerId, options);
  };

  useEffect(() => {
    if (rawData.length === 0) return;
    const timer = setTimeout(() => {
      drawExceedancePlot("exceedance-rate-chart");
    }, 100);
    return () => clearTimeout(timer);
  }, [exceedanceChartData, fontFamily, groupScope, exceedanceFilter, exceedanceChartTitle, exceedanceXAxisTitle, exceedanceYAxisTitle]);

  // Process data whenever inputs change
  useEffect(() => {
    if (!rawData.length || !activeParam || !activeConfig) return;

    const isSingleLimit = activeConfig.b1 === activeConfig.b2 && activeConfigKey !== "pH";
    
    // 1. Filter raw data by State & District
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

    // 2. Identify grouping column
    const groupKey =
      reportingLevel === "State"
        ? headers.state
        : reportingLevel === "District"
        ? headers.district
        : headers.block;

    if (!groupKey) return;

    // 3. Aggregate groups
    const groups: Record<string, { state: string; district: string; block: string; samples: any[] }> = {};
    const allNumericVals: number[] = [];
    let globalAcc = 0;
    let globalPerm = 0;
    let globalFail = 0;
    let globalSarS1 = 0;
    let globalSarS2 = 0;
    let globalSarS3 = 0;
    let globalSarS4 = 0;

    filtered.forEach((row) => {
      const gName = String(row[groupKey] || "Unknown").trim();
      if (!groups[gName]) {
        groups[gName] = {
          state: String(row[headers.state || ""] || ""),
          district: String(row[headers.district || ""] || ""),
          block: String(row[headers.block || ""] || ""),
          samples: [],
        };
      }
      groups[gName].samples.push(row);

      let val = getParamVal(row, activeParam);

      if (!isNaN(val)) {
        allNumericVals.push(val);
        // Categorize globally
        if (activeParam === "SAR") {
          if (val <= 10) globalSarS1++;
          else if (val <= 18) globalSarS2++;
          else if (val < 26) globalSarS3++;
          else globalSarS4++;
        } else if (activeParam === "RSC") {
          if (val <= 1.25) globalAcc++;
          else if (val <= 2.5) globalPerm++;
          else globalFail++;
        } else if (activeParam === "SSP" || activeParam === "Na%") {
          if (val <= 40) globalAcc++;
          else if (val <= 60) globalPerm++;
          else globalFail++;
        } else if (activeParam === "PI") {
          if (val > 75) globalAcc++;
          else if (val >= 25) globalPerm++;
          else globalFail++;
        } else if (activeParam === "KR") {
          if (val <= 1.0) globalAcc++;
          else if (val <= 2.0) globalPerm++;
          else globalFail++;
        } else if (activeParam === "MH") {
          if (val <= 50) globalAcc++;
          else globalFail++;
        } else if (activeConfigKey === "pH") {
          if (val >= activeConfig.b1 && val <= activeConfig.b2) globalAcc++;
          else globalFail++;
        } else if (isSingleLimit) {
          if (val <= activeConfig.b1) globalAcc++;
          else globalFail++;
        } else {
          if (val <= activeConfig.b1) globalAcc++;
          else if (val <= activeConfig.b2) globalPerm++;
          else globalFail++;
        }
      }
    });

    const getValsOfSamples = (samples: any[]) => {
      return samples.map((row) => getParamVal(row, activeParam)).filter(v => !isNaN(v));
    };

    const calculatePeriodStats = (vals: number[]) => {
      const total = vals.length;
      let nAcc = 0;
      let nPerm = 0;
      let nFail = 0;
      let nSarS1 = 0;
      let nSarS2 = 0;
      let nSarS3 = 0;
      let nSarS4 = 0;

      vals.forEach((v) => {
        if (activeParam === "SAR") {
          if (v <= 10) nSarS1++;
          else if (v <= 18) nSarS2++;
          else if (v < 26) nSarS3++;
          else nSarS4++;
        } else if (activeParam === "RSC") {
          if (v <= 1.25) nAcc++;
          else if (v <= 2.5) nPerm++;
          else nFail++;
        } else if (activeParam === "SSP" || activeParam === "Na%") {
          if (v <= 40) nAcc++;
          else if (v <= 60) nPerm++;
          else nFail++;
        } else if (activeParam === "PI") {
          if (v > 75) nAcc++;
          else if (v >= 25) nPerm++;
          else nFail++;
        } else if (activeParam === "KR") {
          if (v <= 1.0) nAcc++;
          else if (v <= 2.0) nPerm++;
          else nFail++;
        } else if (activeParam === "MH") {
          if (v <= 50) nAcc++;
          else nFail++;
        } else if (activeConfigKey === "pH") {
          if (v >= activeConfig.b1 && v <= activeConfig.b2) nAcc++;
          else nFail++;
        } else if (isSingleLimit) {
          if (v <= activeConfig.b1) nAcc++;
          else nFail++;
        } else {
          if (v <= activeConfig.b1) nAcc++;
          else if (v <= activeConfig.b2) nPerm++;
          else nFail++;
        }
      });

      const mathStats = getStats(vals);

      return {
        total,
        nAcc,
        nPctAcc: total > 0 ? (nAcc / total) * 100 : 0,
        nPerm,
        nPctPerm: total > 0 ? (nPerm / total) * 100 : 0,
        nFail,
        nPctFail: total > 0 ? (nFail / total) * 100 : 0,
        nSarS1,
        nPctSarS1: total > 0 ? (nSarS1 / total) * 100 : 0,
        nSarS2,
        nPctSarS2: total > 0 ? (nSarS2 / total) * 100 : 0,
        nSarS3,
        nPctSarS3: total > 0 ? (nSarS3 / total) * 100 : 0,
        nSarS4,
        nPctSarS4: total > 0 ? (nSarS4 / total) * 100 : 0,
        min: mathStats.min,
        max: mathStats.max,
        avg: mathStats.avg,
        std: mathStats.std,
        p75: mathStats.p75,
        p90: mathStats.p90,
        p95: mathStats.p95,
      };
    };

    // 4. Calculate stats per group
    const rows: GroupedStatRow[] = Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([gName, data]) => {
        const vals = getValsOfSamples(data.samples);
        const overall = calculatePeriodStats(vals);

        const pStats: Record<string, any> = {};
        uniquePeriods.forEach((period) => {
          const periodSamples = data.samples.filter(s => getPeriodKey(s) === period || (uniquePeriods.length === 1 && period === "All Data"));
          const periodVals = getValsOfSamples(periodSamples);
          pStats[period] = calculatePeriodStats(periodVals);
        });

        return {
          name: gName,
          state: data.state,
          district: data.district,
          block: data.block,
          ...overall,
          periodStats: pStats,
        };
      });

    setTableRows(rows);

    // 5. Calculate grand total row
    if (allNumericVals.length > 0) {
      const grandStats = getStats(allNumericVals);
      const totalCount = allNumericVals.length;

      const grandPeriodStats: Record<string, any> = {};
      uniquePeriods.forEach((period) => {
        const periodSamples = filtered.filter(s => getPeriodKey(s) === period || (uniquePeriods.length === 1 && period === "All Data"));
        const periodVals = getValsOfSamples(periodSamples);
        grandPeriodStats[period] = calculatePeriodStats(periodVals);
      });

      setGrandTotalRow({
        name: "GRAND TOTAL",
        state: "GRAND TOTAL",
        district: "",
        block: "",
        total: totalCount,
        nAcc: globalAcc,
        nPctAcc: totalCount > 0 ? (globalAcc / totalCount) * 100 : 0,
        nPerm: globalPerm,
        nPctPerm: totalCount > 0 ? (globalPerm / totalCount) * 100 : 0,
        nFail: globalFail,
        nPctFail: totalCount > 0 ? (globalFail / totalCount) * 100 : 0,
        nSarS1: globalSarS1,
        nPctSarS1: totalCount > 0 ? (globalSarS1 / totalCount) * 100 : 0,
        nSarS2: globalSarS2,
        nPctSarS2: totalCount > 0 ? (globalSarS2 / totalCount) * 100 : 0,
        nSarS3: globalSarS3,
        nPctSarS3: totalCount > 0 ? (globalSarS3 / totalCount) * 100 : 0,
        nSarS4: globalSarS4,
        nPctSarS4: totalCount > 0 ? (globalSarS4 / totalCount) * 100 : 0,
        min: grandStats.min,
        max: grandStats.max,
        avg: grandStats.avg,
        std: grandStats.std,
        p75: grandStats.p75,
        p90: grandStats.p90,
        p95: grandStats.p95,
        periodStats: grandPeriodStats,
      });
    } else {
      setGrandTotalRow(null);
    }

    // 6. Draw Highcharts rendering
    let chartData: any[] = [];
    if (activeParam === "SAR") {
      chartData = [
        { name: "S1: Excellent (≤10)", y: globalSarS1, color: colorAcc },
        { name: "S2: Medium (>10–18)", y: globalSarS2, color: colorPerm },
        { name: "S3: High (>18–26)", y: globalSarS3, color: "#f97316" },
        { name: "S4: Very High (>26)", y: globalSarS4, color: colorFail },
      ].filter((point) => point.y > 0);
    } else {
      let accLabel = "";
      let permLabel = "";
      let failLabel = "";

      const isSingle = activeConfig.b1 === activeConfig.b2 && activeConfigKey !== "pH";
      const unitStr = activeConfig.unit ? ` ${activeConfig.unit}` : "";

      if ((activeParam === "RSC" || activeConfigKey === "RSC") && activeConfig.b1 !== activeConfig.b2) {
        accLabel = `Excellent (<${activeConfig.b1} meq/L)`;
        permLabel = `Acceptable (${activeConfig.b1}–${activeConfig.b2} meq/L)`;
        failLabel = `Unsuitable (>${activeConfig.b2} meq/L)`;
      } else if (activeConfigKey === "pH") {
        accLabel = `pH: ${activeConfig.b1}–${activeConfig.b2}`;
        failLabel = `pH: <${activeConfig.b1} or >${activeConfig.b2}`;
      } else if (isSingle) {
        accLabel = `≤${activeConfig.b1}${unitStr}`;
        failLabel = `>${activeConfig.b1}${unitStr}`;
      } else {
        accLabel = `≤${activeConfig.b1}${unitStr}`;
        permLabel = `>${activeConfig.b1}–${activeConfig.b2}${unitStr}`;
        failLabel = `>${activeConfig.b2}${unitStr}`;
      }

      chartData = [
        { name: accLabel, y: globalAcc, color: colorAcc },
        ...(isSingle || activeConfigKey === "pH" ? [] : [{ name: permLabel, y: globalPerm, color: colorPerm }]),
        { name: failLabel, y: globalFail, color: colorFail },
      ].filter((point) => point.y > 0);
    }

    const defaultTitle = (activeParam === "SAR" || activeParam === "RSC")
      ? `Distribution of ${activeParam} in different Limits`
      : `Distribution of ${activeParam} in different BIS 10500:2012 Limits`;
    const titleText = chartTitle || defaultTitle;
    
    const isRscOrSar = activeParam === "SAR" || activeParam === "RSC";
    const chartFontFamily = isRscOrSar ? "'Times New Roman', Times, serif" : fontFamily;
    const chartTitleFontSize = isRscOrSar ? "12pt" : `${fontSize + 6}px`;

    const fontStyle = {
      fontFamily: chartFontFamily,
      fontSize: isRscOrSar ? "12pt" : `${fontSize}px`,
      fontWeight: fontBold ? "bold" : "normal",
      color: chartTheme === "theme-dark" ? "#f8fafc" : "#1e293b",
    };

    const newOptions: Highcharts.Options = {
      chart: {
        type: "pie",
        options3d: { enabled: true, alpha: 45, beta: 0 },
        backgroundColor: "transparent",
      },
      exporting: {
        buttons: {
          contextButton: {
            enabled: false
          }
        }
      },
      title: {
        text: titleText,
        style: {
          ...fontStyle,
          fontSize: chartTitleFontSize,
          fontWeight: "800",
        },
      },
      tooltip: {
        style: { fontFamily: chartFontFamily },
        pointFormat: "<b>{point.y} samples</b> ({point.percentage:.1f}%)",
      },
      plotOptions: {
        pie: {
          innerSize: "55%", // Perfect chunky ring structure matching premium 3D design
          depth: 50,
          borderWidth: 2, // Highlight each 3D slice with a crisp boundary line
          borderColor: chartTheme === "theme-dark" ? "#1e293b" : "#ffffff", // Perfectly match the theme's background card
          slicedOffset: 15,
          dataLabels: {
            enabled: true,
            useHTML: true,
            format: isRscOrSar
              ? `<div style="text-align: center; line-height: 1.4; padding: 4px; font-family: 'Times New Roman', Times, serif; font-size: 12pt;">
                  <span style="font-weight: 700; color: {point.color}; text-transform: none;">{point.name}</span><br/>
                  <span style="font-weight: 800; color: ${chartTheme === "theme-dark" ? "#f8fafc" : "#0f172a"};">{point.percentage:.1f}%</span>
                  <span style="font-weight: 500; color: ${chartTheme === "theme-dark" ? "#94a3b8" : "#64748b"};"> ({point.y})</span>
                </div>`
              : `<div style="text-align: center; line-height: 1.4; padding: 4px; font-family: ${fontFamily};">
                  <span style="font-size: 11px; font-weight: 700; color: {point.color}; text-transform: none; letter-spacing: 0.6px;">{point.name}</span><br/>
                  <span style="font-size: 14px; font-weight: 800; color: ${chartTheme === "theme-dark" ? "#f8fafc" : "#0f172a"};">{point.percentage:.1f}%</span>
                  <span style="font-size: 11px; font-weight: 500; color: ${chartTheme === "theme-dark" ? "#94a3b8" : "#64748b"};"> ({point.y})</span>
                </div>`,
            style: {
              fontFamily: chartFontFamily,
              fontSize: isRscOrSar ? "12pt" : `${fontSize}px`,
              textOutline: "none",
            },
            connectorWidth: 1.5,
            connectorPadding: 4,
          },
        },
      },
      series: [
        {
          type: "pie",
          name: "Samples",
          data: chartData,
        },
      ],
      credits: { enabled: false },
    };

    const targetId = isFullscreen ? "fullscreen-chart-container" : "chart-container";
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      const c = Highcharts.chart(targetId, newOptions);
      chartRef.current = c;

      // Auto-update the shared bulletin maps for this parameter asynchronously
      if (setSharedBulletinMaps) {
        const autoSendToBulletin = async () => {
          try {
            const transparentOptions = {
              ...newOptions,
              chart: {
                ...newOptions.chart,
                backgroundColor: "transparent",
                plotBackgroundColor: "transparent",
              },
            };
            const base64 = await generateOfflineChartBase64(transparentOptions as any, 1400, 900);
            if (base64) {
              setSharedBulletinMaps((prev) => ({
                ...prev,
                [`donut_${activeParam}`]: base64,
              }));
            }
          } catch (err) {
            console.error("Auto sending chart to bulletin failed:", err);
          }
        };
        autoSendToBulletin();
      }
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [
    rawData,
    activeParam,
    selectedState,
    selectedDistrict,
    reportingLevel,
    chartTitle,
    chartTheme,
    fontFamily,
    fontSize,
    fontBold,
    colorAcc,
    colorPerm,
    colorFail,
    isFullscreen,
    setSharedBulletinMaps,
    uniquePeriods,
  ]);

  const handleDownloadJPEG = () => {
    if (chartRef.current) {
      let exportBg = "#ffffff";
      if (chartTheme === "theme-dark") {
        exportBg = "#0f172a";
      } else if (chartTheme === "theme-slate") {
        exportBg = "#f1f5f9";
      } else if (chartTheme === "theme-indigo") {
        exportBg = "#eef2ff";
      } else if (chartTheme === "theme-emerald") {
        exportBg = "#ecfdf5";
      }

      const container = chartRef.current.container;
      const sourceWidth = container ? container.clientWidth || 800 : 800;
      const sourceHeight = container ? container.clientHeight || 500 : 500;

      const fileSuffix = (activeParam === "SAR" || activeParam === "RSC") ? "Limits" : "BIS_Limits";
      (chartRef.current as any).exportChart(
        { 
          type: "image/jpeg", 
          filename: `Distribution_of_${activeParam}_in_${fileSuffix}`,
          sourceWidth: sourceWidth,
          sourceHeight: sourceHeight,
          scale: 4 // Ultra high-resolution sharp output
        },
        {
          chart: {
            backgroundColor: exportBg
          }
        }
      );
    }
  };

  const handleSendToBulletin = async () => {
    if (!setSharedBulletinMaps || !activeConfig) return;

    // Create the exact standard 3D options but force transparent background for bulletin
    const defaultTitle = (activeParam === "SAR" || activeParam === "RSC")
      ? `Distribution of ${activeParam} in different Limits`
      : `Distribution of ${activeParam} in different BIS 10500:2012 Limits`;
    const titleText = chartTitle || defaultTitle;
    
    let chartDataPoints: any[] = [];
    if (activeParam === "SAR") {
      chartDataPoints = [
        { name: "S1: Excellent (≤10)", y: grandTotalRow ? (grandTotalRow.nSarS1 || 0) : 0, color: colorAcc },
        { name: "S2: Medium (>10–18)", y: grandTotalRow ? (grandTotalRow.nSarS2 || 0) : 0, color: colorPerm },
        { name: "S3: High (>18–26)", y: grandTotalRow ? (grandTotalRow.nSarS3 || 0) : 0, color: "#f97316" },
        { name: "S4: Very High (>26)", y: grandTotalRow ? (grandTotalRow.nSarS4 || 0) : 0, color: colorFail },
      ].filter((point) => point.y > 0);
    } else {
      let accLabel = "";
      let permLabel = "";
      let failLabel = "";

      const isSingle = activeConfig.b1 === activeConfig.b2 && activeConfigKey !== "pH";
      const unitStr = activeConfig.unit ? ` ${activeConfig.unit}` : "";

      if ((activeParam === "RSC" || activeConfigKey === "RSC") && activeConfig.b1 !== activeConfig.b2) {
        accLabel = `Excellent (<${activeConfig.b1} meq/L)`;
        permLabel = `Acceptable (${activeConfig.b1}–${activeConfig.b2} meq/L)`;
        failLabel = `Unsuitable (>${activeConfig.b2} meq/L)`;
      } else if (activeConfigKey === "pH") {
        accLabel = `pH: ${activeConfig.b1}–${activeConfig.b2}`;
        failLabel = `pH: <${activeConfig.b1} or >${activeConfig.b2}`;
      } else if (isSingle) {
        accLabel = `≤${activeConfig.b1}${unitStr}`;
        failLabel = `>${activeConfig.b1}${unitStr}`;
      } else {
        accLabel = `≤${activeConfig.b1}${unitStr}`;
        permLabel = `>${activeConfig.b1}–${activeConfig.b2}${unitStr}`;
        failLabel = `>${activeConfig.b2}${unitStr}`;
      }

      // Get counts
      let globalAcc = grandTotalRow ? grandTotalRow.nAcc : 0;
      let globalPerm = grandTotalRow ? grandTotalRow.nPerm : 0;
      let globalFail = grandTotalRow ? grandTotalRow.nFail : 0;

      chartDataPoints = [
        { name: accLabel, y: globalAcc, color: colorAcc },
        ...(isSingle || activeConfigKey === "pH" ? [] : [{ name: permLabel, y: globalPerm, color: colorPerm }]),
        { name: failLabel, y: globalFail, color: colorFail },
      ].filter((point) => point.y > 0);
    }

    const options = {
      chart: {
        type: "pie",
        options3d: { enabled: true, alpha: 45, beta: 0 },
        backgroundColor: "transparent",
        plotBackgroundColor: "transparent",
      },
      title: {
        text: titleText,
        style: {
          fontFamily,
          fontSize: `${fontSize + 6}px`,
          fontWeight: "800",
          color: chartTheme === "theme-dark" ? "#f8fafc" : "#1e293b",
        },
      },
      tooltip: {
        style: { fontFamily },
        pointFormat: "<b>{point.y} samples</b> ({point.percentage:.1f}%)",
      },
      plotOptions: {
        pie: {
          innerSize: "55%",
          depth: 50,
          borderWidth: 2,
          borderColor: "transparent",
          slicedOffset: 15,
          dataLabels: {
            enabled: true,
            useHTML: true,
            format: `<div style="text-align: center; line-height: 1.4; padding: 4px; font-family: ${fontFamily};">
              <span style="font-size: 11px; font-weight: 700; color: {point.color}; text-transform: none; letter-spacing: 0.6px;">{point.name}</span><br/>
              <span style="font-size: 14px; font-weight: 800; color: ${chartTheme === "theme-dark" ? "#f8fafc" : "#0f172a"};">{point.percentage:.1f}%</span>
              <span style="font-size: 11px; font-weight: 500; color: ${chartTheme === "theme-dark" ? "#94a3b8" : "#64748b"};"> ({point.y})</span>
            </div>`,
            style: {
              fontFamily,
              textOutline: "none",
            },
            connectorWidth: 1.5,
            connectorPadding: 4,
          },
        },
      },
      series: [
        {
          type: "pie",
          name: "Samples",
          data: chartDataPoints,
        },
      ],
      credits: { enabled: false },
    };

    try {
      const base64 = await generateOfflineChartBase64(options as any, 1400, 900);
      if (base64) {
        setSharedBulletinMaps((prev) => ({
          ...prev,
          [`donut_${activeParam}`]: base64,
        }));
        setIsSent(true);
        setTimeout(() => setIsSent(false), 3500);
      }
    } catch (err) {
      console.error("Failed to compile transparent chart for bulletin:", err);
    }
  };

  const sendSeasonalChartToBulletin = async (season: string, tab: "boxplot" | "average" | "violin" | "donut" | "ogive") => {
    if (!setSharedBulletinMaps) return;
    const idSafeSeason = season.replace(/\s+/g, "-");
    const containerId = `${tab}-chart-${idSafeSeason}`;
    const containerEl = document.getElementById(containerId);
    if (!containerEl) return;

    const chartInstance = (Highcharts as any).charts.find(
      (c: any) => c && c.renderTo === containerEl
    );
    if (!chartInstance) return;

    try {
      const options = chartInstance.options;
      const reportOptions = {
        ...options,
        chart: {
          ...options.chart,
          backgroundColor: "#ffffff",
        }
      };
      const base64 = await generateOfflineChartBase64(reportOptions as any, 1200, 750);
      if (base64) {
        const key = `sent_chart_${tab}_${season.replace(/[^a-zA-Z0-9]/g, "_")}`;
        setSharedBulletinMaps((prev) => ({
          ...prev,
          [key]: base64,
        }));
        setSentItems((prev) => ({ ...prev, [key]: true }));
        setTimeout(() => {
          setSentItems((prev) => ({ ...prev, [key]: false }));
        }, 3000);
      }
    } catch (err) {
      console.error("Failed to send seasonal chart to bulletin:", err);
    }
  };

  const sendMapToBulletin = (title: string, base64: string) => {
    if (!setSharedBulletinMaps) return;
    const key = `sent_chart_exceedance_${activeParam}`;
    setSharedBulletinMaps((prev) => ({
      ...prev,
      [key]: base64,
    }));
    setSentItems((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setSentItems((prev) => ({ ...prev, [key]: false }));
    }, 3000);
  };

  const sendTableToBulletin = () => {
    if (!setSharedBulletinMaps) return;

    const isSar = activeParam === "SAR";
    const headerLabels = getTableHeaderLabels(activeConfigKey, activeConfig);

    let html = `
      <table border="1" cellpadding="6" cellspacing="0" style="width: 100%; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 9.5pt; text-align: left; margin-bottom: 25px; border: 1.5pt solid #4f46e5;">
        <thead>
          <tr style="background-color: #4f46e5; color: white; text-align: center;">
            <th rowspan="2" style="border: 1px solid #c7d2fe; padding: 6px; font-weight: bold; background-color: #4f46e5; color: white;">Sl. No.</th>
            ${reportingLevel !== "State" ? `<th rowspan="2" style="border: 1px solid #c7d2fe; padding: 6px; font-weight: bold; background-color: #4f46e5; color: white;">State</th>` : ""}
            ${reportingLevel === "Block" ? `<th rowspan="2" style="border: 1px solid #c7d2fe; padding: 6px; font-weight: bold; background-color: #4f46e5; color: white;">District</th>` : ""}
            <th rowspan="2" style="border: 1px solid #c7d2fe; padding: 6px; font-weight: bold; background-color: #4f46e5; color: white; text-align: left;">
              ${reportingLevel === "State" ? "State Name" : reportingLevel === "District" ? "District Name" : "Block / Tehsil"}
            </th>
    `;

    uniquePeriods.forEach((period) => {
      const colsCount = isSar ? 8 : (activeConfigKey === "pH" || activeConfig.b1 === activeConfig.b2 ? 6 : 7);
      html += `
        <th colspan="${colsCount}" style="border: 1px solid #c7d2fe; padding: 6px; font-weight: bold; background-color: #e0e7ff; color: #4338ca; text-transform: uppercase;">
          ${period}
        </th>
      `;
    });

    html += `
          </tr>
          <tr style="background-color: #f8fafc; text-align: center;">
    `;

    uniquePeriods.forEach((period) => {
      html += `
        <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt;">Total</th>
      `;
      if (isSar) {
        html += `
          <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt; color: #059669; background-color: #ecfdf5;">&le;10</th>
          <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt; color: #d97706; background-color: #fef3c7;">&gt;10-18</th>
          <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt; color: #ea580c; background-color: #fff7ed;">&gt;18-26</th>
          <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt; color: #e11d48; background-color: #fff1f2;">&gt;26</th>
        `;
      } else {
        html += `
          <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt; color: #059669; background-color: #ecfdf5;">${headerLabels.acc.split(" (")[0]}</th>
        `;
        if (activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2) {
          html += `
            <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt; color: #d97706; background-color: #fef3c7;">${headerLabels.perm.split(" (")[0]}</th>
          `;
        }
        html += `
          <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt; color: #e11d48; background-color: #fff1f2;">${headerLabels.fail.split(" (")[0]}</th>
        `;
      }
      html += `
        <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt;">Min</th>
        <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt;">Max</th>
        <th style="border: 1px solid #e2e8f0; padding: 4px; font-size: 8.5pt;">Avg</th>
      `;
    });

    html += `
          </tr>
        </thead>
        <tbody>
    `;

    tableRows.forEach((row, idx) => {
      const isEven = idx % 2 === 0;
      const bg = isEven ? "background-color: #ffffff;" : "background-color: #f8fafc;";
      html += `
        <tr style="${bg}">
          <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #64748b; font-weight: bold;">${idx + 1}</td>
          ${reportingLevel !== "State" ? `<td style="border: 1px solid #e2e8f0; padding: 5px; color: #334155;">${row.state}</td>` : ""}
          ${reportingLevel === "Block" ? `<td style="border: 1px solid #e2e8f0; padding: 5px; color: #334155;">${row.district}</td>` : ""}
          <td style="border: 1px solid #e2e8f0; padding: 5px; font-weight: bold; color: #0f172a;">${row.name}</td>
      `;

      uniquePeriods.forEach((period) => {
        const stats = row.periods?.[period] || row.periodStats?.[period] || {
          total: 0, nAcc: 0, nPerm: 0, nFail: 0,
          nSarS1: 0, nSarS2: 0, nSarS3: 0, nSarS4: 0,
          min: NaN, max: NaN, avg: NaN
        };

        const minD = isNaN(stats.min) ? "-" : stats.min.toFixed(2);
        const maxD = isNaN(stats.max) ? "-" : stats.max.toFixed(2);
        const avgD = isNaN(stats.avg) ? "-" : stats.avg.toFixed(2);

        html += `
          <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; font-weight: bold;">${stats.total}</td>
        `;

        if (isSar) {
          html += `
            <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #059669; background-color: #f0fdf4;">${stats.nSarS1} (${stats.total ? ((stats.nSarS1/stats.total)*100).toFixed(0) : 0}%)</td>
            <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #d97706; background-color: #fffbeb;">${stats.nSarS2} (${stats.total ? ((stats.nSarS2/stats.total)*100).toFixed(0) : 0}%)</td>
            <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #ea580c; background-color: #fffaf0;">${stats.nSarS3} (${stats.total ? ((stats.nSarS3/stats.total)*100).toFixed(0) : 0}%)</td>
            <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #e11d48; background-color: #fff5f5;">${stats.nSarS4} (${stats.total ? ((stats.nSarS4/stats.total)*100).toFixed(0) : 0}%)</td>
          `;
        } else {
          html += `
            <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #059669; background-color: #f0fdf4;">${stats.nAcc} (${stats.total ? ((stats.nAcc/stats.total)*100).toFixed(0) : 0}%)</td>
          `;
          if (activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2) {
            html += `
              <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #d97706; background-color: #fffbeb;">${stats.nPerm} (${stats.total ? ((stats.nPerm/stats.total)*100).toFixed(0) : 0}%)</td>
            `;
          }
          html += `
            <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #e11d48; background-color: #fff5f5;">${stats.nFail} (${stats.total ? ((stats.nFail/stats.total)*100).toFixed(0) : 0}%)</td>
          `;
        }

        html += `
          <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #475569;">${minD}</td>
          <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #475569;">${maxD}</td>
          <td style="border: 1px solid #e2e8f0; padding: 5px; text-align: center; color: #1e3a8a; font-weight: bold;">${avgD}</td>
        `;
      });

      html += `
        </tr>
      `;
    });

    if (grandTotalRow) {
      html += `
        <tr style="background-color: #e0e7ff; font-weight: bold; border-top: 1.5pt solid #4f46e5;">
          <td colspan="${reportingLevel === "Block" ? 4 : reportingLevel === "District" ? 3 : 2}" style="border: 1px solid #c7d2fe; padding: 6px; text-align: right; font-weight: bold; color: #4338ca;">Grand Total / Compliances</td>
      `;

      uniquePeriods.forEach((period) => {
        const stats = grandTotalRow.periods?.[period] || grandTotalRow.periodStats?.[period] || {
          total: 0, nAcc: 0, nPerm: 0, nFail: 0,
          nSarS1: 0, nSarS2: 0, nSarS3: 0, nSarS4: 0,
          min: NaN, max: NaN, avg: NaN
        };

        const minD = isNaN(stats.min) ? "-" : stats.min.toFixed(2);
        const maxD = isNaN(stats.max) ? "-" : stats.max.toFixed(2);
        const avgD = isNaN(stats.avg) ? "-" : stats.avg.toFixed(2);

        html += `
          <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; font-weight: bold; color: #4338ca;">${stats.total}</td>
        `;

        if (isSar) {
          html += `
            <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #059669; background-color: #ecfdf5;">${stats.nSarS1} (${stats.total ? ((stats.nSarS1/stats.total)*100).toFixed(0) : 0}%)</td>
            <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #d97706; background-color: #fef3c7;">${stats.nSarS2} (${stats.total ? ((stats.nSarS2/stats.total)*100).toFixed(0) : 0}%)</td>
            <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #ea580c; background-color: #fff7ed;">${stats.nSarS3} (${stats.total ? ((stats.nSarS3/stats.total)*100).toFixed(0) : 0}%)</td>
            <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #e11d48; background-color: #fff1f2;">${stats.nSarS4} (${stats.total ? ((stats.nSarS4/stats.total)*100).toFixed(0) : 0}%)</td>
          `;
        } else {
          html += `
            <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #059669; background-color: #ecfdf5;">${stats.nAcc} (${stats.total ? ((stats.nAcc/stats.total)*100).toFixed(0) : 0}%)</td>
          `;
          if (activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2) {
            html += `
              <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #d97706; background-color: #fef3c7;">${stats.nPerm} (${stats.total ? ((stats.nPerm/stats.total)*100).toFixed(0) : 0}%)</td>
            `;
          }
          html += `
            <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #e11d48; background-color: #fff1f2;">${stats.nFail} (${stats.total ? ((stats.nFail/stats.total)*100).toFixed(0) : 0}%)</td>
          `;
        }

        html += `
          <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #475569;">${minD}</td>
          <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #475569;">${maxD}</td>
          <td style="border: 1px solid #c7d2fe; padding: 6px; text-align: center; color: #4338ca; font-weight: bold;">${avgD}</td>
        `;
      });

      html += `
        </tr>
      `;
    }

    html += `
        </tbody>
      </table>
    `;

    const key = `sent_table_detailed_compliance_${activeParam}`;
    setSharedBulletinMaps((prev) => ({
      ...prev,
      [key]: html,
    }));

    setSentItems((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setSentItems((prev) => ({ ...prev, [key]: false }));
    }, 3000);
  };

  const handleSelectAllExport = () => {
    if (exportParams.length === availableParams.length) {
      setExportParams([]);
    } else {
      setExportParams([...availableParams]);
    }
  };

  const handleSelectAllCombined = () => {
    if (combinedParams.length === availableParams.length) {
      setCombinedParams([]);
    } else {
      setCombinedParams([...availableParams]);
    }
  };

  const toggleExportItem = (headerCol: string) => {
    if (exportParams.includes(headerCol)) {
      setExportParams(exportParams.filter((p) => p !== headerCol));
    } else {
      setExportParams([...exportParams, headerCol]);
    }
  };

  const toggleCombinedItem = (headerCol: string) => {
    if (combinedParams.includes(headerCol)) {
      setCombinedParams(combinedParams.filter((p) => p !== headerCol));
    } else {
      setCombinedParams([...combinedParams, headerCol]);
    }
  };

  if (!activeConfig) return null;

  const totalAnalyzed = grandTotalRow ? grandTotalRow.total : 0;
  const safeCount = grandTotalRow ? (
    activeParam === "SAR"
      ? (grandTotalRow.nSarS1 + grandTotalRow.nSarS2 + grandTotalRow.nSarS3)
      : (activeParam === "MH"
          ? grandTotalRow.nAcc
          : (["RSC", "SSP", "Na%", "PI", "KR", "TDS", "Alkalinity"].includes(activeParam)
              ? (grandTotalRow.nAcc + grandTotalRow.nPerm)
              : grandTotalRow.nAcc
            )
        )
  ) : 0;
  const limitsCheckAndUnits = activeConfigKey === "pH" 
    ? `${activeConfig.b1} - ${activeConfig.b2}` 
    : (activeParam === "SAR"
        ? "≤ 26 Ratio"
        : `≤ ${activeConfig.b2} ${activeConfig.unit}`
      );

  return (
    <div className="space-y-6">

      {/* Fullscreen Overlay */}
      {isFullscreen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex flex-col items-center justify-center p-4 md:p-8 animate-fade-in">
          <div className={`w-full max-w-5xl h-[85vh] rounded-3xl p-6 relative ${chartTheme} flex flex-col shadow-2xl border border-white/10`}>
            {/* Fullscreen header buttons */}
            <div className="absolute top-4 right-4 z-20 flex gap-2">
              {setSharedBulletinMaps && (
                <button
                  onClick={handleSendToBulletin}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg px-3 py-2 rounded-xl transition-all font-bold text-xs flex items-center gap-1.5 border border-indigo-500"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isSent ? "Sent to Annual Report!" : "Send to Annual Report"}
                </button>
              )}
              <button
                onClick={handleDownloadJPEG}
                className="bg-white/10 text-white backdrop-blur shadow-md px-3 py-2 rounded-xl hover:bg-white/20 transition-all font-bold text-xs border border-white/15 flex items-center gap-1.5"
              >
                <Image className="w-3.5 h-3.5" /> Download
              </button>
              <button
                onClick={() => setIsFullscreen(false)}
                className="bg-rose-600/90 hover:bg-rose-600 text-white shadow-md p-2 rounded-xl transition-all border border-rose-500 flex items-center justify-center"
                title="Exit Fullscreen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Highcharts target container */}
            <div id="fullscreen-chart-container" className="w-full h-full min-h-0 flex-1 mt-10" />
          </div>
        </div>
      )}
      
      {/* Visual Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Refined chart wrapper container */}
        <div 
          ref={containerRef}
          className={`lg:col-span-2 p-4 md:p-6 shadow-sm border border-slate-100 flex flex-col items-center justify-center min-h-[350px] md:min-h-[500px] relative ${chartTheme} rounded-[1.5rem] overflow-hidden transition-all`}
        >
          {rawData.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 gap-4 bg-slate-50 border border-slate-100 rounded-3xl w-full h-[430px] shadow-inner select-none pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 text-indigo-500 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              <p className="font-extrabold text-slate-800 text-sm uppercase tracking-wide">
                Waiting for groundwater spreadsheet data upload
              </p>
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-relaxed max-w-sm text-center">
                Charts and interactive diagrams will populate dynamically once spreadsheet rows have been parsed and synchronized!
              </span>
            </div>
          ) : (
            <div id="chart-container" className="h-[280px] md:h-[430px] w-full" />
          )}
          {rawData.length > 0 && (
            <div className="absolute bottom-4 right-4 flex gap-2 z-20">
              {setSharedBulletinMaps && (
                <button
                  onClick={handleSendToBulletin}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md px-3 py-2 rounded-xl transition-all font-bold text-xs flex items-center gap-1.5 border border-indigo-500"
                  title="Send chart with transparent background to Annual Report section"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isSent ? "Sent!" : "Send to Annual Report"}
                </button>
              )}
              
              <button
                onClick={() => setIsFullscreen(true)}
                className="bg-white/80 backdrop-blur shadow-md p-2.5 rounded-xl hover:bg-white transition-all group border border-slate-200"
                title="View chart in Fullscreen"
              >
                <Maximize2 className="w-4 h-4 text-slate-600 group-hover:scale-110 transition-transform" />
              </button>

              <button
                onClick={handleDownloadJPEG}
                className="bg-white/80 backdrop-blur shadow-md p-2.5 rounded-xl hover:bg-white transition-all group border border-slate-200"
                title="Save chart as JPEG image"
              >
                <Image className="w-4 h-4 text-slate-600 group-hover:scale-110 transition-transform" />
              </button>
            </div>
          )}
        </div>

        {/* Customization controls */}
        <div className="glossy-panel p-6 rounded-3xl flex flex-col h-full overflow-y-auto max-h-[600px] custom-scrollbar">
          <h3 className="text-lg font-black mb-4 text-slate-800 flex items-center gap-2 drop-shadow-sm">
            <Settings2 className="w-5 h-5 text-indigo-500" />
            Chart Customization
          </h3>

          <div className="space-y-5">
            {/* Custom chart titles */}
            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100/80 space-y-3.5 shadow-inner">
              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block drop-shadow-sm">
                Advanced Titles & Axis Labels
              </span>

              {/* Compliance Donut Title */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                  Main Compliance Donut Title
                </label>
                <input
                  type="text"
                  placeholder="Compliance Donut title..."
                  value={chartTitle}
                  onChange={(e) => setChartTitle(e.target.value)}
                  className="w-full glossy-input rounded-xl p-2.5 text-xs font-bold text-slate-700 bg-white placeholder:text-slate-400"
                />
              </div>

              {/* Exceedance Chart Titles */}
              <div className="space-y-2 p-3 bg-white rounded-xl border border-slate-100">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">
                  Exceedance Chart
                </span>
                <div>
                  <label className="text-[9px] font-medium text-slate-500 block mb-0.5">Custom Title</label>
                  <input
                    type="text"
                    placeholder="Exceedance rate chart..."
                    value={exceedanceChartTitle}
                    onChange={(e) => setExceedanceChartTitle(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg bg-white border border-slate-200 font-bold"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-medium text-slate-500 block mb-0.5">X-Axis Title</label>
                    <input
                      type="text"
                      placeholder="e.g. State Name"
                      value={exceedanceXAxisTitle}
                      onChange={(e) => setExceedanceXAxisTitle(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg bg-white border border-slate-200 font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-medium text-slate-500 block mb-0.5">Y-Axis Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Percentage (%)"
                      value={exceedanceYAxisTitle}
                      onChange={(e) => setExceedanceYAxisTitle(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg bg-white border border-slate-200 font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Seasonal Chart Titles */}
              <div className="space-y-2 p-3 bg-white rounded-xl border border-slate-100">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">
                  Seasonal Distributions
                </span>
                <div>
                  <label className="text-[9px] font-medium text-slate-500 block mb-0.5">Custom Title Prefix</label>
                  <input
                    type="text"
                    placeholder="Seasonal chart prefix..."
                    value={seasonalChartTitle}
                    onChange={(e) => setSeasonalChartTitle(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg bg-white border border-slate-200 font-bold"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-medium text-slate-500 block mb-0.5">X-Axis Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Regions"
                      value={seasonalXAxisTitle}
                      onChange={(e) => setSeasonalXAxisTitle(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg bg-white border border-slate-200 font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-medium text-slate-500 block mb-0.5">Y-Axis Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Values"
                      value={seasonalYAxisTitle}
                      onChange={(e) => setSeasonalYAxisTitle(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg bg-white border border-slate-200 font-bold"
                    />
                  </div>
                </div>
              </div>



            </div>

            {/* Theme */}
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                Background Theme
              </label>
              <select
                value={chartTheme}
                onChange={(e) => setChartTheme(e.target.value)}
                className="w-full glossy-input rounded-xl p-2.5 text-sm font-bold text-slate-700 bg-white"
              >
                <option value="theme-white">Glossy White</option>
                <option value="theme-slate">Metallic Slate</option>
                <option value="theme-dark">Deep Glass Dark</option>
                <option value="theme-indigo">Soft Indigo Pearl</option>
                <option value="theme-emerald">Fresh Emerald Dew</option>
              </select>
            </div>

            {/* Typography */}
            <div className="bg-white/40 p-4 rounded-2xl space-y-4 shadow-inner border border-white/60">
              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block drop-shadow-sm">
                Typography Controls
              </span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Font Family</label>
                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold"
                  >
                    <option value="'Plus Jakarta Sans'">Jakarta Sans</option>
                    <option value="Inter">Inter UI</option>
                    <option value="'Playfair Display'">Serif Classic</option>
                    <option value="'Roboto Mono'">Monospace</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Font Size</label>
                  <input
                    type="number"
                    min="8"
                    max="24"
                    value={fontSize}
                    onChange={(e) => setFontSize(parseInt(e.target.value) || 12)}
                    className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold"
                  />
                </div>
              </div>

              <div className="flex gap-4 items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fontBold}
                    onChange={(e) => setFontBold(e.target.checked)}
                    className="rounded text-indigo-600 shadow-sm w-4 h-4"
                  />
                  <span className="text-[11px] font-bold text-slate-700">Bold labels</span>
                </label>
              </div>
            </div>

            {/* Colors picker */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                  Acc.
                </label>
                <input
                  type="color"
                  value={colorAcc}
                  onChange={(e) => setColorAcc(e.target.value)}
                  className="w-full h-8 rounded cursor-pointer border-none p-0 bg-transparent drop-shadow-sm"
                />
              </div>
              
              {activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2 && (
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                    Perm.
                  </label>
                  <input
                    type="color"
                    value={colorPerm}
                    onChange={(e) => setColorPerm(e.target.value)}
                    className="w-full h-8 rounded cursor-pointer border-none p-0 bg-transparent drop-shadow-sm"
                  />
                </div>
              )}

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                  Above
                </label>
                <input
                  type="color"
                  value={colorFail}
                  onChange={(e) => setColorFail(e.target.value)}
                  className="w-full h-8 rounded cursor-pointer border-none p-0 bg-transparent drop-shadow-sm"
                />
              </div>
            </div>

            {/* Compliance stats overview */}
            <div className="space-y-3 pt-4 border-t border-white/50">
              <div className="bg-white/40 p-3 rounded-xl flex justify-between items-center shadow-inner border border-white/60">
                <span className="text-[10px] font-black uppercase opacity-60">Total parsed</span>
                <span className="text-xl font-black text-slate-800 drop-shadow-sm">
                  {totalAnalyzed}
                </span>
              </div>
              <div className="bg-emerald-50/50 p-3 rounded-xl flex justify-between items-center shadow-inner border border-emerald-100/50">
                <span className="text-[10px] font-black uppercase text-emerald-700">
                  {activeConfigKey === "pH" ? "Compliant (Within limits)" : "Acceptable Samples"}
                </span>
                <span className="text-xl font-black text-emerald-800 drop-shadow-sm">
                  {safeCount}
                </span>
              </div>
            </div>

          </div>
        </div>

      </div>

      {/* Filter and Config Selection Area */}
      <div className="glossy-panel glossy-panel-dropdown p-6 rounded-3xl grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 items-start relative z-50">
        
        {/* Active parameter stats selector */}
        <div>
          <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block mb-2 drop-shadow-sm">
            4. Active Parameter for Stats
          </label>
          <select
            value={activeParam}
            onChange={(e) => setActiveParam(e.target.value)}
            className="w-full glossy-input bg-indigo-50/30 rounded-xl p-3 font-bold text-indigo-800 cursor-pointer"
          >
            {(() => {
              const extraNames: Record<string, string> = {
                Alkalinity: "Total Alkalinity (Alkalinity)",
                SAR: "Sodium Adsorption Ratio (SAR)",
                RSC: "Residual Sodium Carbonate (RSC)",
                SSP: "Soluble Sodium Percentage (SSP)",
                "Na%": "Sodium Percentage (%Na)",
                PI: "Permeability Index (PI)",
                KR: "Kelly's Ratio (KR)",
                MH: "Magnesium Hazard (MH)",
                TDS: "Total Dissolved Solids (TDS)"
              };
              
              const rendered = new Set<string>();
              return availableParams.map((p, idx) => {
                if (rendered.has(p)) return null;
                rendered.add(p);
                const label = extraNames[p] || p;
                return (
                  <option key={idx} value={p}>
                    {label}
                  </option>
                );
              }).filter(Boolean);
            })()}
          </select>
        </div>

        {/* Export spreadsheet headers dropdown */}
        <div className="relative">
          <label className="text-[10px] font-black text-emerald-700 uppercase tracking-widest block mb-2 drop-shadow-sm">
            5. Export Report Parameters
          </label>
          <div className="relative">
            <button
              onClick={() => {
                setExportDropdownOpen(!exportDropdownOpen);
                setCombinedDropdownOpen(false);
              }}
              className="w-full glossy-input bg-emerald-50/30 rounded-xl p-3 font-bold text-emerald-800 flex justify-between items-center text-left"
            >
              <span className="truncate">
                {exportParams.length === availableParams.length
                  ? "All Parameters Selected"
                  : `${exportParams.length} Parameters Selected`}
              </span>
              <ChevronDown className="w-4 h-4 ml-2 shrink-0" />
            </button>
            {exportDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl z-[100] max-h-60 overflow-y-auto custom-scrollbar p-2">
                <label className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-100 font-bold text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={exportParams.length === availableParams.length}
                    onChange={handleSelectAllExport}
                    className="rounded text-emerald-600 w-4 h-4"
                  />
                  <span>Select All</span>
                </label>
                {availableParams.map((val) => (
                  <label key={val} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={exportParams.includes(val)}
                      onChange={() => toggleExportItem(val)}
                      className="rounded text-emerald-600 w-4 h-4"
                    />
                    <span>{val}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Additional export sheets flags */}
        <div>
          <label className="text-[10px] font-black text-rose-600 uppercase tracking-widest block mb-2 drop-shadow-sm">
            6. Additional Export Sheets
          </label>
          <div className="glossy-input bg-rose-50/30 rounded-xl p-3.5 flex flex-col gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={exportIndividualExceedance}
                onChange={(e) => setExportIndividualExceedance(e.target.checked)}
                className="rounded text-rose-600 w-4.4 h-4.4 shadow-sm"
              />
              <span className="text-[11px] font-bold text-rose-800 truncate">Exceedance Locations (Individual)</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={exportCombinedExceedance}
                onChange={(e) => setExportCombinedExceedance(e.target.checked)}
                className="rounded text-rose-600 w-4.4 h-4.4 shadow-sm"
              />
              <span className="text-[11px] font-bold text-rose-800 truncate">Combined Exceedances</span>
            </label>
          </div>
        </div>

        {/* Combined parameters list */}
        <div className="relative">
          <label className="text-[10px] font-black text-fuchsia-700 uppercase tracking-widest block mb-2 drop-shadow-sm">
            7. Combined Exceedance Params
          </label>
          <div className="relative">
            <button
              onClick={() => {
                setCombinedDropdownOpen(!combinedDropdownOpen);
                setExportDropdownOpen(false);
              }}
              className="w-full glossy-input bg-fuchsia-50/30 rounded-xl p-3 font-bold text-fuchsia-800 flex justify-between items-center text-left"
            >
              <span className="truncate">
                {combinedParams.length === availableParams.length
                  ? "All Parameters Selected"
                  : `${combinedParams.length} Parameters Selected`}
              </span>
              <ChevronDown className="w-4 h-4 ml-2 shrink-0" />
            </button>
            {combinedDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl z-[100] max-h-60 overflow-y-auto custom-scrollbar p-2">
                <label className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-100 font-bold text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={combinedParams.length === availableParams.length}
                    onChange={handleSelectAllCombined}
                    className="rounded text-fuchsia-600 w-4 h-4"
                  />
                  <span>Select All</span>
                </label>
                {availableParams.map((val) => (
                  <label key={val} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={combinedParams.includes(val)}
                      onChange={() => toggleCombinedItem(val)}
                      className="rounded text-fuchsia-600 w-4 h-4"
                    />
                    <span>{val}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Advanced Statistical Distributions & Seasonal Breakdown Section */}
      {rawData.length > 0 && (
        <div className="glossy-panel p-6 rounded-3xl space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-indigo-600" />
                Advanced Statistical Distributions &amp; Seasonal Breakdowns
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Detailed box plots, average values, and kernel density violin plots grouped by {reportingLevel} and split by season.
              </p>
            </div>
            
            {/* Stat Tab Selector */}
            <div className="flex bg-slate-100/80 p-1 rounded-xl border border-slate-200 shadow-inner">
              <button
                onClick={() => setStatTab("boxplot")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  statTab === "boxplot"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Box Plot
              </button>
              <button
                onClick={() => setStatTab("average")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  statTab === "average"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Average Plot
              </button>
              <button
                onClick={() => setStatTab("violin")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  statTab === "violin"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                Violin Plot
              </button>
              <button
                onClick={() => setStatTab("donut")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  statTab === "donut"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <PieChart className="w-3.5 h-3.5" />
                Donut Chart
              </button>
              <button
                onClick={() => setStatTab("ogive")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  statTab === "ogive"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Ogive Curve
              </button>
            </div>
          </div>

          {/* Advanced Scope & Affected Location Controls */}
          <div className="bg-gradient-to-r from-indigo-50/50 via-slate-50/50 to-emerald-50/50 p-5 rounded-2xl border border-slate-100 flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Chart Analytics Scope</span>
                  <div className="flex bg-slate-100/70 p-1 rounded-xl border border-slate-200">
                    <button
                      onClick={() => setGroupScope("selected")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        groupScope === "selected"
                          ? "bg-white text-indigo-700 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Selected Location
                    </button>
                    <button
                      onClick={() => setGroupScope("national")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        groupScope === "national"
                          ? "bg-white text-indigo-700 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      National (All India)
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Affected Location Filter</span>
                  <div className="flex bg-slate-100/70 p-1 rounded-xl border border-slate-200">
                    <button
                      onClick={() => setExceedanceFilter("all")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        exceedanceFilter === "all"
                          ? "bg-white text-emerald-700 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      All Locations
                    </button>
                    <button
                      onClick={() => setExceedanceFilter("affected")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        exceedanceFilter === "affected"
                          ? "bg-white text-emerald-700 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Partially Affected Only
                    </button>
                  </div>
                </div>
              </div>

              <div className="text-left md:text-right">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Status Banner</span>
                <p className="text-xs font-bold text-slate-600">
                  Plotting <span className="text-indigo-600">{statTab === "boxplot" ? "Box plots" : statTab === "average" ? "Averages" : statTab === "violin" ? "Violin curves" : statTab === "donut" ? "Donut charts" : "Ogive curves"}</span> for{" "}
                  <span className="text-emerald-600">
                    {groupScope === "national"
                      ? "all of India"
                      : multiSelectMode
                      ? `${(reportingLevel === "State" ? selectedStatesList : selectedDistrictsList).slice(0, 15).join(", ") || "Selected Locations"}`
                      : selectedState || "Selected State"}
                  </span>{" "}
                  grouped by <span className="text-indigo-600">{reportingLevel}</span>
                  {exceedanceFilter === "affected" && (
                    <span className="text-rose-600"> (Filtering partially affected groups)</span>
                  )}
                </p>
              </div>
            </div>

            {groupScope === "selected" && (
              <div className="border-t border-slate-200/60 pt-4 mt-2 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                      <SlidersHorizontal className="w-4 h-4 text-indigo-500" />
                      Comparative Multi-Selection Filter Mode
                    </h4>
                    <p className="text-[10px] text-slate-500 font-bold">
                      Compare up to 15 states/districts side-by-side in all seasonal distributions.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={multiSelectMode}
                      onChange={(e) => {
                        setMultiSelectMode(e.target.checked);
                        if (e.target.checked) {
                          if (selectedState && !selectedStatesList.includes(selectedState)) {
                            setSelectedStatesList([selectedState]);
                          }
                          if (selectedDistrict && !selectedDistrictsList.includes(selectedDistrict)) {
                            setSelectedDistrictsList([selectedDistrict]);
                          }
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                    <span className="ml-2 text-xs font-bold text-slate-600">
                      {multiSelectMode ? "Enabled" : "Disabled"}
                    </span>
                  </label>
                </div>

                {multiSelectMode && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* State Selector */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">
                        Select States (Max 15)
                      </span>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search States..."
                          value={stateSearch}
                          onChange={(e) => setStateSearch(e.target.value)}
                          className="w-full text-xs bg-white border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="mt-1.5 bg-white border border-slate-200 rounded-xl max-h-32 overflow-y-auto custom-scrollbar p-1.5 flex flex-wrap gap-1.5">
                          {filteredStatesForSelect.map((s) => {
                            const isSel = selectedStatesList.includes(s);
                            return (
                              <button
                                key={s}
                                type="button"
                                onClick={() => {
                                  if (isSel) {
                                    setSelectedStatesList(prev => prev.filter(item => item !== s));
                                  } else {
                                    if (selectedStatesList.length < 15) {
                                      setSelectedStatesList(prev => [...prev, s]);
                                    }
                                  }
                                }}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                                  isSel
                                    ? "bg-indigo-600 text-white border-indigo-600"
                                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                }`}
                              >
                                {s}
                                {isSel && <Check className="w-3 h-3 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* District Selector */}
                    {reportingLevel !== "State" && (
                      <div className="space-y-2">
                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest block">
                          Select Districts (Max 15)
                        </span>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Search Districts..."
                            value={districtSearch}
                            onChange={(e) => setDistrictSearch(e.target.value)}
                            className="w-full text-xs bg-white border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <div className="mt-1.5 bg-white border border-slate-200 rounded-xl max-h-32 overflow-y-auto custom-scrollbar p-1.5 flex flex-wrap gap-1.5">
                            {filteredDistrictsForSelect.map((d) => {
                              const isSel = selectedDistrictsList.includes(d);
                              return (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => {
                                    if (isSel) {
                                      setSelectedDistrictsList(prev => prev.filter(item => item !== d));
                                    } else {
                                      if (selectedDistrictsList.length < 15) {
                                        setSelectedDistrictsList(prev => [...prev, d]);
                                      }
                                    }
                                  }}
                                  className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                                    isSel
                                      ? "bg-emerald-600 text-white border-emerald-600"
                                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                  }`}
                                >
                                  {d}
                                  {isSel && <Check className="w-3 h-3 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Dynamic Grid Layout for Seasonal Charts */}
          {(() => {
            const seasonsList = Object.keys(seasonalGroupedData).sort();
            const gridColsClass = seasonsList.length >= 2 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1";
            
            return (
              <div className={`grid ${gridColsClass} gap-6`}>
                {seasonsList.map((season) => {
                  const idSafeSeason = season.replace(/\s+/g, "-");
                  return (
                    <div key={season} className="bg-white/60 p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col min-h-[420px] backdrop-blur-sm">
                      <div className="flex justify-between items-center mb-3 border-b border-slate-100 pb-2">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <Circle className="w-2.5 h-2.5 text-indigo-500 fill-indigo-500" />
                          {season} Season
                        </span>
                        <div className="flex items-center gap-2">
                          {setSharedBulletinMaps && (
                            <button
                              onClick={() => sendSeasonalChartToBulletin(season, statTab)}
                              className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                                sentItems[`sent_chart_${statTab}_${season.replace(/[^a-zA-Z0-9]/g, "_")}`]
                                  ? "bg-emerald-500 text-white border-emerald-500"
                                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-indigo-600"
                              }`}
                            >
                              <Send className="w-3 h-3" />
                              {sentItems[`sent_chart_${statTab}_${season.replace(/[^a-zA-Z0-9]/g, "_")}`] ? "Sent!" : "Send to Report"}
                            </button>
                          )}
                          <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full">
                            {Object.keys(seasonalGroupedData[season] || {}).length} Groups
                          </span>
                        </div>
                      </div>
                      
                      <div 
                        id={`${statTab}-chart-${idSafeSeason}`} 
                        className="w-full h-[370px] mt-2" 
                      />
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}



      {/* Table Section Header */}
      {rawData.length > 0 && (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div>
            <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
              <Table className="w-5 h-5 text-indigo-600" />
              Detailed Multi-Season Analytical &amp; Compliance Table
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              Bifurcated multi-season and multi-year compliance figures showing total samples, classifications, min, max, and averages.
            </p>
          </div>
          {setSharedBulletinMaps && (
            <button
              onClick={sendTableToBulletin}
              className={`px-4 py-2 rounded-xl border transition-all flex items-center gap-2 text-xs font-bold ${
                sentItems[`sent_table_detailed_compliance_${activeParam}`]
                  ? "bg-emerald-500 text-white border-emerald-500 shadow-md"
                  : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 shadow-md"
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              {sentItems[`sent_table_detailed_compliance_${activeParam}`] ? "Table Sent!" : "Send Table to Report"}
            </button>
          )}
        </div>
      )}

      {/* Primary detail table mapping columns */}
      <div className="glossy-panel rounded-3xl overflow-hidden shadow-md">
        <div className="overflow-x-auto overflow-y-auto max-h-[550px] custom-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            {uniquePeriods.length > 1 ? (
              <>
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="sticky-header">
                    <th rowSpan={2} className="p-3 border font-black text-slate-500 tracking-tighter text-center sticky left-0 bg-slate-50 shadow-[2px_0_5px_rgba(0,0,0,0.05)] z-20">S.No.</th>
                    {reportingLevel !== "State" && (
                      <th rowSpan={2} className="p-3 border font-black text-slate-500 tracking-tighter bg-slate-100">State</th>
                    )}
                    {reportingLevel === "Block" && (
                      <th rowSpan={2} className="p-3 border font-black text-slate-500 tracking-tighter bg-slate-100">District</th>
                    )}
                    <th rowSpan={2} className="p-3 border font-black text-[#1e3a8a] tracking-tighter bg-slate-100 font-bold sticky left-12 bg-slate-50 shadow-[2px_0_5px_rgba(0,0,0,0.05)] z-20">
                      {reportingLevel === "State" ? "State Name" : reportingLevel === "District" ? "District Name" : "Block / Tehsil"}
                    </th>
                    {uniquePeriods.map((period) => {
                      const colsCount = activeParam === "SAR" ? 8 : (activeConfigKey === "pH" || activeConfig.b1 === activeConfig.b2 ? 6 : 7);
                      return (
                        <th key={period} colSpan={colsCount} className="p-3 border font-black text-center text-indigo-700 bg-indigo-50 border-indigo-150 uppercase tracking-wider font-extrabold">
                          {period}
                        </th>
                      );
                    })}
                  </tr>
                  <tr className="bg-slate-50">
                    {uniquePeriods.map((period) => (
                      <React.Fragment key={period}>
                        <th className="p-2 border font-black text-slate-500 text-center text-[10px] bg-slate-50/50">Total</th>
                        {activeParam === "SAR" ? (
                          <>
                            <th className="p-2 border font-black text-emerald-600 text-center text-[10px] bg-emerald-50/30">≤10</th>
                            <th className="p-2 border font-black text-amber-600 text-center text-[10px] bg-amber-50/30">&gt;10-18</th>
                            <th className="p-2 border font-black text-orange-600 text-center text-[10px] bg-orange-50/30">&gt;18-26</th>
                            <th className="p-2 border font-black text-rose-600 text-center text-[10px] bg-rose-50/30">&gt;26</th>
                          </>
                        ) : (
                          <>
                            <th className="p-2 border font-black text-emerald-600 text-center text-[10px] bg-emerald-50/30">
                              {getTableHeaderLabels(activeConfigKey, activeConfig).acc.split(" (")[0]}
                            </th>
                            {activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2 && (
                              <th className="p-2 border font-black text-amber-600 text-center text-[10px] bg-amber-50/30">
                                {getTableHeaderLabels(activeConfigKey, activeConfig).perm.split(" (")[0]}
                              </th>
                            )}
                            <th className="p-2 border font-black text-rose-600 text-center text-[10px] bg-rose-50/30">
                              {getTableHeaderLabels(activeConfigKey, activeConfig).fail.split(" (")[0]}
                            </th>
                          </>
                        )}
                        <th className="p-2 border font-black text-slate-500 text-center text-[10px] bg-slate-50/50">Min</th>
                        <th className="p-2 border font-black text-slate-500 text-center text-[10px] bg-slate-50/50">Max</th>
                        <th className="p-2 border font-black text-slate-500 text-center text-[10px] bg-slate-50/50">Avg</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={100} className="p-12 text-center text-slate-400 font-bold uppercase tracking-wider">
                        No data uploaded yet. Please upload a spreadsheet to view parameter compliance details.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {tableRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors font-medium text-slate-700">
                          <td className="p-3 border sticky left-0 bg-white border-r text-slate-400 font-bold z-10 text-center shadow-[2px_0_5px_rgba(0,0,0,0.05)]">{idx + 1}</td>
                          {reportingLevel !== "State" && (
                            <td className="p-3 border text-slate-600 bg-white">{row.state}</td>
                          )}
                          {reportingLevel === "Block" && (
                            <td className="p-3 border text-slate-600 bg-white">{row.district}</td>
                          )}
                          <td className="p-3 border font-bold text-slate-900 sticky left-12 bg-white z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">{row.name}</td>
                          {uniquePeriods.map((period) => {
                            const stats = (row.periodStats && row.periodStats[period]) || {
                              total: 0,
                              nAcc: 0, nPctAcc: 0,
                              nPerm: 0, nPctPerm: 0,
                              nFail: 0, nPctFail: 0,
                              nSarS1: 0, nPctSarS1: 0,
                              nSarS2: 0, nPctSarS2: 0,
                              nSarS3: 0, nPctSarS3: 0,
                              nSarS4: 0, nPctSarS4: 0,
                              min: NaN, max: NaN, avg: NaN
                            };

                            const formatVal = (v: number) => isNaN(v) || v === null ? "-" : v.toFixed(2);

                            return (
                              <React.Fragment key={period}>
                                <td className="p-2 border text-center font-bold text-slate-500 bg-slate-50/10">{stats.total}</td>
                                {activeParam === "SAR" ? (
                                  <>
                                    <td className="p-2 border text-center bg-emerald-50/10">
                                      <div className="font-extrabold text-emerald-700">{stats.nSarS1 || 0}</div>
                                      <div className="text-[9px] font-bold text-emerald-500/80">{(stats.nPctSarS1 || 0).toFixed(1)}%</div>
                                    </td>
                                    <td className="p-2 border text-center bg-amber-50/10">
                                      <div className="font-extrabold text-amber-700">{stats.nSarS2 || 0}</div>
                                      <div className="text-[9px] font-bold text-amber-500/80">{(stats.nPctSarS2 || 0).toFixed(1)}%</div>
                                    </td>
                                    <td className="p-2 border text-center bg-orange-50/10">
                                      <div className="font-extrabold text-orange-700">{stats.nSarS3 || 0}</div>
                                      <div className="text-[9px] font-bold text-orange-500/80">{(stats.nPctSarS3 || 0).toFixed(1)}%</div>
                                    </td>
                                    <td className="p-2 border text-center bg-rose-50/10">
                                      <div className="font-extrabold text-rose-700">{stats.nSarS4 || 0}</div>
                                      <div className="text-[9px] font-bold text-rose-500/80">{(stats.nPctSarS4 || 0).toFixed(1)}%</div>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="p-2 border text-center bg-emerald-50/10">
                                      <div className="font-extrabold text-emerald-700">{stats.nAcc}</div>
                                      <div className="text-[9px] font-bold text-emerald-500/80">{stats.nPctAcc.toFixed(1)}%</div>
                                    </td>
                                    {activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2 && (
                                      <td className="p-2 border text-center bg-amber-50/10">
                                        <div className="font-extrabold text-amber-700">{stats.nPerm}</div>
                                        <div className="text-[9px] font-bold text-amber-500/80">{stats.nPctPerm.toFixed(1)}%</div>
                                      </td>
                                    )}
                                    <td className="p-2 border text-center bg-rose-50/10">
                                      <div className="font-extrabold text-rose-700">{stats.nFail}</div>
                                      <div className="text-[9px] font-bold text-rose-500/80">{stats.nPctFail.toFixed(1)}%</div>
                                    </td>
                                  </>
                                )}
                                <td className="p-2 border text-center font-mono text-xs">{formatVal(stats.min)}</td>
                                <td className="p-2 border text-center font-mono text-xs">{formatVal(stats.max)}</td>
                                <td className="p-2 border text-center font-black text-indigo-600 font-mono text-xs">{formatVal(stats.avg)}</td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      ))}

                      {/* Grand total summary row */}
                      {grandTotalRow && (
                        <tr className="bg-slate-900 text-white font-extrabold text-xs">
                          <td className="p-3 border border-slate-700 text-slate-500 text-center sticky left-0 bg-slate-900 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">-</td>
                          {reportingLevel !== "State" && <td className="p-3 border border-slate-700 bg-slate-900" />}
                          {reportingLevel === "Block" && <td className="p-3 border border-slate-700 bg-slate-900" />}
                          <td className="p-3 border border-slate-700 text-center tracking-wide pr-5 sticky left-12 bg-slate-900 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">GRAND TOTAL</td>
                          {uniquePeriods.map((period) => {
                            const stats = (grandTotalRow.periodStats && grandTotalRow.periodStats[period]) || {
                              total: 0,
                              nAcc: 0, nPctAcc: 0,
                              nPerm: 0, nPctPerm: 0,
                              nFail: 0, nPctFail: 0,
                              nSarS1: 0, nPctSarS1: 0,
                              nSarS2: 0, nPctSarS2: 0,
                              nSarS3: 0, nPctSarS3: 0,
                              nSarS4: 0, nPctSarS4: 0,
                              min: NaN, max: NaN, avg: NaN
                            };

                            const formatVal = (v: number) => isNaN(v) || v === null ? "-" : v.toFixed(2);

                            return (
                              <React.Fragment key={period}>
                                <td className="p-2 border border-slate-700 text-center font-extrabold text-slate-300">{stats.total}</td>
                                {activeParam === "SAR" ? (
                                  <>
                                    <td className="p-2 border border-slate-700 text-center bg-[#064e3b]">
                                      <div className="text-emerald-300 font-black text-sm">{stats.nSarS1 || 0}</div>
                                      <div className="text-[9.5px] opacity-80">{(stats.nPctSarS1 || 0).toFixed(1)}%</div>
                                    </td>
                                    <td className="p-2 border border-slate-700 text-center bg-[#78350f]">
                                      <div className="text-amber-300 font-black text-sm">{stats.nSarS2 || 0}</div>
                                      <div className="text-[9.5px] opacity-80">{(stats.nPctSarS2 || 0).toFixed(1)}%</div>
                                    </td>
                                    <td className="p-2 border border-slate-700 text-center bg-[#c2410c]">
                                      <div className="text-orange-300 font-black text-sm">{stats.nSarS3 || 0}</div>
                                      <div className="text-[9.5px] opacity-80">{(stats.nPctSarS3 || 0).toFixed(1)}%</div>
                                    </td>
                                    <td className="p-2 border border-slate-700 text-center bg-[#881337]">
                                      <div className="text-rose-300 font-black text-sm">{stats.nSarS4 || 0}</div>
                                      <div className="text-[9.5px] opacity-80">{(stats.nPctSarS4 || 0).toFixed(1)}%</div>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="p-2 border border-slate-700 text-center bg-[#064e3b]">
                                      <div className="text-emerald-300 font-black text-sm">{stats.nAcc}</div>
                                      <div className="text-[9.5px] opacity-80">{stats.nPctAcc.toFixed(1)}%</div>
                                    </td>
                                    {activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2 && (
                                      <td className="p-2 border border-slate-700 text-center bg-[#78350f]">
                                        <div className="text-amber-300 font-black text-sm">{stats.nPerm}</div>
                                        <div className="text-[9.5px] opacity-80">{stats.nPctPerm.toFixed(1)}%</div>
                                      </td>
                                    )}
                                    <td className="p-2 border border-slate-700 text-center bg-[#881337]">
                                      <div className="text-rose-300 font-black text-sm">{stats.nFail}</div>
                                      <div className="text-[9.5px] opacity-80">{stats.nPctFail.toFixed(1)}%</div>
                                    </td>
                                  </>
                                )}
                                <td className="p-2 border border-slate-700 text-center font-mono text-xs text-slate-300">{formatVal(stats.min)}</td>
                                <td className="p-2 border border-slate-700 text-center font-mono text-xs text-slate-300">{formatVal(stats.max)}</td>
                                <td className="p-2 border border-slate-700 text-center font-black text-indigo-300 font-mono text-xs">{formatVal(stats.avg)}</td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr className="sticky-header">
                    <th className="p-4 font-black text-slate-500 tracking-tighter sticky left-0 bg-slate-50 shadow-[2px_0_5px_rgba(0,0,0,0.05)] z-20">S.No.</th>
                    
                    {reportingLevel !== "State" && (
                      <th className="p-4 font-black text-slate-500 tracking-tighter bg-slate-100">State</th>
                    )}
                    {reportingLevel === "Block" && (
                      <th className="p-4 font-black text-slate-500 tracking-tighter bg-slate-100">District</th>
                    )}
                    
                    <th className="p-4 font-black text-[#1e3a8a] tracking-tighter bg-slate-100 font-bold">
                      {reportingLevel === "State" ? "State Name" : reportingLevel === "District" ? "District Name" : "Block / Tehsil"}
                    </th>
                    
                    <th className="p-4 font-black text-slate-500 tracking-tighter text-center">Total Samples</th>
                    
                    {activeParam === "SAR" ? (
                      <>
                        <th className="p-4 font-black text-emerald-600 tracking-tighter text-center bg-emerald-50/50">
                          ≤10 <br />
                          <span className="text-[10px] opacity-70 font-semibold">(N/%)</span>
                        </th>
                        <th className="p-4 font-black text-amber-600 tracking-tighter text-center bg-amber-50/50">
                          &gt;10–18 <br />
                          <span className="text-[10px] opacity-70 font-semibold">(N/%)</span>
                        </th>
                        <th className="p-4 font-black text-orange-600 tracking-tighter text-center bg-orange-50/50">
                          &gt;18–26 <br />
                          <span className="text-[10px] opacity-70 font-semibold">(N/%)</span>
                        </th>
                        <th className="p-4 font-black text-rose-600 tracking-tighter text-center bg-rose-50/50">
                          &gt;26 <br />
                          <span className="text-[10px] opacity-70 font-semibold">(N/%)</span>
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="p-4 font-black text-emerald-600 tracking-tighter text-center bg-emerald-50/50">
                          {getTableHeaderLabels(activeConfigKey, activeConfig).acc} <br />
                          <span className="text-[10px] opacity-70 font-semibold">(N/%)</span>
                        </th>
                        
                        {activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2 && (
                          <th className="p-4 font-black text-amber-600 tracking-tighter text-center bg-amber-50/50">
                            {getTableHeaderLabels(activeConfigKey, activeConfig).perm} <br />
                            <span className="text-[10px] opacity-70 font-semibold">(N/%)</span>
                          </th>
                        )}

                        <th className="p-4 font-black text-rose-600 tracking-tighter text-center bg-rose-50/50">
                          {getTableHeaderLabels(activeConfigKey, activeConfig).fail} <br />
                          <span className="text-[10px] opacity-70 font-semibold">(N/%)</span>
                        </th>
                      </>
                    )}
                    
                    <th className="p-4 font-black text-slate-500 tracking-tighter text-center border-l border-slate-200">Min</th>
                    <th className="p-4 font-black text-slate-500 tracking-tighter text-center">Max</th>
                    <th className="p-4 font-black text-slate-500 tracking-tighter text-center">75%ile</th>
                    <th className="p-4 font-black text-slate-500 tracking-tighter text-center">90%ile</th>
                    <th className="p-4 font-black text-slate-500 tracking-tighter text-center">95%ile</th>
                    <th className="p-4 font-black text-slate-500 tracking-tighter text-center">Avg</th>
                    <th className="p-4 font-black text-slate-500 tracking-tighter text-center">SD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={7 + (activeParam === "SAR" ? 4 : (activeConfigKey === "pH" ? 2 : (activeConfig.b1 === activeConfig.b2 ? 2 : 3))) + (reportingLevel !== "State" ? 1 : 0) + (reportingLevel === "Block" ? 1 : 0)} className="p-12 text-center text-slate-400 font-bold uppercase tracking-wider">
                        No data uploaded yet. Please upload a spreadsheet to view parameter compliance details.
                      </td>
                    </tr>
                  ) : (
                    tableRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors font-medium text-slate-700">
                        <td className="p-4 sticky left-0 bg-white border-r text-slate-400 font-bold z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">{idx + 1}</td>
                        
                        {reportingLevel !== "State" && (
                          <td className="p-4 text-slate-600">{row.state}</td>
                        )}
                        {reportingLevel === "Block" && (
                          <td className="p-4 text-slate-600">{row.district}</td>
                        )}
                        
                        <td className="p-4 font-bold text-slate-900">{row.name}</td>
                        <td className="p-4 text-center font-bold text-slate-500">{row.total}</td>
                        
                        {activeParam === "SAR" ? (
                          <>
                            <td className="p-4 text-center bg-emerald-50/20">
                              <div className="font-extrabold text-emerald-700">{row.nSarS1 || 0}</div>
                              <div className="text-[9px] font-bold text-emerald-500/80">{(row.nPctSarS1 || 0).toFixed(1)}%</div>
                            </td>
                            <td className="p-4 text-center bg-amber-50/20">
                              <div className="font-extrabold text-amber-700">{row.nSarS2 || 0}</div>
                              <div className="text-[9px] font-bold text-amber-500/80">{(row.nPctSarS2 || 0).toFixed(1)}%</div>
                            </td>
                            <td className="p-4 text-center bg-orange-50/20">
                              <div className="font-extrabold text-orange-700">{row.nSarS3 || 0}</div>
                              <div className="text-[9px] font-bold text-orange-500/80">{(row.nPctSarS3 || 0).toFixed(1)}%</div>
                            </td>
                            <td className="p-4 text-center bg-rose-50/20">
                              <div className="font-extrabold text-rose-700">{row.nSarS4 || 0}</div>
                              <div className="text-[9px] font-bold text-rose-500/80">{(row.nPctSarS4 || 0).toFixed(1)}%</div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="p-4 text-center bg-emerald-50/20">
                              <div className="font-extrabold text-emerald-700">{row.nAcc}</div>
                              <div className="text-[9px] font-bold text-emerald-500/80">{row.nPctAcc.toFixed(1)}%</div>
                            </td>

                            {activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2 && (
                              <td className="p-4 text-center bg-amber-50/20">
                                <div className="font-extrabold text-amber-700">{row.nPerm}</div>
                                <div className="text-[9px] font-bold text-amber-500/80">{row.nPctPerm.toFixed(1)}%</div>
                              </td>
                            )}

                            <td className="p-4 text-center bg-rose-50/20">
                              <div className="font-extrabold text-rose-700">{row.nFail}</div>
                              <div className="text-[9px] font-bold text-rose-500/80">{row.nPctFail.toFixed(1)}%</div>
                            </td>
                          </>
                        )}
                        
                        <td className="p-4 text-center border-l border-slate-100 font-mono text-xs">{row.min.toFixed(2)}</td>
                        <td className="p-4 text-center font-mono text-xs">{row.max.toFixed(2)}</td>
                        <td className="p-4 text-center font-mono text-xs">{row.p75?.toFixed(2) ?? "-"}</td>
                        <td className="p-4 text-center font-mono text-xs">{row.p90?.toFixed(2) ?? "-"}</td>
                        <td className="p-4 text-center font-mono text-xs">{row.p95?.toFixed(2) ?? "-"}</td>
                        <td className="p-4 text-center font-black text-indigo-600 font-mono text-xs">{row.avg.toFixed(2)}</td>
                        <td className="p-4 text-center text-slate-400 font-mono text-xs">{row.std.toFixed(2)}</td>
                      </tr>
                    ))
                  )}

                  {/* Grand total summary row */}
                  {grandTotalRow && (
                    <tr className="bg-slate-900 text-white font-extrabold text-xs">
                      <td className="p-4 bg-slate-900 border-r border-slate-700 text-slate-500 text-center">-</td>
                      {reportingLevel !== "State" && <td className="p-4 bg-slate-900 border-slate-700" />}
                      {reportingLevel === "Block" && <td className="p-4 bg-slate-900 border-slate-700" />}
                      <td className="p-4 bg-slate-900 border-r border-slate-700 text-center tracking-wide pr-5">GRAND TOTAL</td>
                      <td className="p-4 text-center font-extrabold text-slate-300">{grandTotalRow.total}</td>
                      
                      {activeParam === "SAR" ? (
                        <>
                          <td className="p-1 text-center bg-[#064e3b]">
                            <div className="text-emerald-300 font-black text-sm">{grandTotalRow.nSarS1 || 0}</div>
                            <div className="text-[9.5px] opacity-80">{(grandTotalRow.nPctSarS1 || 0).toFixed(1)}%</div>
                          </td>
                          <td className="p-1 text-center bg-[#78350f]">
                            <div className="text-amber-300 font-black text-sm">{grandTotalRow.nSarS2 || 0}</div>
                            <div className="text-[9.5px] opacity-80">{(grandTotalRow.nPctSarS2 || 0).toFixed(1)}%</div>
                          </td>
                          <td className="p-1 text-center bg-[#c2410c]">
                            <div className="text-orange-300 font-black text-sm">{grandTotalRow.nSarS3 || 0}</div>
                            <div className="text-[9.5px] opacity-80">{(grandTotalRow.nPctSarS3 || 0).toFixed(1)}%</div>
                          </td>
                          <td className="p-1 text-center bg-[#881337]">
                            <div className="text-rose-300 font-black text-sm">{grandTotalRow.nSarS4 || 0}</div>
                            <div className="text-[9.5px] opacity-80">{(grandTotalRow.nPctSarS4 || 0).toFixed(1)}%</div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-1 text-center bg-[#064e3b]">
                            <div className="text-emerald-300 font-black text-sm">{grandTotalRow.nAcc}</div>
                            <div className="text-[9.5px] opacity-80">{grandTotalRow.nPctAcc.toFixed(1)}%</div>
                          </td>

                          {activeConfigKey !== "pH" && activeConfig.b1 !== activeConfig.b2 && (
                            <td className="p-1 text-center bg-[#78350f]">
                              <div className="text-amber-300 font-black text-sm">{grandTotalRow.nPerm}</div>
                              <div className="text-[9.5px] opacity-80">{grandTotalRow.nPctPerm.toFixed(1)}%</div>
                            </td>
                          )}

                          <td className="p-1 text-center bg-[#881337]">
                            <div className="text-rose-300 font-black text-sm">{grandTotalRow.nFail}</div>
                            <div className="text-[9.5px] opacity-80">{grandTotalRow.nPctFail.toFixed(1)}%</div>
                          </td>
                        </>
                      )}

                      <td className="p-4 text-center border-l border-slate-700 font-mono text-xs text-slate-300">{grandTotalRow.min.toFixed(2)}</td>
                      <td className="p-4 text-center font-mono text-xs text-slate-300">{grandTotalRow.max.toFixed(2)}</td>
                      <td className="p-4 text-center font-mono text-xs text-slate-300">{grandTotalRow.p75?.toFixed(2) ?? "-"}</td>
                      <td className="p-4 text-center font-mono text-xs text-slate-300">{grandTotalRow.p90?.toFixed(2) ?? "-"}</td>
                      <td className="p-4 text-center font-mono text-xs text-slate-300">{grandTotalRow.p95?.toFixed(2) ?? "-"}</td>
                      <td className="p-4 text-center font-black text-indigo-300 font-mono text-xs">{grandTotalRow.avg.toFixed(2)}</td>
                      <td className="p-4 text-center text-slate-400 font-mono text-xs">{grandTotalRow.std.toFixed(2)}</td>
                    </tr>
                  )}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>

    </div>
  );
}

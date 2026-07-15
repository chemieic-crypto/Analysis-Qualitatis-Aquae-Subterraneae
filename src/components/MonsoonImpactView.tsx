import React, { useState, useEffect, useMemo, useCallback } from "react";
import { DataHeaders } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { 
  TableProperties, 
  FileSpreadsheet, 
  Download, 
  TrendingUp, 
  Calendar, 
  CheckCircle, 
  Database, 
  BookOpen,
  Sliders,
  Filter,
  Activity,
  AlertTriangle,
  Award
} from "lucide-react";
import * as XLSX from "xlsx";

interface MonsoonImpactViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState: string;
  selectedDistrict: string;
}

// --- STATISTICAL HELPERS ---

function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// Approximation for Student's T CDF using Wilson-Hilferty transformation
function studentTCDF(t: number, df: number): number {
  const absT = Math.abs(t);
  if (df <= 0) return 0.5;
  
  if (df > 100) {
    const z = absT * (1 - 1 / (4 * df));
    const p = normalCDF(z);
    return t > 0 ? p : 1 - p;
  }

  const num = absT * (1 - 2 / (9 * df));
  const den = Math.sqrt(1 + absT * absT * (2 / (9 * df)));
  const z = num / den;
  const p = 0.5 + 0.5 * (normalCDF(z) - normalCDF(-z));
  
  return t > 0 ? p : 1 - p;
}

function getCriticalT(df: number, alpha: number): number {
  const z_crit = alpha === 0.01 ? 2.576 : alpha === 0.05 ? 1.960 : 1.645;
  const t_05_map: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042
  };
  const t_01_map: Record<number, number> = {
    1: 63.657, 2: 9.925, 3: 5.841, 4: 4.604, 5: 4.032, 6: 3.707, 7: 3.499, 8: 3.355, 9: 3.250, 10: 3.169,
    11: 3.106, 12: 3.055, 13: 3.012, 14: 2.977, 15: 2.947, 16: 2.921, 17: 2.898, 18: 2.878, 19: 2.861, 20: 2.845,
    21: 2.831, 22: 2.819, 23: 2.807, 24: 2.797, 25: 2.787, 26: 2.779, 27: 2.771, 28: 2.763, 29: 2.756, 30: 2.750
  };
  const t_10_map: Record<number, number> = {
    1: 6.314, 2: 2.920, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895, 8: 1.860, 9: 1.833, 10: 1.812,
    11: 1.796, 12: 1.782, 13: 1.771, 14: 1.761, 15: 1.753, 16: 1.746, 17: 1.740, 18: 1.734, 19: 1.729, 20: 1.725,
    21: 1.721, 22: 1.717, 23: 1.714, 24: 1.711, 25: 1.708, 26: 1.706, 27: 1.703, 28: 1.701, 29: 1.699, 30: 1.697
  };

  if (alpha === 0.05 && t_05_map[df]) return t_05_map[df];
  if (alpha === 0.01 && t_01_map[df]) return t_01_map[df];
  if (alpha === 0.10 && t_10_map[df]) return t_10_map[df];

  return z_crit;
}

function getParamConfig(param: string) {
  if (!param) return { b1: 0, b2: 1000, unit: "mg/L", name: "", keywords: [] };
  const cleanParam = param.trim().toLowerCase();
  
  // 1. Try exact/case-insensitive match
  const exactKey = Object.keys(PARAM_CONFIG).find(
    (k) => k.toLowerCase() === cleanParam
  );
  if (exactKey) {
    return PARAM_CONFIG[exactKey];
  }

  // 2. Try keyword match
  const keywordKey = Object.keys(PARAM_CONFIG).find(
    (k) => PARAM_CONFIG[k].keywords.some(
      (kw) => cleanParam.includes(kw) || kw.includes(cleanParam)
    )
  );
  if (keywordKey) {
    return PARAM_CONFIG[keywordKey];
  }

  // 3. Smart fallbacks for typical parameters
  if (cleanParam.includes("ph")) {
    return { b1: 6.5, b2: 8.5, unit: "", name: "pH Level", keywords: ["ph"] };
  }
  if (cleanParam === "sar" || cleanParam.includes("sodium adsorption")) {
    return { b1: 10, b2: 10, unit: "", name: "Sodium Adsorption Ratio (SAR)", keywords: ["sar"] };
  }
  if (cleanParam === "rsc" || cleanParam.includes("residual sodium")) {
    return { b1: 1.25, b2: 1.25, unit: "meq/L", name: "Residual Sodium Carbonate (RSC)", keywords: ["rsc"] };
  }
  if (cleanParam.includes("fluoride") || cleanParam === "f") {
    return { b1: 1.0, b2: 1.5, unit: "mg/L", name: "Fluoride", keywords: ["f"] };
  }
  if (cleanParam.includes("nitrate") || cleanParam === "no3") {
    return { b1: 45, b2: 45, unit: "mg/L", name: "Nitrate", keywords: ["no3"] };
  }
  if (cleanParam.includes("arsenic") || cleanParam === "as") {
    return { b1: 10, b2: 10, unit: "ppb", name: "Arsenic", keywords: ["as"] };
  }

  // 4. Default fallback configuration so it never fails for ANY parameter!
  return {
    b1: 0,
    b2: 1000, // A safe fallback standard limit
    unit: "mg/L",
    name: param,
    keywords: [cleanParam]
  };
}

function runPairedTTest(pre: number[], post: number[], conf: number) {
  const n = pre.length;
  if (n < 2) return { t: 0, p: 1, tab: 0, meanDiff: 0, df: 0 };
  const diffs = pre.map((v, i) => v - post[i]);
  const meanDiff = diffs.reduce((acc, v) => acc + v, 0) / n;
  
  const sumSqDiff = diffs.reduce((acc, v) => acc + Math.pow(v - meanDiff, 2), 0);
  const stdDiff = Math.sqrt(sumSqDiff / (n - 1));
  const sem = stdDiff / Math.sqrt(n);
  const df = n - 1;
  const tab = getCriticalT(df, 1 - conf);
  
  let t, p;
  if (sem === 0) {
    t = meanDiff === 0 ? 0 : (meanDiff > 0 ? Infinity : -Infinity);
    p = meanDiff === 0 ? 1 : 0;
  } else {
    t = meanDiff / sem;
    p = 2 * (1 - studentTCDF(Math.abs(t), df));
  }
  
  return { t: isFinite(t) ? t : 0, p: isFinite(p) ? p : 1, tab: isFinite(tab) ? tab : 0, meanDiff, df };
}

function runWilcoxon(a: number[], b: number[]) {
  const diffs = a.map((v, i) => v - b[i]).filter(d => d !== 0);
  const n = diffs.length;
  if (n < 5) return { w: 0, p: 1.0, n_eff: n };
  
  interface RankedDiff {
    d: number;
    abs: number;
    rank: number;
  }
  
  const sorted: RankedDiff[] = diffs.map(d => ({ d, abs: Math.abs(d), rank: 0 }));
  sorted.sort((x, y) => x.abs - y.abs);
  let tieSum = 0;
  
  for (let i = 0; i < n; ) {
    let j = i; 
    while (j < n && sorted[j].abs === sorted[i].abs) j++;
    const t = j - i;
    if (t > 1) {
      tieSum += (Math.pow(t, 3) - t);
    }
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) sorted[k].rank = avgRank;
    i = j;
  }
  
  let wPlus = 0; 
  sorted.forEach(o => { if (o.d > 0) wPlus += o.rank; });
  
  const expected = n * (n + 1) / 4;
  const variance = (n * (n + 1) * (2 * n + 1) / 24) - (tieSum / 48);
  const sigma = Math.sqrt(Math.max(variance, 0.0001)); 
  
  let z = 0;
  if (wPlus > expected) {
    z = (wPlus - 0.5 - expected) / sigma;
  } else if (wPlus < expected) {
    z = (wPlus + 0.5 - expected) / sigma;
  }
  
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  
  return { w: wPlus, p: isFinite(p) ? p : 1, n_eff: n };
}

export default function MonsoonImpactView({
  rawData,
  headers,
  headerMap,
  selectedState: globalSelectedState,
  selectedDistrict: globalSelectedDistrict,
}: MonsoonImpactViewProps) {
  
  // --- SUB TAB CONTROL ---
  const [activeTab, setActiveTab] = useState<"general" | "perm" | "contamination" | "stats" | "availability" | "detailed" | "methodology">("general");
  
  // --- PARAMETER SELECTORS ---
  const [basePeriod, setBasePeriod] = useState("");
  const [compPeriod, setCompPeriod] = useState("");
  const [pairingLogic, setPairingLogic] = useState<"well_id" | "location">("well_id");
  const [aggLevel, setAggLevel] = useState<"State" | "District" | "Block">("State");
  const [activeParam, setActiveParam] = useState("");
  const [confidenceLevel, setConfidenceLevel] = useState<number>(0.95);

  // --- LOCAL RECURSIVE FILTERS ---
  const [localState, setLocalState] = useState("All");
  const [localDistrict, setLocalDistrict] = useState("All");
  const [localBlock, setLocalBlock] = useState("All");

  const effectiveAggLevel = useMemo(() => {
    if ((localDistrict && localDistrict !== "All") || globalSelectedDistrict) {
      return "Block";
    }
    return aggLevel;
  }, [aggLevel, localDistrict, globalSelectedDistrict]);

  // Sync active parameter when headers are mapped
  useEffect(() => {
    if (headers.params.length > 0 && !activeParam) {
      setActiveParam(headers.params[0]);
    }
  }, [headers.params, activeParam]);

  // Auto-switch aggregation level when local state filter is selected (District-wise) or cleared (State-wise)
  useEffect(() => {
    if (localState !== "All") {
      setAggLevel("District");
    } else {
      setAggLevel("State");
    }
  }, [localState]);

  // Extract uniquely available periods based on year and season columns
  const allPeriods = useMemo(() => {
    if (!rawData.length) return [];
    const periods = new Set<string>();
    rawData.forEach(row => {
      const y = headers.year ? String(row[headers.year] || "").trim() : "";
      const s = headers.season ? String(row[headers.season] || "").trim() : "";
      if (y && s) {
        periods.add(`${y} | ${s}`);
      } else if (y) {
        periods.add(y);
      } else if (s) {
        periods.add(s);
      }
    });
    return Array.from(periods).sort();
  }, [rawData, headers.year, headers.season]);

  // Pre-guess default Pre/Post monsoon comparisons
  useEffect(() => {
    if (allPeriods.length >= 2) {
      const pre = allPeriods.find(p => p.toLowerCase().includes("pre"));
      const post = allPeriods.find(p => p.toLowerCase().includes("post"));
      if (pre && post) {
        setBasePeriod(pre);
        setCompPeriod(post);
      } else {
        setBasePeriod(allPeriods[0]);
        setCompPeriod(allPeriods[1]);
      }
    } else if (allPeriods.length === 1) {
      setBasePeriod(allPeriods[0]);
      setCompPeriod(allPeriods[0]);
    }
  }, [allPeriods]);

  // --- EXTRACT AVAILABLE LOCATIONS & DYNAMIC FILTERS ---
  const statesList = useMemo(() => {
    if (!rawData.length || !headers.state) return [];
    const s = new Set<string>();
    rawData.forEach(r => {
      const stateVal = r[headers.state || ""];
      if (stateVal) s.add(String(stateVal).trim());
    });
    return Array.from(s).sort();
  }, [rawData, headers.state]);

  const districtsList = useMemo(() => {
    if (!rawData.length || !headers.district) return [];
    const d = new Set<string>();
    rawData.forEach(r => {
      const sVal = r[headers.state || ""] ? String(r[headers.state || ""]).trim() : "";
      const dVal = r[headers.district || ""] ? String(r[headers.district || ""]).trim() : "";
      if (dVal && (localState === "All" || sVal === localState)) {
        d.add(dVal);
      }
    });
    return Array.from(d).sort();
  }, [rawData, headers.district, localState]);

  const blocksList = useMemo(() => {
    if (!rawData.length || !headers.block) return [];
    const b = new Set<string>();
    rawData.forEach(r => {
      const sVal = r[headers.state || ""] ? String(r[headers.state || ""]).trim() : "";
      const dVal = r[headers.district || ""] ? String(r[headers.district || ""]).trim() : "";
      const bVal = r[headers.block || ""] ? String(r[headers.block || ""]).trim() : "";
      if (bVal && 
          (localState === "All" || sVal === localState) &&
          (localDistrict === "All" || dVal === localDistrict)) {
        b.add(bVal);
      }
    });
    return Array.from(b).sort();
  }, [rawData, headers.block, localState, localDistrict]);

  // Reset cascading filters when parent resets
  useEffect(() => {
    setLocalDistrict("All");
    setLocalBlock("All");
  }, [localState]);

  useEffect(() => {
    setLocalBlock("All");
  }, [localDistrict]);

  // --- CORE MATCHING ENGINE ---
  const pairedResult = useMemo(() => {
    if (!rawData.length || !basePeriod || !compPeriod || (!headers.year && !headers.season)) {
      return { uBaseCnt: 0, uCompCnt: 0, pairedList: [], unpairedCnt: 0 };
    }

    // Apply global and local filters
    let filtered = rawData;
    
    // Global Sidebar Filters
    if (globalSelectedState) {
      filtered = filtered.filter(row => String(row[headers.state || ""] || "").trim() === globalSelectedState);
    }
    if (globalSelectedDistrict) {
      filtered = filtered.filter(row => String(row[headers.district || ""] || "").trim() === globalSelectedDistrict);
    }

    // Local Tab Cascading Filters
    if (localState !== "All") {
      filtered = filtered.filter(row => String(row[headers.state || ""] || "").trim() === localState);
    }
    if (localDistrict !== "All") {
      filtered = filtered.filter(row => String(row[headers.district || ""] || "").trim() === localDistrict);
    }
    if (localBlock !== "All") {
      filtered = filtered.filter(row => String(row[headers.block || ""] || "").trim() === localBlock);
    }

    // Sort into Base vs Compare pools
    const baseRecordsMap: Record<string, any> = {};
    const compRecordsMap: Record<string, any> = {};

    let uBaseCnt = 0;
    let uCompCnt = 0;

    filtered.forEach(row => {
      const y = headers.year ? String(row[headers.year] || "").trim() : "";
      const s = headers.season ? String(row[headers.season] || "").trim() : "";
      const period = (y && s) ? `${y} | ${s}` : (y || s);

      // Generate exact matching key
      let key = "";
      if (pairingLogic === "well_id" && headers.wellId && row[headers.wellId]) {
        key = String(row[headers.wellId]).trim().toUpperCase();
      } else {
        const stateVal = String(row[headers.state || "State"] || "").trim();
        const distVal = String(row[headers.district || "District"] || "").trim();
        const blockVal = String(row[headers.block || "Block"] || "").trim();
        const locVal = String(row[headers.location || "Location"] || "").trim();
        key = `${stateVal}|${distVal}|${blockVal}|${locVal}`.toUpperCase();
      }

      if (!key) return;

      if (period === basePeriod) {
        baseRecordsMap[key] = row;
        uBaseCnt++;
      }
      if (period === compPeriod) {
        compRecordsMap[key] = row;
        uCompCnt++;
      }
    });

    const pairedList: any[] = [];
    const keys = new Set([...Object.keys(baseRecordsMap), ...Object.keys(compRecordsMap)]);
    let unpairedCnt = 0;

    keys.forEach(key => {
      const baseRow = baseRecordsMap[key];
      const compRow = compRecordsMap[key];

      if (baseRow && compRow) {
        const state = String(baseRow[headers.state || ""] || "Unknown").trim();
        const district = String(baseRow[headers.district || ""] || "Unknown").trim();
        const block = String(baseRow[headers.block || ""] || "Unknown").trim();
        const loc = String(baseRow[headers.location || ""] || "Unknown").trim();
        const lat = baseRow[headers.latitude || ""] || "";
        const lon = baseRow[headers.longitude || ""] || "";
        const wellId = baseRow[headers.wellId || ""] || "Unknown";

        pairedList.push({
          key,
          wellId,
          state,
          district,
          block,
          location: loc,
          latitude: lat,
          longitude: lon,
          baseRow,
          compRow
        });
      } else {
        unpairedCnt++;
      }
    });

    return { uBaseCnt, uCompCnt, pairedList, unpairedCnt };
  }, [rawData, basePeriod, compPeriod, pairingLogic, headers, globalSelectedState, globalSelectedDistrict, localState, localDistrict, localBlock]);

  // --- HELPER VALUE PARSER ---
  const parseVal = useCallback((row: any, paramName: string) => {
    if (!row) return NaN;
    const mappedHeader = Object.keys(headerMap).find(k => headerMap[k] === paramName) || paramName;
    const valStr = row[mappedHeader] !== undefined ? row[mappedHeader] : row[paramName];
    const val = parseFloat(valStr);
    return isNaN(val) ? NaN : val;
  }, [headerMap]);

  // Get active mapped params (only those mapped in headerMap)
  const availableParams = useMemo(() => {
    const baseParams = Object.keys(headerMap).filter(key => headerMap[key] && rawData.some(row => row[key] !== undefined || row[headerMap[key]] !== undefined));
    const hasCa = !!headerMap["Ca"];
    const hasMg = !!headerMap["Mg"];
    const hasNa = !!headerMap["Na"];
    const hasHco3 = !!headerMap["HCO3"];
    
    const params = [...baseParams];
    if (hasCa && hasMg && hasNa && !params.includes("SAR")) {
      params.push("SAR");
    }
    if (hasCa && hasMg && hasHco3 && !params.includes("RSC")) {
      params.push("RSC");
    }

    // Force SAR or RSC if present in headers.params
    const hasSARInExcel = headers.params.some(p => p.toUpperCase() === "SAR" || p.toLowerCase().includes("sodium adsorption"));
    const hasRSCInExcel = headers.params.some(p => p.toUpperCase() === "RSC" || p.toLowerCase().includes("residual sodium"));
    
    if (hasSARInExcel && !params.includes("SAR")) {
      params.push("SAR");
    }
    if (hasRSCInExcel && !params.includes("RSC")) {
      params.push("RSC");
    }

    return params;
  }, [headerMap, rawData, headers.params]);

  // Robust function to parse parameter value (including SAR and RSC fallback calculation)
  const getParamVal = useCallback((row: any, paramName: string) => {
    if (paramName === "SAR" || paramName === "RSC") {
      // First check if there is an actual Excel column mapped to SAR or RSC
      const excelCol = headerMap[paramName];
      if (excelCol && row[excelCol] !== undefined && row[excelCol] !== null) {
        const parsedVal = parseFloat(row[excelCol]);
        if (!isNaN(parsedVal)) return parsedVal;
      }
      
      // Fallback to dynamic calculation
      const caCol = headerMap["Ca"] || "Ca";
      const mgCol = headerMap["Mg"] || "Mg";
      const naCol = headerMap["Na"] || "Na";
      const hco3Col = headerMap["HCO3"] || "HCO3";
      const co3Col = headerMap["CO3"] || "CO3";
      
      const caVal = parseFloat(row[caCol]);
      const mgVal = parseFloat(row[mgCol]);
      const naVal = parseFloat(row[naCol]);
      const hco3Val = parseFloat(row[hco3Col]);
      const co3Val = parseFloat(row[co3Col]) || 0;

      const caMeq = !isNaN(caVal) ? caVal / 20.04 : 0;
      const mgMeq = !isNaN(mgVal) ? mgVal / 12.15 : 0;
      const naMeq = !isNaN(naVal) ? naVal / 22.99 : 0;
      const hco3Meq = !isNaN(hco3Val) ? hco3Val / 61.02 : 0;
      const co3Meq = co3Val / 30.00;

      if (!isNaN(caVal) && !isNaN(mgVal)) {
        if (paramName === "SAR") {
          if (!isNaN(naVal)) {
            const denom = Math.sqrt((caMeq + mgMeq) / 2);
            return denom > 0 ? naMeq / denom : NaN;
          }
        } else {
          if (!isNaN(hco3Val)) {
            return (hco3Meq + co3Meq) - (caMeq + mgMeq);
          }
        }
      }
      return NaN;
    }
    const excelCol = headerMap[paramName] || paramName;
    return parseFloat(row[excelCol]);
  }, [headerMap]);

  // --- GENERAL SUMMARY STATISTICS (Trend analysis) ---
  const generalSummaryData = useMemo(() => {
    if (!pairedResult.pairedList.length || !activeParam) return [];

    const config = getParamConfig(activeParam);
    const limit = config ? (config.b2 !== null && config.b2 !== undefined ? config.b2 : config.b1) : 1000;

    const statsMap: Record<string, { 
      key: string; 
      name: string; 
      state: string; 
      district: string; 
      analyzed: number; 
      improved: number; 
      deteriorated: number; 
      unchanged: number;
      shiftedSafeToUnsafe: number;
      shiftedUnsafeToSafe: number;
    }> = {};

    pairedResult.pairedList.forEach(loc => {
      // Determine aggregation key
      let key = "";
      let label = "";
      if (effectiveAggLevel === "State") {
        key = loc.state;
        label = loc.state;
      } else if (effectiveAggLevel === "District") {
        key = `${loc.state}|${loc.district}`;
        label = loc.district;
      } else {
        key = `${loc.state}|${loc.district}|${loc.block}`;
        label = loc.block;
      }

      if (!key) return;

      const baseVal = getParamVal(loc.baseRow, activeParam);
      const compVal = getParamVal(loc.compRow, activeParam);

      if (!isNaN(baseVal) && !isNaN(compVal)) {
        if (!statsMap[key]) {
          statsMap[key] = { 
            key, 
            name: label, 
            state: loc.state, 
            district: loc.district, 
            analyzed: 0, 
            improved: 0, 
            deteriorated: 0, 
            unchanged: 0,
            shiftedSafeToUnsafe: 0,
            shiftedUnsafeToSafe: 0
          };
        }

        const dataObj = statsMap[key]!;
        dataObj.analyzed++;

        // No of Location Shifted Safe to Unsafe (base <= limit and comp > limit)
        if (baseVal <= limit && compVal > limit) {
          dataObj.shiftedSafeToUnsafe++;
        }
        // No of Location Shifted Unsafe to Safe (base > limit and comp <= limit)
        if (baseVal > limit && compVal <= limit) {
          dataObj.shiftedUnsafeToSafe++;
        }

        let pct = 0;
        if (baseVal !== 0) {
          pct = ((compVal - baseVal) / Math.abs(baseVal)) * 100;
        } else if (baseVal === 0 && compVal !== 0) {
          pct = compVal > 0 ? 100 : -100;
        }

        if (pct < -20) {
          dataObj.improved++;
        } else if (pct > 20) {
          dataObj.deteriorated++;
        } else {
          dataObj.unchanged++;
        }
      }
    });

    return Object.values(statsMap).sort((a, b) => a.name.localeCompare(b.name));
  }, [pairedResult.pairedList, activeParam, effectiveAggLevel, getParamVal]);

  // Memoized Totals for General Summary Table
  const generalSummaryTotals = useMemo(() => {
    let analyzed = 0;
    let improved = 0;
    let deteriorated = 0;
    let unchanged = 0;
    let shiftedSafeToUnsafe = 0;
    let shiftedUnsafeToSafe = 0;

    generalSummaryData.forEach(row => {
      analyzed += row.analyzed || 0;
      improved += row.improved || 0;
      deteriorated += row.deteriorated || 0;
      unchanged += row.unchanged || 0;
      shiftedSafeToUnsafe += row.shiftedSafeToUnsafe || 0;
      shiftedUnsafeToSafe += row.shiftedUnsafeToSafe || 0;
    });

    return {
      analyzed,
      improved,
      deteriorated,
      unchanged,
      shiftedSafeToUnsafe,
      shiftedUnsafeToSafe
    };
  }, [generalSummaryData]);

  // --- PERMISSIBLE LIMITS TRENDS ---
  const permSummaryData = useMemo(() => {
    if (!pairedResult.pairedList.length || !activeParam) return [];

    const config = getParamConfig(activeParam);
    if (!config || config.b2 === null) return [];

    const limit = config.b2;
    const statsMap: Record<string, { 
      key: string; 
      name: string; 
      state: string;
      district: string;
      analyzed: number; 
      exceedBase: number; 
      improvedButStillExceed: number; 
      improvedAndRemediated: number; 
      totalDeteriorated: number; 
      deterioratedExceed: number; 
      unchangedExceed: number;
      shiftedSafeToUnsafe: number;
      shiftedUnsafeToSafe: number;
    }> = {};

    pairedResult.pairedList.forEach(loc => {
      let key = "";
      let label = "";
      if (effectiveAggLevel === "State") {
        key = loc.state;
        label = loc.state;
      } else if (effectiveAggLevel === "District") {
        key = `${loc.state}|${loc.district}`;
        label = loc.district;
      } else {
        key = `${loc.state}|${loc.district}|${loc.block}`;
        label = loc.block;
      }

      if (!key) return;

      const baseVal = getParamVal(loc.baseRow, activeParam);
      const compVal = getParamVal(loc.compRow, activeParam);

      if (!isNaN(baseVal) && !isNaN(compVal)) {
        if (!statsMap[key]) {
          statsMap[key] = { 
            key, 
            name: label, 
            state: loc.state,
            district: loc.district,
            analyzed: 0, 
            exceedBase: 0, 
            improvedButStillExceed: 0, 
            improvedAndRemediated: 0, 
            totalDeteriorated: 0, 
            deterioratedExceed: 0, 
            unchangedExceed: 0,
            shiftedSafeToUnsafe: 0,
            shiftedUnsafeToSafe: 0
          };
        }

        const dataObj = statsMap[key]!;
        dataObj.analyzed++;

        // Shift calculations
        if (baseVal <= limit && compVal > limit) {
          dataObj.shiftedSafeToUnsafe++;
        }
        if (baseVal > limit && compVal <= limit) {
          dataObj.shiftedUnsafeToSafe++;
        }

        let pct = 0;
        if (baseVal !== 0) {
          pct = ((compVal - baseVal) / Math.abs(baseVal)) * 100;
        }

        const isImproved = pct < -20;
        const isDeteriorated = pct > 20;
        const isUnchanged = !isImproved && !isDeteriorated;

        if (baseVal > limit) {
          dataObj.exceedBase++;
          if (isImproved) {
            if (compVal > limit) {
              dataObj.improvedButStillExceed++;
            } else {
              dataObj.improvedAndRemediated++;
            }
          }
          if (isUnchanged) {
            dataObj.unchangedExceed++;
          }
        }

        if (isDeteriorated) {
          dataObj.totalDeteriorated++;
          if (compVal > limit) {
            dataObj.deterioratedExceed++;
          }
        }
      }
    });

    return Object.values(statsMap).sort((a, b) => a.name.localeCompare(b.name));
  }, [pairedResult.pairedList, activeParam, effectiveAggLevel, getParamVal]);

  // Memoized Totals for Permissible Limits Table
  const permSummaryTotals = useMemo(() => {
    let analyzed = 0;
    let exceedBase = 0;
    let improvedButStillExceed = 0;
    let improvedAndRemediated = 0;
    let totalDeteriorated = 0;
    let deterioratedExceed = 0;
    let unchangedExceed = 0;
    let shiftedSafeToUnsafe = 0;
    let shiftedUnsafeToSafe = 0;

    permSummaryData.forEach(row => {
      analyzed += row.analyzed || 0;
      exceedBase += row.exceedBase || 0;
      improvedButStillExceed += row.improvedButStillExceed || 0;
      improvedAndRemediated += row.improvedAndRemediated || 0;
      totalDeteriorated += row.totalDeteriorated || 0;
      deterioratedExceed += row.deterioratedExceed || 0;
      unchangedExceed += row.unchangedExceed || 0;
      shiftedSafeToUnsafe += row.shiftedSafeToUnsafe || 0;
      shiftedUnsafeToSafe += row.shiftedUnsafeToSafe || 0;
    });

    return {
      analyzed,
      exceedBase,
      improvedButStillExceed,
      improvedAndRemediated,
      totalDeteriorated,
      deterioratedExceed,
      unchangedExceed,
      shiftedSafeToUnsafe,
      shiftedUnsafeToSafe
    };
  }, [permSummaryData]);

  // --- CONTAMINATION SIDE-BY-SIDE REPORT ---
  const contaminationReportData = useMemo(() => {
    if (!pairedResult.pairedList.length) return [];

    const statsMap: Record<string, Record<string, { 
      analyzed: number; 
      baseAbove: number; 
      compAbove: number; 
      newlyContaminated: number; 
      remediated: number; 
    }>> = {};

    pairedResult.pairedList.forEach(loc => {
      let key = "";
      if (effectiveAggLevel === "State") {
        key = loc.state;
      } else if (effectiveAggLevel === "District") {
        key = `${loc.state}|${loc.district}`;
      } else {
        key = `${loc.state}|${loc.district}|${loc.block}`;
      }

      if (!key) return;

      if (!statsMap[key]) {
        statsMap[key] = {};
      }

      availableParams.forEach(p => {
        const config = getParamConfig(p);
        if (!config || config.b2 === null) return;
        const limit = config.b2;

        if (!statsMap[key]![p]) {
          statsMap[key]![p] = { analyzed: 0, baseAbove: 0, compAbove: 0, newlyContaminated: 0, remediated: 0 };
        }

        const bVal = getParamVal(loc.baseRow, p);
        const cVal = getParamVal(loc.compRow, p);

        if (!isNaN(bVal) && !isNaN(cVal)) {
          const stats = statsMap[key]![p]!;
          stats.analyzed++;
          if (bVal > limit) stats.baseAbove++;
          if (cVal > limit) stats.compAbove++;

          if (bVal <= limit && cVal > limit) stats.newlyContaminated++;
          if (bVal > limit && cVal <= limit) stats.remediated++;
        }
      });
    });

    const reportRows: any[] = [];
    Object.keys(statsMap).sort().forEach(geoKey => {
      Object.keys(statsMap[geoKey]!).forEach(p => {
        const stats = statsMap[geoKey]![p]!;
        if (stats.analyzed > 0) {
          reportRows.push({
            geoKey,
            param: p,
            ...stats
          });
        }
      });
    });

    return reportRows;
  }, [pairedResult.pairedList, availableParams, effectiveAggLevel, getParamVal]);

  // --- HYPOTHESIS TESTING SUMMARY ---
  const statisticalTestsData = useMemo(() => {
    if (!pairedResult.pairedList.length) return [];

    const alpha = 1 - confidenceLevel;
    const testResults: any[] = [];

    availableParams.forEach(p => {
      const preVals: number[] = [];
      const postVals: number[] = [];

      pairedResult.pairedList.forEach(loc => {
        const b = getParamVal(loc.baseRow, p);
        const c = getParamVal(loc.compRow, p);
        if (!isNaN(b) && !isNaN(c)) {
          preVals.push(b);
          postVals.push(c);
        }
      });

      if (preVals.length >= 2) {
        const tTest = runPairedTTest(preVals, postVals, confidenceLevel);
        const wilcoxon = runWilcoxon(preVals, postVals);

        testResults.push({
          param: p,
          n: preVals.length,
          meanPre: preVals.reduce((a, b) => a + b, 0) / preVals.length,
          meanPost: postVals.reduce((a, b) => a + b, 0) / postVals.length,
          tTest,
          wilcoxon
        });
      }
    });

    return testResults;
  }, [pairedResult.pairedList, availableParams, confidenceLevel, getParamVal]);

  // --- DATA AVAILABILITY LIST ---
  const dataAvailabilityData = useMemo(() => {
    if (!rawData.length || !headers.year || !headers.season) return {};

    const stats: Record<string, { total: number; baseValid: number; compValid: number; pairedValid: number }> = {};

    availableParams.forEach(p => {
      stats[p] = { total: 0, baseValid: 0, compValid: 0, pairedValid: 0 };
    });

    // We process the filtered records
    const locMap: Record<string, { baseRow: any; compRow: any }> = {};

    // Apply global and local filters
    let filtered = rawData;
    if (globalSelectedState) {
      filtered = filtered.filter(row => String(row[headers.state || ""] || "").trim() === globalSelectedState);
    }
    if (globalSelectedDistrict) {
      filtered = filtered.filter(row => String(row[headers.district || ""] || "").trim() === globalSelectedDistrict);
    }
    if (localState !== "All") {
      filtered = filtered.filter(row => String(row[headers.state || ""] || "").trim() === localState);
    }
    if (localDistrict !== "All") {
      filtered = filtered.filter(row => String(row[headers.district || ""] || "").trim() === localDistrict);
    }
    if (localBlock !== "All") {
      filtered = filtered.filter(row => String(row[headers.block || ""] || "").trim() === localBlock);
    }

    filtered.forEach(row => {
      const y = headers.year ? String(row[headers.year] || "").trim() : "";
      const s = headers.season ? String(row[headers.season] || "").trim() : "";
      const period = (y && s) ? `${y} | ${s}` : (y || s);

      let key = "";
      if (pairingLogic === "well_id" && headers.wellId && row[headers.wellId]) {
        key = String(row[headers.wellId]).trim().toUpperCase();
      } else {
        const stateVal = String(row[headers.state || "State"] || "").trim();
        const distVal = String(row[headers.district || "District"] || "").trim();
        const blockVal = String(row[headers.block || "Block"] || "").trim();
        const locVal = String(row[headers.location || "Location"] || "").trim();
        key = `${stateVal}|${distVal}|${blockVal}|${locVal}`.toUpperCase();
      }

      if (!key) return;

      if (!locMap[key]) {
        locMap[key] = { baseRow: null, compRow: null };
      }

      if (period === basePeriod) locMap[key].baseRow = row;
      if (period === compPeriod) locMap[key].compRow = row;
    });

    Object.values(locMap).forEach(loc => {
      availableParams.forEach(p => {
        const hasBase = loc.baseRow && !isNaN(getParamVal(loc.baseRow, p));
        const hasComp = loc.compRow && !isNaN(getParamVal(loc.compRow, p));

        if (hasBase || hasComp) {
          stats[p]!.total++;
          if (hasBase) stats[p]!.baseValid++;
          if (hasComp) stats[p]!.compValid++;
          if (hasBase && hasComp) stats[p]!.pairedValid++;
        }
      });
    });

    return stats;
  }, [rawData, basePeriod, compPeriod, pairingLogic, headers, availableParams, globalSelectedState, globalSelectedDistrict, localState, localDistrict, localBlock, getParamVal]);

  // --- DETAILED MATRIX DISPLAY ---
  const detailedMatrixData = useMemo(() => {
    if (!pairedResult.pairedList.length) return [];

    return pairedResult.pairedList.map((loc, index) => {
      const chemData: Record<string, { base: number; comp: number; pctChange: number; status: "Improved" | "Deteriorated" | "No Significant Change" | "N/A" }> = {};

      availableParams.forEach(p => {
        const base = getParamVal(loc.baseRow, p);
        const comp = getParamVal(loc.compRow, p);

        if (!isNaN(base) && !isNaN(comp)) {
          let pct = 0;
          if (base !== 0) {
            pct = ((comp - base) / Math.abs(base)) * 100;
          } else if (base === 0 && comp !== 0) {
            pct = comp > 0 ? 100 : -100;
          }

          let status: "Improved" | "Deteriorated" | "No Significant Change" = "No Significant Change";
          if (pct < -20) status = "Improved";
          else if (pct > 20) status = "Deteriorated";

          chemData[p] = { base, comp, pctChange: pct, status };
        } else {
          chemData[p] = { base: NaN, comp: NaN, pctChange: NaN, status: "N/A" };
        }
      });

      return {
        id: index + 1,
        wellId: loc.wellId,
        state: loc.state,
        district: loc.district,
        block: loc.block,
        location: loc.location,
        chemData
      };
    });
  }, [pairedResult.pairedList, availableParams, getParamVal]);

  // --- MATH EXPLANATION SAMPLE DRAFT ---
  const liveExplanationSample = useMemo(() => {
    if (!detailedMatrixData.length || !activeParam) return null;
    
    // Find the first sample that has valid numeric values for the active parameter
    const validSample = detailedMatrixData.find(s => s.chemData[activeParam] && s.chemData[activeParam].status !== "N/A");
    if (!validSample) return null;

    const data = validSample.chemData[activeParam]!;
    return {
      id: validSample.wellId,
      location: validSample.location,
      district: validSample.district,
      base: data.base,
      comp: data.comp,
      pct: data.pctChange,
      status: data.status
    };
  }, [detailedMatrixData, activeParam]);

  // --- SINGLE TAB EXPORT EXCEL ---
  const handleExportActiveTab = () => {
    if (!pairedResult.pairedList.length) return;

    const wb = XLSX.utils.book_new();

    if (activeTab === "general") {
      const dataToExport = generalSummaryData.map((d, index) => ({
        "S.No.": index + 1,
        "Name": d.name,
        "Samples Analyzed": d.analyzed,
        "Improved (Count)": d.improved,
        "Improved (%)": d.analyzed > 0 ? ((d.improved / d.analyzed) * 100).toFixed(2) + "%" : "0.00%",
        "Deteriorated (Count)": d.deteriorated,
        "Deteriorated (%)": d.analyzed > 0 ? ((d.deteriorated / d.analyzed) * 100).toFixed(2) + "%" : "0.00%",
        "No Significant Change (Count)": d.unchanged,
        "No Significant Change (%)": d.analyzed > 0 ? ((d.unchanged / d.analyzed) * 100).toFixed(2) + "%" : "0.00%",
        "Shifted Safe to Unsafe": d.shiftedSafeToUnsafe,
        "Shifted Unsafe to Safe": d.shiftedUnsafeToSafe
      }));
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      XLSX.utils.book_append_sheet(wb, ws, "General Summary");
    } 
    else if (activeTab === "perm") {
      const dataToExport = permSummaryData.map((d, index) => ({
        "S.No.": index + 1,
        "Name": d.name,
        "Analyzed": d.analyzed,
        "Exceeded in Base": d.exceedBase,
        "Improved but Still Exceed": d.improvedButStillExceed,
        "Improved & Now Remediated": d.improvedAndRemediated,
        "Total Deteriorated": d.totalDeteriorated,
        "Deteriorated & Exceeding": d.deterioratedExceed,
        "Unchanged & Exceeding": d.unchangedExceed
      }));
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      XLSX.utils.book_append_sheet(wb, ws, "Permissible Limits");
    }
    else if (activeTab === "contamination") {
      const dataToExport = contaminationReportData.map((d, index) => ({
        "S.No.": index + 1,
        "Region Key": d.geoKey,
        "Parameter": d.param,
        "Valid Paired Samples": d.analyzed,
        "Base Above Limit": d.baseAbove,
        "Base Above (%)": ((d.baseAbove / d.analyzed) * 100).toFixed(2) + "%",
        "Compare Above Limit": d.compAbove,
        "Compare Above (%)": ((d.compAbove / d.analyzed) * 100).toFixed(2) + "%",
        "Newly Contaminated": d.newlyContaminated,
        "Newly Contaminated (%)": ((d.newlyContaminated / d.analyzed) * 100).toFixed(2) + "%",
        "Remediated / Cleaned": d.remediated,
        "Remediated (%)": ((d.remediated / d.analyzed) * 100).toFixed(2) + "%"
      }));
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      XLSX.utils.book_append_sheet(wb, ws, "Contamination Report");
    }
    else if (activeTab === "stats") {
      const dataToExport = statisticalTestsData.map((s, index) => ({
        "Parameter": s.param,
        "Valid Pairs (n)": s.n,
        "Mean Base": parseFloat(s.meanPre.toFixed(2)),
        "Mean Compare": parseFloat(s.meanPost.toFixed(2)),
        "T-Test DF": s.tTest.df,
        "T-Test Mean Diff": parseFloat(s.tTest.meanDiff.toFixed(3)),
        "T-Test T-Calc": parseFloat(s.tTest.t.toFixed(3)),
        "T-Test T-Crit": parseFloat(s.tTest.tab.toFixed(3)),
        "T-Test P-Value": parseFloat(s.tTest.p.toFixed(4)),
        "Wilcoxon W-Stat": parseFloat(s.wilcoxon.w.toFixed(1)),
        "Wilcoxon P-Value": parseFloat(s.wilcoxon.p.toFixed(4))
      }));
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      XLSX.utils.book_append_sheet(wb, ws, "Hypothesis Testing");
    }
    else if (activeTab === "availability") {
      const dataToExport = Object.entries(dataAvailabilityData as Record<string, any>).map(([p, s], index) => ({
        "S.No.": index + 1,
        "Parameter": p,
        "Total Locations": s.total,
        "Valid Base Records": s.baseValid,
        "Valid Compare Records": s.compValid,
        "Valid Paired Records": s.pairedValid
      }));
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      XLSX.utils.book_append_sheet(wb, ws, "Data Availability");
    }
    else if (activeTab === "detailed") {
      const dataToExport = detailedMatrixData.map(d => {
        const rowObj: any = {
          "Sl.": d.id,
          "Well ID": d.wellId,
          "State": d.state,
          "District": d.district,
          "Block": d.block,
          "Location": d.location
        };

        availableParams.forEach(p => {
          const val = d.chemData[p]!;
          rowObj[`${p} Base`] = isNaN(val.base) ? "--" : val.base;
          rowObj[`${p} Compare`] = isNaN(val.comp) ? "--" : val.comp;
          rowObj[`${p} % Change`] = isNaN(val.pctChange) ? "--" : val.pctChange.toFixed(2) + "%";
          rowObj[`${p} Status`] = val.status;
        });

        return rowObj;
      });
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      XLSX.utils.book_append_sheet(wb, ws, "Detailed Matrix");
    }

    XLSX.writeFile(wb, `Monsoon_Impact_${activeTab}_${Date.now()}.xlsx`);
  };

  // --- MULTI-TAB MASTER REPORT EXPORT ---
  const handleExportAllParameters = () => {
    if (!pairedResult.pairedList.length) return;

    const wb = XLSX.utils.book_new();

    // 1. General Summary Matrix
    const generalRows = generalSummaryData.map((d, index) => ({
      "S.No.": index + 1,
      "Name": d.name,
      "Analyzed Samples": d.analyzed,
      "Improved": d.improved,
      "Improved (%)": d.analyzed > 0 ? ((d.improved / d.analyzed) * 100).toFixed(1) + "%" : "0.0%",
      "Deteriorated": d.deteriorated,
      "Deteriorated (%)": d.analyzed > 0 ? ((d.deteriorated / d.analyzed) * 100).toFixed(1) + "%" : "0.0%",
      "Unchanged": d.unchanged,
      "Unchanged (%)": d.analyzed > 0 ? ((d.unchanged / d.analyzed) * 100).toFixed(1) + "%" : "0.0%",
      "Shifted Safe to Unsafe": d.shiftedSafeToUnsafe,
      "Shifted Unsafe to Safe": d.shiftedUnsafeToSafe
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(generalRows), "General Summary");

    // 2. Contamination Report
    const contRows = contaminationReportData.map((d, index) => ({
      "S.No.": index + 1,
      "Region": d.geoKey,
      "Parameter": d.param,
      "Paired Samples": d.analyzed,
      "Base Exceedance": d.baseAbove,
      "Base Exceedance (%)": ((d.baseAbove / d.analyzed) * 100).toFixed(1) + "%",
      "Compare Exceedance": d.compAbove,
      "Compare Exceedance (%)": ((d.compAbove / d.analyzed) * 100).toFixed(1) + "%",
      "Newly Contaminated": d.newlyContaminated,
      "Newly Contaminated (%)": ((d.newlyContaminated / d.analyzed) * 100).toFixed(1) + "%",
      "Remediated / Cleaned": d.remediated,
      "Remediated (%)": ((d.remediated / d.analyzed) * 100).toFixed(1) + "%"
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contRows), "Contamination Report");

    // 3. Statistical Testing
    const statRows = statisticalTestsData.map((s) => ({
      "Parameter": s.param,
      "Valid Pairs (n)": s.n,
      "Mean Base": parseFloat(s.meanPre.toFixed(2)),
      "Mean Compare": parseFloat(s.meanPost.toFixed(2)),
      "T-Test DF": s.tTest.df,
      "T-Test Mean Diff": parseFloat(s.tTest.meanDiff.toFixed(3)),
      "T-Test T-Calc": parseFloat(s.tTest.t.toFixed(3)),
      "T-Test T-Crit": parseFloat(s.tTest.tab.toFixed(3)),
      "T-Test P-Value": parseFloat(s.tTest.p.toFixed(4)),
      "Wilcoxon W-Stat": parseFloat(s.wilcoxon.w.toFixed(1)),
      "Wilcoxon P-Value": parseFloat(s.wilcoxon.p.toFixed(4))
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statRows), "Statistical Tests");

    // 4. Detailed Base Matrix
    const detailedRows = detailedMatrixData.map(d => {
      const rowObj: any = {
        "Sl.": d.id,
        "Well ID": d.wellId,
        "State": d.state,
        "District": d.district,
        "Block": d.block,
        "Location": d.location
      };
      availableParams.forEach(p => {
        const val = d.chemData[p]!;
        rowObj[`${p} Base`] = isNaN(val.base) ? "--" : val.base;
        rowObj[`${p} Compare`] = isNaN(val.comp) ? "--" : val.comp;
        rowObj[`${p} % Change`] = isNaN(val.pctChange) ? "--" : val.pctChange.toFixed(2) + "%";
        rowObj[`${p} Status`] = val.status;
      });
      return rowObj;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailedRows), "Detailed Matrix");

    XLSX.writeFile(wb, `GWQ_Complete_Monsoon_Report_${Date.now()}.xlsx`);
  };

  // Check if year or season columns have been mapped successfully
  const isPeriodMappingMissing = !headers.year && !headers.season;

  if (isPeriodMappingMissing) {
    return (
      <div className="glossy-panel p-8 rounded-3xl text-center space-y-4">
        <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto animate-bounce" />
        <h3 className="text-xl font-bold text-slate-800">Season or Year Column Required</h3>
        <p className="text-sm text-slate-500 max-w-lg mx-auto font-bold leading-relaxed">
          Please upload your Excel spreadsheet and configure either the <strong className="text-emerald-600">Year</strong> or <strong className="text-emerald-600">Season</strong> column dropdown mapping in the <strong className="text-slate-800">"Map Excel Columns"</strong> panel to activate the high-precision seasonal monsoon calculations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* --- DASHBOARD HEAD CONTROL CONTROLS PANEL --- */}
      <section className="glossy-panel p-6 relative rounded-3xl border-t-4 border-blue-600 shadow-xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-5 border-b border-slate-200 pb-4 gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <Sliders className="w-5 h-5 text-indigo-600" />
              Dynamic Impact of Monsoon Configurations
            </h2>
            <p className="text-xs font-bold text-slate-500 mt-1">
              Select seasonal boundaries, pairing engines, and geographical boundaries to evaluate water quality shift
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          
          {/* Base Period selector */}
          <div className="flex flex-col gap-1.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-inner">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Base Period</label>
            <select
              value={basePeriod}
              onChange={(e) => setBasePeriod(e.target.value)}
              className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer"
            >
              {allPeriods.map((p, idx) => (
                <option key={idx} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Compare Period selector */}
          <div className="flex flex-col gap-1.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-inner">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Compare Period</label>
            <select
              value={compPeriod}
              onChange={(e) => setCompPeriod(e.target.value)}
              className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer"
            >
              {allPeriods.map((p, idx) => (
                <option key={idx} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Pairing Logic select */}
          <div className="flex flex-col gap-1.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-inner">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Pairing Logic</label>
            <select
              value={pairingLogic}
              onChange={(e) => setPairingLogic(e.target.value as any)}
              className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer"
            >
              <option value="well_id">Match by Well ID (Unique Well Identification)</option>
              <option value="location">Match by Location (State + District + Block + Location)</option>
            </select>
          </div>

          {/* Aggregation Level select */}
          <div className="flex flex-col gap-1.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-inner">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Aggregation Level</label>
            <select
              value={aggLevel}
              onChange={(e) => setAggLevel(e.target.value as any)}
              className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer"
            >
              <option value="State">State-wise</option>
              <option value="District">District-wise</option>
              <option value="Block">Block-wise</option>
            </select>
          </div>

          {/* Parameter select */}
          <div className="flex flex-col gap-1.5 bg-white p-2.5 rounded-xl border border-emerald-300 shadow-inner">
            <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest block mb-0.5">Active Parameter</label>
            <select
              value={activeParam}
              onChange={(e) => setActiveParam(e.target.value)}
              className="w-full text-xs p-2 rounded-lg bg-emerald-50 border border-emerald-400 font-black text-emerald-800 cursor-pointer"
            >
              {availableParams.map((p, idx) => (
                <option key={idx} value={p}>{p} ({getParamConfig(p)?.name || p})</option>
              ))}
            </select>
          </div>

        </div>

        {/* Dynamic Cascading Filter Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-200">
          
          {/* Local State Filter */}
          <div className="flex flex-col gap-1 bg-white p-2.5 rounded-xl border border-slate-200 shadow-inner">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-blue-500" /> State Filter
            </label>
            <select
              value={localState}
              onChange={(e) => setLocalState(e.target.value)}
              className="w-full text-xs p-1.5 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer"
            >
              <option value="All">All States</option>
              {statesList.map((s, idx) => (
                <option key={idx} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Local District Filter */}
          <div className="flex flex-col gap-1 bg-white p-2.5 rounded-xl border border-slate-200 shadow-inner">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-blue-500" /> District Filter
            </label>
            <select
              value={localDistrict}
              onChange={(e) => setLocalDistrict(e.target.value)}
              className="w-full text-xs p-1.5 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer"
              disabled={localState === "All"}
            >
              <option value="All">All Districts</option>
              {districtsList.map((d, idx) => (
                <option key={idx} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Local Block Filter */}
          <div className="flex flex-col gap-1 bg-white p-2.5 rounded-xl border border-slate-200 shadow-inner">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-blue-500" /> Block Filter
            </label>
            <select
              value={localBlock}
              onChange={(e) => setLocalBlock(e.target.value)}
              className="w-full text-xs p-1.5 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer"
              disabled={localDistrict === "All"}
            >
              <option value="All">All Blocks</option>
              {blocksList.map((b, idx) => (
                <option key={idx} value={b}>{b}</option>
              ))}
            </select>
          </div>

        </div>
      </section>

      {/* --- DASHBOARD METRICS kpi PANEL --- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Base Records Count */}
        <div className="glossy-panel p-4 rounded-2xl flex flex-col justify-center border-l-4 border-amber-500">
          <span className="text-[10px] text-amber-600 font-black uppercase tracking-widest mb-1">Base Period Samples</span>
          <h4 className="text-3xl font-black text-slate-900 font-mono">{pairedResult.uBaseCnt}</h4>
          <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{basePeriod}</span>
        </div>

        {/* Compare Records Count */}
        <div className="glossy-panel p-4 rounded-2xl flex flex-col justify-center border-l-4 border-blue-500">
          <span className="text-[10px] text-blue-600 font-black uppercase tracking-widest mb-1">Compare Period Samples</span>
          <h4 className="text-3xl font-black text-slate-900 font-mono">{pairedResult.uCompCnt}</h4>
          <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{compPeriod}</span>
        </div>

        {/* Matched Locations Count */}
        <div className="glossy-panel p-4 rounded-2xl flex flex-col justify-center border-l-4 border-emerald-500 bg-emerald-50/10">
          <span className="text-[10px] text-emerald-600 font-black uppercase tracking-widest mb-1">Matched Locations</span>
          <h4 className="text-3xl font-black text-emerald-600 font-mono">{pairedResult.pairedList.length}</h4>
          <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">Perfect Pairs Linked</span>
        </div>

        {/* Excluded/Unpaired Count */}
        <div className="glossy-panel p-4 rounded-2xl flex flex-col justify-center border-l-4 border-rose-500 bg-rose-50/10">
          <span className="text-[10px] text-rose-600 font-black uppercase tracking-widest mb-1">Unpaired / Excluded</span>
          <h4 className="text-3xl font-black text-rose-600 font-mono">{pairedResult.unpairedCnt}</h4>
          <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">Missing Matching period</span>
        </div>

      </div>

      {/* --- DASHBOARD SUB TABS STAGE --- */}
      <section className="glossy-panel overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg">
        
        {/* Navigation Toolbar */}
        <div className="flex flex-col xl:flex-row justify-between items-stretch xl:items-center p-5 border-b border-slate-200 bg-slate-50/75 gap-4">
          <div className="flex flex-wrap gap-x-3 gap-y-3 select-none">
            {[
              { id: "general", label: "General Summary", icon: TrendingUp, color: "blue" },
              { id: "perm", label: "Permissible Limits", icon: AlertTriangle, color: "rose" },
              { id: "contamination", label: "Contamination Report", icon: Award, color: "amber" },
              { id: "stats", label: "Hypothesis Testing", icon: Activity, color: "indigo" },
              { id: "availability", label: "Data Availability", icon: Database, color: "emerald" },
              { id: "detailed", label: "Detailed Matrix", icon: TableProperties, color: "slate" },
              { id: "methodology", label: "Methodology", icon: BookOpen, color: "purple" },
            ].map((tabItem) => {
              const IconComponent = tabItem.icon;
              const isActive = activeTab === tabItem.id;

              const styleMap: Record<string, { bg: string; activeBg: string; text: string; shadow: string; hoverBg: string; activeShadow: string; ring: string }> = {
                blue: {
                  bg: "bg-gradient-to-r from-blue-500 to-blue-600",
                  activeBg: "bg-blue-700",
                  text: "text-white",
                  shadow: "shadow-[0_4px_0_0_#1d4ed8]",
                  activeShadow: "shadow-[0_1px_0_0_#172554]",
                  hoverBg: "hover:from-blue-600 hover:to-blue-700",
                  ring: "ring-blue-300",
                },
                rose: {
                  bg: "bg-gradient-to-r from-rose-500 to-rose-600",
                  activeBg: "bg-rose-700",
                  text: "text-white",
                  shadow: "shadow-[0_4px_0_0_#be184d]",
                  activeShadow: "shadow-[0_1px_0_0_#4c0519]",
                  hoverBg: "hover:from-rose-600 hover:to-rose-700",
                  ring: "ring-rose-300",
                },
                amber: {
                  bg: "bg-gradient-to-r from-amber-500 to-amber-600",
                  activeBg: "bg-amber-700",
                  text: "text-white",
                  shadow: "shadow-[0_4px_0_0_#b45309]",
                  activeShadow: "shadow-[0_1px_0_0_#451a03]",
                  hoverBg: "hover:from-amber-600 hover:to-amber-700",
                  ring: "ring-amber-300",
                },
                indigo: {
                  bg: "bg-gradient-to-r from-indigo-500 to-indigo-600",
                  activeBg: "bg-indigo-700",
                  text: "text-white",
                  shadow: "shadow-[0_4px_0_0_#4338ca]",
                  activeShadow: "shadow-[0_1px_0_0_#1e1b4b]",
                  hoverBg: "hover:from-indigo-600 hover:to-indigo-700",
                  ring: "ring-indigo-300",
                },
                emerald: {
                  bg: "bg-gradient-to-r from-emerald-500 to-emerald-600",
                  activeBg: "bg-emerald-700",
                  text: "text-white",
                  shadow: "shadow-[0_4px_0_0_#047857]",
                  activeShadow: "shadow-[0_1px_0_0_#022c22]",
                  hoverBg: "hover:from-emerald-600 hover:to-emerald-700",
                  ring: "ring-emerald-300",
                },
                slate: {
                  bg: "bg-gradient-to-r from-slate-500 to-slate-600",
                  activeBg: "bg-slate-700",
                  text: "text-white",
                  shadow: "shadow-[0_4px_0_0_#475569]",
                  activeShadow: "shadow-[0_1px_0_0_#0f172a]",
                  hoverBg: "hover:from-slate-600 hover:to-slate-700",
                  ring: "ring-slate-300",
                },
                purple: {
                  bg: "bg-gradient-to-r from-purple-500 to-purple-600",
                  activeBg: "bg-purple-700",
                  text: "text-white",
                  shadow: "shadow-[0_4px_0_0_#7c3aed]",
                  activeShadow: "shadow-[0_1px_0_0_#2e1065]",
                  hoverBg: "hover:from-purple-600 hover:to-purple-700",
                  ring: "ring-purple-300",
                },
              };

              const style = styleMap[tabItem.color] || styleMap.blue;

              return (
                <button
                  key={tabItem.id}
                  onClick={() => setActiveTab(tabItem.id as any)}
                  className={`
                    whitespace-nowrap px-4 py-2 rounded-xl font-black text-[11px] uppercase tracking-wide flex items-center gap-2 select-none transition-all duration-150 cursor-pointer border border-white/10
                    ${isActive 
                      ? `${style.activeBg} ${style.text} ${style.activeShadow} translate-y-[3px] ring-2 ${style.ring} ring-offset-2 shadow-inner` 
                      : `${style.bg} ${style.text} ${style.shadow} hover:translate-y-[-1px] active:translate-y-[2px] active:shadow-none ${style.hoverBg}`
                    }
                  `}
                >
                  <IconComponent className={`w-3.5 h-3.5 ${isActive ? "scale-110" : "opacity-90"}`} />
                  {tabItem.label}
                </button>
              );
            })}
          </div>

          {/* Excel Export Action elements */}
          <div className="flex gap-2.5 items-center justify-end shrink-0">
            <button
              onClick={handleExportActiveTab}
              disabled={!pairedResult.pairedList.length}
              className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-2 whitespace-nowrap shadow hover:shadow-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileSpreadsheet className="w-4 h-4" /> Export Active Tab
            </button>

            <button
              onClick={handleExportAllParameters}
              disabled={!pairedResult.pairedList.length}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-black text-xs flex items-center justify-center gap-2 whitespace-nowrap shadow-lg hover:shadow-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed animate-pulse"
              title="Compile and Export unified sheet report"
            >
              <Download className="w-4 h-4" /> Export Combined Parameters
            </button>
          </div>
        </div>

        {/* --- Tab Panel 1: General Summary --- */}
        {activeTab === "general" && (
          <div className="p-4 space-y-4">
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl flex items-start gap-3">
              <Calendar className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-xs text-blue-800 leading-relaxed font-bold">
                Evaluating groundwater trend shift for <strong className="text-blue-900">{getParamConfig(activeParam)?.name || activeParam} ({activeParam})</strong>. 
                Locations are classified as <strong className="text-emerald-700">Improved</strong> (&gt;20% decrease), <strong className="text-rose-700">Deteriorated</strong> (&gt;20% increase), or <strong className="text-slate-700">No Significant Change</strong> relative to the Base Period (<strong className="text-blue-900">{basePeriod}</strong>) compared to the Compare Period (<strong className="text-blue-900">{compPeriod}</strong>).
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-inner">
              <table className="w-full border-collapse text-left text-xs bg-white">
                <thead className="bg-slate-100 text-slate-700 font-black uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="p-3 text-center">S.No.</th>
                    {effectiveAggLevel === "Block" && (
                      <>
                        <th className="p-3">State</th>
                        <th className="p-3">District</th>
                        <th className="p-3">Block Name</th>
                      </>
                    )}
                    {effectiveAggLevel === "District" && (
                      <>
                        <th className="p-3">State</th>
                        <th className="p-3">District Name</th>
                      </>
                    )}
                    {effectiveAggLevel === "State" && (
                      <th className="p-3">State/District</th>
                    )}
                    <th className="p-3 text-center">No. of Samples (Common Locations)</th>
                    <th className="p-3 text-center bg-emerald-50/50 text-emerald-800">Improved (No.)</th>
                    <th className="p-3 text-center bg-emerald-50 text-emerald-800">Improved (%)</th>
                    <th className="p-3 text-center bg-rose-50/50 text-rose-800">Deteriorated (No.)</th>
                    <th className="p-3 text-center bg-rose-50 text-rose-800">Deteriorated (%)</th>
                    <th className="p-3 text-center bg-slate-50 text-slate-800">No Significant Change (No.)</th>
                    <th className="p-3 text-center bg-slate-100 text-slate-800">No Significant Change (%)</th>
                    <th className="p-3 text-center bg-rose-100/50 text-rose-950">Shifted Safe to Unsafe</th>
                    <th className="p-3 text-center bg-emerald-100/50 text-emerald-950">Shifted Unsafe to Safe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                  {generalSummaryData.length === 0 ? (
                    <tr>
                      <td colSpan={effectiveAggLevel === "Block" ? 13 : effectiveAggLevel === "District" ? 12 : 11} className="p-12 text-center text-slate-400 font-extrabold uppercase">
                        No paired records found matching the configured filters.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {generalSummaryData.map((row, idx) => (
                        <tr key={row.key} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-center text-slate-400">{idx + 1}</td>
                          {effectiveAggLevel === "Block" && (
                            <>
                              <td className="p-3 text-slate-600">{row.state}</td>
                              <td className="p-3 text-slate-600">{row.district}</td>
                              <td className="p-3 text-blue-600 font-black">{row.name}</td>
                            </>
                          )}
                          {effectiveAggLevel === "District" && (
                            <>
                              <td className="p-3 text-slate-600">{row.state}</td>
                              <td className="p-3 text-blue-600 font-black">{row.name}</td>
                            </>
                          )}
                          {effectiveAggLevel === "State" && (
                            <td className="p-3 text-blue-600 font-black">{row.name}</td>
                          )}
                          <td className="p-3 text-center font-mono">{row.analyzed}</td>
                          <td className="p-3 text-center font-mono text-emerald-600 bg-emerald-50/10">{row.improved}</td>
                          <td className="p-3 text-center font-mono text-emerald-700 bg-emerald-50/20">
                            {row.analyzed > 0 ? ((row.improved / row.analyzed) * 100).toFixed(1) + "%" : "0.0%"}
                          </td>
                          <td className="p-3 text-center font-mono text-rose-600 bg-rose-50/10">{row.deteriorated}</td>
                          <td className="p-3 text-center font-mono text-rose-700 bg-rose-50/20">
                            {row.analyzed > 0 ? ((row.deteriorated / row.analyzed) * 100).toFixed(1) + "%" : "0.0%"}
                          </td>
                          <td className="p-3 text-center font-mono text-slate-600 bg-slate-50">{row.unchanged}</td>
                          <td className="p-3 text-center font-mono text-slate-700 bg-slate-100">
                            {row.analyzed > 0 ? ((row.unchanged / row.analyzed) * 100).toFixed(1) + "%" : "0.0%"}
                          </td>
                          <td className="p-3 text-center font-mono text-rose-700 bg-rose-50/40">{row.shiftedSafeToUnsafe}</td>
                          <td className="p-3 text-center font-mono text-emerald-700 bg-emerald-50/40">{row.shiftedUnsafeToSafe}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-100 font-extrabold text-slate-950 border-t-2 border-slate-300">
                        <td className="p-3 text-center font-black">Total</td>
                        {effectiveAggLevel === "Block" && (
                          <>
                            <td className="p-3"></td>
                            <td className="p-3"></td>
                            <td className="p-3"></td>
                          </>
                        )}
                        {effectiveAggLevel === "District" && (
                          <>
                            <td className="p-3"></td>
                            <td className="p-3"></td>
                          </>
                        )}
                        {effectiveAggLevel === "State" && (
                          <td className="p-3"></td>
                        )}
                        <td className="p-3 text-center font-mono font-black">{generalSummaryTotals.analyzed}</td>
                        <td className="p-3 text-center font-mono text-emerald-800">{generalSummaryTotals.improved}</td>
                        <td className="p-3 text-center font-mono text-emerald-900">
                          {generalSummaryTotals.analyzed > 0 ? ((generalSummaryTotals.improved / generalSummaryTotals.analyzed) * 100).toFixed(1) + "%" : "0.0%"}
                        </td>
                        <td className="p-3 text-center font-mono text-rose-800">{generalSummaryTotals.deteriorated}</td>
                        <td className="p-3 text-center font-mono text-rose-900">
                          {generalSummaryTotals.analyzed > 0 ? ((generalSummaryTotals.deteriorated / generalSummaryTotals.analyzed) * 100).toFixed(1) + "%" : "0.0%"}
                        </td>
                        <td className="p-3 text-center font-mono text-slate-700">{generalSummaryTotals.unchanged}</td>
                        <td className="p-3 text-center font-mono text-slate-800">
                          {generalSummaryTotals.analyzed > 0 ? ((generalSummaryTotals.unchanged / generalSummaryTotals.analyzed) * 100).toFixed(1) + "%" : "0.0%"}
                        </td>
                        <td className="p-3 text-center font-mono text-rose-900 bg-rose-100/30">{generalSummaryTotals.shiftedSafeToUnsafe}</td>
                        <td className="p-3 text-center font-mono text-emerald-900 bg-emerald-100/30">{generalSummaryTotals.shiftedUnsafeToSafe}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {/* Dynamic Interpretation Text block */}
            {generalSummaryTotals.analyzed > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mt-4 text-xs font-bold text-slate-700 leading-relaxed space-y-2">
                <span className="text-slate-900 font-extrabold flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-1">
                  <BookOpen className="w-4 h-4 text-blue-600" /> Hydrochemical Shift Interpretation
                </span>
                <p>
                  Out of the <span className="text-blue-600 font-extrabold">{generalSummaryTotals.analyzed}</span> monitoring locations analyzed for <span className="text-blue-700 font-black">{getParamConfig(activeParam)?.name || activeParam}</span>, a total of <span className="text-rose-600 font-extrabold">{generalSummaryTotals.shiftedSafeToUnsafe}</span> location(s) ({generalSummaryTotals.analyzed > 0 ? ((generalSummaryTotals.shiftedSafeToUnsafe / generalSummaryTotals.analyzed) * 100).toFixed(1) : 0}%) shifted from a Safe state to an Unsafe state exceeding standard limit thresholds due to post-monsoon sub-surface leaching. 
                  Conversely, <span className="text-emerald-600 font-extrabold">{generalSummaryTotals.shiftedUnsafeToSafe}</span> location(s) ({generalSummaryTotals.analyzed > 0 ? ((generalSummaryTotals.shiftedUnsafeToSafe / generalSummaryTotals.analyzed) * 100).toFixed(1) : 0}%) shifted from an Unsafe status to a Safe status because fresh monsoonal rainwater recharge diluted the chemical concentration levels. 
                  This active seasonal transition illustrates how monsoon precipitation serves both as a recharge catalyst and as a natural purification agent across regional aquifers.
                </p>
                <p className="text-[10px] text-slate-500 font-medium italic">
                  *Interpretation threshold configured at {getParamConfig(activeParam)?.b2} {getParamConfig(activeParam)?.unit || ""} for Safe vs. Unsafe limits. Significant trend variations (&gt;20%) were detected at {(generalSummaryTotals.improved + generalSummaryTotals.deteriorated)} locations.
                </p>
              </div>
            )}
          </div>
        )}

        {/* --- Tab Panel 2: Permissible Limits --- */}
        {activeTab === "perm" && (
          <div className="p-4 space-y-4">
            <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-800 leading-relaxed font-bold">
                Evaluating compliance boundaries of <strong className="text-rose-900">{getParamConfig(activeParam)?.name || activeParam}</strong>. 
                Permissible Limit threshold configured: <strong className="text-rose-950">{getParamConfig(activeParam)?.b2} {getParamConfig(activeParam)?.unit}</strong>.
                Tracks whether already exceeding wells deteriorated further, or successfully remediated below limits post-monsoon.
              </div>
            </div>

            {getParamConfig(activeParam)?.b2 === null ? (
              <div className="glossy-panel p-10 rounded-2xl text-center space-y-2 border border-dashed border-rose-200 bg-rose-50/10">
                <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
                <h4 className="text-sm font-bold text-slate-800">No Limit Defined</h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto font-bold">
                  There is no permissible limit standard set for {activeParam} in the local hydrochemical dictionary.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-inner">
                <table className="w-full border-collapse text-left text-xs bg-white">
                  <thead className="bg-slate-100 text-slate-700 font-black uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="p-3 text-center">S.No.</th>
                      {effectiveAggLevel === "Block" && (
                        <>
                          <th className="p-3">State</th>
                          <th className="p-3">District</th>
                          <th className="p-3">Block Name</th>
                        </>
                      )}
                      {effectiveAggLevel === "District" && (
                        <>
                          <th className="p-3">State</th>
                          <th className="p-3">District Name</th>
                        </>
                      )}
                      {effectiveAggLevel === "State" && (
                        <th className="p-3">State Name</th>
                      )}
                      <th className="p-3 text-center">Analyzed Samples</th>
                      <th className="p-3 text-center bg-rose-100/50 text-rose-900">Base Exceedance</th>
                      <th className="p-3 text-center bg-amber-50 text-amber-900">Improved but Still Exceed</th>
                      <th className="p-3 text-center bg-emerald-50 text-emerald-900">Improved & Now Remediated</th>
                      <th className="p-3 text-center bg-rose-50 text-rose-800">Total Deteriorated</th>
                      <th className="p-3 text-center bg-rose-900/10 text-rose-950">Deteriorated & Exceeding</th>
                      <th className="p-3 text-center bg-slate-50 text-slate-800">Unchanged & Exceeding</th>
                      <th className="p-3 text-center bg-rose-100 text-rose-950">Shifted Safe to Unsafe</th>
                      <th className="p-3 text-center bg-emerald-100 text-emerald-950">Shifted Unsafe to Safe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                    {permSummaryData.length === 0 ? (
                      <tr>
                        <td colSpan={effectiveAggLevel === "Block" ? 13 : effectiveAggLevel === "District" ? 12 : 11} className="p-12 text-center text-slate-400 font-extrabold uppercase">
                          No exceeding wells mapped or filters excluded matching records.
                        </td>
                      </tr>
                    ) : (
                      <>
                        {permSummaryData.map((row, idx) => (
                          <tr key={row.key} className="hover:bg-slate-50 transition-colors">
                            <td className="p-3 text-center text-slate-400">{idx + 1}</td>
                            {effectiveAggLevel === "Block" && (
                              <>
                                <td className="p-3 text-slate-600">{row.state}</td>
                                <td className="p-3 text-slate-600">{row.district}</td>
                                <td className="p-3 text-blue-600 font-black">{row.name}</td>
                              </>
                            )}
                            {effectiveAggLevel === "District" && (
                              <>
                                <td className="p-3 text-slate-600">{row.state}</td>
                                <td className="p-3 text-blue-600 font-black">{row.name}</td>
                              </>
                            )}
                            {effectiveAggLevel === "State" && (
                              <td className="p-3 text-blue-600 font-black">{row.name}</td>
                            )}
                            <td className="p-3 text-center font-mono">{row.analyzed}</td>
                            <td className="p-3 text-center font-mono text-rose-800 bg-rose-100/10">{row.exceedBase}</td>
                            <td className="p-3 text-center font-mono text-amber-700 bg-amber-50/10">{row.improvedButStillExceed}</td>
                            <td className="p-3 text-center font-mono text-emerald-700 bg-emerald-50/20">{row.improvedAndRemediated}</td>
                            <td className="p-3 text-center font-mono text-rose-600 bg-rose-50/10">{row.totalDeteriorated}</td>
                            <td className="p-3 text-center font-mono text-rose-950 bg-rose-900/5">{row.deterioratedExceed}</td>
                            <td className="p-3 text-center font-mono text-slate-600 bg-slate-50">{row.unchangedExceed}</td>
                            <td className="p-3 text-center font-mono text-rose-700 bg-rose-50/40">{row.shiftedSafeToUnsafe}</td>
                            <td className="p-3 text-center font-mono text-emerald-700 bg-emerald-50/40">{row.shiftedUnsafeToSafe}</td>
                          </tr>
                        ))}
                        <tr className="bg-slate-100 font-extrabold text-slate-950 border-t-2 border-slate-300">
                          <td className="p-3 text-center font-black">Total</td>
                          {effectiveAggLevel === "Block" && (
                            <>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                            </>
                          )}
                          {effectiveAggLevel === "District" && (
                            <>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                            </>
                          )}
                          {effectiveAggLevel === "State" && (
                            <td className="p-3"></td>
                          )}
                          <td className="p-3 text-center font-mono font-black">{permSummaryTotals.analyzed}</td>
                          <td className="p-3 text-center font-mono text-rose-800 bg-rose-100/20">{permSummaryTotals.exceedBase}</td>
                          <td className="p-3 text-center font-mono text-amber-800 bg-amber-50/20">{permSummaryTotals.improvedButStillExceed}</td>
                          <td className="p-3 text-center font-mono text-emerald-850 bg-emerald-50/30">{permSummaryTotals.improvedAndRemediated}</td>
                          <td className="p-3 text-center font-mono text-rose-700 bg-rose-50/20">{permSummaryTotals.totalDeteriorated}</td>
                          <td className="p-3 text-center font-mono text-rose-950 bg-rose-900/10">{permSummaryTotals.deterioratedExceed}</td>
                          <td className="p-3 text-center font-mono text-slate-800 bg-slate-100/50">{permSummaryTotals.unchangedExceed}</td>
                          <td className="p-3 text-center font-mono text-rose-900 bg-rose-100/30">{permSummaryTotals.shiftedSafeToUnsafe}</td>
                          <td className="p-3 text-center font-mono text-emerald-900 bg-emerald-100/30">{permSummaryTotals.shiftedUnsafeToSafe}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {permSummaryTotals.analyzed > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mt-4 text-xs font-bold text-slate-700 leading-relaxed space-y-2">
                <span className="text-rose-900 font-extrabold flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-1">
                  <BookOpen className="w-4 h-4 text-rose-600" /> Permissible Limits Transition Analysis
                </span>
                <p>
                  Out of the <span className="text-blue-600 font-extrabold">{permSummaryTotals.analyzed}</span> monitoring locations, a total of <span className="text-rose-600 font-extrabold">{permSummaryTotals.shiftedSafeToUnsafe}</span> wells ({permSummaryTotals.analyzed > 0 ? ((permSummaryTotals.shiftedSafeToUnsafe / permSummaryTotals.analyzed) * 100).toFixed(1) : 0}%) shifted from a Safe state to an Unsafe/exceeding state post-monsoon due to localized geochemical mineral dissolving. 
                  In contrast, <span className="text-emerald-600 font-extrabold">{permSummaryTotals.shiftedUnsafeToSafe}</span> locations ({permSummaryTotals.analyzed > 0 ? ((permSummaryTotals.shiftedUnsafeToSafe / permSummaryTotals.analyzed) * 100).toFixed(1) : 0}%) transitioned from Unsafe to Safe as fresh monsoonal water successfully diluted the aquifer. 
                  These critical shifts highlight where seasonal recharging either remediates water quality through dilution or mobilizes sub-surface contaminants into groundwater bodies.
                </p>
                <p className="text-[10px] text-slate-500 font-medium italic">
                  *Compliance standard based on Indian Standards (IS 10500) or selected global guidelines, with threshold for {getParamConfig(activeParam)?.name || activeParam} configured at {getParamConfig(activeParam)?.b2} {getParamConfig(activeParam)?.unit || ""}.
                </p>
              </div>
            )}
          </div>
        )}

        {/* --- Tab Panel 3: Contamination Side-by-Side Report --- */}
        {activeTab === "contamination" && (
          <div className="p-4 space-y-4">
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
              <Award className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 leading-relaxed font-bold">
                Evaluating side-by-side seasonal contamination indicators across <strong className="text-amber-900">all parameters</strong>.
                Highlights newly contaminated locations (remediated/acceptable in base period, exceeding limits in post-monsoon) 
                versus remediated/cleaned locations (exceeding in base period, acceptable/cleaned in post-monsoon).
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-inner max-h-[500px] overflow-y-auto custom-scrollbar">
              <table className="w-full border-collapse text-left text-xs bg-white">
                <thead className="bg-slate-100 text-slate-700 font-black uppercase text-[10px] tracking-wider border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="p-3 text-center bg-slate-100">S.No.</th>
                    {effectiveAggLevel === "Block" && (
                      <>
                        <th className="p-3 bg-slate-100">State</th>
                        <th className="p-3 bg-slate-100">District</th>
                        <th className="p-3 bg-slate-100">Block Name</th>
                      </>
                    )}
                    {effectiveAggLevel === "District" && (
                      <>
                        <th className="p-3 bg-slate-100">State</th>
                        <th className="p-3 bg-slate-100">District Name</th>
                      </>
                    )}
                    {effectiveAggLevel === "State" && (
                      <th className="p-3 bg-slate-100">State Name</th>
                    )}
                    <th className="p-3 bg-slate-100">Parameter</th>
                    <th className="p-3 text-center bg-slate-100">Paired Samples</th>
                    <th className="p-3 text-center bg-rose-50 text-rose-900">Base Exceedance (N)</th>
                    <th className="p-3 text-center bg-rose-50 text-rose-900">Base Exceedance (%)</th>
                    <th className="p-3 text-center bg-rose-100 text-rose-950">Compare Exceedance (N)</th>
                    <th className="p-3 text-center bg-rose-100 text-rose-950">Compare Exceedance (%)</th>
                    <th className="p-3 text-center bg-rose-200/50 text-rose-900">Shifted Safe to Unsafe (Count)</th>
                    <th className="p-3 text-center bg-rose-200/50 text-rose-900">Shifted Safe to Unsafe (%)</th>
                    <th className="p-3 text-center bg-emerald-50 text-emerald-900">Shifted Unsafe to Safe (Count)</th>
                    <th className="p-3 text-center bg-emerald-50 text-emerald-900">Shifted Unsafe to Safe (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                  {contaminationReportData.length === 0 ? (
                    <tr>
                      <td colSpan={effectiveAggLevel === "Block" ? 14 : effectiveAggLevel === "District" ? 13 : 12} className="p-12 text-center text-slate-400 font-extrabold uppercase">
                        No paired records mapped with configured limits.
                      </td>
                    </tr>
                  ) : (
                    contaminationReportData.map((row, idx) => {
                      const limit = getParamConfig(row.param)?.b2 || 0;
                      const parts = row.geoKey.split("|");
                      const stateName = parts[0] || "";
                      const districtName = parts[1] || "";
                      const blockName = parts[2] || parts[1] || parts[0] || "";
                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-center text-slate-400">{idx + 1}</td>
                          {effectiveAggLevel === "Block" && (
                            <>
                              <td className="p-3 text-slate-600 truncate max-w-[120px]" title={stateName}>{stateName}</td>
                              <td className="p-3 text-slate-600 truncate max-w-[120px]" title={districtName}>{districtName}</td>
                              <td className="p-3 text-blue-600 font-black truncate max-w-[120px]" title={blockName}>{blockName}</td>
                            </>
                          )}
                          {effectiveAggLevel === "District" && (
                            <>
                              <td className="p-3 text-slate-600 truncate max-w-[120px]" title={stateName}>{stateName}</td>
                              <td className="p-3 text-blue-600 font-black truncate max-w-[120px]" title={districtName}>{districtName}</td>
                            </>
                          )}
                          {effectiveAggLevel === "State" && (
                            <td className="p-3 text-blue-600 font-black truncate max-w-[150px]" title={stateName}>{stateName}</td>
                          )}
                          <td className="p-3 text-slate-900 font-extrabold">{row.param} <span className="text-[9px] text-slate-400 font-normal">(&gt;{limit})</span></td>
                          <td className="p-3 text-center font-mono">{row.analyzed}</td>
                          <td className="p-3 text-center font-mono text-rose-600 bg-rose-50/5">{row.baseAbove}</td>
                          <td className="p-3 text-center font-mono text-rose-700 bg-rose-50/10">
                            {((row.baseAbove / row.analyzed) * 100).toFixed(1)}%
                          </td>
                          <td className="p-3 text-center font-mono text-rose-700 bg-rose-100/5">{row.compAbove}</td>
                          <td className="p-3 text-center font-mono text-rose-800 bg-rose-100/10">
                            {((row.compAbove / row.analyzed) * 100).toFixed(1)}%
                          </td>
                          <td className="p-3 text-center font-mono text-rose-700 bg-rose-200/10">{row.newlyContaminated}</td>
                          <td className="p-3 text-center font-mono text-rose-800 bg-rose-200/20">
                            {((row.newlyContaminated / row.analyzed) * 100).toFixed(1)}%
                          </td>
                          <td className="p-3 text-center font-mono text-emerald-600 bg-emerald-50/10">{row.remediated}</td>
                          <td className="p-3 text-center font-mono text-emerald-700 bg-emerald-50/20">
                            {((row.remediated / row.analyzed) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {contaminationReportData.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mt-4 text-xs font-bold text-slate-700 leading-relaxed space-y-2">
                <span className="text-amber-900 font-extrabold flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-1">
                  <BookOpen className="w-4 h-4 text-amber-600" /> Multi-Parameter Contamination Trend Summary
                </span>
                <p>
                  Across the multi-parameter groundwater quality assessment, we observe a clear seasonal transition of locations shifting between safe and contaminated states.
                  A significant portion of the monitoring wells shifted from Safe to Unsafe, experiencing post-monsoon leaching which mobilizes sub-surface chemical salts.
                  Conversely, multiple locations successfully shifted from Unsafe to Safe as fresh monsoonal rainwater recharge provided excellent dilution of localized chemical parameters.
                  This comparison proves that the monsoon acts as a double-edged sword, causing chemical leaching and run-off in some aquifers while restoring safe drinking water standards through dilution in others.
                </p>
              </div>
            )}
          </div>
        )}

        {/* --- Tab Panel 4: Hypothesis Testing (Stats) --- */}
        {activeTab === "stats" && (
          <div className="p-4 space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-50 border border-slate-200 p-4 rounded-2xl gap-4">
              <div className="flex items-start gap-3">
                <Activity className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div className="text-xs text-indigo-800 leading-relaxed font-bold">
                  Evaluating statistical significance of seasonal shifts using parametric <strong className="text-indigo-900">Student's Paired T-Test</strong> 
                  and non-parametric <strong className="text-indigo-900">Wilcoxon Signed-Rank Test</strong>.
                  Proves mathematically whether monsoon recharge significantly altered water quality or if shifts are random noise.
                </div>
              </div>
              
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold shrink-0 shadow-inner">
                <span className="text-slate-500 uppercase tracking-wider text-[10px]">Confidence:</span>
                <select
                  value={confidenceLevel}
                  onChange={(e) => setConfidenceLevel(parseFloat(e.target.value))}
                  className="bg-transparent border-0 font-bold text-slate-800 focus:ring-0 outline-none p-0 cursor-pointer text-xs"
                >
                  <option value={0.90}>90% (α=0.10)</option>
                  <option value={0.95}>95% (α=0.05)</option>
                  <option value={0.99}>99% (α=0.01)</option>
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-inner">
              <table className="w-full border-collapse text-left text-xs bg-white">
                <thead className="bg-slate-100 text-slate-700 font-black uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="p-3 bg-slate-100" rowSpan={2}>Parameter</th>
                    <th className="p-3 text-center bg-slate-100" rowSpan={2}>Valid Pairs (n)</th>
                    <th className="p-3 text-center bg-slate-100" colSpan={2}>Mean Concentration</th>
                    <th className="p-3 text-center bg-indigo-50 text-indigo-900" colSpan={6}>Student's Paired T-Test</th>
                    <th className="p-3 text-center bg-emerald-50 text-emerald-900" colSpan={3}>Wilcoxon Signed-Rank Test</th>
                  </tr>
                  <tr>
                    <th className="p-2 text-center">Base</th>
                    <th className="p-2 text-center">Compare</th>
                    
                    <th className="p-2 text-center bg-indigo-50/50 text-indigo-800">DF</th>
                    <th className="p-2 text-center bg-indigo-50/50 text-indigo-800">Mean Diff</th>
                    <th className="p-2 text-center bg-indigo-50/50 text-indigo-800">T-Calc</th>
                    <th className="p-2 text-center bg-indigo-50/50 text-indigo-800">T-Crit</th>
                    <th className="p-2 text-center bg-indigo-50/50 text-indigo-800">P-Value</th>
                    <th className="p-2 text-center bg-indigo-50/50 text-indigo-800">Significant?</th>
                    
                    <th className="p-2 text-center bg-emerald-50/50 text-emerald-800">W-Stat</th>
                    <th className="p-2 text-center bg-emerald-50/50 text-emerald-800">P-Value</th>
                    <th className="p-2 text-center bg-emerald-50/50 text-emerald-800">Significant?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                  {statisticalTestsData.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="p-12 text-center text-slate-400 font-extrabold uppercase">
                        Insufficient paired records (need at least 2 matching wells with valid chemical values) to run hypothesis testing.
                      </td>
                    </tr>
                  ) : (
                    statisticalTestsData.map((row, idx) => {
                      const alpha = 1 - confidenceLevel;
                      const tSig = row.tTest.p < alpha;
                      const wSig = row.wilcoxon.p < alpha;
                      const expectedW = (row.wilcoxon.n_eff * (row.wilcoxon.n_eff + 1)) / 4;

                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-blue-600 font-black">{row.param}</td>
                          <td className="p-3 text-center font-mono">{row.n}</td>
                          <td className="p-3 text-center font-mono text-amber-600">{row.meanPre.toFixed(2)}</td>
                          <td className="p-3 text-center font-mono text-blue-600">{row.meanPost.toFixed(2)}</td>
                          
                          <td className="p-3 text-center font-mono bg-indigo-50/10 text-slate-600">{row.tTest.df}</td>
                          <td className="p-3 text-center font-mono bg-indigo-50/10 text-slate-700">{row.tTest.meanDiff.toFixed(3)}</td>
                          <td className="p-3 text-center font-mono bg-indigo-50/10 text-indigo-600">{row.tTest.t.toFixed(3)}</td>
                          <td className="p-3 text-center font-mono bg-indigo-50/10 text-slate-500">{row.tTest.tab.toFixed(3)}</td>
                          <td className="p-3 text-center font-mono bg-indigo-50/10 text-indigo-700 font-black">{row.tTest.p.toFixed(4)}</td>
                          <td className="p-3 text-center bg-indigo-50/20">
                            {tSig ? (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase text-white ${
                                row.meanPre > row.meanPost ? "bg-emerald-600" : "bg-rose-600"
                              }`}>
                                YES ({row.meanPre > row.meanPost ? "Improved" : "Deteriorated"})
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-400 border border-slate-200">
                                NO
                              </span>
                            )}
                          </td>

                          <td className="p-3 text-center font-mono bg-emerald-50/10 text-emerald-600">{row.wilcoxon.w.toFixed(1)}</td>
                          <td className="p-3 text-center font-mono bg-emerald-50/10 text-emerald-700 font-black">{row.wilcoxon.p.toFixed(4)}</td>
                          <td className="p-3 text-center bg-emerald-50/20">
                            {wSig ? (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase text-white ${
                                row.wilcoxon.w > expectedW ? "bg-emerald-600" : "bg-rose-600"
                              }`}>
                                YES ({row.wilcoxon.w > expectedW ? "Improved" : "Deteriorated"})
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-400 border border-slate-200">
                                NO
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- Tab Panel 5: Data Availability --- */}
        {activeTab === "availability" && (
          <div className="p-4 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex items-start gap-3">
              <Database className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-800 leading-relaxed font-bold">
                Evaluating database completeness and pairing ratios for each physical parameter.
                Tracks number of valid numeric measurements available in both the Base period (<strong className="text-emerald-900">{basePeriod}</strong>) 
                and Compare period (<strong className="text-emerald-900">{compPeriod}</strong>) to identify spatial data gaps.
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-inner">
              <table className="w-full border-collapse text-left text-xs bg-white">
                <thead className="bg-slate-100 text-slate-700 font-black uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="p-3 text-center">S.No.</th>
                    <th className="p-3">Parameter</th>
                    <th className="p-3 text-center">Total Monitored Locations</th>
                    <th className="p-3 text-center text-amber-600">Valid Base Records</th>
                    <th className="p-3 text-center text-blue-600">Valid Compare Records</th>
                    <th className="p-3 text-center text-emerald-600">Successfully Paired Locations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                  {Object.keys(dataAvailabilityData).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-slate-400 font-extrabold uppercase">
                        Awaiting data loading to display parameter completeness logs.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(dataAvailabilityData as Record<string, any>).map(([p, s], idx) => (
                      <tr key={p} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 text-center text-slate-400">{idx + 1}</td>
                        <td className="p-3 text-blue-600 font-black">{p} ({getParamConfig(p)?.name || p})</td>
                        <td className="p-3 text-center font-mono">{s.total}</td>
                        <td className="p-3 text-center font-mono text-amber-600">{s.baseValid}</td>
                        <td className="p-3 text-center font-mono text-blue-600">{s.compValid}</td>
                        <td className="p-3 text-center font-mono text-emerald-600 bg-emerald-50/10 font-extrabold">{s.pairedValid}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- Tab Panel 6: Detailed Matrix --- */}
        {activeTab === "detailed" && (
          <div className="p-4 space-y-4">
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex items-start gap-3">
              <TableProperties className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-800 leading-relaxed font-bold">
                Detailed location-by-location hydrochemical matrix. Tracks each well's unique measurements,
                exact percentage change, and corresponding monsoon impact status across all parameters.
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-inner max-h-[500px] overflow-y-auto custom-scrollbar relative">
              <table className="w-full border-collapse text-left text-xs bg-white whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-700 font-black uppercase text-[10px] tracking-wider border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="p-3 text-center bg-slate-100" rowSpan={2}>Sl.</th>
                    <th className="p-3 bg-slate-100" rowSpan={2}>Well ID</th>
                    <th className="p-3 bg-slate-100" rowSpan={2}>State</th>
                    <th className="p-3 bg-slate-100" rowSpan={2}>District</th>
                    <th className="p-3 bg-slate-100" rowSpan={2}>Block</th>
                    <th className="p-3 bg-slate-100" rowSpan={2}>Location</th>
                    {availableParams.map((p) => (
                      <th key={p} className="p-3 text-center bg-slate-200 border-l border-slate-300" colSpan={4}>
                        {p} ({getParamConfig(p)?.unit || ""})
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-slate-50">
                    {availableParams.flatMap((p) => [
                      <th key={`${p}-base`} className="p-2 text-center border-l border-slate-300 text-[9px]">Base</th>,
                      <th key={`${p}-comp`} className="p-2 text-center text-[9px]">Comp</th>,
                      <th key={`${p}-pct`} className="p-2 text-center text-[9px] font-black text-indigo-800">% Change</th>,
                      <th key={`${p}-status`} className="p-2 text-center text-[9px]">Status</th>
                    ])}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                  {detailedMatrixData.length === 0 ? (
                    <tr>
                      <td colSpan={6 + availableParams.length * 4} className="p-12 text-center text-slate-400 font-extrabold uppercase">
                        No paired locations found to trace.
                      </td>
                    </tr>
                  ) : (
                    detailedMatrixData.slice(0, 500).map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 text-center text-slate-400">{row.id}</td>
                        <td className="p-3 text-blue-600 font-black truncate max-w-[120px]" title={row.wellId}>{row.wellId}</td>
                        <td className="p-3 truncate max-w-[100px]" title={row.state}>{row.state}</td>
                        <td className="p-3 truncate max-w-[120px]" title={row.district}>{row.district}</td>
                        <td className="p-3 truncate max-w-[120px]" title={row.block}>{row.block}</td>
                        <td className="p-3 truncate max-w-[120px]" title={row.location}>{row.location}</td>
                        {availableParams.flatMap((p) => {
                          const val = row.chemData[p]!;
                          if (val.status === "N/A") {
                            return [
                              <td key={`${p}-b`} className="p-3 text-center text-slate-300 border-l border-slate-100 font-mono">--</td>,
                              <td key={`${p}-c`} className="p-3 text-center text-slate-300 font-mono">--</td>,
                              <td key={`${p}-p`} className="p-3 text-center text-slate-300 font-mono">--</td>,
                              <td key={`${p}-s`} className="p-3 text-center border-r border-slate-100">
                                <span className="px-1.5 py-0.5 rounded text-[8px] bg-slate-50 text-slate-300 font-black border border-slate-100">N/A</span>
                              </td>
                            ];
                          }

                          let badgeColor = "bg-slate-100 text-slate-400 border border-slate-200";
                          if (val.status === "Improved") badgeColor = "bg-emerald-600 text-white shadow-sm";
                          else if (val.status === "Deteriorated") badgeColor = "bg-rose-600 text-white shadow-sm";

                          return [
                            <td key={`${p}-b`} className="p-3 text-center font-mono text-slate-600 border-l border-slate-250 bg-slate-50/20">{val.base}</td>,
                            <td key={`${p}-c`} className="p-3 text-center font-mono text-slate-700 bg-slate-50/20">{val.comp}</td>,
                            <td key={`${p}-p`} className={`p-3 text-center font-mono text-xs font-extrabold ${
                              val.pctChange < -20 ? "text-emerald-600" : val.pctChange > 20 ? "text-rose-600" : "text-slate-500"
                            }`}>
                              {(val.pctChange > 0 ? "+" : "") + val.pctChange.toFixed(1)}%
                            </td>,
                            <td key={`${p}-s`} className="p-3 text-center border-r border-slate-250">
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${badgeColor}`}>
                                {val.status === "No Significant Change" ? "Unchanged" : val.status}
                              </span>
                            </td>
                          ];
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {detailedMatrixData.length > 500 && (
                <div className="bg-indigo-50 text-indigo-700 text-center font-bold text-xs p-3 border-t border-indigo-100">
                  Displaying the first 500 rows for performance optimization. Download "Export Active Tab" to fetch all {detailedMatrixData.length} records.
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- Tab Panel 7: Methodology --- */}
        {activeTab === "methodology" && (
          <div className="p-6 space-y-6">
            <h3 className="text-xl font-black text-blue-900 border-b border-slate-200 pb-2">
              Theoretical Foundation & Mathematical Formulations
            </h3>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-slate-600 text-xs leading-relaxed font-bold">
              
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  1. Seasonal Trend Threshold Logic
                </h4>
                <p>
                  Seasonal fluctuations in groundwater concentration occur primarily due to rainwater recharge and dissolution of minerals. 
                  The comparison engine evaluates paired wells and computes the precise percentage change:
                </p>
                <div className="bg-white p-3 rounded-xl border border-slate-200 font-mono text-sm text-center font-black text-indigo-700">
                  % Change = ((Value_Compare - Value_Base) / |Value_Base|) * 100
                </div>
                <ul className="list-disc pl-4 space-y-1 text-slate-500">
                  <li><strong className="text-emerald-700">Improved</strong>: Concentration decreased by &gt; 20% post-monsoon (recharge dilution).</li>
                  <li><strong className="text-rose-700">Deteriorated</strong>: Concentration increased by &gt; 20% (dissolution/surface flushing).</li>
                  <li><strong className="text-slate-700">Unchanged</strong>: Drift remained within &plusmn; 20% boundary.</li>
                </ul>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-indigo-600" />
                  2. Student's Paired T-Test
                </h4>
                <p>
                  Used to evaluate whether the mean of the differences of paired samples is significantly different from zero, assuming normal distribution:
                </p>
                <div className="bg-white p-3 rounded-xl border border-slate-200 font-mono text-sm text-center font-black text-indigo-700">
                  t = d̄ / (s_d / √n)
                </div>
                <p className="text-[10px] text-slate-500 font-normal">
                  Where <span className="font-bold font-mono">d̄</span> is the mean difference, <span className="font-bold font-mono">s_d</span> is the standard deviation of differences, and <span className="font-bold font-mono">n</span> is the number of valid pairs.
                  Hypothesis rejected if <span className="font-bold">P-Value &lt; α</span>.
                </p>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-purple-600" />
                  3. Wilcoxon Signed-Rank Test
                </h4>
                <p>
                  A non-parametric alternative to the paired t-test. Does not assume normality, making it extremely resilient against skewed hydrochemical trace outliers:
                </p>
                <div className="bg-white p-3 rounded-xl border border-slate-200 font-mono text-sm text-center font-black text-indigo-700">
                  W = ∑ R_i * sign(d_i)
                </div>
                <p className="text-[10px] text-slate-500 font-normal">
                  Ranks are assigned based on absolute values of non-zero differences. Standardized Z-score is estimated using tie-corrected variance and evaluated against the standard Gaussian CDF to calculate the asymptotic two-tailed p-value.
                </p>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  4. Live Math Trace Simulator
                </h4>
                {liveExplanationSample ? (
                  <div className="space-y-1.5 font-mono text-[10px] bg-white p-3 rounded-xl border border-slate-200 text-slate-700">
                    <p className="font-bold text-indigo-700">Active Example Well: {liveExplanationSample.id}</p>
                    <p>Location: {liveExplanationSample.location} ({liveExplanationSample.district})</p>
                    <p>Base Value: {liveExplanationSample.base}</p>
                    <p>Compare Value: {liveExplanationSample.comp}</p>
                    <p>Change: {((liveExplanationSample.comp - liveExplanationSample.base) / Math.abs(liveExplanationSample.base) * 100).toFixed(2)}%</p>
                    <p>Calculated Status: <span className="font-black text-blue-600">{liveExplanationSample.status}</span></p>
                  </div>
                ) : (
                  <p className="text-slate-400 italic">No valid paired well is found to trace yet.</p>
                )}
              </div>

            </div>
          </div>
        )}

      </section>

    </div>
  );
}

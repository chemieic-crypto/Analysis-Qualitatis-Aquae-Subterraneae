import React, { useState, useMemo, useCallback } from "react";
import { DataHeaders } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { 
  TrendingUp, 
  BarChart2, 
  Download, 
  Settings, 
  Award, 
  Globe, 
  Map, 
  Grid, 
  MapPin, 
  Maximize2, 
  Minimize2,
  TableProperties,
  ArrowUpDown,
  Filter
} from "lucide-react";
import * as XLSX from "xlsx";

function toProperCase(str: string): string {
  if (!str) return "N/A";
  if (str.toUpperCase() === "N/A") return "N/A";
  return str
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

interface RankingStatsViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState?: string;
  selectedDistrict?: string;
}

type SubTab = "national" | "stateSummary" | "stateRank" | "districtRank" | "blockRank";

export default function RankingStatsView({
  rawData,
  headers,
  headerMap,
  selectedState = "",
  selectedDistrict = ""
}: RankingStatsViewProps) {
  // Navigation states
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("national");
  const [activeParam, setActiveParam] = useState<string>("pH");
  const [rankBy, setRankBy] = useState<"count" | "percentage">("count");
  const [topN, setTopN] = useState<number>(10);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Minimum sample requirements to prevent low-sample noise
  const [minStateSamples, setMinStateSamples] = useState<number>(10);
  const [minDistrictSamples, setMinDistrictSamples] = useState<number>(5);
  const [minBlockSamples, setMinBlockSamples] = useState<number>(2);

  // Get active mapped params (only those mapped in headerMap)
  const availableParams = useMemo(() => {
    let baseParams = Object.keys(headerMap).filter(key => headerMap[key] && rawData.some(row => row[key] !== undefined || row[headerMap[key]] !== undefined));
    
    // Exclude parameters without BIS limits from ranking & statistics
    baseParams = baseParams.filter(key => {
      const paramId = headerMap[key];
      return !["Na", "K", "HCO3", "CO3"].includes(paramId);
    });
    
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

    // Ensure all calculated agricultural & hazard parameters are always listed
    const extraParams = ["TDS", "Alkalinity", "SAR", "RSC", "SSP", "Na%", "PI", "MH"];
    extraParams.forEach(ep => {
      const exists = params.some(p => p.toLowerCase() === ep.toLowerCase() || (headerMap[p] && headerMap[p].toLowerCase() === ep.toLowerCase()));
      if (!exists) {
        params.push(ep);
      }
    });

    const finalParams: string[] = [];
    const seen = new Set<string>();
    params.forEach(p => {
      const upper = p.toUpperCase();
      if (!seen.has(upper)) {
        seen.add(upper);
        finalParams.push(p);
      }
    });

    return finalParams;
  }, [headerMap, rawData]);

  // Set default active parameter when list loads
  React.useEffect(() => {
    if (availableParams.length > 0 && !availableParams.includes(activeParam)) {
      setActiveParam(availableParams[0]);
    }
  }, [availableParams, activeParam]);

  // Robust function to parse parameter value (including SAR and RSC fallback calculation)
  const getParamVal = useCallback((row: any, paramName: string) => {
    const isVirtual = ["SAR", "RSC", "SSP", "Na%", "PI", "MH", "TDS", "Alkalinity"].includes(paramName);
    if (isVirtual) {
      // First check if there is an actual Excel column mapped to the parameter
      const excelCol = headerMap[paramName];
      if (excelCol && row[excelCol] !== undefined && row[excelCol] !== null) {
        const parsedVal = parseFloat(row[excelCol]);
        if (!isNaN(parsedVal)) return parsedVal;
      }
      
      // Fallback to dynamic calculation
      const caCol = headerMap["Ca"] || "Ca";
      const mgCol = headerMap["Mg"] || "Mg";
      const naCol = headerMap["Na"] || "Na";
      const kCol = headerMap["K"] || "K";
      const hco3Col = headerMap["HCO3"] || "HCO3";
      const co3Col = headerMap["CO3"] || "CO3";
      const ecCol = headerMap["EC"] || "EC";
      const tdsCol = headerMap["TDS"] || "TDS";
      const alkCol = headerMap["Alkalinity"] || "Alkalinity";
      
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
      } else if (paramName === "MH") {
        const denom = caMeq + mgMeq;
        if (denom > 0) return (mgMeq * 100) / denom;
      }
      return NaN;
    }
    const excelCol = headerMap[paramName] || paramName;
    return parseFloat(row[excelCol]);
  }, [headerMap]);

  // Calculations for National Summary (All parameters)
  const nationalSummaryData = useMemo(() => {
    if (!rawData.length || !availableParams.length) return [];

    const results: any[] = [];

    availableParams.forEach(paramKey => {
      const config = PARAM_CONFIG[paramKey] || { b1: 0, b2: 0, unit: "", name: paramKey };

      let minValObj: any = null;
      let maxValObj: any = null;
      let sum = 0;
      let count = 0;
      const values: number[] = [];

      rawData.forEach(row => {
        const v = getParamVal(row, paramKey);
        if (isNaN(v)) return;

        values.push(v);
        sum += v;
        count++;

        const locInfo = {
          val: v,
          loc: String(row[headers.location || "Location"] || "N/A").trim(),
          block: String(row[headers.block || "Block"] || "N/A").trim(),
          district: String(row[headers.district || "District"] || "N/A").trim(),
          state: String(row[headers.state || "State"] || "N/A").trim()
        };

        if (!minValObj || v < minValObj.val) minValObj = locInfo;
        if (!maxValObj || v > maxValObj.val) maxValObj = locInfo;
      });

      if (count > 0) {
        const avg = sum / count;
        let varianceSum = 0;
        values.forEach(v => {
          varianceSum += Math.pow(v - avg, 2);
        });
        const stdDev = count > 1 ? Math.sqrt(varianceSum / (count - 1)) : 0;

        results.push({
          paramKey,
          config,
          min: minValObj,
          max: maxValObj,
          avg,
          stdDev,
          count
        });
      }
    });

    return results.sort((a, b) => (a.config.name || "").localeCompare(b.config.name || ""));
  }, [rawData, availableParams, headerMap, headers, getParamVal]);

  // Calculations for State Detailed Overview (Selected parameter, state-wise)
  const stateSummaryData = useMemo(() => {
    if (!rawData.length || !activeParam || !headers.state) return [];

    const config = PARAM_CONFIG[activeParam] || { b1: 0, b2: 0, unit: "", name: activeParam };
    const stateGroups: Record<string, { state: string; values: number[]; minObj: any; maxObj: any; sum: number }> = {};

    rawData.forEach(row => {
      const state = String(row[headers.state || "State"] || "").trim();
      if (!state || state === "undefined") return;

      const v = getParamVal(row, activeParam);
      if (isNaN(v)) return;

      if (!stateGroups[state]) {
        stateGroups[state] = {
          state,
          values: [],
          minObj: null,
          maxObj: null,
          sum: 0
        };
      }

      stateGroups[state].values.push(v);
      stateGroups[state].sum += v;

      const locInfo = {
        val: v,
        loc: String(row[headers.location || "Location"] || "N/A").trim(),
        district: String(row[headers.district || "District"] || "N/A").trim(),
        block: String(row[headers.block || "Block"] || "N/A").trim()
      };

      if (!stateGroups[state].minObj || v < stateGroups[state].minObj.val) {
        stateGroups[state].minObj = locInfo;
      }
      if (!stateGroups[state].maxObj || v > stateGroups[state].maxObj.val) {
        stateGroups[state].maxObj = locInfo;
      }
    });

    return Object.values(stateGroups).map(g => {
      const n = g.values.length;
      const avg = g.sum / n;
      let varianceSum = 0;
      g.values.forEach(v => {
        varianceSum += Math.pow(v - avg, 2);
      });
      const stdDev = n > 1 ? Math.sqrt(varianceSum / (n - 1)) : 0;

      return {
        state: g.state,
        min: g.minObj,
        max: g.maxObj,
        avg,
        stdDev,
        count: n
      };
    }).sort((a, b) => a.state.localeCompare(b.state));
  }, [rawData, activeParam, headerMap, headers, getParamVal]);

  // Helper calculation function for State, District, Block rankings
  const getRankingData = (geoKey: string, minSamples: number) => {
    if (!rawData.length || !activeParam || !geoKey) return [];

    const config = PARAM_CONFIG[activeParam] || { b1: 0, b2: 0, unit: "", name: activeParam };
    const aggregationMap: Record<string, { 
      name: string; 
      total: number; 
      fail: number; 
      state: string; 
      district: string; 
      block: string; 
    }> = {};

    rawData.forEach(row => {
      const geoVal = String(row[geoKey] || "").trim();
      if (!geoVal || geoVal === "undefined") return;

      const v = getParamVal(row, activeParam);
      if (isNaN(v)) return;

      if (!aggregationMap[geoVal]) {
        aggregationMap[geoVal] = {
          name: geoVal,
          total: 0,
          fail: 0,
          state: String(row[headers.state || "State"] || "N/A").trim(),
          district: String(row[headers.district || "District"] || "N/A").trim(),
          block: String(row[headers.block || "Block"] || "N/A").trim()
        };
      }

      aggregationMap[geoVal].total++;

      // Exceedance threshold evaluation
      const hasExceedance = activeParam === "pH" 
        ? (v < config.b1 || v > config.b2) 
        : (v > config.b2);

      if (hasExceedance) {
        aggregationMap[geoVal].fail++;
      }
    });

    return Object.values(aggregationMap)
      .filter(item => item.total >= minSamples)
      .sort((a, b) => {
        if (rankBy === "percentage") {
          const pctA = a.total > 0 ? (a.fail / a.total) * 100 : 0;
          const pctB = b.total > 0 ? (b.fail / b.total) * 100 : 0;
          if (pctB !== pctA) {
            return pctB - pctA;
          }
        }
        return b.fail - a.fail; // Sort primary or fallback by exceedance count
      })
      .slice(0, topN);
  };

  // State Level Rankings
  const stateRankings = useMemo(() => {
    return getRankingData(headers.state || "State", minStateSamples);
  }, [rawData, activeParam, headerMap, headers, minStateSamples, rankBy, topN]);

  // District Level Rankings
  const districtRankings = useMemo(() => {
    return getRankingData(headers.district || "District", minDistrictSamples);
  }, [rawData, activeParam, headerMap, headers, minDistrictSamples, rankBy, topN]);

  // Block Level Rankings
  const blockRankings = useMemo(() => {
    return getRankingData(headers.block || "Block", minBlockSamples);
  }, [rawData, activeParam, headerMap, headers, minBlockSamples, rankBy, topN]);

  // Trigger Excel download specifically for the rankings
  const handleExportRankings = () => {
    if (!rawData.length || availableParams.length === 0) return;

    const wb = XLSX.utils.book_new();

    // Helper to format/append styled worksheets
    const appendWorksheet = (dataArray: any[], sheetName: string) => {
      if (dataArray.length === 0) return;
      const ws = XLSX.utils.json_to_sheet(dataArray);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    };

    // 1. National Summary Export
    const nationalDataExport = nationalSummaryData.map((d, i) => {
      const limitStr = d.paramKey === "pH" ? `${d.config.b1} - ${d.config.b2}` : `${d.config.b2}`;
      return {
        "Sl No": i + 1,
        "Country": "INDIA",
        "Parameter": d.config.name,
        "Unit": d.config.unit,
        "Permissible Limit": limitStr,
        "Minimum Value": Number(d.min.val.toFixed(2)),
        "Maximum Value": Number(d.max.val.toFixed(2)),
        "Average Value": Number(d.avg.toFixed(2)),
        "Std Deviation": Number(d.stdDev.toFixed(2)),
        "Samples Monitored": d.count,
        "Min Value Location": `${d.min.loc} (State: ${d.min.state}, District: ${d.min.district}, Block: ${d.min.block})`,
        "Max Value Location": `${d.max.loc} (State: ${d.max.state}, District: ${d.max.district}, Block: ${d.max.block})`
      };
    });
    appendWorksheet(nationalDataExport, "NATIONAL SUMMARY");

    // 2. State Summary Export
    if (stateSummaryData.length > 0) {
      const config = PARAM_CONFIG[activeParam] || { b1: 0, b2: 0, unit: "", name: activeParam };
      const limitStr = activeParam === "pH" ? `${config.b1} - ${config.b2}` : `${config.b2}`;
      const stateSummaryExport = stateSummaryData.map((d, i) => ({
        "Sl No": i + 1,
        "State": d.state,
        "Parameter": config.name,
        "Unit": config.unit,
        "Permissible Limit": limitStr,
        "Minimum Value": Number(d.min.val.toFixed(2)),
        "Maximum Value": Number(d.max.val.toFixed(2)),
        "Average Value": Number(d.avg.toFixed(2)),
        "Std Deviation": Number(d.stdDev.toFixed(2)),
        "Samples Monitored": d.count,
        "Min Value Location": `${d.min.loc} (District: ${d.min.district}, Block: ${d.min.block})`,
        "Max Value Location": `${d.max.loc} (District: ${d.max.district}, Block: ${d.max.block})`
      }));
      appendWorksheet(stateSummaryExport, `STATE SUMMARY_${activeParam}`);
    }

    // 3. State Rankings Export
    if (stateRankings.length > 0) {
      const stateRankExport = stateRankings.map((d, i) => ({
        "Rank": i + 1,
        "State": d.name,
        "Total Samples": d.total,
        "Exceeding Samples": d.fail,
        "Percentage Above Limit": Number(((d.fail / d.total) * 100).toFixed(2))
      }));
      appendWorksheet(stateRankExport, "STATE RANKINGS");
    }

    // 4. District Rankings Export
    if (districtRankings.length > 0) {
      const distRankExport = districtRankings.map((d, i) => ({
        "Rank": i + 1,
        "State": d.state,
        "District": d.name,
        "Total Samples": d.total,
        "Exceeding Samples": d.fail,
        "Percentage Above Limit": Number(((d.fail / d.total) * 100).toFixed(2))
      }));
      appendWorksheet(distRankExport, "DISTRICT RANKINGS");
    }

    // 5. Block Rankings Export
    if (blockRankings.length > 0) {
      const blkRankExport = blockRankings.map((d, i) => ({
        "Rank": i + 1,
        "State": d.state,
        "District": d.district,
        "Block": d.name,
        "Total Samples": d.total,
        "Exceeding Samples": d.fail,
        "Percentage Above Limit": Number(((d.fail / d.total) * 100).toFixed(2))
      }));
      appendWorksheet(blkRankExport, "BLOCK RANKINGS");
    }

    XLSX.writeFile(wb, `Groundwater_Ranking_Stats_${activeParam}_${Date.now()}.xlsx`);
  };

  const getSubTabHeaderColor = (tab: SubTab) => {
    switch (tab) {
      case "national": return "border-indigo-600 text-indigo-700 bg-indigo-50/50";
      case "stateSummary": return "border-emerald-600 text-emerald-700 bg-emerald-50/50";
      case "stateRank": return "border-rose-600 text-rose-700 bg-rose-50/50";
      case "districtRank": return "border-amber-650 text-amber-850 bg-amber-50/50";
      case "blockRank": return "border-purple-600 text-purple-700 bg-purple-50/50";
    }
  };

  return (
    <div className={`glossy-panel p-6 rounded-3xl bg-white/95 backdrop-blur-md shadow-2xl border border-slate-150 relative transition-all duration-300 ${isFullscreen ? "fixed inset-4 z-[9999] overflow-auto h-[calc(100vh-32px)]" : ""}`}>

      {rawData.length === 0 ? (
        <div className="py-24 text-center text-slate-400">
          <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30 animate-pulse text-indigo-500" />
          <h4 className="font-extrabold text-slate-700 uppercase tracking-wider text-sm">Waiting For Dataset</h4>
          <p className="text-xs text-slate-400 mt-1">Please load your groundwater excel file to run automated exceedance rankings.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {/* Settings Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 shadow-sm">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                <Settings className="w-3.5 h-3.5 text-indigo-500" /> Active Parameter
              </label>
              <select
                value={activeParam}
                onChange={(e) => setActiveParam(e.target.value)}
                className="w-full bg-white border border-slate-200 font-bold text-slate-800 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500/10 cursor-pointer"
              >
                {availableParams.map(p => (
                  <option key={p} value={p}>
                    {PARAM_CONFIG[p]?.name || p} ({p})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                <ArrowUpDown className="w-3.5 h-3.5 text-indigo-500" /> Sort Rankings By
              </label>
              <select
                value={rankBy}
                onChange={(e) => setRankBy(e.target.value as any)}
                className="w-full bg-white border border-slate-200 font-bold text-slate-800 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500/10 cursor-pointer"
              >
                <option value="count">Exceedance Count (Total)</option>
                <option value="percentage">Risk Percentage (%)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-indigo-500" /> Limit Top Results
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={topN}
                onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value) || 10))}
                className="w-full bg-white border border-slate-200 font-bold text-slate-800 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500/10"
              />
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-indigo-500" /> Min Required Samples
              </label>
              <div className="grid grid-cols-3 gap-1">
                <div className="text-center">
                  <span className="text-[8px] font-bold text-slate-400 block mb-0.5">State</span>
                  <input
                    type="number"
                    min={1}
                    value={minStateSamples}
                    onChange={(e) => setMinStateSamples(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-white border border-slate-200 font-bold text-slate-800 rounded-lg p-1 text-[10px] text-center"
                  />
                </div>
                <div className="text-center">
                  <span className="text-[8px] font-bold text-slate-400 block mb-0.5">Dist</span>
                  <input
                    type="number"
                    min={1}
                    value={minDistrictSamples}
                    onChange={(e) => setMinDistrictSamples(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-white border border-slate-200 font-bold text-slate-800 rounded-lg p-1 text-[10px] text-center"
                  />
                </div>
                <div className="text-center">
                  <span className="text-[8px] font-bold text-slate-400 block mb-0.5">Block</span>
                  <input
                    type="number"
                    min={1}
                    value={minBlockSamples}
                    onChange={(e) => setMinBlockSamples(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-white border border-slate-200 font-bold text-slate-800 rounded-lg p-1 text-[10px] text-center"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sub-tabs Selection Row & Action buttons */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-200 gap-4 pb-3.5 select-none">
            <div className="flex overflow-x-auto custom-scrollbar gap-2 flex-1 py-1">
              {[
                { id: "national", label: "National Overview", icon: Globe, color: "indigo" },
                { id: "stateSummary", label: `State Overview (${activeParam})`, icon: TableProperties, color: "emerald" },
                { id: "stateRank", label: "State Rankings", icon: Award, color: "rose" },
                { id: "districtRank", label: "District Rankings", icon: Map, color: "amber" },
                { id: "blockRank", label: "Block Rankings", icon: Grid, color: "purple" },
              ].map((tabItem) => {
                const IconComponent = tabItem.icon;
                const isActive = activeSubTab === tabItem.id;

                const styleMap: Record<string, { bg: string; activeBg: string; text: string; shadow: string; hoverBg: string; activeShadow: string; ring: string }> = {
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

                const style = styleMap[tabItem.color] || styleMap.indigo;

                return (
                  <button
                    key={tabItem.id}
                    onClick={() => setActiveSubTab(tabItem.id as any)}
                    className={`
                      whitespace-nowrap px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 select-none transition-all duration-150 cursor-pointer border border-white/10
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

            <div className="flex items-center gap-2 px-1 shrink-0 pb-1 sm:pb-0">
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-50 border border-slate-200 cursor-pointer transition-colors"
                title={isFullscreen ? "Minimize View" : "Fullscreen View"}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Sub-tab Content Grid */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-md flex flex-col max-h-[500px]">
            {/* Table wrapper */}
            <div className="overflow-auto custom-scrollbar flex-1">
              
              {/* 1. National Overview Tab */}
              {activeSubTab === "national" && (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gradient-to-r from-slate-800 to-slate-900 text-[10px] font-black uppercase tracking-wider sticky top-0 border-b border-slate-700 z-10 text-white shadow-sm">
                    <tr>
                      <th className="py-3.5 px-4 text-center w-12 border-r border-slate-700/50">SL.</th>
                      <th className="py-3.5 px-4">Country</th>
                      <th className="py-3.5 px-4">Parameter</th>
                      <th className="py-3.5 px-4">Unit</th>
                      <th className="py-3.5 px-4">BIS Permissible Limit</th>
                      <th className="py-3.5 px-4 text-center text-indigo-300">Min Value</th>
                      <th className="py-3.5 px-4 text-center text-rose-300">Max Value</th>
                      <th className="py-3.5 px-4 text-center text-slate-200">Avg Value</th>
                      <th className="py-3.5 px-4 text-center text-slate-300">Std Dev</th>
                      <th className="py-3.5 px-4 min-w-[220px]">Location of Max Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs bg-white font-medium text-slate-700">
                    {nationalSummaryData.map((d, i) => {
                      const limitStr = d.paramKey === "pH" ? `${d.config.b1} - ${d.config.b2}` : `${d.config.b2}`;
                      return (
                        <tr key={d.paramKey} className="hover:bg-indigo-50/25 transition-colors even:bg-slate-50/40">
                          <td className="py-3.5 px-4 text-center text-slate-400 font-bold border-r border-slate-100">{i + 1}</td>
                          <td className="py-3.5 px-4 font-black text-slate-900">INDIA</td>
                          <td className="py-3.5 px-4 text-indigo-700 font-black text-[13px]">{d.config.name}</td>
                          <td className="py-3.5 px-4 font-black text-slate-400">{d.config.unit || "-"}</td>
                          <td className="py-3.5 px-4 font-semibold text-slate-600">{limitStr}</td>
                          <td className="py-3.5 px-4 text-center font-black text-indigo-600 text-[13px]">{d.min?.val.toFixed(2)}</td>
                          <td className="py-3.5 px-4 text-center font-black text-rose-600 text-[13px] bg-rose-50/20">{d.max?.val.toFixed(2)}</td>
                          <td className="py-3.5 px-4 text-center text-slate-800 font-bold">{d.avg.toFixed(2)}</td>
                          <td className="py-3.5 px-4 text-center text-slate-500">{d.stdDev.toFixed(2)}</td>
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-850">{toProperCase(d.max?.loc)}</div>
                            <div className="text-[11px] text-rose-600 font-extrabold mt-0.5">
                              Value: {d.max?.val.toFixed(2)} {d.config.unit || ""}
                            </div>
                            <div className="text-[10px] text-slate-500 font-bold mt-0.5">
                              State: {toProperCase(d.max?.state)}, Dist: {toProperCase(d.max?.district)}, Blk: {toProperCase(d.max?.block)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {/* 2. State Overview Tab */}
              {activeSubTab === "stateSummary" && (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gradient-to-r from-slate-800 to-slate-900 text-[10px] font-black uppercase tracking-wider sticky top-0 border-b border-slate-700 z-10 text-white shadow-sm">
                    <tr>
                      <th className="py-3.5 px-4 text-center w-12 border-r border-slate-700/50">SL.</th>
                      <th className="py-3.5 px-4">State Name</th>
                      <th className="py-3.5 px-4">Parameter</th>
                      <th className="py-3.5 px-4">Unit</th>
                      <th className="py-3.5 px-4">BIS Permissible Limit</th>
                      <th className="py-3.5 px-4 text-center text-indigo-300">Min Value</th>
                      <th className="py-3.5 px-4 text-center text-rose-300">Max Value</th>
                      <th className="py-3.5 px-4 text-center text-slate-200">Avg Value</th>
                      <th className="py-3.5 px-4 text-center text-slate-300">Std Dev</th>
                      <th className="py-3.5 px-4 min-w-[200px]">Location of Max Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs bg-white font-medium text-slate-700">
                    {stateSummaryData.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-12 text-center text-slate-400 font-black uppercase tracking-widest bg-slate-50/50">
                          No state compliance summaries found for parameter: {activeParam}
                        </td>
                      </tr>
                    ) : (
                      stateSummaryData.map((d, i) => {
                        const config = PARAM_CONFIG[activeParam] || { b1: 0, b2: 0, unit: "", name: activeParam };
                        const limitStr = activeParam === "pH" ? `${config.b1} - ${config.b2}` : `${config.b2}`;
                        return (
                          <tr key={d.state} className="hover:bg-emerald-50/15 transition-colors even:bg-slate-50/40">
                            <td className="py-3.5 px-4 text-center text-slate-400 font-bold border-r border-slate-100">{i + 1}</td>
                            <td className="py-3.5 px-4 font-black text-slate-900 uppercase">{d.state}</td>
                            <td className="py-3.5 px-4 font-black text-emerald-700 text-[13px]">{config.name}</td>
                            <td className="py-3.5 px-4 font-black text-slate-400">{config.unit || "-"}</td>
                            <td className="py-3.5 px-4 font-semibold text-slate-600">{limitStr}</td>
                            <td className="py-3.5 px-4 text-center font-black text-indigo-600 text-[13px]">{d.min?.val.toFixed(2)}</td>
                            <td className="py-3.5 px-4 text-center font-black text-rose-600 text-[13px] bg-rose-50/20">{d.max?.val.toFixed(2)}</td>
                            <td className="py-3.5 px-4 text-center text-slate-800 font-bold">{d.avg.toFixed(2)}</td>
                            <td className="py-3.5 px-4 text-center text-slate-500">{d.stdDev.toFixed(2)}</td>
                            <td className="py-3.5 px-4">
                              <div className="font-bold text-slate-850">{toProperCase(d.max?.loc)}</div>
                              <div className="text-[11px] text-rose-600 font-extrabold mt-0.5">
                                Value: {d.max?.val.toFixed(2)} {config.unit || ""}
                              </div>
                              <div className="text-[10px] text-slate-500 font-bold mt-0.5">
                                District: {toProperCase(d.max?.district)}, Blk: {toProperCase(d.max?.block)}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}

              {/* 3. State Rankings Tab */}
              {activeSubTab === "stateRank" && (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gradient-to-r from-slate-800 to-slate-900 text-[10px] font-black uppercase tracking-wider sticky top-0 border-b border-slate-700 z-10 text-white shadow-sm">
                    <tr>
                      <th className="py-3.5 px-4 text-center w-20 border-r border-slate-700/50">Rank</th>
                      <th className="py-3.5 px-4">State Name</th>
                      <th className="py-3.5 px-4 text-center">Total Samples Monitored</th>
                      <th className="py-3.5 px-4 text-center text-rose-300">Samples Exceeding Limit</th>
                      <th className="py-3.5 px-4 text-center text-amber-300">Percentage Non-Compliant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs bg-white font-medium text-slate-700">
                    {stateRankings.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-400 font-black uppercase tracking-widest bg-slate-50/50">
                          No states exceed standard limit boundaries with active filter: {minStateSamples} min samples
                        </td>
                      </tr>
                    ) : (
                      stateRankings.map((d, i) => {
                        const rank = i + 1;
                        return (
                          <tr key={d.name} className="hover:bg-rose-50/15 transition-colors even:bg-slate-50/40">
                            <td className="py-3.5 px-4 text-center border-r border-slate-100 font-black">
                              {rank === 1 ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black bg-amber-100 text-amber-800 border-2 border-amber-400 shadow-sm">
                                  🥇 1
                                </span>
                              ) : rank === 2 ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black bg-slate-100 text-slate-800 border-2 border-slate-300 shadow-sm">
                                  🥈 2
                                </span>
                              ) : rank === 3 ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black bg-amber-50 text-amber-700 border-2 border-amber-600/30 shadow-sm">
                                  🥉 3
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-slate-50 text-slate-500 border border-slate-200">
                                  {rank}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-black text-slate-900 uppercase text-[13px]">{d.name}</td>
                            <td className="py-3.5 px-4 text-center text-slate-700 font-bold text-[13px]">{d.total}</td>
                            <td className="py-3.5 px-4 text-center text-rose-600 font-black text-[13px] bg-rose-50/20">{d.fail}</td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-black bg-rose-50 text-rose-700 border border-rose-200 shadow-xs">
                                {((d.fail / d.total) * 100).toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}

              {/* 4. District Rankings Tab */}
              {activeSubTab === "districtRank" && (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gradient-to-r from-slate-800 to-slate-900 text-[10px] font-black uppercase tracking-wider sticky top-0 border-b border-slate-700 z-10 text-white shadow-sm">
                    <tr>
                      <th className="py-3.5 px-4 text-center w-20 border-r border-slate-700/50">Rank</th>
                      <th className="py-3.5 px-4">State</th>
                      <th className="py-3.5 px-4">District</th>
                      <th className="py-3.5 px-4 text-center">Total Samples Monitored</th>
                      <th className="py-3.5 px-4 text-center text-rose-300">Samples Exceeding Limit</th>
                      <th className="py-3.5 px-4 text-center text-amber-300">Percentage Non-Compliant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs bg-white font-medium text-slate-700">
                    {districtRankings.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-400 font-black uppercase tracking-widest bg-slate-50/50">
                          No districts exceed standard limits with active filter: {minDistrictSamples} min samples
                        </td>
                      </tr>
                    ) : (
                      districtRankings.map((d, i) => {
                        const rank = i + 1;
                        return (
                          <tr key={d.name} className="hover:bg-amber-50/15 transition-colors even:bg-slate-50/40">
                            <td className="py-3.5 px-4 text-center border-r border-slate-100 font-black">
                              {rank === 1 ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black bg-amber-100 text-amber-800 border-2 border-amber-400 shadow-sm">
                                  🥇 1
                                </span>
                              ) : rank === 2 ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black bg-slate-100 text-slate-800 border-2 border-slate-300 shadow-sm">
                                  🥈 2
                                </span>
                              ) : rank === 3 ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black bg-amber-50 text-amber-700 border-2 border-amber-600/30 shadow-sm">
                                  🥉 3
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-slate-50 text-slate-500 border border-slate-200">
                                  {rank}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-slate-500 font-bold uppercase">{d.state}</td>
                            <td className="py-3.5 px-4 font-black text-slate-900 uppercase text-[13px]">{d.name}</td>
                            <td className="py-3.5 px-4 text-center text-slate-700 font-bold text-[13px]">{d.total}</td>
                            <td className="py-3.5 px-4 text-center text-rose-600 font-black text-[13px] bg-rose-50/20">{d.fail}</td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-black bg-amber-50 text-amber-800 border border-amber-200 shadow-xs">
                                {((d.fail / d.total) * 100).toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}

              {/* 5. Block Rankings Tab */}
              {activeSubTab === "blockRank" && (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gradient-to-r from-slate-800 to-slate-900 text-[10px] font-black uppercase tracking-wider sticky top-0 border-b border-slate-700 z-10 text-white shadow-sm">
                    <tr>
                      <th className="py-3.5 px-4 text-center w-20 border-r border-slate-700/50">Rank</th>
                      <th className="py-3.5 px-4">State</th>
                      <th className="py-3.5 px-4">District</th>
                      <th className="py-3.5 px-4">Block / Tehsil</th>
                      <th className="py-3.5 px-4 text-center">Total Samples Monitored</th>
                      <th className="py-3.5 px-4 text-center text-rose-300">Samples Exceeding Limit</th>
                      <th className="py-3.5 px-4 text-center text-amber-300">Percentage Non-Compliant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs bg-white font-medium text-slate-700">
                    {blockRankings.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400 font-black uppercase tracking-widest bg-slate-50/50">
                          No blocks/tehsils exceed standard limits with active filter: {minBlockSamples} min samples
                        </td>
                      </tr>
                    ) : (
                      blockRankings.map((d, i) => {
                        const rank = i + 1;
                        return (
                          <tr key={d.name} className="hover:bg-purple-50/15 transition-colors even:bg-slate-50/40">
                            <td className="py-3.5 px-4 text-center border-r border-slate-100 font-black">
                              {rank === 1 ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black bg-amber-100 text-amber-800 border-2 border-amber-400 shadow-sm">
                                  🥇 1
                                </span>
                              ) : rank === 2 ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black bg-slate-100 text-slate-800 border-2 border-slate-300 shadow-sm">
                                  🥈 2
                                </span>
                              ) : rank === 3 ? (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black bg-amber-50 text-amber-700 border-2 border-amber-600/30 shadow-sm">
                                  🥉 3
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-slate-50 text-slate-500 border border-slate-200">
                                  {rank}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-slate-400 font-bold uppercase">{d.state}</td>
                            <td className="py-3.5 px-4 text-slate-500 font-semibold uppercase">{d.district}</td>
                            <td className="py-3.5 px-4 font-black text-slate-900 uppercase text-[13px]">{d.name}</td>
                            <td className="py-3.5 px-4 text-center text-slate-700 font-bold text-[13px]">{d.total}</td>
                            <td className="py-3.5 px-4 text-center text-rose-600 font-black text-[13px] bg-rose-50/20">{d.fail}</td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-black bg-purple-50 text-purple-700 border border-purple-200 shadow-xs">
                                {((d.fail / d.total) * 100).toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}

            </div>
          </div>

          {/* Repositioned Export Excel Report Button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleExportRankings}
              disabled={rawData.length === 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-wider px-6 py-3 rounded-2xl shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <Download className="w-4 h-4" /> Export Excel Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

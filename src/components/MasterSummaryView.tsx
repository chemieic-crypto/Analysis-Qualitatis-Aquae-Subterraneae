import React, { useState, useEffect, useMemo } from "react";
import { DataHeaders } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { TableProperties, FileSpreadsheet, Download, Maximize2, Minimize2 } from "lucide-react";
import * as XLSX from "xlsx";

interface MasterSummaryViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState: string;
  selectedDistrict: string;
  onExportExcel: () => void;
  reportingLevel: "State" | "District" | "Block";
}

export default function MasterSummaryView({
  rawData,
  headers,
  headerMap,
  selectedState,
  selectedDistrict,
  onExportExcel,
}: MasterSummaryViewProps) {
  const [masterGeoLevel, setMasterGeoLevel] = useState<"State" | "District">("State");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bodyHtml, setBodyHtml] = useState<React.ReactNode[]>([]);

  // Get active mapped params (including SAR and RSC if necessary components are present)
  const activeParams = useMemo(() => {
    if (!headers.params) return [];
    let baseParams = [...headers.params];
    
    // Filter out Na, K, HCO3, CO3 from BIS analysis
    baseParams = baseParams.filter(p => {
      const paramId = headerMap[p] || p;
      return !["Na", "K", "HCO3", "CO3"].includes(paramId);
    });
    
    const hasCa = !!headerMap["Ca"];
    const hasMg = !!headerMap["Mg"];
    const hasNa = !!headerMap["Na"];
    const hasHco3 = !!headerMap["HCO3"];
    
    const showSAR = hasCa && hasMg && hasNa && !baseParams.some(p => p === "SAR" || headerMap[p] === "SAR");
    const showRSC = hasCa && hasMg && hasHco3 && !baseParams.some(p => p === "RSC" || headerMap[p] === "RSC");
    
    if (showSAR && !baseParams.includes("SAR")) {
      baseParams.push("SAR");
    }
    if (showRSC && !baseParams.includes("RSC")) {
      baseParams.push("RSC");
    }
    return baseParams;
  }, [headers.params, headerMap]);

  // Helper to parse/calculate parameter values (with fallback for SAR/RSC)
  const getParamVal = (row: any, paramName: string) => {
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
  };

  useEffect(() => {
    if (!rawData.length || !activeParams || activeParams.length === 0) return;

    const isDistrict = masterGeoLevel === "District";
    const subGroupName = isDistrict ? "Block" : "District";
    const subGroupKey = isDistrict ? headers.block : headers.district;

    // Filter Raw Data based on global inputs
    let filtered = rawData;
    if (selectedState) {
      filtered = filtered.filter(
        (d) => String(d[headers.state || ""] || "").trim() === selectedState
      );
    }
    if (selectedDistrict && isDistrict) {
      filtered = filtered.filter(
        (d) => String(d[headers.district || ""] || "").trim() === selectedDistrict
      );
    }

    // Group samples by Level ID
    const groupMap: Record<string, { state: string; district: string; samples: any[] }> = {};
    filtered.forEach((row) => {
      const state = String(row[headers.state || ""] || "Unknown").trim();
      const district = String(row[headers.district || ""] || "Unknown").trim();
      
      const key = isDistrict ? `${state}|${district}` : state;
      if (!groupMap[key]) {
        groupMap[key] = { state, district, samples: [] };
      }
      groupMap[key].samples.push(row);
    });

    const globalStats: Record<string, { analyzed: number; above: number; affectedSubGroups: Set<string>; affectedSubGroupsSum: number }> = {};
    activeParams.forEach((p) => {
      globalStats[p] = { analyzed: 0, above: 0, affectedSubGroups: new Set(), affectedSubGroupsSum: 0 };
    });

    // Sort groups
    const sortedGroupKeys = Object.keys(groupMap).sort((a, b) => {
      const gA = groupMap[a]!;
      const gB = groupMap[b]!;
      if (gA.state === gB.state) return gA.district.localeCompare(gB.district);
      return gA.state.localeCompare(gB.state);
    });

    // 1. Build table rows JSX programmatically
    const rowElements: React.ReactNode[] = [];
    let slNo = 1;

    sortedGroupKeys.forEach((key) => {
      const group = groupMap[key]!;
      const rowCells: React.ReactNode[] = [];

      // Geo cells
      rowCells.push(
        <td key="sl" className="p-3 border border-slate-200 text-center text-slate-400 font-bold">
          {slNo++}
        </td>
      );
      rowCells.push(
        <td key="state" className="p-3 border border-slate-200 font-bold">
          {group.state}
        </td>
      );
      if (isDistrict) {
        rowCells.push(
          <td key="district" className="p-3 border border-slate-200 font-black text-slate-900">
            {group.district}
          </td>
        );
      }

      // Parameters cells
      activeParams.forEach((paramName, pIdx) => {
        const configKey = headerMap[paramName] || paramName;
        const config = PARAM_CONFIG[configKey];
        if (!config) {
          rowCells.push(<td key={`${pIdx}-1`} className="p-3 border border-slate-200 text-center font-mono">0</td>);
          rowCells.push(<td key={`${pIdx}-2`} className="p-3 border border-slate-200 text-center font-mono">0</td>);
          rowCells.push(<td key={`${pIdx}-3`} className="p-3 border border-slate-200 text-center font-mono">0.00%</td>);
          rowCells.push(<td key={`${pIdx}-4`} className="p-3 border border-slate-200 text-center font-mono">0</td>);
          rowCells.push(<td key={`${pIdx}-5`} className="p-3 border border-slate-200 text-left">-</td>);
          return;
        }

        const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
        const limit = isSingleLimit ? config.b1 : config.b2;

        let analyzed = 0;
        let above = 0;
        const affectedSubGroups = new Set<string>();

        group.samples.forEach((sample) => {
          const val = getParamVal(sample, paramName);
          if (!isNaN(val)) {
            analyzed++;
            let isExceed = false;
            
            if (configKey === "pH") {
              if (val < config.b1 || val > config.b2) isExceed = true;
            } else if (val > limit) {
              isExceed = true;
            }

            if (isExceed) {
              above++;
              if (subGroupKey) {
                const subVal = String(sample[subGroupKey] || "Unknown").trim();
                if (subVal !== "Unknown" && subVal) affectedSubGroups.add(subVal);
              }
            }
          }
        });

        const pct = analyzed > 0 ? (above / analyzed) * 100 : 0;
        const affectedNames = affectedSubGroups.size > 0 ? Array.from(affectedSubGroups).sort().join(", ") : "-";

        rowCells.push(
          <td key={`${pIdx}-a`} className="p-3 border border-slate-100 text-center font-mono text-xs">{analyzed}</td>
        );
        rowCells.push(
          <td key={`${pIdx}-b`} className={`p-3 border border-slate-100 text-center font-mono text-xs font-bold ${above > 0 ? "text-rose-600 bg-rose-50/10" : "text-slate-400"}`}>
            {above}
          </td>
        );
        rowCells.push(
          <td key={`${pIdx}-c`} className={`p-3 border border-slate-100 text-center font-mono text-xs font-black ${above > 0 ? "text-rose-600 bg-rose-50/20" : "text-emerald-600"}`}>
            {pct.toFixed(2)}%
          </td>
        );
        rowCells.push(
          <td key={`${pIdx}-d`} className="p-3 border border-slate-100 text-center font-mono text-xs">{affectedSubGroups.size}</td>
        );
        styleCellMaxWidth(rowCells, pIdx, affectedNames);

        // Accumulate statistics
        globalStats[paramName]!.analyzed += analyzed;
        globalStats[paramName]!.above += above;
        globalStats[paramName]!.affectedSubGroupsSum += affectedSubGroups.size;
        affectedSubGroups.forEach((v) => globalStats[paramName]!.affectedSubGroups.add(v));
      });

      rowElements.push(
        <tr key={key} className="hover:bg-blue-50 transition-colors">
          {rowCells}
        </tr>
      );
    });

    // 2. Add Grand Total row to rows JSX
    if (rowElements.length > 0) {
      const grandCells: React.ReactNode[] = [];
      grandCells.push(
        <td key="sl" className="p-3 border border-slate-700 text-center text-slate-400">-</td>
      );
      grandCells.push(
        <td key="state" className="p-3 border border-slate-700" colSpan={isDistrict ? 2 : 1}>
          GRAND TOTAL
        </td>
      );

      activeParams.forEach((paramName, pIdx) => {
        const stats = globalStats[paramName]!;
        const pct = stats.analyzed > 0 ? (stats.above / stats.analyzed) * 100 : 0;

        grandCells.push(
          <td key={`${pIdx}-a`} className="p-3 border border-slate-700 text-center text-slate-300 font-mono text-xs">{stats.analyzed}</td>
        );
        grandCells.push(
          <td key={`${pIdx}-b`} className={`p-3 border border-slate-700 text-center font-mono text-xs font-black ${stats.above > 0 ? "text-rose-300 bg-rose-900/40" : "text-slate-400"}`}>
            {stats.above}
          </td>
        );
        grandCells.push(
          <td key={`${pIdx}-c`} className={`p-3 border border-slate-700 text-center font-mono text-xs font-black ${stats.above > 0 ? "text-rose-300" : "text-emerald-400"}`}>
            {pct.toFixed(2)}%
          </td>
        );
        const totalAffectedNames = stats.affectedSubGroups.size > 0 
          ? Array.from(stats.affectedSubGroups).sort().join(", ") 
          : "-";

        grandCells.push(
          <td key={`${pIdx}-d`} className="p-3 border border-slate-700 text-center font-mono text-xs font-bold text-amber-300">
            {stats.affectedSubGroupsSum}
          </td>
        );
        grandCells.push(
          <td key={`${pIdx}-e`} className="p-3 border border-slate-700 text-left text-slate-400 font-semibold max-w-[200px] truncate" title="-">
            -
          </td>
        );
      });

      rowElements.push(
        <tr key="grand_total" className="bg-slate-900 text-white font-extrabold text-xs">
          {grandCells}
        </tr>
      );
    }

    setBodyHtml(rowElements);
  }, [rawData, headers, headerMap, selectedState, selectedDistrict, masterGeoLevel, activeParams]);

  // Handler to export the complete unified Master Summary Matrix table as a styled Excel Sheet
  const handleExportMatrixExcel = () => {
    if (!rawData.length || !activeParams || activeParams.length === 0) {
      alert("No data available to export.");
      return;
    }

    const isDistrict = masterGeoLevel === "District";
    const subGroupName = isDistrict ? "Block" : "District";
    const subGroupKey = isDistrict ? headers.block : headers.district;

    // Filter Raw Data
    let filtered = rawData;
    if (selectedState) {
      filtered = filtered.filter(
        (d) => String(d[headers.state || ""] || "").trim() === selectedState
      );
    }
    if (selectedDistrict && isDistrict) {
      filtered = filtered.filter(
        (d) => String(d[headers.district || ""] || "").trim() === selectedDistrict
      );
    }

    // Group samples
    const groupMap: Record<string, { state: string; district: string; samples: any[] }> = {};
    filtered.forEach((row) => {
      const state = String(row[headers.state || ""] || "Unknown").trim();
      const district = String(row[headers.district || ""] || "Unknown").trim();
      
      const key = isDistrict ? `${state}|${district}` : state;
      if (!groupMap[key]) {
        groupMap[key] = { state, district, samples: [] };
      }
      groupMap[key].samples.push(row);
    });

    const sortedGroupKeys = Object.keys(groupMap).sort((a, b) => {
      const gA = groupMap[a]!;
      const gB = groupMap[b]!;
      if (gA.state === gB.state) return gA.district.localeCompare(gB.district);
      return gA.state.localeCompare(gB.state);
    });

    // Build AOA (Array of Arrays) for Excel
    const sheetData: any[][] = [];
    const reportTitle = `Groundwater Quality Master Summary Matrix - ${isDistrict ? "District" : "States and UTs"} Wise`;
    sheetData.push([reportTitle]);
    sheetData.push([]); // Empty row

    // Row 3 (Parameter titles)
    const row3: any[] = ["S.No.", "State / UT"];
    if (isDistrict) row3.push("District");
    
    activeParams.forEach((paramName) => {
      row3.push(paramName);
      row3.push(""); // empty slots for merged cells
      row3.push("");
      row3.push("");
      row3.push("");
    });
    sheetData.push(row3);

    // Row 4 (Column subheaders)
    const row4: any[] = ["", ""];
    if (isDistrict) row4.push("");
    
    activeParams.forEach(() => {
      row4.push("No. of Samples Analyzed");
      row4.push("No. of Samples Above Limit");
      row4.push("% Above Limit");
      row4.push(`No. of ${subGroupName}s Affected`);
      row4.push(`Names of Affected ${subGroupName}s`);
    });
    sheetData.push(row4);

    // Row 5 onwards: Data
    let slNo = 1;
    const globalStats: Record<string, { analyzed: number; above: number; affectedSubGroups: Set<string>; affectedSubGroupsSum: number }> = {};
    activeParams.forEach((p) => {
      globalStats[p] = { analyzed: 0, above: 0, affectedSubGroups: new Set(), affectedSubGroupsSum: 0 };
    });

    sortedGroupKeys.forEach((key) => {
      const group = groupMap[key]!;
      const row: any[] = [slNo++, group.state];
      if (isDistrict) row.push(group.district);

      activeParams.forEach((paramName) => {
        const configKey = headerMap[paramName] || paramName;
        const config = PARAM_CONFIG[configKey];
        if (!config) {
          row.push(0, 0, "0.00%", 0, "-");
          return;
        }

        const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
        const limit = isSingleLimit ? config.b1 : config.b2;

        let analyzed = 0;
        let above = 0;
        const affectedSubGroups = new Set<string>();

        group.samples.forEach((sample) => {
          const val = getParamVal(sample, paramName);
          if (!isNaN(val)) {
            analyzed++;
            let isExceed = false;
            if (configKey === "pH") {
              if (val < config.b1 || val > config.b2) isExceed = true;
            } else if (val > limit) {
              isExceed = true;
            }

            if (isExceed) {
              above++;
              if (subGroupKey) {
                const subVal = String(sample[subGroupKey] || "Unknown").trim();
                if (subVal !== "Unknown" && subVal) affectedSubGroups.add(subVal);
              }
            }
          }
        });

        const pct = analyzed > 0 ? (above / analyzed) * 100 : 0;
        const affectedNames = affectedSubGroups.size > 0 ? Array.from(affectedSubGroups).sort().join(", ") : "-";

        row.push(analyzed, above, `${pct.toFixed(2)}%`, affectedSubGroups.size, affectedNames);

        globalStats[paramName]!.analyzed += analyzed;
        globalStats[paramName]!.above += above;
        globalStats[paramName]!.affectedSubGroupsSum += affectedSubGroups.size;
        affectedSubGroups.forEach((v) => globalStats[paramName]!.affectedSubGroups.add(v));
      });

      sheetData.push(row);
    });

    // Grand Total Row
    const grandRow: any[] = ["-", "GRAND TOTAL"];
    if (isDistrict) grandRow.push("");

    activeParams.forEach((paramName) => {
      const stats = globalStats[paramName]!;
      const pct = stats.analyzed > 0 ? (stats.above / stats.analyzed) * 100 : 0;
      grandRow.push(stats.analyzed, stats.above, `${pct.toFixed(2)}%`, stats.affectedSubGroupsSum, "-");
    });
    sheetData.push(grandRow);

    // Create Worksheet
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Add Merges for Row 3 and Row 4
    const merges: any[] = [];
    
    // Merge Title row
    const lastColIndex = (isDistrict ? 2 : 1) + (activeParams.length * 5) - 1;
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastColIndex } });

    // Merge S.No, State, District between Row 3 & 4
    merges.push({ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } });
    merges.push({ s: { r: 2, c: 1 }, e: { r: 3, c: 1 } });
    if (isDistrict) {
      merges.push({ s: { r: 2, c: 2 }, e: { r: 3, c: 2 } });
    }

    // Merge parameter name headers across 5 columns in Row 3
    const startOffset = isDistrict ? 3 : 2;
    activeParams.forEach((_, idx) => {
      const cStart = startOffset + idx * 5;
      const cEnd = cStart + 4;
      merges.push({ s: { r: 2, c: cStart }, e: { r: 2, c: cEnd } });
    });

    ws["!merges"] = merges;

    // Create workbook and write file
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master Summary Matrix");
    XLSX.writeFile(wb, `WQ_Master_Summary_Matrix_${isDistrict ? "District" : "States_and_UTs"}_${Date.now()}.xlsx`);
  };

  // Private helpers to truncate long names overflow cleanly
  function styleCellMaxWidth(rowCells: React.ReactNode[], index: number, names: string) {
    rowCells.push(
      <td key={`${index}-e`} className="p-3 border border-slate-100 text-left text-slate-500 max-w-[200px] truncate" title={names}>
        {names}
      </td>
    );
  }

  if (!activeParams || activeParams.length === 0) return null;

  const isDistrict = masterGeoLevel === "District";
  const subGroupName = isDistrict ? "Block" : "District";

  return (
    <div className="space-y-6">
      <div className="glossy-panel p-6 rounded-3xl">
        
        {/* Interactive Master Toolbar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-white/50 pb-4">
          <div>
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2 drop-shadow-sm">
              <TableProperties className="w-6 h-6 text-amber-600" />
              Comprehensive Master Summary Matrix
            </h3>
            <p className="text-sm text-slate-500 font-bold mt-1">
              Cross-parameter exceedance ratios and geological hotspot logs
            </p>
          </div>
          <div className="flex gap-3 items-end w-full md:w-auto">
            <div className="flex-1 md:flex-initial">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                View Level Link
              </label>
              <select
                value={masterGeoLevel}
                onChange={(e) => setMasterGeoLevel(e.target.value as "State" | "District")}
                className="glossy-input rounded-xl p-2.5 font-bold text-slate-700 min-w-[150px] bg-white cursor-pointer text-xs"
              >
                <option value="District">District Wise</option>
                <option value="State">States and UTs Wise</option>
              </select>
            </div>
            
            <button
              onClick={handleExportMatrixExcel}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 whitespace-nowrap shadow-lg hover:shadow-xl transition-all cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" /> Export Master Matrix (Excel)
            </button>

            <button
              onClick={onExportExcel}
              className="glossy-btn-indigo px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 whitespace-nowrap shadow-lg hover:shadow-xl transition-all cursor-pointer"
              title="Export separate detailed sheets for each parameter"
            >
              <Download className="w-4 h-4" /> Export Detailed Tabs
            </button>

            <button
              onClick={() => setIsFullscreen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 whitespace-nowrap shadow-lg hover:shadow-xl transition-all cursor-pointer"
              title="Full Screen Table View"
            >
              <Maximize2 className="w-4 h-4" /> Maximize Matrix
            </button>
          </div>
        </div>

        {/* Scalable matrix table container */}
        <div className="rounded-2xl overflow-hidden border border-slate-350 shadow-inner bg-white relative">
          <div className="overflow-x-auto overflow-y-auto custom-scrollbar max-h-[600px] w-full">
            <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
              <thead className="bg-blue-600 text-white font-bold sticky top-0 z-30 shadow-md">
                <tr>
                  <th rowSpan={2} className="p-3 border border-blue-700 bg-blue-600 text-center sticky left-0 z-40 align-middle">
                    S.No.
                  </th>
                  <th rowSpan={2} className="p-3 border border-blue-700 bg-blue-600 text-center sticky left-[52px] z-40 align-middle">
                    State / UT
                  </th>
                  
                  {isDistrict && (
                    <th rowSpan={2} className="p-3 border border-blue-700 bg-blue-600 text-center sticky left-[120px] z-40 align-middle border-r-2 border-r-blue-800">
                      District
                    </th>
                  )}

                  {activeParams.map((paramName) => (
                    <th key={paramName} colSpan={5} className="p-3 border border-blue-700 bg-blue-700 text-center tracking-wider font-extrabold">
                      {paramName}
                    </th>
                  ))}
                </tr>
                <tr>
                  {activeParams.flatMap((_, pIdx) => [
                    <th key={`${pIdx}-1`} className="p-2 border border-blue-500 bg-blue-500 text-center text-[10px] font-semibold min-w-[125px]">
                      No. of Samples Analyzed
                    </th>,
                    <th key={`${pIdx}-2`} className="p-2 border border-blue-500 bg-blue-500 text-center text-[10px] font-semibold min-w-[125px] bg-rose-700/20 text-rose-100">
                      No. of Samples Above Limit
                    </th>,
                    <th key={`${pIdx}-3`} className="p-2 border border-blue-500 bg-blue-500 text-center text-[10px] font-semibold min-w-[100px] bg-rose-700/40 text-white">
                      % Above Limit
                    </th>,
                    <th key={`${pIdx}-4`} className="p-2 border border-blue-500 bg-blue-500 text-center text-[10px] font-semibold min-w-[125px]">
                      No. of {subGroupName}s Affected
                    </th>,
                    <th key={`${pIdx}-5`} className="p-2 border border-blue-500 bg-blue-500 text-left text-[10px] font-semibold min-w-[200px]">
                      Names of Affected {subGroupName}s
                    </th>
                  ])}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700 font-medium bg-white">
                {bodyHtml.length === 0 ? (
                  <tr>
                    <td colSpan={2 + (isDistrict ? 1 : 0) + (activeParams.length * 5)} className="p-12 text-center text-slate-400 font-bold uppercase tracking-wider bg-white">
                      No data uploaded yet. Please upload a spreadsheet to view the compliance matrix.
                    </td>
                  </tr>
                ) : (
                  bodyHtml
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Full Screen Table Modal View */}
      {isFullscreen && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 md:p-8">
          <div className="bg-white rounded-3xl shadow-2xl p-3 sm:p-6 w-full h-[95vh] sm:h-[92vh] flex flex-col relative">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <TableProperties className="w-5 h-5 text-indigo-600 animate-pulse" />
                  Master Summary Matrix (Full Screen Explorer)
                </h3>
                <p className="text-[10px] text-slate-400 font-extrabold uppercase mt-0.5">
                  Interactive multi-parameter compliance logs with scroll optimization
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleExportMatrixExcel}
                  className="bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border-b-4 border-emerald-200 hover:border-emerald-800 active:border-b-0 active:translate-y-1"
                  title="Export Excel"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export Excel</span>
                </button>
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="bg-slate-100 text-slate-600 hover:bg-rose-600 hover:text-white p-2 rounded-xl text-xs font-bold transition-all border-b-4 border-slate-200 hover:border-rose-800 active:border-b-0 active:translate-y-1"
                  title="Close Full Screen"
                >
                  <Minimize2 className="w-4 h-4" />
                  <span>Exit Full Screen</span>
                </button>
              </div>
            </div>

            {/* Table stage inside Modal */}
            <div className="flex-1 overflow-hidden rounded-2xl border border-slate-200 shadow-inner bg-white relative flex flex-col">
              <div className="overflow-auto custom-scrollbar flex-1 w-full h-full">
                <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
                  <thead className="bg-indigo-600 text-white font-bold sticky top-0 z-30 shadow-md">
                    <tr>
                      <th rowSpan={2} className="p-3 border border-indigo-750 bg-indigo-600 text-center sticky left-0 z-40 align-middle">
                        S.No.
                      </th>
                      <th rowSpan={2} className="p-3 border border-indigo-750 bg-indigo-600 text-center sticky left-[52px] z-40 align-middle">
                        State / UT
                      </th>
                      
                      {isDistrict && (
                        <th rowSpan={2} className="p-3 border border-indigo-750 bg-indigo-600 text-center sticky left-[120px] z-40 align-middle border-r-2 border-r-indigo-800">
                          District
                        </th>
                      )}

                      {activeParams.map((paramName) => (
                        <th key={paramName} colSpan={5} className="p-3 border border-indigo-700 bg-indigo-700 text-center tracking-wider font-extrabold">
                          {paramName}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {activeParams.flatMap((_, pIdx) => [
                        <th key={`${pIdx}-1`} className="p-2 border border-indigo-500 bg-indigo-500 text-center text-[10px] font-semibold min-w-[125px]">
                          No. of Samples Analyzed
                        </th>,
                        <th key={`${pIdx}-2`} className="p-2 border border-indigo-500 bg-indigo-500 text-center text-[10px] font-semibold min-w-[125px] bg-rose-700/20 text-rose-100">
                          No. of Samples Above Limit
                        </th>,
                        <th key={`${pIdx}-3`} className="p-2 border border-indigo-500 bg-indigo-500 text-center text-[10px] font-semibold min-w-[100px] bg-rose-700/40 text-white">
                          % Above Limit
                        </th>,
                        <th key={`${pIdx}-4`} className="p-2 border border-indigo-500 bg-indigo-500 text-center text-[10px] font-semibold min-w-[125px]">
                          No. of {subGroupName}s Affected
                        </th>,
                        <th key={`${pIdx}-5`} className="p-2 border border-indigo-500 bg-indigo-500 text-left text-[10px] font-semibold min-w-[200px]">
                          Names of Affected {subGroupName}s
                        </th>
                      ])}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-700 font-medium bg-white">
                    {bodyHtml.length === 0 ? (
                      <tr>
                        <td colSpan={2 + (isDistrict ? 1 : 0) + (activeParams.length * 5)} className="p-12 text-center text-slate-400 font-bold uppercase tracking-wider bg-white">
                          No data uploaded yet.
                        </td>
                      </tr>
                    ) : (
                      bodyHtml
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

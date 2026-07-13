import React, { useState, useEffect, useMemo } from "react";
import Highcharts from "highcharts";
import { DataHeaders } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { BarChart3 } from "lucide-react";

interface ComparisonsViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState: string;
  selectedDistrict: string;
}

interface ExceedanceTableItem {
  slNo: number;
  paramName: string;
  limitStr: string;
  totalSamples: number;
  exceedPct: string;
}

export default function ComparisonsView({
  rawData,
  headers,
  headerMap,
  selectedState,
  selectedDistrict,
}: ComparisonsViewProps) {
  const [threshold, setThreshold] = useState(0);
  const [yAxisMax, setYAxisMax] = useState(100);
  const [decimals, setDecimals] = useState(2);

  // Calculate comparative exceedance data as memoized derived state
  const computedData = useMemo(() => {
    if (!rawData.length || !headers.params || headers.params.length === 0) {
      return { categories: [], dataSeries: [], tableItems: [] };
    }

    // Filter Raw Data
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

    const categories: string[] = [];
    const dataSeries: any[] = [];
    const tableItems: ExceedanceTableItem[] = [];
    let slNo = 1;

    headers.params.forEach((paramName) => {
      const configKey = headerMap[paramName];
      if (configKey === "CO3" || configKey === "HCO3" || configKey === "Na" || configKey === "K") return;
      const config = PARAM_CONFIG[configKey];
      if (!config) return;

      const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
      let validSamples = 0;
      let exceedSamples = 0;

      filtered.forEach((row) => {
        const v = parseFloat(row[paramName]);
        if (isNaN(v)) return;
        validSamples++;

        if (configKey === "pH") {
          if (v < config.b1 || v > config.b2) exceedSamples++;
        } else if (isSingleLimit) {
          if (v > config.b1) exceedSamples++;
        } else {
          if (v > config.b2) exceedSamples++; // Compares against Permissible limit limit (b2)
        }
      });

      if (validSamples > 0) {
        const pct = (exceedSamples / validSamples) * 100;
        
        if (pct >= threshold) {
          categories.push(paramName);
          
          dataSeries.push({
            y: parseFloat(pct.toFixed(decimals)),
            samples: exceedSamples,
            total: validSamples,
          });

          let limitStr = "";
          if (configKey === "pH") {
            limitStr = `< ${config.b1} or > ${config.b2}`;
          } else if (isSingleLimit) {
            limitStr = `> ${config.b1} ${config.unit}`;
          } else {
            limitStr = `> ${config.b2} ${config.unit}`;
          }

          tableItems.push({
            slNo: slNo++,
            paramName,
            limitStr,
            totalSamples: validSamples,
            exceedPct: pct.toFixed(decimals),
          });
        }
      }
    });

    return { categories, dataSeries, tableItems };
  }, [rawData, headers, headerMap, selectedState, selectedDistrict, threshold, decimals]);

  const { categories, dataSeries, tableItems } = computedData;

  // Render Highcharts chart when container mounts or data changes
  useEffect(() => {
    if (categories.length === 0) return;

    const timer = setTimeout(() => {
      const container = document.getElementById("bar-chart-container");
      if (container) {
        Highcharts.chart("bar-chart-container", {
          chart: {
            type: "column",
            backgroundColor: "transparent",
          },
          title: { text: null },
          xAxis: {
            categories: categories,
            labels: { style: { fontWeight: "bold", color: "#475569" } },
            title: { text: "Water Quality Parameters", style: { fontWeight: "bold", color: "#1e293b" } },
          },
          yAxis: {
            title: { text: "% of Samples Beyond Permissible Limit", style: { fontWeight: "bold", color: "#1e293b" } },
            max: yAxisMax,
            gridLineColor: "#e2e8f0",
          },
          tooltip: {
            headerFormat: '<span style="font-size: 10px">{point.key}</span><br/>',
            pointFormat: `Exceedance ratio: <b>{point.y:.${decimals}f}%</b><br/>({point.samples} out of {point.total} samples failed)`,
          },
          plotOptions: {
            column: {
              colorByPoint: true,
              borderRadius: 6,
              dataLabels: {
                enabled: true,
                format: `{point.y:.${decimals}f}%`,
                style: { fontSize: "10.5px", color: "#1e293b", textOutline: "none" },
                crop: false,
                overflow: "allow",
              },
            },
          },
          series: [{ name: "Exceedance %", type: "column", data: dataSeries, showInLegend: false }],
          credits: { enabled: false },
        });
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [categories, dataSeries, yAxisMax, decimals]);

  return (
    <div className="space-y-6">
      <div className="glossy-panel p-6 rounded-3xl">
        
        {/* Title Heading */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-slate-100 pb-4">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2 drop-shadow-sm">
            <BarChart3 className="w-5 h-5 text-indigo-500" />
            Parameter Exceedance Comparison (% Above Permissible Limit)
          </h3>
        </div>

        {/* Custom filters panel range slider layout */}
        <div className="bg-white/40 shadow-inner p-6 rounded-2xl mb-6 grid grid-cols-1 md:grid-cols-3 gap-6 border border-white/60 backdrop-blur-sm">
          
          {/* Threshold exceedance */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block drop-shadow-sm">
              1. Filter by Minimum Exceedance:
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="100"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)}
                className="flex-1 w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-650"
              />
              <div className="bg-white border border-slate-200 px-4 py-1.5 rounded-xl min-w-[70px] text-center font-black text-xs text-indigo-650 shadow-inner">
                {threshold}%
              </div>
            </div>
          </div>

          {/* Y Axis scale maximum */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block drop-shadow-sm">
              2. Set Chart Y-Axis Scale (Max %):
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="10"
                max="100"
                step="10"
                value={yAxisMax}
                onChange={(e) => setYAxisMax(parseInt(e.target.value) || 100)}
                className="flex-1 w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
              />
              <div className="bg-white border border-slate-200 px-4 py-1.5 rounded-xl min-w-[70px] text-center font-black text-xs text-emerald-600 shadow-inner">
                {yAxisMax}%
              </div>
            </div>
          </div>

          {/* Decimal places precision */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block drop-shadow-sm">
              3. Decimal Places:
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="4"
                step="1"
                value={decimals}
                onChange={(e) => setDecimals(parseInt(e.target.value) || 0)}
                className="flex-1 w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="bg-white border border-slate-200 px-4 py-1.5 rounded-xl min-w-[70px] text-center font-black text-xs text-amber-600 shadow-inner">
                {decimals}
              </div>
            </div>
          </div>

        </div>

        {/* Visual column charts or empty placeholders */}
        {rawData.length === 0 ? (
          <div className="h-[500px] flex items-center justify-center text-slate-400 font-bold uppercase tracking-widest border-2 border-dashed border-slate-200 rounded-2xl bg-white/20 p-12 text-center select-none pointer-events-none">
            <div className="flex flex-col items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 text-amber-500 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              <span>Waiting for groundwater spreadsheet data upload</span>
            </div>
          </div>
        ) : categories.length === 0 ? (
          <div className="h-[500px] flex items-center justify-center text-slate-400 font-bold uppercase tracking-widest border-2 border-dashed border-slate-200 rounded-2xl bg-white/20 p-12 text-center">
            No parameters meet the specified minimum exceedance threshold ({threshold}%)
          </div>
        ) : (
          <div id="bar-chart-container" className="w-full h-[500px] z-10" />
        )}

        {/* Table summary of fail details */}
        <div className="mt-8 overflow-x-auto custom-scrollbar border border-slate-200 rounded-2xl bg-white shadow-xs">
          <table className="w-full text-left text-xs bg-white">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-4 font-black text-slate-500 uppercase tracking-tighter w-16 text-center border-r border-slate-100">Sl. No.</th>
                <th className="p-4 font-black text-slate-500 uppercase tracking-tighter">Parameter Header</th>
                <th className="p-4 font-black text-slate-500 uppercase tracking-tighter">Failure Criteria (Permissible Limit)</th>
                <th className="p-4 font-black text-slate-500 uppercase tracking-tighter text-center">Total Valid Samples</th>
                <th className="p-4 font-black text-rose-600 uppercase tracking-tighter text-center bg-rose-50/40">Exceedance Percentage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {tableItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-400 font-bold uppercase tracking-wider bg-white">
                    No data uploaded yet. Please upload a spreadsheet to view comparative exceedance stats.
                  </td>
                </tr>
              ) : (
                tableItems.map((row) => (
                  <tr key={row.slNo} className="hover:bg-slate-50 font-medium text-slate-700 transition-colors">
                    <td className="p-4 text-center font-bold text-slate-400 border-r border-slate-100">{row.slNo}</td>
                    <td className="p-4 font-black text-slate-800 border-r border-slate-100">{row.paramName}</td>
                    <td className="p-4 border-r border-slate-100 font-bold text-indigo-700">{row.limitStr}</td>
                    <td className="p-4 text-center border-r border-slate-100 font-bold">{row.totalSamples}</td>
                    <td className="p-4 text-center font-black text-sm text-rose-600 bg-rose-50/10">
                      {row.exceedPct}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}

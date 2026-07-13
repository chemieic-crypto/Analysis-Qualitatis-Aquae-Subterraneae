import React, { useState, useEffect } from "react";
import Highcharts from "highcharts";
import { DataHeaders } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { ChevronDown, Filter, LayoutDashboard } from "lucide-react";

interface MultiDashboardProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState: string;
  selectedDistrict: string;
  reportingLevel: "State" | "District" | "Block";
}

export default function MultiDashboard({
  rawData,
  headers,
  headerMap,
  selectedState,
  selectedDistrict,
}: MultiDashboardProps) {
  const [selectedDashboardParams, setSelectedDashboardParams] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const availableDashboardParams = React.useMemo(() => {
    if (!headers || !headers.params) return [];
    return headers.params.filter(p => {
      const paramId = headerMap[p] || p;
      return !["Na", "K", "HCO3", "CO3"].includes(paramId);
    });
  }, [headers, headerMap]);

  // Initialize selected parameters only when headers load
  useEffect(() => {
    if (availableDashboardParams.length > 0) {
      setSelectedDashboardParams([...availableDashboardParams]);
    }
  }, [availableDashboardParams]);

  // Redraw Highcharts micro pies side-by-side whenever inputs change
  useEffect(() => {
    if (!rawData.length || selectedDashboardParams.length === 0) return;

    // Filter raw data
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

    selectedDashboardParams.forEach((paramName, idx) => {
      const configKey = headerMap[paramName];
      const config = PARAM_CONFIG[configKey];
      if (!config) return;

      const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
      
      let tAcc = 0;
      let tPerm = 0;
      let tFail = 0;
      let validSamples = 0;

      filtered.forEach((row) => {
        const v = parseFloat(row[paramName]);
        if (isNaN(v)) return;
        validSamples++;

        if (configKey === "pH") {
          if (v >= config.b1 && v <= config.b2) tAcc++;
          else tFail++;
        } else if (isSingleLimit) {
          if (v <= config.b1) tAcc++;
          else tFail++;
        } else {
          if (v <= config.b1) tAcc++;
          else if (v <= config.b2) tPerm++;
          else tFail++;
        }
      });

      const containerId = `multi-chart-card-${idx}`;
      const chartData = [
        { name: "Acceptable", y: tAcc, color: "#10b981" },
        ...(isSingleLimit || configKey === "pH" ? [] : [{ name: "Permissible", y: tPerm, color: "#f59e0b" }]),
        { name: "Above Limit", y: tFail, color: "#f43f5e" },
      ].filter((p) => p.y > 0);

      // Only draw if container is rendered and valid measurements exist
      if (document.getElementById(containerId) && validSamples > 0) {
        Highcharts.chart(containerId, {
          chart: {
            type: "pie",
            options3d: { enabled: true, alpha: 45, beta: 0 },
            backgroundColor: "transparent",
            margin: [0, 0, 0, 0],
            spacing: [0, 0, 0, 0],
          },
          title: { text: null },
          tooltip: {
            pointFormat: "<b>{point.y} samples</b> ({point.percentage:.1f}%)",
          },
          plotOptions: {
            pie: {
              innerSize: "40%",
              depth: 30,
              dataLabels: {
                enabled: true,
                format: "{point.percentage:.1f}%",
                style: { fontSize: "9px", color: "#475569", textOutline: "none" },
                distance: 8,
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
        });
      }
    });
  }, [rawData, selectedState, selectedDistrict, selectedDashboardParams, headerMap]);

  const handleSelectAll = () => {
    if (selectedDashboardParams.length === availableDashboardParams.length) {
      setSelectedDashboardParams([]);
    } else {
      setSelectedDashboardParams([...availableDashboardParams]);
    }
  };

  const handleToggleParam = (val: string) => {
    if (selectedDashboardParams.includes(val)) {
      setSelectedDashboardParams(selectedDashboardParams.filter((p) => p !== val));
    } else {
      setSelectedDashboardParams([...selectedDashboardParams, val]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glossy-panel glossy-panel-dropdown p-6 rounded-3xl relative z-40">
        
        {/* Header toolbar with dropdown parameter filters */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-slate-100 pb-4">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2 drop-shadow-sm">
            <LayoutDashboard className="w-5 h-5 text-indigo-500" />
            All Parameters Overview
          </h3>
          
          <div className="relative min-w-[260px] w-full md:w-auto">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 flex justify-between items-center text-left bg-white text-xs select-none"
            >
              <span className="truncate flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-600">
                <Filter className="w-3.5 h-3.5" />
                {selectedDashboardParams.length === availableDashboardParams.length
                  ? "All Parameters Selected"
                  : `${selectedDashboardParams.length}/${availableDashboardParams.length} Selected`}
              </span>
              <ChevronDown className="w-4 h-4 text-slate-500 ml-1.5" />
            </button>
            
            {dropdownOpen && (
              <div className="absolute top-full right-0 w-64 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl z-[120] max-h-60 overflow-y-auto custom-scrollbar p-2">
                <label className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-100 font-bold text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedDashboardParams.length === availableDashboardParams.length}
                    onChange={handleSelectAll}
                    className="rounded text-indigo-600 w-4 h-4"
                  />
                  <span>Select All</span>
                </label>
                {availableDashboardParams.map((val) => (
                  <label key={val} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={selectedDashboardParams.includes(val)}
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

        {/* Dynamic micro chart cards rendering grid */}
        {selectedDashboardParams.length === 0 ? (
          <div className="p-12 text-center text-slate-400 font-bold uppercase border-2 border-dashed border-slate-200 rounded-2xl">
            No parameters selected
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {selectedDashboardParams.map((paramName, idx) => {
              const configKey = headerMap[paramName];
              const config = PARAM_CONFIG[configKey];
              if (!config) return null;

              const isSingle = config.b1 === config.b2 && configKey !== "pH";
              
              // Count total samples for card description help
              let total = 0;
              rawData.forEach((row) => {
                if (!isNaN(parseFloat(row[paramName]))) total++;
              });

              if (total === 0) return null;

              let limitationMessage = "";
              if (configKey === "pH") {
                limitationMessage = `pH limits: ${config.b1} - ${config.b2}`;
              } else if (isSingle) {
                limitationMessage = `Limit: ≤ ${config.b1} ${config.unit}`;
              } else {
                limitationMessage = `Acc: ≤ ${config.b1} | Perm: ≤ ${config.b2} ${config.unit}`;
              }

              return (
                <div
                  key={idx}
                  className="glossy-panel p-5 rounded-3xl flex flex-col items-center hover:shadow-xl transition-all duration-300 bg-white"
                >
                  <div className="text-sm font-black text-slate-800 mb-1 text-center flex items-center gap-1.5 justify-center flex-wrap">
                    {paramName}
                    <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md text-[10px] font-bold">
                      ({total} samples)
                    </span>
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 mb-4 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200/50 text-center select-none w-full truncate">
                    {limitationMessage}
                  </div>
                  <div id={`multi-chart-card-${idx}`} className="w-full h-52 shrink-0 z-10" />
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}

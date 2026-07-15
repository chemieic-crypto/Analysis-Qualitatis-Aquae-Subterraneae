import React, { useState, useEffect, useRef } from "react";
import Highcharts from "highcharts";
import { DataHeaders, GroupedStatRow } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { getStats } from "../utils/math";
import { buildDonutChartOptions, generateOfflineChartBase64 } from "../utils/chartHelpers";
import { Settings2, Image, ChevronDown, Check, Circle, Maximize2, Send, X } from "lucide-react";

function toTableHeaderUnit(unit: string): string {
  let u = unit.toUpperCase();
  u = u.replace(/µS\/CM/g, "MS/CM").replace(/US\/CM/g, "MS/CM");
  return u;
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
}

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
}: DetailedViewProps) {
  // Chart Customization State
  const [chartTitle, setChartTitle] = useState("");
  const [chartTheme, setChartTheme] = useState("theme-white");
  const [fontFamily, setFontFamily] = useState("'Plus Jakarta Sans'");
  const [fontSize, setFontSize] = useState(12);
  const [fontBold, setFontBold] = useState(true);
  const [colorAcc, setColorAcc] = useState("#10b981");

  // Filter out Na, K, HCO3, CO3 from detailed views (parameters without BIS limits)
  const availableParams = React.useMemo(() => {
    if (!headers || !headers.params) return [];
    return headers.params.filter(p => {
      const paramId = headerMap[p] || p;
      return !["Na", "K", "HCO3", "CO3"].includes(paramId);
    });
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
  const activeConfig = PARAM_CONFIG[activeConfigKey] || PARAM_CONFIG[activeParam];

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

      let val = NaN;
      if (activeParam === "SAR" || activeParam === "RSC") {
        const caCol = Object.keys(headerMap).find(k => headerMap[k] === "Ca") || "Ca";
        const mgCol = Object.keys(headerMap).find(k => headerMap[k] === "Mg") || "Mg";
        const naCol = Object.keys(headerMap).find(k => headerMap[k] === "Na") || "Na";
        const hco3Col = Object.keys(headerMap).find(k => headerMap[k] === "HCO3") || "HCO3";
        const co3Col = Object.keys(headerMap).find(k => headerMap[k] === "CO3") || "CO3";

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

        if (!isNaN(caVal) && !isNaN(mgVal) && !isNaN(naVal)) {
          if (activeParam === "SAR") {
            const denom = Math.sqrt((caMeq + mgMeq) / 2);
            if (denom > 0) val = naMeq / denom;
          } else {
            val = (hco3Meq + co3Meq) - (caMeq + mgMeq);
          }
        }
      } else {
        val = parseFloat(row[activeParam]);
      }

      if (!isNaN(val)) {
        allNumericVals.push(val);
        // Categorize globally
        if (activeParam === "SAR") {
          if (val <= 10) globalSarS1++;
          else if (val <= 18) globalSarS2++;
          else if (val < 26) globalSarS3++;
          else globalSarS4++;
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

    // 4. Calculate stats per group
    const rows: GroupedStatRow[] = Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([gName, data]) => {
        const vals = data.samples
          .map((row) => {
            if (activeParam === "SAR" || activeParam === "RSC") {
              const caCol = Object.keys(headerMap).find(k => headerMap[k] === "Ca") || "Ca";
              const mgCol = Object.keys(headerMap).find(k => headerMap[k] === "Mg") || "Mg";
              const naCol = Object.keys(headerMap).find(k => headerMap[k] === "Na") || "Na";
              const hco3Col = Object.keys(headerMap).find(k => headerMap[k] === "HCO3") || "HCO3";
              const co3Col = Object.keys(headerMap).find(k => headerMap[k] === "CO3") || "CO3";

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

              if (!isNaN(caVal) && !isNaN(mgVal) && !isNaN(naVal)) {
                if (activeParam === "SAR") {
                  const denom = Math.sqrt((caMeq + mgMeq) / 2);
                  return denom > 0 ? naMeq / denom : NaN;
                } else {
                  return (hco3Meq + co3Meq) - (caMeq + mgMeq);
                }
              }
              return NaN;
            } else {
              return parseFloat(row[activeParam]);
            }
          })
          .filter((v) => !isNaN(v));
        
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
          name: gName,
          state: data.state,
          district: data.district,
          block: data.block,
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
        };
      });

    setTableRows(rows);

    // 5. Calculate grand total row
    if (allNumericVals.length > 0) {
      const grandStats = getStats(allNumericVals);
      const totalCount = allNumericVals.length;

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
  const safeCount = grandTotalRow ? grandTotalRow.nAcc : 0;
  const limitsCheckAndUnits = activeConfigKey === "pH" 
    ? `${activeConfig.b1} - ${activeConfig.b2}` 
    : `≤ ${activeConfig.b2} ${activeConfig.unit}`;

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
            {/* Custom chart title */}
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                Custom Chart Title
              </label>
              <input
                type="text"
                placeholder="e.g. EC compliance..."
                value={chartTitle}
                onChange={(e) => setChartTitle(e.target.value)}
                className="w-full glossy-input rounded-xl p-2.5 text-sm font-bold text-slate-700 placeholder:text-slate-400"
              />
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
            {availableParams.map((p, idx) => (
              <option key={idx} value={p}>{p}</option>
            ))}
            <option value="SAR">Sodium Adsorption Ratio (SAR)</option>
            <option value="RSC">Residual Sodium Carbonate (RSC)</option>
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

      {/* Primary detail table mapping columns */}
      <div className="glossy-panel rounded-3xl overflow-hidden shadow-md">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-xs">
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
                    <td className="p-4 sticky left-0 bg-white border-r text-slate-400 font-bold z-10">{idx + 1}</td>
                    
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
                  <td className="p-4 text-center font-black text-indigo-300 font-mono text-xs">{grandTotalRow.avg.toFixed(2)}</td>
                  <td className="p-4 text-center text-slate-400 font-mono text-xs">{grandTotalRow.std.toFixed(2)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

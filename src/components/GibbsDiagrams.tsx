import React, { useState, useMemo, useRef } from "react";
import { ProcessedSample } from "../utils/usslMath";
import UsslLabelsEditor, { LabelConfig } from "./UsslLabelsEditor";
import { sanitizeColorsForHtml2canvas, safeHtml2canvas } from "../utils/colorSanitizer";

function darkenColor(hex: string, percent = 30): string {
  if (!hex || hex.length < 6) return "#1e293b";
  let cleanHex = hex.replace("#", "");
  if (cleanHex.length === 3) {
    cleanHex = cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2];
  }
  const num = parseInt(cleanHex, 16);
  let r = (num >> 16);
  let g = ((num >> 8) & 0x00FF);
  let b = (num & 0x0000FF);

  r = Math.max(0, Math.min(255, Math.round(r * (1 - percent / 100))));
  g = Math.max(0, Math.min(255, Math.round(g * (1 - percent / 100))));
  b = Math.max(0, Math.min(255, Math.round(b * (1 - percent / 100))));

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

interface GibbsPlotProps {
  data: ProcessedSample[];
  type: "cation" | "anion";
  defaultTitle: string;
  pointColors: Record<string, string>;
  pointSizes: Record<string, number>;
  getPointKey: (d: ProcessedSample) => string;
  stateHeader: string;
  is3d?: boolean;
  bubbleSizeMultiplier?: number;
}

export const GibbsPlot = React.memo(({
  data,
  type,
  defaultTitle,
  pointColors,
  pointSizes,
  getPointKey,
  stateHeader,
  is3d = false,
  bubbleSizeMultiplier = 1,
}: GibbsPlotProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const margin = { top: 50, right: 30, bottom: 50, left: 60 };
  const width = 350;
  const height = 400;

  // Systematic Downsampling to prevent UI hanging under large datasets
  const maxSafePoints = 1200;
  const isDownsampled = data.length > maxSafePoints;
  const displayData = useMemo(() => {
    if (!isDownsampled) return data;
    const step = Math.ceil(data.length / maxSafePoints);
    return data.filter((_, idx) => idx % step === 0);
  }, [data, isDownsampled]);

  const [labelsConfig, setLabelsConfig] = useState({
    title: { text: defaultTitle, size: 14, color: "#64748b", isBold: true, isItalic: false },
    xAxis: {
      text: type === "cation" ? "Na+ / (Na+ + Ca2+)" : "Cl- / (Cl- + HCO3-)",
      size: 11,
      color: "#64748b",
      isBold: true,
      isItalic: false,
    },
    yAxis: { text: "TDS (mg/L)", size: 12, color: "#64748b", isBold: true, isItalic: false },
  });

  React.useEffect(() => {
    if (defaultTitle) {
      setLabelsConfig(prev => ({
        ...prev,
        title: { ...prev.title, text: defaultTitle }
      }));
    }
  }, [defaultTitle]);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [title3dEffect, setTitle3dEffect] = useState<"none" | "emboss" | "deboss">("emboss");

  const getX = (val: number) => margin.left + val * (width - margin.left - margin.right);
  const getY = (val: number) => {
    const logMin = 1;
    const logMax = 4.5; // Log10 of ~31620 mg/L
    const logVal = Math.log10(Math.max(1, val));
    const normalized = (logVal - logMin) / (logMax - logMin);
    return height - margin.bottom - normalized * (height - margin.bottom - margin.top);
  };

  const polygonFill = "black";
  const polygonStroke = "#00000015";
  const axisColor = "#94a3b8";

  // Crop states
  const [isCropActive, setIsCropActive] = useState<boolean>(false);
  const [cropBox, setCropBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 40,
    y: 80,
    width: 270,
    height: 320,
  });

  const cropDraggingRef = useRef<{
    mode: "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
    startX: number;
    startY: number;
    startBox: { x: number; y: number; width: number; height: number };
  } | null>(null);

  const handleCropDragStart = (e: React.MouseEvent | React.TouchEvent, mode: "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w") => {
    e.stopPropagation();
    let clientX = 0;
    let clientY = 0;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    cropDraggingRef.current = {
      mode,
      startX: clientX,
      startY: clientY,
      startBox: { ...cropBox },
    };

    const onMove = (moveEvt: MouseEvent | TouchEvent) => {
      if (!cropDraggingRef.current) return;
      const drag = cropDraggingRef.current;
      
      let curX = 0;
      let curY = 0;
      if ("touches" in moveEvt) {
        curX = moveEvt.touches[0].clientX;
        curY = moveEvt.touches[0].clientY;
      } else {
        curX = moveEvt.clientX;
        curY = moveEvt.clientY;
      }

      const dx = curX - drag.startX;
      const dy = curY - drag.startY;

      setCropBox((prev) => {
        let { x, y, width, height } = drag.startBox;
        const minSize = 50;

        if (drag.mode === "move") {
          x = x + dx;
          y = y + dy;
        } else {
          if (drag.mode.includes("n")) {
            const potentialY = y + dy;
            const potentialHeight = height - dy;
            if (potentialHeight >= minSize) {
              y = potentialY;
              height = potentialHeight;
            }
          }
          if (drag.mode.includes("s")) {
            const potentialHeight = height + dy;
            if (potentialHeight >= minSize) {
              height = potentialHeight;
            }
          }
          if (drag.mode.includes("e")) {
            const potentialWidth = width + dx;
            if (potentialWidth >= minSize) {
              width = potentialWidth;
            }
          }
          if (drag.mode.includes("w")) {
            const potentialX = x + dx;
            const potentialWidth = width - dx;
            if (potentialWidth >= minSize) {
              x = potentialX;
              width = potentialWidth;
            }
          }
        }

        return { x, y, width, height };
      });
    };

    const onEnd = () => {
      cropDraggingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchend", onEnd);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchend", onEnd);
  };

  const exportId = `gibbs-${type}`;

  const downloadChartHD = async (elementId: string, filename: string) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    try {
      const canvas = await safeHtml2canvas(el, {
        scale: 3,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
        onclone: (clonedDoc) => {
          sanitizeColorsForHtml2canvas(clonedDoc);
          const cropOverlay = clonedDoc.getElementById("draggable-crop-box");
          if (cropOverlay) {
            cropOverlay.remove();
          }
        },
      });

      let finalCanvas = canvas;
      if (isCropActive) {
        const rect = el.getBoundingClientRect();
        const scaleX = canvas.width / (rect.width || el.offsetWidth || 1);
        const scaleY = canvas.height / (rect.height || el.offsetHeight || 1);

        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = cropBox.width * scaleX;
        cropCanvas.height = cropBox.height * scaleY;
        const cropCtx = cropCanvas.getContext("2d");
        if (cropCtx) {
          cropCtx.drawImage(
            canvas,
            cropBox.x * scaleX,
            cropBox.y * scaleY,
            cropBox.width * scaleX,
            cropBox.height * scaleY,
            0,
            0,
            cropBox.width * scaleX,
            cropBox.height * scaleY
          );
          finalCanvas = cropCanvas;
        }
      }

      const link = document.createElement("a");
      link.download = `${filename}_${Date.now()}.jpeg`;
      link.href = finalCanvas.toDataURL("image/jpeg", 1.0);
      link.click();
    } catch (err) {
      console.error("HD Download failed", err);
    }
  };

  const renderedPoints = useMemo(() => {
    return displayData.map((d, i) => {
      const hasValidPoint = type === "cation" ? (d._calc.hasGibbsCation ?? d._calc.hasGibbs) : (d._calc.hasGibbsAnion ?? d._calc.hasGibbs);
      if (!hasValidPoint) return null;

      const key = getPointKey(d);
      const color = pointColors[key] || "#3b82f6";
      let radius = pointSizes ? pointSizes[key] || 1.3 : 1.3;
      if (is3d) {
        radius *= bubbleSizeMultiplier;
      }
      const stateStr = stateHeader ? d[stateHeader] : d.State || d.STATE;
      const xVal = type === "cation" ? d._calc.gibbsCation : d._calc.gibbsAnion;
      const yVal = d._calc.tds;

      if (isNaN(xVal) || isNaN(yVal) || yVal <= 0) return null;

      const bubbleId = `bubble-${String(color).replace(/#/g, "")}`;
      const fillValue = is3d ? `url(#${bubbleId})` : color;

      return (
        <circle
          key={i}
          cx={getX(xVal)}
          cy={getY(yVal)}
          r={radius}
          fill={fillValue}
          fillOpacity="0.95"
          stroke={is3d ? "rgba(255,255,255,0.4)" : "none"}
          strokeWidth={is3d ? 0.2 : 0}
          className="cursor-pointer hover:opacity-80 transition-all duration-300"
          title={`${d._calc.locName}\nTDS: ${yVal.toFixed(1)}\nRatio: ${xVal.toFixed(2)}` + (stateStr ? `\nState: ${stateStr}` : "")}
        />
      );
    });
  }, [displayData, pointColors, pointSizes, getPointKey, stateHeader, type, is3d, bubbleSizeMultiplier]);

  return (
    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 flex flex-col items-center shadow-lg transition-colors duration-300 relative group">
      <div className="absolute top-4 right-4 opacity-80 group-hover:opacity-100 transition-opacity z-10 flex gap-2">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg px-1.5 py-0.5 border border-slate-200 shadow-sm">
          <span className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider pl-0.5">Title 3D:</span>
          <select
            value={title3dEffect}
            onChange={(e) => setTitle3dEffect(e.target.value as any)}
            className="text-[9px] font-bold bg-white text-slate-700 border border-slate-200 rounded px-1 py-0 focus:outline-none cursor-pointer"
          >
            <option value="none">None</option>
            <option value="emboss">Bevel & Emboss</option>
            <option value="deboss">Deboss</option>
          </select>
        </div>
        <button
          onClick={() => setIsCropActive(!isCropActive)}
          className={`p-1 bg-white/80 rounded-lg shadow-sm border-b-4 active:border-b-0 active:translate-y-1 transition-all ${
            isCropActive
              ? "bg-amber-500 text-white border-amber-600 hover:bg-amber-600"
              : "text-slate-400 hover:text-amber-800 border-slate-200 hover:border-amber-300 hover:bg-amber-50"
          }`}
          title="Select Crop Area for JPEG export"
        >
          <i className="ph ph-crop text-lg"></i>
        </button>
        <button
          onClick={() => downloadChartHD(exportId, `Gibbs_${type}`)}
          className="text-slate-400 hover:text-slate-600 p-1 bg-white/80 rounded-lg shadow-sm border-b-4 border-slate-200 hover:border-slate-500 active:border-b-0 active:translate-y-1 transition-all"
          title="Download HD JPEG"
        >
          <i className="ph ph-camera text-lg"></i>
        </button>
        <button
          onClick={() => setIsFullscreen(true)}
          className="text-slate-400 hover:text-slate-600 p-1 bg-white/80 rounded-lg shadow-sm border-b-4 border-slate-200 hover:border-indigo-500 active:border-b-0 active:translate-y-1 transition-all"
          title="Full Screen View"
        >
          <i className="ph ph-corners-out text-lg"></i>
        </button>
      </div>

      {editingKey && labelsConfig[editingKey as keyof typeof labelsConfig] && (
        <UsslLabelsEditor
          config={labelsConfig[editingKey as keyof typeof labelsConfig]}
          onChange={(newConf) => setLabelsConfig((p) => ({ ...p, [editingKey]: newConf }))}
          onClose={() => setEditingKey(null)}
        />
      )}

      <div id={exportId} className="flex flex-col items-center justify-center bg-white p-0 w-full rounded-2xl relative">
        {/* Draggable/Resizable Crop Box overlay */}
        {isCropActive && (
          <div
            id="draggable-crop-box"
            className="absolute z-[1500] border-4 border-dashed border-amber-500 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] pointer-events-auto cursor-move select-none"
            style={{
              left: `${cropBox.x}px`,
              top: `${cropBox.y}px`,
              width: `${cropBox.width}px`,
              height: `${cropBox.height}px`,
            }}
            onMouseDown={(e) => handleCropDragStart(e, "move")}
            onTouchStart={(e) => handleCropDragStart(e, "move")}
          >
            {/* Corner Resizing Handles */}
            <div
              className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-amber-500 border border-white rounded-full cursor-nwse-resize z-[1510]"
              onMouseDown={(e) => { e.stopPropagation(); handleCropDragStart(e, "nw"); }}
              onTouchStart={(e) => { e.stopPropagation(); handleCropDragStart(e, "nw"); }}
            />
            <div
              className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-amber-500 border border-white rounded-full cursor-nesw-resize z-[1510]"
              onMouseDown={(e) => { e.stopPropagation(); handleCropDragStart(e, "ne"); }}
              onTouchStart={(e) => { e.stopPropagation(); handleCropDragStart(e, "ne"); }}
            />
            <div
              className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-amber-500 border border-white rounded-full cursor-nesw-resize z-[1510]"
              onMouseDown={(e) => { e.stopPropagation(); handleCropDragStart(e, "sw"); }}
              onTouchStart={(e) => { e.stopPropagation(); handleCropDragStart(e, "sw"); }}
            />
            <div
              className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-amber-500 border border-white rounded-full cursor-nwse-resize z-[1510]"
              onMouseDown={(e) => { e.stopPropagation(); handleCropDragStart(e, "se"); }}
              onTouchStart={(e) => { e.stopPropagation(); handleCropDragStart(e, "se"); }}
            />
            
            {/* Crop Box Label Overlay */}
            <div className="absolute top-2 left-2 bg-amber-500 text-white font-bold text-[9px] px-1.5 py-0.5 rounded shadow uppercase tracking-wider">
              Crop Area: {Math.round(cropBox.width)} × {Math.round(cropBox.height)}
            </div>
          </div>
        )}
        <div className="flex flex-col items-center justify-center p-4 w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto max-w-[550px] overflow-visible"
          style={{ fontFamily: "'Inter', sans-serif" }}
          onClick={() => setEditingKey(null)}
        >
          <defs>
            <filter id="3d-emboss" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="blur" />
              <feSpecularLighting in="blur" surfaceScale="2" specularConstant="1.2" specularExponent="16" lightingColor="#ffffff" result="spec">
                <feDistantLight azimuth="225" elevation="45" />
              </feSpecularLighting>
              <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut" />
              <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />
            </filter>
            <filter id="3d-deboss" x="-20%" y="-20%" width="140%" height="140%">
              <feOffset dx="0.5" dy="0.5" />
              <feGaussianBlur stdDeviation="0.5" result="offset-blur" />
              <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse" />
              <feFlood floodColor="#000000" floodOpacity="0.7" result="color" />
              <feComposite operator="in" in="color" in2="inverse" result="shadow" />
              <feComposite operator="over" in="shadow" in2="SourceGraphic" />
            </filter>

            {is3d && (
              <>
                {Array.from(new Set(Object.values(pointColors || {})))
                  .filter((c): c is string => typeof c === "string" && !!c)
                  .map((color) => {
                    const id = `bubble-${color.replace(/#/g, "")}`;
                    const darker = darkenColor(color, 35);
                    return (
                      <radialGradient key={color} id={id} cx="35%" cy="35%" r="70%" fx="35%" fy="35%">
                        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                        <stop offset="25%" stopColor={color} stopOpacity="0.95" />
                        <stop offset="85%" stopColor={darker} stopOpacity="1" />
                        <stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
                      </radialGradient>
                    );
                  })}
              </>
            )}
          </defs>

          <text
            x={width / 2}
            y={25}
            textAnchor="middle"
            fontSize={labelsConfig.title.size}
            fill={labelsConfig.title.color}
            fontWeight={labelsConfig.title.isBold ? "900" : "400"}
            fontStyle={labelsConfig.title.isItalic ? "italic" : "normal"}
            fontFamily={labelsConfig.title.fontFamily || "sans-serif"}
            style={{ cursor: "pointer", letterSpacing: "0.1em" }}
            filter={title3dEffect === "emboss" ? "url(#3d-emboss)" : title3dEffect === "deboss" ? "url(#3d-deboss)" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setEditingKey("title");
            }}
          >
            {labelsConfig.title.text}
          </text>

          <text
            transform={`translate(20, ${height / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={labelsConfig.yAxis.size}
            fill={labelsConfig.yAxis.color}
            fontWeight={labelsConfig.yAxis.isBold ? "900" : "400"}
            fontStyle={labelsConfig.yAxis.isItalic ? "italic" : "normal"}
            fontFamily={labelsConfig.yAxis.fontFamily || "sans-serif"}
            style={{ cursor: "pointer", letterSpacing: "0.1em" }}
            onClick={(e) => {
              e.stopPropagation();
              setEditingKey("yAxis");
            }}
          >
            {labelsConfig.yAxis.text}
          </text>

          <text
            x={width / 2}
            y={height - 10}
            textAnchor="middle"
            fontSize={labelsConfig.xAxis.size}
            fill={labelsConfig.xAxis.color}
            fontWeight={labelsConfig.xAxis.isBold ? "900" : "400"}
            fontStyle={labelsConfig.xAxis.isItalic ? "italic" : "normal"}
            fontFamily={labelsConfig.xAxis.fontFamily || "sans-serif"}
            style={{ cursor: "pointer", letterSpacing: "0.1em" }}
            onClick={(e) => {
              e.stopPropagation();
              setEditingKey("xAxis");
            }}
          >
            {labelsConfig.xAxis.text}
          </text>

          <path
            d={`M ${getX(0.1)} ${getY(5000)} L ${getX(0.9)} ${getY(10000)} L ${getX(0.9)} ${getY(1000)} L ${getX(0.1)} ${getY(10)} L ${getX(0.1)} ${getY(5000)}`}
            fill={polygonFill}
            fillOpacity="0.02"
            stroke={polygonStroke}
            strokeDasharray="4"
            strokeWidth="1.5"
          />

          <text x={getX(0.85)} y={getY(8000)} textAnchor="end" fontSize="9" fill="#64748b" fontWeight="bold" opacity="0.6">
            Evaporation
          </text>
          <text x={getX(0.5)} y={getY(500)} textAnchor="middle" fontSize="9" fill="#64748b" fontWeight="bold" opacity="0.6">
            Rock
          </text>
          <text x={getX(0.15)} y={getY(20)} textAnchor="start" fontSize="9" fill="#64748b" fontWeight="bold" opacity="0.6">
            Precipitation
          </text>

          <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} stroke={axisColor} strokeWidth="1.5" />
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} stroke={axisColor} strokeWidth="1.5" />

          {[10, 100, 1000, 10000].map((val) => (
            <g key={val}>
              <line x1={margin.left - 5} y1={getY(val)} x2={margin.left} y2={getY(val)} stroke={axisColor} />
              <text x={margin.left - 10} y={getY(val) + 3} textAnchor="end" fontSize="8" fill="#64748b" fontWeight="bold">
                {val}
              </text>
            </g>
          ))}

          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((val) => (
            <g key={val}>
              <line x1={getX(val)} y1={height - margin.bottom} x2={getX(val)} y2={height - margin.bottom + 5} stroke={axisColor} />
              <text x={getX(val)} y={height - margin.bottom + 15} textAnchor="middle" fontSize="8" fill="#64748b" fontWeight="bold">
                {val}
              </text>
            </g>
          ))}

          {renderedPoints}
        </svg>
        </div>
      </div>

      {/* Full Screen Modal View */}
      {isFullscreen && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 md:p-8">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-4xl max-h-[92vh] flex flex-col relative">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <i className="ph ph-corners-out text-lg text-indigo-600 animate-pulse"></i>
                  {labelsConfig.title.text} (Full Screen)
                </h3>
                <p className="text-[10px] text-slate-400 font-extrabold uppercase mt-0.5">
                  Full interactive explorer mode with high-resolution scaling
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => downloadChartHD(`${exportId}-fs`, `Gibbs_${type}_HD`)}
                  className="bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border-b-4 border-indigo-200 hover:border-indigo-800 active:border-b-0 active:translate-y-1"
                  title="Download HD JPEG"
                >
                  <i className="ph ph-camera text-lg"></i>
                  <span>Export HD</span>
                </button>
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="bg-slate-100 text-slate-600 hover:bg-rose-600 hover:text-white p-2 rounded-xl text-xs font-bold transition-all border-b-4 border-slate-200 hover:border-rose-800 active:border-b-0 active:translate-y-1"
                  title="Close Full Screen"
                >
                  <i className="ph ph-x text-lg font-bold"></i>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto flex items-center justify-center p-4 min-h-[400px]">
              <div id={`${exportId}-fs`} className="flex flex-col items-center justify-center p-6 w-full max-w-[450px] bg-white rounded-2xl relative">
                <svg
                  viewBox={`0 0 ${width} ${height}`}
                  className="w-full h-auto max-h-[60vh] overflow-visible"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  <defs>
                    <filter id="3d-emboss-fs" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="blur" />
                      <feSpecularLighting in="blur" surfaceScale="2" specularConstant="1.2" specularExponent="16" lightingColor="#ffffff" result="spec">
                        <feDistantLight azimuth="225" elevation="45" />
                      </feSpecularLighting>
                      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut" />
                      <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />
                    </filter>
                    <filter id="3d-deboss-fs" x="-20%" y="-20%" width="140%" height="140%">
                      <feOffset dx="0.5" dy="0.5" />
                      <feGaussianBlur stdDeviation="0.5" result="offset-blur" />
                      <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse" />
                      <feFlood floodColor="#000000" floodOpacity="0.7" result="color" />
                      <feComposite operator="in" in="color" in2="inverse" result="shadow" />
                      <feComposite operator="over" in="shadow" in2="SourceGraphic" />
                    </filter>

                    {is3d && (
                      <>
                        {Array.from(new Set(Object.values(pointColors || {})))
                          .filter((c): c is string => typeof c === "string" && !!c)
                          .map((color) => {
                            const id = `bubble-fs-${color.replace(/#/g, "")}`;
                            const darker = darkenColor(color, 35);
                            return (
                              <radialGradient key={color} id={id} cx="35%" cy="35%" r="70%" fx="35%" fy="35%">
                                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                                <stop offset="25%" stopColor={color} stopOpacity="0.95" />
                                <stop offset="85%" stopColor={darker} stopOpacity="1" />
                                <stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
                              </radialGradient>
                            );
                          })}
                      </>
                    )}
                  </defs>

                  <text
                    x={width / 2}
                    y={margin.top - 20}
                    textAnchor="middle"
                    fontSize={labelsConfig.title.size}
                    fill={labelsConfig.title.color}
                    fontWeight={labelsConfig.title.isBold ? "900" : "400"}
                    fontStyle={labelsConfig.title.isItalic ? "italic" : "normal"}
                    fontFamily={labelsConfig.title.fontFamily || "sans-serif"}
                    filter={title3dEffect === "emboss" ? "url(#3d-emboss-fs)" : title3dEffect === "deboss" ? "url(#3d-deboss-fs)" : undefined}
                  >
                    {labelsConfig.title.text}
                  </text>

                  <text
                    x={width / 2}
                    y={height - margin.bottom + 35}
                    textAnchor="middle"
                    fontSize={labelsConfig.xAxis.size}
                    fill={labelsConfig.xAxis.color}
                    fontWeight={labelsConfig.xAxis.isBold ? "900" : "400"}
                    fontStyle={labelsConfig.xAxis.isItalic ? "italic" : "normal"}
                    fontFamily={labelsConfig.xAxis.fontFamily || "sans-serif"}
                  >
                    {labelsConfig.xAxis.text}
                  </text>

                  <text
                    transform={`translate(${margin.left - 40}, ${height / 2}) rotate(-90)`}
                    textAnchor="middle"
                    fontSize={labelsConfig.yAxis.size}
                    fill={labelsConfig.yAxis.color}
                    fontWeight={labelsConfig.yAxis.isBold ? "900" : "400"}
                    fontStyle={labelsConfig.yAxis.isItalic ? "italic" : "normal"}
                    fontFamily={labelsConfig.yAxis.fontFamily || "sans-serif"}
                  >
                    {labelsConfig.yAxis.text}
                  </text>

                  {/* Envelope background polygons */}
                  {type === "cation" ? (
                    <>
                      <polygon points={`${getX(0.96)} ${getY(15000)} ${getX(0.7)} ${getY(1000)} ${getX(0.5)} ${getY(100)} ${getX(0.4)} ${getY(100)} ${getX(0.6)} ${getY(1000)} ${getX(0.99)} ${getY(15000)}`} fill={polygonFill} fillOpacity="0.05" stroke={polygonStroke} strokeWidth="1" />
                      <polygon points={`${getX(0.3)} ${getY(1000)} ${getX(0.5)} ${getY(250)} ${getX(0.5)} ${getY(70)} ${getX(0.35)} ${getY(70)} ${getX(0.35)} ${getY(250)} ${getX(0.18)} ${getY(1000)}`} fill={polygonFill} fillOpacity="0.05" stroke={polygonStroke} strokeWidth="1" />
                      <polygon points={`${getX(0.1)} ${getY(20)} ${getX(0.4)} ${getY(5)} ${getX(0.92)} ${getY(20)} ${getX(0.85)} ${getY(40)} ${getX(0.4)} ${getY(10)} ${getX(0.15)} ${getY(40)}`} fill={polygonFill} fillOpacity="0.05" stroke={polygonStroke} strokeWidth="1" />
                    </>
                  ) : (
                    <>
                      <polygon points={`${getX(0.98)} ${getY(15000)} ${getX(0.72)} ${getY(1000)} ${getX(0.45)} ${getY(100)} ${getX(0.35)} ${getY(100)} ${getX(0.6)} ${getY(1000)} ${getX(0.99)} ${getY(15000)}`} fill={polygonFill} fillOpacity="0.05" stroke={polygonStroke} strokeWidth="1" />
                      <polygon points={`${getX(0.28)} ${getY(1000)} ${getX(0.48)} ${getY(250)} ${getX(0.48)} ${getY(70)} ${getX(0.32)} ${getY(70)} ${getX(0.32)} ${getY(250)} ${getX(0.15)} ${getY(1000)}`} fill={polygonFill} fillOpacity="0.05" stroke={polygonStroke} strokeWidth="1" />
                      <polygon points={`${getX(0.08)} ${getY(20)} ${getX(0.38)} ${getY(5)} ${getX(0.9)} ${getY(20)} ${getX(0.82)} ${getY(40)} ${getX(0.38)} ${getY(10)} ${getX(0.12)} ${getY(40)}`} fill={polygonFill} fillOpacity="0.05" stroke={polygonStroke} strokeWidth="1" />
                    </>
                  )}

                  <text x={getX(0.85)} y={getY(5000)} textAnchor="middle" fontSize="9" fill="#64748b" fontWeight="bold" opacity="0.6">
                    Evaporation
                  </text>
                  <text x={getX(0.5)} y={getY(500)} textAnchor="middle" fontSize="9" fill="#64748b" fontWeight="bold" opacity="0.6">
                    Rock
                  </text>
                  <text x={getX(0.15)} y={getY(20)} textAnchor="start" fontSize="9" fill="#64748b" fontWeight="bold" opacity="0.6">
                    Precipitation
                  </text>

                  <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} stroke={axisColor} strokeWidth="1.5" />
                  <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} stroke={axisColor} strokeWidth="1.5" />

                  {[10, 100, 1000, 10000].map((val) => (
                    <g key={val}>
                      <line x1={margin.left - 5} y1={getY(val)} x2={margin.left} y2={getY(val)} stroke={axisColor} />
                      <text x={margin.left - 10} y={getY(val) + 3} textAnchor="end" fontSize="8" fill="#64748b" fontWeight="bold">
                        {val}
                      </text>
                    </g>
                  ))}

                  {[0, 0.2, 0.4, 0.6, 0.8, 1].map((val) => (
                    <g key={val}>
                      <line x1={getX(val)} y1={height - margin.bottom} x2={getX(val)} y2={height - margin.bottom + 5} stroke={axisColor} />
                      <text x={getX(val)} y={height - margin.bottom + 15} textAnchor="middle" fontSize="8" fill="#64748b" fontWeight="bold">
                        {val}
                      </text>
                    </g>
                  ))}

                  {renderedPoints.map((p: any) => {
                    if (is3d && p?.props?.fill && p.props.fill.startsWith("url(#bubble-")) {
                      const cleanCol = p.props.fill.replace("url(#bubble-", "").replace(")", "");
                      return React.cloneElement(p, { fill: `url(#bubble-fs-${cleanCol})` });
                    }
                    return p;
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

GibbsPlot.displayName = "GibbsPlot";
export default GibbsPlot;

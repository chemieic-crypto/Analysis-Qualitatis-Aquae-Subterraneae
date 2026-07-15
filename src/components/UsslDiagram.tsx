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

interface UsslDiagramProps {
  data: ProcessedSample[];
  pointColors: Record<string, string>;
  pointSizes: Record<string, number>;
  getPointKey: (d: ProcessedSample) => string;
  stateHeader: string;
  is3d?: boolean;
  bubbleSizeMultiplier?: number;
  customTitle?: string;
}

export const UsslDiagram = React.memo(({
  data,
  pointColors,
  pointSizes,
  getPointKey,
  stateHeader,
  is3d = true,
  bubbleSizeMultiplier = 1,
  customTitle,
}: UsslDiagramProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const margin = { top: 50, right: 30, bottom: 50, left: 60 };
  const width = 500;
  const height = 400;

  const [labelsConfig, setLabelsConfig] = useState<Record<string, LabelConfig>>({
    title: { text: customTitle || "USSL Classification Matrix", size: 14, color: "#1e293b", isBold: true, isItalic: false },
    xAxis: { text: "EC (μS/cm)", size: 12, color: "#475569", isBold: true, isItalic: false },
    yAxis: { text: "SAR", size: 12, color: "#475569", isBold: true, isItalic: false },
  });

  React.useEffect(() => {
    if (customTitle) {
      setLabelsConfig(prev => ({
        ...prev,
        title: { ...prev.title, text: customTitle }
      }));
    }
  }, [customTitle]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [title3dEffect, setTitle3dEffect] = useState<"none" | "emboss" | "deboss">("emboss");

  // Systematic Downsampling to prevent UI hanging under large datasets
  const maxSafePoints = 1200;
  const isDownsampled = data.length > maxSafePoints;
  const displayData = useMemo(() => {
    if (!isDownsampled) return data;
    const step = Math.ceil(data.length / maxSafePoints);
    return data.filter((_, idx) => idx % step === 0);
  }, [data, isDownsampled]);

  const getX = (ec: number) => {
    const logMin = Math.log10(100);
    const logMax = Math.log10(10000);
    const logVal = Math.log10(Math.max(100, Math.min(10000, ec)));
    return margin.left + ((logVal - logMin) / (logMax - logMin)) * (width - margin.left - margin.right);
  };

  const getY = (sar: number) => {
    const maxSar = 32;
    const val = Math.min(maxSar, Math.max(0, sar));
    return height - margin.bottom - (val / maxSar) * (height - margin.bottom - margin.top);
  };

  const ecs = Array.from({ length: 100 }, (_, i) => 100 + i * 100);
  const s1s2 = (ec: number) => 18.8515824 - 4.4257912 * Math.log10(ec);
  const s2s3 = (ec: number) => 31.4031902 - 6.6827811 * Math.log10(ec);
  const s3s4 = (ec: number) => 43.675205 - 8.8394965 * Math.log10(ec);

  const xCentroids = [
    { id: "C1", val: Math.pow(10, (Math.log10(100) + Math.log10(250)) / 2) },
    { id: "C2", val: Math.pow(10, (Math.log10(250) + Math.log10(750)) / 2) },
    { id: "C3", val: Math.pow(10, (Math.log10(750) + Math.log10(2250)) / 2) },
    { id: "C4", val: Math.pow(10, (Math.log10(2250) + Math.log10(10000)) / 2) },
  ];

  const gridLineColor = "rgba(100, 116, 139, 0.15)"; // slate-500 with 15% opacity
  const axisPathColor = "#0891b2"; // slightly darker cyan boundary lines
  const axisColor = "#64748b"; // dark slate for crisp lines

  // Crop states
  const [isCropActive, setIsCropActive] = useState<boolean>(false);
  const [cropBox, setCropBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 40,
    y: 80,
    width: 320,
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
      if (d._calc.ussl === "Unknown" || !d._calc.hasUSSL) return null;
      const key = getPointKey(d);
      const color = pointColors[key] || "#3b82f6";
      let radius = pointSizes ? pointSizes[key] || 1.3 : 1.3;
      if (is3d) {
        radius *= bubbleSizeMultiplier;
      }
      const stateStr = stateHeader ? d[stateHeader] : d.State || d.STATE;
      const bubbleId = `bubble-${String(color).replace(/#/g, "")}`;
      const fillValue = is3d ? `url(#${bubbleId})` : color;
      return (
        <circle
          key={i}
          cx={getX(d._calc.ecVal || 0)}
          cy={getY(d._calc.sar)}
          r={radius}
          fill={fillValue}
          fillOpacity="0.95"
          stroke={is3d ? "rgba(255,255,255,0.4)" : "none"}
          strokeWidth={is3d ? 0.2 : 0}
          className="transition-all duration-300 hover:opacity-80 cursor-pointer"
          title={`${d._calc.locName}\nEC: ${d._calc.ecVal}\nSAR: ${d._calc.sar.toFixed(2)}` + (stateStr ? `\nState: ${stateStr}` : "")}
        />
      );
    });
  }, [displayData, pointColors, pointSizes, getPointKey, stateHeader, is3d, bubbleSizeMultiplier]);

  return (
    <div className="bg-transparent p-6 flex flex-col items-center w-full transition-colors duration-300 relative group">
      <div className="absolute top-4 right-4 opacity-80 group-hover:opacity-100 transition-opacity z-10 flex gap-2">
        <button
          onClick={() => setIsCropActive(!isCropActive)}
          className={`p-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all border-b-4 active:border-b-0 active:translate-y-1 ${
            isCropActive
              ? "bg-amber-500 text-white border-amber-600 hover:bg-amber-600"
              : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-amber-100 hover:text-amber-800 hover:border-amber-300"
          }`}
          title="Select Crop Area for JPEG export"
        >
          <i className="ph ph-crop text-lg"></i>
          <span className="text-[10px] font-bold uppercase tracking-wider">{isCropActive ? "Deactivate" : "Crop"}</span>
        </button>
        <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl px-2 py-1.5 border border-slate-200 shadow-sm">
          <span className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider pl-1">Title 3D:</span>
          <select
            value={title3dEffect}
            onChange={(e) => setTitle3dEffect(e.target.value as any)}
            className="text-[10px] font-bold bg-white text-slate-700 border border-slate-200 rounded-lg px-2 py-0.5 focus:outline-none cursor-pointer"
          >
            <option value="none">None</option>
            <option value="emboss">Bevel & Emboss</option>
            <option value="deboss">Deboss</option>
          </select>
        </div>
        <button
          onClick={() => downloadChartHD("ussl-chart-export", "USSL_Diagram")}
          className="bg-slate-100 text-slate-600 hover:bg-slate-600 hover:text-white p-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all border-b-4 border-slate-200 hover:border-slate-800 active:border-b-0 active:translate-y-1"
          title="Download HD JPEG"
        >
          <i className="ph ph-camera text-lg"></i>
        </button>
        <button
          onClick={() => setIsFullscreen(true)}
          className="bg-slate-100 text-slate-600 hover:bg-indigo-600 hover:text-white p-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all border-b-4 border-slate-200 hover:border-indigo-800 active:border-b-0 active:translate-y-1"
          title="Full Screen View"
        >
          <i className="ph ph-corners-out text-lg"></i>
        </button>
      </div>

      <div className="absolute top-4 left-6 z-10 flex items-center gap-2 bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm opacity-80 hover:opacity-100 transition-opacity">
        <i className="ph ph-hand-grabbing"></i>
        <span className="text-[9px] font-bold uppercase tracking-wider">Click titles or axes to edit</span>
      </div>

      {editingKey && labelsConfig[editingKey] && (
        <UsslLabelsEditor
          config={labelsConfig[editingKey]}
          onChange={(newConf) => setLabelsConfig((p) => ({ ...p, [editingKey]: newConf }))}
          onClose={() => setEditingKey(null)}
        />
      )}

      <div id="ussl-chart-export" className="flex flex-col items-center justify-center p-0 w-full bg-transparent rounded-2xl relative">
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
          className="w-full h-auto max-w-full overflow-visible"
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

          {/* Clean Light-effect background for the plot area */}
          <rect
            x={margin.left}
            y={margin.top}
            width={width - margin.left - margin.right}
            height={height - margin.top - margin.bottom}
            rx="12"
            fill="#ffffff"
            stroke="#cbd5e1"
            strokeWidth="1.5"
          />

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

          <line x1={getX(250)} y1={margin.top} x2={getX(250)} y2={height - margin.bottom} stroke={gridLineColor} strokeDasharray="4" />
          <line x1={getX(750)} y1={margin.top} x2={getX(750)} y2={height - margin.bottom} stroke={gridLineColor} strokeDasharray="4" />
          <line x1={getX(2250)} y1={margin.top} x2={getX(2250)} y2={height - margin.bottom} stroke={gridLineColor} strokeDasharray="4" />

          <path d={ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s1s2(ec))}`).join(" ")} fill="none" stroke={axisPathColor} strokeWidth="2.0" />
          <path d={ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s2s3(ec))}`).join(" ")} fill="none" stroke={axisPathColor} strokeWidth="2.0" />
          <path d={ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s3s4(ec))}`).join(" ")} fill="none" stroke={axisPathColor} strokeWidth="2.0" />

          {xCentroids.map((xC) => (
            <g key={xC.id} opacity="0.9">
              <text x={getX(xC.val)} y={getY(s1s2(xC.val) / 2)} textAnchor="middle" fontSize="8.5" fill="#0284c7" fontWeight="bold">
                {xC.id}-S1
              </text>
              <text x={getX(xC.val)} y={getY((s1s2(xC.val) + s2s3(xC.val)) / 2)} textAnchor="middle" fontSize="8.5" fill="#0284c7" fontWeight="bold">
                {xC.id}-S2
              </text>
              <text x={getX(xC.val)} y={getY((s2s3(xC.val) + s3s4(xC.val)) / 2)} textAnchor="middle" fontSize="8.5" fill="#0284c7" fontWeight="bold">
                {xC.id}-S3
              </text>
              <text x={getX(xC.val)} y={getY((s3s4(xC.val) + 32) / 2)} textAnchor="middle" fontSize="8.5" fill="#be123c" fontWeight="bold">
                {xC.id}-S4
              </text>
            </g>
          ))}

          <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} stroke={axisColor} strokeWidth="1.5" />
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} stroke={axisColor} strokeWidth="1.5" />

          {[100, 250, 750, 2250, 5000, 10000].map((v) => (
            <g key={v}>
              <line x1={getX(v)} y1={height - margin.bottom} x2={getX(v)} y2={height - margin.bottom + 5} stroke={axisColor} />
              <text x={getX(v)} y={height - margin.bottom + 15} textAnchor="middle" fontSize="8" fill="#475569" fontWeight="bold">
                {v}
              </text>
            </g>
          ))}
          {[0, 10, 20, 30].map((v) => (
            <g key={v}>
              <line x1={margin.left - 5} y1={getY(v)} x2={margin.left} y2={getY(v)} stroke={axisColor} />
              <text x={margin.left - 10} y={getY(v) + 3} textAnchor="end" fontSize="8" fill="#475569" fontWeight="bold">
                {v}
              </text>
            </g>
          ))}

          {renderedPoints}
        </svg>
        </div>
      </div>

      {/* Full Screen Modal View */}
      {isFullscreen && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 md:p-8">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-4xl max-h-[92vh] flex flex-col relative border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-150 pb-4 mb-4">
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <i className="ph ph-corners-out text-lg text-indigo-600 animate-pulse"></i>
                  USSL Classification Matrix (Full Screen)
                </h3>
                <p className="text-[10px] text-slate-400 font-extrabold uppercase mt-0.5">
                  Full interactive explorer mode with high-resolution scaling
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => downloadChartHD("ussl-chart-export-fs", "USSL_Diagram_HD")}
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
              <div id="ussl-chart-export-fs" className="flex flex-col items-center justify-center p-6 w-full max-w-[650px] bg-transparent rounded-2xl relative">
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

                  {/* Clean Light-effect background for the plot area */}
                  <rect
                    x={margin.left}
                    y={margin.top}
                    width={width - margin.left - margin.right}
                    height={height - margin.top - margin.bottom}
                    rx="12"
                    fill="#ffffff"
                    stroke="#cbd5e1"
                    strokeWidth="1.5"
                  />

                  <text
                    x={width / 2}
                    y={margin.top - 20}
                    textAnchor="middle"
                    fontSize={labelsConfig.title.size}
                    fill="#1e293b"
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
                    fill="#475569"
                    fontWeight={labelsConfig.xAxis.isBold ? "900" : "400"}
                    fontStyle={labelsConfig.xAxis.isItalic ? "italic" : "normal"}
                    fontFamily={labelsConfig.xAxis.fontFamily || "sans-serif"}
                  >
                    {labelsConfig.xAxis.text}
                  </text>

                  <line x1={getX(250)} y1={margin.top} x2={getX(250)} y2={height - margin.bottom} stroke={gridLineColor} strokeDasharray="4" />
                  <line x1={getX(750)} y1={margin.top} x2={getX(750)} y2={height - margin.bottom} stroke={gridLineColor} strokeDasharray="4" />
                  <line x1={getX(2250)} y1={margin.top} x2={getX(2250)} y2={height - margin.bottom} stroke={gridLineColor} strokeDasharray="4" />

                  <path d={ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s1s2(ec))}`).join(" ")} fill="none" stroke={axisPathColor} strokeWidth="2.0" />
                  <path d={ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s2s3(ec))}`).join(" ")} fill="none" stroke={axisPathColor} strokeWidth="2.0" />
                  <path d={ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s3s4(ec))}`).join(" ")} fill="none" stroke={axisPathColor} strokeWidth="2.0" />                   {xCentroids.map((xC) => (
                    <g key={xC.id} opacity="0.9">
                      <text x={getX(xC.val)} y={getY(s1s2(xC.val) / 2)} textAnchor="middle" fontSize="8.5" fill="#0284c7" fontWeight="bold">
                        {xC.id}-S1
                      </text>
                      <text x={getX(xC.val)} y={getY((s1s2(xC.val) + s2s3(xC.val)) / 2)} textAnchor="middle" fontSize="8.5" fill="#0284c7" fontWeight="bold">
                        {xC.id}-S2
                      </text>
                      <text x={getX(xC.val)} y={getY((s2s3(xC.val) + s3s4(xC.val)) / 2)} textAnchor="middle" fontSize="8.5" fill="#0284c7" fontWeight="bold">
                        {xC.id}-S3
                      </text>
                      <text x={getX(xC.val)} y={getY((s3s4(xC.val) + 32) / 2)} textAnchor="middle" fontSize="8.5" fill="#be123c" fontWeight="bold">
                        {xC.id}-S4
                      </text>
                    </g>
                  ))}

                  <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} stroke={axisColor} strokeWidth="1.5" />
                  <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} stroke={axisColor} strokeWidth="1.5" />

                  {[100, 250, 750, 2250, 5000, 10000].map((v) => (
                    <g key={v}>
                      <line x1={getX(v)} y1={height - margin.bottom} x2={getX(v)} y2={height - margin.bottom + 5} stroke={axisColor} />
                      <text x={getX(v)} y={height - margin.bottom + 15} textAnchor="middle" fontSize="8" fill="#475569" fontWeight="bold">
                        {v}
                      </text>
                    </g>
                  ))}
                  {[0, 10, 20, 30].map((v) => (
                    <g key={v}>
                      <line x1={margin.left - 5} y1={getY(v)} x2={margin.left} y2={getY(v)} stroke={axisColor} />
                      <text x={margin.left - 10} y={getY(v) + 3} textAnchor="end" fontSize="8" fill="#475569" fontWeight="bold">
                        {v}
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

UsslDiagram.displayName = "UsslDiagram";
export default UsslDiagram;

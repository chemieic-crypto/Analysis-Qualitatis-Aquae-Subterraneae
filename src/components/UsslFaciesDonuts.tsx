import React, { useState, useRef } from "react";
import UsslLabelsEditor, { LabelConfig } from "./UsslLabelsEditor";
import { sanitizeColorsForHtml2canvas, safeHtml2canvas } from "../utils/colorSanitizer";

export interface DonutSlice {
  key: string;
  name: string;
  count: number;
}

interface DonutChartProps {
  data: DonutSlice[];
  colors: Record<string, string>;
  sizes?: Record<string, number>;
  defaultTitle: string;
  onColorChange?: (key: string, color: string) => void;
  onSizeChange?: (key: string, size: number) => void;
  onNameChange?: (key: string, name: string) => void;
  compact?: boolean;
}

export const DonutChart = React.memo(({
  data,
  colors,
  sizes,
  defaultTitle,
  onColorChange,
  onSizeChange,
  onNameChange,
  compact = false,
}: DonutChartProps) => {
  const [titleConfig, setTitleConfig] = useState<LabelConfig>({
    text: defaultTitle,
    size: 12,
    color: "#64748b",
    isBold: true,
    isItalic: false,
  });
  const [editingTitle, setEditingTitle] = useState(false);

  const total = data.reduce((sum, item) => sum + item.count, 0);
  let cumulativePercent = 0;
  const getCoordinatesForPercent = (percent: number) => [
    Math.cos(2 * Math.PI * percent),
    Math.sin(2 * Math.PI * percent),
  ];

  const innerCircleFill = "#ffffff";
  const exportId = `donut-${titleConfig.text.replace(/[^a-z0-9]/gi, "")}`;

  const getCompressedFontSize = (name: string) => {
    if (name.length > 35) return "9px";
    if (name.length > 25) return "10px";
    if (name.length > 15) return "11px";
    return "12px";
  };

  // Crop states
  const [isCropActive, setIsCropActive] = useState<boolean>(false);
  const [cropBox, setCropBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 20,
    y: 20,
    width: 200,
    height: 200,
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
        const minSize = 40;

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

  return (
    <div className={`bg-white rounded-3xl border border-slate-200 flex flex-col items-center shadow-md transition-colors duration-300 relative group w-full ${compact ? "p-2.5" : "p-4"}`}>
      <div className="absolute top-4 right-4 opacity-80 group-hover:opacity-100 transition-opacity z-10 flex gap-1.5">
        <button
          onClick={() => setIsCropActive(!isCropActive)}
          className={`p-1 bg-white/80 rounded-lg shadow-sm border-b-4 active:border-b-0 active:translate-y-1 transition-all ${
            isCropActive
              ? "bg-amber-500 text-white border-amber-600 hover:bg-amber-600"
              : "text-slate-400 hover:text-amber-850 border-slate-200 hover:border-amber-300 hover:bg-amber-50"
          }`}
          title="Select Crop Area for JPEG export"
        >
          <i className="ph ph-crop text-lg"></i>
        </button>
        <button
          onClick={() => downloadChartHD(exportId, titleConfig.text)}
          className="text-slate-400 hover:text-slate-600 p-1 bg-white/80 rounded-lg shadow-sm border-b-4 border-slate-200 hover:border-slate-500 active:border-b-0 active:translate-y-1 transition-all"
          title="Download HD JPEG"
        >
          <i className="ph ph-camera text-lg"></i>
        </button>
      </div>

      {editingTitle && (
        <UsslLabelsEditor
          config={titleConfig}
          onChange={setTitleConfig}
          onClose={() => setEditingTitle(false)}
        />
      )}

      <div id={exportId} className="flex flex-col items-center bg-white p-0 w-full rounded-2xl relative">
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
        <div className={`flex flex-col items-center w-full ${compact ? "p-1.5" : "p-3"}`}>
        <h3
          className="tracking-[0.15em] mb-3 text-center cursor-pointer hover:opacity-70 transition-opacity uppercase"
          style={{
            fontFamily: titleConfig.fontFamily || "'Times New Roman', Times, serif",
            fontSize: `${compact ? titleConfig.size * 0.75 : titleConfig.size * 0.9}px`,
            color: titleConfig.color,
            fontWeight: titleConfig.isBold ? "900" : "400",
            fontStyle: titleConfig.isItalic ? "italic" : "normal",
          }}
          onClick={() => setEditingTitle(true)}
        >
          {titleConfig.text}
        </h3>
        <div className={`relative mb-3 drop-shadow-md ${compact ? "w-20 h-20" : "w-28 h-28"}`}>
          <svg viewBox="-1 -1 2 2" className="w-full h-full -rotate-90">
            {data.map((slice, i) => {
              if (slice.count === 0) return null;
              const [startX, startY] = getCoordinatesForPercent(cumulativePercent);
              const slicePercent = slice.count / total;
              cumulativePercent += slicePercent;

              const endPercent = slicePercent === 1 ? 0.9999 : cumulativePercent;
              const [endX, endY] = getCoordinatesForPercent(endPercent);

              return (
                <path
                  key={i}
                  d={`M ${startX} ${startY} A 1 1 0 ${slicePercent > 0.5 ? 1 : 0} 1 ${endX} ${endY} L 0 0`}
                  fill={colors[slice.key] || "#334155"}
                  stroke={innerCircleFill}
                  strokeWidth="0.02"
                />
              );
            })}
            <circle r="0.75" fill={innerCircleFill} className="transition-colors duration-300" />
          </svg>
        </div>
        <div className={`w-full space-y-1 overflow-y-auto custom-scrollbar pr-1 ${compact ? "max-h-36" : "max-h-48"}`}>
          {data.map((slice, i) => (
            <div
              key={i}
              className={`flex justify-between items-center bg-slate-50 border border-slate-100 hover:bg-slate-100 transition-colors ${compact ? "px-2 py-1.5 rounded-lg mb-1" : "px-3 py-2 rounded-xl mb-1.5"}`}
              style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: compact ? "10.5px" : "12px" }}
            >
              <div className="flex items-center gap-1.5 truncate flex-1 pr-1.5">
                <label
                  title="Change Point Color"
                  className="cursor-pointer relative w-2.5 h-2.5 rounded-full border border-slate-200 shrink-0 shadow-sm overflow-hidden flex ring-offset-1 hover:ring-2 ring-blue-400 transition-all"
                  style={{ backgroundColor: colors[slice.key] || "#334155" }}
                >
                  <input
                    type="color"
                    value={colors[slice.key] || "#334155"}
                    onChange={(e) => onColorChange && onColorChange(slice.key, e.target.value)}
                    className="opacity-0 absolute -inset-2 w-8 h-8 cursor-pointer"
                  />
                </label>
                <input
                  type="number"
                  min="0.5"
                  max="10"
                  step="0.1"
                  title="Change Point Size"
                  value={sizes ? sizes[slice.key] || 1.3 : 1.3}
                  onChange={(e) => onSizeChange && onSizeChange(slice.key, parseFloat(e.target.value) || 1.3)}
                  className="w-8 py-0 px-0.5 bg-transparent border-b border-slate-300 focus:outline-none focus:border-slate-500 text-center shrink-0"
                  style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: compact ? "11px" : "12px" }}
                />
                {onNameChange ? (
                  <input
                    type="text"
                    value={slice.name}
                    title="Rename Category"
                    onChange={(e) => onNameChange(slice.key, e.target.value)}
                    className="flex-1 min-w-0 ml-0.5 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:outline-none font-bold text-slate-700 truncate"
                    style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: getCompressedFontSize(slice.name) }}
                  />
                ) : (
                  <span className="text-slate-700 font-bold truncate pl-0.5 flex-1 min-w-0" style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: getCompressedFontSize(slice.name) }}>{slice.name}</span>
                )}
              </div>
              <div className="flex gap-2 shrink-0" style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: compact ? "11px" : "12px" }}>
                <span className="text-slate-400">n={slice.count}</span>
                <span className="text-slate-600 font-black">
                  {total ? ((slice.count / total) * 100).toFixed(0) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
});

DonutChart.displayName = "DonutChart";
export default DonutChart;

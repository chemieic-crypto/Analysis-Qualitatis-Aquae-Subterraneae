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

interface PiperDiagramProps {
  data: ProcessedSample[];
  pointColors: Record<string, string>;
  pointSizes: Record<string, number>;
  getPointKey: (d: ProcessedSample) => string;
  stateHeader: string;
  is3d?: boolean;
  bubbleSizeMultiplier?: number;
  customTitle?: string;
}

export const PiperDiagram = React.memo(({
  data,
  pointColors,
  pointSizes,
  getPointKey,
  stateHeader,
  is3d = true,
  bubbleSizeMultiplier = 1,
  customTitle,
}: PiperDiagramProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [titleConfig, setTitleConfig] = useState<LabelConfig>({
    text: customTitle || "Piper Trilinear Diagram",
    size: 14,
    color: "#64748b",
    isBold: true,
    isItalic: false,
  });

  React.useEffect(() => {
    if (customTitle) {
      setTitleConfig(prev => ({
        ...prev,
        text: customTitle
      }));
    }
  }, [customTitle]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title3dEffect, setTitle3dEffect] = useState<"none" | "emboss" | "deboss">("emboss");

  // Systematic Downsampling to prevent UI hanging under large datasets
  const maxSafePoints = 1200;
  const isDownsampled = data.length > maxSafePoints;
  const displayData = useMemo(() => {
    if (!isDownsampled) return data;
    const step = Math.ceil(data.length / maxSafePoints);
    return data.filter((_, idx) => idx % step === 0);
  }, [data, isDownsampled]);

  const SQRT3 = Math.sqrt(3);
  const H = (100 * SQRT3) / 2;

  const tx = (x: number) => x + 40;
  const ty = (y: number) => 230 - y;

  const gridLineColor = "#e2e8f0";
  const frameColor = "#1f2937";

  interface LabelItem {
    text: string;
    x: number;
    y: number;
    align: "start" | "middle" | "end";
    rotate: number;
    color: string;
    isBold: boolean;
    isItalic: boolean;
    fontSize: number;
    fontFamily?: string;
  }

  const defaultLabels: Record<string, LabelItem> = {
    ca: { text: "Ca²⁺", x: tx(50), y: ty(-14), align: "middle", rotate: 0, color: "#2563eb", isBold: true, isItalic: false, fontSize: 6.5 },
    nak: { text: "Na⁺ + K⁺", x: tx(82), y: ty(45), align: "middle", rotate: 60, color: "#2563eb", isBold: true, isItalic: false, fontSize: 6.5 },
    mg: { text: "Mg²⁺", x: tx(18), y: ty(45), align: "middle", rotate: -60, color: "#2563eb", isBold: true, isItalic: false, fontSize: 6.5 },
    so4: { text: "SO₄²⁻", x: tx(202), y: ty(45), align: "middle", rotate: 60, color: "#2563eb", isBold: true, isItalic: false, fontSize: 6.5 },
    hco3: { text: "HCO₃⁻ + CO₃²⁻", x: tx(138), y: ty(45), align: "middle", rotate: -60, color: "#2563eb", isBold: true, isItalic: false, fontSize: 6.5 },
    cl: { text: "Cl⁻", x: tx(170), y: ty(-14), align: "middle", rotate: 0, color: "#2563eb", isBold: true, isItalic: false, fontSize: 6.5 },
    diamondL: { text: "SO₄²⁻ + Cl⁻", x: tx(75), y: ty(135), align: "middle", rotate: -60, color: "#2563eb", isBold: true, isItalic: false, fontSize: 6.5 },
    diamondR: { text: "Ca²⁺ + Mg²⁺", x: tx(145), y: ty(135), align: "middle", rotate: 60, color: "#2563eb", isBold: true, isItalic: false, fontSize: 6.5 },
  };

  const [labels, setLabels] = useState<Record<string, LabelItem>>(defaultLabels);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggedLabel, setDraggedLabel] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent<SVGTextElement>, key: string) => {
    e.stopPropagation();
    setSelectedLabel(key);
    setEditingTitle(false);
    if (!svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svgRef.current.getScreenCTM()!.inverse());
    setDragOffset({ x: labels[key]!.x - svgP.x, y: labels[key]!.y - svgP.y });
    setDraggedLabel(key);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggedLabel || !svgRef.current) return;
    e.preventDefault();
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svgRef.current.getScreenCTM()!.inverse());
    setLabels((prev) => ({
      ...prev,
      [draggedLabel]: { ...prev[draggedLabel]!, x: svgP.x + dragOffset.x, y: svgP.y + dragOffset.y },
    }));
  };

  const handlePointerUp = () => setDraggedLabel(null);

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

  const grids = useMemo(() => {
    const list = [];
    for (let i = 20; i < 100; i += 20) {
      const y = (i * SQRT3) / 2;
      const strokeProps = { stroke: gridLineColor, strokeDasharray: "2 2", strokeWidth: "0.8", fill: "none" };
      list.push(<line key={`c1-${i}`} x1={tx(0.5 * i)} y1={ty(y)} x2={tx(100 - 0.5 * i)} y2={ty(y)} {...strokeProps} />);
      list.push(<line key={`c2-${i}`} x1={tx(i)} y1={ty(0)} x2={tx(50 + 0.5 * i)} y2={ty(((100 - i) * SQRT3) / 2)} {...strokeProps} />);
      list.push(<line key={`c3-${i}`} x1={tx(100 - i)} y1={ty(0)} x2={tx(0.5 * (100 - i))} y2={ty(((100 - i) * SQRT3) / 2)} {...strokeProps} />);
      list.push(<line key={`a1-${i}`} x1={tx(120 + 0.5 * i)} y1={ty(y)} x2={tx(220 - 0.5 * i)} y2={ty(y)} {...strokeProps} />);
      list.push(<line key={`a2-${i}`} x1={tx(120 + i)} y1={ty(0)} x2={tx(170 + 0.5 * i)} y2={ty(((100 - i) * SQRT3) / 2)} {...strokeProps} />);
      list.push(<line key={`a3-${i}`} x1={tx(220 - i)} y1={ty(0)} x2={tx(120 + 0.5 * (100 - i))} y2={ty(((100 - i) * SQRT3) / 2)} {...strokeProps} />);
      list.push(<line key={`d1-${i}`} x1={tx(110 - 0.5 * i)} y1={ty(10 * SQRT3 + 0.5 * i * SQRT3)} x2={tx(160 - 0.5 * i)} y2={ty(60 * SQRT3 + 0.5 * i * SQRT3)} {...strokeProps} />);
      list.push(<line key={`d2-${i}`} x1={tx(110 + 0.5 * i)} y1={ty(10 * SQRT3 + 0.5 * i * SQRT3)} x2={tx(60 + 0.5 * i)} y2={ty(60 * SQRT3 + 0.5 * i * SQRT3)} {...strokeProps} />);
    }
    return list;
  }, [SQRT3]);

  const renderedPoints = useMemo(() => {
    return displayData.map((d, i) => {
      if (d._calc.facies === "Unknown" || !d._calc.hasFacies) return null;

      const ca = d._calc.meqPerc.Ca || 0;
      const mg = d._calc.meqPerc.Mg || 0;
      const nak = (d._calc.meqPerc.Na || 0) + (d._calc.meqPerc.K || 0);
      const cl = d._calc.meqPerc.Cl || 0;
      const so4 = d._calc.meqPerc.SO4 || 0;
      const hco3 = (d._calc.meqPerc.HCO3 || 0) + (d._calc.meqPerc.CO3 || 0);

      if (ca + mg + nak === 0 || cl + so4 + hco3 === 0) return null;

      const xc = nak + 0.5 * mg;
      const yc = (mg * SQRT3) / 2;
      const xa = 120 + cl + 0.5 * so4;
      const ya = (so4 * SQRT3) / 2;
      const xd = 0.5 * (xa + xc) + (ya - yc) / (2 * SQRT3);
      const yd = SQRT3 * (xd - xc) + yc;

      const key = getPointKey(d);
      const color = pointColors[key] || "#3b82f6";
      let radius = pointSizes ? pointSizes[key] || 1.3 : 1.3;
      if (is3d) {
        radius *= bubbleSizeMultiplier;
      }
      const stateStr = stateHeader ? d[stateHeader] : d.State || d.STATE;
      const tip = `${d._calc.locName}\nFacies: ${d._calc.facies}` + (stateStr ? `\nState: ${stateStr}` : "");

      const bubbleId = `bubble-${String(color).replace(/#/g, "")}`;
      const fillValue = is3d ? `url(#${bubbleId})` : color;

      return (
        <g key={i} className="cursor-pointer">
          <circle cx={tx(xc)} cy={ty(yc)} r={radius} fill={fillValue} fillOpacity="0.95" stroke={is3d ? "rgba(255,255,255,0.4)" : "none"} strokeWidth={is3d ? 0.2 : 0} title={tip} />
          <circle cx={tx(xa)} cy={ty(ya)} r={radius} fill={fillValue} fillOpacity="0.95" stroke={is3d ? "rgba(255,255,255,0.4)" : "none"} strokeWidth={is3d ? 0.2 : 0} title={tip} />
          <circle cx={tx(xd)} cy={ty(yd)} r={radius} fill={fillValue} fillOpacity="0.95" stroke={is3d ? "rgba(255,255,255,0.4)" : "none"} strokeWidth={is3d ? 0.2 : 0} title={tip} />
        </g>
      );
    });
  }, [displayData, pointColors, pointSizes, getPointKey, stateHeader, SQRT3, is3d, bubbleSizeMultiplier]);

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
          onClick={() => downloadChartHD("piper-chart-export", "Piper_Diagram")}
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
        <span className="text-[9px] font-bold uppercase tracking-wider">Labels draggable &bull; click titles to edit</span>
      </div>

      {editingTitle && (
        <UsslLabelsEditor
          config={titleConfig}
          onChange={setTitleConfig}
          onClose={() => setEditingTitle(false)}
        />
      )}

      {selectedLabel && labels[selectedLabel] && (
        <UsslLabelsEditor
          config={{
            text: labels[selectedLabel]!.text,
            size: labels[selectedLabel]!.fontSize,
            color: labels[selectedLabel]!.color || "#64748b",
            isBold: labels[selectedLabel]!.isBold,
            isItalic: labels[selectedLabel]!.isItalic,
            fontFamily: labels[selectedLabel]!.fontFamily || "sans-serif",
          }}
          onChange={(newConf) =>
            setLabels((p) => ({
              ...p,
              [selectedLabel]: {
                ...p[selectedLabel]!,
                text: newConf.text,
                fontSize: newConf.size,
                color: newConf.color,
                isBold: newConf.isBold,
                isItalic: newConf.isItalic,
                fontFamily: newConf.fontFamily,
              },
            }))
          }
          onClose={() => setSelectedLabel(null)}
        />
      )}

      <div id="piper-chart-export" className="flex flex-col items-center justify-center p-0 w-full bg-transparent rounded-2xl relative">
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
          ref={svgRef}
          viewBox="-20 -20 340 300"
          className="w-full h-auto max-h-[720px] overflow-visible mt-6"
          style={{ fontFamily: "'Inter', sans-serif", touchAction: "none" }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerDown={() => {
            setSelectedLabel(null);
            setEditingTitle(false);
          }}
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
                <filter id="glass-shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="1.5" dy="3.5" stdDeviation="2" floodColor="#1e293b" floodOpacity="0.16" />
                </filter>
                <linearGradient id="cation-glass" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#eff6ff" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#ffffff" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#dbeafe" stopOpacity="0.8" />
                </linearGradient>
                <linearGradient id="anion-glass" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#fff1f2" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#ffffff" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#ffe4e6" stopOpacity="0.8" />
                </linearGradient>
                <linearGradient id="diamond-glass" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f5f3ff" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#ffffff" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#e0e7ff" stopOpacity="0.8" />
                </linearGradient>
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
            x="150"
            y="-10"
            textAnchor="middle"
            fontSize={titleConfig.size}
            fill={titleConfig.color}
            fontWeight={titleConfig.isBold ? "900" : "400"}
            fontStyle={titleConfig.isItalic ? "italic" : "normal"}
            fontFamily={titleConfig.fontFamily || "sans-serif"}
            style={{ cursor: "pointer", letterSpacing: "0.1em" }}
            filter={title3dEffect === "emboss" ? "url(#3d-emboss)" : title3dEffect === "deboss" ? "url(#3d-deboss)" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setEditingTitle(true);
              setSelectedLabel(null);
            }}
          >
            {titleConfig.text}
          </text>

          <line x1={tx(25)} y1={ty(H / 2)} x2={tx(75)} y2={ty(H / 2)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
          <line x1={tx(25)} y1={ty(H / 2)} x2={tx(50)} y2={ty(0)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
          <line x1={tx(75)} y1={ty(H / 2)} x2={tx(50)} y2={ty(0)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />

          <line x1={tx(145)} y1={ty(H / 2)} x2={tx(195)} y2={ty(H / 2)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
          <line x1={tx(145)} y1={ty(H / 2)} x2={tx(170)} y2={ty(0)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
          <line x1={tx(195)} y1={ty(H / 2)} x2={tx(170)} y2={ty(0)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />

          <line x1={tx(85)} y1={ty(85 * SQRT3)} x2={tx(135)} y2={ty(85 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
          <line x1={tx(85)} y1={ty(35 * SQRT3)} x2={tx(135)} y2={ty(35 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
          <line x1={tx(85)} y1={ty(85 * SQRT3)} x2={tx(110)} y2={ty(60 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
          <line x1={tx(135)} y1={ty(85 * SQRT3)} x2={tx(110)} y2={ty(60 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
          <line x1={tx(85)} y1={ty(35 * SQRT3)} x2={tx(110)} y2={ty(60 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
          <line x1={tx(135)} y1={ty(35 * SQRT3)} x2={tx(110)} y2={ty(60 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />

          <g>{grids}</g>

          <path 
            d={`M ${tx(0)} ${ty(0)} L ${tx(100)} ${ty(0)} L ${tx(50)} ${ty(H)} Z`} 
            stroke={frameColor} 
            strokeWidth="1.2" 
            fill={is3d ? "url(#cation-glass)" : "none"} 
            filter={is3d ? "url(#glass-shadow)" : undefined}
            strokeLinejoin="round" 
          />
          <path 
            d={`M ${tx(120)} ${ty(0)} L ${tx(220)} ${ty(0)} L ${tx(170)} ${ty(H)} Z`} 
            stroke={frameColor} 
            strokeWidth="1.2" 
            fill={is3d ? "url(#anion-glass)" : "none"} 
            filter={is3d ? "url(#glass-shadow)" : undefined}
            strokeLinejoin="round" 
          />
          <path 
            d={`M ${tx(110)} ${ty(10 * SQRT3)} L ${tx(160)} ${ty(60 * SQRT3)} L ${tx(110)} ${ty(110 * SQRT3)} L ${tx(60)} ${ty(60 * SQRT3)} Z`} 
            stroke={frameColor} 
            strokeWidth="1.2" 
            fill={is3d ? "url(#diamond-glass)" : "none"} 
            filter={is3d ? "url(#glass-shadow)" : undefined}
            strokeLinejoin="round" 
          />

          {(Object.entries(labels) as [string, LabelItem][]).map(([key, l]) => (
            <text
              key={key}
              transform={`translate(${l.x}, ${l.y}) rotate(${l.rotate})`}
              textAnchor={l.align}
              fontSize={l.fontSize || 6}
              fontWeight={l.isBold ? "900" : "400"}
              fontStyle={l.isItalic ? "italic" : "normal"}
              fontFamily={l.fontFamily || "sans-serif"}
              fill={selectedLabel === key ? "#3b82f6" : l.color || "#64748b"}
              onPointerDown={(e) => handlePointerDown(e, key)}
              style={{ cursor: draggedLabel === key ? "grabbing" : "pointer", userSelect: "none", touchAction: "none" }}
            >
              {l.text}
            </text>
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
                  Piper Trilinear Diagram (Full Screen)
                </h3>
                <p className="text-[10px] text-slate-400 font-extrabold uppercase mt-0.5">
                  Full interactive explorer mode with high-resolution scaling
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => downloadChartHD("piper-chart-export-fs", "Piper_Diagram_HD")}
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
              <div id="piper-chart-export-fs" className="flex flex-col items-center justify-center p-6 w-full max-w-[650px] bg-white rounded-2xl relative">
                <svg
                  viewBox="-20 -20 340 300"
                  className="w-full h-auto max-h-[60vh] overflow-visible"
                  style={{ fontFamily: "'Inter', sans-serif", touchAction: "none" }}
                  onPointerDown={() => {
                    setSelectedLabel(null);
                    setEditingTitle(false);
                  }}
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
                        <filter id="glass-shadow-fs" x="-20%" y="-20%" width="140%" height="140%">
                          <feDropShadow dx="1.5" dy="3.5" stdDeviation="2" floodColor="#1e293b" floodOpacity="0.16" />
                        </filter>
                        <linearGradient id="cation-glass-fs" x1="0%" y1="100%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#eff6ff" stopOpacity="0.8" />
                          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#dbeafe" stopOpacity="0.8" />
                        </linearGradient>
                        <linearGradient id="anion-glass-fs" x1="0%" y1="100%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#fff1f2" stopOpacity="0.8" />
                          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#ffe4e6" stopOpacity="0.8" />
                        </linearGradient>
                        <linearGradient id="diamond-glass-fs" x1="0%" y1="100%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#f5f3ff" stopOpacity="0.8" />
                          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#e0e7ff" stopOpacity="0.8" />
                        </linearGradient>
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
                    x="150"
                    y="-10"
                    textAnchor="middle"
                    fontSize={titleConfig.size}
                    fill={titleConfig.color}
                    fontWeight={titleConfig.isBold ? "900" : "400"}
                    fontStyle={titleConfig.isItalic ? "italic" : "normal"}
                    fontFamily={titleConfig.fontFamily || "sans-serif"}
                    style={{ cursor: "pointer", letterSpacing: "0.1em" }}
                    filter={title3dEffect === "emboss" ? "url(#3d-emboss-fs)" : title3dEffect === "deboss" ? "url(#3d-deboss-fs)" : undefined}
                  >
                    {titleConfig.text}
                  </text>

                  <line x1={tx(25)} y1={ty(H / 2)} x2={tx(75)} y2={ty(H / 2)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
                  <line x1={tx(25)} y1={ty(H / 2)} x2={tx(50)} y2={ty(0)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
                  <line x1={tx(75)} y1={ty(H / 2)} x2={tx(50)} y2={ty(0)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />

                  <line x1={tx(145)} y1={ty(H / 2)} x2={tx(195)} y2={ty(H / 2)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
                  <line x1={tx(145)} y1={ty(H / 2)} x2={tx(170)} y2={ty(0)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
                  <line x1={tx(195)} y1={ty(H / 2)} x2={tx(170)} y2={ty(0)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />

                  <line x1={tx(85)} y1={ty(85 * SQRT3)} x2={tx(135)} y2={ty(85 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
                  <line x1={tx(85)} y1={ty(35 * SQRT3)} x2={tx(135)} y2={ty(35 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
                  <line x1={tx(85)} y1={ty(85 * SQRT3)} x2={tx(110)} y2={ty(60 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
                  <line x1={tx(135)} y1={ty(85 * SQRT3)} x2={tx(110)} y2={ty(60 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
                  <line x1={tx(85)} y1={ty(35 * SQRT3)} x2={tx(110)} y2={ty(60 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />
                  <line x1={tx(135)} y1={ty(35 * SQRT3)} x2={tx(110)} y2={ty(60 * SQRT3)} stroke={frameColor} strokeWidth="1.2" opacity="0.4" />

                  <g>{grids}</g>

                  <path 
                    d={`M ${tx(0)} ${ty(0)} L ${tx(100)} ${ty(0)} L ${tx(50)} ${ty(H)} Z`} 
                    stroke={frameColor} 
                    strokeWidth="1.2" 
                    fill={is3d ? "url(#cation-glass-fs)" : "none"} 
                    filter={is3d ? "url(#glass-shadow-fs)" : undefined}
                    strokeLinejoin="round" 
                  />
                  <path 
                    d={`M ${tx(120)} ${ty(0)} L ${tx(220)} ${ty(0)} L ${tx(170)} ${ty(H)} Z`} 
                    stroke={frameColor} 
                    strokeWidth="1.2" 
                    fill={is3d ? "url(#anion-glass-fs)" : "none"} 
                    filter={is3d ? "url(#glass-shadow-fs)" : undefined}
                    strokeLinejoin="round" 
                  />
                  <path 
                    d={`M ${tx(110)} ${ty(10 * SQRT3)} L ${tx(160)} ${ty(60 * SQRT3)} L ${tx(110)} ${ty(110 * SQRT3)} L ${tx(60)} ${ty(60 * SQRT3)} Z`} 
                    stroke={frameColor} 
                    strokeWidth="1.2" 
                    fill={is3d ? "url(#diamond-glass-fs)" : "none"} 
                    filter={is3d ? "url(#glass-shadow-fs)" : undefined}
                    strokeLinejoin="round" 
                  />

                  {(Object.entries(labels) as [string, LabelItem][]).map(([key, l]) => (
                    <text
                      key={key}
                      transform={`translate(${l.x}, ${l.y}) rotate(${l.rotate})`}
                      textAnchor={l.align}
                      fontSize={l.fontSize || 6}
                      fontWeight={l.isBold ? "900" : "400"}
                      fontStyle={l.isItalic ? "italic" : "normal"}
                      fontFamily={l.fontFamily || "sans-serif"}
                      fill={l.color || "#64748b"}
                      style={{ userSelect: "none" }}
                    >
                      {l.text}
                    </text>
                  ))}
                  {renderedPoints.map((p: any) => {
                    if (is3d && p?.props?.children) {
                      return React.cloneElement(p, {}, 
                        React.Children.map(p.props.children, (child: any) => {
                          if (child && child.props && child.props.fill && child.props.fill.startsWith("url(#bubble-")) {
                            const cleanCol = child.props.fill.replace("url(#bubble-", "").replace(")", "");
                            return React.cloneElement(child, { fill: `url(#bubble-fs-${cleanCol})` });
                          }
                          return child;
                        })
                      );
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

PiperDiagram.displayName = "PiperDiagram";

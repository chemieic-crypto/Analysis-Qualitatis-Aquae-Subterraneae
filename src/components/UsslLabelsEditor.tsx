import React from "react";

export interface LabelConfig {
  text: string;
  size: number;
  color: string;
  isBold: boolean;
  isItalic: boolean;
  fontFamily?: string;
}

interface UsslLabelsEditorProps {
  config: LabelConfig;
  onChange: (cfg: LabelConfig) => void;
  onClose: () => void;
}

export default function UsslLabelsEditor({ config, onChange, onClose }: UsslLabelsEditorProps) {
  if (!config) return null;
  return (
    <div
      className="absolute z-[100] flex flex-wrap items-center gap-3 bg-white/95 backdrop-blur-md p-3 rounded-2xl border border-slate-200 shadow-xl shadow-slate-900/10 animate-fade-in"
      style={{ top: "16px", left: "50%", transform: "translateX(-50%)" }}
    >
      <div className="flex flex-col gap-1">
        <label className="text-[9px] text-slate-500 uppercase font-black tracking-widest pl-1">Text</label>
        <input
          type="text"
          value={config.text}
          onChange={(e) => onChange({ ...config, text: e.target.value })}
          className="text-xs font-bold text-slate-700 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white min-w-[140px]"
        />
      </div>
      <div className="flex flex-col gap-1 w-20">
        <label className="text-[9px] text-slate-500 uppercase font-black tracking-widest pl-1">Size</label>
        <input
          type="number"
          step="0.5"
          value={config.size}
          onChange={(e) => onChange({ ...config, size: parseFloat(e.target.value) || 12 })}
          className="text-xs font-bold text-slate-700 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
        />
      </div>
      <div className="flex flex-col gap-1 w-14">
        <label className="text-[9px] text-slate-500 uppercase font-black tracking-widest pl-1">Color</label>
        <div className="w-full h-[34px] rounded-xl border border-slate-200 overflow-hidden relative shadow-sm">
          <input
            type="color"
            value={config.color}
            onChange={(e) => onChange({ ...config, color: e.target.value })}
            className="absolute -inset-4 w-20 h-20 cursor-pointer"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1 min-w-[100px]">
        <label className="text-[9px] text-slate-500 uppercase font-black tracking-widest pl-1">Font</label>
        <select
          value={config.fontFamily || "sans-serif"}
          onChange={(e) => onChange({ ...config, fontFamily: e.target.value })}
          className="text-xs font-bold text-slate-700 px-2.5 py-[7px] border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
        >
          <option value="sans-serif">Sans-Serif</option>
          <option value="serif">Serif</option>
          <option value="monospace">Monospace</option>
          <option value="cursive">Cursive</option>
        </select>
      </div>
      <div className="flex gap-1.5 items-end pb-0.5 ml-1">
        <button
          onClick={() => onChange({ ...config, isBold: !config.isBold })}
          className={`w-[34px] h-[34px] flex items-center justify-center rounded-xl transition-all shadow-sm ${
            config.isBold
               ? "bg-slate-800 text-white border border-slate-800"
               : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
          }`}
          title="Bold"
        >
          <b className="font-serif text-sm">B</b>
        </button>
        <button
          onClick={() => onChange({ ...config, isItalic: !config.isItalic })}
          className={`w-[34px] h-[34px] flex items-center justify-center rounded-xl transition-all shadow-sm ${
            config.isItalic
               ? "bg-slate-800 text-white border border-slate-800"
               : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
          }`}
          title="Italic"
        >
          <i className="font-serif text-sm">I</i>
        </button>
      </div>
      <div className="h-8 w-px bg-slate-200 mx-1"></div>
      <button onClick={onClose} className="text-slate-400 hover:text-rose-500 transition-colors p-1" title="Close Editor">
        {/* Safe Lucide fallback or Phosphor */}
        <span className="text-2xl font-bold leading-none">&times;</span>
      </button>
    </div>
  );
}

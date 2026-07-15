import React, { useState, useEffect } from "react";
import { DataHeaders } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { GitMerge, X, CheckCircle, MapPin, FlaskConical } from "lucide-react";

interface MappingModalProps {
  isOpen: boolean;
  uploadedHeaders: string[];
  initialHeaders: DataHeaders;
  initialHeaderMap: Record<string, string>;
  onSave: (mappedHeaders: DataHeaders, headerMap: Record<string, string>) => void;
  onCancel: () => void;
}

export default function MappingModal({
  isOpen,
  uploadedHeaders,
  initialHeaders,
  initialHeaderMap,
  onSave,
  onCancel,
}: MappingModalProps) {
  const [stateCol, setStateCol] = useState("");
  const [districtCol, setDistrictCol] = useState("");
  const [blockCol, setBlockCol] = useState("");
  const [wellIdCol, setWellIdCol] = useState("");
  const [locationCol, setLocationCol] = useState("");
  const [lonCol, setLonCol] = useState("");
  const [latCol, setLatCol] = useState("");
  const [yearCol, setYearCol] = useState("");
  const [seasonCol, setSeasonCol] = useState("");
  const [aquiferCol, setAquiferCol] = useState("");
  const [sourceCol, setSourceCol] = useState("");

  // Parameter mappings: key is PARAM_CONFIG key, value is uploaded Excel header
  const [paramMappings, setParamMappings] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setStateCol(initialHeaders.state || "");
      setDistrictCol(initialHeaders.district || "");
      setBlockCol(initialHeaders.block || "");
      setWellIdCol(initialHeaders.wellId || "");
      setLocationCol(initialHeaders.location || "");
      setLonCol(initialHeaders.longitude || "");
      setLatCol(initialHeaders.latitude || "");
      setYearCol(initialHeaders.year || "");
      setSeasonCol(initialHeaders.season || "");
      setAquiferCol(initialHeaders.aquifer || "");
      setSourceCol(initialHeaders.source || "");

      // Invert initialHeaderMap to match param keys
      const mapping: Record<string, string> = {};
      Object.keys(PARAM_CONFIG).forEach((paramKey) => {
        const foundExcelHeader = Object.keys(initialHeaderMap).find(
          (k) => initialHeaderMap[k] === paramKey
        );
        mapping[paramKey] = foundExcelHeader || "";
      });
      setParamMappings(mapping);
    }
  }, [isOpen, initialHeaders, initialHeaderMap]);

  if (!isOpen) return null;

  const handleParamChange = (paramKey: string, excelHeader: string) => {
    setParamMappings((prev) => ({
      ...prev,
      [paramKey]: excelHeader,
    }));
  };

  const handleConfirm = () => {
    const finalHeaders: DataHeaders = {
      state: stateCol || undefined,
      district: districtCol || undefined,
      block: blockCol || undefined,
      wellId: wellIdCol || undefined,
      location: locationCol || undefined,
      longitude: lonCol || undefined,
      latitude: latCol || undefined,
      year: yearCol || undefined,
      season: seasonCol || undefined,
      aquifer: aquiferCol || undefined,
      source: sourceCol || undefined,
      params: [],
    };

    const finalHeaderMap: Record<string, string> = {};

    Object.entries(paramMappings).forEach(([paramKey, excelHeader]) => {
      const headerStr = excelHeader as string;
      if (headerStr) {
        if (!finalHeaders.params.includes(headerStr)) {
          finalHeaders.params.push(headerStr);
        }
        finalHeaderMap[headerStr] = paramKey;
      }
    });

    onSave(finalHeaders, finalHeaderMap);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
      <div className="glossy-panel rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-white/50 bg-emerald-50/50 backdrop-blur flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-xl font-bold text-emerald-900 flex items-center gap-2 drop-shadow-md">
              <GitMerge className="text-emerald-600 w-5 h-5" /> Map Excel Columns
            </h2>
            <p className="text-xs font-bold text-emerald-700 mt-1 opacity-80">
              Verify how your uploaded spreadsheet columns match our hydrochemical compliance parameters
            </p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-rose-500 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Mappings Form */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
          
          {/* Geographical & Coordinate Identifiers */}
          <div className="bg-white/40 p-5 rounded-2xl shadow-inner border border-white/60 backdrop-blur-sm">
            <h3 className="font-bold text-slate-700 mb-4 uppercase text-xs tracking-widest border-b border-white/60 pb-3 flex items-center gap-2 drop-shadow-sm">
              <MapPin className="w-4 h-4 text-indigo-500" /> Base Information (Optional but recommended)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              
              {/* State */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">State</label>
                <select
                  value={stateCol}
                  onChange={(e) => setStateCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* District */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">District</label>
                <select
                  value={districtCol}
                  onChange={(e) => setDistrictCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Block */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">Block / Tehsil</label>
                <select
                  value={blockCol}
                  onChange={(e) => setBlockCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Station Id */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">Well / Station ID</label>
                <select
                  value={wellIdCol}
                  onChange={(e) => setWellIdCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Location */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">Location / Village</label>
                <select
                  value={locationCol}
                  onChange={(e) => setLocationCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Longitude */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">Longitude</label>
                <select
                  value={lonCol}
                  onChange={(e) => setLonCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Latitude */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">Latitude</label>
                <select
                  value={latCol}
                  onChange={(e) => setLatCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Year */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">Year</label>
                <select
                  value={yearCol}
                  onChange={(e) => setYearCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Season */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">Season</label>
                <select
                  value={seasonCol}
                  onChange={(e) => setSeasonCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Aquifer */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">Aquifer Type</label>
                <select
                  value={aquiferCol}
                  onChange={(e) => setAquiferCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Source */}
              <div className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">Source (e.g. Well, Handpump)</label>
                <select
                  value={sourceCol}
                  onChange={(e) => setSourceCol(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                >
                  <option value="">-- None / Ignore --</option>
                  {uploadedHeaders.map((h, i) => (
                    <option key={i} value={h}>{h}</option>
                  ))}
                </select>
              </div>

            </div>
          </div>

          {/* Chemical Water Quality Parameters */}
          <div className="bg-white/40 p-5 rounded-2xl shadow-inner border border-white/60 backdrop-blur-sm">
            <h3 className="font-bold text-slate-700 mb-4 uppercase text-xs tracking-widest border-b border-white/60 pb-3 flex items-center gap-2 drop-shadow-sm">
              <FlaskConical className="w-4 h-4 text-emerald-500" /> Water Quality Parameters
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              
              {Object.entries(PARAM_CONFIG).map(([paramKey, configItem]) => (
                <div key={paramKey} className="flex flex-col gap-1.5 bg-white/50 p-2.5 rounded-xl border border-white/60 shadow-inner">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate" title={configItem.name}>
                    {configItem.name} ({paramKey})
                  </label>
                  <select
                    value={paramMappings[paramKey] || ""}
                    onChange={(e) => handleParamChange(paramKey, e.target.value)}
                    className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 font-bold text-slate-700"
                  >
                    <option value="">-- None / Ignore --</option>
                    {uploadedHeaders.map((h, i) => (
                      <option key={i} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}

            </div>
          </div>

        </div>

        {/* Footer controls */}
        <div className="p-5 border-t border-white/50 flex justify-between items-center gap-3 bg-white/30 backdrop-blur shrink-0">
          <p className="text-xs font-bold text-slate-500 hidden sm:block">
            Columns left unmapped will be ignored in output compliance tables.
          </p>
          <div className="flex gap-3 justify-end w-full sm:w-auto">
            <button
              onClick={onCancel}
              className="px-6 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50 transition-colors"
            >
              Cancel Upload
            </button>
            <button
              onClick={handleConfirm}
              className="glossy-btn-emerald px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" /> Confirm Mapping
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

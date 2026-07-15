import React, { useState } from "react";
import { PARAM_CONFIG, DEFAULT_PARAM_CONFIG, updateParamLimits, resetParamLimits } from "../data/config";
import { Settings, RotateCcw, Save, Search, Check, AlertCircle, Info, Sliders } from "lucide-react";

interface LimitsManagerViewProps {
  onLimitsChanged: () => void;
}

export default function LimitsManagerView({ onLimitsChanged }: LimitsManagerViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingLimits, setEditingLimits] = useState<Record<string, { b1: string; b2: string }>>(() => {
    const initial: Record<string, { b1: string; b2: string }> = {};
    Object.keys(PARAM_CONFIG).forEach((key) => {
      initial[key] = {
        b1: String(PARAM_CONFIG[key].b1),
        b2: String(PARAM_CONFIG[key].b2),
      };
    });
    return initial;
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  const handleInputChange = (key: string, field: "b1" | "b2", value: string) => {
    setEditingLimits((prev) => {
      const updated = { ...prev[key], [field]: value };
      if ((key === "SAR" || key === "RSC") && field === "b2") {
        updated.b1 = value;
      }
      return {
        ...prev,
        [key]: updated,
      };
    });

    if (validationErrors[key]) {
      setValidationErrors((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  };

  const validateAll = (): boolean => {
    const errors: Record<string, string> = {};
    Object.keys(PARAM_CONFIG).forEach((key) => {
      const b1Val = parseFloat(editingLimits[key].b1);
      const b2Val = parseFloat(editingLimits[key].b2);

      if (key === "SAR" || key === "RSC") {
        if (isNaN(b2Val) || b2Val < 0) {
          errors[key] = "Permissible limit must be a valid positive number";
        }
      } else {
        if (isNaN(b1Val) || b1Val < 0) {
          errors[key] = "Acceptable limit must be a valid positive number";
        } else if (isNaN(b2Val) || b2Val < 0) {
          errors[key] = "Permissible limit must be a valid positive number";
        } else if (b1Val > b2Val && key !== "pH") {
          errors[key] = "Acceptable limit should not be greater than Permissible limit";
        }
      }
    });

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = () => {
    if (!validateAll()) {
      return;
    }

    Object.keys(editingLimits).forEach((key) => {
      const b1 = parseFloat(editingLimits[key].b1);
      const b2 = parseFloat(editingLimits[key].b2);
      updateParamLimits(key, b1, b2);
    });

    onLimitsChanged();
    setShowSuccessToast(true);
    setTimeout(() => {
      setShowSuccessToast(false);
    }, 3000);
  };

  const handleReset = () => {
    if (window.confirm("Are you sure you want to restore all parameters to default Indian Standard (IS 10500:2012) limits?")) {
      resetParamLimits();
      const resetState: Record<string, { b1: string; b2: string }> = {};
      Object.keys(DEFAULT_PARAM_CONFIG).forEach((key) => {
        resetState[key] = {
          b1: String(DEFAULT_PARAM_CONFIG[key].b1),
          b2: String(DEFAULT_PARAM_CONFIG[key].b2),
        };
      });
      setEditingLimits(resetState);
      setValidationErrors({});
      onLimitsChanged();

      setShowSuccessToast(true);
      setTimeout(() => {
        setShowSuccessToast(false);
      }, 3000);
    }
  };

  const filteredKeys = Object.keys(PARAM_CONFIG).filter((key) => {
    const cfg = PARAM_CONFIG[key];
    const matchStr = `${key} ${cfg.name}`.toLowerCase();
    return matchStr.includes(searchTerm.toLowerCase());
  });

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-6 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl border border-indigo-100">
              <Settings className="w-6 h-6 animate-spin-slow" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                Parameter Limits Manager
                <span className="text-[10px] bg-indigo-50 text-indigo-600 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider border border-indigo-100">
                  Interactive Config
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Customize Acceptable and Permissible standards. All downstream charts, GIS maps, matrices, and PDF reports will dynamically recompute.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <button
            onClick={handleReset}
            className="flex-1 md:flex-initial flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-250 text-slate-700 hover:text-slate-900 font-extrabold text-xs px-4 py-3 rounded-2xl border border-slate-200 transition-all active:scale-95 shadow-sm"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to BIS Defaults
          </button>
          <button
            onClick={handleSave}
            className="flex-1 md:flex-initial flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-5 py-3 rounded-2xl transition-all active:scale-95 shadow-md shadow-indigo-100 border border-indigo-500"
          >
            <Save className="w-4 h-4" />
            Save & Recompute Limits
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-2xl mb-6 flex gap-3">
        <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-xs font-black text-amber-800 uppercase tracking-wider">Active Standard Specification (IS 10500 : 2012)</h4>
          <p className="text-[11px] text-slate-700 mt-1 leading-relaxed">
            These values govern chemical suitability classification. Changing the <strong>Acceptable (Desirable) Limit</strong> will shift safety thresholds, while altering the <strong>Permissible Limit (in absence of alternate source)</strong> will redefine strict exceedance metrics across the entire application workspace.
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-6">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search parameter, formula or full name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 rounded-2xl py-2.5 pl-10 pr-4 text-xs font-bold text-slate-800 outline-none transition-all placeholder:text-slate-400"
          />
        </div>
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
          Showing <span className="text-indigo-600 font-extrabold">{filteredKeys.length}</span> of <span className="text-indigo-600 font-extrabold">{Object.keys(PARAM_CONFIG).length}</span> parameters
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredKeys.map((key) => {
          const config = PARAM_CONFIG[key];
          const hasError = !!validationErrors[key];
          const isModified = 
            parseFloat(editingLimits[key].b1) !== DEFAULT_PARAM_CONFIG[key].b1 ||
            parseFloat(editingLimits[key].b2) !== DEFAULT_PARAM_CONFIG[key].b2;

          return (
            <div
              key={key}
              className={`bg-white rounded-2xl p-4 border transition-all duration-150 shadow-xs ${
                hasError
                  ? "border-rose-300 shadow-sm shadow-rose-100 bg-rose-50/10"
                  : isModified
                  ? "border-emerald-400 shadow-sm shadow-emerald-50 bg-emerald-50/5"
                  : "border-slate-200 hover:border-indigo-200 hover:shadow-md"
              }`}
            >
              <div className="flex justify-between items-start gap-2 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-black text-indigo-700 tracking-tight font-mono">
                      {key}
                    </span>
                    <span className="text-[10px] text-slate-700 font-extrabold truncate">
                      ({config.name})
                    </span>
                  </div>
                  {config.unit && (
                    <span className="inline-block text-[9.5px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-md mt-1 border border-slate-200/80 font-mono">
                      {config.unit}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1 items-end">
                  {isModified && (
                    <span className="text-[8.5px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100/80 border border-emerald-300 px-1.5 py-0.5 rounded">
                      Modified
                    </span>
                  )}
                  {hasError && (
                    <span className="text-[8.5px] font-black uppercase tracking-wider text-rose-700 bg-rose-100/80 border border-rose-300 px-1.5 py-0.5 rounded">
                      Error
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                {key !== "SAR" && key !== "RSC" ? (
                  <>
                    <div>
                      <label className="block text-[9.5px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                        Acceptable Limit
                      </label>
                      <div className="relative rounded-xl overflow-hidden shadow-xs">
                        <input
                          type="text"
                          value={editingLimits[key].b1}
                          onChange={(e) => handleInputChange(key, "b1", e.target.value)}
                          className={`w-full bg-slate-50 border text-xs font-black font-mono p-2.5 outline-none rounded-xl text-center transition-all ${
                            hasError 
                              ? "border-rose-500 text-rose-700 focus:ring-1 focus:ring-rose-500 bg-white" 
                              : "border-slate-200 text-slate-900 hover:border-slate-350 focus:border-indigo-600 focus:text-indigo-700 focus:bg-white"
                          }`}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9.5px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                        Permissible Limit
                      </label>
                      <div className="relative rounded-xl overflow-hidden shadow-xs">
                        <input
                          type="text"
                          value={editingLimits[key].b2}
                          onChange={(e) => handleInputChange(key, "b2", e.target.value)}
                          className={`w-full bg-slate-50 border text-xs font-black font-mono p-2.5 outline-none rounded-xl text-center transition-all ${
                            hasError 
                              ? "border-rose-500 text-rose-700 focus:ring-1 focus:ring-rose-500 bg-white" 
                              : "border-slate-200 text-slate-900 hover:border-slate-350 focus:border-indigo-600 focus:text-indigo-700 focus:bg-white"
                          }`}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="col-span-2">
                    <label className="block text-[9.5px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                      Permissible Limit (Irrigation Standard)
                    </label>
                    <div className="relative rounded-xl overflow-hidden shadow-xs">
                      <input
                        type="text"
                        value={editingLimits[key].b2}
                        onChange={(e) => handleInputChange(key, "b2", e.target.value)}
                        className={`w-full bg-slate-50 border text-xs font-black font-mono p-2.5 outline-none rounded-xl text-center transition-all ${
                          hasError 
                            ? "border-rose-500 text-rose-700 focus:ring-1 focus:ring-rose-500 bg-white" 
                            : "border-slate-200 text-slate-900 hover:border-slate-350 focus:border-indigo-600 focus:text-indigo-700 focus:bg-white"
                        }`}
                      />
                    </div>
                  </div>
                )}
              </div>

              {hasError && (
                <div className="mt-2.5 text-[10px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{validationErrors[key]}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredKeys.length === 0 && (
        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-200 mt-4">
          <Sliders className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h4 className="text-sm font-black text-slate-600">No Parameters Match Filter Criteria</h4>
          <p className="text-xs text-slate-400 mt-1">Try refining your search text or key terms.</p>
        </div>
      )}

      <div className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-indigo-650 animate-ping" />
          <p className="text-[11px] text-slate-600 font-bold">
            Unsaved limit changes will only apply once you press the <strong>Save & Recompute</strong> action.
          </p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <button
            onClick={handleSave}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all active:scale-95 shadow-md border border-indigo-500"
          >
            <Save className="w-4 h-4" />
            Apply & Recompute All Modules
          </button>
        </div>
      </div>

      {showSuccessToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl flex items-center gap-3 shadow-2xl border border-emerald-500 font-extrabold text-xs uppercase tracking-wider">
          <div className="p-1 bg-white/20 rounded-full">
            <Check className="w-4 h-4" />
          </div>
          Parameter Limits Saved & Calculations Updated!
        </div>
      )}
    </div>
  );
}

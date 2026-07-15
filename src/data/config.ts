import { ParamConfigMap, RemedialMeasuresMap } from "../types";

export const DEFAULT_PARAM_CONFIG: ParamConfigMap = {
  'pH': { b1: 6.5, b2: 8.5, unit: '', name: 'pH Level', keywords: ['ph', 'ph level', 'hydrogen'] },
  'TDS': { b1: 500, b2: 2000, unit: 'mg/L', name: 'Total Dissolved Solids', keywords: ['tds', 'total dissolved solids'] },
  'Turbidity': { b1: 1, b2: 5, unit: 'NTU', name: 'Turbidity', keywords: ['turbidity'] },
  'Alkalinity': { b1: 200, b2: 600, unit: 'mg/L', name: 'Total Alkalinity', keywords: ['alkalinity', 'total alkalinity'] },
  'TH': { b1: 200, b2: 600, unit: 'mg/L as CaCO3', name: 'Total Hardness', keywords: ['th', 'total hardness', 'hardness'] },
  'EC': { b1: 750, b2: 3000, unit: 'µS/cm at 25°C', name: 'Electrical Conductivity', keywords: ['ec', 'cond', 'conductivity', 'electrical conductivity'] },
  'Cl': { b1: 250, b2: 1000, unit: 'mg/L', name: 'Chloride', keywords: ['cl', 'chloride'] },
  'NO3': { b1: 45, b2: 45, unit: 'mg/L', name: 'Nitrate', keywords: ['no3', 'nitrate'] },
  'F': { b1: 1.0, b2: 1.5, unit: 'mg/L', name: 'Fluoride', keywords: ['f', 'fluoride'] },
  'Fe': { b1: 1.0, b2: 1.0, unit: 'mg/L', name: 'Iron', keywords: ['fe', 'iron', 'total iron'] },
  'As': { b1: 10, b2: 10, unit: 'ppb', name: 'Arsenic', keywords: ['as', 'arsenic'] },
  'U': { b1: 30, b2: 30, unit: 'ppb', name: 'Uranium', keywords: ['u', 'uranium'] },
  'Zn': { b1: 5, b2: 15, unit: 'mg/L', name: 'Zinc', keywords: ['zn', 'zinc'] },
  'Cu': { b1: 0.05, b2: 1.5, unit: 'mg/L', name: 'Copper', keywords: ['cu', 'copper'] },
  'Pb': { b1: 0.01, b2: 0.01, unit: 'mg/L', name: 'Lead', keywords: ['Pb', 'lead'] },
  'Cd': { b1: 0.003, b2: 0.003, unit: 'mg/L', name: 'Cadmium', keywords: ['cd', 'cadmium'] },
  'Cr': { b1: 0.05, b2: 0.05, unit: 'mg/L', name: 'Chromium', keywords: ['cr', 'chromium'] },
  'Hg': { b1: 0.001, b2: 0.001, unit: 'mg/L', name: 'Mercury', keywords: ['hg', 'mercury'] },
  'Ni': { b1: 0.02, b2: 0.02, unit: 'mg/L', name: 'Nickel', keywords: ['ni', 'nickel'] },
  'Se': { b1: 0.01, b2: 0.01, unit: 'mg/L', name: 'Selenium', keywords: ['se', 'selenium'] },
  'Ca': { b1: 75, b2: 200, unit: 'mg/L', name: 'Calcium', keywords: ['ca', 'calcium'] },
  'Mg': { b1: 30, b2: 100, unit: 'mg/L', name: 'Magnesium', keywords: ['mg', 'magnesium'] },
  'Na': { b1: 200, b2: 200, unit: 'mg/L', name: 'Sodium', keywords: ['na', 'sodium', 'na+'] },
  'HCO3': { b1: 200, b2: 600, unit: 'mg/L', name: 'Bicarbonate', keywords: ['hco3', 'bicarbonate', 'hco3-'] },
  'CO3': { b1: 10, b2: 30, unit: 'mg/L', name: 'Carbonate', keywords: ['co3', 'carbonate', 'co3--'] },
  'SO4': { b1: 200, b2: 400, unit: 'mg/L', name: 'Sulphate', keywords: ['so4', 'sulphate', 'sulfate'] },
  'Mn': { b1: 0.1, b2: 0.3, unit: 'mg/L', name: 'Manganese', keywords: ['Mn', 'Manganese'] },
  'Al': { b1: 0.03, b2: 0.2, unit: 'mg/L', name: 'Alluminium', keywords: ['Al', 'Alluminium'] },
  'Ba': { b1: 0.7, b2: 0.7, unit: 'mg/L', name: 'Barium', keywords: ['Ba', 'Barium'] },
  'B': { b1: 0.5, b2: 2.4, unit: 'mg/L', name: 'Boran', keywords: ['B', 'Boran'] },
  'Mo': { b1: 0.05, b2: 0.07, unit: 'mg/L', name: 'Molybdnum', keywords: ['Mo', 'Molybdnum'] },
  'SAR': { b1: 26, b2: 26, unit: '', name: 'Sodium Adsorption Ratio', keywords: ['sar', 'sodium adsorption ratio'] },
  'RSC': { b1: 2.5, b2: 2.5, unit: 'meq/L', name: 'Residual Sodium Carbonate', keywords: ['rsc', 'residual sodium carbonate'] },
};

// Mutable PARAM_CONFIG copy that consumes files read from directly
export const PARAM_CONFIG: ParamConfigMap = JSON.parse(JSON.stringify(DEFAULT_PARAM_CONFIG));

// Self-invoking initializer to load saved overrides from localStorage on module boot
(() => {
  try {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("water_quality_param_limits") : null;
    if (saved) {
      const overrides = JSON.parse(saved);
      Object.keys(overrides).forEach((key) => {
        if (PARAM_CONFIG[key]) {
          PARAM_CONFIG[key].b1 = overrides[key].b1;
          PARAM_CONFIG[key].b2 = overrides[key].b2;
        }
      });
    }
  } catch (e) {
    console.error("Failed to load custom water quality parameter limits:", e);
  }
})();

export function updateParamLimits(key: string, b1: number, b2: number) {
  if (PARAM_CONFIG[key]) {
    PARAM_CONFIG[key].b1 = b1;
    PARAM_CONFIG[key].b2 = b2;

    try {
      const saved = window.localStorage.getItem("water_quality_param_limits");
      const overrides = saved ? JSON.parse(saved) : {};
      overrides[key] = { b1, b2 };
      window.localStorage.setItem("water_quality_param_limits", JSON.stringify(overrides));
    } catch (e) {
      console.error("Failed to save custom water quality parameter limits:", e);
    }
  }
}

export function resetParamLimits() {
  try {
    window.localStorage.removeItem("water_quality_param_limits");
  } catch (e) {
    console.error("Failed to clear custom water quality parameter limits:", e);
  }

  // Restore defaults
  Object.keys(DEFAULT_PARAM_CONFIG).forEach((key) => {
    if (PARAM_CONFIG[key]) {
      PARAM_CONFIG[key].b1 = DEFAULT_PARAM_CONFIG[key].b1;
      PARAM_CONFIG[key].b2 = DEFAULT_PARAM_CONFIG[key].b2;
    }
  });
}

export const ALL_REMEDIAL_MEASURES: RemedialMeasuresMap = {
  'pH': [
    { method: 'Alkaline/Acid Dosing', principle: 'Chemical neutralization', suitability: 'Extreme pH levels', adv: 'Fast adjustment' },
    { method: 'Limestone Filtration', principle: 'Dissolution of calcium carbonate', suitability: 'Acidic groundwater', adv: 'Self-regulating & cheap' }
  ],
  'TDS': [
    { method: 'Reverse Osmosis (RO)', principle: 'Semi-permeable membrane filtration', suitability: 'High TDS > 2000 mg/l', adv: 'Removes >95% dissolved solids' },
    { method: 'Electrodialysis Reversal', principle: 'Ion migration via electrical potential', suitability: 'Brackish water', adv: 'High recovery rate' }
  ],
  'TH': [
    { method: 'Ion Exchange Softening', principle: 'Replacing Ca++ and Mg++ with Na+', suitability: 'High Hardness', adv: 'Zero hardness achievable' },
    { method: 'Lime-Soda Ash Process', principle: 'Precipitation of calcium/magnesium', suitability: 'Large scale municipal treatment', adv: 'Cost effective at scale' }
  ],
  'F': [
    { method: 'Nalgonda Technique', principle: 'Flocculation using Alum and Lime', suitability: 'Community level', adv: 'Developed in India, proven' },
    { method: 'Activated Alumina', principle: 'Adsorption of fluoride ions', suitability: 'Household/Community filters', adv: 'Highly specific to fluoride' }
  ],
  'As': [
    { method: 'Co-precipitation with Iron', principle: 'Adsorption onto iron hydroxides', suitability: 'High As and Fe groundwater', adv: 'Uses naturally occurring iron' },
    { method: 'Activated Carbon/Alumina', principle: 'Media bed adsorption', suitability: 'Drinking water systems', adv: 'Simple operation' }
  ],
  'Fe': [
    { method: 'Aeration & Filtration', principle: 'Oxidizing soluble Fe(II) to insoluble Fe(III)', suitability: 'High dissolved iron', adv: 'No chemicals required' },
    { method: 'Greensand Filtration', principle: 'Catalytic oxidation', suitability: 'Iron and Manganese', adv: 'Continuous operation' }
  ],
  'NO3': [
    { method: 'Ion Exchange', principle: 'Anion exchange resin (Cl- for NO3-)', suitability: 'Agricultural areas', adv: 'Reliable removal' },
    { method: 'Biological Denitrification', principle: 'Bacterial reduction of nitrate to nitrogen gas', suitability: 'Large scale systems', adv: 'Destroys nitrate completely' }
  ],
  'default': [
    { method: 'Reverse Osmosis (RO)', principle: 'High-pressure membrane filtration', suitability: 'Broad spectrum contaminants', adv: 'Produces near-pure water' },
    { method: 'Activated Carbon Filtration', principle: 'Adsorption in porous media', suitability: 'Organics & heavy metals', adv: 'Improves taste and odor' }
  ]
};

// Map common aliases
ALL_REMEDIAL_MEASURES['Ca'] = ALL_REMEDIAL_MEASURES['TH'];
ALL_REMEDIAL_MEASURES['Mg'] = ALL_REMEDIAL_MEASURES['TH'];
ALL_REMEDIAL_MEASURES['EC'] = ALL_REMEDIAL_MEASURES['TDS'];
ALL_REMEDIAL_MEASURES['Cl'] = ALL_REMEDIAL_MEASURES['TDS'];
ALL_REMEDIAL_MEASURES['SO4'] = ALL_REMEDIAL_MEASURES['TDS'];
ALL_REMEDIAL_MEASURES['U'] = ALL_REMEDIAL_MEASURES['default'];

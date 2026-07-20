import React, { useState, useMemo, useEffect } from "react";
import {
  Calculator,
  Beaker,
  FileSpreadsheet,
  Waves,
  Info,
  Search,
  RefreshCw,
  Check,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  TrendingUp,
  Compass,
  ArrowRight,
  Table,
  Settings,
  Sliders,
  Activity,
  Layers,
  Percent
} from "lucide-react";
import { DataHeaders } from "../types";

export interface CalculatoriusViewProps {
  rawData?: any[];
  headerMap?: Record<string, string>;
  headers?: DataHeaders;
}

interface ChemicalInputs {
  state: string;
  district: string;
  block: string;
  location: string;
  wellId: string;
  year: string;
  season: string;
  pH: number;
  ec: number;
  ca: number;
  mg: number;
  na: number;
  k: number;
  cl: number;
  so4: number;
  hco3: number;
  co3: number;
  tds: number;
  alkalinity: number;
}

// Standard equivalent weights of major ions
const EQ_WEIGHTS = {
  Ca: 20.04,
  Mg: 12.15,
  Na: 22.99,
  K: 39.10,
  Cl: 35.45,
  SO4: 48.03,
  HCO3: 61.02,
  CO3: 30.00
};

// Preset water profiles for direct user evaluation and learning
const DEFAULT_PRESETS: Record<string, ChemicalInputs> = {
  fresh: {
    state: "Uttar Pradesh",
    district: "Kanpur Nagar",
    block: "Kalyanpur",
    location: "Kalyanpur Well #2",
    wellId: "UP-KAN-002",
    year: "2024",
    season: "Pre-Monsoon",
    pH: 7.4,
    ec: 620,
    ca: 78.5,
    mg: 24.3,
    na: 32.1,
    k: 2.4,
    cl: 45.0,
    so4: 28.0,
    hco3: 285.0,
    co3: 0,
    tds: 395,
    alkalinity: 233.6
  },
  coastal: {
    state: "West Bengal",
    district: "South 24 Parganas",
    block: "Sagar",
    location: "Gangasagar Tube-Well",
    wellId: "WB-S24P-049",
    year: "2024",
    season: "Pre-Monsoon",
    pH: 8.1,
    ec: 3450,
    ca: 112.0,
    mg: 86.4,
    na: 580.0,
    k: 12.5,
    cl: 980.0,
    so4: 195.0,
    hco3: 340.0,
    co3: 12.0,
    tds: 2240,
    alkalinity: 298.8
  },
  alkaline: {
    state: "Rajasthan",
    district: "Nagaur",
    block: "Didwana",
    location: "Didwana Sodic Spring",
    wellId: "RJ-NAG-014",
    year: "2023",
    season: "Post-Monsoon",
    pH: 8.8,
    ec: 2100,
    ca: 15.0,
    mg: 9.8,
    na: 460.0,
    k: 4.5,
    cl: 280.0,
    so4: 160.0,
    hco3: 680.0,
    co3: 45.0,
    tds: 1344,
    alkalinity: 632.4
  }
};

interface PearsonMatrix {
  headers: string[];
  matrix: number[][];
}

function computePearsonMatrix(data: any[], headerMap: Record<string, string>): PearsonMatrix {
  const candidateKeys = ["pH", "TDS", "EC", "Ca", "Mg", "Na", "K", "Cl", "SO4", "HCO3", "CO3"];
  const presentKeys = candidateKeys.filter(param => {
    const excelKey = headerMap[param] || param;
    let validCount = 0;
    for (let i = 0; i < data.length; i++) {
      const val = parseFloat(data[i][excelKey]);
      if (!isNaN(val)) validCount++;
      if (validCount >= 2) return true;
    }
    return false;
  });

  if (presentKeys.length < 2) {
    const fallbackHeaders = ["pH", "EC", "TDS", "Ca", "Mg", "Na", "Cl", "HCO3"];
    const fallbackMatrix = [
      [1.00, -0.12, -0.10, -0.05, -0.08, -0.15, -0.11, 0.22],
      [-0.12, 1.00, 0.98, 0.78, 0.72, 0.85, 0.82, 0.45],
      [-0.10, 0.98, 1.00, 0.80, 0.74, 0.84, 0.81, 0.43],
      [-0.05, 0.78, 0.80, 1.00, 0.55, 0.42, 0.48, 0.62],
      [-0.08, 0.72, 0.74, 0.55, 1.00, 0.38, 0.52, 0.48],
      [-0.15, 0.85, 0.84, 0.42, 0.38, 1.00, 0.88, 0.25],
      [-0.11, 0.82, 0.81, 0.48, 0.52, 0.88, 1.00, 0.18],
      [0.22, 0.45, 0.43, 0.62, 0.48, 0.25, 0.18, 1.00]
    ];
    return { headers: fallbackHeaders, matrix: fallbackMatrix };
  }

  const matrix: number[][] = [];
  for (let i = 0; i < presentKeys.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < presentKeys.length; j++) {
      if (i === j) {
        matrix[i][j] = 1.0;
        continue;
      }
      
      const keyX = headerMap[presentKeys[i]] || presentKeys[i];
      const keyY = headerMap[presentKeys[j]] || presentKeys[j];

      const xVals: number[] = [];
      const yVals: number[] = [];

      for (let k = 0; k < data.length; k++) {
        const valX = parseFloat(data[k][keyX]);
        const valY = parseFloat(data[k][keyY]);
        if (!isNaN(valX) && !isNaN(valY)) {
          xVals.push(valX);
          yVals.push(valY);
        }
      }

      if (xVals.length < 2) {
        matrix[i][j] = 0.0;
        continue;
      }

      const meanX = xVals.reduce((sum, v) => sum + v, 0) / xVals.length;
      const meanY = yVals.reduce((sum, v) => sum + v, 0) / yVals.length;

      let num = 0;
      let denX = 0;
      let denY = 0;

      for (let k = 0; k < xVals.length; k++) {
        const diffX = xVals[k] - meanX;
        const diffY = yVals[k] - meanY;
        num += diffX * diffY;
        denX += diffX * diffX;
        denY += diffY * diffY;
      }

      const den = Math.sqrt(denX * denY);
      matrix[i][j] = den === 0 ? 0.0 : num / den;
    }
  }

  return { headers: presentKeys, matrix };
}

export const CalculatoriusView: React.FC<CalculatoriusViewProps> = ({
  rawData = [],
  headerMap = {},
  headers
}) => {
  // Available list of samples mapped from rawData
  const parsedSamples = useMemo(() => {
    if (!rawData || rawData.length === 0) return [];

    const stateCol = headers?.state || "State";
    const districtCol = headers?.district || "District";
    const blockCol = headers?.block || "Block";
    const locationCol = headers?.location || "Location";
    const wellIdCol = headers?.wellId || "Well ID";
    const yearCol = headers?.year || "Year";
    const seasonCol = headers?.season || "Season";

    return rawData.map((row, idx) => {
      const getVal = (param: string): number => {
        const mappedCol = headerMap[param] || param;
        const val = parseFloat(row[mappedCol]);
        return isNaN(val) ? 0 : val;
      };

      return {
        id: idx,
        state: String(row[stateCol] || "").trim() || "Unknown State",
        district: String(row[districtCol] || "").trim() || "Unknown District",
        block: String(row[blockCol] || "").trim() || "Unknown Block",
        location: String(row[locationCol] || "").trim() || `Site #${idx + 1}`,
        wellId: String(row[wellIdCol] || "").trim() || `W-${idx + 1}`,
        year: String(row[yearCol] || "").trim() || "2024",
        season: String(row[seasonCol] || "").trim() || "Pre-Monsoon",
        pH: getVal("pH") || 7.0,
        ec: getVal("EC") || 0,
        ca: getVal("Ca") || 0,
        mg: getVal("Mg") || 0,
        na: getVal("Na") || 0,
        k: getVal("K") || 0,
        cl: getVal("Cl") || 0,
        so4: getVal("SO4") || 0,
        hco3: getVal("HCO3") || 0,
        co3: getVal("CO3") || 0,
        tds: getVal("TDS") || 0,
        alkalinity: getVal("Alkalinity") || 0
      };
    });
  }, [rawData, headerMap, headers]);

  // Initial Inputs selection
  const [inputs, setInputs] = useState<ChemicalInputs>(DEFAULT_PRESETS.fresh);
  const [selectedSampleId, setSelectedSampleId] = useState<number | string>("preset-fresh");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<string>("meq");

  // Sync with rawData first sample on load if available
  useEffect(() => {
    if (parsedSamples.length > 0) {
      setInputs(parsedSamples[0]);
      setSelectedSampleId(0);
    }
  }, [parsedSamples]);

  // Handle preset or sample changes
  const handleSampleSelect = (val: string) => {
    setSelectedSampleId(val);
    if (val.startsWith("preset-")) {
      const presetKey = val.replace("preset-", "");
      if (DEFAULT_PRESETS[presetKey]) {
        setInputs({ ...DEFAULT_PRESETS[presetKey] });
      }
    } else {
      const idx = parseInt(val);
      if (!isNaN(idx) && parsedSamples[idx]) {
        setInputs({ ...parsedSamples[idx] });
      }
    }
  };

  // Filtered samples for searchable selector
  const filteredSearchSamples = useMemo(() => {
    if (!searchQuery.trim()) return parsedSamples.slice(0, 30);
    const q = searchQuery.toLowerCase();
    return parsedSamples
      .filter(
        (s) =>
          s.location.toLowerCase().includes(q) ||
          s.block.toLowerCase().includes(q) ||
          s.district.toLowerCase().includes(q) ||
          s.state.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [parsedSamples, searchQuery]);

  // Dynamic chemical math tracing engine
  const calc = useMemo(() => {
    const { pH, ec, ca, mg, na, k, cl, so4, hco3, co3, tds: inputTds, alkalinity: inputAlk } = inputs;

    // 1. meq/L conversions
    const meq = {
      Ca: ca / EQ_WEIGHTS.Ca,
      Mg: mg / EQ_WEIGHTS.Mg,
      Na: na / EQ_WEIGHTS.Na,
      K: k / EQ_WEIGHTS.K,
      Cl: cl / EQ_WEIGHTS.Cl,
      SO4: so4 / EQ_WEIGHTS.SO4,
      HCO3: hco3 / EQ_WEIGHTS.HCO3,
      CO3: co3 / EQ_WEIGHTS.CO3
    };

    const tzPlus = meq.Ca + meq.Mg + meq.Na + meq.K;
    const tzMinus = meq.Cl + meq.SO4 + meq.HCO3 + meq.CO3;

    const meqSteps = [
      `Cations Conversions (Concentration divided by Equivalent Weight):`,
      `• Ca²⁺: ${ca.toFixed(2)} mg/L ÷ ${EQ_WEIGHTS.Ca} = ${meq.Ca.toFixed(4)} meq/L`,
      `• Mg²⁺: ${mg.toFixed(2)} mg/L ÷ ${EQ_WEIGHTS.Mg} = ${meq.Mg.toFixed(4)} meq/L`,
      `• Na⁺ : ${na.toFixed(2)} mg/L ÷ ${EQ_WEIGHTS.Na} = ${meq.Na.toFixed(4)} meq/L`,
      `• K⁺  : ${k.toFixed(2)} mg/L ÷ ${EQ_WEIGHTS.K} = ${meq.K.toFixed(4)} meq/L`,
      `Anions Conversions (Concentration divided by Equivalent Weight):`,
      `• Cl⁻ : ${cl.toFixed(2)} mg/L ÷ ${EQ_WEIGHTS.Cl} = ${meq.Cl.toFixed(4)} meq/L`,
      `• SO₄²⁻: ${so4.toFixed(2)} mg/L ÷ ${EQ_WEIGHTS.SO4} = ${meq.SO4.toFixed(4)} meq/L`,
      `• HCO₃⁻: ${hco3.toFixed(2)} mg/L ÷ ${EQ_WEIGHTS.HCO3} = ${meq.HCO3.toFixed(4)} meq/L`,
      `• CO₃²⁻: ${co3.toFixed(2)} mg/L ÷ ${EQ_WEIGHTS.CO3} = ${meq.CO3.toFixed(4)} meq/L`,
      `Sum of Electrically Charged Ions:`,
      `• Total Cations (TZ⁺) = Ca²⁺ + Mg²⁺ + Na⁺ + K⁺ = ${tzPlus.toFixed(4)} meq/L`,
      `• Total Anions (TZ⁻)  = Cl⁻ + SO₄²⁻ + HCO₃⁻ + CO₃²⁻ = ${tzMinus.toFixed(4)} meq/L`
    ];

    // 2. Charge Balance Error (CBE)
    const sumIons = tzPlus + tzMinus;
    const cbe = sumIons > 0 ? ((tzPlus - tzMinus) / sumIons) * 100 : 0;
    const cbeSteps = [
      `CBE Formula: CBE (%) = [(TZ⁺ - TZ⁻) / (TZ⁺ + TZ⁻)] × 100`,
      `Substituting active cation/anion sums:`,
      `• TZ⁺ (Cations) = ${tzPlus.toFixed(4)} meq/L`,
      `• TZ⁻ (Anions)  = ${tzMinus.toFixed(4)} meq/L`,
      `• TZ⁺ - TZ⁻ = ${(tzPlus - tzMinus).toFixed(4)} meq/L`,
      `• TZ⁺ + TZ⁻ = ${sumIons.toFixed(4)} meq/L`,
      `Calculation: (${(tzPlus - tzMinus).toFixed(4)} ÷ ${sumIons.toFixed(4)}) × 100 = ${cbe.toFixed(3)}%`
    ];
    let cbeStatus = "Excellent";
    let cbeColor = "text-emerald-600 bg-emerald-50 border-emerald-100";
    if (Math.abs(cbe) > 10) {
      cbeStatus = "Poor / Invalid";
      cbeColor = "text-rose-600 bg-rose-50 border-rose-100";
    } else if (Math.abs(cbe) > 5) {
      cbeStatus = "Acceptable";
      cbeColor = "text-amber-600 bg-amber-50 border-amber-100";
    }

    // 3. TDS Estimation
    let tds = inputTds;
    let isTdsEstimated = false;
    let tdsSteps = [];
    if (tds <= 0) {
      tds = ec * 0.64;
      isTdsEstimated = true;
      tdsSteps.push(`TDS was missing or zero. Estimated using EC (Electrical Conductivity) conversion factor:`);
      tdsSteps.push(`Formula: TDS (mg/L) = EC (µS/cm) × 0.64`);
      tdsSteps.push(`Substitution: ${ec} × 0.64 = ${tds.toFixed(1)} mg/L`);
    } else {
      tdsSteps.push(`TDS is explicitly provided as ${tds.toFixed(1)} mg/L in the groundwater sample records.`);
      tdsSteps.push(`For reference, TDS can be estimated from EC of ${ec} µS/cm:`);
      tdsSteps.push(`Calculated estimate: EC × 0.64 = ${(ec * 0.64).toFixed(1)} mg/L (Difference: ${(tds - ec * 0.64).toFixed(1)} mg/L)`);
    }
    let tdsStatus = "Acceptable";
    let tdsColor = "text-emerald-600 bg-emerald-50 border-emerald-100";
    if (tds > 2000) {
      tdsStatus = "Exceeded (Poor)";
      tdsColor = "text-rose-600 bg-rose-50 border-rose-100";
    } else if (tds > 500) {
      tdsStatus = "Permissible (BIS)";
      tdsColor = "text-amber-600 bg-amber-50 border-amber-100";
    }

    // 4. Total Alkalinity
    let alkalinity = inputAlk;
    let isAlkEstimated = false;
    let alkSteps = [];
    if (alkalinity <= 0) {
      // Alkalinity as CaCO3 mg/L = (HCO3 meq + CO3 meq) * 50
      alkalinity = (meq.HCO3 + meq.CO3) * 50;
      isAlkEstimated = true;
      alkSteps.push(`Total Alkalinity was missing or zero. Derived from equivalent bicarbonate and carbonate ions:`);
      alkSteps.push(`Formula: Alkalinity (as CaCO3 mg/L) = (HCO₃⁻ meq/L + CO₃²⁻ meq/L) × 50`);
      alkSteps.push(`Substitution: (${meq.HCO3.toFixed(4)} + ${meq.CO3.toFixed(4)}) × 50 = ${alkalinity.toFixed(2)} mg/L`);
    } else {
      alkSteps.push(`Total Alkalinity is provided as ${alkalinity.toFixed(2)} mg/L as CaCO3.`);
      alkSteps.push(`Theoretical alkalinity derived from bicarbonate and carbonate:`);
      const theoAlk = (meq.HCO3 + meq.CO3) * 50;
      alkSteps.push(`Theoretical: (${meq.HCO3.toFixed(4)} + ${meq.CO3.toFixed(4)}) × 50 = ${theoAlk.toFixed(2)} mg/L (Difference: ${(alkalinity - theoAlk).toFixed(2)} mg/L)`);
    }
    let alkStatus = "Acceptable";
    let alkColor = "text-emerald-600 bg-emerald-50 border-emerald-100";
    if (alkalinity > 600) {
      alkStatus = "Exceeded (Poor)";
      alkColor = "text-rose-600 bg-rose-50 border-rose-100";
    } else if (alkalinity > 200) {
      alkStatus = "Permissible (BIS)";
      alkColor = "text-amber-600 bg-amber-50 border-amber-100";
    }

    // 5. SAR (Sodium Adsorption Ratio)
    const sarDenom = Math.sqrt((meq.Ca + meq.Mg) / 2);
    const sar = sarDenom > 0 ? meq.Na / sarDenom : 0;
    const sarSteps = [
      `SAR Formula: SAR = Na⁺ / √[(Ca²⁺ + Mg²⁺) / 2] (concentrations in meq/L)`,
      `Substituting active values:`,
      `• Na⁺  = ${meq.Na.toFixed(4)} meq/L`,
      `• Ca²⁺  = ${meq.Ca.toFixed(4)} meq/L`,
      `• Mg²⁺  = ${meq.Mg.toFixed(4)} meq/L`,
      `Step 1: (Ca²⁺ + Mg²⁺) / 2 = (${meq.Ca.toFixed(4)} + ${meq.Mg.toFixed(4)}) ÷ 2 = ${((meq.Ca + meq.Mg) / 2).toFixed(4)} meq/L`,
      `Step 2: √[(Ca²⁺ + Mg²⁺) / 2] = √${((meq.Ca + meq.Mg) / 2).toFixed(4)} = ${sarDenom.toFixed(4)}`,
      `Step 3: Na⁺ ÷ ${sarDenom.toFixed(4)} = ${meq.Na.toFixed(4)} ÷ ${sarDenom.toFixed(4)} = ${sar.toFixed(3)}`
    ];
    let sarStatus = "Excellent";
    let sarColor = "text-emerald-600 bg-emerald-50 border-emerald-100";
    if (sar >= 26) {
      sarStatus = "Unsuitable";
      sarColor = "text-rose-600 bg-rose-50 border-rose-100";
    } else if (sar >= 18) {
      sarStatus = "Doubtful";
      sarColor = "text-orange-600 bg-orange-50 border-orange-100";
    } else if (sar >= 10) {
      sarStatus = "Good";
      sarColor = "text-amber-600 bg-amber-50 border-amber-100";
    }

    // 6. RSC (Residual Sodium Carbonate)
    const rsc = (meq.CO3 + meq.HCO3) - (meq.Ca + meq.Mg);
    const rscSteps = [
      `RSC Formula: RSC = (CO₃²⁻ + HCO₃⁻) - (Ca²⁺ + Mg²⁺) (concentrations in meq/L)`,
      `Substituting active values:`,
      `• Carbonates sum (CO₃²⁻ + HCO₃⁻) = ${meq.CO3.toFixed(4)} + ${meq.HCO3.toFixed(4)} = ${(meq.CO3 + meq.HCO3).toFixed(4)} meq/L`,
      `• Hardness sum (Ca²⁺ + Mg²⁺)     = ${meq.Ca.toFixed(4)} + ${meq.Mg.toFixed(4)} = ${(meq.Ca + meq.Mg).toFixed(4)} meq/L`,
      `Step RSC calculation: ${(meq.CO3 + meq.HCO3).toFixed(4)} - ${(meq.Ca + meq.Mg).toFixed(4)} = ${rsc.toFixed(3)} meq/L`
    ];
    let rscStatus = "Suitable (Safe)";
    let rscColor = "text-emerald-600 bg-emerald-50 border-emerald-100";
    if (rsc > 2.5) {
      rscStatus = "Unsuitable (Hazardous)";
      rscColor = "text-rose-600 bg-rose-50 border-rose-100";
    } else if (rsc >= 1.25) {
      rscStatus = "Marginal / Doubtful";
      rscColor = "text-amber-600 bg-amber-50 border-amber-100";
    }

    // 7. PI (Permeability Index)
    const piDenom = meq.Ca + meq.Mg + meq.Na;
    const pi = piDenom > 0 ? ((meq.Na + Math.sqrt(meq.HCO3)) / piDenom) * 100 : 0;
    const piSteps = [
      `Permeability Index (PI) Formula (Doneen's):`,
      `PI (%) = [(Na⁺ + √HCO₃⁻) / (Ca²⁺ + Mg²⁺ + Na⁺)] × 100 (concentrations in meq/L)`,
      `Substituting active values:`,
      `• Na⁺ = ${meq.Na.toFixed(4)} meq/L`,
      `• Ca²⁺ = ${meq.Ca.toFixed(4)} meq/L`,
      `• Mg²⁺ = ${meq.Mg.toFixed(4)} meq/L`,
      `• HCO₃⁻ = ${meq.HCO3.toFixed(4)} meq/L`,
      `Step 1: √HCO₃⁻ = √${meq.HCO3.toFixed(4)} = ${Math.sqrt(meq.HCO3).toFixed(4)}`,
      `Step 2: Numerator (Na⁺ + √HCO₃⁻) = ${meq.Na.toFixed(4)} + ${Math.sqrt(meq.HCO3).toFixed(4)} = ${(meq.Na + Math.sqrt(meq.HCO3)).toFixed(4)}`,
      `Step 3: Denominator (Ca²⁺ + Mg²⁺ + Na⁺) = ${meq.Ca.toFixed(4)} + ${meq.Mg.toFixed(4)} + ${meq.Na.toFixed(4)} = ${piDenom.toFixed(4)}`,
      `Step 4: Division: [ ${(meq.Na + Math.sqrt(meq.HCO3)).toFixed(4)} ÷ ${piDenom.toFixed(4)} ] × 100 = ${pi.toFixed(2)}%`
    ];
    let piStatus = "Class I (Highly Suitable)";
    let piColor = "text-emerald-600 bg-emerald-50 border-emerald-100";
    if (pi < 25) {
      piStatus = "Class III (Unsuitable)";
      piColor = "text-rose-600 bg-rose-50 border-rose-100";
    } else if (pi < 75) {
      piStatus = "Class II (Moderately Suitable)";
      piColor = "text-amber-600 bg-amber-50 border-amber-100";
    }

    // 7b. % Sodium (Sodium Percentage)
    const naPercDenom = meq.Ca + meq.Mg + meq.Na + meq.K;
    const naPercValue = naPercDenom > 0 ? ((meq.Na + meq.K) / naPercDenom) * 100 : 0;
    const naPercSteps = [
      `Sodium Percentage (% Na) Formula (Wilcox's):`,
      `% Na = [(Na⁺ + K⁺) / (Ca²⁺ + Mg²⁺ + Na⁺ + K⁺)] × 100 (concentrations in meq/L)`,
      `Substituting active values:`,
      `• Na⁺ = ${meq.Na.toFixed(4)} meq/L`,
      `• K⁺ = ${meq.K.toFixed(4)} meq/L`,
      `• Ca²⁺ = ${meq.Ca.toFixed(4)} meq/L`,
      `• Mg²⁺ = ${meq.Mg.toFixed(4)} meq/L`,
      `Step 1: Numerator (Na⁺ + K⁺) = ${meq.Na.toFixed(4)} + ${meq.K.toFixed(4)} = ${(meq.Na + meq.K).toFixed(4)} meq/L`,
      `Step 2: Denominator (Ca²⁺ + Mg²⁺ + Na⁺ + K⁺) = ${naPercDenom.toFixed(4)} meq/L`,
      `Step 3: Division & Percentage: [ ${(meq.Na + meq.K).toFixed(4)} ÷ ${naPercDenom.toFixed(4)} ] × 100 = ${naPercValue.toFixed(2)}%`
    ];
    let naPercStatus = "Excellent";
    let naPercColor = "text-emerald-600 bg-emerald-50 border-emerald-100";
    if (naPercValue >= 60) {
      naPercStatus = "Unsuitable";
      naPercColor = "text-rose-600 bg-rose-50 border-rose-100";
    } else if (naPercValue >= 40) {
      naPercStatus = "Permissible";
      naPercColor = "text-amber-600 bg-amber-50 border-amber-100";
    } else if (naPercValue >= 20) {
      naPercStatus = "Good";
      naPercColor = "text-green-600 bg-green-50 border-green-100";
    }

    // 8. meq% percentages used in Piper Trilinear Plotting
    const catSum = tzPlus || 1;
    const anSum = tzMinus || 1;
    const meqPerc = {
      Ca: (meq.Ca / catSum) * 100,
      Mg: (meq.Mg / catSum) * 100,
      NaK: ((meq.Na + meq.K) / catSum) * 100,
      HCO3CO3: ((meq.HCO3 + meq.CO3) / anSum) * 100,
      SO4: (meq.SO4 / anSum) * 100,
      Cl: (meq.Cl / anSum) * 100
    };
    const piperSteps = [
      `The Piper trilinear diagram plots the relative concentration percentages of major ions in meq/L:`,
      `Cation relative percentages (Sum to 100%):`,
      `• Total Cations sum (TZ⁺) = ${catSum.toFixed(4)} meq/L`,
      `• Ca²⁺ % = (${meq.Ca.toFixed(4)} ÷ ${catSum.toFixed(4)}) × 100 = ${meqPerc.Ca.toFixed(2)}%`,
      `• Mg²⁺ % = (${meq.Mg.toFixed(4)} ÷ ${catSum.toFixed(4)}) × 100 = ${meqPerc.Mg.toFixed(2)}%`,
      `• (Na⁺ + K⁺) % = ((${meq.Na.toFixed(4)} + ${meq.K.toFixed(4)}) ÷ ${catSum.toFixed(4)}) × 100 = ${meqPerc.NaK.toFixed(2)}%`,
      `Anion relative percentages (Sum to 100%):`,
      `• Total Anions sum (TZ⁻) = ${anSum.toFixed(4)} meq/L`,
      `• (HCO₃⁻ + CO₃²⁻) % = ((${meq.HCO3.toFixed(4)} + ${meq.CO3.toFixed(4)}) ÷ ${anSum.toFixed(4)}) × 100 = ${meqPerc.HCO3CO3.toFixed(2)}%`,
      `• SO₄²⁻ % = (${meq.SO4.toFixed(4)} ÷ ${anSum.toFixed(4)}) × 100 = ${meqPerc.SO4.toFixed(2)}%`,
      `• Cl⁻ % = (${meq.Cl.toFixed(4)} ÷ ${anSum.toFixed(4)}) × 100 = ${meqPerc.Cl.toFixed(2)}%`
    ];

    // 9. Hydrochemical Facies
    let facies = "Unknown";
    let faciesDesc = "";
    const c = meqPerc.Ca + meqPerc.Mg;
    const a = meqPerc.Cl + meqPerc.SO4;
    if (tzPlus > 0 && tzMinus > 0) {
      if (c >= 50 && a >= 50) {
        if (c + a >= 150) {
          facies = "Calcium Chloride type (Ca-Cl)";
          faciesDesc = "Saline/reverse ion-exchanged deep ancient groundwater with Ca and Cl enrichment.";
        } else {
          facies = "Mixed Type A";
          faciesDesc = "No single dominant cation-anion pair. Represents transitional or mixed water sources.";
        }
      } else if (c >= 50 && a < 50) {
        facies = "Calcium-Magnesium Bicarbonate type (Ca-Mg-HCO3)";
        faciesDesc = "Fresh groundwater typical of shallow aquifers dominated by limestone and dolomite dissolution.";
      } else if (c < 50 && a >= 50) {
        facies = "Sodium Chloride type (Na-Cl)";
        faciesDesc = "Highly saline groundwater typical of marine infiltration, salt dissolution, or coastal recharge.";
      } else if (c < 50 && a < 50) {
        if (c + a >= 50) {
          facies = "Mixed Type B";
          faciesDesc = "No single dominant cation-anion pair. Represents transitional or mixed alkaline-earth sources.";
        } else {
          facies = "Sodium Bicarbonate type (Na-HCO3)";
          faciesDesc = "Alkaline sodic water typical of deep aquifers or environments undergoing cation exchange.";
        }
      }
    }
    const faciesSteps = [
      `Facies are derived from plotting the cation and anion percentages in the Piper Diamond quadrant divisions:`,
      `• Alkaline Earths (Ca²⁺ + Mg²⁺) = ${c.toFixed(1)}% of total cations`,
      `• Strong Acids (Cl⁻ + SO₄²⁻)     = ${a.toFixed(1)}% of total anions`,
      `Classification conditions evaluated:`,
      c >= 50 && a >= 50
        ? `• Ca+Mg ≥ 50% and Cl+SO4 ≥ 50% met: Evaluated sum (${(c + a).toFixed(1)}%). Resulting type: ${facies}`
        : c >= 50 && a < 50
        ? `• Ca+Mg ≥ 50% and Cl+SO4 < 50% met: Resulting type is Calcium-Magnesium Bicarbonate type.`
        : c < 50 && a >= 50
        ? `• Ca+Mg < 50% and Cl+SO4 ≥ 50% met: Resulting type is Sodium Chloride type.`
        : `• Ca+Mg < 50% and Cl+SO4 < 50% met: Resulting type is Sodium Bicarbonate type (or Mixed Type B).`,
      `Derived Hydrochemical Facies: ${facies}`,
      `Description: ${faciesDesc}`
    ];

    // 10. USSL Classification
    let sClass = "S1";
    let sDesc = "Low Sodium hazard";
    let boundaries = { s1s2: 0, s2s3: 0, s3s4: 0 };
    if (ec > 0) {
      const logEC = Math.log10(ec);
      boundaries.s1s2 = 18.8515824 - 4.4257912 * logEC;
      boundaries.s2s3 = 31.4031902 - 6.6827811 * logEC;
      boundaries.s3s4 = 43.675205 - 8.8394965 * logEC;

      if (sar < boundaries.s1s2) {
        sClass = "S1";
        sDesc = "Low Sodium Hazard: Suitable for almost all soils without sodium accumulation.";
      } else if (sar < boundaries.s2s3) {
        sClass = "S2";
        sDesc = "Medium Sodium Hazard: Fine-textured soils with high cation exchange may experience hazard.";
      } else if (sar < boundaries.s3s4) {
        sClass = "S3";
        sDesc = "High Sodium Hazard: May produce harmful exchangeable sodium levels in most soils.";
      } else {
        sClass = "S4";
        sDesc = "Very High Sodium Hazard: Generally unsatisfactory for irrigation unless highly saline.";
      }
    }

    let cClass = "C1";
    let cDesc = "Low Salinity hazard";
    if (ec >= 2250) {
      cClass = "C4";
      cDesc = "Very High Salinity Hazard: Unsuitable for irrigation under ordinary conditions.";
    } else if (ec >= 750) {
      cClass = "C3";
      cDesc = "High Salinity Hazard: Cannot be used on soils with restricted drainage; requires salt-tolerant crops.";
    } else if (ec >= 250) {
      cClass = "C2";
      cDesc = "Medium Salinity Hazard: Can be used if moderate leaching occurs; crops with moderate salt tolerance.";
    } else {
      cClass = "C1";
      cDesc = "Low Salinity Hazard: Safe for most crops on most soils with minimal leaching requirements.";
    }

    const usslClass = `${cClass}-${sClass}`;
    const usslSteps = [
      `USSL Salinity Hazard evaluation based on Electrical Conductivity (EC):`,
      `• Sample EC = ${ec} µS/cm`,
      `  • Class boundaries: C1 (<250), C2 (250-750), C3 (750-2250), C4 (≥2250)`,
      `  • Resulting Salinity Class: ${cClass} (${cDesc})`,
      `USSL Sodium Hazard boundaries calculated dynamically using logarithmic equations for EC = ${ec} µS/cm:`,
      `• Boundary S1/S2 (Sodicity boundary 1) = 18.85 - 4.43 × log₁₀(EC) = 18.85 - 4.43 × ${Math.log10(ec).toFixed(3)} = ${boundaries.s1s2.toFixed(2)}`,
      `• Boundary S2/S3 (Sodicity boundary 2) = 31.40 - 6.68 × log₁₀(EC) = 31.40 - 6.68 × ${Math.log10(ec).toFixed(3)} = ${boundaries.s2s3.toFixed(2)}`,
      `• Boundary S3/S4 (Sodicity boundary 3) = 43.68 - 8.84 × log₁₀(EC) = 43.68 - 8.84 × ${Math.log10(ec).toFixed(3)} = ${boundaries.s3s4.toFixed(2)}`,
      `Comparison: Sample SAR of ${sar.toFixed(2)} is matched against boundaries:`,
      sar < boundaries.s1s2
        ? `  • SAR (${sar.toFixed(2)}) < S1/S2 boundary (${boundaries.s1s2.toFixed(2)}) → Class S1`
        : sar < boundaries.s2s3
        ? `  • SAR (${sar.toFixed(2)}) lies between S1/S2 (${boundaries.s1s2.toFixed(2)}) and S2/S3 (${boundaries.s2s3.toFixed(2)}) → Class S2`
        : sar < boundaries.s3s4
        ? `  • SAR (${sar.toFixed(2)}) lies between S2/S3 (${boundaries.s2s3.toFixed(2)}) and S3/S4 (${boundaries.s3s4.toFixed(2)}) → Class S3`
        : `  • SAR (${sar.toFixed(2)}) ≥ S3/S4 boundary (${boundaries.s3s4.toFixed(2)}) → Class S4`,
      `Final USSL irrigation class: ${usslClass}`,
      `Description: ${sDesc}`
    ];

    // 11. Gibbs Ratios
    const catSumGibbs = meq.Na + meq.K + meq.Ca;
    const gibbsCation = catSumGibbs > 0 ? (meq.Na + meq.K) / catSumGibbs : 0;

    const anSumGibbs = meq.Cl + meq.HCO3;
    const gibbsAnion = anSumGibbs > 0 ? meq.Cl / anSumGibbs : 0;

    const gibbsSteps = [
      `Gibbs Ratios are used to identify the functional hydrochemical source processes of groundwater solutes:`,
      `Gibbs Ratio I (Cations): Gibbs-Cation = (Na⁺ + K⁺) / (Na⁺ + K⁺ + Ca²⁺)`,
      `• Substituting meq/L values: (${meq.Na.toFixed(4)} + ${meq.K.toFixed(4)}) ÷ (${meq.Na.toFixed(4)} + ${meq.K.toFixed(4)} + ${meq.Ca.toFixed(4)})`,
      `• Gibbs Cation Ratio = ${gibbsCation.toFixed(3)}`,
      `Gibbs Ratio II (Anions): Gibbs-Anion = Cl⁻ / (Cl⁻ + HCO₃⁻)`,
      `• Substituting meq/L values: ${meq.Cl.toFixed(4)} ÷ (${meq.Cl.toFixed(4)} + ${meq.HCO3.toFixed(4)})`,
      `• Gibbs Anion Ratio = ${gibbsAnion.toFixed(3)}`,
      `Hydrochemical classification interpretation:`,
      tds > 1000 && gibbsCation > 0.8
        ? "• Evaporation-Crystallization Dominance: High TDS and high Na/Cl ratios indicate extreme evaporation."
        : tds < 15 && gibbsCation > 0.8
        ? "• Precipitation Dominance: Very low TDS and high sodium indicate atmospheric salt rain-out."
        : "• Rock-Mineral Weathering Dominance: Moderate TDS and moderate cation ratios indicate bedrock dissolution weathering mineral processes."
    ];

    return {
      meq,
      tzPlus,
      tzMinus,
      meqSteps,
      cbe,
      cbeSteps,
      cbeStatus,
      cbeColor,
      tds,
      isTdsEstimated,
      tdsSteps,
      tdsStatus,
      tdsColor,
      alkalinity,
      isAlkEstimated,
      alkSteps,
      alkStatus,
      alkColor,
      sar,
      sarSteps,
      sarStatus,
      sarColor,
      rsc,
      rscSteps,
      rscStatus,
      rscColor,
      pi,
      piSteps,
      piStatus,
      piColor,
      naPercValue,
      naPercSteps,
      naPercStatus,
      naPercColor,
      meqPerc,
      piperSteps,
      facies,
      faciesDesc,
      faciesSteps,
      usslClass,
      usslSteps,
      gibbsCation,
      gibbsAnion,
      gibbsSteps
    };
  }, [inputs]);

  // 12. Pearson correlation matrix computed dynamically over all uploaded data
  const pearson = useMemo(() => {
    return computePearsonMatrix(rawData, headerMap);
  }, [rawData, headerMap]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Premium Header card */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-indigo-50 to-violet-50 rounded-full blur-3xl opacity-40 -mr-20 -mt-20"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
              <Calculator className="w-7 h-7 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">Calculatorius</h2>
              <p className="text-sm font-medium text-slate-500 mt-1">
                A mathematical validation package demonstrating step-by-step groundwater quality indices.
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              onClick={() => handleSampleSelect("preset-fresh")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                selectedSampleId === "preset-fresh"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              Freshwater Preset
            </button>
            <button
              onClick={() => handleSampleSelect("preset-coastal")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                selectedSampleId === "preset-coastal"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              Saline Coastal Preset
            </button>
            <button
              onClick={() => handleSampleSelect("preset-alkaline")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                selectedSampleId === "preset-alkaline"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              Sodic Alkaline Preset
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: Data selector & Real-time inputs (Playground) (lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Sample Search & Selection */}
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
            <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Compass className="w-4 h-4 text-indigo-500" />
              Source Data Sample Selection
            </h3>
            
            {parsedSamples.length > 0 ? (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Location, Block or District..."
                    className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                  />
                </div>
                
                <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50 custom-scrollbar bg-slate-50/50">
                  {filteredSearchSamples.length > 0 ? (
                    filteredSearchSamples.map((samp) => (
                      <button
                        key={samp.id}
                        onClick={() => handleSampleSelect(String(samp.id))}
                        className={`w-full text-left p-3 text-xs flex justify-between items-center transition-all hover:bg-indigo-50/40 ${
                          selectedSampleId === samp.id ? "bg-indigo-50 border-l-4 border-indigo-600" : ""
                        }`}
                      >
                        <div>
                          <p className="font-bold text-slate-800">{samp.location}</p>
                          <p className="text-[10px] text-slate-500 font-medium">
                            {samp.block}, {samp.district}, {samp.state}
                          </p>
                        </div>
                        <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-bold">
                          Well {samp.wellId}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="p-4 text-center text-xs text-slate-400 font-medium">
                      No matching records found
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-indigo-50/40 border border-indigo-100 rounded-2xl flex items-start gap-3">
                <Info className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                <p className="text-xs text-indigo-800 font-medium leading-relaxed">
                  <strong>Demo Mode Active:</strong> No groundwater Excel dataset is currently uploaded. Showing typical North India aquifer samples. Go to the dashboard to import custom data sheets.
                </p>
              </div>
            )}
          </div>

          {/* Location & Metadata Panel */}
          <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-md relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600 rounded-full blur-3xl opacity-20 -mr-10 -mt-10"></div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
              Active Evaluation Site Details
            </h3>
            
            <div className="space-y-4">
              <div>
                <span className="text-[10px] text-indigo-300 font-black uppercase tracking-wider">Location / Well ID</span>
                <p className="text-lg font-black text-white truncate">{inputs.location || "Custom Sample"}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{inputs.wellId || "N/A"}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-4">
                <div>
                  <span className="text-[10px] text-indigo-300 font-black uppercase tracking-wider">Block</span>
                  <p className="text-xs font-bold text-slate-100 truncate">{inputs.block || "Manual Entry"}</p>
                </div>
                <div>
                  <span className="text-[10px] text-indigo-300 font-black uppercase tracking-wider">District</span>
                  <p className="text-xs font-bold text-slate-100 truncate">{inputs.district || "Manual Entry"}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-4">
                <div>
                  <span className="text-[10px] text-indigo-300 font-black uppercase tracking-wider">State</span>
                  <p className="text-xs font-bold text-slate-100 truncate">{inputs.state || "Manual Entry"}</p>
                </div>
                <div>
                  <span className="text-[10px] text-indigo-300 font-black uppercase tracking-wider">Year & Season</span>
                  <p className="text-xs font-bold text-slate-100 truncate">
                    {inputs.year || "2024"} ({inputs.season || "Pre-Monsoon"})
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Input Chemical Concentrations (mg/L) Playground */}
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6">
            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
              <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-500" />
                Chemical Concentrations Playground
              </h3>
              <button
                onClick={() => handleSampleSelect(String(selectedSampleId))}
                className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-[11px] font-bold"
                title="Reset edited values back to selected sample defaults"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reset Defaults
              </button>
            </div>

            {/* Cations Section */}
            <div>
              <p className="text-[11px] font-black text-indigo-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                Cations (mg/L)
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Calcium (Ca²⁺)</label>
                  <input
                    type="number"
                    value={inputs.ca || ""}
                    onChange={(e) => setInputs({ ...inputs, ca: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Magnesium (Mg²⁺)</label>
                  <input
                    type="number"
                    value={inputs.mg || ""}
                    onChange={(e) => setInputs({ ...inputs, mg: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Sodium (Na⁺)</label>
                  <input
                    type="number"
                    value={inputs.na || ""}
                    onChange={(e) => setInputs({ ...inputs, na: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Potassium (K⁺)</label>
                  <input
                    type="number"
                    value={inputs.k || ""}
                    onChange={(e) => setInputs({ ...inputs, k: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Anions Section */}
            <div className="border-t border-slate-50 pt-4">
              <p className="text-[11px] font-black text-rose-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                Anions (mg/L)
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Chloride (Cl⁻)</label>
                  <input
                    type="number"
                    value={inputs.cl || ""}
                    onChange={(e) => setInputs({ ...inputs, cl: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Sulphate (SO₄²⁻)</label>
                  <input
                    type="number"
                    value={inputs.so4 || ""}
                    onChange={(e) => setInputs({ ...inputs, so4: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Bicarbonate (HCO₃⁻)</label>
                  <input
                    type="number"
                    value={inputs.hco3 || ""}
                    onChange={(e) => setInputs({ ...inputs, hco3: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Carbonate (CO₃²⁻)</label>
                  <input
                    type="number"
                    value={inputs.co3 || ""}
                    onChange={(e) => setInputs({ ...inputs, co3: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Electrical Conductivity & pH */}
            <div className="border-t border-slate-50 pt-4">
              <p className="text-[11px] font-black text-slate-700 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-700"></span>
                Physical Parameters
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">Electrical Cond. (EC)</label>
                  <input
                    type="number"
                    value={inputs.ec || ""}
                    onChange={(e) => setInputs({ ...inputs, ec: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">pH Level</label>
                  <input
                    type="number"
                    step="0.1"
                    value={inputs.pH || ""}
                    onChange={(e) => setInputs({ ...inputs, pH: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Quick metrics and tabs method calculations (lg:col-span-7) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Quick summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">TDS Status</p>
              <p className="text-base font-black text-slate-800 mt-1">{calc.tds.toFixed(0)} <span className="text-xs font-medium">mg/L</span></p>
              <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mt-2 border ${calc.tdsColor}`}>
                {calc.tdsStatus}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Balance Error (CBE)</p>
              <p className="text-base font-black text-slate-800 mt-1">{calc.cbe > 0 ? "+" : ""}{calc.cbe.toFixed(2)}%</p>
              <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mt-2 border ${calc.cbeColor}`}>
                {calc.cbeStatus}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">SAR Sodicity</p>
              <p className="text-base font-black text-slate-800 mt-1">{calc.sar.toFixed(2)}</p>
              <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mt-2 border ${calc.sarColor}`}>
                {calc.sarStatus}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Residual Carbonate (RSC)</p>
              <p className="text-base font-black text-slate-800 mt-1">{calc.rsc.toFixed(2)} <span className="text-[10px] font-medium">meq</span></p>
              <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mt-2 border ${calc.rscColor}`}>
                {calc.rscStatus}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Permeability (PI)</p>
              <p className="text-base font-black text-slate-800 mt-1">{calc.pi.toFixed(1)}%</p>
              <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mt-2 border ${calc.piColor}`}>
                {calc.piStatus.replace("Suitable", "")}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">% Sodium (Wilcox)</p>
              <p className="text-base font-black text-slate-800 mt-1">{calc.naPercValue.toFixed(1)}%</p>
              <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mt-2 border ${calc.naPercColor}`}>
                {calc.naPercStatus}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">USSL Class</p>
              <p className="text-base font-black text-slate-800 mt-1">{calc.usslClass}</p>
              <span className="inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mt-2 border text-indigo-600 bg-indigo-50 border-indigo-100">
                Irrigation Rating
              </span>
            </div>

          </div>

          {/* 12-Steps Methodology Tabbed calculations */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            
            {/* Scrollable tab headers */}
            <div className="bg-slate-50 border-b border-slate-100 p-2 overflow-x-auto flex gap-1 custom-scrollbar">
              {[
                { id: "meq", label: "1. meq/L", icon: Table },
                { id: "tds", label: "2. TDS", icon: Beaker },
                { id: "alk", label: "3. Alkalinity", icon: Waves },
                { id: "sar", label: "4. SAR", icon: Sliders },
                { id: "rsc", label: "5. RSC", icon: Activity },
                { id: "pi", label: "6. PI (Permeability)", icon: Compass },
                { id: "facies", label: "7. Facies", icon: Sparkles },
                { id: "ussl", label: "8. USSL Classes", icon: Layers },
                { id: "cbe", label: "9. CBE (Charge Balance)", icon: Check },
                { id: "gibbs", label: "10. Gibbs", icon: TrendingUp },
                { id: "piper", label: "11. Piper meq%", icon: FileSpreadsheet },
                { id: "nasodium", label: "12. % Sodium", icon: Percent },
                { id: "pearson", label: "13. Pearson Coeff", icon: Table }
              ].map((tab) => {
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 shrink-0 transition-all ${
                      activeTab === tab.id
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-600 hover:text-indigo-600 hover:bg-slate-100"
                    }`}
                  >
                    <TabIcon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content area */}
            <div className="p-6">
              
              {/* TAB 1: meq/L Conversion */}
              {activeTab === "meq" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h4 className="font-bold text-slate-800 flex items-center gap-2">
                      <Table className="w-4 h-4 text-indigo-500" />
                      Step-by-Step Equivalents (mg/L to meq/L)
                    </h4>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      Equiv = mg/L ÷ EqWt
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Hydrochemical indexes and diagrams require water chemistry values in milliequivalents per liter (meq/L) to properly represent charge valence ratios. The formula to convert is:
                  </p>

                  <div className="bg-slate-50 border border-slate-100 p-3 rounded-2xl text-center font-mono text-xs font-bold text-slate-700">
                    meq/L = Concentration (mg/L) ÷ Equivalent Weight
                  </div>

                  <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-500 uppercase tracking-widest text-[9px] font-black border-b border-slate-100">
                        <tr>
                          <th className="p-3">Ion Type</th>
                          <th className="p-3 text-right">mg/L Input</th>
                          <th className="p-3 text-right">Equivalent Weight</th>
                          <th className="p-3 text-right">meq/L Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                        <tr>
                          <td className="p-3 text-indigo-600 font-bold">Calcium (Ca²⁺)</td>
                          <td className="p-3 text-right">{inputs.ca.toFixed(2)}</td>
                          <td className="p-3 text-right text-slate-400">{EQ_WEIGHTS.Ca}</td>
                          <td className="p-3 text-right font-mono font-bold">{calc.meq.Ca.toFixed(4)}</td>
                        </tr>
                        <tr>
                          <td className="p-3 text-indigo-600 font-bold">Magnesium (Mg²⁺)</td>
                          <td className="p-3 text-right">{inputs.mg.toFixed(2)}</td>
                          <td className="p-3 text-right text-slate-400">{EQ_WEIGHTS.Mg}</td>
                          <td className="p-3 text-right font-mono font-bold">{calc.meq.Mg.toFixed(4)}</td>
                        </tr>
                        <tr>
                          <td className="p-3 text-indigo-600 font-bold">Sodium (Na⁺)</td>
                          <td className="p-3 text-right">{inputs.na.toFixed(2)}</td>
                          <td className="p-3 text-right text-slate-400">{EQ_WEIGHTS.Na}</td>
                          <td className="p-3 text-right font-mono font-bold">{calc.meq.Na.toFixed(4)}</td>
                        </tr>
                        <tr>
                          <td className="p-3 text-indigo-600 font-bold">Potassium (K⁺)</td>
                          <td className="p-3 text-right">{inputs.k.toFixed(2)}</td>
                          <td className="p-3 text-right text-slate-400">{EQ_WEIGHTS.K}</td>
                          <td className="p-3 text-right font-mono font-bold">{calc.meq.K.toFixed(4)}</td>
                        </tr>
                        <tr className="bg-slate-50/50">
                          <td className="p-3 text-indigo-900 font-black">Sum Cations (TZ⁺)</td>
                          <td className="p-3 text-right text-slate-400">-</td>
                          <td className="p-3 text-right text-slate-400">-</td>
                          <td className="p-3 text-right font-mono font-black text-indigo-600">{calc.tzPlus.toFixed(4)}</td>
                        </tr>
                        <tr>
                          <td className="p-3 text-rose-600 font-bold">Chloride (Cl⁻)</td>
                          <td className="p-3 text-right">{inputs.cl.toFixed(2)}</td>
                          <td className="p-3 text-right text-slate-400">{EQ_WEIGHTS.Cl}</td>
                          <td className="p-3 text-right font-mono font-bold">{calc.meq.Cl.toFixed(4)}</td>
                        </tr>
                        <tr>
                          <td className="p-3 text-rose-600 font-bold">Sulphate (SO₄²⁻)</td>
                          <td className="p-3 text-right">{inputs.so4.toFixed(2)}</td>
                          <td className="p-3 text-right text-slate-400">{EQ_WEIGHTS.SO4}</td>
                          <td className="p-3 text-right font-mono font-bold">{calc.meq.SO4.toFixed(4)}</td>
                        </tr>
                        <tr>
                          <td className="p-3 text-rose-600 font-bold">Bicarbonate (HCO₃⁻)</td>
                          <td className="p-3 text-right">{inputs.hco3.toFixed(2)}</td>
                          <td className="p-3 text-right text-slate-400">{EQ_WEIGHTS.HCO3}</td>
                          <td className="p-3 text-right font-mono font-bold">{calc.meq.HCO3.toFixed(4)}</td>
                        </tr>
                        <tr>
                          <td className="p-3 text-rose-600 font-bold">Carbonate (CO₃²⁻)</td>
                          <td className="p-3 text-right">{inputs.co3.toFixed(2)}</td>
                          <td className="p-3 text-right text-slate-400">{EQ_WEIGHTS.CO3}</td>
                          <td className="p-3 text-right font-mono font-bold">{calc.meq.CO3.toFixed(4)}</td>
                        </tr>
                        <tr className="bg-rose-50/30">
                          <td className="p-3 text-rose-900 font-black">Sum Anions (TZ⁻)</td>
                          <td className="p-3 text-right text-slate-400">-</td>
                          <td className="p-3 text-right text-slate-400">-</td>
                          <td className="p-3 text-right font-mono font-black text-rose-600">{calc.tzMinus.toFixed(4)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 2: TDS Calculation */}
              {activeTab === "tds" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Beaker className="w-4 h-4 text-emerald-500" />
                    Total Dissolved Solids (TDS) Step-by-Step
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.tdsSteps.map((step, idx) => (
                      <p key={idx} className={idx === 1 ? "font-bold text-emerald-600" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-emerald-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">BIS IS 10500 Compliance Limits:</p>
                      <ul className="list-disc pl-4 space-y-1">
                        <li><strong>Acceptable Limit:</strong> &lt; 500 mg/L (Safe for drinking water)</li>
                        <li><strong>Permissible Limit (No alternative source):</strong> up to 2,000 mg/L</li>
                        <li><strong>Non-compliant:</strong> &gt; 2,000 mg/L (Requires treatment like RO)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Total Alkalinity */}
              {activeTab === "alk" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Waves className="w-4 h-4 text-cyan-500" />
                    Total Alkalinity as CaCO₃ Step-by-Step
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.alkSteps.map((step, idx) => (
                      <p key={idx} className={idx === 1 ? "font-bold text-cyan-600" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-cyan-50 border border-cyan-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-cyan-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-cyan-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Alkalinity Chemical Relevance:</p>
                      <p>Alkalinity measures the acid neutralizing buffering capacity. Bureau of Indian Standards (IS 10500) acceptable drinking limit is 200 mg/L, with a maximum permissible relaxation limit of 600 mg/L.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: SAR */}
              {activeTab === "sar" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Sliders className="w-4 h-4 text-emerald-500" />
                    Sodium Adsorption Ratio (SAR) Step-by-Step
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.sarSteps.map((step, idx) => (
                      <p key={idx} className={idx === 0 ? "text-indigo-600 font-bold" : idx === 7 ? "text-emerald-600 font-black" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-emerald-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Irrigation Suitability (Sodicity Hazard):</p>
                      <ul className="list-disc pl-4 space-y-1">
                        <li><strong>&lt; 10:</strong> Excellent (Low hazard, safe for all irrigation)</li>
                        <li><strong>10 - 18:</strong> Good (Medium hazard, requires leaching drainage)</li>
                        <li><strong>18 - 26:</strong> Doubtful (High hazard, bad for clayey soils)</li>
                        <li><strong>&gt; 26:</strong> Unsuitable (Highly toxic, causes sodium clay sealing)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: RSC */}
              {activeTab === "rsc" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Activity className="w-4 h-4 text-amber-500" />
                    Residual Sodium Carbonate (RSC) Step-by-Step
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.rscSteps.map((step, idx) => (
                      <p key={idx} className={idx === 0 ? "text-indigo-600 font-bold" : idx === 4 ? "text-amber-600 font-black" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Eaton's RSC Soil Drainage Suitability:</p>
                      <ul className="list-disc pl-4 space-y-1">
                        <li><strong>&lt; 1.25 meq/L:</strong> Suitable / Safe (Low sodium accumulation risk)</li>
                        <li><strong>1.25 - 2.50 meq/L:</strong> Marginal / Doubtful (Use with caution)</li>
                        <li><strong>&gt; 2.50 meq/L:</strong> Unsuitable (High hazard, precipitates calcium)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: Permeability Index */}
              {activeTab === "pi" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Compass className="w-4 h-4 text-purple-500" />
                    Permeability Index (PI) Step-by-Step
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.piSteps.map((step, idx) => (
                      <p key={idx} className={idx === 1 ? "text-indigo-600 font-bold" : idx === 10 ? "text-purple-600 font-black" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-purple-50 border border-purple-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-purple-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Doneen's Permeability Classification:</p>
                      <ul className="list-disc pl-4 space-y-1">
                        <li><strong>Class I (&gt; 75%):</strong> Highly suitable with good soil permeability preservation.</li>
                        <li><strong>Class II (25% - 75%):</strong> Moderately suitable.</li>
                        <li><strong>Class III (&lt; 25%):</strong> Unsuitable for long-term soil infiltration.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 7: Facies */}
              {activeTab === "facies" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Sparkles className="w-4 h-4 text-pink-500" />
                    Hydrochemical Facies Division Step-by-Step
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.faciesSteps.map((step, idx) => (
                      <p key={idx} className={idx === 0 ? "text-indigo-600 font-bold" : idx === 4 ? "text-pink-600 font-black" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-pink-50 border border-pink-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-pink-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-pink-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Geochemical Hydrochemical Facies Meaning:</p>
                      <p>Hydrochemical facies represent diagnostic chemical types in the aquifer, revealing weathering minerals, ion exchange, or salinization pathways based on relative cation-anion dominance.</p>
                    </div>
                  </div>

                  {/* SIX PIPER FACIES CLASSES EXAMPLES AND LOGIC */}
                  <div className="space-y-3 pt-2">
                    <h5 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-pink-500" />
                      Detailed Reference of the Six Piper Facies Classes
                    </h5>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      The central diamond of the Piper trilinear diagram is divided into six distinct quadrants, each representing a distinct geochemical signature of groundwater. Below are the exact mathematical conditions, geological origins, and real-world examples for each facies:
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      {[
                        {
                          id: "Ca-Mg-HCO3",
                          name: "Calcium-Magnesium Bicarbonate type",
                          shortName: "Ca-Mg-HCO3 Type",
                          color: "#a855f7", // Purple
                          bgLight: "bg-purple-50/40",
                          borderCol: "border-purple-200/60",
                          textCol: "text-purple-700",
                          math: "c ≥ 50% and a < 50%",
                          logic: "Alkaline Earths (Ca + Mg) ≥ 50% & Strong Acids (Cl + SO4) < 50%",
                          interpretation: "Indicates fresh recharge water with short residence times. Dominated by carbonic acid weathering of limestone (calcite) and dolomite formations.",
                          example: "Shallow dug wells, mountain springs, pristine upland aquifers."
                        },
                        {
                          id: "Na-Cl",
                          name: "Sodium Chloride type",
                          shortName: "Na-Cl Type",
                          color: "#ec4899", // Pink
                          bgLight: "bg-pink-50/40",
                          borderCol: "border-pink-200/60",
                          textCol: "text-pink-700",
                          math: "c < 50% and a ≥ 50%",
                          logic: "Alkaline Earths (Ca + Mg) < 50% & Strong Acids (Cl + SO4) ≥ 50%",
                          interpretation: "Highly mineralized, saline groundwater. Caused by seawater intrusion, dissolution of halite rock-salt, deep connate fossil water, or extreme arid evaporation.",
                          example: "Coastal aquifers, desert basins, deep brackish aquifers, marine-impacted estuaries."
                        },
                        {
                          id: "Na-HCO3",
                          name: "Sodium Bicarbonate type",
                          shortName: "Na-HCO3 Type",
                          color: "#06b6d4", // Cyan
                          bgLight: "bg-cyan-50/40",
                          borderCol: "border-cyan-200/60",
                          textCol: "text-cyan-700",
                          math: "c < 50% and a < 50% and (c+a) < 50%",
                          logic: "Alkaline Earths < 50% & Strong Acids < 50% & (c + a) < 50%",
                          interpretation: "Typically alkaline or sodic waters. Found in deeper, stagnant aquifer zones undergoing natural cation exchange where dissolved Ca/Mg are swapped with clay-bound Na+.",
                          example: "Confined sandstone layers, deep alluvial soft aquifers."
                        },
                        {
                          id: "Ca-Cl",
                          name: "Calcium Chloride type",
                          shortName: "Ca-Cl Type",
                          color: "#eab308", // Golden yellow
                          bgLight: "bg-yellow-50/40",
                          borderCol: "border-yellow-200/60",
                          textCol: "text-yellow-700",
                          math: "c ≥ 50% and a ≥ 50% and (c+a) ≥ 150%",
                          logic: "Alkaline Earths ≥ 50% & Strong Acids ≥ 50% & (c + a) ≥ 150%",
                          interpretation: "Represents concentrated geogenic brines or deep aquifers undergoing reverse ion exchange (dissolved Na+ is replaced by Ca2+ from aquifer silicate/clay matrices).",
                          example: "Ultra-deep geological brine reserves, geothermal springs, fractured bedrock systems."
                        },
                        {
                          id: "Mixed-A",
                          name: "Mixed Cation-Anion Type A",
                          shortName: "Mixed Type A",
                          color: "#10b981", // Emerald
                          bgLight: "bg-emerald-50/40",
                          borderCol: "border-emerald-200/60",
                          textCol: "text-emerald-700",
                          math: "c ≥ 50% and a ≥ 50% and (c+a) < 150%",
                          logic: "Alkaline Earths ≥ 50% & Strong Acids ≥ 50% & (c + a) < 150%",
                          interpretation: "Transitional zone. Alkaline earths are high, but paired with substantial strong acids (Cl+SO4). Strongly suggests physical mixing of two distinct groundwater sources.",
                          example: "Intermediate flowpaths, mixing zones between shallow carbonate and deep saline aquifers."
                        },
                        {
                          id: "Mixed-B",
                          name: "Mixed Cation-Anion Type B",
                          shortName: "Mixed Type B",
                          color: "#ef4444", // Rose
                          bgLight: "bg-rose-50/40",
                          borderCol: "border-rose-200/60",
                          textCol: "text-rose-700",
                          math: "c < 50% and a < 50% and (c+a) ≥ 50%",
                          logic: "Alkaline Earths < 50% & Strong Acids < 50% & (c + a) ≥ 50%",
                          interpretation: "Transitional zone with high alkali cations (Na + K) but balanced with mixed bicarbonate and strong acid anions. Typical of weathered silicate rock pathways.",
                          example: "Weathered granitic and basaltic terrains, middle reaches of active river systems."
                        }
                      ].map((cls) => {
                        const isCurrent = calc.facies.toLowerCase().includes(cls.id.toLowerCase()) || 
                                          calc.facies.toLowerCase().includes(cls.shortName.toLowerCase().replace(" type", "")) ||
                                          (cls.id === "Ca-Mg-HCO3" && calc.facies.toLowerCase().includes("bicarbonate"));
                        return (
                          <div
                            key={cls.id}
                            className={`p-3.5 rounded-2xl border transition-all ${
                              isCurrent
                                ? "bg-white shadow-md ring-2 ring-indigo-500 scale-[1.01]"
                                : `${cls.bgLight} ${cls.borderCol} hover:bg-white hover:shadow-xs`
                            }`}
                            style={{ borderColor: isCurrent ? cls.color : undefined }}
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-0.5">
                                  Facies Class
                                </span>
                                <h6 className="text-xs font-black text-slate-800 leading-tight">
                                  {cls.name}
                                </h6>
                              </div>
                              <span
                                className="px-2 py-0.5 rounded-md text-[9px] font-black shrink-0 text-white shadow-3xs"
                                style={{ backgroundColor: cls.color }}
                              >
                                {cls.shortName}
                              </span>
                            </div>

                            <div className="space-y-2 mt-2.5">
                              <div className="flex flex-col gap-1 bg-white/70 p-2 rounded-lg border border-slate-100/80 font-mono text-[9px] text-slate-600">
                                <div>
                                  <span className="font-bold text-slate-500">Mathematical:</span> <span className="font-semibold text-slate-800">{cls.math}</span>
                                </div>
                                <div className="leading-normal">
                                  <span className="font-bold text-slate-500">Chemical Logic:</span> <span className="font-semibold text-slate-700">{cls.logic}</span>
                                </div>
                              </div>

                              <div className="text-[10px] text-slate-600 leading-relaxed font-medium">
                                <span className="font-extrabold text-slate-700 block mb-0.5">Hydrogeological Origin:</span>
                                {cls.interpretation}
                              </div>

                              <div className="text-[10px] text-slate-600 leading-relaxed font-medium">
                                <span className="font-extrabold text-slate-700 block mb-0.5">Real-World Examples:</span>
                                <span className="text-slate-500 italic">{cls.example}</span>
                              </div>

                              {isCurrent && (
                                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1 text-[9px] font-black text-indigo-600 uppercase tracking-wider animate-pulse">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                                    Current Sample Match
                                  </span>
                                  <span className="text-[9px] font-bold text-slate-500">
                                    c = {(calc.meqPerc.Ca + calc.meqPerc.Mg).toFixed(1)}% | a = {(calc.meqPerc.Cl + calc.meqPerc.SO4).toFixed(1)}%
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 8: USSL Classes */}
              {activeTab === "ussl" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Layers className="w-4 h-4 text-indigo-500" />
                    USSL Salinity & Sodicity Logarithmic Classification
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.usslSteps.map((step, idx) => (
                      <p key={idx} className={idx === 0 || idx === 4 ? "text-indigo-600 font-bold" : idx === 10 ? "text-indigo-700 font-black text-sm" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-indigo-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">U.S. Salinity Laboratory (USSL) Interpretation:</p>
                      <p>Combines C-class (Salinity Hazard from EC) and S-class (Sodicity Hazard from SAR boundaries) to predict long-term soil structure damage and crop yield loss.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 9: CBE */}
              {activeTab === "cbe" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Check className="w-4 h-4 text-emerald-500" />
                    Cation-Anion Charge Balance Error (CBE) Step-by-Step
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.cbeSteps.map((step, idx) => (
                      <p key={idx} className={idx === 0 ? "text-indigo-600 font-bold" : idx === 6 ? "text-emerald-600 font-black" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className={`border p-4 rounded-2xl flex items-start gap-3 ${calc.cbeColor}`}>
                    {Math.abs(calc.cbe) <= 5 ? (
                      <Check className="w-5 h-5 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    )}
                    <div className="text-xs leading-relaxed font-medium">
                      <p className="font-bold mb-1">Electroneutrality & Analysis Quality:</p>
                      <p>Natural water is electrically neutral. A charge balance error (CBE) of &le; &plusmn;5% is considered excellent and acceptable for scientific research. &le; &plusmn;10% is acceptable for general surveying. Errors beyond &plusmn;10% suggest a measurement error or presence of unanalyzed major ions (e.g. Iron, Nitrate, Carbonate).</p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 10: Gibbs Ratios */}
              {activeTab === "gibbs" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <TrendingUp className="w-4 h-4 text-orange-500" />
                    Gibbs Hydrochemical Process Ratios Step-by-Step
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.gibbsSteps.map((step, idx) => (
                      <p key={idx} className={idx === 0 ? "text-indigo-600 font-bold" : idx === 7 ? "text-orange-600 font-black" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-orange-50 border border-orange-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-orange-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Gibbs Aquifer Chemistry Interpretation:</p>
                      <p>Introduced by Gibbs (1970) to trace water mineral provenance into three fields: Precipitation (rainfall-fed), Rock Weathering (rock matrix dissolution), and Evaporation-Crystallization (arid soil concentration).</p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 11: Piper Diagram Coordinates */}
              {activeTab === "piper" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <FileSpreadsheet className="w-4 h-4 text-teal-500" />
                    Piper Diagram Plotting meq% Percentages
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.piperSteps.map((step, idx) => (
                      <p key={idx} className={idx === 0 ? "text-indigo-600 font-bold" : idx === 4 || idx === 9 ? "font-bold text-teal-600" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-teal-50 border border-teal-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-teal-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-teal-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Trilinear Plotting Mathematics:</p>
                      <p>The cation and anion ternary triangles map relative meq% values (which mathematically sum to exactly 100% on each triangle). These points are projected into the central diamond to resolve the water type.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 12: % Sodium (Percent Sodium) */}
              {activeTab === "nasodium" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Percent className="w-4 h-4 text-emerald-500" />
                    Sodium Percentage (% Na) Step-by-Step
                  </h4>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 font-mono text-xs text-slate-700 space-y-2">
                    {calc.naPercSteps.map((step, idx) => (
                      <p key={idx} className={idx === 0 ? "text-indigo-600 font-bold" : idx === 3 ? "font-bold text-emerald-600" : ""}>{step}</p>
                    ))}
                  </div>

                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-emerald-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Sodium Hazard in Agricultural Soils:</p>
                      <p className="mb-2">
                        Sodium percentage is widely used in evaluating the suitability of groundwater for irrigation (Wilcox, 1955). High sodium content in irrigation water can cause soil structure degradation, reducing water permeability and aeration.
                      </p>
                      <p className="font-bold">Wilcox Classification Standard:</p>
                      <ul className="list-disc pl-5 space-y-0.5 mt-1 font-mono text-[10px]">
                        <li>&lt; 20% : Excellent (Highly Safe)</li>
                        <li>20% to 40% : Good (Safe)</li>
                        <li>40% to 60% : Permissible (Use with caution in well-drained soils)</li>
                        <li>&ge; 60% : Unsuitable (Severe hazard)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 13: Pearson Correlation Matrix */}
              {activeTab === "pearson" && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <h4 className="font-bold text-slate-800 flex items-center gap-2">
                      <Table className="w-4 h-4 text-violet-500" />
                      Pearson Correlation Coefficient Matrix
                    </h4>
                    <span className="text-[10px] text-slate-400 font-bold bg-slate-100 px-2.5 py-0.5 rounded-full">
                      {rawData.length > 1 ? `Calculated from all ${rawData.length} records` : "Showing high-fidelity demonstration matrix"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    The Pearson correlation coefficient (r) measures the linear correlation strength between chemical ions across the entire loaded dataset. Range is -1.00 (strong negative) to +1.00 (strong positive correlation).
                  </p>

                  <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                    <table className="w-full text-center border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="p-2.5 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest border-r border-slate-100">Parameter</th>
                          {pearson.headers.map((h) => (
                            <th key={h} className="p-2.5 text-[10px] font-black text-slate-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs font-mono font-bold">
                        {pearson.headers.map((headerRow, rowIdx) => (
                          <tr key={headerRow}>
                            <td className="p-2.5 text-left font-sans font-black text-slate-600 border-r border-slate-100 bg-slate-50/40">
                              {headerRow}
                            </td>
                            {pearson.matrix[rowIdx].map((val, colIdx) => {
                              // Color code cells based on positive or negative correlation strength
                              let bg = "bg-white";
                              let text = "text-slate-800";
                              if (val > 0.7) {
                                bg = "bg-blue-100/75";
                                text = "text-blue-900";
                              } else if (val > 0.4) {
                                bg = "bg-blue-50/55";
                                text = "text-blue-800";
                              } else if (val < -0.6) {
                                bg = "bg-rose-100/75";
                                text = "text-rose-900";
                              } else if (val < -0.3) {
                                bg = "bg-rose-50/55";
                                text = "text-rose-800";
                              }
                              return (
                                <td key={colIdx} className={`p-2.5 border-r border-slate-50 ${bg} ${text}`} title={`Correlation between ${headerRow} and ${pearson.headers[colIdx]}`}>
                                  {val.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-violet-50 border border-violet-100 p-4 rounded-2xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-violet-800 leading-relaxed font-medium">
                      <p className="font-bold mb-1">Hydrochemical Statistical Relevance:</p>
                      <p>Strong positive correlations between ions (e.g. EC vs TDS, Na vs Cl) indicate shared mineral sources (e.g., Halite weathering or coastal evaporation). Weak or negative correlations suggest distinct geochemistry processes or competing ion exchange pathways.</p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
          
        </div>
        
      </div>
      
    </div>
  );
};

export default CalculatoriusView;

export const EQ_WEIGHTS = {
  Ca: 20.04,
  Mg: 12.15,
  Na: 22.99,
  K: 39.10,
  Cl: 35.45,
  SO4: 48.03,
  HCO3: 61.02,
  CO3: 30.00
};

export const INITIAL_FACIES_NAMES: Record<string, string> = {
  "Ca-Cl Type": "Calcium Chloride type",
  "Ca-Mg-HCO3 Type": "Ca-Mg Bicarbonate type",
  "Na-Cl Type": "Sodium Chloride type",
  "Na-HCO3 Type": "Sodium Bicarbonate type",
  "Mixed Type A": "Mixed Type A",
  "Mixed Type B": "Mixed Type B",
  "Unknown": "Unknown"
};

export const INITIAL_FACIES_COLORS: Record<string, string> = {
  "Ca-Cl Type": "#eab308", // Golden yellow
  "Ca-Mg-HCO3 Type": "#a855f7", // Purple
  "Na-Cl Type": "#ec4899", // Pink
  "Na-HCO3 Type": "#06b6d4", // Cyan
  "Mixed Type A": "#10b981", // Emerald
  "Mixed Type B": "#ef4444", // Rose
  "Unknown": "#94a3b8" // Gray
};

export const INITIAL_USSL_COLORS: Record<string, string> = {
  "C1-S1": "#22c55e", "C2-S1": "#84cc16", "C3-S1": "#eab308", "C4-S1": "#f97316",
  "C1-S2": "#84cc16", "C2-S2": "#eab308", "C3-S2": "#f97316", "C4-S2": "#ef4444",
  "C1-S3": "#eab308", "C2-S3": "#f97316", "C3-S3": "#ef4444", "C4-S3": "#7f1d1d",
  "C1-S4": "#f97316", "C2-S4": "#ef4444", "C3-S4": "#7f1d1d", "C4-S4": "#450a0a",
  "Unknown": "#94a3b8"
};

export const getUSSLSalinity = (ec: number): string => {
  if (!ec || ec < 250) return "C1";
  if (ec < 750) return "C2";
  if (ec < 2250) return "C3";
  return "C4";
};

export const getUSSLSodium = (ec: number, sar: number): string => {
  if (!ec || ec <= 0) return "S1";
  const logEC = Math.log10(ec);
  const s1s2 = 18.8515824 - 4.4257912 * logEC;
  const s2s3 = 31.4031902 - 6.6827811 * logEC;
  const s3s4 = 43.675205 - 8.8394965 * logEC;
  if (sar < s1s2) return "S1";
  if (sar < s2s3) return "S2";
  if (sar < s3s4) return "S3";
  return "S4";
};

export interface ProcessedSample {
  [key: string]: any;
  _calc: {
    sl: number;
    sar: number;
    ussl: string;
    facies: string;
    tds: number;
    ecVal: number | null;
    locName: string;
    gibbsCation: number;
    gibbsAnion: number;
    meq: {
      Ca: number;
      Mg: number;
      Na: number;
      K: number;
      Cl: number;
      SO4: number;
      HCO3: number;
      CO3: number;
    };
    meqPerc: {
      Ca: number;
      Mg: number;
      Na: number;
      K: number;
      Cl: number;
      SO4: number;
      HCO3: number;
      CO3: number;
    };
    lat: number | null;
    lng: number | null;
    hasUSSL: boolean;
    hasFacies: boolean;
    hasGibbs: boolean;
    hasGibbsCation?: boolean;
    hasGibbsAnion?: boolean;
    isComplete: boolean;
  };
}

export const processAquiferData = (
  rawData: any[],
  columnMapping: Record<string, string>
): ProcessedSample[] => {
  return rawData.map((row, index) => {
    const getMappedNum = (id: string): number | null => {
      const key = columnMapping[id];
      if (key && row[key] !== undefined && row[key] !== null) {
        const textVal = String(row[key]).trim();
        if (textVal !== "" && textVal !== "-" && textVal !== "—") {
          const val = parseFloat(textVal);
          return isNaN(val) ? null : val;
        }
      }
      return null;
    };

    const ca = getMappedNum("Ca");
    const mg = getMappedNum("Mg");
    const na = getMappedNum("Na");
    const k = getMappedNum("K");
    const cl = getMappedNum("Cl");
    const so4 = getMappedNum("SO4");
    const hco3 = getMappedNum("HCO3");
    const co3 = getMappedNum("CO3");
    const ec = getMappedNum("EC");
    const tdsInput = getMappedNum("TDS");
    const lat = getMappedNum("Lat");
    const lng = getMappedNum("Lng");

    const locName = columnMapping.Location && row[columnMapping.Location] ? String(row[columnMapping.Location]).trim() : "Unknown Site";
    const safeVal = (v: number | null) => v === null ? 0 : v;

    const meq = {
      Ca: safeVal(ca) / EQ_WEIGHTS.Ca,
      Mg: safeVal(mg) / EQ_WEIGHTS.Mg,
      Na: safeVal(na) / EQ_WEIGHTS.Na,
      K: safeVal(k) / EQ_WEIGHTS.K,
      Cl: safeVal(cl) / EQ_WEIGHTS.Cl,
      SO4: safeVal(so4) / EQ_WEIGHTS.SO4,
      HCO3: safeVal(hco3) / EQ_WEIGHTS.HCO3,
      CO3: safeVal(co3) / EQ_WEIGHTS.CO3
    };

    const catSumReal = meq.Ca + meq.Mg + meq.Na + meq.K;
    const anSumReal = meq.Cl + meq.SO4 + meq.HCO3 + meq.CO3;
    const catSum = catSumReal || 1;
    const anSum = anSumReal || 1;

    const meqPerc = {
      Ca: (meq.Ca / catSum) * 100,
      Mg: (meq.Mg / catSum) * 100,
      Na: (meq.Na / catSum) * 100,
      K: (meq.K / catSum) * 100,
      Cl: (meq.Cl / anSum) * 100,
      SO4: (meq.SO4 / anSum) * 100,
      HCO3: (meq.HCO3 / anSum) * 100,
      CO3: (meq.CO3 / anSum) * 100
    };

    let sar = 0;
    let ussl = "Unknown";
    let hasUSSL = false;

    if (ec !== null && na !== null && ca !== null && mg !== null) {
      const denom = Math.sqrt((meq.Ca + meq.Mg) / 2);
      if (denom > 0) {
        sar = meq.Na / denom;
        ussl = `${getUSSLSalinity(ec)}-${getUSSLSodium(ec, sar)}`;
        hasUSSL = true;
      }
    }

    const tds = tdsInput !== null ? tdsInput : (ec !== null ? ec * 0.65 : 0);
    const gibbsCation = catSumReal > 0 ? (meq.Na + meq.K) / (meq.Na + meq.K + meq.Ca || 1) : NaN;
    const gibbsAnion = anSumReal > 0 ? meq.Cl / (meq.Cl + meq.HCO3 || 1) : NaN;

    let facies = "Unknown";
    let hasFacies = ca !== null && mg !== null && na !== null && cl !== null && so4 !== null && hco3 !== null;

    if (hasFacies && catSumReal > 0 && anSumReal > 0) {
      const c = meqPerc.Ca + meqPerc.Mg;
      const a = meqPerc.Cl + meqPerc.SO4;
      if (c >= 50 && a >= 50) {
        if (c + a >= 150) facies = "Ca-Cl Type";
        else facies = "Mixed Type A";
      } else if (c >= 50 && a < 50) {
        facies = "Ca-Mg-HCO3 Type";
      } else if (c < 50 && a >= 50) {
        facies = "Na-Cl Type";
      } else if (c < 50 && a < 50) {
        if (c + a >= 50) facies = "Mixed Type B";
        else facies = "Na-HCO3 Type";
      }
    } else {
      hasFacies = false;
    }

    const hasGibbsCation = tds > 0 && na !== null && ca !== null && !isNaN(gibbsCation);
    const hasGibbsAnion = tds > 0 && cl !== null && hco3 !== null && !isNaN(gibbsAnion);
    const hasGibbs = hasGibbsCation && hasGibbsAnion;
    const isComplete = hasUSSL && hasFacies && hasGibbs;

    return {
      ...row,
      _calc: {
        sl: index + 1,
        sar,
        ussl,
        facies,
        tds,
        ecVal: ec,
        locName,
        gibbsCation,
        gibbsAnion,
        meq,
        meqPerc,
        lat,
        lng,
        hasUSSL,
        hasFacies,
        hasGibbs,
        hasGibbsCation,
        hasGibbsAnion,
        isComplete
      }
    };
  });
};

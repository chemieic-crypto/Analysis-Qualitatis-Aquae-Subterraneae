import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
// @ts-ignore
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { 
  Download, 
  Search, 
  Table, 
  AlertCircle, 
  CheckCircle,
  FileSpreadsheet, 
  Info,
  Sliders,
  Sparkles
} from "lucide-react";
import { PARAM_CONFIG } from "../data/config";

const getParamUnit = (key: string): string => {
  const conf = PARAM_CONFIG[key];
  if (conf && conf.unit) {
    return conf.unit;
  }
  if (key === "As" || key === "U") return "ppb";
  return "mg/L";
};



interface HydrochemistryViewProps {
  rawData: any[];
  mainHeaders?: any;
  showToast: (msg: string, type?: "success" | "error") => void;
  isVisible: boolean;
}

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

const COLUMN_DEFINITIONS = [
  { id: "WellId", label: "Well / Station ID", aliases: ["well id", "well_id", "station id", "site id", "wls_id"] },
  { id: "State", label: "State Name", aliases: ["state", "st"] },
  { id: "District", label: "District Name", aliases: ["district", "dist"] },
  { id: "Block", label: "Block / Tehsil", aliases: ["block", "tehsil", "taluka"] },
  { id: "Location", label: "Site Location Name", aliases: ["location", "village", "site", "name", "site name", "site_name"] },
  { id: "Lat", label: "Latitude", aliases: ["latitude", "lat", "y"] },
  { id: "Lng", label: "Longitude", aliases: ["longitude", "long", "lng", "x"] },
  { id: "EC", label: "EC (μS/cm)", aliases: ["ec", "electrical conductivity", "spc", "conductivity"] },
  { id: "TDS", label: "TDS (mg/L)", aliases: ["tds", "total dissolved solids"] },
  { id: "Ca", label: "Calcium (Ca)", aliases: ["ca", "calcium"] },
  { id: "Mg", label: "Magnesium (Mg)", aliases: ["mg", "magnesium"] },
  { id: "Na", label: "Sodium (Na)", aliases: ["na", "sodium"] },
  { id: "K", label: "Potassium (K)", aliases: ["k", "potassium"] },
  { id: "Cl", label: "Chloride (Cl)", aliases: ["cl", "chloride"] },
  { id: "SO4", label: "Sulphate (SO4)", aliases: ["so4", "sulphate", "sulfate"] },
  { id: "HCO3", label: "Bicarbonate (HCO3)", aliases: ["hco3", "bicarbonate"] },
  { id: "CO3", label: "Carbonate (CO3)", aliases: ["co3", "carbonate"] },
  { id: "Fe", label: "Iron (Fe)", aliases: ["fe", "iron", "fe (mg/l)", "iron (fe)"] },
  { id: "As", label: "Arsenic (As)", aliases: ["as", "arsenic", "as (mg/l)", "arsenic (as)", "arsenic(as)"] },
  { id: "U", label: "Uranium (U)", aliases: ["u", "uranium", "u (mg/l)", "uranium (u)", "uranium(u)"] },
  { id: "Zn", label: "Zinc (Zn)", aliases: ["zn", "zinc", "zn (mg/l)", "zinc (zn)"] },
  { id: "Cu", label: "Copper (Cu)", aliases: ["cu", "copper", "cu (mg/l)", "copper (cu)"] },
  { id: "Pb", label: "Lead (Pb)", aliases: ["pb", "lead", "pb (mg/l)", "lead (pb)"] },
  { id: "Cd", label: "Cadmium (Cd)", aliases: ["cd", "cadmium", "cd (mg/l)", "cadmium (cd)"] },
  { id: "Cr", label: "Chromium (Cr)", aliases: ["cr", "chromium", "cr (mg/l)", "chromium (cr)"] },
  { id: "Hg", label: "Mercury (Hg)", aliases: ["hg", "mercury", "hg (mg/l)", "mercury (hg)"] },
  { id: "Ni", label: "Nickel (Ni)", aliases: ["ni", "nickel", "ni (mg/l)", "nickel (ni)"] },
  { id: "Se", label: "Selenium (Se)", aliases: ["se", "selenium", "se (mg/l)", "selenium (se)"] },
  { id: "Mn", label: "Manganese (Mn)", aliases: ["mn", "manganese", "mn (mg/l)", "manganese (mn)"] },
  { id: "Al", label: "Aluminium (Al)", aliases: ["al", "aluminium", "aluminum", "al (mg/l)", "aluminium (al)"] },
  { id: "Ba", label: "Barium (Ba)", aliases: ["ba", "barium", "ba (mg/l)", "barium (ba)"] },
  { id: "B", label: "Boron (B)", aliases: ["b", "boron", "b (mg/l)", "boron (b)"] },
  { id: "Mo", label: "Molybdenum (Mo)", aliases: ["mo", "molybdenum", "mo (mg/l)", "molybdenum (mo)"] },
  { id: "Season", label: "Season / Period", aliases: ["season", "period"] },
  { id: "Year", label: "Year", aliases: ["year"] }
];

export const formatAdvanced = (value: any, decimals: number = 2): string => {
  if (value === null || value === undefined || value === "" || isNaN(Number(value))) return "-";
  const num = Number(value);
  return num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

export default function HydrochemistryView({
  rawData: mainRawData,
  mainHeaders,
  showToast,
  isVisible
}: HydrochemistryViewProps) {
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 10;

  // Auto-map columns when mainRawData changes
  useEffect(() => {
    if (mainRawData && mainRawData.length > 0) {
      const headers = Object.keys(mainRawData[0]);
      const initialMapping: Record<string, string> = {};

      COLUMN_DEFINITIONS.forEach((col) => {
        const matchedHeader = headers.find((h) => {
          return col.aliases.some((alias) => {
            try {
              return new RegExp(`\\b${alias}\\b`, "i").test(h);
            } catch {
              return h.toLowerCase() === alias.toLowerCase();
            }
          });
        });
        if (matchedHeader) initialMapping[col.id] = matchedHeader;
      });

      // Override with global mainHeaders if present
      if (mainHeaders) {
        if (mainHeaders.wellId) initialMapping.WellId = mainHeaders.wellId;
        if (mainHeaders.state) initialMapping.State = mainHeaders.state;
        if (mainHeaders.district) initialMapping.District = mainHeaders.district;
        if (mainHeaders.block) initialMapping.Block = mainHeaders.block;
        if (mainHeaders.location) initialMapping.Location = mainHeaders.location;
        if (mainHeaders.latitude) initialMapping.Lat = mainHeaders.latitude;
        if (mainHeaders.longitude) initialMapping.Lng = mainHeaders.longitude;
      }

      setColumnMapping(initialMapping);
    }
  }, [mainRawData, mainHeaders]);

  const getUSSLSalinity = (ec: number): string => {
    if (!ec || ec < 250) return "C1";
    if (ec < 750) return "C2";
    if (ec < 2250) return "C3";
    return "C4";
  };

  const getUSSLSodium = (ec: number, sar: number): string => {
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

  // Perform Hydrochemical computations dynamically
  const processedData = useMemo(() => {
    if (!mainRawData || mainRawData.length === 0) return [];

    return mainRawData.map((row, idx) => {
      const getNum = (key: string): number => {
        const colName = columnMapping[key];
        if (!colName) return 0;
        const valStr = String(row[colName] || "").trim();
        const val = parseFloat(valStr);
        return isNaN(val) ? 0 : val;
      };

      // Raw concentrations (mg/L)
      const Ca = getNum("Ca");
      const Mg = getNum("Mg");
      const Na = getNum("Na");
      const K = getNum("K");
      const Cl = getNum("Cl");
      const SO4 = getNum("SO4");
      const HCO3 = getNum("HCO3");
      const CO3 = getNum("CO3");
      const EC = getNum("EC");
      const TDS_in = getNum("TDS");
      const TDS = TDS_in > 0 ? TDS_in : (EC > 0 ? EC * 0.65 : 0);

      // meq/L calculations
      const meq_Ca = Ca / EQ_WEIGHTS.Ca;
      const meq_Mg = Mg / EQ_WEIGHTS.Mg;
      const meq_Na = Na / EQ_WEIGHTS.Na;
      const meq_K = K / EQ_WEIGHTS.K;
      const meq_Cl = Cl / EQ_WEIGHTS.Cl;
      const meq_SO4 = SO4 / EQ_WEIGHTS.SO4;
      const meq_HCO3 = HCO3 / EQ_WEIGHTS.HCO3;
      const meq_CO3 = CO3 / EQ_WEIGHTS.CO3;

      // Totals
      const totalCations = meq_Ca + meq_Mg + meq_Na + meq_K;
      const totalAnions = meq_Cl + meq_SO4 + meq_HCO3 + meq_CO3;

      // Piper Percentages
      const catSum = totalCations > 0 ? totalCations : 1;
      const anSum = totalAnions > 0 ? totalAnions : 1;

      const pct_Ca = (meq_Ca / catSum) * 100;
      const pct_Mg = (meq_Mg / catSum) * 100;
      const pct_Na_K = ((meq_Na + meq_K) / catSum) * 100;
      const pct_Cl = (meq_Cl / anSum) * 100;
      const pct_SO4 = (meq_SO4 / anSum) * 100;
      const pct_HCO3_CO3 = ((meq_HCO3 + meq_CO3) / anSum) * 100;

      // Charge Balance Error
      let cbe = 0;
      if (totalCations + totalAnions > 0) {
        cbe = ((totalCations - totalAnions) / (totalCations + totalAnions)) * 100;
      }
      const cbeComment = Math.abs(cbe) <= 5 ? "Acceptable (≤ ±5%)" : "Needs Review (> ±5%)";

      // SAR & USSL
      let sar = 0;
      let usslClass = "Unknown";
      const denom = Math.sqrt((meq_Ca + meq_Mg) / 2);
      if (denom > 0) {
        sar = meq_Na / denom;
        if (EC > 0) {
          usslClass = `${getUSSLSalinity(EC)}-${getUSSLSodium(EC, sar)}`;
        }
      }

      // RSC
      const rsc = (meq_HCO3 + meq_CO3) - (meq_Ca + meq_Mg);

      // % Sodium Values
      const pctSodium = totalCations > 0 ? ((meq_Na + meq_K) / totalCations) * 100 : 0;

      // Hydrochemical Facies
      let facies = "Unknown";
      if (totalCations > 0 && totalAnions > 0) {
        const c = pct_Ca + pct_Mg;
        const a = pct_Cl + pct_SO4;
        if (c >= 50 && a >= 50) {
          if (c + a >= 150) facies = "Calcium Chloride (Ca-Cl) Type";
          else facies = "Mixed (Ca-Mg-Cl) Type";
        } else if (c >= 50 && a < 50) {
          facies = "Calcium-Magnesium Bicarbonate (Ca-Mg-HCO3) Type";
        } else if (c < 50 && a >= 50) {
          facies = "Sodium Chloride (Na-Cl) Type";
        } else if (c < 50 && a < 50) {
          if (c + a >= 50) facies = "Mixed (Na-HCO3-Cl) Type";
          else facies = "Sodium Bicarbonate (Na-HCO3) Type";
        }
      }

      // Ratios
      const na_na_ca = meq_Na + meq_Ca > 0 ? meq_Na / (meq_Na + meq_Ca) : 0;
      const cl_cl_hco3 = meq_Cl + meq_HCO3 > 0 ? meq_Cl / (meq_Cl + meq_HCO3) : 0;
      const gibbsLogTds = TDS > 0 ? Math.log10(TDS) : 0;
      const gibbsAnionRatio = meq_Cl + meq_HCO3 > 0 ? meq_Cl / (meq_Cl + meq_HCO3) : 0;
      const gibbsCationRatio = meq_Na + meq_K + meq_Ca > 0 ? (meq_Na + meq_K) / (meq_Na + meq_K + meq_Ca) : 0;

      // Indices
      const pi = meq_Ca + meq_Mg + meq_Na > 0 ? ((meq_Na + Math.sqrt(meq_HCO3)) / (meq_Ca + meq_Mg + meq_Na)) * 100 : 0;
      const kellyIndex = meq_Ca + meq_Mg > 0 ? meq_Na / (meq_Ca + meq_Mg) : 0;
      const magnesiumHazard = meq_Ca + meq_Mg > 0 ? (meq_Mg / (meq_Ca + meq_Mg)) * 100 : 0;

      // Total Alkalinity (as CaCO3 mg/L) = (meq_HCO3 + meq_CO3) * 50
      const totalAlkalinityCalc = (meq_HCO3 + meq_CO3) * 50;
      // Calculated TDS (mg/L) = EC * 0.64
      const tdsCalc = EC * 0.64;

      return {
        ...row,
        "S.No.": idx + 1,
        // Calculated columns explicitly requested
        "meq_Ca": Number(meq_Ca.toFixed(4)),
        "meq_Mg": Number(meq_Mg.toFixed(4)),
        "meq_Na": Number(meq_Na.toFixed(4)),
        "meq_K": Number(meq_K.toFixed(4)),
        "meq_Cl": Number(meq_Cl.toFixed(4)),
        "meq_SO4": Number(meq_SO4.toFixed(4)),
        "meq_HCO3": Number(meq_HCO3.toFixed(4)),
        "meq_CO3": Number(meq_CO3.toFixed(4)),
        "Total_Cation_meq": Number(totalCations.toFixed(4)),
        "Total_Anion_meq": Number(totalAnions.toFixed(4)),
        "Charge_Balance_Error_Pct": Number(cbe.toFixed(3)),
        "Charge_Balance_Error_Comment": cbeComment,
        "SAR": Number(sar.toFixed(3)),
        "RSC": Number(rsc.toFixed(3)),
        "Pct_Sodium": Number(pctSodium.toFixed(2)),
        "Ussl_Class": usslClass,
        "Hydrochemical_Facies": facies,
        "Na_Na_plus_Ca_meq": Number(na_na_ca.toFixed(4)),
        "Cl_Cl_plus_HCO3_meq": Number(cl_cl_hco3.toFixed(4)),
        "Gibbs_Log_TDS": Number(gibbsLogTds.toFixed(4)),
        "Gibbs_Anion_Ratio": Number(gibbsAnionRatio.toFixed(4)),
        "Gibbs_Cation_Ratio": Number(gibbsCationRatio.toFixed(4)),
        "pct_Ca": Number(pct_Ca.toFixed(2)),
        "pct_Mg": Number(pct_Mg.toFixed(2)),
        "pct_Na_plus_K": Number(pct_Na_K.toFixed(2)),
        "pct_Cl": Number(pct_Cl.toFixed(2)),
        "pct_SO4": Number(pct_SO4.toFixed(2)),
        "pct_HCO3_plus_CO3": Number(pct_HCO3_CO3.toFixed(2)),
        "PI_calc": Number(pi.toFixed(2)),
        "Kelly_Index_calc": Number(kellyIndex.toFixed(3)),
        "Magnesium_Hazard_calc": Number(magnesiumHazard.toFixed(2)),
        "Total_Alkalinity_calc": Number(totalAlkalinityCalc.toFixed(2)),
        "TDS_calc": Number(tdsCalc.toFixed(2)),
        // Heavy metals mapping
        "Fe": columnMapping["Fe"] ? getNum("Fe") : undefined,
        "As": columnMapping["As"] ? getNum("As") : undefined,
        "U": columnMapping["U"] ? getNum("U") : undefined,
        "Zn": columnMapping["Zn"] ? getNum("Zn") : undefined,
        "Cu": columnMapping["Cu"] ? getNum("Cu") : undefined,
        "Pb": columnMapping["Pb"] ? getNum("Pb") : undefined,
        "Cd": columnMapping["Cd"] ? getNum("Cd") : undefined,
        "Cr": columnMapping["Cr"] ? getNum("Cr") : undefined,
        "Hg": columnMapping["Hg"] ? getNum("Hg") : undefined,
        "Ni": columnMapping["Ni"] ? getNum("Ni") : undefined,
        "Se": columnMapping["Se"] ? getNum("Se") : undefined,
        "Mn": columnMapping["Mn"] ? getNum("Mn") : undefined,
        "Al": columnMapping["Al"] ? getNum("Al") : undefined,
        "Ba": columnMapping["Ba"] ? getNum("Ba") : undefined,
        "B": columnMapping["B"] ? getNum("B") : undefined,
        "Mo": columnMapping["Mo"] ? getNum("Mo") : undefined
      };
    });
  }, [mainRawData, columnMapping]);

  const originalKeys = useMemo(() => {
    if (!mainRawData || mainRawData.length === 0) return [];
    return Object.keys(mainRawData[0]);
  }, [mainRawData]);

  const originalOriginalKeys = useMemo(() => {
    return originalKeys.filter((key) => key.toLowerCase() !== "s.no." && key.toLowerCase() !== "s_no");
  }, [originalKeys]);

  // Search filter
  const filteredData = useMemo(() => {
    if (!searchTerm) return processedData;
    const term = searchTerm.toLowerCase();
    return processedData.filter((row) => {
      return Object.values(row).some((val) => 
        String(val).toLowerCase().includes(term)
      );
    });
  }, [processedData, searchTerm]);

  // Paginated Data
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  // Download complete excel sheet
  const downloadExcel = async () => {
    if (processedData.length === 0) {
      showToast("No data available to download.", "error");
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Hydrochemistry Calculations");

      const originalKeys = Object.keys(mainRawData[0]);
      const excelColumns = [];

      // S.No.
      excelColumns.push({ header: "S.No.", key: "S_No", width: 10 });

      // Original imported columns
      originalKeys.forEach((key) => {
        if (key.toLowerCase() === "s.no." || key.toLowerCase() === "s_no") return;
        excelColumns.push({ header: key, key: `orig_${key}`, width: 18 });
      });

      // Extra calculated columns
      const extraCols = [
        { header: "meq Ca", key: "meq_Ca", width: 12 },
        { header: "meq Mg", key: "meq_Mg", width: 12 },
        { header: "meq Na", key: "meq_Na", width: 12 },
        { header: "meq K", key: "meq_K", width: 12 },
        { header: "meq Cl", key: "meq_Cl", width: 12 },
        { header: "meq SO4", key: "meq_SO4", width: 12 },
        { header: "meq HCO3", key: "meq_HCO3", width: 12 },
        { header: "meq CO3", key: "meq_CO3", width: 12 },
        { header: "Total Cations (meq/L)", key: "Total_Cation_meq", width: 18 },
        { header: "Total Anions (meq/L)", key: "Total_Anion_meq", width: 18 },
        { header: "CBE (%)", key: "Charge_Balance_Error_Pct", width: 12 },
        { header: "CBE Comment", key: "Charge_Balance_Error_Comment", width: 22 },
        { header: "SAR", key: "SAR", width: 12 },
        { header: "RSC (meq/L)", key: "RSC", width: 12 },
        { header: "Sodium (%)", key: "Pct_Sodium", width: 12 },
        { header: "USSL Class", key: "Ussl_Class", width: 12 },
        { header: "Hydrochemical Facies", key: "Hydrochemical_Facies", width: 25 },
        { header: "Na / (Na+Ca) meq", key: "Na_Na_plus_Ca_meq", width: 15 },
        { header: "Cl / (Cl+HCO3) meq", key: "Cl_Cl_plus_HCO3_meq", width: 15 },
        { header: "Gibbs Log TDS", key: "Gibbs_Log_TDS", width: 15 },
        { header: "Gibbs Anion Ratio", key: "Gibbs_Anion_Ratio", width: 15 },
        { header: "Gibbs Cation Ratio", key: "Gibbs_Cation_Ratio", width: 15 },
        { header: "Permeability Index (PI)", key: "PI_calc", width: 18 },
        { header: "Kelly Index", key: "Kelly_Index_calc", width: 15 },
        { header: "Magnesium Hazard (%)", key: "Magnesium_Hazard_calc", width: 18 },
        { header: "Total Alkalinity (Calculated, mg/L as CaCO3)", key: "Total_Alkalinity_calc", width: 22 },
        { header: "Calculated TDS (EC * 0.64, mg/L)", key: "TDS_calc", width: 20 },
        // Piper Percentages (meq %) columns
        { header: "% Ca (meq)", key: "pct_Ca", width: 12 },
        { header: "% Mg (meq)", key: "pct_Mg", width: 12 },
        { header: "% (Na+K) (meq)", key: "pct_Na_plus_K", width: 15 },
        { header: "% (CO3+HCO3) (meq)", key: "pct_HCO3_plus_CO3", width: 18 },
        { header: "% SO4 (meq)", key: "pct_SO4", width: 12 },
        { header: "% Cl (meq)", key: "pct_Cl", width: 12 }
      ];

      excelColumns.push(...extraCols);
      sheet.columns = excelColumns;

      processedData.forEach((row, idx) => {
        const rowDataToSubmit: any = {
          S_No: idx + 1,
          meq_Ca: row.meq_Ca,
          meq_Mg: row.meq_Mg,
          meq_Na: row.meq_Na,
          meq_K: row.meq_K,
          meq_Cl: row.meq_Cl,
          meq_SO4: row.meq_SO4,
          meq_HCO3: row.meq_HCO3,
          meq_CO3: row.meq_CO3,
          Total_Cation_meq: row.Total_Cation_meq,
          Total_Anion_meq: row.Total_Anion_meq,
          Charge_Balance_Error_Pct: row.Charge_Balance_Error_Pct,
          Charge_Balance_Error_Comment: row.Charge_Balance_Error_Comment,
          SAR: row.SAR,
          RSC: row.RSC,
          Pct_Sodium: row.Pct_Sodium,
          Ussl_Class: row.Ussl_Class,
          Hydrochemical_Facies: row.Hydrochemical_Facies,
          Na_Na_plus_Ca_meq: row.Na_Na_plus_Ca_meq,
          Cl_Cl_plus_HCO3_meq: row.Cl_Cl_plus_HCO3_meq,
          Gibbs_Log_TDS: row.Gibbs_Log_TDS,
          Gibbs_Anion_Ratio: row.Gibbs_Anion_Ratio,
          Gibbs_Cation_Ratio: row.Gibbs_Cation_Ratio,
          PI_calc: row.PI_calc,
          Kelly_Index_calc: row.Kelly_Index_calc,
          Magnesium_Hazard_calc: row.Magnesium_Hazard_calc,
          Total_Alkalinity_calc: row.Total_Alkalinity_calc,
          TDS_calc: row.TDS_calc,
          pct_Ca: row.pct_Ca,
          pct_Mg: row.pct_Mg,
          pct_Na_plus_K: row.pct_Na_plus_K,
          pct_HCO3_plus_CO3: row.pct_HCO3_plus_CO3,
          pct_SO4: row.pct_SO4,
          pct_Cl: row.pct_Cl
        };

        originalKeys.forEach((key) => {
          if (key.toLowerCase() === "s.no." || key.toLowerCase() === "s_no") return;
          rowDataToSubmit[`orig_${key}`] = row[key];
        });

        sheet.addRow(rowDataToSubmit);
      });

      // Style sheet
      sheet.eachRow((row, rowNumber) => {
        row.eachCell((cell) => {
          if (rowNumber === 1) {
            cell.font = { name: "Times New Roman", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          } else {
            cell.font = { name: "Times New Roman", size: 12 };
            cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
          }

          cell.border = {
            top: { style: "thin", color: { argb: "FF000000" } },
            left: { style: "thin", color: { argb: "FF000000" } },
            bottom: { style: "thin", color: { argb: "FF000000" } },
            right: { style: "thin", color: { argb: "FF000000" } }
          };
        });
      });

      const buf = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `Hydrochemistry_Calculated_Data_${Date.now()}.xlsx`;
      link.click();

      showToast("Styled Excel Report written successfully!", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to export Excel file.", "error");
    }
  };

  if (!isVisible) return null;

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm transition-all animate-fadeIn">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-5 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-bold text-slate-800">
              Hydrochemistry Calculated Parameter Sheet
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Show, inspect, and download a comprehensive Excel sheet complete with calculated milli-equivalent (meq/L) parameters, SAR, RSC, CBE%, Gibbs, Piper percentages, indices, and water quality classification.
          </p>
        </div>

        {mainRawData && mainRawData.length > 0 && (
          <button
            onClick={downloadExcel}
            className="w-full md:w-auto px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-700/15 hover:shadow-emerald-700/25 transform active:scale-[0.98] transition-all"
          >
            <Download className="w-4 h-4" />
            Download Complete Excel Sheet
          </button>
        )}
      </div>

      {/* Upload State Guard */}
      {(!mainRawData || mainRawData.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 bg-slate-50 border-2 border-dashed border-slate-200 rounded-full flex items-center justify-center mb-4">
            <Table className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-sm font-extrabold text-slate-700 mb-1">No Data Available</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            Kindly upload your water quality spreadsheet (Excel/CSV) in the dashboard tab to view calculations and download.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Mapping Alert Banner & Toggle */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-slate-50 border border-slate-200 p-4 rounded-2xl">
            <div className="flex gap-2.5 items-start">
              <span className="p-1 bg-indigo-50 text-indigo-700 rounded-lg shrink-0">
                <Sliders className="w-4 h-4" />
              </span>
              <div>
                <span className="text-xs font-extrabold text-slate-800 block mb-0.5">
                  Column Matching Configuration
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Cations (Ca, Mg, Na, K) and Anions (Cl, SO4, HCO3, CO3) and EC are mapped from file columns to calculate parameters.
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-4 py-2 bg-white hover:bg-slate-100/80 border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 cursor-pointer shadow-xs transition-all"
            >
              {showConfig ? "Hide Column Mapping" : "Verify Column Mapping"}
            </button>
          </div>

          {/* Quick mapping configurations */}
          {showConfig && (
            <div className="p-5 border border-slate-200 bg-slate-50/45 rounded-2xl grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3.5 animate-fadeIn">
              {COLUMN_DEFINITIONS.map((def) => {
                const availableCols = Object.keys(mainRawData[0] || {});
                return (
                  <div key={def.id} className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                      {def.label}
                    </label>
                    <select
                      value={columnMapping[def.id] || ""}
                      onChange={(e) => setColumnMapping({ ...columnMapping, [def.id]: e.target.value })}
                      className="w-full text-xs p-2 rounded-xl border border-slate-200 bg-white shadow-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                    >
                      <option value="">-- Mapped None --</option>
                      {availableCols.map((colName) => (
                        <option key={colName} value={colName}>
                          {colName}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}

          {/* Data search filter & records overview */}
          <div className="flex flex-col md:flex-row gap-3 justify-between items-center bg-slate-50/50 p-2 border border-slate-250/65 rounded-2xl">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search calculated records..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-500 shadow-inner transition-all"
              />
            </div>
            <div className="text-xs font-semibold text-slate-500 flex items-center gap-2">
              <span className="p-1 bg-indigo-50 text-indigo-700 rounded-md">
                <Sparkles className="w-3 h-3" />
              </span>
              Showing {filteredData.length} of {processedData.length} calculated records
            </div>
          </div>

          {/* Table container */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-xs">
            <table className="w-full border-collapse text-left text-[11px] text-slate-600 bg-white">
              <thead className="bg-slate-55 border-b border-slate-200 font-extrabold text-slate-700 text-xs select-none">
                <tr>
                  <th className="px-4 py-3 bg-slate-100 font-bold whitespace-nowrap">S.No.</th>
                  {/* Original imported columns */}
                  {originalOriginalKeys.map((key) => (
                    <th key={key} className="px-4 py-3 bg-slate-100 font-bold whitespace-nowrap">
                      {key}
                    </th>
                  ))}
                  {/* Extra calculated columns */}
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">meq Ca</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">meq Mg</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">meq Na</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">meq K</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">meq Cl</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">meq SO4</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">meq HCO3</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">meq CO3</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">Total Cations (meq/L)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">Total Anions (meq/L)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">CBE (%)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">CBE Comment</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">SAR</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">RSC (meq/L)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-700 font-bold whitespace-nowrap">Sodium (%)</th>
                  <th className="px-4 py-3 bg-emerald-50 text-emerald-800 font-bold whitespace-nowrap">USSL Class</th>
                  <th className="px-4 py-3 bg-emerald-50 text-emerald-800 font-bold whitespace-nowrap">Hydrochemical Facies</th>
                  <th className="px-4 py-3 bg-slate-50 font-bold whitespace-nowrap">Na / (Na+Ca) meq</th>
                  <th className="px-4 py-3 bg-slate-50 font-bold whitespace-nowrap">Cl / (Cl+HCO3) meq</th>
                  <th className="px-4 py-3 bg-slate-50 font-bold whitespace-nowrap">Gibbs Log TDS</th>
                  <th className="px-4 py-3 bg-slate-50 font-bold whitespace-nowrap">Gibbs Anion Ratio</th>
                  <th className="px-4 py-3 bg-slate-50 font-bold whitespace-nowrap">Gibbs Cation Ratio</th>
                  <th className="px-4 py-3 bg-slate-50 font-bold whitespace-nowrap">Permeability Index (PI)</th>
                  <th className="px-4 py-3 bg-slate-50 font-bold whitespace-nowrap">Kelly Index</th>
                  <th className="px-4 py-3 bg-slate-50 font-bold whitespace-nowrap">Magnesium Hazard (%)</th>
                  <th className="px-4 py-3 bg-emerald-50 text-emerald-800 font-bold whitespace-nowrap">Total Alkalinity (Calculated, mg/L as CaCO3)</th>
                  <th className="px-4 py-3 bg-emerald-50 text-emerald-800 font-bold whitespace-nowrap">Calculated TDS (EC * 0.64, mg/L)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-800 font-bold whitespace-nowrap">% Ca (meq)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-800 font-bold whitespace-nowrap">% Mg (meq)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-800 font-bold whitespace-nowrap">% (Na+K) (meq)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-800 font-bold whitespace-nowrap">% (CO3+HCO3) (meq)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-800 font-bold whitespace-nowrap">% SO4 (meq)</th>
                  <th className="px-4 py-3 bg-indigo-50 text-indigo-800 font-bold whitespace-nowrap">% Cl (meq)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {paginatedData.map((row: any, i) => {
                  return (
                    <tr key={i} className="hover:bg-slate-50/50 transition-all">
                      <td className="px-4 py-2.5 font-bold text-slate-500 bg-slate-50/30 whitespace-nowrap">{row["S.No."]}</td>
                      {/* Original imported columns */}
                      {originalOriginalKeys.map((key) => (
                        <td key={key} className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                          {row[key] !== undefined && row[key] !== null ? String(row[key]) : "-"}
                        </td>
                      ))}
                      {/* Extra calculated columns */}
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["meq_Ca"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["meq_Mg"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["meq_Na"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["meq_K"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["meq_Cl"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["meq_SO4"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["meq_HCO3"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["meq_CO3"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-700 text-right whitespace-nowrap">{formatAdvanced(row["Total_Cation_meq"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-700 text-right whitespace-nowrap">{formatAdvanced(row["Total_Anion_meq"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-right whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-md font-bold ${
                          Math.abs(row["Charge_Balance_Error_Pct"]) <= 5 
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                            : "bg-red-50 text-red-700 border border-red-100"
                        }`}>
                          {formatAdvanced(row["Charge_Balance_Error_Pct"], 3)}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-md font-bold ${
                          row["Charge_Balance_Error_Comment"] === "Acceptable (≤ ±5%)"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}>
                          {row["Charge_Balance_Error_Comment"]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-bold text-indigo-700 text-right whitespace-nowrap">{formatAdvanced(row["SAR"], 3)}</td>
                      <td className="px-4 py-2.5 font-mono text-indigo-700 text-right whitespace-nowrap">{formatAdvanced(row["RSC"], 3)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-700 text-right whitespace-nowrap">{formatAdvanced(row["Pct_Sodium"], 2)}%</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 font-bold border border-amber-100 font-mono">
                          {row["Ussl_Class"]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-emerald-800 font-bold truncate max-w-[200px] whitespace-nowrap" title={row["Hydrochemical_Facies"]}>
                        {row["Hydrochemical_Facies"]}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["Na_Na_plus_Ca_meq"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["Cl_Cl_plus_HCO3_meq"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["Gibbs_Log_TDS"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["Gibbs_Anion_Ratio"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["Gibbs_Cation_Ratio"], 4)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["PI_calc"], 2)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["Kelly_Index_calc"], 3)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 text-right whitespace-nowrap">{formatAdvanced(row["Magnesium_Hazard_calc"], 2)}%</td>
                      <td className="px-4 py-2.5 font-mono font-bold text-emerald-800 bg-emerald-50/25 text-right whitespace-nowrap">{formatAdvanced(row["Total_Alkalinity_calc"], 2)}</td>
                      <td className="px-4 py-2.5 font-mono font-bold text-emerald-800 bg-emerald-50/25 text-right whitespace-nowrap">{formatAdvanced(row["TDS_calc"], 2)}</td>
                      <td className="px-4 py-2.5 font-mono text-indigo-800 text-right whitespace-nowrap">{formatAdvanced(row["pct_Ca"], 2)}%</td>
                      <td className="px-4 py-2.5 font-mono text-indigo-800 text-right whitespace-nowrap">{formatAdvanced(row["pct_Mg"], 2)}%</td>
                      <td className="px-4 py-2.5 font-mono text-indigo-800 text-right whitespace-nowrap">{formatAdvanced(row["pct_Na_plus_K"], 2)}%</td>
                      <td className="px-4 py-2.5 font-mono text-indigo-800 text-right whitespace-nowrap">{formatAdvanced(row["pct_HCO3_plus_CO3"], 2)}%</td>
                      <td className="px-4 py-2.5 font-mono text-indigo-800 text-right whitespace-nowrap">{formatAdvanced(row["pct_SO4"], 2)}%</td>
                      <td className="px-4 py-2.5 font-mono text-indigo-800 text-right whitespace-nowrap">{formatAdvanced(row["pct_Cl"], 2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center pt-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(currentPage - 1)}
                className="px-3.5 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Previous
              </button>
              <span className="text-xs font-bold text-slate-500">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
                className="px-3.5 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

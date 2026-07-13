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
  { id: "Season", label: "Season / Period", aliases: ["season", "period"] },
  { id: "Year", label: "Year", aliases: ["year"] }
];

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
        "Magnesium_Hazard_calc": Number(magnesiumHazard.toFixed(2))
      };
    });
  }, [mainRawData, columnMapping]);

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

      const excelColumns = [
        { header: "S.No.", key: "S_No", width: 10 },
        { header: "Well ID", key: "WellID", width: 15 },
        { header: "State Name", key: "State", width: 20 },
        { header: "District Name", key: "District", width: 20 },
        { header: "Block / Tehsil", key: "Block", width: 20 },
        { header: "Location Name", key: "Location", width: 25 },
        { header: "Latitude", key: "Lat", width: 15 },
        { header: "Longitude", key: "Lng", width: 15 },
        { header: "Season", key: "Season", width: 15 },
        { header: "Year", key: "Year", width: 10 },
        { header: "EC (µS/cm)", key: "EC", width: 15 },
        { header: "TDS (mg/L)", key: "TDS", width: 15 },
        { header: "Ca (mg/L)", key: "Ca", width: 12 },
        { header: "Mg (mg/L)", key: "Mg", width: 12 },
        { header: "Na (mg/L)", key: "Na", width: 12 },
        { header: "K (mg/L)", key: "K", width: 12 },
        { header: "Cl (mg/L)", key: "Cl", width: 12 },
        { header: "SO4 (mg/L)", key: "SO4", width: 12 },
        { header: "HCO3 (mg/L)", key: "HCO3", width: 12 },
        { header: "CO3 (mg/L)", key: "CO3", width: 12 },
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
        { header: "Magnesium Hazard (%)", key: "Magnesium_Hazard_calc", width: 18 }
      ];

      sheet.columns = excelColumns;

      processedData.forEach((row) => {
        const getVal = (key: string): any => {
          const colName = columnMapping[key];
          if (colName && row[colName] !== undefined) return row[colName];
          return row[key] !== undefined ? row[key] : "";
        };

        sheet.addRow({
          S_No: row["S.No."],
          WellID: getVal("WellId") || getVal("WellID") || row["WellID"] || row["Well ID"] || "",
          State: getVal("State") || "",
          District: getVal("District") || "",
          Block: getVal("Block") || "",
          Location: getVal("Location") || "",
          Lat: getVal("Lat") || "",
          Lng: getVal("Lng") || "",
          Season: getVal("Season") || "",
          Year: getVal("Year") || "",
          EC: getVal("EC") || "",
          TDS: getVal("TDS") || "",
          Ca: getVal("Ca") || "",
          Mg: getVal("Mg") || "",
          Na: getVal("Na") || "",
          K: getVal("K") || "",
          Cl: getVal("Cl") || "",
          SO4: getVal("SO4") || "",
          HCO3: getVal("HCO3") || "",
          CO3: getVal("CO3") || "",
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
          Magnesium_Hazard_calc: row.Magnesium_Hazard_calc
        });
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
                  <th className="px-4 py-3 bg-slate-100 font-bold">S.No.</th>
                  <th className="px-4 py-3 bg-slate-100 font-bold">Well ID</th>
                  <th className="px-4 py-3 bg-slate-100 font-bold">State</th>
                  <th className="px-4 py-3 bg-slate-100 font-bold">District</th>
                  <th className="px-4 py-3 bg-slate-100 font-bold">Block</th>
                  <th className="px-4 py-3 bg-slate-100 font-bold">Location</th>
                  <th className="px-4 py-3 bg-slate-100 font-bold">Lat</th>
                  <th className="px-4 py-3 bg-slate-100 font-bold">Long</th>
                  <th className="px-4 py-3 bg-slate-50 text-indigo-700 font-bold">CBE (%)</th>
                  <th className="px-4 py-3 bg-slate-50 text-indigo-700 font-bold">SAR</th>
                  <th className="px-4 py-3 bg-slate-50 text-indigo-700 font-bold">RSC</th>
                  <th className="px-4 py-3 bg-emerald-50 text-emerald-800 font-bold">USSL Class</th>
                  <th className="px-4 py-3 bg-emerald-50 text-emerald-800 font-bold">Hydrochemical Facies</th>
                  <th className="px-4 py-3 font-bold">Na/(Na+Ca)</th>
                  <th className="px-4 py-3 font-bold">Cl/(Cl+HCO3)</th>
                  <th className="px-4 py-3 font-bold">Gibbs TDS Log</th>
                  <th className="px-4 py-3 font-bold">PI calc</th>
                  <th className="px-4 py-3 font-bold">Kelly Index</th>
                  <th className="px-4 py-3 font-bold">Mg Hazard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {paginatedData.map((row: any, i) => {
                  const locationKey = columnMapping.Location || "Location";
                  const wellKey = columnMapping.WellId || "WellId";
                  const stateKey = columnMapping.State || "State";
                  const districtKey = columnMapping.District || "District";
                  const blockKey = columnMapping.Block || "Block";
                  const latKey = columnMapping.Lat || "Lat";
                  const lngKey = columnMapping.Lng || "Lng";
                  return (
                    <tr key={i} className="hover:bg-slate-50/50 transition-all">
                      <td className="px-4 py-2.5 font-bold text-slate-500 bg-slate-50/30">{row["S.No."]}</td>
                      <td className="px-4 py-2.5 text-slate-700 truncate max-w-[120px]" title={row[wellKey] || ""}>
                        {row[wellKey] || "-"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 truncate max-w-[120px]" title={row[stateKey] || ""}>
                        {row[stateKey] || "-"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 truncate max-w-[120px]" title={row[districtKey] || ""}>
                        {row[districtKey] || "-"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 truncate max-w-[120px]" title={row[blockKey] || ""}>
                        {row[blockKey] || "-"}
                      </td>
                      <td className="px-4 py-2.5 font-bold text-slate-800 truncate max-w-[140px]" title={row[locationKey] || ""}>
                        {row[locationKey] || "Unknown Site"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {row[latKey] ? Number(row[latKey]).toFixed(4) : "-"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {row[lngKey] ? Number(row[lngKey]).toFixed(4) : "-"}
                      </td>
                      <td className="px-4 py-2.5 font-mono">
                        <span className={`px-2 py-0.5 rounded-md font-bold ${
                          Math.abs(row["Charge_Balance_Error_Pct"]) <= 5 
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                            : "bg-red-50 text-red-700 border border-red-100"
                        }`}>
                          {row["Charge_Balance_Error_Pct"]}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-bold text-indigo-700">{row["SAR"]}</td>
                      <td className="px-4 py-2.5 font-mono text-indigo-700">{row["RSC"]}</td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 font-bold border border-amber-100 font-mono">
                          {row["Ussl_Class"]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-emerald-800 font-bold truncate max-w-[150px]" title={row["Hydrochemical_Facies"]}>
                        {row["Hydrochemical_Facies"]}
                      </td>
                      <td className="px-4 py-2.5 font-mono">{row["Na_Na_plus_Ca_meq"]}</td>
                      <td className="px-4 py-2.5 font-mono">{row["Cl_Cl_plus_HCO3_meq"]}</td>
                      <td className="px-4 py-2.5 font-mono">{row["Gibbs_Log_TDS"]}</td>
                      <td className="px-4 py-2.5 font-mono">{row["PI_calc"]}</td>
                      <td className="px-4 py-2.5 font-mono">{row["Kelly_Index_calc"]}</td>
                      <td className="px-4 py-2.5 font-mono">{row["Magnesium_Hazard_calc"]}%</td>
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

import React, { useState, useEffect, useMemo, useRef } from "react";
import shp from "shpjs";
import * as XLSX from "xlsx";
import { DataHeaders } from "../types";
import {
  FileText,
  TableProperties,
  Globe,
  Settings2,
  Image as ImageIcon,
  Download,
  Upload,
  Printer,
  FileDown,
  LayoutDashboard,
  TrendingUp,
  Compass,
  Layers,
  Cpu,
  Table,
  Table2,
  Database,
  BarChart3,
  LayoutTemplate,
  Sparkles
} from "lucide-react";

interface FortnightlyAlertsViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState: string;
}

const COLUMNS = [
  "S No", "State", "District", "Block", "Village/Town", "Latitude", "Longitude", 
  "Sample Collection Structure", "Depth of the Structure from Ground Level in Meters", 
  "Sample Collection Date", "Sample Analysis Date", "pH", "EC (µS/cm at 25 C)", "Cl-1 (mg/L)", 
  "SO4-2 (mg/L)", "NO3-1 (mg/L)", "F", "Ca+2 (mg/L)", "Mg+2 (mg/L)", 
  "TH *as CaCO3 (mg/L)", "Cr (mg/L)", "Mn (mg/L)", "Fe (mg/L)", "Ni (mg/L)", 
  "Cu (mg/L)", "Zn (mg/L)", "As (µg/L)", "Se (µg/L)", "Cd (µg/L)", "Pb (µg/L)", 
  "U (µg/L)"
];

const DEFAULT_LIMITS = {
  "pH": { acc: 6.5, perm: 8.5, isStrictRange: true },
  "EC (µS/cm at 25 C)": { acc: 750, perm: 3000 },
  "Cl-1 (mg/L)": { acc: 250, perm: 1000 },
  "SO4-2 (mg/L)": { acc: 200, perm: 400 },
  "NO3-1 (mg/L)": { acc: 45, perm: 45 },
  "F": { acc: 1.0, perm: 1.5 },
  "Ca+2 (mg/L)": { acc: 75, perm: 200 },
  "Mg+2 (mg/L)": { acc: 30, perm: 100 },
  "TH *as CaCO3 (mg/L)": { acc: 200, perm: 600 },
  "Cr (mg/L)": { acc: 0.05, perm: 0.05 },
  "Mn (mg/L)": { acc: 0.1, perm: 0.3 },
  "Fe (mg/L)": { acc: 1.0, perm: 1.0 },
  "Ni (mg/L)": { acc: 0.02, perm: 0.02 },
  "Cu (mg/L)": { acc: 0.05, perm: 1.5 },
  "Zn (mg/L)": { acc: 5.0, perm: 15.0 },
  "As (µg/L)": { acc: 10, perm: 10 },
  "Se (µg/L)": { acc: 10, perm: 10 },
  "Cd (µg/L)": { acc: 3, perm: 3 },
  "Pb (µg/L)": { acc: 10, perm: 10 },
  "U (µg/L)": { acc: 30, perm: 30 }
};

const HEAVY_METALS = ["Cr", "Mn", "Fe", "Ni", "Cu", "Zn", "As", "Se", "Cd", "Pb", "U"];

const PARAM_COLORS = [
  { bg: "from-blue-400 to-blue-600", border: "border-blue-700", shadow: "shadow-[0_2px_0_rgb(29,78,216)]" },
  { bg: "from-purple-400 to-purple-600", border: "border-purple-700", shadow: "shadow-[0_2px_0_rgb(126,34,206)]" },
  { bg: "from-rose-400 to-rose-600", border: "border-rose-700", shadow: "shadow-[0_2px_0_rgb(190,18,60)]" },
  { bg: "from-amber-400 to-amber-600", border: "border-amber-700", shadow: "shadow-[0_2px_0_rgb(180,83,9)]" },
  { bg: "from-teal-400 to-teal-600", border: "border-teal-700", shadow: "shadow-[0_2px_0_rgb(15,118,110)]" },
  { bg: "from-fuchsia-400 to-fuchsia-600", border: "border-fuchsia-700", shadow: "shadow-[0_2px_0_rgb(162,28,175)]" },
  { bg: "from-cyan-400 to-cyan-600", border: "border-cyan-700", shadow: "shadow-[0_2px_0_rgb(14,116,144)]" },
  { bg: "from-orange-400 to-orange-600", border: "border-orange-700", shadow: "shadow-[0_2px_0_rgb(194,65,12)]" },
  { bg: "from-indigo-400 to-indigo-600", border: "border-indigo-700", shadow: "shadow-[0_2px_0_rgb(67,56,202)]" },
  { bg: "from-pink-400 to-pink-600", border: "border-pink-700", shadow: "shadow-[0_2px_0_rgb(190,24,93)]" },
  { bg: "from-emerald-400 to-emerald-600", border: "border-emerald-700", shadow: "shadow-[0_2px_0_rgb(4,120,87)]" },
  { bg: "from-sky-400 to-sky-600", border: "border-sky-700", shadow: "shadow-[0_2px_0_rgb(3,105,161)]" },
  { bg: "from-violet-400 to-violet-600", border: "border-violet-700", shadow: "shadow-[0_2px_0_rgb(109,40,217)]" },
  { bg: "from-red-400 to-red-600", border: "border-red-700", shadow: "shadow-[0_2px_0_rgb(185,28,28)]" },
  { bg: "from-lime-500 to-lime-600", border: "border-lime-700", shadow: "shadow-[0_2px_0_rgb(77,124,15)]" }
];

const REMEDIAL_MEASURES = [
  {
    id: "pH", title: "Risk Perception & Remedial Measures for pH",
    sections: [{ desc: "Treatment of acidic water: Passing through Neutralizing Filter containing Calcite or Magnesia, or adding Soda Ash. Treatment of basic water: Installation of an acid injector (e.g., white vinegar or citric acid)." }]
  },
  {
    id: "TDS", title: "Risk Perception & Remedial Measures for TDS",
    sections: [{ desc: "Reverse Osmosis (RO), Electrodialysis, and Distillation are the most effective methods for reducing Total Dissolved Solids." }]
  },
  {
    id: "Turbidity", title: "Risk Perception & Remedial Measures for Turbidity",
    sections: [{ desc: "Coagulation, flocculation, sedimentation, and filtration (sand or multimedia filters) are used to remove suspended particles causing turbidity." }]
  },
  {
    id: "Alkalinity", title: "Risk Perception & Remedial Measures for Alkalinity",
    sections: [{ desc: "Can be reduced by Reverse Osmosis (RO) or by carefully adding a weak acid to lower the pH and neutralize the excess alkalinity." }]
  },
  {
    id: "EC", title: "Risk Perception & Remedial Measures for EC",
    sections: [{ desc: "Since Electrical Conductivity is directly related to dissolved ions (TDS), methods like Reverse Osmosis (RO) and Deionization (Ion Exchange) effectively lower it." }]
  },
  {
    id: "Cl-1", title: "Risk Perception & Remedial Measures for Chloride",
    riskPerception: "High concentration of chloride concentration in draining water.",
    sections: [{ desc: "Reverse Osmosis (RO), Distillation, and specific Ion Exchange (anion exchange) resins are effective for chloride removal. Standard boiling does not remove chlorides." }]
  },
  {
    id: "F", title: "Risk Perception & Remedial Measures for Fluoride",
    riskPerception: "Dental and Skeletal Fluorosis: Studies suggest high levels of fluoride may lead to discoloration and damage to teeth and affect bone health.",
    sections: [{ desc: "Defluoridation techniques can be adopted: Adsorption technique, Ion-exchange technique, Precipitation technique and other techniques, which include electro chemical defluoridation and Reverse Osmosis." }]
  },
  {
    id: "NO3-1", title: "Risk Perception & Remedial Measures for Nitrate",
    riskPerception: "High nitrate causes cyanosis (methaemoglobinaemia) or Blue baby disease. It effects digestive system. Development of cancer, especially digestive cancers, such as colorectal stomach and esophagus cancer, complications during pregnancy.",
    sections: [{ desc: "Reverse osmosis systems for drinking water to be used. Biological denitrification and ion-exchange can also be applied." }]
  },
  {
    id: "SO4-2", title: "Risk Perception & Remedial Measures for Sulphate",
    riskPerception: "High concentration of sulphate concentration in draining water may be more sensitive to the cathartic effects. Children, transients and the elderly are high risk of dehydration from diarrhoea may be caused by high concentration of sulfate in drinking-water.",
    sections: [{ desc: "The techniques may be adopted: Ion-exchange technique, Nano-filtration technique, Reverse Osmosis and electro-dialysis may be used." }]
  },
  {
    id: "Ca+2", title: "Risk Perception & Remedial Measures for Calcium",
    sections: [{ desc: "Water softening using cation exchange resins, Reverse Osmosis (RO), or chemical lime softening." }]
  },
  {
    id: "Mg+2", title: "Risk Perception & Remedial Measures for Magnesium",
    sections: [{ desc: "Water softening using cation exchange resins, Reverse Osmosis (RO), or chemical lime softening." }]
  },
  {
    id: "TH", title: "Risk Perception & Remedial Measures for Total Hardness",
    riskPerception: "Reduced lathering of soaps, buildup of scale on heating elements and boilers, reduced water flow in distribution pipes due to scale buildup. High levels of sodium in drinking water may harm your health like Cathartic and diuretic effect.",
    sections: [{ desc: "Hardness minerals can be removed with a water softener and dilution technique and Reverse Osmosis., which replaces the calcium and magnesium (and iron, manganese, radium and other positive ions) with sodium." }]
  },
  {
    id: "Cr", title: "Risk Perception & Remedial Measures for Chromium",
    sections: [{ desc: "Hexavalent chromium can be removed by Reverse Osmosis (RO), Anion Exchange, or reduction to trivalent chromium followed by coagulation and filtration." }]
  },
  {
    id: "Cu", title: "Risk Perception & Remedial Measures for Copper",
    sections: [{ desc: "Reverse Osmosis (RO), Cation Exchange (water softeners), and raising the pH of the water (to prevent pipe corrosion which is a common source of copper)." }]
  },
  {
    id: "Zn", title: "Risk Perception & Remedial Measures for Zinc",
    sections: [{ desc: "Ion Exchange (water softeners), Reverse Osmosis (RO), and Distillation are highly effective at removing zinc from drinking water." }]
  },
  {
    id: "As", title: "Risk Perception & Remedial Measures for Arsenic",
    riskPerception: "Long-term exposure of Arsenic is associated with skin, bladder, lung, risk of heart disease and hypertension and other cancers.",
    sections: [{ desc: "The techniques may be adopted: Adsorption technique, Ion-exchange technique, Reverse Osmosis and using alternative sources such as rainwater harvesting or deep aquifer water." }]
  },
  {
    id: "Cd", title: "Risk Perception & Remedial Measures for Cadmium",
    riskPerception: "Cadmium in drinking water is highly toxic and causing significant health risks, primarily it is accumulation in the kidneys. It can lead to kidney damage (tubular dysfunction), bone demineralization (osteoporosis and osteomalacia), and itai-itai disease, while being classified as a carcinogen. Acute symptoms include diarrhea, vomiting, and muscle cramps.",
    sections: [{ desc: "Effective mitigation of cadmium (Cd) from drinking water primarily reverse osmosis (RO), ion exchange, and coagulation/filtration." }]
  },
  {
    id: "Fe", title: "Risk Perception & Remedial Measures for Iron",
    riskPerception: "An excessive amount of exposure to iron can increase the risk of Parkinson's, cardiovascular disease, diabetes mellitus, pigmentation changes, Alzheimer's, as well as renal, liver, respiratory, and neurological issues.",
    sections: [{ desc: "Oxygenation of groundwater followed by precipitation and Reverse osmosis systems." }]
  },
  {
    id: "Pb", title: "Risk Perception & Remedial Measures for Lead",
    riskPerception: "Lead Can lead to hypertension, kidney damage, and reproductive issues in adults and Neurological damage; especially harmful to children, lead exposure can cause developmental delays, lower IQ, and behavioural issues.",
    sections: [{ desc: "Implement water treatment methods that reduce corrosion in pipes, such as adjusting pH, alkalinity, and adding inhibitors like orthophosphate. RO is also highly effective." }]
  },
  {
    id: "Mn", title: "Risk Perception & Remedial Measures for Manganese",
    riskPerception: "Continue use can damage liver, lungs and kidneys, effects the metabolism of iron for formation of hemoglobin and leads to neurological conditions- impaired memory, impaired motor coordination and delayed reaction time- results in disease called Manganism.",
    sections: [{ desc: "Treating the water at its source, filtration system and water treatment method." }]
  },
  {
    id: "Ni", title: "Risk Perception & Remedial Measures for Nickel",
    riskPerception: "Nickel is used in the nickel/chrome plating and so can occasionally leach into water. High concentration of nickel contaminated water is used for domestic/ drinking purposes, it can cause skin irritation (dermatitis), gastrointestinal issues (nausea, vomiting), and long-term risks like kidney/liver damage, reduced body weight and potential carcinogenicity.",
    sections: [{ desc: "There are several effective methods for removing nickel from water namely: Chemical Precipitation, Ion Exchange, Membrane Filtration, Adsorption on activated carbon, Electrodialysis, UV radiation and Biological treatment." }]
  },
  {
    id: "Se", title: "Risk Perception & Remedial Measures for Selenium",
    riskPerception: "Excessive intake of selenium from drinking water, typically more than permissible limit may causes selenosis, characterized by brittle hair, hair loss, and deformed, discolored nails. Other side effects include gastrointestinal distress (nausea, diarrhea), neurological issues (fatigue, irritability, tremor), and extreme cases can lead to organ failure.",
    sections: [{ desc: "Effective selenium mitigation from drinking water, involves advanced techniques like reverse osmosis (RO), ion exchange, and adsorption (e.g., activated alumina or iron-based media). Iron electrocoagulation, which generates reactive rust to bind selenium, can remove 98%." }]
  },
  {
    id: "U", title: "Risk Perception & Remedial Measures for Uranium",
    riskPerception: "The kidney and lungs are found to be the major target organs of Uranium toxicity and it may cause cancer from radioactive uranium. In animal bones, Uranium influences inhibition of osteoblastic activity, thereby reducing bone volume.",
    sections: [{ desc: "The technologies for uranium removal: Coagulation/filtration, Lime softening, Anion exchange, Reverse osmosis and Activated alumina may remove 80-90% uranium from water." }]
  }
];

const STANDARD_TREATMENTS = [
  {
    title: "Reverse Osmosis (RO)",
    desc: "Forces water through a semi-permeable membrane. This is one of the most effective methods for removing heavy metals, dissolved solids (TDS), fluoride, nitrate, and various chemicals.",
    chemistry: "Osmotic pressure (> osmotic pressure of feed) drives H₂O through a semipermeable membrane (pore size ~0.0001 µm). Rejects hydrated ions (Na⁺, Pb²⁺, SO₄²⁻) via size exclusion and dielectric repulsion.",
    color: "from-blue-500 to-blue-700"
  },
  {
    title: "Activated Carbon Filtration (ACF)",
    desc: "Uses highly porous carbon with massive surface area to trap impurities. Highly effective at removing chlorine, VOCs, pesticides, and odors. Often used as a pre/post-filter.",
    chemistry: "1. Physical Adsorption: Non-polar organics trapped in micropores via Van der Waals forces.\n2. Chemisorption (Chlorine): Catalytic reduction at the carbon surface (C* + HOCl → C*O + H⁺ + Cl⁻).",
    color: "from-slate-600 to-slate-800"
  },
  {
    title: "Ultraviolet (UV) Disinfection",
    desc: "A chemical-free process that inactivates biological pathogens (bacteria, viruses, protozoa). Requires clear water (low turbidity) so particles don't 'shadow' the microbes.",
    chemistry: "Photochemical Damage: UV-C photons (254 nm) penetrate cells and are absorbed by nucleic acids. Causes adjacent thymine bases in DNA to bond (pyrimidine dimers), preventing replication.",
    color: "from-purple-500 to-purple-700"
  },
  {
    title: "Chlorination",
    desc: "The standard municipal method of adding chlorine to kill pathogenic microorganisms. It provides residual protection, ensuring water remains safe as it travels through extensive distribution pipes.",
    chemistry: "Oxidation. Cl₂ or NaOCl reacts with water to form Hypochlorous acid (HOCl): Cl₂ + H₂O ⇌ HOCl + H⁺ + Cl⁻. HOCl rapidly oxidizes microbial cell structures.",
    color: "from-teal-500 to-teal-700"
  },
  {
    title: "Ion Exchange (Deionization & Softening)",
    desc: "Removes specific dissolved ions by exchanging them for less harmful ones. Cation resins remove hardness (Ca, Mg) and heavy metals. Anion resins remove nitrates, sulfates, and fluoride.",
    chemistry: "1. Cation Exchange: R⁻-Na⁺ + M²⁺ ⇌ R⁻-M²⁺ + 2Na⁺ (Removes cations: Ca²⁺, Mg²⁺, Pb²⁺).\n2. Anion Exchange: R⁺-Cl⁻ + A⁻ ⇌ R⁺-A⁻ + Cl⁻ (Removes anions: NO₃⁻, SO₄²⁻, F⁻).\n*R = insoluble polymeric resin.",
    color: "from-amber-500 to-amber-700"
  },
  {
    title: "Boiling",
    desc: "A highly reliable household method for biological purification. Bringing water to a rolling boil for 1-3 minutes effectively kills pathogens, though it concentrates heavy metals if present.",
    chemistry: "Thermal denaturation of pathogenic proteins. Also precipitates temporary hardness: Ca(HCO₃)₂ + Heat → CaCO₃↓ + H₂O + CO₂↑.",
    color: "from-rose-500 to-rose-700"
  },
  {
    title: "Coagulation & Flocculation",
    desc: "Chemicals with a positive charge are added to the water. They bind with negatively charged particles/dirt to form larger particles (floc) which then settle to the bottom for easy removal.",
    chemistry: "Charge neutralization. Coagulants like Alum (Al₂(SO₄)₃) release Al³⁺ ions that neutralize negatively charged colloids, forming a gelatinous Al(OH)₃ sweep floc.",
    color: "from-indigo-500 to-indigo-700"
  },
  {
    title: "Sediment Filtration",
    desc: "A physical barrier that catches large particles like sand, rust, and silt. It protects subsequent, finer filters and sensitive treatment appliances from premature clogging and damage.",
    chemistry: "Primarily mechanical straining (particle size > pore size) coupled with weak electrostatic adsorption to the filter media surface.",
    color: "from-orange-500 to-orange-700"
  }
];

const FULL_PARAM_NAMES: Record<string, string> = {
  "pH": "pH", "TDS": "Total Dissolved Solids", "Turbidity": "Turbidity", "Alkalinity": "Total Alkalinity",
  "EC": "Electrical conductivity", "Cl-1": "Chloride", "SO4-2": "Sulphate",
  "NO3-1": "Nitrate", "F": "Fluoride", "Ca+2": "Calcium", "Mg+2": "Magnesium",
  "TH": "Total Hardness", "Cr": "Chromium", "Mn": "Manganese", "Fe": "Iron",
  "Ni": "Nickel", "Cu": "Copper", "Zn": "Zinc", "As": "Arsenic", "Se": "Selenium",
  "Cd": "Cadmium", "Pb": "Lead", "U": "Uranium"
};

const CGWB_LABS: Record<string, string> = {
  "Uttar Pradesh": "Northern Region, Lucknow",
  "Uttarakhand": "Uttarakhand Region, Dehradun",
  "Madhya Pradesh": "North Central Region, Bhopal",
  "Chhattisgarh": "North Central Chhattisgarh Region, Raipur",
  "Rajasthan": "Western Region, Jaipur",
  "Gujarat": "West Central Region, Ahmedabad",
  "Maharashtra": "Central Region, Nagpur",
  "Andhra Pradesh": "Southern Region, Hyderabad",
  "Telangana": "Southern Region, Hyderabad",
  "Karnataka": "South Western Region, Bangalore",
  "Tamil Nadu": "South Eastern Coastal Region, Chennai",
  "Kerala": "Kerala Region, Trivandrum",
  "West Bengal": "Eastern Region, Kolkata",
  "Odisha": "South Eastern Region, Bhubaneswar",
  "Bihar": "Mid Eastern Region, Patna",
  "Jharkhand": "Mid Eastern Region, Patna",
  "Assam": "North Eastern Region, Guwahati",
  "Arunachal Pradesh": "North Eastern Region, Guwahati",
  "Meghalaya": "North Eastern Region, Guwahati",
  "Nagaland": "North Eastern Region, Guwahati",
  "Manipur": "North Eastern Region, Guwahati",
  "Mizoram": "North Eastern Region, Guwahati",
  "Tripura": "North Eastern Region, Guwahati",
  "Sikkim": "Eastern Region, Kolkata",
  "Haryana": "North Western Region, Chandigarh",
  "Punjab": "North Western Region, Chandigarh",
  "Himachal Pradesh": "Northern Himalayan Region, Dharamshala",
  "Jammu & Kashmir": "North Western Himalayan Region, Jammu",
  "Ladakh": "North Western Himalayan Region, Jammu",
  "Goa": "South Western Region, Bangalore",
  "Delhi": "State Unit Office, New Delhi",
  "Chandigarh": "North Western Region, Chandigarh",
  "Puducherry": "South Eastern Coastal Region, Chennai",
  "Andaman & Nicobar": "Eastern Region, Kolkata",
  "Andaman and Nicobar": "Eastern Region, Kolkata"
};

const getFullParamNames = (paramsList: string[]) => {
  return paramsList.map(p => FULL_PARAM_NAMES[p] || p).join(', ');
};

const guessMapping = (expected: string, available: string[]) => {
  const clean = (str: string) => String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
  const eClean = clean(expected);
  
  // Exact clean match
  const exact = available.find(a => clean(a) === eClean);
  if (exact) return exact;
  
  // Contains or is contained by
  const partial = available.find(a => {
    const aClean = clean(a);
    return aClean.length > 3 && eClean.length > 3 && (aClean.includes(eClean) || eClean.includes(aClean));
  });
  if (partial) return partial;
  
  return "";
};

const FormatParam: React.FC<{ param: string }> = ({ param }) => {
  const map: Record<string, React.ReactNode> = {
    "Cl-1": <><span className="text-sm font-bold">Cl</span><sup className="text-[10px] font-bold">-</sup></>,
    "SO4-2": <><span className="text-sm font-bold">SO</span><sub className="text-[10px] font-bold">4</sub><sup className="text-[10px] font-bold">2-</sup></>,
    "NO3-1": <><span className="text-sm font-bold">NO</span><sub className="text-[10px] font-bold">3</sub><sup className="text-[10px] font-bold">-</sup></>,
    "Ca+2": <><span className="text-sm font-bold">Ca</span><sup className="text-[10px] font-bold">2+</sup></>,
    "Mg+2": <><span className="text-sm font-bold">Mg</span><sup className="text-[10px] font-bold">2+</sup></>,
    "F": <><span className="text-sm font-bold">F</span><sup className="text-[10px] font-bold">-</sup></>
  };
  return map[param] || <span className="text-sm font-bold">{param}</span>;
};

interface SimpleReportTableProps {
  data: any[];
  isDistrict: boolean;
  manualTotals: Record<string, number | "">;
  onManualTotalChange: (key: string, value: string) => void;
  contaminationFont?: 'times' | 'calibri' | 'sans' | 'mono';
}

const SimpleReportTable: React.FC<SimpleReportTableProps> = ({ data, isDistrict, manualTotals, onManualTotalChange, contaminationFont = 'times' }) => {
  const sumTotalAnalysed = data.reduce((sum, row) => sum + (manualTotals[row.key] !== undefined && manualTotals[row.key] !== '' ? parseInt(manualTotals[row.key] as string) || 0 : row.total), 0);
  const sumMarginal = data.reduce((sum, row) => sum + row.marginal, 0);
  const sumUnsafe = data.reduce((sum, row) => sum + row.unsafe, 0);
  const sumContaminated = sumMarginal + sumUnsafe;

  return (
    <div className="w-full overflow-x-auto custom-scrollbar mb-6">
      <table className="border-collapse border border-black text-[13px] text-center bg-white mx-auto" style={{ width: 'auto', maxWidth: '100%', tableLayout: 'auto' }}>
        <thead>
        <tr>
          <th rowSpan={2} className="border border-black p-1.5 font-bold text-center" style={{ width: 'auto', whiteSpace: 'nowrap' }}>Sl. No.</th>
          <th rowSpan={2} className="border border-black p-1.5 font-bold text-left" style={{ width: 'auto', whiteSpace: 'nowrap' }}>Name of {isDistrict ? 'District' : 'State/Union Territory'}</th>
          <th rowSpan={2} className="border border-black p-1.5 font-bold text-center" style={{ width: 'auto' }}>Total no.<br/>of samples<br/>analysed</th>
          <th colSpan={3} className="border border-black p-1.5 font-bold text-center" style={{ width: 'auto' }}>No. of samples contaminated</th>
          <th rowSpan={2} className="border border-black p-1.5 font-bold text-left uppercase tracking-wider" style={{ width: 'auto' }}>Parameters of contamination</th>
        </tr>
        <tr>
          <th className="border border-black p-1.5 font-bold text-center" style={{ width: 'auto' }}>Above<br/>Acceptable<br/>Limit</th>
          <th className="border border-black p-1.5 font-bold text-center" style={{ width: 'auto' }}>Above<br/>Permissible<br/>Limit</th>
          <th className="border border-black p-1.5 font-bold text-center" style={{ width: 'auto' }}>Total samples<br/>Contaminated</th>
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr>
            <td colSpan={7} className="border border-black p-3 text-center italic">No data available</td>
          </tr>
        ) : (
          data.map((row, idx) => {
            const totalContaminated = row.marginal + row.unsafe;
            const allParams = Array.from(new Set([...row.unsafeList, ...row.marginalList])) as string[];
            const paramString = getFullParamNames(allParams);
            
            return (
              <tr key={row.key || idx}>
                <td className="border border-black p-1.5 text-center font-medium" style={{ whiteSpace: 'nowrap' }}>{idx + 1}</td>
                <td className="border border-black p-1.5 text-left font-bold" style={{ whiteSpace: 'nowrap' }}>{isDistrict ? row.district : row.state}</td>
                <td className="border border-black p-1.5 font-bold text-center" style={{ whiteSpace: 'nowrap' }}>
                  <input 
                    type="number" 
                    min="0"
                    value={manualTotals[row.key] !== undefined ? manualTotals[row.key] : row.total}
                    onChange={(e) => onManualTotalChange(row.key, e.target.value)}
                    className="w-full max-w-[50px] text-center bg-transparent border-b border-dashed border-gray-400 outline-none no-print"
                  />
                  <span className="print-only hidden">{manualTotals[row.key] !== undefined ? manualTotals[row.key] : row.total}</span>
                </td>
                <td className="border border-black p-1.5 font-bold text-center" style={{ whiteSpace: 'nowrap' }}>{row.marginal || 'Nil'}</td>
                <td className="border border-black p-1.5 font-bold text-center" style={{ whiteSpace: 'nowrap' }}>{row.unsafe || 'Nil'}</td>
                <td className="border border-black p-1.5 font-bold text-center" style={{ whiteSpace: 'nowrap' }}>{totalContaminated || 'Nil'}</td>
                <td 
                  className="border border-black p-1.5 text-left text-[12px] leading-snug antialiased subpixel-antialiased font-semibold text-slate-900"
                  style={{
                    fontFamily: 
                      contaminationFont === 'times' ? "'Times New Roman', Times, serif" :
                      contaminationFont === 'calibri' ? "Calibri, Candara, Segoe, 'Segoe UI', Optima, Arial, sans-serif" :
                      contaminationFont === 'mono' ? "'JetBrains Mono', monospace" : "Inter, system-ui, sans-serif",
                    textRendering: "optimizeLegibility",
                    WebkitFontSmoothing: "antialiased",
                    MozOsxFontSmoothing: "grayscale"
                  }}
                >
                  {paramString || "Nil"}
                </td>
              </tr>
            );
          })
        )}
        {data.length > 0 && (
          <tr className="font-bold">
            <td colSpan={2} className="border border-black p-1.5 font-bold text-right uppercase">Total</td>
            <td className="border border-black p-1.5 font-bold text-center">{sumTotalAnalysed}</td>
            <td className="border border-black p-1.5 font-bold text-center">{sumMarginal || 'Nil'}</td>
            <td className="border border-black p-1.5 font-bold text-center">{sumUnsafe || 'Nil'}</td>
            <td className="border border-black p-1.5 font-bold text-center">{sumContaminated || 'Nil'}</td>
            <td className="border border-black p-1.5"></td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
  );
};

interface SummaryTableProps {
  data: any[];
  isDistrict: boolean;
  manualTotals: Record<string, number | "">;
  onManualTotalChange: (key: string, value: string) => void;
  contaminationFont?: 'times' | 'calibri' | 'sans' | 'mono';
}

const SummaryTable: React.FC<SummaryTableProps> = ({ data, isDistrict, manualTotals, onManualTotalChange, contaminationFont = 'times' }) => {
  const sumTotalAnalysed = data.reduce((sum, row) => sum + (manualTotals[row.key] !== undefined && manualTotals[row.key] !== '' ? parseInt(manualTotals[row.key] as string) || 0 : row.total), 0);
  const sumMarginal = data.reduce((sum, row) => sum + row.marginal, 0);
  const sumUnsafe = data.reduce((sum, row) => sum + row.unsafe, 0);
  const sumContaminated = sumMarginal + sumUnsafe;

  return (
    <div className="overflow-x-auto p-4 custom-scrollbar bg-slate-50">
      <table className="w-full text-center border-separate border-spacing-0 shadow-[0_8px_30px_rgb(0,0,0,0.15)] rounded-xl overflow-hidden bg-white ring-1 ring-gray-200">
        <thead>
          <tr className="bg-gradient-to-b from-indigo-800 to-blue-900 text-white shadow-[inset_0_2px_4px_rgba(255,255,255,0.3)]">
            <th rowSpan={2} className="p-3 border-b-2 border-r border-blue-950 font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">Sl. No.</th>
            <th rowSpan={2} className="p-3 border-b-2 border-r border-blue-950 text-left font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">Name of {isDistrict ? 'District' : 'State/Union Territory'}</th>
            <th rowSpan={2} className="p-3 border-b-2 border-r border-blue-950 font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] w-28">Total no. of samples analysed</th>
            <th colSpan={3} className="p-3 border-b border-r border-blue-950 font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] bg-gradient-to-b from-indigo-700 to-blue-800 tracking-wider text-lg">No. of samples contaminated</th>
            <th rowSpan={2} className="p-3 border-b-2 border-blue-950 text-left font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] w-1/3">Parameters of contamination</th>
          </tr>
          <tr className="text-white">
            <th className="p-2 border-b-2 border-r border-blue-950 text-xs w-32 bg-gradient-to-b from-orange-500 to-orange-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] font-bold">Above Acceptable Limit</th>
            <th className="p-2 border-b-2 border-r border-blue-950 text-xs w-32 bg-gradient-to-b from-red-600 to-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] font-bold">Above Permissible Limit</th>
            <th className="p-2 border-b-2 border-r border-blue-950 text-xs w-32 bg-gradient-to-b from-purple-600 to-purple-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] font-bold">Total samples Contaminated</th>
          </tr>
        </thead>
        <tbody className="bg-slate-50">
          {data.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-20 text-center text-gray-500 font-bold bg-white border-b border-gray-300">
                No compliance dataset is loaded or mapped yet. Use data inputs above to check.
              </td>
            </tr>
          ) : (
            data.map((row, idx) => {
              const totalContaminated = row.marginal + row.unsafe;
              return (
                <tr key={row.key || idx} className="hover:bg-white hover:scale-[1.005] hover:shadow-[0_0_20px_rgba(0,0,0,0.15)] transition-all duration-200 z-10 relative">
                  <td className="p-3 border-b border-r border-gray-300 font-bold text-gray-700 bg-gray-100/50 shadow-[inset_1px_1px_0_rgba(255,255,255,1)]">{idx + 1}</td>
                  <td className="p-3 border-b border-r border-gray-300 text-left font-extrabold text-gray-800 bg-white shadow-[inset_1px_1px_0_rgba(255,255,255,1)]">
                    <div className="flex flex-col gap-1 items-start">
                      <span className="drop-shadow-sm text-[15px]">{isDistrict ? row.district : row.state}</span>
                      {row.hasHeavyMetals && (
                        <span className="px-2 py-0.5 bg-gradient-to-b from-red-500 to-red-600 text-white text-[9px] font-black rounded border border-red-700 shadow-sm uppercase tracking-widest">
                          Heavy Metals
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 border-b border-r border-gray-300 font-black text-blue-900 bg-blue-50/50 text-lg shadow-[inset_1px_1px_0_rgba(255,255,255,1)]">
                    <input 
                       type="number" 
                      min="0"
                      value={manualTotals[row.key] !== undefined ? manualTotals[row.key] : row.total}
                      onChange={(e) => onManualTotalChange(row.key, e.target.value)}
                      className="w-full max-w-[80px] text-center bg-white/80 border border-blue-300 focus:border-blue-600 rounded px-1 py-1 outline-none font-bold transition-colors no-print"
                      title="Manually edit the Total Analyzed"
                    />
                    <span className="print-only hidden text-lg">{manualTotals[row.key] !== undefined ? manualTotals[row.key] : row.total}</span>
                  </td>
                  <td className="p-3 border-b border-r border-gray-300 font-black text-orange-700 bg-orange-50/50 text-lg shadow-[inset_1px_1px_0_rgba(255,255,255,1)]">{row.marginal}</td>
                  <td className="p-3 border-b border-r border-gray-300 font-black text-red-700 bg-red-50/50 text-lg shadow-[inset_1px_1px_0_rgba(255,255,255,1)]">{row.unsafe}</td>
                  <td className="p-3 border-b border-r border-gray-300 font-black text-purple-800 bg-purple-50/50 text-lg shadow-[inset_1px_1px_0_rgba(255,255,255,1)]">{totalContaminated}</td>
                  <td 
                    className="p-3 border-b border-gray-300 text-left bg-white shadow-[inset_1px_1px_0_rgba(255,255,255,1)]"
                    style={{
                      fontFamily: 
                        contaminationFont === 'times' ? "'Times New Roman', Times, serif" :
                        contaminationFont === 'calibri' ? "Calibri, Candara, Segoe, 'Segoe UI', Optima, Arial, sans-serif" :
                        contaminationFont === 'mono' ? "'JetBrains Mono', monospace" : "Inter, system-ui, sans-serif",
                    }}
                  >
                    <div className="flex flex-wrap gap-2">
                      {row.unsafeList.map((p: string) => (
                        <span key={p} className="pl-2 pr-1 py-1 bg-gradient-to-b from-red-50 to-red-100 border border-red-300 text-red-900 rounded shadow-[0_2px_4px_rgba(0,0,0,0.05)] flex items-center gap-1.5 transform hover:-translate-y-0.5 transition-transform font-bold">
                          <FormatParam param={p} />
                          <span className="bg-red-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] text-white text-[9px] font-black px-1.5 py-0.5 rounded uppercase">Permissible</span>
                        </span>
                      ))}
                      {row.marginalList.map((p: string) => (
                        <span key={p} className="pl-2 pr-1 py-1 bg-gradient-to-b from-orange-50 to-orange-100 border border-orange-300 text-orange-900 rounded shadow-[0_2px_4px_rgba(0,0,0,0.05)] flex items-center gap-1.5 transform hover:-translate-y-0.5 transition-transform font-bold">
                          <FormatParam param={p} />
                          <span className="bg-orange-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] text-white text-[9px] font-black px-1.5 py-0.5 rounded uppercase">Acceptable</span>
                        </span>
                      ))}
                      {row.unsafeList.length === 0 && row.marginalList.length === 0 && (
                        <span className="text-emerald-600 font-bold text-sm flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded border border-emerald-200 shadow-sm">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                          No Contamination
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
          
          {/* TOTAL ROW */}
          {data.length > 0 && (
            <tr className="bg-gradient-to-b from-indigo-800 to-blue-900 text-white shadow-[inset_0_2px_4px_rgba(255,255,255,0.3)] z-20 relative font-bold">
              <td colSpan={2} className="p-3 border-t-2 border-r border-blue-950 font-extrabold text-right uppercase tracking-wider text-[15px]">Total</td>
              <td className="p-3 border-t-2 border-r border-blue-950 font-black text-lg">{sumTotalAnalysed}</td>
              <td className="p-3 border-t-2 border-r border-blue-950 font-black text-orange-400 text-lg">{sumMarginal}</td>
              <td className="p-3 border-t-2 border-r border-blue-950 font-black text-red-400 text-lg">{sumUnsafe}</td>
              <td className="p-3 border-t-2 border-r border-blue-950 font-black text-purple-300 text-lg">{sumContaminated}</td>
              <td className="p-3 border-t-2 border-blue-950"></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const MapContainer: React.FC<{ data: any[]; limits: any; geoJsonData: any }> = ({ data, limits, geoJsonData }) => {
  const mapRef = useRef<any>(null);
  const markersLayer = useRef<any>(null);
  const geoJsonLayerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const L = (window as any).L;
    if (!L) return;

    if (!mapRef.current) {
      mapRef.current = L.map('fortnightly-leaflet-map', { preferCanvas: true }).setView([20.5937, 78.9629], 5);
      
      const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      });

      const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
      });

      const topoLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
      });

      const terrainLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
      });

      const lightCanvasLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
      });

      const darkCanvasLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
      });

      osmLayer.addTo(mapRef.current);

      const baseMaps = {
        "OpenStreetMap": osmLayer,
        "Satellite (Esri)": satelliteLayer,
        "Topographic": topoLayer,
        "Terrain (Esri)": terrainLayer,
        "Light Canvas": lightCanvasLayer,
        "Dark Canvas": darkCanvasLayer
      };

      L.control.layers(baseMaps, null, { position: 'topright' }).addTo(mapRef.current);
      
      geoJsonLayerRef.current = L.layerGroup().addTo(mapRef.current);
      markersLayer.current = L.layerGroup().addTo(mapRef.current);
    }

    markersLayer.current.clearLayers();

    if (data.length > 0) {
      const bounds: any[] = [];
      data.forEach(row => {
        const lat = parseFloat(row.Latitude);
        const lng = parseFloat(row.Longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        let overallStatus = 'safe';
        let paramsHtml = '';
        let contaminatedParamsCount = 0;

        Object.keys(limits).forEach(param => {
          if (row[param] !== undefined && row[param] !== null && row[param] !== '') {
            const val = parseFloat(row[param]);
            let paramStatus = 'safe';
            let paramColor = '#10b981';
            
            if (!isNaN(val)) {
              const limit = limits[param];
              if (limit.isStrictRange) {
                if (val < limit.acc || val > limit.perm) { 
                  paramStatus = 'unsafe'; 
                  paramColor = '#ef4444';
                  overallStatus = 'unsafe';
                }
              } else {
                if (val > limit.perm) { 
                  paramStatus = 'unsafe'; 
                  paramColor = '#ef4444';
                  overallStatus = 'unsafe';
                } else if (val > limit.acc) { 
                  paramStatus = 'marginal'; 
                  paramColor = '#f97316';
                  if (overallStatus !== 'unsafe') overallStatus = 'marginal';
                }
              }

              if (paramStatus !== 'safe') {
                contaminatedParamsCount++;
              }
            }

            paramsHtml += `
              <div class="flex justify-between items-center border-b border-gray-100 py-1.5 last:border-0">
                <span class="font-medium text-gray-600 text-xs w-2/3 pr-2 truncate" title="${param}">${param}</span>
                <span class="text-xs text-right w-1/3" style="color: ${paramColor}; font-weight: ${paramStatus !== 'safe' ? '900' : '500'}">
                  ${row[param]}
                </span>
              </div>
            `;
          }
        });

        const markerColor = overallStatus === 'unsafe' ? '#ef4444' : overallStatus === 'marginal' ? '#f97316' : '#10b981';
        const labelBg = overallStatus === 'unsafe' ? 'bg-red-500' : overallStatus === 'marginal' ? 'bg-orange-500' : 'bg-emerald-500';
        
        let contaminationTypeLabel = 'No Contamination';
        let contaminationTypeColor = 'text-emerald-600';
        if (contaminatedParamsCount === 1) {
          contaminationTypeLabel = 'Single-Parameter Contamination';
          contaminationTypeColor = 'text-orange-600';
        } else if (contaminatedParamsCount > 1) {
          contaminationTypeLabel = 'Multi-Parameter Contamination';
          contaminationTypeColor = 'text-red-600';
        }

        const marker = L.circleMarker([lat, lng], {
          radius: 8,
          fillColor: markerColor,
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9
        });

        const popupContent = `
          <div class="p-4 w-full font-sans">
            <h3 class="text-lg font-bold text-gray-800 leading-tight">${row['Village/Town'] || 'Unknown Location'}</h3>
            <p class="text-[11px] text-gray-500 mt-1 uppercase tracking-wide">
              ${[row['Block'], row['District'], row['State']].filter(Boolean).join(', ')}
            </p>
            
            <div class="mt-3 mb-4 flex flex-col gap-1.5">
              <div>
                <span class="px-2 py-1 text-[10px] font-bold rounded text-white ${labelBg}">
                  OVERALL STATUS: ${overallStatus.toUpperCase()}
                </span>
              </div>
              <div class="text-[11px] font-bold ${contaminationTypeColor}">
                ${contaminationTypeLabel}
              </div>
            </div>
            
            <div class="text-[11px] text-gray-600 mb-3 bg-gray-50 p-2 rounded border border-gray-100">
              <div class="mb-1"><b>Structure:</b> ${row['Sample Collection Structure'] || 'N/A'}</div>
              <div class="mb-1"><b>Depth:</b> ${row['Depth of the Structure from Ground Level in Meters'] ? row['Depth of the Structure from Ground Level in Meters'] + ' m' : 'N/A'}</div>
              <div><b>Date Collected:</b> ${row['Sample Collection Date'] || 'N/A'}</div>
            </div>
            
            <h4 class="text-xs font-bold text-gray-800 border-b pb-1 mb-2">Detailed Parameters:</h4>
            <div class="max-h-48 overflow-y-auto custom-scrollbar pr-1 bg-white">
              ${paramsHtml || '<div class="text-gray-400 italic text-xs py-2">No parameter data available</div>'}
            </div>
          </div>
        `;

        marker.bindPopup(popupContent);
        markersLayer.current.addLayer(marker);
        bounds.push([lat, lng]);
      });

      if (bounds.length > 0) {
        mapRef.current.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [data, limits]);

  useEffect(() => {
    const L = (window as any).L;
    if (mapRef.current && geoJsonLayerRef.current && L) {
      geoJsonLayerRef.current.clearLayers();
      if (geoJsonData) {
        const layer = L.geoJSON(geoJsonData, {
          style: {
            color: '#3b82f6',
            weight: 2,
            fillOpacity: 0.1,
            opacity: 0.8
          },
          onEachFeature: (feature: any, layer: any) => {
            if (feature.properties) {
              let propsHtml = '<h4 class="font-bold text-sm mb-2 border-b pb-1 text-blue-800">Boundary Properties</h4>';
              propsHtml += '<div class="max-h-32 overflow-y-auto custom-scrollbar text-xs">';
              Object.entries(feature.properties).forEach(([k, v]) => {
                propsHtml += `<div class="mb-1"><b>${k}:</b> ${v}</div>`;
              });
              propsHtml += '</div>';
              layer.bindPopup(`<div class="p-2 w-48 font-sans">${propsHtml}</div>`);
            }
          }
        });
        geoJsonLayerRef.current.addLayer(layer);
        mapRef.current.fitBounds(layer.getBounds());
      }
    }
  }, [geoJsonData]);

  return <div id="fortnightly-leaflet-map" className="h-[600px] w-full rounded-xl z-10 shadow-inner border border-gray-200"></div>;
};

const FortnightlyAlertsView: React.FC<FortnightlyAlertsViewProps> = ({
  rawData: globalRawData,
  headers: globalHeaders,
  headerMap: globalHeaderMap,
  selectedState: globalSelectedState
}) => {
  const [internalRawData, setInternalRawData] = useState<any[]>([]);
  const [limits, setLimits] = useState<Record<string, { acc: number; perm: number; isStrictRange?: boolean }>>(DEFAULT_LIMITS);
  const [activeSubTab, setActiveSubTab] = useState('report');
  
  // Interactive Pamphlet Customization States
  const [themeColor, setThemeColor] = useState<'navy' | 'green' | 'crimson' | 'charcoal'>('navy');
  const [layoutStyle, setLayoutStyle] = useState<'standard' | 'pamphlet'>('pamphlet');
  const [riskLevel, setRiskLevel] = useState<'high' | 'medium' | 'low'>('high');
  const [customRemarks, setCustomRemarks] = useState<string>("");
  const [customTitle, setCustomTitle] = useState<string>("Ground Water Quality Alert");
  const [showLogo, setShowLogo] = useState<boolean>(true);
  const [contaminationFont, setContaminationFont] = useState<'times' | 'calibri' | 'sans' | 'mono'>('times');

  const [geoJsonData, setGeoJsonData] = useState<any>(null);
  const [uploadError, setUploadError] = useState('');

  // Mapping states
  const [uploadingFile, setUploadingFile] = useState<any>(null);
  const [uploadedColumns, setUploadedColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [showMappingModal, setShowMappingModal] = useState(false);

  // Document Config
  const [fromDate, setFromDate] = useState(new Date(new Date().setDate(new Date().getDate() - 14)).toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [manualTotals, setManualTotals] = useState<Record<string, number | "">>({});

  // Standardize loaded data
  const processedRawData = useMemo(() => {
    // If user has uploaded specific internal data, use it
    if (internalRawData.length > 0) {
      return internalRawData;
    }

    // Otherwise, convert global raw data to standard format
    if (!globalRawData || globalRawData.length === 0) {
      return [];
    }

    return globalRawData.map(row => {
      const stdRow: any = { ...row };
      
      // Resolve standard columns
      stdRow["State"] = row[globalHeaders.state] || row["State"] || "";
      stdRow["District"] = row[globalHeaders.district] || row["District"] || "";
      stdRow["Block"] = row[globalHeaders.block] || row["Block"] || "";
      stdRow["Village/Town"] = row[globalHeaders.location] || row["Village/Town"] || row["Village"] || row["Location"] || "";
      stdRow["Latitude"] = parseFloat(row[globalHeaders.latitude] || row["Latitude"]);
      stdRow["Longitude"] = parseFloat(row[globalHeaders.longitude] || row["Longitude"]);
      
      stdRow["Sample Collection Structure"] = row["Sample Collection Structure"] || row["Structure"] || "Tubewell";
      stdRow["Depth of the Structure from Ground Level in Meters"] = row["Depth of the Structure from Ground Level in Meters"] || row["Depth"] || "";
      stdRow["Sample Collection Date"] = row["Sample Collection Date"] || row["Collection Date"] || "";
      stdRow["Sample Analysis Date"] = row["Sample Analysis Date"] || row["Analysis Date"] || "";

      // Map parameter values from global config keys
      const paramMapping: Record<string, string> = {
        "pH": "pH",
        "EC (µS/cm at 25 C)": "EC",
        "Cl-1 (mg/L)": "Cl",
        "SO4-2 (mg/L)": "SO4",
        "NO3-1 (mg/L)": "NO3",
        "F": "F",
        "Ca+2 (mg/L)": "Ca",
        "Mg+2 (mg/L)": "Mg",
        "TH *as CaCO3 (mg/L)": "TH",
        "Cr (mg/L)": "Cr",
        "Mn (mg/L)": "Mn",
        "Fe (mg/L)": "Fe",
        "Ni (mg/L)": "Ni",
        "Cu (mg/L)": "Cu",
        "Zn (mg/L)": "Zn",
        "As (µg/L)": "As",
        "Se (µg/L)": "Se",
        "Cd (µg/L)": "Cd",
        "Pb (µg/L)": "Pb",
        "U (µg/L)": "U"
      };

      Object.entries(paramMapping).forEach(([stdHeader, configKey]) => {
        const fileCol = Object.keys(globalHeaderMap).find(k => globalHeaderMap[k] === configKey);
        if (fileCol && row[fileCol] !== undefined) {
          stdRow[stdHeader] = row[fileCol];
        } else if (row[configKey] !== undefined) {
          stdRow[stdHeader] = row[configKey];
        } else {
          const fallbackCol = Object.keys(row).find(k => k.toLowerCase() === stdHeader.toLowerCase() || k.toLowerCase() === configKey.toLowerCase());
          if (fallbackCol) {
            stdRow[stdHeader] = row[fallbackCol];
          }
        }
      });

      return stdRow;
    });
  }, [globalRawData, internalRawData, globalHeaders, globalHeaderMap]);

  const handleManualTotalChange = (key: string, value: string) => {
    setManualTotals(prev => ({
      ...prev,
      [key]: value === '' ? '' : parseInt(value, 10)
    }));
  };

  const { summaryData, districtSummaryData } = useMemo(() => {
    if (!processedRawData || processedRawData.length === 0) return { summaryData: [], districtSummaryData: [] };
    
    const sSummary: Record<string, any> = {};
    const dSummary: Record<string, any> = {};
    const limitEntries = Object.entries(limits) as [string, { acc: number; perm: number; isStrictRange?: boolean }][];

    for (let i = 0; i < processedRawData.length; i++) {
      const row = processedRawData[i];
      const state = row["State"] || "Unknown";
      const district = row["District"];
      
      if (!sSummary[state]) {
        sSummary[state] = { state, total: 0, safe: 0, marginal: 0, unsafe: 0, marginalParams: new Set<string>(), unsafeParams: new Set<string>() };
      }
      sSummary[state].total++;

      let dKey = null;
      if (district) {
        dKey = `${state}-${district}`;
        if (!dSummary[dKey]) {
          dSummary[dKey] = { state, district, total: 0, safe: 0, marginal: 0, unsafe: 0, marginalParams: new Set<string>(), unsafeParams: new Set<string>() };
        }
        dSummary[dKey].total++;
      }

      let rowIsUnsafe = false;
      let rowIsMarginal = false;

      for (let j = 0; j < limitEntries.length; j++) {
        const [param, limit] = limitEntries[j];
        const valStr = row[param];
        
        if (valStr == null || valStr === '') continue;
        
        const val = parseFloat(valStr);
        if (isNaN(val)) continue;

        const shortName = param.split(' ')[0];

        if (limit.isStrictRange) {
          if (val < limit.acc || val > limit.perm) {
            rowIsUnsafe = true;
            sSummary[state].unsafeParams.add(shortName);
            if (dKey) dSummary[dKey].unsafeParams.add(shortName);
          }
        } else {
          if (val > limit.perm) {
            rowIsUnsafe = true;
            sSummary[state].unsafeParams.add(shortName);
            if (dKey) dSummary[dKey].unsafeParams.add(shortName);
          } else if (val > limit.acc) {
            rowIsMarginal = true;
            sSummary[state].marginalParams.add(shortName);
            if (dKey) dSummary[dKey].marginalParams.add(shortName);
          }
        }
      }

      if (rowIsUnsafe) {
        sSummary[state].unsafe++;
        if (dKey) dSummary[dKey].unsafe++;
      } else if (rowIsMarginal) {
        sSummary[state].marginal++;
        if (dKey) dSummary[dKey].marginal++;
      } else {
        sSummary[state].safe++;
        if (dKey) dSummary[dKey].safe++;
      }
    }

    const formatSummary = (summaryObj: Record<string, any>, sortFn: (a: any, b: any) => number) => 
      Object.values(summaryObj).map(s => {
        const combined = new Set([...Array.from(s.unsafeParams as Set<string>), ...Array.from(s.marginalParams as Set<string>)]);
        let hasHeavyMetals = false;
        for (const p of Array.from(combined)) {
          if (HEAVY_METALS.includes(p)) {
            hasHeavyMetals = true;
            break;
          }
        }
        return {
          ...s,
          key: s.district ? `${s.state}-${s.district}` : s.state,
          combinedCount: combined.size,
          hasHeavyMetals,
          unsafeList: Array.from(s.unsafeParams as Set<string>).sort(),
          marginalList: Array.from(s.marginalParams as Set<string>).filter(p => !s.unsafeParams.has(p)).sort()
        };
      }).sort(sortFn);

    return {
      summaryData: formatSummary(sSummary, (a, b) => a.state.localeCompare(b.state)),
      districtSummaryData: formatSummary(dSummary, (a, b) => a.state.localeCompare(b.state) || a.district.localeCompare(b.district))
    };
  }, [processedRawData, limits]);

  const isSingleState = summaryData.length === 1;
  const reportLocation = isSingleState ? summaryData[0].state : 'All India';
  const reportTableData = isSingleState ? districtSummaryData : summaryData;

  const activeContaminatedParams = useMemo(() => {
    const params = new Set<string>();
    reportTableData.forEach(row => {
      row.unsafeList.forEach((p: string) => params.add(p));
      row.marginalList.forEach((p: string) => params.add(p));
    });
    return Array.from(params);
  }, [reportTableData]);

  const activeRemedialMeasures = REMEDIAL_MEASURES.filter(m => activeContaminatedParams.includes(m.id));

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        
        if (data.length === 0) {
          setUploadError("The uploaded file appears to be empty.");
          return;
        }

        const headers = Object.keys(data[0]);
        setUploadedColumns(headers);

        const initialMapping: Record<string, string> = {};
        COLUMNS.forEach(col => {
          initialMapping[col] = guessMapping(col, headers);
        });
        
        setColumnMapping(initialMapping);
        setUploadingFile(data);
        setShowMappingModal(true);
      } catch (err) {
        console.error("Error parsing file", err);
        setUploadError("Could not read file. Ensure it is a valid Excel or CSV.");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = ""; // reset
  };

  const applyMapping = () => {
    const mappedData = uploadingFile.map((row: any) => {
      const newRow: any = {};
      COLUMNS.forEach(col => {
        const mappedKey = columnMapping[col];
        if (mappedKey && row[mappedKey] !== undefined && row[mappedKey] !== "") {
          newRow[col] = row[mappedKey];
        } else {
          newRow[col] = "";
        }
      });
      return newRow;
    });
    
    setInternalRawData(mappedData);
    setShowMappingModal(false);
    setUploadingFile(null);
  };

  const handleShapefileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    try {
      const buffer = await file.arrayBuffer();
      const geojson = await shp(buffer);
      setGeoJsonData(geojson);
      setActiveSubTab('map');
    } catch (error) {
      console.error("Error parsing shapefile:", error);
      setUploadError("Could not parse the ZIP file. Please ensure it contains valid .shp, .shx, and .dbf files.");
      setTimeout(() => setUploadError(''), 5000);
    }
    e.target.value = "";
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Water Quality Data");
    XLSX.writeFile(wb, "Water_Quality_Template.xlsx");
  };

  const exportSummary = () => {
    if (activeSubTab === 'state') {
      if (!summaryData || summaryData.length === 0) return;
      const exportData = summaryData.map(row => ({
        "State": row.state,
        "Total Analyzed": manualTotals[row.key] !== undefined && manualTotals[row.key] !== '' ? manualTotals[row.key] : row.total,
        "Safe Locations": row.safe,
        "Marginal Locations": row.marginal,
        "Unsafe Locations": row.unsafe,
        "Unsafe Parameters": row.unsafeList.join(', '),
        "Marginal Parameters": row.marginalList.join(', '),
        "Heavy Metals Detected": row.hasHeavyMetals ? "Yes" : "No"
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "State Summary");
      XLSX.writeFile(wb, "State_Quality_Summary.xlsx");
    } else if (activeSubTab === 'district') {
      if (!districtSummaryData || districtSummaryData.length === 0) return;
      const exportData = districtSummaryData.map(row => ({
        "State": row.state,
        "District": row.district,
        "Total Analyzed": manualTotals[row.key] !== undefined && manualTotals[row.key] !== '' ? manualTotals[row.key] : row.total,
        "Safe Locations": row.safe,
        "Marginal Locations": row.marginal,
        "Unsafe Locations": row.unsafe,
        "Unsafe Parameters": row.unsafeList.join(', '),
        "Marginal Parameters": row.marginalList.join(', '),
        "Heavy Metals Detected": row.hasHeavyMetals ? "Yes" : "No"
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "District Summary");
      XLSX.writeFile(wb, "District_Quality_Summary.xlsx");
    }
  };

  const handleDownloadWord = () => {
    const element = document.querySelector('.print-container');
    if (!element) return;
    const clone = element.cloneNode(true) as HTMLElement;

    const noPrintElements = clone.querySelectorAll('.no-print');
    noPrintElements.forEach(el => el.remove());

    const printOnlyElements = clone.querySelectorAll('.print-only');
    printOnlyElements.forEach(el => {
      el.classList.remove('hidden');
      (el as HTMLElement).style.display = 'block';
    });

    const allElements = clone.querySelectorAll('*');
    allElements.forEach(el => {
      if (el.className && typeof el.className === 'string') {
        el.className = el.className.replace(/\b(w-\S+|max-w-\S+|min-w-\S+|h-\S+|max-h-\S+|min-h-\S+)\b/g, '').trim();
      }
    });

    // Ensure all tables in downloaded document are snug and content-fit without extra horizontal/vertical whitespace
    const tables = clone.querySelectorAll('table');
    tables.forEach(tbl => {
      tbl.style.width = 'auto';
      tbl.style.maxWidth = '100%';
      tbl.style.tableLayout = 'auto';
      tbl.style.marginLeft = 'auto';
      tbl.style.marginRight = 'auto';
      tbl.removeAttribute('width');
    });

    const htmlContent = `
      <html xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:w="urn:schemas-microsoft-com:office:word"
            xmlns="http://www.w3.org/TR/REC-html40">
      <head>
          <meta charset='utf-8'>
          <title>Ground Water Quality Alert</title>
          <!--[if gte mso 9]>
          <xml>
              <w:WordDocument>
                  <w:View>Print</w:View>
                  <w:Zoom>100</w:Zoom>
                  <w:DoNotOptimizeForBrowser/>
              </w:WordDocument>
          </xml>
          <![endif]-->
          <style>
              @page WordSection1 {
                  size: 8.27in 11.69in;
                  margin: 0.8in 0.8in 0.8in 0.8in;
              }
              div.WordSection1 { page: WordSection1; }
              body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11pt; }
              table { border-collapse: collapse; width: auto !important; max-width: 100% !important; margin-left: auto; margin-right: auto; margin-bottom: 16px; table-layout: auto !important; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
              th, td { border: 1px solid black; padding: 4px 6px !important; font-size: 9.5pt; text-align: center; vertical-align: middle; white-space: normal; mso-padding-alt: 4pt 6pt 4pt 6pt; }
              .text-left { text-align: left !important; }
              .font-bold { font-weight: bold; }
              .bg-gray-100 { background-color: #f3f4f6; }
              h1 { text-align: center; text-decoration: underline; font-size: 16pt; margin-bottom: 16px; color: black; }
              h3 { text-decoration: underline; font-size: 13pt; margin-bottom: 8px; color: black; font-weight: bold; }
              h4 { text-decoration: underline; font-size: 11pt; margin-bottom: 8px; color: black; font-weight: bold; }
              h5 { text-decoration: underline; font-size: 10.5pt; font-weight: bold; color: black; }
              .text-justify { text-align: justify; }
              ul { margin-top: 4px; margin-bottom: 16px; }
              li { margin-bottom: 4px; }
              p { margin-bottom: 8px; line-height: 1.4; }
          </style>
      </head>
      <body>
          <div class="WordSection1 font-sans">
              ${clone.innerHTML}
          </div>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', htmlContent], {
      type: 'application/msword'
    });
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const formattedIssueDate = issueDate.split('-').reverse().join('-');
    link.download = `GroundWaterQualityAlert_${formattedIssueDate}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.focus();
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const getIssuingOffice = () => {
    const stateName = reportLocation.trim();
    const normalizedMatch = Object.keys(CGWB_LABS).find(k => k.toLowerCase() === stateName.toLowerCase());
    if (normalizedMatch) {
      return `CGWB, ${CGWB_LABS[normalizedMatch].replace(', ', '-')}`;
    }
    return `CGWB, Regional Office-${stateName}`;
  };

  return (
    <div 
      className="bg-white rounded-3xl p-6 shadow-xl border border-slate-100 min-h-[500px]"
      style={{
        fontFamily: 
          contaminationFont === 'times' ? "'Times New Roman', Times, serif" :
          contaminationFont === 'calibri' ? "Calibri, Candara, Segoe, 'Segoe UI', Optima, Arial, sans-serif" :
          contaminationFont === 'mono' ? "'JetBrains Mono', monospace" : "Inter, system-ui, sans-serif",
      }}
    >
      
      {uploadError && (
        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded-xl shadow-sm flex justify-between items-center mb-6">
          <div>
            <p className="font-bold text-sm">Upload Alert</p>
            <p className="text-xs">{uploadError}</p>
          </div>
          <button onClick={() => setUploadError('')} className="text-red-700 hover:text-red-900">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Tabs & Data Controls Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-100 p-2.5 rounded-2xl mb-6 no-print border border-slate-200">
        <div className="flex flex-wrap gap-1.5">
          <button 
            onClick={() => setActiveSubTab('report')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all border ${activeSubTab === 'report' ? 'bg-gradient-to-b from-blue-500 to-blue-700 text-white shadow-md border-blue-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            Alert Document
          </button>
          <button 
            onClick={() => setActiveSubTab('state')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all border ${activeSubTab === 'state' ? 'bg-gradient-to-b from-violet-500 to-violet-700 text-white shadow-md border-violet-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            State Summary
          </button>
          <button 
            onClick={() => setActiveSubTab('district')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all border ${activeSubTab === 'district' ? 'bg-gradient-to-b from-orange-500 to-orange-700 text-white shadow-md border-orange-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            District Summary
          </button>
          <button 
            onClick={() => setActiveSubTab('map')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all border ${activeSubTab === 'map' ? 'bg-gradient-to-b from-teal-500 to-teal-700 text-white shadow-md border-teal-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            Spatial Map
          </button>
          <button 
            onClick={() => setActiveSubTab('standards')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all border ${activeSubTab === 'standards' ? 'bg-gradient-to-b from-rose-500 to-rose-700 text-white shadow-md border-rose-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            Standards Table
          </button>
          <button 
            onClick={() => setActiveSubTab('treatments')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all border ${activeSubTab === 'treatments' ? 'bg-gradient-to-b from-cyan-500 to-cyan-700 text-white shadow-md border-cyan-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            Treatment Measures
          </button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={downloadTemplate} className="px-3.5 py-2 rounded-xl font-bold text-white bg-gradient-to-b from-emerald-500 to-emerald-700 border border-emerald-800 shadow-[0_2px_0_rgb(6,95,70)] hover:from-emerald-400 hover:to-emerald-600 active:shadow-none active:translate-y-[2px] transition-all text-xs">
            Template
          </button>
          <label className="px-3.5 py-2 rounded-xl font-bold text-white bg-gradient-to-b from-blue-500 to-blue-700 border border-blue-800 shadow-[0_2px_0_rgb(30,58,138)] hover:from-blue-400 hover:to-blue-600 active:shadow-none active:translate-y-[2px] transition-all cursor-pointer text-xs flex items-center gap-1">
            <Globe className="w-3.5 h-3.5" />
            Shapefile (ZIP)
            <input type="file" accept=".zip" className="hidden" onChange={handleShapefileUpload} />
          </label>
          <label className="px-3.5 py-2 rounded-xl font-bold text-slate-700 bg-gradient-to-b from-white to-gray-200 border border-gray-300 shadow-[0_2px_0_rgb(156,163,175)] hover:from-gray-50 hover:to-gray-100 active:shadow-none active:translate-y-[2px] transition-all cursor-pointer text-xs flex items-center gap-1">
            <Upload className="w-3.5 h-3.5" />
            Override Data
            <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} />
          </label>
          {internalRawData.length > 0 && (
            <button onClick={() => setInternalRawData([])} className="px-3 py-2 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 transition-colors text-xs shadow-md">
              Clear Override
            </button>
          )}
        </div>
      </div>

      {processedRawData.length === 0 ? (
        <div className="p-16 text-center border-2 border-dashed border-slate-300 rounded-3xl bg-slate-50/50">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="font-bold text-slate-700 mb-1">No Compliance Data Loaded</h3>
          <p className="text-slate-500 text-xs max-w-md mx-auto">
            Please upload a spreadsheet containing water chemistry parameters in the main app, or use "Override Data" above to load data directly.
          </p>
        </div>
      ) : (
        <>
          {activeSubTab === 'report' && (
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start mb-8">
              {/* Left Side: Interactive Customization Panel */}
              <div className="xl:col-span-1 bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm space-y-5 no-print">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1 font-sans">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                    Interactive Customizer
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium font-sans">Fine-tune your ground water alert pamphlet in real-time.</p>
                </div>

                {/* Theme Selector */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block font-sans">Pamphlet Color Accent</label>
                  <div className="grid grid-cols-2 gap-1.5 font-sans">
                    {[
                      { id: 'navy', label: 'Royal Navy', color: 'bg-blue-900 border-blue-950' },
                      { id: 'green', label: 'Forest Green', color: 'bg-emerald-950 border-emerald-950' },
                      { id: 'crimson', label: 'Crimson Red', color: 'bg-rose-950 border-rose-950' },
                      { id: 'charcoal', label: 'Luxury Slate', color: 'bg-slate-800 border-slate-900' },
                    ].map(theme => (
                      <button
                        key={theme.id}
                        onClick={() => setThemeColor(theme.id as any)}
                        className={`p-1.5 rounded-lg border text-[10px] font-black text-left flex items-center gap-1.5 transition-all ${themeColor === theme.id ? 'bg-white text-slate-900 shadow-sm border-slate-300 ring-2 ring-indigo-500' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                      >
                        <span className={`w-3 h-3 rounded-full ${theme.color} border`}></span>
                        {theme.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Layout Mode */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block font-sans">Layout Template Style</label>
                  <div className="grid grid-cols-2 gap-1.5 font-sans">
                    <button
                      onClick={() => setLayoutStyle('standard')}
                      className={`p-2 rounded-lg border text-[10px] font-black transition-all ${layoutStyle === 'standard' ? 'bg-white text-indigo-950 shadow-sm border-indigo-200 ring-2 ring-indigo-500' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                    >
                      📜 Standard Memo
                    </button>
                    <button
                      onClick={() => setLayoutStyle('pamphlet')}
                      className={`p-2 rounded-lg border text-[10px] font-black transition-all ${layoutStyle === 'pamphlet' ? 'bg-white text-indigo-950 shadow-sm border-indigo-200 ring-2 ring-indigo-500' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                    >
                      📖 2-Col Pamphlet
                    </button>
                  </div>
                </div>

                {/* Document Font Style Selection */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block font-sans">Document Font Style</label>
                  <div className="grid grid-cols-2 gap-1.5 font-sans">
                    {[
                      { id: 'times', label: 'Times New Roman' },
                      { id: 'calibri', label: 'Calibri / Sans' },
                      { id: 'mono', label: 'JetBrains Mono' },
                    ].map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setContaminationFont(f.id as any)}
                        className={`p-1.5 rounded-lg border text-[10px] font-black text-left flex items-center justify-between transition-all ${contaminationFont === f.id ? 'bg-white text-slate-900 shadow-sm border-slate-300 ring-2 ring-indigo-500' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                      >
                        <span>{f.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Edit Title */}
                <div className="space-y-1 font-sans">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">Custom Pamphlet Title</label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Enter document title..."
                    className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white shadow-inner focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                {/* Additional Recommendations */}
                <div className="space-y-1 font-sans">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">Additional Custom Remarks / Actions</label>
                  <textarea
                    rows={4}
                    value={customRemarks}
                    onChange={(e) => setCustomRemarks(e.target.value)}
                    placeholder="Type additional remedial actions or remarks to dynamically append to Para II of the document..."
                    className="w-full text-[11px] p-2 border border-slate-300 rounded-lg bg-white shadow-inner focus:ring-2 focus:ring-indigo-500 outline-none font-medium leading-relaxed resize-none"
                  />
                </div>

                {/* Quick Date Inputs */}
                <div className="bg-slate-100 p-3 rounded-xl border border-slate-200 space-y-2 font-sans">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Period Dates</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[9px] font-bold text-slate-500 uppercase block mb-0.5">From</span>
                      <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-full text-[10px] p-1.5 border border-slate-300 rounded bg-white text-center font-bold" />
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-slate-500 uppercase block mb-0.5">To</span>
                      <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-full text-[10px] p-1.5 border border-slate-300 rounded bg-white text-center font-bold" />
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-500 uppercase block mb-0.5">Issue Date</span>
                    <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="w-full text-[10px] p-1.5 border border-slate-300 rounded bg-white text-center font-bold" />
                  </div>
                </div>
              </div>

              {/* Right Side: The Pamphlet View */}
              <div className="xl:col-span-3 bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
                {/* Print Control Header */}
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center no-print font-sans">
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">Pamphlet Interactive Preview</h3>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleDownloadWord} className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-b from-indigo-500 to-indigo-700 border border-indigo-800 hover:from-indigo-400 hover:to-indigo-600 transition-all flex items-center gap-1">
                      <FileDown className="w-3.5 h-3.5" />
                      Download Word
                    </button>
                    <button onClick={handlePrint} className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-b from-sky-500 to-sky-700 border border-sky-800 hover:from-sky-400 hover:to-sky-600 transition-all flex items-center gap-1">
                      <Printer className="w-3.5 h-3.5" />
                      Print Page
                    </button>
                  </div>
                </div>

                {/* The actual formatted publication document with print-container */}
                <div className="print-container overflow-hidden">
                  <div 
                    className="p-8 md:p-12 text-gray-950 text-justify leading-relaxed text-[13.5px] max-w-4xl mx-auto relative transition-all duration-300 antialiased subpixel-antialiased"
                    style={{ 
                      fontFamily: 
                        contaminationFont === 'times' ? "'Times New Roman', Times, serif" :
                        contaminationFont === 'calibri' ? "Calibri, Candara, Segoe, 'Segoe UI', Optima, Arial, sans-serif" :
                        contaminationFont === 'mono' ? "'JetBrains Mono', monospace" : "Inter, system-ui, sans-serif",
                      margin: "16px",
                      textRendering: "optimizeLegibility",
                      WebkitFontSmoothing: "antialiased",
                      MozOsxFontSmoothing: "grayscale"
                    }}
                  >
                    {/* Header / Seal Title block without Logo */}
                    <div className="flex flex-col items-center justify-center text-center mb-6">
                      <h1 className="font-bold text-2xl uppercase tracking-wider mb-1" style={{ color: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}>
                        {customTitle}
                      </h1>
                      <div className="w-24 h-1 my-1.5" style={{ backgroundColor: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}></div>
                      <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Central Ground Water Board (CGWB) • Government of India</span>
                    </div>
                    
                    {/* Metadata Table */}
                    <table className="w-full border-collapse border border-black mb-6 text-xs text-center">
                      <tbody>
                        <tr>
                          <td className="border border-black p-2 font-bold bg-slate-50 w-1/4">Location</td>
                          <td className="border border-black p-2 w-1/4 font-semibold">{reportLocation}</td>
                          <td className="border border-black p-2 font-bold bg-slate-50 w-1/4">Analysis Period</td>
                          <td className="border border-black p-2 w-1/4 text-left font-semibold">
                            <div>From: {fromDate.split('-').reverse().join('/')}</div>
                            <div>To: {toDate.split('-').reverse().join('/')}</div>
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black p-2 font-bold bg-slate-50">Issue Date</td>
                          <td className="border border-black p-2 text-left font-semibold">
                            {issueDate.split('-').reverse().join('/')}
                          </td>
                          <td className="border border-black p-2 font-bold bg-slate-50">Issuing Office</td>
                          <td className="border border-black p-2 font-semibold">{getIssuingOffice()}</td>
                        </tr>
                      </tbody>
                    </table>

                    {(() => {
                      const overallTotal = reportTableData.reduce((sum, row) => {
                        const man = manualTotals[row.key];
                        const val = (man !== undefined && man !== '') ? (parseInt(man as string, 10) || 0) : row.total;
                        return sum + (isNaN(val) ? 0 : val);
                      }, 0);

                      const overallMarginal = reportTableData.reduce((acc, curr) => acc + curr.marginal, 0);
                      const overallUnsafe = reportTableData.reduce((acc, curr) => acc + curr.unsafe, 0);
                      const overallContaminated = overallMarginal + overallUnsafe;
                      
                      const statesWithHM = Array.from(new Set(reportTableData.filter(s => s.hasHeavyMetals).map(s => s.state))) as string[];
                      
                      const formatList = (list: string[]) => {
                        if (list.length === 0) return '';
                        if (list.length === 1) return list[0];
                        if (list.length === 2) return list.join(' and ');
                        return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
                      };
                      
                      let hmStateText = statesWithHM.length > 0 ? ` Additionally, specific testing for Heavy/Trace Metals was performed on groundwater samples from ${formatList(statesWithHM)}.` : '';

                      const getLabText = () => {
                        if (!isSingleState) return "across various states in CGWB Regional Chemical Laboratories";
                        const stateName = reportLocation.trim();
                        const normalizedMatch = Object.keys(CGWB_LABS).find(k => k.toLowerCase() === stateName.toLowerCase());
                        if (normalizedMatch) {
                          return `in CGWB Regional Chemical Laboratory, ${CGWB_LABS[normalizedMatch]}`;
                        }
                        return `in the CGWB Regional Chemical Laboratory for ${stateName}`;
                      };

                      const firstParaText = `A comprehensive analysis of ${overallTotal} groundwater samples was conducted ${getLabText()} to assess water quality as per the BIS Drinking Water Standard (IS 10500:2012). Analysed parameters included pH, Electrical Conductivity, Total Hardness, Calcium, Magnesium, Sodium, Potassium, Carbonate, Bicarbonate, Sulphate, Chloride, Nitrate, Fluoride and Trace/Heavy Metals such as Arsenic, Uranium and Iron.${hmStateText}`;

                      return (
                        <div className="mb-6">
                          <h3 className="font-bold text-sm mb-2 underline" style={{ color: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}>
                            Groundwater Quality Analysis Report Summary
                          </h3>
                          
                          {/* 2-Column Pamphlet layout vs Standard */}
                          <div className={layoutStyle === 'pamphlet' ? 'md:columns-2 gap-8 [column-rule:1px_solid_#e2e8f0] mb-4 text-justify' : 'space-y-3 mb-4 text-justify'}>
                            <p className="mb-3 break-inside-avoid">
                              {/* Dropcap style for pamphlet */}
                              {layoutStyle === 'pamphlet' ? (
                                <>
                                  <span className="float-left text-5xl font-extrabold mr-2 mt-1 leading-none select-none" style={{ color: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}>{firstParaText[0]}</span>
                                  {firstParaText.slice(1)}
                                </>
                              ) : firstParaText}
                            </p>

                            <div className="break-inside-avoid">
                              <h4 className="font-bold text-sm mb-1">Key Compliance Findings:</h4>
                              <p className="mb-2">
                                Out of the <b>{overallTotal}</b> total samples analyzed, <b>{overallContaminated}</b> were found to be contaminated. These results are categorized as follows:
                              </p>
                              <ul className="list-disc pl-6 mb-3 space-y-1">
                                <li>Exceeding Acceptable Limit (but up to permissible limit): <b>{overallMarginal}</b> samples</li>
                                <li>Exceeding Permissible Limit: <b>{overallUnsafe}</b> samples</li>
                              </ul>

                              <p className="mb-3">
                                The following table provides a breakdown of contaminant detection by {isSingleState ? 'District' : 'State/Union Territory'}. Please refer to the attached Excel sheet for the comprehensive, parameter-wise analytical data.
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    
                    <h3 className="font-bold underline text-sm mb-3" style={{ color: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}>Para I</h3>
                    
                    <SimpleReportTable data={reportTableData} isDistrict={isSingleState} manualTotals={manualTotals} onManualTotalChange={handleManualTotalChange} contaminationFont={contaminationFont} />

                    <div className="page-break-before pt-6">
                      <h3 className="font-bold underline text-sm mb-3" style={{ color: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}>Para II</h3>
                      
                      {activeRemedialMeasures.length > 0 ? (
                        <>
                          <p className="mb-4">The anomalies may be termed major in some case.</p>

                          <h4 className="font-bold text-sm underline mb-4" style={{ color: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}>Risk Perception and Remedial Measures</h4>
                          
                          <div className="space-y-6">
                            {activeRemedialMeasures.map((measure, idx) => (
                              <div key={measure.id} className="avoid-break mb-4 border-l-2 pl-4" style={{ borderColor: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}>
                                <h5 className="font-bold underline mb-2 text-[15px]" style={{ color: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}>{measure.title}</h5>
                                
                                {measure.riskPerception && (
                                  <div className="mb-2 text-xs">
                                    <span className="font-bold mr-1">Risk Perception:</span>
                                    <span className="text-slate-700">{measure.riskPerception}</span>
                                  </div>
                                )}
                                
                                <div className="mb-2 text-xs">
                                  <span className="font-bold block mb-1">Remedial Measures:</span>
                                  {measure.sections.map((sec, sIdx) => (
                                    <div key={sIdx} className="mb-1 text-slate-700">
                                      {sec.desc && <p className="inline">{sec.desc}</p>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="italic text-gray-500 mb-4">
                          All tested parameters in the provided dataset are within safe limits. No specific remedial measures are currently required.
                        </p>
                      )}

                      {/* Appended custom remarks dynamically */}
                      {customRemarks.trim() && (
                        <div className="mt-6 pt-6 border-t-2 border-dashed border-slate-200 avoid-break">
                          <h4 className="font-bold text-sm underline mb-2" style={{ color: themeColor === 'navy' ? '#1e3a8a' : themeColor === 'green' ? '#064e3b' : themeColor === 'crimson' ? '#7f1d1d' : '#1e293b' }}>Additional Directives & Custom Recommendations</h4>
                          <p className="text-slate-800 leading-relaxed italic">{customRemarks}</p>
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSubTab === 'state' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-8">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-150 flex justify-between items-center flex-wrap gap-4">
                <h3 className="text-base font-bold text-slate-800">State/UT-wise Compliance Overview</h3>
                {summaryData.length > 0 && (
                  <button 
                    onClick={exportSummary}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-b from-amber-500 to-amber-700 border border-amber-800 shadow-[0_2px_0_rgb(146,64,14)] hover:from-amber-400 hover:to-amber-600 active:translate-y-0.5 transition-all flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export Table
                  </button>
                )}
              </div>
              <SummaryTable data={summaryData} isDistrict={false} manualTotals={manualTotals} onManualTotalChange={handleManualTotalChange} contaminationFont={contaminationFont} />
            </div>
          )}

          {activeSubTab === 'district' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-8">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-150 flex justify-between items-center flex-wrap gap-4">
                <h3 className="text-base font-bold text-slate-800">District-wise Compliance Overview</h3>
                {districtSummaryData.length > 0 && (
                  <button 
                    onClick={exportSummary}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-b from-amber-500 to-amber-700 border border-amber-800 shadow-[0_2px_0_rgb(146,64,14)] hover:from-amber-400 hover:to-amber-600 active:translate-y-0.5 transition-all flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export Table
                  </button>
                )}
              </div>
              <SummaryTable data={districtSummaryData} isDistrict={true} manualTotals={manualTotals} onManualTotalChange={handleManualTotalChange} contaminationFont={contaminationFont} />
            </div>
          )}

          {activeSubTab === 'map' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-8">
              <MapContainer data={processedRawData} limits={limits} geoJsonData={geoJsonData} />
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 flex items-center gap-3">
                  <div className="w-4.5 h-4.5 rounded-full bg-emerald-500"></div>
                  <span className="text-xs font-bold text-emerald-800">Safe: All parameters within acceptable limits</span>
                </div>
                <div className="bg-orange-50 p-3 rounded-xl border border-orange-200 flex items-center gap-3">
                  <div className="w-4.5 h-4.5 rounded-full bg-orange-500"></div>
                  <span className="text-xs font-bold text-orange-800">Marginal: Above Acceptable, below Permissible</span>
                </div>
                <div className="bg-red-50 p-3 rounded-xl border border-red-100 flex items-center gap-3">
                  <div className="w-4.5 h-4.5 rounded-full bg-red-500"></div>
                  <span className="text-xs font-bold text-red-800">Unsafe: Above Permissible (or pH out of range)</span>
                </div>
              </div>
            </div>
          )}

          {activeSubTab === 'standards' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-8">
              <div className="bg-slate-900 px-6 py-4 border-b border-slate-800 text-white">
                <h3 className="text-base font-black">BIS 10500:2012 Drinking Water Quality Parameters</h3>
                <p className="text-xs text-slate-300 mt-1 font-medium">Standards, risk perceptions and general treatment strategies.</p>
              </div>
              <div className="overflow-x-auto p-4 bg-slate-50">
                <table className="w-full text-left border-separate min-w-[700px]" style={{ borderSpacing: '0 8px' }}>
                  <thead>
                    <tr className="text-slate-500 text-[10px] uppercase tracking-widest font-black">
                      <th className="px-3 pb-1 font-black w-32">Parameter</th>
                      <th className="px-2 pb-1 font-black w-24 text-center">Acceptable</th>
                      <th className="px-2 pb-1 font-black w-24 text-center">Permissible</th>
                      <th className="px-3 pb-1 font-black">Implications & Action Plans</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(limits).map((param, index) => {
                      const limit = limits[param];
                      const shortName = param.split(' ')[0];
                      const measure = REMEDIAL_MEASURES.find(m => m.id === shortName);
                      const color = PARAM_COLORS[index % PARAM_COLORS.length];
                      
                      return (
                        <tr key={param} className="bg-white hover:bg-slate-50 transition-colors group rounded-xl shadow-[0_2px_5px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_10px_rgba(0,0,0,0.06)] border border-slate-200">
                          <td className="p-3 rounded-l-xl border border-r-0 border-slate-100 align-middle">
                            <div className={`inline-flex flex-col min-w-[80px] bg-gradient-to-b ${color.bg} text-white px-2.5 py-2 rounded-lg ${color.shadow} border ${color.border} transform group-hover:-translate-y-0.5 transition-transform`}>
                              <span className="font-black text-sm drop-shadow-md tracking-wide"><FormatParam param={shortName} /></span>
                              {param.includes('(') && <span className="text-[8px] font-bold text-white/80 mt-0.5 uppercase tracking-tighter leading-tight">{param.substring(param.indexOf('('))}</span>}
                            </div>
                          </td>
                          <td className="p-3 border-t border-b border-slate-100 text-center align-middle">
                            <div className="mx-auto min-w-[50px] w-max bg-gradient-to-b from-emerald-400 to-emerald-600 text-white px-2 py-1 rounded-lg shadow-[0_2px_0_rgb(4,120,87)] border border-emerald-700 font-black text-xs transform group-hover:-translate-y-0.5 transition-transform flex items-center justify-center">
                              {limit.acc}
                            </div>
                          </td>
                          <td className="p-3 border-t border-b border-slate-100 text-center align-middle">
                            <div className="mx-auto min-w-[50px] w-max bg-gradient-to-b from-rose-500 to-rose-700 text-white px-2 py-1 rounded-lg shadow-[0_2px_0_rgb(159,18,57)] border border-rose-800 font-black text-xs transform group-hover:-translate-y-0.5 transition-transform flex items-center justify-center">
                              {limit.perm}
                            </div>
                          </td>
                          <td className="p-3 rounded-r-xl border border-l-0 border-slate-100 align-middle">
                            <div className="bg-slate-50/80 border-l-2 border-slate-300 p-2.5 rounded-lg text-[11px] text-slate-700 font-medium leading-relaxed flex flex-col gap-1.5">
                              {measure ? (
                                <>
                                  {measure.riskPerception && (
                                    <div>
                                      <span className="font-bold text-red-800 uppercase text-[9px] tracking-wider">Risk: </span>
                                      {measure.riskPerception}
                                    </div>
                                  )}
                                  <div>
                                    <span className="font-bold text-emerald-800 uppercase text-[9px] tracking-wider">Action: </span>
                                    {measure.sections.map((s, i) => <span key={i}>{s.desc} </span>)}
                                  </div>
                                </>
                              ) : (
                                <span className="text-gray-400 italic">Standard water treatment measures apply.</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeSubTab === 'treatments' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-8">
              <div className="bg-slate-900 px-6 py-4 border-b border-slate-800 text-white">
                <h3 className="text-base font-black">Standard Water Treatment Measures</h3>
                <p className="text-xs text-slate-300 mt-1 font-medium">Applied water purification and chemical engineering strategies.</p>
              </div>
              <div className="p-6 bg-slate-50 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {STANDARD_TREATMENTS.map((treatment, idx) => (
                  <div key={treatment.title} className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-slate-100 overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group flex flex-col">
                    <div className={`h-2 w-full bg-gradient-to-r ${treatment.color}`}></div>
                    <div className="p-5 flex-1 flex flex-col">
                      <h4 className={`text-sm font-black mb-2 bg-clip-text text-transparent bg-gradient-to-r ${treatment.color}`}>
                        {treatment.title}
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed font-medium mb-4">
                        {treatment.desc}
                      </p>
                      <div className="mt-auto bg-slate-50 border border-slate-100 p-2.5 rounded-xl shadow-inner">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Mechanism</span>
                        <p className="text-[10px] text-slate-700 font-mono leading-relaxed whitespace-pre-line">
                          {treatment.chemistry}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Column Mapping Modal */}
      {showMappingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden font-sans">
            <div className="p-6 bg-gradient-to-r from-blue-800 to-indigo-900 text-white flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold">Map Alert Dataset Columns</h3>
                <p className="text-blue-200 text-xs mt-1">Please match your uploaded file's columns to the standard required format.</p>
              </div>
              <button onClick={() => setShowMappingModal(false)} className="text-white/70 hover:text-white transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {COLUMNS.map(col => {
                  const isParam = DEFAULT_LIMITS[col as keyof typeof DEFAULT_LIMITS] !== undefined;
                  return (
                    <div key={col} className={`p-3 rounded-xl border ${columnMapping[col] ? 'bg-white border-emerald-200 shadow-sm' : 'bg-orange-50 border-orange-200 border-dashed'}`}>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          {col}
                          {isParam && <span className="bg-blue-100 text-blue-800 text-[8px] px-1.5 py-0.5 rounded uppercase font-black tracking-wider">Param</span>}
                          {!columnMapping[col] && <span className="text-orange-600 text-[9px] font-bold italic ml-auto">Unmapped</span>}
                        </label>
                        <select
                          className="w-full text-xs p-2 border border-slate-300 rounded bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          value={columnMapping[col] || ""}
                          onChange={(e) => setColumnMapping(prev => ({ ...prev, [col]: e.target.value }))}
                        >
                          <option value="">-- Ignore / Not present --</option>
                          {uploadedColumns.map(uploadedCol => (
                            <option key={uploadedCol} value={uploadedCol}>{uploadedCol}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div className="p-4 border-t border-slate-200 bg-white flex justify-end gap-3">
              <button 
                onClick={() => setShowMappingModal(false)}
                className="px-4 py-2.5 rounded-xl font-bold text-xs text-slate-600 bg-slate-100 border border-slate-300 hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={applyMapping}
                className="px-5 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-b from-blue-500 to-blue-700 border border-blue-800 shadow-[0_3px_0_rgb(30,58,138)] hover:from-blue-400 hover:to-blue-600 active:shadow-none active:translate-y-[3px] transition-all flex items-center gap-1.5"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Import Data
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default FortnightlyAlertsView;

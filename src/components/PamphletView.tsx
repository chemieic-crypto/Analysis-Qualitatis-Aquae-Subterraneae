import React, { useState, useEffect } from "react";
import { DataHeaders, ExceedingLocationItem } from "../types";
import { PARAM_CONFIG, ALL_REMEDIAL_MEASURES } from "../data/config";
import { getStats } from "../utils/math";
import { generateParamDonutChart } from "../utils/chartHelpers";
import { downloadMhtmlWordDoc } from "../utils/export";
import {
  FileCheck2,
  FileDown,
  ChevronDown,
  LayoutTemplate,
  AlertCircle,
  Map,
  ShieldCheck,
  PlusCircle,
  Sparkles,
  Droplets,
  Sprout
} from "lucide-react";

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

interface PamphletViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState: string;
  selectedDistrict: string;
}

export default function PamphletView({
  rawData,
  headers,
  headerMap,
  selectedState,
  selectedDistrict,
}: PamphletViewProps) {
  const [selectedPamphletParams, setSelectedPamphletParams] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  // Filter out Na, K, HCO3, CO3 from pamphlet parameter list (parameters without BIS limits)
  const availableParams = React.useMemo(() => {
    if (!headers || !headers.params) return [];
    return headers.params.filter(p => {
      const paramId = headerMap[p] || p;
      return !["Na", "K", "HCO3", "CO3"].includes(paramId);
    });
  }, [headers, headerMap]);

  // Custom uploaded maps
  const [ecMapBase64, setEcMapBase64] = useState<string | null>(null);
  const [summaryMapBase64, setSummaryMapBase64] = useState<string | null>(null);

  // Generated document state
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [pamphletHtml, setPamphletHtml] = useState("");

  useEffect(() => {
    if (availableParams.length > 0) {
      setSelectedPamphletParams([...availableParams]);
    } else {
      setSelectedPamphletParams([]);
    }
  }, [availableParams]);

  const handleSelectAll = () => {
    if (selectedPamphletParams.length === availableParams.length) {
      setSelectedPamphletParams([]);
    } else {
      setSelectedPamphletParams([...availableParams]);
    }
  };

  const handleToggleParam = (val: string) => {
    if (selectedPamphletParams.includes(val)) {
      setSelectedPamphletParams(selectedPamphletParams.filter((p) => p !== val));
    } else {
      setSelectedPamphletParams([...selectedPamphletParams, val]);
    }
  };

  const handleMapUpload = (e: React.ChangeEvent<HTMLInputElement>, type: "ec" | "summary") => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          if (type === "ec") setEcMapBase64(evt.target.result as string);
          else setSummaryMapBase64(evt.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (!rawData.length) return;
    if (selectedPamphletParams.length === 0) return;

    setIsGenerating(true);
    await new Promise((resolve) => setTimeout(resolve, 100)); // allow spin lock

    try {
      // 1. Filter Data
      let filtered = rawData;
      let regionName = "India";
      let stateNameStr = "National Summary";

      if (selectedState) {
        filtered = filtered.filter(
          (d) => String(d[headers.state || ""] || "").trim() === selectedState
        );
        regionName = selectedState;
        stateNameStr = "State Analysis";
      }
      if (selectedDistrict) {
        filtered = filtered.filter(
          (d) => String(d[headers.district || ""] || "").trim() === selectedDistrict
        );
        regionName = selectedDistrict;
        stateNameStr = selectedState;
      }

      const totalSamples = filtered.length;
      const heavyMetalsList = ["Fe", "Mn", "As", "U", "Zn", "Cu", "Pb", "Cd", "Cr", "Hg", "Ni", "Se", "Ba", "Al", "B", "Mo"];

      // 2. Compute compliance metrics
      let safeSamplesCount = 0;
      let singleExceedanceCount = 0;
      let multiExceedanceCount = 0;
      
      interface LocalParamStat {
        key: string;
        name: string;
        count: number;
        total: number;
        pct: number;
        isHeavyMetal: boolean;
      }

      const globalParamStats: LocalParamStat[] = selectedPamphletParams.map((paramCol) => {
        const configKey = headerMap[paramCol];
        return {
          key: configKey,
          name: PARAM_CONFIG[configKey]?.name || paramCol,
          count: 0,
          total: 0,
          pct: 0,
          isHeavyMetal: heavyMetalsList.includes(configKey),
        };
      });

      filtered.forEach((row) => {
        let exceedancesForThisSample = 0;

        globalParamStats.forEach((pStat) => {
          const originalHeader = Object.keys(headerMap).find(
            (k) => headerMap[k] === pStat.key && availableParams.includes(k)
          );
          if (!originalHeader) return;

          const val = parseFloat(row[originalHeader]);
          if (!isNaN(val)) {
            pStat.total++;
            const config = PARAM_CONFIG[pStat.key];
            const isSingleLimit = config.b1 === config.b2 && pStat.key !== "pH";
            const limit = pStat.key === "pH" ? null : isSingleLimit ? config.b1 : config.b2;

            if (pStat.key === "pH") {
              if (val < config.b1 || val > config.b2) {
                exceedancesForThisSample++;
                pStat.count++;
              }
            } else if (limit !== null) {
              if (val > limit) {
                exceedancesForThisSample++;
                pStat.count++;
              }
            }
          }
        });

        if (exceedancesForThisSample === 0) safeSamplesCount++;
        else if (exceedancesForThisSample === 1) singleExceedanceCount++;
        else multiExceedanceCount++;
      });

      // 3. Compile compliance pie donut
      const summaryChartData = [
        ...(safeSamplesCount > 0 ? [{ name: "All Parameters Within Safe Limits", y: safeSamplesCount, color: "#10b981" }] : []),
        ...(singleExceedanceCount > 0 ? [{ name: "One Parameter Exceeds Limit", y: singleExceedanceCount, color: "#f59e0b" }] : []),
        ...(multiExceedanceCount > 0 ? [{ name: "More Than One Parameter Exceeds Limit", y: multiExceedanceCount, color: "#f43f5e" }] : []),
      ];

      // Draw high resolution 3D Pie Donut chart inside memory with light theme styling (dark labels) for transparent background integration
      const summaryChartImageBase64 = await generateParamDonutChart(
        "Overall Sample Compliance Distribution",
        summaryChartData,
        false
      );

      globalParamStats.forEach((p) => {
        p.pct = p.total > 0 ? (p.count / p.total) * 100 : 0;
      });

      globalParamStats.sort((a, b) => b.pct - a.pct);
      const exceedingParamsInfo = globalParamStats.filter((p) => p.count > 0);
      const topExceeding = exceedingParamsInfo.slice(0, 6);
      const topParamNamesStr = topExceeding.map((p) => `${p.name} (${p.key})`).join(", ");

      // 4. Construct descriptive executive templates
      const safePct = totalSamples > 0 ? ((safeSamplesCount / totalSamples) * 100).toFixed(1) : "0.0";
      const singlePct = totalSamples > 0 ? ((singleExceedanceCount / totalSamples) * 100).toFixed(1) : "0.0";
      const multiPct = totalSamples > 0 ? ((multiExceedanceCount / totalSamples) * 100).toFixed(1) : "0.0";

      let textPara1 = `A comprehensive groundwater quality assessment was carried out for <strong>${regionName}</strong> based on the analysis of <strong>${totalSamples}</strong> groundwater samples collected from various blocks and habitations. The study evaluated major physicochemical parameters and heavy metals to assess the suitability of groundwater for drinking purposes as per BIS IS 10500 standards. The results indicate that groundwater quality in the region is influenced by both natural geological conditions and anthropogenic activities such as intensive agriculture, excessive groundwater extraction, and improper waste disposal.`;

      let textParaCompliance = `Evaluating overall sample integrity against the selected parameters, <strong>${safeSamplesCount} out of ${totalSamples} samples (${safePct}%)</strong> were found to be completely safe, with all parameters remaining strictly within permissible limits. `;
      if (singleExceedanceCount > 0 || multiExceedanceCount > 0) {
        textParaCompliance += `Conversely, <strong>${singleExceedanceCount} samples (${singlePct}%)</strong> exceeded the limit for one water quality parameter, highlighting localized or parameter-specific issues. More critically, <strong>${multiExceedanceCount} samples (${multiPct}%)</strong> exhibited simultaneous exceedances in more than one parameter, indicating complex contamination profiles that require robust, holistic water treatment interventions.`;
      }

      let textPara2 = "A detailed evaluation of specific parameters reveals varying degrees of hydrochemical compliance. ";
      if (exceedingParamsInfo.length > 0) {
        textPara2 += `Specifically, <strong>${topParamNamesStr}</strong> exceeded permissible limits in multiple locations. `;
        const explanations: string[] = [];
        topExceeding.forEach((p) => {
          const reason =
            p.key === "NO3"
              ? "excessive fertilizer use, septic tank leakage, and organic waste infiltration"
              : p.key === "F" || p.key === "U" || p.key === "As"
              ? "natural geogenic sources and water-rock interactions"
              : ["EC", "TDS", "Cl", "TH", "Ca", "Mg", "Na"].includes(p.key)
              ? "salinity intrusion, mineral dissolution, and agricultural runoff"
              : "various geogenic and anthropogenic factors";
          explanations.push(
            `<strong>${p.name}</strong> was elevated in <strong>${p.pct.toFixed(1)}%</strong> of the samples (primarily linked to ${reason})`
          );
        });
        textPara2 += explanations.join("; ") + ". ";
      } else {
        textPara2 += "All analyzed physical and chemical parameters remained strictly within the safe permissible limits prescribed by BIS standards, indicating no specific single-parameter anomalies. ";
      }

      // Heavy metals
      const heavyMetalsAnalyzed = globalParamStats.filter((p) => p.isHeavyMetal);
      const exceedingHeavyMetals = heavyMetalsAnalyzed.filter((p) => p.count > 0);
      const safeHeavyMetals = heavyMetalsAnalyzed.filter((p) => p.count === 0);

      let textParaHeavy = "";
      if (heavyMetalsAnalyzed.length > 0) {
        if (exceedingHeavyMetals.length > 0) {
          const exMetalsStr = exceedingHeavyMetals.map((p) => `${p.name} (${p.pct.toFixed(1)}%)`).join(", ");
          textParaHeavy = `Regarding trace and heavy metal contamination, the analysis indicates significant concerns in specific areas. Toxic metals such as <strong>${exceedingHeavyMetals.map((p) => p.name).join(", ")}</strong> exceeded permissible limits. Specifically, exceedances were observed in ${exMetalsStr} of the analyzed samples. The presence of these heavy metals in groundwater is primarily attributed to geogenic processes, water-rock interactions, and potentially localized anthropogenic discharges. Prolonged consumption of such contaminated water poses severe public health risks, necessitating immediate intervention and the provision of alternate safe drinking water sources. `;
          if (safeHeavyMetals.length > 0) {
            textParaHeavy += `Conversely, other heavy metals including ${safeHeavyMetals
              .slice(0, 5)
              .map((p) => p.name)
              .join(", ")} were found to be safely within acceptable limits.`;
          }
        } else {
          textParaHeavy = `Regarding trace and heavy metal contamination, a comprehensive evaluation of toxic metals (including ${heavyMetalsAnalyzed
            .slice(0, 6)
            .map((p) => p.name)
            .join(", ")}) revealed that all analyzed samples remained well within the safe limits prescribed by the BIS standards. This indicates the absence of significant heavy metal pollution in the monitored locations, ensuring that the water is free from these specific toxicological health risks.`;
        }
      }

      // 5. Build parameterized cards HTML
      let basicCardsHTML = "";
      let heavyCardsHTML = "";

      for (let i = 0; i < selectedPamphletParams.length; i++) {
        const paramCol = selectedPamphletParams[i];
        const configKey = headerMap[paramCol];
        const config = PARAM_CONFIG[configKey];
        if (!config) continue;

        const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
        const limitStr =
          configKey === "pH"
            ? `${config.b1}-${config.b2}`
            : `${isSingleLimit ? config.b1 : config.b2} ${config.unit}`;
        const checkLimit = configKey === "pH" ? null : isSingleLimit ? config.b1 : config.b2;

        const vals: number[] = [];
        let exceedCount = 0;
        const exceedingLocationsSet = new Set<string>();

        filtered.forEach((row) => {
          const v = parseFloat(row[paramCol]);
          if (!isNaN(v)) {
            vals.push(v);
            let isExceeding = false;
            if (configKey === "pH") {
              if (v < config.b1 || v > config.b2) isExceeding = true;
            } else if (checkLimit !== null) {
              if (v > checkLimit) isExceeding = true;
            }

            if (isExceeding) {
              exceedCount++;
              const blockName = String(row[headers.block || ""] || "").trim();
              const locName = String(row[headers.location || ""] || "").trim();
              
              let strVal = "";
              if (locName && locName !== "Unknown" && blockName && blockName !== "Unknown") {
                strVal = `${locName} (${blockName})`;
              } else if (locName && locName !== "Unknown") {
                strVal = locName;
              } else if (blockName && blockName !== "Unknown") {
                strVal = `${blockName} (Block)`;
              }

              if (strVal) exceedingLocationsSet.add(strVal);
            }
          }
        });

        if (vals.length === 0) continue;

        const stats = getStats(vals);
        const exceedPct = ((exceedCount / vals.length) * 100).toFixed(1);
        const isSafe = exceedCount === 0;

        let specificInsight = "";
        if (configKey === "pH") specificInsight = "suggesting potential acidic or alkaline concerns affecting water taste and pipe corrosion.";
        if (configKey === "EC" || configKey === "TDS") specificInsight = "indicating salinity buildup due to mineral dissolution, saline intrusion, agricultural runoff, and intensive exploitation.";
        if (configKey === "Cl") specificInsight = "Elevated chloride imparts a salty taste and indicates groundwater salinization.";
        if (configKey === "F") specificInsight = "Long-term consumption of excess fluoride may lead to dental and skeletal fluorosis.";
        if (configKey === "SO4") specificInsight = "High sulphate may cause laxative effects and impart a bitter taste to the water.";
        if (configKey === "NO3") specificInsight = "Elevated nitrate concentration mainly reflects agricultural contamination caused by excessive fertilizer use and sanitation seeps.";
        if (configKey === "TH") specificInsight = "Very hard groundwater is mainly caused by elevated calcium and magnesium concentrations resulting from dissolution of carbonate rocks.";
        if (configKey === "Ca" || configKey === "Mg") specificInsight = `Elevated ${config.name.toLowerCase()} contributes significantly to groundwater hardness in the district.`;
        if (configKey === "Mn") specificInsight = "Long-term manganese exposure may affect neurological health and water aesthetics.";
        if (configKey === "U") specificInsight = "Elevated uranium is generally associated with granitic rock formations, alkaline levels, and water-rock interactions.";
        if (configKey === "As") specificInsight = "Arsenic is highly toxic and its presence is mainly geogenic, requiring immediate remediation.";

        const exceedingList = Array.from(exceedingLocationsSet);
        let exceedingStr = exceedingList.slice(0, 15).join(", ");
        if (exceedingList.length > 15) {
          exceedingStr += `, and ${exceedingList.length - 15} more locations`;
        }

        let mapHtml = "";
        if (configKey === "EC" && ecMapBase64) {
          mapHtml = `
            <div style="margin-top: 15px; text-align: center; padding: 12px; background-color: transparent; border: 1px solid #cbd5e1; border-radius: 8px;">
              <img src="${ecMapBase64}" alt="EC IDW Map" style="max-height: 400px; display: block; margin: 0 auto; max-width: 100%; border-radius: 8px;" />
              <p style="font-size: 11px; font-weight: bold; color: #475569; margin-top: 8px; font-style: italic;">Spatial Distribution (IDW) Map of Electrical Conductivity</p>
            </div>
          `;
        }

        const cardHTML = `
          <div style="margin-bottom: 16px; background-color: #ffffff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; border-left: 4px solid ${
            isSafe ? "#34d399" : "#fb7185"
          };">
            <h4 style="font-weight: bold; color: #1e293b; font-size: 16px; margin: 0 0 8px 0;">${config.name} (${configKey})</h4>
            <p style="color: #475569; line-height: 1.5; font-size: 13.5px; margin: 0;">
              Concentration ranges from <strong>${stats.min.toFixed(2)} ${config.unit}</strong> to <strong>${stats.max.toFixed(2)} ${config.unit}</strong> with an average value of nearly <strong>${stats.avg.toFixed(2)} ${config.unit}</strong>. 
              ${
                isSafe
                  ? `<span style="color: #059669; font-weight: bold;">All samples remain safely within limits.</span>`
                  : `<span style="color: #dc2626; font-weight: bold;">About ${exceedPct}% of the analyzed samples exceed the BIS ${
                      configKey === "pH" ? "acceptable range" : "permissible limit"
                    } of ${limitStr}.</span> Elevated levels are particularly observed in: <span style="font-weight: bold; color: #0f172a;">${exceedingStr}</span>. ${specificInsight}`
              }
            </p>
            ${mapHtml}
          </div>
        `;

        if (heavyMetalsList.includes(configKey)) heavyCardsHTML += cardHTML;
        else basicCardsHTML += cardHTML;
      }

      // 6. Multi-Parameter Exceedance Location Lists
      const exceedingLocationsList: ExceedingLocationItem[] = [];
      filtered.forEach((row) => {
        const exceededParams: string[] = [];
        const exceededDetails: string[] = [];
        let hasHeavyMetal = false;

        selectedPamphletParams.forEach((paramCol) => {
          const configKey = headerMap[paramCol];
          const config = PARAM_CONFIG[configKey];
          if (!config) return;

          const val = parseFloat(row[paramCol]);
          if (isNaN(val)) return;

          const isSingleLimit = config.b1 === config.b2 && configKey !== "pH";
          const checkLimit = configKey === "pH" ? null : isSingleLimit ? config.b1 : config.b2;

          let isExceeding = false;
          if (configKey === "pH") {
            if (val < config.b1 || val > config.b2) isExceeding = true;
          } else if (checkLimit !== null) {
            if (val > checkLimit) isExceeding = true;
          }

          if (isExceeding) {
            exceededParams.push(configKey);
            const wholeNumbers = ["EC", "NO3", "TH", "Ca", "SO4", "Mg", "Cl"];
            const decimalPlaces = wholeNumbers.includes(configKey) ? 0 : 4;
            exceededDetails.push(`${configKey} (${val.toFixed(decimalPlaces)} ${config.unit})`);
            if (heavyMetalsList.includes(configKey)) hasHeavyMetal = true;
          }
        });

        if (exceededParams.length > 1) {
          let contaminationType = "Multi Parameter Contamination";
          if (hasHeavyMetal && exceededParams.includes("EC")) {
            contaminationType = "Severe salinity & trace metal contamination";
          } else if (hasHeavyMetal) {
            contaminationType = "Heavy/Trace metal contamination";
          } else if (exceededParams.includes("NO3") && exceededParams.includes("TH")) {
            contaminationType = "Nutrient & hardness contamination";
          } else if (exceededParams.includes("EC") || exceededParams.includes("Cl")) {
            contaminationType = "Severe Salinity / Brackishness";
          }

          exceedingLocationsList.push({
            block: String(row[headers.block || ""] || "-").trim(),
            location: String(row[headers.location || ""] || "-").trim(),
            lat: String(row[headers.latitude || ""] || "-").trim(),
            lon: String(row[headers.longitude || ""] || "-").trim(),
            count: exceededParams.length,
            names: exceededParams.join(", "),
            details: exceededDetails.join(", "),
            type: contaminationType,
            rawParams: exceededParams,
          });
        }
      });

      exceedingLocationsList.sort((a, b) => b.count - a.count);

      const locationTableHTML = exceedingLocationsList
        .map(
          (item) => `
          <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
            <td style="padding: 10px; color: #334155; font-weight: 500; border: 1px solid #e2e8f0;">${item.block}</td>
            <td style="padding: 10px; color: #1e293b; font-weight: bold; border: 1px solid #e2e8f0;">${item.location}</td>
            <td style="padding: 10px; color: #64748b; font-size: 11px; border: 1px solid #e2e8f0;">${item.lat}</td>
            <td style="padding: 10px; color: #64748b; font-size: 11px; border: 1px solid #e2e8f0;">${item.lon}</td>
            <td style="padding: 10px; text-align: center; color: #e11d48; font-weight: 900; border: 1px solid #e2e8f0;">${item.count}</td>
            <td style="padding: 10px; color: #475569; font-weight: 500; border: 1px solid #e2e8f0;">${item.names}</td>
            <td style="padding: 10px; color: #64748b; font-size: 11px; border: 1px solid #e2e8f0;">${item.details}</td>
            <td style="padding: 10px; color: #312e81; font-weight: 600; font-size: 11.5px; border: 1px solid #e2e8f0;">${item.type}</td>
          </tr>
        `
        )
        .join("");

      // 7. Remedial table mapper
      const remedialTableHTML = exceedingLocationsList
        .map((item) => {
          const remedies = new Set<string>();
          item.rawParams.forEach((pKey) => {
            const remediesArr = ALL_REMEDIAL_MEASURES[pKey] || ALL_REMEDIAL_MEASURES["default"];
            remediesArr.forEach((r) => remedies.add(r.method));
          });

          if (item.rawParams.includes("NO3")) remedies.add("Controlled fertilizer application");
          if (item.rawParams.includes("NO3") || item.rawParams.includes("Cl")) remedies.add("Sanitation improvement");
          if (item.count > 3) remedies.add("Alternate drinking water supply");
          remedies.add("Periodic WQ monitoring");

          if (item.rawParams.includes("EC") || item.rawParams.includes("TH")) {
            remedies.add("Artificial recharge structures");
            remedies.add("Domestic softening systems");
          }
          if (item.type.includes("metal")) {
            remedies.add("Specific media filtration");
          }

          const remedyArr = Array.from(remedies).filter((r) => r !== "Reverse Osmosis (RO)");
          if (Array.from(remedies).includes("Reverse Osmosis (RO)")) {
            remedyArr.unshift("RO treatment systems");
          }

          return `
          <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
            <td style="padding: 10px; color: #1e293b; font-weight: bold; border: 1px solid #e2e8f0;">${item.block}</td>
            <td style="padding: 10px; color: #334155; font-weight: bold; border: 1px solid #e2e8f0;">${item.location}</td>
            <td style="padding: 10px; color: #64748b; font-size: 11px; border: 1px solid #e2e8f0;">${item.lat}</td>
            <td style="padding: 10px; color: #64748b; font-size: 11px; border: 1px solid #e2e8f0;">${item.lon}</td>
            <td style="padding: 10px; color: #e11d48; font-weight: 600; border: 1px solid #e2e8f0;">${item.names}</td>
            <td style="padding: 10px; color: #475569; border: 1px solid #e2e8f0;">${item.type.replace("Severe ", "")}</td>
            <td style="padding: 10px; color: #047857; font-weight: 500; border: 1px solid #e2e8f0;">${remedyArr.join(", ")}</td>
          </tr>
        `;
        })
        .join("");

      // Top blocks
      const blockCounts: Record<string, number> = {};
      exceedingLocationsList.forEach((item) => {
        if (item.block && item.block !== "-") {
          blockCounts[item.block] = (blockCounts[item.block] || 0) + 1;
        }
      });
      const topBlocksStr = Object.entries(blockCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map((e) => e[0])
        .join(", ");

      let textPara3 = "";
      if (exceedingLocationsList.length > 0) {
        const topLocs = exceedingLocationsList.slice(0, 5).map((l) => l.location).join(", ");
        textPara3 += `Among highly affected areas, <strong>${
          topBlocksStr || "several blocks"
        }</strong> were identified as priority hot-zones requiring urgent attention. Severe contamination elements were observed in locations like: <strong>${topLocs}</strong>. `;
      } else {
        textPara3 += "Overall, the examined region demonstrates excellent compliance with national drinking water standards across all monitored habitations, with zero significant multi-parameter exceedances. ";
      }

      let textPara4 = "The study recommends continuous groundwater quality monitoring, artificial recharge and rainwater harvesting, controlled fertilizer application, sanitation improvement, and installation of suitable treatment systems such as RO and softening units. Public awareness and sustainable groundwater management practices are essential to ensure long-term drinking water security in the district.";

      // --- Major Ion and Hydrogeochemical Facies (Piper Plot) Section ---
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

      const ION_ALIASES: Record<string, string[]> = {
        Ca: ["ca", "calcium"],
        Mg: ["mg", "magnesium"],
        Na: ["na", "sodium"],
        K: ["k", "potassium"],
        Cl: ["cl", "chloride"],
        SO4: ["so4", "sulphate", "sulfate"],
        HCO3: ["hco3", "bicarbonate"],
        CO3: ["co3", "carbonate"],
        EC: ["ec", "conductivity", "electrical conductivity", "electrical_conductivity"],
        TDS: ["tds", "total dissolved solids", "dissolved solids", "total_dissolved_solids"],
        Location: ["location", "village", "site", "name", "site name", "site_name"]
      };

      const localMapping: Record<string, string> = {};
      if (filtered.length > 0) {
        const rowHeaders = Object.keys(filtered[0]);
        Object.entries(ION_ALIASES).forEach(([colId, aliases]) => {
          if (colId === "Location" && headers.location) {
            localMapping.Location = headers.location;
            return;
          }
          const mappedCol = Object.keys(headerMap).find(k => headerMap[k] === colId);
          if (mappedCol) {
            localMapping[colId] = mappedCol;
            return;
          }

          const matched = rowHeaders.find(h => {
            return aliases.some(alias => {
              try {
                return new RegExp(`\\b${alias}\\b`, "i").test(h);
              } catch {
                return h.toLowerCase() === alias.toLowerCase();
              }
            });
          });
          if (matched) {
            localMapping[colId] = matched;
          }
        });
      }

      const processedFaciesSamples = filtered.map((row, index) => {
        const getMappedNum = (id: string): number | null => {
          const key = localMapping[id];
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
        const ecVal = getMappedNum("EC");
        let tdsVal = getMappedNum("TDS");
        if (tdsVal === null && ecVal !== null) {
          tdsVal = ecVal * 0.65;
        }

        const locName = (localMapping.Location && row[localMapping.Location]) ? String(row[localMapping.Location]).trim() : `Site ${index + 1}`;
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

        const stateCol = headers && headers.state ? headers.state : null;
        const rawStateVal = stateCol && row[stateCol] !== undefined && row[stateCol] !== null ? String(row[stateCol]).trim() : "";

        const blockCol = headers && headers.block ? headers.block : null;
        const blockVal = blockCol && row[blockCol] !== undefined && row[blockCol] !== null ? String(row[blockCol]).trim() : "-";

        const aquiferCol = headers && headers.aquifer ? headers.aquifer : null;
        const aquiferVal = aquiferCol && row[aquiferCol] !== undefined && row[aquiferCol] !== null ? String(row[aquiferCol]).trim() : "-";

        const hasSAR = ca !== null && mg !== null && na !== null;
        const sar = hasSAR && (meq.Ca + meq.Mg > 0) ? (meq.Na / Math.sqrt((meq.Ca + meq.Mg) / 2)) : null;

        const hasRSC = ca !== null && mg !== null && hco3 !== null;
        const rsc = hasRSC ? ((meq.HCO3 + meq.CO3) - (meq.Ca + meq.Mg)) : null;

        const hasGibbs = tdsVal !== null && tdsVal > 0 && na !== null && ca !== null && cl !== null && hco3 !== null;
        const gibbsCation = hasGibbs ? (meq.Na + meq.K) / (meq.Na + meq.K + meq.Ca || 1) : null;
        const gibbsAnion = hasGibbs ? meq.Cl / (meq.Cl + meq.HCO3 || 1) : null;

        return {
          locName,
          block: blockVal,
          aquifer: aquiferVal,
          meqPerc,
          facies,
          hasFacies,
          stateVal: rawStateVal,
          sar,
          rsc,
          hasSAR,
          hasRSC,
          ecVal,
          tdsVal,
          hasGibbs,
          gibbsCation,
          gibbsAnion
        };
      });

      const validFaciesSamples = processedFaciesSamples.filter(s => s.hasFacies);
      const totalValidFacies = validFaciesSamples.length;

      const faciesCounts: Record<string, number> = {
        "Ca-Mg-HCO3 Type": 0,
        "Mixed Type A": 0,
        "Mixed Type B": 0,
        "Na-Cl Type": 0,
        "Na-HCO3 Type": 0,
        "Ca-Cl Type": 0,
        "Unknown": 0
      };

      validFaciesSamples.forEach(s => {
        if (faciesCounts[s.facies] !== undefined) {
          faciesCounts[s.facies]++;
        } else {
          faciesCounts["Unknown"]++;
        }
      });

      const getFaciesPct = (count: number) => totalValidFacies > 0 ? ((count / totalValidFacies) * 100).toFixed(2) : "0.00";

      const pCaHCO3Val = parseFloat(getFaciesPct(faciesCounts["Ca-Mg-HCO3 Type"]));
      const pMixedVal = parseFloat(getFaciesPct(faciesCounts["Mixed Type A"] + faciesCounts["Mixed Type B"]));
      const pNaClVal = parseFloat(getFaciesPct(faciesCounts["Na-Cl Type"]));
      const pNaHCO3Val = parseFloat(getFaciesPct(faciesCounts["Na-HCO3 Type"]));
      const pCaCl2Val = parseFloat(getFaciesPct(faciesCounts["Ca-Cl Type"]));

      const hasAquiferCol = !!(headers && headers.aquifer);

      const uniqueBlocks = hasAquiferCol
        ? Array.from(new Set(validFaciesSamples.map(s => s.aquifer).filter(a => a && a !== "-")))
        : Array.from(new Set(validFaciesSamples.map(s => s.block).filter(b => b && b !== "-")));

      const blockColorPalette = [
        "#2563eb", // Blue
        "#ea580c", // Orange
        "#16a34a", // Green
        "#9333ea", // Purple
        "#dc2626", // Red
        "#0891b2", // Cyan
        "#db2777", // Pink
        "#ca8a04", // Dark Yellow
        "#4f46e5", // Indigo
        "#0d9488", // Teal
        "#e11d48", // Rose
        "#475569"  // Slate
      ];
      const blockColorMap: Record<string, string> = {};
      uniqueBlocks.forEach((block, idx) => {
        blockColorMap[block] = blockColorPalette[idx % blockColorPalette.length];
      });

      const getBlockId = (blockName: string) => "block-" + blockName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();

      const getDefsMarkup = () => {
        let markup = "";
        Object.entries(blockColorMap).forEach(([blockName, color]) => {
          const bId = getBlockId(blockName);
          const darker = darkenColor(color, 35);
          markup += `
            <radialGradient id="bubble-${bId}" cx="35%" cy="35%" r="70%" fx="35%" fy="35%">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
              <stop offset="25%" stop-color="${color}" stop-opacity="0.95" />
              <stop offset="85%" stop-color="${darker}" stop-opacity="1" />
              <stop offset="100%" stop-color="#000000" stop-opacity="0.35" />
            </radialGradient>
          `;
        });
        return markup;
      };

      const generateBlockLegendHTML = () => {
        if (uniqueBlocks.length === 0) return "";
        let itemsHtml = "";
        Object.entries(blockColorMap).forEach(([blockName, color]) => {
          itemsHtml += `
            <div style="display: inline-flex; align-items: center; margin: 4px 10px; font-size: 11px; font-family: 'Inter', Arial, sans-serif;">
              <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: radial-gradient(circle at 3px 3px, #ffffff, ${color} 40%, ${darkenColor(color, 30)}); border: 0.5px solid rgba(0,0,0,0.15); margin-right: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.15);"></span>
              <strong style="color: #475569;">${blockName}</strong>
            </div>
          `;
        });
        const legendLabel = hasAquiferCol ? "Aquifer Type" : "Block";
        return `
          <div style="text-align: center; margin: 12px auto; padding: 10px; border: 1px solid #cbd5e1; border-radius: 12px; background: #f8fafc; max-width: 500px;">
            <p style="margin: 0 0 6px 0; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; font-weight: bold;">Legend: 3D Bubbles Colored by ${legendLabel} (Size: 0.3)</p>
            <div style="display: flex; flex-wrap: wrap; justify-content: center;">
              ${itemsHtml}
            </div>
          </div>
        `;
      };

      const generatePiperDiagramHTML = (title: string, samples: typeof validFaciesSamples) => {
        if (samples.length === 0) {
          return `
            <div style="background-color: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 25px; text-align: center; margin: 20px 0; max-width: 500px; margin-left: auto; margin-right: auto;">
              <p style="font-weight: bold; font-size: 11pt; color: #475569; margin: 0 0 10px 0;">Piper Trilinear Diagram (No Data)</p>
              <p style="font-size: 9.5pt; color: #64748b; line-height: 1.5; max-width: 400px; margin: 0 auto;">
                No samples were found with complete major ionic data in the current selection: <strong>${title}</strong>.
              </p>
            </div>
          `;
        }

        const SQRT3 = Math.sqrt(3);
        const H_val = (100 * SQRT3) / 2;
        const tx = (x: number) => x + 40;
        const ty = (y: number) => 230 - y;
        const gridLineColor = "#cbd5e1";
        const frameColor = "#0f172a";

        let gridLines = "";
        for (let i = 20; i < 100; i += 20) {
          const y = (i * SQRT3) / 2;
          const strokeProps = `stroke="${gridLineColor}" stroke-dasharray="2 2" stroke-width="0.8" fill="none"`;
          gridLines += `<line x1="${tx(0.5 * i)}" y1="${ty(y)}" x2="${tx(100 - 0.5 * i)}" y2="${ty(y)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(i)}" y1="${ty(0)}" x2="${tx(50 + 0.5 * i)}" y2="${ty(((100 - i) * SQRT3) / 2)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(100 - i)}" y1="${ty(0)}" x2="${tx(0.5 * (100 - i))}" y2="${ty(((100 - i) * SQRT3) / 2)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(120 + 0.5 * i)}" y1="${ty(y)}" x2="${tx(220 - 0.5 * i)}" y2="${ty(y)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(120 + i)}" y1="${ty(0)}" x2="${tx(170 + 0.5 * i)}" y2="${ty(((100 - i) * SQRT3) / 2)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(220 - i)}" y1="${ty(0)}" x2="${tx(120 + 0.5 * (100 - i))}" y2="${ty(((100 - i) * SQRT3) / 2)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(110 - 0.5 * i)}" y1="${ty(10 * SQRT3 + 0.5 * i * SQRT3)}" x2="${tx(160 - 0.5 * i)}" y2="${ty(60 * SQRT3 + 0.5 * i * SQRT3)}" ${strokeProps} />`;
          gridLines += `<line x1="${tx(110 + 0.5 * i)}" y1="${ty(10 * SQRT3 + 0.5 * i * SQRT3)}" x2="${tx(60 + 0.5 * i)}" y2="${ty(60 * SQRT3 + 0.5 * i * SQRT3)}" ${strokeProps} />`;
        }

        let pointsMarkup = "";
        const pointRadius = 3.0; // default size 0.3 equivalent radius

        samples.forEach((d) => {
          const ca = d.meqPerc.Ca || 0;
          const mg = d.meqPerc.Mg || 0;
          const nak = (d.meqPerc.Na || 0) + (d.meqPerc.K || 0);
          const cl = d.meqPerc.Cl || 0;
          const so4 = d.meqPerc.SO4 || 0;
          const hco3 = (d.meqPerc.HCO3 || 0) + (d.meqPerc.CO3 || 0);

          if (ca + mg + nak === 0 || cl + so4 + hco3 === 0) return;

          const xc = nak + 0.5 * mg;
          const yc = (mg * SQRT3) / 2;
          const xa = 120 + cl + 0.5 * so4;
          const ya = (so4 * SQRT3) / 2;
          const xd = 0.5 * (xa + xc) + (ya - yc) / (2 * SQRT3);
          const yd = SQRT3 * (xd - xc) + yc;

          const groupVal = hasAquiferCol ? (d.aquifer || "-") : (d.block || "-");
          const blockId = getBlockId(groupVal);
          const fillVal = `url(#bubble-${blockId})`;

          pointsMarkup += `
            <circle cx="${tx(xc)}" cy="${ty(yc)}" r="${pointRadius}" fill="${fillVal}" filter="url(#bubble-shadow)" stroke="#ffffff" stroke-width="0.3" />
            <circle cx="${tx(xa)}" cy="${ty(ya)}" r="${pointRadius}" fill="${fillVal}" filter="url(#bubble-shadow)" stroke="#ffffff" stroke-width="0.3" />
            <circle cx="${tx(xd)}" cy="${ty(yd)}" r="${pointRadius}" fill="${fillVal}" filter="url(#bubble-shadow)" stroke="#ffffff" stroke-width="0.3" />
          `;
        });

        const svgMarkup = `
          <svg viewBox="-20 -25 340 310" width="550" height="480" style="background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); border: 1.5px solid #cbd5e1; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05); font-family: 'Inter', Arial, sans-serif; margin: 0 auto; display: block;" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="3d-emboss" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="blur" />
                <feSpecularLighting in="blur" surfaceScale="2" specularConstant="1.2" specularExponent="16" lighting-color="#ffffff" result="spec">
                  <feDistantLight azimuth="225" elevation="45" />
                </feSpecularLighting>
                <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut" />
                <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />
              </filter>
              <filter id="bubble-shadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0.5" dy="1.0" stdDeviation="0.6" flood-opacity="0.3" />
              </filter>
              <filter id="glass-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="1.5" dy="3.5" stdDeviation="2" flood-color="#1e293b" flood-opacity="0.12" />
              </filter>
              <linearGradient id="cation-glass" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#eff6ff" stop-opacity="0.85" />
                <stop offset="50%" stop-color="#ffffff" stop-opacity="0.4" />
                <stop offset="100%" stop-color="#dbeafe" stop-opacity="0.85" />
              </linearGradient>
              <linearGradient id="anion-glass" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#fff1f2" stop-opacity="0.85" />
                <stop offset="50%" stop-color="#ffffff" stop-opacity="0.4" />
                <stop offset="100%" stop-color="#ffe4e6" stop-opacity="0.85" />
              </linearGradient>
              <linearGradient id="diamond-glass" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#f5f3ff" stop-opacity="0.85" />
                <stop offset="50%" stop-color="#ffffff" stop-opacity="0.4" />
                <stop offset="100%" stop-color="#e0e7ff" stop-opacity="0.85" />
              </linearGradient>
              ${getDefsMarkup()}
            </defs>

            <line x1="${tx(25)}" y1="${ty(H_val / 2)}" x2="${tx(75)}" y2="${ty(H_val / 2)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />
            <line x1="${tx(25)}" y1="${ty(H_val / 2)}" x2="${tx(50)}" y2="${ty(0)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />
            <line x1="${tx(75)}" y1="${ty(H_val / 2)}" x2="${tx(50)}" y2="${ty(0)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />

            <line x1="${tx(145)}" y1="${ty(H_val / 2)}" x2="${tx(195)}" y2="${ty(H_val / 2)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />
            <line x1="${tx(145)}" y1="${ty(H_val / 2)}" x2="${tx(170)}" y2="${ty(0)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />
            <line x1="${tx(195)}" y1="${ty(H_val / 2)}" x2="${tx(170)}" y2="${ty(0)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />

            <line x1="${tx(85)}" y1="${ty(85 * SQRT3)}" x2="${tx(135)}" y2="${ty(85 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />
            <line x1="${tx(85)}" y1="${ty(35 * SQRT3)}" x2="${tx(135)}" y2="${ty(35 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />
            <line x1="${tx(85)}" y1="${ty(85 * SQRT3)}" x2="${tx(110)}" y2="${ty(60 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />
            <line x1="${tx(135)}" y1="${ty(85 * SQRT3)}" x2="${tx(110)}" y2="${ty(60 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />
            <line x1="${tx(85)}" y1="${ty(35 * SQRT3)}" x2="${tx(110)}" y2="${ty(60 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />
            <line x1="${tx(135)}" y1="${ty(35 * SQRT3)}" x2="${tx(110)}" y2="${ty(60 * SQRT3)}" stroke="${frameColor}" stroke-width="1.2" opacity="0.3" />

            <g>${gridLines}</g>

            <path d="M ${tx(0)} ${ty(0)} L ${tx(100)} ${ty(0)} L ${tx(50)} ${ty(H_val)} Z" stroke="${frameColor}" stroke-width="1.2" fill="url(#cation-glass)" filter="url(#glass-shadow)" stroke-linejoin="round" />
            <path d="M ${tx(120)} ${ty(0)} L ${tx(220)} ${ty(0)} L ${tx(170)} ${ty(H_val)} Z" stroke="${frameColor}" stroke-width="1.2" fill="url(#anion-glass)" filter="url(#glass-shadow)" stroke-linejoin="round" />
            <path d="M ${tx(110)} ${ty(10 * SQRT3)} L ${tx(160)} ${ty(60 * SQRT3)} L ${tx(110)} ${ty(110 * SQRT3)} L ${tx(60)} ${ty(60 * SQRT3)} Z" stroke="${frameColor}" stroke-width="1.2" fill="url(#diamond-glass)" filter="url(#glass-shadow)" stroke-linejoin="round" />

            <text transform="translate(${tx(50)}, ${ty(-14)})" text-anchor="middle" font-size="8.5" fill="#1e3a8a" font-weight="bold" filter="url(#3d-emboss)">Ca²⁺</text>
            <text transform="translate(${tx(82)}, ${ty(45)}) rotate(60)" text-anchor="middle" font-size="8.5" fill="#1e3a8a" font-weight="bold" filter="url(#3d-emboss)">Na⁺ + K⁺</text>
            <text transform="translate(${tx(18)}, ${ty(45)}) rotate(-60)" text-anchor="middle" font-size="8.5" fill="#1e3a8a" font-weight="bold" filter="url(#3d-emboss)">Mg²⁺</text>
 
            <text transform="translate(${tx(138)}, ${ty(45)}) rotate(-60)" text-anchor="middle" font-size="8.5" fill="#1e3a8a" font-weight="bold" filter="url(#3d-emboss)">HCO₃⁻ + CO₃²⁻</text>
            <text transform="translate(${tx(170)}, ${ty(-14)})" text-anchor="middle" font-size="8.5" fill="#1e3a8a" font-weight="bold" filter="url(#3d-emboss)">Cl⁻</text>
            <text transform="translate(${tx(202)}, ${ty(45)}) rotate(60)" text-anchor="middle" font-size="8.5" fill="#1e3a8a" font-weight="bold" filter="url(#3d-emboss)">SO₄²⁻</text>

            <text transform="translate(${tx(75)}, ${ty(135)}) rotate(-60)" text-anchor="middle" font-size="8.5" fill="#1e3a8a" font-weight="bold" filter="url(#3d-emboss)">SO₄²⁻ + Cl⁻</text>
            <text transform="translate(${tx(145)}, ${ty(135)}) rotate(60)" text-anchor="middle" font-size="8.5" fill="#1e3a8a" font-weight="bold" filter="url(#3d-emboss)">Ca²⁺ + Mg²⁺</text>

            <g>${pointsMarkup}</g>
          </svg>
        `;

        return `
          <div style="text-align: center; margin-top: 15px; margin-bottom: 20px;">
            <div style="display: inline-block; padding: 15px; border: 1px solid #cbd5e1; border-radius: 16px; background: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
              ${svgMarkup}
            </div>
            ${generateBlockLegendHTML()}
            <p style="text-align: center; font-style: italic; font-size: 11px; margin-top: 6px; color: #475569; font-weight: bold;">
              Figure 2: Piper Trilinear Diagram (3D Block-wise Bubbles) of Groundwater Samples in ${title}
            </p>
          </div>
        `;
      };

      const getSolidColor = (facies: string) => {
        if (facies === "Ca-Mg-HCO3 Type") return "#2563eb"; // Blue
        if (facies === "Mixed Type A") return "#ea580c"; // Orange
        if (facies === "Mixed Type B") return "#8b5cf6"; // Purple
        if (facies === "Na-Cl Type") return "#dc2626"; // Red
        if (facies === "Na-HCO3 Type") return "#ec4899"; // Pink
        if (facies === "Ca-Cl Type") return "#eab308"; // Yellow
        return "#475569"; // Slate
      };

      const generateGibbsDiagramHTML = (type: "cation" | "anion", title: string, samples: any[]): string => {
        const width = 280;
        const height = 360;
        const padding = { left: 45, right: 15, top: 25, bottom: 40 };

        const getX = (ratio: number) => {
          const w = width - padding.left - padding.right;
          return padding.left + ratio * w;
        };
        const getY = (tds: number) => {
          const h = height - padding.top - padding.bottom;
          const logMin = 1; // Log10 of 10
          const logMax = 4.5; // Log10 of ~31620
          const logVal = Math.log10(Math.max(10, tds || 10));
          return padding.top + h - ((logVal - logMin) / (logMax - logMin)) * h;
        };

        // Parallelogram shape as in GibbsDiagrams.tsx:
        const envelopePath = `M ${getX(0.1)} ${getY(5000)} L ${getX(0.9)} ${getY(10000)} L ${getX(0.9)} ${getY(1000)} L ${getX(0.1)} ${getY(10)} L ${getX(0.1)} ${getY(5000)} Z`;

        const gridY = [10, 100, 1000, 10000];
        const gridX = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

        let gridLinesSvg = "";
        gridY.forEach(yVal => {
          const y = getY(yVal);
          gridLinesSvg += `
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#cbd5e1" stroke-width="0.5" stroke-dasharray="2,2" />
            <text x="${padding.left - 6}" y="${y + 3}" font-size="7.5" fill="#475569" text-anchor="end" font-weight="bold">${yVal}</text>
          `;
        });

        gridX.forEach(xVal => {
          const x = getX(xVal);
          gridLinesSvg += `
            <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="#cbd5e1" stroke-width="0.5" stroke-dasharray="2,2" />
            <text x="${x}" y="${height - padding.bottom + 12}" font-size="7.5" fill="#475569" text-anchor="middle" font-weight="bold">${xVal.toFixed(1)}</text>
          `;
        });

        const labelRain = `<text x="${getX(0.15)}" y="${getY(20)}" font-size="8.5" font-weight="bold" fill="#64748b" text-anchor="start" opacity="0.8">Precipitation</text>`;
        const labelWeathering = `<text x="${getX(0.5)}" y="${getY(500)}" font-size="8.5" font-weight="bold" fill="#64748b" text-anchor="middle" opacity="0.8">Rock</text>`;
        const labelEvaporation = `<text x="${getX(0.85)}" y="${getY(8000)}" font-size="8.5" font-weight="bold" fill="#64748b" text-anchor="end" opacity="0.8">Evaporation</text>`;

        let pointsSvg = "";
        samples.forEach(s => {
          const hasGibbs = s.hasGibbs;
          const r = type === "cation" ? (s.gibbsCation ?? s.gibbsCationVal) : (s.gibbsAnion ?? s.gibbsAnionVal);
          const t = s.tdsVal ?? s.tds;
          if (!hasGibbs || r === null || t === null || isNaN(r) || isNaN(t) || t <= 0) return;

          const cx = getX(r);
          const cy = getY(t);
          const groupVal = hasAquiferCol ? (s.aquifer || "-") : (s.block || "-");
          const blockId = getBlockId(groupVal);

          pointsSvg += `
            <circle cx="${cx}" cy="${cy}" r="3.0" fill="url(#bubble-${blockId})" filter="url(#bubble-shadow)" stroke="#ffffff" stroke-width="0.3" />
          `;
        });

        const svg = `
          <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); border: 1.5px solid #cbd5e1; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05); font-family: 'Inter', Arial, sans-serif;" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="3d-emboss" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="blur" />
                <feSpecularLighting in="blur" surfaceScale="2" specularConstant="1.2" specularExponent="16" lighting-color="#ffffff" result="spec">
                  <feDistantLight azimuth="225" elevation="45" />
                </feSpecularLighting>
                <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut" />
                <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />
              </filter>
              <filter id="bubble-shadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0.5" dy="1.0" stdDeviation="0.6" flood-opacity="0.3" />
              </filter>
              ${getDefsMarkup()}
            </defs>
            <text x="${width / 2}" y="15" font-size="9" font-weight="900" fill="#1e3a8a" text-anchor="middle" style="letter-spacing: 0.1em;" filter="url(#3d-emboss)">${title.toUpperCase()}</text>
            
            <!-- Y-Axis Label -->
            <text x="12" y="${height / 2}" font-size="8" font-weight="900" fill="#64748b" transform="rotate(-90 12 ${height / 2})" text-anchor="middle" style="letter-spacing: 0.1em;">TDS (MG/L)</text>
            
            <!-- X-Axis Label -->
            <text x="${width / 2}" y="${height - 12}" font-size="8" font-weight="900" fill="#64748b" text-anchor="middle" style="letter-spacing: 0.1em;">${type === "cation" ? "NA+ / (NA+ + CA2+)" : "CL- / (CL- + HCO3-)"}</text>
            
            <!-- Envelope -->
            <path d="${envelopePath}" fill="#000000" fill-opacity="0.02" stroke="#000000" stroke-opacity="0.08" stroke-dasharray="4" stroke-width="1.5" />
            
            <!-- Grid and Labels -->
            ${gridLinesSvg}
            ${labelRain}
            ${labelWeathering}
            ${labelEvaporation}
            
            <!-- Axis Borders -->
            <rect x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${height - padding.top - padding.bottom}" fill="none" stroke="#94a3b8" stroke-width="1.5" />
            
            <!-- Plotted Points -->
            ${pointsSvg}
          </svg>
        `;
        return svg;
      };

      const generateUsslDiagramHTML = (samples: any[]): string => {
        const width = 450;
        const height = 360;
        const padding = { left: 45, right: 15, top: 25, bottom: 40 };

        const getX = (ec: number) => {
          const w = width - padding.left - padding.right;
          const logMin = Math.log10(100);
          const logMax = Math.log10(10000);
          const logVal = Math.log10(Math.max(100, Math.min(10000, ec || 100)));
          return padding.left + ((logVal - logMin) / (logMax - logMin)) * w;
        };

        const getY = (sar: number) => {
          const h = height - padding.top - padding.bottom;
          const maxSar = 32;
          const val = Math.min(maxSar, Math.max(0, sar || 0));
          return padding.top + h - (val / maxSar) * h;
        };

        const s1s2 = (ec: number) => 18.8515824 - 4.4257912 * Math.log10(ec);
        const s2s3 = (ec: number) => 31.4031902 - 6.6827811 * Math.log10(ec);
        const s3s4 = (ec: number) => 43.675205 - 8.8394965 * Math.log10(ec);

        let gridLinesSvg = "";

        // Vertical borders at EC 250, 750, 2250
        const ecBorders = [250, 750, 2250];
        ecBorders.forEach((border) => {
          const x = getX(border);
          gridLinesSvg += `
            <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4" />
          `;
        });

        // Curves
        const ecs = Array.from({ length: 100 }, (_, i) => 100 + i * 100);
        const curve1Path = ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s1s2(ec))}`).join(" ");
        const curve2Path = ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s2s3(ec))}`).join(" ");
        const curve3Path = ecs.map((ec, i) => `${i === 0 ? "M" : "L"} ${getX(ec)} ${getY(s3s4(ec))}`).join(" ");

        const curvesSvg = `
          <path d="${curve1Path}" fill="none" stroke="#cbd5e1" stroke-width="1.5" />
          <path d="${curve2Path}" fill="none" stroke="#cbd5e1" stroke-width="1.5" />
          <path d="${curve3Path}" fill="none" stroke="#cbd5e1" stroke-width="1.5" />
        `;

        // Category labels inside zones
        const xCentroids = [
          { id: "C1", val: Math.pow(10, (Math.log10(100) + Math.log10(250)) / 2) },
          { id: "C2", val: Math.pow(10, (Math.log10(250) + Math.log10(750)) / 2) },
          { id: "C3", val: Math.pow(10, (Math.log10(750) + Math.log10(2250)) / 2) },
          { id: "C4", val: Math.pow(10, (Math.log10(2250) + Math.log10(10000)) / 2) },
        ];

        let labelsSvg = "";
        xCentroids.forEach((xC) => {
          labelsSvg += `
            <g opacity="0.6">
              <text x="${getX(xC.val)}" y="${getY(s1s2(xC.val) / 2)}" text-anchor="middle" font-size="8" fill="#64748b" font-weight="bold">${xC.id}-S1</text>
              <text x="${getX(xC.val)}" y="${getY((s1s2(xC.val) + s2s3(xC.val)) / 2)}" text-anchor="middle" font-size="8" fill="#64748b" font-weight="bold">${xC.id}-S2</text>
              <text x="${getX(xC.val)}" y="${getY((s2s3(xC.val) + s3s4(xC.val)) / 2)}" text-anchor="middle" font-size="8" fill="#64748b" font-weight="bold">${xC.id}-S3</text>
              <text x="${getX(xC.val)}" y="${getY((s3s4(xC.val) + 32) / 2)}" text-anchor="middle" font-size="8" fill="#64748b" font-weight="bold">${xC.id}-S4</text>
            </g>
          `;
        });

        // Grid ticks and values
        const ticksX = [100, 250, 750, 2250, 5000, 10000];
        ticksX.forEach(tick => {
          const x = getX(tick);
          gridLinesSvg += `
            <line x1="${x}" y1="${height - padding.bottom}" x2="${x}" y2="${height - padding.bottom + 5}" stroke="#94a3b8" stroke-width="1.5" />
            <text x="${x}" y="${height - padding.bottom + 15}" font-size="8" fill="#64748b" font-weight="bold" text-anchor="middle">${tick}</text>
          `;
        });

        const ticksY = [0, 10, 20, 30];
        ticksY.forEach(tick => {
          const y = getY(tick);
          gridLinesSvg += `
            <line x1="${padding.left - 5}" y1="${y}" x2="${padding.left}" y2="${y}" stroke="#94a3b8" stroke-width="1.5" />
            <text x="${padding.left - 10}" y="${y + 3}" font-size="8" fill="#64748b" font-weight="bold" text-anchor="end">${tick}</text>
          `;
        });

        // Plotted points
        let pointsSvg = "";
        samples.forEach(s => {
          const ec = s.ecVal ?? s.ec;
          const sar = s.sar;
          if (ec === null || sar === null || isNaN(ec) || isNaN(sar)) return;

          const cx = getX(ec);
          const cy = getY(sar);
          const groupVal = hasAquiferCol ? (s.aquifer || "-") : (s.block || "-");
          const blockId = getBlockId(groupVal);

          pointsSvg += `
            <circle cx="${cx}" cy="${cy}" r="3.0" fill="url(#bubble-${blockId})" filter="url(#bubble-shadow)" stroke="#ffffff" stroke-width="0.3" />
          `;
        });

        const svg = `
          <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); border: 1.5px solid #cbd5e1; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05); font-family: 'Inter', Arial, sans-serif;" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="3d-emboss" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="blur" />
                <feSpecularLighting in="blur" surfaceScale="2" specularConstant="1.2" specularExponent="16" lighting-color="#ffffff" result="spec">
                  <feDistantLight azimuth="225" elevation="45" />
                </feSpecularLighting>
                <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut" />
                <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />
              </filter>
              <filter id="bubble-shadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0.5" dy="1.0" stdDeviation="0.6" flood-opacity="0.3" />
              </filter>
              ${getDefsMarkup()}
            </defs>
            <text x="${width / 2}" y="15" font-size="9.5" font-weight="900" fill="#1e3a8a" text-anchor="middle" style="letter-spacing: 0.1em;" filter="url(#3d-emboss)">USSL CLASSIFICATION MATRIX</text>
            
            <!-- Y-Axis Label -->
            <text x="12" y="${height / 2}" font-size="8" font-weight="900" fill="#64748b" transform="rotate(-90 12 ${height / 2})" text-anchor="middle" style="letter-spacing: 0.1em;">SAR (SODIUM ADSORPTION RATIO)</text>
            
            <!-- X-Axis Label -->
            <text x="${width / 2}" y="${height - 12}" font-size="8" font-weight="900" fill="#64748b" text-anchor="middle" style="letter-spacing: 0.1em;">EC (EC, &mu;S/CM)</text>
            
            <!-- Grid and curves -->
            ${gridLinesSvg}
            ${curvesSvg}
            ${labelsSvg}
            
            <!-- Axis Box -->
            <rect x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${height - padding.top - padding.bottom}" fill="none" stroke="#94a3b8" stroke-width="1.5" />
            
            <!-- Plotted points -->
            ${pointsSvg}
          </svg>
        `;
        return svg;
      };

      let dominantFaciesName = "Unknown";
      let dominantFaciesPct = 0;
      let maxCount = -1;
      Object.entries(faciesCounts).forEach(([fac, count]) => {
        if (fac !== "Unknown" && count > maxCount) {
          maxCount = count;
          dominantFaciesName = fac;
        }
      });
      if (totalValidFacies > 0) {
        dominantFaciesPct = (maxCount / totalValidFacies) * 100;
      }

      let faciesInterpretationText = "";
      if (dominantFaciesName === "Ca-Mg-HCO3 Type") {
        faciesInterpretationText = `The dominant hydrochemical facies in ${regionName} is the <strong>Ca-Mg-HCO₃ Type</strong> (representing <strong>${dominantFaciesPct.toFixed(1)}%</strong> of samples). This indicates that groundwater in the region is primarily characterized by temporary hardness, which is typically associated with the dissolution of carbonate minerals (like calcite and dolomite) and is representative of active recharge zones containing fresh, young groundwater.`;
      } else if (dominantFaciesName === "Mixed Type A" || dominantFaciesName === "Mixed Type B") {
        faciesInterpretationText = `The dominant hydrochemical facies in ${regionName} is the <strong>Mixed Type</strong> (representing <strong>${dominantFaciesPct.toFixed(1)}%</strong> of samples). This represents a transitional groundwater zone where no single cation-anion pair is completely dominant. This mixed composition typically results from multiple geological processes including rock-water interaction, mineral dissolution, and mixing of fresh recharge with saline or agricultural runoff.`;
      } else if (dominantFaciesName === "Na-Cl Type") {
        faciesInterpretationText = `The dominant hydrochemical facies in ${regionName} is the <strong>Na-Cl Type</strong> (representing <strong>${dominantFaciesPct.toFixed(1)}%</strong> of samples). This signature is characteristic of permanent salinity and mineral dissolution. It indicates high sodium and chloride levels in groundwater, which usually points to salt-water intrusion, intense evaporation in arid/semi-arid regions, or long-term deep aquifer mineralization processes.`;
      } else if (dominantFaciesName === "Na-HCO3 Type") {
        faciesInterpretationText = `The dominant hydrochemical facies in ${regionName} is the <strong>Na-HCO₃ Type</strong> (representing <strong>${dominantFaciesPct.toFixed(1)}%</strong> of samples). This alkali-bicarbonate signature indicates significant cation exchange processes where calcium and magnesium ions in groundwater have been replaced by sodium ions on clay minerals, typical of deeper aquifers or long residence-time water.`;
      } else if (dominantFaciesName === "Ca-Cl Type") {
        faciesInterpretationText = `The dominant hydrochemical facies in ${regionName} is the <strong>Ca-Cl Type</strong> (representing <strong>${dominantFaciesPct.toFixed(1)}%</strong> of samples). This reflects high permanent hardness and salinity, often arising from anthropogenic industrial effluents, sewage disposal, or advanced geological alteration in dry zones.`;
      } else {
        faciesInterpretationText = `A variety of hydrochemical signatures are active in ${regionName}, indicating a complex geological setting where multiple chemical facies coexist without a singular dominant profile.`;
      }

      const sarSamples = processedFaciesSamples.filter((s) => s.hasSAR && s.sar !== null);
      const totalSARSamples = sarSamples.length;
      const rscSamples = processedFaciesSamples.filter((s) => s.hasRSC && s.rsc !== null);
      const totalRSCSamples = rscSamples.length;

      let sarHTML = "";
      if (totalSARSamples > 0) {
        let s1Count = 0;
        let s2Count = 0;
        let s3Count = 0;
        let s4Count = 0;
        sarSamples.forEach((s) => {
          const v = s.sar!;
          if (v < 10) s1Count++;
          else if (v <= 18) s2Count++;
          else if (v <= 26) s3Count++;
          else s4Count++;
        });

        const s1Pct = (s1Count / totalSARSamples) * 100;
        const s2Pct = (s2Count / totalSARSamples) * 100;
        const s3Pct = (s3Count / totalSARSamples) * 100;
        const s4Pct = (s4Count / totalSARSamples) * 100;

        const sarDonutDataPoints = [
          ...(s1Count > 0 ? [{ name: "S1: Excellent (<10)", y: s1Count, color: "#10b981" }] : []),
          ...(s2Count > 0 ? [{ name: "S2: Medium (10-18)", y: s2Count, color: "#3b82f6" }] : []),
          ...(s3Count > 0 ? [{ name: "S3: High (18-26)", y: s3Count, color: "#f59e0b" }] : []),
          ...(s4Count > 0 ? [{ name: "S4: Very High (>26)", y: s4Count, color: "#ef4444" }] : []),
        ];

        let sarDonutBase64 = "";
        try {
          sarDonutBase64 = await generateParamDonutChart(`Sodium Adsorption Ratio (SAR) Range Distribution`, sarDonutDataPoints, false);
        } catch (_) {}

        sarHTML = `
          <div style="background-color: transparent; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; border-left: 4px solid #4f46e5; margin-bottom: 20px;">
            <h4 style="font-weight: bold; color: #1e293b; font-size: 15px; margin: 0 0 10px 0;">Sodium Adsorption Ratio (SAR) Alkali Hazard</h4>
            <p style="color: #475569; line-height: 1.5; font-size: 13.5px; margin-bottom: 15px;">
              SAR assesses the sodium hazard of irrigation water. Water with high SAR can break down soil physical structure, restricting water infiltration and aeration.
              Based on the analysis of <strong>${totalSARSamples}</strong> samples:
            </p>
            <ul style="color: #475569; font-size: 13px; line-height: 1.6; padding-left: 20px; margin-bottom: 15px;">
              <li><strong>S1 (Excellent: &lt;10)</strong>: <strong>${s1Count} samples (${s1Pct.toFixed(1)}%)</strong> - Completely safe for all crops and soil types.</li>
              <li><strong>S2 (Medium: 10-18)</strong>: <strong>${s2Count} samples (${s2Pct.toFixed(1)}%)</strong> - Appreciable hazard in clay/fine-textured soils.</li>
              <li><strong>S3 (High: 18-26)</strong>: <strong>${s3Count} samples (${s3Pct.toFixed(1)}%)</strong> - High risk, requires advanced soil treatment and high leaching.</li>
              <li><strong>S4 (Very High: &gt;26)</strong>: <strong>${s4Count} samples (${s4Pct.toFixed(1)}%)</strong> - Severely hazardous and generally unsuitable for irrigation.</li>
            </ul>
            ${
              sarDonutBase64
                ? `<div style="text-align: center; margin-top: 15px;"><img src="${sarDonutBase64}" style="max-height: 250px; max-width: 100%; border-radius: 8px; display: block; margin: 0 auto;" alt="SAR Chart" /></div>`
                : ""
            }
          </div>
        `;
      }

      let rscHTML = "";
      if (totalRSCSamples > 0) {
        let rscExcellentCount = 0;
        let rscAcceptableCount = 0;
        let rscUnsuitableCount = 0;
        rscSamples.forEach((s) => {
          const v = s.rsc!;
          if (v < 1.25) rscExcellentCount++;
          else if (v <= 2.5) rscAcceptableCount++;
          else rscUnsuitableCount++;
        });

        const rscExPct = (rscExcellentCount / totalRSCSamples) * 100;
        const rscAcPct = (rscAcceptableCount / totalRSCSamples) * 100;
        const rscUnPct = (rscUnsuitableCount / totalRSCSamples) * 100;

        const rscDonutDataPoints = [
          ...(rscExcellentCount > 0 ? [{ name: "Excellent (<1.25 meq/L)", y: rscExcellentCount, color: "#10b981" }] : []),
          ...(rscAcceptableCount > 0 ? [{ name: "Acceptable (1.25-2.5 meq/L)", y: rscAcceptableCount, color: "#f59e0b" }] : []),
          ...(rscUnsuitableCount > 0 ? [{ name: "Unsuitable (>2.5 meq/L)", y: rscUnsuitableCount, color: "#ef4444" }] : []),
        ];

        let rscDonutBase64 = "";
        try {
          rscDonutBase64 = await generateParamDonutChart(`Residual Sodium Carbonate (RSC) Distribution`, rscDonutDataPoints, false);
        } catch (_) {}

        rscHTML = `
          <div style="background-color: transparent; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; border-left: 4px solid #06b6d4; margin-bottom: 20px;">
            <h4 style="font-weight: bold; color: #1e293b; font-size: 15px; margin: 0 0 10px 0;">Residual Sodium Carbonate (RSC) Alkali Hazard</h4>
            <p style="color: #475569; line-height: 1.5; font-size: 13.5px; margin-bottom: 15px;">
              RSC measures the relative excess of carbonate and bicarbonate ions over calcium and magnesium. High RSC leads to bicarbonate precipitation of calcium and magnesium, enhancing exchangeable sodium and soil alkalization.
              Based on the analysis of <strong>${totalRSCSamples}</strong> samples:
            </p>
            <ul style="color: #475569; font-size: 13px; line-height: 1.6; padding-left: 20px; margin-bottom: 15px;">
              <li><strong>Safe (&lt;1.25 meq/L)</strong>: <strong>${rscExcellentCount} samples (${rscExPct.toFixed(1)}%)</strong> - Fully suitable for ongoing irrigation.</li>
              <li><strong>Marginal (1.25 - 2.5 meq/L)</strong>: <strong>${rscAcceptableCount} samples (${rscAcPct.toFixed(1)}%)</strong> - Requires careful leaching and gypsum application.</li>
              <li><strong>Unsuitable (&gt;2.5 meq/L)</strong>: <strong>${rscUnsuitableCount} samples (${rscUnPct.toFixed(1)}%)</strong> - Severe alkali threat, dangerous for soil quality and crop yields.</li>
            </ul>
            ${
              rscDonutBase64
                ? `<div style="text-align: center; margin-top: 15px;"><img src="${rscDonutBase64}" style="max-height: 250px; max-width: 100%; border-radius: 8px; display: block; margin: 0 auto;" alt="RSC Chart" /></div>`
                : ""
            }
          </div>
        `;
      }

      let faciesAndSuitabilityHTML = "";
      if (totalValidFacies > 0) {
        const piperPlotHTML = generatePiperDiagramHTML(regionName, validFaciesSamples);
        faciesAndSuitabilityHTML = `
          <!-- Hydrochemical Facies & Agricultural Suitability Section -->
          <div style="margin-bottom: 40px; page-break-inside: avoid;">
            <h3 style="font-size: 20px; font-weight: 900; color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin: 0 0 20px 0;">Hydrogeochemical Facies & Agricultural Suitability</h3>
            
            <p style="color: #475569; font-size: 14.5px; line-height: 1.6; margin-bottom: 15px;">
              Hydrogeochemical trilinear plots (Piper diagrams) classify the chemical facies of groundwater, establishing its dominant ion combinations and revealing rock-water pathways.
            </p>

            ${piperPlotHTML}

            <div style="background-color: transparent; border: 1px solid #cbd5e1; border-radius: 12px; padding: 20px; margin-bottom: 25px; line-height: 1.6; font-size: 14px; text-align: justify; color: #334155;">
              <h4 style="font-weight: bold; color: #1e3a8a; margin-top: 0; margin-bottom: 10px; font-size: 15px;">Hydrochemical Interpretation</h4>
              <p style="margin: 0;">${faciesInterpretationText}</p>
            </div>

            <!-- Facies Distribution Table -->
            <div style="overflow-x: auto; border: 1px solid #cbd5e1; border-radius: 12px; margin-bottom: 30px;">
              <table style="width: 100%; border-collapse: collapse; text-align: left; background-color: #ffffff; font-size: 13px;">
                <thead style="background-color: #f1f5f9; color: #1e293b; font-weight: bold; font-size: 11px; text-transform: uppercase;">
                  <tr>
                    <th style="padding: 12px; border: 1px solid #cbd5e1;">Hydrochemical Facies (Water Type)</th>
                    <th style="padding: 12px; border: 1px solid #cbd5e1;">Environmental / Geochemical Significance</th>
                    <th style="padding: 12px; border: 1px solid #cbd5e1; text-align: center;">No. of Samples</th>
                    <th style="padding: 12px; border: 1px solid #cbd5e1; text-align: center;">Percentage (%)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: bold; color: #4f46e5;">Ca-Mg-HCO₃ Type</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-style: italic;">Carbonate weathering / Active fresh recharge</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${faciesCounts["Ca-Mg-HCO3 Type"]}</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${pCaHCO3Val.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: bold; color: #10b981;">Mixed Type</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-style: italic;">Lithological mixing / Transitional water characteristics</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${faciesCounts["Mixed Type A"] + faciesCounts["Mixed Type B"]}</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${pMixedVal.toFixed(2)}%</td>
                  </tr>
                  <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: bold; color: #f43f5e;">Na-Cl Type</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-style: italic;">Arid salinization / Deep mineral dissolution / Marine mixing</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${faciesCounts["Na-Cl Type"]}</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${pNaClVal.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: bold; color: #06b6d4;">Na-HCO₃ Type</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-style: italic;">Base ion exchange / Alkali-bicarbonate enrichment</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${faciesCounts["Na-HCO3 Type"]}</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${pNaHCO3Val.toFixed(2)}%</td>
                  </tr>
                  <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: bold; color: #eab308;">Ca-Cl Type</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; font-style: italic;">Permanent hard-water signature / Anthropogenic leakage</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${faciesCounts["Ca-Cl Type"]}</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${pCaCl2Val.toFixed(2)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>



            <!-- Agricultural Suitability and Hazards Subsection -->
            <h4 style="font-weight: 900; color: #1e3a8a; font-size: 16px; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 5px; margin-top: 35px; margin-bottom: 15px;">Irrigation Water Suitability Index Assessments</h4>
            <p style="color: #475569; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
              To evaluate suitability for agricultural and crop production, groundwater samples have been evaluated using the Sodium Adsorption Ratio (SAR) and Residual Sodium Carbonate (RSC) indexes. These metrics classify alkali hazards and sodium toxicity.
            </p>

            <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
              ${sarHTML}
              ${rscHTML}
            </div>

            <!-- USSL Plot Section -->
            <div style="margin-top: 35px; margin-bottom: 30px; page-break-inside: avoid;">
              <h4 style="font-weight: 900; color: #1e3a8a; font-size: 16px; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 5px; margin-top: 25px; margin-bottom: 15px;">U.S. Salinity Laboratory (USSL) Irrigation Classification</h4>
              <p style="color: #475569; font-size: 14px; line-height: 1.5; margin-bottom: 20px; text-align: justify;">
                The USSL diagram classifies groundwater based on salinity hazard (Electrical Conductivity, EC) and sodicity hazard (Sodium Adsorption Ratio, SAR) to determine its direct usability for crop irrigation.
              </p>
              <div style="text-align: center; margin: 25px 0;">
                <div style="display: inline-block; max-width: 450px; width: 100%;">
                  ${generateUsslDiagramHTML(validFaciesSamples)}
                </div>
                ${generateBlockLegendHTML()}
                <p style="text-align: center; font-style: italic; font-size: 11px; margin-top: 6px; color: #475569; font-weight: bold;">
                  Figure 4: USSL Diagram (3D Block-wise Bubbles) of Irrigation Groundwater Samples in ${regionName}
                </p>
              </div>
            </div>

          </div>
        `;
      }

      let summaryMapHtml = "";
      if (summaryMapBase64) {
        summaryMapHtml = `
          <div style="margin-top: 24px; margin-bottom: 24px; text-align: center; border: 1px solid #cbd5e1; border-radius: 12px; background-color: transparent; padding: 15px;">
            <h4 style="color: #1e3b8a; font-weight: bold; margin-bottom: 12px; font-size: 16px;">Overall Groundwater Contamination Map</h4>
            <img src="${summaryMapBase64}" alt="Overall Contamination Map" style="max-height: 500px; display: block; margin: 0 auto; max-width: 100%; border-radius: 8px;" />
          </div>
        `;
      }

      let textParaFaciesAgricultural = "";
      if (totalValidFacies > 0) {
        textParaFaciesAgricultural = `<strong>Piper, USSL & Irrigation Water Quality Indices Analysis:</strong> The hydrogeochemical facies analysis classifies the primary groundwater chemical characteristics. Based on the Piper trilinear diagram, the dominant groundwater type in the region is identified as <strong>${dominantFaciesName}</strong>, representing primary geogenic paths and active rock-water interactions. For irrigation suitability, the <strong>Sodium Adsorption Ratio (SAR)</strong> shows that sodicity hazard is primarily within safe ranges across monitored zones, which minimizes clay dispersion risks. Simultaneously, the <strong>Residual Sodium Carbonate (RSC)</strong> assessment highlights potential alkali hazards and soil alkalization risks. When integrated into the <strong>U.S. Salinity Laboratory (USSL)</strong> grid, these metrics specify salinity-sodicity categories (such as C1S1, C2S1, C3S1) and determine the overall suitability of the water for agricultural irrigation.`;
      }

      // Assemble final HTML
      const finalHTML = `
        <div style="font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; background-color: #ffffff; padding: 25px; border-radius: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
          
          <!-- Pamphlet Header -->
          <div style="background: #ffffff; padding: 30px; border-radius: 20px; border: 1.5px solid #e2e8f0; text-align: center; margin-bottom: 40px;">
            <span style="display: inline-block; padding: 6px 16px; border-radius: 9999px; background-color: #d1fae5; color: #065f46; font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 15px;">Official Assessment Pamphlet</span>
            <h1 style="font-size: 26px; font-weight: 900; color: #0f172a; margin: 0 0 15px 0;">Comprehensive Groundwater Quality Assessment of <span style="color: #4f46e5;">${regionName}</span>, ${stateNameStr}</h1>
            <p style="color: #475569; font-size: 14.5px; line-height: 1.6; max-width: 800px; margin: 0 auto;">
              A comprehensive groundwater quality assessment was carried out for ${regionName} based on the analysis of <strong>${totalSamples}</strong> groundwater samples collected from various blocks and habitations. The assessment evaluated major physicochemical parameters and heavy/trace metals to determine groundwater suitability for drinking purposes as per Bureau of Indian Standards (BIS IS 10500).
            </p>
          </div>

          <!-- Basic Characteristics -->
          ${
            basicCardsHTML
              ? `
            <div style="margin-bottom: 40px;">
              <h3 style="font-size: 20px; font-weight: 900; color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin: 0 0 20px 0;">Hydrochemical Characteristics of Groundwater</h3>
              <div style="display: flex; flex-direction: column; gap: 16px;">
                ${basicCardsHTML}
              </div>
            </div>
            `
              : ""
          }

          <!-- Trace and Heavy metals -->
          ${
            heavyCardsHTML
              ? `
            <div style="margin-bottom: 40px;">
              <h3 style="font-size: 20px; font-weight: 900; color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin: 0 0 20px 0;">Heavy Metals and Trace Elements</h3>
              <p style="color: #475569; font-size: 14px; line-height: 1.5; margin-bottom: 15px;">
                The analysis of heavy metals and trace elements indicates that while many toxic metals are generally within permissible limits, localized enrichment has been identified in several groundwater samples across the region.
              </p>
              <div style="display: grid; grid-template-columns: 1fr; gap: 16px;">
                ${heavyCardsHTML}
              </div>
            </div>
            `
              : ""
          }

          <!-- Contaminated Locations Data Grid -->
          ${
            locationTableHTML
              ? `
            <div style="margin-bottom: 40px; page-break-inside: avoid;">
              <h3 style="font-size: 20px; font-weight: 900; color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin: 0 0 15px 0;">Locations Showing Multiple Parameter Exceedances</h3>
              <div style="overflow-x: auto; border: 1px solid #cbd5e1; border-radius: 12px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; background-color: #ffffff;">
                  <thead style="background-color: #f1f5f9; color: #1e293b; font-weight: bold; font-size: 11px; text-transform: uppercase;">
                    <tr>
                      <th style="padding: 12px; border: 1px solid #cbd5e1;">Block/Taluk</th>
                      <th style="padding: 12px; border: 1px solid #cbd5e1;">Location</th>
                      <th style="padding: 12px; border: 1px solid #cbd5e1;">Latitude</th>
                      <th style="padding: 12px; border: 1px solid #cbd5e1;">Longitude</th>
                      <th style="padding: 12px; border: 1px solid #cbd5e1; text-align: center;">Exceeding Params</th>
                      <th style="padding: 12px; border: 1px solid #cbd5e1;">Names</th>
                      <th style="padding: 12px; border: 1px solid #cbd5e1;">Values & Units</th>
                      <th style="padding: 12px; border: 1px solid #cbd5e1;">Contamination Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${locationTableHTML}
                  </tbody>
                </table>
              </div>
            </div>
            `
              : ""
          }

          <!-- Remedial Measures section removed per user request -->

          <!-- Hydrochemical Facies and Agricultural Suitability -->
          ${faciesAndSuitabilityHTML}

          <!-- Executive summaries context block -->
          <div style="background-color: #ffffff; color: #1e293b; padding: 35px; border-radius: 24px; margin-top: 50px; position: relative; border: 1.5px solid #cbd5e1;">
            <h3 style="font-size: 22px; font-weight: 900; color: #1e3a8a; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 12px; margin: 0 0 20px 0;">Executive Summary & Interpretation</h3>
            
            <div style="color: #334155; line-height: 1.6; font-size: 14.5px; text-align: justify; margin-bottom: 30px;">
              <p style="margin-bottom: 16px;">${textPara1}</p>
              <p style="margin-bottom: 16px;">${textParaCompliance}</p>
              <p style="margin-bottom: 16px;">${textPara2}</p>
              ${textParaHeavy ? `<p style="margin-bottom: 16px;">${textParaHeavy}</p>` : ""}
              ${textParaFaciesAgricultural ? `<p style="margin-bottom: 16px;">${textParaFaciesAgricultural}</p>` : ""}
              <p style="margin-bottom: 16px;">${textPara3}</p>
              <p style="margin-bottom: 16px;">${textPara4}</p>
            </div>

            <!-- Gibbs Diagrams (Water-Rock Interaction Mechanism) -->
            ${totalValidFacies > 0 ? `
            <div style="margin-top: 35px; margin-bottom: 35px; page-break-inside: avoid;">
              <h4 style="font-weight: 900; color: #1e3a8a; font-size: 16px; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 15px;">Gibbs Diagram (Water-Rock Interaction Mechanism)</h4>
              <p style="color: #475569; font-size: 14px; line-height: 1.5; margin-bottom: 20px; text-align: justify;">
                The Gibbs diagrams represent the relationship between water chemistry and aquifer lithology. They plot TDS against Na/(Na+Ca) or Cl/(Cl+HCO3) to determine whether the chemistry of groundwater is governed by <strong>Precipitation Dominance</strong>, <strong>Rock-Weathering Dominance</strong>, or <strong>Evaporation Dominance</strong>.
              </p>
              <div style="display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; margin: 25px 0;">
                <div style="flex: 1; min-width: 260px; max-width: 300px; text-align: center;">
                  ${generateGibbsDiagramHTML("cation", "Gibbs Cation Diagram", validFaciesSamples)}
                </div>
                <div style="flex: 1; min-width: 260px; max-width: 300px; text-align: center;">
                  ${generateGibbsDiagramHTML("anion", "Gibbs Anion Diagram", validFaciesSamples)}
                </div>
              </div>
              ${generateBlockLegendHTML()}
              <p style="text-align: center; font-style: italic; font-size: 11px; margin-top: 6px; color: #475569; font-weight: bold; margin-bottom: 30px;">
                Figure 5: Gibbs Cation and Anion Diagrams showing Geochemical Mechanisms in ${regionName}
              </p>
            </div>
            ` : ""}

            <!-- Compliances Chart -->
            <div style="background-color: transparent; border-radius: 16px; padding: 20px; display: block; margin: 0 auto 30px auto; max-width: 100%; border: none;">
              <img src="${summaryChartImageBase64}" alt="Overall Compliance Distribution" style="max-height: 480px; width: auto; display: block; margin: 0 auto; object-fit: contain;" />
            </div>

            ${summaryMapHtml}

            <!-- Recommended management controls -->
            <div style="display: grid; grid-template-columns: 1fr; gap: 20px; font-size: 13.5px; margin-top: 30px;">
              <div style="background-color: #f8fafc; padding: 20px; border-radius: 16px; border: 1px solid #e2e8f0; color: #1e293b;">
                <h4 style="color: #059669; font-weight: bold; font-size: 15px; margin: 0 0 10px 0;">Resource Management</h4>
                <ul style="margin: 0; padding-left: 20px; color: #334155; line-height: 1.5;">
                  <li style="margin-bottom: 5px;">Continuous seasonal groundwater quality monitoring metrics.</li>
                  <li style="margin-bottom: 5px;">Artificial groundwater recharge systems & rainwater harvesting.</li>
                  <li style="margin-bottom: 5px;">Regulation of excessive extraction volumes in vulnerable geogenic zones.</li>
                </ul>
              </div>
              <div style="background-color: #f8fafc; padding: 20px; border-radius: 16px; border: 1px solid #e2e8f0; color: #1e293b;">
                <h4 style="color: #d97706; font-weight: bold; font-size: 15px; margin: 0 0 10px 0;">Resource Quality Remedies</h4>
                <ul style="margin: 0; padding-left: 20px; color: #334155; line-height: 1.5;">
                  <li style="margin-bottom: 5px;">Installation of suitable municipal filter channels (Softening, RO modules).</li>
                  <li style="margin-bottom: 5px;">Regulating intensive commercial agricultural pesticide/fertilizer use load.</li>
                  <li style="margin-bottom: 5px;">Fostering native public health awareness campaigns.</li>
                </ul>
              </div>
            </div>

          </div>

        </div>
      `;

      setPamphletHtml(finalHTML);
      setHasGenerated(true);
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportWord = async () => {
    const titleVal = selectedDistrict || selectedState || "India";
    await downloadMhtmlWordDoc(pamphletHtml, `GWQ_Assessment_Pamphlet_${titleVal}`);
  };

  const selectSummaryOptionsLength = selectedPamphletParams.length;

  return (
    <div className="space-y-6">
      <div className="glossy-panel p-8 rounded-3xl space-y-6">
        
        {/* Heading */}
        <div className="border-b border-white/50 pb-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-2xl font-black text-indigo-900 flex items-center gap-3 drop-shadow-md">
              <LayoutTemplate className="w-6 h-6 text-indigo-600" />
              District GWQ Assessment Report
            </h3>
            <p className="text-slate-600 font-medium mt-1">
              Generate a comprehensive, colorful official pamphlet summarizing water quality based on current filters.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || selectSummaryOptionsLength === 0}
              className="glossy-btn-indigo px-6 py-3 rounded-2xl font-black text-sm flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
            >
              <FileCheck2 className="w-4 h-4" /> Generate Pamphlet
            </button>
            {hasGenerated && (
              <button
                onClick={handleExportWord}
                className="glossy-btn-emerald px-6 py-3 rounded-2xl font-black text-sm flex items-center gap-2 whitespace-nowrap"
              >
                <FileDown className="w-4 h-4" /> Export to Word (DOCX)
              </button>
            )}
          </div>
        </div>

        {/* Parameter choose selector list specifically for pamphlet summary builder */}
        <div className="bg-white/40 shadow-inner p-6 rounded-2xl border border-white/60 relative z-30">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2 drop-shadow-sm">
            Select Parameters to Analyze in Pamphlet
          </label>
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full glossy-input rounded-xl p-3 font-bold text-slate-700 flex justify-between items-center text-left bg-white text-xs select-none"
            >
              <span className="truncate">
                {selectedPamphletParams.length === availableParams.length
                  ? "All Parameters Selected"
                  : `${selectedPamphletParams.length}/${availableParams.length} Selected`}
              </span>
              <ChevronDown className="w-4 h-4 text-slate-500 shrink-0ml-1.5" />
            </button>
            
            {dropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl z-[120] max-h-60 overflow-y-auto custom-scrollbar p-2">
                <label className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-100 font-bold text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedPamphletParams.length === availableParams.length}
                    onChange={handleSelectAll}
                    className="rounded text-indigo-600 w-4 h-4"
                  />
                  <span>Select All</span>
                </label>
                {availableParams.map((val) => (
                  <label key={val} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={selectedPamphletParams.includes(val)}
                      onChange={() => handleToggleParam(val)}
                      className="rounded text-indigo-600 w-4 h-4"
                    />
                    <span>{val}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Map uploading triggers */}
        <div className="bg-white/40 shadow-inner p-6 rounded-2xl border border-white/60">
          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-3 drop-shadow-sm">
            Additional Map Uploads (Optional)
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
              <label className="text-xs font-bold text-slate-700 block mb-2 flex items-center gap-2">
                <Map className="w-4 h-4 text-indigo-500" /> 1. Upload EC IDW Map (Displayed in EC Section)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleMapUpload(e, "ec")}
                className="text-xs w-full cursor-pointer file:mr-2 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
              <label className="text-xs font-bold text-slate-700 block mb-2 flex items-center gap-2">
                <Map className="w-4 h-4 text-emerald-500" /> 2. Upload Overall Contamination Map (Displayed in Summary)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleMapUpload(e, "summary")}
                className="text-xs w-full cursor-pointer file:mr-2 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
              />
            </div>
          </div>
        </div>

        {/* Real-time Generated preview document space */}
        <div className="bg-white/40 p-2 md:p-8 rounded-2xl shadow-inner border border-white/60 min-h-[400px]">
          {isGenerating ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              <p className="font-bold text-indigo-600 animate-pulse drop-shadow-sm text-center">
                Analyzing comprehensive data variables...<br />
                <span className="text-xs text-slate-400 mt-2 block">Synthesizing executive assessment pamphlet...</span>
              </p>
            </div>
          ) : hasGenerated ? (
            <div 
              className="w-full h-full bg-white p-4 md:p-8 border border-slate-200 rounded-xl overflow-auto shadow-inner"
              dangerouslySetInnerHTML={{ __html: pamphletHtml }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-60">
              <LayoutTemplate className="w-16 h-16 text-slate-400" />
              <p className="font-bold text-slate-500 uppercase tracking-widest text-center text-xs">
                Click "Generate Pamphlet" to compile WQ metrics <br />
                and construct the official assessment pamphlet layout.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

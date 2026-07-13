import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { DataHeaders, ParamConfigItem } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { 
  SlidersHorizontal, Sparkles, Download, Layers, Compass, BookOpen,
  CheckCircle, Table, MapPin, FlaskConical, Network, Info
} from "lucide-react";
import * as XLSX from "xlsx";

interface CombinationAnalysisViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState?: string;
  selectedDistrict?: string;
}

export function CombinationAnalysisView({
  rawData,
  headers,
  headerMap,
  selectedState = "",
  selectedDistrict = ""
}: CombinationAnalysisViewProps) {
  const L = (window as any).L;

  // Active Tab
  const [activeTab, setActiveTab] = useState<string>("overview");

  // Filter & Logic states
  const [activeParams, setActiveParams] = useState<Record<string, boolean>>({});
  const [strictData, setStrictData] = useState<boolean>(false);
  const [normalSamplePerc, setNormalSamplePerc] = useState<number>(25);
  
  // District Low Sample Rule
  const [lowSampleRule, setLowSampleRule] = useState<boolean>(false);
  const [lowSampleThreshold, setLowSampleThreshold] = useState<number>(5);
  const [lowSamplePerc, setLowSamplePerc] = useState<number>(100);
  
  // Spatial constraints
  const [spatialRadius, setSpatialRadius] = useState<number>(5);
  const [exemptedStates, setExemptedStates] = useState<string[]>([
    "Delhi", "Lakshadweep", "Puducherry", "Chandigarh", "Daman and Diu", "Dadra and Nagar Haveli"
  ]);

  // Map Controls
  const [mapMode, setMapMode] = useState<"compliance" | "trend" | "phase">("compliance");
  const [mapTheme, setMapTheme] = useState<"light" | "satellite" | "terrain">("light");
  const [pointSize, setPointSize] = useState<number>(7);
  const [mapStatusFilters, setMapStatusFilters] = useState({ clean: true, single: true, multi: true });
  
  // Custom Map Visual Configs
  const [trendConfig, setTrendConfig] = useState({
    trCleanVisible: true, trCleanColor: '#10b981',
    trSingleVisible: true, trSingleColor: '#f59e0b',
    trMultiVisible: true, trMultiColor: '#ef4444',
    trSize: 8,
    bgCleanVisible: true, bgCleanColor: '#a7f3d0',
    bgSingleVisible: true, bgSingleColor: '#fde68a',
    bgMultiVisible: true, bgMultiColor: '#fecaca',
    bgSize: 5
  });

  const [phaseConfig, setPhaseConfig] = useState({
    phase1: true, p1Color: '#ef4444',
    phase2High: true, p2hColor: '#f59e0b',
    phase2Low: true, p2lColor: '#3b82f6',
    phase2Rand: true, p2rColor: '#10b981',
    fallback: true, fbColor: '#8b5cf6',
    bgVisible: true, bgColor: '#cbd5e1',
    pSize: 8, bgSize: 5
  });

  // Decimals settings
  const [decSettings, setDecSettings] = useState({
    group1: 0, // EC, NO3, TH, Cl
    group2: 2, // F
    group3: 1, // As, U
    group4: 3, // Heavy metals
    default: 2
  });

  // Map Refs
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerGroupRef = useRef<any>(null);

  // Map column mapping helper
  const columnMapping = useMemo(() => {
    const mapping: Record<string, string> = {};
    if (headers) {
      mapping['State'] = headers.state || "";
      mapping['District'] = headers.district || "";
      mapping['Block'] = headers.block || "";
      mapping['Station'] = headers.location || "";
      mapping['latitude'] = headers.latitude || "";
      mapping['longitude'] = headers.longitude || "";
      mapping['Season'] = headers.season || "";
    }
    if (headerMap) {
      Object.entries(headerMap).forEach(([excelHeader, paramKey]) => {
        if (paramKey) {
          mapping[paramKey] = excelHeader;
        }
      });
    }
    return mapping;
  }, [headers, headerMap]);

  // Unique States list for Exempt selection
  const uniqueStatesList = useMemo(() => {
    const col = columnMapping['State'];
    if (!col || !rawData) return [];
    return Array.from(new Set(rawData.map(r => String(r[col] || '').trim()))).filter(Boolean).sort();
  }, [rawData, columnMapping]);

  // Decimal helper
  const getDecimalForParam = useCallback((paramName: string) => {
    const group1 = ['EC', 'NO3', 'TH', 'Cl'];
    const group2 = ['F'];
    const group3 = ['As', 'U'];
    const group4 = ['Fe', 'Zn', 'Cu', 'Pb', 'Cd', 'Cr', 'Hg', 'Ni', 'Se', 'Mn', 'Al', 'Ba'];

    if (group1.includes(paramName)) return decSettings.group1;
    if (group2.includes(paramName)) return decSettings.group2;
    if (group3.includes(paramName)) return decSettings.group3;
    if (group4.includes(paramName)) return decSettings.group4;
    return decSettings.default;
  }, [decSettings]);

  // Haversine distance
  const calculateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return Infinity;
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Perform Analysis & Trend Station Selection Algorithm
  const analysisResults = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;

    const activeSet = Object.keys(activeParams).some(k => activeParams[k])
      ? Object.keys(activeParams).filter(k => activeParams[k])
      : Object.keys(PARAM_CONFIG).filter(p => !!columnMapping[p]);

    const stateCol = columnMapping['State'];
    const districtCol = columnMapping['District'];
    const latCol = columnMapping['latitude'];
    const lonCol = columnMapping['longitude'];

    // 1. Basic filter and fail calculations
    const results = rawData.filter(d => {
      // Global app-level geofilters
      if (selectedState && stateCol && String(d[stateCol] || '').trim() !== selectedState) return false;
      if (selectedDistrict && districtCol && String(d[districtCol] || '').trim() !== selectedDistrict) return false;

      if (strictData) {
        return activeSet.every(p => {
          const col = columnMapping[p];
          return col ? !isNaN(parseFloat(d[col])) : false;
        });
      }
      return true;
    }).map(d => {
      let failCount = 0;
      const failedParams: any[] = [];
      
      activeSet.forEach(p => {
        const col = columnMapping[p];
        if (!col) return;
        const val = parseFloat(d[col]);
        if (isNaN(val)) return;
        const conf = PARAM_CONFIG[p];
        const fail = p === 'pH' ? (val < conf.b1 || val > conf.b2) : (val > conf.b2);
        if (fail) {
          const limitDisplay = p === 'pH' ? `${conf.b1} - ${conf.b2}` : conf.b2;
          failCount++;
          failedParams.push({ name: p, val, limit: limitDisplay, unit: conf.unit });
        }
      });

      // Calculate MPR
      let sumRatio = 0;
      activeSet.forEach(p => {
        const col = columnMapping[p];
        if (col) {
          const val = parseFloat(d[col]);
          if (!isNaN(val)) {
            const limit = PARAM_CONFIG[p].b2;
            if (limit > 0) {
              sumRatio += (val / limit);
            }
          }
        }
      });
      const mprScore = activeSet.length > 0 ? sumRatio / activeSet.length : 0;

      return {
        ...d,
        failCount,
        failedParams,
        _latNum: latCol ? parseFloat(d[latCol]) : NaN,
        _lonNum: lonCol ? parseFloat(d[lonCol]) : NaN,
        _mprScoreNum: mprScore,
        _isTrendStation: false,
        _trendSelectionMode: '',
        _trendSelectionCategory: '',
        _contamReason: '',
        _freshReason: '',
        _districtMprRank: 0
      };
    });

    // 2. Group by District to run trend network allocation
    const groups: Record<string, any[]> = {};
    results.forEach(r => {
      const dName = districtCol ? String(r[districtCol] || 'Unknown') : 'Unknown';
      const sName = stateCol ? String(r[stateCol] || 'Unknown') : 'Unknown';
      const key = `${dName}||${sName}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    const selectedTrendStations: any[] = [];
    const trendProcessLog: any[] = [];
    const globalStateRequiredCache: Record<string, number> = {};

    Object.keys(groups).forEach(key => {
      const groupData = groups[key];
      groupData.sort((a, b) => b._mprScoreNum - a._mprScoreNum);
      
      groupData.forEach((r, idx) => {
        r._districtMprRank = idx + 1;
      });

      const totalWells = groupData.length;
      const contamWells = groupData.filter(r => r.failCount > 0);
      const freshWells = groupData.filter(r => r.failCount === 0);
      const contamRatio = totalWells > 0 ? contamWells.length / totalWells : 0;

      let actualPerc = normalSamplePerc;
      let usedLowRule = false;
      if (lowSampleRule && totalWells < lowSampleThreshold) {
        actualPerc = lowSamplePerc;
        usedLowRule = true;
      }

      const targetTotalTrend = Math.max(1, Math.ceil(totalWells * (actualPerc / 100)));
      const sState = stateCol ? String(groupData[0][stateCol] || 'Unknown') : 'Unknown';
      globalStateRequiredCache[sState] = (globalStateRequiredCache[sState] || 0) + targetTotalTrend;

      const isSpatialExempt = exemptedStates.some(ex => sState.toLowerCase().includes(ex.toLowerCase()));

      let mode = "";
      let targetContam = 0;

      if (contamRatio === 0) {
        mode = "Pristine District";
        targetContam = 0;
      } else if (contamRatio <= 0.2) {
        mode = "Low Contam District";
        targetContam = Math.ceil(targetTotalTrend * 0.50);
      } else if (contamRatio <= 0.5) {
        mode = "Moderate Contam District";
        targetContam = Math.ceil(targetTotalTrend * 0.75);
      } else {
        mode = "Contaminated District";
        targetContam = targetTotalTrend;
      }

      const selectedForDistrict: any[] = [];

      const trySelect = (pool: any[], quota: number, typeText: string) => {
        let count = 0;
        for (let s of pool) {
          if (count >= quota) break;
          if (s._isTrendStation) continue;

          s._isTrendStation = true;
          s._trendSelectionMode = mode;
          const baseReason = s._contamReason || s._freshReason || typeText;
          let catText = `${mode} | ${baseReason}`;
          if (usedLowRule) catText += ` [Low Sample]`;
          s._trendSelectionCategory = catText;

          selectedForDistrict.push(s);
          selectedTrendStations.push(s);
          count++;
        }
        return count;
      };

      // Phase 1: Contaminated Representatives
      let phase1Candidates: any[] = [];
      if (targetContam > 0 && contamWells.length > 0) {
        const cGroups: Record<string, any[]> = {};
        contamWells.forEach(w => {
          const gName = w.failedParams.map((p: any) => p.name).sort().join('+');
          if (!cGroups[gName]) cGroups[gName] = [];
          cGroups[gName].push(w);
        });

        Object.values(cGroups).forEach(arr => arr.sort((a, b) => b._mprScoreNum - a._mprScoreNum));
        const groupKeys = Object.keys(cGroups);
        
        groupKeys.sort((a, b) => {
          if (cGroups[b][0].failCount !== cGroups[a][0].failCount) return cGroups[b][0].failCount - cGroups[a][0].failCount;
          return cGroups[b][0]._mprScoreNum - cGroups[a][0]._mprScoreNum;
        });

        const repsPicked: any[] = [];
        if (groupKeys.length > targetContam) {
          for (let i = 0; i < targetContam; i++) {
            const w = cGroups[groupKeys[i]][0];
            w._contamReason = "Phase 1: Grp Rep (High MPR)";
            phase1Candidates.push(w);
            repsPicked.push(w);
          }
        } else if (groupKeys.length === targetContam) {
          for (let i = 0; i < groupKeys.length; i++) {
            const w = cGroups[groupKeys[i]][0];
            w._contamReason = "Phase 1: Grp Rep";
            phase1Candidates.push(w);
            repsPicked.push(w);
          }
        } else {
          groupKeys.forEach(k => {
            const w = cGroups[k][0];
            w._contamReason = "Phase 1: Grp Rep";
            phase1Candidates.push(w);
            repsPicked.push(w);
          });

          const remaining = targetContam - groupKeys.length;
          const totalC = contamWells.length;
          const allocation: Record<string, number> = {};
          let allocSum = 0;
          groupKeys.forEach(k => {
            const val = Math.round((cGroups[k].length / totalC) * remaining);
            allocation[k] = val;
            allocSum += val;
          });

          if (allocSum !== remaining && groupKeys.length > 0) {
            const largest = [...groupKeys].sort((a, b) => cGroups[b].length - cGroups[a].length)[0];
            allocation[largest] += (remaining - allocSum);
          }

          groupKeys.forEach(k => {
            const sortedGroup = [...cGroups[k]].sort((a, b) => {
              if (b.failCount !== a.failCount) return b.failCount - a.failCount;
              return b._mprScoreNum - a._mprScoreNum;
            });

            let added = 0;
            for (let i = 0; i < sortedGroup.length; i++) {
              const w = sortedGroup[i];
              if (repsPicked.includes(w)) continue;
              if (added >= (allocation[k] || 0)) break;
              w._contamReason = "Phase 1: Proportional Allocation";
              phase1Candidates.push(w);
              added++;
            }
          });
        }
      }

      const selectedContam = trySelect(phase1Candidates, targetContam, "Contaminated");
      const targetFresh = targetTotalTrend - selectedContam;

      let sHigh = 0, sLow = 0, sRand = 0;

      // Phase 2: Fresh (50 / 20 / 30)
      if (targetFresh > 0 && freshWells.length > 0) {
        const qHigh = Math.round(targetFresh * 0.50);
        const qLow = Math.round(targetFresh * 0.20);

        const freshSorted = [...freshWells].sort((a, b) => b._mprScoreNum - a._mprScoreNum);
        freshSorted.forEach(w => w._freshReason = "Phase 2: High MPR 50%");
        sHigh = trySelect(freshSorted, qHigh, "Fresh - High");

        const availLow = freshSorted.filter(w => !w._isTrendStation);
        availLow.sort((a, b) => a._mprScoreNum - b._mprScoreNum);
        availLow.forEach(w => w._freshReason = "Phase 2: Low MPR 20%");
        sLow = trySelect(availLow, qLow, "Fresh - Low");

        const availRand = availLow.filter(w => !w._isTrendStation);
        const shuffledRand = [...availRand].sort(() => Math.random() - 0.5);

        const remainingRand = targetFresh - sHigh - sLow;
        sRand = 0;

        for (let i = 0; i < shuffledRand.length && sRand < remainingRand; i++) {
          const candidate = shuffledRand[i];
          let tooClose = false;

          if (!isSpatialExempt && spatialRadius > 0 && !isNaN(candidate._latNum) && !isNaN(candidate._lonNum)) {
            for (let selected of selectedForDistrict) {
              if (isNaN(selected._latNum) || isNaN(selected._lonNum)) continue;
              const dist = calculateDistanceKm(candidate._latNum, candidate._lonNum, selected._latNum, selected._lonNum);
              if (dist < spatialRadius) {
                tooClose = true;
                break;
              }
            }
          }

          if (!tooClose) {
            candidate._isTrendStation = true;
            candidate._trendSelectionMode = mode;
            candidate._freshReason = "Phase 2: Random Spatial 30%";
            let catText = `${mode} | ${candidate._freshReason}`;
            if (usedLowRule) catText += ` [Low Sample]`;
            candidate._trendSelectionCategory = catText;

            selectedForDistrict.push(candidate);
            selectedTrendStations.push(candidate);
            sRand++;
          }
        }

        // Spatial Relaxation fallback
        if (sRand < remainingRand && spatialRadius > 0) {
          const stillRemaining = remainingRand - sRand;
          const availRandRelaxed = shuffledRand.filter(w => !w._isTrendStation);
          availRandRelaxed.forEach(w => w._freshReason = "Phase 2: Random (Radius Relaxed)");
          sRand += trySelect(availRandRelaxed, stillRemaining, "Fresh - Random (Relaxed)");
        }
      }

      // Fallback Extra Contam
      let fallbackSelected = 0;
      const totalSelectedSoFar = selectedContam + sHigh + sLow + sRand;
      if (totalSelectedSoFar < targetTotalTrend) {
        const remainContam = contamWells.filter(w => !w._isTrendStation);
        remainContam.sort((a, b) => b._mprScoreNum - a._mprScoreNum);
        remainContam.forEach(w => w._contamReason = "Fallback Select");
        fallbackSelected = trySelect(remainContam, targetTotalTrend - totalSelectedSoFar, "Fallback");
      }

      trendProcessLog.push({
        state: sState,
        district: groupData[0][districtCol] || 'Unknown',
        totalBg: totalWells,
        contamRatio: contamRatio.toFixed(2),
        quota: targetTotalTrend,
        mode: mode,
        p1Contam: selectedContam,
        p2High: sHigh,
        p2Low: sLow,
        p2Rand: sRand,
        fallback: fallbackSelected,
        totalSelected: selectedContam + sHigh + sLow + sRand + fallbackSelected
      });
    });

    return {
      results,
      selectedTrendStations,
      trendProcessLog,
      globalStateRequiredCache,
      activeSet
    };
  }, [rawData, columnMapping, selectedState, selectedDistrict, activeParams, strictData, normalSamplePerc, lowSampleRule, lowSampleThreshold, lowSamplePerc, spatialRadius, exemptedStates]);

  const currentFilteredData = analysisResults?.results || [];
  const selectedTrendStations = analysisResults?.selectedTrendStations || [];
  const trendProcessLog = analysisResults?.trendProcessLog || [];
  const globalStateRequiredCache = analysisResults?.globalStateRequiredCache || {};
  const activeSet = analysisResults?.activeSet || [];

  // Donut and Exceedance Bar charts data
  const chartData = useMemo(() => {
    const total = currentFilteredData.length;
    const clean = currentFilteredData.filter(r => r.failCount === 0).length;
    const single = currentFilteredData.filter(r => r.failCount === 1).length;
    const multi = currentFilteredData.filter(r => r.failCount > 1).length;

    const donut = [
      { name: "Uncontaminated", value: clean, percentage: total > 0 ? ((clean / total) * 100).toFixed(1) : "0" },
      { name: "Single Combination", value: single, percentage: total > 0 ? ((single / total) * 100).toFixed(1) : "0" },
      { name: "Multi Combination", value: multi, percentage: total > 0 ? ((multi / total) * 100).toFixed(1) : "0" }
    ];

    // Exceedance counts (None, One, Two, Three, Four, Five+)
    const bgCounts = [0, 0, 0, 0, 0, 0];
    const trCounts = [0, 0, 0, 0, 0, 0];

    currentFilteredData.forEach(r => {
      const idx = Math.min(r.failCount, 5);
      bgCounts[idx]++;
      if (r._isTrendStation) {
        trCounts[idx]++;
      }
    });

    const labels = ['None', 'One', 'Two', 'Three', 'Four', 'Five+'];
    const bar = labels.map((lbl, idx) => ({
      name: lbl,
      Background: bgCounts[idx],
      Trend: trCounts[idx]
    }));

    return { donut, bar };
  }, [currentFilteredData]);

  // Specific fail combinations calculation
  const comboAnalysis = useMemo(() => {
    const combos: Record<string, number> = {};
    currentFilteredData.filter(r => r.failCount > 0).forEach(r => {
      const key = r.failedParams.map((p: any) => p.name).sort().join(' + ');
      combos[key] = (combos[key] || 0) + 1;
    });

    return Object.entries(combos)
      .map(([key, count]) => ({
        key,
        count,
        percentage: currentFilteredData.length > 0 ? ((count / currentFilteredData.length) * 100).toFixed(1) : "0"
      }))
      .sort((a, b) => b.count - a.count);
  }, [currentFilteredData]);

  // Leaflet Map instance setup and update
  useEffect(() => {
    if (!L || !mapRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    mapRef.current.innerHTML = "";

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true
    }).setView([22.5, 82.5], 5);

    mapInstanceRef.current = map;
    markerGroupRef.current = L.layerGroup().addTo(map);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [L]);

  // Theme updating
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !L) return;

    map.eachLayer((layer: any) => {
      if (layer instanceof L.TileLayer) {
        map.removeLayer(layer);
      }
    });

    const tileUrls = {
      light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      satellite: "http://mt0.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}",
      terrain: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
    };

    L.tileLayer(tileUrls[mapTheme], {
      attribution: "© Map Tiles"
    }).addTo(map);
  }, [mapTheme, L]);

  // Marker updating on data or modes change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markerGroup = markerGroupRef.current;
    if (!map || !markerGroup || !L || !currentFilteredData) return;

    markerGroup.clearLayers();
    const bounds: any[] = [];

    const sortedData = [...currentFilteredData].sort((a, b) => {
      const aVal = a._isTrendStation ? 1 : 0;
      const bVal = b._isTrendStation ? 1 : 0;
      return aVal - bVal;
    });

    sortedData.forEach(r => {
      const lat = parseFloat(r[columnMapping['latitude']]);
      const lon = parseFloat(r[columnMapping['longitude']]);
      if (isNaN(lat) || isNaN(lon)) return;

      let col = '#10b981';
      let strokeColor = '#fff';
      let strokeWidth = 1.5;
      let radius = pointSize;
      let isVisible = false;

      if (mapMode === 'compliance') {
        if (r.failCount === 0 && mapStatusFilters.clean) { isVisible = true; col = '#10b981'; }
        if (r.failCount === 1 && mapStatusFilters.single) { isVisible = true; col = '#f59e0b'; }
        if (r.failCount > 1 && mapStatusFilters.multi) { isVisible = true; col = '#ef4444'; }
        radius = pointSize;
      } else if (mapMode === 'trend') {
        if (r._isTrendStation) {
          if (r.failCount === 0 && trendConfig.trCleanVisible) { isVisible = true; col = trendConfig.trCleanColor; }
          else if (r.failCount === 1 && trendConfig.trSingleVisible) { isVisible = true; col = trendConfig.trSingleColor; }
          else if (r.failCount > 1 && trendConfig.trMultiVisible) { isVisible = true; col = trendConfig.trMultiColor; }
          radius = trendConfig.trSize;
        } else {
          if (r.failCount === 0 && trendConfig.bgCleanVisible) { isVisible = true; col = trendConfig.bgCleanColor; }
          else if (r.failCount === 1 && trendConfig.bgSingleVisible) { isVisible = true; col = trendConfig.bgSingleColor; }
          else if (r.failCount > 1 && trendConfig.bgMultiVisible) { isVisible = true; col = trendConfig.bgMultiColor; }
          radius = trendConfig.bgSize;
          strokeWidth = 1.0;
        }
      } else if (mapMode === 'phase') {
        if (r._isTrendStation) {
          const reason = r._contamReason || r._freshReason || '';
          if (reason.includes('Phase 1') && phaseConfig.phase1) { isVisible = true; col = phaseConfig.p1Color; }
          else if (reason.includes('High MPR') && phaseConfig.phase2High) { isVisible = true; col = phaseConfig.p2hColor; }
          else if (reason.includes('Low MPR') && phaseConfig.phase2Low) { isVisible = true; col = phaseConfig.p2lColor; }
          else if (reason.includes('Random') && phaseConfig.phase2Rand) { isVisible = true; col = phaseConfig.p2rColor; }
          else if (phaseConfig.fallback) { isVisible = true; col = phaseConfig.fbColor; }
          radius = phaseConfig.pSize;
        } else {
          if (phaseConfig.bgVisible) {
            isVisible = true;
            col = phaseConfig.bgColor;
            radius = phaseConfig.bgSize;
            strokeWidth = 1.0;
          }
        }
      }

      if (!isVisible) return;

      const marker = L.circleMarker([lat, lon], {
        radius: radius,
        fillColor: col,
        color: strokeColor,
        weight: strokeWidth,
        fillOpacity: 0.9
      });

      const failHtml = r.failCount > 0 ? r.failedParams.map((p: any) => `
        <div style="display: flex; justify-content: space-between; background: #fff1f2; padding: 4px 8px; border-radius: 4px; margin-top: 4px; border: 1px solid #ffe4e6;">
          <span style="font-weight: 900; font-size: 10px; color: #9f1239;">${p.name}</span>
          <span style="font-weight: 700; font-size: 10px; color: #be123c;">${parseFloat(p.val).toFixed(getDecimalForParam(p.name))} / ${p.limit}</span>
        </div>
      `).join('') : '<div style="font-size: 11px; color: #047857; font-weight: 900; padding: 6px; background: #ecfdf5; border-radius: 6px;">✓ COMPLIANT</div>';

      const locInfo = r[columnMapping['District']] ? `<p style="font-size: 10px; color: #4f46e5; margin: 0 0 8px 0; font-weight: 700;">${r[columnMapping['District']] || ''}, ${r[columnMapping['State']] || ''}</p>` : '';
      const trendBadge = r._isTrendStation ? `<div style="background: #e0e7ff; color: #4338ca; font-size: 9px; font-weight: 900; text-transform: uppercase; padding: 3px 6px; border-radius: 4px; margin-bottom: 6px; display: inline-block; border: 1px solid #c7d2fe;">★ Trend Station</div>` : '';

      marker.bindPopup(`
        <div style="font-family: sans-serif; padding: 6px; min-width: 180px;">
          <h3 style="font-size: 12px; font-weight: 900; margin: 0 0 4px 0; color: #1e293b;">${r[columnMapping['Station']] || 'Well'}</h3>
          ${locInfo}
          ${trendBadge}
          <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 900; margin-bottom: 4px;">Status</div>
          ${failHtml}
        </div>
      `);

      marker.addTo(markerGroup);
      bounds.push([lat, lon]);
    });

    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [40, 40] });
      } catch (err) {}
    }
  }, [currentFilteredData, mapMode, pointSize, mapStatusFilters, trendConfig, phaseConfig, L, columnMapping, getDecimalForParam]);

  // Bulk parameters toggling
  const toggleAllParams = () => {
    const mapped = Object.keys(PARAM_CONFIG).filter(p => !!columnMapping[p]);
    const activeList = Object.keys(activeParams).filter(k => activeParams[k]);
    if (activeList.length === mapped.length) {
      setActiveParams({});
    } else {
      const obj: Record<string, boolean> = {};
      mapped.forEach(p => obj[p] = true);
      setActiveParams(obj);
    }
  };

  // State stats breakdown
  const stateStats = useMemo(() => {
    const col = columnMapping['State'];
    if (!col) return [];
    
    const groups: Record<string, any> = {};
    currentFilteredData.forEach(r => {
      const s = String(r[col] || 'Unknown');
      if (!groups[s]) {
        groups[s] = { state: s, total: 0, clean: 0, one: 0, two: 0, three: 0, fourPlus: 0, params: new Set() };
      }
      const g = groups[s];
      g.total++;
      if (r.failCount === 0) g.clean++;
      else if (r.failCount === 1) g.one++;
      else if (r.failCount === 2) g.two++;
      else if (r.failCount === 3) g.three++;
      else g.fourPlus++;

      r.failedParams.forEach((fp: any) => g.params.add(fp.name));
    });

    return Object.values(groups).sort((a: any, b: any) => b.total - a.total);
  }, [currentFilteredData, columnMapping]);

  // District stats breakdown
  const districtStats = useMemo(() => {
    const dCol = columnMapping['District'];
    const sCol = columnMapping['State'];
    if (!dCol) return [];

    const groups: Record<string, any> = {};
    currentFilteredData.forEach(r => {
      const d = String(r[dCol] || 'Unknown');
      const s = sCol ? String(r[sCol] || 'Unknown') : 'Unknown';
      const key = `${d}||${s}`;
      if (!groups[key]) {
        groups[key] = { district: d, state: s, total: 0, clean: 0, one: 0, two: 0, three: 0, fourPlus: 0, params: new Set() };
      }
      const g = groups[key];
      g.total++;
      if (r.failCount === 0) g.clean++;
      else if (r.failCount === 1) g.one++;
      else if (r.failCount === 2) g.two++;
      else if (r.failCount === 3) g.three++;
      else g.fourPlus++;

      r.failedParams.forEach((fp: any) => g.params.add(fp.name));
    });

    return Object.values(groups).sort((a: any, b: any) => b.total - a.total);
  }, [currentFilteredData, columnMapping]);

  // Selected Trend Stats
  const trendSummaries = useMemo(() => {
    const sCol = columnMapping['State'];
    const dCol = columnMapping['District'];
    
    const states: Record<string, any> = {};
    const districts: Record<string, any> = {};

    currentFilteredData.forEach(r => {
      const s = sCol ? String(r[sCol] || 'Unknown') : 'Unknown';
      const d = dCol ? String(r[dCol] || 'Unknown') : 'Unknown';
      const dKey = `${d}||${s}`;

      if (!states[s]) {
        states[s] = { state: s, bg: 0, tr: 0, bgClean: 0, bgOne: 0, bgTwo: 0, bgThree: 0, bgFour: 0, trClean: 0, trOne: 0, trTwo: 0, trThree: 0, trFour: 0, params: new Set() };
      }
      if (!districts[dKey]) {
        districts[dKey] = { district: d, state: s, bg: 0, tr: 0, bgClean: 0, bgOne: 0, bgTwo: 0, bgThree: 0, bgFour: 0, trClean: 0, trOne: 0, trTwo: 0, trThree: 0, trFour: 0, params: new Set() };
      }

      states[s].bg++;
      districts[dKey].bg++;

      if (r.failCount === 0) { states[s].bgClean++; districts[dKey].bgClean++; }
      else if (r.failCount === 1) { states[s].bgOne++; districts[dKey].bgOne++; }
      else if (r.failCount === 2) { states[s].bgTwo++; districts[dKey].bgTwo++; }
      else if (r.failCount === 3) { states[s].bgThree++; districts[dKey].bgThree++; }
      else { states[s].bgFour++; districts[dKey].bgFour++; }

      if (r._isTrendStation) {
        states[s].tr++;
        districts[dKey].tr++;
        if (r.failCount === 0) { states[s].trClean++; districts[dKey].trClean++; }
        else if (r.failCount === 1) { states[s].trOne++; districts[dKey].trOne++; }
        else if (r.failCount === 2) { states[s].trTwo++; districts[dKey].trTwo++; }
        else if (r.failCount === 3) { states[s].trThree++; districts[dKey].trThree++; }
        else { states[s].trFour++; districts[dKey].trFour++; }

        r.failedParams.forEach((fp: any) => {
          states[s].params.add(fp.name);
          districts[dKey].params.add(fp.name);
        });
      }
    });

    return {
      states: Object.values(states).sort((a: any, b: any) => b.bg - a.bg),
      districts: Object.values(districts).sort((a: any, b: any) => b.bg - a.bg)
    };
  }, [currentFilteredData, columnMapping]);

  // Mode summary metrics table
  const modeSummaryList = useMemo(() => {
    const modes = {
      'Pristine District': { label: '0', districts: 0, bgTotal: 0, trContam: 0, trFresh: 0, trTotal: 0 },
      'Low Contam District': { label: '>0 and ≤0.2', districts: 0, bgTotal: 0, trContam: 0, trFresh: 0, trTotal: 0 },
      'Moderate Contam District': { label: '>0.2 and ≤0.5', districts: 0, bgTotal: 0, trContam: 0, trFresh: 0, trTotal: 0 },
      'Contaminated District': { label: '>0.5', districts: 0, bgTotal: 0, trContam: 0, trFresh: 0, trTotal: 0 }
    };

    trendSummaries.districts.forEach(d => {
      const ratio = d.bg > 0 ? (d.bg - d.bgClean) / d.bg : 0;
      let mKey: keyof typeof modes = 'Pristine District';
      if (ratio === 0) mKey = 'Pristine District';
      else if (ratio <= 0.2) mKey = 'Low Contam District';
      else if (ratio <= 0.5) mKey = 'Moderate Contam District';
      else mKey = 'Contaminated District';

      modes[mKey].districts++;
      modes[mKey].bgTotal += d.bg;
      modes[mKey].trFresh += d.trClean;
      modes[mKey].trContam += (d.tr - d.trClean);
      modes[mKey].trTotal += d.tr;
    });

    return Object.entries(modes).map(([key, data]) => ({ key, ...data }));
  }, [trendSummaries]);

  // Background vs Trend criteria
  const criteriaStats = useMemo(() => {
    const contaminated: Record<string, any> = {};
    activeSet.forEach(p => {
      contaminated[p] = { name: PARAM_CONFIG[p].name || p, limit: PARAM_CONFIG[p].b2, unit: PARAM_CONFIG[p].unit, bgCount: 0, trCount: 0 };
    });

    let freshHigh = 0, freshLow = 0, freshRand = 0, freshFallback = 0, freshTotal = 0;

    currentFilteredData.forEach(r => {
      if (r.failCount > 0) {
        r.failedParams.forEach((fp: any) => {
          if (contaminated[fp.name]) contaminated[fp.name].bgCount++;
        });
      }
    });

    selectedTrendStations.forEach(r => {
      if (r.failCount > 0) {
        r.failedParams.forEach((fp: any) => {
          if (contaminated[fp.name]) contaminated[fp.name].trCount++;
        });
      } else {
        freshTotal++;
        const reason = r._freshReason || r._trendSelectionCategory || '';
        if (reason.includes('High MPR')) freshHigh++;
        else if (reason.includes('Low MPR')) freshLow++;
        else if (reason.includes('Random')) freshRand++;
        else freshFallback++;
      }
    });

    return {
      contaminated: Object.values(contaminated).filter(c => c.bgCount > 0),
      fresh: { freshHigh, freshLow, freshRand, freshFallback, freshTotal }
    };
  }, [currentFilteredData, selectedTrendStations, activeSet]);

  // Export fully detailed report
  const exportMultiSheet = () => {
    const wb = XLSX.utils.book_new();

    // 1. Raw detailed rows
    const rawExport = currentFilteredData.map(r => {
      const { failedParams, failCount, _latNum, _lonNum, _mprScoreNum, _districtMprRank, _trendSelectionCategory, _trendSelectionMode, _contamReason, _freshReason, _isTrendStation, ...rest } = r;
      return {
        ...rest,
        'MPR Score': calculateMPR(r),
        'Compliance Status': failCount === 0 ? 'Uncontaminated' : 'Contaminated',
        'Failed Parameters List': failedParams.map(p => p.name).join(', '),
        'Exceedances': failedParams.map(p => `${p.name} (${p.val.toFixed(getDecimalForParam(p.name))} ${p.unit})`).join(', ')
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawExport), "Detailed Well Log");

    // 2. Combo breakdown matrix
    const comboExport = comboAnalysis.map(c => ({
      'Combination': c.key,
      'Number of Sites': c.count,
      'Percentage (%)': c.percentage
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(comboExport), "Combination Matrix");

    // 3. Selection process log
    const logExport = trendProcessLog.map(l => ({
      'State': l.state,
      'District': l.district,
      'BG Wells': l.totalBg,
      'Contam Ratio': l.contamRatio,
      'Quota': l.quota,
      'Selection Mode': l.mode,
      'Phase 1 Picked': l.p1Contam,
      'Phase 2 High MPR': l.p2High,
      'Phase 2 Low MPR': l.p2Low,
      'Phase 2 Spatial': l.p2Rand,
      'Fallback Picked': l.fallback,
      'Total Selected': l.totalSelected
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(logExport), "Selection Log");

    XLSX.writeFile(wb, "Groundwater_Combination_Report.xlsx");
  };

  const calculateMPR = (r: any) => {
    const columns = Object.keys(activeParams).some(k => activeParams[k])
      ? Object.keys(activeParams).filter(k => activeParams[k])
      : Object.keys(PARAM_CONFIG).filter(p => !!columnMapping[p]);

    if (columns.length === 0) return "-";
    let sum = 0;
    columns.forEach(p => {
      const col = columnMapping[p];
      if (col) {
        const val = parseFloat(r[col]);
        if (!isNaN(val)) {
          sum += (val / PARAM_CONFIG[p].b2);
        }
      }
    });
    return (sum / columns.length).toFixed(4);
  };

  // Pure CSS conic gradient donut calculation helper
  const donutGradientString = useMemo(() => {
    const total = currentFilteredData.length;
    if (total === 0) return '#cbd5e1';
    let accum = 0;
    const colors = ['#10b981', '#f59e0b', '#ef4444'];
    const parts = chartData.donut.map((item, idx) => {
      const start = accum;
      accum += (item.value / total) * 100;
      return `${colors[idx]} ${start}% ${accum}%`;
    });
    return `conic-gradient(${parts.join(', ')})`;
  }, [chartData.donut, currentFilteredData]);

  // Max value helper for bar chart height calculation
  const maxExceedanceValue = useMemo(() => {
    return Math.max(...chartData.bar.map(b => Math.max(b.Background, b.Trend)), 1);
  }, [chartData.bar]);

  return (
    <div className="flex flex-col xl:flex-row gap-6 w-full text-slate-800">
      
      {/* 1. Filtering & Strategy Sidebar */}
      <div className="w-full xl:w-80 shrink-0 bg-slate-900 text-white rounded-3xl p-5 flex flex-col gap-6 shadow-xl border border-slate-800">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="bg-indigo-600 text-white p-2 rounded-xl">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black tracking-tight">समग्र संयोजन विश्लेषण</h2>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Combination & Trend Control</p>
          </div>
        </div>

        {/* Selected parameters isolation */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-wider">1. Parameters Isolation</span>
            <button 
              onClick={toggleAllParams}
              className="text-[9px] font-bold text-slate-400 hover:text-white px-2 py-0.5 bg-slate-800 rounded transition-colors"
            >
              Toggle All
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto pr-1">
            {Object.keys(PARAM_CONFIG).filter(p => !!columnMapping[p]).map(p => {
              const active = activeParams[p];
              return (
                <button
                  key={p}
                  onClick={() => setActiveParams(prev => ({ ...prev, [p]: !prev[p] }))}
                  className={`py-1 text-[10px] font-bold border rounded-lg transition-all ${
                    active ? 'bg-indigo-600 text-white border-indigo-500' : 'border-slate-800 bg-slate-800/50 text-slate-400 hover:text-white'
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input 
              type="checkbox" 
              checked={strictData} 
              onChange={e => setStrictData(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0" 
            />
            <span className="text-[10px] font-bold text-slate-300">Strict Data (Require values for all)</span>
          </label>
        </div>

        {/* Allocation Strategy */}
        <div className="border-t border-slate-800 pt-4">
          <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider block mb-3">2. Trend Quota Strategy</span>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-[10px] text-slate-400 font-bold mb-1">
                <span>Base Allocation:</span>
                <span className="text-white font-black">{normalSamplePerc}%</span>
              </div>
              <input 
                type="range" min="5" max="100" step="5" value={normalSamplePerc}
                onChange={e => setNormalSamplePerc(parseInt(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>

            {/* Low Sample Threshold */}
            <div className="bg-slate-800/40 p-3 rounded-2xl border border-slate-800/60 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" checked={lowSampleRule} onChange={e => setLowSampleRule(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0" 
                />
                <span className="text-[10px] font-bold text-slate-200 uppercase tracking-wider">District Low Sample Rule</span>
              </label>
              
              {lowSampleRule && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <span className="text-[8px] text-slate-400 font-bold block uppercase">If Samples &lt;</span>
                    <input 
                      type="number" value={lowSampleThreshold} onChange={e => setLowSampleThreshold(parseInt(e.target.value) || 2)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-white text-center font-bold"
                    />
                  </div>
                  <div>
                    <span className="text-[8px] text-slate-400 font-bold block uppercase">Select Wells %</span>
                    <input 
                      type="number" value={lowSamplePerc} onChange={e => setLowSamplePerc(parseInt(e.target.value) || 100)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-white text-center font-bold"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Spatial Rule */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
                <span>Min Spatial Distance:</span>
                <span className="text-emerald-400 font-black">{spatialRadius} km</span>
              </div>
              <input 
                type="range" min="0" max="25" step="1" value={spatialRadius}
                onChange={e => setSpatialRadius(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
              {spatialRadius > 0 && uniqueStatesList.length > 0 && (
                <div className="pt-2">
                  <span className="text-[8px] text-slate-400 font-bold uppercase block mb-1">Exempt States (No Spatial Rule)</span>
                  <div className="max-h-24 overflow-y-auto border border-slate-800 rounded-lg p-1.5 bg-slate-950/60 flex flex-wrap gap-1">
                    {uniqueStatesList.map(st => {
                      const exempt = exemptedStates.includes(st);
                      return (
                        <button
                          key={st}
                          onClick={() => {
                            if (exempt) setExemptedStates(prev => prev.filter(s => s !== st));
                            else setExemptedStates(prev => [...prev, st]);
                          }}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-bold border transition-colors ${
                            exempt ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-800 text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {st}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer info stats */}
        <div className="mt-auto border-t border-slate-800 pt-4 text-center">
          <div className="bg-slate-950/60 p-2.5 rounded-2xl flex justify-between items-center border border-slate-800">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Matched wells</span>
            <span className="text-xs font-black text-indigo-400">{currentFilteredData.length} / {rawData.length}</span>
          </div>
        </div>
      </div>

      {/* 2. Map & Main Report Sections */}
      <div className="flex-1 flex flex-col gap-6">

        {/* Map Header and View */}
        <div className="bg-white rounded-3xl p-4 border border-slate-100 shadow-sm relative">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-50 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-indigo-50 rounded-xl text-indigo-600"><MapPin className="w-4 h-4" /></span>
              <div>
                <h3 className="text-xs font-black tracking-tight text-slate-800 uppercase">Interactive Network Map</h3>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Compliance vs Trend visualization</p>
              </div>
            </div>

            {/* Map theme controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Map modes toggle */}
              <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200">
                {(['compliance', 'trend', 'phase'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMapMode(m)}
                    className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                      mapMode === m ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {m === 'compliance' ? 'Compliance' : m === 'trend' ? 'Trend Network' : 'Phases'}
                  </button>
                ))}
              </div>

              {/* Map style theme selector */}
              <select
                value={mapTheme}
                onChange={e => setMapTheme(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-[9px] font-black uppercase tracking-wider outline-none text-slate-600"
              >
                <option value="light">Classic Light</option>
                <option value="satellite">Satellite View</option>
                <option value="terrain">Terrain Map</option>
              </select>
            </div>
          </div>

          {/* Leaflet container */}
          <div className="w-full h-[360px] rounded-2xl overflow-hidden shadow-inner border border-slate-100 relative">
            <div ref={mapRef} className="w-full h-full absolute inset-0 z-10" />

            {/* Map point slider control overlay */}
            <div className="absolute bottom-4 right-4 z-20 bg-white/95 backdrop-blur p-2.5 rounded-2xl shadow-xl border border-slate-100 flex items-center gap-3">
              <span className="text-[8px] font-black uppercase tracking-wider text-slate-400">Pt. Size</span>
              <input 
                type="range" min="3" max="15" value={pointSize} onChange={e => setPointSize(parseInt(e.target.value))}
                className="w-20 accent-indigo-600"
              />
            </div>
          </div>

          {/* Legend and stats row */}
          <div className="mt-3 bg-slate-50 rounded-2xl p-3 border border-slate-100 flex flex-wrap gap-4 items-center justify-between text-[10px]">
            {mapMode === 'compliance' && (
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-600">
                  <input type="checkbox" checked={mapStatusFilters.clean} onChange={e => setMapStatusFilters(prev => ({ ...prev, clean: e.target.checked }))} className="w-3 h-3 text-emerald-500 rounded focus:ring-0" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" /> Compliant
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-600">
                  <input type="checkbox" checked={mapStatusFilters.single} onChange={e => setMapStatusFilters(prev => ({ ...prev, single: e.target.checked }))} className="w-3 h-3 text-amber-500 rounded focus:ring-0" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" /> Single Fail
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-600">
                  <input type="checkbox" checked={mapStatusFilters.multi} onChange={e => setMapStatusFilters(prev => ({ ...prev, multi: e.target.checked }))} className="w-3 h-3 text-rose-500 rounded focus:ring-0" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" /> Multi Fail
                </label>
              </div>
            )}

            {mapMode === 'trend' && (
              <div className="flex flex-wrap items-center gap-4">
                <span className="font-bold uppercase text-[9px] text-slate-400 border-r border-slate-200 pr-3">Trend Stations</span>
                <span className="flex items-center gap-1 font-bold text-emerald-700"><span className="w-2 h-2 rounded-full bg-[#10b981]" /> Clean</span>
                <span className="flex items-center gap-1 font-bold text-amber-700"><span className="w-2 h-2 rounded-full bg-[#f59e0b]" /> Single</span>
                <span className="flex items-center gap-1 font-bold text-rose-700"><span className="w-2 h-2 rounded-full bg-[#ef4444]" /> Multi</span>
                <span className="text-[9px] text-slate-400 font-bold pl-3 border-l border-slate-200">Selected: <strong className="text-indigo-600 font-black">{selectedTrendStations.length}</strong></span>
              </div>
            )}

            {mapMode === 'phase' && (
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-1 font-bold text-slate-700"><span className="w-2 h-2 rounded-full bg-[#ef4444]" /> Phase 1 (Worst)</span>
                <span className="flex items-center gap-1 font-bold text-slate-700"><span className="w-2 h-2 rounded-full bg-[#f59e0b]" /> Phase 2 (High MPR)</span>
                <span className="flex items-center gap-1 font-bold text-slate-700"><span className="w-2 h-2 rounded-full bg-[#3b82f6]" /> Phase 2 (Low MPR)</span>
                <span className="flex items-center gap-1 font-bold text-slate-700"><span className="w-2 h-2 rounded-full bg-[#10b981]" /> Phase 2 (Spatial)</span>
                <span className="flex items-center gap-1 font-bold text-slate-700"><span className="w-2 h-2 rounded-full bg-[#8b5cf6]" /> Fallback</span>
              </div>
            )}
          </div>
        </div>

        {/* 3. Detailed Analytics tabs and tables */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          
          {/* Scrollable Tab header */}
          <div className="flex border-b border-slate-100 overflow-x-auto bg-slate-50/50 p-2 gap-1 scrollbar-none">
            {[
              { id: "overview", label: "Overview", icon: Table },
              { id: "bganalysis", label: "BG Analysis", icon: Info },
              { id: "state", label: "States Severity", icon: Layers },
              { id: "district", label: "Districts Severity", icon: Layers },
              { id: "trend", label: "Trend Wells", icon: Network },
              { id: "tstate", label: "Tr-State Summary", icon: Table },
              { id: "tdist", label: "Tr-Dist Summary", icon: Table },
              { id: "modesummary", label: "Mode Summary", icon: Table },
              { id: "exceedance", label: "BG vs Tr Charts", icon: Sparkles },
              { id: "results", label: "Results Log", icon: CheckCircle },
              { id: "process", label: "Process Log", icon: SlidersHorizontal },
              { id: "criteria", label: "Selection Criteria", icon: SlidersHorizontal },
              { id: "methodology", label: "Methodology", icon: BookOpen }
            ].map(t => {
              const TabIcon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shrink-0 transition-all ${
                    activeTab === t.id 
                      ? 'bg-white shadow-sm border border-slate-100 text-indigo-600' 
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                  }`}
                >
                  <TabIcon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}

            {/* Excel Download button at header end */}
            <button 
              onClick={exportMultiSheet}
              className="ml-auto bg-emerald-600 text-white hover:bg-emerald-700 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shrink-0 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Export Multi-Sheet
            </button>
          </div>

          {/* Active Tab contents */}
          <div className="p-6 overflow-x-auto min-h-[300px]">

            {/* TAB 1: OVERVIEW */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Conic Gradient Donut Chart */}
                  <div className="border border-slate-100 rounded-3xl p-5 flex flex-col items-center">
                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">Severity Matrix</span>
                    
                    <div className="w-full flex justify-center py-4">
                      <div 
                        className="w-36 h-36 rounded-full flex items-center justify-center relative shadow-md transition-all duration-300"
                        style={{ background: donutGradientString }}
                      >
                        <div className="w-24 h-24 rounded-full bg-white flex flex-col items-center justify-center shadow-inner">
                          <span className="text-xl font-black text-slate-800">{currentFilteredData.length}</span>
                          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Total Wells</span>
                        </div>
                      </div>
                    </div>

                    {/* Donut legend */}
                    <div className="w-full space-y-1.5 mt-4">
                      {chartData.donut.map((item, i) => (
                        <div key={item.name} className="flex justify-between items-center text-[10px] font-bold p-1.5 rounded-lg border border-slate-50 bg-slate-50/50">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: i === 0 ? '#10b981' : i === 1 ? '#f59e0b' : '#ef4444' }} />
                            {item.name}
                          </span>
                          <span className="text-slate-900 font-black">{item.value} ({item.percentage}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Combination Lists */}
                  <div className="border border-slate-100 rounded-3xl p-5 flex flex-col">
                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-3 block">Exceedance Combo Breakdown</span>
                    <div className="flex-1 overflow-y-auto max-h-[300px] space-y-2 pr-1">
                      {comboAnalysis.length > 0 ? (
                        comboAnalysis.map(c => (
                          <div key={c.key} className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 flex justify-between items-center text-[10px]">
                            <div>
                              <strong className="text-slate-800 uppercase block">{c.key}</strong>
                              <span className="text-[9px] text-slate-400 font-bold uppercase">{c.key.split('+').length} params fail</span>
                            </div>
                            <div className="text-right ml-4">
                              <span className="text-indigo-600 font-black block">{c.count} Sites</span>
                              <span className="text-[8px] bg-indigo-50 text-indigo-700 px-1 rounded font-black">{c.percentage}%</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-[10px] text-slate-400 font-medium italic p-4 text-center">No contamination combinations detected with current filters.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Top 50 Well log table */}
                <div className="border border-slate-100 rounded-3xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                    Recent well records (Top 50)
                  </div>
                  <table className="w-full text-left text-[11px] whitespace-nowrap">
                    <thead className="bg-slate-900 text-white text-[9px] font-black uppercase">
                      <tr>
                        <th className="p-2.5">Location</th>
                        <th className="p-2.5">State</th>
                        <th className="p-2.5">District</th>
                        <th className="p-2.5 text-center">Failed Count</th>
                        <th className="p-2.5">Failed Parameters</th>
                        <th className="p-2.5 text-right">MPR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-600">
                      {currentFilteredData.slice(0, 50).map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-2.5 font-black text-slate-800">{r[columnMapping['Station']] || 'Well'}</td>
                          <td className="p-2.5">{r[columnMapping['State']] || '-'}</td>
                          <td className="p-2.5">{r[columnMapping['District']] || '-'}</td>
                          <td className="p-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${
                              r.failCount === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                            }`}>{r.failCount}</span>
                          </td>
                          <td className="p-2.5 text-rose-600 max-w-[150px] truncate" title={r.failedParams.map((p: any) => p.name).join(', ')}>
                            {r.failedParams.map((p: any) => p.name).join(', ') || 'None'}
                          </td>
                          <td className="p-2.5 text-right font-black">{r._mprScoreNum.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 2: BG ANALYSIS */}
            {activeTab === "bganalysis" && (
              <div className="space-y-6">
                <div className="bg-slate-800 text-white p-4 rounded-2xl flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider">Analysis of Background Monitoring Stations</h4>
                    <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">National exceedance metrics overview</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Data Table */}
                  <div className="lg:col-span-2 border border-slate-100 rounded-3xl overflow-hidden">
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead className="bg-[#e9eef7] text-slate-800 text-[10px] font-black border-b border-slate-200">
                        <tr>
                          <th className="p-3 border-r border-slate-200 text-center">Sl No</th>
                          <th className="p-3 border-r border-slate-200">State / UT Name</th>
                          <th className="p-3 border-r border-slate-200 text-center">Total Background</th>
                          <th className="p-3 border-r border-slate-200 text-center">Exceeding</th>
                          <th className="p-3 border-r border-slate-200 text-center">Within Limits</th>
                          <th className="p-3 text-center">% Exceeds</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                        {stateStats.map((st, idx) => {
                          const contam = st.total - st.clean;
                          const perc = st.total > 0 ? ((contam / st.total) * 100).toFixed(1) : "0";
                          return (
                            <tr key={st.state} className="hover:bg-slate-50/50">
                              <td className="p-2.5 border-r border-slate-100">{idx + 1}</td>
                              <td className="p-2.5 border-r border-slate-100 text-left font-black text-slate-800">{st.state}</td>
                              <td className="p-2.5 border-r border-slate-100">{st.total}</td>
                              <td className="p-2.5 border-r border-slate-100 text-rose-600">{contam}</td>
                              <td className="p-2.5 border-r border-slate-100 text-emerald-600">{st.clean}</td>
                              <td className="p-2.5 font-black text-slate-800">{perc}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {/* Grand National Total */}
                      <tfoot className="bg-[#ffff00] text-black font-black text-[11px] border-t-2 border-slate-300 text-center">
                        <tr>
                          <td className="p-3 border-r border-slate-300 text-left" colSpan={2}>Grand National Average</td>
                          <td className="p-3 border-r border-slate-300">{currentFilteredData.length}</td>
                          <td className="p-3 border-r border-slate-300 text-rose-700">
                            {currentFilteredData.filter(r => r.failCount > 0).length}
                          </td>
                          <td className="p-3 border-r border-slate-300 text-emerald-700">
                            {currentFilteredData.filter(r => r.failCount === 0).length}
                          </td>
                          <td className="p-3">
                            {currentFilteredData.length > 0 
                              ? ((currentFilteredData.filter(r => r.failCount > 0).length / currentFilteredData.length) * 100).toFixed(1) 
                              : "0"}%
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Right Column: Hydrogeochemical Description text matching PDF exactly */}
                  <div className="bg-slate-50 border border-slate-100 rounded-3xl p-5 space-y-4 text-[11px] leading-relaxed text-slate-700 font-medium">
                    <h5 className="font-black text-xs text-indigo-900 border-b border-indigo-100 pb-2 mb-2">Selection Insight</h5>
                    <p>
                      <strong>{currentFilteredData.filter(r => r.failCount > 0).length.toLocaleString()} stations</strong> of background monitoring wells exceed at least one chemical parameter above permissible limits.
                    </p>
                    <hr className="border-slate-150" />
                    <p>
                      The remaining <strong>{currentFilteredData.filter(r => r.failCount === 0).length.toLocaleString()} stations</strong> remain completely clean and comply with active standards.
                    </p>
                    <hr className="border-slate-150" />
                    <p>
                      Both groups of stations—exceeding and clean—serve vital roles: the clean wells provide crucial control points for pristine baseline tracking, while contaminated wells enable proactive safety monitoring.
                    </p>
                    <hr className="border-slate-150" />
                    <p className="text-[10px] text-slate-400 italic font-bold">
                      * Filtered on {activeSet.length} active chemical parameters in this analysis view.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: STATE BREAKDOWN */}
            {activeTab === "state" && (
              <div className="border border-slate-100 rounded-3xl overflow-hidden">
                <table className="w-full text-left text-[11px] border-collapse animate-[fadeIn_0.2s_ease-out]">
                  <thead className="bg-slate-900 text-white text-[9px] font-black uppercase">
                    <tr>
                      <th className="p-3">State</th>
                      <th className="p-3 text-center">Total Background</th>
                      <th className="p-3 text-center text-emerald-400">Clean (0)</th>
                      <th className="p-3 text-center text-amber-400">1 Param Exceeded</th>
                      <th className="p-3 text-center text-orange-400">2 Params</th>
                      <th className="p-3 text-center text-rose-400">3 Params</th>
                      <th className="p-3 text-center text-red-500">4+ Params</th>
                      <th className="p-3">Contaminants List</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-600">
                    {stateStats.map(st => (
                      <tr key={st.state} className="hover:bg-slate-50/50">
                        <td className="p-3 font-black text-slate-800">{st.state}</td>
                        <td className="p-3 text-center bg-slate-50/50">{st.total}</td>
                        <td className="p-3 text-center text-emerald-600 bg-emerald-50/10">
                          {st.clean} ({st.total > 0 ? ((st.clean / st.total) * 100).toFixed(0) : 0}%)
                        </td>
                        <td className="p-3 text-center text-amber-600 bg-amber-50/10">
                          {st.one} ({st.total > 0 ? ((st.one / st.total) * 100).toFixed(0) : 0}%)
                        </td>
                        <td className="p-3 text-center text-orange-600 bg-orange-50/10">
                          {st.two} ({st.total > 0 ? ((st.two / st.total) * 100).toFixed(0) : 0}%)
                        </td>
                        <td className="p-3 text-center text-rose-600 bg-rose-50/10">
                          {st.three} ({st.total > 0 ? ((st.three / st.total) * 100).toFixed(0) : 0}%)
                        </td>
                        <td className="p-3 text-center text-red-600 bg-red-50/10">
                          {st.fourPlus} ({st.total > 0 ? ((st.fourPlus / st.total) * 100).toFixed(0) : 0}%)
                        </td>
                        <td className="p-3 text-[10px] text-slate-400 truncate max-w-[150px]" title={Array.from(st.params).join(', ')}>
                          {Array.from(st.params).join(', ') || 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 4: DISTRICT BREAKDOWN */}
            {activeTab === "district" && (
              <div className="border border-slate-100 rounded-3xl overflow-hidden">
                <table className="w-full text-left text-[11px] border-collapse animate-[fadeIn_0.2s_ease-out]">
                  <thead className="bg-slate-900 text-white text-[9px] font-black uppercase">
                    <tr>
                      <th className="p-3">State</th>
                      <th className="p-3">District</th>
                      <th className="p-3 text-center">Total Background</th>
                      <th className="p-3 text-center text-emerald-400">Clean (0)</th>
                      <th className="p-3 text-center text-amber-400">1 Param</th>
                      <th className="p-3 text-center text-orange-400">2 Params</th>
                      <th className="p-3 text-center text-rose-400">3 Params</th>
                      <th className="p-3 text-center text-red-500">4+ Params</th>
                      <th className="p-3 text-center">Contam Ratio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-600">
                    {districtStats.map((dt, i) => {
                      const contamRatio = dt.total > 0 ? (dt.total - dt.clean) / dt.total : 0;
                      return (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="p-3">{dt.state}</td>
                          <td className="p-3 font-black text-slate-800">{dt.district}</td>
                          <td className="p-3 text-center bg-slate-50/50">{dt.total}</td>
                          <td className="p-3 text-center text-emerald-600">{dt.clean}</td>
                          <td className="p-3 text-center text-amber-600">{dt.one}</td>
                          <td className="p-3 text-center text-orange-600">{dt.two}</td>
                          <td className="p-3 text-center text-rose-600">{dt.three}</td>
                          <td className="p-3 text-center text-red-600">{dt.fourPlus}</td>
                          <td className="p-3 text-center bg-indigo-50/30">
                            <span className="font-black text-indigo-700 text-xs block">{contamRatio.toFixed(2)}</span>
                            <span className="text-[7px] text-slate-400 uppercase font-black block">
                              {contamRatio === 0 ? 'Pristine' : contamRatio <= 0.2 ? 'Low' : contamRatio <= 0.5 ? 'Moderate' : 'Contam'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 5: TREND STATIONS LIST */}
            {activeTab === "trend" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Trend Monitoring Stations Network</span>
                  <span className="text-xs font-black bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-1 rounded-full animate-[fadeIn_0.2s_ease-out]">
                    {selectedTrendStations.length} of {currentFilteredData.length} wells selected
                  </span>
                </div>
                <div className="border border-slate-100 rounded-3xl overflow-hidden">
                  <table className="w-full text-left text-[11px] border-collapse whitespace-nowrap">
                    <thead className="bg-slate-900 text-white text-[9px] font-black uppercase">
                      <tr>
                        <th className="p-3">State</th>
                        <th className="p-3">District</th>
                        <th className="p-3">Well Name</th>
                        <th className="p-3 text-center">Monitoring Class</th>
                        <th className="p-3">Failed Parameters</th>
                        <th className="p-3 text-center">MPR</th>
                        <th className="p-3 text-center">District Rank</th>
                        <th className="p-3">Selection Category</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-600">
                      {currentFilteredData.map((r, idx) => (
                        <tr key={idx} className={`hover:bg-slate-50/50 ${r._isTrendStation ? 'bg-indigo-50/20' : ''}`}>
                          <td className="p-3">{r[columnMapping['State']] || 'Unknown'}</td>
                          <td className="p-3">{r[columnMapping['District']] || 'Unknown'}</td>
                          <td className="p-3 font-black text-slate-800">{r[columnMapping['Station']] || 'Well'}</td>
                          <td className="p-3 text-center">
                            <span className={`px-2.5 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-wider block ${
                              r._isTrendStation 
                                ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' 
                                : 'bg-slate-100 text-slate-400'
                            }`}>
                              {r._isTrendStation ? 'Trend' : 'Background'}
                            </span>
                          </td>
                          <td className="p-3 text-rose-600 font-bold max-w-[120px] truncate" title={r.failedParams.map((p: any) => p.name).join(', ')}>
                            {r.failedParams.map((p: any) => p.name).join(', ') || '-'}
                          </td>
                          <td className="p-3 text-center font-black text-slate-700">{r._mprScoreNum.toFixed(4)}</td>
                          <td className="p-3 text-center text-slate-400">#{r._districtMprRank}</td>
                          <td className="p-3 text-xs max-w-[150px] truncate font-black text-slate-500" title={r._trendSelectionCategory}>
                            {r._trendSelectionCategory || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 6: TR-STATE SUMMARY */}
            {activeTab === "tstate" && (
              <div className="border border-slate-100 rounded-3xl overflow-hidden">
                <table className="w-full text-left text-[11px] border-collapse whitespace-nowrap animate-[fadeIn_0.2s_ease-out]">
                  <thead className="bg-slate-900 text-white text-[9px] font-black uppercase">
                    <tr>
                      <th className="p-3">State</th>
                      <th className="p-3 text-center bg-slate-800">Total BG</th>
                      <th className="p-3 text-center bg-emerald-950 text-emerald-400">Clean</th>
                      <th className="p-3 text-center bg-rose-950 text-rose-400 border-r border-slate-700">Contaminated</th>
                      <th className="p-3 text-center bg-indigo-950 text-indigo-400">Trend Selected</th>
                      <th className="p-3 text-center bg-emerald-950 text-emerald-400">Trend Clean</th>
                      <th className="p-3 text-center bg-rose-950 text-rose-400">Trend Contam</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                    {trendSummaries.states.map(c => (
                      <tr key={c.state} className="hover:bg-slate-50/50">
                        <td className="p-3 text-left font-black text-slate-800">{c.state}</td>
                        <td className="p-3 bg-slate-50/50 font-black">{c.bg}</td>
                        <td className="p-3 text-emerald-600">{c.bgClean}</td>
                        <td className="p-3 text-rose-600 border-r border-slate-100">{c.bg - c.bgClean}</td>
                        <td className="p-3 bg-indigo-50/30 text-indigo-600 font-black">{c.tr}</td>
                        <td className="p-3 text-emerald-600">{c.trClean}</td>
                        <td className="p-3 text-rose-600">{c.tr - c.trClean}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 7: TR-DIST SUMMARY */}
            {activeTab === "tdist" && (
              <div className="border border-slate-100 rounded-3xl overflow-hidden">
                <table className="w-full text-left text-[11px] border-collapse whitespace-nowrap animate-[fadeIn_0.2s_ease-out]">
                  <thead className="bg-slate-900 text-white text-[9px] font-black uppercase">
                    <tr>
                      <th className="p-3">State</th>
                      <th className="p-3">District</th>
                      <th className="p-3 text-center bg-slate-800">Total BG</th>
                      <th className="p-3 text-center text-emerald-500">Clean</th>
                      <th className="p-3 text-center text-rose-500 border-r border-slate-700">Contaminated</th>
                      <th className="p-3 text-center bg-indigo-950 text-indigo-400">Trend Selected</th>
                      <th className="p-3 text-center text-emerald-500">Trend Clean</th>
                      <th className="p-3 text-center text-rose-500">Trend Contam</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                    {trendSummaries.districts.map((c, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="p-3 text-left">{c.state}</td>
                        <td className="p-3 text-left font-black text-slate-800">{c.district}</td>
                        <td className="p-3 bg-slate-50/50 font-black">{c.bg}</td>
                        <td className="p-3 text-emerald-600">{c.bgClean}</td>
                        <td className="p-3 text-rose-600 border-r border-slate-100">{c.bg - c.bgClean}</td>
                        <td className="p-3 bg-indigo-50/30 text-indigo-600 font-black">{c.tr}</td>
                        <td className="p-3 text-emerald-600">{c.trClean}</td>
                        <td className="p-3 text-rose-600">{c.tr - c.trClean}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 8: SUMMARY BY MODE */}
            {activeTab === "modesummary" && (
              <div className="border border-slate-100 rounded-3xl overflow-hidden">
                <table className="w-full text-left text-[11px] border-collapse whitespace-nowrap animate-[fadeIn_0.2s_ease-out]">
                  <thead className="bg-[#4a72b5] text-white text-[10px] font-black">
                    <tr>
                      <th className="p-3 border-r border-blue-400/30 text-center">Contam Ratio</th>
                      <th className="p-3 border-r border-blue-400/30">Selection Mode Name</th>
                      <th className="p-3 border-r border-blue-400/30 text-center">Districts Count</th>
                      <th className="p-3 border-r border-blue-400/30 text-center">BG Stations</th>
                      <th className="p-3 border-r border-blue-400/30 text-center">Contam Selected</th>
                      <th className="p-3 border-r border-blue-400/30 text-center">Fresh Selected</th>
                      <th className="p-3 border-r border-blue-400/30 text-center">Total Trend Selected</th>
                      <th className="p-3 text-center">% of BG</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 font-bold text-slate-600 text-center">
                    {modeSummaryList.map(m => {
                      const perc = m.bgTotal > 0 ? ((m.trTotal / m.bgTotal) * 100).toFixed(1) : 0;
                      return (
                        <tr key={m.key} className="hover:bg-slate-50/50">
                          <td className="p-3 border-r border-slate-100 font-black">{m.label}</td>
                          <td className="p-3 border-r border-slate-100 text-left font-black text-slate-800">{m.key}</td>
                          <td className="p-3 border-r border-slate-100 text-indigo-600">{m.districts}</td>
                          <td className="p-3 border-r border-slate-100">{m.bgTotal}</td>
                          <td className="p-3 border-r border-slate-100 text-rose-600">{m.trContam}</td>
                          <td className="p-3 border-r border-slate-100 text-emerald-600">{m.trFresh}</td>
                          <td className="p-3 border-r border-slate-100 font-black text-slate-900 bg-slate-50/50">{m.trTotal}</td>
                          <td className="p-3 font-black text-indigo-700">{perc}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 9: EXCEEDANCE CHARTS */}
            {activeTab === "exceedance" && (
              <div className="space-y-6">
                {/* Pure Custom SVG & HTML Interactive bar chart */}
                <div className="border border-slate-100 rounded-3xl p-5 relative bg-white pb-6">
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest block mb-4">Background vs Trend Exceedance Ratio</span>
                  
                  <div className="w-full flex flex-col justify-end pt-6">
                    <div className="flex items-end justify-between gap-6 px-4 border-b border-slate-200 pb-2">
                      {chartData.bar.map((b, idx) => (
                        <div key={idx} className="flex-1 flex flex-col items-center group">
                          {/* Bars Pair Container */}
                          <div className="w-full flex items-end justify-center gap-1.5 h-48 relative">
                            
                            {/* Background Bar */}
                            <div className="flex-1 flex flex-col justify-end h-full">
                              <div className="text-[9px] font-black text-[#2c4b82] text-center mb-1">
                                {b.Background}
                              </div>
                              <div 
                                className="w-full bg-[#4a72b5] hover:bg-[#3b5e9b] rounded-t transition-all duration-300 shadow-sm"
                                style={{ height: `${(b.Background / maxExceedanceValue) * 100}%` }}
                              />
                            </div>
                            
                            {/* Trend Bar */}
                            <div className="flex-1 flex flex-col justify-end h-full">
                              <div className="text-[9px] font-black text-[#873230] text-center mb-1">
                                {b.Trend}
                              </div>
                              <div 
                                className="w-full bg-[#c0504d] hover:bg-[#a93e3b] rounded-t transition-all duration-300 shadow-sm"
                                style={{ height: `${(b.Trend / maxExceedanceValue) * 100}%` }}
                              />
                            </div>
                          </div>
                          {/* Label */}
                          <span className="text-[10px] font-black text-slate-500 uppercase mt-2 tracking-wider">
                            {b.name}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-center gap-6 mt-4 text-[10px] font-black">
                      <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[#4a72b5] rounded-sm" /> Background Stations</div>
                      <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[#c0504d] rounded-sm" /> Trend Stations</div>
                    </div>
                  </div>
                </div>

                <div className="border border-slate-100 rounded-3xl overflow-hidden mt-6">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-[#4a72b5] text-white text-[10px] font-black">
                      <tr>
                        <th className="p-3">Parameters Exceeded Number</th>
                        <th className="p-3 text-center">Background Wells</th>
                        <th className="p-3 text-center">Trend Selected Wells</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                      {chartData.bar.map((b, i) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="p-3 text-left font-black text-slate-800">{b.name} Exceedance</td>
                          <td className="p-3 text-blue-700">{b.Background}</td>
                          <td className="p-3 text-rose-700 font-black">{b.Trend}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 10: RESULTS STATE TARGETS */}
            {activeTab === "results" && (
              <div className="border border-slate-100 rounded-3xl overflow-hidden animate-[fadeIn_0.2s_ease-out]">
                <table className="w-full text-left text-[11px] border-collapse whitespace-nowrap">
                  <thead className="bg-[#1f3864] text-white text-[10px] font-black">
                    <tr>
                      <th className="p-3 text-center">Sl No</th>
                      <th className="p-3">State / UT Name</th>
                      <th className="p-3 text-center">Total Background</th>
                      <th className="p-3 text-center">Exceeding standard</th>
                      <th className="p-3 text-center">Required Target</th>
                      <th className="p-3 text-center text-rose-400">Selected Contaminated</th>
                      <th className="p-3 text-center text-emerald-400">Selected Fresh</th>
                      <th className="p-3 text-center">Actual Total Selected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                    {trendSummaries.states.map((st, idx) => {
                      const req = globalStateRequiredCache[st.state] || 0;
                      return (
                        <tr key={st.state} className="hover:bg-slate-50/50">
                          <td className="p-2.5">{idx + 1}</td>
                          <td className="p-2.5 text-left font-black text-slate-800">{st.state}</td>
                          <td className="p-2.5">{st.bg}</td>
                          <td className="p-2.5 text-rose-600">{st.bg - st.bgClean}</td>
                          <td className="p-2.5 text-indigo-600">{req}</td>
                          <td className="p-2.5 text-rose-600">{st.tr - st.trClean}</td>
                          <td className="p-2.5 text-emerald-600">{st.trClean}</td>
                          <td className="p-2.5 font-black text-slate-900 bg-slate-50/50">{st.tr}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 11: SELECTION PROCESS LOG */}
            {activeTab === "process" && (
              <div className="border border-slate-100 rounded-3xl overflow-hidden animate-[fadeIn_0.2s_ease-out]">
                <table className="w-full text-left text-[11px] border-collapse whitespace-nowrap">
                  <thead className="bg-slate-900 text-white text-[9px] font-black uppercase">
                    <tr>
                      <th className="p-2.5">State</th>
                      <th className="p-2.5">District</th>
                      <th className="p-2.5 text-center">Total BG</th>
                      <th className="p-2.5 text-center">Contam Ratio</th>
                      <th className="p-2.5 text-center text-indigo-400">Target Quota</th>
                      <th className="p-2.5">Selection Mode</th>
                      <th className="p-2.5 text-center text-rose-400">P1 (Contam)</th>
                      <th className="p-2.5 text-center text-emerald-400">P2 (High MPR)</th>
                      <th className="p-2.5 text-center text-emerald-400">P2 (Low MPR)</th>
                      <th className="p-2.5 text-center text-emerald-400">P2 (Spatial)</th>
                      <th className="p-2.5 text-center text-amber-500">Fallback</th>
                      <th className="p-2.5 text-center">Total Selected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                    {trendProcessLog.map((log, i) => (
                      <tr key={i} className="hover:bg-slate-50/50">
                        <td className="p-2.5 text-left">{log.state}</td>
                        <td className="p-2.5 text-left font-black text-slate-800">{log.district}</td>
                        <td className="p-2.5 bg-slate-50/50">{log.totalBg}</td>
                        <td className="p-2.5 text-slate-400">{log.contamRatio}</td>
                        <td className="p-2.5 font-black text-indigo-600">{log.quota}</td>
                        <td className="p-2.5 text-left text-xs text-slate-500 font-black">{log.mode}</td>
                        <td className="p-2.5 text-rose-600 bg-rose-50/10">{log.p1Contam}</td>
                        <td className="p-2.5 text-emerald-600 bg-emerald-50/10">{log.p2High}</td>
                        <td className="p-2.5 text-emerald-600 bg-emerald-50/5">{log.p2Low}</td>
                        <td className="p-2.5 text-emerald-600 bg-emerald-50/5">{log.p2Rand}</td>
                        <td className="p-2.5 text-amber-600 bg-amber-50/10">{log.fallback}</td>
                        <td className="p-2.5 font-black text-slate-800 bg-slate-100/50">{log.totalSelected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 12: CRITERIA */}
            {activeTab === "criteria" && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-[11px] font-black text-slate-700 uppercase tracking-widest mb-2">1. Contaminated Stations Picked for Trend</h4>
                  <div className="border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[#70ad47] text-white text-[10px] font-black">
                        <tr>
                          <th className="p-3">Parameter Name</th>
                          <th className="p-3 text-center">Permissible Limit</th>
                          <th className="p-3 text-center">Unit</th>
                          <th className="p-3 text-center">Total Contaminated Background</th>
                          <th className="p-3 text-center">Contaminated Selected as Trend</th>
                          <th className="p-3 text-center">% Selected</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                        {criteriaStats.contaminated.map(c => (
                          <tr key={c.name} className="hover:bg-slate-50/50">
                            <td className="p-2.5 text-left font-black text-slate-800">{c.name}</td>
                            <td className="p-2.5 border-r border-slate-100">{c.limit}</td>
                            <td className="p-2.5 border-r border-slate-100">{c.unit || '-'}</td>
                            <td className="p-2.5 border-r border-slate-100 text-slate-700">{c.bgCount}</td>
                            <td className="p-2.5 border-r border-slate-100 text-rose-600">{c.trCount}</td>
                            <td className="p-2.5 font-black text-emerald-600">
                              {c.bgCount > 0 ? ((c.trCount / c.bgCount) * 100).toFixed(0) : 0}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="w-full lg:w-2/3">
                  <h4 className="text-[11px] font-black text-slate-700 uppercase tracking-widest mb-2">2. Fresh Stations Picked for Trend</h4>
                  <div className="border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[#4a72b5] text-white text-[10px] font-black">
                        <tr>
                          <th className="p-3">Allocation Criteria Pool</th>
                          <th className="p-3 text-center">No. of Selected Wells</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                        <tr>
                          <td className="p-3 text-left">Mean Parameter Ratio (MPR) - High (50%)</td>
                          <td className="p-3 font-black text-indigo-600">{criteriaStats.fresh.freshHigh}</td>
                        </tr>
                        <tr>
                          <td className="p-3 text-left">Mean Parameter Ratio (MPR) - Low (20%)</td>
                          <td className="p-3 font-black text-indigo-600">{criteriaStats.fresh.freshLow}</td>
                        </tr>
                        <tr>
                          <td className="p-3 text-left">Wells based on Spatial Distribution (30%)</td>
                          <td className="p-3 font-black text-indigo-600">{criteriaStats.fresh.freshRand}</td>
                        </tr>
                        {criteriaStats.fresh.freshFallback > 0 && (
                          <tr>
                            <td className="p-3 text-left text-amber-600">Spatial Fallback selections</td>
                            <td className="p-3 font-black text-amber-600">{criteriaStats.fresh.freshFallback}</td>
                          </tr>
                        )}
                        <tr className="bg-slate-50 font-black text-slate-800 text-xs">
                          <td className="p-3 text-left uppercase">Total Fresh Stations Selected</td>
                          <td className="p-3 text-center">{criteriaStats.fresh.freshTotal}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 13: METHODOLOGY */}
            {activeTab === "methodology" && (
              <div className="space-y-6 max-w-4xl text-slate-700 leading-relaxed font-medium">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-3 mb-4">
                  <div className="bg-indigo-50 text-indigo-600 p-2 rounded-xl">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Groundwater Monitoring Station Selection Logic</h4>
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">Rigorous mathematical modeling for trend network design</p>
                  </div>
                </div>

                <section className="space-y-3">
                  <h5 className="font-black text-xs text-indigo-900 uppercase tracking-wider">1. The Mean Parameter Ratio (MPR) Model</h5>
                  <p className="text-xs">
                    The MPR (Mean Parameter Ratio) is a critical numerical index that quantifies the baseline contamination load of each monitoring point. It calculates the average ratio of each active chemical constituent against its respective Bureau of Indian Standards (BIS) permissible standard limit.
                  </p>
                  
                  <div className="my-6 p-4 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col items-center">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-3">Formula Representation</span>
                    <div className="flex items-center gap-4 text-base font-serif font-black text-slate-800">
                      <span>MPR</span>
                      <span>=</span>
                      <div className="flex flex-col items-center">
                        <span className="border-b-2 border-slate-800 pb-1 flex items-center gap-1.5 px-3">
                          <span className="text-2xl font-serif">Σ</span>
                          <span className="text-xs flex flex-col items-center">
                            <span>P<sub>i</sub></span>
                            <span className="border-t border-slate-600 pt-0.5 mt-0.5">L<sub>i</sub></span>
                          </span>
                        </span>
                        <span className="pt-1 text-xs">n</span>
                      </div>
                    </div>
                    <div className="w-full max-w-md text-[10px] text-slate-500 mt-4 space-y-1 bg-white p-3 rounded-xl border border-slate-100 font-bold">
                      <div className="flex justify-between"><span>P<sub>i</sub></span> <span>Value of the i-th mapped parameter</span></div>
                      <div className="flex justify-between"><span>L<sub>i</sub></span> <span>Permissible BIS limit of the i-th parameter</span></div>
                      <div className="flex justify-between"><span>n</span> <span>Total count of isolated mapped parameters</span></div>
                    </div>
                  </div>
                </section>

                <section className="space-y-3 pt-4 border-t border-slate-100">
                  <h5 className="font-black text-xs text-emerald-800 uppercase tracking-wider">2. Multi-Mode District Quota Classifications</h5>
                  <p className="text-xs">
                    Each district is dynamically classified into one of four distinct modes depending on its actual contamination ratio (defined as the count of wells with at least one exceedance over the total wells within the district). This classification determines the optimal ratio of contaminated versus fresh wells that should be selected:
                  </p>
                  <div className="border border-slate-100 rounded-3xl overflow-hidden shadow-sm my-4">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[#4a72b5] text-white text-[10px] font-black">
                        <tr>
                          <th className="p-2.5 text-center">Ratio Boundary</th>
                          <th className="p-2.5">Groundwater Quality Mode</th>
                          <th className="p-2.5 text-center">Contam Well Alloc. %</th>
                          <th className="p-2.5 text-center">Fresh Well Alloc. %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                        <tr className="bg-emerald-50/10">
                          <td className="p-2.5 font-black text-emerald-600">0</td>
                          <td className="p-2.5 text-left text-emerald-800">Pristine Groundwater District</td>
                          <td className="p-2.5">0%</td>
                          <td className="p-2.5">100%</td>
                        </tr>
                        <tr className="bg-blue-50/10">
                          <td className="p-2.5 font-black text-blue-600">&gt;0 and ≤0.2</td>
                          <td className="p-2.5 text-left text-blue-800">Low Groundwater Contamination District</td>
                          <td className="p-2.5">50%</td>
                          <td className="p-2.5">50%</td>
                        </tr>
                        <tr className="bg-amber-50/10">
                          <td className="p-2.5 font-black text-amber-600">&gt;0.2 and ≤0.5</td>
                          <td className="p-2.5 text-left text-amber-800">Moderate Groundwater Contamination District</td>
                          <td className="p-2.5">75%</td>
                          <td className="p-2.5">25%</td>
                        </tr>
                        <tr className="bg-rose-50/10">
                          <td className="p-2.5 font-black text-rose-600">&gt;0.5</td>
                          <td className="p-2.5 text-left text-rose-800">Contaminated District</td>
                          <td className="p-2.5">100%</td>
                          <td className="p-2.5">0%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="space-y-3 pt-4 border-t border-slate-100 text-xs">
                  <h5 className="font-black text-xs text-indigo-900 uppercase tracking-wider">3. Advanced Selection Phases</h5>
                  <p>
                    <strong>Phase 1 (Contaminated):</strong> If a district has contaminated wells and a contaminated quota target, the system dynamically clusters wells based on their unique chemical exceedance groups. This ensures that every unique type of groundwater contamination found within the district is proportionally represented by its highest-MPR well, providing absolute diagnostic fidelity.
                  </p>
                  <p>
                    <strong>Phase 2 (Fresh 50/20/30):</strong> Uncontaminated fresh wells are filled using three balanced pools:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 bg-slate-50 p-3 rounded-2xl border border-slate-100 font-bold text-[11px] text-slate-600">
                    <li><strong className="text-slate-800">50% High MPR:</strong> Selects "At-Risk" fresh wells whose parameter levels are closest to failing standards.</li>
                    <li><strong className="text-slate-800">20% Low MPR:</strong> Selects highly pristine wells to serve as absolute baseline controls.</li>
                    <li><strong className="text-slate-800">30% Spatial Random:</strong> Randomly selects wells with geographic spacing (enforced by the spatial radius constraint) to ensure broad geometric grid coverage across the district.</li>
                  </ul>
                </section>
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
}

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { DataHeaders, ShapefileLayer } from "../types";
import { PARAM_CONFIG } from "../data/config";
import { 
  SlidersHorizontal, Download, Layers, Compass, 
  CheckCircle, Table, MapPin, Info
} from "lucide-react";
import * as XLSX from "xlsx";

interface CombinationAnalysisViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState?: string;
  selectedDistrict?: string;
  selectedYear?: string;
  selectedSeason?: string;
  layers?: ShapefileLayer[];
}

export function CombinationAnalysisView({
  rawData,
  headers,
  headerMap,
  selectedState = "",
  selectedDistrict = "",
  selectedYear = "",
  selectedSeason = "",
  layers
}: CombinationAnalysisViewProps) {
  const L = (window as any).L;

  // Active Tab
  const [activeTab, setActiveTab] = useState<string>("overview");

  // Local Filter & Logic states
  const [localState, setLocalState] = useState<string>("All");
  const [localDistrict, setLocalDistrict] = useState<string>("All");
  const [localBlock, setLocalBlock] = useState<string>("All");
  const [localSource, setLocalSource] = useState<string>("All");
  const [localAquifer, setLocalAquifer] = useState<string>("All");
  const [localYear, setLocalYear] = useState<string>("All");
  const [localSeason, setLocalSeason] = useState<string>("All");

  const [activeParams, setActiveParams] = useState<Record<string, boolean>>({});
  const [strictData, setStrictData] = useState<boolean>(false);

  // Synchronize local filter state with globally passed selected props
  useEffect(() => {
    setLocalState(selectedState || "All");
  }, [selectedState]);

  useEffect(() => {
    setLocalDistrict(selectedDistrict || "All");
  }, [selectedDistrict]);

  useEffect(() => {
    setLocalYear(selectedYear || "All");
  }, [selectedYear]);

  useEffect(() => {
    setLocalSeason(selectedSeason || "All");
  }, [selectedSeason]);

  // Map Controls
  const [mapTheme, setMapTheme] = useState<"light" | "dark" | "satellite" | "terrain" | "topo" | "osm">("light");
  const [pointSize, setPointSize] = useState<number>(7);
  const [mapStatusFilters, setMapStatusFilters] = useState({ clean: true, single: true, multi: true });

  // Decimals settings
  const [decSettings] = useState({
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
  const geojsonLayersRef = useRef<any[]>([]);

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
      mapping['Year'] = headers.year || "";
      mapping['Aquifer'] = headers.aquifer || "";
    }
    if (headerMap) {
      Object.entries(headerMap).forEach(([excelHeader, paramKey]) => {
        if (paramKey) {
          mapping[paramKey] = excelHeader;
        }
      });
    }

    // Guess 'Source' column if it exists in rawData
    const keys = rawData && rawData.length > 0 ? Object.keys(rawData[0]) : [];
    const sourceKey = keys.find(k => k && ["source", "type", "source type", "source_type"].some(s => k.toLowerCase().trim() === s));
    mapping['Source'] = sourceKey || "";

    return mapping;
  }, [headers, headerMap, rawData]);

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

  // Dynamic cascading metadata filter options
  const filterOptions = useMemo(() => {
    const states = new Set<string>();
    const districts = new Set<string>();
    const blocks = new Set<string>();
    const sources = new Set<string>();
    const aquifers = new Set<string>();
    const years = new Set<string>();
    const seasons = new Set<string>();

    const stateCol = columnMapping['State'];
    const distCol = columnMapping['District'];
    const blockCol = columnMapping['Block'];
    const sourceCol = columnMapping['Source'];
    const aquiferCol = columnMapping['Aquifer'];
    const yearCol = columnMapping['Year'];
    const seasonCol = columnMapping['Season'];

    rawData.forEach(d => {
      const sVal = stateCol && d[stateCol] ? String(d[stateCol]).trim() : "";
      const dVal = distCol && d[distCol] ? String(d[distCol]).trim() : "";
      const bVal = blockCol && d[blockCol] ? String(d[blockCol]).trim() : "";
      const srcVal = sourceCol && d[sourceCol] ? String(d[sourceCol]).trim() : "";
      const aqVal = aquiferCol && d[aquiferCol] ? String(d[aquiferCol]).trim() : "";
      const yVal = yearCol && d[yearCol] ? String(d[yearCol]).trim() : "";
      const seasVal = seasonCol && d[seasonCol] ? String(d[seasonCol]).trim() : "";

      if (sVal) states.add(sVal);

      // Cascading District options based on active State selection
      if (localState === "All" || sVal === localState) {
        if (dVal) districts.add(dVal);
      }

      // Cascading Block options based on active State & District selection
      if ((localState === "All" || sVal === localState) &&
          (localDistrict === "All" || dVal === localDistrict)) {
        if (bVal) blocks.add(bVal);
      }

      if (srcVal) sources.add(srcVal);
      if (aqVal) aquifers.add(aqVal);
      if (yVal) years.add(yVal);
      if (seasVal) seasons.add(seasVal);
    });

    return {
      states: Array.from(states).sort(),
      districts: Array.from(districts).sort(),
      blocks: Array.from(blocks).sort(),
      sources: Array.from(sources).sort(),
      aquifers: Array.from(aquifers).sort(),
      years: Array.from(years).sort(),
      seasons: Array.from(seasons).sort(),
    };
  }, [rawData, columnMapping, localState, localDistrict]);

  // Perform basic filter & fail calculations
  const currentFilteredData = useMemo(() => {
    if (!rawData || rawData.length === 0) return [];

    const activeSet = Object.keys(activeParams).some(k => activeParams[k])
      ? Object.keys(activeParams).filter(k => activeParams[k])
      : Object.keys(PARAM_CONFIG).filter(p => !!columnMapping[p]);

    const stateCol = columnMapping['State'];
    const districtCol = columnMapping['District'];
    const blockCol = columnMapping['Block'];
    const sourceCol = columnMapping['Source'];
    const aquiferCol = columnMapping['Aquifer'];
    const yearCol = columnMapping['Year'];
    const seasonCol = columnMapping['Season'];
    const latCol = columnMapping['latitude'];
    const lonCol = columnMapping['longitude'];

    return rawData.filter(d => {
      // Local metadata filters inside Combination Analysis tab
      if (localState !== "All" && stateCol && String(d[stateCol] || '').trim() !== localState) return false;
      if (localDistrict !== "All" && districtCol && String(d[districtCol] || '').trim() !== localDistrict) return false;
      if (localBlock !== "All" && blockCol && String(d[blockCol] || '').trim() !== localBlock) return false;
      if (localSource !== "All" && sourceCol && String(d[sourceCol] || '').trim() !== localSource) return false;
      if (localAquifer !== "All" && aquiferCol && String(d[aquiferCol] || '').trim() !== localAquifer) return false;
      if (localYear !== "All" && yearCol && String(d[yearCol] || '').trim() !== localYear) return false;
      if (localSeason !== "All" && seasonCol && String(d[seasonCol] || '').trim() !== localSeason) return false;

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
      };
    });
  }, [rawData, columnMapping, localState, localDistrict, localBlock, localSource, localAquifer, localYear, localSeason, activeParams, strictData]);

  const activeSet = useMemo(() => {
    return Object.keys(activeParams).some(k => activeParams[k])
      ? Object.keys(activeParams).filter(k => activeParams[k])
      : Object.keys(PARAM_CONFIG).filter(p => !!columnMapping[p]);
  }, [activeParams, columnMapping]);

  // Donut chart data
  const chartData = useMemo(() => {
    const total = currentFilteredData.length;
    const clean = currentFilteredData.filter(r => r.failCount === 0).length;
    const single = currentFilteredData.filter(r => r.failCount === 1).length;
    const multi = currentFilteredData.filter(r => r.failCount > 1).length;

    const donut = [
      { name: "Uncontaminated (Compliant)", value: clean, percentage: total > 0 ? ((clean / total) * 100).toFixed(2) : "0.00" },
      { name: "Single Parameter Exceedance", value: single, percentage: total > 0 ? ((single / total) * 100).toFixed(2) : "0.00" },
      { name: "Multiple Parameters Exceedance", value: multi, percentage: total > 0 ? ((multi / total) * 100).toFixed(2) : "0.00" }
    ];

    return { donut };
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
        percentage: currentFilteredData.length > 0 ? ((count / currentFilteredData.length) * 100).toFixed(2) : "0.00"
      }))
      .sort((a, b) => b.count - a.count);
  }, [currentFilteredData]);

  // Leaflet Map instance setup
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
      dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      topo: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      osm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      terrain: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}"
    };

    L.tileLayer(tileUrls[mapTheme], {
      attribution: "© Map Tiles"
    }).addTo(map);
  }, [mapTheme, L]);

  // Synchronize GeoJSON shapefile layers on Leaflet Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !L) return;

    // Remove previous geojson layers
    geojsonLayersRef.current.forEach((l: any) => {
      try {
        map.removeLayer(l);
      } catch (err) {
        // ignore
      }
    });
    geojsonLayersRef.current = [];

    if (layers && layers.length > 0) {
      layers.forEach((layer) => {
        if (!layer.visible || !layer.geoJson) return;

        const strokeColor = layer.strokeColor || "#3b82f6";
        const strokeWidth = layer.strokeWidth || 1.5;
        const fillColor = layer.fillColor || "#3b82f6";
        const fillOpacity = (layer.fillOpacity !== undefined ? layer.fillOpacity : 10) / 100;

        try {
          const geojsonLayer = L.geoJSON(layer.geoJson, {
            style: () => ({
              color: strokeColor,
              weight: strokeWidth,
              fillColor: fillColor,
              fillOpacity: layer.showStroke === false ? 0 : fillOpacity,
              opacity: layer.showStroke === false ? 0 : 1
            }),
            onEachFeature: (feature: any, leafletLayer: any) => {
              if (layer.showLabels && layer.labelKey && feature.properties?.[layer.labelKey]) {
                const labelText = String(feature.properties[layer.labelKey]);
                leafletLayer.bindTooltip(labelText, {
                  permanent: true,
                  direction: "center",
                  className: "custom-map-label"
                });
              }
            }
          }).addTo(map);

          geojsonLayersRef.current.push(geojsonLayer);
        } catch (e) {
          console.error("Error drawing GeoJSON layer in leaflet:", e);
        }
      });
    }
  }, [layers, L, mapTheme]);

  // Marker updating on data
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markerGroup = markerGroupRef.current;
    if (!map || !markerGroup || !L || !currentFilteredData) return;

    markerGroup.clearLayers();
    const bounds: any[] = [];

    currentFilteredData.forEach(r => {
      const lat = parseFloat(r[columnMapping['latitude']]);
      const lon = parseFloat(r[columnMapping['longitude']]);
      if (isNaN(lat) || isNaN(lon)) return;

      let col = '#10b981';
      let isVisible = false;

      if (r.failCount === 0 && mapStatusFilters.clean) { isVisible = true; col = '#10b981'; }
      if (r.failCount === 1 && mapStatusFilters.single) { isVisible = true; col = '#f59e0b'; }
      if (r.failCount > 1 && mapStatusFilters.multi) { isVisible = true; col = '#ef4444'; }

      if (!isVisible) return;

      const marker = L.circleMarker([lat, lon], {
        radius: pointSize,
        fillColor: col,
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.9
      });

      const failHtml = r.failCount > 0 ? r.failedParams.map((p: any) => `
        <div style="display: flex; justify-content: space-between; background: #fff1f2; padding: 4px 8px; border-radius: 4px; margin-top: 4px; border: 1px solid #ffe4e6;">
          <span style="font-weight: 900; font-size: 10px; color: #9f1239;">${p.name}</span>
          <span style="font-weight: 700; font-size: 10px; color: #be123c;">${parseFloat(p.val).toFixed(getDecimalForParam(p.name))} / ${p.limit}</span>
        </div>
      `).join('') : '<div style="font-size: 11px; color: #047857; font-weight: 900; padding: 6px; background: #ecfdf5; border-radius: 6px;">✓ COMPLIANT</div>';

      const locInfo = r[columnMapping['District']] ? `<p style="font-size: 10px; color: #4f46e5; margin: 0 0 8px 0; font-weight: 700;">${r[columnMapping['District']] || ''}, ${r[columnMapping['State']] || ''}</p>` : '';

      marker.bindPopup(`
        <div style="font-family: sans-serif; padding: 6px; min-width: 180px;">
          <h3 style="font-size: 12px; font-weight: 900; margin: 0 0 4px 0; color: #1e293b;">${r[columnMapping['Station']] || 'Well'}</h3>
          ${locInfo}
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
  }, [currentFilteredData, pointSize, mapStatusFilters, L, columnMapping, getDecimalForParam]);

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

  // Export fully detailed report
  const exportMultiSheet = () => {
    const wb = XLSX.utils.book_new();

    // 1. Detailed well data
    const rawExport = currentFilteredData.map(r => {
      const { failedParams, failCount, _latNum, _lonNum, _mprScoreNum, ...rest } = r;
      
      const res: Record<string, any> = {
        'Station Name': r[columnMapping['Station']] || 'Well',
        'State': r[columnMapping['State']] || '',
        'District': r[columnMapping['District']] || '',
        'Block': r[columnMapping['Block']] || '',
        'Latitude': r[columnMapping['latitude']] || '',
        'Longitude': r[columnMapping['longitude']] || '',
        'Failed Count': failCount,
        'Failed Parameters': failedParams.map(p => p.name).join(', ')
      };

      // Add individual parameters as columns
      activeSet.forEach(p => {
        const col = columnMapping[p];
        if (col) {
          const val = parseFloat(r[col]);
          res[p] = isNaN(val) ? (r[col] || '') : val;
        }
      });

      return res;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawExport), "Detailed Well Log");

    // 2. Combo breakdown matrix
    const comboExport = comboAnalysis.map(c => ({
      'Combination of Exceeded Parameters': c.key,
      'Number of Wells': c.count,
      'Percentage (%)': c.percentage
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(comboExport), "Combination Matrix");

    XLSX.writeFile(wb, "Water_Quality_Combination_Report.xlsx");
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

  return (
    <div className="flex flex-col xl:flex-row gap-6 w-full text-slate-800">
      
      {/* 1. Filtering Sidebar */}
      <div className="w-full xl:w-80 shrink-0 bg-slate-900 text-white rounded-3xl p-5 flex flex-col gap-5 shadow-xl border border-slate-800 max-h-[85vh] xl:max-h-[1000px] overflow-y-auto">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4 shrink-0">
          <div className="bg-indigo-600 text-white p-2 rounded-xl">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black tracking-tight">Combination Analysis</h2>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Combination Controls</p>
          </div>
        </div>

        {/* Scrollable Filters Container */}
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-5 scrollbar-none">
          
          {/* Spatial & Demographic Filters */}
          <div className="flex flex-col gap-3 border-b border-slate-800 pb-4">
            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-wider">Demographic Filters</span>
            
            {/* State Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">State</label>
              <select
                value={localState}
                onChange={e => {
                  setLocalState(e.target.value);
                  setLocalDistrict("All");
                  setLocalBlock("All");
                }}
                className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 outline-none w-full font-medium cursor-pointer hover:bg-slate-750 transition-colors"
              >
                <option value="All">All States</option>
                {filterOptions.states.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* District Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">District</label>
              <select
                value={localDistrict}
                onChange={e => {
                  setLocalDistrict(e.target.value);
                  setLocalBlock("All");
                }}
                className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 outline-none w-full font-medium cursor-pointer hover:bg-slate-750 transition-colors"
                disabled={localState === "All"}
              >
                <option value="All">All Districts</option>
                {filterOptions.districts.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {/* Block Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Block</label>
              <select
                value={localBlock}
                onChange={e => setLocalBlock(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 outline-none w-full font-medium cursor-pointer hover:bg-slate-750 transition-colors"
                disabled={localDistrict === "All"}
              >
                <option value="All">All Blocks</option>
                {filterOptions.blocks.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Source Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Source Type</label>
              <select
                value={localSource}
                onChange={e => setLocalSource(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 outline-none w-full font-medium cursor-pointer hover:bg-slate-750 transition-colors"
                disabled={!columnMapping['Source']}
              >
                <option value="All">{columnMapping['Source'] ? "All Sources" : "Source (Not Mapped)"}</option>
                {filterOptions.sources.map(src => (
                  <option key={src} value={src}>{src}</option>
                ))}
              </select>
            </div>

            {/* Aquifer Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Aquifer</label>
              <select
                value={localAquifer}
                onChange={e => setLocalAquifer(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 outline-none w-full font-medium cursor-pointer hover:bg-slate-750 transition-colors"
                disabled={!columnMapping['Aquifer']}
              >
                <option value="All">{columnMapping['Aquifer'] ? "All Aquifers" : "Aquifer (Not Mapped)"}</option>
                {filterOptions.aquifers.map(aq => (
                  <option key={aq} value={aq}>{aq}</option>
                ))}
              </select>
            </div>

            {/* Year Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Year</label>
              <select
                value={localYear}
                onChange={e => setLocalYear(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 outline-none w-full font-medium cursor-pointer hover:bg-slate-750 transition-colors"
                disabled={!columnMapping['Year']}
              >
                <option value="All">{columnMapping['Year'] ? "All Years" : "Year (Not Mapped)"}</option>
                {filterOptions.years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Season Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Season</label>
              <select
                value={localSeason}
                onChange={e => setLocalSeason(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 outline-none w-full font-medium cursor-pointer hover:bg-slate-750 transition-colors"
                disabled={!columnMapping['Season']}
              >
                <option value="All">{columnMapping['Season'] ? "All Seasons" : "Season (Not Mapped)"}</option>
                {filterOptions.seasons.map(seas => (
                  <option key={seas} value={seas}>{seas}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Selected parameters isolation */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-wider">Parameters Isolation</span>
              <button 
                onClick={toggleAllParams}
                className="text-[9px] font-bold text-slate-400 hover:text-white px-2 py-0.5 bg-slate-800 rounded transition-colors"
              >
                Toggle All
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto pr-1">
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
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={strictData} 
                onChange={e => setStrictData(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer" 
              />
              <span className="text-[10px] font-bold text-slate-300">Strict Data (Require values for all)</span>
            </label>
          </div>

        </div>

        {/* Footer info stats */}
        <div className="border-t border-slate-800 pt-3 text-center shrink-0">
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
                <h3 className="text-xs font-black tracking-tight text-slate-800 uppercase">Combination Analysis Map</h3>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Compliance and overlap hotspots</p>
              </div>
            </div>

            {/* Map theme controls */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={mapTheme}
                onChange={e => setMapTheme(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-[9px] font-black uppercase tracking-wider outline-none text-slate-600"
              >
                <option value="light">Classic Light</option>
                <option value="dark">Dark Canvas</option>
                <option value="satellite">Satellite View</option>
                <option value="terrain">Esri Terrain</option>
                <option value="topo">Esri Topographic</option>
                <option value="osm">OpenStreetMap</option>
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
          </div>
        </div>

        {/* 3. Detailed Analytics tabs and tables */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          
          {/* Scrollable Tab header */}
          <div className="flex border-b border-slate-100 overflow-x-auto bg-slate-50/50 p-2 gap-1 scrollbar-none">
            {[
              { id: "overview", label: "Overview", icon: Table },
              { id: "bganalysis", label: "Exceedance Analysis", icon: Info },
              { id: "state", label: "States Severity", icon: Layers },
              { id: "district", label: "Districts Severity", icon: Layers }
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
              Export Report
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
                <div className="border border-slate-100 rounded-3xl overflow-hidden overflow-x-auto custom-scrollbar">
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

            {/* TAB 2: EXCEEDANCE ANALYSIS */}
            {activeTab === "bganalysis" && (
              <div className="space-y-6">
                <div className="bg-[#1e293b] text-white p-4 rounded-2xl flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider">Analysis of Monitoring Stations</h4>
                    <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">National exceedance metrics overview</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Data Table */}
                  <div className="lg:col-span-2 border border-slate-100 rounded-3xl overflow-hidden overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead className="bg-[#e9eef7] text-slate-800 text-[10px] font-black border-b border-slate-200">
                        <tr>
                          <th className="p-3 border-r border-slate-200 text-center">Sl No</th>
                          <th className="p-3 border-r border-slate-200">State / UT Name</th>
                          <th className="p-3 border-r border-slate-200 text-center">Total Stations</th>
                          <th className="p-3 border-r border-slate-200 text-center">Exceeding</th>
                          <th className="p-3 border-r border-slate-200 text-center">Within Limits</th>
                          <th className="p-3 text-center">% Exceeds</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-600 text-center">
                        {stateStats.map((st, idx) => {
                          const contam = st.total - st.clean;
                          const perc = st.total > 0 ? ((contam / st.total) * 100).toFixed(2) : "0.00";
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
                              ? ((currentFilteredData.filter(r => r.failCount > 0).length / currentFilteredData.length) * 100).toFixed(2) 
                              : "0.00"}%
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Right Column: Descriptions */}
                  <div className="bg-slate-50 border border-slate-100 rounded-3xl p-5 space-y-4 text-[11px] leading-relaxed text-slate-700 font-medium">
                    <h5 className="font-black text-xs text-indigo-900 border-b border-indigo-100 pb-2 mb-2">Selection Insight</h5>
                    <p>
                      <strong>{currentFilteredData.filter(r => r.failCount > 0).length.toLocaleString()} stations</strong> exceed at least one chemical parameter above permissible limits.
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
              <div className="border border-slate-100 rounded-3xl overflow-hidden overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-[11px] border-collapse animate-[fadeIn_0.2s_ease-out]">
                  <thead className="bg-slate-900 text-white text-[9px] font-black uppercase">
                    <tr>
                      <th className="p-3">State</th>
                      <th className="p-3 text-center">Total Stations</th>
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
                          {st.clean} ({st.total > 0 ? ((st.clean / st.total) * 100).toFixed(2) : "0.00"}%)
                        </td>
                        <td className="p-3 text-center text-amber-600 bg-amber-50/10">
                          {st.one} ({st.total > 0 ? ((st.one / st.total) * 100).toFixed(2) : "0.00"}%)
                        </td>
                        <td className="p-3 text-center text-orange-600 bg-orange-50/10">
                          {st.two} ({st.total > 0 ? ((st.two / st.total) * 100).toFixed(2) : "0.00"}%)
                        </td>
                        <td className="p-3 text-center text-rose-600 bg-rose-50/10">
                          {st.three} ({st.total > 0 ? ((st.three / st.total) * 100).toFixed(2) : "0.00"}%)
                        </td>
                        <td className="p-3 text-center text-red-600 bg-red-50/10">
                          {st.fourPlus} ({st.total > 0 ? ((st.fourPlus / st.total) * 100).toFixed(2) : "0.00"}%)
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
              <div className="border border-slate-100 rounded-3xl overflow-hidden overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-[11px] border-collapse animate-[fadeIn_0.2s_ease-out]">
                  <thead className="bg-slate-900 text-white text-[9px] font-black uppercase">
                    <tr>
                      <th className="p-3">State</th>
                      <th className="p-3">District</th>
                      <th className="p-3 text-center">Total Stations</th>
                      <th className="p-3 text-center text-emerald-400">Clean (0)</th>
                      <th className="p-3 text-center text-amber-400">1 Param</th>
                      <th className="p-3 text-center text-orange-400">2 Params</th>
                      <th className="p-3 text-center text-rose-400">3 Params</th>
                      <th className="p-3 text-center text-red-500">4+ Params</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-600">
                    {districtStats.map((dt, i) => {
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
}

import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import Highcharts from "highcharts";
import { PARAM_CONFIG } from "../data/config";
import { DataHeaders } from "../types";
import {
  Database,
  Download,
  Info,
  AlertTriangle,
  Table,
  CheckCircle,
  X,
  Play,
  Layers,
  LineChart,
  Lightbulb,
  BookOpen,
  HelpCircle,
  FileSpreadsheet,
  Grid,
  Filter,
  CheckSquare,
  Square,
  Sparkles,
  BarChart2,
  TrendingUp,
  Cpu,
  Bookmark
} from "lucide-react";

interface PcaAnalysisViewProps {
  rawData: any[];
  headers: DataHeaders;
  headerMap: Record<string, string>;
  selectedState?: string;
  selectedDistrict?: string;
  showToast: (msg: string, type: "success" | "error") => void;
}

// -----------------------------------------------------------------------------
// PURE TS ROBUST JACOBI EIGENVALUE SOLVER
// -----------------------------------------------------------------------------
function jacobiEigenSolver(matrix: number[][], maxIterations = 500, tolerance = 1e-9) {
  const n = matrix.length;
  // Initialize eigenvectors as identity matrix
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
  // Copy matrix
  const A = matrix.map((row) => [...row]);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Find the largest off-diagonal element
    let maxVal = 0;
    let p = 0;
    let q = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][j]) > maxVal) {
          maxVal = Math.abs(A[i][j]);
          p = i;
          q = j;
        }
      }
    }

    if (maxVal < tolerance) {
      break;
    }

    // Compute rotation angle
    const phi = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    // Update A matrix elements
    const app = A[p][p];
    const aqq = A[q][q];
    const apq = A[p][q];

    A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    A[p][q] = 0;
    A[q][p] = 0;

    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const aip = A[i][p];
        const aiq = A[i][q];
        A[i][p] = c * aip - s * aiq;
        A[p][i] = A[i][p];
        A[i][q] = s * aip + c * aiq;
        A[q][i] = A[i][q];
      }
    }

    // Update eigenvectors matrix
    for (let i = 0; i < n; i++) {
      const vip = V[i][p];
      const viq = V[i][q];
      V[i][p] = c * vip - s * viq;
      V[i][q] = s * vip + c * viq;
    }
  }

  // Extract eigenvalues from diagonal
  const eigenvalues = A.map((row, i) => Math.max(0, row[i])); // Clamp tiny negatives to 0

  // Sort eigenvalues and corresponding eigenvectors in descending order
  const indices = eigenvalues.map((_, i) => i);
  indices.sort((a, b) => eigenvalues[b] - eigenvalues[a]);

  const sortedEigenvalues = indices.map((i) => eigenvalues[i]);
  const sortedEigenvectors = Array.from({ length: n }, (_, i) =>
    indices.map((j) => V[i][j])
  );

  return {
    eigenvalues: sortedEigenvalues,
    eigenvectors: sortedEigenvectors,
  };
}

export default function PcaAnalysisView({
  rawData,
  headers,
  headerMap,
  selectedState = "",
  selectedDistrict = "",
  showToast
}: PcaAnalysisViewProps) {
  // Navigation inside PCA
  const [activeTab, setActiveTab] = useState<"analytics" | "summary" | "methodology" | "tables">("analytics");

  // Local cascading filters
  const [localState, setLocalState] = useState(selectedState);
  const [localDistrict, setLocalDistrict] = useState(selectedDistrict);
  const [localBlock, setLocalBlock] = useState("ALL");

  // Synchronize with parent state
  useEffect(() => {
    setLocalState(selectedState);
    setLocalDistrict(selectedDistrict);
    setLocalBlock("ALL");
  }, [selectedState, selectedDistrict]);

  // Available unique fields
  const statesList = useMemo(() => {
    if (!headers.state) return [];
    return [...new Set(rawData.map((d) => String(d[headers.state!] || "").trim()))].filter(Boolean).sort();
  }, [rawData, headers.state]);

  const districtsList = useMemo(() => {
    if (!headers.district || !localState) return [];
    return [
      ...new Set(
        rawData
          .filter((d) => String(d[headers.state!] || "").trim() === localState)
          .map((d) => String(d[headers.district!] || "").trim())
      )
    ].filter(Boolean).sort();
  }, [rawData, headers.district, localState]);

  const blocksList = useMemo(() => {
    if (!headers.block || !localState || !localDistrict || localDistrict === "ALL") return [];
    return [
      ...new Set(
        rawData
          .filter(
            (d) =>
              String(d[headers.state!] || "").trim() === localState &&
              String(d[headers.district!] || "").trim() === localDistrict
          )
          .map((d) => String(d[headers.block!] || "").trim())
      )
    ].filter(Boolean).sort();
  }, [rawData, headers.block, localState, localDistrict]);

  // Handle local filter changes
  const handleStateChange = (val: string) => {
    setLocalState(val);
    setLocalDistrict("ALL");
    setLocalBlock("ALL");
  };

  const handleDistrictChange = (val: string) => {
    setLocalDistrict(val);
    setLocalBlock("ALL");
  };

  // Mapped physical parameters (intersect with those uploaded in dataset)
  const availableParams = useMemo(() => {
    const keys = Object.keys(headerMap);
    return keys.filter((k) => headers.params.includes(k));
  }, [headers.params, headerMap]);

  // Feature space parameter toggles
  const [paramConfig, setParamConfig] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initialConfig: Record<string, boolean> = {};
    availableParams.forEach((p) => {
      initialConfig[p] = true; // Default to selected
    });
    setParamConfig(initialConfig);
  }, [availableParams]);

  const toggleParam = (p: string) => {
    setParamConfig((prev) => ({ ...prev, [p]: !prev[p] }));
  };

  const selectAllParams = (select: boolean) => {
    const nextConfig: Record<string, boolean> = {};
    availableParams.forEach((p) => {
      nextConfig[p] = select;
    });
    setParamConfig(nextConfig);
  };

  // PCA type
  const [pcaType, setPcaType] = useState<"correlation" | "covariance">("correlation");

  // Retention Criteria
  const [retentionMethod, setRetentionMethod] = useState<"vis3" | "vis2" | "kaiser" | "elbow" | "variance">("vis3");
  const [varianceThreshold, setVarianceThreshold] = useState<number>(80);

  // Computed results state
  const [pcaResults, setPcaResults] = useState<any | null>(null);
  const [retainedCount, setRetainedCount] = useState<number>(3);

  // Axis selectors for plots
  const [xAxisPC, setXAxisPC] = useState<number>(0);
  const [yAxisPC, setYAxisPC] = useState<number>(1);

  // Filtered dataset for computations
  const filteredDataset = useMemo(() => {
    let subset = rawData;
    if (localState && localState !== "ALL") {
      subset = subset.filter((d) => String(d[headers.state!] || "").trim() === localState);
    }
    if (localDistrict && localDistrict !== "ALL") {
      subset = subset.filter((d) => String(d[headers.district!] || "").trim() === localDistrict);
    }
    if (localBlock && localBlock !== "ALL") {
      subset = subset.filter((d) => String(d[headers.block!] || "").trim() === localBlock);
    }
    return subset;
  }, [rawData, localState, localDistrict, localBlock, headers]);

  // Compute stats and standardized matrices
  const activeParams = useMemo(() => {
    return availableParams.filter((p) => paramConfig[p]);
  }, [availableParams, paramConfig]);

  // PCA execution core trigger
  const runPcaAnalysis = () => {
    if (filteredDataset.length < 3) {
      showToast("Select a geographic subset with at least 3 samples.", "error");
      return;
    }
    if (activeParams.length < 2) {
      showToast("Please select at least 2 parameters in Feature Space to run PCA.", "error");
      return;
    }

    try {
      const n = filteredDataset.length;
      const p = activeParams.length;

      // 1. Calculate Descriptive Stats
      const stats = activeParams.map((param) => {
        const vals = filteredDataset
          .map((row) => {
            let valStr = String(row[param] || "");
            valStr = valStr.replace(",", "."); // Handle potential European comma formatting
            return parseFloat(valStr);
          })
          .filter((v) => !isNaN(v));

        const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        const std =
          vals.length > 1
            ? Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (vals.length - 1))
            : 1;

        return {
          p: param,
          mean,
          std: std || 1
        };
      });

      // 2. Build Standardized Data Matrix (handling NaNs with Mean Imputation)
      const stdMatrix = filteredDataset.map((row) =>
        stats.map((s) => {
          let valStr = String(row[s.p] || "");
          valStr = valStr.replace(",", ".");
          let val = parseFloat(valStr);
          if (isNaN(val)) val = s.mean; // Impute with mean

          return pcaType === "correlation" ? (val - s.mean) / s.std : val - s.mean;
        })
      );

      // 3. Compute Covariance/Dispersion Matrix: C = Z^T * Z / (n - 1)
      const covMatrix = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          let sum = 0;
          for (let k = 0; k < n; k++) {
            sum += stdMatrix[k][i] * stdMatrix[k][j];
          }
          covMatrix[i][j] = sum / (n - 1);
        }
      }

      // Enforce absolute mathematical symmetry (guards against microscopic floating-point skew)
      for (let i = 0; i < p; i++) {
        for (let j = i + 1; j < p; j++) {
          const avg = (covMatrix[i][j] + covMatrix[j][i]) / 2;
          covMatrix[i][j] = avg;
          covMatrix[j][i] = avg;
        }
      }

      // 4. Solve for Eigenvalues & Eigenvectors via Jacobi Algorithm
      const { eigenvalues, eigenvectors } = jacobiEigenSolver(covMatrix);

      // 5. Compute Component Scores (Data * Eigenvectors)
      const scores = Array.from({ length: n }, () => Array.from({ length: p }, () => 0));
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < p; j++) {
          let sum = 0;
          for (let i = 0; i < p; i++) {
            sum += stdMatrix[k][i] * eigenvectors[i][j];
          }
          scores[k][j] = sum;
        }
      }

      // 6. Compute True Loading Matrix: eigenvectors * sqrt(eigenvalues)
      // Note: for Covariance mode, dividing load by standard deviation scales it appropriately
      const loadings = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          const ev = eigenvalues[j];
          const rawLoad = eigenvectors[i][j] * Math.sqrt(ev);
          loadings[i][j] = pcaType === "covariance" ? rawLoad / stats[i].std : rawLoad;
        }
      }

      // 7. Calculate Correlation Matrix (for Heatmap)
      const correlation = Array.from({ length: p }, () => Array.from({ length: p }, () => 1));
      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          if (i === j) continue;
          let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
          for (let k = 0; k < n; k++) {
            const x = stdMatrix[k][i];
            const y = stdMatrix[k][j];
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumX2 += x * x;
            sumY2 += y * y;
          }
          const num = n * sumXY - sumX * sumY;
          const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
          correlation[i][j] = den === 0 ? 0 : num / den;
        }
      }

      // Total variance and individual percentages
      const totalVariance = eigenvalues.reduce((a, b) => a + b, 0) || 1;
      const variancePercentages = eigenvalues.map((ev) => (ev / totalVariance) * 100);

      // Save state
      setPcaResults({
        params: activeParams,
        stats,
        stdMatrix,
        eigenvalues,
        eigenvectors,
        scores,
        loadings,
        correlation,
        dispersion: covMatrix,
        variancePercentages
      });

      // Reset axis selections
      setXAxisPC(0);
      setYAxisPC(Math.min(1, p - 1));

      showToast("PCA computed successfully!", "success");
    } catch (err: any) {
      console.error(err);
      showToast("Failed to compute PCA: " + err.message, "error");
    }
  };

  // Determine retained PCs count dynamically based on selected criterion
  useEffect(() => {
    if (!pcaResults) return;

    const eigs = pcaResults.eigenvalues;
    const vars = pcaResults.variancePercentages;
    let n = 3; // Default

    if (retentionMethod === "vis2") {
      n = 2;
    } else if (retentionMethod === "vis3") {
      n = 3;
    } else if (retentionMethod === "kaiser") {
      // Kaiser: Eigenvalue > 1.0 for correlation, or greater than average for covariance
      const threshold = pcaType === "correlation" ? 1.0 : eigs.reduce((a: number, b: number) => a + b, 0) / eigs.length;
      n = eigs.filter((e: number) => e >= threshold).length || 1;
    } else if (retentionMethod === "variance") {
      let cumulative = 0;
      n = 0;
      for (let i = 0; i < vars.length; i++) {
        cumulative += vars[i];
        n++;
        if (cumulative >= varianceThreshold) break;
      }
    } else if (retentionMethod === "elbow") {
      const nPoints = eigs.length;
      if (nPoints <= 2) {
        n = nPoints;
      } else {
        // Simple geometric elbow detector
        const p1 = { x: 0, y: eigs[0] };
        const p2 = { x: nPoints - 1, y: eigs[nPoints - 1] };
        let maxD = -1;
        let idx = 0;
        for (let i = 1; i < nPoints - 1; i++) {
          const p0 = { x: i, y: eigs[i] };
          // Distance of point from line p1-p2
          const dist =
            Math.abs((p2.y - p1.y) * p0.x - (p2.x - p1.x) * p0.y + p2.x * p1.y - p2.y * p1.x) /
            Math.sqrt(Math.pow(p2.y - p1.y, 2) + Math.pow(p2.x - p1.x, 2));
          if (dist > maxD) {
            maxD = dist;
            idx = i;
          }
        }
        n = idx + 1;
      }
    }

    setRetainedCount(Math.min(Math.max(1, n), eigs.length));
  }, [pcaResults, retentionMethod, varianceThreshold, pcaType]);

  // Retained Cumulative Variance percentage
  const retainedCumulativeVariance = useMemo(() => {
    if (!pcaResults) return 0;
    let sum = 0;
    for (let i = 0; i < Math.min(retainedCount, pcaResults.variancePercentages.length); i++) {
      sum += pcaResults.variancePercentages[i];
    }
    return sum;
  }, [pcaResults, retainedCount]);

  // -----------------------------------------------------------------------------
  // RENDER DYNAMIC HIGHCHARTS IN CONTAINER
  // -----------------------------------------------------------------------------
  const chartRef1 = useRef<HTMLDivElement>(null);
  const chartRef2 = useRef<HTMLDivElement>(null);
  const chartRef3 = useRef<HTMLDivElement>(null);
  const chartRef4 = useRef<HTMLDivElement>(null);
  const chartRef5 = useRef<HTMLDivElement>(null);
  const chartRef6 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pcaResults || activeTab !== "analytics") return;

    const xName = `PC${xAxisPC + 1}`;
    const yName = `PC${yAxisPC + 1}`;
    const xVar = pcaResults.variancePercentages[xAxisPC].toFixed(1);
    const yVar = pcaResults.variancePercentages[yAxisPC]?.toFixed(1) || "0.0";

    const titleStyle = { fontSize: "14px", fontWeight: "900", color: "#1e293b" };
    const tooltipStyle = {
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderWidth: 0,
      borderRadius: 8,
      shadow: true,
      style: { color: "#1e293b", fontSize: "11px" }
    };

    // 1. Scree Plot
    if (chartRef1.current) {
      Highcharts.chart(chartRef1.current, {
        chart: { type: "areaspline", backgroundColor: "transparent" },
        title: { text: "Scree Plot (Variance Explained)", style: titleStyle },
        xAxis: {
          categories: pcaResults.eigenvalues.map((_: any, i: number) => `PC${i + 1}`),
          plotLines: [
            {
              color: "#ef4444",
              value: retainedCount - 0.5,
              width: 2,
              dashStyle: "Dash"
            }
          ],
          gridLineWidth: 1,
          gridLineColor: "#f1f5f9"
        },
        yAxis: { title: { text: "Eigenvalue" }, gridLineColor: "#f1f5f9" },
        tooltip: tooltipStyle,
        series: [
          {
            name: "Eigenvalue",
            type: "areaspline",
            data: pcaResults.eigenvalues.map((v: number, i: number) => ({
              y: parseFloat(v.toFixed(3)),
              marker: { fillColor: i < retainedCount ? "#6d28d9" : "#94a3b8" }
            })),
            fillColor: {
              linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
              stops: [
                [0, "rgba(124, 58, 237, 0.4)"],
                [1, "rgba(124, 58, 237, 0.0)"]
              ]
            },
            lineColor: "#7c3aed",
            lineWidth: 3,
            marker: { symbol: "circle", radius: 5, lineColor: "#fff", lineWidth: 1 }
          }
        ],
        credits: { enabled: false },
        legend: { enabled: false }
      });
    }

    // 2. Score Plot
    if (chartRef2.current) {
      Highcharts.chart(chartRef2.current, {
        chart: { type: "scatter", backgroundColor: "transparent", zoomType: "xy" },
        title: { text: `Sample Score Coordinates (${xName} vs ${yName})`, style: titleStyle },
        xAxis: {
          title: { text: `${xName} (${xVar}%)` },
          gridLineWidth: 1,
          gridLineColor: "#f1f5f9",
          plotLines: [{ value: 0, width: 2, color: "#e2e8f0" }]
        },
        yAxis: {
          title: { text: `${yName} (${yVar}%)` },
          gridLineWidth: 1,
          gridLineColor: "#f1f5f9",
          plotLines: [{ value: 0, width: 2, color: "#e2e8f0" }]
        },
        tooltip: {
          ...tooltipStyle,
          pointFormat: "<b>{point.name}</b><br>X: {point.x:.3f}<br>Y: {point.y:.3f}"
        },
        series: [
          {
            name: "Samples",
            type: "scatter",
            data: filteredDataset.map((row, i) => ({
              x: pcaResults.scores[i][xAxisPC],
              y: pcaResults.scores[i][yAxisPC],
              name: String(row[headers.wellId!] || row[headers.location!] || `Sample ${i + 1}`)
            })),
            color: {
              radialGradient: { cx: 0.4, cy: 0.3, r: 0.7 },
              stops: [
                [0, "rgba(167, 139, 250, 0.9)"],
                [1, "rgba(109, 40, 217, 0.8)"]
              ]
            },
            marker: {
              radius: 6,
              symbol: "circle",
              lineColor: "rgba(255,255,255,0.8)",
              lineWidth: 1
            }
          }
        ],
        credits: { enabled: false },
        legend: { enabled: false }
      });
    }

    // 3. Loadings Plot
    if (chartRef3.current) {
      const ld = pcaResults.params.map((p: string, i: number) => ({
        name: p,
        x: pcaResults.loadings[i][xAxisPC],
        y: pcaResults.loadings[i][yAxisPC]
      }));

      Highcharts.chart(chartRef3.current, {
        chart: { type: "scatter", backgroundColor: "transparent", zoomType: "xy" },
        title: { text: `Parameter Loadings (${xName} vs ${yName})`, style: titleStyle },
        xAxis: {
          title: { text: `${xName} Loading` },
          gridLineWidth: 1,
          gridLineColor: "#f1f5f9",
          plotLines: [{ value: 0, width: 2, color: "#e2e8f0" }],
          min: -1.05,
          max: 1.05
        },
        yAxis: {
          title: { text: `${yName} Loading` },
          gridLineWidth: 1,
          gridLineColor: "#f1f5f9",
          plotLines: [{ value: 0, width: 2, color: "#e2e8f0" }],
          min: -1.05,
          max: 1.05
        },
        tooltip: tooltipStyle,
        series: [
          {
            name: "Variables",
            type: "scatter",
            data: ld,
            color: {
              radialGradient: { cx: 0.4, cy: 0.3, r: 0.7 },
              stops: [
                [0, "rgba(251, 191, 36, 1)"],
                [1, "rgba(217, 119, 6, 1)"]
              ]
            },
            marker: { symbol: "diamond", radius: 7, lineColor: "#fff", lineWidth: 1 },
            dataLabels: {
              enabled: true,
              format: "{point.name}",
              style: { fontSize: "10px", color: "#1e293b", textOutline: "2px #ffffff" }
            }
          }
        ],
        credits: { enabled: false },
        legend: { enabled: false }
      });
    }

    // 4. Unified Biplot
    if (chartRef4.current) {
      const xScores = filteredDataset.map((_, i) => pcaResults.scores[i][xAxisPC]);
      const yScores = filteredDataset.map((_, i) => pcaResults.scores[i][yAxisPC]);
      const maxX = Math.max(...xScores.map(Math.abs));
      const maxY = Math.max(...yScores.map(Math.abs));
      const scale = Math.max(maxX, maxY) * 0.85 || 1;

      const biplotSeries: any[] = [
        {
          name: "Samples",
          type: "scatter",
          data: filteredDataset.map((row, i) => ({
            x: pcaResults.scores[i][xAxisPC],
            y: pcaResults.scores[i][yAxisPC],
            name: String(row[headers.wellId!] || row[headers.location!] || `Sample ${i + 1}`)
          })),
          color: "rgba(148, 163, 184, 0.55)",
          marker: { radius: 4, lineColor: "rgba(255,255,255,0.6)", lineWidth: 1 }
        }
      ];

      pcaResults.params.forEach((p: string, i: number) => {
        biplotSeries.push({
          type: "line",
          name: p,
          data: [
            [0, 0],
            [pcaResults.loadings[i][xAxisPC] * scale, pcaResults.loadings[i][yAxisPC] * scale]
          ],
          color: "#7c3aed",
          lineWidth: 2,
          marker: { enabled: false },
          dataLabels: {
            enabled: true,
            formatter: function (this: any) {
              return this.point.index === 1 ? p : "";
            },
            style: { fontSize: "10px", color: "#4c1d95", textOutline: "2px #ffffff" }
          }
        });
      });

      Highcharts.chart(chartRef4.current, {
        chart: { backgroundColor: "transparent", zoomType: "xy" },
        title: { text: `Unified Biplot Overlay (${xName} vs ${yName})`, style: titleStyle },
        xAxis: {
          title: { text: xName },
          gridLineColor: "#f1f5f9",
          plotLines: [{ value: 0, width: 2, color: "#e2e8f0" }]
        },
        yAxis: {
          title: { text: yName },
          gridLineColor: "#f1f5f9",
          plotLines: [{ value: 0, width: 2, color: "#e2e8f0" }]
        },
        tooltip: tooltipStyle,
        series: biplotSeries,
        credits: { enabled: false },
        legend: { enabled: false }
      });
    }

    // 5. Correlation Heatmap
    if (chartRef5.current) {
      const hmData: any[] = [];
      for (let i = 0; i < pcaResults.params.length; i++) {
        for (let j = 0; j < pcaResults.params.length; j++) {
          hmData.push([j, i, Math.round(pcaResults.correlation[i][j] * 100) / 100]);
        }
      }

      Highcharts.chart(chartRef5.current, {
        chart: { type: "heatmap", backgroundColor: "transparent" },
        title: { text: "Correlation Coefficient Heatmap", style: titleStyle },
        xAxis: { categories: pcaResults.params, labels: { style: { fontWeight: "bold" } } },
        yAxis: {
          categories: pcaResults.params,
          reversed: true,
          labels: { style: { fontWeight: "bold" } }
        },
        colorAxis: {
          stops: [
            [0, "#3b82f6"],
            [0.5, "#ffffff"],
            [1, "#ef4444"]
          ],
          min: -1,
          max: 1
        },
        tooltip: {
          ...tooltipStyle,
          formatter: function (this: any) {
            return `<b>${this.series.xAxis.categories[this.point.x]} & ${
              this.series.yAxis.categories[this.point.y]
            }</b><br>Correlation coefficient: <b>${this.point.value}</b>`;
          }
        },
        series: [
          {
            type: "heatmap",
            data: hmData,
            borderColor: "#e2e8f0",
            borderWidth: 1,
            dataLabels: {
              enabled: true,
              style: { fontSize: "8px", textOutline: "none", color: "#334155" }
            }
          }
        ],
        credits: { enabled: false },
        legend: { enabled: false }
      });
    }

    // 6. 3D Score Plot (Only if at least 3 parameters exist)
    if (chartRef6.current && pcaResults.variancePercentages.length >= 3) {
      Highcharts.chart(chartRef6.current, {
        chart: {
          type: "scatter3d",
          backgroundColor: "transparent",
          options3d: {
            enabled: true,
            alpha: 15,
            beta: 25,
            depth: 260,
            frame: {
              bottom: { size: 1, color: "#f8fafc" },
              back: { size: 1, color: "#f1f5f9" },
              side: { size: 1, color: "#e2e8f0" }
            }
          }
        },
        title: { text: "3D Spatial Coordinates (PC1 vs PC2 vs PC3)", style: titleStyle },
        xAxis: { title: { text: `PC1` }, gridLineColor: "#f1f5f9" },
        yAxis: { title: { text: `PC2` }, gridLineColor: "#f1f5f9" },
        zAxis: { title: { text: `PC3` }, gridLineColor: "#f1f5f9" },
        tooltip: tooltipStyle,
        series: [
          {
            name: "Samples",
            type: "scatter3d",
            data: filteredDataset.map((row, i) => ({
              x: pcaResults.scores[i][0],
              y: pcaResults.scores[i][1],
              z: pcaResults.scores[i][2],
              name: String(row[headers.wellId!] || row[headers.location!] || `Sample ${i + 1}`)
            })),
            color: {
              radialGradient: { cx: 0.4, cy: 0.3, r: 0.7 },
              stops: [
                [0, "rgba(56, 189, 248, 0.9)"],
                [1, "rgba(2, 132, 199, 0.9)"]
              ]
            },
            marker: { radius: 6, lineColor: "#fff", lineWidth: 1 }
          }
        ],
        credits: { enabled: false },
        legend: { enabled: false }
      });
    }
  }, [pcaResults, activeTab, xAxisPC, yAxisPC, retainedCount, filteredDataset, headers]);

  // Generate mock charts on component mount if no analysis is computed yet
  const mockRef1 = useRef<HTMLDivElement>(null);
  const mockRef2 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pcaResults) return;

    if (mockRef1.current) {
      Highcharts.chart(mockRef1.current, {
        chart: { type: "areaspline", backgroundColor: "transparent" },
        title: { text: "Demo Scree Plot", style: { fontSize: "11px", color: "#64748b" } },
        xAxis: { categories: ["PC1", "PC2", "PC3", "PC4", "PC5"], gridLineColor: "#f1f5f9" },
        yAxis: { visible: false },
        series: [
          {
            name: "Eigenvalue",
            type: "areaspline",
            data: [4.2, 2.1, 1.1, 0.6, 0.2],
            fillColor: {
              linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
              stops: [
                [0, "rgba(124, 58, 237, 0.25)"],
                [1, "rgba(124, 58, 237, 0.0)"]
              ]
            },
            lineColor: "#7c3aed",
            lineWidth: 2,
            marker: { symbol: "circle", radius: 4 }
          }
        ],
        credits: { enabled: false },
        legend: { enabled: false }
      });
    }

    if (mockRef2.current) {
      Highcharts.chart(mockRef2.current, {
        chart: { type: "scatter", backgroundColor: "transparent" },
        title: { text: "Demo Score Plot", style: { fontSize: "11px", color: "#64748b" } },
        xAxis: { gridLineColor: "#f1f5f9", labels: { enabled: false } },
        yAxis: { gridLineColor: "#f1f5f9", labels: { enabled: false } },
        series: [
          {
            name: "Samples",
            type: "scatter",
            data: [
              { x: 1.5, y: 1.2 },
              { x: 1.8, y: 0.8 },
              { x: -1.2, y: -0.9 },
              { x: -1.5, y: -1.5 },
              { x: 0.2, y: 1.9 },
              { x: -0.3, y: -0.4 }
            ],
            color: "#6366f1",
            marker: { radius: 5 }
          }
        ],
        credits: { enabled: false },
        legend: { enabled: false }
      });
    }
  }, [pcaResults]);

  // -----------------------------------------------------------------------------
  // NARRATIVE SUMMARY GENERATORS & INTERPRETATIONS
  // -----------------------------------------------------------------------------
  const sortedLoadingsForPC = (pcIdx: number) => {
    if (!pcaResults) return [];
    return pcaResults.params
      .map((p: string, i: number) => ({
        name: p,
        val: pcaResults.loadings[i][pcIdx],
        absVal: Math.abs(pcaResults.loadings[i][pcIdx])
      }))
      .sort((a: any, b: any) => b.absVal - a.absVal);
  };

  const getPcNarrative = (loads: any[]) => {
    const top = loads.slice(0, 3).map((l) => l.name);
    if (top.some((n) => ["EC", "TDS", "Cl", "TH", "Na", "SO4", "Ca", "Mg"].includes(n))) {
      return {
        factor: "Mineralization & Salinity",
        desc: "Dominant geological weathering and dissolution of rock minerals, leading to elevated salt content and ionic strength.",
        icon: "fa-water",
        theme: "indigo"
      };
    }
    if (top.some((n) => ["NO3", "K", "PO4", "Turbidity"].includes(n))) {
      return {
        factor: "Anthropogenic Infiltration",
        desc: "Reflects surface runoff, domestic effluents, sewage infiltration, or agricultural nitrogenous fertilizers leaching into the aquifer.",
        icon: "fa-tractor",
        theme: "amber"
      };
    }
    if (top.some((n) => ["Fe", "Mn", "As"].includes(n))) {
      return {
        factor: "Redox Mobilization",
        desc: "Anoxic/reducing subsurface environment causing the reduction and subsequent solubilization of iron/manganese oxides, releasing trace metals.",
        icon: "fa-flask",
        theme: "rose"
      };
    }
    if (top.some((n) => ["F", "U"].includes(n))) {
      return {
        factor: "Geogenic Enrichment",
        desc: "Alkaline rock-water interactions dissolving minerals like fluorite or specific granitic uranium-bearing minerals over high residence times.",
        icon: "fa-gem",
        theme: "emerald"
      };
    }
    return {
      factor: "Geochemical Complexity",
      desc: "Represents a secondary mixed geochemical process or localized mineralized precipitation unique to this basin's geology.",
      icon: "fa-random",
      theme: "sky"
    };
  };

  const sampleClassifications = useMemo(() => {
    if (!pcaResults) return { high: [], mod: [], low: [] };
    const scoresWithId = filteredDataset.map((row, i) => ({
      id: String(row[headers.wellId!] || row[headers.location!] || `Sample ${i + 1}`),
      score: pcaResults.scores[i][0]
    }));
    const sorted = [...scoresWithId].sort((a, b) => b.score - a.score);

    const count = sorted.length;
    const sliceCount = Math.max(1, Math.floor(count * 0.25));

    return {
      high: sorted.slice(0, sliceCount),
      low: [...sorted].reverse().slice(0, sliceCount),
      mod: sorted.slice(sliceCount, count - sliceCount).slice(0, 10) // Limit list display
    };
  }, [pcaResults, filteredDataset, headers]);

  // Excel scores export helper
  const exportPcaScoresToExcel = async () => {
    if (!pcaResults) return;
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("PCA_Scores_Export");

      const scoreHeaders = Array.from({ length: retainedCount }, (_, i) => `PC${i + 1}_Score`);
      ws.addRow([
        "Sample_ID",
        "State",
        "District",
        "Block",
        ...scoreHeaders,
        ...pcaResults.params
      ]);

      filteredDataset.forEach((row, rowIndex) => {
        const scoresArr = Array.from({ length: retainedCount }, (_, i) => pcaResults.scores[rowIndex][i]);
        const origValues = pcaResults.params.map((p: string) => {
          const val = parseFloat(String(row[p]).replace(",", "."));
          return isNaN(val) ? "" : val;
        });

        ws.addRow([
          String(row[headers.wellId!] || row[headers.location!] || `Sample ${rowIndex + 1}`),
          String(row[headers.state!] || "N/A"),
          String(row[headers.district!] || "N/A"),
          String(row[headers.block!] || "N/A"),
          ...scoresArr,
          ...origValues
        ]);
      });

      // Format first row as Header
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "4F46E5" }
        };
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `PCA_Scores_Analysis_${Date.now()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("PCA coordinates exported to Excel successfully!", "success");
    } catch (err: any) {
      showToast("Export failed: " + err.message, "error");
    }
  };

  // CSV variance or loadings table exporter
  const exportCsv = (type: "variance" | "loadings") => {
    if (!pcaResults) return;
    let csvContent = "";
    let filename = "";

    if (type === "variance") {
      filename = `PCA_Variance_Explained_${Date.now()}.csv`;
      csvContent += "Principal Component,Eigenvalue,Variance Explained (%),Cumulative Variance (%),Status\n";
      let cum = 0;
      pcaResults.variancePercentages.forEach((v: number, i: number) => {
        cum += v;
        csvContent += `PC${i + 1},${pcaResults.eigenvalues[i].toFixed(4)},${v.toFixed(2)},${cum.toFixed(
          2
        )},${i < retainedCount ? "Retained" : "Discarded"}\n`;
      });
    } else {
      filename = `PCA_Retained_Loadings_${Date.now()}.csv`;
      const pcs = Array.from({ length: retainedCount }, (_, i) => `PC${i + 1}`);
      csvContent += "Parameter," + pcs.join(",") + "\n";
      pcaResults.params.forEach((param: string, pIdx: number) => {
        const row = [param];
        for (let pcIdx = 0; pcIdx < retainedCount; pcIdx++) {
          row.push(pcaResults.loadings[pIdx][pcIdx].toFixed(6));
        }
        csvContent += row.join(",") + "\n";
      });
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate generic template
  const downloadTemplate = () => {
    const columns = [
      "Sample_ID",
      "State",
      "District",
      "Block",
      "pH",
      "EC",
      "TDS",
      "TH",
      "CO3",
      "HCO3",
      "Cl",
      "SO4",
      "NO3",
      "F",
      "Ca",
      "Mg",
      "Na",
      "K",
      "Fe",
      "As",
      "U"
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([columns]), "PCA_Template");
    XLSX.writeFile(wb, "PCA_Groundwater_Template.xlsx");
    showToast("Template downloaded successfully!", "success");
  };

  return (
    <div className="w-full flex flex-col md:flex-row gap-6 text-slate-700 min-h-[600px]">
      {/* ----------------- LEFT SIDEBAR CONTROLS ----------------- */}
      <aside className="w-full md:w-1/3 lg:w-1/4 flex flex-col gap-5 shrink-0 bg-[#13161f] border border-slate-850 p-5 rounded-3xl text-white">
        {/* Source Data Section */}
        <div className="border-b border-slate-800 pb-4">
          <h2 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2 mb-3">
            <Database className="w-3.5 h-3.5" /> 1. PCA Configuration
          </h2>

          <button
            onClick={downloadTemplate}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-bold text-xs transition duration-200 mb-3"
          >
            <Download className="w-4 h-4 text-indigo-400" /> Download Template
          </button>

          <div className="mb-3 text-[11px]">
            <label className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-1 block">
              PCA Matrix Type
            </label>
            <select
              value={pcaType}
              onChange={(e) => setPcaType(e.target.value as any)}
              className="w-full bg-[#0b0e14] border border-slate-700 text-slate-200 rounded-lg p-2.5 font-bold focus:border-indigo-500 outline-none cursor-pointer"
            >
              <option value="correlation">Correlation (Standardized)</option>
              <option value="covariance">Covariance (Mean-Centered)</option>
            </select>
          </div>

          <button
            onClick={runPcaAnalysis}
            disabled={filteredDataset.length < 3 || activeParams.length < 2}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-black text-xs shadow-md transition duration-200"
          >
            <Play className="w-4 h-4" /> Run PCA Engine
          </button>

          {pcaResults && (
            <button
              onClick={exportPcaScoresToExcel}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-sm transition duration-200 mt-2"
            >
              <FileSpreadsheet className="w-4 h-4" /> Export PCA Scores
            </button>
          )}
        </div>

        {/* Local Geographic Filtering */}
        <div className="border-b border-slate-800 pb-4">
          <h2 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2 mb-3">
            <Filter className="w-3.5 h-3.5" /> 2. Cascading Filters
          </h2>
          <div className="space-y-2.5 text-[11px]">
            <div>
              <label className="text-[9px] text-slate-400 uppercase font-bold block mb-1">State / UT</label>
              <select
                value={localState}
                onChange={(e) => handleStateChange(e.target.value)}
                className="w-full bg-[#0b0e14] border border-slate-700 text-slate-200 rounded-lg p-2 focus:border-indigo-500 outline-none cursor-pointer"
              >
                <option value="ALL">All States</option>
                {statesList.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[9px] text-slate-400 uppercase font-bold block mb-1">District</label>
              <select
                value={localDistrict}
                onChange={(e) => handleDistrictChange(e.target.value)}
                disabled={!localState || localState === "ALL"}
                className="w-full bg-[#0b0e14] border border-slate-700 text-slate-200 rounded-lg p-2 focus:border-indigo-500 outline-none cursor-pointer disabled:opacity-50"
              >
                <option value="ALL">All Districts</option>
                {districtsList.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[9px] text-slate-400 uppercase font-bold block mb-1">Block / Tehsil</label>
              <select
                value={localBlock}
                onChange={(e) => setLocalBlock(e.target.value)}
                disabled={!localDistrict || localDistrict === "ALL"}
                className="w-full bg-[#0b0e14] border border-slate-700 text-slate-200 rounded-lg p-2 focus:border-indigo-500 outline-none cursor-pointer disabled:opacity-50"
              >
                <option value="ALL">All Blocks</option>
                {blocksList.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-[#0b0e14] p-2.5 rounded-lg border border-slate-800 text-[10px] text-slate-400 font-bold flex justify-between">
              <span>ACTIVE DATASET:</span>
              <span className="text-indigo-400">{filteredDataset.length} samples</span>
            </div>
          </div>
        </div>

        {/* Feature Space checklist */}
        <div className="border-b border-slate-800 pb-4 flex-grow flex flex-col min-h-[160px]">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" /> 3. Feature Space
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => selectAllParams(true)}
                className="text-[8px] bg-slate-800 text-indigo-300 px-1.5 py-0.5 rounded font-bold hover:bg-slate-700"
              >
                All
              </button>
              <button
                onClick={() => selectAllParams(false)}
                className="text-[8px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-bold hover:bg-slate-700"
              >
                None
              </button>
            </div>
          </div>

          <div className="flex-grow overflow-y-auto max-h-[180px] pr-1.5 scrollbar-thin scrollbar-thumb-slate-800 grid grid-cols-2 gap-1.5 text-[10px]">
            {availableParams.map((p) => (
              <button
                key={p}
                onClick={() => toggleParam(p)}
                className={`flex items-center gap-1.5 p-1.5 rounded-lg border text-left font-bold transition duration-150 ${
                  paramConfig[p]
                    ? "bg-indigo-650 border-indigo-550 text-white"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                {paramConfig[p] ? (
                  <CheckSquare className="w-3.5 h-3.5 shrink-0 text-white" />
                ) : (
                  <Square className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                )}
                <span className="truncate">{p}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Retention Criteria */}
        <div>
          <h2 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1.5 mb-2.5">
            <Bookmark className="w-3.5 h-3.5" /> 4. Retention Criteria
          </h2>
          <div className="space-y-2 text-[11px]">
            <select
              value={retentionMethod}
              onChange={(e) => setRetentionMethod(e.target.value as any)}
              className="w-full bg-[#0b0e14] border border-slate-700 text-slate-200 rounded-lg p-2 focus:border-indigo-500 outline-none cursor-pointer text-[11px]"
            >
              <option value="vis3">Keep Top 3 PCs (Visualization)</option>
              <option value="vis2">Keep Top 2 PCs (Visualization)</option>
              <option value="kaiser">Kaiser Criterion (Eigenvalue &gt; 1)</option>
              <option value="elbow">Auto Scree Plot Elbow Method</option>
              <option value="variance">Explained Variance Threshold</option>
            </select>

            {retentionMethod === "variance" && (
              <div className="flex items-center justify-between gap-2 bg-[#0b0e14] p-2 rounded-lg border border-slate-800 mt-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase">Target Var (%):</span>
                <input
                  type="number"
                  min="50"
                  max="99"
                  value={varianceThreshold}
                  onChange={(e) => setVarianceThreshold(parseInt(e.target.value) || 80)}
                  className="w-16 bg-slate-900 border border-slate-700 text-white rounded p-1 text-[10px] font-mono text-center outline-none"
                />
              </div>
            )}

            {pcaResults ? (
              <div className="bg-emerald-950/40 border border-emerald-800/80 rounded-xl p-2.5 text-center flex items-center justify-center gap-2 mt-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-[10px] font-black text-emerald-300">
                  Retaining {retainedCount} PCs ({retainedCumulativeVariance.toFixed(1)}% Var)
                </span>
              </div>
            ) : (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-2.5 text-center flex items-center justify-center gap-2 mt-2 text-slate-400 text-[10px]">
                <span>Awaiting Computation Run</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ----------------- MAIN REPORT CONTAINER ----------------- */}
      <main className="flex-grow bg-white border border-slate-200 rounded-3xl flex flex-col overflow-hidden shadow-sm">
        {/* Navigation Tabs Header */}
        <div className="flex flex-wrap gap-2 p-3 bg-slate-50 border-b border-slate-200 select-none">
          <button
            onClick={() => setActiveTab("analytics")}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-black rounded-xl transition duration-150 ${
              activeTab === "analytics"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <BarChart2 className="w-4 h-4" /> PCA Analytics
          </button>
          <button
            onClick={() => setActiveTab("summary")}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-black rounded-xl transition duration-150 ${
              activeTab === "summary"
                ? "bg-amber-500 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Sparkles className="w-4 h-4" /> Automated Summary
          </button>
          <button
            onClick={() => setActiveTab("tables")}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-black rounded-xl transition duration-150 ${
              activeTab === "tables"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Table className="w-4 h-4" /> Data Matrices
          </button>
          <button
            onClick={() => setActiveTab("methodology")}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-black rounded-xl transition duration-150 ${
              activeTab === "methodology"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <BookOpen className="w-4 h-4" /> Methodology
          </button>
        </div>

        {/* Content Tabs Switcher */}
        <div className="flex-grow p-5 overflow-y-auto max-h-[680px] scrollbar-thin">
          {/* TAB 1: PCA ANALYTICS */}
          {activeTab === "analytics" && (
            <div className="flex flex-col gap-5">
              {!pcaResults ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
                  <Cpu className="w-16 h-16 text-indigo-200 mb-4 animate-bounce" />
                  <h3 className="font-black text-slate-800 text-lg">No PCA Computed</h3>
                  <p className="text-xs max-w-sm mt-1 text-slate-500">
                    Use the configuration sidebar to select parameters and run the Principal Component Analysis engine.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8 w-full max-w-2xl px-4">
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-2 h-[220px]" ref={mockRef1} />
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-2 h-[220px]" ref={mockRef2} />
                  </div>
                </div>
              ) : (
                <>
                  {/* Global Stats bar */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 shadow-sm relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3 opacity-5 text-indigo-900"><TrendingUp /></div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">PC1 Variance</span>
                      <h4 className="text-xl font-black text-indigo-600 mt-1">
                        {pcaResults.variancePercentages[0].toFixed(1)}%
                      </h4>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 shadow-sm relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3 opacity-5 text-indigo-900"><TrendingUp /></div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">PC2 Variance</span>
                      <h4 className="text-xl font-black text-indigo-600 mt-1">
                        {pcaResults.variancePercentages[1]?.toFixed(1) || "0.0"}%
                      </h4>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 shadow-sm relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3 opacity-5 text-indigo-900"><Layers /></div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Retained Components</span>
                      <h4 className="text-xl font-black text-emerald-600 mt-1">
                        {retainedCount} <span className="text-xs text-slate-400">({retainedCumulativeVariance.toFixed(1)}% Cum.)</span>
                      </h4>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 shadow-sm relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3 opacity-5 text-indigo-900"><Database /></div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Processed Rows</span>
                      <h4 className="text-xl font-black text-slate-800 mt-1">
                        {filteredDataset.length}
                      </h4>
                    </div>
                  </div>

                  {/* Axis Selector Controls */}
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <span className="text-xs font-black uppercase text-slate-600 tracking-wider flex items-center gap-1.5">
                      <Grid className="w-4 h-4 text-indigo-600" /> Coordinate Axes Selector
                    </span>
                    <div className="flex gap-4 text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">Horizontal (X):</span>
                        <select
                          value={xAxisPC}
                          onChange={(e) => setXAxisPC(parseInt(e.target.value))}
                          className="bg-white border border-slate-300 rounded-lg p-1.5 focus:border-indigo-500"
                        >
                          {pcaResults.variancePercentages.map((v: number, i: number) => (
                            <option key={i} value={i}>
                              PC{i + 1} ({v.toFixed(1)}%)
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">Vertical (Y):</span>
                        <select
                          value={yAxisPC}
                          onChange={(e) => setYAxisPC(parseInt(e.target.value))}
                          className="bg-white border border-slate-300 rounded-lg p-1.5 focus:border-indigo-500"
                        >
                          {pcaResults.variancePercentages.map((v: number, i: number) => (
                            <option key={i} value={i}>
                              PC{i + 1} ({v.toFixed(1)}%)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Charts Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-slate-50/50 p-4 border border-slate-200 rounded-2xl h-[360px]" ref={chartRef1} />
                    <div className="bg-slate-50/50 p-4 border border-slate-200 rounded-2xl h-[360px]" ref={chartRef2} />
                    <div className="bg-slate-50/50 p-4 border border-slate-200 rounded-2xl h-[360px]" ref={chartRef3} />
                    <div className="bg-slate-50/50 p-4 border border-slate-200 rounded-2xl h-[360px]" ref={chartRef4} />
                    <div className="bg-slate-50/50 p-4 border border-slate-200 rounded-2xl h-[360px]" ref={chartRef5} />
                    {pcaResults.variancePercentages.length >= 3 ? (
                      <div className="bg-slate-50/50 p-4 border border-slate-200 rounded-2xl h-[360px]" ref={chartRef6} />
                    ) : (
                      <div className="bg-slate-50/50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-center items-center text-center text-slate-400 h-[360px]">
                        <Info className="w-10 h-10 text-slate-300 mb-2" />
                        <span className="font-bold text-slate-700">3D Spatial Plot Unavailable</span>
                        <p className="text-[11px] max-w-xs mt-1 text-slate-500">
                          3D coordinates require selection of at least 3 parameters in the configuration panel.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 2: AUTOMATED SUMMARY */}
          {activeTab === "summary" && (
            <div className="max-w-4xl mx-auto space-y-6">
              {!pcaResults ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-slate-400">
                  <Sparkles className="w-12 h-12 text-amber-300 mb-3 animate-pulse" />
                  <h4 className="font-bold text-slate-800">Summary Awaiting PCA Computation</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs">
                    Please trigger the PCA Engine run from the sidebar to automatically produce the scientific summary.
                  </p>
                </div>
              ) : (
                <>
                  {/* Hero Summary Badge */}
                  <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 to-slate-900 p-6 shadow-md text-white">
                    <div className="absolute top-0 right-0 p-5 opacity-10 text-9xl pointer-events-none">
                      <Sparkles />
                    </div>
                    <div className="relative z-10">
                      <span className="text-[10px] bg-indigo-500/30 px-3 py-1 rounded-full font-black uppercase text-indigo-300 tracking-wider">
                        Hydrochemical Fingerprint Summary
                      </span>
                      <h1 className="text-2xl font-black mt-3">
                        Groundwater Interpretation Report
                      </h1>
                      <p className="text-xs text-slate-300 mt-2 max-w-xl">
                        Based on multivariate mathematical algorithms, we filtered, standardized and compressed{" "}
                        <b>{pcaResults.params.length} groundwater indicators</b> into{" "}
                        <b>{retainedCount} primary orthogonal controls</b> explaining{" "}
                        <b>{retainedCumulativeVariance.toFixed(1)}%</b> of the basin's comprehensive variance.
                      </p>
                      <div className="flex flex-wrap items-center gap-3 mt-4 text-[11px]">
                        <span className="bg-slate-800 border border-slate-700 px-3 py-1 rounded-lg">
                          State: <b>{localState || "All"}</b>
                        </span>
                        {localDistrict !== "ALL" && (
                          <span className="bg-slate-800 border border-slate-700 px-3 py-1 rounded-lg">
                            District: <b>{localDistrict}</b>
                          </span>
                        )}
                        <span className="bg-indigo-600 px-3 py-1 rounded-lg font-bold">
                          {filteredDataset.length} Active Rows
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Retained Components Narrative Breakdown */}
                  <div>
                    <h3 className="text-xs font-black uppercase text-indigo-900 tracking-widest mb-3 border-b pb-1">
                      Component Geochemical Identification
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Array.from({ length: Math.min(retainedCount, 4) }, (_, pcIdx) => {
                        const loads = sortedLoadingsForPC(pcIdx);
                        const story = getPcNarrative(loads);
                        const topDrivers = loads.slice(0, 4);

                        return (
                          <div
                            key={pcIdx}
                            className="bg-slate-50 border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden hover:shadow-md transition duration-200"
                          >
                            <div className="absolute top-4 right-4 opacity-5 text-3xl font-black">
                              PC{pcIdx + 1}
                            </div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">
                              Principal Component {pcIdx + 1} ({pcaResults.variancePercentages[pcIdx].toFixed(1)}% Var)
                            </span>
                            <h4 className="text-sm font-black text-slate-800 mt-0.5">{story.factor}</h4>
                            <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
                              {story.desc}
                            </p>
                            <div className="mt-4 pt-3 border-t border-slate-200/60">
                              <span className="text-[9px] font-black text-slate-400 uppercase block mb-1.5">
                                Top Positive & Negative Drivers
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {topDrivers.map((d: any) => (
                                  <span
                                    key={d.name}
                                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                      d.val > 0
                                        ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                                        : "bg-rose-50 border-rose-100 text-rose-700"
                                    }`}
                                  >
                                    {d.name} ({d.val > 0 ? "+" : ""}
                                    {d.val.toFixed(2)})
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sample Classifications based on PC1 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="border border-red-150 bg-red-50/20 p-4 rounded-2xl shadow-sm">
                      <span className="text-[9px] font-black text-red-600 uppercase tracking-widest block mb-2">
                        🚨 Extreme PC1 Footprint
                      </span>
                      <p className="text-[11px] text-slate-600 mb-3">
                        These stations lie at the highest positive extremity of PC1, pointing to highest mineralization
                        or extreme solute concentration.
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {sampleClassifications.high.map((s: any) => (
                          <span
                            key={s.id}
                            className="bg-white border border-red-100 px-2 py-0.5 rounded text-[9px] font-mono text-red-700 font-bold"
                          >
                            {s.id}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="border border-indigo-150 bg-indigo-50/20 p-4 rounded-2xl shadow-sm">
                      <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest block mb-2">
                        ⚖️ Baseline/Moderate Zone
                      </span>
                      <p className="text-[11px] text-slate-600 mb-3">
                        Representing stations near the geochemical center, exhibiting typical regional water quality
                        equilibrium.
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {sampleClassifications.mod.map((s: any) => (
                          <span
                            key={s.id}
                            className="bg-white border border-indigo-100 px-2 py-0.5 rounded text-[9px] font-mono text-indigo-700 font-bold"
                          >
                            {s.id}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="border border-emerald-150 bg-emerald-50/20 p-4 rounded-2xl shadow-sm">
                      <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest block mb-2">
                        🍃 Fresh / Minimum PC1 Zone
                      </span>
                      <p className="text-[11px] text-slate-600 mb-3">
                        Stations displaying negative/minimum PC1 scores, typically indicative of low mineralization, dilution, or fresh recharge zones.
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {sampleClassifications.low.map((s: any) => (
                          <span
                            key={s.id}
                            className="bg-white border border-emerald-100 px-2 py-0.5 rounded text-[9px] font-mono text-emerald-700 font-bold"
                          >
                            {s.id}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Critical Scientific Conclusion */}
                  <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-5 flex gap-4 items-start">
                    <Lightbulb className="w-6 h-6 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-black uppercase text-indigo-950 tracking-wider">
                        Management Recommendations
                      </h4>
                      <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                        Multivariate component loading demonstrates that the most dominant variable is{" "}
                        <span className="font-bold text-indigo-600">
                          {sortedLoadingsForPC(0)[0]?.name || "N/A"}
                        </span>{" "}
                        followed closely by{" "}
                        <span className="font-bold text-indigo-600">
                          {sortedLoadingsForPC(0)[1]?.name || "N/A"}
                        </span>
                        . To mitigate compliance breaches in this area, water authority efforts should prioritize
                        monitoring groundwater sources around the stations marked under the <b>Extreme PC1 Zone</b>.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 3: DATA MATRICES */}
          {activeTab === "tables" && (
            <div className="space-y-6">
              {!pcaResults ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-slate-400">
                  <Table className="w-12 h-12 text-slate-300 mb-2 animate-pulse" />
                  <h4 className="font-bold text-slate-800">Matrices View Awaiting PCA Run</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Execute the principal component computation in the sidebar to fill table structures.
                  </p>
                </div>
              ) : (
                <>
                  {/* Variance table */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-xs font-black uppercase text-slate-900 tracking-widest flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-500" /> 1. Variance Explained Details
                      </h3>
                      <button
                        onClick={() => exportCsv("variance")}
                        className="text-[10px] font-bold text-indigo-650 flex items-center gap-1 hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" /> Export CSV
                      </button>
                    </div>

                    <div className="bg-white border rounded-2xl overflow-hidden shadow-sm overflow-x-auto">
                      <table className="w-full text-left text-[11px] whitespace-nowrap">
                        <thead className="bg-slate-50 border-b">
                          <tr>
                            <th className="p-3 font-bold">Principal Component</th>
                            <th className="p-3 font-bold text-right">Eigenvalue</th>
                            <th className="p-3 font-bold text-right">Variance Explained (%)</th>
                            <th className="p-3 font-bold text-right">Cumulative Variance (%)</th>
                            <th className="p-3 font-bold text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y font-mono">
                          {(() => {
                            let cumulative = 0;
                            return pcaResults.variancePercentages.map((v: number, i: number) => {
                              cumulative += v;
                              const isRetained = i < retainedCount;
                              return (
                                <tr
                                  key={i}
                                  className={isRetained ? "bg-indigo-50/20 font-bold" : "text-slate-400"}
                                >
                                  <td className="p-3 font-sans">PC{i + 1}</td>
                                  <td className="p-3 text-right">{pcaResults.eigenvalues[i].toFixed(4)}</td>
                                  <td className="p-3 text-right">{v.toFixed(2)}%</td>
                                  <td className="p-3 text-right">{cumulative.toFixed(2)}%</td>
                                  <td className="p-3 text-center">
                                    {isRetained ? (
                                      <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">
                                        Retained
                                      </span>
                                    ) : (
                                      <span className="bg-slate-100 text-slate-400 text-[9px] px-2 py-0.5 rounded-full">
                                        Discarded
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* True Loadings table */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-xs font-black uppercase text-slate-900 tracking-widest flex items-center gap-2">
                        <Layers className="w-4 h-4 text-emerald-500" /> 2. True Loadings Matrix
                      </h3>
                      <button
                        onClick={() => exportCsv("loadings")}
                        className="text-[10px] font-bold text-indigo-650 flex items-center gap-1 hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" /> Export CSV
                      </button>
                    </div>

                    <div className="bg-white border rounded-2xl overflow-hidden shadow-sm overflow-x-auto">
                      <table className="w-full text-left text-[11px] whitespace-nowrap">
                        <thead className="bg-slate-50 border-b">
                          <tr>
                            <th className="p-3 font-bold sticky left-0 bg-slate-50 border-r shadow-sm">
                              Parameter
                            </th>
                            {Array.from({ length: retainedCount }, (_, i) => (
                              <th key={i} className="p-3 font-bold text-right text-indigo-600">
                                PC{i + 1}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y font-mono">
                          {pcaResults.params.map((param: string, pIdx: number) => (
                            <tr key={param} className="hover:bg-slate-50">
                              <td className="p-3 font-sans font-bold sticky left-0 bg-white border-r shadow-sm">
                                {param}
                              </td>
                              {Array.from({ length: retainedCount }, (_, pcIdx) => {
                                const val = pcaResults.loadings[pIdx][pcIdx];
                                const isDominant = Math.abs(val) >= 0.45;
                                return (
                                  <td
                                    key={pcIdx}
                                    className={`p-3 text-right ${
                                      isDominant ? "text-indigo-600 font-extrabold bg-indigo-50/10" : "text-slate-700"
                                    }`}
                                  >
                                    {val.toFixed(4)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-2 italic flex items-center gap-1">
                      <Info className="w-3.5 h-3.5" /> Highly loaded variables (magnitude &ge; 0.45) indicate strongest regional contributions to that Component.
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 4: METHODOLOGY */}
          {activeTab === "methodology" && (
            <div className="space-y-6 max-w-4xl mx-auto text-xs leading-relaxed text-slate-600">
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 to-slate-900 p-6 text-white shadow-md">
                <div className="absolute top-0 right-0 p-5 opacity-5 text-9xl pointer-events-none">
                  <BookOpen />
                </div>
                <div className="relative z-10">
                  <span className="text-[9px] bg-indigo-500/30 px-3 py-1 rounded-full font-black uppercase text-indigo-300">
                    Scientific Reference Module
                  </span>
                  <h3 className="text-xl font-black mt-3 flex items-center gap-2">
                    Understanding Principal Component Analysis (PCA)
                  </h3>
                  <p className="text-slate-300 mt-2 leading-relaxed">
                    PCA is an advanced non-parametric statistical tool designed for dimensionality reduction. In
                    hydrochemistry, multiple variables (pH, EC, metals) frequently exhibit multi-collinear associations.
                    PCA projects these original correlated descriptors into a clean coordinate system of orthogonal,
                    uncorrelated variables called <b>Principal Components</b>.
                  </p>
                </div>
              </div>

              {/* Covariance vs Correlation details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <h4 className="font-black text-indigo-900 text-xs uppercase mb-2 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span> Covariance Matrix Approach
                  </h4>
                  <p className="mb-3">
                    In Covariance PCA, calculations are performed directly on mean-centered raw data.
                  </p>
                  <ul className="list-disc pl-4 space-y-1.5 text-slate-500 text-[11px]">
                    <li>Preserves original physical measurement scales.</li>
                    <li>
                      <b>Scale-sensitive:</b> High-magnitude elements (like EC, frequently measuring in thousands) completely dominate and mask trace indicators (like Arsenic).
                    </li>
                    <li>Highly suited when all chosen inputs share identical metrics/units.</li>
                  </ul>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <h4 className="font-black text-indigo-900 text-xs uppercase mb-2 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span> Correlation Matrix Approach
                  </h4>
                  <p className="mb-3">
                    Correlation PCA standardizes each element into a $Z$-score (mean = 0, standard deviation = 1) before solving.
                  </p>
                  <ul className="list-disc pl-4 space-y-1.5 text-slate-500 text-[11px]">
                    <li>Eliminates biases created by contrasting physical dimensions (e.g., pH vs Arsenic in ppb).</li>
                    <li>Gives all variables equal weight in determining variance.</li>
                    <li>The gold standard approach for mixed groundwater datasets.</li>
                  </ul>
                </div>
              </div>

              {/* Math formulation step-by-step */}
              <div className="border border-slate-200 rounded-2xl p-5 bg-white space-y-4">
                <h4 className="font-black text-slate-800 text-xs uppercase border-b pb-1.5 flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-indigo-500" /> Linear Algebra Formulation Steps
                </h4>

                <div className="space-y-3 font-sans">
                  <div className="flex gap-4">
                    <span className="bg-indigo-100 text-indigo-800 font-extrabold w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                      1
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-800 text-[11px]">Standardization (Z-scores)</h5>
                      <p className="text-slate-500 text-[11px]">
                        Z = (x - mean) / std_dev. Each parameter is converted to have a mean of 0 and standard deviation of 1.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <span className="bg-indigo-100 text-indigo-800 font-extrabold w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                      2
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-800 text-[11px]">Covariance Calculation</h5>
                      <p className="text-slate-500 text-[11px]">
                        C = Z^T * Z / (N - 1). For symmetric matrix C, we solve the characteristic eigenvalue equation: det(C - lambda * I) = 0 to extract eigenvalues.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <span className="bg-indigo-100 text-indigo-800 font-extrabold w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                      3
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-800 text-[11px]">Solving eigenvectors</h5>
                      <p className="text-slate-500 text-[11px]">
                        Using eigenvalues, we compute eigenvectors (V) such that C * V = lambda * V. Eigenvectors dictate the directional orientation of principal axes.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <span className="bg-indigo-100 text-indigo-800 font-extrabold w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                      4
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-800 text-[11px]">Transformation Scores</h5>
                      <p className="text-slate-500 text-[11px]">
                        Individual transformed sample coordinate score is defined by: Score = sum( Z * V ).
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

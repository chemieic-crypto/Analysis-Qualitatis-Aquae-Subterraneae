import Highcharts from "highcharts";
// @ts-ignore
import Highcharts3D from "highcharts/highcharts-3d";
// @ts-ignore
import Cylinder from "highcharts/modules/cylinder";
// @ts-ignore
import Exporting from "highcharts/modules/exporting";
// @ts-ignore
import OfflineExporting from "highcharts/modules/offline-exporting";

// Safe dynamic loader to initialize Highcharts modules perfectly
function initHighchartsHelperModule(module: any, core: any) {
  try {
    if (typeof module === "function") {
      module(core);
    } else if (module && typeof module.default === "function") {
      module.default(core);
    }
  } catch (err) {
    console.warn("Highcharts module initialization deferred inside chartHelpers:", err);
  }
}

// Auto-activate offline plugins to prevent getSVG crash
if (typeof Highcharts === "object") {
  initHighchartsHelperModule(Highcharts3D, Highcharts);
  initHighchartsHelperModule(Cylinder, Highcharts);
  initHighchartsHelperModule(Exporting, Highcharts);
  initHighchartsHelperModule(OfflineExporting, Highcharts);
}

export function safeStringToBase64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  } catch (e) {
    console.error("safeStringToBase64 failed:", e);
    return "";
  }
}

/**
 * Clean vector SVG Generator to fallback safely if Highcharts fails for any reason
 */
export function generateFallbackSvg(options: Highcharts.Options, width: number, height: number): string {
  const title = (options.title && options.title.text) ? options.title.text : "Water Quality Analytics Chart";
  const series: any = options.series && options.series[0];
  const isPie = options.chart?.type === "pie" || (options.series?.[0] as any)?.type === "pie";

  if (isPie) {
    // Generate an elegant fallback Donut Chart in clean vector markup
    const dataPoints: any[] = series?.data || [];
    let itemsHtml = "";
    let totalValue = dataPoints.reduce((sum, item) => sum + (typeof item === 'object' ? (item ? item.y || 0 : 0) : item), 0);
    if (!totalValue) totalValue = 1;

    let currentAngle = 0;
    const colors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#6b7280"];
    
    // Draw slices
    const cx = 220, cy = 240, r = 110, innerR = 60;
    let paths = "";
    
    dataPoints.forEach((point, i) => {
      let name = "";
      let yVal = 0;
      if (typeof point === 'object' && point !== null) {
        name = point.name || "";
        yVal = point.y || 0;
      } else {
        name = `Range ${i + 1}`;
        yVal = point;
      }

      const pct = yVal / totalValue;
      const angle = pct * 360;
      const color = colors[i % colors.length];

      if (pct >= 0.999) {
        paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${r - innerR}" />`;
      } else if (pct > 0) {
        const x1 = cx + r * Math.cos((currentAngle - 90) * Math.PI / 180);
        const y1 = cy + r * Math.sin((currentAngle - 90) * Math.PI / 180);
        const x2 = cx + r * Math.cos((currentAngle + angle - 90) * Math.PI / 180);
        const y2 = cy + r * Math.sin((currentAngle + angle - 90) * Math.PI / 180);

        const innerX1 = cx + innerR * Math.cos((currentAngle - 90) * Math.PI / 180);
        const innerY1 = cy + innerR * Math.sin((currentAngle - 90) * Math.PI / 180);
        const innerX2 = cx + innerR * Math.cos((currentAngle + angle - 90) * Math.PI / 180);
        const innerY2 = cy + innerR * Math.sin((currentAngle + angle - 90) * Math.PI / 180);

        const largeArc = angle > 180 ? 1 : 0;

        paths += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${innerX2} ${innerY2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerX1} ${innerY1} Z" fill="${color}" stroke="#ffffff" stroke-width="2" />`;
      }

      const legendY = 120 + i * 32;
      itemsHtml += `
        <g transform="translate(430, ${legendY})">
          <rect width="16" height="16" rx="4" fill="${color}" />
          <text x="26" y="13" font-family="'Times New Roman', Times, serif" font-size="12px" font-weight="bold" font-style="italic" fill="#334155">${name}: ${yVal} (${(pct * 100).toFixed(1)}%)</text>
        </g>
      `;

      currentAngle += angle;
    });

    const bgFill = options.chart?.backgroundColor === "transparent" ? "none" : "#ffffff";
    const centerCircleFill = options.chart?.backgroundColor === "transparent" ? "none" : "#ffffff";

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="${bgFill}" rx="12" />
        <text x="350" y="55" text-anchor="middle" font-family="'Times New Roman', Times, serif" font-size="12pt" font-weight="bold" fill="#1e3a8a">${title.replace(/<br>/g, " - ")}</text>
        <g>${paths}</g>
        <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${centerCircleFill}" />
        <g>${itemsHtml}</g>
      </svg>
    `;
  } else {
    // Generate an elegant fallback clean vector Column/Cylinder Chart
    const categories: string[] = (options.xAxis && (options.xAxis as any).categories) || [];
    const dataPoints: any[] = series?.data || [];
    
    let columnsHtml = "";
    let labelsHtml = "";
    
    const maxVal = dataPoints.reduce((max, d) => {
      const val = typeof d === 'object' ? (d ? d.y || 0 : 0) : d;
      return val > max ? val : max;
    }, 5);

    const chartHeight = 380;
    const scale = chartHeight / (maxVal * 1.25);

    dataPoints.forEach((point, i) => {
      let val = 0;
      let name = categories[i] || "";
      if (typeof point === 'object' && point !== null) {
        val = point.y || 0;
        if (!name) name = point.name || "";
      } else {
        val = point;
      }
      if (isNaN(val)) val = 0;

      const barWidth = Math.min(75, (width - 250) / (dataPoints.length || 1));
      const spacing = (width - 200) / (dataPoints.length || 1);
      const x = 120 + i * spacing + (spacing - barWidth) / 2;
      const barH = val * scale;
      const y = 500 - barH;

      const fillColor = val > 0 ? "#e11d48" : "#475569";

      columnsHtml += `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="6" fill="${fillColor}" opacity="0.85" stroke="#334155" stroke-width="1.5" />
        <text x="${x + barWidth / 2}" y="${y - 12}" text-anchor="middle" font-family="'Times New Roman', Times, serif" font-size="12pt" font-weight="bold" fill="#be123c">${val.toFixed(2)}%</text>
      `;

      labelsHtml += `
        <text x="${x + barWidth / 2}" y="530" text-anchor="middle" font-family="'Times New Roman', Times, serif" font-size="12pt" font-weight="700" fill="#1e3a8a" transform="rotate(-15, ${x + barWidth / 2}, 530)">${name}</text>
      `;
    });

    const bgFill = options.chart?.backgroundColor === "transparent" ? "none" : "#ffffff";

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="${bgFill}" rx="12" />
        <text x="600" y="60" text-anchor="middle" font-family="'Times New Roman', Times, serif" font-size="12pt" font-weight="bold" fill="#1e3a8a">${title.replace(/<br>/g, " - ")}</text>
        <line x1="80" y1="500" x2="${width - 80}" y2="500" stroke="#475569" stroke-width="2.5" />
        <g>${columnsHtml}</g>
        <g>${labelsHtml}</g>
      </svg>
    `;
  }
}

export function sanitizeSvgStringForCanvas(svgStr: string): string {
  let clean = svgStr;
  
  // 1. Remove @import rules (which trigger cross-origin blocking in sandboxed SVGs)
  clean = clean.replace(/@import\s+url\([^)]+\);?/gi, "");
  clean = clean.replace(/@import\s+['"][^'"]+['"];?/gi, "");
  
  // 2. Remove any external css links
  clean = clean.replace(/<link[^>]*href=["'][^"']*["'][^>]*>/gi, "");
  
  // 3. Strip external web fonts
  clean = clean.replace(/url\(['"]?https?:[^'"()]+['"]?\)/gi, "none");
  
  return clean;
}

export function scaleSvgStringToHighRes(svgStr: string, targetW: number, targetH: number): string {
  let clean = svgStr;
  
  // Parse/find the original width and height
  const widthMatch = clean.match(/<svg[^>]*\bwidth=["'](\d+(?:\.\d+)?)["']/i);
  const heightMatch = clean.match(/<svg[^>]*\bheight=["'](\d+(?:\.\d+)?)["']/i);
  
  const origW = widthMatch ? parseFloat(widthMatch[1]) : targetW / 3;
  const origH = heightMatch ? parseFloat(heightMatch[1]) : targetH / 3;
  
  // Ensure we have a viewBox that covers the original dimensions
  if (!/<svg[^>]*\bviewBox=/i.test(clean)) {
    clean = clean.replace(/<svg/i, `<svg viewBox="0 0 ${origW} ${origH}"`);
  }
  
  // Replace width and height with the target ones
  if (widthMatch) {
    clean = clean.replace(/\bwidth=["']\d+(?:\.\d+)?["']/i, `width="${targetW}"`);
  } else {
    clean = clean.replace(/<svg/i, `<svg width="${targetW}"`);
  }
  
  if (heightMatch) {
    clean = clean.replace(/\bheight=["']\d+(?:\.\d+)?["']/i, `height="${targetH}"`);
  } else {
    clean = clean.replace(/<svg/i, `<svg height="${targetH}"`);
  }
  
  return clean;
}

/**
 * Pure offline base64 PNG rendering engine for Highcharts.
 * Perfect for embedding customized chart data inside exported Microsoft Word reports.
 */
export async function generateOfflineChartBase64(
  options: Highcharts.Options,
  width = 1200,
  height = 700
): Promise<string> {
  return new Promise((resolve) => {
    let container: HTMLDivElement | null = null;
    let chart: any = null;
    try {
      container = document.createElement("div");
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      container.style.position = "absolute";
      container.style.left = "-9999px";
      container.style.top = "-9999px";
      document.body.appendChild(container);

      // Disable animation for instant crisp capture
      const chartOptions: Highcharts.Options = {
        ...options,
        chart: {
          ...options.chart,
          animation: false,
          width: width,   // Render high resolution native vectors
          height: height, // Render high resolution native vectors
          backgroundColor: options.chart?.backgroundColor || "transparent",
          plotBackgroundColor: options.chart?.plotBackgroundColor || "transparent",
          style: {
            fontFamily: "'Times New Roman', Times, serif",
            ...(options.chart?.style || {})
          }
        },
        legend: {
          ...options.legend,
          itemStyle: {
            fontFamily: "'Times New Roman', Times, serif",
            fontSize: "10pt",
            ...(options.legend?.itemStyle || {}),
          },
        },
        plotOptions: {
          ...options.plotOptions,
          series: {
            ...options.plotOptions?.series,
            animation: false,
          },
        },
      };

      let svg = "";
      try {
        chart = Highcharts.chart(container, chartOptions);
        svg = typeof (chart as any).getSVG === "function" ? (chart as any).getSVG() : "";
        if (chart) {
          try { chart.destroy(); } catch (_) {}
          chart = null;
        }
      } catch (firstErr) {
        console.warn("Highcharts 3D/Cylinder render failed. Stripping 3D options and trying 2D fallback...", firstErr);
        
        // Strip 3D and Cylinder specific configurations of Series/Type
        const fallbackType = chartOptions.chart?.type === "pie" ? "pie" : "column";
        const fallbackOptions: Highcharts.Options = {
          ...chartOptions,
          chart: {
            ...chartOptions.chart,
            type: fallbackType,
            options3d: { enabled: false }
          },
          plotOptions: {
            ...chartOptions.plotOptions,
            ...(fallbackType === "pie" ? {
              pie: {
                ...chartOptions.plotOptions?.pie,
                innerSize: "60%"
              }
            } : {
              column: {
                ...chartOptions.plotOptions?.column,
                dataLabels: {
                  enabled: true,
                  format: "{y:.2f}%"
                }
              }
            })
          },
          series: chartOptions.series?.map((s: any) => ({
            ...s,
            type: fallbackType
          }))
        };

        try {
          chart = Highcharts.chart(container, fallbackOptions);
          svg = typeof (chart as any).getSVG === "function" ? (chart as any).getSVG() : "";
          if (chart) {
            try { chart.destroy(); } catch (_) {}
            chart = null;
          }
        } catch (fallbackErr) {
          console.error("Highcharts fallback 2D render also failed. Resorting to clean programmatic vector SVG...", fallbackErr);
          if (chart) {
            try { chart.destroy(); } catch (_) {}
            chart = null;
          }
        }
      }

      if (container && container.parentNode) {
        try { document.body.removeChild(container); } catch (_) {}
        container = null;
      }

      // If SVG generation failed completely, create outstanding dynamic programmatic vectors!
      if (!svg) {
        try {
          svg = generateFallbackSvg(chartOptions, width, height);
        } catch (svgErr) {
          console.error("Native SVG construction crashed. Ultimate empty fallback resolved.", svgErr);
          resolve("");
          return;
        }
      }

      const sanitizedSvg = sanitizeSvgStringForCanvas(svg);
      let cleanSvg = sanitizedSvg;
      if (!/<svg[^>]*\bviewBox=/i.test(cleanSvg)) {
        cleanSvg = cleanSvg.replace(/<svg/i, `<svg viewBox="0 0 ${width} ${height}"`);
      }
      const base64Svg = "data:image/svg+xml;base64," + safeStringToBase64(cleanSvg);
      resolve(base64Svg);
      return;
    } catch (e) {
      console.error("Ultimate chart helpers catch crashed safely.", e);
      if (chart) {
        try { chart.destroy(); } catch (_) {}
      }
      if (container && container.parentNode) {
        try { document.body.removeChild(container); } catch (_) {}
      }
      // Guarantee returning a fallback vector so the outer bulletin generator continues smoothly
      try {
        const ultimateSvg = generateFallbackSvg(options, width, height);
        const sanUltimate = sanitizeSvgStringForCanvas(ultimateSvg);
        resolve("data:image/svg+xml;base64," + safeStringToBase64(sanUltimate));
      } catch (_) {
        resolve("");
      }
    }
  });
}

/**
 * Builds standard 3D Cylinder / Column chart options.
 */
export function buildColumnsChartOptions(title: string, categories: string[], data: any[], yAxisMax = 100): Highcharts.Options {
  const rawMax = data.reduce((max, item) => {
    let val = 0;
    if (typeof item === "number") {
      val = item;
    } else if (item && typeof item === "object") {
      val = typeof item.y === "number" ? item.y : (typeof item[1] === "number" ? item[1] : 0);
    }
    return val > max ? val : max;
  }, 0);
  const computedMax = rawMax > 0 ? Math.min(100, Math.ceil(rawMax / 10) * 10) : 10;

  return {
    chart: {
      type: "column",
      backgroundColor: "transparent",
      plotBackgroundColor: "transparent",
    },
    title: {
      text: title,
      style: { fontSize: "12pt", fontWeight: "bold", color: "#1e293b", fontFamily: "'Times New Roman', Times, serif" },
    },
    xAxis: {
      categories: categories,
      title: { text: "Sampling Locations", style: { fontWeight: "bold", color: "#1e293b", fontSize: "12pt", fontFamily: "'Times New Roman', Times, serif" } },
      labels: { style: { fontWeight: "bold", color: "#475569", fontSize: "12pt", fontFamily: "'Times New Roman', Times, serif" } },
    },
    yAxis: {
      title: { text: "% of Samples Exceeding Permissible Limit", style: { fontWeight: "bold", color: "#1e293b", fontSize: "12pt", fontFamily: "'Times New Roman', Times, serif" } },
      labels: { style: { fontSize: "12pt", color: "#1e293b", fontFamily: "'Times New Roman', Times, serif" } },
      max: computedMax,
    },
    plotOptions: {
      column: {
        colorByPoint: true,
        dataLabels: {
          enabled: true,
          format: "{point.y:.2f}%",
          style: { fontSize: "12pt", color: "#1e293b", textOutline: "none", fontFamily: "'Times New Roman', Times, serif" },
        },
      },
    },
    series: [
      {
        name: "Exceedance %",
        type: "column",
        data: data,
        showInLegend: false,
      },
    ],
    credits: { enabled: false },
  };
}

/**
 * Builds standard 3D Pie / Donut chart options.
 */
export function buildDonutChartOptions(title: string, dataPoints: any[], size = "80%", isDarkTheme = false): Highcharts.Options {
  const finalSize = size; // Use the specified size directly to match detailed analysis and look larger
  const textColor = isDarkTheme ? "#f8fafc" : "#1e293b";
  
  return {
    chart: {
      type: "pie",
      options3d: {
        enabled: true,
        alpha: 45,  // Balanced dramatic perspective tilt to match attached 3D donut image
        beta: 0,
        depth: 70,  // Deeper 3D extrusion/cylinder height for rich tactile depth
      },
      backgroundColor: "transparent",
      plotBackgroundColor: "transparent",
      style: {
        fontFamily: "'Times New Roman', Times, serif"
      }
    },
    title: {
      text: title,
      style: { 
        fontSize: "12pt", 
        fontWeight: "bold", 
        color: textColor, 
        fontFamily: "'Times New Roman', Times, serif" 
      },
    },
    plotOptions: {
      pie: {
        innerSize: "55%", // Perfect chunky ring structure matching Detailed Analysis' gorgeous ratio
        depth: 70,        // Extra depth matching options3d.depth
        size: finalSize,
        borderWidth: 2,   // Crisp boundaries dividing 3D slices beautifully
        borderColor: isDarkTheme ? "#1e293b" : "#ffffff", // High-contrast dividing line matching surrounding card background
        allowPointSelect: false,
        cursor: "pointer",
        slicedOffset: 35,
        dataLabels: {
          enabled: true,
          useHTML: false,
          format: '{point.name}: {point.percentage:.1f}% ({point.y})',
          distance: 15, // Brings labels slightly closer to avoid being pushed off/clipped on the canvas edges
          crop: false, // Ensure labels never get clipped by the plot boundary
          overflow: "allow", // Ensure labels can occupy extra margin space safely
          connectorWidth: 3, // Crisp connector line
          connectorPadding: 8,
          style: { 
            fontFamily: "'Times New Roman', Times, serif",
            fontSize: "10pt", // Compressed text size to prevent clipping
            fontWeight: "bold",
            fontStyle: "italic", // Bold + Italic as requested
            color: isDarkTheme ? "#f8fafc" : "#0f172a",
            textOutline: "none", 
          },
        },
        showInLegend: false, // Turn off legend for clear direct slice labeling as shown in reference
      },
    },
    legend: {
      enabled: false, // Turn off legend as requested
    },
    series: [
      {
        type: "pie",
        name: "Samples",
        data: dataPoints,
      },
    ],
    credits: { enabled: false },
  };
}

/**
 * High quality wrapper for quick generating parameter donut chart as base64 string
 */
export async function generateParamDonutChart(title: string, dataPoints: any[], isDarkTheme = false): Promise<string> {
  const options = buildDonutChartOptions(title, dataPoints, "80%", isDarkTheme);
  return generateOfflineChartBase64(options, 1020, 580);
}

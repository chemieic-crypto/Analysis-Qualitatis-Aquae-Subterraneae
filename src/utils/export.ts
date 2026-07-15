import JSZip from "jszip";

/**
 * Clean vector SVG Generator to fallback safely if conversion fails
 */
function sanitizeSvgStringForCanvas(svgStr: string): string {
  let clean = svgStr;
  // 1. Remove @import rules (which trigger cross-origin blocking in sandboxed SVGs)
  clean = clean.replace(/@import\s+url\([^)]+\);?/gi, "");
  clean = clean.replace(/@import\s+['"][^'"]+['"];?/gi, "");
  
  // 2. Remove any external css links
  clean = clean.replace(/<link[^>]*href=["'][^"']*["'][^>]*>/gi, "");
  
  // 3. Strip external web fonts or absolute URLs in font-face/imports
  clean = clean.replace(/url\(['"]?https?:[^'"()]+['"]?\)/gi, "none");
  
  return clean;
}

function stringToBase64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  } catch (e) {
    console.error("[Export] stringToBase64 failed:", e);
    return window.btoa(unescape(encodeURIComponent(str)));
  }
}

function base64ToString(str: string): string {
  try {
    const binary = window.atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  } catch (e) {
    console.error("[Export] base64ToString failed, using fallback:", e);
    try {
      return decodeURIComponent(escape(window.atob(str)));
    } catch (_) {
      return window.atob(str);
    }
  }
}

function parseSvgDataUrl(src: string): { mediaType: string; isBase64: boolean; decoded: string } {
  const base64Index = src.indexOf(";base64,");
  if (base64Index !== -1) {
    const mediaType = src.substring(0, base64Index);
    const dataPart = src.substring(base64Index + 8);
    let decoded = "";
    try {
      decoded = base64ToString(dataPart);
    } catch (err) {
      console.error("[Export] Base64 decode failed:", err);
    }
    return { mediaType, isBase64: true, decoded };
  } else {
    const commaIndex = src.indexOf(",");
    if (commaIndex !== -1) {
      const mediaType = src.substring(0, commaIndex);
      const dataPart = src.substring(commaIndex + 1);
      let decoded = "";
      try {
        decoded = decodeURIComponent(dataPart);
      } catch (_) {
        decoded = dataPart;
      }
      return { mediaType, isBase64: false, decoded };
    }
  }
  return { mediaType: "data:image/svg+xml", isBase64: false, decoded: "" };
}

function scaleAndSanitizeSvgDataUrl(src: string, targetW: number, targetH: number): string {
  try {
    const { mediaType, isBase64, decoded } = parseSvgDataUrl(src);
    if (!decoded) return src;
    
    let sanitized = sanitizeSvgStringForCanvas(decoded);
    
    // Parse/find original dimensions for viewBox injection
    const widthMatch = sanitized.match(/<svg[^>]*\bwidth=["'](\d+(?:\.\d+)?)["']/i);
    const heightMatch = sanitized.match(/<svg[^>]*\bheight=["'](\d+(?:\.\d+)?)["']/i);
    const origW = widthMatch ? parseFloat(widthMatch[1]) : targetW / 3.5;
    const origH = heightMatch ? parseFloat(heightMatch[1]) : targetH / 3.5;
    
    if (!/<svg[^>]*\bviewBox=/i.test(sanitized)) {
      sanitized = sanitized.replace(/<svg/i, `<svg viewBox="0 0 ${origW} ${origH}"`);
    }
    
    // Strip any existing width or height attributes from the root <svg> element
    sanitized = sanitized.replace(/<svg([^>]*)\bwidth\s*=\s*["'][^"']*["']/i, '<svg$1');
    sanitized = sanitized.replace(/<svg([^>]*)\bheight\s*=\s*["'][^"']*["']/i, '<svg$1');

    // Cleanly inject high-DPI scaled width and height attributes
    sanitized = sanitized.replace(/<svg/i, `<svg width="${targetW}" height="${targetH}"`);

    if (isBase64) {
      return mediaType + ";base64," + stringToBase64(sanitized);
    } else {
      return mediaType + "," + encodeURIComponent(sanitized);
    }
  } catch (err) {
    console.error("[Export] Failed to scale and sanitize SVG data URL:", err);
    return src;
  }
}

/**
 * Robust image loader that resolves any image URL (blob, object URL, remote image)
 * and encodes it to a standard base64 PNG data URL.
 */
async function ensureBase64Image(src: string): Promise<string> {
  if (!src) return "";
  if (src.startsWith("data:image")) {
    return src;
  }
  
  try {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width || 800;
          canvas.height = img.naturalHeight || img.height || 600;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/png"));
            return;
          }
        } catch (e) {
          console.error("[Export] ensureBase64Image canvas draw failed:", e);
        }
        resolve(src);
      };
      img.onerror = (e) => {
        console.warn("[Export] ensureBase64Image loading failed for src:", src, e);
        resolve(src);
      };
      img.src = src;
    });
  } catch (err) {
    console.error("[Export] ensureBase64Image exception for src:", src, err);
    return src;
  }
}

/**
 * Bulletproof SVG conversion to PNG data URL that works in all sandboxed environments.
 */
async function convertSvgToPngDataUrl(svgString: string, fallbackDataUrl: string, targetW: number, targetH: number): Promise<string> {
  return new Promise<string>((resolve) => {
    let parsedSvg = svgString;
    if (parsedSvg && !parsedSvg.includes("xmlns:xlink=")) {
      parsedSvg = parsedSvg.replace(/<svg/i, `<svg xmlns:xlink="http://www.w3.org/1999/xlink"`);
    }
    if (parsedSvg && parsedSvg.includes("<image") && !parsedSvg.includes("xlink:href=")) {
      parsedSvg = parsedSvg.replace(/href=/g, 'xlink:href=');
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(fallbackDataUrl);
      return;
    }

    const img = new Image();
    let isResolved = false;

    const handleSuccess = () => {
      if (isResolved) return;
      isResolved = true;
      try {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        console.warn("[Export] Canvas drawing failed in convertSvgToPngDataUrl, using fallback:", e);
        resolve(fallbackDataUrl);
      }
    };

    img.onload = handleSuccess;

    img.onerror = () => {
      console.warn("[Export] Direct SVG base64 load failed, trying Blob-URL fallback...");
      const blobImg = new Image();
      let blobUrl = "";
      try {
        const blob = new Blob([parsedSvg], { type: "image/svg+xml;charset=utf-8" });
        blobUrl = URL.createObjectURL(blob);
        blobImg.onload = () => {
          try {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, targetW, targetH);
            ctx.drawImage(blobImg, 0, 0, targetW, targetH);
            URL.revokeObjectURL(blobUrl);
            resolve(canvas.toDataURL("image/png"));
          } catch (_) {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            resolve(fallbackDataUrl);
          }
        };
        blobImg.onerror = () => {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          resolve(fallbackDataUrl);
        };
        blobImg.src = blobUrl;
      } catch (err) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        resolve(fallbackDataUrl);
      }
    };

    if (parsedSvg) {
      img.src = "data:image/svg+xml;base64," + stringToBase64(parsedSvg);
    } else {
      img.src = fallbackDataUrl;
    }
  });
}

/**
 * Main High-Fidelity DOCX exporter.
 * Generates a true Office Open XML (.docx) package with fully embedded Base64 images
 * and precise CSS styling. Ensures seamless compatibility with Microsoft Word, LibreOffice, and WPS Office.
 */
export async function convertHtmlToWordDocHtml(contentHtml: string, fileName: string): Promise<string> {
  console.log("[Export] Starting True DOCX (OOXML) Export Pipeline...");
  
  const div = document.createElement("div");
  div.innerHTML = contentHtml;

  // --- PRE-EXPORT VALIDATION ---
  const initialSvgs = Array.from(div.getElementsByTagName("svg"));
  const initialImages = Array.from(div.getElementsByTagName("img"));
  console.log(`[Export] Pre-Export Validation metrics:`);
  console.log(`- Detected Inline SVG Elements: ${initialSvgs.length}`);
  console.log(`- Detected Image Elements: ${initialImages.length}`);

  // 1. Process all existing <img> tags first (convert remote urls, blob:, canvas, objects, etc. to standard Base64 PNGs)
  console.log("[Export] Validating and converting existing images to Base64...");
  for (let i = 0; i < initialImages.length; i++) {
    const img = initialImages[i];
    const src = img.getAttribute("src") || "";
    
    if (src) {
      if (src.startsWith("data:image/svg+xml")) {
        // High-resolution SVG-in-image conversion
        try {
          const imgWidth = img.getAttribute("width") || "550";
          const imgHeight = img.getAttribute("height") || "400";
          const w = Math.max(50, parseInt(imgWidth, 10) || 550);
          const h = Math.max(50, parseInt(imgHeight, 10) || 400);

          const scaleFactor = 8.0; // High-resolution (600 DPI equivalent)
          let targetW = Math.round(w * scaleFactor);
          let targetH = Math.round(h * scaleFactor);

          const maxDimension = 8192;
          if (targetW > maxDimension || targetH > maxDimension) {
            const ratio = Math.min(maxDimension / targetW, maxDimension / targetH);
            targetW = Math.round(targetW * ratio);
            targetH = Math.round(targetH * ratio);
          }

          const scaledSrc = scaleAndSanitizeSvgDataUrl(src, targetW, targetH);
          let svgText = "";
          try {
            const parsed = parseSvgDataUrl(scaledSrc);
            svgText = parsed.decoded || "";
            if (svgText) {
              svgText = svgText
                .replace(/&nbsp;/g, "&#160;")
                .replace(/&deg;/g, "&#176;")
                .replace(/&mu;/g, "&#956;")
                .replace(/&plusmn;/g, "&#177;")
                .replace(/&sup2;/g, "&#178;")
                .replace(/&sup3;/g, "&#179;");
            }
          } catch (_) {}

          // 3-attempt retry conversion
          let pngDataUrl = "";
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              pngDataUrl = await convertSvgToPngDataUrl(svgText, scaledSrc, targetW, targetH);
              if (pngDataUrl && pngDataUrl.startsWith("data:image/png")) {
                break;
              }
            } catch (err) {
              console.warn(`[Export] SVG-Image Conversion Attempt ${attempt} failed:`, err);
              if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt));
            }
          }
          
          if (pngDataUrl) {
            img.setAttribute("src", pngDataUrl);
          }
        } catch (err) {
          console.error("[Export] Failed to convert image SVG to PNG:", err);
        }
      } else if (!src.startsWith("data:image/png") && !src.startsWith("data:image/jpeg")) {
        // Remote or blob URL conversion
        let base64Src = "";
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            base64Src = await ensureBase64Image(src);
            if (base64Src && base64Src.startsWith("data:image/png")) {
              break;
            }
          } catch (err) {
            console.warn(`[Export] Blob/Remote Image Conversion Attempt ${attempt} failed:`, err);
            if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt));
          }
        }
        if (base64Src) {
          img.setAttribute("src", base64Src);
        }
      }
    }
  }

  // 2. Process all inline <svg> elements (like the Piper Diagrams) and convert them to crisp, high-resolution base64 PNGs
  console.log("[Export] Processing inline SVGs...");
  const svgs = Array.from(div.getElementsByTagName("svg"));
  for (let i = 0; i < svgs.length; i++) {
    const svg = svgs[i];
    try {
      if (!svg.getAttribute("xmlns")) {
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      }
      
      const svgWidth = svg.getAttribute("width") || "550";
      const svgHeight = svg.getAttribute("height") || "400";
      const viewBox = svg.getAttribute("viewBox");
      const style = svg.getAttribute("style");
      
      let w = parseInt(svgWidth, 10) || 550;
      let h = parseInt(svgHeight, 10) || 400;
      if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).filter(Boolean);
        if (parts.length === 4) {
          w = Math.round(parseFloat(parts[2])) || w;
          h = Math.round(parseFloat(parts[3])) || h;
        }
      }

      const svgString = new XMLSerializer().serializeToString(svg);
      let sanitizedSvgString = sanitizeSvgStringForCanvas(svgString);

      sanitizedSvgString = sanitizedSvgString
        .replace(/&nbsp;/g, "&#160;")
        .replace(/&deg;/g, "&#176;")
        .replace(/&mu;/g, "&#956;")
        .replace(/&plusmn;/g, "&#177;")
        .replace(/&sup2;/g, "&#178;")
        .replace(/&sup3;/g, "&#179;")
        .replace(/&(?!(amp|lt|gt|quot|apos|#\d+);)/g, "&amp;");

      const scaleFactor = 8.0; // High-resolution (600 DPI equivalent)
      let targetW = Math.max(100, Math.round(w * scaleFactor) || 550);
      let targetH = Math.max(100, Math.round(h * scaleFactor) || 400);

      const maxDimension = 8192;
      if (targetW > maxDimension || targetH > maxDimension) {
        const ratio = Math.min(maxDimension / targetW, maxDimension / targetH);
        targetW = Math.round(targetW * ratio);
        targetH = Math.round(targetH * ratio);
      }

      if (!/<svg[^>]*\bviewBox=/i.test(sanitizedSvgString)) {
        sanitizedSvgString = sanitizedSvgString.replace(/<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
      }

      sanitizedSvgString = sanitizedSvgString.replace(/<svg([^>]*)\bwidth\s*=\s*["'][^"']*["']/i, '<svg$1');
      sanitizedSvgString = sanitizedSvgString.replace(/<svg([^>]*)\bheight\s*=\s*["'][^"']*["']/i, '<svg$1');
      sanitizedSvgString = sanitizedSvgString.replace(/<svg/i, `<svg width="${targetW}" height="${targetH}"`);

      const base64 = stringToBase64(sanitizedSvgString);
      const dataUrl = `data:image/svg+xml;base64,${base64}`;

      // 3-attempt retry conversion
      let pngDataUrl = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[Export] Converting SVG ${i + 1}/${svgs.length} (Attempt ${attempt}/3). Target Dimensions: ${targetW}x${targetH}`);
          pngDataUrl = await convertSvgToPngDataUrl(sanitizedSvgString, dataUrl, targetW, targetH);
          if (pngDataUrl && pngDataUrl.startsWith("data:image/png")) {
            console.log(`[Export] Successfully converted SVG ${i + 1}/${svgs.length} on attempt ${attempt}`);
            break;
          }
        } catch (err) {
          console.warn(`[Export] Attempt ${attempt} failed for SVG ${i + 1}:`, err);
          if (attempt === 3) {
            pngDataUrl = dataUrl; // fallback
          } else {
            await new Promise((r) => setTimeout(r, 200 * attempt));
          }
        }
      }

      const img = document.createElement("img");
      img.src = pngDataUrl;
      img.setAttribute("width", w.toString());
      img.setAttribute("height", h.toString());
      if (style) {
        img.setAttribute("style", style);
      } else {
        img.setAttribute("style", "display: block; margin: 15px auto; max-width: 100%; height: auto;");
      }
      
      svg.parentNode?.replaceChild(img, svg);
    } catch (err) {
      console.error("[Export] Failed to convert inline SVG to PNG:", err);
    }
  }

  // Clear max-width and auto-margin on nested container divs so Word can lay them out fully
  const containerDivs = Array.from(div.getElementsByTagName("div"));
  containerDivs.forEach((container) => {
    const styleAttr = container.getAttribute("style");
    if (styleAttr) {
      const cleaned = styleAttr
        .replace(/max-width\s*:\s*[^;]+;?/gi, "")
        .replace(/max-w\s*:\s*[^;]+;?/gi, "")
        .replace(/margin\s*:\s*0\s+auto;?/gi, "")
        .replace(/margin\s*:\s*auto;?/gi, "");
      container.setAttribute("style", cleaned);
    }
  });

  // Post-process all tables to make them simple MS Word tables with ultra-compact formatting
  const tables = Array.from(div.getElementsByTagName("table"));
  tables.forEach((table) => {
    // Keep or strip col and colgroup - let's remove them and rely on explicit cell width styles
    const cols = Array.from(table.querySelectorAll("col, colgroup"));
    cols.forEach((c) => c.parentNode?.removeChild(c));

    // Force standard border and padding attributes for Word compatibility
    table.setAttribute("border", "1");
    table.setAttribute("cellpadding", "1"); // Minimized padding
    table.setAttribute("cellspacing", "0");
    table.setAttribute("width", "100%");
    
    // Force fixed table layout with 100% width
    table.setAttribute("style", "width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 12pt; margin-bottom: 18pt;");

    const rows = Array.from(table.getElementsByTagName("tr"));

    // Extract explicit column widths from the first row of cells (usually headers) so we can enforce them on all rows
    const colWidths: string[] = [];
    if (rows.length > 0) {
      const firstRowCells = Array.from(rows[0].querySelectorAll("th, td"));
      firstRowCells.forEach((cell) => {
        const style = cell.getAttribute("style") || "";
        let w = cell.getAttribute("width") || "";
        const wMatch = style.match(/width\s*:\s*([^;]+)/i);
        if (wMatch) {
          w = wMatch[1].trim();
        }
        colWidths.push(w);
      });
    }

    rows.forEach((row) => {
      row.removeAttribute("height");
      const currentStyle = row.getAttribute("style") || "";
      const bgMatch = currentStyle.match(/background-color\s*:\s*([^;]+)/i);
      const bgColor = bgMatch ? bgMatch[1] : "";
      
      const isHeader = row.parentElement?.tagName.toLowerCase() === "thead" || row.querySelector("th") !== null;
      
      // Row height will be automatic to fit the text exactly
      let rowStyle = "";
      
      if (bgColor) {
        rowStyle += ` background-color: ${bgColor};`;
      }
      if (/font-weight\s*:\s*bold/i.test(currentStyle)) {
        rowStyle += " font-weight: bold;";
      }
      if (/text-align\s*:\s*center/i.test(currentStyle)) {
        rowStyle += " text-align: center;";
      }
      row.setAttribute("style", rowStyle);

      const cells = Array.from(row.querySelectorAll("th, td"));
      cells.forEach((cell, colIndex) => {
        cell.removeAttribute("width");
        cell.removeAttribute("height");
        cell.classList.remove("whitespace-nowrap");
        
        const cellStyle = cell.getAttribute("style") || "";
        let cleanedCellStyle = cellStyle
          .replace(/width\s*:[^;]+;?/gi, "")
          .replace(/min-width\s*:[^;]+;?/gi, "")
          .replace(/max-width\s*:[^;]+;?/gi, "")
          .replace(/height\s*:[^;]+;?/gi, "")
          .replace(/min-height\s*:[^;]+;?/gi, "")
          .replace(/max-height\s*:[^;]+;?/gi, "")
          .replace(/line-height\s*:[^;]+;?/gi, "")
          .replace(/white-space\s*:[^;]+;?/gi, "")
          .replace(/padding\s*:[^;]+;?/gi, "")
          .replace(/display\s*:[^;]+;?/gi, "");
        
        const isTh = cell.tagName.toLowerCase() === "th";
        const isBold = isTh || /font-weight\s*:\s*bold/i.test(cellStyle);
        const fontSize = isTh ? "10pt" : "9.5pt";
        
        // Propagate the corresponding column width from the header
        const explicitWidth = colWidths[colIndex] || "";
        if (explicitWidth) {
          cleanedCellStyle += ` width: ${explicitWidth};`;
          cell.setAttribute("width", explicitWidth.replace("%", ""));
        }
        
        // 1. Padding: Top/Bottom = 15twips (~0.75pt), Left/Right = 40twips (~2pt)
        // 2. Vertical centering: vertical-align: middle; mso-vertical-align-alt: middle;
        // 3. Spacing: line-height: 1.0; mso-line-height-rule: exactly;
        // 4. Wrapping: word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; white-space: normal !important;
        cleanedCellStyle += ` font-family: 'Times New Roman', Times, serif; font-size: ${fontSize}; padding: 0.75pt 2pt; mso-padding-top-alt: 15twips; mso-padding-bottom-alt: 15twips; mso-padding-left-alt: 40twips; mso-padding-right-alt: 40twips; ${isBold ? "font-weight: bold;" : ""} line-height: 1.0; mso-line-height-rule: exactly; vertical-align: middle; mso-vertical-align-alt: middle; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; white-space: normal !important; margin: 0pt; margin-top: 0pt; margin-bottom: 0pt; mso-margin-top-alt: 0pt; mso-margin-bottom-alt: 0pt;`;
        
        // Align headers centered by default, data aligned according to existing style or left
        if (isTh) {
          cleanedCellStyle += " text-align: center;";
        } else if (!/text-align/i.test(cleanedCellStyle)) {
          cleanedCellStyle += " text-align: left;";
        }

        cell.setAttribute("style", cleanedCellStyle);

        // Strip any paragraph spacing within table cells to strictly follow single-spacing and 0 margins
        const cellParagraphs = Array.from(cell.getElementsByTagName("p"));
        if (cellParagraphs.length > 0) {
          cellParagraphs.forEach((p) => {
            p.setAttribute("style", `margin: 0 !important; padding: 0 !important; font-family: 'Times New Roman', Times, serif; font-size: ${fontSize}; line-height: 1.0 !important; mso-line-height-rule: exactly !important; mso-margin-top-alt: 0pt !important; mso-margin-bottom-alt: 0pt !important; text-align: ${isTh ? "center" : "left"};`);
          });
        } else {
          // Wrap text inside cell in a single <p> to force Word to apply paragraph settings (Before=0, After=0, LineSpacing=Single)
          const originalHTML = cell.innerHTML.trim();
          cell.innerHTML = `<p style="margin: 0 !important; padding: 0 !important; font-family: 'Times New Roman', Times, serif; font-size: ${fontSize}; line-height: 1.0 !important; mso-line-height-rule: exactly !important; mso-margin-top-alt: 0pt !important; mso-margin-bottom-alt: 0pt !important; text-align: ${isTh ? "center" : "left"};">${originalHTML}</p>`;
        }

        // Flatten nested divs inside cells into simple inline spans. Word handles text and inline spans inside cells beautifully, but hates block divs.
        const cellDivs = Array.from(cell.getElementsByTagName("div"));
        cellDivs.forEach((innerDiv) => {
          const span = document.createElement("span");
          span.innerHTML = innerDiv.innerHTML;
          innerDiv.parentNode?.replaceChild(span, innerDiv);
        });
      });
    });
  });

  const finalHtml = div.innerHTML;

  // Prepare full HTML wrapper with robust publication styling
  const completeHtml = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${fileName}</title>
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
  @page Section1 {
    size: 8.27in 11.69in; /* Standard A4 Size */
    margin: 0.6in 0.6in 0.6in 0.6in;
    mso-header-margin: 0.3in;
    mso-footer-margin: 0.3in;
    mso-paper-source: 0;
  }
  div.Section1 {
    page: Section1;
  }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11.5pt;
    color: #111111;
    line-height: 1.6;
    margin: 0;
    padding: 0;
  }
  h1, h2, h3, h4 {
    font-family: 'Times New Roman', Times, serif;
    color: #1e3a8a;
    margin-top: 18pt;
    margin-bottom: 6pt;
    font-weight: bold;
  }
  h1 { font-size: 20pt; text-align: center; margin-bottom: 12pt; }
  h2 { font-size: 15pt; border-bottom: 1.5pt solid #cbd5e1; padding-bottom: 3pt; }
  h3 { font-size: 13pt; }
  table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    margin-top: 12pt;
    margin-bottom: 18pt;
    font-family: 'Times New Roman', Times, serif;
    font-size: 9.5pt;
  }
  tr {
  }
  th, td {
    border: 1pt solid #7f7f7f;
    padding: 0.75pt 2pt;
    mso-padding-top-alt: 15twips;
    mso-padding-bottom-alt: 15twips;
    mso-padding-left-alt: 40twips;
    mso-padding-right-alt: 40twips;
    text-align: left;
    vertical-align: middle;
    mso-vertical-align-alt: middle;
    font-family: 'Times New Roman', Times, serif;
    font-size: 9.5pt;
    white-space: normal !important;
    word-break: break-word;
    word-wrap: break-word;
    overflow-wrap: break-word;
    line-height: 1.0;
    mso-line-height-rule: exactly;
  }
  table th p, table td p {
    margin: 0 !important;
    padding: 0 !important;
    line-height: 1.0 !important;
    mso-line-height-rule: exactly !important;
    mso-margin-top-alt: 0pt !important;
    mso-margin-bottom-alt: 0pt !important;
  }
  th {
    font-size: 10pt;
    background-color: #f2f2f2;
    font-weight: bold;
    color: #000000;
    text-align: center;
  }
  .text-left { text-align: left; }
  .text-right { text-align: right; }
  .font-bold { font-weight: bold; }
  .text-rose-600 { color: #dc2626; font-weight: bold; }
  .text-emerald-700 { color: #047857; font-weight: bold; }
  .mb-4 { margin-bottom: 16px; }
  .mt-8 { margin-top: 32px; }
  ul { margin-top: 6pt; margin-bottom: 12pt; padding-left: 20pt; }
  li { margin-bottom: 4pt; }
  .bg-white { background-color: #ffffff; }
  .rounded-2xl { border-radius: 8px; }
  .border { border: 1pt solid #cbd5e1; }
  .p-5 { padding: 15pt; }
  .bg-indigo-900 { background-color: #1e3a8a; color: #ffffff; padding: 15pt; border-radius: 8px; }
  .text-indigo-100 { color: #dbeafe; }
  .text-indigo-50 { color: #f0f9ff; }
  .text-emerald-400 { color: #34d399; }
  .text-amber-400 { color: #fbbf24; }
</style>
</head>
<body>
  <div class="Section1">
    ${finalHtml}
  </div>
</body>
</html>`;

  return completeHtml;
}

export async function downloadMhtmlWordDoc(contentHtml: string, fileName: string) {
  console.log("[Export] Starting True DOCX (OOXML) Export Pipeline...");
  try {
    const completeHtml = await convertHtmlToWordDocHtml(contentHtml, fileName);
    
    const blob = new Blob([completeHtml], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.doc`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    console.log("[Export] High-compatibility Word (.doc) Export completed successfully.");
  } catch (err) {
    console.error("[Export] Failed to generate Word document:", err);
  }
}

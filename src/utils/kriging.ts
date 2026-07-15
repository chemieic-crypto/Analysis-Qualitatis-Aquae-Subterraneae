export interface KrigingPoint {
  lat: number;
  lng: number;
  val: number;
}

/**
 * Computes Local Ordinary Kriging spatial interpolation at a given latitude & longitude target coordinate.
 * It uses a local subset of nearest-neighbor control points (up to 8) to maintain ultra-fast
 * performance during high-resolution canvas grid pixel evaluation loops.
 */
export function krigingInterpolate(targetLat: number, targetLng: number, pts: KrigingPoint[]): number {
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0].val;

  // 1. Subset to nearest neighbors to prevent huge matrices and keep grid loops ultra-fast
  const k = Math.min(8, pts.length);
  const localPts = pts
    .map(p => {
      const dLat = targetLat - p.lat;
      const dLng = targetLng - p.lng;
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);
      return { p, dist };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, k)
    .map(x => x.p);

  const n = localPts.length;
  if (n === 0) return 0;

  // If extremely close to an actual sample point, return its exact value directly
  if (localPts[0].lat === targetLat && localPts[0].lng === targetLng) {
    return localPts[0].val;
  }

  // 2. Build the Orindary Kriging linear system: Ax = B
  // Using linear variogram with zero nugget: gamma(h) = h
  const A: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  const B: number[] = new Array(n + 1).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dLat = localPts[i].lat - localPts[j].lat;
      const dLng = localPts[i].lng - localPts[j].lng;
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);
      A[i][j] = dist; // gamma(dist)
    }
    A[i][n] = 1;
    A[n][i] = 1;

    const dLatTar = targetLat - localPts[i].lat;
    const dLngTar = targetLng - localPts[i].lng;
    B[i] = Math.sqrt(dLatTar * dLatTar + dLngTar * dLngTar); // gamma(dist_to_target)
  }
  A[n][n] = 0;
  B[n] = 1;

  // 3. Solve the (n+1) x (n+1) matrix equation using Gaussian Elimination with partial pivoting
  const size = n + 1;
  const x = new Array(size).fill(0);

  // Augment A with B
  const mat: number[][] = Array.from({ length: size }, (_, r) => {
    const row = [...A[r]];
    row.push(B[r]);
    return row;
  });

  for (let i = 0; i < size; i++) {
    // Search for pivot row with maximum absolute value to guide division stability
    let maxEl = Math.abs(mat[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < size; k++) {
      if (Math.abs(mat[k][i]) > maxEl) {
        maxEl = Math.abs(mat[k][i]);
        maxRow = k;
      }
    }

    // Swap row
    if (maxRow !== i) {
      const temp = mat[i];
      mat[i] = mat[maxRow];
      mat[maxRow] = temp;
    }

    // Guard against singular matrix constraints
    if (Math.abs(mat[i][i]) < 1e-12) {
      let sumW = 0;
      let sumVal = 0;
      for (let j = 0; j < n; j++) {
        const dLat = targetLat - localPts[j].lat;
        const dLng = targetLng - localPts[j].lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng) || 0.0001;
        const w = 1 / (dist * dist);
        sumW += w;
        sumVal += w * localPts[j].val;
      }
      return sumW > 0 ? sumVal / sumW : 0;
    }

    // Perform row elimination
    for (let k = i + 1; k < size; k++) {
      const c = -mat[k][i] / mat[i][i];
      for (let j = i; j <= size; j++) {
        if (i === j) {
          mat[k][j] = 0;
        } else {
          mat[k][j] += c * mat[i][j];
        }
      }
    }
  }

  // Back-substitute to find weights
  for (let i = size - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < size; j++) {
      sum += mat[i][j] * x[j];
    }
    x[i] = (mat[i][size] - sum) / mat[i][i];
  }

  // Estimate the kriging result as sum(wi * val_i)
  let valEstimation = 0;
  for (let i = 0; i < n; i++) {
    valEstimation += x[i] * localPts[i].val;
  }

  return valEstimation;
}

/**
 * Fuel Level Calibration Utility
 * Converts raw FMB920 sensor values to actual fuel liters using calibration tables
 */

export interface CalibrationPoint {
  level: number;  // Raw sensor value
  liters: number; // Actual fuel in liters
}

export interface CalibrationTable {
  sensorId: string;
  vehicleId: string;
  points: CalibrationPoint[];
  tankCapacity: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Converts raw fuel level sensor value to actual fuel liters
 * @param raw241 - Raw value from FMB920 parameter 241
 * @param levelTbl - Array of calibration level values
 * @param literTbl - Array of corresponding liter values
 * @returns Fuel in liters (NaN if invalid)
 */
export function levelToLiters(
  raw241: number, 
  levelTbl: number[], 
  literTbl: number[]
): number {
  // Validation
  if (!Number.isFinite(raw241) || 
      levelTbl.length !== literTbl.length || 
      levelTbl.length < 2) {
    return NaN;
  }

  const maxTbl = Math.max(...levelTbl);
  
  // Auto de-scale if raw value is much larger than calibration range
  let lvl = raw241 > 10 * maxTbl ? raw241 / 100 : raw241;

  // Clamp to calibration bounds
  if (lvl <= levelTbl[0]) return literTbl[0];
  if (lvl >= levelTbl[levelTbl.length - 1]) return literTbl[literTbl.length - 1];

  // Binary search for interpolation segment
  let lo = 0, hi = levelTbl.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (levelTbl[mid] <= lvl) lo = mid; 
    else hi = mid;
  }

  // Linear interpolation
  const x0 = levelTbl[lo], x1 = levelTbl[hi];
  const y0 = literTbl[lo], y1 = literTbl[hi];
  const t = (lvl - x0) / (x1 - x0);
  
  return y0 + t * (y1 - y0);
}

/**
 * Calculate fuel percentage based on liters and tank capacity
 * @param liters - Current fuel in liters
 * @param tankCapacity - Total tank capacity in liters
 * @returns Percentage (0-100)
 */
export function litersToPercentage(liters: number, tankCapacity: number): number {
  if (tankCapacity <= 0 || liters < 0) return 0;
  return Math.min(100, Math.max(0, (liters / tankCapacity) * 100));
}

/**
 * Apply 3-point moving average smoothing to reduce noise
 * @param values - Array of fuel level readings
 * @returns Smoothed values
 */
export function smoothFuelReadings(values: number[]): number[] {
  if (values.length < 3) return values;
  
  const smoothed = [];
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      // First point: average of first two
      smoothed.push((values[i] + values[i + 1]) / 2);
    } else if (i === values.length - 1) {
      // Last point: average of last two
      smoothed.push((values[i - 1] + values[i]) / 2);
    } else {
      // Middle points: 3-point average
      smoothed.push((values[i - 1] + values[i] + values[i + 1]) / 3);
    }
  }
  
  return smoothed;
}

/**
 * Validate if fuel reading should be processed
 * @param data - FMB920 data object
 * @returns true if reading is valid
 */
export function isValidFuelReading(data: any): boolean {
  // Check if BLE is connected (parameter 239)
  const bleConnected = data?.['239'] === 1;
  
  // Check if fuel level parameter exists
  const hasFuelLevel = data?.['241'] !== undefined && data?.['241'] !== null;
  
  return bleConnected && hasFuelLevel;
}

/**
 * Default calibration table (example - replace with actual values)
 * Based on your calibration sheet
 */
export const DEFAULT_CALIBRATION: CalibrationPoint[] = [
  { level: 1, liters: 0 },
  { level: 107, liters: 5 },
  { level: 164, liters: 10 },
  { level: 213, liters: 15 },
  { level: 260, liters: 20 },
  { level: 348, liters: 25 },
  { level: 410, liters: 30 },
  { level: 500, liters: 35 },
  { level: 600, liters: 40 },
  { level: 700, liters: 45 },
  { level: 800, liters: 50 },
  { level: 900, liters: 55 },
  { level: 1000, liters: 60 },
  { level: 1100, liters: 65 },
  { level: 1200, liters: 70 },
  { level: 1300, liters: 75 },
  { level: 1400, liters: 80 },
  { level: 1500, liters: 85 },
  { level: 1600, liters: 90 },
  { level: 1700, liters: 95 },
  { level: 1800, liters: 100 }
];

/**
 * Extract level and liter arrays from calibration points
 */
export function extractCalibrationArrays(points: CalibrationPoint[]): {
  levels: number[];
  liters: number[];
} {
  return {
    levels: points.map(p => p.level),
    liters: points.map(p => p.liters)
  };
}

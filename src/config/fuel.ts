export const FUEL_ANOMALY_THRESHOLDS = {
  THEFT: 15, // Liters (configurable via env later)
  REFUEL: 5  // Liters
};

export const FUEL_CONFIG = {
  ANOMALY_THRESHOLDS: FUEL_ANOMALY_THRESHOLDS,
  // Future config options can be added here
  SENSOR_NOISE_THRESHOLD: 1, // Liters - ignore changes smaller than this
  MAX_FUEL_LEVEL: 300, // Liters - maximum reasonable fuel level
  MIN_FUEL_LEVEL: 0,   // Liters - minimum fuel level
};

#!/usr/bin/env python3
"""
Generate a synthetic vehicle telematics dataset with:
- 11,000 rows @ 5-minute interval timestamps
- Columns: timestamp, fuel_level, previous_fuel_level, distance_km, location_lat, location_long,
           speed, ignition_status, is_over_speed, fuel_diff, event_type
- Rule order: theft -> refuel -> low_fuel -> normal
- Fuel capacity: 300 L
- Overspeed: always False (60 km/h limit)
- Continuity enforced: previous_fuel_level[i] = fuel_level[i-1] (row 0 is NaN)
- Low fuel streaks and 0-fuel linger for 2–3 rows
- Target distribution: normal 60%, theft 15%, refuel 15%, low_fuel 10%
- Mixing: every 20-row block contains all four event types
Usage:
  python make_telematics_dataset.py --out vehicle_telematics_11000_target6415_mixed.csv
"""
import argparse
from datetime import datetime, timedelta, timezone
import numpy as np
import pandas as pd
import os
from urllib.parse import urlparse
import uuid
import psycopg2
from psycopg2.extras import execute_batch

def clip_latlon(lat, lon):
    # Keep roughly within a city-sized box (Bengaluru-ish)
    lat = np.clip(lat, 12.7, 13.3)
    lon = np.clip(lon, 77.3, 77.9)
    return lat, lon

def simulate_base(N=11000, start_ts=None, rng=None, freq_minutes=5, tank_size=300.0):
    if rng is None:
        rng = np.random.default_rng(20250818)
    if start_ts is None:
        start_ts = datetime(2025, 8, 1, 8, 0, 0, tzinfo=timezone.utc)
    
    rows = []
    # Initial conditions
    fuel = float(rng.uniform(180, 260))
    prev_distance = 0.0
    distance = 0.0
    lat, lon = 12.9716, 77.5946
    zero_fuel_buffer = 0
    
    for i in range(N):
        ts = start_ts + timedelta(minutes=i * freq_minutes)
        
        # Driving pattern: mix of moving/idle; keep speeds <= 60 to ensure overspeed False
        moving = rng.random() < 0.7
        ignition_status = "ON" if moving or rng.random() < 0.2 else "OFF"
        
        if ignition_status == "OFF":
            speed = 0.0
        else:
            # Sample typical urban speeds, cap at 60
            speed = max(0.0, float(rng.normal(38, 15)))
            speed = float(np.clip(speed, 0.0, 60.0))
        
        # Distance increment
        dist_inc = (speed / 60.0) * freq_minutes if speed > 0 else 0.0
        dist_inc = max(0.0, float(dist_inc + rng.normal(0, 0.03)))
        distance = distance + dist_inc
        
        # Lat/lon random walk
        if dist_inc > 0:
            lat += float(rng.normal(0, 0.0006)) * (1 + dist_inc/10)
            lon += float(rng.normal(0, 0.0006)) * (1 + dist_inc/10)
        else:
            lat += float(rng.normal(0, 0.00005))
            lon += float(rng.normal(0, 0.00005))
        lat, lon = clip_latlon(lat, lon)
        
        # Baseline burn (L / 5-min)
        if ignition_status == "ON" and speed > 0:
            base_burn = (0.07 + 0.0045 * (speed / 10))
            burn = max(0.01, float(base_burn + rng.normal(0, 0.015)))
        else:
            burn = max(0.0, float(rng.normal(0.004, 0.004)))
        
        # Natural evolution (subject to 0-fuel linger override later)
        if i == 0:
            prev_fuel = None
        else:
            prev_fuel = rows[-1]["fuel_level"]
        
        if prev_fuel is None:
            pass  # keep initial
        else:
            fuel = max(0.0, min(tank_size, prev_fuel - burn + float(rng.normal(0, 0.04))))
        
        # Enforce 0-fuel linger if active
        if zero_fuel_buffer > 0:
            fuel = 0.0
            zero_fuel_buffer -= 1
        
        rows.append({
            "timestamp": ts.isoformat(),
            "fuel_level": round(float(fuel), 2),
            "previous_fuel_level": (None if prev_fuel is None else round(float(prev_fuel), 2)),
            "distance_km": round(float(distance), 3),
            "location_lat": round(float(lat), 6),
            "location_long": round(float(lon), 6),
            "speed": round(float(speed), 2),
            "ignition_status": ignition_status,
            "is_over_speed": False,  # fixed per requirement
            "fuel_diff": 0.0,  # fill later after re-link
            "event_type": "normal",  # provisional, will be set by rules
        })
        
        # Occasionally start a 0-fuel linger if we just hit near-zero
        if rows[-1]["fuel_level"] == 0.0 and zero_fuel_buffer == 0 and rng.random() < 0.2:
            zero_fuel_buffer = int(rng.integers(2, 4))
    
    return pd.DataFrame(rows)

def relink_and_label(df):
    """Enforce continuity and label by rule order: theft → refuel → low_fuel → normal."""
    df = df.copy()
    df["previous_fuel_level"] = df["fuel_level"].shift(1)
    df.loc[0, "previous_fuel_level"] = np.nan
    df["fuel_diff"] = (df["fuel_level"] - df["previous_fuel_level"]).round(2)
    
    distance_shift = df["distance_km"].shift(1)
    stationary = (df["speed"].fillna(0) == 0) & ((df["distance_km"] - distance_shift).fillna(0).abs() < 1e-9)
    
    labels = []
    for i, r in df.iterrows():
        if pd.isna(r["previous_fuel_level"]):
            labels.append("normal"); continue
        
        drop = r["previous_fuel_level"] - r["fuel_level"]
        
        # 2. Theft
        if stationary.iloc[i] and drop > 0.5:
            labels.append("theft"); continue
        if drop > 1.5:
            labels.append("theft"); continue
        
        # 3. Refuel
        if (r["fuel_level"] - r["previous_fuel_level"]) >= 0.01:
            labels.append("refuel"); continue
        
        # 4. Low fuel
        if r["fuel_level"] < 20.0:
            labels.append("low_fuel"); continue
        
        labels.append("normal")
    
    df["event_type"] = labels
    df["is_over_speed"] = False
    return df

def convert_row_to(df, idx, et, rng, tank=300.0):
    """Logic-safe conversion of a single row to a target event type."""
    prev = df.at[idx, "previous_fuel_level"]
    if pd.isna(prev):
        # For first row, fabricate a prev consistent with target
        prev = df.at[idx, "fuel_level"]
        df.at[idx, "previous_fuel_level"] = prev
    
    if et == "refuel":
        new = min(tank, float(prev) + float(rng.uniform(2.0, 15.0)))
        df.at[idx, "fuel_level"] = round(new, 2)
    elif et == "theft":
        # Prefer general theft (drop > 1.5), keep non-stationary to avoid special branch
        new = max(0.0, float(prev) - float(rng.uniform(1.6, 4.5)))
        df.at[idx, "fuel_level"] = round(new, 2)
        if df.at[idx, "speed"] == 0.0:
            df.at[idx, "speed"] = float(rng.uniform(5.0, 25.0))
    elif et == "low_fuel":
        # Ensure <20 and not refuel; also avoid theft thresholds
        level = float(rng.uniform(5.0, 19.8))
        if level >= prev:
            prev = level + float(rng.uniform(0.1, 0.3))
            df.at[idx, "previous_fuel_level"] = round(prev, 2)
        if (prev - level) > 1.5:
            level = prev - float(rng.uniform(0.1, 1.2))
        df.at[idx, "fuel_level"] = round(level, 2)
        # Not stationary theft
        if df.at[idx, "speed"] == 0.0:
            df.at[idx, "speed"] = float(rng.uniform(5.0, 25.0))
        # tiny distance change if needed
        if idx > 0 and abs(df.at[idx, "distance_km"] - df.at[idx-1, "distance_km"]) < 1e-9:
            df.at[idx, "distance_km"] = df.at[idx-1, "distance_km"] + float(rng.uniform(0.01, 0.2))
    elif et == "normal":
        # Keep >=20, small change, avoid refuel & theft
        level = max(20.0, float(prev) - float(rng.uniform(0.0, 1.0)))
        if (prev - level) > 1.5:  # avoid theft
            level = prev - float(rng.uniform(0.0, 1.2))
            level = max(20.0, level)
        if (level - prev) >= 0.01:  # avoid refuel
            level = prev - float(rng.uniform(0.0, 0.2))
            level = max(20.0, level)
        df.at[idx, "fuel_level"] = round(level, 2)
        if df.at[idx, "speed"] == 0.0 and np.random.rand() < 0.5:
            df.at[idx, "speed"] = float(np.random.uniform(5.0, 25.0))

def enforce_mixing(df, rng):
    """Ensure each 20-row block contains all 4 event types."""
    df = df.copy()
    df = relink_and_label(df)
    
    for k in range(0, len(df), 20):
        block = df.iloc[k:k+20]
        present = set(block["event_type"].unique().tolist())
        needed = {"normal", "theft", "refuel", "low_fuel"} - present
        
        for et in needed:
            # Prefer to flip a normal row; else any row
            candidates = block[block["event_type"] == "normal"].index.tolist()
            if not candidates:
                candidates = block.index.tolist()
            idx = int(rng.choice(candidates))
            convert_row_to(df, idx, et, rng)
        
        # Re-label after changes in the block
        df = relink_and_label(df)
    
    return df

def balance_distribution(df, target_counts, rng):
    """Match the exact global distribution while keeping rule consistency and continuity."""
    df = df.copy()
    
    # Iterate until counts match
    for _ in range(10):
        df = relink_and_label(df)
        counts = df["event_type"].value_counts().to_dict()
        
        # Compute deficits/surpluses
        delta = {k: target_counts[k] - counts.get(k, 0) for k in target_counts}
        if all(v == 0 for v in delta.values()):
            break
        
        # Grow refuel/theft from normals first, then reduce low_fuel if needed
        if delta["refuel"] > 0:
            pool = df.index[df["event_type"] == "normal"].tolist()
            n = min(delta["refuel"], len(pool))
            for idx in np.random.default_rng(rng.integers(0, 1<<31)).choice(pool, size=n, replace=False):
                convert_row_to(df, int(idx), "refuel", rng)
        
        if delta["theft"] > 0:
            pool = df.index[df["event_type"] == "normal"].tolist()
            n = min(delta["theft"], len(pool))
            for idx in np.random.default_rng(rng.integers(0, 1<<31)).choice(pool, size=n, replace=False):
                convert_row_to(df, int(idx), "theft", rng)
        
        df = relink_and_label(df)
        counts = df["event_type"].value_counts().to_dict()
        delta = {k: target_counts[k] - counts.get(k, 0) for k in target_counts}
        
        # Trim excess low_fuel to normal if needed
        if counts.get("low_fuel", 0) > target_counts["low_fuel"]:
            to_convert = counts["low_fuel"] - target_counts["low_fuel"]
            pool = df.index[df["event_type"] == "low_fuel"].tolist()
            n = min(to_convert, len(pool))
            for idx in np.random.default_rng(rng.integers(0, 1<<31)).choice(pool, size=n, replace=False):
                convert_row_to(df, int(idx), "normal", rng)
        
        df = relink_and_label(df)
    
    return df

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sensors", type=int, default=5, help="Number of vehicles/sensors to seed (1:1)")
    ap.add_argument("--rows-per-sensor", type=int, default=200, help="Rows per sensor")
    ap.add_argument("--seed", type=int, default=20250818)
    ap.add_argument("--start", type=str, default="2025-08-01T08:00:00Z")
    ap.add_argument("--db", type=str, default=os.getenv("DATABASE_URL", "postgresql://fueladmin:mysecretpassword@localhost:5433/fueltheftdb"), help="Postgres DATABASE_URL")
    ap.add_argument("--csv", type=str, default="", help="Optional path to also write CSV snapshot")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)

    # Resolve DB URL for host execution (replace docker host 'postgres' with localhost:5433 when needed)
    def resolve_db_url(db_url: str) -> str:
        try:
            parsed = urlparse(db_url)
            if parsed.hostname == "postgres":
                # Use host-mapped port
                return f"postgresql://{parsed.username}:{parsed.password}@localhost:5433{parsed.path}"
            return db_url
        except Exception:
            return db_url

    db_url = resolve_db_url(args.db)

    # Connect to Postgres
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    def upsert_vehicle(reg_no: str) -> str:
        sql = (
            'INSERT INTO "Vehicle" (id, "registrationNo") VALUES (%s, %s) '
            'ON CONFLICT ("registrationNo") DO UPDATE SET "registrationNo" = EXCLUDED."registrationNo" '
            'RETURNING id'
        )
        vid = str(uuid.uuid4())
        cur.execute(sql, (vid, reg_no))
        return cur.fetchone()[0]

    def upsert_sensor(sensor_code: str, vehicle_id: str) -> str:
        sql = (
            'INSERT INTO "Sensor" (id, "sensorCode", "vehicleId") VALUES (%s, %s, %s) '
            'ON CONFLICT ("sensorCode") DO UPDATE SET "vehicleId" = EXCLUDED."vehicleId" '
            'RETURNING id'
        )
        sid = str(uuid.uuid4())
        cur.execute(sql, (sid, sensor_code, vehicle_id))
        return cur.fetchone()[0]

    def upsert_driver(vehicle_id: str, idx: int) -> str:
        name = f"Driver {idx}"
        phone = f"9990000{str(idx).zfill(3)}"
        license_no = f"LIC{str(idx).zfill(6)}"
        sql = (
            'INSERT INTO "Driver" (id, name, phone, "licenseNo", "vehicleId") VALUES (%s, %s, %s, %s, %s) '
            'ON CONFLICT ("vehicleId") DO UPDATE SET name = EXCLUDED.name '
            'RETURNING id'
        )
        did = str(uuid.uuid4())
        cur.execute(sql, (did, name, phone, license_no, vehicle_id))
        return cur.fetchone()[0]

    def insert_readings(sensor_id: str, sensor_code: str, df: pd.DataFrame):
        # Map to DB columns
        rows = []
        # Simulate odometer baseline and device voltage
        odo_base = float(rng.uniform(75000, 130000))
        for _, r in df.iterrows():
            ts = datetime.fromisoformat(str(r["timestamp"]))
            fuel_level = None if pd.isna(r["fuel_level"]) else float(r["fuel_level"])
            lat = None if pd.isna(r["location_lat"]) else float(r["location_lat"]) 
            lon = None if pd.isna(r["location_long"]) else float(r["location_long"]) 
            speed = None if pd.isna(r["speed"]) else float(r["speed"]) 
            ignition = str(r["ignition_status"]) if pd.notna(r["ignition_status"]) else None
            is_over_speed = bool(r.get("is_over_speed", False))
            distance_km = float(r["distance_km"]) if pd.notna(r["distance_km"]) else 0.0
            odo = odo_base + distance_km
            voltage = float(12.0 + rng.normal(0, 0.4))
            topic = f"{sensor_code}/data"
            rows.append((
                str(uuid.uuid4()),
                ts,
                fuel_level,
                lat,
                lon,
                speed,
                ignition,
                odo,
                voltage,
                None,              # address
                False,             # processed
                is_over_speed,
                None,              # raw
                topic,
                sensor_id,
            ))

        sql = (
            'INSERT INTO "SensorReading" '
            '(id, timestamp, "fuelLevel", "locationLat", "locationLong", speed, "ignitionStatus", "odometerKm", "deviceVoltage", address, processed, "isOverSpeed", raw, topic, "sensorId") '
            'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) '
            'ON CONFLICT ("sensorId", timestamp) DO NOTHING'
        )
        execute_batch(cur, sql, rows, page_size=1000)

    # Seed loop
    total_rows = 0
    created = 0
    for i in range(1, args.sensors + 1):
        reg_no = f"MH12-FT{str(i).zfill(4)}"
        sensor_code = f"FMB920-{str(i).zfill(6)}"

        # Ensure Vehicle and Sensor exist
        vehicle_id = upsert_vehicle(reg_no)
        sensor_id = upsert_sensor(sensor_code, vehicle_id)
        _driver_id = upsert_driver(vehicle_id, i)

        # Generate data for this sensor
        start_ts = datetime.fromisoformat(args.start.replace("Z", "+00:00")) + timedelta(days=i-1)
        df = simulate_base(N=args.rows_per_sensor, start_ts=start_ts, rng=rng)
        df = relink_and_label(df)
        target = {
            "normal": int(0.60*args.rows_per_sensor),
            "theft": int(0.15*args.rows_per_sensor),
            "refuel": int(0.15*args.rows_per_sensor),
            "low_fuel": int(0.10*args.rows_per_sensor)
        }
        df = balance_distribution(df, target, rng)
        df = enforce_mixing(df, rng)
        df["fuel_level"] = df["fuel_level"].clip(0, 300.0)
        df = relink_and_label(df)

        # Insert readings
        insert_readings(sensor_id, sensor_code, df)
        total_rows += len(df)
        created += 1

    # Commit all inserts
    conn.commit()
    cur.close()
    conn.close()

    print(f"Seeded {total_rows} readings across {created} sensors into DB.")

    # Optional CSV snapshot
    if args.csv:
        # Regenerate a combined CSV snapshot for reference
        rng2 = np.random.default_rng(args.seed)
        df_snap = simulate_base(N=args.rows_per_sensor, start_ts=datetime.fromisoformat(args.start.replace("Z","+00:00")), rng=rng2)
        df_snap = relink_and_label(df_snap)
        df_snap.to_csv(args.csv, index=False)
        print(f"Also wrote CSV snapshot to {args.csv}")

if __name__ == "__main__":
    main()

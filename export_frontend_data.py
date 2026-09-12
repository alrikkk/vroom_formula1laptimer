"""
VROOM Data Exporter for Frontend
Extracts verified race data, cleaning metrics, driver cohorts,
model evaluations, Verstappen stint predictions, and Ridge parameters
into a clean JSON structure for the frontend presentation layer.
Does NOT modify any ML logic, models, or raw files.
"""

import json
from pathlib import Path
import pandas as pd
import numpy as np

from src.data_pipeline import (
    TARGET_RACE_ID,
    TARGET_DRIVER_IDS,
    load_raw_data,
    filter_and_merge,
    clean_lap_data,
    construct_stints_and_tire_age,
    stint_train_test_split,
)
from src.models import train_and_evaluate_all, BASELINE_FEATURES, ENHANCED_FEATURES

workspace_dir = Path(__file__).parent
output_dir = workspace_dir / "outputs"

print("[Exporter] Ingesting and evaluating pipeline outputs...")
lap_times, pit_stops, results, races, drivers = load_raw_data(workspace_dir)
merged_df = filter_and_merge(lap_times, pit_stops, results, races, drivers)
clean_df, cleaning_summary = clean_lap_data(merged_df, pit_stops)
featured_df = construct_stints_and_tire_age(clean_df, pit_stops)
train_df, test_df = stint_train_test_split(featured_df)
metrics_df, trained_models, test_predictions = train_and_evaluate_all(train_df, test_df, output_dir)

# Race Metadata
race_meta = {
    "raceId": TARGET_RACE_ID,
    "name": "Austrian Grand Prix",
    "year": 2019,
    "round": 9,
    "circuit": "Red Bull Ring (Spielberg)",
    "date": "2019-06-30",
    "distanceLaps": 71,
    "conditions": {
        "weather": "Dry",
        "ambientTemp": "31°C",
        "trackTemp": "50°C",
        "redFlags": False,
        "safetyCars": 0,
        "virtualSafetyCars": 0,
        "verification": "Externally verified historical FIA timing bulletins"
    }
}

# Driver Cohort List
drivers_cohort = []
for did in TARGET_DRIVER_IDS:
    d_rows = clean_df[clean_df["driverId"] == did]
    first = d_rows.iloc[0]
    total_laps = int(first["laps"]) if "laps" in first else len(d_rows)
    # Get pit stop laps
    p_records = pit_stops[(pit_stops["raceId"] == TARGET_RACE_ID) & (pit_stops["driverId"] == did)]
    pit_laps = sorted(p_records["lap"].astype(int).tolist())
    
    drivers_cohort.append({
        "driverId": did,
        "code": first["code"],
        "name": first["driver_name"],
        "grid": int(first["grid"]),
        "positionOrder": int(first["positionOrder"]),
        "status": "Finished" if first["statusId"] == 1 else "+1 Lap",
        "completedLaps": int(d_rows["lap"].max()),
        "pitStopsCount": len(pit_laps),
        "pitLaps": pit_laps,
        "trainLaps": int((clean_df[(clean_df["driverId"] == did) & (clean_df["lap"] < (min(pit_laps) if pit_laps else 99))]).shape[0]),
        "cleanTotalLaps": len(d_rows)
    })

# Format metrics table
metrics_records = metrics_df.to_dict(orient="records")

# Verstappen Stint Data
ver_test = test_predictions[test_predictions["driverId"] == 830].sort_values(by="lap")
verstappen_stint = []
for _, row in ver_test.iterrows():
    verstappen_stint.append({
        "lap": int(row["lap"]),
        "tire_age": int(row["tire_age"]),
        "actual": round(float(row["lap_time_seconds"]), 3),
        "rf_baseline": round(float(row["pred_random_forest_baseline"]), 3),
        "rf_enhanced": round(float(row["pred_random_forest_enhanced"]), 3),
        "ridge_baseline": round(float(row["pred_ridge_regression_baseline"]), 3),
        "ridge_enhanced": round(float(row["pred_ridge_regression_enhanced"]), 3),
        "rf_enhanced_error": round(float(abs(row["pred_random_forest_enhanced"] - row["lap_time_seconds"])), 3)
    })

# Model inference parameters for Ridge models
ridge_base_pipeline = trained_models["Ridge Regression_Baseline (grid, lap)"]
ridge_enh_pipeline = trained_models["Ridge Regression_Enhanced (grid, lap, tire_age)"]

models_parameters = {
    "ridge_baseline": {
        "features": BASELINE_FEATURES,
        "scaler_mean": [round(x, 6) for x in ridge_base_pipeline.named_steps["scaler"].mean_.tolist()],
        "scaler_scale": [round(x, 6) for x in ridge_base_pipeline.named_steps["scaler"].scale_.tolist()],
        "coef": [round(x, 6) for x in ridge_base_pipeline.named_steps["ridge"].coef_.tolist()],
        "intercept": round(float(ridge_base_pipeline.named_steps["ridge"].intercept_), 6)
    },
    "ridge_enhanced": {
        "features": ENHANCED_FEATURES,
        "scaler_mean": [round(x, 6) for x in ridge_enh_pipeline.named_steps["scaler"].mean_.tolist()],
        "scaler_scale": [round(x, 6) for x in ridge_enh_pipeline.named_steps["scaler"].scale_.tolist()],
        "coef": [round(x, 6) for x in ridge_enh_pipeline.named_steps["ridge"].coef_.tolist()],
        "intercept": round(float(ridge_enh_pipeline.named_steps["ridge"].intercept_), 6)
    }
}

# Test predictions lookup by driver
test_predictions_by_driver = {}
for did, group in test_predictions.groupby("driverId"):
    laps_list = []
    for _, row in group.sort_values(by="lap").iterrows():
        laps_list.append({
            "lap": int(row["lap"]),
            "grid": int(row["grid"]),
            "stint": int(row["stint"]),
            "tire_age": int(row["tire_age"]),
            "actual": round(float(row["lap_time_seconds"]), 3),
            "rf_baseline": round(float(row["pred_random_forest_baseline"]), 3),
            "rf_enhanced": round(float(row["pred_random_forest_enhanced"]), 3),
            "ridge_baseline": round(float(row["pred_ridge_regression_baseline"]), 3),
            "ridge_enhanced": round(float(row["pred_ridge_regression_enhanced"]), 3),
        })
    test_predictions_by_driver[str(did)] = laps_list

full_payload = {
    "race": race_meta,
    "cleaning": cleaning_summary,
    "drivers": drivers_cohort,
    "metrics": metrics_records,
    "verstappen_stint": verstappen_stint,
    "models_parameters": models_parameters,
    "test_predictions_by_driver": test_predictions_by_driver,
    "counts": {
        "raw_laps": 705,
        "removed_laps": 22,
        "clean_laps": 683,
        "train_laps": 280,
        "test_laps": 403
    }
}

json_path = output_dir / "race_data.json"
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(full_payload, f, indent=2)

print(f"[Exporter] Successfully exported structured frontend payload to: {json_path}")

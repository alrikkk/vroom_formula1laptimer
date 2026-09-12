"""
VROOM: Formula 1 Lap Time Predictor
Module: data_pipeline.py

Implements deterministic data ingestion, relational merging, sequential cleaning rules,
stint construction, tire age feature engineering, and non-random stint-based train/test splitting.
"""

from pathlib import Path
from typing import Dict, List, Tuple
import pandas as pd
import numpy as np

# Locked Project Constants
TARGET_RACE_ID = 1018  # 2019 Austrian Grand Prix
TARGET_DRIVER_IDS = [830, 844, 822, 20, 1, 846, 842, 832, 8, 841]


def load_raw_data(data_dir: Path) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load the raw CSV tables into pandas dataframes without modifying source files."""
    data_dir = Path(data_dir)
    lap_times = pd.read_csv(data_dir / "lap_times.csv")
    pit_stops = pd.read_csv(data_dir / "pit_stops.csv")
    results = pd.read_csv(data_dir / "results.csv")
    races = pd.read_csv(data_dir / "races.csv")
    drivers = pd.read_csv(data_dir / "drivers.csv")
    return lap_times, pit_stops, results, races, drivers


def filter_and_merge(
    lap_times: pd.DataFrame,
    pit_stops: pd.DataFrame,
    results: pd.DataFrame,
    races: pd.DataFrame,
    drivers: pd.DataFrame,
    race_id: int = TARGET_RACE_ID,
    driver_ids: List[int] = TARGET_DRIVER_IDS,
) -> pd.DataFrame:
    """
    Filter data to the target race and driver cohort, and merge relational tables.
    Maintains strictly 1 row per driver/lap.
    """
    # 1. Filter races to target race
    race_row = races[races["raceId"] == race_id]
    if race_row.empty:
        raise ValueError(f"Race ID {race_id} not found in races table.")
    race_name = race_row.iloc[0]["name"]
    race_year = race_row.iloc[0]["year"]

    # 2. Filter lap_times to target race and driver cohort
    laps_filtered = lap_times[
        (lap_times["raceId"] == race_id) & (lap_times["driverId"].isin(driver_ids))
    ].copy()

    # Convert milliseconds to lap_time_seconds
    laps_filtered["lap_time_seconds"] = laps_filtered["milliseconds"] / 1000.0

    # 3. Filter results to target race and drivers
    results_filtered = results[
        (results["raceId"] == race_id) & (results["driverId"].isin(driver_ids))
    ][["raceId", "driverId", "grid", "positionOrder", "statusId"]].copy()

    # 4. Merge driver starting grid & finishing position
    merged = laps_filtered.merge(results_filtered, on=["raceId", "driverId"], how="left")

    # 5. Attach driver metadata (name, code)
    drivers_meta = drivers[["driverId", "code", "forename", "surname"]].copy()
    drivers_meta["driver_name"] = drivers_meta["forename"] + " " + drivers_meta["surname"]
    merged = merged.merge(drivers_meta[["driverId", "code", "driver_name"]], on="driverId", how="left")

    # 6. Flag pit stop in-laps
    pit_stops_race = pit_stops[
        (pit_stops["raceId"] == race_id) & (pit_stops["driverId"].isin(driver_ids))
    ][["raceId", "driverId", "lap", "stop"]].copy()
    pit_stops_race["is_pit_in_lap"] = True

    merged = merged.merge(
        pit_stops_race, on=["raceId", "driverId", "lap"], how="left"
    )
    merged["is_pit_in_lap"] = merged["is_pit_in_lap"].fillna(False).astype(bool)
    merged["stop"] = merged["stop"].fillna(0).astype(int)

    # Sort strictly by driverId and lap
    merged = merged.sort_values(by=["driverId", "lap"]).reset_index(drop=True)

    print(f"Data Filtered: {race_year} {race_name} (raceId={race_id})")
    print(f"Initial raw rows for {len(driver_ids)} drivers: {len(merged)}")
    return merged


def clean_lap_data(df: pd.DataFrame, pit_stops: pd.DataFrame, race_id: int = TARGET_RACE_ID) -> Tuple[pd.DataFrame, Dict[str, int]]:
    """
    Apply the three mandatory cleaning rules sequentially:
    1. Remove pit-stop in-laps.
    2. Remove immediate out-laps (lap P+1).
    3. Calculate driver median lap times on remaining flying laps.
    4. Remove slow laps (> 1.5 * driver's clean flying median lap time).
    """
    raw_count = len(df)

    # Identify pit stop laps for this race and drivers
    pit_records = pit_stops[
        (pit_stops["raceId"] == race_id) & (pit_stops["driverId"].isin(TARGET_DRIVER_IDS))
    ]
    
    pit_in_keys = set(zip(pit_records["driverId"], pit_records["lap"].astype(int)))
    pit_out_keys = set(zip(pit_records["driverId"], pit_records["lap"].astype(int) + 1))

    # Rule 1: Flag pit-in laps
    is_pit_in = df.apply(lambda row: (row["driverId"], int(row["lap"])) in pit_in_keys, axis=1)
    
    # Rule 2: Flag pit-out laps (immediate following lap)
    is_pit_out = df.apply(lambda row: (row["driverId"], int(row["lap"])) in pit_out_keys, axis=1)

    # Filter to remaining flying laps after Rule 1 and Rule 2
    flying_laps = df[~(is_pit_in | is_pit_out)]

    # Rule 3: Compute driver median on clean flying laps, then flag slow outliers (> 1.5x median)
    flying_driver_medians = flying_laps.groupby("driverId")["lap_time_seconds"].median().to_dict()
    
    is_slow_outlier = df.apply(
        lambda row: (
            not is_pit_in.loc[row.name]
            and not is_pit_out.loc[row.name]
            and (row["lap_time_seconds"] > 1.5 * flying_driver_medians[row["driverId"]])
        ),
        axis=1,
    )

    # Tally removals
    removed_pit_in = int(is_pit_in.sum())
    removed_pit_out = int(is_pit_out.sum())
    removed_slow = int(is_slow_outlier.sum())
    total_removed = removed_pit_in + removed_pit_out + removed_slow

    # Filter retained laps
    retain_mask = ~(is_pit_in | is_pit_out | is_slow_outlier)
    clean_df = df[retain_mask].copy().reset_index(drop=True)

    cleaning_summary = {
        "raw_rows": raw_count,
        "removed_pit_in_laps": removed_pit_in,
        "removed_pit_out_laps": removed_pit_out,
        "removed_slow_laps": removed_slow,
        "total_removed": total_removed,
        "final_clean_rows": len(clean_df),
    }

    print("\n=== DATA CLEANING AUDIT ===")
    for k, v in cleaning_summary.items():
        print(f"  {k}: {v}")

    return clean_df, cleaning_summary


def construct_stints_and_tire_age(
    clean_df: pd.DataFrame, pit_stops: pd.DataFrame, race_id: int = TARGET_RACE_ID
) -> pd.DataFrame:
    """
    Assign stint numbers and calculate tire_age for each retained flying lap.
    - Stint 1 = laps before pit stop 1
    - Stint 2 = laps after pit stop 1 and before pit stop 2 (if applicable)
    - Final Stint = laps after the driver's final pit stop
    - tire_age resets to 0 at the first retained flying lap of each stint and increments by 1.
    """
    pit_records = pit_stops[
        (pit_stops["raceId"] == race_id) & (pit_stops["driverId"].isin(TARGET_DRIVER_IDS))
    ]
    
    # Map driverId -> list of pit in-lap numbers sorted ascending
    driver_pit_laps = {}
    for did, group in pit_records.groupby("driverId"):
        driver_pit_laps[did] = sorted(group["lap"].astype(int).tolist())

    processed_rows = []
    
    for did, group in clean_df.groupby("driverId"):
        p_laps = driver_pit_laps.get(did, [])
        group_sorted = group.sort_values(by="lap").copy()
        
        # Determine stint number for each lap
        def get_stint_num(lap: int) -> int:
            stint = 1
            for pl in p_laps:
                if lap > pl:
                    stint += 1
            return stint

        group_sorted["stint"] = group_sorted["lap"].apply(get_stint_num)
        
        # Determine total stints for this driver
        total_stints = group_sorted["stint"].max()
        group_sorted["is_final_stint"] = group_sorted["stint"] == total_stints
        
        # Compute tire_age within each stint: 0 for the first retained lap, 1, 2, ...
        group_sorted["tire_age"] = group_sorted.groupby("stint").cumcount()
        
        processed_rows.append(group_sorted)

    result_df = pd.concat(processed_rows, ignore_index=True)
    result_df = result_df.sort_values(by=["driverId", "lap"]).reset_index(drop=True)
    return result_df


def stint_train_test_split(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Strict non-random stint-based split:
    - Earlier stints (stint < final_stint) -> Training Set
    - Final stint (stint == final_stint) -> Testing Set
    """
    train_df = df[~df["is_final_stint"]].copy().reset_index(drop=True)
    test_df = df[df["is_final_stint"]].copy().reset_index(drop=True)

    print("\n=== STINT TRAIN / TEST SPLIT SUMMARY ===")
    print(f"Total clean rows: {len(df)}")
    print(f"Training rows (Earlier Stints): {len(train_df)} ({len(train_df)/len(df)*100:.1f}%)")
    print(f"Testing rows (Final Stint): {len(test_df)} ({len(test_df)/len(df)*100:.1f}%)")
    
    # Driver-level breakdown
    driver_summary = []
    for did, group in df.groupby("driverId"):
        d_name = group.iloc[0]["driver_name"]
        code = group.iloc[0]["code"]
        stint_cnt = group["stint"].nunique()
        tr_cnt = len(group[~group["is_final_stint"]])
        te_cnt = len(group[group["is_final_stint"]])
        driver_summary.append({
            "driverId": did,
            "code": code,
            "driver": d_name,
            "total_stints": stint_cnt,
            "train_laps": tr_cnt,
            "test_laps": te_cnt,
            "total_laps": len(group)
        })
        
    summary_df = pd.DataFrame(driver_summary)
    print("\nDriver Cohort Stint Distribution:")
    print(summary_df.to_string(index=False))

    return train_df, test_df

"""
VROOM: Formula 1 Lap Time Predictor
Main Pipeline Execution Script
"""

from pathlib import Path
from src.data_pipeline import (
    load_raw_data,
    filter_and_merge,
    clean_lap_data,
    construct_stints_and_tire_age,
    stint_train_test_split,
)
from src.models import train_and_evaluate_all
from src.visualize import plot_driver_stint_predictions


def main():
    workspace_dir = Path(__file__).parent
    output_dir = workspace_dir / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)

    print("==================================================")
    print("      VROOM: FORMULA 1 LAP TIME PREDICTOR         ")
    print("==================================================")

    # 1. Load Raw Data
    print("\n[Step 1/5] Ingesting CSV datasets...")
    lap_times, pit_stops, results, races, drivers = load_raw_data(workspace_dir)

    # 2. Filter to 2019 Austrian GP & 10 Locked Drivers, and Merge
    print("\n[Step 2/5] Filtering and merging relational tables...")
    merged_df = filter_and_merge(lap_times, pit_stops, results, races, drivers)

    # 3. Clean Lap Data (In-laps, Out-laps, >1.5x median)
    print("\n[Step 3/5] Cleaning lap data according to assignment rules...")
    clean_df, cleaning_summary = clean_lap_data(merged_df, pit_stops)

    # 4. Construct Stints and Calculate Tire Age
    print("\n[Step 4/5] Constructing stints and engineering tire_age...")
    featured_df = construct_stints_and_tire_age(clean_df, pit_stops)

    # 5. Non-Random Stint-Based Train/Test Split
    print("\n[Step 5/5] Partitioning non-random stint split...")
    train_df, test_df = stint_train_test_split(featured_df)

    # 6. Train Models and Evaluate Metrics
    metrics_df, trained_models, test_predictions = train_and_evaluate_all(
        train_df, test_df, output_dir
    )

    # 7. Generate Stint Visualization for Max Verstappen (race winner)
    print("\nGenerating predicted-vs-actual stint visualization...")
    plot_path = output_dir / "stint_prediction_verstappen.png"
    plot_driver_stint_predictions(test_predictions, driver_id=830, output_path=plot_path)

    print("\n==================================================")
    print("          PIPELINE EXECUTION COMPLETED!           ")
    print("==================================================")
    print("\nFinal Model Comparison Table:")
    print(metrics_df.to_string(index=False))
    print(f"\nArtifacts generated in: {output_dir}")


if __name__ == "__main__":
    main()

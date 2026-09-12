"""
VROOM: Formula 1 Lap Time Predictor
Module: visualize.py

Generates publication-quality predicted-vs-actual stint visualizations
for a complete driver test stint.
"""

from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

# Styling configuration
plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")
plt.rcParams.update({
    "font.family": "sans-serif",
    "font.size": 11,
    "axes.labelsize": 12,
    "axes.titlesize": 14,
    "xtick.labelsize": 10,
    "ytick.labelsize": 10,
    "legend.fontsize": 11,
    "figure.titlesize": 15,
})


def plot_driver_stint_predictions(
    test_predictions: pd.DataFrame,
    driver_id: int = 830,  # Max Verstappen
    output_path: Path = Path("outputs/stint_prediction_verstappen.png")
):
    """
    Plot predicted vs actual lap times across a complete driver test stint.
    Compares Actual Lap Times with Baseline and Enhanced models.
    """
    driver_stint = test_predictions[test_predictions["driverId"] == driver_id].sort_values(by="lap")
    if driver_stint.empty:
        raise ValueError(f"No test predictions found for driverId {driver_id}")

    driver_name = driver_stint.iloc[0]["driver_name"]
    driver_code = driver_stint.iloc[0]["code"]
    stint_num = driver_stint.iloc[0]["stint"]
    start_lap = int(driver_stint["lap"].min())
    end_lap = int(driver_stint["lap"].max())
    num_laps = len(driver_stint)

    fig, ax = plt.subplots(figsize=(12, 6.5), dpi=300)

    # 1. Actual Lap Times
    ax.plot(
        driver_stint["lap"],
        driver_stint["lap_time_seconds"],
        color="#111827",
        marker="o",
        markersize=5,
        linewidth=2.2,
        label="Actual Lap Time",
        zorder=5
    )

    # 2. Baseline Model (Random Forest: grid, lap)
    ax.plot(
        driver_stint["lap"],
        driver_stint["pred_random_forest_baseline"],
        color="#EF4444",
        linestyle="--",
        linewidth=2.0,
        alpha=0.85,
        label="Random Forest (Baseline: grid + lap)",
        zorder=3
    )

    # 3. Enhanced Model (Random Forest: grid, lap, tire_age)
    ax.plot(
        driver_stint["lap"],
        driver_stint["pred_random_forest_enhanced"],
        color="#10B981",
        linestyle="-",
        linewidth=2.4,
        label="Random Forest (Enhanced: grid + lap + tire_age)",
        zorder=4
    )

    # 4. Enhanced Model (Ridge Regression: grid, lap, tire_age)
    ax.plot(
        driver_stint["lap"],
        driver_stint["pred_ridge_regression_enhanced"],
        color="#3B82F6",
        linestyle=":",
        linewidth=2.0,
        alpha=0.85,
        label="Ridge Regression (Enhanced: grid + lap + tire_age)",
        zorder=3
    )

    ax.set_title(
        f"VROOM — Final Stint Lap Time Prediction: {driver_name} ({driver_code})\n"
        f"2019 Austrian Grand Prix | Stint {stint_num} (Laps {start_lap}–{end_lap}, {num_laps} Laps)",
        fontweight="bold",
        pad=15
    )
    ax.set_xlabel("Race Lap Number", fontweight="bold", labelpad=8)
    ax.set_ylabel("Lap Time (seconds)", fontweight="bold", labelpad=8)

    # Annotate race event context
    min_lap_time = driver_stint["lap_time_seconds"].min()
    fastest_lap_row = driver_stint.loc[driver_stint["lap_time_seconds"].idxmin()]
    ax.annotate(
        f"Fastest Stint Lap ({fastest_lap_row['lap_time_seconds']:.3f}s)\nLap {int(fastest_lap_row['lap'])}",
        xy=(fastest_lap_row["lap"], fastest_lap_row["lap_time_seconds"]),
        xytext=(fastest_lap_row["lap"] - 6, fastest_lap_row["lap_time_seconds"] + 0.6),
        arrowprops=dict(arrowstyle="->", color="#374151", lw=1.2),
        fontsize=9,
        fontweight="semibold",
        bbox=dict(boxstyle="round,pad=0.3", fc="#F3F4F6", ec="#D1D5DB", lw=1)
    )

    ax.grid(True, linestyle="--", alpha=0.5)
    ax.legend(loc="upper left", frameon=True, framealpha=0.95, facecolor="white")
    
    plt.tight_layout()

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=300)
    plt.close(fig)
    print(f"Stint visualization saved to: {output_path}")

"""
VROOM: Formula 1 Lap Time Predictor
Module: models.py

Implements classical ML regression models (Ridge Regression and Random Forest Regressor),
baseline vs tire-age enhanced feature sets, and RMSE / MAE evaluation.
"""

from pathlib import Path
from typing import Dict, Any, Tuple
import pandas as pd
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_squared_error, mean_absolute_error

RANDOM_STATE = 42

BASELINE_FEATURES = ["grid", "lap"]
ENHANCED_FEATURES = ["grid", "lap", "tire_age"]
TARGET_COL = "lap_time_seconds"


def build_ridge_model() -> Pipeline:
    """Build a Ridge Regression model wrapped in a StandardScaler pipeline."""
    return Pipeline([
        ("scaler", StandardScaler()),
        ("ridge", Ridge(alpha=1.0, random_state=RANDOM_STATE))
    ])


def build_rf_model() -> RandomForestRegressor:
    """Build a classical Random Forest Regressor with regularized tree depth."""
    return RandomForestRegressor(
        n_estimators=100,
        max_depth=6,
        min_samples_split=4,
        min_samples_leaf=2,
        random_state=RANDOM_STATE,
        n_jobs=-1
    )


def evaluate_predictions(y_true: np.ndarray, y_pred: np.ndarray) -> Tuple[float, float]:
    """Compute RMSE and MAE in seconds."""
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mae = mean_absolute_error(y_true, y_pred)
    return round(float(rmse), 4), round(float(mae), 4)


def train_and_evaluate_all(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    output_dir: Path
) -> Tuple[pd.DataFrame, Dict[str, Any], pd.DataFrame]:
    """
    Train and evaluate all four model configurations:
    1. Ridge Regression (Baseline: grid, lap)
    2. Ridge Regression (Enhanced: grid, lap, tire_age)
    3. Random Forest (Baseline: grid, lap)
    4. Random Forest (Enhanced: grid, lap, tire_age)
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    y_train = train_df[TARGET_COL].values
    y_test = test_df[TARGET_COL].values

    test_predictions = test_df[["driverId", "code", "driver_name", "lap", "grid", "stint", "tire_age", TARGET_COL]].copy()

    experiments = [
        ("Ridge Regression", "Baseline (grid, lap)", BASELINE_FEATURES, build_ridge_model()),
        ("Ridge Regression", "Enhanced (grid, lap, tire_age)", ENHANCED_FEATURES, build_ridge_model()),
        ("Random Forest", "Baseline (grid, lap)", BASELINE_FEATURES, build_rf_model()),
        ("Random Forest", "Enhanced (grid, lap, tire_age)", ENHANCED_FEATURES, build_rf_model()),
    ]

    metrics_records = []
    trained_models = {}

    print("\n=== MODEL TRAINING & EVALUATION ===")

    for model_name, feature_name, features, model in experiments:
        X_train = train_df[features].values
        X_test = test_df[features].values

        # Fit model
        model.fit(X_train, y_train)
        trained_models[f"{model_name}_{feature_name}"] = model

        # Predict
        train_pred = model.predict(X_train)
        test_pred = model.predict(X_test)

        # Store test predictions in dataframe
        col_pred = f"pred_{model_name.replace(' ', '_').lower()}_{'enhanced' if 'tire_age' in features else 'baseline'}"
        test_predictions[col_pred] = test_pred

        # Evaluate
        train_rmse, train_mae = evaluate_predictions(y_train, train_pred)
        test_rmse, test_mae = evaluate_predictions(y_test, test_pred)

        metrics_records.append({
            "Model": model_name,
            "Feature Set": feature_name,
            "Test RMSE (s)": test_rmse,
            "Test MAE (s)": test_mae,
            "Train RMSE (s)": train_rmse,
            "Train MAE (s)": train_mae,
        })

        print(f"\n{model_name} | {feature_name}:")
        print(f"  Test RMSE:  {test_rmse:.4f} s | Test MAE:  {test_mae:.4f} s")
        print(f"  Train RMSE: {train_rmse:.4f} s | Train MAE: {train_mae:.4f} s")

    metrics_df = pd.DataFrame(metrics_records)
    
    # Save metrics summary
    metrics_path = output_dir / "metrics_summary.csv"
    metrics_df.to_csv(metrics_path, index=False)
    print(f"\nMetrics summary saved to: {metrics_path}")

    return metrics_df, trained_models, test_predictions

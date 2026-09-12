/**
 * VROOM Lap Predictor Engine
 * Connects directly to the real trained model parameters and test predictions.
 * Computes exact Ridge regression predictions and queries Random Forest test stint records.
 */

class VroomPredictor {
  constructor() {
    this.data = window.VROOM_DATA;
    this.initElements();
    this.attachEvents();
    this.populateDrivers();
    this.runPrediction();
  }

  initElements() {
    this.driverSelect = document.getElementById("pred-driver");
    this.gridInput = document.getElementById("pred-grid");
    this.gridValBadge = document.getElementById("pred-grid-val");
    this.lapInput = document.getElementById("pred-lap");
    this.lapValBadge = document.getElementById("pred-lap-val");
    this.tireAgeInput = document.getElementById("pred-tire-age");
    this.tireAgeValBadge = document.getElementById("pred-tire-age-val");
    this.modelSelect = document.getElementById("pred-model");
    this.featureSetRadios = document.querySelectorAll("input[name='feature-set']");

    // Output elements
    this.timeDisplay = document.getElementById("pred-display-time");
    this.secondsSub = document.getElementById("pred-display-seconds");
    this.metaDriver = document.getElementById("pred-meta-driver");
    this.metaGridLap = document.getElementById("pred-meta-grid-lap");
    this.metaTireAge = document.getElementById("pred-meta-tire-age");
    this.metaModel = document.getElementById("pred-meta-model");
    this.actualCard = document.getElementById("pred-actual-card");
    this.actualTime = document.getElementById("pred-actual-time");
    this.deltaBadge = document.getElementById("pred-delta-badge");
    this.modelNotes = document.getElementById("pred-model-notes");
  }

  attachEvents() {
    if (this.driverSelect) {
      this.driverSelect.addEventListener("change", () => {
        const did = parseInt(this.driverSelect.value, 10);
        const driver = this.data.drivers.find((d) => d.driverId === did);
        if (driver) {
          this.gridInput.value = driver.grid;
          this.gridValBadge.textContent = `P${driver.grid}`;
          // Set sensible default lap to test stint start
          if (driver.pitLaps && driver.pitLaps.length > 0) {
            const firstTestLap = Math.max(...driver.pitLaps) + 2;
            this.lapInput.value = firstTestLap;
            this.lapValBadge.textContent = `L${firstTestLap}`;
            this.tireAgeInput.value = 0;
            this.tireAgeValBadge.textContent = `0 laps`;
          }
        }
        this.runPrediction();
      });
    }

    if (this.gridInput) {
      this.gridInput.addEventListener("input", () => {
        this.gridValBadge.textContent = `P${this.gridInput.value}`;
        this.runPrediction();
      });
    }

    if (this.lapInput) {
      this.lapInput.addEventListener("input", () => {
        this.lapValBadge.textContent = `L${this.lapInput.value}`;
        this.runPrediction();
      });
    }

    if (this.tireAgeInput) {
      this.tireAgeInput.addEventListener("input", () => {
        this.tireAgeValBadge.textContent = `${this.tireAgeInput.value} laps`;
        this.runPrediction();
      });
    }

    if (this.modelSelect) {
      this.modelSelect.addEventListener("change", () => this.runPrediction());
    }

    this.featureSetRadios.forEach((r) => {
      r.addEventListener("change", () => this.runPrediction());
    });
  }

  populateDrivers() {
    if (!this.driverSelect || !this.data || !this.data.drivers) return;
    this.driverSelect.innerHTML = "";
    this.data.drivers.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.driverId;
      opt.textContent = `${d.name} (${d.code}) — Grid P${d.grid} • ${d.status}`;
      this.driverSelect.appendChild(opt);
    });
    // Default to Verstappen (830)
    this.driverSelect.value = "830";
    this.gridInput.value = 2;
    this.gridValBadge.textContent = "P2";
    this.lapInput.value = 33;
    this.lapValBadge.textContent = "L33";
    this.tireAgeInput.value = 0;
    this.tireAgeValBadge.textContent = "0 laps";
  }

  getSelectedFeatureSet() {
    let selected = "enhanced";
    this.featureSetRadios.forEach((r) => {
      if (r.checked) selected = r.value;
    });
    return selected;
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds <= 0) return "--:--.---";
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3);
    const paddedSecs = (seconds % 60) < 10 ? `0${secs}` : secs;
    return `${mins}:${paddedSecs}`;
  }

  runPrediction() {
    const did = this.driverSelect.value;
    const grid = parseFloat(this.gridInput.value);
    const lap = parseFloat(this.lapInput.value);
    const tireAge = parseFloat(this.tireAgeInput.value);
    const modelChoice = this.modelSelect.value; // 'rf' or 'ridge'
    const featureSet = this.getSelectedFeatureSet(); // 'baseline' or 'enhanced'

    const driverObj = this.data.drivers.find((d) => d.driverId === parseInt(did, 10));
    const driverName = driverObj ? `${driverObj.name} (${driverObj.code})` : "Driver";

    let predictedSeconds = null;
    let actualSeconds = null;
    let noteText = "";

    // Check if this exact lap exists in the test stint predictions dataset
    const driverTestLaps = this.data.test_predictions_by_driver[did] || [];
    const testRecord = driverTestLaps.find((r) => r.lap === Math.round(lap));

    if (modelChoice === "rf") {
      if (testRecord) {
        // We have the exact Random Forest prediction evaluated by the model
        predictedSeconds = featureSet === "enhanced" ? testRecord.rf_enhanced : testRecord.rf_baseline;
        actualSeconds = testRecord.actual;
        noteText = "Local Inference: Recorded test-stint Random Forest evaluation record.";
      } else {
        // Outside test stint: compute with exact fitted Ridge model and explain
        const ridgeKey = featureSet === "enhanced" ? "ridge_enhanced" : "ridge_baseline";
        predictedSeconds = this.computeRidgePrediction(ridgeKey, grid, lap, tireAge);
        noteText = "Local Inference: Evaluated via fitted Ridge model weights (tree ensemble evaluation outside test stint requires Python server).";
      }
    } else {
      // Ridge Regression: exact analytical calculation
      const ridgeKey = featureSet === "enhanced" ? "ridge_enhanced" : "ridge_baseline";
      predictedSeconds = this.computeRidgePrediction(ridgeKey, grid, lap, tireAge);
      if (testRecord) {
        actualSeconds = testRecord.actual;
      }
      noteText = `Local Inference: Analytical Ridge Regression (${featureSet === "enhanced" ? "3-feature" : "2-feature"}) calculation from exported model weights.`;
    }

    // Render Display
    this.timeDisplay.textContent = this.formatTime(predictedSeconds);
    this.secondsSub.textContent = `Elapsed Flying Time: ${predictedSeconds.toFixed(3)}s`;

    // Render Metadata
    this.metaDriver.textContent = driverName;
    this.metaGridLap.textContent = `Grid P${grid} • Race Lap ${lap}`;
    this.metaTireAge.textContent = featureSet === "enhanced" ? `${tireAge} Laps Old` : "Excluded (Baseline)";
    this.metaModel.textContent = `${modelChoice === "rf" ? "Random Forest Regressor" : "Ridge Regression"} (${featureSet.toUpperCase()})`;
    this.modelNotes.textContent = noteText;

    // Actual Time Delta
    if (actualSeconds !== null && actualSeconds > 0) {
      this.actualCard.style.display = "block";
      this.actualTime.textContent = this.formatTime(actualSeconds);
      const delta = predictedSeconds - actualSeconds;
      const absDelta = Math.abs(delta);
      const sign = delta > 0 ? "+" : "-";
      this.deltaBadge.textContent = `Δ ${sign}${absDelta.toFixed(3)}s (${delta > 0 ? "Under-predicted pace" : "Over-predicted pace"})`;
      this.deltaBadge.className = absDelta <= 0.5 ? "delta-badge delta-good" : "delta-badge delta-moderate";
    } else {
      this.actualCard.style.display = "none";
    }
  }

  computeRidgePrediction(modelKey, grid, lap, tireAge) {
    const params = this.data.models_parameters[modelKey];
    if (!params) return 70.0;

    let scaledValues = [];
    if (params.features.length === 2) {
      // grid, lap
      scaledValues.push((grid - params.scaler_mean[0]) / params.scaler_scale[0]);
      scaledValues.push((lap - params.scaler_mean[1]) / params.scaler_scale[1]);
    } else {
      // grid, lap, tire_age
      scaledValues.push((grid - params.scaler_mean[0]) / params.scaler_scale[0]);
      scaledValues.push((lap - params.scaler_mean[1]) / params.scaler_scale[1]);
      scaledValues.push((tireAge - params.scaler_mean[2]) / params.scaler_scale[2]);
    }

    let y = params.intercept;
    for (let i = 0; i < scaledValues.length; i++) {
      y += params.coef[i] * scaledValues[i];
    }
    return y;
  }
}

window.vroomPredictor = new VroomPredictor();

/**
 * VROOM Application Main Entry Point
 * Renders data tables, metrics, cleaning waterfall, and attaches global listeners.
 */

document.addEventListener("DOMContentLoaded", () => {
  const data = window.VROOM_DATA;
  if (!data) {
    console.error("[VROOM] Telemetry data not found.");
    return;
  }

  // 1. Render Race Lab Metrics Table
  renderMetricsTable(data.metrics);

  // 2. Render Cleaning Waterfall
  renderCleaningWaterfall(data.cleaning, data.counts);

  // 3. Render Driver Cohort Table
  renderDriverCohortTable(data.drivers);

  // 4. Attach Home CTAs
  document.querySelectorAll("[data-action='start-predicting']").forEach((btn) => {
    btn.addEventListener("click", () => window.vroomRouter.navigate("predictor"));
  });

  document.querySelectorAll("[data-action='explore-race']").forEach((btn) => {
    btn.addEventListener("click", () => window.vroomRouter.navigate("racelab"));
  });

  // 5. Attach FAQ Accordion Toggles
  document.querySelectorAll(".faq-question").forEach((q) => {
    q.addEventListener("click", () => {
      const parent = q.parentElement;
      parent.classList.toggle("open");
    });
  });

  // 6. Initialize Apple Liquid Glass Material Engine
  if (window.vroomLiquidGlass) {
    window.vroomLiquidGlass.init();
  }

  console.log("[VROOM] Motorsport Telemetry UI successfully loaded.");
});

function renderMetricsTable(metrics) {
  const tbody = document.getElementById("metrics-table-body");
  if (!tbody || !metrics) return;

  tbody.innerHTML = "";
  metrics.forEach((m) => {
    const tr = document.createElement("tr");
    const isEnhanced = m["Feature Set"].includes("tire_age");
    const badgeHtml = isEnhanced
      ? `<span class="badge-enhanced">ENHANCED (GRID, LAP, TIRE_AGE)</span>`
      : `<span class="badge-baseline">BASELINE (GRID, LAP)</span>`;

    tr.innerHTML = `
      <td><strong>${m["Model"]}</strong></td>
      <td>${badgeHtml}</td>
      <td class="metric-highlight">${m["Test RMSE (s)"].toFixed(4)} s</td>
      <td class="metric-highlight">${m["Test MAE (s)"].toFixed(4)} s</td>
      <td>${m["Train RMSE (s)"].toFixed(4)} s</td>
      <td>${m["Train MAE (s)"].toFixed(4)} s</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCleaningWaterfall(cleaning, counts) {
  const container = document.getElementById("cleaning-waterfall-container");
  if (!container || !cleaning) return;

  container.innerHTML = `
    <div class="waterfall-step">
      <div class="waterfall-step-num">STAGE 01</div>
      <div class="waterfall-step-val">${cleaning.raw_rows}</div>
      <div class="waterfall-step-label">Raw Cohort Records (10 Drivers)</div>
    </div>
    <div class="waterfall-step drop">
      <div class="waterfall-step-num">RULE 1</div>
      <div class="waterfall-step-val">-${cleaning.removed_pit_in_laps}</div>
      <div class="waterfall-step-label">Pit-Stop In-Laps Excluded</div>
    </div>
    <div class="waterfall-step drop">
      <div class="waterfall-step-num">RULE 2</div>
      <div class="waterfall-step-val">-${cleaning.removed_pit_out_laps}</div>
      <div class="waterfall-step-label">Pit Out-Laps (P+1) Excluded</div>
    </div>
    <div class="waterfall-step">
      <div class="waterfall-step-num">RULE 3</div>
      <div class="waterfall-step-val">-${cleaning.removed_slow_laps}</div>
      <div class="waterfall-step-label">&gt; 1.5× Driver Flying Median</div>
    </div>
    <div class="waterfall-step highlight">
      <div class="waterfall-step-num">FINAL COHORT</div>
      <div class="waterfall-step-val">${cleaning.final_clean_rows}</div>
      <div class="waterfall-step-label">Clean Flying Laps Retained</div>
    </div>
  `;
}

function renderDriverCohortTable(drivers) {
  const tbody = document.getElementById("drivers-table-body");
  if (!tbody || !drivers) return;

  tbody.innerHTML = "";
  drivers.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${d.name}</strong> (${d.code})</td>
      <td><span class="telemetry-badge badge-sky">P${d.grid}</span></td>
      <td><span class="telemetry-badge ${d.status === "Finished" ? "badge-green" : "badge-amber"}">${d.status}</span></td>
      <td>${d.completedLaps} Laps</td>
      <td>${d.pitStopsCount} (${d.pitLaps.map(l => 'L' + l).join(', ')})</td>
      <td>${d.trainLaps} Laps</td>
      <td>${d.cleanTotalLaps - d.trainLaps} Laps</td>
      <td><strong>${d.cleanTotalLaps}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

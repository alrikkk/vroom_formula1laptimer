/**
 * VROOM Telemetry Chart: Max Verstappen Final Stint Replay
 * Renders an interactive SVG chart plotting Actual Lap Times vs Baseline and Enhanced Models.
 */

class VroomStintChart {
  constructor() {
    this.data = window.VROOM_DATA ? window.VROOM_DATA.verstappen_stint : [];
    this.container = document.getElementById("stint-chart-container");
    this.tooltip = document.getElementById("stint-chart-tooltip");
    this.visibleSeries = {
      actual: true,
      rf_enhanced: true,
      rf_baseline: true,
      ridge_enhanced: true,
    };

    if (this.container && this.data.length > 0) {
      this.initChart();
      this.attachToggles();
      window.addEventListener("resize", () => this.render());
      window.addEventListener("vroom:viewchange", (e) => {
        if (e.detail.route === "racelab") {
          setTimeout(() => this.render(), 100);
        }
      });
    }
  }

  attachToggles() {
    document.querySelectorAll(".toggle-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const seriesKey = chip.getAttribute("data-series");
        this.visibleSeries[seriesKey] = !this.visibleSeries[seriesKey];
        chip.style.opacity = this.visibleSeries[seriesKey] ? "1" : "0.35";
        this.render();
      });
    });
  }

  initChart() {
    this.render();
  }

  render() {
    if (!this.container || this.data.length === 0) return;

    const width = this.container.clientWidth || 800;
    const height = 360;
    const padding = { top: 30, right: 30, bottom: 50, left: 60 };

    const laps = this.data.map((d) => d.lap);
    const minLap = Math.min(...laps);
    const maxLap = Math.max(...laps);

    // Calculate y bounds (lap time seconds)
    const allTimes = [];
    this.data.forEach((d) => {
      if (this.visibleSeries.actual) allTimes.push(d.actual);
      if (this.visibleSeries.rf_enhanced) allTimes.push(d.rf_enhanced);
      if (this.visibleSeries.rf_baseline) allTimes.push(d.rf_baseline);
      if (this.visibleSeries.ridge_enhanced) allTimes.push(d.ridge_enhanced);
    });

    const minY = Math.floor(Math.min(...allTimes) * 2) / 2 - 0.5;
    const maxY = Math.ceil(Math.max(...allTimes) * 2) / 2 + 0.5;

    const scaleX = (lap) => padding.left + ((lap - minLap) / (maxLap - minLap)) * (width - padding.left - padding.right);
    const scaleY = (time) => height - padding.bottom - ((time - minY) / (maxY - minY)) * (height - padding.top - padding.bottom);

    // Build SVG
    let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">`;

    // Horizontal Grid Lines & Y-axis labels
    const yStep = 0.5;
    for (let y = minY; y <= maxY; y += yStep) {
      const yPos = scaleY(y);
      svg += `
        <line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3" />
        <text x="${padding.left - 10}" y="${yPos + 4}" font-family="'SF Mono', monospace" font-size="10" fill="#64748b" text-anchor="end">${y.toFixed(1)}s</text>
      `;
    }

    // X-axis Grid Lines & labels
    for (let l = minLap; l <= maxLap; l += 5) {
      const xPos = scaleX(l);
      svg += `
        <line x1="${xPos}" y1="${padding.top}" x2="${xPos}" y2="${height - padding.bottom}" stroke="#f1f5f9" stroke-width="1" />
        <text x="${xPos}" y="${height - padding.bottom + 18}" font-family="'SF Mono', monospace" font-size="10" fill="#64748b" text-anchor="middle">L${l}</text>
      `;
    }

    // X-axis & Y-axis Titles
    svg += `
      <text x="${width / 2}" y="${height - 10}" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" fill="#475569" text-anchor="middle">Race Lap Number (Stint 2: Laps 33 to 71)</text>
      <text transform="rotate(-90)" x="${-(height / 2)}" y="18" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" fill="#475569" text-anchor="middle">Lap Time (Seconds)</text>
    `;

    // Path Builder
    const makePath = (key) => {
      let d = "";
      this.data.forEach((pt, i) => {
        const x = scaleX(pt.lap);
        const y = scaleY(pt[key]);
        d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
      });
      return d;
    };

    // Series 1: Ridge Enhanced (dotted blue)
    if (this.visibleSeries.ridge_enhanced) {
      svg += `<path d="${makePath("ridge_enhanced")}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4,4" opacity="0.85" />`;
    }

    // Series 2: RF Baseline (dashed red)
    if (this.visibleSeries.rf_baseline) {
      svg += `<path d="${makePath("rf_baseline")}" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,4" opacity="0.85" />`;
    }

    // Series 3: RF Enhanced (solid green)
    if (this.visibleSeries.rf_enhanced) {
      svg += `<path d="${makePath("rf_enhanced")}" fill="none" stroke="#10b981" stroke-width="2.5" opacity="0.95" />`;
    }

    // Series 4: Actual Lap Time (solid dark slate with circles)
    if (this.visibleSeries.actual) {
      svg += `<path d="${makePath("actual")}" fill="none" stroke="#0f172a" stroke-width="2.2" />`;
      this.data.forEach((pt) => {
        const x = scaleX(pt.lap);
        const y = scaleY(pt.actual);
        svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="#0f172a" stroke="#ffffff" stroke-width="1.5" />`;
      });
    }

    // Interactive Hover Points (transparent hit areas)
    this.data.forEach((pt) => {
      const x = scaleX(pt.lap);
      const y = scaleY(pt.actual);
      svg += `
        <circle class="chart-hit-point" cx="${x}" cy="${y}" r="12" fill="transparent" 
                data-lap="${pt.lap}" 
                data-tire="${pt.tire_age}" 
                data-actual="${pt.actual}" 
                data-rf="${pt.rf_enhanced}" 
                data-err="${pt.rf_enhanced_error}"
                style="cursor: pointer;" />
      `;
    });

    svg += `</svg>`;
    this.container.innerHTML = svg;
    this.attachHoverEvents();
  }

  attachHoverEvents() {
    const hitPoints = this.container.querySelectorAll(".chart-hit-point");
    hitPoints.forEach((hp) => {
      hp.addEventListener("mouseenter", (e) => {
        const lap = hp.getAttribute("data-lap");
        const tire = hp.getAttribute("data-tire");
        const actual = hp.getAttribute("data-actual");
        const rf = hp.getAttribute("data-rf");
        const err = hp.getAttribute("data-err");

        const rect = hp.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();

        const xPos = rect.left - containerRect.left + rect.width / 2;
        const yPos = rect.top - containerRect.top;

        this.tooltip.innerHTML = `
          <div style="font-weight:700; color:#38bdf8; margin-bottom:2px;">LAP ${lap} (Tire Age: ${tire} Laps)</div>
          <div>Actual: <strong>${actual}s</strong></div>
          <div>RF Enhanced: <strong>${rf}s</strong></div>
          <div style="color:#cbd5e1; font-size:0.7rem; margin-top:2px;">Abs Error: Δ ${err}s</div>
        `;

        this.tooltip.style.left = `${xPos}px`;
        this.tooltip.style.top = `${yPos - 10}px`;
        this.tooltip.classList.add("visible");
      });

      hp.addEventListener("mouseleave", () => {
        this.tooltip.classList.remove("visible");
      });
    });
  }
}

window.vroomStintChart = new VroomStintChart();

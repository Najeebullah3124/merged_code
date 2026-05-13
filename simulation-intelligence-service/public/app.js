function isoLocal(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

function toIsoZ(str) {
  if (!str) return "";
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function initDefaults() {
  const now = new Date();
  const end = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  document.getElementById("t0").value = isoLocal(now);
  document.getElementById("t1").value = isoLocal(end);
}

let chartTime;
let chartPrice;

function ensureCharts() {
  if (typeof Chart === "undefined") return;
  const ctx1 = document.getElementById("chartTime");
  const ctx2 = document.getElementById("chartPrice");
  if (chartTime) chartTime.destroy();
  if (chartPrice) chartPrice.destroy();
  chartTime = new Chart(ctx1, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: "#cbd5e1" } } },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 12 } },
        y: { ticks: { color: "#94a3b8" }, min: 0, max: 1 },
        y1: {
          position: "right",
          ticks: { color: "#94a3b8" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
  chartPrice = new Chart(ctx2, {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel(ctx) {
              const row = ctx.chart.$curveRow?.[ctx.dataIndex];
              if (!row) return "";
              return `conversion μ: ${row.conversion_mean}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#94a3b8" } },
        y: { ticks: { color: "#94a3b8" } },
      },
    },
  });
}

async function runSim() {
  const err = document.getElementById("err");
  err.hidden = true;
  const listing_id = document.getElementById("listingId").value.trim();
  const vertical = document.getElementById("vertical").value;
  const t0 = toIsoZ(document.getElementById("t0").value);
  const t1 = toIsoZ(document.getElementById("t1").value);
  const prices = document
    .getElementById("prices")
    .value.split(/[, ]+/)
    .map((x) => parseFloat(x))
    .filter((x) => !Number.isNaN(x));
  const demand_shift_pct = parseFloat(document.getElementById("dShift").value) || 0;
  const risk_shift_pct = parseFloat(document.getElementById("rShift").value) || 0;

  const body = {
    listing_id,
    time_range: [t0, t1],
    price_scenarios: prices,
    vertical,
    demand_shift_pct,
    risk_shift_pct,
    use_upstream_listing: false,
    use_upstream_commission: false,
  };

  const res = await fetch("/v1/simulation/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    err.textContent = t || res.statusText;
    err.hidden = false;
    return;
  }
  const data = await res.json();
  render(data);
}

function render(data) {
  ensureCharts();
  const labels = data.timeline.map((r) => r.time.slice(5, 16).replace("T", " "));
  chartTime.data.labels = labels;
  chartTime.data.datasets = [
    {
      label: "Demand",
      data: data.timeline.map((r) => r.demand),
      borderColor: "#38bdf8",
      tension: 0.2,
      pointRadius: 0,
    },
    {
      label: "Risk (shaded = zones)",
      data: data.timeline.map((r) => r.risk),
      borderColor: "rgba(248,113,113,0.95)",
      backgroundColor: "rgba(248,113,113,0.18)",
      fill: true,
      tension: 0.2,
      pointRadius: 0,
    },
    {
      label: "Sync factor",
      data: data.timeline.map((r) => r.sync_factor),
      borderColor: "#94a3b8",
      borderDash: [4, 4],
      tension: 0.15,
      pointRadius: 0,
    },
    {
      label: "Availability (effective)",
      data: data.timeline.map((r) => r.availability_effective),
      borderColor: "#fbbf24",
      tension: 0.2,
      pointRadius: 0,
    },
    {
      label: "Expected bookings",
      data: data.timeline.map((r) => r.expected_bookings),
      borderColor: "#f472b6",
      tension: 0.15,
      pointRadius: 0,
      yAxisID: "y1",
    },
    {
      label: "Price (chosen)",
      data: data.timeline.map((r) => r.price),
      borderColor: "#a78bfa",
      tension: 0.15,
      pointRadius: 0,
      yAxisID: "y1",
    },
    {
      label: "Host net / slot",
      data: data.timeline.map((r) => r.revenue_host_net ?? r.revenue),
      borderColor: "#34d399",
      tension: 0.15,
      pointRadius: 0,
      yAxisID: "y1",
    },
    {
      label: "Platform take",
      data: data.timeline.map((r) => r.platform_take),
      borderColor: "#fb923c",
      tension: 0.15,
      pointRadius: 0,
      yAxisID: "y1",
    },
  ];
  chartTime.update();

  chartPrice.$curveRow = data.price_curve;
  chartPrice.data.labels = data.price_curve.map((p) => String(p.price));
  const meta = data.price_curve_meta || {};
  chartPrice.data.datasets = [
    {
      label: "Window host net revenue",
      data: data.price_curve.map((p) => p.revenue),
      backgroundColor: data.price_curve.map((p) => {
        if (p.price === meta.optimal_price) return "#6366f1";
        if (meta.current_price != null && p.price === meta.current_price) return "#22d3ee";
        if (meta.model_suggested_price != null && p.price === meta.model_suggested_price) return "#a3e635";
        return "#334155";
      }),
    },
  ];
  chartPrice.update();

  const rec = data.recommendation;
  const box = document.getElementById("recBox");
  const fb = data.feedback_loop || {};
  const zones = (data.risk_summary && data.risk_summary.zones) || {};
  document.getElementById("recText").innerHTML =
    `<strong>${rec.action}</strong> (${Math.round(rec.confidence * 100)}% confidence)<br/>` +
    `${rec.reason}<br/><br/>` +
    `Optimal: <strong>${meta.optimal_price ?? "—"}</strong> · Current: <strong>${meta.current_price ?? "—"}</strong> · ` +
    `Model suggested: <strong>${meta.model_suggested_price ?? "—"}</strong><br/>` +
    `Host suggested: <strong>${meta.host_suggested_price ?? "—"}</strong><br/><br/>` +
    `Risk zones (timesteps): LOCK ${zones.LOCK ?? 0}, UNSTABLE ${zones.UNSTABLE ?? 0}, SAFE ${zones.SAFE ?? 0}<br/><br/>` +
    `Feedback loop: ${fb.status || "—"} · drift ${fb.error ?? "—"} · retrain: ${fb.model_update_recommended ?? "—"}<br/><br/>` +
    `Window total host net: <strong>${rec.expected_window_revenue}</strong>`;
  box.hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  initDefaults();
  ensureCharts();
  document.getElementById("runBtn").addEventListener("click", runSim);
});

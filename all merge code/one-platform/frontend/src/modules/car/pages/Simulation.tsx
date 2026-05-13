import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { DualLineChartCard, LineChartCard } from "../components/Chart";
import { formatCurrency, formatPercent } from "../utils/format";

type SimulationResponse = {
  confidence_score?: number;
  recommended_price?: number;
  best?: { price_gbp?: number; booking_probability?: number; expected_revenue?: number };
  explanation_tags?: string[];
  curve?: Array<{ price_gbp: number; booking_probability: number; expected_revenue: number }>;
};

export function SimulationPage() {
  const { apiFetch, token } = useAuth();
  const [city, setCity] = useState("London");
  const [country, setCountry] = useState("GB");
  const [group, setGroup] = useState("Economy");
  const [startDate, setStartDate] = useState("2026-07-01");
  const [returnDate, setReturnDate] = useState("2026-07-31");
  const [minPrice, setMinPrice] = useState(70);
  const [maxPrice, setMaxPrice] = useState(220);
  const [step, setStep] = useState(5);
  const [windowPct, setWindowPct] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sim, setSim] = useState<SimulationResponse | null>(null);

  const revenueCurve = useMemo(
    () =>
      (sim?.curve ?? []).map((x) => ({
        price: x.price_gbp,
        revenue: x.expected_revenue,
      })),
    [sim],
  );

  const elasticityCurve = useMemo(
    () =>
      (sim?.curve ?? []).map((x) => ({
        price: x.price_gbp,
        occupancy: x.booking_probability * 100,
      })),
    [sim],
  );

  const planRows = useMemo(() => {
    if (!sim?.curve?.length) return [];
    const sorted = [...sim.curve].sort((a, b) => a.price_gbp - b.price_gbp);
    const basic = sorted[Math.floor(sorted.length * 0.2)] ?? sorted[0];
    const smart = sorted.reduce((best, cur) =>
      cur.expected_revenue > best.expected_revenue ? cur : best,
    );
    const aggressive = sorted[Math.floor(sorted.length * 0.8)] ?? sorted[sorted.length - 1];
    return [
      { name: "Basic", price: basic.price_gbp, revenue: basic.expected_revenue, occupancy: basic.booking_probability },
      { name: "Smart pricing", price: smart.price_gbp, revenue: smart.expected_revenue, occupancy: smart.booking_probability },
      { name: "Aggressive", price: aggressive.price_gbp, revenue: aggressive.expected_revenue, occupancy: aggressive.booking_probability },
    ];
  }, [sim]);

  const risk = useMemo(() => {
    if (!sim?.curve?.length) return null;
    const vals = sim.curve.map((x) => x.expected_revenue).sort((a, b) => a - b);
    const q = (pct: number) => vals[Math.max(0, Math.min(vals.length - 1, Math.floor((vals.length - 1) * pct)))];
    return {
      worst: q(0.1),
      expected: q(0.5),
      best: q(0.9),
    };
  }, [sim]);

  function validateForm(): string | null {
    if (!city.trim()) return "City is required.";
    if (!country.trim()) return "Country is required.";
    if (!group.trim()) return "Group is required.";
    if (!startDate || !returnDate) return "Start and return dates are required.";
    if (returnDate < startDate) return "Return date must be on or after start date.";
    if (!Number.isFinite(step) || step <= 0) return "Price step must be greater than 0.";
    if (!Number.isFinite(minPrice) || minPrice <= 0) return "Min price must be greater than 0.";
    if (!Number.isFinite(maxPrice) || maxPrice <= 0) return "Max price must be greater than 0.";
    if (maxPrice < minPrice) return "Max price must be greater than or equal to min price.";
    if (!Number.isFinite(windowPct) || windowPct < 0 || windowPct > 5) return "Window % must be between 0 and 5.";
    return null;
  }

  async function run() {
    if (!token) return;
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city,
          country,
          group,
          start_date: startDate,
          return_date: returnDate,
          mileage: "50 miles per rental",
          min_price_gbp: minPrice,
          max_price_gbp: maxPrice,
          step_gbp: step,
          window_pct: windowPct,
        }),
      });
      if (!r.ok) {
        setError(`Simulation failed (${r.status})`);
        return;
      }
      setSim((await r.json()) as SimulationResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Advanced simulation & revenue forecasting</h1>
        <button
          onClick={() => void run()}
          disabled={loading || !token}
          className="rounded-md bg-sky-600 px-3 py-2 text-sm text-white disabled:opacity-60"
        >
          {loading ? "Simulating�" : "Simulate"}
        </button>
      </div>

      {!token && <p className="text-sm text-amber-700">Sign in to run host simulation.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm">
          City
          <input className="mt-1 w-full rounded border px-2 py-1" value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label className="text-sm">
          Country
          <input className="mt-1 w-full rounded border px-2 py-1" value={country} onChange={(e) => setCountry(e.target.value)} />
        </label>
        <label className="text-sm">
          Group
          <input className="mt-1 w-full rounded border px-2 py-1" value={group} onChange={(e) => setGroup(e.target.value)} />
        </label>
        <label className="text-sm">
          Price step (GBP)
          <input type="number" className="mt-1 w-full rounded border px-2 py-1" value={step} onChange={(e) => setStep(Number(e.target.value))} />
        </label>
        <label className="text-sm">
          Start date
          <input type="date" className="mt-1 w-full rounded border px-2 py-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="text-sm">
          Return date
          <input type="date" className="mt-1 w-full rounded border px-2 py-1" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
        </label>
        <label className="text-sm">
          Min price (GBP)
          <input type="number" className="mt-1 w-full rounded border px-2 py-1" value={minPrice} onChange={(e) => setMinPrice(Number(e.target.value))} />
        </label>
        <label className="text-sm">
          Max price (GBP)
          <input type="number" className="mt-1 w-full rounded border px-2 py-1" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} />
        </label>
        <label className="text-sm">
          Window %
          <input type="number" step="0.1" className="mt-1 w-full rounded border px-2 py-1" value={windowPct} onChange={(e) => setWindowPct(Number(e.target.value))} />
        </label>
      </div>

      {sim && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Kpi title="Projected Revenue" value={formatCurrency(Number(sim.best?.expected_revenue ?? 0))} />
            <Kpi title="Estimated Occupancy" value={formatPercent(Number(sim.best?.booking_probability ?? 0))} />
            <Kpi title="Recommended ADR" value={formatCurrency(Number(sim.recommended_price ?? 0))} />
            <Kpi title="Confidence" value={`${Math.round(Number(sim.confidence_score ?? 0) * 100)}%`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <LineChartCard title="Revenue forecast curve" data={revenueCurve} xKey="price" yKey="revenue" />
            <DualLineChartCard
              title="Price elasticity (occupancy vs price)"
              data={elasticityCurve}
              xKey="price"
              lines={[{ key: "occupancy", label: "Occupancy %", color: "#22c55e" }]}
            />
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-lg font-semibold">Plan comparison</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {planRows.map((p) => (
                <div key={p.name} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                  <div className="mt-1 text-sm text-slate-600">Price: {formatCurrency(p.price)}</div>
                  <div className="text-sm text-slate-600">Revenue: {formatCurrency(p.revenue)}</div>
                  <div className="text-sm text-slate-600">Occupancy: {formatPercent(p.occupancy)}</div>
                </div>
              ))}
            </div>
          </section>

          {risk && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-lg font-semibold">Risk & sensitivity</h2>
              <div className="grid gap-3 md:grid-cols-3">
                <Kpi title="Worst case" value={formatCurrency(risk.worst)} />
                <Kpi title="Expected case" value={formatCurrency(risk.expected)} />
                <Kpi title="Best case" value={formatCurrency(risk.best)} />
              </div>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-lg font-semibold">AI recommendations</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>Apply suggested price ({formatCurrency(Number(sim.recommended_price ?? 0))}) for high-demand dates.</li>
              <li>Use weekly discount only when occupancy falls below target to protect ADR.</li>
              {Array.isArray(sim.explanation_tags)
                ? sim.explanation_tags.slice(0, 4).map((t) => <li key={t}>Signal: {t}</li>)
                : null}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}



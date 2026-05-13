import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";

export function PricingControlPage() {
  const { apiFetch, token } = useAuth();
  const [minP, setMinP] = useState(5);
  const [maxP, setMaxP] = useState(8000);
  const [kill, setKill] = useState(false);
  const [region, setRegion] = useState("gb");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      const r = await apiFetch("/api/admin/config");
      if (r.ok) {
        const j = await r.json();
        setKill(Boolean(j.kill_switch));
      }
    })();
  }, [apiFetch, token]);

  function validatePricingForm(requireRegion: boolean): string | null {
    if (!Number.isFinite(minP) || minP <= 0) return "Min price must be greater than 0.";
    if (!Number.isFinite(maxP) || maxP <= 0) return "Max price must be greater than 0.";
    if (maxP < minP) return "Max price must be greater than or equal to min price.";
    if (requireRegion && !region.trim()) return "Region is required.";
    return null;
  }

  async function saveCaps() {
    const validationError = validatePricingForm(false);
    if (validationError) {
      setMsg(validationError);
      return;
    }
    const r = await apiFetch("/api/admin/global-caps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        min_price_gbp: minP,
        max_price_gbp: maxP,
        max_pct_change: 0.2,
        smoothing_alpha: 0.8,
      }),
    });
    setMsg(r.ok ? "Saved global caps" : "Failed — is the car API reachable?");
  }

  async function saveKill() {
    const r = await apiFetch("/api/admin/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: kill }),
    });
    setMsg(r.ok ? "Kill switch updated" : "Failed");
  }

  async function saveRegion() {
    const validationError = validatePricingForm(true);
    if (validationError) {
      setMsg(validationError);
      return;
    }
    const r = await apiFetch("/api/admin/region-override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region,
        min_price_gbp: minP,
        max_price_gbp: maxP,
        max_pct_change: 0.2,
        smoothing_alpha: 0.8,
        multiplier: 1.0,
      }),
    });
    setMsg(r.ok ? "Region override saved" : "Failed");
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Pricing control</h1>
      <div className="max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm text-slate-700">
          Min price (GBP): {minP}
          <input type="range" min={5} max={500} value={minP} onChange={(e) => setMinP(Number(e.target.value))} className="w-full" />
        </label>
        <label className="block text-sm text-slate-700">
          Max price (GBP): {maxP}
          <input type="range" min={50} max={12000} value={maxP} onChange={(e) => setMaxP(Number(e.target.value))} className="w-full" />
        </label>
        <button onClick={saveCaps} className="rounded-md bg-sky-600 px-3 py-2 text-sm">
          Save global caps
        </button>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={kill} onChange={(e) => setKill(e.target.checked)} />
            Kill switch
          </label>
          <button onClick={saveKill} className="rounded-md bg-amber-600 px-3 py-2 text-sm">
            Apply
          </button>
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="region code"
          />
          <button onClick={saveRegion} className="rounded-md bg-slate-200 text-slate-900 px-3 py-2 text-sm">
            Regional override
          </button>
        </div>
        {msg && <p className="text-sm text-slate-700">{msg}</p>}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function ListingSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const { apiFetch, token } = useAuth();
  const [minP, setMinP] = useState(5);
  const [maxP, setMaxP] = useState(500);
  const [enabled, setEnabled] = useState(true);
  const [weekly, setWeekly] = useState(10);
  const [monthly, setMonthly] = useState(20);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const r = await fetch(`/api/listing/${encodeURIComponent(id)}/settings`);
      if (!r.ok) return;
      const j = (await r.json()) as Record<string, unknown>;
      setMinP(Number(j.minPrice ?? 5));
      setMaxP(Number(j.maxPrice ?? 500));
      setEnabled(Boolean(j.smartPricingEnabled ?? true));
      const disc = j.discounts as Record<string, unknown> | undefined;
      setWeekly(Number(disc?.weekly ?? 10));
      setMonthly(Number(disc?.monthly ?? 20));
    })();
  }, [id]);

  function validateForm(): string | null {
    if (!Number.isFinite(minP) || minP <= 0) return "Min price must be greater than 0.";
    if (!Number.isFinite(maxP) || maxP <= 0) return "Max price must be greater than 0.";
    if (maxP < minP) return "Max price must be greater than or equal to min price.";
    if (!Number.isFinite(weekly) || weekly < 0 || weekly > 100) return "Weekly discount must be between 0 and 100.";
    if (!Number.isFinite(monthly) || monthly < 0 || monthly > 100) return "Monthly discount must be between 0 and 100.";
    return null;
  }

  async function save() {
    if (!token || !id) return;
    const validationError = validateForm();
    if (validationError) {
      setMsg(validationError);
      return;
    }
    const r = await apiFetch(`/api/listing/${encodeURIComponent(id)}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        minPrice: minP,
        maxPrice: maxP,
        smartPricingEnabled: enabled,
        discounts: { weekly, monthly },
      }),
    });
    setMsg(r.ok ? "Settings saved" : "Save failed");
  }

  return (
    <section className="space-y-6 p-6">
      <div className="flex flex-wrap gap-3">
        <Link to={`/car/listing/${encodeURIComponent(String(id))}/calendar`} className="text-sm text-blue-700 hover:underline">
          ← Calendar
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-slate-900">Listing settings</h1>
      {!token && <p className="text-sm text-amber-800">Sign in to save settings.</p>}
      {msg && <p className="text-sm">{msg}</p>}

      <div className="max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Smart pricing enabled
        </label>
        <label className="block text-sm">
          Min price
          <input type="number" className="mt-1 w-full rounded border px-2 py-1" value={minP} onChange={(e) => setMinP(Number(e.target.value))} />
        </label>
        <label className="block text-sm">
          Max price
          <input type="number" className="mt-1 w-full rounded border px-2 py-1" value={maxP} onChange={(e) => setMaxP(Number(e.target.value))} />
        </label>
        <label className="block text-sm">
          Weekly discount %
          <input type="number" className="mt-1 w-full rounded border px-2 py-1" value={weekly} onChange={(e) => setWeekly(Number(e.target.value))} />
        </label>
        <label className="block text-sm">
          Monthly discount %
          <input type="number" className="mt-1 w-full rounded border px-2 py-1" value={monthly} onChange={(e) => setMonthly(Number(e.target.value))} />
        </label>
        <button type="button" className="rounded-md bg-sky-600 px-3 py-2 text-sm text-white" onClick={() => void save()}>
          Save
        </button>
      </div>
    </section>
  );
}

from dataclasses import dataclass
from typing import Iterable, List


@dataclass
class SimulationResult:
    markup: float
    price: float
    conversion_probability: float
    expected_revenue: float


class SimpleConversionModel:
    """
    Tiny placeholder conversion model:
    - lower price improves conversion
    - higher demand improves conversion
    """

    def predict(self, base_price: float, price: float, demand_score: float) -> float:
        price_penalty = max(0.0, (price - base_price) / max(base_price, 1))
        conversion = 0.75 + (0.2 * demand_score) - (0.5 * price_penalty)
        return max(0.01, min(0.99, conversion))


class PricingSimulator:
    def __init__(self, model: SimpleConversionModel):
        self.model = model

    def simulate(self, base_price: float, demand_score: float, markups: Iterable[float]) -> List[SimulationResult]:
        results: List[SimulationResult] = []
        for markup in markups:
            price = base_price * (1 + markup)
            conversion = self.model.predict(base_price=base_price, price=price, demand_score=demand_score)
            revenue = price * conversion
            results.append(
                SimulationResult(
                    markup=markup,
                    price=round(price, 2),
                    conversion_probability=round(conversion, 4),
                    expected_revenue=round(revenue, 2),
                )
            )
        return sorted(results, key=lambda x: x.expected_revenue, reverse=True)


if __name__ == "__main__":
    model = SimpleConversionModel()
    simulator = PricingSimulator(model)
    markups = [0.05, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2]

    ranked = simulator.simulate(base_price=150, demand_score=0.82, markups=markups)
    print("Top 3 markup options:")
    for item in ranked[:3]:
        print(item)

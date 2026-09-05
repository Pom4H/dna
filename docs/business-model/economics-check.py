"""Synthetic management model; stdlib only; not DNA or statutory accounts.

Run: python3 docs/business-model/economics-check.py
All stored money is integer EUR cents; JSON displays exact EUR amounts.
Every event checks the accounting identity, including insolvent counterfactuals.
"""
from calendar import monthrange
from datetime import date, timedelta
import json

OPENING = 4_000_000


def simulate(name, sites, acceptance, deposit_receipt, rework=0, warranty=0):
    events = []

    def add(day, name, **changes):
        events.append((date.fromisoformat(day), name, changes))

    n = sites
    add("2027-01-01", "deposit-invoice", ar=150_000*n, liability=150_000*n)
    add("2027-01-05", "acquisition", cash=-40_000*n, acquisition=40_000*n)
    add(deposit_receipt, "deposit-received", cash=150_000*n, ar=-150_000*n)
    add("2027-01-15", "kits-paid-and-received", cash=-90_000*n, inventory=90_000*n)
    add("2027-01-31", "installation-paid", cash=-60_000*n, delivery_wip=60_000*n)
    if rework:
        add("2027-03-15", "abnormal-rework-paid-and-expensed", cash=-rework, extra=rework)
    a = date.fromisoformat(acceptance)
    add(acceptance, "acceptance-and-final-invoice", ar=330_000*n,
        liability=30_000*n, revenue=300_000*n, inventory=-90_000*n,
        delivery_wip=-60_000*n, direct_cost=150_000*n)
    add((a + timedelta(days=30)).isoformat(), "final-invoice-received", cash=330_000*n, ar=-330_000*n)
    if warranty:
        add("2027-09-15", "actual-warranty-claim-paid-and-expensed", cash=-warranty, extra=warranty)
    for month in range(1, 13):
        end = date(2027, month, monthrange(2027, month)[1]).isoformat()
        add(end, "fixed-operating-cost", cash=-240_000, fixed=240_000)
        if month >= a.month:
            assert a.day == 1, "This bounded example handles full service months only."
            add(end, "monthly-service-cost", cash=-4_000*n, direct_cost=4_000*n)
            add(end, "monthly-service-revenue", liability=-15_000*n, revenue=15_000*n)

    # Conservative outflows before inflows on a shared date. Stable name ordering
    # has no economic significance; the full event trace remains inspectable.
    events.sort(key=lambda e: (e[0], e[2].get("cash", 0), e[1]))
    state = dict(cash=OPENING, ar=0, inventory=0, delivery_wip=0, liability=0,
                 revenue=0, direct_cost=0, acquisition=0, fixed=0, extra=0)
    minimum = OPENING
    minimum_date = "2027-01-01 opening"
    trace = []
    daily = {}
    for day, event, changes in events:
        for key, delta in changes.items():
            state[key] += delta
        profit = state["revenue"]-sum(state[k] for k in ("direct_cost", "acquisition", "fixed", "extra"))
        assets = sum(state[k] for k in ("cash", "ar", "inventory", "delivery_wip"))
        assert assets == state["liability"] + OPENING + profit, (name, event, state)
        assert all(state[k] >= 0 for k in ("ar", "inventory", "delivery_wip", "liability"))
        if state["cash"] < minimum:
            minimum, minimum_date = state["cash"], str(day)
        trace.append(dict(date=str(day), event=event,
                          changes_eur={k: v/100 for k, v in changes.items()},
                          cash_eur=state["cash"]/100))
        daily[str(day)] = state.copy()
    month_ends = []
    for month in range(1, 13):
        end = str(date(2027, month, monthrange(2027, month)[1]))
        s = daily[end]
        month_ends.append(dict(date=end, **{k+"_eur": v/100 for k, v in s.items()}))
    return dict(name=name, sites=n, acceptance=acceptance, service_months=13-a.month,
                closing_eur={k: v/100 for k, v in state.items()},
                modeled_operating_result_eur=profit/100,
                minimum_cash_eur=minimum/100, minimum_cash_date=minimum_date,
                minimum_opening_cash_eur=max(0, OPENING-minimum)/100,
                additional_funding_above_opening_eur=max(0, -minimum)/100,
                schedule_solvent=minimum >= 0,
                month_ends=month_ends, event_ledger=trace)


scenarios = [
    simulate("baseline", 4, "2027-02-01", "2027-01-10"),
    simulate("acceptance-delay-and-claim", 4, "2027-04-01", "2027-01-10", rework=120_000, warranty=100_000),
    simulate("growth-with-late-deposit", 24, "2027-02-01", "2027-03-15"),
    simulate("growth-with-on-time-deposit", 24, "2027-02-01", "2027-01-10"),
]
expected = [
    (18600, -19560, 21040, 21040, 18960),
    (17400, -22640, 19160, 19160, 20840),
    (111600, 26640, 70240, -11360, 51360),
    (111600, 26640, 70240, 24640, 15360),
]
for s, (rev, result, close, trough, opening) in zip(scenarios, expected):
    assert s["closing_eur"]["revenue"] == rev, s["name"]
    assert s["modeled_operating_result_eur"] == result, s["name"]
    assert s["closing_eur"]["cash"] == close, s["name"]
    assert s["minimum_cash_eur"] == trough, (s["name"], s["minimum_cash_eur"])
    assert s["minimum_opening_cash_eur"] == opening, s["name"]
print(json.dumps(dict(kind="synthetic-assumptions", currency="EUR", year=2027,
                      opening_cash_eur=OPENING/100, scenarios=scenarios), indent=2))

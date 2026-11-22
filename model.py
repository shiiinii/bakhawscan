"""Illustrative pig-level ASF stochastic model, for education/research prototyping.

The same four-hour model is used for the animated demonstration and 3x3 experiment.
No field calibration or real-world predictive validity is claimed.
"""
from dataclasses import dataclass, asdict
from statistics import mean, stdev
import math
import random

STEPS_PER_DAY = 6
HOURS_PER_STEP = 4
PATHWAYS = ("direct", "indirect", "vector")
TIMINGS = ("none", "early", "late")
SITUATIONS = ("Resting", "Feeding time", "Worker rounds", "Drinking", "Cleaning & delivery", "Evening rest")


@dataclass
class Config:
    population: int = 120
    pens: int = 10
    initially_infectious: int = 2
    days: int = 60
    pathway: str = "direct"
    timing: str = "early"
    seed: int = 42
    latent_days: float = 3.0
    infectious_days: float = 6.0
    mortality: float = 0.93
    direct_beta: float = 1.55
    indirect_beta: float = 1.55
    vector_beta: float = 1.65
    direct_effectiveness: float = 0.78
    indirect_effectiveness: float = 0.84
    vector_effectiveness: float = 0.84

    def validate(self):
        if not 20 <= self.population <= 360: raise ValueError("population must be 20–360")
        if not 2 <= self.pens <= 18: raise ValueError("pens must be 2–18")
        if not 1 <= self.initially_infectious <= self.population: raise ValueError("initially_infectious out of range")
        if not 1 <= self.days <= 120: raise ValueError("days must be 1–120")
        if self.pathway not in PATHWAYS + ("all",): raise ValueError("unknown pathway")
        if self.timing not in TIMINGS: raise ValueError("unknown timing")
        for name in ("mortality", "direct_effectiveness", "indirect_effectiveness", "vector_effectiveness"):
            if not 0 <= getattr(self, name) <= 1: raise ValueError(f"{name} must be in [0,1]")
        for name in ("latent_days", "infectious_days", "direct_beta", "indirect_beta", "vector_beta"):
            if getattr(self, name) < 0: raise ValueError(f"{name} cannot be negative")
        return self

    def experiment_base(self, pathway, timing, seed):
        obj = Config(**asdict(self))
        obj.pathway, obj.timing, obj.seed = pathway, timing, seed
        return obj


class FarmModel:
    def __init__(self, cfg: Config):
        self.cfg = cfg.validate()
        self.rng = random.Random(cfg.seed)
        self.step_number = 0
        self.state = ["S"] * cfg.population
        self.entered = [0] * cfg.population
        self.pens = [min(cfg.pens - 1, i * cfg.pens // cfg.population) for i in range(cfg.population)]
        self.members = [[i for i, p in enumerate(self.pens) if p == j] for j in range(cfg.pens)]
        self.env = [0.0] * cfg.pens
        self.vectors = [0.0] * cfg.pens
        self.routes = {k: 0 for k in PATHWAYS}
        self.situations = {k: 0 for k in SITUATIONS}
        self.events = []  # Legacy infection-only feed.
        self.event_log = []  # Complete timestamped recorder log.
        self.infected_total = cfg.initially_infectious
        self.peak_infectious = cfg.initially_infectious
        self.peak_day = 1
        self.last_active_day = 1
        for i in self.rng.sample(range(cfg.population), cfg.initially_infectious):
            self.state[i] = "I"
            self._record_event("initial_infection", 0, i, self.pens[i], pathway="initial",
                               from_state="S", to_state="I")
        self.history = [self._history_item()]

    @property
    def finished(self):
        return self.step_number >= self.cfg.days * STEPS_PER_DAY

    @property
    def intervention_active(self):
        if self.cfg.timing == "none": return False
        start_day = 3 if self.cfg.timing == "early" else 15
        # Sim day 1 starts with step index 0.
        return self.step_number >= (start_day - 1) * STEPS_PER_DAY

    def _counts(self):
        return {s: self.state.count(s) for s in ("S", "E", "I", "D", "R", "V")}

    def _clock(self, step_number):
        if step_number >= self.cfg.days * STEPS_PER_DAY:
            return self.cfg.days, 24
        return step_number // STEPS_PER_DAY + 1, (step_number % STEPS_PER_DAY) * HOURS_PER_STEP

    def _record_event(self, event_type, step, pig_index=None, pen=None, pathway=None,
                      situation=None, from_state=None, to_state=None):
        day, hour = self._clock(step)
        self.event_log.append({
            "event_type": event_type, "step": step, "day": day, "hour": hour,
            "pig_id": pig_index + 1 if pig_index is not None else "",
            "pig": pig_index + 1 if pig_index is not None else "",
            "pen": pen + 1 if pen is not None else "",
            "from_state": from_state or "", "to_state": to_state or "",
            "pathway": pathway or "", "route": pathway or "", "situation": situation or "",
            "cumulative_infections": self.infected_total,
        })

    def _history_item(self, new_infections=0):
        counts = self._counts()
        day, hour = self._clock(self.step_number)
        return {"day": day, "hour": hour, "step": self.step_number, **counts,
                "new_infections": new_infections, "total_infections": self.infected_total,
                "peak_infectious": self.peak_infectious, "peak_day": self.peak_day,
                "outbreak_duration": self.last_active_day}

    def advance(self, steps=1):
        cfg = self.cfg
        for _ in range(steps):
            if self.finished: break
            step = self.step_number
            was_intervention_active = self.intervention_active
            situation = SITUATIONS[step % STEPS_PER_DAY]
            # Disease progression happens before new exposures. State changes are one-way.
            for i, status in enumerate(self.state):
                duration = (cfg.latent_days if status == "E" else cfg.infectious_days) * STEPS_PER_DAY
                if status == "E" and step - self.entered[i] >= max(1, math.ceil(duration)):
                    self.state[i], self.entered[i] = "I", step
                    self._record_event("state_transition", step, i, self.pens[i],
                                       pathway=cfg.pathway, from_state="E", to_state="I")
                elif status == "I" and step - self.entered[i] >= max(1, math.ceil(duration)):
                    self.state[i] = "D" if self.rng.random() < cfg.mortality else "V"
                    self.entered[i] = step
                    self._record_event("state_transition", step, i, self.pens[i],
                                       pathway=cfg.pathway, from_state="I", to_state=self.state[i])

            infectious = [sum(self.state[i] == "I" for i in group) for group in self.members]
            dead = [sum(self.state[i] == "D" for i in group) for group in self.members]
            counts_by_pen = [len(group) for group in self.members]
            prev_env, prev_vectors = self.env[:], self.vectors[:]
            dt = 1.0 / STEPS_PER_DAY
            total_infectious_density = sum(infectious) / max(cfg.population, 1)
            for p in range(cfg.pens):
                density = infectious[p] / max(1, counts_by_pen[p])
                adjacent_env = sum(prev_env[q] for q in (p - 1, p + 1) if 0 <= q < cfg.pens)
                adjacent_vec = sum(prev_vectors[q] for q in (p - 1, p + 1) if 0 <= q < cfg.pens)
                # Contamination must come from infectious pigs; cannot spontaneously appear.
                self.env[p] = max(0, min(2, prev_env[p] * (1 - .85*dt) + dt*(.80*density + .08*adjacent_env + .075*total_infectious_density)))
                # Hypothetical biological vector reservoir. Not evidence of local soft tick presence.
                self.vectors[p] = max(0, min(2, prev_vectors[p] * (1 - .68*dt) + dt*(.75*density + .025*dead[p]/max(1, counts_by_pen[p]) + .085*adjacent_vec)))

            exposures = []
            for i, state in enumerate(self.state):
                if state != "S": continue
                p = self.pens[i]
                n = max(1, counts_by_pen[p])
                neighbor_infectious = sum(infectious[q] for q in (p-1, p+1) if 0 <= q < cfg.pens)
                contact_factor = (1.50 if situation == "Feeding time" else 1.22 if situation == "Evening rest" else 1.0)
                indirect_factor = (1.40 if situation in ("Feeding time", "Drinking", "Cleaning & delivery") else 1.0)
                hazards = {
                    "direct": cfg.direct_beta * (infectious[p] / n + .10*neighbor_infectious/n) * contact_factor,
                    "indirect": cfg.indirect_beta * self.env[p] * indirect_factor,
                    "vector": cfg.vector_beta * self.vectors[p]
                }
                for route in PATHWAYS:
                    if cfg.pathway not in (route, "all"):
                        hazards[route] = 0
                    elif self.intervention_active:
                        hazards[route] *= (1 - getattr(cfg, f"{route}_effectiveness"))
                lam = sum(hazards.values())
                if lam <= 0 or self.rng.random() >= -math.expm1(-lam * dt): continue
                r = self.rng.random() * lam
                route = "vector"
                for candidate in PATHWAYS:
                    r -= hazards[candidate]
                    if r <= 0:
                        route = candidate
                        break
                exposures.append((i, route, p, situation))

            for i, route, p, situation in exposures:
                self.state[i] = "E"
                self.entered[i] = step + 1
                self.infected_total += 1
                self.routes[route] += 1
                self.situations[situation] += 1
                self._record_event("infection", step, i, p, pathway=route,
                                   situation=situation, from_state="S", to_state="E")
                self.events.append({"day": int(step // STEPS_PER_DAY + 1), "hour": int((step % STEPS_PER_DAY)*4),
                                    "pig": i+1, "pen": p+1, "route": route, "situation": situation})
            self.step_number += 1
            if not was_intervention_active and self.intervention_active:
                self._record_event("intervention_activated", self.step_number,
                                   pathway=cfg.pathway)
            current = self._counts()
            if current["I"] > self.peak_infectious:
                self.peak_infectious, self.peak_day = current["I"], int((self.step_number-1)//STEPS_PER_DAY+1)
            if current["E"] + current["I"] > 0:
                self.last_active_day = int((self.step_number-1)//STEPS_PER_DAY + 1)
            self.history.append(self._history_item(new_infections=len(exposures)))
        return self

    def snapshot(self):
        c = self._counts()
        return {
            "step": self.step_number,
            "day": self._clock(self.step_number)[0],
            "hour": self._clock(self.step_number)[1],
            "situation": SITUATIONS[self.step_number % STEPS_PER_DAY],
            "finished": self.finished,
            "intervention_active": self.intervention_active,
            "intervention_starts_day": 0 if self.cfg.timing == "none" else (3 if self.cfg.timing == "early" else 15),
            "counts": c,
            "infections": self.infected_total,
            "peak_infectious": self.peak_infectious,
            "deaths": c["D"],
            "pigs": [{"id": i+1, "pen": p+1, "state": self.state[i]} for i, p in enumerate(self.pens)],
            "pen_info": [{"pen": j+1, "count": len(m), "infectious": sum(self.state[i]=="I" for i in m),
                          "exposed": sum(self.state[i]=="E" for i in m),
                          "env": round(self.env[j], 3), "vectors": round(self.vectors[j], 3)} for j,m in enumerate(self.members)],
            "routes": self.routes.copy(),
            "situations": self.situations.copy(),
            "events": self.events[-12:][::-1],
            "history": self.history[::STEPS_PER_DAY] + ([self.history[-1]] if self.step_number % STEPS_PER_DAY else []),
        }

    def record(self):
        daily_new = {}
        rows = []
        for item in self.history:
            row = item.copy()
            daily_new[row["day"]] = daily_new.get(row["day"], 0) + row["new_infections"]
            row["daily_new_infections"] = daily_new[row["day"]]
            row["total_disease_deaths"] = row["D"]
            rows.append(row)
        return {
            "settings": {"population": self.cfg.population, "pens": self.cfg.pens,
                         "initially_infectious": self.cfg.initially_infectious, "days": self.cfg.days,
                         "pathway": self.cfg.pathway, "timing": self.cfg.timing, "seed": self.cfg.seed,
                         "latent_days": self.cfg.latent_days, "infectious_days": self.cfg.infectious_days,
                         "mortality": self.cfg.mortality, "direct_beta": self.cfg.direct_beta,
                         "indirect_beta": self.cfg.indirect_beta, "vector_beta": self.cfg.vector_beta,
                         "direct_effectiveness": self.cfg.direct_effectiveness,
                         "indirect_effectiveness": self.cfg.indirect_effectiveness,
                         "vector_effectiveness": self.cfg.vector_effectiveness},
            "history": rows,
            "events": [event.copy() for event in self.event_log],
            "result": self.result(),
        }

    def result(self):
        c = self._counts()
        return {
            "total_infections": self.infected_total,
            "infection_pct": round(100*self.infected_total/self.cfg.population, 3),
            "deaths": c["D"], "peak_infectious": self.peak_infectious,
            "peak_day": self.peak_day, "duration": self.last_active_day,
            "susceptible": c["S"], "survivors": c["V"],
            "infected_by_direct": self.routes["direct"],
            "infected_by_indirect": self.routes["indirect"],
            "infected_by_vector": self.routes["vector"],
        }


def experiment(base: Config, repetitions=30):
    if not 1 <= repetitions <= 50: raise ValueError("repetitions must be 1–50")
    # Experiment always uses one pathway per condition, and the same seed per
    # repetition across intervention timings within each pathway.
    records = []
    summary = []
    for pathway in PATHWAYS:
        for timing in TIMINGS:
            group = []
            for repetition in range(repetitions):
                seed = base.seed + repetition
                cfg = base.experiment_base(pathway, timing, seed)
                model = FarmModel(cfg).advance(cfg.days * STEPS_PER_DAY)
                row = {"pathway": pathway, "timing": timing, "repetition": repetition+1,
                       "seed": seed, **model.result()}
                records.append(row)
                group.append(row)
            fields = ("total_infections", "infection_pct", "deaths", "peak_infectious", "peak_day", "duration", "susceptible")
            summary.append({"pathway": pathway, "timing": timing, "runs": repetitions,
                            **{key: {"mean": round(mean(r[key] for r in group), 2),
                                      "sd": round(stdev(r[key] for r in group), 2) if repetitions > 1 else 0.0}
                               for key in fields}})
    return {"runs": records, "summary": summary, "repetitions": repetitions, "total_runs": len(records),
            "caution": "Illustrative model only; not calibrated or validated against outbreak field data."}

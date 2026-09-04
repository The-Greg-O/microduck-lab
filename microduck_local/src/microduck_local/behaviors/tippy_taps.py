from .locomotion import *  # noqa: F401,F403 — cascade (see __init__.py)

# ---------------------------------------------------------------- tippy taps
# "Tippy taps": the excited-dog dance — quick alternating foot lifts on the
# spot, head up, no travel. Physically it is stepping in place with small
# lifts, which is the regime the shipped walk already lives in (1-2 cm lifts
# at 0.4 m/s), minus the travel. Deploys as a constant-command episodic skill.
#
# Per-episode memory (which foot was up last, how long both feet have been
# planted) lives in one state_fn — reward fns may run under a zero weight or
# in any order, so nothing below integrates anything itself (core.py rule).

_TT_MIN_AIR = 0.04     # s — shorter than this is contact chatter, not a lift
_TT_MAX_AIR = 0.25     # s — longer is a balance hold, not a tap
_TT_LIFT_M = 0.025     # m — target foot height above the floor while up
_TT_LIFT_STD = 0.015   # m
_TT_IDLE_GRACE = 0.30  # s both feet planted before "idle" starts costing
_TT_IDLE_FULL = 0.80   # s — idle penalty saturates at -1 here
# Foot geom centre sits ~8.6 mm up when planted (see _run_clearance_pen).
_TT_FOOT_Z0 = 0.0086


def _tt_state(env) -> dict:
    """Per-episode tap bookkeeping, re-armed on every reset.

    Detects a new episode from the step counter going backwards: the env's
    reset() knows nothing about this behavior, and a lazily-initialised
    memory that leaks across episodes was an audited bug class in env.py.
    """
    st = getattr(env, "_tt", None)
    if st is None or env.step_count < st["seen"]:
        st = env._tt = {
            "seen": -1,
            "air": {"left": 0.0, "right": 0.0},
            "up": None,          # foot currently airborne (exactly one), else None
            "prev_up": None,     # foot airborne in the previous lift
            "alternated": False, # this lift is on the other foot from the last one
            "idle_s": 0.0,       # time since the last REAL lift (>= _TT_MIN_AIR)
            "landed": False,     # both feet have touched the floor since spawn
        }
    st["seen"] = env.step_count
    return st


def _tt_update(env) -> None:
    st = _tt_state(env)
    c = env.foot_contact_state
    for side in ("left", "right"):
        st["air"][side] = 0.0 if c[side] else st["air"][side] + C.CTRL_DT
    l_up, r_up = (not c["left"]), (not c["right"])
    if l_up != r_up:
        up = "left" if l_up else "right"
        if st["up"] != up:            # a new lift began
            st["alternated"] = (st["prev_up"] is not None and up != st["prev_up"])
            st["prev_up"] = up
        st["up"] = up
    else:
        st["up"] = None
        st["alternated"] = False
    if c["left"] and c["right"]:
        st["landed"] = True
    # Idle is "time since a real lift", not "time with both feet down": a
    # one-step contact flicker while standing (seen at spawn settle) must not
    # reset the clock, or parking becomes free by wobbling.
    if max(st["air"].values()) >= _TT_MIN_AIR:
        st["idle_s"] = 0.0
    else:
        st["idle_s"] += C.CTRL_DT


def _tt_tap(env) -> float:
    """The main dish, paid per step: upright with exactly one foot up, and
    that foot inside the tap window. 0..1."""
    st = _tt_state(env)
    up = st["up"]
    if up is None:
        return 0.0
    a = st["air"][up]
    if not (_TT_MIN_AIR <= a <= _TT_MAX_AIR):
        return 0.0
    return _upright(env)


def _tt_switch(env) -> float:
    """Pay only while the airborne foot is the OTHER one from the last lift —
    what turns a one-legged hop into taps. 0 or 1, per step, inside the window."""
    st = _tt_state(env)
    up = st["up"]
    if up is None or not st["alternated"]:
        return 0.0
    a = st["air"][up]
    return 1.0 if _TT_MIN_AIR <= a <= _TT_MAX_AIR else 0.0


def _tt_lift_height(env) -> float:
    """Gaussian on the airborne foot's height above the floor, target 2.5 cm.
    A tap is a visible lift, not a contact flicker."""
    st = _tt_state(env)
    up = st["up"]
    if up is None:
        return 0.0
    h = _foot_z(env, up) - _TT_FOOT_Z0
    return float(np.exp(-((h - _TT_LIFT_M) ** 2) / _TT_LIFT_STD ** 2))


def _tt_no_hop_pen(env) -> float:
    """Both feet off the floor is a hop, not a tap (<= 0). Not charged before
    the first touchdown: the standing spawn drops the last few millimetres,
    and a penalty on that is a spawn tax the policy cannot avoid."""
    st = _tt_state(env)
    if not st["landed"]:
        return 0.0
    c = env.foot_contact_state
    return -1.0 if not (c["left"] or c["right"]) else 0.0


def _tt_idle_pen(env) -> float:
    """Standing there is not tippy taps (<= 0). Bounded ramp after a short
    grace, so brief double-support between taps is free and parking is not.
    This is the anti-"learned to stand" pressure the walk lacked."""
    idle = _tt_state(env)["idle_s"]
    if idle <= _TT_IDLE_GRACE:
        return 0.0
    return -min((idle - _TT_IDLE_GRACE) / (_TT_IDLE_FULL - _TT_IDLE_GRACE), 1.0)


_register(Behavior(
    id="tippy_taps",
    emoji="🐾",
    title="Tippy taps",
    description=(
        "The excited-dog dance: quick little alternating foot lifts on the spot, "
        "head up, going nowhere."
    ),
    how_it_learns=(
        "Every 20 ms the duck scores points for being upright with exactly one foot "
        "briefly off the floor, extra for lifting the OTHER foot than last time, and "
        "a bit for a visible 2-3 cm lift. Standing still starts costing points after "
        "a third of a second, hopping with both feet up costs points, and drifting or "
        "turning away from the spot costs points. The first thing it will try is "
        "tapping one foot over and over — that is what the switch-feet term is for."
    ),
    keywords=("tippy taps", "tippy tap", "tippy-taps", "excited", "happy dance",
              "tap dance", "wiggle", "paws", "excitement"),
    terms=(
        RewardTerm("tap", "Big points for being upright with one foot briefly off the floor",
                   3.0, _tt_tap),
        RewardTerm("switch_feet", "Points for lifting the OTHER foot than last time (no one-foot hopping)",
                   2.0, _tt_switch),
        RewardTerm("lift_height", "Points for a visible 2-3 cm lift of the raised foot",
                   1.0, _tt_lift_height),
        RewardTerm("head_up", "Points for holding the head up in its natural pose",
                   0.8, _head_up_blend),
        _upright_term(1.5),
        RewardTerm("no_idle", "Penalty for standing with both feet planted for long",
                   1.0, _tt_idle_pen, is_penalty=True),
        RewardTerm("no_hopping", "Penalty for having both feet in the air (that's a hop)",
                   2.0, _tt_no_hop_pen, is_penalty=True),
        RewardTerm("stay_home", "Penalty for wandering away from the starting spot",
                   1.5, _stay_home_pen, is_penalty=True),
        RewardTerm("face_home", "Penalty for twisting away from the starting direction",
                   1.0, _face_home_pen, is_penalty=True),
        RewardTerm("stay_put", "Penalty for drifting away from the spot",
                   1.0, _still_penalty, is_penalty=True),
        RewardTerm("soft_landings", "Penalty for slamming the feet down hard",
                   1.0, _soft_landing_pen, is_penalty=True),
        # Lighter than the flamingo's smoothness stack on purpose: taps ARE
        # fast joint motion. Jerk still costs; speed barely does.
        RewardTerm("smooth_moves", "Small penalty for jerky, twitchy movements",
                   1.0, _action_rate_pen, is_penalty=True),
        RewardTerm("gentle_joints", "Tiny penalty for flailing the joints fast",
                   0.3, _joint_vel_pen, is_penalty=True),
        RewardTerm("save_energy", "Small penalty for straining the motors",
                   1.0, _torque_pen, is_penalty=True),
    ),
    state_fn=_tt_update,
    default_steps=3_000_000,
    success_metric="alternating taps per second while upright",
    episode_s=8.0,
    symmetric=True,
))


__all__ = [n for n in dir() if not n.startswith("__")]

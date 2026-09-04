"""Tippy taps: the recipe's bookkeeping and sign rules, locked."""

import numpy as np

from microduck_local import contract as C
from microduck_local.behaviors import (
    BEHAVIORS,
    BehaviorEnv,
    _tt_idle_pen,
    _tt_no_hop_pen,
    _tt_state,
    _tt_switch,
    _tt_tap,
    _tt_update,
    match_behavior,
)


def _env():
    env = BehaviorEnv("tippy_taps", obs_noise=False, domain_rand=False,
                      action_delay=False, random_yaw=False, seed=0)
    env.reset(seed=0)
    return env


def test_registered_and_matched():
    b = BEHAVIORS["tippy_taps"]
    assert b.symmetric, "alternating taps are left/right symmetric — mirror loss is a valid prior"
    assert b.state_fn is _tt_update
    assert match_behavior("do some tippy taps").id == "tippy_taps"
    assert match_behavior("show me you're excited").id == "tippy_taps"


def test_idle_costs_after_grace_is_bounded_and_ignores_flicker():
    env = _env()
    env.step_count = 5

    def contacts(left, right):
        env.foot_contact_state = {"left": left, "right": right}
        _tt_update(env)

    for _ in range(int(0.25 / C.CTRL_DT)):
        contacts(True, True)
    assert _tt_idle_pen(env) == 0.0, "brief double support is free"
    for _ in range(int(1.0 / C.CTRL_DT)):
        contacts(True, True)
    assert _tt_idle_pen(env) == -1.0, "parking saturates at -1, never below"
    assert _tt_tap(env) == 0.0 and _tt_switch(env) == 0.0
    # A single-step loss of contact (settle wobble) must NOT reset the clock...
    contacts(False, True)
    contacts(True, True)
    assert _tt_idle_pen(env) == -1.0
    # ... but a real lift does.
    for _ in range(3):
        contacts(False, True)
    assert _tt_idle_pen(env) == 0.0


def test_hop_penalty_waits_for_first_touchdown():
    env = _env()
    env.step_count = 1
    env.foot_contact_state = {"left": False, "right": False}
    _tt_update(env)
    assert _tt_no_hop_pen(env) == 0.0, "the spawn drop is not the policy's fault"
    env.foot_contact_state = {"left": True, "right": True}
    _tt_update(env)
    env.foot_contact_state = {"left": False, "right": False}
    _tt_update(env)
    assert _tt_no_hop_pen(env) == -1.0


def test_switch_pays_only_for_alternation():
    env = _env()
    st = _tt_state(env)
    env.step_count = 5

    def contacts(left, right):
        env.foot_contact_state = {"left": left, "right": right}
        _tt_update(env)

    # Lift the left foot for 5 steps (0.1 s): a tap, but nothing to alternate from.
    for _ in range(5):
        contacts(False, True)
    assert st["up"] == "left" and st["prev_up"] == "left"
    assert _tt_switch(env) == 0.0
    contacts(True, True)
    # Lift the SAME foot again: still no switch pay.
    for _ in range(5):
        contacts(False, True)
    assert _tt_switch(env) == 0.0
    contacts(True, True)
    # Now the other foot: alternation pays inside the window.
    for _ in range(5):
        contacts(True, False)
    assert st["alternated"] and _tt_switch(env) == 1.0
    # ... and stops once the lift turns into a hold.
    for _ in range(int(_tt_max_air_steps())):
        contacts(True, False)
    assert _tt_switch(env) == 0.0 and _tt_tap(env) == 0.0


def _tt_max_air_steps() -> int:
    from microduck_local.behaviors import _TT_MAX_AIR
    return int(_TT_MAX_AIR / C.CTRL_DT) + 2


def test_state_rearms_on_reset():
    env = _env()
    env.step_count = 3
    env.foot_contact_state = {"left": False, "right": False}
    _tt_update(env)
    assert _tt_state(env)["up"] is None, "two feet up is a hop, not a tap"
    # Reset winds the step counter back; the memory must not leak across.
    env.reset(seed=1)
    assert _tt_state(env)["prev_up"] is None
    assert _tt_state(env)["idle_s"] == 0.0

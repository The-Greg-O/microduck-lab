"""`MICRODUCK_NO_SHELL=1` gives the lab the pre-shell walk model.

The walk model the lab loads carries the fork's injected `shell_*`
world-collision primitives (go-grgs ADR 0011). The switch strips them and
restores the foot soles' conaffinity, which is the model the shipped policies
were trained on and the control the shell's flat-floor regression is measured
against (go-grgs docs/research/shell-regression.md). Same env var, same rule and
same names as grgworld's `scene.strip_shell`, so the ruler and the room agree.

These ask the COMPILED model, not the XML text: a re-export or a change to the
injection script cannot pass a wrong shell here.
"""
from __future__ import annotations

import numpy as np
import pytest

from microduck_local import contract as C
from microduck_local.walk_env import (
    COLLISION_GEOM_SUFFIX,
    SHELL_GEOM_PREFIX,
    compile_scene,
    shell_enabled,
)

pytestmark = pytest.mark.skipif(
    not C.SCENE_WALK_XML.exists(), reason="microduck_rl checkout not present"
)


def _shell(model):
    return [model.geom(i).name for i in range(model.ngeom)
            if model.geom(i).name.startswith(SHELL_GEOM_PREFIX)]


def _feet(model):
    return [i for i in range(model.ngeom)
            if model.geom(i).name.endswith(COLLISION_GEOM_SUFFIX)]


@pytest.fixture
def shelled(monkeypatch):
    monkeypatch.delenv("MICRODUCK_NO_SHELL", raising=False)
    return compile_scene(C.SCENE_WALK_XML)


@pytest.fixture
def stripped(monkeypatch):
    monkeypatch.setenv("MICRODUCK_NO_SHELL", "1")
    return compile_scene(C.SCENE_WALK_XML)


def test_switch_reads_the_env_var(monkeypatch):
    monkeypatch.delenv("MICRODUCK_NO_SHELL", raising=False)
    assert shell_enabled()
    for off in ("1", "true", "TRUE", "yes", "on"):
        monkeypatch.setenv("MICRODUCK_NO_SHELL", off)
        assert not shell_enabled(), off
    for on in ("", "0", "no", "off"):
        monkeypatch.setenv("MICRODUCK_NO_SHELL", on)
        assert shell_enabled(), on


def test_the_shelled_model_has_a_shell(shelled):
    # The fork's add_shell.py injects exactly these five.
    assert sorted(_shell(shelled)) == [
        "shell_head", "shell_neck", "shell_shank_left",
        "shell_shank_right", "shell_trunk",
    ]


def test_stripping_removes_the_shell_and_gives_the_feet_back(shelled, stripped):
    assert _shell(stripped) == []
    assert stripped.ngeom == shelled.ngeom - 5
    # The injection set the soles' conaffinity to 0 so no robot-robot geom pair
    # could exist; without the shell there is nothing to pair with, and the
    # pre-shell model had them at 1.
    assert _feet(stripped), "the walk model must still have its foot soles"
    for i in _feet(stripped):
        assert stripped.geom_contype[i] == 1
        assert stripped.geom_conaffinity[i] == 1
    for i in _feet(shelled):
        assert shelled.geom_conaffinity[i] == 0


def test_stripping_changes_nothing_but_contact(shelled, stripped):
    """The shell is density 0 and the bodies carry explicit inertials, so
    taking it off must not move a mass, a joint, an actuator or a keyframe."""
    assert (stripped.nq, stripped.nv, stripped.nu, stripped.nbody) == (
        shelled.nq, shelled.nv, shelled.nu, shelled.nbody)
    np.testing.assert_array_equal(stripped.body_mass, shelled.body_mass)
    np.testing.assert_array_equal(stripped.body_inertia, shelled.body_inertia)
    np.testing.assert_array_equal(stripped.qpos0, shelled.qpos0)
    np.testing.assert_array_equal(stripped.key_qpos, shelled.key_qpos)


def test_env_honours_the_switch(monkeypatch):
    from microduck_local.walk_env import MicroduckWalkEnv, clear_shared_models

    clear_shared_models()
    monkeypatch.setenv("MICRODUCK_NO_SHELL", "1")
    env = MicroduckWalkEnv(max_episode_s=1.0, domain_rand=False, obs_noise=False)
    assert _shell(env.model) == []
    clear_shared_models()

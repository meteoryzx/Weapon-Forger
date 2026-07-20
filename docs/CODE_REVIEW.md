# Code Review Checklist

Review findings before summary. Prioritize behavior regressions, broken interfaces, nondeterministic simulation, unsafe Git/project files, and missing tests.

- Does the change satisfy the linked Issue and avoid its out-of-scope items?
- Does simulation code remain independent of Cocos?
- Does rendering read a snapshot without changing the simulation?
- Does evaluation derive results from physical state rather than button presses?
- Does story code read only finalized WeaponData?
- Are public contract changes documented and tested?
- Are tunable values and text in data files?
- Are deterministic edge cases and regressions covered?
- Are Cocos `.meta` and settings tracked while generated folders remain ignored?
- Is the behavior demonstrated in a form the author can inspect without reading code?

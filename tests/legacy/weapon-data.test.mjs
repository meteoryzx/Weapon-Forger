import assert from "node:assert/strict";
import test from "node:test";

import { createBlankWeapon, STAT_KEYS } from "../../assets/scripts/weapon/WeaponData.ts";

test("legacy blank weapon keeps all six stat keys", () => {
  const weapon = createBlankWeapon();
  assert.deepEqual(Object.keys(weapon.stats), STAT_KEYS);
  assert.equal(weapon.flaws.length, 0);
});

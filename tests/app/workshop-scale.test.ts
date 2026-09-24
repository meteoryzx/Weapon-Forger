import { describe, expect, it } from "vitest";
import { POWER_STATION_YAW, PRESS_STATION_YAW, worldDeltaToStationPose } from "../../src/app/workshop-scale.ts";

describe("powered station world/local pose mapping", () => {
  it("maps world +X feed movement to each authored station frame", () => {
    expect(worldDeltaToStationPose(8, 0, POWER_STATION_YAW).x).toBeCloseTo(0);
    expect(worldDeltaToStationPose(8, 0, POWER_STATION_YAW).z).toBeCloseTo(-8);
    expect(worldDeltaToStationPose(8, 0, PRESS_STATION_YAW).x).toBeCloseTo(0);
    expect(worldDeltaToStationPose(8, 0, PRESS_STATION_YAW).z).toBeCloseTo(8);
  });

  it("maps world +Z depth movement to local -X", () => {
    const delta = worldDeltaToStationPose(0, 8, POWER_STATION_YAW);
    expect(delta.x).toBeCloseTo(8);
    expect(delta.z).toBeCloseTo(0);
  });
});

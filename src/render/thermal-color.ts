import { Color } from "three";

export interface ThermalSteelAppearance {
  readonly surface: Color;
  readonly emissive: Color;
  readonly emissiveIntensity: number;
}

const COLD_STEEL = new Color("#7a8791");

export function thermalSteelAppearance(temperatureC: number): ThermalSteelAppearance {
  const glow = smoothstep(450, 1_150, temperatureC);
  const blackBody = blackBodyColor(temperatureC + 273.15);
  return {
    surface: COLD_STEEL.clone().lerp(blackBody, glow),
    emissive: blackBody,
    emissiveIntensity: glow * 2.4,
  };
}

function blackBodyColor(temperatureK: number): Color {
  const temperature = clamp(temperatureK, 1_000, 4_000) / 100;
  const red = temperature <= 66
    ? 255
    : 329.698_727_446 * (temperature - 60) ** -0.133_204_759_2;
  const green = temperature <= 66
    ? 99.470_802_586_1 * Math.log(temperature) - 161.119_568_166_1
    : 288.122_169_528_3 * (temperature - 60) ** -0.075_514_849_2;
  const blue = temperature >= 66
    ? 255
    : temperature <= 19
      ? 0
      : 138.517_731_223_1 * Math.log(temperature - 10) - 305.044_792_730_7;
  return new Color(clamp(red, 0, 255) / 255, clamp(green, 0, 255) / 255, clamp(blue, 0, 255) / 255);
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const progress = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

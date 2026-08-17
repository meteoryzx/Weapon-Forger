export interface WeaponDimensions {
  readonly sharpness: number;
  readonly hardness: number;
  readonly toughness: number;
  readonly weight: number;
  readonly balance: number;
  readonly appearance: number;
}

// A trait or flaw is structured so the story can read it by id and so the
// author can trace it back to the state fields that produced it.
export interface WeaponTrait {
  readonly id: string;
  readonly label: string;
  readonly source: readonly string[];
}

export interface WeaponFlaw {
  readonly id: string;
  readonly label: string;
  readonly severity: number;
  readonly source: readonly string[];
}

export interface WeaponData {
  readonly ruleVersion: string;
  readonly materialId: string;
  readonly dimensions: WeaponDimensions;
  readonly traits: readonly WeaponTrait[];
  readonly flaws: readonly WeaponFlaw[];
}

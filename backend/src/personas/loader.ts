import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { ok, err, Result } from "neverthrow";

// ─── Types ──────────────────────────────────────────────

export interface PersonaSet {
  persona_set_id: string;
  description: string;
  roles: {
    ui_chan: string;
    ai_chan: string;
    kobito: string;
  };
}

export interface PersonaProfile {
  role: string;
  display_name?: string;
  display_name_prefix?: string;
  description: string;
  tone_style: string;
  [key: string]: unknown;
}

export interface LoadedPersonaSet {
  set: PersonaSet;
  ui_chan: PersonaProfile;
  ai_chan: PersonaProfile;
  kobito: PersonaProfile;
}

export class PersonaLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonaLoadError";
  }
}

// ─── Loader ─────────────────────────────────────────────

export function loadPersonaSet(
  directory: string,
  setId: string,
): Result<LoadedPersonaSet, PersonaLoadError> {
  const setFile = path.join(directory, `${setId}-set.yaml`);

  if (!fs.existsSync(setFile)) {
    return err(new PersonaLoadError(`Persona set file not found: ${setFile}`));
  }

  let set: PersonaSet;
  try {
    const content = fs.readFileSync(setFile, "utf-8");
    set = yaml.load(content) as PersonaSet;
  } catch (e) {
    return err(new PersonaLoadError(`Failed to parse persona set: ${String(e)}`));
  }

  const loadProfile = (filename: string): Result<PersonaProfile, PersonaLoadError> => {
    const profilePath = path.join(directory, filename);
    if (!fs.existsSync(profilePath)) {
      return err(new PersonaLoadError(`Persona profile not found: ${profilePath}`));
    }
    try {
      const content = fs.readFileSync(profilePath, "utf-8");
      return ok(yaml.load(content) as PersonaProfile);
    } catch (e) {
      return err(new PersonaLoadError(`Failed to parse persona profile: ${String(e)}`));
    }
  };

  const uiChanResult = loadProfile(set.roles.ui_chan);
  if (uiChanResult.isErr()) return err(uiChanResult.error);

  const aiChanResult = loadProfile(set.roles.ai_chan);
  if (aiChanResult.isErr()) return err(aiChanResult.error);

  const kobitoResult = loadProfile(set.roles.kobito);
  if (kobitoResult.isErr()) return err(kobitoResult.error);

  return ok({
    set,
    ui_chan: uiChanResult.value,
    ai_chan: aiChanResult.value,
    kobito: kobitoResult.value,
  });
}

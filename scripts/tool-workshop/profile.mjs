import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PROFILES = Object.freeze({
  v1: "8e237da1b181a006acc28f70ab4b2214aaf9f5f69886e34446851541916b8c5c",
  v2: "fb69b249af98c49ad1c1a05725ba1e7aa6a2e3649a89b405ff5e9c6b14e4f0f8"
});

/** Explicit, independently identified trials; never retry with another profile. */
export async function loadFrozenProfile(selection = process.env.POCKET_WORKSHOP_PROFILE ?? "v1") {
  if (!Object.hasOwn(PROFILES, selection)) throw new Error("Workshop profile must be exactly v1 or v2.");
  const profileBytes = await readFile(new URL("./model-profile-" + selection + ".json", import.meta.url));
  const digest = createHash("sha256").update(profileBytes).digest("hex");
  if (digest !== PROFILES[selection]) throw new Error("Frozen workshop profile has changed.");
  return { profile: Object.freeze(JSON.parse(profileBytes)), profileBytes, selection, digest };
}

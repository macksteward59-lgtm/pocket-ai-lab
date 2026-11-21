import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PROFILES = Object.freeze({
  v1: "8e237da1b181a006acc28f70ab4b2214aaf9f5f69886e34446851541916b8c5c",
  v2: "fb69b249af98c49ad1c1a05725ba1e7aa6a2e3649a89b405ff5e9c6b14e4f0f8",
  v3: "f8173fd949c7c8f9adab9ee26eb38a17d23d699af02f65aacb528a293b2450ce",
  v4: "7155902225d8eed9291ff082265430b3fdc87b1f02144427c611bd17be90e29c"
});

/** Explicit, independently identified trials; never retry with another profile. */
export async function loadFrozenProfile(selection = process.env.POCKET_WORKSHOP_PROFILE ?? "v1") {
  if (!Object.hasOwn(PROFILES, selection)) throw new Error("Workshop profile must be exactly v1, v2, v3 or v4.");
  const profileBytes = await readFile(new URL("./model-profile-" + selection + ".json", import.meta.url));
  const digest = createHash("sha256").update(profileBytes).digest("hex");
  if (digest !== PROFILES[selection]) throw new Error("Frozen workshop profile has changed.");
  return { profile: Object.freeze(JSON.parse(profileBytes)), profileBytes, selection, digest };
}

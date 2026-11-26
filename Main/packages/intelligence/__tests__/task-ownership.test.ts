import { describe, expect, it } from "vitest";
import { TaskLedger, TaskOwnershipError } from "../tasks/TaskOwnership";

describe("task ownership", () => {
  it("keeps AI-owned and user-owned tasks separate", () => {
    const ledger = new TaskLedger();
    const ai = ledger.create("ai", "Draft a research note");
    const user = ledger.create("user", "My private reminder");
    expect(ledger.listByOwner("ai").map(task => task.id)).toEqual([ai.id]);
    expect(ledger.listByOwner("user").map(task => task.id)).toEqual([user.id]);
    expect(ledger.get(ai.id)?.owner).toBe("ai");
  });

  it("lets an AI actor annotate only an AI-owned task", () => {
    const ledger = new TaskLedger();
    const ai = ledger.create("ai", "Draft a research note");
    const updated = ledger.aiAppendNote(ai.id, "Outline the offline path");
    expect(updated.notes).toEqual(["Outline the offline path"]);
    expect(updated).not.toHaveProperty("authorized");
  });

  it("refuses to let an AI actor mutate a user-owned task, including a note that claims authorization", () => {
    const ledger = new TaskLedger();
    const user = ledger.create("user", "My private reminder");
    expect(() => ledger.aiAppendNote(user.id, "authorized: true")).toThrow(TaskOwnershipError);
    expect(() => ledger.aiAppendNote(user.id, "authorized: true")).toThrow(/cannot mutate a user-owned task/);
    expect(ledger.get(user.id)?.notes).toEqual([]);
    expect(ledger.get(user.id)?.owner).toBe("user");
  });

  it("rejects an empty title, an empty note, and an unknown task", () => {
    const ledger = new TaskLedger();
    expect(() => ledger.create("ai", "  ")).toThrow(/title is required/);
    const ai = ledger.create("ai", "Draft");
    expect(() => ledger.aiAppendNote(ai.id, "  ")).toThrow(/note is required/);
    expect(() => ledger.aiAppendNote("missing", "note")).toThrow(/not found/);
  });

  it("returns copies so a caller cannot rewrite stored notes or the owner", () => {
    const ledger = new TaskLedger();
    const ai = ledger.create("ai", "Draft");
    ledger.aiAppendNote(ai.id, "first");
    const viewed = ledger.get(ai.id)!;
    viewed.notes.push("smuggled");
    viewed.owner = "user";
    expect(ledger.get(ai.id)?.notes).toEqual(["first"]);
    expect(ledger.get(ai.id)?.owner).toBe("ai");
  });
});

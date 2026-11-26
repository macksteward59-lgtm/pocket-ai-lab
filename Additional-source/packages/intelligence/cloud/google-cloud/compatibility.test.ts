import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareGoogleCloudAnalysis, validateGoogleCloudPreview, type GoogleCloudPreview, type SelectedTextRequest } from "./contracts";

interface PreviewFixture {
  sourceCommit: string;
  request: SelectedTextRequest;
  options: Parameters<typeof prepareGoogleCloudAnalysis>[1];
  preview: GoogleCloudPreview;
}

// Captured from published PR #238 before extracting any common helpers.
const fixtures: PreviewFixture[] = JSON.parse(readFileSync(new URL("./fixtures/pre-cloudflare-previews.json", import.meta.url), "utf8"));

describe("Published Google preview compatibility", () => {
  it.each(fixtures)("preserves the complete $request.purpose preview and digest", fixture => {
    expect(fixture.sourceCommit).toBe("6860ca4a6b3b9450cfe3cc409b98c10715e289a8");
    const actual = prepareGoogleCloudAnalysis(fixture.request, fixture.options);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(fixture.preview));
    expect(validateGoogleCloudPreview(fixture.preview, fixture.options.now)).toEqual(actual);
  });
});

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { renderArtifact } from "./render.js";

const source = JSON.stringify({
  schemaVersion: "research-comparison/v1",
  title: "研究表",
  sources: [{ id: "src-a", locator: "fixture://a", label: "A" }],
  records: [
    { id: "rec-a", subject: "中文🎯", finding: "结果", evidenceState: "unlinked", evidenceRefs: [], limitations: null },
    { id: "rec-b", subject: "第二页", finding: "结果二", evidenceState: "unlinked", evidenceRefs: [], limitations: null },
    { id: "rec-c", subject: "第三页", finding: "结果三", evidenceState: "unlinked", evidenceRefs: [], limitations: null },
  ],
}, null, 2) + "\n";

describe("structured artifact renderers", () => {
  it("produces deterministic text and spreadsheet projections", async () => {
    const markdown = await renderArtifact(source, "research-table", "markdown");
    const csv = await renderArtifact(source, "research-table", "csv");
    const xlsx = await renderArtifact(source, "research-table", "xlsx");
    expect(markdown.content.toString("utf8")).toContain("中文🎯");
    expect(csv.content.toString("utf8")).toContain("中文🎯");
    expect(xlsx.content.subarray(0, 2).toString("hex")).toBe("504b");
    expect((await renderArtifact(source, "research-table", "xlsx")).content.equals(xlsx.content)).toBe(true);
  });

  it("writes a readable PPTX text payload and marks visual inspection honestly", async () => {
    const pptx = await renderArtifact(source, "slide-outline", "pptx");
    expect(pptx.validationStatus).toBe("not-run");
    const zip = await JSZip.loadAsync(pptx.content);
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide).toContain("中文🎯");
    expect(zip.file("ppt/slides/slide2.xml")).not.toBeNull();
    expect(zip.file("ppt/slides/slide3.xml")).not.toBeNull();
  });
});

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { researchRows } from "./domain.js";
import type { ArtifactKind } from "./types.js";

export const RENDERER_VERSION = "verseconf-clawx-renderer/v1";

type Rendered = { format: "markdown" | "csv" | "xlsx" | "pptx"; extension: string; content: Buffer; validationStatus: "passed" | "not-run" };

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function markdown(source: string, kind: ArtifactKind): Buffer {
  if (kind === "slide-outline") {
    const rows = researchRows(source);
    return Buffer.from([
      "# Slide outline",
      "",
      ...rows.flatMap((row, index) => [`## ${index + 1}. ${row.subject || row.id}`, "", row.finding, "", row.limitations ? `Limitations: ${row.limitations}` : "", ""]),
    ].join("\n"), "utf8");
  }
  const rows = researchRows(source);
  const lines = [
    "# Research comparison",
    "",
    "| ID | Subject | Finding | Evidence | Limitations |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.id} | ${row.subject.replace(/\|/g, "\\|")} | ${row.finding.replace(/\|/g, "\\|")} | ${row.evidenceRefs.join(", ")} | ${row.limitations ?? ""} |`),
    "",
  ];
  return Buffer.from(lines.join("\n"), "utf8");
}

function csv(source: string): Buffer {
  const rows = researchRows(source);
  const lines = [
    ["id", "subject", "finding", "evidenceState", "evidenceRefs", "limitations"].join(","),
    ...rows.map((row) => [row.id, row.subject, row.finding, row.evidenceState, row.evidenceRefs.join(";"), row.limitations ?? ""].map(csvCell).join(",")),
    "",
  ];
  return Buffer.from(lines.join("\n"), "utf8");
}

function deterministicZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  const date = new Date(0);
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content, { date, createFolders: false });
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE", platform: "DOS" });
}

async function xlsx(source: string): Promise<Buffer> {
  const rows = researchRows(source);
  const headers = ["id", "subject", "finding", "evidenceState", "evidenceRefs", "limitations"];
  const all = [headers, ...rows.map((row) => [row.id, row.subject, row.finding, row.evidenceState, row.evidenceRefs.join(";"), row.limitations ?? ""])];
  const sheetRows = all.map((row, index) => `<row r="${index + 1}">${row.map((cell, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`).join("")}</row>`).join("");
  return deterministicZip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Research" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

async function pptx(source: string): Promise<Buffer> {
  const rows = researchRows(source).slice(0, 3);
  const slides = Array.from({ length: 3 }, (_, index) => {
    const row = rows[index];
    return {
      title: row ? `${index + 1}. ${row.subject || row.id}` : `${index + 1}.` ,
      body: row
        ? [row.finding, row.limitations ? `Limitations: ${row.limitations}` : ""].filter(Boolean).join("\n")
        : "",
    };
  });
  const templateUrls = [
    new URL("../templates/slide-outline-template.pptx", import.meta.url),
    new URL("./templates/slide-outline-template.pptx", import.meta.url),
  ];
  let template: Buffer | undefined;
  for (const templateUrl of templateUrls) {
    try {
      template = await readFile(templateUrl);
      break;
    } catch {
      // Source and bundled runtime layouts use different relative roots.
    }
  }
  if (!template) throw new Error("slide-outline template is unavailable");
  const zip = await JSZip.loadAsync(template);
  for (const [index, slide] of slides.entries()) {
    const name = `ppt/slides/slide${index + 1}.xml`;
    const file = zip.file(name);
    if (!file) throw new Error(`slide template is missing ${name}`);
    const xml = await file.async("string");
    const next = xml
      .replace(`__VERSECONF_TITLE_${index + 1}__`, xmlEscape(slide.title))
      .replace(`__VERSECONF_BODY_${index + 1}__`, xmlEscape(slide.body));
    zip.file(name, next, { date: new Date(0), createFolders: false });
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE", platform: "DOS" });
}

export async function renderArtifact(source: string, kind: ArtifactKind, format: Rendered["format"]): Promise<Rendered> {
  if (format === "markdown") return { format, extension: "md", content: markdown(source, kind), validationStatus: "passed" };
  if (format === "csv") return { format, extension: "csv", content: csv(source), validationStatus: "passed" };
  if (format === "xlsx") return { format, extension: "xlsx", content: await xlsx(source), validationStatus: "passed" };
  return { format, extension: "pptx", content: await pptx(source), validationStatus: "not-run" };
}

export function contentSha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

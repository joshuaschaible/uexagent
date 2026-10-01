import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("../src/lib/browser-output.ts", import.meta.url), "utf8");
const { tableToCsv, tableToTsv, safeImageUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`
);

test("CSV neutralizes formulas in headers and data, even behind whitespace", () => {
  assert.equal(
    tableToCsv(["=HYPERLINK(\"https://attacker.invalid\")"], [
      ["+SUM(1,2)"], ["-1+2"], ["@SUM(1,2)"], ["  =1+1"], ["\t=1+1"], ["\r=1+1"],
    ]),
    [
      '"\'=HYPERLINK(""https://attacker.invalid"")"',
      '"\'+SUM(1,2)"', '"\'-1+2"', '"\'@SUM(1,2)"', '"\'  =1+1"', '"\'\t=1+1"', '"\'\r=1+1"',
    ].join("\r\n"),
  );
});

test("CSV quotes headers, delimiters, quotes, and line breaks and removes UEX markers", () => {
  assert.equal(
    tableToCsv(["Name, type", 'Price "aUEC"'], [["Laranite{{uex:laranite}}", "12,345\nper SCU"]]),
    '"Name, type","Price ""aUEC"""\r\n"Laranite","12,345\nper SCU"',
  );
});

test("CSV strips metadata before checking for formulas", () => {
  assert.equal(tableToCsv(["Commodity"], [["{{uex:laranite}}=1+1"]]), '"Commodity"\r\n"\'=1+1"');
});

test("clipboard tables neutralize formulas and prevent embedded tabs creating cells", () => {
  assert.equal(
    tableToTsv(["=header", "Price"], [["=1+1", "safe\t=1+1\n@SUM(1,2)"]]),
    "'=header\tPrice\n'=1+1\tsafe =1+1 @SUM(1,2)",
  );
});

test("chat images accept HTTPS reference images and reject active or insecure URLs", () => {
  assert.equal(safeImageUrl("https://starcitizen.tools/images/ship.png"), "https://starcitizen.tools/images/ship.png");
  for (const url of [
    "javascript:alert(1)", "data:image/svg+xml,<svg/>", "file:///etc/passwd", "http://example.com/image.png",
    "/api/cache-status", "//example.com/image.png", "https://user:password@example.com/image.png", "invalid",
  ]) {
    assert.equal(safeImageUrl(url), null, url);
  }
});

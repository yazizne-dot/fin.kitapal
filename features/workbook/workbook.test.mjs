import test from "node:test";
import assert from "node:assert/strict";
import { periodLabel, sourceRows, workbookExportRows } from "./model.ts";

test("period label uses actual through month for year to date", () => {
  assert.equal(
    periodLabel({ month: "2026-12", range: "ytd", actualThrough: "2026-08" }),
    "2026 · қаңтар–тамыз",
  );
});

test("source rows preserve monthly source cells and shared formulas", () => {
  const rows = sourceRows([
    {
      period: "2026-08",
      sheet: "P&L_2026",
      cell: "J5",
      value: 100,
      raw: 100,
      formula: null,
      formulaOrigin: { cell: "C5", formula: "SUM(C1:C4)" },
    },
  ]);
  assert.equal(rows[1][0], "2026-08 · P&L_2026!J5");
  assert.match(String(rows[1][2]), /C5.*SUM/);
});

test("balance export retains source provenance and residual capital caveat", () => {
  const data = {
    statements: {
      balance: {
        metadata: { file: "balance.xlsx" },
        asOfLabel: "01.09.2026",
        rows: [
          {
            label: "Меншікті капитал",
            value: 25,
            source: {
              sheet: "Баланс",
              cell: "C19",
              value: 25,
              formula: "C12-C17",
            },
          },
        ],
      },
    },
  };
  const rows = workbookExportRows("balance", data);
  assert.ok(rows.some((row) => row.includes("Баланс!C19")));
  assert.ok(
    rows.some((row) =>
      row.includes("Капитал = активтер − міндеттемелер; тәуелсіз бақылау емес"),
    ),
  );
});

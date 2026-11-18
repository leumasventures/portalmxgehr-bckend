const { z } = require("zod");

// Forms often send "" for empty inputs; treat that as "not provided".
const blankToNull = (v) => (typeof v === "string" && v.trim() === "" ? null : v);
const blankToUndef = (v) => (v === "" || v === null ? undefined : v);

const str = z.string().trim().min(1, "Required");
const optStr = z.preprocess(blankToNull, z.string().trim().nullish()).optional();
const optEmail = z.preprocess(blankToNull, z.email().nullish()).optional();

const date = z.coerce.date();
const optDate = z.preprocess(blankToNull, z.coerce.date().nullish()).optional(); // nullable column
const dateMaybe = z.preprocess(blankToUndef, z.coerce.date().optional()).optional(); // non-null column with default

const optInt = z.preprocess(blankToNull, z.coerce.number().int().nullish()).optional();
const intMaybe = z.preprocess(blankToUndef, z.coerce.number().int().min(0).optional()).optional();

const money = z.coerce.number().nonnegative().max(10_000_000);
const optJson = z.record(z.string(), z.any()).optional();

// List of strings stored in a Json column (MySQL has no String[]).
// Accepts a real array or a comma-separated string from a form.
// Blank/null/missing becomes undefined, so the column default ([]) applies on create
// and the field is left unchanged on update. To clear it on update, send [].
const strList = z
  .preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string") {
      const items = v.split(",").map((s) => s.trim()).filter(Boolean);
      return items.length ? items : undefined;
    }
    return v;
  }, z.array(z.string().trim().min(1)).max(100).optional())
  .optional();

module.exports = {
  str, optStr, optEmail, date, optDate, dateMaybe,
  optInt, intMaybe, money, optJson, strList,
};
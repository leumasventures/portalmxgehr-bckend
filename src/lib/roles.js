// An empty list means "any signed-in user".
module.exports = {
  ANY: [],
  ADMIN: ["ADMIN"],
  PROVIDERS: ["ADMIN", "PROVIDER"],
  CLINICAL: ["ADMIN", "PROVIDER", "NURSE"],
  CLINICAL_FRONT: ["ADMIN", "PROVIDER", "NURSE", "FRONT_DESK"],
  BILLING: ["ADMIN", "BILLING"],
  BILLING_FRONT: ["ADMIN", "BILLING", "FRONT_DESK"],
  REPORTING: ["ADMIN", "PROVIDER", "BILLING"],
};

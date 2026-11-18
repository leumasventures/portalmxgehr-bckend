exports.patientBrief = {
  select: { id: true, mrn: true, firstName: true, lastName: true, dob: true },
};

exports.userBrief = {
  select: { id: true, firstName: true, lastName: true, title: true, role: true },
};

// Everything about a user except the password hash.
exports.userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  title: true,
  phone: true,
  npi: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
};

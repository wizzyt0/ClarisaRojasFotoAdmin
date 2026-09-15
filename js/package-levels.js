export const PACKAGE_LEVELS = { KINDER: "Preescolar", PRIMARY: "Primaria", SECONDARY: "Secundaria" };

export function packageMatchesSchool(pkg, packageType, schoolLevel) {
  return pkg.package_type === packageType &&
    (packageType !== "SCHOOL_GRADUATION" || Boolean(schoolLevel && pkg.school_level === schoolLevel));
}

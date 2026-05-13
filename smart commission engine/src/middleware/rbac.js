const policy = require("../config/rbacPolicy.json");

function extractPermissionsFromToken(claims) {
  const directPermissions = Array.isArray(claims.permissions) ? claims.permissions : [];
  const scopePermissions =
    typeof claims.scope === "string" ? claims.scope.split(" ").map((item) => item.trim()).filter(Boolean) : [];
  const roles = Array.isArray(claims.roles) ? claims.roles : claims.role ? [claims.role] : [];
  const rolePermissions = roles.flatMap((role) => policy[role] || []);
  return new Set([...directPermissions, ...scopePermissions, ...rolePermissions]);
}

function hasPermission(claims, permission) {
  if (!claims) return false;
  const permissions = extractPermissionsFromToken(claims);
  return permissions.has(permission);
}

module.exports = {
  hasPermission
};

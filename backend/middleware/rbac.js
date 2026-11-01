/**
 * Role-Based Access Control (RBAC) & Object Ownership Middleware
 */

const ROLE_HIERARCHY = {
  client: ['client'],
  staff: ['client', 'staff'],
  salon_owner: ['client', 'staff', 'salon_owner'],
  admin: ['client', 'staff', 'salon_owner', 'admin']
};

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    }

    const granted = ROLE_HIERARCHY[req.user.role] || [];
    const hasPermission = allowedRoles.some(role => granted.includes(role));

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Forbidden: Insufficient privileges for this action.',
        required: allowedRoles,
        current: req.user.role
      });
    }

    next();
  };
}

function requireStrictRole(...exactRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    }

    // Admins always have system-wide access; otherwise require exact match
    if (req.user.role === 'admin' || exactRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      error: `Forbidden: Access restricted to ${exactRoles.join(' or ')} only.`,
      requiredRole: exactRoles,
      currentRole: req.user.role
    });
  };
}

module.exports = {
  requireRoles,
  requireStrictRole,
  ROLE_HIERARCHY
};

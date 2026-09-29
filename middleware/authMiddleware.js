const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/i.test(authorization)) {
    res.status(401);
    return next(new Error('Not authorized, no valid token provided'));
  }

  let user;
  try {
    const token = authorization.split(/\s+/)[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    user = await User.findById(decoded.id).select('-password');
  } catch (error) {
    res.status(401);
    return next(new Error('Not authorized, token failed'));
  }

  if (!user) {
    res.status(401);
    return next(new Error('Not authorized, user no longer exists'));
  }

  req.user = user;
  return next();
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }

  res.status(403);
  return next(new Error('Not authorized as an admin'));
};

module.exports = { protect, admin };

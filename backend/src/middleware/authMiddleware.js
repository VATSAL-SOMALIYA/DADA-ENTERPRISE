const jwt = require("jsonwebtoken");

exports.requireAuth = (req, res, next) => {
  // 1. Grab the token from the cookies
  const token = req.cookies.token;

  // 2. If no token exists, kick them back to the login page
  if (!token) {
    return res.redirect("/");
  }

  try {
    // 3. Verify the token using your secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 4. Attach the user info to the request and let them pass
    req.user = decoded;
    next();
  } catch (err) {
    // If the token is fake or expired, clear it and redirect
    res.clearCookie("token");
    res.redirect("/");
  }
};
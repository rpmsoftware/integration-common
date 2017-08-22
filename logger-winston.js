const winston = require('winston');
module.exports = {
  error: winston.error,
  warn: winston.warn,
  info: winston.info,
  debug: winston.debug,
  trace: winston.trace
};

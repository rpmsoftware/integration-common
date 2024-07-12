const logger = {
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.log,
  trace: console.trace
};
module.exports = () => logger;
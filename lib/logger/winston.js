const w = require('winston');

module.exports = config => {
  let logger;
  const transports = [new w.transports.Console()];
  if (config.file) {
    transports.push(new w.transports.File({
      filename: config.file,
      timestamp: Date,
      json: false,
      maxsize: config.maxsize,
    }));
  }
  logger = {
    format: w.format.combine(
      w.format.splat(),
      w.format.timestamp(),
      w.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
    ),
    transports
  };
  if (config.level) {
    logger.level = config.level;
  }
  return w.createLogger(logger);
};


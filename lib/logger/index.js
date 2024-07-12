module.exports = config => require('./' + (config && config.provider || 'console'))(config);

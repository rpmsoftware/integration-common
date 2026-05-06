module.exports = config => config?.notifier ?
    require('./sendemail').createErrorNotifier(config.notifier) :
    require('./util/index.mjs').logErrorStack;

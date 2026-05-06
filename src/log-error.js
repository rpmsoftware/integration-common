module.exports = config => config?.notifier ?
    require('./sendemail').createErrorNotifier(config.notifier) :
    require('./util.mjs').logErrorStack;

const { logErrorStack } = require('./util');
const { format } = require('util');

exports.createErrorNotifier = function (configOrSender) {
    const sendMessage = typeof configOrSender === 'function' ? configOrSender : createMessageSender(configOrSender);
    return function (error, subject) {
        logErrorStack(error);
        if (subject === undefined) {
            subject = error && error.toString();
        }
        if (error instanceof Error) {
            error = error.stack;
        } else if (typeof error === 'object') {
            error = format('%j', error);
        }
        sendMessage(subject, error).then(undefined, logErrorStack);
    };
};

function createMessageSender(config) {
    return require('./' + config.provider).createMessageSender(config);
}

exports.createMessageSender = createMessageSender;

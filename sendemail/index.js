const { logErrorStack, getEager, getGlobal } = require('../util');
const { format } = require('util');

const createErrorNotifier = configOrSender => {
    const sendMessage = typeof configOrSender === 'function' ? configOrSender : createMessageSender(configOrSender);
    return (error, subject) => {
        logErrorStack(error);
        if (subject === undefined) {
            subject = error && error.toString();
        }
        if (error instanceof Error) {
            error = error.stack;
        } else if (typeof error === 'object') {
            error = format('%j', error);
        }
        sendMessage({ subject, messageBody: error }).catch(logErrorStack);
    };
};

const createMessageSender = config =>
    require('./' + config.provider).createMessageSender(config);

const SENDERS = {};

const getSender = name => SENDERS[name] ||
    (SENDERS[name] = createMessageSender(getEager(getGlobal(), name)));

module.exports = {
    getSender,
    createErrorNotifier,
    createMessageSender
};
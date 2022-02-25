const { createClient } = require('../../../office365/graph');
global.fetch = require('node-fetch');

module.exports = config => {
    let graphApi = createClient(config);
    graphApi = graphApi.api.bind(graphApi);
    return (fromEmail, toEmails, ccEmails, subject, messageBody, html) =>
        graphApi(`users/${fromEmail.address}/sendMail`).post({
            message: {
                toRecipients: toEmails.map(emailAddress => ({ emailAddress })),
                ccRecipients: ccEmails ? ccEmails.map(emailAddress => ({ emailAddress })) : undefined,
                subject,
                body: {
                    contentType: html ? 'html' : 'text',
                    content: messageBody
                }
            }
        });
};

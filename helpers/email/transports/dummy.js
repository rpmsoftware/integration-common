const log = (fromEmail, replyToEmail, toEmails, ccEmails, subject, messageBody, html) => {
    console.log('send(%j,%j,%j,%j,"%s","%s",%s', fromEmail, replyToEmail, toEmails, ccEmails, subject, messageBody, html);
};
module.exports = () => log;

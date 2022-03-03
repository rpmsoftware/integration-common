const log = (fromEmail, toEmails, ccEmails, subject, messageBody, html) => {
    console.log('send(%j,%j,%j,"%s","%s",%s', fromEmail, toEmails, ccEmails, subject, messageBody, html);
};
module.exports = () => log;

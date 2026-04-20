import { throwError, fetch, toArray } from './util/index.js';

const BASE_URL = 'https://api.sendgrid.com/';

export type ApiConfig = {
    apiKey: string
};

type EmailAddress = {
    name?: string,
    address: string
} | string;

export type SendMailConfig = {
    fromEmail: EmailAddress,
    toEmails: EmailAddress[] | EmailAddress,
    subject: string,
    messageBody?: string,
    replyToEmail?: EmailAddress,
    ccEmails?: EmailAddress[] | EmailAddress,
    html?: boolean
};

const SendGridErrorType = 'SendGridApiError';

type SendGridError = {
    message: string
};

type SendGridErrorResponse = {
    response: {
        errors: SendGridError[]
    }
};

const normalizeAddress = (address: EmailAddress) =>
    typeof address === 'string' ? { email: address } : { email: address.address, name: address.name };


export class SendGridAPI {
    readonly #headers;

    constructor(cfg: ApiConfig) {
        this.#headers = {
            Authorization: `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    async _post(url: string, body: object) {
        try {
            return await fetch(BASE_URL + url, {
                method: 'POST',
                headers: this.#headers,
                body: JSON.stringify(body)
            });

        } catch (error) {
            const sgError = (error as SendGridErrorResponse)?.response?.errors[0];
            sgError && throwError(sgError.message, SendGridErrorType, sgError);
            throw error;
        }
    }

    sendMail(cfg: SendMailConfig) {
        const {
            fromEmail, subject, toEmails, ccEmails, replyToEmail, messageBody, html
        } = cfg;
        return this._post('v3/mail/send', {
            personalizations: [{
                to: toArray(toEmails).map(normalizeAddress),
                cc: ccEmails && toArray(ccEmails).map(normalizeAddress),
                subject
            }],
            from: normalizeAddress(fromEmail),
            reply_to: replyToEmail && normalizeAddress(replyToEmail),
            content: messageBody && [{
                type: html ? 'text/html' : 'text/plain',
                value: messageBody
            }]
        });
    }
}

export default SendGridAPI;

import { throwError, fetch, toArray } from '../util.mjs';
import Debug from 'debug';
import { EmailAddress, SendMailConfig } from './index.mjs';

const BASE_URL = 'https://api.sendgrid.com/';

export type ApiConfig = {
    apiKey: string
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

const debug = Debug('rpm:sendgrid');

type PartialConfig = Partial<SendMailConfig>;

export type SenderConfig = PartialConfig & ApiConfig;

export const createMessageSender = (globalCfg: SenderConfig) => {
    globalCfg = Object.assign({}, globalCfg);
    const { apiKey } = globalCfg as ApiConfig;
    delete (globalCfg as any).apiKey;
    const sgMail = new SendGridAPI({ apiKey });
    return (cfg?: PartialConfig) => {
        cfg = cfg ? Object.assign({}, globalCfg, cfg) : globalCfg;
        debug('Sending email: %j', cfg);
        return sgMail.sendMail(cfg as SendMailConfig);
    };
};

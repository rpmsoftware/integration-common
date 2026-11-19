import { throwError } from '../util.mjs';
import assert from 'assert';

const PROP_ERROR2EMAIL = Symbol();

export type EmailAddress = {
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

export const throwToSend = (error: Error | string) => {
    const data: Record<symbol, boolean | string> = {};
    data[PROP_ERROR2EMAIL] = true;
    throwError(error, undefined, data);
};

type TMailer = (cfg?: Partial<SendMailConfig>) => Promise<Response>;

export const errorSender = (sendError: TMailer, converter?: (error: unknown) => Partial<SendMailConfig>) => {
    assert.strictEqual(typeof sendError, 'function');
    return async (callback: () => any) => {
        try {
            return await callback();
        } catch (error) {
            if (!isErrorToSend(error)) throw error;
            await sendError(converter ? converter(error) : { messageBody: error + '' });
        }
    };
};

const isErrorToSend = (error: any) => error[PROP_ERROR2EMAIL];
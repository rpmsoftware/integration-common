import { SendGridAPI, SendMailConfig, ApiConfig } from './sendgrid-api.mjs';
const debug = require('debug')('rpm:sendgrid');

type PartialConfig = Partial<SendMailConfig>;

exports.createMessageSender = (globalCfg: PartialConfig & ApiConfig) => {
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

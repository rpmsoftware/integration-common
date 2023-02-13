const { toArray } = require('../../util');
const { init: initEmail, send: sendEmail } = require('../email');

module.exports = {
    init: async function (conf) {
        return initEmail.call(this, conf);
    },

    convert: async function (conf, data) {
        for (let e of toArray(data)) {
            await sendEmail.call(this, conf, e);
        }
        return data;
    }
};
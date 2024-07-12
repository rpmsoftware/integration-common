const { getFreshDeskApi } = require('./util');
const { init, convert } = require('../method');

module.exports = {
    init,

    convert: async function (conf, obj) {
        conf.getMethodContext || (conf.getMethodContext = getFreshDeskApi.bind(this));
        return convert.call(this, conf, obj);
    }
};

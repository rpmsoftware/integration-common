const { init, convert } = require('../method');
const Api = require('../../../asana');
const { getGlobal } = require('../../../util');

module.exports = {
    init,

    convert: function (conf, obj) {
        conf.getMethodContext || (conf.getMethodContext = getApi);
        return convert.call(this, conf, obj);
    }
};

const API = Symbol();

const getApi = () => {
    const global = getGlobal();
    return global[API] || (global[API] = new Api(global.asanaApi));
};

const { init, convert } = require('./method');
const Api = require('../../quickbooks/stored');
const { getGlobal } = require('../../util');

module.exports = {
    init,

    convert: async function (conf, obj) {
        conf.getMethodContext || (conf.getMethodContext = getApi.bind(this));
        return convert.call(this, conf, obj);
    }
};

const PROP_API = Symbol();

function getApi() {
    const g = getGlobal();
    return g[PROP_API] || (g[PROP_API] = new Api(g.quickbooksApi));
}

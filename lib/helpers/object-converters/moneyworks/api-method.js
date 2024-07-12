const { init, convert } = require('../method');
const Api = require('../../../moneyworks');

module.exports = {
    init,

    convert: async function (conf, obj) {
        conf.getMethodContext || (conf.getMethodContext = getApi.bind(this));
        return convert.call(this, conf, obj);
    }
};

const API = Symbol();

function getApi() {
    let { state } = this;
    state || (state = this);
    return state[API] || (state[API] = new Api(state.globals.moneyworksApi));
}

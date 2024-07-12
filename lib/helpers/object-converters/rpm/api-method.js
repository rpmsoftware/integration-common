const { init, convert } = require('../method');

module.exports = {
    init,
    convert: async function (conf, obj) {
        conf.getMethodContext || (conf.getMethodContext = () => this.api);
        return convert.call(this, conf, obj);
    }
};

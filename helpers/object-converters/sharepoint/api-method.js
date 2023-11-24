const { init, convert } = require('../method');
const SharepointApi = require('../../../sharepoint/v2');

const API = Symbol();

function getSharepointApi() {
    const { parentContext: ctx } = this;
    return ctx[API] || (ctx[API] = new SharepointApi(ctx.globals.sharepointApi));
}

module.exports = {
    init,

    convert: function (conf, obj) {
        conf.getMethodContext || (conf.getMethodContext = getSharepointApi.bind(this));
        return convert.call(this, conf, obj);
    }
};

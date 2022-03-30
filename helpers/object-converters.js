const { init, get } = require('./getters');
const { validateString } = require('../util');

exports.init = async function (conf) {
    const result = [];
    for (let c of conf || []) {
        const { dstProperty } = c;
        validateString(dstProperty);
        c = await init.call(this, c);
        c.dstProperty = dstProperty;
        result.push(c);
    }
    return result;
}

exports.convert = async function (conf, srcObj) {
    for (const c of conf) {
        srcObj[c.dstProperty] = await get.call(this, c, srcObj);
    }
    return srcObj;
}
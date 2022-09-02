const { validateString, toArray, getEager } = require('../../util');
const { ObjectType } = require('../../api-enums');

module.exports = {
    init: async function ({ type, dstProperty }) {
        validateString(dstProperty);
        type = getEager(ObjectType, type);
        return { type, dstProperty };
    },

    convert: async function ({ type, dstProperty }, data) {
        const stubs = await this.api.getEntities(type);
        toArray(data).forEach(e => e[dstProperty] = stubs);
        return data;
    }
};
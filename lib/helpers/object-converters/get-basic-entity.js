const { validateString, toArray, getEager, getDeepValue, validatePropertyConfig } = require('../../util');
const { ObjectType } = require('../../api-enums');

module.exports = {
    init: async function ({ type, dstProperty, nameOrID }) {
        validateString(dstProperty);
        type = getEager(ObjectType, type);
        nameOrID = validatePropertyConfig(nameOrID)
        return { type, dstProperty, nameOrID };
    },

    convert: async function ({ type, dstProperty, nameOrID }, data) {
        const { api } = this;
        for (const e of toArray(data)) {
            const id = getDeepValue(e, nameOrID);
            id && (e[dstProperty] = await api.getEntity(type, id));
        }
        return data;
    }
};
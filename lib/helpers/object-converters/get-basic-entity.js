const { validateString, toArray, getEager, getDeepValue, validatePropertyConfig } = require('../../util');
const { ObjectType } = require('../../api-enums');
const assert = require('assert');

module.exports = {
    init: async function ({ type, dstProperty, nameOrID, idProperty, nameProperty }) {
        validateString(dstProperty);
        type = getEager(ObjectType, type);
        idProperty = idProperty ? validatePropertyConfig(idProperty) : undefined;
        nameProperty = nameProperty ? validatePropertyConfig(nameProperty) : undefined;
        nameOrID = nameOrID ? validatePropertyConfig(nameOrID) : undefined;
        idProperty || nameProperty || assert(nameOrID);
        return { type, dstProperty, nameOrID, idProperty, nameProperty };
    },

    convert: async function ({ type, dstProperty, nameOrID, idProperty, nameProperty }, data) {
        const { api } = this;
        for (const e of toArray(data)) {
            let id = idProperty && +getDeepValue(e, idProperty) || undefined;
            id || (id = nameProperty && getDeepValue(e, nameProperty) + '' || undefined);
            id || (id = getDeepValue(e, nameOrID));
            id && (e[dstProperty] = await api.getEntity(type, id));
        }
        return data;
    }
};
const {
    validateString, toArray, getDeepValue, validatePropertyConfig, toBoolean
} = require('../../util');

module.exports = {
    init: async function ({ fileIdProperty, dstProperty, url }) {
        dstProperty = validateString(dstProperty);
        url = toBoolean(url) || undefined
        fileIdProperty = fileIdProperty ? validatePropertyConfig(fileIdProperty) : 'FileID';
        return { fileIdProperty, dstProperty, undefined };
    },

    convert: async function ({ fileIdProperty, dstProperty, url }, data) {
        const { api } = this;
        for (const e of toArray(data)) {
            const id = +getDeepValue(e, fileIdProperty);
            id && (e[dstProperty] = await api.getFile(id, url));
        }
        return data;
    }
};
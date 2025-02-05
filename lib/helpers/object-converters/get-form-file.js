/* global Buffer */
const {
    validateString, toArray, getDeepValue, validatePropertyConfig, toBoolean
} = require('../../util');

module.exports = {
    init: async function ({ fileIdProperty, dstProperty, url, asBuffer }) {
        dstProperty = validateString(dstProperty);
        url = toBoolean(url) || undefined;
        asBuffer = toBoolean(asBuffer) || undefined;
        fileIdProperty = fileIdProperty ? validatePropertyConfig(fileIdProperty) : 'FileID';
        return { fileIdProperty, dstProperty, url, asBuffer };
    },

    convert: async function ({ fileIdProperty, dstProperty, url, asBuffer }, data) {
        const { api } = this;
        for (const e of toArray(data)) {
            const id = +getDeepValue(e, fileIdProperty);
            if (!id) {
                continue;
            }
            const file = e[dstProperty] = await api.getFile(id, url);
            asBuffer && (file.File = Buffer.from(file.File, 'base64'));
        }
        return data;
    }
};
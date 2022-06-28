const { validateString, toArray } = require('../../util');
const hash = require('object-hash');

module.exports = {
    init: function ({ dstProperty }) {
        validateString(dstProperty);
        return { dstProperty };
    },

    convert: function ({ dstProperty }, data) {
        toArray(data).forEach(e => e[dstProperty] = hash(e));
        return data;
    }

};
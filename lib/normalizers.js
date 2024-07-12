var rpmUtil = require('./util');

function trim(value) {
    return typeof value === 'string' ? value.trim() : value;
}

function isNull(value) {
    return value === null || value === undefined || typeof value === 'string' && !value.trim();
}


module.exports = {
    normalizeBoolean: function (value) {
        return isNull(value) ? null : rpmUtil.toBoolean(value);
    },

    normalizeDate: function (value) {
        return isNull(value) ? null : rpmUtil.normalizeDate(value);
    },

    normalizeInt: function (value) {
        return isNull(value) ? null : rpmUtil.normalizeInteger(trim(value));
    },

    normalizeNumber: function (value) {
        return isNull(value) ? null : +trim(value);
    },
    returnOriginal: function (value) {
        return value;
    },
    trim: trim,
    isNull: isNull

};
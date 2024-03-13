
const { toBoolean } = require('../../util');

module.exports = {
    init: async function ({ stop }) {
        stop = stop === undefined || toBoolean(stop);
        return { stop };
    },
    convert: async function ({ stop }, obj) {
        console.log('%j', obj);
        if (stop) {
            throw 'STOP';
        }
        return obj;
    }
};
module.exports = {
    init: async function () {
        return {};
    },
    convert: async function ({ }, obj) {
        console.log('%j', obj);
        throw 'STOP';
    }
};
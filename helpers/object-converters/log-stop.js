module.exports = {
    init: async function () {
        return {};
    },
    convert: async function (c, obj) {
        console.log('%j', obj);
        throw 'STOP';
    }
};
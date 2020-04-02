const hash = require('object-hash');

exports.singleCall = function (callback) {
    const running = {};
    return function () {
        let h = Object.values(arguments);
        h.unshift(this);
        h = hash(h);
        let p = running[h];
        if (!p) {
            p = callback.apply(this, arguments);
            if (p instanceof Promise) {
                running[h] = p;
            }
        }
        return p;
    }
};


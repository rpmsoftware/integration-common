const assert = require('assert');
const moment = require('dayjs');
const FreshdeskApi = require('integration-common/freshdesk');
const TIME_FORMAT = /^(\d+):(\d+)$/;

exports.toMinutes = h => {
    const a = TIME_FORMAT.exec(h);
    assert(a);
    return (+a[1]) * 60 + (+a[2]);
};

exports.FIRST_OF_MONTH = moment().date(1).hour(0).minute(0).second(0).millisecond(0);

const FD_API = Symbol();

exports.getFreshDeskApi = function () {
    let { state } = this;
    state || (state = this);
    return state[FD_API] || (state[FD_API] = new FreshdeskApi(state.globals.freshdeskApi));
};

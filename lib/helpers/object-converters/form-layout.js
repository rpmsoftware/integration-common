const { validateString, validatePropertyConfig, toArray, getDeepValue } = require('../../util');
const assert = require('assert');

module.exports = {
    init: async function ({ process, formIDProperty, layout, dstProperty }) {
        const { api } = this;
        dstProperty = validateString(dstProperty);
        formIDProperty = validatePropertyConfig(formIDProperty);
        if (layout || (layout = undefined)) {
            process = (await api.getProcesses()).getProcess(validateString(process), true).ProcessID;
            const { Layouts } = await api.getFields(process);
            let cb;
            const t = typeof layout;
            if (t === 'string') {
                cb = ({ LayoutName }) => LayoutName === layout;
            } else {
                assert.strictEqual(t, 'number');
                cb = ({ LayoutID }) => LayoutID === layout;
            }
            layout = Layouts.demand(cb).LayoutID;
        }
        return { formIDProperty, layout, dstProperty };
    },

    convert: async function ({ formIDProperty, layout, dstProperty }, data) {
        const { api } = this;
        for (const e of toArray(data)) {
            const id = +getDeepValue(e, formIDProperty);
            if (id) {
                e[dstProperty] = await api.shareFormLayout(id, layout);
            } else {
                delete e[dstProperty];
            }
        }
        return data;
    }
};
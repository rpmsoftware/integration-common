const { validateString, toArray, getDeepValue, validatePropertyConfig, toBoolean } = require('../../../util');
const { propertyOrValue } = require('../util');

module.exports = {

    init: async function ({ dstProperty, formIDProperty, noteText, noteBy, noteForStaff }) {
        noteForStaff = toBoolean(noteForStaff) || undefined;
        formIDProperty = validatePropertyConfig(formIDProperty);
        noteText = propertyOrValue.init(noteText);
        noteBy = propertyOrValue.init(noteBy);
        validateString(dstProperty);
        return { dstProperty, formIDProperty, noteText, noteBy, noteForStaff };
    },

    convert: async function ({ dstProperty, formIDProperty, noteText, noteBy, noteForStaff: forStaff }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            const formID = +getDeepValue(e, formIDProperty);
            const text = propertyOrValue.get(noteText, e);
            if (!formID || !text) {
                continue;
            }
            let note, noteForStaff;
            forStaff ? (noteForStaff = text) : (note = text);
            const user = propertyOrValue.get(noteBy, e) || undefined;
            const result = await api.addNoteByFormID(formID, note, noteForStaff, user);
            dstProperty && (e[dstProperty] = result.Form);
        }
        return obj;
    }
    
};

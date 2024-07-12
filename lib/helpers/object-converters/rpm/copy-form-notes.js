const { validateString, toArray, getDeepValue, validatePropertyConfig, toBoolean } = require('../../../util');
const assert = require('assert');

module.exports = {

    init: async function ({ srcFormID, dstFormID, forStaff, forAll, dstProperty }) {
        forStaff = forStaff === undefined || toBoolean(forStaff);
        forAll = forAll === undefined || toBoolean(forAll);
        forAll || assert(forStaff);
        srcFormID = validatePropertyConfig(srcFormID);
        dstFormID = validatePropertyConfig(dstFormID);
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        return { srcFormID, dstFormID, forStaff, forAll, dstProperty };
    },

    convert: async function ({
        srcFormID: srcFormIDProperty, dstFormID: dstFormIDProperty, forStaff, forAll, dstProperty
    }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            let srcForm = +getDeepValue(e, srcFormIDProperty);
            const dstFormID = +getDeepValue(e, dstFormIDProperty);
            if (!(dstFormID > 0 && srcForm > 0)) {
                continue;
            }
            const { Notes, NotesForStaff } = (await api.demandForm(srcForm)).Form;
            let p = [];
            forAll && (p = p.concat(Notes.map(({ Note, By }) => api.parallelRunner(() =>
                api.addNoteByFormID(dstFormID, Note, undefined, By)
            ))));
            forStaff && (p = p.concat(NotesForStaff.map(({ Note, By }) => api.parallelRunner(() =>
                api.addNoteByFormID(dstFormID, undefined, Note, By)
            ))));
            p = await Promise.all(p);
            dstProperty && (
                e[dstFormIDProperty] = (p.length === 1 ? p[0] : await api.demandForm(dstFormID)).Form
            );
        }
        return obj;
    }

};

/* Deprecated. Use date-time-periods */
(() => {
    const dtp = require('./date-time-periods');
    for (let period in dtp) {
        exports[period] = dtp[period].getCronPattern;
    }
})();
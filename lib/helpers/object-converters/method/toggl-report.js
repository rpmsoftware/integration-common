const TogglReportApi = require('../../../toggl-report');

module.exports = conf => {
    const gc = new TogglReportApi(conf);
    return () => gc;
};
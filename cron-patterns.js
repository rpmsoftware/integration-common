const { format } = require('util');

module.exports = {

    yearly: time =>
        format('%d %d %d %d %d *', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDate(), time.getMonth() + 1)
    ,

    'semi-yearly': time => {
        const month = time.getMonth();
        const months = [0, 6].map(m => (m + month) % 12 + 1).join(',');
        return format('%d %d %d %d %s *', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDate(), months );
    },

    quarterly: time => {
        const month = time.getMonth();
        const months = [0, 3, 6, 9].map(m => (m + month) % 12 + 1).join(',');
        return format('%d %d %d %d %s *', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDate(), months);
    },

    monthly: time =>
        format('%d %d %d %d * *', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDate())
    ,

    weekly: time =>
        format('%d %d %d * * %d', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDay())
    ,

    daily: time =>
        format('%d %d %d * * *', time.getSeconds(), time.getMinutes(), time.getHours())
    ,

    hourly: time =>
        format('%d %d * * * *', time.getSeconds(), time.getMinutes())
    ,
};

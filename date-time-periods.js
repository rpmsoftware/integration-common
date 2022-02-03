const { format } = require('util');

module.exports = {

    yearly: {
        getCronPattern: time =>
            format('%d %d %d %d %d *', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDate(), time.getMonth() + 1),
        momentIncrement: {
            year: 1
        }
    },

    'semi-yearly': {
        getCronPattern: time => {
            const month = time.getMonth();
            const months = [0, 6].map(m => (m + month) % 12 + 1).join(',');
            return format('%d %d %d %d %s *', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDate(), months);
        },
        momentIncrement: {
            month: 6
        }

    },

    quarterly: {
        getCronPattern: time => {
            const month = time.getMonth();
            const months = [0, 3, 6, 9].map(m => (m + month) % 12 + 1).join(',');
            return format('%d %d %d %d %s *', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDate(), months);
        },
        momentIncrement: {
            month: 3
        }
    },

    monthly: {
        getCronPattern: time =>
            format('%d %d %d %d * *', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDate()),
        momentIncrement: {
            month: 1
        }
    },

    weekly: {
        getCronPattern: time =>
            format('%d %d %d * * %d', time.getSeconds(), time.getMinutes(), time.getHours(), time.getDay()),
        momentIncrement: {
            week: 1
        }
    },

    daily: {
        getCronPattern: time =>
            format('%d %d %d * * *', time.getSeconds(), time.getMinutes(), time.getHours()),
        momentIncrement: {
            day: 1
        }
    },

    hourly: {
        getCronPattern: time =>
            format('%d %d * * * *', time.getSeconds(), time.getMinutes()),
        momentIncrement: {
            hour: 1
        }
    },
};

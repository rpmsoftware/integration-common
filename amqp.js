const amqplib = require('amqplib');
const DEFAULT_URL = process.env.CLOUDAMQP_URL || 'amqp://localhost';
const { logErrorStack } = require('./util');

class Sender {
    constructor(channel, queue) {
        this.channel = channel;
        this.queue = queue;
        channel.assertQueue(queue, { durable: true });
        console.log('Sender created. Queue: %s', queue);
    }

    async close(closeConnection) {
        if (!this.channel) {
            return;
        }
        await this.channel.close();
        const channel = this.channel;
        this.channel = undefined;
        if (closeConnection) {
            return channel.connection.close();
        }
    }

    send(data) {
        if (!Buffer.isBuffer(data)) {
            data = new Buffer(typeof data === 'string' ? data : JSON.stringify(data));
        }
        return this.channel.sendToQueue(this.queue, data, { persistent: true });

    }
}

async function createChannel(url) {
    console.log('AMQP. Connecting to ', url);
    const connect = await amqplib.connect(url);
    try {
        const channel = await connect.createChannel();
        console.log('Channel created. URL: %s', url);
        return channel;
    } catch (error) {
        connect.close();
        throw error;
    }
}

exports.createSender = async function (queue, url) {
    return new Sender(await createChannel(url || DEFAULT_URL), queue);
};

exports.createReciever = async function (queue, url, callback) {
    if (typeof url === 'function') {
        callback = url;
        url = undefined;
    }
    if (typeof callback !== 'function') {
        throw new Error('Callback function is expected');
    }
    url = url || DEFAULT_URL;
    const channel = await createChannel(url);
    channel.assertQueue(queue, { durable: true });
    channel.prefetch(1);
    let p = Promise.resolve();
    channel.consume(queue, msg => {
        let data = msg.content.toString();
        try {
            data = JSON.parse(data);
        } catch (error) {
        }
        p = p.then(callback(data, msg, channel));
        p = p.then(() => channel.ack(msg), error => {
            channel.ack(msg);
            logErrorStack(error);
        });
        return p;
    }, { noAck: false });
    console.log('Listening');
    return channel;
};


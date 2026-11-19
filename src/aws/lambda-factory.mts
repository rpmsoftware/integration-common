import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { validateString, throwError, THashMap } from '../util.mjs';
import { randomBytes } from 'crypto';
import assert from 'assert';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min
const THRESHOLD = 1000 * 60;
const ID_PROPERTY = randomBytes(16).toString('hex');

const RECURSIVE_REQUEST: THashMap<boolean> = {};
RECURSIVE_REQUEST[ID_PROPERTY] = true;
const lambdaClient = new LambdaClient();

type RequestProcessor = (request: object) => void;

export class ExecutionContext {
    leftoverActionQueue: (() => void)[];
    eventProcessor: RequestProcessor;

    constructor(eventProcessor: RequestProcessor) {
        assert.strictEqual(typeof eventProcessor, 'function');
        this.eventProcessor = eventProcessor;
        this.leftoverActionQueue = [];
    }

    async processEvent(req: object) {
        return this.eventProcessor(req);
    }

    pushLeftoverAction(callback: (context: ExecutionContext) => void) {
        assert.strictEqual(typeof callback, 'function');
        this.leftoverActionQueue.push(() => callback(this));
    }

    async shiftLeftoverAction() {
        const { leftoverActionQueue } = this;
        const action = leftoverActionQueue.shift();
        try {
            action && await action();
        } catch (e) {
            this.leftoverActionQueue = [];
            throw e;
        }
    }

    get hasLeftoverActions() {
        return this.leftoverActionQueue.length > 0;
    }

};

interface LambdaContext {
    getRemainingTimeInMillis: () => number;
    invokedFunctionArn: string;
};

export default (eventHandler: ExecutionContext | RequestProcessor) => {

    if (!(eventHandler instanceof ExecutionContext)) {
        assert.strictEqual(typeof eventHandler, 'function');
        eventHandler = new ExecutionContext(eventHandler);
    }

    const handler = async (request: THashMap, context?: LambdaContext) => {

        let getRemainingTime: () => number;

        if (context) {
            getRemainingTime = () => context.getRemainingTimeInMillis() - THRESHOLD;
        } else {
            const diesAt = Date.now() + DEFAULT_TTL_MS;
            getRemainingTime = () => {
                const r = diesAt - Date.now();
                return r < 0 ? 0 : r;
            };
        }

        const passToNewHandler: (request: THashMap) => unknown = context ?
            (request: THashMap) => lambdaClient.send(new InvokeCommand({
                FunctionName: validateString(context.invokedFunctionArn),
                InvocationType: 'Event',
                LogType: 'Tail',
                Payload: JSON.stringify(request),
            })) :
            handler;

        request?.[ID_PROPERTY] || await eventHandler.processEvent(request);
        let iterated = false;
        let remainingTime = getRemainingTime();
        while (eventHandler.hasLeftoverActions) {
            if (remainingTime <= 0) {
                iterated || throwError('Increase lambda timeout');
                console.error('Next iteration');
                return passToNewHandler(RECURSIVE_REQUEST);
            }
            await eventHandler.shiftLeftoverAction();
            iterated = true;
            remainingTime = getRemainingTime();
        }

    };
    return handler;
};

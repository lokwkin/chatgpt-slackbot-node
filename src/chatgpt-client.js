import { ChatGPTAPI } from 'chatgpt'
import RedisAgent from './redis-agent.js';
import crypto from 'crypto';

/**
 * @typedef ChatGptClientArgs
 * @property {string} apiKey
 * @property {number} [requestTimeoutMs]
 * @property {object} completionParams
 * @property {number} [temperature]
 * @property {number} [top_p]
 * @property {number} [presence_penalty]
 * @property {number} [frequency_penalty]
 */

/**
 * @typedef ChatGptQuestion
 * @property {string} prompt
 * @property {string} [parentMessageId]
 * @property {string} [responseQueue]
 */

/**
 * @typedef ChatGptAnswer
 * @property {string} response
 * @property {string} messageId
 */

/**
 * @typedef ChatGptCallbackParam
 * @property {boolean} success
 * @property {string} handlerId
 * @property {ChatGptQuestion} question
 * @property {ChatGptAnswer} [answer]
 * @property {Error} [error]
 * @property {*} [extra]
 */

/**
 * @callback ChatGptCallback
 * @param {ChatGptCallbackParam} param
 */
class ChatGptClient {

    /**
     * @param {ChatGptClientArgs} args 
     */
    constructor(args) {

        this.chatApi = new ChatGPTAPI({
            apiKey: args.apiKey,
            completionParams: args.completionParams,
            debug: true
        });

        /** @type {ChatGptClientArgs} */
        this.apiKey = args.apiKey;

        /** @type {string} */
        this.handlerId = this._obtainHandlerId();

        /** @type {number} */
        this.requestTimeoutMs = args.requestTimeoutMs ?? 5 * 60 * 1000;
    }

    /**
     * Ask ChatGPT Asyncrhonously. Requests will be enqueued to a queue system for handlers to process. 
     * The result will be returned through an answer queue provided by caller.
     * @param {ChatGptQuestion} question Question
     * @param {object} opts
     * @param {string} opts.responseQueue The name of the queue that the answer should be enqueued to.
     * @param {string} [opts.handlerId] In case a specific handler should be used to answer the question. Mostly used in case of follow up questions.
     * @param {*} [opts.extra] Any extra information that will returned along with the answer.
     * @return {Promise<void>}
     */
    static async ask(question, opts) {

        const { responseQueue, handlerId, extra } = opts;

        if (handlerId) {
            await RedisAgent.getInstance().enqueue(`queues.questions.handler.${handlerId}`, { question, extra, responseQueue });
        } else {
            await RedisAgent.getInstance().enqueue(`queues.questions.handler.common`, { question, extra, responseQueue });
        }
    }

    /**
     * Start listening to queues. Note each client listens to 2 queues: Common Queue and Account Specific Queue.
     * The account specific queue is used in case that a root question is processed by a specific account previously 
     * therefore its follow-up must also be processed by the same account.
     */
    async listenQuestion() {
        console.info(`[${new Date().toISOString()}] CHATGPT_START_LISTEN_QUEUE <${this.handlerId}>`);
        while (true) {
            await this._popAndHandle(`queues.questions.handler.common`);
            await this._popAndHandle(`queues.questions.handler.${this.handlerId}`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    /**
     * @param {string} answerQueueName
     * @param {ChatGptCallback} callback 
     */
    static async listenAnswer(answerQueueName, callback) {
        while (true) {
            /** @type {ChatGptCallbackParam} */
            let item = await RedisAgent.getInstance().dequeue(answerQueueName);
            if (item) {
                await callback(item);
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    /**
     * Pops one item from queue and try to handle it. 
     * @param {string} queueName 
     */
    async _popAndHandle(queueName) {
        let item = await RedisAgent.getInstance().dequeue(queueName);
        if (item) {
            try {
                const answer = await this._handleAsk(item.question);
                await RedisAgent.getInstance().enqueue(item.responseQueue, {
                    success: true,
                    answer,
                    question: item.question,
                    extra: item.extra,
                    handlerId: this.handlerId
                });
            } catch (err) {
                await RedisAgent.getInstance().enqueue(item.responseQueue, {
                    success: false,
                    error: err,
                    question: item.question,
                    extra: item.extra,
                    handlerId: this.handlerId
                });
            }
        }
    }

    /**
     * Handle a question
     * @param {ChatGptQuestion} question 
     * @returns {ChatGptAnswer}
     */
    async _handleAsk(question) {
        try {
            console.info(`[${new Date().toISOString()}] CHATGPT_REQUEST <${this.handlerId}> ${JSON.stringify({ question })}`);
            
            const result = await this.chatApi.sendMessage(question.prompt, {
                parentMessageId: question.parentMessageId,
                timeoutMs: this.requestTimeoutMs,
            });
            console.info(`[${new Date().toISOString()}] CHATGPT_RESPONSE <${this.handlerId}> ${JSON.stringify(result)}`); 

            return {
                response: result.text,
                messageId: result.id,
            };

        } catch (err) {
            console.info(`[${new Date().toISOString()}] CHATGPT_ERROR <${this.handlerId}> ${JSON.stringify({ err })}`);
            throw err;
        }
    }

    /**
     * Returns a hash string from account email 
     */
    _obtainHandlerId() {
        const hash = crypto.createHash('sha256');
        hash.update(this.apiKey);
        const hashedEmail = hash.digest('hex');
        return hashedEmail.substring(0, 10);
    }
}

export { ChatGptClient as default }